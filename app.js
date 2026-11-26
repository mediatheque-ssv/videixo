/*
 * Vidéixo — assemble les vidéos d’un évènement en une story Instagram.
 * Tout se passe dans le navigateur : décodage et encodage vidéo avec WebCodecs,
 * via la bibliothèque Mediabunny (lib/mediabunny.min.js, licence MPL-2.0).
 */
'use strict';

const MB = window.Mediabunny;
const $ = (id) => document.getElementById(id);

/* =========================================================================
   Réglages
   ========================================================================= */

const FPS = 30;

const FORMATS = {
  story: { W: 1080, H: 1920, safeTop: 250, safeBottom: 400 },
  post: { W: 1080, H: 1350, safeTop: 90, safeBottom: 90 },
};

// Durées en secondes. clipDur = longueur de l’extrait pris dans chaque vidéo.
// Durée du titre proposée par défaut pour chaque style, et bornes du réglage (secondes).
const TITLE_DUR_DEFAULT = { charte: 4, doux: 4, dyn: 2.5 };
const TITLE_DUR_MIN = 1.5;
const TITLE_DUR_MAX = 8;

// Durée de l’écran de fin proposée par défaut pour chaque style, et bornes du réglage (secondes).
const END_DUR_DEFAULT = { charte: 3, doux: 3, dyn: 2.5 };
const END_DUR_MIN = 2;
const END_DUR_MAX = 8;

// Styles : allure du titre, des légendes et de l’écran de fin.
const STYLES = {
  charte: { trans: 'court' },
  dyn: { trans: 'glisse' },
  doux: { trans: 'lent' },
};

// Transitions entre les plans, avec la durée des plans pour chaque rythme et le léger zoom progressif (kb).
// Par défaut, elles suivent le style (STYLES[…].trans) ; « Réglages avancés » permet d’en choisir d’autres.
const TRANSITIONS = {
  court: { label: 'Fondus courts', dur: 0.3, clipDur: { rapide: 1.6, moyen: 2.3, pose: 3.2 }, kb: 0.05 },
  glisse: { label: 'Glissés', dur: 0.32, clipDur: { rapide: 1.3, moyen: 1.9, pose: 2.7 }, kb: 0.07 },
  lent: { label: 'Fondus lents', dur: 1.0, clipDur: { rapide: 2.4, moyen: 3.2, pose: 4.2 }, kb: 0.05 },
};
// Transitions « Glissés », dans l’ordre : glissade vers la gauche, poussée vers le haut, zoom, glissade vers la droite.
const DYN_TRANSITIONS = ['whip', 'push', 'zoom', 'whipR'];

function transId() {
  return state.trans !== 'auto' && TRANSITIONS[state.trans] ? state.trans : STYLES[state.style].trans;
}

// Charte graphique de la médiathèque de Servon-sur-Vilaine (Approche Design, novembre 2023).
const CHARTE = {
  petrole: '#0195A2',
  anis: '#CFE43E',
  turquoise: '#47B1B6',
  turquoiseClair: '#D1EBED',
  gris: '#918F90',
  anthracite: '#231F20',
};

// Couleurs proposées pour les styles Dynamique et Doux (le style Médiathèque suit la charte).
const COLORS = [
  { name: 'Pétrole', hex: CHARTE.petrole },
  { name: 'Turquoise', hex: CHARTE.turquoise },
  { name: 'Anis', hex: CHARTE.anis },
  { name: 'Gris', hex: CHARTE.gris },
  { name: 'Anthracite', hex: CHARTE.anthracite },
];

const DEFAULT_LOGO = 'assets/logo-mediatheque.png';

// Filtres appliqués aux vidéos et aux photos (pas aux titres ni au logo).
// Ils sont faits de simples aplats en mode de fusion : même rendu dans l’aperçu et la vidéo, sur tous les navigateurs.
const FILTERS = [
  { id: 'none', label: 'Aucun' },
  { id: 'nb', label: 'Noir et blanc' },
  { id: 'retro', label: 'Rétro' },
  { id: 'cinema', label: 'Cinéma' },
  { id: 'chaud', label: 'Chaud' },
  { id: 'froid', label: 'Froid' },
];

// Exemple de titre montré dans l’aperçu tant qu’aucune vidéo n’est ajoutée (la date n’apparaît que si elle est saisie).
const PLACEHOLDER = { title: 'Nuit de la lecture' };
const DEFAULT_END = 'Merci d’être venu·es\u00a0!';

const FONT = {
  impact: '"Anton", "Impact", "Arial Narrow", sans-serif',
  serif: '"Literata", Georgia, serif',
  sans: '"Atkinson Hyperlegible", system-ui, sans-serif',
  charteTitle: '"Titre charte", "Advent Pro", "Arial Narrow", sans-serif',
  charteText: '"Texte charte", Calibri, Carlito, sans-serif',
};

class UserError extends Error {}
class Cancelled extends Error {}

/* =========================================================================
   État
   ========================================================================= */

const state = {
  items: [],
  title: '',
  sub: '',
  endText: DEFAULT_END,
  handle: '@mediatheque.servon.sur.vilaine',
  logo: null,       // HTMLImageElement
  logoData: undefined, // undefined : logo de la médiathèque ; '' : pas de logo ; data URL : autre logo
  music: null,      // { file, name, url, el, buffer }
  style: 'charte',
  trans: 'auto', // 'auto' : transitions du style choisi
  color: COLORS[0].hex,
  rythme: 'moyen',
  landscape: 'blur',
  keepSound: true,
  format: 'story',
  endScreen: true,
  filter: 'none',
  // Durée d’affichage du titre au début, en secondes, pour chaque style.
  titleDurs: { ...TITLE_DUR_DEFAULT },
  // Durée de l’écran de fin, en secondes, pour chaque style.
  endDurs: { ...END_DUR_DEFAULT },
  // Projet enregistré en cours d’édition (null : montage pas encore enregistré).
  projectId: null,
  projectName: '',
  dirty: false,
};

/* ---------- Mémoire de la séance ----------
   Tant que l’onglet reste ouvert, tout est gardé, même si la page se recharge (fréquent sur téléphone
   quand on revient d’Instagram ou de la galerie) : réglages et textes dans sessionStorage, fichiers
   dans IndexedDB. Un nouvel onglet (l’appli fermée puis rouverte) repart des réglages par défaut,
   et les fichiers des séances terminées sont effacés. */

const SID_KEY = 'videixo:sid';
const SESSION_KEY = 'videixo:session';
const SESSION_IDLE_MS = 10 * 60 * 1000;
const SAVED_FIELDS = ['title', 'sub', 'endText', 'handle', 'style', 'trans', 'color', 'rythme', 'landscape', 'keepSound', 'format', 'logoData', 'endScreen', 'filter'];

const session = { id: null, restored: null, ready: false };
const newSessionId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Reprend la séance de cet onglet après un rechargement, ou en démarre une nouvelle.
function loadSettings() {
  // Les versions précédentes gardaient des réglages d’une fois sur l’autre : on les efface.
  try { localStorage.removeItem('videixo:v1'); localStorage.removeItem('videixo:v2'); } catch (e) { /* rien */ }
  let saved = null;
  try {
    session.id = sessionStorage.getItem(SID_KEY);
    if (session.id) saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    else { session.id = newSessionId(); sessionStorage.setItem(SID_KEY, session.id); }
  } catch (e) { session.id = session.id || newSessionId(); }
  if (!saved || typeof saved !== 'object') return;
  session.restored = saved;
  applySettings(saved.settings || {});
  if (saved.project) {
    state.projectId = saved.project.id || null;
    state.projectName = saved.project.name || '';
    state.dirty = !!saved.project.dirty;
  }
}

// Valeurs par défaut des réglages, relevées au chargement de la page.
const DEFAULT_SETTINGS = {};
for (const k of SAVED_FIELDS) DEFAULT_SETTINGS[k] = state[k];

// Remet les réglages par défaut puis applique ceux donnés (st peut être vide).
function applySettings(st) {
  for (const k of SAVED_FIELDS) state[k] = DEFAULT_SETTINGS[k];
  state.titleDurs = { ...TITLE_DUR_DEFAULT };
  state.endDurs = { ...END_DUR_DEFAULT };
  for (const k of SAVED_FIELDS) {
    if (st[k] !== undefined && st[k] !== null) state[k] = st[k];
  }
  if (!STYLES[state.style]) state.style = 'charte';
  if (!FILTERS.some((f) => f.id === state.filter)) state.filter = 'none';
  if (!FORMATS[state.format]) state.format = 'story';
  if (!TRANSITIONS.court.clipDur[state.rythme]) state.rythme = 'moyen';
  if (state.trans !== 'auto' && !TRANSITIONS[state.trans]) state.trans = 'auto';
  if (st.titleDurs && typeof st.titleDurs === 'object') {
    for (const k of Object.keys(TITLE_DUR_DEFAULT)) {
      const v = Number(st.titleDurs[k]);
      if (Number.isFinite(v)) state.titleDurs[k] = clamp(v, TITLE_DUR_MIN, TITLE_DUR_MAX);
    }
  }
  if (st.endDurs && typeof st.endDurs === 'object') {
    for (const k of Object.keys(END_DUR_DEFAULT)) {
      const v = Number(st.endDurs[k]);
      if (Number.isFinite(v)) state.endDurs[k] = clamp(v, END_DUR_MIN, END_DUR_MAX);
    }
  }
}

let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = 0; saveSessionNow(); }, 300);
}

// Enregistre tout de suite ce qui attendait, quand la page passe en arrière-plan ou se ferme
// (sur téléphone, on bascule souvent vers Instagram juste après un changement).
function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  saveSessionNow();
}
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

// Tout ce qui décrit le montage, sans les fichiers : réglages, plans, musique.
function montageData() {
  const settings = { titleDurs: { ...state.titleDurs }, endDurs: { ...state.endDurs } };
  for (const k of SAVED_FIELDS) settings[k] = state[k];
  const items = state.items.filter((i) => !i.removed && i.status !== 'error').map((i) => ({
    id: i.id, kind: i.kind, name: i.name, caption: i.caption || '',
    start: i.start, end: i.end, userStart: !!i.userStart, speed: i.speed || 1, crop: i.crop || null,
    // Fichier déjà rangé dans un projet enregistré (sinon : dans les fichiers de la séance).
    ref: i.fileRef || null,
    // Résultat de l’analyse, pour ne pas la refaire.
    samples: i.samples ? i.samples.map((x) => [+x.t.toFixed(2), +x.lum.toFixed(3), Math.round(x.sharp), x.motion === null ? null : +x.motion.toFixed(2)]) : null,
  }));
  const music = state.music ? { name: state.music.name, ref: state.music.ref || null } : null;
  return { settings, items, music };
}

function saveSessionNow() {
  if (!session.ready) return; // pas avant la fin de la reprise, pour ne pas écraser la séance
  const data = montageData();
  data.project = { id: state.projectId, name: state.projectName, dirty: state.dirty };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (e) {
    try { data.items.forEach((i) => { i.samples = null; }); sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (e2) { /* stockage plein */ }
  }
  touchSession();
}

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB indisponible')); return; }
      const r = indexedDB.open('videixo', 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const name of ['files', 'sessions', 'projects', 'projectFiles']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }).catch((e) => { console.warn('Stockage des fichiers indisponible', e); return null; });
  }
  return dbPromise;
}

// Une opération IndexedDB ; en cas d’échec (navigation privée, stockage plein), on continue sans.
async function dbRun(storeName, mode, fn) {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    let result;
    try {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => { console.warn('Stockage', tx.error); resolve(undefined); };
      tx.onabort = () => resolve(undefined);
    } catch (e) {
      console.warn('Stockage', e);
      resolve(undefined);
    }
  });
}

const fileKey = (name) => `${session.id}/${name}`;
const storeFile = (name, file) => dbRun('files', 'readwrite', (st) => st.put(file, fileKey(name)));
const forgetFile = (name) => dbRun('files', 'readwrite', (st) => st.delete(fileKey(name)));
const readFile = (name) => dbRun('files', 'readonly', (st) => st.get(fileKey(name)));
const readProjectFile = (key) => dbRun('projectFiles', 'readonly', (st) => st.get(key));

// Fichier d’un plan : dans le projet enregistré s’il y en a un, sinon dans la séance.
async function fileFor(meta, sessionName) {
  if (meta && meta.ref) {
    const f = await readProjectFile(meta.ref);
    if (f) return f;
  }
  return sessionName ? readFile(sessionName) : undefined;
}

// Signale que la séance est toujours ouverte (pour ne pas effacer ses fichiers depuis un autre onglet).
let lastTouch = 0;
function touchSession() {
  if (Date.now() - lastTouch < 15000) return;
  lastTouch = Date.now();
  dbRun('sessions', 'readwrite', (st) => st.put(Date.now(), session.id));
}

// Efface les fichiers des séances terminées : onglets fermés, ou sans nouvelles depuis 10 minutes.
async function purgeOldSessions() {
  const now = Date.now();
  const live = new Set([session.id]);
  await dbRun('sessions', 'readwrite', (st) => {
    const req = st.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (now - c.value < SESSION_IDLE_MS) live.add(c.key);
      else c.delete();
      c.continue();
    };
    return null;
  });
  await dbRun('files', 'readwrite', (st) => {
    const req = st.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (!live.has(String(c.key).split('/')[0])) c.delete();
      c.continue();
    };
    return null;
  });
}

// Remet les vidéos, les photos et la musique de la séance après un rechargement de la page.
async function restoreSession() {
  const saved = session.restored;
  if (!saved) return 0;
  let count = 0;
  for (const m of Array.isArray(saved.items) ? saved.items : []) {
    const file = await fileFor(m, String(m.id));
    if (!file) continue;
    addItem(file, m);
    count++;
  }
  if (saved.music) {
    const f = await fileFor(saved.music, 'music');
    if (f) setMusic(f, false, saved.music.ref);
  }
  return count;
}

/* =========================================================================
   Petits outils
   ========================================================================= */

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const easeInCubic = (p) => p * p * p;
const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeOutBack = (p) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };

function fmtTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
function fmtTimeTenths(s) {
  // Calcul en dixièmes entiers : 4,8 s reste « 0:04,8 » malgré les arrondis des nombres à virgule.
  const tenths = Math.round(Math.max(0, s) * 10);
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  return `${m}:${String(Math.floor(rest / 10)).padStart(2, '0')},${rest % 10}`;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}
function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * t));
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Couleur du texte posé sur la couleur d’accent.
const onAccent = (hex) => (luminance(hex) > 0.33 ? '#16161D' : '#FFFFFF');
// Accent assez foncé pour être lu sur fond clair.
const readableAccent = (hex) => (luminance(hex) > 0.3 ? mix(hex, '#000000', 0.45) : hex);

function hash(n) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 16;
  return (x % 1000) / 1000;
}

function slug(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* =========================================================================
   Texte sur canvas
   ========================================================================= */

function wrapWords(ctx, text, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

// Trouve la plus grande taille de police qui fait tenir le texte en maxLines lignes.
function fitText(ctx, text, { family, weight = '400', style = 'normal', maxW, maxLines, max, min }) {
  let size = max;
  let lines = [];
  for (; size >= min; size -= 4) {
    ctx.font = `${style} ${weight} ${size}px ${family}`;
    lines = wrapWords(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
  }
  size = Math.max(size, min);
  ctx.font = `${style} ${weight} ${size}px ${family}`;
  lines = wrapWords(ctx, text, maxW);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  const widths = lines.map((l) => ctx.measureText(l).width);
  return { size, lines, widths, font: ctx.font };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* =========================================================================
   Chronologie du montage
   ========================================================================= */

function clipLength() { return TRANSITIONS[transId()].clipDur[state.rythme]; }

const MIN_EXTRACT = 0.5;

// Vitesses proposées pour chaque vidéo (1 = normale).
const SPEEDS = [
  { value: 0.5, label: '×0,5 (ralenti)' },
  { value: 0.75, label: '×0,75' },
  { value: 1, label: 'Normale' },
  { value: 1.5, label: '×1,5' },
  { value: 2, label: '×2 (accéléré)' },
];

function speedOf(item) {
  return item.kind === 'video' ? item.speed || 1 : 1;
}

// Secondes de la vidéo d’origine utilisées pour un plan. Un extrait réglé à la main garde ses bornes ;
// sinon, on prend de quoi remplir la durée du rythme à la vitesse choisie (deux fois plus de vidéo en ×2).
function srcSpan(item) {
  if (item.userStart && item.end > item.start) return Math.max(MIN_EXTRACT, item.end - item.start);
  return Math.min(item.duration, Math.max(0.6, clipLength()) * speedOf(item));
}

// Durée d’un plan dans le montage, une fois la vitesse appliquée.
function segDurFor(item) {
  if (item.kind === 'image') return clipLength();
  return Math.max(0.3, srcSpan(item) / speedOf(item));
}

// Début et fin de l’extrait d’une vidéo, en secondes de la vidéo d’origine.
function extractRange(item) {
  const d = srcSpan(item);
  const a = clamp(item.start, 0, Math.max(0, item.duration - d));
  return [a, Math.min(item.duration, a + d)];
}

// Texte d’un champ. Tant qu’aucune vidéo n’est ajoutée, l’aperçu montre un exemple grisé ;
// ensuite, un champ vide n’affiche rien, exactement comme dans la vidéo finale.
function textOf(field, forExport) {
  const v = (state[field] || '').trim();
  if (v) return { text: v, ghost: false };
  if (!forExport && !state.items.length && PLACEHOLDER[field]) return { text: PLACEHOLDER[field], ghost: true };
  return null;
}

function buildTimeline(forExport = false) {
  const S = STYLES[state.style];
  const T = TRANSITIONS[transId()];
  const F = FORMATS[state.format];
  const media = state.items.filter((i) => i.ok);
  const title = textOf('title', forExport);
  const sub = textOf('sub', forExport);
  const handle = textOf('handle', forExport);
  const endText = (state.endText || '').trim();
  const segs = [];

  const wantedTitleDur = state.titleDurs[state.style] || TITLE_DUR_DEFAULT[state.style];
  // Style Dynamique : le titre a son propre écran de couleur. Autres styles : il s’affiche sur les premières vidéos.
  if (state.style === 'dyn' && title) segs.push({ type: 'intro', dur: wantedTitleDur });
  media.forEach((item, k) => {
    const dur = segDurFor(item);
    const srcIn = item.kind === 'video' ? extractRange(item)[0] : 0;
    segs.push({ type: 'media', item, dur, srcIn, speed: speedOf(item), idx: k });
  });
  // Aperçu sans vidéo : un fond gris tient la place des vidéos, comme sur les gabarits d’affiche.
  if (!forExport && !media.length) segs.push({ type: 'blank', dur: Math.max(2.4, wantedTitleDur + 0.4), idx: 0 });
  const endDur = state.endDurs[state.style] || END_DUR_DEFAULT[state.style];
  if (state.endScreen && (endText || state.logo || handle)) segs.push({ type: 'outro', dur: endDur });
  if (!segs.length) segs.push({ type: 'blank', dur: 2.4, idx: 0 });

  segs.forEach((s, i) => {
    if (i === 0) { s.start = 0; s.transIn = null; return; }
    const prev = segs[i - 1];
    let kind;
    if (transId() !== 'glisse') kind = 'fade';
    else if (prev.type === 'intro') kind = 'uncover';
    else if (s.type === 'outro') kind = 'cover';
    else kind = DYN_TRANSITIONS[Math.max(0, s.idx - 1) % DYN_TRANSITIONS.length];
    const td = Math.min(T.dur, prev.dur * 0.45, s.dur * 0.45);
    s.transIn = { kind, dur: td };
    s.start = prev.start + prev.dur - td;
  });

  const last = segs[segs.length - 1];
  const outro = segs.find((x) => x.type === 'outro');
  const mediaEnd = outro ? outro.start : last.start + last.dur;
  return {
    segs, S, T, F, W: F.W, H: F.H,
    total: last.start + last.dur,
    filter: state.filter,
    // Le titre posé sur les vidéos s’arrête au plus tard quand commence l’écran de fin.
    titleDur: Math.min(wantedTitleDur, mediaEnd),
    style: state.style,
    color: state.color,
    title, sub, handle, endText,
    logo: state.logo,
  };
}

/* =========================================================================
   Rendu d’une image du montage (partagé par l’aperçu et l’export)
   ========================================================================= */

const layers = [];
function paintLayer(ctx, i, fn) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  let c = layers[i];
  if (!c) c = layers[i] = makeCanvas(w, h);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const lc = c.getContext('2d');
  lc.setTransform(ctx.getTransform());
  lc.save();
  fn(lc);
  lc.restore();
  return c;
}
function drawLayer(ctx, layer, alpha) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function renderFrame(ctx, tl, t, frameOf) {
  const { W, H } = tl;
  t = clamp(t, 0, tl.total - 1e-4);
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const act = tl.segs.filter((s) => t >= s.start && t < s.start + s.dur);
  if (act.length === 1) {
    drawSeg(ctx, tl, act[0], t, frameOf);
  } else if (act.length >= 2) {
    const a = act[0], b = act[1];
    const p = clamp((t - b.start) / b.transIn.dur);
    drawTransition(ctx, tl, b.transIn.kind, p, (c) => drawSeg(c, tl, a, t, frameOf), (c) => drawSeg(c, tl, b, t, frameOf));
  }
  if (tl.style === 'doux') drawTitleDoux(ctx, tl, t);
  if (tl.style === 'charte') drawTitleCharte(ctx, tl, t);
  ctx.restore();
}

function drawSeg(ctx, tl, seg, t, frameOf) {
  const lt = t - seg.start;
  ctx.save();
  if (seg.type === 'intro') drawIntroDyn(ctx, tl, lt);
  else if (seg.type === 'outro') ({ dyn: drawOutroDyn, doux: drawOutroDoux, charte: drawOutroCharte })[tl.style](ctx, tl, lt);
  else if (seg.type === 'blank') drawBlank(ctx, tl);
  else drawMediaSeg(ctx, tl, seg, lt, frameOf(seg));
  ctx.restore();
}

function drawTransition(ctx, tl, kind, p, drawA, drawB) {
  const { W, H } = tl;
  const e = easeInOutCubic(p);
  const shifted = (fn, dx, dy) => { ctx.save(); ctx.translate(dx, dy); fn(ctx); ctx.restore(); };
  switch (kind) {
    case 'fade': {
      drawA(ctx);
      drawLayer(ctx, paintLayer(ctx, 0, drawB), easeInOutCubic(p));
      break;
    }
    case 'whip':
    case 'whipR': {
      const dir = kind === 'whip' ? 1 : -1;
      shifted(drawA, -dir * e * W, 0);
      shifted(drawB, dir * (1 - e) * W, 0);
      break;
    }
    case 'push': {
      shifted(drawA, 0, -e * H);
      shifted(drawB, 0, (1 - e) * H);
      break;
    }
    case 'zoom': {
      const zoomed = (fn, s) => { ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2); fn(ctx); ctx.restore(); };
      if (p < 0.5) zoomed(drawA, 1 + easeInCubic(p * 2) * 0.35);
      else zoomed(drawB, 1.25 - easeOutCubic((p - 0.5) * 2) * 0.25);
      const flash = Math.max(0, 1 - Math.abs(p - 0.5) * 3.2);
      if (flash > 0) {
        ctx.save();
        ctx.globalAlpha = flash * 0.85;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      break;
    }
    case 'uncover': {
      drawB(ctx);
      shifted(drawA, 0, -e * H);
      break;
    }
    case 'cover': {
      drawA(ctx);
      shifted(drawB, 0, (1 - e) * H);
      break;
    }
    default:
      drawB(ctx);
  }
}

/* ---------- Images et vidéos ---------- */

let blurSmall = null, blurMid = null;
function drawBlurredBackground(ctx, fr, W, H) {
  const sw = 27, sh = Math.round(27 * H / W);
  if (!blurSmall || blurSmall.height !== sh) { blurSmall = makeCanvas(sw, sh); blurMid = makeCanvas(sw * 4, sh * 4); }
  const sc = blurSmall.getContext('2d');
  const s = Math.max(sw / fr.w, sh / fr.h);
  sc.imageSmoothingEnabled = true;
  sc.imageSmoothingQuality = 'medium';
  sc.drawImage(fr.src, (sw - fr.w * s) / 2, (sh - fr.h * s) / 2, fr.w * s, fr.h * s);
  const mc = blurMid.getContext('2d');
  mc.imageSmoothingEnabled = true;
  mc.imageSmoothingQuality = 'low';
  mc.drawImage(blurSmall, 0, 0, blurMid.width, blurMid.height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(blurMid, -W * 0.06, -H * 0.06, W * 1.12, H * 1.12);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function usesContain(item, W, H) {
  return !item.crop && state.landscape === 'blur' && (item.w / item.h) > (W / H) * 1.35;
}

// Cadrage choisi à la main : item.crop = { x, y, z }, centre du cadre (de 0 à 1 dans l’image d’origine)
// et zoom (1 = le plus grand cadre au format de la vidéo qui tienne dans l’image).
// Renvoie la zone de l’image à afficher, en pixels d’une image de taille iw × ih.
function cropRect(crop, iw, ih, aspect) {
  let bw, bh;
  if (iw / ih > aspect) { bh = ih; bw = ih * aspect; } else { bw = iw; bh = iw / aspect; }
  const sw = bw / crop.z, sh = bh / crop.z;
  const sx = clamp(crop.x * iw - sw / 2, 0, iw - sw);
  const sy = clamp(crop.y * ih - sh / 2, 0, ih - sh);
  return { sx, sy, sw, sh };
}

// Ramène le centre du cadre là où le cadre tient entièrement dans l’image.
function clampCrop(item) {
  const F = FORMATS[state.format];
  const r = cropRect(item.crop, item.w, item.h, F.W / F.H);
  item.crop.x = (r.sx + r.sw / 2) / item.w;
  item.crop.y = (r.sy + r.sh / 2) / item.h;
}

function fillBlend(ctx, W, H, op, color, alpha) {
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function vignette(ctx, W, H, strength) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function applyFilter(ctx, W, H, id) {
  switch (id) {
    case 'nb':
      fillBlend(ctx, W, H, 'saturation', '#808080', 1);
      fillBlend(ctx, W, H, 'soft-light', '#000000', 0.3);
      vignette(ctx, W, H, 0.3);
      break;
    case 'retro':
      // Pellicule délavée : couleurs ternies, noirs levés et bruns, coins assombris.
      fillBlend(ctx, W, H, 'saturation', '#808080', 0.55);
      fillBlend(ctx, W, H, 'multiply', '#EBCB95', 0.6);
      fillBlend(ctx, W, H, 'lighten', '#5A4332', 0.85);
      vignette(ctx, W, H, 0.35);
      break;
    case 'cinema':
      // Ombres bleu-vert, lumières orangées, contraste et vignettage.
      fillBlend(ctx, W, H, 'saturation', '#808080', 0.3);
      fillBlend(ctx, W, H, 'soft-light', '#004E66', 0.5);
      fillBlend(ctx, W, H, 'soft-light', '#FFB066', 0.3);
      vignette(ctx, W, H, 0.45);
      break;
    case 'chaud':
      fillBlend(ctx, W, H, 'soft-light', '#FF8A2B', 0.45);
      fillBlend(ctx, W, H, 'multiply', '#FFE7C2', 0.35);
      break;
    case 'froid':
      fillBlend(ctx, W, H, 'soft-light', '#2F7BD0', 0.45);
      fillBlend(ctx, W, H, 'multiply', '#E2EEFF', 0.35);
      break;
    default:
  }
}

function drawMediaSeg(ctx, tl, seg, lt, fr) {
  const { W, H } = tl;
  const item = seg.item;
  const p = clamp(lt / seg.dur);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  if (fr) {
    const isImage = item.kind === 'image';
    const zoom = 1 + tl.T.kb * (isImage ? 1.8 : 1) * (isImage ? p : easeOutCubic(p));
    if (item.crop) {
      // Cadre choisi à la main, avec le même léger zoom progressif que les autres plans.
      const r = cropRect(item.crop, fr.w, fr.h, W / H);
      const sw = r.sw / zoom, sh = r.sh / zoom;
      ctx.drawImage(fr.src, r.sx + (r.sw - sw) / 2, r.sy + (r.sh - sh) / 2, sw, sh, 0, 0, W, H);
    } else if (usesContain(item, W, H)) {
      drawBlurredBackground(ctx, fr, W, H);
      const s = Math.min(W / fr.w, H / fr.h) * zoom;
      const dw = fr.w * s, dh = fr.h * s;
      ctx.drawImage(fr.src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      const s = Math.max(W / fr.w, H / fr.h) * zoom;
      const dw = fr.w * s, dh = fr.h * s;
      let panX = 0;
      if (isImage) {
        const dir = hash(item.id) > 0.5 ? 1 : -1;
        panX = dir * (p - 0.5) * 0.8;
      }
      ctx.drawImage(fr.src, (W - dw) / 2 + panX * (dw - W) / 2, (H - dh) / 2, dw, dh);
    }
    if (tl.filter !== 'none') applyFilter(ctx, W, H, tl.filter);
  }
  if (item.caption && item.caption.trim()) {
    if (tl.style === 'dyn') drawCaptionDyn(ctx, tl, item.caption.trim(), lt);
    else {
      const delay = tl.title && seg.start < tl.titleDur ? tl.titleDur - seg.start : 0.3;
      (tl.style === 'doux' ? drawCaptionDoux : drawCaptionCharte)(ctx, tl, item.caption.trim(), lt, seg.dur, delay);
    }
  }
}

/* ---------- Style « Dynamique » ---------- */

function drawStripes(ctx, W, H, color, lt) {
  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.strokeStyle = color;
  ctx.lineWidth = 34;
  const gap = 120;
  const off = (lt * 90) % gap;
  ctx.beginPath();
  for (let x = -H + off; x < W + gap; x += gap) {
    ctx.moveTo(x, H);
    ctx.lineTo(x + H * 0.55, 0);
  }
  ctx.stroke();
  ctx.restore();
}

function drawIntroDyn(ctx, tl, lt) {
  const { W, H, F } = tl;
  const acc = tl.color, on = onAccent(acc);
  ctx.fillStyle = acc;
  ctx.fillRect(0, 0, W, H);
  drawStripes(ctx, W, H, on, lt);
  if (!tl.title) return;

  const ghost = tl.title.ghost ? 0.5 : 1;
  const x0 = 90;
  const fit = fitText(ctx, tl.title.text.toUpperCase(), { family: FONT.impact, maxW: W - 2 * x0, maxLines: 4, max: 250, min: 96 });
  const lh = fit.size * 1.0;
  const pillH = tl.sub ? 92 : 0;
  const blockH = fit.lines.length * lh + (pillH ? 44 + pillH : 0);
  const top = Math.max(F.safeTop + 20, (H - blockH) / 2 - 30);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  // Le titre est entier dès la première image (c’est elle qu’Instagram montre en vignette),
  // puis chaque ligne se pose en rétrécissant légèrement.
  fit.lines.forEach((line, i) => {
    const q = clamp((lt - i * 0.06) / 0.45);
    const s = 1 + (1 - easeOutBack(q)) * 0.12;
    const cx = x0 + fit.widths[i] / 2;
    const cy = top + i * lh + lh * 0.5;
    ctx.save();
    ctx.globalAlpha = ghost;
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.font = fit.font;
    ctx.fillStyle = on;
    ctx.fillText(line, 0, fit.size * 0.42);
    ctx.restore();
  });

  if (tl.sub) {
    const q = clamp((lt - 0.1) / 0.45);
    {
      const e = easeOutCubic(q);
      const subFit = fitText(ctx, tl.sub.text.toUpperCase(), { family: FONT.impact, maxW: W - 2 * x0 - 64, maxLines: 1, max: 54, min: 32 });
      const pw = subFit.widths[0] + 64;
      const py = top + fit.lines.length * lh + 44 + (1 - e) * 24;
      ctx.save();
      ctx.globalAlpha = tl.sub.ghost ? 0.5 : 1;
      ctx.fillStyle = on;
      roundRect(ctx, x0, py, pw, pillH, pillH / 2);
      ctx.fill();
      ctx.fillStyle = acc;
      ctx.font = subFit.font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(subFit.lines[0], x0 + 32, py + pillH / 2 + 2);
      ctx.restore();
    }
  }
}

function drawCaptionDyn(ctx, tl, text, lt) {
  const { W, H, F } = tl;
  const a = clamp((lt - 0.12) / 0.35);
  if (a <= 0) return;
  const e = easeOutCubic(a);
  const acc = tl.color, on = onAccent(acc);
  const fit = fitText(ctx, text.toUpperCase(), { family: FONT.impact, maxW: W - 240, maxLines: 2, max: 84, min: 52 });
  const lh = fit.size * 1.1;
  const padX = 30, padY = 18;
  const boxW = Math.max(...fit.widths) + padX * 2;
  const boxH = fit.lines.length * lh + padY * 2;
  const x = 70, y = H - F.safeBottom - boxH - 20;
  ctx.save();
  ctx.translate(x - (1 - e) * (boxW + 140), y);
  ctx.rotate(-0.035);
  ctx.fillStyle = acc;
  ctx.fillRect(0, 0, boxW, boxH);
  ctx.fillStyle = on;
  ctx.font = fit.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  fit.lines.forEach((l, i) => ctx.fillText(l, padX, padY + i * lh + fit.size * 0.92));
  ctx.restore();
}

function drawLogoCard(ctx, logo, cx, cy, maxW, maxH, scale, alpha) {
  const s = Math.min(maxW / logo.naturalWidth, maxH / logo.naturalHeight);
  const lw = logo.naturalWidth * s, lh = logo.naturalHeight * s;
  const pad = 40;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, -lw / 2 - pad, -lh / 2 - pad, lw + pad * 2, lh + pad * 2, 36);
  ctx.fill();
  ctx.drawImage(logo, -lw / 2, -lh / 2, lw, lh);
  ctx.restore();
  return lh + pad * 2;
}

function drawOutroDyn(ctx, tl, lt) {
  const { W, H, F } = tl;
  const acc = tl.color, on = onAccent(acc);
  ctx.fillStyle = acc;
  ctx.fillRect(0, 0, W, H);
  drawStripes(ctx, W, H, on, lt);

  const zoneTop = F.safeTop + 20, zoneBottom = H - F.safeBottom - 20;
  const parts = [];
  const logoMaxH = tl.H > 1500 ? 300 : 220;
  if (tl.logo) parts.push({ kind: 'logo', h: logoMaxH + 80 });
  let fit = null;
  if (tl.endText) {
    fit = fitText(ctx, tl.endText.toUpperCase(), { family: FONT.impact, maxW: W - 180, maxLines: 3, max: 150, min: 76 });
    parts.push({ kind: 'text', h: fit.lines.length * fit.size * 1.02 });
  }
  if (tl.handle) parts.push({ kind: 'handle', h: 92 });
  const gap = 56;
  const total = parts.reduce((s, p) => s + p.h, 0) + gap * Math.max(0, parts.length - 1);
  let y = Math.max(zoneTop, (zoneTop + zoneBottom) / 2 - total / 2);

  for (const part of parts) {
    if (part.kind === 'logo') {
      const q = clamp((lt - 0.2) / 0.5);
      if (q > 0) drawLogoCard(ctx, tl.logo, W / 2, y + part.h / 2, W - 360, logoMaxH, 0.6 + 0.4 * easeOutBack(q), clamp(q * 3));
    } else if (part.kind === 'text') {
      ctx.save();
      ctx.font = fit.font;
      ctx.fillStyle = on;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      fit.lines.forEach((l, i) => {
        const q = clamp((lt - 0.35 - i * 0.1) / 0.4);
        if (q <= 0) return;
        ctx.globalAlpha = clamp(q * 2);
        ctx.fillText(l, W / 2, y + (i + 0.88) * fit.size * 1.02 + (1 - easeOutCubic(q)) * 60);
      });
      ctx.restore();
    } else {
      const q = clamp((lt - 0.75) / 0.4);
      if (q > 0) {
        const hf = fitText(ctx, tl.handle.text, { family: FONT.impact, maxW: W - 260, maxLines: 1, max: 54, min: 32 });
        const pw = hf.widths[0] + 70, ph = 92;
        ctx.save();
        ctx.globalAlpha = easeOutCubic(q) * (tl.handle.ghost ? 0.5 : 1);
        ctx.fillStyle = on;
        roundRect(ctx, (W - pw) / 2, y, pw, ph, ph / 2);
        ctx.fill();
        ctx.fillStyle = acc;
        ctx.font = hf.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(hf.lines[0], W / 2, y + ph / 2 + 2);
        ctx.restore();
      }
    }
    y += part.h + gap;
  }
}

/* ---------- Style « Doux » ---------- */

function drawTitleDoux(ctx, tl, t) {
  if (!tl.title) return;
  const D = tl.titleDur;
  if (t >= D) return;
  const { W, H } = tl;
  const out = clamp((D - t) / 0.6);
  const ghost = tl.title.ghost ? 0.5 : 1;

  ctx.save();
  ctx.globalAlpha = out * 0.42;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const fit = fitText(ctx, tl.title.text, { family: FONT.serif, weight: '600', style: 'italic', maxW: W - 180, maxLines: 4, max: 132, min: 72 });
  const lh = fit.size * 1.14;
  const subH = tl.sub ? 110 : 0;
  const top = H / 2 - (fit.lines.length * lh + subH) / 2;

  ctx.save();
  ctx.font = fit.font;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 30;
  fit.lines.forEach((l, i) => {
    // Visible dès la première image (vignette Instagram), avec une légère montée vers sa place.
    const e = easeOutCubic(clamp((t - i * 0.1) / 0.9));
    ctx.globalAlpha = out * ghost;
    ctx.fillText(l, W / 2, top + (i + 0.85) * lh + (1 - e) * 18);
  });
  ctx.restore();

  if (tl.sub) {
    const q = clamp((t - 0.1) / 0.9);
    {
      const e = 0.35 + 0.65 * easeOutCubic(q);
      const y = top + fit.lines.length * lh + 30;
      ctx.save();
      ctx.globalAlpha = out * (tl.sub.ghost ? 0.5 : 1);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 80 * e, y);
      ctx.lineTo(W / 2 + 80 * e, y);
      ctx.stroke();
      const sf = fitText(ctx, tl.sub.text, { family: FONT.serif, weight: '600', maxW: W - 200, maxLines: 1, max: 50, min: 30 });
      ctx.font = sf.font;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = out * (tl.sub.ghost ? 0.5 : 1);
      ctx.fillText(sf.lines[0], W / 2, y + 74);
      ctx.restore();
    }
  }
}

function drawCaptionDoux(ctx, tl, text, lt, dur, delay) {
  const { W, H, F } = tl;
  const a = clamp((lt - delay) / 0.6) * clamp((dur - lt) / 0.5);
  if (a <= 0) return;
  const fit = fitText(ctx, text, { family: FONT.serif, weight: '600', style: 'italic', maxW: W - 200, maxLines: 2, max: 76, min: 48 });
  const lh = fit.size * 1.15;
  const bottom = H - F.safeBottom - 30;
  ctx.save();
  const g = ctx.createLinearGradient(0, bottom - fit.lines.length * lh - 160, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.globalAlpha = a;
  ctx.fillStyle = g;
  ctx.fillRect(0, bottom - fit.lines.length * lh - 160, W, H);
  ctx.font = fit.font;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 24;
  fit.lines.forEach((l, i) => ctx.fillText(l, W / 2, bottom - (fit.lines.length - 1 - i) * lh));
  ctx.restore();
}

function drawOutroDoux(ctx, tl, lt) {
  const { W, H, F } = tl;
  const bg = mix(tl.color, '#FFFFFF', 0.88);
  const ink = '#1C1D2B';
  const accInk = readableAccent(tl.color);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const zoneTop = F.safeTop + 20, zoneBottom = H - F.safeBottom - 20;
  const parts = [];
  const logoMaxH = tl.H > 1500 ? 320 : 230;
  if (tl.logo) parts.push({ kind: 'logo', h: logoMaxH });
  let fit = null;
  if (tl.endText) {
    fit = fitText(ctx, tl.endText, { family: FONT.serif, weight: '600', style: 'italic', maxW: W - 200, maxLines: 3, max: 118, min: 66 });
    parts.push({ kind: 'text', h: fit.lines.length * fit.size * 1.16 });
  }
  if (tl.handle) parts.push({ kind: 'handle', h: 70 });
  const gap = 60;
  const total = parts.reduce((s, p) => s + p.h, 0) + gap * Math.max(0, parts.length - 1);
  let y = Math.max(zoneTop, (zoneTop + zoneBottom) / 2 - total / 2);

  for (const part of parts) {
    if (part.kind === 'logo') {
      const q = easeOutCubic(clamp((lt - 0.3) / 0.9));
      const logo = tl.logo;
      const s = Math.min((W - 360) / logo.naturalWidth, logoMaxH / logo.naturalHeight) * (0.96 + 0.04 * q);
      const lw = logo.naturalWidth * s, lh = logo.naturalHeight * s;
      ctx.save();
      ctx.globalAlpha = q;
      ctx.drawImage(logo, (W - lw) / 2, y + (part.h - lh) / 2, lw, lh);
      ctx.restore();
    } else if (part.kind === 'text') {
      ctx.save();
      ctx.font = fit.font;
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      fit.lines.forEach((l, i) => {
        const q = clamp((lt - 0.5 - i * 0.15) / 0.8);
        if (q <= 0) return;
        const e = easeOutCubic(q);
        ctx.globalAlpha = e;
        ctx.fillText(l, W / 2, y + (i + 0.85) * fit.size * 1.16 + (1 - e) * 24);
      });
      ctx.restore();
    } else {
      const q = easeOutCubic(clamp((lt - 1.0) / 0.7));
      ctx.save();
      ctx.globalAlpha = q * (tl.handle.ghost ? 0.5 : 1);
      ctx.strokeStyle = accInk;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 60, y);
      ctx.lineTo(W / 2 + 60, y);
      ctx.stroke();
      const hf = fitText(ctx, tl.handle.text, { family: FONT.serif, weight: '600', maxW: W - 200, maxLines: 1, max: 48, min: 30 });
      ctx.font = hf.font;
      ctx.fillStyle = accInk;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(hf.lines[0], W / 2, y + 64);
      ctx.restore();
    }
    y += part.h + gap;
  }
}

/* ---------- Style « Médiathèque » : la charte en mouvement ---------- */

// Position x qui fait commencer le dessin des lettres exactement à x0 (sans l’approche de la police).
function inkX(ctx, text, x0) {
  const m = ctx.measureText(text);
  return x0 + (m.actualBoundingBoxLeft || 0);
}

// Marge gauche des textes et haut du titre dans le style Médiathèque (sous le nom du compte en story).
function charteLayout(tl) {
  return { x: Math.round(tl.W * 0.09), top: tl.F.safeTop + 70 };
}

// Sous-titre en colonne, comme la date sur les affiches : « XX / Mois / Année ».
function dateLines(text) {
  // Seulement pour une vraie date (« Samedi 18 janvier 2025 ») ; tout autre sous-titre garde son texte.
  const MOIS = 'janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre';
  const m = text.match(new RegExp(`^((?:.*\\s)?)(\\d{1,2}(?:er)?)\\s+(${MOIS})\\.?\\s*(\\d{4})?\\s*[,;–-]?\\s*(.*)$`, 'i'));
  if (!m) return null;
  const lines = [(m[1].trim() ? m[1].trim() + ' ' : '') + m[2], m[3]];
  if (m[4]) lines.push(m[4]);
  if (m[5] && m[5].trim()) lines.push(m[5].trim());
  if (lines.length > 3) lines.splice(2, lines.length - 2, lines.slice(2).join(' '));
  return lines;
}

function drawTitleCharte(ctx, tl, t) {
  if (!tl.title) return;
  const D = tl.titleDur;
  if (t >= D) return;
  const { W, H } = tl;
  const out = clamp((D - t) / 0.6);
  const L = charteLayout(tl);
  const x0 = L.x;

  ctx.save();
  ctx.globalAlpha = out;
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.8);
  ctx.restore();

  const ghost = tl.title.ghost ? 0.5 : 1;
  const fit = fitText(ctx, tl.title.text, { family: FONT.charteTitle, weight: '400', maxW: W - x0 - 60, maxLines: 3, max: 176, min: 84 });
  const lh = fit.size * 0.98;
  const firstBase = L.top + fit.size * 0.78;

  ctx.save();
  ctx.font = fit.font;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 18;
  fit.lines.forEach((l, i) => {
    // Visible dès la première image (vignette Instagram), avec un léger glissement vers sa place.
    const e = easeOutCubic(clamp((t - i * 0.08) / 0.7));
    ctx.globalAlpha = out * ghost;
    ctx.fillText(l, inkX(ctx, l, x0) - (1 - e) * 28, firstBase + i * lh);
  });
  ctx.restore();

  if (!tl.sub) return;
  const lastBase = firstBase + (fit.lines.length - 1) * lh;
  const dsize = Math.max(34, Math.round(fit.size * 0.3));
  ctx.save();
  ctx.font = `400 ${dsize}px ${FONT.charteText}`;
  let lines = dateLines(tl.sub.text);
  if (!lines) lines = wrapWords(ctx, tl.sub.text, W * 0.36).slice(0, 3);
  const dW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const dLH = dsize * 1.12;
  let dx = x0 + fit.widths[fit.lines.length - 1] + fit.size * 0.22;
  let dTop = lastBase - fit.size * 0.7;
  if (dx + dW > W - 50) { dx = x0; dTop = lastBase + fit.size * 0.35; }
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 12;
  lines.forEach((l, i) => {
    const e = easeOutCubic(clamp((t - 0.15 - i * 0.08) / 0.6));
    ctx.globalAlpha = out * (tl.sub.ghost ? 0.5 : 1);
    ctx.fillText(l, dx + (1 - e) * 16, dTop + dsize * 0.8 + i * dLH);
  });
  ctx.restore();
}

function drawCaptionCharte(ctx, tl, text, lt, dur, delay) {
  const { W, H, F } = tl;
  const a = clamp((lt - delay) / 0.5) * clamp((dur - lt) / 0.4);
  if (a <= 0) return;
  const x0 = charteLayout(tl).x;
  const fit = fitText(ctx, text, { family: FONT.charteTitle, weight: '400', maxW: W - x0 - 60, maxLines: 2, max: 96, min: 58 });
  const lh = fit.size * 1.0;
  const bottom = H - F.safeBottom - 30;
  const top = bottom - (fit.lines.length - 1) * lh - fit.size * 0.75;
  ctx.save();
  ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(0, top - 200, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, top - 200, W, H);
  ctx.font = fit.font;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 16;
  fit.lines.forEach((l, i) => ctx.fillText(l, inkX(ctx, l, x0), bottom - (fit.lines.length - 1 - i) * lh));
  ctx.restore();
}

// Écran de fin du style Médiathèque : fond blanc, logo, message et compte, sans décor.
function drawOutroCharte(ctx, tl, lt) {
  const { W, H, F } = tl;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  const zoneTop = F.safeTop + 20, zoneBottom = H - F.safeBottom - 20;
  const parts = [];
  const logoMaxH = tl.H > 1500 ? 260 : 200;
  if (tl.logo) parts.push({ kind: 'logo', h: logoMaxH });
  let fit = null;
  if (tl.endText) {
    fit = fitText(ctx, tl.endText, { family: FONT.charteTitle, weight: '400', maxW: W - 200, maxLines: 3, max: 132, min: 72 });
    parts.push({ kind: 'text', h: fit.lines.length * fit.size });
  }
  if (tl.handle) parts.push({ kind: 'handle', h: 60 });
  const gap = 64;
  const total = parts.reduce((s, p) => s + p.h, 0) + gap * Math.max(0, parts.length - 1);
  let y = Math.max(zoneTop, (zoneTop + zoneBottom) / 2 - total / 2);
  for (const part of parts) {
    if (part.kind === 'logo') {
      const q = easeOutCubic(clamp((lt - 0.2) / 0.8));
      const logo = tl.logo;
      // Pas plus de deux fois sa taille d’origine, pour rester net.
      const k = Math.min((W - 360) / logo.naturalWidth, logoMaxH / logo.naturalHeight, 2) * (0.95 + 0.05 * q);
      const lw = logo.naturalWidth * k, lh = logo.naturalHeight * k;
      ctx.save();
      ctx.globalAlpha = q;
      ctx.drawImage(logo, (W - lw) / 2, y + (part.h - lh) / 2, lw, lh);
      ctx.restore();
    } else if (part.kind === 'text') {
      ctx.save();
      ctx.font = fit.font;
      ctx.fillStyle = CHARTE.petrole;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      fit.lines.forEach((l, i) => {
        const q = clamp((lt - 0.45 - i * 0.14) / 0.7);
        if (q <= 0) return;
        const e = easeOutCubic(q);
        ctx.globalAlpha = e;
        ctx.fillText(l, W / 2, y + (i + 0.8) * fit.size + (1 - e) * 24);
      });
      ctx.restore();
    } else {
      const q = easeOutCubic(clamp((lt - 0.9) / 0.6));
      const hf = fitText(ctx, tl.handle.text, { family: FONT.charteText, weight: '400', maxW: W - 200, maxLines: 1, max: 50, min: 30 });
      ctx.save();
      ctx.globalAlpha = q * (tl.handle.ghost ? 0.5 : 1);
      ctx.font = hf.font;
      ctx.fillStyle = CHARTE.anthracite;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(hf.lines[0], W / 2, y + 44);
      ctx.restore();
    }
    y += part.h + gap;
  }
}

function drawBlank(ctx, tl) {
  const { W, H } = tl;
  ctx.fillStyle = CHARTE.gris;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `400 46px ${FONT.charteText}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Vos vidéos ou photos ici', W / 2, H * 0.72);
  ctx.restore();
}

/* ---------- Repères des zones Instagram (aperçu seulement) ---------- */

function drawSafeZones(ctx, tl) {
  const { W, H, F } = tl;
  if (state.format !== 'story') return;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 40, 90, 0.22)';
  ctx.fillRect(0, 0, W, F.safeTop);
  ctx.fillRect(0, H - F.safeBottom, W, F.safeBottom);
  ctx.setLineDash([24, 18]);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, F.safeTop); ctx.lineTo(W, F.safeTop);
  ctx.moveTo(0, H - F.safeBottom); ctx.lineTo(W, H - F.safeBottom);
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 40px ${FONT.sans}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Nom du compte', W / 2, F.safeTop / 2 + 20);
  ctx.fillText('Barre de réponse', W / 2, H - F.safeBottom / 2);
  ctx.restore();
}

/* =========================================================================
   Import et analyse des fichiers
   ========================================================================= */

let nextId = 1;
const queue = [];
let queueRunning = null;

const HEVC_HELP = 'Ce navigateur ne sait pas lire cette vidéo (souvent une vidéo d’iPhone au format HEVC). Essayez avec Safari, ou réglez l’iPhone sur Réglages › Appareil photo › Formats › « Le plus compatible ».';

function isVideoFile(f) { return f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|3gp)$/i.test(f.name); }
function isImageFile(f) { return f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(f.name); }

// Ajoute un fichier à la liste. meta : réglages du plan, quand il est repris après un rechargement.
function addItem(file, meta) {
  const kind = meta ? meta.kind : (isVideoFile(file) ? 'video' : 'image');
  const id = meta ? meta.id : nextId;
  nextId = Math.max(nextId, id + 1);
  const item = {
    id, kind, file, name: meta ? meta.name : file.name,
    caption: '', start: 0, userStart: false, ok: false, status: 'loading', progress: 0,
  };
  if (meta) {
    item.fileRef = meta.ref || null;
    item.caption = meta.caption || '';
    item.speed = meta.speed || 1;
    item.crop = meta.crop || null;
    if (meta.userStart && meta.end > meta.start) {
      item.userStart = true;
      item.start = meta.start;
      item.end = meta.end;
    }
    if (Array.isArray(meta.samples)) {
      item.restoredSamples = meta.samples.map(([t, lum, sharp, motion]) => ({ t, lum, sharp, motion }));
    }
  } else {
    storeFile(String(id), file);
  }
  state.items.push(item);
  queue.push(item);
  return item;
}

function markDirty() {
  if (state.dirty) return;
  state.dirty = true;
  updateProjectBar();
  saveSettings();
}

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  let added = 0;
  for (const file of files) {
    if (!isVideoFile(file) && !isImageFile(file)) { toast(`« ${file.name} » n’est ni une vidéo ni une photo.`); continue; }
    addItem(file);
    added++;
  }
  if (!added) return;
  renderClipList();
  rebuild();
  restartPreview();
  // Une fois les nouveaux fichiers analysés (meilleurs passages trouvés), l’aperçu repart du début.
  runQueue().then(restartPreview);
}

function runQueue() {
  if (queueRunning) return queueRunning;
  queueRunning = (async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item.removed) continue;
      if (item.kind === 'video') {
        await probeVideo(item);
        if (item.ok && !item.removed) {
          if (item.restoredSamples) finishAnalysis(item, item.restoredSamples);
          else await analyzeVideo(item);
        }
      } else {
        await loadImage(item);
      }
    }
    queueRunning = null;
  })();
  return queueRunning;
}

async function probeVideo(item) {
  try {
    const input = new MB.Input({ source: new MB.BlobSource(item.file), formats: MB.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new UserError('Ce fichier ne contient pas d’image vidéo.');
    if (!(await vt.canDecode())) throw new UserError(HEVC_HELP);
    item.input = input;
    item.vt = vt;
    item.w = await vt.getDisplayWidth();
    item.h = await vt.getDisplayHeight();
    item.t0 = await vt.getFirstTimestamp();
    const end = await vt.computeDuration();
    item.duration = Math.max(0.1, end - item.t0);
    const at = await input.getPrimaryAudioTrack();
    item.at = at && (await at.canDecode()) ? at : null;

    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.src = URL.createObjectURL(item.file);
    v.addEventListener('loadeddata', requestDraw);
    v.addEventListener('seeked', requestDraw);
    $('video-bin').append(v);
    item.el = v;

    if (!item.userStart) item.start = Math.min(item.duration * 0.3, Math.max(0, item.duration - srcSpan(item)));
    item.ok = true;
    item.status = 'analyzing';
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    item.ok = false;
    item.status = 'error';
    item.error = e instanceof UserError ? e.message : 'Ce fichier n’a pas pu être lu. Vérifiez qu’il s’agit bien d’une vidéo.';
  }
  updateRow(item);
  rebuild();
}

async function analyzeVideo(item) {
  const N = 48;
  const work = makeCanvas(N, N);
  const wctx = work.getContext('2d', { willReadFrequently: true });
  const samples = [];
  try {
    const times = await analysisTimes(item);
    const sink = new MB.CanvasSink(item.vt, { width: N, height: N, fit: 'fill', poolSize: 1 });
    let prev = null;
    let k = 0;
    for await (const wc of sink.canvasesAtTimestamps(times.map((t) => item.t0 + t))) {
      const t = times[k++];
      if (item.removed) return;
      if (!wc) continue;
      wctx.drawImage(wc.canvas, 0, 0, N, N);
      const d = wctx.getImageData(0, 0, N, N).data;
      const g = new Float32Array(N * N);
      let lum = 0;
      for (let i = 0; i < N * N; i++) {
        g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        lum += g[i];
      }
      let sharp = 0, motion = 0;
      for (let y = 0; y < N - 1; y++) {
        for (let x = 0; x < N - 1; x++) {
          const i = y * N + x;
          sharp += Math.abs(g[i + 1] - g[i]) + Math.abs(g[i + N] - g[i]);
        }
      }
      if (prev) for (let i = 0; i < N * N; i++) motion += Math.abs(g[i] - prev[i]);
      samples.push({ t, lum: lum / (N * N * 255), sharp, motion: prev ? motion / (N * N) : null });
      prev = g;
      if (k % 8 === 0) {
        item.progress = k / times.length;
        updateRowStatus(item);
      }
    }
  } catch (e) {
    console.warn('Analyse impossible, passage choisi par défaut', e);
  }
  finishAnalysis(item, samples);
}

function finishAnalysis(item, samples) {
  item.samples = samples;
  item.status = 'ready';
  if (!item.userStart) item.start = bestStart(item, srcSpan(item));
  updateRow(item);
  scheduleThumb(item);
  rebuild();
}

// Instants à examiner. Pour les vidéos longues, on ne lit que les images clés (bien plus rapide).
async function analysisTimes(item) {
  const first = Math.min(0.3, item.duration * 0.1);
  if (item.duration > 20) {
    try {
      const ps = new MB.EncodedPacketSink(item.vt);
      const keys = [];
      let last = -Infinity;
      let pk = await ps.getFirstKeyPacket({ metadataOnly: true });
      while (pk && keys.length < 400) {
        const rel = pk.timestamp - item.t0;
        if (rel >= first && rel < item.duration - 0.05 && rel - last >= 0.45) { keys.push(rel); last = rel; }
        pk = await ps.getNextKeyPacket(pk, { metadataOnly: true });
      }
      if (keys.length >= item.duration / 4) return keys;
    } catch (e) { /* on retombe sur un échantillonnage régulier */ }
  }
  const step = item.duration > 60 ? 0.5 : 0.25;
  const times = [];
  for (let t = first; t < item.duration - 0.05; t += step) times.push(t);
  return times;
}

// Choisit le passage le plus net et le plus animé, en évitant le noir et les mouvements brusques.
function bestStart(item, L) {
  const maxStart = Math.max(0, item.duration - L);
  if (maxStart <= 0.05) return 0;
  const s = item.samples;
  if (!s || s.length < 3) return Math.round(Math.min(maxStart, item.duration * 0.3) * 10) / 10;
  const maxSharp = Math.max(...s.map((x) => x.sharp)) || 1;
  const maxMotion = Math.max(...s.map((x) => x.motion || 0)) || 1;
  const score = s.map((x) => {
    const sh = x.sharp / maxSharp;
    const m = x.motion === null ? 0.3 : x.motion / maxMotion;
    const mScore = m <= 0.6 ? m / 0.6 : 1 - (m - 0.6) * 1.5;
    const dark = x.lum < 0.12 ? 0.6 : 0;
    return 0.55 * sh + 0.45 * mScore - dark;
  });
  let best = 0, bestScore = -Infinity, bestLead = Infinity;
  for (let a = 0; a <= maxStart + 1e-6; a += 0.25) {
    let sum = 0, n = 0, firstT = null;
    for (let i = 0; i < s.length; i++) {
      if (s[i].t >= a && s[i].t <= a + L) { sum += score[i]; n++; if (firstT === null) firstT = s[i].t; }
    }
    if (!n) continue;
    const sc = sum / n;
    // À score égal, on préfère commencer juste avant une image examinée (utile quand l’échantillonnage est espacé).
    const lead = firstT - a;
    if (sc > bestScore + 1e-6 || (Math.abs(sc - bestScore) <= 1e-6 && lead < bestLead)) {
      bestScore = sc; best = a; bestLead = lead;
    }
  }
  return Math.round(Math.min(best, maxStart) * 10) / 10;
}

async function loadImage(item) {
  try {
    const bmp = await createImageBitmap(item.file);
    const s = Math.min(1, 2160 / Math.max(bmp.width, bmp.height));
    if (s < 1) {
      const c = makeCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
      const cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(bmp, 0, 0, c.width, c.height);
      item.bitmap = await createImageBitmap(c);
      bmp.close();
    } else {
      item.bitmap = bmp;
    }
    item.w = item.bitmap.width;
    item.h = item.bitmap.height;
    item.duration = Infinity;
    item.ok = true;
    item.status = 'ready';
  } catch (e) {
    console.error(e);
    item.ok = false;
    item.status = 'error';
    item.error = /\.(heic|heif)$/i.test(item.name)
      ? 'Les photos HEIC ne sont pas lues par ce navigateur. Exportez-la en JPEG, ou utilisez Safari.'
      : 'Cette image n’a pas pu être lue.';
  }
  updateRow(item);
  scheduleThumb(item);
  rebuild();
}

function removeItem(item) {
  item.removed = true;
  forgetFile(String(item.id));
  if (item.el) { item.el.pause(); URL.revokeObjectURL(item.el.src); item.el.remove(); }
  if (item.bitmap && item.bitmap.close) item.bitmap.close();
  state.items = state.items.filter((i) => i !== item);
  if (item.row) item.row.remove();
  renderClipList();
  rebuild();
}

/* =========================================================================
   Liste des plans
   ========================================================================= */

const ICONS = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
};

// Règle le début ou la fin de l’extrait d’une vidéo (en secondes de la vidéo d’origine).
// Les deux bornes ne se croisent pas : l’extrait dure au moins MIN_EXTRACT.
function setExtract(item, which, value) {
  const [a0, b0] = extractRange(item);
  let a = which === 'start' ? value : a0;
  let b = which === 'end' ? value : b0;
  if (which === 'start') a = Math.min(a, b - MIN_EXTRACT);
  else b = Math.max(b, a + MIN_EXTRACT);
  a = clamp(a, 0, item.duration - MIN_EXTRACT);
  b = clamp(b, a + MIN_EXTRACT, item.duration);
  item.start = Math.round(a * 10) / 10;
  item.end = Math.round(b * 10) / 10;
  item.userStart = true;
  updateRow(item);
  rebuild();
  scheduleThumb(item);
}

function setAutoExtract(item) {
  item.userStart = false;
  item.end = undefined;
  item.start = item.samples ? bestStart(item, srcSpan(item)) : item.start;
  updateRow(item);
  rebuild();
  scheduleThumb(item);
}

function setSpeed(item, value) {
  item.speed = parseFloat(value) || 1;
  updateRow(item);
  rebuild();
  scheduleThumb(item);
}

function makeRow(item) {
  const li = document.createElement('li');
  li.className = 'clip';
  li.innerHTML = `
    <span class="clip-num"></span>
    <button type="button" class="thumb-btn" data-act="zoom" data-noreset aria-label="Agrandir la vidéo pour régler l’extrait" disabled>
      <canvas class="thumb" width="108" height="192" aria-hidden="true"></canvas>
      <span class="thumb-zoom" aria-hidden="true">${ICONS.zoom}</span>
    </button>
    <div class="clip-body">
      <p class="clip-name"></p>
      <p class="clip-meta"></p>
      <div class="clip-extract" hidden>
        <span class="extract-label" id="ext-${item.id}">Extrait</span>
        <output for="start-${item.id} end-${item.id}"></output>
        <button type="button" class="link-btn" data-act="zoom" data-noreset>Agrandir</button>
        <div class="range2" role="group" aria-labelledby="ext-${item.id}">
          <span class="range2-track" aria-hidden="true"><span class="range2-fill"></span></span>
          <input type="range" id="start-${item.id}" min="0" max="1" step="0.1" value="0" aria-label="Début de l’extrait">
          <input type="range" id="end-${item.id}" min="0" max="1" step="0.1" value="1" aria-label="Fin de l’extrait">
        </div>
      </div>
      <div class="clip-speed" hidden>
        <label for="speed-${item.id}">Vitesse</label>
        <select id="speed-${item.id}">
          ${SPEEDS.map((sp) => `<option value="${sp.value}"${sp.value === 1 ? ' selected' : ''}>${sp.label}</option>`).join('')}
        </select>
        <small class="speed-note" hidden>Son de ce plan coupé</small>
      </div>
      <label class="sr-only" for="cap-${item.id}">Légende affichée sur ce plan</label>
      <input type="text" id="cap-${item.id}" maxlength="60" placeholder="Légende (facultatif)">
      <p class="clip-status" role="status"><span class="clip-status-text"></span> <button type="button" class="link-btn" data-act="auto" hidden>Revenir au choix automatique</button></p>
    </div>
    <div class="clip-actions">
      <button type="button" class="icon-btn" data-act="up" aria-label="Monter">${ICONS.up}</button>
      <button type="button" class="icon-btn" data-act="down" aria-label="Descendre">${ICONS.down}</button>
      <button type="button" class="icon-btn" data-act="remove" aria-label="Retirer">${ICONS.remove}</button>
    </div>`;
  li.querySelector('.clip-name').textContent = item.name;
  li.querySelector('input[type="text"]').value = item.caption || '';
  li.querySelector(`#speed-${item.id}`).addEventListener('change', (e) => setSpeed(item, e.target.value));
  const rStart = li.querySelector(`#start-${item.id}`);
  const rEnd = li.querySelector(`#end-${item.id}`);
  rStart.addEventListener('input', () => setExtract(item, 'start', parseFloat(rStart.value)));
  rEnd.addEventListener('input', () => setExtract(item, 'end', parseFloat(rEnd.value)));
  li.querySelector('[data-act="auto"]').addEventListener('click', () => {
    setAutoExtract(item);
    rStart.focus();
  });
  li.querySelectorAll('[data-act="zoom"]').forEach((b) => b.addEventListener('click', () => openTrim(item)));
  const cap = li.querySelector('input[type="text"]');
  cap.addEventListener('input', () => {
    item.caption = cap.value;
    requestDraw();
    saveSettings();
  });
  li.querySelector('.clip-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const i = state.items.indexOf(item);
    if (btn.dataset.act === 'remove') { removeItem(item); return; }
    const j = btn.dataset.act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= state.items.length) return;
    [state.items[i], state.items[j]] = [state.items[j], state.items[i]];
    renderClipList();
    rebuild();
    btn.focus();
  });
  item.row = li;
  return li;
}

function renderClipList() {
  const ol = $('clips');
  state.items.forEach((item, i) => {
    if (!item.row) makeRow(item);
    ol.append(item.row);
    item.row.querySelector('.clip-num').textContent = String(i + 1);
    item.row.querySelector('[data-act="up"]').disabled = i === 0;
    item.row.querySelector('[data-act="down"]').disabled = i === state.items.length - 1;
    updateRow(item);
  });
  $('list-tools').hidden = state.items.length === 0;
}

function updateExtractLabel(item) {
  if (!item.row || item.kind !== 'video' || !item.ok) return;
  const [a, b] = extractRange(item);
  const sp = speedOf(item);
  // Entre parenthèses : la durée du plan dans le montage, vitesse comprise.
  const dur = (Math.round(((b - a) / sp) * 10) / 10).toFixed(1).replace('.', ',');
  const how = sp < 1 ? ' au ralenti' : sp > 1 ? ' en accéléré' : '';
  item.row.querySelector('output').textContent = `${fmtTimeTenths(a)} → ${fmtTimeTenths(b)} (${dur} s${how})`;
}

function updateRow(item) {
  const li = item.row;
  if (!li) return;
  li.classList.toggle('is-error', item.status === 'error');
  const meta = li.querySelector('.clip-meta');
  const cropped = item.crop ? ', recadrée' : '';
  if (item.kind === 'image') meta.textContent = `Photo${cropped}`;
  else if (item.ok) meta.innerHTML = `<span class="num">${fmtTime(item.duration)}</span>, ${item.w >= item.h ? 'horizontale' : 'verticale'}${item.at ? '' : ', sans son'}${cropped}`;
  else meta.textContent = 'Vidéo';
  const ext = li.querySelector('.clip-extract');
  if (item.kind === 'video' && item.ok) {
    const [a, b] = extractRange(item);
    const max = Math.round(item.duration * 10) / 10;
    const tooShort = item.duration < MIN_EXTRACT * 2;
    ext.hidden = false;
    for (const [r, v] of [[li.querySelector(`#start-${item.id}`), a], [li.querySelector(`#end-${item.id}`), b]]) {
      r.max = String(max);
      r.value = String(Math.round(v * 10) / 10);
      r.disabled = tooShort;
    }
    const fill = li.querySelector('.range2-fill');
    fill.style.left = `${(a / item.duration) * 100}%`;
    fill.style.width = `${((b - a) / item.duration) * 100}%`;
    updateExtractLabel(item);
  } else {
    ext.hidden = true;
  }
  const zoomBtn = li.querySelector('.thumb-btn');
  zoomBtn.disabled = !item.ok;
  zoomBtn.setAttribute('aria-label', item.kind === 'video' ? 'Agrandir la vidéo pour régler l’extrait et le cadrage' : 'Agrandir la photo pour la recadrer');
  const speedBox = li.querySelector('.clip-speed');
  speedBox.hidden = !(item.kind === 'video' && item.ok);
  if (!speedBox.hidden) {
    speedBox.querySelector('select').value = String(speedOf(item));
    // Le son d’une vidéo accélérée ou ralentie serait déformé : il est coupé pour ce plan.
    speedBox.querySelector('.speed-note').hidden = !(speedOf(item) !== 1 && item.at && state.keepSound);
  }
  li.querySelector('input[type="text"]').hidden = item.status === 'error';
  updateRowStatus(item);
}

function updateRowStatus(item) {
  const li = item.row;
  if (!li) return;
  const st = li.querySelector('.clip-status');
  const autoBtn = li.querySelector('[data-act="auto"]');
  autoBtn.hidden = true;
  let msg = '';
  if (item.status === 'loading') msg = 'Lecture du fichier…';
  else if (item.status === 'analyzing') msg = `Recherche du meilleur passage… ${Math.round((item.progress || 0) * 100)} %`;
  else if (item.status === 'error') msg = item.error;
  else if (item.kind === 'video' && item.userStart) { msg = 'Extrait réglé à la main.'; autoBtn.hidden = false; }
  else if (item.kind === 'video' && item.duration - srcSpan(item) < 0.1) msg = 'Vidéo courte : utilisée en entier.';
  else if (item.kind === 'video') msg = 'Passage choisi automatiquement.';
  st.querySelector('.clip-status-text').textContent = msg;
  st.hidden = !msg;
}

const thumbTimers = new Map();
function scheduleThumb(item) {
  clearTimeout(thumbTimers.get(item.id));
  thumbTimers.set(item.id, setTimeout(() => drawThumb(item), 250));
}

async function drawThumb(item) {
  if (!item.row || !item.ok || item.removed) return;
  const c = item.row.querySelector('.thumb');
  const cx = c.getContext('2d');
  try {
    let src, w, h;
    if (item.kind === 'image') {
      src = item.bitmap; w = item.w; h = item.h;
    } else {
      // Image prise au début de l’extrait : sert de vignette et d’image d’attente dans l’aperçu.
      if (!item.posterSink) {
        const k = Math.min(1, 480 / Math.max(item.w, item.h));
        item.posterSink = new MB.CanvasSink(item.vt, { width: Math.round(item.w * k), height: Math.round(item.h * k), fit: 'fill' });
      }
      const wc = await item.posterSink.getCanvas(item.t0 + clamp(item.start + 0.05, 0, item.duration - 0.05));
      if (!wc || item.removed) return;
      src = wc.canvas; w = wc.canvas.width; h = wc.canvas.height;
      rememberFrame(item, src);
      drawFilterThumbs();
      requestDraw();
    }
    cx.fillStyle = '#000000';
    cx.fillRect(0, 0, c.width, c.height);
    if (item.crop) {
      const r = cropRect(item.crop, w, h, c.width / c.height);
      cx.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
    } else {
      const s = Math.max(c.width / w, c.height / h);
      cx.drawImage(src, (c.width - w * s) / 2, (c.height - h * s) / 2, w * s, h * s);
    }
  } catch (e) {
    console.warn('Vignette impossible', e);
  }
}

/* =========================================================================
   Projets enregistrés dans l’appli (sur cet appareil, dans ce navigateur)
   Un projet garde les réglages, les textes, les plans et leurs fichiers, et la musique.
   ========================================================================= */

const projectFileKey = (pid, name) => `${pid}/${name}`;

async function listProjects() {
  const all = (await dbRun('projects', 'readonly', (st) => st.getAll())) || [];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Petite image du projet : la première vidéo ou photo, avec le filtre choisi.
function projectThumb() {
  try {
    const c = makeCanvas(72, 128);
    const cx = c.getContext('2d');
    const fr = filterSource();
    const s = Math.max(72 / fr.w, 128 / fr.h);
    cx.drawImage(fr.src, (72 - fr.w * s) / 2, (128 - fr.h * s) / 2, fr.w * s, fr.h * s);
    applyFilter(cx, 72, 128, state.filter);
    return c.toDataURL('image/jpeg', 0.75);
  } catch (e) {
    return '';
  }
}

async function saveProject(name, asNew) {
  const pid = (!asNew && state.projectId) || newSessionId();
  const keep = new Set();
  const items = state.items.filter((i) => !i.removed && i.status !== 'error');
  // Les fichiers ne sont copiés qu’une fois dans le projet ; ensuite, la séance s’y réfère.
  for (const item of items) {
    const key = projectFileKey(pid, item.id);
    keep.add(key);
    if (item.fileRef !== key) {
      await dbRun('projectFiles', 'readwrite', (st) => st.put(item.file, key));
      item.fileRef = key;
      forgetFile(String(item.id));
    }
  }
  if (state.music) {
    const key = projectFileKey(pid, 'music');
    keep.add(key);
    if (state.music.ref !== key) {
      await dbRun('projectFiles', 'readwrite', (st) => st.put(state.music.file, key));
      state.music.ref = key;
      forgetFile('music');
    }
  }
  // Fichiers de plans retirés depuis le dernier enregistrement.
  await dbRun('projectFiles', 'readwrite', (st) => {
    const req = st.openCursor(IDBKeyRange.bound(`${pid}/`, `${pid}/￿`));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (!keep.has(c.key)) c.delete();
      c.continue();
    };
    return null;
  });
  const now = Date.now();
  const previous = asNew ? null : await dbRun('projects', 'readonly', (st) => st.get(pid));
  const project = {
    id: pid, name, createdAt: previous ? previous.createdAt : now, updatedAt: now,
    count: items.length, thumb: projectThumb(), data: montageData(),
  };
  const ok = await dbRun('projects', 'readwrite', (st) => st.put(project, pid));
  if (ok === undefined && !(await dbRun('projects', 'readonly', (st) => st.get(pid)))) {
    throw new UserError('Le projet n’a pas pu être enregistré : l’espace de stockage du navigateur est peut-être plein. Supprimez d’anciens projets, puis réessayez.');
  }
  state.projectId = pid;
  state.projectName = name;
  state.dirty = false;
  updateProjectBar();
  saveSessionNow();
  // Demande au navigateur de ne pas effacer les projets pour faire de la place.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* facultatif */ }
}

// Vide le montage (plans, musique) sans toucher aux réglages.
function clearMontage() {
  [...state.items].forEach(removeItem);
  if (state.music) {
    state.music.el.pause();
    URL.revokeObjectURL(state.music.url);
    state.music = null;
    forgetFile('music');
  }
  $('music-name').textContent = '';
  $('music-remove').hidden = true;
}

async function openProject(pid) {
  const project = await dbRun('projects', 'readonly', (st) => st.get(pid));
  if (!project) { toast('Ce projet est introuvable.'); return; }
  pause();
  clearMontage();
  applySettings((project.data && project.data.settings) || {});
  await syncFormFromState();
  let missing = 0;
  for (const m of (project.data && project.data.items) || []) {
    const ref = m.ref || projectFileKey(pid, m.id);
    const file = await readProjectFile(ref);
    if (!file) { missing++; continue; }
    addItem(file, { ...m, ref });
  }
  const music = project.data && project.data.music;
  if (music) {
    const ref = music.ref || projectFileKey(pid, 'music');
    const f = await readProjectFile(ref);
    if (f) setMusic(f, false, ref);
  }
  state.projectId = pid;
  state.projectName = project.name;
  state.dirty = false;
  renderClipList();
  rebuild();
  updateProjectBar();
  saveSessionNow();
  restartPreview();
  runQueue().then(restartPreview);
  toast(missing ? `Projet « ${project.name} » ouvert, mais ${missing} fichier${missing > 1 ? 's' : ''} manquant${missing > 1 ? 's' : ''}.` : `Projet « ${project.name} » ouvert.`);
}

async function deleteProject(pid) {
  // Si le projet supprimé est ouvert, ses fichiers repassent dans la séance pour ne pas les perdre.
  if (state.projectId === pid) {
    for (const item of state.items) {
      if (item.fileRef && item.fileRef.startsWith(`${pid}/`)) { await storeFile(String(item.id), item.file); item.fileRef = null; }
    }
    if (state.music && state.music.ref) { await storeFile('music', state.music.file); state.music.ref = null; }
    state.projectId = null;
    state.projectName = '';
    state.dirty = state.items.length > 0;
    updateProjectBar();
    saveSessionNow();
  }
  await dbRun('projectFiles', 'readwrite', (st) => st.delete(IDBKeyRange.bound(`${pid}/`, `${pid}/￿`)));
  await dbRun('projects', 'readwrite', (st) => st.delete(pid));
}

function newProject() {
  pause();
  clearMontage();
  applySettings({});
  state.projectId = null;
  state.projectName = '';
  state.dirty = false;
  syncFormFromState().then(() => {
    rebuild();
    updateProjectBar();
    saveSessionNow();
    seekPreview(state.style === 'dyn' ? 1.2 : 1.8);
  });
}

function updateProjectBar() {
  const has = !!state.projectId;
  $('project-name').textContent = has ? state.projectName : 'Montage non enregistré';
  $('project-name').classList.toggle('is-none', !has);
  const st = $('project-state');
  st.hidden = !has;
  st.textContent = state.dirty ? 'Modifications non enregistrées' : 'Enregistré';
  st.classList.toggle('is-dirty', state.dirty);
}

const fmtDate = (ms) => new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

async function renderProjectList() {
  const list = $('projects-list');
  const projects = await listProjects();
  list.innerHTML = '';
  $('projects-empty').hidden = projects.length > 0;
  $('projects-warn').hidden = !(state.dirty && state.items.length > 0);
  for (const p of projects) {
    const li = document.createElement('li');
    li.className = 'project';
    li.innerHTML = `
      <img class="project-thumb" alt="" width="36" height="64">
      <div class="project-body">
        <p class="project-title"></p>
        <p class="project-meta"></p>
      </div>
      <div class="project-actions">
        <button type="button" class="btn" data-act="open">Ouvrir</button>
        <button type="button" class="btn btn-quiet" data-act="delete">Supprimer</button>
      </div>
      <div class="project-confirm" hidden>
        <span>Supprimer ce projet et ses fichiers de l’appareil ?</span>
        <button type="button" class="btn btn-danger" data-act="confirm">Supprimer</button>
        <button type="button" class="btn btn-quiet" data-act="cancel">Annuler</button>
      </div>`;
    if (p.thumb) li.querySelector('img').src = p.thumb; else li.querySelector('img').hidden = true;
    li.querySelector('.project-title').textContent = p.name;
    li.querySelector('.project-meta').textContent = `Modifié le ${fmtDate(p.updatedAt)}, ${p.count} plan${p.count > 1 ? 's' : ''}${p.id === state.projectId ? ' (ouvert)' : ''}`;
    li.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      const confirmBox = li.querySelector('.project-confirm');
      if (act === 'open') { $('projects-dlg').close(); await openProject(p.id); }
      else if (act === 'delete') { confirmBox.hidden = false; confirmBox.querySelector('[data-act="confirm"]').focus(); }
      else if (act === 'cancel') { confirmBox.hidden = true; }
      else if (act === 'confirm') { await deleteProject(p.id); toast(`Projet « ${p.name} » supprimé.`); renderProjectList(); }
    });
    list.append(li);
  }
  // Place occupée par les projets et la séance dans le navigateur.
  try {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    $('projects-usage').textContent = est && est.usage ? `Espace utilisé par Vidéixo sur cet appareil : ${Math.max(1, Math.round(est.usage / 1e6))} Mo.` : '';
  } catch (e) { $('projects-usage').textContent = ''; }
}

function initProjects() {
  updateProjectBar();
  $('btn-save-project').addEventListener('click', () => {
    if (!state.items.some((i) => i.ok)) { toast('Ajoutez au moins une vidéo ou une photo avant d’enregistrer le projet.'); return; }
    const name = state.projectName || state.title.trim() || `Montage du ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
    $('save-name').value = name;
    $('save-copy').hidden = !state.projectId;
    $('save-confirm').textContent = state.projectId ? 'Enregistrer les modifications' : 'Enregistrer';
    $('save-status').textContent = '';
    $('save-dlg').showModal();
    $('save-name').select();
  });
  const doSave = async (asNew) => {
    const name = $('save-name').value.trim();
    if (!name) { $('save-status').textContent = 'Donnez un nom au projet.'; $('save-name').focus(); return; }
    $('save-status').textContent = 'Enregistrement…';
    $('save-confirm').disabled = true;
    $('save-copy').disabled = true;
    try {
      await saveProject(name, asNew);
      $('save-dlg').close();
      toast(`Projet « ${name} » enregistré.`);
    } catch (e) {
      console.error(e);
      $('save-status').textContent = e instanceof UserError ? e.message : 'Le projet n’a pas pu être enregistré.';
    } finally {
      $('save-confirm').disabled = false;
      $('save-copy').disabled = false;
    }
  };
  $('save-form').addEventListener('submit', (e) => { e.preventDefault(); doSave(false); });
  $('save-copy').addEventListener('click', () => doSave(true));
  $('save-cancel').addEventListener('click', () => $('save-dlg').close());
  $('btn-open-projects').addEventListener('click', async () => {
    await renderProjectList();
    $('projects-dlg').showModal();
  });
  $('projects-close').addEventListener('click', () => $('projects-dlg').close());
  $('btn-new-project').addEventListener('click', () => {
    if (!state.items.length && !state.title) { newProject(); return; }
    $('new-warn').hidden = !(state.dirty && state.items.length > 0);
    $('new-dlg').showModal();
  });
  $('new-confirm').addEventListener('click', () => { $('new-dlg').close(); newProject(); });
  $('new-cancel').addEventListener('click', () => $('new-dlg').close());
}

/* =========================================================================
   Fenêtre de réglage de l’extrait : la vidéo en grand, le début et la fin à la poignée ou au dixième de seconde
   ========================================================================= */

const trim = { item: null, changed: false, playing: false, raf: 0 };
const fmtSec = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');

function openTrim(item) {
  if (!item || !item.ok) return;
  clearTimeout(restartTimer);
  if (pv.playing) pause();
  trim.item = item;
  trim.changed = false;
  const isVideo = item.kind === 'video';
  document.querySelectorAll('#trim-dlg .video-only').forEach((el) => { el.hidden = !isVideo; });
  $('trim-title').textContent = isVideo ? 'Régler l’extrait et le cadrage' : 'Recadrer la photo';
  const v = $('trim-video');
  const ph = $('trim-photo');
  v.hidden = !isVideo;
  ph.hidden = isVideo;
  if (isVideo) {
    v.muted = true;
    v.src = item.el.src;
    v.addEventListener('loadeddata', () => { showTrimFrame('start'); layoutCropFrame(); }, { once: true });
    syncTrim();
  } else {
    $('trim-auto').hidden = true;
    ph.width = item.bitmap.width;
    ph.height = item.bitmap.height;
    ph.getContext('2d').drawImage(item.bitmap, 0, 0);
  }
  $('trim-name').textContent = item.name;
  syncCrop();
  $('trim-dlg').showModal();
  requestAnimationFrame(layoutCropFrame);
}

/* ---------- Cadrage dans la fenêtre agrandie ---------- */

// Position de l’image affichée dans la scène (la vidéo ou la photo est centrée, sans déformation).
function trimMediaBox() {
  const item = trim.item;
  if (!item) return null;
  const el = item.kind === 'video' ? $('trim-video') : $('trim-photo');
  const iw = item.kind === 'video' ? el.videoWidth : el.width;
  const ih = item.kind === 'video' ? el.videoHeight : el.height;
  const bw = el.clientWidth, bh = el.clientHeight;
  if (!iw || !ih || !bw || !bh) return null;
  const k = Math.min(bw / iw, bh / ih);
  return { x: el.offsetLeft + (bw - iw * k) / 2, y: el.offsetTop + (bh - ih * k) / 2, w: iw * k, h: ih * k, iw, ih };
}

function layoutCropFrame() {
  const frame = $('crop-frame');
  const item = trim.item;
  const box = item && item.crop ? trimMediaBox() : null;
  frame.hidden = !box;
  $('trim-stage').classList.toggle('is-cropping', !!(item && item.crop));
  if (!box) return;
  const F = FORMATS[state.format];
  const r = cropRect(item.crop, box.iw, box.ih, F.W / F.H);
  const k = box.w / box.iw;
  frame.style.left = `${box.x + r.sx * k}px`;
  frame.style.top = `${box.y + r.sy * k}px`;
  frame.style.width = `${r.sw * k}px`;
  frame.style.height = `${r.sh * k}px`;
}

function syncCrop() {
  const item = trim.item;
  if (!item) return;
  const custom = !!item.crop;
  $('crop-auto').checked = !custom;
  $('crop-custom').checked = custom;
  $('crop-zoom-box').hidden = !custom;
  $('crop-hint').hidden = !custom;
  if (custom) {
    $('crop-zoom').value = String(item.crop.z);
    $('crop-zoom-out').textContent = `${Math.round(item.crop.z * 100)} %`;
    document.querySelector('.zoom-step[data-zoom^="-"]').disabled = item.crop.z <= 1.001;
    document.querySelector('.zoom-step:not([data-zoom^="-"])').disabled = item.crop.z >= 2.999;
  }
  layoutCropFrame();
}

function cropChanged() {
  const item = trim.item;
  if (item.crop) clampCrop(item);
  trim.changed = true;
  syncCrop();
  updateRow(item);
  rebuild();
  scheduleThumb(item);
}

function initCrop() {
  const stage = $('trim-stage');
  const frame = $('crop-frame');
  document.querySelectorAll('input[name="crop-mode"]').forEach((r) => r.addEventListener('change', () => {
    const item = trim.item;
    if (!item) return;
    item.crop = r.value === 'custom' ? item.crop || { x: 0.5, y: 0.5, z: 1 } : null;
    cropChanged();
    if (item.crop) frame.focus();
  }));
  // Boutons − et + : zoom par pas de 10 %.
  $('crop-zoom-box').addEventListener('click', (e) => {
    const btn = e.target.closest('.zoom-step');
    if (!btn || !trim.item || !trim.item.crop) return;
    trim.item.crop.z = clamp(Math.round((trim.item.crop.z + parseFloat(btn.dataset.zoom)) * 100) / 100, 1, 3);
    cropChanged();
  });
  $('crop-zoom').addEventListener('input', (e) => {
    if (!trim.item || !trim.item.crop) return;
    trim.item.crop.z = clamp(parseFloat(e.target.value), 1, 3);
    cropChanged();
  });
  // Glisser le cadre, ou cliquer ailleurs sur l’image pour l’y amener.
  stage.addEventListener('pointerdown', (e) => {
    const item = trim.item;
    if (!item || !item.crop || e.button > 0) return;
    const box = trimMediaBox();
    if (!box) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    if (!frame.contains(e.target)) {
      const rect = stage.getBoundingClientRect();
      item.crop.x = (e.clientX - rect.left - box.x) / box.w;
      item.crop.y = (e.clientY - rect.top - box.y) / box.h;
      cropChanged();
    }
    const start = { px: e.clientX, py: e.clientY, x: item.crop.x, y: item.crop.y };
    const move = (ev) => {
      item.crop.x = start.x + (ev.clientX - start.px) / box.w;
      item.crop.y = start.y + (ev.clientY - start.py) / box.h;
      cropChanged();
    };
    const up = () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  });
  // Molette : zoom.
  stage.addEventListener('wheel', (e) => {
    const item = trim.item;
    if (!item || !item.crop) return;
    e.preventDefault();
    item.crop.z = clamp(item.crop.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 1, 3);
    cropChanged();
  }, { passive: false });
  // Clavier : flèches pour déplacer (Maj pour aller plus vite), + et − pour zoomer.
  frame.addEventListener('keydown', (e) => {
    const item = trim.item;
    if (!item || !item.crop) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      item.crop.x += moves[e.key][0];
      item.crop.y += moves[e.key][1];
    } else if (e.key === '+' || e.key === '=') {
      item.crop.z = clamp(item.crop.z * 1.1, 1, 3);
    } else if (e.key === '-') {
      item.crop.z = clamp(item.crop.z / 1.1, 1, 3);
    } else {
      return;
    }
    e.preventDefault();
    cropChanged();
  });
  window.addEventListener('resize', () => { if (trim.item) layoutCropFrame(); });
  $('trim-video').addEventListener('loadedmetadata', layoutCropFrame);
}

function syncTrim() {
  const item = trim.item;
  if (!item) return;
  const [a, b] = extractRange(item);
  const max = Math.round(item.duration * 10) / 10;
  for (const [id, val] of [['trim-start', a], ['trim-end', b]]) {
    const r = $(id);
    r.max = String(max);
    r.value = String(Math.round(val * 10) / 10);
  }
  $('trim-fill').style.left = `${(a / item.duration) * 100}%`;
  $('trim-fill').style.width = `${((b - a) / item.duration) * 100}%`;
  $('trim-start-out').textContent = fmtTimeTenths(a);
  $('trim-end-out').textContent = fmtTimeTenths(b);
  $('trim-length').textContent = fmtTime(item.duration);
  const sp = speedOf(item);
  let summary = `Durée dans le montage : ${fmtSec((b - a) / sp)} s`;
  if (sp !== 1) summary += ` (${fmtSec(b - a)} s de vidéo ${sp < 1 ? 'ralentie' : 'accélérée'}, son coupé)`;
  $('trim-summary').textContent = summary;
  $('trim-speed').value = String(sp);
  $('trim-auto').hidden = !item.userStart;
  updatePlayhead();
}

function updatePlayhead() {
  if (!trim.item) return;
  const v = $('trim-video');
  $('trim-playhead').style.left = `${clamp(v.currentTime / trim.item.duration) * 100}%`;
}

// Affiche l’image exacte du début ou de la fin de l’extrait.
function showTrimFrame(which) {
  if (!trim.item) return;
  stopTrimPlay();
  const [a, b] = extractRange(trim.item);
  $('trim-video').currentTime = which === 'end' ? Math.max(a, b - 0.04) : a;
}

function stopTrimPlay() {
  $('trim-video').pause();
  trim.playing = false;
  cancelAnimationFrame(trim.raf);
  $('trim-play-label').textContent = 'Lire l’extrait';
  $('trim-ico-play').hidden = false;
  $('trim-ico-pause').hidden = true;
}

// Lit l’extrait du début à la fin, à la vitesse choisie, puis s’arrête.
function playTrim() {
  const item = trim.item;
  if (!item) return;
  if (trim.playing) { stopTrimPlay(); return; }
  const v = $('trim-video');
  const [a] = extractRange(item);
  const sp = speedOf(item);
  v.playbackRate = sp;
  v.muted = sp !== 1 || !item.at;
  v.currentTime = a;
  v.play().catch(() => {});
  trim.playing = true;
  $('trim-play-label').textContent = 'Pause';
  $('trim-ico-play').hidden = true;
  $('trim-ico-pause').hidden = false;
  const tick = () => {
    if (!trim.playing) return;
    const [, b] = extractRange(item);
    updatePlayhead();
    if (v.currentTime >= b - 0.02 || v.ended) { stopTrimPlay(); return; }
    trim.raf = requestAnimationFrame(tick);
  };
  tick();
}

function initTrim() {
  initCrop();
  $('trim-speed').innerHTML = SPEEDS.map((sp) => `<option value="${sp.value}">${sp.label}</option>`).join('');
  const changed = () => { trim.changed = true; syncTrim(); };
  $('trim-start').addEventListener('input', (e) => { setExtract(trim.item, 'start', parseFloat(e.target.value)); changed(); showTrimFrame('start'); });
  $('trim-end').addEventListener('input', (e) => { setExtract(trim.item, 'end', parseFloat(e.target.value)); changed(); showTrimFrame('end'); });
  document.querySelector('.trim-points').addEventListener('click', (e) => {
    const btn = e.target.closest('.nudge');
    if (!btn || !trim.item) return;
    const which = btn.dataset.which;
    const [a, b] = extractRange(trim.item);
    setExtract(trim.item, which, (which === 'start' ? a : b) + parseFloat(btn.dataset.step));
    changed();
    showTrimFrame(which);
  });
  $('trim-speed').addEventListener('change', (e) => { setSpeed(trim.item, e.target.value); changed(); stopTrimPlay(); });
  $('trim-auto').addEventListener('click', () => { setAutoExtract(trim.item); changed(); showTrimFrame('start'); $('trim-start').focus(); });
  $('trim-play').addEventListener('click', playTrim);
  $('trim-done').addEventListener('click', () => $('trim-dlg').close());
  $('trim-close').addEventListener('click', () => $('trim-dlg').close());
  $('trim-video').addEventListener('seeked', updatePlayhead);
  $('trim-dlg').addEventListener('close', () => {
    stopTrimPlay();
    const v = $('trim-video');
    v.removeAttribute('src');
    v.load();
    const item = trim.item;
    trim.item = null;
    if (trim.changed) { restartPreview(); markDirty(); }
    $('crop-frame').hidden = true;
    if (item && item.row) item.row.querySelector('.thumb-btn').focus();
  });
}

/* =========================================================================
   Aperçu
   ========================================================================= */

let tl = buildTimeline(false);
const pv = { playing: false, t: 0, t0: 0, raf: 0, scale: 0.4, sound: false, drawQueued: false };
const pvCanvas = $('preview');
const pvCtx = pvCanvas.getContext('2d');

function rebuild() {
  for (const item of state.items) {
    if (item.kind === 'video' && item.ok && item.status === 'ready' && !item.userStart && item.samples) {
      const s = bestStart(item, srcSpan(item));
      if (s !== item.start) { item.start = s; scheduleThumb(item); updateRow(item); }
    }
  }
  tl = buildTimeline(false);
  pv.t = Math.min(pv.t, tl.total - 0.001);
  $('scrub').max = String(tl.total);
  sizePreview();
  updateSummary();
  drawFilterThumbs();
  requestDraw();
  saveSettings();
}

function sizePreview() {
  const { W, H } = tl;
  const cssW = pvCanvas.clientWidth || 340;
  const scale = Math.min(1, (cssW * (window.devicePixelRatio || 1)) / W);
  const w = Math.round(W * scale), h = Math.round(H * scale);
  if (pvCanvas.width !== w || pvCanvas.height !== h) { pvCanvas.width = w; pvCanvas.height = h; }
  pv.scale = w / W;
}

// Pendant qu’une vidéo cherche sa position, on affiche sa dernière image connue plutôt que du noir.
function previewFrame(seg) {
  const item = seg.item;
  if (item.kind === 'image') return { src: item.bitmap, w: item.w, h: item.h };
  const v = item.el;
  if (v && v.readyState >= 2 && v.videoWidth && !v.seeking) {
    rememberFrame(item, v);
    return { src: v, w: v.videoWidth, h: v.videoHeight };
  }
  if (item.lastFrame) return { src: item.lastFrame, w: item.lastFrame.width, h: item.lastFrame.height };
  return null;
}

function rememberFrame(item, src) {
  const s = Math.min(1, 480 / Math.max(item.w, item.h));
  const w = Math.max(2, Math.round(item.w * s)), h = Math.max(2, Math.round(item.h * s));
  if (!item.lastFrame) item.lastFrame = makeCanvas(w, h);
  try { item.lastFrame.getContext('2d').drawImage(src, 0, 0, w, h); } catch (e) { /* image pas encore prête */ }
}

function requestDraw() {
  if (pv.playing || pv.drawQueued) return;
  pv.drawQueued = true;
  requestAnimationFrame(() => { pv.drawQueued = false; draw(); });
}

function draw() {
  pvCtx.setTransform(pv.scale, 0, 0, pv.scale, 0, 0);
  renderFrame(pvCtx, tl, pv.t, previewFrame);
  if ($('opt-safe').checked) drawSafeZones(pvCtx, tl);
  $('scrub').value = String(pv.t);
  $('time').textContent = `${fmtTime(pv.t)} / ${fmtTime(tl.total)}`;
}

function syncVideos(t, playing) {
  for (const seg of tl.segs) {
    if (seg.type !== 'media' || seg.item.kind !== 'video' || !seg.item.el) continue;
    const v = seg.item.el;
    const active = t >= seg.start && t < seg.start + seg.dur;
    const upcoming = t >= seg.start - 1.2 && t < seg.start;
    const want = Math.min(seg.srcIn + (t - seg.start) * seg.speed, seg.item.duration - 0.05);
    if (active) {
      const audible = pv.sound && state.keepSound && !!seg.item.at && seg.speed === 1;
      v.muted = !audible;
      if (v.playbackRate !== seg.speed) v.playbackRate = seg.speed;
      v.volume = state.music ? 0.45 : 1;
      if (playing) {
        if (v.paused) { v.currentTime = want; v.play().catch(() => {}); }
        else if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - want) > 0.04 && !v.seeking) v.currentTime = want;
      }
    } else if (upcoming) {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - seg.srcIn) > 0.05 && !v.seeking) v.currentTime = seg.srcIn;
    } else if (!v.paused) {
      v.pause();
    }
  }
}

function syncMusic(playing) {
  const m = state.music;
  if (!m) return;
  if (playing && pv.sound) {
    if (Math.abs(m.el.currentTime - pv.t) > 0.3) m.el.currentTime = pv.t;
    if (m.el.paused) m.el.play().catch(() => {});
  } else if (!m.el.paused) {
    m.el.pause();
  }
}

function loop() {
  if (!pv.playing) return;
  pv.t = (performance.now() - pv.t0) / 1000;
  if (pv.t >= tl.total) {
    if (pv.once) {
      pv.t = tl.total - 0.001;
      pause();
      return;
    }
    pv.t = 0;
    pv.t0 = performance.now();
    if (state.music) state.music.el.currentTime = 0;
  }
  syncVideos(pv.t, true);
  syncMusic(true);
  draw();
  pv.raf = requestAnimationFrame(loop);
}

// once : lecture automatique après un changement, qui s’arrête à la fin au lieu de boucler.
function play(once = false) {
  pv.once = once;
  if (pv.playing) return;
  if (pv.t >= tl.total - 0.05) pv.t = 0;
  pv.playing = true;
  pv.t0 = performance.now() - pv.t * 1000;
  $('ico-play').hidden = true;
  $('ico-pause').hidden = false;
  $('btn-play').setAttribute('aria-label', 'Mettre l’aperçu en pause');
  loop();
}

function pause() {
  pv.playing = false;
  cancelAnimationFrame(pv.raf);
  syncVideos(pv.t, false);
  syncMusic(false);
  $('ico-play').hidden = false;
  $('ico-pause').hidden = true;
  $('btn-play').setAttribute('aria-label', 'Lire l’aperçu');
  requestDraw();
}

function seekPreview(t) {
  clearTimeout(restartTimer);
  if (pv.playing) pause();
  pv.t = clamp(t, 0, tl.total - 0.001);
  syncVideos(pv.t, false);
  requestDraw();
}

// Après chaque changement de réglage, l’aperçu revient au début, puis se relance tout seul
// dès que la saisie s’arrête, pour montrer le résultat depuis la première image.
let restartTimer = 0;
function restartPreview() {
  clearTimeout(restartTimer);
  if (pv.playing) pause();
  pv.t = 0;
  syncVideos(0, false);
  if (state.music) state.music.el.currentTime = 0;
  requestDraw();
  restartTimer = setTimeout(() => play(true), 450);
}

function updateSummary() {
  const media = state.items.filter((i) => i.ok);
  const busy = state.items.some((i) => i.status === 'loading' || i.status === 'analyzing');
  const exportTl = buildTimeline(true);
  const { W, H } = exportTl;

  // Sur les styles où le titre passe sur les vidéos, il ne peut pas durer plus longtemps qu’elles.
  const wantedTitle = state.titleDurs[state.style] || TITLE_DUR_DEFAULT[state.style];
  const capped = state.style !== 'dyn' && media.length > 0 && !!exportTl.title && exportTl.titleDur < wantedTitle - 0.05;
  $('titledur-note').hidden = !capped;
  if (capped) {
    const secs = String(Math.round(exportTl.titleDur * 10) / 10).replace('.', ',');
    $('titledur-note').textContent = `Limité à ${secs} s : les vidéos ne durent pas plus longtemps avant l’écran de fin.`;
  }

  $('stamp').innerHTML = '';
  $('stamp').append(`Durée ${fmtTime(Math.round(exportTl.total))}`);
  const small = document.createElement('small');
  small.textContent = `${W} × ${H} px, MP4`;
  $('stamp').append(small);

  const btn = $('btn-export');
  btn.disabled = media.length === 0 && !busy;
  btn.textContent = busy ? 'Créer la vidéo (analyse en cours…)' : 'Créer la vidéo';

  const warn = $('warn');
  if (state.format === 'story' && exportTl.total > 60) {
    warn.textContent = 'Plus de 60 secondes : Instagram découpera la story en plusieurs parties. Retirez des vidéos ou passez au rythme rapide.';
    warn.hidden = false;
  } else if (!media.length) {
    warn.hidden = true;
  } else {
    warn.hidden = true;
  }
  $('screen-note').hidden = state.items.length > 0;
}

/* =========================================================================
   Son du montage (export)
   ========================================================================= */

async function decodeMusic() {
  const m = state.music;
  if (!m) return null;
  if (m.buffer) return m.buffer;
  const data = await m.file.arrayBuffer();
  const ac = new OfflineAudioContext(2, 1, 48000);
  try {
    m.buffer = await ac.decodeAudioData(data);
  } catch (e) {
    throw new UserError('La musique n’a pas pu être lue. Essayez avec un fichier MP3.');
  }
  return m.buffer;
}

async function renderAudioMix(tlx, ctl) {
  const SR = 48000;
  // Seuls les plans à vitesse normale gardent leur son.
  const withVideoSound = state.keepSound && tlx.segs.some((s) => s.type === 'media' && s.item.at && s.speed === 1);
  if (!withVideoSound && !state.music) return null;
  const length = Math.ceil(tlx.total * SR);
  const oc = new OfflineAudioContext(2, length, SR);
  const videoGain = state.music ? 0.45 : 1;

  if (withVideoSound) {
    for (let i = 0; i < tlx.segs.length; i++) {
      const seg = tlx.segs[i];
      if (seg.type !== 'media' || !seg.item.at || seg.speed !== 1) continue;
      if (ctl.cancelled) throw new Cancelled();
      const next = tlx.segs[i + 1];
      const a = seg.start, b = seg.start + seg.dur;
      const fin = Math.max(0.03, seg.transIn ? seg.transIn.dur : 0);
      const fout = Math.max(0.03, next && next.transIn ? next.transIn.dur : 0);
      const g = oc.createGain();
      g.connect(oc.destination);
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(videoGain, a + fin);
      g.gain.setValueAtTime(videoGain, Math.max(a + fin, b - fout));
      g.gain.linearRampToValueAtTime(0, b);

      const item = seg.item;
      const from = item.t0 + seg.srcIn;
      const to = from + seg.dur;
      const sink = new MB.AudioBufferSink(item.at);
      for await (const wb of sink.buffers(from, to)) {
        const src = oc.createBufferSource();
        src.buffer = wb.buffer;
        src.connect(g);
        const when = a + (wb.timestamp - from);
        if (when < a) {
          const off = a - when;
          if (off < wb.buffer.duration) src.start(a, off);
        } else {
          src.start(when);
        }
        src.stop(b + 0.01);
      }
    }
  }

  if (state.music) {
    const buf = await decodeMusic();
    const g = oc.createGain();
    g.connect(oc.destination);
    const end = tlx.total;
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.9, 0.3);
    g.gain.setValueAtTime(0.9, Math.max(0.3, end - 1.5));
    g.gain.linearRampToValueAtTime(0, end);
    const src = oc.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.start(0);
  }

  return oc.startRendering();
}

let aacPromise = null;
function loadAacEncoder() {
  if (!aacPromise) {
    aacPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'lib/mediabunny-aac-encoder.min.js';
      s.onload = () => { window.MediabunnyAacEncoder.registerAacEncoder(); resolve(); };
      s.onerror = () => { aacPromise = null; reject(new UserError('Le module de son n’a pas pu être chargé. Vérifiez que le dossier « lib » est bien en ligne.')); };
      document.head.append(s);
    });
  }
  return aacPromise;
}

/* =========================================================================
   Export MP4
   ========================================================================= */

function makeRunner(seg, tlx, N) {
  const item = seg.item;
  const { W, H } = tlx;
  const margin = 1 + tlx.T.kb + 0.03;
  let need;
  if (item.crop) {
    // Un cadre resserré demande plus de définition : on décode d’autant plus grand.
    const base = cropRect({ x: 0.5, y: 0.5, z: 1 }, item.w, item.h, W / H);
    need = (W / base.sw) * item.crop.z * margin;
  } else {
    need = usesContain(item, W, H) ? Math.min(W / item.w, H / item.h) * margin : Math.max(W / item.w, H / item.h) * margin;
  }
  const s = Math.min(1, need);
  const width = Math.max(2, Math.round((item.w * s) / 2) * 2);
  const height = Math.max(2, Math.round((item.h * s) / 2) * 2);
  const sink = new MB.CanvasSink(item.vt, { width, height, fit: 'fill', poolSize: 2 });
  const stamps = [];
  for (let i = 0; i < N; i++) {
    const t = i / FPS;
    if (t >= seg.start && t < seg.start + seg.dur) {
      stamps.push(item.t0 + Math.min(seg.srcIn + (t - seg.start) * seg.speed, item.duration - 0.02));
    }
  }
  const it = sink.canvasesAtTimestamps(stamps);
  let last = null;
  return {
    async next() {
      const r = await it.next();
      if (!r.done && r.value) last = r.value.canvas;
      return last ? { src: last, w: width, h: height } : null;
    },
    async close() { try { await it.return(); } catch (e) { /* déjà fermé */ } },
  };
}

async function createVideo(ctl, onProgress) {
  if (typeof VideoEncoder === 'undefined') {
    throw new UserError('Ce navigateur ne sait pas fabriquer de vidéo. Utilisez une version récente de Chrome, Edge ou Safari.');
  }
  if (queueRunning) {
    onProgress(0, 'Fin de l’analyse des vidéos…');
    await queueRunning;
  }
  const tlx = buildTimeline(true);
  if (!tlx.segs.some((s) => s.type === 'media')) throw new UserError('Ajoutez au moins une vidéo ou une photo lisible.');
  const { W, H } = tlx;
  const N = Math.round(tlx.total * FPS);

  const canEncode = await MB.canEncodeVideo('avc', { width: W, height: H, bitrate: 8e6 });
  if (!canEncode) throw new UserError('Ce navigateur ne sait pas encoder en MP4 (H.264). Utilisez une version récente de Chrome, Edge ou Safari.');

  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false });

  const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
  const videoSource = new MB.CanvasSource(canvas, { codec: 'avc', bitrate: 8e6, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: FPS });

  onProgress(0.01, 'Préparation du son…');
  const mixBuffer = await renderAudioMix(tlx, ctl);
  let audioSource = null;
  if (mixBuffer) {
    const native = await MB.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 160e3 });
    if (!native) await loadAacEncoder();
    audioSource = new MB.AudioBufferSource({ codec: 'aac', bitrate: 160e3 });
    output.addAudioTrack(audioSource);
  }

  await output.start();
  const runners = new Map();
  const prof = { decode: 0, draw: 0, encode: 0 };
  try {
    if (audioSource) {
      onProgress(0.03, 'Encodage du son…');
      await audioSource.add(mixBuffer);
      audioSource.close();
    }
    for (let i = 0; i < N; i++) {
      if (ctl.cancelled) throw new Cancelled();
      const t = i / FPS;
      const frames = new Map();
      for (const seg of tlx.segs) {
        if (seg.type !== 'media') continue;
        const active = t >= seg.start && t < seg.start + seg.dur;
        if (seg.item.kind === 'image') {
          if (active) frames.set(seg, { src: seg.item.bitmap, w: seg.item.w, h: seg.item.h });
          continue;
        }
        if (active) {
          let r = runners.get(seg);
          if (!r) { r = makeRunner(seg, tlx, N); runners.set(seg, r); }
          const tD = performance.now();
          frames.set(seg, await r.next());
          prof.decode += performance.now() - tD;
        } else if (runners.has(seg)) {
          await runners.get(seg).close();
          runners.delete(seg);
        }
      }
      const tA = performance.now();
      renderFrame(ctx, tlx, t, (seg) => frames.get(seg) || null);
      const tB = performance.now();
      await videoSource.add(t, 1 / FPS);
      prof.draw += tB - tA;
      prof.encode += performance.now() - tB;
      if (i % 5 === 0) onProgress(0.05 + 0.88 * (i / N), `Image ${i + 1} sur ${N}`);
    }
    for (const r of runners.values()) await r.close();
    runners.clear();
    videoSource.close();
    onProgress(0.97, 'Finalisation du fichier…');
    await output.finalize();
    console.info(`Temps : décodage ${(prof.decode / 1000).toFixed(1)} s, dessin ${(prof.draw / 1000).toFixed(1)} s, encodage ${(prof.encode / 1000).toFixed(1)} s`);
  } catch (e) {
    for (const r of runners.values()) await r.close();
    try { await output.cancel(); } catch (e2) { /* rien */ }
    throw e;
  }
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

/* ---------- Fenêtre de progression ---------- */

let exportCtl = null;
let resultUrl = null;

function showDialogPane(name) {
  $('dlg-working').hidden = name !== 'working';
  $('dlg-done').hidden = name !== 'done';
  $('dlg-error').hidden = name !== 'error';
}

function setProgress(p, label) {
  const pct = Math.round(p * 100);
  $('bar-fill').style.width = pct + '%';
  $('bar').setAttribute('aria-valuenow', String(pct));
  if (label) $('dlg-step').textContent = `${label} (${pct} %)`;
}

async function startExport() {
  pause();
  const dlg = $('dlg');
  showDialogPane('working');
  setProgress(0, 'Préparation…');
  if (!dlg.open) dlg.showModal();
  exportCtl = { cancelled: false };
  const t0 = performance.now();
  try {
    const blob = await createVideo(exportCtl, setProgress);
    console.info(`Vidéo créée en ${((performance.now() - t0) / 1000).toFixed(1)} s, ${(blob.size / 1e6).toFixed(1)} Mo`);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const name = `${state.format === 'story' ? 'story' : 'publication'}-${slug(state.title) || 'mediatheque'}-${date}.mp4`;
    const file = new File([blob], name, { type: 'video/mp4' });
    $('result-video').src = resultUrl;
    const dl = $('btn-download');
    dl.href = resultUrl;
    dl.download = name;
    const share = $('btn-share');
    share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    share.onclick = async () => {
      try { await navigator.share({ files: [file], title: state.title || 'Story' }); }
      catch (e) { if (e.name !== 'AbortError') toast('Le partage n’a pas fonctionné. Téléchargez la vidéo à la place.'); }
    };
    showDialogPane('done');
  } catch (e) {
    if (e instanceof Cancelled) { dlg.close(); return; }
    console.error(e);
    $('dlg-error-msg').textContent = e instanceof UserError
      ? e.message
      : `Une erreur est survenue pendant le montage (${e.message || e}). Essayez avec moins de vidéos, ou avec Chrome à jour.`;
    showDialogPane('error');
  } finally {
    exportCtl = null;
  }
}

/* =========================================================================
   Formulaire
   ========================================================================= */

function buildFilters() {
  const box = $('filters');
  box.innerHTML = '';
  for (const f of FILTERS) {
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'filter'; input.id = `flt-${f.id}`; input.value = f.id; input.className = 'choice-input';
    const label = document.createElement('label');
    label.className = 'filter-card';
    label.htmlFor = input.id;
    const c = makeCanvas(90, 160);
    c.dataset.filter = f.id;
    c.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = f.label;
    label.append(c, name);
    box.append(input, label);
  }
  box.addEventListener('change', (e) => {
    if (e.target.name !== 'filter') return;
    state.filter = e.target.value;
    saveSettings();
    rebuild();
  });
}

// Image d’exemple pour les vignettes tant qu’aucune vidéo ni photo n’est prête : ciel, soleil, colline.
let sampleScene = null;
function filterSource() {
  const it = state.items.find((i) => i.ok && (i.kind === 'image' ? i.bitmap : i.lastFrame));
  if (it) {
    const src = it.kind === 'image' ? it.bitmap : it.lastFrame;
    return { src, w: src.width, h: src.height };
  }
  if (!sampleScene) {
    sampleScene = makeCanvas(90, 160);
    const c = sampleScene.getContext('2d');
    const sky = c.createLinearGradient(0, 0, 0, 160);
    sky.addColorStop(0, '#5FA8D3');
    sky.addColorStop(0.65, '#F6D58E');
    c.fillStyle = sky; c.fillRect(0, 0, 90, 160);
    c.fillStyle = '#F39C12'; c.beginPath(); c.arc(62, 70, 16, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3A7D44'; c.beginPath(); c.ellipse(30, 160, 80, 52, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#C0392B'; c.fillRect(14, 102, 18, 22);
  }
  return { src: sampleScene, w: 90, h: 160 };
}

function drawFilterThumbs() {
  const fr = filterSource();
  document.querySelectorAll('#filters canvas').forEach((c) => {
    const cx = c.getContext('2d');
    const W = c.width, H = c.height;
    const s = Math.max(W / fr.w, H / fr.h);
    cx.drawImage(fr.src, (W - fr.w * s) / 2, (H - fr.h * s) / 2, fr.w * s, fr.h * s);
    applyFilter(cx, W, H, c.dataset.filter);
  });
}

function buildSwatches() {
  const box = $('swatches');
  box.innerHTML = '';
  COLORS.forEach((c, i) => {
    const id = `c-${i}`;
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'color'; input.id = id; input.value = c.hex; input.className = 'choice-input';
    const label = document.createElement('label');
    label.className = 'swatch'; label.htmlFor = id; label.style.background = c.hex; label.title = c.name;
    label.setAttribute('aria-label', c.name);
    box.append(input, label);
  });
  const custom = document.createElement('label');
  custom.className = 'custom-color';
  custom.innerHTML = '<input type="color" id="c-custom"> Autre couleur';
  box.append(custom);
  box.addEventListener('change', (e) => {
    if (e.target.name === 'color' || e.target.id === 'c-custom') {
      state.color = e.target.value;
      syncColorInputs();
      saveSettings();
      rebuild();
    }
  });
  $('c-custom').addEventListener('input', (e) => { state.color = e.target.value; syncColorInputs(); rebuild(); });
}

function syncColorInputs() {
  let matched = false;
  document.querySelectorAll('input[name="color"]').forEach((r) => {
    r.checked = r.value.toLowerCase() === state.color.toLowerCase();
    matched = matched || r.checked;
  });
  $('c-custom').value = state.color;
}

// La couleur ne sert qu’aux styles Dynamique et Doux (le style Médiathèque suit la charte) ;
// le texte de fin, le compte Instagram et le logo ne servent que sur l’écran de fin.
function updateColorGroup() {
  $('color-group').hidden = state.style === 'charte';
  for (const id of ['field-enddur', 'field-end', 'field-handle', 'field-logo']) $(id).hidden = !state.endScreen;
}

// Le curseur de durée du titre montre la valeur du style choisi.
function syncTitleDur() {
  const v = state.titleDurs[state.style] || TITLE_DUR_DEFAULT[state.style];
  const r = $('f-titledur');
  r.min = String(TITLE_DUR_MIN);
  r.max = String(TITLE_DUR_MAX);
  r.value = String(v);
  $('titledur-out').textContent = `${String(v).replace('.', ',')} s`;
}

// Le curseur de durée de l’écran de fin montre la valeur du style choisi.
function syncEndDur() {
  const v = state.endDurs[state.style] || END_DUR_DEFAULT[state.style];
  const r = $('f-enddur');
  r.min = String(END_DUR_MIN);
  r.max = String(END_DUR_MAX);
  r.value = String(v);
  $('enddur-out').textContent = `${String(v).replace('.', ',')} s`;
}

// « Selon le style » indique quelles transitions le style donne ; le résumé du menu signale un réglage personnalisé.
function syncTrans() {
  $('trans-auto-label').textContent = `Selon le style (${TRANSITIONS[STYLES[state.style].trans].label.toLowerCase()})`;
  const custom = state.trans !== 'auto';
  $('advanced-badge').hidden = !custom;
  if (custom) $('advanced-badge').textContent = `Transitions : ${TRANSITIONS[state.trans].label.toLowerCase()}`;
}

function setMusic(file, isNew, ref) {
  if (state.music) { state.music.el.pause(); URL.revokeObjectURL(state.music.url); }
  const url = URL.createObjectURL(file);
  state.music = { file, name: file.name, url, el: new Audio(url), buffer: null, ref: ref || null };
  if (isNew) { storeFile('music', file); saveSettings(); }
  $('music-name').textContent = file.name;
  $('music-remove').hidden = false;
}

function setRadio(name, value) {
  const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (r) r.checked = true;
}

// src : data URL d’un logo choisi, DEFAULT_LOGO pour celui de la médiathèque, '' pour aucun.
async function setLogo(src) {
  const isDefault = src === DEFAULT_LOGO;
  state.logoData = isDefault ? undefined : src;
  $('logo-default').hidden = isDefault;
  if (!src) {
    state.logo = null;
    $('logo-preview').hidden = true;
    $('logo-remove').hidden = true;
    return;
  }
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch (e) { if (isDefault) toast('Le logo de la médiathèque est introuvable : vérifiez que le dossier « assets » est en ligne.'); return; }
  state.logo = img;
  $('logo-preview').src = src;
  $('logo-preview').hidden = false;
  $('logo-remove').hidden = false;
}

async function onLogoFile(file) {
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
    const c = makeCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    await setLogo(c.toDataURL('image/png'));
    saveSettings();
    rebuild();
  } catch (e) {
    toast('Ce logo n’a pas pu être lu. Essayez avec un PNG ou un JPEG.');
  }
}

// Met les champs de la page en accord avec les réglages (au démarrage et à l’ouverture d’un projet).
function syncFormFromState() {
  $('f-title').value = state.title;
  $('f-sub').value = state.sub;
  syncTitleDur();
  syncEndDur();
  $('f-end').value = state.endText;
  $('f-handle').value = state.handle;
  $('f-sound').checked = state.keepSound;
  $('f-endscreen').checked = state.endScreen;
  setRadio('style', state.style);
  setRadio('rythme', state.rythme);
  setRadio('landscape', state.landscape);
  setRadio('format', state.format);
  setRadio('trans', state.trans);
  syncTrans();
  // Le menu s’ouvre tout seul si des réglages avancés ont été changés.
  $('advanced').open = state.trans !== 'auto';
  setRadio('filter', state.filter);
  syncColorInputs();
  updateColorGroup();
  return setLogo(state.logoData === undefined ? DEFAULT_LOGO : state.logoData);
}

function initForm() {
  buildSwatches();
  buildFilters();
  syncFormFromState().then(rebuild);
  initProjects();

  $('f-title').addEventListener('input', (e) => { state.title = e.target.value; rebuild(); });
  $('f-sub').addEventListener('input', (e) => { state.sub = e.target.value; rebuild(); });
  $('f-titledur').addEventListener('input', (e) => {
    state.titleDurs[state.style] = clamp(parseFloat(e.target.value), TITLE_DUR_MIN, TITLE_DUR_MAX);
    syncTitleDur();
    saveSettings();
    rebuild();
  });
  $('f-enddur').addEventListener('input', (e) => {
    state.endDurs[state.style] = clamp(parseFloat(e.target.value), END_DUR_MIN, END_DUR_MAX);
    syncEndDur();
    saveSettings();
    rebuild();
  });
  $('f-endscreen').addEventListener('change', (e) => {
    state.endScreen = e.target.checked;
    updateColorGroup();
    saveSettings();
    rebuild();
  });
  $('f-end').addEventListener('input', (e) => { state.endText = e.target.value; saveSettings(); rebuild(); });
  $('f-handle').addEventListener('input', (e) => { state.handle = e.target.value; saveSettings(); rebuild(); });
  $('f-logo').addEventListener('change', (e) => { onLogoFile(e.target.files[0]); e.target.value = ''; });
  $('logo-remove').addEventListener('click', () => { setLogo(''); saveSettings(); rebuild(); });
  $('logo-default').addEventListener('click', () => { setLogo(DEFAULT_LOGO).then(() => { saveSettings(); rebuild(); }); });

  document.querySelectorAll('input[name="style"], input[name="rythme"], input[name="landscape"], input[name="format"], input[name="trans"]').forEach((r) => {
    r.addEventListener('change', () => {
      state[r.name] = r.value;
      saveSettings();
      rebuild();
      renderClipList();
      updateColorGroup();
      syncTitleDur();
      syncEndDur();
      syncTrans();
    });
  });

  $('f-sound').addEventListener('change', (e) => { state.keepSound = e.target.checked; saveSettings(); state.items.forEach(updateRow); });
  $('f-music').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) setMusic(file, true);
  });
  $('music-remove').addEventListener('click', () => {
    if (state.music) { state.music.el.pause(); URL.revokeObjectURL(state.music.url); }
    state.music = null;
    forgetFile('music');
    saveSettings();
    $('music-name').textContent = '';
    $('music-remove').hidden = true;
  });

  // Fichiers vidéo
  const drop = $('drop');
  $('file-clips').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  $('btn-clear').addEventListener('click', () => { [...state.items].forEach(removeItem); });

  // Aperçu
  $('btn-play').addEventListener('click', () => { clearTimeout(restartTimer); if (pv.playing) pause(); else play(); });

  // Tout changement dans la colonne des réglages (champ, case, choix, bouton, fichier) ramène l’aperçu au début.
  // Ces écouteurs sont posés sur le conteneur : ils passent après ceux de chaque champ, une fois le montage recalculé.
  const controls = document.querySelector('.controls');
  controls.addEventListener('input', () => { restartPreview(); markDirty(); });
  controls.addEventListener('change', () => { restartPreview(); markDirty(); });
  controls.addEventListener('click', (e) => {
    const b = e.target.closest('button:not(:disabled)');
    if (b && !b.hasAttribute('data-noreset')) { restartPreview(); markDirty(); }
  });
  initTrim();
  $('scrub').addEventListener('input', (e) => seekPreview(parseFloat(e.target.value)));
  $('opt-safe').addEventListener('change', requestDraw);
  $('btn-sound').addEventListener('click', () => {
    pv.sound = !pv.sound;
    $('btn-sound').setAttribute('aria-pressed', String(pv.sound));
    $('btn-sound').setAttribute('aria-label', pv.sound ? 'Couper le son de l’aperçu' : 'Activer le son de l’aperçu');
    $('snd-on').hidden = !pv.sound;
    $('snd-off').hidden = pv.sound;
    if (pv.playing) { syncVideos(pv.t, true); syncMusic(true); }
  });

  // Export
  $('btn-export').addEventListener('click', startExport);
  $('btn-cancel').addEventListener('click', () => { if (exportCtl) exportCtl.cancelled = true; });
  $('btn-close-done').addEventListener('click', () => { $('result-video').pause(); $('dlg').close(); });
  $('btn-close-err').addEventListener('click', () => $('dlg').close());
  $('dlg').addEventListener('cancel', (e) => { if (exportCtl) e.preventDefault(); });

  window.addEventListener('resize', () => { sizePreview(); requestDraw(); });
}

/* =========================================================================
   Démarrage
   ========================================================================= */

async function boot() {
  if (!MB) {
    document.querySelector('.layout').insertAdjacentHTML('afterbegin', '<p class="warn">La bibliothèque vidéo n’a pas été trouvée. Vérifiez que le dossier « lib » a bien été mis en ligne avec index.html.</p>');
    return;
  }
  loadSettings();
  initForm();
  try {
    await Promise.all([
      document.fonts.load(`400 100px ${FONT.impact}`),
      document.fonts.load(`italic 600 100px ${FONT.serif}`),
      document.fonts.load(`600 100px ${FONT.serif}`),
      document.fonts.load(`700 100px ${FONT.sans}`),
      document.fonts.load(`400 100px ${FONT.sans}`),
      document.fonts.load(`400 100px ${FONT.charteTitle}`),
      document.fonts.load(`400 100px ${FONT.charteText}`),
    ]);
  } catch (e) { /* polices de secours */ }
  const restored = await restoreSession();
  session.ready = true;
  purgeOldSessions();
  setInterval(touchSession, 30000);
  if (restored) {
    renderClipList();
    rebuild();
    runQueue().then(restartPreview);
  } else {
    rebuild();
    seekPreview(state.style === 'dyn' ? 1.2 : 1.8);
  }
  saveSessionNow();
}

boot();

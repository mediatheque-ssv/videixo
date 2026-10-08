/*
 * Videixo — assemble les vidéos d’un évènement en une story Instagram.
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
const STORE_KEY = 'videixo:v1';

const FORMATS = {
  story: { W: 1080, H: 1920, safeTop: 250, safeBottom: 400 },
  post: { W: 1080, H: 1350, safeTop: 90, safeBottom: 90 },
};

// Durées en secondes. clipDur = longueur de l’extrait pris dans chaque vidéo.
const STYLES = {
  charte: { clipDur: { rapide: 1.6, moyen: 2.3, pose: 3.2 }, trans: 0.3, titleDur: 3.2, kb: 0.05, noOutro: true },
  dyn: { clipDur: { rapide: 1.3, moyen: 1.9, pose: 2.7 }, trans: 0.32, introDur: 1.7, outroDur: 2.6, kb: 0.07 },
  doux: { clipDur: { rapide: 2.2, moyen: 3.0, pose: 4.0 }, trans: 0.7, titleDur: 2.8, outroDur: 3.0, kb: 0.05 },
};
const DYN_TRANSITIONS = ['whip', 'zoom', 'push', 'whipR'];

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

const PLACEHOLDER = { title: 'Nuit de la lecture', sub: 'Samedi 18 janvier', handle: '@votre.mediatheque' };
const DEFAULT_END = 'Merci d’être venus !';

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
  handle: '',
  logo: null,       // HTMLImageElement
  logoData: undefined, // undefined : logo de la médiathèque ; '' : pas de logo ; data URL : autre logo
  music: null,      // { file, name, url, el, buffer }
  style: 'charte',
  color: COLORS[0].hex,
  rythme: 'moyen',
  landscape: 'blur',
  keepSound: true,
  format: 'story',
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    for (const k of ['endText', 'handle', 'style', 'color', 'rythme', 'landscape', 'keepSound', 'format', 'logoData']) {
      if (s[k] !== undefined && s[k] !== null) state[k] = s[k];
    }
    if (!STYLES[state.style]) state.style = 'charte';
    if (!FORMATS[state.format]) state.format = 'story';
    if (!STYLES.dyn.clipDur[state.rythme]) state.rythme = 'moyen';
  } catch (e) { /* stockage indisponible : on garde les valeurs par défaut */ }
}

function saveSettings() {
  try {
    const { endText, handle, style, color, rythme, landscape, keepSound, format, logoData } = state;
    localStorage.setItem(STORE_KEY, JSON.stringify({ endText, handle, style, color, rythme, landscape, keepSound, format, logoData }));
  } catch (e) { /* quota dépassé ou stockage bloqué : sans gravité */ }
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
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const whole = Math.floor(r);
  const tenth = Math.floor((r - whole) * 10);
  return `${m}:${String(whole).padStart(2, '0')},${tenth}`;
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

function clipLength() { return STYLES[state.style].clipDur[state.rythme]; }

function segDurFor(item) {
  const L = clipLength();
  if (item.kind === 'image') return L;
  return Math.max(0.6, Math.min(L, item.duration));
}

// Texte d’un champ : en aperçu, un exemple grisé remplace un champ vide ; à l’export, rien.
function textOf(field, forExport) {
  const v = (state[field] || '').trim();
  if (v) return { text: v, ghost: false };
  if (!forExport && PLACEHOLDER[field]) return { text: PLACEHOLDER[field], ghost: true };
  return null;
}

function buildTimeline(forExport = false) {
  const S = STYLES[state.style];
  const F = FORMATS[state.format];
  const media = state.items.filter((i) => i.ok);
  const title = textOf('title', forExport);
  const sub = textOf('sub', forExport);
  const handle = textOf('handle', forExport);
  const endText = (state.endText || '').trim();
  const segs = [];

  if (state.style === 'dyn' && title) segs.push({ type: 'intro', dur: S.introDur });
  media.forEach((item, k) => {
    const dur = segDurFor(item);
    const srcIn = item.kind === 'video' ? clamp(item.start, 0, Math.max(0, item.duration - dur)) : 0;
    segs.push({ type: 'media', item, dur, srcIn, idx: k });
  });
  // Aperçu sans vidéo : un fond gris tient la place des vidéos, comme sur les gabarits d’affiche.
  if (!forExport && !media.length) segs.push({ type: 'blank', dur: Math.max(2.4, (S.titleDur || 0) + 0.4), idx: 0 });
  if (!S.noOutro && (!forExport || endText || state.logo || handle)) segs.push({ type: 'outro', dur: S.outroDur });
  if (!segs.length) segs.push({ type: 'blank', dur: 2.4, idx: 0 });

  segs.forEach((s, i) => {
    if (i === 0) { s.start = 0; s.transIn = null; return; }
    const prev = segs[i - 1];
    let kind;
    if (state.style === 'doux' || state.style === 'charte') kind = 'fade';
    else if (prev.type === 'intro') kind = 'uncover';
    else if (s.type === 'outro') kind = 'cover';
    else kind = DYN_TRANSITIONS[s.idx % DYN_TRANSITIONS.length];
    const td = Math.min(S.trans, prev.dur * 0.45, s.dur * 0.45);
    s.transIn = { kind, dur: td };
    s.start = prev.start + prev.dur - td;
  });

  const last = segs[segs.length - 1];
  return {
    segs, S, F, W: F.W, H: F.H,
    total: last.start + last.dur,
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
  if (tl.style === 'charte') {
    drawTitleCharte(ctx, tl, t);
    drawCartoucheOverlay(ctx, tl, t);
  }
  ctx.restore();
}

function drawSeg(ctx, tl, seg, t, frameOf) {
  const lt = t - seg.start;
  ctx.save();
  if (seg.type === 'intro') drawIntroDyn(ctx, tl, lt);
  else if (seg.type === 'outro') (tl.style === 'dyn' ? drawOutroDyn : drawOutroDoux)(ctx, tl, lt);
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
  return state.landscape === 'blur' && (item.w / item.h) > (W / H) * 1.35;
}

function drawMediaSeg(ctx, tl, seg, lt, fr) {
  const { W, H } = tl;
  const item = seg.item;
  const p = clamp(lt / seg.dur);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  if (fr) {
    const isImage = item.kind === 'image';
    const zoom = 1 + tl.S.kb * (isImage ? 1.8 : 1) * (isImage ? p : easeOutCubic(p));
    if (usesContain(item, W, H)) {
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
  }
  if (item.caption && item.caption.trim()) {
    if (tl.style === 'dyn') drawCaptionDyn(ctx, tl, item.caption.trim(), lt);
    else {
      const delay = tl.title && seg.start < tl.S.titleDur ? tl.S.titleDur - seg.start : 0.3;
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
  fit.lines.forEach((line, i) => {
    const d = 0.08 + i * 0.1;
    const q = clamp((lt - d) / 0.42);
    if (q <= 0) return;
    const s = 1 + (1 - easeOutBack(q)) * 0.35;
    const cx = x0 + fit.widths[i] / 2;
    const cy = top + i * lh + lh * 0.5;
    ctx.save();
    ctx.globalAlpha = clamp(q * 3) * ghost;
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.font = fit.font;
    ctx.fillStyle = on;
    ctx.fillText(line, 0, fit.size * 0.42);
    ctx.restore();
  });

  if (tl.sub) {
    const d = 0.1 + fit.lines.length * 0.1 + 0.15;
    const q = clamp((lt - d) / 0.35);
    if (q > 0) {
      const e = easeOutCubic(q);
      const subFit = fitText(ctx, tl.sub.text.toUpperCase(), { family: FONT.impact, maxW: W - 2 * x0 - 64, maxLines: 1, max: 54, min: 32 });
      const pw = subFit.widths[0] + 64;
      const py = top + fit.lines.length * lh + 44 + (1 - e) * 40;
      ctx.save();
      ctx.globalAlpha = e * (tl.sub.ghost ? 0.5 : 1);
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
  const D = tl.S.titleDur;
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
    const q = clamp((t - 0.15 - i * 0.18) / 0.8);
    if (q <= 0) return;
    const e = easeOutCubic(q);
    ctx.globalAlpha = e * out * ghost;
    ctx.fillText(l, W / 2, top + (i + 0.85) * lh + (1 - e) * 26);
  });
  ctx.restore();

  if (tl.sub) {
    const q = clamp((t - 0.55 - fit.lines.length * 0.12) / 0.8);
    if (q > 0) {
      const e = easeOutCubic(q);
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
      ctx.globalAlpha = e * out * (tl.sub.ghost ? 0.5 : 1);
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

// Tracés du cartouche et de ses rubans, relevés dans la charte (unités du gabarit, origine en haut à gauche).
// Le bord du haut du cartouche mesure 108,09 unités : 1/3 de la largeur de l’image.
const CARTOUCHE = {
  top: 108.09,
  height: 80.66,
  shapes: [
    { color: CHARTE.anis, path: [
      ['M', 138.508, 0], ['C', 136.921, 21.735, 133.433, 43.114, 128.14, 63.875],
      ['L', 35.471, 36.47], ['C', 37.837, 24.471, 39.611, 12.299, 40.771, 0]] },
    { color: CHARTE.petrole, path: [
      ['M', 128.14, 63.875], ['L', 31.616, 59.163], ['C', 30.748, 39.445, 28.27, 19.653, 24.168, 0],
      ['L', 123.218, 0], ['C', 126.74, 21.281, 128.372, 42.661, 128.14, 63.875]] },
    { color: '#FFFFFF', path: [
      ['M', 128.14, 63.875], ['L', 32.971, 80.658], ['C', 25.564, 53.616, 14.96, 27.147, 1.239, 1.852],
      ['L', 0, 0], ['L', 108.09, 0], ['C', 116.773, 20.814, 123.469, 42.208, 128.14, 63.875]] },
  ],
  // Zone réservée au logo, à l’intérieur du cartouche.
  logoBox: { x: 28, y: 10, w: 68, h: 46 },
};

function cartoucheLayout(tl) {
  const s = (tl.W / 3) / CARTOUCHE.top;
  const b = CARTOUCHE.logoBox;
  const box = { x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s };
  let logo = null;
  if (tl.logo) {
    const k = Math.min(box.w / tl.logo.naturalWidth, box.h / tl.logo.naturalHeight);
    const w = tl.logo.naturalWidth * k, h = tl.logo.naturalHeight * k;
    logo = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }
  return { s, logo, textX: logo ? logo.x : box.x, bottom: CARTOUCHE.height * s };
}

function drawCartouche(ctx, tl, L, dy, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, dy);
  CARTOUCHE.shapes.forEach((shape, i) => {
    ctx.save();
    if (i === 0) {
      ctx.shadowColor = 'rgba(0,0,0,0.22)';
      ctx.shadowBlur = 26;
      ctx.shadowOffsetY = 6;
    }
    ctx.beginPath();
    for (const c of shape.path) {
      if (c[0] === 'M') ctx.moveTo(c[1] * L.s, c[2] * L.s);
      else if (c[0] === 'L') ctx.lineTo(c[1] * L.s, c[2] * L.s);
      else ctx.bezierCurveTo(c[1] * L.s, c[2] * L.s, c[3] * L.s, c[4] * L.s, c[5] * L.s, c[6] * L.s);
    }
    ctx.closePath();
    ctx.fillStyle = shape.color;
    ctx.fill();
    ctx.restore();
  });
  if (L.logo) ctx.drawImage(tl.logo, L.logo.x, L.logo.y, L.logo.w, L.logo.h);
  ctx.restore();
}

// Le cartouche descend au début et reste en place jusqu’à la fin, où il s’efface.
function drawCartoucheOverlay(ctx, tl, t) {
  if (!tl.logo) return;
  if (!tl.segs.some((s) => s.type === 'media' || s.type === 'blank')) return;
  let alpha = 1;
  const outro = tl.segs.find((s) => s.type === 'outro');
  if (outro && t >= outro.start) {
    const d = outro.transIn ? outro.transIn.dur : 0.01;
    alpha = 1 - clamp((t - outro.start) / d);
    if (alpha <= 0) return;
  }
  const L = cartoucheLayout(tl);
  const q = easeOutCubic(clamp((t - 0.1) / 0.7));
  drawCartouche(ctx, tl, L, -(1 - q) * (L.bottom + 40), alpha);
}

// Date en colonne, comme sur les affiches : « XX / Mois / Année ».
function dateLines(text) {
  const m = text.match(/^(.*?)(\d{1,2}(?:er)?)\s+([A-Za-zÀ-ÿ]+\.?)\s*(\d{4})?\s*[,;–-]?\s*(.*)$/);
  if (!m) return null;
  const lines = [(m[1].trim() ? m[1].trim() + ' ' : '') + m[2], m[3]];
  if (m[4]) lines.push(m[4]);
  if (m[5] && m[5].trim()) lines.push(m[5].trim());
  if (lines.length > 3) lines.splice(2, lines.length - 2, lines.slice(2).join(' '));
  return lines;
}

function drawTitleCharte(ctx, tl, t) {
  if (!tl.title) return;
  const D = tl.S.titleDur;
  if (t >= D) return;
  const { W, H } = tl;
  const out = clamp((D - t) / 0.6);
  const L = cartoucheLayout(tl);
  const x0 = L.textX;

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
  const firstBase = L.bottom + fit.size * 0.62 + fit.size * 0.78;

  ctx.save();
  ctx.font = fit.font;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 18;
  fit.lines.forEach((l, i) => {
    const q = clamp((t - 0.45 - i * 0.14) / 0.7);
    if (q <= 0) return;
    const e = easeOutCubic(q);
    ctx.globalAlpha = e * out * ghost;
    ctx.fillText(l, x0 - (1 - e) * 40, firstBase + i * lh);
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
    const q = clamp((t - 0.95 - i * 0.1) / 0.6);
    if (q <= 0) return;
    ctx.globalAlpha = easeOutCubic(q) * out * (tl.sub.ghost ? 0.5 : 1);
    ctx.fillText(l, dx, dTop + dsize * 0.8 + i * dLH);
  });
  ctx.restore();
}

function drawCaptionCharte(ctx, tl, text, lt, dur, delay) {
  const { W, H, F } = tl;
  const a = clamp((lt - delay) / 0.5) * clamp((dur - lt) / 0.4);
  if (a <= 0) return;
  const x0 = cartoucheLayout(tl).textX;
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
  fit.lines.forEach((l, i) => ctx.fillText(l, x0, bottom - (fit.lines.length - 1 - i) * lh));
  ctx.restore();
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
  ctx.fillText('Vos vidéos ici', W / 2, H * 0.72);
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

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  let added = 0;
  for (const file of files) {
    const video = isVideoFile(file);
    if (!video && !isImageFile(file)) { toast(`« ${file.name} » n’est ni une vidéo ni une photo.`); continue; }
    const item = {
      id: nextId++, kind: video ? 'video' : 'image', file, name: file.name,
      caption: '', start: 0, userStart: false, ok: false, status: 'loading', progress: 0,
    };
    state.items.push(item);
    queue.push(item);
    added++;
  }
  if (!added) return;
  renderClipList();
  rebuild();
  runQueue();
}

function runQueue() {
  if (queueRunning) return queueRunning;
  queueRunning = (async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item.removed) continue;
      if (item.kind === 'video') {
        await probeVideo(item);
        if (item.ok && !item.removed) await analyzeVideo(item);
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

    item.start = Math.min(item.duration * 0.3, Math.max(0, item.duration - segDurFor(item)));
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
  item.samples = samples;
  item.status = 'ready';
  if (!item.userStart) item.start = bestStart(item, segDurFor(item));
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
};

function makeRow(item) {
  const li = document.createElement('li');
  li.className = 'clip';
  li.innerHTML = `
    <span class="clip-num"></span>
    <canvas class="thumb" width="108" height="192" aria-hidden="true"></canvas>
    <div class="clip-body">
      <p class="clip-name"></p>
      <p class="clip-meta"></p>
      <div class="clip-extract" hidden>
        <label for="start-${item.id}">Extrait</label>
        <output for="start-${item.id}"></output>
        <input type="range" id="start-${item.id}" min="0" max="1" step="0.1" value="0">
      </div>
      <label class="sr-only" for="cap-${item.id}">Légende affichée sur ce plan</label>
      <input type="text" id="cap-${item.id}" maxlength="60" placeholder="Légende (facultatif)">
      <p class="clip-status" role="status"></p>
    </div>
    <div class="clip-actions">
      <button type="button" class="icon-btn" data-act="up" aria-label="Monter">${ICONS.up}</button>
      <button type="button" class="icon-btn" data-act="down" aria-label="Descendre">${ICONS.down}</button>
      <button type="button" class="icon-btn" data-act="remove" aria-label="Retirer">${ICONS.remove}</button>
    </div>`;
  li.querySelector('.clip-name').textContent = item.name;
  const range = li.querySelector('input[type="range"]');
  range.addEventListener('input', () => {
    item.start = parseFloat(range.value);
    item.userStart = true;
    updateExtractLabel(item);
    rebuild();
    const seg = tl.segs.find((s) => s.item === item);
    if (seg) seekPreview(seg.start + Math.min(0.4, seg.dur / 3));
    scheduleThumb(item);
    updateRowStatus(item);
  });
  const cap = li.querySelector('input[type="text"]');
  cap.addEventListener('input', () => {
    item.caption = cap.value;
    const seg = tl.segs.find((s) => s.item === item);
    if (seg && !pv.playing) seekPreview(seg.start + Math.min(seg.dur * 0.6, 0.9));
    else requestDraw();
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
  const L = segDurFor(item);
  const a = clamp(item.start, 0, Math.max(0, item.duration - L));
  item.row.querySelector('output').textContent = `${fmtTimeTenths(a)} → ${fmtTimeTenths(a + L)}`;
}

function updateRow(item) {
  const li = item.row;
  if (!li) return;
  li.classList.toggle('is-error', item.status === 'error');
  const meta = li.querySelector('.clip-meta');
  if (item.kind === 'image') meta.textContent = 'Photo';
  else if (item.ok) meta.innerHTML = `<span class="num">${fmtTime(item.duration)}</span>, ${item.w >= item.h ? 'horizontale' : 'verticale'}${item.at ? '' : ', sans son'}`;
  else meta.textContent = 'Vidéo';
  const ext = li.querySelector('.clip-extract');
  const range = ext.querySelector('input');
  if (item.kind === 'video' && item.ok) {
    const L = segDurFor(item);
    const max = Math.max(0, item.duration - L);
    ext.hidden = false;
    range.max = String(Math.max(0.1, Math.round(max * 10) / 10));
    range.disabled = max < 0.1;
    range.value = String(clamp(item.start, 0, max));
    updateExtractLabel(item);
  } else {
    ext.hidden = true;
  }
  li.querySelector('input[type="text"]').hidden = item.status === 'error';
  updateRowStatus(item);
}

function updateRowStatus(item) {
  const li = item.row;
  if (!li) return;
  const st = li.querySelector('.clip-status');
  let msg = '';
  if (item.status === 'loading') msg = 'Lecture du fichier…';
  else if (item.status === 'analyzing') msg = `Recherche du meilleur passage… ${Math.round((item.progress || 0) * 100)} %`;
  else if (item.status === 'error') msg = item.error;
  else if (item.kind === 'video' && item.duration - segDurFor(item) < 0.1) msg = 'Vidéo courte : utilisée en entier.';
  else if (item.kind === 'video' && !item.userStart) msg = 'Passage choisi automatiquement.';
  st.textContent = msg;
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
      requestDraw();
    }
    const s = Math.max(c.width / w, c.height / h);
    cx.fillStyle = '#000000';
    cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(src, (c.width - w * s) / 2, (c.height - h * s) / 2, w * s, h * s);
  } catch (e) {
    console.warn('Vignette impossible', e);
  }
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
      const s = bestStart(item, segDurFor(item));
      if (s !== item.start) { item.start = s; scheduleThumb(item); }
    }
  }
  tl = buildTimeline(false);
  pv.t = Math.min(pv.t, tl.total - 0.001);
  $('scrub').max = String(tl.total);
  sizePreview();
  updateSummary();
  requestDraw();
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
    const want = Math.min(seg.srcIn + (t - seg.start), seg.item.duration - 0.05);
    if (active) {
      const audible = pv.sound && state.keepSound && !!seg.item.at;
      v.muted = !audible;
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
    pv.t = 0;
    pv.t0 = performance.now();
    if (state.music) state.music.el.currentTime = 0;
  }
  syncVideos(pv.t, true);
  syncMusic(true);
  draw();
  pv.raf = requestAnimationFrame(loop);
}

function play() {
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
  if (pv.playing) pause();
  pv.t = clamp(t, 0, tl.total - 0.001);
  syncVideos(pv.t, false);
  requestDraw();
}

function updateSummary() {
  const media = state.items.filter((i) => i.ok);
  const busy = state.items.some((i) => i.status === 'loading' || i.status === 'analyzing');
  const exportTl = buildTimeline(true);
  const { W, H } = exportTl;
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
  const withVideoSound = state.keepSound && tlx.segs.some((s) => s.type === 'media' && s.item.at);
  if (!withVideoSound && !state.music) return null;
  const length = Math.ceil(tlx.total * SR);
  const oc = new OfflineAudioContext(2, length, SR);
  const videoGain = state.music ? 0.45 : 1;

  if (withVideoSound) {
    for (let i = 0; i < tlx.segs.length; i++) {
      const seg = tlx.segs[i];
      if (seg.type !== 'media' || !seg.item.at) continue;
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
  const margin = 1 + tlx.S.kb + 0.03;
  const need = usesContain(item, W, H)
    ? Math.min(W / item.w, H / item.h) * margin
    : Math.max(W / item.w, H / item.h) * margin;
  const s = Math.min(1, need);
  const width = Math.max(2, Math.round((item.w * s) / 2) * 2);
  const height = Math.max(2, Math.round((item.h * s) / 2) * 2);
  const sink = new MB.CanvasSink(item.vt, { width, height, fit: 'fill', poolSize: 2 });
  const stamps = [];
  for (let i = 0; i < N; i++) {
    const t = i / FPS;
    if (t >= seg.start && t < seg.start + seg.dur) {
      stamps.push(item.t0 + Math.min(seg.srcIn + (t - seg.start), item.duration - 0.02));
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
  if (!tlx.segs.some((s) => s.type === 'media')) throw new UserError('Ajoutez au moins une vidéo lisible.');
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

// Le style Médiathèque suit la charte et n’a pas d’écran de fin : la couleur, le texte de fin
// et le compte Instagram ne servent qu’aux deux autres styles.
function updateColorGroup() {
  const charte = state.style === 'charte';
  $('color-group').hidden = charte;
  $('field-end').hidden = charte;
  $('field-handle').hidden = charte;
  $('field-sub').classList.toggle('wide', charte);
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
    const outro = tl.segs.find((x) => x.type === 'outro');
    if (outro) seekPreview(outro.start + 1.4);
  } catch (e) {
    toast('Ce logo n’a pas pu être lu. Essayez avec un PNG ou un JPEG.');
  }
}

function initForm() {
  $('f-title').value = state.title;
  $('f-sub').value = state.sub;
  $('f-end').value = state.endText;
  $('f-handle').value = state.handle;
  $('f-sound').checked = state.keepSound;
  setRadio('style', state.style);
  setRadio('rythme', state.rythme);
  setRadio('landscape', state.landscape);
  setRadio('format', state.format);
  buildSwatches();
  syncColorInputs();
  setLogo(state.logoData === undefined ? DEFAULT_LOGO : state.logoData).then(rebuild);
  updateColorGroup();

  const showIntro = () => { if (!pv.playing) seekPreview(state.style === 'dyn' ? 1.2 : 1.8); };
  const showOutro = () => {
    if (pv.playing) return;
    const o = tl.segs.find((x) => x.type === 'outro');
    if (o) seekPreview(o.start + Math.min(o.dur - 0.05, 1.8));
  };

  $('f-title').addEventListener('input', (e) => { state.title = e.target.value; rebuild(); showIntro(); });
  $('f-sub').addEventListener('input', (e) => { state.sub = e.target.value; rebuild(); showIntro(); });
  $('f-end').addEventListener('input', (e) => { state.endText = e.target.value; saveSettings(); rebuild(); showOutro(); });
  $('f-handle').addEventListener('input', (e) => { state.handle = e.target.value; saveSettings(); rebuild(); showOutro(); });
  $('f-logo').addEventListener('change', (e) => { onLogoFile(e.target.files[0]); e.target.value = ''; });
  $('logo-remove').addEventListener('click', () => { setLogo(''); saveSettings(); rebuild(); });
  $('logo-default').addEventListener('click', () => { setLogo(DEFAULT_LOGO).then(() => { saveSettings(); rebuild(); }); });

  document.querySelectorAll('input[name="style"], input[name="rythme"], input[name="landscape"], input[name="format"]').forEach((r) => {
    r.addEventListener('change', () => {
      state[r.name] = r.value;
      saveSettings();
      rebuild();
      renderClipList();
      updateColorGroup();
      if (r.name === 'style') showIntro();
    });
  });

  $('f-sound').addEventListener('change', (e) => { state.keepSound = e.target.checked; saveSettings(); });
  $('f-music').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (state.music) { state.music.el.pause(); URL.revokeObjectURL(state.music.url); }
    const url = URL.createObjectURL(file);
    state.music = { file, name: file.name, url, el: new Audio(url), buffer: null };
    $('music-name').textContent = file.name;
    $('music-remove').hidden = false;
  });
  $('music-remove').addEventListener('click', () => {
    if (state.music) { state.music.el.pause(); URL.revokeObjectURL(state.music.url); }
    state.music = null;
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
  $('btn-play').addEventListener('click', () => (pv.playing ? pause() : play()));
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
  rebuild();
  seekPreview(state.style === 'dyn' ? 1.2 : 1.8);
}

boot();

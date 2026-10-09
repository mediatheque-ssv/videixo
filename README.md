# Vidéixo

<img src="assets/videixo-512.png" alt="Logo de Vidéixo : Ixo, le chihuahua noir et blanc" width="128">

Une petite application web pour transformer les vidéos ou les photos d’un évènement de la médiathèque en une vidéo dynamique, prête à poster sur Instagram (story, réel ou publication).

On dépose les clips filmés au téléphone ou les photos, l’outil choisit automatiquement un passage de quelques secondes dans chaque vidéo, anime les photos, enchaîne le tout avec des transitions, ajoute le titre de l’évènement et le logo, puis fabrique un fichier MP4.

Tout se passe dans le navigateur : les vidéos ne sont envoyées sur aucun serveur, ni sur GitHub ni ailleurs. GitHub sert uniquement à héberger la page.

## Ce que fait l’outil

- Accepte des vidéos, des photos, ou un mélange des deux, dans l’ordre de votre choix. Les photos sont animées par un léger zoom.
- Choisit dans chaque vidéo le passage le plus net et le plus animé, en évitant les débuts tremblants et les plans sombres. Un curseur à deux poignées permet de régler le début et la fin de chaque extrait, et donc sa durée.
- Trois styles :
  - **Médiathèque** (par défaut) : la charte graphique de la médiathèque, voir plus bas ;
  - **Dynamique** : coupes rapides, gros titre, transitions glissées ;
  - **Doux** : fondus enchaînés, titre en italique.
- Titre et sous-titre facultatif (une date, un lieu, un public…) au début, légende facultative sur chaque plan, et un écran de fin avec le logo, un message et le compte Instagram (activé par défaut, peut être décoché).
- Couleur au choix, trois rythmes, format 9:16 (story ou réel) ou 4:5 (publication).
- Garde le son des vidéos et peut ajouter une musique (libre de droits).
- Exporte un MP4 1080 × 1920 (H.264 + AAC), le format attendu par Instagram. Sur téléphone, le bouton « Partager » l’envoie directement à Instagram.
- Le logo, le compte, la couleur et les réglages sont mémorisés sur l’appareil pour les fois suivantes.

## Mettre l’outil en ligne avec GitHub Pages (une seule fois, 10 minutes)

1. Créez un compte sur [github.com](https://github.com) si la médiathèque n’en a pas.
2. Cliquez sur **New repository** (bouton vert « New » ou menu « + » en haut à droite).
   - Nom : par exemple `videixo` (sans accent : il apparaîtra dans l’adresse).
   - Cochez **Public** (GitHub Pages gratuit l’exige ; seule la page est publique, jamais vos vidéos).
   - Cliquez sur **Create repository**.
3. Sur la page du dépôt, cliquez sur **uploading an existing file** (ou **Add file › Upload files**).
4. Glissez **tout le contenu** du dossier `videixo` : `index.html`, `app.js`, `README.md` et les dossiers `assets`, `lib` et `fonts`. Les dossiers doivent garder leur nom.
5. Cliquez sur **Commit changes**.
6. Allez dans **Settings › Pages**. Sous « Build and deployment », choisissez **Deploy from a branch**, branche **main**, dossier **/ (root)**, puis **Save**.
7. Attendez une à deux minutes. L’adresse de l’outil s’affiche en haut de cette page, de la forme :
   `https://nom-du-compte.github.io/videixo/`

Ajoutez cette adresse aux favoris des postes de la médiathèque et sur l’écran d’accueil des téléphones de service.

### Mettre à jour plus tard

Pour remplacer un fichier (par exemple une nouvelle version de `app.js`), refaites **Add file › Upload files** avec le nouveau fichier : il remplace l’ancien. La page en ligne se met à jour en une à deux minutes.

## Utilisation

1. Ouvrez l’adresse de l’outil dans **Chrome**, **Edge** ou **Safari** (versions récentes).
2. Déposez les vidéos ou les photos de l’évènement. L’analyse prend quelques secondes par vidéo.
3. Remplissez le titre et, si vous voulez, le sous-titre. Laissez cochée « Ajouter un écran de fin » pour terminer sur le logo et un message.
4. Choisissez le style, la couleur et le rythme. À chaque modification, l’aperçu repart du début et se lance tout seul ; le bouton lecture permet de le revoir.
5. Cliquez sur **Créer la vidéo**, puis **Télécharger** (ordinateur) ou **Partager vers Instagram** (téléphone).

### Conseils

- **Nombre de vidéos** : 5 à 10 clips donnent une story de 15 à 25 secondes, la durée qui fonctionne le mieux. Au-delà de 60 secondes, Instagram coupe la story en plusieurs parties.
- **Zones cachées** : cochez « Montrer les zones cachées par Instagram » pour vérifier que rien d’important n’est masqué par le nom du compte en haut ou la barre de réponse en bas.
- **Musique** : n’utilisez que des musiques libres de droits. Sinon, ajoutez la musique directement dans Instagram au moment de publier.
- **Droit à l’image** : comme pour les photos, vérifiez que les personnes filmées, et en particulier les enfants, ont donné leur accord.
- **Durée de fabrication** : de quelques secondes à environ une minute selon l’ordinateur. Gardez la page ouverte pendant ce temps.

### Si une vidéo est refusée

- *« Ce navigateur ne sait pas lire cette vidéo »* : c’est souvent une vidéo d’iPhone au format HEVC ouverte dans Chrome sur un ordinateur sans décodeur HEVC. Ouvrez l’outil avec Safari, ou réglez l’iPhone sur **Réglages › Appareil photo › Formats › Le plus compatible** pour les prochains tournages.
- *Photos HEIC* : même cause ; utilisez Safari ou convertissez la photo en JPEG.
- *« Ce navigateur ne sait pas fabriquer de vidéo »* : mettez à jour le navigateur. Firefox récent fonctionne en général, mais Chrome, Edge et Safari sont les plus sûrs.

## La charte graphique dans le style « Médiathèque »

Le style Médiathèque reprend la charte des gabarits d’affiches de Servon-sur-Vilaine (Approche Design, novembre 2023) :

- les **polices** et les **couleurs** de la charte ;
- le **titre** en haut à gauche, sous le nom du compte qu’Instagram affiche en story ; le **sous-titre** à sa droite, en colonne quand c’est une date (« Samedi 18 / janvier / 2025 ») ;
- des **fondus courts** entre les vidéos ;
- l’**écran de fin** : fond blanc, logo de la médiathèque, message en pétrole et compte Instagram.

Le logo n’apparaît que sur l’écran de fin. Le cartouche et le bandeau du bas des affiches ne sont pas repris.

### Le logo

Le logo de la médiathèque est inclus (`assets/logo-mediatheque.png`) et utilisé par défaut. Il a été découpé dans une capture d’écran, donc en définition moyenne. Pour un rendu plus net, remplacez ce fichier par la version haute définition du logo (PNG à fond transparent), en gardant le même nom.

### Les polices

La charte utilise **Plover Light** pour les titres et **Calibri** pour les textes. Ces polices sont payantes et ne peuvent pas être incluses telles quelles :

- si elles sont installées sur l’ordinateur, l’outil les utilise automatiquement ;
- sinon, il utilise **Advent Pro**, proche de Plover, et **Carlito**, l’équivalent libre de Calibri aux mêmes dimensions ;
- si la médiathèque dispose d’une licence web pour Plover Light, déposez le fichier sous le nom `fonts/plover-light.woff2` : tous les appareils l’utiliseront.

## Personnaliser

Les réglages modifiables se trouvent en haut de `app.js` :

- `CHARTE` : les couleurs de la charte, utilisées par le style Médiathèque ;
- `COLORS` : les pastilles de couleur des styles Dynamique et Doux (couleurs de la charte par défaut) ;
- `STYLES` : la durée des plans pour chaque rythme, la durée du titre et de la fin ;
- `DEFAULT_END` : le texte de fin proposé par défaut (« Merci d’être venu·es ! ») ;
- `handle` dans `state` : le compte Instagram prérempli (@mediatheque.servon.sur.vilaine).

## Le logo de Vidéixo

Ixo, le chihuahua noir et blanc, dessiné en vecteur sur fond anis (`assets/videixo.svg`). Il sert d’icône dans l’onglet du navigateur et sur l’écran d’accueil des téléphones (`favicon-32.png`, `apple-touch-icon.png`).

## Fichiers

```
index.html   la page
app.js       le montage (aperçu, analyse, export)
assets/      logo de la médiathèque, logo et icônes de Vidéixo
lib/         Mediabunny, bibliothèque de lecture et d’écriture vidéo (licence MPL-2.0)
fonts/       polices Advent Pro, Carlito, Anton, Literata et Atkinson Hyperlegible (licence SIL OFL 1.1)
```

Les polices sont incluses dans le dépôt plutôt que chargées depuis Google Fonts : la page ne contacte aucun service tiers.

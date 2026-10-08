# Videixo

Une petite application web pour transformer les vidéos d’un évènement de la médiathèque en une vidéo dynamique, prête à poster sur Instagram (story, réel ou publication).

On dépose les clips filmés au téléphone, l’outil choisit automatiquement un passage de quelques secondes dans chacun, les enchaîne avec des transitions, ajoute le titre de l’évènement au début et le logo à la fin, puis fabrique un fichier MP4.

Tout se passe dans le navigateur : les vidéos ne sont envoyées sur aucun serveur, ni sur GitHub ni ailleurs. GitHub sert uniquement à héberger la page.

## Ce que fait l’outil

- Accepte plusieurs vidéos (et des photos si besoin), dans l’ordre de votre choix.
- Choisit dans chaque vidéo le passage le plus net et le plus animé, en évitant les débuts tremblants et les plans sombres. Un curseur permet d’en prendre un autre.
- Trois styles :
  - **Médiathèque** (par défaut) : la charte graphique de la médiathèque, voir plus bas ;
  - **Dynamique** : coupes rapides, gros titre, transitions glissées ;
  - **Doux** : fondus enchaînés, titre en italique.
- Titre et date au début, texte de fin, logo et compte Instagram à la fin, légende facultative sur chaque plan.
- Couleur au choix, trois rythmes, format 9:16 (story ou réel) ou 4:5 (publication).
- Garde le son des vidéos et peut ajouter une musique (libre de droits).
- Exporte un MP4 1080 × 1920 (H.264 + AAC), le format attendu par Instagram. Sur téléphone, le bouton « Partager » l’envoie directement à Instagram.
- Le logo, le compte, la couleur et les réglages sont mémorisés sur l’appareil pour les fois suivantes.

## Mettre l’outil en ligne avec GitHub Pages (une seule fois, 10 minutes)

1. Créez un compte sur [github.com](https://github.com) si la médiathèque n’en a pas.
2. Cliquez sur **New repository** (bouton vert « New » ou menu « + » en haut à droite).
   - Nom : par exemple `videixo`.
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
2. Déposez les vidéos de l’évènement. L’analyse prend quelques secondes par vidéo.
3. Remplissez le titre, la date, et la première fois le compte Instagram et le logo.
4. Choisissez le style, la couleur et le rythme. Le bouton lecture sous l’aperçu montre le résultat.
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

- le **cartouche** blanc avec ses rubans pétrole et anis, accroché en haut à gauche comme sur les affiches, d’un tiers de la largeur de l’image, avec le logo de la médiathèque à l’intérieur. Il descend au début de la vidéo et reste en place jusqu’à la fin ;
- le **titre** aligné sur le bord gauche du logo, la **date** en colonne à sa droite (« 18 / janvier / 2025 ») ;
- des **fondus courts** entre les vidéos, et pas d’écran de fin : la vidéo se termine sur la dernière image.

Le bandeau du bas des affiches n’est pas repris. Les champs « Texte de fin » et « Compte Instagram » ne servent qu’aux styles Dynamique et Doux ; ils sont masqués quand le style Médiathèque est choisi.

En format story, Instagram affiche le nom du compte en haut à gauche, par-dessus le haut du cartouche. Cochez « Montrer les zones cachées par Instagram » pour voir ce qui est recouvert.

### Le logo

Le logo de la médiathèque est inclus (`assets/logo-mediatheque.png`) et utilisé par défaut. Il a été découpé dans le PDF de la charte, donc en définition moyenne. Pour un rendu plus net, remplacez ce fichier par la version haute définition du logo (PNG à fond transparent), en gardant le même nom.

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
- `DEFAULT_END` : le texte de fin proposé par défaut.

## Fichiers

```
index.html   la page
app.js       le montage (aperçu, analyse, export)
assets/      logo de la médiathèque
lib/         Mediabunny, bibliothèque de lecture et d’écriture vidéo (licence MPL-2.0)
fonts/       polices Advent Pro, Carlito, Anton, Literata et Atkinson Hyperlegible (licence SIL OFL 1.1)
```

Les polices sont incluses dans le dépôt plutôt que chargées depuis Google Fonts : la page ne contacte aucun service tiers.

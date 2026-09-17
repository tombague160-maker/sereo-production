// Palettes pastel et themes applicatifs.
//
// Donnees pures, sans logique. Chaque theme declare `vars` (mode clair) et
// `darkVars` (mode sombre) ; applyTheme les pose en variables CSS sur :root.
// Toute couleur ajoutee ici doit exister dans les deux jeux, sinon le mode
// sombre herite d'une valeur claire et devient illisible.

export const DEFAULT_BRAND_IMAGE = "/brand/sereo-logo.svg";

export const DEFAULT_BRAND_IMAGE_DARK = "/brand/sereo-logo-dark.svg";

export const DEFAULT_BRAND_CACHE_VERSION = "20260701";

export const MAX_BRAND_IMAGE_SIZE = 2 * 1024 * 1024;

// Palette unique de l'application -- PHASE 4, MARCHE 2 : elle parle V8.
//
// Chaque ancien nom (--color-*, --neo-*) pointe desormais sur un JETON V8
// (--v8-*), defini une seule fois dans style.css a partir de la charte
// design/DESIGN.md. Ce fichier n'est plus une palette : c'est une TABLE DE
// CORRESPONDANCE entre les noms que le CSS emploie encore et la couche unique
// qui les remplacera. Quand un composant est porte sur --v8-* directement, son
// ancien nom cesse d'etre lu ; quand plus rien ne le lit, il sort d'ici.
//
// Pourquoi c'est ICI que la bascule opere, et pas dans le CSS : ces variables
// sont posees en style INLINE sur :root par applyThemeVariables, et un style
// inline bat toute regle de feuille. Ajouter un bloc CSS aurait ete inerte.
//
// `vars` et `darkVars` sont IDENTIQUES, et c'est voulu : les jetons --v8-*
// sont eux-memes definis en clair ET en sombre dans style.css. Le mode se
// resout dans la couche V8, pas ici. Une seule table, plus rien a garder
// synchronise a la main.
//
// Correspondances qui meritent un mot :
//   --neo-text   -> --v8-texte (#386B6D)      le texte devient VERT PROFOND.
//                   C'est la decision de charte la plus visible ("comme sur le
//                   site"). 6,01:1 sur blanc.
//   --neo-muted  -> --v8-texte-secondaire     l'ancien #758483 donnait 3,33:1
//                   sur le fond : un defaut reel, ferme par cette ligne.
//   --*-orange-strong / --neo-coral-dark -> --v8-principal-appuye
//                   l'orange n'est JAMAIS du texte. Dix regles l'employaient
//                   ainsi (etats actifs, deux avertissements) ; elles passent
//                   au vert appuye. Le balayage de contraste dira si un
//                   avertissement merite --v8-alerte a la place.
//
// Historique : 5 palettes retirees le 17/09 (v1.23.0). La forme TABLE indexee
// par identifiant reste, pour que "noir" ou "blanc" enregistres chez des
// utilisateurs se replient sur "sereo" sans migration.

const JETONS_V8 = {
  "--color-brand-teal": "var(--v8-principal)",
  "--color-brand-teal-dark": "var(--v8-principal-appuye)",
  "--color-pastel-green": "var(--v8-vert-eau)",
  "--color-pastel-green-light": "var(--v8-vert-clair)",
  "--color-pastel-orange": "var(--v8-accent)",
  "--color-pastel-orange-light": "var(--v8-peche-claire)",
  "--color-pastel-orange-strong": "var(--v8-principal-appuye)",
  "--neo-bg": "var(--v8-fond)",
  "--neo-page": "var(--v8-fond)",
  "--neo-sidebar": "var(--v8-principal)",
  "--neo-sidebar-strong": "var(--v8-principal-appuye)",
  "--neo-teal": "var(--v8-principal)",
  "--neo-teal-dark": "var(--v8-principal-appuye)",
  "--neo-aqua": "var(--v8-vert-eau)",
  "--neo-aqua-soft": "var(--v8-vert-clair)",
  "--neo-coral": "var(--v8-accent)",
  "--neo-coral-dark": "var(--v8-principal-appuye)",
  "--neo-coral-soft": "var(--v8-peche-claire)",
  "--neo-blush": "var(--v8-peche)",
  "--neo-blush-soft": "var(--v8-peche-claire)",
  "--neo-card": "var(--v8-surface)",
  "--neo-line": "var(--v8-vert-clair)",
  "--neo-text": "var(--v8-texte)",
  "--neo-muted": "var(--v8-texte-secondaire)"
};

export const applicationThemes = {
  sereo: {
    id: "sereo",
    name: "Vert",
    vars: JETONS_V8,
    darkVars: JETONS_V8
  }
};

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

// Palette unique de l'application.
//
// Sereo n'a plus qu'un seul jeu de couleurs. Le seul axe d'apparence encore
// offert a l'utilisateur est CLAIR / SOMBRE (`colorScheme`), applique ici par
// `vars` et `darkVars`.
//
// Historique : l'application a porte 5 palettes interchangeables (Vert,
// Orange, Orange et vert, Noir, Blanc), plus une table pastel morte effacee
// au demarrage par app.js. Retirees le 2026-09-17 : la mesure WCAG a montre
// que 5 combinaisons palette x mode sur 8 ecrivaient du texte de navigation
// sous le seuil de 4,5:1, jusqu'a 1,36:1. Tenir 10 palettes conformes coutait
// dix fois la mesure, pour un choix que personne n'avait demande.
//
// La forme reste une TABLE indexee par identifiant, et ce n'est pas un
// vestige : les reglages deja enregistres cote serveur peuvent contenir
// `themeId: "noir"`. La table rend `undefined` pour ces valeurs, et le repli
// sur `sereo` fait la migration tout seul, sans ecriture.
export const applicationThemes = {
  sereo: {
    id: "sereo",
    name: "Vert",
    metaColor: "#285a5b",
    vars: {
      "--color-brand-teal": "#3b7374",
      "--color-brand-teal-dark": "#285a5b",
      "--color-pastel-green": "#a8c9c8",
      "--color-pastel-green-light": "#edf6f5",
      "--color-pastel-orange": "#f18c79",
      "--color-pastel-orange-light": "#fde2dc",
      "--color-pastel-orange-strong": "#b95649",
      "--neo-bg": "#eff3f1",
      "--neo-page": "#f8faf8",
      "--neo-sidebar": "#285a5b",
      "--neo-sidebar-strong": "#1f494a",
      "--neo-teal": "#3b7374",
      "--neo-teal-dark": "#285a5b",
      "--neo-aqua": "#a8c9c8",
      "--neo-aqua-soft": "#edf6f5",
      "--neo-coral": "#f18c79",
      "--neo-coral-dark": "#b95649",
      "--neo-coral-soft": "#fde2dc",
      "--neo-blush": "#e9c3bd",
      "--neo-blush-soft": "#fbefed",
      "--neo-card": "#ffffff",
      "--neo-line": "#dfe7e3",
      "--neo-text": "#183233",
      "--neo-muted": "#758483"
    },
    darkVars: {
      "--color-brand-teal": "#93cbc9",
      "--color-brand-teal-dark": "#b9e1df",
      "--color-pastel-green": "#243f42",
      "--color-pastel-green-light": "#172b2d",
      "--color-pastel-orange": "#7b453b",
      "--color-pastel-orange-light": "#3b2724",
      "--color-pastel-orange-strong": "#f5a08f",
      "--neo-bg": "#0d1518",
      "--neo-page": "#111b1e",
      "--neo-sidebar": "#101c1f",
      "--neo-sidebar-strong": "#0a1113",
      "--neo-teal": "#93cbc9",
      "--neo-teal-dark": "#b9e1df",
      "--neo-aqua": "#243f42",
      "--neo-aqua-soft": "#172b2d",
      "--neo-coral": "#f5a08f",
      "--neo-coral-dark": "#ffb7aa",
      "--neo-coral-soft": "#3b2724",
      "--neo-blush": "#7b453b",
      "--neo-blush-soft": "#2a1d1b",
      "--neo-card": "#182226",
      "--neo-line": "#2a3d3f",
      "--neo-text": "#e8eef0",
      "--neo-muted": "#a8b8bc"
    }
  }
};

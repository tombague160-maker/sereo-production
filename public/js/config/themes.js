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

// Identite du theme applicatif. PLUS AUCUNE COULEUR ICI.
//
// Les couleurs vivent dans style.css, couche des jetons V8, une seule fois,
// tirees de design/DESIGN.md. Ce fichier ne porte plus qu'un identifiant et un
// nom.
//
// Trois etats successifs, et le detour valait la peine :
//   avant le 17/09   5 palettes, ~470 lignes de hex, effacees et recopiees sur
//                    :root a chaque demarrage
//   marche 2         1 table de 24 correspondances "ancien nom -> jeton V8",
//                    posee en style INLINE -- seul moyen de battre les regles
//                    de feuille, qui redefinissaient ces memes noms
//   marche 3         plus rien : la feuille lit directement les jetons, les
//                    anciens noms n'ont plus de lecteur, la couche inline
//                    disparait
//
// La forme TABLE indexee par identifiant est conservee : des reglages
// enregistres portent encore themeId "noir", "blanc" ou "orange", et le repli
// sur "sereo" absorbe ces valeurs sans migration ni ecriture.
export const applicationThemes = {
  sereo: {
    id: "sereo",
    name: "Vert"
  }
};

// Anti-FART (Flash of inAccurate Resolved Theme).
//
// Pose le mode (data-color-scheme) et patche le meta theme-color avant
// le premier rendu de la page, en lisant localStorage. Doit etre charge
// en synchrone dans <head> (avant tout <link> bloquant) pour avoir effet.
//
// Externalise dans un fichier separe (et plus inline dans index.html) car
// la CSP `script-src 'self'` bloquait le script inline. Charge via
// <script src="..."></script> il est couvert par 'self' et s'execute
// avec la meme priorite render-blocking.
//
// -- 17/09 : deux changements, lies ---------------------------------------
//
// 1. SANS PREFERENCE, ON SUIT LE SYSTEME. Le defaut etait "light" en dur,
//    pendant la phase de test du mode sombre. Decision de Tom : le sombre est
//    une PREFERENCE PERSONNELLE, pas un mode du soir -- donc on prend au
//    demarrage ce que dit le systeme, et rien ne rebascule ensuite tout seul.
//    L'ecran ne change jamais en pleine tournee.
//
// 2. ON RESOUT AU LIEU DE SUPPRIMER. Avant, le mode "auto" effacait
//    l'attribut pour laisser @media (prefers-color-scheme) decider. Plus
//    propre en apparence, faux en pratique : sans attribut, la page retombe
//    sur le bloc :root de base, qui porte une palette PLUS ANCIENNE que
//    :root[data-color-scheme="light"]. Mesure sur OS clair :
//
//        "Auto"  -> --bg #fafaf8   --text #102a2f
//        "Clair" -> --bg #eff3f1   --text #183233
//
//    Deux apparences pour le meme mode. Le defaut a survecu parce que seul le
//    cas SOMBRE etait teste, et qu'en sombre les deux blocs sont identiques.
//    On pose donc toujours l'attribut, resolu a "light" ou "dark".
(function () {
  var VALIDES = { dark: 1, light: 1 };

  function systemeEnSombre() {
    return !!(
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  var resolved;
  try {
    var pref = localStorage.getItem("sereo:colorScheme");
    // Un choix explicite "clair" ou "sombre" prime sur le systeme.
    // Tout le reste -- "auto", rien, ou une valeur inconnue -- suit le systeme.
    resolved = VALIDES[pref] ? pref : (systemeEnSombre() ? "dark" : "light");
  } catch (e) {
    // localStorage indisponible (navigation privee, cookies bloques) : le
    // systeme reste consultable, donc on le suit quand meme.
    resolved = systemeEnSombre() ? "dark" : "light";
  }
  document.documentElement.dataset.colorScheme = resolved;

  // Met a jour le meta theme-color (OS bar / address bar) immediatement
  // pour eviter un flash de couleur sur mobile / PWA.
  try {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", resolved === "dark" ? "#0d1518" : "#cfe9e1");
    }
  } catch (e) {
    /* DOM pas pret : ignore */
  }
})();

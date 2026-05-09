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
(function () {
  var resolved = "light";
  try {
    var pref = localStorage.getItem("sereo:colorScheme");
    if (pref === "dark" || pref === "light") {
      document.documentElement.dataset.colorScheme = pref;
      resolved = pref;
    } else if (pref === "auto") {
      // Mode auto explicite : on retire l'attribut pour que le @media
      // (prefers-color-scheme: dark) prenne la main dans la CSS.
      delete document.documentElement.dataset.colorScheme;
      resolved =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    } else {
      // Pas de preference stockee : light par defaut.
      document.documentElement.dataset.colorScheme = "light";
      resolved = "light";
    }
  } catch (e) {
    // localStorage indispo : fallback light statique.
    document.documentElement.dataset.colorScheme = "light";
    resolved = "light";
  }
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

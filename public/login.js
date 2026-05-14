// Login page enhancements : countdown lockout + re-enable du formulaire.
//
// Sert deux usages :
//   1) Si la page indique data-locked-until (timestamp), demarrer un countdown
//      visible qui rafraichit la page automatiquement a expiration.
//   2) Pas d'autres effets : le rendu reste utilisable sans JS.
//
// Fichier externalise car la CSP `script-src 'self'` du serveur bloque les
// scripts inline. Route /login.js declaree avant requireAccessAuth pour etre
// accessible sans authentification.
(function () {
  var body = document.body;
  if (!body) return;

  var lockedUntilAttr = body.getAttribute("data-locked-until");
  if (!lockedUntilAttr) return;

  var lockedUntil = Number(lockedUntilAttr);
  if (!Number.isFinite(lockedUntil) || lockedUntil <= Date.now()) {
    // Lockout deja expire cote client (decalage d'horloge). On reload pour
    // que le serveur reconfirme l'etat.
    window.location.reload();
    return;
  }

  var countdownEl = document.getElementById("lockout-countdown");
  var form = document.querySelector("form");
  var inputs = form ? form.querySelectorAll("input, button") : [];

  // Desactive le formulaire pendant le lockout pour eviter les requetes
  // supplementaires qui prolongeraient la fenetre cote serveur.
  inputs.forEach(function (el) { el.disabled = true; });

  function tick() {
    var remainingMs = lockedUntil - Date.now();
    if (remainingMs <= 0) {
      if (countdownEl) countdownEl.textContent = "0";
      window.location.reload();
      return;
    }
    var seconds = Math.ceil(remainingMs / 1000);
    if (countdownEl) countdownEl.textContent = String(seconds);
  }

  tick();
  var intervalId = setInterval(tick, 250);
  window.addEventListener("pagehide", function () { clearInterval(intervalId); });
})();

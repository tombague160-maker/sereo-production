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
  var unitEl = document.getElementById("lockout-unit");
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
    // Synchronise le pluriel : "1 seconde" / "N secondes"
    if (unitEl) unitEl.textContent = seconds > 1 ? "secondes" : "seconde";
  }

  tick();
  var intervalId = setInterval(tick, 250);
  window.addEventListener("pagehide", function () { clearInterval(intervalId); });
})();

// Apres un echec, l'identifiant tape est GARDE (planche 9c).
//
// Il est garde ici, dans le navigateur (sessionStorage de l'onglet), et nulle
// part ailleurs : ni dans l'URL de la redirection (historique, journaux du
// proxy), ni renvoye par le serveur. Le mot de passe, lui, n'est jamais garde.
// Il n'est rendu que sur la page d'un echec (?error=1) ou d'un blocage
// (?locked=1) ; toute autre ouverture de la page de connexion l'oublie. Le
// curseur va alors au mot de passe : c'est lui qu'on retape.
(function () {
  var CLE = "sereo:connexion:identifiant";
  var champ = document.getElementById("username");
  if (!champ) return;
  var mdp = document.getElementById("password");
  var echec = /[?&](error|locked)=1(&|$)/.test(window.location.search);
  try {
    if (!echec) {
      sessionStorage.removeItem(CLE);
    } else {
      var garde = sessionStorage.getItem(CLE);
      if (garde && !champ.value) {
        champ.value = garde;
        if (mdp && !mdp.disabled) mdp.focus();
      }
    }
  } catch (e) { /* stockage indisponible : on retape, comme avant */ }
  if (champ.form) {
    champ.form.addEventListener("submit", function () {
      try { sessionStorage.setItem(CLE, champ.value); } catch (e) { /* ignore */ }
    });
  }
})();

// Afficher / masquer le mot de passe (planche 9b). Le bouton est cache sans
// JS : il n'apparait que s'il fonctionne.
(function () {
  var bouton = document.querySelector(".voir");
  var champ = document.getElementById("password");
  if (!bouton || !champ) return;
  bouton.hidden = false;
  bouton.addEventListener("click", function () {
    var visible = champ.type === "password";
    champ.type = visible ? "text" : "password";
    bouton.setAttribute("aria-pressed", visible ? "true" : "false");
    bouton.setAttribute("aria-label", visible ? "Masquer le mot de passe" : "Afficher le mot de passe");
    champ.focus();
  });
  // Le mot de passe ne reste jamais en clair : ni a l'envoi, ni au retour
  // arriere (la page peut revenir du cache du navigateur).
  function masquer() {
    champ.type = "password";
    bouton.setAttribute("aria-pressed", "false");
    bouton.setAttribute("aria-label", "Afficher le mot de passe");
  }
  var formulaire = champ.form;
  if (formulaire) formulaire.addEventListener("submit", masquer);
  window.addEventListener("pageshow", masquer);
})();

// Les dates et les heures de l'ecran : UN utilitaire (public/js/utils/dates.js,
// parcours simplifies du 24/09).
//
// L'audit relevait cinq ecritures de la meme date (« 24 sept. », « Jeu. 24
// sept. », « jeu. 24/09 », « Jeudi 24 septembre », « 24/09/2026 ») et deux de
// l'heure (« 16:00 », « 16 h 00 »). Il en reste quatre formes, chacune ici.
// Le banc de l'ECRAN est parcours-simplifies.spec.js (« 8 — les dates ») ; ce
// fichier tient les formes elles-memes, a l'annee pres.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const charger = () => import("../public/js/utils/dates.js");
const AN = new Date().getFullYear();
const JOUR_SEMAINE_COURT = "(lun|mar|mer|jeu|ven|sam|dim)\\.";

test("dates — jourMois : « 24 sept. », l'annee seulement quand ce n'est pas celle-ci", async () => {
  const { jourMois } = await charger();
  assert.equal(jourMois(`${AN}-09-24`), "24 sept.");
  assert.equal(jourMois(`${AN - 1}-01-01`), `1 janv. ${AN - 1}`);
  assert.equal(jourMois(""), "—");
  assert.equal(jourMois("pas une date"), "—");
});

test("dates — jourCourt : « jeu. 24 sept. », jamais « jeu. 24/09 »", async () => {
  const { jourCourt } = await charger();
  assert.match(jourCourt(`${AN}-09-24`), new RegExp(`^${JOUR_SEMAINE_COURT} 24 sept\\.$`));
  assert.match(jourCourt(`${AN}-09-24`, { majuscule: true }), /^[A-Z][a-z]{2}\. 24 sept\.$/);
  assert.doesNotMatch(jourCourt(`${AN}-09-24`), /\d{2}\/\d{2}/);
});

test("dates — jourLong : « jeudi 24 septembre », « 1er » le premier du mois", async () => {
  const { jourLong } = await charger();
  assert.match(jourLong(`${AN}-09-24`), /^[a-z]+di 24 septembre$|^dimanche 24 septembre$/);
  assert.equal(jourLong(`${AN}-10-01`, { semaine: false }), "1er octobre");
  assert.match(jourLong(`${AN}-10-01`, { majuscule: true }), /^[A-Z][a-z]+ 1er octobre$/);
  assert.equal(jourLong(`${AN - 1}-09-24`, { semaine: false }), `24 septembre ${AN - 1}`);
});

test("dates — heure : « 16 h 00 », « 9 h 05 », jamais « 16:00 »", async () => {
  const { heure, jourEtHeure } = await charger();
  assert.equal(heure(new Date(AN, 8, 24, 16, 0)), "16 h 00");
  assert.equal(heure(new Date(AN, 8, 24, 9, 5)), "9 h 05");
  assert.equal(jourEtHeure(new Date(AN, 8, 16, 9, 42)), "16 septembre à 9 h 42");
  assert.equal(heure(null), "—");
});

test("dates — une date sans heure se lit a midi : aucun fuseau ne la recule d'un jour", async () => {
  const { lireDate } = await charger();
  const d = lireDate(`${AN}-09-24`);
  assert.equal(d.getDate(), 24);
  assert.equal(d.getHours(), 12);
  assert.equal(lireDate(""), null);
});

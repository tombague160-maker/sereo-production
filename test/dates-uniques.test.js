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

// Integration de la performance (24/09) : le lot « rendu » construisait les
// formateurs Intl une fois (toLocaleDateString en construisait un a CHAQUE
// date : 80 ms par frappe dans la recherche des Commandes au telephone). Les
// dates passent desormais par cet utilitaire : il garde ses formateurs.
test("dates — chaque forme construit son formateur une fois, pas un par date", async () => {
  const { jourMois, jourCourt, jourLong, jourEtHeure } = await charger();
  const appeler = () => {
    for (let j = 1; j <= 28; j++) {
      const iso = `${AN}-02-${String(j).padStart(2, "0")}`;
      jourMois(iso); jourMois(`${AN - 1}-02-${String(j).padStart(2, "0")}`);
      jourCourt(iso); jourCourt(iso, { majuscule: true }); jourCourt(`${AN - 1}-03-${String(j).padStart(2, "0")}`);
      jourLong(iso); jourLong(iso, { semaine: false }); jourEtHeure(`${iso}T09:42:00`);
    }
  };
  appeler(); // les formateurs de chaque forme existent desormais
  const vraiFormat = Intl.DateTimeFormat;
  const vraisLocale = ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].map(nom => [nom, Date.prototype[nom]]);
  const n = { intl: 0, locale: 0 };
  Intl.DateTimeFormat = new Proxy(vraiFormat, {
    construct(cible, args) { n.intl++; return new cible(...args); },
    apply(cible, ceci, args) { n.intl++; return cible(...args); }
  });
  for (const [nom, vrai] of vraisLocale) Date.prototype[nom] = function (...args) { n.locale++; return vrai.apply(this, args); };
  try {
    appeler();
  } finally {
    Intl.DateTimeFormat = vraiFormat;
    for (const [nom, vrai] of vraisLocale) Date.prototype[nom] = vrai;
  }
  // 28 x 8 dates : avant, 224 toLocaleDateString (et 56 de plus pour jourLong).
  assert.deepEqual(n, { intl: 0, locale: 0 });
});

test("dates (temoin) : le texte est celui de toLocaleDateString, forme par forme", async () => {
  const { jourMois, jourCourt, jourLong } = await charger();
  for (const iso of [`${AN}-01-01`, `${AN}-09-24`, `${AN}-12-31`, `${AN - 1}-03-15`, `${AN + 1}-07-04`]) {
    const d = new Date(`${iso}T12:00:00`);
    const annee = d.getFullYear() !== AN ? { year: "numeric" } : {};
    assert.equal(jourMois(iso), d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...annee }), iso);
    assert.equal(jourCourt(iso), d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", ...annee }), iso);
    const mois = d.toLocaleDateString("fr-FR", { month: "long" });
    const semaine = d.toLocaleDateString("fr-FR", { weekday: "long" });
    const jour = d.getDate() === 1 ? "1er" : d.getDate();
    assert.equal(jourLong(iso), `${semaine} ${jour} ${mois}${annee.year ? ` ${d.getFullYear()}` : ""}`, iso);
  }
});

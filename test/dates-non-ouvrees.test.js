// Dates de livraison tombant un dimanche ou un jour ferie.
//
// Decision de Tom, 17/09 : on NE DEPLACE PAS la date, on PREVIENT. Ces tests
// figent donc deux choses distinctes -- que le calcul est juste, et qu'il ne
// change rien a la date retenue.
//
// Le calcul des feries est derive, pas tabule : sept dates fixes et quatre
// ancrees sur Paques. Une table aurait du etre reconduite chaque annee, et une
// table perimee se trompe en silence, ce qui est precisement le defaut qu'on
// cherche a supprimer.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  dimancheDePaques,
  joursFeriesFrance,
  alerteDateNonOuvree,
  jourDuMoisRabattu,
  nextSectorDeliveryDate,
  decorerSecteurPourAffichage
} = require("../server.js");

const ymd = date => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0")
].join("-");

// --- Paques : le seul endroit ou l'algorithme peut se tromper sans bruit ----

test("Paques — cinq annees connues, verifiees hors du code", () => {
  // Valeurs publiques, independantes de l'implementation.
  const connues = {
    2024: "2024-03-31",
    2025: "2025-04-20",
    2026: "2026-04-05",
    2027: "2027-03-28",
    2030: "2030-04-21"
  };
  for (const [annee, attendu] of Object.entries(connues)) {
    assert.equal(ymd(dimancheDePaques(Number(annee))), attendu, `Paques ${annee}`);
  }
});

test("Paques — tombe TOUJOURS un dimanche, sur deux siecles", () => {
  // Contre-epreuve structurelle : un algorithme faux derive vite de ce jour.
  for (let annee = 1900; annee <= 2100; annee++) {
    assert.equal(dimancheDePaques(annee).getDay(), 0, `Paques ${annee} n'est pas un dimanche`);
  }
});

test("Paques — reste dans sa fenetre canonique (22 mars au 25 avril)", () => {
  for (let annee = 1900; annee <= 2100; annee++) {
    const d = dimancheDePaques(annee);
    const jourDeLAn = new Date(annee, 0, 1);
    const rang = Math.round((d - jourDeLAn) / 86400000);
    const min = Math.round((new Date(annee, 2, 22) - jourDeLAn) / 86400000);
    const max = Math.round((new Date(annee, 3, 25) - jourDeLAn) / 86400000);
    assert.ok(rang >= min && rang <= max, `Paques ${annee} hors fenetre : ${ymd(d)}`);
  }
});

// --- Les onze feries -------------------------------------------------------

test("feries — il y en a exactement onze, tous distincts", () => {
  for (const annee of [2024, 2025, 2026, 2027]) {
    const feries = joursFeriesFrance(annee);
    assert.equal(feries.size, 11, `${annee} : ${feries.size} feries`);
    for (const date of feries.keys()) {
      assert.ok(date.startsWith(String(annee)), `${date} n'est pas dans ${annee}`);
    }
  }
});

test("feries — les quatre mobiles sont a la bonne distance de Paques", () => {
  const annee = 2026;
  const paques = dimancheDePaques(annee);
  const feries = joursFeriesFrance(annee);
  const decale = jours => ymd(new Date(paques.getFullYear(), paques.getMonth(), paques.getDate() + jours));

  assert.equal(feries.get(decale(1)), "Lundi de Paques");
  assert.equal(feries.get(decale(39)), "Ascension");
  assert.equal(feries.get(decale(50)), "Lundi de Pentecote");
  // L'Ascension est un jeudi, la Pentecote un lundi : invariants du calendrier.
  assert.equal(new Date(annee, 0, 1) && new Date(decale(39)).getDay(), 4, "Ascension doit etre un jeudi");
});

// --- L'alerte elle-meme ----------------------------------------------------

test("alerte — un dimanche ordinaire est signale comme dimanche", () => {
  const a = alerteDateNonOuvree("2026-09-20"); // dimanche
  assert.equal(new Date(2026, 8, 20).getDay(), 0, "prerequis : c'est bien un dimanche");
  assert.deepEqual(a, { type: "dimanche", libelle: "dimanche" });
});

test("alerte — un ferie en semaine est signale comme ferie, avec son nom", () => {
  const a = alerteDateNonOuvree("2026-07-14");
  assert.equal(a.type, "ferie");
  assert.equal(a.libelle, "Fete nationale");
});

test("alerte — un ferie qui TOMBE un dimanche est annonce ferie, pas dimanche", () => {
  // On cherche le cas au lieu de le supposer : il n'arrive pas toutes les annees.
  let trouve = null;
  for (let annee = 2024; annee <= 2040 && !trouve; annee++) {
    for (const [date, nom] of joursFeriesFrance(annee)) {
      const [a, m, j] = date.split("-").map(Number);
      if (new Date(a, m - 1, j).getDay() === 0) { trouve = { date, nom }; break; }
    }
  }
  assert.ok(trouve, "aucun ferie dominical entre 2024 et 2040 — invraisemblable");
  const a = alerteDateNonOuvree(trouve.date);
  assert.equal(a.type, "ferie", `${trouve.date} (${trouve.nom}) doit primer sur dimanche`);
  assert.equal(a.libelle, trouve.nom);
});

test("alerte — un jour ouvre ordinaire ne declenche RIEN", () => {
  // Contre-temoin : sans lui, une fonction qui alerte toujours passerait.
  assert.equal(alerteDateNonOuvree("2026-09-15"), null); // un mardi
  assert.equal(alerteDateNonOuvree("2026-03-10"), null);
  let ouvres = 0;
  for (let j = 1; j <= 28; j++) {
    const date = `2026-06-${String(j).padStart(2, "0")}`;
    if (alerteDateNonOuvree(date) === null) ouvres++;
  }
  assert.ok(ouvres >= 20, `juin 2026 devrait avoir >= 20 jours ouvres, trouve ${ouvres}`);
});

test("alerte — une entree invalide ou impossible rend null, sans lever", () => {
  for (const mauvais of [null, undefined, 42, "", "pas une date", "2026-13-01", "2026-02-31"]) {
    assert.equal(alerteDateNonOuvree(mauvais), null, `${String(mauvais)}`);
  }
});

// --- Le rabattement silencieux du 31 ---------------------------------------

test("rabattement — un secteur regle le 31 est signale en fevrier", () => {
  assert.equal(jourDuMoisRabattu(31, "2026-02-28"), true);
  assert.equal(jourDuMoisRabattu(31, "2026-01-31"), false);
  assert.equal(jourDuMoisRabattu(15, "2026-02-15"), false);
});

// --- L'invariant qui compte le plus ----------------------------------------

test("la date n'est JAMAIS deplacee : prevenir n'est pas corriger", () => {
  // C'est la decision de Tom, et c'est ce qu'un futur correctif risque de casser
  // en croyant bien faire.
  const secteur = { jourMois: 20, secteur: "Test" };
  const avant = nextSectorDeliveryDate(secteur);
  const decore = decorerSecteurPourAffichage(secteur);
  assert.equal(decore.prochaineDate, avant, "la date decoree doit etre la date calculee");
  assert.ok("alerte" in decore, "le champ alerte doit exister, meme a null");
  assert.equal(decore.jourMois, 20, "le secteur d'origine n'est pas altere");
});

test("decoration — un secteur dominical porte son alerte", () => {
  // On construit le cas : le prochain 'jour' qui tombe un dimanche.
  let jour = null;
  for (let j = 1; j <= 28 && !jour; j++) {
    const d = nextSectorDeliveryDate({ jourMois: j });
    if (alerteDateNonOuvree(d)) jour = j;
  }
  assert.ok(jour, "aucun jour du mois ne tombe sur un dimanche ou ferie — invraisemblable");
  const decore = decorerSecteurPourAffichage({ jourMois: jour });
  assert.ok(decore.alerte, `le secteur du ${jour} devrait porter une alerte`);
  assert.ok(["dimanche", "ferie"].includes(decore.alerte.type));
});

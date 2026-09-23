// lib/geocodage.js : les fonctions pures du module de geocodage unique (lot 3
// de l'audit geo, 23/09). Les parcours complets (lot, tournee, CRM) sont dans
// adresses-justes.test.js ; ici, ce que le nettoyage retire ET ce qu'il garde.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const geo = require("../lib/geocodage");

test("nettoyage — la voie est isolee de ses complements, qui sont gardes pour le livreur", () => {
  const n = geo.nettoyerAdresse({ rue: "Résidence Les Tilleuls, Bât. B, Apt 12, 3 rue de Dole", codePostal: "25000", ville: "Besançon" });
  assert.equal(n.rue, "3 rue de Dole");
  assert.equal(n.complement, "Résidence Les Tilleuls, Bât. B, Apt 12");
});

test("nettoyage — un complement colle a la voie est retire aussi", () => {
  assert.equal(geo.nettoyerAdresse({ rue: "3 rue de Dole Bât B Apt 12", ville: "Dole" }).rue, "3 rue de Dole");
  assert.equal(geo.nettoyerAdresse({ rue: "12 avenue Carnot, BP 40012", ville: "Dole" }).rue, "12 avenue Carnot");
});

test("nettoyage — temoin : une adresse ordinaire, un lieu-dit et une rue « Batignolles » ne perdent rien", () => {
  assert.equal(geo.nettoyerAdresse({ rue: "12 rue Mégevand", ville: "Besançon" }).rue, "12 rue Mégevand");
  assert.equal(geo.nettoyerAdresse({ rue: "Lieu-dit Les Granges", ville: "Foncine-le-Haut" }).rue, "Lieu-dit Les Granges");
  assert.equal(geo.nettoyerAdresse({ rue: "3 rue des Batignolles", ville: "Dole" }).rue, "3 rue des Batignolles");
  assert.equal(geo.nettoyerAdresse({ rue: "12 rue Mégevand", ville: "Besançon" }).complement, "");
});

test("nettoyage — CEDEX quitte la ville et le code CEDEX n'est pas un filtre", () => {
  const n = geo.nettoyerAdresse({ rue: "8 rue Charles Nodier", codePostal: "25035", ville: "Besançon Cedex 3" });
  assert.equal(n.ville, "Besançon");
  assert.equal(n.cedex, true);
  assert.equal(n.codePostal, "25035");
});

test("code postal — 1100 (Excel) et « 39 300 » sont normalises, le reste n'est jamais invente", () => {
  assert.equal(geo.normaliserCodePostal(1100), "01100");
  assert.equal(geo.normaliserCodePostal("39 300"), "39300");
  assert.equal(geo.normaliserCodePostal("25000"), "25000");
  assert.equal(geo.normaliserCodePostal(""), "");
  assert.equal(geo.normaliserCodePostal("ABC"), "ABC");
});

test("cle de cache — deux ecritures d'une meme voie partagent la meme entree", () => {
  assert.equal(
    geo.cleGeocodage({ rue: "Bât. B, 3 rue de Dole", codePostal: "25000", ville: "Besançon" }),
    geo.cleGeocodage({ rue: "3 rue de Dole", codePostal: "25000", ville: "BESANCON" })
  );
});

test("position — (0,0), inversee et lointaine refusees ; un point du Jura accepte", () => {
  const depot = { lat: 46.745, lng: 5.91 };
  assert.equal(geo.verifierPosition({ lat: 46.75, lng: 5.9 }, { reference: depot }).ok, true);
  assert.equal(geo.verifierPosition({ lat: 0, lng: 0 }).code, "zero");
  const inversee = geo.verifierPosition({ lat: 5.9, lng: 46.75 }, { reference: depot });
  assert.equal(inversee.code, "inversee");
  assert.deepEqual(inversee.corrigee, { lat: 46.75, lng: 5.9 });
  const paris = geo.verifierPosition({ lat: 48.8566, lng: 2.3522 }, { reference: depot });
  assert.equal(paris.code, "hors-zone");
  assert.match(paris.message, /150 km/);
  // Sans depot : la France metropolitaine.
  assert.equal(geo.verifierPosition({ lat: 48.8566, lng: 2.3522 }).ok, true);
  assert.equal(geo.verifierPosition({ lat: 40.4, lng: -3.7 }).code, "hors-zone");
});

test("cache — un trouve reste, un rejet expire apres 30 jours, une erreur ne vaut rien", () => {
  const maintenant = Date.parse("2026-09-23T12:00:00Z");
  const il_y_a = jours => new Date(maintenant - jours * 24 * 3600 * 1000).toISOString();
  assert.equal(geo.entreeCacheValide({ statut: "trouve", misAJourLe: il_y_a(400) }, maintenant), true);
  assert.equal(geo.entreeCacheValide({ statut: "introuvable", misAJourLe: il_y_a(3) }, maintenant), true);
  assert.equal(geo.entreeCacheValide({ statut: "introuvable", misAJourLe: il_y_a(31) }, maintenant), false);
  assert.equal(geo.entreeCacheValide({ statut: "ambigu", misAJourLe: il_y_a(31) }, maintenant), false);
  assert.equal(geo.entreeCacheValide({ statut: "erreur", misAJourLe: il_y_a(0) }, maintenant), false);
});

test("precision — le type de la BAN devient un mot de l'ecran, et seul le numero est exact", () => {
  assert.equal(geo.precisionDuType("housenumber"), "numero");
  assert.equal(geo.precisionDuType("street"), "rue");
  assert.equal(geo.precisionDuType("municipality"), "commune");
  assert.equal(geo.precisionApproximative("rue"), true);
  assert.equal(geo.precisionApproximative("numero"), false);
  assert.equal(geo.precisionApproximative("manuel"), false);
});

test("User-Agent — un contact generique, jamais une adresse e-mail", () => {
  assert.match(geo.USER_AGENT, /^Sereo\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\//);
  assert.doesNotMatch(geo.USER_AGENT, /@/);
});

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

test("nettoyage — une virgule apres le numero ne coupe pas la voie (« 12, rue de Dole », « Rue de Dole, 12 », « 12 bis, rue X »)", () => {
  // Relecture adverse du lot 3 : le numero seul etait pris pour la voie, et
  // la rue entiere partait en complement. La BAN ne recevait que « 12 ».
  assert.equal(geo.nettoyerAdresse({ rue: "12, rue de Dole", ville: "Besançon" }).rue, "12 rue de Dole");
  assert.equal(geo.nettoyerAdresse({ rue: "Rue de Dole, 12", ville: "Besançon" }).rue, "12 Rue de Dole");
  assert.equal(geo.nettoyerAdresse({ rue: "12 bis, rue X", ville: "Besançon" }).rue, "12 bis rue X");
  const avecComplement = geo.nettoyerAdresse({ rue: "Bât. B, 12, rue de Dole, Apt 3", ville: "Besançon" });
  assert.equal(avecComplement.rue, "12 rue de Dole");
  assert.equal(avecComplement.complement, "Bât. B, Apt 3");
});

test("cle de cache — deux voies differentes au meme numero n'ont jamais la meme cle", () => {
  assert.notEqual(
    geo.cleGeocodage({ rue: "12, rue de Dole", codePostal: "25000", ville: "Besançon" }),
    geo.cleGeocodage({ rue: "12, avenue Foch", codePostal: "25000", ville: "Besançon" })
  );
  // Temoin : la virgule seule ne change pas l'adresse.
  assert.equal(
    geo.cleGeocodage({ rue: "12, rue de Dole", codePostal: "25000", ville: "Besançon" }),
    geo.cleGeocodage({ rue: "12 rue de Dole", codePostal: "25000", ville: "Besançon" })
  );
});

test("nettoyage — une voie « Bateau », « Batie », « Bâtie » ou « Batz » n'est pas un batiment", () => {
  assert.equal(geo.nettoyerAdresse({ rue: "12 rue du Bateau", ville: "Dole" }).rue, "12 rue du Bateau");
  assert.equal(geo.nettoyerAdresse({ rue: "5 chemin de la Batie", ville: "Dole" }).rue, "5 chemin de la Batie");
  assert.equal(geo.nettoyerAdresse({ rue: "3 rue de la Bâtie", ville: "Dole" }).rue, "3 rue de la Bâtie");
  assert.equal(geo.nettoyerAdresse({ rue: "Rue de Batz", ville: "Dole" }).rue, "Rue de Batz");
  // Temoin : un vrai batiment colle a la voie part toujours en complement.
  assert.equal(geo.nettoyerAdresse({ rue: "3 rue de Dole Bat B", ville: "Dole" }).rue, "3 rue de Dole");
  assert.equal(geo.nettoyerAdresse({ rue: "3 rue de Dole Bât. C", ville: "Dole" }).rue, "3 rue de Dole");
  assert.equal(geo.nettoyerAdresse({ rue: "3 rue de Dole Batiment 2", ville: "Dole" }).rue, "3 rue de Dole");
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

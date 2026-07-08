// PROUVE les findings P1 par exécution AVANT de fixer.
// Ces tests assertent le COMPORTEMENT DÉSIRÉ (post-fix). Sur code actuel ils
// ÉCHOUENT → c'est la preuve que les bugs sont réels (pas faux positifs comme
// B1/B4 l'étaient).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-p1-"));
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const { _normalizeDateInput, _excelDateToIso, _distance, _number, _importQuantity, _normalizeOrder } = require("../server");

// ── M1 : validation de date stricte (rejet des dates aberrantes) ────────────
test("M1.a — date avec mois invalide (13) est REJETEE", () => {
  // Bug actuel : "31/13/2026" passe le regex et produit "2026-13-31" (mois 13 invalide accepté)
  assert.equal(_normalizeDateInput("31/13/2026"), "", "mois 13 doit être rejeté");
});

test("M1.b — date avec jour invalide (32) est REJETEE", () => {
  assert.equal(_normalizeDateInput("32/01/2026"), "", "jour 32 doit être rejeté");
});

test("M1.c — date avec jour 0 est REJETEE", () => {
  assert.equal(_normalizeDateInput("00/01/2026"), "", "jour 00 doit être rejeté");
});

test("M1.d — date 29/02/2025 (2025 non bissextile) est REJETEE", () => {
  assert.equal(_normalizeDateInput("29/02/2025"), "", "29 fev d'une année non bissextile rejeté");
});

test("M1.e — date 29/02/2024 (bissextile) est ACCEPTEE", () => {
  assert.equal(_normalizeDateInput("29/02/2024"), "2024-02-29", "29 fev d'une année bissextile OK");
});

test("M1.f — date valide DD/MM/YYYY est ACCEPTEE et normalisee en ISO", () => {
  assert.equal(_normalizeDateInput("05/05/2026"), "2026-05-05");
  assert.equal(_normalizeDateInput("15/03/2024"), "2024-03-15");
});

test("M1.g — ISO YYYY-MM-DD valide passe tel quel", () => {
  assert.equal(_normalizeDateInput("2026-05-05"), "2026-05-05");
});

test("M1.h — ISO avec composants invalides est REJETEE (pas seulement par le regex de format)", () => {
  assert.equal(_normalizeDateInput("2026-13-05"), "", "mois 13 en ISO rejeté");
  assert.equal(_normalizeDateInput("2026-02-30"), "", "30 fev en ISO rejeté");
});

// ── Lot 2 (audit 2026-07-08) : integrite des dates ──────────────────────────

test("Lot2.a — ISO datetime complet est ACCEPTE (tronque a la date), plus rejete", () => {
  // Avant : rejete (regex 10 chars) -> mute vers today par normalizeOrder (P0).
  assert.equal(_normalizeDateInput("2026-05-05T10:00:00.000Z"), "2026-05-05");
  assert.equal(_normalizeDateInput("2026-05-05 10:00"), "2026-05-05");
  // Un datetime dont la DATE est invalide reste rejete
  assert.equal(_normalizeDateInput("2026-13-05T10:00:00Z"), "");
  // Un suffixe non horaire (pas de T ni espace) reste rejete
  assert.equal(_normalizeDateInput("2026-05-05abc"), "");
});

test("Lot2.b — normalizeOrder PRESERVE une date brute non normalisable (jamais today)", () => {
  const today = new Date().toISOString().slice(0, 10);
  const o = _normalizeOrder({ id: "x", clientId: "c", dateCommande: "2025-13-31" });
  assert.equal(o.dateCommande, "2025-13-31", "date invalide preservee telle quelle");
  assert.notEqual(o.dateCommande, today, "surtout PAS mutee vers today");
});

test("Lot2.c — normalizeOrder normalise un datetime en date canonique (sans perte)", () => {
  const o = _normalizeOrder({ id: "x", clientId: "c", dateCommande: "2026-05-05T10:00:00.000Z" });
  assert.equal(o.dateCommande, "2026-05-05");
});

test("Lot2.d — normalizeOrder : commande SANS date -> defaut aujourd'hui", () => {
  const today = new Date().toISOString().slice(0, 10);
  const o = _normalizeOrder({ id: "x", clientId: "c" });
  assert.equal(o.dateCommande, today, "nouvelle commande sans date = today (defaut acceptable)");
});

test("Lot2.e — excelDate borne les serials aberrants (pas de date fantaisiste)", () => {
  // excelDateToIso delegue a normalizeDateInput qui borne deja a 80000.
  assert.equal(_excelDateToIso(500000), "", "serial aberrant -> vide, pas an 3268");
  assert.equal(_excelDateToIso(-5), "", "serial negatif -> vide");
});

test("M1.i — Date object Excel est aussi validee (cohrence path texte/objet)", () => {
  const valid = new Date(Date.UTC(2026, 4, 5)); // mai 2026
  assert.equal(_normalizeDateInput(valid), "2026-05-05");
});

test("M1.j — number Excel epoch borne (rejet de valeurs aberrantes)", () => {
  // Excel serial 0 = 1899-12-30 (toujours dans les bornes [1900-2199])
  // mais on accepte la conversion qui donnera "1899-12-30" -> rejete par y<1900
  assert.equal(_normalizeDateInput(46167), "2026-05-25", "serial 46167 = 25 mai 2026");
  assert.equal(_normalizeDateInput(-1), "", "negatif rejete");
  assert.equal(_normalizeDateInput(99999), "", "trop grand (an 2173 hors plage) rejete");
  assert.equal(_normalizeDateInput(NaN), "", "NaN rejete");
});

test("M1.k — pivot annee 2 chiffres : <=30 -> 20XX, sinon 19XX (legacy commercial)", () => {
  assert.equal(_normalizeDateInput("01/01/99"), "1999-01-01", "99 -> 1999 (pas 2099)");
  assert.equal(_normalizeDateInput("15/06/85"), "1985-06-15");
  assert.equal(_normalizeDateInput("15/06/30"), "2030-06-15", "30 -> 2030 (borne pivot)");
  assert.equal(_normalizeDateInput("15/06/31"), "1931-06-15", "31 -> 1931");
  assert.equal(_normalizeDateInput("15/06/00"), "2000-06-15");
});

test("M1.l — excelDateToIso symetrique avec normalizeDateInput sur TOUS les paths", () => {
  // Avant la revue : excelDateToIso bypassait la validation pour Date/number.
  // Maintenant il delegue entierement -> les bornes [1900,2199] s'appliquent partout.
  assert.equal(_excelDateToIso(99999), "", "Excel epoch hors plage rejete");
  assert.equal(_excelDateToIso(46167), "2026-05-25");
  assert.equal(_excelDateToIso("31/13/2026"), "", "date FR invalide rejetee");
  assert.equal(_excelDateToIso(new Date(Date.UTC(3000, 0, 1))), "", "Date object > 2199 rejete");
  assert.equal(_excelDateToIso("05/05/2026"), "2026-05-05");
});

// ── M6 : distance Haversine (vs Euclidien * 111 imprécis ~30%) ──────────────
test("M6.a — distance Besancon-Dole est ~45 km (precision +/- 5%)", () => {
  // Besancon ~(47.24, 6.02), Dole ~(47.10, 5.49). Distance reelle ~ 45 km.
  const besancon = { lat: 47.2378, lng: 6.0241 };
  const dole = { lat: 47.0937, lng: 5.4906 };
  const d = _distance(besancon, dole);
  // Euclidien * 111 donne ~60.8 km (35% trop). On accepte +/- 5% du vrai.
  assert.ok(d >= 42 && d <= 48, `distance Besancon-Dole = ${d.toFixed(1)} km, attendu ~45 km`);
});

test("M6.b — distance Paris-Marseille est ~660 km (cas extreme nord-sud)", () => {
  const paris = { lat: 48.8566, lng: 2.3522 };
  const marseille = { lat: 43.2965, lng: 5.3698 };
  const d = _distance(paris, marseille);
  // Vraie distance ~661 km. Euclidien * 111 donnerait ~668 (peu d'écart car composante NS dominante)
  // mais la formule reste fausse sur le principe. Accepter +/- 7% pour absorber l'aprx multiplicateur.
  assert.ok(d >= 620 && d <= 710, `distance Paris-Marseille = ${d.toFixed(1)} km, attendu ~660 km`);
});

test("M6.c — distance(A, A) = 0", () => {
  const a = { lat: 47.24, lng: 6.02 };
  assert.equal(_distance(a, a), 0);
});

test("M6.d — distance(A, B) === distance(B, A) (symetrique)", () => {
  const a = { lat: 47.24, lng: 6.02 };
  const b = { lat: 47.10, lng: 5.49 };
  assert.equal(_distance(a, b), _distance(b, a));
});

// ── M2 : validation quantité négative à l'import ─────────────────────────────
// number() est utilisée massivement dans le parsing import. Le fix attendu :
// préserver les négatifs en sortie (number reste neutre, c'est `optionalQuantity`
// qui fait Math.max(0,...) pour les produits). Mais les quantités de ventes
// passent par `number(... , 1)` directement (fallback 1, pas de clamp à 0).
// Du coup une qty Excel "-5" devient -5 dans la commande importée. Vérifions.
test("M2.a — number() reste neutre (passe -5 tel quel) : c'est l'import qui filtre", () => {
  assert.equal(_number("-5", 1), -5, "number reste un parser brut");
  assert.equal(_number("3,5", 1), 3.5, "virgule decimal acceptée");
});

test("M2.b — importQuantity clamp les negatifs a 0 (qty Excel = -5 -> 0)", () => {
  assert.equal(_importQuantity("-5", 1), 0, "qty negative clampee a 0");
  assert.equal(_importQuantity("-0.1", 1), 0);
  assert.equal(_importQuantity("3", 1), 3, "qty positive intacte");
  assert.equal(_importQuantity("0", 1), 0, "qty 0 intacte (legitime)");
  assert.equal(_importQuantity("", 1), 1, "vide -> fallback");
  assert.equal(_importQuantity("abc", 1), 1, "invalide -> fallback");
  assert.equal(_importQuantity("3,5", 1), 3.5, "virgule decimal preservee");
});

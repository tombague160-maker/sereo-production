// lib/garde-excel.js (robustesse, 25/09) : les limites de l'import Excel, a
// la cellule pres, sans passer par le serveur.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { zipSync, strToU8 } = require("fflate");
const { inspecterClasseur, ClasseurRefuse, LIMITES } = require("../lib/garde-excel");

const colonne = n => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function classeur(lignes, colonnes, { prefixe = "", options = { level: 6 } } = {}) {
  const p = prefixe ? `${prefixe}:` : "";
  let donnees = "";
  let reste = lignes * colonnes;
  for (let r = 1; reste > 0; r++) {
    let ligne = `<${p}row r="${r}">`;
    for (let k = 0; k < colonnes && reste > 0; k++, reste--) ligne += `<${p}c r="${colonne(k)}${r}"><${p}v>${r}</${p}v></${p}c>`;
    donnees += `${ligne}</${p}row>`;
  }
  const ns = prefixe ? ` xmlns:${prefixe}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` : "";
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\"?><Types/>"),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><${p}worksheet${ns}><${p}sheetData>${donnees}</${p}sheetData></${p}worksheet>`)
  }, options));
}

test("garde : 40 000 cellules passent, 40 001 sont refusees", () => {
  assert.equal(LIMITES.cellules, 40000);
  const juste = inspecterClasseur(classeur(2000, 20));
  assert.equal(juste.cellules, 40000);
  assert.equal(juste.lignes, 2000);
  assert.equal(juste.colonnes, 20);
  assert.throws(() => inspecterClasseur(classeur(2001, 20)), ClasseurRefuse); // 40 020 cellules
  const refus = (() => { try { inspecterClasseur(classeur(40001, 1)); return null; } catch (error) { return error; } })();
  assert.ok(refus instanceof ClasseurRefuse);
  assert.match(refus.message, /plus de 40[\s  ]000 cellules/);
});

test("garde : les cellules a prefixe d'espace de noms (x:c) sont comptees aussi", () => {
  const compte = inspecterClasseur(classeur(10, 3, { prefixe: "x" }));
  assert.equal(compte.cellules, 30);
  assert.equal(compte.colonnes, 3);
  assert.throws(() => inspecterClasseur(classeur(20001, 2, { prefixe: "x" })), ClasseurRefuse);
});

test("garde : une partie non compressee (methode 0) est lue et comptee", () => {
  const compte = inspecterClasseur(classeur(5, 4, { options: { level: 0 } }));
  assert.equal(compte.cellules, 20);
});

test("garde : un fichier qui n'est pas un zip, ou un zip tronque, est illisible (jamais une exception brute)", () => {
  for (const buffer of [Buffer.from("pas un classeur"), classeur(5, 4).subarray(0, 60), Buffer.alloc(0)]) {
    assert.throws(() => inspecterClasseur(buffer), error => error instanceof ClasseurRefuse && /invalide ou illisible/.test(error.message));
  }
});

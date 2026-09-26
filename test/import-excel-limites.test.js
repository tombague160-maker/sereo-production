// Robustesse (25/09, chasse aux defauts, sections 3 et 4) : un petit fichier
// Excel piege (0,5 Mo) faisait monter la memoire a 600 Mo -- au-dessus des
// 512 Mo du conteneur -- parce que read-excel-file decompresse et construit
// tout le classeur en memoire. La seule limite etait les 10 Mo envoyes.
// Taille reelle, cellules, lignes, colonnes et elements sont desormais comptes
// AVANT la lecture (lib/garde-excel.js), avec un refus qui dit quoi faire.
//
// Le premier banc mesure la memoire de pointe du processus : il doit rester
// le premier du fichier.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { zipSync, strToU8 } = require("fflate");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-import-limites-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const { app, closeStorage, _flushPendingBackup } = require("../server");

let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await _flushPendingBackup();
  await new Promise(r => server.close(r));
  closeStorage();
  fs.rmSync(root, { recursive: true, force: true });
});

const colonne = n => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const echapper = v => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const enLigne = (ref, v) => `<c r="${ref}" t="inlineStr"><is><t>${echapper(v)}</t></is></c>`;

/** Un classeur d'une feuille ; `styles` : un xl/styles.xml en plus. */
function classeur(donneesDeFeuille, { dimension = "", styles = null } = {}) {
  const feuille = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dimension ? `<dimension ref="${dimension}"/>` : ""}<sheetData>${donneesDeFeuille}</sheetData></worksheet>`;
  const fichiers = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Feuil1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${styles ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' : ""}</Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(feuille)
  };
  if (styles) fichiers["xl/styles.xml"] = strToU8(styles);
  return Buffer.from(zipSync(fichiers, { level: 9 }));
}

const ENTETE_STOCK = `<row r="1">${enLigne("A1", "Code")}${enLigne("B1", "Nom")}${enLigne("C1", "Quantite")}</row>`;

async function importer(route, buffer, nom = "fichier.xlsx") {
  const form = new FormData();
  form.append("file", new Blob([buffer]), nom);
  const res = await fetch(base + route, { method: "POST", body: form, headers: { Origin: base, connection: "close" } });
  const texte = await res.text();
  let body;
  try { body = JSON.parse(texte); } catch { body = texte; }
  return { status: res.status, body };
}

test("le fichier piege du rapport (0,6 Mo, 50 000 lignes) est refuse avant la lecture, sans monter en memoire", async () => {
  let lignes = "";
  for (let i = 1; i <= 50000; i++) lignes += `<row r="${i}">${enLigne(`A${i}`, "Produit")}<c r="B${i}"><v>1</v></c></row>`;
  const bombe = classeur(lignes);
  assert.ok(bombe.length < 1024 * 1024, `prealable : le fichier fait ${bombe.length} octets`);
  const avant = process.resourceUsage().maxRSS / 1024;
  const t0 = Date.now();
  const r = await importer("/api/import/stock", bombe, "bombe.xlsx");
  const pic = process.resourceUsage().maxRSS / 1024 - avant;
  assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 300));
  assert.match(r.body.error, /trop gros pour l'import : plus de 45[\s  ]000 cellules/);
  assert.ok(pic < 150, `la memoire de pointe a monte de ${pic.toFixed(0)} Mo pour un fichier refuse`);
  assert.ok(Date.now() - t0 < 5000, `refus en ${Date.now() - t0} ms`);
});

test("une feuille qui s'etend (dimension) au-dela de 10 000 lignes est refusee, meme vide", async () => {
  const r = await importer("/api/import/stock", classeur(ENTETE_STOCK, { dimension: "A1:C20000" }));
  assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 300));
  assert.match(r.body.error, /va jusqu'à la ligne 20[\s  ]000, au plus 10[\s  ]000/);
});

test("une cellule au-dela de la 100e colonne est refusee (tableau dense lignes x colonnes)", async () => {
  const r = await importer("/api/import/stock", classeur(`${ENTETE_STOCK}<row r="2">${enLigne("A2", "P1")}${enLigne("CZ2", "x")}</row>`));
  assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 300));
  assert.match(r.body.error, /jusqu'à la colonne CZ \(104 colonnes\), au plus 100/);
});

function texteGeant() {
  return classeur(`${ENTETE_STOCK}<row r="2">${enLigne("A2", "P1")}${enLigne("B2", "x".repeat(17 * 1024 * 1024))}</row>`);
}

test("plus de 16 Mo une fois decompresse : refuse", async () => {
  const fichier = texteGeant();
  assert.ok(fichier.length < 200 * 1024, `prealable : ${fichier.length} octets compresses`);
  const r = await importer("/api/import/stock", fichier);
  assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 300));
  assert.match(r.body.error, /trop volumineux une fois décompressé/);
});

test("un zip qui MENT sur sa taille decompressee est refuse sur ce qu'il contient vraiment", async () => {
  const fichier = texteGeant();
  // Les tailles annoncees de la feuille (en-tete local et repertoire central)
  // ramenees a 100 octets.
  const nom = Buffer.from("xl/worksheets/sheet1.xml");
  let modifies = 0;
  for (let i = 0; i < fichier.length - 4; i++) {
    const sig = fichier.readUInt32LE(i);
    if (sig === 0x04034b50 && fichier.subarray(i + 30, i + 30 + nom.length).equals(nom)) { fichier.writeUInt32LE(100, i + 22); modifies++; }
    if (sig === 0x02014b50 && fichier.subarray(i + 46, i + 46 + nom.length).equals(nom)) { fichier.writeUInt32LE(100, i + 24); modifies++; }
  }
  assert.equal(modifies, 2, "prealable : les deux tailles annoncees n'ont pas ete trouvees");
  const r = await importer("/api/import/stock", fichier);
  assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 300));
  assert.match(r.body.error, /trop volumineux une fois décompressé/);
});

test("temoin : un fichier de stock ordinaire et des ventes au format Ximi (500 lignes) passent", async () => {
  const stock = await importer("/api/import/stock", classeur(`${ENTETE_STOCK}<row r="2">${enLigne("A2", "P1")}${enLigne("B2", "Produit")}${enLigne("C2", "12")}</row>`));
  assert.equal(stock.status, 200, JSON.stringify(stock.body).slice(0, 300));
  const entete = ["Code", "Nom", "Client", "Statut", "Date", "Début de période", "Code", "Heures", "Quantite", "Prix unitaire", "HT", "TTC",
    "Produit", "Soumis à royalties", "Type", "Type de TVA", "Statut", "Téléphone favori", "Référence", "Code Postal", "Rue", "Ville"];
  let lignes = `<row r="1">${entete.map((v, k) => enLigne(`${colonne(k)}1`, v)).join("")}</row>`;
  for (let i = 0; i < 500; i++) {
    const r = i + 2, c = i % 60, jour = String(1 + (i % 28)).padStart(2, "0");
    const valeurs = [`MAT_${i % 40}`, `Produit ${i % 40}`, `CLIENT${c}, Prenom`, "Validée", `${jour}/05/2026`, "01/05/2026", "PR2", "0", "1", "35,90", "29,82", "35,90",
      `MAT_${i % 40} - Produit`, "VRAI", "Fourniture", "Pro Métropole (20%)", "Actif", "03 84 33 03 39", `PR2FA2605${i}`, "39400", `${c} rue de la république`, "Hauts de Bienne"];
    lignes += `<row r="${r}">${valeurs.map((v, k) => enLigne(`${colonne(k)}${r}`, v)).join("")}</row>`;
  }
  const ventes = await importer("/api/import/ventes", classeur(lignes), "ventes.xlsx");
  assert.equal(ventes.status, 200, JSON.stringify(ventes.body).slice(0, 300));
});

test("des styles pieges (300 000 elements) sont refuses avant la lecture", async () => {
  const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs>${"<xf/>".repeat(300000)}</cellXfs></styleSheet>`;
  const r = await importer("/api/import/stock", classeur(ENTETE_STOCK, { styles }));
  assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 300));
  assert.match(r.body.error, /trop complexe pour l'import/);
});

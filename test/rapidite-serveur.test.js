// Rapidite du serveur (25/09) : chasse aux defauts du 24/09, section 2.
//
// Mesure de la chasse (jeu de forme production, puis dix et cinquante fois la
// base) : une ecriture coutait ~90 ms, dont la moitie a reconstruire la table
// de recherche du catalogue POUR CHAQUE COMMANDE ; a dix fois la base, 1,3 s
// par ecriture et 2,3 s par ajustement de stock, qui recalculait tout deux
// fois. Chaque banc ci-dessous vise UNE cause, compte du travail (pas des
// millisecondes, qui dependent de la machine), et echoue sur le code d'avant.
//
// ORDRE : les bancs partagent une base (le jeu de forme production). Ceux qui
// la remplacent par un jeu fabrique viennent en dernier.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { zipSync, strToU8 } = require("fflate");
const { jeuProduction } = require("./e2e/jeu-production");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-rapidite-serveur-"));
fs.mkdirSync(path.join(tmpRoot, "data"), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, "data", "seed.json"), JSON.stringify(jeuProduction()));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "seed.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_IMPORTS_ARCHIVES_DIR = path.join(tmpRoot, "data", "archives");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const S = require("../server");
const { app, readDb, writeDb, defaultDb, closeStorage, analyzeOrderStock, _flushPendingBackup, _synchronisationsPourTest } = S;

let server;
let base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await _flushPendingBackup();
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function api(chemin, init = {}) {
  const res = await fetch(base + chemin, { ...init, headers: { Origin: base, connection: "close", ...(init.headers || {}) } });
  const texte = await res.text();
  let body;
  try { body = texte ? JSON.parse(texte) : undefined; } catch { body = texte; }
  return { status: res.status, body };
}

// Un classeur minimal (une feuille, texte en ligne), comme pieges-import.test.js.
function classeur(lignes) {
  const echapper = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const colonne = i => String.fromCharCode(65 + i);
  const feuille = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lignes.map((l, r) => `<row r="${r + 1}">${l.map((c, i) => `<c r="${colonne(i)}${r + 1}" t="inlineStr"><is><t>${echapper(c)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const fichiers = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Feuille1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(feuille)
  };
  return new Blob([Buffer.from(zipSync(fichiers))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function importer(type, lignes) {
  const form = new FormData();
  form.append("file", classeur(lignes), `${type}.xlsx`);
  return api(`/api/import/${type}`, { method: "POST", body: form });
}

/** Le nombre de synchronisations (syncWorkflow) pendant `geste`. */
async function synchronisationsPendant(geste) {
  const avant = _synchronisationsPourTest();
  await geste();
  return _synchronisationsPourTest() - avant;
}

// --- 1. Le recalcul de chaque ecriture ne se fait qu'une fois -----------------
//
// writeDb synchronise (syncWorkflow) avant d'ecrire. Quatre chemins le
// faisaient AUSSI juste avant d'appeler writeDb : tout le recalcul deux fois.

test("un ajustement de stock ne recalcule les commandes qu'une fois", async () => {
  let r;
  const n = await synchronisationsPendant(async () => {
    r = await api("/api/stock/stk-001", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantite: 77 }) });
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.quantite, 77);
  assert.equal(n, 1, `${n} synchronisations pour un ajustement de stock`);
});

test("un import de stock ne recalcule les commandes qu'une fois", async () => {
  let r;
  const n = await synchronisationsPendant(async () => {
    r = await importer("stock", [["Code", "Nom", "Quantite"], ["3401000000000", "Gants nitrile taille S ref 100", "12"]]);
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(n, 1, `${n} synchronisations pour un import de stock`);
});

test("un import de ventes ne recalcule les commandes qu'une fois", async () => {
  let r;
  const n = await synchronisationsPendant(async () => {
    r = await importer("ventes", [
      ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"],
      ["20/09/2026", "Pharmacie du Banc", "3401000000000", "Gants nitrile taille S ref 100", "2", "1 rue du Banc", "39300", "Champagnole"]
    ]);
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(n, 1, `${n} synchronisations pour un import de ventes`);
});

test("le demarrage ne recalcule les commandes qu'une fois", async () => {
  const n = await synchronisationsPendant(async () => { S._healDatabaseAtBoot(); });
  assert.equal(n, 1, `${n} synchronisations au demarrage`);
});

// --- 2. La table de recherche du catalogue : une par ecriture -----------------
//
// analyzeOrderStock construisait la table (code et nom normalises de chaque
// produit) a chaque appel, et syncWorkflow l'appelle pour chaque commande :
// 2 x commandes x produits normalisations de texte par ecriture. On compte les
// appels a String.prototype.normalize (normalizeTextKey : NFD) pendant une
// ecriture sur le jeu de forme production (224 commandes, 218 produits).

test("une ecriture construit la table de recherche du catalogue une fois, pas une fois par commande", () => {
  const db = readDb();
  const N = db.commandes.length, M = db.stock.length;
  assert.ok(N > 200 && M > 200, "prealable : le jeu de forme production");
  const normalizeOrigine = String.prototype.normalize;
  let appels = 0;
  String.prototype.normalize = function normalize(...args) { appels += 1; return normalizeOrigine.apply(this, args); };
  try {
    writeDb(db, { backup: false });
  } finally {
    String.prototype.normalize = normalizeOrigine;
  }
  assert.ok(appels > 0, "l'instrument n'a rien vu : il ne mesure rien");
  // Avant : >= 2 x 224 x 218 = 97 664 normalisations pour la seule table.
  assert.ok(appels < 20 * (N + M), `${appels} normalisations de texte pour ${N} commandes et ${M} produits`);
});

// --- 3. Resultat identique : la table partagee rend ce que rend l'appel isole --
//
// Un appel isole (un geste sur une commande) construit encore sa propre table.
// Le catalogue ci-dessous a des doublons : deux produits au meme code, deux au
// meme nom -- le dernier l'emporte, comme avant -- et des lignes qui ne
// trouvent leur produit que par le nom, ou pas du tout.

test("temoin : l'analyse de stock ecrite est celle de l'appel isole, doublons et inconnus compris", () => {
  const stock = [
    { id: "p-a", code: "X1", nom: "Gants A", quantite: 5 },
    { id: "p-b", code: "X1", nom: "Gants B", quantite: 50 },
    { id: "p-c", code: "", nom: "Aleses", quantite: 1 },
    { id: "p-d", code: "", nom: "Aleses", quantite: 30 },
    { id: "p-e", code: "Y9", nom: "Compresses", quantite: 0 }
  ];
  const ligne = (code, nom, quantite) => ({ code, nom, quantite });
  const commandes = [
    [ligne("X1", "Gants", 10)],
    [ligne("", "Aleses", 3)],
    [ligne("ZZ", "Aleses", 2)],
    [ligne("Y9", "Compresses", 1), ligne("X1", "", 1)],
    [ligne("INCONNU", "Produit retire", 1)],
    [ligne("x1", "gants b", 60)]
  ].map((products, i) => ({ id: `cmd-t${i}`, numero: `CMD-2026-${900 + i}`, clientId: `c-t${i}`, clientName: `Client ${i}`,
    status: "stock_a_verifier", dateCommande: "2026-09-20", products }));
  writeDb({ ...defaultDb(), stock, commandes }, { backup: false });

  const db = readDb();
  assert.equal(db.commandes.length, commandes.length);
  for (const order of db.commandes) {
    const isole = analyzeOrderStock(order, db.stock);
    assert.deepEqual(order.stockLines, isole.lines, `${order.id} : lignes`);
    assert.equal(order.stockStatus, isole.status, `${order.id} : statut`);
    assert.equal(order.canPrepare, isole.canPrepare, `${order.id} : preparable`);
  }
  // Le dernier doublon l'emporte (comme avant) : un temoin qui peut varier.
  assert.equal(db.commandes[0].stockLines[0].stockId, "p-b");
  assert.equal(db.commandes[1].stockLines[0].stockId, "p-d");
  assert.equal(db.commandes[4].stockLines[0].status, "unknown");
});

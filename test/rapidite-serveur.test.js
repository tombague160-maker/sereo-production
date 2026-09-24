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
const { DatabaseSync } = require("node:sqlite");
const { jeuProduction } = require("./e2e/jeu-production");

// Le compteur des tables lues : chaque lecture d'une table passe par
// `SELECT payload FROM <table>` (comme test/lecture-paresseuse.test.js).
const requetesSql = [];
let compterSql = false;
const prepareOrigine = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function prepare(sql) {
  if (compterSql) requetesSql.push(String(sql));
  return prepareOrigine.call(this, sql);
};
async function tablesLuesPendant(geste) {
  requetesSql.length = 0;
  compterSql = true;
  try {
    await geste();
  } finally {
    compterSql = false;
  }
  return requetesSql.map(sql => /SELECT payload FROM (\w+)/.exec(sql)?.[1]).filter(Boolean);
}

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

// --- 3. Une ecriture ne relit ni ne resérialise ce qu'elle n'a pas touche ----
//
// La lecture paresseuse (24/09) ne lisait a la requete que ses tables, mais
// writeDb normalisait TOUT avant d'ecrire : l'historique, les mouvements, les
// ventes, les archives etaient relus, decodes, resérialises et haches a chaque
// geste, pour n'en ecrire rien. Et chaque geste ajoute une ligne en tete de
// l'historique : l'ajouter le lisait en entier.

/** Toute la base, lue par une seconde connexion, sans lecture paresseuse. */
function lectureComplete() {
  const { createSqliteStore } = require("../storage/sqliteStore");
  const complet = createSqliteStore({
    sqlitePath: process.env.SEREO_SQLITE_PATH, seedJsonPath: null, defaultDb, normalizeDb: S.normalizeDb, ensureDir: () => {}
  });
  try {
    return complet.readDb();
  } finally {
    complet.close();
  }
}

test("une ecriture ne relit pas les tables qu'elle ne touche pas", async () => {
  writeDb(readDb(), { backup: false }); // la premiere ecriture apres l'ouverture lit tout : pas celle-ci
  const db = readDb();
  const cible = db.commandes[0];
  cible.notes = "note posee par le banc";
  const lues = await tablesLuesPendant(() => writeDb(db, { backup: false }));
  // Temoin : l'instrument voit la table que l'ecriture lit.
  assert.ok(lues.includes("clients"), `l'instrument n'a pas vu la lecture des clients : ${lues}`);
  const inutiles = lues.filter(t => ["ventes", "historique", "mouvements_stock", "imports_archives", "abonnements"].includes(t));
  assert.deepEqual(inutiles, [], `l'ecriture d'une note de commande a relu ${inutiles.join(", ")}`);
  assert.equal(readDb().commandes.find(c => c.id === cible.id).notes, "note posee par le banc");
});

test("un geste ecrit sa ligne d'historique et son mouvement sans relire leurs tables, en tete", async () => {
  writeDb(readDb(), { backup: false });
  const avant = lectureComplete();
  const produit = avant.stock.find(p => p.id === "stk-003");
  const quantite = Number(produit.quantite || 0) + 5;
  let r;
  const lues = await tablesLuesPendant(async () => {
    r = await api("/api/stock/stk-003", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantite }) });
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(lues.includes("produits"), `l'instrument n'a rien vu : ${lues}`);
  assert.deepEqual(lues.filter(t => t === "historique" || t === "mouvements_stock"), [],
    `l'ajustement a relu ${lues.filter(t => t === "historique" || t === "mouvements_stock").join(", ")}`);
  const apres = lectureComplete();
  // Aucune ligne perdue ni deplacee : la ligne neuve en tete, le reste identique.
  assert.equal(apres.historique.length, avant.historique.length + 1);
  assert.deepEqual(apres.historique.slice(1), avant.historique);
  assert.match(apres.historique[0].message, /stock .* -> /);
  assert.equal(apres.stockMovements.length, avant.stockMovements.length + 1);
  assert.deepEqual(apres.stockMovements.slice(1), avant.stockMovements);
  assert.equal(apres.stockMovements[0].productId, "stk-003");
  assert.equal(apres.stockMovements[0].newQuantity, quantite);
});

test("une ligne ajoutee en tete puis la table lue dans la meme requete : a sa place, ecrite une fois", () => {
  writeDb(readDb(), { backup: false });
  const avant = lectureComplete().historique;
  const db = readDb();
  const { AJOUT_EN_TETE } = require("../storage/sqliteStore");
  db[AJOUT_EN_TETE]("historique", { id: "h-banc-1", date: "2026-09-25T08:00:00.000Z", type: "Banc", message: "premiere" });
  db[AJOUT_EN_TETE]("historique", { id: "h-banc-2", date: "2026-09-25T08:00:01.000Z", type: "Banc", message: "seconde" });
  // Lue apres les ajouts : les deux en tete, la derniere d'abord (unshift).
  assert.deepEqual(db.historique.slice(0, 2).map(h => h.id), ["h-banc-2", "h-banc-1"]);
  db[AJOUT_EN_TETE]("historique", { id: "h-banc-3", date: "2026-09-25T08:00:02.000Z", type: "Banc", message: "troisieme" });
  writeDb(db, { backup: false });
  const apres = lectureComplete().historique;
  assert.deepEqual(apres.slice(0, 3).map(h => h.id), ["h-banc-3", "h-banc-2", "h-banc-1"]);
  assert.deepEqual(apres.slice(3), avant);
});

test("la premiere ecriture apres l'ouverture recrit tout, comme avant (base d'une version d'avant)", () => {
  writeDb(readDb(), { backup: false });
  closeStorage();
  // Une ligne ecrite par une version d'avant : un payload qui n'est pas celui
  // que JSON.stringify rend aujourd'hui (unicode echappe).
  const cnx = new DatabaseSync(process.env.SEREO_SQLITE_PATH);
  let id, brut;
  try {
    id = cnx.prepare("SELECT id FROM historique ORDER BY sort_order LIMIT 1").get().id;
    brut = `{"id":${JSON.stringify(id)},"type":"Banc","message":"caf\\u00e9","date":"2020-01-01"}`;
    cnx.prepare("UPDATE historique SET payload = ? WHERE id = ?").run(brut, id);
  } finally {
    cnx.close();
  }
  // Reouverture, puis une ecriture qui ne touche pas l'historique.
  const db = readDb();
  db.commandes[0].notes = "apres reouverture";
  writeDb(db, { backup: false });
  const cnx2 = new DatabaseSync(process.env.SEREO_SQLITE_PATH);
  let payload;
  try {
    payload = cnx2.prepare("SELECT payload FROM historique WHERE id = ?").get(id)?.payload;
  } finally {
    cnx2.close();
  }
  assert.ok(payload, `la ligne ${id} a disparu`);
  assert.notEqual(payload, brut, "la ligne d'une version d'avant n'a pas ete recrite a la premiere ecriture");
  assert.equal(JSON.parse(payload).message, "café");
});

// --- 4. Resultat identique : la table partagee rend ce que rend l'appel isole --
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

// --- 5. Aucune donnee perdue : l'ecriture sans relire = une reecriture complete
//
// Le risque de ne pas relire : oublier une table modifiee, perdre une ligne
// ajoutee en tete, la ranger ailleurs. Ce banc joue 120 pas tires au hasard
// (graine fixe) sur un magasin en LECTURE PARESSEUSE -- chaque pas ne lit que
// les tables qu'il touche, ajoute en tete avant ou apres avoir lu -- et
// compare apres CHAQUE pas la base a une base neuve ecrite d'un coup depuis un
// modele (memes mutations sur des objets ordinaires) : memes lignes, memes
// colonnes, meme ordre.

test("120 pas au hasard : la base ecrite sans relire egale une base reecrite d'un coup", () => {
  const { createSqliteStore, ETAT_DE_LECTURE, AJOUT_EN_TETE } = require("../storage/sqliteStore");
  const CLES = ["clients", "ventes", "stock", "historique", "commandes", "routes", "subscriptions", "relances", "deliverySectors", "stockMovements", "importsArchives", "settings"];
  const vide = () => ({ clients: [], commandes: [], stock: [], ventes: [], historique: [], routes: [], subscriptions: [], relances: [], deliverySectors: [], stockMovements: [], importsArchives: [], settings: {} });
  const normaliserTable = (cle, v) => (cle === "settings" ? (v && typeof v === "object" ? v : {}) : (Array.isArray(v) ? v : []));
  // Meme regle que normalizeDb (server.js) : une table non lue n'est pas normalisee.
  const normaliser = db => {
    const etat = db[ETAT_DE_LECTURE];
    for (const cle of CLES) {
      if (etat && !etat.lue(cle)) continue;
      db[cle] = normaliserTable(cle, db[cle]);
    }
    return db;
  };
  const dossier = path.join(tmpRoot, "sans-relire");
  fs.mkdirSync(dossier, { recursive: true });
  const ouvrir = (fichier, paresseux) => createSqliteStore({
    sqlitePath: fichier, seedJsonPath: "", defaultDb: vide, normalizeDb: normaliser,
    normaliserTable: paresseux ? normaliserTable : undefined, ensureDir: d => fs.mkdirSync(d, { recursive: true })
  });
  const TABLES = {
    produits: "id, reference, nom, stock_actuel, stock_minimum, stock_bloque, unite, updated_at, payload",
    clients: "id, nom, adresse, ville, code_postal, telephone, secteur, updated_at, payload",
    commandes: "id, numero, date_commande, excel_row_hash, client_id, date_import, date_preparation, date_livraison, statut, source_excel, updated_at, payload",
    lignes_commande: "id, commande_id, produit_id, quantite, quantite_preparee, statut, stock_suffisant, payload",
    routes: "id, statut, secteur, date_livraison, payload",
    livraisons: "id, commande_id, client_id, date_livraison, secteur, statut, note_probleme, date_mise_a_jour, payload",
    abonnements: "id, payload",
    relances_crm: "id, client_id, commande_id, date_prevue, statut, payload",
    secteurs_livraison: "id, nom, ville, jour_mois, frequence, point_depart, payload",
    mouvements_stock: "id, produit_id, type, quantite, raison, reference_commande, date, utilisateur, payload",
    ventes: "id, payload",
    historique: "id, type, message, date, payload",
    imports_archives: "id, type, filename, archived_path, imported_at, rows_count, file_size, sha256, stats_json, payload"
  };
  const contenu = fichier => {
    const cnx = new DatabaseSync(fichier);
    try {
      const out = {};
      for (const [t, cols] of Object.entries(TABLES)) out[t] = cnx.prepare(`SELECT ${cols} FROM ${t} ORDER BY sort_order, id`).all().map(r => ({ ...r }));
      out.traces = cnx.prepare("SELECT route_id, trace FROM traces_tournees ORDER BY route_id").all().map(r => ({ ...r }));
      out.reglages = cnx.prepare("SELECT value FROM app_meta WHERE key = 'settings'").get()?.value;
      return out;
    } finally {
      cnx.close();
    }
  };

  let graine = 2509;
  const hasard = n => { graine = (graine * 1103515245 + 12345) % 2147483648; return Math.floor((graine / 2147483648) * n); };
  let seq = 0;
  const neuf = p => `${p}-${++seq}`;
  const ligne = (cle, id) => ({
    historique: { id, type: "Banc", message: `geste ${id}`, date: "2026-09-25" },
    stockMovements: { id, productId: "p1", type: "entree", quantity: seq, createdAt: "2026-09-25" },
    ventes: { id, total: seq },
    importsArchives: { id, type: "ventes", filename: `${id}.xlsx`, stats: { n: seq } },
    subscriptions: { id, clientId: "c1", status: "active" },
    relances: { id, clientId: "c1", datePrevue: "2026-10-01", status: "a_faire" },
    deliverySectors: { id, secteur: `S${seq}`, villePrincipale: "Dole" },
    clients: { id, nom: `Client ${seq}`, ville: "Dole" },
    stock: { id, code: `P${seq}`, nom: `Produit ${seq}`, quantite: seq },
    commandes: { id, clientId: "c1", status: seq % 2 ? "livre" : "pret_livraison", products: [{ code: "P1", nom: "Produit", quantite: seq }] },
    routes: { id, status: "prete", stops: [{ id: `${id}-a`, orderId: "o1", status: "pret_livraison" }], geometry: null }
  })[cle];
  const LISTES = ["historique", "stockMovements", "ventes", "importsArchives", "subscriptions", "relances", "deliverySectors", "clients", "stock", "commandes", "routes"];
  const initial = {};
  for (const cle of LISTES) initial[cle] = Array.from({ length: 6 }, () => ligne(cle, neuf(cle)));
  initial.settings = { appearance: { themeId: "sereo" } };
  const modele = structuredClone({ ...vide(), ...initial });

  // Ajouter en tete : sans lire si le magasin le sait, sinon unshift.
  const enTete = (db, cle, l) => (typeof db[AJOUT_EN_TETE] === "function" ? db[AJOUT_EN_TETE](cle, l) : db[cle].unshift(l));
  const auHasard = db => { const cle = LISTES[hasard(LISTES.length)]; return [cle, db[cle]]; };
  const mutations = [
    ["historique en tete, sans lire", db => enTete(db, "historique", ligne("historique", neuf("h")))],
    ["mouvement en tete, sans lire", db => enTete(db, "stockMovements", ligne("stockMovements", neuf("m")))],
    ["deux en tete puis lecture et retouche", db => {
      enTete(db, "historique", ligne("historique", neuf("h")));
      enTete(db, "historique", ligne("historique", neuf("h")));
      db.historique[1].message = neuf("retouche");
    }],
    ["lecture puis en tete", db => { void db.stockMovements.length; enTete(db, "stockMovements", ligne("stockMovements", neuf("m"))); }],
    ["en tete puis table remplacee", db => { enTete(db, "historique", ligne("historique", neuf("h"))); db.historique = db.historique.slice(0, 3); }],
    ["ligne modifiee", db => { const [, t] = auHasard(db); if (t.length) t[hasard(t.length)].note = neuf("note"); }],
    ["ligne retiree", db => { const [, t] = auHasard(db); if (t.length > 1) t.splice(hasard(t.length), 1); }],
    ["ligne au milieu", db => { const [cle, t] = auHasard(db); t.splice(hasard(t.length + 1), 0, ligne(cle, neuf(cle))); }],
    ["table inversee", db => { const [, t] = auHasard(db); t.reverse(); }],
    ["table lue sans rien changer", db => { void auHasard(db)[1].length; }],
    ["table remplacee sans etre lue", db => { const cle = LISTES[hasard(LISTES.length)]; db[cle] = [ligne(cle, neuf(cle)), ligne(cle, neuf(cle))]; }],
    ["reglages modifies", db => { db.settings = { ...db.settings, marque: neuf("r") }; }],
    ["commande livree", db => { const c = db.commandes.find(x => x.status !== "livre"); if (c) c.status = "livre"; }],
    ["rien", () => {}]
  ];

  const A = ouvrir(path.join(dossier, "a.sqlite"), true);
  try {
    A.writeDb(structuredClone(modele));
    for (let pas = 1; pas <= 120; pas++) {
      const tirees = Array.from({ length: 1 + hasard(3) }, () => mutations[hasard(mutations.length)]);
      const [memeGraine, memeSeq] = [graine, seq];
      // Le chemin reel : lire (paresseux), muter, ecrire. Le modele subit les
      // memes mutations (memes tirages, memes identifiants).
      const lu = A.readDb();
      for (const [, muter] of tirees) muter(lu);
      A.writeDb(lu);
      [graine, seq] = [memeGraine, memeSeq];
      for (const [, muter] of tirees) muter(modele);

      const fichierB = path.join(dossier, `b-${pas}.sqlite`);
      const B = ouvrir(fichierB, false);
      B.writeDb(structuredClone(modele));
      B.close();
      const attendu = contenu(fichierB);
      fs.rmSync(fichierB, { force: true });
      const obtenu = contenu(path.join(dossier, "a.sqlite"));
      assert.deepEqual(obtenu, attendu, `pas ${pas} (${tirees.map(([nom]) => nom).join(" + ")}) : la base ecrite sans relire a diverge`);
    }
    // Et ce que relit le magasin paresseux est le modele, table pour table.
    const relu = A.readDb();
    for (const cle of CLES) assert.deepEqual(relu[cle], modele[cle], `la table ${cle} relue differe du modele`);
  } finally {
    A.close();
  }
});

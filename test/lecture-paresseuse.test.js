// La lecture paresseuse de la base (24/09, mesure en production).
//
// LE DEFAUT. readDb relisait et decodait les DOUZE tables a chaque requete.
// L'ouverture lance une vingtaine de routes ensemble ; Node les traite l'une
// apres l'autre, et chacune payait la base entiere -- l'historique, les ventes
// et les mouvements compris, qu'aucune ne lit. En production : 580 a 710 ms
// par route quand elles partent ensemble (29 a 81 ms une par une).
//
// CE QUE CE BANC MESURE : des TABLES LUES, pas des millisecondes. Chaque
// lecture d'une table passe par `SELECT payload FROM <table>` ; on compte ces
// requetes SQL pendant chaque route de l'ouverture, une route a la fois. Le
// resultat ne depend pas de la machine.
//
// ET CE QUI NE DOIT PAS CHANGER : le contenu lu (identique a une lecture
// complete), et l'ecriture (une table non lue n'est ni perdue ni figee ; une
// table remplacee l'est vraiment).

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

// Le compteur de lectures : pose AVANT le chargement du serveur.
const requetesSql = [];
let compter = false;
const prepareOrigine = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function prepare(sql) {
  if (compter) requetesSql.push(String(sql));
  return prepareOrigine.call(this, sql);
};

const { jeuProduction } = require("./e2e/jeu-production");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-paresseuse-"));
fs.mkdirSync(path.join(tmpRoot, "data"), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, "data", "seed.json"), JSON.stringify(jeuProduction()));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "seed.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const { app, readDb, writeDb, defaultDb, normalizeDb, closeStorage, _flushPendingBackup } = require("../server");
const { createSqliteStore } = require("../storage/sqliteStore");

let server;
let base;
before(() => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(async () => {
  try { await _flushPendingBackup(); } catch { /* rien en attente */ }
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  resolve();
})));

// Les routes que la page lance a l'ouverture (loadData, reglages, identite).
const OUVERTURE = ["/api/operations", "/api/subscriptions", "/api/clients", "/api/stock", "/api/orders", "/api/crm/clients",
  "/api/reminders", "/api/planned-orders", "/api/statistics", "/api/sectors", "/api/delivery-sectors", "/api/routes",
  "/api/stock-movements?limite=12", "/api/dashboard", "/api/settings/appearance", "/api/settings/tournee",
  "/api/settings/order-numbering", "/api/storage/status"];

/** Les tables lues (SELECT payload FROM ...) pendant une requete, une a la fois. */
async function tablesLues(chemin) {
  requetesSql.length = 0;
  compter = true;
  try {
    const res = await fetch(base + chemin);
    assert.equal(res.status, 200, `${chemin} : ${res.status}`);
    await res.arrayBuffer();
  } finally {
    compter = false;
  }
  return requetesSql.map(sql => /SELECT payload FROM (\w+)/.exec(sql)?.[1]).filter(Boolean);
}

test("une route de l'ouverture ne lit que les tables qu'elle sert", async () => {
  const lues = {};
  for (const chemin of OUVERTURE) lues[chemin] = await tablesLues(chemin);
  const total = Object.values(lues).reduce((s, t) => s + t.length, 0);
  console.log(`[lecture] ${total} lectures de table pour ${OUVERTURE.length} routes : ${Object.entries(lues).map(([c, t]) => `${c}=${t.length}`).join(" ")}`);
  // Temoin : l'instrument voit les lectures.
  assert.deepEqual(lues["/api/clients"], ["clients"]);
  assert.ok(lues["/api/orders"].includes("commandes"));
  // Aucune route de l'ouverture ne lit l'historique, ni les archives d'import.
  assert.deepEqual(Object.entries(lues).filter(([, t]) => t.includes("historique")).map(([c]) => c), [], "des routes lisent l'historique");
  assert.deepEqual(Object.entries(lues).filter(([, t]) => t.includes("imports_archives")).map(([c]) => c), [], "des routes lisent les archives d'import");
  // Avant : 11 tables (plus les reglages) par route qui lit la base -- 187 ici.
  assert.ok(total <= 45, `${total} lectures de table (avant : 11 par route qui lit la base)`);
});

test("temoin : le contenu lu est celui d'une lecture complete, table pour table", () => {
  const complet = createSqliteStore({
    sqlitePath: process.env.SEREO_SQLITE_PATH, seedJsonPath: null, defaultDb, normalizeDb, ensureDir: () => {}
  });
  // Seule difference permise : un secteur de livraison sans date de creation
  // en recoit une a CHAQUE lecture (normalizeDeliverySector : `|| now`), deux
  // lectures completes different deja la-dessus.
  const sansHorodatageDeLecture = db => {
    const copie = JSON.parse(JSON.stringify(db));
    for (const s of copie.deliverySectors) { delete s.createdAt; delete s.updatedAt; }
    return copie;
  };
  try {
    const attendu = sansHorodatageDeLecture(complet.readDb());
    const paresseux = readDb();
    assert.deepEqual(Object.keys(paresseux).sort(), Object.keys(attendu).sort());
    const lu = sansHorodatageDeLecture(paresseux);
    for (const cle of Object.keys(attendu)) {
      assert.deepEqual(lu[cle], attendu[cle], `la table ${cle} differe`);
    }
    // Et en entier, comme le lirait un export (JSON.stringify lit tout).
    assert.equal(JSON.stringify(sansHorodatageDeLecture(readDb())), JSON.stringify(attendu));
  } finally {
    complet.close();
  }
});

test("une ecriture apres une lecture partielle garde les tables non lues, et une table remplacee l'est", () => {
  const avant = readDb();
  const tailles = { historique: avant.historique.length, stockMovements: avant.stockMovements.length, ventes: avant.ventes.length, commandes: avant.commandes.length };
  assert.ok(tailles.historique > 1000 && tailles.stockMovements > 600, "prealable : le jeu de forme production");

  // Seuls les clients sont lus ; on en modifie un.
  const db = readDb();
  const id = db.clients[0].id;
  db.clients[0].notes = "note posee par le banc";
  writeDb(db);
  const relu = readDb();
  assert.equal(relu.clients.find(c => c.id === id).notes, "note posee par le banc");
  for (const [cle, n] of Object.entries(tailles)) assert.equal(relu[cle].length, n, `la table ${cle} a change sans etre lue`);

  // Une table REMPLACEE sans avoir ete lue : la valeur posee est ecrite.
  const db2 = readDb();
  db2.importsArchives = [];
  writeDb(db2);
  assert.equal(readDb().importsArchives.length, 0);
});

// Robustesse (25/09, chasse aux defauts, section 4) : /healthz ne regardait
// jamais la base. Toutes les pages pouvaient repondre 500 pendant que Docker
// voyait le conteneur « healthy » (mesure du rapport). /healthz lit desormais
// chaque table (sonderLecture) et repond 503 quand la base ne se lit plus.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-healthz-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const { app, readDb, writeDb, defaultDb, closeStorage, getSqliteStoreForTests, _oublierSondeCompletePourTest } = require("../server");

let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(r => server.close(r));
  closeStorage();
  fs.rmSync(root, { recursive: true, force: true });
});

// Une connexion par requete : voir test/lot5-rapidite.test.js (api).
async function api(chemin) {
  const res = await fetch(base + chemin, { headers: { connection: "close" } });
  const texte = await res.text();
  let body;
  try { body = JSON.parse(texte); } catch { body = texte; }
  return { status: res.status, body };
}

function semer() {
  closeStorage();
  for (const f of fs.readdirSync(root)) if (f.startsWith("db.sqlite")) fs.rmSync(path.join(root, f));
  writeDb({
    ...defaultDb(),
    clients: [{ id: "c1", nom: "Client 1", rue: "1 rue du Test", codePostal: "39300", ville: "Champagnole" }],
    stock: [{ id: "p1", code: "P1", nom: "Produit", quantite: 5 }],
    ventes: Array.from({ length: 40 }, (_, i) => ({ id: `v${i}`, client: "Client 1", produit: "Produit ".repeat(40), quantite: 1 }))
  }, { backup: false });
}

test("base saine : /healthz repond 200 (temoin)", async () => {
  semer();
  const r = await api("/healthz");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
});

test("connexion a la base perdue : les pages repondent 500, /healthz le dit (503)", async () => {
  semer();
  readDb();
  // La connexion meurt sous le serveur (le store reste en place : c'est
  // l'etat « zombie » que Docker ne voyait pas).
  getSqliteStoreForTests().close();
  const commandes = await api("/api/orders");
  assert.equal(commandes.status, 500, "temoin : l'application devrait etre en panne");
  const sante = await api("/healthz");
  assert.equal(sante.status, 503, `/healthz : ${JSON.stringify(sante.body)}`);
  assert.deepEqual(sante.body, { ok: false, error: "base illisible" });
  closeStorage();
});

test("une page de la base abimee pendant que le serveur tourne : /healthz repond 503", async () => {
  semer();
  readDb().ventes.length; // la base est ouverte et lue
  assert.equal((await api("/healthz")).status, 200, "prealable");
  // Tout dans le fichier principal, puis la racine de la table ventes abimee
  // sur le disque (type de page invalide).
  const cnx = new DatabaseSync(process.env.SEREO_SQLITE_PATH);
  cnx.exec("PRAGMA busy_timeout = 5000");
  cnx.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const taille = cnx.prepare("PRAGMA page_size").get().page_size;
  const racine = cnx.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'ventes'").get().rootpage;
  const fd = fs.openSync(process.env.SEREO_SQLITE_PATH, "r+");
  fs.writeSync(fd, Buffer.from([0xff, 0xff, 0xff, 0xff]), 0, 4, (racine - 1) * taille + (racine === 1 ? 100 : 0));
  fs.closeSync(fd);
  // Une ecriture d'une AUTRE connexion : le serveur ne peut plus relire ses
  // pages de sa memoire, il relit le disque.
  cnx.exec("UPDATE app_meta SET updated_at = updated_at WHERE key = 'initialized'");
  cnx.exec("INSERT INTO gestes_recus (cle, methode, chemin, statut, recu_le) VALUES ('sonde', 'GET', '/', 200, '2026-09-25')");
  cnx.close();
  const ventes = await api("/api/ventes");
  assert.equal(ventes.status, 500, `temoin : la table abimee devrait etre illisible (${JSON.stringify(ventes.body).slice(0, 200)})`);
  const sante = await api("/healthz");
  assert.equal(sante.status, 503, `/healthz : ${JSON.stringify(sante.body)}`);
  closeStorage();
});

/** Abime l'en-tete de la DERNIERE page feuille d'une table, sur le disque, par une autre connexion. */
function abimerDerniereFeuille(table) {
  const cnx = new DatabaseSync(process.env.SEREO_SQLITE_PATH);
  cnx.exec("PRAGMA busy_timeout = 5000");
  cnx.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const taille = cnx.prepare("PRAGMA page_size").get().page_size;
  const feuilles = cnx.prepare("SELECT pageno FROM dbstat WHERE name = ? AND pagetype = 'leaf' ORDER BY pageno").all(table);
  const racine = cnx.prepare("SELECT rootpage FROM sqlite_master WHERE name = ?").get(table).rootpage;
  const cible = feuilles[feuilles.length - 1].pageno;
  assert.ok(feuilles.length > 50 && cible !== racine, `prealable : ${feuilles.length} feuilles, cible ${cible}, racine ${racine}`);
  const fd = fs.openSync(process.env.SEREO_SQLITE_PATH, "r+");
  fs.writeSync(fd, Buffer.from([0xff, 0xff, 0xff, 0xff]), 0, 4, (cible - 1) * taille);
  fs.closeSync(fd);
  cnx.exec("UPDATE app_meta SET updated_at = updated_at WHERE key = 'initialized'");
  cnx.close();
}

function semerHistorique() {
  closeStorage();
  for (const f of fs.readdirSync(root)) if (f.startsWith("db.sqlite")) fs.rmSync(path.join(root, f));
  // Le volume de la production : 1 036 lignes d'historique (~130 pages feuilles).
  writeDb({
    ...defaultDb(),
    historique: Array.from({ length: 1036 }, (_, i) => ({ id: `h-${i}`, date: `2026-09-01T08:${String(i % 60).padStart(2, "0")}:00.000Z`, type: "Test", message: "x".repeat(200) }))
  }, { backup: false });
}

test("une page abimee AILLEURS que la premiere (la derniere feuille de l'historique) : /healthz repond 503", async () => {
  // Relecture adverse du 26/09 : la sonde ne lisait que la premiere ligne de
  // chaque table, donc sa feuille la plus a gauche ; toutes les pages et tous
  // les gestes (qui relisent l'historique) repondaient 500 sous un /healthz a 200.
  semerHistorique();
  readDb().historique.length;
  abimerDerniereFeuille("historique");
  const journal = await api("/api/journal");
  assert.equal(journal.status, 500, `temoin : la page abimee devrait rendre l'historique illisible (${JSON.stringify(journal.body).slice(0, 200)})`);
  const sante = await api("/healthz");
  assert.equal(sante.status, 503, `/healthz : ${JSON.stringify(sante.body)}`);
  assert.deepEqual(sante.body, { ok: false, error: "base illisible" });
  closeStorage();
});

test("/healthz est public : la relecture de chaque page se fait au plus une fois par intervalle, et un echec reste dit jusqu'a la suivante", async () => {
  semerHistorique();
  const store = getSqliteStoreForTests();
  let relectures = 0;
  const verifierPages = store.verifierPages;
  store.verifierPages = () => { relectures += 1; return verifierPages(); };
  for (let i = 0; i < 10; i++) assert.equal((await api("/healthz")).status, 200);
  assert.equal(relectures, 1, `${relectures} relectures completes pour 10 appels`);
  // Un echec de la relecture complete : dit a chaque appel jusqu'a la suivante.
  _oublierSondeCompletePourTest();
  store.verifierPages = () => { relectures += 1; throw new Error("database disk image is malformed"); };
  assert.equal((await api("/healthz")).status, 503);
  store.verifierPages = verifierPages;
  assert.equal((await api("/healthz")).status, 503, "l'echec de la relecture complete est oublie avant la suivante");
  assert.equal(relectures, 2);
  closeStorage();
});

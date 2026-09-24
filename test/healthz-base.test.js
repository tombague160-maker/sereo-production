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

const { app, readDb, writeDb, defaultDb, closeStorage, getSqliteStoreForTests } = require("../server");

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

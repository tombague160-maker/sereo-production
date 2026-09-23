// Lot 5 de l'audit geo (23/09) : rapidite.
//
// Les mesures du rapport (§4) : a 250 tournees d'historique, un « Livre » fige
// le serveur 0,9 a 2 s et le rechargement qui suit prend 5,5 a 8,8 s. Chaque
// banc ci-dessous vise UNE des causes, et echoue sur le code d'avant.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-lot5-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const S = require("../server");
const { app, readDb, writeDb, defaultDb, closeStorage, _flushPendingBackup } = S;

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

async function api(chemin, init = {}) {
  const headers = { Origin: base, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) };
  const res = await fetch(base + chemin, { ...init, headers });
  const texte = await res.text();
  let body;
  try { body = texte ? JSON.parse(texte) : undefined; } catch { body = texte; }
  return { status: res.status, body };
}

// --- Une tournee terminee de N arrets, avec son trace ------------------------

function commande(id, statut, i = 0) {
  return {
    id, clientId: "c" + (i % 5), clientName: "Client " + (i % 5), address: i + " rue du Test",
    postalCode: "39300", city: "Champagnole", status: statut, preparationStatus: "terminee",
    lat: 46.7 + i / 1000, lng: 5.9 + i / 1000, products: [{ code: "P1", nom: "Produit", quantite: 1 }],
    deliveryDate: "2026-09-23"
  };
}

function trace(n = 50) {
  return { type: "LineString", coordinates: Array.from({ length: n }, (_, j) => [5.9 + j / 1e4, 46.7 + j / 1e4]) };
}

function tournee(id, statut, commandes, extra = {}) {
  return {
    id, sector: "Champagnole", status: statut, deliveryDate: "2026-09-23",
    stops: commandes.map((c, k) => ({
      id: `stop-${id}-${k + 1}`, routeId: id, orderId: c.id, clientId: c.clientId, orderIndex: k + 1,
      clientName: c.clientName, address: c.address, city: c.city, postalCode: c.postalCode,
      status: statut === "terminee" ? "livre" : statut === "en_livraison" ? "en_livraison" : "pret_livraison",
      lat: c.lat, lng: c.lng, products: []
    })),
    geometry: trace(), routingMode: "road", totalDistance: 10, estimatedDuration: 30,
    createdAt: "2026-09-01T08:00:00.000Z", ...extra
  };
}

function clients() {
  return Array.from({ length: 5 }, (_, i) => ({ id: "c" + i, nom: "Client " + i, rue: i + " rue du Test", codePostal: "39300", ville: "Champagnole" }));
}

// --- 1. La boucle qui recalculait l'index des commandes pour chaque tournee ---

test("lot 5 : l'index des commandes se construit une fois, pas une fois par tournee", () => {
  const N = 1000, R = 200;
  const cmd = Array.from({ length: N }, (_, i) => commande("o" + i, "livre", i));
  const routes = Array.from({ length: R }, (_, r) => tournee("r" + r, "terminee", [cmd[r]]));
  const db = { ...defaultDb(), clients: clients(), commandes: cmd, routes };

  // new Map(iterable) appelle Map.prototype.set pour chaque entree : compter
  // les appels, c'est compter le travail. Avant : R x N = 200 000 insertions.
  const setOriginal = Map.prototype.set;
  let insertions = 0;
  Map.prototype.set = function (...args) { insertions++; return setOriginal.apply(this, args); };
  try {
    writeDb(db, { backup: false });
  } finally {
    Map.prototype.set = setOriginal;
  }
  assert.ok(insertions > 0, "le compteur n'a rien vu : l'instrument ne mesure rien");
  assert.ok(insertions < 50 * (N + R), `${insertions} insertions dans des Map pour ${N} commandes et ${R} tournees`);
});

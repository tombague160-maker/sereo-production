// Lot 3 de l'audit geo, relecture adverse (23/09) : en stockage JSON
// (SEREO_STORAGE=json), le calcul de tournee geocode toujours.
//
// Avant la relecture, le geocodeur partage rendait null hors SQLite (il n'y a
// pas de table de cache) : toute commande sans position etait refusee pour
// « adresse incomplete », alors que son adresse etait complete. Avant le lot,
// routing.geocode interrogeait le geocodeur quel que soit le stockage.
//
// Processus separe d'adresses-justes.test.js : le moteur de stockage est lu au
// chargement de server.js. Aucun appel reseau reel (fetch intercepte).

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-adresses-json-"));

process.env.SEREO_STORAGE = "json";
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "inutilise.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_ROUTING_URL = "http://osrm.test";
delete process.env.SEREO_GEOCODER_URL;

const vraiFetch = globalThis.fetch;
const requetesBan = [];

globalThis.fetch = async (entree, init = {}) => {
  const url = new URL(typeof entree === "string" ? entree : String(entree.url || entree));
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return vraiFetch(entree, init);
  const json = corps => new Response(JSON.stringify(corps), { status: 200, headers: { "content-type": "application/json" } });
  if (url.hostname === "api-adresse.data.gouv.fr") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    requetesBan.push(q);
    if (q.includes("3 rue de la gare")) {
      return json({ features: [{ type: "Feature", geometry: { type: "Point", coordinates: [5.9101, 46.7452] }, properties: { score: 0.95, type: "housenumber", label: "3 Rue de la Gare 39300 Champagnole", postcode: "39300", city: "Champagnole" } }] });
    }
    return json({ features: [] });
  }
  if (url.hostname === "osrm.test") {
    const points = url.pathname.split("/").pop().split(";");
    const n = points.length;
    if (url.pathname.includes("/table/")) {
      return json({ code: "Ok", durations: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 60 * (1 + Math.abs(i - j))))) });
    }
    return json({ code: "Ok", routes: [{ distance: 12000, duration: 1500, geometry: { type: "LineString", coordinates: points.map(p => p.split(",").map(Number)) } }] });
  }
  throw new Error(`appel externe interdit dans ce banc : ${url.hostname}`);
};

const { app, closeStorage, defaultDb, writeDb, _flushPendingBackup } = require("../server");

let server;
let base;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await _flushPendingBackup?.();
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  globalThis.fetch = vraiFetch;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const AUJOURDHUI = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

test("stockage JSON — une commande a l'adresse complete mais sans position est geocodee par le calcul", async () => {
  const commande = (id, clientId, rue, extra = {}) => ({
    id, clientId, clientName: `Client ${clientId}`, status: "pret_livraison",
    address: rue, postalCode: "39300", city: "Champagnole", lat: "", lng: "",
    deliveryDate: AUJOURDHUI, dateCommande: AUJOURDHUI,
    products: [{ code: "CH-L", nom: "Changes L", quantite: 1 }],
    ...extra
  });
  writeDb({
    ...defaultDb(),
    clients: [
      { id: "c1", nom: "Client c1", rue: "3 rue de la Gare", codePostal: "39300", ville: "Champagnole", lat: "", lng: "", statut: "restant", produits: [] },
      { id: "c2", nom: "Client c2", rue: "1 place Roger Salengro", codePostal: "39300", ville: "Champagnole", lat: 46.747, lng: 5.914, statut: "restant", produits: [] }
    ],
    commandes: [
      commande("o1", "c1", "3 rue de la Gare"),
      commande("o2", "c2", "1 place Roger Salengro", { lat: 46.747, lng: 5.914 })
    ],
    stock: [{ id: "p1", code: "CH-L", nom: "Changes L", quantite: 100, tarif: 12 }]
  }, { backup: false });

  const depart = { lat: 46.745, lng: 5.91, label: "Dépôt" };
  const reponse = await fetch(`${base}/api/routes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderIds: ["o1", "o2"], departure: depart, arrival: depart, deliveryDate: AUJOURDHUI })
  });
  const corps = await reponse.json();
  assert.equal(reponse.status, 201, corps?.error);
  assert.ok(requetesBan.some(q => q.includes("3 rue de la gare")), "la BAN n'a pas ete interrogee");
  const arret = corps.stops.find(s => s.orderId === "o1");
  assert.equal(Number(arret.lat), 46.7452);
});

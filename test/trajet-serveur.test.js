// Lot 7 de l'audit geo (23/09), cote serveur : ce que la tournee GARDE du
// calcul, et le mode « sans depart ».
//
// Un faux OSRM local (aucun appel reseau externe) rend une table de durees
// tiree des coordonnees de la requete, avec `null` pour un point declare
// injoignable, et un trace avec une duree par troncon.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http");
const { once } = require("node:events");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-trajet-"));
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_GEOCODAGE_AUTO = "0";
// Jamais de repli vers le serveur public depuis un banc.
process.env.SEREO_ROUTING_REPLI_URL = "";
const { app, readDb, writeDb, defaultDb, closeStorage, _flushPendingBackup, optimizeOrders, _distance } = require("../server");

let server, base, osrm;
const isoles = new Set();
before(async () => {
  osrm = http.createServer((req, res) => {
    const pts = req.url.split("/driving/")[1].split("?")[0].split(";");
    const xy = pts.map((p) => p.split(",").map(Number));
    const d = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 100000);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url.includes("/table/")
      ? { code: "Ok", durations: xy.map((a, i) => xy.map((b, j) => (i === j ? 0 : isoles.has(pts[i]) || isoles.has(pts[j]) ? null : d(a, b)))) }
      : { code: "Ok", routes: [{ distance: 9000, duration: 900, geometry: { type: "LineString", coordinates: xy },
          legs: xy.slice(1).map((b, i) => ({ duration: d(xy[i], b) / 10, distance: d(xy[i], b) })) }] }));
  });
  osrm.listen(0, "127.0.0.1");
  await once(osrm, "listening");
  process.env.SEREO_ROUTING_URL = `http://127.0.0.1:${osrm.address().port}`;
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await _flushPendingBackup();
  await new Promise((r) => server.close(r));
  osrm.closeAllConnections();
  await new Promise((r) => osrm.close(r));
  closeStorage();
  fs.rmSync(root, { recursive: true, force: true });
});
const commande = (id, lng, extra = {}) => ({
  id, clientId: `c-${id}`, clientName: `Client ${id}`, status: "pret_livraison",
  address: `${id} rue du Moulin`, city: "Besançon", postalCode: "25000", lat: 47.2, lng, products: [], ...extra,
});
beforeEach(() => {
  isoles.clear();
  writeDb({
    ...defaultDb(),
    // Sur une ligne est-ouest : l'ordre naturel est a, b, c, d.
    commandes: [commande("a", 6.01), commande("b", 6.02), commande("c", 6.03), commande("d", 6.04)],
  }, { backup: false });
});
async function request(url, body, method = "POST") {
  const r = await fetch(base + url, body ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return { status: r.status, body: await r.json() };
}
const DEPART = { lat: 47.2, lng: 6.0, label: "Dépôt" };

// --- Mode « sans depart » ------------------------------------------------------
function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
/** Plus court chemin OUVERT (depart et arrivee libres), par force brute. */
function cheminOuvertOptimal(points) {
  const n = points.length;
  const d = points.map((a) => points.map((b) => _distance(a, b)));
  let meilleur = Infinity;
  const pris = new Array(n).fill(false);
  (function explorer(dernier, profondeur, cumul) {
    if (cumul >= meilleur) return;
    if (profondeur === n) { meilleur = cumul; return; }
    for (let k = 0; k < n; k++) {
      if (pris[k]) continue;
      pris[k] = true;
      explorer(k, profondeur + 1, dernier < 0 ? 0 : cumul + d[dernier][k]);
      pris[k] = false;
    }
  })(-1, 0, 0);
  return meilleur;
}
const longueur = (ordre) => ordre.slice(1).reduce((s, p, i) => s + _distance(ordre[i], p), 0);

test("sans depart : le chemin entre les arrets n'est plus a 16 % de l'optimum (median <= 1 %, pire <= 5 %)", () => {
  const ecarts = [];
  const centres = [[47.2378, 6.0241], [46.7466, 5.9097], [47.0926, 5.4897]];
  let graine = 77;
  for (let n = 5; n <= 9; n++)
    for (let essai = 0; essai < 40; essai++) {
      const rnd = prng(graine++);
      const points = Array.from({ length: n }, (_, i) => {
        const c = centres[Math.floor(rnd() * (1 + (essai % 3)))];
        const r = (rnd() < 0.6 ? 3 : 20) * Math.sqrt(rnd()), t = rnd() * 2 * Math.PI;
        return { id: `p${i}`, clientName: `Client ${i}`, sector: "", city: "", postalCode: "", address: `${String.fromCharCode(97 + ((i * 7) % 26))} rue`,
          lat: c[0] + (r / 111) * Math.sin(t), lng: c[1] + (r / 76) * Math.cos(t) };
      });
      const ordre = optimizeOrders(points);
      assert.equal(new Set(ordre.map((p) => p.id)).size, n);
      ecarts.push((longueur(ordre) / cheminOuvertOptimal(points) - 1) * 100);
    }
  const trie = [...ecarts].sort((a, b) => a - b);
  const median = trie[Math.floor(trie.length / 2)], pire = trie.at(-1);
  assert.ok(median <= 1 && pire <= 5, `sans depart : median ${median.toFixed(2)} %, pire ${pire.toFixed(2)} % sur ${ecarts.length}`);
});

test("sans depart : les commandes « a livrer en premier » passent en tete", async () => {
  const r = await request("/api/routes", { orderIds: ["a", "b", "c", "d"], premiers: ["c"] });
  assert.equal(r.status, 201);
  assert.equal(r.body.stops[0].orderId, "c");
  assert.equal(r.body.stops[0].livrerEnPremier, true);
  assert.ok(r.body.stops.slice(1).every((s) => s.livrerEnPremier === false));
});

// --- Mode routier ----------------------------------------------------------------
test("a livrer en premier : l'arret epingle ouvre la tournee, le drapeau est garde, et un recalcul le respecte", async () => {
  const libre = await request("/api/routes", { orderIds: ["a", "b", "c", "d"], departure: DEPART, arrival: DEPART });
  assert.equal(libre.status, 201);
  // Temoin : sans epingle, « d » (le plus loin) n'ouvre pas la tournee.
  assert.notEqual(libre.body.stops[0].orderId, "d");
  writeDb({ ...readDb(), routes: [], commandes: readDb().commandes.map((o) => ({ ...o, routeId: "" })) }, { backup: false });

  const r = await request("/api/routes", { orderIds: ["a", "b", "c", "d"], premiers: ["d"], departure: DEPART, arrival: DEPART });
  assert.equal(r.status, 201);
  assert.equal(r.body.stops[0].orderId, "d");
  assert.deepEqual(r.body.stops.map((s) => s.livrerEnPremier), [true, false, false, false]);
  const recalcul = await request(`/api/routes/${r.body.id}/recalculate`, { fixedOrder: false });
  assert.equal(recalcul.status, 200);
  assert.equal(recalcul.body.stops[0].orderId, "d");
});

test("troncons : la duree de chaque trajet est gardee dans la tournee, et effacee par un reordonnancement", async () => {
  const r = await request("/api/routes", { orderIds: ["a", "b", "c"], departure: DEPART, arrival: DEPART });
  assert.equal(r.status, 201);
  const gardee = readDb().routes.find((x) => x.id === r.body.id);
  assert.equal(gardee.troncons.length, 4, "depart -> a -> b -> c -> arrivee : 4 troncons");
  assert.ok(gardee.troncons.every((t) => Number.isInteger(t.duree) && t.duree > 0 && Number.isInteger(t.distance)));
  // Un ordre change a la main rend les troncons faux : ils partent avec le trace.
  const ids = [...gardee.stops].reverse().map((s) => s.id);
  assert.equal((await request(`/api/routes/${r.body.id}/reorder`, { stopIds: ids }, "PATCH")).status, 200);
  assert.equal(readDb().routes.find((x) => x.id === r.body.id).troncons, null);
});

test("arret injoignable : nomme par defaut ; retire et signale sur demande, sa commande reste prete", async () => {
  isoles.add("6.02,47.2");
  const refus = await request("/api/routes", { orderIds: ["a", "b", "c"], departure: DEPART, arrival: DEPART });
  assert.equal(refus.status, 400);
  assert.match(refus.body.error, /Client b : injoignable par la route/);
  assert.equal(readDb().routes.length, 0);

  const r = await request("/api/routes", { orderIds: ["a", "b", "c"], departure: DEPART, arrival: DEPART, retirerInjoignables: true });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.stops.map((s) => s.orderId).sort(), ["a", "c"]);
  assert.deepEqual(r.body.injoignablesRetires, [{ id: "b", clientName: "Client b" }]);
  const b = readDb().commandes.find((o) => o.id === "b");
  assert.equal(b.status, "pret_livraison");
  assert.ok(!b.routeId, "la commande retiree n'appartient a aucune tournee");
});

test("decoupage : au-dela de 50 commandes, des groupes de 50 au plus, sans en perdre", async () => {
  writeDb({ ...defaultDb(), commandes: Array.from({ length: 73 }, (_, i) => commande(`x${i}`, 5.5 + (i % 2) * 0.9, { lat: 47 + i * 0.001 })) }, { backup: false });
  const ids = Array.from({ length: 73 }, (_, i) => `x${i}`);
  const r = await request("/api/routes/decoupage", { orderIds: ids, departure: DEPART });
  assert.equal(r.status, 200);
  assert.equal(r.body.groupes.length, 2);
  assert.ok(r.body.groupes.every((g) => g.length <= 50));
  assert.deepEqual(r.body.groupes.flat().sort(), [...ids].sort());
  assert.equal(readDb().routes.length, 0, "une proposition n'ecrit rien");
});

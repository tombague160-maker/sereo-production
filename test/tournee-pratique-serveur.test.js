// Lot 6 de l'audit geo (23/09) : « pratique au quotidien », cote serveur.
//
//   - le depot par defaut, « retour au depot », le texte du SMS (Parametres) ;
//   - « Reoptimiser » une tournee prete, avec un autre depart ;
//   - « Reoptimiser les arrets restants » depuis la position GPS ;
//   - « Faire maintenant » et « Ajouter a la tournee en cours ».
//
// Un faux OSRM local (aucun appel reseau externe) : durees tirees des
// coordonnees de la requete, un troncon par trajet ; `panne` le fait repondre
// 500 pour juger le repli.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http");
const { once } = require("node:events");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-pratique-"));
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_ROUTING_REPLI_URL = "";
const { app, readDb, writeDb, defaultDb, closeStorage, _flushPendingBackup } = require("../server");
const routing = require("../lib/routing");

let server, base, osrm;
const panne = { route: false, table: false };
const appels = [];
// Un geste fait AILLEURS pendant le calcul (hors verrou) : joue une fois, a la
// premiere requete OSRM, avant la reponse.
let pendantLeCalcul = null;
before(async () => {
  osrm = http.createServer(async (req, res) => {
    appels.push(req.url);
    if (pendantLeCalcul) {
      const geste = pendantLeCalcul;
      pendantLeCalcul = null;
      await geste(req.url);
    }
    const pts = req.url.split("/driving/")[1].split("?")[0].split(";");
    const xy = pts.map((p) => p.split(",").map(Number));
    // Une duree (s) proportionnelle a la distance ; 1 degre ~ 100 km.
    const d = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 100000);
    res.setHeader("Content-Type", "application/json");
    const estTable = req.url.includes("/table/");
    if ((estTable && panne.table) || (!estTable && panne.route)) {
      res.statusCode = 500;
      return res.end("{}");
    }
    res.end(JSON.stringify(estTable
      ? { code: "Ok", durations: xy.map((a) => xy.map((b) => d(a, b) / 10)) }
      : { code: "Ok", routes: [{ distance: xy.slice(1).reduce((s, b, i) => s + d(xy[i], b), 0), duration: xy.slice(1).reduce((s, b, i) => s + d(xy[i], b) / 10, 0),
          geometry: { type: "LineString", coordinates: xy },
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

// Sur une ligne est-ouest, depot a l'ouest : l'ordre naturel est a, b, c, d.
const DEPOT = { lat: 47.2, lng: 6.0, label: "Dépôt" };
const commande = (id, lng, extra = {}) => ({
  id, clientId: `c-${id}`, clientName: `Client ${id}`, status: "pret_livraison",
  address: `${id} rue du Moulin`, city: "Besançon", postalCode: "25000", lat: 47.2, lng, products: [], ...extra,
});
beforeEach(() => {
  panne.route = false;
  panne.table = false;
  appels.length = 0;
  pendantLeCalcul = null;
  routing._reinitialiserRepli();
  writeDb({
    ...defaultDb(),
    clients: ["a", "b", "c", "d", "u"].map((id) => ({ id: `c-${id}`, nom: `Client ${id}` })),
    commandes: [commande("a", 6.01), commande("b", 6.02), commande("c", 6.03), commande("d", 6.04)],
  }, { backup: false });
});
async function request(url, body, method = "POST", headers = {}) {
  const r = await fetch(base + url, body !== undefined ? { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) } : { method: method === "POST" ? "GET" : method, headers });
  const texte = await r.text();
  let corps;
  try { corps = JSON.parse(texte); } catch { corps = texte; }
  return { status: r.status, body: corps };
}
async function creerTournee(orderIds = ["a", "b", "c", "d"], extra = {}) {
  const r = await request("/api/routes", { orderIds, departure: DEPOT, arrival: DEPOT, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const ordre = (route) => route.stops.map((s) => s.orderId);

// --- Parametres ------------------------------------------------------------------

test("parametres : sans depot par defaut, « retour au depot » coche, texte du SMS par defaut", async () => {
  const r = await request("/api/settings/tournee", undefined, "GET");
  assert.equal(r.status, 200);
  assert.equal(r.body.depot, null);
  assert.equal(r.body.retourAuDepot, true);
  assert.equal(r.body.messagePrevenir, "Bonjour, je passe vers {heure} pour votre livraison.");
  // Une base d'AVANT le lot (ses reglages n'ont que vitesse et arret) : memes defauts.
  writeDb({ ...readDb(), settings: { ...readDb().settings, tournee: { averageSpeedKmh: 30, stopDurationMin: 8 } } }, { backup: false });
  const ancienne = await request("/api/settings/tournee", undefined, "GET");
  assert.deepEqual(
    [ancienne.body.averageSpeedKmh, ancienne.body.stopDurationMin, ancienne.body.depot, ancienne.body.retourAuDepot],
    [30, 8, null, true]
  );
});

test("parametres : le depot, le retour et le texte se memorisent ; un depot douteux est refuse", async () => {
  const ok = await request("/api/settings/tournee", { depot: { label: "Entrepôt Séréo, Champagnole", lat: 46.7466, lng: 5.9097 }, retourAuDepot: false, messagePrevenir: "Séréo : j'arrive vers {heure}." }, "PATCH");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const lu = await request("/api/settings/tournee", undefined, "GET");
  assert.deepEqual(lu.body.depot, { label: "Entrepôt Séréo, Champagnole", lat: 46.7466, lng: 5.9097 });
  assert.equal(lu.body.retourAuDepot, false);
  assert.equal(lu.body.messagePrevenir, "Séréo : j'arrive vers {heure}.");
  // Le reste des reglages n'a pas bouge.
  assert.equal(lu.body.stopDurationMin, 6);

  for (const [corps, motif] of [
    [{ depot: { label: "Dépôt", lat: 147, lng: 5 } }, /Position du dépôt invalide/],
    [{ depot: { label: "", lat: 46.7, lng: 5.9 } }, /nom ou une adresse/],
    [{ depot: { label: "x".repeat(201), lat: 46.7, lng: 5.9 } }, /trop long/],
    [{ retourAuDepot: "oui" }, /retourAuDepot/],
    [{ messagePrevenir: "y".repeat(301) }, /trop long/],
  ]) {
    const r = await request("/api/settings/tournee", corps, "PATCH");
    assert.equal(r.status, 400, JSON.stringify(corps).slice(0, 80));
    assert.match(r.body.error, motif);
  }
  // Rien de ce qui a ete refuse n'a ete ecrit.
  const apres = await request("/api/settings/tournee", undefined, "GET");
  assert.deepEqual(apres.body, lu.body);

  // `null` efface le depot ; un texte vide ramene le texte par defaut.
  const efface = await request("/api/settings/tournee", { depot: null, messagePrevenir: "  " }, "PATCH");
  assert.equal(efface.body.depot, null);
  assert.equal(efface.body.messagePrevenir, "Bonjour, je passe vers {heure} pour votre livraison.");
});

// --- Reoptimiser une tournee prete --------------------------------------------------

const EST = { lat: 47.2, lng: 6.05, label: "Domicile" };

test("reoptimiser (prete) : partir d'ailleurs change l'ordre (tournee preparee au bureau, depart du domicile)", async () => {
  const route = await creerTournee();
  assert.deepEqual(ordre(route), ["a", "b", "c", "d"]);
  // Depart a l'est, arrivee au depot (a l'ouest) : d, c, b, a.
  const r = await request(`/api/routes/${route.id}/reoptimiser`, { departure: EST });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(ordre(r.body.route), ["d", "c", "b", "a"]);
  assert.equal(r.body.route.departure.label, "Domicile");
  assert.equal(r.body.route.arrival.label, "Dépôt");
  assert.equal(r.body.route.troncons.length, 5);
  const stocke = readDb().routes.find((x) => x.id === route.id);
  assert.deepEqual(ordre(stocke), ["d", "c", "b", "a"]);
  assert.ok(stocke.updatedAt, "la version de la tournee avance (garde H4 du lot 1)");
});

test("reoptimiser (prete) : « a livrer en premier » reste en tete", async () => {
  const route = await creerTournee(["a", "b", "c", "d"], { premiers: ["b"] });
  const r = await request(`/api/routes/${route.id}/reoptimiser`, { departure: EST });
  assert.equal(r.status, 200);
  assert.equal(ordre(r.body.route)[0], "b");
  assert.equal(r.body.route.stops[0].livrerEnPremier, true);
  assert.ok(r.body.route.stops.slice(1).every((s) => !s.livrerEnPremier));
});

test("reoptimiser (prete) : sans nouveau depart, l'ordre d'un reordonnancement a la main est refait", async () => {
  const route = await creerTournee();
  const ids = route.stops.map((s) => s.id);
  const main = await request(`/api/routes/${route.id}/reorder`, { stopIds: [ids[3], ids[2], ids[1], ids[0]] }, "PATCH");
  assert.equal(main.status, 200);
  assert.equal(main.body.troncons, null);
  const r = await request(`/api/routes/${route.id}/reoptimiser`, {});
  assert.equal(r.status, 200);
  assert.deepEqual(ordre(r.body.route), ["a", "b", "c", "d"]);
  assert.equal(r.body.route.troncons.length, 5);
});

// --- Reoptimiser les arrets restants, en route ----------------------------------------

async function tourneeEnRoute(orderIds = ["a", "b", "c", "d"], extra = {}) {
  const route = await creerTournee(orderIds, extra);
  const r = await request(`/api/routes/${route.id}/start`, {});
  assert.equal(r.status, 200);
  return r.body;
}

test("reoptimiser les restants : depuis la position GPS, les arrets soldes restent en tete", async () => {
  const route = await tourneeEnRoute();
  const [sa] = route.stops;
  assert.equal((await request(`/api/routes/${route.id}/stops/${sa.id}`, { status: "livre" }, "PATCH")).status, 200);
  // Le livreur est a l'est (apres un detour) : repartir de d est plus court.
  const r = await request(`/api/routes/${route.id}/reoptimiser`, { position: { lat: 47.2004567, lng: 6.0512345 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(ordre(r.body.route), ["a", "d", "c", "b"]);
  assert.equal(r.body.route.stops[0].status, "livre");
  assert.equal(r.body.route.troncons.length, 5);
  assert.ok(r.body.route.tronconsDepuis);
  // La position n'est partie au calcul qu'arrondie a ~100 m (decision 5).
  const route3 = appels.filter((u) => u.includes("/route/")).at(-1);
  assert.match(route3, /driving\/6\.051,47\.2;/);
  assert.doesNotMatch(appels.join(" "), /6\.0512345|47\.2004567/);
  // Le depart enregistre ne change pas (historique de la tournee).
  assert.equal(readDb().routes[0].departure.label, "Dépôt");
});

test("reoptimiser les restants : « a livrer en premier » reste devant les autres restants", async () => {
  // Temoin : sans epingle, depuis l'est, on repart par d.
  const libre = await tourneeEnRoute();
  const r0 = await request(`/api/routes/${libre.id}/reoptimiser`, { position: { lat: 47.2, lng: 6.05 } });
  assert.equal(ordre(r0.body.route)[0], "d");
  writeDb({ ...readDb(), routes: [], commandes: readDb().commandes.map((o) => ({ ...o, routeId: "", status: "pret_livraison" })) }, { backup: false });
  const route = await tourneeEnRoute(["a", "b", "c", "d"], { premiers: ["a"] });
  const r = await request(`/api/routes/${route.id}/reoptimiser`, { position: { lat: 47.2, lng: 6.05 } });
  assert.equal(r.status, 200);
  assert.equal(ordre(r.body.route)[0], "a");
  assert.equal(r.body.route.stops[0].livrerEnPremier, true);
});

test("reoptimiser les restants : refuse sans position, et sur une tournee terminee", async () => {
  const route = await tourneeEnRoute(["a"]);
  const sans = await request(`/api/routes/${route.id}/reoptimiser`, {});
  assert.equal(sans.status, 400);
  assert.match(sans.body.error, /Position GPS requise/);
  await request(`/api/routes/${route.id}/stops/${route.stops[0].id}`, { status: "livre" }, "PATCH");
  const fini = await request(`/api/routes/${route.id}/reoptimiser`, { position: { lat: 47.2, lng: 6.05 } });
  assert.equal(fini.status, 400);
  assert.match(fini.body.error, /terminée/);
});

// --- Faire maintenant -----------------------------------------------------------------

test("faire maintenant : l'arret passe en tete des restants, les heures suivent le nouvel ordre", async () => {
  const route = await tourneeEnRoute();
  const [sa, , , sd] = route.stops;
  await request(`/api/routes/${route.id}/stops/${sa.id}`, { status: "livre" }, "PATCH");
  const r = await request(`/api/routes/${route.id}/stops/${sd.id}/maintenant`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(ordre(r.body.route), ["a", "d", "b", "c"]);
  assert.equal(r.body.horairesARecalculer, false);
  const t = r.body.route.troncons;
  assert.equal(t.length, 5);
  // Le trajet vers d part de a (dernier arret livre), plus du depot.
  assert.equal(t[1].distance, 3000);
  assert.equal(t[2].distance, 2000);
  // Le statut des arrets n'a pas bouge.
  assert.deepEqual(r.body.route.stops.map((s) => s.status), ["livre", "en_livraison", "en_livraison", "en_livraison"]);
});

test("faire maintenant : calcul routier en panne -- l'ordre change, les heures tombent (et c'est dit)", async () => {
  const route = await tourneeEnRoute();
  const trace = route.geometry;
  panne.route = true;
  const r = await request(`/api/routes/${route.id}/stops/${route.stops[2].id}/maintenant`, {});
  assert.equal(r.status, 200);
  assert.deepEqual(ordre(r.body.route), ["c", "a", "b", "d"]);
  assert.equal(r.body.route.troncons, null);
  assert.equal(r.body.horairesARecalculer, true);
  // En route, le trace reste (on n'efface pas la carte sous le livreur).
  assert.deepEqual(r.body.route.geometry, trace);
});

test("faire maintenant : refuse avant le depart et sur un arret deja traite", async () => {
  const prete = await creerTournee(["a", "b"]);
  const r1 = await request(`/api/routes/${prete.id}/stops/${prete.stops[1].id}/maintenant`, {});
  assert.equal(r1.status, 400);
  assert.match(r1.body.error, /flèches/);
  writeDb({ ...readDb(), routes: [], commandes: readDb().commandes.map((o) => ({ ...o, routeId: "" })) }, { backup: false });
  const route = await tourneeEnRoute(["a", "b"]);
  await request(`/api/routes/${route.id}/stops/${route.stops[0].id}`, { status: "absent" }, "PATCH");
  const r2 = await request(`/api/routes/${route.id}/stops/${route.stops[0].id}/maintenant`, {});
  assert.equal(r2.status, 400);
  assert.match(r2.body.error, /déjà traité/);
});

// --- Ajouter a la tournee en cours ------------------------------------------------------

test("ajouter en route : la commande urgente s'insere la ou elle allonge le moins, et part en livraison", async () => {
  const route = await tourneeEnRoute(["a", "b", "d"]);
  const db = readDb();
  db.commandes.push(commande("u", 6.025, { clientId: "c-u", clientName: "Client u" }));
  writeDb(db, { backup: false });
  const r = await request(`/api/routes/${route.id}/ajouter`, { orderId: "u" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(ordre(r.body.route), ["a", "b", "u", "d"]);
  assert.equal(r.body.rang, 3);
  assert.equal(r.body.route.troncons.length, 5);
  const arret = r.body.route.stops[2];
  assert.equal(arret.status, "en_livraison");
  assert.ok(!route.stops.some((s) => s.id === arret.id), "un identifiant neuf");
  assert.equal(r.body.order.status, "en_livraison");
  assert.equal(r.body.order.routeId, route.id);
  assert.equal(r.body.client.statut, "en_cours");
  // Deja dans une tournee active : refusee.
  const encore = await request(`/api/routes/${route.id}/ajouter`, { orderId: "u" });
  assert.equal(encore.status, 400);
  assert.match(encore.body.error, /déjà à une tournée active/);
});

test("ajouter en route : sans table OSRM, la distance a vol d'oiseau choisit la place", async () => {
  const route = await tourneeEnRoute(["a", "c", "d"]);
  const db = readDb();
  db.commandes.push(commande("u", 6.02, { clientId: "c-u", clientName: "Client u" }));
  writeDb(db, { backup: false });
  panne.table = true;
  const r = await request(`/api/routes/${route.id}/ajouter`, { orderId: "u" });
  assert.equal(r.status, 201);
  assert.deepEqual(ordre(r.body.route), ["a", "u", "c", "d"]);
});

test("ajouter en route : une meme cle de geste renvoyee (file hors ligne) n'ajoute qu'une fois", async () => {
  const route = await tourneeEnRoute(["a", "b"]);
  const db = readDb();
  db.commandes.push(commande("u", 6.015, { clientId: "c-u", clientName: "Client u" }));
  writeDb(db, { backup: false });
  const cle = { "X-Sereo-Geste": "geste-lot6-ajout-0001" };
  const [r1, r2] = await Promise.all([
    request(`/api/routes/${route.id}/ajouter`, { orderId: "u" }, "POST", cle),
    request(`/api/routes/${route.id}/ajouter`, { orderId: "u" }, "POST", cle),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 201]);
  const r3 = await request(`/api/routes/${route.id}/ajouter`, { orderId: "u" }, "POST", cle);
  assert.equal(r3.status, 201);
  assert.equal(readDb().routes[0].stops.filter((s) => s.orderId === "u").length, 1);
});

test("ajouter : refuse une commande qui n'est pas prete, et une tournee terminee", async () => {
  const db = readDb();
  db.commandes.push(commande("p", 6.015, { status: "en_preparation" }));
  writeDb(db, { backup: false });
  const route = await tourneeEnRoute(["a"]);
  const r = await request(`/api/routes/${route.id}/ajouter`, { orderId: "p" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /pas prête/);
  await request(`/api/routes/${route.id}/stops/${route.stops[0].id}`, { status: "livre" }, "PATCH");
  const fini = await request(`/api/routes/${route.id}/ajouter`, { orderId: "b" });
  assert.equal(fini.status, 400);
  assert.match(fini.body.error, /terminée/);
});

// --- Relecture adverse du lot 6 ----------------------------------------------------------

const ajouterU = (lng) => {
  const db = readDb();
  db.commandes.push(commande("u", lng, { clientId: "c-u", clientName: "Client u" }));
  writeDb(db, { backup: false });
};
const toutRemettre = () => writeDb({ ...readDb(), routes: [], commandes: readDb().commandes.filter((o) => o.id !== "u").map((o) => ({ ...o, routeId: "", status: "pret_livraison" })) }, { backup: false });

test("ajouter en route : jamais devant un arret « a livrer en premier »", async () => {
  // Temoin : sans epingle, u (tout pres du depot) passe en tete des restants.
  const libre = await tourneeEnRoute();
  ajouterU(6.005);
  const r0 = await request(`/api/routes/${libre.id}/ajouter`, { orderId: "u" });
  assert.equal(r0.status, 201, JSON.stringify(r0.body));
  assert.equal(ordre(r0.body.route)[0], "u");
  toutRemettre();
  // d est « a livrer en premier » : la tournee part par d (a l'est) et revient.
  const route = await tourneeEnRoute(["a", "b", "c", "d"], { premiers: ["d"] });
  assert.deepEqual(ordre(route), ["d", "c", "b", "a"]);
  ajouterU(6.005);
  const r = await request(`/api/routes/${route.id}/ajouter`, { orderId: "u" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(ordre(r.body.route)[0], "d");
  assert.equal(r.body.route.stops[0].livrerEnPremier, true);
  // A cout egal (au retour, pres du depot), u finit la tournee.
  assert.deepEqual(ordre(r.body.route), ["d", "c", "b", "a", "u"]);
  assert.equal(r.body.rang, 5);
});

test("reoptimiser les restants : tournee creee SANS depart -- chemin ouvert, pas de retour fictif", async () => {
  const cree = await request("/api/routes", { orderIds: ["a", "b", "c", "d"] });
  assert.equal(cree.status, 201, JSON.stringify(cree.body));
  assert.equal(cree.body.arrival, null);
  assert.equal((await request(`/api/routes/${cree.body.id}/start`, {})).status, 200);
  // Depuis 6.035 : d (500 m) puis c, b, a (3 km) = 3,5 km. La boucle qui
  // revenait a la position comptait 6 km.
  const r = await request(`/api/routes/${cree.body.id}/reoptimiser`, { position: { lat: 47.2, lng: 6.035 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.route.totalDistance, 3.5);
  assert.deepEqual(ordre(r.body.route), ["d", "c", "b", "a"]);
  // Un troncon par arret, et le dernier (vers une arrivee qui n'existe pas) est nul.
  assert.equal(r.body.route.troncons.length, 5);
  assert.deepEqual(r.body.route.troncons[4], { duree: 0, distance: 0 });
  assert.equal(r.body.route.arrival, null);
  // Le trace s'arrete au dernier arret : il ne revient pas a la position.
  assert.match(appels.filter((u) => u.includes("/route/")).at(-1), /driving\/6\.035,47\.2;6\.04,47\.2;6\.03,47\.2;6\.02,47\.2;6\.01,47\.2\?/);
});

test("reoptimiser (prete) : tournee sans arrivee, nouveau depart SANS arrivee -- chemin ouvert", async () => {
  const cree = await request("/api/routes", { orderIds: ["a", "b", "c", "d"] });
  assert.equal(cree.status, 201);
  const r = await request(`/api/routes/${cree.body.id}/reoptimiser`, { departure: EST });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(ordre(r.body.route), ["d", "c", "b", "a"]);
  assert.equal(r.body.route.departure.label, "Domicile");
  assert.equal(r.body.route.arrival, null);
  assert.equal(r.body.route.totalDistance, 4);
  assert.deepEqual(r.body.route.troncons[4], { duree: 0, distance: 0 });
  // Temoin : avec une arrivee demandee, la boucle revient.
  const boucle = await request(`/api/routes/${cree.body.id}/reoptimiser`, { departure: EST, arrival: EST });
  assert.equal(boucle.status, 200, JSON.stringify(boucle.body));
  assert.equal(boucle.body.route.arrival.label, "Domicile");
  assert.equal(boucle.body.route.totalDistance, 8);
});

test("reoptimiser les restants : une position corrigee PENDANT le calcul n'est pas ecrasee", async () => {
  const route = await tourneeEnRoute();
  pendantLeCalcul = () => {
    const db = readDb();
    const b = db.commandes.find((o) => o.id === "b");
    Object.assign(b, { lat: 47.21, lng: 6.022, geoSource: "manuel", geoPrecision: "manuel" });
    writeDb(db, { backup: false });
  };
  const r = await request(`/api/routes/${route.id}/reoptimiser`, { position: { lat: 47.2, lng: 6.05 } });
  const b = readDb().commandes.find((o) => o.id === "b");
  assert.deepEqual([b.lat, b.lng, b.geoSource], [47.21, 6.022, "manuel"]);
  assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 200));
  assert.match(r.body.error, /position a été corrigée pendant le calcul/);
});

test("ajouter : une position corrigee PENDANT le calcul n'est pas ecrasee", async () => {
  const route = await tourneeEnRoute(["a", "b"]);
  ajouterU(6.015);
  pendantLeCalcul = () => {
    const db = readDb();
    Object.assign(db.commandes.find((o) => o.id === "u"), { lat: 47.21, lng: 6.016, geoSource: "manuel", geoPrecision: "manuel" });
    writeDb(db, { backup: false });
  };
  const r = await request(`/api/routes/${route.id}/ajouter`, { orderId: "u" });
  const u = readDb().commandes.find((o) => o.id === "u");
  assert.deepEqual([u.lat, u.lng, u.geoSource], [47.21, 6.016, "manuel"]);
  assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 200));
  assert.match(r.body.error, /position a été corrigée pendant le calcul/);
});

test("ajouter : une tournee creee PENDANT le calcul avec la meme commande -- refuse sous le verrou", async () => {
  const route = await tourneeEnRoute(["a", "b"]);
  ajouterU(6.015);
  let autre = null;
  pendantLeCalcul = async () => { autre = await request("/api/routes", { orderIds: ["u"] }); };
  const r = await request(`/api/routes/${route.id}/ajouter`, { orderId: "u" });
  assert.equal(autre?.status, 201, "la tournee concurrente a bien ete creee");
  assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 200));
  assert.match(r.body.error, /déjà à une tournée active/);
  const tournees = readDb().routes.filter((x) => ["prete", "en_livraison"].includes(x.status) && x.stops.some((s) => s.orderId === "u"));
  assert.deepEqual(tournees.map((x) => x.id), [autre.body.id]);
});

test("report : une commande absente puis rajoutee a la MEME tournee -- le report retire l'arret ACTIF", async () => {
  const J = "2030-01-15";
  writeDb({ ...readDb(), commandes: readDb().commandes.map((o) => ({ ...o, deliveryDate: J })) }, { backup: false });
  const route = await tourneeEnRoute(["a", "b"], { deliveryDate: J });
  const sa = route.stops.find((s) => s.orderId === "a");
  assert.equal((await request(`/api/routes/${route.id}/stops/${sa.id}`, { status: "absent" }, "PATCH")).status, 200);
  assert.equal(readDb().commandes.find((o) => o.id === "a").status, "a_reprogrammer");
  // Le livreur repasse plus tard : la commande revient dans SA tournee.
  const ajout = await request(`/api/routes/${route.id}/ajouter`, { orderId: "a" });
  assert.equal(ajout.status, 201, JSON.stringify(ajout.body).slice(0, 200));
  assert.deepEqual(ajout.body.route.stops.filter((s) => s.orderId === "a").map((s) => s.status), ["absent", "en_livraison"]);
  // Puis le client demande demain : l'arret ACTIF sort, l'absent reste (historique).
  const report = await request("/api/orders/a", { deliveryDate: "2030-01-16" }, "PATCH");
  assert.equal(report.status, 200, JSON.stringify(report.body).slice(0, 200));
  const apres = readDb().routes.find((x) => x.id === route.id);
  assert.deepEqual(apres.stops.filter((s) => s.orderId === "a").map((s) => s.status), ["absent"]);
  const a = readDb().commandes.find((o) => o.id === "a");
  assert.equal(a.status, "pret_livraison");
  assert.ok(!a.routeId);
});

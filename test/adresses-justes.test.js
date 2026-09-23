// Lot 3 de l'audit geo (23/09) : des adresses justes.
//
// Chaque test est ecrit pour ECHOUER sur le code d'avant le lot, par la cause
// qu'il nomme (Expected/Received sur la position, le statut ou le message), et
// jamais par un plantage : il ne passe que par HTTP et par des exports qui
// existaient deja.
//
// Aucun appel reseau reel. Le serveur tourne dans ce processus : `fetch` est
// intercepte. La BAN (api-adresse.data.gouv.fr), la Geoplateforme (l'ancien
// geocodeur de la tournee, data.geopf.fr) et un faux OSRM (osrm.test) sont
// simules ; tout autre hote externe fait echouer le test.

const { after, before, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-adresses-"));
const sqlitePath = path.join(tmpRoot, "data", "sereo.sqlite");

// Le geocodage de fond reste ACTIF ici : un client cree au CRM doit etre
// geocode. Il ne sort jamais du processus (fetch intercepte).
process.env.SEREO_GEOCODAGE_AUTO = "1";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = sqlitePath;
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_GEOCODER_INTERVALLE_MS = "0";
process.env.SEREO_ROUTING_URL = "http://osrm.test";
delete process.env.SEREO_GEOCODER_URL;

// --- Reseau simule ------------------------------------------------------------

const vraiFetch = globalThis.fetch;
let appels = [];
let reglesBan = [];
let delaiBanMs = 0;

function trait({ lat, lng, score = 0.96, type = "housenumber", label = "", postcode = "25000", city = "Besançon" }) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { score, type, label, postcode, city } };
}

/** Regle BAN : si `si(q, postcode)` alors la reponse `rendre()`. La premiere qui s'applique gagne. */
function ban(si, rendre) {
  reglesBan.push({ si, rendre });
}

function reponseBan(url) {
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const cp = url.searchParams.get("postcode") || "";
  for (const regle of reglesBan) {
    if (regle.si(q, cp)) return regle.rendre(q, cp);
  }
  return { features: [] };
}

function reponseOsrm(url) {
  const points = url.pathname.split("/").pop().split(";");
  const n = points.length;
  if (url.pathname.includes("/table/")) {
    return { code: "Ok", durations: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 60 * (1 + Math.abs(i - j))))) };
  }
  return {
    code: "Ok",
    routes: [{ distance: 12000, duration: 1500, geometry: { type: "LineString", coordinates: points.map(p => p.split(",").map(Number)) } }]
  };
}

globalThis.fetch = async (entree, init = {}) => {
  const url = new URL(typeof entree === "string" ? entree : String(entree.url || entree));
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return vraiFetch(entree, init);
  const entetes = new Headers(init.headers || {});
  appels.push({ hote: url.hostname, url, ua: entetes.get("user-agent") || "" });
  const json = (corps, status = 200) =>
    new Response(JSON.stringify(corps), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "api-adresse.data.gouv.fr" || url.hostname === "data.geopf.fr") {
    if (delaiBanMs) await new Promise(r => setTimeout(r, delaiBanMs));
    const r = reponseBan(url);
    return json(r.corps || r, r.status || 200);
  }
  if (url.hostname === "osrm.test") return json(reponseOsrm(url));
  throw new Error(`appel externe interdit dans ce banc : ${url.hostname}`);
};

const { app, closeStorage, defaultDb, readDb, writeDb, _flushPendingBackup } = require("../server");

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

beforeEach(() => {
  appels = [];
  reglesBan = [];
  delaiBanMs = 0;
});

function semer({ clients = [], commandes = [] } = {}) {
  writeDb({
    ...defaultDb(),
    clients,
    commandes,
    stock: [{ id: "p1", code: "CH-L", nom: "Changes L", quantite: 100, tarif: 12 }]
  }, { backup: false });
}

function client(id, extra = {}) {
  return { id, nom: `Client ${id}`, rue: "12 rue Mégevand", codePostal: "25000", ville: "Besançon", lat: "", lng: "", statut: "restant", produits: [], ...extra };
}

function commande(id, c, extra = {}) {
  return {
    id, clientId: c.id, clientName: c.nom, status: "pret_livraison",
    address: c.rue, postalCode: c.codePostal, city: c.ville,
    lat: "", lng: "", deliveryDate: AUJOURDHUI, dateCommande: AUJOURDHUI,
    products: [{ code: "CH-L", nom: "Changes L", quantite: 1 }],
    ...extra
  };
}

async function api(chemin, corps, methode = corps ? "POST" : "GET") {
  const reponse = await fetch(base + chemin, corps
    ? { method: methode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) }
    : { method: methode });
  const texte = await reponse.text();
  // Une route inconnue rend la page de l'application (HTML), pas du JSON.
  const json = /json/.test(reponse.headers.get("content-type") || "");
  return { status: reponse.status, body: texte && json ? JSON.parse(texte) : texte || null };
}

const DEPART = { lat: 47.24, lng: 6.02, label: "Dépôt" };
const tournee = (orderIds, extra = {}) =>
  api("/api/routes", { orderIds, departure: DEPART, arrival: DEPART, deliveryDate: AUJOURDHUI, ...extra });

async function attendre(condition, delaiMs = 3000) {
  const limite = Date.now() + delaiMs;
  while (Date.now() < limite) {
    if (condition()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return condition();
}

const clientLu = id => readDb().clients.find(c => String(c.id) === String(id));
const commandeLue = id => readDb().commandes.find(o => String(o.id) === String(id));

// --- H6 : la commande herite de la position de son client ------------------------

test("H6 — une commande terrain nait avec la position de son client", async () => {
  semer({ clients: [client("c1", { lat: 47.2301, lng: 6.0102 })] });
  const r = await api("/api/customer-orders", { clientId: "c1", products: [{ productId: "p1", quantite: 1 }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.lat, 47.2301);
  assert.equal(r.body.lng, 6.0102);
});

test("H6 — la tournee place l'arret a la position du client, pas au point du geocodeur", async () => {
  const c1 = client("c1", { lat: 47.2301, lng: 6.0102 });
  semer({ clients: [c1], commandes: [commande("o1", c1)] });
  // Le geocodeur rendrait un autre point : il ne doit pas servir.
  ban(() => true, () => ({ features: [trait({ lat: 46.75, lng: 5.9, score: 0.9 })] }));
  const r = await tournee(["o1"]);
  assert.equal(r.status, 201, r.body?.error);
  assert.equal(r.body.stops[0].lat, 47.2301);
});

// --- Un seul module : meme seuil, meme service, resultat memorise ------------------

test("un seul geocodeur : une rue a 0,62 (trouvee a l'import) est acceptee par la tournee, et memorisee", async () => {
  const c1 = client("c1");
  semer({ clients: [c1], commandes: [commande("o1", c1), commande("o2", c1, { deliveryDate: "" })] });
  ban(() => true, () => ({ features: [trait({ lat: 47.25, lng: 6.03, score: 0.62, type: "street", label: "Rue Mégevand 25000 Besançon" })] }));
  const r = await tournee(["o1"]);
  assert.equal(r.status, 201, r.body?.error);
  assert.equal(r.body.stops[0].lat, 47.25);
  // Memorise : le client et son autre commande a la meme adresse ont le point.
  assert.equal(clientLu("c1").lat, 47.25);
  assert.equal(commandeLue("o2").lat, 47.25);
  // La precision est gardee : un point "rue" n'est pas un numero.
  assert.equal(r.body.stops[0].geoPrecision, "rue");
});

test("un seul geocodeur : la tournee et la recherche interrogent la BAN, avec un User-Agent de contact", async () => {
  const c1 = client("c1", { rue: "21 rue Battant" });
  semer({ clients: [c1], commandes: [commande("o1", c1)] });
  ban(() => true, () => ({ features: [trait({ lat: 47.25, lng: 6.03 })] }));
  const r = await tournee(["o1"]);
  assert.equal(r.status, 201, r.body?.error);
  const recherche = await api("/api/geocode?q=12%20rue%20Megevand%20Besancon");
  assert.equal(recherche.status, 200);
  const geocodages = appels.filter(a => a.hote !== "osrm.test");
  assert.ok(geocodages.length >= 2);
  assert.deepEqual([...new Set(geocodages.map(a => a.hote))], ["api-adresse.data.gouv.fr"]);
  for (const appel of geocodages) {
    assert.match(appel.ua, /^Sereo\/\S+ \(\+https:\/\/github\.com\//);
    assert.doesNotMatch(appel.ua, /@/);
  }
  assert.equal(recherche.body[0].precision, "numero");
});

// --- M5 et decision 6 : les points aberrants, nommes ------------------------------

test("M5 — (0,0) et latitude/longitude inversees sont refuses, les deux clients nommes", async () => {
  const alpha = client("ca", { nom: "Alpha" });
  const bravo = client("cb", { nom: "Bravo" });
  const charlie = client("cc", { nom: "Charlie" });
  semer({
    clients: [alpha, bravo, charlie],
    commandes: [
      commande("oa", alpha, { lat: 0, lng: 0 }),
      commande("ob", bravo, { lat: 6.05, lng: 47.22 }),
      commande("oc", charlie, { lat: 47.23, lng: 6.01 })
    ]
  });
  const r = await tournee(["oa", "ob", "oc"]);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Alpha/);
  assert.match(r.body.error, /Bravo/);
  assert.doesNotMatch(r.body.error, /réessaie|indisponible/i);
  assert.equal(r.body.details.adresses.length, 2);
  assert.deepEqual(r.body.details.adresses.find(a => a.clientName === "Bravo").proposition, { lat: 47.22, lng: 6.05 });
  assert.equal(readDb().routes.length, 0);
});

test("decision 6 — une position a plus de 150 km du depart est refusee, avec le nom du client", async () => {
  const paris = client("cp", { nom: "Parisien", rue: "1 rue de Rivoli", codePostal: "75001", ville: "Paris" });
  semer({ clients: [paris], commandes: [commande("op", paris, { lat: 48.8566, lng: 2.3522 })] });
  const r = await tournee(["op"]);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Parisien/);
  assert.match(r.body.error, /150 km/);
});

test("le calcul liste TOUTES les adresses douteuses d'un coup", async () => {
  const noms = ["Delta", "Echo", "Foxtrot"];
  const clients = noms.map((nom, i) => client(`c${i}`, { nom, rue: `${i + 1} impasse Inconnue` }));
  semer({ clients, commandes: clients.map((c, i) => commande(`o${i}`, c)) });
  // La BAN ne connait aucune des trois.
  const r = await tournee(["o0", "o1", "o2"]);
  assert.equal(r.status, 400);
  for (const nom of noms) assert.match(r.body.error, new RegExp(nom));
  assert.equal(r.body.details.adresses.length, 3);
});

test("M5 — une saisie inversee est refusee, nommee et corrigee ; un « lat, lng » colle est accepte", async () => {
  semer({ clients: [client("c1", { nom: "Golf" })] });
  const inversee = await api("/api/clients/c1/coordinates", { lat: 5.95, lng: 47.22 }, "PATCH");
  assert.equal(inversee.status, 400);
  assert.match(inversee.body.error, /Golf/);
  assert.match(inversee.body.error, /inversées/);
  assert.deepEqual(inversee.body.details.corrigee, { lat: 47.22, lng: 5.95 });

  const collee = await api("/api/clients/c1/coordinates", { position: "46.7512, 5.9123" }, "PATCH");
  assert.equal(collee.status, 200);
  assert.equal(collee.body.lat, 46.7512);
  assert.equal(collee.body.lng, 5.9123);
});

// --- H11 : complements, CEDEX, code postal, rejet a vie ---------------------------

test("H11 — « Residence…, Bat. B, Apt 12, » est retire avant le geocodage", async () => {
  semer({ clients: [client("c1", { rue: "Résidence Les Tilleuls, Bât. B, Apt 12, 3 rue de Dole" })] });
  ban(q => /r[ée]sidence|b[aâ]t|apt/.test(q), () => ({ features: [trait({ lat: 47.24, lng: 6.0, score: 0.37 })] }));
  ban(q => q.includes("3 rue de dole"), () => ({ features: [trait({ lat: 47.241, lng: 6.001, score: 0.98 })] }));
  const r = await api("/api/geocodage/lancer", { max: 10 });
  assert.equal(r.status, 200);
  assert.equal(clientLu("c1").lat, 47.241);
});

test("H11 — une adresse CEDEX est trouvee (le code CEDEX n'est pas un filtre de la BAN)", async () => {
  semer({ clients: [client("c1", { rue: "8 rue Charles Nodier", codePostal: "25035", ville: "Besançon Cedex" })] });
  ban((q, cp) => cp === "25035" || q.includes("cedex"), () => ({ features: [] }));
  ban(q => q.includes("8 rue charles nodier"), () => ({ features: [trait({ lat: 47.2365, lng: 6.0245, score: 0.95 })] }));
  const r = await api("/api/geocodage/lancer", { max: 10 });
  assert.equal(r.status, 200);
  assert.equal(clientLu("c1").lat, 47.2365);
});

test("H11 — un code postal lu comme un nombre par Excel (1100) redevient 01100", () => {
  semer({ clients: [client("c1", { codePostal: 1100, ville: "Oyonnax" })] });
  assert.equal(clientLu("c1").codePostal, "01100");
});

test("H11 — un rejet n'est plus memorise a vie : passe 30 jours, l'adresse est redemandee", async () => {
  semer({ clients: [client("c1", { rue: "7 chemin Neuf" })] });
  const lancer = () => api("/api/geocodage/lancer", { max: 10 });
  await lancer();
  const premiers = appels.length;
  assert.ok(premiers >= 1);
  await lancer();
  assert.equal(appels.length, premiers, "un rejet recent ne se redemande pas");

  // Le rejet vieillit de 40 jours.
  const { DatabaseSync } = require("node:sqlite");
  const base = new DatabaseSync(sqlitePath);
  base.prepare("UPDATE geocodages SET mis_a_jour_le = ? WHERE requete LIKE ?")
    .run(new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(), "%chemin Neuf%");
  base.close();

  ban(q => q.includes("7 chemin neuf"), () => ({ features: [trait({ lat: 47.26, lng: 6.04 })] }));
  await lancer();
  assert.ok(appels.length > premiers, "le rejet perime n'a pas ete redemande");
  assert.equal(clientLu("c1").lat, 47.26);
});

// --- M8 : une position manuelle n'est jamais ecrasee -------------------------------

test("M8 — `forcer` n'ecrase pas une position saisie a la main", async () => {
  semer({ clients: [client("c1", { rue: "2 place du Huit Septembre" })] });
  const saisie = await api("/api/clients/c1/coordinates", { lat: 47.2222, lng: 6.0111 }, "PATCH");
  assert.equal(saisie.status, 200);
  ban(() => true, () => ({ features: [trait({ lat: 47.30, lng: 6.10 })] }));
  const r = await api("/api/geocodage/lancer", { forcer: true, max: 10 });
  assert.equal(r.status, 200);
  assert.equal(clientLu("c1").lat, 47.2222);
});

test("M8 — une position saisie pendant que le lot tourne gagne", async () => {
  semer({ clients: [client("c1", { rue: "15 rue des Granges Neuves" })] });
  delaiBanMs = 400;
  ban(() => true, () => ({ features: [trait({ lat: 47.30, lng: 6.10 })] }));
  const lot = api("/api/geocodage/lancer", { max: 10 });
  await new Promise(r => setTimeout(r, 120));
  const saisie = await api("/api/clients/c1/coordinates", { lat: 47.2222, lng: 6.0111 }, "PATCH");
  assert.equal(saisie.status, 200);
  assert.equal((await lot).status, 200);
  assert.equal(clientLu("c1").lat, 47.2222);
});

// --- H5, H12, decision 8 : le client qui demenage ---------------------------------

function clientQuiDemenage() {
  const c1 = client("c1", { nom: "Hotel", lat: 47.2301, lng: 6.0102, notes: "" });
  semer({
    clients: [c1],
    commandes: [
      commande("o-suit", c1, { lat: 47.2301, lng: 6.0102 }),
      commande("o-ehpad", c1, { address: "50 route de Lyon", postalCode: "39000", city: "Lons-le-Saunier", lat: 46.67, lng: 5.55, notes: "Code portail 1234" }),
      commande("o-livree", c1, { status: "livre", lat: 47.2301, lng: 6.0102, deliveredAt: `${AUJOURDHUI}T09:00:00Z` })
    ]
  });
}

test("H5 — un changement d'adresse efface l'ancienne position, puis la recalcule", async () => {
  clientQuiDemenage();
  // La BAN connait la nouvelle adresse, mais repond lentement : l'etat
  // intermediaire (position effacee) se lit avant le recalcul de fond.
  ban(q => q.includes("4 avenue nouvelle"), () => ({ features: [trait({ lat: 47.092, lng: 5.49, postcode: "39100", city: "Dole" })] }));
  delaiBanMs = 300;
  const r = await api("/api/clients/c1", { rue: "4 avenue Nouvelle", codePostal: "39100", ville: "Dole" }, "PATCH");
  assert.equal(r.status, 200);
  assert.equal(clientLu("c1").lat, "", "la position de l'ancienne adresse est restee");
  assert.equal(commandeLue("o-suit").lat, "");

  const recalculee = await attendre(() => clientLu("c1").lat === 47.092);
  assert.ok(recalculee, "la nouvelle adresse n'a pas ete geocodee");
});

test("decision 8 — les commandes a livrer suivent la nouvelle adresse, sauf celles livrees ailleurs ou deja livrees", async () => {
  clientQuiDemenage();
  const r = await api("/api/clients/c1", { rue: "4 avenue Nouvelle", codePostal: "39100", ville: "Dole" }, "PATCH");
  assert.equal(r.status, 200);
  assert.equal(commandeLue("o-suit").address, "4 avenue Nouvelle");
  assert.equal(commandeLue("o-ehpad").address, "50 route de Lyon");
  assert.equal(commandeLue("o-ehpad").lat, 46.67);
  assert.equal(commandeLue("o-livree").address, "12 rue Mégevand");
});

test("H12 — « Modifier le profil » ne reecrit ni une commande livree ni la consigne propre d'une commande", async () => {
  clientQuiDemenage();
  const r = await api("/api/clients/c1", { telephone: "06 11 22 33 44", notes: "Sonner deux fois" }, "PATCH");
  assert.equal(r.status, 200);
  assert.equal(commandeLue("o-livree").phone, "", "le telephone d'une commande livree a ete reecrit");
  assert.equal(commandeLue("o-livree").notes, "", "la consigne d'une commande livree a ete reecrite");
  assert.equal(commandeLue("o-ehpad").notes, "Code portail 1234");
  assert.equal(commandeLue("o-suit").notes, "Sonner deux fois");
});

// --- M4 : les arrets lisent la commande -------------------------------------------

test("M4 — un arret lit sa commande : consigne et position corrigees atteignent le livreur", async () => {
  const c1 = client("c1", { lat: 47.2301, lng: 6.0102 });
  const c2 = client("c2", { rue: "3 rue de la Gare", lat: 47.24, lng: 6.03 });
  semer({ clients: [c1, c2], commandes: [commande("o1", c1, { lat: 47.2301, lng: 6.0102, notes: "Sonner" }), commande("o2", c2, { lat: 47.24, lng: 6.03 })] });
  const creee = await tournee(["o1", "o2"]);
  assert.equal(creee.status, 201, creee.body?.error);

  await api("/api/orders/o1", { notes: "Code portail 4321" }, "PATCH");
  await api("/api/clients/c1/coordinates", { lat: 47.2311, lng: 6.0122 }, "PATCH");

  const routes = (await api("/api/routes")).body;
  const arret = routes[0].stops.find(s => s.orderId === "o1");
  assert.equal(arret.notes, "Code portail 4321");
  assert.equal(Number(arret.lat), 47.2311);
});

test("M4 — une commande reportee ne se livre plus aujourd'hui", async () => {
  const c1 = client("c1", { lat: 47.2301, lng: 6.0102 });
  const c2 = client("c2", { rue: "3 rue de la Gare", lat: 47.24, lng: 6.03 });
  semer({ clients: [c1, c2], commandes: [commande("o1", c1, { lat: 47.2301, lng: 6.0102 }), commande("o2", c2, { lat: 47.24, lng: 6.03 })] });
  const creee = await tournee(["o1", "o2"]);
  assert.equal(creee.status, 201, creee.body?.error);

  const r = await api("/api/orders/o2", { deliveryDate: "2099-10-15" }, "PATCH");
  assert.equal(r.status, 200);
  const route = (await api("/api/routes")).body[0];
  assert.deepEqual(route.stops.map(s => s.orderId), ["o1"]);
  assert.equal(commandeLue("o2").routeId, null);
});

// --- H7 : l'ecran « Adresses a verifier » ; le CRM geocode --------------------------

test("H7 — la liste des adresses a verifier : sans position (avec la proposition de la BAN) et approximatives", async () => {
  const sans = client("c-sans", { nom: "Sans Position", rue: "9 lieu-dit Les Granges" });
  const approx = client("c-rue", { nom: "Au Milieu", lat: 47.25, lng: 6.03, geoSource: "ban", geoPrecision: "rue" });
  const juste = client("c-ok", { nom: "Au Numero", lat: 47.24, lng: 6.02, geoSource: "ban", geoPrecision: "numero" });
  semer({ clients: [sans, approx, juste], commandes: [commande("o-sans", sans)] });
  // Un centre de lieu-dit : jamais applique seul, mais propose.
  ban(q => q.includes("les granges"), () => ({ features: [trait({ lat: 47.21, lng: 5.99, score: 0.9, type: "locality", label: "Les Granges 25000 Besançon" })] }));
  await api("/api/geocodage/lancer", { max: 10 });
  assert.equal(clientLu("c-sans").lat, "");

  const r = await api("/api/adresses/a-verifier");
  assert.equal(r.status, 200);
  assert.equal(Array.isArray(r.body?.clients), true, "la liste des adresses a verifier n'existe pas");
  assert.deepEqual(r.body.clients.map(c => [c.id, c.raison]), [["c-sans", "sans-position"], ["c-rue", "approximative"]]);
  assert.equal(r.body.aLivrerSansPosition, 1);
  assert.deepEqual(
    { lat: r.body.clients[0].proposition.lat, libelle: r.body.clients[0].proposition.libelle },
    { lat: 47.21, libelle: "Les Granges 25000 Besançon" }
  );
  assert.match(r.body.source, /Base Adresse Nationale/);
});

test("un client cree au CRM est geocode, et sa precision est gardee", async () => {
  semer();
  ban(q => q.includes("5 rue neuve"), () => ({ features: [trait({ lat: 46.75, lng: 5.905, type: "street", score: 0.9, postcode: "39300", city: "Champagnole" })] }));
  const r = await api("/api/crm/clients", { nom: "Nouveau", rue: "5 rue Neuve", codePostal: "39300", ville: "Champagnole" });
  assert.equal(r.status, 201);
  const geocode = await attendre(() => readDb().clients.some(c => c.nom === "Nouveau" && c.lat === 46.75));
  assert.ok(geocode, "le client cree au CRM n'a pas ete geocode");
  assert.equal(readDb().clients.find(c => c.nom === "Nouveau").geoPrecision, "rue");
});

// --- Relecture adverse du lot 3 (23/09) ---------------------------------------------

test("relecture — « 12, rue de Dole » devient « 12, avenue Foch » : c'est un demenagement", async () => {
  // Avant : la virgule faisait de « 12 » la voie ; les deux adresses avaient la
  // meme cle, et le changement passait inapercu (position et commandes figees).
  const c1 = client("c1", { rue: "12, rue de Dole", lat: 47.2301, lng: 6.0102 });
  semer({ clients: [c1], commandes: [commande("o-suit", c1, { lat: 47.2301, lng: 6.0102 })] });
  const r = await api("/api/clients/c1", { rue: "12, avenue Foch" }, "PATCH");
  assert.equal(r.status, 200);
  assert.equal(commandeLue("o-suit").address, "12, avenue Foch", "la commande a livrer garde l'ancienne adresse");
  assert.equal(clientLu("c1").lat, "", "la position de l'ancienne adresse est restee");
});

test("relecture — un complement change (Apt 12 -> Apt 14) atteint la commande, la position reste", async () => {
  const c1 = client("c1", { rue: "3 rue de Dole Apt 12", lat: 47.2301, lng: 6.0102 });
  semer({ clients: [c1], commandes: [commande("o-suit", c1, { lat: 47.2301, lng: 6.0102 })] });
  const r = await api("/api/clients/c1", { rue: "3 rue de Dole Apt 14" }, "PATCH");
  assert.equal(r.status, 200);
  assert.equal(commandeLue("o-suit").address, "3 rue de Dole Apt 14", "le livreur lit encore l'ancien appartement");
  assert.equal(commandeLue("o-suit").lat, 47.2301);
  assert.equal(clientLu("c1").lat, 47.2301);
});

test("relecture — « Modifier le profil » ne remplace pas le telephone d'une commande livree ailleurs", async () => {
  const c1 = client("c1", { nom: "Hotel", telephone: "06 00 00 00 01", lat: 47.2301, lng: 6.0102 });
  semer({
    clients: [c1],
    commandes: [
      commande("o-suit", c1, { phone: "06 00 00 00 01", lat: 47.2301, lng: 6.0102 }),
      commande("o-ehpad", c1, { address: "50 route de Lyon", postalCode: "39000", city: "Lons-le-Saunier", phone: "03 84 00 00 00", lat: 46.67, lng: 5.55 })
    ]
  });
  // Le formulaire envoie TOUS les champs, telephone compris, a chaque enregistrement.
  const r = await api("/api/clients/c1", { telephone: "06 11 22 33 44", notes: "Sonner deux fois" }, "PATCH");
  assert.equal(r.status, 200);
  assert.equal(commandeLue("o-ehpad").phone, "03 84 00 00 00", "le livreur appellerait le client au lieu de l'EHPAD");
  assert.equal(commandeLue("o-suit").phone, "06 11 22 33 44");
});

// Un classeur minimal (une feuille, texte en ligne), comme dans api.test.js.
function classeur(lignes) {
  const { zipSync, strToU8 } = require("fflate");
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

async function importerVentes(lat, lng) {
  const form = new FormData();
  form.append("file", classeur([
    ["Statut", "Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date", "Latitude", "Longitude"],
    ["", "CH-L", "Client c1", "1", "Changes L", "4 rue des Arènes", "39100", "Dole", "", lat, lng]
  ]), "ventes.xlsx");
  const reponse = await fetch(`${base}/api/import/ventes`, { method: "POST", body: form });
  return { status: reponse.status, body: await reponse.json() };
}

test("relecture — un import Excel n'ecrase pas une position placee a la main", async () => {
  semer({ clients: [client("c1", { rue: "4 rue des Arènes", codePostal: "39100", ville: "Dole", lat: 47.0922, lng: 5.4911, geoSource: "manuel", geoPrecision: "manuel" })] });
  const r = await importerVentes("47.1", "5.5");
  assert.equal(r.status, 200, r.body?.error);
  assert.equal(clientLu("c1").lat, 47.0922, "la correction faite a la main est perdue");
  assert.equal(clientLu("c1").geoSource, "manuel");
});

test("relecture — un import Excel refuse une position inversee ; une position plausible est prise (temoin)", async () => {
  semer({ clients: [client("c1", { rue: "4 rue des Arènes", codePostal: "39100", ville: "Dole" })] });
  const inversee = await importerVentes("5.4911", "47.0922");
  assert.equal(inversee.status, 200, inversee.body?.error);
  assert.equal(clientLu("c1").lat, "", "la position inversee du fichier a ete prise");
  assert.equal(inversee.body.positionsRefusees, 1);

  semer({ clients: [client("c1", { rue: "4 rue des Arènes", codePostal: "39100", ville: "Dole" })] });
  const juste = await importerVentes("47.0922", "5.4911");
  assert.equal(juste.status, 200, juste.body?.error);
  assert.equal(clientLu("c1").lat, 47.0922);
  assert.equal(clientLu("c1").geoSource, "import");
});

test("relecture — une demande arrivee pendant un lot lance a la main est relancee ensuite", async () => {
  // Une adresse qu'aucun autre test n'a mise en cache : le lot doit vraiment
  // attendre la BAN, sinon il finit avant la creation et rien n'est « pendant ».
  semer({ clients: [client("c1", { rue: "7 impasse du Lot Manuel" })] });
  ban(q => q.includes("8 rue pendant"), () => ({ features: [trait({ lat: 46.75, lng: 5.905, postcode: "39300", city: "Champagnole" })] }));
  ban(() => true, () => ({ features: [trait({ lat: 47.30, lng: 6.10 })] }));
  delaiBanMs = 400;
  let lotFini = false;
  const lot = api("/api/geocodage/lancer", { max: 10 }).then(r => { lotFini = true; return r; });
  await new Promise(r => setTimeout(r, 120));
  const cree = await api("/api/crm/clients", { nom: "Pendant", rue: "8 rue Pendant", codePostal: "39300", ville: "Champagnole" });
  assert.equal(cree.status, 201);
  assert.equal(lotFini, false, "temoin : le lot manuel etait deja fini a la creation");
  assert.equal((await lot).status, 200);
  const geocode = await attendre(() => readDb().clients.some(c => c.nom === "Pendant" && c.lat === 46.75));
  assert.ok(geocode, "le client cree pendant le lot manuel n'a jamais ete geocode");
});

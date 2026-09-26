// Garde-fous du 25/09 : la liste EXHAUSTIVE des routes d'ecriture et de leur
// garde (decision 6, et la chasse aux defauts : « un livreur passe 49 requetes
// sur 55 », rien n'etant garde que les comptes et la numerotation).
//
//   - « admin »        : requireAdministration (403 pour livreur, bureau,
//                        preparateur) -- import, purge, reglages, sauvegardes,
//                        comptes, numerotation ;
//   - « pas-livreur »  : refuse au livreur (403), ouvert au bureau et a la
//                        preparation -- la modification du stock ;
//   - « compte »       : tout compte connecte (le quotidien : commandes,
//                        tournees, livraisons, clients...) ;
//   - « public »       : hors session (connexion, deconnexion).
//
// Deux controles :
//   1. la table ci-dessous couvre EXACTEMENT les routes d'ecriture trouvees
//      dans server.js et lib/*.js : une route ajoutee sans garde declaree fait
//      rougir ce banc (c'est ce qui manquait) ;
//   2. chaque garde est EPROUVEE par un vrai appel, avec chaque role : un
//      refus attendu est un 403 ; un acces attendu n'est ni 401 ni 403 (le
//      traitement est atteint : 200, 400, 404... selon les donnees).
// La meme table est recopiee dans design/DESIGN.md (garde-fous du 25/09).

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GARDES = {
  "POST /login": "public",
  "POST /logout": "public",

  "POST /api/backup/now": "admin",
  "PATCH /api/settings/appearance": "admin",
  "PATCH /api/settings/stock": "admin",
  "PATCH /api/settings/order-numbering": "admin",
  "PATCH /api/settings/tournee": "admin",
  "POST /api/delivery-sectors": "admin",
  "PATCH /api/delivery-sectors/:id": "admin",
  "DELETE /api/delivery-sectors/:id": "admin",
  "POST /api/import/stock": "admin",
  "POST /api/import/ventes": "admin",
  "POST /api/orders/purge": "admin",
  "POST /api/comptes": "admin",
  "PATCH /api/comptes/:id": "admin",
  "DELETE /api/comptes/:id": "admin",

  "PATCH /api/stock/:id": "pas-livreur",

  "POST /api/crm/clients": "compte",
  "PATCH /api/crm/clients/:id": "compte",
  "DELETE /api/crm/clients/:id": "compte",
  "POST /api/crm/relances": "compte",
  "PATCH /api/crm/relances/:id": "compte",
  "POST /api/customer-orders": "compte",
  "POST /api/customer-orders/send-preparation": "compte",
  "POST /api/planned-orders": "compte",
  "PATCH /api/planned-orders/:id": "compte",
  "POST /api/planned-orders/:id/confirm": "compte",
  "POST /api/exports/commandes.xlsx": "compte",
  "PATCH /api/clients/:id": "compte",
  "PATCH /api/clients/:id/coordinates": "compte",
  "POST /api/orders/:id/replan": "compte",
  "POST /api/orders/:id/start-preparation": "compte",
  "POST /api/orders/:id/finish-preparation": "compte",
  "PATCH /api/orders/:id": "compte",
  "POST /api/orders/:id/release-stock": "compte",
  "POST /api/routes/decoupage": "compte",
  "POST /api/routes": "compte",
  "POST /api/routes/:id/start": "compte",
  "POST /api/routes/:id/annuler": "compte",
  "POST /api/routes/:id/cloturer": "compte",
  "POST /api/routes/:routeId/stops/:stopId/correction": "compte",
  "PATCH /api/routes/:routeId/stops/:stopId": "compte",
  "PATCH /api/routes/:id/reorder": "compte",
  "POST /api/livraison": "compte",
  "POST /api/geocodage/lancer": "compte",
  "POST /api/subscriptions": "compte",
  "PATCH /api/subscriptions/:id": "compte",
  "POST /api/subscriptions/:id/orders": "compte",
  "POST /api/routes/:id/recalculate": "compte",
  "POST /api/routes/:id/reoptimiser": "compte",
  "POST /api/routes/:id/stops/:stopId/maintenant": "compte",
  "POST /api/routes/:id/ajouter": "compte"
};

// --- 1. La table couvre exactement le code ----------------------------------

function routesDuCode() {
  const racine = path.join(__dirname, "..");
  const fichiers = ["server.js", ...fs.readdirSync(path.join(racine, "lib")).filter(f => f.endsWith(".js")).map(f => `lib/${f}`)];
  const trouvees = new Set();
  for (const fichier of fichiers) {
    const texte = fs.readFileSync(path.join(racine, fichier), "utf8");
    for (const m of texte.matchAll(/\bapp\.(post|patch|put|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
      trouvees.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
  }
  return trouvees;
}

test("routes d'écriture : l'instrument trouve les routes (témoin)", () => {
  const trouvees = routesDuCode();
  // Sans ce temoin, un motif qui ne trouve rien rendrait le banc suivant vert.
  assert.ok(trouvees.size >= 50, `seulement ${trouvees.size} routes trouvees`);
  assert.ok(trouvees.has("POST /api/orders/purge"));
  assert.ok(trouvees.has("POST /api/routes/:id/reoptimiser"), "les routes de lib/tournee-pratique.js ne sont pas vues");
  assert.ok(trouvees.has("POST /api/subscriptions"), "les routes de lib/operations-api.js ne sont pas vues");
});

test("routes d'écriture : chaque route du code a une garde déclarée, et aucune route déclarée n'a disparu", () => {
  const trouvees = routesDuCode();
  const nonDeclarees = [...trouvees].filter(r => !(r in GARDES)).sort();
  const disparues = Object.keys(GARDES).filter(r => !trouvees.has(r)).sort();
  assert.deepEqual(nonDeclarees, [], "routes d'ecriture sans garde declaree (a ajouter a GARDES et a DESIGN.md)");
  assert.deepEqual(disparues, [], "routes declarees absentes du code");
});

// --- 2. Chaque garde, eprouvee ------------------------------------------------

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-garde-fous-routes-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_OSRM_LOCAL = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "admin-env";
process.env.SEREO_AUTH_PASSWORD = "mot-de-passe-environnement";
process.env.SEREO_AUTH_MAX_ATTEMPTS = "50";
process.env.SEREO_AUTH_RATE_WINDOW_MS = "60000";
// Aucun appel sortant : le relais d'adresse et le calcul routier sont coupes.
process.env.SEREO_GEOCODER_URL = "http://127.0.0.1:9/";
process.env.SEREO_ROUTING_URL = "http://127.0.0.1:9";
delete process.env.SEREO_BACKUP_COPY_DIR;
// L export complet de la base, ouvert ici pour juger sa garde (ferme par defaut).
process.env.SEREO_ENABLE_DB_EXPORT = "1";

const { app, closeStorage, createUserAccount, _flushPendingBackup, _resetAuthRateLimitForTest } = require("../server");

let server;
let baseUrl;
const cookies = {};

async function connecter(identifiant, motDePasse) {
  _resetAuthRateLimitForTest();
  const reponse = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: identifiant, password: motDePasse }),
    redirect: "manual"
  });
  const cookie = (reponse.headers.getSetCookie?.() || []).find(v => v.startsWith("sereo_access="));
  assert.ok(cookie, `connexion refusee pour ${identifiant}`);
  return cookie.split(";")[0];
}

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await createUserAccount({ identifiant: "livreur-rt", motDePasse: "tournee-du-matin-2026", role: "livreur" });
  await createUserAccount({ identifiant: "bureau-rt", motDePasse: "mot-de-passe-bureau-2026", role: "bureau" });
  await createUserAccount({ identifiant: "prepa-rt", motDePasse: "mot-de-passe-prepa-2026", role: "preparateur" });
  cookies.livreur = await connecter("livreur-rt", "tournee-du-matin-2026");
  cookies.bureau = await connecter("bureau-rt", "mot-de-passe-bureau-2026");
  cookies.preparateur = await connecter("prepa-rt", "mot-de-passe-prepa-2026");
  cookies.admin = await connecter("admin-env", "mot-de-passe-environnement");
});

after(async () => {
  await _flushPendingBackup();
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Un appel reel : identifiants inexistants, corps vide. Le refus d'une garde
// vient AVANT le traitement ; un traitement atteint rend 200, 400, 404, 409...
async function appeler(route, cookie) {
  const [methode, gabarit] = route.split(" ");
  const chemin = gabarit.replace(/:[a-zA-Z]+/g, "inexistant-garde-fous");
  const reponse = await fetch(`${baseUrl}${chemin}`, {
    method: methode,
    headers: { cookie, "content-type": "application/json" },
    body: "{}",
    redirect: "manual"
  });
  await reponse.arrayBuffer();
  return reponse.status;
}

const ROLES_NON_ADMIN = ["livreur", "bureau", "preparateur"];

test("routes d'écriture : les gardes « admin » refusent livreur, bureau et préparateur (403)", async () => {
  const echecs = [];
  for (const [route, garde] of Object.entries(GARDES)) {
    if (garde !== "admin") continue;
    for (const role of ROLES_NON_ADMIN) {
      const statut = await appeler(route, cookies[role]);
      if (statut !== 403) echecs.push(`${route} (${role}) : ${statut}`);
    }
  }
  assert.deepEqual(echecs, [], "routes d'administration atteintes par un compte non administrateur");
});

test("routes d'écriture : « pas-livreur » refuse le livreur (403), ouvre bureau et préparation", async () => {
  const echecs = [];
  for (const [route, garde] of Object.entries(GARDES)) {
    if (garde !== "pas-livreur") continue;
    const livreur = await appeler(route, cookies.livreur);
    if (livreur !== 403) echecs.push(`${route} (livreur) : ${livreur}`);
    for (const role of ["bureau", "preparateur"]) {
      const statut = await appeler(route, cookies[role]);
      if (statut === 401 || statut === 403) echecs.push(`${route} (${role}) : ${statut}, attendu le traitement`);
    }
  }
  assert.deepEqual(echecs, []);
});

test("routes d'écriture : « compte » reste ouvert au livreur (le quotidien n'est pas fermé)", async () => {
  const echecs = [];
  for (const [route, garde] of Object.entries(GARDES)) {
    if (garde !== "compte") continue;
    const statut = await appeler(route, cookies.livreur);
    if (statut === 401 || statut === 403) echecs.push(`${route} : ${statut}`);
  }
  assert.deepEqual(echecs, [], "routes du quotidien refusees au livreur");
});

test("routes d'écriture : l'administrateur passe toutes les gardes (témoin des 403)", async () => {
  const echecs = [];
  for (const [route, garde] of Object.entries(GARDES)) {
    if (garde === "public" || route === "POST /api/orders/purge") continue;
    const statut = await appeler(route, cookies.admin);
    if (statut === 401 || statut === 403) echecs.push(`${route} : ${statut}`);
  }
  assert.deepEqual(echecs, [], "l'administrateur est refuse : le 403 des autres ne prouverait rien");
});

test("la vieille route de remise à zéro des tournées n'existe plus", async () => {
  const statut = await appeler("POST /api/reset-tournee", cookies.admin);
  assert.equal(statut, 404, `POST /api/reset-tournee repond ${statut}`);
});

// Une lecture, pas une ecriture (hors de la table) : mais c'est la base
// entiere, clients et comptes compris -- un telechargement de sauvegarde sous
// un autre nom (decision 6). Fermee par defaut ; SEREO_ENABLE_DB_EXPORT=1
// (diagnostic) l'ouvrait a TOUT compte connecte.
test("l'export complet de la base (GET /api/db, s'il est ouvert) est réservé à l'administration", async () => {
  for (const role of ROLES_NON_ADMIN) {
    const reponse = await fetch(`${baseUrl}/api/db`, { headers: { cookie: cookies[role] }, redirect: "manual" });
    const corps = await reponse.text();
    assert.equal(reponse.status, 403, `GET /api/db (${role}) : ${reponse.status}`);
    assert.ok(!corps.includes('"commandes"'), `GET /api/db (${role}) a recu la base`);
  }
  // Temoin : ouverte, la route sert bien la base a l'administrateur (sinon
  // le 403 des autres viendrait de la variable, pas de la garde).
  const admin = await fetch(`${baseUrl}/api/db`, { headers: { cookie: cookies.admin }, redirect: "manual" });
  assert.equal(admin.status, 200, "temoin : l'administrateur ne recoit pas l'export ouvert");
  assert.ok(Array.isArray((await admin.json()).commandes));
});

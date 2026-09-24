// Relecture adverse du lot « donnees utiles » (24/09) : le geocodage de FOND
// n'est l'oeuvre d'aucun compte.
//
// Une requete s'execute dans un contexte (AsyncLocalStorage) que le journal
// relit pour signer ses lignes. Le geocodage de fond, lance par la route APRES
// sa reponse (creation ou modification d'une fiche), heritait de ce contexte :
// la ligne « N client(s) geolocalise(s) automatiquement » etait signee du
// compte qui avait touche la fiche -- et la relance (.finally) aussi, meme
// quand un AUTRE compte l'avait provoquee.
//
// Authentification ALLUMEE, geocodage de fond ACTIF (autre processus que
// test/journal-auteur.test.js : les variables sont lues au chargement). Aucun
// appel reseau reel : la BAN est simulee, tout autre hote fait echouer le banc.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-journal-geocodage-"));
process.env.SEREO_GEOCODAGE_AUTO = "1";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
// Identifiants jetables d'un serveur de banc, base temporaire detruite a la fin.
process.env.SEREO_AUTH_USER = "admin-banc";
process.env.SEREO_AUTH_PASSWORD = "mot-de-passe-banc-sans-valeur";
process.env.SEREO_AUTH_MAX_ATTEMPTS = "50";
process.env.SEREO_AUTH_RATE_WINDOW_MS = "60000";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_GEOCODER_INTERVALLE_MS = "0";
process.env.SEREO_ROUTING_URL = "http://osrm.test";
process.env.SEREO_ROUTING_REPLI_URL = "";
delete process.env.SEREO_GEOCODER_URL;

// La BAN simulee, LENTE : le premier lot dure assez pour qu'un second compte
// cree une fiche pendant qu'il tourne (la relance part alors du .finally).
const vraiFetch = globalThis.fetch;
const DELAI_BAN_MS = 250;
let appelsBan = 0;
globalThis.fetch = async (entree, init = {}) => {
  const url = new URL(typeof entree === "string" ? entree : String(entree.url || entree));
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return vraiFetch(entree, init);
  if (url.hostname !== "api-adresse.data.gouv.fr") throw new Error(`appel externe interdit dans ce banc : ${url.hostname}`);
  appelsBan += 1;
  await new Promise(r => setTimeout(r, DELAI_BAN_MS));
  const corps = {
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [6.024, 47.238] },
      properties: { score: 0.96, type: "housenumber", label: "Besançon", postcode: "25000", city: "Besançon" }
    }]
  };
  return new Response(JSON.stringify(corps), { status: 200, headers: { "content-type": "application/json" } });
};

const { app, closeStorage, createUserAccount, defaultDb, readDb, writeDb, _resetAuthRateLimitForTest, _flushPendingBackup } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await createUserAccount({ identifiant: "julie", motDePasse: "tournee-du-matin-2026", role: "livreur" });
  await createUserAccount({ identifiant: "marc", motDePasse: "bureau-du-matin-2026", role: "bureau" });
});

after(async () => {
  await _flushPendingBackup?.();
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  globalThis.fetch = vraiFetch;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function connexion(identifiant, motDePasse) {
  _resetAuthRateLimitForTest();
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: identifiant, password: motDePasse }),
    redirect: "manual"
  });
  const cookie = (res.headers.getSetCookie?.() || []).find(v => v.startsWith("sereo_access="));
  assert.ok(cookie, `connexion de ${identifiant} refusee (${res.status})`);
  return cookie.split(";")[0];
}

async function creerFiche(cookie, nom, rue) {
  const res = await fetch(`${baseUrl}/api/crm/clients`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ nom, rue, codePostal: "25000", ville: "Besançon" }),
    redirect: "manual"
  });
  assert.equal(res.status, 201, `${nom} : ${await res.text()}`);
}

async function attendre(condition, delaiMs = 5000) {
  const limite = Date.now() + delaiMs;
  while (Date.now() < limite) {
    if (condition()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return condition();
}

const lignesGeocodage = () => readDb().historique.filter(h => h.type === "Geocodage");

test("geocodage de fond — le journal le dit « automatique », relance comprise, pas le compte qui a touche la fiche", async () => {
  writeDb({ ...defaultDb() }, { backup: false });
  const marc = await connexion("marc", "bureau-du-matin-2026");
  const julie = await connexion("julie", "tournee-du-matin-2026");

  // Marc cree une fiche : le lot de fond part apres la reponse. Julie en cree
  // une autre PENDANT ce lot : elle sera geocodee par la relance.
  await creerFiche(marc, "Pharmacie des Chaprais", "3 rue des Chaprais");
  assert.ok(await attendre(() => appelsBan >= 1, 2000), "temoin : le lot de fond n'a jamais appele la BAN");
  await creerFiche(julie, "Cabinet Battant", "9 rue Battant");

  assert.ok(await attendre(() => lignesGeocodage().length >= 2), `deux lots attendus, ${lignesGeocodage().length} vu(s)`);
  const db = readDb();
  // Temoin : les clients sont bien places par ces lots, et les gestes des
  // comptes restent signes de leur nom.
  assert.deepEqual(db.clients.map(c => [c.nom, c.lat]).sort(), [["Cabinet Battant", 47.238], ["Pharmacie des Chaprais", 47.238]]);
  assert.deepEqual(db.historique.filter(h => h.type === "CRM").map(h => h.auteur).sort(), ["julie", "marc"]);

  assert.deepEqual(lignesGeocodage().map(h => h.auteur), ["automatique", "automatique"]);
});

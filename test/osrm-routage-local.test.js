// Calcul routier OSRM integre (23/09) : lib/routing.js passe par la carte
// locale quand elle est prete, et garde le repli du lot 7 sinon.
//
// 1. Carte locale prete : table ET trace partent chez elle, rien ne sort.
// 2. Point hors de la zone (NoSegment, 400) : ce calcul-la part sur le serveur
//    suivant ; le suivant repasse par la carte locale (pas de pause).
// 3. Carte locale en panne : repli, et pause de 60 s (pas de delai paye a
//    chaque calcul).
// 4. Carte locale pas prete : aucun appel vers elle.
// 5. server.js branche son gestionnaire, et /api/storage/status montre l'etat.

const { test, afterEach, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-osrm-routage-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const routing = require("../lib/routing");
const { roadPlan } = routing;

const vraiFetch = globalThis.fetch;
let appels = [];
function reseau(repondre) {
  appels = [];
  globalThis.fetch = async (url) => {
    appels.push(String(url));
    const r = await repondre(String(url));
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.corps ?? r), { status: r.statut || 200, headers: { "Content-Type": "application/json" } });
  };
}
function fauxOsrm(url) {
  const pts = url.split("/driving/")[1].split("?")[0].split(";");
  if (url.includes("/table/"))
    return { code: "Ok", durations: pts.map((_, i) => pts.map((__, j) => (i === j ? 0 : 100 + 10 * Math.abs(i - j)))) };
  return { code: "Ok", routes: [{ distance: 12000, duration: 1200, geometry: { type: "LineString", coordinates: pts.map((p) => p.split(",").map(Number)) } }] };
}
const LOCAL = "http://127.0.0.1:5000";
const commandes = [
  { id: "a", clientName: "Client a", lat: 47.21, lng: 6.01 },
  { id: "b", clientName: "Client b", lat: 47.22, lng: 6.02 },
];
const DEPART = { lat: 47.2, lng: 6.0 };

afterEach(() => {
  globalThis.fetch = vraiFetch;
  delete process.env.SEREO_ROUTING_URL;
  delete process.env.SEREO_ROUTING_REPLI_URL;
  routing.definirServeurLocal?.(null);
  routing._reinitialiserRepli();
});

// server.js en PREMIER : les bancs suivants remplacent le fournisseur de
// carte locale que server.js a branche (afterEach le remet a vide).
// --- server.js ------------------------------------------------------------------
let serveur, base, S;
before(async () => {
  S = require("../server");
  serveur = S.app.listen(0, "127.0.0.1");
  await once(serveur, "listening");
  base = `http://127.0.0.1:${serveur.address().port}`;
});
after(async () => {
  await S._flushPendingBackup();
  await new Promise((r) => serveur.close(r));
  S.closeStorage();
  fs.rmSync(root, { recursive: true, force: true });
});

test("server.js : son gestionnaire alimente le calcul, et /api/storage/status montre l'etat du calcul routier", async (t) => {
  assert.ok(S._osrmLocal, "server.js n'a pas de gestionnaire de carte locale");
  t.mock.method(console, "warn", () => {});
  // La carte locale « prete » selon le gestionnaire du serveur : le calcul y va.
  t.mock.method(S._osrmLocal, "urlSiPret", () => "http://carte.locale");
  reseau(fauxOsrm);
  await roadPlan(commandes, DEPART, DEPART);
  assert.ok(appels.every((u) => u.startsWith("http://carte.locale/")), appels.join("\n"));
  globalThis.fetch = vraiFetch;

  const res = await fetch(`${base}/api/storage/status`);
  const corps = await res.json();
  assert.equal(res.status, 200);
  assert.ok(corps.calculRoutier, "l'etat du calcul routier n'est pas expose");
  assert.equal(typeof corps.calculRoutier.resume, "string");
  assert.equal(corps.calculRoutier.actif, false, "gestionnaire actif sans startServer()");
  assert.match(corps.calculRoutier.resume, /^Serveur public/);
});

test("carte locale prete : table et trace calcules sur elle, aucun appel au serveur public", async (t) => {
  assert.equal(typeof routing.definirServeurLocal, "function", "lib/routing.js ne connait pas la carte locale");
  t.mock.method(console, "warn", () => {});
  routing.definirServeurLocal(() => LOCAL);
  reseau(fauxOsrm);
  const plan = await roadPlan(commandes, DEPART, DEPART);
  assert.equal(plan.ordered.length, 2);
  assert.deepEqual(appels.map((u) => u.split("/driving/")[0]), [`${LOCAL}/table/v1`, `${LOCAL}/route/v1`]);
});

test("point hors de la zone locale (NoSegment) : ce calcul part sur le serveur suivant, le suivant revient a la carte locale", async (t) => {
  assert.equal(typeof routing.definirServeurLocal, "function", "lib/routing.js ne connait pas la carte locale");
  const avertissements = t.mock.method(console, "warn", () => {});
  routing.definirServeurLocal(() => LOCAL);
  reseau((url) => (url.startsWith(LOCAL) ? { statut: 400, corps: { code: "NoSegment" } } : fauxOsrm(url)));
  const plan = await roadPlan(commandes, DEPART, DEPART);
  assert.equal(plan.ordered.length, 2, "le calcul hors zone est refuse au lieu de passer au serveur public");
  assert.equal(appels.filter((u) => u.startsWith("https://router.project-osrm.org/")).length, 2);
  assert.match(avertissements.mock.calls[0].arguments[0], /carte locale ne couvre pas un des points.*router\.project-osrm\.org/);
  // Pas de pause apres un refus : le calcul suivant (dans la zone) est local.
  reseau(fauxOsrm);
  await roadPlan(commandes, DEPART, DEPART);
  assert.ok(appels.every((u) => u.startsWith(LOCAL)), appels.join("\n"));
});

test("carte locale en panne : repli, puis pause de 60 s ; pas prete : jamais appelee", async (t) => {
  assert.equal(typeof routing.definirServeurLocal, "function", "lib/routing.js ne connait pas la carte locale");
  t.mock.method(console, "warn", () => {});
  routing.definirServeurLocal(() => LOCAL);
  reseau((url) => (url.startsWith(LOCAL) ? new TypeError("fetch failed") : fauxOsrm(url)));
  await roadPlan(commandes, DEPART, DEPART);
  assert.equal(appels.filter((u) => u.startsWith(LOCAL)).length, 1, "la carte en panne est reessayee a chaque requete");
  await roadPlan(commandes, DEPART, DEPART);
  assert.equal(appels.filter((u) => u.startsWith(LOCAL)).length, 1, "pas de pause apres la panne");

  // Pas prete (le gestionnaire rend "") : aucun appel vers elle.
  routing._reinitialiserRepli();
  routing.definirServeurLocal(() => "");
  reseau(fauxOsrm);
  await roadPlan(commandes, DEPART, DEPART);
  assert.ok(appels.every((u) => u.startsWith("https://router.project-osrm.org/")), appels.join("\n"));
  // Un gestionnaire qui jette ne casse pas le calcul.
  routing.definirServeurLocal(() => { throw new Error("gestionnaire casse"); });
  reseau(fauxOsrm);
  assert.equal((await roadPlan(commandes, DEPART, DEPART)).ordered.length, 2);
});

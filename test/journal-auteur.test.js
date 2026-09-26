// Lot « donnees utiles » (24/09) -- le journal « qui a fait quoi », avec
// l'authentification ALLUMEE et des comptes nommes (autre processus que
// test/donnees-utiles.test.js : les variables sont lues au chargement).
//
// - l'auteur d'une action et d'un mouvement de stock est l'identifiant du
//   compte connecte, lu dans la requete (pas « local », pas un nom code) ;
// - deux comptes qui ecrivent en meme temps ne se pretent pas leur nom (le
//   contexte suit chaque requete a travers la file d'ecriture) ;
// - le journal (et /api/historique) est reserve a l'administration.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-journal-auteur-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
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
process.env.SEREO_ROUTING_URL = "http://osrm.test";
process.env.SEREO_ROUTING_REPLI_URL = "";

// Le calcul routier simule, LENT : la creation d'une tournee attend sa reponse
// AVANT d'ecrire. C'est la qu'une autre requete passe entre-temps -- le cas ou
// un « dernier auteur vu » global se tromperait de nom.
const vraiFetch = globalThis.fetch;
const DELAI_ROUTAGE_MS = 300;
globalThis.fetch = async (entree, init = {}) => {
  const url = new URL(typeof entree === "string" ? entree : String(entree.url || entree));
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return vraiFetch(entree, init);
  if (url.hostname !== "osrm.test") throw new Error(`appel externe interdit dans ce banc : ${url.hostname}`);
  await new Promise(r => setTimeout(r, DELAI_ROUTAGE_MS));
  const points = url.pathname.split("/").pop().split(";");
  const corps = url.pathname.includes("/table/")
    ? { code: "Ok", durations: points.map((_, i) => points.map((__, j) => (i === j ? 0 : 600))) }
    : { code: "Ok", routes: [{ distance: 12000, duration: 1500, geometry: { type: "LineString", coordinates: points.map(p => p.split(",").map(Number)) } }] };
  return new Response(JSON.stringify(corps), { status: 200, headers: { "content-type": "application/json" } });
};

const { app, closeStorage, createUserAccount, defaultDb, readDb, writeDb, _resetAuthRateLimitForTest } = require("../server");
const { jourParis } = require("../lib/jour-paris");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  // Garde-fous (25/09) : un livreur ne modifie plus le stock (refuserAuLivreur).
  // Ce banc prend un compte non administrateur quelconque pour juger l'AUTEUR :
  // julie est preparatrice (avant : livreuse).
  await createUserAccount({ identifiant: "julie", motDePasse: "tournee-du-matin-2026", role: "preparateur" });
  await createUserAccount({ identifiant: "marc", motDePasse: "bureau-du-matin-2026", role: "bureau" });
});

after(async () => {
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

async function demander(chemin, cookie, options = {}) {
  const res = await fetch(`${baseUrl}${chemin}`, {
    ...options,
    headers: { cookie, "content-type": "application/json", ...(options.headers || {}) },
    redirect: "manual"
  });
  const texte = await res.text();
  let body = null;
  try { body = texte ? JSON.parse(texte) : null; } catch { body = texte; }
  return { res, body };
}

function ensemencer() {
  writeDb({
    ...defaultDb(),
    stock: [
      { id: "p1", code: "A1", nom: "Alèses", quantite: 10 },
      { id: "p2", code: "CH-L", nom: "Changes L", quantite: 10 }
    ]
  }, { backup: false });
}

test("auteur — l'action et le mouvement de stock portent l'identifiant du compte connecte", async () => {
  ensemencer();
  const julie = await connexion("julie", "tournee-du-matin-2026");
  const { res } = await demander("/api/stock/p1", julie, { method: "PATCH", body: JSON.stringify({ quantite: 7, reason: "Casse" }) });
  assert.equal(res.status, 200);
  const db = readDb();
  assert.equal(db.historique[0].auteur, "julie");
  assert.equal(db.stockMovements[0].createdBy, "julie");
});

test("auteur — une ecriture qui attend le calcul routier garde son auteur, meme si un autre compte ecrit entre-temps", async () => {
  const jour = jourParis();
  const commande = {
    id: "o-1", numero: "CMD-2026-001", clientId: "c-1", clientName: "EHPAD Les Tilleuls", status: "pret_livraison",
    address: "12 avenue du Général de Gaulle", city: "Besançon", postalCode: "25000", sector: "Besancon",
    lat: 47.238, lng: 6.024, deliveryDate: jour, dateCommande: jour,
    products: [{ code: "A1", nom: "Alèses", quantite: 1 }]
  };
  writeDb({
    ...defaultDb(),
    clients: [{ id: "c-1", nom: "EHPAD Les Tilleuls", rue: commande.address, ville: "Besançon", codePostal: "25000", lat: 47.238, lng: 6.024, statut: "restant", produits: [] }],
    commandes: [commande],
    stock: [{ id: "p1", code: "A1", nom: "Alèses", quantite: 10 }]
  }, { backup: false });
  const julie = await connexion("julie", "tournee-du-matin-2026");
  const marc = await connexion("marc", "bureau-du-matin-2026");

  // Julie cree la tournee (le calcul routier prend 300 ms) ; Marc corrige le
  // stock pendant ce temps.
  const tournee = demander("/api/routes", julie, {
    method: "POST",
    body: JSON.stringify({ orderIds: ["o-1"], departure: { lat: 47.24, lng: 6.02, label: "Dépôt" }, arrival: { lat: 47.24, lng: 6.02, label: "Dépôt" }, deliveryDate: jour, sector: "Besancon" })
  });
  await new Promise(r => setTimeout(r, DELAI_ROUTAGE_MS / 3));
  const stock = await demander("/api/stock/p1", marc, { method: "PATCH", body: JSON.stringify({ quantite: 8, reason: "Inventaire" }) });
  assert.equal(stock.res.status, 200);
  const cree = await tournee;
  assert.equal(cree.res.status, 201, JSON.stringify(cree.body));

  const db = readDb();
  const ligneTournee = db.historique.find(h => h.type === "Tournee");
  const ligneStock = db.historique.find(h => h.type === "Stock");
  // Temoin : l'ecriture de Marc est bien passee AVANT celle de Julie.
  assert.ok(db.historique.indexOf(ligneStock) > db.historique.indexOf(ligneTournee), "le stock n'a pas ete ecrit pendant le calcul");
  assert.equal(ligneStock.auteur, "marc");
  assert.equal(db.stockMovements[0].createdBy, "marc");
  assert.equal(ligneTournee.auteur, "julie", `la tournee de julie est signee ${ligneTournee.auteur}`);
});

test("journal — reserve a l'administration ; l'administrateur lit l'auteur", async () => {
  ensemencer();
  const julie = await connexion("julie", "tournee-du-matin-2026");
  await demander("/api/stock/p1", julie, { method: "PATCH", body: JSON.stringify({ quantite: 3 }) });

  for (const chemin of ["/api/journal", "/api/historique"]) {
    const refuse = await demander(chemin, julie);
    assert.equal(refuse.res.status, 403, chemin);
  }

  const admin = await connexion("admin-banc", "mot-de-passe-banc-sans-valeur");
  const { res, body } = await demander("/api/journal?genre=stock", admin);
  assert.equal(res.status, 200);
  assert.equal(body.entrees[0].auteur, "julie");
  const actions = await demander("/api/journal", admin);
  assert.equal(actions.body.entrees[0].auteur, "julie");
});

// Relecture adverse (24/09) : /api/stock-movements part au chargement de
// l'app, pour TOUS les comptes (et reste dans le cache du service worker).
// Elle servait toute la table avec `createdBy` : le verrou du journal
// (?genre=stock, administration) ne gardait rien.
test("mouvements recents — sans auteur, pour tout compte ; les derniers seulement", async () => {
  const anciens = Array.from({ length: 60 }, (_, i) => ({
    id: `m-${i}`, productId: "p2", productName: "Changes L", sku: "CH-L", type: "sortie", quantity: 1,
    oldQuantity: 70 - i, newQuantity: 69 - i, reason: "Inventaire",
    createdAt: new Date(Date.UTC(2026, 8, 1) - i * 3600000).toISOString(), createdBy: "marc"
  }));
  writeDb({
    ...defaultDb(),
    stock: [{ id: "p1", code: "A1", nom: "Alèses", quantite: 10 }, { id: "p2", code: "CH-L", nom: "Changes L", quantite: 10 }],
    stockMovements: anciens
  }, { backup: false });
  const julie = await connexion("julie", "tournee-du-matin-2026");
  const geste = await demander("/api/stock/p1", julie, { method: "PATCH", body: JSON.stringify({ quantite: 4, reason: "Casse" }) });
  assert.equal(geste.res.status, 200);
  // Temoin : l'auteur est bien ecrit, et l'administrateur le lit au journal.
  assert.equal(readDb().stockMovements[0].createdBy, "julie");
  const admin = await connexion("admin-banc", "mot-de-passe-banc-sans-valeur");
  assert.equal((await demander("/api/journal?genre=stock&limite=1", admin)).body.entrees[0].auteur, "julie");

  for (const [qui, cookie] of [["julie", julie], ["admin", admin]]) {
    const { res, body } = await demander("/api/stock-movements", cookie);
    assert.equal(res.status, 200, qui);
    assert.deepEqual(body.filter(m => "createdBy" in m || "auteur" in m || "utilisateur" in m).map(m => m.createdBy), [], `${qui} lit l'auteur des mouvements`);
    // Les derniers d'abord, 50 au plus (l'ecran en montre 12).
    assert.equal(body.length, 50, qui);
    assert.deepEqual([body[0].productName, body[0].reason, body[0].quantity], ["Alèses", "Casse", 6]);
    assert.equal(body[49].id, "m-48");
  }
});

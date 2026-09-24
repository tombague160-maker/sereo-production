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

const { app, closeStorage, createUserAccount, defaultDb, readDb, writeDb, _resetAuthRateLimitForTest } = require("../server");

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
  await new Promise(resolve => server.close(resolve));
  closeStorage();
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

test("auteur — deux comptes qui ecrivent en meme temps gardent chacun leur nom", async () => {
  ensemencer();
  const julie = await connexion("julie", "tournee-du-matin-2026");
  const marc = await connexion("marc", "bureau-du-matin-2026");
  // Dix ecritures entrelacees : la file d'ecriture les sert une a une, le
  // contexte de chacune doit rester le sien.
  await Promise.all(Array.from({ length: 10 }, (_, i) => demander(
    `/api/stock/${i % 2 ? "p1" : "p2"}`, i % 2 ? julie : marc,
    { method: "PATCH", body: JSON.stringify({ quantite: 20 + i, reason: `geste ${i}` }) }
  )));
  const mouvements = readDb().stockMovements;
  assert.equal(mouvements.length, 10);
  for (const m of mouvements) {
    const attendu = m.productId === "p1" ? "julie" : "marc";
    assert.equal(m.createdBy, attendu, `${m.reason} : ${m.createdBy} au lieu de ${attendu}`);
  }
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

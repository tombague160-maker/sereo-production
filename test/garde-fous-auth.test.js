// Garde-fous du 25/09 : connexion et sessions (chasse aux defauts, section 3).
//
//   1. Une limite de tentatives PAR COMPTE, en plus de celle par adresse : une
//      attaque repartie sur de nombreuses adresses (chacune sous sa limite) ne
//      peut plus essayer sans fin les mots de passe d'un meme compte. Les
//      autres comptes ne sont pas bloques.
//   2. « Se deconnecter » et un changement de mot de passe invalident
//      l'ancienne session (avant : le cookie restait valable 12 h).
//
// Les adresses differentes sont simulees par X-Forwarded-For (trust proxy 1 :
// l'adresse retenue est celle que le proxy ajoute).

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-garde-fous-auth-"));
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
// La limite par adresse, large ici : ce banc juge celle par compte.
process.env.SEREO_AUTH_MAX_ATTEMPTS = "1000";
process.env.SEREO_AUTH_RATE_WINDOW_MS = "60000";
// Le blocage d'un compte, court pour le banc (15 min par defaut).
process.env.SEREO_AUTH_LOCKOUT_COMPTE_MS = "1500";
delete process.env.SEREO_AUTH_MAX_ATTEMPTS_COMPTE;
delete process.env.SEREO_BACKUP_COPY_DIR;

const S = require("../server");
const { app, closeStorage, createUserAccount, _flushPendingBackup, _resetAuthRateLimitForTest } = S;

let server;
let baseUrl;
let adresse = 0;
const nouvelleAdresse = () => `203.0.113.${(adresse++ % 250) + 1}`;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await createUserAccount({ identifiant: "julie", motDePasse: "tournee-du-matin-2026", role: "livreur" });
  await createUserAccount({ identifiant: "marc", motDePasse: "bureau-du-matin-2026", role: "bureau" });
  await createUserAccount({ identifiant: "chef", motDePasse: "chef-du-bureau-2026", role: "admin" });
});

after(async () => {
  await _flushPendingBackup();
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// POST /login depuis une adresse donnee ; rend le cookie de session, ou null,
// et l'adresse de redirection.
async function connexion(identifiant, motDePasse, ip = nouvelleAdresse()) {
  const reponse = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
    body: new URLSearchParams({ username: identifiant, password: motDePasse }),
    redirect: "manual"
  });
  const cookie = (reponse.headers.getSetCookie?.() || []).find(v => v.startsWith("sereo_access=") && !/Max-Age=0/.test(v));
  return { cookie: cookie ? cookie.split(";")[0] : null, location: reponse.headers.get("location") || "" };
}

async function moi(cookie) {
  const reponse = await fetch(`${baseUrl}/api/me`, { headers: { cookie }, redirect: "manual" });
  await reponse.arrayBuffer();
  return reponse.status;
}

// --- 1. Limite par compte -----------------------------------------------------

test("connexion : 20 échecs sur un compte, depuis 20 adresses, le bloquent — même avec le bon mot de passe", async () => {
  _resetAuthRateLimitForTest();
  for (let i = 0; i < 20; i++) {
    const essai = await connexion("julie", `mauvais-${i}`);
    assert.equal(essai.cookie, null);
  }
  // Une adresse neuve, le BON mot de passe : le compte est bloque.
  const bloque = await connexion("julie", "tournee-du-matin-2026");
  assert.equal(bloque.cookie, null, "une attaque repartie sur 20 adresses essaie encore les mots de passe de julie");
  assert.match(bloque.location, /locked=1/);
  // Les autres comptes ne sont pas bloques (temoin).
  const marc = await connexion("marc", "bureau-du-matin-2026");
  assert.ok(marc.cookie, "un autre compte est bloque par les echecs de julie");
  // L'identifiant se compte sans la casse ni les espaces : « JULIE » est julie.
  const casse = await connexion("  JULIE ", "tournee-du-matin-2026");
  assert.equal(casse.cookie, null, "la limite se contourne en changeant la casse");
  // La page de connexion le dit.
  const page = await fetch(`${baseUrl}${bloque.location}`, { redirect: "manual" });
  assert.match(await page.text(), /Trop de tentatives/);
});

test("connexion : le blocage d'un compte se lève, et une connexion réussie remet son compteur à zéro", async () => {
  _resetAuthRateLimitForTest();
  for (let i = 0; i < 20; i++) await connexion("marc", `mauvais-${i}`);
  assert.equal((await connexion("marc", "bureau-du-matin-2026")).cookie, null, "prealable : marc n'est pas bloque");
  await new Promise(r => setTimeout(r, 1700));
  const apres = await connexion("marc", "bureau-du-matin-2026");
  assert.ok(apres.cookie, "le blocage ne se leve pas");
  // Compteur remis a zero : un echec de plus ne rebloque pas.
  await connexion("marc", "encore-faux");
  assert.ok((await connexion("marc", "bureau-du-matin-2026")).cookie, "une connexion reussie n'a pas remis le compteur a zero");
});

test("connexion : la limite par compte vaut aussi pour l'authentification Basic du compte d'environnement", async () => {
  _resetAuthRateLimitForTest();
  const basic = (u, p) => fetch(`${baseUrl}/api/me`, {
    headers: { authorization: `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`, "x-forwarded-for": nouvelleAdresse() },
    redirect: "manual"
  });
  for (let i = 0; i < 20; i++) await (await basic("admin-env", `mauvais-${i}`)).arrayBuffer();
  const bloque = await basic("admin-env", "mot-de-passe-environnement");
  await bloque.arrayBuffer();
  assert.equal(bloque.status, 429, `apres 20 echecs repartis, le bon mot de passe passe encore (${bloque.status})`);
  await new Promise(r => setTimeout(r, 1700));
  const apres = await basic("admin-env", "mot-de-passe-environnement");
  await apres.arrayBuffer();
  assert.equal(apres.status, 200, "temoin : le blocage ne se leve pas");
});

// --- 2. Deconnexion et changement de mot de passe -----------------------------

async function deconnexion(cookie) {
  const reponse = await fetch(`${baseUrl}/logout`, { method: "POST", headers: { cookie }, redirect: "manual" });
  await reponse.arrayBuffer();
  return reponse.status;
}

async function patchCompte(cookie, id, corps) {
  const reponse = await fetch(`${baseUrl}/api/comptes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(corps),
    redirect: "manual"
  });
  const cookieNeuf = (reponse.headers.getSetCookie?.() || []).find(v => v.startsWith("sereo_access=") && !/Max-Age=0/.test(v));
  return { status: reponse.status, corps: await reponse.json().catch(() => null), cookie: cookieNeuf ? cookieNeuf.split(";")[0] : null };
}

test("se déconnecter invalide la session : le même cookie rejoué ne passe plus (compte en base et compte d'environnement)", async () => {
  _resetAuthRateLimitForTest();
  for (const [identifiant, motDePasse] of [["julie", "tournee-du-matin-2026"], ["admin-env", "mot-de-passe-environnement"]]) {
    const { cookie } = await connexion(identifiant, motDePasse);
    assert.ok(cookie, `prealable : ${identifiant} ne se connecte pas`);
    const autre = (await connexion(identifiant, motDePasse)).cookie;
    assert.equal(await moi(cookie), 200);
    assert.equal(await deconnexion(cookie), 303);
    assert.equal(await moi(cookie), 401, `${identifiant} : le cookie d'une session fermee ouvre encore la session`);
    // Une AUTRE session du meme compte (un autre appareil) reste ouverte.
    assert.equal(await moi(autre), 200, `${identifiant} : se deconnecter a ferme aussi l'autre appareil`);
  }
});

test("changer le mot de passe d'un compte ferme ses sessions ouvertes, pas celles des autres", async () => {
  _resetAuthRateLimitForTest();
  const admin = (await connexion("admin-env", "mot-de-passe-environnement")).cookie;
  const julie = (await connexion("julie", "tournee-du-matin-2026")).cookie;
  const marc = (await connexion("marc", "bureau-du-matin-2026")).cookie;
  const comptes = await (await fetch(`${baseUrl}/api/comptes`, { headers: { cookie: admin } })).json();
  const idJulie = comptes.find(c => c.identifiant === "julie").id;
  const modif = await patchCompte(admin, idJulie, { motDePasse: "nouveau-mot-de-passe-julie" });
  assert.equal(modif.status, 200, JSON.stringify(modif.corps));
  assert.equal(await moi(julie), 401, "l'ancien cookie de julie ouvre encore la session apres le changement de mot de passe");
  assert.equal(await moi(marc), 200, "le changement de mot de passe de julie a ferme la session de marc");
  assert.equal(await moi(admin), 200);
  // Le nouveau mot de passe ouvre une session neuve (temoin).
  const neuf = (await connexion("julie", "nouveau-mot-de-passe-julie")).cookie;
  assert.ok(neuf);
  assert.equal(await moi(neuf), 200);
  // Changer le role seul ne ferme rien.
  assert.equal((await patchCompte(admin, idJulie, { role: "preparateur" })).status, 200);
  assert.equal(await moi(neuf), 200, "un changement de role a ferme la session");
});

test("changer SON propre mot de passe : l'ancienne session tombe, la réponse en ouvre une neuve", async () => {
  _resetAuthRateLimitForTest();
  const chef = (await connexion("chef", "chef-du-bureau-2026")).cookie;
  const ailleurs = (await connexion("chef", "chef-du-bureau-2026")).cookie;
  const comptes = await (await fetch(`${baseUrl}/api/comptes`, { headers: { cookie: chef } })).json();
  const id = comptes.find(c => c.identifiant === "chef").id;
  const modif = await patchCompte(chef, id, { motDePasse: "chef-nouveau-mot-de-passe" });
  assert.equal(modif.status, 200);
  assert.ok(modif.cookie, "la reponse n'ouvre pas de session neuve : l'administrateur serait deconnecte par son propre geste");
  assert.equal(await moi(modif.cookie), 200);
  assert.equal(await moi(ailleurs), 401, "une session ouverte avec l'ancien mot de passe (un autre appareil) passe encore");
});

test("les sessions fermées le restent après un redémarrage (lues dans la base)", async () => {
  _resetAuthRateLimitForTest();
  const { cookie } = await connexion("marc", "bureau-du-matin-2026");
  assert.equal(await deconnexion(cookie), 303);
  assert.equal(await moi(cookie), 401);
  // Ce que le processus garde en memoire est oublie, comme au redemarrage.
  assert.equal(typeof S._oublierRevocationsPourTest, "function", "aucune revocation n'est gardee");
  S._oublierRevocationsPourTest();
  assert.equal(await moi(cookie), 401, "apres un redemarrage, la session fermee se rouvre");
});

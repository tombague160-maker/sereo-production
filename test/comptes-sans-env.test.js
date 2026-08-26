// Comptes utilisateurs SANS variables d'environnement — V8 phase 1.
//
// Configuration cible a terme : la protection ne vient plus du couple
// SEREO_AUTH_USER / SEREO_AUTH_PASSWORD mais des seuls comptes en base.
//
// Fichier separe parce que ces variables sont lues au chargement du module :
// on ne peut pas les changer en cours de processus.
//
// C'est le fichier le plus sensible du lot. Quand AUTH_USER et AUTH_PASSWORD
// valent "", toute comparaison d'egalite avec eux devient vraie pour une
// chaine vide : sans garde explicite, un en-tete Basic vide authentifierait
// n'importe qui sur une installation protegee uniquement par des comptes.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-sansenv-"));

process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
// Le coeur du sujet : aucune protection par environnement.
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_AUTH_MAX_ATTEMPTS = "50";

const {
  app,
  closeStorage,
  createUserAccount,
  updateUserAccount,
  deleteUserAccount,
  listUserAccounts,
  isAccessAuthEnabled,
  isEnvAuthConfigured,
  _resetAuthRateLimitForTest
} = require("../server");

let server;
let baseUrl;
let admin;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function basicHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function sertLaPageDeConnexion(response) {
  if (response.status !== 200) return true;
  const corps = await response.text();
  return /name="password"|login-form/.test(corps);
}

// --- Bascule d'activation ---------------------------------------------------

test("sans env — aucune protection tant qu'aucun compte n'existe", async () => {
  // Comportement historique preserve : en developpement, sans variables ni
  // comptes, l'application reste ouverte.
  assert.equal(isEnvAuthConfigured(), false);
  assert.equal(isAccessAuthEnabled(), false);

  const page = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(await sertLaPageDeConnexion(page), false, "l'app devrait etre ouverte");
});

test("sans env — creer un compte active la protection", async () => {
  admin = await createUserAccount({
    identifiant: "patronne",
    motDePasse: "mot-de-passe-patronne-2026",
    role: "admin"
  });

  assert.equal(isAccessAuthEnabled(), true, "la presence d'un compte doit activer la protection");

  const page = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(
    await sertLaPageDeConnexion(page),
    true,
    "l'app aurait du demander une connexion"
  );
});

// --- Le trou a ne jamais rouvrir --------------------------------------------

test("sans env — un en-tete Basic VIDE n'authentifie personne", async () => {
  // AUTH_USER et AUTH_PASSWORD valent "" ici. La comparaison a temps constant
  // utilisee pour le couple d'environnement retournerait donc vrai pour des
  // identifiants vides. Deux gardes isEnvAuthConfigured() ferment cette voie,
  // une dans isAuthorizedRequest et une dans requireAccessAuth. Retirer l'une
  // ou l'autre doit faire echouer ce test.
  _resetAuthRateLimitForTest();

  const reponse = await fetch(`${baseUrl}/`, {
    headers: { authorization: basicHeader("", "") },
    redirect: "manual"
  });

  assert.equal(
    await sertLaPageDeConnexion(reponse),
    true,
    "un Basic vide a obtenu l'acces : la garde isEnvAuthConfigured a saute"
  );
});

test("sans env — un en-tete Basic VIDE n'ouvre pas non plus l'API", async () => {
  _resetAuthRateLimitForTest();

  const reponse = await fetch(`${baseUrl}/api/clients`, {
    headers: { authorization: basicHeader("", "") }
  });

  assert.equal(reponse.status, 401, "l'API a repondu a un Basic vide");
});

test("sans env — aucun couple Basic ne fonctionne, meme celui d'un compte reel", async () => {
  // L'authentification Basic reste volontairement reservee au couple
  // d'environnement : la verification d'un compte est asynchrone (scrypt) et
  // ne peut pas se faire sur le chemin synchrone de chaque requete. Les
  // comptes passent par le formulaire.
  _resetAuthRateLimitForTest();

  const reponse = await fetch(`${baseUrl}/api/clients`, {
    headers: { authorization: basicHeader("patronne", "mot-de-passe-patronne-2026") }
  });

  assert.equal(reponse.status, 401);
});

// --- Connexion par formulaire ------------------------------------------------

test("sans env — le compte en base se connecte par le formulaire", async () => {
  _resetAuthRateLimitForTest();

  const reponse = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: "patronne",
      password: "mot-de-passe-patronne-2026"
    }),
    redirect: "manual"
  });

  const cookies = reponse.headers.getSetCookie?.() || [];
  const session = cookies.find(value => value.startsWith("sereo_access="));
  assert.ok(session, "aucune session emise pour un compte valide");

  const page = await fetch(`${baseUrl}/`, {
    headers: { cookie: session.split(";")[0] },
    redirect: "manual"
  });
  assert.equal(await sertLaPageDeConnexion(page), false, "la session devrait ouvrir l'app");
});

// --- Garde-fou du dernier administrateur -------------------------------------

test("sans env — impossible de desactiver le dernier administrateur", async () => {
  // Sans cette garde, se desactiver soi-meme fermerait definitivement
  // l'administration, sans aucun recours depuis l'interface.
  await assert.rejects(
    () => updateUserAccount(admin.id, { actif: false }),
    /dernier administrateur actif/
  );
});

test("sans env — impossible de retrograder le dernier administrateur", async () => {
  await assert.rejects(
    () => updateUserAccount(admin.id, { role: "livreur" }),
    /dernier administrateur actif/
  );
});

test("sans env — impossible de supprimer le dernier administrateur", () => {
  assert.throws(() => deleteUserAccount(admin.id), /dernier administrateur actif/);
});

test("sans env — un second administrateur libere le premier", async () => {
  const second = await createUserAccount({
    identifiant: "second-admin",
    motDePasse: "mot-de-passe-second-2026",
    role: "admin"
  });

  // Il y a maintenant deux admins actifs : retrograder le premier est permis.
  await updateUserAccount(admin.id, { role: "bureau" });
  assert.equal(listUserAccounts().find(u => u.id === admin.id).role, "bureau");

  // Et le second devient a son tour le dernier, donc protege.
  await assert.rejects(
    () => updateUserAccount(second.id, { actif: false }),
    /dernier administrateur actif/
  );

  // On remet l'etat initial pour ne pas dependre de l'ordre des tests.
  await updateUserAccount(admin.id, { role: "admin" });
  deleteUserAccount(second.id);
});

test("sans env — un administrateur DESACTIVE ne compte pas comme recours", async () => {
  // Piege : deux comptes admin dont un desactive ne font qu'un seul recours.
  const dormant = await createUserAccount({
    identifiant: "admin-dormant",
    motDePasse: "mot-de-passe-dormant-2026",
    role: "admin",
    actif: false
  });

  await assert.rejects(
    () => updateUserAccount(admin.id, { actif: false }),
    /dernier administrateur actif/,
    "un admin desactive a ete compte comme administrateur restant"
  );

  deleteUserAccount(dormant.id);
});

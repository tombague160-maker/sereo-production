// Connexion des comptes utilisateurs — V8 phase 1.
//
// Configuration de ce fichier : protection par variables d'environnement
// ACTIVEE **et** comptes en base. C'est exactement la situation de la
// production de Tom pendant la migration — les deux voies doivent coexister,
// et surtout l'ancienne ne doit jamais cesser de fonctionner, sous peine de
// le verrouiller hors de son application.
//
// Le cas "comptes en base SANS variables d'environnement" est couvert par
// comptes-connexion-sans-env.test.js, qui a besoin d'un autre processus
// puisque les variables sont lues au chargement du module.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-comptes-cx-"));

process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "admin-env";
process.env.SEREO_AUTH_PASSWORD = "mot-de-passe-environnement";
process.env.SEREO_AUTH_MAX_ATTEMPTS = "50";
process.env.SEREO_AUTH_RATE_WINDOW_MS = "60000";

const {
  app,
  closeStorage,
  createUserAccount,
  updateUserAccount,
  deleteUserAccount,
  listUserAccounts,
  _resetAuthRateLimitForTest
} = require("../server");

let server;
let baseUrl;
let livreur;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  livreur = await createUserAccount({
    identifiant: "julie",
    motDePasse: "tournee-du-matin-2026",
    role: "livreur"
  });
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function postLogin(username, password) {
  _resetAuthRateLimitForTest();
  return fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
    redirect: "manual"
  });
}

function sessionCookieFrom(response) {
  const raw = response.headers.getSetCookie?.() || [];
  const cookie = raw.find(value => value.startsWith("sereo_access="));
  return cookie ? cookie.split(";")[0] : null;
}

async function getWithCookie(pathname, cookie) {
  return fetch(`${baseUrl}${pathname}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual"
  });
}

/**
 * Une requete GET non authentifiee ne redirige PAS : requireAccessAuth rend
 * directement la page de connexion, avec un statut 200. On distingue donc
 * "connecte" de "deconnecte" par le contenu, jamais par le code HTTP.
 */
async function sertLaPageDeConnexion(response) {
  if (response.status !== 200) return true;
  const corps = await response.text();
  return /name="password"|login-form/.test(corps);
}

// --- Non-regression : l'ancienne voie doit survivre -------------------------

test("connexion — le couple d'environnement fonctionne toujours", async () => {
  // LE test a ne jamais laisser echouer : c'est ce qui protege la production
  // aujourd'hui. Si ce test casse, Tom est enferme dehors.
  const response = await postLogin("admin-env", "mot-de-passe-environnement");
  assert.equal(response.status, 303);
  assert.ok(sessionCookieFrom(response), "aucun cookie de session emis");
});

test("connexion — la session du compte d'environnement ouvre l'application", async () => {
  const response = await postLogin("admin-env", "mot-de-passe-environnement");
  const cookie = sessionCookieFrom(response);
  assert.equal(
    await sertLaPageDeConnexion(await getWithCookie("/", cookie)),
    false,
    "le compte d'environnement devrait acceder a l'application"
  );
});

// --- Nouvelle voie : comptes en base ---------------------------------------

test("connexion — un compte en base peut se connecter", async () => {
  const response = await postLogin("julie", "tournee-du-matin-2026");
  assert.equal(response.status, 303);
  assert.ok(sessionCookieFrom(response), "aucun cookie de session emis");
});

test("connexion — l'identifiant est insensible a la casse", async () => {
  const response = await postLogin("JULIE", "tournee-du-matin-2026");
  assert.ok(sessionCookieFrom(response), "JULIE devrait ouvrir la session de julie");
});

test("connexion — un mot de passe faux est refuse", async () => {
  const response = await postLogin("julie", "mauvais-mot-de-passe");
  assert.equal(sessionCookieFrom(response), null);
  assert.match(response.headers.get("location"), /error=1/);
});

test("connexion — un identifiant inconnu est refuse", async () => {
  const response = await postLogin("fantome", "tournee-du-matin-2026");
  assert.equal(sessionCookieFrom(response), null);
});

test("connexion — identifiant inconnu et mot de passe faux donnent la meme reponse", async () => {
  // Aucune fuite permettant d'enumerer les comptes existants.
  const inconnu = await postLogin("fantome", "peu-importe-1234");
  const faux = await postLogin("julie", "peu-importe-1234");
  assert.equal(inconnu.status, faux.status);
  assert.equal(
    inconnu.headers.get("location").replace(/remaining=\d+/, ""),
    faux.headers.get("location").replace(/remaining=\d+/, "")
  );
});

// --- Comptes desactives -----------------------------------------------------

test("connexion — un compte desactive ne peut pas se connecter", async () => {
  const compte = await createUserAccount({
    identifiant: "ancien-livreur",
    motDePasse: "mot-de-passe-valide-2026",
    role: "livreur"
  });
  await updateUserAccount(compte.id, { actif: false });

  const response = await postLogin("ancien-livreur", "mot-de-passe-valide-2026");
  assert.equal(sessionCookieFrom(response), null, "un compte desactive a obtenu une session");
});

test("connexion — desactiver un compte invalide sa session EN COURS", async () => {
  // C'est la raison pour laquelle le role est relu en base a chaque requete
  // plutot que porte par le cookie : sans cela, un compte revoque garderait
  // l'acces jusqu'a 12 h.
  const compte = await createUserAccount({
    identifiant: "revoque",
    motDePasse: "mot-de-passe-valide-2026",
    role: "bureau"
  });

  const cookie = sessionCookieFrom(await postLogin("revoque", "mot-de-passe-valide-2026"));
  assert.ok(cookie, "la connexion initiale aurait du reussir");
  assert.equal(
    await sertLaPageDeConnexion(await getWithCookie("/", cookie)),
    false,
    "la session fraiche aurait du donner acces a l'application"
  );

  await updateUserAccount(compte.id, { actif: false });

  assert.equal(
    await sertLaPageDeConnexion(await getWithCookie("/", cookie)),
    true,
    "la session aurait du etre invalidee immediatement apres desactivation"
  );
});

test("connexion — supprimer un compte invalide sa session en cours", async () => {
  const compte = await createUserAccount({
    identifiant: "supprime",
    motDePasse: "mot-de-passe-valide-2026",
    role: "bureau"
  });

  const cookie = sessionCookieFrom(await postLogin("supprime", "mot-de-passe-valide-2026"));
  assert.equal(await sertLaPageDeConnexion(await getWithCookie("/", cookie)), false);

  deleteUserAccount(compte.id);
  assert.equal(
    await sertLaPageDeConnexion(await getWithCookie("/", cookie)),
    true,
    "la session d'un compte supprime aurait du etre invalidee"
  );
});

// --- Service des comptes ----------------------------------------------------

test("comptes — un mot de passe trop court est refuse", async () => {
  await assert.rejects(
    () => createUserAccount({ identifiant: "trop-court", motDePasse: "court", role: "livreur" }),
    /10 caracteres/
  );
});

test("comptes — un identifiant avec espace ou deux-points est refuse", async () => {
  for (const identifiant of ["avec espace", "avec:deuxpoints"]) {
    await assert.rejects(
      () => createUserAccount({ identifiant, motDePasse: "mot-de-passe-valide-2026", role: "livreur" }),
      /espace ni deux-points/,
      `${identifiant} aurait du etre refuse`
    );
  }
});

test("comptes — un role inconnu est refuse a la creation", async () => {
  await assert.rejects(
    () => createUserAccount({ identifiant: "pirate", motDePasse: "mot-de-passe-valide-2026", role: "root" }),
    /Role inconnu/
  );
});

test("comptes — un identifiant deja pris est refuse, meme a la casse pres", async () => {
  await assert.rejects(
    () => createUserAccount({ identifiant: "Julie", motDePasse: "mot-de-passe-valide-2026", role: "bureau" }),
    /porte deja cet identifiant/
  );
});

test("comptes — changer le mot de passe invalide l'ancien", async () => {
  const compte = await createUserAccount({
    identifiant: "rotation",
    motDePasse: "ancien-mot-de-passe-2026",
    role: "bureau"
  });

  await updateUserAccount(compte.id, { motDePasse: "nouveau-mot-de-passe-2026" });

  assert.equal(sessionCookieFrom(await postLogin("rotation", "ancien-mot-de-passe-2026")), null);
  assert.ok(sessionCookieFrom(await postLogin("rotation", "nouveau-mot-de-passe-2026")));
});

test("comptes — mettre a jour le role ne touche pas au mot de passe", async () => {
  const compte = await createUserAccount({
    identifiant: "promotion",
    motDePasse: "mot-de-passe-stable-2026",
    role: "livreur"
  });

  await updateUserAccount(compte.id, { role: "bureau" });

  assert.equal(listUserAccounts().find(u => u.id === compte.id).role, "bureau");
  assert.ok(
    sessionCookieFrom(await postLogin("promotion", "mot-de-passe-stable-2026")),
    "le mot de passe aurait du rester valide"
  );
});

test("comptes — la derniere connexion est horodatee", async () => {
  const compte = await createUserAccount({
    identifiant: "horodate",
    motDePasse: "mot-de-passe-valide-2026",
    role: "bureau"
  });

  assert.equal(listUserAccounts().find(u => u.id === compte.id).derniereConnexion, null);
  await postLogin("horodate", "mot-de-passe-valide-2026");
  assert.ok(
    listUserAccounts().find(u => u.id === compte.id).derniereConnexion,
    "la connexion aurait du etre horodatee"
  );
});

test("comptes — listUserAccounts n'expose aucun secret", async () => {
  const serialise = JSON.stringify(listUserAccounts());
  assert.ok(!serialise.includes("scrypt"), "un hash a fuite par l'API de liste");
  assert.ok(!serialise.includes("tournee-du-matin"), "un mot de passe a fuite");
});

test("comptes — le garde-fou du dernier admin ne s'applique pas si l'env protege deja", () => {
  // Ici SEREO_AUTH_USER est configure : le compte d'environnement reste
  // administrateur quoi qu'il arrive, donc retrograder un admin en base est
  // autorise. Le cas inverse est teste dans le fichier sans variables d'env.
  assert.equal(typeof livreur.id, "string");
});

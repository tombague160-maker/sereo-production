// Garde-fous du 25/09 : droits, purge des bons, sauvegardes manuelles.
//
//   1. « Purger les bons de commande » : administration seulement, et
//      precedee d'une sauvegarde HORS rotation, RELUE, qui contient exactement
//      ce que la purge efface ; sinon la purge est refusee et rien ne part
//      (decision 5).
//   2. « Sauvegarder maintenant » : une limite de frequence, et deja a jour si
//      rien n'a change. Une purge suivie de 30 appels n'evince plus rien (la
//      chasse aux defauts l'a mesure : toutes les sauvegardes remplacees par
//      une base vide).
//
// Configuration : protection par variables d'environnement ACTIVEE et des
// comptes en base (comme la production). Sans authentification, tout visiteur
// serait administrateur : un 403 ne se verrait pas.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { DatabaseSync } = require("node:sqlite");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-garde-fous-droits-"));
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
delete process.env.SEREO_ENABLE_DB_EXPORT;
delete process.env.SEREO_BACKUP_COPY_DIR;

const S = require("../server");
const { app, closeStorage, createUserAccount, defaultDb, readDb, writeDb, _flushPendingBackup, _resetAuthRateLimitForTest } = S;

const DOSSIER = process.env.SEREO_BACKUP_DIR;
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

function appel(chemin, { cookie, method = "GET", body } = {}) {
  return fetch(`${baseUrl}${chemin}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });
}

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await createUserAccount({ identifiant: "julie", motDePasse: "tournee-du-matin-2026", role: "livreur" });
  await createUserAccount({ identifiant: "bureau-gf", motDePasse: "mot-de-passe-bureau-2026", role: "bureau" });
  await createUserAccount({ identifiant: "prepa-gf", motDePasse: "mot-de-passe-prepa-2026", role: "preparateur" });
  cookies.admin = await connecter("admin-env", "mot-de-passe-environnement");
  cookies.livreur = await connecter("julie", "tournee-du-matin-2026");
  cookies.bureau = await connecter("bureau-gf", "mot-de-passe-bureau-2026");
  cookies.preparateur = await connecter("prepa-gf", "mot-de-passe-prepa-2026");
});

after(async () => {
  await _flushPendingBackup();
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function viderLeDossier() {
  fs.rmSync(DOSSIER, { recursive: true, force: true });
  fs.mkdirSync(DOSSIER, { recursive: true });
}

function sauvegardes() {
  return fs.existsSync(DOSSIER) ? fs.readdirSync(DOSSIER).filter(n => /^db-.*\.sqlite\.gz$/.test(n)) : [];
}

// Les identifiants d'une table dans une sauvegarde, lus comme une restauration.
function idsDansLaSauvegarde(nom, table) {
  const copie = path.join(tmpRoot, `relue-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  fs.writeFileSync(copie, zlib.gunzipSync(fs.readFileSync(path.join(DOSSIER, nom))));
  const base = new DatabaseSync(copie, { readOnly: true });
  try {
    return base.prepare(`SELECT id FROM ${table} ORDER BY id`).all().map(r => r.id);
  } finally {
    base.close();
  }
}

// Une base de la forme de la production, en petit : clients, bons, ventes, tournee.
function semerDesBons() {
  const clients = Array.from({ length: 6 }, (_, i) => ({ id: `c-${i}`, nom: `Client ${i}`, rue: `${i} rue A`, codePostal: "39300", ville: "Champagnole", telephone: `03840000${String(i).padStart(2, "0")}` }));
  const commandes = clients.map((c, i) => ({ id: `cmd-${i}`, numero: `CMD-2026-${String(i + 1).padStart(3, "0")}`, clientId: c.id, clientNom: c.nom, status: "livre", dateCommande: "2026-09-01", products: [{ nom: "Changes L", quantite: 2 }] }));
  const ventes = commandes.map((c, i) => ({ id: `v-${i}`, clientId: c.clientId, produit: "Changes L", quantite: 2, montantTTC: 24, date: "2026-09-01" }));
  writeDb({
    ...defaultDb(),
    stock: [{ id: "st-1", code: "CH-L", nom: "Changes L", quantite: 40 }],
    clients,
    commandes,
    ventes,
    routes: [{ id: "r-1", name: "Tournee", status: "terminee", sector: "Champagnole", completedAt: "2026-09-02T16:00:00.000Z", stops: [] }]
  }, { backup: false });
  return { commandes: commandes.map(c => c.id).sort(), clients: clients.map(c => c.id).sort() };
}

// --- 1. Purger les bons de commande ------------------------------------------

test("purge des bons : réservée à l'administration (403 livreur, bureau, préparateur ; rien n'est effacé)", async () => {
  semerDesBons();
  for (const qui of ["livreur", "bureau", "preparateur"]) {
    const refus = await appel("/api/orders/purge", { cookie: cookies[qui], method: "POST" });
    assert.equal(refus.status, 403, `${qui} : la purge aurait du etre refusee`);
  }
  assert.equal(readDb().commandes.length, 6, "un refus a quand meme purge");
});

test("purge des bons : une sauvegarde hors rotation, relue, qui contient ce que la purge efface", async () => {
  const semees = semerDesBons();
  viderLeDossier();
  const reponse = await appel("/api/orders/purge", { cookie: cookies.admin, method: "POST" });
  const corps = await reponse.json();
  assert.equal(reponse.status, 200, JSON.stringify(corps));
  assert.equal(corps.purged.commandes, 6);
  const avant = sauvegardes().filter(n => /-avant-purge-commandes\.sqlite\.gz$/.test(n));
  assert.equal(avant.length, 1, `une sauvegarde « avant-purge-commandes » attendue, trouve : ${sauvegardes().join(", ") || "aucune"}`);
  assert.equal(corps.sauvegarde, avant[0], "la reponse ne nomme pas la sauvegarde");
  assert.deepEqual(idsDansLaSauvegarde(avant[0], "commandes"), semees.commandes, "la sauvegarde n'a pas les bons purges");
  assert.deepEqual(idsDansLaSauvegarde(avant[0], "clients"), semees.clients, "la sauvegarde n'a pas les clients purges");
  // Le journal la nomme.
  const entree = readDb().historique.find(h => h.type === "Purge");
  assert.match(entree.message, new RegExp(avant[0].replace(/[.]/g, "\\.")));
  assert.equal(readDb().commandes.length, 0, "temoin : la purge n'a rien efface");
});

test("purge des bons : si la sauvegarde échoue, la purge est refusée et rien n'est effacé", async () => {
  semerDesBons();
  // Le dossier des sauvegardes devient un FICHIER : toute sauvegarde echoue.
  fs.rmSync(DOSSIER, { recursive: true, force: true });
  fs.writeFileSync(DOSSIER, "pas un dossier");
  let reponse;
  try {
    reponse = await appel("/api/orders/purge", { cookie: cookies.admin, method: "POST" });
  } finally {
    fs.rmSync(DOSSIER, { force: true });
    fs.mkdirSync(DOSSIER, { recursive: true });
  }
  const corps = await reponse.json();
  assert.equal(reponse.status, 503, `la purge est partie sans sauvegarde : ${JSON.stringify(corps)}`);
  // La cause elle-meme : l'echec de la sauvegarde (pas un autre refus).
  assert.match(corps.error, /sauvegarde d.avant purge a échoué/);
  assert.match(corps.error, /Rien n.a été effacé/);
  const db = readDb();
  assert.equal(db.commandes.length, 6, "des bons ont ete effaces");
  assert.equal(db.clients.length, 6, "des clients ont ete effaces");
  assert.equal(db.ventes.length, 6, "des ventes ont ete effacees");
});

test("purge puis 30 « Sauvegarder maintenant » : la sauvegarde d'avant la purge reste, avec les bons", async () => {
  const semees = semerDesBons();
  viderLeDossier();
  assert.equal((await appel("/api/orders/purge", { cookie: cookies.admin, method: "POST" })).status, 200);
  const statuts = [];
  for (let i = 0; i < 30; i++) {
    statuts.push((await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: { tag: "manuelle" } })).status);
  }
  await _flushPendingBackup();
  // Ce qui reste permet de revenir a l'etat d'avant la purge.
  const avecLesBons = sauvegardes().filter(nom => idsDansLaSauvegarde(nom, "commandes").length === semees.commandes.length);
  assert.ok(avecLesBons.length >= 1, `plus aucune sauvegarde ne contient les bons (statuts : ${statuts.join(",")})`);
});

test("purge des bons : si la sauvegarde ne contient pas exactement ce qui serait effacé, rien n'est effacé", async () => {
  semerDesBons();
  viderLeDossier();
  // Une ecriture HORS verrou arrive juste apres la copie (ce que fait une
  // ecriture qui ne passe pas par withWriteLock) : un bon de plus, absent de
  // la sauvegarde. La purge l'effacerait sans filet.
  const base = require("../lib/sauvegarde-base");
  const copierEtVerifier = base.copierEtVerifier;
  base.copierEtVerifier = async (...args) => {
    const resultat = await copierEtVerifier(...args);
    const db = readDb();
    db.commandes.push({ ...db.commandes[0], id: "cmd-glissee", numero: "CMD-2026-099" });
    S.getSqliteStoreForTests().writeDb(db);
    return resultat;
  };
  let reponse;
  try {
    reponse = await appel("/api/orders/purge", { cookie: cookies.admin, method: "POST" });
  } finally {
    base.copierEtVerifier = copierEtVerifier;
  }
  const corps = await reponse.json();
  assert.equal(reponse.status, 503, `la purge est partie : ${JSON.stringify(corps)}`);
  assert.match(corps.error, /ne contient pas exactement/);
  assert.equal(readDb().commandes.length, 7, "des bons ont ete effaces");
});

// --- 2. « Sauvegarder maintenant » ------------------------------------------

function nouvelleSaisie() {
  const db = readDb();
  db.stock[0].quantite = (Number(db.stock[0].quantite) || 0) + 1;
  writeDb(db, { backup: false });
}

test("sauvegarder maintenant : déjà à jour si rien n'a changé depuis la dernière (aucun fichier de plus)", async () => {
  semerDesBons();
  viderLeDossier();
  S._reinitialiserLimiteSauvegardesPourTest?.();
  const premiere = await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: { tag: "manuelle" } });
  assert.equal(premiere.status, 200);
  const avant = sauvegardes();
  assert.equal(avant.length, 1);
  const seconde = await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: { tag: "manuelle" } });
  const corps = await seconde.json();
  assert.equal(seconde.status, 200, JSON.stringify(corps));
  assert.deepEqual(sauvegardes(), avant, "une sauvegarde identique a ete ecrite une seconde fois");
  assert.equal(corps.dejaAJour, true);
  assert.equal(corps.backupPath, avant[0]);
  // Temoin : apres une saisie, une nouvelle part.
  nouvelleSaisie();
  assert.equal((await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: { tag: "manuelle" } })).status, 200);
  assert.equal(sauvegardes().length, 2, "temoin : apres une saisie, aucune nouvelle sauvegarde");
});

test("sauvegarder maintenant : au plus 10 par heure, même avec une saisie entre chaque (503 et Retry-After)", async () => {
  viderLeDossier();
  S._reinitialiserLimiteSauvegardesPourTest?.();
  const statuts = [];
  let refus = null;
  for (let i = 0; i < 12; i++) {
    nouvelleSaisie();
    const reponse = await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: { tag: "manuelle" } });
    statuts.push(reponse.status);
    if (reponse.status !== 200 && !refus) refus = { reponse, corps: await reponse.json() };
  }
  assert.deepEqual(statuts, [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 503, 503]);
  assert.match(refus.corps.error, /Trop de sauvegardes manuelles/);
  const attente = Number(refus.reponse.headers.get("retry-after"));
  assert.ok(attente > 0 && attente <= 3600, `Retry-After ${attente}`);
  assert.equal(sauvegardes().length, 10, "un refus a quand meme ecrit une sauvegarde");
  // Les sauvegardes automatiques, elles, continuent.
  const db = readDb();
  db.stock[0].quantite += 1;
  writeDb(db, { backup: false });
  assert.ok(await S._sauvegarderPourTest(""), "la sauvegarde automatique est bloquee par la limite des manuelles");
});

test("sauvegarder maintenant : le genre « avant-purge-commandes » est réservé (sinon hors rotation, jamais supprimée)", async () => {
  viderLeDossier();
  S._reinitialiserLimiteSauvegardesPourTest?.();
  nouvelleSaisie();
  const reponse = await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: { tag: "avant-purge-commandes" } });
  assert.equal(reponse.status, 200);
  const noms = sauvegardes();
  assert.equal(noms.length, 1);
  assert.doesNotMatch(noms[0], /avant-purge/, "une sauvegarde manuelle s'est donne le genre reserve");
});

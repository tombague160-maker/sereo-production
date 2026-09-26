// Garde-fous du 25/09 : un mot de passe d'environnement de moins de 12
// caracteres se DIT -- au journal du demarrage, et a l'administrateur par
// /api/me (le bandeau de l'ecran le lit) -- SANS refuser de demarrer : un refus
// verrouillerait Thomas hors de son application apres la mise a jour.
// (La chasse aux defauts : le mot de passe de production faisait 5 lettres ;
// les comptes en base en exigent 10.)

const { after, before, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-garde-fous-mdp-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_OSRM_LOCAL = "0";
process.env.SEREO_PURGE_TOURNEES_MOIS = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "admin";
// 11 caracteres : un de moins que le minimum.
const COURT = "motdepasse1";
process.env.SEREO_AUTH_PASSWORD = COURT;
process.env.SEREO_AUTH_MAX_ATTEMPTS = "50";
delete process.env.SEREO_BACKUP_COPY_DIR;

const S = require("../server");
const { closeStorage, createUserAccount, _flushPendingBackup, _resetAuthRateLimitForTest } = S;

let server;
let baseUrl;
const journal = [];

// Le meme vrai demarrage efface les fichiers de travail d'une sauvegarde
// interrompue (reprise du 26/09) : le banc de garde-fous-sauvegardes appelle
// la fonction elle-meme, et restait vert si startServer ne l'appelait plus
// (mutant). Poses AVANT le demarrage, a cote d'un fichier qui n'en est pas un.
const DOSSIER_SAUVEGARDES = process.env.SEREO_BACKUP_DIR;
const RESTES = ["db-2026-09-25T08-00-00-000Z.sqlite.gz.tmp", "db-2026-09-25T08-00-00-000Z.sqlite.gz.travail-copie.sqlite", "db-2026-09-25T08-00-00-000Z.sqlite.gz.travail-verif.sqlite-wal"];
const TEMOIN = "notes.txt";

before(async () => {
  fs.mkdirSync(DOSSIER_SAUVEGARDES, { recursive: true });
  for (const nom of [...RESTES, TEMOIN]) fs.writeFileSync(path.join(DOSSIER_SAUVEGARDES, nom), "x");
  // Le vrai demarrage (startServer), journal capture.
  const warn = mock.method(console, "warn", (...args) => { journal.push(args.join(" ")); });
  const log = mock.method(console, "log", () => {});
  try {
    server = S.startServer(0, "127.0.0.1");
    await once(server, "listening");
  } finally {
    warn.mock.restore();
    log.mock.restore();
  }
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await createUserAccount({ identifiant: "julie", motDePasse: "tournee-du-matin-2026", role: "livreur" });
});

after(async () => {
  await _flushPendingBackup();
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function connexion(identifiant, motDePasse) {
  _resetAuthRateLimitForTest();
  const reponse = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: identifiant, password: motDePasse }),
    redirect: "manual"
  });
  const cookie = (reponse.headers.getSetCookie?.() || []).find(v => v.startsWith("sereo_access="));
  return cookie ? cookie.split(";")[0] : null;
}

test("mot de passe court : le serveur démarre quand même, et la connexion marche", async () => {
  assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
  assert.ok(await connexion("admin", COURT), "le compte d'environnement ne se connecte plus");
});

test("le vrai démarrage efface les fichiers de travail d'une sauvegarde interrompue, et rien d'autre", () => {
  const presents = fs.readdirSync(DOSSIER_SAUVEGARDES);
  assert.deepEqual(RESTES.filter(nom => presents.includes(nom)), [], "fichiers de travail restes apres le demarrage");
  assert.ok(presents.includes(TEMOIN), "temoin : le demarrage a efface un fichier qui n'etait pas a lui");
});

test("mot de passe court : le journal du démarrage l'annonce, sans écrire le mot de passe", () => {
  const ligne = journal.find(l => /SEREO_AUTH_PASSWORD/.test(l) && /12 caract/.test(l));
  assert.ok(ligne, `aucun avertissement au demarrage ; journal : ${JSON.stringify(journal)}`);
  assert.ok(!journal.some(l => l.includes(COURT)), "le journal ecrit le mot de passe");
});

test("mot de passe court : /api/me le dit à l'administrateur, pas aux autres comptes", async () => {
  const admin = await connexion("admin", COURT);
  const moiAdmin = await (await fetch(`${baseUrl}/api/me`, { headers: { cookie: admin } })).json();
  assert.equal(moiAdmin.motDePasseEnvironnementCourt, true);
  const julie = await connexion("julie", "tournee-du-matin-2026");
  const moiJulie = await (await fetch(`${baseUrl}/api/me`, { headers: { cookie: julie } })).json();
  assert.notEqual(moiJulie.motDePasseEnvironnementCourt, true, "un livreur apprend que le mot de passe d'administration est court");
});

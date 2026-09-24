// Carte « Sauvegardes » (decision de Thomas du 24/09) : ce que le serveur doit
// tenir derriere elle.
//
//   1. « Sauvegarder maintenant » et « Telecharger » sont des gestes
//      d'administration : 403 pour un livreur ou un compte bureau.
//   2. La retention garde EN PLUS une sauvegarde par jour pendant 30 jours :
//      les journalieres survivent a la rotation des 30 dernieres. Et elle ne
//      supprime jamais plus qu'avant (les 30 dernieres restent toujours).
//   3. L'etat expose par /api/storage/status : la derniere (date, taille),
//      et l'alerte -- echec, dossier illisible, perimee (plus de 24 h ET une
//      saisie plus recente qu'elle), aucune.
//
// Configuration : protection par variables d'environnement ACTIVEE, et des
// comptes en base (comme la production). Sans authentification, tout visiteur
// serait administrateur : le 403 ne se verrait pas.

const { after, before, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-sauvegardes-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "admin-env";
process.env.SEREO_AUTH_PASSWORD = "mot-de-passe-environnement";
process.env.SEREO_AUTH_MAX_ATTEMPTS = "50";
process.env.SEREO_AUTH_RATE_WINDOW_MS = "60000";
// Le telechargement ne depend PAS de cette variable quand l'authentification
// est active (elle garde /api/db, ouvert a tout compte connecte).
delete process.env.SEREO_ENABLE_DB_EXPORT;

const {
  app,
  closeStorage,
  createUserAccount,
  readDb,
  writeDb,
  _flushPendingBackup,
  _resetAuthRateLimitForTest,
  _resetStorageRecoveryForTest,
  _sauvegardesAGarder
} = require("../server");

const DOSSIER = process.env.SEREO_BACKUP_DIR;
const HEURE = 3600 * 1000;
const JOUR = 24 * HEURE;

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
  const brut = reponse.headers.getSetCookie?.() || [];
  const cookie = brut.find(v => v.startsWith("sereo_access="));
  assert.ok(cookie, `connexion refusee pour ${identifiant}`);
  return cookie.split(";")[0];
}

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  // Une base qui a des donnees (une sauvegarde de vide ne prouverait rien).
  const db = readDb();
  db.stock = [{ id: "st-1", code: "CH-L", nom: "Changes taille L", quantite: 14 }];
  writeDb(db, { backup: false });
  await createUserAccount({ identifiant: "julie", motDePasse: "tournee-du-matin-2026", role: "livreur" });
  await createUserAccount({ identifiant: "bureau-sauv", motDePasse: "mot-de-passe-bureau-2026", role: "bureau" });
  cookies.admin = await connecter("admin-env", "mot-de-passe-environnement");
  cookies.livreur = await connecter("julie", "tournee-du-matin-2026");
  cookies.bureau = await connecter("bureau-sauv", "mot-de-passe-bureau-2026");
});

after(async () => {
  await _flushPendingBackup();
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function appel(chemin, { cookie, method = "GET", body } = {}) {
  return fetch(`${baseUrl}${chemin}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });
}

function fichiers() {
  return fs.existsSync(DOSSIER) ? fs.readdirSync(DOSSIER).filter(n => /^db-/.test(n)).sort() : [];
}

function viderLeDossier() {
  fs.rmSync(DOSSIER, { recursive: true, force: true });
  fs.mkdirSync(DOSSIER, { recursive: true });
}

// La plus recente, par date de modification (la regle du serveur).
function plusRecente() {
  return fichiers()
    .map(nom => ({ nom, t: fs.statSync(path.join(DOSSIER, nom)).mtimeMs }))
    .sort((a, b) => b.t - a.t || b.nom.localeCompare(a.nom))[0];
}

// Un serveur qui ne dit rien des sauvegardes echoue ICI, sur une assertion qui
// le nomme -- pas plus loin, sur un plantage en lisant `undefined`.
async function etat(cookie = cookies.admin) {
  const reponse = await appel("/api/storage/status", { cookie });
  assert.equal(reponse.status, 200);
  const { sauvegardes } = await reponse.json();
  assert.equal(typeof sauvegardes, "object", "/api/storage/status ne dit rien des sauvegardes");
  assert.notEqual(sauvegardes, null, "/api/storage/status ne dit rien des sauvegardes");
  return sauvegardes;
}

// Le jour a Paris d'un instant -- l'oracle du banc, ecrit ici avec Intl, pas
// avec le module qu'il juge.
const PARIS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const jourDeParis = ms => PARIS.format(new Date(ms));

// Un faux fichier de sauvegarde, date de `ms`.
function poser(nom, ms) {
  const chemin = path.join(DOSSIER, nom);
  fs.writeFileSync(chemin, "pas une vraie base");
  fs.utimesSync(chemin, new Date(ms), new Date(ms));
  return nom;
}

// --- 1. Gestes d'administration ----------------------------------------------

test("sauvegarder maintenant : réservé à l'administration (403 livreur et bureau)", async () => {
  viderLeDossier();
  // Temoin positif : l'administrateur sauvegarde.
  const ok = await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: { tag: "manuelle" } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
  const avant = fichiers();
  assert.equal(avant.length, 1, "la sauvegarde de l'administrateur n'est pas sur le disque");

  for (const qui of ["livreur", "bureau"]) {
    const refus = await appel("/api/backup/now", { cookie: cookies[qui], method: "POST", body: { tag: "manuelle" } });
    assert.equal(refus.status, 403, `${qui} : POST /api/backup/now aurait du etre refuse`);
  }
  assert.deepEqual(fichiers(), avant, "un refus a quand meme ecrit une sauvegarde");
});

test("télécharger la dernière : l'administrateur reçoit CE fichier, les autres rien", async () => {
  viderLeDossier();
  const vieille = poser("db-2026-01-01T08-00-00-000Z-ancienne.sqlite.gz", Date.now() - 3 * JOUR);
  const ok = await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: {} });
  assert.equal(ok.status, 200);
  const derniere = plusRecente();
  assert.notEqual(derniere.nom, vieille);

  const reponse = await appel("/api/sauvegardes/derniere", { cookie: cookies.admin });
  assert.equal(reponse.status, 200);
  assert.match(reponse.headers.get("content-disposition") || "", new RegExp(`attachment; filename="${derniere.nom.replace(/[.]/g, "\\.")}"`));
  assert.match(reponse.headers.get("cache-control") || "", /no-store/);
  const recu = Buffer.from(await reponse.arrayBuffer());
  assert.ok(recu.equals(fs.readFileSync(path.join(DOSSIER, derniere.nom))), "le fichier recu n'est pas la derniere sauvegarde");
  assert.equal(recu[0], 0x1f, "pas un gzip");
  assert.equal(recu[1], 0x8b, "pas un gzip");

  for (const qui of ["livreur", "bureau"]) {
    const refus = await appel("/api/sauvegardes/derniere", { cookie: cookies[qui] });
    assert.equal(refus.status, 403, `${qui} : le telechargement aurait du etre refuse`);
    const corps = Buffer.from(await refus.arrayBuffer());
    assert.notEqual(corps[0], 0x1f, `${qui} a recu des octets de la base`);
  }
  const anonyme = await appel("/api/sauvegardes/derniere");
  assert.notEqual(anonyme.status, 200, "sans session, le telechargement aurait du etre refuse");
  assert.notEqual(Buffer.from(await anonyme.arrayBuffer())[0], 0x1f, "sans session, des octets de la base sont partis");
});

test("l'état dit à chacun ce qu'il peut faire", async () => {
  // Une sauvegarde a telecharger : sans elle, « permis » est faux pour tous.
  assert.equal((await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: {} })).status, 200);
  const admin = await etat(cookies.admin);
  assert.equal(admin.administration, true);
  assert.equal(admin.telechargement.permis, true);
  const livreur = await etat(cookies.livreur);
  assert.equal(livreur.administration, false);
  assert.equal(livreur.telechargement.permis, false);
  assert.match(livreur.telechargement.raison, /administrateurs/);
});

// --- 2. Retention -----------------------------------------------------------

test("rétention : la dernière de chaque jour survit à la rotation, 30 jours durant", async () => {
  viderLeDossier();
  _resetStorageRecoveryForTest();
  // 40 jours d'activite, trois sauvegardes par jour (10 h, 14 h, 18 h a Paris
  // l'ete) : 120 fichiers. Les 30 dernieres couvrent a peine dix jours.
  const [a, m, j] = PARIS.format(new Date()).split("-").map(Number);
  const poses = [];
  for (let d = 1; d <= 40; d++) {
    for (const h of [8, 12, 16]) {
      const ms = Date.UTC(a, m - 1, j - d, h, 0, 0);
      poses.push({ nom: poser(`db-${new Date(ms).toISOString().replace(/[:.]/g, "-")}-test.sqlite.gz`, ms), ms, d });
    }
  }
  const ok = await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: {} });
  assert.equal(ok.status, 200);
  const nouvelle = (await ok.json()).backupPath;

  // Attendu, calcule ici : les 30 plus recentes (la nouvelle et 29 posees),
  // plus la derniere de chaque jour des 29 jours d'avant (aujourd'hui compte
  // pour le 30e, et la nouvelle en est la derniere).
  const parRecence = [...poses].sort((x, y) => y.ms - x.ms);
  const attendu = new Set([nouvelle, ...parRecence.slice(0, 29).map(p => p.nom)]);
  for (let d = 1; d <= 29; d++) attendu.add(parRecence.find(p => p.d === d).nom);
  const restants = new Set(fichiers());

  const joursSansSauvegarde = [];
  for (let d = 1; d <= 29; d++) {
    const jour = jourDeParis(Date.UTC(a, m - 1, j - d, 12));
    if (![...restants].some(nom => poses.find(p => p.nom === nom && jourDeParis(p.ms) === jour))) joursSansSauvegarde.push(d);
  }
  assert.deepEqual(joursSansSauvegarde, [], "jours (en arriere) qui n'ont plus aucune sauvegarde");
  assert.deepEqual([...restants].sort(), [...attendu].sort());
  // Au-dela de 30 jours, plus de journaliere : la rotation reprend ses droits.
  assert.equal(poses.filter(p => p.d >= 30 && restants.has(p.nom)).length, 0);
});

test("rétention : jamais plus agressive qu'avant (les 30 dernières restent, même vieilles)", async () => {
  // Un mois et demi sans activite : les 35 sauvegardes ont toutes plus de 30
  // jours. L'ancienne regle en gardait 30 ; la nouvelle aussi, les memes.
  const maintenant = new Date();
  const vieilles = Array.from({ length: 35 }, (_, i) => ({ name: `db-vieille-${String(i).padStart(2, "0")}.sqlite.gz`, mtimeMs: maintenant.getTime() - (45 + i) * JOUR }));
  assert.deepEqual([..._sauvegardesAGarder(vieilles, maintenant)].sort(), vieilles.slice(0, 30).map(e => e.name).sort());

  // Et quel que soit le melange : l'ensemble garde contient les 30 plus recentes.
  let graine = 7;
  const hasard = () => (graine = (graine * 48271) % 2147483647) / 2147483647;
  for (let essai = 0; essai < 50; essai++) {
    const entrees = Array.from({ length: 20 + Math.floor(hasard() * 80) }, (_, i) => ({ name: `db-${essai}-${i}.sqlite.gz`, mtimeMs: maintenant.getTime() - hasard() * 90 * JOUR }))
      .sort((x, y) => y.mtimeMs - x.mtimeMs);
    const garder = _sauvegardesAGarder(entrees, maintenant);
    for (const e of entrees.slice(0, 30)) assert.ok(garder.has(e.name), `essai ${essai} : ${e.name} (parmi les 30 dernieres) serait supprimee`);
  }
});

// --- 3. L'etat et ses alertes ----------------------------------------------

test("état : la dernière sauvegarde, sa date et sa taille, lues sur le disque", async () => {
  viderLeDossier();
  _resetStorageRecoveryForTest();
  const ok = await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: {} });
  assert.equal(ok.status, 200);
  const derniere = plusRecente();
  const s = await etat();
  assert.equal(s.derniere.nom, derniere.nom);
  assert.equal(s.derniere.taille, fs.statSync(path.join(DOSSIER, derniere.nom)).size);
  assert.equal(Date.parse(s.derniere.date), Math.floor(derniere.t));
  assert.equal(s.nombre, 1);
  assert.equal(s.alerte, null);
});

test("état : une sauvegarde vieille de 2 jours n'alerte que si une saisie est plus récente", async () => {
  viderLeDossier();
  _resetStorageRecoveryForTest();
  poser("db-2026-01-01T08-00-00-000Z-vieille.sqlite.gz", Date.now() - 2 * JOUR);
  // Temoin : sans saisie depuis (un week-end sans activite), rien a signaler.
  assert.equal((await etat()).alerte, null);

  // Une saisie qui ne declenche pas de sauvegarde (comme la purge des
  // tournees, apres la sienne) : elle n'est dans aucune.
  writeDb(readDb(), { backup: false });
  const s = await etat();
  assert.equal(s.alerte?.type, "perimee");
  assert.ok(Math.abs(Date.parse(s.alerte.depuis) - Date.now()) < 60 * 1000, "la date de la saisie non sauvegardee est fausse");

  // Moins de 24 h : pas encore une alerte.
  viderLeDossier();
  poser("db-2026-01-01T08-00-00-000Z-recente.sqlite.gz", Date.now() - 23 * HEURE);
  writeDb(readDb(), { backup: false });
  assert.equal((await etat()).alerte, null);

  // « Sauvegarder maintenant » couvre la saisie : l'alerte part.
  viderLeDossier();
  poser("db-2026-01-01T08-00-00-000Z-vieille.sqlite.gz", Date.now() - 2 * JOUR);
  writeDb(readDb(), { backup: false });
  assert.equal((await etat()).alerte?.type, "perimee");
  assert.equal((await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: {} })).status, 200);
  assert.equal((await etat()).alerte, null);
});

test("état : une horloge de fichiers à la seconde ne fait pas une fausse alerte", async () => {
  // La saisie a eu lieu il y a 25 h (horloge du processus deplacee le temps de
  // l'ecriture), et sa sauvegarde est datee d'UNE seconde AVANT elle : c'est
  // ce que rend un systeme de fichiers qui arrondit a la seconde (ou a deux).
  // Elle la couvre ; pas d'alerte. A TROIS secondes avant, elle ne la couvre
  // plus : l'alerte est la (temoin).
  const saisie = Date.now() - 25 * HEURE;
  const ecrire = () => {
    mock.timers.enable({ apis: ["Date"], now: saisie });
    try { writeDb(readDb(), { backup: false }); } finally { mock.timers.reset(); }
  };
  viderLeDossier();
  _resetStorageRecoveryForTest();
  ecrire();
  poser("db-2026-01-01T08-00-00-000Z-arrondie.sqlite.gz", saisie - 1000);
  assert.equal((await etat()).alerte, null);

  viderLeDossier();
  poser("db-2026-01-01T08-00-00-000Z-avant.sqlite.gz", saisie - 3000);
  assert.equal((await etat()).alerte?.type, "perimee");
});

test("état : un échec de sauvegarde se dit, et un dossier illisible ne fait pas un 500", async () => {
  viderLeDossier();
  _resetStorageRecoveryForTest();
  // Le dossier des sauvegardes devient un FICHIER : la prochaine sauvegarde
  // automatique echoue (disque en panne, montage perdu...).
  const cache = `${DOSSIER}.ecarte`;
  fs.renameSync(DOSSIER, cache);
  fs.writeFileSync(DOSSIER, "pas un dossier");
  try {
    writeDb(readDb());
    await _flushPendingBackup();
    const illisible = await etat();
    assert.equal(illisible.alerte?.type, "lecture");
  } finally {
    fs.rmSync(DOSSIER, { force: true });
    fs.renameSync(cache, DOSSIER);
  }
  // Le dossier revenu, l'echec reste dit tant qu'aucune sauvegarde n'a reussi.
  const echec = await etat();
  assert.equal(echec.alerte?.type, "echec");
  assert.ok(echec.alerte.message, "le message de l'echec manque");
  assert.equal((await appel("/api/backup/now", { cookie: cookies.admin, method: "POST", body: {} })).status, 200);
  assert.equal((await etat()).alerte, null);
});

test("état : aucune sauvegarde, c'est une alerte", async () => {
  viderLeDossier();
  _resetStorageRecoveryForTest();
  assert.equal((await etat()).alerte?.type, "aucune");
});

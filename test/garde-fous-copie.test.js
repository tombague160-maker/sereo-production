// Garde-fous du 25/09, decision 3 : un second dossier de sauvegarde optionnel.
//
// SEREO_BACKUP_COPY_DIR pose : chaque sauvegarde y est AUSSI copiee, relue
// (meme empreinte que l'originale), a la meme date, et ce dossier suit la meme
// retention. Une copie qui echoue ne fait pas echouer la sauvegarde : elle se
// dit (alerte « copie » de /api/storage/status). Variable absente : rien ne
// change (test/garde-fous-sauvegardes.test.js tourne sans elle).

const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-garde-fous-copie-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_OSRM_LOCAL = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_BACKUP_COPY_DIR = path.join(tmpRoot, "autre-disque", "sereo-sauvegardes");
delete process.env.SEREO_AUTH_USER;
delete process.env.SEREO_AUTH_PASSWORD;

const S = require("../server");
const { app, readDb, writeDb, closeStorage, _flushPendingBackup } = S;

const PREMIER = process.env.SEREO_BACKUP_DIR;
const SECOND = process.env.SEREO_BACKUP_COPY_DIR;
const JOUR = 24 * 3600 * 1000;

after(async () => {
  await _flushPendingBackup();
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const empreinte = chemin => crypto.createHash("sha256").update(fs.readFileSync(chemin)).digest("hex");
const liste = dossier => (fs.existsSync(dossier) ? fs.readdirSync(dossier).sort() : []);

// Le fichier temoin que Thomas pose sur l'autre disque (relecture du 26/09) :
// sans lui, rien n'est copie (un disque demonte laisse un dossier vide).
const TEMOIN = "sereo-second-dossier";

function vider(dossier, { temoin = dossier === SECOND } = {}) {
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  if (temoin) fs.writeFileSync(path.join(dossier, TEMOIN), "");
}

// Les sauvegardes d'un dossier, sans le temoin.
const sauvegardes = dossier => liste(dossier).filter(nom => nom !== TEMOIN);

async function etat() {
  const { once } = require("node:events");
  const serveur = app.listen(0);
  await once(serveur, "listening");
  try {
    const reponse = await fetch(`http://127.0.0.1:${serveur.address().port}/api/storage/status`);
    return (await reponse.json()).sauvegardes;
  } finally {
    await new Promise(r => serveur.close(r));
  }
}

function saisie() {
  const db = readDb();
  db.stock = [{ id: "st-1", code: "CH-L", nom: "Changes L", quantite: Date.now() % 1000 }];
  writeDb(db, { backup: false });
}

// Relecture adverse du 26/09 : apres un redemarrage, un disque qui n'est pas
// revenu laisse un dossier vide. Le vrai demarrage le dit avant toute sauvegarde
// (une sauvegarde n'arrive qu'apres une ecriture).
test("au démarrage, un second dossier sans témoin se dit tout de suite, sans attendre une sauvegarde", async () => {
  vider(PREMIER);
  vider(SECOND, { temoin: false });
  const { mock } = require("node:test");
  const { once } = require("node:events");
  const warn = mock.method(console, "warn", () => {});
  const log = mock.method(console, "log", () => {});
  let serveur;
  try {
    serveur = S.startServer(0, "127.0.0.1");
    await once(serveur, "listening");
    const url = `http://127.0.0.1:${serveur.address().port}/api/storage/status`;
    let s = null;
    for (let i = 0; i < 40; i++) {
      s = (await (await fetch(url)).json()).sauvegardes;
      if (s.alerte?.type === "copie") break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(s.alerte?.type, "copie", `au demarrage, rien ne dit que le second dossier n'est pas le bon : ${JSON.stringify(s.alerte)}`);
    assert.match(s.alerte.message, /témoin/);
    assert.ok(warn.mock.calls.some(c => /second dossier/.test(c.arguments.join(" "))), "le journal du demarrage ne le dit pas");
  } finally {
    warn.mock.restore();
    log.mock.restore();
    if (serveur) await new Promise(r => serveur.close(r));
  }
});

test("chaque sauvegarde est aussi copiée dans le second dossier : mêmes octets, même date", async () => {
  vider(PREMIER);
  vider(SECOND);
  saisie();
  const chemin = await S._sauvegarderPourTest("");
  assert.ok(chemin, "prealable : aucune sauvegarde");
  const nom = path.basename(chemin);
  assert.deepEqual(sauvegardes(SECOND), [nom], "la sauvegarde n'est pas dans le second dossier");
  assert.equal(empreinte(path.join(SECOND, nom)), empreinte(chemin), "la copie n'a pas les memes octets");
  assert.equal(Math.floor(fs.statSync(path.join(SECOND, nom)).mtimeMs / 1000), Math.floor(fs.statSync(chemin).mtimeMs / 1000), "la copie n'a pas la date de l'originale");
  const s = await etat();
  assert.equal(s.copie?.active, true);
  assert.equal(s.copie?.derniere?.nom, nom);
  assert.equal(s.alerte, null);
});

test("le second dossier suit la même rétention que le premier", async () => {
  vider(PREMIER);
  vider(SECOND);
  // 45 vieilles sauvegardes (de 40 a 85 jours) dans les deux dossiers.
  const maintenant = Date.now();
  for (let i = 0; i < 45; i++) {
    const ms = maintenant - (40 + i) * JOUR;
    const nom = `db-${new Date(ms).toISOString().replace(/[:.]/g, "-")}.sqlite.gz`;
    for (const dossier of [PREMIER, SECOND]) {
      fs.writeFileSync(path.join(dossier, nom), "vieille");
      fs.utimesSync(path.join(dossier, nom), new Date(ms), new Date(ms));
    }
  }
  saisie();
  await S._sauvegarderPourTest("");
  assert.ok(liste(PREMIER).length < 46, "prealable : la rotation n'a rien supprime dans le premier dossier");
  assert.deepEqual(sauvegardes(SECOND), liste(PREMIER), "le second dossier ne garde pas les memes sauvegardes");
});

test("une copie qui échoue ne fait pas échouer la sauvegarde, et se dit", async () => {
  vider(PREMIER);
  // Le second dossier devient un FICHIER : la copie echoue (disque demonte).
  fs.rmSync(SECOND, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(SECOND), { recursive: true });
  fs.writeFileSync(SECOND, "pas un dossier");
  try {
    saisie();
    const chemin = await S._sauvegarderPourTest("");
    assert.ok(chemin && fs.existsSync(chemin), "la sauvegarde elle-meme a echoue");
    const s = await etat();
    assert.equal(s.alerte?.type, "copie", `alerte : ${JSON.stringify(s.alerte)}`);
    assert.ok(s.alerte.message, "le message de l'echec de la copie manque");
  } finally {
    fs.rmSync(SECOND, { force: true });
  }
  // Le dossier revenu, la copie suivante reussit et l'alerte part.
  vider(SECOND);
  saisie();
  await S._sauvegarderPourTest("");
  assert.equal((await etat()).alerte, null);
});

// Relecture adverse du 26/09 : le disque demonte, Docker lie (ou cree) un
// dossier VIDE du disque systeme a la place du montage. Avant, la copie y
// atterrissait sans bruit (le dossier etait meme recree s'il manquait) et la
// carte disait « dans le second dossier ».
test("disque démonté : un second dossier sans témoin ne reçoit rien, n'est pas créé, et la carte le dit", async () => {
  vider(PREMIER);
  vider(SECOND, { temoin: false });
  saisie();
  const chemin = await S._sauvegarderPourTest("");
  assert.ok(chemin && fs.existsSync(chemin), "la sauvegarde elle-meme a echoue");
  assert.deepEqual(liste(SECOND), [], "une copie a atterri dans le dossier vide d'un disque demonte");
  const s = await etat();
  assert.equal(s.alerte?.type, "copie", `alerte : ${JSON.stringify(s.alerte)}`);
  assert.match(s.alerte.message, /témoin/);
  assert.notEqual(s.copie?.derniere?.nom, path.basename(chemin), "la carte donne pour copiee une sauvegarde qui ne l'est pas");
  // Le dossier absent : il n'est pas cree (il le serait sur le disque systeme).
  fs.rmSync(SECOND, { recursive: true, force: true });
  saisie();
  await S._sauvegarderPourTest("");
  assert.equal(fs.existsSync(SECOND), false, "le second dossier absent a ete cree");
  assert.equal((await etat()).alerte?.type, "copie");
  // Temoin : le disque revenu (son temoin avec lui), la copie reprend et l'alerte part.
  vider(SECOND);
  saisie();
  const suivante = await S._sauvegarderPourTest("");
  assert.deepEqual(sauvegardes(SECOND), [path.basename(suivante)]);
  assert.equal((await etat()).alerte, null);
});

test("une copie abîmée en route n'est pas gardée : la relecture la refuse, et le dit", async () => {
  vider(PREMIER);
  vider(SECOND);
  // La copie arrive avec un octet change (disque, cable, partage reseau).
  const copyFile = fs.promises.copyFile;
  fs.promises.copyFile = async (source, cible, ...reste) => {
    await copyFile.call(fs.promises, source, cible, ...reste);
    const octets = fs.readFileSync(cible);
    octets[octets.length >> 1] ^= 0xff;
    fs.writeFileSync(cible, octets);
  };
  try {
    saisie();
    const chemin = await S._sauvegarderPourTest("");
    assert.ok(chemin && fs.existsSync(chemin), "la sauvegarde elle-meme a echoue");
    assert.deepEqual(sauvegardes(SECOND), [], "une copie abimee est gardee dans le second dossier");
    const s = await etat();
    assert.equal(s.alerte?.type, "copie");
    assert.match(s.alerte.message, /empreinte/);
  } finally {
    fs.promises.copyFile = copyFile;
  }
});

// Relecture adverse du 26/09 : « Purger les bons » attendait la copie vers le
// second dossier (copie puis relecture complete) SOUS le verrou d'ecriture. Un
// partage reseau lent -- ou bloque, sur un montage « hard » -- suspendait les
// « Livre » et les saisies des autres comptes. La copie se fait verrou rendu.
test("purge des bons : la copie vers un second dossier bloqué ne retient pas les écritures des autres", async () => {
  const { once } = require("node:events");
  vider(PREMIER);
  vider(SECOND);
  saisie();
  // Le partage ne repond plus : la copie vers le second dossier attend.
  const copyFile = fs.promises.copyFile;
  let liberer;
  const partage = new Promise(r => { liberer = r; });
  let signaler;
  const copieCommencee = new Promise(r => { signaler = r; });
  // Seule la copie de la sauvegarde d'avant purge est retenue.
  fs.promises.copyFile = async (source, cible, ...reste) => {
    const vers = path.resolve(String(cible));
    if (vers.startsWith(path.resolve(SECOND)) && /-avant-purge-commandes\./.test(path.basename(vers))) {
      signaler();
      await partage;
    }
    return copyFile.call(fs.promises, source, cible, ...reste);
  };
  const serveur = app.listen(0);
  await once(serveur, "listening");
  const base = `http://127.0.0.1:${serveur.address().port}`;
  let purge = null;
  let ecriture = null;
  let statutPurge = null;
  try {
    purge = fetch(`${base}/api/orders/purge`, { method: "POST" });
    // Borne : une copie qui ne part jamais fait rougir le banc, pas l'attendre sans fin.
    const partie = await Promise.race([copieCommencee.then(() => true), new Promise(r => setTimeout(() => r(false), 10000))]);
    assert.ok(partie, "la copie de la sauvegarde d'avant purge vers le second dossier n'a jamais commence");
    // Un autre compte ajuste le stock pendant ce temps.
    ecriture = fetch(`${base}/api/stock/st-1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quantite: 3, reason: "banc" })
    });
    const verdict = await Promise.race([
      ecriture.then(r => r.status),
      new Promise(r => setTimeout(() => r("bloquee"), 3000))
    ]);
    assert.equal(verdict, 200, "une ecriture attend la copie de la purge vers le second dossier (verrou d'ecriture tenu)");
  } finally {
    liberer();
    fs.promises.copyFile = copyFile;
    const reponses = await Promise.all([purge, ecriture].filter(Boolean));
    for (const r of reponses) await r.arrayBuffer();
    statutPurge = reponses[0]?.status;
    await _flushPendingBackup();
    await new Promise(r => serveur.close(r));
  }
  assert.equal(statutPurge, 200, "temoin : la purge a echoue");
  // Le partage revenu, la sauvegarde d'avant purge est bien copiee.
  const avantPurge = liste(PREMIER).filter(n => /-avant-purge-commandes\.sqlite\.gz$/.test(n));
  assert.equal(avantPurge.length, 1, `prealable : ${liste(PREMIER).join(", ")}`);
  assert.ok(sauvegardes(SECOND).includes(avantPurge[0]), "la sauvegarde d'avant purge n'est pas copiee dans le second dossier");
  assert.equal(empreinte(path.join(SECOND, avantPurge[0])), empreinte(path.join(PREMIER, avantPurge[0])));
});

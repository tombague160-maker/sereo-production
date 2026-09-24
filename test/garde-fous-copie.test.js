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

function vider(dossier) {
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
}

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

test("chaque sauvegarde est aussi copiée dans le second dossier : mêmes octets, même date", async () => {
  vider(PREMIER);
  vider(SECOND);
  saisie();
  const chemin = await S._sauvegarderPourTest("");
  assert.ok(chemin, "prealable : aucune sauvegarde");
  const nom = path.basename(chemin);
  assert.deepEqual(liste(SECOND), [nom], "la sauvegarde n'est pas dans le second dossier");
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
  assert.deepEqual(liste(SECOND), liste(PREMIER), "le second dossier ne garde pas les memes sauvegardes");
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
  fs.mkdirSync(SECOND, { recursive: true });
  saisie();
  await S._sauvegarderPourTest("");
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
    assert.deepEqual(liste(SECOND), [], "une copie abimee est gardee dans le second dossier");
    const s = await etat();
    assert.equal(s.alerte?.type, "copie");
    assert.match(s.alerte.message, /empreinte/);
  } finally {
    fs.promises.copyFile = copyFile;
  }
});

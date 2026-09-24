// Garde-fous du 25/09 : des sauvegardes COHERENTES, VERIFIEES, et une purge
// qui ne se fie qu'a une sauvegarde relue.
//
//   1. Une sauvegarde prise pendant des ecritures qui checkpointent le WAL
//      (un gros import) est un instantane coherent : integrity_check « ok », et
//      toutes ses lignes datent de la MEME ecriture. Avant : le fichier
//      principal etait lu en flux pendant que le checkpoint le reecrivait (la
//      chasse aux defauts : « database disk image is malformed », 2 fois sur 2).
//   2. La purge des tournees ne part que si la sauvegarde « avant-purge » se
//      relit et contient chaque tournee sous sa forme actuelle. Avant : un
//      chemin de fichier rendu suffisait, meme illisible.
//
// Le banc 1 rend l'entrelacement DETERMINISTE sur l'ancien code : la lecture en
// flux du fichier de la base est retenue apres son premier morceau, le temps
// d'ecrire et de checkpointer. Le nouveau code ne lit plus ce fichier en flux
// (copie par VACUUM INTO dans un thread de travail) : la retenue ne s'applique
// pas, et les ecritures courent en vrai pendant la copie.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { PassThrough } = require("node:stream");
const { DatabaseSync } = require("node:sqlite");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-garde-fous-sauv-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_OSRM_LOCAL = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_PURGE_TOURNEES_MOIS = "12";
delete process.env.SEREO_AUTH_USER;
delete process.env.SEREO_AUTH_PASSWORD;
delete process.env.SEREO_BACKUP_COPY_DIR;

const S = require("../server");
const { defaultDb, readDb, writeDb, closeStorage, _flushPendingBackup } = S;

const DOSSIER = process.env.SEREO_BACKUP_DIR;
const BASE = path.resolve(process.env.SEREO_SQLITE_PATH);

after(async () => {
  await _flushPendingBackup();
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

// Ouvre une sauvegarde comme une restauration : decompression, ouverture.
function ouvrir(nom) {
  const copie = path.join(tmpRoot, `relue-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  fs.writeFileSync(copie, zlib.gunzipSync(fs.readFileSync(path.join(DOSSIER, nom))));
  return new DatabaseSync(copie);
}

// --- 1. Une sauvegarde coherente pendant un gros import ---------------------

// Une base de quelques Mo : 3 000 lignes d'historique, toutes de la revision 0.
function semerHistorique(revision) {
  const db = readDb();
  db.historique = Array.from({ length: 3000 }, (_, i) => ({
    id: `h-${String(i).padStart(5, "0")}`,
    date: new Date(Date.UTC(2026, 8, 1, 8, 0, i % 60)).toISOString(),
    type: "Stock",
    message: `rev ${revision} ` + "x".repeat(300)
  }));
  return db;
}

// Une ecriture qui touche beaucoup de pages, puis un checkpoint : le fichier
// principal est reecrit (ce que fait l'auto-checkpoint a 1 000 pages pendant
// un import).
function grosseEcriture(revision) {
  const db = readDb();
  db.historique.forEach(h => { h.message = `rev ${revision} ` + "y".repeat(300); });
  writeDb(db, { backup: false });
  S.getSqliteStoreForTests().checkpoint();
}

test("une sauvegarde prise pendant des écritures qui checkpointent est cohérente (integrity_check, une seule révision)", async () => {
  viderLeDossier();
  writeDb(semerHistorique(0), { backup: false });
  S.getSqliteStoreForTests().checkpoint();

  // La lecture en flux du fichier de la base (l'ancien chemin) est retenue
  // apres son premier morceau.
  let atteinte = false;
  let liberer;
  const liberation = new Promise(r => { liberer = r; });
  const createReadStream = fs.createReadStream;
  fs.createReadStream = function (chemin, ...reste) {
    const flux = createReadStream.call(this, chemin, ...reste);
    if (typeof chemin !== "string" || path.resolve(chemin) !== BASE) return flux;
    atteinte = true;
    const sortie = new PassThrough();
    let premier = true;
    flux.on("data", morceau => {
      sortie.write(morceau);
      if (premier) {
        premier = false;
        flux.pause();
        liberation.then(() => flux.resume());
      }
    });
    flux.on("end", () => sortie.end());
    flux.on("error", error => sortie.destroy(error));
    return sortie;
  };

  let revisions = 0;
  try {
    // Une saisie : la sauvegarde automatique part (aucune dans l'heure).
    const db = readDb();
    db.historique[0].message = "rev 0 " + "x".repeat(300);
    writeDb(db);
    let finie = false;
    const fin = _flushPendingBackup().then(() => { finie = true; });
    // Pendant la copie : de grosses ecritures, chacune suivie d'un checkpoint.
    while (!finie && revisions < 6) {
      await new Promise(r => setImmediate(r));
      revisions += 1;
      grosseEcriture(revisions);
      if (atteinte && revisions >= 2) liberer();
    }
    liberer();
    await fin;
  } finally {
    fs.createReadStream = createReadStream;
    liberer();
  }
  assert.ok(revisions >= 1, "prealable : aucune ecriture n'a couru pendant la sauvegarde");

  const noms = sauvegardes();
  assert.equal(noms.length, 1, `une sauvegarde attendue, trouve : ${noms.join(", ")}`);
  let base;
  try {
    base = ouvrir(noms[0]);
  } catch (error) {
    assert.fail(`la sauvegarde ne s'ouvre pas : ${error.message}`);
  }
  let integrite;
  let lues;
  try {
    integrite = base.prepare("PRAGMA integrity_check").all().map(r => Object.values(r)[0]);
    lues = base.prepare("SELECT payload FROM historique").all().map(r => JSON.parse(r.payload).message.split(" ").slice(0, 2).join(" "));
  } catch (error) {
    assert.fail(`la sauvegarde est illisible : ${error.message}`);
  } finally {
    base.close();
  }
  assert.deepEqual(integrite, ["ok"], "integrity_check de la sauvegarde");
  const melange = [...new Set(lues)];
  assert.equal(melange.length, 1, `la sauvegarde melange des ecritures differentes : ${melange.join(", ")}`);
  assert.equal(lues.length, 3000, "la sauvegarde n'a pas toutes les lignes");
  // Aucun fichier de travail ne reste.
  assert.deepEqual(fs.readdirSync(DOSSIER).filter(n => !/^db-.*\.sqlite\.gz$/.test(n)), [], "des fichiers de travail sont restes");
});

// La relecture est une vraie barriere : quand elle echoue, aucun fichier ne
// porte le nom de la sauvegarde, et aucun fichier de travail ne reste.
test("une copie qui ne se relit pas ne devient jamais une sauvegarde (aucun fichier final, aucun reste)", async () => {
  const { copierEtVerifier } = require("../lib/sauvegarde-base");
  const dossier = fs.mkdtempSync(path.join(tmpRoot, "verif-"));
  // Une vraie base, de quelques centaines de Ko.
  const source = path.join(dossier, "source.sqlite");
  const base = new DatabaseSync(source);
  base.exec("CREATE TABLE commandes (id TEXT PRIMARY KEY, payload TEXT)");
  const inserer = base.prepare("INSERT INTO commandes VALUES (?, ?)");
  base.exec("BEGIN");
  for (let i = 0; i < 2000; i++) inserer.run(`c-${i}`, "z".repeat(200));
  base.exec("COMMIT");
  base.close();

  // Temoin : la copie d'une base saine est ecrite, relue, et comptee.
  const bonne = path.join(dossier, "db-bonne.sqlite.gz");
  const releve = await copierEtVerifier({ source, destination: bonne, tables: ["commandes"] });
  assert.ok(fs.existsSync(bonne));
  assert.equal(releve.comptes.commandes, 2000);

  // 1. La relecture echoue (decompression au-dela du plafond) : rien de final.
  const plafond = path.join(dossier, "db-plafond.sqlite.gz");
  await assert.rejects(copierEtVerifier({ source, destination: plafond, tables: ["commandes"], maxOctets: 4096 }), /plafond/);
  assert.equal(fs.existsSync(plafond), false, "une copie non relue porte le nom d'une sauvegarde");

  // 2. La source est abimee (des pages ecrasees) : rien de final non plus.
  const abimee = path.join(dossier, "abimee.sqlite");
  const octets = fs.readFileSync(source);
  octets.fill(0x5a, 8192, 8192 + 64 * 1024);
  fs.writeFileSync(abimee, octets);
  const destination = path.join(dossier, "db-abimee.sqlite.gz");
  await assert.rejects(copierEtVerifier({ source: abimee, destination, tables: ["commandes"] }));
  assert.equal(fs.existsSync(destination), false, "la copie d'une base abimee porte le nom d'une sauvegarde");

  const restes = fs.readdirSync(dossier).filter(n => !["source.sqlite", "abimee.sqlite", "db-bonne.sqlite.gz"].includes(n));
  assert.deepEqual(restes, [], "des fichiers de travail sont restes");
});

test("au démarrage, les fichiers de travail d'une sauvegarde interrompue sont effacés, et rien d'autre", () => {
  viderLeDossier();
  const restes = ["db-2026-09-25T08-00-00-000Z.sqlite.gz.tmp", "db-2026-09-25T08-00-00-000Z.sqlite.gz.travail-copie.sqlite", "db-2026-09-25T08-00-00-000Z.sqlite.gz.travail-verif.sqlite-wal"];
  const gardes = ["db-2026-09-24T08-00-00-000Z.sqlite.gz", "notes.txt"];
  for (const nom of [...restes, ...gardes]) fs.writeFileSync(path.join(DOSSIER, nom), "x");
  S._nettoyerSauvegardesInterrompues();
  assert.deepEqual(fs.readdirSync(DOSSIER).sort(), gardes.sort());
});

// --- 2. La purge des tournees relit sa sauvegarde ---------------------------

const MAINTENANT = new Date("2026-09-23T10:00:00.000Z");

function semerPourPurge() {
  const client = { id: "c1", nom: "Client", rue: "1 rue A", codePostal: "39300", ville: "Champagnole" };
  const commande = (id, status) => ({ id, numero: id.toUpperCase(), clientId: "c1", clientNom: "Client", status, dateCommande: "2025-08-20", products: [{ nom: "Changes L", quantite: 1 }] });
  const tournee = (id, status, extra) => ({ id, name: id, status, sector: "Champagnole", stops: [{ id: `stop-${id}`, clientId: "c1", orderIds: [`cmd-${id}`], status: "livree" }], ...extra });
  writeDb({
    ...defaultDb(),
    clients: [client],
    commandes: [commande("cmd-vieille", "livre"), commande("cmd-recente", "livre")],
    routes: [
      tournee("vieille", "terminee", { completedAt: "2025-08-20T16:00:00.000Z", deliveryDate: "2025-08-20" }),
      tournee("recente", "terminee", { completedAt: "2025-10-01T16:00:00.000Z", deliveryDate: "2025-10-01" })
    ]
  }, { backup: false });
}

test("purge des tournées : une sauvegarde qui ne se relit pas n'autorise rien", async () => {
  semerPourPurge();
  viderLeDossier();
  // Un fichier est bien rendu, a son nom de sauvegarde, mais il est illisible.
  const illisible = path.join(DOSSIER, "db-2026-09-23T10-00-00-000Z-avant-purge.sqlite.gz");
  fs.writeFileSync(illisible, zlib.gzipSync(Buffer.from("pas une base SQLite")));
  const resultat = await S.purgerTourneesAnciennes({ maintenant: MAINTENANT, sauvegarder: async () => illisible });
  assert.equal(resultat.purgees, 0, "la purge est partie sur une sauvegarde illisible");
  assert.ok(readDb().routes.some(r => r.id === "vieille"), "la tournee a ete effacee");
  // Temoin : avec la vraie sauvegarde, la meme purge part.
  const vraie = await S.purgerTourneesAnciennes({ maintenant: MAINTENANT });
  assert.equal(vraie.purgees, 1, `temoin : la purge n'est pas partie (${vraie.raison || ""})`);
});

test("purge des tournées : une sauvegarde abîmée AILLEURS que dans ses tournées n'autorise rien", async () => {
  // Les tournees s'y lisent, mais la base ne se restaurerait pas : la purge ne
  // doit pas effacer sur la foi d'une sauvegarde qui ne sert a rien.
  semerPourPurge();
  const db = readDb();
  db.historique = Array.from({ length: 4000 }, (_, i) => ({ id: `h-${i}`, date: "2026-09-01T08:00:00.000Z", type: "Stock", message: "m".repeat(300) }));
  writeDb(db, { backup: false });
  viderLeDossier();
  const saine = await S._sauvegarderPourTest("avant-purge");
  const brut = zlib.gunzipSync(fs.readFileSync(saine));
  // Les derniers 64 Ko : des pages de l'historique, loin des tournees.
  brut.fill(0x5a, brut.length - 64 * 1024, brut.length - 1024);
  const abimee = saine.replace(/\.sqlite\.gz$/, "-abimee.sqlite.gz");
  fs.writeFileSync(abimee, zlib.gzipSync(brut));
  // Prealable : les tournees s'y lisent encore (sinon ce cas redirait le precedent).
  const copie = path.join(tmpRoot, "abimee-lue.sqlite");
  fs.writeFileSync(copie, brut);
  const lecture = new DatabaseSync(copie, { readOnly: true });
  let ids;
  let integrite;
  try {
    ids = lecture.prepare("SELECT id FROM routes").all().map(r => r.id);
    try {
      integrite = lecture.prepare("PRAGMA integrity_check").all().map(r => Object.values(r)[0]);
    } catch (error) {
      integrite = [error.message];
    }
  } finally {
    lecture.close();
  }
  assert.ok(ids.includes("vieille"), "prealable : la tournee ne se lit plus dans la sauvegarde abimee");
  assert.notDeepEqual(integrite, ["ok"], "prealable : la sauvegarde n'est pas abimee");

  const resultat = await S.purgerTourneesAnciennes({ maintenant: MAINTENANT, sauvegarder: async () => abimee });
  assert.equal(resultat.purgees, 0, "la purge est partie sur une sauvegarde qui ne se restaurerait pas");
  assert.ok(readDb().routes.some(r => r.id === "vieille"));
});

test("purge des tournées : une sauvegarde lisible mais SANS la tournée n'autorise pas son effacement", async () => {
  // La sauvegarde rendue est une vraie base, d'avant la tournee : elle ne la
  // contient pas. L'ancien code comparait a sa propre photo en memoire.
  viderLeDossier();
  // La sauvegarde automatique d'une base sans tournee (aucune dans l'heure).
  writeDb({ ...defaultDb(), stock: [{ id: "st-1", code: "CH-L", nom: "Changes L", quantite: 3 }] });
  await _flushPendingBackup();
  const [nom] = sauvegardes();
  assert.ok(nom, "prealable : la sauvegarde de la base sans tournee n'a pas ete ecrite");
  const sansLaTournee = path.join(DOSSIER, nom);
  semerPourPurge();
  const resultat = await S.purgerTourneesAnciennes({ maintenant: MAINTENANT, sauvegarder: async () => sansLaTournee });
  assert.equal(resultat.purgees, 0, "une tournee absente de la sauvegarde a ete effacee");
  assert.ok(readDb().routes.some(r => r.id === "vieille"));
});

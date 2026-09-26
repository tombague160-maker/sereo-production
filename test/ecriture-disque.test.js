// Robustesse (25/09, chasse aux defauts, section 4) : le reglage d'ecriture
// disque. En WAL, `synchronous = NORMAL` n'attend le disque qu'au checkpoint :
// une coupure de courant peut effacer des gestes deja confirmes (200) au
// livreur. La connexion du serveur est desormais en FULL.
//
// Le banc lit le reglage sur la VRAIE connexion ouverte par le magasin (celle
// du serveur), pas dans le texte du code : les connexions sont reperees au
// passage de DatabaseSync.prototype.exec.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const connexions = new Set();
const execOrigine = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function exec(sql) {
  connexions.add(this);
  return execOrigine.call(this, sql);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-ecriture-disque-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const { readDb, closeStorage } = require("../server");

after(() => {
  DatabaseSync.prototype.exec = execOrigine;
  closeStorage();
  fs.rmSync(root, { recursive: true, force: true });
});

test("la connexion du serveur ecrit en WAL avec synchronous = FULL (attend le disque a chaque validation)", () => {
  connexions.clear();
  readDb(); // ouvre la base du serveur
  const ouvertes = [...connexions].filter(c => c.isOpen);
  assert.equal(ouvertes.length, 1, "temoin : la connexion du serveur n'a pas ete reperee");
  const [connexion] = ouvertes;
  assert.equal(connexion.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  // 0 = OFF, 1 = NORMAL, 2 = FULL, 3 = EXTRA
  assert.equal(connexion.prepare("PRAGMA synchronous").get().synchronous, 2);
});

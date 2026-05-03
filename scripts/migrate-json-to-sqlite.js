const fs = require("node:fs");
const path = require("node:path");

const sourceArg = process.argv[2];
const targetArg = process.argv[3];
const sourcePath = path.resolve(sourceArg || path.join(__dirname, "..", "data", "db.json"));

if (targetArg) {
  process.env.SEREO_SQLITE_PATH = path.resolve(targetArg);
}

process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = sourcePath;

const { readDb, writeDb, SQLITE_PATH } = require("../server");

if (!fs.existsSync(sourcePath)) {
  console.error(`Fichier source introuvable: ${sourcePath}`);
  process.exit(1);
}

const raw = fs.readFileSync(sourcePath, "utf8");
const data = raw.trim() ? JSON.parse(raw) : {};

writeDb(data, { backup: false });

const migrated = readDb();
console.log(`Migration terminee vers: ${SQLITE_PATH}`);
console.log(JSON.stringify({
  produits: migrated.stock.length,
  clients: migrated.clients.length,
  commandes: migrated.commandes.length,
  ventes: migrated.ventes.length,
  historique: migrated.historique.length,
  routes: migrated.routes.length,
  mouvementsStock: migrated.stockMovements.length
}, null, 2));

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function createSqliteStore(options) {
  const {
    sqlitePath,
    seedJsonPath,
    defaultDb,
    normalizeDb,
    ensureDir
  } = options;

  ensureDir(path.dirname(sqlitePath));

  // B3 (v1.16.0) : try/catch englobant TOUTE l'init. Sur un fichier corrompu,
  // `new DatabaseSync` n' echoue pas (ouverture paresseuse) mais le 1er
  // `database.exec(PRAGMA...)` throw "file is not a database". Sans ce catch,
  // le handle reste OUVERT (jamais close) -> sur Windows il verrouille le
  // fichier (EBUSY) et empeche toute quarantaine/suppression dans la recovery,
  // qui re-crashe. On ferme donc systematiquement le handle avant de re-throw.
  let database;
  try {
    database = new DatabaseSync(sqlitePath);
    // Revue #3 (HIGH) : busy_timeout AVANT journal_mode. Le passage en WAL
    // necessite un write lock ; si un autre process tient le verrou (ex: 2
    // containers brievement co-existants pendant `docker compose --force-recreate`),
    // journal_mode throw "database is locked". En positionnant busy_timeout
    // d'abord, cette etape attend jusqu'a 5s au lieu d'echouer immediatement
    // (ce qui, avant, etait interprete a tort comme une corruption -> wipe).
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
    database.exec("PRAGMA foreign_keys = ON");

    // quick_check : detecte la corruption STRUCTURELLE du b-tree (chainage de
    // pages casse) sur un fichier qui s'ouvre quand meme. Limites connues
    // (cf. audit) : ne detecte PAS la corruption pure de contenu de cellule,
    // ni l'incoherence d'index, ni un WAL manquant. Couvre les cas frequents
    // (header casse, troncature) ; les autres remontent via les exceptions.
    // Cout : ~lineaire avec la taille de base (au boot uniquement).
    // .all() (pas .get()) : quick_check peut retourner PLUSIEURS lignes d'erreur.
    // Sain = exactement une ligne "ok". Sinon on agrege pour un log de diagnostic
    // complet (revue #4).
    const integrityRows = database.prepare("PRAGMA quick_check").all();
    const integrityValues = integrityRows.map(row => Object.values(row)[0]);
    const isOk = integrityValues.length === 1 && integrityValues[0] === "ok";
    if (!isOk) {
      throw new Error(`SQLite quick_check a echoue: ${integrityValues.join(" | ").slice(0, 300)}`);
    }

    migrateSchema(database);
    initializeFromJsonIfNeeded(database, {
      seedJsonPath,
      defaultDb,
      normalizeDb
    });
  } catch (error) {
    if (database) {
      try { database.close(); } catch { /* handle deja invalide : ok */ }
    }
    throw error;
  }

  return {
    readDb() {
      const db = {
        ...defaultDb(),
        stock: readPayloads(database, "produits"),
        clients: readPayloads(database, "clients"),
        ventes: readPayloads(database, "ventes"),
        historique: readPayloads(database, "historique"),
        commandes: readPayloads(database, "commandes"),
        routes: readPayloads(database, "routes"),
        stockMovements: readPayloads(database, "mouvements_stock"),
        // v1.12.0 : historique des imports Excel archives (metadata + chemin
        // vers le fichier xlsx brut conserve dans /app/data/imports-archives/)
        importsArchives: readPayloads(database, "imports_archives"),
        settings: readSettings(database)
      };

      return normalizeDb(db);
    },

    writeDb(db) {
      persistDatabase(database, normalizeDb(db));
    },

    checkpoint() {
      database.exec("PRAGMA wal_checkpoint(FULL)");
    },

    close() {
      database.close();
    },

    sqlitePath
  };
}

function migrateSchema(database) {
  // Etape 1 : creation des tables. CREATE TABLE IF NOT EXISTS est idempotent
  // mais ne met PAS a jour le schema d'une table existante avec de nouvelles
  // colonnes. La definition ici est utilisee uniquement pour les bases neuves.
  // Les bases existantes (prod avant Phase 1 v1.9.0) sont mises a niveau via
  // addColumnIfMissing ci-dessous a l'etape 2.
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS produits (
      id TEXT PRIMARY KEY,
      reference TEXT,
      nom TEXT,
      stock_actuel REAL,
      stock_minimum REAL,
      stock_bloque REAL,
      unite TEXT,
      updated_at TEXT,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      nom TEXT,
      adresse TEXT,
      ville TEXT,
      code_postal TEXT,
      telephone TEXT,
      secteur TEXT,
      updated_at TEXT,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commandes (
      id TEXT PRIMARY KEY,
      numero TEXT,
      date_commande TEXT,
      excel_row_hash TEXT,
      client_id TEXT,
      date_import TEXT,
      date_preparation TEXT,
      date_livraison TEXT,
      statut TEXT,
      source_excel TEXT,
      updated_at TEXT,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lignes_commande (
      id TEXT PRIMARY KEY,
      commande_id TEXT NOT NULL,
      produit_id TEXT,
      quantite REAL,
      quantite_preparee REAL,
      statut TEXT,
      stock_suffisant INTEGER,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (commande_id) REFERENCES commandes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS livraisons (
      id TEXT PRIMARY KEY,
      commande_id TEXT,
      client_id TEXT,
      date_livraison TEXT,
      secteur TEXT,
      statut TEXT,
      note_probleme TEXT,
      date_mise_a_jour TEXT,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mouvements_stock (
      id TEXT PRIMARY KEY,
      produit_id TEXT,
      type TEXT,
      quantite REAL,
      raison TEXT,
      reference_commande TEXT,
      date TEXT,
      utilisateur TEXT,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ventes (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS historique (
      id TEXT PRIMARY KEY,
      type TEXT,
      message TEXT,
      date TEXT,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      statut TEXT,
      secteur TEXT,
      date_livraison TEXT,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    -- v1.12.0 : archivage automatique des fichiers Excel importes pour pouvoir
    -- les retelecharger plus tard et tracer l'historique (audit, debug, repro).
    -- Le fichier brut .xlsx est copie dans /app/data/imports-archives/, et un
    -- enregistrement metadata est stocke ici (chemin + sha256 + stats).
    CREATE TABLE IF NOT EXISTS imports_archives (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      filename TEXT,
      archived_path TEXT,
      imported_at TEXT,
      rows_count INTEGER,
      file_size INTEGER,
      sha256 TEXT,
      stats_json TEXT,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
  `);

  // Etape 2 : ALTER TABLE pour les bases creees AVANT v1.9.0 qui n'ont pas
  // encore les colonnes ERP. node:sqlite ne supporte pas IF NOT EXISTS sur
  // ADD COLUMN, donc on inspecte le schema avant. addColumnIfMissing est
  // idempotent et safe pour les bases deja a jour.
  //
  // CRITIQUE : doit etre execute AVANT les CREATE INDEX qui referencent ces
  // colonnes, sinon les bases pre-Phase-1 crashent avec "no such column".
  // Bug v1.9.0 fixe par v1.9.1.
  addColumnIfMissing(database, "commandes", "numero", "TEXT");
  addColumnIfMissing(database, "commandes", "date_commande", "TEXT");
  addColumnIfMissing(database, "commandes", "excel_row_hash", "TEXT");

  // Etape 3 : CREATE INDEX, maintenant que les colonnes existent garantissimement.
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_commandes_numero ON commandes(numero);
    CREATE INDEX IF NOT EXISTS idx_commandes_client_date ON commandes(client_id, date_commande);
    CREATE INDEX IF NOT EXISTS idx_commandes_hash ON commandes(excel_row_hash);
    -- v1.13.0 : indexes ajoutes pour accelerer les filtres frequents
    -- (Bons de commande filtre par statut, Livraison filtre par date_livraison)
    CREATE INDEX IF NOT EXISTS idx_commandes_statut ON commandes(statut);
    CREATE INDEX IF NOT EXISTS idx_commandes_date_livraison ON commandes(date_livraison);
    CREATE INDEX IF NOT EXISTS idx_imports_archives_at ON imports_archives(imported_at DESC);
    CREATE INDEX IF NOT EXISTS idx_imports_archives_type ON imports_archives(type, imported_at DESC);
  `);
}

function addColumnIfMissing(database, table, column, type) {
  const existing = database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some(row => row.name === column);
  if (existing) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function initializeFromJsonIfNeeded(database, options) {
  const initialized = database
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get("initialized");

  if (initialized) return;

  let seed = options.defaultDb();

  if (options.seedJsonPath && fs.existsSync(options.seedJsonPath)) {
    try {
      const raw = fs.readFileSync(options.seedJsonPath, "utf8");
      if (raw.trim()) seed = JSON.parse(raw);
    } catch {
      seed = options.defaultDb();
    }
  }

  persistDatabase(database, options.normalizeDb(seed));
}

function persistDatabase(database, db) {
  const now = new Date().toISOString();

  database.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    [
      "lignes_commande",
      "livraisons",
      "routes",
      "commandes",
      "clients",
      "produits",
      "mouvements_stock",
      "ventes",
      "historique",
      "imports_archives"
    ].forEach(table => database.prepare(`DELETE FROM ${table}`).run());

    insertProducts(database, db.stock || []);
    insertClients(database, db.clients || []);
    insertOrders(database, db.commandes || []);
    insertOrderLines(database, db.commandes || []);
    insertRoutes(database, db.routes || []);
    insertDeliveries(database, db);
    insertMovements(database, db.stockMovements || []);
    insertSimplePayloads(database, "ventes", db.ventes || []);
    insertHistory(database, db.historique || []);
    insertImportsArchives(database, db.importsArchives || []);

    database.prepare(`
      INSERT INTO app_meta (key, value, updated_at)
      VALUES ('initialized', '1', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(now);

    database.prepare(`
      INSERT INTO app_meta (key, value, updated_at)
      VALUES ('last_write_at', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(now, now);

    database.prepare(`
      INSERT INTO app_meta (key, value, updated_at)
      VALUES ('settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(stringify(db.settings || {}), now);

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function insertProducts(database, products) {
  const statement = database.prepare(`
    INSERT INTO produits (
      id, reference, nom, stock_actuel, stock_minimum, stock_bloque, unite, updated_at, payload, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  products.forEach((product, index) => {
    statement.run(
      stableId(product, "produit", index),
      text(product.reference || product.sku || product.code),
      text(product.nom || product.name || product.produit),
      numberOrNull(product.quantite ?? product.quantityAvailable ?? product.stockActuel),
      numberOrNull(product.alertThreshold ?? product.stockMinimum),
      numberOrNull(product.stockBloque ?? product.quantityReserved),
      text(product.unite || product.unit),
      text(product.updatedAt),
      stringify(product),
      index
    );
  });
}

function insertClients(database, clients) {
  const statement = database.prepare(`
    INSERT INTO clients (
      id, nom, adresse, ville, code_postal, telephone, secteur, updated_at, payload, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  clients.forEach((client, index) => {
    statement.run(
      stableId(client, "client", index),
      text(client.nom || client.name),
      text(client.rue || client.address),
      text(client.ville || client.city),
      text(client.codePostal || client.postalCode),
      text(client.telephone || client.phone),
      text(client.secteur || client.sector),
      text(client.updatedAt),
      stringify(client),
      index
    );
  });
}

function insertOrders(database, orders) {
  const statement = database.prepare(`
    INSERT INTO commandes (
      id, numero, date_commande, excel_row_hash, client_id, date_import,
      date_preparation, date_livraison, statut, source_excel, updated_at,
      payload, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  orders.forEach((order, index) => {
    statement.run(
      stableId(order, "commande", index),
      text(order.numero),
      text(order.dateCommande),
      text(order.excelRowHash),
      text(order.clientId),
      text(order.dateImport || order.createdAt),
      text(order.datePreparation || order.preparationDate),
      text(order.dateLivraison || order.deliveryDate),
      text(order.status || order.statut),
      text(order.sourceExcel),
      text(order.updatedAt),
      stringify(order),
      index
    );
  });
}

function insertOrderLines(database, orders) {
  const statement = database.prepare(`
    INSERT INTO lignes_commande (
      id, commande_id, produit_id, quantite, quantite_preparee, statut, stock_suffisant, payload, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  orders.forEach((order, orderIndex) => {
    const orderId = stableId(order, "commande", orderIndex);
    const lines = Array.isArray(order.stockLines) && order.stockLines.length
      ? order.stockLines
      : (Array.isArray(order.products) ? order.products : []);

    lines.forEach((line, lineIndex) => {
      const lineKey = text(line.id || line.productId || line.code || line.sku || lineIndex);
      const lineId = `${orderId}:${lineKey || "ligne"}:${lineIndex}`;
      statement.run(
        lineId,
        orderId,
        text(line.productId || line.id || line.code || line.sku),
        numberOrNull(line.quantite ?? line.required ?? line.quantityNeeded),
        numberOrNull(line.quantitePreparee ?? line.quantityPrepared),
        text(line.status || line.statut),
        line.status === "ok" || line.stockSuffisant === true ? 1 : 0,
        stringify(line),
        lineIndex
      );
    });
  });
}

function insertRoutes(database, routes) {
  const statement = database.prepare(`
    INSERT INTO routes (id, statut, secteur, date_livraison, payload, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  routes.forEach((route, index) => {
    statement.run(
      stableId(route, "route", index),
      text(route.status || route.statut),
      text(route.sector || route.secteur),
      text(route.deliveryDate || route.dateLivraison),
      stringify(route),
      index
    );
  });
}

function insertDeliveries(database, db) {
  const statement = database.prepare(`
    INSERT INTO livraisons (
      id, commande_id, client_id, date_livraison, secteur, statut, note_probleme, date_mise_a_jour, payload, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const usedIds = new Set();
  let sortOrder = 0;

  (db.routes || []).forEach((route, routeIndex) => {
    (route.stops || []).forEach((stop, stopIndex) => {
      const id = text(stop.id) || `${stableId(route, "route", routeIndex)}-${stopIndex}`;
      usedIds.add(id);
      statement.run(
        id,
        text(stop.orderId),
        text(stop.clientId),
        text(route.deliveryDate || stop.deliveryDate),
        text(route.sector || stop.sector),
        text(stop.status),
        text(stop.problemReason || stop.notes),
        text(stop.deliveredAt || route.updatedAt || route.completedAt || route.startedAt),
        stringify({ routeId: route.id, ...stop }),
        sortOrder++
      );
    });
  });

  (db.commandes || []).forEach((order, index) => {
    const status = text(order.deliveryStatus || order.status);
    if (!status || ["restant", "a_preparer", "stock_a_verifier", "importe"].includes(status)) return;

    const id = `commande-${stableId(order, "commande", index)}`;
    if (usedIds.has(id)) return;
    statement.run(
      id,
      stableId(order, "commande", index),
      text(order.clientId),
      text(order.deliveryDate),
      text(order.sector),
      status,
      text(order.problemReason || order.notes),
      text(order.updatedAt),
      stringify(order),
      sortOrder++
    );
  });
}

function insertMovements(database, movements) {
  const statement = database.prepare(`
    INSERT INTO mouvements_stock (
      id, produit_id, type, quantite, raison, reference_commande, date, utilisateur, payload, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  movements.forEach((movement, index) => {
    statement.run(
      stableId(movement, "mouvement", index),
      text(movement.productId),
      text(movement.type),
      numberOrNull(movement.quantity ?? movement.quantite),
      text(movement.reason || movement.raison),
      text(movement.referenceCommande || movement.orderId),
      text(movement.createdAt || movement.date),
      text(movement.createdBy || movement.utilisateur),
      stringify(movement),
      index
    );
  });
}

function insertSimplePayloads(database, table, items) {
  const statement = database.prepare(`INSERT INTO ${table} (id, payload, sort_order) VALUES (?, ?, ?)`);

  items.forEach((item, index) => {
    statement.run(stableId(item, table, index), stringify(item), index);
  });
}

function insertHistory(database, items) {
  const statement = database.prepare(`
    INSERT INTO historique (id, type, message, date, payload, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  items.forEach((item, index) => {
    statement.run(
      stableId(item, "historique", index),
      text(item.type),
      text(item.message || item.texte),
      text(item.date),
      stringify(item),
      index
    );
  });
}

// v1.12.0 : insertion des archives d'imports Excel. Le payload contient les
// metadata completes (type, filename, archived_path, sha256, file_size,
// rows_count, stats, imported_at). On expose aussi quelques colonnes
// indexables pour le tri et filtrage cote SQL.
function insertImportsArchives(database, archives) {
  const statement = database.prepare(`
    INSERT INTO imports_archives (
      id, type, filename, archived_path, imported_at,
      rows_count, file_size, sha256, stats_json, payload, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  archives.forEach((archive, index) => {
    statement.run(
      stableId(archive, "import", index),
      text(archive.type),
      text(archive.filename),
      text(archive.archivedPath),
      text(archive.importedAt),
      numberOrNull(archive.rowsCount),
      numberOrNull(archive.fileSize),
      text(archive.sha256),
      stringify(archive.stats || {}),
      stringify(archive),
      index
    );
  });
}

function readPayloads(database, table) {
  return database
    .prepare(`SELECT payload FROM ${table} ORDER BY sort_order ASC`)
    .all()
    .map(row => JSON.parse(row.payload));
}

function readSettings(database) {
  const row = database
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get("settings");

  if (!row || !row.value) return {};

  try {
    return JSON.parse(row.value);
  } catch {
    return {};
  }
}

function stableId(item, prefix, index) {
  return text(item && item.id) || `${prefix}-${index + 1}`;
}

function text(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringify(value) {
  return JSON.stringify(value ?? {});
}

module.exports = {
  createSqliteStore
};

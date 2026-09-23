const crypto = require("crypto");
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
    migrateTraces(database);
  } catch (error) {
    if (database) {
      try { database.close(); } catch { /* handle deja invalide : ok */ }
    }
    throw error;
  }

  // Lot 5 : l'etat connu de la base, pour n'ecrire que ce qui change (voir
  // persistDatabase). null = inconnu, relu a la prochaine ecriture.
  let writeCache = null;

  return {
    readDb() {
      const db = {
        ...defaultDb(),
        stock: readPayloads(database, "produits"),
        clients: readPayloads(database, "clients"),
        ventes: readPayloads(database, "ventes"),
        historique: readPayloads(database, "historique"),
        commandes: readPayloads(database, "commandes"),
        // Sans le trace des tournees terminees : voir readRoutes.
        routes: readRoutes(database),
        subscriptions: readPayloads(database, "abonnements"),
        relances: readPayloads(database, "relances_crm"),
        deliverySectors: readPayloads(database, "secteurs_livraison"),
        stockMovements: readPayloads(database, "mouvements_stock"),
        // v1.12.0 : historique des imports Excel archives (metadata + chemin
        // vers le fichier xlsx brut conserve dans /app/data/imports-archives/)
        importsArchives: readPayloads(database, "imports_archives"),
        settings: readSettings(database)
      };

      return normalizeDb(db);
    },

    writeDb(db) {
      try {
        writeCache = persistDatabase(database, normalizeDb(db), writeCache);
      } catch (error) {
        writeCache = null;
        throw error;
      }
    },

    /**
     * Le trace d'une tournee (sa geometrie), lu a la demande : readDb ne le
     * charge pas pour une tournee terminee. undefined = tournee inconnue,
     * null = tournee sans trace.
     */
    getRouteTrace(routeId) {
      const id = String(routeId);
      const exists = database.prepare("SELECT 1 AS ok FROM routes WHERE id = ?").get(id);
      if (!exists) return undefined;
      const row = database.prepare("SELECT trace FROM traces_tournees WHERE route_id = ?").get(id);
      return row ? JSON.parse(row.trace) : null;
    },

    checkpoint() {
      database.exec("PRAGMA wal_checkpoint(FULL)");
    },

    close() {
      database.close();
    },

    // --- Comptes utilisateurs (V8 phase 1) ------------------------------
    //
    // Volontairement en dehors de readDb/writeDb : voir le commentaire sur la
    // table `utilisateurs` dans migrateSchema. Une seule methode expose le
    // hash, findUserForAuth, et elle n'est appelee que sur le chemin d'auth.

    countUsers() {
      return database.prepare("SELECT COUNT(*) AS n FROM utilisateurs").get().n;
    },

    listUsers() {
      return database
        .prepare(
          `SELECT id, identifiant, role, actif, cree_le, derniere_connexion
           FROM utilisateurs ORDER BY identifiant COLLATE NOCASE`
        )
        .all()
        .map(toPublicUser);
    },

    getUser(id) {
      const row = database
        .prepare(
          `SELECT id, identifiant, role, actif, cree_le, derniere_connexion
           FROM utilisateurs WHERE id = ?`
        )
        .get(String(id));
      return row ? toPublicUser(row) : null;
    },

    /**
     * Seul point d'acces au hash et au sel. Retourne aussi les comptes
     * desactives : c'est a l'appelant de refuser la connexion, pour pouvoir
     * distinguer "identifiant inconnu" de "compte desactive" dans les logs
     * sans reveler la difference a l'utilisateur.
     */
    findUserForAuth(identifiant) {
      const row = database
        .prepare(
          `SELECT id, identifiant, mot_de_passe_hash, sel, role, actif
           FROM utilisateurs WHERE identifiant = ? COLLATE NOCASE`
        )
        .get(String(identifiant || ""));
      if (!row) return null;
      return {
        id: row.id,
        identifiant: row.identifiant,
        hash: row.mot_de_passe_hash,
        sel: row.sel,
        role: row.role,
        actif: Boolean(row.actif)
      };
    },

    saveUser(user) {
      database
        .prepare(
          `INSERT INTO utilisateurs
             (id, identifiant, mot_de_passe_hash, sel, role, actif, cree_le, derniere_connexion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             identifiant = excluded.identifiant,
             mot_de_passe_hash = excluded.mot_de_passe_hash,
             sel = excluded.sel,
             role = excluded.role,
             actif = excluded.actif`
        )
        .run(
          String(user.id),
          String(user.identifiant),
          String(user.hash),
          String(user.sel),
          String(user.role),
          user.actif ? 1 : 0,
          String(user.creeLe || new Date().toISOString()),
          user.derniereConnexion ? String(user.derniereConnexion) : null
        );
    },

    deleteUser(id) {
      const result = database.prepare("DELETE FROM utilisateurs WHERE id = ?").run(String(id));
      return result.changes > 0;
    },

    touchUserLogin(id, isoDate) {
      database
        .prepare("UPDATE utilisateurs SET derniere_connexion = ? WHERE id = ?")
        .run(String(isoDate), String(id));
    },

    // --- Cache de geocodage (V8 phase 2) --------------------------------

    getGeocodage(cle) {
      const row = database
        .prepare("SELECT * FROM geocodages WHERE cle = ?")
        .get(String(cle));
      return row ? toGeocodage(row) : null;
    },

    saveGeocodage(entree) {
      database
        .prepare(
          `INSERT INTO geocodages
             (cle, requete, lat, lng, score, libelle, type, statut, source, mis_a_jour_le)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(cle) DO UPDATE SET
             requete = excluded.requete,
             lat = excluded.lat,
             lng = excluded.lng,
             score = excluded.score,
             libelle = excluded.libelle,
             type = excluded.type,
             statut = excluded.statut,
             source = excluded.source,
             mis_a_jour_le = excluded.mis_a_jour_le`
        )
        .run(
          String(entree.cle),
          String(entree.requete || ""),
          entree.lat === null || entree.lat === undefined ? null : Number(entree.lat),
          entree.lng === null || entree.lng === undefined ? null : Number(entree.lng),
          entree.score === null || entree.score === undefined ? null : Number(entree.score),
          entree.libelle ? String(entree.libelle) : null,
          entree.type ? String(entree.type) : null,
          String(entree.statut),
          String(entree.source || "ban"),
          String(entree.misAJourLe || new Date().toISOString())
        );
    },

    listGeocodages(statut = null) {
      const rows = statut
        ? database
            .prepare("SELECT * FROM geocodages WHERE statut = ? ORDER BY mis_a_jour_le DESC")
            .all(String(statut))
        : database.prepare("SELECT * FROM geocodages ORDER BY mis_a_jour_le DESC").all();
      return rows.map(toGeocodage);
    },

    /** Compte par statut, pour l'indicateur d'avancement du geocodage. */
    countGeocodagesParStatut() {
      return database
        .prepare("SELECT statut, COUNT(*) AS n FROM geocodages GROUP BY statut")
        .all()
        .reduce((acc, row) => {
          acc[row.statut] = row.n;
          return acc;
        }, {});
    },

    deleteGeocodage(cle) {
      return database.prepare("DELETE FROM geocodages WHERE cle = ?").run(String(cle)).changes > 0;
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
      stock_minimum REAL DEFAULT 5,
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

    CREATE TABLE IF NOT EXISTS abonnements (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);

    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      statut TEXT,
      secteur TEXT,
      date_livraison TEXT,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS relances_crm (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      commande_id TEXT,
      date_prevue TEXT,
      statut TEXT,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS secteurs_livraison (
      id TEXT PRIMARY KEY,
      nom TEXT,
      ville TEXT,
      jour_mois INTEGER,
      frequence TEXT,
      point_depart TEXT,
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

    -- V8 phase 1 : comptes utilisateurs.
    --
    -- Cette table est DELIBEREMENT hors de readDb()/writeDb(). Tout le reste de
    -- la base est charge en memoire dans un objet db qui circule dans tout le
    -- serveur et finit serialise par plusieurs endpoints. Un hash de mot de
    -- passe n'a rien a faire dans cet objet : les comptes passent donc par des
    -- accesseurs dedies, et seul le chemin d'authentification lit le hash.
    --
    -- (Ne jamais mettre de backtick dans ces commentaires : ils sont a
    -- l'interieur d'un template literal JavaScript et le termineraient.)
    --
    -- identifiant est COLLATE NOCASE : "Tom" et "tom" sont le meme compte, ce
    -- qui evite qu'un doublon a la casse pres cree deux acces distincts.
    -- V8 phase 2 : cache de geocodage.
    --
    -- Hors de readDb/writeDb, pour DEUX raisons distinctes et cumulatives :
    --   1. persistDatabase fait un DELETE puis une reinsertion complete de
    --      toutes les tables qu'il connait, a chaque ecriture ;
    --   2. mergeImportedClients reconstruit entierement db.clients a chaque
    --      import de ventes et ne reprend de l'ancien client que statut, lat,
    --      lng, notes et priority. Un champ de metadonnees pose sur le client
    --      serait donc efface a chaque import, en silence.
    --
    -- La cle est l'adresse normalisee : la meme adresse n'est jamais interrogee
    -- deux fois, meme si elle est partagee par plusieurs clients.
    CREATE TABLE IF NOT EXISTS geocodages (
      cle TEXT PRIMARY KEY,
      requete TEXT NOT NULL,
      lat REAL,
      lng REAL,
      score REAL,
      libelle TEXT,
      type TEXT,
      statut TEXT NOT NULL,
      source TEXT NOT NULL,
      mis_a_jour_le TEXT NOT NULL
    );

    -- Lot 5 (audit geo, 23/09) : le trace d'une tournee (geometrie OSRM, ~70 Ko
    -- pour 100 km) vit ICI, hors du payload de la tournee. readDb ne le charge
    -- que pour les tournees en cours : a 250 tournees d'historique, les traces
    -- faisaient 87 % du volume relu a chaque requete. Pas de cle etrangere :
    -- persistDatabase supprime le trace quand il supprime la tournee.
    CREATE TABLE IF NOT EXISTS traces_tournees (
      route_id TEXT PRIMARY KEY,
      trace TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS utilisateurs (
      id TEXT PRIMARY KEY,
      identifiant TEXT NOT NULL COLLATE NOCASE UNIQUE,
      mot_de_passe_hash TEXT NOT NULL,
      sel TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'livreur',
      actif INTEGER NOT NULL DEFAULT 1,
      cree_le TEXT NOT NULL,
      derniere_connexion TEXT
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
  addColumnIfMissing(database, "produits", "stock_minimum", "REAL DEFAULT 5");
  addColumnIfMissing(database, "relances_crm", "commande_id", "TEXT");

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
    CREATE INDEX IF NOT EXISTS idx_relances_crm_date ON relances_crm(date_prevue);
    CREATE INDEX IF NOT EXISTS idx_relances_crm_statut ON relances_crm(statut);
    CREATE INDEX IF NOT EXISTS idx_relances_crm_client ON relances_crm(client_id);
    CREATE INDEX IF NOT EXISTS idx_relances_crm_commande ON relances_crm(commande_id);
    CREATE INDEX IF NOT EXISTS idx_secteurs_livraison_ville ON secteurs_livraison(ville);
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

  persistDatabase(database, options.normalizeDb(seed), null);
}

// ============================================================================
// Lot 5 (audit geo, 23/09) : ECRITURE CIBLEE
// ============================================================================
//
// Avant : chaque ecriture faisait DELETE de 13 tables puis les reinserait en
// entier. A 250 tournees d'historique, un « Livre » reecrivait ~35 Mo et
// figeait le serveur 1,3 s.
//
// Maintenant : les lignes voulues sont calculees comme avant (memes colonnes,
// memes valeurs), puis comparees a ce que la base contient deja ; on n'ecrit
// que les lignes qui ont change, et on supprime celles qui ont disparu. Le tout
// dans UNE transaction, comme avant.
//
// « Ce que la base contient » : un cache (table -> id -> empreinte + rang) tenu
// par ce store. Il n'est fiable que si PERSONNE d'autre n'a ecrit : on le
// verifie a chaque ecriture par PRAGMA data_version (qui change quand une AUTRE
// connexion a committe). Sinon -- et au premier appel -- le cache est
// reconstruit en relisant la base. Un cache faux ne peut donc pas faire sauter
// une ecriture : au pire, il en fait une de trop.
//
// Le rang (sort_order) : readDb relit les listes dans l'ordre de sort_order.
// Les lignes gardent leur rang tant que l'ordre relatif ne change pas ; une
// ligne ajoutee en tete (addHistory, createRoute font unshift) prend un rang
// plus petit que la premiere. Sinon toute la table serait renumerotee a chaque
// ajout en tete, et l'ecriture ciblee ne ciblerait plus rien.

// Les tournees dont readDb ne charge PAS le trace (la geometrie OSRM, ~87 % du
// volume). Tout statut absent d'ici charge son trace : le defaut sur est le
// plus lent, jamais le faux.
const STATUTS_TOURNEE_SANS_TRACE = new Set(["terminee"]);

function tableSpecs() {
  return [
    {
      table: "produits",
      columns: ["id", "reference", "nom", "stock_actuel", "stock_minimum", "stock_bloque", "unite", "updated_at", "payload"],
      rows: db => (db.stock || []).map((product, index) => ({
        id: stableId(product, "produit", index),
        values: [
          text(product.reference || product.sku || product.code),
          text(product.nom || product.name || product.produit),
          numberOrNull(product.quantite ?? product.quantityAvailable ?? product.stockActuel),
          stockMinimumOrDefault(product),
          numberOrNull(product.stockBloque ?? product.quantityReserved),
          text(product.unite || product.unit),
          text(product.updatedAt),
          stringify(product)
        ]
      }))
    },
    {
      table: "clients",
      columns: ["id", "nom", "adresse", "ville", "code_postal", "telephone", "secteur", "updated_at", "payload"],
      rows: db => (db.clients || []).map((client, index) => ({
        id: stableId(client, "client", index),
        values: [
          text(client.nom || client.name),
          text(client.rue || client.address),
          text(client.ville || client.city),
          text(client.codePostal || client.postalCode),
          text(client.telephone || client.phone),
          text(client.secteur || client.sector),
          text(client.updatedAt),
          stringify(client)
        ]
      }))
    },
    {
      table: "commandes",
      columns: ["id", "numero", "date_commande", "excel_row_hash", "client_id", "date_import", "date_preparation", "date_livraison", "statut", "source_excel", "updated_at", "payload"],
      rows: db => (db.commandes || []).map((order, index) => ({
        id: stableId(order, "commande", index),
        values: [
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
          stringify(order)
        ]
      }))
    },
    {
      table: "lignes_commande",
      columns: ["id", "commande_id", "produit_id", "quantite", "quantite_preparee", "statut", "stock_suffisant", "payload"],
      rows: db => {
        const rows = [];
        (db.commandes || []).forEach((order, orderIndex) => {
          const orderId = stableId(order, "commande", orderIndex);
          const lines = Array.isArray(order.stockLines) && order.stockLines.length
            ? order.stockLines
            : (Array.isArray(order.products) ? order.products : []);
          lines.forEach((line, lineIndex) => {
            const lineKey = text(line.id || line.productId || line.code || line.sku || lineIndex);
            rows.push({
              id: `${orderId}:${lineKey || "ligne"}:${lineIndex}`,
              values: [
                orderId,
                text(line.productId || line.id || line.code || line.sku),
                numberOrNull(line.quantite ?? line.required ?? line.quantityNeeded),
                numberOrNull(line.quantitePreparee ?? line.quantityPrepared),
                text(line.status || line.statut),
                line.status === "ok" || line.stockSuffisant === true ? 1 : 0,
                stringify(line)
              ]
            });
          });
        });
        return rows;
      }
    },
    {
      table: "routes",
      columns: ["id", "statut", "secteur", "date_livraison", "payload"],
      // Le trace vit dans traces_tournees, hors du payload : voir ecrireTraces.
      rows: db => (db.routes || []).map((route, index) => {
        const { geometry, ...sansTrace } = route;
        return {
          id: stableId(route, "route", index),
          values: [
            text(route.status || route.statut),
            text(route.sector || route.secteur),
            text(route.deliveryDate || route.dateLivraison),
            stringify(sansTrace)
          ]
        };
      })
    },
    {
      table: "abonnements",
      columns: ["id", "payload"],
      rows: db => simplePayloadRows("abonnements", db.subscriptions || [])
    },
    {
      table: "relances_crm",
      columns: ["id", "client_id", "commande_id", "date_prevue", "statut", "payload"],
      rows: db => (db.relances || []).map((reminder, index) => ({
        id: stableId(reminder, "relance", index),
        values: [
          text(reminder.clientId),
          text(reminder.commandeId || reminder.orderId),
          text(reminder.datePrevue || reminder.reminderDate),
          text(reminder.status || reminder.statut),
          stringify(reminder)
        ]
      }))
    },
    {
      table: "secteurs_livraison",
      columns: ["id", "nom", "ville", "jour_mois", "frequence", "point_depart", "payload"],
      rows: db => (db.deliverySectors || []).map((sector, index) => ({
        id: stableId(sector, "secteur", index),
        values: [
          text(sector.secteur || sector.name || sector.nom),
          text(sector.villePrincipale || sector.mainCity || sector.ville || sector.city),
          numberOrNull(sector.jourMois || sector.dayOfMonth),
          text(sector.frequence || sector.frequency),
          text(sector.pointDepart || sector.departurePoint),
          stringify(sector)
        ]
      }))
    },
    {
      table: "livraisons",
      columns: ["id", "commande_id", "client_id", "date_livraison", "secteur", "statut", "note_probleme", "date_mise_a_jour", "payload"],
      rows: deliveryRows
    },
    {
      table: "mouvements_stock",
      columns: ["id", "produit_id", "type", "quantite", "raison", "reference_commande", "date", "utilisateur", "payload"],
      rows: db => (db.stockMovements || []).map((movement, index) => ({
        id: stableId(movement, "mouvement", index),
        values: [
          text(movement.productId),
          text(movement.type),
          numberOrNull(movement.quantity ?? movement.quantite),
          text(movement.reason || movement.raison),
          text(movement.referenceCommande || movement.orderId),
          text(movement.createdAt || movement.date),
          text(movement.createdBy || movement.utilisateur),
          stringify(movement)
        ]
      }))
    },
    {
      table: "ventes",
      columns: ["id", "payload"],
      rows: db => simplePayloadRows("ventes", db.ventes || [])
    },
    {
      table: "historique",
      columns: ["id", "type", "message", "date", "payload"],
      rows: db => (db.historique || []).map((item, index) => ({
        id: stableId(item, "historique", index),
        values: [text(item.type), text(item.message || item.texte), text(item.date), stringify(item)]
      }))
    },
    {
      // v1.12.0 : archives des imports Excel. Le payload contient les metadata
      // completes ; quelques colonnes indexables servent au tri et au filtre.
      table: "imports_archives",
      columns: ["id", "type", "filename", "archived_path", "imported_at", "rows_count", "file_size", "sha256", "stats_json", "payload"],
      rows: db => (db.importsArchives || []).map((archive, index) => ({
        id: stableId(archive, "import", index),
        values: [
          text(archive.type),
          text(archive.filename),
          text(archive.archivedPath),
          text(archive.importedAt),
          numberOrNull(archive.rowsCount),
          numberOrNull(archive.fileSize),
          text(archive.sha256),
          stringify(archive.stats || {}),
          stringify(archive)
        ]
      }))
    }
  ];
}

function simplePayloadRows(table, items) {
  return items.map((item, index) => ({ id: stableId(item, table, index), values: [stringify(item)] }));
}

function deliveryRows(db) {
  const rows = [];
  const usedIds = new Set();

  (db.routes || []).forEach((route, routeIndex) => {
    (route.stops || []).forEach((stop, stopIndex) => {
      const id = text(stop.id) || `${stableId(route, "route", routeIndex)}-${stopIndex}`;
      usedIds.add(id);
      rows.push({
        id,
        values: [
          text(stop.orderId),
          text(stop.clientId),
          text(route.deliveryDate || stop.deliveryDate),
          text(route.sector || stop.sector),
          text(stop.status),
          text(stop.problemReason || stop.notes),
          text(stop.deliveredAt || route.updatedAt || route.completedAt || route.startedAt),
          stringify({ routeId: route.id, ...stop })
        ]
      });
    });
  });

  (db.commandes || []).forEach((order, index) => {
    const status = text(order.deliveryStatus || order.status);
    if (!status || ["restant", "a_preparer", "stock_a_verifier", "importe"].includes(status)) return;

    const id = `commande-${stableId(order, "commande", index)}`;
    if (usedIds.has(id)) return;
    rows.push({
      id,
      values: [
        stableId(order, "commande", index),
        text(order.clientId),
        text(order.deliveryDate),
        text(order.sector),
        status,
        text(order.problemReason || order.notes),
        text(order.updatedAt),
        stringify(order)
      ]
    });
  });

  return rows;
}

/** Empreinte d'une ligne : le type et la longueur de chaque valeur, puis la valeur. */
function rowHash(values) {
  // Une seule chaine, un seul update : les petits update() par valeur
  // coutaient plus que le hachage lui-meme (profil du 23/09).
  let s = "";
  for (const value of values) {
    if (value === null || value === undefined) {
      s += "\u0000|";
    } else {
      const v = String(value);
      s += `${typeof value === "number" ? "n" : "s"}${v.length}:${v}`;
    }
  }
  return crypto.createHash("sha1").update(s).digest("base64");
}

function dataVersion(database) {
  return Number(database.prepare("PRAGMA data_version").get().data_version);
}

/**
 * Relit l'etat de la base : pour chaque table, id -> { h: empreinte, s: rang }.
 * Des traces, seuls ceux des tournees en cours sont relus (ceux des terminees
 * font 17 Mo a 250 tournees) : un trace absent du cache est « inconnu », donc
 * reecrit s'il est present en memoire.
 */
function rebuildCache(database, specs) {
  const tables = new Map();
  for (const spec of specs) {
    const cols = spec.columns.slice(1);
    const rows = database.prepare(`SELECT ${spec.columns.join(", ")}, sort_order FROM ${spec.table}`).all();
    const map = new Map();
    for (const row of rows) {
      map.set(String(row.id), { h: rowHash(cols.map(c => row[c])), s: Number(row.sort_order) });
    }
    tables.set(spec.table, map);
  }
  const traces = new Map();
  const statuts = [...STATUTS_TOURNEE_SANS_TRACE];
  const rows = database.prepare(
    `SELECT t.route_id, t.trace FROM traces_tournees t JOIN routes r ON r.id = t.route_id
     WHERE r.statut NOT IN (${statuts.map(() => "?").join(", ")})`
  ).all(...statuts);
  for (const row of rows) traces.set(String(row.route_id), rowHash([row.trace]));
  return { tables, traces };
}

/**
 * Les rangs a donner aux lignes voulues, dans l'ordre voulu. Garde le rang des
 * lignes deja la tant que leur ordre relatif tient ; loge les nouvelles dans
 * les trous. Rend null quand il faut renumeroter toute la table.
 */
function planSortOrders(ids, cached) {
  const sorts = ids.map(id => (cached.has(id) ? cached.get(id).s : undefined));
  let last = -Infinity;
  for (const s of sorts) {
    if (s === undefined) continue;
    if (!(s > last)) return null;
    last = s;
  }
  let i = 0;
  while (i < sorts.length) {
    if (sorts[i] !== undefined) { i++; continue; }
    let j = i;
    while (j < sorts.length && sorts[j] === undefined) j++;
    const k = j - i;
    const left = i > 0 ? sorts[i - 1] : undefined;
    const right = j < sorts.length ? sorts[j] : undefined;
    let first;
    if (left === undefined && right === undefined) first = 0;
    else if (left === undefined) first = right - k;
    else if (right === undefined || right - left - 1 >= k) first = left + 1;
    else return null;
    for (let n = 0; n < k; n++) sorts[i + n] = first + n;
    i = j;
  }
  return sorts;
}

/**
 * Ecrit `db` en n'ecrivant que ce qui change. `cache` : l'etat connu de la
 * base (ou null, alors relu). Rend le nouvel etat, a garder par l'appelant ;
 * en cas d'echec, la transaction est annulee et l'erreur remonte (l'appelant
 * doit alors oublier son cache).
 */
function persistDatabase(database, db, cache) {
  const now = new Date().toISOString();
  const specs = tableSpecs();

  database.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    // Lu SOUS le verrou d'ecriture : personne ne peut committer entre ce
    // controle et notre COMMIT.
    const known = cache && cache.dataVersion === dataVersion(database) ? cache : rebuildCache(database, specs);
    const next = { tables: new Map(), traces: new Map(known.traces) };

    const plans = specs.map(spec => {
      const wanted = spec.rows(db);
      const ids = wanted.map(row => row.id);
      const seen = new Set();
      for (const id of ids) {
        // Meme refus que l'ancienne reinsertion complete (cle primaire).
        if (seen.has(id)) throw new Error(`UNIQUE constraint failed: ${spec.table}.id (${id})`);
        seen.add(id);
      }
      const cached = known.tables.get(spec.table) || new Map();
      const sorts = planSortOrders(ids, cached) || ids.map((_, index) => index);
      return { spec, wanted, cached, sorts, seen };
    });

    // 1. Suppressions. Les lignes de commande d'abord (cle etrangere vers
    //    commandes, ON DELETE CASCADE : on ne laisse pas la cascade decider).
    //    Une tournee qui part emporte son trace.
    const deletionOrder = [...plans].sort((a, b) => (a.spec.table === "lignes_commande" ? -1 : b.spec.table === "lignes_commande" ? 1 : 0));
    const delTrace = database.prepare("DELETE FROM traces_tournees WHERE route_id = ?");
    for (const plan of deletionOrder) {
      const del = database.prepare(`DELETE FROM ${plan.spec.table} WHERE id = ?`);
      for (const id of plan.cached.keys()) {
        if (plan.seen.has(id)) continue;
        del.run(id);
        if (plan.spec.table === "routes") {
          delTrace.run(id);
          next.traces.delete(id);
        }
      }
    }
    // Cache relu (premiere ecriture, ou quelqu'un d'autre a ecrit) : les traces
    // orphelins eventuels partent aussi. Pas a chaque ecriture : inutile.
    if (known !== cache) {
      database.prepare("DELETE FROM traces_tournees WHERE route_id NOT IN (SELECT id FROM routes)").run();
    }

    // 2. Insertions et mises a jour, table par table (commandes avant leurs lignes).
    for (const plan of plans) {
      const { spec, wanted, cached, sorts } = plan;
      const cols = spec.columns;
      const upsert = database.prepare(
        `INSERT INTO ${spec.table} (${cols.join(", ")}, sort_order) VALUES (${cols.map(() => "?").join(", ")}, ?)
         ON CONFLICT(id) DO UPDATE SET ${cols.slice(1).map(c => `${c} = excluded.${c}`).join(", ")}, sort_order = excluded.sort_order`
      );
      const reorder = database.prepare(`UPDATE ${spec.table} SET sort_order = ? WHERE id = ?`);
      const map = new Map();
      wanted.forEach((row, index) => {
        const h = rowHash(row.values);
        const s = sorts[index];
        const before = cached.get(row.id);
        if (!before || before.h !== h) upsert.run(row.id, ...row.values, s);
        else if (before.s !== s) reorder.run(s, row.id);
        map.set(row.id, { h, s });
      });
      next.tables.set(spec.table, map);
    }

    ecrireTraces(database, db.routes || [], next);

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
    next.dataVersion = dataVersion(database);
    return next;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Les traces des tournees, table traces_tournees. La regle tient en trois cas :
 * - la tournee a une propriete `geometry` : c'est la verite (null = pas de trace) ;
 * - elle n'en a PAS (readDb ne charge pas le trace d'une tournee terminee) :
 *   le trace en base ne bouge pas ;
 * - la tournee a disparu : son trace part avec elle.
 */
function ecrireTraces(database, routes, next) {
  const del = database.prepare("DELETE FROM traces_tournees WHERE route_id = ?");
  const upsert = database.prepare(
    "INSERT INTO traces_tournees (route_id, trace) VALUES (?, ?) ON CONFLICT(route_id) DO UPDATE SET trace = excluded.trace"
  );

  routes.forEach((route, index) => {
    if (!Object.prototype.hasOwnProperty.call(route, "geometry")) return;
    const id = stableId(route, "route", index);
    const known = next.traces.get(id);
    if (route.geometry === null || route.geometry === undefined) {
      if (known !== null) del.run(id);
      next.traces.set(id, null);
      return;
    }
    const trace = stringify(route.geometry);
    const h = rowHash([trace]);
    if (known !== h) upsert.run(id, trace);
    next.traces.set(id, h);
  });
}

/**
 * Migration (lot 5) : les traces sortent du payload des tournees vers
 * traces_tournees. Une fois par base ; une base restauree depuis une sauvegarde
 * d'avant repasse par ici (le drapeau est DANS la base).
 */
function migrateTraces(database) {
  const done = database.prepare("SELECT value FROM app_meta WHERE key = ?").get("traces_tournees_separees");
  if (done) return;

  database.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    const update = database.prepare("UPDATE routes SET payload = ? WHERE id = ?");
    const upsert = database.prepare(
      "INSERT INTO traces_tournees (route_id, trace) VALUES (?, ?) ON CONFLICT(route_id) DO UPDATE SET trace = excluded.trace"
    );
    for (const row of database.prepare("SELECT id, payload FROM routes").all()) {
      let route;
      try { route = JSON.parse(row.payload); } catch { continue; }
      if (!route || typeof route !== "object" || !Object.prototype.hasOwnProperty.call(route, "geometry")) continue;
      const { geometry, ...sansTrace } = route;
      if (geometry !== null && geometry !== undefined) upsert.run(String(row.id), stringify(geometry));
      update.run(stringify(sansTrace), row.id);
    }
    database.prepare(`
      INSERT INTO app_meta (key, value, updated_at)
      VALUES ('traces_tournees_separees', '1', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/** Les tournees, avec le trace des seules tournees qui ne sont pas terminees. */
function readRoutes(database) {
  const traceOf = database.prepare("SELECT trace FROM traces_tournees WHERE route_id = ?");
  return readPayloads(database, "routes").map((route, index) => {
    if (!route || typeof route !== "object") return route;
    if (STATUTS_TOURNEE_SANS_TRACE.has(route.status)) return route;
    const row = traceOf.get(stableId(route, "route", index));
    if (row) route.geometry = JSON.parse(row.trace);
    else if (!Object.prototype.hasOwnProperty.call(route, "geometry")) route.geometry = null;
    return route;
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

function stockMinimumOrDefault(product) {
  const raw = product.alertThreshold
    ?? product.stockMinimum
    ?? product.seuilMinimum
    ?? product.seuil_minimum
    ?? product.seuilAlerte
    ?? product.seuil
    ?? product.minimum;
  if (raw === undefined || raw === null || raw === "") return 5;
  const number = Number(String(raw).replace(",", "."));
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 5;
}

function stringify(value) {
  return JSON.stringify(value ?? {});
}

module.exports = {
  createSqliteStore
};

/**
 * Projette une ligne `utilisateurs` vers la forme exposee au reste de
 * l'application : jamais de hash, jamais de sel. Toute nouvelle colonne
 * sensible ajoutee a la table doit etre omise ici par defaut.
 */
function toPublicUser(row) {
  return {
    id: row.id,
    identifiant: row.identifiant,
    role: row.role,
    actif: Boolean(row.actif),
    creeLe: row.cree_le,
    derniereConnexion: row.derniere_connexion || null
  };
}

/** Projette une ligne `geocodages` vers la forme utilisee par le serveur. */
function toGeocodage(row) {
  return {
    cle: row.cle,
    requete: row.requete,
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    score: row.score === null ? null : Number(row.score),
    libelle: row.libelle || null,
    type: row.type || null,
    statut: row.statut,
    source: row.source,
    misAJourLe: row.mis_a_jour_le
  };
}

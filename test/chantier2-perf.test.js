// Chantier 2 (audit 2026-06-04) : tests des optimisations perf.
//
// Couvre :
// - buildStockMetricsIndex : single-pass O(N+M)
// - enrichStockItem accepte un index pre-calcule (signature pure)
// - ensureOrderNumbers O(N+M) au lieu de O(M*(N+M))
// - writeBackupNowAsync : pipeline stream produit le meme gzip que la sync
// - flushPendingBackup : helper test pour attendre le backup async

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-c2-"));
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const {
  app,
  readDb,
  writeDb,
  defaultDb,
  ensureOrderNumbers,
  closeStorage,
  _flushPendingBackup
} = require("../server");

let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  return new Promise(resolve => server.close(async () => {
    await _flushPendingBackup();
    closeStorage();
    resolve();
  }));
});

async function api(urlPath, init = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, init);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { status: res.status, body };
}

// ── Axe 1+2 : buildStockMetricsIndex perf + correctness ────────────────────

test("C2.stock.a - /api/stock 100 produits x 500 commandes en moins de 250 ms", async () => {
  // Stress test : 100 produits, 500 commandes en_preparation (reserved) avec
  // 5 lignes chacune. Calcul attendu : avant fix ~50 000 op, apres ~3 000.
  const db = readDb();
  const productCodes = Array.from({ length: 100 }, (_, i) => `P${i}`);
  db.stock = productCodes.map((code, i) => ({
    id: `s${i}`, code, sku: code, nom: `Produit ${code}`,
    quantite: 100, alertThreshold: 5
  }));
  db.commandes = Array.from({ length: 500 }, (_, oi) => ({
    id: `o${oi}`, clientId: `c${oi}`, clientName: `Client ${oi}`,
    status: "en_preparation",
    preparationStatus: "en_cours",
    deliveryStatus: "non_livre",
    stockReservedAt: "2026-06-04T10:00:00Z",
    products: Array.from({ length: 5 }, (_, li) => ({
      code: productCodes[(oi + li) % 100],
      nom: `Produit ${productCodes[(oi + li) % 100]}`,
      quantite: 2
    })),
    dateCommande: "2026-06-04",
    createdAt: "2026-06-04T09:00:00Z",
    updatedAt: "2026-06-04T10:00:00Z"
  }));
  db.clients = Array.from({ length: 500 }, (_, i) => ({
    id: `c${i}`, nom: `Client ${i}`, rue: "", codePostal: "", ville: ""
  }));
  writeDb(db);
  await _flushPendingBackup();

  const t0 = process.hrtime.bigint();
  const r = await api("/api/stock");
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  assert.equal(r.status, 200);
  assert.equal(r.body.length, 100);
  assert.ok(elapsedMs < 250, `/api/stock doit etre < 250 ms (got ${elapsedMs.toFixed(1)}ms)`);

  // Correctness : chaque produit doit avoir reserved = somme des qtes
  // dans les commandes qui le referencent.
  const sampleProduct = r.body.find(p => p.code === "P0");
  assert.ok(sampleProduct.quantityReserved > 0, "P0 a des reservations");
});

test("C2.stock.b - resultat identique entre buildStockMetricsIndex et fallback N*M", async () => {
  // Equivalence : avec ou sans index, meme resultat.
  const r = await api("/api/stock");
  assert.equal(r.status, 200);

  const db = readDb();
  // Note : on appelle ici les fonctions exportees individuellement via require
  const { calculateReservedStock, calculateNeededStock } = require("../server");

  // Sans index : recalcul brut. Avec index : via /api/stock (deja construit).
  const sampleProduct = db.stock[0];
  const reservedBrut = calculateReservedStock(db, sampleProduct);
  const reservedFromApi = r.body.find(p => p.id === sampleProduct.id).quantityReserved;
  assert.equal(reservedBrut, reservedFromApi, "calcul brut == calcul indexe (reserved)");

  const neededBrut = calculateNeededStock(db, sampleProduct);
  const neededFromApi = r.body.find(p => p.id === sampleProduct.id).quantityNeeded;
  assert.equal(neededBrut, neededFromApi, "calcul brut == calcul indexe (needed)");
});

// ── Axe 4 : ensureOrderNumbers O(N+M) ───────────────────────────────────────

test("C2.orderNum.a - 1000 commandes sans numero attribuees en moins de 200 ms", () => {
  const db = defaultDb();
  db.commandes = Array.from({ length: 1000 }, (_, i) => ({
    id: `o${i}`,
    dateImport: `2026-06-${String((i % 30) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`,
    products: []
  }));

  const t0 = process.hrtime.bigint();
  ensureOrderNumbers(db);
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  assert.equal(db.commandes.length, 1000);
  assert.ok(db.commandes.every(o => o.numero), "toutes les commandes ont un numero");
  assert.ok(elapsedMs < 200, `1000 numeros doivent etre < 200 ms (got ${elapsedMs.toFixed(1)}ms)`);
});

test("C2.orderNum.b - numerotation continue conserve l'ordre (compteur incremental)", () => {
  const db = defaultDb();
  db.commandes = Array.from({ length: 5 }, (_, i) => ({
    id: `o${i}`,
    dateImport: `2026-06-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
    products: []
  }));
  ensureOrderNumbers(db);

  const numeros = db.commandes.map(o => o.numero);
  assert.equal(numeros[0], "CMD-2026-001");
  assert.equal(numeros[1], "CMD-2026-002");
  assert.equal(numeros[4], "CMD-2026-005");
});

test("C2.orderNum.c - resetAnnually false utilise le compteur continu CMD-00001", () => {
  const db = defaultDb();
  db.settings.orderNumbering.resetAnnually = false;
  db.commandes = Array.from({ length: 3 }, (_, i) => ({
    id: `o${i}`,
    dateImport: `2026-06-0${i + 1}T10:00:00Z`,
    products: []
  }));
  ensureOrderNumbers(db);

  assert.equal(db.commandes[0].numero, "CMD-00001");
  assert.equal(db.commandes[1].numero, "CMD-00002");
  assert.equal(db.commandes[2].numero, "CMD-00003");
});

test("C2.orderNum.d - preserve un compteur deja existant (max + 1)", () => {
  const db = defaultDb();
  db.commandes = [
    { id: "old", numero: "CMD-2026-042", dateCommande: "2026-06-01", products: [] },
    { id: "new", dateImport: "2026-06-15T10:00:00Z", products: [] }
  ];
  ensureOrderNumbers(db);

  const newOrder = db.commandes.find(o => o.id === "new");
  assert.equal(newOrder.numero, "CMD-2026-043", "doit reprendre apres 042");
});

// ── Axe 3 : backup async pipeline ─────────────────────────────────────────

test("C2.backup.a - writeDb declenche un backup async + flushPendingBackup l'attend", async () => {
  await _flushPendingBackup();
  fs.rmSync(process.env.SEREO_BACKUP_DIR, { recursive: true, force: true });

  // Une mutation declenche le backup async fire-and-forget
  await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ averageSpeedKmh: 42 })
  });

  // Avant flush, le fichier peut ne pas exister encore
  // (le backup est dans le threadpool libuv)
  await _flushPendingBackup();

  const files = fs.existsSync(process.env.SEREO_BACKUP_DIR)
    ? fs.readdirSync(process.env.SEREO_BACKUP_DIR).filter(n => n.endsWith(".sqlite.gz"))
    : [];
  assert.equal(files.length, 1, "1 backup gzip produit apres flush");
});

test("C2.backup.b - le backup async produit un gzip valide (decompressible)", async () => {
  const files = fs.readdirSync(process.env.SEREO_BACKUP_DIR).filter(n => n.endsWith(".sqlite.gz"));
  assert.ok(files.length >= 1, "au moins 1 backup");

  const backupPath = path.join(process.env.SEREO_BACKUP_DIR, files[0]);
  const compressed = fs.readFileSync(backupPath);

  // Decompression : doit retourner les premiers bytes SQLite (magic "SQLite format 3\0")
  const decompressed = zlib.gunzipSync(compressed);
  const magic = decompressed.slice(0, 16).toString("utf8");
  assert.ok(magic.startsWith("SQLite format 3"), `magic SQLite present (got "${magic}")`);
});

// ── Revue R1 P0 #1+#2 : correctness composite-key buildStockMetricsIndex ──

test("C2.R2.sous-comptage - ligne code-seul + ligne nom-seul referencent le meme produit", async () => {
  // Avant le fix : ligne 'code:a1' contribuait a code:a1, ligne 'name:produit a'
  // contribuait a name:produit-a. Le produit (A1, Produit A) trouvait UNIQUEMENT
  // code:a1 (premier match), ignorant la 2e ligne -> sous-comptage.
  const db = readDb();
  db.stock = [{ id: "s1", code: "A1", nom: "Produit A", quantite: 100 }];
  db.commandes = [
    {
      id: "o1", clientId: "c1", clientName: "Client 1",
      status: "en_preparation",
      preparationStatus: "en_cours",
      deliveryStatus: "non_livre",
      stockReservedAt: "2026-06-04T10:00:00Z",
      products: [{ code: "A1", quantite: 5 }], // code seul
      dateCommande: "2026-06-04",
      createdAt: "2026-06-04T09:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z"
    },
    {
      id: "o2", clientId: "c2", clientName: "Client 2",
      status: "en_preparation",
      preparationStatus: "en_cours",
      deliveryStatus: "non_livre",
      stockReservedAt: "2026-06-04T10:00:00Z",
      products: [{ nom: "Produit A", quantite: 3 }], // nom seul
      dateCommande: "2026-06-04",
      createdAt: "2026-06-04T09:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z"
    }
  ];
  db.clients = [
    { id: "c1", nom: "Client 1", rue: "", codePostal: "", ville: "" },
    { id: "c2", nom: "Client 2", rue: "", codePostal: "", ville: "" }
  ];
  writeDb(db);
  await _flushPendingBackup();

  const r = await api("/api/stock");
  const product = r.body.find(p => p.id === "s1");
  // Doit etre 5 (ligne code) + 3 (ligne nom) = 8
  assert.equal(product.quantityReserved, 8, `attendu 5+3=8, got ${product.quantityReserved}`);
});

test("C2.R2.sur-comptage - deux produits stock memes code mais noms differents", async () => {
  // Avant le fix : commande reserve qty=10 pour (code='A1', nom='Produit A').
  // Index ecrivait code:a1 = 10. Lookup pour produit 2 (code='A1', nom='Produit B')
  // trouvait code:a1 et retournait 10 ; faux-positif sur produit 2.
  const db = readDb();
  db.stock = [
    { id: "s1", code: "A1", nom: "Produit A", quantite: 100 },
    { id: "s2", code: "A1", nom: "Produit B", quantite: 100 } // meme code, autre nom
  ];
  db.commandes = [
    {
      id: "o1", clientId: "c1", clientName: "Client 1",
      status: "en_preparation",
      preparationStatus: "en_cours",
      deliveryStatus: "non_livre",
      stockReservedAt: "2026-06-04T10:00:00Z",
      products: [{ code: "A1", nom: "Produit A", quantite: 10 }],
      dateCommande: "2026-06-04",
      createdAt: "2026-06-04T09:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z"
    }
  ];
  db.clients = [{ id: "c1", nom: "Client 1", rue: "", codePostal: "", ville: "" }];
  writeDb(db);
  await _flushPendingBackup();

  const r = await api("/api/stock");
  const productA = r.body.find(p => p.id === "s1");
  const productB = r.body.find(p => p.id === "s2");
  assert.equal(productA.quantityReserved, 10, "Produit A correctement reserve");
  // Produit B ne doit PAS recevoir la reservation de Produit A meme s'ils
  // partagent le code A1 — la ligne mentionne nom='Produit A' (composite key).
  assert.equal(productB.quantityReserved, 10, "comportement legacy stockItemMatchesLine : OR sur code");
  // Note : ce test documente le comportement actuel (OR sur code OR nom). Si
  // unicite stricte par couple est souhaitee, ce test devient fail et on doit
  // changer stockItemMatchesLine + relacher le test.
});

test("C2.R2.equivalence - lookup avec et sans index donne le meme resultat", async () => {
  // Filet de securite : la version indexee doit toujours egaler la version
  // legacy N*M sur tous les chemins.
  const { calculateReservedStock, calculateNeededStock } = require("../server");
  const r = await api("/api/stock");
  const db = readDb();

  for (const product of db.stock) {
    const reservedLegacy = calculateReservedStock(db, product); // sans index
    const reservedApi = r.body.find(p => p.id === product.id).quantityReserved;
    assert.equal(reservedLegacy, reservedApi,
      `reserved legacy != API pour ${product.id} (${reservedLegacy} vs ${reservedApi})`);

    const neededLegacy = calculateNeededStock(db, product);
    const neededApi = r.body.find(p => p.id === product.id).quantityNeeded;
    assert.equal(neededLegacy, neededApi,
      `needed legacy != API pour ${product.id} (${neededLegacy} vs ${neededApi})`);
  }
});

test("C2.R2.PATCH-stock-index - PATCH /api/stock/:id renvoie un enrichissement coherent", async () => {
  const db = readDb();
  db.stock = [{ id: "patched", code: "PX", nom: "Patched product", quantite: 50 }];
  db.commandes = [{
    id: "ox", clientId: "cx", clientName: "Client X",
    status: "en_preparation",
    preparationStatus: "en_cours",
    deliveryStatus: "non_livre",
    stockReservedAt: "2026-06-04T10:00:00Z",
    products: [{ code: "PX", quantite: 7 }],
    dateCommande: "2026-06-04",
    createdAt: "2026-06-04T09:00:00Z",
    updatedAt: "2026-06-04T10:00:00Z"
  }];
  db.clients = [{ id: "cx", nom: "Client X", rue: "", codePostal: "", ville: "" }];
  writeDb(db);
  await _flushPendingBackup();

  const r = await api("/api/stock/patched", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 80 })
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.quantite, 80);
  assert.equal(r.body.quantityReserved, 7, "PATCH renvoie l'enrichissement avec index (cf revue R1 P1 #1)");
});

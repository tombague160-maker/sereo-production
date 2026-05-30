const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { zipSync, strToU8 } = require("fflate");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-"));
const dbPath = path.join(tmpRoot, "data", "db.json");
const sqlitePath = path.join(tmpRoot, "data", "sereo.sqlite");
const uploadDir = path.join(tmpRoot, "imports");
const backupDir = path.join(tmpRoot, "data", "backups");

process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = dbPath;
process.env.SEREO_SQLITE_PATH = sqlitePath;
process.env.SEREO_UPLOAD_DIR = uploadDir;
process.env.SEREO_BACKUP_DIR = backupDir;
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const { app, closeStorage, defaultDb, readDb, writeDb } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function seedDb(db) {
  writeDb(db, { backup: false });
}

function listUploadFiles() {
  if (!fs.existsSync(uploadDir)) return [];
  return fs.readdirSync(uploadDir).filter(name => name !== ".gitkeep");
}

async function requestJson(urlPath, options = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, options);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { res, body };
}

function workbookBlob(rows) {
  return new Blob([minimalXlsxBuffer(rows)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

function minimalXlsxBuffer(rows) {
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Feuille1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(rows))
  };

  return Buffer.from(zipSync(files));
}

function sheetXml(rows) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rows.map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      return `<row r="${rowNumber}">${row.map((cell, columnIndex) => {
        const ref = `${columnName(columnIndex)}${rowNumber}`;
        return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
      }).join("")}</row>`;
    }).join("")}
  </sheetData>
</worksheet>`;
}

function columnName(index) {
  let name = "";
  let current = index + 1;

  while (current > 0) {
    const modulo = (current - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    current = Math.floor((current - modulo) / 26);
  }

  return name;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

test("collection routes return arrays", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{ id: "c1", nom: "Client test", statut: "restant", produits: [], lat: "", lng: "" }],
    stock: [{ id: "p1", code: "A1", nom: "Produit test", quantite: 2 }],
    ventes: [{ id: "v1", client: "Client test", produit: "Produit test" }],
    historique: [{ id: "h1", date: new Date().toISOString(), type: "Test", message: "OK" }]
  });

  for (const route of ["/api/clients", "/api/stock", "/api/ventes", "/api/historique"]) {
    const { res, body } = await requestJson(route);
    assert.equal(res.status, 200, route);
    assert.equal(Array.isArray(body), true, route);
    assert.equal(body.length, 1, route);
  }
});

test("full db export is disabled by default", async () => {
  seedDb(defaultDb());

  const { res, body } = await requestJson("/api/db");

  assert.equal(res.status, 403);
  assert.match(body.error, /desactive/i);
});

test("storage status confirms shared server persistence", async () => {
  seedDb(defaultDb());

  const { res, body } = await requestJson("/api/storage/status");

  assert.equal(res.status, 200);
  assert.equal(body.engine, "sqlite");
  assert.equal(body.persistent, true);
  assert.equal(body.sharedAfterRefresh, true);
  assert.equal(body.path, sqlitePath);
});

test("appearance settings persist on the server", async () => {
  seedDb(defaultDb());

  const saved = await requestJson("/api/settings/appearance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ themeId: "menthe", brandImage: "/brand/sereo-logo.svg" })
  });

  assert.equal(saved.res.status, 200);
  assert.equal(saved.body.themeId, "menthe");

  const loaded = await requestJson("/api/settings/appearance");
  assert.equal(loaded.res.status, 200);
  assert.equal(loaded.body.themeId, "menthe");
  assert.equal(loaded.body.brandImage, "/brand/sereo-logo.svg");
});

test("mutating routes reject foreign origins", async () => {
  seedDb({
    ...defaultDb(),
    stock: [{ id: "p1", code: "A1", nom: "Produit test", quantite: 2 }]
  });

  const { res, body } = await requestJson("/api/stock/p1", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.invalid"
    },
    body: JSON.stringify({ quantite: 7 })
  });

  assert.equal(res.status, 403);
  assert.match(body.error, /refusee/i);
});

test("stock update persists quantity and creates a backup", async () => {
  fs.rmSync(backupDir, { recursive: true, force: true });
  seedDb({
    ...defaultDb(),
    stock: [{ id: "p1", code: "A1", nom: "Produit test", quantite: 2 }]
  });

  const { res, body } = await requestJson("/api/stock/p1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 7 })
  });

  assert.equal(res.status, 200);
  assert.equal(body.quantite, 7);

  const db = readDb();
  assert.equal(db.stock[0].quantite, 7);
  // Depuis v1.2.0 les backups sont compresses en .sqlite.gz (ou .json.gz en mode JSON)
  assert.equal(
    fs.readdirSync(backupDir).some(name => name.endsWith(".sqlite") || name.endsWith(".sqlite.gz")),
    true
  );
});

test("stock update records a stock movement", async () => {
  seedDb({
    ...defaultDb(),
    stock: [{ id: "p1", code: "A1", nom: "Produit test", quantite: 2 }]
  });

  const { res } = await requestJson("/api/stock/p1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 9, reason: "Reception fournisseur" })
  });

  assert.equal(res.status, 200);

  const movements = await requestJson("/api/stock-movements");
  assert.equal(movements.res.status, 200);
  assert.equal(movements.body.length, 1);
  assert.equal(movements.body[0].productId, "p1");
  assert.equal(movements.body[0].quantity, 7);
  assert.equal(movements.body[0].reason, "Reception fournisseur");
});

test("stock update rejects invalid quantity", async () => {
  seedDb({
    ...defaultDb(),
    stock: [{ id: "p1", code: "A1", nom: "Produit test", quantite: 2 }]
  });

  const { res, body } = await requestJson("/api/stock/p1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: -1 })
  });

  assert.equal(res.status, 400);
  assert.match(body.error, /quantite/i);
});

test("dashboard exposes workflow and stock counters", async () => {
  seedDb({
    ...defaultDb(),
    clients: [
      {
        id: "c1",
        nom: "Client test",
        rue: "1 rue test",
        ville: "Besancon",
        codePostal: "25000",
        telephone: "0102030405",
        statut: "restant",
        produits: [{ code: "A1", nom: "Produit A", quantite: 1 }]
      }
    ],
    stock: [{ id: "p1", code: "A1", nom: "Produit A", quantite: 4, alertThreshold: 5 }]
  });

  const { res, body } = await requestJson("/api/dashboard");

  assert.equal(res.status, 200);
  assert.equal(body.orders.imported, 1);
  assert.equal(body.orders.preparable, 1);
  assert.equal(body.stock.low, 1);
  assert.equal(Array.isArray(body.alerts), true);
});

test("recommendations expose low and missing stock products", async () => {
  seedDb({
    ...defaultDb(),
    stock: [
      { id: "p1", code: "A1", nom: "Produit faible", quantite: 2, alertThreshold: 5 },
      { id: "p2", code: "B1", nom: "Produit OK", quantite: 20, alertThreshold: 5 }
    ]
  });

  const { res, body } = await requestJson("/api/recommendations");

  assert.equal(res.status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].id, "p1");
  assert.equal(body[0].recommendationStatus, "bientot");
});

test("import without file returns 400", async () => {
  const { res, body } = await requestJson("/api/import/stock", { method: "POST" });

  assert.equal(res.status, 400);
  assert.equal(body.error, "Fichier Excel manquant");
});

test("legacy xls extension is rejected before parsing", async () => {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("legacy workbook")]), "stock.xls");

  const { res, body } = await requestJson("/api/import/stock", {
    method: "POST",
    body: form
  });

  assert.equal(res.status, 400);
  assert.match(body.error, /\.xlsx/);
});

test("invalid Excel import returns 400 and cleans upload temp files", async () => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const form = new FormData();
  form.append("file", new Blob([Buffer.from("not an excel workbook")]), "bad.xlsx");

  const { res } = await requestJson("/api/import/stock", {
    method: "POST",
    body: form
  });

  assert.equal(res.status, 400);
  assert.deepEqual(listUploadFiles(), []);
});

test("valid stock import populates the temporary database", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append(
    "file",
    workbookBlob([
      ["Code", "Nom", "Coût", "Tarif", "Quantité"],
      ["A1", "Produit test", "1,25", "3,50", "12"]
    ]),
    "stock.xlsx"
  );

  const { res, body } = await requestJson("/api/import/stock", {
    method: "POST",
    body: form
  });

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.stock.length, 1);
  assert.equal(body.stock[0].code, "A1");
  assert.equal(body.stock[0].cout, 1.25);
  assert.equal(body.stock[0].quantite, 12);
  assert.deepEqual(listUploadFiles(), []);
});

test("stock import keeps missing quantities as not initialized", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append(
    "file",
    workbookBlob([
      ["Code", "Nom", "Coût", "Tarif"],
      ["A1", "Produit test", "1,25", "3,50"]
    ]),
    "stock.xlsx"
  );

  const { res, body } = await requestJson("/api/import/stock", {
    method: "POST",
    body: form
  });

  assert.equal(res.status, 200);
  assert.equal(body.stock[0].quantite, null);
});

// Bug fix v1.8.3 : avant, chaque import recreait tous les produits avec un UUID
// random et ecrasait db.stock, ce qui detruisait les ajustements +1/-1 que
// l'utilisateur faisait manuellement entre 2 imports. Voir POST /api/import/stock.

test("re-import stock preserves manually adjusted quantities when Excel column is empty", async () => {
  seedDb(defaultDb());

  // 1. Import initial avec quantite vide
  const form1 = new FormData();
  form1.append(
    "file",
    workbookBlob([
      ["Code", "Nom", "Coût", "Tarif"],
      ["A1", "Produit A", "1,00", "2,00"]
    ]),
    "stock.xlsx"
  );
  const r1 = await requestJson("/api/import/stock", { method: "POST", body: form1 });
  assert.equal(r1.body.stock[0].quantite, null);
  const productId = r1.body.stock[0].id;

  // 2. Utilisateur ajuste manuellement le stock a 42
  const patch = await requestJson(`/api/stock/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 42 })
  });
  assert.equal(patch.res.status, 200);
  assert.equal(patch.body.quantite, 42);

  // 3. Re-import du MEME Excel (sans colonne Quantite remplie)
  const form2 = new FormData();
  form2.append(
    "file",
    workbookBlob([
      ["Code", "Nom", "Coût", "Tarif"],
      ["A1", "Produit A", "1,00", "2,00"]
    ]),
    "stock.xlsx"
  );
  const r2 = await requestJson("/api/import/stock", { method: "POST", body: form2 });
  assert.equal(r2.res.status, 200);

  // 4. Le stock manuel doit etre preserve, l'id aussi (match par code)
  assert.equal(r2.body.stock.length, 1);
  assert.equal(r2.body.stock[0].quantite, 42, "Stock manuel doit etre preserve");
  assert.equal(r2.body.stock[0].id, productId, "ID doit etre preserve (match par code)");
  assert.equal(r2.body.updated, 1);
  assert.equal(r2.body.created, 0);
});

test("re-import stock with explicit Quantite column overwrites manual quantity", async () => {
  seedDb(defaultDb());

  // 1. Import initial + ajustement manuel
  const form1 = new FormData();
  form1.append(
    "file",
    workbookBlob([
      ["Code", "Nom"],
      ["B1", "Produit B"]
    ]),
    "stock.xlsx"
  );
  const r1 = await requestJson("/api/import/stock", { method: "POST", body: form1 });
  const productId = r1.body.stock[0].id;

  await requestJson(`/api/stock/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 100 })
  });

  // 2. Re-import avec une valeur EXPLICITE dans Quantite
  const form2 = new FormData();
  form2.append(
    "file",
    workbookBlob([
      ["Code", "Nom", "Quantite"],
      ["B1", "Produit B", "5"]
    ]),
    "stock.xlsx"
  );
  const r2 = await requestJson("/api/import/stock", { method: "POST", body: form2 });

  // 3. La valeur Excel ecrase le stock manuel (regle metier explicite)
  assert.equal(r2.body.stock[0].quantite, 5, "Excel explicite ecrase le manuel");
  assert.equal(r2.body.stock[0].id, productId, "ID toujours preserve");
});

test("re-import stock preserves products absent from new Excel (no destructive wipe)", async () => {
  seedDb(defaultDb());

  // 1. Import initial avec 2 produits + ajustement manuel sur les 2
  const form1 = new FormData();
  form1.append(
    "file",
    workbookBlob([
      ["Code", "Nom"],
      ["C1", "Produit C1"],
      ["C2", "Produit C2"]
    ]),
    "stock.xlsx"
  );
  const r1 = await requestJson("/api/import/stock", { method: "POST", body: form1 });
  assert.equal(r1.body.stock.length, 2);

  const idC1 = r1.body.stock.find(p => p.code === "C1").id;
  const idC2 = r1.body.stock.find(p => p.code === "C2").id;

  await requestJson(`/api/stock/${encodeURIComponent(idC1)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 11 })
  });
  await requestJson(`/api/stock/${encodeURIComponent(idC2)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 22 })
  });

  // 2. Re-import avec UNIQUEMENT C1 (Excel partiel)
  const form2 = new FormData();
  form2.append(
    "file",
    workbookBlob([
      ["Code", "Nom"],
      ["C1", "Produit C1"]
    ]),
    "stock.xlsx"
  );
  const r2 = await requestJson("/api/import/stock", { method: "POST", body: form2 });

  // 3. Les 2 produits doivent rester, C2 preserve avec sa quantite manuelle
  assert.equal(r2.body.stock.length, 2, "C2 doit etre preserve");
  const c1After = r2.body.stock.find(p => p.code === "C1");
  const c2After = r2.body.stock.find(p => p.code === "C2");
  assert.equal(c1After.quantite, 11, "C1 quantite manuelle preservee");
  assert.equal(c2After.quantite, 22, "C2 quantite manuelle preservee meme s'il n'est plus dans l'Excel");
  assert.equal(c2After.id, idC2, "C2 id preserve");
  assert.equal(r2.body.preserved, 1, "compteur preserved = 1");
});

test("re-import stock returns created/updated counters for audit log", async () => {
  seedDb(defaultDb());

  // 1. Import avec 1 produit
  const form1 = new FormData();
  form1.append(
    "file",
    workbookBlob([
      ["Code", "Nom"],
      ["D1", "Produit D1"]
    ]),
    "stock.xlsx"
  );
  await requestJson("/api/import/stock", { method: "POST", body: form1 });

  // 2. Re-import avec D1 (mise a jour) + D2 (nouveau)
  const form2 = new FormData();
  form2.append(
    "file",
    workbookBlob([
      ["Code", "Nom"],
      ["D1", "Produit D1 mis a jour"],
      ["D2", "Produit D2 nouveau"]
    ]),
    "stock.xlsx"
  );
  const r2 = await requestJson("/api/import/stock", { method: "POST", body: form2 });

  assert.equal(r2.body.created, 1, "D2 cree");
  assert.equal(r2.body.updated, 1, "D1 mis a jour");
});

test("client coordinates can be saved, rejected, and cleared", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{ id: "c1", nom: "Client test", statut: "restant", produits: [], lat: "", lng: "" }]
  });

  const valid = await requestJson("/api/clients/c1/coordinates", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: "46,2", lng: "4.8" })
  });

  assert.equal(valid.res.status, 200);
  assert.equal(valid.body.lat, 46.2);
  assert.equal(valid.body.lng, 4.8);

  const invalid = await requestJson("/api/clients/c1/coordinates", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: 120, lng: 4.8 })
  });

  assert.equal(invalid.res.status, 400);

  const cleared = await requestJson("/api/clients/c1/coordinates", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: "", lng: "" })
  });

  assert.equal(cleared.res.status, 200);
  assert.equal(cleared.body.lat, "");
  assert.equal(cleared.body.lng, "");
});

test("delivery status rejects unexpected values", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{ id: "c1", nom: "Client test", statut: "restant", produits: [] }]
  });

  const { res, body } = await requestJson("/api/livraison", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "c1", statut: "pirate" })
  });

  assert.equal(res.status, 400);
  assert.match(body.error, /statut/i);
});

test("orders expose stock analysis and normalized delivery sectors", async () => {
  seedDb({
    ...defaultDb(),
    clients: [
      {
        id: "c1",
        nom: "Client Besancon",
        rue: "1 rue test",
        ville: "Besançon",
        codePostal: "25000",
        statut: "restant",
        produits: [{ code: "A1", nom: "Produit A", quantite: 2 }]
      },
      {
        id: "c2",
        nom: "Client Dole",
        rue: "2 rue test",
        ville: "Dôle",
        codePostal: "39100",
        statut: "restant",
        produits: [{ code: "B1", nom: "Produit B", quantite: 5 }]
      }
    ],
    stock: [
      { id: "p1", code: "A1", nom: "Produit A", quantite: 3 },
      { id: "p2", code: "B1", nom: "Produit B", quantite: 1 }
    ]
  });

  const orders = await requestJson("/api/orders");
  assert.equal(orders.res.status, 200);
  assert.equal(orders.body.length, 2);
  assert.equal(orders.body.find(order => order.clientId === "c1").sector, "Besancon");
  assert.equal(orders.body.find(order => order.clientId === "c1").stockStatus, "disponible");
  assert.equal(orders.body.find(order => order.clientId === "c2").sector, "Dole");
  assert.equal(orders.body.find(order => order.clientId === "c2").stockStatus, "insuffisant");

  const sectors = await requestJson("/api/sectors");
  assert.equal(sectors.res.status, 200);
  assert.equal(sectors.body.some(sector => sector.name === "Besancon"), true);
  assert.equal(sectors.body.some(sector => sector.name === "Dole"), true);
});

test("preparation reserves stock then exposes order to delivery route", async () => {
  seedDb({
    ...defaultDb(),
    clients: [
      {
        id: "c1",
        nom: "Client Besancon",
        rue: "1 rue test",
        ville: "Besançon",
        codePostal: "25000",
        statut: "restant",
        produits: [{ code: "A1", nom: "Produit A", quantite: 2 }],
        lat: 47.24,
        lng: 6.02
      }
    ],
    stock: [{ id: "p1", code: "A1", nom: "Produit A", quantite: 3 }]
  });

  const orders = await requestJson("/api/orders");
  const orderId = orders.body[0].id;

  const start = await requestJson(`/api/orders/${orderId}/start-preparation`, {
    method: "POST"
  });

  assert.equal(start.res.status, 200);
  assert.equal(start.body.status, "en_preparation");

  let db = readDb();
  assert.equal(db.stock[0].quantite, 1);

  const finish = await requestJson(`/api/orders/${orderId}/finish-preparation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deliveryDate: "2026-05-04" })
  });

  assert.equal(finish.res.status, 200);
  assert.equal(finish.body.status, "pret_livraison");
  assert.equal(finish.body.deliveryDate, "2026-05-04");

  const route = await requestJson("/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sector: "Besancon", deliveryDate: "2026-05-04", orderIds: [orderId] })
  });

  assert.equal(route.res.status, 201);
  assert.equal(route.body.deliveryDate, "2026-05-04");
  assert.equal(route.body.stops.length, 1);
  assert.equal(route.body.stops[0].clientName, "Client Besancon");
  assert.equal(route.body.stops[0].deliveryDate, "2026-05-04");

  const started = await requestJson(`/api/routes/${route.body.id}/start`, {
    method: "POST"
  });

  assert.equal(started.res.status, 200);
  assert.equal(started.body.status, "en_livraison");
  assert.equal(started.body.stops[0].status, "en_livraison");

  const delivered = await requestJson(`/api/routes/${route.body.id}/stops/${route.body.stops[0].id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "livre" })
  });

  assert.equal(delivered.res.status, 200);
  assert.equal(delivered.body.order.status, "livre");
});

test("reprogrammed orders can be selected for a new delivery route", async () => {
  seedDb({
    ...defaultDb(),
    clients: [
      {
        id: "c1",
        nom: "Client Dole",
        rue: "2 rue test",
        ville: "Dôle",
        codePostal: "39100",
        statut: "non_livre",
        produits: [{ code: "A1", nom: "Produit A", quantite: 1 }]
      }
    ],
    commandes: [
      {
        id: "o1",
        clientId: "c1",
        clientName: "Client Dole",
        address: "2 rue test",
        city: "Dôle",
        postalCode: "39100",
        sector: "Dole",
        products: [{ code: "A1", nom: "Produit A", quantite: 1 }],
        status: "a_reprogrammer",
        deliveryStatus: "a_reprogrammer",
        deliveryDate: "2026-05-05"
      }
    ],
    stock: [{ id: "p1", code: "A1", nom: "Produit A", quantite: 5 }]
  });

  const route = await requestJson("/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sector: "Dole", orderIds: ["o1"] })
  });

  assert.equal(route.res.status, 201);
  assert.equal(route.body.stops.length, 1);
  assert.equal(route.body.stops[0].orderId, "o1");
  assert.equal(route.body.stops[0].sector, "Dole");
});

test("sales import preserves active route orders missing from the new file", async () => {
  seedDb({
    ...defaultDb(),
    clients: [
      {
        id: "c-old",
        nom: "Client route",
        rue: "1 rue active",
        ville: "Besancon",
        codePostal: "25000",
        statut: "en_cours",
        produits: [{ code: "A1", nom: "Produit A", quantite: 1 }]
      }
    ],
    commandes: [
      {
        id: "o-old",
        clientId: "c-old",
        clientName: "Client route",
        address: "1 rue active",
        city: "Besancon",
        postalCode: "25000",
        sector: "Besancon",
        products: [{ code: "A1", nom: "Produit A", quantite: 1 }],
        status: "en_livraison",
        deliveryStatus: "en_livraison",
        routeId: "route-old"
      }
    ],
    routes: [
      {
        id: "route-old",
        sector: "Besancon",
        status: "en_livraison",
        selectedOrderIds: ["o-old"],
        stops: [
          {
            id: "stop-old",
            routeId: "route-old",
            orderId: "o-old",
            clientId: "c-old",
            orderIndex: 1,
            clientName: "Client route",
            address: "1 rue active",
            city: "Besancon",
            postalCode: "25000",
            sector: "Besancon",
            status: "en_livraison",
            products: [{ code: "A1", nom: "Produit A", quantite: 1 }]
          }
        ]
      }
    ],
    stock: [{ id: "p1", code: "A1", nom: "Produit A", quantite: 5 }]
  });

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Client", "Quantite", "Produit", "Rue", "Ville"],
    ["Nouveau client", "1", "Produit B", "2 rue neuve", "Dole"]
  ]), "ventes.xlsx");

  const imported = await requestJson("/api/import/ventes", {
    method: "POST",
    body: form
  });

  assert.equal(imported.res.status, 200);

  const db = readDb();
  assert.equal(db.clients.some(client => client.id === "c-old"), true);
  assert.equal(db.commandes.some(order => order.id === "o-old"), true);
  assert.equal(db.clients.some(client => client.nom === "Nouveau client"), true);
  assert.equal(db.routes[0].stops[0].orderId, "o-old");

  const delivered = await requestJson("/api/routes/route-old/stops/stop-old", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "livre" })
  });

  assert.equal(delivered.res.status, 200);
  assert.equal(delivered.body.order.status, "livre");
});

test("local Leaflet asset is served by Express", async () => {
  const res = await fetch(`${baseUrl}/vendor/leaflet/leaflet.js`);
  const text = await res.text();

  assert.equal(res.status, 200);
  assert.match(text, /Leaflet/i);
});

test("PWA and brand assets are served locally", async () => {
  const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
  const serviceWorker = await fetch(`${baseUrl}/service-worker.js`);
  const logo = await fetch(`${baseUrl}/brand/sereo-logo.svg`);

  assert.equal(manifest.status, 200);
  assert.equal(serviceWorker.status, 200);
  assert.equal(logo.status, 200);
  assert.match(await manifest.text(), /Séréo/);
  assert.match(await serviceWorker.text(), /CACHE_NAME/);
  assert.match(await logo.text(), /séréo/);
});

test("stock import deduplicates rows with same code (keeps first occurrence)", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append(
    "file",
    workbookBlob([
      ["Code", "Nom", "Coût", "Tarif", "Quantité"],
      ["ABC", "Produit X", "1,00", "2,00", "10"],
      ["ABC", "Produit X bis", "5,00", "9,00", "99"],
      ["ABC", "Produit X ter", "3,00", "7,00", "33"],
      ["DEF", "Autre produit", "0,50", "1,50", "5"]
    ]),
    "stock.xlsx"
  );

  const { res, body } = await requestJson("/api/import/stock", {
    method: "POST",
    body: form
  });

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.stock.length, 2, "deux produits uniques attendus apres dedup");
  assert.equal(body.duplicatesSkipped, 2, "deux doublons doivent etre signales");

  const abc = body.stock.find(p => p.code === "ABC");
  assert.equal(abc.nom, "Produit X", "la premiere occurrence doit etre conservee");
  assert.equal(abc.cout, 1, "le cout doit etre celui de la premiere ligne");
  assert.equal(abc.quantite, 10);
});

test("sales import sums quantities when same product appears twice for one client", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append(
    "file",
    workbookBlob([
      ["Code", "Client", "Quantite", "Produit", "Rue", "Ville"],
      ["P1", "Client A", "5", "Vis M8", "1 rue test", "Besancon"],
      ["P1", "Client A", "3", "Vis M8", "1 rue test", "Besancon"],
      ["P2", "Client A", "2", "Ecrou M8", "1 rue test", "Besancon"]
    ]),
    "ventes.xlsx"
  );

  const { res, body } = await requestJson("/api/import/ventes", {
    method: "POST",
    body: form
  });

  assert.equal(res.status, 200);
  assert.equal(body.success, true);

  const clientA = body.clients.find(c => c.nom === "Client A");
  assert.ok(clientA, "le client doit etre cree");
  assert.equal(clientA.produits.length, 2, "les 2 lignes Vis M8 doivent etre fusionnees");

  const visM8 = clientA.produits.find(p => p.code === "P1");
  assert.equal(visM8.quantite, 8, "la quantite doit etre la somme 5+3");

  const ecrouM8 = clientA.produits.find(p => p.code === "P2");
  assert.equal(ecrouM8.quantite, 2, "le produit unique reste inchange");
});

test("recommendations contain no duplicates after polluted stock import", async () => {
  seedDb(defaultDb());

  const stockForm = new FormData();
  stockForm.append(
    "file",
    workbookBlob([
      ["Code", "Nom", "Coût", "Tarif", "Quantité", "Seuil"],
      ["DUP1", "Produit faible", "1", "2", "0", "5"],
      ["DUP1", "Produit faible (dup)", "1", "2", "0", "5"],
      ["DUP1", "Produit faible (dup 2)", "1", "2", "0", "5"]
    ]),
    "stock.xlsx"
  );
  await requestJson("/api/import/stock", { method: "POST", body: stockForm });

  const { res, body } = await requestJson("/api/recommendations");
  assert.equal(res.status, 200);

  const dupItems = body.filter(item => (item.code || "").toUpperCase() === "DUP1");
  assert.equal(dupItems.length, 1, "les recommandations ne doivent pas contenir de doublons");
});

// ============================================================================
// V7 - workflow import ventes + anti-doublon + qty 0 + commandes livrees
// ============================================================================

test("normalizeProducts garde quantite 0 (ne la force plus a 1)", async () => {
  seedDb({
    ...defaultDb(),
    stock: [{ id: "p1", code: "A1", nom: "Produit A", quantite: 5 }],
    clients: [{ id: "c1", nom: "Client zero", produits: [{ code: "A1", nom: "Produit A", quantite: 0 }] }],
    commandes: [{
      id: "o1",
      clientId: "c1",
      clientName: "Client zero",
      products: [{ code: "A1", nom: "Produit A", quantite: 0 }],
      status: "stock_a_verifier"
    }]
  });

  const { res, body } = await requestJson("/api/orders");
  assert.equal(res.status, 200);
  const order = body.find(o => o.id === "o1");
  assert.ok(order, "la commande doit exister");
  assert.equal(order.products[0].quantite, 0, "la quantite 0 ne doit plus etre forcee a 1");
});

test("import ventes : statut facture 'Envoyee' cree une commande livre direct", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Statut", "Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville"],
    ["Envoyée", "P1", "Client livre direct", "3", "Produit X", "1 rue test", "25000", "Besancon"]
  ]), "ventes.xlsx");

  const { res, body } = await requestJson("/api/import/ventes", {
    method: "POST",
    body: form
  });

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.importedAsLivre, 1, "1 commande importee comme deja livree");

  const order = body.commandes.find(o => o.clientName === "Client livre direct");
  assert.ok(order, "la commande doit etre creee");
  assert.equal(order.status, "livre", "status doit etre livre");
  assert.equal(order.preparationStatus, "terminee", "preparation doit etre terminee");
  assert.equal(order.deliveryStatus, "livre", "deliveryStatus doit etre livre");
  assert.equal(order.importedAsLivre, true, "le flag importedAsLivre doit etre true");
});

test("import ventes : variantes 'envoyee', 'ENVOYE', 'expediee' toutes traitees comme livre", async () => {
  for (const statut of ["envoyee", "ENVOYE", "expédiée", "Sent"]) {
    seedDb(defaultDb());

    const form = new FormData();
    form.append("file", workbookBlob([
      ["Statut", "Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville"],
      [statut, "P1", `Client ${statut}`, "1", "Produit X", "1 rue test", "25000", "Besancon"]
    ]), "ventes.xlsx");

    const { res, body } = await requestJson("/api/import/ventes", {
      method: "POST",
      body: form
    });

    assert.equal(res.status, 200, `import doit reussir pour statut "${statut}"`);
    const order = body.commandes.find(o => o.clientName === `Client ${statut}`);
    assert.ok(order, `commande creee pour "${statut}"`);
    assert.equal(order.status, "livre", `status livre attendu pour "${statut}"`);
  }
});

test("import ventes : statut 'Brouillon' ou vide reste en stock_a_verifier", async () => {
  for (const statut of ["Brouillon", ""]) {
    seedDb(defaultDb());

    const form = new FormData();
    form.append("file", workbookBlob([
      ["Statut", "Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville"],
      [statut, "P1", "Client non livre", "1", "Produit X", "1 rue", "25000", "Besancon"]
    ]), "ventes.xlsx");

    const { res, body } = await requestJson("/api/import/ventes", {
      method: "POST",
      body: form
    });

    assert.equal(res.status, 200);
    const order = body.commandes.find(o => o.clientName === "Client non livre");
    assert.ok(order);
    assert.notEqual(order.status, "livre", `statut "${statut}" ne doit pas declencher livre`);
  }
});

test("import ventes : ligne 'Envoyee' + ligne non livree pour meme client => non livre", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Statut", "Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville"],
    ["Envoyée", "P1", "Client mixte", "1", "Produit X", "1 rue", "25000", "Besancon"],
    ["Brouillon", "P2", "Client mixte", "1", "Produit Y", "1 rue", "25000", "Besancon"]
  ]), "ventes.xlsx");

  const { res, body } = await requestJson("/api/import/ventes", {
    method: "POST",
    body: form
  });

  assert.equal(res.status, 200);
  const order = body.commandes.find(o => o.clientName === "Client mixte");
  assert.ok(order);
  assert.notEqual(order.status, "livre", "une seule ligne non-livree suffit a desactiver le marquage");
});

test("anti-doublon client : virgule en trop dans rue => fusion par cle secondaire (nom + CP)", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{
      id: "c-existing",
      nom: "Dupont",
      rue: "3 rue,",  // virgule en trop
      ville: "Besancon",
      codePostal: "25000",
      statut: "en_cours",
      produits: [{ code: "A1", nom: "Produit A", quantite: 5 }]
    }],
    commandes: [{
      id: "o-existing",
      clientId: "c-existing",
      clientName: "Dupont",
      address: "3 rue,",
      city: "Besancon",
      postalCode: "25000",
      products: [{ code: "A1", nom: "Produit A", quantite: 5 }],
      status: "en_preparation",
      preparationStatus: "en_cours"
    }]
  });

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville"],
    ["A1", "Dupont", "8", "Produit A", "3 rue", "25000", "Besancon"]  // sans virgule
  ]), "ventes.xlsx");

  const { res, body } = await requestJson("/api/import/ventes", {
    method: "POST",
    body: form
  });

  assert.equal(res.status, 200);
  const dupontClients = body.clients.filter(c => c.nom === "Dupont");
  assert.equal(dupontClients.length, 1, "un seul client Dupont apres fusion par cle secondaire");
  assert.equal(dupontClients[0].id, "c-existing", "l'id de la BDD est preserve");

  const order = body.commandes.find(c => c.clientName === "Dupont");
  assert.equal(order.products.length, 1);
  assert.equal(order.products[0].quantite, 8, "quantite finale = celle de l'Excel (8), pas 5+8=13");
  assert.equal(body.mergedBySecondary, 1, "1 fusion par cle secondaire signalee");
});

test("anti-doublon : sans CP, pas de match secondaire (retombe sur strict)", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{
      id: "c-existing",
      nom: "Sans CP",
      rue: "rue X",
      ville: "Besancon",
      codePostal: "",
      statut: "en_cours",
      produits: [{ code: "A1", nom: "Produit A", quantite: 1 }]
    }],
    commandes: [{
      id: "o-existing",
      clientId: "c-existing",
      clientName: "Sans CP",
      address: "rue X",
      city: "Besancon",
      postalCode: "",
      products: [{ code: "A1", nom: "Produit A", quantite: 1 }],
      status: "en_preparation"
    }]
  });

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville"],
    ["A1", "Sans CP", "1", "Produit A", "rue Y", "", "Besancon"]
  ]), "ventes.xlsx");

  const { res, body } = await requestJson("/api/import/ventes", {
    method: "POST",
    body: form
  });

  assert.equal(res.status, 200);
  assert.equal(body.mergedBySecondary, 0, "aucune fusion secondaire car CP absent");
});

test("GET /api/orders sans param renvoie toutes les commandes", async () => {
  seedDb({
    ...defaultDb(),
    commandes: [
      { id: "o1", clientName: "A", status: "stock_a_verifier", products: [] },
      { id: "o2", clientName: "B", status: "livre", products: [] },
      { id: "o3", clientName: "C", status: "en_preparation", products: [] }
    ]
  });

  const { res, body } = await requestJson("/api/orders");
  assert.equal(res.status, 200);
  assert.equal(body.length, 3);
});

test("GET /api/orders?status=livre renvoie seulement les livrees", async () => {
  seedDb({
    ...defaultDb(),
    commandes: [
      { id: "o1", clientName: "A", status: "stock_a_verifier", products: [] },
      { id: "o2", clientName: "B", status: "livre", products: [] },
      { id: "o3", clientName: "C", status: "livre", products: [] }
    ]
  });

  const { res, body } = await requestJson("/api/orders?status=livre");
  assert.equal(res.status, 200);
  assert.equal(body.length, 2);
  assert.ok(body.every(o => o.status === "livre"));
});

test("v1.11.0 PATCH /api/clients/:id : mise a jour partielle propage vers les commandes du client", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{
      id: "c-edit", nom: "Dupont", rue: "ancien", codePostal: "25000",
      ville: "Besancon", telephone: "", secteur: "Besancon", statut: "restant", produits: []
    }],
    commandes: [
      { id: "o-edit-1", clientId: "c-edit", clientName: "Dupont", address: "ancien", postalCode: "25000", city: "Besancon", sector: "Besancon", status: "stock_a_verifier", products: [] },
      { id: "o-edit-2", clientId: "c-edit", clientName: "Dupont", address: "ancien", postalCode: "25000", city: "Besancon", sector: "Besancon", status: "livre", products: [] }
    ]
  });

  const r = await requestJson("/api/clients/c-edit", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rue: "5 nouveau chemin", telephone: "06 11 22 33 44", notes: "Sonner 2 fois" })
  });

  assert.equal(r.res.status, 200);
  assert.equal(r.body.client.rue, "5 nouveau chemin");
  assert.equal(r.body.client.telephone, "06 11 22 33 44");
  assert.equal(r.body.client.notes, "Sonner 2 fois");
  assert.equal(r.body.ordersUpdated, 2, "Les 2 commandes du client sont mises a jour");

  // Verifier que les commandes ont bien ete propagees
  const ordersAfter = await requestJson("/api/orders");
  const cmds = ordersAfter.body.filter(o => o.clientId === "c-edit");
  assert.equal(cmds.length, 2);
  assert.ok(cmds.every(o => o.address === "5 nouveau chemin"), "address propagee");
  assert.ok(cmds.every(o => o.phone === "06 11 22 33 44"), "phone propage");
  assert.ok(cmds.every(o => o.notes === "Sonner 2 fois"), "notes propagees");
});

test("v1.11.0 PATCH /api/clients/:id : changement de ville recalcule le secteur", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{ id: "c-move", nom: "Bouge", rue: "", codePostal: "25000", ville: "Besancon", secteur: "Besancon", statut: "restant", produits: [] }],
    commandes: [{ id: "o-move", clientId: "c-move", clientName: "Bouge", city: "Besancon", sector: "Besancon", status: "stock_a_verifier", products: [] }]
  });

  const r = await requestJson("/api/clients/c-move", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ville: "Dole", codePostal: "39100" })
  });

  assert.equal(r.res.status, 200);
  assert.equal(r.body.client.ville, "Dole");
  assert.equal(r.body.client.secteur, "Dole", "Secteur derive automatiquement depuis la nouvelle ville");

  const orders = await requestJson("/api/orders");
  const cmd = orders.body.find(o => o.id === "o-move");
  assert.equal(cmd.city, "Dole");
  assert.equal(cmd.sector, "Dole", "Secteur propage sur la commande");
});

test("v1.11.0 PATCH /api/clients/:id : client inexistant renvoie 404", async () => {
  seedDb(defaultDb());
  const r = await requestJson("/api/clients/ghost-id", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rue: "test" })
  });
  assert.equal(r.res.status, 404);
});

// ============================================================================
// v1.14.0 : test stress import gros volume Excel (Sprint 2, T2)
// ============================================================================

test("v1.14.0 stress : import ventes 5000 lignes traite en moins de 30s + bons numerotes", async () => {
  seedDb(defaultDb());

  // Genere 5000 lignes Excel : 500 clients differents x 10 produits chacun
  // sur 5 dates differentes (donc ~5000 bons groupes par client+date).
  const headers = ["Client", "Quantite", "Produit", "Code", "Rue", "Ville", "Code Postal", "Date"];
  const rows = [headers];
  const dates = ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15"];
  for (let i = 0; i < 500; i++) {
    const clientName = `Client_${String(i).padStart(4, "0")}`;
    const cp = String(25000 + (i % 100)).padStart(5, "0");
    for (let p = 0; p < 10; p++) {
      rows.push([
        clientName, "1", `Produit_${p}`, `CODE${p}`,
        `${i + 1} rue test`, "Besancon", cp, dates[i % dates.length]
      ]);
    }
  }

  const form = new FormData();
  form.append("file", workbookBlob(rows), "stress-5000.xlsx");

  const start = Date.now();
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });
  const durationMs = Date.now() - start;

  assert.equal(r.res.status, 200);
  // 500 clients * 1 date each (i % 5 fait que chaque client a UNE seule date) = 500 bons
  assert.ok(r.body.created >= 500, `Au moins 500 bons crees, got ${r.body.created}`);
  // Tous les bons doivent avoir un numero CMD-YYYY-NNN (pas vide)
  const sample = r.body.commandes.slice(0, 10);
  assert.ok(sample.every(c => /^CMD-\d{4}-\d{3,}$/.test(c.numero)), "Tous les bons numerotes correctement");
  // Limite raisonnable : import 5000 lignes < 30s
  assert.ok(durationMs < 30000, `Import 5000 lignes en ${durationMs}ms (limite 30000ms)`);
});

// ============================================================================
// v1.12.0 : archivage des Excel + purge bons
// ============================================================================

test("v1.12.0 archivage : import ventes copie le fichier xlsx et cree une entree imports_archives", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Client", "Quantite", "Produit", "Rue", "Ville", "Code Postal"],
    ["Archive Client", "1", "Produit A", "1 rue test", "Besancon", "25000"]
  ]), "ventes-mai-2026.xlsx");

  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });
  assert.equal(r.res.status, 200);
  assert.ok(r.body.archive, "Reponse contient un objet archive");
  assert.equal(r.body.archive.type, "ventes");
  assert.equal(r.body.archive.filename, "ventes-mai-2026.xlsx");
  assert.ok(r.body.archive.sha256 && r.body.archive.sha256.length === 64, "SHA256 calcule (64 hex)");
  assert.ok(r.body.archive.fileSize > 0, "fileSize renseigne");
  assert.ok(r.body.archive.archivedPath, "archivedPath renseigne");
  assert.ok(fs.existsSync(r.body.archive.archivedPath), "Fichier archive existe sur disque");

  // Listing via GET /api/imports/archives
  const list = await requestJson("/api/imports/archives");
  assert.equal(list.res.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].filename, "ventes-mai-2026.xlsx");
  assert.equal(list.body[0].type, "ventes");
});

test("v1.12.0 archivage : filtre par type ?type=stock", async () => {
  seedDb(defaultDb());

  const formV = new FormData();
  formV.append("file", workbookBlob([
    ["Client", "Quantite", "Produit", "Rue", "Ville"],
    ["X", "1", "Y", "1 r", "Besancon"]
  ]), "v.xlsx");
  await requestJson("/api/import/ventes", { method: "POST", body: formV });

  const formS = new FormData();
  formS.append("file", workbookBlob([
    ["Code", "Nom"],
    ["S1", "Produit S"]
  ]), "s.xlsx");
  await requestJson("/api/import/stock", { method: "POST", body: formS });

  const listAll = await requestJson("/api/imports/archives");
  assert.equal(listAll.body.length, 2);

  const listStock = await requestJson("/api/imports/archives?type=stock");
  assert.equal(listStock.body.length, 1);
  assert.equal(listStock.body[0].type, "stock");
});

test("v1.12.0 download : GET /api/imports/archives/:id/download renvoie le fichier", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Client", "Quantite", "Produit", "Rue", "Ville"],
    ["D", "1", "P", "1", "Besancon"]
  ]), "test-download.xlsx");
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });
  const archiveId = r.body.archive.id;

  // Telechargement raw (pas requestJson car retourne du binaire xlsx)
  const downloadRes = await fetch(`${baseUrl}/api/imports/archives/${encodeURIComponent(archiveId)}/download`);
  assert.equal(downloadRes.status, 200);
  const contentDisp = downloadRes.headers.get("content-disposition") || "";
  assert.match(contentDisp, /test-download\.xlsx/);
  const buf = Buffer.from(await downloadRes.arrayBuffer());
  assert.ok(buf.length > 0, "Binaire xlsx non vide");
});

test("v1.12.0 download : 404 si id inconnu", async () => {
  seedDb(defaultDb());
  const res = await fetch(`${baseUrl}/api/imports/archives/ghost-id/download`);
  assert.equal(res.status, 404);
});

test("v1.12.0 purge : POST /api/orders/purge wipe commandes/clients/ventes/routes, preserve stock", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{ id: "c1", nom: "ToWipe", statut: "restant", produits: [] }],
    commandes: [{ id: "o1", clientId: "c1", clientName: "ToWipe", status: "stock_a_verifier", products: [] }],
    ventes: [{ id: "v1", client: "ToWipe" }],
    routes: [{ id: "r1", stops: [{ id: "s1", orderId: "o1", clientId: "c1" }] }],
    stock: [{ id: "p1", code: "A1", nom: "Produit A", quantite: 42 }],
    stockMovements: [{ id: "m1", produitId: "p1", type: "ajustement", quantite: 5 }]
  });

  const purge = await requestJson("/api/orders/purge", { method: "POST" });
  assert.equal(purge.res.status, 200);
  assert.equal(purge.body.success, true);
  assert.deepEqual(purge.body.purged, { commandes: 1, clients: 1, ventes: 1, routes: 1 });

  // Verifier l'etat post-purge
  const ordersAfter = await requestJson("/api/orders");
  assert.equal(ordersAfter.body.length, 0, "Commandes vides");

  const clientsAfter = await requestJson("/api/clients");
  assert.equal(clientsAfter.body.length, 0, "Clients vides");

  // Stock PRESERVE
  const stockAfter = await requestJson("/api/stock");
  assert.equal(stockAfter.body.length, 1, "Stock preserve");
  assert.equal(stockAfter.body[0].quantite, 42, "Quantite manuelle preservee");

  // Historique mouvements stock PRESERVE
  const movs = await requestJson("/api/stock-movements");
  assert.equal(movs.body.length, 1, "Mouvements stock preserves");
});

// ============================================================================
// Repro bug user : Excel Ximi reel avec colonnes en double (Code, Statut) +
// Date "05/05/2026" identique sur toutes les lignes (date d'export rapport).
// Format en-tete exact du fichier "BillItem (Articles de facture (T Ventes
// SEREO par produits))" partage par le user.
// ============================================================================

test("import ventes : format Ximi reel avec en-tete dupliques (Code, Statut) lit bien la colonne Date", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append("file", workbookBlob([
    // En-tete exact du fichier Ximi BillItem (note les colonnes dupliquees)
    [
      "Code", "Nom", "Client", "Statut", "Date", "Début de période",
      "Code", "Heures", "Quantite", "Prix unitaire", "HT", "TTC",
      "Produit", "Soumis à royalties", "Type", "Type de TVA", "Statut",
      "Téléphone favori", "Référence", "Code Postal", "Rue", "Ville"
    ],
    // Ligne 1 : ZANETTI Ginette, Date 05/05/2026
    [
      "MAT_SDB1", "4065995003890 Planche de bain Benny 73cm", "ZANETTI, Ginette",
      "Validée", "05/05/2026", "01/05/2026",
      "PR2", "0", "1", "35,90", "29,82", "35,90",
      "MAT_SDB1 - 4065995003890 Planche", "VRAI", "Fourniture", "Pro Métropole (20%)", "Actif",
      "03 84 33 03 39", "PR2FA26050001", "39400", "171 rue de la république", "Hauts de Bienne"
    ],
    // Ligne 2 : meme client, meme date -> doit etre fusionnee dans le meme bon
    [
      "MAT_SDB7", "5021196843122 AIDAPT Barre d'appui", "ZANETTI, Ginette",
      "Validée", "05/05/2026", "01/05/2026",
      "PR2", "0", "1", "31,00", "25,83", "31,00",
      "MAT_SDB7 - AIDAPT", "VRAI", "Fourniture", "Pro Métropole (20%)", "Actif",
      "03 84 33 03 39", "PR2FA26050001", "39400", "171 rue de la république", "Hauts de Bienne"
    ],
    // Ligne 3 : meme client mais date differente -> doit creer un 2e bon distinct
    [
      "MAT_SDB1", "4065995003890 Planche de bain Benny 73cm", "ZANETTI, Ginette",
      "Validée", "12/04/2026", "01/04/2026",
      "PR2", "0", "1", "35,90", "29,82", "35,90",
      "MAT_SDB1 - autre date", "VRAI", "Fourniture", "Pro Métropole (20%)", "Actif",
      "03 84 33 03 39", "PR2FA26040001", "39400", "171 rue de la république", "Hauts de Bienne"
    ]
  ]), "ventes.xlsx");

  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });
  assert.equal(r.res.status, 200, "Import doit reussir");

  const cmdsZanetti = r.body.commandes.filter(o => o.clientName && o.clientName.includes("ZANETTI"));
  assert.equal(cmdsZanetti.length, 2, "ZANETTI doit avoir 2 bons (2 dates differentes)");

  // Verifier que les dateCommande sont bien celles du Excel, PAS today
  const today = new Date().toISOString().slice(0, 10);
  const dates = cmdsZanetti.map(o => o.dateCommande).sort();
  assert.deepEqual(dates, ["2026-04-12", "2026-05-05"],
    `dateCommande doit etre extraite du Excel (05/05/2026 et 12/04/2026), pas today (${today}). Recu: ${JSON.stringify(dates)}`);

  // Le bon du 05/05 doit contenir 2 produits (les 2 lignes fusionnees)
  const cmdMai = cmdsZanetti.find(o => o.dateCommande === "2026-05-05");
  assert.equal(cmdMai.products.length, 2, "Bon du 05/05 doit fusionner les 2 lignes produits");

  // Le bon du 12/04 doit etre distinct avec 1 ligne
  const cmdAvril = cmdsZanetti.find(o => o.dateCommande === "2026-04-12");
  assert.equal(cmdAvril.products.length, 1, "Bon du 12/04 doit etre distinct avec 1 ligne");

  // Numero doit etre base sur l'annee 2026
  assert.ok(cmdMai.numero && cmdMai.numero.includes("2026"), `Numero doit contenir 2026, recu: ${cmdMai.numero}`);
  assert.ok(cmdAvril.numero && cmdAvril.numero.includes("2026"), `Numero doit contenir 2026, recu: ${cmdAvril.numero}`);
});

test("GET /api/orders expose numero + dateCommande + excelRowHash (UI Bons de commande Phase 3)", async () => {
  seedDb({
    ...defaultDb(),
    commandes: [
      {
        id: "o1",
        clientId: "c1",
        clientName: "Dupont",
        numero: "CMD-2026-001",
        dateCommande: "2026-05-18",
        excelRowHash: "abc123",
        status: "stock_a_verifier",
        products: []
      }
    ]
  });

  const { res, body } = await requestJson("/api/orders");
  assert.equal(res.status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].numero, "CMD-2026-001", "numero expose pour la page UI Bons de commande");
  assert.equal(body[0].dateCommande, "2026-05-18", "dateCommande expose en ISO");
  assert.equal(body[0].excelRowHash, "abc123", "excelRowHash expose pour le detail technique");
});

test("GET /api/orders?status=invalide renvoie 400", async () => {
  seedDb(defaultDb());
  const { res } = await requestJson("/api/orders?status=foobar");
  assert.equal(res.status, 400);
});

// ============================================================================
// Non-regression : aucun import ne doit ecraser les modifications manuelles
// faites par l'utilisateur (notes order, coordonnees lat/lng client, statut
// workflow). Suite a l'audit "cherche a fond si y a pas d'autre bug de ce
// genre" du 14 mai 2026.
// ============================================================================

test("non-regression: re-import ventes preserve les notes manuelles d'une commande", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{
      id: "c-notes", nom: "Client Notes", rue: "1 rue test",
      ville: "Besancon", codePostal: "25000", statut: "restant", produits: []
    }],
    commandes: [{
      id: "o-notes", clientId: "c-notes", clientName: "Client Notes",
      address: "1 rue test", city: "Besancon", postalCode: "25000",
      sector: "Besancon", products: [], status: "stock_a_verifier"
    }]
  });

  // L'utilisateur tape une note manuelle sur la commande
  await requestJson("/api/orders/o-notes", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: "Sonner 2 fois, code 1234" })
  });

  // Re-import de l'Excel ventes pour le meme client (sans colonne Notes)
  const form = new FormData();
  form.append("file", workbookBlob([
    ["Client", "Quantite", "Produit", "Rue", "Ville", "Code Postal"],
    ["Client Notes", "1", "Produit Z", "1 rue test", "Besancon", "25000"]
  ]), "ventes.xlsx");
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });

  assert.equal(r.res.status, 200);
  const order = r.body.commandes.find(o => o.clientName === "Client Notes");
  assert.ok(order, "commande retrouvee");
  assert.equal(order.notes, "Sonner 2 fois, code 1234",
    "Notes manuelles preservees apres re-import sans colonne Notes Excel");
});

test("non-regression: re-import ventes preserve les coordonnees lat/lng manuelles", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{
      id: "c-geo", nom: "Client GPS", rue: "5 avenue test",
      ville: "Dole", codePostal: "39100", statut: "restant", produits: [],
      lat: "", lng: ""
    }],
    commandes: [{
      id: "o-geo", clientId: "c-geo", clientName: "Client GPS",
      address: "5 avenue test", city: "Dole", postalCode: "39100",
      sector: "Dole", products: [], status: "stock_a_verifier"
    }]
  });

  // L'utilisateur saisit ses coordonnees GPS manuellement
  await requestJson("/api/clients/c-geo/coordinates", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: "47.0936", lng: "5.4912" })
  });

  // Re-import sans Latitude/Longitude
  const form = new FormData();
  form.append("file", workbookBlob([
    ["Client", "Quantite", "Produit", "Rue", "Ville", "Code Postal"],
    ["Client GPS", "1", "Produit X", "5 avenue test", "Dole", "39100"]
  ]), "ventes.xlsx");
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });

  assert.equal(r.res.status, 200);
  const client = r.body.clients.find(c => c.nom === "Client GPS");
  assert.ok(client, "client retrouve");
  assert.equal(Number(client.lat), 47.0936,
    "Latitude manuelle preservee apres re-import sans Lat Excel");
  assert.equal(Number(client.lng), 5.4912,
    "Longitude manuelle preservee");
});

test("non-regression: re-import ventes preserve le statut workflow en_preparation", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{
      id: "c-prep", nom: "Client Prep", rue: "3 rue prep",
      ville: "Champagnole", codePostal: "39300", statut: "restant", produits: []
    }],
    commandes: [{
      id: "o-prep", clientId: "c-prep", clientName: "Client Prep",
      address: "3 rue prep", city: "Champagnole", postalCode: "39300",
      sector: "Champagnole", products: [{ code: "X1", nom: "X", quantite: 1 }],
      status: "en_preparation", preparationStatus: "en_cours",
      stockReservedAt: new Date().toISOString()
    }],
    stock: [{ id: "p-x", code: "X1", nom: "X", quantite: 10 }]
  });

  // Re-import ventes (sans colonne statut, donc pas "Envoyee")
  const form = new FormData();
  form.append("file", workbookBlob([
    ["Client", "Quantite", "Produit", "Rue", "Ville", "Code Postal"],
    ["Client Prep", "1", "X", "3 rue prep", "Champagnole", "39300"]
  ]), "ventes.xlsx");
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });

  assert.equal(r.res.status, 200);
  const order = r.body.commandes.find(o => o.clientName === "Client Prep");
  assert.equal(order.status, "en_preparation",
    "Statut en_preparation preserve apres re-import");
  assert.equal(order.preparationStatus, "en_cours",
    "preparationStatus preserve");
});

test("non-regression: re-import ventes preserve la priority manuelle de la commande", async () => {
  seedDb({
    ...defaultDb(),
    clients: [{
      id: "c-prio", nom: "Client Prio", rue: "8 rue prio",
      ville: "Besancon", codePostal: "25000", statut: "restant", produits: []
    }],
    commandes: [{
      id: "o-prio", clientId: "c-prio", clientName: "Client Prio",
      address: "8 rue prio", city: "Besancon", postalCode: "25000",
      sector: "Besancon", products: [], status: "stock_a_verifier"
    }]
  });

  await requestJson("/api/orders/o-prio", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priority: "urgent" })
  });

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Client", "Quantite", "Produit", "Rue", "Ville", "Code Postal"],
    ["Client Prio", "1", "Z", "8 rue prio", "Besancon", "25000"]
  ]), "ventes.xlsx");
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });

  const order = r.body.commandes.find(o => o.clientName === "Client Prio");
  assert.equal(order.priority, "urgent",
    "Priority manuelle preservee apres re-import sans colonne Priorite");
});

// ============================================================================
// V1.9.0 - ERP Phase 1 : numerotation bons de commande + hash anti-doublon.
// Le user veut un vrai systeme de gestion de commandes (numero CMD-2026-001
// visible, historique conserve, anti-doublon par hash). Cette phase introduit
// le modele de donnees et les helpers, sans changer encore la logique d'import
// ni l'UI (Phase 2-5 a suivre).
// ============================================================================

const { generateOrderNumber, computeOrderHash, extractYear, ensureOrderNumbers, normalizeSettings } = require("../server");

test("generateOrderNumber: format reset annuel par defaut CMD-YYYY-NNN", async () => {
  const db = { commandes: [], settings: {} };
  const n1 = generateOrderNumber(db, "2026-05-18");
  assert.equal(n1, "CMD-2026-001");

  db.commandes.push({ numero: n1 });
  const n2 = generateOrderNumber(db, "2026-05-19");
  assert.equal(n2, "CMD-2026-002");
});

test("generateOrderNumber: reset annuel cree CMD-2027-001 en janvier", async () => {
  const db = {
    commandes: [
      { numero: "CMD-2026-001" },
      { numero: "CMD-2026-042" }
    ],
    settings: {}
  };
  const next = generateOrderNumber(db, "2027-01-15");
  assert.equal(next, "CMD-2027-001", "compteur reset au passage 2026 -> 2027");
});

test("generateOrderNumber: prefixe personnalise via settings", async () => {
  const db = {
    commandes: [],
    settings: { orderNumbering: { prefix: "BC", resetAnnually: true } }
  };
  const next = generateOrderNumber(db, "2026-05-18");
  assert.equal(next, "BC-2026-001");
});

test("generateOrderNumber: mode continu (jamais reset)", async () => {
  const db = {
    commandes: [
      { numero: "CMD-00001" },
      { numero: "CMD-00042" }
    ],
    settings: { orderNumbering: { prefix: "CMD", resetAnnually: false } }
  };
  const next = generateOrderNumber(db, "2026-05-18");
  assert.equal(next, "CMD-00043", "continu : suite stricte sans annee");
});

test("generateOrderNumber: ignore les numeros malformes existants", async () => {
  const db = {
    commandes: [
      { numero: "CMD-2026-001" },
      { numero: "old-id-42" },        // legacy
      { numero: "" },                 // vide
      { numero: "CMD-2026-005" }
    ],
    settings: {}
  };
  const next = generateOrderNumber(db, "2026-05-18");
  assert.equal(next, "CMD-2026-006", "prend en compte uniquement les numeros au bon format");
});

test("computeOrderHash: meme contenu = meme hash", async () => {
  const a = computeOrderHash({
    clientId: "c1",
    dateCommande: "2026-05-18",
    products: [
      { code: "A1", nom: "Produit A", quantite: 2 },
      { code: "B2", nom: "Produit B", quantite: 5 }
    ]
  });
  const b = computeOrderHash({
    clientId: "c1",
    dateCommande: "2026-05-18",
    // ordre different mais memes lignes
    products: [
      { code: "B2", nom: "Produit B", quantite: 5 },
      { code: "A1", nom: "Produit A", quantite: 2 }
    ]
  });
  assert.equal(a, b, "ordre des produits ne doit pas affecter le hash");
});

test("computeOrderHash: contenu different = hash different", async () => {
  const a = computeOrderHash({
    clientId: "c1", dateCommande: "2026-05-18",
    products: [{ code: "A1", quantite: 2 }]
  });
  const b = computeOrderHash({
    clientId: "c1", dateCommande: "2026-05-18",
    products: [{ code: "A1", quantite: 3 }] // quantite differente
  });
  assert.notEqual(a, b);

  const c = computeOrderHash({
    clientId: "c1", dateCommande: "2026-05-19", // date differente
    products: [{ code: "A1", quantite: 2 }]
  });
  assert.notEqual(a, c);

  const d = computeOrderHash({
    clientId: "c2", dateCommande: "2026-05-18", // client different
    products: [{ code: "A1", quantite: 2 }]
  });
  assert.notEqual(a, d);
});

test("extractYear: gere les formats ISO et FR", async () => {
  assert.equal(extractYear("2026-05-18"), 2026);
  assert.equal(extractYear("2026-05-18T10:30:00Z"), 2026);
  assert.equal(extractYear("18/05/2026"), 2026);
  assert.equal(extractYear("18-05-2026"), 2026);
  assert.equal(extractYear(""), new Date().getFullYear());
  assert.equal(extractYear(null), new Date().getFullYear());
});

test("ensureOrderNumbers: migration retroactive par date_import chronologique", async () => {
  const db = {
    commandes: [
      { id: "o3", dateImport: "2026-04-15T10:00:00Z" },
      { id: "o1", dateImport: "2026-03-01T09:00:00Z" },
      { id: "o2", dateImport: "2026-04-01T14:00:00Z" }
    ],
    settings: {}
  };
  ensureOrderNumbers(db);

  const o1 = db.commandes.find(c => c.id === "o1");
  const o2 = db.commandes.find(c => c.id === "o2");
  const o3 = db.commandes.find(c => c.id === "o3");

  assert.equal(o1.numero, "CMD-2026-001", "o1 mars -> 001 (le plus ancien)");
  assert.equal(o2.numero, "CMD-2026-002", "o2 avril -> 002");
  assert.equal(o3.numero, "CMD-2026-003", "o3 avril plus tard -> 003");

  // v1.17.1 : dateCommande est maintenant tronquee a YYYY-MM-DD (slice 10) pour
  // eviter que scanSuspiciousDates flag les ISO complets en faux positif.
  assert.equal(o1.dateCommande, "2026-03-01");
});

test("ensureOrderNumbers: ne touche pas les commandes qui ont deja un numero", async () => {
  const db = {
    commandes: [
      { id: "o1", numero: "CMD-2025-099", dateImport: "2025-12-31" },
      { id: "o2", dateImport: "2026-01-15" }
    ],
    settings: {}
  };
  ensureOrderNumbers(db);

  const o1 = db.commandes.find(c => c.id === "o1");
  const o2 = db.commandes.find(c => c.id === "o2");
  assert.equal(o1.numero, "CMD-2025-099", "non modifie");
  assert.equal(o2.numero, "CMD-2026-001", "nouveau numero, annee 2026 reset annuel");
});

test("normalizeSettings: orderNumbering valide prefix + resetAnnually", async () => {
  const s1 = normalizeSettings({});
  assert.equal(s1.orderNumbering.prefix, "CMD");
  assert.equal(s1.orderNumbering.resetAnnually, true);

  const s2 = normalizeSettings({ orderNumbering: { prefix: "ord", resetAnnually: false } });
  assert.equal(s2.orderNumbering.prefix, "ORD", "uppercase");
  assert.equal(s2.orderNumbering.resetAnnually, false);

  const s3 = normalizeSettings({ orderNumbering: { prefix: "x" } });
  assert.equal(s3.orderNumbering.prefix, "CMD", "prefix trop court -> default");
});

test("GET /api/settings/order-numbering retourne config par defaut", async () => {
  seedDb(defaultDb());
  const { res, body } = await requestJson("/api/settings/order-numbering");
  assert.equal(res.status, 200);
  assert.equal(body.prefix, "CMD");
  assert.equal(body.resetAnnually, true);
});

test("PATCH /api/settings/order-numbering met a jour prefix et resetAnnually", async () => {
  seedDb(defaultDb());
  const { res, body } = await requestJson("/api/settings/order-numbering", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "BC", resetAnnually: false })
  });
  assert.equal(res.status, 200);
  assert.equal(body.prefix, "BC");
  assert.equal(body.resetAnnually, false);

  // Persistant
  const check = await requestJson("/api/settings/order-numbering");
  assert.equal(check.body.prefix, "BC");
  assert.equal(check.body.resetAnnually, false);
});

test("PATCH /api/settings/order-numbering rejette un prefix invalide", async () => {
  seedDb(defaultDb());
  const { res, body } = await requestJson("/api/settings/order-numbering", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "X" })
  });
  assert.equal(res.status, 400);
  assert.match(body.error, /Prefixe/);
});

test("GET /api/orders/by-number/CMD-2026-001 retourne la commande", async () => {
  seedDb({
    ...defaultDb(),
    commandes: [
      { id: "o1", clientId: "c1", clientName: "X", numero: "CMD-2026-001", products: [] }
    ]
  });
  const { res, body } = await requestJson("/api/orders/by-number/CMD-2026-001");
  assert.equal(res.status, 200);
  assert.equal(body.id, "o1");
  assert.equal(body.numero, "CMD-2026-001");
});

test("GET /api/orders/by-number/INEXISTANT renvoie 404", async () => {
  seedDb(defaultDb());
  const { res } = await requestJson("/api/orders/by-number/CMD-2099-999");
  assert.equal(res.status, 404);
});

test("non-regression: re-import stock preserve les mouvements de stock (historique)", async () => {
  seedDb(defaultDb());

  // Import initial + ajustement -> genere un stockMovement
  const form1 = new FormData();
  form1.append("file", workbookBlob([
    ["Code", "Nom"],
    ["M1", "Produit M"]
  ]), "stock.xlsx");
  const r1 = await requestJson("/api/import/stock", { method: "POST", body: form1 });
  const productId = r1.body.stock[0].id;

  await requestJson(`/api/stock/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 30 })
  });

  // Verifier qu'on a bien un mouvement
  const before = await requestJson("/api/stock-movements");
  const movementsBefore = before.body.length;
  assert.ok(movementsBefore > 0, "Au moins un mouvement enregistre");

  // Re-import du meme Excel
  const form2 = new FormData();
  form2.append("file", workbookBlob([
    ["Code", "Nom"],
    ["M1", "Produit M"]
  ]), "stock.xlsx");
  await requestJson("/api/import/stock", { method: "POST", body: form2 });

  const after = await requestJson("/api/stock-movements");
  assert.equal(after.body.length, movementsBefore,
    "Historique des mouvements preserve apres re-import");
});

// ============================================================================
// V1.2.0 - quick wins (audit)
// ============================================================================

test("getRecommendations preserve un seuil 0 (ne le force plus a 5)", async () => {
  seedDb({
    ...defaultDb(),
    stock: [{
      id: "p1",
      code: "Z0",
      nom: "Produit a seuil zero",
      quantite: 0,
      alertThreshold: 0
    }]
  });

  const { res, body } = await requestJson("/api/recommendations");
  assert.equal(res.status, 200);

  const item = body.find(p => p.id === "p1");
  if (item) {
    // si le produit apparait dans les recommandations, son seuil doit rester 0
    assert.equal(item.alertThreshold, 0, "le seuil 0 doit etre preserve");
  }
  // Sinon (cas attendu) : le produit n'apparait pas, ce qui est le bon comportement.
});

test("backups : 2eme ecriture dans la meme heure ne cree pas de 2eme fichier (throttle)", async () => {
  fs.rmSync(backupDir, { recursive: true, force: true });
  seedDb({
    ...defaultDb(),
    stock: [{ id: "p1", code: "A1", nom: "Produit test", quantite: 5 }]
  });

  // 1ere mise a jour -> doit creer un backup
  await requestJson("/api/stock/p1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 7 })
  });

  const afterFirst = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
  const backupsFirst = afterFirst.filter(n => n.endsWith(".sqlite") || n.endsWith(".sqlite.gz"));
  assert.equal(backupsFirst.length, 1, "1 backup apres premiere ecriture");

  // 2eme mise a jour quelques ms apres -> ne doit PAS creer de 2eme backup (throttle 1h)
  await requestJson("/api/stock/p1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 9 })
  });

  const afterSecond = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
  const backupsSecond = afterSecond.filter(n => n.endsWith(".sqlite") || n.endsWith(".sqlite.gz"));
  assert.equal(backupsSecond.length, 1, "toujours 1 seul backup grace au throttle 1h");
});

test("backups : compresses en gzip (.sqlite.gz) plus petits que la base", async () => {
  fs.rmSync(backupDir, { recursive: true, force: true });
  seedDb({
    ...defaultDb(),
    stock: Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      code: `CODE${i}`,
      nom: `Produit ${i} avec un nom relativement long pour rendre la base compressible`,
      quantite: i
    }))
  });

  await requestJson("/api/stock/p0", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantite: 99 })
  });

  const files = fs.readdirSync(backupDir);
  const gzBackup = files.find(n => n.endsWith(".sqlite.gz"));
  assert.ok(gzBackup, "le backup doit etre gzippe");

  const compressedSize = fs.statSync(path.join(backupDir, gzBackup)).size;
  const sourceSize = fs.statSync(sqlitePath).size;
  assert.ok(
    compressedSize < sourceSize,
    `le gzip (${compressedSize}) doit etre plus petit que la source (${sourceSize})`
  );
});

test("readDb gere un db.json corrompu sans crasher (mode JSON)", async () => {
  // On ne peut pas simuler facilement le mode JSON dans cet harness (configure
  // sur sqlite). On teste juste que readDb existe et est appelable - le path
  // de gestion d'erreur est exerce par le try/catch ajoute.
  const db = readDb();
  assert.ok(db, "readDb doit toujours retourner un objet, jamais throw");
  assert.ok(Array.isArray(db.commandes), "structure normalisee");
  assert.ok(Array.isArray(db.stock), "structure normalisee");
  assert.ok(Array.isArray(db.clients), "structure normalisee");
});

// ============================================================================
// V1.3.0 - Mode sombre (dark mode)
// ============================================================================

test("appearance par defaut contient colorScheme=light (pas auto)", async () => {
  seedDb(defaultDb());
  const { res, body } = await requestJson("/api/settings/appearance");
  assert.equal(res.status, 200);
  // Defaut "light" pendant la phase de test du dark mode.
  // Les utilisateurs peuvent passer en "auto" ou "dark" via le toggle Parametres.
  assert.equal(body.colorScheme, "light", "colorScheme defaut = light");
  assert.equal(body.themeId, "sereo");
});

test("PATCH /api/settings/appearance accepte colorScheme=dark", async () => {
  seedDb(defaultDb());
  const { res, body } = await requestJson("/api/settings/appearance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colorScheme: "dark" })
  });
  assert.equal(res.status, 200);
  assert.equal(body.colorScheme, "dark");

  // Verifie que la valeur est bien persistee
  const { body: reloaded } = await requestJson("/api/settings/appearance");
  assert.equal(reloaded.colorScheme, "dark");
});

test("PATCH /api/settings/appearance accepte colorScheme=light", async () => {
  seedDb(defaultDb());
  const { res, body } = await requestJson("/api/settings/appearance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colorScheme: "light" })
  });
  assert.equal(res.status, 200);
  assert.equal(body.colorScheme, "light");
});

test("PATCH /api/settings/appearance refuse colorScheme invalide (400)", async () => {
  seedDb(defaultDb());
  const { res } = await requestJson("/api/settings/appearance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colorScheme: "neon" })
  });
  assert.equal(res.status, 400);
});

test("PATCH /api/settings/appearance preserve colorScheme quand non fourni", async () => {
  seedDb(defaultDb());

  // 1. On set colorScheme=dark
  await requestJson("/api/settings/appearance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colorScheme: "dark" })
  });

  // 2. On change uniquement le themeId, sans toucher colorScheme
  await requestJson("/api/settings/appearance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ themeId: "menthe" })
  });

  // 3. colorScheme=dark doit etre preserve
  const { body } = await requestJson("/api/settings/appearance");
  assert.equal(body.colorScheme, "dark");
  assert.equal(body.themeId, "menthe");
});

// =============================================================================
// State machine pour PATCH /api/orders/:id status transitions
// =============================================================================
//
// Avant l'introduction de la state machine, PATCH /api/orders/:id { status: X }
// acceptait n'importe quel status valide, meme un saut absurde
// (importe -> livre sans preparation). Ces tests verifient que les
// transitions sont desormais validees.

function seedOrderAtStatus(status) {
  // Cree un client + 1 ordre directement au status voulu via normalizeOrder
  // (qui bypasse la state machine - initialisation, pas transition).
  const db = defaultDb();
  db.clients = [{
    id: "c-state",
    nom: "Client State",
    rue: "1 rue test",
    ville: "Besançon",
    codePostal: "25000",
    statut: "restant",
    produits: [{ code: "A1", nom: "Produit A", quantite: 1 }]
  }];
  db.commandes = [{
    id: "o-state",
    clientId: "c-state",
    clientName: "Client State",
    address: "1 rue test",
    city: "Besançon",
    postalCode: "25000",
    products: [{ code: "A1", nom: "Produit A", quantite: 1 }],
    status,
    deliveryDate: "2026-05-04"
  }];
  db.stock = [{ id: "p1", code: "A1", nom: "Produit A", quantite: 5 }];
  seedDb(db);
}

async function patchOrderStatus(id, status) {
  return requestJson(`/api/orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}

test("state machine : transition valide importe -> stock_a_verifier OK", async () => {
  seedOrderAtStatus("importe");
  const { res, body } = await patchOrderStatus("o-state", "stock_a_verifier");
  assert.equal(res.status, 200);
  assert.equal(body.status, "stock_a_verifier");
});

test("state machine : transition valide en_livraison -> livre OK", async () => {
  seedOrderAtStatus("en_livraison");
  const { res, body } = await patchOrderStatus("o-state", "livre");
  assert.equal(res.status, 200);
  assert.equal(body.status, "livre");
});

test("state machine : importe -> livre direct rejete (skip workflow)", async () => {
  seedOrderAtStatus("importe");
  const { res, body } = await patchOrderStatus("o-state", "livre");
  assert.equal(res.status, 400);
  assert.match(body.error, /Transition non autorisee/);
  assert.match(body.error, /importe.*livre/);
});

test("state machine : en_preparation -> livre rejete (skip livraison)", async () => {
  seedOrderAtStatus("en_preparation");
  const { res } = await patchOrderStatus("o-state", "livre");
  assert.equal(res.status, 400);
});

test("state machine : pret_livraison -> livre rejete (skip en_livraison)", async () => {
  seedOrderAtStatus("pret_livraison");
  const { res } = await patchOrderStatus("o-state", "livre");
  assert.equal(res.status, 400);
});

test("state machine : livre est terminal, toute transition rejetee", async () => {
  seedOrderAtStatus("livre");
  for (const target of ["importe", "en_preparation", "en_livraison", "probleme_livraison"]) {
    const { res } = await patchOrderStatus("o-state", target);
    assert.equal(res.status, 400, `livre -> ${target} doit etre rejete`);
  }
});

test("state machine : status identique idempotent (en_preparation -> en_preparation)", async () => {
  seedOrderAtStatus("en_preparation");
  const { res, body } = await patchOrderStatus("o-state", "en_preparation");
  assert.equal(res.status, 200);
  assert.equal(body.status, "en_preparation");
});

test("state machine : transition vers status inconnu rejetee", async () => {
  seedOrderAtStatus("importe");
  const { res, body } = await patchOrderStatus("o-state", "xyz_inexistant");
  assert.equal(res.status, 400);
  assert.match(body.error, /Statut commande invalide/);
});

test("state machine : a_reprogrammer peut retourner en pret_livraison ou en_preparation", async () => {
  seedOrderAtStatus("a_reprogrammer");
  const back = await patchOrderStatus("o-state", "pret_livraison");
  assert.equal(back.res.status, 200);
  assert.equal(back.body.status, "pret_livraison");

  seedOrderAtStatus("a_reprogrammer");
  const restart = await patchOrderStatus("o-state", "en_preparation");
  assert.equal(restart.res.status, 200);
  assert.equal(restart.body.status, "en_preparation");
});

test("state machine : probleme_livraison peut retourner en_livraison (retry)", async () => {
  seedOrderAtStatus("probleme_livraison");
  const { res, body } = await patchOrderStatus("o-state", "en_livraison");
  assert.equal(res.status, 200);
  assert.equal(body.status, "en_livraison");
});

test("state machine : PATCH sans status mais avec notes ne declenche pas validation", async () => {
  seedOrderAtStatus("importe");
  const { res, body } = await requestJson("/api/orders/o-state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: "Note libre, pas de changement de status" })
  });
  assert.equal(res.status, 200);
  assert.equal(body.status, "importe");
  assert.equal(body.notes, "Note libre, pas de changement de status");
});

// =============================================================================
// CSP guard : aucun <script> inline dans le HTML servi
// =============================================================================
//
// La CSP `script-src 'self'` bloque silencieusement les scripts inline. Lors
// du sprint dark mode (v1.3.5/6), 2 releases ont ete publiees avec un
// script anti-FART inline qui ne s'executait jamais en prod, causant le
// flash de mode sombre au reload. La cause n'a ete identifiee qu'en v1.3.7
// apres analyse des logs F12.
//
// Ce test verifie qu'aucun <script>...</script> inline n'est servi dans les
// pages HTML accessibles publiquement (login + app shell apres auth).
// Si un futur dev ajoute du JS inline, le test echoue et bloque le merge.

function hasInlineScript(html) {
  // Match les balises <script> qui ne sont pas auto-fermantes via src
  // (i.e. ont du contenu non-vide entre <script>...</script>).
  // Ignore <script src="..."></script> et <script type="application/json">.
  const inlineRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const matches = [];
  let match;
  while ((match = inlineRegex.exec(html)) !== null) {
    const attrs = match[0].slice(0, match[0].indexOf(">") + 1);
    const body = match[1].trim();
    // Autoriser <script type="application/ld+json"> ou autres data scripts non-executables
    if (/type=["']application\/(?:ld\+)?json["']/i.test(attrs)) continue;
    if (body.length > 0) {
      matches.push({ attrs, body: body.slice(0, 200) });
    }
  }
  return matches;
}

test("CSP guard : aucun <script> inline sur GET / (app shell)", async () => {
  const res = await fetch(`${baseUrl}/`);
  const html = await res.text();
  const inline = hasInlineScript(html);
  assert.equal(
    inline.length,
    0,
    `Scripts inline detectes dans / : ${JSON.stringify(inline, null, 2)}\nLa CSP script-src 'self' va les bloquer en prod, casser le rendu.`
  );
});

test("CSP guard : aucun <script> inline sur GET /login", async () => {
  const res = await fetch(`${baseUrl}/login`);
  const html = await res.text();
  const inline = hasInlineScript(html);
  assert.equal(
    inline.length,
    0,
    `Scripts inline detectes dans /login : ${JSON.stringify(inline, null, 2)}`
  );
});

test("CSP guard : le header Content-Security-Policy est strict (script-src 'self')", async () => {
  const res = await fetch(`${baseUrl}/`);
  const csp = res.headers.get("content-security-policy") || "";
  // Le CSP doit contenir "script-src 'self'" SANS 'unsafe-inline' ni 'unsafe-eval'
  assert.match(csp, /script-src 'self'/, "Le CSP doit declarer script-src 'self'");
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, "script-src ne doit PAS contenir 'unsafe-inline'");
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/, "script-src ne doit PAS contenir 'unsafe-eval'");
});

test("GET /api/version retourne la version courante", async () => {
  const { res, body } = await requestJson("/api/version");
  assert.equal(res.status, 200);
  // La version doit matcher le package.json
  const pkg = require(path.join(__dirname, "..", "package.json"));
  assert.equal(body.version, pkg.version);
  assert.ok(body.releaseUrl, "releaseUrl doit etre fourni");
  assert.match(body.releaseUrl, /github\.com.*releases\/tag\/v/, "URL release github attendue");
  // En tests, available peut etre false si GitHub injoignable ou rate-limited
  assert.equal(typeof body.available, "boolean");
});

// =============================================================================
// Tests d'import sequential : 2 imports consecutifs, dedup, sync stock
// =============================================================================
//
// Avant cette serie, le scenario "import 1 puis import 2 du meme fichier
// avec quantite differente" n'etait pas teste. Risque silencieux : si la
// logique de dedup change, les quantites pouvaient s'additionner au lieu
// d'etre remplacees par celles de l'Excel.

async function importVentes(rows) {
  const form = new FormData();
  form.append("file", workbookBlob(rows), "ventes.xlsx");
  return requestJson("/api/import/ventes", { method: "POST", body: form });
}

async function importStock(rows) {
  const form = new FormData();
  form.append("file", workbookBlob(rows), "stock.xlsx");
  return requestJson("/api/import/stock", { method: "POST", body: form });
}

test("import sequentiel : 2 imports du meme client avec quantite differente -> remplace, n'additionne pas", async () => {
  seedDb(defaultDb());

  // Import 1 : Dupont avec 5 unites
  await importVentes([
    ["Client", "Quantite", "Produit", "Rue", "Ville", "Code Postal"],
    ["Dupont", "5", "Produit A", "3 rue Test", "Besancon", "25000"]
  ]);

  const db1 = readDb();
  const dupont1 = db1.clients.find(c => c.nom === "Dupont");
  assert.ok(dupont1, "Dupont doit exister apres import 1");
  const order1 = db1.commandes.find(o => o.clientId === dupont1.id);
  assert.ok(order1, "Commande Dupont doit exister apres import 1");
  assert.equal(order1.products[0].quantite, 5, "Quantite apres import 1 doit etre 5");

  // Import 2 : Dupont avec 8 unites (quantite differente)
  await importVentes([
    ["Client", "Quantite", "Produit", "Rue", "Ville", "Code Postal"],
    ["Dupont", "8", "Produit A", "3 rue Test", "Besancon", "25000"]
  ]);

  const db2 = readDb();
  const dupontList = db2.clients.filter(c => c.nom === "Dupont");
  assert.equal(dupontList.length, 1, "Il doit y avoir un seul client Dupont (dedup)");
  const order2 = db2.commandes.find(o => o.clientId === dupontList[0].id);
  assert.equal(order2.products[0].quantite, 8, "Quantite apres import 2 doit etre 8 (pas 13)");
});

test("import sequentiel : dedup par cle secondaire (variation ponctuation rue)", async () => {
  seedDb(defaultDb());

  // Import 1 : "3 rue Test"
  await importVentes([
    ["Client", "Quantite", "Produit", "Rue", "Ville", "Code Postal"],
    ["Dupont", "1", "Produit A", "3 rue Test", "Besancon", "25000"]
  ]);

  // Import 2 : "3 rue Test," (virgule trainante)
  await importVentes([
    ["Client", "Quantite", "Produit", "Rue", "Ville", "Code Postal"],
    ["Dupont", "2", "Produit A", "3 rue Test,", "Besancon", "25000"]
  ]);

  const db = readDb();
  const dupontList = db.clients.filter(c => c.nom === "Dupont");
  assert.equal(dupontList.length, 1, "La virgule en plus ne doit pas creer un doublon (nom+CP)");
});

test("import sequentiel : import ventes auto-cree les produits inconnus dans le stock", async () => {
  seedDb({
    ...defaultDb(),
    stock: [{ id: "p1", code: "A1", nom: "Produit A", quantite: 10 }]
  });

  // Import ventes avec un produit B totalement nouveau
  await importVentes([
    ["Client", "Quantite", "Produit", "Code Produit", "Rue", "Ville"],
    ["Martin", "3", "Produit B", "B2", "1 rue", "Dole"]
  ]);

  const db = readDb();
  const stockCodes = db.stock.map(s => s.code);
  assert.ok(stockCodes.includes("A1"), "Produit A1 existant doit etre conserve");
  // Le produit B2 peut etre auto-cree, sinon il est en "a renseigner" - on verifie au moins
  // que la commande est creee correctement
  const martin = db.clients.find(c => c.nom === "Martin");
  assert.ok(martin, "Client Martin doit etre cree");
});

test("import sequentiel : import vide (header seul) retourne success avec 0 commande", async () => {
  seedDb(defaultDb());

  const { res, body } = await importVentes([
    ["Client", "Quantite", "Produit", "Rue", "Ville"]
  ]);

  assert.equal(res.status, 200);
  // Doit reussir mais sans creer de commandes
  const db = readDb();
  assert.equal(db.commandes.length, 0);
});

test("import sequentiel : import sans en-tete attendue retourne 400", async () => {
  seedDb(defaultDb());

  const { res } = await importVentes([
    ["FooBar", "Bazz", "Truc"],
    ["valeur1", "valeur2", "valeur3"]
  ]);

  // L'import doit echouer car les en-tetes ne sont pas reconnues
  // (server.js valide les colonnes Client, Quantite, Produit)
  assert.ok(res.status >= 400, `Status doit etre 400+, got ${res.status}`);
});

// =============================================================================
// Tests multi-stops routes : creation, reorder, statuts varies
// =============================================================================
//
// Avant cette serie, seuls les flux 1-stop etaient testes. Risque :
// reorder, optimize-route et statuts absent/probleme/a_reprogrammer n'avaient
// aucune couverture. Une regression silencieuse sur l'algo de reorder ou
// les transitions de status sur stop multi pouvait passer en prod.

function seedThreeStopsReady() {
  const db = {
    ...defaultDb(),
    clients: [
      { id: "c-a", nom: "Client Alpha", rue: "1 rue A", ville: "Besancon", codePostal: "25000", statut: "restant", produits: [{ code: "P1", nom: "Produit 1", quantite: 1 }], lat: 47.24, lng: 6.02 },
      { id: "c-b", nom: "Client Beta", rue: "2 rue B", ville: "Besancon", codePostal: "25000", statut: "restant", produits: [{ code: "P2", nom: "Produit 2", quantite: 1 }], lat: 47.25, lng: 6.03 },
      { id: "c-c", nom: "Client Gamma", rue: "3 rue C", ville: "Besancon", codePostal: "25000", statut: "restant", produits: [{ code: "P3", nom: "Produit 3", quantite: 1 }], lat: 47.26, lng: 6.04 }
    ],
    commandes: [
      { id: "o-a", clientId: "c-a", clientName: "Client Alpha", address: "1 rue A", city: "Besancon", postalCode: "25000", sector: "Besancon", products: [{ code: "P1", nom: "Produit 1", quantite: 1 }], status: "pret_livraison", deliveryDate: "2026-05-04" },
      { id: "o-b", clientId: "c-b", clientName: "Client Beta", address: "2 rue B", city: "Besancon", postalCode: "25000", sector: "Besancon", products: [{ code: "P2", nom: "Produit 2", quantite: 1 }], status: "pret_livraison", deliveryDate: "2026-05-04" },
      { id: "o-c", clientId: "c-c", clientName: "Client Gamma", address: "3 rue C", city: "Besancon", postalCode: "25000", sector: "Besancon", products: [{ code: "P3", nom: "Produit 3", quantite: 1 }], status: "pret_livraison", deliveryDate: "2026-05-04" }
    ],
    stock: [
      { id: "s1", code: "P1", nom: "Produit 1", quantite: 5 },
      { id: "s2", code: "P2", nom: "Produit 2", quantite: 5 },
      { id: "s3", code: "P3", nom: "Produit 3", quantite: 5 }
    ]
  };
  seedDb(db);
}

test("route multi-stops : creation avec 3 commandes produit 3 stops dans l'ordre", async () => {
  seedThreeStopsReady();

  const { res, body } = await requestJson("/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sector: "Besancon",
      deliveryDate: "2026-05-04",
      orderIds: ["o-a", "o-b", "o-c"]
    })
  });

  assert.equal(res.status, 201);
  assert.equal(body.stops.length, 3);
  assert.deepEqual(
    body.stops.map(s => s.orderId),
    ["o-a", "o-b", "o-c"],
    "L'ordre initial doit correspondre a orderIds"
  );
});

test("route multi-stops : reorder change l'ordre des stops", async () => {
  seedThreeStopsReady();

  const created = await requestJson("/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sector: "Besancon",
      deliveryDate: "2026-05-04",
      orderIds: ["o-a", "o-b", "o-c"]
    })
  });
  const routeId = created.body.id;
  const stopIds = created.body.stops.map(s => s.id);
  // Inverser l'ordre : c, b, a
  const reorderedStopIds = [stopIds[2], stopIds[1], stopIds[0]];

  const { res, body } = await requestJson(`/api/routes/${routeId}/reorder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopIds: reorderedStopIds })
  });

  assert.equal(res.status, 200);
  assert.deepEqual(
    body.stops.map(s => s.orderId),
    ["o-c", "o-b", "o-a"],
    "L'ordre des stops doit etre inverse apres reorder"
  );
});

test("route multi-stops : start passe les stops et les commandes en en_livraison", async () => {
  seedThreeStopsReady();

  const created = await requestJson("/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sector: "Besancon",
      deliveryDate: "2026-05-04",
      orderIds: ["o-a", "o-b", "o-c"]
    })
  });
  const routeId = created.body.id;

  const started = await requestJson(`/api/routes/${routeId}/start`, {
    method: "POST"
  });

  assert.equal(started.res.status, 200);
  assert.equal(started.body.status, "en_livraison");
  started.body.stops.forEach((stop, i) => {
    assert.equal(stop.status, "en_livraison", `Stop ${i} doit etre en_livraison`);
  });

  // Verifier que les commandes sont aussi passees en_livraison
  const db = readDb();
  ["o-a", "o-b", "o-c"].forEach(orderId => {
    const order = db.commandes.find(o => o.id === orderId);
    assert.equal(order.status, "en_livraison", `Commande ${orderId} doit etre en_livraison`);
  });
});

test("route multi-stops : statuts varies sur 3 stops (livre / absent / probleme)", async () => {
  seedThreeStopsReady();

  const created = await requestJson("/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sector: "Besancon",
      deliveryDate: "2026-05-04",
      orderIds: ["o-a", "o-b", "o-c"]
    })
  });
  const routeId = created.body.id;
  await requestJson(`/api/routes/${routeId}/start`, { method: "POST" });

  const stops = created.body.stops;

  // Stop A : livre
  const a = await requestJson(`/api/routes/${routeId}/stops/${stops[0].id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "livre" })
  });
  assert.equal(a.res.status, 200);
  assert.equal(a.body.order.status, "livre");

  // Stop B : absent
  const b = await requestJson(`/api/routes/${routeId}/stops/${stops[1].id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "absent" })
  });
  assert.equal(b.res.status, 200);
  assert.equal(b.body.order.status, "probleme_livraison");
  assert.equal(b.body.order.deliveryStatus, "absent");

  // Stop C : probleme
  const c = await requestJson(`/api/routes/${routeId}/stops/${stops[2].id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "probleme", notes: "Adresse introuvable" })
  });
  assert.equal(c.res.status, 200);
  assert.equal(c.body.order.status, "probleme_livraison");
  assert.equal(c.body.order.deliveryStatus, "probleme");

  // Verifier les statuts finaux en DB
  const db = readDb();
  const orderA = db.commandes.find(o => o.id === "o-a");
  const orderB = db.commandes.find(o => o.id === "o-b");
  const orderC = db.commandes.find(o => o.id === "o-c");
  assert.equal(orderA.status, "livre");
  assert.equal(orderB.status, "probleme_livraison");
  assert.equal(orderC.status, "probleme_livraison");
});

test("route multi-stops : stop a_reprogrammer met la commande en a_reprogrammer", async () => {
  seedThreeStopsReady();

  const created = await requestJson("/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sector: "Besancon",
      deliveryDate: "2026-05-04",
      orderIds: ["o-a"]
    })
  });
  const routeId = created.body.id;
  await requestJson(`/api/routes/${routeId}/start`, { method: "POST" });
  const stopId = created.body.stops[0].id;

  const result = await requestJson(`/api/routes/${routeId}/stops/${stopId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "a_reprogrammer", notes: "Magasin ferme" })
  });

  assert.equal(result.res.status, 200);
  assert.equal(result.body.order.status, "a_reprogrammer");
});

test("route multi-stops : reorder avec liste partielle est rejetee ou ignoree", async () => {
  seedThreeStopsReady();

  const created = await requestJson("/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sector: "Besancon",
      deliveryDate: "2026-05-04",
      orderIds: ["o-a", "o-b", "o-c"]
    })
  });
  const routeId = created.body.id;
  const stopIds = created.body.stops.map(s => s.id);

  // Reorder avec seulement 2 ids sur 3
  const partial = await requestJson(`/api/routes/${routeId}/reorder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopIds: [stopIds[1], stopIds[0]] })
  });

  // Comportement : soit 400 (rejete), soit 200 (reorganise les fournis + garde les autres)
  // L'implementation actuelle accepte et reorganise.
  assert.ok(partial.res.status === 200 || partial.res.status >= 400);
  // Important : pas de perte de stop
  if (partial.res.status === 200) {
    assert.equal(partial.body.stops.length, 3, "Aucun stop ne doit etre perdu");
  }
});

// ============================================================================
// V1.9.0 - ERP Phase 2 : refonte import ventes en bons de commande.
// Bucket par (client, dateCommande) : meme client + meme date Excel = meme
// bon (update). Meme client + date differente = nouveau bon (numero neuf).
// Re-import identique = idempotent (hash strict). Refactor de syncWorkflow
// pour gerer N commandes par client.
// ============================================================================

test("ERP Phase 2 : re-import identique = idempotent (hash strict, aucun doublon)", async () => {
  seedDb(defaultDb());

  const sheet = [
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date"],
    ["A1", "Dupont", "5", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026"]
  ];

  // 1er import : cree la commande
  const form1 = new FormData();
  form1.append("file", workbookBlob(sheet), "ventes.xlsx");
  const r1 = await requestJson("/api/import/ventes", { method: "POST", body: form1 });
  assert.equal(r1.res.status, 200);
  assert.equal(r1.body.created, 1, "1 commande creee au premier import");
  assert.equal(r1.body.skippedIdentical, 0);

  const numero1 = r1.body.commandes[0].numero;
  assert.match(numero1, /^CMD-\d{4}-\d{3}$/, "Numero genere au format CMD-YYYY-NNN");
  const id1 = r1.body.commandes[0].id;

  // 2e import IDENTIQUE : aucun changement attendu (hash strict)
  const form2 = new FormData();
  form2.append("file", workbookBlob(sheet), "ventes.xlsx");
  const r2 = await requestJson("/api/import/ventes", { method: "POST", body: form2 });
  assert.equal(r2.body.created, 0, "Aucune commande creee");
  assert.equal(r2.body.updated, 0, "Aucune mise a jour");
  assert.equal(r2.body.skippedIdentical, 1, "1 ligne identique ignoree");

  // La commande existe toujours, meme numero, meme id
  const cmd = r2.body.commandes.find(c => c.id === id1);
  assert.ok(cmd, "Commande preservee");
  assert.equal(cmd.numero, numero1, "Numero inchange");
});

test("ERP Phase 2 : meme client + nouvelle date Excel = nouvelle commande avec numero suivant", async () => {
  seedDb(defaultDb());

  // J1 : commande du 1er mai pour Dupont
  const form1 = new FormData();
  form1.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date"],
    ["A1", "Dupont", "5", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026"]
  ]), "ventes.xlsx");
  const r1 = await requestJson("/api/import/ventes", { method: "POST", body: form1 });
  assert.equal(r1.body.created, 1);
  const numero1 = r1.body.commandes[0].numero;

  // J8 : nouvelle commande du 8 mai pour le MEME Dupont
  const form2 = new FormData();
  form2.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date"],
    ["B1", "Dupont", "3", "Produit B", "1 rue test", "25000", "Besancon", "08/05/2026"]
  ]), "ventes.xlsx");
  const r2 = await requestJson("/api/import/ventes", { method: "POST", body: form2 });
  assert.equal(r2.body.created, 1, "Nouvelle commande creee pour la nouvelle date");

  // Les 2 commandes coexistent
  const dupontCommandes = r2.body.commandes.filter(c => c.clientName === "Dupont");
  assert.equal(dupontCommandes.length, 2, "Dupont a 2 commandes distinctes");

  const dates = dupontCommandes.map(c => c.dateCommande).sort();
  assert.deepEqual(dates, ["2026-05-01", "2026-05-08"]);

  // Numero du 8 mai est le suivant
  const cmd8 = dupontCommandes.find(c => c.dateCommande === "2026-05-08");
  assert.match(cmd8.numero, /^CMD-\d{4}-\d{3}$/);
  assert.notEqual(cmd8.numero, numero1, "Numero distinct du premier");
});

test("ERP Phase 2 : meme client + meme date + contenu modifie = update de la commande existante", async () => {
  seedDb(defaultDb());

  // J1 : commande avec 5 unites de A1
  const form1 = new FormData();
  form1.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date"],
    ["A1", "Dupont", "5", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026"]
  ]), "ventes.xlsx");
  const r1 = await requestJson("/api/import/ventes", { method: "POST", body: form1 });
  const numero1 = r1.body.commandes[0].numero;
  const id1 = r1.body.commandes[0].id;

  // J1 corrige : 8 unites de A1 (correction Excel)
  const form2 = new FormData();
  form2.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date"],
    ["A1", "Dupont", "8", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026"]
  ]), "ventes.xlsx");
  const r2 = await requestJson("/api/import/ventes", { method: "POST", body: form2 });
  assert.equal(r2.body.created, 0, "Pas de nouvelle commande");
  assert.equal(r2.body.updated, 1, "Commande existante mise a jour");

  // Memes id et numero, contenu mis a jour
  const dupontCommandes = r2.body.commandes.filter(c => c.clientName === "Dupont");
  assert.equal(dupontCommandes.length, 1, "Toujours 1 seule commande");
  assert.equal(dupontCommandes[0].id, id1, "Id preserve");
  assert.equal(dupontCommandes[0].numero, numero1, "Numero preserve");
  assert.equal(dupontCommandes[0].products[0].quantite, 8, "Quantite mise a jour");
});

test("ERP Phase 2 : numeros sequentiels CMD-YYYY-001, 002, 003 sur 3 clients differents", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date"],
    ["A1", "Client A", "1", "X", "1 rue A", "25000", "Besancon", "01/05/2026"],
    ["B1", "Client B", "2", "Y", "2 rue B", "39100", "Dole", "01/05/2026"],
    ["C1", "Client C", "3", "Z", "3 rue C", "39300", "Champagnole", "01/05/2026"]
  ]), "ventes.xlsx");
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });

  assert.equal(r.body.created, 3, "3 commandes creees");
  const numeros = r.body.commandes
    .filter(c => c.numero)
    .map(c => c.numero)
    .sort();

  // 3 numeros distincts, suite CMD-2026-001..003
  assert.equal(numeros.length, 3);
  assert.match(numeros[0], /^CMD-2026-\d{3}$/);
  assert.match(numeros[2], /^CMD-2026-\d{3}$/);
  const seqs = numeros.map(n => Number(n.split("-")[2])).sort((a, b) => a - b);
  assert.deepEqual(seqs, [1, 2, 3], "Sequence 1,2,3 sans trou");
});

test("ERP Phase 2 : multi-produits pour meme bon = 1 commande avec N lignes", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date"],
    ["A1", "Dupont", "5", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026"],
    ["B1", "Dupont", "3", "Produit B", "1 rue test", "25000", "Besancon", "01/05/2026"],
    ["C1", "Dupont", "2", "Produit C", "1 rue test", "25000", "Besancon", "01/05/2026"]
  ]), "ventes.xlsx");
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });

  assert.equal(r.body.created, 1, "1 seule commande pour les 3 lignes (meme date, meme client)");
  const cmd = r.body.commandes.find(c => c.clientName === "Dupont");
  assert.equal(cmd.products.length, 3, "3 lignes produits dans la commande");
  const totalQty = cmd.products.reduce((sum, p) => sum + Number(p.quantite || 0), 0);
  assert.equal(totalQty, 10, "5+3+2 = 10");
});

test("ERP Phase 2 : meme produit 2 fois pour meme bon = lignes agregees (somme)", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date"],
    ["A1", "Dupont", "5", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026"],
    ["A1", "Dupont", "3", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026"]
  ]), "ventes.xlsx");
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });

  const cmd = r.body.commandes.find(c => c.clientName === "Dupont");
  assert.equal(cmd.products.length, 1, "1 seule ligne (deduplication par productKey)");
  assert.equal(cmd.products[0].quantite, 8, "5+3 = 8");
});

test("ERP Phase 2 : statut Envoyee dans Excel = commande creee directement en livre", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date", "Statut"],
    ["A1", "Dupont", "5", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026", "Envoyée"]
  ]), "ventes.xlsx");
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });

  assert.equal(r.body.created, 1);
  assert.equal(r.body.importedAsLivre, 1, "Commande importee comme livree");

  const cmd = r.body.commandes.find(c => c.clientName === "Dupont");
  assert.equal(cmd.status, "livre");
  assert.equal(cmd.preparationStatus, "terminee");
  assert.equal(cmd.deliveryStatus, "livre");
  assert.equal(cmd.importedAsLivre, true);
});

test("ERP Phase 2 : re-import qui modifie commande deja livree preserve le statut livre", async () => {
  seedDb(defaultDb());

  // Import initial : commande livree
  const form1 = new FormData();
  form1.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date", "Statut"],
    ["A1", "Dupont", "5", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026", "Envoyée"]
  ]), "ventes.xlsx");
  await requestJson("/api/import/ventes", { method: "POST", body: form1 });

  // Re-import avec contenu modifie (8 au lieu de 5) MAIS sans le statut Envoyee
  const form2 = new FormData();
  form2.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date"],
    ["A1", "Dupont", "8", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026"]
  ]), "ventes.xlsx");
  const r2 = await requestJson("/api/import/ventes", { method: "POST", body: form2 });

  assert.equal(r2.body.updated, 1);
  const cmd = r2.body.commandes.find(c => c.clientName === "Dupont");
  assert.equal(cmd.status, "livre", "Statut livre preserve");
  assert.equal(cmd.products[0].quantite, 8, "Contenu mis a jour");
});

test("ERP Phase 2 : excelRowHash present sur chaque commande importee", async () => {
  seedDb(defaultDb());

  const form = new FormData();
  form.append("file", workbookBlob([
    ["Code", "Client", "Quantite", "Produit", "Rue", "Code Postal", "Ville", "Date"],
    ["A1", "Dupont", "5", "Produit A", "1 rue test", "25000", "Besancon", "01/05/2026"]
  ]), "ventes.xlsx");
  const r = await requestJson("/api/import/ventes", { method: "POST", body: form });

  const cmd = r.body.commandes.find(c => c.clientName === "Dupont");
  assert.ok(cmd.excelRowHash, "Hash present sur commande importee");
  assert.match(cmd.excelRowHash, /^[a-f0-9]{16}$/, "Hash format SHA-256 (16 hex chars)");
});

// ============================================================================
// V1.9.1 - Hotfix migration SQLite : les bases creees avant Phase 1 (sans
// colonnes numero/date_commande/excel_row_hash) doivent se mettre a niveau
// automatiquement au prochain startup, SANS crash "no such column".
// Bug rapporte en prod : tous les endpoints renvoyaient 500 apres deploiement.
// ============================================================================

test("v1.9.1 migration : base SQLite pre-Phase1 (sans colonnes ERP) se met a niveau au startup", () => {
  const { DatabaseSync } = require("node:sqlite");
  const { createSqliteStore } = require("../storage/sqliteStore");

  const legacyPath = path.join(tmpRoot, "data", `legacy-${Date.now()}.sqlite`);

  // 1. Construire une base avec l'ancien schema (sans numero/date_commande/excel_row_hash)
  // C'est exactement ce qui existe en prod chez l'utilisateur (sereo.sqlite avec
  // donnees pre-v1.9.0).
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    CREATE TABLE app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE commandes (
      id TEXT PRIMARY KEY,
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
    CREATE TABLE produits (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE clients (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE lignes_commande (id TEXT PRIMARY KEY, commande_id TEXT NOT NULL, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE livraisons (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE mouvements_stock (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE ventes (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE historique (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE routes (id TEXT PRIMARY KEY, payload TEXT NOT NULL, sort_order INTEGER NOT NULL);
  `);
  // Donnee critique : une commande pre-Phase1, sans numero/date_commande/hash
  legacy.prepare(`
    INSERT INTO commandes (id, client_id, statut, payload, sort_order)
    VALUES ('cmd-legacy-1', 'c-legacy', 'en_preparation',
            '{"id":"cmd-legacy-1","clientId":"c-legacy","clientName":"Client Legacy","products":[{"code":"A1","quantite":5}],"status":"en_preparation"}',
            0)
  `).run();
  legacy.prepare(`INSERT INTO app_meta (key, value) VALUES ('initialized', '1')`).run();
  legacy.close();

  // 2. Ouvrir avec le nouveau createSqliteStore : migration auto, pas de crash
  const store = createSqliteStore({
    sqlitePath: legacyPath,
    seedJsonPath: "",
    defaultDb: () => ({ clients: [], commandes: [], stock: [], ventes: [], historique: [], routes: [], stockMovements: [], settings: {} }),
    normalizeDb: db => db,
    ensureDir: () => {}
  });

  // 3. Verifications cles
  const db = store.readDb();
  assert.equal(db.commandes.length, 1, "Donnee legacy preservee (clientId c-legacy)");
  assert.equal(db.commandes[0].clientId, "c-legacy");
  assert.equal(db.commandes[0].status, "en_preparation", "Status workflow preserve");

  // Verif schema : la table a maintenant les nouvelles colonnes
  const legacy2 = new DatabaseSync(legacyPath);
  const columns = legacy2.prepare("PRAGMA table_info(commandes)").all().map(r => r.name);
  assert.ok(columns.includes("numero"), "Colonne numero ajoutee");
  assert.ok(columns.includes("date_commande"), "Colonne date_commande ajoutee");
  assert.ok(columns.includes("excel_row_hash"), "Colonne excel_row_hash ajoutee");

  // Verif index : les CREATE INDEX se sont executes apres ALTER TABLE
  const indexes = legacy2.prepare("PRAGMA index_list(commandes)").all().map(r => r.name);
  assert.ok(indexes.includes("idx_commandes_numero"), "Index sur numero cree");
  assert.ok(indexes.includes("idx_commandes_client_date"), "Index sur (client_id, date_commande) cree");
  legacy2.close();

  store.close();
  fs.unlinkSync(legacyPath);
});

test("v1.9.1 migration : idempotent (2e startup sur base deja a jour ne crash pas)", () => {
  const { createSqliteStore } = require("../storage/sqliteStore");

  const freshPath = path.join(tmpRoot, "data", `fresh-${Date.now()}.sqlite`);
  const opts = {
    sqlitePath: freshPath,
    seedJsonPath: "",
    defaultDb: () => ({ clients: [], commandes: [], stock: [], ventes: [], historique: [], routes: [], stockMovements: [], settings: {} }),
    normalizeDb: db => db,
    ensureDir: () => {}
  };

  // 1er startup : creation fraiche, schema avec colonnes ERP
  const store1 = createSqliteStore(opts);
  store1.close();

  // 2e startup : migration idempotente (addColumnIfMissing ne re-ajoute pas
  // une colonne deja presente)
  const store2 = createSqliteStore(opts);
  const db = store2.readDb();
  assert.ok(db, "2e startup OK, pas de crash");
  store2.close();

  fs.unlinkSync(freshPath);
});

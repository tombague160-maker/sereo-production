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
  assert.equal(fs.readdirSync(backupDir).some(name => name.endsWith(".sqlite")), true);
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

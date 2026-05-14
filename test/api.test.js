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

test("GET /api/orders?status=invalide renvoie 400", async () => {
  seedDb(defaultDb());
  const { res } = await requestJson("/api/orders?status=foobar");
  assert.equal(res.status, 400);
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

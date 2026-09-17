const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events");
const calendar = require("../lib/subscriptions");
const { optimizeMatrix, coordinates, roadPlan } = require("../lib/routing");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-operations-"));
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
const {
  app,
  readDb,
  writeDb,
  defaultDb,
  closeStorage,
  _flushPendingBackup,
} = require("../server");
let server, base;
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await _flushPendingBackup();
  await new Promise((r) => server.close(r));
  closeStorage();
  fs.rmSync(root, { recursive: true, force: true });
});
beforeEach(() =>
  writeDb(
    {
      ...defaultDb(),
      clients: [
        {
          id: "c1",
          nom: "Martin",
          prenom: "Alice",
          rue: "1 rue de la République",
          ville: "Besançon",
          codePostal: "25000",
          crmStatus: "client_actif",
        },
      ],
      stock: [
        { id: "p1", code: "CH-L", nom: "Changes L", quantite: 100, tarif: 12 },
        { id: "p2", code: "ALE", nom: "Alèses", quantite: 100, tarif: 5 },
      ],
    },
    { backup: false },
  ),
);
async function request(url, body, method = "POST") {
  const response = await fetch(
    base + url,
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  return { status: response.status, body: await response.json() };
}
const payload = () => ({
  clientId: "c1",
  startDate: today,
  frequency: { unit: "days", interval: 14 },
  reminderDays: 7,
  status: "active",
  products: [
    { productId: "p1", quantite: 3 },
    { productId: "p2", quantite: 2 },
  ],
});
test("monthly anchor: Jan 31 -> Feb 28 -> Mar 31, leap years preserved", () => {
  const sub = {
    startDate: "2026-01-31",
    frequency: { unit: "months", interval: 1 },
  };
  assert.equal(calendar.occurrenceDate(sub, 1), "2026-02-28");
  assert.equal(calendar.occurrenceDate(sub, 2), "2026-03-31");
  sub.startDate = "2024-01-31";
  assert.equal(calendar.occurrenceDate(sub, 1), "2024-02-29");
  assert.equal(calendar.validDate("2026-02-30"), false);
});
test("14 days preserves Thursday through DST; 10 and 15 days use exact calendar intervals", () => {
  const sub = {
    startDate: "2026-03-19",
    frequency: { unit: "days", interval: 14 },
  };
  assert.equal(calendar.occurrenceDate(sub, 1), "2026-04-02");
  assert.equal(calendar.occurrenceDate(sub, 2), "2026-04-16");
  sub.frequency.interval = 10;
  assert.equal(calendar.occurrenceDate(sub, 1), "2026-03-29");
  sub.frequency.interval = 15;
  assert.equal(calendar.occurrenceDate(sub, 1), "2026-04-03");
});
test("subscription survives SQLite close/reopen and later unrelated writes", async () => {
  const saved = await request("/api/subscriptions", payload());
  assert.equal(saved.status, 201);
  closeStorage();
  let db = readDb();
  assert.equal(db.subscriptions[0].id, saved.body.id);
  assert.equal(db.subscriptions[0].products[0].stockId, "p1");
  db.settings.appearance.brandImage = "";
  writeDb(db, { backup: false });
  const listed = await request("/api/subscriptions");
  assert.equal(listed.body.items.length, 1);
  assert.equal(listed.body.occurrences[0].date, today);
});
test("parallel clicks create one order; stock is not reserved by future subscriptions", async () => {
  const sub = (await request("/api/subscriptions", payload())).body;
  const results = await Promise.all([
    request(`/api/subscriptions/${sub.id}/orders`, { date: today }),
    request(`/api/subscriptions/${sub.id}/orders`, { date: today }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  assert.equal(results[0].body.order.id, results[1].body.order.id);
  closeStorage();
  const db = readDb();
  assert.equal(
    db.commandes.filter((o) => o.subscriptionId === sub.id).length,
    1,
  );
  assert.equal(db.stock[0].quantite, 100);
  assert.equal(db.commandes[0].total, 46);
  assert.equal(db.commandes[0].subscriptionDate, today);
});
test("pause hides reminders; resume restores schedule, not duplicates", async () => {
  const sub = (await request("/api/subscriptions", payload())).body;
  assert.equal(
    (
      await request(
        `/api/subscriptions/${sub.id}`,
        { status: "paused" },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/subscriptions")).body.occurrences.length,
    0,
  );
  assert.equal(
    (await request(`/api/subscriptions/${sub.id}/orders`, { date: today }))
      .status,
    400,
  );
  await request(`/api/subscriptions/${sub.id}`, { status: "active" }, "PATCH");
  assert.equal(
    (await request("/api/subscriptions")).body.occurrences[0].date,
    today,
  );
});
test("invalid dates, zero quantities, unknown client, and fake occurrence refused", async () => {
  for (const changes of [
    { startDate: "2026-02-30" },
    { frequency: { unit: "days", interval: 0 } },
    { clientId: "missing" },
    { products: [{ productId: "p1", quantite: 0 }] },
    { reminderDays: -1 },
  ])
    assert.equal(
      (await request("/api/subscriptions", { ...payload(), ...changes }))
        .status,
      400,
    );
  const sub = (await request("/api/subscriptions", payload())).body;
  assert.equal(
    (
      await request(`/api/subscriptions/${sub.id}/orders`, {
        date: "1999-01-01",
      })
    ).status,
    400,
  );
  assert.equal(readDb().commandes.length, 0);
});
test("dashboard excludes undelivered amounts, separates months and averages delivered baskets", async () => {
  const db = readDb();
  db.commandes = [
    {
      id: "a",
      clientId: "c1",
      clientName: "Alice Martin",
      status: "livre",
      dateCommande: "2026-08-01",
      deliveredAt: "2026-09-03T12:00:00Z",
      total: 60,
      products: [],
    },
    {
      id: "b",
      clientId: "c1",
      clientName: "Alice Martin",
      status: "livre",
      dateCommande: "2026-09-01",
      deliveredAt: "2026-09-10T12:00:00Z",
      total: 40,
      products: [],
    },
    {
      id: "c",
      clientId: "c1",
      clientName: "Alice Martin",
      status: "en_preparation",
      dateCommande: "2026-09-01",
      total: 900,
      products: [],
    },
    {
      id: "d",
      clientId: "c1",
      clientName: "Alice Martin",
      status: "livre",
      dateCommande: "2026-08-01",
      total: 30,
      products: [],
    },
  ];
  writeDb(db, { backup: false });
  const op = (await request("/api/operations")).body,
    sep = op.history.find((m) => m.month === "2026-09");
  assert.equal(sep.revenue, 100);
  assert.equal(sep.averageBasket, 50);
  assert.equal(sep.orders, 2);
  assert.equal(op.history.find((m) => m.month === "2026-08").revenue, 30);
  assert.equal(op.preparing.length, 1);
});
test("overdue reminders persist and delivered occurrences do not regenerate", async () => {
  const p = payload();
  p.startDate = "2026-01-01";
  p.frequency = { unit: "months", interval: 1 };
  const sub = (await request("/api/subscriptions", p)).body;
  await request(`/api/subscriptions/${sub.id}/orders`, { date: "2026-01-01" });
  const db = readDb();
  db.commandes[0].status = "livre";
  writeDb(db, { backup: false });
  const schedule = (await request("/api/subscriptions")).body.occurrences;
  assert.ok(!schedule.some((o) => o.date === "2026-01-01"));
  assert.ok(schedule.some((o) => o.date === "2026-02-01" && o.overdue));
  assert.equal(
    (
      await request(`/api/subscriptions/${sub.id}/orders`, {
        date: "2026-01-01",
      })
    ).status,
    200,
  );
});
test("purge does not orphan subscriptions or recreate their historical orders", async () => {
  await request("/api/subscriptions", payload());
  assert.equal((await request("/api/orders/purge", {})).status, 400);
  assert.equal(readDb().clients.length, 1);
});
test("route matrix starts from departure and accounts for fixed arrival", () => {
  // Departure close to stop 2; a directed path should be 0 -> 2 -> 1 -> 3.
  const matrix = [
    [0, 10, 1, 30],
    [10, 0, 8, 1],
    [1, 1, 0, 20],
    [30, 1, 20, 0],
  ];
  assert.deepEqual(optimizeMatrix(matrix, 2), [1, 0]);
  assert.equal(coordinates({ lat: 999, lng: 1 }), null);
  assert.equal(coordinates({ lat: "", lng: 1 }), null);
});
test("road routing persists geometry and endpoints, restart does not reset delivered stops", async () => {
  const fake = require("node:http").createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url.includes("/table/")
          ? {
              code: "Ok",
              durations: [
                [0, 10, 1, 30],
                [10, 0, 8, 1],
                [1, 1, 0, 20],
                [30, 1, 20, 0],
              ],
            }
          : {
              code: "Ok",
              routes: [
                {
                  distance: 12000,
                  duration: 1200,
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [5.9, 47],
                      [6.1, 47.1],
                      [6.2, 47.2],
                      [6.3, 47.3],
                    ],
                  },
                },
              ],
            },
      ),
    );
  });
  fake.listen(0, "127.0.0.1");
  await once(fake, "listening");
  process.env.SEREO_ROUTING_URL = `http://127.0.0.1:${fake.address().port}`;
  try {
    const db = readDb();
    db.commandes = [
      {
        id: "o1",
        clientId: "c1",
        clientName: "Martin",
        status: "pret_livraison",
        lat: 47.1,
        lng: 6.1,
        products: [],
      },
      {
        id: "o2",
        clientId: "c1",
        clientName: "Martin",
        status: "pret_livraison",
        lat: 47.2,
        lng: 6.2,
        products: [],
      },
    ];
    writeDb(db, { backup: false });
    const created = await request("/api/routes", {
      orderIds: ["o1", "o2"],
      departure: { lat: 47, lng: 5.9 },
      arrival: { lat: 47.3, lng: 6.3 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.stops[0].orderId, "o2");
    assert.equal(created.body.totalDistance, 12);
    assert.equal(created.body.estimatedDuration, 32);
    assert.equal(created.body.geometry.type, "LineString");
    const id = created.body.id;
    await request(`/api/routes/${id}/start`, {});
    await request(
      `/api/routes/${id}/stops/${created.body.stops[0].id}`,
      { status: "livre" },
      "PATCH",
    );
    await request(`/api/routes/${id}/start`, {});
    const route = readDb().routes[0];
    assert.equal(route.stops[0].status, "livre");
    assert.ok(readDb().commandes.find((o) => o.id === "o2").deliveredAt);
  } finally {
    delete process.env.SEREO_ROUTING_URL;
    await new Promise((r) => fake.close(r));
  }
});
test("failed routing never saves a fake or partial route", async () => {
  const db = readDb();
  db.commandes = [
    {
      id: "o1",
      clientId: "c1",
      clientName: "Martin",
      status: "pret_livraison",
      lat: 47,
      lng: 6,
      products: [],
    },
  ];
  writeDb(db, { backup: false });
  const response = await request("/api/routes", {
    orderIds: ["o1"],
    departure: { lat: 999, lng: 6 },
    arrival: { lat: 47, lng: 6 },
  });
  assert.equal(response.status, 400);
  assert.equal(readDb().routes.length, 0);
});

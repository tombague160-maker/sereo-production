// Lot 5 de l'audit geo (23/09) : rapidite.
//
// Les mesures du rapport (§4) : a 250 tournees d'historique, un « Livre » fige
// le serveur 0,9 a 2 s et le rechargement qui suit prend 5,5 a 8,8 s. Chaque
// banc ci-dessous vise UNE des causes, et echoue sur le code d'avant.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-lot5-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const S = require("../server");
const { app, readDb, writeDb, defaultDb, closeStorage, _flushPendingBackup } = S;

let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await _flushPendingBackup();
  await new Promise(r => server.close(r));
  closeStorage();
  fs.rmSync(root, { recursive: true, force: true });
});

async function api(chemin, init = {}) {
  const headers = { Origin: base, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) };
  const res = await fetch(base + chemin, { ...init, headers });
  const texte = await res.text();
  let body;
  try { body = texte ? JSON.parse(texte) : undefined; } catch { body = texte; }
  return { status: res.status, body };
}

// --- Une tournee terminee de N arrets, avec son trace ------------------------

function commande(id, statut, i = 0) {
  return {
    id, clientId: "c" + (i % 5), clientName: "Client " + (i % 5), address: i + " rue du Test",
    postalCode: "39300", city: "Champagnole", status: statut, preparationStatus: "terminee",
    lat: 46.7 + i / 1000, lng: 5.9 + i / 1000, products: [{ code: "P1", nom: "Produit", quantite: 1 }],
    deliveryDate: "2026-09-23"
  };
}

function trace(n = 50) {
  return { type: "LineString", coordinates: Array.from({ length: n }, (_, j) => [5.9 + j / 1e4, 46.7 + j / 1e4]) };
}

function tournee(id, statut, commandes, extra = {}) {
  return {
    id, sector: "Champagnole", status: statut, deliveryDate: "2026-09-23",
    stops: commandes.map((c, k) => ({
      id: `stop-${id}-${k + 1}`, routeId: id, orderId: c.id, clientId: c.clientId, orderIndex: k + 1,
      clientName: c.clientName, address: c.address, city: c.city, postalCode: c.postalCode,
      status: statut === "terminee" ? "livre" : statut === "en_livraison" ? "en_livraison" : "pret_livraison",
      lat: c.lat, lng: c.lng, products: []
    })),
    geometry: trace(), routingMode: "road", totalDistance: 10, estimatedDuration: 30,
    createdAt: "2026-09-01T08:00:00.000Z", ...extra
  };
}

function clients() {
  return Array.from({ length: 5 }, (_, i) => ({ id: "c" + i, nom: "Client " + i, rue: i + " rue du Test", codePostal: "39300", ville: "Champagnole" }));
}

// --- 1. La boucle qui recalculait l'index des commandes pour chaque tournee ---

test("lot 5 : l'index des commandes se construit une fois, pas une fois par tournee", () => {
  const N = 1000, R = 200;
  const cmd = Array.from({ length: N }, (_, i) => commande("o" + i, "livre", i));
  const routes = Array.from({ length: R }, (_, r) => tournee("r" + r, "terminee", [cmd[r]]));
  const db = { ...defaultDb(), clients: clients(), commandes: cmd, routes };

  // new Map(iterable) appelle Map.prototype.set pour chaque entree : compter
  // les appels, c'est compter le travail. Avant : R x N = 200 000 insertions.
  const setOriginal = Map.prototype.set;
  let insertions = 0;
  Map.prototype.set = function (...args) { insertions++; return setOriginal.apply(this, args); };
  try {
    writeDb(db, { backup: false });
  } finally {
    Map.prototype.set = setOriginal;
  }
  assert.ok(insertions > 0, "le compteur n'a rien vu : l'instrument ne mesure rien");
  assert.ok(insertions < 50 * (N + R), `${insertions} insertions dans des Map pour ${N} commandes et ${R} tournees`);
});

// --- 2. Ecriture ciblee : un geste n'ecrit que ce qu'il change ---------------

function semerHistorique(nTerminees = 30, arrets = 5) {
  const cmd = [], routes = [];
  for (let r = 0; r < nTerminees; r++) {
    const lot = Array.from({ length: arrets }, (_, k) => commande(`h${r}-${k}`, "livre", r * arrets + k));
    cmd.push(...lot);
    routes.push(tournee(`r${r}`, "terminee", lot, { completedAt: "2026-09-01T12:00:00.000Z" }));
  }
  const actives = Array.from({ length: arrets }, (_, k) => commande(`a${k}`, "en_livraison", k));
  cmd.push(...actives);
  routes.unshift(tournee("act", "en_livraison", actives));
  writeDb({ ...defaultDb(), clients: clients(), commandes: cmd, routes }, { backup: false });
}

const TABLES_JOURNAL = ["produits", "clients", "commandes", "lignes_commande", "routes", "livraisons", "historique", "traces_tournees"];

function poserJournal() {
  const { DatabaseSync } = require("node:sqlite");
  const cnx = new DatabaseSync(process.env.SEREO_SQLITE_PATH);
  cnx.exec("PRAGMA busy_timeout = 5000");
  cnx.exec("CREATE TABLE IF NOT EXISTS journal_lot5 (t TEXT, op TEXT, id TEXT)");
  for (const t of TABLES_JOURNAL) {
    const cle = t === "traces_tournees" ? "route_id" : "id";
    cnx.exec(`
      CREATE TRIGGER IF NOT EXISTS j5_${t}_i AFTER INSERT ON ${t} BEGIN INSERT INTO journal_lot5 VALUES ('${t}', 'I', NEW.${cle}); END;
      CREATE TRIGGER IF NOT EXISTS j5_${t}_u AFTER UPDATE ON ${t} BEGIN INSERT INTO journal_lot5 VALUES ('${t}', 'U', NEW.${cle}); END;
      CREATE TRIGGER IF NOT EXISTS j5_${t}_d AFTER DELETE ON ${t} BEGIN INSERT INTO journal_lot5 VALUES ('${t}', 'D', OLD.${cle}); END;
    `);
  }
  return {
    lire: () => cnx.prepare("SELECT t, op, id FROM journal_lot5").all(),
    retirer: () => {
      for (const t of TABLES_JOURNAL) for (const op of ["i", "u", "d"]) cnx.exec(`DROP TRIGGER IF EXISTS j5_${t}_${op}`);
      cnx.exec("DROP TABLE IF EXISTS journal_lot5");
      cnx.close();
    }
  };
}

test("lot 5 : « Livré » n'ecrit en base que la tournee, l'arret et la commande touches", async () => {
  semerHistorique();
  const journal = poserJournal();
  try {
    const r = await api("/api/routes/act/stops/stop-act-1", { method: "PATCH", body: JSON.stringify({ status: "livre" }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ecrits = journal.lire();
    // Temoin : le journal voit bien les ecritures du geste.
    assert.ok(ecrits.some(e => e.t === "routes" && e.id === "act"), "le journal n'a pas vu la tournee ecrite");
    const routesTouchees = [...new Set(ecrits.filter(e => e.t === "routes").map(e => e.id))];
    assert.deepEqual(routesTouchees, ["act"], "les tournees terminees ont ete reecrites");
    assert.equal(ecrits.filter(e => e.op === "D").length, 0, "des lignes ont ete supprimees");
    assert.ok(ecrits.length <= 12, `${ecrits.length} lignes ecrites pour un geste : ${JSON.stringify(ecrits.slice(0, 20))}`);
    assert.equal(ecrits.filter(e => e.t === "traces_tournees").length, 0, "un trace a ete reecrit sans changer");
  } finally {
    journal.retirer();
  }
  const db = readDb();
  assert.equal(db.routes.find(r => r.id === "act").stops[0].status, "livre");
  assert.equal(db.commandes.find(c => c.id === "a0").status, "livre");
});

// --- 3. L'ecriture ciblee rend la meme base qu'une reecriture complete --------
//
// Le risque d'une ecriture differentielle : oublier une ligne, ou la ranger a
// la mauvaise place (readDb relit dans l'ordre de sort_order). Ce banc applique
// 60 mutations tirees au hasard (graine fixe) a travers le chemin reel
// readDb -> mutation -> writeDb, et compare apres CHAQUE pas la base ecrite en
// differentiel a une base neuve ecrite d'un coup a partir d'un modele.

const { createSqliteStore } = require("../storage/sqliteStore");

function ouvrirStore(fichier) {
  const base = () => ({ clients: [], commandes: [], stock: [], ventes: [], historique: [], routes: [], subscriptions: [], relances: [], deliverySectors: [], stockMovements: [], importsArchives: [], settings: {} });
  return createSqliteStore({
    sqlitePath: fichier, seedJsonPath: "", defaultDb: base,
    normalizeDb: db => ({ ...base(), ...db }), ensureDir: d => fs.mkdirSync(d, { recursive: true })
  });
}

const TABLES_COMPAREES = {
  produits: "id, reference, nom, stock_actuel, stock_minimum, stock_bloque, unite, updated_at, payload",
  clients: "id, nom, adresse, ville, code_postal, telephone, secteur, updated_at, payload",
  commandes: "id, numero, date_commande, excel_row_hash, client_id, date_import, date_preparation, date_livraison, statut, source_excel, updated_at, payload",
  lignes_commande: "id, commande_id, produit_id, quantite, quantite_preparee, statut, stock_suffisant, payload",
  routes: "id, statut, secteur, date_livraison, payload",
  livraisons: "id, commande_id, client_id, date_livraison, secteur, statut, note_probleme, date_mise_a_jour, payload",
  historique: "id, type, message, date, payload",
  ventes: "id, payload"
};

function contenu(fichier) {
  const { DatabaseSync } = require("node:sqlite");
  const cnx = new DatabaseSync(fichier);
  try {
    const out = {};
    for (const [t, cols] of Object.entries(TABLES_COMPAREES)) out[t] = cnx.prepare(`SELECT ${cols} FROM ${t} ORDER BY sort_order, id`).all().map(r => ({ ...r }));
    out.traces = cnx.prepare("SELECT route_id, trace FROM traces_tournees ORDER BY route_id").all().map(r => ({ ...r }));
    return out;
  } finally {
    cnx.close();
  }
}

test("lot 5 : 60 mutations au hasard, la base differentielle egale une base reecrite d'un coup", () => {
  const dossier = path.join(root, "equivalence");
  fs.mkdirSync(dossier, { recursive: true });
  let graine = 7;
  const hasard = n => { graine = (graine * 1103515245 + 12345) % 2147483648; return Math.floor((graine / 2147483648) * n); };
  let seq = 0;
  const neuf = prefixe => `${prefixe}-${++seq}`;

  const cmd = Array.from({ length: 8 }, (_, i) => commande("m" + i, i % 2 ? "livre" : "pret_livraison", i));
  const modele = {
    clients: clients(), commandes: cmd, stock: [{ id: "p1", code: "P1", nom: "Produit", quantite: 10 }],
    ventes: [{ id: "v1", total: 3 }], historique: [{ id: "h0", type: "Test", message: "depart", date: "2026-09-01" }],
    routes: [tournee("t1", "terminee", cmd.slice(0, 2)), tournee("t2", "prete", cmd.slice(2, 4))]
  };
  const A = ouvrirStore(path.join(dossier, "a.sqlite"));
  A.writeDb(structuredClone(modele));

  const mutations = [
    ["historique en tete", db => db.historique.unshift({ id: neuf("h"), type: "Test", message: "geste", date: "2026-09-02" })],
    ["historique au milieu", db => db.historique.splice(Math.min(1, db.historique.length), 0, { id: neuf("h"), type: "Test", message: "milieu" })],
    ["commande ajoutee", db => db.commandes.push(commande(neuf("m"), "pret_livraison", seq))],
    ["commande retiree", db => { if (db.commandes.length > 2) db.commandes.splice(hasard(db.commandes.length), 1); }],
    ["commande modifiee", db => { const c = db.commandes[hasard(db.commandes.length)]; c.notes = neuf("note"); c.products[0].quantite = seq; }],
    ["commandes inversees", db => db.commandes.reverse()],
    ["tournee en tete", db => db.routes.unshift(tournee(neuf("t"), "prete", db.commandes.slice(0, 2)))],
    ["tournee retiree", db => { if (db.routes.length > 1) db.routes.splice(hasard(db.routes.length), 1); }],
    ["tournee terminee", db => { const r = db.routes.find(x => x.status !== "terminee"); if (r) r.status = "terminee"; }],
    ["trace efface", db => { const r = db.routes.find(x => x.status !== "terminee"); if (r) r.geometry = null; }],
    ["trace recalcule", db => { const r = db.routes.find(x => x.status !== "terminee"); if (r) r.geometry = trace(10 + hasard(20)); }],
    ["client au milieu", db => db.clients.splice(2, 0, { id: neuf("c"), nom: "Nouveau", ville: "Dole" })],
    ["vente retiree", db => { db.ventes.shift(); db.ventes.push({ id: neuf("v"), total: seq }); }]
  ];

  try {
  for (let pas = 1; pas <= 60; pas++) {
    const [nom, muter] = mutations[hasard(mutations.length)];
    const [memeGraine, memeSeq] = [graine, seq];
    // Le chemin reel : lire, muter, ecrire. Le modele subit la meme mutation
    // (memes tirages, memes identifiants).
    const lu = A.readDb();
    muter(lu);
    A.writeDb(lu);
    [graine, seq] = [memeGraine, memeSeq];
    muter(modele);

    const B = ouvrirStore(path.join(dossier, `b-${pas}.sqlite`));
    B.writeDb(structuredClone(modele));
    B.close();
    const attendu = contenu(path.join(dossier, `b-${pas}.sqlite`));
    const obtenu = contenu(path.join(dossier, "a.sqlite"));
    assert.deepEqual(obtenu, attendu, `pas ${pas} (${nom}) : la base differentielle a diverge`);

    // Et ce que relit readDb : les listes dans l'ordre, sans trace pour les terminees.
    const relu = A.readDb();
    assert.deepEqual(relu.historique.map(h => h.id), modele.historique.map(h => h.id), `pas ${pas} (${nom}) : ordre de l'historique`);
    assert.deepEqual(relu.commandes.map(c => c.id), modele.commandes.map(c => c.id), `pas ${pas} (${nom}) : ordre des commandes`);
    for (const r of modele.routes) {
      const rr = relu.routes.find(x => x.id === r.id);
      if (r.status === "terminee") assert.ok(!("geometry" in rr), `pas ${pas} : trace charge pour une tournee terminee`);
      else assert.deepEqual(rr.geometry, r.geometry ?? null, `pas ${pas} (${nom}) : trace de ${r.id}`);
      assert.deepEqual(A.getRouteTrace(r.id), r.geometry ?? null, `pas ${pas} (${nom}) : trace a la demande de ${r.id}`);
    }
  }
  } finally {
    A.close();
  }
});

// --- 4. Le trace sort du payload, et une base d'avant est migree -------------

test("lot 5 : une base ecrite avant le lot (trace dans le payload) est migree a l'ouverture", () => {
  const { DatabaseSync } = require("node:sqlite");
  const fichier = path.join(root, "migration.sqlite");
  // Une base « d'avant » : le trace dans le payload, pas de drapeau de migration.
  const avant = ouvrirStore(fichier);
  avant.close();
  const cnx = new DatabaseSync(fichier);
  const r = tournee("vieille", "terminee", [commande("x1", "livre")]);
  cnx.prepare("INSERT INTO routes (id, statut, secteur, date_livraison, payload, sort_order) VALUES (?, ?, ?, ?, ?, 0)")
    .run("vieille", "terminee", "Champagnole", "2026-01-01", JSON.stringify(r));
  cnx.prepare("DELETE FROM traces_tournees").run();
  cnx.prepare("DELETE FROM app_meta WHERE key = 'traces_tournees_separees'").run();
  cnx.close();

  const apres = ouvrirStore(fichier);
  const relu = apres.readDb();
  assert.ok(!("geometry" in relu.routes[0]), "le trace d'une tournee terminee est encore relu");
  assert.deepEqual(apres.getRouteTrace("vieille"), r.geometry, "le trace n'a pas ete deplace");
  apres.close();
  const lu = new DatabaseSync(fichier);
  const payload = lu.prepare("SELECT payload FROM routes WHERE id = 'vieille'").get().payload;
  lu.close();
  assert.ok(!payload.includes("coordinates"), "le payload garde le trace");
});

// --- 5. La liste des tournees sans les traces des terminees -------------------

test("lot 5 : GET /api/routes n'envoie pas le trace des tournees terminees ; GET /api/routes/:id le rend", async () => {
  semerHistorique(3, 2);
  const liste = await api("/api/routes");
  assert.equal(liste.status, 200);
  const act = liste.body.find(r => r.id === "act");
  const finie = liste.body.find(r => r.id === "r0");
  assert.equal(act.geometry?.coordinates?.length, 50, "la tournee en cours a perdu son trace");
  assert.ok(!("geometry" in finie), "la liste envoie le trace d'une tournee terminee");
  assert.equal(finie.traceOmise, true, "rien ne dit que le trace existe");
  assert.equal(finie.stops.length, 2, "la tournee terminee a perdu ses arrets");

  const detail = await api("/api/routes/r0");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.geometry?.coordinates?.length, 50, "le trace a la demande manque");
  assert.equal((await api("/api/routes/inconnue")).status, 404);
});

// --- 6. La reponse d'un geste porte ce qu'il a change -------------------------

test("lot 5 : la reponse d'un geste d'arret porte la tournee, l'arret, la commande et le client tels que les listes", async () => {
  semerHistorique(2, 2);
  const r = await api("/api/routes/act/stops/stop-act-2", { method: "PATCH", body: JSON.stringify({ status: "livre" }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [routes, commandes, lesClients] = await Promise.all([api("/api/routes"), api("/api/orders"), api("/api/clients")]);
  assert.deepEqual(r.body.route, routes.body.find(x => x.id === "act"), "la tournee de la reponse n'est pas celle de la liste");
  assert.deepEqual(r.body.stop, r.body.route.stops[1]);
  assert.deepEqual(r.body.order, commandes.body.find(x => x.id === "a1"), "la commande de la reponse n'est pas celle de la liste");
  assert.ok(r.body.client, "la reponse ne porte pas le client");
  assert.deepEqual(r.body.client, lesClients.body.find(x => x.id === r.body.order.clientId), "le client de la reponse n'est pas celui de la liste");

  // La derniere livraison termine la tournee : la reponse garde son trace (l'ecran l'affiche encore).
  const fin = await api("/api/routes/act/stops/stop-act-1", { method: "PATCH", body: JSON.stringify({ status: "livre" }) });
  assert.equal(fin.body.route.status, "terminee");
  assert.equal(fin.body.route.geometry?.coordinates?.length, 50, "la tournee terminee a perdu son trace dans la reponse");
});

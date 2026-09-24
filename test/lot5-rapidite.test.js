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

// Une connexion par requete (`connection: close`, 25/09). Le rouge « fetch
// failed / read ECONNRESET » qui tombait parfois sur le banc « GET /api/routes
// n'envoie pas le trace » (CI du 24/09, run 36009519501) : fetch garde la
// connexion ouverte entre deux requetes (keep-alive), et le serveur, dans le
// MEME processus, la ferme apres 5 s de repos (+ 1 s de marge). Les bancs
// synchrones qui precedent (60 mutations : 5,9 s ce jour-la) bloquent la
// boucle au-dela : le fetch suivant reutilise la connexion, puis la minuterie
// du serveur, en retard, la ferme avant d'avoir lu la requete -- RST.
// Reproduit 5 fois sur 5 hors du banc (boucle bloquee 4,5 s, keep-alive 3 s),
// et 3 fois sur 3 dans ce fichier quand les 60 mutations passent 6 s.
async function api(chemin, init = {}) {
  const headers = { Origin: base, connection: "close", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) };
  const res = await fetch(base + chemin, { ...init, headers });
  const texte = await res.text();
  let body;
  try { body = texte ? JSON.parse(texte) : undefined; } catch { body = texte; }
  return { status: res.status, body };
}

test("lot 5 : le helper api() ouvre une connexion par requete (aucune reutilisation que le serveur pourrait fermer)", async () => {
  let connexions = 0;
  const compter = () => { connexions++; };
  server.on("connection", compter);
  try {
    for (let i = 0; i < 3; i++) assert.equal((await api("/healthz")).status, 200);
  } finally {
    server.off("connection", compter);
  }
  assert.equal(connexions, 3, "une connexion a ete reutilisee (keep-alive) : le rouge ECONNRESET peut revenir");
});

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
  const existantes = new Set(cnx.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
  for (const t of TABLES_JOURNAL.filter(t => existantes.has(t))) {
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
  const tables = cnx.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => t.name);
  if (tables.includes("traces_tournees")) cnx.prepare("DELETE FROM traces_tournees").run();
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

test("lot 5 : apres un retour a une version d'avant puis une remontee, le trace recalcule entre-temps gagne", () => {
  const { DatabaseSync } = require("node:sqlite");
  const fichier = path.join(root, "aller-retour.sqlite");
  // Le lot deploye : la tournee T a son trace G1 dans traces_tournees (drapeau pose).
  const G1 = trace(12), G2 = trace(30);
  const lot = ouvrirStore(fichier);
  lot.writeDb({ ...defaultDb(), clients: clients(), routes: [
    { ...tournee("T", "prete", [commande("y1", "pret_livraison")]), geometry: G1 },
    { ...tournee("U", "prete", [commande("y2", "pret_livraison")]), geometry: G1 }
  ] });
  lot.close();
  // Retour a v1.41.1 : elle ignore la table, recalcule T (trace G2 dans le
  // payload) et efface celui de U (geometry: null dans le payload).
  const cnx = new DatabaseSync(fichier);
  const lire = id => JSON.parse(cnx.prepare("SELECT payload FROM routes WHERE id = ?").get(id).payload);
  cnx.prepare("UPDATE routes SET payload = ? WHERE id = 'T'").run(JSON.stringify({ ...lire("T"), geometry: G2 }));
  cnx.prepare("UPDATE routes SET payload = ? WHERE id = 'U'").run(JSON.stringify({ ...lire("U"), geometry: null }));
  const drapeau = cnx.prepare("SELECT value FROM app_meta WHERE key = 'traces_tournees_separees'").get();
  cnx.close();
  assert.ok(drapeau, "prealable : le drapeau de migration doit etre deja pose");

  // Remontee au lot.
  const remonte = ouvrirStore(fichier);
  const relu = remonte.readDb();
  assert.deepEqual(relu.routes.find(r => r.id === "T").geometry, G2, "le trace d'avant le retour a ecrase celui recalcule entre-temps");
  assert.equal(relu.routes.find(r => r.id === "U").geometry, null, "un trace efface entre-temps est revenu");
  assert.deepEqual(remonte.getRouteTrace("T"), G2);
  // La premiere ecriture ne perd pas G2.
  remonte.writeDb(relu);
  assert.deepEqual(remonte.getRouteTrace("T"), G2, "l'ecriture qui suit a perdu le trace recalcule");
  remonte.close();
  const apres = new DatabaseSync(fichier);
  const payload = apres.prepare("SELECT payload FROM routes WHERE id = 'T'").get().payload;
  apres.close();
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

// --- 7. Decision 5 : la position « Me localiser » stockee a ~100 m -----------

test("lot 5 : la position « Me localiser » est stockee arrondie a 3 decimales, une adresse choisie ne l'est pas", () => {
  const cmd = [commande("g1", "pret_livraison")];
  writeDb({
    ...defaultDb(), clients: clients(), commandes: cmd,
    routes: [
      tournee("gps", "prete", cmd, {
        departure: { lat: 46.7512345, lng: 5.9123456, label: "Ma position actuelle" },
        arrival: { lat: 46.7512345, lng: 5.9123456, label: "Ma position actuelle" }
      }),
      tournee("adresse", "prete", [], { departure: { lat: 47.2381234, lng: 6.0241234, label: "4 rue de Dole, Besançon" } })
    ]
  }, { backup: false });
  const db = readDb();
  const gps = db.routes.find(r => r.id === "gps");
  assert.deepEqual([gps.departure.lat, gps.departure.lng], [46.751, 5.912], "la position du telephone est stockee au centimetre");
  assert.deepEqual([gps.arrival.lat, gps.arrival.lng], [46.751, 5.912]);
  const adresse = db.routes.find(r => r.id === "adresse");
  assert.deepEqual([adresse.departure.lat, adresse.departure.lng], [47.2381234, 6.0241234], "une adresse choisie a ete arrondie");
});

test("lot 5 : le trace d'une tournee calculee avant le lot ne garde pas la position « Me localiser » exacte", async () => {
  const { DatabaseSync } = require("node:sqlite");
  const km = (a, b) => S._distance({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] });
  // Le domicile du livreur, et un trace OSRM qui en part (sommet 0 recale sur
  // la route), puis s'eloigne d'environ 32 m par sommet.
  const EXACT = [5.91236, 46.75125];
  const precis = { type: "LineString", coordinates: [EXACT, ...Array.from({ length: 29 }, (_, j) => [5.9124 + (j + 1) * 0.0003, 46.7513 + (j + 1) * 0.0002])] };
  const gps = { lat: 46.7512345, lng: 5.9123456, label: "Ma position actuelle" };
  const cmd = [commande("t1", "livre"), commande("t2", "pret_livraison"), commande("t3", "livre")];
  writeDb({
    ...defaultDb(), clients: clients(), commandes: cmd,
    routes: [
      tournee("gps-finie", "terminee", [cmd[0]], { departure: gps, completedAt: "2026-09-01T12:00:00.000Z" }),
      tournee("gps-prete", "prete", [cmd[1]], { departure: gps, arrival: gps }),
      tournee("adresse", "terminee", [cmd[2]], { departure: { lat: 46.7512345, lng: 5.9123456, label: "Dépôt" } })
    ]
  }, { backup: false });
  // Les traces tels qu'une version d'avant le lot les a enregistres.
  const aller = structuredClone(precis);
  const allerRetour = { ...precis, coordinates: [...precis.coordinates, ...precis.coordinates.slice().reverse()] };
  let cnx = new DatabaseSync(process.env.SEREO_SQLITE_PATH);
  const poser = cnx.prepare("UPDATE traces_tournees SET trace = ? WHERE route_id = ?");
  poser.run(JSON.stringify(aller), "gps-finie");
  poser.run(JSON.stringify(allerRetour), "gps-prete");
  poser.run(JSON.stringify(aller), "adresse");
  cnx.close();

  S._healDatabaseAtBoot();

  cnx = new DatabaseSync(process.env.SEREO_SQLITE_PATH);
  const stocke = id => JSON.parse(cnx.prepare("SELECT trace FROM traces_tournees WHERE route_id = ?").get(id).trace).coordinates;
  const finie = stocke("gps-finie"), prete = stocke("gps-prete"), adresse = stocke("adresse");
  cnx.close();
  const ARRONDI = [5.912, 46.751];
  assert.equal(adresse.length, 30, "temoin : le trace d'une adresse choisie a ete rogne");
  assert.deepEqual(finie[0], ARRONDI, "le trace stocke d'une tournee terminee part encore de la position exacte");
  assert.ok(finie.slice(1).every(c => km(c, ARRONDI) > 0.15), "un sommet a moins de 150 m du depart reste dans le trace stocke");
  assert.ok(finie.length > 20, `le trace a ete trop rogne (${finie.length} sommets)`);
  assert.deepEqual([prete[0], prete[prete.length - 1]], [ARRONDI, ARRONDI], "le trace d'une tournee prete garde depart ou arrivee exacts");
  assert.ok(prete.slice(1, -1).every(c => km(c, ARRONDI) > 0.15));
  assert.ok(![...finie, ...prete].some(c => c[0] === EXACT[0] && c[1] === EXACT[1]), "la position exacte est encore stockee");
  // Ce que l'ecran recoit.
  assert.deepEqual((await api("/api/routes/gps-finie")).body.geometry.coordinates, finie);
  // Idempotent : une deuxieme passe ne change rien.
  S._healDatabaseAtBoot();
  cnx = new DatabaseSync(process.env.SEREO_SQLITE_PATH);
  const encore = JSON.parse(cnx.prepare("SELECT trace FROM traces_tournees WHERE route_id = 'gps-finie'").get().trace).coordinates;
  cnx.close();
  assert.deepEqual(encore, finie, "une deuxieme passe rogne encore");
  const g = { type: "LineString", coordinates: finie };
  assert.equal(S.rognerTraceGps(g, { departure: gps }), g, "une passe sur un trace deja rogne rend un nouvel objet");
});

// --- 8. Decision 5 : purge des tournees terminees de plus de 12 mois -------------

const MAINTENANT = new Date("2026-09-23T10:00:00.000Z");

function semerPourPurge() {
  const vieilles = [commande("p1", "livre", 1), commande("p2", "livre", 2)];
  const recentes = [commande("p3", "livre", 3)];
  const actives = [commande("p4", "en_livraison", 4)];
  const sansDate = [commande("p5", "livre", 5)];
  for (const c of [...vieilles, ...recentes, ...actives, ...sansDate]) {
    c.products = [{ code: "P1", nom: "Produit", quantite: 2, prixUnitaire: 12 }];
    c.dateCommande = "2025-06-01";
  }
  writeDb({
    ...defaultDb(), clients: clients(), commandes: [...vieilles, ...recentes, ...actives, ...sansDate],
    routes: [
      tournee("vieille", "terminee", vieilles, { completedAt: "2025-08-20T16:00:00.000Z", deliveryDate: "2025-08-20",
        departure: { lat: 46.751, lng: 5.912, label: "Ma position actuelle" } }),
      tournee("recente", "terminee", recentes, { completedAt: "2025-10-01T16:00:00.000Z", deliveryDate: "2025-10-01" }),
      // En cours depuis 14 mois : jamais purgee (ce n'est pas une tournee terminee).
      tournee("active", "en_livraison", actives, { createdAt: "2025-07-01T08:00:00.000Z", deliveryDate: "2025-07-01" }),
      // Terminee sans aucune date lisible : dans le doute, gardee.
      tournee("sans-date", "terminee", sansDate, { createdAt: "", deliveryDate: "" })
    ]
  }, { backup: false });
}

test("lot 5 : la purge supprime les tournees terminees de plus de 12 mois, garde commandes et chiffre d'affaires", async () => {
  semerPourPurge();
  const avant = readDb();
  const statsAvant = await api("/api/statistics");
  assert.ok(avant.routes.some(r => r.id === "vieille"), "temoin : la vieille tournee n'est pas semee");

  const purger = S.purgerTourneesAnciennes || (async () => ({ purgees: 0 }));
  const resultat = await purger({ maintenant: MAINTENANT });

  const apres = readDb();
  assert.deepEqual(apres.routes.map(r => r.id).sort(), ["active", "recente", "sans-date"], "la tournee de 13 mois n'a pas ete purgee");
  assert.equal(resultat.purgees, 1);
  // Les commandes, toutes, telles quelles.
  assert.deepEqual(apres.commandes.map(c => [c.id, c.status]), avant.commandes.map(c => [c.id, c.status]), "des commandes ont change");
  assert.deepEqual((await api("/api/statistics")).body, statsAvant.body, "les statistiques ont change");
  // Avec son trace.
  const { DatabaseSync } = require("node:sqlite");
  const cnx = new DatabaseSync(process.env.SEREO_SQLITE_PATH);
  const traces = cnx.prepare("SELECT route_id FROM traces_tournees").all().map(r => r.route_id);
  cnx.close();
  assert.ok(!traces.includes("vieille"), "le trace de la tournee purgee est reste");
  // Journalisee.
  const entree = apres.historique.find(h => h.type === "Purge");
  assert.ok(entree, "la purge n'est pas journalisee");
  assert.match(entree.message, /1 tournée\(s\) terminée\(s\) avant le 2025-09-23/);
  assert.match(entree.message, /Commandes et chiffre d'affaires intacts/);
});

test("lot 5 : la purge part APRES une sauvegarde qui contient ce qu'elle efface", async () => {
  semerPourPurge();
  const resultat = await S.purgerTourneesAnciennes({ maintenant: MAINTENANT });
  assert.equal(resultat.purgees, 1);
  const fichier = path.join(process.env.SEREO_BACKUP_DIR, resultat.sauvegarde);
  assert.match(resultat.sauvegarde, /avant-purge/);
  // La sauvegarde est celle d'AVANT : la tournee purgee y est.
  const zlib = require("node:zlib");
  const copie = path.join(root, "restauree.sqlite");
  fs.writeFileSync(copie, zlib.gunzipSync(fs.readFileSync(fichier)));
  const { DatabaseSync } = require("node:sqlite");
  const cnx = new DatabaseSync(copie);
  const ids = cnx.prepare("SELECT id FROM routes").all().map(r => r.id);
  cnx.close();
  assert.ok(ids.includes("vieille"), "la sauvegarde ne contient pas la tournee purgee");
});

test("lot 5 : sans sauvegarde, pas de purge", async () => {
  semerPourPurge();
  const echec = await S.purgerTourneesAnciennes({ maintenant: MAINTENANT, sauvegarder: async () => { throw new Error("disque plein"); } });
  assert.equal(echec.purgees, 0);
  assert.ok(readDb().routes.some(r => r.id === "vieille"), "la purge est partie sans sauvegarde");
  const vide = await S.purgerTourneesAnciennes({ maintenant: MAINTENANT, sauvegarder: async () => null });
  assert.equal(vide.purgees, 0);
  assert.ok(readDb().routes.some(r => r.id === "vieille"), "la purge est partie sans fichier de sauvegarde");
  // Temoin : avec une sauvegarde, la meme purge part.
  assert.equal((await S.purgerTourneesAnciennes({ maintenant: MAINTENANT })).purgees, 1);
});

/** Une sauvegarde qui ne finit que quand on la libere. */
function sauvegardeRetenue() {
  let liberer, appelee = false;
  const fin = new Promise(r => { liberer = r; });
  return {
    sauvegarder: async () => { appelee = true; await fin; return "db-test-avant-purge.sqlite.gz"; },
    appelee: () => appelee,
    liberer: () => liberer()
  };
}

async function attendre(condition, message) {
  const limite = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > limite) throw new Error(message);
    await new Promise(r => setTimeout(r, 10));
  }
}

test("lot 5 : pendant la sauvegarde d'avant purge, un « Livré » ne l'attend pas, et la purge ne l'efface pas", async () => {
  semerPourPurge();
  const retenue = sauvegardeRetenue();
  const purge = S.purgerTourneesAnciennes({ maintenant: MAINTENANT, sauvegarder: retenue.sauvegarder });
  try {
    await attendre(retenue.appelee, "prealable : la sauvegarde n'a pas ete demandee");
    const geste = api("/api/routes/active/stops/stop-active-1", { method: "PATCH", body: JSON.stringify({ status: "livre" }) });
    const issue = await Promise.race([geste, new Promise(r => setTimeout(() => r("attente"), 2000))]);
    assert.notEqual(issue, "attente", "le geste a attendu la fin de la sauvegarde d'avant purge");
    assert.equal(issue.status, 200, JSON.stringify(issue.body));
  } finally {
    retenue.liberer();
  }
  const resultat = await purge;
  assert.equal(resultat.purgees, 1, "temoin : la purge n'est pas partie");
  const apres = readDb();
  assert.ok(!apres.routes.some(r => r.id === "vieille"));
  const active = apres.routes.find(r => r.id === "active");
  assert.equal(active.stops[0].status, "livre", "la purge a ecrase le geste fait pendant sa sauvegarde");
});

test("lot 5 : une tournee modifiee pendant la sauvegarde d'avant purge n'est pas purgee (la sauvegarde n'a pas sa derniere version)", async () => {
  semerPourPurge();
  const retenue = sauvegardeRetenue();
  const purge = S.purgerTourneesAnciennes({ maintenant: MAINTENANT, sauvegarder: retenue.sauvegarder });
  try {
    await attendre(retenue.appelee, "prealable : la sauvegarde n'a pas ete demandee");
    const db = readDb();
    db.routes.find(r => r.id === "vieille").notes = "corrigee pendant la sauvegarde";
    writeDb(db, { backup: false });
  } finally {
    retenue.liberer();
  }
  const resultat = await purge;
  assert.equal(resultat.purgees, 0, "une tournee absente de la sauvegarde sous sa derniere forme a ete purgee");
  assert.ok(readDb().routes.some(r => r.id === "vieille"));
  // Temoin : le lendemain, la meme tournee part.
  assert.equal((await S.purgerTourneesAnciennes({ maintenant: MAINTENANT })).purgees, 1);
});

// --- 9. Plafond du calcul « sans depart » ------------------------------------

test("lot 5 : une tournee « sans depart » exige une selection de 1 a 50 commandes", async () => {
  const cmd = Array.from({ length: 60 }, (_, i) => commande("x" + i, "pret_livraison", i));
  writeDb({ ...defaultDb(), clients: clients(), commandes: cmd, routes: [] }, { backup: false });

  const toutes = await api("/api/routes", { method: "POST", body: JSON.stringify({ sector: "Tous" }) });
  assert.equal(toutes.status, 400, `sans selection, la tournee prend toutes les commandes pretes (${toutes.body?.stops?.length} arrets)`);
  const trop = await api("/api/routes", { method: "POST", body: JSON.stringify({ sector: "Tous", orderIds: cmd.slice(0, 51).map(c => c.id) }) });
  assert.equal(trop.status, 400, `51 commandes acceptees (${trop.body?.stops?.length} arrets)`);
  assert.match(trop.body.error, /entre 1 et 50 commandes/);
  // Temoin : 50, c'est permis.
  const ok = await api("/api/routes", { method: "POST", body: JSON.stringify({ sector: "Tous", orderIds: cmd.slice(0, 50).map(c => c.id) }) });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.stops.length, 50);
});

// --- 10. Relais de recherche d'adresse : cache et limite de debit ------------

test("lot 5 : /api/geocode garde ses reponses en cache et limite le debit vers la Geoplateforme", async () => {
  const fetchReel = globalThis.fetch;
  const appels = [];
  // Aucun appel reseau reel : le geocodeur est bouchonne dans ce processus.
  // Depuis le lot 3 (integration du 23/09), /api/geocode passe par
  // lib/geocodage.js, qui interroge la Base Adresse Nationale
  // (api-adresse.data.gouv.fr), et non plus la Geoplateforme : le bouchon
  // prend les deux, sinon la recherche partait au vrai reseau.
  globalThis.fetch = async (url, init) => {
    if (/^https:\/\/(data\.geopf\.fr|api-adresse\.data\.gouv\.fr)\//.test(String(url))) {
      appels.push(String(url));
      return new Response(JSON.stringify({ features: [{ properties: { label: "1 rue de Dole 39100 Dole", score: 0.9, type: "housenumber", postcode: "39100", city: "Dole" }, geometry: { coordinates: [5.49, 47.09] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return fetchReel(url, init);
  };
  try {
    const a = await api("/api/geocode?q=" + encodeURIComponent("1 rue de Dole"));
    const b = await api("/api/geocode?q=" + encodeURIComponent("  1 RUE  de dole "));
    assert.equal(a.status, 200);
    assert.deepEqual(b.body, a.body);
    assert.equal(appels.length, 1, `la meme recherche est repartie ${appels.length} fois`);

    // Rafale de 12 recherches distinctes : au plus 5 (+ la recharge) partent.
    const statuts = [];
    for (let i = 0; i < 12; i++) statuts.push((await api(`/api/geocode?q=${encodeURIComponent(`${i} rue du Pont`)}`)).status);
    assert.ok(appels.length <= 1 + 6, `${appels.length} appels a la Geoplateforme pour 13 recherches en rafale`);
    assert.ok(statuts.includes(503), `aucune recherche refusee : ${statuts.join(",")}`);
    assert.equal(statuts[0], 200, "la premiere recherche de la rafale est refusee");
    const refus = await api(`/api/geocode?q=${encodeURIComponent("99 rue du Pont")}`);
    assert.equal(refus.status, 503);
    assert.match(refus.body.error, /Réessaie dans une seconde/);
    // Une recherche deja en cache passe toujours, meme seau vide.
    assert.equal((await api("/api/geocode?q=" + encodeURIComponent("1 rue de Dole"))).status, 200);
  } finally {
    globalThis.fetch = fetchReel;
  }
});

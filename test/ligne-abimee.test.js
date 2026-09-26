// Robustesse (25/09, chasse aux defauts, section 4) : UN caractere abime dans le
// texte d'UNE ligne de la base faisait tomber toutes les pages (500), sans
// restauration, et /healthz restait au vert. Mesure du rapport : un « { »
// remplace par « [ » dans une ligne d'historique -> /api/orders, /api/stock,
// /api/routes en 500.
//
// La ligne illisible est desormais COPIEE (octets inchanges) dans
// lignes_en_quarantaine avec ce qui en depend, journalisee, et ecartee de la
// lecture ; rien d'autre ne bouge. Chaque banc rougit sur le code d'avant.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-ligne-abimee-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const { app, readDb, writeDb, defaultDb, closeStorage, _flushPendingBackup } = require("../server");
const { jeuProduction } = require("./e2e/jeu-production.js");

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

// Une connexion par requete : voir test/lot5-rapidite.test.js (api).
async function api(chemin, init = {}) {
  const headers = { Origin: base, connection: "close", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) };
  const res = await fetch(base + chemin, { ...init, headers });
  const texte = await res.text();
  let body;
  try { body = texte ? JSON.parse(texte) : undefined; } catch { body = texte; }
  return { status: res.status, body };
}

/** Une connexion a part sur la base : ce que le disque contient vraiment. */
function brut(fn) {
  const cnx = new DatabaseSync(process.env.SEREO_SQLITE_PATH);
  cnx.exec("PRAGMA busy_timeout = 5000");
  try { return fn(cnx); } finally { cnx.close(); }
}

/** Abime un caractere : le premier « { » du texte devient « [ » (le cas mesure). */
function abimer(table, colonne, cleColonne, cle) {
  return brut(cnx => {
    const avant = cnx.prepare(`SELECT hex(${colonne}) AS h FROM ${table} WHERE ${cleColonne} = ?`).get(cle).h;
    cnx.prepare(`UPDATE ${table} SET ${colonne} = '[' || substr(${colonne}, 2) WHERE ${cleColonne} = ?`).run(cle);
    const apres = cnx.prepare(`SELECT hex(${colonne}) AS h FROM ${table} WHERE ${cleColonne} = ?`).get(cle).h;
    assert.notEqual(apres, avant, "prealable : la ligne n'a pas ete abimee");
    return apres;
  });
}

function quarantaine() {
  return brut(cnx => {
    const existe = cnx.prepare("SELECT 1 FROM sqlite_master WHERE name = 'lignes_en_quarantaine'").get();
    return existe
      ? cnx.prepare("SELECT table_source, ligne_id, hex(contenu) AS contenu, colonnes FROM lignes_en_quarantaine ORDER BY id").all().map(r => ({ ...r }))
      : [];
  });
}

/** Toutes les lignes de toutes les tables de donnees, par table puis par id. */
const TABLES = ["produits", "clients", "commandes", "lignes_commande", "livraisons", "routes", "traces_tournees", "historique",
  "ventes", "mouvements_stock", "abonnements", "relances_crm", "secteurs_livraison", "imports_archives"];
function photo() {
  return brut(cnx => Object.fromEntries(TABLES.map(t => {
    const cle = t === "traces_tournees" ? "route_id" : "id";
    const lignes = cnx.prepare(`SELECT * FROM ${t} ORDER BY ${cle}`).all();
    return [t, new Map(lignes.map(l => [String(l[cle]), JSON.stringify({ ...l, sort_order: undefined })]))];
  })));
}

/** Ce qui a disparu, apparu ou change d'une photo a l'autre, table par table. */
function ecart(a, b) {
  const out = {};
  for (const t of TABLES) {
    const partis = [...a[t].keys()].filter(k => !b[t].has(k));
    const venus = [...b[t].keys()].filter(k => !a[t].has(k));
    const changes = [...a[t].keys()].filter(k => b[t].has(k) && a[t].get(k) !== b[t].get(k));
    if (partis.length || venus.length || changes.length) out[t] = { partis, venus, changes };
  }
  return out;
}

function trace(n = 20) {
  return { type: "LineString", coordinates: Array.from({ length: n }, (_, j) => [5.9 + j / 1e4, 46.7 + j / 1e4]) };
}

/** Une base neuve (quarantaine comprise), puis le jeu du banc. */
function repartirDeZero() {
  closeStorage();
  for (const f of fs.readdirSync(root)) if (f.startsWith("db.sqlite")) fs.rmSync(path.join(root, f));
}

function semer() {
  repartirDeZero();
  const commandes = ["o1", "o2", "o3"].map((id, i) => ({
    id, clientId: "c1", clientName: "Client 1", address: "1 rue du Test", postalCode: "39300", city: "Champagnole",
    status: "pret_livraison", deliveryDate: "2026-09-25", dateCommande: "2026-09-25",
    products: [{ code: "P1", nom: "Produit", quantite: 1 + i }, { code: "P2", nom: "Autre", quantite: 2 }]
  }));
  writeDb({
    ...defaultDb(),
    clients: [{ id: "c1", nom: "Client 1", rue: "1 rue du Test", codePostal: "39300", ville: "Champagnole" },
      { id: "c2", nom: "Client 2", rue: "2 rue du Test", codePostal: "39300", ville: "Champagnole" }],
    stock: [{ id: "p1", code: "P1", nom: "Produit", quantite: 50 }, { id: "p2", code: "P2", nom: "Autre", quantite: 50 }],
    commandes,
    routes: [{
      id: "t1", sector: "Champagnole", status: "prete", deliveryDate: "2026-09-25", geometry: trace(),
      stops: [{ id: "s1", routeId: "t1", orderId: "o1", clientId: "c1", orderIndex: 1, clientName: "Client 1", status: "pret_livraison", lat: 46.7, lng: 5.9, products: [] }]
    }],
    historique: Array.from({ length: 5 }, (_, i) => ({ id: `h-${i + 1}`, date: `2026-09-2${i}T08:00:00.000Z`, type: "Test", message: `entree ${i + 1}` })),
    settings: { orderNumbering: { prefix: "BON", dateFormat: "dmy", resetAnnually: true } }
  }, { backup: false });
  closeStorage();
}

test("un caractere abime dans UNE ligne d'historique : pages, journal et gestes repondent, la ligne est mise de cote octet pour octet", async () => {
  semer();
  const abime = abimer("historique", "payload", "id", "h-5");
  closeStorage(); // un redemarrage : la base se rouvre avec la ligne abimee
  const avant = photo();

  // Les lectures, le journal (qui lit l'historique) et un geste d'ecriture
  // (qui normalise TOUTES les tables) : sur le code d'avant, les deux derniers
  // repondent 500 -- et avec eux tous les gestes de l'application.
  for (const chemin of ["/api/orders", "/api/stock", "/api/routes", "/api/clients", "/api/dashboard", "/api/journal"]) {
    const r = await api(chemin);
    assert.equal(r.status, 200, `${chemin} : ${JSON.stringify(r.body)}`);
  }
  const geste = await api("/api/stock/p1", { method: "PATCH", body: JSON.stringify({ quantite: 49 }) });
  assert.equal(geste.status, 200, `un geste d'ecriture : ${JSON.stringify(geste.body)}`);
  assert.equal((await api("/api/orders")).body.length, 3, "les commandes ne se lisent plus");
  const q = quarantaine();
  assert.equal(q.length, 1, `quarantaine : ${JSON.stringify(q)}`);
  assert.equal(q[0].table_source, "historique");
  assert.equal(q[0].ligne_id, "h-5");
  assert.equal(q[0].contenu, abime, "le texte mis de cote n'est pas celui du disque");
  assert.deepEqual(JSON.parse(q[0].colonnes).type, "Test", "les autres colonnes de la ligne ne sont pas gardees");
  assert.ok(!readDb().historique.some(h => h.id === "h-5"), "la ligne illisible est encore lue");

  // Le geste a ecrit : la ligne a quitte sa table, le journal le dit, et
  // RIEN d'autre n'a disparu. (Le geste change ce qu'il change : le produit,
  // son mouvement, l'etat de stock des commandes.)
  const diff = ecart(avant, photo());
  const partis = Object.fromEntries(Object.entries(diff).filter(([, d]) => d.partis.length).map(([t, d]) => [t, d.partis]));
  assert.deepEqual(partis, { historique: ["h-5"] }, `lignes disparues : ${JSON.stringify(partis)}`);
  const venus = Object.fromEntries(Object.entries(diff).filter(([, d]) => d.venus.length).map(([t, d]) => [t, d.venus.length]));
  assert.deepEqual(Object.keys(venus).sort(), ["historique", "mouvements_stock"], JSON.stringify(venus));
  assert.deepEqual(diff.historique.changes, [], "des lignes d'historique lisibles ont change");
  const journal = readDb().historique.filter(h => h.type === "Stockage");
  assert.equal(journal.length, 1, "la mise de cote n'est pas au journal");
  assert.match(journal[0].message, /1 ligne\(s\) illisible\(s\) mise\(s\) de côté \(historique h-5\)/);
  assert.equal(quarantaine()[0].contenu, abime, "la copie a disparu avec l'ecriture");
  const etat = await api("/api/storage/status");
  assert.equal(etat.body.lignesMisesDeCote.nombre, 1);
  assert.deepEqual(etat.body.lignesMisesDeCote.dernieres.map(l => [l.table, l.ligne]), [["historique", "h-5"]]);

  // Rejouee (redemarrage, ecriture) : ni nouvelle copie, ni nouvelle ligne au journal.
  closeStorage();
  writeDb(readDb(), { backup: false });
  assert.equal(quarantaine().length, 1);
  assert.equal(readDb().historique.filter(h => h.type === "Stockage").length, 1, "la mise de cote est journalisee deux fois");
});

test("un redemarrage AVANT toute ecriture : une seule copie, et la mise de cote arrive quand meme au journal, une fois", () => {
  semer();
  abimer("historique", "payload", "id", "h-4");
  closeStorage();
  assert.equal(readDb().historique.length, 4); // lue, copiee, pas d'ecriture
  closeStorage();
  assert.equal(readDb().historique.length, 4); // relue par un « autre processus »
  assert.equal(quarantaine().length, 1, "la meme ligne est copiee deux fois");
  writeDb(readDb(), { backup: false });
  writeDb(readDb(), { backup: false });
  const journal = readDb().historique.filter(h => h.type === "Stockage");
  assert.equal(journal.length, 1, `journal : ${JSON.stringify(journal.map(h => h.message))}`);
  assert.match(journal[0].message, /historique h-4/);
});

test("une commande abimee part en quarantaine AVEC ses lignes de commande et ses livraisons ; les autres ne bougent pas", async () => {
  semer();
  const avant = photo();
  const lignesO2 = [...avant.lignes_commande.values()].filter(l => JSON.parse(l).commande_id === "o2").length;
  assert.ok(lignesO2 >= 2, "prealable : la commande o2 a des lignes de commande");
  const abime = abimer("commandes", "payload", "id", "o2");
  closeStorage();

  const r = await api("/api/orders");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.map(o => o.id).sort(), ["o1", "o3"]);
  const q = quarantaine();
  assert.equal(q.find(x => x.table_source === "commandes").contenu, abime);
  assert.equal(q.filter(x => x.table_source === "lignes_commande").length, lignesO2, "les lignes de la commande ne sont pas copiees");
  assert.equal(q.filter(x => x.table_source === "livraisons").length, 1, "la livraison de la commande n'est pas copiee");

  writeDb(readDb(), { backup: false });
  const diff = ecart(avant, photo());
  assert.deepEqual(diff.commandes, { partis: ["o2"], venus: [], changes: [] });
  assert.equal(diff.lignes_commande.partis.length, lignesO2);
  assert.deepEqual(diff.lignes_commande.venus, []);
  assert.deepEqual(diff.livraisons, { partis: ["commande-o2"], venus: [], changes: [] });
  // Seules la commande, ce qui en depend et la ligne de journal ont bouge.
  assert.deepEqual(Object.keys(diff).sort(), ["commandes", "historique", "lignes_commande", "livraisons"], JSON.stringify(diff));
  assert.deepEqual(diff.historique.partis, []);
});

test("la SEULE commande d'un client, abimee, ne « revient » pas en commande neuve du jour", () => {
  // syncWorkflow donne une commande « de repli » a un client qui n'en a
  // aucune (compatibilite) : sans garde, la commande mise de cote revenait en
  // commande neuve, datee du jour -- mesure sur une base ecrite par v1.45.1 :
  // CMD-2025-039 illisible -> CMD-2026-164 livree aujourd'hui.
  repartirDeZero();
  writeDb({
    ...defaultDb(),
    clients: [{ id: "c3", nom: "Client 3", rue: "3 rue du Test", codePostal: "39300", ville: "Champagnole", statut: "livree",
      produits: [{ code: "P1", nom: "Produit", quantite: 2 }] }],
    stock: [{ id: "p1", code: "P1", nom: "Produit", quantite: 50 }],
    commandes: [{ id: "o9", numero: "CMD-2025-039", clientId: "c3", clientName: "Client 3", status: "livre", dateCommande: "2025-12-08",
      deliveryDate: "2025-12-08", products: [{ code: "P1", nom: "Produit", quantite: 2 }] }]
  }, { backup: false });
  closeStorage();
  abimer("commandes", "payload", "id", "o9");
  closeStorage();
  writeDb(readDb(), { backup: false });
  assert.deepEqual(readDb().commandes.map(o => `${o.id} ${o.numero}`), [], "une commande est apparue a la place de la commande mise de cote");
  assert.equal(quarantaine().filter(x => x.table_source === "commandes").length, 1);
  // Temoin : un client SANS commande mise de cote garde sa commande de repli.
  const db = readDb();
  db.clients.push({ id: "c4", nom: "Client 4", rue: "4 rue du Test", codePostal: "39300", ville: "Champagnole", produits: [{ code: "P1", nom: "Produit", quantite: 1 }] });
  writeDb(db, { backup: false });
  assert.deepEqual(readDb().commandes.map(o => o.clientId), ["c4"], "temoin : la commande de repli ne se cree plus du tout");
});

test("un trace de tournee abime : la tournee se lit sans sa ligne, le trace est mis de cote", async () => {
  semer();
  const abime = abimer("traces_tournees", "trace", "route_id", "t1");
  closeStorage();
  const liste = await api("/api/routes");
  assert.equal(liste.status, 200, JSON.stringify(liste.body));
  assert.equal(liste.body.find(t => t.id === "t1").geometry, null);
  const detail = await api("/api/routes/t1");
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.stops.length, 1);
  const q = quarantaine();
  assert.equal(q.length, 1);
  assert.deepEqual([q[0].table_source, q[0].ligne_id, q[0].contenu], ["traces_tournees", "t1", abime]);
});

test("des reglages abimes sont mis de cote AVANT que l'ecriture suivante ne les remplace", () => {
  semer();
  const abime = abimer("app_meta", "value", "key", "settings");
  closeStorage();
  writeDb(readDb(), { backup: false });
  const q = quarantaine();
  assert.equal(q.length, 1, "les reglages illisibles ont ete remplaces sans copie");
  assert.deepEqual([q[0].table_source, q[0].ligne_id, q[0].contenu], ["app_meta", "settings", abime]);
});

test("une table remplacee sans etre lue (import, purge) ne retire pas une ligne illisible sans la mettre de cote", () => {
  semer();
  const abime = abimer("clients", "payload", "id", "c2");
  closeStorage();
  const db = readDb();
  db.clients = [{ id: "c9", nom: "Nouveau", rue: "9 rue du Test", codePostal: "39300", ville: "Champagnole" }];
  writeDb(db, { backup: false });
  const q = quarantaine();
  assert.equal(q.filter(x => x.table_source === "clients").length, 1, `quarantaine : ${JSON.stringify(q)}`);
  assert.equal(q.find(x => x.table_source === "clients").contenu, abime);
});

test("une ecriture qui echoue APRES la mise de cote (ROLLBACK) : la ligne est recopiee a l'essai suivant, jamais retiree sans copie", () => {
  // Relecture adverse du 26/09 : la copie faite dans la transaction de
  // l'ecriture disparaissait avec son ROLLBACK, mais le processus se
  // souvenait l'avoir faite ; a l'essai suivant, la ligne partait sans copie.
  semer();
  const abime = abimer("clients", "payload", "id", "c2");
  closeStorage();
  // Un import : les clients remplaces sans etre lus, et un produit neuf dont
  // l'ecriture echoue (disque plein) apres le pre-controle des lignes retirees.
  brut(cnx => cnx.exec("CREATE TRIGGER panne BEFORE INSERT ON produits BEGIN SELECT RAISE(ABORT, 'disque plein simule'); END;"));
  const importer = () => {
    const db = readDb();
    db.clients = [{ id: "c1", nom: "Client 1", rue: "1 rue du Test", codePostal: "39300", ville: "Champagnole" }];
    db.stock = [...db.stock, { id: "p9", code: "P9", nom: "Neuf", quantite: 1 }];
    writeDb(db, { backup: false });
  };
  assert.throws(importer, /disque plein simule/);
  assert.ok(brut(cnx => cnx.prepare("SELECT 1 FROM clients WHERE id = 'c2'").get()), "prealable : l'ecriture echouee n'a rien retire");
  brut(cnx => cnx.exec("DROP TRIGGER panne"));
  importer();
  const q = quarantaine().filter(x => x.table_source === "clients");
  assert.equal(q.length, 1, `la ligne illisible a quitte sa table sans copie : ${JSON.stringify(quarantaine())}`);
  assert.equal(q[0].contenu, abime);
  assert.ok(!brut(cnx => cnx.prepare("SELECT 1 FROM clients WHERE id = 'c2'").get()), "temoin : la ligne devait quitter sa table");
});

test("des octets qui ne sont plus de l'UTF-8 sont copies tels quels (pas de U+FFFD)", () => {
  semer();
  // {"id":"h-3",<FF>"x":1} : un octet invalide HORS d'une chaine JSON.
  const hex = Buffer.from('{"id":"h-3",').toString("hex") + "ff" + Buffer.from('"x":1}').toString("hex");
  brut(cnx => cnx.prepare(`UPDATE historique SET payload = CAST(X'${hex}' AS TEXT) WHERE id = 'h-3'`).run());
  closeStorage();
  assert.equal(readDb().historique.length, 4);
  const q = quarantaine();
  assert.equal(q.length, 1);
  assert.equal(q[0].contenu, hex.toUpperCase(), "les octets mis de cote ne sont pas ceux du disque");
});

test("si la copie est impossible, rien n'est ecarte : l'erreur d'origine remonte et la ligne reste dans sa table", async () => {
  semer();
  abimer("historique", "payload", "id", "h-2");
  closeStorage();
  readDb(); // ouvre la base (la table de quarantaine est creee a l'ouverture)
  brut(cnx => cnx.exec("DROP TABLE lignes_en_quarantaine"));
  // Temoin : la page qui ne lit pas l'historique repond.
  assert.equal((await api("/api/orders")).status, 200);
  const journal = await api("/api/journal");
  assert.equal(journal.status, 500, "une ligne a ete ecartee sans avoir ete mise de cote");
  const geste = await api("/api/stock/p1", { method: "PATCH", body: JSON.stringify({ quantite: 48 }) });
  assert.equal(geste.status, 500, "une ecriture est passee sans que la ligne soit mise de cote");
  assert.ok(brut(cnx => cnx.prepare("SELECT 1 FROM historique WHERE id = 'h-2'").get()), "la ligne a disparu de sa table");
  closeStorage();
});

test("base de la forme de la production : une commande abimee, et rien d'autre ne bouge", () => {
  closeStorage();
  for (const f of fs.readdirSync(root)) if (f.startsWith("db.sqlite")) fs.rmSync(path.join(root, f));
  writeDb({ ...defaultDb(), ...jeuProduction() }, { backup: false });
  closeStorage();
  writeDb(readDb(), { backup: false }); // l'etat stable d'un serveur deja demarre
  closeStorage();
  const avant = photo();
  assert.ok(avant.commandes.size >= 200 && avant.historique.size >= 1000, "prealable : pas le volume de la production");
  // Une commande qui a des lignes de commande.
  const cible = [...avant.lignes_commande.values()].map(l => JSON.parse(l).commande_id).find(Boolean);
  const lignes = [...avant.lignes_commande.values()].filter(l => JSON.parse(l).commande_id === cible).length;
  const livraisons = [...avant.livraisons.values()].filter(l => JSON.parse(l).commande_id === cible).length;
  const abime = abimer("commandes", "payload", "id", cible);

  writeDb(readDb(), { backup: false });
  const diff = ecart(avant, photo());
  assert.deepEqual(diff.commandes, { partis: [cible], venus: [], changes: [] }, JSON.stringify(diff.commandes));
  assert.equal(diff.lignes_commande.partis.length, lignes);
  assert.deepEqual(diff.lignes_commande.venus, []);
  if (livraisons) assert.equal(diff.livraisons.partis.length, livraisons);
  assert.equal(diff.historique.venus.length, 1);
  assert.deepEqual(diff.historique.partis, []);
  const attendu = ["commandes", "historique", "lignes_commande", ...(livraisons ? ["livraisons"] : [])].sort();
  assert.deepEqual(Object.keys(diff).sort(), attendu, JSON.stringify(Object.fromEntries(Object.entries(diff).map(([t, d]) => [t, { partis: d.partis.length, venus: d.venus.length, changes: d.changes.slice(0, 3) }]))));
  const q = quarantaine();
  assert.equal(q.find(x => x.table_source === "commandes").contenu, abime);
  assert.equal(q.filter(x => x.table_source === "lignes_commande").length, lignes);
  assert.equal(q.filter(x => x.table_source === "livraisons").length, livraisons);
});

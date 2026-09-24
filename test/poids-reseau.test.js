// Poids du reseau et des donnees a l'ouverture (24/09, mesure en production).
//
// Sur un jeu de MEME FORME que la production (test/e2e/jeu-production.js :
// 97 clients, 224 commandes, 633 mouvements, une image de marque de 116 ko),
// ce que l'API envoie a la page -- en octets, pas en millisecondes : le
// resultat ne depend pas de la machine.
//
// Chaque allegement a son temoin : la donnee retiree d'une liste reste
// disponible la ou un ecran la montre (fiche client, image de marque, liste
// complete des mouvements sans `limite`).

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { jeuProduction } = require("./e2e/jeu-production");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-poids-"));
const seme = jeuProduction();
fs.mkdirSync(path.join(tmpRoot, "data"), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, "data", "seed.json"), JSON.stringify(seme));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "seed.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const { app, readDb, closeStorage, _flushPendingBackup } = require("../server");

let server;
let base;
before(() => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(async () => {
  try { await _flushPendingBackup(); } catch { /* rien en attente */ }
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  resolve();
})));

async function lire(chemin, entetes = {}) {
  const res = await fetch(base + chemin, { headers: entetes });
  const octets = Buffer.from(await res.arrayBuffer());
  return { res, octets, json: () => JSON.parse(octets.toString("utf8")) };
}

test("prealable : le jeu a la forme de la production", async () => {
  const db = readDb();
  assert.equal(db.clients.length, 97);
  assert.equal(db.commandes.length, 224);
  assert.equal(db.stockMovements.length, 633);
  assert.equal(db.ventes.length, 429);
  assert.ok(db.settings.appearance.brandImage.length > 100000, "l'image de marque du jeu fait plus de 100 ko");
  assert.ok(db.clients.every(c => c.ordersByDate && Object.keys(c.ordersByDate).length > 0), "chaque client porte son releve d'import");
});

test("/api/crm/clients : la liste ne recopie plus les commandes de chaque client", async () => {
  const liste = await lire("/api/crm/clients");
  const clients = await lire("/api/clients");
  const commandes = await lire("/api/orders");
  const vues = liste.json();
  assert.equal(vues.length, 97);
  assert.deepEqual(vues.filter(v => "orderHistory" in v).map(v => v.id), [], "des clients recopient encore leurs commandes");
  assert.deepEqual(vues.filter(v => "ordersByDate" in v).map(v => v.id), [], "des clients portent encore le releve d'import");
  // Avant : chaque client y recopiait ses commandes -- la liste pesait plus que
  // les commandes elles-memes (serveur seme : 536 ko contre 341 ko).
  console.log(`[poids] /api/crm/clients ${liste.octets.length} o ; /api/clients ${clients.octets.length} o ; /api/orders ${commandes.octets.length} o`);
  assert.ok(liste.octets.length < 200000, `/api/crm/clients fait ${liste.octets.length} o (avant : 536 041 sur le serveur seme)`);
  assert.ok(liste.octets.length < commandes.octets.length, "la liste des clients pese plus que toutes les commandes");
  // Ce que la liste garde : ce qu'un ecran lit (totaux, rappels, statut deduit).
  const plusGros = vues.reduce((a, v) => (v.totalOrders > a.totalOrders ? v : a));
  assert.equal(plusGros.totalOrders, 14);
  assert.ok(Array.isArray(plusGros.reminderHistory));
  assert.equal(typeof plusGros.totalRevenue, "number");
  assert.equal(plusGros.crmStatus, "client_actif");
});

test("temoin : la fiche d'un client garde son historique de commandes", async () => {
  const vues = (await lire("/api/crm/clients")).json();
  const plusGros = vues.reduce((a, v) => (v.totalOrders > a.totalOrders ? v : a));
  const fiche = (await lire(`/api/crm/clients/${encodeURIComponent(plusGros.id)}`)).json();
  assert.equal(fiche.orderHistory.length, 14);
  assert.ok(fiche.orderHistory.every(o => o.clientId === plusGros.id));
});

test("/api/clients : sans le releve d'import, qui reste en base", async () => {
  const r = await lire("/api/clients");
  const clients = r.json();
  assert.equal(clients.length, 97);
  assert.deepEqual(clients.filter(c => "ordersByDate" in c).map(c => c.id), []);
  // Avant : 184 592 o, dont 43 % de releve d'import.
  assert.ok(r.octets.length < 130000, `/api/clients fait ${r.octets.length} o (avant : 184 592)`);
  // Le reste de la fiche est la, champ pour champ.
  const enBase = readDb().clients.find(c => c.id === clients[0].id);
  const { ordersByDate, ...attendu } = enBase;
  assert.deepEqual(clients[0], attendu);
  assert.ok(Object.keys(ordersByDate).length > 0, "le releve d'import a quitte la base");
});

test("/api/settings/appearance : l'adresse de l'image, pas ses 116 ko", async () => {
  const r = await lire("/api/settings/appearance");
  const apparence = r.json();
  assert.ok(r.octets.length < 1000, `/api/settings/appearance fait ${r.octets.length} o (avant : 116 191)`);
  const enBase = readDb().settings.appearance.brandImage;
  const empreinte = crypto.createHash("sha256").update(enBase).digest("hex").slice(0, 16);
  assert.equal(apparence.brandImage, `/api/settings/appearance/image?v=${empreinte}`);
  assert.equal(apparence.themeId, "sereo");
});

test("temoin : l'image de marque est servie a son adresse, identique, gardee par le navigateur", async () => {
  const { brandImage } = (await lire("/api/settings/appearance")).json();
  const r = await lire(brandImage);
  assert.equal(r.res.status, 200);
  assert.equal(r.res.headers.get("content-type"), "image/png");
  const enBase = readDb().settings.appearance.brandImage;
  assert.ok(r.octets.equals(Buffer.from(enBase.split(",")[1], "base64")), "l'image servie n'est pas celle de la base");
  assert.match(r.res.headers.get("cache-control"), /immutable/);
  assert.match(r.res.headers.get("content-security-policy"), /sandbox/);
  // Revalidation : 304 sans corps. Par node:http, comme le navigateur la fait :
  // fetch() ajoute « Cache-Control: no-cache » a une requete conditionnelle
  // (norme Fetch), et un serveur doit alors repondre en entier.
  const revalide = await new Promise((resolve, reject) => {
    require("node:http").get(base + brandImage, { headers: { "if-none-match": r.res.headers.get("etag") } }, res => {
      const morceaux = [];
      res.on("data", m => morceaux.push(m));
      res.on("end", () => resolve({ status: res.statusCode, octets: Buffer.concat(morceaux) }));
    }).on("error", reject);
  });
  assert.equal(revalide.status, 304);
  assert.equal(revalide.octets.length, 0);
  // Une autre version demandee : pas de mise en cache longue.
  const autre = await lire("/api/settings/appearance/image?v=perimee");
  assert.doesNotMatch(autre.res.headers.get("cache-control"), /immutable/);
});

test("image de marque : une nouvelle image change d'adresse, la remise a zero la retire", async () => {
  const patch = body => fetch(base + "/api/settings/appearance", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }).then(r => r.json());
  const avant = (await lire("/api/settings/appearance")).json().brandImage;
  const autre = `data:image/png;base64,${Buffer.from("autre image").toString("base64")}`;
  const apres = await patch({ brandImage: autre });
  assert.notEqual(apres.brandImage, avant);
  assert.match(apres.brandImage, /^\/api\/settings\/appearance\/image\?v=[0-9a-f]{16}$/);
  assert.equal((await lire(apres.brandImage)).octets.toString(), "autre image");
  const remis = await patch({ brandImage: "" });
  assert.equal(remis.brandImage, "");
  assert.equal((await lire("/api/settings/appearance/image")).res.status, 404);
});

test("/api/stock-movements?limite=12 : les 12 que l'ecran montre ; sans limite, tous", async () => {
  const tous = (await lire("/api/stock-movements")).json();
  const r = await lire("/api/stock-movements?limite=12");
  assert.equal(tous.length, 633);
  assert.deepEqual(r.json(), tous.slice(0, 12));
  assert.ok(r.octets.length < 6000, `${r.octets.length} o pour 12 mouvements (avant : 202 606 pour 633)`);
});

test("index.html demande ses scripts et feuilles a l'adresse exacte que le service worker precharge", () => {
  // Avant (24/09) : /js/app.js?v=... et /css/style.css?v=... dans la page, sans
  // ?v= dans APP_SHELL. Le cache compare l'adresse entiere : a la premiere
  // ouverture et apres chaque mise a jour, les deux fichiers partaient deux fois
  // (240 ko compresses), et le prechargement ne servait jamais la page.
  const racine = path.join(__dirname, "..", "public");
  const page = fs.readFileSync(path.join(racine, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(racine, "service-worker.js"), "utf8");
  const shell = new Set([...sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
  const adresses = [...page.matchAll(/<(?:script\b[^>]*\bsrc|link\b[^>]*\brel="stylesheet"[^>]*\bhref)="([^"]+)"/g)].map(m => m[1]);
  // Temoin : l'instrument voit bien les deux fichiers.
  assert.ok(adresses.some(a => a.startsWith("/js/app.js")), `app.js absent de ${adresses.join(", ")}`);
  assert.ok(adresses.some(a => a.startsWith("/css/style.css")), `style.css absent de ${adresses.join(", ")}`);
  assert.deepEqual(adresses.filter(a => shell.has(a.split("?")[0]) && !shell.has(a)), []);
});

test("/api/dashboard donne le compte des ventes importees (la page ne charge plus /api/ventes pour lui)", async () => {
  const tableau = (await lire("/api/dashboard")).json();
  assert.deepEqual(tableau.ventes, { total: 429 });
});

test("un geste d'arret rend le client tel que /api/clients le rend (sans releve d'import)", async () => {
  // Lot 5 : la reponse d'un geste porte le client « tel que les listes », et
  // l'ecran le remet dans sa liste. Un client de ce jeu a un releve d'import :
  // la reponse doit l'avoir perdu, comme la liste.
  const db = readDb();
  const client = db.clients.find(c => c.ordersByDate && Object.keys(c.ordersByDate).length);
  assert.ok(client, "prealable : un client avec releve d'import");
  const commande = {
    id: "cmd-banc-geste", numero: "CMD-2026-999", clientId: client.id, clientName: client.nom, address: client.rue || "1 rue Neuve",
    city: client.ville, postalCode: client.codePostal, status: "en_livraison", preparationStatus: "terminee",
    products: [{ code: "P1", nom: "Produit", quantite: 1 }], lat: 46.7, lng: 5.9, dateCommande: "2026-09-20"
  };
  db.commandes.push(commande);
  db.routes.unshift({
    id: "route-banc-geste", sector: client.secteur, status: "en_livraison", deliveryDate: "2026-09-24",
    stops: [{ id: "stop-banc-geste", routeId: "route-banc-geste", orderId: commande.id, clientId: client.id, orderIndex: 1,
      clientName: client.nom, address: commande.address, city: commande.city, postalCode: commande.postalCode,
      status: "en_livraison", lat: 46.7, lng: 5.9, products: [] }],
    createdAt: "2026-09-24T08:00:00.000Z"
  });
  require("../server").writeDb(db, { backup: false });

  const res = await fetch(base + "/api/routes/route-banc-geste/stops/stop-banc-geste", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "livre" })
  });
  const corps = await res.json();
  assert.equal(res.status, 200, JSON.stringify(corps).slice(0, 300));
  const liste = (await lire("/api/clients")).json();
  assert.ok(!("ordersByDate" in corps.client), "la reponse du geste porte le releve d'import");
  assert.deepEqual(corps.client, liste.find(c => c.id === client.id));
});

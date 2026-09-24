// Parcours simplifies (audit du 24/09, decisions de Thomas) -- la part SERVEUR,
// sur un vrai serveur ensemence (SQLite).
//
//  1. La fiche client : son chiffre d'affaires ne compte que les commandes
//     LIVREES. Avant, crmClientView additionnait toutes ses commandes, les
//     annulees comprises (un client a 100 EUR livres et 900 EUR annules
//     affichait 1 000 EUR).
//  4. Un seul compte « a preparer » : /api/operations rend les commandes
//     RESTANTES de l'ecran Preparation (importees, a verifier, en preparation).
//     Avant : a verifier + en preparation + preparation terminee, sans les
//     importees -- la tuile disait 1 quand l'ecran disait 3.
//  5. Decision 10 : « Personne sur place » et « Etablissement fermé » ne sont
//     plus PROPOSES pour « Probleme » (ils passent par « Client absent »). Le
//     serveur les ACCEPTE encore : un geste fait hors ligne avant la mise a
//     jour, rejoue ensuite par la file, ne doit pas etre refuse.
//  6. Decision 9 : un seul export Excel, depuis Commandes, avec le numero, la
//     date reelle de livraison et « remis a ».
//  7. Decision 11 : une commande prise chez le client sur un produit en rupture
//     est ACCEPTEE en « Bloquee » (comme l'import), au lieu d'etre refusee.
//  8. « +100 % » quand la periode d'avant vaut 0 : c'est « nouveau ».

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { unzipSync, strFromU8 } = require("fflate");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-parcours-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const { app, closeStorage, defaultDb, writeDb } = require("../server");
const { jourParis } = require("../lib/jour-paris");

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

async function demander(chemin, options = {}) {
  const res = await fetch(`${baseUrl}${chemin}`, options);
  const texte = await res.text();
  let body = null;
  try { body = texte ? JSON.parse(texte) : null; } catch { body = texte; }
  return { res, body };
}
const envoyer = (methode, chemin, corps = {}) => demander(chemin, {
  method: methode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps)
});

const JOUR = "2026-09-23";
const client = (id, nom) => ({ id, nom, rue: "1 rue des Lilas", codePostal: "39100", ville: "Dole", telephone: "0600000000", crmStatus: "client_actif" });
function commande(id, clientId, nom, status, extra = {}) {
  return {
    id, numero: `CMD-2026-${id.toUpperCase()}`, clientId, clientName: nom, status,
    address: "1 rue des Lilas", city: "Dole", postalCode: "39100", sector: "Dole",
    deliveryDate: JOUR, dateCommande: JOUR,
    products: [{ code: "A1", nom: "Alèses", quantite: 2, prixUnitaire: 5, totalLigne: 10 }],
    ...extra
  };
}

// --- 1. La fiche client ------------------------------------------------------

test("fiche client : le chiffre d'affaires ne compte que les commandes livrees", async () => {
  writeDb({
    ...defaultDb(),
    clients: [client("c1", "EHPAD Les Tilleuls")],
    commandes: [
      commande("l1", "c1", "EHPAD Les Tilleuls", "livre", { total: 100, deliveredAt: `${JOUR}T09:00:00Z` }),
      commande("a1", "c1", "EHPAD Les Tilleuls", "annulee", { total: 900 }),
      commande("p1", "c1", "EHPAD Les Tilleuls", "en_preparation", { total: 50 })
    ],
    stock: [{ id: "s1", code: "A1", nom: "Alèses", quantite: 50 }]
  }, { backup: false });

  const { res, body } = await demander("/api/crm/clients/c1");
  assert.equal(res.status, 200);
  assert.equal(body.totalRevenue, 100, "une commande annulee ou pas encore livree n'est pas du chiffre d'affaires");
  assert.equal(body.deliveredOrders, 1);
  // Temoin : la liste des clients rend la meme valeur (la fiche du navigateur la lit la).
  const liste = await demander("/api/crm/clients");
  assert.equal(liste.body.find(c => c.id === "c1").totalRevenue, 100);
});

// --- 4. Un seul compte « a preparer » -------------------------------------------

test("tableau de bord : « a preparer » compte les commandes restantes de l'ecran Preparation", async () => {
  writeDb({
    ...defaultDb(),
    clients: [client("c1", "Cabinet Dupont")],
    commandes: [
      commande("i1", "c1", "Cabinet Dupont", "importe"),
      commande("v1", "c1", "Cabinet Dupont", "stock_a_verifier"),
      commande("e1", "c1", "Cabinet Dupont", "en_preparation"),
      commande("r1", "c1", "Cabinet Dupont", "pret_livraison"),
      commande("d1", "c1", "Cabinet Dupont", "livre")
    ],
    stock: [{ id: "s1", code: "A1", nom: "Alèses", quantite: 50 }]
  }, { backup: false });

  const { body } = await demander("/api/operations");
  assert.deepEqual(body.preparing.map(o => o.id).sort(), ["e1", "i1", "v1"]);
});

// --- 5. Les motifs proposes ---------------------------------------------------

test("motifs : « Personne sur place » et « Etablissement ferme » ne sont plus proposes pour « Probleme »", async () => {
  const { body } = await demander("/api/delivery-problems");
  const proposes = statut => body.motifs.filter(m => (m.proposes || m.statutsAdmis).includes(statut)).map(m => m.cle);
  assert.ok(!proposes("probleme").includes("absent"), `probleme propose : ${proposes("probleme")}`);
  assert.ok(!proposes("probleme").includes("ferme"), `probleme propose : ${proposes("probleme")}`);
  // Temoins : ils restent proposes pour « Client absent », et « Probleme »
  // garde ses motifs propres.
  assert.deepEqual(proposes("absent").slice(0, 2), ["absent", "ferme"]);
  assert.ok(proposes("probleme").includes("adresse"));
});

test("motifs : un « Probleme / Personne sur place » deja en file est encore accepte", async () => {
  const o = commande("t1", "c1", "Cabinet Dupont", "en_livraison", { routeId: "r1", stockReservedAt: `${JOUR}T07:00:00Z` });
  writeDb({
    ...defaultDb(),
    clients: [client("c1", "Cabinet Dupont")],
    commandes: [o],
    routes: [{
      id: "r1", sector: "Dole", status: "en_livraison", deliveryDate: jourParis(), startedAt: new Date().toISOString(),
      selectedOrderIds: [o.id],
      stops: [{ id: "s-t1", routeId: "r1", orderId: o.id, clientId: "c1", clientName: o.clientName, address: o.address, city: o.city, status: "en_livraison", products: o.products }]
    }],
    stock: [{ id: "s1", code: "A1", nom: "Alèses", quantite: 50 }]
  }, { backup: false });
  const { res, body } = await envoyer("PATCH", "/api/routes/r1/stops/s-t1", { status: "probleme", motif: { cle: "absent", commentaire: "" } });
  assert.equal(res.status, 200, JSON.stringify(body));
});

// --- 6. Un seul export Excel ----------------------------------------------------

function lireFeuille(buffer) {
  const fichiers = unzipSync(new Uint8Array(buffer));
  const xml = strFromU8(fichiers["xl/worksheets/sheet1.xml"]);
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map(([, ligne]) =>
    [...ligne.matchAll(/<c [^>]*>(?:<is><t>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)<\/c>/g)].map(([, t, v]) => t ?? v));
}

test("export Excel des commandes : le filtre de l'ecran, avec numero, livraison reelle et « remis a »", async () => {
  writeDb({
    ...defaultDb(),
    clients: [client("c1", "EHPAD Les Tilleuls")],
    commandes: [
      commande("x1", "c1", "EHPAD Les Tilleuls", "livre", { total: 10, deliveredAt: "2026-09-22T22:30:00Z", remisA: "Mme Ferrand" }),
      commande("x2", "c1", "EHPAD Les Tilleuls", "pret_livraison", { total: 10 }),
      commande("x3", "c1", "EHPAD Les Tilleuls", "importe", { total: 10 })
    ],
    stock: [{ id: "s1", code: "A1", nom: "Alèses", quantite: 50 }]
  }, { backup: false });

  const res = await fetch(`${baseUrl}/api/exports/commandes.xlsx`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ["x1", "x2"] })
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const lignes = lireFeuille(Buffer.from(await res.arrayBuffer()));
  const [entete, ...corps] = lignes;
  for (const colonne of ["Numéro", "Date de commande", "Livrée le", "Remis à", "Secteur", "Total", "Statut"]) {
    assert.ok(entete.includes(colonne), `colonne « ${colonne} » absente : ${entete}`);
  }
  // Les commandes demandees, et elles seules, dans l'ordre de l'ecran.
  assert.deepEqual(corps.map(l => l[entete.indexOf("Numéro")]), ["CMD-2026-X1", "CMD-2026-X2"]);
  const livree = corps[0];
  // 22 h 30 UTC le 22 = 0 h 30 le 23 a Paris : le jour de Paris, pas celui d'UTC.
  assert.equal(livree[entete.indexOf("Livrée le")], "23/09/2026 00:30");
  assert.equal(livree[entete.indexOf("Remis à")], "Mme Ferrand");
  assert.equal(livree[entete.indexOf("Statut")], "Livrée");
  assert.equal(corps[1][entete.indexOf("Livrée le")], "");
});

test("export Excel : une liste vide est refusee, l'ancien export des commandes annexes n'existe plus", async () => {
  const vide = await envoyer("POST", "/api/exports/commandes.xlsx", { ids: [] });
  assert.equal(vide.res.status, 400);
  const annexes = await fetch(`${baseUrl}/api/exports/commandes-annexes.xlsx`);
  assert.equal(annexes.status, 404);
});

// --- 7. Commande prise chez le client sur un produit en rupture -----------------

test("commande client sur un produit en rupture : acceptee en « Bloquee », rien n'est reserve", async () => {
  writeDb({
    ...defaultDb(),
    clients: [client("c1", "Pharmacie Centrale")],
    stock: [{ id: "s1", code: "A1", nom: "Alèses", quantite: 2, tarif: 5 }, { id: "s2", code: "G1", nom: "Gants nitrile", quantite: null, tarif: 8 }]
  }, { backup: false });

  const { res, body } = await envoyer("POST", "/api/customer-orders", {
    clientId: "c1", client: { nom: "Pharmacie Centrale" },
    products: [{ productId: "s1", quantite: 5 }], orderType: "immediate"
  });
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.bloquee, true);
  assert.equal(body.status, "stock_a_verifier");
  assert.ok(!body.stockReservedAt, "une commande bloquee ne reserve rien");

  const commandes = (await demander("/api/orders")).body;
  const creee = commandes.find(o => o.id === body.id);
  assert.equal(creee.canPrepare, false, "elle doit se lire « Bloquee » en Preparation");
  const stock = (await demander("/api/stock")).body;
  assert.equal(stock.find(p => p.id === "s1").quantityAvailable, 2, "le rayon n'a pas bouge");

  // Un stock non renseigne bloque aussi, sans refus.
  const inconnu = await envoyer("POST", "/api/customer-orders", {
    clientId: "c1", client: { nom: "Pharmacie Centrale" }, products: [{ productId: "s2", quantite: 1 }]
  });
  assert.equal(inconnu.res.status, 201, JSON.stringify(inconnu.body));
  assert.equal(inconnu.body.bloquee, true);
});

test("commande client sur un stock suffisant : reservee comme avant (temoin)", async () => {
  writeDb({
    ...defaultDb(),
    clients: [client("c1", "Pharmacie Centrale")],
    stock: [{ id: "s1", code: "A1", nom: "Alèses", quantite: 10, tarif: 5 }]
  }, { backup: false });
  const { res, body } = await envoyer("POST", "/api/customer-orders", {
    clientId: "c1", client: { nom: "Pharmacie Centrale" }, products: [{ productId: "s1", quantite: 4 }]
  });
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.bloquee, false);
  assert.ok(body.stockReservedAt);
  const stock = (await demander("/api/stock")).body;
  assert.equal(stock.find(p => p.id === "s1").quantityAvailable, 6);
});

// --- 8. « nouveau » plutot que « +100 % » ----------------------------------------

test("analyse : une periode precedente vide donne « nouveau », jamais +100 %", async () => {
  writeDb({
    ...defaultDb(),
    clients: [client("c1", "EHPAD Les Tilleuls")],
    commandes: [commande("n1", "c1", "EHPAD Les Tilleuls", "livre", { total: 102, deliveredAt: new Date().toISOString(), dateCommande: jourParis(), deliveryDate: jourParis() })],
    stock: []
  }, { backup: false });
  const { body } = await demander("/api/statistics");
  assert.equal(body.week.revenue, 102);
  assert.deepEqual(body.week.evolution, { label: "nouveau", percent: null });
  // Temoin : deux periodes vides restent « stable ».
  writeDb({ ...defaultDb(), clients: [], commandes: [], stock: [] }, { backup: false });
  const vide = await demander("/api/statistics");
  assert.equal(vide.body.week.evolution.label, "stable");
});

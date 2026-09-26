// Le chiffre d'affaires des commandes importees ne depend plus de la table des
// ventes (chasse aux defauts du 24/09, constat « moyenne ») et suit la
// decision 7 de Thomas (24/09) : CA en TTC, avoirs soustraits, HT et TTC plus
// jamais additionnes.
//
// Mesure du rapport (b12-ca-ventes.js, production en GET) : 197 commandes sur
// 224 n'ont de montant ni sur la commande ni sur leurs lignes ; leur CA vient
// de `db.ventes`, que chaque import remplacait. Un fichier du seul mois en
// cours mettait le CA de tous les mois passes a 0, sans un mot.
//
// Ce qui doit tenir :
//   - une migration unique et IDEMPOTENTE fige, sur chaque commande dont le CA
//     vient des ventes, son montant TTC (`montantTtc`) : le CA de chaque mois
//     ne change pas, et ne depend plus des ventes ;
//   - l'import fige le montant TTC de chaque bon (avoirs deduits) ; une ligne
//     sans TTC (HT seul) n'est pas comptee -- la commande est « sans montant ».

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { importerVentes } = require("./aide-import-ventes");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-ca-fige-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const server_ = require("../server");
const { app, closeStorage, defaultDb, readDb, writeDb } = server_;
const guerir = server_._healDatabaseAtBoot;

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

async function lire(chemin) {
  const res = await fetch(`${baseUrl}${chemin}`);
  return res.json();
}
const caParMois = async () => Object.fromEntries((await lire("/api/operations")).history
  .filter(m => m.revenue !== 0 || m.missingPrices)
  .map(m => [m.month, [m.revenue, m.missingPrices]]));

const aujourdhui = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
// Deux mois passes (le 10 de M-2 et de M-1) : jamais le mois courant.
function moisPasse(n) {
  const d = new Date(`${aujourdhui().slice(0, 7)}-10T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}
const fr = iso => iso.split("-").reverse().join("/");

const CLIENTS = [
  { id: "c-a", nom: "Pharmacie A", rue: "1 rue A", codePostal: "25000", ville: "Besancon" },
  { id: "c-b", nom: "EHPAD B", rue: "2 rue B", codePostal: "39100", ville: "Dole" },
  { id: "c-c", nom: "Cabinet C", rue: "3 rue C", codePostal: "39300", ville: "Champagnole" }
];

/** Une base comme la production : commandes livrees importees SANS montant, leur CA dans les ventes. */
function semerCommeLaProduction() {
  const m2 = moisPasse(2);
  const m1 = moisPasse(1);
  const db = defaultDb();
  db.clients = CLIENTS.map(c => ({ ...c }));
  db.stock = [{ id: "p1", code: "CH-L", nom: "Changes taille L", quantite: 50 }, { id: "p2", code: "ALE", nom: "Aleses", quantite: 50 }];
  const commande = (id, client, date, products, extra = {}) => ({
    id, numero: `CMD-2026-${id.slice(-3)}`, clientId: client.id, clientName: client.nom, dateCommande: date,
    excelRowHash: `${id}-empreinte`.padEnd(16, "0").slice(0, 16), status: "livre", importedAsLivre: true,
    address: client.rue, city: client.ville, postalCode: client.codePostal, products, ...extra
  });
  db.commandes = [
    commande("cmd-001", CLIENTS[0], m2, [{ code: "CH-L", nom: "Changes taille L", quantite: 2 }]),
    commande("cmd-002", CLIENTS[1], m1, [{ code: "ALE", nom: "Aleses", quantite: 3 }, { code: "CH-L", nom: "Changes taille L", quantite: 1 }]),
    // Son montant est sur ses lignes : la migration n'y touche pas.
    commande("cmd-003", CLIENTS[2], m1, [{ code: "CH-L", nom: "Changes taille L", quantite: 1, prixUnitaire: 30, totalLigne: 30 }]),
    // Aucune vente ne la couvre : rien a figer (elle reste « sans montant »).
    commande("cmd-004", CLIENTS[2], m2, [{ code: "ALE", nom: "Aleses", quantite: 1 }])
  ];
  const vente = (client, date, code, produit, quantite, ttc, ht = 0) => ({
    id: `v-${client.id}-${date}-${code}`, client: client.nom, rue: client.rue, codePostal: client.codePostal, ville: client.ville,
    codeProduit: code, produit, quantite, ttc, ht, prixUnitaire: 0, date: fr(date), dateCommandeIso: date, statutFacture: "Envoyée"
  });
  db.ventes = [
    vente(CLIENTS[0], m2, "CH-L", "Changes taille L", 2, 24, 20),
    vente(CLIENTS[1], m1, "ALE", "Aleses", 3, 15, 12.5),
    vente(CLIENTS[1], m1, "CH-L", "Changes taille L", 1, 12, 10)
  ];
  writeDb(db, { backup: false });
  return { m1, m2 };
}

test("migration : le montant TTC est fige sur chaque commande dont le CA venait des ventes ; le CA de chaque mois ne change pas", async () => {
  const { m1, m2 } = semerCommeLaProduction();
  const avant = await caParMois();
  assert.deepEqual(avant, { [m2.slice(0, 7)]: [24, 1], [m1.slice(0, 7)]: [57, 0] }, "le jeu de depart n'est pas celui attendu");

  guerir();
  const db = readDb();
  const montant = id => db.commandes.find(o => o.id === id).montantTtc;
  assert.equal(montant("cmd-001"), 24);
  assert.equal(montant("cmd-002"), 27);
  assert.equal(montant("cmd-003"), undefined, "une commande qui porte son montant n'a pas a etre figee");
  assert.equal(montant("cmd-004"), undefined, "une commande sans vente n'a rien a figer");
  assert.deepEqual(await caParMois(), avant, "la migration a change le CA d'un mois");
});

test("migration IDEMPOTENTE : la rejouer ne change rien", async () => {
  semerCommeLaProduction();
  guerir();
  const une = readDb().commandes.map(o => [o.id, o.montantTtc, o.total, o.products.map(p => [p.code, p.quantite, p.totalLigne])]);
  const ca = await caParMois();
  guerir();
  guerir();
  assert.deepEqual(readDb().commandes.map(o => [o.id, o.montantTtc, o.total, o.products.map(p => [p.code, p.quantite, p.totalLigne])]), une);
  assert.deepEqual(await caParMois(), ca);
  const migrations = readDb().historique.filter(h => /montant TTC fige/i.test(h.message || ""));
  assert.equal(migrations.length, 1, "la migration s'est journalisee a chaque demarrage (ou jamais)");
});

test("apres la migration, le CA ne depend plus des ventes : des ventes perdues ne mettent plus les mois passes a 0", async () => {
  const { m1, m2 } = semerCommeLaProduction();
  guerir();
  const avant = await caParMois();
  const db = readDb();
  db.ventes = [];
  writeDb(db, { backup: false });
  assert.deepEqual(await caParMois(), avant, `le CA de ${m2.slice(0, 7)} ou ${m1.slice(0, 7)} est retombe`);
});

test("import PARTIEL (le seul mois courant) apres migration : le CA des mois passes ne bouge pas", async () => {
  semerCommeLaProduction();
  guerir();
  const avant = await caParMois();
  const jour = aujourdhui();
  const r = await importerVentes(baseUrl, [
    ["Date", "Statut", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville", "HT", "TTC"],
    [fr(jour), "Envoyée", CLIENTS[0].nom, "ALE", "Aleses", "2", CLIENTS[0].rue, CLIENTS[0].codePostal, CLIENTS[0].ville, "8,33", "10"]
  ]);
  assert.equal(r.status, 200, r.body?.error);
  const apres = await caParMois();
  assert.deepEqual(apres[jour.slice(0, 7)], [10, 0], "le bon du mois courant n'est pas compte en TTC");
  delete apres[jour.slice(0, 7)];
  assert.deepEqual(apres, avant, "un import partiel a change le CA des mois passes");
});

// --- Decision 7 : TTC, avoirs soustraits, HT jamais additionne ---------------------

const ENTETE_TTC = ["Date", "Statut", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville", "HT", "TTC"];
const ligne = (client, date, code, produit, qte, ht, ttc) => [fr(date), "Envoyée", client.nom, code, produit, qte, client.rue, client.codePostal, client.ville, ht, ttc];

function semerVide() {
  const db = defaultDb();
  db.clients = CLIENTS.map(c => ({ ...c }));
  db.stock = [{ id: "p1", code: "CH-L", nom: "Changes taille L", quantite: 50 }, { id: "p2", code: "ALE", nom: "Aleses", quantite: 50 }];
  writeDb(db, { backup: false });
}

test("decision 7 : un AVOIR du meme bon est soustrait du CA (4 a 48 EUR, avoir de 1 a -12 EUR : 36 EUR)", async () => {
  semerVide();
  const jour = aujourdhui();
  const r = await importerVentes(baseUrl, [ENTETE_TTC,
    ligne(CLIENTS[0], jour, "CH-L", "Changes taille L", "4", "40", "48"),
    ligne(CLIENTS[0], jour, "CH-L", "Changes taille L", "-1", "-10", "-12")]);
  assert.equal(r.status, 200, r.body?.error);
  const commande = readDb().commandes[0];
  assert.equal(commande.montantTtc, 36, "l'avoir n'est pas soustrait du montant de la commande");
  assert.deepEqual((await caParMois())[jour.slice(0, 7)], [36, 0]);
  const stats = await lire("/api/statistics");
  assert.equal(stats.month.revenue, 36);
});

test("decision 7 : une ligne HT SEULE n'est jamais additionnee au TTC -- la commande est comptee « sans montant »", async () => {
  semerVide();
  const jour = aujourdhui();
  const r = await importerVentes(baseUrl, [ENTETE_TTC,
    ligne(CLIENTS[0], jour, "CH-L", "Changes taille L", "1", "100", "120"),
    ligne(CLIENTS[1], jour, "CH-L", "Changes taille L", "1", "100", "")]);
  assert.equal(r.status, 200, r.body?.error);
  // Avant : 120 + 100 = 220, deux bases melangees.
  assert.deepEqual((await caParMois())[jour.slice(0, 7)], [120, 1], "le HT a ete additionne au TTC (ou la commande HT n'est pas signalee)");
  const stats = await lire("/api/statistics");
  assert.equal(stats.month.revenue, 120);
  const fiche = (await lire("/api/crm/clients")).find(c => c.id === "c-b");
  assert.equal(fiche.totalRevenue, 0, "la fiche compte un montant HT dans son CA");
});

test("decision 7 : un bon reimporte IDENTIQUE avec un avoir de plus reprend son montant TTC ; le resume le dit", async () => {
  semerVide();
  const jour = aujourdhui();
  const premier = await importerVentes(baseUrl, [ENTETE_TTC, ligne(CLIENTS[0], jour, "CH-L", "Changes taille L", "4", "40", "48")]);
  assert.equal(premier.status, 200, premier.body?.error);
  assert.equal(readDb().commandes[0].montantTtc, 48);
  // Le meme bon, un avoir de -1 en plus : les quantites de la commande ne
  // changent pas (l'avoir est ramene a 0), le chemin « identique » le prend.
  const second = await importerVentes(baseUrl, [ENTETE_TTC,
    ligne(CLIENTS[0], jour, "CH-L", "Changes taille L", "4", "40", "48"),
    ligne(CLIENTS[0], jour, "CH-L", "Changes taille L", "-1", "-10", "-12")]);
  assert.equal(second.status, 200, second.body?.error);
  assert.equal(second.body.skippedIdentical, 1);
  assert.equal(readDb().commandes[0].montantTtc, 36, "l'avoir d'un bon deja importe n'est pas soustrait");
  assert.equal(second.body.montantsRepris, 1);
});

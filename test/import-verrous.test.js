// Reimporter un bon (meme client, meme date) ne remplace plus les lignes d'une
// commande qui n'est pas un bon importe a preparer (chasse aux defauts du
// 24/09, constat « haute » ; complement du lot « pieges » de la v1.46.0).
//
// Le lot pieges verrouillait deja : livree, en tournee, prete, partie en
// tournee, et tout stock reserve. Restaient reecrites (mesure du rapport,
// b11-divers.js, et l'ecart nomme du lot pieges) :
//   - une commande SAISIE AU TERRAIN sans reservation (decision 11 : acceptee
//     « bloquee » faute de stock, rien de reserve) -- elle devenait un autre
//     produit, son total gardait l'ancien montant ;
//   - une commande PLANIFIEE (ou generee par un abonnement), pas encore
//     confirmee ;
//   - une commande EN PREPARATION sans reservation (PATCH de statut) ;
//   - une commande ANNULEE.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { importerVentes } = require("./aide-import-ventes");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-import-verrous-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
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

const JOUR = "2026-09-24";
const ENTETE = ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"];
const TILLEULS = { id: "c-t", nom: "EHPAD Les Tilleuls", rue: "12 avenue du General de Gaulle", codePostal: "25000", ville: "Besancon" };
const LIGNE_2_ALESES = ["24/09/2026", TILLEULS.nom, "ALE", "Aleses", "2", TILLEULS.rue, TILLEULS.codePostal, TILLEULS.ville];
const PRODUITS_AVANT = [{ code: "CH-L", nom: "Changes taille L", quantite: 8, prixUnitaire: 2, totalLigne: 16 }];

function semer(commande) {
  const db = defaultDb();
  db.clients = [{ ...TILLEULS }];
  db.stock = [
    { id: "p-ch", code: "CH-L", nom: "Changes taille L", quantite: 20, tarif: 2 },
    { id: "p-ale", code: "ALE", nom: "Aleses", quantite: 20, tarif: 5 }
  ];
  db.commandes = [{
    id: "o-t", numero: "CMD-2026-007", clientId: "c-t", clientName: TILLEULS.nom,
    address: TILLEULS.rue, city: TILLEULS.ville, postalCode: TILLEULS.codePostal, sector: "Besancon",
    dateCommande: JOUR, deliveryDate: JOUR, products: PRODUITS_AVANT.map(p => ({ ...p })),
    ...commande
  }];
  writeDb(db, { backup: false });
}

const lignes = order => (order.products || []).map(p => [p.code, Number(p.quantite)]);
const commandeLue = () => readDb().commandes.find(o => o.id === "o-t");

const CAS = [
  ["commande SAISIE AU TERRAIN, bloquee sans reservation (decision 11)",
    { status: "stock_a_verifier", source: "commande_terrain", total: 16, stockReservedAt: null }, "saisie_terrain"],
  ["commande PLANIFIEE, pas encore confirmee",
    { status: "planifiee", source: "commande_planifiee", orderType: "planifiee", total: 16 }, "planifiee"],
  ["commande d'un ABONNEMENT, a confirmer",
    { status: "a_confirmer", source: "commande_planifiee", orderType: "planifiee", subscriptionId: "sub-1", subscriptionDate: JOUR, total: 16 }, "planifiee"],
  ["commande EN PREPARATION sans reservation (PATCH de statut)",
    { status: "en_preparation", stockReservedAt: null }, "en_preparation"],
  ["commande ANNULEE",
    { status: "annulee" }, "annulee"]
];

for (const [titre, commande, raison] of CAS) {
  test(`reimport — ${titre} : ses lignes ne sont pas remplacees, le resume dit pourquoi`, async () => {
    semer(commande);
    const avant = commandeLue();
    const r = await importerVentes(baseUrl, [ENTETE, LIGNE_2_ALESES]);
    assert.equal(r.status, 200, r.body?.error);
    const apres = commandeLue();
    assert.deepEqual(lignes(apres), [["CH-L", 8]], `${titre} : lignes remplacees par l'import`);
    assert.equal(apres.status, avant.status);
    assert.equal(readDb().commandes.length, 1, "l'import a cree une commande en double");
    assert.equal(r.body.updated, 0);
    assert.deepEqual((r.body.ignorees || []).map(i => [i.id, i.raison]), [["o-t", raison]]);
  });
}

test("reimport — temoin : un bon IMPORTE encore a preparer, sans reservation, est toujours mis a jour", async () => {
  // Sans ce temoin, un verrou pose sur toutes les commandes rendrait les cas precedents verts.
  semer({ status: "stock_a_verifier", excelRowHash: "0123456789abcdef", dateImport: "2026-09-24T06:00:00.000Z" });
  const r = await importerVentes(baseUrl, [ENTETE, LIGNE_2_ALESES]);
  assert.equal(r.status, 200, r.body?.error);
  assert.equal(r.body.updated, 1);
  assert.deepEqual(r.body.ignorees, []);
  assert.deepEqual(lignes(commandeLue()), [["ALE", 2]]);
});

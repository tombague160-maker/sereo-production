// « A recommander » qui voit venir (decisions de Thomas du 24/09, 2 et 3).
//
// Le serveur donne a chaque produit du stock la demande CONNUE D'AVANCE sur
// l'horizon de Parametres (14 jours par defaut, 7 a 30) : les commandes
// planifiees et les echeances des abonnements ACTIFS pas encore generees --
// celles du calendrier de l'ecran Abonnements (lib/subscriptions.js). L'ecran
// en tire la quantite a recommander et le jour du manque (banc e2e
// a-recommander.spec.js).
//
// L'exemple mesure par l'audit du 24/09 : Changes L, 14 en stock, seuil 5,
// 12 sur commandes en cours, et cinq abonnements actifs qui en demandent 24
// sous 14 jours (60 sous 30). L'ecran disait « OK · 0 a recommander ».

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-a-venir-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const { app, closeStorage, readDb, writeDb, _flushPendingBackup } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await _flushPendingBackup();
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Le jour a Paris, et l'arithmetique des jours : l'oracle du banc, ecrit ici.
const AUJOURDHUI = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function jour(decalage) {
  const d = new Date(`${AUJOURDHUI}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + decalage);
  return d.toISOString().slice(0, 10);
}

const CLIENTS = ["c-1", "c-2", "c-3", "c-4", "c-5", "c-6"].map((id, i) => ({ id, nom: `Client ${i + 1}`, ville: "Dole" }));
const CH_L = { code: "CH-L", nom: "Changes taille L" };

function commande(id, status, quantite, extra = {}) {
  return {
    id, clientId: "c-6", clientName: "Client 6", status, address: "1 rue", city: "Dole", postalCode: "39100",
    deliveryDate: AUJOURDHUI, dateCommande: AUJOURDHUI,
    products: [{ ...CH_L, quantite, prixUnitaire: 12 }], ...extra
  };
}

function abonnement(id, clientId, status, startDate, quantite, interval = 14, produit = CH_L) {
  return {
    id, clientId, status, startDate, frequency: { unit: "days", interval }, reminderDays: 3, notes: "",
    products: [{ stockId: `st-${produit.code}`, ...produit, quantite, prixUnitaire: 12, totalLigne: 12 * quantite }]
  };
}

// La base de l'audit : 14 en stock, 12 sur commandes en cours, cinq abonnements
// actifs (le premier commence aujourd'hui, les autres demain, tous les 14
// jours, 4 chacun) ; plus un abonnement EN PAUSE et un ARRETE sur le meme
// produit, qui ne doivent rien compter.
function semer({ commandes = [], abonnements = [], horizon } = {}) {
  const db = readDb();
  db.clients = CLIENTS.map(c => ({ ...c }));
  db.stock = [
    { id: "st-CH-L", ...CH_L, quantite: 14, stockMinimum: 5 },
    { id: "st-GEL", code: "GEL", nom: "Gel hydroalcoolique", quantite: 20, stockMinimum: 5 }
  ];
  db.commandes = [
    commande("o-1", "importe", 3),
    commande("o-2", "stock_a_verifier", 3),
    commande("o-3", "en_preparation", 3),
    commande("o-4", "commande_client_validee", 3),
    ...commandes
  ];
  db.subscriptions = [
    abonnement("sub-0", "c-1", "active", jour(0), 4),
    abonnement("sub-1", "c-2", "active", jour(1), 4),
    abonnement("sub-2", "c-3", "active", jour(1), 4),
    abonnement("sub-3", "c-4", "active", jour(1), 4),
    abonnement("sub-4", "c-5", "active", jour(1), 4),
    abonnement("sub-pause", "c-6", "paused", jour(1), 10, 7),
    abonnement("sub-arret", "c-6", "cancelled", jour(1), 10, 7),
    ...abonnements
  ];
  db.settings = { ...(db.settings || {}), stock: horizon ? { horizonJours: horizon } : undefined };
  writeDb(db, { backup: false });
}

async function produit(code) {
  const reponse = await fetch(`${baseUrl}/api/stock`);
  assert.equal(reponse.status, 200);
  const trouve = (await reponse.json()).find(p => p.code === code);
  assert.ok(trouve, `produit ${code} absent de /api/stock`);
  return trouve;
}

function patchHorizon(horizonJours) {
  return fetch(`${baseUrl}/api/settings/stock`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ horizonJours })
  });
}

test("l'exemple de l'audit : Changes L, 24 demandés sous 14 jours par les abonnements actifs", async () => {
  semer();
  const chl = await produit("CH-L");
  assert.equal(chl.quantityAvailable, 14);
  assert.equal(chl.quantityNeeded, 12);
  // Semees sans stockReservedAt (comme un import) : aucune n'a encore sorti
  // son stock du rayon, les 12 restent a prendre sur les 14.
  assert.equal(chl.quantityNeededNotDeducted, 12);
  // L'abonnement en pause (10 par semaine) et l'arrete ne comptent pas : 24, pas 54 ni 84.
  assert.equal(chl.quantityUpcoming, 24);
  assert.equal(chl.upcomingHorizonDays, 14);
  // Par jour : sub-0 aujourd'hui et dans 14 jours, les quatre autres demain
  // (leur echeance suivante, dans 15 jours, est hors de l'horizon).
  assert.deepEqual(chl.upcomingDemand, [
    { date: jour(0), quantite: 4 },
    { date: jour(1), quantite: 16 },
    { date: jour(14), quantite: 4 }
  ]);
});

test("l'horizon se règle de 7 à 30 jours, et il est respecté", async () => {
  semer();
  assert.equal((await produit("CH-L")).upcomingHorizonDays, 14, "defaut : 14 jours");

  const trente = await patchHorizon(30);
  assert.equal(trente.status, 200);
  assert.equal((await trente.json()).horizonJours, 30);
  // 60 sous 30 jours (mesure de l'audit) : sub-0 a 0, 14, 28 ; les autres a 1, 15, 29.
  assert.equal((await produit("CH-L")).quantityUpcoming, 60);

  assert.equal((await patchHorizon(7)).status, 200);
  const sept = await produit("CH-L");
  assert.equal(sept.quantityUpcoming, 20);
  assert.equal(sept.upcomingHorizonDays, 7);

  for (const faux of [6, 31, "14", 14.5, null]) {
    const refus = await patchHorizon(faux);
    assert.equal(refus.status, 400, `horizon ${JSON.stringify(faux)} aurait du etre refuse`);
  }
  assert.equal((await produit("CH-L")).upcomingHorizonDays, 7, "un refus a change l'horizon");
  const lu = await fetch(`${baseUrl}/api/settings/stock`);
  assert.deepEqual(await lu.json(), { horizonJours: 7 });
  assert.equal((await patchHorizon(14)).status, 200);
});

test("un abonnement en pause ne compte pas, même seul sur son produit", async () => {
  // Gel : 20 en stock, seul un abonnement EN PAUSE en demande (10 par semaine).
  semer({ abonnements: [abonnement("sub-gel", "c-6", "paused", jour(1), 10, 7, { code: "GEL", nom: "Gel hydroalcoolique" })] });
  const gel = await produit("GEL");
  assert.equal(gel.quantityUpcoming, 0);
  assert.deepEqual(gel.upcomingDemand, []);
  // Temoin : le meme abonnement actif compte (jours 1 et 8 ; le 15 est hors horizon).
  semer({ abonnements: [abonnement("sub-gel", "c-6", "active", jour(1), 10, 7, { code: "GEL", nom: "Gel hydroalcoolique" })] });
  assert.equal((await produit("GEL")).quantityUpcoming, 20);
});

test("les commandes planifiées comptent dans l'horizon, et une échéance générée une seule fois", async () => {
  semer({
    commandes: [
      commande("o-plan", "planifiee", 5, { deliveryDate: jour(10) }),
      // En retard : elle attend encore, elle compte aujourd'hui.
      commande("o-conf", "a_confirmer", 2, { deliveryDate: jour(-3) }),
      // Hors de l'horizon.
      commande("o-loin", "planifiee", 7, { deliveryDate: jour(20) }),
      // L'echeance de sub-0 dans 14 jours, deja generee : comptee par SA
      // commande (6, modifiee), plus par l'abonnement (4).
      commande("o-gen", "planifiee", 6, { deliveryDate: jour(14), subscriptionId: "sub-0", subscriptionDate: jour(14) }),
      // Une commande livree ou annulee n'attend plus rien.
      commande("o-livre", "livre", 9, { deliveryDate: jour(2) }),
      commande("o-annule", "annulee", 9, { deliveryDate: jour(2) })
    ]
  });
  const chl = await produit("CH-L");
  assert.deepEqual(chl.upcomingDemand, [
    { date: jour(0), quantite: 4 + 2 },
    { date: jour(1), quantite: 16 },
    { date: jour(10), quantite: 5 },
    { date: jour(14), quantite: 6 }
  ]);
  assert.equal(chl.quantityUpcoming, 33);
});

test("une échéance passée sans commande n'est pas « à venir »", async () => {
  // Commence il y a 20 jours, tous les 14 jours : echeances a -20, -6 (en
  // retard, montrees par l'ecran Abonnements) et +8 (a venir).
  semer({ abonnements: [abonnement("sub-ancien", "c-6", "active", jour(-20), 3, 14, { code: "GEL", nom: "Gel hydroalcoolique" })] });
  assert.deepEqual((await produit("GEL")).upcomingDemand, [{ date: jour(8), quantite: 3 }]);
});

// Relecture adverse du 24/09 : une commande dont le stock est RESERVE
// (confirmee, saisie chez le client, mise en preparation) a deja sorti ses
// quantites du rayon -- quantityAvailable ne les contient plus. L'ecran les
// comptait encore dans le besoin : 30 en stock, 20 confirmes, et « Manque des
// aujourd'hui : 20 demandes, 10 en stock ». quantityNeededNotDeducted ne garde
// que ce qui reste a prendre sur le stock ; quantityNeeded (« Necessaire » de
// la carte produit) ne change pas de sens. Chaque reservation passe par sa
// vraie route : les etats sont ceux que l'application produit.
const GEL = { code: "GEL", nom: "Gel hydroalcoolique" };

async function envoyer(chemin, corps) {
  const reponse = await fetch(`${baseUrl}${chemin}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corps || {})
  });
  const lu = await reponse.json();
  assert.ok(reponse.status < 300, `${chemin} : ${reponse.status} ${JSON.stringify(lu)}`);
  return lu;
}

test("une commande dont le stock est réservé ne compte plus dans le besoin", async () => {
  // Temoin positif : une commande importee, sans reservation, compte.
  semer({ commandes: [commande("o-gel", "importe", 2, { products: [{ ...GEL, quantite: 2, prixUnitaire: 4 }] })] });
  let gel = await produit("GEL");
  assert.equal(gel.quantityAvailable, 20);
  assert.equal(gel.quantityNeededNotDeducted, 2);

  // Une commande planifiee a J+5 : a venir, rien de reserve.
  const planifiee = await envoyer("/api/planned-orders", { clientId: "c-1", deliveryDate: jour(5), products: [{ stockId: "st-GEL", quantite: 12 }] });
  gel = await produit("GEL");
  assert.equal(gel.quantityUpcoming, 12);
  assert.equal(gel.quantityNeededNotDeducted, 2);

  // Confirmee : ses 12 sortent du rayon (20 -> 8). Elles ne sont plus a prendre.
  await envoyer(`/api/planned-orders/${planifiee.order.id}/confirm`);
  gel = await produit("GEL");
  assert.equal(gel.quantityAvailable, 8);
  assert.equal(gel.quantityUpcoming, 0);
  assert.equal(gel.quantityNeeded, 14, "« Necessaire » garde son sens : toutes les commandes en cours");
  assert.equal(gel.quantityNeededNotDeducted, 2, "la commande confirmee, deja deduite, est comptee deux fois");

  // Saisie chez le client : reservee des la creation (8 -> 5).
  await envoyer("/api/customer-orders", { clientId: "c-2", products: [{ stockId: "st-GEL", quantite: 3 }] });
  gel = await produit("GEL");
  assert.equal(gel.quantityAvailable, 5);
  assert.equal(gel.quantityNeeded, 17);
  assert.equal(gel.quantityNeededNotDeducted, 2, "la commande saisie chez le client, deja deduite, est comptee deux fois");

  // L'importee mise en preparation : reservee a son tour (5 -> 3), plus rien a prendre.
  await envoyer("/api/orders/o-gel/start-preparation");
  gel = await produit("GEL");
  assert.equal(gel.quantityAvailable, 3);
  assert.equal(gel.quantityNeeded, 17);
  assert.equal(gel.quantityNeededNotDeducted, 0, "la commande en preparation, deja deduite, est comptee deux fois");
});

test("une ligne gardée non déduite (livraison sur un stock non suivi) reste à prendre", async () => {
  // reprendreStockLibere marque stockNonDeduit les lignes qu'il n'a pas pu
  // sortir du rayon ; la commande porte pourtant une reservation. Revenue
  // « prete » (tournee defaite), sa ligne GEL n'a jamais ete deduite.
  semer({
    commandes: [commande("o-nd", "pret_livraison", 1, {
      stockReservedAt: `${AUJOURDHUI}T08:00:00.000Z`,
      stockNonDeduit: ["code:gel"],
      products: [{ ...CH_L, quantite: 1, prixUnitaire: 12 }, { ...GEL, quantite: 4, prixUnitaire: 4 }]
    })]
  });
  assert.equal((await produit("GEL")).quantityNeededNotDeducted, 4);
  // CH-L, deduite : seules les quatre commandes semees non reservees (12).
  assert.equal((await produit("CH-L")).quantityNeededNotDeducted, 12);
});

// Le jour calendaire est celui de PARIS, quel que soit le fuseau du processus
// (24/09).
//
// Le defaut, mesure en CI le 23/09 a 22:10 UTC (00:10 a Paris le 24) :
// ecrans-sans-planche.spec.js:142 rouge 3 fois sur 3, « barres avec vente :
// Expected > 0, Received 0 ». En production le conteneur n'a pas de TZ : il
// tourne en UTC. computeStatistics prenait « aujourd'hui » par getDate() et le
// jour d'une vente par la troncature de deliveredAt (ISO en UTC) : entre minuit
// et 2 h a Paris, le serveur vivait la veille. Meme classe ailleurs : la date
// par defaut d'une commande, d'un rappel, d'un premier contact, « aujourd'hui »
// du tableau de bord, la prochaine date d'un secteur, l'annee de repli.
//
// Ce banc se met dans la situation de PRODUCTION : le processus passe en UTC
// avant tout calcul (TZ=UTC ; Node le prend en cours de route, y compris sous
// Windows), et un TEMOIN le verifie -- sans lui, un poste a Paris ferait passer
// l'ancien code. L'instant est INJECTE (mock.timers sur Date) : le banc ne
// depend pas de l'heure a laquelle on le lance.
//
// Contre-temoin (24/09) : sur le code d'avant (server.js de d80eadf), les cas
// serveur rougissent de la bonne cause (Expected la cle de Paris, Received la
// cle UTC) ; le temoin rougit si l'on retire la ligne TZ.

process.env.TZ = "UTC";

const { after, afterEach, before, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-jour-paris-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const jour = require("../lib/jour-paris");
const { app, closeStorage, defaultDb, writeDb, extractYear, nextSectorDeliveryDate } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => mock.timers.reset());

after(async () => {
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Les instants du banc. Ete : Paris = UTC + 2. Hiver : Paris = UTC + 1 (le
// dimanche 1er novembre 2026 est deja a l'heure d'hiver, depuis le 25/10).
const ETE_NUIT = Date.UTC(2026, 8, 23, 23, 30); // 24/09 01:30 a Paris
const HIVER_NUIT = Date.UTC(2026, 10, 1, 23, 30); // lundi 02/11 00:30 a Paris
const REVEILLON = Date.UTC(2026, 11, 31, 23, 30); // 01/01/2027 00:30 a Paris

/** Fige l'horloge du processus a `ms` (Date seulement : les minuteurs vivent). */
function horloge(ms) {
  mock.timers.enable({ apis: ["Date"], now: ms });
}

async function demander(chemin, options = {}) {
  const res = await fetch(`${baseUrl}${chemin}`, options);
  const texte = await res.text();
  let body = null;
  try { body = texte ? JSON.parse(texte) : null; } catch { body = texte; }
  return { res, body };
}

const poster = (chemin, corps) => demander(chemin, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps)
});

/** Une vente livree a l'instant `deliveredAt` (ISO en UTC), prevue le `deliveryDate`. */
function vente(id, deliveredAt, total, deliveryDate = deliveredAt.slice(0, 10)) {
  return {
    id, numero: `CMD-2026-${id.toUpperCase()}`, clientId: `c-${id}`, clientName: `Client ${id}`, status: "livre",
    address: "1 rue des Lilas", city: "Dole", postalCode: "39100", sector: "Dole",
    deliveryDate, dateCommande: deliveryDate, deliveredAt, total,
    products: [{ code: "A1", nom: "Aleses", quantite: 1, prixUnitaire: total }]
  };
}

function ensemencer({ commandes = [], clients = [] } = {}) {
  writeDb({
    ...defaultDb(),
    clients: [
      ...commandes.map(o => ({ id: o.clientId, nom: o.clientName, ville: "Dole", statut: "livree" })),
      ...clients
    ],
    commandes,
    stock: [{ id: "p1", code: "A1", nom: "Aleses", quantite: 50, tarif: 5 }]
  }, { backup: false });
}

// --- 0. Le temoin : le processus est bien en UTC -----------------------------

test("temoin : le banc tourne en UTC, comme le conteneur de production", () => {
  // Sans ce temoin, un poste a Paris verrait l'ancien code passer : le rouge
  // du defaut n'existe QUE dans un processus en UTC.
  assert.equal(new Date(ETE_NUIT).getTimezoneOffset(), 0, "decalage d'ete");
  assert.equal(new Date(HIVER_NUIT).getTimezoneOffset(), 0, "decalage d'hiver");
  assert.equal(new Date(ETE_NUIT).getDate(), 23, "getDate() d'un processus en UTC rend la veille de Paris");
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC");
});

// --- 1. Le module : jourParis et l'arithmetique des cles ---------------------

test("jourParis : l'instant est lu a Paris, ete comme hiver, et le reveillon change d'annee", () => {
  // Ete (+2) : 22:00 UTC est deja minuit a Paris.
  assert.equal(jour.jourParis(new Date(Date.UTC(2026, 8, 23, 21, 59))), "2026-09-23");
  assert.equal(jour.jourParis(new Date(Date.UTC(2026, 8, 23, 22, 0))), "2026-09-24");
  assert.equal(jour.jourParis(new Date(ETE_NUIT)), "2026-09-24");
  // Hiver (+1) : 22:30 UTC est encore la veille -- un correctif « + 2 h » en dur
  // se trahirait ici.
  assert.equal(jour.jourParis(new Date(Date.UTC(2026, 10, 1, 22, 30))), "2026-11-01");
  assert.equal(jour.jourParis(new Date(Date.UTC(2026, 10, 1, 23, 0))), "2026-11-02");
  assert.equal(jour.jourParis(new Date(REVEILLON)), "2027-01-01");
  // Les formes d'entree : texte ISO, nombre, invalide.
  assert.equal(jour.jourParis("2026-09-23T23:30:00.000Z"), "2026-09-24");
  assert.equal(jour.jourParis(ETE_NUIT), "2026-09-24");
  assert.equal(jour.jourParis("pas une date"), "");
  assert.equal(jour.jourParis(null), "", "null n'est pas le 01/01/1970");
});

test("jourDeLInstant : un horodatage a fuseau est un instant ; une date sans heure ne se decale pas", () => {
  assert.equal(jour.jourDeLInstant("2026-09-23T23:30:00.000Z"), "2026-09-24");
  assert.equal(jour.jourDeLInstant("2026-09-23T23:30:00+00:00"), "2026-09-24");
  assert.equal(jour.jourDeLInstant(new Date(ETE_NUIT)), "2026-09-24");
  // Pas un instant : l'appelant garde sa lecture (normalizeDateInput).
  assert.equal(jour.jourDeLInstant("2026-09-23"), "");
  assert.equal(jour.jourDeLInstant("2026-09-23T23:30"), "", "sans fuseau : l'heure du mur, pas un instant");
  assert.equal(jour.jourDeLInstant("23/09/2026"), "");
  assert.equal(jour.jourDeLInstant(""), "");
  assert.equal(jour.jourDeLInstant(undefined), "");
});

test("les cles s'additionnent en UTC pur : fin de mois, d'annee, changement d'heure", () => {
  assert.equal(jour.ajouterJours("2026-09-30", 1), "2026-10-01");
  assert.equal(jour.ajouterJours("2026-12-31", 1), "2027-01-01");
  assert.equal(jour.ajouterJours("2027-01-01", -1), "2026-12-31");
  assert.equal(jour.ajouterJours("2026-10-24", 2), "2026-10-26", "par-dessus le passage a l'heure d'hiver");
  assert.equal(jour.ajouterJours("2026-03-28", 2), "2026-03-30", "par-dessus le passage a l'heure d'ete");
  assert.equal(jour.debutSemaine("2026-09-24"), "2026-09-21", "jeudi -> lundi");
  assert.equal(jour.debutSemaine("2026-11-01"), "2026-10-26", "dimanche -> le lundi d'AVANT");
  assert.equal(jour.debutSemaine("2026-11-02"), "2026-11-02", "lundi -> lui-meme");
  assert.equal(jour.debutSemaine("2027-01-01"), "2026-12-28", "par-dessus l'annee");
  assert.equal(jour.debutMois("2026-09-24"), "2026-09-01");
  assert.equal(jour.moisSuivant("2026-12-15"), "2027-01-01");
  assert.equal(jour.moisPrecedent("2027-01-01"), "2026-12-01");
  assert.equal(jour.moisPrecedent("2026-03-31"), "2026-02-01");
  assert.equal(jour.estCleJour("2026-02-29"), false);
  assert.equal(jour.estCleJour("2028-02-29"), true);
});

// --- 2. L'Analyse : computeStatistics, par GET /api/statistics ---------------

test("Analyse, ete : a 01:30 a Paris, aujourd'hui est le 24 et la livraison de la nuit y compte", async () => {
  ensemencer({ commandes: [
    vente("veille", "2026-09-23T21:30:00.000Z", 100), // 23:30 a Paris le 23
    vente("nuit", "2026-09-23T23:15:00.000Z", 10, "2026-09-23") // 01:15 a Paris le 24, tournee du 23
  ] });
  horloge(ETE_NUIT);
  const { res, body } = await demander("/api/statistics");
  assert.equal(res.status, 200);
  const dernier = body.salesByDay.at(-1);
  assert.equal(dernier.date, "2026-09-24", "la derniere barre est aujourd'hui A PARIS");
  assert.equal(body.salesByDay.length, 14);
  assert.equal(body.salesByDay[0].date, "2026-09-11");
  assert.deepEqual({ orders: dernier.orders, total: dernier.total }, { orders: 1, total: 10 }, "la livraison de 01:15 est du 24");
  assert.deepEqual({ orders: body.salesByDay.at(-2).orders, total: body.salesByDay.at(-2).total }, { orders: 1, total: 100 }, "celle de 23:30 reste du 23");
  assert.deepEqual(body.today, { revenue: 10, orders: 1 });
});

test("Analyse, hiver : +1 h seulement, et la semaine commence le lundi de Paris", async () => {
  ensemencer({ commandes: [
    vente("dim-soir", "2026-11-01T22:30:00.000Z", 100), // dimanche 23:30 a Paris
    vente("lun-nuit", "2026-11-01T23:10:00.000Z", 10) // lundi 00:10 a Paris
  ] });
  horloge(HIVER_NUIT);
  const { body } = await demander("/api/statistics");
  assert.equal(body.salesByDay.at(-1).date, "2026-11-02");
  assert.deepEqual(body.today, { revenue: 10, orders: 1 }, "22:30 UTC en hiver est encore dimanche a Paris");
  assert.deepEqual({ orders: body.week.orders, revenue: body.week.revenue }, { orders: 1, revenue: 10 },
    "lundi 2 : la semaine de Paris vient de commencer, le dimanche est la precedente");
  assert.deepEqual({ orders: body.month.orders, revenue: body.month.revenue }, { orders: 2, revenue: 110 });
});

test("Analyse, reveillon : a 00:30 le 1er janvier a Paris, le mois et l'annee ont change", async () => {
  ensemencer({
    commandes: [
      vente("decembre", "2026-12-31T10:00:00.000Z", 100), // 31/12 11:00 a Paris
      vente("an-neuf", "2026-12-31T23:10:00.000Z", 10) // 01/01 00:10 a Paris
    ],
    clients: [
      { id: "c-cree-31", nom: "Prospect du 31", ville: "Dole", createdAt: "2026-12-31T10:00:00.000Z" },
      { id: "c-cree-1er", nom: "Prospect du 1er", ville: "Dole", createdAt: "2026-12-31T23:20:00.000Z" }
    ]
  });
  horloge(REVEILLON);
  const { body } = await demander("/api/statistics");
  assert.equal(body.salesByDay.at(-1).date, "2027-01-01");
  assert.deepEqual({ orders: body.month.orders, revenue: body.month.revenue }, { orders: 1, revenue: 10 }, "janvier 2027 ne compte que la vente de 00:10");
  // Mois precedent = decembre (100 + 0) -> janvier (10) : une baisse.
  assert.equal(body.month.evolution.label, "baisse");
  assert.equal(body.newClientsMonth, 1, "le prospect cree a 00:20 a Paris est de janvier, celui du 31 non");
});

// --- 3. Les dates par defaut : « aujourd'hui », c'est a Paris ----------------

test("une commande creee sans date, a 01:30 a Paris, est du 24", async () => {
  ensemencer();
  horloge(ETE_NUIT);
  const { res, body } = await poster("/api/customer-orders", {
    client: { nom: "Pharmacie de nuit", ville: "Dole", rue: "3 rue de la Gare" },
    products: [{ productId: "p1", quantite: 2 }]
  });
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.dateCommande, "2026-09-24");
});

test("une commande creee sans date a 00:30 le 1er janvier est de 2027, et son numero aussi", async () => {
  ensemencer();
  horloge(REVEILLON);
  const { res, body } = await poster("/api/customer-orders", {
    client: { nom: "Pharmacie du reveillon", ville: "Dole", rue: "3 rue de la Gare" },
    products: [{ productId: "p1", quantite: 1 }]
  });
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.dateCommande, "2027-01-01");
  assert.match(body.numero, /-2027-/, "le compteur annuel repart en 2027");
});

test("un rappel sans date, un premier contact sans date : le jour de Paris", async () => {
  ensemencer({ clients: [{ id: "c-r", nom: "Cabinet Dupont", ville: "Dole" }] });
  horloge(ETE_NUIT);
  const rappel = await poster("/api/crm/relances", { clientId: "c-r", motif: "Rappeler" });
  assert.equal(rappel.res.status, 201, JSON.stringify(rappel.body));
  assert.equal(rappel.body.datePrevue, "2026-09-24");
  const duJour = await demander("/api/reminders?range=today");
  assert.deepEqual(duJour.body.map(r => r.id), [rappel.body.id], "« aujourd'hui » des rappels est le 24");
  const prospect = await poster("/api/crm/clients", { nom: "Prospect de nuit", ville: "Dole", rue: "9 rue Neuve" });
  assert.equal(prospect.res.status, 201, JSON.stringify(prospect.body));
  assert.equal(prospect.body.firstContactDate, "2026-09-24");
});

test("le tableau de bord : une livraison prevue le 24 est « du jour » a 01:30 a Paris", async () => {
  const pret = { ...vente("pret", "2026-09-24T08:00:00.000Z", 10, "2026-09-24"), status: "pret_livraison", deliveredAt: "" };
  ensemencer({ commandes: [pret] });
  horloge(ETE_NUIT);
  const { body } = await demander("/api/dashboard");
  assert.equal(body.orders.deliveryToday, 1);
  assert.equal(body.orders.deliveryUpcoming, 0);
});

test("prochaine date d'un secteur : le jour du mois deja passe A PARIS saute au mois suivant", () => {
  // Le 23 : a 01:30 le 24 a Paris, c'est passe. L'ancien calcul, en UTC,
  // proposait encore le 23/09 -- une date d'hier.
  assert.equal(nextSectorDeliveryDate({ jourMois: 23 }, new Date(ETE_NUIT)), "2026-10-23");
  assert.equal(nextSectorDeliveryDate({ jourMois: 24 }, new Date(ETE_NUIT)), "2026-09-24");
  assert.equal(nextSectorDeliveryDate({ jourMois: 31 }, new Date(REVEILLON)), "2027-01-31");
  assert.equal(nextSectorDeliveryDate({ jourMois: 30 }, new Date(Date.UTC(2027, 1, 10, 12))), "2027-02-28", "rabattu en fevrier");
});

test("l'annee de repli d'une date illisible est celle de Paris", () => {
  horloge(REVEILLON);
  assert.equal(extractYear(""), 2027);
  assert.equal(extractYear("date inconnue"), 2027);
  assert.equal(extractYear("2026-12-31"), 2026, "une date lisible garde son annee");
});

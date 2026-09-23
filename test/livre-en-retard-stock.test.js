// « Livré en retard sur un stock à zéro » (decision de Thomas, 23/09) -- la
// part SERVEUR, sur un vrai serveur ensemence (SQLite).
//
// Un « Livre » qui arrive EN RETARD -- fait hors ligne et rejoue par la file
// avec son faitLe apres la cloture, ou venu de « Corriger le statut » -- alors
// que le bureau a libere entre-temps la reservation de la commande
// (release-stock) : la livraison a eu lieu, elle est ACCEPTEE. Si le rayon
// n'en a plus assez, il passe en negatif, et c'est DIT (historique « livraison
// acceptee sur stock insuffisant »), jamais cache ni corrige en silence.
//
// Avant : le geste de la file etait refuse (409, « le rayon n'en a plus
// assez ») et « Corriger le statut » refusait TOUJOURS un « Livre » sur une
// commande dont le stock avait ete libere (409), meme avec un rayon plein.
//
// Relecture adverse : le meme « Livre » en TEMPS REEL (la commande liberee
// repart dans une nouvelle tournee), par l'ecran Commandes ou par
// POST /api/livraison ne deduisait rien, en silence ; et une ligne non deduite
// (hors stock, « a renseigner ») etait rendue au rayon par la liberation.
//
// Chaque cas mesure le stock avant et apres (rayon = quantityAvailable,
// reserve = quantityReserved de GET /api/stock).

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-livre-retard-"));
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

async function demander(chemin, options = {}) {
  const res = await fetch(`${baseUrl}${chemin}`, options);
  const texte = await res.text();
  let body = null;
  try { body = texte ? JSON.parse(texte) : null; } catch { body = texte; }
  return { res, body };
}

const envoyer = (methode, chemin, corps = {}, entetes = {}) => demander(chemin, {
  method: methode, headers: { "Content-Type": "application/json", ...entetes }, body: JSON.stringify(corps)
});
const poster = (chemin, corps, entetes) => envoyer("POST", chemin, corps, entetes);
const patcher = (chemin, corps, entetes) => envoyer("PATCH", chemin, corps, entetes);

const JOUR = "2026-09-23";

function commande(id, nom, status, extra = {}) {
  return {
    id, numero: `CMD-2026-${id.slice(2).toUpperCase()}`, clientId: `c-${id}`, clientName: nom, status,
    address: `${id} rue des Lilas`, city: "Dole", postalCode: "39100", sector: "Dole",
    lat: 47.09, lng: 5.49, deliveryDate: JOUR, dateCommande: JOUR,
    products: [{ code: "A1", nom: "Alèses", quantite: 4 }],
    ...extra
  };
}

function arret(o, status, extra = {}) {
  return {
    id: `s-${o.id}`, routeId: "r-cours", orderId: o.id, clientId: o.clientId, clientName: o.clientName,
    address: o.address, city: o.city, postalCode: o.postalCode, sector: o.sector,
    lat: o.lat, lng: o.lng, status, products: o.products, ...extra
  };
}

/**
 * Une tournee EN COURS « r-cours » : B et C en livraison, reservees (4 Aleses
 * chacune, deduites du rayon a la preparation). `rayon` : ce qui reste en rayon.
 */
function ensemencer({ rayon = 20, produitsB = null, autresProduits = [] } = {}) {
  const reserve = { stockReservedAt: `${JOUR}T07:00:00Z` };
  const b = commande("o-b", "Cabinet Dupont", "en_livraison", { ...reserve, routeId: "r-cours", ...(produitsB ? { products: produitsB } : {}) });
  const c = commande("o-c", "EHPAD Bellevue", "en_livraison", { ...reserve, routeId: "r-cours" });
  const commandes = [b, c];
  writeDb({
    ...defaultDb(),
    clients: commandes.map(o => ({ id: o.clientId, nom: o.clientName, ville: "Dole", statut: "restant", lat: o.lat, lng: o.lng })),
    commandes,
    routes: [{
      id: "r-cours", sector: "Dole", status: "en_livraison", deliveryDate: JOUR,
      startedAt: `${JOUR}T08:00:00Z`,
      selectedOrderIds: [b.id, c.id],
      stops: [arret(b, "en_livraison"), arret(c, "en_livraison")]
    }],
    stock: [{ id: "p1", code: "A1", nom: "Alèses", quantite: rayon }, ...autresProduits]
  }, { backup: false });
}

/** La quantite en rayon d'un produit du stock (null : « a renseigner »). */
async function enRayon(id) {
  const { body } = await demander("/api/stock");
  const p = body.find(item => item.id === id);
  return p ? p.quantityAvailable : undefined;
}

/** Le catalogue change a la main (un import, une saisie) : `quantite` null = « a renseigner », undefined = retire. */
function produitA(id, quantite, gabarit = null) {
  const db = readDb();
  const i = db.stock.findIndex(p => p.id === id);
  if (quantite === undefined) db.stock.splice(i, 1);
  else if (i < 0) db.stock.push({ ...gabarit, id, quantite });
  else db.stock[i].quantite = quantite;
  writeDb(db, { backup: false });
}

async function stock() {
  const { body } = await demander("/api/stock");
  const p = body.find(item => item.id === "p1");
  return { rayon: p.quantityAvailable, reserve: p.quantityReserved };
}

/** Le rayon tombe a `n` : les 4 rendus par la liberation sont repartis ailleurs. */
function rayonA(n) {
  const db = readDb();
  db.stock.find(p => p.id === "p1").quantite = n;
  writeDb(db, { backup: false });
}

const commandeLue = id => readDb().commandes.find(o => o.id === id);
const historique = async () => (await demander("/api/historique")).body;
const alertesStockInsuffisant = async () => (await historique()).filter(h => /livraison acceptée sur stock insuffisant/i.test(h.message));

/** Cloture, puis liberation de la reservation de B : le cas du bureau. */
async function clotureEtLiberation() {
  assert.equal((await poster("/api/routes/r-cours/cloturer")).res.status, 200, "prealable : la cloture");
  const libere = await poster("/api/orders/o-b/release-stock");
  assert.equal(libere.res.status, 200, JSON.stringify(libere.body));
  assert.equal(libere.body.released, true, "prealable : la reservation de o-b doit etre liberee");
}

/** Un absent, puis liberation de la reservation de B (la tournee reste en cours). */
async function absentEtLiberation() {
  const faitLe = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  assert.equal((await patcher("/api/routes/r-cours/stops/s-o-b", { status: "absent", faitLe })).res.status, 200, "prealable : l'absent");
  const libere = await poster("/api/orders/o-b/release-stock");
  assert.equal(libere.res.status, 200, JSON.stringify(libere.body));
  assert.equal(libere.body.released, true, "prealable : la reservation de o-b doit etre liberee");
  return faitLe;
}

// --- La file : un « Livre » fait avant la cloture, rejoue apres ---------------

test("file — un « Livré » en retard sur un rayon qui n'en a plus assez : accepté, le rayon passe à -2, et c'est journalisé", async () => {
  ensemencer();
  const depart = await stock();
  const avantCloture = new Date(Date.now() - 60 * 1000).toISOString();
  await clotureEtLiberation();
  rayonA(2);

  const tard = await patcher("/api/routes/r-cours/stops/s-o-b", { status: "livre", faitLe: avantCloture });
  assert.equal(tard.res.status, 200, `la livraison faite est refusee : ${JSON.stringify(tard.body)}`);
  assert.equal(commandeLue("o-b").status, "livre");
  assert.equal(commandeLue("o-b").deliveredAt, avantCloture, "la livraison n'est pas datee du geste");
  assert.equal(commandeLue("o-b").stockReleaseReason, "consumed_by_delivery");
  // 2 en rayon, 4 livrees : -2. La reservation de B ne compte plus.
  assert.deepEqual(await stock(), { rayon: -2, reserve: depart.reserve - 4 }, "le stock ne dit pas la livraison acceptee");
  const alertes = await alertesStockInsuffisant();
  assert.equal(alertes.length, 1, "le negatif n'est pas journalise (ou l'est deux fois)");
  assert.match(alertes[0].message, /CMD-2026-B/);
  assert.match(alertes[0].message, /Alèses : 2 en rayon pour 4 livrés, stock à -2/);
});

test("file — le même « Livré » rejoué (même clé, puis sans clé) ne déduit qu'une fois", async () => {
  ensemencer();
  const avantCloture = new Date(Date.now() - 60 * 1000).toISOString();
  await clotureEtLiberation();
  rayonA(2);
  const cle = { "X-Sereo-Geste": "livre-en-retard-0001" };

  const premier = await patcher("/api/routes/r-cours/stops/s-o-b", { status: "livre", faitLe: avantCloture }, cle);
  assert.equal(premier.res.status, 200, JSON.stringify(premier.body));
  const apresPremier = await stock();
  assert.equal(apresPremier.rayon, -2);

  const rejoue = await patcher("/api/routes/r-cours/stops/s-o-b", { status: "livre", faitLe: avantCloture }, cle);
  assert.equal(rejoue.res.status, 200);
  assert.equal(rejoue.res.headers.get("x-sereo-geste-rejoue"), "1", "le renvoi n'a pas ete reconnu comme deja fait");
  // Sans cle (un renvoi d'avant le lot 1) : l'arret n'est plus « suppose » par
  // la cloture, le geste est refuse -- et rien ne bouge.
  const sansCle = await patcher("/api/routes/r-cours/stops/s-o-b", { status: "livre", faitLe: avantCloture });
  assert.equal(sansCle.res.status, 409, JSON.stringify(sansCle.body));

  assert.deepEqual(await stock(), apresPremier, "un renvoi a deduit une seconde fois");
  assert.equal((await alertesStockInsuffisant()).length, 1, "un renvoi a journalise une seconde fois");
});

test("file — un produit retiré du stock après la libération : la livraison passe, l'historique le nomme, sans parler de stock insuffisant", async () => {
  // L'etat que l'API produit : la reservation a ete prise quand les draps
  // etaient au stock (reserveStockForOrder exige toutes les lignes connues),
  // puis le catalogue a change apres la liberation (un import les a retires).
  const draps = { code: "Z9", nom: "Draps jetables" };
  ensemencer({
    produitsB: [{ code: "A1", nom: "Alèses", quantite: 4 }, { ...draps, quantite: 2 }],
    autresProduits: [{ id: "p2", ...draps, quantite: 5 }]
  });
  const avantCloture = new Date(Date.now() - 60 * 1000).toISOString();
  await clotureEtLiberation();
  produitA("p2", undefined);
  const depart = await stock();

  const tard = await patcher("/api/routes/r-cours/stops/s-o-b", { status: "livre", faitLe: avantCloture });
  assert.equal(tard.res.status, 200, JSON.stringify(tard.body));
  // Les Aleses, suivies, sont deduites (le rayon en avait assez) ; les draps ne le sont nulle part.
  assert.equal((await stock()).rayon, depart.rayon - 4);
  // Aucune ligne ne manque : dire « stock insuffisant » serait faux.
  assert.equal((await alertesStockInsuffisant()).length, 0, "l'historique dit « stock insuffisant » alors que le rayon couvrait tout");
  const nonSuivi = (await historique()).filter(h => /livraison acceptée sur un stock non suivi/i.test(h.message));
  assert.equal(nonSuivi.length, 1, "la ligne non deduite n'est pas journalisee (ou l'est deux fois)");
  assert.match(nonSuivi[0].message, /Draps jetables : absent du stock, rien déduit/);
});

// --- « Corriger le statut » vers « Livre » -------------------------------------

test("correction — « Absent » corrigé en « Livré » après une libération, rayon suffisant : accepté, le rayon est déduit de nouveau", async () => {
  ensemencer();
  const depart = await stock();
  const faitLe = await absentEtLiberation();
  assert.equal((await stock()).rayon, depart.rayon + 4, "prealable : la liberation rend 4 au rayon");

  const r = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "livre", cause: "Livré au voisin, noté absent par erreur" });
  assert.equal(r.res.status, 200, `la correction est refusee : ${r.res.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.body.order.status, "livre");
  assert.equal(commandeLue("o-b").deliveredAt, faitLe, "la livraison n'est pas datee du geste d'origine");
  assert.deepEqual(await stock(), { rayon: depart.rayon, reserve: depart.reserve - 4 }, "la marchandise livree est encore comptee en rayon");
  assert.equal((await alertesStockInsuffisant()).length, 0, "un rayon suffisant n'est pas une alerte");
});

test("correction — même geste, rayon à zéro : accepté, le rayon passe à -4, journalisé ; la corriger de nouveau ne déduit rien de plus", async () => {
  ensemencer();
  const depart = await stock();
  await absentEtLiberation();
  rayonA(0);

  const r = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "livre", cause: "Livré, le bon signé est revenu" });
  assert.equal(r.res.status, 200, `la correction est refusee : ${r.res.status} ${JSON.stringify(r.body)}`);
  assert.deepEqual(await stock(), { rayon: -4, reserve: depart.reserve - 4 });
  const alertes = await alertesStockInsuffisant();
  assert.equal(alertes.length, 1);
  assert.match(alertes[0].message, /Alèses : 0 en rayon pour 4 livrés, stock à -4/);
  assert.match(alertes[0].message, /correction/i, "l'historique ne dit pas d'ou vient la livraison");

  // Idempotence : la meme correction renvoyee est refusee, rien ne bouge.
  const encore = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "livre", cause: "Livré, le bon signé est revenu" });
  assert.equal(encore.res.status, 400, JSON.stringify(encore.body));
  assert.deepEqual(await stock(), { rayon: -4, reserve: depart.reserve - 4 }, "le renvoi a touche au stock");

  // Reservation juste : defaire la livraison redonne la reservation, sans
  // toucher au rayon ; la refaire la consomme, sans toucher au rayon.
  const absent = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "absent", cause: "Finalement pas livré" });
  assert.equal(absent.res.status, 200, JSON.stringify(absent.body));
  assert.deepEqual(await stock(), { rayon: -4, reserve: depart.reserve }, "defaire la livraison n'a pas rendu la reservation");
  const livre = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "livre", cause: "Si, livré" });
  assert.equal(livre.res.status, 200, JSON.stringify(livre.body));
  assert.deepEqual(await stock(), { rayon: -4, reserve: depart.reserve - 4 });
  assert.equal((await alertesStockInsuffisant()).length, 1, "la reservation reprise a ete deduite une seconde fois");
});

// --- Temoin : le « Livre » en temps reel ne consulte pas le rayon ---------------

test("témoin — un « Livré » en temps réel, rayon à zéro : la réservation, faite à la préparation, est consommée ; aucune alerte", async () => {
  ensemencer({ rayon: 0 });
  const depart = await stock();
  const r = await patcher("/api/routes/r-cours/stops/s-o-b", { status: "livre" });
  assert.equal(r.res.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await stock(), { rayon: 0, reserve: depart.reserve - 4 }, "le Livre en temps reel a touche au rayon");
  assert.equal((await alertesStockInsuffisant()).length, 0);
});

// --- Relecture adverse : les autres chemins vers « Livre » ----------------------
//
// Une commande « a reprogrammer » dont le stock a ete libere reste livrable :
// elle repart dans une nouvelle tournee, ou passe par l'ecran Commandes. Son
// « Livre » la faisait sortir sans rien deduire du rayon (stockReservedAt nul :
// rien a consommer), ni rien dire -- la marchandise, chez le client, restait
// comptee en rayon.

/** Absent + liberation, puis une nouvelle tournee avec la commande, demarree. Rend l'arret. */
async function nouvelleTourneeApresLiberation() {
  await absentEtLiberation();
  const cree = await poster("/api/routes", { orderIds: ["o-b"] });
  assert.equal(cree.res.status, 201, `prealable : la nouvelle tournee : ${JSON.stringify(cree.body)}`);
  const depart = await poster(`/api/routes/${cree.body.id}/start`);
  assert.equal(depart.res.status, 200, `prealable : le depart : ${JSON.stringify(depart.body)}`);
  const s = cree.body.stops.find(item => item.orderId === "o-b");
  return `/api/routes/${cree.body.id}/stops/${s.id}`;
}

test("temps réel — « Livré » dans une nouvelle tournée après une libération, rayon suffisant : le rayon est déduit de nouveau", async () => {
  ensemencer({ rayon: 10 });
  const depart = await stock();
  const chemin = await nouvelleTourneeApresLiberation();
  assert.equal((await stock()).rayon, depart.rayon + 4, "prealable : la liberation rend 4 au rayon");

  const r = await patcher(chemin, { status: "livre" });
  assert.equal(r.res.status, 200, JSON.stringify(r.body));
  assert.equal(commandeLue("o-b").status, "livre");
  assert.equal(commandeLue("o-b").stockReleaseReason, "consumed_by_delivery", "la livraison n'a rien consomme");
  assert.deepEqual(await stock(), { rayon: depart.rayon, reserve: depart.reserve - 4 }, "la marchandise livree est encore comptee en rayon");
  const deduits = (await historique()).filter(h => /livree apres la liberation de son stock/i.test(h.message));
  assert.equal(deduits.length, 1, "la deduction n'est pas journalisee");
  assert.match(deduits[0].message, /en tournée/);
  assert.equal((await alertesStockInsuffisant()).length, 0);
});

test("temps réel — même chemin, rayon à 1 : accepté, le rayon passe à -3, journalisé", async () => {
  ensemencer({ rayon: 10 });
  const chemin = await nouvelleTourneeApresLiberation();
  rayonA(1);

  const r = await patcher(chemin, { status: "livre" });
  assert.equal(r.res.status, 200, JSON.stringify(r.body));
  assert.equal((await stock()).rayon, -3, "le Livre en temps reel n'a rien deduit");
  const alertes = await alertesStockInsuffisant();
  assert.equal(alertes.length, 1);
  assert.match(alertes[0].message, /Alèses : 1 en rayon pour 4 livrés, stock à -3/);
});

test("écran Commandes — « en livraison » puis « livré » après une libération : le rayon est déduit de nouveau", async () => {
  ensemencer({ rayon: 10 });
  const depart = await stock();
  await absentEtLiberation();

  assert.equal((await patcher("/api/orders/o-b", { status: "en_livraison" })).res.status, 200, "prealable : en livraison");
  const r = await patcher("/api/orders/o-b", { status: "livre" });
  assert.equal(r.res.status, 200, JSON.stringify(r.body));
  assert.equal(commandeLue("o-b").status, "livre");
  assert.deepEqual(await stock(), { rayon: depart.rayon, reserve: depart.reserve - 4 }, "la marchandise livree est encore comptee en rayon");
});

test("POST /api/livraison (hérité) — « livrée » après une libération : le rayon est déduit de nouveau", async () => {
  ensemencer({ rayon: 10 });
  const depart = await stock();
  await absentEtLiberation();

  assert.equal((await patcher("/api/orders/o-b", { status: "en_livraison" })).res.status, 200, "prealable : en livraison");
  const r = await poster("/api/livraison", { clientId: "c-o-b", orderId: "o-b", statut: "livree" });
  assert.equal(r.res.status, 200, JSON.stringify(r.body));
  assert.equal(commandeLue("o-b").status, "livre");
  assert.deepEqual(await stock(), { rayon: depart.rayon, reserve: depart.reserve - 4 }, "la marchandise livree est encore comptee en rayon");
});

// --- Relecture adverse : une ligne non deduite n'est jamais « restituee » -------

const drapsB = {
  produitsB: [{ code: "A1", nom: "Alèses", quantite: 4 }, { code: "Z9", nom: "Draps jetables", quantite: 3 }],
  autresProduits: [{ id: "p2", code: "Z9", nom: "Draps jetables", quantite: 10 }]
};

test("aller-retour — Draps « à renseigner » à la livraison : défaire la livraison puis libérer ne leur invente pas de quantité", async () => {
  ensemencer(drapsB);
  await absentEtLiberation();
  rayonA(2);
  produitA("p2", null);

  const livre = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "livre", cause: "Livré, bon signé" });
  assert.equal(livre.res.status, 200, JSON.stringify(livre.body));
  assert.equal(await enRayon("p1"), -2);
  assert.equal(await enRayon("p2"), null, "prealable : les draps restent « a renseigner »");

  const absent = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "absent", cause: "Finalement pas livré" });
  assert.equal(absent.res.status, 200, JSON.stringify(absent.body));
  const libere = await poster("/api/orders/o-b/release-stock");
  assert.equal(libere.res.status, 200, JSON.stringify(libere.body));
  assert.equal(libere.body.released, true);

  assert.equal(await enRayon("p1"), 2, "les Aleses deduites ne sont pas rendues");
  assert.equal(await enRayon("p2"), null, "la liberation a invente une quantite de draps jamais comptee");
  assert.equal(commandeLue("o-b").stockNonDeduit, undefined, "la marque des lignes non deduites survit a la liberation");
});

test("aller-retour — Draps retirés du stock à la livraison puis réimportés : la libération ne rend que ce qui a été déduit", async () => {
  ensemencer(drapsB);
  await absentEtLiberation();
  rayonA(2);
  produitA("p2", undefined);

  const livre = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "livre", cause: "Livré, bon signé" });
  assert.equal(livre.res.status, 200, JSON.stringify(livre.body));
  assert.equal(await enRayon("p1"), -2);

  const absent = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "absent", cause: "Finalement pas livré" });
  assert.equal(absent.res.status, 200, JSON.stringify(absent.body));
  produitA("p2", 5, { code: "Z9", nom: "Draps jetables" });
  const libere = await poster("/api/orders/o-b/release-stock");
  assert.equal(libere.res.status, 200, JSON.stringify(libere.body));

  assert.equal(await enRayon("p1"), 2);
  assert.equal(await enRayon("p2"), 5, "la liberation a rendu des draps jamais deduits");
});

test("témoin — une réservation ordinaire (toutes lignes déduites à la préparation) : la libération rend chaque ligne", async () => {
  ensemencer(drapsB);
  await absentEtLiberation();
  assert.equal(await enRayon("p1"), 24);
  assert.equal(await enRayon("p2"), 13, "la liberation ordinaire ne rend plus les draps");
});

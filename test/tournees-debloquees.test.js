// Lot 2 de l'audit « localisation, carte, tournees » (23/09) : DEBLOQUER LES
// TOURNEES -- la part SERVEUR, sur un vrai serveur ensemence (SQLite).
//
// Ce que chaque cas garde, et le defaut mesure par l'audit (commit 019788c) :
//
//   H8  Une tournee ne s'annulait pas et ne se cloturait pas : une tournee mal
//       creee bloquait ses commandes ; une tournee finie a moitie restait « en
//       livraison » pour toujours.
//   M2  Un arret deja traite ne se corrigeait pas, ni a l'ecran ni au serveur
//       (`a_reprogrammer -> livre` n'existe pas, `livre` n'a aucune sortie).
//   API une commande entrait dans deux tournees actives (sans depart) ; une
//       commande d'une tournee prete repassait en preparation ; un arret se
//       rouvrait sur une tournee terminee.
//   M7  (decision 7) l'ancienne route /api/optimize-route reecrivait l'ordre de
//       toute la table des clients.
//   D10 (decision 10) « remis a… » : une note facultative du geste « Livre ».

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-lot2-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const { app, closeStorage, defaultDb, readDb, writeDb, tourneesAPurger, createRoute } = require("../server");

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

const poster = (chemin, corps = {}) => demander(chemin, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps)
});
const patcher = (chemin, corps = {}) => demander(chemin, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps)
});

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

function arret(o, routeId, status, extra = {}) {
  return {
    id: `s-${o.id}`, routeId, orderId: o.id, clientId: o.clientId, clientName: o.clientName,
    address: o.address, city: o.city, postalCode: o.postalCode, sector: o.sector,
    lat: o.lat, lng: o.lng, status, products: o.products, ...extra
  };
}

/**
 * Quatre commandes PRETES (reservees : 4 chacune, deduites du rayon a la
 * preparation ; 20 restent en rayon), et une tournee EN COURS « r-cours » :
 * A livre, B en livraison, C en livraison (C : reservee). Aucune tournee prete.
 */
function ensemencer({ routes = null } = {}) {
  const reserve = { stockReservedAt: `${JOUR}T07:00:00Z` };
  const p1 = commande("o-p1", "EHPAD Les Tilleuls", "pret_livraison", reserve);
  const p2 = commande("o-p2", "Pharmacie de la Gare", "pret_livraison", reserve);
  const p3 = commande("o-p3", "SSIAD Haute Vallée", "pret_livraison", reserve);
  const a = commande("o-a", "Clinique du Doubs", "livre", { deliveredAt: `${JOUR}T09:00:00Z`, routeId: "r-cours", stockReleasedAt: `${JOUR}T09:00:00Z`, stockReleaseReason: "consumed_by_delivery" });
  const b = commande("o-b", "Cabinet Dupont", "en_livraison", { ...reserve, routeId: "r-cours" });
  const c = commande("o-c", "EHPAD Bellevue", "en_livraison", { ...reserve, routeId: "r-cours" });
  const commandes = [p1, p2, p3, a, b, c];
  writeDb({
    ...defaultDb(),
    clients: commandes.map(o => ({ id: o.clientId, nom: o.clientName, ville: "Dole", statut: "restant", lat: o.lat, lng: o.lng })),
    commandes,
    routes: routes || [{
      id: "r-cours", sector: "Dole", status: "en_livraison", deliveryDate: JOUR,
      startedAt: `${JOUR}T08:00:00Z`,
      selectedOrderIds: [a.id, b.id, c.id],
      stops: [
        arret(a, "r-cours", "livre", { deliveredAt: `${JOUR}T09:00:00Z` }),
        arret(b, "r-cours", "en_livraison"),
        arret(c, "r-cours", "en_livraison")
      ]
    }],
    stock: [{ id: "p1", code: "A1", nom: "Alèses", quantite: 20 }]
  }, { backup: false });
}

async function stock() {
  const { body } = await demander("/api/stock");
  const p = body.find(item => item.id === "p1");
  return { rayon: p.quantityAvailable, reserve: p.quantityReserved };
}

const commandeLue = id => readDb().commandes.find(o => o.id === id);
const tourneeLue = async id => (await demander("/api/routes")).body.find(r => r.id === id);

async function creerTournee(orderIds, extra = {}) {
  const r = await poster("/api/routes", { orderIds, deliveryDate: JOUR, ...extra });
  assert.equal(r.res.status, 201, `prealable : la tournee doit se creer (${JSON.stringify(r.body)})`);
  return r.body;
}

// --- H8 : annuler une tournee prete --------------------------------------------

test("H8 — « Annuler » une tournee PRETE : ses commandes redeviennent pretes, le stock est celui d'avant", async () => {
  ensemencer();
  const avant = await stock();
  const tournee = await creerTournee(["o-p1", "o-p2"]);

  // Le defaut : ces commandes sont bloquees par la tournee mal creee.
  const bloquee = await poster("/api/routes", { orderIds: ["o-p1"] });
  assert.equal(bloquee.res.status, 400, "prealable : la tournee prete retient ses commandes");

  const annulee = await poster(`/api/routes/${tournee.id}/annuler`);
  assert.equal(annulee.res.status, 200, `la tournee ne s'annule pas : ${annulee.res.status} ${JSON.stringify(annulee.body)}`);
  assert.equal(annulee.body.status, "annulee");
  assert.equal((await tourneeLue(tournee.id)).status, "annulee", "le statut « annulee » n'a pas survecu a l'ecriture");

  for (const id of ["o-p1", "o-p2"]) {
    assert.equal(commandeLue(id).status, "pret_livraison", `${id} n'est plus prete`);
    assert.equal(commandeLue(id).routeId, null, `${id} reste rattachee a la tournee annulee`);
  }
  assert.deepEqual(await stock(), avant, "le stock n'est pas celui d'avant la tournee");

  // Elles entrent dans une nouvelle tournee.
  const nouvelle = await poster("/api/routes", { orderIds: ["o-p1", "o-p2"] });
  assert.equal(nouvelle.res.status, 201, JSON.stringify(nouvelle.body));
  const historique = (await demander("/api/historique")).body;
  assert.ok(historique.some(h => /annulée/.test(h.message) && h.details?.routeId === tournee.id), "l'annulation n'est pas journalisee");
});

test("H8 — « Annuler » refuse une tournee PARTIE (elle se cloture) ; annuler deux fois ne fait rien de plus", async () => {
  ensemencer();
  const partie = await poster("/api/routes/r-cours/annuler");
  assert.equal(partie.res.status, 409, JSON.stringify(partie.body));
  assert.match(partie.body.error, /clôture/);
  assert.equal((await tourneeLue("r-cours")).status, "en_livraison");

  const tournee = await creerTournee(["o-p3"]);
  assert.equal((await poster(`/api/routes/${tournee.id}/annuler`)).res.status, 200);
  const encore = await poster(`/api/routes/${tournee.id}/annuler`);
  assert.equal(encore.res.status, 200);
  const depart = await poster(`/api/routes/${tournee.id}/start`);
  assert.equal(depart.res.status, 400, "une tournee annulee repart");
});

// --- H8 : cloturer une tournee en cours ------------------------------------------

test("H8 — « Clôturer » une tournee EN COURS : les restants « A reprogrammer », les livres restent livres", async () => {
  ensemencer();
  const avant = await stock();
  const close = await poster("/api/routes/r-cours/cloturer");
  assert.equal(close.res.status, 200, `la tournee ne se cloture pas : ${close.res.status} ${JSON.stringify(close.body)}`);

  const lue = await tourneeLue("r-cours");
  assert.equal(lue.status, "cloturee", "la tournee finie a moitie reste « en livraison »");
  assert.ok(lue.completedAt, "la cloture n'a pas de date de fin");
  assert.deepEqual(lue.stops.map(s => s.status), ["livre", "a_reprogrammer", "a_reprogrammer"]);
  assert.equal(commandeLue("o-a").status, "livre", "un livre n'est plus livre");
  for (const id of ["o-b", "o-c"]) assert.equal(commandeLue(id).status, "a_reprogrammer", `${id} n'est pas a reprogrammer`);
  // Le stock : la reservation est gardee pour la relivraison (comme un absent).
  assert.deepEqual(await stock(), avant, "la cloture a touche au stock");

  // Les restants reviennent dans les commandes pretes : une nouvelle tournee les prend.
  const nouvelle = await poster("/api/routes", { orderIds: ["o-b", "o-c"] });
  assert.equal(nouvelle.res.status, 201, JSON.stringify(nouvelle.body));

  // Irreversible : elle ne repart pas, et un geste ne l'y rouvre pas.
  assert.equal((await poster("/api/routes/r-cours/start")).res.status, 400);
  const geste = await patcher("/api/routes/r-cours/stops/s-o-a", { status: "absent" });
  assert.equal(geste.res.status, 409, JSON.stringify(geste.body));
  const historique = (await demander("/api/historique")).body;
  assert.ok(historique.some(h => /clôturée/.test(h.message) && /Cabinet Dupont/.test(h.message)), "la cloture n'est pas journalisee avec les arrets reprogrammes");
});

test("H8 — « Clôturer » refuse une tournee PRETE (elle s'annule) et une tournee terminee", async () => {
  ensemencer();
  const tournee = await creerTournee(["o-p1"]);
  const prete = await poster(`/api/routes/${tournee.id}/cloturer`);
  assert.equal(prete.res.status, 409);
  assert.match(prete.body.error, /annule/);
  assert.equal((await tourneeLue(tournee.id)).status, "prete");
});

test("H8 — un « Livré » fait AVANT la cloture et arrive apres (file hors ligne) n'est pas perdu", async () => {
  ensemencer();
  const avantCloture = new Date(Date.now() - 60 * 1000).toISOString();
  assert.equal((await poster("/api/routes/r-cours/cloturer")).res.status, 200);
  const tard = await patcher("/api/routes/r-cours/stops/s-o-b", { status: "livre", faitLe: avantCloture });
  assert.equal(tard.res.status, 200, `la livraison faite avant la cloture est refusee : ${JSON.stringify(tard.body)}`);
  assert.equal(commandeLue("o-b").status, "livre");
  assert.equal(commandeLue("o-b").deliveredAt, avantCloture);
  assert.equal((await tourneeLue("r-cours")).status, "cloturee", "le geste en retard a change le statut de la tournee");

  // Temoin : un geste date d'APRES la cloture est refuse.
  const apres = await patcher("/api/routes/r-cours/stops/s-o-c", { status: "livre", faitLe: new Date(Date.now() + 1000).toISOString() });
  assert.equal(apres.res.status, 409, JSON.stringify(apres.body));
  assert.equal(commandeLue("o-c").status, "a_reprogrammer");
});

test("H8 — un geste en retard ne s'applique plus si la commande est repartie dans une autre tournee", async () => {
  ensemencer();
  const avantCloture = new Date(Date.now() - 60 * 1000).toISOString();
  assert.equal((await poster("/api/routes/r-cours/cloturer")).res.status, 200);
  await creerTournee(["o-b"]);
  const tard = await patcher("/api/routes/r-cours/stops/s-o-b", { status: "livre", faitLe: avantCloture });
  assert.equal(tard.res.status, 409, JSON.stringify(tard.body));
  assert.equal(commandeLue("o-b").status, "a_reprogrammer");
});

test("H8 — une tournee cloturee est FINIE partout : liste sans trace (rendu a la demande), purgeable a 12 mois", async () => {
  ensemencer();
  const db = readDb();
  const trace = { type: "LineString", coordinates: [[5.49, 47.09], [5.5, 47.1]] };
  db.routes[0].geometry = trace;
  writeDb(db, { backup: false });
  assert.ok((await tourneeLue("r-cours")).geometry, "prealable : la tournee en cours envoie son trace");
  await poster("/api/routes/r-cours/cloturer");
  const lue = await tourneeLue("r-cours");
  assert.equal(lue.traceOmise, true, "la liste envoie encore le trace d'une tournee cloturee");
  assert.equal(lue.geometry, undefined);
  // storage/sqliteStore.js : readDb ne le charge plus, mais il reste en base.
  assert.equal(Object.prototype.hasOwnProperty.call(readDb().routes.find(r => r.id === "r-cours"), "geometry"), false,
    "readDb charge encore le trace d'une tournee cloturee");
  assert.deepEqual((await demander("/api/routes/r-cours")).body.geometry, trace, "le trace est perdu");
  // La purge des 12 mois la prend comme une terminee.
  const plusTard = new Date(Date.now() + 400 * 24 * 3600 * 1000);
  assert.deepEqual(tourneesAPurger(readDb(), plusTard, 12).map(r => r.id), ["r-cours"], "une tournee cloturee n'est jamais purgee");
});

// --- Gardes de l'API --------------------------------------------------------------

test("API — une commande n'entre pas dans DEUX tournees actives, meme sans depart ; le refus la nomme", async () => {
  ensemencer();
  await creerTournee(["o-p1"]);
  const seconde = await poster("/api/routes", { orderIds: ["o-p1", "o-p2"] });
  assert.equal(seconde.res.status, 400, `une commande est entree dans deux tournees : ${JSON.stringify(seconde.body)}`);
  assert.match(seconde.body.error, /CMD-2026-P1 \(EHPAD Les Tilleuls\)/, "le refus ne nomme pas la commande");
  assert.match(seconde.body.error, /Tournée Dole du 23\/09/, "le refus ne nomme pas la tournee");
});

test("API — createRoute appele SANS selection (chemin interne) ne prend pas non plus une commande deja en tournee", async () => {
  ensemencer();
  await creerTournee(["o-p1"]);
  // POST /api/routes exige une selection (lot 5) ; createRoute reste exporte et
  // appele sans elle : la garde tient aussi la.
  assert.throws(() => createRoute(readDb(), {}), /CMD-2026-P1 \(EHPAD Les Tilleuls\) est déjà dans la tournée/);
});

test("API — une commande choisie qui n'est pas prete est NOMMEE (avant : retiree en silence)", async () => {
  ensemencer();
  const db = readDb();
  db.commandes.push(commande("o-prep", "Maison de santé du Jura", "en_preparation"));
  writeDb(db, { backup: false });
  const r = await poster("/api/routes", { orderIds: ["o-p1", "o-prep"] });
  assert.equal(r.res.status, 400, `la tournee est creee sans la commande choisie : ${JSON.stringify(r.body)}`);
  assert.match(r.body.error, /Maison de santé du Jura/);
  // Temoin : la date d'une commande prete d'un autre jour est dite.
  const jour = await poster("/api/routes", { orderIds: ["o-p1"], deliveryDate: "2026-09-25" });
  assert.equal(jour.res.status, 400);
  assert.match(jour.body.error, /EHPAD Les Tilleuls\) est prévue le 23\/09, pas le 25\/09/);
});

test("API — une commande d'une tournee prete ne repasse pas en preparation sans quitter la tournee", async () => {
  ensemencer();
  const tournee = await creerTournee(["o-p1"]);
  const prepa = await poster("/api/orders/o-p1/start-preparation");
  assert.equal(prepa.res.status, 409, `la commande repasse en preparation : ${JSON.stringify(prepa.body)}`);
  assert.match(prepa.body.error, /Tournée Dole du 23\/09/);
  const patch = await patcher("/api/orders/o-p1", { status: "en_preparation" });
  assert.equal(patch.res.status, 409, JSON.stringify(patch.body));
  assert.equal(commandeLue("o-p1").status, "pret_livraison");
  // La tournee demarre encore.
  assert.equal((await poster(`/api/routes/${tournee.id}/start`)).res.status, 200);
  // Temoin : hors tournee (annulee), la preparation est permise.
  ensemencer();
  const t2 = await creerTournee(["o-p2"]);
  await poster(`/api/routes/${t2.id}/annuler`);
  const libre = await patcher("/api/orders/o-p2", { status: "en_preparation" });
  assert.equal(libre.res.status, 200, JSON.stringify(libre.body));
});

test("API — un arret ne se rouvre pas sur une tournee terminee", async () => {
  ensemencer({
    routes: [{
      id: "r-finie", sector: "Dole", status: "terminee", deliveryDate: JOUR, startedAt: `${JOUR}T08:00:00Z`, completedAt: `${JOUR}T11:00:00Z`,
      stops: [arret(commande("o-b", "Cabinet Dupont", "a_reprogrammer"), "r-finie", "absent", { deliveredAt: `${JOUR}T09:30:00Z` })]
    }]
  });
  const db = readDb();
  db.commandes.find(o => o.id === "o-b").status = "a_reprogrammer";
  writeDb(db, { backup: false });
  const rouvert = await patcher("/api/routes/r-finie/stops/s-o-b", { status: "en_livraison" });
  assert.equal(rouvert.res.status, 409, `l'arret s'est rouvert : ${JSON.stringify(rouvert.body)}`);
  assert.match(rouvert.body.error, /Corriger le statut/);
  const lue = await tourneeLue("r-finie");
  assert.equal(lue.stops[0].status, "absent");
  assert.equal(lue.status, "terminee");
});

test("API — un arret deja traite ne change pas par un geste ordinaire ; le meme geste renvoye ne fait rien", async () => {
  ensemencer();
  const autre = await patcher("/api/routes/r-cours/stops/s-o-a", { status: "absent" });
  assert.equal(autre.res.status, 409, JSON.stringify(autre.body));
  assert.match(autre.body.error, /déjà « Livré »/);
  const nHist = (await demander("/api/historique")).body.length;
  const meme = await patcher("/api/routes/r-cours/stops/s-o-a", { status: "livre" });
  assert.equal(meme.res.status, 200, JSON.stringify(meme.body));
  assert.equal((await demander("/api/historique")).body.length, nHist, "le renvoi du meme geste est journalise deux fois");
});

test("API — un geste sur une tournee pas encore partie est refuse", async () => {
  ensemencer();
  const tournee = await creerTournee(["o-p1"]);
  const r = await patcher(`/api/routes/${tournee.id}/stops/${tournee.stops[0].id}`, { status: "en_livraison" });
  assert.equal(r.res.status, 409, JSON.stringify(r.body));
  assert.equal(commandeLue("o-p1").status, "pret_livraison");
});

// --- M2 : corriger le statut ------------------------------------------------------

test("M2 — « Absent » saisi par erreur se corrige en « Livré » : journalise, date du geste d'origine, stock juste", async () => {
  ensemencer();
  const faitLe = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await patcher("/api/routes/r-cours/stops/s-o-b", { status: "absent", faitLe });
  const avant = await stock();
  const r = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "livre", cause: "Absent tapé par erreur" });
  assert.equal(r.res.status, 200, `la correction est refusee : ${r.res.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.body.stop.status, "livre");
  assert.equal(r.body.order.status, "livre");
  assert.equal(commandeLue("o-b").deliveredAt, faitLe, "la livraison n'est pas datee du geste d'origine");
  const apres = await stock();
  assert.equal(apres.rayon, avant.rayon, "la correction a touche au stock en rayon");
  assert.equal(apres.reserve, avant.reserve - 4, "la livraison corrigee n'a pas consomme la reservation");
  const h = (await demander("/api/historique")).body.find(item => item.type === "Correction");
  assert.ok(h, "la correction n'est pas journalisee");
  assert.match(h.message, /Cabinet Dupont : Absent → Livré — Absent tapé par erreur/);
  assert.deepEqual(r.body.stop.corrections.map(c => [c.de, c.vers, c.cause]), [["absent", "livre", "Absent tapé par erreur"]]);
});

test("M2 — « Livré » corrige en « Absent » puis en « Livré » : la reservation revient, puis repart ; le rayon ne bouge jamais", async () => {
  ensemencer();
  const depart = await stock();
  const vers = async (status, cause) => {
    const r = await poster("/api/routes/r-cours/stops/s-o-a/correction", { status, cause });
    assert.equal(r.res.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const absent = await vers("absent", "Pas livré : colis resté dans le camion");
  assert.equal(absent.order.status, "a_reprogrammer");
  assert.equal(absent.order.deliveredAt, "", "la date de livraison reste apres la correction");
  assert.match(absent.stop.problemReason, /correction : Pas livré/);
  const milieu = await stock();
  assert.equal(milieu.reserve, depart.reserve + 4, "la reservation n'est pas revenue : le stock dit la marchandise chez le client");
  assert.equal(milieu.rayon, depart.rayon);
  await vers("livre", "Finalement livré");
  assert.deepEqual(await stock(), depart, "l'aller-retour n'a pas rendu le stock d'avant");
  assert.equal(commandeLue("o-a").status, "livre");
});

test("M2 — « à faire » rouvre une tournee terminee ; jamais une tournee cloturee", async () => {
  ensemencer();
  await patcher("/api/routes/r-cours/stops/s-o-b", { status: "livre" });
  await patcher("/api/routes/r-cours/stops/s-o-c", { status: "absent" });
  assert.equal((await tourneeLue("r-cours")).status, "terminee", "prealable");
  const r = await poster("/api/routes/r-cours/stops/s-o-c/correction", { status: "en_livraison", cause: "Je repasse cet apres-midi" });
  assert.equal(r.res.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.route.status, "en_livraison", "la tournee terminee ne se rouvre pas");
  assert.equal(commandeLue("o-c").status, "en_livraison");

  ensemencer();
  await poster("/api/routes/r-cours/cloturer");
  const close = await poster("/api/routes/r-cours/stops/s-o-c/correction", { status: "en_livraison", cause: "Je repasse" });
  assert.equal(close.res.status, 409, JSON.stringify(close.body));
  assert.equal((await tourneeLue("r-cours")).status, "cloturee");
  // Mais vers « Livre », oui : la verite du terrain passe encore.
  const livre = await poster("/api/routes/r-cours/stops/s-o-c/correction", { status: "livre", cause: "Livré juste avant la clôture" });
  assert.equal(livre.res.status, 200, JSON.stringify(livre.body));
  assert.equal((await tourneeLue("r-cours")).status, "cloturee");
});

test("M2 — une correction exige sa cause, un arret traite, et une commande qui n'est pas repartie", async () => {
  ensemencer();
  const sansCause = await poster("/api/routes/r-cours/stops/s-o-a/correction", { status: "absent", cause: "  " });
  assert.equal(sansCause.res.status, 400);
  const pasTraite = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "livre", cause: "x" });
  assert.equal(pasTraite.res.status, 409);
  await patcher("/api/routes/r-cours/stops/s-o-b", { status: "absent" });
  await creerTournee(["o-b"]);
  const repartie = await poster("/api/routes/r-cours/stops/s-o-b/correction", { status: "livre", cause: "x" });
  assert.equal(repartie.res.status, 409, JSON.stringify(repartie.body));
  assert.match(repartie.body.error, /autre tournée/);
  assert.equal(commandeLue("o-b").status, "a_reprogrammer");
});

// --- Decision 10 : « remis a… » ---------------------------------------------------

test("D10 — « remis à… » est garde sur l'arret et la commande, et se lit dans l'historique", async () => {
  ensemencer();
  const r = await patcher("/api/routes/r-cours/stops/s-o-b", { status: "livre", remisA: "  la voisine, Mme Martin  " });
  assert.equal(r.res.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stop.remisA, "la voisine, Mme Martin");
  assert.equal(r.body.order.remisA, "la voisine, Mme Martin", "la commande n'a pas gardé « remis à »");
  const liste = (await demander("/api/orders")).body;
  const o = (Array.isArray(liste) ? liste : liste.orders || []).find(item => item.id === "o-b");
  assert.equal(o.remisA, "la voisine, Mme Martin", "la liste des commandes perd « remis à »");
  assert.equal((await tourneeLue("r-cours")).stops.find(s => s.id === "s-o-b").remisA, "la voisine, Mme Martin");
  const h = (await demander("/api/historique")).body.find(item => item.details?.stopId === "s-o-b");
  assert.match(h.message, /remis à la voisine, Mme Martin/);
  // Temoin : sans note, rien.
  const sans = await patcher("/api/routes/r-cours/stops/s-o-c", { status: "livre" });
  assert.equal(sans.body.stop.remisA, "");
});

// --- Decision 7 : l'ancienne route -------------------------------------------------

test("D7 — POST /api/optimize-route n'existe plus, et ne reecrit plus la table des clients", async () => {
  ensemencer();
  const ordre = readDb().clients.map(c => c.id);
  const r = await poster("/api/optimize-route");
  assert.equal(r.res.status, 404, `l'ancienne route repond encore : ${r.res.status}`);
  assert.deepEqual(readDb().clients.map(c => c.id), ordre);
});

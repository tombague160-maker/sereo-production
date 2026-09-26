// Abonnements : pause, arret, changement de frequence, reprise (decision 8 de
// Thomas, 24/09 : recommandations de la chasse aux defauts acceptees).
//
// - Arreter ou mettre en pause un abonnement ANNULE ses commandes deja
//   generees et pas encore livrees, avec leurs rappels ; le stock qu'elles
//   avaient reserve revient au rayon. Avant : la commande de l'echeance restait
//   « planifiee », son rappel « a faire », et elle disparaissait de la page
//   Abonnements (une livraison fantome). Une commande deja en preparation ou
//   en livraison suit son cours : elle est nommee, pas annulee.
// - Apres un changement de frequence ou une reactivation, les echeances
//   PASSEES sont ignorees (date d'effet de l'abonnement). Avant : passer de 14
//   a 7 jours faisait ressortir 6 echeances « en retard » deja couvertes par
//   les livraisons de l'ancienne cadence, proposees a la generation (double
//   livraison) ; une reprise apres deux mois de pause, 2.
// - Une commande deja generee que la nouvelle cadence ne porte plus reste
//   visible dans le calendrier (avant : invisible, a cote des nouvelles
//   echeances -- une double livraison que rien ne montrait).

const { after, before, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-abos-suspendus-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const { app, closeStorage, defaultDb, readDb, writeDb } = require("../server");
const { jourParis } = require("../lib/jour-paris");
const { occurrenceDate } = require("../lib/subscriptions");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
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
  return { status: res.status, body };
}
const envoyer = (methode, chemin, corps = {}) => demander(chemin, {
  method: methode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps)
});

const AUJOURDHUI = jourParis();
/** AUJOURDHUI + n jours (n negatif : dans le passe). */
function jour(n) {
  const d = new Date(`${AUJOURDHUI}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const LIGNE = { stockId: "p1", code: "CH-L", nom: "Changes L", quantite: 2, prixUnitaire: 12, totalLigne: 24 };

function ensemencer(extra = {}) {
  writeDb({
    ...defaultDb(),
    stock: [{ id: "p1", code: "CH-L", nom: "Changes L", quantite: 100, tarif: 12 }],
    clients: [{ id: "c1", nom: "EHPAD Les Tilleuls", rue: "1 rue des Lilas", ville: "Dole", codePostal: "39100", crmStatus: "client_actif" }],
    ...extra
  }, { backup: false });
}

beforeEach(() => ensemencer());

async function creerAbonnement(changements = {}) {
  const r = await envoyer("POST", "/api/subscriptions", {
    clientId: "c1", products: [{ productId: "p1", quantite: 2 }], startDate: jour(10),
    frequency: { unit: "days", interval: 14 }, reminderDays: 3, status: "active", ...changements
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function generer(sub, date) {
  const r = await envoyer("POST", `/api/subscriptions/${sub.id}/orders`, { date });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.order;
}
const rayon = async () => (await demander("/api/stock")).body.find(p => p.id === "p1").quantityAvailable;
const commande = id => readDb().commandes.find(o => o.id === id);
const rappelsDe = id => readDb().relances.filter(r => r.commandeId === id).map(r => r.status);
const echeances = async subId => (await demander("/api/subscriptions")).body.occurrences.filter(o => o.subscriptionId === subId);

// ---------------------------------------------------------------------------
// Pause et arret : les commandes generees sont annulees
// ---------------------------------------------------------------------------

for (const [statut, motif] of [["paused", "abonnement mis en pause"], ["cancelled", "abonnement arrêté"]]) {
  test(`${statut} : les commandes generees non livrees sont annulees avec leurs rappels, le stock reserve revient`, async () => {
    const sub = await creerAbonnement();
    const planifiee = await generer(sub, jour(10));
    const confirmee = await generer(sub, jour(24));
    assert.equal((await envoyer("POST", `/api/planned-orders/${confirmee.id}/confirm`)).status, 200);
    assert.equal(await rayon(), 98, "prealable : la commande confirmee a sorti 2 du rayon");
    assert.deepEqual(rappelsDe(planifiee.id), ["a_faire"]);

    const r = await envoyer("PATCH", `/api/subscriptions/${sub.id}`, { status: statut });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, statut);

    assert.deepEqual([commande(planifiee.id).status, commande(confirmee.id).status], ["annulee", "annulee"],
      "avant : « planifiee » et « stock_a_verifier », livrables");
    assert.deepEqual(rappelsDe(planifiee.id), ["annule"], "avant : le rappel restait « a faire »");
    assert.equal(await rayon(), 100, "le stock reserve par la commande confirmee revient au rayon");
    const retour = readDb().stockMovements.find(m => m.orderId === confirmee.id && m.type === "entree");
    assert.ok(retour, "le retour au rayon est au journal des mouvements");
    assert.match(retour.reason, new RegExp(`\\(${motif}\\)$`));

    // La reponse dit ce qui a ete annule : l'ecran le rapporte.
    assert.deepEqual(r.body.suspension.annulees.map(o => o.numero).sort(), [planifiee.numero, confirmee.numero].sort());
    assert.deepEqual(r.body.suspension.gardees, []);
    // L'abonnement ne porte pas le compte rendu.
    assert.equal("suspension" in readDb().subscriptions[0], false);
  });
}

test("pause : une commande deja en preparation suit son cours, nommee dans la reponse", async () => {
  const sub = await creerAbonnement();
  const o = await generer(sub, jour(10));
  await envoyer("POST", `/api/planned-orders/${o.id}/confirm`);
  assert.equal((await envoyer("POST", `/api/orders/${o.id}/start-preparation`)).status, 200);
  const r = await envoyer("PATCH", `/api/subscriptions/${sub.id}`, { status: "paused" });
  assert.equal(r.status, 200);
  assert.equal(commande(o.id).status, "en_preparation");
  assert.equal(await rayon(), 98, "son stock reste sorti du rayon");
  assert.deepEqual(r.body.suspension.annulees, []);
  assert.deepEqual(r.body.suspension.gardees.map(g => [g.numero, g.status]), [[o.numero, "en_preparation"]]);
});

test("temoin : une commande livree de l'abonnement n'est jamais touchee", async () => {
  const sub = await creerAbonnement();
  const db = readDb();
  db.commandes.push({ id: "o-livree", numero: "CMD-2026-500", clientId: "c1", clientName: "EHPAD Les Tilleuls", status: "livre",
    deliveredAt: `${jour(-4)}T09:00:00Z`, dateCommande: jour(-4), deliveryDate: jour(-4), subscriptionId: sub.id, subscriptionDate: jour(-4), products: [LIGNE] });
  writeDb(db, { backup: false });
  await envoyer("PATCH", `/api/subscriptions/${sub.id}`, { status: "cancelled" });
  assert.equal(commande("o-livree").status, "livre");
});

test("pause puis reprise avant l'echeance : l'echeance annulee revient, et se genere de nouveau", async () => {
  const sub = await creerAbonnement();
  const o = await generer(sub, jour(10));
  await envoyer("PATCH", `/api/subscriptions/${sub.id}`, { status: "paused" });
  await envoyer("PATCH", `/api/subscriptions/${sub.id}`, { status: "active" });
  const e = (await echeances(sub.id)).find(x => x.date === jour(10));
  assert.ok(e, "l'echeance est de nouveau au calendrier");
  assert.equal(e.orderId, null, "a generer : la commande annulee par la pause ne la bloque pas");
  const r = await envoyer("POST", `/api/subscriptions/${sub.id}/orders`, { date: jour(10) });
  assert.equal(r.status, 201);
  assert.notEqual(r.body.order.id, o.id, "une nouvelle commande");
  assert.equal(commande(o.id).status, "annulee", "l'ancienne reste annulee (historique)");
});

// ---------------------------------------------------------------------------
// Changement de frequence, reprise : les echeances passees sont ignorees
// ---------------------------------------------------------------------------

/** Un abonnement de 14 jours commence il y a `recul` jours, chaque echeance passee livree. */
function abonnementLivre({ recul = 84, interval = 14 } = {}) {
  const sub = { id: "sub-1", clientId: "c1", products: [LIGNE], startDate: jour(-recul), frequency: { unit: "days", interval }, reminderDays: 2, status: "active", notes: "" };
  const livrees = [];
  for (let n = -recul, i = 0; n < 0; n += interval, i++) {
    livrees.push({ id: `o-${i}`, numero: `CMD-2026-1${String(i).padStart(2, "0")}`, clientId: "c1", clientName: "EHPAD Les Tilleuls", status: "livre",
      deliveredAt: `${jour(n)}T09:00:00Z`, deliveryDate: jour(n), dateCommande: jour(n), subscriptionId: "sub-1", subscriptionDate: jour(n), products: [LIGNE] });
  }
  ensemencer({ subscriptions: [sub], commandes: livrees });
  return sub;
}

test("14 jours -> 7 jours : aucune fausse echeance « en retard », la premiere est aujourd'hui ou apres", async () => {
  abonnementLivre();
  assert.equal((await echeances("sub-1")).filter(o => o.overdue).length, 0, "prealable : rien en retard");
  const r = await envoyer("PATCH", "/api/subscriptions/sub-1", { frequency: { unit: "days", interval: 7 } });
  assert.equal(r.status, 200);
  const apres = await echeances("sub-1");
  assert.deepEqual(apres.filter(o => o.overdue).map(o => o.date), [], "avant : 6 echeances en retard (celles de l'ancienne cadence)");
  assert.equal(r.body.effectiveFrom, AUJOURDHUI, "la date d'effet est le jour du changement");
  assert.ok(apres.every(o => o.date >= AUJOURDHUI));
  const ops = (await demander("/api/operations")).body;
  assert.equal(ops.subscriptions.filter(o => o.overdue && !o.orderId).length, 0, "l'alerte du tableau de bord ne les compte pas");
  // Une echeance passee de la nouvelle cadence ne se genere pas par l'API non plus.
  const passee = await envoyer("POST", "/api/subscriptions/sub-1/orders", { date: jour(-7) });
  assert.equal(passee.status, 400);
});

test("reprise apres deux mois de pause : les echeances de la pause ne ressortent pas « en retard »", async () => {
  // Mensuel depuis ~4 mois : les deux premieres echeances livrees, puis la pause.
  const sub = { id: "sub-1", clientId: "c1", products: [LIGNE], startDate: jour(-125), frequency: { unit: "months", interval: 1 }, reminderDays: 2, status: "paused", notes: "" };
  const dates = [0, 1, 2, 3].map(i => occurrenceDate(sub, i));
  assert.ok(dates[3] < AUJOURDHUI, "prealable : quatre echeances passees");
  ensemencer({
    subscriptions: [sub],
    commandes: dates.slice(0, 2).map((d, i) => ({ id: `o-${i}`, numero: `CMD-2026-20${i}`, clientId: "c1", clientName: "EHPAD Les Tilleuls", status: "livre",
      deliveredAt: `${d}T09:00:00Z`, deliveryDate: d, dateCommande: d, subscriptionId: "sub-1", subscriptionDate: d, products: [LIGNE] }))
  });
  const r = await envoyer("PATCH", "/api/subscriptions/sub-1", { status: "active" });
  assert.equal(r.status, 200);
  assert.deepEqual((await echeances("sub-1")).filter(o => o.overdue).map(o => o.date), [], "avant : les echeances echues pendant la pause");
});

test("changement de cadence : une commande deja generee hors de la nouvelle cadence reste au calendrier", async () => {
  const sub = await creerAbonnement({ startDate: jour(1) });
  const o = await generer(sub, jour(15));
  const r = await envoyer("PATCH", `/api/subscriptions/${sub.id}`, { frequency: { unit: "days", interval: 10 } });
  assert.equal(r.status, 200);
  const e = await echeances(sub.id);
  assert.deepEqual(e.slice(0, 4).map(x => [x.date, x.orderId]), [
    [jour(1), null], [jour(11), null], [jour(15), o.id], [jour(21), null]
  ], "avant : la commande du 15 n'apparaissait plus, a cote des echeances du 11 et du 21");
  assert.equal(commande(o.id).status, "planifiee", "elle n'est pas annulee : c'est au bureau de choisir");
});

test("temoin : une modification sans changement de frequence ni reprise ne pose pas de date d'effet et n'annule rien", async () => {
  const sub = await creerAbonnement();
  const o = await generer(sub, jour(10));
  const r = await envoyer("PATCH", `/api/subscriptions/${sub.id}`, { notes: "Sonner au portail", effectiveFrom: "2020-01-01" });
  assert.equal(r.status, 200);
  assert.equal(r.body.effectiveFrom, undefined, "la date d'effet ne vient jamais de la requete");
  assert.equal(r.body.suspension, undefined);
  assert.equal(commande(o.id).status, "planifiee");
});

test("temoin : un abonnement cree avec une premiere date passee montre ses echeances en retard, comme avant", async () => {
  const sub = await creerAbonnement({ startDate: jour(-28) });
  const retard = (await echeances(sub.id)).filter(o => o.overdue).map(o => o.date);
  assert.deepEqual(retard, [jour(-28), jour(-14)]);
});

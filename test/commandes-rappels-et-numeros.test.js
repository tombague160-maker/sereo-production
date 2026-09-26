// Commandes : rappels, numeros, conversions (chasse aux defauts du 24/09,
// lot « stock et abonnements ») -- la part SERVEUR, sur un vrai serveur
// ensemence (SQLite).
//
// 1. Une commande planifiee ANNULEE gardait son rappel « Confirmer la
//    livraison planifiee » a faire : il remontait dans les relances et le
//    compteur du tableau de bord -- on risquait d'appeler un client pour
//    confirmer une livraison annulee.
// 2. Apres une purge, la premiere commande reprenait le numero ET l'id de la
//    premiere commande purgee (CMD-2026-001, cmd-cmd-2026-001) : un rappel
//    survivant pointait alors sur la commande d'un autre client. Un numero
//    attribue ne l'est plus jamais deux fois.
// 3. « Prospects convertis ce mois » comptait un client ancien (deja livre)
//    qui passait une commande chez lui : seul un PROSPECT se convertit.

const { after, before, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-rappels-numeros-"));
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

const ANNEE = jourParis().slice(0, 4);

function ensemencer(extra = {}) {
  writeDb({
    ...defaultDb(),
    stock: [{ id: "p1", code: "CH-L", nom: "Changes L", quantite: 100, tarif: 12 }],
    clients: [
      { id: "cA", nom: "Client A", rue: "1 rue A", ville: "Dole", codePostal: "39100", crmStatus: "client_actif" },
      { id: "cB", nom: "Client B", rue: "2 rue B", ville: "Dole", codePostal: "39100", crmStatus: "client_actif" }
    ],
    ...extra
  }, { backup: false });
}

beforeEach(() => ensemencer());

const rappelsDe = async commandeId => (await demander("/api/crm/relances")).body.filter(r => r.commandeId === commandeId);

// ---------------------------------------------------------------------------
// 1. Commande annulee : rappel annule
// ---------------------------------------------------------------------------

test("planifiee annulee : son rappel « Confirmer la livraison planifiée » est annulé, le client n'a plus de rappel", async () => {
  const cree = await envoyer("POST", "/api/planned-orders", { clientId: "cA", products: [{ productId: "p1", quantite: 2 }], deliveryDate: "2026-11-20" });
  assert.equal(cree.status, 201);
  const id = cree.body.order.id;
  assert.deepEqual((await rappelsDe(id)).map(r => r.status), ["a_faire"], "prealable : le rappel est cree avec la commande");

  const annulee = await envoyer("PATCH", `/api/planned-orders/${id}`, { status: "annulee" });
  assert.equal(annulee.status, 200);
  assert.deepEqual((await rappelsDe(id)).map(r => [r.status, r.resultat]), [["annule", "Commande annulée"]],
    "avant : le rappel restait « a_faire »");
  const client = readDb().clients.find(c => c.id === "cA");
  assert.equal(client.nextReminderDate, "", "le prochain rappel du client ne vise plus la commande annulee");
});

test("commande annulee depuis l'ecran Commandes (PATCH /api/orders/:id) : meme regle", async () => {
  const cree = await envoyer("POST", "/api/planned-orders", { clientId: "cA", products: [{ productId: "p1", quantite: 2 }], deliveryDate: "2026-11-20" });
  const id = cree.body.order.id;
  const annulee = await envoyer("PATCH", `/api/orders/${id}`, { status: "annulee" });
  assert.equal(annulee.status, 200);
  assert.deepEqual((await rappelsDe(id)).map(r => r.status), ["annule"]);
});

test("seuls les rappels de la commande sont annules : un autre rappel du client reste a faire et devient son prochain", async () => {
  const autre = await envoyer("POST", "/api/crm/relances", { clientId: "cA", datePrevue: "2026-12-01", motif: "Proposer les alèses" });
  assert.equal(autre.status, 201);
  const cree = await envoyer("POST", "/api/planned-orders", { clientId: "cA", products: [{ productId: "p1", quantite: 2 }], deliveryDate: "2026-11-20" });
  await envoyer("PATCH", `/api/planned-orders/${cree.body.order.id}`, { status: "annulee" });
  const rappels = (await demander("/api/crm/relances")).body.filter(r => r.clientId === "cA");
  assert.deepEqual(rappels.map(r => [r.motif, r.status]).sort(), [["Confirmer la livraison planifiee", "annule"], ["Proposer les alèses", "a_faire"]]);
  assert.equal(readDb().clients.find(c => c.id === "cA").nextReminderDate, "2026-12-01");
});

// ---------------------------------------------------------------------------
// 2. Numeros jamais reutilises apres une purge
// ---------------------------------------------------------------------------

test("apres une purge, la commande suivante prend un numero NEUF (jamais celui d'une commande purgee)", async () => {
  const a = await envoyer("POST", "/api/planned-orders", { clientId: "cA", products: [{ productId: "p1", quantite: 1 }], deliveryDate: "2026-12-10" });
  const b = await envoyer("POST", "/api/customer-orders", { clientId: "cB", products: [{ productId: "p1", quantite: 1 }] });
  assert.equal(a.body.order.numero, `CMD-${ANNEE}-001`);
  assert.equal(b.body.numero, `CMD-${ANNEE}-002`);
  const purge = await envoyer("POST", "/api/orders/purge");
  assert.equal(purge.status, 200);

  const c = await envoyer("POST", "/api/customer-orders", { client: { nom: "Client C", telephone: "0600000077", ville: "Dole", codePostal: "39100" }, products: [{ productId: "p1", quantite: 1 }] });
  assert.equal(c.status, 201);
  assert.equal(c.body.numero, `CMD-${ANNEE}-003`, `avant : CMD-${ANNEE}-001, le numero de la commande A purgee`);
  assert.notEqual(c.body.id, a.body.order.id, "l'identifiant n'est pas celui d'une commande purgee");

  // Le rappel de A (conserve par la purge) ne pointe sur aucune commande vivante.
  const rappelA = (await demander("/api/crm/relances")).body.find(r => r.commandeId === a.body.order.id);
  assert.ok(rappelA, "prealable : le rappel de A a survecu a la purge");
  assert.equal(readDb().commandes.some(o => o.id === rappelA.commandeId), false, "avant : il visait la commande du client C");
});

test("deux purges de suite, et le compteur continu : aucun numero ne revient", async () => {
  await envoyer("PATCH", "/api/settings/order-numbering", { resetAnnually: false });
  const premiere = await envoyer("POST", "/api/customer-orders", { clientId: "cA", products: [{ productId: "p1", quantite: 1 }] });
  assert.equal(premiere.body.numero, "CMD-00001");
  await envoyer("POST", "/api/orders/purge");
  // La purge vide aussi les clients : une nouvelle fiche.
  const nouveau = { client: { nom: "Client D", telephone: "0600000078", ville: "Dole", codePostal: "39100" }, products: [{ productId: "p1", quantite: 1 }] };
  const deuxieme = await envoyer("POST", "/api/customer-orders", nouveau);
  assert.equal(deuxieme.body.numero, "CMD-00002");
  await envoyer("POST", "/api/orders/purge");
  const troisieme = await envoyer("POST", "/api/customer-orders", { ...nouveau, client: { ...nouveau.client, telephone: "0600000079" } });
  assert.equal(troisieme.body.numero, "CMD-00003");
});

test("temoin : sans purge, la numerotation suit la plus grande existante, comme avant", async () => {
  ensemencer({
    commandes: [{ id: "o-9", numero: `CMD-${ANNEE}-009`, clientId: "cA", clientName: "Client A", status: "livre", dateCommande: `${ANNEE}-02-01`, products: [{ code: "CH-L", nom: "Changes L", quantite: 1 }] }]
  });
  const r = await envoyer("POST", "/api/customer-orders", { clientId: "cB", products: [{ productId: "p1", quantite: 1 }] });
  assert.equal(r.body.numero, `CMD-${ANNEE}-010`);
});

// ---------------------------------------------------------------------------
// 3. « Prospects convertis ce mois » : seulement des prospects
// ---------------------------------------------------------------------------

async function convertis() {
  return (await demander("/api/statistics")).body.convertedProspectsMonth;
}

test("un client deja livre qui commande chez lui n'est pas un prospect converti", async () => {
  ensemencer({
    clients: [{ id: "c-ancien", nom: "Pharmacie Ancienne", rue: "1 r", ville: "Dole", codePostal: "39100", crmStatus: "client_actif", firstContactDate: "2024-03-01" }],
    commandes: [{ id: "o-old", numero: "CMD-2025-001", clientId: "c-ancien", clientName: "Pharmacie Ancienne", status: "livre", deliveredAt: "2025-11-10T10:00:00Z", dateCommande: "2025-11-10", products: [{ code: "CH-L", nom: "Changes L", quantite: 1 }] }]
  });
  assert.equal(await convertis(), 0);
  const r = await envoyer("POST", "/api/customer-orders", { clientId: "c-ancien", products: [{ productId: "p1", quantite: 1 }] });
  assert.equal(r.status, 201);
  assert.equal(await convertis(), 0, "avant : 1");
  assert.equal(readDb().clients.find(c => c.id === "c-ancien").crmConvertedAt || "", "");
});

test("un client deja livre qui confirme une planifiee n'est pas un prospect converti", async () => {
  ensemencer({
    clients: [{ id: "c-ancien", nom: "Pharmacie Ancienne", rue: "1 r", ville: "Dole", codePostal: "39100", crmStatus: "client_actif" }],
    commandes: [{ id: "o-old", numero: "CMD-2025-001", clientId: "c-ancien", clientName: "Pharmacie Ancienne", status: "livre", deliveredAt: "2025-11-10T10:00:00Z", dateCommande: "2025-11-10", products: [{ code: "CH-L", nom: "Changes L", quantite: 1 }] }]
  });
  const p = await envoyer("POST", "/api/planned-orders", { clientId: "c-ancien", products: [{ productId: "p1", quantite: 1 }], deliveryDate: "2026-12-10" });
  await envoyer("POST", `/api/planned-orders/${p.body.order.id}/confirm`);
  assert.equal(await convertis(), 0);
});

test("temoin : un prospect (aucune commande, ou seulement une annulee) qui commande est converti", async () => {
  ensemencer({
    clients: [
      { id: "c-pro", nom: "Cabinet Neuf", rue: "1 r", ville: "Dole", codePostal: "39100", crmStatus: "prospect" },
      { id: "c-pro2", nom: "SSIAD Neuf", rue: "2 r", ville: "Dole", codePostal: "39100", crmStatus: "prospect" }
    ],
    commandes: [{ id: "o-ann", numero: "CMD-2026-050", clientId: "c-pro2", clientName: "SSIAD Neuf", status: "annulee", dateCommande: "2026-08-10", products: [{ code: "CH-L", nom: "Changes L", quantite: 1 }] }]
  });
  await envoyer("POST", "/api/customer-orders", { clientId: "c-pro", products: [{ productId: "p1", quantite: 1 }] });
  const p = await envoyer("POST", "/api/planned-orders", { clientId: "c-pro2", products: [{ productId: "p1", quantite: 1 }], deliveryDate: "2026-12-10" });
  await envoyer("POST", `/api/planned-orders/${p.body.order.id}/confirm`);
  assert.equal(await convertis(), 2);
});

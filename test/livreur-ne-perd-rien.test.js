// Lot 1 de l'audit « localisation, carte, tournees » (23/09) : LE LIVREUR NE
// PERD PLUS RIEN -- la part SERVEUR, sur un vrai serveur ensemence.
//
// Ce que chaque cas garde, et le defaut mesure par l'audit (commit 019788c) :
//
//   C1  Un absent ou un probleme etait une IMPASSE : la commande passait en
//       `probleme_livraison`, qu'aucune liste de commandes pretes ne propose et
//       qu'aucun bouton ne fait sortir ; son stock restait reserve pour
//       toujours. Decision retenue : retour AUTOMATIQUE, marque « A
//       reprogrammer ». Les commandes DEJA bloquees en base reviennent aussi.
//   M1  Replanifier une commande en echec la CLONAIT : l'originale restait
//       livrable (double livraison), le clone reservait le stock une seconde
//       fois. Depuis C1, une commande en echec revient d'elle-meme : la
//       replanification lui est refusee.
//   M6  La livraison etait datee de son ARRIVEE au serveur, pas du geste.
//   H1  La page met desormais en file toute ecriture dont l'envoi echoue --
//       delai depasse compris, ou le serveur a pu l'appliquer. Une cle
//       d'idempotence (X-Sereo-Geste) empeche le renvoi de l'appliquer deux fois.
//   H2  Sans SEREO_AUTH_SESSION_SECRET, chaque redemarrage invalidait toutes
//       les sessions : le secret est desormais garde dans le dossier de donnees.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-lot1-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const { app, closeStorage, defaultDb, readDb, writeDb, createRoute, horodatageDuGeste, _withWriteLockForTest } = require("../server");

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

function patcherArret(routeId, stopId, corps, entetes = {}) {
  return demander(`/api/routes/${routeId}/stops/${stopId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...entetes },
    body: JSON.stringify(corps)
  });
}

const HIER = "2026-09-22";
const DEMAIN = "2026-09-24";

function commande(id, nom, status, extra = {}) {
  return {
    id, clientId: `c-${id}`, clientName: nom, status,
    address: `${id} rue des Lilas`, city: "Dole", postalCode: "39100", sector: "Dole",
    lat: 47.09, lng: 5.49, deliveryDate: HIER, dateCommande: HIER,
    notes: "Code portail 4521B",
    products: [{ code: "A1", nom: "Alèses", quantite: 4 }],
    ...extra
  };
}

function arret(o, status) {
  return {
    id: `s-${o.id}`, routeId: "r-hier", orderId: o.id, clientId: o.clientId, clientName: o.clientName,
    address: o.address, city: o.city, postalCode: o.postalCode, sector: o.sector,
    lat: o.lat, lng: o.lng, status, products: o.products, notes: o.notes
  };
}

/**
 * La tournee d'hier, EN COURS : A et B a livrer, C deja livre. `bloquee` : une
 * commande restee en probleme_livraison AVANT ce lot. A, B et `bloquee`
 * reservent 4 chacune (deduites du rayon a la preparation) ; 12 restent en rayon.
 */
function ensemencer() {
  const a = commande("o-a", "EHPAD Les Tilleuls", "en_livraison", { stockReservedAt: `${HIER}T07:00:00Z`, routeId: "r-hier" });
  const b = commande("o-b", "Pharmacie de la Gare", "en_livraison", { stockReservedAt: `${HIER}T07:00:00Z`, routeId: "r-hier" });
  const c = commande("o-c", "SSIAD Haute Vallée", "livre", { deliveredAt: `${HIER}T09:00:00Z`, routeId: "r-hier" });
  const bloquee = commande("o-vieille", "Cabinet Dupont", "probleme_livraison", { deliveryStatus: "absent", stockReservedAt: "2026-09-10T07:00:00Z", deliveryDate: "2026-09-10" });
  writeDb({
    ...defaultDb(),
    clients: [a, b, c, bloquee].map(o => ({ id: o.clientId, nom: o.clientName, ville: "Dole", statut: "en_cours" })),
    commandes: [a, b, c, bloquee],
    routes: [{
      id: "r-hier", sector: "Dole", status: "en_livraison", deliveryDate: HIER,
      startedAt: `${HIER}T08:00:00Z`,
      selectedOrderIds: [a.id, b.id, c.id],
      stops: [arret(a, "en_livraison"), arret(b, "en_livraison"), arret(c, "livre")]
    }],
    stock: [{ id: "p1", code: "A1", nom: "Alèses", quantite: 12 }]
  }, { backup: false });
}

async function reserve() {
  const { body } = await demander("/api/stock");
  return body.find(p => p.id === "p1").quantityReserved;
}

// --- C1 -----------------------------------------------------------------------

for (const [geste, cause] of [["absent", "absent"], ["probleme", "probleme"]]) {
  test(`C1 — « ${geste} » : la commande REVIENT a planifier, marquee « A reprogrammer »`, async () => {
    ensemencer();
    const { res, body } = await patcherArret("r-hier", "s-o-a", { status: geste });
    assert.equal(res.status, 200);
    assert.equal(body.order.status, "a_reprogrammer", "la commande reste bloquee hors des commandes pretes");
    assert.equal(body.order.deliveryStatus, cause, "la cause de l'echec est perdue");

    // Elle est proposee a une nouvelle tournee, alors que celle d'hier n'est
    // pas finie (B reste a livrer) et qu'on planifie pour DEMAIN.
    const db = readDb();
    const o = db.commandes.find(x => x.id === "o-a");
    const plan = { ordered: [o], departure: null, arrival: null };
    const tournee = createRoute(db, { orderIds: ["o-a"], deliveryDate: DEMAIN, plan });
    assert.deepEqual(tournee.stops.map(s => s.orderId), ["o-a"]);
  });
}

test("C1 — le stock : reserve pour la relivraison, ni libere ni reserve deux fois, consomme a la livraison", async () => {
  ensemencer();
  assert.equal(await reserve(), 12, "prealable : A, B et la commande bloquee reservent 4 chacune");
  await patcherArret("r-hier", "s-o-a", { status: "absent" });
  assert.equal(await reserve(), 12, "l'absent a change la reservation");
  assert.equal(readDb().stock[0].quantite, 12, "l'absent a touche au stock en rayon");

  // Relivraison le lendemain : nouvelle tournee, depart, « Livre ».
  const creee = await demander("/api/routes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderIds: ["o-a"], deliveryDate: DEMAIN })
  });
  assert.equal(creee.res.status, 201, JSON.stringify(creee.body));
  const depart = await demander(`/api/routes/${creee.body.id}/start`, { method: "POST" });
  assert.equal(depart.res.status, 200, JSON.stringify(depart.body));
  assert.equal(await reserve(), 12, "le depart de la nouvelle tournee a reserve une seconde fois");
  const livre = await patcherArret(creee.body.id, creee.body.stops[0].id, { status: "livre" });
  assert.equal(livre.body.order.status, "livre");
  assert.equal(await reserve(), 8, "la livraison n'a pas consomme la reservation de A (restent B et la bloquee)");
  assert.equal(readDb().stock[0].quantite, 12, "la livraison a touche au stock en rayon");
});

test("C1 — une commande DEJA bloquee en probleme_livraison revient aussi, quel que soit son jour", async () => {
  ensemencer();
  const creee = await demander("/api/routes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderIds: ["o-vieille"], deliveryDate: DEMAIN })
  });
  assert.equal(creee.res.status, 201, `la commande bloquee n'entre pas dans une tournee : ${JSON.stringify(creee.body)}`);
  const depart = await demander(`/api/routes/${creee.body.id}/start`, { method: "POST" });
  assert.equal(depart.res.status, 200);
  assert.equal(readDb().commandes.find(o => o.id === "o-vieille").status, "en_livraison");
});

test("C1 — temoin : une commande PRETE d'un autre jour reste filtree par la date", async () => {
  // Sans ce temoin, le cas precedent passerait aussi avec un filtre de date
  // simplement retire pour tout le monde.
  ensemencer();
  const db = readDb();
  db.commandes.push(commande("o-pret", "Clinique du Doubs", "pret_livraison", { deliveryDate: HIER }));
  writeDb(db, { backup: false });
  const creee = await demander("/api/routes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderIds: ["o-pret"], deliveryDate: DEMAIN })
  });
  assert.equal(creee.res.status, 400);
});

// --- M1 -----------------------------------------------------------------------

test("M1 — une commande en echec ne se replanifie plus en clone ; une commande livree, si", async () => {
  ensemencer();
  await patcherArret("r-hier", "s-o-a", { status: "absent" });
  const avant = readDb().commandes.length;
  const refus = await demander("/api/orders/o-a/replan", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deliveryDate: DEMAIN })
  });
  assert.equal(refus.res.status, 400, "le clone d'une commande qui revient deja a ete cree");
  assert.match(refus.body.error, /Commandes prêtes à livrer/);
  assert.equal(readDb().commandes.length, avant, "une commande a ete creee malgre le refus");

  // Temoin positif : la « suite » d'une commande livree reste permise.
  const suite = await demander("/api/orders/o-c/replan", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deliveryDate: DEMAIN })
  });
  assert.equal(suite.res.status, 201, JSON.stringify(suite.body));
});

// --- M6 -----------------------------------------------------------------------

test("M6 — la livraison est datee de l'heure du GESTE, envoyee par le telephone", async () => {
  ensemencer();
  const geste = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const { body } = await patcherArret("r-hier", "s-o-a", { status: "livre", faitLe: geste });
  assert.equal(body.order.deliveredAt, geste, "la commande est datee de l'arrivee au serveur");
  assert.equal(body.stop.deliveredAt, geste, "l'arret est date de l'arrivee au serveur");
});

test("M6 — l'heure du telephone est BORNEE : ni futur, ni trop vieille, ni avant le depart", () => {
  const maintenant = new Date("2026-09-23T12:00:00Z");
  const h = (brut, plancher = null) => horodatageDuGeste(brut, { maintenant, plancher });
  assert.equal(h("2026-09-23T09:10:00Z"), "2026-09-23T09:10:00.000Z", "une heure plausible est gardee");
  assert.equal(h("2026-09-23T12:03:00Z"), "2026-09-23T12:00:00.000Z", "une petite avance d'horloge est ramenee a maintenant");
  assert.equal(h("2026-09-24T12:00:00Z"), "2026-09-23T12:00:00.000Z", "une heure dans le futur est acceptee");
  assert.equal(h("2026-09-01T12:00:00Z"), "2026-09-23T12:00:00.000Z", "une heure de trois semaines est acceptee");
  assert.equal(h("2026-09-17T12:00:00Z"), "2026-09-17T12:00:00.000Z", "six jours : encore plausible");
  assert.equal(h("n'importe quoi"), "2026-09-23T12:00:00.000Z");
  assert.equal(h(undefined), "2026-09-23T12:00:00.000Z");
  assert.equal(h("2026-09-23T07:00:00Z", "2026-09-23T08:00:00Z"), "2026-09-23T08:00:00.000Z", "une heure avant le depart de la tournee est gardee");
});

// --- H1 : idempotence ---------------------------------------------------------

test("H1 — un geste RENVOYE avec la meme cle n'est applique qu'une fois", async () => {
  ensemencer();
  const cle = "geste-0123456789abcdef";
  const corps = {
    clientId: "c-o-a", clientName: "EHPAD Les Tilleuls",
    products: [{ code: "A1", nom: "Alèses", quantite: 1 }]
  };
  const envoyer = () => demander("/api/customer-orders", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Sereo-Geste": cle },
    body: JSON.stringify(corps)
  });
  const avant = readDb().commandes.length;
  const premier = await envoyer();
  assert.ok(premier.res.status < 300, `prealable : la commande terrain doit etre creee (${premier.res.status} ${JSON.stringify(premier.body)})`);
  assert.equal(readDb().commandes.length, avant + 1);
  const second = await envoyer();
  assert.equal(readDb().commandes.length, avant + 1, "le renvoi a cree la commande une seconde fois");
  assert.equal(second.res.status, premier.res.status, "le renvoi ne rend pas le statut de la premiere reponse");
  assert.equal(second.res.headers.get("x-sereo-geste-rejoue"), "1");

  // Temoin : sans cle, deux envois font deux commandes (le banc distingue).
  const sansCle = () => demander("/api/customer-orders", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps)
  });
  await sansCle(); await sansCle();
  assert.equal(readDb().commandes.length, avant + 3);
});

test("H1 — deux envois SIMULTANES de la meme cle : un seul est applique", async () => {
  ensemencer();
  const cle = "geste-simultane-0001";
  const corps = { clientId: "c-o-b", clientName: "Pharmacie de la Gare", products: [{ code: "A1", nom: "Alèses", quantite: 1 }] };
  const avant = readDb().commandes.length;
  const envois = await Promise.all([1, 2, 3].map(() => demander("/api/customer-orders", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Sereo-Geste": cle }, body: JSON.stringify(corps)
  })));
  assert.equal(readDb().commandes.length, avant + 1, "les envois simultanes ont cree plusieurs commandes");
  assert.equal(new Set(envois.map(e => e.res.status)).size, 1, "les trois envois n'ont pas le meme statut");
});

test("H1 — un client qui ABANDONNE sa requete (delai) puis la renvoie : un seul geste applique", async () => {
  // Relecture adverse du lot 1 : la cle se liberait a la FERMETURE de la
  // connexion, pas a la fin du traitement. Le client coupe a 10 s pendant que
  // le serveur attend son verrou d'ecriture ; le renvoi arrive, ne trouve ni
  // cle enregistree ni traitement en cours, et s'applique a son tour.
  ensemencer();
  const cle = "geste-abandon-0000001";
  const corps = { clientId: "c-o-a", clientName: "EHPAD Les Tilleuls", products: [{ code: "A1", nom: "Alèses", quantite: 1 }] };
  const options = signal => ({
    method: "POST", headers: { "Content-Type": "application/json", "X-Sereo-Geste": cle }, body: JSON.stringify(corps), signal
  });
  const avant = readDb().commandes.length;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Le verrou d'ecriture est tenu (un import, une autre ecriture lente).
  let relacher;
  const tenu = _withWriteLockForTest(() => new Promise(resolve => { relacher = resolve; }));
  const ac = new AbortController();
  const premier = fetch(`${baseUrl}/api/customer-orders`, options(ac.signal)).then(() => "repondu", () => "abandonne");
  await pause(200);          // arrive au serveur, attend le verrou
  ac.abort();                // le telephone abandonne : la connexion se ferme
  await pause(200);
  const second = demander("/api/customer-orders", options(undefined));
  await pause(150);
  relacher();
  await tenu;
  const renvoi = await second;

  assert.equal(await premier, "abandonne", "prealable : le premier envoi devait etre abandonne par le client");
  assert.equal(readDb().commandes.length, avant + 1, "le renvoi d'un envoi abandonne a cree la commande une seconde fois");
  assert.equal(renvoi.res.status, 201);
  assert.equal(renvoi.res.headers.get("x-sereo-geste-rejoue"), "1", "le renvoi n'a pas ete reconnu comme deja fait");
});

// --- H2 : le secret de session survit au redemarrage -----------------------------

function signatureDeSession(dossier, env = {}) {
  // Un processus neuf = un demarrage du serveur. issuedAt fixe : la seule
  // variable de la signature est alors le secret.
  const script = `
    const s = require(${JSON.stringify(path.join(__dirname, "..", "server.js"))});
    process.stdout.write(s._createAccessSessionValueForTest(1700000000000));
    s.closeStorage();
    process.exit(0);
  `;
  return execFileSync(process.execPath, ["-e", script], {
    env: {
      ...process.env,
      SEREO_STORAGE: "sqlite",
      SEREO_SQLITE_PATH: path.join(dossier, "sereo.sqlite"),
      SEREO_DB_PATH: path.join(dossier, "db.json"),
      SEREO_BACKUP_DIR: path.join(dossier, "backups"),
      SEREO_UPLOAD_DIR: path.join(dossier, "imports"),
      SEREO_AUTH_USER: "admin", SEREO_AUTH_PASSWORD: "mot-de-passe-long-de-test",
      SEREO_AUTH_SESSION_SECRET: "",
      SEREO_SKIP_RELEASE_FETCH: "1",
      ...env
    },
    encoding: "utf8"
  });
}

test("H2 — sans secret fixe, une session reste valide apres un redemarrage", () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-secret-"));
  try {
    const premier = signatureDeSession(dossier);
    const second = signatureDeSession(dossier);
    assert.ok(premier.includes("."), `prealable : pas de valeur de session (${premier})`);
    assert.equal(second, premier, "le redemarrage a change le secret : toutes les sessions sont mortes");
    const fichier = path.join(dossier, "session-secret");
    assert.ok(fs.existsSync(fichier), "le secret n'est pas garde dans le dossier de donnees");
    // Temoin : un AUTRE dossier de donnees donne un autre secret -- la
    // signature depend bien du fichier, pas d'une constante.
    const autre = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-secret-"));
    try {
      assert.notEqual(signatureDeSession(autre), premier);
    } finally {
      fs.rmSync(autre, { recursive: true, force: true });
    }
    // La variable d'environnement reste prioritaire.
    const parEnv = signatureDeSession(dossier, { SEREO_AUTH_SESSION_SECRET: "secret-fixe-de-test-assez-long-0123456789" });
    assert.notEqual(parEnv, premier);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

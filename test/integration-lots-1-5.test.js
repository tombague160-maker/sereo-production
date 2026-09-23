// Integration des lots 1 et 5 de l'audit geo (23/09) : L'ECRITURE CIBLEE DU
// LOT 5 ECRIT CE QUE LE LOT 1 AJOUTE.
//
// Le lot 5 n'ecrit plus toute la base a chaque geste : il compare chaque ligne
// a l'empreinte de ce que la base contient, et n'ecrit que ce qui change. Le
// lot 1, parti du meme main, ajoute au geste d'arret ce que le lot 5 n'a
// jamais vu : le statut `a_reprogrammer` (un absent revient a planifier),
// l'heure REELLE du geste (`faitLe` -> deliveredAt), `updatedAt` de la tournee,
// et la table `gestes_recus` (cles d'idempotence), hors de readDb/writeDb.
//
// Une ecriture ciblee qui saute une ligne changee perd ces champs EN BASE,
// sans que la reponse du geste (calculee en memoire) le montre. Ce banc relit
// donc le FICHIER par une seconde connexion, independante du cache du store :
// ce qu'un redemarrage relirait.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-lots-1-5-"));
const SQLITE = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = SQLITE;
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const { app, closeStorage, defaultDb, readDb, writeDb, _flushPendingBackup } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await _flushPendingBackup();
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function patcherArret(stopId, corps, entetes = {}) {
  const res = await fetch(`${baseUrl}/api/routes/r-1/stops/${stopId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: baseUrl, ...entetes },
    body: JSON.stringify(corps)
  });
  const texte = await res.text();
  return { res, body: texte ? JSON.parse(texte) : null };
}

/** Ce que le FICHIER contient, lu par une connexion a part (ni cache, ni readDb). */
function surDisque(requete, ...params) {
  const db = new DatabaseSync(SQLITE, { readOnly: true });
  try {
    return db.prepare(requete).all(...params);
  } finally {
    db.close();
  }
}

const commandeSurDisque = id => {
  const [ligne] = surDisque("SELECT statut, payload FROM commandes WHERE id = ?", id);
  return { statut: ligne.statut, ...JSON.parse(ligne.payload) };
};
const tourneeSurDisque = () => JSON.parse(surDisque("SELECT payload FROM routes WHERE id = 'r-1'")[0].payload);

const JOUR = new Date().toISOString().slice(0, 10);
const DEPART = new Date(Date.now() - 5 * 3600 * 1000).toISOString();

/**
 * Une tournee EN COURS de cinq arrets, plus 40 tournees terminees : l'ecriture
 * ciblee n'a de sens que si elle a de quoi ne PAS ecrire.
 */
function ensemencer() {
  const commande = (id, statut, extra = {}) => ({
    id, clientId: `c-${id}`, clientName: `Client ${id}`, status: statut,
    address: `${id} rue des Lilas`, city: "Dole", postalCode: "39100", sector: "Dole",
    lat: 47.09, lng: 5.49, deliveryDate: JOUR, routeId: "r-1",
    products: [{ code: "A1", nom: "Alèses", quantite: 1 }], ...extra
  });
  const arret = (o, statut) => ({
    id: `s-${o.id}`, routeId: "r-1", orderId: o.id, clientId: o.clientId, clientName: o.clientName,
    address: o.address, city: o.city, postalCode: o.postalCode, lat: o.lat, lng: o.lng, status: statut, products: o.products
  });
  const enCours = ["a", "b", "c", "d", "e"].map(id => commande(id, "en_livraison"));
  const anciennes = [];
  const tournees = [{
    id: "r-1", sector: "Dole", status: "en_livraison", deliveryDate: JOUR, startedAt: DEPART,
    selectedOrderIds: enCours.map(o => o.id), stops: enCours.map(o => arret(o, "en_livraison"))
  }];
  for (let t = 0; t < 40; t++) {
    const o = commande(`h${t}`, "livre", { deliveryDate: "2026-08-01", routeId: `r-h${t}`, deliveredAt: "2026-08-01T09:00:00.000Z" });
    anciennes.push(o);
    tournees.push({
      id: `r-h${t}`, sector: "Dole", status: "terminee", deliveryDate: "2026-08-01", completedAt: "2026-08-01T12:00:00.000Z",
      selectedOrderIds: [o.id], stops: [{ ...arret(o, "livre"), routeId: `r-h${t}`, id: `s-h${t}` }]
    });
  }
  const commandes = [...enCours, ...anciennes];
  writeDb({
    ...defaultDb(),
    clients: commandes.map(o => ({ id: o.clientId, nom: o.clientName, ville: "Dole", statut: "en_cours" })),
    commandes,
    routes: tournees
  }, { backup: false });
}

test("lots 1+5 — « Absent » : a_reprogrammer, la cause et updatedAt sont ECRITS en base par l'ecriture ciblee", async () => {
  ensemencer();
  const avant = tourneeSurDisque();
  assert.equal(commandeSurDisque("a").statut, "en_livraison", "prealable : la commande est en livraison sur disque");

  const { res, body } = await patcherArret("s-a", { status: "absent" });
  assert.equal(res.status, 200, JSON.stringify(body));
  // La reponse du lot 5 (mise a jour ciblee de l'ecran) porte le statut du lot 1.
  assert.equal(body.order.status, "a_reprogrammer", "la reponse du geste ne porte pas le statut du lot 1");
  assert.equal(body.stop.status, "absent");
  assert.ok(body.route && body.client, "la reponse du geste n'est plus celle du lot 5 (tournee, client)");

  const cmd = commandeSurDisque("a");
  assert.equal(cmd.statut, "a_reprogrammer", "la colonne statut n'a pas ete reecrite : un redemarrage relirait « en_livraison »");
  assert.equal(cmd.status, "a_reprogrammer", "le payload de la commande n'a pas ete reecrit");
  assert.equal(cmd.deliveryStatus, "absent", "la cause (absent) est perdue en base");
  const tournee = tourneeSurDisque();
  assert.equal(tournee.stops.find(s => s.id === "s-a").status, "absent", "l'arret n'est pas « absent » en base");
  assert.ok(tournee.updatedAt && tournee.updatedAt !== avant.updatedAt, "updatedAt de la tournee (garde H4 de l'ecran) n'est pas ecrit en base");

  // Temoin : une tournee terminee que le geste ne touche pas reste identique.
  const intacte = JSON.parse(surDisque("SELECT payload FROM routes WHERE id = 'r-h7'")[0].payload);
  assert.equal(intacte.stops[0].status, "livre");
});

test("lots 1+5 — « Livre » : l'heure REELLE du geste (faitLe) est ecrite en base, commande et arret", async () => {
  ensemencer();
  const geste = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const { res, body } = await patcherArret("s-b", { status: "livre", faitLe: geste });
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.order.deliveredAt, geste, "prealable : la reponse porte l'heure du geste");

  assert.equal(commandeSurDisque("b").deliveredAt, geste, "la commande est datee en base d'autre chose que du geste");
  assert.equal(tourneeSurDisque().stops.find(s => s.id === "s-b").deliveredAt, geste,
    "l'arret livre n'est pas date du geste en base (payload de la tournee non reecrit)");
});

test("lots 1+5 — les cles d'idempotence (gestes_recus) survivent aux ecritures ciblees, et un renvoi n'applique rien", async () => {
  ensemencer();
  const cle = "geste-lots-1-5-0001";
  const premier = await patcherArret("s-c", { status: "absent" }, { "X-Sereo-Geste": cle });
  assert.equal(premier.res.status, 200);
  assert.equal(surDisque("SELECT COUNT(*) AS n FROM gestes_recus WHERE cle = ?", cle)[0].n, 1, "prealable : la cle est enregistree");

  // D'autres gestes : autant d'ecritures ciblees, plus une reecriture complete.
  await patcherArret("s-d", { status: "livre" });
  await patcherArret("s-e", { status: "absent" });
  writeDb(readDb(), { backup: false });
  assert.equal(surDisque("SELECT COUNT(*) AS n FROM gestes_recus WHERE cle = ?", cle)[0].n, 1,
    "une ecriture de la base a efface la cle d'idempotence : le renvoi de la file s'appliquerait deux fois");

  const historiqueAvant = readDb().historique.length;
  const renvoi = await patcherArret("s-c", { status: "absent" }, { "X-Sereo-Geste": cle });
  assert.equal(renvoi.res.status, 200);
  assert.equal(renvoi.res.headers.get("x-sereo-geste-rejoue"), "1", "le renvoi a ete re-applique");
  assert.equal(readDb().historique.length, historiqueAvant, "le renvoi a ecrit une seconde entree d'historique");
});

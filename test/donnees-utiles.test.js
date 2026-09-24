// Lot « donnees utiles » (24/09) -- la part SERVEUR, sur un vrai serveur
// ensemence (SQLite, authentification coupee : l'auteur est « dev »).
//
// 1. Garde-fous de saisie : telephone a 10 chiffres, code postal a 5 ; une
//    saisie fausse est refusee (400, message nomme), une saisie juste est
//    normalisee, une valeur deja en base n'est jamais reecrite en silence.
// 2. Clients qui ne commandent plus (decision 5) : signales sans changer leur
//    statut, meme quand « Confirmer » l'a fige en « client_actif ».
// 3. Journal : l'auteur de chaque action et de chaque mouvement de stock, et
//    GET /api/journal pagine (le journal n'est plus envoye en entier).
//
// L'autorisation (journal reserve a l'administration) et l'auteur d'un compte
// nomme sont dans test/journal-auteur.test.js : l'authentification s'y allume,
// ce qui demande un autre processus (les variables sont lues au chargement).

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-donnees-utiles-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const { app, closeStorage, defaultDb, readDb, writeDb } = require("../server");
const { jourParis, ajouterJours } = require("../lib/jour-paris");

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

const envoyer = (methode, chemin, corps = {}) => demander(chemin, {
  method: methode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps)
});
const poster = (chemin, corps) => envoyer("POST", chemin, corps);
const patcher = (chemin, corps) => envoyer("PATCH", chemin, corps);

const AUJOURDHUI = jourParis();
const ilYA = jours => ajouterJours(AUJOURDHUI, -jours);

const PRODUIT = { id: "p1", code: "A1", nom: "Alèses", quantite: 50 };

function ensemencer(extra = {}) {
  writeDb({ ...defaultDb(), stock: [{ ...PRODUIT }], ...extra }, { backup: false });
}

function client(id, extra = {}) {
  return { id, nom: `Client ${id}`, rue: "1 rue Neuve", ville: "Dole", codePostal: "39100", statut: "restant", produits: [], ...extra };
}

let numero = 0;
function commande(clientId, status, jour, extra = {}) {
  numero += 1;
  return {
    id: `o-${clientId}-${numero}`, numero: `CMD-2026-${String(numero).padStart(3, "0")}`,
    clientId, clientName: `Client ${clientId}`, status, address: "1 rue Neuve", city: "Dole", postalCode: "39100",
    dateCommande: jour, deliveryDate: jour,
    ...(status === "livre" ? { deliveredAt: `${jour}T10:00:00Z` } : {}),
    products: [{ code: "A1", nom: "Alèses", quantite: 1 }],
    ...extra
  };
}

/** Des livraisons tous les `pas` jours, la derniere il y a `derniere` jours. */
function livraisons(clientId, { nombre, pas, derniere }) {
  return Array.from({ length: nombre }, (_, i) => commande(clientId, "livre", ilYA(derniere + (nombre - 1 - i) * pas)));
}

// --- 1. Garde-fous de saisie ------------------------------------------------

test("saisie — un telephone illisible est refuse (400, nomme) et rien n'est cree", async () => {
  ensemencer();
  const { res, body } = await poster("/api/crm/clients", { nom: "Faux numero", telephone: "abc" });
  assert.equal(res.status, 400);
  assert.match(body.error, /Téléphone invalide : 10 chiffres/);
  assert.equal(readDb().clients.some(c => c.nom === "Faux numero"), false, "la fiche a ete creee malgre le refus");
});

test("saisie — un code postal illisible est refuse (400, nomme)", async () => {
  ensemencer();
  for (const codePostal of ["ABCDE", "3910", "391000"]) {
    const { res, body } = await poster("/api/crm/clients", { nom: `CP ${codePostal}`, codePostal });
    assert.equal(res.status, 400, codePostal);
    assert.match(body.error, /Code postal invalide : 5 chiffres/, codePostal);
  }
});

test("saisie — espaces, points, tirets et +33 sont acceptes et normalises", async () => {
  ensemencer();
  const cas = [
    ["06.12.34.56.78", "0612345678"],
    ["03-81-12-34-56", "0381123456"],
    ["+33 6 11 22 33 44", "0611223344"],
    ["+33 (0)7 11 22 33 44", "0711223344"],
    ["0033 3 84 00 00 01", "0384000001"]
  ];
  for (const [i, [saisi, attendu]] of cas.entries()) {
    const { res, body } = await poster("/api/crm/clients", { nom: `Normalise ${i}`, telephone: saisi, codePostal: "25 000" });
    assert.equal(res.status, 201, saisi);
    assert.equal(body.telephone, attendu, saisi);
    assert.equal(body.codePostal, "25000", saisi);
  }
});

test("saisie — une fiche modifiee : un numero faux est refuse ; l'ancien faux, renvoye tel quel, est garde, jamais reecrit", async () => {
  ensemencer({ clients: [client("c-faux", { telephone: "abc", codePostal: "ABCDE" })] });

  // Le formulaire du detail de commande renvoie TOUS ses champs (saveBdcClientEdit) :
  // l'adresse change, le telephone et le code postal reviennent tels quels.
  const garde = await patcher("/api/clients/c-faux", {
    nom: "Client c-faux", rue: "9 rue Neuve", codePostal: "ABCDE", ville: "Dole", telephone: "abc", notes: ""
  });
  assert.equal(garde.res.status, 200, JSON.stringify(garde.body));
  let fiche = readDb().clients.find(c => c.id === "c-faux");
  assert.equal(fiche.rue, "9 rue Neuve");
  assert.equal(fiche.telephone, "abc", "la valeur existante a ete reecrite");
  assert.equal(fiche.codePostal, "ABCDE", "la valeur existante a ete reecrite");

  // Un NOUVEAU numero faux est refuse, par les deux routes de la fiche.
  const refus = await patcher("/api/clients/c-faux", { telephone: "12 34" });
  assert.equal(refus.res.status, 400);
  assert.match(refus.body.error, /Téléphone invalide/);
  const refusCrm = await patcher("/api/crm/clients/c-faux", { codePostal: "3910" });
  assert.equal(refusCrm.res.status, 400);
  assert.match(refusCrm.body.error, /Code postal invalide/);

  // Une autre modification ne touche pas au numero garde.
  const notes = await patcher("/api/crm/clients/c-faux", { notes: "Entrée de service" });
  assert.equal(notes.res.status, 200);
  fiche = readDb().clients.find(c => c.id === "c-faux");
  assert.equal(fiche.telephone, "abc");
  assert.equal(fiche.notes, "Entrée de service");

  // Corrige : normalise.
  const juste = await patcher("/api/clients/c-faux", { telephone: "03 84 12 34 56", codePostal: "39 100" });
  assert.equal(juste.res.status, 200);
  fiche = readDb().clients.find(c => c.id === "c-faux");
  assert.equal(fiche.telephone, "0384123456");
  assert.equal(fiche.codePostal, "39100");
});

test("saisie — une commande pour un nouveau client au numero faux est refusee, et rien n'est cree", async () => {
  ensemencer();
  const commandesAvant = readDb().commandes.length;
  const corps = numeroSaisi => ({
    client: { nom: "Nouveau cabinet", telephone: numeroSaisi, codePostal: "25000", adresse: "3 rue Haute", ville: "Besançon" },
    products: [{ productId: "p1", quantite: 2 }]
  });
  const refus = await poster("/api/customer-orders", corps("06 12"));
  assert.equal(refus.res.status, 400);
  assert.match(refus.body.error, /Téléphone invalide/);
  assert.equal(readDb().commandes.length, commandesAvant, "une commande a ete creee malgre le refus");
  assert.equal(readDb().clients.some(c => c.nom === "Nouveau cabinet"), false);

  const cree = await poster("/api/customer-orders", corps("06 12 34 56 78"));
  assert.equal(cree.res.status, 201, JSON.stringify(cree.body));
  const fiche = readDb().clients.find(c => c.nom === "Nouveau cabinet");
  assert.equal(fiche.telephone, "0612345678");
  assert.equal(readDb().commandes.find(o => o.clientId === fiche.id).phone, "0612345678");
});

test("saisie — le meme numero ecrit autrement reconnait le client existant (409)", async () => {
  // Normaliser rend le doublon atteignable : « 0612345678 » en base et
  // « 06 12 34 56 78 » tape ne se reconnaissaient pas (cles de texte).
  ensemencer({ clients: [client("c-connu", { telephone: "0612345678" })] });
  const { res } = await poster("/api/crm/clients", { nom: "Autre nom", telephone: "06 12 34 56 78" });
  assert.equal(res.status, 409);
});

// --- 2. Clients qui ne commandent plus ---------------------------------------

test("relance — un client non abonne qui depasse 1,5 fois son rythme est signale, sans changer son statut", async () => {
  ensemencer({
    clients: [
      client("c-rythme"), client("c-recent"), client("c-unique"), client("c-unique-recent"),
      client("c-abonne"), client("c-pause"), client("c-en-cours"),
      client("c-fige", { crmStatus: "client_actif" }), client("c-inactif", { crmStatus: "client_inactif" }),
      client("c-jamais")
    ],
    commandes: [
      ...livraisons("c-rythme", { nombre: 4, pas: 30, derniere: 100 }),
      ...livraisons("c-recent", { nombre: 4, pas: 30, derniere: 20 }),
      ...livraisons("c-unique", { nombre: 1, pas: 0, derniere: 120 }),
      ...livraisons("c-unique-recent", { nombre: 1, pas: 0, derniere: 60 }),
      ...livraisons("c-abonne", { nombre: 3, pas: 14, derniere: 200 }),
      ...livraisons("c-pause", { nombre: 3, pas: 14, derniere: 200 }),
      ...livraisons("c-en-cours", { nombre: 3, pas: 30, derniere: 100 }),
      commande("c-en-cours", "en_preparation", AUJOURDHUI),
      ...livraisons("c-fige", { nombre: 3, pas: 30, derniere: 100 }),
      ...livraisons("c-inactif", { nombre: 3, pas: 30, derniere: 100 }),
      commande("c-jamais", "annulee", ilYA(300))
    ],
    subscriptions: [
      { id: "sub-a", clientId: "c-abonne", status: "active", startDate: ilYA(400), frequency: { unit: "days", interval: 14 }, products: [] },
      { id: "sub-p", clientId: "c-pause", status: "paused", startDate: ilYA(400), frequency: { unit: "days", interval: 14 }, products: [] }
    ]
  });

  const { res, body } = await demander("/api/crm/clients");
  assert.equal(res.status, 200);
  const parId = Object.fromEntries(body.map(c => [c.id, c]));

  assert.deepEqual(parId["c-rythme"].relanceSuggeree,
    { derniereLivraison: ilYA(100), joursDepuis: 100, rythmeJours: 30, seuilJours: 45 });
  assert.deepEqual(parId["c-unique"].relanceSuggeree,
    { derniereLivraison: ilYA(120), joursDepuis: 120, rythmeJours: null, seuilJours: 90 });
  // Abonne en pause : il n'est plus abonne (meme regle que la pilule « Abonnes »).
  assert.equal(parId["c-pause"].relanceSuggeree?.rythmeJours, 14);
  // « Confirmer » a ecrit client_actif en dur : le signal ne s'y fie pas, et le statut reste.
  assert.equal(parId["c-fige"].relanceSuggeree?.joursDepuis, 100);
  assert.equal(parId["c-fige"].crmStatus, "client_actif");

  for (const id of ["c-recent", "c-unique-recent", "c-abonne", "c-en-cours", "c-inactif", "c-jamais"]) {
    assert.equal(parId[id].relanceSuggeree, null, `${id} ne doit pas etre signale`);
  }

  // Rien n'est ecrit : le statut en base est celui d'avant, sans champ ajoute.
  const enBase = readDb().clients.find(c => c.id === "c-fige");
  assert.equal(enBase.crmStatus, "client_actif");
  assert.equal("relanceSuggeree" in enBase, false);

  // Le filtre serveur « a relancer » les compte aussi.
  const filtre = await demander("/api/crm/clients?status=client_a_relancer");
  const ids = filtre.body.map(c => c.id).sort();
  assert.deepEqual(ids, ["c-fige", "c-pause", "c-rythme", "c-unique"]);
});

test("relance — « Confirmer » une commande planifiee fige le client en actif ; le signal revient quand plus rien n'est en cours", async () => {
  ensemencer({
    clients: [client("c-conf", { crmStatus: "client_a_relancer" })],
    commandes: [
      ...livraisons("c-conf", { nombre: 3, pas: 30, derniere: 100 }),
      commande("c-conf", "planifiee", ilYA(90), { id: "o-planifiee", orderType: "planifiee", source: "commande_planifiee", deliveryDate: ajouterJours(AUJOURDHUI, 3) })
    ]
  });
  const signal = async () => (await demander("/api/crm/clients/c-conf")).body;

  // Une commande planifiee attend : le client n'est pas arrete.
  assert.equal((await signal()).relanceSuggeree, null);

  const confirme = await poster("/api/planned-orders/o-planifiee/confirm", {});
  assert.equal(confirme.res.status, 200, JSON.stringify(confirme.body));
  // Le constat de l'audit, verifie : le statut est ecrit en dur.
  assert.equal(readDb().clients.find(c => c.id === "c-conf").crmStatus, "client_actif");
  assert.equal((await signal()).relanceSuggeree, null, "la commande confirmee est en cours");

  // La commande est annulee : plus rien en cours, le rythme est depasse.
  const db = readDb();
  db.commandes.find(o => o.id === "o-planifiee").status = "annulee";
  writeDb(db, { backup: false });
  const apres = await signal();
  assert.equal(apres.crmStatus, "client_actif");
  assert.equal(apres.relanceSuggeree?.joursDepuis, 100);
});

// --- 3. Journal --------------------------------------------------------------

test("journal — une action et un mouvement de stock portent leur auteur", async () => {
  ensemencer();
  const { res } = await patcher("/api/stock/p1", { quantite: 42, reason: "Inventaire" });
  assert.equal(res.status, 200);
  const db = readDb();
  assert.equal(db.historique[0].type, "Stock");
  assert.equal(db.historique[0].auteur, "dev");
  assert.equal(db.stockMovements[0].createdBy, "dev");
});

test("journal — GET /api/journal : 50 par page, du plus recent au plus ancien, sans doublon ni trou", async () => {
  const base = Date.parse(`${AUJOURDHUI}T08:00:00Z`);
  const date = minutes => new Date(base - minutes * 60000).toISOString();
  // 120 actions, dont des paires a la MEME milliseconde, decalees d'un rang
  // pour que les pages de 50 coupent AU MILIEU d'une paire (49 | 50) : un
  // curseur par la seule date perdrait la seconde. Et 30 mouvements anciens
  // (createdBy « local » : l'auteur n'etait pas connu).
  const historique = Array.from({ length: 120 }, (_, i) => ({
    id: `h-${String(i).padStart(3, "0")}`, date: date(Math.floor((i + 1) / 2) * 3), type: "Test", message: `action ${i}`,
    ...(i % 3 === 0 ? { auteur: "julie" } : {})
  }));
  const stockMovements = Array.from({ length: 30 }, (_, i) => ({
    id: `m-${String(i).padStart(3, "0")}`, productId: "p1", productName: "Alèses", sku: "A1",
    type: i % 2 ? "entree" : "sortie", quantity: 2, oldQuantity: 10, newQuantity: i % 2 ? 12 : 8,
    reason: "Ajustement manuel", createdAt: date(i * 7 + 1), createdBy: "local"
  }));
  ensemencer({ historique, stockMovements });

  async function toutLire(genre) {
    const vus = [];
    const tailles = [];
    let curseur = null;
    do {
      const { res, body } = await demander(`/api/journal?genre=${genre}&limite=50${curseur ? `&avant=${encodeURIComponent(curseur)}` : ""}`);
      assert.equal(res.status, 200, JSON.stringify(body));
      vus.push(...body.entrees);
      tailles.push(body.entrees.length);
      curseur = body.suivant;
      // Une ligne ecrite entre deux pages ne decale pas la suite.
      if (genre === "actions" && tailles.length === 1) {
        const db = readDb();
        // Plus recente que tout le seme (25/09) : `new Date()` tombait AVANT
        // lui la nuit (00 h a 10 h a Paris : le seme est date du jour a
        // 05-08 h UTC), et la ligne « neuve » arrivait en page 3 -- un rouge
        // selon l'heure du banc, pas selon le code.
        db.historique.unshift({ id: "h-neuve", date: date(-1), type: "Test", message: "entre deux pages" });
        writeDb(db, { backup: false });
      }
    } while (curseur && tailles.length < 10);
    return { vus, tailles };
  }

  const actions = await toutLire("actions");
  assert.deepEqual(actions.tailles, [50, 50, 20]);
  assert.equal(new Set(actions.vus.map(e => e.id)).size, 120, "des lignes manquent ou se repetent");
  assert.equal(actions.vus.some(e => e.id === "h-neuve"), false);
  for (let i = 1; i < actions.vus.length; i += 1) {
    assert.ok(actions.vus[i - 1].date >= actions.vus[i].date, `ordre casse a ${i}`);
  }
  const action = actions.vus.find(e => e.id === "h-000");
  assert.equal(action.genre, "action");
  assert.equal(action.auteur, "julie");
  assert.equal(actions.vus.find(e => e.id === "h-001").auteur, null, "une ancienne ligne sans auteur doit dire null");

  const stock = await toutLire("stock");
  assert.deepEqual(stock.tailles, [30]);
  const mouvement = stock.vus.find(e => e.id === "m-000");
  assert.equal(mouvement.genre, "stock");
  assert.equal(mouvement.auteur, null, "« local » n'est pas un auteur");
  assert.equal(mouvement.message, "Alèses : −2 · 10 → 8 · Ajustement manuel");
});

// Une commande terrain pour un NOUVEAU client dont le telephone (ou le nom et
// le code postal) existe deja ne renomme plus ni ne vide la fiche existante
// (chasse aux defauts du 24/09, constat « haute »).
//
// Mesure du rapport (b5-doublon-reco.js, v1-archive.js) : « EHPAD Les
// Tilleuls » (0381000000) ; une commande pour « Mme Roux », joignable au meme
// standard, rue vide : la fiche de l'EHPAD devenait « Roux », prenom « Mme »,
// rue, email et notes vides (le formulaire envoie tous ses champs, vides
// compris), et portait les deux commandes.
//
// Maintenant : sans choix explicite, le serveur REFUSE (409) et rend la fiche
// trouvee ; l'ecran propose « rattacher a <fiche> » (clientId : la fiche est
// prise telle quelle) ou « creer une nouvelle fiche » (nouvelleFiche). Les
// numeros se comparent normalises (espaces, points, +33).
//
// Le 409 ne va qu'a une page qui sait poser la question : elle le demande
// (`demanderSiDoublon`). Sans demande ni choix -- une page d'avant la mise a
// jour, ou sa file d'attente rejouee par la nouvelle --, un refus retirerait
// la commande de la file : le serveur cree une nouvelle fiche, sans toucher a
// l'existante (une fiche en double se fusionne ; une commande perdue non).

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-doublon-fiche-"));
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

async function poster(chemin, corps) {
  const res = await fetch(`${baseUrl}${chemin}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps)
  });
  return { status: res.status, body: await res.json() };
}

const EHPAD = {
  id: "c-ehpad", nom: "EHPAD Les Tilleuls", prenom: "", telephone: "0381000000", email: "accueil@tilleuls.example",
  rue: "12 avenue du General de Gaulle", codePostal: "25000", ville: "Besancon", notes: "Code porte 4512",
  crmStatus: "client_actif", source: "salon"
};
const CHAMPS = ["nom", "prenom", "telephone", "email", "rue", "codePostal", "ville", "notes", "source"];
const ficheEhpad = () => readDb().clients.find(c => c.id === "c-ehpad");
const extraire = c => Object.fromEntries(CHAMPS.map(ch => [ch, c?.[ch]]));

function semer({ telephoneEnBase = EHPAD.telephone } = {}) {
  const db = defaultDb();
  db.clients = [{ ...EHPAD, telephone: telephoneEnBase }];
  db.stock = [{ id: "p1", code: "CH-L", nom: "Changes taille L", quantite: 20, tarif: 12 }];
  writeDb(db, { backup: false });
}

// Le formulaire « Nouveau client » tel que l'ecran l'envoie : tous ses champs, vides compris.
const ROUX = { nom: "Roux", prenom: "Mme", telephone: "0381000000", email: "", adresse: "", rue: "", codePostal: "25000", ville: "Besancon", notes: "" };
const commande = (client, extra = {}) => ({ client, products: [{ productId: "p1", quantite: 2 }], ...extra });
// Ce que l'ecran envoie en ligne sans choix : il sait poser la question.
const DEMANDE = { demanderSiDoublon: true };

test("doublon par telephone, sans choix : 409 avec la fiche trouvee ; la fiche n'est pas touchee, rien n'est cree", async () => {
  semer();
  const avant = extraire(ficheEhpad());
  const r = await poster("/api/customer-orders", commande(ROUX, DEMANDE));
  assert.equal(r.status, 409, `attendu un refus, recu ${r.status} : la fiche existante a ete reprise sans demander`);
  assert.equal(r.body.details?.doublon?.id, "c-ehpad");
  assert.equal(r.body.details.doublon.nom, EHPAD.nom);
  assert.deepEqual(extraire(ficheEhpad()), avant, "la fiche existante a ete renommee ou videe");
  assert.equal(readDb().commandes.length, 0);
  assert.equal(readDb().clients.length, 1);
});

test("doublon : les numeros se comparent normalises (espaces, points, +33), dans les deux sens", async () => {
  for (const saisi of ["03 81 00 00 00", "03.81.00.00.00", "+33 3 81 00 00 00", "+33381000000"]) {
    semer();
    const r = await poster("/api/customer-orders", commande({ ...ROUX, telephone: saisi }, DEMANDE));
    assert.equal(r.status, 409, `« ${saisi} » n'est pas reconnu comme le meme numero`);
  }
  semer({ telephoneEnBase: "03 81 00 00 00" });
  const r = await poster("/api/customer-orders", commande(ROUX, DEMANDE));
  assert.equal(r.status, 409, "un numero en base avec des espaces n'est pas reconnu");
});

test("« Rattacher a la fiche » (clientId) : la commande part sur la fiche, prise TELLE QUELLE", async () => {
  semer();
  const avant = extraire(ficheEhpad());
  // Le formulaire porte son propre clientId, VIDE (nouveau client) : le choix l'emporte.
  const r = await poster("/api/customer-orders", commande({ ...ROUX, clientId: "" }, { ...DEMANDE, clientId: "c-ehpad" }));
  assert.equal(r.status, 201, r.body?.error);
  assert.equal(r.body.clientId, "c-ehpad");
  assert.deepEqual(extraire(ficheEhpad()), avant, "rattacher a modifie la fiche");
  assert.equal(readDb().clients.length, 1);
});

test("« Creer une nouvelle fiche » (nouvelleFiche) : une fiche Roux est creee, celle de l'EHPAD ne bouge pas", async () => {
  semer();
  const avant = extraire(ficheEhpad());
  const r = await poster("/api/customer-orders", commande(ROUX, { ...DEMANDE, nouvelleFiche: true }));
  assert.equal(r.status, 201, r.body?.error);
  const db = readDb();
  assert.equal(db.clients.length, 2);
  const roux = db.clients.find(c => c.id !== "c-ehpad");
  assert.equal(roux.nom, "Roux");
  assert.equal(r.body.clientId, roux.id);
  assert.deepEqual(extraire(ficheEhpad()), avant);
});

test("doublon par nom + code postal : meme regle (le formulaire vide ne vide plus la fiche)", async () => {
  semer();
  const avant = extraire(ficheEhpad());
  const r = await poster("/api/customer-orders", commande({ ...ROUX, nom: EHPAD.nom, prenom: "", telephone: "" }, DEMANDE));
  assert.equal(r.status, 409);
  assert.deepEqual(extraire(ficheEhpad()), avant, "l'email, la rue ou les notes ont ete effaces");
});

test("commande PLANIFIEE : meme regle", async () => {
  semer();
  const r = await poster("/api/planned-orders", commande(ROUX, { ...DEMANDE, deliveryDate: "2026-12-01" }));
  assert.equal(r.status, 409);
  assert.equal(r.body.details?.doublon?.id, "c-ehpad");
  assert.equal(ficheEhpad().nom, EHPAD.nom);
});

test("temoin : un nouveau client sans doublon est cree sans question", async () => {
  semer();
  const r = await poster("/api/customer-orders", commande({ ...ROUX, nom: "Cabinet Lemoine", telephone: "0612345678", codePostal: "39100", ville: "Dole" }));
  assert.equal(r.status, 201, r.body?.error);
  assert.equal(readDb().clients.length, 2);
});

test("sans demande ni choix (page d'avant, file rejouee) : jamais refusee ni reprise -- une nouvelle fiche, l'existante ne bouge pas", async () => {
  for (const chemin of ["/api/customer-orders", "/api/planned-orders"]) {
    semer();
    const avant = extraire(ficheEhpad());
    const r = await poster(chemin, commande(ROUX, chemin === "/api/planned-orders" ? { deliveryDate: "2026-12-01" } : {}));
    assert.equal(r.status, 201, `${chemin} : refusee (${r.status}) -- rejouee par la file, elle en serait retiree et perdue`);
    const db = readDb();
    assert.equal(db.clients.length, 2, `${chemin} : pas de nouvelle fiche`);
    const roux = db.clients.find(c => c.id !== "c-ehpad");
    assert.equal(roux.nom, "Roux");
    assert.equal(db.commandes.length, 1);
    assert.equal(db.commandes[0].clientId, roux.id, `${chemin} : la commande est partie sur la fiche existante`);
    assert.deepEqual(extraire(ficheEhpad()), avant, `${chemin} : la fiche existante a ete renommee ou videe`);
  }
});

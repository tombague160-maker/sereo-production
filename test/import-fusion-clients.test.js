// L'import des ventes FUSIONNE les clients, il ne remplace plus leur table
// (chasse aux defauts du 24/09, constat critique ; regle permanente de Thomas
// depuis le 18/05 : tout import est une fusion par cle metier).
//
// Mesure du rapport (b2-import.js, rejoue par le contre-verificateur) : un
// fichier qui ne cite que Dupont faisait disparaitre le prospect Martin (et
// son abonnement ne se suspendait plus : « Selectionne un client existant »),
// vidait l'email, le prenom, les preferences et la source de Dupont, et
// faisait reapparaitre un client archive.
//
// Ce qui doit tenir :
//   - une fiche absente du fichier n'est jamais supprimee ;
//   - une cellule vide ne remplace pas une valeur existante (une pleine, oui) ;
//   - l'identifiant existant est garde, les champs CRM aussi ;
//   - comptes created / updated / preserved dans la reponse ;
//   - les ventes d'un bon absent du fichier restent (fusion par bon).

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { importerVentes } = require("./aide-import-ventes");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-fusion-clients-"));
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

async function appeler(chemin, corps, method = "POST") {
  const res = await fetch(`${baseUrl}${chemin}`, {
    method, headers: { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps)
  });
  return { status: res.status, body: await res.json() };
}

const ENTETE = ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville", "Telephone", "Notes", "TTC"];
// Les champs que le fichier ne porte pas : ceux-la, l'import les effacait.
const CHAMPS_CRM = ["prenom", "email", "preferences", "source", "needs", "estimatedFrequency", "firstContactDate", "crmConvertedAt", "createdAt", "crmArchived"];

const DUPONT = {
  id: "c-dupont", nom: "Pharmacie Dupont", rue: "3 rue du Pont", codePostal: "39100", ville: "Dole",
  telephone: "0384112233", notes: "Code porte 1234", prenom: "Paul", email: "p.dupont@example.test",
  preferences: "Gants taille M", source: "salon", crmStatus: "client_actif", needs: "Livrer le matin",
  estimatedFrequency: "mensuelle", firstContactDate: "2026-04-01", crmConvertedAt: "2026-05-02T08:00:00.000Z",
  createdAt: "2026-04-01T08:00:00.000Z"
};
const MARTIN = {
  id: "c-martin", nom: "Cabinet Martin", rue: "5 rue Neuve", codePostal: "39300", ville: "Champagnole",
  telephone: "0384445566", prenom: "Julie", email: "j.martin@example.test", source: "salon",
  crmStatus: "prospect", firstContactDate: "2026-09-01", preferences: "Aleses", createdAt: "2026-09-01T08:00:00.000Z"
};
const ARCHIVE = {
  id: "c-archive", nom: "Foyer Ancien", rue: "1 place du Marche", codePostal: "25000", ville: "Besancon",
  email: "foyer@example.test", crmArchived: true, createdAt: "2026-01-10T08:00:00.000Z"
};
const LIGNE_DUPONT = ["20/09/2026", DUPONT.nom, "CH-L", "Changes taille L", "2", DUPONT.rue, DUPONT.codePostal, DUPONT.ville, "", "", "24"];

function semer({ clients = [DUPONT, MARTIN, ARCHIVE], ventes = [], commandes = [] } = {}) {
  const db = defaultDb();
  db.clients = clients.map(c => ({ ...c }));
  db.stock = [
    { id: "p-ch", code: "CH-L", nom: "Changes taille L", quantite: 50, tarif: 12 },
    { id: "p-ale", code: "ALE", nom: "Aleses", quantite: 50, tarif: 5 }
  ];
  db.ventes = ventes;
  db.commandes = commandes;
  db.subscriptions = [{
    id: "sub-martin", clientId: "c-martin", status: "active", startDate: "2026-10-01",
    frequency: { unit: "months", interval: 1 }, reminderDays: 2, notes: "",
    products: [{ stockId: "p-ale", code: "ALE", nom: "Aleses", quantite: 2, prixUnitaire: 5, totalLigne: 10 }]
  }];
  db.relances = [{ id: "rel-martin", clientId: "c-martin", datePrevue: "2026-10-02", status: "a_faire", motif: "Rappeler pour le devis", type: "appel" }];
  writeDb(db, { backup: false });
}

const fiche = (db, id) => db.clients.find(c => c.id === id);
const extraire = (client, champs) => Object.fromEntries(champs.map(ch => [ch, client?.[ch]]));

test("import partiel — les fiches absentes du fichier restent, et la fiche presente garde ses champs CRM", async () => {
  semer();
  const avant = readDb();
  const r = await importerVentes(baseUrl, [ENTETE, LIGNE_DUPONT]);
  assert.equal(r.status, 200, r.body?.error);

  const apres = readDb();
  assert.deepEqual(apres.clients.map(c => c.id).sort(), ["c-archive", "c-dupont", "c-martin"], "une fiche absente du fichier a ete supprimee");
  assert.deepEqual(extraire(fiche(apres, "c-martin"), [...CHAMPS_CRM, "nom", "rue", "telephone", "crmStatus"]),
    extraire(fiche(avant, "c-martin"), [...CHAMPS_CRM, "nom", "rue", "telephone", "crmStatus"]), "le prospect absent du fichier a change");
  assert.deepEqual(extraire(fiche(apres, "c-dupont"), CHAMPS_CRM), extraire(fiche(avant, "c-dupont"), CHAMPS_CRM),
    "la fiche presente dans le fichier a perdu ses champs CRM");
  // Cellules vides dans le fichier : la valeur en base reste.
  assert.equal(fiche(apres, "c-dupont").telephone, "0384112233", "une cellule Telephone vide a efface le telephone");
  assert.equal(fiche(apres, "c-dupont").notes, "Code porte 1234", "une cellule Notes vide a efface les notes");
  // La commande part sur la fiche existante (identifiant garde).
  assert.deepEqual(apres.commandes.map(o => o.clientId), ["c-dupont"]);
  // Les comptes de la fusion.
  assert.deepEqual(r.body.clientsImport, { created: 0, updated: 1, preserved: 2 });
});

test("import — une cellule PLEINE remplace la valeur (temoin de la regle des cellules vides)", async () => {
  semer();
  const ligne = [...LIGNE_DUPONT];
  ligne[8] = "03 84 99 88 77";
  ligne[9] = "Sonner au portail";
  const r = await importerVentes(baseUrl, [ENTETE, ligne]);
  assert.equal(r.status, 200, r.body?.error);
  const dupont = fiche(readDb(), "c-dupont");
  assert.match(dupont.telephone.replace(/\D/g, ""), /^0384998877$/, "la cellule pleine n'a pas remplace le telephone");
  assert.equal(dupont.notes, "Sonner au portail");
  assert.equal(dupont.email, DUPONT.email);
});

test("import — un client ARCHIVE cite par le fichier reste archive (il ne revient pas dans la liste CRM)", async () => {
  semer();
  const r = await importerVentes(baseUrl, [ENTETE,
    ["21/09/2026", ARCHIVE.nom, "ALE", "Aleses", "1", ARCHIVE.rue, ARCHIVE.codePostal, ARCHIVE.ville, "", "", "5"]]);
  assert.equal(r.status, 200, r.body?.error);
  const archive = fiche(readDb(), "c-archive");
  assert.equal(archive.crmArchived, true, "l'import a desarchive le client");
  assert.equal(archive.email, ARCHIVE.email);
  const liste = await appeler("/api/crm/clients", undefined, "GET");
  assert.equal(liste.status, 200);
  assert.ok(!liste.body.some(c => c.id === "c-archive"), "le client archive reapparait dans la liste CRM");
});

test("import — l'abonnement et le rappel d'un client absent du fichier restent utilisables", async () => {
  semer();
  await importerVentes(baseUrl, [ENTETE, LIGNE_DUPONT]);
  const pause = await appeler("/api/subscriptions/sub-martin", { status: "paused" }, "PATCH");
  assert.equal(pause.status, 200, `la pause est refusee : ${pause.body?.error}`);
  const db = readDb();
  assert.ok(fiche(db, db.relances[0].clientId), "le rappel n'a plus de client");
});

test("import — fusion par cle secondaire (nom + code postal) : meme identifiant, champs CRM gardes, adresse du fichier", async () => {
  semer({ clients: [{ ...DUPONT, rue: "3, rue du Pont." }, MARTIN] });
  const r = await importerVentes(baseUrl, [ENTETE, LIGNE_DUPONT]);
  assert.equal(r.status, 200, r.body?.error);
  const db = readDb();
  assert.deepEqual(db.clients.map(c => c.id).sort(), ["c-dupont", "c-martin"], "doublon cree ou fiche supprimee");
  const dupont = fiche(db, "c-dupont");
  assert.equal(dupont.rue, DUPONT.rue, "l'adresse du fichier (cellule pleine) n'est pas reprise");
  assert.equal(dupont.email, DUPONT.email, "fusion par cle secondaire : l'email est perdu");
  assert.equal(dupont.prenom, DUPONT.prenom);
  assert.equal(r.body.mergedBySecondary, 1);
  assert.deepEqual(r.body.clientsImport, { created: 0, updated: 1, preserved: 1 });
});

test("import — un nouveau client est cree, les autres restent (comptes)", async () => {
  semer();
  const r = await importerVentes(baseUrl, [ENTETE, LIGNE_DUPONT,
    ["20/09/2026", "EHPAD du Lac", "ALE", "Aleses", "4", "2 route du Lac", "39130", "Clairvaux", "0384000000", "", "20"]]);
  assert.equal(r.status, 200, r.body?.error);
  const db = readDb();
  assert.equal(db.clients.length, 4);
  assert.ok(db.clients.some(c => c.nom === "EHPAD du Lac"));
  assert.deepEqual(r.body.clientsImport, { created: 1, updated: 1, preserved: 2 });
});

test("import — deux fiches en double (meme cle) en base : aucune ne disparait", async () => {
  semer({ clients: [DUPONT, { ...DUPONT, id: "c-dupont-bis", email: "autre@example.test" }] });
  const r = await importerVentes(baseUrl, [ENTETE, LIGNE_DUPONT]);
  assert.equal(r.status, 200, r.body?.error);
  const db = readDb();
  assert.deepEqual(db.clients.map(c => c.id).sort(), ["c-dupont", "c-dupont-bis"]);
  assert.equal(fiche(db, "c-dupont-bis").email, "autre@example.test");
});

test("import — une commande dont la fiche a disparu (ancien import) : la fiche recreee reprend son identifiant, pas de commande en double", async () => {
  // La production a une commande livree du 03/06 dont la fiche n'existe plus
  // (retiree par un ancien import, deduit par la chasse du 24/09). Un fichier
  // qui la cite recreait une fiche NEUVE, donc une commande en double.
  const perdue = { nom: "Pharmacie Perdue", rue: "9 rue Basse", codePostal: "39100", ville: "Dole" };
  semer({ commandes: [{
    id: "cmd-perdue", numero: "CMD-2026-040", clientId: "c-perdu", clientName: perdue.nom, dateCommande: "2026-06-03",
    status: "livre", importedAsLivre: true, address: perdue.rue, city: perdue.ville, postalCode: perdue.codePostal,
    products: [{ code: "CH-L", nom: "Changes taille L", quantite: 2 }]
  }] });
  const r = await importerVentes(baseUrl, [ENTETE,
    ["03/06/2026", perdue.nom, "CH-L", "Changes taille L", "2", perdue.rue, perdue.codePostal, perdue.ville, "", "", "24"]]);
  assert.equal(r.status, 200, r.body?.error);
  const db = readDb();
  assert.deepEqual(db.commandes.map(o => o.id), ["cmd-perdue"], "une commande en double a ete creee");
  const fiche = db.clients.find(c => c.nom === perdue.nom);
  assert.equal(fiche?.id, "c-perdu", "la fiche recreee ne reprend pas l'identifiant de sa commande");
  assert.deepEqual(r.body.clientsImport, { created: 1, updated: 0, preserved: 3 });
});

test("import VIDE (l'en-tete seul) : rien ne disparait -- fiches, commandes, ventes", async () => {
  const vente = { id: "v-1", client: DUPONT.nom, rue: DUPONT.rue, codePostal: DUPONT.codePostal, ville: DUPONT.ville,
    codeProduit: "CH-L", produit: "Changes taille L", quantite: 2, ttc: 24, date: "10/09/2026", dateCommandeIso: "2026-09-10" };
  semer({ ventes: [vente] });
  const avant = readDb();
  const r = await importerVentes(baseUrl, [ENTETE]);
  assert.equal(r.status, 200, r.body?.error);
  const apres = readDb();
  assert.deepEqual(apres.clients.map(c => c.id).sort(), avant.clients.map(c => c.id).sort());
  for (const c of avant.clients) assert.deepEqual(extraire(fiche(apres, c.id), CHAMPS_CRM), extraire(c, CHAMPS_CRM), c.id);
  assert.deepEqual(apres.ventes.map(v => v.id), ["v-1"], "l'import vide a efface les ventes");
  assert.deepEqual(r.body.clientsImport, { created: 0, updated: 0, preserved: 3 });
});

test("ventes — un import partiel garde les ventes des bons absents du fichier ; un bon du fichier est remplace, sans doublon", async () => {
  const ventes = [
    { id: "v-dupont", client: DUPONT.nom, rue: DUPONT.rue, codePostal: DUPONT.codePostal, ville: DUPONT.ville,
      codeProduit: "CH-L", produit: "Changes taille L", quantite: 2, ttc: 24, date: "20/09/2026", dateCommandeIso: "2026-09-20" },
    { id: "v-martin", client: MARTIN.nom, rue: MARTIN.rue, codePostal: MARTIN.codePostal, ville: MARTIN.ville,
      codeProduit: "ALE", produit: "Aleses", quantite: 3, ttc: 15, date: "12/08/2026", dateCommandeIso: "2026-08-12" }
  ];
  semer({ ventes });
  const ligne = [...LIGNE_DUPONT];
  ligne[4] = "5";
  ligne[10] = "60";
  const r = await importerVentes(baseUrl, [ENTETE, ligne]);
  assert.equal(r.status, 200, r.body?.error);
  const apres = readDb().ventes;
  assert.ok(apres.some(v => v.id === "v-martin"), "la vente d'un bon absent du fichier a disparu");
  const duBon = apres.filter(v => v.client === DUPONT.nom && v.dateCommandeIso === "2026-09-20");
  assert.deepEqual(duBon.map(v => Number(v.quantite)), [5], "le bon du fichier n'est pas remplace (ou il est en double)");
  assert.equal(apres.length, 2);

  // Le meme fichier une seconde fois : rien ne s'ajoute.
  await importerVentes(baseUrl, [ENTETE, ligne]);
  assert.equal(readDb().ventes.length, 2, "reimporter le meme fichier double les ventes");
});

// Relecture adverse du 26/09 : l'ADRESSE du client change dans Ximi (« 3 rue
// du Pont » devient « 3 bis rue du Pont », ou la ville est ecrite autrement).
// La fiche se retrouve (nom + code postal) et ses commandes aussi (fiche +
// date). Mais le bon d'une ligne de vente se reconnaissait a l'adresse
// COMPLETE : les anciennes lignes de chaque bon de Dupont n'etaient plus
// « du fichier », elles restaient, et les nouvelles s'y ajoutaient -- pour
// toujours (aucun import ne les cite plus). `db.ventes = ventes` (avant le
// 25/09) remettait la table au fichier. Le bon d'une vente suit maintenant la
// meme identite que sa commande : la fiche et la date.
const AUTRE_BON_DUPONT = ["12/08/2026", DUPONT.nom, "ALE", "Aleses", "3", DUPONT.rue, DUPONT.codePostal, DUPONT.ville, "", "", "15"];

for (const [changement, colonne, valeur] of [["la rue", 5, "3 bis rue du Pont"], ["la ville", 7, "Dole Centre"]]) {
  test(`ventes — ${changement} du client change dans Ximi : reimporter le fichier cumulatif ne double pas les lignes de ses bons`, async () => {
    semer();
    const premier = await importerVentes(baseUrl, [ENTETE, LIGNE_DUPONT, AUTRE_BON_DUPONT]);
    assert.equal(premier.status, 200, premier.body?.error);
    assert.equal(readDb().ventes.length, 2);
    const commandesAvant = readDb().commandes.map(o => o.id).sort();

    const fichier = [LIGNE_DUPONT, AUTRE_BON_DUPONT].map(ligne => { const l = [...ligne]; l[colonne] = valeur; return l; });
    const r = await importerVentes(baseUrl, [ENTETE, ...fichier]);
    assert.equal(r.status, 200, r.body?.error);
    const db = readDb();
    assert.deepEqual(db.commandes.map(o => o.id).sort(), commandesAvant, "prealable : les commandes suivent la fiche (pas de doublon)");
    assert.equal(fiche(db, "c-dupont")[colonne === 5 ? "rue" : "ville"], valeur, "prealable : la fiche prend l'adresse du fichier");
    assert.equal(db.ventes.length, 2, `les lignes des bons de Dupont sont en double : ${db.ventes.map(v => `${v.dateCommandeIso} ${v.rue} ${v.ville}`).join(" | ")}`);
    assert.ok(db.ventes.every(v => (colonne === 5 ? v.rue : v.ville) === valeur), "les anciennes lignes sont restees a la place des nouvelles");
  });
}

test("ventes — temoin : un HOMONYME (meme nom, meme code postal, autre adresse, sa fiche) garde ses lignes quand le fichier ne cite que l'autre", async () => {
  const HOMONYME = { ...DUPONT, id: "c-dupont-2", rue: "40 avenue de Lahr", telephone: "0384999999", email: "" };
  const ventes = [
    { id: "v-homonyme", client: HOMONYME.nom, rue: HOMONYME.rue, codePostal: HOMONYME.codePostal, ville: HOMONYME.ville,
      codeProduit: "ALE", produit: "Aleses", quantite: 1, ttc: 5, date: "20/09/2026", dateCommandeIso: "2026-09-20" },
    { id: "v-dupont", client: DUPONT.nom, rue: DUPONT.rue, codePostal: DUPONT.codePostal, ville: DUPONT.ville,
      codeProduit: "CH-L", produit: "Changes taille L", quantite: 2, ttc: 24, date: "20/09/2026", dateCommandeIso: "2026-09-20" }
  ];
  semer({ clients: [DUPONT, HOMONYME, MARTIN], ventes });
  const r = await importerVentes(baseUrl, [ENTETE, LIGNE_DUPONT]);
  assert.equal(r.status, 200, r.body?.error);
  const apres = readDb().ventes;
  assert.ok(apres.some(v => v.id === "v-homonyme"), "la vente de l'homonyme (meme nom, meme code postal, meme date) a disparu");
  assert.equal(apres.filter(v => v.rue === DUPONT.rue).length, 1, "le bon de Dupont est en double");
  assert.equal(apres.length, 2);
});

test("ventes — temoin : adresse changee ET un homonyme au meme code postal (fiche incertaine) -- aucune vente ne disparait", async () => {
  const HOMONYME = { ...DUPONT, id: "c-dupont-2", rue: "40 avenue de Lahr", telephone: "0384999999", email: "" };
  const ventes = [
    { id: "v-dupont", client: DUPONT.nom, rue: DUPONT.rue, codePostal: DUPONT.codePostal, ville: DUPONT.ville,
      codeProduit: "CH-L", produit: "Changes taille L", quantite: 2, ttc: 24, date: "20/09/2026", dateCommandeIso: "2026-09-20" },
    { id: "v-homonyme", client: HOMONYME.nom, rue: HOMONYME.rue, codePostal: HOMONYME.codePostal, ville: HOMONYME.ville,
      codeProduit: "ALE", produit: "Aleses", quantite: 1, ttc: 5, date: "20/09/2026", dateCommandeIso: "2026-09-20" }
  ];
  semer({ clients: [DUPONT, HOMONYME, MARTIN], ventes });
  const ligne = [...LIGNE_DUPONT];
  ligne[5] = "3 bis rue du Pont";
  const r = await importerVentes(baseUrl, [ENTETE, ligne]);
  assert.equal(r.status, 200, r.body?.error);
  const ids = readDb().ventes.map(v => v.id);
  assert.ok(ids.includes("v-homonyme"), "la vente de l'homonyme a disparu : le nom + code postal ne designe pas une seule fiche");
  assert.ok(ids.includes("v-dupont"), "une vente a disparu sur une fiche incertaine");
});

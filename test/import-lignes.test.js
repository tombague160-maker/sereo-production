// Les lignes du fichier de ventes (chasse aux defauts du 24/09, constats
// « basse ») : une date avec une heure ou une colonne « Date facture »
// datait le bon du jour de l'import ; une quantite vide valait 1 ; une ligne
// sans client creait une commande « Client sans nom ».
//
// Ce qui doit tenir :
//   - « 18/05/2026 10:30 » est le 18/05/2026 ; « Date facture », « Date
//     commande », « Date de vente » sont des colonnes de date ;
//   - dans un fichier qui a une colonne de date, une ligne sans date lisible
//     est EN ERREUR (comptee, ecartee) -- jamais datee du jour ; un fichier
//     SANS colonne de date garde l'ancien repli (le jour de l'import) ;
//   - une quantite vide ou illisible : ligne en erreur (0 reste une quantite) ;
//   - une ligne sans client, ou sans produit : en erreur ;
//   - le resume compte chaque cause.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { importerVentes } = require("./aide-import-ventes");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-import-lignes-"));
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

function semer() {
  const db = defaultDb();
  db.stock = [{ id: "p1", code: "CH-L", nom: "Changes taille L", quantite: 50 }, { id: "p2", code: "ALE", nom: "Aleses", quantite: 50 }];
  writeDb(db, { backup: false });
}

const aujourdhui = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const CLIENT = ["Pharmacie Carre", "4 place Carre", "25000", "Besancon"];
const commandesDe = nom => readDb().commandes.filter(o => o.clientName === nom);

test("date avec une heure (« 18/05/2026 10:30 ») : le bon est du 18/05, pas du jour de l'import", async () => {
  semer();
  const r = await importerVentes(baseUrl, [
    ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"],
    ["18/05/2026 10:30", CLIENT[0], "CH-L", "Changes taille L", "2", ...CLIENT.slice(1)],
    ["19/05/2026 08h05", "Cabinet Neuf", "ALE", "Aleses", "1", "2 rue Neuve", "39100", "Dole"]
  ]);
  assert.equal(r.status, 200, r.body?.error);
  assert.deepEqual(commandesDe(CLIENT[0]).map(o => o.dateCommande), ["2026-05-18"]);
  assert.deepEqual(commandesDe("Cabinet Neuf").map(o => o.dateCommande), ["2026-05-19"]);
  assert.equal(r.body.lignesIllisibles, 0);
});

test("colonne « Date facture » (ou « Date commande », « Date de vente ») : sa date est celle du bon", async () => {
  for (const entete of ["Date facture", "Date commande", "Date de vente"]) {
    semer();
    const r = await importerVentes(baseUrl, [
      [entete, "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"],
      ["03/03/2026", CLIENT[0], "CH-L", "Changes taille L", "2", ...CLIENT.slice(1)]
    ]);
    assert.equal(r.status, 200, r.body?.error);
    assert.deepEqual(commandesDe(CLIENT[0]).map(o => o.dateCommande), ["2026-03-03"], `colonne « ${entete} » ignoree`);
  }
});

test("une date ECRITE mais ILLISIBLE : ligne en erreur, jamais datee du jour", async () => {
  semer();
  const r = await importerVentes(baseUrl, [
    ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"],
    ["le 3 mars", CLIENT[0], "CH-L", "Changes taille L", "2", ...CLIENT.slice(1)],
    ["31/02/2026", "Cabinet Neuf", "ALE", "Aleses", "1", "2 rue Neuve", "39100", "Dole"],
    ["04/03/2026", "EHPAD du Lac", "ALE", "Aleses", "3", "1 route du Lac", "39130", "Clairvaux"]
  ]);
  assert.equal(r.status, 200, r.body?.error);
  const db = readDb();
  assert.ok(!db.commandes.some(o => o.dateCommande === aujourdhui()), "une ligne a la date illisible a ete datee du jour de l'import");
  assert.deepEqual(db.commandes.map(o => [o.clientName, o.dateCommande]), [["EHPAD du Lac", "2026-03-04"]]);
  assert.equal(r.body.lignesIllisibles, 2);
  assert.equal(r.body.lignesEnErreur?.dateIllisible, 2);
});

test("temoin : pas de date (pas de colonne, ou cellule vide) garde le repli documente -- le jour de l'import", async () => {
  semer();
  const sansColonne = await importerVentes(baseUrl, [
    ["Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"],
    [CLIENT[0], "CH-L", "Changes taille L", "2", ...CLIENT.slice(1)]
  ]);
  assert.equal(sansColonne.status, 200, sansColonne.body?.error);
  assert.deepEqual(commandesDe(CLIENT[0]).map(o => o.dateCommande), [aujourdhui()]);
  assert.equal(sansColonne.body.lignesIllisibles, 0);

  semer();
  const celluleVide = await importerVentes(baseUrl, [
    ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"],
    ["", CLIENT[0], "CH-L", "Changes taille L", "2", ...CLIENT.slice(1)]
  ]);
  assert.equal(celluleVide.status, 200, celluleVide.body?.error);
  assert.deepEqual(commandesDe(CLIENT[0]).map(o => o.dateCommande), [aujourdhui()]);
  assert.equal(celluleVide.body.lignesIllisibles, 0);
});

test("quantite VIDE ou illisible : ligne en erreur, plus jamais 1 ; 0 reste une quantite", async () => {
  semer();
  const r = await importerVentes(baseUrl, [
    ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"],
    ["10/09/2026", CLIENT[0], "CH-L", "Changes taille L", "", ...CLIENT.slice(1)],
    ["10/09/2026", CLIENT[0], "ALE", "Aleses", "trois", ...CLIENT.slice(1)],
    ["10/09/2026", "Cabinet Neuf", "ALE", "Aleses", "0", "2 rue Neuve", "39100", "Dole"]
  ]);
  assert.equal(r.status, 200, r.body?.error);
  assert.deepEqual(commandesDe(CLIENT[0]), [], "une quantite vide a donne une commande (quantite 1)");
  assert.deepEqual(commandesDe("Cabinet Neuf").map(o => o.products.map(p => [p.code, Number(p.quantite)])), [[["ALE", 0]]]);
  assert.equal(r.body.lignesIllisibles, 2);
  assert.equal(r.body.lignesEnErreur?.sansQuantite, 2);
});

test("ligne SANS CLIENT (ou sans produit) : en erreur, plus de commande « Client sans nom »", async () => {
  semer();
  const r = await importerVentes(baseUrl, [
    ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"],
    ["10/09/2026", "", "ALE", "Aleses", "4", "", "", ""],
    ["10/09/2026", CLIENT[0], "", "", "2", ...CLIENT.slice(1)],
    ["10/09/2026", "", "", "", "5", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["10/09/2026", "EHPAD du Lac", "ALE", "Aleses", "3", "1 route du Lac", "39130", "Clairvaux"]
  ]);
  assert.equal(r.status, 200, r.body?.error);
  const db = readDb();
  assert.ok(!db.commandes.some(o => o.clientName === "Client sans nom"), "une ligne sans client a cree une commande « Client sans nom »");
  assert.deepEqual(db.commandes.map(o => o.clientName), ["EHPAD du Lac"]);
  assert.equal(r.body.lignesIllisibles, 3, "la ligne entierement vide ne compte pas ; les trois autres oui");
  assert.deepEqual(r.body.lignesEnErreur, { sansClientNiProduit: 1, sansClient: 1, sansProduit: 1, sansQuantite: 0, dateIllisible: 0 });
  const entree = db.historique.find(h => h.type === "Import ventes");
  assert.match(entree.message, /3 ligne\(s\) en erreur ecartee\(s\)/);
});

// Relecture adverse du 26/09 : un bon DEJA importe dont une ligne est
// maintenant en erreur. Jusqu'au 25/09, une quantite vide valait 1 (et une
// ligne sans produit restait dans le bon) : le bon Carre du 18/05 a ete
// importe avec ses 3 lignes. Reimporte (fichier cumulatif), la ligne sans
// quantite est ecartee ; les 2 autres remplacaient alors les lignes de vente
// du bon et reecrivaient la commande encore a preparer : un produit sortait de
// la commande, son montant baissait, et le resume ne disait qu'« 1 ligne sans
// quantite lisible ecartee ».
const ENTETE_TTC = ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville", "TTC"];
const BON_CARRE = [
  ENTETE_TTC,
  ["18/05/2026", CLIENT[0], "CH-L", "Changes taille L", "2", ...CLIENT.slice(1), "24"],
  ["18/05/2026", CLIENT[0], "ALE", "Aleses", "3", ...CLIENT.slice(1), "15"],
  ["18/05/2026", CLIENT[0], "GAN", "Gants", "1", ...CLIENT.slice(1), "8"]
];
const produitsDe = commande => commande.products.map(p => [p.code, Number(p.quantite)]);
const idsDesVentes = () => readDb().ventes.map(v => v.id).sort();

for (const [cause, abimer, compte] of [
  ["quantite vide", ligne => { ligne[4] = ""; }, "sansQuantite"],
  ["sans produit", ligne => { ligne[2] = ""; ligne[3] = ""; }, "sansProduit"]
]) {
  test(`un bon DEJA importe dont une ligne est maintenant en erreur (${cause}) : la commande a preparer n'est pas reecrite, les ventes du bon restent ; le resume dit pourquoi`, async () => {
    semer();
    // L'etat qu'a laisse l'ancien import : le bon avec ses 3 lignes.
    const premier = await importerVentes(baseUrl, BON_CARRE);
    assert.equal(premier.status, 200, premier.body?.error);
    const [avant] = commandesDe(CLIENT[0]);
    assert.equal(avant.products.length, 3, "prealable : le bon importe a 3 lignes");
    const ventesAvant = idsDesVentes();

    const fichier = BON_CARRE.map(ligne => [...ligne]);
    abimer(fichier[3]);
    const r = await importerVentes(baseUrl, fichier);
    assert.equal(r.status, 200, r.body?.error);
    assert.equal(r.body.lignesEnErreur?.[compte], 1, "prealable : la ligne est en erreur");
    const [apres] = commandesDe(CLIENT[0]);
    assert.deepEqual(produitsDe(apres), produitsDe(avant), "un produit est sorti de la commande a preparer");
    assert.equal(apres.montantTtc, avant.montantTtc, "le montant de la commande a change");
    assert.deepEqual(idsDesVentes(), ventesAvant, "les lignes de vente du bon ont ete remplacees par ses seules lignes lisibles");
    const ignoree = (r.body.ignorees || []).find(i => i.id === apres.id);
    assert.equal(ignoree?.raison, "ligne_en_erreur", "le resume ne dit pas que la commande est laissee telle quelle");
    assert.equal(r.body.updated, 0);
  });
}

test("temoin : le meme bon CORRIGE dans Ximi (quantite remplie, une autre) -- la commande a preparer suit le fichier", async () => {
  semer();
  await importerVentes(baseUrl, BON_CARRE);
  const fichier = BON_CARRE.map(ligne => [...ligne]);
  fichier[3][4] = "4";
  fichier[3][8] = "32";
  const r = await importerVentes(baseUrl, fichier);
  assert.equal(r.status, 200, r.body?.error);
  assert.equal(r.body.updated, 1);
  const [apres] = commandesDe(CLIENT[0]);
  assert.deepEqual(produitsDe(apres), [["CH-L", 2], ["ALE", 3], ["GAN", 4]]);
  assert.equal(apres.montantTtc, 71);
  assert.equal(readDb().ventes.length, 3, "les lignes du bon sont en double");
});

test("temoin : un NOUVEAU bon avec une ligne en erreur est cree avec ses lignes lisibles (rien a proteger), la ligne est comptee", async () => {
  semer();
  const fichier = BON_CARRE.map(ligne => [...ligne]);
  fichier[3][4] = "";
  const r = await importerVentes(baseUrl, fichier);
  assert.equal(r.status, 200, r.body?.error);
  assert.equal(r.body.created, 1);
  assert.deepEqual(produitsDe(commandesDe(CLIENT[0])[0]), [["CH-L", 2], ["ALE", 3]]);
  assert.equal(r.body.lignesEnErreur.sansQuantite, 1);
  assert.equal(readDb().ventes.length, 2);
});

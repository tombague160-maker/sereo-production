// Les pieges de l'import des ventes (audit du 24/09, decision 1 de Thomas).
//
// Mesure de l'audit : un import dont une ligne visait une commande DEJA EN
// TOURNEE remplacait ses produits (3 Changes L + 3 Aleses devenaient 8 Changes
// L), chez le livreur aussi, sans un mot. Et le stock devenait faux : la
// reservation avait ete deduite sur les ANCIENS produits, la liberation se
// calcule sur les NOUVEAUX (releaseOrderStockReservation).
//
// Decision 1 : une commande deja prete, en tournee ou livree n'est plus
// touchee (ni produits, ni quantites, ni stock) ; le resume la compte
// « ignoree » avec sa raison. Le resume dit aussi les lignes illisibles.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { zipSync, strToU8 } = require("fflate");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-pieges-import-"));
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

// Un classeur minimal (une feuille, texte en ligne), comme dans api.test.js.
function classeur(lignes) {
  const echapper = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const colonne = i => String.fromCharCode(65 + i);
  const feuille = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lignes.map((l, r) => `<row r="${r + 1}">${l.map((c, i) => `<c r="${colonne(i)}${r + 1}" t="inlineStr"><is><t>${echapper(c)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const fichiers = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Feuille1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(feuille)
  };
  return new Blob([Buffer.from(zipSync(fichiers))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function importer(lignes) {
  const form = new FormData();
  form.append("file", classeur(lignes), "ventes.xlsx");
  const res = await fetch(`${baseUrl}/api/import/ventes`, { method: "POST", body: form });
  return { status: res.status, body: await res.json() };
}

async function poster(chemin, corps = {}) {
  const res = await fetch(`${baseUrl}${chemin}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps)
  });
  return { status: res.status, body: await res.json() };
}

const JOUR = "2026-09-24";
const ENTETE = ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"];
const TILLEULS = { id: "c-t", nom: "EHPAD Les Tilleuls", rue: "12 avenue du General de Gaulle", codePostal: "25000", ville: "Besancon" };
// La ligne d'import qui vise la commande du 24/09 des Tilleuls : 8 Changes L.
const LIGNE_8_CHANGES = ["24/09/2026", TILLEULS.nom, "CH-L", "Changes taille L", "8", TILLEULS.rue, TILLEULS.codePostal, TILLEULS.ville];
const PRODUITS_AVANT = [
  { code: "CH-L", nom: "Changes taille L", quantite: 3 },
  { code: "ALE", nom: "Aleses", quantite: 3 }
];

/** Une base : les Tilleuls, un stock de 20 et 20 (DEJA deduit de la reservation), une commande du 24/09. */
function semer(commande, routes = []) {
  const db = defaultDb();
  db.clients = [{ ...TILLEULS }];
  db.stock = [
    { id: "p-ch", code: "CH-L", nom: "Changes taille L", quantite: 20 },
    { id: "p-ale", code: "ALE", nom: "Aleses", quantite: 20 }
  ];
  db.commandes = [{
    id: "o-t", numero: "CMD-2026-003", clientId: "c-t", clientName: TILLEULS.nom,
    address: TILLEULS.rue, city: TILLEULS.ville, postalCode: TILLEULS.codePostal, sector: "Besancon",
    dateCommande: JOUR, deliveryDate: JOUR, products: PRODUITS_AVANT.map(p => ({ ...p })),
    ...commande
  }];
  db.routes = routes;
  writeDb(db, { backup: false });
}

const lignes = order => (order.products || []).map(p => [p.code, Number(p.quantite)]);
const stockDe = db => Object.fromEntries(db.stock.map(p => [p.code, Number(p.quantite)]));
const commandeLue = () => readDb().commandes.find(o => o.id === "o-t");

test("import — une commande EN TOURNEE n'est pas touchee : produits, arret du livreur, stock", async () => {
  semer({ status: "en_livraison", routeId: "r-1", stockReservedAt: "2026-09-24T07:00:00.000Z" }, [{
    id: "r-1", status: "en_livraison", deliveryDate: JOUR, name: "Tournee Besancon",
    stops: [{ id: "s-t", routeId: "r-1", orderId: "o-t", clientId: "c-t", clientName: TILLEULS.nom, orderIndex: 1,
      address: TILLEULS.rue, city: TILLEULS.ville, postalCode: TILLEULS.codePostal, status: "en_livraison",
      products: PRODUITS_AVANT.map(p => ({ ...p })) }]
  }]);
  const avant = readDb();

  const r = await importer([ENTETE, LIGNE_8_CHANGES]);
  assert.equal(r.status, 200, r.body?.error);

  const apres = readDb();
  const commande = apres.commandes.find(o => o.id === "o-t");
  assert.deepEqual(lignes(commande), [["CH-L", 3], ["ALE", 3]], "la commande en tournee a ete reecrite par l'import");
  assert.deepEqual(lignes(apres.routes[0].stops[0]), [["CH-L", 3], ["ALE", 3]], "l'arret du livreur a change");
  assert.deepEqual(stockDe(apres), stockDe(avant), "l'import a bouge le stock");
  assert.equal(commande.status, "en_livraison");
  assert.equal(apres.commandes.length, 1, "l'import a cree une commande en double");
  // Le resume : rien de mis a jour, une ignoree, et pourquoi.
  assert.equal(r.body.updated, 0);
  assert.equal(r.body.ignored, 1);
  assert.deepEqual(r.body.ignorees.map(i => [i.id, i.numero, i.raison]), [["o-t", "CMD-2026-003", "en_tournee"]]);
});

test("import — stock juste : une commande a reprogrammer ignoree rend EXACTEMENT ce qu'elle avait pris", async () => {
  // Avant : l'import reecrivait la commande (8 Changes L, plus d'Aleses) ; la
  // liberation rendait 8 Changes au lieu de 3, et les 3 Aleses jamais.
  semer({ status: "a_reprogrammer", stockReservedAt: "2026-09-24T07:00:00.000Z" });
  const r = await importer([ENTETE, LIGNE_8_CHANGES]);
  assert.equal(r.status, 200, r.body?.error);

  const liberation = await poster("/api/orders/o-t/release-stock", { reason: "banc" });
  assert.equal(liberation.status, 200, liberation.body?.error);
  assert.deepEqual(stockDe(readDb()), { "CH-L": 23, ALE: 23 }, "le stock rendu n'est pas celui qui avait ete pris");
  assert.deepEqual((r.body.ignorees || []).map(i => i.raison), ["partie_en_tournee"]);
});

test("import — une commande PRETE hors tournee, une commande LIVREE : ignorees, chacune avec sa raison", async () => {
  for (const [status, raison] of [["pret_livraison", "prete"], ["livre", "livree"]]) {
    semer({ status });
    const r = await importer([ENTETE, LIGNE_8_CHANGES]);
    assert.equal(r.status, 200, r.body?.error);
    assert.deepEqual(lignes(commandeLue()), [["CH-L", 3], ["ALE", 3]], `commande ${status} reecrite`);
    assert.equal(commandeLue().status, status);
    assert.deepEqual(r.body.ignorees.map(i => i.raison), [raison], status);
    assert.equal(r.body.updated, 0, status);
  }
});

test("import — une commande prete dans une tournee PAS ENCORE PARTIE est « en tournee »", async () => {
  semer({ status: "pret_livraison", routeId: "r-2" }, [{
    id: "r-2", status: "prete", deliveryDate: JOUR, name: "Tournee Besancon",
    stops: [{ id: "s-t", routeId: "r-2", orderId: "o-t", clientId: "c-t", clientName: TILLEULS.nom, orderIndex: 1,
      status: "pret_livraison", products: PRODUITS_AVANT.map(p => ({ ...p })) }]
  }]);
  const r = await importer([ENTETE, LIGNE_8_CHANGES]);
  assert.deepEqual(lignes(commandeLue()), [["CH-L", 3], ["ALE", 3]], "la commande d'une tournee prete a ete reecrite");
  assert.deepEqual((r.body.ignorees || []).map(i => i.raison), ["en_tournee"]);
});

test("import — temoin : une commande encore A PREPARER est toujours mise a jour", async () => {
  // Sans ce temoin, un verrou pose sur TOUTES les commandes rendrait les cas
  // precedents verts.
  semer({ status: "stock_a_verifier" });
  const r = await importer([ENTETE, LIGNE_8_CHANGES]);
  assert.equal(r.status, 200, r.body?.error);
  assert.equal(r.body.updated, 1);
  assert.equal(r.body.ignored, 0);
  assert.deepEqual(r.body.ignorees, []);
  assert.deepEqual(lignes(commandeLue()), [["CH-L", 8]]);
});

test("import — le resume compte juste : nouvelles, identiques, lignes illisibles (une ligne vide n'en est pas une)", async () => {
  semer({ status: "livre" });
  const nouvelle = ["24/09/2026", "Pharmacie du Pont", "ALE", "Aleses", "2", "3 rue du Pont", "39100", "Dole"];
  const illisible = ["24/09/2026", "", "", "", "5", "", "", ""];
  const vide = ["", "", "", "", "", "", "", ""];
  const r1 = await importer([ENTETE, nouvelle, illisible, vide, LIGNE_8_CHANGES]);
  assert.equal(r1.status, 200, r1.body?.error);
  assert.equal(r1.body.created, 1);
  assert.equal(r1.body.updated, 0);
  assert.equal(r1.body.ignored, 1);
  assert.equal(r1.body.lignesIllisibles, 1, "la ligne sans client ni produit n'est pas comptee (ou la ligne vide l'est)");

  // Le meme fichier, une seconde fois : la nouvelle est identique, la livree reste ignoree.
  const r2 = await importer([ENTETE, nouvelle, illisible, vide, LIGNE_8_CHANGES]);
  assert.equal(r2.body.created, 0);
  assert.equal(r2.body.skippedIdentical, 1);
  assert.equal(r2.body.ignored, 1);
});

test("import — l'historique dit les commandes laissees telles quelles", async () => {
  semer({ status: "en_livraison" });
  await importer([ENTETE, LIGNE_8_CHANGES]);
  const entree = readDb().historique.find(h => h.type === "Import ventes");
  assert.ok(entree, "aucune entree d'historique pour l'import");
  assert.match(entree.message, /1 commande\(s\) deja prete\(s\), en tournee ou livree\(s\) laissee\(s\) telle\(s\) quelle\(s\)/);
});

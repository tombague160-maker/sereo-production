// Stock et reservations (chasse aux defauts du 24/09, lot « stock ») -- la
// part SERVEUR, sur un vrai serveur ensemence (SQLite).
//
// 1. Une commande dont le stock est DEJA sorti du rayon (saisie chez le
//    client, planifiee confirmee) etait reevaluee contre le rayon deja reduit :
//    6 pris sur 10, il en reste 4, « 6 demandes pour 4 » -> « Bloquee stock »,
//    le bouton « Passer en preparation » grise, Reserve 0 au Stock.
// 2. Deux lignes du MEME produit dans une commande etaient controlees chacune
//    seule : 3 + 3 sur un rayon de 5 passait, le rayon tombait a 0 (une unite
//    perdue sans trace), et la liberation en rendait 6.
// 3. PATCH /api/orders/:id faisait passer une commande en preparation puis la
//    livrait sans jamais sortir son stock du rayon.
// 4. /api/recommendations comptait deux fois une commande deja sortie du rayon
//    (7 sortis, rayon 3, seuil 5 : 4 recommandes au lieu de 2).
//
// Chaque cas mesure le rayon (quantityAvailable) et la reserve
// (quantityReserved) de GET /api/stock.

const { after, before, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-stock-juste-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const { zipSync, strToU8 } = require("fflate");
const { app, closeStorage, defaultDb, writeDb } = require("../server");

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

/** Un classeur .xlsx minimal (une feuille, cellules texte), comme carte-telephone.test.js. */
function classeur(lignes) {
  const echapper = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const colonne = i => String.fromCharCode(65 + i);
  const feuille = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lignes.map((ligne, r) =>
    `<row r="${r + 1}">${ligne.map((c, i) => `<c r="${colonne(i)}${r + 1}" t="inlineStr"><is><t>${echapper(c)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const fichiers = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Feuille1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(feuille)
  };
  return new Blob([Buffer.from(zipSync(fichiers))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function importer(type, lignes) {
  const form = new FormData();
  form.append("file", classeur(lignes), `${type}.xlsx`);
  return demander(`/api/import/${type}`, { method: "POST", body: form });
}

function ensemencer(extra = {}) {
  writeDb({
    ...defaultDb(),
    stock: [
      { id: "p1", code: "CH-L", nom: "Changes L", quantite: 10, tarif: 12, alertThreshold: 2 },
      { id: "p2", code: "ALE", nom: "Aleses", quantite: 5, tarif: 5, alertThreshold: 1 }
    ],
    clients: [{ id: "c1", nom: "EHPAD Les Tilleuls", rue: "1 rue des Lilas", ville: "Dole", codePostal: "39100", telephone: "0384000001", crmStatus: "client_actif" }],
    ...extra
  }, { backup: false });
}

beforeEach(() => ensemencer());

/** Le rayon et la reserve d'un produit, tels que l'ecran Stock les lit. */
async function produit(id) {
  const { body } = await demander("/api/stock");
  const p = body.find(item => item.id === id);
  return { rayon: p.quantityAvailable, reserve: p.quantityReserved, total: p.quantityTotal, statut: p.stockStatus };
}
async function commande(id) {
  const { body } = await demander("/api/orders");
  return body.find(o => o.id === id);
}

// ---------------------------------------------------------------------------
// 1. La commande au stock deja sorti ne se bloque plus elle-meme
// ---------------------------------------------------------------------------

test("commande terrain de 6 sur un rayon de 10 : reservee, « à préparer », jamais « bloquée »", async () => {
  const cree = await envoyer("POST", "/api/customer-orders", { clientId: "c1", products: [{ productId: "p1", quantite: 6 }] });
  assert.equal(cree.status, 201);
  assert.equal(cree.body.bloquee, false, "la reponse de creation ne la dit pas bloquee");

  const o = await commande(cree.body.id);
  assert.ok(o.stockReservedAt, "le stock est sorti du rayon a la creation");
  assert.deepEqual(
    { status: o.status, canPrepare: o.canPrepare, stockStatus: o.stockStatus },
    { status: "stock_a_verifier", canPrepare: true, stockStatus: "reserve" },
    "une commande dont le stock est reserve n'est pas comparee au rayon qu'elle a deja reduit"
  );
  assert.deepEqual(await produit("p1"), { rayon: 4, reserve: 6, total: 10, statut: "reserve" },
    "le Stock dit « Réservé 6 », et le total physique reste 10");

  const { body: tableau } = await demander("/api/dashboard");
  assert.equal(tableau.orders.blocked, 0, "le tableau de bord ne la compte pas bloquee");
  assert.equal(tableau.orders.preparable, 1);
  assert.ok(!tableau.alerts.some(a => a.type === "commande" && /bloquee/i.test(a.message)), "aucune alerte « Commande bloquee »");

  // Le geste de l'ecran passe, et ne sort pas le stock une seconde fois.
  const lancee = await envoyer("POST", `/api/orders/${cree.body.id}/start-preparation`);
  assert.equal(lancee.status, 200);
  assert.deepEqual(await produit("p1"), { rayon: 4, reserve: 6, total: 10, statut: "reserve" });
});

test("planifiee de 6 confirmee sur un rayon de 10 : reservee, jamais « bloquée »", async () => {
  const planifiee = await envoyer("POST", "/api/planned-orders", {
    clientId: "c1", products: [{ productId: "p1", quantite: 6 }], deliveryDate: "2026-12-15"
  });
  assert.equal(planifiee.status, 201);
  const id = planifiee.body.order.id;
  const confirmee = await envoyer("POST", `/api/planned-orders/${id}/confirm`);
  assert.equal(confirmee.status, 200);
  const o = await commande(id);
  assert.deepEqual({ canPrepare: o.canPrepare, stockStatus: o.stockStatus }, { canPrepare: true, stockStatus: "reserve" });
  assert.deepEqual(await produit("p1"), { rayon: 4, reserve: 6, total: 10, statut: "reserve" });
});

test("temoin : une commande importee NON reservee qui depasse le rayon reste bloquee", async () => {
  ensemencer({
    commandes: [{
      id: "o-imp", numero: "CMD-2026-001", clientId: "c1", clientName: "EHPAD Les Tilleuls", status: "stock_a_verifier",
      dateCommande: "2026-09-20", products: [{ code: "CH-L", nom: "Changes L", quantite: 12 }]
    }]
  });
  const o = await commande("o-imp");
  assert.deepEqual({ canPrepare: o.canPrepare, stockStatus: o.stockStatus }, { canPrepare: false, stockStatus: "insuffisant" });
  assert.deepEqual(await produit("p1"), { rayon: 10, reserve: 0, total: 10, statut: "disponible" });
});

// ---------------------------------------------------------------------------
// 2. Deux lignes du meme produit : additionnees
// ---------------------------------------------------------------------------

test("deux lignes du meme produit (3 + 3) sur un rayon de 5 : additionnees, rien ne sort, rien ne se cree", async () => {
  const cree = await envoyer("POST", "/api/customer-orders", {
    clientId: "c1", products: [{ productId: "p2", quantite: 3 }, { productId: "p2", quantite: 3 }]
  });
  assert.equal(cree.status, 201);
  // Decision 11 : acceptee, mais bloquee faute de stock -- 6 demandes, 5 en rayon.
  assert.equal(cree.body.bloquee, true, "6 demandes pour 5 en rayon : la commande attend le stock");
  assert.deepEqual(await produit("p2"), { rayon: 5, reserve: 0, total: 5, statut: "disponible" },
    "rien n'est sorti du rayon (avant : 0, une unite perdue)");
  const o = await commande(cree.body.id);
  assert.equal(o.canPrepare, false);
  const manque = o.stockLines.filter(l => l.status === "missing")
    .reduce((s, l) => s + Math.max(0, l.required - Math.max(0, l.available)), 0);
  assert.equal(manque, 1, "l'ecran dit « Il manque 1 article » (la somme des lignes, pas chaque ligne seule)");

  const lancee = await envoyer("POST", `/api/orders/${cree.body.id}/start-preparation`);
  assert.equal(lancee.status, 400, "la preparation est refusee : le rayon ne couvre pas la somme");

  const annulee = await envoyer("PATCH", `/api/orders/${cree.body.id}`, { status: "annulee" });
  assert.equal(annulee.status, 200);
  assert.deepEqual(await produit("p2"), { rayon: 5, reserve: 0, total: 5, statut: "disponible" },
    "l'annulation ne cree pas de stock (avant : 6)");
});

// Temoin (vert avant et apres) : l'addition ne refuse pas ce que le rayon couvre.
test("temoin : deux lignes du meme produit (2 + 2) sur 5 : sorties ensemble, rendues ensemble", async () => {
  const cree = await envoyer("POST", "/api/customer-orders", {
    clientId: "c1", products: [{ productId: "p2", quantite: 2 }, { productId: "p2", quantite: 2 }]
  });
  assert.equal(cree.body.bloquee, false);
  assert.equal((await produit("p2")).rayon, 1);
  await envoyer("PATCH", `/api/orders/${cree.body.id}`, { status: "annulee" });
  assert.equal((await produit("p2")).rayon, 5);
});

test("import : la meme reference avec et sans code (3 + 3) sur un rayon de 5 ne passe pas en preparation", async () => {
  ensemencer({ clients: [] });
  const E = ["Client", "Rue", "Code Postal", "Ville", "Date", "Code", "Produit", "Quantite", "TTC"];
  const r = await importer("ventes", [E,
    ["Dupont", "5 rue A", "39100", "Dole", "10/09/2026", "ALE", "Aleses", "3", "15"],
    ["Dupont", "5 rue A", "39100", "Dole", "10/09/2026", "", "Aleses", "3", "15"]]);
  assert.equal(r.status, 200);
  const { body: commandes } = await demander("/api/orders");
  const o = commandes.find(x => x.clientName === "Dupont");
  assert.equal(o.products.length, 2, "prealable : la commande garde ses deux lignes");
  assert.equal(o.canPrepare, false, "6 demandes, 5 en rayon (avant : « disponible »)");
  const lancee = await envoyer("POST", `/api/orders/${o.id}/start-preparation`);
  assert.equal(lancee.status, 400);
  assert.deepEqual(await produit("p2"), { rayon: 5, reserve: 0, total: 5, statut: "disponible" });
});

// ---------------------------------------------------------------------------
// 3. PATCH /api/orders/:id sort le stock comme « Passer en preparation »
// ---------------------------------------------------------------------------

function commandeImportee(quantite) {
  return {
    id: "o-patch", numero: "CMD-2026-001", clientId: "c1", clientName: "EHPAD Les Tilleuls", status: "stock_a_verifier",
    dateCommande: "2026-09-20", products: [{ code: "CH-L", nom: "Changes L", quantite }]
  };
}

test("PATCH en preparation puis jusqu'a « livre » : le stock sort une fois, a la preparation", async () => {
  ensemencer({ commandes: [commandeImportee(4)] });
  const etapes = [];
  for (const status of ["en_preparation", "pret_livraison", "en_livraison", "livre"]) {
    const r = await envoyer("PATCH", "/api/orders/o-patch", { status });
    assert.equal(r.status, 200, `${status} : ${JSON.stringify(r.body)}`);
    etapes.push({ status, ...(await produit("p1")) });
  }
  assert.deepEqual(etapes.map(e => [e.status, e.rayon, e.reserve]), [
    ["en_preparation", 6, 4],
    ["pret_livraison", 6, 4],
    ["en_livraison", 6, 4],
    ["livre", 6, 0]
  ], "avant : le rayon restait a 10 jusqu'a la livraison");
  const o = await commande("o-patch");
  assert.equal(o.stockReleaseReason, "consumed_by_delivery");
});

test("PATCH directement « pret_livraison » depuis « a verifier » : le stock sort aussi", async () => {
  ensemencer({ commandes: [commandeImportee(4)] });
  const r = await envoyer("PATCH", "/api/orders/o-patch", { status: "pret_livraison" });
  assert.equal(r.status, 200);
  assert.deepEqual(await produit("p1"), { rayon: 6, reserve: 4, total: 10, statut: "reserve" });
});

// Relecture adverse (25/09) : une commande « a reprogrammer » dont le stock a
// ete libere a la main (release-stock), puis que PATCH remet en preparation.
// « Passer en preparation » (start-preparation) sort son stock ; PATCH ne le
// sortait pas : preparee, en carton, et le rayon comptait encore ses articles
// (une autre commande pouvait les prendre, la livraison mettait le rayon en
// negatif).
async function commandeAReprogrammerLiberee(quantite) {
  ensemencer({ commandes: [commandeImportee(quantite)] });
  for (const status of ["en_preparation", "pret_livraison", "en_livraison", "a_reprogrammer"]) {
    const r = await envoyer("PATCH", "/api/orders/o-patch", { status });
    assert.equal(r.status, 200, `${status} : ${JSON.stringify(r.body)}`);
  }
  const liberee = await envoyer("POST", "/api/orders/o-patch/release-stock", {});
  assert.equal(liberee.body.released, true, "prealable : la reservation est liberee");
  assert.deepEqual(await produit("p1"), { rayon: 10, reserve: 0, total: 10, statut: "disponible" },
    "prealable : le rayon a recupere ses 4 articles");
}

test("PATCH en preparation d'une commande « à reprogrammer » au stock libere : le stock ressort, une fois", async () => {
  await commandeAReprogrammerLiberee(4);
  const r = await envoyer("PATCH", "/api/orders/o-patch", { status: "en_preparation" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await produit("p1"), { rayon: 6, reserve: 4, total: 10, statut: "reserve" },
    "la meme sortie que « Passer en preparation » (avant : rayon 10, rien de reserve)");
  const etapes = [];
  for (const status of ["pret_livraison", "en_livraison", "livre"]) {
    const suite = await envoyer("PATCH", "/api/orders/o-patch", { status });
    assert.equal(suite.status, 200, `${status} : ${JSON.stringify(suite.body)}`);
    etapes.push([status, (await produit("p1")).rayon]);
  }
  assert.deepEqual(etapes, [["pret_livraison", 6], ["en_livraison", 6], ["livre", 6]],
    "la livraison consomme la reservation reprise, sans sortir le stock une seconde fois");
});

test("PATCH « pret_livraison » d'une commande « à reprogrammer » au stock libere : le stock ressort aussi", async () => {
  await commandeAReprogrammerLiberee(4);
  const r = await envoyer("PATCH", "/api/orders/o-patch", { status: "pret_livraison" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await produit("p1"), { rayon: 6, reserve: 4, total: 10, statut: "reserve" });
});

test("PATCH en preparation d'une « à reprogrammer » liberee, rayon insuffisant : refuse, rien ne bouge", async () => {
  await commandeAReprogrammerLiberee(4);
  // Le rayon est tombe a 3 entre-temps (saisie a la main).
  assert.equal((await envoyer("PATCH", "/api/stock/p1", { quantite: 3 })).status, 200);
  const r = await envoyer("PATCH", "/api/orders/o-patch", { status: "en_preparation" });
  assert.equal(r.status, 400, "refusee, comme « Passer en preparation » sur ce rayon");
  assert.match(r.body.error, /Stock insuffisant/);
  assert.equal((await commande("o-patch")).status, "a_reprogrammer", "la commande n'a pas bouge");
  assert.equal((await produit("p1")).rayon, 3);
});

// Temoin (vert avant et apres) : une « a reprogrammer » qui a GARDE sa
// reservation ne sort pas son stock une seconde fois.
test("temoin : PATCH en preparation d'une « à reprogrammer » qui garde sa reservation : rien ne ressort", async () => {
  ensemencer({ commandes: [commandeImportee(4)] });
  for (const status of ["en_preparation", "pret_livraison", "en_livraison", "a_reprogrammer", "en_preparation"]) {
    const r = await envoyer("PATCH", "/api/orders/o-patch", { status });
    assert.equal(r.status, 200, `${status} : ${JSON.stringify(r.body)}`);
  }
  assert.deepEqual(await produit("p1"), { rayon: 6, reserve: 4, total: 10, statut: "reserve" });
});

test("PATCH en preparation sur un rayon insuffisant : refuse, comme le geste de l'ecran", async () => {
  ensemencer({ commandes: [commandeImportee(12)] });
  const r = await envoyer("PATCH", "/api/orders/o-patch", { status: "en_preparation" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Stock insuffisant/);
  const o = await commande("o-patch");
  assert.equal(o.status, "stock_a_verifier", "la commande n'a pas bouge");
  assert.deepEqual(await produit("p1"), { rayon: 10, reserve: 0, total: 10, statut: "disponible" });
});

// ---------------------------------------------------------------------------
// 4. La quantite a acheter ne compte plus deux fois ce qui est sorti du rayon
// ---------------------------------------------------------------------------

test("/api/recommendations : 7 sortis du rayon, 3 restants, seuil 5 -> 2 a racheter", async () => {
  ensemencer({ stock: [{ id: "px", code: "X", nom: "Produit X", quantite: 10, tarif: 1, alertThreshold: 5 }] });
  const cree = await envoyer("POST", "/api/customer-orders", { clientId: "c1", products: [{ productId: "px", quantite: 7 }] });
  await envoyer("POST", `/api/orders/${cree.body.id}/start-preparation`);
  const { body } = await demander("/api/recommendations");
  const reco = body.find(p => p.id === "px");
  assert.ok(reco, "le produit sous son seuil est recommande");
  assert.equal(reco.recommendedQuantity, 2, "de quoi repasser au seuil ; les 7 sont deja servis (avant : 4)");
});

test("temoin : une commande importee non reservee compte dans le besoin a racheter", async () => {
  ensemencer({
    stock: [{ id: "px", code: "X", nom: "Produit X", quantite: 3, tarif: 1, alertThreshold: 5 }],
    commandes: [{
      id: "o-imp", numero: "CMD-2026-001", clientId: "c1", clientName: "EHPAD Les Tilleuls", status: "stock_a_verifier",
      dateCommande: "2026-09-20", products: [{ code: "X", nom: "Produit X", quantite: 7 }]
    }]
  });
  const { body } = await demander("/api/recommendations");
  assert.equal(body.find(p => p.id === "px").recommendedQuantity, 4, "7 a prendre, 3 en rayon");
});

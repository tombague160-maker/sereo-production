// L'invariant stock <-> commandes, verifie a CHAQUE etape d'un parcours qui
// enchaine les transitions (chasse aux defauts du 24/09, lot « stock » ; le
// parcours reprend celui de la chasse, scratchpad/chasse/metier/b10, et
// l'etend aux chemins ou il se rompait).
//
// Trois egalites, par produit :
//   1. physique : rayon + reserve active + consomme par les livraisons
//      = stock initial + entrees exterieures (saisie, import) ;
//   2. journal : stock initial + entrees - sorties du journal des mouvements
//      = rayon (tout ce qui change le rayon est ecrit) ;
//   3. ecran : la reserve de GET /api/stock = la reserve active des commandes ;
// et, par commande : une commande en preparation, prete ou en livraison a
// sorti son stock du rayon (4).
//
// Sur l'ancien code : le journal restait vide (2 rompu des la premiere
// preparation), la reserve d'une commande terrain valait 0 a l'ecran (3), et
// deux lignes du meme produit, ou le PATCH d'une commande, rompaient 1.
// Toutes les ruptures sont collectees, puis jugees ensemble a la fin : le
// rouge dit chaque etape et chaque egalite qui ne tient pas.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-invariant-stock-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_OSRM_LOCAL = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

// Aucun appel sortant : un banc qui parlerait a un vrai service ne jugerait plus le code.
const vraiFetch = globalThis.fetch;
globalThis.fetch = async (entree, init) => {
  const url = new URL(typeof entree === "string" ? entree : String(entree.url || entree));
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error(`appel externe interdit dans ce banc : ${url.hostname}`);
  return vraiFetch(entree, init);
};

const { zipSync, strToU8 } = require("fflate");
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
  globalThis.fetch = vraiFetch;
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
async function reussir(methode, chemin, corps) {
  const r = await envoyer(methode, chemin, corps);
  assert.ok(r.status >= 200 && r.status < 300, `${methode} ${chemin} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

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
  const r = await demander(`/api/import/${type}`, { method: "POST", body: form });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

const INITIAL = { pA: 50, pB: 50, pC: 20, pD: 5 };
const exterieur = { pA: 0, pB: 0, pC: 0, pD: 0 }; // saisies et imports : entrees de l'exterieur
const ruptures = [];

/** La quantite d'une commande pour un produit (par code), lignes non deduites exclues. */
function quantiteSuivie(order, produit) {
  const nonDeduites = new Set(order.stockNonDeduit || []);
  return (order.products || [])
    .filter(l => String(l.code).toUpperCase() === produit.code && !nonDeduites.has(`code:${produit.code.toLowerCase()}`))
    .reduce((s, l) => s + Number(l.quantite || 0), 0);
}

async function verifier(etape) {
  const db = readDb();
  const ecran = (await demander("/api/stock")).body;
  for (const p of db.stock) {
    const reserveActive = db.commandes
      .filter(o => o.stockReservedAt && !["livre", "annulee"].includes(o.status))
      .reduce((s, o) => s + quantiteSuivie(o, p), 0);
    const consomme = db.commandes
      .filter(o => o.status === "livre" && o.stockReleaseReason === "consumed_by_delivery")
      .reduce((s, o) => s + quantiteSuivie(o, p), 0);
    const attendu = INITIAL[p.id] + exterieur[p.id];
    if (p.quantite + reserveActive + consomme !== attendu) {
      ruptures.push(`[${etape}] ${p.id} physique : rayon ${p.quantite} + reserve ${reserveActive} + consomme ${consomme} != ${attendu}`);
    }
    const solde = (db.stockMovements || []).filter(m => m.productId === p.id)
      .reduce((s, m) => s + (m.type === "entree" ? m.quantity : -m.quantity), 0);
    if (INITIAL[p.id] + solde !== p.quantite) {
      ruptures.push(`[${etape}] ${p.id} journal : ${INITIAL[p.id]} + ${solde} != rayon ${p.quantite}`);
    }
    const affiche = ecran.find(x => x.id === p.id).quantityReserved;
    if (affiche !== reserveActive) {
      ruptures.push(`[${etape}] ${p.id} ecran : Reserve ${affiche} != ${reserveActive}`);
    }
  }
  for (const o of db.commandes) {
    if (["en_preparation", "preparation_terminee", "pret_livraison", "en_livraison"].includes(o.status) && !o.stockReservedAt) {
      ruptures.push(`[${etape}] ${o.numero} ${o.status} sans stock sorti du rayon`);
    }
  }
}

test("invariant stock <-> commandes, a chaque etape d'un parcours complet", async () => {
  const today = jourParis();
  const fr = today.split("-").reverse().join("/");
  writeDb({
    ...defaultDb(),
    stock: [
      { id: "pA", code: "A", nom: "Produit A", quantite: INITIAL.pA, tarif: 2 },
      { id: "pB", code: "B", nom: "Produit B", quantite: INITIAL.pB, tarif: 3 },
      { id: "pC", code: "C", nom: "Produit C", quantite: INITIAL.pC, tarif: 4 },
      { id: "pD", code: "D", nom: "Produit D", quantite: INITIAL.pD, tarif: 5 }
    ],
    clients: [
      { id: "c1", nom: "Client 1", rue: "1 r", ville: "Dole", codePostal: "39100", lat: 47.09, lng: 5.49, crmStatus: "client_actif" },
      { id: "c2", nom: "Client 2", rue: "2 r", ville: "Dole", codePostal: "39100", lat: 47.1, lng: 5.5, crmStatus: "client_actif" },
      { id: "c3", nom: "Client 3", rue: "3 r", ville: "Dole", codePostal: "39100", lat: 47.11, lng: 5.51, crmStatus: "client_actif" }
    ]
  }, { backup: false });
  await verifier("depart");

  const E = ["Client", "Rue", "Code Postal", "Ville", "Date", "Code", "Produit", "Quantite", "TTC"];
  await importer("ventes", [E, ["Client 1", "1 r", "39100", "Dole", fr, "A", "Produit A", "5", "10"], ["Client 2", "2 r", "39100", "Dole", fr, "B", "Produit B", "4", "12"]]);
  await verifier("import des ventes");
  const commandes = (await demander("/api/orders")).body;
  const o1 = commandes.find(o => o.clientName === "Client 1");
  const o2 = commandes.find(o => o.clientName === "Client 2");

  for (const o of [o1, o2]) await reussir("POST", `/api/orders/${o.id}/start-preparation`);
  await verifier("2 mises en preparation");
  for (const o of [o1, o2]) await reussir("POST", `/api/orders/${o.id}/finish-preparation`, { deliveryDate: today });
  await verifier("2 fins de preparation");

  const route = await reussir("POST", "/api/routes", { orderIds: [o1.id, o2.id], deliveryDate: today });
  await reussir("POST", `/api/routes/${route.id}/start`);
  const s1 = route.stops.find(s => s.orderId === o1.id);
  const s2 = route.stops.find(s => s.orderId === o2.id);
  await reussir("PATCH", `/api/routes/${route.id}/stops/${s1.id}`, { status: "livre" });
  await reussir("PATCH", `/api/routes/${route.id}/stops/${s2.id}`, { status: "a_reprogrammer", motif: "absent" });
  await verifier("un livre, un a reprogrammer");
  await reussir("POST", `/api/orders/${o2.id}/release-stock`, { reason: "client injoignable" });
  await verifier("liberation manuelle");
  const route2 = await reussir("POST", "/api/routes", { orderIds: [o2.id], deliveryDate: today });
  await reussir("POST", `/api/routes/${route2.id}/start`);
  await reussir("PATCH", `/api/routes/${route2.id}/stops/${route2.stops[0].id}`, { status: "livre" });
  await verifier("livree apres liberation");

  // Commande terrain qui prend plus de la moitie du rayon : reservee, jamais bloquee.
  const terrain = await reussir("POST", "/api/customer-orders", { clientId: "c3", products: [{ productId: "pA", quantite: 30 }] });
  await verifier("commande terrain de 30 sur 45");
  if (!(await demander("/api/orders")).body.find(o => o.id === terrain.id).canPrepare) ruptures.push("[commande terrain de 30 sur 45] bloquee par sa propre reservation");

  // Deux lignes du meme produit, puis annulation : 2 + 2 sur 50, puis 3 + 3 sur 5.
  const double = await reussir("POST", "/api/customer-orders", { clientId: "c3", products: [{ productId: "pB", quantite: 2 }, { productId: "pB", quantite: 2 }] });
  await verifier("deux lignes du meme produit (2 + 2 sur 46)");
  await reussir("PATCH", `/api/orders/${double.id}`, { status: "annulee" });
  await verifier("annulation des deux lignes (2 + 2)");
  const depasse = await reussir("POST", "/api/customer-orders", { clientId: "c3", products: [{ productId: "pD", quantite: 3 }, { productId: "pD", quantite: 3 }] });
  await verifier("deux lignes du meme produit (3 + 3 sur 5)");
  await reussir("PATCH", `/api/orders/${depasse.id}`, { status: "annulee" });
  await verifier("annulation des deux lignes (3 + 3)");

  // Le PATCH d'une commande importee : en preparation, puis prete.
  const hier = new Date(`${today}T12:00:00Z`); hier.setUTCDate(hier.getUTCDate() - 1);
  await importer("ventes", [E, ["Client 3", "3 r", "39100", "Dole", hier.toISOString().slice(0, 10).split("-").reverse().join("/"), "C", "Produit C", "4", "16"]]);
  const o3 = (await demander("/api/orders")).body.find(o => o.clientName === "Client 3" && o.products.some(l => l.code === "C"));
  await reussir("PATCH", `/api/orders/${o3.id}`, { status: "en_preparation" });
  await reussir("PATCH", `/api/orders/${o3.id}`, { status: "pret_livraison" });
  await verifier("PATCH en preparation puis prete");

  // Planifiee confirmee puis annulee.
  const planifiee = await reussir("POST", "/api/planned-orders", { clientId: "c1", products: [{ productId: "pA", quantite: 2 }], deliveryDate: "2026-12-15" });
  await reussir("POST", `/api/planned-orders/${planifiee.order.id}/confirm`);
  await verifier("planifiee confirmee");
  await reussir("PATCH", `/api/planned-orders/${planifiee.order.id}`, { status: "annulee" });
  await verifier("planifiee annulee");

  // Abonnement : echeance generee et confirmee, puis pause (decision 8).
  const sub = await reussir("POST", "/api/subscriptions", {
    clientId: "c2", products: [{ productId: "pC", quantite: 3 }], startDate: "2026-12-01",
    frequency: { unit: "months", interval: 1 }, reminderDays: 3, status: "active"
  });
  const echeance = (await reussir("POST", `/api/subscriptions/${sub.id}/orders`, { date: "2026-12-01" })).order;
  await reussir("POST", `/api/planned-orders/${echeance.id}/confirm`);
  await verifier("echeance d'abonnement confirmee");
  await reussir("PATCH", `/api/subscriptions/${sub.id}`, { status: "paused" });
  await verifier("abonnement mis en pause");

  // Entrees de l'exterieur : une saisie, puis un import du stock.
  await reussir("PATCH", "/api/stock/pA", { quantite: (readDb().stock.find(p => p.id === "pA").quantite) + 5, reason: "Reception fournisseur" });
  exterieur.pA += 5;
  await verifier("saisie a la main (+5)");
  const avantImport = readDb().stock.find(p => p.id === "pC").quantite;
  await importer("stock", [["Code", "Nom", "Quantite"], ["C", "Produit C", String(avantImport + 7)]]);
  exterieur.pC += 7;
  await verifier("import du stock (+7)");

  // La commande terrain part en preparation puis est livree par l'ecran Commandes.
  await reussir("POST", `/api/orders/${terrain.id}/start-preparation`);
  await reussir("PATCH", `/api/orders/${terrain.id}`, { status: "pret_livraison" });
  await reussir("PATCH", `/api/orders/${terrain.id}`, { status: "en_livraison" });
  await reussir("PATCH", `/api/orders/${terrain.id}`, { status: "livre" });
  await verifier("commande terrain livree");

  assert.deepEqual(ruptures, [], "l'invariant tient a chaque etape");
});

// Lot « stock » (chasse aux defauts du 24/09) : le journal des mouvements de
// stock rempli par TOUT ce qui change le rayon, avec l'auteur.
//
// Avant : seul PATCH /api/stock/:id (la saisie a la main) y ecrivait. Une
// commande terrain (rayon 10 -> 4), une deuxieme (5 -> 0) puis une annulation
// (0 -> 6) laissaient /api/stock-movements VIDE : un ecart d'inventaire ne se
// retracait pas depuis l'ecran Stock.
//
// Desormais : la sortie d'une commande (saisie chez le client, confirmation,
// mise en preparation), le retour au rayon (annulation, liberation), la
// livraison acceptee sur un stock insuffisant, et l'import du stock quand sa
// colonne Quantite change le rayon. Chaque mouvement porte la commande
// (orderId, numero) et l'auteur (createdBy : le compte connecte, comme le lot
// « donnees utiles » l'a pose sur la saisie a la main).
//
// L'authentification est ALLUMEE (autre processus que les bancs sans
// connexion : les variables sont lues au chargement).

const { after, before, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-journal-stock-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
// Identifiants jetables d'un serveur de banc, base temporaire detruite a la fin.
process.env.SEREO_AUTH_USER = "admin-banc";
process.env.SEREO_AUTH_PASSWORD = "mot-de-passe-banc-sans-valeur";
process.env.SEREO_AUTH_MAX_ATTEMPTS = "50";
process.env.SEREO_AUTH_RATE_WINDOW_MS = "60000";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const { zipSync, strToU8 } = require("fflate");
const { app, closeStorage, createUserAccount, defaultDb, readDb, writeDb, _resetAuthRateLimitForTest } = require("../server");

let server;
let baseUrl;
let marc;
let admin;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await createUserAccount({ identifiant: "marc", motDePasse: "bureau-du-matin-2026", role: "bureau" });
  marc = await connexion("marc", "bureau-du-matin-2026");
  admin = await connexion("admin-banc", "mot-de-passe-banc-sans-valeur");
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function connexion(identifiant, motDePasse) {
  _resetAuthRateLimitForTest();
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: identifiant, password: motDePasse }),
    redirect: "manual"
  });
  const cookie = (res.headers.getSetCookie?.() || []).find(v => v.startsWith("sereo_access="));
  assert.ok(cookie, `connexion de ${identifiant} refusee (${res.status})`);
  return cookie.split(";")[0];
}

async function demander(methode, chemin, cookie, corps) {
  const multipart = corps instanceof FormData;
  const res = await fetch(`${baseUrl}${chemin}`, {
    method: methode,
    headers: { cookie, ...(corps !== undefined && !multipart ? { "content-type": "application/json" } : {}) },
    body: corps === undefined ? undefined : (multipart ? corps : JSON.stringify(corps)),
    redirect: "manual"
  });
  const texte = await res.text();
  let body = null;
  try { body = texte ? JSON.parse(texte) : null; } catch { body = texte; }
  return { status: res.status, body };
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

const INITIAL = { p1: 10, p2: 5 };

function ensemencer(extra = {}) {
  writeDb({
    ...defaultDb(),
    stock: [
      { id: "p1", code: "CH-L", nom: "Changes L", quantite: INITIAL.p1, tarif: 12 },
      { id: "p2", code: "ALE", nom: "Aleses", quantite: INITIAL.p2, tarif: 5 }
    ],
    clients: [{ id: "c1", nom: "EHPAD Les Tilleuls", rue: "1 rue des Lilas", ville: "Dole", codePostal: "39100", crmStatus: "client_actif" }],
    ...extra
  }, { backup: false });
}

beforeEach(() => ensemencer());

/** Les mouvements du journal, du plus ancien au plus recent (lus dans la base : l'auteur y est). */
function mouvements() {
  return [...(readDb().stockMovements || [])].reverse()
    .map(m => ({ produit: m.productId, type: m.type, quantite: m.quantity, avant: m.oldQuantity, apres: m.newQuantity, motif: m.reason, commande: m.numero || null, orderId: m.orderId || null, auteur: m.createdBy }));
}

/** Le journal explique le rayon : pour chaque produit, initial + entrees - sorties = rayon. */
function journalExpliqueLeRayon() {
  const db = readDb();
  const ecarts = [];
  for (const p of db.stock) {
    const solde = (db.stockMovements || []).filter(m => m.productId === p.id)
      .reduce((s, m) => s + (m.type === "entree" ? m.quantity : -m.quantity), 0);
    if ((INITIAL[p.id] ?? 0) + solde !== p.quantite) ecarts.push(`${p.id} : ${INITIAL[p.id]} + ${solde} != ${p.quantite}`);
  }
  return ecarts;
}

test("commande terrain puis annulation : la sortie et le retour au rayon sont au journal, avec la commande et l'auteur", async () => {
  const cree = await demander("POST", "/api/customer-orders", marc, { clientId: "c1", products: [{ productId: "p1", quantite: 6 }] });
  assert.equal(cree.status, 201);
  const numero = cree.body.numero;
  const annulee = await demander("PATCH", `/api/orders/${cree.body.id}`, marc, { status: "annulee" });
  assert.equal(annulee.status, 200);

  assert.deepEqual(mouvements(), [
    { produit: "p1", type: "sortie", quantite: 6, avant: 10, apres: 4, motif: `Sortie pour la commande ${numero} (EHPAD Les Tilleuls)`, commande: numero, orderId: cree.body.id, auteur: "marc" },
    { produit: "p1", type: "entree", quantite: 6, avant: 4, apres: 10, motif: `Rendue au rayon : commande ${numero} (EHPAD Les Tilleuls) (commande annulée)`, commande: numero, orderId: cree.body.id, auteur: "marc" }
  ], "avant : aucun mouvement");
  assert.deepEqual(journalExpliqueLeRayon(), []);

  // L'ecran Stock (sans auteur) les montre dans « Mouvements recents ».
  const recents = await demander("GET", "/api/stock-movements?limite=12", marc);
  assert.equal(recents.body.length, 2);
  assert.ok(recents.body.every(m => !("createdBy" in m)), "toujours sans auteur pour tous les comptes");
});

test("deux lignes du meme produit : UN mouvement de la somme", async () => {
  const cree = await demander("POST", "/api/customer-orders", marc, {
    clientId: "c1", products: [{ productId: "p2", quantite: 2 }, { productId: "p2", quantite: 2 }]
  });
  assert.equal(cree.status, 201);
  assert.deepEqual(mouvements().map(m => [m.produit, m.type, m.quantite, m.avant, m.apres]), [["p2", "sortie", 4, 5, 1]]);
  assert.deepEqual(journalExpliqueLeRayon(), []);
});

test("planifiee confirmee, commande importee mise en preparation : chaque sortie", async () => {
  const planifiee = await demander("POST", "/api/planned-orders", marc, {
    clientId: "c1", products: [{ productId: "p1", quantite: 3 }], deliveryDate: "2026-12-15"
  });
  const id = planifiee.body.order.id;
  await demander("POST", `/api/planned-orders/${id}/confirm`, marc);
  // Une commande importee (non reservee) mise en preparation par l'ecran.
  const db = readDb();
  db.commandes.push({
    id: "o-imp", numero: "CMD-2026-900", clientId: "c1", clientName: "EHPAD Les Tilleuls", status: "stock_a_verifier",
    dateCommande: "2026-09-20", products: [{ code: "ALE", nom: "Aleses", quantite: 2 }]
  });
  writeDb(db, { backup: false });
  const lancee = await demander("POST", "/api/orders/o-imp/start-preparation", marc);
  assert.equal(lancee.status, 200);

  assert.deepEqual(mouvements().map(m => [m.produit, m.type, m.quantite, m.commande, m.auteur]), [
    ["p1", "sortie", 3, planifiee.body.order.numero, "marc"],
    ["p2", "sortie", 2, "CMD-2026-900", "marc"]
  ]);
  assert.deepEqual(journalExpliqueLeRayon(), []);
});

test("livraison acceptee sur un stock insuffisant : la sortie en negatif est au journal", async () => {
  ensemencer({
    stock: [{ id: "p1", code: "CH-L", nom: "Changes L", quantite: 1, tarif: 12 }, { id: "p2", code: "ALE", nom: "Aleses", quantite: 5, tarif: 5 }],
    commandes: [{
      id: "o-lib", numero: "CMD-2026-901", clientId: "c1", clientName: "EHPAD Les Tilleuls", status: "a_reprogrammer",
      dateCommande: "2026-09-20", stockReservedAt: null, stockReleasedAt: "2026-09-21T08:00:00Z", stockReleaseReason: "manual_release",
      products: [{ code: "CH-L", nom: "Changes L", quantite: 4 }]
    }]
  });
  assert.equal((await demander("PATCH", "/api/orders/o-lib", marc, { status: "en_livraison" })).status, 200);
  assert.equal((await demander("PATCH", "/api/orders/o-lib", marc, { status: "livre" })).status, 200);
  assert.deepEqual(mouvements().map(m => [m.produit, m.type, m.quantite, m.avant, m.apres, m.commande]), [
    ["p1", "sortie", 4, 1, -3, "CMD-2026-901"]
  ]);
  assert.match(mouvements()[0].motif, /^Livrée sur stock insuffisant : commande CMD-2026-901/);
});

test("import du stock : la colonne Quantite qui change le rayon est au journal ; sans changement, rien", async () => {
  const form = new FormData();
  form.append("file", classeur([["Code", "Nom", "Quantite"], ["CH-L", "Changes L", "25"], ["ALE", "Aleses", "5"], ["GANTS", "Gants nitrile", "40"]]), "stock-septembre.xlsx");
  const r = await demander("POST", "/api/import/stock", admin, form);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const gants = readDb().stock.find(p => p.code === "GANTS");
  assert.deepEqual(mouvements().map(m => [m.produit, m.type, m.quantite, m.avant, m.apres, m.motif, m.auteur]), [
    ["p1", "entree", 15, 10, 25, "Import du stock (stock-septembre.xlsx)", "admin-banc"],
    [gants.id, "entree", 40, null, 40, "Import du stock (stock-septembre.xlsx) : produit créé", "admin-banc"]
  ], "Aleses (5 -> 5) ne produit aucun mouvement");
  // Le journal de Parametres ecrit « — » pour une quantite qui n'existait pas.
  const journal = await demander("GET", "/api/journal?genre=stock", admin);
  assert.equal(journal.status, 200);
  assert.deepEqual(journal.body.entrees.map(e => [e.message, e.auteur]), [
    ["Gants nitrile : +40 · — → 40 · Import du stock (stock-septembre.xlsx) : produit créé", "admin-banc"],
    ["Changes L : +15 · 10 → 25 · Import du stock (stock-septembre.xlsx)", "admin-banc"]
  ]);

  // Le meme fichier une seconde fois : rien ne change, rien n'est ecrit.
  const form2 = new FormData();
  form2.append("file", classeur([["Code", "Nom", "Quantite"], ["CH-L", "Changes L", "25"], ["ALE", "Aleses", "5"], ["GANTS", "Gants nitrile", "40"]]), "stock-septembre.xlsx");
  await demander("POST", "/api/import/stock", admin, form2);
  assert.equal(mouvements().length, 2);
});

test("temoin : la saisie a la main reste journalisee comme avant", async () => {
  const r = await demander("PATCH", "/api/stock/p1", marc, { quantite: 7, reason: "Casse" });
  assert.equal(r.status, 200);
  assert.deepEqual(mouvements().map(m => [m.produit, m.type, m.quantite, m.motif, m.auteur]), [["p1", "sortie", 3, "Casse", "marc"]]);
});

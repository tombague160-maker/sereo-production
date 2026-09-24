// L'IMPORT DES VENTES FUSIONNE, dans un vrai navigateur (25/09), sur un serveur
// seme (port 3602). Chasse aux defauts du 24/09, lot « donnees clients ».
//
// 1. Le resume de l'import dit ce qu'il a fait des FICHES : creees, completees,
//    et gardees telles quelles quand le fichier ne les cite pas (avant : elles
//    etaient supprimees sans un mot).
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");
const { classeur } = require("../aide-import-ventes");

const BUREAU = { width: 1440, height: 900 };

test.describe.configure({ mode: "serial" });

let srv;
// Le port n'est ecrit qu'ICI (test/ports-e2e.test.js) : chaque banc resème.
async function semer(seed = jeuDeDonnees()) {
  if (srv) await srv.arreter();
  srv = await demarrer({ port: 3602, seed });
}
test.afterAll(async () => { if (srv) await srv.arreter(); });

const JOUR_FR = AUJOURDHUI.split("-").reverse().join("/");
const xlsx = lignes => ({
  name: "ventes.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: classeur(lignes)
});

async function ouvrir(browser, ancre, { viewport = BUREAU, theme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, timezoneId: "Europe/Paris", locale: "fr-FR" });
  await ctx.addInitScript(t => { try { localStorage.setItem("sereo:colorScheme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(srv.base + "/#" + ancre, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  return { ctx, page, erreurs };
}

async function importerParLEcran(page, fichier) {
  const [selecteur] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('#enteteActions [data-action="importer-ventes"]').click()
  ]);
  const reponse = page.waitForResponse(r => r.url().includes("/api/import/ventes"));
  await selecteur.setFiles(fichier);
  const r = await reponse;
  expect(r.status()).toBe(200);
  return r.json();
}

test("import partiel : le resume dit les fiches gardees ; aucune fiche ne disparait, l'email reste", async ({ browser }) => {
  test.setTimeout(120000);
  const seed = jeuDeDonnees();
  // Une fiche enrichie au CRM, que le fichier cite ; les autres ne le sont pas.
  const pharma = seed.clients.find(c => c.id === "c-pharma");
  Object.assign(pharma, { email: "contact@pharmacie.example", prenom: "Claire", source: "salon" });
  await semer(seed);
  const avant = await (await fetch(srv.base + "/api/clients")).json();

  const { ctx, page, erreurs } = await ouvrir(browser, "journee");
  const resultat = await importerParLEcran(page, xlsx([
    ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville", "Telephone"],
    [JOUR_FR, pharma.nom, "ALE", "Alèses", "2", pharma.rue, pharma.codePostal, pharma.ville, ""]
  ]));
  expect(resultat.clientsImport).toEqual({ created: 0, updated: 1, preserved: avant.length - 1 });

  const bilan = page.locator("#importSummary");
  await expect(bilan).toBeVisible();
  await expect(bilan).toContainText(`Fiches clients : 0 nouvelle · 1 complétée · ${avant.length - 1} absentes du fichier, gardées telles quelles.`);

  const apres = await (await fetch(srv.base + "/api/clients")).json();
  expect(apres.map(c => c.id).sort(), "une fiche absente du fichier a disparu").toEqual(avant.map(c => c.id).sort());
  const fiche = apres.find(c => c.id === "c-pharma");
  expect([fiche.email, fiche.prenom, fiche.source]).toEqual(["contact@pharmacie.example", "Claire", "salon"]);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("reimport : une commande saisie au terrain n'est pas reecrite, et le resume dit pourquoi", async ({ browser }) => {
  test.setTimeout(120000);
  const seed = jeuDeDonnees();
  const parc = { id: "c-parc", nom: "Foyer du Parc", rue: "2 rue du Parc", ville: "Dole", codePostal: "39100", lat: 47.09, lng: 5.49 };
  seed.clients.push(parc);
  // Acceptee « bloquee » faute de stock (decision 11) : rien de reserve.
  seed.commandes.push({
    id: "o-parc", numero: "CMD-2026-090", clientId: parc.id, clientName: parc.nom, status: "stock_a_verifier",
    source: "commande_terrain", total: 24, address: parc.rue, city: parc.ville, postalCode: parc.codePostal,
    lat: parc.lat, lng: parc.lng, deliveryDate: AUJOURDHUI, dateCommande: AUJOURDHUI,
    products: [{ code: "CH-L", nom: "Changes taille L", prixUnitaire: 12, quantite: 2, totalLigne: 24 }]
  });
  await semer(seed);
  const { ctx, page, erreurs } = await ouvrir(browser, "journee");
  await importerParLEcran(page, xlsx([
    ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"],
    [JOUR_FR, parc.nom, "ALE", "Alèses", "9", parc.rue, parc.codePostal, parc.ville]
  ]));
  const bilan = page.locator("#importSummary");
  await expect(bilan).toContainText("Ignorée : commande saisie au terrain");
  await expect(bilan).toContainText("CMD-2026-090");
  const commandes = await (await fetch(srv.base + "/api/orders")).json();
  const o = (Array.isArray(commandes) ? commandes : commandes.orders || []).find(x => x.id === "o-parc");
  expect(o.products.map(p => [p.code, Number(p.quantite)])).toEqual([["CH-L", 2]]);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// 3. Une commande terrain pour un NOUVEAU client dont le telephone existe deja :
//    la fiche n'est plus renommee ni videe ; l'ecran propose « rattacher » ou
//    « creer une nouvelle fiche ».
const TELEPHONE_TILLEULS = "0381000000";
function semeAvecTelephone({ archive = false } = {}) {
  const seed = jeuDeDonnees();
  const tilleuls = seed.clients.find(c => c.id === "c-tilleuls");
  Object.assign(tilleuls, { telephone: TELEPHONE_TILLEULS, email: "accueil@tilleuls.example", notes: "Code porte 4512", crmArchived: archive });
  return seed;
}

async function commandePourMmeRoux(page) {
  const form = page.locator("#customerOrderForm");
  await form.locator("[name=nom]").fill("Roux");
  await form.locator("[name=prenom]").fill("Mme");
  await form.locator("[name=telephone]").fill("03 81 00 00 00");
  await form.locator("[name=codePostal]").fill("25000");
  await page.locator('#customerCatalog [data-customer-product="st-CH-L"][data-customer-delta="1"]').click();
  await page.locator("#customerValider").click();
}

const ficheTilleuls = async () => (await (await fetch(srv.base + "/api/clients")).json()).find(c => c.id === "c-tilleuls");
const champsFiche = c => ({ nom: c.nom, prenom: c.prenom || "", telephone: c.telephone, email: c.email, notes: c.notes, rue: c.rue });

for (const [choix, attendu] of [["rattacher", "la commande part sur la fiche"], ["nouvelle", "une nouvelle fiche est creee"]]) {
  test(`commande terrain, telephone deja connu : « ${choix} » -- ${attendu}, la fiche existante ne bouge pas`, async ({ browser }) => {
    test.setTimeout(120000);
    await semer(semeAvecTelephone());
    const avant = champsFiche(await ficheTilleuls());
    const nbAvant = (await (await fetch(srv.base + "/api/clients")).json()).length;
    const { ctx, page, erreurs } = await ouvrir(browser, "commande-client");
    const envois = [];
    page.on("request", req => { if (req.url().endsWith("/api/customer-orders") && req.method() === "POST") envois.push(req.postData()); });
    await commandePourMmeRoux(page);

    const dialogue = page.locator("#doublonFicheDialog");
    await expect(dialogue, "aucune question : la fiche existante serait reprise").toBeVisible();
    // La fiche est dans la liste chargee : la question vient AVANT tout envoi.
    expect(envois.length, "la commande est partie avant la question").toBe(0);
    await expect(dialogue).toContainText("« EHPAD Les Tilleuls du Val de Loue »");
    await expect(dialogue).toContainText("03 81 00 00 00");
    const reponse = page.waitForResponse(r => r.url().endsWith("/api/customer-orders") && r.request().method() === "POST");
    await dialogue.locator(`input[value="${choix}"]`).check();
    await dialogue.locator('[data-action="doublon-valider"]').click();
    const r = await reponse;
    expect(r.status()).toBe(201);
    const creee = await r.json();

    expect(champsFiche(await ficheTilleuls()), "la fiche existante a ete renommee ou videe").toEqual(avant);
    const clients = await (await fetch(srv.base + "/api/clients")).json();
    if (choix === "rattacher") {
      expect(creee.clientId).toBe("c-tilleuls");
      expect(clients.length).toBe(nbAvant);
    } else {
      expect(creee.clientId).not.toBe("c-tilleuls");
      expect(clients.length).toBe(nbAvant + 1);
      expect(clients.find(c => c.id === creee.clientId).nom).toBe("Roux");
    }
    await expect(page.locator("#commandes")).toHaveClass(/active/);
    expect(erreurs).toEqual([]);
    await ctx.close();
  });
}

test("commande terrain : Annuler au dialogue n'envoie rien ; une fiche que la liste n'a pas (archivee) fait poser la question par le serveur", async ({ browser }) => {
  test.setTimeout(120000);
  await semer(semeAvecTelephone({ archive: true }));
  const { ctx, page, erreurs } = await ouvrir(browser, "commande-client");
  const envois = [];
  page.on("request", req => { if (req.url().endsWith("/api/customer-orders") && req.method() === "POST") envois.push(JSON.parse(req.postData() || "{}")); });
  await commandePourMmeRoux(page);
  // La liste CRM ne porte pas les fiches archivees : la question vient du 409.
  const dialogue = page.locator("#doublonFicheDialog");
  await expect(dialogue).toBeVisible();
  expect(envois.length, "le premier envoi (refuse 409) n'est pas parti").toBe(1);
  await dialogue.locator('[data-action="doublon-annuler"]').click();
  await expect(dialogue).toBeHidden();
  await page.waitForTimeout(300);
  expect(envois.length, "Annuler a quand meme envoye la commande").toBe(1);
  // Le formulaire reste rempli : rien n'est perdu.
  await expect(page.locator("#customerOrderForm [name=nom]")).toHaveValue("Roux");
  const commandes = await (await fetch(srv.base + "/api/orders")).json();
  expect((Array.isArray(commandes) ? commandes : commandes.orders || []).some(o => o.clientName.includes("Roux"))).toBe(false);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

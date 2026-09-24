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

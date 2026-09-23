// Les etats limites des planches 10b (premier lancement) et 10c (hors ligne).

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

test("hors ligne : un bandeau dit depuis quand, puis s'efface au retour du réseau", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("#bandeauHorsLigne")).toBeHidden();
  await ctx.setOffline(true);
  await expect(page.locator("#bandeauHorsLigne")).toBeVisible();
  await expect(page.locator("#bandeauHorsLigneTitre")).toHaveText(/^Hors ligne depuis \d{1,2} h \d{2}$/);
  // Les imports le disent au lieu d'echouer.
  await expect(page.locator('#enteteActions [data-action="importer-ventes"]')).toBeDisabled();
  await ctx.setOffline(false);
  await expect(page.locator("#bandeauHorsLigne")).toBeHidden();
  await expect(page.locator('#enteteActions [data-action="importer-ventes"]')).toBeEnabled();
  await ctx.close();
});

test.describe("premier lancement", () => {
  let srv;
  test.beforeAll(async () => {
    const seed = jeuDeDonnees();
    seed.commandes = [];
    seed.routes = [];
    srv = await demarrer({ port: 3172, seed });
  });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  test("sans aucune commande, la carte d'accueil remplace « À régler » et « Cette semaine »", async ({ page }) => {
    await page.goto(srv.base + "/", { waitUntil: "networkidle" });
    await expect(page.locator("#tbPremierLancement")).toBeVisible();
    await expect(page.locator("#journee .tb-regler")).toBeHidden();
    await expect(page.locator("#journee .tb-semaine")).toBeHidden();
    await expect(page.locator('#tbPremierLancement [data-action="importer-ventes"]')).toBeVisible();
  });
});

test.describe("avec des commandes", () => {
  let srv;
  test.beforeAll(async () => { srv = await demarrer({ port: 3173, seed: jeuDeDonnees() }); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  test("pas de carte d'accueil, « À régler » et « Cette semaine » restent", async ({ page }) => {
    await page.goto(srv.base + "/", { waitUntil: "networkidle" });
    await expect(page.locator("#tbPremierLancement")).toBeHidden();
    await expect(page.locator("#journee .tb-regler")).toBeVisible();
    await expect(page.locator("#journee .tb-semaine")).toBeVisible();
  });
});

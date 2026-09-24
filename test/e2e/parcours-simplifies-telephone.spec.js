// PARCOURS SIMPLIFIES -- audit du 24/09, AU TELEPHONE (390 x 844).
//
// Les memes gestes qu'au bureau (parcours-simplifies.spec.js), la ou le
// telephone les dessine autrement :
//   1. la fiche client (planche 8c) porte « Nouvelle commande » et « Rappel » ;
//   2. la nouvelle commande : « Valider » est APRES le catalogue -- l'audit
//      mesurait une remontee de 1 300 px pour le trouver ;
//   4. la page 7b ne se ferme plus entre « Passer en preparation » et
//      « Preparation terminee » ;
//   5. « Client absent » presélectionne « Personne sur place ».
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

const TELEPHONE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3529, seed: jeuDeDonnees() }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, ecran) {
  const ctx = await browser.newContext({ viewport: TELEPHONE, hasTouch: true });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(`${srv.base}/#${ecran}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

test("1 — la fiche du telephone porte « Nouvelle commande » et « Rappel », 44 px au moins", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "crm");
  await page.locator("#crmList .cli-ligne", { hasText: "Tilleuls" }).click();
  await expect(page.locator("#crm")).toHaveAttribute("data-vue", "fiche");
  for (const action of ["cli-nouvelle-commande", "cli-rappel"]) {
    const bouton = page.locator(`#cliFiche [data-action="${action}"]`);
    await expect(bouton).toBeVisible();
    const boite = await bouton.boundingBox();
    expect(boite.height, `${action} : ${boite.height} px`).toBeGreaterThanOrEqual(44);
    expect(boite.x + boite.width, `${action} deborde`).toBeLessThanOrEqual(390);
  }
  await expect(page.locator("#cliFiche .cli-ca")).toBeVisible();
  await page.locator('#cliFiche [data-action="cli-nouvelle-commande"]').click();
  await expect(page.locator("#commande-client")).toHaveClass(/active/);
  await expect(page.locator("#customerClientNom")).toHaveText("EHPAD Les Tilleuls du Val de Loue");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("2 — « Valider » vient APRES le catalogue : pas de remontee", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "commande-client");
  const r = await page.evaluate(() => {
    const cartes = [...document.querySelectorAll("#customerCatalog .product-card")];
    const derniere = cartes[cartes.length - 1].getBoundingClientRect().bottom + scrollY;
    const valider = [...document.querySelectorAll('button[type="submit"]')]
      .filter(b => (b.form?.id === "customerOrderForm") && !b.closest("#customerCartBar") && b.checkVisibility());
    return { n: valider.length, haut: valider[0] ? valider[0].getBoundingClientRect().top + scrollY : null, derniere };
  });
  expect(r.n, "un seul « Valider » dans la page").toBe(1);
  expect(r.haut, `« Valider » a ${r.haut} px, le catalogue finit a ${r.derniere} px`).toBeGreaterThan(r.derniere);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("4 — la page 7b reste ouverte : « Passer en preparation » puis « Preparation terminee »", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "preparation");
  await page.locator("#preparationList .commande-ligne", { hasText: "Cabinet Infirmier" }).locator(".commande-ligne-main").click();
  const dialogue = page.locator("#commandeDetailDialog");
  await expect(dialogue).toBeVisible();
  await dialogue.locator('.commande-page-gestes [data-action="start-preparation"]').click();
  const terminer = dialogue.locator('.commande-page-gestes [data-action="finish-preparation"]');
  await expect(terminer).toBeVisible();
  expect(await dialogue.evaluate(d => d.open), "la page ne se ferme plus").toBe(true);
  await expect(page.locator("#commandeDetailPuces")).toContainText("En préparation");
  await terminer.click();
  await expect.poll(() => dialogue.evaluate(d => d.open)).toBe(false);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("5 — « Client absent » presélectionne « Personne sur place », « Enregistrer » suffit", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "livreur");
  const courant = await page.locator("#currentClient .arret-nom").textContent();
  await page.locator("#markAbsentButton").click();
  const dialogue = page.locator("#motifProblemeDialog");
  await expect(dialogue.locator('[data-motif-cle="absent"]')).toHaveAttribute("aria-checked", "true");
  const reponse = page.waitForResponse(r => /\/api\/routes\/[^/]+\/stops\//.test(r.url()) && r.request().method() === "PATCH");
  await dialogue.locator('[data-action="motif-valider"]').click();
  const recue = await reponse;
  expect(recue.status()).toBe(200);
  expect(JSON.parse(recue.request().postData()).motif.cle).toBe("absent");
  await expect(page.locator("#currentClient .arret-nom")).not.toHaveText(courant);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

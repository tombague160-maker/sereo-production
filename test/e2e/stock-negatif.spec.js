// E2E : « Livré en retard sur un stock à zéro » (decision de Thomas, 23/09).
//
// Un « Livre » arrive en retard est accepte meme quand le rayon n'en a plus
// assez : le rayon passe en negatif (bancs serveur :
// test/livre-en-retard-stock.test.js). Ce negatif doit se VOIR :
//  - au Stock, sur la ligne du produit (« Stock négatif · à recompter »),
//    lisible (contraste >= 4,5:1, clair et sombre) et jamais coupe ;
//  - au tableau de bord, dans « A regler », sur sa propre ligne ;
//  - et les boutons −/+ ne le « corrigent » pas en silence : ramene a zero,
//    « −1 » sur −2 ajoutait deux unites.
// Le temoin : un produit a zero (rupture ordinaire) n'a pas le badge, et reste
// compte dans « en rupture ».

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const NOM_LONG = "Alèses jetables de protection 60 × 90 cm, boîte de trente";

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  // Les Aleses a -2 (livrees sur un rayon qui n'en avait plus) ; les gants a 0.
  // Un nom LONG : au bureau, le nom est coupe par une ellipse, et un badge
  // pose a sa suite disparaissait avec lui.
  const alese = seed.stock.find(p => p.code === "ALE");
  alese.quantite = -2;
  alese.nom = NOM_LONG;
  srv = await demarrer({ port: 3352, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, { mode = "light", largeur = 1440, ecran = "stock" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: largeur > 820 ? 900 : 844 }, colorScheme: mode });
  await ctx.addInitScript(v => { try { localStorage.setItem("sereo:colorScheme", v); } catch { /* ignore */ } }, mode);
  const page = await ctx.newPage();
  await page.goto(`${srv.base}/#${ecran}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  return { ctx, page };
}

const ligneDe = (page, nom) => page.locator("#stockList .stk-ligne").filter({ has: page.locator(".stk-nom", { hasText: nom }) });

/** Contraste du texte d'un element sur le premier fond opaque de ses ancetres. */
function contraste(el) {
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => {
    const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  let fond = null;
  for (let n = el; n; n = n.parentElement) {
    const f = rgb(getComputedStyle(n).backgroundColor);
    if (f.length >= 3 && (f.length < 4 || f[3] >= 0.99)) { fond = f; break; }
  }
  fond = fond || [255, 255, 255];
  const a = lum(rgb(getComputedStyle(el).color)), b = lum(fond);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const mode of ["light", "dark"]) {
  for (const largeur of [1440, 390]) {
    test(`Stock, ${mode}, ${largeur} px : la ligne du produit négatif le dit, lisible et entière`, async ({ browser }) => {
      const { ctx, page } = await ouvrir(browser, { mode, largeur });
      const badge = ligneDe(page, "Alèses").locator(".stk-negatif");
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText("Stock négatif · à recompter");
      // Entier : ni coupe par l'ellipse du nom, ni hors de l'ecran.
      const coupe = await badge.evaluate(el => el.scrollWidth > el.clientWidth + 1);
      expect(coupe, "le badge est coupe").toBe(false);
      const boite = await badge.boundingBox();
      expect(boite.x + boite.width).toBeLessThanOrEqual(largeur);
      const ratio = await badge.evaluate(contraste);
      console.log(`[stock-negatif] ${mode} ${largeur} : contraste ${ratio.toFixed(2)}`);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      // Le champ du stock dit -2, et son nom accessible le dit negatif.
      await expect(ligneDe(page, "Alèses").locator("[data-stock-input]")).toHaveValue("-2");
      await expect(page.getByLabel(`Stock de ${NOM_LONG}, négatif, à recompter`)).toHaveCount(1);
      // Temoin : les gants, a zero, n'ont pas le badge.
      await expect(ligneDe(page, "Gants nitrile")).toHaveCount(1);
      await expect(ligneDe(page, "Gants nitrile").locator(".stk-negatif")).toHaveCount(0);
      await ctx.close();
    });
  }
}

test("« À régler » : le stock négatif a sa ligne, et n'est pas compté deux fois dans les ruptures", async ({ browser }) => {
  const { ctx, page } = await ouvrir(browser, { ecran: "journee" });
  const alertes = page.locator("#opAlerts .tb-anomalie");
  const negatif = alertes.filter({ hasText: "en stock négatif" });
  await expect(negatif).toHaveCount(1);
  await expect(negatif.locator(".tb-anomalie-titre")).toHaveText("1 produit en stock négatif");
  await expect(negatif.locator(".tb-anomalie-detail")).toHaveText(`Livré sur stock insuffisant, à recompter : ${NOM_LONG} (-2)`);
  await expect(negatif).toHaveAttribute("data-target-tab", "stock");
  // Temoin : la rupture ordinaire reste comptee, seule.
  const rupture = alertes.filter({ hasText: "en rupture" });
  await expect(rupture.locator(".tb-anomalie-titre")).toHaveText("1 produit en rupture");
  await expect(rupture.locator(".tb-anomalie-detail")).toHaveText("Gants nitrile");
  // L'ordre : le negatif avant les ruptures.
  const titres = await alertes.locator(".tb-anomalie-titre").allTextContents();
  expect(titres.indexOf("1 produit en stock négatif")).toBeLessThan(titres.indexOf("1 produit en rupture"));
  await ctx.close();
});

test("les boutons −/+ ne ramènent pas un stock négatif à zéro : ils disent de recompter", async ({ browser }) => {
  const { ctx, page } = await ouvrir(browser);
  const ecritures = [];
  page.on("request", r => { if (r.method() === "PATCH" && /\/api\/stock\//.test(r.url())) ecritures.push(r.url()); });
  await ligneDe(page, "Alèses").locator('[data-stock-delta="-1"]').click();
  await page.waitForTimeout(500);
  expect(ecritures, "« − » a ecrit le stock").toEqual([]);
  await expect(page.getByText("Stock négatif (-2) : recompte le rayon et saisis la quantité comptée.")).toBeVisible();
  await ligneDe(page, "Alèses").locator('[data-stock-delta="1"]').click();
  await page.waitForTimeout(500);
  expect(ecritures, "« + » a ecrit le stock").toEqual([]);
  const produit = (await (await page.request.get(`${srv.base}/api/stock`)).json()).find(p => p.code === "ALE");
  expect(produit.quantityAvailable).toBe(-2);
  // Temoin : sur un produit positif, « + » ecrit toujours.
  await ligneDe(page, "Changes taille L").locator('[data-stock-delta="1"]').click();
  await expect.poll(() => ecritures.length).toBe(1);
  await ctx.close();
});

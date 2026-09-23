// E2E : l'ecran Tournee des planches 13b / 14b, au bureau.
//
// La carte a gauche, la tournee a droite (l'arret en cours, puis la liste) ;
// le titre de page est la tournee. Le telephone garde l'ecran du 19/09
// (ecran-livreur.spec.js, carte-et-lignes.spec.js).

const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3166 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(page, largeur = 1440) {
  await page.setViewportSize({ width: largeur, height: 900 });
  await page.goto(srv.base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
}
const boite = (page, sel) => page.locator(sel).first().boundingBox();

test("au bureau : la carte à gauche, l'arrêt puis la liste à droite", async ({ page }) => {
  await ouvrir(page);
  const carte = await boite(page, "#map");
  const arret = await boite(page, "#tourneeActive");
  const liste = await boite(page, "#routeStopsList");
  const plan = await boite(page, "#routePlanning");
  expect(carte.x + carte.width).toBeLessThanOrEqual(arret.x + 1);
  expect(arret.y + arret.height).toBeLessThanOrEqual(liste.y + 1);
  expect(carte.height).toBeGreaterThanOrEqual(520);
  // La carte fait environ 60 % de la largeur utile (3 fr / 2 fr).
  const part = carte.width / (arret.x + arret.width - carte.x);
  expect(part).toBeGreaterThan(0.55);
  expect(part).toBeLessThan(0.65);
  expect(plan.y).toBeGreaterThan(carte.y + carte.height - 1);
  // Pas de vide entre l'arret et la liste : la carte n'etire pas les rangees.
  const panneauListe = await boite(page, ".tournee-liste-panel");
  expect(panneauListe.y - (arret.y + arret.height)).toBeLessThan(40);
});

test("les marqueurs sont dans la carte (Leaflet connaît sa taille)", async ({ page }) => {
  await ouvrir(page);
  const r = await page.evaluate(() => {
    const cadre = document.getElementById("map").getBoundingClientRect();
    const m = [...document.querySelectorAll("#map .leaflet-marker-icon")].map(e => e.getBoundingClientRect());
    return { n: m.length, dehors: m.filter(b => b.left < cadre.left - 1 || b.right > cadre.right + 1 || b.top < cadre.top - 1 || b.bottom > cadre.bottom + 1).length };
  });
  expect(r.n).toBeGreaterThan(0);
  expect(r.dehors).toBe(0);
});

test("le titre de page dit la tournée et son avancement", async ({ page }) => {
  await ouvrir(page);
  const nom = (await page.locator("#tourneeNom").textContent()).trim();
  await expect(page.locator("#pageTitle")).toHaveText(nom);
  await expect(page.locator("#pageSubtitle")).toHaveText(/ · arrêt \d+ sur \d+$/);
});

test("« Recalculer le tracé » est dans l'en-tête, et une seule fois à l'écran", async ({ page }) => {
  await ouvrir(page);
  const visibles = await page.locator('[data-op="recalculate-route"]').evaluateAll(els => els.filter(e => e.checkVisibility()).length);
  expect(visibles).toBe(1);
  await expect(page.locator('#enteteActions [data-op="recalculate-route"]')).toBeVisible();
});

test("« Nouvelle tournée » ouvre la planification repliée pendant la livraison", async ({ page }) => {
  await ouvrir(page);
  // La tournee semee roule : la planification est repliee.
  expect(await page.locator("#routePlanning").evaluate(d => d.open)).toBe(false);
  await page.locator('#enteteActions [data-action="trn-nouvelle"]').click();
  expect(await page.locator("#routePlanning").evaluate(d => d.open)).toBe(true);
  expect(await page.evaluate(() => !!document.activeElement?.closest("#routePlanning"))).toBe(true);
});

test("à 1024 px : une seule colonne, la carte pleine largeur", async ({ page }) => {
  await ouvrir(page, 1024);
  // L'ordre du telephone : l'arret, la liste, puis la carte -- empiles.
  const carte = await boite(page, "#map");
  const liste = await boite(page, "#routeStopsList");
  expect(carte.y).toBeGreaterThan(liste.y + liste.height - 1);
});

test("au téléphone : rien ne déborde", async ({ page }) => {
  await ouvrir(page, 390);
  const deborde = await page.evaluate(() => [...document.querySelectorAll("#livreur *")]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5 && !e.closest(".leaflet-pane"); })
    .map(e => e.className || e.tagName));
  expect(deborde).toEqual([]);
});

test("au téléphone, l'en-tête ne porte ni « Nouvelle tournée » ni un second « Recalculer »", async ({ page }) => {
  await ouvrir(page, 390);
  await expect(page.locator('#enteteActions [data-action="trn-nouvelle"]')).toBeHidden();
  const visibles = await page.locator('[data-op="recalculate-route"]').evaluateAll(els => els.filter(e => e.checkVisibility()).length);
  expect(visibles).toBe(1);
});

test("« livraison » dans la recherche du menu trouve encore la Tournée", async ({ page }) => {
  await ouvrir(page);
  await page.locator("#nav-journee").click();
  await page.fill("#menuSearch", "livraison");
  await page.press("#menuSearch", "Enter");
  await expect(page.locator("#livreur")).toHaveClass(/active/);
});

test("en sombre, le bandeau de la tournée est vert profond, pas pâle (planche 5c)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await ctx.addInitScript(() => { try { localStorage.setItem("sereo:colorScheme", "dark"); } catch {} });
  const page = await ctx.newPage();
  await page.goto(srv.base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const sonde = document.createElement("span");
    sonde.style.color = "var(--v8-carte-tournee)";
    document.body.append(sonde);
    const vert = getComputedStyle(sonde).color;
    sonde.remove();
    return { fond: getComputedStyle(document.querySelector(".tournee-entete")).backgroundColor, vert };
  });
  expect(r.fond).toBe(r.vert);
  await ctx.close();
});

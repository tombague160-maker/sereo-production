// Au telephone, chaque entree de la barre laterale doit rester atteignable :
// par la barre basse ou par le menu « Plus ». La barre laterale y est
// masquee ; Stock n'etait porte par aucun des deux, et aucun banc ne le voyait.

const { test, expect } = require("./tuiles");

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("chaque entrée de la barre latérale est atteignable au téléphone", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const entrees = await page.locator(".sidebar .tab[data-groupe]").evaluateAll(els => els.map(e => ({ tab: e.dataset.tab, nom: e.textContent.replace(/\s+/g, " ").trim() })));
  expect(entrees.length).toBeGreaterThanOrEqual(8);
  const cibles = await page.evaluate(() => [...document.querySelectorAll(".mobile-tabbar [data-tab], #mobile-more-sheet [data-tab]")]
    .map(e => e.dataset.tab));
  const manquantes = entrees.filter(e => !cibles.includes(e.tab)).map(e => e.nom);
  expect(manquantes, "entrées sans chemin au téléphone").toEqual([]);
});

test("« Plus » → Stock ouvre le Stock", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.locator('.mobile-tabbar [data-action="open-more-menu"]').click();
  await page.locator('#mobile-more-sheet [data-tab="stock"]').click();
  await expect(page.locator("#stock")).toHaveClass(/active/);
});

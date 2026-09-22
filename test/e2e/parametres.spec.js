// E2E : l'ecran Parametres des planches 13f / 14f.
//
// Une grille de cartes : Theme, Secteurs, Numerotation des bons (rangee 1),
// Comptes, Imports et archives (rangee 2). Les reglages que la planche ne
// dessine pas (logo, fiche des secteurs, tournee, diagnostic, zone dangereuse)
// restent, en cartes de meme forme.

const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3167 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(page, largeur = 1440) {
  await page.setViewportSize({ width: largeur, height: 900 });
  await page.goto(srv.base + "/#parametres", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}
const carte = (page, titre) => page.locator("#parametres .par-carte", { has: page.locator("h3", { hasText: titre }) });

test("la grille de la planche : trois cartes, puis deux", async ({ page }) => {
  await ouvrir(page);
  const y = async titre => Math.round((await carte(page, titre).boundingBox()).y);
  const rangee1 = [await y("Thème"), await y("Secteurs"), await y("Numérotation des bons")];
  expect(new Set(rangee1).size).toBe(1);
  const rangee2 = [await y("Comptes"), await y("Imports et archives")];
  expect(new Set(rangee2).size).toBe(1);
  expect(rangee2[0]).toBeGreaterThan(rangee1[0]);
});

test("le thème : trois segments, Clair · Sombre · Système", async ({ page }) => {
  await ouvrir(page);
  const segments = page.locator("#colorSchemeToggle .par-segment");
  await expect(segments).toHaveText(["Clair", "Sombre", "Système"]);
  await segments.nth(1).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await expect(segments.nth(1)).toHaveAttribute("aria-pressed", "true");
  await segments.nth(0).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light");
});

test("les secteurs en pilules, la fiche derrière « Gérer les secteurs »", async ({ page }) => {
  await ouvrir(page);
  const pilules = page.locator("#parSecteursPilules .par-pilule");
  expect(await pilules.count()).toBeGreaterThan(0);
  await expect(page.locator("#deliverySectorForm")).toBeHidden();
  await page.locator("#parSecteursDetails > summary").click();
  await expect(page.locator("#deliverySectorForm")).toBeVisible();
});

test("la numérotation des bons se lit, se modifie et persiste", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#parPrefixe")).toHaveValue("CMD");
  const annee = new Date().getFullYear();
  await expect(page.locator("#parExemple")).toHaveText(`CMD-${annee}-001`);
  await page.fill("#parPrefixe", "bc");
  await expect(page.locator("#parExemple")).toHaveText(`BC-${annee}-001`);
  const envoi = page.waitForRequest(r => r.method() === "PATCH" && r.url().includes("/api/settings/order-numbering"));
  await carte(page, "Numérotation des bons").getByRole("button", { name: "Enregistrer" }).click();
  expect(JSON.parse((await envoi).postData())).toEqual({ prefix: "bc", resetAnnually: true });
  await ouvrir(page);
  await expect(page.locator("#parPrefixe")).toHaveValue("BC");
});

test("un préfixe invalide n'est pas envoyé", async ({ page }) => {
  await ouvrir(page);
  let envois = 0;
  page.on("request", r => { if (r.method() === "PATCH" && r.url().includes("order-numbering")) envois += 1; });
  await page.fill("#parPrefixe", "B");
  await carte(page, "Numérotation des bons").getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForTimeout(400);
  expect(envois).toBe(0);
});

test("ce que la planche ne dessine pas est gardé", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#tourneeSpeedSlider")).toBeVisible();
  await expect(page.locator('[data-action="diagnostic-suspicious-dates"]')).toBeVisible();
  await expect(page.locator('[data-action="purge-orders"]')).toBeVisible();
  await expect(page.locator("#comptesList")).toBeVisible();
  await expect(page.locator("#importsArchivesList")).toBeVisible();
  await carte(page, "Thème").locator("summary").click();
  await expect(page.locator("#brandPreviewImage")).toBeVisible();
});

test("au téléphone : une colonne, rien ne déborde", async ({ page }) => {
  await ouvrir(page, 390);
  const deborde = await page.evaluate(() => [...document.querySelectorAll("#parametres *")]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5; })
    .map(e => e.id || e.className || e.tagName));
  expect(deborde).toEqual([]);
});

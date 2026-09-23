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

test("la grille : trois cartes en tête, puis les tableaux", async ({ page }) => {
  await ouvrir(page);
  const y = async titre => Math.round((await carte(page, titre).boundingBox()).y);
  const rangee1 = [await y("Thème"), await y("Secteurs"), await y("Numérotation des bons")];
  expect(new Set(rangee1).size).toBe(1);
  // Comptes puis Imports, chacun sur toute la largeur (ecart nomme : a demi-
  // largeur le tableau des comptes cassait ses libelles lettre par lettre).
  expect(await y("Comptes")).toBeGreaterThan(rangee1[0]);
  expect(await y("Imports et archives")).toBeGreaterThan(await y("Comptes"));
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
  // Le VRAI prochain numero : le plus grand de l'annee, plus un -- la base
  // semee en a deja (numerotes au demarrage), « -001 » serait faux.
  const annee = new Date().getFullYear();
  const numeros = await page.evaluate(async () => (await (await fetch("/api/orders")).json()).map(o => o.numero));
  const max = numeros.map(n => (String(n).match(new RegExp(`^CMD-${new Date().getFullYear()}-(\\d+)$`)) || [])[1])
    .filter(Boolean).map(Number).reduce((a, b) => Math.max(a, b), 0);
  expect(max).toBeGreaterThan(0);
  await expect(page.locator("#parExemple")).toHaveText(`CMD-${annee}-${String(max + 1).padStart(3, "0")}`);
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

test("au clavier, le segment de thème montre son anneau de focus", async ({ page }) => {
  await ouvrir(page);
  await page.locator("#colorSchemeToggle .par-segment").first().focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const ombre = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  expect(ombre).not.toBe("none");
});

test("en sombre, la zone dangereuse garde son contour d'alerte", async ({ page }) => {
  await ouvrir(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-color-scheme", "dark"));
  const ombre = await carte(page, "Zone dangereuse").evaluate(e => getComputedStyle(e).boxShadow);
  expect(ombre).toContain("inset");
});

test("les tableaux des comptes et des imports prennent la pleine largeur", async ({ page }) => {
  await ouvrir(page);
  const grille = await page.locator("#parametres .par-grille").boundingBox();
  for (const titre of ["Comptes", "Imports et archives"]) {
    const b = await carte(page, titre).boundingBox();
    expect(b.width, titre).toBeGreaterThan(grille.width - 2);
  }
});

// E2E : la ligne « Calcul routier » de l'ecran Parametres (OSRM integre a
// l'image Sereo, 23/09). Thomas y voit, sans rien ouvrir d'autre, si la carte
// locale sert, sa zone, sa date, et la derniere erreur.
//
// Serveur commun de playwright.config.js (`node server.js` : startServer()
// demarre le gestionnaire). Sur le poste de developpement comme en CI, les
// binaires OSRM n'existent pas : la ligne le dit. Les deux autres etats
// viennent d'une reponse interceptee.

const { test, expect } = require("./tuiles");

async function ouvrir(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#parametres", { waitUntil: "networkidle" });
}

test("la ligne dit ce que fait le serveur : ici, serveur public faute de binaires OSRM", async ({ page }) => {
  await ouvrir(page);
  const ligne = page.locator("#calculRoutierEtat");
  await expect(ligne).toBeVisible();
  await expect(ligne).toHaveText("Serveur public (binaires OSRM absents de cette installation).");
  // Dans la carte « Reglages tournee », sous un titre.
  const carte = page.locator("#parametres .par-carte", { has: page.locator("h3", { hasText: "Réglages tournée" }) });
  await expect(carte.locator("h4", { hasText: "Calcul routier" })).toBeVisible();
  await expect(carte.locator("#calculRoutierEtat")).toHaveCount(1);
});

test("carte locale prete : la phrase du serveur est affichee telle quelle ; serveur injoignable : on le dit", async ({ page }) => {
  const resume = "Sur carte locale « Bourgogne-Franche-Comté », données du 22/09/2026, 1,2 Go.";
  await page.route("**/api/storage/status", (route) =>
    route.fulfill({ json: { engine: "sqlite", calculRoutier: { actif: true, pret: true, resume } } }));
  await ouvrir(page);
  await expect(page.locator("#calculRoutierEtat")).toHaveText(resume);

  await page.unroute("**/api/storage/status");
  await page.route("**/api/storage/status", (route) => route.fulfill({ status: 500, json: { error: "panne" } }));
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#calculRoutierEtat")).toHaveText(/^État indisponible/);
});

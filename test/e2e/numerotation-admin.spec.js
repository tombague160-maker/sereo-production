// E2E : la numerotation des bons est reservee a l'administration (decision de
// Thomas du 23/09). Sur le serveur de test AVEC authentification (port 3101,
// playwright.config.js) : sans elle, tout le monde est administrateur.

const { test, expect } = require("./tuiles");

const BASE = "http://127.0.0.1:3101";
// Un identifiant par passage : la base de ce serveur survit entre deux lancements
// locaux (reuseExistingServer), et un identifiant deja pris serait refuse.
const LIVREUR = { identifiant: `livreur-numero-${Date.now()}`, motDePasse: "livreur-e2e-sans-valeur-2026" };

async function connecter(page, identifiant, motDePasse) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill("#username", identifiant);
  await page.fill("#password", motDePasse);
  await Promise.all([page.waitForURL(u => !String(u).includes("/login")), page.getByRole("button", { name: "Se connecter" }).click()]);
}

test("la carte « Numérotation des bons » est fermée à un compte non administrateur", async ({ browser }) => {
  // L'administrateur (couple d'environnement du serveur de test) cree le livreur.
  const admin = await browser.newContext();
  const pageAdmin = await admin.newPage();
  await connecter(pageAdmin, "banc", "banc-e2e-local-sans-valeur");
  const creation = await pageAdmin.evaluate(async compte => {
    const r = await fetch("/api/comptes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...compte, role: "livreur" }) });
    return r.status;
  }, LIVREUR);
  expect(creation).toBe(201);

  // Temoin positif : chez l'administrateur, la carte est ouverte.
  await pageAdmin.goto(BASE + "/#parametres", { waitUntil: "networkidle" });
  await expect(pageAdmin.locator("#parPrefixe")).toBeEnabled();
  await expect(pageAdmin.locator("#numerotationForm button[type=submit]")).toBeEnabled();
  await expect(pageAdmin.locator("#parNumeroReserve")).toHaveCount(0);

  const livreur = await browser.newContext();
  const page = await livreur.newPage();
  await connecter(page, LIVREUR.identifiant, LIVREUR.motDePasse);
  await page.goto(BASE + "/#parametres", { waitUntil: "networkidle" });
  await expect(page.locator("#parPrefixe")).toBeDisabled();
  await expect(page.locator("#parRemiseAnnuelle")).toBeDisabled();
  await expect(page.locator("#numerotationForm button[type=submit]")).toBeDisabled();
  await expect(page.locator("#parNumeroReserve")).toHaveText("Réservé aux administrateurs.");
  // Le prochain bon reste lisible.
  await expect(page.locator("#parExemple")).not.toHaveText("—");

  await admin.close();
  await livreur.close();
});

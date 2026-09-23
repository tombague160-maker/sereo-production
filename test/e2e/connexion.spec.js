// E2E : la page de connexion des planches 9b (normal), 9c (echec), 9d (bloquee).
//
// Sur le serveur de test AVEC authentification (port 3101, playwright.config.js) :
// sans elle, /login sert l'application.

const { test, expect } = require("./tuiles");

const BASE = "http://127.0.0.1:3101";

test("la page de la planche : la marque, les deux champs, le bouton, le pied", async ({ page }) => {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await expect(page.locator("h1#login-title")).toContainText("séréo");
  await expect(page.locator("#username")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  await expect(page.locator(".pied")).toContainText("Mot de passe oublié : voir Tom.");
});

test("les polices de la charte se chargent AVANT toute session", async ({ page }) => {
  // /fonts etait derriere l'authentification : la page de connexion tombait
  // sur la police systeme.
  const reponse = await page.request.get(BASE + "/fonts/poppins-600-latin.woff2");
  expect(reponse.status()).toBe(200);
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  const chargee = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('600 16px "Poppins"'); });
  expect(chargee).toBe(true);
});

test("« Afficher le mot de passe » montre et masque", async ({ page }) => {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  const voir = page.locator(".voir");
  await expect(voir).toBeVisible();
  await page.fill("#password", "secret");
  await voir.click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await expect(voir).toHaveAttribute("aria-pressed", "true");
  await expect(voir).toHaveAttribute("aria-label", "Masquer le mot de passe");
  await voir.click();
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
});

test("un échec : le champ mot de passe en alerte, le message lié au champ, sans dire lequel", async ({ page }) => {
  await page.goto(BASE + "/login?error=1", { waitUntil: "networkidle" });
  await expect(page.locator(".champ:has(#password)")).toHaveClass(/champ--erreur/);
  await expect(page.locator(".champ:has(#username)")).not.toHaveClass(/champ--erreur/);
  await expect(page.locator("#password")).toHaveAttribute("aria-describedby", "login-erreur");
  await expect(page.locator("#login-erreur")).toContainText("Identifiant ou mot de passe incorrect");
});

test("au téléphone : rien ne déborde", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login?error=1", { waitUntil: "networkidle" });
  const deborde = await page.evaluate(() => [...document.querySelectorAll(".carte *, .pied *")]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5; }).length);
  expect(deborde).toBe(0);
  await ctx.close();
});

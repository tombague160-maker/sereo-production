// E2E : la page de connexion des planches 9b (normal), 9c (echec), 9d (bloquee).
//
// Sur le serveur de test AVEC authentification (port 3101, playwright.config.js) :
// sans elle, /login sert l'application.

const { test, expect } = require("./tuiles");

// L adresse du serveur authentifie : 3101 par defaut ; un worktree qui lance ses
// bancs en parallele d autres passe la sienne (SEREO_E2E_AUTH_BASE_URL).
const BASE = process.env.SEREO_E2E_AUTH_BASE_URL || "http://127.0.0.1:3101";

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
  // Sans la route, une requete anonyme repond AUSSI 200 -- avec la page de
  // connexion en HTML. On exige donc une police.
  const reponse = await page.request.get(BASE + "/fonts/poppins-600-latin.woff2");
  expect(reponse.status()).toBe(200);
  expect(reponse.headers()["content-type"]).toContain("font/woff2");
  expect((await reponse.body()).length).toBeGreaterThan(5000);
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

test("au téléphone, le pied reste lisible sur son fond (pas sur les taches)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  const fond = await page.locator(".pied").evaluate(e => getComputedStyle(e).backgroundColor);
  expect(fond).not.toBe("rgba(0, 0, 0, 0)");
  await ctx.close();
});

test("après un échec, l'identifiant tapé est gardé (planche 9c), et nulle part ailleurs", async ({ page }) => {
  // Audit du 23/09, defaut 5 : l'identifiant etait efface. Il est garde par
  // l'onglet (sessionStorage), jamais dans l'URL, jamais renvoye par le
  // serveur ; le mot de passe, lui, repart vide.
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill("#username", "identifiant-du-banc");
  await page.fill("#password", "pas-le-bon-mot-de-passe");
  await Promise.all([page.waitForURL(/\/login\?error=1/), page.getByRole("button", { name: "Se connecter" }).click()]);
  await expect(page.locator("#username")).toHaveValue("identifiant-du-banc");
  await expect(page.locator("#password")).toHaveValue("");
  await expect(page.locator("#password")).toBeFocused();
  expect(page.url()).not.toContain("identifiant-du-banc");
  const html = await (await page.request.get(page.url())).text();
  expect(html, "le serveur ne renvoie ni l'identifiant ni le mot de passe").not.toMatch(/identifiant-du-banc|pas-le-bon-mot-de-passe/);
  // Une page de connexion ordinaire l'oublie.
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await expect(page.locator("#username")).toHaveValue("");
});

test("« Se déconnecter » ferme vraiment la session", async ({ browser }) => {
  // Audit du 23/09, defaut 14 : aucun bouton de deconnexion dans l'interface.
  // Identifiants JETABLES du serveur de banc (playwright.config.js).
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill("#username", "banc");
  await page.fill("#password", "banc-e2e-local-sans-valeur");
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith("/login")), page.getByRole("button", { name: "Se connecter" }).click()]);
  const bouton = page.locator(".sidebar").getByRole("button", { name: "Se déconnecter" });
  await expect(bouton).toBeVisible();
  await Promise.all([page.waitForURL(/\/login/), bouton.click()]);
  // La session est partie : l'application renvoie a la connexion.
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await expect(page.locator("#username")).toBeVisible();
  await ctx.close();
});

test("le mot de passe affiché repasse masqué à l'envoi", async ({ page }) => {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill("#password", "secret");
  await page.locator(".voir").click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await page.evaluate(() => document.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true })));
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
});

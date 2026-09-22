// E2E smoke tests Sereo - v1.13.2 (Sprint 3 audit, T1)
// Couvre les golden paths critiques. Si un de ces tests casse en CI,
// alerte avant deploiement.

const { test, expect } = require("./tuiles");

test.describe("Sereo smoke tests", () => {
  test("page d'accueil charge le tableau de bord", async ({ page }) => {
    await page.goto("/");
    // Le titre du tableau de bord suit la planche 6a : « Bonjour <identifiant> »
    // des que /api/me a repondu, « Tableau de bord » avant. Attendre l'un
    // precisement faisait de ce test une course contre /api/me -- vert ou
    // rouge selon qui arrivait le premier. On verifie ce que la planche promet.
    await expect(page.locator("#journee")).toHaveClass(/active/);
    await expect(page.locator("#pageTitle")).toHaveText(/^(Bonjour \S+|Tableau de bord)$/);
  });

  test("navigation vers Bons de commande affiche la liste ou empty state", async ({ page }) => {
    await page.goto("/");
    // Le chemin reel de la planche : l'entree Commandes ouvre le groupe, et
    // les cinq listes qu'elle absorbe apparaissent en pilules sous le titre.
    // Les cinq listes n'en font plus qu'une (planche 13c) : l'entree Commandes
    // ouvre le tableau unique.
    await page.locator("#nav-commandes").click();
    await expect(page.locator("#commandes")).toHaveClass(/active/);
    // Soit on a des cards, soit empty state "Aucune commande"
    // toBeVisible ATTEND ; isVisible() ne le fait pas (son timeout est ignore)
    // et faisait une course avec le chargement des donnees.
    await expect(page.locator("#commandes .cmd-ligne, #commandes .empty-state").first()).toBeVisible({ timeout: 5000 });
  });

  test("navigation vers Parametres affiche les sections theme + zone dangereuse", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-action="go-tab"][data-target-tab="parametres"]').click();
    await expect(page.locator("#parThemeTitre")).toHaveText("Thème");
    // Zone dangereuse v1.12.0
    await expect(page.getByText("Zone dangereuse", { exact: false })).toBeVisible();
  });

  test("modal version 'Quoi de neuf' s'ouvre et se ferme avec Escape", async ({ page }) => {
    await page.goto("/");
    // Clic sur le chip version dans la sidebar
    const versionChip = page.locator(".sidebar-version").first();
    await versionChip.click();
    await expect(page.locator("#versionModal[aria-hidden='false']")).toBeVisible();
    // Escape ferme
    await page.keyboard.press("Escape");
    await expect(page.locator("#versionModal[aria-hidden='false']")).toBeHidden();
  });

  test("import sans fichier renvoie une erreur user-friendly", async ({ page }) => {
    await page.goto("/");
    // On clique le bouton "Importer les dossiers" sans avoir choisi de fichier.
    // Par son id : un bouton d'en-tete « Importer le stock » (masque ici) le
    // precede dans le document, et le « .first() » d'avant sautait le banc.
    const importBtn = page.locator("#importVentesButton");
    await expect(importBtn).toBeVisible();
    await importBtn.click();
    await expect(page.locator(".notif, .toast").filter({ hasText: /fichier/i }).first())
      .toBeVisible({ timeout: 3000 });
  });

  // v1.17.1 : nouveaux panneaux Parametres (Reglages tournee + Diagnostic dates)
  test("v1.17.1 — sliders tournee modifient l'affichage et persistent", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-target-tab="parametres"]').first().click();

    await expect(page.getByText("Réglages tournée", { exact: false })).toBeVisible();

    const speedSlider = page.locator("#tourneeSpeedSlider");
    const speedValue = page.locator("#tourneeSpeedValue");
    await expect(speedSlider).toBeVisible();

    await speedSlider.fill("40");
    // L'event "input" est emis par fill ; sinon dispatchEvent fallback.
    await speedSlider.dispatchEvent("input");
    await expect(speedValue).toHaveText("40 km/h");

    // Debounce 500ms + sauvegarde HTTP
    await expect(page.locator("#tourneeSettingsStatus")).toHaveText(/Enregistré/i, { timeout: 3000 });

    // Reload : la valeur doit etre rechargee depuis le backend
    await page.reload();
    await page.locator('[data-target-tab="parametres"]').first().click();
    await expect(page.locator("#tourneeSpeedSlider")).toHaveValue("40");
    await expect(page.locator("#tourneeSpeedValue")).toHaveText("40 km/h");
  });

  test("v1.17.1 — bouton diagnostic dates affiche le resultat", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-target-tab="parametres"]').first().click();

    await expect(page.getByText("Diagnostic dates", { exact: false })).toBeVisible();
    await page.locator('[data-action="diagnostic-suspicious-dates"]').click();

    await expect(page.locator("#diagnosticDatesStatus")).toContainText(/commandes/i, { timeout: 5000 });
  });
});

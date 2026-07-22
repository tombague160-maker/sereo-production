// E2E smoke tests Sereo - v1.13.2 (Sprint 3 audit, T1)
// Couvre les golden paths critiques. Si un de ces tests casse en CI,
// alerte avant deploiement.

const { test, expect } = require("@playwright/test");

test.describe("Sereo smoke tests", () => {
  test("page d'accueil charge le tableau de bord", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  });

  test("navigation vers Bons de commande affiche la liste ou empty state", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-action="toggle-nav-section"][data-nav-section-target="commandes"]').click();
    await page.locator("#tab-bons-commande").click();
    await expect(page.locator("#bons-commande")).toHaveClass(/active/);
    // Soit on a des cards, soit empty state "Aucune commande"
    const hasContent = await page.locator("#bons-commande .bdc-card, #bons-commande .empty-state").first().isVisible({ timeout: 5000 });
    expect(hasContent).toBe(true);
  });

  test("navigation vers Parametres affiche les sections theme + zone dangereuse", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-action="go-tab"][data-target-tab="parametres"]').click();
    await expect(page.getByText("Personnalisation de l'interface", { exact: false })).toBeVisible();
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
    // On clique le bouton "Importer les dossiers" sans avoir choisi de fichier
    const importBtn = page.locator('button:has-text("Importer les dossiers"), button:has-text("Importer le stock")').first();
    if (await importBtn.isVisible()) {
      await importBtn.click();
      // Notification "Choisis un fichier" apparait
      await expect(page.locator(".notif, .toast").filter({ hasText: /fichier/i }).first())
        .toBeVisible({ timeout: 3000 });
    }
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

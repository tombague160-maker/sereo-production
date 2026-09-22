// E2E : la navigation laterale est PLATE.
//
// Ce fichier remplace nav-accordeon.spec.js, qui verifiait qu'une section
// s'ouvre et que les autres se referment. Ce comportement n'existe plus, et
// ce n'est pas une regression : mesure sur les 49 planches de l'export
// Claude Design (design/export-v8), aucune ne contient un seul aria-expanded
// ni un seul groupe repliable dans la barre. La passation le dit en toutes
// lettres : « Nav desktop a huit entrees, sans depliant sous Commandes : les
// cinq listes fusionnent en une. Parametres par l'engrenage. »
//
// Un banc qui verifiait l'accordeon aurait donc interdit la planche. Celui-ci
// verifie la planche.

const { test, expect } = require("./tuiles");

const ENTREES = [
  "Tableau de bord", "Commandes", "Préparation", "Tournée",
  "Abonnements", "Stock", "Clients", "Analyse"
];

test.describe("Navigation laterale plate", () => {
  test("huit entrees, dans l'ordre de la planche", async ({ page }) => {
    await page.goto("/");
    const libelles = await page.locator(".sidebar .tab .nav-libelle")
      .evaluateAll(els => els.map(el => el.textContent.trim()));
    expect(libelles).toEqual(ENTREES);
  });

  test("rien ne se deplie dans la barre", async ({ page }) => {
    await page.goto("/");
    // Un element repliable ne PEUT PAS exister sans aria-expanded : c'est ce
    // qui rend la question mesurable sans rien savoir de la mise en page.
    const repliables = await page.locator(".sidebar [aria-expanded]").count();
    expect(repliables, "la barre laterale ne doit contenir aucun depliant").toBe(0);
  });

  test("une entree reste allumee pour tous les ecrans qu'elle absorbe", async ({ page }) => {
    await page.goto("/");
    // Une entree absorbe plusieurs ecrans (Analyse : statistiques et
    // exports). Passer de l'un a l'autre ne doit pas l'eteindre.
    await page.locator("#nav-analyse").click();
    await page.locator("#tab-exports").click();
    await expect(page.locator("#exports")).toHaveClass(/active/);
    await expect(page.locator("#nav-analyse")).toHaveClass(/active/);
    // Les rappels sont devenus un ecran SECONDAIRE de Clients (planche 13e).
    await page.locator("#nav-clients").click();
    await page.locator('#enteteActions [data-target-tab="relances"]').click();
    await expect(page.locator("#relances")).toHaveClass(/active/);
    await expect(page.locator("#nav-clients")).toHaveClass(/active/);
    // « A recommander » est devenu une CARTE du Stock (planche 13d) : son lien
    // « Tout voir » ouvre la liste detaillee, et Stock reste allume.
    await page.locator("#nav-stock").click();
    await page.locator("#stock .stk-tout-voir").click();
    await expect(page.locator("#recommande")).toHaveClass(/active/);
    await expect(page.locator("#nav-stock")).toHaveClass(/active/);
    // Et un ecran SECONDAIRE -- la saisie de commande, atteinte par le bouton
    // de l'en-tete -- garde allumee l'entree Commandes.
    await page.locator("#nav-commandes").click();
    await page.locator('#enteteActions [data-target-tab="commande-client"]').click();
    await expect(page.locator("#commande-client")).toHaveClass(/active/);
    await expect(page.locator("#nav-commandes")).toHaveClass(/active/);
    await expect(page.locator("#nav-commandes")).toHaveAttribute("aria-selected", "true");
  });

  test("un groupe d'un seul ecran n'affiche aucune pilule", async ({ page }) => {
    await page.goto("/");
    await page.locator("#nav-preparation").click();
    // Une pilule unique et toujours active n'apprendrait rien : la rangee
    // doit disparaitre, pas se reduire a un element.
    await expect(page.locator("#sousOnglets")).toBeHidden();
  });

  test("la recherche du menu trouve un ecran qui n'a plus de ligne a soi", async ({ page }) => {
    await page.goto("/");
    // « Bons de commande » n'est plus un ecran : ses bons vivent dans la liste
    // unique des Commandes (planche 13c). Taper son ancien nom doit y mener,
    // sur le filtre qui lui correspond.
    await page.fill("#menuSearch", "bons");
    await page.press("#menuSearch", "Enter");
    await expect(page.locator("#commandes")).toHaveClass(/active/);
    await expect(page.locator('[data-cmd-filtre="toutes"]')).toHaveAttribute("aria-pressed", "true");
  });

  test("le bloc compte porte l'identite de /api/me, pas un nom de maquette", async ({ page }) => {
    await page.goto("/");
    // La planche ecrit « Tom / Administrateur ». C'est une donnee
    // d'illustration : l'ecrire en dur afficherait le meme nom a tout le monde.
    const identite = await page.evaluate(async () => {
      const reponse = await fetch("/api/me");
      return reponse.ok ? reponse.json() : null;
    });
    test.skip(!identite, "pas de session : rien a comparer");
    await expect(page.locator("#sidebarIdentifiant")).toHaveText(identite.identifiant);
    await expect(page.locator("#sidebarRole")).toHaveText(identite.roleLibelle);
  });
});

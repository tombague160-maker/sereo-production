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
    await page.locator("#nav-commandes").click();
    // Les cinq listes de commandes vivent sous UNE entree. Se deplacer de
    // l'une a l'autre ne doit pas eteindre Commandes -- sinon l'utilisateur
    // ne sait plus ou il est.
    for (const onglet of ["bons-commande", "commandes-livrees", "commande-client"]) {
      await page.locator(`#tab-${onglet}`).click();
      await expect(page.locator(`#${onglet}`)).toHaveClass(/active/);
      await expect(page.locator("#nav-commandes")).toHaveClass(/active/);
      await expect(page.locator("#nav-commandes")).toHaveAttribute("aria-selected", "true");
    }
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
    // « Bons de commande » n'est plus une entree : il est absorbe par
    // Commandes. Si la recherche ne repondait que sur les huit libelles
    // visibles, cet ecran deviendrait introuvable au clavier.
    await page.fill("#menuSearch", "bons");
    await page.press("#menuSearch", "Enter");
    await expect(page.locator("#bons-commande")).toHaveClass(/active/);
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

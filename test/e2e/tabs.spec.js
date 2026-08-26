// E2E : parcours complet des onglets.
//
// Pourquoi ce fichier existe : smoke.spec.js ne visite que 4 onglets sur 15, et
// aucun test unitaire ne charge public/js/app.js. Avant le decoupage de app.js
// en modules ES (chantier V8 phase 0), le front n'avait donc aucun filet : une
// fonction oubliee lors d'une extraction cassait une page en silence, et seul
// un humain ouvrant cette page precise s'en apercevait.
//
// Ce parcours affirme trois choses par onglet :
//   1. le panneau devient bien actif (le routage par hash fonctionne)
//   2. il contient quelque chose (ni page blanche, ni squelette vide)
//   3. aucune erreur console n'a ete emise pendant l'affichage
//
// Le point 3 est le plus important pour un refactor : une ReferenceError sur
// une fonction non exportee se voit immediatement ici, alors qu'elle serait
// invisible dans un `node --check`.

const { test, expect } = require("@playwright/test");

const TABS = [
  { id: "journee", label: "Tableau de bord" },
  { id: "commande-client", label: "Commande client" },
  { id: "commandes-jour", label: "Commandes du jour" },
  { id: "commandes-planifiees", label: "Commandes planifiées" },
  { id: "bons-commande", label: "Bons de commande" },
  { id: "commandes-livrees", label: "Commandes livrées" },
  { id: "preparation", label: "Préparation" },
  { id: "livreur", label: "Livraison" },
  { id: "stock", label: "Stock" },
  { id: "recommande", label: "À recommander" },
  { id: "crm", label: "CRM" },
  { id: "relances", label: "Relances" },
  { id: "statistiques", label: "Statistiques" },
  { id: "exports", label: "Exports" },
  { id: "parametres", label: "Paramètres" }
];

/**
 * Erreurs console tolerees. Volontairement vide : toute entree ajoutee ici doit
 * etre justifiee en commentaire, sinon le filet se detend silencieusement.
 */
const IGNORED_CONSOLE = [];

function collectConsoleErrors(page) {
  const errors = [];
  page.on("console", message => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_CONSOLE.some(pattern => pattern.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", error => {
    errors.push(`PAGEERROR: ${error.message}`);
  });
  return errors;
}

test.describe("Parcours complet des onglets", () => {
  test("les 15 onglets s'affichent sans erreur console", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await expect(page.locator("#journee")).toHaveClass(/active/);

    for (const tab of TABS) {
      await page.evaluate(id => {
        window.location.hash = `#${id}`;
      }, tab.id);

      const panel = page.locator(`#${tab.id}`);

      // 1. Le panneau devient actif.
      await expect(panel, `l'onglet ${tab.id} devrait devenir actif`).toHaveClass(/active/, {
        timeout: 5000
      });

      // 2. Il contient du contenu rendu. On mesure la hauteur plutot que de
      //    chercher un selecteur precis : un panneau vide fait quelques pixels,
      //    un panneau rendu en fait des centaines. Robuste au redesign a venir.
      const height = await panel.evaluate(element => element.getBoundingClientRect().height);
      expect(height, `l'onglet ${tab.id} semble vide (${height}px)`).toBeGreaterThan(80);
    }

    // 3. Aucune erreur sur l'ensemble du parcours.
    expect(errors, `erreurs console pendant le parcours :\n${errors.join("\n")}`).toEqual([]);
  });

  test("chaque onglet reste accessible apres un rechargement direct par URL", async ({ page }) => {
    // Regression ciblee : le routage par hash doit fonctionner au chargement
    // initial, pas seulement lors d'une navigation depuis le tableau de bord.
    // C'est le cas d'usage "lien partage" et "raccourci ecran d'accueil".
    const errors = collectConsoleErrors(page);

    for (const tab of TABS) {
      await page.goto(`/#${tab.id}`);
      await expect(page.locator(`#${tab.id}`), `${tab.id} au chargement direct`).toHaveClass(
        /active/,
        { timeout: 5000 }
      );
    }

    expect(errors, `erreurs console au chargement direct :\n${errors.join("\n")}`).toEqual([]);
  });

  test("la navigation laterale expose bien les 15 onglets", async ({ page }) => {
    // Garde-fou contre une extraction qui oublierait de recabler un bouton :
    // le panneau existerait toujours, mais deviendrait inatteignable a la souris.
    await page.goto("/");

    for (const tab of TABS) {
      const trigger = page.locator(
        `#tab-${tab.id}, [data-action="go-tab"][data-target-tab="${tab.id}"]`
      );
      expect(
        await trigger.count(),
        `aucun declencheur de navigation pour ${tab.id}`
      ).toBeGreaterThan(0);
    }
  });
});

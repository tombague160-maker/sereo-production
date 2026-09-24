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

const { test, expect } = require("./tuiles");

const TABS = [
  { id: "abonnements", label: "Abonnements" },
  { id: "journee", label: "Tableau de bord" },
  { id: "commandes", label: "Commandes" },
  { id: "commande-client", label: "Commande client" },
  { id: "preparation", label: "Préparation" },
  { id: "livreur", label: "Livraison" },
  { id: "stock", label: "Stock" },
  { id: "recommande", label: "À recommander" },
  { id: "crm", label: "CRM" },
  { id: "relances", label: "Relances" },
  { id: "statistiques", label: "Statistiques" },
  // « exports » n'est plus un ecran (decision 9, 24/09) : il redirige vers
  // Commandes, voir « les anciennes adresses redirigent » plus bas.
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
  test("tous les onglets s'affichent sans erreur console", async ({ page }) => {
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

  test("aucun ecran n'est orphelin : les huit entrees menent aux seize", async ({ page }) => {
    // La planche fusionne seize ecrans en huit entrees. Le risque qu'elle cree
    // est precis : un ecran qui existe encore mais que plus rien n'ouvre.
    //
    // L'ancienne version cherchait un declencheur « quelque part dans le DOM ».
    // Elle serait restee verte sur une barre qui n'ouvre rien, parce qu'un
    // bouton « go-tab » pose dans une page suffisait a la satisfaire. Ce banc
    // suit la CHAINE : on clique les huit entrees, on clique chaque pilule
    // qu'elles font apparaitre, et on exige que l'union couvre les seize.
    await page.goto("/");
    const entrees = await page.locator(".sidebar .tab[data-groupe]")
      .evaluateAll(els => els.map(el => el.id));
    expect(entrees.length, "la barre doit porter huit entrees plates").toBe(8);

    const atteints = new Set();
    for (const entree of entrees) {
      await page.locator(`#${entree}`).click();
      const ouvert = await page.evaluate(() => document.querySelector(".page.active")?.id || null);
      expect(ouvert, `l'entree ${entree} n'ouvre aucun ecran`).toBeTruthy();
      atteints.add(ouvert);

      // Seules les pilules d'une rangee VISIBLE sont des chemins. Un groupe d'un
      // seul ecran rend quand meme sa pilule, masquee, pour porter le nom
      // accessible de la page ; elle n'est pas un chemin, et l'entree de la
      // barre qui mene a cet ecran est deja comptee juste au-dessus.
      // Un ecran SECONDAIRE (la saisie de commande) s'atteint par une commande
      // de l'en-tete, pas par une pilule : on la suit aussi.
      // Et un lien DANS l'ecran, marque data-lien-secondaire (« Tout voir » de
      // la carte « A recommander ») : meme regle.
      const secondaires = await page.locator(
        "#enteteActions [data-target-tab]:not([hidden]), .page.active [data-lien-secondaire][data-target-tab]")
        .evaluateAll(els => els.map(el => el.dataset.targetTab));
      for (const onglet of secondaires) {
        await page.locator(`#enteteActions [data-target-tab="${onglet}"]:not([hidden]), .page.active [data-lien-secondaire][data-target-tab="${onglet}"]`).first().click();
        await expect(page.locator(`#${onglet}`), `${onglet} par l'en-tete`).toHaveClass(/active/);
        atteints.add(onglet);
        await page.locator(`#${entree}`).click();
      }

      const pilules = await page.locator("#sousOnglets:not([hidden]) [data-tab]")
        .evaluateAll(els => els.map(el => el.dataset.tab));
      for (const onglet of pilules) {
        await page.locator(`#tab-${onglet}`).click();
        await expect(page.locator(`#${onglet}`), `${onglet} par sa pilule`).toHaveClass(/active/);
        atteints.add(onglet);
      }
    }

    // Parametres quitte la liste : la planche le confie a l'engrenage du bloc
    // compte. C'est donc par la, et seulement par la, qu'on doit y arriver.
    await page.locator(".sidebar-compte").click();
    await expect(page.locator("#parametres")).toHaveClass(/active/);
    atteints.add("parametres");

    const manquants = TABS.map(tab => tab.id).filter(id => !atteints.has(id));
    expect(manquants, `ecrans sans aucun chemin depuis la barre : ${manquants}`).toEqual([]);
  });

  test("les quatre anciennes listes de commandes redirigent, avec leur filtre", async ({ page }) => {
    // Un favori, un lien partage ou un geste code en dur qui visait l'ancien
    // ecran doit arriver sur la liste unique, filtree comme l'ancien ecran.
    const ATTENDU = {
      // Decision 9 (24/09) : l'ecran Exports est parti ; on exporte depuis Commandes.
      exports: "toutes",
      "bons-commande": "toutes",
      "commandes-livrees": "livrees",
      "commandes-planifiees": "planifiees",
      "commandes-jour": "a-envoyer"
    };
    for (const [ancien, filtre] of Object.entries(ATTENDU)) {
      await page.goto(`/#${ancien}`);
      await expect(page.locator("#commandes"), `${ancien} -> commandes`).toHaveClass(/active/);
      await expect(page.locator(`[data-cmd-filtre="${filtre}"]`)).toHaveAttribute("aria-pressed", "true");
      expect(new URL(page.url()).hash).toBe("#commandes");
    }
  });
});

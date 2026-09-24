// E2E : « Tout sélectionner » de la tournée pendant le chargement.
//
// Defaut releve le 23/09 par une relecture adverse, a partir d'un banc
// instable (operations.spec.js). loadData() part au DOMContentLoaded et
// interroge dix-sept routes. Sur un reseau lent, un livreur touchait
// « Tout sélectionner » AVANT l'arrivee des commandes :
//   - selectAllDelivery() prenait une liste vide et ne selectionnait rien ;
//   - renderDeliveryCandidates() affichait « Aucune commande prête à livrer —
//     Termine des préparations… » : un faux etat vide, qui ment ;
//   - les commandes arrivaient ensuite DECOCHEES, « 0 sélection », et
//     « Créer une tournée optimisée » restait desactive. Le geste etait perdu
//     sans que rien ne le dise.
// Le banc instable attendait les donnees ; un humain ne le fait pas. Ce banc-ci
// rejoue le geste humain, sur une API /api/orders volontairement lente.
//
// Serveur seme, SANS tournee en cours : la planification (#routePlanning) reste
// ouverte et une seule commande est prete a livrer (o-8, Bellevue, Dole).

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

const LENTEUR_MS = 4000;

test.describe("Tournée — sélection pendant le chargement", () => {
  test.describe.configure({ mode: "serial" });
  let serveur;

  test.beforeAll(async () => {
    serveur = await demarrer({ port: 3186, seed: { ...jeuDeDonnees(), routes: [] } });
  });
  test.afterAll(async () => { await serveur?.arreter(); });

  test("un toucher sur « Tout sélectionner » avant les commandes ne ment pas et ne se perd pas", async ({ page }) => {
    test.setTimeout(60000);
    // Temoin de l'instant : les assertions « pendant » ne valent que si la
    // reponse des commandes n'est PAS encore partie quand on les fait.
    let commandesServies = false;
    await page.route("**/api/orders", async route => {
      await new Promise(r => setTimeout(r, LENTEUR_MS));
      commandesServies = true;
      await route.continue();
    });
    await page.goto(serveur.base + "/#livreur", { waitUntil: "domcontentloaded" });

    const tout = page.getByRole("button", { name: "Tout sélectionner", exact: true });
    await expect(tout).toBeVisible();
    // Le geste humain : il touche, sans attendre que le bouton soit actif.
    // HTMLElement.click() est l'activation du bouton telle que la plateforme la
    // definit : sur un bouton desactive elle ne fait RIEN (spec HTML), sur un
    // bouton actif elle emet le clic que l'app delegue au document.
    // Pas `click({ force: true })` : il fait defiler la page jusqu'au bouton
    // (1 170 px plus bas pendant le chargement), et l'app remet la page en haut
    // au DOMContentLoaded puis au `load` (resetViewportScroll : tout de suite,
    // a l'image suivante, et 120 ms plus tard). Si cette remise tombe entre le
    // defilement et le clic, Playwright meurt « Element is outside of the
    // viewport » -- 1 rouge sur 30 sous charge, le 23/09, qui n'accusait rien.
    // Pas `dispatchEvent("click")` non plus : il passe outre `disabled`.
    await tout.evaluate(bouton => bouton.click());
    // La pilule de secteur reste active pendant le chargement (le filtre choisi
    // est garde pour le rendu final) ; elle redessine la liste. C'est elle qui
    // juge le rendu lui-meme : sans garde, elle afficherait aussi le faux etat
    // vide. (Avant le 24/09, c'etait « Filtrer », retire : les pilules filtrent
    // tout de suite -- pieges-tournee.spec.js.)
    await page.locator('#deliverySectorPills [data-delivery-sector="Tous"]').click();
    await page.waitForTimeout(300);

    const candidates = page.locator("#deliveryCandidates");
    const pendant = {
      texte: (await candidates.innerText()).trim(),
      occupe: await candidates.getAttribute("aria-busy"),
      toutActif: await tout.isEnabled()
    };
    expect(commandesServies, "prealable : les commandes etaient deja arrivees, rien n'a ete juge").toBe(false);
    // 1. Aucun faux etat vide pendant le chargement.
    expect(pendant.texte, "faux etat vide affiche avant l'arrivee des commandes").not.toContain("Aucune commande");
    // 2. La zone annonce qu'elle charge (squelette + aria-busy).
    expect(pendant.occupe, "la liste des commandes n'annonce pas son chargement").toBe("true");
    // 3. Le geste ne peut pas etre pris puis perdu : le bouton attend les donnees.
    expect(pendant.toutActif, "« Tout sélectionner » accepte un toucher qui ne selectionnera rien").toBe(false);

    // Apres : la commande prete arrive, le bouton s'active, le geste marche.
    await expect(candidates.locator("[data-delivery-order]")).toHaveCount(1);
    await expect(candidates).not.toHaveAttribute("aria-busy", "true");
    // Explicite plutot que l'attente implicite du clic : un bouton jamais
    // reactive doit rougir ICI, en le nommant, et non par un timeout de test.
    await expect(tout, "« Tout sélectionner » ne se reactive pas une fois les commandes arrivees").toBeEnabled();
    await tout.click();
    await expect(page.locator("#selectedDeliveryCount")).toHaveText("1 sélection");
    await expect(page.locator("#createRouteButton")).toBeEnabled();
  });
});

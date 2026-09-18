// E2E : l'accordeon de la barre laterale doit replier DANS LES DEUX MODES.
//
// Le probleme que ce fichier fige est le jumeau de celui de themes.spec.js, et
// il se lisait de la meme facon : une propriete ecrite dans un seul des blocs
// de theme. Ici ce n'etait pas une variable de couleur mais un COMPORTEMENT.
// Les quatre regles de repli etaient toutes prefixees
// `:root[data-color-scheme="light"]`, sans contrepartie sombre ni neutre.
//
// Ce que ca donnait en mode sombre, mesure au clic :
//   - la classe `.open` changeait          -> l'etat interne bougeait
//   - `aria-expanded` changeait            -> l'etat accessible bougeait
//   - la hauteur restait a 250px           -> RIEN ne se repliait
//
// Le defaut etait donc invisible a toute relecture de JS (le JS fait son
// travail) et a toute relecture d'une seule regle CSS (chaque regle est juste).
// Il n'apparait qu'en comparant l'etat annonce a l'affichage obtenu, dans les
// deux modes. C'est ce que ce test fait, et rien d'autre.
//
// Le cas le plus grave n'est pas cosmetique : `aria-expanded="false"` sur un
// contenu visible annonce a un lecteur d'ecran un repli qui n'a pas eu lieu.

const { test, expect } = require("./tuiles");

/** Lit l'etat annonce et l'affichage reel d'une section de navigation. */
async function lireSection(page, id) {
  return page.evaluate(sectionId => {
    const section = document.querySelector(`[data-nav-section-id="${sectionId}"]`);
    if (!section) throw new Error(`section introuvable : ${sectionId}`);
    const items = section.querySelector(".nav-section-items");
    return {
      ouverte: section.classList.contains("open"),
      ariaExpanded: section.querySelector(".nav-section-toggle").getAttribute("aria-expanded"),
      display: getComputedStyle(items).display,
      hauteur: Math.round(items.getBoundingClientRect().height)
    };
  }, id);
}

for (const mode of ["light", "dark"]) {
  test(`l'accordeon replie et deplie en mode ${mode}`, async ({ browser }) => {
    const context = await browser.newContext({
      colorScheme: mode,
      viewport: { width: 1440, height: 900 }
    });
    await context.addInitScript(value => {
      try { localStorage.setItem("sereo:colorScheme", value); } catch { /* ignore */ }
    }, mode);

    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForSelector('[data-nav-section-id="commandes"] .nav-section-toggle');

    const depart = await lireSection(page, "commandes");

    // Premier clic : l'etat s'inverse, et l'AFFICHAGE doit suivre.
    await page.click('[data-nav-section-target="commandes"]');
    await page.waitForTimeout(350);
    const apresPremier = await lireSection(page, "commandes");

    expect(apresPremier.ouverte, "la classe .open doit s'inverser").toBe(!depart.ouverte);
    expect(
      apresPremier.hauteur === depart.hauteur,
      `l'affichage doit suivre l'etat (hauteur ${depart.hauteur} -> ${apresPremier.hauteur})`
    ).toBe(false);

    // L'etat ANNONCE doit correspondre a ce qui est AFFICHE, pas seulement
    // changer : c'est la partie qui mentait aux lecteurs d'ecran.
    const visible = apresPremier.hauteur > 0 && apresPremier.display !== "none";
    expect(apresPremier.ariaExpanded, "aria-expanded doit decrire l'affichage reel")
      .toBe(visible ? "true" : "false");

    // Second clic : retour a l'etat de depart, affichage compris.
    await page.click('[data-nav-section-target="commandes"]');
    await page.waitForTimeout(350);
    const apresSecond = await lireSection(page, "commandes");

    expect(apresSecond.ouverte).toBe(depart.ouverte);
    expect(apresSecond.hauteur).toBe(depart.hauteur);

    await context.close();
  });
}

// E2E : le squelette de chargement, et les deux regles qui le rendent honnete.
//
// La charte (DESIGN.md §2) prevoit un jeton `--v8-squelette` -- "blocs gris qui
// remplacent le texte pendant le chargement, JAMAIS de texte dessus". Il etait
// declare, mesure, et branche NULLE PART. Mesure du 18/09 en ralentissant l'API
// a 2,5 s : les panneaux du tableau de bord etaient des boites blanches vides
// pendant tout le chargement. Rien ne distinguait "ca charge" de "c'est vide"
// ou de "c'est casse".
//
// Deux invariants, et ils comptent autant l'un que l'autre :
//
//   1. JAMAIS DE TEXTE. Un squelette occupe la place de ce qui vient, il
//      n'annonce rien. Consequence utile : il ne porte aucun glyphe, donc le
//      balayage de contraste ne le juge pas et n'a pas a l'exempter -- une
//      exemption de plus serait une porte de plus.
//
//   2. IL DOIT DISPARAITRE. Un squelette qui ne finit jamais ment plus qu'une
//      zone vide : il promet quelque chose qui n'arrive pas. Et `aria-busy`
//      reste sinon a "true", ce qui annonce a un lecteur d'ecran un chargement
//      termine depuis longtemps. Le premier jet posait les blocs sans jamais
//      les retirer -- onze zones l'ont porte a vie avant que la mesure le dise.

const { test, expect } = require("@playwright/test");

const LENTEUR_MS = 2500;

/** Charge l'app avec une API ralentie, pour voir l'etat intermediaire. */
async function chargerAuRalenti(browser, mode) {
  const ctx = await browser.newContext({ colorScheme: mode, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(m => {
    try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ }
  }, mode);
  const page = await ctx.newPage();
  await page.route("**/api/**", async route => {
    await new Promise(r => setTimeout(r, LENTEUR_MS));
    route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

for (const mode of ["light", "dark"]) {
  test(`squelette — il apparait pendant le chargement, en mode ${mode}`, async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page } = await chargerAuRalenti(browser, mode);
    await page.waitForTimeout(1200);

    const pendant = await page.evaluate(() => ({
      squelettes: document.querySelectorAll(".squelette").length,
      blocs: document.querySelectorAll(".squelette-bloc").length,
      busy: document.querySelectorAll('[aria-busy="true"]').length,
      // Les blocs doivent avoir une surface : un squelette de largeur nulle
      // existe dans le DOM et ne se voit pas. C'est arrive au graphique --
      // pose dans un conteneur flex, il rendait 90 px au lieu de 556.
      //
      // MAIS on ne juge que l'onglet VISIBLE. Les squelettes des autres onglets
      // sont a 0x0 parce que leur section est masquee -- c'est correct, et une
      // premiere version de ce test les comptait comme defauts. L'instrument
      // accusait le produit d'un choix qu'il avait lui-meme mal cadre.
      //
      // Le selecteur compte : l'application masque par `.page.active`, et NON
      // par l'attribut hidden. Un filtre bati sur cet attribut ne retirait donc
      // rien du tout et laissait passer huit squelettes d'onglets caches -- un
      // filtre qui a l'air juste, qui se lit bien, et qui ne filtre rien.
      // Mesure : les sections inactives portent display:none et h=0.
      invisibles: [...document.querySelectorAll("section.page.active .squelette")].filter(s => {
        const r = s.getBoundingClientRect();
        return r.width < 40 || r.height < 8;
      }).length,
      visiblesJuges: document.querySelectorAll("section.page.active .squelette").length
    }));

    expect(pendant.squelettes, "aucun squelette pendant le chargement").toBeGreaterThan(5);
    expect(pendant.blocs, "des squelettes sans blocs").toBeGreaterThan(pendant.squelettes);
    expect(pendant.busy, "les zones en attente doivent porter aria-busy").toBeGreaterThan(0);
    // Un zero ne vaut que si l'onglet visible en portait.
    expect(pendant.visiblesJuges, "aucun squelette dans l'onglet visible : rien n'a ete juge").toBeGreaterThan(0);
    expect(pendant.invisibles, "squelette(s) de l'onglet VISIBLE sans surface").toBe(0);

    await ctx.close();
  });

  test(`squelette — JAMAIS de texte dessus, en mode ${mode}`, async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page } = await chargerAuRalenti(browser, mode);
    await page.waitForTimeout(1200);

    const avecTexte = await page.evaluate(() =>
      [...document.querySelectorAll(".squelette")]
        .filter(s => s.textContent.trim().length > 0)
        .map(s => s.textContent.trim().slice(0, 40)));

    expect(avecTexte, "la charte l'interdit : un squelette n'annonce rien, il occupe une place").toEqual([]);
    await ctx.close();
  });

  test(`squelette — il DISPARAIT une fois charge, en mode ${mode}`, async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page } = await chargerAuRalenti(browser, mode);

    // Prealable : il faut qu'il ait ete la, sinon ce test passerait sur une
    // application qui n'en pose jamais.
    await page.waitForTimeout(1200);
    const avant = await page.evaluate(() => document.querySelectorAll(".squelette").length);
    expect(avant, "prealable : aucun squelette n'a ete pose").toBeGreaterThan(5);

    await page.waitForTimeout(LENTEUR_MS * 2 + 2000);
    const apres = await page.evaluate(() => ({
      squelettes: document.querySelectorAll(".squelette").length,
      busy: document.querySelectorAll('[aria-busy="true"]').length
    }));

    expect(apres.squelettes, "des squelettes survivent au chargement").toBe(0);
    expect(apres.busy, 'aria-busy="true" survit : un lecteur d\'ecran annoncerait un chargement termine').toBe(0);
    await ctx.close();
  });
}

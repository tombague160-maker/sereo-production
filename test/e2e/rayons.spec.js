// E2E : les grands rayons, qui sont un trait DEFINISSANT de V8.
//
// La charte (§4) : « **Cartes** : rayon 24 px (mobile) a 36 px (desktop) ».
// Le guide de l'agent parle de « grands rayons » comme d'un des cinq mots du
// vocabulaire de la refonte, au meme titre que les pilules et le sourire de la
// marque.
//
// TROIS MESURES DU 18/09, ET LA TROISIEME EST UN DEFAUT VISIBLE.
//
//   1. `var(--radius-card)` n'apparait QU'UNE FOIS dans toute la feuille. La
//      chaine `--radius-card` -> `--radius` -> `.card` existe, mais quatre
//      redefinitions directes de `--radius` la coupent.
//
//   2. Les valeurs rendues etaient toutes en dessous de la charte :
//      desktop 22 px (.card) / 18 px (.panel, .op-kpi),
//      mobile  16 px (.card, .panel) / 14 px (.op-kpi).
//
//   3. LE JETON VALAIT 22 px EN CLAIR ET 8 px EN SOMBRE. Les deux declarations
//      qui gagnaient etaient prefixees `:root[data-color-scheme="light"]` ; en
//      sombre le jeton retombait sur le `8px` de `:root`. Huit cartes du tableau
//      de bord passaient d'arrondies a presque carrees selon le mode.
//
// C'est la QUATRIEME fois que cette forme revient -- apres les onglets,
// l'accordeon et les textes indicatifs. Une regle juste, scopee a un seul mode.
// Un rayon n'est pas une propriete thematique, et ce banc le dit desormais dans
// les deux sens : la valeur doit etre la bonne, ET la meme dans les deux modes.

const { test, expect } = require("./tuiles");

// La charte, telle quelle. La tolerance couvre l'arrondi sous-pixel du moteur,
// pas un ecart de conception : a 2 px pres, c'est une autre valeur.
const ATTENDU = { mobile: 24, desktop: 36 };
const TOLERANCE = 1;

const VUES = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 }
};

// Les surfaces que la charte appelle des CARTES. Les elements IMBRIQUES dans
// l'une d'elles gardent leur propre rayon, plus petit : une carte dans une carte
// n'est pas une carte de plus.
const CARTES = ".card, .panel, .op-kpi";

/** Les rayons rendus des cartes de l'onglet visible, et le jeton resolu. */
function releverRayons(page) {
  return page.evaluate(sel => {
    const cartes = [...document.querySelectorAll("section.page.active " + sel)]
      .filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 60 || r.height < 40) return false;
        // Imbriquee dans une autre carte : elle suit ses propres regles.
        return !el.parentElement?.closest(sel);
      })
      .map(el => ({
        nom: String(el.className).trim().split(/\s+/)[0] || el.tagName.toLowerCase(),
        rayon: Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius))
      }));
    return {
      jeton: getComputedStyle(document.documentElement).getPropertyValue("--radius-card").trim(),
      scheme: document.documentElement.dataset.colorScheme,
      cartes
    };
  }, CARTES);
}

async function ouvrir(browser, mode, vue) {
  const ctx = await browser.newContext({ colorScheme: mode, viewport: VUES[vue] });
  await ctx.addInitScript(m => {
    try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ }
  }, mode);
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  return { ctx, page };
}

for (const mode of ["light", "dark"]) {
  for (const vue of ["mobile", "desktop"]) {
    test(`rayons — les cartes tiennent ${ATTENDU[vue]} px en ${vue}, mode ${mode}`, async ({ browser }) => {
      test.setTimeout(120000);
      const { ctx, page } = await ouvrir(browser, mode, vue);
      const { jeton, cartes } = await releverRayons(page);

      // Prealable : sans carte mesuree, un zero defaut ne distingue rien.
      expect(cartes.length, "aucune carte mesuree : l'instrument n'a rien vu").toBeGreaterThan(3);

      const hors = cartes
        .filter(c => Math.abs(c.rayon - ATTENDU[vue]) > TOLERANCE)
        .map(c => `${c.nom} : ${c.rayon}px au lieu de ${ATTENDU[vue]}px`);

      console.log(`[${mode}/${vue}] --radius-card=${jeton}, ${cartes.length} carte(s), ${new Set(hors).size} hors charte`);
      expect([...new Set(hors)], `rayons hors charte (${mode}/${vue})`).toEqual([]);
      await ctx.close();
    });
  }
}

test("rayons — le jeton est le MEME en clair et en sombre", async ({ browser }) => {
  // Le cas qui nomme le defaut, et qu'aucune assertion de valeur ne remplace :
  // un rayon pourrait etre juste dans les deux modes par deux chemins
  // differents, et le prochain qui touche a l'un casserait l'autre. Ici on
  // exige que ce soit LA MEME declaration qui serve aux deux.
  test.setTimeout(120000);
  const valeurs = {};
  for (const mode of ["light", "dark"]) {
    const { ctx, page } = await ouvrir(browser, mode, "desktop");
    valeurs[mode] = (await releverRayons(page)).jeton;
    await ctx.close();
  }
  expect(valeurs.dark, `--radius-card vaut ${valeurs.light} en clair et ${valeurs.dark} en sombre : `
    + "un rayon n'est pas une propriete thematique").toBe(valeurs.light);
});

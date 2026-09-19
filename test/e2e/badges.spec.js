// E2E : les badges de statut, et la regle qui les rend lisibles.
//
// La charte (DESIGN.md §4) :
//   "Badge de statut : pilule 24 px, fond peche claire ou vert clair,
//    texte #2A5254."
//   "L'etat est porte par un point de couleur + un MOT."
//
// Mesure du 18/09 sur les 15 onglets : 12 badges, tous a 29 ou 33 px. `.pill`
// portait min-height 28, `.status-chip` 34.
//
// VERIFIE AVANT DE REDUIRE : les douze sont DECORATIFS -- aucun n'est un
// bouton, un lien, ni un descendant de l'un des deux, et aucun ne calcule
// cursor:pointer. Les rabaisser ne touchait donc aucune cible tactile. C'est
// l'ordre qui compte : mesurer d'abord si une reduction casse autre chose,
// appliquer ensuite. Le contraire aurait fait rater 24 cibles sous le seuil.
//
// La seconde regle est la plus importante des deux, et c'est celle qu'on oublie
// en refondant : un statut ne voyage JAMAIS par la couleur seule. La matrice
// des trois signaux (jetons-v8.test.js) montre pourquoi -- accent, alerte et
// avertissement ont une paire sous 1,6 dans CHAQUE mode. Un point rouge et un
// point orange cote a cote ne se distinguent pas ; "Bloquee" ecrit a cote, si.

const { test, expect } = require("./tuiles");

const HAUTEUR_MIN = 24;   // charte
const HAUTEUR_MAX = 28;   // tolerance : padding et hauteur de ligne

/** Parcourt tous les onglets et releve les badges de chacun. */
async function releverBadges(page) {
  // La barre laterale n'a plus de section depliable : ses huit entrees
  // sont toujours visibles, il n'y a plus rien a ouvrir avant de mesurer.
  // La liste des ecrans se prend a SA SOURCE, pas aux boutons de la barre.
  // Depuis que huit entrees ouvrent seize ecrans, compter les boutons ne
  // parcourait plus que la moitie de l'application -- sans rien dire.
  const onglets = await page.evaluate(() =>
    import("/js/config/tabs.js").then(m => [...m.mainTabs]));

  const tous = [];
  for (const onglet of onglets) {
    await page.evaluate(id => { location.hash = "#" + id; }, onglet);
    await page.waitForTimeout(450);
    tous.push(...await page.evaluate(sec =>
      [...document.querySelectorAll(
        "section.page.active .pill, section.page.active .status-chip, section.page.active .badge"
      )].map(e => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return {
          onglet: sec,
          classe: String(e.className).trim().split(/\s+/).slice(0, 2).join("."),
          hauteur: Math.round(r.height),
          texte: e.textContent.trim(),
          // Un badge cliquable n'est plus un badge : c'est un controle, et il
          // releve alors du plancher de 24 px WCAG, voire de nos 44 sur mobile.
          cliquable: e.tagName === "BUTTON" || e.tagName === "A"
            || cs.cursor === "pointer" || !!e.closest("button, a, [role='button']")
        };
      }).filter(b => b.hauteur > 4), onglet));
  }
  return tous;
}

test("badges — la pilule fait 24 px, comme la charte le dit", async ({ browser }) => {
  test.setTimeout(240000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });

  const badges = (await releverBadges(page)).filter(b => !b.cliquable);
  expect(badges.length, "aucun badge decoratif mesure : rien n'a ete juge").toBeGreaterThan(5);

  const hors = badges
    .filter(b => b.hauteur < HAUTEUR_MIN || b.hauteur > HAUTEUR_MAX)
    .map(b => `[${b.onglet}] ${b.classe} : ${b.hauteur}px « ${b.texte.slice(0, 20)} »`);
  expect([...new Set(hors)], `badges hors ${HAUTEUR_MIN}-${HAUTEUR_MAX}px`).toEqual([]);

  await ctx.close();
});

test("badges — un statut ne voyage JAMAIS par la couleur seule", async ({ browser }) => {
  test.setTimeout(240000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });

  const badges = await releverBadges(page);
  expect(badges.length, "aucun badge mesure : rien n'a ete juge").toBeGreaterThan(5);

  // Un badge vide ne porte que sa couleur. Il peut etre legitime s'il est
  // accompagne d'un libelle accessible, alors on l'accepte a ce titre -- mais
  // pas muet.
  const muets = [];
  for (const b of badges) {
    if (b.texte.length > 0) continue;
    muets.push(`[${b.onglet}] ${b.classe}`);
  }
  expect([...new Set(muets)],
    "badges sans mot : accent, alerte et avertissement ont une paire sous 1,6 dans chaque mode, la couleur seule ne distingue rien")
    .toEqual([]);

  await ctx.close();
});

// E2E : le §4 de la charte, composant par composant, mesure sur le rendu.
//
// CE QUE CE BANC AJOUTE AUX AUTRES. Les bancs existants mesurent la QUALITE
// (contraste, cibles, focus, coupures, rayons de carte). Celui-ci mesure la
// FORME : ce que la charte dessine. Une interface peut etre parfaitement
// conforme et ne pas ressembler a ce qui a ete decide -- c'etait l'etat du
// 18/09, et la mesure le disait :
//
//     boutons       rayon 9 px      charte : pilule (999)
//     champs        46 px / r14     charte : 48 / 18
//     barre lat.    276 px / r0     charte : 258 / angle 36
//     sheet         36 et 24        charte : 28
//     barre basse   blur(6px)       charte : blur(20px) saturate(180%)
//
// ⭐ ON MESURE LE RENDU, JAMAIS LA DECLARATION. Cette feuille porte des regles
//    qui s'annulent par la cascade -- quatre fois aujourd'hui une valeur juste
//    a ete battue par une autre. `getComputedStyle` sur l'element rend ce que
//    l'utilisateur voit.
//
// ⛔ LES TOLERANCES SONT ETROITES ET EXPLIQUEES. Un ecart de 1 px vient de
//    l'arrondi sous-pixel ; au-dela, c'est une autre valeur.

const { test, expect } = require("./tuiles");

const VUES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

/** Charte §4, valeurs exactes. */
const CHARTE = {
  boutonHauteur: { desktop: 44, mobile: 48 },
  champHauteur: 48,
  champRayon: 18,
  sidebarLargeur: 258,
  sidebarAngle: 36,
  sheetRayon: 28,
  tabbarFlou: 20,        // blur(20px)
  ligneListe: [64, 72]
};
const TOL = 1;

async function ouvrir(browser, vue) {
  const ctx = await browser.newContext({ viewport: VUES[vue] });
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }"
  });
  await page.evaluate(() =>
    document.querySelectorAll(".sidebar .nav-section").forEach(s => s.classList.add("open")));
  await page.waitForTimeout(700);
  return { ctx, page };
}

for (const vue of ["desktop", "mobile"]) {
  test(`charte §4 — les BOUTONS sont des pilules, en ${vue}`, async ({ browser }) => {
    test.setTimeout(180000);
    const { ctx, page } = await ouvrir(browser, vue);

    const r = await page.evaluate(() =>
      [...document.querySelectorAll(".button")]
        .filter(e => { const b = e.getBoundingClientRect(); return b.width > 20 && b.height > 12; })
        .map(e => {
          const b = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          return {
            nom: (e.id || e.textContent.trim().slice(0, 18) || e.className),
            h: Math.round(b.height),
            rayon: Math.round(parseFloat(cs.borderTopLeftRadius) || 0)
          };
        }));

    expect(r.length, "aucun bouton mesure").toBeGreaterThan(3);

    // « Pilule » = le rayon atteint la MOITIE DE LA HAUTEUR. C'est la definition
    // geometrique, et elle se mesure -- contrairement a « 999 px », qui n'est
    // qu'une facon d'ecrire « au maximum ».
    const pasPilules = r.filter(b => b.rayon < b.h / 2 - TOL)
      .map(b => `${b.nom} : rayon ${b.rayon} pour une hauteur de ${b.h}`);
    const tropCourts = r.filter(b => b.h < CHARTE.boutonHauteur[vue] - TOL)
      .map(b => `${b.nom} : ${b.h}px au lieu de ${CHARTE.boutonHauteur[vue]}`);

    console.log(`\n[forme/${vue}] ${r.length} bouton(s), ${new Set(pasPilules).size} non-pilule(s), `
      + `${new Set(tropCourts).size} trop court(s)`);
    expect([...new Set(pasPilules)], "des boutons ne sont pas des pilules").toEqual([]);
    expect([...new Set(tropCourts)], `boutons sous ${CHARTE.boutonHauteur[vue]}px en ${vue}`).toEqual([]);

    await ctx.close();
  });

  test(`charte §4 — les CHAMPS font 48 px et rayon 18, en ${vue}`, async ({ browser }) => {
    test.setTimeout(180000);
    const { ctx, page } = await ouvrir(browser, vue);

    const r = await page.evaluate(() => {
      // ⭐ POUR UN CHAMP DE RECHERCHE, LE CONTROLE VISUEL EST L'ENVELOPPE.
      //    `.topbar-search` et `.sidebar-search` portent la bordure, le fond et
      //    le rayon ; l'`input` a l'interieur ne fait que 21 px et n'a aucune
      //    decoration. Juger l'input reviendrait a mesurer une piece d'un
      //    composant, pas le composant -- et a reclamer 48 px a un element que
      //    personne ne voit.
      const enveloppe = e => e.closest(".topbar-search, .sidebar-search") || e;
      const vus = new Set();
      const out = [];
      for (const e of document.querySelectorAll(
        "input:not([type=hidden]):not([type=checkbox]):not([type=radio])"
        + ":not([type=range]):not([type=file]), select, textarea")) {
        const cible = enveloppe(e);
        if (vus.has(cible)) continue;
        vus.add(cible);
        const b = cible.getBoundingClientRect();
        if (b.width <= 40 || b.height <= 8) continue;
        const cs = getComputedStyle(cible);
        out.push({
          nom: (cible.id || cible.name || String(cible.className).trim().split(/\s+/)[0] || cible.tagName),
          h: Math.round(b.height),
          rayon: Math.round(parseFloat(cs.borderTopLeftRadius) || 0),
          multi: cible.tagName === "TEXTAREA"
        });
      }
      return out;
    });

    // Deux suffisent a rendre le zero non vide. Le seuil precedent (>2) etait
    // DEVINE : en mobile l enveloppe de recherche de la barre laterale est
    // masquee, il n en reste que deux. Un prealable trop haut transforme une
    // mesure juste en faux rouge.
    expect(r.length, "aucun champ mesure").toBeGreaterThanOrEqual(2);

    // Un `textarea` est multiligne : sa hauteur est un choix de contenu, pas de
    // composant. Il garde le rayon, pas la hauteur.
    const mauvaiseHauteur = r.filter(c => !c.multi && Math.abs(c.h - CHARTE.champHauteur) > TOL)
      .map(c => `${c.nom} : ${c.h}px au lieu de ${CHARTE.champHauteur}`);
    const mauvaisRayon = r.filter(c => Math.abs(c.rayon - CHARTE.champRayon) > TOL)
      .map(c => `${c.nom} : rayon ${c.rayon} au lieu de ${CHARTE.champRayon}`);

    console.log(`[forme/${vue}] ${r.length} champ(s), ${new Set(mauvaiseHauteur).size} hauteur(s), `
      + `${new Set(mauvaisRayon).size} rayon(s) hors charte`);
    expect([...new Set(mauvaiseHauteur)], "hauteur de champ hors charte").toEqual([]);
    expect([...new Set(mauvaisRayon)], "rayon de champ hors charte").toEqual([]);

    await ctx.close();
  });
}

test("charte §4 — la BARRE LATERALE fait 258 px et son angle droit est arrondi", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page } = await ouvrir(browser, "desktop");

  const r = await page.evaluate(() => {
    const sb = document.querySelector(".sidebar");
    if (!sb) return null;
    const cs = getComputedStyle(sb);
    return {
      largeur: Math.round(sb.getBoundingClientRect().width),
      hautDroit: Math.round(parseFloat(cs.borderTopRightRadius) || 0),
      basDroit: Math.round(parseFloat(cs.borderBottomRightRadius) || 0)
    };
  });

  expect(r, "aucune barre laterale").not.toBeNull();
  console.log(`[forme/desktop] barre laterale ${r.largeur}px, angles ${r.hautDroit}/${r.basDroit}`);
  expect(Math.abs(r.largeur - CHARTE.sidebarLargeur) <= 2,
    `barre laterale : ${r.largeur}px au lieu de ${CHARTE.sidebarLargeur}`).toBe(true);
  expect(Math.abs(r.hautDroit - CHARTE.sidebarAngle) <= TOL,
    `angle haut droit : ${r.hautDroit} au lieu de ${CHARTE.sidebarAngle}`).toBe(true);
  expect(Math.abs(r.basDroit - CHARTE.sidebarAngle) <= TOL,
    `angle bas droit : ${r.basDroit} au lieu de ${CHARTE.sidebarAngle}`).toBe(true);

  await ctx.close();
});

test("charte §4 — les SHEETS et MODALES ont des coins de 28 px", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page } = await ouvrir(browser, "desktop");

  const r = await page.evaluate(() =>
    [...document.querySelectorAll(".version-modal-card, .motif-dialog, .subscription-dialog, .sheet")]
      .map(e => ({
        nom: (e.id || String(e.className).trim().split(/\s+/)[0] || e.tagName),
        rayon: Math.round(parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0)
      })));

  expect(r.length, "aucune sheet ni modale mesuree").toBeGreaterThan(1);
  const hors = r.filter(m => Math.abs(m.rayon - CHARTE.sheetRayon) > TOL)
    .map(m => `${m.nom} : ${m.rayon}px au lieu de ${CHARTE.sheetRayon}`);
  console.log(`[forme/desktop] ${r.length} sheet(s)/modale(s), ${new Set(hors).size} hors charte`);
  expect([...new Set(hors)], "coins de sheet hors charte").toEqual([]);

  await ctx.close();
});

test("charte §4 — la BARRE BASSE est translucide comme la charte le dit", async ({ browser }) => {
  // « translucide (backdrop-filter: blur(20px) saturate(180%)) ». Le flou porte
  // l'effet : a 6 px on ne voit pas ce qui defile dessous, et la charte
  // demandait precisement qu'on le voie.
  test.setTimeout(180000);
  const { ctx, page } = await ouvrir(browser, "mobile");

  const r = await page.evaluate(() => {
    const b = document.querySelector(".mobile-tabbar");
    if (!b) return null;
    const cs = getComputedStyle(b);
    const f = cs.backdropFilter || cs.webkitBackdropFilter || "none";
    const flou = /blur\(([\d.]+)px\)/.exec(f);
    const sat = /saturate\(([\d.]+)%?\)/.exec(f);
    return {
      filtre: f,
      flou: flou ? parseFloat(flou[1]) : 0,
      saturation: sat ? parseFloat(sat[1]) : 0,
      hauteur: Math.round(b.getBoundingClientRect().height)
    };
  });

  expect(r, "aucune barre basse").not.toBeNull();
  console.log(`[forme/mobile] barre basse : ${r.filtre}`);
  expect(r.flou >= CHARTE.tabbarFlou,
    `flou de ${r.flou}px au lieu de ${CHARTE.tabbarFlou} : on ne voit pas ce qui defile dessous`)
    .toBe(true);
  // `saturate(180%)` s'ecrit `1.8` une fois calcule : on accepte les deux.
  expect(r.saturation >= 1.8 - 0.01 || r.saturation >= 180 - 1,
    `saturation ${r.saturation} au lieu de 180 %`).toBe(true);

  await ctx.close();
});

test("charte §4 — les PILULES DE FILTRE sont des pilules de 44 px", async ({ browser }) => {
  // « Pilules de filtre (secteurs, statuts) : hauteur 44 px, repliables plutot
  // que debordantes. » La hauteur tenait deja ; le RAYON valait 8 -- une regle
  // plus specifique que le bloc de forme leur imposait un coin carre, alors que
  // le mot de la charte est « pilules ».
  //
  // ⚪ « repliables » n'est PAS juge ici : c'est un comportement, et aucune
  //    mesure ne dit aujourd'hui si la rangee deborde. Nomme, pas fait a moitie.
  test.setTimeout(180000);
  const { ctx, page } = await ouvrir(browser, "desktop");
  await page.evaluate(() => { location.hash = "#bons-commande"; });
  await page.waitForTimeout(900);

  const r = await page.evaluate(() =>
    [...document.querySelectorAll(".bdc-status-filter, .active-filter")]
      .filter(e => { const b = e.getBoundingClientRect(); return b.width > 10 && b.height > 6; })
      .map(e => ({
        nom: e.textContent.trim().slice(0, 16) || e.className,
        h: Math.round(e.getBoundingClientRect().height),
        rayon: Math.round(parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0)
      })));

  expect(r.length, "aucune pilule de filtre mesuree").toBeGreaterThan(3);
  const carrees = r.filter(p => p.rayon < p.h / 2 - TOL)
    .map(p => `${p.nom} : rayon ${p.rayon} pour une hauteur de ${p.h}`);
  const mauvaises = r.filter(p => Math.abs(p.h - 44) > TOL)
    .map(p => `${p.nom} : ${p.h}px au lieu de 44`);

  console.log(`[forme/desktop] ${r.length} pilule(s) de filtre, ${new Set(carrees).size} non-pilule(s)`);
  expect([...new Set(carrees)], "des pilules de filtre ont des coins carres").toEqual([]);
  expect([...new Set(mauvaises)], "hauteur de pilule de filtre hors charte").toEqual([]);

  await ctx.close();
});

test("charte §4 — le TOAST vit 4 s, en bas de l'ecran", async ({ browser }) => {
  // « Toast : bas d'ecran, 4 s, une action possible (Annuler). »
  // Le code disait 3500 ms -- un ecart de 0,5 s que personne n'avait mesure,
  // parce que personne ne chronometre un toast.
  //
  // ⚠ L'ERREUR EST UN ECART DELIBERE : elle reste jusqu'au clic. Faire
  //    disparaitre une erreur toute seule ferait perdre l'information a qui
  //    regardait ailleurs. Le banc l'exige donc dans CE sens-la, et refuserait
  //    qu'on la rende ephemere.
  test.setTimeout(180000);
  const { ctx, page } = await ouvrir(browser, "mobile");

  const r = await page.evaluate(() => {
    const region = document.getElementById("toastRegion");
    if (!region) return null;
    const cs = getComputedStyle(region);
    return {
      position: cs.position,
      bas: Math.round(parseFloat(cs.bottom) || 0),
      haut: cs.top
    };
  });
  expect(r, "aucune region de toast").not.toBeNull();
  expect(r.position, "la region de toast doit etre fixe").toBe("fixed");
  expect(r.bas >= 0 && r.bas < 200, `region de toast a ${r.bas}px du bas : ce n'est pas le bas de l'ecran`).toBe(true);

  // La duree se lit dans la source : elle n'est observable autrement qu'en
  // attendant quatre secondes a chaque execution, ce qui rendrait le banc
  // lent pour ne rien apprendre de plus.
  const source = await page.evaluate(() => fetch("/js/app.js").then(x => x.text()));
  const sansCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  expect(sansCommentaires, "la duree du toast n'est pas celle de la charte")
    .toMatch(/TOAST_DUREE_MS\s*=\s*4000/);
  expect(sansCommentaires, "l'erreur doit rester jusqu'au clic : pas de minuterie dessus")
    .toMatch(/type\s*!==\s*"error"/);

  await ctx.close();
});

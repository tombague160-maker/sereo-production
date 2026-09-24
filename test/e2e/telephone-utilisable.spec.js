// LE TELEPHONE UTILISABLE DEHORS (24/09) -- DESIGN.md, section du meme nom.
//
// L'audit du 24/09 a mesure, au telephone, des ecrans ou l'on voyait les
// boutons et pas le contenu :
//   - Tournee (planche 4b) : a 375 x 667, la barre des gestes commencait a
//     y = 398, sous le nom du client (408-467) ; les articles a decharger
//     (525-645) etaient entierement dessous. En cause : un en-tete vert de
//     158 px, puis une seconde carte verte de 126 px pour l'anneau « 3 sur 6 »,
//     et une barre collee de 206 px (Client absent et Probleme compris) ;
//   - Commandes : 1 commande entiere a 390 x 844, AUCUNE a 360 x 740 (sept
//     pilules sur trois rangs, « Exporter », « Nouvelle commande » et la
//     rangee « A jour » dans l'en-tete) ; Clients : aucune a 360 x 740 ;
//   - Commande client : la barre du panier passait 12 px sous la barre basse ;
//   - menu « Plus » en clair : icones blanches sur blanc (1:1), Clients avec
//     la maison du Tableau de bord, et les messages sur ses entrees ;
//   - des textes a 11 et 12 px, un volet qui ne reagit que sur 19 px, des
//     puces etirees en bandeau, un badge a 4,45:1.
//
// Chaque cas a d'abord ete lance sur le code d'avant (DESIGN.md dit le rouge
// recu). Serveur seme sur 3524 (le seul de ce fichier).

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3524, seed: jeuDeDonnees() }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

const TAILLES = [[375, 667], [360, 740], [390, 844]];
const THEMES = ["light", "dark"];

async function ouvrir(browser, ecran, { largeur = 390, hauteur = 844, theme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur }, colorScheme: theme, timezoneId: "Europe/Paris", hasTouch: true });
  await ctx.addInitScript(t => { try { localStorage.setItem("sereo:colorScheme", t); } catch { /* ignore */ } }, theme);
  // Le premier fond opaque sous un element (en remontant ses ancetres), pour
  // les contrastes mesures dans la page.
  await ctx.addInitScript(() => {
    window.__fondOpaque = el => {
      for (let e = el; e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        const m = /rgba?\(([^)]+)\)/.exec(c);
        if (m) { const p = m[1].split(",").map(Number); if (p.length < 4 || p[3] > 0.9) return c; }
      }
      return "rgb(255, 255, 255)";
    };
  });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(`${srv.base}/#${ecran}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

function rgb(chaine) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(chaine || "");
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function luminance([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contraste(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// --- 1. Tournee (planche 4b) ------------------------------------------------

for (const [largeur, hauteur] of TAILLES) {
  for (const theme of THEMES) {
    test(`4b — ${largeur} x ${hauteur} (${theme}) : le client, l'adresse et les articles au-dessus des gestes`, async ({ browser }) => {
      test.setTimeout(90000);
      const { ctx, page, erreurs } = await ouvrir(browser, "livreur", { largeur, hauteur, theme });
      const r = await page.evaluate(() => {
        const b = s => { const e = document.querySelector(s); const x = e.getBoundingClientRect(); return { haut: x.top, bas: x.bottom, h: x.height }; };
        const gestes = document.querySelector("#livreur .current-driver-card .gestes");
        return {
          gestes: b("#livreur .current-driver-card .gestes"),
          collees: getComputedStyle(gestes).position,
          nom: b("#currentClient .arret-nom"), adresse: b("#currentClient .arret-adresse"),
          titreArticles: b("#currentClient .arret-articles-titre"),
          articles: [...document.querySelectorAll("#currentClient .arret-article")].map(e => e.getBoundingClientRect().bottom),
          livre: b("#markDeliveredButton"), aller: b("#mapsButton"),
          absentDansLaBarre: Boolean(gestes.querySelector("#markAbsentButton")),
          problemeDansLaBarre: Boolean(gestes.querySelector("#markProblemButton")),
          barre: document.querySelector("nav.mobile-tabbar").getBoundingClientRect().top
        };
      });
      expect(erreurs).toEqual([]);
      const f = n => Math.round(n);
      console.log(`[4b ${largeur}x${hauteur} ${theme}] gestes ${f(r.gestes.haut)}-${f(r.gestes.bas)}, nom bas ${f(r.nom.bas)}, adresse bas ${f(r.adresse.bas)}, articles ${r.articles.map(f).join("/")}`);
      expect(r.collees).toBe("sticky");
      expect(r.articles.length, "prealable : l'arret seme a deux articles").toBe(2);
      // A l'ouverture : tout ce qu'il faut lire tient AU-DESSUS de la barre collee.
      expect(r.nom.bas, "le nom du client passe sous les gestes").toBeLessThanOrEqual(r.gestes.haut + 0.5);
      expect(r.adresse.bas, "l'adresse passe sous les gestes").toBeLessThanOrEqual(r.gestes.haut + 0.5);
      expect(r.titreArticles.bas, "« n articles a decharger » passe sous les gestes").toBeLessThanOrEqual(r.gestes.haut + 0.5);
      for (const [i, bas] of r.articles.entries()) {
        expect(bas, `l'article ${i + 1} passe sous les gestes`).toBeLessThanOrEqual(r.gestes.haut + 0.5);
      }
      // La barre collee : « Y aller » et « Livre » a 56, au-dessus de la barre basse.
      expect(Math.round(r.livre.h)).toBe(56);
      expect(Math.round(r.aller.h)).toBe(56);
      expect(r.livre.bas).toBeLessThanOrEqual(r.barre + 0.5);
      // Client absent et Probleme ne sont plus dans la barre collee...
      expect(r.absentDansLaBarre, "Client absent est encore dans la barre collee").toBe(false);
      expect(r.problemeDansLaBarre, "Probleme est encore dans la barre collee").toBe(false);
      // ... et restent a un geste : un defilement, et ils sont libres (ni la
      // barre collee ni la barre basse ne les couvrent).
      for (const id of ["markAbsentButton", "markProblemButton"]) {
        await page.evaluate(i => document.getElementById(i).scrollIntoView({ block: "center" }), id);
        const libre = await page.evaluate(i => {
          const e = document.getElementById(i); const x = e.getBoundingClientRect();
          const dessus = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2);
          return { libre: e.contains(dessus), h: Math.round(x.height) };
        }, id);
        expect(libre.libre, `${id} est couvert apres defilement`).toBe(true);
        expect(libre.h).toBeGreaterThanOrEqual(48);
      }
      await ctx.close();
    });
  }
}

for (const theme of THEMES) {
  test(`4b — un seul bloc vert : l'anneau « 3 sur 6 » et la barre sont dans l'en-tete (${theme})`, async ({ browser }) => {
    test.setTimeout(90000);
    const { ctx, page, erreurs } = await ouvrir(browser, "livreur", { theme });
    const r = await page.evaluate(() => {
      const entete = document.querySelector("header.ecran-entete");
      const anneau = document.getElementById("routeProgress");
      const barre = document.querySelector(".tournee-progression");
      const titre = document.getElementById("pageTitle");
      const carte = document.querySelector("#livreur .current-driver-card");
      const b = e => e.getBoundingClientRect();
      const rang = anneau.querySelector("strong"), sur = anneau.querySelector("small");
      // La boite du TEXTE du titre (le <h2> occupe toute sa colonne).
      const plage = document.createRange(); plage.selectNodeContents(titre);
      const tb = plage.getBoundingClientRect();
      return {
        anneauDansEntete: entete.contains(anneau), barreDansEntete: entete.contains(barre),
        carteVerteVisible: document.querySelector("#livreur .tournee-entete").checkVisibility(),
        anneau: { texte: anneau.textContent.trim(), gauche: b(anneau).left, haut: b(anneau).top },
        titre: { droite: tb.right, bas: tb.bottom },
        carteHaut: b(carte).top, enteteBas: b(entete).bottom,
        surTaille: parseFloat(getComputedStyle(sur).fontSize), surCouleur: getComputedStyle(sur).color,
        rangCouleur: getComputedStyle(rang).color, fondEntete: window.__fondOpaque(entete),
        synchroDansEntete: entete.contains(document.getElementById("syncStatus")) && document.getElementById("syncStatus").checkVisibility(),
        actualiser: Math.round(b(document.getElementById("refreshButton")).height)
      };
    });
    expect(erreurs).toEqual([]);
    console.log(`[4b bloc ${theme}] ${JSON.stringify(r)}`);
    expect(r.anneauDansEntete, "l'anneau n'est pas dans l'en-tete vert").toBe(true);
    expect(r.barreDansEntete, "la barre de progression n'est pas dans l'en-tete vert").toBe(true);
    expect(r.carteVerteVisible, "une seconde carte verte reste entre l'en-tete et l'arret").toBe(false);
    expect(r.anneau.texte).toBe("3sur 6");
    // L'anneau a droite du titre, sur sa ligne (planche 4b).
    expect(r.anneau.gauche).toBeGreaterThan(r.titre.droite - 1);
    expect(r.anneau.haut).toBeLessThan(r.titre.bas);
    // La carte de l'arret suit l'en-tete, sans rien entre les deux.
    expect(r.carteHaut - r.enteteBas, "un vide separe l'en-tete de la carte de l'arret").toBeLessThanOrEqual(0);
    // « sur 6 » a 13 px, lisible sur le vert.
    expect(r.surTaille).toBeGreaterThanOrEqual(13);
    expect(contraste(rgb(r.surCouleur), rgb(r.fondEntete))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(rgb(r.rangCouleur), rgb(r.fondEntete))).toBeGreaterThanOrEqual(4.5);
    // La synchro et Actualiser restent dans l'en-tete, a 44 px au moins.
    expect(r.synchroDansEntete).toBe(true);
    expect(r.actualiser).toBeGreaterThanOrEqual(44);
    await ctx.close();
  });
}

test("4b — au bureau, l'anneau reste dans l'en-tete de la tournee, et y revient en franchissant 820 px", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser, "livreur", { largeur: 390, hauteur: 844 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  const bureau = await page.evaluate(() => ({
    dansTournee: document.querySelector("#livreur .tournee-entete").contains(document.getElementById("routeProgress")),
    visible: document.getElementById("routeProgress").checkVisibility(),
    absentHauteur: Math.round(document.getElementById("markAbsentButton").getBoundingClientRect().height)
  }));
  expect(erreurs).toEqual([]);
  expect(bureau).toEqual({ dansTournee: true, visible: true, absentHauteur: 44 });
  await ctx.close();
});

// --- 2 et 3. Commandes et Clients : des lignes a l'ouverture ---------------

const LIGNES = { commandes: "#commandes .cmd-ligne", crm: "#crm .cli-ligne" };
const ATTENDU = { "390x844": 3, "360x740": 2 };

for (const ecran of ["commandes", "crm"]) {
  for (const [largeur, hauteur] of [[390, 844], [360, 740]]) {
    for (const theme of THEMES) {
      test(`listes — ${ecran} a ${largeur} x ${hauteur} (${theme}) : au moins ${ATTENDU[`${largeur}x${hauteur}`]} lignes entieres a l'ouverture`, async ({ browser }) => {
        test.setTimeout(90000);
        const { ctx, page, erreurs } = await ouvrir(browser, ecran, { largeur, hauteur, theme });
        const r = await page.evaluate(sel => {
          const bas = Math.min(document.querySelector("nav.mobile-tabbar").getBoundingClientRect().top,
            ...[...document.querySelectorAll("#gestesBas > *")].filter(x => x.checkVisibility()).map(x => x.getBoundingClientRect().top));
          const lignes = [...document.querySelectorAll(sel)].filter(x => x.checkVisibility()).map(x => x.getBoundingClientRect());
          return { entieres: lignes.filter(l => l.top >= 0 && l.bottom <= bas + 0.5).length, total: lignes.length,
            premiere: lignes[0] && Math.round(lignes[0].top), bas: Math.round(bas),
            deborde: document.documentElement.scrollWidth - innerWidth };
        }, LIGNES[ecran]);
        expect(erreurs).toEqual([]);
        console.log(`[listes ${ecran} ${largeur}x${hauteur} ${theme}] ${JSON.stringify(r)}`);
        expect(r.total, "prealable : au moins quatre lignes semees").toBeGreaterThanOrEqual(4);
        expect(r.entieres).toBeGreaterThanOrEqual(ATTENDU[`${largeur}x${hauteur}`]);
        expect(r.deborde, "defilement horizontal").toBeLessThanOrEqual(0);
        await ctx.close();
      });
    }
  }
}

/** Les rangs d'une rangee de pilules : les hauts distincts des pilules visibles. */
function rangs(page, selecteurPilules) {
  return page.evaluate(sel => {
    const hauts = [...document.querySelectorAll(sel)].filter(p => p.checkVisibility()).map(p => Math.round(p.getBoundingClientRect().top));
    return [...new Set(hauts)].length;
  }, selecteurPilules);
}

test("pilules — Commandes : repliees au-dela de deux rangs, « + N » les rend, la choisie ne se cache jamais", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser, "commandes", { largeur: 360, hauteur: 740 });
  const pilules = "#cmdPilules > .filtre-pilule, #cmdPilules > .pilules-plus";
  const plus = page.locator("#cmdPilules > .pilules-plus");
  expect(await rangs(page, pilules), "les pilules prennent plus de deux rangs").toBeLessThanOrEqual(2);
  await expect(plus).toBeVisible();
  await expect(plus).toHaveText(/^\+ \d+$/);
  await expect(plus).toHaveAttribute("aria-expanded", "false");
  const caches = Number((await plus.textContent()).replace(/\D/g, ""));
  const total = await page.locator("#cmdPilules > .filtre-pilule").count();
  expect(await page.locator("#cmdPilules > .filtre-pilule:visible").count()).toBe(total - caches);
  expect(Math.round((await plus.boundingBox()).height)).toBeGreaterThanOrEqual(44);
  // « + N » : tout se deplie.
  await plus.click();
  await expect(page.locator("#cmdPilules > .filtre-pilule:visible")).toHaveCount(total);
  await expect(plus).toHaveText("Moins");
  await expect(plus).toHaveAttribute("aria-expanded", "true");
  // La DERNIERE pilule choisie, puis replier : elle reste visible.
  const derniere = page.locator("#cmdPilules > .filtre-pilule").last();
  const cle = await derniere.getAttribute("data-cmd-filtre");
  await derniere.click();
  await page.locator("#cmdPilules > .pilules-plus").click();
  await expect(page.locator(`#cmdPilules > [data-cmd-filtre="${cle}"]`)).toBeVisible();
  await expect(page.locator(`#cmdPilules > [data-cmd-filtre="${cle}"]`)).toHaveAttribute("aria-pressed", "true");
  expect(await rangs(page, pilules)).toBeLessThanOrEqual(2);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("pilules — Clients : secteurs, Abonnes et statut repliés a deux rangs ; un statut choisi reste visible", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser, "crm", { largeur: 360, hauteur: 740 });
  const pilules = "#crm .cli-filtres .cli-pilule, #crm .cli-filtres > .cli-statut-filtre, #crm .cli-filtres > .pilules-plus";
  expect(await rangs(page, pilules), "les filtres des clients prennent plus de deux rangs").toBeLessThanOrEqual(2);
  const plus = page.locator("#crm .cli-filtres > .pilules-plus");
  await expect(plus).toBeVisible();
  await plus.click();
  await expect(page.locator("#crm .cli-filtres > .cli-statut-filtre")).toBeVisible();
  await page.locator("#crmStatusFilter").selectOption("prospect");
  await page.locator("#crm .cli-filtres > .pilules-plus").click();
  await expect(page.locator("#crm .cli-filtres > .cli-statut-filtre"), "le statut choisi disparait dans le repli").toBeVisible();
  expect(await rangs(page, pilules)).toBeLessThanOrEqual(2);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("Commandes — « Exporter » dans « Filtres », « Nouvelle commande » fixe en bas et apres la liste au clavier", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser, "commandes", { largeur: 390, hauteur: 844 });
  const exporter = page.locator('[data-action="cmd-export"]');
  expect(await exporter.evaluate(e => Boolean(e.closest(".ecran-entete"))), "« Exporter » est encore dans l'en-tete").toBe(false);
  await expect(exporter).toBeHidden();
  await page.locator("#cmdFiltresBouton").click();
  await expect(exporter).toBeVisible();
  expect(await exporter.evaluate(e => Boolean(e.closest("#commandes .cmd-filtres")))).toBe(true);
  const [telechargement] = await Promise.all([page.waitForEvent("download"), exporter.click()]);
  expect(telechargement.suggestedFilename()).toMatch(/^sereo-commandes/);

  const nouvelle = page.locator(".cmd-nouvelle");
  await expect(nouvelle).toBeVisible();
  const r = await page.evaluate(() => {
    const b = document.querySelector(".cmd-nouvelle"), x = b.getBoundingClientRect();
    const liste = document.getElementById("cmdLignes");
    return { position: getComputedStyle(b).position, bas: x.bottom, h: Math.round(x.height),
      barre: document.querySelector("nav.mobile-tabbar").getBoundingClientRect().top,
      dansEntete: Boolean(b.closest(".ecran-entete")),
      apresLaListe: Boolean(liste.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  expect(r.position).toBe("fixed");
  expect(r.dansEntete).toBe(false);
  expect(r.barre - r.bas, "« Nouvelle commande » touche ou passe sous la barre basse").toBeGreaterThanOrEqual(8);
  expect(r.h).toBeGreaterThanOrEqual(44);
  expect(r.apresLaListe, "« Nouvelle commande » est atteinte au clavier avant la liste").toBe(true);
  await nouvelle.click();
  await expect(page.locator("#commande-client")).toHaveClass(/active/);
  await expect(nouvelle, "le bouton fixe suit l'utilisateur hors de Commandes").toBeHidden();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// La rangee « A jour + Actualiser » seule sur sa ligne monte sur celle du titre.
for (const ecran of ["commandes", "crm", "statistiques", "relances", "parametres", "commande-client", "recommande"]) {
  test(`en-tete — ${ecran} : « A jour + Actualiser » sur la ligne du titre (360 px)`, async ({ browser }) => {
    test.setTimeout(90000);
    const { ctx, page, erreurs } = await ouvrir(browser, ecran, { largeur: 360, hauteur: 740 });
    const r = await page.evaluate(() => {
      const b = id => document.getElementById(id).getBoundingClientRect();
      return { titre: b("pageTitle"), synchro: b("syncStatus"), actualiser: b("refreshButton"), deborde: document.documentElement.scrollWidth - innerWidth };
    });
    expect(erreurs).toEqual([]);
    // Sur la ligne du titre : ils commencent avant que le titre ne finisse.
    expect(r.actualiser.top, "Actualiser a sa propre rangee sous le titre").toBeLessThan(r.titre.bottom);
    expect(r.synchro.top, "la synchro a sa propre rangee sous le titre").toBeLessThan(r.titre.bottom);
    expect(r.actualiser.height).toBeGreaterThanOrEqual(44);
    expect(r.deborde).toBeLessThanOrEqual(0);
    await ctx.close();
  });
}

// --- 4. Commande client : le panier au-dessus de la barre basse -------------

for (const [largeur, hauteur] of [[390, 844], [360, 740]]) {
  test(`panier — ${largeur} x ${hauteur} : « Total · Valider » entier, au-dessus de la barre basse`, async ({ browser }) => {
    test.setTimeout(90000);
    const { ctx, page, erreurs } = await ouvrir(browser, "commande-client", { largeur, hauteur });
    await page.locator('#customerCatalog [data-customer-product="st-CH-L"][data-customer-delta="1"]').click();
    await expect(page.locator("#customerCartBar")).toBeVisible();
    const r = await page.evaluate(() => {
      const b = s => document.querySelector(s).getBoundingClientRect();
      const libelle = document.querySelector("#customerCartBar .ccb-label");
      return { barre: b("#customerCartBar"), total: b("#customerCartTotalBar"), onglets: b("nav.mobile-tabbar"),
        libelle: parseFloat(getComputedStyle(libelle).fontSize) };
    });
    expect(erreurs).toEqual([]);
    console.log(`[panier ${largeur}] barre ${Math.round(r.barre.top)}-${Math.round(r.barre.bottom)}, onglets ${Math.round(r.onglets.top)}`);
    expect(r.barre.bottom, "la barre du panier passe sous la barre d'onglets").toBeLessThanOrEqual(r.onglets.top);
    expect(r.total.bottom, "le montant est rogne").toBeLessThanOrEqual(r.onglets.top);
    expect(r.libelle, "« TOTAL PANIER » sous 13 px").toBeGreaterThanOrEqual(13);
    await ctx.close();
  });
}

// --- 5. Menu « Plus » -------------------------------------------------------

for (const theme of THEMES) {
  test(`Plus — icones visibles (3:1), des personnes pour Clients, et les messages hors des entrees (${theme})`, async ({ browser }) => {
    test.setTimeout(90000);
    const { ctx, page, erreurs } = await ouvrir(browser, "stock", { largeur: 390, hauteur: 844, theme });
    // Un message reel : une quantite videe ne change rien, et le dit.
    const champ = page.locator("[data-stock-input]").first();
    await champ.fill("");
    await champ.dispatchEvent("change");
    await expect(page.locator("#toastRegion .toast").first()).toBeVisible();
    await page.locator("#mobile-tab-more").click();
    await expect(page.locator("#mobile-more-sheet")).toBeVisible();
    const r = await page.evaluate(() => {
      const rgbDe = c => /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c).slice(1).map(v => (v === undefined ? 1 : Number(v)));
      const lum = ([x, y, z]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(x) + 0.7152 * f(y) + 0.0722 * f(z); };
      const icones = [...document.querySelectorAll("#mobile-more-sheet .more-sheet-item")].map(item => {
        const icone = item.querySelector(".more-sheet-icon");
        // Le fond sous le trait : celui de la puce de l'icone s'il est opaque,
        // sinon le panneau ; le trait est compose dessus (il est translucide
        // dans l'ancienne regle claire).
        const [R, G, B] = rgbDe(window.__fondOpaque(icone));
        const [r, g, bl, a] = rgbDe(getComputedStyle(icone.querySelector("svg")).color);
        const trait = [r * a + R * (1 - a), g * a + G * (1 - a), bl * a + B * (1 - a)];
        const [l1, l2] = [lum(trait), lum([R, G, B])].sort((u, v) => v - u);
        return { nom: item.textContent.trim(), ratio: (l1 + 0.05) / (l2 + 0.05) };
      });
      const clients = document.querySelector('#mobile-more-sheet [data-tab="crm"] .more-sheet-icon');
      const message = document.querySelector("#toastRegion .toast");
      const t = message.getBoundingClientRect();
      const recouvre = [...document.querySelectorAll("#mobile-more-sheet .more-sheet-item")].filter(item => {
        const x = item.getBoundingClientRect();
        return t.left < x.right && x.left < t.right && t.top < x.bottom && x.top < t.bottom;
      }).map(item => item.textContent.trim());
      return { icones, clientsMaison: Boolean(clients.querySelector('use[href="#icon-home"]')),
        toast: { visible: message.checkVisibility(), haut: Math.round(t.top), bas: Math.round(t.bottom) }, recouvre };
    });
    expect(erreurs).toEqual([]);
    console.log(`[plus ${theme}] ${JSON.stringify(r.icones.map(i => i.ratio.toFixed(2)))} toast ${JSON.stringify(r.toast)}`);
    for (const i of r.icones) expect(i.ratio, `icone de « ${i.nom} »`).toBeGreaterThanOrEqual(3);
    expect(r.clientsMaison, "Clients porte encore l'icone de la maison").toBe(false);
    expect(r.toast.visible, "prealable : le message est a l'ecran").toBe(true);
    expect(r.recouvre, `le message couvre : ${r.recouvre.join(", ")}`).toEqual([]);
    await ctx.close();
  });
}

// --- 6. Lisible dehors, facile a toucher ------------------------------------

test("tableau de bord — « 1 echeance » a 13 px, « Detail du jour » reagit sur toute la carte, la puce reste une puce", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", { largeur: 390, hauteur: 844 });
  await expect(page.locator("#opWeekCount")).toHaveText(/échéance/, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const resume = document.querySelector(".tb-detail > summary"), volet = resume.parentElement;
    const puce = document.getElementById("dashboardTourneeStatut");
    return {
      semaine: parseFloat(getComputedStyle(document.getElementById("opWeekCount")).fontSize),
      resume: resume.getBoundingClientRect().height, volet: volet.getBoundingClientRect().height,
      resumeLarg: resume.getBoundingClientRect().width, voletLarg: volet.getBoundingClientRect().width,
      puce: { texte: puce.textContent.trim(), largeur: puce.getBoundingClientRect().width, parent: puce.parentElement.getBoundingClientRect().width }
    };
  });
  expect(erreurs).toEqual([]);
  console.log(`[tableau] ${JSON.stringify(r)}`);
  expect(r.semaine).toBeGreaterThanOrEqual(13);
  expect(r.resume, "le resume de « Detail du jour » fait moins de 44 px").toBeGreaterThanOrEqual(44);
  // Toute la carte repliee : le resume en couvre la hauteur et la largeur (bordure comprise).
  expect(r.volet - r.resume).toBeLessThanOrEqual(2);
  expect(r.voletLarg - r.resumeLarg).toBeLessThanOrEqual(2);
  // « En livraison » : a sa largeur, pas en bandeau sur toute la carte.
  expect(r.puce.largeur, `la puce « ${r.puce.texte} » s'etire sur ${Math.round(r.puce.largeur)} px`).toBeLessThan(r.puce.parent / 2);
  await ctx.close();
});

test("tournee — « Arret en cours », « n articles a decharger » a 13 px ; « En livraison » a 4,5:1 en clair", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser, "livreur", { largeur: 390, hauteur: 844 });
  const r = await page.evaluate(() => {
    const taille = s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
    const pastilles = [...document.querySelectorAll("#routeStopsList .pill.pill-warning")].filter(p => p.checkVisibility())
      .map(p => ({ texte: p.textContent.trim(), couleur: getComputedStyle(p).color, fond: window.__fondOpaque(p) }));
    return { etat: taille("#currentClient .arret-etat"), articles: taille("#currentClient .arret-articles-titre"), pastilles };
  });
  expect(erreurs).toEqual([]);
  expect(r.etat).toBeGreaterThanOrEqual(13);
  expect(r.articles).toBeGreaterThanOrEqual(13);
  expect(r.pastilles.length, "prealable : une pastille « En livraison » dans la liste").toBeGreaterThan(0);
  for (const p of r.pastilles) {
    expect(contraste(rgb(p.couleur), rgb(p.fond)), `pastille « ${p.texte} »`).toBeGreaterThanOrEqual(4.5);
  }
  await ctx.close();
});

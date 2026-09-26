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

// Un TELEPHONE emule (isMobile : la balise viewport, le toucher), comme les
// sondes de l'audit. Sans lui, la page ne se reajustait pas pendant le
// chargement, et le repli mesure en coordonnees d'ecran passait (mutant M2).
async function ouvrir(browser, ecran, { largeur = 390, hauteur = 844, theme = "light", base = srv.base } = {}) {
  // Au bureau (1440), un ecran de bureau : ni balise viewport emulee, ni toucher.
  const telephone = largeur <= 820;
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur }, colorScheme: theme, timezoneId: "Europe/Paris", hasTouch: telephone, isMobile: telephone });
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
  await page.goto(`${base}/#${ecran}`, { waitUntil: "networkidle" });
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
      // Relecture du 24/09 : a 375 x 667, 2 px d'air seulement ; 8 au moins.
      expect(r.gestes.haut - Math.max(...r.articles), "moins de 8 px d'air entre le dernier article et les gestes").toBeGreaterThanOrEqual(8);
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
      // La barre de la TOURNEE, par son identifiant (relecture du 24/09) : le
      // premier `.tournee-progression` du document est celui de la carte
      // « Tournee du jour » du Tableau de bord -- le deplacer passait ce
      // controle, avec la mauvaise barre.
      const barre = document.getElementById("tourneeProgressionBarre").parentElement;
      const titre = document.getElementById("pageTitle");
      const carte = document.querySelector("#livreur .current-driver-card");
      const b = e => e.getBoundingClientRect();
      const rang = anneau.querySelector("strong"), sur = anneau.querySelector("small");
      // La boite du TEXTE du titre (le <h2> occupe toute sa colonne).
      const plage = document.createRange(); plage.selectNodeContents(titre);
      const tb = plage.getBoundingClientRect();
      return {
        anneauDansEntete: entete.contains(anneau), barreDansEntete: entete.contains(barre),
        barreVisible: barre.checkVisibility() && b(barre).width > 0,
        tableauGardeSaBarre: document.getElementById("journee").contains(document.getElementById("dashboardTourneeBarre")),
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
    expect(r.barreVisible, "la barre de la tournee n'est pas visible dans l'en-tete").toBe(true);
    expect(r.tableauGardeSaBarre, "la barre du Tableau de bord a quitte sa carte").toBe(true);
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
    absentHauteur: Math.round(document.getElementById("markAbsentButton").getBoundingClientRect().height),
    // UNE barre dans l'en-tete de la tournee, la sienne ; celle du Tableau de
    // bord reste dans sa carte (relecture du 24/09 : un iPad tourne franchit
    // 820 px, et la tournee en affichait deux).
    barresDeLaTournee: [...document.querySelectorAll("#livreur .tournee-entete .tournee-progression-barre")].map(e => e.id),
    barreDuTableau: document.getElementById("journee").contains(document.getElementById("dashboardTourneeBarre"))
  }));
  expect(erreurs).toEqual([]);
  expect(bureau).toEqual({ dansTournee: true, visible: true, absentHauteur: 44, barresDeLaTournee: ["tourneeProgressionBarre"], barreDuTableau: true });
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

// 390 en sombre : la ou le premier jet, qui mesurait en coordonnees d'ecran
// pendant que la page se reajustait, ne laissait que « Toutes » et « + 6 ».
// Integration du 24/09 : a 390 px les six pilules tiennent desormais en deux
// rangs (« À envoyer » cachee sans commande, lot pieges ; mots plus courts, lot
// parcours) : rien a replier. Le cas sombre se juge a 360 px.
for (const [largeur, hauteur, theme] of [[360, 740, "light"], [360, 740, "dark"]]) test(`pilules — Commandes (${largeur}, ${theme}) : repliees au-dela de deux rangs, « + N » les rend, la choisie ne se cache jamais`, async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser, "commandes", { largeur, hauteur, theme });
  const pilules = "#cmdPilules > .filtre-pilule, #cmdPilules > .pilules-plus";
  const plus = page.locator("#cmdPilules > .pilules-plus");
  expect(await plus.count(), "prealable : a cette largeur, les pilules depassent deux rangs (sinon rien a replier)").toBe(1);
  const replie = await rangs(page, pilules);
  expect(replie, "les pilules prennent plus de deux rangs").toBeLessThanOrEqual(2);
  expect(replie, "le repli cache plus qu'il ne faut : un seul rang reste").toBe(2);
  // Remesure en bas de la liste (une rotation, la police qui arrive) : cacher
  // une pilule raccourcit la page, le defilement se recale, et une mesure en
  // coordonnees d'ecran voyait « glisser » le deuxieme rang (mutant M2 : il
  // ne restait que « Toutes » et « + 6 »).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(300);
  expect(await rangs(page, pilules), "remesure en bas de page : le repli cache plus qu'il ne faut").toBe(2);
  await page.evaluate(() => window.scrollTo(0, 0));
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
  const replie = await rangs(page, pilules);
  expect(replie, "les filtres des clients prennent plus de deux rangs").toBeLessThanOrEqual(2);
  expect(replie, "le repli cache plus qu'il ne faut : un seul rang reste").toBe(2);
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
  // Ouvert sur un AUTRE ecran, puis Commandes par le menu « Plus » : le chemin
  // du doigt. Deplace hors de la fente, « Exporter » n'est plus range par
  // showTab ; parti cache, il le restait (mutant M14).
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", { largeur: 390, hauteur: 844 });
  await page.locator("#mobile-tab-more").click();
  await page.locator('#mobile-more-sheet [data-tab="commandes"]').click();
  await expect(page.locator("#commandes")).toHaveClass(/active/);
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
  // Ouvert : les textes des cartes du detail, a 13 px au moins.
  await page.locator(".tb-detail > summary").click();
  const petits = await page.evaluate(() => [...document.querySelectorAll(".tb-detail .op-kpi > span, .tb-detail .op-kpi small, .tb-detail .op-kpi a")]
    .filter(e => e.checkVisibility()).map(e => [e.textContent.trim(), parseFloat(getComputedStyle(e).fontSize)]).filter(([, t]) => t < 13));
  expect(petits, "des textes du detail du jour sous 13 px").toEqual([]);
  await ctx.close();
});

// Relecture du 24/09 : `display: flex` sur le resume retirait le triangle
// d'ouverture (le marqueur n'existe que sur un `list-item`) -- au bureau
// comme au telephone, plus rien ne disait que la carte se deplie. Mesure :
// le texte du resume est decale par le marqueur (17 px sous Chromium) ;
// sans marqueur, il commence au bord du rembourrage (0).
for (const [largeur, hauteur, theme] of [[1440, 900, "light"], [1440, 900, "dark"], [390, 844, "light"], [390, 844, "dark"]]) {
  test(`tableau de bord — « Detail du jour » garde son triangle d'ouverture (${largeur}, ${theme})`, async ({ browser }) => {
    test.setTimeout(90000);
    const { ctx, page, erreurs } = await ouvrir(browser, "journee", { largeur, hauteur, theme });
    const mesure = () => page.evaluate(() => {
      const resume = document.querySelector(".tb-detail > summary"), s = getComputedStyle(resume);
      const plage = document.createRange(); plage.selectNodeContents(resume);
      const debutTexte = [...plage.getClientRects()].reduce((m, x) => Math.min(m, x.left), Infinity);
      const bordInterieur = resume.getBoundingClientRect().left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft);
      return { decalage: Math.round(debutTexte - bordInterieur), marqueur: s.listStyleType, hauteur: Math.round(resume.getBoundingClientRect().height) };
    });
    const ferme = await mesure();
    expect(erreurs).toEqual([]);
    console.log(`[detail ${largeur} ${theme}] ${JSON.stringify(ferme)}`);
    expect(ferme.decalage, "« Detail du jour » n'a plus de triangle d'ouverture").toBeGreaterThanOrEqual(8);
    expect(ferme.hauteur, "le resume fait moins de 44 px").toBeGreaterThanOrEqual(44);
    // Ouvert : le triangle reste (il tourne, il ne disparait pas).
    await page.locator(".tb-detail > summary").click();
    await expect(page.locator(".tb-detail")).toHaveAttribute("open", "");
    expect((await mesure()).decalage, "le triangle disparait une fois le volet ouvert").toBeGreaterThanOrEqual(8);
    await ctx.close();
  });
}

test("tableau de bord — au telephone, la carte « Tournee du jour » garde sa barre de progression", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", { largeur: 390, hauteur: 844 });
  const r = await page.evaluate(() => {
    const barre = document.getElementById("dashboardTourneeBarre");
    return { dansLaCarte: document.getElementById("journee").contains(barre), visible: barre.parentElement.checkVisibility(),
      largeur: Math.round(barre.parentElement.getBoundingClientRect().width) };
  });
  expect(erreurs).toEqual([]);
  expect(r.dansLaCarte, "la barre du Tableau de bord a ete deplacee dans l'en-tete").toBe(true);
  expect(r.visible, "la carte « Tournee du jour » n'a plus de barre").toBe(true);
  expect(r.largeur).toBeGreaterThan(0);
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

// --- 7. Relecture adverse du 24/09 : un arret de TROIS articles -------------
//
// Le jeu seme commun a deux articles par arret : le banc 4b ne pouvait pas
// voir qu'a 375 x 667 un troisieme passait sous la barre collee (2 px de
// marge). Serveur seme a part (3525), l'arret en cours a trois articles.
// Les cas qui touchent « Livre » cliquent Annuler avant de juger : rien ne
// part au serveur, l'etat seme reste le meme d'un cas a l'autre.

function jeuTroisArticles() {
  const seed = jeuDeDonnees();
  const commande = seed.commandes.find(c => c.id === "o-3");
  commande.products = [...commande.products, { code: "GANTS", nom: "Gants nitrile", prixUnitaire: 8, quantite: 5 }];
  seed.routes[0].stops.find(s => s.orderId === "o-3").products = commande.products;
  return seed;
}

test.describe("arret de trois articles", () => {
  let srv3;
  test.beforeAll(async () => { srv3 = await demarrer({ port: 3525, seed: jeuTroisArticles() }); });
  test.afterAll(async () => { if (srv3) await srv3.arreter(); });

  for (const [largeur, hauteur, theme] of [[375, 667, "light"], [375, 667, "dark"], [360, 740, "light"], [390, 844, "light"]]) {
    test(`4b — ${largeur} x ${hauteur} (${theme}) : les TROIS articles au-dessus des gestes a l'ouverture`, async ({ browser }) => {
      test.setTimeout(90000);
      const { ctx, page, erreurs } = await ouvrir(browser, "livreur", { largeur, hauteur, theme, base: srv3.base });
      const r = await page.evaluate(() => {
        const b = s => document.querySelector(s).getBoundingClientRect();
        return {
          gestes: b("#livreur .current-driver-card .gestes").top,
          nom: b("#currentClient .arret-nom").bottom, adresse: b("#currentClient .arret-adresse").bottom,
          articles: [...document.querySelectorAll("#currentClient .arret-article")].map(e => e.getBoundingClientRect().bottom),
          livre: Math.round(b("#markDeliveredButton").height), aller: Math.round(b("#mapsButton").height),
          disque: Math.round(document.querySelector("#currentClient .arret-article .marqueur").getBoundingClientRect().height)
        };
      });
      expect(erreurs).toEqual([]);
      const f = n => Math.round(n);
      console.log(`[3 articles ${largeur}x${hauteur} ${theme}] gestes ${f(r.gestes)}, nom ${f(r.nom)}, adresse ${f(r.adresse)}, articles ${r.articles.map(f).join("/")}, disque ${r.disque}`);
      expect(r.articles.length, "prealable : l'arret seme a trois articles").toBe(3);
      expect(r.nom).toBeLessThanOrEqual(r.gestes + 0.5);
      expect(r.adresse).toBeLessThanOrEqual(r.gestes + 0.5);
      for (const [i, bas] of r.articles.entries()) {
        expect(bas, `l'article ${i + 1} sur 3 passe sous les gestes`).toBeLessThanOrEqual(r.gestes + 0.5);
      }
      // 8 px d'air : les polices de Safari ne tombent pas au pixel pres sur
      // celles de Chromium ; les 2 px du premier jet n'y survivent pas.
      expect(r.gestes - Math.max(...r.articles), "moins de 8 px d'air entre le dernier article et les gestes").toBeGreaterThanOrEqual(8);
      // Les gestes gardent leurs 56 px (decision du 23/09).
      expect(r.livre).toBe(56);
      expect(r.aller).toBe(56);
      // La ou tout tient, la carte garde les mesures de la planche (disques de 28).
      if (largeur === 390) expect(r.disque, "la carte est resserree la ou tout tenait deja").toBe(28);
      await ctx.close();
    });
  }

  // Les deux autres chemins de la mesure : l'application ouverte sur le Tableau
  // de bord (la tournee, cachee au rendu, n'avait rien a mesurer), puis
  // l'onglet « Tournee » ; et une largeur qui change (rotation).
  const troisAuDessus = page => page.evaluate(() => {
    const haut = document.querySelector("#livreur .current-driver-card .gestes").getBoundingClientRect().top;
    const bas = [...document.querySelectorAll("#currentClient .arret-article")].map(e => Math.round(e.getBoundingClientRect().bottom));
    const disque = Math.round(document.querySelector("#currentClient .arret-article .marqueur").getBoundingClientRect().height);
    return { bas, haut: Math.round(haut), dessous: bas.filter(b => b > haut + 0.5).length, disque };
  });
  test("4b — 375 x 667 : ouvert sur le Tableau de bord, puis « Tournee » : les trois articles au-dessus des gestes", async ({ browser }) => {
    test.setTimeout(90000);
    const { ctx, page, erreurs } = await ouvrir(browser, "journee", { largeur: 375, hauteur: 667, base: srv3.base });
    await page.locator('nav.mobile-tabbar [data-tab="livreur"]').click();
    await expect(page.locator("#livreur")).toHaveClass(/active/);
    await page.waitForTimeout(300);
    const r = await troisAuDessus(page);
    expect(erreurs).toEqual([]);
    expect(r.bas.length).toBe(3);
    expect(r.dessous, `articles ${r.bas.join("/")} pour une barre a ${r.haut}`).toBe(0);
    await ctx.close();
  });
  test("4b — une largeur qui change (700 -> 375, toujours au telephone) : la carte se re-mesure", async ({ browser }) => {
    test.setTimeout(90000);
    // A 700 px, le nom et l'adresse tiennent sur une ligne : rien a resserrer.
    const { ctx, page, erreurs } = await ouvrir(browser, "livreur", { largeur: 700, hauteur: 667, base: srv3.base });
    const large = await troisAuDessus(page);
    expect(large.dessous, "prealable : a 700 px, les trois articles tiennent").toBe(0);
    expect(large.disque, "prealable : a 700 px, la carte n'est pas resserree").toBe(28);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    const r = await troisAuDessus(page);
    expect(erreurs).toEqual([]);
    expect(r.dessous, `articles ${r.bas.join("/")} pour une barre a ${r.haut}`).toBe(0);
    await ctx.close();
  });

  // Relecture du 24/09 : la barre visible dans l'en-tete etait celle du Tableau
  // de bord, que seul renderTourneeDuJour() met a jour. Pendant les 4 s d'une
  // livraison en suspens (et hors ligne), l'anneau avancait, pas la barre.
  test("4b — « Livre » : la barre de l'en-tete avance avec l'anneau, et recule avec Annuler", async ({ browser }) => {
    test.setTimeout(90000);
    const { ctx, page, erreurs } = await ouvrir(browser, "livreur", { base: srv3.base });
    const part = () => page.evaluate(() => {
      const piste = document.querySelector("header.ecran-entete .tournee-progression");
      const barre = piste?.querySelector(".tournee-progression-barre");
      return piste && barre ? barre.getBoundingClientRect().width / piste.getBoundingClientRect().width : null;
    });
    const avant = await part();
    await page.locator("#markDeliveredButton").click();
    const toast = page.locator("#toastRegion .toast", { hasText: "Livré — EHPAD Les Tilleuls du Val de Loue" });
    await expect(toast).toBeVisible();
    const pendant = await part();
    // Annuler AVANT de juger : rien ne part au serveur.
    await toast.locator(".toast-action").click();
    await expect(page.locator("#currentClient .arret-nom")).toHaveText("EHPAD Les Tilleuls du Val de Loue");
    const apres = await part();
    expect(erreurs).toEqual([]);
    console.log(`[barre] avant ${avant}, pendant ${pendant}, apres Annuler ${apres}`);
    // Seme : 3 arrets termines sur 6 (deux livres, un probleme) ; puis 4 sur 6.
    expect(avant, "la barre de l'en-tete ne dit pas 3 sur 6").toBeCloseTo(3 / 6, 1);
    expect(pendant, "« Livre » : l'anneau avance, la barre de l'en-tete ne bouge pas").toBeCloseTo(4 / 6, 1);
    expect(apres, "Annuler : la barre ne revient pas").toBeCloseTo(3 / 6, 1);
    await ctx.close();
  });

  // Relecture du 24/09 : le message « Livre -- client · Annuler » recouvrait
  // « Livre » de l'arret SUIVANT (bouton actif par conception) ; un appui sur
  // sa droite tombait sur Annuler, qui defaisait l'arret precedent.
  for (const [largeur, hauteur] of [[390, 844], [375, 667], [360, 740]]) {
    test(`4b — ${largeur} x ${hauteur} : le message « Livre » ne couvre aucun geste de l'arret suivant`, async ({ browser }) => {
      test.setTimeout(90000);
      const { ctx, page, erreurs } = await ouvrir(browser, "livreur", { largeur, hauteur, base: srv3.base });
      await page.locator("#markDeliveredButton").click();
      const toast = page.locator("#toastRegion .toast", { hasText: "Livré — EHPAD Les Tilleuls du Val de Loue" });
      await expect(toast).toBeVisible();
      await expect(page.locator("#currentClient .arret-nom")).toHaveText("Pharmacie Centrale de la Gare");
      // Le message se place a l'image SUIVANTE (ajusterArretAuPouce, en
      // requestAnimationFrame), AVANT qu'elle soit peinte : l'utilisateur ne
      // voit jamais l'ancienne place. Mesurer entre l'arret affiche et cette
      // image lisait la place de l'arret precedent (CI du 26/09 : 538..606 au
      // premier essai, 501..569 au second). On attend deux images.
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const r = await page.evaluate(() => {
        const t = document.querySelector("#toastRegion .toast").getBoundingClientRect();
        const couverts = ["markDeliveredButton", "mapsButton", "callClientButton", "voirCarteButton"].filter(id => {
          const e = document.getElementById(id);
          if (!e || !e.checkVisibility()) return false;
          const x = e.getBoundingClientRect();
          return t.left < x.right && x.left < t.right && t.top < x.bottom && x.top < t.bottom;
        });
        const livre = document.getElementById("markDeliveredButton"), x = livre.getBoundingClientRect();
        const appuis = [0.1, 0.5, 0.9].map(f => livre.contains(document.elementFromPoint(x.left + x.width * f, x.top + x.height / 2)));
        return { couverts, appuis, toast: { haut: Math.round(t.top), bas: Math.round(t.bottom) }, livre: { haut: Math.round(x.top), bas: Math.round(x.bottom) },
          onglets: Math.round(document.querySelector("nav.mobile-tabbar").getBoundingClientRect().top),
          annuler: Math.round(document.querySelector("#toastRegion .toast-action").getBoundingClientRect().height) };
      });
      // Annuler AVANT de juger : l'arret revient, rien ne part au serveur.
      await toast.locator(".toast-action").click();
      await expect(page.locator("#currentClient .arret-nom")).toHaveText("EHPAD Les Tilleuls du Val de Loue");
      expect(erreurs).toEqual([]);
      console.log(`[toast ${largeur}x${hauteur}] ${JSON.stringify(r)}`);
      expect(r.couverts, `le message couvre : ${r.couverts.join(", ")}`).toEqual([]);
      expect(r.appuis, "un appui sur « Livre » (gauche, milieu, droite) tombe sur le message").toEqual([true, true, true]);
      expect(r.toast.haut, "le message sort de l'ecran").toBeGreaterThanOrEqual(0);
      expect(r.toast.bas).toBeLessThanOrEqual(r.onglets);
      expect(r.annuler).toBeGreaterThanOrEqual(44);
      await ctx.close();
    });
  }
});

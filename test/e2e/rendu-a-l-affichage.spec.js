// Performance du rendu (24/09), mesuree en production puis sur un jeu de MEME
// FORME (serveur-seme, volume « production » : 97 clients, 224 commandes,
// 218 produits...). Des bancs STRUCTURELS : ce qui est dessine, combien de
// fois, ce qui est mesure -- pas des chronometres, sauf un, a large marge.
//
// 1. L'ouverture ne dessine que l'ecran affiche ; les autres se dessinent en y
//    arrivant (rendreSiAffiche + showTab), avec les donnees du moment.
// 2. Les formateurs Intl ne sont plus construits a chaque montant, a chaque date.
// 3. Le Stock et le catalogue : une ligne hors de l'ecran n'est ni mise en page
//    ni peinte (content-visibility), et « + » ne redessine pas le catalogue.
// 4. La Preparation ne mesure plus sa rangee de secteurs cachee.
// 5. Les regles body:has(...) visent les memes elements par un chemin court.

const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3562, volume: "production" }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

const aJour = page => page.waitForFunction(() => /^À jour/.test(document.getElementById("syncStatus")?.textContent || ""), null, { timeout: 30000 });
async function ouvrir(page, ecran = "journee") {
  await page.goto(`${srv.base}/#${ecran}`);
  await aJour(page);
}
const aller = (page, ecran) => page.evaluate(e => { location.hash = `#${e}`; }, ecran);
const compter = (page, selecteur) => page.evaluate(s => document.querySelectorAll(s).length, selecteur);

test("à l'ouverture, seul l'écran affiché est dessiné", async ({ page }) => {
  await ouvrir(page);
  // Temoin : les donnees sont la (sinon des listes vides ne distingueraient rien).
  const recus = await page.evaluate(async () => ({
    stock: (await (await fetch("/api/stock")).json()).length,
    commandes: (await (await fetch("/api/orders")).json()).length
  }));
  expect(recus).toEqual({ stock: 218, commandes: 224 });
  await expect(page.locator("#statStockTotal")).toHaveText("218");
  const r = await page.evaluate(() => ({
    dom: document.getElementsByTagName("*").length,
    stock: document.querySelectorAll("#stockList .stk-ligne").length,
    catalogue: document.querySelectorAll("#customerCatalog .product-card").length,
    clients: document.querySelectorAll("#crmList .cli-ligne").length,
    commandes: document.querySelectorAll("#cmdLignes .cmd-ligne").length
  }));
  console.log(`[ouverture] ${r.dom} elements ; lignes cachees dessinees : ${JSON.stringify(r)}`);
  // Avant (v1.45.1, meme jeu) : 12 939 elements, dont 218 lignes de stock,
  // 218 cartes de catalogue, 97 clients et 20 commandes que personne ne voyait.
  expect({ stock: r.stock, catalogue: r.catalogue, clients: r.clients, commandes: r.commandes })
    .toEqual({ stock: 0, catalogue: 0, clients: 0, commandes: 0 });
  expect(r.dom).toBeLessThan(4000);
});

test("en arrivant sur un écran, il se dessine en entier", async ({ page }) => {
  await ouvrir(page);
  // Les Rappels EN PREMIER : Clients et Commande client remplissent aussi ce
  // choix en passant, et le masqueraient.
  await aller(page, "relances");
  await expect(page.locator("#relanceClientSelect option")).toHaveCount(98);
  await aller(page, "stock");
  await expect(page.locator("#stockList .stk-ligne")).toHaveCount(218);
  await aller(page, "commande-client");
  await expect(page.locator("#customerCatalog .product-card")).toHaveCount(218);
  await aller(page, "crm");
  await expect(page.locator("#crmList .cli-ligne")).toHaveCount(97);
  await aller(page, "commandes");
  await expect(page.locator("#cmdCompte")).toHaveText(/sur 224$/);
  // A plat (une seule categorie) : sous le seuil d'abord, la plus petite
  // quantite en tete -- l'ordre que l'arrivee sur le Stock refait.
  await aller(page, "stock");
  const quantites = await page.locator("#stockList .stk-saisie--stock").evaluateAll(l => l.slice(0, 20).map(e => Number(e.value)));
  expect(quantites).toEqual([...quantites].sort((a, b) => a - b));
});

test("un écran quitté pendant un chargement montre, en y revenant, les données du moment", async ({ page }) => {
  await ouvrir(page, "stock");
  const ligne = page.locator("#stockList .stk-ligne").filter({ has: page.locator('[data-product-id="stk-001"]') }).first();
  const avant = await ligne.locator(".stk-saisie--stock").inputValue();
  await aller(page, "journee");
  // Une ecriture d'ailleurs (un autre poste), puis un rechargement sur le
  // tableau de bord : le Stock est cache, son rendu attend.
  const nouvelle = Number(avant || 0) + 7;
  expect((await page.request.patch(`${srv.base}/api/stock/stk-001`, { data: { quantite: nouvelle, reason: "banc rendu" } })).status()).toBe(200);
  await page.evaluate(() => document.getElementById("refreshButton").click());
  await aJour(page);
  await aller(page, "stock");
  await expect(ligne.locator(".stk-saisie--stock")).toHaveValue(String(nouvelle));
  await page.request.patch(`${srv.base}/api/stock/stk-001`, { data: { quantite: Number(avant || 0), reason: "remise en etat du banc" } });
});

test("les montants et les dates ne construisent plus un formateur chacun", async ({ page }) => {
  await page.addInitScript(() => {
    const n = window.__formateurs = { intl: 0, locale: 0 };
    for (const nom of ["NumberFormat", "DateTimeFormat"]) {
      const Vrai = Intl[nom];
      Intl[nom] = new Proxy(Vrai, {
        construct(cible, args) { n.intl++; return new cible(...args); },
        apply(cible, ceci, args) { n.intl++; return cible(...args); }
      });
    }
    for (const nom of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]) {
      const vrai = Date.prototype[nom];
      Date.prototype[nom] = function (...args) { n.locale++; return vrai.apply(this, args); };
    }
  });
  await ouvrir(page);
  await page.waitForLoadState("networkidle");
  await aller(page, "commande-client");
  await expect(page.locator("#customerCatalog .product-card")).toHaveCount(218);
  await aller(page, "commandes");
  await expect(page.locator("#cmdLignes .cmd-ligne")).toHaveCount(20);
  await page.evaluate(() => { window.__formateurs.intl = 0; window.__formateurs.locale = 0; });
  // Deux rendus de liste : le catalogue (un prix par carte, 218 -- la recherche
  // du catalogue le refait) et une page de commandes (une date par ligne, 20).
  await page.evaluate(() => document.getElementById("customerProductSearch").dispatchEvent(new Event("input", { bubbles: true })));
  await page.locator("#cmdSuivant").click();
  await expect(page.locator("#cmdCompte")).toHaveText(/^21–40 sur 224$/);
  const n = await page.evaluate(() => window.__formateurs);
  console.log(`[formateurs] pendant les deux rendus : ${n.intl} construits, ${n.locale} toLocale*`);
  // Avant : 218 NumberFormat (formatMoney) et 20 toLocaleDateString (dateCourte).
  expect(n.intl).toBeLessThan(5);
  expect(n.locale).toBeLessThan(5);
});

test("téléphone : les lignes du Stock et du catalogue hors de l'écran ne sont pas mises en page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrir(page, "stock");
  await expect(page.locator("#stockList .stk-ligne")).toHaveCount(218);
  const sautees = sel => page.evaluate(s => {
    const lignes = [...document.querySelectorAll(s)];
    return { n: lignes.length, sautees: lignes.filter(l => !l.firstElementChild.checkVisibility({ contentVisibilityAuto: true })).length };
  }, sel);
  const stock = await sautees("#stockList .stk-ligne");
  console.log(`[stock] ${stock.sautees} lignes sur ${stock.n} hors de l'ecran, non mises en page`);
  // Avant : 0 -- les 218 lignes (36 500 px) etaient mises en page et peintes.
  expect(stock.sautees).toBeGreaterThan(150);
  // Rien n'est perdu : la derniere ligne est dans la page, et se montre en y allant.
  const derniere = page.locator("#stockList .stk-ligne").last();
  await derniere.scrollIntoViewIfNeeded();
  await expect(derniere.locator(".stk-nom")).toBeVisible();
  // La pertinence d'une ligne se met a jour a l'image suivante : on l'attend.
  await expect.poll(() => derniere.evaluate(l => l.firstElementChild.checkVisibility({ contentVisibilityAuto: true }))).toBe(true);
  await aller(page, "commande-client");
  await expect(page.locator("#customerCatalog .product-card")).toHaveCount(218);
  const catalogue = await sautees("#customerCatalog .product-card");
  console.log(`[catalogue] ${catalogue.sautees} cartes sur ${catalogue.n} hors de l'ecran`);
  expect(catalogue.sautees).toBeGreaterThan(150);
});

test("le Stock écrit ses lignes en une fois", async ({ page }) => {
  await ouvrir(page, "stock");
  await expect(page.locator("#stockList .stk-ligne")).toHaveCount(218);
  // Un rendu complet (la recherche videe le refait) : combien d'ecritures
  // dans la liste ? Avant : une par ligne (219 : le vidage, puis 218 ajouts).
  const ecritures = await page.evaluate(() => new Promise(fin => {
    const liste = document.getElementById("stockList");
    let n = 0;
    const obs = new MutationObserver(recs => { n += recs.length; });
    obs.observe(liste, { childList: true });
    const champ = document.getElementById("stockSearch");
    champ.value = "";
    champ.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => { obs.disconnect(); fin({ n, lignes: liste.querySelectorAll(".stk-ligne").length }); }, 600);
  }));
  console.log(`[stock] ${ecritures.n} ecriture(s) pour ${ecritures.lignes} lignes`);
  expect(ecritures.lignes).toBe(218);
  expect(ecritures.n).toBeLessThanOrEqual(2);
});

test("commande client : « + » change la quantité sans redessiner le catalogue", async ({ page }) => {
  await ouvrir(page, "commande-client");
  // Une carte dont le produit a du stock (« Stock 3 - ... »).
  const carte = page.locator("#customerCatalog .product-card").filter({ hasText: /Stock [1-9]/ }).first();
  await carte.evaluate(c => { c.dataset.marqueBanc = "1"; });
  await carte.locator('[data-customer-delta="1"]').click();
  await expect(carte.locator("[data-customer-qty-input]")).toHaveValue("1");
  // La MEME carte : avant, les 218 cartes etaient refaites a chaque toucher.
  expect(await compter(page, '#customerCatalog [data-marque-banc="1"]')).toBe(1);
  await expect(page.locator("#customerCart")).toContainText(await carte.locator("h4").innerText());
});

test("préparation : la rangée des secteurs n'est mesurée qu'affichée, et une frappe ne la refait pas", async ({ page }) => {
  await page.addInitScript(() => {
    window.__mesures = 0;
    const d = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
    Object.defineProperty(Element.prototype, "scrollHeight", {
      configurable: true,
      get() { if (this.id === "preparationSectorPills") window.__mesures++; return d.get.call(this); }
    });
  });
  await ouvrir(page);
  // Avant : mesuree a l'ouverture (placerFiltresPreparation, puis chaque
  // renderPreparation) -- une mise en page forcee de toute la page, pour un
  // ecran cache.
  expect(await page.evaluate(() => window.__mesures)).toBe(0);
  await aller(page, "preparation");
  // Temoin : affichee, elle se mesure (sinon le 0 ne distinguerait rien).
  await expect.poll(() => page.evaluate(() => window.__mesures)).toBeGreaterThan(0);
  await expect(page.locator("#preparationSectorPills [data-sector]").first()).toBeVisible();
  const pilule = page.locator('#preparationSectorPills [data-sector="all"]');
  await pilule.evaluate(p => { p.dataset.marqueBanc = "1"; });
  const mesures = await page.evaluate(() => window.__mesures);
  await page.evaluate(() => { const c = document.getElementById("preparationSearch"); c.value = "CMD"; c.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(400);
  expect(await compter(page, '#preparationSectorPills [data-marque-banc="1"]')).toBe(1);
  expect(await page.evaluate(() => window.__mesures)).toBe(mesures);
});

test("les règles body:has(...) visent les mêmes écrans par le chemin court", async ({ page }) => {
  // Chaque condition de la feuille, ecrite sans chemin puis avec : <body> doit
  // y repondre pareil dans chaque etat (ecran, fiche, agenda, bandeau).
  const conditions = ['#crm.active[data-vue="fiche"]', '#crm.active:not([data-vue="fiche"])', "#crm.active",
    '#abonnements.active[data-vue="agenda"]', '#abonnements.active:not([data-vue="agenda"])', "#abonnements.active",
    "#livreur.active", "#journee.active", "#bandeauHorsLigne:not([hidden])"];
  await ouvrir(page);
  const etats = [["journee"], ["crm"], ["crm", "fiche"], ["abonnements"], ["abonnements", "agenda"], ["livreur"], ["crm", "bandeau"]];
  for (const [ecran, variante] of etats) {
    await aller(page, ecran);
    await expect(page.locator(`#${ecran}`)).toHaveClass(/active/);
    const r = await page.evaluate(([cs, v]) => {
      if (v === "fiche") document.getElementById("crm").dataset.vue = "fiche";
      if (v === "agenda") document.getElementById("abonnements").dataset.vue = "agenda";
      document.getElementById("bandeauHorsLigne").hidden = v !== "bandeau";
      const res = cs.map(c => [c, document.body.matches(`:has(${c})`), document.body.matches(`:has(> .app > main.content > ${c})`)]);
      document.getElementById("crm").dataset.vue = "liste";
      document.getElementById("abonnements").dataset.vue = "liste";
      document.getElementById("bandeauHorsLigne").hidden = true;
      return res;
    }, [conditions, variante]);
    for (const [c, sans, avec] of r) expect(avec, `${ecran} ${variante || ""} : ${c}`).toBe(sans);
    // Temoin : l'etat vise est bien vrai quelque part (sinon « faux = faux » partout).
    expect(r.some(([, sans]) => sans), `${ecran} ${variante || ""}`).toBe(true);
  }
});

test("téléphone : les règles d'écran de la feuille s'appliquent toujours (chemin court)", async ({ page }) => {
  // Des regles body:has(> .app > main.content > #...) de la feuille, lues dans
  // la page : chacune change ce qu'elle doit, et seulement dans son etat.
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrir(page, "crm");
  // Un element absent LEVE : « absent » passerait pour « pas none ».
  const style = (sel, prop) => page.evaluate(([s, p]) => { const e = document.querySelector(s); if (!e) throw new Error("absent : " + s); return getComputedStyle(e)[p]; }, [sel, prop]);
  // Clients : la fiche ouverte retire la recherche de l'en-tete (liste : visible).
  expect(await style(".ecran-entete .cli-recherche", "display")).not.toBe("none");
  await page.evaluate(() => { document.getElementById("crm").dataset.vue = "fiche"; });
  expect(await style(".ecran-entete .cli-recherche", "display")).toBe("none");
  await page.evaluate(() => { document.getElementById("crm").dataset.vue = "liste"; });
  // Bandeau hors ligne visible : les filtres des Clients prennent leur marge.
  const sansBandeau = await style("#crm .cli-filtres", "paddingTop");
  await page.evaluate(() => { document.getElementById("bandeauHorsLigne").hidden = false; });
  expect(await style("#crm .cli-filtres", "paddingTop")).toBe("16px");
  expect(sansBandeau).not.toBe("16px");
  await page.evaluate(() => { document.getElementById("bandeauHorsLigne").hidden = true; });
  // Abonnements : l'agenda retire « Nouvel abonnement » des gestes du bas.
  await aller(page, "abonnements");
  await expect(page.locator("#abonnements")).toHaveClass(/active/);
  expect(await style("#gestesBas .abo-nouveau", "display")).not.toBe("none");
  await page.evaluate(() => { document.getElementById("abonnements").dataset.vue = "agenda"; });
  expect(await style("#gestesBas .abo-nouveau", "display")).toBe("none");
  await page.evaluate(() => { document.getElementById("abonnements").dataset.vue = "liste"; });
});

test("téléphone (CPU x4) : l'ouverture ne fige pas la page 800 ms", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.__longues = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__longues.push(Math.round(e.duration)); })
      .observe({ type: "longtask", buffered: true });
  });
  await ouvrir(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.reload();
  await aJour(page);
  await page.waitForTimeout(1500);
  const pire = await page.evaluate(() => Math.max(0, ...window.__longues));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  console.log(`[ouverture x4] pire tache longue ${pire} ms`);
  // Avant (v1.45.1, meme jeu) : 919 a 987 ms ; apres : ~150 ms. Seuil large.
  expect(pire).toBeLessThan(800);
});

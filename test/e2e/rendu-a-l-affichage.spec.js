// Performance du rendu (24/09), mesuree en production puis sur un jeu de MEME
// FORME (serveur-seme, volume « production » : 97 clients, 224 commandes,
// 218 produits...). Des bancs STRUCTURELS : ce qui est dessine, combien de
// fois, ce qui est mesure -- pas des chronometres (le seul temps mesure, a
// l'ouverture au telephone, est journalise, pas juge).
//
// 1. L'ouverture ne dessine que l'ecran affiche ; les autres se dessinent en y
//    arrivant (rendreOuDifferer + showTab), avec les donnees du moment, et
//    UNE fois, meme par un chemin qui fixe un filtre (« Les N autres »).
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

test("à l'ouverture, les 12 derniers mouvements du Stock sont dessinés, écran caché", async ({ page }) => {
  // L'exception au rendu differe : une centaine d'elements, que le banc du lot
  // reseau (« la copie d'avant sert encore ») lit des l'ouverture, depuis le
  // tableau de bord. Differes, il y lisait une liste vide (fusion, 24/09).
  await ouvrir(page);
  await expect(page.locator("#stock")).not.toHaveClass(/active/);
  const noms = await page.evaluate(async () => (await (await fetch("/api/stock-movements")).json()).slice(0, 12).map(m => m.productName));
  expect(noms, "prealable : le jeu a des mouvements").toHaveLength(12);
  await expect(page.locator("#stockMovementList .item h4")).toHaveText(noms);
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

// Arriver sur Commandes par un chemin qui pose son filtre : la liste s'ecrit
// UNE fois (#cmdLignes : une ecriture par rendu). Avant (relecture du 24/09) :
// le rendu en attente, avec le filtre d'avant, puis celui du chemin -- deux.
// On ouvre sur les Clients : le rendu des Commandes attend depuis l'ouverture.
async function ecrituresDesCommandes(page) {
  await page.evaluate(() => {
    const e = window.__ecrituresCmd = { n: 0 };
    new MutationObserver(recs => { e.n += recs.length; }).observe(document.getElementById("cmdLignes"), { childList: true });
  });
  // Lu apres une image : les enregistrements du geste sont alors tous livres.
  return () => page.evaluate(() => new Promise(fin => requestAnimationFrame(() => setTimeout(() => fin(window.__ecrituresCmd.n), 0))));
}

test("« Les N autres » d'une fiche client : Commandes s'écrit une fois, sur ce client", async ({ page }) => {
  await ouvrir(page, "crm");
  // Le client qui a le plus de commandes : sa fiche en montre quelques-unes,
  // puis « Les N autres ».
  const { id, total } = await page.evaluate(async () => {
    const n = new Map();
    for (const c of await (await fetch("/api/orders")).json()) n.set(c.clientId, (n.get(c.clientId) || 0) + 1);
    const [id, total] = [...n].sort((a, b) => b[1] - a[1])[0];
    return { id, total };
  });
  await page.locator(`#crmList [data-cli-choisir="${id}"]`).click();
  const autres = page.locator("#cliFiche .cli-autres");
  await expect(autres).toHaveText(/^Les \d+ autres?$/);
  const nom = await autres.getAttribute("data-client-nom");
  const lire = await ecrituresDesCommandes(page);
  await autres.click();
  await expect(page.locator("#commandes")).toHaveClass(/active/);
  // Temoins : le filtre du client, et toutes ses commandes -- les siennes seules.
  await expect(page.locator("#cmdClientFiltre")).toContainText(nom);
  await expect(page.locator("#cmdCompte")).toHaveText(new RegExp(` sur ${total}$`));
  const n = await lire();
  console.log(`[commandes] « Les N autres » (${total} commandes) : ${n} ecriture(s) de la liste`);
  expect(n).toBe(1);
});

// Integration du 24/09 : #commandes-jour ouvre desormais « Toutes » (lot
// pieges : « À envoyer » est vide par construction) -- le filtre par defaut, qui
// ne distinguerait plus le rendu d'avant de celui du chemin. #commandes-livrees
// garde un filtre a lui.
test("une ancienne adresse (#commandes-livrees) : Commandes s'écrit une fois, sur son filtre", async ({ page }) => {
  await ouvrir(page, "crm");
  const lire = await ecrituresDesCommandes(page);
  await aller(page, "commandes-livrees");
  await expect(page.locator("#commandes")).toHaveClass(/active/);
  // Temoins : le filtre de l'ancien ecran, et l'adresse de l'ecran unique.
  await expect(page.locator('#cmdPilules [data-cmd-filtre="livrees"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/#commandes$/);
  const n = await lire();
  console.log(`[commandes] redirection #commandes-livrees : ${n} ecriture(s) de la liste`);
  expect(n).toBe(1);
});

test("« Tout voir » du Stock : À recommander s'écrit une fois, sur « Stock faible »", async ({ page }) => {
  // Meme chemin que « Les N autres » : le bouton dessinait la liste (filtre
  // « Stock faible »), puis l'arrivee redessinait celle qui attendait.
  await ouvrir(page, "stock");
  await page.evaluate(() => {
    const e = window.__articlesRecommande = { n: 0 };
    new MutationObserver(recs => { for (const r of recs) for (const x of r.addedNodes) if (x.nodeName === "ARTICLE") e.n++; })
      .observe(document.getElementById("recommandeList"), { childList: true });
  });
  await page.locator("#stock .stk-tout-voir").click();
  await expect(page.locator("#recommande")).toHaveClass(/active/);
  await expect(page.locator('#recommande [data-recommend-filter="low"]')).toHaveAttribute("aria-pressed", "true");
  const r = await page.evaluate(() => new Promise(fin => requestAnimationFrame(() => setTimeout(() => fin({
    crees: window.__articlesRecommande.n, affiches: document.querySelectorAll("#recommandeList article").length
  }), 0))));
  console.log(`[recommande] « Tout voir » : ${r.crees} articles crees pour ${r.affiches} affiches`);
  expect(r.affiches, "prealable : des produits sous le seuil").toBeGreaterThan(0);
  expect(r.crees).toBe(r.affiches);
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
  // Un rendu complet (la recherche videe le refait, 200 ms apres la frappe) :
  // combien d'ecritures dans la liste ? Avant : une par ligne (219 : le vidage,
  // puis 218 ajouts). Le rendu s'ATTEND : un delai fixe, depasse sous charge,
  // jugeait « <= 2 » sur une liste que personne n'avait encore touchee.
  await page.evaluate(() => {
    const e = window.__ecrituresStock = { n: 0 };
    new MutationObserver(recs => { e.n += recs.length; }).observe(document.getElementById("stockList"), { childList: true });
    const champ = document.getElementById("stockSearch");
    champ.value = "";
    champ.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__ecrituresStock.n), { timeout: 15000 }).toBeGreaterThan(0);
  // Un rendu ecrit tout dans la meme tache ; 300 ms de plus pour un second.
  await page.waitForTimeout(300);
  const ecritures = await page.evaluate(() => ({ n: window.__ecrituresStock.n, lignes: document.querySelectorAll("#stockList .stk-ligne").length }));
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
  // Temoin du rendu de la frappe (200 ms apres) : le resume, que chaque rendu
  // refait, perd sa marque. On l'ATTEND -- un delai fixe, depasse sous charge,
  // laissait survivre la pilule sans qu'aucun rendu ait eu lieu.
  await page.locator("#preparationStats > *").first().evaluate(r => { r.dataset.marqueBanc = "1"; });
  const mesures = await page.evaluate(() => window.__mesures);
  await page.evaluate(() => { const c = document.getElementById("preparationSearch"); c.value = "CMD"; c.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(page.locator('#preparationStats [data-marque-banc="1"]')).toHaveCount(0, { timeout: 15000 });
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

test("les conditions des lots d'améliorations visent les mêmes éléments par leur chemin (intégration)", async ({ page }) => {
  // Integration de la performance (24/09) : les lots telephone et commandes
  // ecrivaient leurs body:has(...) sans chemin. Chaque paire [sans, avec] de
  // la feuille : <body> doit y repondre pareil dans chaque etat. #exports
  // (ecran supprime) quitte la liste :is(...) : absent, il ne changeait rien.
  const paires = [
    ["#livreur.active #tourneeActive:not([hidden])", "> .app > main.content > #livreur.active #tourneeActive:not([hidden])"],
    ["#livreur.active #tourneeActive[hidden]", "> .app > main.content > #livreur.active #tourneeActive[hidden]"],
    ["#livreur.active #tourneeActive:not([hidden]) .current-driver-card.arret-serre",
      "> .app > main.content > #livreur.active #tourneeActive:not([hidden]) .current-driver-card.arret-serre"],
    [":is(#statistiques, #exports, #relances, #recommande, #commande-client, #parametres, #commandes).active",
      "> .app > main.content > :is(#statistiques, #relances, #recommande, #commande-client, #parametres, #commandes).active"],
    ["#tourneesNonSoldees:not([hidden])", "> .app > main.content > #livreur #tourneesNonSoldees:not([hidden])"],
    ["#mobile-more-sheet:not([hidden])", "> .app > #mobile-more-sheet:not([hidden])"],
    ["#commandes.active", "> .app > main.content > #commandes.active"],
    ["#crm.active:not([data-vue=\"fiche\"])", "> .app > main.content > #crm.active:not([data-vue=\"fiche\"])"]
  ];
  await ouvrir(page);
  const etats = [["journee"], ["statistiques"], ["relances"], ["recommande"], ["commande-client"], ["parametres"], ["commandes"], ["crm"],
    ["livreur", "vide"], ["livreur", "tournee"], ["livreur", "serre"], ["livreur", "retard"], ["journee", "menu"]];
  const vus = new Set();
  for (const [ecran, variante] of etats) {
    await aller(page, ecran);
    await expect(page.locator(`#${ecran}`)).toHaveClass(/active/);
    const r = await page.evaluate(([ps, v]) => {
      const tournee = document.getElementById("tourneeActive");
      const carte = document.querySelector("#tourneeActive .current-driver-card");
      const retard = document.getElementById("tourneesNonSoldees");
      const menu = document.getElementById("mobile-more-sheet");
      const avant = [tournee.hidden, carte.classList.contains("arret-serre"), retard.hidden, menu.hidden];
      if (v === "tournee" || v === "serre") tournee.hidden = false;
      if (v === "vide") tournee.hidden = true;
      if (v === "serre") carte.classList.add("arret-serre");
      if (v === "retard") retard.hidden = false;
      if (v === "menu") menu.hidden = false;
      const res = ps.map(([sans, avec]) => [sans, document.body.matches(`:has(${sans})`), document.body.matches(`:has(${avec})`)]);
      [tournee.hidden, , retard.hidden, menu.hidden] = avant;
      carte.classList.toggle("arret-serre", avant[1]);
      return res;
    }, [paires, variante]);
    for (const [c, sans, avec] of r) {
      expect(avec, `${ecran} ${variante || ""} : ${c}`).toBe(sans);
      if (sans) vus.add(c);
    }
  }
  // Temoin : chaque condition a ete VRAIE au moins une fois (sinon « faux =
  // faux » ne distinguerait rien).
  expect([...vus].sort()).toEqual(paires.map(([sans]) => sans).sort());
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

// Le temps de l'ouverture au telephone est JOURNALISE, pas juge : sur l'ancien
// code, la pire tache allait de 486 a 987 ms (sept ouvertures), puis de 269 a
// 454 ms le meme soir (huit, toutes sous l'ancien seuil de 800 ms ; l'ancien
// banc, rejoue cinq fois, cinq verts -- relecture du 24/09). Le banc juge ce qui
// la faisait : les elements
// dessines par l'ouverture, un compte qui ne depend pas de la machine.
test("téléphone (CPU x4) : l'ouverture ne dessine que l'écran affiché (temps journalisé)", async ({ page }) => {
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
  const r = await page.evaluate(() => ({ pire: Math.max(0, ...window.__longues), dom: document.getElementsByTagName("*").length }));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  console.log(`[ouverture x4] pire tache longue ${r.pire} ms ; ${r.dom} elements`);
  test.info().annotations.push({ type: "mesure", description: `ouverture au telephone x4 : pire tache ${r.pire} ms, ${r.dom} elements` });
  // Avant (v1.45.1, meme jeu) : 12 967 elements -- les treize ecrans, a chaque
  // ouverture ; apres : 2 758. Temoin : la page porte bien les donnees.
  await expect(page.locator("#statStockTotal")).toHaveText("218");
  expect(r.dom).toBeLessThan(4000);
});

// --- Integration avec les ameliorations (24/09) : meme classe que « Les N
// autres ». Les lots d'ameliorations ont ajoute des chemins qui dessinent un
// ecran PUIS y arrivent (recherche de la barre laterale, « Rappel » d'une
// fiche, retour apres « Valider la commande ») : l'arrivee redessinait le rendu
// en attente -- deux ecritures pour une arrivee. Chacun s'ecrit une fois.

/** Le nombre d'ecritures (enregistrements childList) de #id, lu apres une image. */
async function ecrituresDe(page, id) {
  await page.evaluate(i => {
    const e = window.__ecritures = { n: 0 };
    new MutationObserver(recs => { e.n += recs.length; }).observe(document.getElementById(i), { childList: true });
  }, id);
  return () => page.evaluate(() => new Promise(fin => requestAnimationFrame(() => setTimeout(() => fin(window.__ecritures.n), 0))));
}

test("recherche de la barre latérale, un client : Clients s'écrit une fois (intégration)", async ({ page }) => {
  await ouvrir(page);
  const client = (await (await page.request.get(`${srv.base}/api/crm/clients`)).json())[5];
  // Une ecriture de la liste par rendu : le temoin du compte (une arrivee par
  // le menu, rendu en attente seul).
  const parLeMenu = await ecrituresDe(page, "crmList");
  await aller(page, "crm");
  await expect(page.locator(`#crmList [data-cli-choisir="${client.id}"]`)).toHaveCount(1);
  const unRendu = await parLeMenu();
  expect(unRendu, "prealable : l'arrivee par le menu ecrit la liste").toBeGreaterThan(0);
  // Rouvrir sur le tableau de bord : le rendu des Clients attend depuis l'ouverture.
  await aller(page, "journee");
  await page.reload();
  await aJour(page);
  const lire = await ecrituresDe(page, "crmList");
  await page.locator("#menuSearch").fill(client.nom);
  await page.locator(`#rechercheResultats [data-recherche="client"][data-id="${client.id}"]`).click();
  await expect(page.locator("#crm")).toHaveClass(/active/);
  await expect(page.locator(`[data-cli-choisir="${client.id}"]`)).toBeFocused();
  const n = await lire();
  console.log(`[recherche] un client : ${n} ecriture(s) de la liste (une arrivee : ${unRendu})`);
  expect(n).toBe(unRendu);
});

test("recherche de la barre latérale, un produit : le Stock s'écrit une fois, filtré (intégration)", async ({ page }) => {
  await ouvrir(page);
  const produit = (await (await page.request.get(`${srv.base}/api/stock`)).json())[7];
  const parLeMenu = await ecrituresDe(page, "stockList");
  await aller(page, "stock");
  await expect(page.locator("#stockList .stk-ligne")).toHaveCount(218);
  const unRendu = await parLeMenu();
  expect(unRendu, "prealable : l'arrivee par le menu ecrit la liste").toBeGreaterThan(0);
  // Rouvrir sur le tableau de bord : le rendu du Stock attend depuis l'ouverture.
  await aller(page, "journee");
  await page.reload();
  await aJour(page);
  const lire = await ecrituresDe(page, "stockList");
  await page.locator("#menuSearch").fill(produit.code);
  await page.locator(`#rechercheResultats [data-recherche="produit"][data-id="${produit.id}"]`).click();
  await expect(page.locator("#stock")).toHaveClass(/active/);
  // Temoin : la liste est filtree sur ce produit.
  await expect(page.locator("#stockList .stk-ligne")).toHaveCount(1);
  await expect(page.locator("#stockList .stk-code")).toHaveText(produit.code);
  const n = await lire();
  console.log(`[recherche] un produit : ${n} ecriture(s) de la liste (une arrivee : ${unRendu})`);
  expect(n).toBe(unRendu);
});

test("fiche client, « Rappel » : le choix du client s'écrit une fois, sur ce client (intégration)", async ({ page }) => {
  await ouvrir(page, "crm");
  const client = (await (await page.request.get(`${srv.base}/api/crm/clients`)).json())[3];
  await page.locator(`#crmList [data-cli-choisir="${client.id}"]`).click();
  const lire = await ecrituresDe(page, "relanceClientSelect");
  await page.locator(`#cliFiche [data-action="cli-rappel"][data-client-id="${client.id}"]`).click();
  await expect(page.locator("#relances")).toHaveClass(/active/);
  await expect(page.locator("#relanceClientSelect")).toHaveValue(client.id);
  const n = await lire();
  console.log(`[rappel] depuis la fiche : ${n} ecriture(s) du choix du client`);
  expect(n).toBe(1);
});

// En DERNIER : il cree une commande (225 au lieu de 224 pour ce qui suivrait).
test("après « Valider la commande » : Commandes s'écrit une fois, la commande mise en avant (intégration)", async ({ page }) => {
  await ouvrir(page, "commande-client");
  const client = (await (await page.request.get(`${srv.base}/api/crm/clients`)).json())[2];
  const produit = (await (await page.request.get(`${srv.base}/api/stock`)).json()).find(p => Number(p.quantite) > 5);
  await page.locator("#customerClientSearch").fill(client.nom);
  await page.locator(`#customerClientResults [data-action="cc-client"][data-id="${client.id}"]`).click();
  await expect(page.locator("#customerOrderForm [name=clientId]")).toHaveValue(client.id);
  await page.locator(`#customerCatalog [data-customer-product="${produit.id}"][data-customer-delta="1"]`).click();
  // Les rendus de la LISTE (des lignes de commande ecrites) : le squelette que
  // le chargement pose, puis retire, dans une liste encore vide n'en est pas un.
  await page.evaluate(() => {
    const e = window.__rendusCmd = { n: 0, squelettes: 0 };
    new MutationObserver(recs => {
      for (const r of recs) {
        const ajoutes = [...r.addedNodes].filter(x => x.nodeType === 1);
        if (ajoutes.some(x => x.matches(".cmd-ligne"))) e.n++;
        else if (ajoutes.length) e.squelettes++;
      }
    }).observe(document.getElementById("cmdLignes"), { childList: true });
  });
  const lire = () => page.evaluate(() => new Promise(fin => requestAnimationFrame(() => setTimeout(() => fin(window.__rendusCmd), 0))));
  const reponse = page.waitForResponse(r => r.url().endsWith("/api/customer-orders") && r.request().method() === "POST");
  await page.locator("#customerValider").click();
  const creee = await (await reponse).json();
  await expect(page.locator("#commandes")).toHaveClass(/active/);
  // Temoin : la ligne de la commande creee, mise en avant (lot pieges).
  await expect(page.locator(`#cmdLignes [data-cmd-ouvrir="${creee.id}"]`)).toHaveClass(/cmd-ligne--nouvelle/);
  const { n, squelettes } = await lire();
  console.log(`[commandes] apres « Valider la commande » : ${n} rendu(s) de la liste (${squelettes} squelette(s) du chargement)`);
  expect(n).toBe(1);
});

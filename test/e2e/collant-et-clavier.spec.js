// E2E : le panier collant et l'ordre du clavier (DESIGN.md, « Panier collant et
// ordre du clavier », 23/09).
//
// 1. Le panier de « Commande client » ne suivait pas le defilement, a aucune
//    largeur : html, body et .content avaient `overflow-x: hidden`, qui fait
//    de body et de .content des conteneurs de defilement -- qui ne defilent
//    jamais. Tout `position: sticky` de la feuille etait inerte. Le remede
//    (`clip`) les reveille TOUS : chacun est juge ici, qu'il soit garde,
//    borne ou neutralise.
// 2. Au telephone, « Nouveau client » et « Nouvel abonnement » (fixes en bas)
//    etaient atteints par Tab AVANT leur liste.
//
// Chaque cas a d'abord ete lance sur le code d'avant (DESIGN.md dit le rouge
// recu). Serveur seme sur 3350 (un seul par fichier : pas de mode parallele).

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "default" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3350, seed: jeuDeDonnees() }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

const TELEPHONE = { width: 390, height: 844 };
const BUREAU = { width: 1440, height: 900 };

async function contexte(browser, { mode = "light", viewport = BUREAU } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: mode });
  await ctx.addInitScript(m => {
    try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ }
  }, mode);
  return ctx;
}

/** Quarante produits : un catalogue bien plus haut que la fenetre. */
function stockLong() {
  return Array.from({ length: 40 }, (_, i) => ({
    id: `banc-${i}`, code: `B${i}`, nom: `Produit du banc ${i + 1}`, quantite: 50, tarif: 4, category: i % 2 ? "Hygiène" : "Soins"
  }));
}

async function ouvrirCommandeClient(page, produits = 3) {
  await page.route("**/api/stock", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stockLong()) }));
  await page.goto(srv.base + "/#commande-client", { waitUntil: "networkidle" });
  await expect(page.locator("#customerCatalog .product-card")).toHaveCount(40);
  for (let i = 0; i < produits; i++) {
    await page.locator(`#customerCatalog [data-customer-product="banc-${i}"][data-customer-delta="1"]`).click();
  }
  await expect(page.locator("#customerCart .cart-line")).toHaveCount(produits);
}

/** Defile jusqu'au milieu du catalogue et rend les boites utiles. */
async function mesurerPanier(page) {
  return page.evaluate(async () => {
    const cat = document.querySelector("#commande-client .customer-catalog-panel");
    const haut = cat.getBoundingClientRect().top + scrollY;
    scrollTo(0, haut + cat.offsetHeight / 2 - innerHeight / 2);
    await new Promise(r => setTimeout(r, 150));
    const boite = s => { const b = document.querySelector(s).getBoundingClientRect(); return { haut: Math.round(b.top), bas: Math.round(b.bottom), gauche: Math.round(b.left), droite: Math.round(b.right) }; };
    return {
      defile: Math.round(scrollY), fenetre: innerHeight,
      panier: boite("#commande-client .customer-cart-panel"),
      total: boite("#commande-client .cart-total"),
      catalogue: boite("#commande-client .customer-catalog-panel"),
      barre: boite("aside.sidebar"),
      contenu: boite("main.content"),
      top: getComputedStyle(document.querySelector("#commande-client .customer-cart-panel")).top
    };
  });
}

const intersecte = (a, b) => a.gauche < b.droite - 1 && b.gauche < a.droite - 1 && a.haut < b.bas - 1 && b.haut < a.bas - 1;

test("1 — au bureau, le panier suit le défilement du catalogue, dans les deux thèmes", async ({ browser }) => {
  test.setTimeout(180000);
  const defauts = [];
  for (const mode of ["light", "dark"]) {
    for (const largeur of [1181, 1440, 1599, 1600, 1920]) {
      const ctx = await contexte(browser, { mode, viewport: { width: largeur, height: 900 } });
      const page = await ctx.newPage();
      await ouvrirCommandeClient(page);
      const r = await mesurerPanier(page);
      // Prealable : on a vraiment defile, et loin (sinon « suit » ne juge rien).
      expect(r.defile, `prealable ${mode} ${largeur}`).toBeGreaterThan(600);
      if (r.panier.haut < 0 || r.panier.bas > r.fenetre) defauts.push(`${mode} ${largeur}px : panier hors de la fenetre (haut ${r.panier.haut}, bas ${r.panier.bas}, fenetre ${r.fenetre})`);
      else if (r.panier.haut !== 24) defauts.push(`${mode} ${largeur}px : panier colle a ${r.panier.haut}px du haut (attendu 24, top ${r.top})`);
      await ctx.close();
    }
  }
  console.log(`[panier collant] ${defauts.length} defaut(s)` + defauts.map(d => "\n   " + d).join(""));
  expect(defauts).toEqual([]);
});

test("1 — un long panier garde son total à l'écran : la liste défile dans le panier", async ({ browser }) => {
  test.setTimeout(120000);
  const defauts = [];
  for (const largeur of [1440, 1600]) {
    const ctx = await contexte(browser, { viewport: { width: largeur, height: 800 } });
    const page = await ctx.newPage();
    await ouvrirCommandeClient(page, 24);
    // Du haut du catalogue a ses trois quarts : le total reste a l'ecran.
    for (const part of [0.25, 0.5, 0.75]) {
      const r = await page.evaluate(async p => {
        const cat = document.querySelector("#commande-client .customer-catalog-panel");
        scrollTo(0, cat.getBoundingClientRect().top + scrollY + cat.offsetHeight * p - innerHeight / 2);
        await new Promise(res => setTimeout(res, 150));
        const t = document.querySelector("#commande-client .cart-total").getBoundingClientRect();
        const c = document.querySelector("#commande-client .customer-cart-panel").getBoundingClientRect();
        return { defile: Math.round(scrollY), haut: Math.round(t.top), bas: Math.round(t.bottom), panier: Math.round(c.height), fenetre: innerHeight };
      }, part);
      expect(r.defile, `prealable ${largeur}px a ${part}`).toBeGreaterThan(300);
      if (r.haut < 0 || r.bas > r.fenetre) defauts.push(`${largeur}px a ${part} du catalogue : total hors de la fenetre (${r.haut}..${r.bas}, fenetre ${r.fenetre})`);
      if (r.panier > r.fenetre) defauts.push(`${largeur}px : panier de ${r.panier}px pour ${r.fenetre}px de fenetre`);
    }
    // La derniere ligne reste atteignable : la liste defile.
    const derniere = await page.evaluate(() => {
      const liste = document.getElementById("customerCart");
      liste.scrollTop = liste.scrollHeight;
      const l = [...liste.querySelectorAll(".cart-line")].pop().getBoundingClientRect();
      const c = liste.getBoundingClientRect();
      return { dedans: l.bottom <= c.bottom + 1 && l.top >= c.top - 1, overflow: getComputedStyle(liste).overflowY };
    });
    if (!derniere.dedans) defauts.push(`${largeur}px : la derniere ligne du panier n'est pas atteignable (overflow ${derniere.overflow})`);
    await ctx.close();
  }
  console.log(`[panier long] ${defauts.length} defaut(s)` + defauts.map(d => "\n   " + d).join(""));
  expect(defauts).toEqual([]);
});

test("1 — rien ne se chevauche au bureau : panier, catalogue, barre latérale, contenu", async ({ browser }) => {
  test.setTimeout(120000);
  const defauts = [];
  for (const largeur of [1181, 1440, 1920]) {
    const ctx = await contexte(browser, { viewport: { width: largeur, height: 900 } });
    const page = await ctx.newPage();
    await ouvrirCommandeClient(page);
    const r = await mesurerPanier(page);
    if (intersecte(r.panier, r.catalogue)) defauts.push(`${largeur}px : le panier recouvre le catalogue`);
    if (intersecte(r.panier, r.barre)) defauts.push(`${largeur}px : le panier recouvre la barre laterale`);
    if (r.barre.droite > r.contenu.gauche + 1) defauts.push(`${largeur}px : la barre laterale recouvre le contenu`);
    await ctx.close();
  }
  console.log(`[chevauchement] ${defauts.length} defaut(s)` + defauts.map(d => "\n   " + d).join(""));
  expect(defauts).toEqual([]);
});

// Relecture du 23/09 : la barre laterale du bureau declare `position: sticky`
// depuis juillet, mais n'a jamais colle (le `hidden` de body etait deja la).
// `clip` la faisait coller sur tous les ecrans : un changement que tout
// utilisateur de bureau voit, et que personne n'a decide -- le meme cas que
// le bandeau du telephone, ci-dessous. Neutralisee comme lui ; question a
// Thomas (DESIGN.md, ecarts nommes).
test("1 — au bureau, la barre latérale défile avec la page, comme avant", async ({ browser }) => {
  test.setTimeout(120000);
  const vus = {};
  for (const largeur of [921, 1440]) {
    const ctx = await contexte(browser, { viewport: { width: largeur, height: 700 } });
    // Clients n'est pas ici : ses six clients semes ne font pas defiler 1440 px.
    for (const onglet of ["stock", "commandes", "commande-client"]) {
      const page = await ctx.newPage();
      if (onglet === "stock" || onglet === "commande-client") {
        await page.route("**/api/stock", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stockLong()) }));
      }
      await page.goto(srv.base + "/#" + onglet, { waitUntil: "networkidle" });
      vus[`${largeur} ${onglet}`] = await page.evaluate(async () => {
        const max = document.scrollingElement.scrollHeight - innerHeight;
        scrollTo(0, Math.min(400, max));
        await new Promise(r => setTimeout(r, 150));
        return { defile: Math.round(scrollY), haut: Math.round(document.querySelector("aside.sidebar").getBoundingClientRect().top) };
      });
      await page.close();
    }
    await ctx.close();
  }
  console.log("[barre laterale] " + Object.entries(vus).map(([o, v]) => `${o}: defile ${v.defile}, haut ${v.haut}`).join(" · "));
  for (const [cle, v] of Object.entries(vus)) {
    expect(v.defile, `prealable ${cle} : la page defile`).toBeGreaterThan(40);
    expect(v.haut, `${cle} : la barre laterale part avec la page`).toBe(-v.defile);
  }
});

test("1 — au téléphone, le bandeau de marque défile avec la page (il ne colle que sur Tournée, comme avant)", async ({ browser }) => {
  test.setTimeout(120000);
  const ctx = await contexte(browser, { viewport: TELEPHONE });
  const vus = {};
  for (const onglet of ["stock", "crm", "commande-client", "parametres", "livreur"]) {
    // Une page neuve par ecran : un changement d'ancre dans la meme page
    // ramene l'ecran en haut apres coup, et le defilement serait perdu.
    const page = await ctx.newPage();
    await page.goto(srv.base + "/#" + onglet, { waitUntil: "networkidle" });
    vus[onglet] = await page.evaluate(async () => {
      const max = document.scrollingElement.scrollHeight - innerHeight;
      scrollTo(0, Math.min(250, max));
      await new Promise(r => setTimeout(r, 150));
      return { defile: Math.round(scrollY), haut: Math.round(document.querySelector("aside.sidebar").getBoundingClientRect().top) };
    });
    await page.close();
  }
  console.log("[bandeau] " + Object.entries(vus).map(([o, v]) => `${o}: defile ${v.defile}, haut ${v.haut}`).join(" · "));
  for (const [onglet, v] of Object.entries(vus)) {
    expect(v.defile, `prealable ${onglet} : la page defile`).toBeGreaterThan(40);
    if (onglet === "livreur") expect(v.haut, "Tournee : le bandeau colle, comme avant").toBe(0);
    else expect(v.haut, `${onglet} : le bandeau part avec la page`).toBe(-v.defile);
  }
  await ctx.close();
});

test("1 — la bannière de récupération de la base défile avec la page, sans recouvrir la barre latérale", async ({ browser }) => {
  const ctx = await contexte(browser);
  const page = await ctx.newPage();
  await page.route("**/api/storage/status", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ lastRecovery: { mode: "fresh_empty", message: "Base vierge (banc)." } }) }));
  await page.route("**/api/stock", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stockLong()) }));
  await page.goto(srv.base + "/#stock", { waitUntil: "networkidle" });
  const banniere = page.locator("#storageRecoveryBanner");
  await expect(banniere).toBeVisible();
  const r = await page.evaluate(async () => {
    scrollTo(0, 600);
    await new Promise(res => setTimeout(res, 150));
    const b = document.getElementById("storageRecoveryBanner").getBoundingClientRect();
    const s = document.querySelector("aside.sidebar").getBoundingClientRect();
    return { defile: Math.round(scrollY), bas: Math.round(b.bottom), haut: Math.round(b.top), barreHaut: Math.round(s.top) };
  });
  console.log(`[banniere] defile ${r.defile}, banniere ${r.haut}..${r.bas}, barre a ${r.barreHaut}`);
  expect(r.defile, "prealable : la page defile").toBeGreaterThan(300);
  expect(r.bas, "la banniere part avec la page").toBeLessThanOrEqual(0);
  await ctx.close();
});

test("1 — aucun débordement horizontal, rien d'utile rogné, de 360 à 1440 px", async ({ browser }) => {
  // `clip` rogne : on verifie qu'aucun contenu ne depasse le bord (et ne
  // serait donc coupe), hors des conteneurs qui defilent d'eux-memes. C'est
  // la liste `hors` qui juge : `scrollWidth` ne voit presque plus rien, body
  // et main rognant ce que leurs descendants depassent. AUCUNE exclusion : la
  // rangee d'actions de l'en-tete, qui depassait de 921 a 1225 px (Clients,
  // Commandes, Stock, Abonnements -- « Actualiser » hors de l'ecran), passe
  // desormais a la ligne (relecture du 23/09). 921, 1024 et 1200 : les
  // largeurs ou elle depassait.
  test.setTimeout(300000);
  const defauts = [];
  const ONGLETS = ["journee", "crm", "commandes", "commande-client", "relances", "statistiques", "stock", "preparation", "abonnements", "livreur", "parametres"];
  for (const largeur of [360, 390, 820, 921, 1024, 1200, 1440]) {
    const ctx = await contexte(browser, { viewport: { width: largeur, height: 844 } });
    const page = await ctx.newPage();
    for (const onglet of ONGLETS) {
      await page.goto(srv.base + "/#" + onglet, { waitUntil: "networkidle" });
      const r = await page.evaluate(() => {
        const racines = new Set([document.documentElement, document.body, document.querySelector("main.content")]);
        const dansDefileur = e => {
          for (let p = e.parentElement; p; p = p.parentElement) {
            if (racines.has(p)) return false;
            if (getComputedStyle(p).overflowX !== "visible") return true;
          }
          return false;
        };
        const hors = [];
        for (const e of document.querySelectorAll("body *")) {
          const b = e.getBoundingClientRect();
          if (b.width <= 1 || b.height <= 1) continue;
          const cs = getComputedStyle(e);
          if (cs.visibility === "hidden" || cs.position === "fixed") continue;
          if ((b.right > innerWidth + 1 || b.left < -1) && !dansDefileur(e)) hors.push(`${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} [${Math.round(b.left)}..${Math.round(b.right)}]`);
        }
        return { large: document.scrollingElement.scrollWidth, fenetre: innerWidth, hors };
      });
      if (r.large > r.fenetre) defauts.push(`${largeur}px #${onglet} : la page defile de cote (${r.large} pour ${r.fenetre})`);
      for (const h of r.hors.slice(0, 3)) defauts.push(`${largeur}px #${onglet} : ${h} depasse le bord`);
    }
    await ctx.close();
  }
  console.log(`[debordement] ${defauts.length} defaut(s)` + defauts.map(d => "\n   " + d).join(""));
  expect(defauts).toEqual([]);
});

// Relecture du 23/09 : `clip` interdit tout defilement de cote, meme celui
// que le focus provoquait. Un bouton d'en-tete au-dela du bord recevait donc
// le focus SANS etre vu (« Actualiser » a 1024 px). On parcourt l'en-tete au
// clavier, de sa premiere commande a la derniere, aux largeurs ou la rangee
// depassait, et chaque element atteint doit etre dans la fenetre.
test("1 — au clavier, chaque commande de l'en-tête est à l'écran quand elle reçoit le focus", async ({ browser }) => {
  test.setTimeout(240000);
  const defauts = [];
  let atteints = 0;
  for (const largeur of [921, 1024, 1200, 1440]) {
    const ctx = await contexte(browser, { viewport: { width: largeur, height: 844 } });
    const page = await ctx.newPage();
    for (const onglet of ["journee", "crm", "commandes", "stock", "abonnements", "livreur"]) {
      await page.goto(srv.base + "/#" + onglet, { waitUntil: "networkidle" });
      // Une sentinelle en tete de l'en-tete : le premier Tab tombe sur sa
      // premiere commande.
      await page.evaluate(() => {
        const s = document.createElement("button");
        s.id = "sentinelleEntete"; s.textContent = "debut";
        document.querySelector(".ecran-entete").prepend(s); s.focus();
      });
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        const v = await page.evaluate(() => {
          const e = document.activeElement;
          if (!e || !e.closest(".ecran-entete")) return null;
          const b = e.getBoundingClientRect();
          return { nom: e.id || String(e.className).split(" ").slice(-1)[0], gauche: Math.round(b.left), droite: Math.round(b.right), fenetre: innerWidth };
        });
        if (!v) break;
        atteints++;
        if (v.gauche < -1 || v.droite > v.fenetre + 1) defauts.push(`${largeur}px #${onglet} : « ${v.nom} » a le focus hors de l'ecran (${v.gauche}..${v.droite}, fenetre ${v.fenetre})`);
      }
    }
    await ctx.close();
  }
  console.log(`[focus en-tete] ${atteints} focus, ${defauts.length} defaut(s)` + defauts.map(d => "\n   " + d).join(""));
  // Prealable : l'en-tete a bien ete parcouru (six ecrans, quatre largeurs).
  expect(atteints, "prealable : Tab atteint les commandes de l'en-tete").toBeGreaterThan(24 * 2);
  expect(defauts).toEqual([]);
});

/** Presse Tab depuis le debut de la page ; rend ce que chaque pas a atteint. */
// Le point de depart compte : une ancre (#crm) le pose sur l'ecran, un tap
// sur la barre basse sur l'onglet touche, avant l'en-tete. On part donc d'une
// sentinelle posee en tete du document, et on parcourt tout l'ordre, une fois.
async function parcoursTab(page, { bouton, ligne }, pas = 120) {
  await page.evaluate(() => {
    const s = document.createElement("button");
    s.id = "sentinelleTab"; s.textContent = "debut";
    document.body.prepend(s); s.focus();
  });
  const vus = [];
  for (let i = 0; i < pas; i++) {
    await page.keyboard.press("Tab");
    const v = await page.evaluate(([b, l]) => {
      const e = document.activeElement;
      if (!e || e === document.body) return "vide";
      if (e.matches(b)) return "bouton";
      if (e.closest(l)) return "ligne";
      return e.tagName.toLowerCase() + (e.id ? "#" + e.id : "");
    }, [bouton, ligne]);
    if (v === "vide" || v === "button#sentinelleTab") break;
    vus.push(v);
  }
  await page.evaluate(() => document.getElementById("sentinelleTab")?.remove());
  return vus;
}

const ECRANS_CLAVIER = [
  { onglet: "crm", bouton: ".cli-nouveau", ligne: "#crmList .cli-ligne", nom: "Nouveau client" },
  { onglet: "abonnements", bouton: ".abo-nouveau", ligne: "#subscriptionList .abonnement-ligne", nom: "Nouvel abonnement" }
];

for (const e of ECRANS_CLAVIER) {
  test(`2 — au téléphone, Tab parcourt la liste AVANT « ${e.nom} », toujours fixé en bas`, async ({ browser }) => {
    const ctx = await contexte(browser, { viewport: TELEPHONE });
    const page = await ctx.newPage();
    await page.goto(srv.base + "/#" + e.onglet, { waitUntil: "networkidle" });
    await expect(page.locator(e.ligne).first()).toBeVisible();
    const bouton = page.locator(e.bouton);
    await expect(bouton).toBeVisible();
    const vus = await parcoursTab(page, e);
    console.log(`[tab ${e.onglet}] ` + vus.join(" > "));
    const iBouton = vus.indexOf("bouton"), iDerniere = vus.lastIndexOf("ligne");
    expect(iDerniere, "prealable : Tab atteint les lignes").toBeGreaterThanOrEqual(0);
    expect(iBouton, "prealable : Tab atteint le bouton").toBeGreaterThanOrEqual(0);
    expect(iBouton, `« ${e.nom} » atteint au pas ${iBouton}, la derniere ligne au pas ${iDerniere}`).toBeGreaterThan(iDerniere);
    // Toujours fixe en bas, pleine largeur moins 16 px, au-dessus de la barre.
    const b = await bouton.evaluate(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { gauche: r.left, droite: r.right, h: r.height, bas: r.bottom, barre: document.querySelector("nav.mobile-tabbar").getBoundingClientRect().top, position: cs.position, fond: cs.backgroundColor }; });
    expect(b.position).toBe("fixed");
    expect([b.gauche, b.droite]).toEqual([16, TELEPHONE.width - 16]);
    expect(b.h).toBeGreaterThanOrEqual(48);
    expect(b.barre - b.bas).toBeGreaterThanOrEqual(8);
    // Et il marche.
    await bouton.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(e.onglet === "crm" ? "#cliDialogue" : "#subscriptionDialog")).toHaveAttribute("open", "");
    await ctx.close();
  });
}

test("2 — au téléphone, le bouton déplacé n'apparaît que sur son écran, et revient dans l'en-tête au bureau", async ({ browser }) => {
  const ctx = await contexte(browser, { viewport: TELEPHONE });
  const page = await ctx.newPage();
  await page.goto(srv.base + "/#crm", { waitUntil: "networkidle" });
  await expect(page.locator(".cli-nouveau")).toBeVisible();
  await expect(page.locator(".abo-nouveau")).toBeHidden();
  await page.goto(srv.base + "/#stock", { waitUntil: "networkidle" });
  await expect(page.locator(".cli-nouveau")).toBeHidden();
  await expect(page.locator(".abo-nouveau")).toBeHidden();
  await page.goto(srv.base + "/#abonnements", { waitUntil: "networkidle" });
  await expect(page.locator(".abo-nouveau")).toBeVisible();
  await expect(page.locator(".cli-nouveau")).toBeHidden();
  // Franchir 820 px : le meme element revient a sa place dans l'en-tete.
  await page.setViewportSize(BUREAU);
  await expect(page.locator("#enteteActions .abo-recherche + .abo-nouveau")).toBeVisible();
  await expect(page.locator("#enteteActions .cli-rappels + .cli-nouveau")).toHaveCount(1);
  await page.setViewportSize(TELEPHONE);
  await expect(page.locator(".abo-nouveau")).toBeVisible();
  await expect(page.locator("#enteteActions .abo-nouveau")).toHaveCount(0);
  await ctx.close();
});

for (const e of ECRANS_CLAVIER) {
  test(`2 — au bureau, « ${e.nom} » reste dans l'en-tête, avant la liste, comme avant`, async ({ browser }) => {
    const ctx = await contexte(browser);
    const page = await ctx.newPage();
    await page.goto(srv.base + "/#" + e.onglet, { waitUntil: "networkidle" });
    await expect(page.locator(e.ligne).first()).toBeVisible();
    const bouton = page.locator(`.ecran-entete #enteteActions ${e.bouton}`);
    await expect(bouton).toBeVisible();
    expect(await bouton.evaluate(el => getComputedStyle(el).position)).toBe("static");
    const vus = await parcoursTab(page, e);
    expect(vus.indexOf("bouton"), vus.join(" > ")).toBeGreaterThanOrEqual(0);
    expect(vus.indexOf("bouton")).toBeLessThan(vus.indexOf("ligne"));
    await ctx.close();
  });
}

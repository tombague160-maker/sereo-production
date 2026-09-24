// TOURNEE PAR SECTEUR -- audit du 24/09, lot « les pieges », dans un vrai
// navigateur, sur un serveur seme (port 3521).
//
// Mesure de l'audit (verif-parcours/v2.js, bureau et telephone) : choisir
// « Besançon (3) » dans le menu Secteur puis « Sélectionner ce secteur », sans
// « Filtrer », cochait les 5 commandes pretes de TOUS les secteurs : Dole et
// Champagnole partaient dans la tournee de Besancon. « Créer une tournée
// optimisée » etait AU-DESSUS de la liste (575 contre 782 au bureau, 1349
// contre 1601 au telephone) : on coche en bas, on remonte.
//
// Maintenant : des pilules qui filtrent tout de suite (plus de « Filtrer »),
// et « Créer la tournée (N) » SOUS la liste, colle en bas au telephone. Les
// gardes du lot 2 restent : une commande deja dans une tournee est grisee, et
// « Sélectionner ce secteur » ne la prend pas.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

const BUREAU = { width: 1440, height: 900 };
const TELEPHONE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

/**
 * Aucune tournee ne roule ; cinq commandes pretes du jour : trois a Besancon
 * (o-3, o-4, o-6), une a Champagnole (o-5), une a Dole (o-8). Plus o-p, a
 * Besancon, deja dans une tournee PRETE (r-prete) : grisee (lot 2).
 */
function seme() {
  const s = jeuDeDonnees();
  for (const o of s.commandes) if (o.status === "en_livraison") o.status = "pret_livraison";
  const tilleuls = s.commandes.find(o => o.id === "o-3");
  const prise = { ...structuredClone(tilleuls), id: "o-p", clientName: "Résidence Prête", routeId: "r-prete" };
  s.commandes.push(prise);
  s.routes = [{
    id: "r-prete", status: "prete", deliveryDate: AUJOURDHUI, name: "Tournée Besançon", sector: "Besancon",
    stops: [{ id: "s-o-p", orderId: prise.id, clientId: prise.clientId, clientName: prise.clientName,
      address: prise.address, city: prise.city, postalCode: prise.postalCode, lat: prise.lat, lng: prise.lng,
      status: "pret_livraison", products: prise.products }]
  }];
  return s;
}

let srv;
async function semer() {
  if (srv) await srv.arreter();
  srv = await demarrer({ port: 3521, seed: seme(), routageAdaptatif: true });
}
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, { viewport = BUREAU, theme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, timezoneId: "Europe/Paris", locale: "fr-FR" });
  await ctx.addInitScript(t => { try { localStorage.setItem("sereo:colorScheme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(srv.base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }" });
  return { ctx, page, erreurs };
}

/**
 * Le geste « je choisis Besancon » : la pilule ; sur l'ancien ecran, le menu
 * Secteur (sans « Filtrer » : c'etait tout le piege). Le meme geste humain sur
 * les deux ecrans, pour que le banc juge l'ancien code sur le vrai defaut.
 */
async function choisirBesancon(page) {
  const pilule = page.locator("#deliverySectorPills [data-delivery-sector]", { hasText: /Besan/ });
  if (await pilule.count()) return pilule.click();
  const menu = page.locator("#deliverySector");
  const options = await menu.locator("option").allInnerTexts();
  return menu.selectOption({ index: options.findIndex(o => /Besan/.test(o)) });
}

const cochees = page => page.locator("#deliveryCandidates [data-delivery-order]:checked");
async function secteursCoches(page) {
  return page.locator("#deliveryCandidates .delivery-card:has([data-delivery-order]:checked) .order-meta span:first-child").allInnerTexts();
}

test("« Sélectionner ce secteur » ne coche QUE ce secteur, jamais une commande deja en tournee", async ({ browser }) => {
  test.setTimeout(120000);
  await semer();
  const { ctx, page, erreurs } = await ouvrir(browser);
  await choisirBesancon(page);
  await page.locator('[data-action="select-current-sector"]').click();
  const secteurs = await secteursCoches(page);
  console.log(`[bureau] cochees : ${JSON.stringify(secteurs)}`);
  expect(secteurs, "« Sélectionner ce secteur » a coche d'autres secteurs").toEqual(["Besançon", "Besançon", "Besançon"]);
  // Garde du lot 2 : la commande deja dans « Tournée Besançon » est grisee, non cochee.
  const prise = page.locator(".delivery-card", { hasText: "Résidence Prête" });
  await expect(prise.locator('input[type="checkbox"]')).toBeDisabled();
  await expect(prise.locator('input[type="checkbox"]')).not.toBeChecked();
  // La liste montre le secteur choisi, tout de suite : ni Dole ni Champagnole.
  await expect(page.locator("#deliveryCandidates")).not.toContainText("EHPAD Résidence Bellevue");
  await expect(page.locator("#deliveryCandidates")).not.toContainText("Pharmacie Centrale de la Gare");
  await expect(page.locator("#deliveryFilterSummary")).toContainText("Besançon");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("plus de « Filtrer » : les pilules, la ville et « Tous » filtrent tout de suite ; leur compte est celui de la liste", async ({ browser }) => {
  test.setTimeout(120000);
  await semer();
  const { ctx, page, erreurs } = await ouvrir(browser);
  await expect(page.locator("#applyDeliveryFilterButton"), "le bouton « Filtrer » est encore la").toHaveCount(0);
  const pilules = page.locator("#deliverySectorPills [data-delivery-sector]");
  const libelles = (await pilules.allInnerTexts()).map(t => t.trim());
  expect(libelles).toEqual(["Tous (6)", "Besançon (4)", "Champagnole (1)", "Dole (1)"]);
  await expect(pilules.first()).toHaveAttribute("aria-pressed", "true");
  const cartes = page.locator("#deliveryCandidates [data-delivery-order]");
  await expect(cartes).toHaveCount(6);
  await pilules.filter({ hasText: "Dole" }).click();
  await expect(cartes, "la pilule n'a pas filtre tout de suite").toHaveCount(1);
  await expect(pilules.filter({ hasText: "Dole" })).toHaveAttribute("aria-pressed", "true");
  // Le focus clavier reste sur la pilule choisie (le rendu refait la rangee).
  expect(await page.evaluate(() => document.activeElement?.dataset?.deliverySector)).toBe("Dole");
  await pilules.filter({ hasText: "Tous" }).click();
  await expect(cartes).toHaveCount(6);
  // La ville, sans bouton : une pause de frappe suffit.
  await page.locator("#deliveryCity").fill("Champagnole");
  await expect(cartes, "la ville n'a pas filtre sans « Filtrer »").toHaveCount(1);
  await expect(page.locator("#deliveryCandidates")).toContainText("Pharmacie Centrale de la Gare");
  await page.locator("#deliveryCity").fill("");
  await expect(cartes).toHaveCount(6);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("bureau : « Créer la tournée (3) » est SOUS la liste, et la tournee creee n'a que Besancon", async ({ browser }) => {
  test.setTimeout(120000);
  await semer();
  const { ctx, page, erreurs } = await ouvrir(browser);
  await choisirBesancon(page);
  await page.locator('[data-action="select-current-sector"]').click();
  const creer = page.locator("#createRouteButton");
  await expect(creer).toHaveText("Créer la tournée (3)");
  const [bouton, liste] = await Promise.all([creer.boundingBox(), page.locator("#deliveryCandidates").boundingBox()]);
  console.log(`[bureau] creer ${JSON.stringify(bouton)} liste ${JSON.stringify(liste)}`);
  expect(bouton.y, "« Créer » est au-dessus de la liste").toBeGreaterThanOrEqual(liste.y + liste.height);

  await page.route("**/api/geocode?*", route => route.fulfill({ json: [{ label: "Dépôt confirmé", lat: 47.2378, lng: 6.0241 }] }));
  await page.locator("#departureQuery").fill("Dépôt");
  await page.locator('[data-op="search-departure"]').click();
  await page.locator("#departureResults").selectOption("0");
  await page.locator("#returnToStart").check();
  const reponse = page.waitForResponse(r => r.url().endsWith("/api/routes") && r.request().method() === "POST");
  await creer.click();
  expect((await reponse).status()).toBe(201);
  const tournees = await (await page.request.get(srv.base + "/api/routes")).json();
  const nouvelle = tournees.find(t => t.id !== "r-prete");
  expect(nouvelle.stops.map(s => s.orderId).sort(), "la tournee de Besancon emporte d'autres secteurs").toEqual(["o-3", "o-4", "o-6"]);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("telephone : « Créer la tournée (N) » reste colle en bas, au-dessus de la barre basse, pendant qu'on parcourt la liste", async ({ browser }) => {
  test.setTimeout(120000);
  await semer();
  const { ctx, page, erreurs } = await ouvrir(browser, { viewport: TELEPHONE });
  // Toute la liste (six cartes, plus haute que l'ecran), cinq choisies.
  await page.locator('[data-action="select-all-delivery"]').click();
  const creer = page.locator("#createRouteButton");
  await expect(creer).toHaveText("Créer la tournée (5)");
  // On parcourt la liste : la premiere carte en haut de l'ecran.
  await page.locator("#deliveryCandidates .delivery-card").first().evaluate(e => e.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const b = document.getElementById("createRouteButton").getBoundingClientRect();
    const barre = document.querySelector(".mobile-tabbar")?.getBoundingClientRect();
    const liste = document.getElementById("deliveryCandidates").getBoundingClientRect();
    return { haut: Math.round(b.top), bas: Math.round(b.bottom), hauteur: Math.round(b.height), barre: Math.round(barre?.top ?? innerHeight), listeBas: Math.round(liste.bottom), ecran: innerHeight };
  });
  console.log(`[telephone] creer ${JSON.stringify(r)}`);
  expect(r.listeBas, "prealable : la fin de la liste est deja a l'ecran, rien a coller").toBeGreaterThan(r.barre);
  expect(r.haut, "« Créer » n'est pas a l'ecran pendant qu'on parcourt la liste").toBeGreaterThanOrEqual(0);
  expect(r.bas, "« Créer » passe sous la barre basse").toBeLessThanOrEqual(r.barre);
  expect(r.hauteur, "cible trop petite").toBeGreaterThanOrEqual(44);
  // Les pilules de secteur : des cibles de 44 px.
  const hauteurs = await page.locator("#deliverySectorPills [data-delivery-sector]").evaluateAll(ps => ps.map(p => Math.round(p.getBoundingClientRect().height)));
  for (const h of hauteurs) expect(h, "pilule de secteur sous 44 px").toBeGreaterThanOrEqual(44);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("pendant la livraison, « Créer la tournée » se replie avec la planification, et revient quand on l'ouvre", async ({ browser }) => {
  // Avant, le bouton vivait DANS le depliant « Préparer une tournée », replie
  // pendant la livraison. Sous la liste, il en est sorti : sans cette regle,
  // il collerait en bas de l'ecran du livreur, sous le pouce, en pleine tournee.
  test.setTimeout(120000);
  if (srv) await srv.arreter();
  srv = await demarrer({ port: 3521, seed: jeuDeDonnees(), routageAdaptatif: true });
  const { ctx, page, erreurs } = await ouvrir(browser, { viewport: TELEPHONE });
  const planification = page.locator("#routePlanning");
  await expect(planification, "prealable : la tournee roule, la planification est repliee").not.toHaveAttribute("open", "");
  await expect(page.locator("#trnCreer")).toBeHidden();
  await planification.locator("summary").click();
  await expect(page.locator("#trnCreer")).toBeVisible();
  await planification.locator("summary").click();
  await expect(page.locator("#trnCreer")).toBeHidden();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("contrastes, clair et sombre : la pilule choisie, une pilule libre, « Créer la tournée »", async ({ browser }) => {
  test.setTimeout(120000);
  await semer();
  const luminance = rgb => {
    const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contraste = (a, b) => { const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
  for (const theme of ["light", "dark"]) {
    for (const viewport of [BUREAU, TELEPHONE]) {
      const { ctx, page } = await ouvrir(browser, { theme, viewport });
      await choisirBesancon(page);
      await page.locator('[data-action="select-current-sector"]').click();
      const paires = await page.evaluate(() => {
        const fond = el => {
          for (let n = el; n; n = n.parentElement) {
            const c = getComputedStyle(n).backgroundColor;
            if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
          }
          return getComputedStyle(document.body).backgroundColor;
        };
        const choisie = document.querySelector('#deliverySectorPills [aria-pressed="true"]');
        const libre = document.querySelector('#deliverySectorPills [aria-pressed="false"]');
        const creer = document.getElementById("createRouteButton");
        return [["choisie", choisie], ["libre", libre], ["creer", creer]].map(([quoi, el]) => ({ quoi, texte: getComputedStyle(el).color, fond: fond(el) }));
      });
      for (const p of paires) {
        const ratio = contraste(p.texte, p.fond);
        console.log(`[contraste/${theme}/${viewport.width}] ${p.quoi} ${ratio.toFixed(2)}`);
        expect(ratio, `${theme} ${viewport.width} ${p.quoi} : ${p.texte} sur ${p.fond}`).toBeGreaterThanOrEqual(4.5);
      }
      // La pilule choisie se VOIT : son fond n'est pas celui d'une libre (en
      // clair, sans la regle du lot, les deux etaient identiques).
      const [choisie, libre] = paires;
      expect(choisie.fond, `${theme} ${viewport.width} : la pilule choisie ne se distingue pas`).not.toBe(libre.fond);
      await ctx.close();
    }
  }
});

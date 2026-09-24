// TELEPHONE, HORS LIGNE ET SAISIE (chasse aux defauts du 24/09, section 1,
// cote page ; corriges le 25/09). Chaque cas porte le defaut qu'il ferme,
// mesure sur 5b52268 (v1.46.0 et la performance), et son temoin.
//
//  1. Deux boutons « Valider la commande » hors du formulaire (sous le total,
//     et la barre du panier au telephone) : Entree puis la barre, pendant un
//     envoi lent, creaient DEUX commandes.
//  2. Hors ligne, « enregistré, sera envoyé » laissait le formulaire rempli :
//     revalider mettait une seconde commande en file (autre cle).
//  3. Une issue inconnue (reponse perdue, sans file possible) : revalider la
//     MEME saisie creait une seconde commande, meme en ligne.
//  4. Abonnement + nouvelle fiche, hors ligne : la fiche seule partait en
//     file, deux fiches au retour, aucun abonnement.
//  5. Abonnement d'un client existant, hors ligne : la fenetre restait
//     ouverte sur « enregistré » ; un second appui, un second abonnement.
//  6. Modifier une fiche client hors ligne : l'identite partait, le statut,
//     le rappel et les notes etaient perdus.
//  7. Le « retour » du telephone quittait l'application et perdait le panier.
//  8. Safari < 17.4 (checkVisibility) : fausse erreur rouge apres « Créer la
//     commande » d'une echeance ; Safari < 16 (requestSubmit) : l'import lance
//     depuis l'en-tete ne partait pas.
//  9. « Partiel (1 indispo) » restait affiche apres l'arrivee des donnees.
// 10. Apres « Livré », le tableau de bord gardait le CA et les comptes d'avant.
// 11. Clients au telephone : le repli des pilules forcait une mise en page par
//     pilule cachee (766 ms a l'arrivee, CPU x 4, jeu « production »).
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const TELEPHONE = { width: 390, height: 844 };
const BUREAU = { width: 1280, height: 900 };
// Les 26 secteurs du jeu « production » (jeu-production.js) : de quoi remplir
// plus de deux rangs de pilules au telephone.
const SECTEURS = ["Besancon", "Champagnole", "Dole", "Arbois", "Poligny", "Salins-les-Bains", "Lons-le-Saunier", "Ornans", "Quingey", "Saint-Vit",
  "Morez", "Saint-Claude", "Pontarlier", "Baume-les-Dames", "Audincourt", "Montbeliard", "Mouchard", "Nozeroy", "Clairvaux", "Orgelet",
  "Moirans", "Tavaux", "Auxonne", "Gray", "Levier", "Frasne"];

function graine() {
  const seed = jeuDeDonnees();
  seed.clients.push(...SECTEURS.map((secteur, i) => ({
    id: `c-secteur-${i}`, nom: `Pharmacie de ${secteur}`, rue: `${i + 1} rue Neuve`, ville: secteur,
    codePostal: String(39000 + i), secteur, crmStatus: "client_actif"
  })));
  return seed;
}

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3606, seed: graine() }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

const lire = async chemin => (await fetch(srv.base + chemin)).json();
const nbCommandes = async () => (await lire("/api/orders")).length;
const aJour = page => page.waitForFunction(() => /^À jour/.test(document.getElementById("syncStatus")?.textContent || ""), null, { timeout: 30000 });

async function ouvrir(browser, ecran, { vue = BUREAU, avant = null, serviceWorkers = "block" } = {}) {
  const ctx = await browser.newContext({
    viewport: vue, timezoneId: "Europe/Paris", serviceWorkers,
    ...(vue.width <= 820 ? { isMobile: true, hasTouch: true } : {})
  });
  if (avant) await ctx.addInitScript(avant);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(`${srv.base}/#${ecran}`);
  await aJour(page);
  return { ctx, page, erreurs };
}

function lireFile(page) {
  return page.evaluate(() => new Promise(resolve => {
    if (typeof indexedDB === "undefined") { resolve([]); return; }
    const d = indexedDB.open("sereo-file-attente", 1);
    d.onerror = () => resolve([]);
    d.onsuccess = () => {
      const db = d.result;
      if (!db.objectStoreNames.contains("ecritures")) { db.close(); resolve([]); return; }
      const r = db.transaction("ecritures", "readonly").objectStore("ecritures").getAll();
      r.onsuccess = () => { const v = r.result.map(e => `${e.methode} ${new URL(e.url, location.origin).pathname}`); db.close(); resolve(v); };
      r.onerror = () => { db.close(); resolve([]); };
    };
  }));
}

const toasts = page => page.evaluate(() => [...document.querySelectorAll("#toastRegion .toast")].map(t => `${(t.className.match(/toast-(\w+)/) || [])[1]} | ${t.textContent.trim()}`));
const NOM = '#customerOrderForm input[name="nom"]';

async function preparerCommande(page, nom) {
  await page.evaluate(() => window.Sereo.showTab("commande-client"));
  await page.locator('#customerCatalog [data-customer-product][data-customer-delta="1"]').first().click();
  await page.fill(NOM, nom);
}

// --- 11. Le repli des pilules : une mise en page ------------------------------

/** L'etat du repli : les pilules cachees (rang dans la liste) et « + N ». */
const etatDuRepli = page => page.evaluate(() => {
  const conteneur = document.querySelector("#crm .cli-filtres");
  const pilules = [...conteneur.querySelectorAll(":scope > .cli-pilules > .cli-pilule, :scope > .cli-statut-filtre")];
  const bouton = conteneur.querySelector(":scope > .pilules-plus");
  return {
    cachees: pilules.map((p, i) => (p.classList.contains("pilule-repliee") ? i : -1)).filter(i => i >= 0),
    plus: bouton && !bouton.hidden ? bouton.textContent : null
  };
});

/** L'algorithme d'avant (une mesure par pilule cachee), rejoue sur la page : l'oracle. */
const replierPiluleParPilule = page => page.evaluate(() => {
  const conteneur = document.querySelector("#crm .cli-filtres");
  const pilules = [...conteneur.querySelectorAll(":scope > .cli-pilules > .cli-pilule, :scope > .cli-statut-filtre")];
  const choisie = p => p.classList.contains("cli-pilule--active") || (p.matches(".cli-statut-filtre") && p.querySelector("select")?.value !== "all");
  const bouton = conteneur.querySelector(":scope > .pilules-plus");
  pilules.forEach(p => p.classList.remove("pilule-repliee"));
  if (bouton) bouton.hidden = true;
  const haut = e => Math.round(e.getBoundingClientRect().top - conteneur.getBoundingClientRect().top);
  const visibles = pilules.filter(p => p.getClientRects().length);
  const rangs = [];
  for (const p of visibles) if (!rangs.some(r => Math.abs(r - haut(p)) < 4)) rangs.push(haut(p));
  if (rangs.length <= 2) return { cachees: [], plus: null };
  bouton.hidden = false;
  rangs.sort((a, b) => a - b);
  const limite = rangs[1] + 4;
  const cachables = visibles.filter(p => !choisie(p)).reverse();
  let caches = 0;
  for (;;) {
    bouton.textContent = `+ ${Math.max(caches, 1)}`;
    const deborde = [...visibles, bouton].some(e => !e.classList.contains("pilule-repliee") && haut(e) > limite);
    if (!deborde || caches >= cachables.length) break;
    cachables[caches].classList.add("pilule-repliee");
    caches++;
  }
  bouton.textContent = `+ ${caches}`;
  return { cachees: pilules.map((p, i) => (p.classList.contains("pilule-repliee") ? i : -1)).filter(i => i >= 0), plus: bouton.textContent };
});

/**
 * Compte les mises en page FORCEES pendant `geste` : une lecture de boite
 * (getBoundingClientRect, getClientRects) apres une ecriture du DOM. Le
 * premier jet en faisait une par pilule cachee.
 */
async function misesEnPageForcees(page, geste) {
  await page.evaluate(() => {
    if (window.__misesEnPage) return;
    const m = window.__misesEnPage = { actif: false, sale: false, forcees: 0 };
    const salir = () => { if (m.actif) m.sale = true; };
    for (const [proto, noms] of [[DOMTokenList.prototype, ["add", "remove", "toggle"]],
      [Element.prototype, ["setAttribute", "removeAttribute", "append", "remove", "before", "after"]],
      [Node.prototype, ["appendChild", "removeChild", "insertBefore"]]]) {
      for (const nom of noms) { const f = proto[nom]; proto[nom] = function (...a) { salir(); return f.apply(this, a); }; }
    }
    for (const [proto, nom] of [[Node.prototype, "textContent"], [HTMLElement.prototype, "hidden"], [Element.prototype, "innerHTML"],
      [CSSStyleDeclaration.prototype, "cssText"], [HTMLElement.prototype, "tabIndex"]]) {
      const d = Object.getOwnPropertyDescriptor(proto, nom);
      Object.defineProperty(proto, nom, { ...d, set(v) { salir(); d.set.call(this, v); } });
    }
    for (const nom of ["getBoundingClientRect", "getClientRects"]) {
      const f = Element.prototype[nom];
      Element.prototype[nom] = function () { if (m.actif && m.sale) { m.forcees++; m.sale = false; } return f.call(this); };
    }
  });
  // Le geste commence par une ecriture (la rangee depliee ou repliee).
  await page.evaluate(() => Object.assign(window.__misesEnPage, { actif: true, sale: true, forcees: 0 }));
  await geste();
  return page.evaluate(() => { const m = window.__misesEnPage; m.actif = false; return m.forcees; });
}

test("Clients au téléphone : le repli des pilules force UNE mise en page (et cache les mêmes pilules que la mesure pilule par pilule)", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, "crm", { vue: TELEPHONE });
  const plus = page.locator("#crm .cli-filtres > .pilules-plus");
  await expect(plus, "prealable : 26 secteurs debordent deux rangs").toBeVisible();
  const replie = await etatDuRepli(page);
  expect(replie.cachees.length, "prealable : le repli cache une vingtaine de pilules").toBeGreaterThan(10);
  // Deplier, puis replier : le repli refait, mesure.
  await plus.click();
  await expect(plus).toHaveText("Moins");
  const forcees = await misesEnPageForcees(page, () => page.locator("#crm .cli-filtres > .pilules-plus").click());
  expect(await etatDuRepli(page), "replier apres deplier ne rend pas le meme repli").toEqual(replie);
  expect(forcees, "mises en page forcees pour un repli").toBe(1);
  // Meme resultat que la mesure pilule par pilule : largeurs, choix, et
  // « + N » a deux chiffres.
  const comparer = async quoi => {
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(300);
    const calcule = await etatDuRepli(page);
    const oracle = await replierPiluleParPilule(page);
    expect(calcule, `${quoi} : le calcul et la mesure pilule par pilule different`).toEqual(oracle);
    return calcule;
  };
  for (const largeur of [320, 360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width: largeur, height: 844 });
    await comparer(`${largeur} px`);
  }
  await page.setViewportSize(TELEPHONE);
  // La derniere pilule choisie (elle ne se cache jamais), puis un statut choisi.
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(300);
  await plus.click();
  await page.locator('#cliPilules [data-cli-secteur="__abonnes"]').click();
  await page.locator("#crm .cli-filtres > .pilules-plus").click();
  const avecChoisie = await comparer("« Abonnés » choisie");
  expect(avecChoisie.cachees.length).toBeGreaterThan(10);
  await page.locator("#crm .cli-filtres > .pilules-plus").click();
  await page.locator("#crmStatusFilter").selectOption("prospect");
  await page.locator("#crm .cli-filtres > .pilules-plus").click();
  await comparer("statut choisi");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

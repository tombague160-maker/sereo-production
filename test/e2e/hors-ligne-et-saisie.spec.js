// TELEPHONE, HORS LIGNE ET SAISIE (chasse aux defauts du 24/09, section 1,
// cote page ; corriges le 25/09). Chaque cas porte le defaut qu'il ferme,
// mesure sur 5b52268 (v1.46.0 et la performance), et son temoin.
//
//  1. Deux boutons « Valider la commande » hors du formulaire (sous le total,
//     et la barre du panier au telephone) : Entree puis la barre, pendant un
//     envoi lent, creaient DEUX commandes.
//  2. Hors ligne, « enregistre, sera envoye » laissait le formulaire rempli :
//     revalider mettait une seconde commande en file (autre cle).
//  3. Une issue inconnue (reponse perdue, sans file possible) : revalider la
//     MEME saisie creait une seconde commande, meme en ligne.
//  4. Abonnement + nouvelle fiche, hors ligne : la fiche seule partait en
//     file, deux fiches au retour, aucun abonnement.
//  5. Abonnement d'un client existant, hors ligne : la fenetre restait
//     ouverte sur « enregistre » ; un second appui, un second abonnement.
//  6. Modifier une fiche client hors ligne : l'identite partait, le statut,
//     le rappel et les notes etaient perdus.
//  7. Le « retour » du telephone quittait l'application et perdait le panier.
//  8. Safari < 17.4 (checkVisibility) : fausse erreur rouge apres « Creer la
//     commande » d'une echeance ; Safari < 16 (requestSubmit) : l'import lance
//     depuis l'en-tete ne partait pas.
//  9. « Partiel (1 indispo) » restait affiche apres l'arrivee des donnees.
// 10. Apres « Livre », le tableau de bord gardait le CA et les comptes d'avant.
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

// --- 1. Deux boutons, un envoi ----------------------------------------------

test("« Valider » : Entrée puis la barre du panier pendant un envoi lent -- UNE commande, et les deux boutons grisés", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", { vue: TELEPHONE });
  await page.route("**/api/customer-orders", async route => { await new Promise(r => setTimeout(r, 2500)); await route.continue(); });
  await preparerCommande(page, "Essai Entree");
  await expect(page.locator("#customerCartBar"), "prealable : la barre du panier est la").toBeVisible();
  const avant = await nbCommandes();
  await page.locator(NOM).press("Enter");
  await page.waitForTimeout(300);
  const grises = await page.evaluate(() => [...document.querySelectorAll('[form="customerOrderForm"][type="submit"]')].map(b => b.disabled));
  // Le geste de l'utilisateur, bouton grise ou non.
  await page.locator('#customerCartBar button[type="submit"]').click({ force: true });
  await expect.poll(async () => (await nbCommandes()) - avant, { timeout: 10000 }).toBeGreaterThan(0);
  await page.waitForTimeout(3500);
  expect((await nbCommandes()) - avant, "commandes creees par un seul geste").toBe(1);
  expect(grises, "pendant l'envoi, les deux boutons « Valider la commande »").toEqual([true, true]);
  // Temoin : l'envoi fini, les boutons se rallument.
  await expect(page.locator("#customerValider")).toBeEnabled();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 2. Hors ligne : la commande en file, l'ecran vide -----------------------

test("hors ligne : « enregistrée sur ce téléphone » VIDE la commande ; revalider ne met rien de plus en file ; au retour, UNE commande", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", { vue: TELEPHONE });
  const avant = await nbCommandes();
  await ctx.setOffline(true);
  await preparerCommande(page, "Essai Hors Ligne");
  await page.locator("#customerValider").click();
  await expect.poll(() => lireFile(page), { timeout: 10000 }).toEqual(["POST /api/customer-orders"]);
  await expect(page.locator("#customerCartCount"), "le panier reste plein apres la mise en file").toHaveText("0 produit");
  await expect(page.locator(NOM), "le nom reste saisi apres la mise en file").toHaveValue("");
  expect((await toasts(page)).some(t => /^warning \| .*partira à la reconnexion/.test(t)), (await toasts(page)).join(" / ")).toBe(true);
  // Le second appui : plus rien a envoyer.
  await page.locator("#customerValider").click();
  await page.waitForTimeout(800);
  expect(await lireFile(page), "un second appui a mis une seconde commande en file").toEqual(["POST /api/customer-orders"]);
  await ctx.setOffline(false);
  await expect.poll(async () => (await nbCommandes()) - avant, { timeout: 30000 }).toBe(1);
  await expect.poll(() => lireFile(page), { timeout: 15000 }).toEqual([]);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 3. Issue inconnue : la meme saisie, la meme cle ------------------------

test("réponse perdue en route, sans file possible : revalider la MÊME saisie ne crée pas de seconde commande (même clé) ; une saisie changée, si (témoin)", async ({ browser }) => {
  // Sans indexedDB (navigation privee stricte) : rien ne se met en file.
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", {
    avant: () => { Object.defineProperty(window, "indexedDB", { get() { return undefined; }, configurable: true }); }
  });
  const cles = [];
  let premier = true;
  await page.route("**/api/customer-orders", async route => {
    cles.push(route.request().headers()["x-sereo-geste"]);
    if (premier) {
      premier = false;
      // Le serveur recoit et applique ; la reponse se perd en route.
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  const avant = await nbCommandes();
  await preparerCommande(page, "Essai Issue Inconnue");
  await page.locator("#customerValider").click();
  await expect.poll(() => cles.length, { timeout: 10000 }).toBe(1);
  await expect.poll(async () => (await nbCommandes()) - avant, { timeout: 10000 }).toBe(1);
  await expect(page.locator("#customerCartCount"), "prealable : rien n'a ete garde, la saisie reste").toHaveText("1 produit");
  await page.locator("#customerValider").click();
  await expect.poll(() => cles.length, { timeout: 10000 }).toBe(2);
  await page.waitForTimeout(1500);
  expect(cles[1], "le second envoi de la MEME saisie a tire une autre cle").toBe(cles[0]);
  expect((await nbCommandes()) - avant, "revalider la meme saisie a cree une seconde commande").toBe(1);
  // Temoin : une saisie NEUVE est un geste neuf.
  await preparerCommande(page, "Essai Suivant");
  await page.locator("#customerValider").click();
  await expect.poll(() => cles.length, { timeout: 10000 }).toBe(3);
  expect(cles[2]).not.toBe(cles[0]);
  await expect.poll(async () => (await nbCommandes()) - avant, { timeout: 10000 }).toBe(2);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 4 et 5. Abonnements hors ligne -----------------------------------------

async function ouvrirCreationAbonnement(page) {
  await page.evaluate(() => window.Sereo.showTab("abonnements"));
  await page.locator('[data-op="new-sub"]:visible').first().click();
  await expect(page.locator("#subscriptionDialog")).toBeVisible();
}

async function ajouterProduitAbonnement(page) {
  if (await page.locator("#subCatalogue").isHidden()) await page.locator('[data-op="sub-catalogue"]').click();
  await page.locator('[data-op="sub-ajouter"]:visible').first().click();
}

test("hors ligne, abonnement + NOUVELLE fiche : refus clair, rien en file ; en ligne, la fiche ET l'abonnement (témoin)", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "abonnements");
  const compter = async () => ({
    fiches: (await lire("/api/crm/clients")).filter(c => c.nom === "Horsligne").length,
    abonnements: (await lire("/api/subscriptions")).items.length
  });
  const avant = await compter();
  await ouvrirCreationAbonnement(page);
  await page.locator('[data-op="sub-nouveau-client"]').click();
  await page.fill("#subLastName", "Horsligne");
  await page.fill("#subAddress", "1 rue de l'Essai");
  await page.fill("#subCity", "Besançon");
  await ajouterProduitAbonnement(page);
  await ctx.setOffline(true);
  await page.locator("#subSave").click();
  await expect(page.locator("#subError")).toContainText("Pas de réseau");
  await expect(page.locator("#subError")).not.toContainText("enregistré");
  expect(await lireFile(page), "une fiche seule est partie en file").toEqual([]);
  await expect(page.locator("#subscriptionDialog"), "la saisie reste pour plus tard").toBeVisible();
  await ctx.setOffline(false);
  await page.waitForTimeout(1500);
  expect(await compter(), "hors ligne, quelque chose est parti").toEqual(avant);
  // Temoin : en ligne, le meme geste cree la fiche ET l'abonnement.
  await page.locator("#subSave").click();
  await expect(page.locator("#subscriptionDialog")).toBeHidden();
  expect(await compter()).toEqual({ fiches: avant.fiches + 1, abonnements: avant.abonnements + 1 });
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("hors ligne, abonnement d'un client EXISTANT : la fenêtre se ferme et le dit ; UN abonnement en file, créé au retour", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "abonnements");
  const avant = (await lire("/api/subscriptions")).items.length;
  await ouvrirCreationAbonnement(page);
  await page.fill("#subClientSearch", "Dupont");
  await page.locator('#subClientResults [data-op="sub-client"]').first().click();
  await ajouterProduitAbonnement(page);
  await ctx.setOffline(true);
  await page.locator("#subSave").click();
  await expect(page.locator("#subscriptionDialog"), "la fenetre reste ouverte sur « enregistré »").toBeHidden();
  expect(await lireFile(page)).toEqual(["POST /api/subscriptions"]);
  expect((await toasts(page)).some(t => /^warning \| Abonnement enregistré sur ce téléphone/.test(t)), (await toasts(page)).join(" / ")).toBe(true);
  await ctx.setOffline(false);
  await expect.poll(async () => (await lire("/api/subscriptions")).items.length - avant, { timeout: 30000 }).toBe(1);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 6. Une fiche client modifiee hors ligne : tout part ---------------------

test("hors ligne, modifier une fiche (nom, statut, notes) : l'identité ET la fiche CRM attendent dans la file, la fenêtre se ferme ; au retour, tout est sur la fiche", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "crm");
  await page.locator('[data-cli-choisir="c-dupont"]').click();
  await page.locator('[data-action="cli-modifier"][data-client-id="c-dupont"]').click();
  await expect(page.locator("#cliDialogue")).toBeVisible();
  await page.fill('#crmForm input[name="nom"]', "Cabinet Dupont-Lefebvre et associés");
  await page.selectOption('#crmForm select[name="crmStatus"]', "client_a_relancer");
  await page.fill('#crmForm textarea[name="notes"]', "Rappeler le mardi matin");
  await ctx.setOffline(true);
  await page.locator('#crmForm button[type="submit"]').click();
  await expect(page.locator("#cliDialogue"), "la fenetre reste ouverte sur « enregistré »").toBeHidden();
  expect(await lireFile(page), "une partie de la fiche n'est ni envoyee ni gardee")
    .toEqual(["PATCH /api/clients/c-dupont", "PATCH /api/crm/clients/c-dupont"]);
  await ctx.setOffline(false);
  await expect.poll(async () => {
    const fiche = (await lire("/api/crm/clients")).find(c => c.id === "c-dupont");
    return { nom: fiche.nom, crmStatus: fiche.crmStatus, notes: fiche.notes };
  }, { timeout: 30000 }).toEqual({ nom: "Cabinet Dupont-Lefebvre et associés", crmStatus: "client_a_relancer", notes: "Rappeler le mardi matin" });
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 7. Le « retour » du telephone : le panier revient -----------------------

test("« retour » du téléphone puis retour dans l'application : le panier et la saisie reviennent ; validée, la commande ne revient plus", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: TELEPHONE, isMobile: true, hasTouch: true, timezoneId: "Europe/Paris", serviceWorkers: "block" });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(srv.base + "/healthz");
  await page.goto(srv.base + "/#journee");
  await aJour(page);
  await preparerCommande(page, "Saisie en cours");
  await page.locator('#customerCatalog [data-customer-product][data-customer-delta="1"]').first().click();
  await expect(page.locator("#customerCartCount")).toHaveText("1 produit");
  // Le geste « retour » quitte l'application (les onglets n'empilent rien).
  await page.goBack();
  expect(new URL(page.url()).pathname, "prealable : le retour quitte l'application").toBe("/healthz");
  await page.goForward();
  await aJour(page);
  await expect(page.locator("#commande-client"), "prealable : on revient sur la commande").toHaveClass(/active/);
  await expect(page.locator("#customerCartCount"), "le panier est perdu").toHaveText("1 produit");
  await expect(page.locator(NOM)).toHaveValue("Saisie en cours");
  await expect(page.locator('#customerCatalog [data-customer-qty-input]').first(), "la quantite du catalogue").toHaveValue("2");
  // Validee : elle ne revient plus.
  await page.locator("#customerValider").click();
  await expect(page.locator("#commandes")).toHaveClass(/active/);
  await page.reload();
  await aJour(page);
  await page.evaluate(() => window.Sereo.showTab("commande-client"));
  await expect(page.locator("#customerCartCount")).toHaveText("0 produit");
  await expect(page.locator(NOM)).toHaveValue("");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 8. Les iPhone plus anciens ----------------------------------------------

test("sans checkVisibility (Safari < 17.4) : « Créer la commande » d'une échéance ne dit pas d'erreur ; l'agenda s'ouvre, focus compris, sans promesse rejetée", async ({ browser }) => {
  const avant = () => {
    delete Element.prototype.checkVisibility;
    window.__rejets = [];
    window.addEventListener("unhandledrejection", e => window.__rejets.push(String(e.reason && e.reason.message || e.reason)));
  };
  const { ctx, page, erreurs } = await ouvrir(browser, "abonnements", { avant });
  expect(await page.evaluate(() => typeof Element.prototype.checkVisibility), "prealable : l'API est bien retiree").toBe("undefined");
  // Le defaut ne se montre que si le meme abonnement a une AUTRE echeance visible.
  const memes = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-op="generate-sub"]')].filter(b => b.getClientRects().length).map(b => b.dataset.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i).length;
  });
  expect(memes, "prealable : un abonnement a deux echeances a l'ecran").toBeGreaterThan(0);
  const commandes = await nbCommandes();
  await page.locator('[data-op="generate-sub"]:visible').first().click();
  await expect.poll(nbCommandes).toBe(commandes + 1);
  await page.waitForTimeout(800);
  const vus = await toasts(page);
  expect(vus.filter(t => t.startsWith("error")), vus.join(" / ")).toEqual([]);
  expect(vus.some(t => t.startsWith("success"))).toBe(true);
  await ctx.close();
  // L'agenda au telephone.
  const tel = await ouvrir(browser, "abonnements", { vue: TELEPHONE, avant });
  await tel.page.locator('[data-op="abo-vue"][data-vue="agenda"]:visible').first().click();
  await expect(tel.page.locator("#abonnements")).toHaveAttribute("data-vue", "agenda");
  await expect.poll(() => tel.page.evaluate(() => document.activeElement?.id)).toBe("aboAgendaRetour");
  expect(await tel.page.evaluate(() => window.__rejets)).toEqual([]);
  expect([...erreurs, ...tel.erreurs]).toEqual([]);
  await tel.ctx.close();
});

test("sans requestSubmit (Safari < 16) : un fichier choisi depuis l'en-tête part quand même", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", { avant: () => { delete HTMLFormElement.prototype.requestSubmit; } });
  expect(await page.evaluate(() => typeof HTMLFormElement.prototype.requestSubmit)).toBe("undefined");
  const envois = [];
  // Rien n'est importe : le banc compte l'envoi et le refuse.
  await page.route("**/api/import/ventes", route => { envois.push(route.request().method()); return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "refus du banc" }) }); });
  await page.evaluate(() => { document.getElementById("ventesFile").dataset.depuisEntete = "1"; });
  await page.setInputFiles("#ventesFile", { name: "ventes.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("PK banc") });
  await expect.poll(() => envois.length, { timeout: 10000, message: `le fichier n'est pas parti ; erreurs : ${erreurs.join(" | ")}` }).toBe(1);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 9. « Partiel » apres l'arrivee des donnees -----------------------------

test("cache de données vide, /api/orders lent (5 s) : « Partiel », puis « À jour » quand la réponse tardive arrive", async ({ browser }) => {
  test.setTimeout(90000);
  const ctx = await browser.newContext({ viewport: BUREAU, timezoneId: "Europe/Paris", serviceWorkers: "allow" });
  const page = await ctx.newPage();
  await page.goto(srv.base + "/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  await aJour(page);
  // Cache de donnees vide, comme apres une deconnexion ou une fin de session.
  await page.evaluate(async () => { for (const n of await caches.keys()) if (n.startsWith("sereo-api-")) await caches.delete(n); });
  await ctx.route("**/api/orders", async route => { await new Promise(r => setTimeout(r, 5000)); await route.continue(); });
  await page.reload();
  await expect(page.locator("#syncStatus"), "prealable : la section est d'abord indisponible").toHaveText(/^Partiel/, { timeout: 15000 });
  await expect(page.locator("#syncStatus"), "les commandes sont arrivees, le statut reste « Partiel »").toHaveText(/^À jour/, { timeout: 15000 });
  expect(await page.evaluate(async () => (await (await fetch("/api/orders")).json()).length)).toBeGreaterThan(0);
  await ctx.close();
});

// --- 10. Le tableau de bord apres « Livre » ----------------------------------

test("après « Livré », le tableau de bord montre le chiffre d'affaires et les comptes d'après le geste", async ({ browser }) => {
  const IDS = ["opRevenue", "opDelivered", "dashboardDeliveringCount", "dashboardDeliveringDetail", "dashboardPreparingCount"];
  const releve = page => page.evaluate(ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id)?.textContent.trim()])), IDS);
  const { ctx, page, erreurs } = await ouvrir(browser, "journee");
  const avant = await releve(page);
  await page.evaluate(() => window.Sereo.showTab("livreur"));
  const reponse = page.waitForResponse(r => /\/api\/routes\/[^/]+\/stops\//.test(r.url()) && r.request().method() === "PATCH", { timeout: 20000 });
  await page.locator("#markDeliveredButton").click();
  expect((await reponse).status()).toBe(200);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.Sereo.showTab("journee"));
  // La verite : une page neuve, apres le geste.
  const neuve = await ctx.newPage();
  await neuve.goto(srv.base + "/#journee");
  await aJour(neuve);
  const verite = await releve(neuve);
  expect(verite.opRevenue, "prealable : le geste change le chiffre d'affaires").not.toBe(avant.opRevenue);
  await expect.poll(() => releve(page), { timeout: 10000, message: "le tableau de bord montre l'etat d'avant le geste" }).toEqual(verite);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

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
  // Largeur par largeur (un pas de 2 px) : le repli se decide a quelques
  // pixels pres (l'ecart de 8 px, la largeur de « + 12 ») ; six largeurs ne
  // tombaient sur aucune de ces frontieres (un mutant sans l'ecart y survivait).
  const balayer = async (quoi, largeurs) => {
    const ecarts = [];
    let repliees = 0;
    for (const largeur of largeurs) {
      await page.setViewportSize({ width: largeur, height: 844 });
      // Le repli suit le redimensionnement a l'image suivante (planifierReplis).
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const calcule = await etatDuRepli(page);
      const oracle = await replierPiluleParPilule(page);
      if (calcule.cachees.length) repliees += 1;
      if (JSON.stringify(calcule) !== JSON.stringify(oracle)) ecarts.push(`${largeur} px : ${JSON.stringify(calcule)} au lieu de ${JSON.stringify(oracle)}`);
    }
    expect(repliees, `${quoi} : prealable, le repli cache des pilules`).toBe(largeurs.length);
    expect(ecarts, `${quoi} : le calcul et la mesure pilule par pilule different`).toEqual([]);
  };
  const largeurs = pas => Array.from({ length: Math.floor((440 - 320) / pas) + 1 }, (_, i) => 320 + i * pas);
  await balayer("aucune choisie hors « Tous »", largeurs(2));
  // La derniere pilule choisie (elle ne se cache jamais), puis un statut choisi.
  await page.setViewportSize(TELEPHONE);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await plus.click();
  await page.locator('#cliPilules [data-cli-secteur="__abonnes"]').click();
  await page.locator("#crm .cli-filtres > .pilules-plus").click();
  await balayer("« Abonnés » choisie", largeurs(4));
  await page.setViewportSize(TELEPHONE);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.locator("#crm .cli-filtres > .pilules-plus").click();
  await page.locator("#crmStatusFilter").selectOption("prospect");
  await page.locator("#crm .cli-filtres > .pilules-plus").click();
  await balayer("« Abonnés » et un statut choisis", largeurs(4));
  expect(erreurs).toEqual([]);
  await ctx.close();
});

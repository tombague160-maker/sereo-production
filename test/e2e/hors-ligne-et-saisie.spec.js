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
// 12. Stock au telephone (485 ms a l'arrivee en production, v1.46.1) : chaque
//     changement d'ecran mesurait les rangees de pilules des ecrans CACHES --
//     deux mises en page forcees de tout le document, pour rien.
// 13. Stock : deux <svg> par ligne (436 en production), plus de la moitie de
//     l'analyse HTML de la liste ; dessines par la feuille, au pixel pres.
// 14. Stock : trier « A recommander » construisait un comparateur par paire
//     (localeCompare avec une langue) ; un seul, construit une fois.
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
  // 4G sans debit : le telephone se croit en ligne, la requete echoue. Meme
  // refus, rien en file (la page met en file sans consulter navigator.onLine).
  // La page ne sait pas si le serveur a recu : elle ne dit plus « Pas de
  // réseau » (relecture du 26/09, banc 17).
  await page.route("**/api/crm/clients", route => route.abort("internetdisconnected"));
  await page.locator("#subSave").click();
  await expect(page.locator("#subError")).toContainText("Pas de réponse du serveur");
  expect(await lireFile(page), "4G sans debit : une fiche seule est partie en file").toEqual([]);
  await page.unroute("**/api/crm/clients");
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
    const m = window.__misesEnPage = { actif: false, sale: false, forcees: 0, ou: [] };
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
      Element.prototype[nom] = function () {
        // Ou : les fonctions de la page qui ont lu (la pile, sans l'instrument).
        if (m.actif && m.sale) {
          m.forcees++;
          m.sale = false;
          m.ou.push((new Error().stack || "").split("\n").slice(2, 4).map(l => l.trim().replace(/\(.*\/js\//, "(")).join(" < "));
        }
        return f.call(this);
      };
    }
  });
  // Le geste commence par une ecriture (la rangee depliee ou repliee).
  await page.evaluate(() => Object.assign(window.__misesEnPage, { actif: true, sale: true, forcees: 0, ou: [] }));
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

// --- 12. Arriver sur le Stock au telephone : aucune mise en page forcee -------

/** Change d'ecran par l'adresse ; le comptage s'arrete a la fin de l'arrivee (showTab). */
const arriverSur = (page, ecran) => page.evaluate(e => new Promise(r => {
  addEventListener("hashchange", () => { window.__misesEnPage.actif = false; r(); }, { once: true });
  location.hash = `#${e}`;
}), ecran);

test("Stock au téléphone : l'arrivée ne force aucune mise en page (les pilules des écrans cachés ne se mesurent pas) ; témoin : Commandes mesure les siennes", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", { vue: TELEPHONE });
  // Prealable : les deux rangees de pilules sont dans la page (cachees avec
  // leur ecran, vides tant qu'il n'a pas ete dessine : rendreOuDifferer).
  expect(await page.locator("#cmdPilules, #crm .cli-filtres").count(), "prealable : les rangees de Commandes et de Clients").toBe(2);
  const auStock = await misesEnPageForcees(page, () => arriverSur(page, "stock"));
  await expect(page.locator("#stockList .stk-ligne").first()).toBeVisible();
  const ou = await page.evaluate(() => window.__misesEnPage.ou);
  expect(auStock, `mises en page forcees en arrivant sur le Stock : ${ou.join(" | ")}`).toBe(0);
  // Temoin : sur le meme chemin, l'instrument voit la mesure de la rangee de
  // l'ecran AFFICHE -- Commandes mesure toujours ses pilules en arrivant (le
  // repli lui-meme : bancs 11 et telephone-utilisable.spec.js).
  const auxCommandes = await misesEnPageForcees(page, () => arriverSur(page, "commandes"));
  const ouCommandes = await page.evaluate(() => window.__misesEnPage.ou);
  expect(auxCommandes, "temoin : aucune mesure en arrivant sur Commandes").toBeGreaterThanOrEqual(1);
  expect(ouCommandes.join(" | "), "temoin : ce n'est pas le repli qui mesure").toContain("replierPilules");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 13. Les « − » et « + » du Stock : dessines par la feuille --------------

// Le balisage d'avant (25/09) : deux <svg> par ligne, 16 px (style.css).
const ANCIEN = {
  moins: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg>'
};

/** Pixels qui different (un canal de plus de 8 sur 255) entre deux captures PNG, lus dans la page. */
const pixelsDifferents = (page, a, b) => page.evaluate(async ([a, b]) => {
  const lire = async b64 => {
    const i = new Image();
    i.src = `data:image/png;base64,${b64}`;
    await i.decode();
    const c = document.createElement("canvas");
    c.width = i.width; c.height = i.height;
    const x = c.getContext("2d");
    x.drawImage(i, 0, 0);
    return x.getImageData(0, 0, i.width, i.height);
  };
  const [p, q] = [await lire(a), await lire(b)];
  if (p.width !== q.width || p.height !== q.height) return -1;
  let n = 0;
  for (let k = 0; k < p.data.length; k += 4) if ([0, 1, 2, 3].some(j => Math.abs(p.data[k + j] - q.data[k + j]) > 8)) n++;
  return n;
}, [a.toString("base64"), b.toString("base64")]);

for (const theme of ["light", "dark"]) {
  test(`Stock : « − » et « + » sans <svg> dans les lignes, même rendu que le <svg> d'avant (${theme})`, async ({ browser }) => {
    const { ctx, page, erreurs } = await ouvrir(browser, "stock", {
      vue: TELEPHONE,
      avant: `try { localStorage.setItem("sereo:colorScheme", ${JSON.stringify(theme)}); } catch { /* ignore */ }`
    });
    await expect(page.locator("#stockList .stk-ligne").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.colorScheme), "prealable : le theme").toBe(theme);
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    const lignes = await page.locator("#stockList .stk-ligne").count();
    expect(await page.locator("#stockList .stk-ligne svg").count(), `des <svg> dans les ${lignes} lignes du Stock`).toBe(0);
    // Les boutons des lignes portent bien le trace (le masque du pseudo-element).
    const masques = await page.evaluate(() => [...document.querySelectorAll("#stockList .stk-ligne .stk-pas")]
      .filter(b => /data:image\/svg\+xml/.test(getComputedStyle(b, "::before").maskImage || getComputedStyle(b, "::before").webkitMaskImage || "")).length);
    expect(masques, "des boutons des lignes sans leur trace").toBe(lignes * 2);
    // La comparaison se fait sur un banc FIGE, dans l'ecran (memes regles
    // `#stock .stk-pas`), hors de la liste : un rendu de la liste entre deux
    // captures (sous charge) ne peut rien y changer. Trois boutons par trace :
    // celui d'aujourd'hui, l'ancien (<svg> d'avant, pseudo-element eteint) et
    // un vide (temoin : la comparaison distingue).
    await page.evaluate(anciens => {
      const banc = document.createElement("div");
      banc.id = "bancTraces";
      banc.style.cssText = "position:fixed;left:8px;top:140px;z-index:2147483647;display:flex;gap:12px;padding:12px;background:var(--v8-surface, #fff)";
      banc.innerHTML = Object.entries(anciens).map(([nom, svg]) => {
        const classe = `stk-pas${nom === "plus" ? " stk-pas--plus" : ""}`;
        return `<button type="button" class="${classe}" data-trace="${nom}-nouveau"></button>`
          + `<button type="button" class="${classe} trace-eteinte" data-trace="${nom}-ancien">${svg}</button>`
          + `<button type="button" class="${classe} trace-eteinte" data-trace="${nom}-vide"></button>`;
      }).join("");
      document.getElementById("stock").append(banc);
    }, ANCIEN);
    await page.addStyleTag({ content: "#stock .stk-pas.trace-eteinte::before { display: none !important; } #stock .stk-pas.trace-eteinte svg { width: 16px; height: 16px; }" });
    for (const nom of ["moins", "plus"]) {
      const capture = quoi => page.locator(`#bancTraces [data-trace="${nom}-${quoi}"]`).screenshot();
      const nouveau = await capture("nouveau");
      const ancien = await capture("ancien");
      const vide = await capture("vide");
      const ecart = await pixelsDifferents(page, nouveau, ancien);
      const temoin = await pixelsDifferents(page, vide, ancien);
      console.log(`[stock ${theme}] « ${nom} » : ${ecart} pixel(s) differents du <svg> d'avant (bouton vide : ${temoin})`);
      expect(temoin, `temoin : le bouton vide ne differe pas de l'ancien (« ${nom} »)`).toBeGreaterThan(10);
      expect(ecart, `« ${nom} » ne se dessine pas comme le <svg> d'avant`).toBeLessThanOrEqual(2);
    }
    expect(erreurs).toEqual([]);
    await ctx.close();
  });
}

// --- 14. Les tris de l'arrivee sur le Stock : un comparateur, pas un par paire

test("Stock au téléphone : l'arrivée trie « À recommander » et la liste sans construire un comparateur par comparaison (aucun localeCompare)", async ({ browser }) => {
  // Prealable : trois produits a recommander -- deux seuils au-dessus du stock,
  // et les gants a zero -- pour que le tri compare vraiment.
  for (const id of ["st-CH-L", "st-ALE"]) {
    const r = await fetch(`${srv.base}/api/stock/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alertThreshold: 500 }) });
    expect(r.status, `seuil de ${id}`).toBe(200);
  }
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", { vue: TELEPHONE });
  await page.evaluate(() => {
    const c = window.__comparaisons = { actif: false, n: 0 };
    const f = String.prototype.localeCompare;
    String.prototype.localeCompare = function (...a) { if (c.actif) c.n++; return f.apply(this, a); };
  });
  // Temoin : l'instrument compte.
  expect(await page.evaluate(() => { const c = window.__comparaisons; c.actif = true; "a".localeCompare("b", "fr"); c.actif = false; const n = c.n; c.n = 0; return n; })).toBe(1);
  await page.evaluate(() => new Promise(r => {
    addEventListener("hashchange", () => { window.__comparaisons.actif = false; r(); }, { once: true });
    window.__comparaisons.actif = true;
    location.hash = "#stock";
  }));
  await expect(page.locator("#stkRecoListe .stk-reco-ligne"), "prealable : trois produits a recommander").toHaveCount(3);
  expect(await page.locator("#stockList .stk-ligne").count(), "prealable : la liste").toBeGreaterThan(2);
  expect(await page.evaluate(() => window.__comparaisons.n), "localeCompare pendant l'arrivee sur le Stock").toBe(0);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 15 a 18. Relecture adverse du 26/09 -------------------------------------

/** Rouvre l'application sur `ecran` dans le MEME onglet (sessionStorage garde). */
async function rouvrir(page, ecran) {
  await page.goto(srv.base + "/healthz");
  await page.goto(`${srv.base}/#${ecran}`);
  await aJour(page);
}

// 15. Session expiree pendant « Valider » : la commande part en file (H2),
// mais son brouillon revenait apres la reconnexion, presente comme une saisie
// a terminer ; la moindre retouche changeait la saisie, donc la cle, et une
// seconde commande partait.
test("session expirée pendant « Valider » : la commande attend dans la file, son brouillon part ; après la reconnexion, UNE commande et un écran vide", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "journee");
  const cles = [];
  let refuser = true;
  await page.route("**/api/customer-orders", async route => {
    cles.push(route.request().headers()["x-sereo-geste"]);
    if (refuser) {
      refuser = false;
      // Session expiree : le serveur refuse AVANT d'appliquer (requireAccessAuth
      // passe avant gesteIdempotent, server.js).
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Connexion requise" }) });
      return;
    }
    await route.continue();
  });
  const avant = await nbCommandes();
  await preparerCommande(page, "Essai Session Expiree");
  // Le serveur seme n'a pas d'authentification : /login renvoie aussitot vers
  // `next` -- la reconnexion, sans formulaire. On guette donc la REQUETE.
  await Promise.all([
    page.waitForRequest(r => new URL(r.url()).pathname === "/login", { timeout: 15000 }),
    page.locator("#customerValider").click()
  ]);
  await rouvrir(page, "commande-client");
  await expect.poll(async () => (await nbCommandes()) - avant, { timeout: 30000 }).toBe(1);
  await expect.poll(() => lireFile(page), { timeout: 15000 }).toEqual([]);
  expect(new Set(cles).size, "le renvoi de la file porte la cle du premier envoi").toBe(1);
  await expect(page.locator("#commande-client")).toHaveClass(/active/);
  const vus = await toasts(page);
  await expect(page.locator("#customerCartCount"), `la commande deja partie revient comme une saisie a terminer (${vus.join(" / ")})`).toHaveText("0 produit");
  await expect(page.locator(NOM)).toHaveValue("");
  expect(vus.some(t => /reprise/.test(t)), vus.join(" / ")).toBe(false);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// 16. Le brouillon d'un compte ne revient pas a un autre, sur le meme onglet
// (telephone partage : fin de session, puis un autre se connecte).
test("fin de session, puis un AUTRE compte sur le même onglet : le brouillon de commande ne lui revient pas ; le MÊME compte le retrouve (témoin)", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "journee");
  await preparerCommande(page, "Saisie du compte A");
  await expect(page.locator("#customerCartCount")).toHaveText("1 produit");
  // Temoin : le meme compte (« dev », serveur sans authentification) la retrouve.
  await rouvrir(page, "commande-client");
  await expect(page.locator("#customerCartCount"), "temoin : le meme compte ne retrouve pas sa saisie").toHaveText("1 produit");
  await expect(page.locator(NOM)).toHaveValue("Saisie du compte A");
  // Un AUTRE compte ouvre l'application dans cet onglet.
  await page.route("**/api/me", async route => {
    const reponse = await route.fetch();
    const moi = await reponse.json();
    await route.fulfill({ response: reponse, json: { ...moi, identifiant: "compte-b" } });
  });
  await rouvrir(page, "commande-client");
  await expect(page.locator("#sidebarIdentifiant"), "prealable : c'est bien un autre compte").toHaveText("compte-b");
  await page.waitForTimeout(500);
  await expect(page.locator("#customerCartCount"), "le compte B herite de la saisie du compte A").toHaveText("0 produit");
  await expect(page.locator(NOM)).toHaveValue("");
  expect(await page.evaluate(() => sessionStorage.getItem("sereo-brouillon-commande")), "le brouillon de A reste dans l'onglet").toBeNull();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// 17. Abonnement + nouvelle fiche, issue inconnue : le serveur a cree la fiche,
// la reponse s'est perdue. L'ecran disait « Pas de reseau », et le nouvel
// essai, sous une cle neuve, creait une seconde fiche (sans telephone ni code
// postal, findDuplicateClient ne la reconnait pas).
async function saisirNouvelleFiche(page, fiche) {
  await ouvrirCreationAbonnement(page);
  await page.locator('[data-op="sub-nouveau-client"]').click();
  await page.fill("#subLastName", fiche.nom);
  await page.fill("#subAddress", fiche.rue);
  await page.fill("#subCity", fiche.ville);
  await ajouterProduitAbonnement(page);
}

async function fichesEtAbonnements(nom) {
  const fiches = (await lire("/api/crm/clients")).filter(c => c.nom === nom);
  const abonnements = (await lire("/api/subscriptions")).items;
  return { fiches: fiches.length, abonnements: abonnements.filter(a => fiches.some(f => String(f.id) === String(a.clientId))).length };
}

test("abonnement + nouvelle fiche, la réponse se perd (la fiche EST créée) : l'écran ne dit pas « Pas de réseau » ; réessayer ne crée pas de seconde fiche, l'abonnement va sur celle qui existe", async ({ browser }) => {
  const FICHE = { nom: "Reponseperdue", rue: "2 rue de l'Essai", ville: "Besançon" };
  const { ctx, page, erreurs } = await ouvrir(browser, "abonnements");
  const cles = [];
  let perdre = true;
  await page.route("**/api/crm/clients", async route => {
    if (route.request().method() !== "POST") return route.continue();
    cles.push(route.request().headers()["x-sereo-geste"]);
    if (perdre) {
      perdre = false;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await saisirNouvelleFiche(page, FICHE);
  await page.locator("#subSave").click();
  await expect(page.locator("#subError")).not.toHaveText("");
  expect(await fichesEtAbonnements(FICHE.nom), "prealable : la fiche est creee, sans abonnement").toEqual({ fiches: 1, abonnements: 0 });
  await expect(page.locator("#subError"), "le serveur a pu creer la fiche : « Pas de réseau » est faux").not.toContainText("Pas de réseau");
  // Le geste naturel : reessayer.
  await page.locator("#subSave").click();
  await expect(page.locator("#subscriptionDialog")).toBeHidden();
  expect(cles.length, "prealable : deux envois").toBe(2);
  expect(cles[1], "le nouvel essai a tire une autre cle").toBe(cles[0]);
  expect(await fichesEtAbonnements(FICHE.nom), "une seconde fiche, ou l'abonnement ailleurs").toEqual({ fiches: 1, abonnements: 1 });
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("abonnement + nouvelle fiche, en-têtes reçus mais corps coupé (la fiche EST créée) : l'abonnement va sur cette fiche, sans seconde fiche", async ({ browser }) => {
  const FICHE = { nom: "Corpscoupe", rue: "3 rue de l'Essai", ville: "Besançon" };
  const { ctx, page, erreurs } = await ouvrir(browser, "abonnements", {
    avant: () => {
      const vrai = window.fetch;
      let coupe = false;
      window.fetch = async (url, options = {}) => {
        const reponse = await vrai(url, options);
        if (!coupe && /\/api\/crm\/clients$/.test(String(url)) && String(options.method || "").toUpperCase() === "POST") {
          coupe = true;
          // Les en-tetes (201) sont arrives ; le corps casse en route.
          return new Response(new ReadableStream({ start(c) { c.error(new TypeError("network error")); } }), { status: reponse.status, headers: reponse.headers });
        }
        return reponse;
      };
    }
  });
  await saisirNouvelleFiche(page, FICHE);
  await page.locator("#subSave").click();
  await expect.poll(async () => (await fichesEtAbonnements(FICHE.nom)).fiches, { timeout: 10000 }).toBe(1);
  // La fiche est creee, et la page le sait (en-tetes 2xx) : UN appui suffit,
  // sans message brut ni nouvel essai.
  await page.waitForTimeout(1500);
  const message = await page.locator("#subError").textContent();
  await expect(page.locator("#subscriptionDialog"), `la fenetre reste ouverte sur : ${message}`).toBeHidden();
  expect(await fichesEtAbonnements(FICHE.nom), "une seconde fiche, ou l'abonnement ailleurs").toEqual({ fiches: 1, abonnements: 1 });
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// La cle stable a un revers : un REFUS dont la reponse s'est perdue revient,
// au nouvel essai, en « deja fait » ({ rejoue: true }, 409, sans message).
test("abonnement + nouvelle fiche qui existe déjà, le refus (409) se perd : au nouvel essai, le refus rejoué nomme le doublon (pas « Erreur HTTP 409 »)", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "abonnements");
  const statuts = [];
  const rejoues = [];
  let perdre = true;
  await page.route("**/api/crm/clients", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const reponse = await route.fetch();
    statuts.push(reponse.status());
    rejoues.push(reponse.headers()["x-sereo-geste-rejoue"] || "");
    if (perdre) {
      perdre = false;
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({ response: reponse });
  });
  // Meme nom et meme code postal qu'une fiche du jeu seme : findDuplicateClient refuse.
  await saisirNouvelleFiche(page, { nom: "Clinique Vétérinaire du Doubs", rue: "1 place du Marché", ville: "Besançon" });
  await page.fill("#subPostal", "25000");
  await page.locator("#subSave").click();
  await expect(page.locator("#subError")).toContainText("Pas de réponse du serveur");
  await page.locator("#subSave").click();
  await expect.poll(() => statuts.length, { timeout: 10000 }).toBe(2);
  expect(statuts, "prealable : le serveur refuse le doublon").toEqual([409, 409]);
  expect(rejoues[1], "prealable : le second refus est rejoue (meme cle)").toBe("1");
  await expect(page.locator("#subError")).toContainText("Une fiche existe déjà");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Un refus est une issue CONNUE : la cle part, le nouvel essai est un nouveau
// geste (sinon le serveur rejouerait le refus, sans son message).
// (Un refus que seul le serveur fait : le garde de la page arrete deja un
// telephone invalide, rien ne part.)
test("abonnement + nouvelle fiche refusée (doublon, 409) : revalider sans rien changer est un nouveau geste, et redit le refus", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "abonnements");
  const cles = [];
  const rejoues = [];
  await page.route("**/api/crm/clients", async route => {
    if (route.request().method() !== "POST") return route.continue();
    cles.push(route.request().headers()["x-sereo-geste"]);
    const reponse = await route.fetch();
    rejoues.push(reponse.headers()["x-sereo-geste-rejoue"] || "");
    await route.fulfill({ response: reponse });
  });
  await saisirNouvelleFiche(page, { nom: "Clinique Vétérinaire du Doubs", rue: "1 place du Marché", ville: "Besançon" });
  await page.fill("#subPostal", "25000");
  await page.locator("#subSave").click();
  await expect.poll(() => cles.length, { timeout: 10000, message: "prealable : la fiche part au serveur" }).toBe(1);
  await expect(page.locator("#subError")).toContainText("Une fiche existe déjà");
  await page.evaluate(() => { document.getElementById("subError").textContent = ""; });
  await page.locator("#subSave").click();
  await expect.poll(() => rejoues.length, { timeout: 10000 }).toBe(2);
  expect(cles[1], "apres un refus, le nouvel essai garde la cle : le serveur rejoue le refus").not.toBe(cles[0]);
  expect(rejoues, "le refus est rejoue au lieu d'etre redit").toEqual(["", ""]);
  await expect(page.locator("#subError")).toContainText("Une fiche existe déjà");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// 18. Revalider apres une issue inconnue : le serveur rend « deja fait »
// ({ rejoue: true }, sans la commande). L'ecran annoncait « validée : elle est
// à préparer », sans numero -- meme pour une commande bloquee faute de stock.
test("revalider après une issue inconnue : le rejeu ne promet pas « à préparer » ; l'écran dit que la commande avait déjà été reçue", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", {
    avant: () => { Object.defineProperty(window, "indexedDB", { get() { return undefined; }, configurable: true }); }
  });
  let premier = true;
  const rejoues = [];
  await page.route("**/api/customer-orders", async route => {
    if (premier) {
      premier = false;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    const reponse = await route.fetch();
    rejoues.push(reponse.headers()["x-sereo-geste-rejoue"] || "");
    await route.fulfill({ response: reponse });
  });
  const avant = await nbCommandes();
  await preparerCommande(page, "Essai Rejeu");
  await page.locator("#customerValider").click();
  await expect.poll(async () => (await nbCommandes()) - avant, { timeout: 10000 }).toBe(1);
  await expect(page.locator("#customerValider")).toBeEnabled();
  await page.evaluate(() => document.querySelectorAll("#toastRegion .toast").forEach(t => t.remove()));
  await page.locator("#customerValider").click();
  await expect.poll(() => rejoues.length, { timeout: 10000 }).toBe(1);
  expect(rejoues[0], "prealable : le serveur a rendu « deja fait »").toBe("1");
  await expect.poll(async () => (await toasts(page)).length, { timeout: 10000 }).toBeGreaterThan(0);
  const vus = await toasts(page);
  expect(vus.some(t => /à préparer/.test(t)), vus.join(" / ")).toBe(false);
  expect(vus.some(t => /déjà été reçue/.test(t)), vus.join(" / ")).toBe(true);
  expect((await nbCommandes()) - avant).toBe(1);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

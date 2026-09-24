// PARCOURS SIMPLIFIES -- audit du 24/09, decisions de Thomas, AU BUREAU.
//
// Chaque cas refait un parcours mesure par l'audit, avec son nombre de gestes :
//   1. la fiche client : « Nouvelle commande » (client deja choisi), « Rappel »
//      (client deja choisi), son chiffre d'affaires livre et ses rappels ;
//   2. la nouvelle commande : la recherche du client de l'abonnement, les
//      coordonnees repliees, « Valider » sous le total ;
//   3. l'abonnement : « Confirmer » sur l'echeance, sans changer de page ;
//      « Creer les N commandes dues » ;
//   4. la preparation : la fenetre reste ouverte entre « Passer en
//      preparation » et « Preparation terminee » ; UN compte « a preparer »,
//      sur l'entree Preparation ;
//   5. « Client absent » presélectionne « Personne sur place » ; « Probleme »
//      ne propose plus les deux motifs d'absence ;
//   6. l'ecran Exports n'existe plus ; un export Excel depuis Commandes ;
//   7. une commande sur un produit en rupture est acceptee en « Bloquee » ;
//   8. un seul vocabulaire au bureau.
//
// Le serveur est seme (serveur-seme.js) : les cas ECRIVENT, ils vont en serie
// et chacun lit l'etat par l'API plutot que de le supposer.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

const BUREAU = { width: 1440, height: 900 };

test.describe.configure({ mode: "serial" });

function seme() {
  const s = jeuDeDonnees();
  const modele = s.commandes.find(o => o.id === "o-3");
  // La fiche des Tilleuls : une commande livree, une annulee (le chiffre
  // d'affaires ne doit compter que la premiere), et un rappel a faire.
  s.commandes.push({ ...structuredClone(modele), id: "o-tl", numero: "CMD-2026-801", status: "livre", deliveredAt: `${AUJOURDHUI}T08:00:00Z`, routeId: null });
  s.commandes.push({ ...structuredClone(modele), id: "o-ta", numero: "CMD-2026-802", status: "annulee", routeId: null });
  s.relances = [{ id: "rel-1", clientId: "c-tilleuls", datePrevue: AUJOURDHUI, motif: "Proposer les alèses", status: "a_faire", type: "crm" }];
  // Deux abonnements actifs dont l'echeance tombe aujourd'hui : « dues ».
  s.subscriptions.push({ ...structuredClone(s.subscriptions[0]), id: "sub-4", clientId: "c-veto", reminderDays: 1 });
  // Relecture adverse du lot. Une fiche SANS commande, pour « Modifier les
  // coordonnees » : son demenagement ne deplace aucune commande des autres cas.
  s.clients.push({ id: "c-martin", nom: "Cabinet Martin", rue: "4 rue Pasteur", ville: "Dole", codePostal: "39100",
    telephone: "0384000000", lat: 47.094, lng: 5.492, crmStatus: "client_actif" });
  // Une commande « preparation terminee » (admise par PATCH status ; le badge
  // dit « Prete »), EN TETE : la liste « A livrer » du tableau de bord montre
  // les cinq premieres.
  const terminee = { ...structuredClone(s.commandes.find(o => o.id === "o-2")), id: "o-pt", numero: "CMD-2026-803", status: "preparation_terminee" };
  delete terminee.deliveredAt;
  s.commandes.unshift(terminee);
  return s;
}

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3528, seed: seme() }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, ecran, { viewport = BUREAU } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(`${srv.base}/#${ecran}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}
const api = async (chemin) => (await fetch(srv.base + chemin)).json();
const euros = n => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

// --- 1. La fiche client ----------------------------------------------------------

test("1 — la fiche client montre son chiffre d'affaires livre et ses rappels", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "crm");
  await page.locator("#crmList .cli-ligne", { hasText: "Tilleuls" }).click();
  const fiche = page.locator("#cliFiche");
  const vue = (await api("/api/crm/clients")).find(c => c.id === "c-tilleuls");
  expect(vue.totalRevenue, "le serveur ne compte que la commande livree").toBe(51);
  await expect(fiche.locator(".cli-ca")).toContainText(euros(vue.totalRevenue));
  await expect(fiche.locator(".cli-ca")).toContainText("1 commande livrée");
  await expect(fiche.locator(".cli-rappels-client")).toContainText("Proposer les alèses");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("1 — « Nouvelle commande » ouvre la commande avec CE client choisi", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "crm");
  await page.locator("#crmList .cli-ligne", { hasText: "Tilleuls" }).click();
  await page.locator('#cliFiche [data-action="cli-nouvelle-commande"]').click();
  await expect(page.locator("#commande-client")).toHaveClass(/active/);
  await expect(page.locator("#customerClientNom")).toHaveText("EHPAD Les Tilleuls du Val de Loue");
  expect(await page.locator("#customerClientId").inputValue()).toBe("c-tilleuls");
  // Les coordonnees d'un client existant sont repliees.
  expect(await page.locator("#customerCoordonnees").evaluate(d => d.open)).toBe(false);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("1 — « Rappel » ouvre le rappel avec CE client choisi, la date sous le curseur", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "crm");
  await page.locator("#crmList .cli-ligne", { hasText: "Tilleuls" }).click();
  await page.locator('#cliFiche [data-action="cli-rappel"]').click();
  await expect(page.locator("#relances")).toHaveClass(/active/);
  expect(await page.locator("#relanceClientSelect").inputValue()).toBe("c-tilleuls");
  expect(await page.evaluate(() => document.activeElement?.name)).toBe("datePrevue");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 2. La nouvelle commande -----------------------------------------------------

test("2 — le client se cherche comme dans l'abonnement, « Valider » est sous le total", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "commande-client");
  await page.locator("#customerClientSearch").fill("pharmacie");
  const cartes = page.locator('#customerClientResults [data-action="cc-client"]');
  await expect(cartes).toHaveCount(1);
  await cartes.first().click();
  await expect(page.locator("#customerClientNom")).toHaveText("Pharmacie Centrale de la Gare");
  expect(await page.locator("#customerCoordonnees").evaluate(d => d.open), "coordonnees repliees").toBe(false);
  // « Changer » rend la recherche.
  await page.locator('[data-action="cc-client-changer"]').click();
  await expect(page.locator("#customerClientSearch")).toBeVisible();
  await page.locator("#customerClientSearch").fill("pharmacie");
  await page.locator('#customerClientResults [data-action="cc-client"]').first().click();

  const geo = await page.evaluate(() => {
    const boutons = [...document.querySelectorAll('#commande-client button[type="submit"], button[type="submit"][form="customerOrderForm"]')]
      .filter(b => b.checkVisibility() && !b.closest("#customerCartBar"));
    const total = document.getElementById("customerCartTotal").getBoundingClientRect();
    const catalogue = document.getElementById("customerCatalog").getBoundingClientRect();
    return { n: boutons.length, dansPanier: boutons.every(b => !!b.closest(".customer-cart-panel")),
      haut: boutons[0]?.getBoundingClientRect().top + scrollY, totalBas: total.bottom + scrollY, catalogueHaut: catalogue.top + scrollY };
  });
  expect(geo.n, "un seul « Valider » dans la page").toBe(1);
  expect(geo.dansPanier, "« Valider » est dans le panier").toBe(true);
  expect(geo.haut, "« Valider » sous le total").toBeGreaterThanOrEqual(geo.totalBas);

  // Valider envoie CE client.
  await page.locator('[data-customer-product="st-CH-L"][data-customer-delta="1"]').click();
  const envoi = page.waitForRequest(r => r.url().endsWith("/api/customer-orders") && r.method() === "POST");
  await page.locator(".customer-cart-panel button[type='submit']").click();
  const corps = JSON.parse((await envoi).postData());
  expect(corps.clientId).toBe("c-pharma");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("2 — une nouvelle fiche aux coordonnees repliees : « Valider » les deplie sur le nom manquant", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "commande-client");
  const coordonnees = page.locator("#customerCoordonnees");
  expect(await coordonnees.evaluate(d => d.open), "sans client, les coordonnees sont ouvertes").toBe(true);
  await page.locator("#customerCoordonneesTitre").click();
  expect(await coordonnees.evaluate(d => d.open)).toBe(false);
  await page.locator('[data-customer-product="st-ALE"][data-customer-delta="1"]').click();
  await page.locator("#customerValider").click();
  // Le champ « Nom » manquant ne pouvait pas dire son message, replie.
  await expect.poll(() => coordonnees.evaluate(d => d.open)).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.name)).toBe("nom");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Relecture adverse : reset() ne vidait pas le client choisi. Sur un champ
// cache, ecrire .value ecrit l'attribut value -- celui auquel reset() revient.
// La commande suivante partait au nom du client d'avant.
test("2 — apres « Valider », la commande suivante repart sans le client d'avant", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "commande-client");
  await page.locator("#customerClientSearch").fill("pharmacie");
  await page.locator('#customerClientResults [data-action="cc-client"]').first().click();
  await page.locator('[data-customer-product="st-ALE"][data-customer-delta="1"]').click();
  const premiere = page.waitForResponse(r => r.url().endsWith("/api/customer-orders") && r.request().method() === "POST");
  await page.locator("#customerValider").click();
  expect((await premiere).status()).toBe(201);
  await expect(page.locator("#commandes")).toHaveClass(/active/);

  // Chez le client suivant : « Nouvelle commande » depuis l'en-tete de Commandes.
  await page.locator("#enteteActions .cmd-nouvelle").click();
  await expect(page.locator("#commande-client")).toHaveClass(/active/);
  expect(await page.locator("#customerClientId").inputValue(), "le client d'avant est parti").toBe("");
  await expect(page.locator("#customerClientChoisi")).toBeHidden();
  await expect(page.locator("#customerClientSearch")).toBeVisible();
  expect(await page.locator("#customerCoordonnees").evaluate(d => d.open), "une nouvelle fiche : coordonnees ouvertes").toBe(true);

  await page.locator('#customerCoordonnees input[name="nom"]').fill("Maison de santé des Rives");
  await page.locator('[data-customer-product="st-ALE"][data-customer-delta="1"]').click();
  const seconde = page.waitForResponse(r => r.url().endsWith("/api/customer-orders") && r.request().method() === "POST");
  await page.locator("#customerValider").click();
  const reponse = await seconde;
  expect(JSON.parse(reponse.request().postData()).clientId || "", "aucun client choisi n'est envoye").toBe("");
  const creee = await reponse.json();
  expect(creee.clientName).toBe("Maison de santé des Rives");
  expect(creee.clientId).not.toBe("c-pharma");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Relecture adverse : « Modifier les coordonnees » promettait une modification
// que le serveur jetait (un client existant est repris tel quel). Elles vont
// sur la fiche, par les routes de la fiche, avant la commande.
test("2 — « Modifier les coordonnees » d'un client existant : la commande et la fiche suivent", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "commande-client");
  await page.locator("#customerClientSearch").fill("martin");
  await page.locator('#customerClientResults [data-action="cc-client"]').first().click();
  await expect(page.locator("#customerClientNom")).toHaveText("Cabinet Martin");
  // Pendant ce temps, un autre poste complete la fiche, et la page se recharge :
  // seul ce que l'utilisateur change ici doit repartir, pas l'ancien prenom.
  await fetch(`${srv.base}/api/crm/clients/c-martin`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prenom: "Paul" })
  });
  await page.locator("#refreshButton").click();
  await page.waitForLoadState("networkidle");
  await page.locator("#customerCoordonneesTitre").click();
  await page.locator('#customerCoordonnees input[name="adresse"]').fill("18 avenue de Lahr");
  await page.locator('#customerCoordonnees input[name="telephone"]').fill("0384999999");
  await page.locator('#customerCoordonnees input[name="email"]').fill("accueil@cabinet-martin.test");
  await page.locator('[data-customer-product="st-ALE"][data-customer-delta="1"]').click();
  const envoi = page.waitForResponse(r => r.url().endsWith("/api/customer-orders") && r.request().method() === "POST");
  await page.locator("#customerValider").click();
  const creee = await (await envoi).json();
  expect(creee.clientId).toBe("c-martin");
  expect(creee.address, "la commande part a la nouvelle adresse").toBe("18 avenue de Lahr");
  expect(creee.phone).toBe("0384999999");
  const fiche = (await api("/api/crm/clients")).find(c => c.id === "c-martin");
  expect(fiche.rue, "la fiche suit").toBe("18 avenue de Lahr");
  expect(fiche.telephone).toBe("0384999999");
  expect(fiche.email).toBe("accueil@cabinet-martin.test");
  // Temoin : ce qui n'a pas change ne bouge pas -- ni ce qu'un autre poste a change.
  expect(fiche.prenom, "le changement fait ailleurs n'est pas ecrase").toBe("Paul");
  expect(fiche.nom).toBe("Cabinet Martin");
  expect(fiche.ville).toBe("Dole");
  expect(fiche.codePostal).toBe("39100");
  // Integration du 24/09 : le message dit le numero (lot pieges), puis la fiche.
  await expect(page.locator(".toast", { hasText: `${creee.numero} validée` })).toContainText("fiche du client");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

/** La file hors ligne, lue dans le vrai indexedDB de la page, dans l'ordre de depot. */
function lireFile(page) {
  return page.evaluate(() => new Promise(resolve => {
    const d = indexedDB.open("sereo-file-attente", 1);
    d.onerror = () => resolve([]);
    d.onsuccess = () => {
      const db = d.result;
      if (!db.objectStoreNames.contains("ecritures")) { db.close(); resolve([]); return; }
      const r = db.transaction("ecritures", "readonly").objectStore("ecritures").getAll();
      r.onsuccess = () => { db.close(); resolve(r.result.sort((a, b) => String(a.depose).localeCompare(String(b.depose)))); };
      r.onerror = () => { db.close(); resolve([]); };
    };
  }));
}

// La file hors ligne est une garantie : une fiche corrigee hors ligne ne doit
// pas retenir la commande. Les deux attendent, la fiche d'abord.
test("2 — hors ligne, la fiche corrigee PUIS la commande attendent dans la file, et partent", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "commande-client");
  expect(await lireFile(page), "prealable : la file est vide").toEqual([]);
  await page.locator("#customerClientSearch").fill("martin");
  await page.locator('#customerClientResults [data-action="cc-client"]').first().click();
  await page.locator("#customerCoordonneesTitre").click();
  await page.locator('#customerCoordonnees input[name="adresse"]').fill("7 rue de Besançon");
  await page.locator('[data-customer-product="st-ALE"][data-customer-delta="1"]').click();

  await ctx.setOffline(true);
  await page.locator("#customerValider").click();
  await expect(page.locator(".toast", { hasText: "sera envoyé à la reconnexion" }).first()).toBeVisible();
  const file = await lireFile(page);
  expect(file.map(e => `${e.methode} ${new URL(e.url, srv.base).pathname}`), "la fiche, puis la commande")
    .toEqual(["PATCH /api/clients/c-martin", "POST /api/customer-orders"]);

  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await lireFile(page)).length, { timeout: 15000 }).toBe(0);
  const commande = (await api("/api/orders")).find(o => o.clientId === "c-martin" && o.address === "7 rue de Besançon");
  expect(commande, "la commande rejouee part a la nouvelle adresse").toBeTruthy();
  // Une page hors ligne journalise ses fetch echoues : seules comptent les erreurs de script.
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 7. Une commande sur un produit en rupture ------------------------------------

test("7 — un produit en rupture entre au panier, la commande est acceptee en « Bloquee »", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "commande-client");
  await page.locator("#customerClientSearch").fill("dupont");
  await page.locator('#customerClientResults [data-action="cc-client"]').first().click();
  await page.locator('[data-customer-product="st-GANTS"][data-customer-delta="1"]').click();
  await expect(page.locator("#customerCart")).toContainText("Gants nitrile");
  const reponse = page.waitForResponse(r => r.url().endsWith("/api/customer-orders") && r.request().method() === "POST");
  await page.locator(".customer-cart-panel button[type='submit']").click();
  const recue = await reponse;
  expect(recue.status()).toBe(201);
  const corps = await recue.json();
  expect(corps.bloquee).toBe(true);
  await expect(page.locator(".toast", { hasText: corps.numero })).toContainText("bloquée");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 3. L'abonnement ---------------------------------------------------------------

test("3 — « Creer les N commandes dues » cree les commandes des echeances arrivees", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "abonnements");
  const dues = (await api("/api/subscriptions")).occurrences.filter(o => o.due && !o.orderId);
  expect(dues.length, "le seme doit avoir au moins deux echeances dues").toBeGreaterThanOrEqual(2);
  const bouton = page.locator('[data-op="generate-dues"]');
  await expect(bouton).toHaveText(`Créer les ${dues.length} commandes dues`);
  await bouton.click();
  await expect.poll(async () => (await api("/api/subscriptions")).occurrences.filter(o => o.due && !o.orderId).length).toBe(0);
  await expect(bouton).toBeHidden();
  await expect(page.locator("#abonnements")).toHaveClass(/active/);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("3 — « Confirmer » sur l'echeance : la commande passe « A preparer » sans changer de page", async ({ browser }) => {
  // Lance seul (--grep), le cas cree lui-meme la commande de l'echeance.
  const avant = (await api("/api/subscriptions")).occurrences.find(o => o.subscriptionId === "sub-1");
  if (!avant.orderId) {
    await fetch(`${srv.base}/api/subscriptions/sub-1/orders`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: avant.date })
    });
  }
  const { ctx, page, erreurs } = await ouvrir(browser, "abonnements");
  const occ = (await api("/api/subscriptions")).occurrences.find(o => o.subscriptionId === "sub-1" && o.orderId);
  expect(occ.orderStatus).toBe("planifiee");
  const confirmer = page.locator(`#subscriptionAgenda [data-op="confirm-sub-order"][data-order-id="${occ.orderId}"]`);
  await expect(confirmer).toHaveText("Confirmer");
  // Plus de lien « A confirmer » qui menait a une autre page.
  await expect(page.locator('#subscriptionAgenda [data-target-tab="commandes-planifiees"]')).toHaveCount(0);
  await confirmer.click();
  await expect.poll(async () => (await api("/api/orders")).find(o => o.id === occ.orderId).status).toBe("stock_a_verifier");
  await expect(page.locator("#abonnements")).toHaveClass(/active/);
  await expect(page.locator("#subscriptionAgenda .abo-echeance", { hasText: "EHPAD Les Tilleuls" }).first()).toContainText("À préparer");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 4. La preparation ---------------------------------------------------------------

test("4 — un seul compte « a preparer » : sur l'entree Preparation, la tuile et l'ecran", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "journee");
  const restantes = (await api("/api/orders")).filter(o => ["importe", "stock_a_verifier", "en_preparation"].includes(o.status)).length;
  const r = await page.evaluate(() => {
    const pastille = document.querySelector('.nav-badge[data-badge="preparation"]');
    return {
      preparation: { hidden: pastille.hidden, texte: pastille.textContent },
      commandes: document.querySelector('.nav-badge[data-badge="commandes"]').hidden,
      tuile: document.getElementById("dashboardPreparingCount").textContent.trim(),
      titreTuile: document.getElementById("dashboardPreparingCount").closest(".tb-tuile").querySelector(".tb-tuile-titre").textContent.trim()
    };
  });
  expect(r.preparation.hidden, "la pastille est sur Preparation").toBe(false);
  expect(r.preparation.texte).toBe(String(restantes));
  expect(r.commandes, "plus de pastille sur Commandes").toBe(true);
  expect(r.tuile).toBe(String(restantes));
  expect(r.titreTuile).toBe("À préparer");
  await page.locator("#nav-preparation").click();
  await expect(page.locator("#preparationStats")).toContainText(`${restantes} restante`);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("4 — la fenetre reste ouverte entre « Passer en preparation » et « Preparation terminee »", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "preparation");
  const ligne = page.locator("#preparationList .commande-ligne", { hasText: "Cabinet Infirmier" }).first();
  await ligne.locator(".commande-ligne-main").click();
  const dialogue = page.locator("#commandeDetailDialog");
  await expect(dialogue).toBeVisible();
  await dialogue.locator('[data-action="start-preparation"]').click();
  await expect(dialogue.locator('[data-action="finish-preparation"]')).toBeEnabled();
  expect(await dialogue.evaluate(d => d.open), "la fenetre ne se ferme plus").toBe(true);
  await expect(dialogue.locator('[data-action="start-preparation"]')).toBeDisabled();
  await dialogue.locator('[data-action="finish-preparation"]').click();
  await expect.poll(() => dialogue.evaluate(d => d.open)).toBe(false);
  const commande = (await api("/api/orders")).find(o => o.id === "o-10");
  expect(commande.status).toBe("pret_livraison");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 5. Les motifs de la tournee --------------------------------------------------------

test("5 — « Client absent » presélectionne « Personne sur place » : deux gestes", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "livreur");
  await page.locator("#markAbsentButton").click();
  const dialogue = page.locator("#motifProblemeDialog");
  await expect(dialogue).toBeVisible();
  await expect(dialogue.locator('[data-motif-cle="absent"]')).toHaveAttribute("aria-checked", "true");
  await dialogue.locator('[data-action="motif-annuler"]').click();
  await expect(dialogue).toBeHidden();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("5 — « Probleme » ne propose plus « Personne sur place » ni « Etablissement ferme »", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "livreur");
  await page.locator("#markProblemButton").click();
  const dialogue = page.locator("#motifProblemeDialog");
  await expect(dialogue).toBeVisible();
  const cles = await dialogue.locator("[data-motif-cle]").evaluateAll(els => els.map(e => e.dataset.motifCle));
  expect(cles).not.toContain("absent");
  expect(cles).not.toContain("ferme");
  expect(cles, "temoin : les motifs propres au probleme restent").toContain("adresse");
  // Rien n'est preselectionne pour un probleme : le livreur choisit.
  expect(await dialogue.locator('[aria-checked="true"]').count()).toBe(0);
  await dialogue.locator('[data-action="motif-annuler"]').click();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 6. Plus d'ecran Exports ---------------------------------------------------------

test("6 — l'ancienne adresse #exports mene a Commandes, sans pilule Exports", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "exports");
  await expect(page.locator("#commandes")).toHaveClass(/active/);
  expect(page.url()).toMatch(/#commandes$/);
  expect(await page.locator("#exports").count()).toBe(0);
  await page.locator("#nav-analyse").click();
  await expect(page.locator("#tab-exports")).toHaveCount(0);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("6 — Commandes exporte son filtre en Excel", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "commandes");
  const bouton = page.locator('#enteteActions [data-action="cmd-export"]');
  await expect(bouton).toHaveText("Exporter (Excel)");
  const envoi = page.waitForRequest(r => r.url().endsWith("/api/exports/commandes.xlsx") && r.method() === "POST");
  const [telechargement] = await Promise.all([page.waitForEvent("download"), bouton.click()]);
  expect(telechargement.suggestedFilename()).toMatch(/^sereo-commandes-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const ids = JSON.parse((await envoi).postData()).ids;
  const attendus = await page.evaluate(() => [...document.querySelectorAll("#cmdLignes .cmd-ligne")].map(l => l.dataset.cmdOuvrir));
  expect(attendus.length).toBeGreaterThan(0);
  // La page montre les 20 premieres ; l'export porte TOUTE la liste filtree, dans son ordre.
  expect(ids.slice(0, attendus.length), "l'export suit l'ordre de l'ecran").toEqual(attendus);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 8. Un seul vocabulaire au bureau ----------------------------------------------------

test("8 — au bureau, la Preparation dit « A preparer / En preparation / Prete / Bloquee », comme les badges", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "preparation");
  const mots = await page.locator("#preparationList .commande-ligne .pill").allTextContents();
  const permis = new Set(["À préparer", "En préparation", "Prête", "Bloquée"]);
  expect(mots.length).toBeGreaterThan(0);
  expect(mots.map(m => m.trim()).filter(m => !permis.has(m)), mots.join(", ")).toEqual([]);
  await page.locator("#nav-commandes").click();
  const badges = await page.locator("#cmdLignes .cmd-badge").allTextContents();
  expect(badges.length).toBeGreaterThan(0);
  const interdits = ["Importée", "Prêt livraison", "À vérifier", "Préparée"];
  expect(badges.filter(b => interdits.includes(b.trim())), badges.join(", ")).toEqual([]);
  const pilules = await page.locator("#cmdPilules [data-cmd-filtre]").allTextContents();
  expect(pilules).toContain("Prêtes");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Relecture adverse : la fenetre de la Preparation au bureau lisait le mot du
// STATUT (« A preparer ») sans regarder le stock ; sa ligne disait « Bloquee ».
test("8 — au bureau, la fenetre d'une commande bloquee dit « Bloquee », comme sa ligne", async ({ browser }) => {
  // Temoin : une commande qui peut se preparer (creee ici, le cas se lance seul).
  const temoin = await (await fetch(`${srv.base}/api/customer-orders`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "c-bellevue", client: { nom: "EHPAD Résidence Bellevue" }, products: [{ productId: "st-ALE", quantite: 1 }] })
  })).json();
  expect(temoin.bloquee).toBe(false);
  const { ctx, page, erreurs } = await ouvrir(browser, "preparation");
  const dialogue = page.locator("#commandeDetailDialog");

  const bloquee = page.locator("#preparationList .commande-ligne--bloquee", { hasText: "Clinique Vétérinaire" }).first();
  await expect(bloquee.locator(".pill")).toHaveText("Bloquée");
  await bloquee.locator(".commande-ligne-main").click();
  await expect(dialogue).toBeVisible();
  await expect(dialogue.locator(".item-header .pill")).toHaveText("Bloquée");
  await expect(dialogue.locator('[data-action="start-preparation"]')).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialogue).toBeHidden();

  await page.locator(`#preparationList [data-order-id="${temoin.id}"]`).click();
  await expect(dialogue).toBeVisible();
  await expect(dialogue.locator(".item-header .pill"), "temoin : preparable, elle reste « A preparer »").toHaveText("À préparer");
  await expect(dialogue.locator('[data-action="start-preparation"]')).toBeEnabled();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Relecture adverse : « preparation terminee » (badge « Prete ») etait rangee
// sous la pilule « A preparer » et n'etait plus comptee au tableau de bord.
test("8 — « preparation terminee » se range sous « Pretes », comme son badge, et compte au tableau de bord", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "commandes");
  const ids = () => page.locator("#cmdLignes .cmd-ligne").evaluateAll(ls => ls.map(l => l.dataset.cmdOuvrir));
  await page.locator('#cmdPilules [data-cmd-filtre="pret"]').click();
  expect(await ids()).toContain("o-pt");
  await expect(page.locator('#cmdLignes .cmd-ligne[data-cmd-ouvrir="o-pt"] .cmd-badge')).toHaveText("Prête");
  await page.locator('#cmdPilules [data-cmd-filtre="a-preparer"]').click();
  const aPreparer = await ids();
  expect(aPreparer.length, "temoin : la pilule « A preparer » a des lignes").toBeGreaterThan(0);
  expect(aPreparer).not.toContain("o-pt");

  await page.goto(`${srv.base}/#journee`);
  const livraison = (await api("/api/operations")).delivering;
  expect(livraison.map(o => o.id)).toContain("o-pt");
  await expect(page.locator("#dashboardDeliveringCount")).toHaveText(String(livraison.length));
  // Le mot de la ligne du tableau de bord : « Prete », pas la cle technique.
  const pastille = page.locator("#dashboardDelivering .commande-ligne", { hasText: "SSIAD" }).locator(".pill");
  await expect(pastille).toHaveText("Prête");
  // Et la couleur des pretes (le disque et la pastille), pas celle d'une commande a faire.
  await expect(pastille).toHaveClass(/pill-ok/);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Relecture adverse : l'ecran Rappels affichait la cle du statut (« reporte »)
// et des boutons sans accent (« Reporte », « Annule »).
test("8 — les Rappels disent « Fait · Reporté · Annulé », jamais la cle technique", async ({ browser }) => {
  await fetch(`${srv.base}/api/crm/relances`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "c-veto", datePrevue: AUJOURDHUI, motif: "Rappeler pour les gants", type: "crm" })
  });
  const { ctx, page, erreurs } = await ouvrir(browser, "relances");
  await page.locator('[data-relance-filter="all"]').click();
  const carte = page.locator("#relanceList article", { hasText: "Rappeler pour les gants" });
  await expect(carte.locator(".card-actions .button")).toHaveText(["Fait", "Reporté", "Annulé"]);
  await expect(carte.locator(".pill")).toHaveText("À faire");
  await carte.getByRole("button", { name: "Reporté", exact: true }).click();
  await expect(carte.locator(".pill")).toHaveText("Reporté");
  const rappel = (await api("/api/crm/relances")).find(r => r.motif === "Rappeler pour les gants");
  expect(rappel.status, "le geste enregistre la meme cle qu'avant").toBe("reporte");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("8 — les dates : un seul utilitaire, plus de « 24/09/2026 », de « jeu. 24/09 » ni de « 16:00 »", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "relances");
  const JOUR_COURT = /\b(lun|mar|mer|jeu|ven|sam|dim)\. \d{1,2} [a-zéû]+\.?/;
  // Les rappels : « jeu. 24 sept. » (la forme d'une echeance), plus « 24/09/2026 ».
  await page.locator('[data-relance-filter="all"]').click();
  const rappel = await page.locator("#relanceList article").first().innerText();
  expect(rappel).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  expect(rappel).toMatch(JOUR_COURT);
  // L'heure : « 16 h 00 », comme partout ailleurs (« Hors ligne depuis 16 h 00 »).
  await page.goto(`${srv.base}/#journee`);
  await expect(page.locator("#opUpdated")).toHaveText(/^Mis à jour à \d{1,2} h \d{2}$/);
  // Les commandes pretes de la Tournee : « jeu. 24 sept. », plus « jeu. 24/09 ».
  await page.goto(`${srv.base}/#livreur`);
  await page.waitForTimeout(600);
  const dates = await page.locator(".delivery-card .order-meta span:nth-child(2)").allTextContents();
  expect(dates.length, "le seme a des commandes pretes").toBeGreaterThan(0);
  for (const d of dates) {
    expect(d).not.toMatch(/\d{2}\/\d{2}/);
    if (d !== "Sans date") expect(d).toMatch(JOUR_COURT);
  }
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("8 — « Rappel » partout, aucun « commande(s) », « nouveau » plutot que +100 %", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "crm");
  const textesCrm = await page.locator("#crm").evaluate(e => e.innerText + " " + [...e.querySelectorAll("option")].map(o => o.textContent).join(" "));
  expect(textesCrm).not.toMatch(/relance/i);
  await page.goto(`${srv.base}/#relances`);
  await expect(page.locator("#relanceForm button[type='submit']")).toHaveText("Créer le rappel");
  await page.goto(`${srv.base}/#statistiques`);
  await page.waitForTimeout(800);
  const analyse = await page.locator("#statsKpis").innerText();
  expect(analyse).not.toMatch(/100\s?%/);
  expect(analyse).not.toMatch(/\(s\)/);
  // Le mot entier : « nouveau 0% » (l'ancien format sur la nouvelle reponse du
  // serveur) serait un pourcentage de plus, faux.
  expect(analyse).toContain("nouveau (rien la période d’avant)");
  expect(analyse).not.toMatch(/nouveau \d/);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

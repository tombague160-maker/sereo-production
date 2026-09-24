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
  expect(analyse).toContain("nouveau");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

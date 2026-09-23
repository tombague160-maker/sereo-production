// DEBLOQUER LES TOURNEES -- lot 2 de l'audit « localisation, carte, tournees »
// (23/09), la part ECRAN, dans un vrai navigateur, sur deux serveurs semes.
//
// Les defauts mesures par l'audit (commit 019788c), un par cas :
//   H9  La tournee d'hier, non soldee, masquait celle du jour a chaque
//       ouverture ; aucun selecteur de tournee.
//   H8  Une tournee ne s'annulait pas et ne se cloturait pas.
//   M2  Toucher un arret deja traite affichait l'arret SUIVANT, « Livre »
//       actif ; un « Absent » saisi par erreur ne se corrigeait pas.
//   --  La liste des commandes a mettre en tournee melangeait les dates, et
//       une commande deja dans une tournee se cochait (puis etait refusee).
//   D10 (decision 10) « remis a… » : une note facultative du geste « Livre »,
//       qui passe par la file hors ligne comme les autres gestes.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

const MOBILE = { width: 390, height: 844 };
const UN_JOUR = 86400000;
const HIER = new Date(Date.parse(`${AUJOURDHUI}T12:00:00Z`) - UN_JOUR).toISOString().slice(0, 10);
const DEMAIN = new Date(Date.parse(`${AUJOURDHUI}T12:00:00Z`) + UN_JOUR).toISOString().slice(0, 10);

test.describe.configure({ mode: "serial" });

/**
 * Le seme commun (tournee r-1 du jour, en cours : o-1 et o-2 livres, o-3 en
 * livraison, o-4 en probleme, o-5 et o-6 a faire), plus :
 *  - r-hier, EN TETE de la liste : la tournee d'hier, pas soldee (un livre,
 *    un a faire) -- celle que l'ancien ecran affichait ;
 *  - r-prete : une tournee du jour, prete, avec o-p ;
 *  - o-demain : une commande prete pour demain.
 */
function seme() {
  const s = jeuDeDonnees();
  const copie = (depuis, id, extra) => ({ ...structuredClone(s.commandes.find(c => c.id === depuis)), id, ...extra });
  const h1 = copie("o-8", "o-h1", { clientName: "Foyer de la Veille", status: "en_livraison", deliveryDate: HIER, routeId: "r-hier" });
  const h2 = copie("o-8", "o-h2", { clientName: "Pension des Jours", status: "livre", deliveryDate: HIER, deliveredAt: `${HIER}T09:00:00Z`, routeId: "r-hier" });
  const p = copie("o-8", "o-p", { clientName: "Résidence Prête", status: "pret_livraison", routeId: "r-prete" });
  const demain = copie("o-8", "o-demain", { clientName: "Cabinet du Lendemain", status: "pret_livraison", deliveryDate: DEMAIN });
  s.commandes.push(h1, h2, p, demain);
  const arret = (o, status, extra = {}) => ({
    id: `s-${o.id}`, orderId: o.id, clientId: o.clientId, clientName: o.clientName,
    address: o.address, city: o.city, postalCode: o.postalCode, lat: o.lat, lng: o.lng,
    status, products: o.products, ...extra
  });
  s.routes.unshift({ id: "r-hier", status: "en_livraison", deliveryDate: HIER, sector: "Dole", startedAt: `${HIER}T08:00:00Z`,
    stops: [arret(h2, "livre", { deliveredAt: `${HIER}T09:00:00Z` }), arret(h1, "en_livraison")] });
  s.routes.push({ id: "r-prete", status: "prete", deliveryDate: AUJOURDHUI, sector: "Dole", stops: [arret(p, "pret_livraison")] });
  return s;
}

let srv, srv2;
test.beforeAll(async () => {
  srv = await demarrer({ port: 3330, seed: seme() });
  srv2 = await demarrer({ port: 3331, seed: seme() });
});
test.afterAll(async () => {
  if (srv) await srv.arreter();
  if (srv2) await srv2.arreter();
});

async function ouvrir(browser, base, { theme = "light", viewport = MOBILE } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, timezoneId: "Europe/Paris" });
  await ctx.addInitScript(t => { try { localStorage.setItem("sereo:colorScheme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

const tournees = async base => (await (await fetch(base + "/api/routes")).json());
const tournee = async (base, id) => (await tournees(base)).find(r => r.id === id);
const commande = async (base, id) => {
  const liste = await (await fetch(base + "/api/orders")).json();
  return (Array.isArray(liste) ? liste : liste.orders || []).find(o => o.id === id);
};

function luminance(rgb) {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// --- H9 -------------------------------------------------------------------------

test("H9 — la tournee DU JOUR d'abord ; celle d'hier, non soldee, est signalee avec « Clôturer » ; « Tournées du jour » au choix", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const liste = page.locator("#routeStopsList");
  await expect(liste, "la tournee d'hier masque celle du jour").toContainText("SSIAD de la Haute Vallée");
  await expect(liste).not.toContainText("Foyer de la Veille");
  const signal = page.locator("#tourneesNonSoldees");
  await expect(signal, "la tournee d'hier non soldee n'est pas signalee").toBeVisible();
  await expect(signal).toContainText("n’est pas soldée : 1 arrêt à faire");
  await expect(signal.locator('[data-action="cloturer-tournee"]')).toHaveText("Clôturer");
  const choix = page.locator("#tourneeChoix");
  await expect(choix, "aucun choix de tournee").toBeVisible();
  const options = await choix.locator("option").allTextContents();
  console.log(`[choix] ${JSON.stringify(options)}`);
  expect(options).toHaveLength(3);
  // Cibles de 44 px au moins (le choix, les gestes du signal).
  const hauteurs = await page.evaluate(() => [
    document.getElementById("tourneeChoix"),
    ...document.querySelectorAll("#tourneesNonSoldees .button")
  ].map(e => Math.round(e.getBoundingClientRect().height)));
  for (const h of hauteurs) expect(h).toBeGreaterThanOrEqual(44);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("liste de preparation : le JOUR par defaut, et la commande deja en tournee est GRISEE, avec le nom de la tournee", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  expect(await page.locator("#deliveryDate").inputValue(), "la liste ne s'ouvre pas sur le jour").toBe(AUJOURDHUI);
  const cartes = page.locator("#deliveryCandidates");
  await expect(cartes).toContainText("EHPAD Résidence Bellevue");
  await expect(cartes, "la commande de demain est dans la liste du jour").not.toContainText("Cabinet du Lendemain");
  const prise = page.locator(".delivery-card", { hasText: "Résidence Prête" });
  await expect(prise.locator('input[type="checkbox"]'), "une commande deja en tournee se coche").toBeDisabled();
  await expect(prise.locator(".delivery-card-tournee")).toHaveText(/^Déjà dans « Tournée Dole du .+ » \(prête\)$/);
  // « Tout selectionner » ne la prend pas (la planification est repliee
  // pendant la livraison : on l'ouvre).
  await page.locator("#routePlanning > summary").click();
  await page.locator('[data-action="select-all-delivery"]').click();
  await expect(page.locator(".delivery-card", { hasText: "EHPAD Résidence Bellevue" }).locator('input[type="checkbox"]')).toBeChecked();
  await expect(prise.locator('input[type="checkbox"]')).not.toBeChecked();
  await ctx.close();
});

test("contrastes du lot, en clair et en sombre : le signal et la mention « Déjà dans »", async ({ browser }) => {
  test.setTimeout(120000);
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await ouvrir(browser, srv.base, { theme });
    const r = await page.evaluate(() => {
      const couleurs = el => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor];
      const signal = document.getElementById("tourneesNonSoldees");
      const mention = document.querySelector(".delivery-card-tournee");
      const carte = mention.closest(".delivery-card");
      const libre = document.querySelector(".delivery-card:not(.delivery-card--en-tournee)");
      return {
        signal: couleurs(signal), mention: [getComputedStyle(mention).color, getComputedStyle(carte).backgroundColor],
        fondLibre: getComputedStyle(libre).backgroundColor
      };
    });
    const cs = contraste(...r.signal);
    const cm = contraste(...r.mention);
    console.log(`[contraste/${theme}] signal ${cs.toFixed(2)} ${JSON.stringify(r.signal)} · mention ${cm.toFixed(2)} ${JSON.stringify(r.mention)} · libre ${r.fondLibre}`);
    expect(r.mention[1], "la carte deja en tournee n'est pas grisee").not.toBe(r.fondLibre);
    expect(cs).toBeGreaterThanOrEqual(4.5);
    expect(cm).toBeGreaterThanOrEqual(4.5);
    await ctx.close();
  }
});

// --- H8 -------------------------------------------------------------------------

test("H8 — « Annuler la tournée » (prete, choisie dans « Tournées du jour ») : confirmee, ses commandes redeviennent choisissables", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  await page.locator("#tourneeChoix").selectOption("r-prete");
  await expect(page.locator("#routeStopsList")).toContainText("Résidence Prête");
  const bouton = page.locator("#annulerTourneeButton");
  await expect(bouton, "aucun geste pour annuler une tournee prete").toBeVisible();
  // Refuser la confirmation ne fait rien.
  page.once("dialog", d => d.dismiss());
  await bouton.click();
  await page.waitForTimeout(500);
  expect((await tournee(srv.base, "r-prete")).status).toBe("prete");
  let message = "";
  page.once("dialog", d => { message = d.message(); d.accept(); });
  await bouton.click();
  await expect.poll(async () => (await tournee(srv.base, "r-prete")).status).toBe("annulee");
  expect(message).toMatch(/sa commande redevient prête à livrer, et le stock ne bouge pas/);
  const o = await commande(srv.base, "o-p");
  expect(o.status).toBe("pret_livraison");
  expect(o.routeId).toBeFalsy();
  const prise = page.locator(".delivery-card", { hasText: "Résidence Prête" });
  await expect(prise.locator('input[type="checkbox"]'), "la commande de la tournee annulee reste grisee").toBeEnabled();
  await ctx.close();
});

test("H8 — « Clôturer » la tournee d'hier depuis le signal : confirmation qui dit « définitif », restants a reprogrammer", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  const bouton = page.locator('#tourneesNonSoldees [data-action="cloturer-tournee"]');
  let message = "";
  page.once("dialog", d => { message = d.message(); d.accept(); });
  await bouton.click();
  await expect.poll(async () => (await tournee(srv.base, "r-hier")).status).toBe("cloturee");
  expect(message).toMatch(/définitif/);
  expect(message).toMatch(/À reprogrammer \(1\) : Foyer de la Veille/);
  const r = await tournee(srv.base, "r-hier");
  expect(r.stops.map(s => s.status)).toEqual(["livre", "a_reprogrammer"]);
  expect((await commande(srv.base, "o-h1")).status).toBe("a_reprogrammer");
  await expect(page.locator("#tourneesNonSoldees")).toBeHidden();
  // La commande reprogrammee revient dans la liste, « À reprogrammer ».
  await expect(page.locator(".delivery-card", { hasText: "Foyer de la Veille" })).toContainText("À reprogrammer");
  await ctx.close();
});

test("H8 — « Clôturer la tournée » (en cours) est dans « Autres actions » ; refuser la confirmation ne cloture rien", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  await page.locator(".gestes-plus summary").click();
  const bouton = page.locator("#cloturerTourneeButton");
  await expect(bouton).toBeVisible();
  page.once("dialog", d => d.dismiss());
  await bouton.click();
  await page.waitForTimeout(500);
  expect((await tournee(srv.base, "r-1")).status).toBe("en_livraison");
  await ctx.close();
});

test("H8 — hors ligne, « Clôturer » echoue franchement : jamais mis en file (rejoue plus tard, il arreterait une tournee reprise)", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  await page.locator(".gestes-plus summary").click();
  await ctx.setOffline(true);
  page.once("dialog", d => d.accept());
  await page.locator("#cloturerTourneeButton").click();
  await page.waitForTimeout(1500);
  const file = await page.evaluate(() => new Promise(resolve => {
    const d = indexedDB.open("sereo-file-attente", 1);
    d.onerror = () => resolve([]);
    d.onsuccess = () => {
      const db = d.result;
      if (!db.objectStoreNames.contains("ecritures")) { db.close(); resolve([]); return; }
      const r = db.transaction("ecritures", "readonly").objectStore("ecritures").getAll();
      r.onsuccess = () => { const v = r.result; db.close(); resolve(v); };
      r.onerror = () => { db.close(); resolve([]); };
    };
  }));
  expect(file.map(e => e.url), "la cloture attend dans la file").toEqual([]);
  await expect(page.locator(".toast").last()).toContainText("Impossible de joindre le serveur");
  await ctx.setOffline(false);
  await page.waitForTimeout(1500);
  expect((await tournee(srv.base, "r-1")).status).toBe("en_livraison");
  await ctx.close();
});

// --- M2 -------------------------------------------------------------------------

test("M2 — un arret deja traite s'ouvre en LECTURE SEULE ; « Corriger le statut » le corrige, avec sa cause", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv2.base);
  // L'arret 4 (Clinique Veterinaire) est en probleme.
  await page.locator("#routeStopsList .route-stop").nth(3).locator(".route-stop-main").click();
  const nom = page.locator("#currentClient .arret-nom");
  await expect(nom, "toucher un arret traite affiche un autre arret").toHaveText("Clinique Vétérinaire du Doubs");
  await expect(page.locator("#markDeliveredButton"), "« Livré » actif sur un arret deja traite").toBeDisabled();
  const bloc = page.locator("#currentClient .arret-traite");
  await expect(bloc).toContainText("Problème · Adresse introuvable");
  await bloc.locator('[data-action="corriger-statut"]').click();
  const dialogue = page.locator("#correctionDialog");
  await expect(dialogue).toBeVisible();
  await dialogue.locator('[data-correction="livre"]').click();
  // Sans cause, rien ne part.
  await dialogue.locator('[data-action="correction-valider"]').click();
  await expect(dialogue).toBeVisible();
  await dialogue.locator("#correctionCause").fill("Livré au gardien, problème saisi par erreur");
  await dialogue.locator('[data-action="correction-valider"]').click();
  await expect(dialogue).toBeHidden();
  await expect.poll(async () => (await tournee(srv2.base, "r-1")).stops[3].status).toBe("livre");
  expect((await commande(srv2.base, "o-4")).status).toBe("livre");
  const historique = await (await fetch(srv2.base + "/api/historique")).json();
  expect(historique.find(h => h.type === "Correction")?.message).toBe("Clinique Vétérinaire du Doubs : Problème → Livré — Livré au gardien, problème saisi par erreur");
  // L'arret reste a l'ecran, corrige, toujours en lecture seule.
  await expect(nom).toHaveText("Clinique Vétérinaire du Doubs");
  await expect(page.locator("#currentClient .arret-etat")).toHaveText("Livré");
  // « Revenir a l'arret a faire ».
  await page.locator('[data-action="revenir-arret-en-cours"]').click();
  await expect(nom).toHaveText("EHPAD Les Tilleuls du Val de Loue");
  await expect(page.locator("#markDeliveredButton")).toBeEnabled();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- Decision 10 ----------------------------------------------------------------

test("D10 — « Remis à » part avec « Livré », se relit sur l'arret et dans le detail de la commande", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv2.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText("EHPAD Les Tilleuls du Val de Loue");
  const champ = page.locator("#remisAInput");
  await expect(champ).toBeVisible();
  expect(Math.round((await champ.boundingBox()).height)).toBeGreaterThanOrEqual(44);
  await champ.fill("Mme Martin, voisine");
  await page.locator("#markDeliveredButton").click();
  // L'arret suivant a l'ecran : le champ est vide (la note ne suit pas).
  await expect(page.locator("#currentClient .arret-nom")).not.toHaveText("EHPAD Les Tilleuls du Val de Loue");
  await expect(champ).toHaveValue("");
  // L'envoi part au terme des 4 s d'Annuler.
  await expect.poll(async () => (await tournee(srv2.base, "r-1")).stops[2].remisA, { timeout: 15000 }).toBe("Mme Martin, voisine");
  expect((await commande(srv2.base, "o-3")).remisA).toBe("Mme Martin, voisine");
  // Sur l'arret, relu.
  await page.locator("#routeStopsList .route-stop").nth(2).locator(".route-stop-main").click();
  await expect(page.locator("#currentClient .arret-traite")).toContainText("remis à Mme Martin, voisine");
  // Dans le detail de la commande (ecran Commandes).
  await page.goto(srv2.base + "/#commandes", { waitUntil: "networkidle" });
  await page.locator('[data-cmd-filtre="livrees"]').click();
  await page.locator('[data-cmd-ouvrir="o-3"]').first().click();
  await expect(page.locator("#bdc-detail-body .bdc-detail-remis")).toHaveText("Remis à Mme Martin, voisine");
  await ctx.close();
});

test("D10 — hors ligne, « Remis à » attend dans la FILE avec le geste, puis part au retour du reseau", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv2.base);
  const nom = await page.locator("#currentClient .arret-nom").textContent();
  const ici = (await tournee(srv2.base, "r-1")).stops.findIndex(s => s.clientName === nom);
  expect(ici, "prealable : un arret a faire").toBeGreaterThan(2);
  await ctx.setOffline(true);
  await page.locator("#remisAInput").fill("l'accueil");
  await page.locator("#markDeliveredButton").click();
  const file = () => page.evaluate(() => new Promise(resolve => {
    const d = indexedDB.open("sereo-file-attente", 1);
    d.onerror = () => resolve([]);
    d.onsuccess = () => {
      const db = d.result;
      if (!db.objectStoreNames.contains("ecritures")) { db.close(); resolve([]); return; }
      const r = db.transaction("ecritures", "readonly").objectStore("ecritures").getAll();
      r.onsuccess = () => { const v = r.result; db.close(); resolve(v); };
      r.onerror = () => { db.close(); resolve([]); };
    };
  }));
  await expect.poll(async () => (await file()).map(e => e.corps).join(" "), { timeout: 15000 }).toContain("l'accueil");
  expect((await tournee(srv2.base, "r-1")).stops[ici].status, "le geste est parti hors ligne").not.toBe("livre");
  await ctx.setOffline(false);
  await expect.poll(async () => (await tournee(srv2.base, "r-1")).stops[ici].remisA, { timeout: 30000 }).toBe("l'accueil");
  await ctx.close();
});

test("M2 — hors ligne, une correction attend dans la file, montree faite (« En attente d'envoi »), puis part", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv2.base);
  const ici = (await tournee(srv2.base, "r-1")).stops.findIndex(s => s.remisA === "l'accueil");
  expect(ici, "prealable : l'arret livre hors ligne au cas precedent").toBeGreaterThan(2);
  await ctx.setOffline(true);
  const ligne = page.locator("#routeStopsList .route-stop").nth(ici);
  await ligne.locator(".route-stop-main").click();
  await page.locator('#currentClient [data-action="corriger-statut"]').click();
  const dialogue = page.locator("#correctionDialog");
  await dialogue.locator('[data-correction="absent"]').click();
  await dialogue.locator("#correctionCause").fill("Pas livré : personne à l'accueil");
  await dialogue.locator('[data-action="correction-valider"]').click();
  await expect(ligne.locator(".pill"), "la correction en file n'est pas montree").toHaveText("Absent");
  await expect(ligne).toContainText("En attente d’envoi");
  expect((await tournee(srv2.base, "r-1")).stops[ici].status).toBe("livre");
  await ctx.setOffline(false);
  await expect.poll(async () => (await tournee(srv2.base, "r-1")).stops[ici].status, { timeout: 30000 }).toBe("absent");
  await ctx.close();
});

// --- Relecture adverse du lot 2 (23/09) -------------------------------------------
//
// Les deux serveurs sont resemes (memes ports 3330 et 3331) : ce qui suit veut
// une base que les cas precedents n'ont pas touchee.

/**
 * La seule tournee du jour est TERMINEE (un « Absent » tape par erreur au
 * dernier arret l'a finie). Plus, pour la liste de preparation : une commande
 * prete prevue HIER (jamais mise en tournee) et une commande prete SANS date.
 */
function semeTourneeFinie() {
  const s = jeuDeDonnees();
  const copie = (depuis, id, extra) => ({ ...structuredClone(s.commandes.find(c => c.id === depuis)), id, ...extra });
  s.commandes.push(
    copie("o-8", "o-retard", { clientName: "Maison du Retard", status: "pret_livraison", deliveryDate: HIER }),
    copie("o-8", "o-sansdate", { clientName: "Foyer Sans Date", status: "pret_livraison", deliveryDate: "" })
  );
  const r = s.routes[0];
  r.status = "terminee";
  r.startedAt = `${AUJOURDHUI}T07:30:00Z`;
  r.completedAt = `${AUJOURDHUI}T11:00:00Z`;
  const fin = { o5: "livre", o6: "absent" };
  r.stops = r.stops.map(stop => {
    const cle = stop.orderId.replace("-", "");
    if (stop.status === "en_livraison") return { ...stop, status: "livre", deliveredAt: `${AUJOURDHUI}T10:00:00Z` };
    if (fin[cle]) return { ...stop, status: fin[cle], deliveredAt: `${AUJOURDHUI}T10:50:00Z` };
    return stop;
  });
  const statutCommande = { livre: "livre", absent: "a_reprogrammer", probleme: "a_reprogrammer" };
  for (const stop of r.stops) {
    const o = s.commandes.find(c => c.id === stop.orderId);
    o.status = statutCommande[stop.status];
    o.routeId = r.id;
    if (stop.status === "absent") o.deliveryStatus = "absent";
  }
  return s;
}

/**
 * Arrete un serveur seme de ce fichier et le relance sur SON port, avec un
 * autre seme. Le port est relu dans `base` : il n'est ecrit qu'une fois, dans
 * beforeAll (test/ports-e2e.test.js compte chaque port litteral demarre).
 */
async function resemer(serveur, seed) {
  const port = Number(new URL(serveur.base).port);
  await serveur.arreter();
  return demarrer({ port, seed });
}

test("relecture — rouverte, l'ecran montre la tournee du jour TERMINEE : un arret se corrige encore apres un rechargement", async ({ browser }) => {
  test.setTimeout(120000);
  srv = await resemer(srv, semeTourneeFinie());
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  await expect(page.locator("#currentClient"), "la tournee terminee du jour n'est pas a l'ecran").toContainText("Tournée terminée");
  const ligne = page.locator("#routeStopsList .route-stop").nth(5);
  await expect(ligne).toContainText("Cabinet Infirmier Dupont-Lefebvre");
  await ligne.locator(".route-stop-main").click();
  await page.locator('#currentClient [data-action="corriger-statut"]').click();
  const dialogue = page.locator("#correctionDialog");
  await dialogue.locator('[data-correction="livre"]').click();
  await dialogue.locator("#correctionCause").fill("Absent tapé par erreur");
  await dialogue.locator('[data-action="correction-valider"]').click();
  await expect.poll(async () => (await tournee(srv.base, "r-1")).stops[5].status).toBe("livre");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("relecture — la liste du jour DIT les commandes pretes qu'elle cache : en retard, sans date", async ({ browser }) => {
  test.setTimeout(120000);
  srv = await resemer(srv, semeTourneeFinie());
  const { ctx, page } = await ouvrir(browser, srv.base);
  const cartes = page.locator("#deliveryCandidates");
  await expect(cartes).toContainText("EHPAD Résidence Bellevue");
  await expect(cartes).not.toContainText("Maison du Retard");
  const resume = page.locator("#deliveryFilterSummary");
  await expect(resume, "les commandes pretes cachees par la date ne sont pas signalees").toContainText("Hors de cette date : 1 commande prête en retard et 1 sans date ; vide la date pour les voir.");
  // Vider la date les montre, et le signal disparait (la planification est
  // ouverte : aucune tournee ne roule).
  await expect(page.locator("#routePlanning")).toHaveAttribute("open", "");
  await page.locator("#deliveryDate").fill("");
  await page.locator("#deliveryDate").dispatchEvent("change");
  await expect(cartes).toContainText("Maison du Retard");
  await expect(cartes).toContainText("Foyer Sans Date");
  await expect(resume).not.toContainText("Hors de cette date");
  await ctx.close();
});

test("relecture — « Corriger le statut » : Entree dans la cause ENVOIE la correction (avant : le dialogue se fermait, rien ne partait)", async ({ browser }) => {
  test.setTimeout(120000);
  srv2 = await resemer(srv2, jeuDeDonnees());
  const { ctx, page, erreurs } = await ouvrir(browser, srv2.base);
  await page.locator("#routeStopsList .route-stop").nth(3).locator(".route-stop-main").click();
  await page.locator('#currentClient [data-action="corriger-statut"]').click();
  const dialogue = page.locator("#correctionDialog");
  await dialogue.locator('[data-correction="livre"]').click();
  const cause = dialogue.locator("#correctionCause");
  await cause.fill("Problème tapé par erreur");
  await cause.press("Enter");
  await expect.poll(async () => (await tournee(srv2.base, "r-1")).stops[3].status, { message: "Entree n'a rien envoye" }).toBe("livre");
  await expect(dialogue).toBeHidden();
  // Temoin : sans statut choisi, Entree n'envoie rien et le dialogue reste.
  await page.locator("#routeStopsList .route-stop").nth(0).locator(".route-stop-main").click();
  await page.locator('#currentClient [data-action="corriger-statut"]').click();
  await cause.fill("Sans choix");
  await cause.press("Enter");
  await expect(dialogue).toBeVisible();
  expect((await tournee(srv2.base, "r-1")).stops[0].status).toBe("livre");
  await dialogue.locator('[data-action="correction-annuler"]').click();
  await expect(dialogue).toBeHidden();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

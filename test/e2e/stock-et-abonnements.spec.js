// E2E : stock et abonnements (chasse aux defauts du 24/09 ; decision 8).
//
// Ce que l'ecran montre des correctifs serveur :
// - une commande saisie chez le client qui prend plus de la moitie du rayon
//   reste « A preparer », son geste « Passer en preparation » actif (avant :
//   rangee dans « Bloquees », geste grise, alors que son stock etait sorti) ;
// - les « Mouvements recents » du Stock disent la sortie de la commande
//   (avant : vides, seule la saisie a la main y ecrivait) ;
// - mettre en pause un abonnement dit quelles commandes deja creees sont
//   annulees (decision 8), et elles le sont.
//
// Serveur seme propre (port 3604), les commandes creees par les VRAIES routes.

const { test, expect } = require("./tuiles");
const { demarrer, AUJOURDHUI } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3604 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, ecran, largeur = 1440) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: largeur < 800 ? 844 : 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(`${srv.base}/#${ecran}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

async function poster(request, chemin, corps) {
  const r = await request.post(`${srv.base}${chemin}`, { data: corps });
  expect(r.status(), `${chemin} : ${await r.text()}`).toBeLessThan(300);
  return r.json();
}

let terrain;

test("Stock sans mouvement : l'etat vide dit les entrees et sorties, plus seulement la saisie", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "stock");
  await expect(page.locator("#stockMovementList")).toContainText("Les entrées et sorties du stock apparaîtront ici.");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("commande terrain de 60 sur 100 : « À préparer », geste actif, et sa sortie aux mouvements récents", async ({ browser, request }) => {
  terrain = await poster(request, "/api/customer-orders", { clientId: "c-dupont", products: [{ productId: "st-ALE", quantite: 60 }] });
  expect(terrain.bloquee).toBe(false);

  const { ctx, page, erreurs } = await ouvrir(browser, "preparation");
  // La ligne de CETTE commande (par son identifiant : le seme a d'autres commandes du meme client).
  const ligne = page.locator("#preparationList .commande-ligne", { has: page.locator(`.commande-ligne-main[data-order-id="${terrain.id}"]`) });
  await expect(ligne, "prealable : la commande est a l'ecran Preparation").toHaveCount(1);
  const groupe = await ligne.evaluate(l => l.closest(".commandes-groupe").querySelector(".commandes-groupe-titre").textContent.replace(/\s+/g, " ").trim());
  expect(groupe, "avant : rangee dans « Bloquées »").toMatch(/^À préparer/);
  await expect(ligne.locator(".pill")).not.toHaveText("Bloquée");
  await ligne.locator(".commande-ligne-main").click();
  const geste = page.locator(`[data-action="start-preparation"][data-order-id="${terrain.id}"]`).first();
  await expect(geste).toBeVisible();
  await expect(geste).toBeEnabled();
  // Relecture adverse (25/09) : au bureau, le detail (la carte de preparation)
  // ne compare plus la ligne au rayon que la commande a elle-meme reduit --
  // avant : « Besoin 60 · Dispo 40 » en rouge, comme un manque de 20, alors
  // que ses 60 articles sont mis de cote.
  const ligneStock = page.locator("#commandeDetailCorps .stock-line");
  await expect(ligneStock, "prealable : le detail du bureau montre la ligne du produit").toHaveCount(1);
  await expect(ligneStock).toContainText("Besoin 60 · Réservé");
  await expect(ligneStock).toHaveClass(/\bline-ok\b/);
  expect(erreurs).toEqual([]);

  await page.goto(`${srv.base}/#stock`, { waitUntil: "networkidle" });
  await expect(page.locator("#stockMovementList")).toContainText(`Sortie pour la commande ${terrain.numero}`);
  await ctx.close();
});

// Temoin (vert avant et apres) : une commande qui n'a RIEN reserve (acceptee
// en « Bloquée », decision 11) garde au bureau sa ligne rouge et le rayon dit.
test("temoin : commande terrain de 50 sur 40 restants, bloquée : au bureau, « Besoin 50 · Dispo 40 » en rouge", async ({ browser, request }) => {
  const bloquee = await poster(request, "/api/customer-orders", { clientId: "c-dupont", products: [{ productId: "st-ALE", quantite: 50 }] });
  expect(bloquee.bloquee, "prealable : rien n'est reserve").toBe(true);

  const { ctx, page, erreurs } = await ouvrir(browser, "preparation");
  const ligne = page.locator("#preparationList .commande-ligne", { has: page.locator(`.commande-ligne-main[data-order-id="${bloquee.id}"]`) });
  await expect(ligne).toHaveCount(1);
  await ligne.locator(".commande-ligne-main").click();
  const ligneStock = page.locator("#commandeDetailCorps .stock-line");
  await expect(ligneStock).toHaveCount(1);
  await expect(ligneStock).toContainText("Besoin 50 · Dispo 40");
  await expect(ligneStock).toHaveClass(/\bline-danger\b/);
  expect(erreurs).toEqual([]);
  await ctx.close();
  // Rendue au rayon : la suite du fichier ne la voit plus.
  expect((await request.patch(`${srv.base}/api/orders/${bloquee.id}`, { data: { status: "annulee" } })).status()).toBe(200);
});

test("mettre en pause un abonnement : l'écran dit la commande déjà créée annulée, et elle l'est", async ({ browser, request }) => {
  const { order } = await poster(request, "/api/subscriptions/sub-1/orders", { date: AUJOURDHUI });
  const { ctx, page, erreurs } = await ouvrir(browser, "abonnements", 390);
  const ligne = page.locator("#subscriptionList .abonnement-ligne", { hasText: "Actif" }).first();
  await ligne.locator(".commande-ligne-main").click();
  await page.locator("#abonnementDetailDialog [data-op=\"toggle-sub\"]").click();
  // Le message lu des qu'il paraît (le toast s'efface ensuite de lui-meme).
  const message = page.locator("#toastRegion .toast-message", { hasText: "Abonnement mis en pause" }).first();
  await expect(message).toBeVisible();
  expect(await message.textContent(), "avant : aucun mot des commandes annulées").toBe(`Abonnement mis en pause : 1 commande déjà créée annulée (${order.numero}).`);
  const commandes = await (await request.get(`${srv.base}/api/orders`)).json();
  expect(commandes.find(o => o.id === order.id).status).toBe("annulee");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

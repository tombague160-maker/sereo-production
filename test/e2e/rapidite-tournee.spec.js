// LOT 5 DE L'AUDIT GEO (23/09) : RAPIDITE, COTE ECRAN.
//
// Avant : apres chaque geste d'arret (« Livre », « Client absent »), l'ecran
// relancait loadData(), 17 requetes qui relisent toute la base -- 5,5 a 8,8 s
// apres un an d'historique, en 4G. La reponse du geste porte deja la tournee,
// l'arret, la commande et le client modifies : l'ecran se met a jour avec.
//
// Ce banc compte les requetes de lecture parties APRES la reponse du geste, et
// verifie que l'ecran dit quand meme la verite (l'arret livre, la commande
// livree dans l'etat de la page).
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

const MOBILE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

// Le seme par defaut, plus 20 tournees terminees avec leur trace : l'historique
// que la liste ne doit plus transporter.
function semeAvecHistorique() {
  const seme = jeuDeDonnees();
  // La tournee du jour a son trace : il doit rester a l'ecran quand elle se termine.
  seme.routes[0].geometry = { type: "LineString", coordinates: seme.routes[0].stops.map(s => [s.lng, s.lat]) };
  const modele = seme.commandes.find(c => c.id === "o-1");
  for (let r = 0; r < 20; r++) {
    const o = { ...structuredClone(modele), id: `o-h${r}`, status: "livre" };
    seme.commandes.push(o);
    seme.routes.push({
      id: `r-h${r}`, status: "terminee", deliveryDate: AUJOURDHUI, completedAt: `${AUJOURDHUI}T08:00:00Z`,
      geometry: { type: "LineString", coordinates: Array.from({ length: 500 }, (_, j) => [5.9 + j / 1e4, 46.7 + j / 1e4]) },
      stops: [{ id: `s-o-h${r}`, orderId: o.id, clientId: o.clientId, clientName: o.clientName, address: o.address,
        city: o.city, postalCode: o.postalCode, lat: o.lat, lng: o.lng, status: "livre", products: o.products }]
    });
  }
  return seme;
}

let srv;
test.beforeAll(async () => {
  srv = await demarrer({ port: 3196, seed: semeAvecHistorique() });
});
test.afterAll(async () => {
  if (srv) await srv.arreter();
});

async function ouvrir(browser, base) {
  const ctx = await browser.newContext({ viewport: MOBILE, timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  // Les lectures d'API, datees : on comptera celles qui suivent le geste.
  const lectures = [];
  page.on("request", req => {
    const url = new URL(req.url());
    if (req.method() === "GET" && url.pathname.startsWith("/api/")) lectures.push({ chemin: url.pathname, t: Date.now() });
  });
  await page.goto(base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs, lectures };
}

async function arrets(base) {
  const routes = await (await fetch(base + "/api/routes")).json();
  return routes.find(r => r.id === "r-1").stops;
}

test("lot 5 — « Livré » : l'ecran se met a jour avec la reponse, sans relancer le chargement complet", async ({ browser }) => {
  test.setTimeout(60000);
  const { ctx, page, erreurs, lectures } = await ouvrir(browser, srv.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText("EHPAD Les Tilleuls du Val de Loue");

  const reponse = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().includes("/stops/s-o-3"), { timeout: 15000 });
  await page.locator("#markDeliveredButton").click();
  // Le PATCH part au terme du toast (4 s) ; on attend sa reponse.
  const recue = await reponse;
  expect(recue.status()).toBe(200);
  const t = Date.now();
  await page.waitForTimeout(1500);

  const apres = lectures.filter(l => l.t >= t - 50).map(l => l.chemin);
  // Temoin : le compteur voit bien les lectures du chargement initial.
  expect(lectures.some(l => l.chemin === "/api/routes"), "le compteur n'a vu aucune lecture").toBe(true);
  expect(apres, "le geste a relance des lectures").toEqual([]);

  // L'ecran dit la verite : l'arret est livre, la commande aussi dans l'etat de la page.
  await expect(page.locator("#routeStopsList .route-stop").nth(2).locator(".pill")).toHaveText("Livré");
  await expect(page.locator("#currentClient .arret-nom")).toHaveText("Pharmacie Centrale de la Gare");
  expect((await arrets(srv.base))[2].status).toBe("livre");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("lot 5 — « Client absent » : l'ecran se met a jour avec la reponse, sans relancer le chargement complet", async ({ browser }) => {
  test.setTimeout(60000);
  const { ctx, page, erreurs, lectures } = await ouvrir(browser, srv.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText("Pharmacie Centrale de la Gare");

  await page.locator("#markAbsentButton").click();
  const dialogue = page.locator("#motifProblemeDialog");
  await expect(dialogue).toBeVisible();
  await dialogue.locator(".motif-choix").first().click();
  const reponse = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().includes("/stops/s-o-5"), { timeout: 15000 });
  await dialogue.locator("[data-action='motif-valider']").click();
  const recue = await reponse;
  expect(recue.status()).toBe(200);
  const corps = await recue.json();
  const t = Date.now();
  await page.waitForTimeout(1500);

  expect(lectures.filter(l => l.t >= t - 50).map(l => l.chemin), "le geste a relance des lectures").toEqual([]);
  await expect(page.locator("#routeStopsList .route-stop").nth(4).locator(".pill")).not.toHaveText(/Prêt|En livraison/);
  expect(corps.order && corps.stop, "la reponse ne porte pas la commande et l'arret").toBeTruthy();
  expect((await arrets(srv.base))[4].status).toBe(corps.stop.status);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Le lisere blanc n'est dessine que sous un trace routier (carte-et-lignes.spec.js).
const traceDessine = page => page.evaluate(() => [...document.querySelectorAll("#map .leaflet-overlay-pane path")]
  .filter(c => (c.getAttribute("stroke") || "").toUpperCase() === "#FFFFFF").length);

test("lot 5 — la derniere livraison termine la tournee : l'ecran recharge une fois, et garde le trace", async ({ browser }) => {
  test.setTimeout(60000);
  const { ctx, page, erreurs, lectures } = await ouvrir(browser, srv.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText("Cabinet Infirmier Dupont-Lefebvre");
  await page.locator("#map").scrollIntoViewIfNeeded();
  await expect.poll(() => traceDessine(page), { message: "temoin : le trace n'est pas dessine avant le geste" }).toBeGreaterThan(0);

  const reponse = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().includes("/stops/s-o-6"), { timeout: 15000 });
  await page.locator("#markDeliveredButton").click();
  const corps = await (await reponse).json();
  expect(corps.route.status).toBe("terminee");
  const t = Date.now();
  // Fin de tournee : UN chargement complet (tableau de bord, statistiques).
  await expect.poll(() => lectures.filter(l => l.t >= t - 50 && l.chemin === "/api/dashboard").length).toBe(1);
  await page.waitForTimeout(1000);
  // La liste n'a plus le trace (tournee terminee) : l'ecran a garde le sien.
  expect(await traceDessine(page), "le trace a disparu de la carte a la fin de la tournee").toBeGreaterThan(0);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("lot 5 — la liste des tournees n'emporte pas les traces de l'historique", async () => {
  const routes = await (await fetch(srv.base + "/api/routes")).json();
  const finies = routes.filter(r => r.status === "terminee");
  expect(finies.length).toBeGreaterThanOrEqual(20);
  expect(finies.filter(r => r.geometry), "des traces de tournees terminees voyagent encore").toEqual([]);
  expect(finies.every(r => r.traceOmise === true)).toBe(true);
  const une = await (await fetch(srv.base + "/api/routes/r-h0")).json();
  expect(une.geometry.coordinates.length).toBe(500);
});

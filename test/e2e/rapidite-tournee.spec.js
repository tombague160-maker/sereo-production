// LOT 5 DE L'AUDIT GEO (23/09) : RAPIDITE, COTE ECRAN.
//
// Avant : apres chaque geste d'arret (« Livre », « Client absent »), l'ecran
// relancait loadData(), 17 requetes qui relisent toute la base -- 5,5 a 8,8 s
// apres un an d'historique, en 4G. La reponse du geste porte deja la tournee,
// l'arret, la commande et le client modifies : l'ecran se met a jour avec.
//
// Ce banc compte les requetes de lecture parties APRES la reponse du geste, et
// verifie que l'ecran dit quand meme la verite. Chaque test vise l'arret que
// l'ecran montre : lance seul (--grep), il tient aussi.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

const MOBILE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

// Le seme par defaut, plus 20 tournees terminees avec leur trace : l'historique
// que la liste ne doit plus transporter. La tournee du jour a son trace.
function semeAvecHistorique({ presqueFinie = false } = {}) {
  const seme = jeuDeDonnees();
  const r1 = seme.routes[0];
  r1.geometry = { type: "LineString", coordinates: r1.stops.map(s => [s.lng, s.lat]) };
  if (presqueFinie) {
    // Il ne reste que le dernier arret (Cabinet Infirmier Dupont-Lefebvre).
    for (const i of [2, 4]) {
      r1.stops[i].status = "livre";
      seme.commandes.find(c => c.id === r1.stops[i].orderId).status = "livre";
    }
  } else {
    // Deux arrets de plus : trois gestes en serie sans terminer la tournee
    // (un geste qui la termine recharge tout, et ne dirait rien de la copie).
    const modeleArret = r1.stops[4];
    for (const k of [1, 2]) {
      const o = { ...structuredClone(seme.commandes.find(c => c.id === modeleArret.orderId)), id: `o-x${k}`, status: "en_livraison", clientName: `Officine annexe ${k}` };
      seme.commandes.push(o);
      r1.stops.push({ ...structuredClone(modeleArret), id: `s-o-x${k}`, orderId: o.id, clientName: o.clientName, status: "pret_livraison" });
    }
  }
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

let srv, fin;
test.beforeAll(async () => {
  [srv, fin] = await Promise.all([
    demarrer({ port: 3196, seed: semeAvecHistorique() }),
    demarrer({ port: 3197, seed: semeAvecHistorique({ presqueFinie: true }) })
  ]);
});
test.afterAll(async () => {
  if (srv) await srv.arreter();
  if (fin) await fin.arreter();
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

/** L'arret que l'ecran montre : son rang dans la liste et son nom. */
async function arretCourant(page, base) {
  const nom = (await page.locator("#currentClient .arret-nom").textContent()).trim();
  const liste = await arrets(base);
  const rang = liste.findIndex(s => s.clientName === nom && !["livre", "absent", "probleme"].includes(s.status));
  expect(rang, `l'arret de l'ecran (${nom}) n'est pas a livrer`).toBeGreaterThanOrEqual(0);
  return { rang, id: liste[rang].id, nom };
}

const patchDe = (page, stopId) => page.waitForResponse(
  r => r.request().method() === "PATCH" && r.url().includes(`/stops/${stopId}`), { timeout: 15000 });

test("lot 5 — « Livré » : l'ecran se met a jour avec la reponse, sans relancer le chargement complet", async ({ browser }) => {
  test.setTimeout(60000);
  const { ctx, page, erreurs, lectures } = await ouvrir(browser, srv.base);
  const vise = await arretCourant(page, srv.base);

  const reponse = patchDe(page, vise.id);
  await page.locator("#markDeliveredButton").click();
  // Le PATCH part au terme du toast (4 s) ; on attend sa reponse.
  const recue = await reponse;
  expect(recue.status()).toBe(200);
  const t = Date.now();
  await page.waitForTimeout(1500);

  // Temoin : le compteur voit bien les lectures du chargement initial.
  expect(lectures.some(l => l.chemin === "/api/routes"), "le compteur n'a vu aucune lecture").toBe(true);
  expect(lectures.filter(l => l.t >= t - 50).map(l => l.chemin), "le geste a relance des lectures").toEqual([]);

  // L'ecran dit la verite : l'arret est livre (serveur et ecran), l'ecran est passe au suivant.
  expect((await arrets(srv.base))[vise.rang].status).toBe("livre");
  await expect(page.locator("#routeStopsList .route-stop").nth(vise.rang).locator(".pill")).toHaveText("Livré");
  await expect(page.locator("#currentClient .arret-nom")).not.toHaveText(vise.nom);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("lot 5 — « Client absent » : l'ecran se met a jour avec la reponse, sans relancer le chargement complet", async ({ browser }) => {
  test.setTimeout(60000);
  const { ctx, page, erreurs, lectures } = await ouvrir(browser, srv.base);
  const vise = await arretCourant(page, srv.base);

  await page.locator("#markAbsentButton").click();
  const dialogue = page.locator("#motifProblemeDialog");
  await expect(dialogue).toBeVisible();
  await dialogue.locator(".motif-choix").first().click();
  const reponse = patchDe(page, vise.id);
  await dialogue.locator("[data-action='motif-valider']").click();
  const recue = await reponse;
  expect(recue.status()).toBe(200);
  const corps = await recue.json();
  const t = Date.now();
  await page.waitForTimeout(1500);

  expect(lectures.filter(l => l.t >= t - 50).map(l => l.chemin), "le geste a relance des lectures").toEqual([]);
  expect(corps.order && corps.stop && corps.route, "la reponse ne porte pas la tournee, l'arret et la commande").toBeTruthy();
  expect((await arrets(srv.base))[vise.rang].status).toBe(corps.stop.status);
  await expect(page.locator("#routeStopsList .route-stop").nth(vise.rang).locator(".pill")).not.toHaveText(/Prêt|En livraison/);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Un mandataire local qui sait RETENIR les lectures d'API : les requetes que le
// service worker emet ne passent pas par page.route (chargement-instantane.spec.js).
async function mandataire(cible) {
  const http = require("node:http");
  const etat = { retenir: null, attente: [] };
  const server = http.createServer((req, res) => {
    const passer = () => {
      const amont = http.request(cible + req.url, { method: req.method, headers: req.headers }, r => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      amont.on("error", () => res.destroy());
      req.pipe(amont);
    };
    if (etat.retenir && req.method === "GET" && etat.retenir.test(req.url)) etat.attente.push(passer);
    else passer();
  });
  server.listen(0, "127.0.0.1");
  await require("node:events").once(server, "listening");
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    retenir(motif) { etat.retenir = motif; },
    retenues() { return etat.attente.length; },
    liberer() { etat.retenir = null; for (const f of etat.attente.splice(0)) f(); },
    async arreter() {
      this.liberer();
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  };
}

test("lot 5 — apres « Livré », l'ecran rouvert avant le reseau montre l'arret livre (la copie du service worker suit le geste)", async ({ browser }) => {
  test.setTimeout(90000);
  const mdt = await mandataire(srv.base);
  const ctx = await browser.newContext({ viewport: MOBILE, timezoneId: "Europe/Paris" });
  try {
    const page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", e => erreurs.push(e.message));
    // Cache « chaud » : le service worker controle la page, et les donnees sont passees par lui.
    await page.goto(mdt.base + "/#livreur", { waitUntil: "networkidle" });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(() => page.evaluate(async () => {
      const noms = (await caches.keys()).filter(n => n.startsWith("sereo-api-"));
      return noms.length ? !!(await (await caches.open(noms[0])).match("/api/routes")) : false;
    }), { message: "temoin : /api/routes n'est pas dans le cache du service worker" }).toBe(true);
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });

    const vise = await arretCourant(page, srv.base);
    const reponse = patchDe(page, vise.id);
    await page.locator("#markDeliveredButton").click();
    const recue = await reponse;
    expect(recue.status()).toBe(200);
    expect((await recue.json()).route.status, "prealable : le geste ne doit pas terminer la tournee").not.toBe("terminee");
    await expect(page.locator("#routeStopsList .route-stop").nth(vise.rang).locator(".pill")).toHaveText("Livré");
    await page.waitForTimeout(800);

    // L'ecran se rouvre, et le reseau ne repond pas : ce qu'il montre vient de la copie.
    mdt.retenir(/^\/api\//);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => mdt.retenues(), { message: "prealable : les lectures d'API doivent etre retenues" }).toBeGreaterThan(0);
    // Sous 2,5 s : le repli du service worker (3 s) ne peut pas l'expliquer.
    await expect(page.locator("#routeStopsList .route-stop").nth(vise.rang).locator(".pill"),
      "la copie rouverte montre l'arret livre comme a livrer").toHaveText("Livré", { timeout: 2500 });
    await expect(page.locator("#currentClient .arret-nom"), "l'arret courant de la copie est un arret deja livre").not.toHaveText(vise.nom);
    mdt.liberer();
    expect(erreurs).toEqual([]);
  } finally {
    await ctx.close();
    await mdt.arreter();
  }
});

// Le lisere blanc n'est dessine que sous un trace routier (carte-et-lignes.spec.js).
const traceDessine = page => page.evaluate(() => [...document.querySelectorAll("#map .leaflet-overlay-pane path")]
  .filter(c => (c.getAttribute("stroke") || "").toUpperCase() === "#FFFFFF").length);

test("lot 5 — la derniere livraison termine la tournee : l'ecran recharge une fois, et garde le trace", async ({ browser }) => {
  test.setTimeout(60000);
  const { ctx, page, erreurs, lectures } = await ouvrir(browser, fin.base);
  const vise = await arretCourant(page, fin.base);
  await page.locator("#map").scrollIntoViewIfNeeded();
  await expect.poll(() => traceDessine(page), { message: "temoin : le trace n'est pas dessine avant le geste" }).toBeGreaterThan(0);

  const reponse = patchDe(page, vise.id);
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

test("lot 5 — « Me localiser » : la position part arrondie a ~100 m (3 decimales)", async ({ browser }) => {
  test.setTimeout(60000);
  // Plus de tournee en cours sur ce serveur (lance seul, ce test la termine
  // lui-meme) : l'ecran propose alors de preparer la suivante.
  for (const s of await arrets(fin.base)) {
    if (["livre", "absent", "probleme"].includes(s.status)) continue;
    const r = await fetch(`${fin.base}/api/routes/r-1/stops/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: fin.base }, body: JSON.stringify({ status: "livre" }) });
    expect(r.status).toBe(200);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = ok => ok({ coords: { latitude: 47.2381234, longitude: 6.0241234, accuracy: 12 } });
  });
  await page.goto(fin.base + "/#livreur", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Me localiser" }).click();
  await expect(page.locator("#routeLocationStatus")).toHaveText("Position de départ enregistrée.");
  await page.locator("#returnToStart").check();
  await expect(page.locator("#deliveryCandidates [data-delivery-order]").first()).toBeVisible();
  await page.getByRole("button", { name: "Tout sélectionner", exact: true }).click();
  const envoi = page.waitForRequest(r => r.method() === "POST" && new URL(r.url()).pathname === "/api/routes");
  await page.locator("#createRouteButton").click();
  const corps = (await envoi).postDataJSON();
  expect([corps.departure.lat, corps.departure.lng], "la position exacte a quitte le telephone").toEqual([47.238, 6.024]);
  expect([corps.arrival.lat, corps.arrival.lng]).toEqual([47.238, 6.024]);
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

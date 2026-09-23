// LOT 4 DE L'AUDIT GEO (23/09) -- « une carte utilisable au telephone ».
//
// Chaque cas porte le constat de l'audit qu'il juge (rapport du 23/09, commit
// audite 019788c) et echoue sans son correctif :
//   - fond de carte : Referer des tuiles, lien de licence, message en panne ;
//   - H10 : plus de recadrage a chaque geste, bouton « Recentrer », on suit
//     l'arret en cours quand il change -- et seulement alors ;
//   - M3 : le marqueur « en cours » suit l'arret choisi ;
//   - mise a jour ciblee : un rechargement ne recree pas les marqueurs ;
//   - position du livreur en direct, a la demande, jamais envoyee ;
//   - sans tournee : ni faux trajet ni « Arret N » ; centre sur la region ;
//   - telephone : le doigt seul fait defiler la page, deux doigts la carte ;
//     plein ecran ;
//   - depart et arrivee visibles (aussi apres un reordonnancement) ; arrets a
//     la meme adresse regroupes ; point approximatif distingue ; libelles en
//     francais et nom du client.
//
// Deux serveurs semes : 3194 (une tournee en cours) et 3195 (aucune tournee).
const { test, expect, MOTIF_TUILES } = require("./tuiles");
const { demarrer, jeuDeDonnees, CLIENTS, AUJOURDHUI } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const BUREAU = { width: 1440, height: 900 };
const TELEPHONE = { width: 390, height: 844 };

let tournee, sansTournee;

/** La tournee de 3194 : le seme commun, plus un depart, une arrivee, un
 *  septieme arret a la MEME adresse que le troisieme, et un point approximatif. */
function semeTournee() {
  const seed = jeuDeDonnees();
  const tilleuls = CLIENTS[0];
  const o11 = {
    ...structuredClone(seed.commandes[2]), id: "o-11", status: "en_livraison"
  };
  seed.commandes.push(o11);
  const r = seed.routes[0];
  r.stops.push({ ...structuredClone(r.stops[2]), id: "s-o-11", orderId: "o-11", status: "pret_livraison", lat: tilleuls.lat, lng: tilleuls.lng });
  // Le sixieme arret (Dupont) : une rue sans numero, le point est au milieu.
  r.stops[5].positionPrecision = "approximative";
  r.departure = { lat: 46.747, lng: 5.915, label: "Dépôt de Champagnole" };
  r.arrival = { lat: 47.10, lng: 5.51, label: "Retour Dole" };
  r.geometry = { type: "LineString", coordinates: [[r.departure.lng, r.departure.lat], ...CLIENTS.map(c => [c.lng, c.lat]), [r.arrival.lng, r.arrival.lat]] };
  return seed;
}

/** 3195 : trente clients geolocalises, trois commandes pretes, aucune tournee. */
function semeSansTournee() {
  const seed = jeuDeDonnees();
  const clients = Array.from({ length: 30 }, (_, i) => ({
    id: `c-${i}`, nom: `Client numero ${i}`, rue: `${i + 1} rue des Essais`, ville: "Champagnole", codePostal: "39300",
    lat: 46.70 + (i % 6) * 0.05, lng: 5.60 + Math.floor(i / 6) * 0.08, crmStatus: "client_actif"
  }));
  const pretes = [0, 7, 14].map((i, k) => ({
    id: `p-${k}`, clientId: clients[i].id, clientName: clients[i].nom, status: "pret_livraison",
    address: clients[i].rue, city: clients[i].ville, postalCode: clients[i].codePostal,
    lat: clients[i].lat, lng: clients[i].lng, deliveryDate: AUJOURDHUI, dateCommande: AUJOURDHUI,
    products: [{ code: "CH-L", nom: "Changes taille L", prixUnitaire: 12, quantite: 1 }]
  }));
  return { ...seed, clients, commandes: pretes, routes: [], subscriptions: [] };
}

test.beforeAll(async () => {
  [tournee, sansTournee] = await Promise.all([
    demarrer({ port: 3194, seed: semeTournee() }),
    demarrer({ port: 3195, seed: semeSansTournee() })
  ]);
});
test.afterAll(async () => {
  await Promise.all([tournee?.arreter(), sansTournee?.arreter()]);
});

async function ouvrir(browser, srv, { vue = BUREAU, contexte = {}, avant, figer = true } = {}) {
  const ctx = await browser.newContext({ viewport: vue, ...contexte });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  if (avant) await avant(page);
  await page.goto(srv.base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  // `figer: false` garde les animations : l'entree d'ecran laisse un
  // `transform` sur la page, et un `transform` fait d'un ancetre le cadre
  // d'un `position: fixed`. Figer les animations masquait ce defaut.
  if (figer) await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

/** Les marqueurs de la carte : nom accessible, texte, classes, centre dans le cadre. */
function lireMarqueurs(page) {
  return page.evaluate(() => {
    const m = document.getElementById("map").getBoundingClientRect();
    return [...document.querySelectorAll("#map .leaflet-marker-pane .leaflet-marker-icon")].map(e => {
      const b = e.getBoundingClientRect();
      const porteur = e.querySelector("[aria-label]");
      return {
        nom: porteur ? porteur.getAttribute("aria-label") : (e.getAttribute("alt") || e.getAttribute("title") || ""),
        texte: e.textContent.trim(),
        classes: porteur ? porteur.className : "",
        temoin: e.dataset.temoin || "",
        x: Math.round(b.left + b.width / 2 - m.left), y: Math.round(b.top + b.height / 2 - m.top),
        w: Math.round(m.width), h: Math.round(m.height)
      };
    });
  });
}

/** Les marqueurs d'arret seulement, indexes par leur nom accessible. */
async function positions(page) {
  const r = {};
  for (const m of await lireMarqueurs(page)) if (/^Arrêt/.test(m.nom)) r[m.nom] = [m.x, m.y];
  return r;
}
function ecartMax(a, b) {
  const cles = Object.keys(a);
  if (!cles.length || cles.some(k => !b[k])) return Infinity;
  return Math.max(...cles.map(k => Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1])));
}

/* ------------------------------------------------------------------------ */
/* Fond de carte                                                            */
/* ------------------------------------------------------------------------ */

test("fond de carte — les tuiles partent avec l'ORIGINE en Referer, l'attribution porte la licence", async ({ browser }) => {
  test.setTimeout(120000);
  const referers = [];
  const { ctx, page, erreurs } = await ouvrir(browser, tournee, {
    avant: p => p.route(MOTIF_TUILES, async route => {
      referers.push(await route.request().headerValue("referer"));
      await route.fallback();
    })
  });
  expect(erreurs).toEqual([]);
  expect(referers.length, "prealable : aucune tuile demandee").toBeGreaterThan(3);
  // L'origine seule : ni le chemin, ni l'onglet. La politique d'usage d'OSM
  // exige un Referer ; le reste du document garde `no-referrer`.
  expect([...new Set(referers)]).toEqual([`${tournee.base}/`]);
  const licence = await page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]').count();
  expect(licence, "attribution sans lien vers la licence d'OpenStreetMap").toBe(1);
  await ctx.close();
});

test("fond de carte — tuiles refusees : un message le dit, la liste reste utilisable", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, tournee, {
    avant: p => p.route(MOTIF_TUILES, route => route.fulfill({ status: 403, contentType: "text/plain", body: "Access blocked" }))
  });
  await page.waitForTimeout(1500);
  const texte = await page.evaluate(() => document.querySelector("#livreur .map-shell")?.innerText || "");
  expect(texte).toContain("Fond de carte indisponible");
  // Et il ne masque pas les arrets : la liste est a cote.
  expect(await page.locator("#routeStopsList .route-stop").count()).toBe(7);
  await ctx.close();
});

/* ------------------------------------------------------------------------ */
/* H10, M3, mise a jour ciblee                                              */
/* ------------------------------------------------------------------------ */

test("H10 — un rechargement ou un changement d'onglet GARDE le zoom et le cadre du livreur", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, tournee);
  await page.locator(".leaflet-control-zoom-in").click();
  await page.waitForTimeout(700);
  await page.locator(".leaflet-control-zoom-in").click();
  await page.waitForTimeout(700);
  const zoome = await positions(page);
  expect(Object.keys(zoome).length, "prealable : aucun marqueur d'arret").toBeGreaterThan(3);

  // Le geste « Livre » recharge les donnees : c'est ce chemin qui recadrait.
  await page.evaluate(() => window.Sereo.loadData());
  await page.waitForTimeout(1200);
  const apresRechargement = await positions(page);
  expect(ecartMax(zoome, apresRechargement), "la carte a ete recadree par le rechargement").toBeLessThan(2);

  await page.evaluate(() => window.Sereo.showTab("journee"));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.Sereo.showTab("livreur"));
  await page.waitForTimeout(1000);
  expect(ecartMax(zoome, await positions(page)), "la carte a ete recadree par le changement d'onglet").toBeLessThan(2);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("H10 — « Recentrer » remet toute la tournee dans le cadre", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, tournee);
  const bouton = page.getByRole("button", { name: "Recentrer" });
  expect(await bouton.count(), "aucun bouton « Recentrer »").toBe(1);
  for (let i = 0; i < 3; i++) { await page.locator(".leaflet-control-zoom-in").click(); await page.waitForTimeout(600); }
  const dehorsAvant = (await lireMarqueurs(page)).filter(p => p.x < 0 || p.y < 0 || p.x > p.w || p.y > p.h).length;
  expect(dehorsAvant, "prealable : le zoom devait sortir des marqueurs du cadre").toBeGreaterThan(0);
  await bouton.click();
  await page.waitForTimeout(900);
  const dehors = (await lireMarqueurs(page)).filter(p => p.x < 0 || p.y < 0 || p.x > p.w || p.y > p.h).map(p => p.nom);
  expect(dehors).toEqual([]);
  await ctx.close();
});

test("M3 + H10 — l'arret choisi devient « en cours » SUR LA CARTE, qui le suit sans changer de zoom", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, tournee);
  const avant = await positions(page);
  const livres = Object.keys(avant).filter(n => /livré/.test(n));
  expect(livres.length, "prealable : deux arrets livres").toBe(2);
  const d0 = Math.hypot(avant[livres[0]][0] - avant[livres[1]][0], avant[livres[0]][1] - avant[livres[1]][1]);

  await page.locator('#routeStopsList [data-action="select-stop"][data-stop-index="4"]').first().click();
  await page.waitForTimeout(1000);
  const apres = await lireMarqueurs(page);
  const enCours = apres.filter(m => /marqueur--en-cours/.test(m.classes));
  expect(enCours.map(m => m.texte), "le marqueur « en cours » de la carte n'a pas suivi l'arret choisi").toEqual(["5"]);
  // Suivi : l'arret choisi vient au centre...
  const cinq = enCours[0];
  expect(Math.abs(cinq.x - cinq.w / 2) + Math.abs(cinq.y - cinq.h / 2), "l'arret choisi n'est pas au centre").toBeLessThan(6);
  // ... au zoom du livreur : la distance entre deux marqueurs n'a pas change.
  const pos = await positions(page);
  const nomsLivres = Object.keys(pos).filter(n => /livré/.test(n));
  const d1 = Math.hypot(pos[nomsLivres[0]][0] - pos[nomsLivres[1]][0], pos[nomsLivres[0]][1] - pos[nomsLivres[1]][1]);
  expect(Math.abs(d1 - d0), `zoom change par le choix de l'arret (${Math.round(d0)} px -> ${Math.round(d1)} px)`).toBeLessThan(2);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("mise a jour ciblee — un rechargement ne recree pas les marqueurs (tournee et preparation)", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, tournee);
  const marquer = () => page.evaluate(() => document.querySelectorAll("#map .leaflet-marker-icon").forEach(e => { e.dataset.temoin = "avant"; }));
  await marquer();
  await page.evaluate(() => window.Sereo.loadData());
  await page.waitForTimeout(1200);
  const r = await lireMarqueurs(page);
  expect(r.length).toBeGreaterThan(3);
  expect(r.filter(m => m.temoin !== "avant").map(m => m.nom), "marqueurs recrees par le rechargement").toEqual([]);
  await ctx.close();

  // Preparation : cocher une commande ne change QUE son point.
  const prep = await ouvrir(browser, sansTournee);
  await prep.page.evaluate(() => document.querySelectorAll("#map .leaflet-marker-icon").forEach(e => { e.dataset.temoin = "avant"; }));
  await prep.page.locator('#deliveryCandidates input[type="checkbox"]').first().check();
  await prep.page.waitForTimeout(500);
  const p = await lireMarqueurs(prep.page);
  expect(p.length).toBe(3);
  expect(p.filter(m => m.temoin !== "avant").map(m => m.nom), "marqueurs recrees par une case cochee").toEqual([]);
  expect(p.filter(m => /marqueur--choisi/.test(m.classes)).length, "le point coche n'est pas distingue").toBe(1);
  await prep.ctx.close();
});

/* ------------------------------------------------------------------------ */
/* Position du livreur                                                      */
/* ------------------------------------------------------------------------ */

test("position du livreur — en direct a la demande, precision affichee, alerte au-dela de 150 m, rien n'est envoye", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, tournee, {
    vue: TELEPHONE,
    contexte: { hasTouch: true, isMobile: true, permissions: ["geolocation"], geolocation: { latitude: 47.2401, longitude: 6.0209, accuracy: 30 } }
  });
  const bouton = page.getByRole("button", { name: "Ma position" });
  expect(await bouton.count(), "aucun bouton « Ma position »").toBe(1);
  // Rien avant le geste : la position n'est demandee que sur demande.
  expect(await page.locator("#map .position-livreur").count()).toBe(0);

  const envois = [];
  page.on("request", r => {
    const corps = r.postData() || "";
    if (r.method() !== "GET" || /47\.240|6\.020|47\.25|6\.03/.test(r.url() + corps)) envois.push(`${r.method()} ${r.url()}`);
  });
  await bouton.click();
  await page.waitForTimeout(1200);
  await expect(bouton).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator("#map .position-livreur").count(), "la position n'est pas dessinee").toBe(1);
  const texte = () => page.evaluate(() => document.querySelector("#livreur .map-shell")?.innerText || "");
  expect(await texte()).toContain("± 30 m");
  expect(await texte()).not.toContain("imprécise");

  // Une position qui BOUGE et devient imprecise : suivie, et signalee.
  await ctx.setGeolocation({ latitude: 47.25, longitude: 6.03, accuracy: 1200 });
  await page.waitForTimeout(1200);
  expect(await texte()).toContain("± 1,2 km");
  expect(await texte()).toContain("imprécise");

  await bouton.click();
  await page.waitForTimeout(500);
  await expect(bouton).toHaveAttribute("aria-pressed", "false");
  expect(await page.locator("#map .position-livreur").count(), "la position reste dessinee apres l'arret").toBe(0);
  expect(envois, "la position est partie au serveur").toEqual([]);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

/* ------------------------------------------------------------------------ */
/* Sans tournee                                                             */
/* ------------------------------------------------------------------------ */

test("sans tournee — des points sans numero ni trajet, nommes par le client", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, sansTournee);
  const r = await lireMarqueurs(page);
  const traits = await page.locator("#map .leaflet-overlay-pane path").count();
  console.log(`[sans tournee] ${r.length} points : ${r.map(m => `${m.nom} [${m.texte}]`).join(" | ")} ; ${traits} trait(s)`);
  expect(traits, "un faux trajet relie les commandes").toBe(0);
  expect(r.filter(m => /\d/.test(m.texte)).map(m => m.texte), "des points portent un numero d'arret").toEqual([]);
  expect(r.filter(m => /^Arrêt/.test(m.nom)).length, "des points se disent « Arret N »").toBe(0);
  expect(r.map(m => m.nom).sort()).toEqual(["Client numero 0", "Client numero 14", "Client numero 7"].map(n => `${n}, non sélectionnée`));
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("sans tournee ni commande prete — aucun client en « Arret N », un message ; la carte montre la region, pas Beaune", async ({ browser }) => {
  test.setTimeout(120000);
  const vide = p => Promise.all([
    p.route("**/api/orders", r => r.fulfill({ json: [] })),
    p.route("**/api/clients", r => r.fulfill({ json: [] }))
  ]);
  const { ctx, page } = await ouvrir(browser, sansTournee, { avant: vide });
  expect((await lireMarqueurs(page)).length).toBe(0);
  const message = await page.locator("#mapEmpty").innerText();
  expect(message).toMatch(/commande/i);

  // Le centre, lu dans les tuiles demandees : au zoom z, la tuile x couvre
  // les longitudes [x/2^z*360-180, (x+1)/2^z*360-180].
  const centre = await page.evaluate(() => {
    const t = [...document.querySelectorAll("#map img.leaflet-tile")].map(i => /\/(\d+)\/(\d+)\/(\d+)\.png/.exec(i.src)).filter(Boolean)
      .map(m => [+m[1], +m[2], +m[3]]);
    const z = Math.max(...t.map(x => x[0]));
    const aZ = t.filter(x => x[0] === z);
    const x = aZ.reduce((s, v) => s + v[1] + 0.5, 0) / aZ.length;
    const y = aZ.reduce((s, v) => s + v[2] + 0.5, 0) / aZ.length;
    const n = Math.PI - 2 * Math.PI * y / 2 ** z;
    return { lng: x / 2 ** z * 360 - 180, lat: 180 / Math.PI * Math.atan(Math.sinh(n)), z };
  });
  console.log(`[centre par defaut] ${centre.lat.toFixed(2)}, ${centre.lng.toFixed(2)} au zoom ${centre.z}`);
  // Jura et Doubs : Champagnole, Dole, Besancon. Beaune est a 4,84 E.
  expect(centre.lng).toBeGreaterThan(5.2);
  expect(centre.lng).toBeLessThan(6.4);
  expect(centre.lat).toBeGreaterThan(46.4);
  expect(centre.lat).toBeLessThan(47.6);
  await ctx.close();

  // Et avec les clients mais sans commande prete : pas « Arret 1..30 ».
  const c = await ouvrir(browser, sansTournee, { avant: p => p.route("**/api/orders", r => r.fulfill({ json: [] })) });
  const r = await lireMarqueurs(c.page);
  expect(r.filter(m => /^Arrêt/.test(m.nom)).length, "les clients de la base sont numerotes en arrets").toBe(0);
  expect(await c.page.locator("#map .leaflet-overlay-pane path").count(), "un faux trajet relie les clients").toBe(0);
  await c.ctx.close();
});

/* ------------------------------------------------------------------------ */
/* Depart, arrivee, regroupement, approximatif, libelles                    */
/* ------------------------------------------------------------------------ */

test("depart et arrivee — nommes en francais, et TOUJOURS la apres un reordonnancement", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, tournee);
  const noms = (await lireMarqueurs(page)).map(m => m.nom);
  expect(noms.filter(n => /^Départ|^Arrivée/.test(n)).sort()).toEqual(["Arrivée : Retour Dole", "Départ : Dépôt de Champagnole"]);
  await ctx.close();

  // Apres un reordonnancement, le serveur efface le trace (geometry = null) et
  // garde depart et arrivee. On sert cet etat, tournee prete.
  const reordonnee = await ouvrir(browser, tournee, {
    avant: p => p.route("**/api/routes", async route => {
      const rep = await route.fetch();
      const routes = await rep.json();
      for (const r of routes) { r.geometry = null; r.status = "prete"; r.routingMode = "manual"; }
      await route.fulfill({ response: rep, json: routes });
    })
  });
  const apres = (await lireMarqueurs(reordonnee.page)).map(m => m.nom);
  expect(apres.filter(n => /^Départ|^Arrivée/.test(n)).sort(), "depart et arrivee ont disparu apres le reordonnancement")
    .toEqual(["Arrivée : Retour Dole", "Départ : Dépôt de Champagnole"]);
  // Decision gardee (planche 4c) : le pointille en principal dit « trace a refaire ».
  expect(await reordonnee.page.locator('#map .leaflet-overlay-pane path[stroke-dasharray]').count()).toBe(1);
  await reordonnee.ctx.close();
});

test("meme adresse regroupee, point approximatif distingue, libelles en francais avec le client", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, tournee);
  const r = await lireMarqueurs(page);
  const arrets = r.filter(m => /^Arrêt/.test(m.nom));
  console.log(`[marqueurs] ${arrets.map(m => `${m.texte}: ${m.nom}`).join(" | ")}`);
  // Sept arrets, six adresses : le 3 et le 7 sont a la meme porte.
  expect(arrets.length, "deux arrets a la meme adresse sont empiles").toBe(6);
  const groupe = arrets.find(m => m.texte === "3·7");
  expect(groupe, "aucun marqueur « 3·7 »").toBeTruthy();
  expect(groupe.nom).toMatch(/^Arrêts 3 et 7, en cours/);
  expect(groupe.nom).toContain("EHPAD Les Tilleuls du Val de Loue");

  const approx = arrets.find(m => m.texte === "6");
  expect(approx.classes).toContain("marqueur--approx");
  expect(approx.nom).toContain("position approximative");
  expect(arrets.filter(m => /marqueur--approx/.test(m.classes)).length).toBe(1);

  // Le client est nomme ; les commandes de zoom parlent francais.
  expect(arrets.find(m => m.texte === "5").nom).toBe("Arrêt 5, à venir : Pharmacie Centrale de la Gare");
  const zoom = await page.evaluate(() => [...document.querySelectorAll("#map .leaflet-control-zoom a")].map(a => a.getAttribute("aria-label")));
  expect(zoom).toEqual(["Zoomer", "Dézoomer"]);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

/* ------------------------------------------------------------------------ */
/* Telephone : un doigt, deux doigts, plein ecran                           */
/* ------------------------------------------------------------------------ */

async function glisser(cdp, points, dy, pas = 8) {
  const at = k => points.map((p, i) => ({ x: p.x, y: p.y + dy * k / pas, id: i }));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
  for (let k = 1; k <= pas; k++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(k) });
    await new Promise(r => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("telephone — un doigt fait defiler la PAGE, deux doigts deplacent la carte ; plein ecran", async ({ browser }) => {
  test.setTimeout(150000);
  const { ctx, page, erreurs } = await ouvrir(browser, tournee, { vue: TELEPHONE, contexte: { hasTouch: true, isMobile: true }, figer: false });
  const cdp = await ctx.newCDPSession(page);
  // La carte au milieu de l'ecran, avec de la page a defiler dessous.
  await page.evaluate(() => { const m = document.getElementById("map").getBoundingClientRect(); window.scrollBy(0, m.top - 150); });
  await page.waitForTimeout(400);
  const cadre = await page.evaluate(() => { const m = document.getElementById("map").getBoundingClientRect(); return { x: m.left + m.width / 2, y: Math.min(m.top + m.height / 2, 600) }; });

  const avant = await positions(page);
  const y0 = await page.evaluate(() => window.scrollY);
  await glisser(cdp, [cadre], -160);
  await page.waitForTimeout(700);
  const unDoigt = ecartMax(avant, await positions(page));
  const defile = (await page.evaluate(() => window.scrollY)) - y0;
  console.log(`[un doigt] carte deplacee de ${unDoigt === Infinity ? "?" : Math.round(unDoigt)} px, page defilee de ${defile} px`);
  expect(unDoigt, "un seul doigt a deplace la carte").toBeLessThan(3);
  expect(defile, "un seul doigt n'a pas fait defiler la page").toBeGreaterThan(40);

  // Deux doigts : la carte bouge (temoin positif -- elle reste manipulable).
  const cadre2 = await page.evaluate(() => { const m = document.getElementById("map").getBoundingClientRect(); return { x: m.left + m.width / 2, y: Math.max(m.top + 120, Math.min(m.top + m.height / 2, 600)) }; });
  const avant2 = await positions(page);
  await glisser(cdp, [{ x: cadre2.x - 60, y: cadre2.y }, { x: cadre2.x + 60, y: cadre2.y }], -120);
  await page.waitForTimeout(800);
  expect(ecartMax(avant2, await positions(page)), "deux doigts n'ont pas deplace la carte").toBeGreaterThan(30);

  // Plein ecran : la carte prend tout l'ecran, et le doigt seul la deplace.
  const plein = page.getByRole("button", { name: "Plein écran" });
  expect(await plein.count(), "aucun bouton « Plein ecran »").toBe(1);
  await plein.click();
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const panneau = document.querySelector("#livreur .tournee-carte-panel");
    const p = panneau.getBoundingClientRect();
    const m = document.getElementById("map").getBoundingClientRect();
    // Ce qui est PEINT aux coins et en bas (la barre basse y est au-dessous) :
    // la carte doit couvrir l'ecran, pas seulement y etre mesuree.
    const dessus = (x, y) => panneau.contains(document.elementFromPoint(x, y));
    return { cadre: [p.left, p.top, p.width, p.height].map(Math.round), carte: Math.round(m.height), ecran: [innerWidth, innerHeight],
      couvre: [dessus(4, 4), dessus(innerWidth - 4, innerHeight - 4), dessus(innerWidth / 2, innerHeight - 30)] };
  });
  expect(r.cadre, "la carte en plein ecran ne couvre pas l'ecran").toEqual([0, 0, ...r.ecran]);
  expect(r.couvre, "quelque chose est peint par-dessus la carte en plein ecran").toEqual([true, true, true]);
  expect(r.carte, "la carte ne remplit pas l'ecran").toBeGreaterThan(r.ecran[1] - 120);
  const avant3 = await positions(page);
  await glisser(cdp, [{ x: 195, y: 420 }], -120);
  await page.waitForTimeout(700);
  expect(ecartMax(avant3, await positions(page)), "en plein ecran, le doigt ne deplace pas la carte").toBeGreaterThan(30);

  // Echap sort, et rend le focus au bouton.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const sorti = await page.evaluate(() => getComputedStyle(document.querySelector("#livreur .tournee-carte-panel")).position);
  expect(sorti).not.toBe("fixed");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent.trim())).toMatch(/Plein écran/);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

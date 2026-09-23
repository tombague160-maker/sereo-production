// E2E : lot 6 de l'audit geo (23/09), « pratique au quotidien ».
//
// Tournee EN COURS (serveur seme, port 3332) :
//   1. heure d'arrivee par arret (liste et cockpit), km restants, heure de
//      retour, trajet jusqu'au prochain -- recalcules depuis l'heure REELLE
//      du dernier geste (horloge du navigateur figee) ;
//   2. « Prevenir » : un lien sms: avec le numero et l'heure estimee, texte des
//      Parametres ;
//   3. « Y aller » vers les coordonnees, dans l'application choisie et
//      memorisee (Waze), un lieu-dit sans rue compris ; Plans sur iPhone seulement ;
//   4. « Faire maintenant », en ligne puis HORS LIGNE (file du lot 1) ;
//   5. « Ajouter a la tournee en cours » ;
//   6. « Reoptimiser les arrets restants » depuis la position GPS (arrondie),
//      refuse hors ligne sans rien mettre en file ;
//   7. l'historique : km, durees, total mensuel par secteur ;
//   plus : 44 px et contraste >= 4,5:1 en clair et en sombre.
// Preparation (port 3333) : depot par defaut dans les Parametres, tournee
// creee en DEUX gestes, « Reoptimiser » une tournee prete depuis un autre
// depart, « retour au depot » memorise.
//
// Routage simule en local, adaptatif (serveur-seme.js) : aucun appel externe.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, CLIENTS, AUJOURDHUI } = require("./serveur-seme");

const MIN = 60000;
const [tilleuls, pharma, bellevue, ssiad, veto, dupont] = CLIENTS;
const DEPOT = { label: "Entrepôt de démonstration", lat: 47.24, lng: 6.02 };
const iso = (ms) => new Date(ms).toISOString();

/** « 10 h 40 » a Paris, arrondi a 5 min -- ce que l'ecran doit afficher. */
function heureParis(ms) {
  const pas = 5 * MIN;
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(Math.round(ms / pas) * pas));
  const h = Number(parts.find((p) => p.type === "hour").value);
  return `${h} h ${parts.find((p) => p.type === "minute").value}`;
}

function commande(id, client, status, extra = {}) {
  return {
    id, clientId: client.id, clientName: client.nom, status, phone: "",
    address: client.rue, city: client.ville, postalCode: client.codePostal,
    lat: client.lat, lng: client.lng, deliveryDate: AUJOURDHUI, dateCommande: AUJOURDHUI,
    products: [{ code: "CH-L", nom: "Changes taille L", prixUnitaire: 12, quantite: 2 }], ...extra
  };
}
const arret = (o, status, extra = {}) => ({
  id: `s-${o.id}`, orderId: o.id, clientId: o.clientId, clientName: o.clientName, phone: o.phone,
  address: o.address, city: o.city, postalCode: o.postalCode, lat: o.lat, lng: o.lng,
  status, products: o.products, ...extra
});

// L'instant « maintenant » du navigateur, fige. Les heures seedees en decoulent.
const X = Math.floor(Date.now() / MIN) * MIN;

function seedEnRoute() {
  const base = jeuDeDonnees();
  const commandes = [
    commande("p-1", ssiad, "livre", { deliveredAt: iso(X - 10 * MIN) }),
    // Numeros fictifs, du plan de numerotation reserve a la fiction.
    commande("p-2", tilleuls, "en_livraison", { phone: "06 39 98 00 02" }),
    commande("p-3", pharma, "en_livraison", { phone: "06 39 98 00 03" }),
    // Un lieu-dit : pas de rue, mais une position posee a la main.
    commande("p-4", dupont, "en_livraison", { address: "", geoPrecision: "manuel", geoSource: "manuel" }),
    // L'urgence du jour, prete, hors de la tournee.
    commande("u-1", veto, "pret_livraison")
  ];
  const [p1, p2, p3, p4] = commandes;
  const terminee = (id, jour, sector, km, debut, fin, livres) => ({
    id, status: "terminee", deliveryDate: jour, sector, totalDistance: km, routingMode: "road",
    startedAt: `${jour}T${debut}:00Z`, completedAt: `${jour}T${fin}:00Z`,
    stops: Array.from({ length: livres }, (_, i) => ({ id: `${id}-s${i}`, orderId: `${id}-o${i}`, clientName: "Client passé", status: "livre" }))
  });
  const moisPrecedent = new Date(Date.parse(`${AUJOURDHUI.slice(0, 7)}-01T12:00:00Z`) - 5 * 86400000).toISOString().slice(0, 10);
  return {
    ...base,
    commandes,
    routes: [
      {
        id: "r-1", status: "en_livraison", deliveryDate: AUJOURDHUI, sector: "Besancon",
        startedAt: iso(X - 60 * MIN), departure: DEPOT, arrival: DEPOT, routingMode: "road",
        totalDistance: 74, estimatedDuration: 95,
        geometry: { type: "LineString", coordinates: [[6.02, 47.24], [5.905, 46.75], [6.024, 47.238], [5.91, 46.745], [6.015, 47.23], [6.02, 47.24]] },
        // depart -> p1 : 5 km ; p1 -> p2 : 12 km, 15 min ; p2 -> p3 : 30 km, 20 min ;
        // p3 -> p4 : 2 km, 5 min ; p4 -> depot : 25 km, 25 min.
        troncons: [{ duree: 600, distance: 5000 }, { duree: 900, distance: 12000 }, { duree: 1200, distance: 30000 }, { duree: 300, distance: 2000 }, { duree: 1500, distance: 25000 }],
        stops: [arret(p1, "livre", { deliveredAt: iso(X - 10 * MIN) }), arret(p2, "en_livraison"), arret(p3, "en_livraison"), arret(p4, "en_livraison")]
      },
      terminee("h-1", AUJOURDHUI, "Dole", 42.5, "07:00", "10:30", 5),
      terminee("h-2", AUJOURDHUI, "Dole", 38, "07:10", "09:55", 4),
      terminee("h-3", AUJOURDHUI, "Besancon", 61.2, "06:30", "11:00", 6),
      terminee("h-4", moisPrecedent, "Dole", 40, "07:00", "10:00", 3)
    ]
  };
}

function lireFile(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const d = indexedDB.open("sereo-file-attente", 1);
    d.onerror = () => resolve([]);
    d.onsuccess = () => {
      const db = d.result;
      if (!db.objectStoreNames.contains("ecritures")) { db.close(); resolve([]); return; }
      const r = db.transaction("ecritures", "readonly").objectStore("ecritures").getAll();
      r.onsuccess = () => { db.close(); resolve(r.result); };
      r.onerror = () => { db.close(); resolve([]); };
    };
  }));
}

async function tournee(request, base, id = "r-1") {
  return (await (await request.get(`${base}/api/routes/${id}`)).json());
}

async function ouvrir(browser, base, { hash = "#livreur", viewport = { width: 1440, height: 900 }, theme = "light", options = {}, avant = null } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, timezoneId: "Europe/Paris", serviceWorkers: "block", ...options });
  await ctx.addInitScript((t) => { try { localStorage.setItem("sereo:colorScheme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(X);
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  if (avant) await avant(page, ctx);
  await page.goto(base + "/" + hash, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

// --- Contraste : le texte sur le premier fond opaque de ses ancetres. ------
function contrasteDe(page, selecteur) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rgb = (c) => (/rgba?\(([^)]+)\)/.exec(c) || [, ""])[1].split(",").map((v) => parseFloat(v));
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let fond = null;
    for (let n = el; n && !fond; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c.length < 4 || c[3] > 0.95)) fond = c;
    }
    fond = fond || [255, 255, 255];
    const texte = rgb(getComputedStyle(el).color);
    const [a, b] = [lum(texte), lum(fond)].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  }, selecteur);
}

test.describe("Tournée en cours — pratique au quotidien", () => {
  test.describe.configure({ mode: "serial" });
  let srv;
  test.beforeAll(async () => {
    srv = await demarrer({ port: 3332, seed: seedEnRoute(), routageAdaptatif: true });
  });
  test.afterAll(async () => { await srv?.arreter(); });

  test("heures d'arrivee par arret, km restants, heure de retour, trajet jusqu'au prochain", async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
    // Livre a X-10 : arrivee chez p-2 a X-10+15 = X+5 ; puis +6 (arret) +20 ;
    // puis +6 +5 ; retour +6 +25. Km restants : 12 + 30 + 2 + 25 = 69.
    const lignes = page.locator("#routeStopsList .route-stop");
    await expect(lignes).toHaveCount(4);
    await expect(lignes.nth(1)).toContainText(`vers ${heureParis(X + 5 * MIN)}`);
    await expect(lignes.nth(2)).toContainText(`vers ${heureParis(X + 31 * MIN)}`);
    await expect(lignes.nth(3)).toContainText(`vers ${heureParis(X + 42 * MIN)}`);
    // L'arret livre n'a pas d'heure.
    await expect(lignes.nth(0).locator(".route-stop-heure")).toHaveCount(0);
    await expect(page.locator("#currentClient .arret-heure")).toHaveText(`Arrivée prévue vers ${heureParis(X + 5 * MIN)}`);
    await expect(page.locator("#currentClient .arret-prochain-trajet")).toHaveText("30 km · environ 20 min");
    await expect(page.locator("#routeMetrics")).toContainText(`69 km restants · retour vers ${heureParis(X + 73 * MIN)}`);
    await expect(page.locator("#pageSubtitle")).toContainText(`69 km restants, retour vers ${heureParis(X + 73 * MIN)}`);
    // La ligne d'arret garde ses quatre informations (charte §4) : l'heure est DANS le detail.
    const infos = await lignes.nth(1).evaluate((e) => e.querySelector(".route-stop-main").children.length - 1 + e.querySelector(".route-stop-corps").children.length);
    expect(infos).toBe(4);
    expect(erreurs).toEqual([]);
    await ctx.close();
  });

  test("« Prevenir » : un SMS pret, numero du client et heure estimee, texte des Parametres", async ({ browser, request }) => {
    test.setTimeout(120000);
    let { ctx, page } = await ouvrir(browser, srv.base);
    await page.locator(".gestes-plus summary").click();
    const lien = page.locator("#prevenirButton");
    await expect(lien).toBeVisible();
    await expect(lien).toHaveText("Prévenir");
    const texte = `Bonjour, je passe vers ${heureParis(X + 5 * MIN)} pour votre livraison.`;
    await expect(lien).toHaveAttribute("href", `sms:0639980002?body=${encodeURIComponent(texte)}`);
    const boite = await lien.boundingBox();
    expect(boite.height).toBeGreaterThanOrEqual(44);
    // Un arret sans telephone : le lien se desactive (et le dit).
    await page.locator("#routeStopsList .route-stop").nth(3).locator(".route-stop-main").click();
    await expect(lien).toHaveAttribute("aria-disabled", "true");
    await expect(lien).not.toHaveAttribute("href", /.*/);
    await ctx.close();

    // Le texte des Parametres.
    const r = await request.patch(`${srv.base}/api/settings/tournee`, { data: { messagePrevenir: "Séréo : livraison vers {heure}, à tout de suite." } });
    expect(r.status()).toBe(200);
    ({ ctx, page } = await ouvrir(browser, srv.base));
    await expect(page.locator("#prevenirButton")).toHaveAttribute("href",
      `sms:0639980002?body=${encodeURIComponent(`Séréo : livraison vers ${heureParis(X + 5 * MIN)}, à tout de suite.`)}`);
    await ctx.close();
    await request.patch(`${srv.base}/api/settings/tournee`, { data: { messagePrevenir: "" } });
  });

  test("« Y aller » : l'application choisie est memorisee, vers les coordonnees, meme pour un lieu-dit", async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page } = await ouvrir(browser, srv.base, { hash: "#parametres" });
    const choix = page.locator("#parNavigation .par-segment");
    // Chrome de bureau : pas de Plans.
    await expect(choix).toHaveText(["Google Maps", "Waze"]);
    await expect(choix.nth(0)).toHaveAttribute("aria-pressed", "true");
    await choix.nth(1).click();
    await expect(choix.nth(1)).toHaveAttribute("aria-pressed", "true");
    // Memorise : un rechargement le garde.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("#parNavigation .par-segment").nth(1)).toHaveAttribute("aria-pressed", "true");

    await page.evaluate(() => { location.hash = "#livreur"; });
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__ouvert = []; window.open = (url) => { window.__ouvert.push(url); return null; }; });
    await page.locator("#mapsButton").click();
    // Le lieu-dit (p-4) : sans rue, le bouton restait grise ; il suit la position.
    await page.locator("#routeStopsList .route-stop").nth(3).locator(".route-stop-main").click();
    await expect(page.locator("#mapsButton")).toBeEnabled();
    await page.locator("#mapsButton").click();
    expect(await page.evaluate(() => window.__ouvert)).toEqual([
      "https://waze.com/ul?ll=47.238,6.024&navigate=yes",
      "https://waze.com/ul?ll=47.23,6.015&navigate=yes"
    ]);
    await ctx.close();

    // iPhone : Plans est propose.
    const iphone = await ouvrir(browser, srv.base, {
      hash: "#parametres", viewport: { width: 390, height: 844 },
      options: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" }
    });
    await expect(iphone.page.locator("#parNavigation .par-segment")).toHaveText(["Google Maps", "Waze", "Plans"]);
    await iphone.ctx.close();
  });

  test("« Faire maintenant » : l'arret passe en tete des restants ; hors ligne, le geste attend dans la file", async ({ browser, request }) => {
    test.setTimeout(150000);
    const { ctx, page } = await ouvrir(browser, srv.base);
    // Le premier restant (p-2) n'a pas le bandeau : il est deja en tete.
    await expect(page.locator("#currentClient .arret-hors-ordre")).toHaveCount(0);
    await page.locator("#routeStopsList .route-stop").nth(3).locator(".route-stop-main").click();
    const bouton = page.locator("#currentClient .arret-hors-ordre button");
    await expect(bouton).toHaveText("Faire maintenant");
    expect((await bouton.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await bouton.click();
    await expect.poll(async () => (await tournee(request, srv.base)).stops.map((s) => s.orderId)).toEqual(["p-1", "p-4", "p-2", "p-3"]);
    const apres = await tournee(request, srv.base);
    expect(apres.troncons).toHaveLength(5);
    // L'ecran suit : p-4 affiche, en tete des restants, avec son heure.
    await expect(page.locator("#currentClient .arret-nom")).toHaveText(dupont.nom);
    await expect(page.locator("#currentClient .arret-hors-ordre")).toHaveCount(0);
    await expect(page.locator("#currentClient .arret-heure")).toContainText("Arrivée prévue vers");

    // HORS LIGNE : p-3 (dernier) maintenant.
    await page.locator("#routeStopsList .route-stop").nth(3).locator(".route-stop-main").click();
    await ctx.setOffline(true);
    await page.locator("#currentClient .arret-hors-ordre button").click();
    await expect.poll(async () => (await lireFile(page)).length).toBe(1);
    const [entree] = await lireFile(page);
    expect(entree.url).toContain("/api/routes/r-1/stops/s-p-3/maintenant");
    expect(entree.entetes["X-Sereo-Geste"] || entree.entetes["x-sereo-geste"]).toBeTruthy();
    await expect(page.locator("#currentClient .arret-nom")).toHaveText(pharma.nom);
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await tournee(request, srv.base)).stops.map((s) => s.orderId), { timeout: 30000 }).toEqual(["p-1", "p-3", "p-4", "p-2"]);
    await expect.poll(async () => (await lireFile(page)).length).toBe(0);
    await ctx.close();
  });

  test("« Ajouter a la tournee en cours » : la commande urgente rejoint la tournee et part en livraison", async ({ browser, request }) => {
    test.setTimeout(120000);
    const { ctx, page } = await ouvrir(browser, srv.base);
    const bouton = page.locator('[data-action="ajouter-a-la-tournee"][data-order-id="u-1"]');
    await expect(bouton).toBeVisible();
    await expect(bouton).toHaveAccessibleName(`Ajouter à la tournée en cours : ${veto.nom}`);
    expect((await bouton.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await bouton.click();
    await expect.poll(async () => (await tournee(request, srv.base)).stops.some((s) => s.orderId === "u-1")).toBe(true);
    const r = await tournee(request, srv.base);
    const ajoute = r.stops.find((s) => s.orderId === "u-1");
    expect(ajoute.status).toBe("en_livraison");
    expect(r.troncons).toHaveLength(r.stops.length + 1);
    const commandes = await (await request.get(`${srv.base}/api/orders`)).json();
    expect(commandes.find((o) => o.id === "u-1").status).toBe("en_livraison");
    // Elle quitte les commandes pretes, et entre dans la liste des arrets.
    await expect(bouton).toHaveCount(0);
    await expect(page.locator("#routeStopsList .route-stop")).toHaveCount(5);
    await ctx.close();
  });

  test("« Reoptimiser les arrets restants » depuis la position GPS (arrondie) ; refuse hors ligne, rien en file", async ({ browser, request }) => {
    test.setTimeout(120000);
    const { ctx, page } = await ouvrir(browser, srv.base, {
      options: { geolocation: { latitude: 47.2512345, longitude: 6.0398765 }, permissions: ["geolocation"] }
    });
    const bouton = page.locator("#reoptimiserButton");
    await expect(bouton).toHaveText("Réoptimiser les arrêts restants");
    expect((await bouton.boundingBox()).height).toBeGreaterThanOrEqual(44);

    // Hors ligne d'abord : refuse avant tout envoi, la file reste vide.
    await ctx.setOffline(true);
    await bouton.click();
    await expect(page.locator("body")).toContainText("Hors ligne : réoptimiser demande le réseau");
    expect(await lireFile(page)).toEqual([]);
    await ctx.setOffline(false);
    // Reseau muet alors que le telephone se croit en ligne (4G sans debit) :
    // le lot 1 met en file tout echec d'envoi ; une reoptimisation, jamais.
    await page.route("**/api/routes/r-1/reoptimiser", (route) => route.abort("internetdisconnected"));
    await bouton.click();
    await expect(page.locator("body")).toContainText("Impossible de joindre le serveur");
    expect(await lireFile(page)).toEqual([]);
    await page.unroute("**/api/routes/r-1/reoptimiser");

    const envoi = page.waitForRequest((q) => q.url().endsWith("/api/routes/r-1/reoptimiser") && q.method() === "POST");
    await bouton.click();
    const corps = JSON.parse((await envoi).postData());
    expect(corps.position).toEqual({ lat: 47.251, lng: 6.04, label: "Ma position actuelle" });
    await expect.poll(async () => Boolean((await tournee(request, srv.base)).tronconsDepuis)).toBe(true);
    const r = await tournee(request, srv.base);
    // Les soldes restent en tete.
    expect(r.stops[0].orderId).toBe("p-1");
    expect(r.troncons).toHaveLength(r.stops.length + 1);
    await ctx.close();
  });

  test("historique : km, durees, et par mois un total par secteur", async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page } = await ouvrir(browser, srv.base);
    const panneau = page.locator("#tourneesHistorique");
    await panneau.locator("summary").click();
    const mois = page.locator("#tourneesHistoriqueContenu .trn-historique-mois");
    await expect(mois).toHaveCount(2);
    const dole = mois.first().locator('tr[data-secteur="Dole"]');
    await expect(dole.locator("td")).toHaveText(["2", "80,5 km", "6 h 15", "9"]);
    await expect(mois.first().locator('tr[data-secteur="Besancon"] td')).toHaveText(["1", "61,2 km", "4 h 30", "6"]);
    await expect(mois.first().locator(".trn-historique-total")).toHaveText("3 tournées · 141,7 km · 10 h 45 · 15 livrés");
    await expect(page.locator("#tourneesHistoriqueContenu .trn-historique-liste li")).toHaveCount(4);
    await ctx.close();
  });

  for (const theme of ["light", "dark"]) {
    test(`contraste >= 4,5:1 des textes du lot (${theme})`, async ({ browser }) => {
      test.setTimeout(120000);
      const { ctx, page } = await ouvrir(browser, srv.base, { theme });
      await page.locator("#tourneesHistorique summary").click();
      // Un arret hors ordre, pour le bandeau « Faire maintenant ».
      await page.locator("#routeStopsList .route-stop").nth(4).locator(".route-stop-main").click();
      const mesures = {};
      for (const sel of ["#routeStopsList .route-stop-heure", "#currentClient .arret-heure", "#currentClient .arret-hors-ordre span",
        "#currentClient .arret-hors-ordre button", "#tourneesHistoriqueContenu .trn-historique-total", "#tourneesHistoriqueContenu thead th",
        "#reoptimiserButton"]) {
        mesures[sel] = await contrasteDe(page, sel);
      }
      const faibles = Object.entries(mesures).filter(([, c]) => !(c >= 4.5));
      expect(faibles, JSON.stringify(mesures)).toEqual([]);
      await ctx.close();
    });
  }
});

test.describe("Préparer une tournée — dépôt par défaut, réoptimiser", () => {
  test.describe.configure({ mode: "serial" });
  let srv;
  test.beforeAll(async () => {
    srv = await demarrer({ port: 3333, routageAdaptatif: true, seed: { ...jeuDeDonnees(), routes: [], commandes: [
      commande("q-1", tilleuls, "pret_livraison"), commande("q-2", bellevue, "pret_livraison"),
      commande("q-3", ssiad, "pret_livraison"), commande("q-4", veto, "pret_livraison")
    ] } });
  });
  test.afterAll(async () => { await srv?.arreter(); });

  test("Parametres : le depot par defaut se cherche, se confirme, se memorise", async ({ browser, request }) => {
    test.setTimeout(120000);
    const { ctx, page, erreurs } = await ouvrir(browser, srv.base, {
      hash: "#parametres",
      avant: (p) => p.route("**/api/geocode?*", (route) => route.fulfill({ json: [{ label: DEPOT.label, lat: DEPOT.lat, lng: DEPOT.lng }] }))
    });
    await expect(page.locator("#parDepotActuel")).toHaveText("Aucun dépôt enregistré.");
    await expect(page.locator("#parRetourDepot")).toBeChecked();
    await page.locator("#parDepotRecherche").fill("Entrepôt");
    await page.locator('[data-action="par-depot-chercher"]').click();
    await page.locator("#parDepotResultats").selectOption("0");
    await expect(page.locator("#parDepotActuel")).toHaveText(`Dépôt : ${DEPOT.label}`);
    const reglages = await (await request.get(`${srv.base}/api/settings/tournee`)).json();
    expect(reglages.depot).toEqual(DEPOT);
    expect(reglages.retourAuDepot).toBe(true);
    expect(erreurs).toEqual([]);
    await ctx.close();
  });

  test("preparer une tournee en DEUX gestes : le depart est prerempli, le retour coche", async ({ browser, request }) => {
    test.setTimeout(120000);
    const { ctx, page } = await ouvrir(browser, srv.base);
    await expect(page.locator("#departureQuery")).toHaveValue(DEPOT.label);
    await expect(page.locator("#returnToStart")).toBeChecked();
    // Geste 1 : choisir les commandes. Geste 2 : creer.
    await page.getByRole("button", { name: "Tout sélectionner", exact: true }).click();
    await page.locator("#createRouteButton").click();
    await expect.poll(async () => (await (await request.get(`${srv.base}/api/routes`)).json()).length).toBe(1);
    const [r] = await (await request.get(`${srv.base}/api/routes`)).json();
    expect(r.departure).toMatchObject({ label: DEPOT.label, lat: DEPOT.lat, lng: DEPOT.lng });
    expect(r.arrival).toMatchObject({ label: DEPOT.label, lat: DEPOT.lat, lng: DEPOT.lng });
    expect(r.stops).toHaveLength(4);
    expect(r.troncons).toHaveLength(5);
    // Sur une tournee prete, pas d'« Ajouter a la tournee en cours ».
    await expect(page.locator('[data-action="ajouter-a-la-tournee"]')).toHaveCount(0);
    await ctx.close();
  });

  test("« Reoptimiser » une tournee prete, depuis un autre depart (ma position)", async ({ browser, request }) => {
    test.setTimeout(120000);
    const { ctx, page } = await ouvrir(browser, srv.base, {
      options: { geolocation: { latitude: 47.0921, longitude: 5.4899 }, permissions: ["geolocation"] }
    });
    const bouton = page.locator("#reoptimiserButton");
    await expect(bouton).toHaveText("Réoptimiser");
    await bouton.click();
    const dialogue = page.locator("#reoptimiserDialog");
    await expect(dialogue).toBeVisible();
    // Le depot EST le depart prevu : il n'est propose qu'une fois.
    await expect(dialogue.locator(".reopt-choix")).toHaveText([`Le départ prévu : ${DEPOT.label}`, "Ma position actuelle"]);
    await dialogue.getByLabel("Ma position actuelle").check();
    await dialogue.getByRole("button", { name: "Réoptimiser" }).click();
    await expect(dialogue).toBeHidden();
    const [r] = await (await request.get(`${srv.base}/api/routes`)).json();
    expect(r.departure).toMatchObject({ label: "Ma position actuelle", lat: 47.092, lng: 5.49 });
    // Une tournee qui revenait a son depart revient au nouveau.
    expect(r.arrival).toMatchObject({ label: "Ma position actuelle" });
    // Depuis Dole et retour a Dole : Bellevue (a Dole) ouvre ou ferme la
    // boucle (les deux sens coutent pareil) ; depuis Besancon, elle etait au milieu.
    expect([r.stops[0].orderId, r.stops.at(-1).orderId]).toContain("q-2");
    expect(r.troncons).toHaveLength(5);
    await ctx.close();
  });

  test("« retour au depot » coche par defaut : confirmer une AUTRE arrivee le decoche, sans toucher au reglage", async ({ browser, request }) => {
    test.setTimeout(120000);
    const { ctx, page } = await ouvrir(browser, srv.base, {
      avant: (p) => p.route("**/api/geocode?*", (route) => route.fulfill({ json: [{ label: "Arrivée ailleurs", lat: 47.1, lng: 5.9 }] }))
    });
    await page.locator("#routePlanning > summary").evaluate((s) => { s.parentElement.open = true; });
    await expect(page.locator("#returnToStart")).toBeChecked();
    await page.locator("#arrivalQuery").fill("Ailleurs");
    await page.locator('[data-op="search-arrival"]').click();
    await page.locator("#arrivalResults").selectOption("0");
    await expect(page.locator("#returnToStart")).not.toBeChecked();
    await page.waitForTimeout(500);
    expect((await (await request.get(`${srv.base}/api/settings/tournee`)).json()).retourAuDepot).toBe(true);
    await ctx.close();
  });

  test("« retour au depot » : decoche dans la preparation, c'est memorise", async ({ browser, request }) => {
    test.setTimeout(120000);
    let { ctx, page } = await ouvrir(browser, srv.base);
    await page.locator("#routePlanning > summary").evaluate((s) => { s.parentElement.open = true; });
    await page.locator("#returnToStart").uncheck();
    await expect.poll(async () => (await (await request.get(`${srv.base}/api/settings/tournee`)).json()).retourAuDepot).toBe(false);
    await ctx.close();
    ({ ctx, page } = await ouvrir(browser, srv.base));
    await expect(page.locator("#returnToStart")).not.toBeChecked();
    await ctx.close();
  });
});

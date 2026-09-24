// Poids du reseau a l'ouverture (24/09, mesure en production).
//
// Sur un jeu de MEME FORME que la production (jeu-production.js), ce que la
// page demande a l'ouverture du tableau de bord : des requetes et des octets,
// comptes a la reponse -- pas des millisecondes. Avant ce lot : 27 requetes
// d'API et 2,0 Mo de JSON a lire a chaque ouverture, dont /api/ventes et
// /api/historique (deux ecrans que la navigation n'ouvre pas), 633 mouvements
// pour 12 montres, l'image de marque en base64, une tuile de carte cachee, et
// les lectures des Parametres (deux fois /api/storage/status et /api/comptes).
//
// Chaque cas a son temoin : ce qui ne part plus a l'ouverture arrive quand
// l'ecran qui le montre s'affiche, et s'y voit.

const http = require("node:http");
const { once } = require("node:events");
const { test, expect, compteurTuiles, remettreCompteurAZero } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => {
  srv = await demarrer({ port: 3566, volume: "production" });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

/** Les reponses d'API de la page : chemin (avec la requete) et octets du corps. */
function journalDesReponses(page) {
  const reponses = [];
  page.on("response", async reponse => {
    const url = new URL(reponse.url());
    if (!url.pathname.startsWith("/api/")) return;
    const entree = { chemin: url.pathname + url.search, octets: 0 };
    reponses.push(entree);
    try { entree.octets = (await reponse.body()).length; } catch { /* corps indisponible (304, redirection) */ }
  });
  return reponses;
}

async function ouvrir(page, ancre = "journee") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${srv.base}/#${ancre}`, { waitUntil: "networkidle" });
  await expect(page.locator("#syncStatus")).toHaveText(/^À jour/);
}

test("à l'ouverture, la page ne demande que ce que l'écran montre", async ({ page }) => {
  remettreCompteurAZero();
  const demandes = [];
  page.on("request", r => demandes.push(new URL(r.url()).pathname + new URL(r.url()).search));
  const reponses = journalDesReponses(page);
  await ouvrir(page);
  await page.waitForTimeout(500);
  const chemins = reponses.map(r => r.chemin);
  const total = reponses.reduce((s, r) => s + r.octets, 0);
  console.log(`[poids] ouverture : ${reponses.length} reponses d'API, ${total} o de JSON ; ${chemins.sort().join(" ")}`);

  // Temoin : l'instrument voit les reponses et leurs corps.
  expect(reponses.find(r => r.chemin === "/api/orders")?.octets, "prealable : /api/orders lue").toBeGreaterThan(100000);

  // `soft` : chaque cause se lit seule (sur l'ancien code, toutes a la fois).
  expect.soft(chemins.filter(c => /^\/api\/(ventes|historique)(\?|$)/.test(c)), "des ecrans inatteignables chargent leurs donnees").toEqual([]);
  expect.soft(chemins.filter(c => /^\/api\/(imports\/archives|comptes)(\?|\/|$)/.test(c)), "les lectures des Parametres partent hors des Parametres").toEqual([]);
  expect.soft(chemins.filter(c => c === "/api/storage/status"), "/api/storage/status (banniere de recuperation) : une fois").toHaveLength(1);
  expect.soft(chemins.filter(c => c.startsWith("/api/stock-movements")), "les mouvements : les 12 montres").toEqual(["/api/stock-movements?limite=12"]);
  expect.soft(reponses.find(r => r.chemin === "/api/settings/appearance")?.octets, "l'image de marque voyage dans les reglages").toBeLessThan(1000);
  expect.soft(total, "JSON d'API lu a l'ouverture (avant : 1 986 049 o)").toBeLessThan(1000000);
  // Ni tuile, ni image de marque : la carte et l'apercu du logo sont caches.
  expect.soft(compteurTuiles(), "une tuile part pour une carte cachee").toBe(0);
  expect.soft(chemins.filter(c => c === "/api/carte/fond"), "le fond de carte est demande pour une carte cachee").toEqual([]);
  expect.soft(demandes.filter(c => /^\/(brand\/sereo-logo|api\/settings\/appearance\/image)/.test(c)), "le logo des Parametres part a l'ouverture").toEqual([]);

  // Ce que l'ecran montre reste montre : le compte des ventes importees.
  await expect(page.locator("#dailySummary")).toContainText("429 ligne(s) importée(s)");
});

test("les Paramètres lisent leurs données en s'affichant, et les montrent", async ({ page }) => {
  await ouvrir(page);
  const reponses = journalDesReponses(page);
  await page.evaluate(() => { location.hash = "#parametres"; });
  await expect(page.locator("#parametres")).toHaveClass(/active/);
  await expect.poll(() => reponses.map(r => r.chemin).filter(c => /^\/api\/(imports\/archives|comptes|storage\/status)$/.test(c)).sort())
    .toEqual(["/api/comptes", "/api/imports/archives", "/api/storage/status"]);
  // Les archives s'affichent (la plus recente en tete) ; l'etat du calcul routier aussi.
  const archives = await (await page.request.get(`${srv.base}/api/imports/archives`)).json();
  expect(archives.length, "prealable : le jeu a des archives d'import").toBeGreaterThan(100);
  await expect(page.locator("#importsArchivesList")).toContainText(archives[0].filename);
  await expect(page.locator("#calculRoutierEtat")).not.toHaveText("");
  // L'apercu du logo : l'image importee, servie a son adresse, se dessine.
  await page.locator("#parametres details", { has: page.locator("#brandPreviewImage") }).locator("summary").click();
  const apercu = page.locator("#brandPreviewImage");
  await expect(apercu).toHaveAttribute("src", /^\/api\/settings\/appearance\/image\?v=[0-9a-f]{16}$/);
  await expect.poll(() => apercu.evaluate(img => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator("#brandImageStatus")).toHaveText("Image personnalisée active pour l'application.");
});

// Temoins (verts avant comme apres) : ce que l'ecran montre n'a pas change.
test("témoin : l'écran Stock montre les 12 mouvements les plus récents, comme avant", async ({ page }) => {
  await ouvrir(page, "stock");
  const tous = await (await page.request.get(`${srv.base}/api/stock-movements`)).json();
  expect(tous.length, "prealable : la liste complete").toBe(633);
  const lignes = page.locator("#stockMovementList .item h4");
  await expect(lignes).toHaveCount(12);
  await expect(lignes).toHaveText(tous.slice(0, 12).map(m => m.productName));
});

// Le rouge de la tuile est au premier cas (« une tuile part pour une carte
// cachee ») ; celui-ci garde qu'elle arrive quand la Tournee s'affiche.
test("témoin : la Tournée affichée demande son fond de carte, et le dessine", async ({ page }) => {
  await ouvrir(page);
  remettreCompteurAZero();
  await page.waitForTimeout(300);
  expect(compteurTuiles(), "prealable : aucune tuile avant la Tournee").toBe(0);
  await page.evaluate(() => { location.hash = "#livreur"; });
  await expect.poll(compteurTuiles, { message: "la Tournee affichee n'a pas de fond de carte" }).toBeGreaterThan(0);
  await expect(page.locator("#map .leaflet-tile-loaded").first()).toBeVisible();
});

// Revue adverse du lot (24/09) : la PREMIERE ouverture de cette version, sur
// un appareil dont le cache de donnees vient d'avant. Il a la liste entiere
// des mouvements (/api/stock-movements), les ventes et l'historique, pas
// l'adresse neuve (?limite=12). Avant le correctif : le chargement instantane
// sautait (tout ou rien), un reseau de plus de 3 s laissait « Partiel
// (1 indispo) » jusqu'au chargement suivant, et les trois copies restaient
// dans le cache jusqu'a la fin de la session.
//
// Un mandataire (port 3567) retient les requetes d'API : celles que le service
// worker emet lui-meme ne passent pas par `page.route`.
async function mandataire(cible, port) {
  const attente = [];
  let retenir = null;
  const server = http.createServer((req, res) => {
    const passer = () => {
      const amont = http.request(cible + req.url, { method: req.method, headers: req.headers }, r => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      amont.on("error", () => res.destroy());
      req.pipe(amont);
    };
    if (retenir && retenir.test(req.url)) attente.push(passer);
    else passer();
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    base: `http://127.0.0.1:${port}`,
    retenir(motif) { retenir = motif; },
    liberer() { retenir = null; for (const f of attente.splice(0)) f(); },
    async arreter() {
      this.liberer();
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  };
}

const COPIES_D_AVANT = ["/api/historique", "/api/stock-movements", "/api/ventes"];

/** Les adresses du cache de donnees du service worker (avec la requete). */
function clesDuCache(page) {
  return page.evaluate(async () => {
    const cles = [];
    for (const nom of (await caches.keys()).filter(n => n.startsWith("sereo-api-"))) {
      for (const r of await (await caches.open(nom)).keys()) cles.push(new URL(r.url).pathname + new URL(r.url).search);
    }
    return cles.sort();
  });
}

test("première ouverture après la mise à jour : la copie d'avant sert encore, puis s'en va", async ({ browser }) => {
  test.setTimeout(120000);
  const mdt = await mandataire(srv.base, 3567);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.goto(mdt.base + "/", { waitUntil: "networkidle" });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("#syncStatus")).toHaveText(/^À jour/);
    const chiffre = await page.locator("#opRevenue").textContent();
    expect(chiffre, "prealable : un chiffre au tableau de bord").not.toBe("—");

    // Le cache d'une version d'avant : ses trois adresses, rangees par le
    // service worker au passage ; l'adresse neuve retiree.
    await page.evaluate(async chemins => { for (const c of chemins) await fetch(c); }, COPIES_D_AVANT);
    await expect.poll(() => clesDuCache(page)).toEqual(expect.arrayContaining(COPIES_D_AVANT));
    await page.evaluate(async () => {
      const nom = (await caches.keys()).find(n => n.startsWith("sereo-api-"));
      await (await caches.open(nom)).delete("/api/stock-movements?limite=12");
    });
    expect(await clesDuCache(page), "prealable : l'adresse neuve est encore en cache").not.toContain("/api/stock-movements?limite=12");
    const tous = await (await page.request.get(`${srv.base}/api/stock-movements`)).json();

    mdt.retenir(/^\/api\//);
    await page.reload({ waitUntil: "domcontentloaded" });
    // 1. Le chargement instantane : le chiffre du cache AVANT le reseau (sous
    //    2 s : le repli de 3 s du service worker ne peut pas l'expliquer), et
    //    les 12 memes mouvements, tires de la liste entiere.
    await expect.soft(page.locator("#opRevenue"), "le chargement instantane saute").toHaveText(chiffre, { timeout: 2000 });
    await expect.soft(page.locator("#stockMovementList .item h4"), "les mouvements de la copie d'avant")
      .toHaveText(tous.slice(0, 12).map(m => m.productName), { timeout: 2000 });
    // 2. Au-dela de 3 s, le service worker rend ses copies ; l'adresse neuve
    //    n'en a pas, la page prend celle d'avant.
    await page.waitForTimeout(4500);
    expect.soft(await page.locator("#syncStatus").textContent(), "une section « indisponible » alors que sa copie est la")
      .toMatch(/^Données (de|du) /);
    // 3. Le reseau repond enfin : les reponses tardives remplacent les copies.
    mdt.liberer();
    await expect.soft(page.locator("#syncStatus"), "l'ecran reste « Partiel » apres les reponses tardives")
      .toHaveText(/^À jour/, { timeout: 15000 });

    // 4. L'ouverture suivante (l'adresse neuve est rangee) oublie les copies d'avant.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("#syncStatus")).toHaveText(/^À jour/);
    await expect.poll(async () => (await clesDuCache(page)).filter(c => COPIES_D_AVANT.includes(c)),
      { message: "les copies d'avant restent dans le cache", timeout: 5000 }).toEqual([]);
    // Temoin : le reste du cache est la.
    const cles = await clesDuCache(page);
    expect(cles).toContain("/api/stock-movements?limite=12");
    expect(cles).toContain("/api/clients");
  } finally {
    await ctx.close();
    await mdt.arreter();
  }
});

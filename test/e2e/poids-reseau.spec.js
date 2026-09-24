// Poids du reseau a l'ouverture (24/09, mesure en production).
//
// Sur un jeu de MEME FORME que la production (jeu-production.js), ce que la
// page demande a l'ouverture du tableau de bord : des requetes et des octets,
// comptes a la reponse -- pas des millisecondes. Avant ce lot : 27 requetes
// d'API et 2,1 Mo de JSON a lire a chaque ouverture, dont /api/ventes et
// /api/historique (deux ecrans que la navigation n'ouvre pas), 633 mouvements
// pour 12 montres, l'image de marque en base64, une tuile de carte cachee, et
// les lectures des Parametres (deux fois /api/storage/status et /api/comptes).
//
// Chaque cas a son temoin : ce qui ne part plus a l'ouverture arrive quand
// l'ecran qui le montre s'affiche, et s'y voit.

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

  expect(chemins.filter(c => /^\/api\/(ventes|historique)(\?|$)/.test(c)), "des ecrans inatteignables chargent leurs donnees").toEqual([]);
  expect(chemins.filter(c => /^\/api\/(imports\/archives|comptes)(\?|\/|$)/.test(c)), "les lectures des Parametres partent hors des Parametres").toEqual([]);
  expect(chemins.filter(c => c === "/api/storage/status"), "/api/storage/status (banniere de recuperation) : une fois").toHaveLength(1);
  expect(chemins.filter(c => c.startsWith("/api/stock-movements")), "les mouvements : les 12 montres").toEqual(["/api/stock-movements?limite=12"]);
  expect(total, "JSON d'API lu a l'ouverture (avant : 2 098 944 o)").toBeLessThan(1000000);
  // Ni tuile, ni image de marque : la carte et l'apercu du logo sont caches.
  expect(compteurTuiles(), "une tuile part pour une carte cachee").toBe(0);
  expect(demandes.filter(c => /^\/(brand\/sereo-logo|api\/settings\/appearance\/image)/.test(c)), "le logo des Parametres part a l'ouverture").toEqual([]);

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
  // Les archives s'affichent (123 dans le jeu) ; l'etat du calcul routier aussi.
  await expect(page.locator("#importsArchivesList")).toContainText("Export_ventes_Ximi");
  await expect(page.locator("#calculRoutierEtat")).not.toHaveText("");
  // L'apercu du logo : l'image importee, servie a son adresse, se dessine.
  await page.locator("#parametres details", { has: page.locator("#brandPreviewImage") }).locator("summary").click();
  const apercu = page.locator("#brandPreviewImage");
  await expect(apercu).toHaveAttribute("src", /^\/api\/settings\/appearance\/image\?v=[0-9a-f]{16}$/);
  await expect.poll(() => apercu.evaluate(img => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator("#brandImageStatus")).toHaveText("Image personnalisée active pour l'application.");
});

test("l'écran Stock montre les 12 mouvements les plus récents, comme avant", async ({ page }) => {
  await ouvrir(page, "stock");
  const tous = await (await page.request.get(`${srv.base}/api/stock-movements`)).json();
  expect(tous.length, "prealable : la liste complete").toBe(633);
  const lignes = page.locator("#stockMovementList .item h4");
  await expect(lignes).toHaveCount(12);
  await expect(lignes).toHaveText(tous.slice(0, 12).map(m => m.productName));
});

test("la carte ne demande son fond qu'à l'affichage de la Tournée", async ({ page }) => {
  await ouvrir(page);
  remettreCompteurAZero();
  await page.waitForTimeout(300);
  expect(compteurTuiles(), "prealable : aucune tuile avant la Tournee").toBe(0);
  await page.evaluate(() => { location.hash = "#livreur"; });
  await expect.poll(compteurTuiles, { message: "la Tournee affichee n'a pas de fond de carte" }).toBeGreaterThan(0);
  await expect(page.locator("#map .leaflet-tile-loaded").first()).toBeVisible();
});

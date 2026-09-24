// E2E : la carte « Chiffre d'affaires livre » n'a plus de vide sous son
// histogramme au bureau (demande de Thomas, 24/09).
//
// Mesure en production (v1.45.1) : a 1440, 1920 et 2560 px, la carte s'etirait
// a la hauteur de la colonne de droite (deux tuiles + « Tournee du jour ») et
// l'histogramme, fixe a 150 px, laissait 273 a 293 px VIDES dessous. La planche
// 6a fixe 150 px parce que sa carte de tournee est plus courte ; dans l'app,
// celle-ci porte « Prochain », les arrets et « Ouvrir la carte ».

const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3541 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

for (const [largeur, hauteur] of [[1440, 900], [1920, 1080]]) {
  test(`à ${largeur} px, l'histogramme remplit la carte du chiffre d'affaires`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: hauteur });
    await page.goto(srv.base + "/#journee", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const carte = document.querySelector("#journee .tb-ca");
      const tetes = carte.querySelector(".tb-ca-tetes").getBoundingClientRect();
      const graphe = document.getElementById("revenueChart").getBoundingClientRect();
      const b = carte.getBoundingClientRect();
      const cs = getComputedStyle(carte);
      const col = document.querySelector("#journee .tb-colonne").getBoundingClientRect();
      const bas = b.bottom - parseFloat(cs.paddingBottom);
      return {
        carte: Math.round(b.height), colonne: Math.round(col.height), graphe: Math.round(graphe.height),
        // Ce qu'il faudrait a la carte avec un histogramme de 150 px.
        naturel: Math.round(tetes.height + parseFloat(cs.rowGap || cs.gap || 0) + 150 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)),
        vide: Math.round(bas - graphe.bottom)
      };
    });
    console.log(`[carte CA ${largeur}] carte ${m.carte}, colonne ${m.colonne}, naturel ${m.naturel}, graphe ${m.graphe}, vide ${m.vide}`);
    // Prealable : la colonne de droite rend la carte plus haute que son contenu
    // a 150 px -- sinon il n'y a rien a remplir et le cas ne distinguerait rien.
    expect(m.colonne, "prealable : la colonne de droite etire la carte").toBeGreaterThan(m.naturel + 40);
    expect(m.vide, "aucun vide sous l'histogramme").toBeLessThanOrEqual(2);
    expect(m.graphe, "jamais plus petit que la planche").toBeGreaterThanOrEqual(150);
  });
}

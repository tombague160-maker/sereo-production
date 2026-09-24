// E2E : l'ouverture de l'application ne dessine plus l'historique (24/09).
//
// Mesure en production (v1.45.0) : a l'ouverture, UNE tache de 2,4 s au bureau
// et d'environ 16 s sur un processeur de telephone (CPU ralenti x4), toute dans
// renderHistorique. Elle ajoutait chaque ligne par `innerHTML +=`, qui relit et
// redessine toute la liste a chaque ligne : un cout au carre du nombre de
// lignes. Et l'ecran #historique n'est meme pas atteignable (absent de
// mainTabs) : ce travail etait fait pour rien, a chaque chargement.

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const N = 4000;
let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  seed.historique = Array.from({ length: N }, (_, i) => ({
    id: `h-${i}`, date: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    type: i % 2 ? "Livraison" : "Stock", message: `Evenement numero ${i} du journal de test`
  }));
  srv = await demarrer({ port: 3540, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

test("à l'ouverture, l'historique (4 000 lignes) n'est pas dessiné et ne fige pas la page", async ({ page }) => {
  test.setTimeout(240000);
  await page.addInitScript(() => {
    window.__longues = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__longues.push(Math.round(e.duration)); })
      .observe({ type: "longtask", buffered: true });
  });
  await page.goto(srv.base + "/#journee", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  // Temoin : les donnees sont bien arrivees (sinon rien ne serait distingue).
  const recues = await page.evaluate(async () => (await (await fetch("/api/historique")).json()).length);
  expect(recues).toBe(4000);
  const r = await page.evaluate(() => ({
    lignes: document.querySelectorAll("#historiqueList .history-cell").length,
    pire: Math.max(0, ...window.__longues)
  }));
  console.log(`[historique] cellules dessinees ${r.lignes}, pire tache longue ${r.pire} ms`);
  expect(r.lignes, "l'ecran cache n'est pas dessine").toBe(0);
  expect(r.pire, "aucune tache ne fige la page une seconde").toBeLessThan(1000);
});

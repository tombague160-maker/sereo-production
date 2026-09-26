// E2E : l'ouverture de l'application ne dessine plus l'historique (24/09).
//
// Mesure en production (v1.45.0) : a l'ouverture, UNE tache de 2,4 s au bureau
// et d'environ 16 s sur un processeur de telephone (CPU ralenti x4), toute dans
// renderHistorique. Elle ajoutait chaque ligne par `innerHTML +=`, qui relit et
// redessine toute la liste a chaque ligne : un cout au carre du nombre de
// lignes. Et l'ecran #historique n'est meme pas atteignable (absent de
// mainTabs) : ce travail etait fait pour rien, a chaque chargement.
//
// Integration du 24/09 (lot « donnees utiles ») : l'ecran #historique et
// renderHistorique sont retires, et /api/historique ne part plus au
// chargement. Le banc de la v1.45.1 comptait des cellules d'un ecran qui
// n'existe plus : il serait vert sans rien distinguer. Il juge desormais ce que
// les deux changements promettent ensemble -- rien n'est CHARGE ni dessine a
// l'ouverture -- et, en temoin positif, que ces 4 000 lignes se lisent par
// pages dans le Journal de Parametres sans figer la page.

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

/** Les taches longues de la page, relevees des le premier octet. */
async function releverTachesLongues(page) {
  await page.addInitScript(() => {
    window.__longues = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__longues.push(Math.round(e.duration)); })
      .observe({ type: "longtask", buffered: true });
  });
}

/** Les chemins /api/... demandes par la page, dans l'ordre. */
function releverRequetes(page) {
  const vues = [];
  page.on("request", r => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) vues.push(u.pathname + u.search);
  });
  return vues;
}

test("à l'ouverture, l'historique (4 000 lignes) n'est ni chargé ni dessiné, et ne fige pas la page", async ({ page }) => {
  test.setTimeout(240000);
  await releverTachesLongues(page);
  const vues = releverRequetes(page);
  await page.goto(srv.base + "/#journee", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const auChargement = [...vues];
  // Temoin : les donnees sont bien sur le serveur (sinon rien ne serait distingue).
  const recues = await page.evaluate(async () => (await (await fetch("/api/historique")).json()).length);
  expect(recues).toBe(N);
  // Temoin : le chargement a bien eu lieu (sinon « aucune requete » ne dirait rien).
  expect(auChargement.some(u => u.startsWith("/api/orders")), "le chargement de l'application est parti").toBe(true);
  expect(auChargement.filter(u => /^\/api\/(historique|journal)/.test(u)), "l'historique ne part pas a l'ouverture").toEqual([]);
  const r = await page.evaluate(() => ({
    cellules: document.querySelectorAll(".history-cell, #historiqueList, #parJournal .par-journal-ligne").length,
    pire: Math.max(0, ...window.__longues)
  }));
  console.log(`[historique] a l'ouverture : ${r.cellules} ligne(s) dessinee(s), pire tache longue ${r.pire} ms`);
  expect(r.cellules, "rien de l'historique n'est dessine").toBe(0);
  expect(r.pire, "aucune tache ne fige la page une seconde").toBeLessThan(1000);
});

test("Paramètres : le Journal lit une page de 200 des 4 000 lignes (décision 10), sans figer la page", async ({ page }) => {
  test.setTimeout(240000);
  await releverTachesLongues(page);
  const vues = releverRequetes(page);
  await page.goto(srv.base + "/#parametres", { waitUntil: "networkidle" });
  const lignes = page.locator("#parJournal .par-journal-ligne");
  await expect(lignes.first()).toBeVisible();
  await expect(lignes).toHaveCount(200);
  // La plus recente d'abord : la derniere ligne semee.
  await expect(lignes.first()).toContainText(`Evenement numero ${N - 1} du journal de test`);
  expect(vues.filter(u => /^\/api\/historique/.test(u)), "le journal ne recharge pas tout l'historique").toEqual([]);
  expect(vues.filter(u => u.startsWith("/api/journal"))).toEqual(["/api/journal?genre=actions&limite=200"]);
  const pire = await page.evaluate(() => Math.max(0, ...window.__longues));
  console.log(`[historique] Journal de Parametres : 200 lignes, pire tache longue ${pire} ms`);
  expect(pire, "aucune tache ne fige la page une seconde").toBeLessThan(1000);
});

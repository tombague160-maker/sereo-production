// Deux gains de performance mesures le 23/09, tenus par des bancs.
//
// 1. La compression : Node envoyait tout brut (750 Ko par chargement).
// 2. Les ecrans decroches (anciennes listes de commandes, produits, alertes) ne
//    se dessinent plus : sur 2 000 commandes ils faisaient 78 000 elements sur
//    108 000, et une tache de ~300 ms au demarrage.

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

// En serie : deux workers demarraient chacun un serveur sur le meme port.
test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  const base = seed.commandes[0];
  for (let i = 0; i < 300; i++) seed.commandes.push({ ...base, id: `o-p${i}`, numero: `CMD-2026-7${String(i).padStart(3, "0")}`, status: "livre", deliveredAt: null });
  srv = await demarrer({ port: 3168, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

test("les fichiers texte partent compressés", async ({ page }) => {
  for (const chemin of ["/", "/css/style.css", "/js/app.js"]) {
    const r = await page.request.get(srv.base + chemin, { headers: { "Accept-Encoding": "gzip" } });
    expect(r.headers()["content-encoding"], chemin).toBe("gzip");
  }
});

test("les écrans décrochés ne se dessinent pas", async ({ page }) => {
  await page.goto(srv.base + "/#commandes", { waitUntil: "networkidle" });
  await expect(page.locator("#cmdLignes .cmd-ligne").first()).toBeVisible();
  // Les quatre anciennes listes de commandes (bdc-list, commandesLivreesList,
  // todayOrdersList, plannedOrdersList) ont quitte la page le 23/09 : un
  // identifiant absent rendait -1 ici, un vert qui ne mesurait plus rien.
  // Leur absence est tenue par ecrans-sans-planche.spec.js.
  const r = await page.evaluate(() => Object.fromEntries(["produitsList", "alertesList"]
    .map(id => [id, document.getElementById(id)?.getElementsByTagName("*").length ?? -1])));
  // Les deux ecrans restants existent : sans eux, le -1 passerait aussi.
  for (const [id, n] of Object.entries(r)) expect(n, `${id} absent`).toBeGreaterThanOrEqual(0);
  // Au plus les squelettes de chargement : aucune ligne de donnees.
  for (const [id, n] of Object.entries(r)) expect(n, id).toBeLessThan(40);
  // Et l'ecran qui porte ces commandes, lui, les montre (le filtre « Livrees »).
  await page.locator('[data-cmd-filtre="livrees"]').click();
  expect(await page.locator("#cmdLignes .cmd-ligne").count()).toBeGreaterThan(0);
});

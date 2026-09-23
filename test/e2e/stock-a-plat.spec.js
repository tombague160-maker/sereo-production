// E2E : le Stock « a plat » (planche 10a, 23/09).
//
// Sans categorie -- ou avec une seule --, des tuiles ne trient rien. Avant ce
// lot, l'ecran montrait une tuile « Sans categorie · 200 » au-dessus d'un
// tableau qui disait deja tout, et le sous-titre comptait « 1 categorie ».
// La planche : une carte qui dit ce qui manque et comment le retrouver, puis
// les produits a plat, « du plus bas au plus haut », sous le seuil en premier.
//
// Le temoin (plusieurs categories : des tuiles, pas de carte) est dans
// stock.spec.js, sur son propre jeu.

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

// Aucune categorie. Trois produits sous le seuil, un a renseigner, deux au-dessus,
// semes dans le DESORDRE : l'ordre du fichier ne doit pas etre celui de l'ecran.
const STOCK = [
  { id: "p-masques", code: "MA-CHI-2R", nom: "Masques chirurgicaux type IIR", quantite: 64, alertThreshold: 50 },
  { id: "p-alese", code: "AL-6090", nom: "Alèses jetables 60 × 90", quantite: 18, alertThreshold: 25 },
  { id: "p-inconnu", code: "INC-1", nom: "Article à renseigner", quantite: null, alertThreshold: 5 },
  { id: "p-change", code: "CH-MOL-L", nom: "Changes molletonnés taille L", quantite: 42, alertThreshold: 30 },
  { id: "p-gants", code: "GN-M", nom: "Gants nitrile taille M", quantite: 2, alertThreshold: 20 },
  { id: "p-desinf", code: "DS-5", nom: "Désinfectant surfaces 5 L", quantite: 7, alertThreshold: 15 }
];

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  seed.stock = STOCK.map(p => ({ ...p }));
  srv = await demarrer({ port: 3184, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(page, largeur = 1440) {
  await page.setViewportSize({ width: largeur, height: largeur > 820 ? 900 : 844 });
  await page.goto(srv.base + "/#stock", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}

const noms = page => page.locator("#stockList .stk-ligne .stk-nom").allTextContents();

for (const largeur of [1440, 390]) {
  test(`sans catégorie, à ${largeur} px : pas de tuile, la carte dit ce qui manque`, async ({ page }) => {
    await ouvrir(page, largeur);
    await expect(page.locator("#stkCategories")).toBeHidden();
    await expect(page.locator("#stock .stk-tuile")).toHaveCount(0);
    await expect(page.locator("#stkCategoriesTete")).toBeHidden();
    const carte = page.locator("#stkAPlat");
    await expect(carte).toBeVisible();
    await expect(carte.locator("h3")).toHaveText("Pas de catégories dans ce fichier");
    await expect(carte).toContainText("colonne « Catégorie »");
    await expect(page.locator("#pageSubtitle")).toHaveText("6 références · 3 sous le seuil · sans catégorie");
    // La carte ne deborde pas, et tient dans la grille.
    const boite = await carte.boundingBox();
    expect(boite.x + boite.width).toBeLessThanOrEqual(largeur);
  });
}

test("à plat : sous le seuil d'abord, du plus bas au plus haut", async ({ page }) => {
  await ouvrir(page);
  expect(await noms(page)).toEqual([
    "Gants nitrile taille M",
    "Désinfectant surfaces 5 L",
    "Alèses jetables 60 × 90",
    "Article à renseigner À renseigner",
    "Changes molletonnés taille L",
    "Masques chirurgicaux type IIR"
  ]);
});

test("une seule catégorie : à plat aussi, et la carte la nomme", async ({ page }) => {
  // Le meme jeu, relu avec une categorie unique : l'API est reecrite a la
  // volee plutot que de semer un second serveur.
  await page.route("**/api/stock", async route => {
    const reponse = await route.fetch();
    const produits = await reponse.json();
    await route.fulfill({ response: reponse, json: produits.map(p => ({ ...p, category: "Hygiène" })) });
  });
  await ouvrir(page, 390);
  await expect(page.locator("#stock .stk-tuile")).toHaveCount(0);
  await expect(page.locator("#stkAPlat h3")).toHaveText("Une seule catégorie : Hygiène");
  await expect(page.locator("#pageSubtitle")).toHaveText("6 références · 3 sous le seuil · 1 catégorie");
  expect((await noms(page))[0]).toBe("Gants nitrile taille M");
});

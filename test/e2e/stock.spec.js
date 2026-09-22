// E2E : l'ecran Stock des planches 13d / 14d.
//
// La planche fusionne « stock » et « a recommander » : une carte, des tuiles
// de categorie, un tableau. Ce banc verifie ce qu'elle promet ET ce qu'elle ne
// doit pas faire perdre : la saisie directe du stock, l'edition du seuil, le
// filtre de statut, l'import, la liste detaillee « a recommander ».

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

// Trois categories, dont une sans nom ; deux produits sous le seuil, un en
// rupture ; un produit « a renseigner » (quantite inconnue).
const STOCK = [
  { id: "p-gants", code: "GN-M", nom: "Gants nitrile taille M", category: "Protection", quantite: 2, alertThreshold: 20 },
  { id: "p-desinf", code: "DS-5", nom: "Désinfectant surfaces 5 L", category: "Hygiène", quantite: 7, alertThreshold: 15 },
  { id: "p-change", code: "CH-MOL-L", nom: "Changes molletonnés taille L", category: "Hygiène", quantite: 42, alertThreshold: 30 },
  { id: "p-alese", code: "AL-6090", nom: "Alèses jetables 60 × 90", category: "Hygiène", quantite: 0, alertThreshold: 25 },
  { id: "p-sac", code: "SAC-30", nom: "Sacs DASRI 30 L", category: "Déchets", quantite: 60, alertThreshold: 10 },
  { id: "p-divers", code: "DIV-1", nom: "Article sans catégorie", quantite: 12, alertThreshold: 5 },
  { id: "p-inconnu", code: "INC-1", nom: "Article à renseigner", category: "Déchets", quantite: null, alertThreshold: 5 }
];

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  seed.stock = STOCK.map(p => ({ ...p }));
  srv = await demarrer({ port: 3161, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(page) {
  await page.goto(srv.base + "/#stock", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}

const ligne = (page, nom) => page.locator("#stockList .stk-ligne", { hasText: nom });

test("le sous-titre compte les références, le seuil et les catégories", async ({ page }) => {
  await ouvrir(page);
  // 7 references ; sous le seuil : gants, desinfectant, alese (rupture) = 3 ;
  // categories : Protection, Hygiene, Dechets, et « sans categorie » = 4.
  await expect(page.locator("#pageSubtitle")).toHaveText("7 références · 3 sous le seuil · 4 catégories");
});

test("« À recommander » : le même compte que la pastille de la barre latérale", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#stkRecoCompte")).toHaveText("3");
  const pastille = await page.locator('.nav-badge[data-badge="stock"]').textContent();
  expect(pastille.trim()).toBe("3");
  // Le plus en retard sur son seuil d'abord : alese (0/25 = -25), gants (-18), desinfectant (-8).
  const noms = await page.locator("#stkRecoListe .stk-reco-nom").allTextContents();
  expect(noms).toEqual(["Alèses jetables 60 × 90", "Gants nitrile taille M", "Désinfectant surfaces 5 L"]);
  await expect(page.locator("#stkRecoListe .stk-reco-detail").first()).toHaveText("0 en stock · seuil 25");
});

test("« Tout voir » mène à la liste détaillée, et Stock reste allumé", async ({ page }) => {
  await ouvrir(page);
  await page.locator("#stock .stk-tout-voir").click();
  await expect(page.locator("#recommande")).toHaveClass(/active/);
  await expect(page.locator("#nav-stock")).toHaveClass(/active/);
});

test("une tuile par catégorie : total, nom, et le seuil en alerte", async ({ page }) => {
  await ouvrir(page);
  const hygiene = page.locator('[data-stk-categorie="Hygiène"]');
  await expect(hygiene.locator(".stk-tuile-total")).toHaveText("49");
  await expect(hygiene.locator(".stk-tuile-sous")).toHaveText("2 sous le seuil");
  await expect(hygiene.locator(".stk-tuile-sous")).toHaveClass(/stk-alerte/);
  await expect(page.locator('[data-stk-categorie="Déchets"] .stk-tuile-sous')).toHaveText("2 références");
  await expect(page.locator('[data-stk-categorie=""] .stk-tuile-nom')).toHaveText("Sans catégorie");
});

test("une tuile filtre le tableau, et la même tuile rend tout", async ({ page }) => {
  await ouvrir(page);
  const hygiene = page.locator('[data-stk-categorie="Hygiène"]');
  await hygiene.click();
  await expect(hygiene).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stkEnteteProduit")).toHaveText("Produit · Hygiène");
  await expect(page.locator("#stockList .stk-ligne")).toHaveCount(3);
  await hygiene.click();
  await expect(hygiene).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stockList .stk-ligne")).toHaveCount(7);
});

test("les colonnes de la planche, dans l'ordre", async ({ page }) => {
  await ouvrir(page);
  const entete = await page.locator("#stock .stk-entete span").allTextContents();
  expect(entete).toEqual(["Produit", "Code", "Réservé", "Seuil", "Stock", "Ajuster"]);
  await expect(ligne(page, "Changes").locator(".stk-reserve")).toHaveText(/^\d+ sur commandes$/);
});

test("le stock sous le seuil est en alerte, le stock suffisant ne l'est pas", async ({ page }) => {
  await ouvrir(page);
  await expect(ligne(page, "Gants")).toHaveClass(/stk-ligne--alerte/);
  await expect(ligne(page, "Changes")).not.toHaveClass(/stk-ligne--alerte/);
  await expect(ligne(page, "Article à renseigner").locator(".stk-a-renseigner")).toBeVisible();
});

test("« + » ajoute une unité", async ({ page }) => {
  await ouvrir(page);
  const envoi = page.waitForRequest(r => r.method() === "PATCH" && r.url().includes("/api/stock/p-sac"));
  await ligne(page, "Sacs DASRI").locator('[data-stock-delta="1"]').click();
  expect(JSON.parse((await envoi).postData()).quantite).toBe(61);
});

test("la saisie directe du stock est gardée", async ({ page }) => {
  await ouvrir(page);
  const champ = ligne(page, "Sacs DASRI").locator("[data-stock-input]");
  const envoi = page.waitForRequest(r => r.method() === "PATCH" && r.url().includes("/api/stock/p-sac"));
  await champ.fill("75");
  await champ.press("Enter");
  await champ.blur();
  expect(JSON.parse((await envoi).postData()).quantite).toBe(75);
});

test("le seuil reste éditable", async ({ page }) => {
  await ouvrir(page);
  const champ = ligne(page, "Sacs DASRI").locator("[data-stock-threshold-input]");
  const envoi = page.waitForRequest(r => r.method() === "PATCH" && r.url().includes("/api/stock/p-sac"));
  await champ.fill("12");
  await champ.blur();
  expect(JSON.parse((await envoi).postData()).alertThreshold).toBe(12);
});

test("le filtre de statut est gardé", async ({ page }) => {
  await ouvrir(page);
  await page.selectOption("#stockStatusFilter", "rupture");
  await expect(page.locator("#stockList .stk-ligne")).toHaveCount(1);
  await expect(ligne(page, "Alèses")).toBeVisible();
});

test("la recherche de l'en-tête cherche le nom et le code", async ({ page }) => {
  await ouvrir(page);
  await page.fill("#stockSearch", "SAC-30");
  await expect(page.locator("#stockList .stk-ligne")).toHaveCount(1);
});

test("« Importer le stock » de l'en-tête ouvre le sélecteur ET envoie le fichier", async ({ page }) => {
  await ouvrir(page);
  const [selecteur] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('#enteteActions [data-action="importer-stock"]').click()
  ]);
  const envoi = page.waitForRequest(r => r.method() === "POST" && r.url().includes("/api/import/stock"));
  await selecteur.setFiles({ name: "stock.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("PK") });
  await envoi;
});

test("la recherche et l'import n'apparaissent que sur Stock", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#stockSearch")).toBeVisible();
  await page.locator("#nav-commandes").click();
  await expect(page.locator("#stockSearch")).toBeHidden();
  await expect(page.locator('#enteteActions [data-action="importer-stock"]')).toBeHidden();
});

test("téléphone : aucune ligne ne déborde de l'écran", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrir(page);
  const debord = await page.evaluate(() => [...document.querySelectorAll("#stock .stk-ligne, #stock .stk-tuile")]
    .filter(e => e.getBoundingClientRect().right > window.innerWidth + 0.5).length);
  expect(debord).toBe(0);
  const pas = await ligne(page, "Gants").locator('[data-stock-delta="1"]').boundingBox();
  expect(pas.height).toBeGreaterThanOrEqual(44);
});

// --- La relecture ------------------------------------------------------------

test("la tuile « Sans catégorie » filtre vraiment", async ({ page }) => {
  // "" etait lu comme « toutes » : l'en-tete disait filtre, le tableau montrait tout.
  await ouvrir(page);
  await page.locator('[data-stk-categorie=""]').click();
  await expect(page.locator("#stkEnteteProduit")).toHaveText("Produit · Sans catégorie");
  await expect(page.locator("#stockList .stk-ligne")).toHaveCount(1);
  await expect(ligne(page, "Article sans catégorie")).toBeVisible();
});

test("au clavier, la tuile garde le focus après le filtrage", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-stk-categorie="Hygiène"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-stk-categorie="Hygiène"]')).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.activeElement?.dataset?.stkCategorie)).toBe("Hygiène");
});

test("« Tout voir » montre ce que la carte compte, pas un produit à renseigner", async ({ page }) => {
  await ouvrir(page);
  const carte = await page.locator("#stkRecoListe .stk-reco-nom").allTextContents();
  await page.locator("#stock .stk-tout-voir").click();
  await expect(page.locator("#recommande")).toHaveClass(/active/);
  const liste = page.locator("#recommandeList");
  for (const nom of carte) await expect(liste).toContainText(nom);
  await expect(liste).not.toContainText("Article à renseigner");
  await expect(page.locator("#recommande")).toHaveAttribute("aria-label", "À recommander");
});

test("vider le champ Stock ne met pas le produit à zéro", async ({ page }) => {
  await ouvrir(page);
  let ecritures = 0;
  page.on("request", r => { if (r.method() === "PATCH" && r.url().includes("/api/stock/p-change")) ecritures += 1; });
  const champ = ligne(page, "Changes").locator("[data-stock-input]");
  await champ.fill("");
  await champ.blur();
  await page.waitForTimeout(600);
  expect(ecritures).toBe(0);
});

for (const largeur of [1024, 1280]) {
  test(`à ${largeur} px, le nom du produit et du client restent lisibles`, async ({ page }) => {
    // Les colonnes fixes (740 px au Stock, 766 aux Commandes) ne laissaient
    // plus rien a la colonne du nom entre 921 et ~1270 px.
    await page.setViewportSize({ width: largeur, height: 900 });
    await ouvrir(page);
    const nom = await ligne(page, "Changes").locator(".stk-nom").boundingBox();
    expect(nom.width).toBeGreaterThan(120);
    const debordeStock = await page.evaluate(() => [...document.querySelectorAll("#stock .stk-ligne")]
      .filter(e => e.scrollWidth > e.clientWidth + 1).length);
    expect(debordeStock).toBe(0);
    await page.locator("#nav-commandes").click();
    const client = await page.locator("#cmdLignes .cmd-client").first().boundingBox();
    expect(client.width).toBeGreaterThan(120);
  });
}

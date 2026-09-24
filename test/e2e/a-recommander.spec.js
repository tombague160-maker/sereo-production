// E2E : « A recommander » qui voit venir (decisions de Thomas du 24/09, 2 et 3).
//
// La quantite a recommander compte les commandes en cours ET la demande connue
// d'avance sur l'horizon de Parametres (14 jours par defaut) : les commandes
// planifiees et les echeances des abonnements ACTIFS. Un produit au-dessus du
// seuil qui manquera est signale (« Manquera le 3/10 : 24 demandes, 14 en
// stock ») et COMPTE : la pastille Stock, la carte du Stock, la tuile du
// tableau de bord et l'ecran disent le meme nombre (le 23/09 : 1 contre 2).
//
// Le seme : Changes L, 14 en stock (seuil 5), 12 sur commandes en cours, trois
// abonnements actifs qui en demandent 12 dans 3 jours, un quatrieme dans 20
// jours (hors de l'horizon de 14) ; Aleses, 8 en stock, 12 sur commandes ;
// Gants, 0 ; Gel, 20 en stock et un seul abonnement, EN PAUSE (10 par semaine).
// Ancien compte de la pastille (stock faible + rupture) : 1. Attendu : 3.

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

function jour(decalage) {
  const d = new Date(`${AUJOURDHUI}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + decalage);
  return d.toISOString().slice(0, 10);
}
// « 27/9 » : ce que l'ecran ecrit d'une date.
const court = cle => { const [, m, j] = cle.split("-"); return `${Number(j)}/${Number(m)}`; };

function abonnement(id, clientId, status, debut, code, nom, quantite, interval = 14) {
  return {
    id, clientId, status, startDate: debut, frequency: { unit: "days", interval }, reminderDays: 3, notes: "",
    products: [{ stockId: `st-${code}`, code, nom, quantite, prixUnitaire: 12, totalLigne: 12 * quantite }]
  };
}

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  seed.stock = [
    { id: "st-CH-L", code: "CH-L", nom: "Changes taille L", quantite: 14, stockMinimum: 5, tarif: 12 },
    { id: "st-ALE", code: "ALE", nom: "Alèses", quantite: 8, stockMinimum: 5, tarif: 5 },
    { id: "st-GANTS", code: "GANTS", nom: "Gants nitrile", quantite: 0, stockMinimum: 5, tarif: 8 },
    { id: "st-GEL", code: "GEL", nom: "Gel hydroalcoolique", quantite: 20, stockMinimum: 5, tarif: 4 }
  ];
  seed.subscriptions = [
    abonnement("s-1", "c-tilleuls", "active", jour(3), "CH-L", "Changes taille L", 4),
    abonnement("s-2", "c-bellevue", "active", jour(3), "CH-L", "Changes taille L", 4),
    abonnement("s-3", "c-ssiad", "active", jour(3), "CH-L", "Changes taille L", 4),
    abonnement("s-4", "c-veto", "active", jour(20), "CH-L", "Changes taille L", 4),
    abonnement("s-5", "c-dupont", "paused", jour(1), "GEL", "Gel hydroalcoolique", 10, 7)
  ];
  srv = await demarrer({ port: 3523, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(page, ecran, { largeur = 1440, schema = "light" } = {}) {
  await page.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
  await page.setViewportSize({ width: largeur, height: largeur < 800 ? 844 : 900 });
  await page.goto(`${srv.base}/#${ecran}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
}

const pastille = page => page.locator('.nav-badge[data-badge="stock"]').first();
const article = (page, nom) => page.locator("#recommandeList > article", { has: page.locator("h4", { hasText: nom }) });

test("la pastille, la carte du Stock, la tuile et l'écran comptent la même chose", async ({ page }) => {
  await ouvrir(page, "stock");
  await expect(pastille(page)).toHaveText("3");
  await expect(page.locator("#stkRecoCompte")).toHaveText("3");
  await expect(page.locator("#stkRecoCompte")).toHaveAttribute("aria-label", "3 produits à recommander");
  // L'urgent d'abord (manque des aujourd'hui), puis ce qui manquera.
  await expect(page.locator("#stkRecoListe .stk-reco-nom")).toHaveText(["Gants nitrile", "Alèses", "Changes taille L"]);
  await expect(page.locator("#stkRecoListe .stk-reco-detail").nth(2)).toHaveText(`Manquera le ${court(jour(3))} : 24 demandés, 14 en stock`);

  await page.locator("#stock .stk-tout-voir").click();
  await expect(page.locator("#recommande")).toHaveClass(/active/);
  await expect(page.locator('[data-recommend-filter="low"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-recommend-filter="low"]')).toHaveText("Urgent et bientôt");
  await expect(page.locator("#recommandeList > article")).toHaveCount(3);
  await expect(page.locator("#recommandeSousTitre")).toHaveText("Sous le seuil, ou qui manquera d'ici 14 jours");

  await ouvrir(page, "journee");
  await expect(page.locator("#statRecommend")).toHaveText("3");
});

test("Changes L, au-dessus du seuil : « manquera », et combien recommander", async ({ page }) => {
  await ouvrir(page, "recommande");
  await page.locator('[data-recommend-filter="low"]').click();
  const chl = article(page, "Changes taille L");
  await expect(chl.locator(".pill")).toHaveText("Bientôt");
  await expect(chl.locator(".reco-manque")).toHaveText(`Manquera le ${court(jour(3))} : 24 demandés, 14 en stock`);
  // Stock actuel, besoin estime (en cours + a venir), seuil, a recommander.
  await expect(chl.locator(".stock-kpis strong")).toHaveText(["14", "24", "5", "10"]);
  await expect(chl.locator(".reco-detail")).toHaveText(`Dont 12 sur commandes en cours et 12 à venir d'ici le ${court(jour(14))} (abonnements, commandes planifiées).`);
  // L'abonnement en pause ne fait pas manquer le gel.
  await expect(article(page, "Gel hydroalcoolique")).toHaveCount(0);
  // Ce qui manque des aujourd'hui est urgent.
  await expect(article(page, "Alèses").locator(".reco-manque")).toHaveText("Manque dès aujourd'hui : 12 demandés, 8 en stock");
  await page.locator('[data-recommend-filter="urgent"]').click();
  await expect(page.locator("#recommandeList h4")).toHaveText(["Gants nitrile", "Alèses"]);
});

test("l'horizon se règle dans Paramètres : à 30 jours, l'échéance du 20e jour compte", async ({ page }) => {
  await ouvrir(page, "parametres");
  const curseur = page.locator("#parHorizonSlider");
  await expect(curseur).toHaveValue("14");
  await expect(page.locator("#parHorizonValeur")).toHaveText("14 jours");
  const envoi = page.waitForRequest(r => r.method() === "PATCH" && r.url().endsWith("/api/settings/stock"));
  await curseur.fill("30");
  expect(JSON.parse((await envoi).postData())).toEqual({ horizonJours: 30 });
  await expect(page.locator("#parHorizonStatut")).toHaveText("Enregistré : 30 jours.");

  await ouvrir(page, "recommande");
  await page.locator('[data-recommend-filter="low"]').click();
  const chl = article(page, "Changes taille L");
  // 12 en cours ; a venir sous 30 jours : trois abonnements a +3 et +17 (24),
  // le quatrieme a +20 (4) -- 40 en tout, 26 a recommander.
  await expect(chl.locator(".reco-manque")).toHaveText(`Manquera le ${court(jour(3))} : 40 demandés, 14 en stock`);
  await expect(chl.locator(".stock-kpis strong")).toHaveText(["14", "40", "5", "26"]);
  await expect(chl.locator(".reco-detail")).toHaveText(`Dont 12 sur commandes en cours et 28 à venir d'ici le ${court(jour(30))} (abonnements, commandes planifiées).`);
  await expect(page.locator("#recommandeSousTitre")).toHaveText("Sous le seuil, ou qui manquera d'ici 30 jours");

  // Le reglage revient a 14 pour la suite du fichier.
  const retour = await page.request.patch(`${srv.base}/api/settings/stock`, { data: { horizonJours: 14 } });
  expect(retour.status()).toBe(200);
});

for (const [largeur, schema] of [[1440, "dark"], [390, "light"], [390, "dark"]]) {
  test(`à ${largeur} px en ${schema === "light" ? "clair" : "sombre"} : la phrase du manque se lit à 4,5:1, rien ne déborde`, async ({ page }) => {
    await ouvrir(page, "recommande", { largeur, schema });
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", schema);
    await page.locator('[data-recommend-filter="low"]').click();
    await expect(page.locator("#recommandeList .reco-manque")).toHaveCount(3);
    const releve = await page.evaluate(() => {
      const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const fond = e => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] === 1)) return c.slice(0, 3); } return [255, 255, 255]; };
      return [...document.querySelectorAll("#recommandeList .reco-manque, #recommandeList .reco-detail, #recommandeSousTitre")]
        .filter(e => e.getClientRects().length)
        .map(e => {
          const [a, b] = [lum(rgb(getComputedStyle(e).color).slice(0, 3)), lum(fond(e))].sort((x, y) => y - x);
          return { quoi: e.textContent.trim().slice(0, 30), ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 };
        });
    });
    expect(releve.length).toBe(5);
    expect(releve.filter(r => r.ratio < 4.5)).toEqual([]);
    const deborde = await page.evaluate(() => [...document.querySelectorAll("#recommande .reco-manque, #recommande .reco-detail")]
      .filter(e => e.getBoundingClientRect().right > window.innerWidth + 0.5 || e.scrollWidth > e.clientWidth + 1)
      .map(e => e.textContent.trim().slice(0, 30)));
    expect(deborde).toEqual([]);
  });
}

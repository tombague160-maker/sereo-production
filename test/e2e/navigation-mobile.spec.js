// Au telephone, chaque entree de la barre laterale doit rester atteignable :
// par la barre basse ou par le menu « Plus ». La barre laterale y est
// masquee ; Stock n'etait porte par aucun des deux, et aucun banc ne le voyait.

const { test, expect } = require("./tuiles");

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("chaque entrée de la barre latérale est atteignable au téléphone", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const entrees = await page.locator(".sidebar .tab[data-groupe]").evaluateAll(els => els.map(e => ({ tab: e.dataset.tab, nom: e.textContent.replace(/\s+/g, " ").trim() })));
  expect(entrees.length).toBeGreaterThanOrEqual(8);
  const cibles = await page.evaluate(() => [...document.querySelectorAll(".mobile-tabbar [data-tab], #mobile-more-sheet [data-tab]")]
    .map(e => e.dataset.tab));
  const manquantes = entrees.filter(e => !cibles.includes(e.tab)).map(e => e.nom);
  expect(manquantes, "entrées sans chemin au téléphone").toEqual([]);
});

test("« Plus » → Stock ouvre le Stock", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.locator('.mobile-tabbar [data-action="open-more-menu"]').click();
  await page.locator('#mobile-more-sheet [data-tab="stock"]').click();
  await expect(page.locator("#stock")).toHaveClass(/active/);
});

// --- Le cadre mobile des planches (lot 1) -------------------------------------

test("la barre basse porte les mots de la planche", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const mots = await page.locator(".mobile-tabbar .mobile-tab span").allTextContents();
  expect(mots.map(m => m.trim())).toEqual(["Tableau de bord", "Préparer", "Tournée", "Abonnements", "Plus"]);
});

test("le menu « Plus » : les cinq destinations de la passation", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const mots = await page.locator("#mobile-more-sheet .more-sheet-label").allTextContents();
  expect(mots.map(m => m.trim())).toEqual(["Commandes", "Stock", "Clients", "Analyse", "Paramètres"]);
});

for (const onglet of ["journee", "commandes", "stock", "crm", "abonnements", "parametres"]) {
  test(`l'en-tête de « ${onglet} » est le bloc vert, et rien n'y déborde`, async ({ page }) => {
    await page.goto("/#" + onglet, { waitUntil: "networkidle" });
    const r = await page.evaluate(() => {
      const entete = document.querySelector("main.content > .ecran-entete");
      const sonde = document.createElement("span");
      sonde.style.color = "var(--v8-carte-tournee)";
      document.body.append(sonde);
      const vert = getComputedStyle(sonde).color;
      sonde.remove();
      const deborde = [...entete.querySelectorAll("*")].filter(e => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.right > window.innerWidth + 0.5;
      }).length;
      return { fond: getComputedStyle(entete).backgroundColor, vert, deborde, largeur: entete.getBoundingClientRect().width };
    });
    expect(r.fond).toBe(r.vert);
    expect(r.deborde).toBe(0);
    expect(r.largeur).toBeGreaterThanOrEqual(389);
  });
}

test("sur le vert, un bouton plein est blanc à texte vert (il ne disparaît pas)", async ({ page }) => {
  await page.goto("/#commandes", { waitUntil: "networkidle" });
  // En clair (le theme par defaut du banc) : le fond du bouton est la SURFACE
  // (blanc), pas le principal -- vert sur vert, il disparaissait.
  const r = await page.locator('#enteteActions [data-target-tab="commande-client"]').evaluate(b => {
    const sonde = document.createElement("span");
    sonde.style.color = "var(--v8-surface)";
    document.body.append(sonde);
    const surface = getComputedStyle(sonde).color;
    sonde.remove();
    return { fond: getComputedStyle(b).backgroundColor, surface };
  });
  expect(r.fond).toBe(r.surface);
});

test("la barre basse est opaque : ses libellés ne passent pas sur le contenu", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const fond = await page.locator(".mobile-tabbar").evaluate(e => getComputedStyle(e).backgroundColor);
  expect(fond).not.toMatch(/rgba\(.*, 0\.\d+\)$/);
});

test("tableau de bord : le montant et le panier côte à côte, le lien sur la ligne du titre", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const r = await page.evaluate(() => {
    const y = s => document.querySelector(s).getBoundingClientRect().top;
    const lien = document.querySelector("#journee .tb-semaine .tb-lien");
    return {
      montant: y("#opRevenue"), panier: y("#journee .tb-ca-panier"),
      lien: lien.getBoundingClientRect(), titre: document.querySelector("#journee .tb-semaine h3").getBoundingClientRect(),
      souligne: getComputedStyle(lien).textDecorationLine
    };
  });
  expect(Math.abs(r.lien.top + r.lien.height / 2 - (r.titre.top + r.titre.height / 2))).toBeLessThan(12);
  expect(r.souligne).toBe("none");
});

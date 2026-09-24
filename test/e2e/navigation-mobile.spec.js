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

for (const onglet of ["journee", "commandes", "stock", "crm", "abonnements", "parametres", "preparation"]) {
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
  // « Importer les ventes » du tableau de bord : « Nouvelle commande », le
  // bouton plein que ce banc lisait, a quitte l'en-tete vert le 24/09 (fixe
  // en bas, comme « Nouveau client »).
  await page.goto("/#journee", { waitUntil: "networkidle" });
  // En clair (le theme par defaut du banc) : le fond du bouton est la SURFACE
  // (blanc), pas le principal -- vert sur vert, il disparaissait.
  const r = await page.locator('#enteteActions .tb-importer').evaluate(b => {
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
  // Opaque : ni rgba(..., 0.x) ni transparent.
  const alpha = (fond.match(/rgba\([^)]*,\s*([\d.]+)\)$/) || [null, "1"])[1];
  expect(Number(alpha)).toBe(1);
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
  expect(Math.abs(r.montant - r.panier)).toBeLessThan(40);
  expect(Math.abs(r.lien.top + r.lien.height / 2 - (r.titre.top + r.titre.height / 2))).toBeLessThan(12);
  expect(r.souligne).toBe("none");
});

// --- La relecture : le focus au clavier, les libelles de la barre -------------

async function anneauVisible(page, selecteur) {
  await page.keyboard.press("Tab");
  await page.locator(selecteur).first().focus();
  return page.evaluate(sel => {
    const e = document.querySelector(sel);
    const cible = e.closest(".cmd-recherche") || e;
    const cs = getComputedStyle(cible);
    return (cs.boxShadow && cs.boxShadow !== "none") || (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0);
  }, selecteur);
}

test("au clavier, les onglets de la barre basse montrent leur focus", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  expect(await anneauVisible(page, '.mobile-tabbar [data-tab="livreur"]')).toBe(true);
});

test("au clavier, la recherche de l'en-tête vert montre son focus", async ({ page }) => {
  await page.goto("/#commandes", { waitUntil: "networkidle" });
  expect(await anneauVisible(page, "#cmdRecherche")).toBe(true);
});

test("l'onglet actif se distingue autrement que par sa couleur", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const r = await page.evaluate(() => {
    const barre = e => getComputedStyle(e, "::before").backgroundColor;
    return { actif: barre(document.querySelector(".mobile-tab.active")), inactif: barre(document.querySelector('.mobile-tab[data-tab="livreur"]')) };
  });
  expect(r.actif).not.toBe(r.inactif);
  expect(r.inactif).toBe("rgba(0, 0, 0, 0)");
});

for (const largeur of [360, 320]) {
  test(`à ${largeur} px, les libellés de la barre ne se chevauchent pas`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: 740 });
    await page.goto("/", { waitUntil: "networkidle" });
    const boites = await page.locator(".mobile-tabbar .mobile-tab span").evaluateAll(els => els.map(e => {
      const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return [b.left, b.right];
    }));
    for (let i = 1; i < boites.length; i++) expect(boites[i][0], `libellé ${i}`).toBeGreaterThanOrEqual(boites[i - 1][1] - 0.5);
    expect(boites[boites.length - 1][1]).toBeLessThanOrEqual(largeur + 0.5);
  });
}

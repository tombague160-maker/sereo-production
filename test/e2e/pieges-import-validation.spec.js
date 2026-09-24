// LES PIEGES DU BUREAU -- audit du 24/09, lot « les pieges », dans un vrai
// navigateur, sur un serveur seme (port 3520).
//
// 1. L'IMPORT DES VENTES (decision 1 de Thomas). Mesure de l'audit : le resume
//    disait « 12 élément(s) traités » -- toute la base, pour un fichier de 4
//    lignes -- a y = 1376 px au bureau et 2332 au telephone : il fallait
//    defiler pour le voir, et il taisait la commande en tournee reecrite. Il
//    dit maintenant nouvelles / mises a jour / ignorees / erreurs, la raison
//    de chaque commande ignoree et les avertissements du serveur, EN HAUT,
//    sans defiler.
// 3. APRES « VALIDER LA COMMANDE ». Mesure de l'audit : l'ecran renvoyait vers
//    « À envoyer », vide par construction : « Aucune commande ne correspond à
//    ce filtre ». On arrive maintenant sur la liste qui MONTRE la commande,
//    sa ligne mise en avant.
const { test, expect } = require("./tuiles");
const { zipSync, strToU8 } = require("fflate");
const { demarrer, jeuDeDonnees, CLIENTS, AUJOURDHUI } = require("./serveur-seme");

const BUREAU = { width: 1440, height: 900 };
const TELEPHONE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

/** Le seme commun, plus un client dont la commande du jour est encore A PREPARER. */
function seme() {
  const s = jeuDeDonnees();
  const parc = { id: "c-parc", nom: "Foyer du Parc", rue: "2 rue du Parc", ville: "Dole", codePostal: "39100", lat: 47.09, lng: 5.49, crmStatus: "client_actif" };
  s.clients.push(parc);
  s.commandes.push({
    id: "o-parc", clientId: parc.id, clientName: parc.nom, status: "stock_a_verifier",
    address: parc.rue, city: parc.ville, postalCode: parc.codePostal, lat: parc.lat, lng: parc.lng,
    deliveryDate: AUJOURDHUI, dateCommande: AUJOURDHUI,
    products: [{ code: "CH-L", nom: "Changes taille L", prixUnitaire: 12, quantite: 2 }]
  });
  return s;
}

let srv;
async function semer() {
  if (srv) await srv.arreter();
  srv = await demarrer({ port: 3520, seed: seme() });
}
test.afterAll(async () => { if (srv) await srv.arreter(); });

// Un classeur minimal (une feuille, texte en ligne), comme dans api.test.js.
function classeur(lignes) {
  const echapper = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const colonne = i => String.fromCharCode(65 + i);
  const feuille = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lignes.map((l, r) => `<row r="${r + 1}">${l.map((c, i) => `<c r="${colonne(i)}${r + 1}" t="inlineStr"><is><t>${echapper(c)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ventes" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(feuille)
  }));
}

// Le fichier du jour : une commande NOUVELLE (Arbois, dont une quantite
// negative), une ligne qui vise la commande EN TOURNEE des Tilleuls (o-3), une
// MISE A JOUR (Foyer du Parc, encore a preparer) et une ligne ILLISIBLE.
const JOUR_FR = AUJOURDHUI.split("-").reverse().join("/");
const FICHIER = {
  name: "ventes.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: classeur([
    ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"],
    [JOUR_FR, "Maison de Santé Arbois", "CH-L", "Changes taille L", "4", "10 rue de Faramand", "39600", "Arbois"],
    [JOUR_FR, "Maison de Santé Arbois", "ALE", "Alèses", "-2", "10 rue de Faramand", "39600", "Arbois"],
    [JOUR_FR, "EHPAD Les Tilleuls du Val de Loue", "CH-L", "Changes taille L", "8", "12 avenue du Général de Gaulle", "25000", "Besançon"],
    [JOUR_FR, "Foyer du Parc", "CH-L", "Changes taille L", "5", "2 rue du Parc", "39100", "Dole"],
    [JOUR_FR, "", "", "", "3", "", "", ""]
  ])
};

async function ouvrir(browser, ancre, { viewport = BUREAU, theme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, timezoneId: "Europe/Paris", locale: "fr-FR" });
  await ctx.addInitScript(t => { try { localStorage.setItem("sereo:colorScheme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(srv.base + "/#" + ancre, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }" });
  return { ctx, page, erreurs };
}

/** La boite d'un element, et le bas utile de l'ecran (au-dessus de la barre basse du telephone). */
async function place(page, selecteur) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const barre = document.querySelector(".mobile-tabbar")?.getBoundingClientRect();
    const bas = barre && barre.height > 0 ? Math.min(barre.top, innerHeight) : innerHeight;
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), bas: Math.round(bas), scrollY: Math.round(scrollY) };
  }, selecteur);
}

function luminance(rgb) {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Les contrastes du resume : chaque texte sur le premier fond opaque sous lui. */
async function contrastesDuResume(page) {
  const paires = await page.evaluate(() => {
    const fond = el => {
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    return [...document.querySelectorAll("#importSummary .import-bilan-titre, #importSummary .import-bilan-heure, #importSummary .import-bilan-compte, #importSummary .import-bilan-detail")]
      .map(el => ({ quoi: el.className, texte: getComputedStyle(el).color, fond: fond(el) }));
  });
  return paires.map(p => ({ ...p, ratio: contraste(p.texte, p.fond) }));
}

// --- 1. L'import des ventes ------------------------------------------------------

test("import, bureau : le resume est JUSTE et EN HAUT, sans defiler ; la commande en tournee est intacte", async ({ browser }) => {
  test.setTimeout(120000);
  await semer();
  const { ctx, page, erreurs } = await ouvrir(browser, "journee");
  const [selecteur] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('#enteteActions [data-action="importer-ventes"]').click()
  ]);
  const reponse = page.waitForResponse(r => r.url().includes("/api/import/ventes"));
  await selecteur.setFiles(FICHIER);
  expect((await reponse).status()).toBe(200);

  const bilan = page.locator("#importSummary");
  await expect(bilan, "le resume n'est pas en tete du tableau de bord").toBeVisible();
  await page.waitForTimeout(300);
  const boite = await place(page, "#importSummary");
  console.log(`[bureau] resume ${JSON.stringify(boite)}`);
  expect(boite.top, "le resume commence au-dessus de l'ecran").toBeGreaterThanOrEqual(0);
  expect(boite.bottom, "il faut defiler pour lire le resume").toBeLessThanOrEqual(boite.bas);

  const comptes = (await bilan.locator(".import-bilan-compte").allInnerTexts()).map(t => t.replace(/\s+/g, " ").trim());
  expect(comptes).toEqual(["1 nouvelle", "1 mise à jour", "1 ignorée", "1 erreur"]);
  await expect(bilan).toContainText("Ignorée : commande déjà en tournée");
  await expect(bilan).toContainText("EHPAD Les Tilleuls du Val de Loue");
  await expect(bilan).toContainText("1 ligne sans client ni produit");
  await expect(bilan, "l'avertissement du serveur (quantite negative) n'est pas montre").toContainText("1 quantité négative ramenée à 0");
  await expect(page.locator("#journee")).not.toContainText("élément(s) traités");

  // La commande en tournee n'a pas bouge (serveur), ni chez le livreur.
  const liste = await (await fetch(srv.base + "/api/orders")).json();
  const o3 = (Array.isArray(liste) ? liste : liste.orders || []).find(o => o.id === "o-3");
  expect(o3.products.map(p => [p.code, Number(p.quantite)])).toEqual([["CH-L", 3], ["ALE", 3]]);

  // Contrastes, clair.
  for (const p of await contrastesDuResume(page)) {
    console.log(`[contraste/clair] ${p.quoi} ${p.ratio.toFixed(2)}`);
    expect(p.ratio, `${p.quoi} : ${p.texte} sur ${p.fond}`).toBeGreaterThanOrEqual(4.5);
  }
  // Des commandes nouvelles ou mises a jour : la suite du travail est a un geste.
  await expect(bilan.locator('[data-target-tab="preparation"]')).toHaveText("Voir la préparation");
  // Fermer : une cible de 44 px, et le resume part.
  const fermer = bilan.locator('[data-action="fermer-bilan-import"]');
  const f = await fermer.boundingBox();
  expect(Math.round(f.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(f.height)).toBeGreaterThanOrEqual(44);
  await fermer.click();
  await expect(bilan).toBeHidden();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("import, telephone et sombre : depuis l'en-tete puis depuis le formulaire du BAS, le resume vient a l'ecran", async ({ browser }) => {
  test.setTimeout(120000);
  await semer();
  const { ctx, page, erreurs } = await ouvrir(browser, "journee", { viewport: TELEPHONE, theme: "dark" });
  const bilan = page.locator("#importSummary");
  const comptesDuBilan = async () => (await bilan.locator(".import-bilan-compte").allInnerTexts()).map(t => t.replace(/\s+/g, " ").trim());

  // 1. Le chemin de l'audit : « Importer les ventes », en tete (resume a y = 2332).
  const [selecteur] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('#enteteActions [data-action="importer-ventes"]').click()
  ]);
  const premiere = page.waitForResponse(r => r.url().includes("/api/import/ventes"));
  await selecteur.setFiles(FICHIER);
  expect((await premiere).status()).toBe(200);
  await expect(bilan).toBeVisible();
  await page.waitForTimeout(400);
  const enTete = await place(page, "#importSummary");
  console.log(`[telephone/en-tete] resume ${JSON.stringify(enTete)}`);
  expect(enTete.top, "il faut defiler pour trouver le resume").toBeLessThan(enTete.bas);
  expect(enTete.top).toBeGreaterThanOrEqual(0);
  // En entier : ni sous l'ecran, ni sous la barre basse (il tient en hauteur).
  expect(enTete.height, "prealable : le resume est plus haut que l'ecran").toBeLessThan(enTete.bas);
  expect(enTete.bottom, "le bas du resume est cache (sous l'ecran ou la barre basse)").toBeLessThanOrEqual(enTete.bas);
  expect(await comptesDuBilan()).toEqual(["1 nouvelle", "1 mise à jour", "1 ignorée", "1 erreur"]);

  // 2. Le formulaire du pied du tableau de bord : on y descend. Le meme
  // fichier, une seconde fois : tout est identique, la commande en tournee
  // reste ignoree, la ligne illisible reste une erreur.
  const bouton = page.locator("#importVentesButton");
  await bouton.scrollIntoViewIfNeeded();
  const avant = await page.evaluate(() => Math.round(scrollY));
  expect(avant, "prealable : le formulaire n'est pas en bas de la page").toBeGreaterThan(400);
  await page.locator("#ventesFile").setInputFiles(FICHIER);
  const seconde = page.waitForResponse(r => r.url().includes("/api/import/ventes"));
  await bouton.click();
  expect((await seconde).status()).toBe(200);
  await page.waitForTimeout(400);
  expect(await comptesDuBilan()).toEqual(["0 nouvelle", "0 mise à jour", "3 ignorées", "1 erreur"]);
  const boite = await place(page, "#importSummary .import-bilan-comptes");
  console.log(`[telephone/pied] comptes ${JSON.stringify(boite)} (avant : scrollY ${avant})`);
  expect(boite.top, "les comptes sont au-dessus de l'ecran").toBeGreaterThanOrEqual(0);
  expect(boite.bottom, "il faut defiler pour lire les comptes (ou la barre basse les cache)").toBeLessThanOrEqual(boite.bas);
  await expect(bilan).toContainText("2 commandes identiques, déjà importées");
  // Le focus est dans le resume : un lecteur d'ecran le lit, Tab repart de la.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("importSummary");

  for (const p of await contrastesDuResume(page)) {
    console.log(`[contraste/sombre] ${p.quoi} ${p.ratio.toFixed(2)}`);
    expect(p.ratio, `${p.quoi} : ${p.texte} sur ${p.fond}`).toBeGreaterThanOrEqual(4.5);
  }
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("import : les autres avertissements du serveur se lisent aussi (livree a l'import, position refusee, client en double)", async ({ browser }) => {
  // Ils ne vivaient que dans l'historique, que personne ne peut ouvrir.
  test.setTimeout(120000);
  await semer();
  const { ctx, page, erreurs } = await ouvrir(browser, "journee");
  const [selecteur] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('#enteteActions [data-action="importer-ventes"]').click()
  ]);
  const reponse = page.waitForResponse(r => r.url().includes("/api/import/ventes"));
  await selecteur.setFiles({
    name: "ventes.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: classeur([
      ["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville", "Statut", "Latitude", "Longitude"],
      // Facture « Envoyée » : importee comme deja livree ; position (0,0) refusee.
      [JOUR_FR, "Cabinet Neuf", "ALE", "Alèses", "1", "4 rue Neuve", "39100", "Dole", "Envoyée", "0", "0"],
      // Le Foyer du Parc, rue ecrite avec une virgule : le meme client (nom + code postal).
      [JOUR_FR, "Foyer du Parc", "CH-L", "Changes taille L", "2", "2 rue du Parc,", "39100", "Dole", "", "", ""]
    ])
  });
  const r = await (await reponse).json();
  console.log(`[avertissements] importedAsLivre ${r.importedAsLivre} positionsRefusees ${r.positionsRefusees} mergedBySecondary ${r.mergedBySecondary}`);
  const bilan = page.locator("#importSummary");
  await expect(bilan).toBeVisible();
  await expect(bilan).toContainText("1 commande importée comme déjà livrée (facture « Envoyée »)");
  await expect(bilan).toContainText("1 position du fichier ignorée (0,0, inversée ou hors zone)");
  await expect(bilan).toContainText("1 client en double fusionné avec sa fiche existante");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("import : au-dela de cinq commandes ignorees, le resume en nomme cinq et compte les autres", async ({ browser }) => {
  // Un fichier qui reprend un mois de ventes vise surtout des commandes deja
  // livrees : une ligne par commande ferait defiler le resume sans fin.
  test.setTimeout(120000);
  await semer();
  const { ctx, page, erreurs } = await ouvrir(browser, "journee");
  // Les six clients du seme ont chacun une commande du jour deja livree ou en tournee.
  const lignes = CLIENTS.map(c => [JOUR_FR, c.nom, "CH-L", "Changes taille L", "9", c.rue, c.codePostal, c.ville]);
  const [selecteur] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('#enteteActions [data-action="importer-ventes"]').click()
  ]);
  await selecteur.setFiles({
    name: "ventes.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: classeur([["Date", "Client", "Code", "Produit", "Quantite", "Rue", "Code Postal", "Ville"], ...lignes])
  });
  const bilan = page.locator("#importSummary");
  await expect(bilan).toBeVisible();
  const comptes = (await bilan.locator(".import-bilan-compte").allInnerTexts()).map(t => t.replace(/\s+/g, " ").trim());
  expect(comptes).toEqual(["0 nouvelle", "0 mise à jour", "6 ignorées", "0 erreur"]);
  await expect(bilan.locator(".import-bilan-detail", { hasText: /^Ignorée/ })).toHaveCount(5);
  await expect(bilan).toContainText("Et 1 autre commande ignorée (déjà prêtes, en tournée ou livrées), laissées telles quelles.");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("import du stock : le resume compte les produits NOUVEAUX et MIS A JOUR, pas tout le stock", async ({ browser }) => {
  // Meme defaut que les ventes : « 4 élément(s) traités » etait `stock.length`.
  test.setTimeout(120000);
  await semer();
  const { ctx, page, erreurs } = await ouvrir(browser, "journee");
  const bouton = page.locator("#importStockButton");
  await bouton.scrollIntoViewIfNeeded();
  await page.locator("#stockFile").setInputFiles({
    name: "stock.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: classeur([
      ["Code", "Nom", "Coût", "Tarif", "Quantité"],
      ["CH-L", "Changes taille L", "5", "12", "80"],
      ["NEUF", "Produit neuf", "1", "2", "10"]
    ])
  });
  const reponse = page.waitForResponse(r => r.url().includes("/api/import/stock"));
  await bouton.click();
  expect((await reponse).status()).toBe(200);
  const bilan = page.locator("#importSummary");
  await expect(bilan).toBeVisible();
  const comptes = (await bilan.locator(".import-bilan-compte").allInnerTexts()).map(t => t.replace(/\s+/g, " ").trim());
  expect(comptes, "le resume du stock ne compte pas ce que l'import a fait").toEqual(["1 nouveau produit", "1 produit mis à jour"]);
  await expect(bilan).toContainText("Import du stock terminé");
  await page.waitForTimeout(300);
  const boite = await place(page, "#importSummary");
  expect(boite.top).toBeGreaterThanOrEqual(0);
  expect(boite.bottom, "il faut defiler pour lire le resume du stock").toBeLessThanOrEqual(boite.bas);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- 3. Apres « Valider la commande » ------------------------------------------

async function validerUneCommande(page) {
  await page.locator("#customerClientSelect").selectOption("c-veto");
  await page.locator('#customerCatalog [data-customer-product="st-CH-L"][data-customer-delta="1"]').click();
  const reponse = page.waitForResponse(r => r.url().endsWith("/api/customer-orders") && r.request().method() === "POST");
  await page.locator("#customerOrderForm button[type=submit]").click();
  const r = await reponse;
  expect(r.status()).toBe(201);
  return r.json();
}

for (const [nom, viewport] of [["bureau", BUREAU], ["telephone", TELEPHONE]]) {
  test(`valider une commande, ${nom} : la liste MONTRE la commande creee, mise en avant ; plus de « Aucune commande ne correspond »`, async ({ browser }) => {
    test.setTimeout(120000);
    await semer();
    const { ctx, page, erreurs } = await ouvrir(browser, "commande-client", { viewport });
    const creee = await validerUneCommande(page);
    await expect(page.locator("#commandes")).toHaveClass(/active/);
    await expect(page.locator("#commandes .empty-state"), "la liste est vide juste apres la validation").toHaveCount(0);
    await expect(page.locator('#cmdPilules [data-cmd-filtre="toutes"]')).toHaveAttribute("aria-pressed", "true");
    const ligne = page.locator(`#cmdLignes [data-cmd-ouvrir="${creee.id}"]`);
    await expect(ligne, "la commande creee n'est pas dans la liste").toBeVisible();
    await expect(ligne).toHaveClass(/cmd-ligne--nouvelle/);
    await expect(ligne).toContainText("Nouvelle");
    await expect(ligne).toHaveAttribute("aria-label", /, nouvelle$/);
    await page.waitForTimeout(400);
    const boite = await place(page, `#cmdLignes [data-cmd-ouvrir="${creee.id}"]`);
    console.log(`[${nom}] ligne ${JSON.stringify(boite)}`);
    expect(boite.top, "la ligne est au-dessus de l'ecran").toBeGreaterThanOrEqual(0);
    expect(boite.bottom, "la ligne est sous l'ecran (ou sous la barre basse)").toBeLessThanOrEqual(boite.bas);
    await expect(page.locator(".toast").last()).toContainText(`${creee.numero} validée`);
    // « À envoyer » est vide par construction : la pilule n'est plus la.
    await expect(page.locator('#cmdPilules [data-cmd-filtre="a-envoyer"]')).toHaveCount(0);
    // Changer de filtre retire la mise en avant.
    await page.locator('#cmdPilules [data-cmd-filtre="a-preparer"]').click();
    await expect(page.locator(".cmd-ligne--nouvelle")).toHaveCount(0);
    expect(erreurs).toEqual([]);
    await ctx.close();
  });
}

test("valider une commande : contrastes de la ligne mise en avant, clair et sombre", async ({ browser }) => {
  test.setTimeout(120000);
  await semer();
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await ouvrir(browser, "commande-client", { theme });
    const creee = await validerUneCommande(page);
    const ligne = `#cmdLignes [data-cmd-ouvrir="${creee.id}"]`;
    await expect(page.locator(ligne)).toBeVisible();
    const r = await page.evaluate(sel => {
      // Le fond VU : le premier fond opaque en remontant (un fond transparent
      // n'est pas du noir -- lu tel quel, il faussait le contraste).
      const opaque = el => {
        for (let n = el; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      const l = document.querySelector(sel);
      const fond = opaque(l);
      const carte = opaque(l.closest(".cmd-carte") || document.body);
      return {
        fond, carte,
        textes: [...l.querySelectorAll(".cmd-num, .cmd-nouvelle, .cmd-date, .cmd-client, .cmd-secteur, .cmd-articles")]
          .filter(e => e.getBoundingClientRect().width > 0).map(e => ({ quoi: e.className, couleur: getComputedStyle(e).color }))
      };
    }, ligne);
    expect(r.fond, `[${theme}] la ligne mise en avant a le fond de la carte`).not.toBe(r.carte);
    for (const t of r.textes) {
      const ratio = contraste(t.couleur, r.fond);
      console.log(`[contraste/${theme}] ${t.quoi} ${ratio.toFixed(2)}`);
      expect(ratio, `${theme} ${t.quoi}`).toBeGreaterThanOrEqual(4.5);
    }
    await ctx.close();
  }
});

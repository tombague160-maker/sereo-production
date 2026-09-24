// E2E : Parametres au telephone -- planches 8d (clair) / 12d (sombre).
//
// Sous 820 px : les comptes en LIGNES (initiale, nom, role, etat ; la ligne
// ouvre la feuille du compte et ses gestes), les imports en lignes qui ouvrent
// une feuille des archives, « Ajouter un compte » qui deplie le formulaire,
// « Ajouter » des secteurs, la version au pied. Au bureau, rien ne change
// (parametres.spec.js, et le dernier test ici).
//
// Les comptes et les archives sont SERVIS PAR LE BANC (page.route) : le
// serveur de test tourne sans authentification, et creer un compte y
// allumerait la protection d'acces ; il n'a pas non plus de fichier importe.
// Sans donnees, ni les lignes ni la feuille n'existeraient, et un banc sur une
// liste vide ne mesurerait rien.

const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3179 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

const COMPTES = [
  { id: "u-tom", identifiant: "tom", role: "admin", actif: true, derniereConnexion: "2026-09-16T06:42:00Z" },
  { id: "u-lea", identifiant: "léa", role: "livreur", actif: false, derniereConnexion: null }
];
// L'annee COURANTE : la planche 8d tait l'annee d'une date de l'annee en
// cours, pas celle d'une date plus ancienne (voir « un import d'une autre
// annee dit son annee »). Des dates figees en 2026 changeraient de forme en 2027.
const AN = new Date().getFullYear();
const ARCHIVES = [
  { id: "a-3", type: "ventes", filename: "ventes-septembre-semaine-38.xlsx", importedAt: `${AN}-09-16T06:42:00Z`, rowsCount: 38, fileSize: 20480, stats: { created: 5 } },
  { id: "a-2", type: "stock", filename: "stock.xlsx", importedAt: `${AN}-09-15T07:00:00Z`, rowsCount: 20, fileSize: 8192, stats: { updated: 20 } },
  { id: "a-1", type: "ventes", filename: "ventes-septembre-semaine-37.xlsx", importedAt: `${AN}-09-09T07:00:00Z`, rowsCount: 31, fileSize: 19000, stats: { created: 4 } }
];

async function ouvrir(page, { largeur = 390, schema = "light", moi = null, comptes = COMPTES, archives = ARCHIVES } = {}) {
  const patchs = [];
  await page.route("**/api/comptes", route => route.fulfill({ json: comptes }));
  await page.route("**/api/comptes/*", route => {
    patchs.push({ url: route.request().url(), corps: route.request().postDataJSON() });
    return route.fulfill({ json: { ...comptes[1], ...route.request().postDataJSON() } });
  });
  await page.route("**/api/imports/archives", route => route.fulfill({ json: archives }));
  if (moi) await page.route("**/api/me", route => route.fulfill({ json: moi }));
  await page.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
  await page.setViewportSize({ width: largeur, height: 844 });
  await page.goto(srv.base + "/#parametres", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return patchs;
}
const carte = (page, titre) => page.locator("#parametres .par-carte", { has: page.locator("h3", { hasText: titre }) });

test("au téléphone, les comptes sont des lignes, pas un tableau", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#comptesList table")).toBeHidden();
  const lignes = page.locator("#comptesList .par-compte-ligne");
  await expect(lignes).toHaveCount(2);
  await expect(lignes.nth(0)).toBeVisible();
  // Nom, role, etat -- dans cet ordre, sur la ligne.
  await expect(lignes.nth(0)).toContainText("tom");
  await expect(lignes.nth(0)).toContainText("Administrateur");
  await expect(lignes.nth(0)).toContainText("Actif");
  await expect(lignes.nth(1)).toContainText("Livreur");
  await expect(lignes.nth(1)).toContainText("Désactivé");
  await expect(lignes.nth(0).locator(".par-avatar")).toHaveText("T");
  for (const b of await lignes.evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) {
    expect(b).toBeGreaterThanOrEqual(44);
  }
});

test("la ligne d'un compte ouvre sa feuille, qui porte tous les gestes du tableau", async ({ page }) => {
  const patchs = await ouvrir(page);
  await page.locator("#comptesList .par-compte-ligne").nth(1).click();
  const feuille = page.locator("#parCompteFeuille");
  await expect(feuille).toBeVisible();
  await expect(page.locator("#parCompteFeuilleTitre")).toHaveText("léa");
  await expect(feuille.locator("select.compte-role")).toHaveValue("livreur");
  await expect(feuille.getByRole("button", { name: "Changer le mot de passe" })).toBeVisible();
  await expect(feuille.getByRole("button", { name: "Supprimer le compte" })).toBeVisible();
  // Le geste part avec le bon compte et la bonne valeur, et la feuille se referme.
  await feuille.getByRole("button", { name: "Réactiver" }).click();
  await expect(feuille).toBeHidden();
  await expect.poll(() => patchs.length).toBe(1);
  expect(patchs[0].url).toContain("/api/comptes/u-lea");
  expect(patchs[0].corps).toEqual({ actif: true });
});

test("« Ajouter un compte » déplie le formulaire de création", async ({ page }) => {
  await ouvrir(page);
  const bouton = page.locator("#parAjouterCompte");
  await expect(bouton).toBeVisible();
  await expect(page.locator("#compteForm")).toBeHidden();
  await bouton.click();
  await expect(page.locator("#compteForm")).toBeVisible();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('#compteForm input[name="identifiant"]')).toBeFocused();
});

test("sans le rôle d'administration, « Ajouter un compte » n'est pas rendu", async ({ page }) => {
  await ouvrir(page, { moi: { identifiant: "paul", role: "livreur", roleLibelle: "Livreur", administration: false, onglets: "*", separationDesRoles: false, source: "compte" } });
  await expect(page.locator("#comptesList")).toContainText("réservée aux administrateurs");
  await expect(page.locator("#parAjouterCompte")).toBeHidden();
});

test("les imports : trois lignes, et chacune ouvre la feuille de ses fichiers", async ({ page }) => {
  await ouvrir(page);
  const imports = carte(page, "Imports et archives");
  await expect(imports.locator("table")).toBeHidden();
  const lignes = imports.locator(".par-imports-lignes .par-ligne");
  await expect(lignes).toHaveCount(3);
  await expect(lignes.nth(0)).toContainText("Dernier import de ventes");
  await expect(lignes.nth(0)).toContainText(/16 septembre à \d+ h 42 · 38 lignes/);
  await expect(lignes.nth(1)).toContainText("Dernier import de stock");
  await expect(lignes.nth(2)).toContainText("Archives");
  await expect(lignes.nth(2)).toContainText("3 fichiers conservés");

  await lignes.nth(2).click();
  const feuille = page.locator("#parImportsFeuille");
  await expect(feuille).toBeVisible();
  await expect(feuille.locator(".par-archive")).toHaveCount(3);
  await expect(feuille.locator('a[href="/api/imports/archives/a-1/download"]')).toBeVisible();
  await feuille.getByRole("button", { name: "Fermer" }).click();
  await expect(feuille).toBeHidden();

  await lignes.nth(0).click();
  await expect(page.locator("#parImportsFeuilleTitre")).toHaveText("Imports de ventes");
  await expect(feuille.locator(".par-archive")).toHaveCount(2);
  // La feuille tient dans l'ecran : rien ne deborde a droite.
  const deborde = await feuille.evaluate(f => [...f.querySelectorAll("*")]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5; }).length);
  expect(deborde).toBe(0);
});

test("les réglages hors planche restent atteignables au téléphone", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#parPrefixe")).toBeVisible();
  await expect(page.locator("#tourneeSpeedSlider")).toBeVisible();
  await expect(page.locator('[data-action="diagnostic-suspicious-dates"]')).toBeVisible();
  await expect(page.locator('[data-action="purge-orders"]')).toBeVisible();
  await carte(page, "Thème").locator("summary").click();
  await expect(page.locator("#brandPreviewImage")).toBeVisible();
  // « Ajouter » des secteurs ouvre la fiche et son formulaire.
  await expect(page.locator("#deliverySectorForm")).toBeHidden();
  await page.locator('[data-action="par-ajouter-secteur"]').click();
  await expect(page.locator("#deliverySectorForm")).toBeVisible();
  await expect(page.locator('#deliverySectorForm input[name="secteur"]')).toBeFocused();
});

test("la version, au pied de l'écran", async ({ page }) => {
  await ouvrir(page);
  const version = await page.evaluate(async () => (await (await fetch("/api/version")).json()).version);
  const pied = page.locator("#parametres .par-version");
  await expect(pied).toBeVisible();
  await expect(page.locator("#parVersionValeur")).toHaveText(version);
  await expect(page.locator("#parVersionEtat")).toHaveText("Dernière version");
  expect((await pied.boundingBox()).height).toBeGreaterThanOrEqual(44);
});

test("au clavier, une ligne montre son anneau de focus", async ({ page }) => {
  await ouvrir(page);
  const ligne = page.locator("#comptesList .par-compte-ligne").first();
  await ligne.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(ligne).toBeFocused();
  expect(await ligne.evaluate(e => getComputedStyle(e).boxShadow)).not.toBe("none");
});

// Le contraste des lignes et des feuilles, dans les deux themes : le banc
// general ne les voit pas (sa base n'a ni compte ni import).
for (const schema of ["light", "dark"]) {
  test(`en ${schema === "light" ? "clair" : "sombre"}, les textes des lignes et des feuilles tiennent 4,5:1`, async ({ page }) => {
    await ouvrir(page, { schema });
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", schema);
    await page.locator("#comptesList .par-compte-ligne").first().click();
    const mesure = sel => page.evaluate(sel => {
      const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const fond = e => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] === 1)) return c.slice(0, 3); } return [255, 255, 255]; };
      return [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => {
        const [a, b] = [lum(rgb(getComputedStyle(e).color).slice(0, 3)), lum(fond(e))].sort((x, y) => y - x);
        return { quoi: e.className + " « " + e.textContent.trim().slice(0, 20) + " »", ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 };
      });
    }, sel);
    const releve = await mesure("#comptesList .par-telephone .par-ligne-titre, #comptesList .par-telephone .par-ligne-meta, #comptesList .par-badge, .par-imports-lignes .par-ligne-titre, .par-imports-lignes .par-ligne-meta, #parCompteFeuille .par-aide, #parCompteFeuille .button");
    expect(releve.length).toBeGreaterThanOrEqual(10);
    expect(releve.filter(r => r.ratio < 4.5)).toEqual([]);
    // La feuille des imports, que la premiere mesure ne voit pas (elle est
    // fermee) : le nom, les metas, l'aide, « Telecharger ».
    await page.locator("#parCompteFeuille").getByRole("button", { name: "Fermer" }).click();
    await carte(page, "Imports et archives").locator(".par-imports-lignes .par-ligne").nth(2).click();
    await expect(page.locator("#parImportsFeuille")).toBeVisible();
    const feuilleImports = await mesure("#parImportsFeuille .par-ligne-titre, #parImportsFeuille .par-ligne-meta, #parImportsFeuille .par-aide, #parImportsFeuille .button");
    // 3 archives : nom, deux metas et « Telecharger » chacune, l'aide, le ✕.
    expect(feuilleImports.length).toBeGreaterThanOrEqual(14);
    expect(feuilleImports.filter(r => r.ratio < 4.5)).toEqual([]);
  });
}

// Chaque cible que le lot ajoute fait 44 px de haut au moins : les lignes des
// comptes et des imports, « Ajouter un compte », « Ajouter » des secteurs, le
// pied de version, les gestes des deux feuilles et leur ✕. cibles-tactiles ne
// les voit pas (sa base n'a ni compte ni import, et il n'ouvre pas les feuilles).
test("chaque cible du téléphone fait au moins 44 px de haut, feuilles comprises", async ({ page }) => {
  await ouvrir(page);
  const hauteurs = sel => page.evaluate(sel => [...document.querySelectorAll(sel)]
    .filter(e => e.getClientRects().length)
    .map(e => ({ quoi: (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height * 10) / 10 })), sel);
  const trop = liste => liste.filter(c => c.h < 44);

  const page1 = await hauteurs("#comptesList .par-compte-ligne, .par-imports-lignes .par-ligne, #parAjouterCompte, [data-action=\"par-ajouter-secteur\"], #parametres .par-version");
  // 2 comptes, 3 lignes d'imports, les deux « Ajouter », la version.
  expect(page1.length).toBe(8);
  expect(trop(page1)).toEqual([]);

  await page.locator("#comptesList .par-compte-ligne").first().click();
  const compte = await hauteurs("#parCompteFeuille button, #parCompteFeuille select");
  // ✕, Desactiver, mot de passe, supprimer, le role.
  expect(compte.length).toBe(5);
  expect(trop(compte)).toEqual([]);
  await page.locator("#parCompteFeuille").getByRole("button", { name: "Fermer" }).click();

  await carte(page, "Imports et archives").locator(".par-imports-lignes .par-ligne").nth(2).click();
  const imports = await hauteurs("#parImportsFeuille button, #parImportsFeuille a");
  // ✕ et trois « Telecharger ».
  expect(imports.length).toBe(4);
  expect(trop(imports)).toEqual([]);
});

// Un identifiant va de 3 a 60 caracteres, sans espace (une adresse e-mail,
// par exemple) : le titre de la feuille doit se couper, pas pousser le ✕ hors
// de la feuille ni la faire defiler de cote.
test("à 360 px, la feuille d'un compte au long identifiant tient dans l'écran", async ({ page }) => {
  const long = "jeanbaptistedelacroixdemontfort@boulangerieexemples.fr";
  await ouvrir(page, { largeur: 360, comptes: [COMPTES[0], { id: "u-long", identifiant: long, role: "livreur", actif: true, derniereConnexion: null }] });
  await page.locator('#comptesList .par-compte-ligne[data-compte-id="u-long"]').click();
  const feuille = page.locator("#parCompteFeuille");
  await expect(page.locator("#parCompteFeuilleTitre")).toHaveText(long);
  const mesure = await feuille.evaluate(f => {
    const r = f.getBoundingClientRect();
    const contenuDroite = r.right - parseFloat(getComputedStyle(f).paddingRight);
    const fermer = f.querySelector(".sheet-fermer").getBoundingClientRect();
    return { defileDeCote: f.scrollWidth > f.clientWidth, fermerDeborde: fermer.right > contenuDroite + 0.5, fermerHorsEcran: fermer.right > innerWidth };
  });
  expect(mesure).toEqual({ defileDeCote: false, fermerDeborde: false, fermerHorsEcran: false });
});

// La planche ecrit « 16 septembre a 8 h 42 » : l'annee en cours se tait. Mais
// les archives ne sont jamais purgees -- un import d'une autre annee, sans son
// annee, se lirait comme un import de la semaine.
test("un import d'une autre année dit son année", async ({ page }) => {
  await ouvrir(page, { archives: [
    { id: "a-2", type: "ventes", filename: "ventes.xlsx", importedAt: `${AN}-09-16T06:42:00Z`, rowsCount: 38, fileSize: 20480, stats: { created: 5 } },
    { id: "a-1", type: "stock", filename: "stock-ancien.xlsx", importedAt: `${AN - 1}-09-20T07:05:00Z`, rowsCount: 20, fileSize: 8192, stats: { updated: 20 } }
  ] });
  const lignes = carte(page, "Imports et archives").locator(".par-imports-lignes .par-ligne");
  await expect(lignes.nth(1).locator(".par-ligne-meta")).toHaveText(new RegExp(`^20 septembre ${AN - 1} à \\d+ h 05 · 20 lignes$`));
  await expect(lignes.nth(0).locator(".par-ligne-meta")).toHaveText(/^16 septembre à \d+ h 42 · 38 lignes$/);
  await lignes.nth(1).click();
  await expect(page.locator("#parImportsFeuille .par-archive .par-ligne-meta").first()).toContainText(`20 septembre ${AN - 1} à`);
});

// « lignes » s'accorde, comme « fichier(s) conserve(s) » a cote.
test("un import d'une seule ligne dit « 1 ligne »", async ({ page }) => {
  await ouvrir(page, { archives: [
    { id: "a-1", type: "ventes", filename: "une-commande.xlsx", importedAt: `${AN}-09-16T06:42:00Z`, rowsCount: 1, fileSize: 4096, stats: { created: 1 } }
  ] });
  const ligne = carte(page, "Imports et archives").locator(".par-imports-lignes .par-ligne").first();
  await expect(ligne.locator(".par-ligne-meta")).toHaveText(/ · 1 ligne$/);
  await ligne.click();
  await expect(page.locator("#parImportsFeuille .par-archive .par-ligne-meta").first()).toContainText(" · 1 ligne · ");
});

// Un geste de la feuille la referme, puis la liste se redessine : le focus ne
// doit pas tomber sur <body> (le clavier repartirait du haut de la page). Il
// revient sur la ligne du compte, redessinee.
test("après un geste dans la feuille d'un compte, le focus revient sur sa ligne", async ({ page }) => {
  const patchs = await ouvrir(page);
  const feuille = page.locator("#parCompteFeuille");
  const ligneLea = page.locator('#comptesList .par-compte-ligne[data-compte-id="u-lea"]');
  // Marque la ligne d'avant : le focus ne se lit qu'une fois la liste redessinee.
  const marquer = () => ligneLea.evaluate(e => { e.dataset.avant = "1"; });
  const redessinee = () => expect(page.locator("#comptesList [data-avant]")).toHaveCount(0);

  await marquer();
  await ligneLea.focus();
  await page.keyboard.press("Enter");
  await expect(feuille).toBeVisible();
  await feuille.getByRole("button", { name: "Réactiver" }).focus();
  await page.keyboard.press("Enter");
  await expect(feuille).toBeHidden();
  await expect.poll(() => patchs.length).toBe(1);
  await redessinee();
  await expect(ligneLea).toBeFocused();

  // Le role change par le <select> de la feuille : meme chemin.
  await marquer();
  await page.keyboard.press("Enter");
  await expect(feuille).toBeVisible();
  await feuille.locator("select.compte-role").selectOption("preparateur");
  await expect(feuille).toBeHidden();
  await expect.poll(() => patchs.length).toBe(2);
  await redessinee();
  await expect(ligneLea).toBeFocused();
});

test("au bureau, rien ne change : le tableau, le formulaire ouvert, rien du téléphone", async ({ page }) => {
  await ouvrir(page, { largeur: 1440 });
  await expect(page.locator("#comptesList table")).toBeVisible();
  await expect(page.locator("#comptesList .par-compte-ligne").first()).toBeHidden();
  await expect(page.locator("#compteForm")).toBeVisible();
  await expect(page.locator("#parAjouterCompte")).toBeHidden();
  await expect(carte(page, "Imports et archives").locator("table")).toBeVisible();
  await expect(page.locator(".par-imports-lignes")).toBeHidden();
  await expect(page.locator("#parametres .par-version")).toBeHidden();
  await expect(page.locator('[data-action="par-ajouter-secteur"]')).toBeHidden();
});

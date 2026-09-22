// E2E : l'ecran Commandes des planches 13c / 14c.
//
// « Les cinq listes fusionnent en une » (passation). Ce banc verifie deux
// choses a la fois : ce que la planche promet (un tableau, des pilules de
// statut, une case, un tri, une recherche jusqu'au produit), et ce que la
// fusion ne doit PAS perdre (l'envoi en preparation par lot, la confirmation
// d'une commande planifiee, la saisie d'une commande, l'export).

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  const commandes = seed.commandes || seed.orders;
  const base = commandes[0];
  // Une commande terrain validee (« A envoyer ») et une commande planifiee :
  // les deux statuts dont les gestes n'ont plus d'ecran a eux.
  commandes.push({ ...base, id: "o-terrain", numero: "CMD-2026-901", status: "commande_client_validee",
    clientName: "Maison de Sante Arbois", deliveredAt: null });
  commandes.push({ ...base, id: "o-plan", numero: "CMD-2026-902", status: "planifiee",
    clientName: "Residence Les Glycines", deliveryDate: "2026-12-01", deliveredAt: null });
  // Une commande terrain d'un jour PASSE, gardee expres : « Tout selectionner »
  // ne doit pas l'envoyer avec celles du jour.
  commandes.push({ ...base, id: "o-hier", numero: "CMD-2026-903", status: "commande_client_validee",
    clientName: "Pharmacie d'hier", dateCommande: "2026-01-15", deliveredAt: null });
  // Les bancs tournent en serie sur UN serveur : un envoi ou une confirmation
  // change le statut pour la suite. Les derniers bancs ont donc leurs commandes.
  commandes.push({ ...base, id: "o-jour", numero: "CMD-2026-905", status: "commande_client_validee",
    clientName: "Foyer du Jour", deliveredAt: null });
  commandes.push({ ...base, id: "o-plan2", numero: "CMD-2026-906", status: "planifiee",
    clientName: "Residence Bis", deliveryDate: "2026-12-02", deliveredAt: null });
  // Une commande COMPLETE (adresse, telephone, secteur) : « A completer » l'ecarte.
  commandes.push({ ...base, id: "o-complet", numero: "CMD-2026-904", status: "livre",
    clientName: "Cabinet Complet", phone: "0381000000", sector: "Besancon Centre",
    postalCode: "25000", deliveredAt: null });
  srv = await demarrer({ port: 3154, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(page) {
  await page.goto(srv.base + "/#commandes", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
}

const lignes = page => page.locator("#cmdLignes .cmd-ligne");

test("un seul tableau, sept pilules de statut, six colonnes", async ({ page }) => {
  await ouvrir(page);
  const pilules = await page.locator("#cmdPilules [data-cmd-filtre]").allTextContents();
  expect(pilules.map(p => p.trim())).toEqual(
    ["Toutes", "À envoyer", "À préparer", "Prêt livraison", "En livraison", "Livrées", "Planifiées"]);
  const entete = await page.locator("#commandes .cmd-entete span:not(.cmd-col-choix)").allTextContents();
  expect(entete).toEqual(["Numéro", "Date", "Client", "Secteur", "Articles", "Statut"]);
  expect(await lignes(page).count()).toBeGreaterThan(5);
});

test("une pilule filtre par statut, et chaque ligne dit son statut en mots", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="livrees"]').click();
  const statuts = await page.locator("#cmdLignes .cmd-statut").allTextContents();
  expect(statuts.length).toBeGreaterThan(0);
  expect(statuts.every(t => /Livr/.test(t))).toBe(true);
});

test("« Bloquées seulement » ne garde que les commandes bloquées", async ({ page }) => {
  await ouvrir(page);
  await page.locator(".cmd-case", { hasText: "Bloqu" }).click();
  const statuts = await page.locator("#cmdLignes .cmd-statut").allTextContents();
  expect(statuts.length).toBeGreaterThan(0);
  expect(statuts.every(t => /Bloqu/.test(t))).toBe(true);
});

test("la recherche va jusqu'au produit", async ({ page }) => {
  // L'ancienne recherche ne regardait que le numero et le client.
  await ouvrir(page);
  await page.fill("#cmdRecherche", "gants");
  const clients = await page.locator("#cmdLignes .cmd-client").allTextContents();
  expect(clients.length).toBeGreaterThan(0);
  await page.fill("#cmdRecherche", "introuvable-xyz");
  await expect(page.locator("#commandes .empty-state")).toBeVisible();
});

test("« À envoyer » garde l'envoi en préparation par lot", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="a-envoyer"]').click();
  await expect(page.locator("#cmdEnvoi")).toBeVisible();
  await expect(page.locator("#cmdEnvoyer")).toBeDisabled();
  await page.locator('[data-cmd-choix="o-terrain"]').check();
  await expect(page.locator("#cmdEnvoyer")).toBeEnabled();
  const envoi = page.waitForRequest(r => r.method() === "POST" && r.url().includes("/api/customer-orders/send-preparation"));
  await page.locator("#cmdEnvoyer").click();
  const requete = await envoi;
  expect(JSON.parse(requete.postData()).orderIds).toEqual(["o-terrain"]);
});

test("une commande planifiée se confirme depuis son détail", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="planifiees"]').click();
  await page.locator('[data-cmd-ouvrir="o-plan"]').click();
  const detail = page.locator("#bdc-detail-modal");
  await expect(detail).toHaveAttribute("aria-hidden", "false");
  await expect(detail.locator('[data-action="cmd-confirmer"]')).toBeVisible();
  await expect(detail.locator('[data-action="cmd-annuler"]')).toBeVisible();
});

test("les gestes d'une planifiée survivent à « Modifier le profil »", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="planifiees"]').click();
  await page.locator('[data-cmd-ouvrir="o-plan"]').click();
  const detail = page.locator("#bdc-detail-modal");
  const modifier = detail.locator("#bdc-detail-body button", { hasText: /Modifier/ }).first();
  await expect(modifier).toBeVisible();
  await modifier.click();
  await expect(detail.locator('[data-action="cmd-confirmer"]')).toBeVisible();
});

test("« Annuler la commande » demande confirmation, et un refus n'annule rien", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="planifiees"]').click();
  await page.locator('[data-cmd-ouvrir="o-plan"]').click();
  let ecritures = 0;
  page.on("request", r => { if (r.method() !== "GET" && /o-plan/.test(r.url())) ecritures += 1; });
  let dialogue = "";
  page.once("dialog", d => { dialogue = d.message(); d.dismiss(); });
  await page.locator('#bdc-detail-modal [data-action="cmd-annuler"]').click();
  await page.waitForTimeout(300);
  expect(dialogue).toMatch(/Annuler/);
  expect(ecritures).toBe(0);
});

test("un geste du détail ferme le détail, et le suivant n'en hérite pas", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="planifiees"]').click();
  await page.locator('[data-cmd-ouvrir="o-plan"]').click();
  await page.locator('#bdc-detail-modal [data-action="cmd-confirmer"]').click();
  await expect(page.locator("#bdc-detail-modal")).toHaveAttribute("aria-hidden", "true");
  await page.locator('[data-cmd-filtre="toutes"]').click();
  await page.locator('[data-cmd-ouvrir="o-1"]').click();
  await expect(page.locator("#bdc-detail-modal")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#cmdDetailGestes")).toBeHidden();
});

test("le clavier ouvre le détail d'une ligne", async ({ page }) => {
  await ouvrir(page);
  await lignes(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#bdc-detail-modal")).toHaveAttribute("aria-hidden", "false");
});

test("« Nouvelle commande » mène à la saisie, et Commandes reste allumé", async ({ page }) => {
  await ouvrir(page);
  await page.locator('#enteteActions [data-target-tab="commande-client"]').click();
  await expect(page.locator("#commande-client")).toHaveClass(/active/);
  await expect(page.locator("#nav-commandes")).toHaveClass(/active/);
});

test("« Exporter en CSV » télécharge le filtre courant", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="livrees"]').click();
  const [telechargement] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('#enteteActions [data-action="cmd-export"]').click()
  ]);
  expect(telechargement.suggestedFilename()).toMatch(/^sereo-commandes-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("le sous-titre compte les bons, comme la planche", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#pageSubtitle")).toHaveText(/^\d+ bons? depuis janvier · \d+ en cours$/);
});

test("« À envoyer » : le jour choisi borne la liste et « Tout sélectionner »", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="a-envoyer"]').click();
  await expect(page.locator('[data-cmd-ouvrir="o-jour"]')).toBeVisible();
  await expect(page.locator('[data-cmd-ouvrir="o-hier"]')).toHaveCount(0);
  await page.locator("#cmdToutSelectionner").check();
  const envoi = page.waitForRequest(r => r.method() === "POST" && r.url().includes("/send-preparation"));
  await page.locator("#cmdEnvoyer").click();
  expect(JSON.parse((await envoi).postData()).orderIds).not.toContain("o-hier");
});

test("« À envoyer » : un jour passé se choisit", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="a-envoyer"]').click();
  await page.fill("#cmdJour", "2026-01-15");
  await expect(page.locator('[data-cmd-ouvrir="o-hier"]')).toBeVisible();
  await expect(page.locator('[data-cmd-ouvrir="o-jour"]')).toHaveCount(0);
});

test("une recherche retire de la sélection ce qu'elle masque", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="a-envoyer"]').click();
  // o-jour est deja partie en preparation (banc precedent) : celle du 15/01.
  await page.fill("#cmdJour", "2026-01-15");
  await page.locator('[data-cmd-choix="o-hier"]').check();
  await page.fill("#cmdRecherche", "introuvable-xyz");
  await page.fill("#cmdRecherche", "");
  await expect(page.locator('[data-cmd-choix="o-hier"]')).not.toBeChecked();
  await expect(page.locator("#cmdEnvoyer")).toBeDisabled();
});

test("« À compléter » écarte une commande complète", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator('[data-cmd-ouvrir="o-complet"]')).toBeVisible();
  await page.locator(".cmd-case", { hasText: "compléter" }).click();
  await expect(page.locator('[data-cmd-ouvrir="o-complet"]')).toHaveCount(0);
  expect(await lignes(page).count()).toBeGreaterThan(0);
});

test("l'alerte « à compléter » du tableau de bord ouvre ce filtre", async ({ page }) => {
  await page.goto(srv.base + "/#commandes-a-completer", { waitUntil: "networkidle" });
  await expect(page.locator("#commandes")).toHaveClass(/active/);
  await expect(page.locator("#cmdACompleter")).toBeChecked();
});

test("la période Du / Au borne la liste ET l'export", async ({ page }) => {
  await ouvrir(page);
  await page.fill("#cmdDu", "2026-01-01");
  await page.fill("#cmdAu", "2026-01-31");
  await expect(page.locator('[data-cmd-ouvrir="o-hier"]')).toBeVisible();
  await expect(page.locator('[data-cmd-ouvrir="o-complet"]')).toHaveCount(0);
  const [telechargement] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('#enteteActions [data-action="cmd-export"]').click()
  ]);
  const csv = require("fs").readFileSync(await telechargement.path(), "utf8");
  expect(csv).toContain("CMD-2026-903");
  expect(csv).not.toContain("CMD-2026-904");
});

test("la ligne dit son statut dans son nom accessible", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator('[data-cmd-ouvrir="o-plan2"]')).toHaveAttribute("aria-label", /, Planifi/);
});

test("mode clair : la case et le tri sont au principal, graisse 500", async ({ page }) => {
  await ouvrir(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-color-scheme", "light"));
  const styles = await page.evaluate(() => [".cmd-case", ".cmd-tri"].map(s => {
    const cs = getComputedStyle(document.querySelector(`#commandes ${s}`));
    const sonde = document.createElement("span");
    sonde.style.color = "var(--v8-principal)";
    document.body.append(sonde);
    const attendu = getComputedStyle(sonde).color;
    sonde.remove();
    return { s, couleur: cs.color, attendu, graisse: cs.fontWeight };
  }));
  for (const st of styles) {
    expect(st.couleur, st.s).toBe(st.attendu);
    expect(st.graisse, st.s).toBe("500");
  }
});

test("la case de choix d'une ligne est une cible de 44 px", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="a-envoyer"]').click();
  await page.fill("#cmdJour", "2026-01-15");
  const boite = await page.locator('.cmd-ligne:has([data-cmd-choix="o-hier"]) .cmd-col-choix').boundingBox();
  expect(boite.width).toBeGreaterThanOrEqual(44);
  expect(boite.height).toBeGreaterThanOrEqual(44);
});

test("téléphone : le titre n'a pas 200 px de vide sous lui", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrir(page);
  const h = await page.locator(".ecran-entete-texte").evaluate(e => e.getBoundingClientRect().height);
  expect(h).toBeLessThan(120);
});

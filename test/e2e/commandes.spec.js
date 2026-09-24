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
  // Une commande d'AVANT la periode testee : seule la borne « Du » l'ecarte.
  commandes.push({ ...base, id: "o-decembre", numero: "CMD-2025-907", status: "livre",
    clientName: "Clinique de Decembre", dateCommande: "2025-12-20", deliveredAt: null });
  // Seconde relecture : une commande a envoyer pour le bouton qui se rallumait,
  // une commande sans adresse pour l'alerte du tableau de bord.
  commandes.push({ ...base, id: "o-envoi2", numero: "CMD-2026-908", status: "commande_client_validee",
    clientName: "Cabinet Envoi", dateCommande: "2026-02-10", deliveredAt: null });
  commandes.push({ ...base, id: "o-sansadresse", numero: "CMD-2026-909", status: "importe",
    clientName: "Client Sans Adresse", address: "", deliveredAt: null });
  // Une commande COMPLETE (adresse, telephone, secteur) : « A completer » l'ecarte.
  commandes.push({ ...base, id: "o-complet", numero: "CMD-2026-904", status: "livre",
    clientName: "Cabinet Complet", phone: "0381000000", sector: "Besancon Centre",
    postalCode: "25000", deliveredAt: null });
  srv = await demarrer({ port: 3160, seed });
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

test("l'export fait à 0 h 30 à Paris porte la date du jour, pas celle de la veille (24/09)", async ({ page }) => {
  // 30/09 22:30 UTC = 1er octobre 0 h 30 a Paris (le navigateur de test vit a
  // Paris, playwright.config.js). Seul Date est fige, pas les minuteries.
  await page.clock.setFixedTime(new Date("2026-09-30T22:30:00Z"));
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="livrees"]').click();
  const [telechargement] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('#enteteActions [data-action="cmd-export"]').click()
  ]);
  expect(telechargement.suggestedFilename()).toBe("sereo-commandes-2026-10-01.csv");
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
  await expect(page.locator('[data-cmd-ouvrir="o-decembre"]')).toHaveCount(0);
  const [telechargement] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('#enteteActions [data-action="cmd-export"]').click()
  ]);
  const csv = require("fs").readFileSync(await telechargement.path(), "utf8");
  expect(csv).toContain("CMD-2026-903");
  expect(csv).not.toContain("CMD-2026-904");
  expect(csv).not.toContain("CMD-2025-907");
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
  const ligne = page.locator('.cmd-ligne:has([data-cmd-choix="o-hier"])');
  const boite = await ligne.locator('.cmd-col-choix').boundingBox();
  // La PISTE, pas l'element : un element de 44 px dans une piste de 24 deborde
  // sous le numero, et le clic y ouvre le detail.
  const numero = await ligne.locator('.cmd-num').boundingBox();
  expect(numero.x - boite.x).toBeGreaterThanOrEqual(44 + 16);
  expect(boite.height).toBeGreaterThanOrEqual(44);
});

test("téléphone : le titre n'a pas 200 px de vide sous lui", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrir(page);
  const h = await page.locator(".ecran-entete-texte").evaluate(e => e.getBoundingClientRect().height);
  expect(h).toBeLessThan(120);
});

// --- Seconde relecture -------------------------------------------------------

test("« Modifier le profil » puis « Annuler » : le détail reste sur la même commande", async ({ page }) => {
  // Toutes les commandes du jeu partagent un client : la premiere est une
  // livree. L'ancien code rouvrait LA PREMIERE commande du client.
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="planifiees"]').click();
  await page.locator('[data-cmd-ouvrir="o-plan2"]').click();
  const titre = page.locator("#bdc-detail-title");
  await expect(titre).toHaveText("Bon CMD-2026-906");
  await page.locator('#bdc-detail-body [data-action="bdc-edit-client"]').click();
  await expect(titre).toHaveText("Bon CMD-2026-906");
  await page.locator('#bdc-detail-body [data-action="bdc-cancel-edit"]').click();
  await expect(titre).toHaveText("Bon CMD-2026-906");
  await expect(page.locator('#cmdDetailGestes [data-action="cmd-annuler"]')).toHaveAttribute("data-order-id", "o-plan2");
});

test("une redirection arrive sur une liste propre", async ({ page }) => {
  // « Bloquees seulement » coche, puis un ancien lien : la liste etait cachee.
  // (24/09 : #commandes-jour ouvre « Toutes » -- « À envoyer » est vide par
  // construction ; la saisie ne passe plus par la, pieges-import-validation.)
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="livrees"]').click();
  await page.locator(".cmd-case", { hasText: "Bloqu" }).click();
  await page.fill("#cmdRecherche", "introuvable-xyz");
  await page.evaluate(() => { location.hash = "#commandes-jour"; });
  await expect(page.locator('[data-cmd-filtre="toutes"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#cmdBloquees")).not.toBeChecked();
  await expect(page.locator("#cmdRecherche")).toHaveValue("");
  // Et le jour revient a aujourd'hui : la commande saisie est du jour.
  const aujourdhui = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
  await expect(page.locator("#cmdJour")).toHaveValue(aujourdhui);
});

test("le filtre Secteur de l'ancien écran est gardé", async ({ page }) => {
  await ouvrir(page);
  const options = await page.locator("#cmdSecteur option").evaluateAll(os => os.map(o => o.value).filter(Boolean));
  expect(options.length).toBeGreaterThan(0);
  const total = await lignes(page).count();
  await page.selectOption("#cmdSecteur", options[0]);
  const n = await lignes(page).count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(total + 1);
  const secteurs = await page.locator("#cmdLignes .cmd-secteur").allTextContents();
  expect(new Set(secteurs).size).toBe(1);
});

test("l'alerte « adresses à corriger » ouvre exactement son compte", async ({ page }) => {
  await page.goto(srv.base + "/#commandes-a-completer", { waitUntil: "networkidle" });
  await expect(page.locator("#cmdACompleterLibelle")).toHaveText("Adresses à corriger");
  await expect(page.locator('[data-cmd-ouvrir="o-sansadresse"]')).toBeVisible();
  // o-1 est livree, adresse complete, sans telephone : « A completer » la
  // montrerait, l'alerte ne la compte pas.
  await expect(page.locator('[data-cmd-ouvrir="o-1"]')).toHaveCount(0);
});

test("la période borne la date de COMMANDE, même pour une planifiée", async ({ page }) => {
  await ouvrir(page);
  // o-plan2 : commandee aujourd'hui, livree le 02/12.
  await page.fill("#cmdDu", "2026-12-02");
  await page.fill("#cmdAu", "2026-12-02");
  await expect(page.locator('[data-cmd-ouvrir="o-plan2"]')).toHaveCount(0);
});

test("liste vide sous « À compléter » : le message parle du filtre", async ({ page }) => {
  await ouvrir(page);
  await page.fill("#cmdDu", "2030-01-01");
  await expect(page.locator("#commandes .empty-state")).toContainText("ne correspond");
});

test("cocher une ligne au clavier garde le focus sur la case", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="a-envoyer"]').click();
  await page.fill("#cmdJour", "2026-02-10");
  const cas = page.locator('[data-cmd-choix="o-envoi2"]');
  await cas.focus();
  await page.keyboard.press("Space");
  await expect(cas).toBeChecked();
  expect(await page.evaluate(() => document.activeElement?.dataset?.cmdChoix)).toBe("o-envoi2");
});

test("le détail prend le focus, et le rend à la ligne en se fermant", async ({ page }) => {
  await ouvrir(page);
  const ligne1 = lignes(page).first();
  const id = await ligne1.getAttribute("data-cmd-ouvrir");
  await ligne1.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => !!document.activeElement?.closest("#bdc-detail-modal"))).toBe(true);
  await page.locator('#bdc-detail-modal .version-modal-close').click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.cmdOuvrir)).toBe(id);
});

test("après l'envoi, « Envoyer » reste éteint", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="a-envoyer"]').click();
  await page.fill("#cmdJour", "2026-02-10");
  await page.locator('[data-cmd-choix="o-envoi2"]').check();
  const reponse = page.waitForResponse(r => r.url().includes("/send-preparation"));
  await page.locator("#cmdEnvoyer").click();
  await reponse;
  await page.waitForTimeout(800);
  await expect(page.locator("#cmdEnvoyer")).toBeDisabled();
});

test("téléphone : ni la barre d'envoi ni la période ne poussent la page de côté", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrir(page);
  await page.locator('[data-cmd-filtre="a-envoyer"]').click();
  await expect(page.locator("#cmdEnvoi")).toBeVisible();
  // Pas scrollWidth : la page coupe ce qui deborde (overflow-x), et un champ
  // coupe a droite ne se voit plus du tout. On mesure le BORD de chaque element.
  const deborde = await page.evaluate(() => [...document.querySelectorAll(
    "#cmdEnvoi *, #commandes .cmd-periode *, #commandes .cmd-filtres > *")]
    .filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > window.innerWidth + 0.5)
    .map(e => e.id || e.className || e.tagName));
  expect(deborde).toEqual([]);
});

test("les étiquettes de date suivent la planche (600), pas le label générique", async ({ page }) => {
  await ouvrir(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-color-scheme", "light"));
  const g = await page.locator("#commandes .cmd-periode label").first().evaluate(e => getComputedStyle(e).fontWeight);
  expect(g).toBe("600");
});

// --- Au telephone : la planche 8a (23/09) ---------------------------------
//
// Les pilules de statut passent dans l'en-tete vert, sous la recherche ; sous
// l'en-tete, le compte et le tri ; les filtres hors planche (gardes) se
// replient derriere « Filtres ».

async function ouvrirTelephone(page, ancre = "commandes") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(srv.base + "/#" + ancre, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
}

test("téléphone : les pilules de statut sont DANS l'en-tête vert, sous la recherche", async ({ page }) => {
  await ouvrirTelephone(page);
  const pilules = page.locator("#cmdPilules");
  await expect(pilules).toBeVisible();
  // Dans l'en-tete, pas seulement dessus : un deplacement par position ne
  // resisterait pas au prochain changement de hauteur.
  expect(await pilules.evaluate(e => Boolean(e.closest(".ecran-entete")))).toBe(true);
  const entete = await page.locator(".ecran-entete").boundingBox();
  const recherche = await page.locator('#enteteActions .cmd-recherche[data-ecran="commandes"]').boundingBox();
  const boite = await pilules.boundingBox();
  expect(boite.y).toBeGreaterThanOrEqual(recherche.y + recherche.height);
  expect(boite.y + boite.height).toBeLessThanOrEqual(entete.y + entete.height);
  // 44 px sous le pouce, et le fond de la pilule choisie tranche sur le vert.
  const toutes = pilules.locator('[data-cmd-filtre="toutes"]');
  expect((await toutes.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const [fondChoisie, fondAutre, fondEntete] = await page.evaluate(() => [
    getComputedStyle(document.querySelector('#cmdPilules [data-cmd-filtre="toutes"]')).backgroundColor,
    getComputedStyle(document.querySelector('#cmdPilules [data-cmd-filtre="livrees"]')).backgroundColor,
    getComputedStyle(document.querySelector(".ecran-entete")).backgroundColor]);
  expect(fondChoisie).not.toBe(fondAutre);
  expect(fondAutre).not.toBe(fondEntete);
});

test("téléphone : une pilule de l'en-tête filtre la liste", async ({ page }) => {
  await ouvrirTelephone(page);
  await page.locator('#cmdPilules [data-cmd-filtre="livrees"]').click();
  await expect(page.locator('#cmdPilules [data-cmd-filtre="livrees"]')).toHaveAttribute("aria-pressed", "true");
  const statuts = await page.locator("#cmdLignes .cmd-badge").allTextContents();
  expect(statuts.length).toBeGreaterThan(0);
  for (const s of statuts) expect(s).toMatch(/Livrée/);
});

test("téléphone : les pilules ne suivent pas sur un autre écran", async ({ page }) => {
  await ouvrirTelephone(page);
  await page.goto(srv.base + "/#stock", { waitUntil: "networkidle" });
  await expect(page.locator("#cmdPilules")).toBeHidden();
  // Le cas que showTab ne voit pas : la fenetre passe sous 820 px pendant
  // qu'un AUTRE ecran est ouvert. Les pilules entrent dans l'en-tete sans
  // changement d'ecran ; elles doivent s'y ranger cachees.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  expect(await page.locator("#cmdPilules").evaluate(e => Boolean(e.closest(".ecran-entete")))).toBe(true);
  await expect(page.locator("#cmdPilules")).toBeHidden();
});

test("bureau (le témoin) : les pilules restent dans la rangée de filtres, et y reviennent", async ({ page }) => {
  await ouvrirTelephone(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  expect(await page.locator("#cmdPilules").evaluate(e => e.parentElement.classList.contains("cmd-filtres"))).toBe(true);
  await expect(page.locator("#cmdPilules")).toBeVisible();
  await expect(page.locator("#cmdFiltresBouton")).toBeHidden();
  await expect(page.locator("#cmdBloquees").locator("xpath=..")).toBeVisible();
});

test("téléphone : le compte et le tri sous l'en-tête, les filtres hors planche repliés", async ({ page }) => {
  await ouvrirTelephone(page);
  await expect(page.locator("#cmdResume")).toHaveText(/^\d+ bons?$/);
  await expect(page.locator("#cmdTri")).toBeVisible();
  const caseBloquees = page.locator("label.cmd-case", { has: page.locator("#cmdBloquees") });
  await expect(caseBloquees).toBeHidden();
  await expect(page.locator("#commandes .cmd-periode")).toBeHidden();
  const bouton = page.locator("#cmdFiltresBouton");
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  expect((await bouton.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
  await expect(caseBloquees).toBeVisible();
  await expect(page.locator("#commandes .cmd-periode")).toBeVisible();
  // Gardes, donc utilisables : la case filtre vraiment.
  await caseBloquees.click();
  await expect(page.locator("#cmdLignes .cmd-badge--alerte").first()).toBeVisible();
  await expect(bouton).toHaveText("Filtres · 1");
});

test("téléphone : un filtre actif se dit sur le bouton, même replié", async ({ page }) => {
  await ouvrirTelephone(page);
  await page.locator("#cmdFiltresBouton").click();
  await page.fill("#cmdDu", "2026-01-01");
  await page.locator("#cmdFiltresBouton").click();
  await expect(page.locator("#cmdFiltresBouton")).toHaveText("Filtres · 1");
  await expect(page.locator("#commandes .cmd-periode")).toBeHidden();
});

test("téléphone : « adresses à corriger » arrive avec son filtre déplié", async ({ page }) => {
  await ouvrirTelephone(page, "commandes-a-completer");
  await expect(page.locator("#cmdFiltresBouton")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#cmdACompleterLibelle")).toBeVisible();
  await expect(page.locator("#cmdACompleterLibelle")).toHaveText("Adresses à corriger");
});

// Le balayage de contraste de l'application se fait a 1440 px : il ne voit
// jamais l'en-tete vert du telephone. On mesure ici, dans les deux themes, le
// texte de ce que ce lot y pose, contre son propre fond (tous opaques).
for (const mode of ["light", "dark"]) {
  test(`téléphone : pilules, compte et « Filtres » lisibles (4,5:1), en ${mode}`, async ({ page }) => {
    await ouvrirTelephone(page);
    await page.evaluate(m => document.documentElement.setAttribute("data-color-scheme", m), mode);
    await page.locator("#cmdFiltresBouton").click();   // aussi l'etat deplie
    // Les boutons ont une transition de couleur : mesure pendant le fondu, et
    // le banc lisait une couleur intermediaire (3,23 au lieu de la finale).
    await page.waitForTimeout(600);
    const mesures = await page.evaluate(() => {
      const rgb = c => (c.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      const lum = ([r, g, b]) => {
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      // Le fond est celui du premier ancetre opaque.
      const fond = el => {
        for (let e = el; e; e = e.parentElement) {
          const c = rgb(getComputedStyle(e).backgroundColor);
          if (c.length === 3 || c[3] === 1) return c.slice(0, 3);
        }
        return [255, 255, 255];
      };
      const elements = [...document.querySelectorAll("#cmdPilules .filtre-pilule, #cmdResume, #cmdFiltresBouton")];
      return elements.map(e => {
        const a = lum(rgb(getComputedStyle(e).color)), b = lum(fond(e));
        return { nom: e.textContent.trim(), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
    });
    expect(mesures.length).toBe(9);
    const faibles = mesures.filter(m => m.ratio < 4.5).map(m => `${m.nom} : ${m.ratio.toFixed(2)}`);
    expect(faibles).toEqual([]);
    // La pilule choisie suit la planche : blanche sur le vert en clair (8a),
    // en plein clair -- le principal -- en sombre (12a). Le contraste seul ne le
    // distingue pas : la surface sombre sous le principal passe aussi 4,5.
    const [fond, attendu] = await page.evaluate(m => {
      const temoin = document.createElement("span");
      temoin.style.background = m === "dark" ? "var(--v8-principal)" : "var(--v8-surface)";
      document.body.appendChild(temoin);
      const valeur = getComputedStyle(temoin).backgroundColor;
      temoin.remove();
      return [getComputedStyle(document.querySelector('#cmdPilules [data-cmd-filtre="toutes"]')).backgroundColor, valeur];
    }, mode);
    expect(fond).toBe(attendu);
  });
}

test("téléphone : au clavier, la pilule de l'en-tête montre son anneau", async ({ page }) => {
  // La forme de la pilule pose box-shadow: none a (2,5,0) : sans regle de
  // focus plus forte, l'anneau de l'en-tete vert ne se voyait plus.
  await ouvrirTelephone(page);
  await page.locator("#cmdRecherche").focus();
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => ({
    filtre: document.activeElement?.dataset?.cmdFiltre,
    ombre: getComputedStyle(document.activeElement).boxShadow
  }));
  expect(focus.filtre).toBe("toutes");
  expect(focus.ombre).not.toBe("none");
});

// E2E : l'ecran Clients des planches 13e / 14e.
//
// Liste a gauche, fiche a droite. Ce banc verifie ce que la planche promet
// (compte, pilules de secteur et « Abonnes », ligne choisie, fiche avec
// abonnement et commandes) et ce que la refonte ne doit pas perdre : creer un
// client, le modifier, son statut commercial, les rappels.

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  const tilleuls = seed.clients.find(c => c.id === "c-tilleuls") || seed.clients[0];
  tilleuls.telephone = "03 81 47 22 15";
  // Un client sans rue : la tournee ne peut pas le placer.
  seed.clients.push({ id: "c-sans-rue", nom: "Foyer Sans Rue", ville: "Dole", codePostal: "39100", rue: "", crmStatus: "client_actif" });
  // Cinq commandes pour un meme client : la fiche en montre quatre.
  const commandes = seed.commandes || seed.orders;
  const modele = commandes.find(o => o.clientId === tilleuls.id);
  for (let i = 0; i < 4; i++) {
    // Nom d'IMPORT, different du nom de la fiche : « Les N autres » doit
    // retrouver ces commandes par l'identifiant du client, pas par son nom.
    commandes.push({ ...modele, id: `o-t${i}`, numero: `CMD-2026-95${i}`, status: "livre", clientName: "TILLEULS (import)",
      dateCommande: `2026-0${i + 1}-10`, deliveredAt: `2026-0${i + 1}-11T09:00:00Z` });
  }
  // Une commande en cours du client sans rue : corriger sa fiche doit
  // corriger l'adresse de LIVRAISON de cette commande.
  commandes.push({ ...modele, id: "o-sr", numero: "CMD-2026-960", status: "pret_livraison", clientId: "c-sans-rue",
    clientName: "Foyer Sans Rue", address: "", city: "Dole", postalCode: "39100", deliveredAt: null });
  // Une fiche ARCHIVEE avec un abonnement arrete : l'ecran Abonnements la garde
  // pour son historique, l'ecran Clients ne doit ni la lister ni la compter.
  seed.clients.push({ id: "c-archive", nom: "Ancien Client Archive", ville: "Dole", rue: "1 rue X", codePostal: "39100", crmArchived: true });
  seed.subscriptions.push({ ...seed.subscriptions[0], id: "sub-archive", clientId: "c-archive", status: "cancelled" });
  srv = await demarrer({ port: 3164, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(page) {
  await page.goto(srv.base + "/#crm", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}

const ligne = (page, nom) => page.locator("#crmList .cli-ligne", { hasText: nom });

test("le titre et le compte de la planche", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#pageTitle")).toHaveText("Clients");
  await expect(page.locator("#pageSubtitle")).toHaveText("7 clients · 1 abonné · 1 adresse à corriger");
  // Apres un nouveau rendu (une pilule), la fiche archivee n'apparait pas :
  // l'ecran Abonnements l'ajoutait au MEME tableau.
  await page.locator('[data-cli-secteur=""]').click();
  await expect(page.locator("#pageSubtitle")).toHaveText("7 clients · 1 abonné · 1 adresse à corriger");
  await expect(ligne(page, "Ancien Client Archive")).toHaveCount(0);
});

test("la pilule « Abonnés » ne garde que les abonnements actifs", async ({ page }) => {
  await ouvrir(page);
  await page.locator('[data-cli-secteur="__abonnes"]').click();
  await expect(page.locator("#crmList .cli-ligne")).toHaveCount(1);
  await expect(page.locator("#crmList .cli-ligne .cli-badge")).toHaveText("Abonné");
});

test("une pilule de secteur filtre la liste", async ({ page }) => {
  await ouvrir(page);
  const secteurs = await page.locator("[data-cli-secteur]").evaluateAll(els =>
    els.map(e => e.dataset.cliSecteur).filter(s => s && s !== "__abonnes"));
  expect(secteurs.length).toBeGreaterThan(0);
  const total = await page.locator("#crmList .cli-ligne").count();
  await page.locator(`[data-cli-secteur="${secteurs[0]}"]`).click();
  await expect(page.locator(`[data-cli-secteur="${secteurs[0]}"]`)).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator("#crmList .cli-ligne").count()).toBeLessThan(total);
});

test("une adresse incomplète est signalée dans la ligne, avec la ville", async ({ page }) => {
  await ouvrir(page);
  await expect(ligne(page, "Foyer Sans Rue").locator(".cli-meta")).toHaveText("Adresse à corriger · Dole");
  await expect(ligne(page, "Foyer Sans Rue").locator(".cli-meta")).toHaveClass(/cli-alerte/);
});

test("un abonnement en pause se lit « En pause »", async ({ page }) => {
  await ouvrir(page);
  await expect(ligne(page, "Bellevue").locator(".cli-badge")).toHaveText("En pause");
});

test("choisir une ligne ouvre sa fiche", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "Foyer Sans Rue").click();
  await expect(ligne(page, "Foyer Sans Rue")).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#cliFiche .cli-fiche-nom")).toHaveText("Foyer Sans Rue");
  await expect(page.locator("#cliFiche .cli-valeur.cli-alerte")).toHaveText("Adresse à corriger");
});

test("la fiche : Appeler, l'abonnement et « Créer la commande »", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "Tilleuls").click();
  await expect(page.locator("#cliFiche .cli-appeler")).toHaveAttribute("href", "tel:0381472215");
  const abonnement = page.locator("#cliFiche .cli-abonnement");
  await expect(abonnement.locator(".cli-abonnement-titre")).toContainText("Abonnement ·");
  await expect(abonnement.locator(".cli-abonnement-detail")).toContainText("rappel 2 j");
  const envoi = page.waitForRequest(r => r.method() === "POST" && /\/api\/subscriptions\/sub-1\/orders/.test(r.url()));
  await abonnement.locator('[data-op="generate-sub"]').click();
  await envoi;
});

test("les commandes du client : quatre, puis « Les N autres »", async ({ page }) => {
  // Un filtre laisse sur Commandes (« Bloquees seulement ») ne doit pas cacher
  // les commandes du client : la liste s'ouvre propre.
  await page.goto(srv.base + "/#commandes", { waitUntil: "networkidle" });
  await page.locator(".cmd-case", { hasText: "Bloqu" }).click();
  await page.locator("#nav-clients").click();
  await ligne(page, "Tilleuls").click();
  await expect(page.locator("#cliFiche .cli-commande")).toHaveCount(4);
  // Les plus recentes d'abord : la commande de janvier n'est pas dans les quatre.
  await expect(page.locator("#cliFiche .cli-commande", { hasText: "CMD-2026-950" })).toHaveCount(0);
  const autres = page.locator("#cliFiche .cli-autres");
  await expect(autres).toHaveText(/^Les \d+ autres?$/);
  await autres.click();
  await expect(page.locator("#commandes")).toHaveClass(/active/);
  await expect(page.locator("#cmdClientFiltre")).toContainText("Tilleuls");
  await expect(page.locator("#cmdRecherche")).toHaveValue("");
  await expect(page.locator('#cmdLignes [data-cmd-ouvrir="o-t0"]')).toBeVisible();
  // Seulement ce client : aucune commande d'un autre.
  const autresClients = await page.locator("#cmdLignes .cmd-client").allTextContents();
  expect(autresClients.every(t => /TILLEULS|Tilleuls/.test(t))).toBe(true);
  // Et le filtre s'enleve.
  await page.locator("#cmdClientFiltre").click();
  await expect(page.locator("#cmdClientFiltre")).toBeHidden();
});

test("une commande de la fiche ouvre son détail", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "Tilleuls").click();
  await page.locator("#cliFiche .cli-commande").first().click();
  await expect(page.locator("#bdc-detail-modal")).toHaveAttribute("aria-hidden", "false");
});

test("le statut commercial reste modifiable", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "Foyer Sans Rue").click();
  const envoi = page.waitForRequest(r => r.method() === "PATCH" && r.url().includes("/api/crm/clients/c-sans-rue"));
  await page.locator("#cliFiche [data-cli-statut]").selectOption("client_a_relancer");
  expect(JSON.parse((await envoi).postData()).crmStatus).toBe("client_a_relancer");
});

test("« Modifier » ouvre la fiche pré-remplie et l'enregistre", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "Foyer Sans Rue").click();
  await page.locator('#cliFiche [data-action="cli-modifier"]').click();
  const dialogue = page.locator("#cliDialogue");
  await expect(dialogue).toBeVisible();
  await expect(dialogue.locator('[name="nom"]')).toHaveValue("Foyer Sans Rue");
  await dialogue.locator('[name="adresse"]').fill("4 rue des Arènes");
  // L'adresse passe par la route qui la RECOPIE sur les commandes ; et rien
  // d'autre n'est envoye (ni relance ni statut calcules par le serveur).
  const routesCrm = [];
  page.on("request", r => { if (r.method() === "PATCH" && r.url().includes("/api/crm/clients/")) routesCrm.push(r.postData()); });
  const envoi = page.waitForRequest(r => r.method() === "PATCH" && r.url().includes("/api/clients/c-sans-rue"));
  await dialogue.locator('button[type="submit"]').click();
  expect(JSON.parse((await envoi).postData())).toEqual({ rue: "4 rue des Arènes" });
  await expect(dialogue).toBeHidden();
  expect(routesCrm).toEqual([]);
  const commandes = await page.evaluate(async () => (await (await fetch("/api/orders")).json()));
  expect(commandes.find(o => o.id === "o-sr").address).toBe("4 rue des Arènes");
  await expect(page.locator("#cliFiche .cli-fiche-nom")).toHaveText("Foyer Sans Rue");
  await expect(page.locator("#pageSubtitle")).toHaveText("7 clients · 1 abonné");
});

test("un doublon refusé s'affiche DANS le dialogue, qui reste ouvert", async ({ page }) => {
  await ouvrir(page);
  await page.locator('#enteteActions [data-action="cli-nouveau"]').click();
  const dialogue = page.locator("#cliDialogue");
  await dialogue.locator('[name="nom"]').fill("Doublon");
  await dialogue.locator('[name="telephone"]').fill("03 81 47 22 15");
  await dialogue.locator('button[type="submit"]').click();
  await expect(page.locator("#cliErreur")).toBeVisible();
  await expect(dialogue).toBeVisible();
  await dialogue.locator('[data-action="cli-fermer"]').last().click();
});

test("« Nouveau client » crée la fiche et l'ouvre", async ({ page }) => {
  await ouvrir(page);
  await page.locator('#enteteActions [data-action="cli-nouveau"]').click();
  const dialogue = page.locator("#cliDialogue");
  await expect(dialogue.locator("#cliDialogueTitre")).toHaveText("Nouveau client");
  await expect(dialogue.locator('[name="nom"]')).toHaveValue("");
  await dialogue.locator('[name="nom"]').fill("Cabinet Neuf");
  await dialogue.locator('[name="ville"]').fill("Besançon");
  const envoi = page.waitForRequest(r => r.method() === "POST" && r.url().endsWith("/api/crm/clients"));
  await dialogue.locator('button[type="submit"]').click();
  await envoi;
  await expect(page.locator("#cliFiche .cli-fiche-nom")).toHaveText("Cabinet Neuf");
});

test("« Rappels » mène aux rappels, et Clients reste allumé", async ({ page }) => {
  await ouvrir(page);
  await page.locator('#enteteActions [data-target-tab="relances"]').click();
  await expect(page.locator("#relances")).toHaveClass(/active/);
  await expect(page.locator("#nav-clients")).toHaveClass(/active/);
});

test("la recherche cherche le nom et la ville", async ({ page }) => {
  await ouvrir(page);
  await page.fill("#crmSearch", "Dole");
  await expect(page.locator("#crmList .cli-ligne", { hasText: "Foyer Sans Rue" })).toBeVisible();
  await page.fill("#crmSearch", "introuvable-xyz");
  await expect(page.locator("#crm .empty-state")).toBeVisible();
});

test("téléphone : rien ne déborde de l'écran", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrir(page);
  // La fiche passe SOUS la liste, pleine largeur : deux colonnes ecrasees ne
  // debordent pas, elles deviennent illisibles.
  const fiche = await page.locator("#cliFiche").boundingBox();
  expect(fiche.width).toBeGreaterThan(330);
  const deborde = await page.evaluate(() => [...document.querySelectorAll("#crm *")]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5; })
    .map(e => e.className || e.tagName));
  expect(deborde).toEqual([]);
});

test("accessibilité : les lignes restent des boutons, les rappels ont un nom", async ({ page }) => {
  await ouvrir(page);
  const role = await page.locator("#crmList .cli-ligne").first().evaluate(e => e.getAttribute("role"));
  expect(role).toBeNull();
  await expect(page.locator("#crmList > [role=listitem]").first()).toBeVisible();
  await expect(page.locator("#relances")).toHaveAttribute("aria-label", "Rappels");
});

test("à 1190 px, les commandes de la fiche tiennent dans la carte", async ({ page }) => {
  await page.setViewportSize({ width: 1190, height: 900 });
  await ouvrir(page);
  await ligne(page, "Tilleuls").click();
  const debord = await page.evaluate(() => {
    const carte = document.getElementById("cliFiche").getBoundingClientRect();
    return [...document.querySelectorAll("#cliFiche .cli-commande *")].filter(e => e.getBoundingClientRect().right > carte.right + 0.5).length;
  });
  expect(debord).toBe(0);
});

// E2E : l'ecran Abonnements des planches 13a / 14a.
//
// Au bureau : un tableau (client et panier, frequence, prochaine livraison,
// etat) et « Les 90 jours ». Au telephone : la ligne de 96 px de la planche 3a
// (abonnements-lignes.spec.js, abonnements-mobile.spec.js). Ce banc verifie ce
// que la planche 13a ajoute.

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const jourDecale = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
};

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  // Un abonnement actif commence il y a dix jours, chaque semaine : deux
  // echeances passees sans commande -- donc « en retard ».
  // Chez le SSIAD : dernier par ordre alphabetique, premier par date -- le
  // tri « Prochaine livraison » se distingue ainsi du tri par nom.
  seed.subscriptions.push({ ...seed.subscriptions[0], id: "sub-retard", clientId: "c-ssiad", status: "active",
    startDate: jourDecale(-10), frequency: { unit: "days", interval: 7 } });
  srv = await demarrer({ port: 3165, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(page) {
  await page.goto(srv.base + "/#abonnements", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}
const lignes = page => page.locator("#subscriptionList .abonnement-ligne");

test("le sous-titre compte les actifs, les pauses et les retards", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#pageSubtitle")).toHaveText("2 actifs · 1 en pause · 2 échéances en retard");
});

test("au bureau : les colonnes de la planche, et un abonnement en retard le dit", async ({ page }) => {
  await ouvrir(page);
  const entete = await page.locator("#abonnements .abo-entete span").allTextContents();
  expect(entete).toEqual(["Client", "Fréquence", "Prochaine", "État"]);
  const retard = lignes(page).filter({ has: page.locator(".abo-badge--retard") });
  await expect(retard).toHaveCount(1);
  await expect(retard.locator(".abo-badge--retard")).toHaveText("En retard");
  await expect(retard.locator(".abo-prochaine")).toHaveText(/^Échue le /);
  await expect(retard.locator(".abo-frequence")).toHaveText("Chaque semaine");
});

test("les pilules filtrent par état", async ({ page }) => {
  await ouvrir(page);
  await expect(lignes(page)).toHaveCount(4);
  await page.locator('[data-op="abo-filtre"][data-filtre="active"]').click();
  await expect(lignes(page)).toHaveCount(2);
  await expect(page.locator('[data-op="abo-filtre"][data-filtre="active"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-op="abo-filtre"][data-filtre="paused"]').click();
  await expect(lignes(page)).toHaveCount(1);
  await expect(lignes(page).locator(".abo-badge")).toHaveText("En pause");
});

test("le tri « Prochaine livraison » met le retard en tête ; « Client » trie par nom", async ({ page }) => {
  await ouvrir(page);
  await expect(lignes(page).first().locator(".abo-badge--retard")).toHaveCount(1);
  await page.selectOption("#aboTri", "client");
  const noms = await lignes(page).locator("strong").allTextContents();
  expect(noms).toEqual([...noms].sort((a, b) => a.localeCompare(b, "fr")));
});

test("la ligne en pause n'est pas voilée (le contraste tombait sous 4,5)", async ({ page }) => {
  await ouvrir(page);
  const pause = lignes(page).filter({ hasText: "En pause" });
  const opacite = await pause.evaluate(e => {
    let o = 1;
    for (let n = e; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  });
  expect(opacite).toBe(1);
});

test("« Arrêté » ne ressemble pas à « Actif »", async ({ page }) => {
  await ouvrir(page);
  const fond = async mot => lignes(page).filter({ hasText: mot }).first().locator(".abo-badge")
    .evaluate(e => getComputedStyle(e).backgroundColor);
  expect(await fond("Arrêté")).not.toBe(await fond("Actif"));
});

test("« Les 90 jours » : le retard d'abord, puis CETTE semaine -- pas les plus anciennes", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#aboAgendaCompte")).toHaveText(/^\d+ livraisons?$/);
  // Le retard (J-10, J-3) en tete, puis deux semaines a partir de celle-ci.
  const titres = await page.locator("#subscriptionAgenda .abo-semaine-titre").allTextContents();
  expect(titres[0]).toBe("En retard · 2");
  expect(titres[1]).toMatch(/^Cette semaine · \d+$/);
  expect(titres).toHaveLength(3);
  // La livraison du jour (sub-1, commence aujourd'hui) est visible sans deplier,
  // et son rappel (2 jours avant) est arrive.
  await expect(page.locator("#subscriptionAgenda .abo-semaine").nth(1)).toContainText("rappel arrivé");
  const plus = page.locator("#aboAgendaPlus");
  await expect(plus).toHaveText(/^Les \d+ semaines? suivantes?$/);
  await plus.click();
  await expect(plus).toHaveAttribute("aria-expanded", "true");
  expect(await page.locator("#subscriptionAgenda .abo-semaine").count()).toBeGreaterThan(2);
});

test("une échéance en retard se crée depuis l'agenda", async ({ page }) => {
  await ouvrir(page);
  const retard = page.locator("#subscriptionAgenda .abo-echeance--retard").first();
  await expect(retard).toBeVisible();
  const envoi = page.waitForRequest(r => r.method() === "POST" && r.url().includes("/api/subscriptions/sub-retard/orders"));
  await retard.getByRole("button", { name: /^Créer la commande/ }).click();
  await envoi;
  await expect(page.locator("#pageSubtitle")).toHaveText("2 actifs · 1 en pause · 1 échéance en retard");
  // La commande creee se lit dans l'agenda, et mene a Commandes.
  await expect(page.locator("#subscriptionAgenda .abo-badge--commande").first()).toBeVisible();
});

test("le tableau de bord compte le même retard que l'écran Abonnements", async ({ page }) => {
  // Deux definitions : l'alerte comptait aussi l'echeance DEJA commandee.
  await page.goto(srv.base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await expect(page.locator("body")).toContainText("1 échéance d’abonnement en retard");
});

test("la recherche de l'en-tête filtre, et n'apparaît que sur Abonnements", async ({ page }) => {
  await ouvrir(page);
  await page.fill("#subscriptionSearch", "Alèses");
  await expect(lignes(page)).toHaveCount(1);
  await page.locator("#nav-stock").click();
  await expect(page.locator("#subscriptionSearch")).toBeHidden();
});

test("au téléphone, la ligne de la planche 3a (trois rangées, sans colonnes)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrir(page);
  const premiere = lignes(page).first();
  await expect(premiere.locator(".abo-rythme")).toBeVisible();
  await expect(premiere.locator(".abo-rythme-date")).toHaveText(/^Échéance du /);
  await expect(premiere.locator(".etat-commande")).toBeHidden();
  await expect(premiere.locator(".abo-frequence")).toBeHidden();
  const deborde = await page.evaluate(() => [...document.querySelectorAll("#abonnements *")]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5; })
    .map(e => e.className || e.tagName));
  expect(deborde).toEqual([]);
});

test("à 1024 px, le nom du client garde de la place", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await ouvrir(page);
  const nom = await lignes(page).first().locator("strong").boundingBox();
  expect(nom.width).toBeGreaterThan(120);
});

for (const largeur of [1366, 1440]) {
  test(`à ${largeur} px, le nom du client garde de la place`, async ({ page }) => {
    // Au-dessus de 1280 le tableau n'avait que 7 colonnes sur 12 : 420 px de
    // colonnes fixes ne laissaient qu'une dizaine de pixels au nom a 1300.
    await page.setViewportSize({ width: largeur, height: 900 });
    await ouvrir(page);
    const nom = await lignes(page).first().locator("strong").boundingBox();
    expect(nom.width).toBeGreaterThan(largeur < 1440 ? 120 : 100);
  });
}

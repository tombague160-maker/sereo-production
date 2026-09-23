// E2E : la CREATION d'un abonnement -- planches 3b (clair) et 5b (sombre).
// Le client choisi en carte par une recherche, le catalogue avec le stock
// disponible, les pilules de frequence, l'apercu des trois prochaines dates,
// et rien de perdu de l'ancien formulaire (fiche client a la volee, quantite
// libre, « Autre... » en jours ou en mois, rappel de 0 a 60 jours, statut et
// notes sous « Plus d'options »). Au telephone la croix faisait 316 px.
//
// Chaque cas echoue sans le lot : mesure faite en remettant index.html,
// operations.js et style.css de main (DESIGN.md, section du 23/09).

const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3304 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

const TELEPHONE = { width: 390, height: 844 };
const BUREAU = { width: 1280, height: 900 };

async function ouvrirEditeur(page, { vp = TELEPHONE, schema = "light" } = {}) {
  await page.emulateMedia({ colorScheme: schema });
  await page.setViewportSize(vp);
  await page.goto(srv.base + "/#abonnements", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  await page.locator('[data-op="new-sub"]').filter({ visible: true }).first().click();
  await expect(page.locator("#subscriptionDialog")).toHaveAttribute("open", "");
}
const dialogue = page => page.locator("#subscriptionDialog");

// Contraste WCAG entre deux couleurs calculees « rgb(...) ».
function contraste(a, b) {
  const lum = c => {
    const [r, g, bl] = (/rgba?\(([^)]+)\)/.exec(c)[1].split(",").slice(0, 3)).map(v => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test("au téléphone : une page pleine à l'en-tête vert, et la croix est un rond de 44 px (elle s'étirait sur 316)", async ({ page }) => {
  await ouvrirEditeur(page);
  const m = await page.evaluate(() => {
    const d = document.getElementById("subscriptionDialog").getBoundingClientRect();
    const f = document.querySelector('#subscriptionDialog [data-op="close-sub"][aria-label="Fermer"]').getBoundingClientRect();
    return { dl: d.left, dt: d.top, dw: d.width, dh: d.height, fw: f.width, fh: f.height };
  });
  expect({ largeur: m.fw, hauteur: m.fh }).toEqual({ largeur: 44, hauteur: 44 });
  expect({ gauche: m.dl, haut: m.dt, largeur: m.dw, hauteur: m.dh }).toEqual({ gauche: 0, haut: 0, largeur: 390, hauteur: 844 });
  // Rien ne deborde en largeur.
  expect(await dialogue(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("le client se choisit en carte, par une recherche ; la carte choisie devient le champ", async ({ page }) => {
  await ouvrirEditeur(page);
  const recherche = page.getByRole("searchbox", { name: "Chercher un client" });
  await expect(recherche).toBeVisible();
  await recherche.fill("bellevue");
  const cartes = page.locator('#subClientResults [data-op="sub-client"]');
  await expect(cartes).toHaveCount(1);
  await expect(cartes.first()).toContainText("EHPAD Résidence Bellevue");
  await expect(cartes.first()).toContainText("8 chemin des Vignes");
  // Une recherche sans resultat le dit, et propose la fiche.
  await recherche.fill("zzz");
  await expect(cartes).toHaveCount(0);
  await expect(page.locator("#subClientReste")).toHaveText("Aucun client ne correspond : crée sa fiche.");
  // Entree sur un resultat unique le choisit, sans envoyer le formulaire.
  await recherche.fill("bellevue");
  await recherche.press("Enter");
  await expect(dialogue(page)).toHaveAttribute("open", "");
  await expect(page.locator("#subClientNom")).toHaveText("EHPAD Résidence Bellevue");
  await expect(page.locator("#subClient")).toHaveValue("c-bellevue");
  await expect(recherche).toBeHidden();
  // La croix du champ rend la recherche.
  await page.getByRole("button", { name: "Changer de client" }).click();
  await expect(recherche).toBeVisible();
  await expect(recherche).toBeFocused();
  await expect(page.locator("#subClient")).toHaveValue("");
});

test("le catalogue montre le stock disponible et compose le panier en pas de un", async ({ page }) => {
  await ouvrirEditeur(page);
  const stock = await (await page.request.get(srv.base + "/api/stock")).json();
  const produits = Array.isArray(stock) ? stock : stock.items || stock.stock;
  const attendu = p => [p.code, p.quantityAvailable === null ? "stock à renseigner" : p.quantityAvailable <= 0 ? "rupture" : `${p.quantityAvailable} en stock`].join(" · ");
  // Panier vide : le catalogue est ouvert d'office.
  const catalogue = page.locator("#subCatalogueListe");
  await expect(catalogue).toBeVisible();
  for (const code of ["CH-L", "GANTS"]) {
    const p = produits.find(x => x.code === code);
    await expect(catalogue.locator(".abo-cr-produit").filter({ hasText: p.nom })).toContainText(attendu(p));
  }
  await expect(catalogue).toContainText("GANTS · rupture");
  const ajouter = nom => page.getByRole("button", { name: `Ajouter ${nom} au panier` });
  await ajouter("Changes taille L").click();
  await expect(ajouter("Changes taille L")).toBeFocused();
  await ajouter("Changes taille L").click();
  await ajouter("Alèses").click();
  const panier = page.locator("#subProducts .sub-product-line");
  await expect(panier).toHaveCount(2);
  const changes = panier.filter({ hasText: "Changes taille L" });
  await expect(changes.locator(".sub-quantity")).toHaveValue("2");
  await expect(catalogue).toContainText("2 au panier");
  await changes.getByRole("button", { name: "Un de plus : Changes taille L" }).click();
  await expect(changes.locator(".sub-quantity")).toHaveValue("3");
  // La quantite se tape aussi (l'ancien formulaire allait jusqu'a 10 000).
  await changes.locator(".sub-quantity").fill("120");
  await expect(changes.getByRole("button", { name: "Un de moins : Changes taille L" })).toBeVisible();
  // A un, « moins » retire la ligne.
  const aleses = panier.filter({ hasText: "Alèses" });
  await aleses.getByRole("button", { name: "Retirer Alèses", exact: true }).click();
  await expect(panier).toHaveCount(1);
  // La recherche du catalogue filtre par nom ou par code.
  await page.getByRole("searchbox", { name: "Chercher dans le catalogue" }).fill("gants");
  await expect(catalogue.locator(".abo-cr-produit")).toHaveCount(1);
});

// Relecture adverse du 23/09 : la quantite tapee perd le focus au mousedown du
// « + » ; le change redessinait tout le catalogue entre mousedown et mouseup,
// et le premier clic n'ajoutait rien. On tape au clavier (pas fill) pour que
// le change parte du vrai blur, comme sous le doigt.
test("une quantité tapée, puis « + » du catalogue : le premier clic ajoute le produit", async ({ page }) => {
  await ouvrirEditeur(page);
  await page.getByRole("button", { name: "Ajouter Changes taille L au panier" }).click();
  const panier = page.locator("#subProducts .sub-product-line");
  const quantite = panier.filter({ hasText: "Changes taille L" }).locator(".sub-quantity");
  await quantite.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("12");
  await page.getByRole("button", { name: "Ajouter Alèses au panier" }).click();
  await expect(panier).toHaveCount(2);
  await expect(quantite).toHaveValue("12");
  // Le compte du catalogue suit la quantite tapee des que le champ est quitte,
  // sans redessiner la liste (Tab : aucun clic ne redessine derriere).
  await quantite.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("30");
  await page.keyboard.press("Tab");
  await expect(page.locator("#subCatalogueListe .abo-cr-produit").filter({ hasText: "Changes taille L" })).toContainText("CH-L · 100 en stock · 30 au panier");
});

// Relecture adverse du 23/09 : l'ancien formulaire avait « Retirer » sur chaque
// ligne ; « − » ne retire qu'a un. Une ligne de 120 se retire d'un seul geste.
test("une ligne de 120 se retire d'un seul geste, comme avec l'ancien « Retirer »", async ({ page }) => {
  await ouvrirEditeur(page);
  await page.getByRole("button", { name: "Ajouter Changes taille L au panier" }).click();
  await page.getByRole("button", { name: "Ajouter Alèses au panier" }).click();
  const panier = page.locator("#subProducts .sub-product-line");
  await panier.filter({ hasText: "Changes taille L" }).locator(".sub-quantity").fill("120");
  await page.getByRole("button", { name: "Retirer Changes taille L du panier" }).click();
  await expect(panier).toHaveCount(1);
  await expect(panier).toContainText("Alèses");
  // Le focus ne tombe pas sur <body> : le « Retirer » de la ligne voisine.
  await expect(page.getByRole("button", { name: "Retirer Alèses du panier" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panier).toHaveCount(0);
  await expect(page.locator("#subPanierVide")).toBeVisible();
  await expect(page.locator("#subCatalogueBouton")).toBeFocused();
});

test("les pilules de fréquence recalculent les trois prochaines dates, sans rien valider", async ({ page }) => {
  await ouvrirEditeur(page);
  // Un 31, loin dans le futur (le banc ne se perime pas) : le mensuel retombe
  // sur le dernier jour des mois courts.
  await page.locator("#subStart").fill("2099-01-31");
  const apercu = page.locator("#subApercu li");
  const pilule = nom => page.getByRole("radio", { name: nom });
  await pilule("Tous les 15 jours").check({ force: true });
  await expect(apercu).toHaveCount(3);
  await expect(apercu.nth(0)).toContainText(/Samedi 31 janvier 2099/);
  await expect(apercu.nth(0)).toContainText("départ");
  await expect(apercu.nth(1)).toContainText(/Dimanche 15 février/);
  await expect(apercu.nth(1)).toContainText("+ 15 j");
  await expect(apercu.nth(2)).toContainText(/Lundi 2 mars/);
  await expect(page.locator("#subScheduleHint")).toContainText("Samedi, dimanche, lundi : un intervalle de 15 jours décale le jour de la semaine");
  // Le nom accessible de chaque pilule contient son texte visible (WCAG 2.5.3) :
  // « cliquer Mensuel » a la voix doit trouver le radio « Mensuel ».
  const sansEtiquette = await page.evaluate(() =>
    [...document.querySelectorAll("#subscriptionDialog .abo-cr-pilule")]
      .map(p => ({ vu: p.querySelector("span").textContent.trim(), nom: p.querySelector("input").getAttribute("aria-label") }))
      .filter(m => !m.nom.toLowerCase().includes(m.vu.replace(/…$/, "").toLowerCase()))
      .map(m => `${m.vu} → ${m.nom}`));
  expect(sansEtiquette).toEqual([]);
  await pilule("Mensuel").check({ force: true });
  await expect(apercu.nth(1)).toContainText(/Samedi 28 février/);
  await expect(apercu.nth(2)).toContainText(/Mardi 31 mars/);
  await expect(page.locator("#subScheduleHint")).toContainText("le dernier jour du mois quand il est plus court");
  await pilule("Tous les 14 jours").check({ force: true });
  await expect(page.locator("#subScheduleHint")).toContainText("Toujours le samedi");
  // « Autre... » : un nombre de jours, ou de MOIS.
  await pilule("Autre fréquence").check({ force: true });
  await page.locator("#subCustom").fill("2");
  await page.locator("#subCustomUnit").selectOption("months");
  await expect(apercu.nth(1)).toContainText(/31 mars/);
  await expect(apercu.nth(1)).toContainText("+ 2 mois");
  // Le rappel dit quand il tombe.
  await page.getByRole("radio", { name: "3 jours avant" }).check({ force: true });
  await expect(page.locator("#subRappelValeur")).toHaveText("3 j");
  await expect(page.locator("#subRappelNote")).toContainText("Le 28 janvier");
});

test("créer, puis modifier : l'API reçoit tout ce que l'ancien formulaire envoyait", async ({ page }) => {
  await ouvrirEditeur(page);
  await page.getByRole("searchbox", { name: "Chercher un client" }).fill("vétérinaire");
  await page.locator('#subClientResults [data-op="sub-client"]').first().click();
  await page.getByRole("button", { name: "Ajouter Changes taille L au panier" }).click();
  await page.getByRole("button", { name: "Ajouter Alèses au panier" }).click();
  await page.locator("#subProducts .sub-product-line").filter({ hasText: "Changes taille L" }).locator(".sub-quantity").fill("12");
  await page.locator("#subStart").fill("2027-01-31");
  await page.getByRole("radio", { name: "Autre fréquence" }).check({ force: true });
  await page.locator("#subCustom").fill("2");
  await page.locator("#subCustomUnit").selectOption("months");
  await page.getByRole("radio", { name: "Autre rappel" }).check({ force: true });
  await page.locator("#subReminder").fill("5");
  await page.locator("#subOptions summary").click();
  await page.locator("#subStatus").selectOption("paused");
  await page.locator("#subNotes").fill("Digicode 1234");
  const envoi = page.waitForRequest(r => r.url().endsWith("/api/subscriptions") && r.method() === "POST");
  await page.getByRole("button", { name: "Créer l’abonnement" }).click();
  const corps = (await envoi).postDataJSON();
  expect(corps).toEqual({
    clientId: "c-veto",
    products: [{ productId: "st-CH-L", quantite: 12 }, { productId: "st-ALE", quantite: 1 }],
    startDate: "2027-01-31",
    frequency: { unit: "months", interval: 2 },
    reminderDays: 5,
    notes: "Digicode 1234",
    status: "paused"
  });
  await expect(dialogue(page)).not.toHaveAttribute("open", "");
  // La modification rouvre les memes reglages -- « tous les 2 mois » restait
  // « tous les 2 JOURS » dans l'ancien formulaire.
  const cree = (await (await page.request.get(srv.base + "/api/subscriptions")).json()).items.find(s => s.clientId === "c-veto");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(`#subscriptionList [data-id="${cree.id}"]`).first().click();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await expect(dialogue(page)).toHaveAttribute("open", "");
  await expect(page.locator("#subDialogTitle")).toHaveText("Modifier l’abonnement");
  await expect(page.locator("#subClientNom")).toHaveText("Clinique Vétérinaire du Doubs");
  await expect(page.getByRole("radio", { name: "Autre fréquence" })).toBeChecked();
  await expect(page.locator("#subCustom")).toHaveValue("2");
  await expect(page.locator("#subCustomUnit")).toHaveValue("months");
  await expect(page.locator("#subReminder")).toHaveValue("5");
  await expect(page.locator("#subOptions")).toHaveAttribute("open", "");
  await expect(page.locator("#subStatus")).toHaveValue("paused");
  await expect(page.locator("#subNotes")).toHaveValue("Digicode 1234");
  const envoi2 = page.waitForRequest(r => r.url().includes(`/api/subscriptions/${cree.id}`) && r.method() === "PATCH");
  await page.getByRole("button", { name: "Enregistrer les modifications" }).click();
  expect((await envoi2).postDataJSON().frequency).toEqual({ unit: "months", interval: 2 });
});

test("une fiche client se crée à la volée, puis l'abonnement", async ({ page }) => {
  await ouvrirEditeur(page);
  await page.getByRole("button", { name: "Créer une fiche client" }).click();
  await expect(page.locator("#subLastName")).toBeFocused();
  await page.locator("#subLastName").fill("Maison de santé des Essarts");
  await page.locator("#subAddress").fill("4 rue du Stade");
  await page.locator("#subCity").fill("Pontarlier");
  await page.getByRole("button", { name: "Ajouter Alèses au panier" }).click();
  await page.getByRole("button", { name: "Créer l’abonnement" }).click();
  await expect(dialogue(page)).not.toHaveAttribute("open", "");
  const clients = await (await page.request.get(srv.base + "/api/crm/clients")).json();
  const liste = Array.isArray(clients) ? clients : clients.items || clients.clients;
  const fiche = liste.find(c => c.nom === "Maison de santé des Essarts");
  expect(fiche?.ville).toBe("Pontarlier");
  const subs = (await (await page.request.get(srv.base + "/api/subscriptions")).json()).items;
  expect(subs.some(s => String(s.clientId) === String(fiche.id))).toBe(true);
});

test("sans client, le formulaire le dit et n'envoie rien", async ({ page }) => {
  await ouvrirEditeur(page);
  await page.getByRole("button", { name: "Ajouter Alèses au panier" }).click();
  let envoye = false;
  page.on("request", r => { if (r.url().endsWith("/api/subscriptions") && r.method() === "POST") envoye = true; });
  await page.getByRole("button", { name: "Créer l’abonnement" }).click();
  await expect(page.locator("#subError")).toHaveText("Choisis un client, ou crée sa fiche.");
  expect(envoye).toBe(false);
});

for (const schema of ["light", "dark"]) {
  test(`cibles de 44 px, texte lisible et focus visible (${schema})`, async ({ page }) => {
    await ouvrirEditeur(page, { schema });
    await page.getByRole("searchbox", { name: "Chercher un client" }).fill("tilleuls");
    await page.locator('#subClientResults [data-op="sub-client"]').first().click();
    await page.getByRole("button", { name: "Ajouter Changes taille L au panier" }).click();
    await page.locator("#subOptions summary").click();
    const r = await page.evaluate(() => {
      const d = document.getElementById("subscriptionDialog");
      const vus = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
      const petits = [...d.querySelectorAll("button, summary, select, input:not([type=hidden]), .abo-cr-pilule")]
        .filter(el => vus(el) && !el.closest(".abo-cr-pilule input") && !(el.type === "radio"))
        .map(el => ({ n: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 20) || el.id, h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
        .filter(m => m.h < 44 || m.w < 44);
      // Le fond reel d'un element : le premier ancetre opaque.
      const fond = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(.*,\s*0\)$/.test(c) && c !== "transparent") return c; } return "rgb(255, 255, 255)"; };
      const paires = [
        ".abo-cr-libelle", ".abo-cr-client-nom", ".abo-cr-client-adresse", ".abo-cr-produit-stock",
        ".abo-cr-pilule", ".abo-cr-pilule:has(input:checked)", ".abo-cr-apercu-ecart", ".abo-cr-note",
        ".abo-cr-options summary", ".abo-cr-pied .button.primary", ".abo-cr-pied .button.secondary", ".abo-cr-entete h2",
        ".abo-cr-produit-nom", ".abo-cr-quantite", ".abo-cr-lien", ".abo-cr-retirer", "#subStatus"
      ].map(sel => { const el = [...d.querySelectorAll(sel)].find(vus); return el ? { sel, texte: getComputedStyle(el).color, fond: fond(el) } : { sel, absent: true }; });
      return { petits, paires };
    });
    expect(r.petits).toEqual([]);
    const faibles = r.paires.filter(p => p.absent || contraste(p.texte, p.fond) < 4.5)
      .map(p => p.absent ? `${p.sel} absent` : `${p.sel} ${contraste(p.texte, p.fond).toFixed(2)}`);
    expect(faibles).toEqual([]);
    // Le focus d'une pilule se voit sur la pilule (le radio est transparent).
    await page.getByRole("radio", { name: "Tous les 7 jours" }).focus();
    await page.keyboard.press("ArrowRight");
    const anneau = await page.evaluate(() => getComputedStyle(document.activeElement.closest(".abo-cr-pilule")).boxShadow);
    expect(anneau).not.toBe("none");
    await expect(page.getByRole("radio", { name: "Tous les 10 jours" })).toBeChecked();
  });
}

test("au bureau : la même logique dans une fenêtre V8, la croix à droite du titre", async ({ page }) => {
  await ouvrirEditeur(page, { vp: BUREAU });
  const m = await page.evaluate(() => {
    const d = document.getElementById("subscriptionDialog");
    const t = document.getElementById("subDialogTitle").getBoundingClientRect();
    const f = d.querySelector('[data-op="close-sub"][aria-label="Fermer"]').getBoundingClientRect();
    const b = d.getBoundingClientRect();
    return { rayon: getComputedStyle(d).borderTopLeftRadius, largeur: b.width, croixADroite: f.left > t.right, croix: [f.width, f.height] };
  });
  expect(m).toEqual({ rayon: "28px", largeur: 640, croixADroite: true, croix: [44, 44] });
  await expect(page.getByRole("searchbox", { name: "Chercher un client" })).toBeVisible();
  await expect(page.locator("#subApercu li")).toHaveCount(3);
});

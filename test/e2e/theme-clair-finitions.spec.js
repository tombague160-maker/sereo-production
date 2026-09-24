// E2E : les finitions du bureau relevees par l'audit du 24/09 (angle bureau),
// surtout en theme clair -- celui qu'un poste Windows affiche par defaut.
//
// Chaque assertion lit un STYLE CALCULE, une GEOMETRIE ou un TEXTE rendu, sur un
// serveur seme (port 3527) : des commandes, une bloquee, une planifiee, trois
// abonnements, des clients a Besancon. Sur une base vide, il n'y aurait ni
// ligne, ni badge, ni nom a couper.

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  const base = seed.commandes[0];
  // Une planifiee : son detail porte « Annuler la commande ».
  seed.commandes.push({ ...base, id: "o-plan", numero: "CMD-2026-902", status: "planifiee",
    clientName: "Residence Les Glycines", deliveryDate: "2026-12-01", deliveredAt: null });
  srv = await demarrer({ port: 3527, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

// Un rappel SERVI PAR LE BANC : le jeu seme n'en a pas, et la liste des Rappels
// ne montrerait que son etat vide.
const RAPPELS = [{
  id: "rel-1", clientId: "c-bellevue", datePrevue: AUJOURDHUI, motif: "Reprendre contact",
  status: "a_faire", commentaire: "Appeler avant midi"
}];

let chargements = 0;
async function ouvrir(page, ecran, { largeur = 1440, hauteur = 900, schema = "light" } = {}) {
  await page.route("**/api/reminders", route => route.fulfill({ json: RAPPELS }));
  await page.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
  await page.setViewportSize({ width: largeur, height: hauteur });
  // Un vrai chargement a chaque fois : un simple changement d'ancre laisserait
  // ouverte la fenetre du test precedent.
  chargements += 1;
  await page.goto(`${srv.base}/?v=${chargements}#${ecran}`, { waitUntil: "networkidle" });
  await expect(page.locator(`#${ecran}`)).toHaveClass(/active/);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

/** La valeur resolue d'un jeton de couleur dans le theme courant. */
async function jeton(page, nom) {
  return page.evaluate(n => {
    const t = document.createElement("span");
    t.style.color = `var(${n})`;
    document.body.appendChild(t);
    const c = getComputedStyle(t).color;
    t.remove();
    return c;
  }, nom);
}

const style = (locator, props) => locator.evaluate((el, p) => {
  const cs = getComputedStyle(el);
  return Object.fromEntries(p.map(k => [k, cs.getPropertyValue(k)]));
}, props);

const THEMES = ["light", "dark"];

// --- 1. Les gestes qui detruisent ---------------------------------------------

for (const schema of THEMES) {
  test(`« Purger » a le dessin d'un geste destructeur, distinct d'« Enregistrer » (${schema})`, async ({ page }) => {
    await ouvrir(page, "parametres", { schema });
    const alerte = await jeton(page, "--v8-alerte");
    const purger = await style(page.locator('[data-action="purge-orders"]'), ["background-color", "background-image", "color", "border-top-color"]);
    const enregistrer = await style(page.locator("#numerotationForm button[type=submit]").first(), ["background-color", "color"]);
    expect(purger["background-image"], "un degrade (interdit par la charte)").toBe("none");
    expect(purger["background-color"], "le fond d'« Enregistrer »").not.toBe(enregistrer["background-color"]);
    expect(purger.color).toBe(alerte);
    expect(purger["border-top-color"]).toBe(alerte);
    // Et plus d'emoji : la corbeille est une icone lineaire.
    expect(await page.locator('[data-action="purge-orders"]').innerText()).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    await expect(page.locator('[data-action="purge-orders"] svg')).toHaveCount(1);
  });

  test(`« Annuler la commande » a le meme dessin que « Purger » (${schema})`, async ({ page }) => {
    await ouvrir(page, "commandes", { schema });
    await page.locator('[data-cmd-filtre="planifiees"]').click();
    await page.locator('[data-cmd-ouvrir="o-plan"]').click();
    const annuler = page.locator('#cmdDetailGestes [data-action="cmd-annuler"]');
    await expect(annuler).toBeVisible();
    const alerte = await jeton(page, "--v8-alerte");
    const s = await style(annuler, ["background-image", "color", "border-top-color"]);
    expect(s["background-image"]).toBe("none");
    expect(s.color).toBe(alerte);
    expect(s["border-top-color"]).toBe(alerte);
  });
}

test("la seconde confirmation de la purge ne demande pas de « taper » quoi que ce soit", async ({ page }) => {
  await ouvrir(page, "parametres");
  let purges = 0;
  page.on("request", r => { if (/\/api\/orders\/purge/.test(r.url())) purges += 1; });
  const messages = [];
  page.on("dialog", d => {
    messages.push(d.message());
    // La premiere est acceptee, la seconde refusee : rien ne part.
    if (messages.length === 1) d.accept(); else d.dismiss();
  });
  await page.locator('[data-action="purge-orders"]').click();
  await expect.poll(() => messages.length).toBe(2);
  expect(messages[1]).not.toMatch(/tape/i);
  expect(messages[1]).toMatch(/Purger maintenant \?/);
  await page.waitForTimeout(300);
  expect(purges, "refusee, la purge est partie quand meme").toBe(0);
});

// --- 2. Les liens, le filtre choisi, la ligne choisie ------------------------

for (const schema of THEMES) {
  test(`« Tous les abonnements » est un lien de la charte, pas le bleu du navigateur (${schema})`, async ({ page }) => {
    await ouvrir(page, "journee", { schema });
    const principal = await jeton(page, "--v8-principal");
    const s = await style(page.locator("#journee .tb-lien"), ["color", "text-decoration-line"]);
    expect(s.color).toBe(principal);
    expect(s["text-decoration-line"]).toBe("none");
  });

  test(`le filtre choisi se voit : Preparation, Analyse, Clients (${schema})`, async ({ page }) => {
    await ouvrir(page, "preparation", { schema });
    const principal = await jeton(page, "--v8-principal");
    const tous = await style(page.locator('#preparation .filtre-pilule[aria-pressed="true"]').first(), ["background-color"]);
    const autre = await style(page.locator('#preparation .filtre-pilule[aria-pressed="false"]').first(), ["background-color"]);
    expect(tous["background-color"], "« Tous » choisi").toBe(principal);
    expect(autre["background-color"], "temoin : une pilule non choisie reste claire").not.toBe(principal);

    await ouvrir(page, "statistiques", { schema });
    const onglet = await style(page.locator('#sousOnglets [aria-selected="true"]'), ["background-color"]);
    const voisin = await style(page.locator('#sousOnglets [aria-selected="false"]').first(), ["background-color"]);
    expect(onglet["background-color"], "« Analyse » choisi").toBe(principal);
    expect(voisin["background-color"]).not.toBe(principal);

    await ouvrir(page, "crm", { schema });
    const choisie = page.locator("#crm .cli-ligne.cli-ligne--choisie");
    await expect(choisie).toHaveCount(1);
    const c = await style(choisie, ["background-color", "box-shadow"]);
    expect(c["background-color"], "la ligne de la fiche affichee").not.toBe("rgba(0, 0, 0, 0)");
    expect(c["box-shadow"]).toContain("inset");
    const autreLigne = page.locator("#crm .cli-ligne:not(.cli-ligne--choisie)").first();
    const avant = await style(autreLigne, ["background-color"]);
    await autreLigne.hover();
    await page.waitForTimeout(250);
    const survol = await style(autreLigne, ["background-color"]);
    expect(avant["background-color"], "temoin : au repos, la ligne est transparente").toBe("rgba(0, 0, 0, 0)");
    expect(survol["background-color"], "le survol ne se voyait pas").not.toBe("rgba(0, 0, 0, 0)");
  });
}

// --- 3. Les champs : l'indication legere, la saisie en 500 --------------------

for (const schema of THEMES) {
  test(`les indications des champs sont en 400, la saisie en 500 (${schema})`, async ({ page }) => {
    const champs = { commandes: "#cmdRecherche", crm: "#crmSearch", stock: "#stockSearch", abonnements: "#subscriptionSearch", relances: "#relances input[name=motif]", parametres: "#compteForm input[name=identifiant]" };
    const faux = [];
    for (const [ecran, sel] of Object.entries(champs)) {
      await ouvrir(page, ecran, { schema });
      const champ = page.locator(sel).first();
      await expect(champ).toBeVisible();
      const r = await champ.evaluate(el => ({
        indication: getComputedStyle(el, "::placeholder").fontWeight,
        saisie: getComputedStyle(el).fontWeight,
        texte: el.placeholder
      }));
      expect(r.texte, `${ecran} : le champ n'a pas d'indication a juger`).not.toBe("");
      if (r.indication !== "400") faux.push(`${ecran} ${sel} : indication en ${r.indication}`);
      if (r.saisie !== "500") faux.push(`${ecran} ${sel} : saisie en ${r.saisie}`);
    }
    expect(faux, faux.join("\n")).toEqual([]);
  });
}

// --- 4. Preparation : « Bloquee » rouge, avec son icone ----------------------

for (const schema of THEMES) {
  test(`Preparation au bureau : « Bloquee » porte le badge d'alerte, pas celui de « A faire » (${schema})`, async ({ page }) => {
    await ouvrir(page, "preparation", { schema });
    const alerte = await jeton(page, "--v8-alerte");
    const bloquee = page.locator("#preparationList .commande-ligne--bloquee .pill");
    await expect(bloquee).toHaveCount(1);
    await expect(bloquee).toHaveText("Bloquée");
    await expect(bloquee.locator("svg")).toHaveCount(1);
    const b = await style(bloquee, ["color", "background-color"]);
    const aFaire = await style(page.locator("#preparationList .commande-ligne--a-faire .pill").first(), ["color", "background-color"]);
    expect(b.color).toBe(alerte);
    expect(`${b.color} ${b["background-color"]}`).not.toBe(`${aFaire.color} ${aFaire["background-color"]}`);
  });
}

// --- 5. Besancon, avec sa cedille ---------------------------------------------

test("« Besançon » avec sa cédille : liste et fiche client, Modifier, Nouvel abonnement, détail de commande", async ({ page }) => {
  // Le serveur range la ville sans accent (normalizeCity) : le jeu seme ecrit
  // « Besançon », l'API rend « Besancon ». C'est l'affichage qui la corrige.
  const clients = await (await page.request.get(srv.base + "/api/crm/clients")).json();
  const liste = Array.isArray(clients) ? clients : clients.items || clients.clients;
  expect(liste.find(c => c.id === "c-tilleuls").ville, "prealable : la valeur stockee").toBe("Besancon");

  await ouvrir(page, "crm");
  const textes = await page.locator("#crmList").innerText();
  expect(textes).toContain("Besançon");
  expect(textes).not.toMatch(/Besancon/);
  await page.locator('[data-cli-choisir="c-tilleuls"]').click();
  await expect(page.locator("#cliFiche")).toContainText("25000 Besançon");
  await page.locator('#cliFiche [data-action="cli-modifier"]').click();
  await expect(page.locator('#cliDialogue input[name="ville"]')).toHaveValue("Besançon");
  await page.keyboard.press("Escape");

  await ouvrir(page, "abonnements");
  await page.locator(".abo-nouveau").click();
  await expect(page.locator("#subClientResults")).toContainText("Besançon");
  await expect(page.locator("#subClientResults")).not.toContainText("Besancon");

  await ouvrir(page, "commandes");
  await page.locator('[data-cmd-ouvrir="o-3"]').click();
  await expect(page.locator("#bdc-detail-modal")).toContainText("Besançon");
  await expect(page.locator("#bdc-detail-modal")).not.toContainText("Besancon");
});

// --- 6. Modifier le client : les notes a leur taille -------------------------

for (const schema of THEMES) {
  test(`« Modifier le client » : le champ Notes a la largeur des autres, son libellé au-dessus (${schema})`, async ({ page }) => {
    await ouvrir(page, "crm", { schema });
    await page.locator("#crm .cli-ligne").first().click();
    await page.locator('#cliFiche [data-action="cli-modifier"]').click();
    const r = await page.locator("#cliDialogue textarea[name=notes]").evaluate(el => {
      const t = el.getBoundingClientRect(), l = el.closest("label").getBoundingClientRect();
      const adresse = el.closest("form").querySelector("input[name=adresse]").getBoundingClientRect();
      return { largeur: t.width, largeurAdresse: adresse.width, hauteur: t.height, gauche: t.left, gaucheLabel: l.left, haut: t.top, hautLabel: l.top };
    });
    expect(Math.abs(r.largeur - r.largeurAdresse), `notes ${r.largeur} px, adresse ${r.largeurAdresse} px`).toBeLessThanOrEqual(1);
    expect(Math.abs(r.gauche - r.gaucheLabel)).toBeLessThanOrEqual(1);
    expect(r.haut - r.hautLabel, "le libelle n'est pas au-dessus du champ").toBeGreaterThanOrEqual(15);
    expect(r.hauteur).toBeGreaterThanOrEqual(96);
  });
}

// --- 7. Commandes, Stock et Abonnements sur un portable ----------------------

/** Les textes coupes (points de suspension) d'un conteneur. */
const coupes = (page, sel) => page.locator(sel).evaluateAll(els => els
  .filter(el => el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 1)
  .map(el => `${el.innerText.trim()} (${el.clientWidth}/${el.scrollWidth})`));

for (const schema of THEMES) {
  test(`Commandes à 1280 x 720 : un tableau, au moins 8 lignes à l'écran, aucun nom coupé (${schema})`, async ({ page }) => {
    await ouvrir(page, "commandes", { largeur: 1280, hauteur: 720, schema });
    await expect(page.locator("#commandes .cmd-entete")).toBeVisible();
    const r = await page.locator("#cmdLignes .cmd-ligne").evaluateAll(ls => ls.map(l => {
      const b = l.getBoundingClientRect();
      return { bas: b.bottom, hauteur: b.height, date: l.querySelector(".cmd-date").innerText.replace(/\s+/g, " ").trim() };
    }));
    expect(r.length, "prealable : dix commandes semees").toBeGreaterThanOrEqual(8);
    const visibles = r.filter(l => l.bas <= 720).length;
    expect(visibles, `lignes entieres dans l'ecran (hauteur ${r[0].hauteur})`).toBeGreaterThanOrEqual(8);
    expect(r[0].hauteur, "une ligne reste une cible").toBeGreaterThanOrEqual(44);
    expect(r[0].date).toMatch(/^\d{1,2} [a-zéû]+\.?$/);
    expect(await coupes(page, "#cmdLignes .cmd-client, #cmdLignes .cmd-date, #cmdLignes .cmd-statut, #pageTitle")).toEqual([]);
  });
}

for (const largeur of [1280, 1366, 1439]) {
  test(`Commandes et Stock à ${largeur} px : des tableaux, aucun nom coupé`, async ({ page }) => {
    await ouvrir(page, "commandes", { largeur, hauteur: 800 });
    await expect(page.locator("#commandes .cmd-entete")).toBeVisible();
    expect(await coupes(page, "#cmdLignes .cmd-client, #cmdLignes .cmd-date, #cmdLignes .cmd-statut")).toEqual([]);
    await ouvrir(page, "stock", { largeur, hauteur: 800 });
    await expect(page.locator("#stock .stk-entete")).toBeVisible();
    expect(await coupes(page, "#stockList .stk-nom, #stockList .stk-code, #stockList .stk-reserve")).toEqual([]);
  });
}

for (const largeur of [1280, 1440]) {
  for (const schema of THEMES) {
    test(`Abonnements à ${largeur} px : « EHPAD Les Tilleuls… » et « EHPAD Résidence… » entiers (${schema})`, async ({ page }) => {
      await ouvrir(page, "abonnements", { largeur, schema });
      const noms = await page.locator("#abonnements .abonnement-ligne .commande-ligne-corps > strong").allInnerTexts();
      expect(noms.some(n => /EHPAD Les Tilleuls/.test(n)) && noms.some(n => /EHPAD Résidence/.test(n)), noms.join(" | ")).toBe(true);
      expect(await coupes(page, "#abonnements .abonnement-ligne .commande-ligne-corps > strong, #abonnements .abonnement-ligne .abo-cellule, #abonnements .abo-echeance-texte strong")).toEqual([]);
      await expect(page.locator("#abonnements .abo-frequence").first()).toHaveText("Toutes les 2 semaines");
    });
  }
}

// --- 8. Les petites finitions ---------------------------------------------------

test("le détail d'une commande : « Technique » replié, aucun emoji", async ({ page }) => {
  await ouvrir(page, "commandes");
  await page.locator('[data-cmd-ouvrir="o-3"]').click();
  const detail = page.locator("#bdc-detail-modal");
  await expect(detail).toBeVisible();
  const technique = detail.locator(".bdc-detail-tech");
  await expect(technique).toHaveCount(1);
  expect(await technique.evaluate(el => el.tagName)).toBe("DETAILS");
  expect(await technique.evaluate(el => el.open), "« Technique » est ouvert").toBe(false);
  await expect(detail.getByText("Empreinte (anti-doublon)")).toBeHidden();
  expect(await detail.innerText()).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
});

test("Nouvel abonnement : le client choisi, sa carte se replie sur lui", async ({ page }) => {
  await ouvrir(page, "abonnements");
  await page.locator(".abo-nouveau").click();
  await expect(page.locator("#subNouveauClient")).toBeVisible();
  await page.locator('#subClientResults [data-op="sub-client"]').first().click();
  await expect(page.locator("#subClientChoisi")).toBeVisible();
  await expect(page.locator("#subClientRecherche")).toBeHidden();
  await expect(page.locator("#subNouveauClient"), "« Créer une fiche client » reste sous le client choisi").toBeHidden();
  // Changer de client rend la recherche et le bouton.
  await page.locator('[data-op="sub-client-changer"]').click();
  await expect(page.locator("#subNouveauClient")).toBeVisible();
});

for (const schema of THEMES) {
  test(`À recommander : des chiffres neutres, le rouge pour la rupture seulement ; la liste n'est pas rognée (${schema})`, async ({ page }) => {
    await ouvrir(page, "recommande", { schema });
    const texte = await jeton(page, "--v8-texte");
    const alerte = await jeton(page, "--v8-alerte");
    const chiffres = await page.locator("#recommande .stock-kpis > span").evaluateAll(spans => spans.map(s => ({
      mot: s.querySelector("small").innerText.trim(), valeur: s.querySelector("strong").innerText.trim(),
      couleur: getComputedStyle(s.querySelector("strong")).color
    })));
    expect(chiffres.length, "prealable : un produit a recommander (les gants, a zero)").toBeGreaterThanOrEqual(4);
    for (const c of chiffres) {
      const rupture = c.mot === "Stock actuel" && Number(c.valeur) <= 0;
      expect(c.couleur, `${c.mot} ${c.valeur}`).toBe(rupture ? alerte : texte);
    }
    const r = await page.locator("#recommande .list").first().evaluate(l => {
      const carte = l.firstElementChild.getBoundingClientRect(), liste = l.getBoundingClientRect();
      return { haut: carte.top - liste.top, gauche: carte.left - liste.left };
    });
    expect(r.haut, "la premiere carte touche le bord haut de la liste qui defile").toBeGreaterThanOrEqual(2);
    expect(r.gauche).toBeGreaterThanOrEqual(2);
  });
}

test("les deux « À jour » ne disent plus le même mot : données dans l'en-tête, version dans la barre", async ({ page }) => {
  await ouvrir(page, "journee");
  await expect(page.locator("#syncStatus")).toHaveText("À jour", { timeout: 10000 });
  await expect(page.locator("#sidebarVersionEtat")).toBeVisible();
  await expect(page.locator("#sidebarVersionEtat")).toHaveText("Dernière version");
});

// --- 9. Et ce que l'affichage de la ville ne doit PAS faire -------------------

test("« Modifier le client » ne réécrit pas la ville : seule la valeur changée part", async ({ page }) => {
  await ouvrir(page, "crm");
  await page.locator('[data-cli-choisir="c-veto"]').click();
  await page.locator('#cliFiche [data-action="cli-modifier"]').click();
  await expect(page.locator('#cliDialogue input[name="ville"]')).toHaveValue("Besançon");
  await page.locator('#cliDialogue input[name="telephone"]').fill("0381000001");
  const envois = [];
  page.on("request", r => { if (/\/api\/(crm\/)?clients\//.test(r.url()) && ["PATCH", "PUT"].includes(r.method())) envois.push(r.postDataJSON()); });
  await page.locator('#cliDialogue button[type="submit"]').click();
  await expect(page.locator("#cliDialogue")).not.toHaveAttribute("open", "");
  expect(envois.length, "la modification n'est pas partie").toBeGreaterThan(0);
  expect(envois.some(c => c.telephone === "0381000001")).toBe(true);
  expect(envois.flatMap(c => Object.keys(c)), "la ville est partie avec la modification").not.toContain("ville");
  await page.waitForTimeout(500);
  const clients = await (await page.request.get(srv.base + "/api/crm/clients")).json();
  const liste = Array.isArray(clients) ? clients : clients.items || clients.clients;
  expect(liste.find(c => c.id === "c-veto").ville).toBe("Besancon");
});

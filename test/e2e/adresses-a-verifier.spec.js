// « ADRESSES A VERIFIER » -- lot 3 de l'audit geo (23/09), H7.
//
// Avant : aucun ecran. Un client sans position ne se voyait nulle part ; la
// seule saisie de coordonnees (deux champs numeriques, cachee au telephone)
// envoyait l'identifiant de l'ARRET au lieu du client ; un calcul de tournee
// refuse ne nommait qu'une adresse a la fois.
//
// Ce banc mesure, au bureau et au telephone, sur un serveur seme :
//   - l'alerte « N clients a livrer sans position » dans la preparation ;
//   - le calcul refuse qui nomme TOUTES les adresses, chacune avec « Corriger » ;
//   - la proposition acceptee d'un clic, la recherche, le marqueur deplace ;
//   - la saisie inversee refusee puis corrigee par « Inverser » ;
//   - « Corriger la position » depuis l'arret en cours ;
//   - cibles >= 44 px, focus visible, contraste des puces dans les deux modes.
//
// Aucun appel externe : la BAN est un faux serveur local, les tuiles sont
// servies par ./tuiles, OSRM par serveur-seme.
const http = require("node:http");
const { once } = require("node:events");
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const VUES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

// --- Faux geocodeur (BAN) -------------------------------------------------------
let ban;
let banUrl;
const requetesBan = [];
function trait(lat, lng, label, type = "housenumber", score = 0.95) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { label, type, score, postcode: "25000", city: "Besançon" } };
}
function reponseBan(q) {
  if (q.includes("granges")) return [trait(47.21, 5.99, "Les Granges 25000 Besançon", "locality", 0.9)];
  if (q.includes("3 rue de la gare")) return [trait(46.7452, 5.9101, "3 Rue de la Gare 39300 Champagnole")];
  return [];
}

function graine() {
  const seed = jeuDeDonnees();
  seed.clients.push(
    { id: "c-sans", nom: "Ferme des Granges", rue: "9 lieu-dit Les Granges", ville: "Besançon", codePostal: "25000", lat: "", lng: "", crmStatus: "client_actif" },
    { id: "c-inconnu", nom: "Atelier Introuvable", rue: "99 impasse Nulle Part", ville: "Besançon", codePostal: "25000", lat: "", lng: "", crmStatus: "client_actif" }
  );
  const dupont = seed.clients.find(c => c.id === "c-dupont");
  Object.assign(dupont, { geoSource: "ban", geoPrecision: "rue" });
  const commande = (id, c) => ({
    id, clientId: c.id, clientName: c.nom, status: "pret_livraison",
    address: c.rue, city: c.ville, postalCode: c.codePostal, lat: "", lng: "",
    deliveryDate: AUJOURDHUI, dateCommande: AUJOURDHUI,
    products: [{ code: "CH-L", nom: "Changes taille L", prixUnitaire: 12, quantite: 2 }]
  });
  seed.commandes.push(
    commande("o-11", seed.clients.find(c => c.id === "c-sans")),
    commande("o-12", seed.clients.find(c => c.id === "c-inconnu"))
  );
  return seed;
}

let srv;
test.beforeAll(async () => {
  ban = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const q = (url.searchParams.get("q") || "").toLowerCase();
    requetesBan.push(q);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ type: "FeatureCollection", features: reponseBan(q) }));
  });
  ban.listen(0, "127.0.0.1");
  await once(ban, "listening");
  banUrl = `http://127.0.0.1:${ban.address().port}/search/`;
  srv = await demarrer({ port: 3192, seed: graine(), env: { SEREO_GEOCODER_URL: banUrl, SEREO_GEOCODER_INTERVALLE_MS: "0" } });
  // Le lot de fond remplit le cache : la Ferme a une proposition (lieu-dit),
  // l'Atelier est introuvable.
  const lot = await fetch(`${srv.base}/api/geocodage/lancer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  expect(lot.status).toBe(200);
});
test.afterAll(async () => {
  if (srv) await srv.arreter();
  if (ban) {
    ban.closeAllConnections?.();
    await new Promise(r => ban.close(r));
  }
});

async function ouvrir(browser, vue, options = {}) {
  const ctx = await browser.newContext({
    viewport: VUES[vue],
    geolocation: { latitude: 47.24, longitude: 6.02 },
    permissions: ["geolocation"],
    ...options
  });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(srv.base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  // Une tournee roule : la preparation est repliee. On l'ouvre.
  await page.evaluate(() => { document.getElementById("routePlanning").open = true; });
  return { ctx, page, erreurs };
}

const ligne = (page, id) => page.locator(`#adressesDialog [data-adr-ligne="${id}"]`);

test("l'alerte de la preparation compte les clients a livrer sans position ; un calcul refuse les nomme TOUS", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "desktop");
  const alerte = page.locator("#adressesAlerte");
  await expect(alerte).toBeVisible();
  await expect(alerte).toContainText("2 clients à livrer sans position");
  await expect(alerte).toContainText("1 position approximative");

  await page.click('[data-op="locate"]');
  await page.check("#returnToStart");
  await page.check('[data-delivery-order="o-11"]');
  await page.check('[data-delivery-order="o-12"]');
  await page.click("#createRouteButton");

  const liste = page.locator("#adressesTourneeErreurs");
  await expect(liste).toBeVisible();
  await expect(liste).toContainText("2 adresses bloquent le calcul");
  await expect(liste).toContainText("Ferme des Granges");
  await expect(liste).toContainText("Atelier Introuvable");
  await expect(liste.getByRole("button", { name: "Corriger" })).toHaveCount(2);

  // « Corriger » ouvre l'ecran sur CE client, editeur deplie.
  await liste.locator("li", { hasText: "Atelier Introuvable" }).getByRole("button", { name: "Corriger" }).click();
  await expect(page.locator("#adressesDialog")).toBeVisible();
  await expect(ligne(page, "c-inconnu").locator("[data-adr-editeur]")).toBeVisible();
  await expect(ligne(page, "c-inconnu").locator(".leaflet-container")).toBeVisible();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("au telephone : la liste, et la proposition de la BAN acceptee d'un clic", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "mobile");
  await page.locator("#adressesAlerte").getByRole("button", { name: "Vérifier les adresses" }).click();
  const dialogue = page.locator("#adressesDialog");
  await expect(dialogue).toBeVisible();
  await expect(ligne(page, "c-sans")).toContainText("Sans position");
  await expect(ligne(page, "c-inconnu")).toContainText("Sans position");
  await expect(ligne(page, "c-dupont")).toContainText("Approximative");
  await expect(ligne(page, "c-dupont")).toContainText("au milieu de la rue");
  await expect(dialogue).toContainText("Base Adresse Nationale");

  // La largeur du telephone tient : rien ne deborde.
  const deborde = await dialogue.evaluate(d => d.scrollWidth > d.clientWidth + 1);
  expect(deborde).toBe(false);

  // Cibles tactiles : chaque bouton visible du dialogue fait au moins 44 px.
  const hauteurs = await dialogue.locator("button:visible").evaluateAll(bs => bs.map(b => [b.textContent.trim().slice(0, 30), Math.round(b.getBoundingClientRect().height)]));
  expect(hauteurs.filter(([, h]) => h < 44)).toEqual([]);

  const envoi = page.waitForRequest(r => r.method() === "PATCH" && r.url().includes("/api/clients/c-sans/coordinates"));
  await ligne(page, "c-sans").getByRole("button", { name: /Accepter la proposition/ }).click();
  const corps = JSON.parse((await envoi).postData());
  expect(corps.lat).toBe(47.21);
  expect(corps.lng).toBe(5.99);
  await expect(ligne(page, "c-sans")).toHaveCount(0);
  await expect(ligne(page, "c-inconnu")).toBeVisible();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("la recherche place le marqueur ; le marqueur deplace a la main est enregistre comme tel", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "desktop");
  await page.locator("#adressesAlerte").getByRole("button", { name: "Vérifier les adresses" }).click();
  const dupont = ligne(page, "c-dupont");
  await dupont.getByRole("button", { name: "Placer sur la carte" }).click();
  await expect(dupont.locator(".leaflet-marker-icon")).toBeVisible();

  const champ = dupont.locator("[data-adr-champ]");
  await champ.fill("3 rue de la Gare Champagnole");
  await champ.press("Enter");
  await dupont.getByRole("button", { name: /3 Rue de la Gare 39300 Champagnole/ }).click();
  await expect(dupont.locator("[data-adr-position]")).toContainText("46,7452");
  await expect(dupont.locator("[data-adr-position]")).toContainText("au numéro");

  // Le marqueur glisse de 80 px vers la droite : la position change et
  // devient « placee a la main ».
  const icone = await dupont.locator(".leaflet-marker-icon").boundingBox();
  await page.mouse.move(icone.x + icone.width / 2, icone.y + icone.height - 4);
  await page.mouse.down();
  await page.mouse.move(icone.x + icone.width / 2 + 40, icone.y + icone.height - 4, { steps: 5 });
  await page.mouse.move(icone.x + icone.width / 2 + 80, icone.y + icone.height - 4, { steps: 5 });
  await page.mouse.up();
  await expect(dupont.locator("[data-adr-position]")).toContainText("placée à la main");

  const envoi = page.waitForRequest(r => r.method() === "PATCH" && r.url().includes("/api/clients/c-dupont/coordinates"));
  await dupont.getByRole("button", { name: "Enregistrer cette position" }).click();
  const corps = JSON.parse((await envoi).postData());
  expect(corps.precision).toBe("manuel");
  expect(corps.lat).toBeCloseTo(46.7452, 2);
  expect(corps.lng).toBeGreaterThan(5.9101);
  await expect(ligne(page, "c-dupont")).toHaveCount(0);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("une position collee a l'envers est refusee en nommant le client, puis « Inverser » la corrige", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "desktop");
  await page.locator("#adressesAlerte").getByRole("button", { name: "Vérifier les adresses" }).click();
  const atelier = ligne(page, "c-inconnu");
  await atelier.getByRole("button", { name: "Placer sur la carte" }).click();
  const champ = atelier.locator("[data-adr-champ]");
  await champ.fill("6.0212, 47.2301");
  await champ.press("Enter");
  await atelier.getByRole("button", { name: "Enregistrer cette position" }).click();
  const erreur = atelier.locator("[data-adr-erreur]");
  await expect(erreur).toBeVisible();
  await expect(erreur).toContainText("Atelier Introuvable");
  await expect(erreur).toContainText("inversées");

  await erreur.getByRole("button", { name: "Inverser" }).click();
  await expect(atelier.locator("[data-adr-position]")).toContainText("47,2301");
  const reponse = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().includes("/api/clients/c-inconnu/coordinates"));
  await atelier.getByRole("button", { name: "Enregistrer cette position" }).click();
  expect((await reponse).status()).toBe(200);
  await expect(ligne(page, "c-inconnu")).toHaveCount(0);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("depuis l'arret en cours, « Corriger la position » ouvre le client de l'arret (pas l'arret)", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "mobile");
  await page.locator(".gestes-plus summary").click();
  await page.locator("#corrigerPositionButton").click();
  const tilleuls = ligne(page, "c-tilleuls");
  await expect(tilleuls).toBeVisible();
  await expect(tilleuls).toContainText("EHPAD Les Tilleuls");
  await expect(tilleuls.locator("[data-adr-editeur]")).toBeVisible();
  // La position actuelle du client est celle qu'on voit, prete a deplacer.
  await expect(tilleuls.locator("[data-adr-position]")).toContainText("47,238");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

function rgb(chaine) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(chaine || "");
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function luminance([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contraste(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

for (const mode of ["light", "dark"]) {
  test(`contraste des puces et du texte de l'ecran, mode ${mode === "light" ? "clair" : "sombre"} ; focus visible`, async ({ browser }) => {
    const { ctx, page, erreurs } = await ouvrir(browser, "desktop", { colorScheme: mode });
    // Remettre deux lignes a verifier : l'ecran en a besoin pour se mesurer.
    await page.evaluate(async () => {
      await fetch("/api/clients/c-veto/coordinates", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: "", lng: "" }) });
    });
    await page.evaluate(() => { document.querySelector('[data-adr="ouvrir"]')?.click(); });
    await expect(page.locator("#adressesDialog")).toBeVisible();
    await expect(ligne(page, "c-veto")).toBeVisible();

    const mesures = await page.evaluate(() => {
      const fond = el => {
        for (let n = el; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
        }
        return "rgb(255, 255, 255)";
      };
      return [...document.querySelectorAll("#adressesDialog .adr-puce, #adressesDialog .adr-nom, #adressesDialog .adr-adresse, #adressesDialog .adr-resume, #adressesDialog .adr-source")]
        .map(el => ({ quoi: el.className, texte: getComputedStyle(el).color, fond: fond(el) }));
    });
    expect(mesures.length).toBeGreaterThan(3);
    const faibles = mesures
      .map(m => ({ ...m, ratio: contraste(rgb(m.texte), rgb(m.fond)) }))
      .filter(m => m.ratio < 4.5);
    expect(faibles).toEqual([]);

    // Focus au clavier : un anneau visible sur le bouton atteint.
    const bouton = ligne(page, "c-veto").getByRole("button", { name: "Placer sur la carte" });
    await bouton.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const anneau = await bouton.evaluate(b => ({
      style: getComputedStyle(b).boxShadow + "|" + getComputedStyle(b).outlineStyle,
      actif: document.activeElement === b,
      visible: b.matches(":focus-visible")
    }));
    expect(anneau.actif && anneau.visible, JSON.stringify(anneau)).toBe(true);
    expect(anneau.style === "none|none", JSON.stringify(anneau)).toBe(false);
    expect(erreurs).toEqual([]);
    await ctx.close();
  });
}

// Relecture du lot 3 : Annuler, Accepter, Garder et Enregistrer detruisent le
// bouton qui a le focus (innerHTML). Avant, le focus retombait sur <body>.
test("au clavier, le focus reste dans la fenetre apres Annuler et apres Enregistrer", async ({ browser }) => {
  const { ctx, page, erreurs } = await ouvrir(browser, "desktop");
  // Deux lignes a verifier, quel que soit l'etat laisse par les tests d'avant.
  await page.evaluate(async () => {
    for (const id of ["c-veto", "c-inconnu"]) {
      await fetch(`/api/clients/${id}/coordinates`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: "", lng: "" }) });
    }
  });
  await page.evaluate(() => { document.querySelector('[data-adr="ouvrir"]')?.click(); });
  const veto = ligne(page, "c-veto");
  await expect(veto).toBeVisible();
  await expect(ligne(page, "c-inconnu")).toBeVisible();
  const focus = () => page.evaluate(() => {
    const a = document.activeElement;
    return {
      ligne: a?.closest("[data-adr-ligne]")?.dataset.adrLigne || "",
      action: a?.dataset?.adr || a?.id || a?.tagName || "",
      dansLaFenetre: Boolean(a && document.getElementById("adressesDialog").contains(a))
    };
  });

  // Annuler : le focus revient sur « Placer sur la carte » de la meme ligne.
  await veto.getByRole("button", { name: "Placer sur la carte" }).focus();
  await page.keyboard.press("Enter");
  await expect(veto.locator("[data-adr-editeur]")).toBeVisible();
  await veto.getByRole("button", { name: "Annuler" }).focus();
  await page.keyboard.press("Enter");
  await expect(veto.locator("[data-adr-editeur]")).toBeHidden();
  expect(await focus()).toEqual({ ligne: "c-veto", action: "corriger", dansLaFenetre: true });

  // Enregistrer : la ligne disparait, le focus passe a la ligne suivante.
  await page.keyboard.press("Enter");
  const champ = veto.locator("[data-adr-champ]");
  await expect(champ).toBeFocused();
  await champ.fill("47.2301, 6.0212");
  await champ.press("Enter");
  await expect(veto.locator("[data-adr-position]")).toContainText("47,2301");
  await veto.getByRole("button", { name: "Enregistrer cette position" }).focus();
  await page.keyboard.press("Enter");
  await expect(ligne(page, "c-veto")).toHaveCount(0);
  const apres = await focus();
  expect(apres.dansLaFenetre, JSON.stringify(apres)).toBe(true);
  expect(apres.ligne, JSON.stringify(apres)).not.toBe("");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

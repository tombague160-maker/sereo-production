// E2E : ce que la relecture independante du tableau de bord a trouve.
//
// Chaque cas a ete lance sur le code AVANT correction et rougissait pour sa
// propre raison. Deux constats sont remarquables :
//  - l'histogramme plat : la premiere capture le montrait, et l'explication
//    « la base de test n'a pas de chiffre d'affaires » etait plausible -- et
//    fausse. Le jeu seme a du chiffre sur le mois courant : une barre doit
//    donc monter, les autres rester basses ;
//  - « Importer les ventes » ouvrait le selecteur et n'envoyait jamais le
//    fichier, sans rien dire.

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  // Une commande EN PREPARATION : la tuile la compte (stock_a_verifier,
  // en_preparation, preparation_terminee), l'ancien sous-titre non (importe et
  // stock_a_verifier preparables). Sans elle, les deux calculs tombaient par
  // hasard sur le meme nombre, et le banc passait sur le defaut.
  const commandes = seed.commandes || seed.orders;
  commandes.push({ ...commandes[0], id: "o-en-prep", numero: "CMD-2026-990", status: "en_preparation", deliveredAt: null });
  srv = await demarrer({ port: 3153, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, { mode = "light", largeur = 1440 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: 900 }, colorScheme: mode });
  await ctx.addInitScript(v => { try { localStorage.setItem("sereo:colorScheme", v); } catch { /* ignore */ } }, mode);
  const page = await ctx.newPage();
  await page.goto(srv.base + "/#journee", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  return { ctx, page };
}

test("l'histogramme n'est pas plat : le mois qui a du chiffre monte", async ({ browser }) => {
  const { ctx, page } = await ouvrir(browser);
  const barres = await page.evaluate(() =>
    [...document.querySelectorAll("#revenueChart .revenue-column")].map(c => ({
      courant: c.classList.contains("revenue-courant"),
      hauteur: Math.round(c.querySelector("i").getBoundingClientRect().height),
      piste: Math.round(c.querySelector(".revenue-track").getBoundingClientRect().height)
    })));
  console.log(`[histogramme] ${barres.map(b => b.hauteur + (b.courant ? "*" : "")).join(" ")} (piste ${barres[0]?.piste})`);
  expect(barres.length).toBe(8);
  const courant = barres.find(b => b.courant);
  expect(courant, "le mois courant est marque").toBeTruthy();
  // Le jeu seme n'a de chiffre que ce mois-ci : sa barre est la plus haute
  // et occupe l'essentiel de la piste. Plates, toutes feraient 6 px.
  expect(courant.hauteur, "la barre du mois courant monte").toBeGreaterThan(courant.piste * 0.8);
  expect(Math.max(...barres.filter(b => !b.courant).map(b => b.hauteur))).toBeLessThan(courant.hauteur);
  await ctx.close();
});

test("« Importer les ventes » ENVOIE le fichier choisi", async ({ browser }) => {
  const { ctx, page } = await ouvrir(browser);
  const envoi = page.waitForRequest(r => r.method() === "POST" && /import/i.test(r.url()), { timeout: 8000 })
    .then(() => true).catch(() => false);
  const [selecteur] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('#enteteActions [data-action="importer-ventes"]').click()
  ]);
  await selecteur.setFiles({ name: "ventes.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("PK") });
  expect(await envoi, "le fichier choisi doit partir vers le serveur").toBe(true);
  await ctx.close();
});

test("le formulaire d'import du bas garde SON geste : choisir n'envoie pas", async ({ browser }) => {
  // Le temoin inverse : l'envoi automatique ne vaut que pour le bouton de
  // l'en-tete. Dans le panneau, on choisit, PUIS on clique « Importer ».
  const { ctx, page } = await ouvrir(browser);
  const envoi = page.waitForRequest(r => r.method() === "POST" && /import/i.test(r.url()), { timeout: 2500 })
    .then(() => true).catch(() => false);
  await page.locator("#ventesFile").setInputFiles({ name: "ventes.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("PK") });
  expect(await envoi, "choisir un fichier dans le panneau ne doit rien envoyer").toBe(false);
  await ctx.close();
});

test("le sous-titre compte la meme chose que la tuile", async ({ browser }) => {
  const { ctx, page } = await ouvrir(browser);
  const r = await page.evaluate(() => ({
    tuile: document.getElementById("dashboardPreparingCount").textContent.trim(),
    sousTitre: document.getElementById("pageSubtitle").textContent
  }));
  const m = /(\d+) commandes? à préparer/.exec(r.sousTitre);
  expect(m, `sous-titre : ${r.sousTitre}`).toBeTruthy();
  expect(m[1]).toBe(r.tuile);
  await ctx.close();
});

test("en clair, les titres des cartes suivent la planche : 600, couleur du texte", async ({ browser }) => {
  const { ctx, page } = await ouvrir(browser);
  const titres = await page.evaluate(() => {
    const texte = getComputedStyle(document.documentElement).getPropertyValue("--v8-texte").trim();
    return [...document.querySelectorAll("#journee .tb-regler h3, #journee .tb-semaine h3")].map(h => {
      const cs = getComputedStyle(h);
      return { poids: cs.fontWeight, couleur: cs.color, texte };
    });
  });
  expect(titres.length).toBe(2);
  for (const t of titres) {
    expect(t.poids).toBe("600");
    expect(t.couleur).toBe("rgb(56, 107, 109)");   // --v8-texte en clair : #386B6D
  }
  await ctx.close();
});

test("en sombre, « Ouvrir la carte » est plein, en principal", async ({ browser }) => {
  const { ctx, page } = await ouvrir(browser, { mode: "dark" });
  const b = await page.evaluate(() => {
    const e = document.querySelector("#dashboardTournee .button.primary");
    if (!e || !e.checkVisibility()) return null;
    const cs = getComputedStyle(e);
    return { fond: cs.backgroundColor, texte: cs.color };
  });
  expect(b, "la carte de tournee doit etre visible avec le jeu seme").toBeTruthy();
  expect(b.fond).toBe("rgb(147, 203, 201)");        // --v8-principal en sombre
  expect(b.texte).toBe("rgb(13, 21, 24)");          // --v8-texte-sur-principal en sombre
  await ctx.close();
});

test("sur telephone, le montant ne chevauche pas le panier moyen", async ({ browser }) => {
  const { ctx, page } = await ouvrir(browser, { largeur: 390 });
  const r = await page.evaluate(() => {
    // Un montant REALISTE : le jeu de test n'a que de petites sommes, qui
    // tiennent toujours. Les espaces de « 14 980,50 EUR » sont insecables --
    // c'est ce montant-la qui debordait.
    document.getElementById("opRevenue").textContent = "14 980,50 €";
    document.getElementById("opBasket").textContent = "624,00 €";
    // L'ETENDUE DU TEXTE, pas la boite : la boite du montant se retrecit
    // (min-width: 0) et le texte deborde par-dessus sa voisine. Comparer les
    // boites laissait passer exactement le defaut qu'on cherche.
    const etendue = id => { const r = document.createRange();
      r.selectNodeContents(document.getElementById(id)); return r.getBoundingClientRect(); };
    const a = etendue("opRevenue");
    const b = etendue("opBasket");
    const intersecte = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    return { intersecte };
  });
  expect(r.intersecte).toBe(false);
  await ctx.close();
});

test("le HTML du tableau de bord est bien forme : les imports ne sont pas sous un depliant", async ({ browser }) => {
  const { ctx, page } = await ouvrir(browser);
  const r = await page.evaluate(() => ({
    depliants: document.querySelectorAll("#journee details").length,
    importsSousDepliant: !!document.querySelector("#journee .visual-panel")?.closest("details")
  }));
  expect(r.depliants, "un seul depliant : « Detail du jour »").toBe(1);
  expect(r.importsSousDepliant).toBe(false);
  await ctx.close();
});

test("« À régler » montre les commandes bloquées, dans l'ordre d'urgence de la planche", async ({ browser }) => {
  // Planche 1b (annotation) et 6a : « tri par urgence, pas par type --
  // abonnement en retard, commande bloquee, stock sous le seuil, adresse a
  // corriger ». La commande o-9 du jeu seme demande des gants absents du
  // stock : elle est bloquee, et « A regler » doit le dire.
  const { ctx, page } = await ouvrir(browser);
  const titres = await page.evaluate(() =>
    [...document.querySelectorAll("#opAlerts .tb-anomalie-titre")].map(t => t.textContent.trim()));
  console.log(`[a regler] ${titres.join(" | ")}`);
  expect(titres.some(t => /bloqu/i.test(t)), "une ligne « commande bloquee »").toBe(true);
  const RANG = [/retard/i, /bloqu/i, /reprendre/i, /rupture/i, /seuil/i, /adresse/i];
  const rangs = titres.map(t => RANG.findIndex(r => r.test(t)));
  expect(rangs.every(r => r >= 0), `toute ligne a un rang : ${titres}`).toBe(true);
  expect(rangs, "l'ordre d'urgence de la planche").toEqual([...rangs].sort((x, y) => x - y));
  await ctx.close();
});

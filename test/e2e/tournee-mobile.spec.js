// LA TOURNEE AU TELEPHONE -- planches 4a (preparer), 4b (cockpit), 4c (carte),
// 4d (fin de tournee), posees le 23/09.
//
// Ce que ce banc tient, et que les bancs du 19/09 ne voyaient pas :
//   - « Livre » SANS confirmation : l'ecran avance tout de suite a l'arret
//     suivant, un toast « Livre -- <client> » porte Annuler pendant 4 s, et
//     l'envoi au serveur ne part qu'au terme (le serveur ne sait pas defaire
//     une livraison : `livre` n'a aucune sortie dans la machine d'etat) ;
//   - les gestes SOUS LE POUCE : a 390 x 844, le geste principal tombait sous
//     la barre basse, invisible ;
//   - « Prochain : <client> » ;
//   - « Recalculer le trace » cercle d'accent quand le trace est a refaire ;
//   - la ligne « CMD-... · n articles » de la preparation ;
//   - la fin de tournee : trois chiffres, les problemes nommes, « Y aller ».
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

const MOBILE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

// Le seme par defaut : tournee en cours, arret 3 (EHPAD Les Tilleuls) en
// cours, SANS geometrie routiere -- le trace est a recalculer.
let srv;
// Une tournee dont tous les arrets sont termines : quatre livres, un absent,
// un probleme. Le statut reste « en_livraison » : l'application ne reprend au
// chargement qu'une tournee en cours ou prete (une tournee « terminee » ne se
// rouvre pas apres un rechargement) ; l'ecran de fin se lit sur les arrets.
let fini;
test.beforeAll(async () => {
  srv = await demarrer({ port: 3175 });
  const seed = jeuDeDonnees();
  const r = seed.routes[0];
  r.startedAt = `${AUJOURDHUI}T11:40:00Z`;
  r.completedAt = `${AUJOURDHUI}T15:05:00Z`;
  r.arrival = { label: "Entrepôt, 4 rue de Dole, Besançon", lat: 47.24, lng: 6.02 };
  r.stops[2].status = "livre";
  r.stops[4].status = "absent";
  r.stops[4].problemReason = "Personne sur place";
  r.stops[5].status = "livre";
  fini = await demarrer({ port: 3181, seed });
});
test.afterAll(async () => {
  if (srv) await srv.arreter();
  if (fini) await fini.arreter();
});

async function ouvrir(browser, base, { theme = "light" } = {}) {
  // Les heures de la fin de tournee se lisent a Paris, comme les utilisateurs.
  const ctx = await browser.newContext({ viewport: MOBILE, colorScheme: theme, timezoneId: "Europe/Paris" });
  await ctx.addInitScript(t => { try { localStorage.setItem("sereo:colorScheme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

async function statutsServeur(base) {
  const routes = await (await fetch(base + "/api/routes")).json();
  return routes[0].stops.map(s => s.status);
}

function rgb(chaine) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(chaine || "");
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function hex(chaine) {
  const c = rgb(chaine);
  return c ? "#" + c.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase() : null;
}
function luminance([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contraste(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test("4b — les gestes sont SOUS LE POUCE : au-dessus de la barre basse, a l'ouverture", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const r = await page.evaluate(() => {
    const boite = id => document.getElementById(id).getBoundingClientRect();
    const barre = document.querySelector("nav.mobile-tabbar").getBoundingClientRect();
    return {
      livre: { haut: boite("markDeliveredButton").top, bas: boite("markDeliveredButton").bottom },
      absent: boite("markAbsentButton").bottom,
      appeler: [boite("callClientButton").width, boite("callClientButton").height],
      barre: barre.top, hauteurEcran: window.innerHeight
    };
  });
  expect(erreurs).toEqual([]);
  console.log(`[pouce] Livre ${Math.round(r.livre.haut)}-${Math.round(r.livre.bas)}, absent bas ${Math.round(r.absent)}, barre ${Math.round(r.barre)}`);
  // Visible sans defiler : entre le haut de l'ecran et la barre basse.
  expect(r.livre.haut).toBeGreaterThan(0);
  expect(r.livre.bas, "« Livre » passe sous la barre basse").toBeLessThanOrEqual(r.barre + 1);
  expect(r.absent, "« Client absent » passe sous la barre basse").toBeLessThanOrEqual(r.barre + 1);
  // Appeler : un rond de 56.
  expect(r.appeler.map(Math.round)).toEqual([56, 56]);
  await ctx.close();
});

test("4b — « Prochain : <client> » nomme l'arret suivant non termine", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  // Arret 3 en cours ; l'arret 4 est en probleme (termine) : le prochain est le 5.
  await expect(page.locator("#currentClient .arret-prochain-mot")).toHaveText("Prochain : Pharmacie Centrale de la Gare");
  await expect(page.locator("#currentClient .arret-prochain-lieu")).toHaveText("Champagnole");
  await ctx.close();
});

test("4b — « Y aller » ouvre Google Maps sur l'adresse de l'arret, encodee", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  await page.evaluate(() => { window.__ouvert = []; window.open = url => { window.__ouvert.push(url); return null; }; });
  await expect(page.locator("#mapsButton")).toHaveText("Y aller");
  await page.locator("#mapsButton").click();
  const urls = await page.evaluate(() => window.__ouvert);
  // La ville est celle du serveur, canonisee SANS cedille (une cle de secteur) :
  // Google la resout pareil. Les accents de la rue, eux, sont encodes.
  expect(urls).toEqual(["https://www.google.com/maps/dir/?api=1&destination="
    + encodeURIComponent("12 avenue du Général de Gaulle 25000 Besancon")]);
  await ctx.close();
});

test("4c — sans trace routier, « Recalculer le trace » est cercle d'accent", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  const r = await page.evaluate(() => {
    const b = document.querySelector("#livreur .trn-recalculer-panneau");
    const s = getComputedStyle(b);
    return { requis: b.classList.contains("trn-recalculer--requis"), style: s.outlineStyle, couleur: s.outlineColor,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--v8-accent").trim().toUpperCase() };
  });
  expect(r.requis).toBe(true);
  expect(r.style).toBe("solid");
  expect(hex(r.couleur)).toBe(r.accent);
  await ctx.close();
});

test("4a — la commande prete se lit « CMD-... · n articles », sans l'adresse", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  const r = await page.evaluate(() => [...document.querySelectorAll("#deliveryCandidates .delivery-card")].map(c => ({
    court: c.querySelector(".delivery-card-court")?.checkVisibility() ? c.querySelector(".delivery-card-court").textContent.trim() : null,
    adresse: c.querySelector(".delivery-card-adresse")?.checkVisibility() ?? null,
    h: Math.round(c.getBoundingClientRect().height)
  })));
  console.log(`[preparer] ${JSON.stringify(r)}`);
  expect(r.length).toBeGreaterThan(0);
  for (const c of r) {
    expect(c.court).toMatch(/^CMD-\d{4}-\d{3,} · \d+ articles?$/);
    expect(c.adresse, "l'adresse est dans le detail, pas sur la ligne").toBe(false);
  }
  await ctx.close();
});

test("4b — « Livre » : l'ecran avance, Annuler DEFAIT, rien n'est parti au serveur", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const avant = await statutsServeur(srv.base);
  expect(avant[2]).toBe("en_livraison");

  // Double appui : un seul arret livre.
  await page.locator("#markDeliveredButton").dblclick();
  const toast = page.locator("#toastRegion .toast", { hasText: "Livré — EHPAD Les Tilleuls du Val de Loue" });
  await expect(toast).toBeVisible();
  await expect(toast.locator(".toast-action")).toHaveText("Annuler");
  // Tout de suite a l'arret suivant, sans confirmation.
  await expect(page.locator("#currentClient .arret-nom")).toHaveText("Pharmacie Centrale de la Gare");
  await expect(page.locator("#routeStopsList .route-stop").nth(2).locator(".pill")).toHaveText("Livré");
  await expect(page.locator("#routeStopsList .route-stop").nth(5).locator(".pill")).toHaveText("Prêt");
  // Rien n'est parti pendant le delai d'Annuler.
  expect(await statutsServeur(srv.base)).toEqual(avant);

  await toast.locator(".toast-action").click();
  await expect(page.locator("#currentClient .arret-nom")).toHaveText("EHPAD Les Tilleuls du Val de Loue");
  await expect(page.locator("#routeStopsList .route-stop").nth(2).locator(".pill")).toHaveText("En livraison");
  // Au-dela des 4 s : toujours rien au serveur.
  await page.waitForTimeout(5000);
  expect(await statutsServeur(srv.base)).toEqual(avant);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("4b — « Livre » sans Annuler : l'envoi part au terme des 4 s", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  await page.locator("#markDeliveredButton").click();
  await expect(page.locator("#currentClient .arret-nom")).toHaveText("Pharmacie Centrale de la Gare");
  expect((await statutsServeur(srv.base))[2]).toBe("en_livraison");
  await expect.poll(async () => (await statutsServeur(srv.base))[2], { timeout: 10000 }).toBe("livre");
  // L'arret suivant, lui, n'a pas bouge.
  expect((await statutsServeur(srv.base))[4]).toBe("pret_livraison");
  await expect(page.locator("#currentClient .arret-nom")).toHaveText("Pharmacie Centrale de la Gare");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

for (const theme of ["light", "dark"]) {
  test(`4d — fin de tournee : trois chiffres, les problemes nommes, « Y aller » (${theme})`, async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page, erreurs } = await ouvrir(browser, fini.base, { theme });
    const r = await page.evaluate(() => {
      const fin = document.querySelector("#currentClient .fin-tournee");
      if (!fin) return null;
      const chiffres = [...fin.querySelectorAll(".fin-chiffre")].map(c => {
        const lib = c.querySelector(".fin-chiffre-libelle"), fort = c.querySelector("strong");
        return { libelle: lib.textContent.trim(), valeur: fort.textContent.trim(),
          couleurs: [getComputedStyle(lib).color, getComputedStyle(fort).color], fond: getComputedStyle(c).backgroundColor };
      });
      const problemes = [...fin.querySelectorAll(".fin-problemes li")].map(li => ({
        texte: `${li.querySelector("strong").textContent.trim()} ${li.querySelector("span").textContent.trim()}`, couleur: getComputedStyle(li.querySelector("span")).color, fond: getComputedStyle(li).backgroundColor }));
      const aller = fin.querySelector(".fin-arrivee a");
      const phrase = fin.querySelector(".fin-phrase");
      return {
        titre: fin.querySelector(".fin-titre").textContent.trim(),
        phrase: phrase.textContent.trim(), phraseCouleur: getComputedStyle(phrase).color,
        fondCarte: getComputedStyle(document.querySelector("#tourneeActive .current-driver-card")).backgroundColor,
        chiffres, problemes,
        aller: aller && { texte: aller.textContent.trim(), href: aller.href, h: Math.round(aller.getBoundingClientRect().height) },
        recalculerRequis: document.querySelector("#livreur .trn-recalculer-panneau").classList.contains("trn-recalculer--requis")
      };
    });
    expect(erreurs).toEqual([]);
    expect(r, "l'ecran de fin n'est pas rendu").not.toBeNull();
    console.log(`[fin/${theme}] ${r.phrase} | ${r.chiffres.map(c => `${c.libelle} ${c.valeur}`).join(" · ")} | ${r.problemes.map(p => p.texte).join(" / ")}`);
    expect(r.titre).toBe("Tournée terminée");
    // Les heures viennent de startedAt / completedAt (Paris : UTC+2 en septembre).
    // Le seme n'a pas de secteur : « Tournee du <jour> », sans « du jour du ».
    expect(r.phrase).toMatch(/^Tournée du [a-zé]+ \d{1,2} [a-zéû]+, de 13 h 40 à 17 h 05\.$/);
    expect(r.chiffres.map(c => [c.libelle, c.valeur])).toEqual([["Livrés", "4"], ["Client absent", "1"], ["Problème", "1"]]);
    // Les problemes sont NOMMES : le client et sa raison.
    expect(r.problemes.map(p => p.texte)).toEqual([
      "Clinique Vétérinaire du Doubs Adresse introuvable",
      "Pharmacie Centrale de la Gare Personne sur place"
    ]);
    expect(r.aller.texte).toBe("Y aller");
    expect(r.aller.href).toContain("https://www.google.com/maps/dir/?api=1&destination=");
    expect(r.aller.h).toBeGreaterThanOrEqual(48);
    // Une tournee terminee n'a pas de trace a recalculer : pas de cercle.
    expect(r.recalculerRequis).toBe(false);
    // Contrastes, dans les deux themes.
    expect(contraste(rgb(r.phraseCouleur), rgb(r.fondCarte)), "phrase de fin").toBeGreaterThanOrEqual(4.5);
    for (const c of r.chiffres) {
      for (const couleur of c.couleurs) {
        expect(contraste(rgb(couleur), rgb(c.fond)), `chiffre « ${c.libelle} »`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const p of r.problemes) expect(contraste(rgb(p.couleur), rgb(p.fond)), `probleme « ${p.texte} »`).toBeGreaterThanOrEqual(4.5);
    await ctx.close();
  });
}

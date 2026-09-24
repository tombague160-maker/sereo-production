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
//   - « Recalculer le trace » cercle d'accent quand le trace est a refaire,
//     avant le depart seulement (le serveur refuse ensuite) ;
//   - la ligne « CMD-... · n articles » de la preparation ;
//   - la fin de tournee : trois chiffres, les problemes nommes, « Y aller ».
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

const MOBILE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

// Le seme par defaut : tournee en cours, arret 3 (EHPAD Les Tilleuls) en
// cours, SANS geometrie routiere (partie : le serveur ne la recalcule plus).
let srv;
// Une tournee dont tous les arrets sont termines : quatre livres, un absent,
// un probleme. Le statut reste « en_livraison » : l'application ne reprend au
// chargement qu'une tournee en cours ou prete (une tournee « terminee » ne se
// rouvre pas apres un rechargement) ; l'ecran de fin se lit sur les arrets.
let fini;
const DEMAIN = new Date(Date.parse(`${AUJOURDHUI}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
test.beforeAll(async () => {
  // Revue du 23/09 : trois arrets de plus en fin de tournee (les bancs du
  // reseau lent et du hors ligne en consomment cinq apres les premiers), et
  // une seconde commande prete pour l'EHPAD Bellevue, DEMAIN -- deux lignes du
  // meme client que seul le jour distingue.
  const seme = jeuDeDonnees();
  const copie = (depuis, id, extra) => ({ ...structuredClone(seme.commandes.find(c => c.id === depuis)), id, ...extra });
  const enPlus = [copie("o-8", "o-11", { status: "en_livraison" }), copie("o-2", "o-12", { status: "en_livraison", deliveredAt: undefined }),
    copie("o-3", "o-13", { status: "en_livraison" })];
  seme.commandes.push(...enPlus, copie("o-8", "o-14", { deliveryDate: DEMAIN }));
  const modele = seme.routes[0].stops[5];
  seme.routes[0].stops.push(...enPlus.map(o => ({ ...structuredClone(modele), id: `s-${o.id}`, orderId: o.id, clientId: o.clientId,
    clientName: o.clientName, address: o.address, city: o.city, postalCode: o.postalCode, lat: o.lat, lng: o.lng })));
  srv = await demarrer({ port: 3175, seed: seme });
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

async function ouvrir(browser, base, { theme = "light", avant = null } = {}) {
  // Les heures de la fin de tournee se lisent a Paris, comme les utilisateurs.
  const ctx = await browser.newContext({ viewport: MOBILE, colorScheme: theme, timezoneId: "Europe/Paris" });
  await ctx.addInitScript(t => { try { localStorage.setItem("sereo:colorScheme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  if (avant) await avant(page);
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

async function statutsServeur(base) {
  return (await arretsServeur(base)).map(s => s.status);
}

async function arretsServeur(base) {
  const routes = await (await fetch(base + "/api/routes")).json();
  return routes[0].stops;
}

const TERMINAUX = ["livre", "absent", "probleme", "a_reprogrammer"];

/** Les trois prochains arrets a traiter, lus au serveur : [indice, nom]. */
async function troisProchains(base) {
  const restants = (await arretsServeur(base)).map((s, i) => [i, s.clientName, s.status]).filter(([, , st]) => !TERMINAUX.includes(st));
  expect(restants.length, "prealable : trois arrets restent a livrer").toBeGreaterThanOrEqual(3);
  return restants.slice(0, 3);
}

/** Lit la file d'ecritures hors ligne dans le vrai indexedDB de la page. */
function lireFile(page) {
  return page.evaluate(() => new Promise(resolve => {
    const d = indexedDB.open("sereo-file-attente", 1);
    d.onerror = () => resolve([]);
    d.onsuccess = () => {
      const db = d.result;
      if (!db.objectStoreNames.contains("ecritures")) { db.close(); resolve([]); return; }
      const r = db.transaction("ecritures", "readonly").objectStore("ecritures").getAll();
      r.onsuccess = () => { const v = r.result; db.close(); resolve(v); };
      r.onerror = () => { db.close(); resolve([]); };
    };
  }));
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
  // « Client absent » : hors de la barre collee depuis le 24/09 (elle cachait
  // les articles a decharger ; telephone-utilisable.spec.js) -- a un
  // defilement, et alors au-dessus de la barre basse.
  // (scrollIntoViewIfNeeded ne defile pas : sous la barre basse, le bouton
  // est encore « dans » la fenetre.)
  const absent = await page.evaluate(() => {
    const b = document.getElementById("markAbsentButton");
    b.scrollIntoView({ block: "center" });
    return b.getBoundingClientRect().bottom;
  });
  expect(absent, "« Client absent » passe sous la barre basse").toBeLessThanOrEqual(r.barre + 1);
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

// Lot 6 de l'audit geo (23/09) : RENVERSE, pas supprime. « Y aller » visait
// l'adresse en texte ; il vise desormais les COORDONNEES de l'arret quand elles
// existent (une position corrigee a la main, un lieu-dit sans rue y menent).
// Le repli sur l'adresse en texte est juge dans test/tournee-pratique.test.js.
test("4b — « Y aller » ouvre Google Maps sur les coordonnees de l'arret", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  await page.evaluate(() => { window.__ouvert = []; window.open = url => { window.__ouvert.push(url); return null; }; });
  await expect(page.locator("#mapsButton")).toHaveText("Y aller");
  await page.locator("#mapsButton").click();
  const urls = await page.evaluate(() => window.__ouvert);
  // L'arret 3 (EHPAD Les Tilleuls) est seme a 47.238, 6.024.
  expect(urls).toEqual(["https://www.google.com/maps/dir/?api=1&destination=47.238,6.024"]);
  await ctx.close();
});

function lireRecalculer(page) {
  return page.evaluate(() => {
    const b = document.querySelector("#livreur .trn-recalculer-panneau");
    const s = getComputedStyle(b);
    return { requis: b.classList.contains("trn-recalculer--requis"), style: s.outlineStyle, couleur: s.outlineColor,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--v8-accent").trim().toUpperCase() };
  });
}

test("4c — sans trace routier AVANT le depart, « Recalculer le trace » est cercle d'accent", async ({ browser }) => {
  test.setTimeout(120000);
  // Le seme est partie sans geometrie ; on le lit ici « prete » (pas encore
  // partie), le seul etat ou le serveur accepte de recalculer.
  const { ctx, page } = await ouvrir(browser, srv.base, { avant: p => p.route("**/api/routes", async route => {
    const reponse = await route.fetch();
    const routes = await reponse.json();
    routes[0].status = "prete";
    delete routes[0].geometry;
    await route.fulfill({ response: reponse, json: routes });
  }) });
  const r = await lireRecalculer(page);
  expect(r.requis).toBe(true);
  expect(r.style).toBe("solid");
  expect(hex(r.couleur)).toBe(r.accent);
  await ctx.close();
});

test("4c — tournee PARTIE sans trace : pas de cercle, le serveur refuserait le recalcul", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  // Prealable : la tournee semee est partie et n'a pas de trace.
  const routes = await (await fetch(srv.base + "/api/routes")).json();
  expect(routes[0].status).toBe("en_livraison");
  expect(routes[0].geometry?.coordinates).toBeFalsy();
  // Ce que le cercle promettrait : POST /recalculate rend 400.
  const essai = await fetch(`${srv.base}/api/routes/${routes[0].id}/recalculate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  expect(essai.status).toBe(400);
  const r = await lireRecalculer(page);
  expect(r.requis, "« Recalculer » cercle sur une tournee que le serveur refuse de recalculer").toBe(false);
  expect(r.style).not.toBe("solid");
  await ctx.close();
});

test("4a — la commande prete se lit « CMD-... · n articles », puis son jour et son secteur", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrir(browser, srv.base);
  // Lot 2 de l'audit geo (23/09) : la liste s'ouvre sur le JOUR. Les deux
  // jours du meme client se comparent filtre de date retire (toutes dates) --
  // ce que le livreur fait pour preparer demain.
  await page.evaluate(() => {
    const champ = document.getElementById("deliveryDate");
    champ.value = "";
    champ.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const r = await page.evaluate(() => [...document.querySelectorAll("#deliveryCandidates .delivery-card")].map(c => {
    const vu = sel => (c.querySelector(sel)?.checkVisibility() ? c.querySelector(sel).textContent.trim() : null);
    return {
      client: vu(".delivery-card-title"), court: vu(".delivery-card-court"), contexte: vu(".delivery-card-contexte"),
      adresse: c.querySelector(".delivery-card-adresse")?.checkVisibility() ?? null,
      h: Math.round(c.getBoundingClientRect().height)
    };
  }));
  console.log(`[preparer] ${JSON.stringify(r)}`);
  expect(r.length).toBeGreaterThan(0);
  for (const c of r) {
    expect(c.court).toMatch(/^CMD-\d{4}-\d{3,} · \d+ articles?$/);
    // La carte n'a pas de detail : l'adresse quitte la ligne (la planche),
    // mais le jour et le secteur y restent -- sans filtre de date, la liste
    // melange les dates et les secteurs.
    expect(c.adresse, "l'adresse quitte la ligne au telephone").toBe(false);
    // « jeu. 24 sept. · Dole » : la date d'une livraison s'ecrit comme
    // partout (utils/dates.js, parcours simplifies du 24/09), plus « jeu. 24/09 ».
    expect(c.contexte, "le jour et le secteur de la commande ont disparu de la ligne").toMatch(/^[a-zé]+\.? \d{1,2} [a-zéû]+\.? · .+/);
  }
  // Deux commandes pretes du meme client, aujourd'hui et demain : la ligne
  // doit dire laquelle est laquelle.
  const bellevue = r.filter(c => c.client === "EHPAD Résidence Bellevue");
  expect(bellevue).toHaveLength(2);
  expect(bellevue[0].contexte, "deux commandes du meme client se lisent pareil").not.toBe(bellevue[1].contexte);
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

// Revue du 23/09. Reseau lent : le PATCH met 2,5 s. Le livreur livre A (l'ecran
// montre B), appuie « Livre » pour B -- l'envoi de A part, l'ecran ne bouge pas
// encore --, puis, impatient, rappuie 900 ms plus tard. Avant le correctif, ce
// second appui livrait B, puis le premier reprenait et livrait C, que le livreur
// n'avait jamais vu ; la livraison de B etait ecrasee sans partir.
test("4b — reseau lent : un appui impatient ne livre jamais l'arret suivant, jamais vu", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const [[a, nomA], [b, nomB], [c, , statutC]] = await troisProchains(srv.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomA);
  await page.route("**/api/routes/*/stops/*", async route => {
    if (route.request().method() === "PATCH") await new Promise(r => setTimeout(r, 2500));
    await route.continue();
  });
  const livre = page.locator("#markDeliveredButton");
  await livre.click();
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomB);
  await page.waitForTimeout(1000);
  await livre.click();                                   // pour B : l'envoi de A part
  await page.waitForTimeout(900);
  const pendantLEnvoi = await livre.isDisabled();
  await livre.click({ force: true });                    // l'appui impatient
  // Tout est parti : A (2,5 s), puis B au terme de son toast (4 s + 2,5 s).
  await page.waitForTimeout(13000);
  const apres = await statutsServeur(srv.base);
  expect([apres[a], apres[b], apres[c]], "ce qui est livre au serveur : A, B, et C intact").toEqual(["livre", "livre", statutC]);
  expect(pendantLEnvoi, "« Livre » reste actif pendant l'envoi : rien ne dit que l'appui est pris").toBe(true);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Revue du 23/09. Hors ligne, un geste fait dans les 4 s d'un « Livre » : avant
// le correctif, la mise en file de la livraison en suspens arretait le geste
// suivant, sous le message « enregistre ». Ici : Livre A (en ligne), coupure,
// Livre B, puis Client absent sur C -- les trois doivent etre en file, et
// partir au retour du reseau.
test("4b — hors ligne : les gestes qui suivent un « Livre » sont en file, pas perdus", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const [[a, nomA, statutA], [b, nomB], [c]] = await troisProchains(srv.base);
  expect(await lireFile(page), "prealable : la file devait etre vide").toEqual([]);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomA);
  await page.locator("#markDeliveredButton").click();
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomB);
  await ctx.setOffline(true);
  await page.waitForTimeout(800);
  await page.locator("#markDeliveredButton").click();
  await page.waitForTimeout(800);
  await page.locator("#markAbsentButton").click();
  await page.waitForTimeout(800);
  // Si les motifs etaient deja en memoire, le dialogue s'ouvre : on en choisit un.
  if (await page.locator("#motifProblemeDialog[open]").count()) {
    await page.locator("#motifListe .motif-choix").first().click();
    await page.locator('[data-action="motif-valider"]').click();
  }
  // Le terme du toast de B est passe (ou B est deja parti) : tout est en file.
  await page.waitForTimeout(4500);
  const arrets = await arretsServeur(srv.base);
  const file = (await lireFile(page)).map(e => {
    const arret = arrets.findIndex(s => e.url.endsWith(`/stops/${encodeURIComponent(s.id)}`));
    return [arret, JSON.parse(e.corps).status];
  });
  expect(file, `en file (A = ${a}, B = ${b}, C = ${c})`).toEqual([[a, "livre"], [b, "livre"], [c, "absent"]]);
  // Rien n'est parti pendant la coupure.
  expect(arrets[a].status).toBe(statutA);
  // Retour du reseau : les trois partent.
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => { const s = await statutsServeur(srv.base); return [s[a], s[b], s[c]]; }, { timeout: 15000 })
    .toEqual(["livre", "livre", "absent"]);
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
        recalculerRequis: document.querySelector("#livreur .trn-recalculer-panneau").classList.contains("trn-recalculer--requis"),
        // Les gestes d'arret, tous inertes ici, ne doivent plus coller au bas de l'ecran.
        gestesVisibles: document.querySelector("#livreur .current-driver-card .gestes").checkVisibility(),
        retourVisible: [...fin.querySelectorAll(".quick-actions .button")].map(b => b.checkVisibility())
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
    // Plus d'arret : Livre, Client absent, Probleme, Appeler, Y aller (tous
    // desactives) ne collent plus ~200 px au-dessus de la barre basse. Les
    // gestes de la fin (Retour accueil, Voir a recommander) restent.
    expect(r.gestesVisibles, "les gestes d'arret inertes restent colles sur l'ecran de fin").toBe(false);
    expect(r.retourVisible).toEqual([true, true]);
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

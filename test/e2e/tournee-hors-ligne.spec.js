// L'ECRAN TOURNEE SE ROUVRE SANS RESEAU -- decision 4 de Thomas (23/09),
// M10 de l'audit geo, arbitrage ouvert depuis le 18/09 dans DESIGN.md.
//
// LE DEFAUT, mesure sur v1.42.0 : la navigation passait au reseau sans aucun
// repli (service-worker.js, naviguer). Un livreur qui fermait l'application
// en zone blanche, ou dont le telephone redemarrait, tombait sur la page
// d'erreur du navigateur (ERR_INTERNET_DISCONNECTED) : plus de tournee avant
// le retour du reseau.
//
// CE QUE CE BANC FAIT POUR DE VRAI : un serveur AUTHENTIFIE (on se connecte
// par le formulaire, cookie de session), un service worker enregistre, une
// coupure par le navigateur (setOffline / option `offline`), et un navigateur
// FERME puis relance sur le meme profil (launchPersistentContext) : le
// « telephone redemarre ». Rien n'est simule dans la page.
//
// LA COUPURE EST DOUBLE, ET C'EST MESURE. Playwright 1.61 + Chromium, profil
// relance hors ligne : la navigation que le service worker demande echoue
// (ERR_INTERNET_DISCONNECTED), mais ses requetes d'API suivantes PASSENT --
// l'emulation hors ligne atteint le service worker apres ses premieres
// requetes (vu le 23/09 : « requestfinished » serviceWorker=true sur les 16
// endpoints, puis une pastille « À jour » hors ligne). Un telephone hors ligne
// n'a pas cette fuite. On coupe donc AUSSI le chemin : un mandataire local,
// entre le navigateur et le serveur seme, ferme toute connexion pendant la
// coupure. navigator.onLine, lui, vient de setOffline.
//
// ET CE QU'IL DOIT REFUSER : sans session valide connue -- deconnexion, ou
// session perdue que le serveur a signalee par sa page de connexion -- rien ne
// se rouvre. Chacun de ces cas porte son temoin positif (la meme ouverture,
// AVANT le geste qui ferme la session, rend bien la tournee).
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, expect, servirTuilesLocales } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const MOBILE = { width: 390, height: 844 };
// Un identifiant jetable, local, qui n'ouvre rien : la base du serveur seme
// est un dossier temporaire detruit avec lui.
const IDENTIFIANT = "banc";
const MOT_DE_PASSE = "banc-e2e-hors-ligne-sans-valeur";
const BASIC = "Basic " + Buffer.from(`${IDENTIFIANT}:${MOT_DE_PASSE}`).toString("base64");
const TERMINAUX = ["livre", "absent", "probleme", "a_reprogrammer"];

/**
 * Un mandataire qui peut COUPER (toute connexion fermee sans reponse), ou
 * faire la PASSERELLE EN ERREUR (502 : serveur arrete derriere le mandataire,
 * pendant que sereo-updater reconstruit l'image) -- le telephone, lui, reste
 * en ligne.
 */
async function mandataire(cible) {
  const etat = { coupe: false, passerelle: false };
  const server = http.createServer((req, res) => {
    if (etat.coupe) { req.socket.destroy(); return; }
    if (etat.passerelle) { res.writeHead(502, { "Content-Type": "text/plain" }); res.end("Bad Gateway"); return; }
    const amont = http.request(cible + req.url, { method: req.method, headers: req.headers }, r => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    amont.on("error", () => res.destroy());
    req.pipe(amont);
  });
  server.listen(0, "127.0.0.1");
  await require("node:events").once(server, "listening");
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    etat,
    async arreter() {
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  };
}

let srv, mdt;
test.beforeAll(async () => {
  // Sur UNE ligne : test/ports-e2e.test.js ne voit le port que la.
  srv = await demarrer({ port: 3334, seed: jeuDeDonnees(), env: { SEREO_AUTH_USER: IDENTIFIANT, SEREO_AUTH_PASSWORD: MOT_DE_PASSE } });
  mdt = await mandataire(srv.base);
});
test.afterAll(async () => {
  if (mdt) await mdt.arreter();
  if (srv) await srv.arreter();
});
test.afterEach(() => { if (mdt) { mdt.etat.coupe = false; mdt.etat.passerelle = false; } });

async function couper(ctx) {
  mdt.etat.coupe = true;
  await ctx.setOffline(true);
}

async function retablir(ctx) {
  mdt.etat.coupe = false;
  await ctx.setOffline(false);
}

/** Le serveur, lu directement (sans le mandataire), par l'acces Basic. */
async function arretsServeur() {
  const r = await fetch(srv.base + "/api/routes", { headers: { Authorization: BASIC } });
  expect(r.status, "prealable : le banc lit le serveur avec l'acces Basic").toBe(200);
  return (await r.json())[0].stops;
}

async function seConnecter(page) {
  await page.goto(mdt.base + "/login?next=" + encodeURIComponent("/#livreur"));
  await page.fill("#username", IDENTIFIANT);
  await page.fill("#password", MOT_DE_PASSE);
  await Promise.all([
    page.waitForURL(u => !new URL(u).pathname.startsWith("/login")),
    page.locator('form[action="/login"] button[type="submit"]').click()
  ]);
}

/** Ce que le cache de donnees du service worker contient (chemins). */
function contenuDuCache(page) {
  return page.evaluate(async () => {
    const noms = (await caches.keys()).filter(n => n.startsWith("sereo-api-"));
    const chemins = [];
    for (const nom of noms) {
      for (const requete of await (await caches.open(nom)).keys()) chemins.push(new URL(requete.url).pathname);
    }
    return chemins;
  });
}

/**
 * Connecte, laisse le service worker prendre la page, puis recharge EN LIGNE :
 * c'est cette navigation-la qui passe par lui (page gardee, donnees en cache).
 * (Un `goto` vers la meme adresse, a l'ancre pres, ne rechargerait rien.)
 */
async function preparerEnLigne(page) {
  await seConnecter(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(async () => {
    const c = await contenuDuCache(page);
    return c.includes("/api/routes") && c.includes("/api/orders");
  }, { timeout: 15000, message: "prealable : les donnees de la tournee ne sont pas en cache" }).toBe(true);
  await expect(page.locator("#routeStopsList .route-stop").first()).toBeVisible();
}

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

const ligne = (page, i) => page.locator("#routeStopsList .route-stop").nth(i);

/** Ouvre une URL, et rend l'erreur de navigation au lieu de la lever. */
async function allerA(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return null;
  } catch (e) {
    return String(e.message || e).split("\n")[0];
  }
}

/**
 * Une VRAIE navigation hors ligne, dans un onglet neuf : `goto` vers l'adresse
 * deja ouverte, a l'ancre pres, ne recharge rien (navigation dans le document).
 */
async function ouvrirHorsLigne(ctx, url) {
  const page = await ctx.newPage();
  const echec = await allerA(page, url);
  const copie = echec ? false : await page.evaluate(() => document.documentElement.hasAttribute("data-ouverte-hors-ligne"));
  return { page, echec, copie };
}

test("fermee puis rouverte HORS LIGNE, telephone redemarre : la tournee revient, geste en file compris ; le reste demande le reseau ; tout repart au retour", async ({ browser }) => {
  test.setTimeout(180000);
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-profil-"));
  const lancer = async options => {
    const ctx = await browser.browserType().launchPersistentContext(profil, { viewport: MOBILE, timezoneId: "Europe/Paris", ...options });
    await servirTuilesLocales(ctx);
    return ctx;
  };
  let ctx = await lancer({});
  try {
    let page = ctx.pages()[0] || await ctx.newPage();
    await preparerEnLigne(page);

    // Le premier arret a livrer, lu au serveur.
    const arrets = await arretsServeur();
    const a = arrets.findIndex(s => !TERMINAUX.includes(s.status));
    const nomA = arrets[a].clientName;
    await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomA);

    // Hors ligne, « Livre » : le geste attend dans la file.
    await couper(ctx);
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    await page.locator("#markDeliveredButton").click();
    await expect.poll(async () => (await lireFile(page)).length, { timeout: 15000, message: "prealable : le « Livre » n'est pas en file" }).toBe(1);

    // Le telephone s'eteint (navigateur ferme), puis redemarre SANS reseau.
    await ctx.close();
    ctx = await lancer({ offline: true });
    page = ctx.pages()[0] || await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", e => erreurs.push(e.message));

    const echec = await allerA(page, mdt.base + "/#livreur");
    expect(echec, "hors ligne, l'ecran Tournee ne se rouvre pas").toBeNull();
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-ouverte-hors-ligne")),
      "la page ne vient pas de la copie du service worker").toBe(true);
    await expect(page.locator("#livreur")).toBeVisible();
    await expect(ligne(page, a).locator(".pill"), "la copie a ecrase le geste en attente").toHaveText("Livré");
    await expect(ligne(page, a).locator(".route-stop-attente")).toHaveText("En attente d’envoi");
    await expect(page.locator("#currentClient .arret-nom"), "l'ecran propose de relivrer un arret deja livre").not.toHaveText(nomA);
    await expect(page.locator("#bandeauHorsLigne")).toBeVisible();
    await expect(page.locator("#bandeauHorsLigneTitre")).toHaveText(/^Hors ligne — données de \d{2}:\d{2}$/);
    await expect(page.locator("#bandeauHorsLigneDetail")).toContainText(`1 livraison en attente d'envoi : ${nomA}.`);
    await expect(page.locator("#syncStatus"), "une copie est annoncee fraiche").not.toContainText("À jour");

    // Un autre ecran, dans la page rouverte : il demande le reseau, et ne
    // montre pas ses donnees de secours.
    await page.evaluate(() => { location.hash = "#stock"; });
    await expect(page.locator("#ecranDemandeReseau")).toBeVisible();
    await expect(page.locator("#ecranDemandeReseau")).toContainText("Cet écran demande le réseau");
    await expect(page.locator("#stock")).toBeHidden();
    await page.locator('#ecranDemandeReseau a[href="#livreur"]').click();
    await expect(page.locator("#ecranDemandeReseau")).toBeHidden();
    await expect(page.locator("#livreur")).toBeVisible();

    // Un autre ecran, ouvert DIRECTEMENT hors ligne : pas l'application, une
    // page qui le dit, et qui mene a la tournee.
    const autre = await ctx.newPage();
    const echecAutre = await allerA(autre, mdt.base + "/#stock");
    expect(echecAutre, "hors ligne, un autre ecran rend la page d'erreur du navigateur").toBeNull();
    await expect(autre.locator("h1")).toHaveText("Hors ligne — cet écran demande le réseau");
    await expect(autre.locator("#stock")).toHaveCount(0);
    await autre.getByRole("link", { name: "Ouvrir la tournée" }).click();
    await expect(autre.locator("#routeStopsList .route-stop").first()).toBeVisible();
    await autre.close();

    // Le reseau revient : la file part, tout se relit, l'application redevient
    // entiere. L'arret livre ne redevient JAMAIS « a livrer » entre-temps.
    await page.evaluate(i => {
      window.__pastilles = [];
      const lire = () => {
        const pill = document.querySelectorAll("#routeStopsList .route-stop")[i]?.querySelector(".pill");
        if (pill) window.__pastilles.push(pill.textContent);
      };
      new MutationObserver(lire).observe(document.getElementById("routeStopsList"), { childList: true, subtree: true, characterData: true });
    }, a);
    await retablir(ctx);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await arretsServeur())[a].status, { timeout: 40000, message: "la livraison en file n'est jamais partie" }).toBe("livre");
    await expect.poll(async () => (await lireFile(page)).length, { timeout: 10000 }).toBe(0);
    await expect(page.locator("#bandeauHorsLigne")).toBeHidden({ timeout: 15000 });
    await expect(page.locator("#syncStatus")).toHaveText("À jour", { timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-ouverte-hors-ligne"))).toBe(false);
    await page.evaluate(() => { location.hash = "#stock"; });
    await expect(page.locator("#stock")).toBeVisible();
    await expect(page.locator("#ecranDemandeReseau")).toBeHidden();
    const pastilles = await page.evaluate(() => window.__pastilles);
    expect(pastilles.filter(p => p !== "Livré"), "au retour du reseau, l'arret livre a ete montre « a livrer »").toEqual([]);
    expect(erreurs).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    fs.rmSync(profil, { recursive: true, force: true });
  }
});

test("apres la DECONNEXION, rien ne se rouvre hors ligne (temoin : la meme ouverture, avant, rend la tournee)", async ({ browser }) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: MOBILE, timezoneId: "Europe/Paris" });
  try {
    const page = await ctx.newPage();
    await preparerEnLigne(page);

    // Temoin : session valide, hors ligne, la tournee se rouvre -- depuis la copie.
    await couper(ctx);
    const temoin = await ouvrirHorsLigne(ctx, mdt.base + "/#livreur");
    expect(temoin.echec, "temoin : la tournee ne se rouvre pas").toBeNull();
    expect(temoin.copie, "temoin : la page ne vient pas de la copie du service worker").toBe(true);
    await expect(temoin.page.locator("#routeStopsList .route-stop").first()).toBeVisible();
    await expect(temoin.page.locator("#bandeauHorsLigneTitre")).toHaveText(/^Hors ligne — données de \d{2}:\d{2}$/);
    // Le reseau revient, file VIDE : rien ne part, mais tout doit se relire
    // (le premier cas, lui, a un geste en file, dont le renvoi recharge deja).
    await retablir(ctx);
    await temoin.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(temoin.page.locator("#syncStatus"), "au retour du reseau, la copie reste a l'ecran").toHaveText("À jour", { timeout: 15000 });
    expect(await temoin.page.evaluate(() => document.documentElement.hasAttribute("data-ouverte-hors-ligne"))).toBe(false);
    await temoin.page.close();

    // Deconnexion (le vrai formulaire), puis hors ligne.
    await Promise.all([
      page.waitForURL(u => new URL(u).pathname.startsWith("/login")),
      page.evaluate(() => document.getElementById("formDeconnexion").requestSubmit())
    ]);
    await couper(ctx);
    const apres = await ouvrirHorsLigne(ctx, mdt.base + "/#livreur");
    expect(apres.echec).toBeNull();
    expect(apres.copie, "deconnecte, la page de l'application a ete servie hors ligne").toBe(false);
    await expect(apres.page.locator("#routeStopsList"), "deconnecte, la tournee s'est rouverte hors ligne").toHaveCount(0);
    await expect(apres.page.locator("body")).toContainText("Séréo demande le réseau pour s’ouvrir.");
    await expect(apres.page.getByRole("link", { name: "Ouvrir la tournée" })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test("session PERDUE (le serveur rend sa page de connexion) : la copie et ses donnees sont oubliees (temoin : avant, elles sont la)", async ({ browser }) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: MOBILE, timezoneId: "Europe/Paris" });
  try {
    const page = await ctx.newPage();
    await preparerEnLigne(page);
    expect(await contenuDuCache(page), "temoin : la page de la tournee n'est pas gardee").toContain("/__sereo/page-tournee");

    // Le cookie disparait (session expiree, secret change...) : la navigation
    // suivante recoit la page de connexion.
    await ctx.clearCookies();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('form[action="/login"]'), "prealable : le serveur rend la page de connexion").toBeVisible();
    await expect.poll(async () => contenuDuCache(page), { timeout: 10000, message: "la session est finie, mais ses donnees restent en cache" }).toEqual([]);

    await couper(ctx);
    const apres = await ouvrirHorsLigne(ctx, mdt.base + "/#livreur");
    expect(apres.echec).toBeNull();
    expect(apres.copie, "session perdue, la page de l'application a ete servie hors ligne").toBe(false);
    await expect(apres.page.locator("#routeStopsList"), "session perdue, la tournee s'est rouverte hors ligne").toHaveCount(0);
    await expect(apres.page.locator("body")).toContainText("Séréo demande le réseau pour s’ouvrir.");
  } finally {
    await ctx.close();
  }
});

// Relecture adverse (23/09) : rouverte par une passerelle en erreur (ou par le
// delai de 5 s), la page n'avait qu'un declencheur de retour, l'evenement
// « online ». Un telephone qui ne s'est jamais cru hors ligne ne l'emet pas :
// la page restait « Hors ligne », figee, les autres ecrans bloques.
test("rouverte par une PASSERELLE en erreur (502), telephone qui se croit en ligne : au retour du serveur, tout repart SANS evenement « online »", async ({ browser }) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: MOBILE, timezoneId: "Europe/Paris" });
  try {
    const page = await ctx.newPage();
    await preparerEnLigne(page);

    // Le serveur s'arrete derriere le mandataire ; le telephone reste en ligne.
    mdt.etat.passerelle = true;
    const rouverte = await ouvrirHorsLigne(ctx, mdt.base + "/#livreur");
    expect(rouverte.echec).toBeNull();
    expect(rouverte.copie, "prealable : la page ne vient pas de la copie du service worker").toBe(true);
    expect(await rouverte.page.evaluate(() => navigator.onLine), "prealable : le telephone se croit en ligne").toBe(true);
    await expect(rouverte.page.locator("#routeStopsList .route-stop").first()).toBeVisible();
    await expect(rouverte.page.locator("#bandeauHorsLigneTitre")).toHaveText(/^Hors ligne — données de \d{2}:\d{2}$/);

    // Le serveur revient. Aucun « online » : personne ne l'emettra.
    mdt.etat.passerelle = false;
    await expect(rouverte.page.locator("#syncStatus"), "le serveur est revenu, mais la page rouverte reste sur sa copie")
      .toHaveText("À jour", { timeout: 45000 });
    expect(await rouverte.page.evaluate(() => document.documentElement.hasAttribute("data-ouverte-hors-ligne"))).toBe(false);
    await expect(rouverte.page.locator("#bandeauHorsLigne")).toBeHidden();
    await rouverte.page.evaluate(() => { location.hash = "#stock"; });
    await expect(rouverte.page.locator("#stock")).toBeVisible();
    await expect(rouverte.page.locator("#ecranDemandeReseau")).toBeHidden();
  } finally {
    await ctx.close();
  }
});

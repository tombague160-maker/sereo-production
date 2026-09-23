// LE LIVREUR NE PERD PLUS RIEN -- lot 1 de l'audit « localisation, carte,
// tournees » (23/09), la part ECRAN, dans un vrai navigateur.
//
// Les defauts mesures par l'audit (commit 019788c), un par cas :
//   H1  Reseau present mais muet (4G sans debit) : le telephone se croit en
//       ligne, la file n'etait utilisee que si navigator.onLine === false. Le
//       « Livre » etait perdu derriere le livreur, sous un toast anglais
//       « Failed to fetch ».
//   H3  Hors ligne, « Client absent » ne faisait pas avancer l'ecran : le
//       « Livre » suivant partait sur le meme client.
//   H2  Au renvoi, une session expiree (401) faisait SUPPRIMER la file.
//   M6  La livraison etait datee de son arrivee au serveur.
//   H4  Apres un geste, le rechargement lent (> 3 s) rendait la copie d'avant
//       le geste : l'arret livre redevenait « En livraison ». Et la reponse
//       fraiche arrivee apres le repli etait jetee.
//
// L'INSTRUMENT DE H4. Comme chargement-instantane.spec.js : un mandataire HTTP
// local entre le navigateur et le serveur seme, qui sait RETENIR ou RETARDER
// les requetes. `page.route` ne voit pas les requetes que le service worker
// emet lui-meme ; le mandataire voit tout ce qui sort du navigateur.
const http = require("node:http");
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

const MOBILE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

/** Le seme, avec trois arrets de plus a livrer (les cas en consomment un chacun). */
function semeAvecArrets() {
  const seme = jeuDeDonnees();
  const copie = (depuis, id, extra) => ({ ...structuredClone(seme.commandes.find(c => c.id === depuis)), id, ...extra });
  const enPlus = [copie("o-8", "o-11", { status: "en_livraison" }), copie("o-2", "o-12", { status: "en_livraison", deliveredAt: undefined }),
    copie("o-3", "o-13", { status: "en_livraison" }),
    // Pour les cas de la relecture adverse (23/09), un arret chacun.
    copie("o-5", "o-16", { status: "en_livraison" }), copie("o-6", "o-17", { status: "en_livraison" }),
    copie("o-3", "o-18", { status: "en_livraison" })];
  seme.commandes.push(...enPlus);
  // Une commande BLOQUEE avant le 23/09 : un absent d'il y a trois semaines,
  // reste en probleme_livraison, que rien ne proposait plus.
  seme.commandes.push(copie("o-9", "o-15", { status: "probleme_livraison", deliveryStatus: "absent", deliveryDate: "2026-09-01",
    products: structuredClone(seme.commandes.find(c => c.id === "o-8").products) }));
  const modele = seme.routes[0].stops[5];
  seme.routes[0].stops.push(...enPlus.map(o => ({ ...structuredClone(modele), id: `s-${o.id}`, orderId: o.id, clientId: o.clientId,
    clientName: o.clientName, address: o.address, city: o.city, postalCode: o.postalCode, lat: o.lat, lng: o.lng })));
  return seme;
}

/** Un mandataire qui peut retenir ou retarder les requetes d'API. */
async function mandataire(cible) {
  const etat = { retenir: null, attente: [], delaiApi: 0 };
  const server = http.createServer((req, res) => {
    const passer = () => {
      const amont = http.request(cible + req.url, { method: req.method, headers: req.headers }, r => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      amont.on("error", () => res.destroy());
      req.pipe(amont);
    };
    if (etat.retenir && etat.retenir.test(req.url)) etat.attente.push(passer);
    else if (etat.delaiApi && req.url.startsWith("/api/")) setTimeout(passer, etat.delaiApi);
    else passer();
  });
  server.listen(0, "127.0.0.1");
  await require("node:events").once(server, "listening");
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    etat,
    retenir(motif) { etat.retenir = motif; },
    liberer() { etat.retenir = null; for (const f of etat.attente.splice(0)) f(); },
    retenues() { return etat.attente.length; },
    async arreter() {
      this.liberer();
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  };
}

let srv, srvH4, mdt;
test.beforeAll(async () => {
  srv = await demarrer({ port: 3188, seed: semeAvecArrets() });
  srvH4 = await demarrer({ port: 3189, seed: semeAvecArrets() });
  mdt = await mandataire(srvH4.base);
});
test.afterAll(async () => {
  if (mdt) await mdt.arreter();
  if (srv) await srv.arreter();
  if (srvH4) await srvH4.arreter();
});
test.afterEach(() => {
  if (mdt) { mdt.liberer(); mdt.etat.delaiApi = 0; }
});

async function ouvrir(browser, base) {
  const ctx = await browser.newContext({ viewport: MOBILE, timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  // Tous les toasts, meme ceux qui disparaissent entre deux lectures.
  await page.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent);
    }))).observe(document, { childList: true, subtree: true });
  });
  await page.goto(base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

async function arretsServeur(base) {
  const routes = await (await fetch(base + "/api/routes")).json();
  return routes[0].stops;
}

const TERMINAUX = ["livre", "absent", "probleme", "a_reprogrammer"];

/** Les deux prochains arrets a traiter, lus au serveur : [indice, nom]. */
async function prochains(base) {
  const restants = (await arretsServeur(base)).map((s, i) => [i, s.clientName, s.status]).filter(([, , st]) => !TERMINAUX.includes(st));
  expect(restants.length, "prealable : deux arrets restent a livrer").toBeGreaterThanOrEqual(2);
  return restants;
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

async function choisirMotifSiDemande(page) {
  if (await page.locator("#motifProblemeDialog[open]").count()) {
    await page.locator("#motifListe .motif-choix").first().click();
    await page.locator('[data-action="motif-valider"]').click();
  }
}

test("H1 — reseau muet, telephone « en ligne » : le « Livre » attend en file, NOMME, sans message anglais", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const [[a, nomA]] = await prochains(srv.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomA);

  // Le serveur ne repond plus aux gestes ; le navigateur se croit en ligne.
  await page.route("**/api/routes/*/stops/*", route =>
    route.request().method() === "PATCH" ? route.abort("connectionrefused") : route.continue());
  expect(await page.evaluate(() => navigator.onLine), "prealable : le navigateur doit se croire EN LIGNE").toBe(true);

  await page.locator("#markDeliveredButton").click();
  // Le toast d'Annuler (4 s), puis l'envoi, qui echoue.
  await expect.poll(async () => (await lireFile(page)).length, { timeout: 15000, message: "le « Livre » n'a pas ete mis en file : il est perdu" }).toBe(1);

  const [entree] = await lireFile(page);
  expect(JSON.parse(entree.corps).status).toBe("livre");
  expect(entree.entetes["X-Sereo-Geste"], "l'ecriture en file n'a pas de cle d'idempotence : son renvoi pourrait s'appliquer deux fois").toMatch(/^[A-Za-z0-9_-]{8,}$/);
  await expect(page.locator("#bandeauHorsLigne")).toBeVisible();
  await expect(page.locator("#bandeauHorsLigneDetail")).toContainText(`1 livraison en attente d'envoi : ${nomA}.`);
  await expect(ligne(page, a).locator(".pill")).toHaveText("Livré");
  await expect(ligne(page, a).locator(".route-stop-attente")).toHaveText("En attente d’envoi");
  const toasts = await page.evaluate(() => window.__toasts);
  expect(toasts.join(" | "), "un message brut du navigateur est montre").not.toMatch(/Failed to fetch|NetworkError|Load failed/i);
  expect((await arretsServeur(srv.base))[a].status, "prealable : rien n'est arrive au serveur").not.toBe("livre");

  // Le reseau revient, SANS evenement « online » (le telephone n'a jamais cru
  // l'avoir perdu) : la file part d'elle-meme.
  await page.unroute("**/api/routes/*/stops/*");
  await expect.poll(async () => (await arretsServeur(srv.base))[a].status, { timeout: 40000, message: "la livraison en file n'est jamais partie" }).toBe("livre");
  await expect.poll(async () => (await lireFile(page)).length, { timeout: 10000 }).toBe(0);
  await expect(page.locator("#bandeauHorsLigne")).toBeHidden();
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("H3 — hors ligne, « Client absent » fait avancer l'ecran comme en ligne : a l'arret SUIVANT", async ({ browser }) => {
  // Le livreur a saute A (portail ferme, il y repassera) et touche B. Hors
  // ligne, « Client absent » sur B doit mener a C, l'arret d'apres -- comme en
  // ligne. Pas rester sur B (le « Livre » suivant partirait sur lui, puis
  // serait refuse au renvoi, et perdu), ni revenir a A.
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const [[, nomA], [b, nomB], [, nomC]] = await prochains(srv.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomA);
  await ligne(page, b).locator(".route-stop-main").click();
  await expect(page.locator("#currentClient .arret-nom"), "prealable : B doit etre a l'ecran").toHaveText(nomB);

  await ctx.setOffline(true);
  await page.locator("#markAbsentButton").click();
  await page.waitForTimeout(800);
  await choisirMotifSiDemande(page);

  await expect(page.locator("#currentClient .arret-nom"), "l'ecran n'est pas passe a l'arret suivant de l'absent").toHaveText(nomC);
  await expect(ligne(page, b).locator(".pill")).toHaveText("Absent");
  await expect(ligne(page, b).locator(".route-stop-attente")).toBeVisible();
  const file = await lireFile(page);
  expect(file.map(e => JSON.parse(e.corps).status)).toEqual(["absent"]);
  await expect(page.locator("#bandeauHorsLigneDetail")).toContainText(`${nomB} (absent)`);

  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await arretsServeur(srv.base))[b].status, { timeout: 15000 }).toBe("absent");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("H2 + M6 — une session expiree GARDE la file et renvoie a la connexion ; la livraison est datee du geste", async ({ browser }) => {
  test.setTimeout(150000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const [[a, nomA]] = await prochains(srv.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomA);

  await ctx.setOffline(true);
  await page.locator("#markDeliveredButton").click();
  const toucheA = Date.now();
  await expect.poll(async () => (await lireFile(page)).length, { timeout: 15000 }).toBe(1);
  const faitLe = JSON.parse((await lireFile(page))[0].corps).faitLe;
  expect(Math.abs(Date.parse(faitLe) - toucheA), "l'heure envoyee n'est pas celle de l'appui").toBeLessThan(2000);

  // Au retour du reseau, le serveur ne reconnait plus la session.
  let refuser = true;
  await page.route("**/api/routes/*/stops/*", route =>
    route.request().method() === "PATCH" && refuser
      ? route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Connexion requise"}' })
      : route.continue());
  const documentAvant = await page.evaluate(() => performance.timeOrigin);
  await page.waitForTimeout(3000);   // le geste et son envoi datent de 3 s de plus
  await ctx.setOffline(false);
  // setOffline(false) emet deja un vrai « online » : le renvoi vers /login
  // peut detruire la page PENDANT cet evaluate. Ce n'est pas un echec -- c'est
  // exactement ce que la suite verifie.
  await page.evaluate(() => window.dispatchEvent(new Event("online"))).catch(() => {});

  // Renvoyee vers /login (le serveur seme n'a pas d'authentification : /login
  // la rend aussitot a l'application -- un NOUVEAU document).
  await expect.poll(() => page.evaluate(() => performance.timeOrigin).catch(() => documentAvant), { timeout: 15000, message: "pas de renvoi vers la connexion" })
    .not.toBe(documentAvant);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => sessionStorage.getItem("sereo:file-connexion")), "le renvoi ne vient pas de la file").not.toBeNull();
  expect((await lireFile(page)).length, "la session expiree a VIDE la file : la livraison est perdue").toBe(1);

  // Reconnecte : la file repart, et la livraison est datee de l'appui.
  refuser = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await arretsServeur(srv.base))[a].status, { timeout: 15000 }).toBe("livre");
  const arret = (await arretsServeur(srv.base))[a];
  expect(arret.deliveredAt, "la livraison est datee de l'arrivee au serveur, pas du geste").toBe(new Date(faitLe).toISOString());
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("C1 — un absent REVIENT dans « Commandes pretes a livrer », marque « A reprogrammer », quel que soit le jour choisi", async ({ browser }) => {
  test.setTimeout(120000);
  // Un absent du jour, marque au serveur (comme depuis un autre telephone).
  const [[i, nom]] = await prochains(srv.base);
  const arret = (await arretsServeur(srv.base))[i];
  const r = await fetch(`${srv.base}/api/routes/r-1/stops/${arret.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "absent" })
  });
  expect(r.status, `prealable : ${nom} n'a pas pu etre marque absent`).toBe(200);

  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const carte = id => page.locator(`#deliveryCandidates .delivery-card:has(input[data-delivery-order="${id}"])`);
  await expect(carte(arret.orderId), "l'absent n'est pas revenu dans les commandes pretes").toHaveCount(1);
  await expect(carte(arret.orderId).locator(".pill")).toHaveText("À reprogrammer");
  // La commande bloquee AVANT ce lot revient aussi, et se lit pareil.
  await expect(carte("o-15"), "la commande bloquee en probleme_livraison n'est pas revenue").toHaveCount(1);
  await expect(carte("o-15").locator(".pill")).toHaveText("À reprogrammer");
  await expect(carte("o-15").locator(".delivery-card-contexte")).toContainText("À reprogrammer");

  // On planifie pour un AUTRE jour : les commandes a relivrer restent.
  await expect(carte("o-8"), "prealable : la commande prete du jour doit etre listee").toHaveCount(1);
  await page.evaluate(() => {
    const champ = document.getElementById("deliveryDate");
    champ.value = "2099-01-15";
    champ.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(carte("o-8"), "temoin : le filtre de date ne filtre plus rien").toHaveCount(0);
  await expect(carte(arret.orderId), "l'absent disparait des qu'on choisit un autre jour").toHaveCount(1);
  await expect(carte("o-15")).toHaveCount(1);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("H1 — une ecriture qu'on ne differe JAMAIS (la purge) echoue en francais, sans file", async ({ browser }) => {
  // Deux choses que le cas « Livre » ne voit pas : le message d'un echec qui
  // n'est PAS mis en file (avant : « Failed to fetch », brut), et la liste des
  // ecritures jamais rejouees plus tard -- une purge rejouee trois heures apres
  // effacerait ce qui a ete saisi entre-temps.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent);
    }))).observe(document, { childList: true, subtree: true });
  });
  page.on("dialog", d => d.accept());
  await page.goto(srv.base + "/#parametres", { waitUntil: "networkidle" });
  const commandesAvant = (await (await fetch(srv.base + "/api/orders")).json()).length;
  await page.route("**/api/orders/purge", route => route.abort("connectionrefused"));

  await page.evaluate(() => document.querySelector('[data-action="purge-orders"]').click());
  await expect.poll(() => page.evaluate(() => window.__toasts.join(" | ")), { timeout: 10000 }).toContain("Impossible de joindre le serveur");
  const toasts = await page.evaluate(() => window.__toasts.join(" | "));
  expect(toasts, "le message brut du navigateur est montre").not.toMatch(/Failed to fetch|NetworkError|Load failed/i);
  expect(await lireFile(page), "une purge a ete mise en file : rejouee plus tard, elle effacerait le travail fait entre-temps").toEqual([]);
  expect((await (await fetch(srv.base + "/api/orders")).json()).length, "prealable : la purge ne devait pas partir").toBe(commandesAvant);
  await ctx.close();
});

// --- Relecture adverse du lot 1 (23/09) -------------------------------------------

/** Modifie la tete de file (essais, heure du dernier echec : maintenant - `depuisMs`). */
function modifierTeteDeFile(page, { essais, depuisMs }) {
  return page.evaluate(({ essais, depuisMs }) => new Promise((ok, ko) => {
    const d = indexedDB.open("sereo-file-attente", 1);
    d.onerror = () => ko(d.error);
    d.onsuccess = () => {
      const db = d.result;
      const magasin = db.transaction("ecritures", "readwrite").objectStore("ecritures");
      const r = magasin.getAll();
      r.onsuccess = () => {
        const [tete] = r.result.sort((a, b) => String(a.depose).localeCompare(String(b.depose)));
        magasin.put({ ...tete, essais, dernierEchec: Date.now() - depuisMs });
        magasin.transaction.oncomplete = () => { db.close(); ok(); };
      };
    };
  }), { essais, depuisMs });
}

test("relecture — un 500 passager ne bloque pas la file en rafale ; bloquee, elle s'annonce UNE fois et repart", async ({ browser }) => {
  // Avant : chaque renvoi (20 s, chaque lecture reussie, chaque « online »)
  // comptait un essai sans pause ; cinq 500 en quelques secondes, et l'entree
  // n'etait plus jamais renvoyee, sous un toast repete toutes les 20 s.
  test.setTimeout(150000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const [[a, nomA]] = await prochains(srv.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomA);

  let mode = "coupe";
  let patchs500 = 0;
  await page.route("**/api/routes/*/stops/*", route => {
    if (route.request().method() !== "PATCH" || mode === "ok") return route.continue();
    if (mode === "coupe") return route.abort("connectionrefused");
    patchs500++;
    return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Erreur interne"}' });
  });
  await page.locator("#markDeliveredButton").click();
  await expect.poll(async () => (await lireFile(page)).length, { timeout: 15000, message: "prealable : le « Livre » doit attendre en file" }).toBe(1);

  // Le serveur repond, mais 500 a l'ecriture ; le reseau clignote.
  mode = "500";
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(300);
  }
  await expect.poll(() => patchs500, { timeout: 5000, message: "prealable : le renvoi doit avoir rencontre le 500" }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1500);
  expect(patchs500, `${patchs500} renvois en 5 s contre un 500 passager : les essais s'epuisent en rafale`).toBe(1);
  expect((await lireFile(page))[0].essais).toBe(1);

  // A bout d'essais (un 500 qui dure) : annonce UNE fois, pas a chaque renvoi.
  const toastsAvant = (await page.evaluate(() => window.__toasts)).length;
  await modifierTeteDeFile(page, { essais: 5, depuisMs: 0 });
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(400);
  }
  const nouveaux = (await page.evaluate(() => window.__toasts)).slice(toastsAvant);
  expect(nouveaux.filter(t => /ne passent pas/.test(t)).length, `le blocage est annonce a chaque renvoi : ${nouveaux.join(" | ")}`).toBe(1);
  await expect(page.locator("#bandeauHorsLigneDetail")).toContainText("nouvel essai tous les quarts d'heure");
  expect(patchs500, "une entree bloquee, en pause, a ete renvoyee").toBe(1);

  // Le serveur est repare ; au terme de la pause lente, l'entree REPART.
  mode = "ok";
  await modifierTeteDeFile(page, { essais: 5, depuisMs: 16 * 60_000 });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await arretsServeur(srv.base))[a].status, { timeout: 15000, message: "une entree bloquee n'est plus JAMAIS renvoyee" }).toBe("livre");
  await expect.poll(async () => (await lireFile(page)).length, { timeout: 10000 }).toBe(0);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

/** La reponse des gestes d'arret : en-tetes recus (le serveur a applique), corps casse ou muet. */
function corpsDesGestes(page, maniere) {
  return page.evaluate(maniere => {
    const vrai = window.fetch.bind(window);
    window.fetch = async (url, options = {}) => {
      const r = await vrai(url, options);
      if (String(options.method || "").toUpperCase() !== "PATCH" || !/\/stops\//.test(String(url))) return r;
      const flux = maniere === "casse"
        ? new ReadableStream({ start(c) { c.error(new TypeError("network error")); } })
        : new ReadableStream({ start() { /* rien ne vient jamais */ } });
      return new Response(flux, { status: r.status, headers: r.headers });
    };
  }, maniere);
}

for (const maniere of ["casse", "muet"]) {
  test(`relecture — le corps de la reponse d'un geste ${maniere === "casse" ? "CASSE en route" : "qui ne vient JAMAIS"} : l'ecran avance, en francais`, async ({ browser }) => {
    // Avant : `await res.text()` sans delai ni traduction. Le serveur avait
    // applique « Client absent », mais l'ecran restait sur l'arret, sous
    // « network error » (ou sans fin, bouton sur « Envoi... »).
    test.setTimeout(120000);
    const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
    const [[a, nomA], [, nomB]] = await prochains(srv.base);
    await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomA);
    await corpsDesGestes(page, maniere);

    await page.locator("#markAbsentButton").click();
    await page.waitForTimeout(800);
    await choisirMotifSiDemande(page);
    await expect.poll(async () => (await arretsServeur(srv.base))[a].status, { timeout: 10000, message: "prealable : le serveur doit avoir applique le geste" }).toBe("absent");
    await expect(page.locator("#currentClient .arret-nom"), "le geste est fait, l'ecran n'est pas passe a l'arret suivant")
      .toHaveText(nomB, { timeout: 20000 });
    const toasts = await page.evaluate(() => window.__toasts.join(" | "));
    expect(toasts, "un message brut du navigateur est montre").not.toMatch(/network error|Failed to fetch|NetworkError|Load failed/i);
    expect(await lireFile(page), "un geste applique a ete mis en file").toEqual([]);
    expect(erreurs).toEqual([]);
    await ctx.close();
  });
}

test("relecture — « Livre » dont le corps de la reponse CASSE, puis « Absent » aussitot : les deux sont appliques, sans echec", async ({ browser }) => {
  // Le chemin le plus frequent : « Livre » part en differe (toast Annuler),
  // et c'est le geste SUIVANT qui le solde. Si le corps de sa reponse casse,
  // la livraison est faite au serveur -- mais sans le `return` sur
  // recuParLeServeur (envoyerLivraisonEnSuspens), l'erreur remontait :
  // solderLivraisonEnSuspens la traitait comme un refus et ARRETAIT le geste
  // suivant. Le livreur voyait un echec, et son « Absent » ne partait pas.
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const [[a, nomA], [b, nomB]] = await prochains(srv.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomA);
  await corpsDesGestes(page, "casse");

  await page.locator("#markDeliveredButton").click();
  await expect(page.locator("#currentClient .arret-nom"), "prealable : « Livre » fait avancer l'ecran").toHaveText(nomB);
  // Avant le terme des 4 s : c'est ce geste qui envoie la livraison en suspens.
  await page.locator("#markAbsentButton").click();
  await page.waitForTimeout(800);
  await choisirMotifSiDemande(page);

  await expect.poll(async () => (await arretsServeur(srv.base))[a].status, { timeout: 10000, message: "prealable : la livraison doit etre appliquee au serveur" }).toBe("livre");
  await expect.poll(async () => (await arretsServeur(srv.base))[b].status, { timeout: 15000, message: "le « Absent » qui suivait n'est jamais parti : la reponse coupee du « Livre » a arrete le geste" }).toBe("absent");
  const toasts = await page.evaluate(() => window.__toasts.join(" | "));
  expect(toasts, "une livraison faite est annoncee comme un echec").not.toMatch(/coupée en route|network error|Failed to fetch|NetworkError|Load failed/i);
  expect(await lireFile(page), "un geste applique a ete mis en file").toEqual([]);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// --- H4, par le mandataire ------------------------------------------------------

async function ouvrirACacheChaud(browser) {
  const ctx = await browser.newContext({ viewport: MOBILE, timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(mdt.base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

test("H4 — apres « Livre », un rechargement lent ne remet JAMAIS l'arret « En livraison »", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrirACacheChaud(browser);
  const [[a, nomA]] = await prochains(srvH4.base);
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(nomA);

  // Chaque requete d'API met 4,5 s : au-dela du repli de 3 s du service worker.
  mdt.etat.delaiApi = 4500;
  await page.evaluate(i => {
    window.__pastilles = [];
    const lire = () => document.querySelectorAll("#routeStopsList .route-stop")[i]?.querySelector(".pill")?.textContent;
    window.__echantillon = setInterval(() => window.__pastilles.push(lire()), 100);
  }, a);
  await page.locator("#markDeliveredButton").click();
  // Toast (4 s), PATCH (4,5 s), puis le rechargement : 17 requetes de 4,5 s,
  // six a la fois par le navigateur -- pres de 14 s. On echantillonne jusqu'a
  // la fin du rechargement.
  await expect.poll(async () => (await arretsServeur(srvH4.base))[a].status, { timeout: 20000 }).toBe("livre");
  await expect(page.locator("#syncStatus")).toHaveText(/^À jour/, { timeout: 40000 });
  const pastilles = await page.evaluate(() => { clearInterval(window.__echantillon); return window.__pastilles; });
  const apresLivre = pastilles.slice(pastilles.indexOf("Livré"));
  expect(apresLivre.length, "prealable : la pastille n'est jamais passee a « Livré »").toBeGreaterThan(50);
  expect(apresLivre.filter(p => p !== "Livré"), "la copie d'avant le geste a ete montree : l'arret livre est redevenu « En livraison »").toEqual([]);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("H4 — la reponse qui arrive APRES le repli de 3 s remplace la copie a l'ecran", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page, erreurs } = await ouvrirACacheChaud(browser);
  const restants = await prochains(srvH4.base);
  const [b, nomB] = restants[restants.length - 1];
  await expect(ligne(page, b).locator(".pill")).not.toHaveText("Livré");

  // Ailleurs (un autre telephone), l'arret B est livre.
  const r = await fetch(`${srvH4.base}/api/routes/r-1/stops/s-${(await arretsServeur(srvH4.base))[b].orderId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "livre" })
  });
  expect(r.status, `prealable : ${nomB} n'a pas pu etre livre au serveur`).toBe(200);

  // Les tournees ne repondent pas dans les 3 s : le service worker rend sa copie.
  mdt.retenir(/^\/api\/routes/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  expect(mdt.retenues(), "prealable : la requete des tournees doit etre retenue").toBeGreaterThan(0);
  await expect(page.locator("#syncStatus"), "prealable : la copie doit etre annoncee comme copie").toHaveText(/^Données (de|du) /);
  await expect(ligne(page, b).locator(".pill"), "prealable : la copie montre l'ancien etat").not.toHaveText("Livré");

  // La reponse arrive, en retard.
  mdt.liberer();
  await expect(ligne(page, b).locator(".pill"), "la reponse tardive a ete jetee : l'ecran garde la copie").toHaveText("Livré", { timeout: 10000 });
  await expect(page.locator("#syncStatus")).toHaveText(/^À jour/);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

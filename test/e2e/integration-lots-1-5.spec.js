// INTEGRATION DES LOTS 1 ET 5 DE L'AUDIT GEO (23/09) : LE CHEMIN DES GESTES
// D'ARRET GARDE LES DEUX GARANTIES.
//
// Le lot 1 (« le livreur ne perd plus rien ») tenait l'ecran juste APRES un
// geste par un rechargement complet : refreshActiveRoute ne remplace jamais la
// tournee par une version plus ancienne (updatedAt), et superpose les gestes
// qui attendent dans la file. Le lot 5 (rapidite), parti du meme main, a
// remplace ce rechargement par une mise a jour ciblee avec la reponse du geste
// (appliquerGesteArret) -- qui ne passait par aucune des deux gardes.
//
// Trois cas, chacun rouge sur la fusion brute (c2dfa87) :
//   1. un geste EN FILE sur A, puis un geste reussi sur B : la reponse de B
//      (le serveur ne connait pas A) effacait A de l'ecran ;
//   2. deux reponses de gestes qui se CROISENT : celle de A, arrivee apres
//      celle de B, ramenait B « En livraison » ;
//   3. un chargement parti AVANT un geste et fini APRES : il remettait les
//      commandes d'avant le geste, et plus rien ne les relisait (le lot 5 a
//      supprime le rechargement qui suivait le geste).
//
// Le service worker est BLOQUE dans ces contextes : ces cas jugent la page, et
// son repli de 3 s rendrait les croisements dependants de l'horloge. Sa part
// (la copie ne recule pas quand la page a recopie l'ecran apres un geste) est
// jugee par test/service-worker-api.test.js.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

const MOBILE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

/** Le seme, avec un arret de plus a livrer : quatre arrets restent a faire. */
function seme() {
  const s = jeuDeDonnees();
  const o = { ...structuredClone(s.commandes.find(c => c.id === "o-5")), id: "o-21", status: "en_livraison" };
  s.commandes.push(o);
  const modele = s.routes[0].stops[4];
  s.routes[0].stops.push({ ...structuredClone(modele), id: "s-o-21", orderId: o.id });
  return s;
}

let srv;
test.beforeEach(async () => {
  srv = await demarrer({ port: 3190, seed: seme() });
});
test.afterEach(async () => {
  if (srv) await srv.arreter();
  srv = null;
});

async function ouvrir(browser) {
  const ctx = await browser.newContext({ viewport: MOBILE, timezoneId: "Europe/Paris", serviceWorkers: "block" });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(srv.base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

async function arretsServeur() {
  const routes = await (await fetch(srv.base + "/api/routes")).json();
  return routes.find(r => r.id === "r-1").stops;
}

const TERMINAUX = ["livre", "absent", "probleme", "a_reprogrammer"];

/** Les arrets a traiter, lus au serveur : { i, nom, id, orderId }. */
async function restants() {
  return (await arretsServeur())
    .map((s, i) => ({ i, nom: s.clientName, id: s.id, orderId: s.orderId, status: s.status }))
    .filter(s => !TERMINAUX.includes(s.status));
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

async function absent(page) {
  await page.locator("#markAbsentButton").click();
  await page.waitForTimeout(300);
  if (await page.locator("#motifProblemeDialog[open]").count()) {
    await page.locator("#motifListe .motif-choix").first().click();
    await page.locator('[data-action="motif-valider"]').click();
  }
}

/** Enregistre chaque etat dessine de la ligne `i` : [badge, « en attente d'envoi »]. */
function observerLigne(page, i) {
  return page.evaluate(indice => {
    window.__etatsLigne = [];
    const liste = document.querySelector("#routeStopsList");
    new MutationObserver(() => {
      const l = liste.querySelectorAll(".route-stop")[indice];
      if (l) window.__etatsLigne.push([l.querySelector(".pill")?.textContent.trim(), Boolean(l.querySelector(".route-stop-attente"))]);
    }).observe(liste, { childList: true, subtree: true });
  }, i);
}

test("lots 1+5 — un geste EN FILE reste a l'ecran quand le geste suivant reussit (mise a jour ciblee)", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser);
  const [a, b] = await restants();
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(a.nom);

  // A n'arrive jamais au serveur (ni au premier envoi, ni aux renvois).
  await page.route(`**/api/routes/*/stops/${a.id}`, route =>
    route.request().method() === "PATCH" ? route.abort("connectionrefused") : route.continue());
  await absent(page);
  await expect.poll(async () => (await lireFile(page)).length, { timeout: 15000, message: "prealable : A doit attendre dans la file" }).toBe(1);
  await expect(page.locator("#currentClient .arret-nom"), "prealable : l'ecran passe a B (H3)").toHaveText(b.nom);
  await expect(ligne(page, a.i).locator(".route-stop-attente")).toBeVisible();

  await observerLigne(page, a.i);
  await absent(page);
  await expect.poll(async () => (await arretsServeur())[b.i].status, { timeout: 15000 }).toBe("absent");
  await expect(ligne(page, b.i).locator(".pill")).toHaveText("Absent");
  await page.waitForTimeout(1500);

  const etats = await page.evaluate(() => window.__etatsLigne);
  expect(etats.length, "prealable : la liste a ete redessinee par le geste sur B").toBeGreaterThan(0);
  expect(etats.filter(([badge, attente]) => badge !== "Absent" || !attente),
    "la reponse de B a efface de l'ecran le geste de A qui attend dans la file").toEqual([]);
  expect((await lireFile(page)).length, "le geste de A a quitte la file").toBe(1);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("lots 1+5 — deux reponses de gestes qui se CROISENT : la plus ancienne ne fait pas reculer l'ecran", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser);
  const [a, b] = await restants();
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(a.nom);

  // Le serveur APPLIQUE A tout de suite ; sa reponse, elle, n'arrive qu'apres celle de B.
  let libererA;
  const porteA = new Promise(r => { libererA = r; });
  let aApplique = false;
  await page.route(`**/api/routes/*/stops/${a.id}`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    const reponse = await route.fetch();
    aApplique = true;
    await porteA;
    await route.fulfill({ response: reponse });
  });
  await absent(page);
  await expect.poll(() => aApplique, { timeout: 10000, message: "prealable : A doit etre applique au serveur" }).toBe(true);

  // Pendant ce temps, le livreur passe a B et le marque absent.
  await ligne(page, b.i).locator(".route-stop-main").click();
  await expect(page.locator("#currentClient .arret-nom"), "prealable : B a l'ecran").toHaveText(b.nom);
  await absent(page);
  await expect.poll(async () => (await arretsServeur())[b.i].status, { timeout: 15000 }).toBe("absent");
  await expect(ligne(page, b.i).locator(".pill"), "prealable : la reponse de B est a l'ecran").toHaveText("Absent");

  await observerLigne(page, b.i);
  libererA();
  await expect.poll(async () => (await page.evaluate(() => window.__etatsLigne)).length, { timeout: 10000, message: "prealable : la reponse de A a ete appliquee" }).toBeGreaterThan(0);
  await page.waitForTimeout(800);

  const etats = await page.evaluate(() => window.__etatsLigne);
  expect(etats.filter(([badge]) => badge !== "Absent"),
    "la reponse de A (plus ancienne que celle de B) a ramene B a l'ecran comme s'il restait a livrer").toEqual([]);
  await expect(ligne(page, a.i).locator(".pill")).toHaveText("Absent");
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("lots 1+5 — un chargement parti AVANT un geste et fini APRES ne laisse pas les commandes d'avant le geste", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page, erreurs } = await ouvrir(browser);
  const [a] = await restants();
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(a.nom);
  const carte = page.locator(`#deliveryCandidates .delivery-card:has([data-delivery-order="${a.orderId}"])`);
  await expect(carte, "prealable : la commande de A n'est pas encore a reprogrammer").toHaveCount(0);

  // Un chargement complet part ; le serveur lui repond AVANT le geste, la
  // reponse des commandes n'arrive qu'apres.
  let liberer;
  const porte = new Promise(r => { liberer = r; });
  let lue = false;
  await page.route("**/api/orders", async route => {
    if (route.request().method() !== "GET" || lue) return route.continue();
    const reponse = await route.fetch();
    lue = true;
    await porte;
    await route.fulfill({ response: reponse });
  });
  await page.evaluate(() => { window.Sereo.loadData(); });
  await expect.poll(() => lue, { timeout: 10000, message: "prealable : les commandes d'avant le geste sont lues" }).toBe(true);

  await absent(page);
  await expect.poll(async () => (await arretsServeur())[a.i].status, { timeout: 15000 }).toBe("absent");
  // La mise a jour ciblee (lot 5) : A revient a planifier (lot 1, C1).
  await expect(carte, "prealable : la reponse du geste a mis la commande a jour").toHaveCount(1);

  await page.evaluate(id => {
    window.__carteVue = [];
    const liste = document.querySelector("#deliveryCandidates");
    new MutationObserver(() => window.__carteVue.push(liste.querySelectorAll(`[data-delivery-order="${id}"]`).length))
      .observe(liste, { childList: true, subtree: true });
  }, a.orderId);
  liberer();
  // Le chargement d'avant le geste se pose (la carte part : la preuve que le
  // croisement a eu lieu) ; ce que l'ecran montre ensuite doit redevenir
  // l'etat d'apres le geste, sans attendre le sondage (60 s).
  await expect.poll(() => page.evaluate(() => window.__carteVue.includes(0)), { timeout: 10000, message: "prealable : le chargement d'avant le geste ne s'est pas pose" }).toBe(true);
  await expect(carte, "les commandes d'avant le geste sont restees a l'ecran : la commande de A n'est plus a reprogrammer")
    .toHaveCount(1, { timeout: 8000 });
  await expect(carte.locator(".pill")).toHaveText("À reprogrammer");
  await page.waitForTimeout(1000);
  await expect(carte).toHaveCount(1);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("lots 1+5 — la page annonce chaque ecriture a son service worker (la copie ne recule pas)", async ({ browser }) => {
  // La logique du service worker (une reponse partie avant l'ecriture ne se
  // range plus) est jugee par test/service-worker-api.test.js, qui lui envoie
  // le message lui-meme. Ce cas juge l'autre moitie : la VRAIE page l'envoie,
  // au vrai service worker qui la controle. Sans lui, la garde n'est branchee
  // sur rien.
  test.setTimeout(90000);
  const ctx = await browser.newContext({ viewport: MOBILE, timezoneId: "Europe/Paris" });
  await ctx.addInitScript(() => {
    window.__messagesAuSw = [];
    const envoyer = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (message, ...reste) {
      window.__messagesAuSw.push(message && message.type);
      return envoyer.call(this, message, ...reste);
    };
  });
  const page = await ctx.newPage();
  await page.goto(srv.base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 })
    .catch(() => page.reload({ waitUntil: "networkidle" }));
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const [a] = await restants();
  await expect(page.locator("#currentClient .arret-nom")).toHaveText(a.nom);
  expect(await page.evaluate(() => window.__messagesAuSw), "prealable : aucune ecriture, aucun message").not.toContain("sereo-ecriture");

  await absent(page);
  await expect.poll(async () => (await arretsServeur())[a.i].status, { timeout: 15000 }).toBe("absent");
  expect(await page.evaluate(() => window.__messagesAuSw), "le geste n'a pas ete annonce au service worker : sa copie peut reculer sous la recopie de la page")
    .toContain("sereo-ecriture");
  await ctx.close();
});

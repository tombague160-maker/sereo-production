// Chargement instantane (lot du 23/09) : ce que l'ouverture montre AVANT que
// le reseau reponde, et ce qu'elle ne doit jamais montrer.
//
// L'INSTRUMENT. Un mandataire HTTP local entre le navigateur et le serveur
// seme. Il sait RETENIR des requetes (elles ne partent qu'a `liberer()`) :
// c'est la seule facon deterministe de prouver qu'un chiffre est a l'ecran
// AVANT la reponse du reseau. Une mesure de duree dirait « plus vite » sur une
// machine calme et « plus lent » sur une machine chargee ; une requete retenue
// dit oui ou non.
//
// Pourquoi un mandataire et pas `page.route` : les requetes que le service
// worker emet lui-meme ne passent pas par les routes de la page. Le
// mandataire, lui, voit tout ce qui sort du navigateur.

const http = require("node:http");
const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

// En serie : les cas partagent le serveur seme et le mandataire.
test.describe.configure({ mode: "serial" });

/** Un mandataire qui peut retenir, retarder ou reecrire. */
async function mandataire(cible) {
  const etat = { retenir: null, attente: [], delaiApi: 0, reecrire: null, entete: null };
  const server = http.createServer((req, res) => {
    const passer = () => {
      const amont = http.request(cible + req.url, { method: req.method, headers: req.headers }, r => {
        const regle = etat.reecrire && etat.reecrire.motif.test(req.url) ? etat.reecrire : null;
        const entetes = { ...r.headers };
        if (etat.entete && (req.url === "/" || req.url.startsWith("/?")) && "x-sereo-shell" in entetes) {
          entetes["x-sereo-shell"] = etat.entete;
        }
        if (!regle) { res.writeHead(r.statusCode, entetes); r.pipe(res); return; }
        // Reecriture : on demande le corps brut (pas de gzip), on l'allonge.
        const morceaux = [];
        r.on("data", m => morceaux.push(m));
        r.on("end", () => {
          const corps = Buffer.concat([Buffer.concat(morceaux), Buffer.from(regle.ajout)]);
          delete entetes["content-length"]; delete entetes.etag; delete entetes["last-modified"];
          entetes["content-length"] = String(corps.length);
          res.writeHead(r.statusCode, entetes); res.end(corps);
        });
      });
      amont.on("error", () => res.destroy());
      req.pipe(amont);
    };
    if (etat.reecrire && etat.reecrire.motif.test(req.url)) {
      // Sans compression, pour pouvoir allonger le corps.
      req.headers["accept-encoding"] = "identity";
      delete req.headers["if-none-match"]; delete req.headers["if-modified-since"];
    }
    if (req.url.startsWith("/login")) etat.versLogin = (etat.versLogin || 0) + 1;
    if (etat.statutApi && req.url.startsWith("/api/")) {
      res.writeHead(etat.statutApi, { "Content-Type": "application/json" });
      res.end('{"error":"Connexion requise"}');
      return;
    }
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

let srv, mdt;
test.beforeAll(async () => {
  srv = await demarrer({ port: 3174 });
  mdt = await mandataire(srv.base);
});
test.afterAll(async () => {
  if (mdt) await mdt.arreter();
  if (srv) await srv.arreter();
});
test.afterEach(() => {
  mdt.liberer();
  mdt.etat.delaiApi = 0; mdt.etat.reecrire = null; mdt.etat.entete = null; mdt.etat.statutApi = 0;
});

const CHIFFRE = "#opRevenue";
const VIDE = "—";

/** Ouvre l'app, attend que le service worker controle la page, recharge une
 *  fois pour que les donnees passent par lui : le cache est alors « chaud ». */
async function ouvrirACacheChaud(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(mdt.base + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(CHIFFRE)).not.toHaveText(VIDE);
  // Le cache se remplit apres la reponse : on laisse les ecritures finir.
  await page.waitForTimeout(500);
  return { ctx, page };
}

function cleDuCacheDeDonnees(page) {
  return page.evaluate(async () => {
    const noms = (await caches.keys()).filter(n => n.startsWith("sereo-api-"));
    const cles = [];
    for (const n of noms) for (const r of await (await caches.open(n)).keys()) cles.push(new URL(r.url).pathname);
    return cles;
  });
}

test("les chiffres du tableau de bord s'affichent AVANT la reponse du reseau, sous « Mise a jour »", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page } = await ouvrirACacheChaud(browser);
  const attendu = await page.locator(CHIFFRE).textContent();

  // Aucune reponse d'API ne revient tant qu'on ne libere pas.
  mdt.retenir(/^\/api\//);
  await page.reload({ waitUntil: "domcontentloaded" });

  // Le chiffre est la, et c'est celui de la derniere fois -- AVANT le reseau.
  // Sous 2 s : le repli du service worker (3 s) ne peut pas l'expliquer.
  await expect(page.locator(CHIFFRE), "le chiffre attend le reseau").toHaveText(attendu, { timeout: 2000 });
  expect(mdt.retenues(), "prealable : les requetes d'API doivent etre retenues").toBeGreaterThan(0);
  // Et il n'est pas presente comme frais.
  await expect(page.locator("#syncStatus")).toHaveText(/^Mise à jour…/);

  mdt.liberer();
  await expect(page.locator("#syncStatus")).toHaveText(/^À jour/, { timeout: 10000 });
  await ctx.close();
});

test("un repli sur le cache n'est jamais annonce « A jour »", async ({ browser }) => {
  // Le reseau ne repond pas dans les 3 s : le service worker rend la derniere
  // copie. Avant ce lot, la pastille disait alors « À jour ».
  test.setTimeout(90000);
  const { ctx, page } = await ouvrirACacheChaud(browser);
  mdt.retenir(/^\/api\//);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const statut = await page.locator("#syncStatus").textContent();
  expect(statut, "des donnees du cache sont annoncees fraiches").not.toMatch(/À jour/);
  expect(statut).toMatch(/^Données (de|du) /);
  await ctx.close();
});

test("les fichiers statiques viennent du cache : un reseau muet ne bloque pas l'ouverture", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page } = await ouvrirACacheChaud(browser);
  const attendu = await page.locator(CHIFFRE).textContent();
  // CSS, JS, polices, bibliotheque de carte : plus rien ne repond.
  mdt.retenir(/^\/(css|js|fonts|vendor|brand|icons)\//);
  // « commit » et pas « domcontentloaded » : sans cache, DOMContentLoaded
  // n'arrive jamais (les scripts attendent), et le banc mourrait d'un depassement
  // de delai au lieu de dire ce qui manque.
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator(CHIFFRE), "l'application attend ses fichiers statiques").toHaveText(attendu, { timeout: 5000 });
  await ctx.close();
});

test("apres une mise a jour de l'application, le nouveau shell arrive des le premier chargement", async ({ browser }) => {
  // Le serveur annonce un autre shell que celui du service worker en place
  // (en-tete X-Sereo-Shell) : les fichiers de CE chargement ne doivent pas
  // venir du vieux cache, sinon une page neuve tournerait sur un vieux script.
  test.setTimeout(90000);
  const { ctx, page } = await ouvrirACacheChaud(browser);
  mdt.etat.entete = "sereo-shell-banc-version-suivante";
  mdt.etat.reecrire = { motif: /^\/css\/style\.css/, ajout: "\n:root{--banc-nouveau-shell:1}\n" };
  await page.reload({ waitUntil: "networkidle" });
  const v = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--banc-nouveau-shell").trim());
  expect(v, "le vieux CSS du cache a ete servi a une page neuve").toBe("1");
  await ctx.close();
});

test("sans changement de shell annonce, une nouvelle version arrive au chargement suivant", async ({ browser }) => {
  // Le cache d'abord ne doit pas figer un fichier pour toujours : la
  // revalidation en arriere-plan le remplace, le chargement suivant le montre.
  test.setTimeout(90000);
  const { ctx, page } = await ouvrirACacheChaud(browser);
  mdt.etat.reecrire = { motif: /^\/css\/style\.css/, ajout: "\n:root{--banc-revalide:1}\n" };
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "networkidle" });
  const v = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--banc-revalide").trim());
  expect(v, "le fichier du cache n'a jamais ete revalide").toBe("1");
  await ctx.close();
});

test("la deconnexion vide le cache de donnees", async ({ browser }) => {
  test.setTimeout(90000);
  const { ctx, page } = await ouvrirACacheChaud(browser);
  const avant = await cleDuCacheDeDonnees(page);
  expect(avant, "prealable : le cache de donnees doit etre rempli").toContain("/api/clients");

  // Le serveur seme tourne SANS authentification : GET /login y sert
  // l'APPLICATION (voir playwright.config.js), qui rechargerait aussitot ses
  // donnees et remplirait le cache de nouveau. On retient donc l'API : le banc
  // lit ce que la deconnexion a laisse, pas ce que la page suivante a remis.
  mdt.retenir(/^\/api\//);
  // La vraie deconnexion : un formulaire POST /logout, qui navigue.
  await Promise.all([
    page.waitForNavigation(),
    page.evaluate(() => {
      const f = document.createElement("form");
      f.method = "POST"; f.action = "/logout";
      document.body.append(f); f.submit();
    })
  ]);
  await page.waitForTimeout(500);
  expect(await cleDuCacheDeDonnees(page), "des donnees survivent a la deconnexion").toEqual([]);
  await ctx.close();
});

test("une session expiree (401) vide le cache de donnees", async ({ browser }) => {
  // L'autre fin de session : personne ne clique sur « se deconnecter », le
  // cookie expire. apiFetch renvoie vers /login ; le cache doit partir avec.
  test.setTimeout(90000);
  const { ctx, page } = await ouvrirACacheChaud(browser);
  expect(await cleDuCacheDeDonnees(page), "prealable : le cache de donnees doit etre rempli").toContain("/api/clients");
  mdt.etat.statutApi = 401;
  mdt.etat.versLogin = 0;
  await page.reload({ waitUntil: "commit" });
  // Le serveur seme n'a pas d'authentification : /login y renvoie a
  // l'application, qui reprend un 401, et ainsi de suite. On ne peut donc pas
  // attendre d'arriver sur /login ; on constate que la redirection a ete
  // tentee, puis on lit le cache depuis un second onglet qui n'execute pas
  // l'application (le manifeste), pour ne pas lire pendant une navigation.
  await expect.poll(() => mdt.etat.versLogin, { timeout: 15000, message: "prealable : aucune redirection vers /login" }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  const lecteur = await ctx.newPage();
  await lecteur.goto(mdt.base + "/manifest.webmanifest");
  expect(await cleDuCacheDeDonnees(lecteur), "des donnees survivent a la fin de session").toEqual([]);
  await ctx.close();
});

test("les polices du premier rendu sont prechargees, et seulement elles", async ({ browser }) => {
  // Deux mesures par largeur. Les polices « utilisees » se lisent sur une page
  // dont on a RETIRE les prechargements : une police prechargee est toujours
  // telechargee, donc toujours dans performance.getEntriesByType("resource"),
  // qu'elle serve au rendu ou non -- la mesurer avec ses prechargements ne
  // pourrait jamais dire « prechargee pour rien » (relecture adverse du 23/09).
  test.setTimeout(90000);
  const polices = page => page.evaluate(() => [...new Set(performance.getEntriesByType("resource")
    .map(e => new URL(e.name).pathname).filter(p => p.startsWith("/fonts/")))].sort());
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.goto(mdt.base + "/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const prechargees = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="preload"][as="font"]')].map(l => new URL(l.href).pathname).sort());

    // La meme page, sans aucun <link rel="preload" as="font">.
    const nue = await ctx.newPage();
    let retires = 0;
    await nue.route(/\/(\?.*)?$/, async route => {
      if (route.request().resourceType() !== "document") return route.continue();
      const r = await route.fetch();
      const html = (await r.text()).replace(/<link\b[^>]*rel="preload"[^>]*as="font"[^>]*>/g, () => { retires++; return ""; });
      await route.fulfill({ response: r, body: html });
    });
    await nue.goto(mdt.base + "/", { waitUntil: "networkidle" });
    await nue.evaluate(() => document.fonts.ready);
    const utilisees = await polices(nue);
    const restants = await nue.evaluate(() => document.querySelectorAll('link[rel="preload"][as="font"]').length);
    expect(restants, "prealable : des prechargements subsistent dans la page nue").toBe(0);
    expect(retires, "prealable : aucun prechargement retire").toBe(prechargees.length);
    expect(utilisees.length, "prealable : aucune police chargee").toBeGreaterThan(0);

    // Chaque police prechargee sert au premier rendu (sinon : octets perdus),
    // et celles du premier rendu sont toutes prechargees.
    expect(prechargees, `${viewport.width} px : prechargees != utilisees par le premier rendu`).toEqual(utilisees);
    await ctx.close();
  }
});

// LA MESURE. Pas un seuil : des chiffres, ecrits dans design/DESIGN.md. Le
// reseau est simule a 300 ms par reponse d'API (un telephone en 4G moyenne).
test("mesure : premier chiffre du tableau de bord, second chargement a cache chaud", async ({ browser }) => {
  test.setTimeout(120000);
  const { ctx, page } = await ouvrirACacheChaud(browser);
  const mesures = {};
  for (const delai of [0, 300]) {
    mdt.etat.delaiApi = delai;
    const temps = [];
    for (let i = 0; i < 5; i++) {
      await page.reload({ waitUntil: "commit" });
      const t = await page.evaluate(() => new Promise(resolve => {
        const lire = () => {
          const el = document.getElementById("opRevenue");
          if (el && el.textContent.trim() && el.textContent.trim() !== "—") { resolve(Math.round(performance.now())); return true; }
          return false;
        };
        if (lire()) return;
        new MutationObserver((_, o) => { if (lire()) o.disconnect(); }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      }));
      temps.push(t);
      await page.waitForLoadState("networkidle");
    }
    temps.sort((a, b) => a - b);
    mesures[`api +${delai} ms`] = { mediane: temps[2], min: temps[0], max: temps[4] };
  }
  console.log("MESURE chargement-instantane", JSON.stringify(mesures));
  test.info().annotations.push({ type: "mesure", description: JSON.stringify(mesures) });
  await ctx.close();
});

// APRES UNE MISE A JOUR, LA TOURNEE ROUVERTE HORS LIGNE DEMARRE -- et sur les
// fichiers de SA version (chasse aux defauts du 24/09, section 1 ; 25/09).
//
// LE DEFAUT DE L'AUDIT (v1.45.0) : apres un deploiement, la tournee rouverte
// hors ligne s'ouvrait sans style ni script (la page demandait des adresses
// ?v= que le service worker n'installait pas). Sur 5b52268 (v1.46.0 et la
// performance), ce cas-la passe : les ?v= sont partis. Ce banc le garde, et
// juge le cas qui restait : le service worker suivant n'a pas fini de
// s'installer (reseau coupe juste apres l'ouverture, ou installation en
// echec) -- la page neuve avait REMPLACE la copie de l'ancienne, et la
// tournee ne se rouvrait plus (« cet ecran demande le reseau »).
//
// UNE VRAIE MISE A JOUR, sans rien simuler dans la page : un mandataire entre
// le navigateur et le serveur seme joue deux versions. En version « B », il
// sert le service worker sous un autre nom de shell, annonce ce nom sur la page
// (X-Sereo-Shell) et sur chaque fichier (X-Sereo-Shell-Fichier), et marque la
// page ET app.js du nom de leur version -- pour juger qu'une page ne demarre
// que sur SES fichiers. Il
// peut aussi COUPER (toute connexion fermee), et empecher l'installation du
// service worker suivant (son script ne parvient pas : le reseau est tombe
// juste apres l'ouverture). Pas en refusant ses fichiers : Chromium envoie
// les requetes qu'un service worker relaie avec `Sec-Fetch-Dest: empty`, comme
// celles de l'installation -- on ne les distingue pas (mesure du 25/09).
const http = require("node:http");
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const MOBILE = { width: 390, height: 844 };
// Un identifiant jetable, local : la base du serveur seme est un dossier
// temporaire detruit avec lui.
const IDENTIFIANT = "banc";
const MOT_DE_PASSE = "banc-e2e-shell-version-sans-valeur";

function mandataire(cible) {
  const etat = { version: "A", coupe: false, installationBloquee: false, installationsRefusees: 0, refuses: [], nomA: null };
  const nomB = () => `${etat.nomA}-b`;
  const server = http.createServer((req, res) => {
    if (etat.coupe) { req.socket.destroy(); return; }
    const url = new URL(req.url, cible);
    if (etat.installationBloquee && url.pathname === "/service-worker.js") {
      etat.installationsRefusees += 1;
      etat.refuses.push(url.pathname);
      req.socket.destroy();
      return;
    }
    const entetes = { ...req.headers };
    // Corps en clair (le mandataire les marque), et jamais de 304 : le cache
    // HTTP du navigateur ne doit pas rendre un fichier d'une autre version.
    delete entetes["accept-encoding"];
    delete entetes["if-none-match"];
    delete entetes["if-modified-since"];
    const amont = http.request(cible + req.url, { method: req.method, headers: entetes }, r => {
      const morceaux = [];
      r.on("data", m => morceaux.push(m));
      r.on("end", () => {
        let corps = Buffer.concat(morceaux);
        const sortie = { ...r.headers };
        delete sortie["content-length"];
        delete sortie.etag;
        delete sortie["last-modified"];
        if (url.pathname === "/service-worker.js") {
          const texte = corps.toString("utf8");
          etat.nomA = etat.nomA || /const CACHE_NAME = "([^"]+)"/.exec(texte)[1];
          if (etat.version === "B") corps = Buffer.from(texte.replace(`const CACHE_NAME = "${etat.nomA}"`, `const CACHE_NAME = "${nomB()}"`));
        } else {
          // La version annoncee (la page ; et chaque fichier, depuis le 25/09).
          for (const nom of ["x-sereo-shell", "x-sereo-shell-fichier"]) if (sortie[nom] && etat.version === "B" && etat.nomA) sortie[nom] = nomB();
          sortie["cache-control"] = "no-store";
          if (url.pathname === "/js/app.js") {
            corps = Buffer.concat([corps, Buffer.from(`\nglobalThis.__versionDesFichiers = "${etat.version}";\n`)]);
          } else if (/text\/html/.test(sortie["content-type"] || "")) {
            corps = Buffer.from(corps.toString("utf8").replace("<head>", `<head><meta name="banc-version" content="${etat.version}">`));
          }
        }
        res.writeHead(r.statusCode, sortie);
        res.end(corps);
      });
    });
    amont.on("error", () => res.destroy());
    req.pipe(amont);
  });
  server.listen(0, "127.0.0.1");
  return require("node:events").once(server, "listening").then(() => ({
    base: `http://127.0.0.1:${server.address().port}`,
    etat,
    async arreter() {
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  }));
}

let srv, mdt;
test.beforeAll(async () => {
  // Sur UNE ligne : test/ports-e2e.test.js ne voit le port que la.
  srv = await demarrer({ port: 3607, seed: jeuDeDonnees(), env: { SEREO_AUTH_USER: IDENTIFIANT, SEREO_AUTH_PASSWORD: MOT_DE_PASSE } });
  mdt = await mandataire(srv.base);
});
test.afterAll(async () => {
  if (mdt) await mdt.arreter();
  if (srv) await srv.arreter();
});
test.beforeEach(() => Object.assign(mdt.etat, { version: "A", coupe: false, installationBloquee: false, installationsRefusees: 0, refuses: [] }));

/** Connecte, laisse le service worker (version A) prendre la page, et la garder. */
async function preparerVersionA(page) {
  await page.goto(mdt.base + "/login?next=" + encodeURIComponent("/#livreur"));
  await page.fill("#username", IDENTIFIANT);
  await page.fill("#password", MOT_DE_PASSE);
  await Promise.all([
    page.waitForURL(u => !new URL(u).pathname.startsWith("/login")),
    page.locator('form[action="/login"] button[type="submit"]').click()
  ]);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
  // Cette navigation-la passe par le service worker : la page est gardee.
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(async () => {
    const api = (await caches.keys()).find(n => n.startsWith("sereo-api-"));
    return Boolean(api && await (await caches.open(api)).match("/__sereo/page-tournee"));
  }), { timeout: 15000, message: "prealable : la page de la tournee n'est pas gardee" }).toBe(true);
  await expect(page.locator("#routeStopsList .route-stop").first()).toBeVisible();
  expect(await page.evaluate(() => globalThis.__versionDesFichiers), "prealable : le mandataire marque app.js").toBe("A");
}

const shells = page => page.evaluate(async () => (await caches.keys()).filter(n => n.startsWith("sereo-shell")));

/** Coupe, puis rouvre la tournee dans un onglet neuf ; ce qui a demarre. */
async function rouvrirHorsLigne(ctx) {
  mdt.etat.coupe = true;
  await ctx.setOffline(true);
  const page = await ctx.newPage();
  const echecs = [];
  page.on("requestfailed", r => { if (!new URL(r.url()).pathname.startsWith("/api/")) echecs.push(new URL(r.url()).pathname); });
  let erreur = null;
  try {
    await page.goto(mdt.base + "/?ecran=livreur#livreur", { waitUntil: "domcontentloaded" });
  } catch (e) {
    erreur = String(e.message || e).split("\n")[0];
  }
  await page.waitForTimeout(erreur ? 0 : 4000);
  const etat = erreur ? { erreur } : await page.evaluate(() => ({
    copie: document.documentElement.hasAttribute("data-ouverte-hors-ligne"),
    demarree: typeof window.Sereo === "object",
    style: [...document.styleSheets].some(s => (s.href || "").includes("/css/style.css") && (() => { try { return s.cssRules.length > 0; } catch { return false; } })()),
    versionPage: document.querySelector('meta[name="banc-version"]')?.content || null,
    versionFichiers: globalThis.__versionDesFichiers || null,
    arrets: document.querySelectorAll("#routeStopsList .route-stop").length,
    titre: document.querySelector("h1")?.textContent || ""
  }));
  return { page, etat, echecs: [...new Set(echecs)] };
}

test("apres une mise a jour INSTALLEE, la tournee rouverte hors ligne demarre, style et scripts de SA version (le cas de l'audit)", async ({ browser }) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: MOBILE, serviceWorkers: "allow", timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();
  await preparerVersionA(page);
  const nomA = mdt.etat.nomA;
  // Deploiement : le serveur passe en version B, le livreur ouvre l'application.
  mdt.etat.version = "B";
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => shells(page), { timeout: 30000, message: "le service worker B ne s'est pas installe a la place de A" })
    .toEqual([`${nomA}-b`]);
  await page.close();
  const { page: rouverte, etat, echecs } = await rouvrirHorsLigne(ctx);
  expect(etat, `rouverte hors ligne (titre : « ${etat.titre} ») ; requetes echouees : ${echecs.join(", ")}`).toMatchObject({
    copie: true, demarree: true, style: true, versionPage: "B", versionFichiers: "B"
  });
  expect(etat.arrets, "la tournee est vide").toBeGreaterThan(0);
  await rouverte.close();
  await ctx.close();
});

test("le service worker suivant PAS encore installe (coupe, ou installation en echec) : la tournee se rouvre quand meme, sur la page et les fichiers de l'ANCIENNE version", async ({ browser }) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: MOBILE, serviceWorkers: "allow", timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();
  await preparerVersionA(page);
  const nomA = mdt.etat.nomA;
  // Deploiement, mais le service worker B ne peut pas s'installer : ses
  // fichiers ne lui parviennent pas (le reseau tombe juste apres l'ouverture).
  mdt.etat.version = "B";
  mdt.etat.installationBloquee = true;
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  page.on("requestfailed", r => erreurs.push(`${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
  await page.reload({ waitUntil: "domcontentloaded" });
  // Temoin : la page B s'ouvre en ligne, sur SES fichiers (par le reseau).
  await expect.poll(() => page.evaluate(() => [document.querySelector('meta[name="banc-version"]')?.content, globalThis.__versionDesFichiers]), {
    timeout: 15000, message: `la page B en ligne ; erreurs : ${erreurs.join(" | ")} ; refusees : ${mdt.etat.refuses.join(", ")}`
  }).toEqual(["B", "B"]);
  await expect.poll(() => mdt.etat.installationsRefusees, { timeout: 30000, message: "prealable : le service worker B n'a pas tente de s'installer" }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect(await shells(page), "prealable : le service worker B s'est installe malgre tout").toEqual([nomA]);
  await page.close();
  const { page: rouverte, etat, echecs } = await rouvrirHorsLigne(ctx);
  expect(etat, `rouverte hors ligne (titre : « ${etat.titre} ») ; requetes echouees : ${echecs.join(", ")}`).toMatchObject({
    copie: true, demarree: true, style: true, versionPage: "A", versionFichiers: "A"
  });
  expect(etat.arrets, "la tournee est vide").toBeGreaterThan(0);
  await rouverte.close();
  await ctx.close();
});

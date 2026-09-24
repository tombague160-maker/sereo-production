// UN SHELL, UNE VERSION (chasse aux defauts du 24/09, section 1 ; corrige le
// 25/09) : la page gardee pour la tournee hors ligne et les fichiers qui la
// font demarrer sont de la MEME version, ranges ensemble.
//
// LE DEFAUT DE L'AUDIT (v1.45.0) : la page demandait style.css?v= et
// app.js?v=, le service worker installait les adresses SANS ?v= ; apres une
// mise a jour, la tournee rouverte hors ligne s'ouvrait sans style ni script.
// Deja tenu depuis la performance du 24/09 (plus de ?v=, banc
// poids-reseau.test.js). Restaient trois chemins par lesquels une page et des
// fichiers de versions differentes se retrouvaient ensemble :
//  1. une page plus recente que le service worker (« en retard ») rangeait
//     ses fichiers neufs dans le cache de l'ANCIENNE version ;
//  2. la revalidation d'arriere-plan faisait de meme ;
//  3. la page neuve REMPLACAIT la copie de l'ancienne avant l'installation de
//     son service worker : coupe dans l'intervalle, plus de tournee.
// Et l'installation rangeait ce que le serveur rendait a cet instant, quelle
// qu'en soit la version (une session finie : la page de connexion en app.js).
//
// Ce banc execute le VRAI public/service-worker.js dans un bac a sable
// (doublures de fetch et caches, installation et activation comprises), comme
// tournee-hors-ligne.test.js ; le navigateur, lui, est juge par
// test/e2e/shell-meme-version.spec.js. Et le serveur, en vrai : chaque
// fichier du shell annonce sa version.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { once } = require("node:events");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "service-worker.js"), "utf8");
const CACHE_NAME = SOURCE.match(/const CACHE_NAME = "([^"]+)"/)[1];
const API = SOURCE.match(/const API_CACHE_NAME = "([^"]+)"/)[1];
const APP_SHELL = [...SOURCE.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
const ORIGINE = "http://sereo.test";
const CLE_PAGE = ORIGINE + "/__sereo/page-tournee";
const SUIVANTE = "sereo-shell-version-suivante";

const attendre = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Les caches du navigateur : partages par deux service workers successifs. */
function fairesCaches() {
  const magasins = new Map();
  const faireMagasin = () => {
    const entrees = new Map();
    const cle = r => new URL(typeof r === "string" ? r : r.url, ORIGINE).href;
    return {
      entrees,
      async match(r) { const x = entrees.get(cle(r)); return x ? x.clone() : undefined; },
      async put(r, reponse) { entrees.set(cle(r), reponse); },
      async delete(r) { return entrees.delete(cle(r)); },
      // Comme le navigateur : chaque adresse au reseau, tout ou rien.
      async addAll(adresses) {
        const reponses = await Promise.all(adresses.map(a => this.reseau(new Request(new URL(a, ORIGINE).href))));
        if (reponses.some(r => !r.ok)) throw new TypeError("addAll : une reponse en echec");
        reponses.forEach((r, i) => entrees.set(cle(adresses[i]), r));
      },
      async keys() { return [...entrees.keys()].map(u => new Request(u)); }
    };
  };
  return {
    magasins,
    reseau: null,
    async open(nom) {
      if (!magasins.has(nom)) { const m = faireMagasin(); m.reseau = r => this.reseau(r); magasins.set(nom, m); }
      return magasins.get(nom);
    },
    async has(nom) { return magasins.has(nom); },
    async keys() { return [...magasins.keys()]; },
    async delete(nom) { return magasins.delete(nom); },
    async match() { return undefined; }
  };
}

/** Charge un service worker (`nom` : son CACHE_NAME) sur des caches partages. */
function chargerServiceWorker(caches, reseau, nom = CACHE_NAME) {
  const ecouteurs = {};
  caches.reseau = requete => reseau(requete.url, requete);
  const self = {
    location: { origin: ORIGINE },
    addEventListener(type, f) { ecouteurs[type] = f; },
    skipWaiting() {},
    clients: { claim: async () => {}, get: async () => undefined },
    registration: { update: async () => {} }
  };
  const bac = {
    self, caches, console, URL, Headers, Request, Response, Promise, Date, Set, Map, Error, TypeError, Number,
    fetch: requete => reseau(typeof requete === "string" ? new URL(requete, ORIGINE).href : new URL(requete.url, ORIGINE).href, requete),
    setTimeout: (f, ms) => setTimeout(f, ms / 100),
    clearTimeout
  };
  vm.createContext(bac);
  vm.runInContext(SOURCE.replace(/const CACHE_NAME = "[^"]+"/, `const CACHE_NAME = "${nom}"`), bac);
  return { ecouteurs, caches, nom };
}

/** Un evenement a attendre (install, activate). Rend la promesse de waitUntil. */
function evenement(sw, type) {
  let attente = Promise.resolve();
  sw.ecouteurs[type]({ waitUntil(p) { attente = p; } });
  return attente;
}

/** Un fichier statique, tel que le serveur le rend : `shell` sa version annoncee. */
function fichier(corps, { shell = CACHE_NAME, status = 200, redirige = false } = {}) {
  const headers = { "Content-Type": "text/javascript" };
  if (shell) headers["X-Sereo-Shell-Fichier"] = shell;
  const r = new Response(corps, { status, headers });
  Object.defineProperty(r, "type", { value: "basic" });
  if (redirige) Object.defineProperty(r, "redirected", { value: true });
  return r;
}

/** La page de l'application : sa version, sa fin de session. */
function page({ shell = CACHE_NAME, html = "<html><body><section id=\"livreur\"></section></body></html>" } = {}) {
  const r = new Response(html, { status: 200, headers: {
    "Content-Type": "text/html; charset=UTF-8", "X-Sereo-Shell": shell, "X-Sereo-Session-Fin": String(Date.now() + 3600e3)
  } });
  Object.defineProperty(r, "type", { value: "basic" });
  return r;
}

/** Une navigation ; attend la fin du rangement (waitUntil). */
async function naviguer(sw, chemin, clientId = "page-neuve") {
  const attentes = [];
  let reponse = null;
  sw.ecouteurs.fetch({
    request: { url: ORIGINE + chemin, method: "GET", mode: "navigate", headers: new Headers() },
    clientId: "", resultingClientId: clientId,
    respondWith(p) { reponse = p; },
    waitUntil(p) { attentes.push(p); }
  });
  assert.ok(reponse, "le service worker n'a pas repondu a la navigation");
  const r = await reponse;
  await Promise.all(attentes);
  return r;
}

/** Un fichier demande par la page `clientId` ; attend la revalidation. */
async function demander(sw, clientId, chemin) {
  const attentes = [];
  let reponse = null;
  sw.ecouteurs.fetch({
    request: new Request(ORIGINE + chemin),
    clientId, resultingClientId: "",
    respondWith(p) { reponse = p; },
    waitUntil(p) { attentes.push(p); }
  });
  assert.ok(reponse, `${chemin} : le service worker n'a pas repondu`);
  const texte = await (await reponse).text();
  await Promise.all(attentes.map(p => p.catch(() => {})));
  await attendre(5);
  return texte;
}

async function dansLeShell(caches, nom, chemin) {
  const magasin = await caches.open(nom);
  const r = magasin.entrees.get(ORIGINE + chemin);
  return r ? r.clone().text() : null;
}

const horsLigne = () => Promise.reject(new TypeError("Failed to fetch"));

test("installation : tous les fichiers de CETTE version -- installes (temoin)", async () => {
  const caches = fairesCaches();
  const sw = chargerServiceWorker(caches, url => Promise.resolve(fichier(`v1 ${new URL(url).pathname}`)));
  await evenement(sw, "install");
  assert.equal(await dansLeShell(caches, CACHE_NAME, "/js/app.js"), "v1 /js/app.js");
  assert.equal((await caches.open(CACHE_NAME)).entrees.size, APP_SHELL.length);
});

test("installation : un fichier d'une AUTRE version (serveur mis a jour entre-temps) -- rien n'est installe", async () => {
  const caches = fairesCaches();
  const sw = chargerServiceWorker(caches, url => Promise.resolve(new URL(url).pathname === "/js/app.js"
    ? fichier("v2", { shell: SUIVANTE })
    : fichier("v1")));
  await assert.rejects(evenement(sw, "install"), "l'installation a accepte un app.js d'une autre version");
  assert.equal(await dansLeShell(caches, CACHE_NAME, "/js/app.js"), null, "app.js d'une autre version range dans ce shell");
});

test("installation : la page de CONNEXION a la place d'un fichier (session finie, redirection) -- rien n'est installe", async () => {
  const caches = fairesCaches();
  const sw = chargerServiceWorker(caches, url => Promise.resolve(new URL(url).pathname === "/js/app.js"
    ? fichier("<html><form action=\"/login\"></form></html>", { shell: null, redirige: true })
    : fichier("v1")));
  await assert.rejects(evenement(sw, "install"), "la page de connexion est installee comme app.js");
});

test("page plus recente (en retard) : ses fichiers passent, mais ne vont PAS dans le cache de cette version (temoin : un fichier de cette version, si)", async () => {
  for (const [nom, shell, attendu] of [["temoin", CACHE_NAME, "neuf"], ["autre version", SUIVANTE, "ancien"]]) {
    const caches = fairesCaches();
    const sw = chargerServiceWorker(caches, url => Promise.resolve(new URL(url).pathname === "/"
      ? page({ shell: SUIVANTE })
      : fichier("neuf", { shell })));
    await (await caches.open(CACHE_NAME)).put(ORIGINE + "/js/app.js", fichier("ancien"));
    // La page neuve : « en retard » pour ce service worker.
    await naviguer(sw, "/", "page-b");
    assert.equal(await demander(sw, "page-b", "/js/app.js"), "neuf", `${nom} : la page neuve n'a pas recu SON fichier`);
    assert.equal(await dansLeShell(caches, CACHE_NAME, "/js/app.js"), attendu, nom);
  }
});

test("revalidation d'arriere-plan : un fichier d'une autre version n'ecrase pas celui du cache (temoin : de cette version, il le remplace)", async () => {
  for (const [nom, shell, attendu] of [["temoin", CACHE_NAME, "neuf"], ["autre version", SUIVANTE, "ancien"]]) {
    const caches = fairesCaches();
    const sw = chargerServiceWorker(caches, () => Promise.resolve(fichier("neuf", { shell })));
    await (await caches.open(CACHE_NAME)).put(ORIGINE + "/js/app.js", fichier("ancien"));
    // Une page de CETTE version (la copie de la tournee, par exemple) : le cache d'abord.
    assert.equal(await demander(sw, "page-a", "/js/app.js"), "ancien", `${nom} : prealable, le cache d'abord`);
    assert.equal(await dansLeShell(caches, CACHE_NAME, "/js/app.js"), attendu, nom);
  }
});

test("copie de la tournee : la page de la version SUIVANTE ne remplace pas celle de cette version ; coupe avant son installation, la tournee se rouvre (sur SES fichiers)", async () => {
  const caches = fairesCaches();
  let reseau = () => Promise.resolve(page({ html: "<html><body><section id=\"livreur\">version A</section></body></html>" }));
  const sw = chargerServiceWorker(caches, (...a) => reseau(...a));
  await naviguer(sw, "/");
  // Deploiement : la page annonce la version suivante.
  reseau = () => Promise.resolve(page({ shell: SUIVANTE, html: "<html><body><section id=\"livreur\">version B</section></body></html>" }));
  await naviguer(sw, "/");
  // Coupe avant que le service worker suivant soit installe.
  reseau = horsLigne;
  const r = await naviguer(sw, "/#livreur");
  assert.equal(r.headers.get("X-Sereo-Cache"), "copie", "la tournee ne se rouvre plus hors ligne");
  assert.match(await r.text(), /version A/, "la copie rouverte n'est pas celle de cette version");
});

test("activation du service worker suivant : la page gardee pour lui devient SA copie ; hors ligne, elle s'ouvre", async () => {
  const caches = fairesCaches();
  let reseau = () => Promise.resolve(page({ html: "<html><body><section id=\"livreur\">version A</section></body></html>" }));
  const a = chargerServiceWorker(caches, (...x) => reseau(...x));
  await naviguer(a, "/");
  reseau = url => Promise.resolve(new URL(url).pathname === "/" || new URL(url).pathname === ""
    ? page({ shell: SUIVANTE, html: "<html><body><section id=\"livreur\">version B</section></body></html>" })
    : fichier("v2", { shell: SUIVANTE }));
  await naviguer(a, "/");
  const b = chargerServiceWorker(caches, (...x) => reseau(...x), SUIVANTE);
  await evenement(b, "install");
  await evenement(b, "activate");
  assert.equal(caches.magasins.has(CACHE_NAME), false, "prealable : l'activation retire le shell precedent");
  reseau = horsLigne;
  const r = await naviguer(b, "/#livreur");
  assert.equal(r.headers.get("X-Sereo-Cache"), "copie", "apres l'activation, la tournee ne se rouvre plus hors ligne");
  assert.match(await r.text(), /version B/);
  assert.ok((await caches.open(API)).entrees.get(CLE_PAGE), "la copie n'est pas a sa place");
});

// --- Le serveur : chaque fichier du shell annonce sa version ----------------

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-shell-version-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(racine, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(racine, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(racine, "imports");
process.env.SEREO_BACKUP_DIR = path.join(racine, "data", "backups");
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
const { app, closeStorage } = require("../server");

let serveur, base;
before(async () => {
  serveur = app.listen(0);
  await once(serveur, "listening");
  base = `http://127.0.0.1:${serveur.address().port}`;
});
after(async () => {
  await new Promise(resolve => serveur.close(resolve));
  closeStorage();
  fs.rmSync(racine, { recursive: true, force: true });
});

test("serveur : chaque fichier du shell annonce la version de la page (et le service worker servi porte ce nom)", async () => {
  const pageApp = await fetch(base + "/");
  const shell = pageApp.headers.get("x-sereo-shell");
  // Temoin : la page annonce bien une version, et le service worker la porte.
  assert.match(shell || "", /^sereo-shell-/);
  assert.match(await (await fetch(base + "/service-worker.js")).text(), new RegExp(`const CACHE_NAME = "${shell}"`));
  const sans = [];
  for (const chemin of APP_SHELL) {
    const r = await fetch(base + chemin);
    assert.equal(r.status, 200, chemin);
    if (r.headers.get("x-sereo-shell-fichier") !== shell) sans.push(`${chemin} : ${r.headers.get("x-sereo-shell-fichier")}`);
  }
  assert.deepEqual(sans, [], "des fichiers du shell n'annoncent pas leur version");
});

// L'ECRAN TOURNEE SE ROUVRE SANS RESEAU (decision 4, 23/09) : la LOGIQUE du
// service worker et l'en-tete du serveur qui la nourrit.
//
// Le banc navigateur (test/e2e/tournee-hors-ligne.spec.js) prouve le parcours
// reel : fermer, redemarrer, rouvrir hors ligne, se deconnecter. Celui-ci
// juge chaque condition du service worker SEPAREMENT, ce qu'un navigateur ne
// permet pas sans attendre 12 h : session expiree, shell d'une autre version,
// reseau muet, passerelle en erreur, acces Basic sans cookie. Il execute le
// VRAI public/service-worker.js dans un bac a sable (doublures de `fetch`,
// `caches`, minuteries accelerees 100 fois), comme service-worker-api.test.js.
//
// Et le serveur, en vrai (HTTP, authentification active) : la page annonce la
// fin de SA session, la page de connexion annonce « 0 », l'acces Basic rien.

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
const ORIGINE = "http://sereo.test";
const ACCELERATION = 100;
const CLE_PAGE = ORIGINE + "/__sereo/page-tournee";
const PAGE_APPLI = '<!DOCTYPE html>\n<html lang="fr">\n<head><title>Séréo</title></head><body><section id="livreur"></section></body></html>';
const CSP = "default-src 'self'; script-src 'self'";

const attendre = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Charge le service worker. `reseau(url, request)` rend une promesse de Response. */
function chargerServiceWorker(reseau) {
  const magasins = new Map();
  const ecouteurs = {};
  const faireMagasin = () => {
    const entrees = new Map();
    const cle = r => new URL(typeof r === "string" ? r : r.url, ORIGINE).href;
    return {
      entrees,
      async match(r) { const x = entrees.get(cle(r)); return x ? x.clone() : undefined; },
      async put(r, reponse) { entrees.set(cle(r), reponse); },
      async delete(r) { return entrees.delete(cle(r)); },
      async addAll() {},
      async keys() { return [...entrees.keys()].map(u => new Request(u)); }
    };
  };
  const caches = {
    async open(nom) {
      if (!magasins.has(nom)) magasins.set(nom, faireMagasin());
      return magasins.get(nom);
    },
    async keys() { return [...magasins.keys()]; },
    async delete(nom) { return magasins.delete(nom); },
    async match() { return undefined; }
  };
  const self = {
    location: { origin: ORIGINE },
    addEventListener(type, f) { ecouteurs[type] = f; },
    skipWaiting() {},
    clients: { claim: async () => {}, get: async () => undefined },
    registration: { update: async () => {} }
  };
  const bac = {
    self, caches, console, URL, Headers, Request, Response, Promise, Date, Set, Map, Error, Number,
    fetch: requete => reseau(requete.url, requete),
    setTimeout: (f, ms) => setTimeout(f, ms / ACCELERATION),
    clearTimeout
  };
  vm.createContext(bac);
  vm.runInContext(SOURCE, bac);
  return { ecouteurs, caches, magasins };
}

/** Une navigation (mode « navigate » : un Request de Node ne sait pas le porter). */
function naviguer(sw, chemin) {
  const attentes = [];
  let reponse = null;
  const evenement = {
    request: { url: ORIGINE + chemin, method: "GET", mode: "navigate", headers: new Headers() },
    clientId: "", resultingClientId: "page-neuve",
    respondWith(p) { reponse = p; },
    waitUntil(p) { attentes.push(p); }
  };
  sw.ecouteurs.fetch(evenement);
  assert.ok(reponse, "le service worker n'a pas repondu a la navigation");
  return { reponse, attentes };
}

/** La page de l'application, telle que le serveur la rend. */
function pageServeur({ fin = Date.now() + 3600e3, shell = CACHE_NAME, status = 200, html = PAGE_APPLI } = {}) {
  const headers = { "Content-Type": "text/html; charset=UTF-8", "Content-Security-Policy": CSP };
  if (shell !== null) headers["X-Sereo-Shell"] = shell;
  if (fin !== null) headers["X-Sereo-Session-Fin"] = String(fin);
  const r = new Response(html, { status, headers });
  Object.defineProperty(r, "type", { value: "basic" });
  return r;
}

const horsLigne = () => Promise.reject(new TypeError("Failed to fetch"));

/** Une navigation en ligne qui garde la page, puis le reseau coupe. */
async function semerPage(options) {
  let reponseReseau = () => Promise.resolve(pageServeur(options));
  const sw = chargerServiceWorker((...a) => reponseReseau(...a));
  const { reponse, attentes } = naviguer(sw, "/");
  await reponse;
  await Promise.all(attentes);
  sw.couper = () => { reponseReseau = horsLigne; };
  sw.reseau = f => { reponseReseau = f; };
  return sw;
}

async function pageGardee(sw) {
  const magasin = await sw.caches.open(API);
  return magasin.entrees.get(CLE_PAGE) || null;
}

test("sw — une navigation reussie GARDE la page, dans le cache de donnees", async () => {
  const sw = await semerPage();
  assert.ok(await pageGardee(sw), "la page n'a pas ete gardee");
});

test("sw — hors ligne, vers #livreur : la COPIE, marquee, avec ses en-tetes de securite", async () => {
  const sw = await semerPage();
  sw.couper();
  const r = await naviguer(sw, "/#livreur").reponse;
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("X-Sereo-Cache"), "copie");
  assert.equal(r.headers.get("Content-Security-Policy"), CSP, "la copie a perdu la CSP de la page");
  const html = await r.text();
  assert.match(html, /<html data-ouverte-hors-ligne="" lang="fr">/);
  assert.match(html, /id="livreur"/);
});

test("sw — hors ligne, ?ecran=livreur (navigateur qui ne transmet pas l'ancre) : la copie aussi", async () => {
  const sw = await semerPage();
  sw.couper();
  const r = await naviguer(sw, "/?ecran=livreur").reponse;
  assert.equal(r.headers.get("X-Sereo-Cache"), "copie");
});

test("sw — hors ligne, un AUTRE ecran : jamais l'application ; une page qui demande le reseau et mene a la tournee", async () => {
  const sw = await semerPage();
  sw.couper();
  for (const chemin of ["/", "/#stock", "/#journee", "/index.html#commandes", "/api/imports/archives/1/download"]) {
    const r = await naviguer(sw, chemin).reponse;
    assert.equal(r.headers.get("X-Sereo-Cache"), "hors-ligne", chemin);
    const html = await r.text();
    assert.doesNotMatch(html, /id="livreur"/, `${chemin} : l'application a ete servie`);
    assert.match(html, /cet écran demande le réseau/, chemin);
    assert.match(html, /href="\/\?ecran=livreur#livreur"/, `${chemin} : pas de chemin vers la tournee`);
    assert.match(r.headers.get("Content-Security-Policy") || "", /default-src 'none'/);
  }
});

test("sw — session EXPIREE pendant la coupure : rien ne se rouvre, et la page est oubliee", async () => {
  const sw = await semerPage({ fin: Date.now() + 150 });
  assert.ok(await pageGardee(sw), "prealable : la page n'a pas ete gardee");
  await attendre(200);
  sw.couper();
  const r = await naviguer(sw, "/#livreur").reponse;
  assert.equal(r.headers.get("X-Sereo-Cache"), "hors-ligne");
  const html = await r.text();
  assert.match(html, /Séréo demande le réseau pour s’ouvrir/);
  assert.doesNotMatch(html, /Ouvrir la tournée/, "session expiree, le chemin vers la tournee est propose");
  assert.equal(await pageGardee(sw), null, "la page d'une session expiree reste gardee");
});

test("sw — la page d'une AUTRE version (shell) n'est pas rendue : ses scripts ne seraient pas les siens", async () => {
  const sw = await semerPage({ shell: "sereo-shell-ancienne-version" });
  assert.ok(await pageGardee(sw), "prealable : la page n'a pas ete gardee");
  sw.couper();
  const r = await naviguer(sw, "/#livreur").reponse;
  assert.equal(r.headers.get("X-Sereo-Cache"), "hors-ligne");
});

test("sw — la page de CONNEXION (fin « 0 ») vide le cache de donnees : page et donnees", async () => {
  const sw = await semerPage();
  const magasin = await sw.caches.open(API);
  await magasin.put(ORIGINE + "/api/routes", new Response("[]"));
  sw.reseau(() => Promise.resolve(pageServeur({ fin: 0, shell: null, html: "<html><form action=\"/login\"></form></html>" })));
  const { reponse, attentes } = naviguer(sw, "/#livreur");
  await reponse;
  await Promise.all(attentes);
  assert.equal(sw.magasins.has(API), false, "la session est finie, mais sa page et ses donnees restent");
  sw.couper();
  const r = await naviguer(sw, "/#livreur").reponse;
  assert.equal(r.headers.get("X-Sereo-Cache"), "hors-ligne");
});

test("sw — sans en-tete de session (acces Basic) : ni gardee, ni oubliee", async () => {
  const sw = await semerPage();
  const avant = await pageGardee(sw);
  sw.reseau(() => Promise.resolve(pageServeur({ fin: null, html: "<html>autre</html>" })));
  const { reponse, attentes } = naviguer(sw, "/");
  await reponse;
  await Promise.all(attentes);
  assert.equal(await pageGardee(sw), avant, "une page sans fin de session a remplace la copie");
  // Et sur un service worker neuf, elle ne se garde pas.
  const neuf = chargerServiceWorker(() => Promise.resolve(pageServeur({ fin: null })));
  const n = naviguer(neuf, "/");
  await n.reponse;
  await Promise.all(n.attentes);
  assert.equal(await pageGardee(neuf), null);
});

test("sw — une page en erreur ou redirigee n'est pas gardee", async () => {
  for (const faire of [
    () => pageServeur({ status: 500 }),
    () => { const r = pageServeur(); Object.defineProperty(r, "redirected", { value: true }); return r; }
  ]) {
    const sw = chargerServiceWorker(() => Promise.resolve(faire()));
    const { reponse, attentes } = naviguer(sw, "/");
    await reponse;
    await Promise.all(attentes);
    assert.equal(await pageGardee(sw), null);
  }
});

test("sw — reseau MUET vers la tournee : la copie au bout du delai ; un autre ecran, lui, attend le reseau", async () => {
  const sw = await semerPage();
  sw.reseau(() => new Promise(() => {}));
  const tournee = naviguer(sw, "/#livreur").reponse;
  const r = await Promise.race([tournee, attendre(1000).then(() => null)]);
  assert.ok(r, "reseau muet : la tournee ne s'ouvre pas");
  assert.equal(r.headers.get("X-Sereo-Cache"), "copie");
  const autre = naviguer(sw, "/#stock").reponse;
  const rien = await Promise.race([autre.then(() => "repondu"), attendre(300).then(() => "attend")]);
  assert.equal(rien, "attend", "un autre ecran a ete servi depuis le cache sur un reseau lent");
});

test("sw — passerelle en erreur (502/503/504) vers la tournee : la copie ; sans copie, la reponse telle quelle", async () => {
  for (const status of [502, 503, 504]) {
    const sw = await semerPage();
    sw.reseau(() => Promise.resolve(new Response("Bad Gateway", { status })));
    const r = await naviguer(sw, "/#livreur").reponse;
    assert.equal(r.headers.get("X-Sereo-Cache"), "copie", String(status));
  }
  const vide = chargerServiceWorker(() => Promise.resolve(new Response("Bad Gateway", { status: 502 })));
  const r = await naviguer(vide, "/#livreur").reponse;
  assert.equal(r.status, 502);
});

test("sw — en ligne, la tournee vient du RESEAU, jamais de la copie", async () => {
  const sw = await semerPage();
  sw.reseau(() => Promise.resolve(pageServeur({ html: "<html>fraiche</html>" })));
  const r = await naviguer(sw, "/#livreur").reponse;
  assert.equal(r.headers.get("X-Sereo-Cache"), null);
  assert.equal(await r.text(), "<html>fraiche</html>");
});

test("sw — la deconnexion (POST /logout) emporte la page gardee", async () => {
  const sw = await semerPage();
  const attentes = [];
  sw.ecouteurs.fetch({
    request: { url: ORIGINE + "/logout", method: "POST", mode: "navigate", headers: new Headers() },
    respondWith() { throw new Error("la deconnexion ne doit pas etre servie par le service worker"); },
    waitUntil(p) { attentes.push(p); }
  });
  await Promise.all(attentes);
  assert.equal(sw.magasins.has(API), false);
});

// --- Le serveur : la fin de session annoncee --------------------------------

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-hors-ligne-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(racine, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(racine, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(racine, "imports");
process.env.SEREO_BACKUP_DIR = path.join(racine, "data", "backups");
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_AUTH_USER = "admin-hors-ligne";
process.env.SEREO_AUTH_PASSWORD = "mot-de-passe-hors-ligne-long";
const { app, closeStorage, _createAccessSessionValueForTest } = require("../server");

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

const DOUZE_HEURES = 12 * 60 * 60 * 1000;
const cookie = emission => `sereo_access=${encodeURIComponent(_createAccessSessionValueForTest(emission))}`;

test("serveur — la page annonce la fin de SA session (emission + 12 h), y compris sur un 304", async () => {
  const emission = Date.now() - 3 * 3600e3;
  for (const chemin of ["/", "/index.html"]) {
    const page = await fetch(base + chemin, { headers: { cookie: cookie(emission) } });
    assert.equal(page.status, 200, chemin);
    assert.match(await page.text(), /id="livreur"/, `${chemin} : ce n'est pas la page de l'application`);
    assert.equal(page.headers.get("x-sereo-session-fin"), String(emission + DOUZE_HEURES), chemin);
    // Le navigateur revalide la page (If-None-Match) et REMPLACE les en-tetes
    // gardes par ceux du 304 : sans l'en-tete sur le 304, la copie porterait
    // la fin de la session precedente. (Par node:http : `fetch` ajoute
    // Cache-Control: no-cache a une requete conditionnelle, et le serveur rend
    // alors 200.)
    const etag = page.headers.get("etag");
    assert.ok(etag, `${chemin} : pas d'ETag, pas de revalidation a juger`);
    const revalidee = await new Promise((resolve, reject) => {
      require("node:http").get(base + chemin, { headers: { cookie: cookie(emission + 1000), "if-none-match": etag } }, r => {
        r.resume();
        r.on("end", () => resolve(r));
      }).on("error", reject);
    });
    assert.equal(revalidee.statusCode, 304, chemin);
    assert.equal(revalidee.headers["x-sereo-session-fin"], String(emission + 1000 + DOUZE_HEURES),
      `${chemin} : un 304 garderait la fin de la session precedente`);
  }
  const css = await fetch(base + "/css/style.css", { headers: { cookie: cookie(emission) } });
  assert.equal(css.headers.get("x-sereo-session-fin"), null, "ce n'est pas une page");
});

test("serveur — sans session (ou expiree), la page de connexion annonce « 0 »", async () => {
  const anonyme = await fetch(base + "/", { redirect: "manual" });
  assert.match(await anonyme.text(), /action="\/login"/);
  assert.equal(anonyme.headers.get("x-sereo-session-fin"), "0");
  const expiree = await fetch(base + "/", { headers: { cookie: cookie(Date.now() - DOUZE_HEURES - 60e3) } });
  assert.match(await expiree.text(), /action="\/login"/);
  assert.equal(expiree.headers.get("x-sereo-session-fin"), "0");
});

test("serveur — acces par l'en-tete Basic, sans cookie : aucune fin annoncee", async () => {
  const basic = "Basic " + Buffer.from("admin-hors-ligne:mot-de-passe-hors-ligne-long").toString("base64");
  const page = await fetch(base + "/", { headers: { authorization: basic } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="livreur"/);
  assert.equal(page.headers.get("x-sereo-session-fin"), null);
});

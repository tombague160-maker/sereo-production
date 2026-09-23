// Le service worker et les donnees de l'API : la reponse TARDIVE, et le mode
// FRAIS apres une ecriture (lot 1 de l'audit geo, H4).
//
// LE DEFAUT, mesure par l'audit (banc navigateur, 250 tournees d'historique) :
// « Livre » est enregistre (200), puis le rechargement depasse 3 s ; le service
// worker rend sa copie d'avant le geste, et JETTE la reponse fraiche arrivee
// ensuite (`if (settled) return;`), sans la mettre en cache. L'arret livre
// reapparait « En livraison », et la copie ne se rafraichit plus jamais tant
// que le reseau met plus de 3 s.
//
// CE QUE CE BANC MESURE, ET CE QU'IL NE MESURE PAS. Il execute le VRAI fichier
// public/service-worker.js dans un bac a sable, avec des doublures de `fetch`,
// `caches` et `clients`. Les minuteries sont accelerees 100 fois (le repli de
// 3 s dure 30 ms). Il juge la LOGIQUE du service worker ; l'e2e
// test/e2e/livreur-ne-perd-rien.spec.js juge la page qui s'en sert, dans un
// vrai navigateur.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "service-worker.js"), "utf8");
const ORIGINE = "http://sereo.test";
const ACCELERATION = 100;

function attendre(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Charge le service worker. `reseau(url, request)` rend une promesse de Response. */
function chargerServiceWorker(reseau) {
  const magasins = new Map();
  const messages = [];
  const ecouteurs = {};
  const faireMagasin = () => {
    const entrees = new Map();
    return {
      entrees,
      async match(requete) {
        const url = new URL(typeof requete === "string" ? requete : requete.url, ORIGINE).href;
        const r = entrees.get(url);
        return r ? r.clone() : undefined;
      },
      async put(requete, reponse) {
        entrees.set(new URL(typeof requete === "string" ? requete : requete.url, ORIGINE).href, reponse);
      },
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
    clients: {
      claim: async () => {},
      get: async id => (id === "page-1" ? { postMessage: m => messages.push(m) } : undefined)
    },
    registration: { update: async () => {} }
  };
  const bac = {
    self, caches, console, URL, Headers, Request, Response, Promise, Date, Set, Map, Error,
    fetch: requete => reseau(requete.url, requete),
    setTimeout: (f, ms) => setTimeout(f, ms / ACCELERATION),
    clearTimeout
  };
  vm.createContext(bac);
  vm.runInContext(SOURCE, bac);
  return { ecouteurs, caches, messages };
}

/** Envoie un GET a l'API par le service worker. Rend { reponse, attentes }. */
function demander(sw, chemin, entetes = {}) {
  const attentes = [];
  let reponse = null;
  const evenement = {
    request: new Request(ORIGINE + chemin, { headers: entetes }),
    clientId: "page-1",
    respondWith(p) { reponse = p; },
    waitUntil(p) { attentes.push(p); }
  };
  sw.ecouteurs.fetch(evenement);
  assert.ok(reponse, "le service worker n'a pas repondu a une requete d'API");
  return { reponse, attentes };
}

async function semerCopie(sw, chemin, corps) {
  const magasin = await sw.caches.open("sereo-api-20260514");
  await magasin.put(ORIGINE + chemin, new Response(JSON.stringify(corps), { headers: { "Content-Type": "application/json" } }));
}

async function lireCopie(sw, chemin) {
  const magasin = await sw.caches.open("sereo-api-20260514");
  const r = await magasin.match(ORIGINE + chemin);
  return r ? r.json() : null;
}

/** Un reseau qui repond `corps` apres `ms` (temps reel), ou echoue. */
function reseauLent(ms, corps, { echoue = false } = {}) {
  return () => new Promise((resolve, reject) => setTimeout(() => {
    if (echoue) { reject(new TypeError("Failed to fetch")); return; }
    const r = new Response(JSON.stringify(corps), { status: 200, headers: { "Content-Type": "application/json" } });
    // Une reponse du meme site : le service worker ne met en cache que celles-la.
    Object.defineProperty(r, "type", { value: "basic" });
    resolve(r);
  }, ms));
}

// Le repli tombe a 30 ms ; le reseau repond a 120 ms : une reponse TARDIVE.
const RESEAU_MS = 120;

test("sw — temoin : sans en-tete, un reseau lent rend la COPIE, marquee", async () => {
  // Sans ce temoin, le cas « frais » passerait aussi avec un repli jamais pris.
  const sw = chargerServiceWorker(reseauLent(RESEAU_MS, { arret: "livre" }));
  await semerCopie(sw, "/api/routes", { arret: "en_livraison" });
  const { reponse } = demander(sw, "/api/routes");
  const r = await reponse;
  assert.equal(r.headers.get("X-Sereo-Cache"), "copie");
  assert.deepEqual(await r.json(), { arret: "en_livraison" });
});

test("sw — la reponse TARDIVE met la copie a jour, et la page en est prevenue", async () => {
  const sw = chargerServiceWorker(reseauLent(RESEAU_MS, { arret: "livre" }));
  await semerCopie(sw, "/api/routes", { arret: "en_livraison" });
  const { reponse, attentes } = demander(sw, "/api/routes");
  await reponse;
  await Promise.all(attentes);
  await attendre(20);
  assert.deepEqual(await lireCopie(sw, "/api/routes"), { arret: "livre" },
    "la reponse arrivee apres le repli a ete jetee : la copie restera perimee");
  assert.equal(sw.messages.length, 1, "la page n'apprend pas que des donnees fraiches sont arrivees");
  assert.equal(sw.messages[0].type, "sereo-api-tardive");
  assert.equal(new URL(sw.messages[0].url).pathname, "/api/routes");
  assert.ok(Number.isFinite(sw.messages[0].debut), "sans l'heure de depart, la page ne peut pas ecarter une reponse d'avant son geste");
});

test("sw — apres une ecriture (X-Sereo-Frais), JAMAIS la copie : on attend le reseau", async () => {
  const sw = chargerServiceWorker(reseauLent(RESEAU_MS, { arret: "livre" }));
  await semerCopie(sw, "/api/routes", { arret: "en_livraison" });
  const { reponse } = demander(sw, "/api/routes", { "X-Sereo-Frais": "1" });
  const r = await reponse;
  assert.equal(r.headers.get("X-Sereo-Cache"), null, "la copie d'avant le geste a ete servie comme donnee");
  assert.deepEqual(await r.json(), { arret: "livre" });
});

test("sw — apres une ecriture, un reseau en panne reste un ECHEC, pas une copie", async () => {
  const sw = chargerServiceWorker(reseauLent(RESEAU_MS, null, { echoue: true }));
  await semerCopie(sw, "/api/routes", { arret: "en_livraison" });
  const { reponse } = demander(sw, "/api/routes", { "X-Sereo-Frais": "1" });
  await assert.rejects(reponse, /Failed to fetch/, "la copie d'avant le geste a ete servie");
});

// Relecture adverse du lot 1 : une reponse TARDIVE rangeait l'etat d'avant le
// geste PAR-DESSUS la reponse fraiche d'une requete partie apres elle.
function reseauScripte(etapes) {
  let i = 0;
  return () => {
    const { ms, corps } = etapes[Math.min(i++, etapes.length - 1)];
    return reseauLent(ms, corps)();
  };
}

test("sw — une reponse tardive ne range JAMAIS un etat plus vieux que la copie", async () => {
  // L1 part avant « Livre » (reponse a 250 ms) ; L2, frais, part apres et
  // repond a 20 ms. La reponse de L1 arrive la derniere.
  const sw = chargerServiceWorker(reseauScripte([
    { ms: 250, corps: { arret: "en_livraison" } },
    { ms: 20, corps: { arret: "livre" } }
  ]));
  await semerCopie(sw, "/api/routes", { arret: "en_livraison" });
  const l1 = demander(sw, "/api/routes");
  await attendre(60);                        // le repli de L1 est pris (30 ms)
  const l2 = demander(sw, "/api/routes", { "X-Sereo-Frais": "1" });
  assert.deepEqual(await (await l2.reponse).json(), { arret: "livre" }, "prealable : L2 rend l'etat d'apres le geste");
  await attendre(20);
  assert.deepEqual(await lireCopie(sw, "/api/routes"), { arret: "livre" }, "prealable : L2 a range l'etat d'apres le geste");
  await Promise.all([...l1.attentes, ...l2.attentes]);
  await attendre(20);
  assert.deepEqual(await lireCopie(sw, "/api/routes"), { arret: "livre" },
    "la reponse tardive de L1 a ecrase la copie : l'arret livre reapparaitra « En livraison »");
  assert.equal(sw.messages.length, 0, "une reponse perimee a ete annoncee a la page");
});

test("sw — temoin : une reponse tardive SANS requete plus recente est bien rangee", async () => {
  const sw = chargerServiceWorker(reseauScripte([{ ms: 150, corps: { arret: "livre" } }]));
  await semerCopie(sw, "/api/routes", { arret: "en_livraison" });
  const l1 = demander(sw, "/api/routes");
  await l1.reponse;
  await Promise.all(l1.attentes);
  await attendre(20);
  assert.deepEqual(await lireCopie(sw, "/api/routes"), { arret: "livre" });
});

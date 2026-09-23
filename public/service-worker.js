// CACHE_NAME n'est plus a bumper a la main (lot « chargement instantane »,
// 23/09). Les ressources statiques sont servies DEPUIS LE CACHE D'ABORD, puis
// revalidees en arriere-plan (stale-while-revalidate). Pour qu'une page neuve
// ne tourne jamais sur un vieux script, le nom du shell doit changer a chaque
// livraison qui touche un fichier statique. Il change seul :
//  - server.js NE SERT PAS ce fichier tel quel : il y remplace CACHE_NAME par
//    CACHE_NAME suivi de l'empreinte du contenu de public/ et de Leaflet
//    (lib/empreinte-shell.js), et annonce ce meme nom dans l'en-tete
//    X-Sereo-Shell de la page.
//  - Un octet change dans public/ : le nom change, le navigateur voit un
//    nouveau service worker et l'installe ; l'ancien, lui, voit que la page est
//    plus recente que lui et sert CE chargement-la par le reseau.
// Bumper la valeur ci-dessous reste permis (le nom change aussi), jamais requis.
// Seule exception connue : le navigateur arrete le service worker entre la page
// et ses fichiers (voir clientsEnRetard) ; ce chargement-la prend alors le
// cache, et le suivant la nouvelle version.
const CACHE_NAME = "sereo-shell-20260923-instantane";
const API_CACHE_NAME = "sereo-api-20260514";
const APP_SHELL = [
  "/css/style.css",
  "/js/app.js",
  "/js/operations.js",
  "/js/anti-fart.js",
  // Modules ES importes par app.js. Ils DOIVENT figurer ici : un import non
  // pre-cache fait echouer le chargement complet du module en mode hors ligne,
  // et l'application reste sur une page blanche sans message d'erreur.
  // (file-attente.js manquait : importe par app.js depuis la file hors ligne,
  //  il n'etait mis en cache qu'au premier passage en ligne.)
  "/js/utils/dom.js",
  "/js/utils/text.js",
  "/js/utils/address.js",
  "/js/utils/file-attente.js",
  "/js/config/themes.js",
  "/js/config/tabs.js",
  "/js/domains/comptes.js",
  "/js/domains/adresses.js",
  "/js/domains/tournee-pratique.js",
  // Les quatre graisses du premier rendu (prechargees par index.html).
  "/fonts/poppins-400-latin.woff2",
  "/fonts/poppins-500-latin.woff2",
  "/fonts/poppins-600-latin.woff2",
  "/fonts/poppins-700-latin.woff2",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/manifest.webmanifest",
  "/brand/sereo-logo.svg",
  "/brand/sereo-mark.svg",
  "/brand/sereo-sidebar-bg.svg",
  "/vendor/leaflet/leaflet.css",
  "/vendor/leaflet/leaflet.js"
];

// Endpoints /api/ a NE PAS cacher (auth-sensible, etat session, sante).
// /api/version : ne PAS cacher cote SW, sinon apres un auto-deploy le chip
// version reste sur l'ancienne valeur tant que le SW sert le cache.
// Le serveur envoie deja Cache-Control: no-store pour la couche HTTP.
// /api/me et /api/comptes : auth-sensibles. Contrairement a /api/version, le
// serveur ne pose PAS Cache-Control: no-store dessus. Sans exclusion ici, la
// strategie network-first resservirait une identite ou une liste de comptes
// perimee apres un changement de role ou une deconnexion — panne discrete et
// difficile a diagnostiquer.
//
// /api/operations et /api/subscriptions SORTENT de la liste le 23/09. Ils
// portent les chiffres du tableau de bord : sans eux, rien ne s'affiche avant
// le reseau. Ils ne dependent pas de l'utilisateur (server.js et
// lib/operations-api.js ne lisent aucune identite pour les calculer, comme
// /api/orders, deja en cache), et la panne discrete que leur exclusion evitait
// -- une copie perimee montree comme fraiche -- est desormais tenue autrement :
// toute reponse rendue par le cache porte l'en-tete X-Sereo-Cache, et la page
// ne dit alors jamais « A jour ».
const API_CACHE_EXCLUDED = [
  "/api/storage/status",
  "/api/version",
  "/api/me",
  "/api/comptes",
  "/api/geocode"
];

// Network-first avec timeout puis fallback cache pour les GET /api/*.
// Cible : reseau ok -> donnees fraiches, reseau lent/coupe -> derniere version connue.
const API_NETWORK_TIMEOUT_MS = 3000;

// Les pages ouvertes dont le HTML annonce un AUTRE shell que ce service worker
// (en-tete X-Sereo-Shell). Leurs fichiers statiques passent par le reseau
// d'abord, comme avant le 23/09. En memoire seulement : si le navigateur arrete
// le service worker entre la page et ses fichiers, on retombe sur le cache
// d'abord pour ce chargement -- le cas « sans bump » ci-dessus, jamais pire.
const clientsEnRetard = new Set();

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  const validCaches = new Set([CACHE_NAME, API_CACHE_NAME]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => !validCaches.has(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isApiCacheable(url) {
  if (!url.pathname.startsWith("/api/")) return false;
  return !API_CACHE_EXCLUDED.includes(url.pathname);
}

// Une copie du cache n'est jamais rendue telle quelle : elle porte
// X-Sereo-Cache, pour que la page sache qu'elle n'est pas fraiche.
function marquerCommeCopie(cached) {
  const headers = new Headers(cached.headers);
  headers.set("X-Sereo-Cache", "copie");
  return cached.blob().then(body => new Response(body, {
    status: cached.status,
    statusText: cached.statusText,
    headers
  }));
}

function copieEnCache(request) {
  return caches.open(API_CACHE_NAME)
    .then(cache => cache.match(request))
    .then(cached => (cached ? marquerCommeCopie(cached) : undefined));
}

// Strategie network-first avec timeout pour /api/* GET :
// - Tente fetch (max 3s)
// - Si reponse 200 OK same-origin : la cache + la retourne
// - Si timeout / erreur reseau : retourne le cache (marque) si dispo, sinon laisse passer l'erreur
//
// Lot 1 de l'audit geo (H4), 23/09 :
// - LA REPONSE TARDIVE (arrivee apres le repli de 3 s) est mise en cache et
//   annoncee a la page (« sereo-api-tardive »), qui remplace la copie a
//   l'ecran. Avant, `if (settled) return;` la jetait : la copie ne se
//   rafraichissait plus tant que le reseau mettait plus de 3 s -- et avec un
//   an d'historique, il les met a chaque fois.
// - X-Sereo-Frais : la page vient d'ecrire ; la copie date d'avant le geste.
//   Pas de repli : on attend le reseau, et son echec reste un echec (la page
//   garde alors ce qu'elle montre).
// LA COPIE NE RECULE PAS (relecture adverse du lot 1). Deux chargements de la
// meme adresse se croisent sur un reseau lent : L1 part avant « Livre », L2
// (frais) apres. Si la reponse de L1 arrive la derniere, `cache.put` rangeait
// l'etat d'AVANT le geste par-dessus celui d'apres -- et la copie servie a la
// prochaine ouverture remontrait l'arret « En livraison ». Chaque requete prend
// un numero d'ordre ; une reponse ne se range que si aucune requete partie
// APRES elle n'a deja range la sienne. (En memoire : un service worker
// redemarre n'a plus de requete en vol a comparer.)
let numeroDeRequete = 0;
const rangements = new Map();
// Integration des lots 1 et 5 (23/09). Depuis le lot 5, aucune lecture ne suit
// un geste d'arret : la PAGE recopie elle-meme dans ce cache ce que l'ecran
// montre (recopierApresGeste, app.js). Cette recopie n'est pas une requete :
// la garde ci-dessus ne la voyait pas, et la reponse d'un chargement parti
// AVANT le geste, arrivee apres, rangeait l'etat d'avant par-dessus. La page
// annonce donc chaque ecriture (« sereo-ecriture », au depart de l'ecriture) :
// une requete partie avant ne range plus rien -- la meme regle que la page
// applique a l'ecran (message.debut < derniereEcritureA). Ce qu'elle aurait
// range est au mieux l'etat d'avant le geste ; le rechargement frais qui suit
// une ecriture (X-Sereo-Frais) rangera le suivant.
let barriereEcriture = 0;

self.addEventListener("message", event => {
  const message = event.data;
  if (message && message.type === "sereo-ecriture") barriereEcriture = ++numeroDeRequete;
});

function rangerSiPlusRecente(url, numero, request, copy) {
  if (numero < barriereEcriture) return Promise.resolve(false);
  if ((rangements.get(url) || 0) > numero) return Promise.resolve(false);
  rangements.set(url, numero);
  return caches.open(API_CACHE_NAME).then(cache => cache.put(request, copy)).then(() => true);
}

function networkFirstApi(event) {
  const { request } = event;
  const frais = request.headers.get("X-Sereo-Frais") === "1";
  const debut = Date.now();
  const numero = ++numeroDeRequete;
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeoutId = frais ? null : setTimeout(() => {
      if (settled) return;
      settled = true;
      copieEnCache(request).then(cached => {
        if (cached) resolve(cached);
        else reject(new Error("Network timeout, no cache"));
      });
    }, API_NETWORK_TIMEOUT_MS);

    const reseau = fetch(request).then(response => {
      const tardive = settled;
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        const miseEnCache = rangerSiPlusRecente(request.url, numero, request, copy);
        // Perimee (une requete plus recente a deja range) : ni rangee, ni annoncee.
        if (tardive) return miseEnCache.then(rangee => (rangee ? annoncerReponseTardive(event, request.url, debut) : undefined));
      }
      if (tardive) return undefined;
      settled = true;
      clearTimeout(timeoutId);
      resolve(response);
      return undefined;
    }).catch(error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (frais) {
        reject(error);
        return;
      }
      copieEnCache(request).then(cached => {
        if (cached) resolve(cached);
        else reject(error);
      });
    });
    // Le service worker doit vivre jusqu'a la reponse tardive, meme si la page
    // a deja recu la copie.
    event.waitUntil(reseau.catch(() => {}));
  });
}

function annoncerReponseTardive(event, url, debut) {
  const id = event.clientId || event.resultingClientId;
  if (!id) return undefined;
  return self.clients.get(id).then(client => {
    if (client) client.postMessage({ type: "sereo-api-tardive", url, debut });
  });
}

// Ressources statiques : le cache d'abord, revalide en arriere-plan
// (stale-while-revalidate). Sans copie, le reseau, mis en cache au passage.
function cacheDabord(event) {
  const { request } = event;
  const reseau = fetch(request).then(response => {
    if (!response.ok || response.type !== "basic") return response;
    const copy = response.clone();
    return caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).then(() => response);
  });
  // La revalidation doit finir meme si la page a deja sa reponse ; son echec
  // (hors ligne) n'est pas une erreur quand le cache a repondu.
  event.waitUntil(reseau.catch(() => {}));
  return caches.open(CACHE_NAME)
    .then(cache => cache.match(request))
    .then(cached => cached || reseau);
}

// L'ancienne strategie, gardee pour une page plus recente que ce service worker.
function reseauDabord(request) {
  return fetch(request).then(response => {
    if (!response.ok || response.type !== "basic") return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    return response;
  }).catch(() => caches.match(request));
}

// La navigation passe au reseau, SANS cache : c'est elle qui porte le controle
// de session (sans session, le serveur rend la page de connexion). On lit
// seulement l'en-tete X-Sereo-Shell de la reponse.
function naviguer(event) {
  return fetch(event.request).then(response => {
    const shell = response.headers.get("X-Sereo-Shell");
    if (shell && shell !== CACHE_NAME && event.resultingClientId) {
      if (clientsEnRetard.size > 50) clientsEnRetard.clear();
      clientsEnRetard.add(event.resultingClientId);
      // La nouvelle version existe : on la demande tout de suite.
      self.registration.update().catch(() => {});
    }
    return response;
  });
}

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // Deconnexion : le cache de donnees part avec la session. La requete elle-meme
  // continue sans le service worker ; seul l'effacement est ajoute.
  if (request.method === "POST" && url.pathname === "/logout") {
    event.waitUntil(caches.delete(API_CACHE_NAME));
    return;
  }

  // Ignore tout sauf GET (POST/PATCH/DELETE laisses passer)
  if (request.method !== "GET") return;

  // Endpoint /login : pas de cache (auth-sensible), pas de passage par ici.
  if (url.pathname.startsWith("/login")) return;

  // Pages HTML : reseau, jamais de cache (voir naviguer()).
  if (request.mode === "navigate") {
    event.respondWith(naviguer(event));
    return;
  }

  // Endpoints /api/* exclus du cache : on laisse passer au navigateur sans
  // toucher au SW (le serveur gere via Cache-Control: no-store).
  // Sinon ils seraient caches par le handler "ressources statiques" en bas.
  if (url.pathname.startsWith("/api/") && !isApiCacheable(url)) {
    return;
  }

  // Endpoints /api/* cacheables : strategie network-first avec timeout +
  // fallback cache. Permet une consultation offline des dernieres donnees.
  // (L'affichage IMMEDIAT des dernieres donnees au demarrage est fait par la
  //  page elle-meme, qui lit ce cache : voir lireDernieresDonnees dans app.js.)
  if (isApiCacheable(url)) {
    event.respondWith(networkFirstApi(event));
    return;
  }

  // Autres ressources statiques (CSS, JS, polices, icones, leaflet) : le cache
  // d'abord, sauf pour une page plus recente que ce service worker.
  if (clientsEnRetard.has(event.clientId)) {
    event.respondWith(reseauDabord(request));
    return;
  }
  event.respondWith(cacheDabord(event));
});

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
  // Les dates et les heures (parcours simplifies, 24/09).
  "/js/utils/dates.js",
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
// /api/sauvegardes/derniere (24/09) : la base entiere, pour l'administrateur.
// Jamais une copie dans le cache de l'appareil.
// /api/journal (24/09) : reserve a l'administration, comme /api/comptes ; une
// copie en cache le rendrait hors ligne a un autre compte du meme appareil.
const API_CACHE_EXCLUDED = [
  "/api/storage/status",
  "/api/version",
  "/api/me",
  "/api/comptes",
  "/api/geocode",
  "/api/sauvegardes/derniere",
  "/api/journal"
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

// --- UN SHELL, UNE VERSION (chasse aux defauts, 25/09) ----------------------
//
// La page gardee pour la tournee et les fichiers qui la font demarrer doivent
// etre de la MEME version, et ranges ensemble. Trois chemins les melaient :
//  - une page plus recente que ce service worker (« en retard ») rangeait ses
//    fichiers neufs dans le cache de CETTE version (reseauDabord), et la
//    revalidation d'arriere-plan faisait de meme (cacheDabord) : l'ancienne
//    page gardee se serait rouverte sur de nouveaux scripts ;
//  - la page neuve REMPLACAIT la copie de l'ancienne, avant que son service
//    worker soit installe : coupe dans l'intervalle, la tournee ne se
//    rouvrait plus (« cet ecran demande le reseau ») ;
//  - l'installation rangeait ce que le serveur rendait AU MOMENT de
//    l'installation, quelle qu'en soit la version.
// Chaque fichier annonce sa version (X-Sereo-Shell-Fichier, server.js
// annoncerShell ; X-Sereo-Shell reste l'annonce de la PAGE) :
// n'entre dans ce cache que ce qui est de CETTE version. Un fichier sans
// annonce (serveur qui n'a pas pu calculer l'empreinte) est accepte, comme
// avant.
function duMemeShell(response) {
  const shell = response.headers.get("X-Sereo-Shell-Fichier");
  return !shell || shell === CACHE_NAME;
}

// L'installation : chaque fichier revalide aupres du serveur (« no-cache » :
// jamais une copie du cache HTTP, dont l'annonce serait celle d'avant), de
// cette version, et pas une redirection (session finie : la page de
// connexion n'est pas app.js). Un seul manque, et rien n'est range -- tout ou
// rien, comme cache.addAll : le navigateur reessaiera, et le service worker
// en place reste, complet. Chaque corps est lu DES son arrivee : une reponse
// non lue garde sa connexion, et avec six connexions par serveur, les
// fichiers suivants attendaient sans fin (mesure : installation figee sur
// trois fichiers, corps non compresses).
function prechargerShell() {
  return Promise.all(APP_SHELL.map(chemin => {
    const adresse = new URL(chemin, self.location.origin).href;
    return fetch(new Request(adresse, { cache: "no-cache" })).then(response => {
      if (!response.ok || response.redirected) throw new Error(`${chemin} : ${response.status}`);
      if (!duMemeShell(response)) throw new Error(`${chemin} : fichier d'une autre version`);
      return response.blob().then(corps => [adresse, new Response(corps, {
        status: response.status, statusText: response.statusText, headers: response.headers
      })]);
    });
  })).then(reponses => caches.open(CACHE_NAME)
    .then(cache => Promise.all(reponses.map(([adresse, response]) => cache.put(adresse, response)))));
}

self.addEventListener("install", event => {
  event.waitUntil(prechargerShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  const validCaches = new Set([CACHE_NAME, API_CACHE_NAME]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => !validCaches.has(key)).map(key => caches.delete(key))))
      .then(() => promouvoirPageSuivante())
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
    // D'une autre version (le serveur a ete mis a jour) : rendu, jamais range.
    if (!response.ok || response.type !== "basic" || !duMemeShell(response)) return response;
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
    // Les fichiers d'une page plus recente ne sont pas ceux de ce cache.
    if (!response.ok || response.type !== "basic" || !duMemeShell(response)) return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    return response;
  }).catch(() => caches.match(request));
}

// --- L'ECRAN TOURNEE SE ROUVRE SANS RESEAU (decision 4, 23/09) --------------
//
// Avant : la navigation passait au reseau, sans aucun repli. Un livreur qui
// fermait l'application en zone blanche (ou dont le telephone redemarrait) ne
// pouvait plus la rouvrir : page d'erreur du navigateur, tournee perdue
// jusqu'au retour du reseau (M10 de l'audit geo, arbitrage de DESIGN.md).
//
// Decision de Thomas : l'ecran Tournee, ET SEULEMENT LUI, se rouvre hors
// ligne. La navigation passe toujours au reseau d'abord : c'est elle qui porte
// le controle de session. Le HTML de l'application est garde a chaque
// navigation reussie, et rendu depuis le cache a UNE condition de chaque :
//  - la navigation vise l'ecran Tournee (#livreur, ou ?ecran=livreur, pour un
//    navigateur qui ne transmettrait pas l'ancre) ;
//  - le reseau a echoue (ou se tait depuis DELAI_NAVIGATION_TOURNEE_MS) ;
//  - une session VALIDE est connue : le serveur annonce sa fin dans l'en-tete
//    X-Sereo-Session-Fin de la page, et cette fin n'est pas passee ;
//  - la page gardee annonce le shell de CE service worker (sinon ses scripts,
//    servis par ce cache-ci, ne seraient pas les siens).
// La page gardee vit DANS le cache de donnees (API_CACHE_NAME) : elle part avec
// lui, a la deconnexion (POST /logout) comme a l'expiration de session (401,
// app.js). Et une navigation qui recoit la page de connexion (fin de session
// « 0 ») vide ce cache : la session est finie, ni la page ni ses donnees ne se
// rouvrent. Les autres ecrans, hors ligne, rendent une page qui le dit.
const CLE_PAGE_TOURNEE = "/__sereo/page-tournee";
// Reseau qui se tait (4G sans debit) : au-dela, la copie de la tournee. Defaut
// 5 s ; plage raisonnable 3 a 10 s (en dessous, un serveur lent au reveil
// ferait ouvrir la copie ; au-dessus, le livreur attend devant un ecran blanc).
const DELAI_NAVIGATION_TOURNEE_MS = 5000;

function versLaTournee(url) {
  if (url.pathname !== "/" && url.pathname !== "/index.html") return false;
  return url.hash === "#livreur" || url.searchParams.get("ecran") === "livreur";
}

/** La fin de session annoncee par une page (ms), ou null si elle n'en dit rien. */
function finDeSession(response) {
  const valeur = response.headers.get("X-Sereo-Session-Fin");
  if (valeur === null || valeur.trim() === "") return null;
  const fin = Number(valeur);
  return Number.isFinite(fin) ? fin : 0;
}

// La page d'une AUTRE version que ce service worker (la suivante, dont le
// service worker n'est pas encore installe) : gardee a part (25/09). Elle ne
// remplace pas la copie de CETTE version, dont les fichiers sont dans ce
// cache-ci ; son service worker la reprend en s'activant.
const CLE_PAGE_SUIVANTE = "/__sereo/page-tournee-suivante";

/** Garde la page, ou vide le cache de donnees si la session est finie. */
function retenirOuOublier(response) {
  const fin = finDeSession(response);
  if (fin === null) return Promise.resolve();
  if (!(fin > Date.now())) return caches.delete(API_CACHE_NAME);
  if (!response.ok || response.type !== "basic" || response.redirected) return Promise.resolve();
  const shell = response.headers.get("X-Sereo-Shell");
  if (!shell) return Promise.resolve();
  const copy = response.clone();
  return caches.open(API_CACHE_NAME).then(cache => {
    if (shell === CACHE_NAME) return cache.put(CLE_PAGE_TOURNEE, copy);
    // Une page d'une autre version : a part, tant que la copie de CETTE
    // version peut encore servir (sinon, rien a proteger : elle prend la place).
    return cache.match(CLE_PAGE_TOURNEE).then(actuelle => (
      actuelle && actuelle.headers.get("X-Sereo-Shell") === CACHE_NAME && finDeSession(actuelle) > Date.now()
        ? cache.put(CLE_PAGE_SUIVANTE, copy)
        : cache.put(CLE_PAGE_TOURNEE, copy)
    ));
  });
}

/** La page gardee, si elle peut etre rendue maintenant ; sinon null. */
function pageTourneeValide() {
  return caches.open(API_CACHE_NAME)
    .then(cache => {
      // La copie de cette version ; a defaut, la « suivante », si c'est la
      // sienne (gardee par l'ancien service worker juste avant l'activation).
      const lire = cle => cache.match(cle).then(page => {
        if (!page) return null;
        const fin = finDeSession(page);
        if (!(fin > Date.now())) {
          // Session finie pendant la coupure : la page ne se rouvrira plus.
          return cache.delete(cle).then(() => null);
        }
        return page.headers.get("X-Sereo-Shell") === CACHE_NAME ? page : null;
      });
      return lire(CLE_PAGE_TOURNEE).then(page => page || lire(CLE_PAGE_SUIVANTE));
    })
    .catch(() => null);
}

/** A l'activation : la page gardee pour CETTE version devient la copie. */
function promouvoirPageSuivante() {
  return caches.has(API_CACHE_NAME)
    .then(existe => (existe ? caches.open(API_CACHE_NAME) : null))
    .then(cache => cache && cache.match(CLE_PAGE_SUIVANTE).then(suivante => {
      if (!suivante || suivante.headers.get("X-Sereo-Shell") !== CACHE_NAME) return undefined;
      return cache.put(CLE_PAGE_TOURNEE, suivante).then(() => cache.delete(CLE_PAGE_SUIVANTE));
    }))
    .catch(() => {});
}

/** La page gardee, marquee : la page sait qu'elle s'ouvre sans reseau. */
function rendreCopieTournee(page) {
  const headers = new Headers(page.headers);
  for (const nom of ["Content-Length", "Content-Encoding", "ETag", "Last-Modified"]) headers.delete(nom);
  headers.set("X-Sereo-Cache", "copie");
  return page.text().then(html => new Response(
    html.replace(/<html\b/i, '<html data-ouverte-hors-ligne=""'),
    { status: 200, statusText: "OK", headers }
  ));
}

/** Hors ligne, un autre ecran : une page qui dit qu'il demande le reseau. */
function pageDemandeReseau(tourneeDisponible) {
  const lien = tourneeDisponible
    ? '<p>La tournée, elle, s’ouvre sans réseau.</p><a class="action" href="/?ecran=livreur#livreur">Ouvrir la tournée</a>'
    : '<p>Séréo demande le réseau pour s’ouvrir.</p>';
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hors ligne — Séréo</title>
<style>
:root { color-scheme: light dark; --fond: #fafaf8; --texte: #1f2a2e; --second: #4a5a5f; --action: #1d5e52; --sur-action: #ffffff; --focus: #1d5e52; }
@media (prefers-color-scheme: dark) { :root { --fond: #0d1518; --texte: #eef3f1; --second: #b8c6c2; --action: #8fd3c3; --sur-action: #0d1518; --focus: #8fd3c3; } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--fond); color: var(--texte); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 26rem; padding: 24px 16px; }
h1 { font-size: 1.35rem; margin: 0 0 8px; }
p { margin: 0 0 12px; color: var(--second); }
a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 20px; border-radius: 999px; background: var(--action); color: var(--sur-action); font-weight: 600; text-decoration: none; }
a:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
</style></head>
<body><main><h1>Hors ligne — cet écran demande le réseau</h1>${lien}</main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Sereo-Cache": "hors-ligne"
    }
  });
}

// La navigation passe au reseau d'abord : c'est elle qui porte le controle de
// session (sans session, le serveur rend la page de connexion). On lit
// l'en-tete X-Sereo-Shell de la reponse, et on garde (ou oublie) la page.
function naviguer(event) {
  const url = new URL(event.request.url);
  let garde = Promise.resolve();
  // Relecture adverse (23/09) : la page n'est « en retard » (ses fichiers par
  // le reseau) que si c'est la page RESEAU qui est rendue. Une copie deja
  // rendue (reseau lent, puis page d'une version plus recente) annonce le
  // shell de CE service worker : ses fichiers sont les siens, dans ce cache.
  // Sans cette garde, elle aurait mele son ancien HTML a de nouveaux scripts.
  let enRetard = false;
  const rendreReseau = response => {
    if (enRetard) {
      if (clientsEnRetard.size > 50) clientsEnRetard.clear();
      clientsEnRetard.add(event.resultingClientId);
    }
    return response;
  };
  const reseau = fetch(event.request).then(response => {
    const shell = response.headers.get("X-Sereo-Shell");
    if (shell && shell !== CACHE_NAME && event.resultingClientId) {
      enRetard = true;
      // La nouvelle version existe : on la demande tout de suite.
      self.registration.update().catch(() => {});
    }
    garde = retenirOuOublier(response).catch(() => {});
    return response;
  });
  // Le rangement doit finir meme si la copie a deja repondu (reseau lent).
  event.waitUntil(reseau.then(() => garde, () => {}));
  if (!versLaTournee(url)) {
    return reseau.then(rendreReseau, () => pageTourneeValide().then(page => pageDemandeReseau(Boolean(page))));
  }
  return new Promise(resolve => {
    let rendu = false;
    const rendre = reponse => { if (!rendu) { rendu = true; resolve(reponse); } };
    const repli = () => pageTourneeValide().then(page => (page ? rendreCopieTournee(page) : null));
    const minuteur = setTimeout(() => {
      repli().then(copie => { if (copie) rendre(copie); });
    }, DELAI_NAVIGATION_TOURNEE_MS);
    reseau.then(response => {
      clearTimeout(minuteur);
      // Passerelle en erreur (serveur arrete derriere le mandataire) : pour la
      // tournee, c'est un reseau absent, comme pour les gestes (lot 1, H1).
      if ([502, 503, 504].includes(response.status)) {
        repli().then(copie => rendre(copie || response));
        return;
      }
      // Rendue seulement si la copie ne l'a pas precedee (rendu).
      if (!rendu) rendre(rendreReseau(response));
    }, () => {
      clearTimeout(minuteur);
      repli().then(copie => rendre(copie || pageDemandeReseau(false)));
    });
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

  // La page de connexion ouverte DIRECTEMENT (favori /login) : jamais mise en
  // cache, mais si le serveur la rend (fin de session « 0 »), la copie de la
  // tournee et ses donnees partent, comme sur « / » (relecture adverse, 23/09).
  // Hors ligne, rien n'est vide : le livreur qui l'ouvre par erreur garde sa
  // tournee.
  if (request.mode === "navigate" && url.pathname === "/login") {
    const reseau = fetch(request);
    event.waitUntil(reseau.then(response => (finDeSession(response) === 0 ? caches.delete(API_CACHE_NAME) : undefined), () => {}));
    event.respondWith(reseau);
    return;
  }

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

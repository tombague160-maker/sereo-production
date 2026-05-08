const CACHE_NAME = "sereo-shell-20260506-offline-api";
const API_CACHE_NAME = "sereo-api-20260506";
const APP_SHELL = [
  "/css/style.css",
  "/js/app.js",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/brand/sereo-logo.svg",
  "/brand/sereo-mark.svg",
  "/brand/sereo-sidebar-bg.svg",
  "/vendor/leaflet/leaflet.css",
  "/vendor/leaflet/leaflet.js"
];

// Endpoints /api/ a NE PAS cacher (auth-sensible, etat session, sante).
const API_CACHE_EXCLUDED = ["/api/storage/status"];

// Network-first avec timeout puis fallback cache pour les GET /api/*.
// Cible : reseau ok -> donnees fraiches, reseau lent/coupe -> derniere version connue.
const API_NETWORK_TIMEOUT_MS = 3000;

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

// Strategie network-first avec timeout pour /api/* GET :
// - Tente fetch (max 3s)
// - Si reponse 200 OK same-origin : la cache + la retourne
// - Si timeout / erreur reseau : retourne le cache si dispo, sinon laisse passer l'erreur
function networkFirstApi(request) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      caches.match(request).then(cached => {
        if (cached) resolve(cached);
        else reject(new Error("Network timeout, no cache"));
      });
    }, API_NETWORK_TIMEOUT_MS);

    fetch(request).then(response => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(API_CACHE_NAME).then(cache => cache.put(request, copy));
      }
      resolve(response);
    }).catch(error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      caches.match(request).then(cached => {
        if (cached) resolve(cached);
        else reject(error);
      });
    });
  });
}

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore tout sauf GET same-origin (POST/PATCH/DELETE laisses passer)
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Pages HTML (mode navigate) et endpoint /login : pas de cache (auth-sensible).
  if (request.mode === "navigate" || url.pathname.startsWith("/login")) {
    return;
  }

  // Endpoints /api/* : strategie network-first avec timeout + fallback cache.
  // Permet une consultation offline des dernieres donnees connues.
  if (isApiCacheable(url)) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // Autres ressources statiques (assets, leaflet, etc.) : network-first
  // avec mise en cache au fur et a mesure, fallback cache si offline.
  event.respondWith(
    fetch(request).then(response => {
      if (!response.ok || response.type !== "basic") {
        return response;
      }
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request))
  );
});

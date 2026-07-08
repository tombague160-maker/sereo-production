const express = require("express");
const multer = require("multer");
const readXlsxFile = require("read-excel-file/node");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { createSqliteStore } = require("./storage/sqliteStore");

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.SEREO_HOST || process.env.HOST || "127.0.0.1";

// Chantier 2 (audit 2026-06-04) : detection de version multi-source pour
// gerer le cas ou release-please est en panne et que les tags sont poses
// manuellement (package.json reste figé). Priorite :
// 1. env var SEREO_APP_VERSION : posee par le wrapper sereo-updater
//    (`SEREO_APP_VERSION=$(git describe --tags --abbrev=0 | sed 's/^v//')`).
// 2. fichier VERSION a la racine : ecrit par un script de build/deploy
//    avec `git describe --tags --abbrev=0 > VERSION`. Tolere `v1.18.0` ou `1.18.0`.
// 3. package.json (legacy, valide quand release-please marche).
// 4. fallback "0.0.0" si tout echoue.
//
// Cache memoire process : se rafraichit au prochain redemarrage container.
const APP_VERSION = (() => {
  const normalize = v => String(v || "").trim().replace(/^v/i, "") || null;

  const envVersion = normalize(process.env.SEREO_APP_VERSION);
  if (envVersion) return envVersion;

  try {
    const fileVersion = normalize(require("fs").readFileSync("./VERSION", "utf8"));
    if (fileVersion) return fileVersion;
  } catch (e) { /* fichier absent : tomber sur package.json */ }

  try {
    const pkgVersion = normalize(require("./package.json").version);
    if (pkgVersion) return pkgVersion;
  } catch (e) { /* impossible : tomber sur 0.0.0 */ }

  return "0.0.0";
})();
const GITHUB_REPO = "tombague160-maker/sereo-production";

// Cache memoire des release notes recuperees depuis l'API GitHub.
// Pour eviter de rappeler GitHub a chaque /api/version (rate limit 60/h
// pour requetes anonymes), on cache 1h apres le 1er fetch reussi.
let releaseNotesCache = null;
let releaseNotesCacheAt = 0;
const RELEASE_NOTES_CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchReleaseNotes(version) {
  const now = Date.now();
  if (releaseNotesCache && releaseNotesCache.version === version
      && now - releaseNotesCacheAt < RELEASE_NOTES_CACHE_TTL_MS) {
    return releaseNotesCache;
  }
  const fallbackUrl = `https://github.com/${GITHUB_REPO}/releases/tag/v${version}`;
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/v${version}`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "sereo-app"
      }
    });
    if (!response.ok) {
      const cache = {
        version,
        releaseUrl: fallbackUrl,
        releaseName: `v${version}`,
        publishedAt: "",
        pourToi: "",
        fullNotes: "",
        fetchedAt: new Date().toISOString(),
        fetchError: `HTTP ${response.status}`
      };
      releaseNotesCache = cache;
      releaseNotesCacheAt = now;
      return cache;
    }
    const data = await response.json();
    const body = String(data.body || "");
    // Extrait la section "## 🎁 Pour toi" jusqu'au prochain ## (ou EOF).
    // Si la section n'existe pas, on tombe en fallback sur les notes completes.
    const match = body.match(/^##\s*🎁\s*Pour toi\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
    const pourToi = match ? match[1].trim() : "";
    const cache = {
      version,
      releaseUrl: data.html_url || fallbackUrl,
      releaseName: data.name || `v${version}`,
      publishedAt: data.published_at || "",
      pourToi,
      fullNotes: body,
      fetchedAt: new Date().toISOString(),
      fetchError: null
    };
    releaseNotesCache = cache;
    releaseNotesCacheAt = now;
    return cache;
  } catch (e) {
    const cache = {
      version,
      releaseUrl: fallbackUrl,
      releaseName: `v${version}`,
      publishedAt: "",
      pourToi: "",
      fullNotes: "",
      fetchedAt: new Date().toISOString(),
      fetchError: e.message || "fetch error"
    };
    releaseNotesCache = cache;
    releaseNotesCacheAt = now;
    return cache;
  }
}

const DB_PATH = path.resolve(process.env.SEREO_DB_PATH || path.join(__dirname, "data", "db.json"));
const STORAGE_ENGINE = (process.env.SEREO_STORAGE || "sqlite").toLowerCase();
const SQLITE_PATH = path.resolve(process.env.SEREO_SQLITE_PATH || process.env.SQLITE_PATH || path.join(__dirname, "data", "sereo.sqlite"));
const UPLOAD_DIR = path.resolve(process.env.SEREO_UPLOAD_DIR || path.join(__dirname, "imports"));
const BACKUP_DIR = path.resolve(process.env.SEREO_BACKUP_DIR || path.join(path.dirname(STORAGE_ENGINE === "json" ? DB_PATH : SQLITE_PATH), "backups"));
// v1.12.0 : dossier ou les Excel importes sont archives au format brut pour
// retelechargement et audit. Sous-dossier du data dir, donc persistant sur
// le volume Docker comme la SQLite.
const IMPORTS_ARCHIVES_DIR = path.resolve(process.env.SEREO_IMPORTS_ARCHIVES_DIR || path.join(path.dirname(SQLITE_PATH), "imports-archives"));
const LEAFLET_DIST = path.join(__dirname, "node_modules", "leaflet", "dist");
const ENABLE_DB_EXPORT = process.env.SEREO_ENABLE_DB_EXPORT === "1";
const AUTH_USER = cleanEnv(process.env.SEREO_AUTH_USER);
const AUTH_PASSWORD = cleanEnv(process.env.SEREO_AUTH_PASSWORD);
const AUTH_REALM = cleanEnv(process.env.SEREO_AUTH_REALM) || "Sereo";
// Le secret de signature integre TOUJOURS le password courant pour qu'un
// changement de mot de passe invalide automatiquement toutes les sessions
// existantes, meme si SEREO_AUTH_SESSION_SECRET est explicitement defini.
//
// S2 v1.13.0 : si SEREO_AUTH_SESSION_SECRET n'est pas defini, on genere un
// secret aleatoire fort (32 bytes base64) au lieu de tomber sur AUTH_REALM
// qui vaut "Sereo" par defaut (brute-forcable). Side-effect : toutes les
// sessions sont invalidees a chaque redemarrage du container (acceptable -
// le user devra se reconnecter une fois apres deploy d'une nouvelle version).
// Pour la persistance des sessions a travers les restarts, definir
// SEREO_AUTH_SESSION_SECRET dans les variables d'environnement (Tom.yml).
const AUTH_SESSION_SECRET_BASE = cleanEnv(process.env.SEREO_AUTH_SESSION_SECRET)
  || crypto.randomBytes(32).toString("base64");
const AUTH_SESSION_SECRET = `${AUTH_SESSION_SECRET_BASE}|${AUTH_PASSWORD}`;
if (!cleanEnv(process.env.SEREO_AUTH_SESSION_SECRET)) {
  console.warn(
    "[auth] SEREO_AUTH_SESSION_SECRET non defini : secret HMAC aleatoire genere. "
    + "Les sessions seront invalidees au prochain redemarrage. "
    + "Pour persister les sessions, definir cette variable dans l'environnement."
  );
}
const AUTH_COOKIE_NAME = "sereo_access";
const AUTH_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

// Rate limit sur /login pour eviter le brute-force.
// App privee pro derriere SWAG : on prend des valeurs douces pour ne pas
// genaner un utilisateur qui se trompe quelques fois, tout en bloquant un
// attaquant qui tenterait 1000+ tentatives/sec.
//   - MAX_ATTEMPTS : nb de tentatives ratees autorisees avant lockout
//   - WINDOW_MS    : fenetre glissante pour compter les echecs
//   - LOCKOUT_MS   : duree du lockout une fois MAX_ATTEMPTS atteint
// Configurable via env pour ajuster en prod si necessaire.
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = Math.max(1, Number(process.env.SEREO_AUTH_MAX_ATTEMPTS) || 5);
const AUTH_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.SEREO_AUTH_RATE_WINDOW_MS) || 15 * 60 * 1000);
const AUTH_RATE_LIMIT_LOCKOUT_MS = Math.max(1000, Number(process.env.SEREO_AUTH_LOCKOUT_MS) || 15 * 1000);

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const MAX_BRAND_IMAGE_DATA_URL_SIZE = 3 * 1024 * 1024;
const ACCEPTED_EXCEL_EXTENSIONS = [".xlsx"];
const DELIVERY_STATUSES = new Set(["restant", "en_cours", "livree", "absent", "probleme", "non_livre"]);
const ORDER_STATUSES = new Set([
  "importe",
  "stock_a_verifier",
  "en_preparation",
  "preparation_terminee",
  "pret_livraison",
  "en_livraison",
  "livre",
  "probleme_livraison",
  "a_reprogrammer"
]);

// Machine d'etat des transitions de status pour les commandes.
// Cette table represente les transitions VALIDES via setOrderStatus().
// Toute tentative de transition non listee est rejetee avec 400.
//
// normalizeOrder() (creation et import) BYPASSE cette validation pour
// permettre l'initialisation d'un objet a n'importe quel etat (utile
// pour `importedAsLivre` : import "Envoyee" -> directement livre).
//
// Le flux principal "happy path" :
//   importe -> stock_a_verifier -> en_preparation -> preparation_terminee
//   -> pret_livraison -> en_livraison -> livre
// + branches problemes :
//   en_livraison -> probleme_livraison -> a_reprogrammer
//   a_reprogrammer -> pret_livraison / en_preparation / en_livraison (retry)
// + raccourcis pratiques pour les cas reels :
//   en_preparation -> pret_livraison (saute preparation_terminee, deja gere ligne 2621)
//   en_livraison -> a_reprogrammer (direct depuis tournee, code existant 2034)
const ORDER_STATUS_TRANSITIONS = {
  importe: ["stock_a_verifier", "en_preparation"],
  stock_a_verifier: ["en_preparation", "pret_livraison"],
  en_preparation: ["preparation_terminee", "pret_livraison"],
  preparation_terminee: ["pret_livraison"],
  pret_livraison: ["en_livraison", "en_preparation"],
  en_livraison: ["livre", "probleme_livraison", "a_reprogrammer", "pret_livraison"],
  livre: [],
  probleme_livraison: ["a_reprogrammer", "en_livraison"],
  a_reprogrammer: ["pret_livraison", "en_preparation", "en_livraison"]
};

function isValidOrderStatusTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  const allowed = ORDER_STATUS_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}
const ROUTE_STATUSES = new Set(["brouillon", "prete", "en_livraison", "terminee"]);
const STOP_STATUSES = new Set(["pret_livraison", "en_livraison", "livre", "absent", "probleme", "a_reprogrammer"]);
const CORE_SECTORS = ["Besancon", "Champagnole", "Dole"];

ensureDir(path.dirname(DB_PATH));
ensureDir(path.dirname(SQLITE_PATH));
ensureDir(UPLOAD_DIR);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: 1
  },
  fileFilter(req, file, cb) {
    const extension = path.extname(file.originalname || "").toLowerCase();

    if (!ACCEPTED_EXCEL_EXTENSIONS.includes(extension)) {
      cb(badRequest("Seuls les fichiers Excel .xlsx sont acceptes"));
      return;
    }

    cb(null, true);
  }
});

app.disable("x-powered-by");
// Trust le 1er proxy (SWAG en prod, harmless en dev local).
// Permet a req.ip de retourner la vraie IP client via X-Forwarded-For, ce qui
// est indispensable pour que le rate limit s'applique par utilisateur et pas
// sur l'IP unique du reverse proxy.
app.set("trust proxy", 1);
app.use(securityHeaders);
app.use("/brand", express.static(path.join(__dirname, "public", "brand"), { immutable: true, maxAge: "1d" }));
app.get("/favicon.svg", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "favicon.svg"));
});
app.get("/healthz", (req, res) => {
  // Revue #4 : si la recovery storage a totalement echoue (disque plein, FS
  // read-only), le serveur ecoute mais sert 500 sur toutes les routes data.
  // On reflete cet etat zombie via un 503 pour que Docker/SWAG/sereo-updater
  // detectent le container comme non-sain (sinon il reste declare "healthy").
  if (storageRecoveryFatal) {
    return res.status(503).json({ ok: false, error: "storage indisponible (recovery echouee)" });
  }
  res.json({ ok: true });
});

// Endpoint /api/version expose la version courante + les release notes
// simplifiees pour le footer + modal version cote frontend.
// Place AVANT requireAccessAuth pour rester accessible sur /login aussi
// (la version n'est pas une info sensible et permet d'afficher le chip
// "v1.5.0" meme avant connexion).
app.get("/api/version", async (req, res) => {
  try {
    const cache = await fetchReleaseNotes(APP_VERSION);
    // no-store : le client ne doit JAMAIS cacher la version. Sinon apres un
    // auto-deploy le frontend affiche encore l'ancien numero pendant la
    // duree du cache. Le serveur lui-meme cache deja les release notes
    // GitHub 1h en RAM via releaseNotesCache, donc la perf reste OK.
    res.set("Cache-Control", "no-store, max-age=0");
    res.json({
      version: cache.version,
      releaseUrl: cache.releaseUrl,
      releaseName: cache.releaseName,
      publishedAt: cache.publishedAt,
      pourToi: cache.pourToi,
      fullNotes: cache.fullNotes,
      fetchedAt: cache.fetchedAt,
      fetchError: cache.fetchError,
      // available : derive de fetchError pour compat tests. true si on a
      // reussi a fetch les release notes depuis GitHub, false sinon.
      available: !cache.fetchError
    });
  } catch (e) {
    res.status(500).json({ error: "Version indisponible" });
  }
});
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.get("/login", renderLoginPage);
app.get("/login.js", (req, res) => {
  // Asset JS de la page login (countdown lockout). Servi avant requireAccessAuth
  // pour etre accessible sans authentification.
  res.sendFile(path.join(__dirname, "public", "login.js"));
});
app.post("/login", handleLogin);
app.post("/logout", handleLogout);
app.use(requireAccessAuth);
app.use(express.json({ limit: "5mb" }));
app.use("/vendor/leaflet", express.static(LEAFLET_DIST, { immutable: true, maxAge: "7d" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", requireTrustedApiRequest);

function cleanEnv(value) {
  return String(value ?? "").trim();
}

// ============================================================================
// Rate limit auth (en memoire, par IP)
// ============================================================================
// State : Map<ip, { failedTimestamps: number[], lockedUntil: number | null }>
// Volontairement en memoire process : l'app est mono-instance (sereo container
// unique). Les tentatives ratees sont oubliees au redemarrage, ce qui est
// acceptable car (a) un attaquant qui force redemarrage n'est pas notre
// modele de menace, (b) un utilisateur legitime n'attend que 15 min pour
// reset naturel via la fenetre glissante.
const authRateLimitState = new Map();

function getAuthRateLimitStatus(ip, now) {
  const time = now || Date.now();
  const entry = authRateLimitState.get(ip);
  if (!entry) {
    return { attempts: 0, remaining: AUTH_RATE_LIMIT_MAX_ATTEMPTS, locked: false, remainingMs: 0 };
  }
  const cutoff = time - AUTH_RATE_LIMIT_WINDOW_MS;
  entry.failedTimestamps = entry.failedTimestamps.filter(t => t > cutoff);
  if (entry.lockedUntil && entry.lockedUntil > time) {
    return {
      attempts: entry.failedTimestamps.length,
      remaining: 0,
      locked: true,
      remainingMs: entry.lockedUntil - time,
      lockedUntil: entry.lockedUntil
    };
  }
  if (entry.lockedUntil && entry.lockedUntil <= time) {
    // Le lockout vient de finir : on reset le compteur pour que l'utilisateur
    // reparte sur 5 tentatives fraiches.
    entry.failedTimestamps = [];
    entry.lockedUntil = null;
  }
  return {
    attempts: entry.failedTimestamps.length,
    remaining: Math.max(0, AUTH_RATE_LIMIT_MAX_ATTEMPTS - entry.failedTimestamps.length),
    locked: false,
    remainingMs: 0
  };
}

function recordAuthFailure(ip, now) {
  const time = now || Date.now();
  let entry = authRateLimitState.get(ip);
  if (!entry) {
    entry = { failedTimestamps: [], lockedUntil: null };
    authRateLimitState.set(ip, entry);
  }
  const cutoff = time - AUTH_RATE_LIMIT_WINDOW_MS;
  entry.failedTimestamps = entry.failedTimestamps.filter(t => t > cutoff);
  entry.failedTimestamps.push(time);
  if (entry.failedTimestamps.length >= AUTH_RATE_LIMIT_MAX_ATTEMPTS) {
    entry.lockedUntil = time + AUTH_RATE_LIMIT_LOCKOUT_MS;
  }
  return getAuthRateLimitStatus(ip, time);
}

function clearAuthFailures(ip) {
  authRateLimitState.delete(ip);
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Nettoyage periodique pour eviter une croissance non bornee de la Map.
// Tourne toutes les 5 min, supprime les IPs sans tentative recente ni lockout actif.
const authRateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  const cutoff = now - AUTH_RATE_LIMIT_WINDOW_MS;
  for (const [ip, entry] of authRateLimitState.entries()) {
    const recentFailures = entry.failedTimestamps.some(t => t > cutoff);
    const stillLocked = entry.lockedUntil && entry.lockedUntil > now;
    if (!recentFailures && !stillLocked) {
      authRateLimitState.delete(ip);
    }
  }
}, 5 * 60 * 1000);
authRateLimitCleanupInterval.unref();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  });
}

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.tile.openstreetmap.org",
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join("; ")
  );
  next();
}

function isAccessAuthEnabled() {
  return Boolean(AUTH_USER && AUTH_PASSWORD);
}

function isAccessAuthMisconfigured() {
  return Boolean(AUTH_USER || AUTH_PASSWORD) && !isAccessAuthEnabled();
}

function parseBasicAuthHeader(header) {
  const [scheme, encoded] = String(header || "").split(" ");
  if (!encoded || scheme.toLowerCase() !== "basic") return null;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

function constantTimeEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(String(left)).digest();
  const rightHash = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCookies(header) {
  return String(header || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return cookies;

      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!name) return cookies;

      // decodeURIComponent throw sur un cookie malforme (ex: "%" non suivi de
      // 2 hex). parseCookies s'execute AVANT l'auth (getAccessSessionCookie) :
      // une exception ici renverrait 500 avant la verification d'acces (DoS
      // trivial et pre-auth). On retombe sur la valeur brute.
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

function signAuthPayload(payload) {
  return crypto
    .createHmac("sha256", AUTH_SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

function createAccessSessionValue(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    user: AUTH_USER,
    issuedAt: now
  })).toString("base64url");

  return `${payload}.${signAuthPayload(payload)}`;
}

function isValidAccessSessionValue(value, now = Date.now()) {
  const [payload, signature] = String(value || "").split(".");
  if (!payload || !signature) return false;

  const expectedSignature = signAuthPayload(payload);
  if (!constantTimeEqual(signature, expectedSignature)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const issuedAt = Number(session.issuedAt);

    if (session.user !== AUTH_USER || !Number.isFinite(issuedAt)) return false;
    return now - issuedAt <= AUTH_COOKIE_MAX_AGE_SECONDS * 1000;
  } catch {
    return false;
  }
}

function getAccessSessionCookie(req) {
  return parseCookies(req.get("cookie"))[AUTH_COOKIE_NAME];
}

function buildAuthCookie(value, maxAgeSeconds, req) {
  const cookieParts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (req.secure || req.get("x-forwarded-proto") === "https") {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

function isSessionAuthorizedRequest(req) {
  if (!isAccessAuthEnabled()) return true;
  return isValidAccessSessionValue(getAccessSessionCookie(req));
}

function isAuthorizedRequest(req) {
  if (!isAccessAuthEnabled()) return true;

  if (isSessionAuthorizedRequest(req)) return true;

  const credentials = parseBasicAuthHeader(req.get("authorization"));
  if (!credentials) return false;

  return constantTimeEqual(credentials.username, AUTH_USER)
    && constantTimeEqual(credentials.password, AUTH_PASSWORD);
}

function isApiRequest(req) {
  return String(req.path || "").startsWith("/api/");
}

function isHtmlNavigationRequest(req) {
  return req.method === "GET"
    && (req.path === "/" || req.path === "/index.html" || String(req.get("accept") || "").includes("text/html"));
}

// Reponse de refus d'acces sur une tentative de credentials, format adapte au
// type de requete.
// - Navigation HTML (GET) : page de login conviviale via renderLoginPage, qui
//   lit l'etat de lockout depuis le store et pose lui-meme 200/429 + Retry-After
//   + le compte a rebours. On EVITE ainsi le dialogue Basic natif du navigateur
//   quand des credentials Basic perimees sont re-envoyees automatiquement
//   (ex. apres rotation du mot de passe : le navigateur rejoue le vieux Basic).
// - API : JSON { error } + Retry-After/WWW-Authenticate selon le cas.
function denyAccessAttempt(req, res, statusCode, message, retryAfterMs = 0) {
  if (req.method === "GET" && isHtmlNavigationRequest(req)) {
    renderLoginPage(req, res);
    return;
  }
  if (retryAfterMs > 0) {
    res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  }
  if (statusCode === 401) {
    res.setHeader("WWW-Authenticate", `Basic realm="${AUTH_REALM}", charset="UTF-8"`);
  }
  if (isApiRequest(req)) {
    res.status(statusCode).json({ error: message });
    return;
  }
  res.status(statusCode).send(message);
}

function requireAccessAuth(req, res, next) {
  if (isAccessAuthMisconfigured()) {
    res.status(500).json({
      error: "Protection d'acces mal configuree. Renseigner SEREO_AUTH_USER et SEREO_AUTH_PASSWORD."
    });
    return;
  }

  // Une session cookie valide autorise directement, sans passer par le
  // rate-limit : ce n'est pas une tentative de credentials (et une session
  // legitime ne doit pas etre bloquee par un lockout d'IP partagee).
  if (isSessionAuthorizedRequest(req)) {
    next();
    return;
  }

  // Pas de session valide. Si des credentials Basic sont presentes, on les
  // verifie sous le MEME rate-limit que POST /login. Sans ca, l'en-tete Basic
  // sur n'importe quelle route protegee permettait un brute-force ILLIMITE du
  // mot de passe (le lockout ne couvrait que /login).
  const basicCredentials = isAccessAuthEnabled()
    ? parseBasicAuthHeader(req.get("authorization"))
    : null;

  if (basicCredentials) {
    const ip = getClientIp(req);

    const status = getAuthRateLimitStatus(ip);
    if (status.locked) {
      denyAccessAttempt(req, res, 429, "Trop de tentatives de connexion. Reessayez plus tard.", status.remainingMs);
      return;
    }

    const valid = constantTimeEqual(basicCredentials.username, AUTH_USER)
      && constantTimeEqual(basicCredentials.password, AUTH_PASSWORD);

    if (valid) {
      clearAuthFailures(ip);
      next();
      return;
    }

    const updated = recordAuthFailure(ip);
    if (updated.locked) {
      denyAccessAttempt(req, res, 429, "Trop de tentatives de connexion. Reessayez plus tard.", updated.remainingMs);
      return;
    }
    denyAccessAttempt(req, res, 401, "Connexion requise");
    return;
  }

  // Aucun credential presente (navigation anonyme, session SPA expiree...) :
  // parcours normal, sans enregistrer d'echec (sinon un simple navigateur
  // deconnecte declencherait le lockout).
  if (isApiRequest(req)) {
    res.setHeader("WWW-Authenticate", `Basic realm="${AUTH_REALM}", charset="UTF-8"`);
    res.status(401).json({ error: "Connexion requise" });
    return;
  }

  if (req.method === "GET") {
    renderLoginPage(req, res);
    return;
  }

  res.setHeader("WWW-Authenticate", `Basic realm="${AUTH_REALM}", charset="UTF-8"`);
  res.status(401).send("Acces protege");
}

function getSafeRedirectTarget(value) {
  const target = String(value || "/");

  // Doit etre un chemin interne simple. On rejette aussi les backslash : un
  // navigateur peut interpreter "/\evil.com" (ou "/\/evil.com") comme une URL
  // protocole-relative -> open redirect externe apres login.
  if (
    !target.startsWith("/")
    || target.startsWith("//")
    || target.includes("\\")
    || target.startsWith("/login")
  ) {
    return "/";
  }

  return target;
}

function renderLoginPage(req, res) {
  if (!isAccessAuthEnabled()) {
    res.redirect(getSafeRedirectTarget(req.query.next));
    return;
  }

  const hasError = req.query.error === "1";
  const next = getSafeRedirectTarget(req.query.next);

  // Etat du rate limit pour cette IP, calcule a chaque GET /login.
  // Source de verite serveur (la query ?locked=1 peut etre obsolete si le
  // lockout a expire entre le POST et le GET).
  const status = getAuthRateLimitStatus(getClientIp(req));
  const isLocked = status.locked;
  const lockedSeconds = isLocked ? Math.ceil(status.remainingMs / 1000) : 0;
  const lockedUntilMs = isLocked ? status.lockedUntil : 0;

  let errorMarkup = "";
  if (isLocked) {
    const plural = lockedSeconds > 1 ? "s" : "";
    // Le mot "seconde(s)" est dans un span separe pour que login.js puisse
    // basculer entre singulier et pluriel quand le compteur descend a 1.
    errorMarkup = `<p class="login-error" role="alert" aria-live="polite">Trop de tentatives. R&eacute;essaie dans <span id="lockout-countdown">${lockedSeconds}</span> <span id="lockout-unit">seconde${plural}</span>.</p>`;
  } else if (hasError) {
    const attemptsRemaining = status.remaining;
    const attemptsLine = attemptsRemaining > 0 && attemptsRemaining < AUTH_RATE_LIMIT_MAX_ATTEMPTS
      ? `<span class="login-error-attempts">Il te reste ${attemptsRemaining} tentative${attemptsRemaining > 1 ? "s" : ""} avant blocage.</span>`
      : "";
    errorMarkup = `<p class="login-error" role="alert">Identifiant ou mot de passe incorrect.${attemptsLine ? " " + attemptsLine : ""}</p>`;
  }

  const responseStatus = isLocked ? 429 : (hasError ? 401 : 200);
  if (isLocked) {
    res.setHeader("Retry-After", String(lockedSeconds));
  }
  const bodyLockedAttr = isLocked ? ` data-locked-until="${lockedUntilMs}"` : "";

  res.status(responseStatus).send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connexion - s&eacute;r&eacute;o</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    /* Palette strictement brand sereo : teal, vert pastel, orange pastel. */
    :root {
      --brand-teal: #0e6b63;
      --brand-teal-dark: #0f3d3d;
      --brand-teal-glow: rgba(14, 107, 99, 0.18);
      --pastel-green: #cfe9e1;
      --pastel-green-light: #e8f4ef;
      --pastel-orange: #ffc4a3;
      --pastel-orange-light: #fff0e8;
      --pastel-orange-strong: #f47a5a;
      --pastel-orange-glow: rgba(244, 122, 90, 0.22);
      --surface: #ffffff;
      --surface-soft: #fbfefd;
      --text: #102a2f;
      --text-soft: #4f686b;
    }

    * { box-sizing: border-box; }

    html, body { margin: 0; min-height: 100vh; }

    /* =========================================================================
       Layout split-screen (pattern B2B SaaS 2026)
       - Desktop >= 1024px : 1.15fr (brand) / 1fr (form), full viewport
       - Tablet 768-1023px : single column, hero band en haut compact
       - Mobile  < 768px   : single column, pas de hero
       ========================================================================= */
    .login-page {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
      min-height: 100vh;
    }
    @media (max-width: 1023px) {
      .login-page { grid-template-columns: 1fr; }
    }

    body {
      font-family: Inter, "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
      color: var(--text);
      background: #fafaf8;
      overflow-x: hidden;
    }

    /* =========================================================================
       Panel BRAND (gauche desktop / haut tablet)
       ========================================================================= */
    .brand-panel {
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 64px 56px;
      overflow: hidden;
      background:
        radial-gradient(620px circle at var(--bg-x1, 18%) var(--bg-y1, 22%), rgba(255, 196, 163, 0.55), transparent 62%),
        radial-gradient(720px circle at var(--bg-x2, 82%) var(--bg-y2, 78%), rgba(207, 233, 225, 0.85), transparent 60%),
        linear-gradient(135deg, var(--pastel-green-light) 0%, #ffffff 50%, var(--pastel-orange-light) 100%);
      animation: bg-drift 42s ease-in-out infinite alternate;
    }
    @media (max-width: 1023px) {
      .brand-panel { padding: 32px 28px 20px; min-height: 0; }
    }
    @media (max-width: 640px) {
      .brand-panel { padding: 24px 22px 16px; min-height: 0; }
    }

    @property --bg-x1 { syntax: "<percentage>"; inherits: true; initial-value: 18%; }
    @property --bg-y1 { syntax: "<percentage>"; inherits: true; initial-value: 22%; }
    @property --bg-x2 { syntax: "<percentage>"; inherits: true; initial-value: 82%; }
    @property --bg-y2 { syntax: "<percentage>"; inherits: true; initial-value: 78%; }

    @keyframes bg-drift {
      0%   { --bg-x1: 18%; --bg-y1: 22%; --bg-x2: 82%; --bg-y2: 78%; }
      50%  { --bg-x1: 32%; --bg-y1: 12%; --bg-x2: 68%; --bg-y2: 88%; }
      100% { --bg-x1: 22%; --bg-y1: 35%; --bg-x2: 78%; --bg-y2: 65%; }
    }

    /* 2 blobs decoratifs qui respirent dans le panel brand */
    .brand-panel::before, .brand-panel::after {
      content: "";
      position: absolute;
      border-radius: 50%;
      filter: blur(72px);
      pointer-events: none;
      z-index: 0;
      mix-blend-mode: multiply;
    }
    .brand-panel::before {
      width: 420px;
      height: 420px;
      background: var(--pastel-green);
      top: -110px;
      left: -120px;
      animation: blob-breathe-1 14s ease-in-out infinite;
    }
    .brand-panel::after {
      width: 460px;
      height: 460px;
      background: var(--pastel-orange);
      bottom: -140px;
      right: -130px;
      animation: blob-breathe-2 16s ease-in-out infinite;
    }
    @keyframes blob-breathe-1 {
      0%, 100% { transform: scale(1) translate(0, 0);          opacity: 0.5; }
      50%      { transform: scale(1.12) translate(30px, 40px); opacity: 0.7; }
    }
    @keyframes blob-breathe-2 {
      0%, 100% { transform: scale(1) translate(0, 0);            opacity: 0.42; }
      50%      { transform: scale(1.08) translate(-40px, -30px); opacity: 0.58; }
    }

    .brand-content {
      position: relative;
      z-index: 1;
      max-width: 480px;
      margin: 0 auto;
      text-align: center;
      animation: card-in 600ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .brand-logo-frame {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 18px 30px;
      margin-bottom: 32px;
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px) saturate(120%);
      box-shadow:
        0 24px 48px rgba(14, 107, 99, 0.1),
        inset 0 0 0 1px rgba(14, 107, 99, 0.08);
      animation: logo-pulse 6s ease-in-out infinite alternate;
    }
    @keyframes logo-pulse {
      0%   { box-shadow: 0 24px 48px rgba(14, 107, 99, 0.1), inset 0 0 0 1px rgba(14, 107, 99, 0.08); transform: scale(1); }
      100% { box-shadow: 0 28px 56px rgba(14, 107, 99, 0.14), 0 0 60px -10px var(--brand-teal-glow), inset 0 0 0 1px rgba(14, 107, 99, 0.12); transform: scale(1.015); }
    }
    .brand-logo-frame img {
      width: clamp(160px, 22vw, 240px);
      height: auto;
      object-fit: contain;
    }

    .brand-tagline {
      margin: 0 0 36px;
      color: var(--brand-teal-dark);
      font-size: clamp(17px, 1.4vw, 21px);
      line-height: 1.45;
      font-weight: 600;
      letter-spacing: -0.005em;
    }

    .brand-features {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 14px;
      text-align: left;
    }
    .brand-features li {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 18px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(8px);
      color: var(--brand-teal-dark);
      font-size: 14.5px;
      font-weight: 500;
      box-shadow: inset 0 0 0 1px rgba(14, 107, 99, 0.06);
    }
    .brand-features svg {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      color: var(--pastel-orange-strong);
    }

    @media (max-width: 1023px) {
      .brand-tagline { font-size: 16px; margin-bottom: 0; }
      .brand-features { display: none; }
      .brand-logo-frame { padding: 14px 22px; margin-bottom: 20px; }
    }

    /* =========================================================================
       Panel FORM (droite desktop / bas tablet)
       ========================================================================= */
    .form-panel {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 56px 32px;
      background: var(--surface);
      position: relative;
    }
    /* Sur desktop, un trait de gradient brand sur le bord gauche separe les 2 panels */
    @media (min-width: 1024px) {
      .form-panel::before {
        content: "";
        position: absolute;
        top: 12%;
        bottom: 12%;
        left: 0;
        width: 1px;
        background: linear-gradient(180deg, transparent, rgba(14, 107, 99, 0.18), rgba(244, 122, 90, 0.18), transparent);
        pointer-events: none;
      }
    }
    @media (max-width: 1023px) {
      /* Sur tablet/mobile, le form-panel se contente de remplir l'espace
         restant sous le brand-panel. align-items:start evite le gros gap
         vertical quand le viewport est tres haut (mobile portrait). */
      .form-panel {
        align-items: flex-start;
        padding: 24px 24px 32px;
      }
    }
    @media (max-width: 640px) {
      .form-panel { padding: 20px 20px 28px; }
    }

    .login-card {
      width: 100%;
      max-width: 420px;
      padding: 12px 4px;
      animation: card-in 480ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes card-in {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* Titre + icone cadenas : icone dans un disque pastel */
    .title-row {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 10px;
    }
    .title-row svg {
      flex-shrink: 0;
      width: 34px;
      height: 34px;
      padding: 8px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--pastel-green-light), var(--pastel-orange-light));
      color: var(--brand-teal);
      box-shadow: inset 0 0 0 1px rgba(14, 107, 99, 0.12);
    }
    h1 {
      margin: 0;
      color: var(--brand-teal);
      font-size: clamp(26px, 2.2vw, 32px);
      font-weight: 800;
      line-height: 1.15;
      letter-spacing: -0.015em;
    }

    .intro {
      margin: 0 0 32px;
      color: var(--text-soft);
      line-height: 1.55;
      font-size: 15.5px;
    }

    .field { margin-bottom: 16px; }

    label {
      display: block;
      margin: 0 0 7px;
      color: var(--brand-teal-dark);
      font-weight: 700;
      font-size: 12.5px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    input {
      width: 100%;
      min-height: 52px;
      padding: 14px 16px;
      border: 1.5px solid rgba(14, 107, 99, 0.12);
      border-radius: 14px;
      background: var(--surface-soft);
      color: var(--text);
      font: inherit;
      font-size: 15.5px;
      outline: none;
      transition: border-color 180ms ease, box-shadow 220ms ease, background-color 180ms ease;
    }
    input:hover:not(:disabled) {
      border-color: rgba(14, 107, 99, 0.22);
      background: var(--surface);
    }
    input:focus {
      border-color: var(--pastel-orange-strong);
      background: var(--surface);
      box-shadow:
        0 0 0 4px rgba(255, 196, 163, 0.34),
        0 0 24px -4px rgba(244, 122, 90, 0.22);
    }
    input:disabled { opacity: 0.6; cursor: not-allowed; }
    /* Autofill : le navigateur applique un fond jaune horrible. On override
       avec un inset box-shadow qui simule notre fond pastel cohérent
       (technique standard car background ne peut pas etre override en
       autofill). Couleur cible : surface blanc + une touche pastel green. */
    input:-webkit-autofill,
    input:-webkit-autofill:hover,
    input:-webkit-autofill:focus {
      -webkit-box-shadow: 0 0 0 100px var(--surface) inset, 0 0 0 4px rgba(255, 196, 163, 0.18);
      -webkit-text-fill-color: var(--text);
      caret-color: var(--text);
      transition: background-color 5000s ease-in-out 0s;
    }
    /* Variante focus pour conserver le ring orange brand */
    input:-webkit-autofill:focus {
      -webkit-box-shadow:
        0 0 0 100px var(--surface) inset,
        0 0 0 4px rgba(255, 196, 163, 0.34),
        0 0 24px -4px rgba(244, 122, 90, 0.22);
    }

    /* Bouton : gradient teal->orange (signature brand sereo), shine sweep
       sur hover pour un effet "haut de gamme" subtil */
    button[type="submit"] {
      position: relative;
      width: 100%;
      min-height: 54px;
      margin-top: 10px;
      border: 0;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--brand-teal) 0%, var(--pastel-orange-strong) 100%);
      background-size: 180% 180%;
      background-position: 0% 50%;
      color: white;
      font: inherit;
      font-size: 15.5px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      cursor: pointer;
      overflow: hidden;
      isolation: isolate;
      box-shadow:
        0 16px 32px rgba(244, 122, 90, 0.26),
        0 4px 12px rgba(14, 107, 99, 0.14);
      transition: transform 160ms ease, box-shadow 240ms ease, background-position 600ms ease;
    }
    /* Shine sweep effet luxe au hover */
    button[type="submit"]::after {
      content: "";
      position: absolute;
      top: 0; left: -100%;
      width: 60%;
      height: 100%;
      background: linear-gradient(120deg,
        transparent 0%,
        rgba(255, 255, 255, 0.32) 50%,
        transparent 100%);
      transform: skewX(-22deg);
      transition: left 700ms ease;
      pointer-events: none;
      z-index: 1;
    }
    button[type="submit"]:hover:not(:disabled) {
      transform: translateY(-2px);
      background-position: 100% 50%;
      box-shadow:
        0 22px 40px rgba(244, 122, 90, 0.34),
        0 6px 16px rgba(14, 107, 99, 0.18),
        0 0 0 1px rgba(255, 255, 255, 0.4) inset;
    }
    button[type="submit"]:hover:not(:disabled)::after {
      left: 140%;
    }
    button[type="submit"]:active:not(:disabled) { transform: translateY(-1px); }
    button[type="submit"]:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      box-shadow: none;
    }

    .login-error {
      margin: 0 0 20px;
      padding: 14px 16px;
      border: 1px solid rgba(244, 122, 90, 0.28);
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(255, 196, 163, 0.28), rgba(255, 240, 232, 0.18));
      color: #9c341f;
      font-weight: 600;
      font-size: 14px;
      line-height: 1.45;
      animation: error-in 360ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes error-in {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .login-error-attempts {
      display: block;
      margin-top: 6px;
      font-weight: 500;
      font-size: 13px;
      color: rgba(156, 52, 31, 0.86);
    }

    #lockout-countdown {
      display: inline-block;
      min-width: 1.4em;
      padding: 2px 8px;
      margin: 0 3px;
      border-radius: 10px;
      background: rgba(156, 52, 31, 0.14);
      font-variant-numeric: tabular-nums;
      font-weight: 800;
    }

    .footer-hint {
      margin: 26px 0 0;
      text-align: center;
      font-size: 12px;
      color: var(--text-soft);
      letter-spacing: 0.02em;
    }
    .footer-hint a {
      color: var(--brand-teal);
      text-decoration: none;
      font-weight: 600;
      transition: color 160ms ease;
    }
    .footer-hint a:hover { color: var(--pastel-orange-strong); }

    @media (max-width: 640px) {
      h1 { font-size: 24px; }
      .title-row svg { width: 30px; height: 30px; padding: 7px; }
      .intro { font-size: 14.5px; margin-bottom: 24px; }
    }

    /* Accessibilite : on coupe TOUTES les animations decoratives si demande */
    @media (prefers-reduced-motion: reduce) {
      .brand-panel, .brand-panel::before, .brand-panel::after,
      .brand-logo-frame, .brand-content, .login-card { animation: none; }
      button[type="submit"]:hover:not(:disabled) { transform: none; }
      button[type="submit"]::after { display: none; }
    }
  </style>
</head>
<body${bodyLockedAttr}>
  <div class="login-page">
    <aside class="brand-panel" aria-hidden="true">
      <div class="brand-content">
        <div class="brand-logo-frame">
          <img src="/brand/sereo-logo.svg" alt="s&eacute;r&eacute;o" />
        </div>
        <p class="brand-tagline">Gestion locale du stock, des pr&eacute;parations et des livraisons.</p>
        <ul class="brand-features">
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
              <path d="m4 7.5 8 4.5 8-4.5" />
              <path d="M12 12v9" />
            </svg>
            <span>Stock et inventaire en temps r&eacute;el</span>
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 4h6l1 2h3v15H5V6h3l1-2Z" />
              <path d="M9 11h6" />
              <path d="M9 15h6" />
              <path d="M9 19h4" />
            </svg>
            <span>Pr&eacute;paration de commandes simplifi&eacute;e</span>
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h11v10H3V6Z" />
              <path d="M14 10h4l3 3v3h-7v-6Z" />
              <path d="M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
              <path d="M17.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
            </svg>
            <span>Tourn&eacute;es de livraison optimis&eacute;es</span>
          </li>
        </ul>
      </div>
    </aside>
    <main class="form-panel">
      <div class="login-card" aria-labelledby="login-title">
        <div class="title-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <h1 id="login-title">Bonjour</h1>
        </div>
        <p class="intro">Connecte-toi pour ouvrir l'application.</p>
        ${errorMarkup}
        <form method="post" action="/login">
          <input type="hidden" name="next" value="${escapeHtml(next)}">
          <div class="field">
            <label for="username">Identifiant</label>
            <input id="username" name="username" autocomplete="username" autofocus ${isLocked ? "disabled" : "required"}>
          </div>
          <div class="field">
            <label for="password">Mot de passe</label>
            <input id="password" name="password" type="password" autocomplete="current-password" ${isLocked ? "disabled" : "required"}>
          </div>
          <button type="submit"${isLocked ? " disabled" : ""}>Se connecter</button>
        </form>
        <p class="footer-hint">Application priv&eacute;e &middot; <a href="https://github.com/${GITHUB_REPO}/releases" target="_blank" rel="noopener noreferrer">v${APP_VERSION}</a></p>
      </div>
    </main>
  </div>
  <script src="/login.js"></script>
</body>
</html>`);
}

function handleLogin(req, res) {
  if (isAccessAuthMisconfigured()) {
    res.status(500).send("Protection d'acces mal configuree.");
    return;
  }

  const next = getSafeRedirectTarget(req.body.next);
  const username = cleanEnv(req.body.username);
  const password = cleanEnv(req.body.password);
  const ip = getClientIp(req);

  if (!isAccessAuthEnabled()) {
    res.redirect(next);
    return;
  }

  // Si l'IP est verrouillee, on rejette AVANT meme de comparer les credentials.
  // Cela protege aussi contre la timing-analysis sur des comptes connus.
  const status = getAuthRateLimitStatus(ip);
  if (status.locked) {
    res.setHeader("Retry-After", String(Math.ceil(status.remainingMs / 1000)));
    res.redirect(303, `/login?locked=1&until=${status.lockedUntil}&next=${encodeURIComponent(next)}`);
    return;
  }

  if (!constantTimeEqual(username, AUTH_USER) || !constantTimeEqual(password, AUTH_PASSWORD)) {
    const updated = recordAuthFailure(ip);
    if (updated.locked) {
      res.setHeader("Retry-After", String(Math.ceil(updated.remainingMs / 1000)));
      res.redirect(303, `/login?locked=1&until=${updated.lockedUntil}&next=${encodeURIComponent(next)}`);
      return;
    }
    res.redirect(303, `/login?error=1&remaining=${updated.remaining}&next=${encodeURIComponent(next)}`);
    return;
  }

  clearAuthFailures(ip);
  res.setHeader("Set-Cookie", buildAuthCookie(createAccessSessionValue(), AUTH_COOKIE_MAX_AGE_SECONDS, req));
  res.redirect(303, next);
}

function handleLogout(req, res) {
  res.setHeader("Set-Cookie", buildAuthCookie("", 0, req));
  res.redirect(303, "/login");
}

function requireTrustedApiRequest(req, res, next) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");

  if (origin && !isAllowedOrigin(origin, req)) {
    res.status(403).json({ error: "Requete refusee hors application locale" });
    return;
  }

  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    res.status(403).json({ error: "Requete refusee hors application locale" });
    return;
  }

  next();
}

function isAllowedOrigin(origin, req) {
  try {
    const originUrl = new URL(origin);
    const requestHost = req.get("host");
    return Boolean(requestHost && originUrl.host === requestHost);
  } catch {
    return false;
  }
}

function defaultDb() {
  return {
    clients: [],
    ventes: [],
    stock: [],
    historique: [],
    commandes: [],
    routes: [],
    stockMovements: [],
    importsArchives: [],
    settings: {
      appearance: {
        themeId: "sereo",
        brandImage: "",
        // colorScheme : "auto" suit l'OS (prefers-color-scheme), "light"/"dark" force.
        // Defaut "light" en attendant que le mode sombre soit valide en production.
        // Les utilisateurs peuvent passer en "auto" ou "dark" via le toggle Parametres.
        colorScheme: "light"
      },
      // Revue R1 NIT-18 : alignement avec normalizeSettings (defaut prod).
      orderNumbering: { prefix: "CMD", resetAnnually: true },
      tournee: { averageSpeedKmh: 28, stopDurationMin: 6 }
    }
  };
}

const VALID_COLOR_SCHEMES = new Set(["auto", "light", "dark"]);

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function useSqliteStorage() {
  return STORAGE_ENGINE !== "json";
}

let sqliteStore;
// B3 (v1.16.0) : trace de la derniere recovery de corruption SQLite, exposee
// via /api/storage/status et journalisee dans l'historique au boot. Permet a
// l'operateur de SAVOIR qu'un sinistre a eu lieu (sinon une base vierge ressemble
// a une install neuve et il re-saisit par-dessus sans le savoir).
let lastStorageRecovery = null;
// Memorise un echec TOTAL de recovery (disque plein...) pour ne pas la rejouer
// a chaque requete (revue #2).
let storageRecoveryFatal = null;
// Lot 3 (audit 2026-07-08) : apres une recovery "fresh_empty" (base repartie
// VIERGE), les backups auto sont suspendus pour ne pas gzipper du vide et
// evincer les backups historiques. MAIS ils DOIVENT reprendre des que
// l'operateur re-saisit de vraies donnees, sinon une 2e corruption = perte
// totale definitive (avant : suspension a vie, flag jamais re-arme). Ce flag
// porte la suspension ; writeDb la leve au 1er write contenant des donnees.
let backupsSuspendedFreshEmpty = false;
// Lot 3 : sante des backups exposee via /api/storage/status. Avant, un echec
// de backup async etait totalement silencieux (fausse securite) : l'app
// pouvait tourner des jours sans nouveau backup en paraissant saine.
let lastBackupAt = null;
let lastBackupError = null;
// Nombre max de fichiers .corrupt-<ts> conserves (forensic) avant purge
const QUARANTINE_RETENTION = 5;

function openSqliteStore(options = {}) {
  return createSqliteStore({
    sqlitePath: SQLITE_PATH,
    // Revue #2 : sur le chemin recovery-vierge, on passe seedJsonPath=null pour
    // que la base soit VRAIMENT vide et ne ressuscite PAS un db.json legacy
    // perime (sinon le message "base vierge" est mensonger et l'operateur voit
    // reapparaitre du stock/clients fantomes).
    seedJsonPath: options.skipJsonSeed ? null : DB_PATH,
    defaultDb,
    normalizeDb,
    ensureDir
  });
}

function getSqliteStore() {
  if (!sqliteStore) {
    // Revue #2 : si une recovery a deja totalement echoue (disque plein...),
    // on ne la rejoue PAS a chaque requete (sinon spam de quarantaines + boucle
    // CPU/IO + logs). On re-throw l'erreur memorisee directement.
    if (storageRecoveryFatal) {
      throw storageRecoveryFatal;
    }
    try {
      sqliteStore = openSqliteStore();
    } catch (error) {
      // Revue #3 (HIGH) : la recovery est DESTRUCTIVE (quarantaine + wipe). On
      // ne la declenche QUE sur une corruption AVEREE. Une erreur transitoire
      // (verrou "database is locked", I/O, permission) sur une base SAINE ne
      // doit PAS detruire les donnees : on re-throw, le serveur echoue proprement
      // et reessaiera au prochain boot (ex: l'autre container relache le verrou).
      if (!isCorruptionError(error)) {
        console.error(`[storage] Ouverture SQLite echouee mais NON-corruption (${error.code || error.message}). Pas de recovery destructive - re-throw.`);
        throw error;
      }
      // B3 (v1.16.0) : corruption avEREE (coupure courant, disque defaillant).
      // Recovery : quarantaine -> restore backup -> sinon base vierge.
      console.error(`[storage] Corruption SQLite averee (${error.code || error.message}). Tentative de recovery...`);
      try {
        sqliteStore = recoverCorruptSqliteStore(error);
      } catch (fatalError) {
        // Recovery elle-meme impossible (disque plein/permissions) : on memorise
        // pour ne pas rejouer, et on propage.
        storageRecoveryFatal = fatalError;
        throw fatalError;
      }
    }
  }

  return sqliteStore;
}

// Revue #3 : distingue une corruption AVEREE (recovery destructive justifiee)
// d'une erreur transitoire (verrou, I/O, permission - NE PAS detruire la base).
// Liste blanche stricte : on ne recovery QUE sur les signatures de corruption
// connues ; tout le reste est traite comme transitoire (fail-safe = preserver).
function isCorruptionError(error) {
  if (!error) return false;
  // Combine message ET errstr : node:sqlite peut porter la signature dans l'un
  // ou l'autre selon la version/le contexte.
  const msg = [error.message, error.errstr].filter(Boolean).join(" ").toLowerCase();
  return (
    msg.includes("file is not a database")
    || msg.includes("not a database")
    || msg.includes("malformed")          // "database disk image is malformed"
    || msg.includes("file is encrypted")  // header illisible
    || msg.includes("quick_check a echoue")
  );
}

// Nettoie les fichiers sidecar WAL/SHM (peuvent etre corrompus eux aussi)
function removeSqliteSidecars() {
  for (const ext of ["-wal", "-shm"]) {
    try { fs.unlinkSync(SQLITE_PATH + ext); } catch { /* absent : ok */ }
  }
}

// Quarantaine du fichier corrompu pour un eventuel sauvetage externe
// (sqlite3 .recover) AVANT que la recovery ne l'ecrase.
// Revue #2 : (1) on quarantaine AUSSI les sidecars -wal/-shm car des donnees
// committees peuvent y vivre (WAL non checkpointe apres coupure). (2) tag unique
// avec compteur pour eviter la collision si 2 recoveries dans la meme ms.
// (3) fallback rename si copy echoue (disque plein) : rename ne consomme pas
// d'espace et preserve quand meme l'original.
let quarantineCounter = 0;
function quarantineCorruptFile() {
  if (!fs.existsSync(SQLITE_PATH)) return null;
  const tag = `${safeTimestamp()}-${++quarantineCounter}`;
  const quarantinePath = `${SQLITE_PATH}.corrupt-${tag}`;
  // Sidecars d'abord (best-effort, copie pour preserver le WAL committe)
  for (const ext of ["-wal", "-shm"]) {
    if (fs.existsSync(SQLITE_PATH + ext)) {
      try { fs.copyFileSync(SQLITE_PATH + ext, quarantinePath + ext); } catch { /* best-effort */ }
    }
  }
  try {
    fs.copyFileSync(SQLITE_PATH, quarantinePath);
    console.error(`[storage] Fichier corrompu copie en quarantaine : ${quarantinePath}`);
    return quarantinePath;
  } catch (copyErr) {
    // Disque plein probable : on tente un rename (move) qui ne consomme pas
    // d'espace, pour preserver quand meme l'original avant le wipe.
    try {
      fs.renameSync(SQLITE_PATH, quarantinePath);
      console.error(`[storage] Copie impossible (${copyErr.code || copyErr.message}), fichier deplace en quarantaine : ${quarantinePath}`);
      return quarantinePath;
    } catch (renameErr) {
      console.error(`[storage] Quarantaine impossible (copy: ${copyErr.code || copyErr.message}, rename: ${renameErr.code || renameErr.message}) - le fichier corrompu sera ecrase.`);
      return null;
    }
  }
}

// Purge les vieux fichiers .corrupt-* pour eviter de saturer le disque (chacun
// peut peser autant que la base). On garde les QUARANTINE_RETENTION plus recents.
function pruneOldQuarantineFiles() {
  try {
    const dir = path.dirname(SQLITE_PATH);
    const prefix = `${path.basename(SQLITE_PATH)}.corrupt-`;
    fs.readdirSync(dir)
      .filter(name => name.startsWith(prefix))
      .map(name => {
        const full = path.join(dir, name);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
        return { full, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(QUARANTINE_RETENTION)
      .forEach(e => { try { fs.unlinkSync(e.full); } catch { /* best-effort */ } });
  } catch { /* best-effort */ }
}

// Plafond de decompression d'un backup pour eviter un OOM sur un .gz forge/gonfle
const MAX_BACKUP_DECOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1 Go

function recoverCorruptSqliteStore(originalError) {
  // 1. Quarantaine par COPIE (preserve l'original recuperable). On capture le
  //    succes pour le chemin fresh_empty (revue #3 : ne pas wiper sans sauvegarde).
  const quarantinePath = quarantineCorruptFile();
  removeSqliteSidecars();

  // 2. Restaurer le backup gzip le plus recent (du plus recent au plus ancien).
  const backups = listBackupEntries().filter(entry => entry.name.endsWith(".sqlite.gz"));
  for (const entry of backups) {
    let raw;
    try {
      const compressed = fs.readFileSync(entry.fullPath);
      raw = zlib.gunzipSync(compressed, { maxOutputLength: MAX_BACKUP_DECOMPRESSED_BYTES });
    } catch (gzErr) {
      // Backup .gz illisible/corrompu/trop gros : essayer le suivant (non destructif)
      console.error(`[storage] Backup ${entry.name} illisible (${gzErr.code || gzErr.message}), suivant...`);
      continue;
    }
    try {
      fs.writeFileSync(SQLITE_PATH, raw);
    } catch (writeErr) {
      // Revue #3 : erreur d'ecriture NON liee au backup (disque plein, FS en
      // lecture seule). On ABANDONNE (re-throw) au lieu de wiper en fresh_empty :
      // un bon backup existe peut-etre, et l'environnement est defaillant.
      console.error(`[storage] Ecriture du restore impossible (${writeErr.code || writeErr.message}) - abandon recovery, base NON wipee.`);
      throw writeErr;
    }
    removeSqliteSidecars();
    try {
      // Revue #4 : skipJsonSeed pendant la recovery -> ne JAMAIS ressusciter un
      // db.json legacy par-dessus le backup restaure (sinon faux "restore reussi"
      // affichant du stock/clients fantomes). Un backup Sereo legitime contient
      // deja app_meta.initialized, donc ce flag ne change rien pour les vrais
      // backups ; il blinde juste contre les backups vides/etrangers.
      const store = openSqliteStore({ skipJsonSeed: true }); // valide que le backup s'ouvre vraiment
      const backupAgeMin = Math.round((Date.now() - entry.mtimeMs) / 60000);
      lastStorageRecovery = {
        at: new Date().toISOString(),
        mode: "restored_backup",
        source: entry.name,
        message: `Base restauree depuis le backup ${entry.name} (~${backupAgeMin} min de donnees potentiellement perdues)`
      };
      console.error(`[storage] RECOVERY: ${lastStorageRecovery.message}`);
      pruneOldQuarantineFiles();
      return store;
    } catch (openErr) {
      if (!isCorruptionError(openErr)) {
        // Erreur transitoire a l'ouverture du backup restaure (verrou, I/O) :
        // abandonner plutot que de continuer vers fresh_empty destructif.
        console.error(`[storage] Ouverture du backup restaure echouee (NON-corruption: ${openErr.code || openErr.message}) - abandon recovery.`);
        throw openErr;
      }
      // Backup structurellement corrompu : nettoyer et essayer le suivant
      try { fs.unlinkSync(SQLITE_PATH); } catch { /* best-effort */ }
      removeSqliteSidecars();
      console.error(`[storage] Backup ${entry.name} corrompu (${openErr.code || openErr.message}), suivant...`);
    }
  }

  // 3. Aucun backup exploitable : base vierge. Revue #3 : si la quarantaine a
  //    TOTALEMENT echoue (quarantinePath null) ET qu'un fichier corrompu existe
  //    encore, on REFUSE de le wiper (re-throw) pour preserver l'original
  //    recuperable par un outil externe. Mieux vaut un serveur qui refuse de
  //    demarrer qu'une perte de donnees definitive non sauvegardee.
  if (!quarantinePath && fs.existsSync(SQLITE_PATH)) {
    console.error(
      `[storage] RECOVERY ABANDONNEE : aucun backup ET quarantaine impossible. `
      + `Le fichier corrompu est PRESERVE (pas de wipe) pour recuperation manuelle. `
      + `Erreur initiale: ${originalError.message}`
    );
    throw originalError;
  }

  try {
    try { fs.unlinkSync(SQLITE_PATH); } catch { /* best-effort */ }
    removeSqliteSidecars();
    const freshStore = openSqliteStore({ skipJsonSeed: true }); // vraiment vide
    lastStorageRecovery = {
      at: new Date().toISOString(),
      mode: "fresh_empty",
      source: null,
      message: `Aucun backup exploitable : base reinitialisee VIERGE (donnees perdues). Erreur initiale: ${originalError.message}`
    };
    // Lot 3 : suspend les backups auto TANT QUE la base reste vide (evite de
    // gzipper du vide et d'evincer d'eventuels backups). writeDb re-arme des la
    // 1ere re-saisie de donnees (sinon perte totale a la 2e corruption).
    backupsSuspendedFreshEmpty = true;
    console.error(`[storage] RECOVERY: ${lastStorageRecovery.message}`);
    pruneOldQuarantineFiles();
    return freshStore;
  } catch (freshError) {
    console.error(
      `[storage] RECOVERY ECHEC TOTAL : impossible de creer une base vierge `
      + `(${freshError.code || freshError.message}). Storage indisponible - `
      + `verifier l'espace disque et les permissions du volume.`
    );
    throw freshError;
  }
}

function closeStorage() {
  if (sqliteStore) {
    // Revue #2 : close() protege. Si close throw (double close, handle invalide
    // apres recovery, EBUSY Windows), on remet quand meme sqliteStore a null
    // pour qu'un getSqliteStore() ulterieur retente une ouverture propre plutot
    // que de garder un store pointant un handle mort.
    try { sqliteStore.close(); } catch { /* handle deja invalide */ }
    sqliteStore = null;
  }
}

function readDb() {
  if (useSqliteStorage()) {
    return getSqliteStore().readDb();
  }

  if (!fs.existsSync(DB_PATH)) {
    writeDb(defaultDb(), { backup: false });
  }

  const raw = fs.readFileSync(DB_PATH, "utf8");
  let db;
  if (!raw) {
    db = defaultDb();
  } else {
    try {
      db = JSON.parse(raw);
    } catch (error) {
      // db.json corrompu (coupure courant pendant ecriture, etc.) :
      // on sauvegarde le fichier corrompu et on redemarre avec une base vierge
      // plutot que de crasher tout le serveur (qui rendrait /login inaccessible).
      const brokenPath = `${DB_PATH}.broken-${safeTimestamp()}`;
      try { fs.copyFileSync(DB_PATH, brokenPath); } catch { /* best-effort */ }
      console.error(`[readDb] db.json corrompu, sauvegarde dans ${brokenPath} - redemarrage en mode vierge :`, error.message);
      db = defaultDb();
    }
  }

  return normalizeDb(db);
}

function normalizeDb(db) {
  db.clients = Array.isArray(db.clients) ? db.clients : [];
  db.ventes = Array.isArray(db.ventes) ? db.ventes : [];
  db.stock = Array.isArray(db.stock) ? db.stock : [];
  db.historique = Array.isArray(db.historique) ? db.historique : [];
  db.commandes = Array.isArray(db.commandes) ? db.commandes : [];
  db.routes = Array.isArray(db.routes) ? db.routes : [];
  db.stockMovements = Array.isArray(db.stockMovements) ? db.stockMovements : [];
  db.importsArchives = Array.isArray(db.importsArchives) ? db.importsArchives : [];
  db.settings = normalizeSettings(db.settings);

  // Migration retroactive v1.9.0 : attribuer un numero aux commandes qui n'en
  // ont pas (legacy avant cette release). Numerotation chronologique par
  // dateImport pour preserver l'ordre historique reel.
  ensureOrderNumbers(db);

  // P1 v1.14.0 : syncWorkflow N'EST PLUS appele ici (avant : a chaque readDb,
  // ce qui ajoutait 50-100ms a chaque requete GET). Il est maintenant appele
  // UNIQUEMENT dans writeDb() avant persistance + au boot du serveur via
  // healDatabaseAtBoot(). Apres tout writeDb la base SQLite est sync, donc
  // les readDb suivants lisent du sync sans recalculer.
  return db;
}

// P1 v1.14.0 : data healing au boot. Si la base SQLite a ete creee par une
// ancienne version sans syncWorkflow OU si elle a ete restauree depuis un
// backup, on s'assure que l'etat est coherent avant d'accepter des requetes.
// Appel unique au demarrage : pas de cout sur les requetes suivantes.
function healDatabaseAtBoot() {
  try {
    const db = readDb();
    syncWorkflow(db);
    // B3 v1.16.0 : si une recovery de corruption a eu lieu pendant le readDb
    // ci-dessus, on la journalise dans l'historique pour que l'operateur la voie
    // (sinon une base vierge ressemble a une install neuve).
    if (lastStorageRecovery) {
      addHistory(db, "Recovery storage", lastStorageRecovery.message, {
        mode: lastStorageRecovery.mode,
        source: lastStorageRecovery.source,
        at: lastStorageRecovery.at
      });
    }
    writeDb(db, { backup: false });
    if (lastStorageRecovery) {
      console.error(`[boot] ATTENTION : recovery storage detectee au demarrage (${lastStorageRecovery.mode}).`);
    } else {
      console.log("[boot] base coherente apres syncWorkflow initial");
    }
  } catch (error) {
    console.error("[boot] healDatabaseAtBoot a echoue :", error.message);
  }
}

function ensureOrderNumbers(db) {
  const missingNumero = db.commandes.filter(order => !order.numero);
  if (missingNumero.length === 0) return;

  // Tri chronologique stable : dateImport asc, fallback createdAt, fallback id
  // pour garantir l'ordre meme sur des dates manquantes.
  missingNumero.sort((a, b) => {
    const dateA = String(a.dateImport || a.createdAt || "");
    const dateB = String(b.dateImport || b.createdAt || "");
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  // Chantier 2 (audit 2026-06-04) : avant ce fix, chaque appel a
  // generateOrderNumber re-scannait TOUS les numeros existants pour trouver
  // le max -> O(M * (N+M)) au boot sur 5000+ commandes (500 ms+).
  //
  // Maintenant : on pre-compute UNE fois le compteur max par annee, et on
  // incremente localement a chaque allocation. O(N+M).
  const settings = normalizeSettings(db.settings || {});
  const { prefix, resetAnnually } = settings.orderNumbering;
  const existingNumeros = db.commandes.map(o => o.numero).filter(Boolean);

  let continuousCounter = 0;
  const counterByYear = new Map();

  if (resetAnnually) {
    const yearPattern = new RegExp(`^${prefix}-(\\d{4})-(\\d+)$`);
    for (const numero of existingNumeros) {
      const match = numero.match(yearPattern);
      if (!match) continue;
      const year = match[1];
      const seq = Number(match[2]);
      if (!Number.isFinite(seq)) continue;
      const current = counterByYear.get(year) || 0;
      if (seq > current) counterByYear.set(year, seq);
    }
  } else {
    const continuousPattern = new RegExp(`^${prefix}-(\\d+)$`);
    for (const numero of existingNumeros) {
      const match = numero.match(continuousPattern);
      if (!match) continue;
      const seq = Number(match[1]);
      if (Number.isFinite(seq) && seq > continuousCounter) continuousCounter = seq;
    }
  }

  missingNumero.forEach(order => {
    if (!order.dateCommande) {
      // Revue R1 MINOR-14 + R3 hardening : forcer YYYY-MM-DD (10 chars).
      const raw = order.dateImport || order.createdAt || new Date().toISOString();
      const dateStr = raw instanceof Date ? raw.toISOString() : String(raw);
      order.dateCommande = dateStr.slice(0, 10);
    }
    if (resetAnnually) {
      const year = String(extractYear(order.dateCommande));
      const next = (counterByYear.get(year) || 0) + 1;
      counterByYear.set(year, next);
      order.numero = `${prefix}-${year}-${String(next).padStart(3, "0")}`;
    } else {
      continuousCounter += 1;
      order.numero = `${prefix}-${String(continuousCounter).padStart(5, "0")}`;
    }
  });
}

function normalizeSettings(settings = {}) {
  const appearance = settings && typeof settings === "object" && settings.appearance && typeof settings.appearance === "object"
    ? settings.appearance
    : {};

  const rawColorScheme = clean(appearance.colorScheme).toLowerCase();
  // Defaut "light" : les utilisateurs sans preference explicite voient le mode clair,
  // ce qui evite un changement visuel surprenant pendant la phase de test du dark mode.
  const colorScheme = VALID_COLOR_SCHEMES.has(rawColorScheme) ? rawColorScheme : "light";

  const orderNumberingRaw = settings && typeof settings === "object" && settings.orderNumbering && typeof settings.orderNumbering === "object"
    ? settings.orderNumbering
    : {};
  // Prefixe alphanumerique 2-8 chars (CMD, ORD, BC, etc.). Defaut CMD.
  const rawPrefix = clean(orderNumberingRaw.prefix).toUpperCase();
  const prefix = /^[A-Z0-9]{2,8}$/.test(rawPrefix) ? rawPrefix : "CMD";
  // resetAnnually par defaut true (standard ERP francais : compteur reset
  // chaque 1er janvier). False = compteur continu (jamais reset).
  const resetAnnually = orderNumberingRaw.resetAnnually !== false;

  // v1.17.1 : parametres tournee calibrables. Defaut 28 km/h + 6 min/arret
  // (estimation initiale apres passage en Haversine). Bornes pour eviter
  // saisies aberrantes : vitesse [10,60] km/h, arret [0,30] min.
  const tourneeRaw = settings && typeof settings === "object" && settings.tournee && typeof settings.tournee === "object"
    ? settings.tournee
    : {};
  const rawSpeed = Number(tourneeRaw.averageSpeedKmh);
  const averageSpeedKmh = Number.isFinite(rawSpeed) && rawSpeed >= 10 && rawSpeed <= 60 ? rawSpeed : 28;
  const rawStop = Number(tourneeRaw.stopDurationMin);
  const stopDurationMin = Number.isFinite(rawStop) && rawStop >= 0 && rawStop <= 30 ? rawStop : 6;

  // Revue R1 NIT-15 + R2 minor : si `settings` est une string corrompue,
  // `...settings` spread les indices de caracteres ("0":"a", "1":"b", ...).
  // Si `settings` est un Array, `typeof === "object"` passe mais on spread
  // les indices numeriques. Protection : objet plain (pas Array).
  const base = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  return {
    ...base,
    appearance: {
      themeId: clean(appearance.themeId) || "sereo",
      brandImage: clean(appearance.brandImage),
      colorScheme
    },
    orderNumbering: {
      prefix,
      resetAnnually
    },
    tournee: {
      averageSpeedKmh,
      stopDurationMin
    }
  };
}

function getAppearanceSettings(db) {
  db.settings = normalizeSettings(db.settings);
  return {
    ...db.settings.appearance
  };
}

function validateBrandImage(value) {
  const brandImage = clean(value);
  if (!brandImage) return "";

  if (brandImage.length > MAX_BRAND_IMAGE_DATA_URL_SIZE) {
    throw badRequest("Image trop lourde");
  }

  if (brandImage.startsWith("/brand/")) return brandImage;

  if (!brandImage.startsWith("data:image/") || !brandImage.includes(";base64,")) {
    throw badRequest("Format d'image invalide");
  }

  return brandImage;
}

// Lot 3 : la base contient-elle des donnees metier reelles ? Sert a re-armer
// les backups apres une recovery fresh_empty (ne re-armer que sur du contenu).
function dbHasData(db) {
  return Boolean(
    (db.commandes && db.commandes.length)
    || (db.clients && db.clients.length)
    || (db.stock && db.stock.length)
    || (db.ventes && db.ventes.length)
  );
}

function writeDb(db, options = {}) {
  const { backup = true } = options;

  syncWorkflow(db);

  // Lot 3 (audit 2026-07-08) : re-armer les backups auto si l'operateur a
  // re-saisi des donnees apres une recovery fresh_empty. Fait AVANT l'ecriture
  // pour que l'entree d'historique soit persistee dans ce meme write.
  let forceReArmBackup = false;
  if (backupsSuspendedFreshEmpty && dbHasData(db)) {
    backupsSuspendedFreshEmpty = false;
    // Revue #84 : on FORCE le backup de re-arm (bypass throttle). Sinon, quand
    // le fresh_empty vient de .gz CORROMPUS laisses sur disque par la recovery
    // (mtime recent), le throttle 1h se cale dessus et les donnees re-saisies
    // ne sont pas sauvegardees pendant ~1h -> fenetre de re-perte totale.
    forceReArmBackup = true;
    addHistory(db, "Stockage", "Backups automatiques reactives : donnees re-saisies apres reinitialisation vierge.");
  }

  // Ecriture des donnees AVANT tout backup : le backup est un filet de
  // securite, pas un prerequis. Si le disque est plein, on veut au moins que
  // l'application echoue sur l'ecriture des donnees (visible) plutot que sur
  // un backup invisible. Cf revue R1 chantier 1 P1 #2.
  if (useSqliteStorage()) {
    getSqliteStore().writeDb(db);
  } else {
    ensureDir(path.dirname(DB_PATH));
    const tempPath = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), "utf8");
    fs.renameSync(tempPath, DB_PATH);
  }

  // Chantier 2 : backup async fire-and-forget. Le main thread ne bloque
  // plus 300-800 ms sur gzipSync d'une base 100 MB — la compression part
  // sur le threadpool libuv via stream pipeline. La requete HTTP repond
  // immediatement apres l'ecriture des donnees.
  //
  // pendingBackup expose une Promise pour les tests qui veulent attendre
  // la fin du backup avant d'assertioner sur le filesystem.
  //
  // Revue #84 : on SERIALISE les backups async (skip si un backup est deja en
  // vol, sauf re-arm force). Deux backups concurrents (fire-and-forget, hors
  // verrou) provoquaient un signal de sante incoherent (un echec tardif
  // ecrasant un succes plus recent) et un risque de torn-read.
  if (backup && (forceReArmBackup || !pendingBackup)) {
    pendingBackup = backupDbIfNeededAsync({ force: forceReArmBackup })
      .catch(backupError => {
        // Lot 3 : tracer l'echec (expose via /api/storage/status) au lieu de le
        // perdre dans les logs -> fin de la "fausse securite" du fire-and-forget.
        lastBackupError = { at: new Date().toISOString(), message: String(backupError.message || backupError) };
        console.error(`[storage] Backup async echec (mutation deja persistee): ${backupError.message || backupError}`);
      })
      .finally(() => { pendingBackup = null; });
  }
}

// Promise du dernier backup async en vol. Utilise par les tests pour
// `await flushPendingBackup()` avant d'assertioner sur le filesystem.
let pendingBackup = null;
async function flushPendingBackup() {
  while (pendingBackup) {
    await pendingBackup;
  }
}

// ============================================================================
// Verrou applicatif global pour les ecritures (Chantier 1, audit 2026-06-04)
// ============================================================================
// Pattern : queue Promise minimaliste sans dependance. Tous les handlers qui
// font le pattern read-mutate-write doivent passer par withWriteLock(async ()
// => { ... }) pour serialiser leurs ecritures. Les LECTURES seules ne
// passent PAS par ici (pas de blocage des GET).
//
// Pourquoi : SQLite BEGIN IMMEDIATE protege l'atomicite SQL mais pas
// l'isolation applicative — `db = readDb(); ...; writeDb(db)` laisse une
// fenetre TOCTOU ou deux requetes lisent le meme snapshot, modifient en
// memoire, puis ecrivent l'une apres l'autre : la 1re ecriture est perdue.
//
// Implementation : une chaine de promesses serialisees. Chaque appel attend
// la fin du precedent (succes OU echec — un fix qui throw ne doit pas
// geler la queue).
//
// Revue R1 chantier 1 (P1 #1) : timeout 60s sur previousQueue ET sur fn(),
// pour eviter qu'un handler bloque (disque defaillant, SQLite verrouille
// indefiniment) ne deadlock toute la chaine d'ecritures. En cas de timeout,
// on log mais on libere le maillon pour ne pas figer les suivants.
const WRITE_LOCK_TIMEOUT_MS = 60000; // 60s — suffit largement pour un import 30MB
let writeQueue = Promise.resolve();

// Promise.race avec setTimeout, MAIS unref pour ne pas retenir le process
// Node a la fin des tests, ET clearTimeout sur succes pour ne pas accumuler
// des handles. Sans cela, chaque withWriteLock laisse un setTimeout actif
// pendant 60s, ce qui empeche `node --test` de quitter rapidement.
async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`withWriteLock: ${label} timeout apres ${ms}ms`)),
      ms
    );
    if (timeoutId.unref) timeoutId.unref();
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function withWriteLock(fn) {
  const previousQueue = writeQueue;
  let resolveNext;
  let rejectNext;
  const next = new Promise((resolve, reject) => {
    resolveNext = resolve;
    rejectNext = reject;
  });
  writeQueue = next.catch(() => {}); // chaine ne meurt jamais

  // Attendre le maillon precedent avec timeout
  try {
    await withTimeout(previousQueue, WRITE_LOCK_TIMEOUT_MS, "previousQueue");
  } catch (err) {
    console.warn(`[lock] previousQueue ${err.message}`);
  }

  // Executer fn() avec timeout
  try {
    const result = await withTimeout(
      Promise.resolve().then(fn),
      WRITE_LOCK_TIMEOUT_MS,
      "fn()"
    );
    resolveNext(result);
    return result;
  } catch (err) {
    rejectNext(err);
    throw err;
  }
}

// Limite la frequence des backups pour ne pas saturer le disque.
// Un backup au plus toutes les BACKUP_THROTTLE_MS, et on conserve uniquement
// les BACKUP_RETENTION plus recents (les plus anciens sont supprimes).
// Les backups sont compresses en gzip pour reduire l'occupation disque
// (typiquement -65% sur une base SQLite).
const BACKUP_THROTTLE_MS = 60 * 60 * 1000; // 1h
const BACKUP_RETENTION = 30;
const BACKUP_FILENAME_PATTERN = /^db-.*\.(sqlite|json)(\.gz)?$/;

function listBackupEntries() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(name => BACKUP_FILENAME_PATTERN.test(name))
    .map(name => {
      const fullPath = path.join(BACKUP_DIR, name);
      try {
        return { name, fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    // Tri par mtime DESC, tie-break sur le nom (qui contient safeTimestamp,
    // donc trie chronologiquement de facon fiable). Sans ce tie-break, 2 backups
    // ecrits dans la meme milliseconde ont le meme mtimeMs -> ordre indetermine
    // -> recovery pourrait restaurer un backup plus ancien (audit B3).
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || b.name.localeCompare(a.name));
}

function pruneOldBackups() {
  const entries = listBackupEntries();
  entries.slice(BACKUP_RETENTION).forEach(entry => {
    try { fs.unlinkSync(entry.fullPath); } catch { /* best-effort */ }
  });
}

// Chantier 1 (2026-06-04) : refonte de la politique post-recovery selon doc
// SQLite + retour d'experience prod (Oldmoe 2024) :
// - mode `fresh_empty` : SUSPENSION maintenue (ne pas gzipper du vide qui
//   evincerait les vrais backups historiques)
// - mode `restored_backup` : faire UN backup IMMEDIAT taggue `post-restore-`
//   pour fermer la fenetre entre l'etat restaure et les futures mutations,
//   PUIS reprendre le throttle 1h normal
// - endpoint manuel /api/backup/now pour forcer un backup hors throttle
let postRestoreBackupDone = false;

function backupDbIfNeeded(options = {}) {
  const { force = false, tag = "" } = options;
  const sourcePath = useSqliteStorage() ? SQLITE_PATH : DB_PATH;
  if (!fs.existsSync(sourcePath)) return null;

  // Cas fresh_empty : pas de backup automatique tant que la base reste vide.
  // Reste possible via /api/backup/now. Lot 3 : gate sur le flag re-armable
  // (leve par writeDb a la re-saisie de donnees), plus sur lastStorageRecovery
  // .mode qui n'etait JAMAIS re-arme (suspension a vie -> perte totale a la 2e
  // corruption).
  if (!force && backupsSuspendedFreshEmpty) {
    return null;
  }

  // Cas restored_backup : faire UN snapshot post-restore une seule fois, puis
  // continuer normalement (audit Sereo 2026-06-04 + SQLite docs). Le snapshot
  // est tagge "post-restore" pour traçabilite forensique.
  //
  // Revue R1 P1 #5 : flag postRestoreBackupDone = true APRES succes, pas
  // avant. Si writeBackupNow throw (disque plein), on doit retenter au
  // prochain writeDb.
  if (!force && lastStorageRecovery && lastStorageRecovery.mode === "restored_backup" && !postRestoreBackupDone) {
    const path = writeBackupNow("post-restore");
    if (path) postRestoreBackupDone = true;
    return path;
  }

  // Throttle normal : skip si un backup recent existe (< 1h).
  if (!force) {
    const entries = listBackupEntries();
    const mostRecent = entries[0];
    if (mostRecent && Date.now() - mostRecent.mtimeMs < BACKUP_THROTTLE_MS) {
      return null;
    }
  }

  return writeBackupNow(tag);
}

// Chantier 2 : variante async pour le hot-path `writeDb`. Meme logique de
// gating mode-aware que la version sync, mais utilise writeBackupNowAsync.
async function backupDbIfNeededAsync(options = {}) {
  const { force = false, tag = "" } = options;
  const sourcePath = useSqliteStorage() ? SQLITE_PATH : DB_PATH;
  if (!fs.existsSync(sourcePath)) return null;

  // Lot 3 : gate sur le flag re-armable (comme la version sync), et non plus
  // sur lastStorageRecovery.mode qui n'etait JAMAIS re-arme -> les backups auto
  // du hot-path writeDb restaient suspendus a vie apres un fresh_empty.
  if (!force && backupsSuspendedFreshEmpty) {
    return null;
  }
  if (!force && lastStorageRecovery && lastStorageRecovery.mode === "restored_backup" && !postRestoreBackupDone) {
    const p = await writeBackupNowAsync("post-restore");
    if (p) postRestoreBackupDone = true;
    return p;
  }
  if (!force) {
    const entries = listBackupEntries();
    const mostRecent = entries[0];
    if (mostRecent && Date.now() - mostRecent.mtimeMs < BACKUP_THROTTLE_MS) {
      return null;
    }
  }
  return writeBackupNowAsync(tag);
}

function writeBackupNow(tag = "") {
  const sourcePath = useSqliteStorage() ? SQLITE_PATH : DB_PATH;
  if (!fs.existsSync(sourcePath)) return null;

  ensureDir(BACKUP_DIR);
  if (useSqliteStorage()) {
    getSqliteStore().checkpoint();
  }

  const baseExtension = useSqliteStorage() ? ".sqlite" : ".json";
  const tagPart = tag ? `-${tag.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  const backupPath = path.join(BACKUP_DIR, `db-${safeTimestamp()}${tagPart}${baseExtension}.gz`);

  const sourceData = fs.readFileSync(sourcePath);
  const compressed = zlib.gzipSync(sourceData);
  fs.writeFileSync(backupPath, compressed);

  pruneOldBackups();
  lastBackupAt = new Date().toISOString();
  lastBackupError = null;
  return backupPath;
}

// Chantier 2 (audit 2026-06-04) : variante async via stream pipeline.
// `zlib.createGzip()` delegue la compression au threadpool libuv (Node docs
// confirme), donc le main thread reste libre pour les requetes HTTP pendant
// le backup. Sur 50-100 MB c'etait 300-800 ms de freeze, maintenant ~5 ms
// d'overhead non-bloquant.
//
// Pattern recommande (Dennis O'Keeffe 2024) : ecriture vers tmp, rename
// atomique, cleanup best-effort si le pipeline echoue.
//
// Sync writeBackupNow garde sa raison d'etre : boot post-recovery (avant que
// le serveur n'accepte des requetes, le freeze n'a pas d'impact) + tests.
async function writeBackupNowAsync(tag = "") {
  const sourcePath = useSqliteStorage() ? SQLITE_PATH : DB_PATH;
  if (!fs.existsSync(sourcePath)) return null;

  ensureDir(BACKUP_DIR);
  if (useSqliteStorage()) {
    getSqliteStore().checkpoint();
  }

  const baseExtension = useSqliteStorage() ? ".sqlite" : ".json";
  const tagPart = tag ? `-${tag.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  const backupPath = path.join(BACKUP_DIR, `db-${safeTimestamp()}${tagPart}${baseExtension}.gz`);
  const tmpPath = backupPath + ".tmp";

  try {
    const { pipeline } = require("node:stream/promises");
    await pipeline(
      fs.createReadStream(sourcePath),
      zlib.createGzip({ level: 6 }), // 6 = defaut, bon ratio/CPU
      fs.createWriteStream(tmpPath)
    );
    fs.renameSync(tmpPath, backupPath); // atomique
    pruneOldBackups();
    lastBackupAt = new Date().toISOString();
    lastBackupError = null;
    return backupPath;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
    throw err;
  }
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function addHistory(db, type, message, details = {}) {
  db.historique.unshift({
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    type,
    message,
    details
  });
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeHeader(value) {
  return normalizeTextKey(value);
}

function normalizeTextKey(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCase(value) {
  const text = clean(value);
  if (!text) return "";

  return text
    .toLowerCase()
    .split(/\s+/)
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : "")
    .join(" ");
}

function normalizeCity(value) {
  const key = normalizeTextKey(value);

  if (!key) return "";
  if (key === "besancon") return "Besancon";
  if (key === "champagnole") return "Champagnole";
  if (key === "dole") return "Dole";

  return titleCase(value);
}

function deriveSector(city, explicitSector = "") {
  const explicit = normalizeTextKey(explicitSector);
  const cityKey = normalizeTextKey(city);
  const key = explicit || cityKey;

  if (!key) return "Sans secteur";
  if (key.includes("besancon")) return "Besancon";
  if (key.includes("champagnole")) return "Champagnole";
  if (key === "dole" || key.includes("dole")) return "Dole";

  return titleCase(explicitSector || city);
}

function number(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function optionalQuantity(value) {
  if (clean(value) === "") return null;
  return Math.max(0, number(value, 0));
}

// M2 (v1.16.1) : quantite a l'import = number() clampe a >= 0. Une qty Excel
// negative ou "abc" ne doit pas se propager en commande (sinon fausse les
// calculs de stock disponible / reserve). Le PATCH /api/stock filtre deja les
// negatifs en rejet 400 ; les imports en masse clampent silencieusement a 0
// (compromis : pas d'erreur globale qui bloquerait 5000 lignes pour 1 -5).
function importQuantity(value, fallback = 0) {
  return Math.max(0, number(value, fallback));
}

function excelDate(value) {
  if (!value) return "";

  if (value instanceof Date) {
    return value.toLocaleDateString("fr-FR");
  }

  if (typeof value === "number") {
    // Meme borne que normalizeDateInput/excelDateToIso : un serial aberrant
    // (> ~an 2119) ou negatif ne doit pas produire une date d'affichage
    // fantaisiste (ex: "01/01/3268") ni "Invalid Date".
    if (!Number.isFinite(value) || value < 0 || value > 80000) return "";
    const date = new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000);
    return date.toLocaleDateString("fr-FR", { timeZone: "UTC" });
  }

  return clean(value);
}

// Variante ISO (YYYY-MM-DD) de excelDate. Utilisee pour dateCommande qui doit
// etre stockee en format normalise pour permettre le tri, le filtrage et
// l'identification d'une commande par (clientId, dateCommande). L'affichage
// dans l'UI se fera selon les settings locale du user (Phase 5).
function excelDateToIso(value) {
  // M1 v1.16.1 (revue) : delegue ENTIEREMENT a normalizeDateInput sur tous les
  // paths (texte, Date object, number Excel epoch) pour beneficier de la
  // validation round-trip + bornes [1900,2199]. Avant : Date/number sortaient
  // sans validation -> dateCommandeIso pouvait valoir "3000-01-01" et creer
  // un bucket ERP fantome.
  return normalizeDateInput(value);
}

function normalizeDateInput(value) {
  if (!value) return "";

  if (value instanceof Date) {
    return validateAndFormatYMD(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number") {
    // Excel epoch (1899-12-30). Borne le serial number a une plage realiste pour
    // eviter qu'une valeur aberrante (ex: 99999 = an 2173) ne se faufile.
    if (!Number.isFinite(value) || value < 0 || value > 80000) return "";
    const date = new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000);
    return validateAndFormatYMD(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = clean(value);
  if (!text) return "";

  // M1 (v1.16.1) : on extrait d'abord les composants (ISO ou FR), PUIS on
  // valide qu'ils forment une date reellement existante via round-trip Date
  // (sinon "31/13/2026", "30/02/2026", "29/02/2025" etaient acceptes -> fausse
  // date stockee et bucketing ERP par date incoherent).
  let y, m, d;
  // Accepte un ISO date (YYYY-MM-DD) avec un suffixe horaire optionnel
  // ("2026-05-05T10:00:00.000Z" ou "2026-05-05 10:00") : on tronque a la date.
  // Sans ca, un ISO datetime valide etait rejete (-> "") puis mute vers today
  // par normalizeOrder (P0 audit 2026-07-08). Le suffixe DOIT commencer par
  // "T" ou espace, donc "2026-05-05abc" reste rejete.
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (isoMatch) {
    y = Number(isoMatch[1]); m = Number(isoMatch[2]); d = Number(isoMatch[3]);
  } else {
    const fr = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (!fr) return "";
    d = Number(fr[1]); m = Number(fr[2]);
    // M1 (revue) : pivot 2 chiffres. "01/01/99" doit etre 1999 (legacy
    // commercial), pas 2099. Convention : <=30 -> 20XX, sinon 19XX.
    if (fr[3].length === 2) {
      const yy = Number(fr[3]);
      y = yy <= 30 ? 2000 + yy : 1900 + yy;
    } else {
      y = Number(fr[3]);
    }
  }

  return validateAndFormatYMD(y, m, d);
}

// Helper M1 : validation round-trip + formatage YYYY-MM-DD. Centralise la
// validation pour qu'elle s'applique aussi au path number/Date (Excel epoch,
// Date object) - pas seulement au path texte.
function validateAndFormatYMD(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2199) return "";
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return "";
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function readExcelRows(filePath) {
  try {
    const parsed = await readXlsxFile(filePath);
    const rows = Array.isArray(parsed[0]) ? parsed : (parsed[0]?.data || []);

    if (!rows.length) {
      throw badRequest("Fichier Excel vide ou invalide");
    }

    return rows;
  } catch (error) {
    if (error.statusCode) throw error;
    throw badRequest("Fichier Excel invalide ou illisible");
  }
}

function findHeaderRow(rows, requiredHeaders) {
  return rows.findIndex(row => {
    const normalizedRow = Array.isArray(row) ? row.map(normalizeHeader) : [];
    return requiredHeaders.every(header => normalizedRow.includes(normalizeHeader(header)));
  });
}

function findHeaderRowGroups(rows, requiredGroups) {
  return rows.findIndex(row => {
    const normalizedRow = Array.isArray(row) ? row.map(normalizeHeader) : [];
    return requiredGroups.every(group => group.some(header => normalizedRow.includes(normalizeHeader(header))));
  });
}

function getIndex(headers, name, occurrence = 1) {
  let count = 0;
  const normalizedName = normalizeHeader(name);

  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeader(headers[i]) === normalizedName) {
      count++;
      if (count === occurrence) return i;
    }
  }

  return -1;
}

function getCell(row, headers, name, occurrence = 1) {
  const index = getIndex(headers, name, occurrence);
  return index >= 0 ? row[index] : "";
}

function getCellByNames(row, headers, names) {
  for (const name of names) {
    const value = getCell(row, headers, name, 1);
    if (clean(value) !== "") return value;
  }

  return "";
}

function parseCoordinate(value, min, max) {
  const text = clean(value);

  if (text === "") {
    return {
      ok: true,
      value: ""
    };
  }

  const parsed = Number(text.replace(",", "."));

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return {
      ok: false,
      value: ""
    };
  }

  return {
    ok: true,
    value: parsed
  };
}

function getCoordinateValue(value, min, max) {
  const parsed = parseCoordinate(value, min, max);
  return parsed.ok ? parsed.value : "";
}

function getCoordinates(entity) {
  const lat = parseCoordinate(entity.lat ?? entity.latitude, -90, 90);
  const lng = parseCoordinate(entity.lng ?? entity.longitude, -180, 180);

  if (!lat.ok || !lng.ok || lat.value === "" || lng.value === "") return null;

  return {
    lat: lat.value,
    lng: lng.value
  };
}

function clientKey(value) {
  return [
    clean(value.nom || value.client || value.clientName),
    clean(value.rue || value.address),
    clean(value.codePostal || value.postalCode),
    clean(value.ville || value.city)
  ].join("|").toLowerCase();
}

// Cle secondaire (nom + code postal, normalises) pour rattraper les doublons
// causes par des variations mineures de saisie (espaces, virgules, accents)
// que clientKey() laisse passer. Vide si nom OU CP manque.
function clientSecondaryKey(value) {
  const nom = normalizeTextKey(value.nom || value.client || value.clientName || "");
  const cp = normalizeTextKey(value.codePostal || value.postalCode || "");
  if (!nom || !cp) return "";
  return `${nom}|${cp}`;
}

function getRouteClientIds(db) {
  const ids = new Set();

  db.routes.forEach(route => {
    (route.stops || []).forEach(stop => {
      if (stop.clientId !== undefined && stop.clientId !== null) {
        ids.add(String(stop.clientId));
      }
    });
  });

  return ids;
}

function shouldPreserveClientAfterImport(client, order, routeClientIds) {
  const clientId = String(client?.id ?? "");
  if (!clientId) return false;
  if (routeClientIds.has(clientId)) return true;
  if (!order) return false;
  if (order.routeId) return true;

  return [
    "en_preparation",
    "preparation_terminee",
    "pret_livraison",
    "en_livraison",
    "livre",
    "probleme_livraison",
    "a_reprogrammer"
  ].includes(order.status);
}

function mergeImportedClients(db, importedClients) {
  const importedKeys = new Set(importedClients.map(client => clientKey(client)));
  // Map secondaire : cle nom+CP normalises -> client importe correspondant.
  // Permet de rattraper les doublons quand l'adresse rue diverge legerement
  // (virgule, espace, casse) entre la BDD et le fichier Excel.
  const importedSecondaryKeys = new Map();
  importedClients.forEach(client => {
    const secondary = clientSecondaryKey(client);
    if (secondary && !importedSecondaryKeys.has(secondary)) {
      importedSecondaryKeys.set(secondary, client);
    }
  });

  const routeClientIds = getRouteClientIds(db);
  const existingOrders = new Map(db.commandes.map(order => [String(order.clientId), order]));

  // Phase 1 : pour chaque client existant en DB qui ne match PAS en strict
  // mais match en secondaire, propager son id vers le client importe pour
  // preserver les references dans commandes/routes/stops.
  let mergedBySecondary = 0;
  db.clients.forEach(existing => {
    if (importedKeys.has(clientKey(existing))) return;
    const secondary = clientSecondaryKey(existing);
    if (!secondary) return;
    const importedTwin = importedSecondaryKeys.get(secondary);
    if (!importedTwin) return;
    importedTwin.id = existing.id;
    importedKeys.add(clientKey(importedTwin));
    mergedBySecondary += 1;
  });

  // Phase 2 : preservation des clients en workflow actif qui ne sont
  // dans AUCUN des deux match (strict ou secondaire).
  const preservedClients = db.clients.filter(client => {
    if (importedKeys.has(clientKey(client))) return false;
    const secondary = clientSecondaryKey(client);
    if (secondary && importedSecondaryKeys.has(secondary)) return false;
    return shouldPreserveClientAfterImport(client, existingOrders.get(String(client.id)), routeClientIds);
  });

  return {
    clients: [...importedClients, ...preservedClients],
    preservedCount: preservedClients.length,
    mergedBySecondary
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function handleRouteError(error, res, fallbackMessage) {
  const status = error.statusCode || 500;

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    error: status >= 500 ? fallbackMessage : error.message
  });
}

function cleanupUploadedFile(filePath) {
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(error);
  }
}

// v1.12.0 : copie le fichier Excel uploade dans /app/data/imports-archives/
// (persistant) avec un nom horodate et ajoute une entree de metadata dans
// db.importsArchives pour retelechargement futur. Doit etre appelee AVANT
// cleanupUploadedFile sinon le fichier est deja supprime.
function archiveImportFile(req, db, type, stats = {}) {
  if (!req?.file?.path) return null;

  try {
    if (!fs.existsSync(IMPORTS_ARCHIVES_DIR)) {
      fs.mkdirSync(IMPORTS_ARCHIVES_DIR, { recursive: true });
    }

    const sourcePath = req.file.path;
    const originalName = req.file.originalname || "import.xlsx";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    // Nom safe : alphanumerique + tirets seulement, ascii only
    const safeName = String(originalName)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80);
    const archivedFilename = `${timestamp}_${type}_${safeName}`;
    const archivedPath = path.join(IMPORTS_ARCHIVES_DIR, archivedFilename);

    fs.copyFileSync(sourcePath, archivedPath);

    const stat = fs.statSync(archivedPath);
    const fileBuffer = fs.readFileSync(archivedPath);
    const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    const archiveEntry = {
      id: `import-${timestamp}-${crypto.randomUUID().slice(0, 8)}`,
      type,
      filename: originalName,
      archivedFilename,
      archivedPath,
      importedAt: new Date().toISOString(),
      rowsCount: Number(stats.rowsCount || 0),
      fileSize: stat.size,
      sha256,
      stats: stats || {}
    };

    db.importsArchives = db.importsArchives || [];
    db.importsArchives.push(archiveEntry);

    return archiveEntry;
  } catch (error) {
    // L'archivage est best-effort : si ca echoue, on ne casse pas l'import.
    console.error("Erreur archivage import :", error);
    return null;
  }
}

function uploadExcel(req, res, next) {
  upload.single("file")(req, res, error => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Fichier trop volumineux, limite 10 Mo" });
      }

      return handleRouteError(error, res, "Erreur upload fichier");
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Fichier Excel manquant"
      });
    }

    next();
  });
}

function getStockQuantity(product) {
  const value = product.quantite ?? product.stock ?? product.Stock ?? product.qte;
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function setStockQuantity(product, value) {
  product.quantite = Math.max(0, Math.round(Number(value) * 100) / 100);
}

function getProductName(product) {
  return clean(product.nom || product.Nom || product.produit || product.Produit || product.productName || "Produit");
}

function getProductCode(product) {
  return clean(product.code || product.sku || product.reference);
}

function productKey(product) {
  if (!product || typeof product !== "object") return "";
  const code = normalizeTextKey(
    product.code || product.codeProduit || product.sku || product.reference || ""
  );
  const nom = normalizeTextKey(
    product.nom || product.Nom || product.produit || product.Produit || product.name || product.productName || ""
  );
  return code || nom;
}

// Set des statuts facture (apres normalizeTextKey) qui signalent une vente
// deja livree dans le systeme source. Permet d'importer la commande
// directement comme "livre" sans la faire passer par la file de preparation.
const FACTURE_STATUS_LIVRE = new Set(["envoyee", "envoye", "expediee", "expedie", "sent"]);

function isFactureStatusLivre(rawStatut) {
  return FACTURE_STATUS_LIVRE.has(normalizeTextKey(rawStatut || ""));
}

function getStockAlertThreshold(product) {
  const raw = product.alertThreshold ?? product.seuilAlerte ?? product.seuil ?? product.minimum;
  const threshold = number(raw, 5);
  return Math.max(0, threshold);
}

function stockItemMatchesLine(product, line) {
  const productCode = normalizeTextKey(getProductCode(product));
  const productName = normalizeTextKey(getProductName(product));
  const lineCode = normalizeTextKey(line.code || line.sku || line.reference);
  const lineName = normalizeTextKey(line.nom || line.produit || line.productName || line.name);

  return Boolean(
    (productCode && lineCode && productCode === lineCode)
    || (productName && lineName && productName === lineName)
  );
}

function getQuantityForProductInOrder(product, order) {
  return normalizeProducts(order.products).reduce((total, line) => {
    if (!stockItemMatchesLine(product, line)) return total;
    return total + Math.max(0, number(line.quantite, 0));
  }, 0);
}

// Chantier 1 (2026-06-04) : ajout "probleme_livraison" et "a_reprogrammer"
// dans la liste des statuts qui MAINTIENNENT la reservation. Avant ce fix,
// `reserveStockForOrder` deduisait physiquement le stock mais
// `calculateReservedStock` excluait ces statuts de la metrique reserved —
// asymetrie comptable invisible (stock dispo affiche > stock physique reel).
//
// Pattern ERP standard (Odoo unrelease, ERPNext stock reservation) : un
// echec de livraison ne libere PAS la reservation (livraison client absent
// = relivraison sous 24-72h sur meme stock). Pour annuler une reservation,
// utiliser l'endpoint explicite POST /api/orders/:id/release-stock.
const RESERVED_ORDER_STATUSES = [
  "en_preparation",
  "preparation_terminee",
  "pret_livraison",
  "en_livraison",
  "probleme_livraison",
  "a_reprogrammer"
];

// Chantier 2 (audit 2026-06-04) : pre-compute des metriques stock en
// single-pass O(N+M) au lieu de N*M reduce imbriques par produit.
//
// Avant : enrichStockItem(db, product) appele 100 fois -> chaque appel re-itere
// sur db.commandes (1000) -> 100 000 iterations par GET /api/stock + chaque
// iteration normalizeProducts l'order et resolve la match line par produit
// (~5 op) = 500 000+ op effectives. /api/dashboard re-execute.
//
// Apres : buildStockMetricsIndex parcourt commandes UNE SEULE FOIS et accumule
// dans une Map<productKey, {reserved, needed}>. Puis enrichStockItem lit en
// O(1). Total : ~N+M = 1100 iterations + (N * Map.get O(1)).
//
// Statuts qui comptent dans "needed" (commandes a preparer/livrer).
const NEEDED_ORDER_STATUSES = new Set([
  "importe",
  "stock_a_verifier",
  "en_preparation",
  "pret_livraison"
]);

// Construit l'index agrege en un seul parcours des commandes.
//
// Revue R1 chantier 2 P0 #1 + #2 : design composite-key.
// L'ancien design (deux Maps separees code: et name:) avait deux bugs :
// - SOUS-COMPTAGE : ligne A (code='A1', sans nom) + ligne B (sans code,
//   nom='Produit A') referencent le meme produit -> seule l'une des deux
//   etait comptee au lookup (premier match l'emportait).
// - SUR-COMPTAGE : deux produits stock partageant le meme code (legal mais
//   pas unique) -> tous deux voyaient la meme quantite reservee.
//
// Nouveau design :
// - Chaque ligne est canonisee en une cle `code|nom` (les deux normalises).
// - Trois Map : { totals: canonicalKey -> {reserved, needed},
//                 byCode: codeNorm -> Set<canonicalKey>,
//                 byName: nameNorm -> Set<canonicalKey> }
// - Au lookup d'un produit : on collecte TOUTES les cles candidates via
//   byCode[productCode] ET byName[productName], on les dedup, on somme.
//
// Correctness : `stockItemMatchesLine` sert de reference (OR sur code/name).
// L'index reproduit fidelement sa semantique en O(N+M) au lieu de O(N*M).
function buildStockMetricsIndex(commandes) {
  const totals = new Map(); // canonicalKey -> { reserved, needed }
  const byCode = new Map(); // codeNorm -> Set<canonicalKey>
  const byName = new Map(); // nameNorm -> Set<canonicalKey>

  const ensureCanonical = (canonicalKey) => {
    let slot = totals.get(canonicalKey);
    if (!slot) {
      slot = { reserved: 0, needed: 0 };
      totals.set(canonicalKey, slot);
    }
    return slot;
  };
  const addReverse = (map, key, canonicalKey) => {
    if (!key) return;
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    set.add(canonicalKey);
  };

  for (const order of commandes || []) {
    const isReserved = Boolean(order.stockReservedAt && RESERVED_ORDER_STATUSES.includes(order.status));
    const isNeeded = NEEDED_ORDER_STATUSES.has(order.status);
    if (!isReserved && !isNeeded) continue;

    for (const line of normalizeProducts(order.products)) {
      const qty = Math.max(0, number(line.quantite, 0));
      if (qty <= 0) continue;

      const codeNorm = normalizeTextKey(line.code || line.sku || line.reference);
      const nameNorm = normalizeTextKey(line.nom || line.produit || line.productName || line.name);
      if (!codeNorm && !nameNorm) continue;

      // Cle canonique = couple (code, name). Chaque ligne contribue exactement
      // une fois a son slot canonique, plus est indexee inversement.
      const canonicalKey = (codeNorm || "_") + "|" + (nameNorm || "_");
      const slot = ensureCanonical(canonicalKey);
      if (isReserved) slot.reserved += qty;
      if (isNeeded) slot.needed += qty;

      addReverse(byCode, codeNorm, canonicalKey);
      addReverse(byName, nameNorm, canonicalKey);
    }
  }
  return { totals, byCode, byName };
}

// Lookup correct : reproduit stockItemMatchesLine (match si code OR name).
// On collecte les cles canoniques candidates via les deux index inverses,
// dedup via Set, somme les totaux. Pas de double-comptage car chaque slot
// canonique n'est sommé qu'une fois meme s'il appartient aux 2 inverses.
function lookupStockMetric(index, product, kind) {
  if (!index || !index.totals) return 0;
  const codeNorm = normalizeTextKey(getProductCode(product));
  const nameNorm = normalizeTextKey(getProductName(product));
  if (!codeNorm && !nameNorm) return 0;

  const candidates = new Set();
  if (codeNorm) {
    const fromCode = index.byCode.get(codeNorm);
    if (fromCode) for (const k of fromCode) candidates.add(k);
  }
  if (nameNorm) {
    const fromName = index.byName.get(nameNorm);
    if (fromName) for (const k of fromName) candidates.add(k);
  }
  let total = 0;
  for (const k of candidates) {
    const slot = index.totals.get(k);
    if (slot) total += slot[kind] || 0;
  }
  return total;
}

// Garde l'API publique (utilisee par les tests). Sans index, recompose
// l'ancien algorithme N*M. Avec index, lookup O(matches) tres rapide.
function calculateReservedStock(db, product, index) {
  if (index && index.totals) return lookupStockMetric(index, product, "reserved");
  return db.commandes.reduce((total, order) => {
    const isReserved = Boolean(order.stockReservedAt && RESERVED_ORDER_STATUSES.includes(order.status));
    return isReserved ? total + getQuantityForProductInOrder(product, order) : total;
  }, 0);
}

function calculateNeededStock(db, product, index) {
  if (index && index.totals) return lookupStockMetric(index, product, "needed");
  return db.commandes.reduce((total, order) => {
    if (!NEEDED_ORDER_STATUSES.has(order.status)) return total;
    return total + getQuantityForProductInOrder(product, order);
  }, 0);
}

function getStockStatus(product, db, index) {
  const quantity = getStockQuantity(product);

  if (quantity === null) return "a_renseigner";
  if (quantity <= 0) return "rupture";
  if (quantity <= getStockAlertThreshold(product)) return "stock_faible";
  if (db && calculateReservedStock(db, product, index) > 0) return "reserve";
  return "disponible";
}

// Signature etendue : `index` est optionnel. S'il est passe (typique via
// getStockView), tout est en O(1). Sans (call-site isole), comportement
// legacy N*M (correct mais lent).
function enrichStockItem(db, product, index) {
  const quantityAvailable = getStockQuantity(product);
  const quantityReserved = calculateReservedStock(db, product, index);
  const quantityNeeded = calculateNeededStock(db, product, index);

  return {
    ...product,
    sku: product.sku || product.reference || product.code || "",
    category: product.category || product.categorie || product.type || "",
    quantityAvailable,
    quantityReserved,
    quantityNeeded,
    quantityTotal: quantityAvailable === null ? null : quantityAvailable + quantityReserved,
    alertThreshold: getStockAlertThreshold(product),
    stockStatus: getStockStatus(product, db, index)
  };
}

function getStockView(db) {
  // Construit l'index UNE seule fois, puis lookup O(1) par produit.
  const index = buildStockMetricsIndex(db.commandes);
  return db.stock.map(product => enrichStockItem(db, product, index));
}

function getRecommendations(db) {
  return getStockView(db)
    .filter(product => ["stock_faible", "rupture", "a_renseigner"].includes(product.stockStatus))
    .map(product => {
      const available = Number(product.quantityAvailable) || 0;
      const needed = Number(product.quantityNeeded) || 0;
      // Seuil 0 legitime preserve : on ne le remplace par 5 que si la valeur est invalide
      // (null, undefined, NaN, "" -> non finite). Cf. fix v1.1.0 sur normalizeProducts.
      const thresholdRaw = Number(product.alertThreshold);
      const minimum = Number.isFinite(thresholdRaw) ? thresholdRaw : 5;
      const recommended = Math.max(0, Math.ceil(Math.max(minimum - available, needed - available)));

      return {
        ...product,
        recommendedQuantity: recommended,
        recommendationStatus: product.stockStatus === "rupture" ? "urgent" : "bientot"
      };
    });
}

function recordStockMovement(db, product, oldQuantity, newQuantity, reason = "Ajustement manuel") {
  if (oldQuantity === newQuantity) return;

  db.stockMovements.unshift({
    id: `stock-${crypto.randomUUID()}`,
    productId: product.id,
    productName: getProductName(product),
    sku: getProductCode(product),
    type: newQuantity >= oldQuantity ? "entree" : "sortie",
    quantity: Math.round(Math.abs(newQuantity - oldQuantity) * 100) / 100,
    oldQuantity,
    newQuantity,
    reason: clean(reason) || "Ajustement manuel",
    createdAt: new Date().toISOString(),
    createdBy: "local"
  });
}

function getDashboardSummary(db) {
  const stockView = getStockView(db);
  const today = new Date().toISOString().slice(0, 10);
  const orderCounts = {
    imported: db.commandes.length,
    toCheck: db.commandes.filter(order => ["importe", "stock_a_verifier"].includes(order.status)).length,
    preparable: db.commandes.filter(order => ["importe", "stock_a_verifier"].includes(order.status) && order.canPrepare).length,
    blocked: db.commandes.filter(order => ["importe", "stock_a_verifier"].includes(order.status) && !order.canPrepare).length,
    preparing: db.commandes.filter(order => order.status === "en_preparation").length,
    readyDelivery: db.commandes.filter(order => order.status === "pret_livraison").length,
    inDelivery: db.commandes.filter(order => order.status === "en_livraison").length,
    delivered: db.commandes.filter(order => order.status === "livre").length,
    deliveryProblems: db.commandes.filter(order => ["probleme_livraison", "a_reprogrammer"].includes(order.status)).length,
    missingAddress: db.commandes.filter(order => !clean(order.address) || !clean(order.city)).length,
    missingPhone: db.commandes.filter(order => !clean(order.phone)).length,
    deliveryToday: db.commandes.filter(order => order.deliveryDate === today && ["pret_livraison", "en_livraison"].includes(order.status)).length,
    deliveryUpcoming: db.commandes.filter(order => order.deliveryDate && order.deliveryDate > today && ["pret_livraison", "en_livraison"].includes(order.status)).length
  };
  const stockCounts = {
    total: stockView.length,
    ok: stockView.filter(product => product.stockStatus === "disponible").length,
    low: stockView.filter(product => product.stockStatus === "stock_faible").length,
    out: stockView.filter(product => product.stockStatus === "rupture").length,
    reserved: stockView.filter(product => product.stockStatus === "reserve").length,
    unknown: stockView.filter(product => product.stockStatus === "a_renseigner").length,
    needed: stockView.reduce((total, product) => total + (Number(product.quantityNeeded) || 0), 0)
  };
  const alerts = [
    ...stockView
      .filter(product => ["stock_faible", "rupture", "a_renseigner"].includes(product.stockStatus))
      .map(product => ({
        type: "stock",
        level: product.stockStatus === "rupture" ? "danger" : "warning",
        title: getProductName(product),
        message: product.stockStatus === "rupture"
          ? "Produit en rupture de stock."
          : `Stock a verifier : ${product.quantityAvailable ?? "non renseigne"}.`
      })),
    ...db.commandes
      .filter(order => ["importe", "stock_a_verifier"].includes(order.status) && !order.canPrepare)
      .map(order => ({
        type: "commande",
        level: "danger",
        title: order.clientName,
        message: `Commande bloquee : stock ${order.stockStatus}.`
      })),
    ...db.commandes
      .filter(order => !clean(order.address) || !clean(order.city) || !clean(order.phone))
      .map(order => ({
        type: "donnees",
        level: "warning",
        title: order.clientName,
        message: !clean(order.address) || !clean(order.city)
          ? "Adresse incomplete."
          : "Telephone manquant."
      }))
  ];

  return {
    orders: orderCounts,
    stock: stockCounts,
    alerts: alerts.slice(0, 20),
    routes: {
      draft: db.routes.filter(route => ["brouillon", "prete"].includes(route.status)).length,
      active: db.routes.filter(route => route.status === "en_livraison").length,
      completed: db.routes.filter(route => route.status === "terminee").length
    }
  };
}

function productKeyFromLine(line) {
  const code = normalizeTextKey(line.code || line.sku || line.reference);
  if (code) return `code:${code}`;
  return `name:${normalizeTextKey(line.nom || line.produit || line.productName)}`;
}

// ============================================================================
// ERP v1.9.0 : numerotation bons de commande + detection doublons re-import
// ============================================================================

// Extrait l'annee d'une date ISO ou FR. Retourne new Date().getFullYear() en
// fallback pour ne jamais bloquer sur un format inconnu.
function extractYear(dateString) {
  if (!dateString) return new Date().getFullYear();
  const str = String(dateString);
  // Format ISO ou ISO-like : "2026-05-18" / "2026-05-18T..." / "2026/05/18"
  const isoMatch = str.match(/^(\d{4})[-/]/);
  if (isoMatch) return Number(isoMatch[1]);
  // Format francais : "18/05/2026" ou "18-05-2026"
  const frMatch = str.match(/^\d{1,2}[/-]\d{1,2}[/-](\d{4})/);
  if (frMatch) return Number(frMatch[1]);
  return new Date().getFullYear();
}

// Genere le prochain numero de commande au format PREFIX-YYYY-NNN (reset
// annuel) ou PREFIX-NNNNN (continu). Le compteur est calcule a la volee
// depuis MAX(numero) en DB, ce qui evite un compteur en cache qui pourrait
// driver. Convient bien pour Sereo (volume B2B faible, < 10000 commandes/an).
//
// Format reset annuel    : CMD-2026-001, CMD-2026-002, ..., CMD-2027-001
// Format continu (jamais) : CMD-00001, CMD-00002, ..., CMD-12847
function generateOrderNumber(db, dateCommande) {
  const settings = normalizeSettings(db.settings || {});
  const { prefix, resetAnnually } = settings.orderNumbering;
  const existingNumeros = (db.commandes || [])
    .map(order => order.numero)
    .filter(Boolean);

  if (!resetAnnually) {
    // Compteur continu : extraire le plus grand suffixe numerique tout prefixe confondu
    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    const maxSeq = existingNumeros.reduce((max, numero) => {
      const match = numero.match(pattern);
      if (!match) return max;
      const seq = Number(match[1]);
      return Number.isFinite(seq) && seq > max ? seq : max;
    }, 0);
    return `${prefix}-${String(maxSeq + 1).padStart(5, "0")}`;
  }

  // Reset annuel : compteur par annee
  const year = extractYear(dateCommande);
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const maxSeq = existingNumeros.reduce((max, numero) => {
    const match = numero.match(pattern);
    if (!match) return max;
    const seq = Number(match[1]);
    return Number.isFinite(seq) && seq > max ? seq : max;
  }, 0);
  return `${prefix}-${year}-${String(maxSeq + 1).padStart(3, "0")}`;
}

// Hash deterministe d'une commande pour detecter les doublons au re-import.
// Combine clientId + dateCommande + lignes produits (code/nom + quantite).
// Deux imports identiques produisent le meme hash -> on peut skip silencieusement.
// Utilise SHA-256 de la chaine canonique pour minimiser les collisions.
function computeOrderHash({ clientId, dateCommande, products }) {
  const safeClientId = String(clientId || "");
  const safeDate = String(dateCommande || "").slice(0, 10); // YYYY-MM-DD ou DD/MM/YYYY
  const safeProducts = (Array.isArray(products) ? products : [])
    .map(p => {
      const code = normalizeTextKey(p.code || p.sku || p.reference);
      const nom = normalizeTextKey(p.nom || p.produit || p.productName);
      const key = code || nom;
      const qty = Number(p.quantite ?? p.quantity ?? 0);
      return `${key}:${qty}`;
    })
    .filter(Boolean)
    .sort()
    .join("|");
  const canonical = `${safeClientId}#${safeDate}#${safeProducts}`;
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function stockLookup(stock) {
  const map = new Map();

  stock.forEach(item => {
    const code = normalizeTextKey(item.code || item.sku || item.reference);
    const name = normalizeTextKey(getProductName(item));

    if (code) map.set(`code:${code}`, item);
    if (name) map.set(`name:${name}`, item);
  });

  return map;
}

function normalizeProducts(products) {
  if (!Array.isArray(products)) return [];

  return products
    .map((product, index) => {
      const isObject = product && typeof product === "object";
      const code = clean(isObject ? product.code || product.sku || product.reference : "");
      const name = clean(isObject ? product.nom || product.produit || product.productName || product.name : product);
      // Math.max(0, ...) au lieu de Math.max(1, ...) : une quantite 0 est conservee telle quelle
      // pour ne pas masquer les saisies invalides ou volontairement nulles. On utilise `??`
      // au lieu de `||` pour ne pas confondre 0 (valide) avec null/undefined (fallback).
      const rawQty = isObject ? (product.quantite ?? product.quantity ?? product.qte) : 1;
      const quantity = Math.max(0, number(rawQty, 1));

      return {
        id: isObject ? product.id || `${code || name || "produit"}-${index}` : `${name || "produit"}-${index}`,
        code,
        nom: name || code || "Produit",
        quantite: quantity
      };
    })
    .filter(product => product.code || product.nom);
}

function analyzeOrderStock(order, stock) {
  const lookup = stockLookup(stock);
  const lines = normalizeProducts(order.products).map(product => {
    const stockItem = lookup.get(productKeyFromLine(product)) || lookup.get(`name:${normalizeTextKey(product.nom)}`);
    const available = stockItem ? getStockQuantity(stockItem) : null;
    const required = Math.max(0, number(product.quantite, 0));
    const missing = available === null ? required : Math.max(0, required - available);
    let status = "ok";

    if (!stockItem || available === null) status = "unknown";
    else if (available < required) status = "missing";

    return {
      code: product.code,
      nom: product.nom,
      required,
      available,
      missing,
      stockId: stockItem?.id ?? null,
      status
    };
  });

  const hasUnknown = lines.some(line => line.status === "unknown");
  const hasMissing = lines.some(line => line.status === "missing");
  const status = hasMissing ? "insuffisant" : (hasUnknown ? "inconnu" : "disponible");

  return {
    status,
    canPrepare: lines.length > 0 && status === "disponible",
    lines
  };
}

// ERP v1.9.0 : syncWorkflow ne regenere PLUS 1 commande par client. Il
// enrichit les commandes existantes (analyse stock) et synchronise les statuts
// des clients en se basant sur leur commande LA PLUS RECENTE. Cela permet le
// modele N commandes par client (1 par dateCommande).
//
// Compatibilite legacy : si un client existe SANS aucune commande (seed test,
// import historique), on en cree une "fallback" pour preserver le comportement
// des anciennes UIs qui supposent qu'un client a toujours une commande.
function syncWorkflow(db) {
  db.clients = db.clients.map(client => normalizeClient(client));

  // Bucket des commandes par clientId (1->N relation)
  const ordersByClientId = new Map();
  db.commandes.forEach(order => {
    const cid = String(order.clientId);
    if (!ordersByClientId.has(cid)) ordersByClientId.set(cid, []);
    ordersByClientId.get(cid).push(order);
  });

  // Legacy compat : un client sans aucune commande recoit une commande
  // fallback (deduite de ses produits) pour ne pas casser les anciennes UIs
  // qui supposent 1 client = 1 commande.
  db.clients.forEach(client => {
    const orders = ordersByClientId.get(String(client.id)) || [];
    if (orders.length > 0) return;
    if (!Array.isArray(client.produits) || client.produits.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);
    const fallback = normalizeOrder({
      clientId: client.id,
      clientName: client.nom,
      address: client.rue,
      city: client.ville,
      postalCode: client.codePostal,
      sector: client.secteur,
      phone: client.telephone,
      products: client.produits,
      lat: client.lat,
      lng: client.lng,
      notes: client.notes,
      priority: client.priority,
      dateCommande: today,
      dateImport: new Date().toISOString(),
      numero: generateOrderNumber(db, today),
      status: client.statut === "livree" ? "livre" : "stock_a_verifier"
    });
    fallback.id = `cmd-${fallback.numero.toLowerCase()}`;
    db.commandes.push(fallback);
    ordersByClientId.set(String(client.id), [fallback]);
  });

  // Re-normalisation + enrichissement (analyse stock) de TOUTES les commandes
  db.commandes = db.commandes
    .map(order => normalizeOrder(order))
    .map(order => enrichOrder(order, db.stock));

  // Statut du client = statut de sa commande la plus recente (par dateCommande)
  const latestOrderByClient = new Map();
  db.commandes.forEach(order => {
    const cid = String(order.clientId);
    const current = latestOrderByClient.get(cid);
    const orderDate = String(order.dateCommande || "");
    const currentDate = current ? String(current.dateCommande || "") : "";
    if (!current || orderDate.localeCompare(currentDate) > 0) {
      latestOrderByClient.set(cid, order);
    }
  });

  db.clients = db.clients.map(client => {
    const order = latestOrderByClient.get(String(client.id));
    if (!order) return client;

    return {
      ...client,
      secteur: order.sector,
      workflowStatus: order.status,
      preparationStatus: order.preparationStatus,
      deliveryStatus: order.deliveryStatus,
      statut: mapOrderStatusToClientStatus(order)
    };
  });

  db.routes = db.routes.map(route => normalizeRoute(route, db.commandes));
}

function normalizeClient(client) {
  const city = normalizeCity(client.ville || client.city);
  const sector = deriveSector(city, client.secteur || client.sector);

  return {
    ...client,
    id: client.id ?? crypto.randomUUID(),
    nom: clean(client.nom || client.name || client.client || "Client sans nom"),
    rue: clean(client.rue || client.address || client.adresse),
    ville: city,
    codePostal: clean(client.codePostal || client.postalCode || client.cp),
    telephone: clean(client.telephone || client.phone),
    statut: client.statut || "restant",
    produits: normalizeProducts(client.produits || client.products),
    lat: client.lat ?? client.latitude ?? "",
    lng: client.lng ?? client.longitude ?? "",
    secteur: sector,
    notes: clean(client.notes || client.remarques),
    priority: clean(client.priority || client.priorite)
  };
}

function normalizeOrder(order) {
  const city = normalizeCity(order.city || order.ville);
  const sector = deriveSector(city, order.sector || order.secteur);
  const status = ORDER_STATUSES.has(order.status) ? order.status : inferOrderStatus(order);
  const preparationStatus = order.preparationStatus || inferPreparationStatus(status);
  const deliveryStatus = order.deliveryStatus || inferDeliveryStatus(status);
  const now = new Date().toISOString();

  // P0 (audit 2026-07-08) : dateCommande est la cle de bucket ERP. On ne doit
  // JAMAIS ecraser une date metier existante mais non normalisable par la date
  // du jour : ce fallback silencieux corrompait en masse les dates a chaque
  // writeDb (syncWorkflow re-normalise TOUTES les commandes). On preserve donc
  // la valeur brute (string) telle quelle : le diagnostic /api/diagnostic/
  // suspicious-dates la signale pour correction manuelle, sans perte. Le defaut
  // "aujourd'hui" ne s'applique qu'a une commande SANS aucune date fournie.
  const rawDateCommande = order.dateCommande || order.dateImport || order.createdAt;
  const normalizedDateCommande = normalizeDateInput(rawDateCommande);
  const dateCommande = normalizedDateCommande
    || (typeof rawDateCommande === "string" && rawDateCommande.trim()
      ? rawDateCommande.trim()
      : now.slice(0, 10));

  return {
    id: order.id || `cmd-${order.clientId || crypto.randomUUID()}`,
    // Champs ERP v1.9.0 : numero humain (CMD-2026-001) + date metier de la
    // commande (date Excel ou date import) + hash deterministe pour anti-doublon.
    // Sont attribues par generateOrderNumber() et computeOrderHash() au moment
    // de la creation (import ou creation manuelle), preserves a chaque re-import.
    numero: order.numero || "",
    // dateCommande : ISO YYYY-MM-DD canonique quand normalisable (match exact
    // (clientId, dateCommande) au re-import) ; sinon la valeur brute preservee
    // (cf. calcul ci-dessus), jamais today. normalizeDateInput accepte FR
    // (DD/MM/YYYY), ISO (avec ou sans heure) et Date object.
    dateCommande,
    excelRowHash: order.excelRowHash || "",
    clientId: order.clientId,
    clientName: clean(order.clientName || order.nom || order.client || "Client sans nom"),
    address: clean(order.address || order.rue || order.adresse),
    city,
    postalCode: clean(order.postalCode || order.codePostal || order.cp),
    sector,
    products: normalizeProducts(order.products || order.produits),
    status,
    preparationStatus,
    deliveryStatus,
    createdAt: order.createdAt || now,
    updatedAt: order.updatedAt || now,
    notes: clean(order.notes || order.remarques),
    priority: clean(order.priority || order.priorite),
    phone: clean(order.phone || order.telephone),
    lat: order.lat ?? order.latitude ?? "",
    lng: order.lng ?? order.longitude ?? "",
    deliveryDate: normalizeDateInput(order.deliveryDate || order.dateLivraison || order.livraisonDate),
    stockReservedAt: order.stockReservedAt || null,
    // Chantier 1 (2026-06-04) : preserver l'historique des liberations de stock
    // manuelles (audit log). Null tant que jamais libere.
    stockReleasedAt: order.stockReleasedAt || null,
    stockReleaseReason: order.stockReleaseReason || null,
    routeId: order.routeId || null,
    importedAsLivre: order.importedAsLivre || false
  };
}

function enrichOrder(order, stock) {
  const stockCheck = analyzeOrderStock(order, stock);
  // Chantier 1 : aligne sur RESERVED_ORDER_STATUSES (inclut probleme/a_reprogrammer)
  const stockReserved = Boolean(order.stockReservedAt && RESERVED_ORDER_STATUSES.includes(order.status));

  return {
    ...order,
    stockStatus: stockReserved ? "reserve" : stockCheck.status,
    canPrepare: stockReserved || stockCheck.canPrepare,
    stockLines: stockCheck.lines
  };
}

function inferOrderStatus(order) {
  const deliveryStatus = order.deliveryStatus || order.statut;

  if (deliveryStatus === "livree" || deliveryStatus === "livre") return "livre";
  if (["absent", "probleme", "non_livre"].includes(deliveryStatus)) return "probleme_livraison";
  if (deliveryStatus === "en_cours" || deliveryStatus === "en_livraison") return "en_livraison";
  if (order.preparationStatus === "terminee") return "pret_livraison";

  return "stock_a_verifier";
}

function inferPreparationStatus(status) {
  if (["en_preparation"].includes(status)) return "en_cours";
  if (["preparation_terminee", "pret_livraison", "en_livraison", "livre", "probleme_livraison", "a_reprogrammer"].includes(status)) return "terminee";
  return "a_preparer";
}

function inferDeliveryStatus(status) {
  if (status === "en_livraison") return "en_livraison";
  if (status === "livre") return "livre";
  if (status === "probleme_livraison") return "probleme";
  if (status === "a_reprogrammer") return "a_reprogrammer";
  if (["preparation_terminee", "pret_livraison"].includes(status)) return "pret_livraison";
  return "restant";
}

function mapOrderStatusToClientStatus(order) {
  if (order.deliveryStatus === "livre" || order.status === "livre") return "livree";
  if (order.deliveryStatus === "absent") return "absent";
  if (order.deliveryStatus === "probleme" || order.status === "probleme_livraison") return "probleme";
  if (order.deliveryStatus === "a_reprogrammer") return "non_livre";
  if (order.deliveryStatus === "en_livraison" || order.status === "en_livraison") return "en_cours";
  return "restant";
}

function setOrderStatus(order, status) {
  if (!ORDER_STATUSES.has(status)) {
    throw badRequest("Statut commande invalide");
  }
  if (!isValidOrderStatusTransition(order.status, status)) {
    throw badRequest(`Transition non autorisee : ${order.status} -> ${status}`);
  }

  order.status = status;
  order.preparationStatus = inferPreparationStatus(status);
  order.deliveryStatus = inferDeliveryStatus(status);
  order.updatedAt = new Date().toISOString();

  // Revue R1 chantier 1 (P1 #4) : sur livraison effective, la reservation
  // est CONSOMMEE (le stock a deja ete physiquement deduit en preparation,
  // la livraison ne refait rien sur le stock). On nullify stockReservedAt
  // pour que calculateReservedStock ne double-compte pas indefiniment.
  if (status === "livre" && order.stockReservedAt) {
    order.stockReservedAt = null;
    order.stockReleasedAt = order.updatedAt;
    order.stockReleaseReason = "consumed_by_delivery";
  }
}

function reserveStockForOrder(db, order) {
  if (order.stockReservedAt) return;

  const stockCheck = analyzeOrderStock(order, db.stock);
  if (!stockCheck.canPrepare) {
    throw badRequest("Stock insuffisant ou non renseigne pour cette commande");
  }

  stockCheck.lines.forEach(line => {
    const product = db.stock.find(item => String(item.id) === String(line.stockId));
    if (!product) return;

    const available = getStockQuantity(product) ?? 0;
    setStockQuantity(product, available - line.required);
  });

  order.stockReservedAt = new Date().toISOString();
}

// Chantier 1 : symetrique de reserveStockForOrder. Restitue les quantites
// physiquement deduites quand une commande quitte le workflow sans etre livree
// (probleme_livraison, a_reprogrammer, annule). Idempotent : ne fait rien si
// la commande n'avait pas de reservation (stockReservedAt null).
//
// Critere d'appel : transitions terminales NON-livre. Si la commande revient
// ensuite en preparation, reserveStockForOrder() re-deduira proprement.
function releaseOrderStockReservation(db, order, reason) {
  if (!order.stockReservedAt) return false;

  // On recalcule les lignes via analyzeOrderStock plutot que de stocker la
  // reservation dans l'order : on garde une source unique de verite (les
  // products de l'order) et on est resilient au schema (lignes ajoutees/
  // retirees apres reservation sont rares mais possibles via un re-import).
  const stockCheck = analyzeOrderStock(order, db.stock);
  let restoredCount = 0;
  stockCheck.lines.forEach(line => {
    if (!line.required || line.required <= 0) return;
    const product = db.stock.find(item => String(item.id) === String(line.stockId));
    if (!product) return;
    const available = getStockQuantity(product) ?? 0;
    setStockQuantity(product, available + line.required);
    restoredCount += 1;
  });

  order.stockReservedAt = null;
  order.stockReleasedAt = new Date().toISOString();
  order.stockReleaseReason = reason || "release";

  addHistory(db, "Stock libere", `Commande ${order.numero || order.id} : ${restoredCount} ligne(s) restituee(s)`, {
    orderId: order.id,
    numero: order.numero,
    reason: reason || "release",
    lines: restoredCount
  });

  return true;
}

function findOrder(db, orderId) {
  const order = db.commandes.find(item => String(item.id) === String(orderId));
  if (!order) throw notFound("Commande introuvable");
  return order;
}

function findClient(db, clientId) {
  return db.clients.find(item => String(item.id) === String(clientId));
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function getSectors(db) {
  const map = new Map();

  CORE_SECTORS.forEach(sector => {
    map.set(sector, {
      name: sector,
      total: 0,
      ready: 0,
      inDelivery: 0,
      problems: 0
    });
  });

  db.commandes.forEach(order => {
    const sector = order.sector || deriveSector(order.city);
    if (!map.has(sector)) {
      map.set(sector, {
        name: sector,
        total: 0,
        ready: 0,
        inDelivery: 0,
        problems: 0
      });
    }

    const item = map.get(sector);
    item.total++;
    if (order.status === "pret_livraison") item.ready++;
    if (order.status === "en_livraison") item.inDelivery++;
    if (["probleme_livraison", "a_reprogrammer"].includes(order.status)) item.problems++;
  });

  return Array.from(map.values()).sort((a, b) => {
    const aCore = CORE_SECTORS.indexOf(a.name);
    const bCore = CORE_SECTORS.indexOf(b.name);
    if (aCore !== -1 || bCore !== -1) return (aCore === -1 ? 99 : aCore) - (bCore === -1 ? 99 : bCore);
    return a.name.localeCompare(b.name, "fr");
  });
}

function getDeliverableOrders(db, filters = {}) {
  const sector = clean(filters.sector);
  const city = normalizeCity(filters.city);

  return db.commandes.filter(order => {
    if (!["pret_livraison", "en_livraison", "a_reprogrammer"].includes(order.status)) return false;
    if (sector && sector !== "Tous" && normalizeTextKey(order.sector) !== normalizeTextKey(sector)) return false;
    if (city && normalizeTextKey(order.city) !== normalizeTextKey(city)) return false;
    return true;
  });
}

function createRoute(db, options = {}) {
  const selectedOrderIds = Array.isArray(options.orderIds) ? options.orderIds.map(String) : [];
  const sector = clean(options.sector || "Tous");
  const city = normalizeCity(options.city || "");
  const deliveryDate = normalizeDateInput(options.deliveryDate);

  let orders = getDeliverableOrders(db, { sector, city }).filter(order => {
    if (!["pret_livraison", "a_reprogrammer"].includes(order.status)) return false;
    if (deliveryDate && order.deliveryDate !== deliveryDate) return false;
    return true;
  });

  if (selectedOrderIds.length) {
    const selected = new Set(selectedOrderIds);
    orders = orders.filter(order => selected.has(String(order.id)));
  }

  if (!orders.length) {
    throw badRequest("Aucune commande prete selectionnee pour la tournee");
  }

  const optimizedOrders = optimizeOrders(orders);
  const routeId = `route-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  // v1.17.1 : passer settings.tournee pour vitesse + duree d'arret calibrables.
  // Invariant : db issu de readDb -> normalizeDb -> normalizeSettings garantit
  // db.settings.tournee. estimateRouteMetrics retombe sur ses defauts si
  // tourneeSettings est undefined (defense en profondeur).
  const metrics = estimateRouteMetrics(optimizedOrders, db.settings && db.settings.tournee);

  const route = {
    id: routeId,
    sector: sector && sector !== "Tous" ? sector : (orders[0]?.sector || "Tous"),
    city,
    deliveryDate,
    selectedOrderIds: optimizedOrders.map(order => order.id),
    stops: optimizedOrders.map((order, index) => createStop(routeId, order, index)),
    status: "prete",
    totalDistance: metrics.totalDistance,
    estimatedDuration: metrics.estimatedDuration,
    createdAt: now,
    startedAt: null,
    completedAt: null
  };

  db.routes.unshift(route);
  optimizedOrders.forEach(order => {
    order.routeId = routeId;
    order.updatedAt = now;
  });

  return route;
}

function optimizeOrders(orders) {
  const withCoords = orders.filter(order => getCoordinates(order));
  const withoutCoords = orders.filter(order => !getCoordinates(order));

  if (withCoords.length <= 1) {
    return [...orders].sort(fallbackOrderSort);
  }

  const remaining = [...withCoords].sort(fallbackOrderSort);
  const optimized = [remaining.shift()];

  while (remaining.length) {
    const current = optimized[optimized.length - 1];
    remaining.sort((a, b) => distance(current, a) - distance(current, b));
    optimized.push(remaining.shift());
  }

  return [...optimized, ...withoutCoords.sort(fallbackOrderSort)];
}

function fallbackOrderSort(a, b) {
  return [
    String(a.sector || "").localeCompare(String(b.sector || ""), "fr"),
    String(a.city || "").localeCompare(String(b.city || ""), "fr"),
    String(a.postalCode || "").localeCompare(String(b.postalCode || ""), "fr"),
    String(a.address || "").localeCompare(String(b.address || ""), "fr"),
    String(a.clientName || "").localeCompare(String(b.clientName || ""), "fr")
  ].find(result => result !== 0) || 0;
}

function createStop(routeId, order, index) {
  return {
    id: `stop-${routeId}-${index + 1}`,
    routeId,
    orderId: order.id,
    clientId: order.clientId,
    orderIndex: index + 1,
    clientName: order.clientName,
    phone: order.phone,
    address: order.address,
    city: order.city,
    postalCode: order.postalCode,
    sector: order.sector,
    deliveryDate: order.deliveryDate || "",
    products: order.products,
    status: "pret_livraison",
    notes: order.notes || "",
    lat: order.lat,
    lng: order.lng
  };
}

function normalizeRoute(route, orders) {
  const routeStatus = ROUTE_STATUSES.has(route.status) ? route.status : "prete";
  const stops = Array.isArray(route.stops) ? route.stops : [];
  const orderMap = new Map(orders.map(order => [String(order.id), order]));

  const normalizedStops = stops.map((stop, index) => {
    const order = orderMap.get(String(stop.orderId));
    return {
      ...stop,
      orderIndex: index + 1,
      clientName: stop.clientName || order?.clientName || "Client",
      phone: stop.phone || order?.phone || "",
      address: stop.address || order?.address || "",
      city: normalizeCity(stop.city || order?.city || ""),
      postalCode: stop.postalCode || order?.postalCode || "",
      sector: stop.sector || order?.sector || deriveSector(stop.city || order?.city),
      deliveryDate: normalizeDateInput(stop.deliveryDate || order?.deliveryDate || route.deliveryDate),
      products: normalizeProducts(stop.products || order?.products || []),
      status: STOP_STATUSES.has(stop.status) ? stop.status : "pret_livraison",
      notes: stop.notes || order?.notes || "",
      lat: stop.lat ?? order?.lat ?? "",
      lng: stop.lng ?? order?.lng ?? ""
    };
  });

  return {
    ...route,
    deliveryDate: normalizeDateInput(route.deliveryDate),
    status: routeStatus,
    stops: normalizedStops,
    selectedOrderIds: normalizedStops.map(stop => stop.orderId)
  };
}

function startRoute(db, routeId) {
  const route = db.routes.find(item => String(item.id) === String(routeId));
  if (!route) throw notFound("Tournee introuvable");

  const now = new Date().toISOString();
  route.status = "en_livraison";
  route.startedAt = route.startedAt || now;

  route.stops.forEach(stop => {
    stop.status = "en_livraison";
    const order = findOrder(db, stop.orderId);
    setOrderStatus(order, "en_livraison");

    const client = findClient(db, order.clientId);
    if (client) client.statut = "en_cours";
  });

  return route;
}

function updateRouteStop(db, routeId, stopId, status, notes = "") {
  if (!STOP_STATUSES.has(status)) {
    throw badRequest("Statut arret invalide");
  }

  const route = db.routes.find(item => String(item.id) === String(routeId));
  if (!route) throw notFound("Tournee introuvable");

  const stop = route.stops.find(item => String(item.id) === String(stopId));
  if (!stop) throw notFound("Arret introuvable");

  const now = new Date().toISOString();
  stop.status = status;
  stop.notes = clean(notes || stop.notes);

  const order = findOrder(db, stop.orderId);
  const client = findClient(db, order.clientId);

  if (status === "livre") {
    setOrderStatus(order, "livre");
    if (client) client.statut = "livree";
  } else if (status === "absent") {
    setOrderStatus(order, "probleme_livraison");
    order.deliveryStatus = "absent";
    if (client) client.statut = "absent";
  } else if (status === "probleme") {
    order.deliveryStatus = "probleme";
    setOrderStatus(order, "probleme_livraison");
    if (client) client.statut = "probleme";
  } else if (status === "a_reprogrammer") {
    setOrderStatus(order, "a_reprogrammer");
    if (client) client.statut = "non_livre";
  } else if (status === "en_livraison") {
    setOrderStatus(order, "en_livraison");
    if (client) client.statut = "en_cours";
  }

  if (["livre", "absent", "probleme", "a_reprogrammer"].includes(status)) {
    stop.deliveredAt = stop.deliveredAt || now;
    if (["absent", "probleme", "a_reprogrammer"].includes(status)) {
      stop.problemReason = stop.notes || formatStopProblem(status);
    }
  }

  const activeStatuses = new Set(["pret_livraison", "en_livraison"]);
  const isComplete = route.stops.every(item => !activeStatuses.has(item.status));

  if (isComplete) {
    route.status = "terminee";
    route.completedAt = route.completedAt || new Date().toISOString();
  }

  return { route, stop, order };
}

function formatStopProblem(status) {
  if (status === "absent") return "Client absent";
  if (status === "a_reprogrammer") return "A reprogrammer";
  return "Probleme livraison";
}

function reorderRouteStops(db, routeId, stopIds) {
  const route = db.routes.find(item => String(item.id) === String(routeId));
  if (!route) throw notFound("Tournee introuvable");

  if (!Array.isArray(stopIds) || stopIds.length !== route.stops.length) {
    throw badRequest("Ordre de tournee invalide");
  }

  const stopMap = new Map(route.stops.map(stop => [String(stop.id), stop]));
  const reordered = stopIds.map(id => stopMap.get(String(id)));

  if (reordered.some(stop => !stop)) {
    throw badRequest("Ordre de tournee invalide");
  }

  route.stops = reordered.map((stop, index) => ({
    ...stop,
    orderIndex: index + 1
  }));

  return route;
}

function estimateRouteMetrics(orders, tourneeSettings) {
  // v1.17.1 : vitesse et duree d'arret calibrables via Parametres (defaut
  // 28 km/h, 6 min/arret). L'utilisateur ajuste apres quelques tournees
  // reelles pour coller a son terrain (urbain Besancon vs rural Champagnole).
  //
  // Pieges evites (revue adverse R1) :
  // 1. NE JAMAIS utiliser `|| 28` car stopDurationMin=0 est valide et serait
  //    rebascule a 6 (0 est falsy). Test V1171.f le verifie.
  // 2. averageSpeedKmh DOIT etre > 0 (division par zero produirait Infinity).
  //    Asymetrie volontaire avec stopDurationMin qui accepte >= 0.
  const rawSpeed = tourneeSettings && Number(tourneeSettings.averageSpeedKmh);
  const speed = Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 28;
  const rawStop = tourneeSettings && Number(tourneeSettings.stopDurationMin);
  const stop = Number.isFinite(rawStop) && rawStop >= 0 ? rawStop : 6;

  let totalDistance = null;
  for (let i = 1; i < orders.length; i++) {
    const previous = orders[i - 1];
    const current = orders[i];
    if (!getCoordinates(previous) || !getCoordinates(current)) {
      totalDistance = null;
      break;
    }
    // M6 (v1.16.1) : distance() retourne deja des km (Haversine), plus de * 111
    totalDistance = (totalDistance || 0) + distance(previous, current);
  }

  // Revue R1 MINOR-4 : le temps d'arret existe meme sans distance calculable
  // (1 stop, coords manquantes). Auparavant on retournait null pour
  // estimatedDuration, perdant le signal. Maintenant : stopTime toujours
  // remonte ; driveTime ajoute si distance disponible.
  const stopTime = orders.length * stop;
  const driveTime = totalDistance === null ? null : (totalDistance / speed) * 60;
  const estimatedDuration = driveTime === null
    ? (orders.length > 0 ? Math.round(stopTime) : null)
    : Math.round(driveTime + stopTime);

  return {
    totalDistance: totalDistance === null ? null : Math.round(totalDistance * 10) / 10,
    estimatedDuration
  };
}

// M6 (v1.16.1) : formule HAVERSINE - distance grand-cercle en km. Remplace le
// Pythagore sur (lat,lng) * 111 qui surevalue de ~30% les distances courtes
// Est-Ouest a 45N (un degre de longitude vaut 111*cos(lat) km, pas 111).
// Verification : Besancon-Dole = 45 km (avant: ~61 km).
function distance(a, b) {
  const coordsA = getCoordinates(a);
  const coordsB = getCoordinates(b);

  if (!coordsA || !coordsB) return Number.POSITIVE_INFINITY;

  const R = 6371; // Rayon Terre en km
  const toRad = deg => (deg * Math.PI) / 180;
  const lat1 = toRad(coordsA.lat);
  const lat2 = toRad(coordsB.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(coordsB.lng - coordsA.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

app.get("/api/db", (req, res) => {
  if (!ENABLE_DB_EXPORT) {
    res.status(403).json({
      error: "Export complet de la base desactive. Utiliser SEREO_ENABLE_DB_EXPORT=1 pour diagnostic local."
    });
    return;
  }

  res.json(readDb());
});

app.get("/api/clients", (req, res) => {
  res.json(readDb().clients);
});

app.get("/api/ventes", (req, res) => {
  res.json(readDb().ventes);
});

app.get("/api/stock", (req, res) => {
  const db = readDb();
  res.json(getStockView(db));
});

app.get("/api/historique", (req, res) => {
  res.json(readDb().historique);
});

app.get("/api/stock-movements", (req, res) => {
  res.json(readDb().stockMovements);
});

app.get("/api/dashboard", (req, res) => {
  const db = readDb();
  res.json(getDashboardSummary(db));
});

app.get("/api/storage/status", (req, res) => {
  res.json({
    engine: useSqliteStorage() ? "sqlite" : "json",
    persistent: true,
    sharedAfterRefresh: true,
    accessProtected: isAccessAuthEnabled(),
    path: useSqliteStorage() ? SQLITE_PATH : DB_PATH,
    // B3 v1.16.0 : expose la derniere recovery de corruption (null si aucune)
    // pour qu'un client/admin puisse afficher une alerte de perte de donnees.
    lastRecovery: lastStorageRecovery,
    // Chantier 1 : flag indiquant si le snapshot post-restore a deja ete fait
    // (visible pour debug ; le snapshot est cree au premier appel writeDb).
    postRestoreBackupDone,
    // Lot 3 (audit 2026-07-08) : sante des backups. backupsSuspended=true =>
    // recovery fresh_empty en cours, aucun backup auto tant qu'aucune donnee
    // n'est re-saisie (l'UI doit alerter). lastBackupError != null => dernier
    // backup async a echoue (disque plein/permissions) : a surveiller.
    backupsSuspended: backupsSuspendedFreshEmpty,
    lastBackupAt,
    lastBackupError
  });
});

// Chantier 1 (2026-06-04) : force un backup immediat, hors throttle. Utilise
// par l'admin avant une operation a risque (purge, migration, restauration
// manuelle) ou apres un long deploiement sans mutation. Tag optionnel.
//
// Revue R1 P0 : addHistory + writeDb dans withWriteLock pour persister
// l'entree de log (avant, addHistory(readDb(), ...) sans writeDb perdait
// l'entree silencieusement).
app.post("/api/backup/now", async (req, res) => {
  try {
    const tag = clean(req.body?.tag || "manual").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    const result = await withWriteLock(async () => {
      const backupPath = writeBackupNow(tag);
      if (!backupPath) return { ok: false, error: "Backup impossible (source absente)" };

      const db = readDb();
      addHistory(db, "Backup manuel", `Backup forcé créé : ${path.basename(backupPath)}`, { tag, backupPath });
      writeDb(db, { backup: false }); // pas de double-backup recursif
      return { ok: true, backupPath: path.basename(backupPath), tag };
    });
    if (!result.ok) {
      return res.status(503).json(result);
    }
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur backup manuel");
  }
});

// v1.17.1 : diagnostic des dates suspectes en DB. M1 a durci normalizeDateInput :
// les commandes pre-1.17 stockees avec une date aberrante (`2025-13-31`,
// `30/02/2026`, an > 2199...) verront cette date mutee vers today au prochain
// readDb. Cet endpoint scan la base AVANT toute mutation pour quantifier
// l'exposition. Lecture seule, aucune modification.
// v1.17.1 : extraction en fonction pure pour pouvoir tester sans passer par
// writeDb (qui normalise les dates aberrantes via normalizeOrder).
//
// Revue adverse R1 :
// - MAJOR-3 : cap a SCAN_MAX_COMMANDES pour eviter event-loop blocking
//   (DoS theorique : 1M commandes * 50us regex/normalize = 50s blocking).
// - MINOR-3/12/14 : ISO datetime 24-char ('2026-05-05T10:00:00.000Z') ecrit
//   par ensureOrderNumbers legacy n'est PAS suspect : son prefixe 10 chars
//   est un ISO valide. On teste le prefixe, pas la chaine entiere.
const SCAN_MAX_COMMANDES = 50000;

function scanSuspiciousDates(commandes) {
  const list = Array.isArray(commandes) ? commandes : [];
  const samples = [];
  let suspicious = 0;
  let missingDate = 0;

  const truncated = list.length > SCAN_MAX_COMMANDES;
  const toScan = truncated ? list.slice(0, SCAN_MAX_COMMANDES) : list;

  for (const order of toScan) {
    // Mirror EXACT de normalizeOrder (meme valeur BRUTE, pas String() qui
    // casserait le path number d'un serial Excel en mode JSON) :
    //   normalizeDateInput(raw) truthy      -> canonisee sans perte (saine)
    //   sinon string non vide               -> PRESERVEE brute (a corriger)
    //   sinon (blanc / non-string / absente)-> today (defaut silencieux)
    const raw = order.dateCommande;
    if (!raw) { missingDate += 1; continue; }
    if (normalizeDateInput(raw)) continue;

    const preservedRaw = typeof raw === "string" && raw.trim();
    if (!preservedRaw) { missingDate += 1; continue; }

    suspicious += 1;
    if (samples.length < 20) {
      samples.push({
        id: order.id,
        numero: order.numero || "(sans numero)",
        clientName: order.clientName || "",
        dateCommandeRaw: String(raw),
        dateCommandeApresValidation: "(non normalisable -> preservee telle quelle, a corriger manuellement)"
      });
    }
  }

  return {
    totalCommandes: list.length,
    commandesAnalysees: toScan.length,
    troncature: truncated,
    datesManquantes: missingDate,
    datesSuspectes: suspicious,
    echantillon: samples,
    note: suspicious === 0
      ? "Aucune date suspecte. Rien a corriger manuellement."
      : `${suspicious} date(s) non normalisable(s) : preservee(s) telle(s) quelle(s) (jamais mutee vers today), a corriger manuellement.`
  };
}

app.get("/api/diagnostic/suspicious-dates", (req, res) => {
  // Revue R1 MINOR-10 : reponse contient PII (clientName, numero), pas de
  // cache cote intermediaire/CDN.
  res.set("Cache-Control", "no-store, max-age=0");
  res.set("Vary", "Cookie");
  const db = readDb();
  res.json(scanSuspiciousDates(db.commandes));
});

// L'endpoint /api/version est declare plus haut (avant requireAccessAuth)
// pour rester accessible sans authentification, notamment sur la page /login.

app.get("/api/settings/appearance", (req, res) => {
  res.json(getAppearanceSettings(readDb()));
});

app.patch("/api/settings/appearance", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const appearance = getAppearanceSettings(db);

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "themeId")) {
        const themeId = clean(req.body.themeId);
        if (!themeId || !/^[a-z0-9_-]{1,40}$/i.test(themeId)) {
          throw badRequest("Palette invalide");
        }
        appearance.themeId = themeId;
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "brandImage")) {
        appearance.brandImage = validateBrandImage(req.body.brandImage);
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "colorScheme")) {
        const raw = clean(req.body.colorScheme).toLowerCase();
        if (!VALID_COLOR_SCHEMES.has(raw)) {
          throw badRequest("Mode d'affichage invalide");
        }
        appearance.colorScheme = raw;
      }

      db.settings.appearance = appearance;
      writeDb(db);
      return appearance;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur parametres");
  }
});

app.get("/api/settings/order-numbering", (req, res) => {
  const db = readDb();
  res.json(normalizeSettings(db.settings || {}).orderNumbering);
});

// v1.17.1 : GET reglages tournee (vitesse + duree d'arret)
app.get("/api/settings/tournee", (req, res) => {
  const db = readDb();
  res.json(normalizeSettings(db.settings || {}).tournee);
});

app.patch("/api/settings/order-numbering", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      db.settings = normalizeSettings(db.settings || {});

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "prefix")) {
        const raw = clean(req.body.prefix).toUpperCase();
        if (!/^[A-Z0-9]{2,8}$/.test(raw)) {
          throw badRequest("Prefixe invalide : 2 a 8 caracteres alphanumeriques (ex: CMD, ORD, BC)");
        }
        db.settings.orderNumbering.prefix = raw;
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "resetAnnually")) {
        db.settings.orderNumbering.resetAnnually = !!req.body.resetAnnually;
      }

      writeDb(db);
      return db.settings.orderNumbering;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur parametres numerotation");
  }
});

// v1.17.1 : reglages tournee. L'utilisateur ajuste vitesse moyenne et duree
// d'arret apres confrontation aux tournees reelles (defaut 28 km/h + 6 min).
//
// Revue R1 :
// - MINOR-11 : refuser explicitement les types non-number (Number(null)=0 et
//   Number(false)=0 passeraient le check sinon)
// - MINOR-16 : forcer entier (slider step=1, eviter "35.7 km/h" persiste)
// - MINOR-9 (limite payload inline) : NON applique car le middleware global
//   `app.use(express.json({limit:"5mb"}))` ligne 289 parse deja le body avant
//   un middleware inline. Reduire la limite globale casserait brandImage.
//   La protection reste : typeof + bornes serveur. Backlog : rate-limit
//   global /api/settings/*.
app.patch("/api/settings/tournee", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      db.settings = normalizeSettings(db.settings || {});

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "averageSpeedKmh")) {
        if (typeof req.body.averageSpeedKmh !== "number") {
          throw badRequest("averageSpeedKmh doit etre un nombre");
        }
        const raw = req.body.averageSpeedKmh;
        if (!Number.isFinite(raw) || raw < 10 || raw > 60) {
          throw badRequest("Vitesse moyenne invalide : entre 10 et 60 km/h");
        }
        db.settings.tournee.averageSpeedKmh = Math.round(raw);
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "stopDurationMin")) {
        if (typeof req.body.stopDurationMin !== "number") {
          throw badRequest("stopDurationMin doit etre un nombre");
        }
        const raw = req.body.stopDurationMin;
        if (!Number.isFinite(raw) || raw < 0 || raw > 30) {
          throw badRequest("Duree d'arret invalide : entre 0 et 30 minutes");
        }
        db.settings.tournee.stopDurationMin = Math.round(raw);
      }

      writeDb(db);
      return db.settings.tournee;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur parametres tournee");
  }
});

app.get("/api/orders", (req, res) => {
  const db = readDb();
  const statusFilter = clean(req.query.status || "").toLowerCase();
  if (!statusFilter) return res.json(db.commandes);
  if (!ORDER_STATUSES.has(statusFilter)) {
    return res.status(400).json({ error: "Statut inconnu" });
  }
  res.json(db.commandes.filter(order => order.status === statusFilter));
});

// Recherche d'une commande par son numero humain (CMD-2026-001).
// Utilisee par la barre de recherche dans la nouvelle page Commandes (Phase 3).
app.get("/api/orders/by-number/:numero", (req, res) => {
  const db = readDb();
  const numero = clean(req.params.numero).toUpperCase();
  const order = db.commandes.find(o => String(o.numero).toUpperCase() === numero);
  if (!order) {
    return res.status(404).json({ error: "Commande introuvable" });
  }
  res.json(order);
});

app.get("/api/recommendations", (req, res) => {
  const db = readDb();
  res.json(getRecommendations(db));
});

app.get("/api/sectors", (req, res) => {
  const db = readDb();
  res.json(getSectors(db));
});

app.get("/api/routes", (req, res) => {
  const db = readDb();
  res.json(db.routes);
});

app.post("/api/import/stock", uploadExcel, async (req, res) => {
  const uploadedPath = req.file?.path;

  try {
    const rows = await readExcelRows(uploadedPath);

    const headerIndex = findHeaderRowGroups(rows, [
      ["Code", "Reference", "Référence", "SKU"],
      ["Nom", "Produit", "Article"]
    ]);

    if (headerIndex === -1) {
      throw badRequest("Colonnes stock non reconnues");
    }

    const headers = rows[headerIndex];
    const dataRows = rows.slice(headerIndex + 1);

    // Chantier 1 : wrap mutations dans withWriteLock pour eviter le TOCTOU
    // contre d'autres imports/PATCH concurrents. Lecture Excel deja faite
    // hors-verrou (cout 5-30s).
    const response = await withWriteLock(async () => {
    const db = readDb();

    // Index des produits existants par productKey (code/nom normalises)
    // pour preserver l'ID + la quantite manuelle quand on reimporte le meme Excel.
    // Bug fix : avant, chaque import recreait tous les produits avec un UUID
    // random et ecrasait db.stock, ce qui detruisait les ajustements +1/-1 que
    // l'utilisateur avait fait manuellement entre 2 imports.
    const existingByKey = new Map();
    db.stock.forEach(product => {
      const key = productKey(product);
      if (key) existingByKey.set(key, product);
    });

    const parsedProducts = dataRows
      .map(row => {
        const code = clean(getCellByNames(row, headers, ["Code", "Reference", "Référence", "SKU"]));
        const nom = clean(getCellByNames(row, headers, ["Nom", "Produit", "Article"]));
        const cout = number(getCellByNames(row, headers, ["Cout", "Coût", "Prix achat"]), 0);
        const tarif = number(getCellByNames(row, headers, ["Tarif", "Prix", "Prix vente"]), 0);
        const excelQuantite = optionalQuantity(getCellByNames(row, headers, ["Quantite", "Stock", "Qte"]));
        const category = clean(getCellByNames(row, headers, ["Categorie", "Category", "Type"]));
        const alertThreshold = optionalQuantity(getCellByNames(row, headers, ["Seuil", "Seuil alerte", "Minimum", "Alerte"]));

        const fieldsFromExcel = {
          code,
          sku: code,
          nom,
          tarif,
          cout,
          statut: clean(getCell(row, headers, "Statut", 1)),
          type: category,
          category,
          alertThreshold
        };

        const key = productKey(fieldsFromExcel);
        const existing = key ? existingByKey.get(key) : null;

        if (existing) {
          // MERGE : preserve l'id et la quantite manuelle (la regle metier dit
          // que c'est l'utilisateur qui gere son stock cote app, l'Excel ne sert
          // qu'a importer le catalogue produits). Une valeur explicite dans la
          // colonne Quantite de l'Excel ecrase quand meme le stock manuel pour
          // permettre une remise a zero ponctuelle si vraiment souhaitee.
          return {
            ...existing,
            ...fieldsFromExcel,
            id: existing.id,
            quantite: excelQuantite !== null && excelQuantite !== undefined
              ? excelQuantite
              : existing.quantite
          };
        }

        // Nouveau produit (pas trouve dans la DB) : UUID + valeur Excel (ou null)
        return {
          ...fieldsFromExcel,
          id: crypto.randomUUID(),
          quantite: excelQuantite
        };
      })
      .filter(product => product.code || product.nom);

    // Deduplication : garde la PREMIERE occurrence par productKey (code || nom).
    // Un export stock propre ne contient pas de doublons - les lignes suivantes
    // sont ignorees pour eviter des entrees fantomes dans les recommandations.
    const seenProductKeys = new Map();
    let duplicatesSkipped = 0;
    parsedProducts.forEach(product => {
      const key = productKey(product);
      if (!key) return;
      if (seenProductKeys.has(key)) {
        duplicatesSkipped += 1;
        return;
      }
      seenProductKeys.set(key, product);
    });

    // Preservation des produits qui sont dans la DB mais ABSENTS du nouvel Excel.
    // Strategie safe : on ne supprime pas (l'utilisateur peut avoir ajoute des
    // produits hors Excel, ou re-importer un Excel partiel). Une purge explicite
    // pourra etre exposee plus tard via un endpoint dedie si besoin.
    const importedKeys = new Set(seenProductKeys.keys());
    const preservedProducts = db.stock.filter(product => {
      const key = productKey(product);
      return key && !importedKeys.has(key);
    });

    const importedProducts = Array.from(seenProductKeys.values());
    const updatedCount = importedProducts.filter(p => existingByKey.has(productKey(p))).length;
    const createdCount = importedProducts.length - updatedCount;

    db.stock = [...importedProducts, ...preservedProducts];

    syncWorkflow(db);
    const dedupNote = duplicatesSkipped > 0
      ? `, ${duplicatesSkipped} doublon(s) ignore(s)`
      : "";
    const preservedNote = preservedProducts.length > 0
      ? `, ${preservedProducts.length} produit(s) hors Excel preserve(s)`
      : "";
    addHistory(
      db,
      "Import stock",
      `${createdCount} produit(s) cree(s), ${updatedCount} produit(s) mis a jour${dedupNote}${preservedNote}`,
      { fichier: req.file.originalname }
    );

    // v1.12.0 : archivage du fichier Excel brut pour retelechargement futur
    const archive = archiveImportFile(req, db, "stock", {
      rowsCount: dataRows.length,
      created: createdCount,
      updated: updatedCount,
      preserved: preservedProducts.length,
      duplicatesSkipped
    });

    writeDb(db);

    return {
      success: true,
      stock: db.stock,
      commandes: db.commandes,
      duplicatesSkipped,
      created: createdCount,
      updated: updatedCount,
      preserved: preservedProducts.length,
      archive
    };
    });
    res.json(response);
  } catch (error) {
    handleRouteError(error, res, "Erreur import stock");
  } finally {
    cleanupUploadedFile(uploadedPath);
  }
});

app.post("/api/import/ventes", uploadExcel, async (req, res) => {
  const uploadedPath = req.file?.path;

  // M2 (revue) : compteur des quantites Excel negatives silencieusement
  // clampees a 0. Expose dans la reponse pour traceability (audit) - une
  // qty negative dans Ximi est souvent un retour/avoir, le clamp silencieux
  // pourrait masquer cette info metier.
  let clampedNegativeQtyCount = 0;

  try {
    const rows = await readExcelRows(uploadedPath);

    const headerIndex = findHeaderRowGroups(rows, [
      ["Client", "Nom client", "Client final"],
      ["Quantite", "Quantité", "Qte", "Qté"],
      ["Produit", "Nom", "Article"],
      ["Rue", "Adresse", "Adresse client"],
      ["Ville", "Commune"]
    ]);

    if (headerIndex === -1) {
      throw badRequest("Colonnes ventes non reconnues");
    }

    const headers = rows[headerIndex];
    const dataRows = rows.slice(headerIndex + 1);

    // Chantier 1 : wrap dans withWriteLock pour eviter les races avec
    // d'autres imports/PATCH concurrents.
    const response = await withWriteLock(async () => {
    const db = readDb();
    const existingClients = new Map(db.clients.map(client => [clientKey(client), client]));

    const ventes = dataRows
      .map((row, index) => {
        const codeProduit = clean(getCellByNames(row, headers, ["Code", "Reference", "Référence", "SKU"]));
        const nomProduit = clean(getCellByNames(row, headers, ["Nom", "Produit", "Article"]));
        const client = clean(getCellByNames(row, headers, ["Client", "Nom client", "Client final"]));
        const statutFacture = clean(getCell(row, headers, "Statut", 1));
        // ERP v1.9.0 : la date Excel devient le discriminant entre 2 bons de
        // commande du meme client. Format ISO pour permettre le tri et le
        // matching deterministe. excelDate (FR) reste pour le legacy affichage.
        const dateCell = getCell(row, headers, "Date", 1);
        const date = excelDate(dateCell);
        const dateCommandeIso = excelDateToIso(dateCell);
        const deliveryDate = normalizeDateInput(getCellByNames(row, headers, ["Date livraison", "Livraison", "Date de livraison"]));
        const rawQty = number(getCellByNames(row, headers, ["Quantite", "Quantité", "Qte", "Qté"]), 1);
        const quantite = Math.max(0, rawQty);
        if (rawQty < 0) clampedNegativeQtyCount += 1;
        const prixUnitaire = number(getCell(row, headers, "Prix unitaire", 1), 0);
        const ht = number(getCell(row, headers, "HT", 1), 0);
        const ttc = number(getCell(row, headers, "TTC", 1), 0);
        const produitComplet = clean(getCell(row, headers, "Produit", 1));
        const telephone = clean(getCellByNames(row, headers, ["Telephone favori", "Téléphone favori", "Telephone", "Téléphone", "Mobile", "Phone"]));
        const reference = clean(getCell(row, headers, "Reference", 1));
        const codePostal = clean(getCellByNames(row, headers, ["Code Postal", "Code postal", "CP", "PostalCode"]));
        const rue = clean(getCellByNames(row, headers, ["Rue", "Adresse", "Adresse client"]));
        const ville = normalizeCity(getCellByNames(row, headers, ["Ville", "Commune"]));
        const secteur = deriveSector(ville, getCellByNames(row, headers, ["Secteur", "Sector"]));
        const notes = clean(getCellByNames(row, headers, ["Notes", "Remarque", "Remarques"]));
        const priority = clean(getCellByNames(row, headers, ["Priorite", "Priorite livraison", "Priority"]));
        const lat = getCoordinateValue(getCellByNames(row, headers, ["Latitude", "Lat"]), -90, 90);
        const lng = getCoordinateValue(getCellByNames(row, headers, ["Longitude", "Lng"]), -180, 180);

        return {
          id: crypto.randomUUID(),
          codeProduit,
          produit: nomProduit || produitComplet,
          produitComplet,
          client,
          statutFacture,
          date,
          dateCommandeIso,
          quantite,
          prixUnitaire,
          ht,
          ttc,
          telephone,
          reference,
          codePostal,
          rue,
          ville,
          secteur,
          notes,
          priority,
          deliveryDate,
          lat,
          lng
        };
      })
      .filter(vente => vente.client || vente.produit);

    db.ventes = ventes;

    // ERP v1.9.0 : bucket par (client, dateCommande) au lieu de juste par client.
    // Chaque (client, date) = 1 bon de commande distinct. Multiples imports
    // d'un meme bon (meme client + meme date) = update du contenu, pas creation
    // de doublon (anti-doublon via excelRowHash).
    const todayIso = new Date().toISOString().slice(0, 10);
    const clientsMap = {};

    ventes.forEach(vente => {
      const key = clientKey({
        nom: vente.client,
        rue: vente.rue,
        codePostal: vente.codePostal,
        ville: vente.ville
      });
      const existingClient = existingClients.get(key) || {};
      // Fallback : si la ligne Excel n'a pas de Date, on bucket avec la date du
      // jour (l'utilisateur peut quand meme avoir importe quelque chose hors
      // contexte de bon de commande date). C'est rare en pratique.
      const dateCommande = vente.dateCommandeIso || todayIso;
      const venteFactureLivree = isFactureStatusLivre(vente.statutFacture);

      if (!clientsMap[key]) {
        clientsMap[key] = {
          id: existingClient.id || crypto.randomUUID(),
          nom: vente.client || "Client sans nom",
          rue: vente.rue,
          ville: vente.ville,
          codePostal: vente.codePostal,
          telephone: vente.telephone,
          statut: existingClient.statut || "restant",
          // Liste flat (legacy compat pour syncWorkflow et anciennes UIs)
          produits: [],
          lat: vente.lat !== "" ? vente.lat : (existingClient.lat || ""),
          lng: vente.lng !== "" ? vente.lng : (existingClient.lng || ""),
          secteur: vente.secteur,
          deliveryDate: vente.deliveryDate,
          notes: vente.notes || existingClient.notes || "",
          priority: vente.priority || existingClient.priority || "",
          // Multi-commandes : 1 entree par dateCommande pour ce client
          ordersByDate: {}
        };
      }

      // Bucket commande dans le client
      if (!clientsMap[key].ordersByDate[dateCommande]) {
        clientsMap[key].ordersByDate[dateCommande] = {
          dateCommande,
          deliveryDate: vente.deliveryDate,
          produits: [],
          factureLivree: venteFactureLivree
        };
      } else {
        // factureLivree d'une commande = AND de toutes ses lignes
        const order = clientsMap[key].ordersByDate[dateCommande];
        order.factureLivree = order.factureLivree && venteFactureLivree;
        if (!order.deliveryDate && vente.deliveryDate) order.deliveryDate = vente.deliveryDate;
      }

      // Agregation/dedup produit dans la commande (meme produit 2 lignes Excel = somme)
      const newLine = {
        code: vente.codeProduit,
        nom: vente.produit,
        quantite: vente.quantite
      };
      const newLineKey = productKey(newLine);
      const orderBucket = clientsMap[key].ordersByDate[dateCommande];
      const existingOrderLine = newLineKey
        ? orderBucket.produits.find(line => productKey(line) === newLineKey)
        : null;
      if (existingOrderLine) {
        existingOrderLine.quantite = number(existingOrderLine.quantite, 0) + number(newLine.quantite, 0);
      } else {
        orderBucket.produits.push({ ...newLine });
      }

      // Maintenance de la liste flat (sum sur toutes commandes confondues du client)
      const flatExistingLine = newLineKey
        ? clientsMap[key].produits.find(line => productKey(line) === newLineKey)
        : null;
      if (flatExistingLine) {
        flatExistingLine.quantite = number(flatExistingLine.quantite, 0) + number(newLine.quantite, 0);
      } else {
        clientsMap[key].produits.push({ ...newLine });
      }
    });

    const importedClients = Object.values(clientsMap);
    const mergedImport = mergeImportedClients(db, importedClients);
    db.clients = mergedImport.clients;

    // ERP v1.9.0 : creation/mise a jour des commandes par (client, dateCommande).
    // 3 chemins :
    //   1. Hash strict match -> noop (re-import identique = idempotent)
    //   2. Match (clientId, dateCommande) -> update produits, preserve status/workflow
    //   3. Nouveau (client, date) -> nouvelle commande avec numero genere
    let createdCount = 0;
    let updatedCount = 0;
    let skippedIdenticalCount = 0;
    let importedAsLivreCount = 0;

    importedClients.forEach(client => {
      Object.values(client.ordersByDate || {}).forEach(orderData => {
        const hash = computeOrderHash({
          clientId: client.id,
          dateCommande: orderData.dateCommande,
          products: orderData.produits
        });

        // Chemin 1 : hash strict = meme contenu, re-import identique idempotent
        const sameHashOrder = db.commandes.find(o => o.excelRowHash && o.excelRowHash === hash);
        if (sameHashOrder) {
          sameHashOrder.updatedAt = new Date().toISOString();
          skippedIdenticalCount += 1;
          return;
        }

        // Chemin 2 : (clientId, dateCommande) = meme bon mais contenu modifie
        const sameKeyOrder = db.commandes.find(o =>
          String(o.clientId) === String(client.id) &&
          o.dateCommande === orderData.dateCommande
        );
        if (sameKeyOrder) {
          sameKeyOrder.products = normalizeProducts(orderData.produits);
          sameKeyOrder.excelRowHash = hash;
          sameKeyOrder.updatedAt = new Date().toISOString();
          // Sync coordonnees client (peuvent avoir change). lat/lng client manuel
          // (PATCH /api/clients/:id/coordinates) deja merge dans client.lat/lng.
          sameKeyOrder.address = client.rue || sameKeyOrder.address;
          sameKeyOrder.city = client.ville || sameKeyOrder.city;
          sameKeyOrder.postalCode = client.codePostal || sameKeyOrder.postalCode;
          sameKeyOrder.sector = client.secteur || sameKeyOrder.sector;
          sameKeyOrder.phone = client.telephone || sameKeyOrder.phone;
          if (client.lat !== "") sameKeyOrder.lat = client.lat;
          if (client.lng !== "") sameKeyOrder.lng = client.lng;
          updatedCount += 1;
          return;
        }

        // Chemin 3 : nouvelle commande. generateOrderNumber doit voir les
        // commandes deja pushees pour ne pas re-utiliser un numero.
        const newOrder = normalizeOrder({
          clientId: client.id,
          clientName: client.nom,
          address: client.rue,
          city: client.ville,
          postalCode: client.codePostal,
          sector: client.secteur,
          phone: client.telephone,
          products: orderData.produits,
          lat: client.lat,
          lng: client.lng,
          notes: client.notes,
          priority: client.priority,
          dateCommande: orderData.dateCommande,
          deliveryDate: orderData.deliveryDate || "",
          dateImport: new Date().toISOString(),
          excelRowHash: hash,
          numero: generateOrderNumber(db, orderData.dateCommande),
          status: orderData.factureLivree ? "livre" : "stock_a_verifier",
          deliveryStatus: orderData.factureLivree ? "livre" : "restant",
          preparationStatus: orderData.factureLivree ? "terminee" : "a_preparer",
          importedAsLivre: orderData.factureLivree
        });
        // Id deterministe via numero : evite la collision cmd-${clientId} qui
        // ecrasait l'ancienne commande quand un meme client commandait 2x.
        newOrder.id = `cmd-${newOrder.numero.toLowerCase()}`;
        db.commandes.push(newOrder);
        createdCount += 1;
        if (orderData.factureLivree) importedAsLivreCount += 1;
      });
    });

    syncWorkflow(db);
    const preservedMessage = mergedImport.preservedCount > 0
      ? `, ${mergedImport.preservedCount} client(s) deja en workflow conserve(s)`
      : "";
    const mergedMessage = mergedImport.mergedBySecondary > 0
      ? `, ${mergedImport.mergedBySecondary} doublon(s) client(s) fusionne(s) par cle secondaire`
      : "";
    const livreMessage = importedAsLivreCount > 0
      ? `, ${importedAsLivreCount} commande(s) importee(s) comme deja livree(s) (statut facture Envoyee)`
      : "";
    const commandeStats = `${createdCount} commande(s) creee(s), ${updatedCount} mise(s) a jour, ${skippedIdenticalCount} identique(s) ignoree(s)`;
    const clampedMessage = clampedNegativeQtyCount > 0
      ? `, ⚠ ${clampedNegativeQtyCount} quantite(s) negative(s) clampee(s) a 0 (verifier retours/avoirs Ximi)`
      : "";
    addHistory(
      db,
      "Import ventes",
      `${db.ventes.length} vente(s) importee(s), ${importedClients.length} client(s) detecte(s), ${commandeStats}${preservedMessage}${mergedMessage}${livreMessage}${clampedMessage}`,
      {
        fichier: req.file.originalname
      }
    );

    // v1.12.0 : archivage du fichier Excel brut pour retelechargement futur
    const archive = archiveImportFile(req, db, "ventes", {
      rowsCount: db.ventes.length,
      clientsCount: importedClients.length,
      created: createdCount,
      updated: updatedCount,
      skippedIdentical: skippedIdenticalCount,
      importedAsLivre: importedAsLivreCount,
      mergedBySecondary: mergedImport.mergedBySecondary
    });

    writeDb(db);

    return {
      success: true,
      ventes: db.ventes,
      clients: db.clients,
      commandes: db.commandes,
      secteurs: getSectors(db),
      mergedBySecondary: mergedImport.mergedBySecondary,
      importedAsLivre: importedAsLivreCount,
      created: createdCount,
      updated: updatedCount,
      skippedIdentical: skippedIdenticalCount,
      clampedNegativeQuantities: clampedNegativeQtyCount,
      archive
    };
    }); // fin withWriteLock
    res.json(response);
  } catch (error) {
    handleRouteError(error, res, "Erreur import ventes");
  } finally {
    cleanupUploadedFile(uploadedPath);
  }
});

// v1.12.0 : liste des fichiers Excel archives lors des imports passes.
// Tries du plus recent au plus ancien. Inclut metadata (taille, sha256, stats)
// mais pas le contenu binaire du fichier (recupere via GET /:id/download).
app.get("/api/imports/archives", (req, res) => {
  const db = readDb();
  const archives = (db.importsArchives || []).slice();
  const typeFilter = clean(req.query.type || "").toLowerCase();
  const filtered = typeFilter
    ? archives.filter(a => String(a.type).toLowerCase() === typeFilter)
    : archives;
  filtered.sort((a, b) => String(b.importedAt || "").localeCompare(String(a.importedAt || "")));
  res.json(filtered);
});

// v1.12.0 : telechargement d'un fichier Excel archive. Verifie que l'id est
// connu en DB et que le fichier existe encore sur disque (peut etre purge
// manuellement par le sysadmin).
app.get("/api/imports/archives/:id/download", (req, res) => {
  try {
    const db = readDb();
    const archive = (db.importsArchives || []).find(a => String(a.id) === String(req.params.id));

    if (!archive) {
      throw notFound("Archive introuvable");
    }

    if (!archive.archivedPath || !fs.existsSync(archive.archivedPath)) {
      throw notFound("Fichier archive supprime du disque");
    }

    res.download(archive.archivedPath, archive.filename || "import.xlsx");
  } catch (error) {
    handleRouteError(error, res, "Erreur telechargement archive");
  }
});

// v1.12.0 : purge des bons de commande pour repartir propre (utile apres
// une migration ou pour effacer des imports cassés). Supprime commandes,
// clients, ventes et routes (cascades logiques), mais PRESERVE :
// - stock (catalogue produits + quantites manuelles)
// - stockMovements (historique des ajustements stock)
// - historique evenements (audit)
// - importsArchives (l'historique des fichiers reste accessible)
// - settings (themes, palette, etc.)
//
// La purge laisse l'utilisateur pouvoir reimporter ses Excel originaux
// depuis Parametres -> Historique imports -> Telecharger.
app.post("/api/orders/purge", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const purgedCounts = {
        commandes: db.commandes.length,
        clients: db.clients.length,
        ventes: db.ventes.length,
        routes: db.routes.length
      };

      db.commandes = [];
      db.clients = [];
      db.ventes = [];
      db.routes = [];

      addHistory(
        db,
        "Purge",
        `Reset bons de commande : ${purgedCounts.commandes} commande(s), ${purgedCounts.clients} client(s), ${purgedCounts.ventes} vente(s), ${purgedCounts.routes} tournee(s) supprimees. Stock et historique preserves.`,
        purgedCounts
      );

      writeDb(db);
      return purgedCounts;
    });
    res.json({
      success: true,
      purged: result,
      message: "Bons de commande purges. Re-importez vos Excel depuis Parametres > Historique imports."
    });
  } catch (error) {
    handleRouteError(error, res, "Erreur purge bons");
  }
});

app.patch("/api/stock/:id", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const product = db.stock.find(p => String(p.id) === String(req.params.id));

      if (!product) {
        throw notFound("Produit introuvable");
      }

      const nextQuantity = Number(String(req.body.quantite ?? "").replace(",", "."));

      if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
        throw badRequest("Quantite invalide");
      }

      const oldQuantity = getStockQuantity(product) ?? 0;
      setStockQuantity(product, nextQuantity);
      recordStockMovement(db, product, oldQuantity, product.quantite, req.body.reason);

      syncWorkflow(db);
      addHistory(db, "Stock", `${product.nom} : stock ${oldQuantity} -> ${product.quantite}`, {
        produitId: product.id,
        ancienStock: oldQuantity,
        nouveauStock: product.quantite
      });

      writeDb(db);
      // Chantier 2 (revue R1 P1 #1) : passer l'index pre-calcule pour
      // garder le O(1) sur l'enrichissement post-mutation. Sans index,
      // /api/stock/:id PATCH retombait en O(N) sur chaque appel.
      const stockIndex = buildStockMetricsIndex(db.commandes);
      return enrichStockItem(db, product, stockIndex);
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur modification stock");
  }
});

// PATCH /api/clients/:id : mise a jour partielle des champs metier d'un client
// (rue, codePostal, ville, telephone, notes). Utilise par la nouvelle UI
// "Compléter le profil client" depuis la modal detail bon de commande v1.11.0.
// Propage les changements vers la/les commande(s) active(s) du client pour que
// les ecrans Livraison/Preparation reflechent l'adresse a jour.
app.patch("/api/clients/:id", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const client = db.clients.find(c => String(c.id) === String(req.params.id));

      if (!client) {
        throw notFound("Client introuvable");
      }

      const updates = {};
      if (req.body.nom !== undefined) updates.nom = clean(req.body.nom);
      if (req.body.rue !== undefined) updates.rue = clean(req.body.rue);
      if (req.body.codePostal !== undefined) updates.codePostal = clean(req.body.codePostal);
      if (req.body.ville !== undefined) {
        const newVille = normalizeCity(clean(req.body.ville));
        updates.ville = newVille;
        const explicitSector = req.body.secteur !== undefined ? clean(req.body.secteur) : "";
        updates.secteur = deriveSector(newVille, explicitSector);
      }
      if (req.body.telephone !== undefined) updates.telephone = clean(req.body.telephone);
      if (req.body.notes !== undefined) updates.notes = clean(req.body.notes);

      Object.assign(client, updates);
      client.updatedAt = new Date().toISOString();

      const matchingOrders = db.commandes.filter(o => String(o.clientId) === String(client.id));
      matchingOrders.forEach(order => {
        if (updates.nom !== undefined) order.clientName = updates.nom;
        if (updates.rue !== undefined) order.address = updates.rue;
        if (updates.codePostal !== undefined) order.postalCode = updates.codePostal;
        if (updates.ville !== undefined) order.city = updates.ville;
        if (updates.ville !== undefined) order.sector = updates.secteur;
        if (updates.telephone !== undefined) order.phone = updates.telephone;
        if (updates.notes !== undefined) order.notes = updates.notes;
        order.updatedAt = new Date().toISOString();
      });

      addHistory(db, "Client", `${client.nom} : profil mis a jour`, {
        clientId: client.id,
        champsModifies: Object.keys(updates)
      });

      writeDb(db);
      return { client, ordersUpdated: matchingOrders.length };
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur mise a jour client");
  }
});

app.patch("/api/clients/:id/coordinates", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const client = db.clients.find(c => String(c.id) === String(req.params.id));

      if (!client) {
        throw notFound("Client introuvable");
      }

      const lat = parseCoordinate(req.body.lat, -90, 90);
      const lng = parseCoordinate(req.body.lng, -180, 180);

      if (!lat.ok || !lng.ok) {
        throw badRequest("Coordonnees invalides");
      }

      client.lat = lat.value;
      client.lng = lng.value;

      const order = db.commandes.find(item => String(item.clientId) === String(client.id));
      if (order) {
        order.lat = lat.value;
        order.lng = lng.value;
        order.updatedAt = new Date().toISOString();
      }

      addHistory(db, "Coordonnees", `${client.nom} : coordonnees mises a jour`, {
        clientId: client.id,
        lat: client.lat,
        lng: client.lng
      });

      writeDb(db);
      return client;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur coordonnees");
  }
});

app.post("/api/orders/:id/start-preparation", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = findOrder(db, req.params.id);

      reserveStockForOrder(db, order);
      setOrderStatus(order, "en_preparation");

      addHistory(db, "Preparation", `${order.clientName} : preparation demarree`, {
        orderId: order.id,
        clientId: order.clientId
      });

      writeDb(db);
      return order;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur preparation");
  }
});

app.post("/api/orders/:id/finish-preparation", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = findOrder(db, req.params.id);

      if (!["en_preparation", "preparation_terminee", "pret_livraison"].includes(order.status)) {
        throw badRequest("La commande doit etre en preparation avant validation");
      }

      setOrderStatus(order, "pret_livraison");
      order.deliveryDate = normalizeDateInput(req.body?.deliveryDate) || order.deliveryDate || new Date().toISOString().slice(0, 10);

      addHistory(db, "Preparation", `${order.clientName} : pret pour livraison`, {
        orderId: order.id,
        clientId: order.clientId,
        deliveryDate: order.deliveryDate
      });

      writeDb(db);
      return order;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur fin preparation");
  }
});

app.patch("/api/orders/:id", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = findOrder(db, req.params.id);

      if (req.body.notes !== undefined) order.notes = clean(req.body.notes);
      if (req.body.priority !== undefined) order.priority = clean(req.body.priority);
      if (req.body.sector !== undefined) order.sector = deriveSector(order.city, req.body.sector);
      if (req.body.deliveryDate !== undefined) order.deliveryDate = normalizeDateInput(req.body.deliveryDate);
      if (req.body.status !== undefined) setOrderStatus(order, req.body.status);

      order.updatedAt = new Date().toISOString();
      writeDb(db);
      return order;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur commande");
  }
});

// Chantier 1 (2026-06-04) : endpoint admin explicite pour LIBERER la reservation
// de stock d'une commande en `probleme_livraison` ou `a_reprogrammer`. Pattern
// ERP standard (Odoo, ERPNext) : la liberation n'est jamais auto sur ces
// statuts (livraison echouee = relivraison sous 24-72h sur meme stock). Mais
// l'admin doit pouvoir le decider explicitement quand la commande n'est plus
// reprogrammable.
//
// Reponse : { released: bool, lines: number, reason: string }
app.post("/api/orders/:id/release-stock", async (req, res) => {
  try {
    const reason = clean(req.body?.reason) || "manual_release";
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = findOrder(db, req.params.id);

      if (!order.stockReservedAt) {
        return { released: false, lines: 0, reason: "no_reservation", message: "Aucune reservation active sur cette commande" };
      }
      if (!["probleme_livraison", "a_reprogrammer"].includes(order.status)) {
        throw badRequest("La liberation manuelle de stock est reservee aux commandes en probleme_livraison ou a_reprogrammer");
      }

      const released = releaseOrderStockReservation(db, order, reason);
      order.updatedAt = new Date().toISOString();

      writeDb(db);
      return { released, lines: released ? 1 : 0, reason, order };
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur liberation stock");
  }
});

app.post("/api/routes", async (req, res) => {
  try {
    const route = await withWriteLock(async () => {
      const db = readDb();
      const r = createRoute(db, {
        sector: req.body.sector,
        city: req.body.city,
        deliveryDate: req.body.deliveryDate,
        orderIds: req.body.orderIds
      });

      addHistory(db, "Tournee", `${r.stops.length} arret(s) ajoutes a la tournee ${r.sector}`, {
        routeId: r.id,
        sector: r.sector
      });

      writeDb(db);
      return r;
    });
    res.status(201).json(route);
  } catch (error) {
    handleRouteError(error, res, "Erreur creation tournee");
  }
});

app.post("/api/routes/:id/start", async (req, res) => {
  try {
    const route = await withWriteLock(async () => {
      const db = readDb();
      const r = startRoute(db, req.params.id);

      addHistory(db, "Tournee", `${r.stops.length} arret(s) en livraison`, {
        routeId: r.id
      });

      writeDb(db);
      return r;
    });
    res.json(route);
  } catch (error) {
    handleRouteError(error, res, "Erreur demarrage tournee");
  }
});

app.patch("/api/routes/:routeId/stops/:stopId", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const r = updateRouteStop(db, req.params.routeId, req.params.stopId, req.body.status, req.body.notes);

      addHistory(db, "Livraison", `${r.stop.clientName} : ${r.stop.status}`, {
        routeId: r.route.id,
        stopId: r.stop.id,
        orderId: r.order.id
      });

      writeDb(db);
      return r;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur statut livraison");
  }
});

app.patch("/api/routes/:id/reorder", async (req, res) => {
  try {
    const route = await withWriteLock(async () => {
      const db = readDb();
      const r = reorderRouteStops(db, req.params.id, req.body.stopIds);

      addHistory(db, "Tournee", "Ordre de tournee modifie", {
        routeId: r.id
      });

      writeDb(db);
      return r;
    });
    res.json(route);
  } catch (error) {
    handleRouteError(error, res, "Erreur ordre tournee");
  }
});

// Revue R1 P1 #7+#8 : depuis Phase 2 ERP, un client peut avoir PLUSIEURS
// commandes actives. L'ancien code ne mettait a jour que la 1re trouvee, et
// retournait 200 meme quand aucune commande n'etait trouvee (silent failure).
// Maintenant :
// - on cherche TOUTES les commandes du client en cours de livraison
// - si aucune trouvee mais le client existe : 200 avec ordersUpdated:0
// - on retourne le compte des commandes mises a jour pour traçabilite
app.post("/api/livraison", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const { clientId, statut, orderId } = req.body;

      if (!DELIVERY_STATUSES.has(statut)) {
        throw badRequest("Statut livraison invalide");
      }

      const c = db.clients.find(x => String(x.id) === String(clientId));
      if (!c) {
        throw notFound("Client introuvable");
      }
      c.statut = statut;

      // Filtre des commandes a affecter :
      // - si orderId est fourni : juste cette commande (precis)
      // - sinon : TOUTES les commandes actives (non-livre, non-archived) du client
      const candidateOrders = orderId
        ? db.commandes.filter(item => String(item.id) === String(orderId) && String(item.clientId) === String(clientId))
        : db.commandes.filter(item =>
            String(item.clientId) === String(clientId)
            && !["livre"].includes(item.status)
          );

      let ordersUpdated = 0;
      candidateOrders.forEach(order => {
        const targetStatus =
          statut === "livree" ? "livre"
          : statut === "en_cours" ? "en_livraison"
          : ["absent", "probleme", "non_livre"].includes(statut) ? "probleme_livraison"
          : null;
        if (targetStatus && isValidOrderStatusTransition(order.status, targetStatus)) {
          setOrderStatus(order, targetStatus);
          ordersUpdated += 1;
        }
      });

      addHistory(db, "Livraison", `${c.nom} : ${statut} (${ordersUpdated} commande(s))`, {
        clientId,
        statut,
        ordersUpdated,
        orderId: orderId || null
      });

      writeDb(db);
      return { client: c, ordersUpdated, orderIds: candidateOrders.filter((_, i) => i < ordersUpdated).map(o => o.id) };
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur livraison");
  }
});

app.post("/api/reset-tournee", async (req, res) => {
  try {
    await withWriteLock(async () => {
      const db = readDb();

      db.clients = db.clients.map(client => ({
        ...client,
        statut: "restant"
      }));

      db.commandes = db.commandes.map(order => {
        if (["en_livraison", "livre", "probleme_livraison", "a_reprogrammer"].includes(order.status)) {
          setOrderStatus(order, order.preparationStatus === "terminee" ? "pret_livraison" : "stock_a_verifier");
        }

        return order;
      });

      db.routes = db.routes.map(route => ({
        ...route,
        status: route.status === "en_livraison" ? "prete" : route.status,
        stops: route.stops.map(stop => ({
          ...stop,
          status: stop.status === "en_livraison" ? "pret_livraison" : stop.status
        }))
      }));

      addHistory(db, "Tournee", "Tournee reinitialisee");
      writeDb(db);
    });
    res.json({ success: true });
  } catch (error) {
    handleRouteError(error, res, "Erreur reset tournee");
  }
});

app.post("/api/optimize-route", async (req, res) => {
  try {
    const optimizedClients = await withWriteLock(async () => {
      const db = readDb();
      const requestedIds = Array.isArray(req.body?.clientIds) ? new Set(req.body.clientIds.map(String)) : null;

      const source = requestedIds
        ? db.clients.filter(client => requestedIds.has(String(client.id)))
        : db.clients.filter(client => ["restant", "en_cours"].includes(client.statut || "restant"));

      const withCoords = source.filter(client => getCoordinates(client));
      const withoutCoords = source.filter(client => !getCoordinates(client));

      let remaining = [...withCoords];
      const optimized = [];

      if (remaining.length > 0) {
        let current = remaining.shift();
        optimized.push(current);

        while (remaining.length > 0) {
          remaining.sort((a, b) => distance(current, a) - distance(current, b));
          current = remaining.shift();
          optimized.push(current);
        }
      }

      const result = [...optimized, ...withoutCoords.sort((a, b) => fallbackOrderSort(
        {
          sector: a.secteur,
          city: a.ville,
          postalCode: a.codePostal,
          address: a.rue,
          clientName: a.nom
        },
        {
          sector: b.secteur,
          city: b.ville,
          postalCode: b.codePostal,
          address: b.rue,
          clientName: b.nom
        }
      ))];

      if (!requestedIds) {
        const optimizedIds = new Set(result.map(client => String(client.id)));
        db.clients = [
          ...result,
          ...db.clients.filter(client => !optimizedIds.has(String(client.id)))
        ];
        addHistory(db, "Tournee", "Tournee optimisee");
        writeDb(db);
      }
      return result;
    });
    res.json({ success: true, route: optimizedClients });
  } catch (error) {
    handleRouteError(error, res, "Erreur optimisation tournee");
  }
});

function startServer(port = PORT, host = HOST) {
  // P1 v1.14.0 : healing initial pour garantir la coherence apres restart
  // (notamment apres restauration d'un backup ou montee de version)
  healDatabaseAtBoot();
  return app.listen(port, host, () => {
    console.log(`Sereo lance sur http://${host}:${port}`);
    if (host === "0.0.0.0" || host === "::") {
      console.log("Acces reseau local active. A utiliser seulement sur un reseau de confiance.");
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  closeStorage,
  defaultDb,
  readDb,
  writeDb,
  getRecommendations,
  productKey,
  clientSecondaryKey,
  isFactureStatusLivre,
  generateOrderNumber,
  computeOrderHash,
  extractYear,
  ensureOrderNumbers,
  normalizeSettings,
  normalizeCity,
  deriveSector,
  analyzeOrderStock,
  calculateReservedStock,
  calculateNeededStock,
  getStockStatus,
  getStockView,
  getDashboardSummary,
  getDeliverableOrders,
  createRoute,
  optimizeOrders,
  parseCoordinate,
  getCoordinates,
  parseBasicAuthHeader,
  isAuthorizedRequest,
  isAccessAuthEnabled,
  // Helpers de test : ne pas appeler depuis du code applicatif
  _resetAuthRateLimitForTest: () => authRateLimitState.clear(),
  _createAccessSessionValueForTest: createAccessSessionValue,
  _normalizeOrder: normalizeOrder,
  _getLastStorageRecovery: () => lastStorageRecovery,
  // Chantier 2 : permet aux tests d'attendre que le backup async finisse
  // avant d'assertioner sur le filesystem.
  _flushPendingBackup: flushPendingBackup,
  _resetStorageRecoveryForTest: () => { lastStorageRecovery = null; storageRecoveryFatal = null; backupsSuspendedFreshEmpty = false; lastBackupAt = null; lastBackupError = null; },
  _isCorruptionError: isCorruptionError,
  _normalizeDateInput: normalizeDateInput,
  _excelDateToIso: excelDateToIso,
  _distance: distance,
  _number: number,
  _importQuantity: importQuantity,
  _estimateRouteMetrics: estimateRouteMetrics,
  _scanSuspiciousDates: scanSuspiciousDates,
  _getAuthRateLimitMaxAttempts: () => AUTH_RATE_LIMIT_MAX_ATTEMPTS,
  DB_PATH,
  SQLITE_PATH,
  STORAGE_ENGINE,
  UPLOAD_DIR,
  BACKUP_DIR,
  HOST
};

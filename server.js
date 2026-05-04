const express = require("express");
const multer = require("multer");
const readXlsxFile = require("read-excel-file/node");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createSqliteStore } = require("./storage/sqliteStore");

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.SEREO_HOST || process.env.HOST || "127.0.0.1";

const DB_PATH = path.resolve(process.env.SEREO_DB_PATH || path.join(__dirname, "data", "db.json"));
const STORAGE_ENGINE = (process.env.SEREO_STORAGE || "sqlite").toLowerCase();
const SQLITE_PATH = path.resolve(process.env.SEREO_SQLITE_PATH || process.env.SQLITE_PATH || path.join(__dirname, "data", "sereo.sqlite"));
const UPLOAD_DIR = path.resolve(process.env.SEREO_UPLOAD_DIR || path.join(__dirname, "imports"));
const BACKUP_DIR = path.resolve(process.env.SEREO_BACKUP_DIR || path.join(path.dirname(STORAGE_ENGINE === "json" ? DB_PATH : SQLITE_PATH), "backups"));
const LEAFLET_DIST = path.join(__dirname, "node_modules", "leaflet", "dist");
const ENABLE_DB_EXPORT = process.env.SEREO_ENABLE_DB_EXPORT === "1";
const AUTH_USER = cleanEnv(process.env.SEREO_AUTH_USER);
const AUTH_PASSWORD = cleanEnv(process.env.SEREO_AUTH_PASSWORD);
const AUTH_REALM = cleanEnv(process.env.SEREO_AUTH_REALM) || "Sereo";
const AUTH_SESSION_SECRET = cleanEnv(process.env.SEREO_AUTH_SESSION_SECRET) || AUTH_PASSWORD || AUTH_REALM;
const AUTH_COOKIE_NAME = "sereo_access";
const AUTH_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

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
app.use(securityHeaders);
app.use("/brand", express.static(path.join(__dirname, "public", "brand"), { immutable: true, maxAge: "1d" }));
app.get("/favicon.svg", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "favicon.svg"));
});
app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.get("/login", renderLoginPage);
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

      cookies[name] = decodeURIComponent(value);
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

function requireAccessAuth(req, res, next) {
  if (isAccessAuthMisconfigured()) {
    res.status(500).json({
      error: "Protection d'acces mal configuree. Renseigner SEREO_AUTH_USER et SEREO_AUTH_PASSWORD."
    });
    return;
  }

  if (isAuthorizedRequest(req)) {
    next();
    return;
  }

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

  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/login")) {
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
  const errorMarkup = hasError
    ? '<p class="login-error" role="alert">Identifiant ou mot de passe incorrect.</p>'
    : "";

  res.status(hasError ? 401 : 200).send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connexion - s&eacute;r&eacute;o</title>
  <style>
    :root {
      --brand-teal: #0e6b63;
      --pastel-green: #cfe9e1;
      --pastel-green-light: #e8f4ef;
      --pastel-orange: #ffc4a3;
      --pastel-orange-strong: #f47a5a;
      --surface: #fffefa;
      --text: #0f2937;
    }

    * { box-sizing: border-box; }

    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(207, 233, 225, 0.95), transparent 34%),
        radial-gradient(circle at bottom right, rgba(255, 196, 163, 0.55), transparent 36%),
        #fafaf8;
    }

    .login-card {
      width: min(100%, 420px);
      padding: 34px;
      border: 1px solid rgba(14, 107, 99, 0.16);
      border-radius: 28px;
      background: rgba(255, 254, 250, 0.92);
      box-shadow: 0 24px 60px rgba(15, 41, 55, 0.12);
    }

    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 76px;
      margin-bottom: 24px;
      border-radius: 18px;
      background: white;
    }

    .brand img {
      max-width: 170px;
      max-height: 58px;
      object-fit: contain;
    }

    h1 {
      margin: 0 0 8px;
      color: var(--brand-teal);
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: 0;
    }

    .intro {
      margin: 0 0 24px;
      color: rgba(15, 41, 55, 0.72);
      line-height: 1.45;
    }

    label {
      display: block;
      margin: 0 0 8px;
      color: var(--brand-teal);
      font-weight: 700;
      font-size: 14px;
    }

    input {
      width: 100%;
      min-height: 48px;
      margin-bottom: 16px;
      padding: 12px 14px;
      border: 1px solid rgba(14, 107, 99, 0.24);
      border-radius: 14px;
      background: white;
      color: var(--text);
      font: inherit;
      outline: none;
    }

    input:focus {
      border-color: var(--pastel-orange-strong);
      box-shadow: 0 0 0 4px rgba(255, 196, 163, 0.36);
    }

    button {
      width: 100%;
      min-height: 50px;
      border: 0;
      border-radius: 16px;
      background: var(--pastel-orange-strong);
      color: white;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 12px 24px rgba(244, 122, 90, 0.22);
    }

    .login-error {
      margin: 0 0 18px;
      padding: 12px 14px;
      border: 1px solid rgba(244, 122, 90, 0.26);
      border-radius: 14px;
      background: rgba(255, 196, 163, 0.28);
      color: #9c341f;
      font-weight: 700;
    }

    @media (max-width: 480px) {
      body { padding: 16px; }
      .login-card { padding: 24px; border-radius: 22px; }
    }
  </style>
</head>
<body>
  <main class="login-card" aria-labelledby="login-title">
    <div class="brand"><img src="/brand/sereo-logo.svg" alt="s&eacute;r&eacute;o"></div>
    <h1 id="login-title">Acc&egrave;s prot&eacute;g&eacute;</h1>
    <p class="intro">Connecte-toi pour ouvrir l'application.</p>
    ${errorMarkup}
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <label for="username">Identifiant</label>
      <input id="username" name="username" autocomplete="username" autofocus required>
      <label for="password">Mot de passe</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Se connecter</button>
    </form>
  </main>
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

  if (!isAccessAuthEnabled()) {
    res.redirect(next);
    return;
  }

  if (!constantTimeEqual(username, AUTH_USER) || !constantTimeEqual(password, AUTH_PASSWORD)) {
    res.redirect(303, `/login?error=1&next=${encodeURIComponent(next)}`);
    return;
  }

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
    settings: {
      appearance: {
        themeId: "sereo",
        brandImage: ""
      }
    }
  };
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function useSqliteStorage() {
  return STORAGE_ENGINE !== "json";
}

let sqliteStore;

function getSqliteStore() {
  if (!sqliteStore) {
    sqliteStore = createSqliteStore({
      sqlitePath: SQLITE_PATH,
      seedJsonPath: DB_PATH,
      defaultDb,
      normalizeDb,
      ensureDir
    });
  }

  return sqliteStore;
}

function closeStorage() {
  if (sqliteStore) {
    sqliteStore.close();
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
  const db = raw ? JSON.parse(raw) : defaultDb();

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
  db.settings = normalizeSettings(db.settings);

  syncWorkflow(db);
  return db;
}

function normalizeSettings(settings = {}) {
  const appearance = settings && typeof settings === "object" && settings.appearance && typeof settings.appearance === "object"
    ? settings.appearance
    : {};

  return {
    ...settings,
    appearance: {
      themeId: clean(appearance.themeId) || "sereo",
      brandImage: clean(appearance.brandImage)
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

function writeDb(db, options = {}) {
  const { backup = true } = options;

  syncWorkflow(db);

  if (backup) {
    backupDbIfNeeded();
  }

  if (useSqliteStorage()) {
    getSqliteStore().writeDb(db);
    return;
  }

  ensureDir(path.dirname(DB_PATH));
  const tempPath = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tempPath, DB_PATH);
}

function backupDbIfNeeded() {
  const sourcePath = useSqliteStorage() ? SQLITE_PATH : DB_PATH;
  if (!fs.existsSync(sourcePath)) return null;

  ensureDir(BACKUP_DIR);

  if (useSqliteStorage()) {
    getSqliteStore().checkpoint();
  }

  const extension = useSqliteStorage() ? ".sqlite" : ".json";
  const backupPath = path.join(BACKUP_DIR, `db-${safeTimestamp()}${extension}`);
  fs.copyFileSync(sourcePath, backupPath);
  return backupPath;
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function addHistory(db, type, message, details = {}) {
  db.historique.unshift({
    id: Date.now(),
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

function excelDate(value) {
  if (!value) return "";

  if (value instanceof Date) {
    return value.toLocaleDateString("fr-FR");
  }

  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000);
    return date.toLocaleDateString("fr-FR", { timeZone: "UTC" });
  }

  return clean(value);
}

function normalizeDateInput(value) {
  if (!value) return "";

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  }

  const text = clean(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const frenchDate = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (frenchDate) {
    const day = frenchDate[1].padStart(2, "0");
    const month = frenchDate[2].padStart(2, "0");
    const rawYear = frenchDate[3];
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${month}-${day}`;
  }

  return "";
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
  const routeClientIds = getRouteClientIds(db);
  const existingOrders = new Map(db.commandes.map(order => [String(order.clientId), order]));
  const preservedClients = db.clients.filter(client => {
    const key = clientKey(client);
    if (importedKeys.has(key)) return false;
    return shouldPreserveClientAfterImport(client, existingOrders.get(String(client.id)), routeClientIds);
  });

  return {
    clients: [...importedClients, ...preservedClients],
    preservedCount: preservedClients.length
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
    return total + Math.max(1, number(line.quantite, 1));
  }, 0);
}

function calculateReservedStock(db, product) {
  return db.commandes.reduce((total, order) => {
    const isReserved = Boolean(
      order.stockReservedAt
      && ["en_preparation", "preparation_terminee", "pret_livraison", "en_livraison"].includes(order.status)
    );

    return isReserved ? total + getQuantityForProductInOrder(product, order) : total;
  }, 0);
}

function calculateNeededStock(db, product) {
  return db.commandes.reduce((total, order) => {
    if (!["importe", "stock_a_verifier", "en_preparation", "pret_livraison"].includes(order.status)) {
      return total;
    }

    return total + getQuantityForProductInOrder(product, order);
  }, 0);
}

function getStockStatus(product, db) {
  const quantity = getStockQuantity(product);

  if (quantity === null) return "a_renseigner";
  if (quantity <= 0) return "rupture";
  if (quantity <= getStockAlertThreshold(product)) return "stock_faible";
  if (db && calculateReservedStock(db, product) > 0) return "reserve";
  return "disponible";
}

function enrichStockItem(db, product) {
  const quantityAvailable = getStockQuantity(product);
  const quantityReserved = calculateReservedStock(db, product);
  const quantityNeeded = calculateNeededStock(db, product);

  return {
    ...product,
    sku: product.sku || product.reference || product.code || "",
    category: product.category || product.categorie || product.type || "",
    quantityAvailable,
    quantityReserved,
    quantityNeeded,
    quantityTotal: quantityAvailable === null ? null : quantityAvailable + quantityReserved,
    alertThreshold: getStockAlertThreshold(product),
    stockStatus: getStockStatus(product, db)
  };
}

function getStockView(db) {
  return db.stock.map(product => enrichStockItem(db, product));
}

function getRecommendations(db) {
  return getStockView(db)
    .filter(product => ["stock_faible", "rupture", "a_renseigner"].includes(product.stockStatus))
    .map(product => {
      const available = Number(product.quantityAvailable) || 0;
      const needed = Number(product.quantityNeeded) || 0;
      const minimum = Number(product.alertThreshold) || 5;
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
    id: `stock-${Date.now()}-${db.stockMovements.length + 1}`,
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
      const quantity = Math.max(1, number(isObject ? product.quantite || product.quantity || product.qte : 1, 1));

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
    const required = Math.max(1, number(product.quantite, 1));
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

function syncWorkflow(db) {
  const existingOrders = new Map(db.commandes.map(order => [String(order.clientId), order]));

  db.clients = db.clients.map(client => normalizeClient(client));

  const generatedOrders = db.clients.map(client => {
    const existing = existingOrders.get(String(client.id)) || {};
    return normalizeOrder({
      ...existing,
      clientId: client.id,
      clientName: client.nom,
      address: client.rue,
      city: client.ville,
      postalCode: client.codePostal,
      sector: existing.sector || client.secteur || client.sector,
      phone: client.telephone,
      products: client.produits,
      latitude: client.lat,
      longitude: client.lng,
    notes: existing.notes || client.notes || "",
      priority: existing.priority || client.priority || "",
      deliveryDate: existing.deliveryDate || client.deliveryDate || ""
    });
  });

  const generatedClientIds = new Set(generatedOrders.map(order => String(order.clientId)));
  const generatedIds = new Set(generatedOrders.map(order => String(order.id)));
  const detachedOrders = db.commandes
    .filter(order => !generatedClientIds.has(String(order.clientId)) && !generatedIds.has(String(order.id)))
    .map(normalizeOrder);

  db.commandes = [...generatedOrders, ...detachedOrders].map(order => enrichOrder(order, db.stock));

  const orderByClientId = new Map(db.commandes.map(order => [String(order.clientId), order]));
  db.clients = db.clients.map(client => {
    const order = orderByClientId.get(String(client.id));
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
    id: client.id ?? Date.now(),
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

  return {
    id: order.id || `cmd-${order.clientId || Date.now()}`,
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
    routeId: order.routeId || null
  };
}

function enrichOrder(order, stock) {
  const stockCheck = analyzeOrderStock(order, stock);
  const stockReserved = Boolean(order.stockReservedAt && ["en_preparation", "preparation_terminee", "pret_livraison", "en_livraison"].includes(order.status));

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

  order.status = status;
  order.preparationStatus = inferPreparationStatus(status);
  order.deliveryStatus = inferDeliveryStatus(status);
  order.updatedAt = new Date().toISOString();
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
  const routeId = `route-${Date.now()}`;
  const now = new Date().toISOString();
  const metrics = estimateRouteMetrics(optimizedOrders);

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

function estimateRouteMetrics(orders) {
  let totalDistance = null;

  for (let i = 1; i < orders.length; i++) {
    const previous = orders[i - 1];
    const current = orders[i];

    if (!getCoordinates(previous) || !getCoordinates(current)) {
      totalDistance = null;
      break;
    }

    totalDistance = (totalDistance || 0) + distance(previous, current) * 111;
  }

  const estimatedDuration = totalDistance === null
    ? null
    : Math.round((totalDistance / 35) * 60 + orders.length * 6);

  return {
    totalDistance: totalDistance === null ? null : Math.round(totalDistance * 10) / 10,
    estimatedDuration
  };
}

function distance(a, b) {
  const coordsA = getCoordinates(a);
  const coordsB = getCoordinates(b);

  if (!coordsA || !coordsB) return Number.POSITIVE_INFINITY;

  return Math.sqrt(
    Math.pow(coordsA.lat - coordsB.lat, 2) +
    Math.pow(coordsA.lng - coordsB.lng, 2)
  );
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
    path: useSqliteStorage() ? SQLITE_PATH : DB_PATH
  });
});

app.get("/api/settings/appearance", (req, res) => {
  res.json(getAppearanceSettings(readDb()));
});

app.patch("/api/settings/appearance", (req, res) => {
  try {
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

    db.settings.appearance = appearance;
    writeDb(db);
    res.json(appearance);
  } catch (error) {
    handleRouteError(error, res, "Erreur parametres");
  }
});

app.get("/api/orders", (req, res) => {
  const db = readDb();
  res.json(db.commandes);
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
    const db = readDb();

    db.stock = dataRows
      .map((row, index) => {
        const code = clean(getCellByNames(row, headers, ["Code", "Reference", "Référence", "SKU"]));
        const nom = clean(getCellByNames(row, headers, ["Nom", "Produit", "Article"]));
        const cout = number(getCellByNames(row, headers, ["Cout", "Coût", "Prix achat"]), 0);
        const tarif = number(getCellByNames(row, headers, ["Tarif", "Prix", "Prix vente"]), 0);
        const quantite = optionalQuantity(getCellByNames(row, headers, ["Quantite", "Stock", "Qte"]));
        const category = clean(getCellByNames(row, headers, ["Categorie", "Category", "Type"]));
        const alertThreshold = optionalQuantity(getCellByNames(row, headers, ["Seuil", "Seuil alerte", "Minimum", "Alerte"]));

        return {
          id: Date.now() + index,
          code,
          sku: code,
          nom,
          quantite,
          tarif,
          cout,
          statut: clean(getCell(row, headers, "Statut", 1)),
          type: category,
          category,
          alertThreshold
        };
      })
      .filter(product => product.code || product.nom);

    syncWorkflow(db);
    addHistory(db, "Import stock", `${db.stock.length} produit(s) importe(s) depuis le fichier tarifs`, {
      fichier: req.file.originalname
    });

    writeDb(db);

    res.json({
      success: true,
      stock: db.stock,
      commandes: db.commandes
    });
  } catch (error) {
    handleRouteError(error, res, "Erreur import stock");
  } finally {
    cleanupUploadedFile(uploadedPath);
  }
});

app.post("/api/import/ventes", uploadExcel, async (req, res) => {
  const uploadedPath = req.file?.path;

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
    const db = readDb();
    const existingClients = new Map(db.clients.map(client => [clientKey(client), client]));

    const ventes = dataRows
      .map((row, index) => {
        const codeProduit = clean(getCellByNames(row, headers, ["Code", "Reference", "Référence", "SKU"]));
        const nomProduit = clean(getCellByNames(row, headers, ["Nom", "Produit", "Article"]));
        const client = clean(getCellByNames(row, headers, ["Client", "Nom client", "Client final"]));
        const statutFacture = clean(getCell(row, headers, "Statut", 1));
        const date = excelDate(getCell(row, headers, "Date", 1));
        const deliveryDate = normalizeDateInput(getCellByNames(row, headers, ["Date livraison", "Livraison", "Date de livraison"]));
        const quantite = number(getCellByNames(row, headers, ["Quantite", "Quantité", "Qte", "Qté"]), 1);
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
          id: Date.now() + index,
          codeProduit,
          produit: nomProduit || produitComplet,
          produitComplet,
          client,
          statutFacture,
          date,
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

    const clientsMap = {};
    const existingOrders = new Map(db.commandes.map(order => [String(order.clientId), order]));

    ventes.forEach(vente => {
      const key = clientKey({
        nom: vente.client,
        rue: vente.rue,
        codePostal: vente.codePostal,
        ville: vente.ville
      });
      const existingClient = existingClients.get(key) || {};

      if (!clientsMap[key]) {
        const id = existingClient.id || Date.now() + Object.keys(clientsMap).length;
        const existingOrder = existingOrders.get(String(id)) || {};

        clientsMap[key] = {
          id,
          nom: vente.client || "Client sans nom",
          rue: vente.rue,
          ville: vente.ville,
          codePostal: vente.codePostal,
          telephone: vente.telephone,
          statut: existingClient.statut || "restant",
          produits: [],
          lat: vente.lat !== "" ? vente.lat : (existingClient.lat || ""),
          lng: vente.lng !== "" ? vente.lng : (existingClient.lng || ""),
          secteur: vente.secteur,
          deliveryDate: vente.deliveryDate,
          notes: vente.notes || existingClient.notes || existingOrder.notes || "",
          priority: vente.priority || existingClient.priority || existingOrder.priority || ""
        };
      }

      clientsMap[key].produits.push({
        code: vente.codeProduit,
        nom: vente.produit,
        quantite: vente.quantite
      });
    });

    const importedClients = Object.values(clientsMap);
    const mergedImport = mergeImportedClients(db, importedClients);
    db.clients = mergedImport.clients;
    db.commandes = db.clients.map(client => {
      const existingOrder = existingOrders.get(String(client.id)) || {};
      return normalizeOrder({
        ...existingOrder,
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
        deliveryDate: existingOrder.deliveryDate || client.deliveryDate,
        status: existingOrder.status || "stock_a_verifier"
      });
    });

    syncWorkflow(db);
    const preservedMessage = mergedImport.preservedCount > 0
      ? `, ${mergedImport.preservedCount} client(s) deja en workflow conserve(s)`
      : "";
    addHistory(
      db,
      "Import ventes",
      `${db.ventes.length} vente(s) importee(s), ${importedClients.length} client(s) detecte(s)${preservedMessage}`,
      {
        fichier: req.file.originalname
      }
    );

    writeDb(db);

    res.json({
      success: true,
      ventes: db.ventes,
      clients: db.clients,
      commandes: db.commandes,
      secteurs: getSectors(db)
    });
  } catch (error) {
    handleRouteError(error, res, "Erreur import ventes");
  } finally {
    cleanupUploadedFile(uploadedPath);
  }
});

app.patch("/api/stock/:id", (req, res) => {
  try {
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
    res.json(enrichStockItem(db, product));
  } catch (error) {
    handleRouteError(error, res, "Erreur modification stock");
  }
});

app.patch("/api/clients/:id/coordinates", (req, res) => {
  try {
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
    res.json(client);
  } catch (error) {
    handleRouteError(error, res, "Erreur coordonnees");
  }
});

app.post("/api/orders/:id/start-preparation", (req, res) => {
  try {
    const db = readDb();
    const order = findOrder(db, req.params.id);

    reserveStockForOrder(db, order);
    setOrderStatus(order, "en_preparation");

    addHistory(db, "Preparation", `${order.clientName} : preparation demarree`, {
      orderId: order.id,
      clientId: order.clientId
    });

    writeDb(db);
    res.json(order);
  } catch (error) {
    handleRouteError(error, res, "Erreur preparation");
  }
});

app.post("/api/orders/:id/finish-preparation", (req, res) => {
  try {
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
    res.json(order);
  } catch (error) {
    handleRouteError(error, res, "Erreur fin preparation");
  }
});

app.patch("/api/orders/:id", (req, res) => {
  try {
    const db = readDb();
    const order = findOrder(db, req.params.id);

    if (req.body.notes !== undefined) order.notes = clean(req.body.notes);
    if (req.body.priority !== undefined) order.priority = clean(req.body.priority);
    if (req.body.sector !== undefined) order.sector = deriveSector(order.city, req.body.sector);
    if (req.body.deliveryDate !== undefined) order.deliveryDate = normalizeDateInput(req.body.deliveryDate);
    if (req.body.status !== undefined) setOrderStatus(order, req.body.status);

    order.updatedAt = new Date().toISOString();
    writeDb(db);
    res.json(order);
  } catch (error) {
    handleRouteError(error, res, "Erreur commande");
  }
});

app.post("/api/routes", (req, res) => {
  try {
    const db = readDb();
    const route = createRoute(db, {
      sector: req.body.sector,
      city: req.body.city,
      deliveryDate: req.body.deliveryDate,
      orderIds: req.body.orderIds
    });

    addHistory(db, "Tournee", `${route.stops.length} arret(s) ajoutes a la tournee ${route.sector}`, {
      routeId: route.id,
      sector: route.sector
    });

    writeDb(db);
    res.status(201).json(route);
  } catch (error) {
    handleRouteError(error, res, "Erreur creation tournee");
  }
});

app.post("/api/routes/:id/start", (req, res) => {
  try {
    const db = readDb();
    const route = startRoute(db, req.params.id);

    addHistory(db, "Tournee", `${route.stops.length} arret(s) en livraison`, {
      routeId: route.id
    });

    writeDb(db);
    res.json(route);
  } catch (error) {
    handleRouteError(error, res, "Erreur demarrage tournee");
  }
});

app.patch("/api/routes/:routeId/stops/:stopId", (req, res) => {
  try {
    const db = readDb();
    const result = updateRouteStop(db, req.params.routeId, req.params.stopId, req.body.status, req.body.notes);

    addHistory(db, "Livraison", `${result.stop.clientName} : ${result.stop.status}`, {
      routeId: result.route.id,
      stopId: result.stop.id,
      orderId: result.order.id
    });

    writeDb(db);
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur statut livraison");
  }
});

app.patch("/api/routes/:id/reorder", (req, res) => {
  try {
    const db = readDb();
    const route = reorderRouteStops(db, req.params.id, req.body.stopIds);

    addHistory(db, "Tournee", "Ordre de tournee modifie", {
      routeId: route.id
    });

    writeDb(db);
    res.json(route);
  } catch (error) {
    handleRouteError(error, res, "Erreur ordre tournee");
  }
});

app.post("/api/livraison", (req, res) => {
  try {
    const db = readDb();
    const { clientId, statut } = req.body;

    if (!DELIVERY_STATUSES.has(statut)) {
      throw badRequest("Statut livraison invalide");
    }

    const client = db.clients.find(c => String(c.id) === String(clientId));

    if (!client) {
      throw notFound("Client introuvable");
    }

    client.statut = statut;

    const order = db.commandes.find(item => String(item.clientId) === String(clientId));
    if (order) {
      if (statut === "livree") setOrderStatus(order, "livre");
      else if (statut === "en_cours") setOrderStatus(order, "en_livraison");
      else if (["absent", "probleme", "non_livre"].includes(statut)) setOrderStatus(order, "probleme_livraison");
    }

    addHistory(db, "Livraison", `${client.nom} : ${statut}`, {
      clientId,
      statut
    });

    writeDb(db);
    res.json(client);
  } catch (error) {
    handleRouteError(error, res, "Erreur livraison");
  }
});

app.post("/api/reset-tournee", (req, res) => {
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
  res.json({
    success: true
  });
});

app.post("/api/optimize-route", (req, res) => {
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

  const optimizedClients = [...optimized, ...withoutCoords.sort((a, b) => fallbackOrderSort(
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
    const optimizedIds = new Set(optimizedClients.map(client => String(client.id)));
    db.clients = [
      ...optimizedClients,
      ...db.clients.filter(client => !optimizedIds.has(String(client.id)))
    ];
    addHistory(db, "Tournee", "Tournee optimisee");
    writeDb(db);
  }

  res.json({
    success: true,
    route: optimizedClients
  });
});

function startServer(port = PORT, host = HOST) {
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
  DB_PATH,
  SQLITE_PATH,
  STORAGE_ENGINE,
  UPLOAD_DIR,
  BACKUP_DIR,
  HOST
};

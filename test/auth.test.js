const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-auth-"));

process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "admin-test";
process.env.SEREO_AUTH_PASSWORD = "mot-de-passe-test-long";
// Valeurs rate limit ajustees pour les tests : lockout au-dessus du floor de
// 1000ms applique en prod par Math.max dans server.js, et fenetre large pour
// garder le determinisme.
process.env.SEREO_AUTH_MAX_ATTEMPTS = "5";
process.env.SEREO_AUTH_RATE_WINDOW_MS = "60000";
process.env.SEREO_AUTH_LOCKOUT_MS = "1500";

const { app, closeStorage, _resetAuthRateLimitForTest } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function postLogin(username, password) {
  return fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
    redirect: "manual"
  });
}

test("healthcheck remains public when access protection is enabled", async () => {
  const health = await fetch(`${baseUrl}/healthz`);
  const body = await health.json();

  assert.equal(health.status, 200);
  assert.equal(body.ok, true);
});

test("access protection rejects anonymous requests and accepts valid credentials", async () => {
  const anonymous = await fetch(`${baseUrl}/api/storage/status`);
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("www-authenticate") || "", /Basic/);

  const wrongPassword = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Authorization: basicAuth("admin-test", "mauvais") }
  });
  assert.equal(wrongPassword.status, 401);

  const authenticated = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Authorization: basicAuth("admin-test", "mot-de-passe-test-long") }
  });
  const body = await authenticated.json();

  assert.equal(authenticated.status, 200);
  assert.equal(body.accessProtected, true);
});

test("access protection shows a usable login form and accepts a session cookie", async () => {
  _resetAuthRateLimitForTest();

  const root = await fetch(`${baseUrl}/`, { redirect: "manual" });
  const rootHtml = await root.text();
  assert.equal(root.status, 200);
  assert.match(rootHtml, /name="username"/);
  assert.match(rootHtml, /name="password"/);

  const loginPage = await fetch(`${baseUrl}/login`);
  const loginHtml = await loginPage.text();
  assert.equal(loginPage.status, 200);
  assert.match(loginHtml, /name="username"/);
  assert.match(loginHtml, /name="password"/);

  const wrongLogin = await postLogin("admin-test", "mauvais");
  assert.equal(wrongLogin.status, 303);
  assert.match(wrongLogin.headers.get("location") || "", /^\/login\?error=1/);

  const validLogin = await postLogin("admin-test", "mot-de-passe-test-long");
  assert.equal(validLogin.status, 303);
  assert.equal(validLogin.headers.get("location"), "/");

  const cookie = validLogin.headers.get("set-cookie");
  assert.match(cookie || "", /sereo_access=/);

  const authenticated = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Cookie: cookie }
  });
  const body = await authenticated.json();

  assert.equal(authenticated.status, 200);
  assert.equal(body.accessProtected, true);
});

// =============================================================================
// Rate limit /login (anti brute-force)
// =============================================================================

test("rate limit /login : remaining decroit a chaque tentative ratee", async () => {
  _resetAuthRateLimitForTest();

  const first = await postLogin("admin-test", "mauvais");
  assert.equal(first.status, 303);
  assert.match(first.headers.get("location") || "", /\/login\?error=1/);
  assert.match(first.headers.get("location") || "", /remaining=4/);

  const second = await postLogin("admin-test", "mauvais");
  assert.match(second.headers.get("location") || "", /remaining=3/);
});

test("rate limit /login : 5e tentative ratee verrouille l'IP, GET /login retourne 429", async () => {
  _resetAuthRateLimitForTest();

  for (let i = 0; i < 4; i += 1) {
    const r = await postLogin("admin-test", "mauvais");
    assert.match(r.headers.get("location") || "", /\/login\?error=1/, `tentative ${i + 1} doit etre error=1`);
  }

  const fifth = await postLogin("admin-test", "mauvais");
  assert.equal(fifth.status, 303);
  assert.match(fifth.headers.get("location") || "", /\/login\?locked=1/);
  assert.match(fifth.headers.get("location") || "", /until=\d+/);

  // Pendant le lockout, meme les credentials corrects sont rejetes
  // (on bloque AVANT meme de comparer les mdp, contre la timing-analysis)
  const validButLocked = await postLogin("admin-test", "mot-de-passe-test-long");
  assert.match(validButLocked.headers.get("location") || "", /\/login\?locked=1/);

  // GET /login pendant le lockout : 429 + Retry-After + countdown markup
  const lockedPage = await fetch(`${baseUrl}/login`);
  assert.equal(lockedPage.status, 429);
  assert.match(lockedPage.headers.get("retry-after") || "", /^\d+$/);
  const html = await lockedPage.text();
  assert.match(html, /Trop de tentatives/);
  assert.match(html, /id="lockout-countdown"/);
  assert.match(html, /data-locked-until="\d+"/);
});

test("rate limit /login : lockout expire et permet de retenter", async () => {
  _resetAuthRateLimitForTest();

  for (let i = 0; i < 5; i += 1) {
    await postLogin("admin-test", "mauvais");
  }

  // Lockout dure 1500ms en test, on attend 1700ms pour avoir une marge
  await new Promise(resolve => setTimeout(resolve, 1700));

  // Apres expiration, credentials corrects passent
  const afterLockout = await postLogin("admin-test", "mot-de-passe-test-long");
  assert.equal(afterLockout.status, 303);
  assert.equal(afterLockout.headers.get("location"), "/");
});

test("rate limit /login : succes efface le compteur d'echecs", async () => {
  _resetAuthRateLimitForTest();

  for (let i = 0; i < 3; i += 1) {
    await postLogin("admin-test", "mauvais");
  }

  // Succes : doit reset le compteur
  const valid = await postLogin("admin-test", "mot-de-passe-test-long");
  assert.equal(valid.headers.get("location"), "/");

  // 4 nouveaux echecs : ne doivent PAS atteindre le lockout (compteur reset a 0)
  for (let i = 0; i < 4; i += 1) {
    const r = await postLogin("admin-test", "mauvais");
    assert.match(r.headers.get("location") || "", /\/login\?error=1/, `iteration ${i + 1} doit etre error=1`);
  }
});

test("page /login affiche le nombre de tentatives restantes apres echec", async () => {
  _resetAuthRateLimitForTest();

  await postLogin("admin-test", "mauvais");
  const page = await fetch(`${baseUrl}/login?error=1&remaining=4`);
  const html = await page.text();
  assert.equal(page.status, 401);
  assert.match(html, /Il te reste 4 tentative/);
});

test("login.js est accessible sans auth (CSP script-src 'self' OK)", async () => {
  const js = await fetch(`${baseUrl}/login.js`);
  assert.equal(js.status, 200);
  const body = await js.text();
  assert.match(body, /data-locked-until/);
  assert.match(body, /lockout-countdown/);
});

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-auth-"));

// Aucun test ne doit appeler une API externe : lent, dependant du reseau, et
// impoli envers un service public gratuit. Le geocodage automatique declenche
// par les imports est donc coupe ici. geocodage.test.js teste le geocodage
// lui-meme, contre un faux serveur local.
process.env.SEREO_GEOCODAGE_AUTO = "0";
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

const {
  app,
  closeStorage,
  _resetAuthRateLimitForTest,
  _createAccessSessionValueForTest
} = require("../server");

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

// =============================================================================
// Rate limit Basic auth (anti brute-force via en-tete Authorization)
// Regression du P0 : avant, le lockout ne couvrait QUE POST /login ; l'en-tete
// Basic sur n'importe quelle route protegee permettait un brute-force illimite.
// =============================================================================

test("rate limit Basic : 5 tentatives ratees verrouillent l'IP (429 + Retry-After)", async () => {
  _resetAuthRateLimitForTest();

  for (let i = 0; i < 4; i += 1) {
    const r = await fetch(`${baseUrl}/api/storage/status`, {
      headers: { Authorization: basicAuth("admin-test", "mauvais") }
    });
    assert.equal(r.status, 401, `tentative ${i + 1} doit rester 401`);
  }

  // 5e echec : l'IP doit passer verrouillee -> 429 (et non 401 a l'infini)
  const fifth = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Authorization: basicAuth("admin-test", "mauvais") }
  });
  assert.equal(fifth.status, 429);
  assert.match(fifth.headers.get("retry-after") || "", /^\d+$/);

  // Pendant le lockout, meme les BONS credentials Basic sont refuses
  // (on bloque avant de comparer, comme sur POST /login).
  const validButLocked = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Authorization: basicAuth("admin-test", "mot-de-passe-test-long") }
  });
  assert.equal(validButLocked.status, 429);
});

test("rate limit Basic : une session cookie valide reste acceptee meme IP verrouillee", async () => {
  _resetAuthRateLimitForTest();

  const login = await postLogin("admin-test", "mot-de-passe-test-long");
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie || "", /sereo_access=/);

  // Verrouiller l'IP via 5 echecs Basic
  for (let i = 0; i < 5; i += 1) {
    await fetch(`${baseUrl}/api/storage/status`, {
      headers: { Authorization: basicAuth("admin-test", "mauvais") }
    });
  }

  // La session valide ne doit PAS etre bloquee par le lockout d'IP
  const withSession = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Cookie: cookie }
  });
  assert.equal(withSession.status, 200);
});

test("rate limit Basic : un succes Basic efface le compteur d'echecs", async () => {
  _resetAuthRateLimitForTest();

  for (let i = 0; i < 3; i += 1) {
    await fetch(`${baseUrl}/api/storage/status`, {
      headers: { Authorization: basicAuth("admin-test", "mauvais") }
    });
  }

  const ok = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Authorization: basicAuth("admin-test", "mot-de-passe-test-long") }
  });
  assert.equal(ok.status, 200);

  // 4 nouveaux echecs ne doivent PAS verrouiller (compteur remis a 0 par le succes)
  for (let i = 0; i < 4; i += 1) {
    const r = await fetch(`${baseUrl}/api/storage/status`, {
      headers: { Authorization: basicAuth("admin-test", "mauvais") }
    });
    assert.equal(r.status, 401, `iteration ${i + 1} doit rester 401, pas de lockout premature`);
  }
});

test("nav HTML avec Basic errone rend la page login (pas de dialogue Basic natif)", async () => {
  _resetAuthRateLimitForTest();

  // Un navigateur qui a memorise des creds Basic les rejoue automatiquement.
  // Sur une navigation HTML, on veut la page de login conviviale, PAS le popup
  // Basic natif (regression de degradation gracieuse relevee en revue).
  const res = await fetch(`${baseUrl}/`, {
    headers: { Authorization: basicAuth("admin-test", "mauvais"), Accept: "text/html" },
    redirect: "manual"
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("www-authenticate"), null);
  const html = await res.text();
  assert.match(html, /name="password"/);
});

test("nav HTML avec Basic pendant lockout rend la page login (429 + compte a rebours)", async () => {
  _resetAuthRateLimitForTest();

  for (let i = 0; i < 5; i += 1) {
    await fetch(`${baseUrl}/api/storage/status`, {
      headers: { Authorization: basicAuth("admin-test", "mauvais") }
    });
  }

  // IP verrouillee + navigation HTML avec Basic perime -> page login avec
  // countdown (429), pas de 429 brut ni de dialogue Basic natif.
  const res = await fetch(`${baseUrl}/`, {
    headers: { Authorization: basicAuth("admin-test", "mauvais"), Accept: "text/html" },
    redirect: "manual"
  });
  assert.equal(res.status, 429);
  assert.match(res.headers.get("retry-after") || "", /^\d+$/);
  assert.equal(res.headers.get("www-authenticate"), null);
  const html = await res.text();
  assert.match(html, /id="lockout-countdown"/);
});

// =============================================================================
// Robustesse cookie + session (regression P2 + test de garde manquant)
// =============================================================================

test("cookie malforme ne provoque pas de 500 avant auth", async () => {
  _resetAuthRateLimitForTest();

  // "%E0%A4%A" : percent-encoding incomplet -> decodeURIComponent throw.
  // parseCookies s'execute avant l'auth : sans garde, ce serait un 500 pre-auth.
  const res = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Cookie: "sereo_access=%E0%A4%A" }
  });
  assert.equal(res.status, 401);
});

test("session : cookie a signature invalide ou expire est rejete", async () => {
  _resetAuthRateLimitForTest();

  // Signature bidon sur un payload structurellement plausible
  const forged = `${Buffer.from(JSON.stringify({ user: "admin-test", issuedAt: Date.now() })).toString("base64url")}.signature-bidon`;
  const badSig = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Cookie: `sereo_access=${forged}` }
  });
  assert.equal(badSig.status, 401);

  // Cookie correctement signe mais emis il y a plus de 12h -> expire
  const expired = _createAccessSessionValueForTest(Date.now() - 13 * 60 * 60 * 1000);
  const expiredRes = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Cookie: `sereo_access=${expired}` }
  });
  assert.equal(expiredRes.status, 401);

  // Sanity : un cookie frais correctement signe passe
  const fresh = _createAccessSessionValueForTest(Date.now());
  const freshRes = await fetch(`${baseUrl}/api/storage/status`, {
    headers: { Cookie: `sereo_access=${fresh}` }
  });
  assert.equal(freshRes.status, 200);
});

// =============================================================================
// Open redirect post-login (regression P2)
// =============================================================================

test("open redirect : next avec backslash est ramene a /", async () => {
  _resetAuthRateLimitForTest();

  const login = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: "admin-test",
      password: "mot-de-passe-test-long",
      next: "/\\evil.com"
    }),
    redirect: "manual"
  });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/");
});

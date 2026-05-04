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

const { app, closeStorage } = require("../server");

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
    headers: {
      Authorization: basicAuth("admin-test", "mauvais")
    }
  });
  assert.equal(wrongPassword.status, 401);

  const authenticated = await fetch(`${baseUrl}/api/storage/status`, {
    headers: {
      Authorization: basicAuth("admin-test", "mot-de-passe-test-long")
    }
  });
  const body = await authenticated.json();

  assert.equal(authenticated.status, 200);
  assert.equal(body.accessProtected, true);
});

test("access protection shows a usable login form and accepts a session cookie", async () => {
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

  const wrongLogin = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      username: "admin-test",
      password: "mauvais"
    }),
    redirect: "manual"
  });
  assert.equal(wrongLogin.status, 303);
  assert.match(wrongLogin.headers.get("location") || "", /^\/login\?error=1/);

  const validLogin = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      username: "admin-test",
      password: "mot-de-passe-test-long"
    }),
    redirect: "manual"
  });
  assert.equal(validLogin.status, 303);
  assert.equal(validLogin.headers.get("location"), "/");

  const cookie = validLogin.headers.get("set-cookie");
  assert.match(cookie || "", /sereo_access=/);

  const authenticated = await fetch(`${baseUrl}/api/storage/status`, {
    headers: {
      Cookie: cookie
    }
  });
  const body = await authenticated.json();

  assert.equal(authenticated.status, 200);
  assert.equal(body.accessProtected, true);
});

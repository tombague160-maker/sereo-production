// Robustesse (25/09, chasse aux defauts, exploitation) : /api/version et
// l'API GitHub.
//
// 1. SEREO_SKIP_RELEASE_FETCH=1 etait posee par playwright.config.js, les
//    serveurs semes et sept fichiers de bancs, mais le serveur ne la lisait
//    nulle part : chaque serveur de banc appelait api.github.com (60 appels
//    par heure et par adresse sans compte ; mesure le 24/09 : 403, quota a 0).
// 2. Sans delai maximal, un GitHub qui ne repond pas laissait /api/version
//    pendant, et le pied de page « v1.x » avec lui.
//
// Un espion remplace fetch : il laisse passer les appels du banc vers son
// propre serveur et note tout le reste. Le second cas (variable absente) voit
// l'appel sortant : c'est le temoin qui donne son sens au zero du premier.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-version-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";

const fetchLocal = globalThis.fetch;
const sortants = [];
globalThis.fetch = (url, init = {}) => {
  const texte = String(url?.url || url);
  if (texte.startsWith("http://127.0.0.1:")) return fetchLocal(url, init);
  sortants.push(texte);
  // Un GitHub qui ne repond jamais : seule l'annulation (signal) libere l'appel.
  return new Promise((_, rejeter) => {
    const signal = init.signal;
    if (!signal) return;
    if (signal.aborted) return rejeter(signal.reason);
    signal.addEventListener("abort", () => rejeter(signal.reason), { once: true });
  });
};

const { app, closeStorage, _flushPendingBackup } = require("../server");

let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  globalThis.fetch = fetchLocal;
  await _flushPendingBackup();
  await new Promise(r => server.close(r));
  closeStorage();
  fs.rmSync(root, { recursive: true, force: true });
});

// Une reponse qui n'arrive pas en 8 s est rendue comme telle, pour que le
// rouge nomme sa cause au lieu d'un TimeoutError du banc.
async function version() {
  const t0 = Date.now();
  try {
    const res = await fetchLocal(`${base}/api/version`, { headers: { connection: "close" }, signal: AbortSignal.timeout(8000) });
    return { status: res.status, body: await res.json(), ms: Date.now() - t0 };
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
    return { status: "toujours pendante apres 8 s", body: {}, ms: Date.now() - t0 };
  }
}

test("SEREO_SKIP_RELEASE_FETCH=1 : /api/version repond sans aucun appel sortant", async () => {
  const r = await version();
  assert.deepEqual(sortants, [], "appel sortant malgre SEREO_SKIP_RELEASE_FETCH=1");
  assert.equal(r.status, 200);
  assert.equal(r.body.version, require("../package.json").version);
  assert.match(r.body.releaseUrl, /github\.com\/.*\/releases\/tag\/v/);
  assert.equal(r.body.available, false);
});

test("sans la variable, un GitHub muet ne bloque pas /api/version plus de 3 s (temoin : l'appel sortant est vu)", { timeout: 15000 }, async () => {
  delete process.env.SEREO_SKIP_RELEASE_FETCH;
  sortants.length = 0;
  try {
    const r = await version();
    assert.equal(r.status, 200, `/api/version : ${r.status}`);
    assert.equal(sortants.length, 1, `appels sortants : ${JSON.stringify(sortants)}`);
    assert.match(sortants[0], /^https:\/\/api\.github\.com\/repos\/.+\/releases\/tags\/v/);
    assert.equal(r.body.available, false);
    assert.ok(r.ms >= 2500 && r.ms < 6000, `reponse en ${r.ms} ms`);
  } finally {
    process.env.SEREO_SKIP_RELEASE_FETCH = "1";
  }
});

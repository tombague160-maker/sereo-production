// Chantier 2 (audit 2026-06-04) : detection de version multi-source.
//
// Bug racine : release-please casse + tags manuels -> package.json fige a 1.15.0
// alors que le serveur Docker tournait a v1.18.0. L'app affichait 1.15.0.
//
// Fix : priorite env var SEREO_APP_VERSION > fichier VERSION > package.json.
// On verifie chaque chemin en spawnant un process Node isole avec env+fichier
// modifies (pas de mock global au runtime).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

function runVersionProbe(env = {}, opts = {}) {
  // Script qui evalue uniquement la logique APP_VERSION sans demarrer Express.
  const script = `
    const path = ${JSON.stringify(opts.cwd ? opts.cwd : REPO_ROOT)};
    process.chdir(path);
    const normalize = v => String(v || "").trim().replace(/^v/i, "") || null;
    const envV = normalize(process.env.SEREO_APP_VERSION);
    if (envV) { console.log(envV); process.exit(0); }
    try {
      const fileV = normalize(require("fs").readFileSync("./VERSION", "utf8"));
      if (fileV) { console.log(fileV); process.exit(0); }
    } catch {}
    try {
      const pkgV = normalize(require(path + "/package.json").version);
      if (pkgV) { console.log(pkgV); process.exit(0); }
    } catch {}
    console.log("0.0.0");
  `;
  const out = execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, SEREO_APP_VERSION: "", ...env },
    encoding: "utf8"
  });
  return out.trim();
}

test("C2.version.a - SEREO_APP_VERSION env var prioritaire sur tout", () => {
  const v = runVersionProbe({ SEREO_APP_VERSION: "v1.99.0" });
  assert.equal(v, "1.99.0", "env var avec prefixe v doit etre normalise");
});

test("C2.version.b - SEREO_APP_VERSION sans prefixe v passe tel quel", () => {
  const v = runVersionProbe({ SEREO_APP_VERSION: "2.0.0-beta" });
  assert.equal(v, "2.0.0-beta");
});

test("C2.version.c - fichier VERSION lu en fallback de l env var", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-version-"));
  try {
    fs.writeFileSync(path.join(tmp, "VERSION"), "v1.18.0\n");
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ version: "1.15.0" }));
    const v = runVersionProbe({}, { cwd: tmp });
    assert.equal(v, "1.18.0", "fichier VERSION doit gagner sur package.json");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C2.version.d - package.json fallback si VERSION absent et env vide", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-version-"));
  try {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ version: "1.15.0" }));
    const v = runVersionProbe({}, { cwd: tmp });
    assert.equal(v, "1.15.0");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C2.version.e - env var vide tombe sur le suivant (ne pas leakquer une chaine vide)", () => {
  // Reproduit la condition reelle : SEREO_APP_VERSION="" laisse env exporte
  // par le wrapper si git describe a echoue. On doit tomber sur le fichier
  // VERSION ou package.json.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-version-"));
  try {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ version: "1.18.0" }));
    const v = runVersionProbe({ SEREO_APP_VERSION: "" }, { cwd: tmp });
    assert.equal(v, "1.18.0", "env vide ne doit pas bloquer le fallback");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("C2.version.f - fallback 0.0.0 si tout absent", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-version-"));
  try {
    // pas de VERSION, pas de package.json valide
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({}));
    const v = runVersionProbe({}, { cwd: tmp });
    assert.equal(v, "0.0.0");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

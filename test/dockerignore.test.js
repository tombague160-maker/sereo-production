// Le contexte Docker n'embarque rien du dossier de donnees.
//
// LE DEFAUT (relecture adverse du lot 1, 23/09) : .dockerignore listait des
// fichiers PRECIS de data/ (db.json, *.sqlite*, backups/...). Le lot 1 y a
// ajoute data/session-secret -- le secret de session cree par un serveur lance
// sans SEREO_AUTH_SESSION_SECRET -- et rien ne l'excluait : un `docker build`
// fait depuis un poste ou le serveur (ou les bancs e2e) avait tourne le
// copiait dans l'image par `COPY . .`. En mode comptes, ce fichier suffit a
// signer des sessions.
//
// Le banc lit le VRAI .dockerignore et l'applique comme Docker : motifs
// relatifs a la racine, `*` sans `/`, `**` a toute profondeur, un dossier
// exclu exclut son contenu, `!` re-inclut, le dernier motif qui s'applique
// l'emporte.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MOTIFS = fs.readFileSync(path.join(__dirname, "..", ".dockerignore"), "utf8")
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(l => l && !l.startsWith("#"))
  .map(l => {
    const negatif = l.startsWith("!");
    const brut = (negatif ? l.slice(1) : l).replace(/^\/+/, "").replace(/\/+$/, "");
    const source = brut.split("**").map(morceau => morceau
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")).join(".*");
    return { negatif, re: new RegExp(`^${source}$`) };
  });

/** Le chemin (ou l'un de ses dossiers parents) est-il exclu du contexte ? */
function exclu(chemin) {
  const morceaux = chemin.split("/");
  let resultat = false;
  for (const { negatif, re } of MOTIFS) {
    for (let i = 1; i <= morceaux.length; i++) {
      if (re.test(morceaux.slice(0, i).join("/"))) { resultat = !negatif; break; }
    }
  }
  return resultat;
}

test("dockerignore — le secret de session n'entre pas dans l'image", () => {
  assert.equal(exclu("data/session-secret"), true, "data/session-secret serait copie dans l'image par COPY . .");
});

test("dockerignore — TOUT fichier de data/ est exclu, y compris un fichier qu'on n'a pas encore nomme", () => {
  for (const f of ["data/sereo.sqlite", "data/sereo.sqlite-wal", "data/db.json", "data/backups/x.sqlite",
    "data/un-fichier-de-demain.bin", "data/sereo-e2e-lot1.sqlite"]) {
    assert.equal(exclu(f), true, `${f} entrerait dans l'image`);
  }
});

test("dockerignore — temoin : le code de l'application, lui, est copie", () => {
  for (const f of ["server.js", "public/js/app.js", "storage/sqliteStore.js", "package.json", "lib/operations-api.js"]) {
    assert.equal(exclu(f), false, `${f} manquerait a l'image`);
  }
  // Et le lecteur de motifs sait exclure : un secret local le reste.
  assert.equal(exclu(".env"), true);
  assert.equal(exclu("node_modules/express/index.js"), true);
});

// Le design et la documentation n'entrent pas dans l'image (25/09, chasse aux
// defauts : 7,8 Mo de design/ envoyes en production). Temoin : ce que le
// serveur lit du depot a l'execution reste (server.js, lib/, storage/,
// public/, package.json, VERSION ; scripts/ pour `npm run migrate:sqlite`).
test("dockerignore — le design et la documentation ne partent pas en production", () => {
  for (const f of ["design/DESIGN.md", "design/export-v8/planche.html", "docs/internal/AUDIT_2026_05_20.md",
    "CHANGELOG.md", "CLAUDE.md", "CONTRIBUTING.md", "DEPLOYMENT.md", "README.md", "playwright.config.js",
    ".release-please-manifest.json", ".claude/worktrees/ch-x/server.js",
    "test-results/banc-chromium/trace.zip", "playwright-report/index.html", "pw-lot.config.js"]) {
    assert.equal(exclu(f), true, `${f} entrerait dans l'image`);
  }
  for (const f of ["server.js", "lib/jour-paris.js", "storage/sqliteStore.js", "public/index.html", "public/css/style.css",
    "public/brand/sereo-logo.svg", "package.json", "package-lock.json", "VERSION", "scripts/migrate-json-to-sqlite.js"]) {
    assert.equal(exclu(f), false, `${f} manquerait a l'image`);
  }
});

// Le nom du shell doit changer des qu'un fichier statique change, sans que
// personne ne bumpe CACHE_NAME (lot « chargement instantane », 23/09).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { empreinteDesSources, shellEmpreinte } = require("../lib/empreinte-shell");

function dossierTemporaire() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-empreinte-"));
  fs.mkdirSync(path.join(d, "js"));
  fs.writeFileSync(path.join(d, "index.html"), "<p id=a></p>");
  fs.writeFileSync(path.join(d, "js", "app.js"), "export const a = 1;");
  return d;
}

test("empreinte : un octet change dans un fichier imbrique change le nom", () => {
  const d = dossierTemporaire();
  try {
    const sources = [{ nom: "public", racine: d }];
    const avant = empreinteDesSources(sources);
    assert.equal(empreinteDesSources(sources), avant, "l'empreinte n'est pas stable");
    fs.writeFileSync(path.join(d, "js", "app.js"), "export const a = 2;");
    assert.notEqual(empreinteDesSources(sources), avant, "un contenu modifie garde la meme empreinte");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("empreinte : ajouter ou renommer un fichier change le nom", () => {
  const d = dossierTemporaire();
  try {
    const sources = [{ nom: "public", racine: d }];
    const avant = empreinteDesSources(sources);
    fs.writeFileSync(path.join(d, "js", "tabs.js"), "");
    const ajoute = empreinteDesSources(sources);
    assert.notEqual(ajoute, avant, "un fichier ajoute (vide) ne change pas l'empreinte");
    fs.renameSync(path.join(d, "js", "tabs.js"), path.join(d, "js", "onglets.js"));
    assert.notEqual(empreinteDesSources(sources), ajoute, "un fichier renomme ne change pas l'empreinte");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("empreinte : un dossier absent ne fait pas echouer le demarrage", () => {
  const e = empreinteDesSources([{ nom: "x", racine: path.join(os.tmpdir(), "sereo-absent-" + process.pid) }]);
  assert.match(e, /^[0-9a-f]{12}$/);
});

test("shellEmpreinte : le nom servi remplace CACHE_NAME, et seulement lui", () => {
  const source = 'const CACHE_NAME = "sereo-shell-x";\nconst API_CACHE_NAME = "sereo-api-y";\n';
  const r = shellEmpreinte(source, "abc123abc123");
  assert.equal(r.nom, "sereo-shell-x-abc123abc123");
  assert.equal(r.source, 'const CACHE_NAME = "sereo-shell-x-abc123abc123";\nconst API_CACHE_NAME = "sereo-api-y";\n');
  assert.equal(shellEmpreinte("pas de nom", "abc"), null);
});

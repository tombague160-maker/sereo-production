// Les finitions d'interface de l'audit du 23/09 qui se jugent dans les
// fichiers, sans navigateur. Le reste est dans test/e2e/interface-finitions.spec.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const racine = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(racine, "public", "css", "style.css"), "utf8");

test("8 — --warning : chaque déclaration vaut le jeton de la charte", () => {
  // Il avait CINQ valeurs (#f1a447, #ed9d72 x2, var(--v8-accent), #f18c79),
  // une par portee : le clair, le sombre automatique, le sombre force, et
  // deux surcharges du clair. Une seule qui derive, et la famille recommence.
  const valeurs = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--warning\s*:\s*([^;]+);/g)].map(m => m[1].trim());
  assert.ok(valeurs.length >= 5, `seulement ${valeurs.length} declaration(s) trouvee(s) : l'instrument ne voit plus les portees`);
  assert.deepEqual([...new Set(valeurs)], ["var(--v8-avertissement)"]);
});

test("DESIGN.md ne dit plus que le thème démarre en clair", () => {
  // anti-fart.js suit le systeme sans preference enregistree ; la ligne
  // « Le theme par defaut » disait encore « le code force `light` au depart ».
  const antiFart = fs.readFileSync(path.join(racine, "public", "js", "anti-fart.js"), "utf8");
  assert.match(antiFart, /systemeEnSombre\(\) \? "dark" : "light"/, "prealable : le code suit bien le systeme");
  const design = fs.readFileSync(path.join(racine, "design", "DESIGN.md"), "utf8");
  const ligne = design.split("\n").find(l => /Le thème par défaut/.test(l));
  assert.ok(ligne, "la ligne du theme par defaut a disparu");
  assert.doesNotMatch(ligne, /le code force `light` au départ/);
  assert.match(ligne, /Système/);
});

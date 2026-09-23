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

test("DESIGN.md porte la section du lot, celle que citent la feuille et le banc", () => {
  // Le bloc CSS du lot et l'en-tete de interface-finitions.spec.js renvoient
  // tous deux a « Finitions d interface (audit du 23/09) » dans DESIGN.md :
  // une reference qui ne mene nulle part est une explication perdue.
  // On exige qu'elle EXISTE, une seule fois -- pas qu'elle soit la derniere :
  // la fin du fichier est une place provisoire, que le prochain lot fusionne
  // prend (relecture du 23/09 : le banc rougissait sans aucune regression).
  const titre = "Finitions d interface (audit du 23/09)";
  const spec = fs.readFileSync(path.join(racine, "test", "e2e", "interface-finitions.spec.js"), "utf8");
  assert.match(css, /FINITIONS D'INTERFACE -- audit du 23\/09 \(DESIGN\.md, « Finitions d\s+interface \(audit du 23\/09\) »\)/, "prealable : la feuille cite la section");
  assert.match(spec, /DESIGN\.md, « Finitions d interface »/, "prealable : le banc cite la section");
  const design = fs.readFileSync(path.join(racine, "design", "DESIGN.md"), "utf8");
  const sections = design.split("\n").filter(l => /^## /.test(l));
  assert.ok(sections.length > 5, "l'instrument ne voit plus les sections");
  assert.equal(sections.filter(s => s === `## ${titre}`).length, 1, "la section du lot doit exister, une seule fois");
});

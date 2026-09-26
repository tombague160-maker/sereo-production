// La CI tourne aussi sur la PR de version (26/09).
//
// LE CONSTAT. release-please ouvre et met a jour sa PR avec le jeton par
// defaut ; GitHub ne lance alors pas les workflows `pull_request` (regle contre
// les boucles) : 0 execution de CI sur les PR de version #179 a #187. Des que
// la protection de main exige les verdicts « Tests + syntax check » et
// « Tests e2e (Playwright) », une telle PR attendrait pour toujours -- plus
// aucune version, donc plus aucun deploiement.
//
// LE BRANCHEMENT : release-please.yml lance ci.yml par `workflow_dispatch`
// (permis a ce jeton) sur la branche de sa PR ; les verdicts s'attachent a sa
// tete. CE BANC TIENT, dans les VRAIS fichiers (lus comme texte, commentaires
// retires) : ci.yml accepte `workflow_dispatch` ; release-please.yml a le droit
// `actions: write` et lance ci.yml, sur la branche de la PR, quand une PR a
// bouge ; les deux verdicts exiges existent sous leur nom.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CR = String.fromCharCode(13);
const lire = nom => fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", nom), "utf8")
  .split(CR).join("").split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
const ci = lire("ci.yml");
const rp = lire("release-please.yml");

/** Le bloc de premier niveau `cle:` (jusqu'a la cle suivante de colonne 0). */
const bloc = (texte, cle) => (new RegExp(`^${cle}:\\n((?:[ \\t].*\\n|\\n)*)`, "m").exec(texte + "\n") || [])[1] || "";

test("ci.yml se lance a la demande (workflow_dispatch)", () => {
  assert.match(bloc(ci, "on"), /^ {2}workflow_dispatch:/m, "ci.yml n'accepte pas workflow_dispatch : la PR de version n'aurait aucun verdict");
});

test("release-please.yml lance ci.yml sur la branche de sa PR, quand une PR a bouge", () => {
  assert.match(bloc(rp, "permissions"), /^ {2}actions:\s*write\s*$/m, "sans actions: write, le lancement est refuse");
  assert.match(rp, /uses:\s*googleapis\/release-please-action@/, "l'action release-please a disparu");
  assert.match(rp, /^ {8}id:\s*release\s*$/m, "l'etape release-please n'a plus l'id « release » que lit le lancement");
  const etapes = rp.split(/\n(?= {6}- )/);
  const lancement = etapes.find(e => /gh workflow run ci\.yml\b/.test(e));
  assert.ok(lancement, "aucune etape ne lance ci.yml");
  assert.match(lancement, /if:\s*\$\{\{\s*steps\.release\.outputs\.prs_created\s*==\s*'true'\s*\}\}/, "le lancement ne suit pas « une PR a ete creee ou mise a jour »");
  assert.match(lancement, /PR_JSON:\s*\$\{\{\s*steps\.release\.outputs\.pr\s*\}\}/, "la PR de version n'arrive pas, brute, au script");
  assert.match(lancement, /jq -r '\.headBranchName \/\/ empty'/, "le lancement ne vise pas la branche de la PR de version");
  assert.match(lancement, /if \[ -z "\$BRANCHE" \]; then[\s\S]*?exit 1/, "sans branche, le lancement ne dit pas rouge");
  assert.match(lancement, /--ref\s+"\$BRANCHE"/, "le lancement ne passe pas la branche a --ref");
  assert.match(lancement, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/, "gh n'a pas de jeton");
});

test("le bloc env du lancement n'appelle aucune fonction sur la sortie de release-please", () => {
  // `env` est evalue AVANT `if` : `fromJSON('')` y fait echouer l'etape a
  // chaque poussee sans PR de version (run 36249462589, 26/09), alors qu'elle
  // devait etre sautee. La sortie y passe brute ; le script la lit.
  const lancement = rp.split(/\n(?= {6}- )/).find(e => /gh workflow run ci\.yml\b/.test(e)) || "";
  const env = (/^ {8}env:\n((?: {10}.*\n)*)/m.exec(lancement + "\n") || [])[1] || "";
  assert.ok(env, "le lancement n'a pas de bloc env");
  assert.doesNotMatch(env, /\$\{\{[^}]*\w+\(/, `env evalue avant le if appelle une fonction : ${env.trim()}`);
});

test("les deux verdicts exiges par la protection de main existent sous leur nom", () => {
  const noms = [...ci.matchAll(/^ {4}name:\s*(.+)$/gm)].map(m => m[1].trim());
  for (const n of ["Tests + syntax check", "Tests e2e (Playwright)"]) assert.ok(noms.includes(n), `aucun job ne s'appelle « ${n} » : la protection attendrait pour toujours`);
});

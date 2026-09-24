// La CI en quatre lots (25/09) : meme suite, meme verdict, sous le meme nom.
//
// LE CONSTAT (chasse aux defauts du 24/09, section 2). Les e2e (723 tests, un
// seul ouvrier) prenaient 37 min sur une seule machine, et chaque PR poussee
// de nouveau laissait courir jusqu'au bout l'execution devenue inutile (31 en
// 7 jours). Le correctif coupe la suite en quatre lots (`--shard`), chacun sur
// sa machine, et annule l'execution perimee d'une PR.
//
// CE QUE CE BANC TIENT, dans le VRAI .github/workflows/ci.yml (lu comme texte :
// aucune dependance YAML) :
//   - les lots couvrent la suite ENTIERE : matrice 1..N et `--shard=<lot>/N` ;
//     aucun autre job ne lance la suite ;
//   - le verdict garde son nom, « Tests e2e (Playwright) » (une protection de
//     branche qui l'exige exige les N lots), rouge si un lot l'est, et il
//     tourne meme quand un lot echoue (sinon il serait « saute », pas rouge) ;
//   - une PR annule son execution perimee ; main jamais.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CR = String.fromCharCode(13);
const texte = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8").split(CR).join("");
const sansCommentaires = texte.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");

/** Les jobs : { cle: bloc de texte } (cles a deux espaces sous `jobs:`). */
function jobs() {
  const apres = sansCommentaires.slice(sansCommentaires.indexOf("\njobs:\n") + 7);
  const blocs = {};
  let cle = null;
  for (const ligne of apres.split("\n")) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(ligne);
    if (m) { cle = m[1]; blocs[cle] = ""; continue; }
    if (cle) blocs[cle] += `${ligne}\n`;
  }
  return blocs;
}
const nomDe = bloc => (/^ {4}name:\s*(.+)$/m.exec(bloc) || [])[1]?.trim();

test("ci — les lots e2e couvrent la suite entiere, chacun une fois", () => {
  const tous = jobs();
  const lanceurs = Object.entries(tous).filter(([, bloc]) => /npm run test:e2e|playwright test/.test(bloc));
  assert.equal(lanceurs.length, 1, `jobs qui lancent la suite e2e : ${lanceurs.map(([cle]) => cle).join(", ") || "aucun"}`);
  const [cle, bloc] = lanceurs[0];
  const matrice = /^ {8}lot:\s*\[([^\]]*)\]/m.exec(bloc);
  assert.ok(matrice, `${cle} : pas de matrice de lots (la suite tourne en un seul job)`);
  const lots = matrice[1].split(",").map(s => Number(s.trim()));
  const commande = /--shard=\$\{\{\s*matrix\.lot\s*\}\}\/(\d+)/.exec(bloc);
  assert.ok(commande, `${cle} : la suite n'est pas coupee par --shard=\${{ matrix.lot }}/N`);
  const n = Number(commande[1]);
  // 1..N, sans trou ni doublon : chaque test tourne dans exactement un lot.
  assert.deepEqual(lots, Array.from({ length: n }, (_, i) => i + 1), `lots ${lots} pour --shard=…/${n}`);
  assert.ok(n >= 2, "un seul lot : rien n'est reparti");
  assert.match(bloc, /fail-fast:\s*false/, "un lot rouge arreterait les autres");
});

test("ci — le verdict « Tests e2e (Playwright) » exige tous les lots, et dit rouge", () => {
  const tous = jobs();
  const verdicts = Object.entries(tous).filter(([, bloc]) => nomDe(bloc) === "Tests e2e (Playwright)");
  assert.equal(verdicts.length, 1, "aucun job, ou plusieurs, ne porte le nom « Tests e2e (Playwright) »");
  const [, bloc] = verdicts[0];
  const lanceur = Object.entries(tous).find(([, b]) => /npm run test:e2e|playwright test/.test(b));
  assert.ok(lanceur, "aucun job ne lance la suite");
  const [cleLots] = lanceur;
  assert.match(bloc, new RegExp(`^ {4}needs:\\s*\\[?\\s*${cleLots}\\b`, "m"), `le verdict n'attend pas ${cleLots}`);
  // Tourne quand un lot echoue (sinon « saute », qu'une protection prend pour
  // un succes), pas quand l'execution est annulee.
  assert.match(bloc, /^ {4}if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}/m, "le verdict ne tourne pas quand un lot echoue");
  assert.match(bloc, new RegExp(`needs\\.${cleLots}\\.result\\s*\\}\\}"?\\s*=\\s*"success"`), "le verdict ne teste pas que les lots sont verts");
});

test("ci — une PR poussee de nouveau annule son execution perimee ; main jamais", () => {
  const concurrence = /^concurrency:\n((?: {2}.+\n)+)/m.exec(sansCommentaires);
  assert.ok(concurrence, "pas de bloc concurrency : les executions perimees vont jusqu'au bout");
  const bloc = concurrence[1];
  assert.match(bloc, /cancel-in-progress:\s*true/);
  const groupe = (/group:\s*(.+)/.exec(bloc) || [])[1] || "";
  // Le groupe d'une PR est son numero ; hors PR, un groupe PAR EXECUTION
  // (run_id) : un groupe partage ferait attendre, puis annuler, main.
  assert.match(groupe, /pull_request\.number/, `groupe ${groupe} : pas par PR`);
  assert.match(groupe, /github\.run_id/, `groupe ${groupe} : main partagerait un groupe (file, puis annulation)`);
  assert.doesNotMatch(groupe, /github\.ref\b/, `groupe ${groupe} : par branche, main se mettrait en file`);
});

// Dockerfile : aucune couche ne recopie le code ni les dependances (25/09).
//
// LE CONSTAT (chasse aux defauts du 24/09, docker history de l'image) :
// « 24.8MB RUN mkdir -p … && chown -R node:node /app », 24 s a chaque
// construction. Place APRES `COPY . .` et `npm ci`, le chown -R reecrivait
// dans une couche neuve chaque fichier de node_modules et du code : l'image
// les portait deux fois.
//
// CE QUE CE BANC TIENT, dans le VRAI Dockerfile : apres la premiere copie de
// fichiers du depot (package.json) ou l'installation des dependances, aucun
// chown ni chmod recursif ; les copies du depot et l'installation se font en
// tant que node (COPY --chown=node:node, USER node avant npm ci) -- les memes
// proprietaires qu'avant, sans la couche de trop.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TEXTE = fs.readFileSync(path.join(__dirname, "..", "Dockerfile"), "utf8");
// Instructions de l'etape finale, continuations jointes, commentaires retires.
const TOUTES = TEXTE.replace(/\\\r?\n/g, " ")
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(l => l && !l.startsWith("#"));
const FINALE = TOUTES.slice(TOUTES.map(l => /^FROM /i.test(l)).lastIndexOf(true));

const indexDe = re => FINALE.findIndex(l => re.test(l));

test("Dockerfile — aucune couche recursive sur /app apres la copie des dependances et du code", () => {
  const premiereCopie = indexDe(/^COPY (?!--from=)/i);
  assert.ok(premiereCopie > 0, "aucune copie du depot dans l'etape finale");
  const recursives = FINALE.slice(premiereCopie).filter(l => /^RUN /i.test(l) && /\b(chown|chmod)\s+(-[a-zA-Z]*R|--recursive)/.test(l));
  assert.deepEqual(recursives, [], "un chown/chmod recursif APRES la copie reecrit node_modules et le code dans une couche de plus");
});

test("Dockerfile — le code et les dependances appartiennent a node, comme avant", () => {
  const copies = FINALE.filter(l => /^COPY (?!--from=)/i.test(l));
  assert.ok(copies.length >= 2, `copies du depot : ${copies.join(" | ")}`);
  for (const c of copies) assert.match(c, /^COPY --chown=node:node /, `copie sans proprietaire node : ${c}`);
  const user = indexDe(/^USER node$/);
  const npmCi = indexDe(/^RUN npm ci\b/);
  assert.ok(npmCi > 0, "npm ci absent");
  assert.ok(user >= 0 && user < npmCi, "npm ci tourne en root : node_modules ne serait plus a node");
  // Temoin : les dossiers de donnees existent et sont a node (le volume y est monte).
  const dossiers = FINALE.find(l => /^RUN mkdir -p \/app\/data/.test(l)) || "";
  assert.match(dossiers, /chown -R node:node \/app\b/, "les dossiers de runtime ne sont pas a node");
  assert.ok(FINALE.indexOf(dossiers) < indexDe(/^COPY (?!--from=)/i), "le chown des dossiers vient apres la copie : il recopierait tout");
});

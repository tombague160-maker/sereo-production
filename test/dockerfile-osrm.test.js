// Dockerfile : OSRM integre a l'image Sereo (23/09).
//
// Le serveur de Thomas reconstruit l'image a chaque release avec le builder
// Docker LEGACY (service sereo-updater) : pas de « # syntax= », pas de
// « --mount » ; le multi-etapes (FROM ... AS, COPY --from=) est permis. Ce
// banc lit le VRAI Dockerfile ; la construction reelle est rapportee dans
// DESIGN.md (docker build avec DOCKER_BUILDKIT=0).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TEXTE = fs.readFileSync(path.join(__dirname, "..", "Dockerfile"), "utf8");
// Instructions, continuations de ligne jointes, commentaires retires.
const INSTRUCTIONS = TEXTE.replace(/\\\r?\n/g, " ")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const avec = (mot) => INSTRUCTIONS.filter((l) => l.toUpperCase().startsWith(`${mot} `));

test("Dockerfile : les binaires OSRM viennent d'une image officielle EPINGLEE, sur une base glibc", () => {
  const from = avec("FROM");
  const osrm = from.find((l) => /project-osrm\/osrm-backend|osrm\/osrm-backend/.test(l));
  assert.ok(osrm, `aucune etape OSRM : ${from.join(" | ")}`);
  assert.match(osrm, /:v\d+\.\d+\.\d+[-\w]*\s+AS\s+osrm$/i, `version d'OSRM non epinglee : ${osrm}`);
  assert.doesNotMatch(osrm, /:latest\b/);
  const finale = from.at(-1);
  assert.match(finale, /^FROM node:24-[a-z]+-slim$/, `base finale : ${finale}`);
  assert.doesNotMatch(finale, /alpine/, "base musl : les binaires OSRM (glibc) n'y tournent pas");
  const copies = avec("COPY").filter((l) => l.includes("--from=osrm")).join(" ");
  for (const b of ["osrm-extract", "osrm-partition", "osrm-customize", "osrm-routed"])
    assert.ok(copies.includes(`/usr/local/bin/${b}`), `${b} n'est pas copie`);
  assert.match(copies, /car\.lua \/opt\/osrm\/profiles\/car\.lua/, "profil voiture absent (chemin attendu par lib/osrm-local.js)");
  assert.match(copies, /\/opt\/lib \/opt\/osrm\/profiles\/lib/, "car.lua sans son dossier lib/");
  assert.match(avec("RUN").join(" "), /apt-get install -y --no-install-recommends[^&]*\bosmium-tool\b/, "osmium absent : la fusion des regions echouerait");
});

test("Dockerfile : compatible builder legacy, utilisateur node, healthcheck sans wget", () => {
  assert.doesNotMatch(TEXTE, /^#\s*syntax=/m, "directive # syntax= : refusee par le builder legacy");
  assert.doesNotMatch(INSTRUCTIONS.join("\n"), /--mount=/, "--mount : refuse par le builder legacy");
  assert.deepEqual(avec("USER"), ["USER node"]);
  const sante = avec("HEALTHCHECK").join(" ");
  assert.match(sante, /\/healthz/);
  assert.doesNotMatch(sante, /\bwget\b/, "wget n'existe pas sur l'image slim : le healthcheck echouerait toujours");
  assert.match(sante, /CMD \["node", "-e"/);
  assert.match(avec("ENTRYPOINT").join(" "), /tini/);
  assert.match(avec("ENV").join(" "), /NODE_ENV=production/);
  assert.match(avec("ENV").join(" "), /SEREO_SQLITE_PATH=\/app\/data\/sereo\.sqlite/);
});

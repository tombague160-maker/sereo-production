// Robustesse (25/09, chasse aux defauts, exploitation) : toute variable
// d'environnement que le serveur lit est documentee, dans .env.example ET
// dans le tableau de DEPLOYMENT.md.
//
// Mesure du 24/09 : SEREO_APP_VERSION, SEREO_CONTACT_URL,
// SEREO_IMPORTS_ARCHIVES_DIR et SEREO_SEPARATION_ROLES etaient lues sans etre
// documentees (la premiere etait deja signalee par l'audit du 04/06) : un
// reinstallateur les aurait oubliees. Et TZ, que le conteneur ne pose pas,
// n'etait expliquee nulle part.
//
// L'instrument lit le code serveur (server.js, lib/, storage/, scripts/) :
// tout acces `env.NOM` ou `env["NOM"]` (process.env comme l'env injecte des
// gestionnaires). Son temoin : aucun jeton SEREO_* du code n'echappe a ces
// formes d'acces -- une nouvelle forme (destructuration...) le ferait rougir
// au lieu de passer sous silence.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..");
// Lues par Node ou par Express, pas par le code de Sereo : documentees quand
// meme (NODE_ENV=production masque le detail des erreurs d'Express ; TZ fixe
// l'heure des journaux et des noms de sauvegardes).
const LUES_AILLEURS = new Set(["NODE_ENV", "TZ"]);

function fichiersServeur() {
  const fichiers = [path.join(RACINE, "server.js")];
  const parcourir = dossier => {
    for (const f of fs.readdirSync(dossier, { withFileTypes: true })) {
      const p = path.join(dossier, f.name);
      if (f.isDirectory()) parcourir(p);
      else if (/\.[cm]?js$/.test(f.name)) fichiers.push(p);
    }
  };
  for (const d of ["lib", "storage", "scripts"]) parcourir(path.join(RACINE, d));
  return fichiers;
}

function variablesLues() {
  const lues = new Map();
  const jetons = new Map();
  for (const f of fichiersServeur()) {
    const texte = fs.readFileSync(f, "utf8");
    const ou = path.relative(RACINE, f).replace(/\\/g, "/");
    for (const m of texte.matchAll(/\benv\s*(?:\.\s*([A-Z][A-Z0-9_]*)|\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\])/g)) {
      const nom = m[1] || m[2];
      lues.set(nom, [...new Set([...(lues.get(nom) || []), ou])]);
    }
    for (const m of texte.matchAll(/\bSEREO_[A-Z0-9_]*[A-Z0-9]\b/g)) jetons.set(m[0], ou);
  }
  return { lues, jetons };
}

const lire = fichier => fs.readFileSync(path.join(RACINE, fichier), "utf8");
const documenteesDansEnvExample = () =>
  new Set([...lire(".env.example").matchAll(/^[ \t]*#?[ \t]*([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]));
const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Une ligne du tableau de DEPLOYMENT.md : « | `NOM` | ... ».
const dansLeTableau = (texte, nom) => new RegExp(`^\\|\\s*\`${echapper(nom)}\`\\s*\\|`, "m").test(texte);

test("variables : l'instrument voit les lectures, sous toutes leurs formes", () => {
  const { lues, jetons } = variablesLues();
  assert.ok(lues.size >= 30, `seulement ${lues.size} variables trouvees`);
  // process.env.X (server.js) et this.env.X (gestionnaire OSRM).
  for (const nom of ["SEREO_SQLITE_PATH", "SEREO_SEPARATION_ROLES", "SEREO_OSRM_ZONE", "SEREO_TUILES_URL", "PORT"]) {
    assert.ok(lues.has(nom), `${nom} n'est pas vue`);
  }
  const echappees = [...jetons].filter(([nom]) => !lues.has(nom)).map(([nom, ou]) => `${nom} (${ou})`);
  assert.deepEqual(echappees, [], "jetons SEREO_* lus par une forme que l'instrument ne reconnait pas");
});

test("variables : toute variable lue par le serveur est dans .env.example", () => {
  const documentees = documenteesDansEnvExample();
  const manquantes = [...variablesLues().lues].filter(([nom]) => !documentees.has(nom)).map(([nom, ou]) => `${nom} (${ou.join(", ")})`);
  assert.deepEqual(manquantes, []);
  for (const nom of LUES_AILLEURS) assert.ok(documentees.has(nom), `${nom} absente de .env.example`);
});

test("variables : .env.example ne documente rien que personne ne lit", () => {
  const { lues } = variablesLues();
  const mortes = [...documenteesDansEnvExample()].filter(nom => !lues.has(nom) && !LUES_AILLEURS.has(nom));
  assert.deepEqual(mortes, []);
});

test("variables : le tableau de DEPLOYMENT.md les nomme toutes, TZ comprise", () => {
  const texte = lire("DEPLOYMENT.md");
  // Temoin du motif : une ligne de tableau fabriquee est reconnue, une mention en prose non.
  assert.ok(dansLeTableau("| `SEREO_X` | defaut |", "SEREO_X"));
  assert.ok(!dansLeTableau("Poser `SEREO_X` avant.", "SEREO_X"));
  const noms = [...variablesLues().lues.keys(), ...LUES_AILLEURS];
  const absentes = noms.filter(nom => !dansLeTableau(texte, nom));
  assert.deepEqual(absentes, []);
});

// Les etats vides : leur langue, et la sortie qu'ils offrent.
//
// Deux defauts mesures le 18/09, tous deux invisibles a la relecture parce que
// rien ne casse :
//
//   1. Huit chaines d'interface avaient PERDU LEURS ACCENTS -- "Cree une
//      fiche", "Les commandes validees apparaitront ici", "Aucune donnee". Un
//      texte francais sans accents a l'air casse, et personne ne le signale
//      parce que ca marche.
//
//   2. Treize des vingt etats vides NOMMAIENT une action sans l'offrir :
//      "Importe le stock", "Cree une fiche". Le message disait quoi faire et
//      laissait chercher ou. Sept menaient a une destination sans ambiguite ;
//      ils portent desormais un bouton.
//
// La distinction qui compte : un IDENTIFIANT ne s'accentue jamais. Les chemins
// d'API, les cles de statut, les classes CSS et les attributs data restent tels
// quels -- les accentuer casserait le routage et les selecteurs. Ce test verifie
// les deux sens : le texte accentue, les identifiants intacts.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const racine = path.join(__dirname, "..");
const CR = String.fromCharCode(13);
const lire = f => fs.readFileSync(f, "utf8").split(CR).join("");

const app = lire(path.join(racine, "public", "js", "app.js"));
const dom = lire(path.join(racine, "public", "js", "utils", "dom.js"));

/** Le code sans ses commentaires : eux ne sont vus par personne. */
function codeSeul(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Les couples (titre, message) de tous les appels a emptyState. */
function lireEtatsVides() {
  return [...codeSeul(app).matchAll(/emptyState\(\s*"([^"]*)"\s*,\s*"([^"]*)"/g)]
    .map(m => ({ titre: m[1], message: m[2] }));
}

// Mots francais courants dont l'accent a ete perdu. On ne liste QUE des formes
// qui n'existent pas sans accent en francais : "cree" n'est pas un mot, "livree"
// non plus. Un mot ambigu ici produirait un faux positif sur un identifiant.
const SANS_ACCENT = [
  "Cree", "cree", "Creer", "creer",
  "validees", "validee", "apparaitront", "apparait",
  "donnee", "donnees", "livree", "livrees",
  "envoyees", "envoyee", "prete", "pretes",
  "derniere", "Derniere", "reference", "references",
  "deja", "apres"
];

test("etats vides — aucun texte n'a perdu ses accents", () => {
  const fautes = [];
  for (const { titre, message } of lireEtatsVides()) {
    for (const mot of SANS_ACCENT) {
      const motif = new RegExp("\\b" + mot + "\\b");
      if (motif.test(titre)) fautes.push(`titre « ${titre} » : ${mot}`);
      if (motif.test(message)) fautes.push(`message « ${message.slice(0, 50)} » : ${mot}`);
    }
  }
  assert.deepEqual(fautes, [], "accents perdus :\n  " + fautes.join("\n  "));
});

test("etats vides — les IDENTIFIANTS restent sans accent", () => {
  // Le contre-temoin de la regle precedente. Sans lui, "corriger les accents"
  // pourrait un jour toucher un chemin d'API ou une classe CSS, et casser le
  // routage en silence -- une correction cosmetique qui deplace un defaut.
  for (const ident of [
    "commandes-livrees", "commandes-planifiees", "commande-client",
    "send-preparation", "finish-preparation", "start-preparation"
  ]) {
    assert.ok(app.includes(ident), `identifiant introuvable ou accentue : ${ident}`);
  }
});

test("etats vides — emptyState accepte une action, et elle reste facultative", () => {
  assert.ok(/export function emptyState\(title, message, action\)/.test(dom),
    "la signature a change : l'action doit rester le TROISIEME argument, facultatif");
  // Les appels a deux arguments doivent continuer de fonctionner : sept etats
  // vides ne menent nulle part et n'ont rien a offrir.
  const sansAction = lireEtatsVides().length;
  assert.ok(sansAction > 10, `${sansAction} etats vides lus : la lecture a echoue`);
});

test("etats vides — les actions pointent vers un onglet REELLEMENT routable", () => {
  // Le defaut qui a failli passer : les sept boutons pointaient vers #import.
  // La section existe dans le HTML, mais "import" n'est PAS dans mainTabs -- le
  // routeur repliait silencieusement sur l'accueil. L'utilisateur arrivait au
  // bon endroit PAR ACCIDENT, et le jour ou l'accueil cesserait de porter
  // l'import, le bouton aurait menti sans qu'une ligne de code change.
  const tabs = lire(path.join(racine, "public", "js", "config", "tabs.js"));
  const valides = [...tabs.matchAll(/export const mainTabs = new Set\(\[([^\]]*)\]/g)]
    .flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
  assert.ok(valides.length > 10, `mainTabs illisible : ${valides.length} entrees`);

  const destinations = [...codeSeul(app).matchAll(/onglet:\s*"([a-z-]+)"/g)].map(m => m[1]);
  assert.ok(destinations.length >= 5, `${destinations.length} actions trouvees : trop peu`);
  const inconnues = [...new Set(destinations)].filter(d => !valides.includes(d));
  assert.deepEqual(inconnues, [],
    "destinations refusees par le routeur : " + inconnues.join(", "));
});

test("etats vides — un etat qui NOMME une action en offre une", () => {
  // Formulation deliberement etroite : on ne juge que les messages qui nomment
  // un IMPORT, seul cas ou la destination est certaine. "Modifie la recherche"
  // ou "ajuste le secteur" ne menent nulle part, et leur poser un bouton vers
  // un endroit quelconque promettrait une sortie qui n'existe pas.
  const appels = [...codeSeul(app).matchAll(/emptyState\(\s*"([^"]*)"\s*,\s*"([^"]*)"([^)]*)\)/g)];
  const manquantes = appels
    .filter(m => /\bImporte\b/.test(m[2]))
    .filter(m => !/onglet:/.test(m[3]))
    .map(m => `« ${m[1]} » : ${m[2].slice(0, 50)}`);
  assert.deepEqual(manquantes, [],
    "etats vides qui disent d'importer sans offrir le chemin :\n  " + manquantes.join("\n  "));
});

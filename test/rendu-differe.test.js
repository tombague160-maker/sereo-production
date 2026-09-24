// Deux fonctions, deux contrats (relecture adverse du 24/09).
//
// rendreSiAffiche (depuis le 23/09) : affiche, l'ecran se dessine ; cache, RIEN.
// Ses appelants dessinent eux-memes l'ecran en y arrivant : le lot reseau
// (perf/reseau-donnees) appelle rendreSiAffiche("parametres",
// lectureDesParametres) dans renderAll, rendreSiAffiche("parametres",
// renderComptes) dans loadMoi, ET lectureDesParametres() dans showTab.
//
// Le lot rendu avait change ce contrat (cache : rendu garde, fait en arrivant).
// Fusionne sans conflit avec le lot reseau, chaque arrivee sur les Parametres
// lisait deux fois l'etat du calcul routier et les 123 archives, trois fois
// les comptes. Le rendu differe a desormais son nom, rendreOuDifferer, et
// rendreSiAffiche garde le sien.
//
// Les VRAIES fonctions de public/js/app.js, dans un bac a sable : un document
// dont un seul ecran porte « active ».

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app.js"), "utf8");

/** Le texte de `function nom(...) { ... }`, accolades equilibrees (chaines et commentaires sautes). */
function fonction(nom) {
  const debut = SOURCE.search(new RegExp(`^function ${nom}\\(`, "m"));
  assert.notEqual(debut, -1, `fonction absente de app.js : ${nom}`);
  let i = SOURCE.indexOf("{", SOURCE.indexOf(")", debut));
  let prof = 0;
  for (; i < SOURCE.length; i++) {
    const c = SOURCE[i];
    if (c === "/" && SOURCE[i + 1] === "/") { i = SOURCE.indexOf("\n", i); continue; }
    if (c === "/" && SOURCE[i + 1] === "*") { i = SOURCE.indexOf("*/", i) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      for (i++; SOURCE[i] !== c; i++) if (SOURCE[i] === "\\") i++;
      continue;
    }
    if (c === "{") prof++;
    if (c === "}" && --prof === 0) return SOURCE.slice(debut, i + 1);
  }
  throw new Error(`fin introuvable : ${nom}`);
}

/** Un bac : les fonctions de app.js, et l'ecran affiche qu'on choisit. */
function bac(noms) {
  const etat = { affiche: "journee" };
  const contexte = {
    console,
    document: { getElementById: id => ({ classList: { contains: c => c === "active" && id === etat.affiche } }) }
  };
  vm.createContext(contexte);
  const declaration = SOURCE.match(/^const rendusEnAttente = new Map\(\);$/m);
  assert.ok(declaration, "const rendusEnAttente absente de app.js");
  vm.runInContext(`${declaration[0]}\n${noms.map(fonction).join("\n")}\nthis.api = { ${noms.join(", ")} };`, contexte);
  return { api: contexte.api, etat };
}

test("rendreSiAffiche : affiché, dessiné ; caché, ni dessiné ni gardé pour l'arrivée", () => {
  const { api, etat } = bac(["rendreSiAffiche", "rendreEnAttente"]);
  let n = 0;
  api.rendreSiAffiche("parametres", () => n++);
  assert.equal(n, 0, "cache : pas de rendu");
  // L'arrivee sur l'ecran (showTab) : ce contrat ne garde rien pour elle.
  etat.affiche = "parametres";
  api.rendreEnAttente("parametres");
  assert.equal(n, 0, "rendreSiAffiche a garde un rendu pour l'arrivee");
  // Temoin : affiche, il dessine (sinon le 0 ne distinguerait rien).
  api.rendreSiAffiche("parametres", () => n++);
  assert.equal(n, 1);
});

test("un appelant de ce contrat (les Paramètres du lot réseau) est lu une fois en arrivant", () => {
  const { api, etat } = bac(["rendreSiAffiche", "rendreEnAttente"]);
  const lus = { lecture: 0, comptes: 0 };
  const renderComptes = () => { lus.comptes++; };
  const lectureDesParametres = () => { lus.lecture++; renderComptes(); };
  // Ouverture sur le tableau de bord : renderAll puis loadMoi, Parametres caches.
  api.rendreSiAffiche("parametres", lectureDesParametres);
  api.rendreSiAffiche("parametres", renderComptes);
  assert.deepEqual(lus, { lecture: 0, comptes: 0 });
  // L'arrivee : showTab dessine ce qui attend, puis le lot reseau lit.
  etat.affiche = "parametres";
  api.rendreEnAttente("parametres");
  lectureDesParametres();
  assert.deepEqual(lus, { lecture: 1, comptes: 1 });
});

test("rendreOuDifferer : caché, dessiné une fois en arrivant ; affiché, tout de suite et plus en attente", () => {
  const { api, etat } = bac(["rendreOuDifferer", "rendreEnAttente"]);
  let n = 0;
  const rendu = () => n++;
  // Deux chargements pendant qu'on est ailleurs : un seul rendu, a l'arrivee.
  api.rendreOuDifferer("commandes", rendu);
  api.rendreOuDifferer("commandes", rendu);
  assert.equal(n, 0);
  etat.affiche = "commandes";
  api.rendreEnAttente("commandes");
  assert.equal(n, 1);
  // Revenir ne redessine pas ce qui l'a deja ete.
  api.rendreEnAttente("commandes");
  assert.equal(n, 1);
  // Mis en attente, puis dessine a l'ecran : l'arrivee suivante n'a rien a refaire.
  etat.affiche = "journee";
  api.rendreOuDifferer("commandes", rendu);
  etat.affiche = "commandes";
  api.rendreOuDifferer("commandes", rendu);
  assert.equal(n, 2);
  api.rendreEnAttente("commandes");
  assert.equal(n, 2);
});

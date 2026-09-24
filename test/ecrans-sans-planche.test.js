// La dette 7, soldee le 23/09 : les quatre anciennes listes de commandes
// (Commandes du jour, Commandes planifiees, Bons de commande, Commandes
// livrees) ont quitte la page. L'ecran Commandes les porte toutes.
//
// Ce que ce test tient, et que le banc e2e (ecrans-sans-planche.spec.js) ne
// voit pas : une REFERENCE restee dans le code vers un conteneur disparu. Elle
// ne casse rien -- getElementById rend null, la ligne est sautee -- et c'est
// justement pourquoi personne ne la voit : poserSquelettes() nommait encore
// todayOrdersList et plannedOrdersList, deux zones de chargement pour des
// listes qui n'existent plus. Un lecteur croit ces listes vivantes.
//
// Et le contre-temoin : les ANCIENNES ADRESSES, elles, restent. Un favori, un
// lien ou un showTab("commandes-planifiees") code en dur arrivent sur l'ecran
// unique, filtre (config/tabs.js, REDIRECTIONS).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const racine = path.join(__dirname, "..");
const CR = String.fromCharCode(13);
const lire = f => fs.readFileSync(f, "utf8").split(CR).join("");

const app = lire(path.join(racine, "public", "js", "app.js"));
const page = lire(path.join(racine, "public", "index.html"));
const onglets = lire(path.join(racine, "public", "js", "config", "tabs.js"));

/** Le code sans ses commentaires : un commentaire qui raconte l'histoire n'est pas une reference. */
function codeSeul(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/\/\/[^\n]*/g, "");
}

// Les conteneurs et les champs propres aux quatre anciennes listes.
const DISPARUS = [
  "todayOrdersList", "todayOrdersDate", "plannedOrdersList", "plannedOrdersSummary",
  "bdc-list", "bdc-summary", "bdc-search", "bdc-sector", "bdc-date-from", "bdc-date-to",
  "commandesLivreesList", "commandesLivreesSummary", "statsEvolution"
];

test("dette 7 — aucun identifiant des anciennes listes ne reste dans le code", () => {
  const restes = [];
  for (const [nom, source] of [["app.js", app], ["index.html", page]]) {
    const code = codeSeul(source);
    for (const id of DISPARUS) {
      // Le nom entier, pas une sous-chaine : « bdc-list » ne doit pas trouver
      // « bdc-list-table-mode » (une classe CSS, hors de ces fichiers).
      const motif = new RegExp(`["'#]${id.replace(/-/g, "\\-")}["']`);
      if (motif.test(code)) restes.push(`${nom} : ${id}`);
    }
  }
  assert.deepEqual(restes, []);
});

test("dette 7 — les quatre sections ont quitte la page", () => {
  const code = codeSeul(page);
  for (const id of ["commandes-jour", "commandes-planifiees", "bons-commande", "commandes-livrees"]) {
    assert.ok(!code.includes(`id="${id}"`), `section encore presente : #${id}`);
  }
});

test("dette 7 — contre-temoin : les anciennes adresses redirigent toujours", () => {
  // Sans ce contre-temoin, « retirer les listes » pourrait emporter les
  // redirections, et un ancien lien tomberait sur un ecran vide.
  // 24/09 : « À envoyer » est vide par construction, #commandes-jour ouvre « Toutes ».
  for (const [ancien, filtre] of [["commandes-jour", "toutes"], ["commandes-planifiees", "planifiees"],
    ["bons-commande", "toutes"], ["commandes-livrees", "livrees"]]) {
    const ligne = new RegExp(`"${ancien}":\\s*\\{\\s*onglet:\\s*"commandes",\\s*filtre:\\s*"${filtre}"\\s*\\}`);
    assert.ok(ligne.test(onglets), `redirection perdue : #${ancien} -> commandes (${filtre})`);
  }
  // Et la fenetre de detail, qui vivait entre deux de ces sections, reste.
  assert.ok(page.includes('id="bdc-detail-modal"'), "la fenetre de detail d'une commande a disparu");
});

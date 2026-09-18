// La barre basse mobile : quatre destinations, tranchees par Tom le 17/09.
//
//   Tableau de bord · Preparation · Tournee · Abonnements   (+ "Plus")
//
// Ce test fige une DECISION, pas une implementation. Elle a ete prise apres une
// question posee dans les regles ("quatre destinations meritent le pouce parmi
// seize"), et le genre de decision qui se perd au premier remaniement : elle ne
// casse rien quand on la defait, l'application continue de marcher, et personne
// ne se souvient qu'elle a ete prise.
//
// Il verifie aussi l'invariant qui rend les deux listes incapables de se
// contredire : "Plus" est le COMPLEMENT exact de la barre basse. Avant le
// 18/09 les deux etaient tenues a la main, et elles avaient deja diverge --
// "abonnements" figurait dans les deux, "stock" dans aucune.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const racine = path.join(__dirname, "..");
const CR = String.fromCharCode(13);
const lire = f => fs.readFileSync(f, "utf8").split(CR).join("");

const tabs = lire(path.join(racine, "public", "js", "config", "tabs.js"));
const html = lire(path.join(racine, "public", "index.html"));

/** Extrait un tableau de chaines d'une declaration `export const NOM = [...]`. */
function lireListe(source, nom) {
  const m = source.match(new RegExp("export const " + nom + "\\s*=\\s*\\[([^\\]]*)\\]"));
  assert.ok(m, `declaration introuvable : ${nom}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
}

/** Les onglets de la barre basse, dans l'ordre du DOM. */
function lireBarreBasse() {
  const debut = html.indexOf('<nav class="mobile-tabbar"');
  assert.ok(debut >= 0, "barre basse introuvable dans index.html");
  const bloc = html.slice(debut, html.indexOf("</nav>", debut));
  return [...bloc.matchAll(/data-tab="([a-z-]+)"/g)].map(m => m[1]);
}

const DECISION = ["journee", "preparation", "livreur", "abonnements"];

test("barre basse — les quatre destinations sont celles que Tom a tranchees", () => {
  assert.deepEqual(lireListe(tabs, "MOBILE_MAIN_TABS"), DECISION,
    "MOBILE_MAIN_TABS ne porte plus la decision du 17/09");
});

test("barre basse — le HTML dit la meme chose que la configuration, ET DANS LE MEME ORDRE", () => {
  // L'ordre compte : c'est celui du pouce, de gauche a droite. Une barre qui
  // contient les bons onglets dans le mauvais ordre passerait un test de
  // contenu et raterait la decision.
  assert.deepEqual(lireBarreBasse(), DECISION,
    "la barre basse du HTML a diverge de MOBILE_MAIN_TABS");
});

test("barre basse — cinq boutons exactement : quatre destinations et « Plus »", () => {
  const debut = html.indexOf('<nav class="mobile-tabbar"');
  const bloc = html.slice(debut, html.indexOf("</nav>", debut));
  const boutons = bloc.match(/<button class="mobile-tab/g) || [];
  assert.equal(boutons.length, 5,
    "la barre basse ne tient que 4 destinations plus « Plus » : un cinquieme onglet doit aller dans « Plus »");
  assert.ok(bloc.includes('id="mobile-tab-more"'), "le bouton « Plus » a disparu");
});

test("barre basse — « Plus » est le COMPLEMENT exact, pas une seconde liste tenue a la main", () => {
  // C'est l'invariant qui empeche les deux de se contredire. On le verifie sur
  // la SOURCE : MOBILE_OVERFLOW_TABS doit etre derivee, pas enumeree.
  assert.ok(/MOBILE_OVERFLOW_TABS\s*=\s*new Set\(\s*\[\.\.\.mainTabs\]\.filter/.test(tabs),
    "MOBILE_OVERFLOW_TABS est redevenue une liste litterale : elle pourra diverger de la barre basse, comme avant le 18/09");
});

test("barre basse — chaque destination est un onglet valide, et aucune n'est orpheline", () => {
  const principaux = [...tabs.matchAll(/export const mainTabs = new Set\(\[([^\]]*)\]/g)]
    .flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
  assert.ok(principaux.length > 10, `mainTabs illisible : ${principaux.length} entrees`);
  for (const onglet of DECISION) {
    assert.ok(principaux.includes(onglet), `${onglet} n'est pas un onglet valide`);
    assert.ok(html.includes(`id="${onglet}"`) || html.includes(`aria-controls="${onglet}"`),
      `${onglet} n'a pas de panneau dans index.html`);
  }
});

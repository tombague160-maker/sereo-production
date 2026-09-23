// La feuille de style est-elle encore UNE feuille ?
//
// Le 23/09, l'integration du lot 2 mobile a fusionne cinq lots qui ajoutaient
// tous leur bloc A LA FIN de style.css. Chaque fusion a fait un conflit, resolu
// en retirant les marqueurs. Git avait sorti du conflit les lignes que les deux
// blocs partageaient -- l'accolade qui ferme le bloc precedent et la ligne
// « /* ===== » qui ouvre le suivant -- : a chaque jointure, l'une et l'autre
// ont disparu. Le commentaire d'en-tete du bloc suivant devenait un selecteur
// (avec une apostrophe : une chaine jamais fermee), et tout ce qui suivait
// tombait DANS le `@media (max-width: 820px)` du bloc precedent. Au bureau, les
// regles des lots suivants ne s'appliquaient plus ; au telephone, a moitie.
//
// Aucun navigateur ne le signale : une feuille mal fermee se lit sans erreur.
// Les bancs e2e l'ont vu par onze symptomes epars, sur cinq ecrans. Ce test le
// voit a la source, en une ligne, avant tout navigateur.
//
// La tokenisation suit la regle CSS qui compte ici : une chaine meurt a la fin
// de sa ligne (bad-string), un commentaire court jusqu'a « */ ».

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CR = String.fromCharCode(13);
const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "style.css"), "utf8").split(CR).join("");

/** Parcourt la feuille ; rend les defauts de structure, avec leur ligne. */
function defauts(s) {
  const trouves = [];
  let profondeur = 0, ligne = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\n") { ligne++; continue; }
    if (c === "/" && s[i + 1] === "*") {
      const fin = s.indexOf("*/", i + 2);
      if (fin < 0) { trouves.push(`ligne ${ligne} : commentaire jamais ferme`); break; }
      ligne += (s.slice(i, fin).match(/\n/g) || []).length;
      i = fin + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c && s[j] !== "\n") { if (s[j] === "\\") j++; j++; }
      if (j >= s.length || s[j] === "\n") { trouves.push(`ligne ${ligne} : chaine jamais fermee`); i = j - 1; continue; }
      i = j;
      continue;
    }
    if (c === "{") profondeur++;
    if (c === "}") {
      profondeur--;
      if (profondeur < 0) { trouves.push(`ligne ${ligne} : accolade fermante sans ouvrante`); profondeur = 0; }
    }
  }
  if (profondeur !== 0) trouves.push(`fin de fichier : ${profondeur} bloc(s) jamais ferme(s)`);
  return trouves;
}

test("feuille — chaque bloc ouvert est ferme, aucune chaine ni commentaire ne deborde", () => {
  assert.deepEqual(defauts(css), []);
});

test("feuille — aucun marqueur de conflit de fusion n'a survecu", () => {
  const marqueurs = css.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /^(<{7}|={7}|>{7})( |$)/.test(l));
  assert.deepEqual(marqueurs, []);
});

// Le temoin : l'instrument voit bien ce qu'il cherche. Sans lui, un parcours
// qui ne compterait rien rendrait [] sur n'importe quelle feuille.
test("feuille — temoin : la jointure mutilee du 23/09 est reconnue", () => {
  const saine = "@media (max-width: 820px) {\n  .a { display: none; }\n}\n\n/* =====\n   BLOC SUIVANT -- l'en-tete vert\n   ===== */\n.b { color: red; }\n";
  assert.deepEqual(defauts(saine), []);
  const mutilee = "@media (max-width: 820px) {\n  .a { display: none; }\n\n   BLOC SUIVANT -- l'en-tete vert\n   ===== */\n.b { color: red; }\n";
  const vus = defauts(mutilee);
  assert.ok(vus.some(d => /chaine jamais fermee/.test(d)), vus.join(" | "));
  assert.ok(vus.some(d => /1 bloc\(s\) jamais ferme/.test(d)), vus.join(" | "));
});

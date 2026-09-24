// Clair et sombre ne different que par les COULEURS -- tenu a la source.
//
// Le banc e2e (test/e2e/un-seul-dessin.spec.js) compare les deux themes a
// l'ecran ; celui-ci tient la cause, dans la feuille, avant tout navigateur.
// Mesure du 24/09 : 335 regles `:root[data-color-scheme="light"] X` des couches
// anciennes, dont 199 posaient de la geometrie (taille et graisse de police,
// rayons, marges, hauteurs, grille). Le sombre ne les voyait pas : un poste
// Windows en clair voyait une autre application -- corps a 15 px contre 16,
// boutons a 13,44 px, rayons de 8 px au lieu des pilules.
//
// Deux regles :
//   1. une regle scopee au theme clair ne porte que de la PEINTURE ;
//   2. toute graisse declaree est une de celles que Poppins charge
//      (400/500/600/700, charte §3). 950 s'affichait en 700 : le code ne
//      disait pas ce que l'ecran montrait.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CR = String.fromCharCode(13);
const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "style.css"), "utf8").split(CR).join("");

// Ce qui dessine la FORME. Un raccourci de bordure (border, border-top...) porte
// une largeur : seule sa variante -color est permise dans une regle de theme.
const GEOMETRIE = new Set([
  "font-size", "font-weight", "line-height", "letter-spacing", "font-family", "text-transform", "font",
  "border-radius", "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "padding-inline", "padding-block",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "margin-inline", "margin-block",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "gap", "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-template", "grid-column", "grid-row", "grid-area",
  "display", "position", "top", "right", "bottom", "left", "inset", "z-index",
  "flex", "flex-direction", "flex-wrap", "align-items", "justify-content", "align-self", "justify-self",
  "border-width", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-style", "overflow", "overflow-x", "overflow-y", "transform", "content",
  "border-collapse", "border-spacing",
  "border", "border-top", "border-right", "border-bottom", "border-left"
]);

/**
 * Les regles de style (selecteur, declarations, ligne, @media englobants),
 * commentaires retires. Les chaines ne contiennent pas d'accolade dans cette
 * feuille (test/feuille-equilibree.test.js tient sa structure).
 */
function regles(s) {
  const sans = s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
  const out = [];
  const pile = [];
  let tampon = "", ligne = 1;
  for (let i = 0; i < sans.length; i++) {
    const c = sans[i];
    if (c === "\n") ligne++;
    if (c === "{") {
      const prelude = tampon.trim().replace(/\s+/g, " ");
      tampon = "";
      if (prelude.startsWith("@")) { pile.push(prelude); continue; }
      const fin = sans.indexOf("}", i);
      const corps = sans.slice(i + 1, fin);
      const declarations = corps.split(";").map(d => d.trim()).filter(Boolean).map(d => {
        const k = d.indexOf(":");
        return { propriete: d.slice(0, k).trim().toLowerCase(), valeur: d.slice(k + 1).trim() };
      });
      out.push({ selecteur: prelude, declarations, ligne, media: [...pile] });
      ligne += (corps.match(/\n/g) || []).length;
      i = fin;
      continue;
    }
    if (c === "}") { pile.pop(); tampon = ""; continue; }
    if (c === ";" && tampon.trim().startsWith("@")) { tampon = ""; continue; }
    tampon += c;
  }
  return out;
}

// Le telephone (<= 820 px) garde, en clair, la geometrie de ses couches : le lot
// telephone y mesure en clair, en parallele de celui-ci (ecart nomme dans
// DESIGN.md, « Theme clair : finitions et un seul dessin »). La regle ne juge
// donc que ce qui s'applique au bureau.
const TELEPHONE = 820;
const auTelephoneSeulement = media => media.some(m => {
  const x = m.match(/max-width:\s*(\d+)px/);
  return x && Number(x[1]) <= TELEPHONE;
});

// Scopee au clair : `:root[data-color-scheme="light"]` ou `html[...]`, hors
// d'un :not() (`:root:not([data-color-scheme="light"])` est le SOMBRE).
const scopeeClair = sel => /(:root|html)\[data-color-scheme="light"\]/.test(sel.replace(/:not\([^)]*\)/g, ""));

function geometrieDesReglesClaires(s) {
  const trouvees = [];
  for (const r of regles(s)) {
    if (!scopeeClair(r.selecteur) || auTelephoneSeulement(r.media)) continue;
    for (const d of r.declarations) {
      if (GEOMETRIE.has(d.propriete)) trouvees.push(`ligne ${r.ligne} : ${r.selecteur.slice(0, 90)} { ${d.propriete}: ${d.valeur} }`);
    }
  }
  return trouvees;
}

function graissesHorsPoppins(s) {
  const permises = new Set(["400", "500", "600", "700", "normal", "bold", "inherit", "initial", "unset"]);
  const trouvees = [];
  for (const r of regles(s)) {
    for (const d of r.declarations) {
      if (d.propriete !== "font-weight") continue;
      const v = d.valeur.replace(/!important/i, "").trim();
      if (!permises.has(v)) trouvees.push(`ligne ${r.ligne} : ${r.selecteur.slice(0, 90)} { font-weight: ${v} }`);
    }
  }
  return trouvees;
}

test("un seul dessin — une regle du theme clair ne pose que des couleurs", () => {
  const trouvees = geometrieDesReglesClaires(css);
  assert.deepEqual(trouvees, [], trouvees.join("\n"));
});

test("un seul dessin — toute graisse declaree est chargee par Poppins (400/500/600/700)", () => {
  const trouvees = graissesHorsPoppins(css);
  assert.deepEqual(trouvees, [], trouvees.join("\n"));
});

// Les temoins : l'instrument voit ce qu'il cherche, et ne confond pas le sombre
// (`:not([data-color-scheme="light"])`) avec le clair.
test("un seul dessin — temoin : la feuille a bien des regles du theme clair a juger", () => {
  const claires = regles(css).filter(r => scopeeClair(r.selecteur));
  assert.ok(claires.length > 100, `seulement ${claires.length} regles scopees au clair`);
});

test("un seul dessin — temoin : l'instrument reconnait la geometrie, la peinture et le sombre", () => {
  const echantillon = [
    ':root[data-color-scheme="light"] .button { min-height: 44px; border-radius: 8px; color: red; }',
    ':root[data-color-scheme="light"] .panel { border: 1px solid var(--border); background: white; }',
    'html[data-color-scheme="light"] body { font-size: 15px; }',
    ':root[data-color-scheme="light"] .ok { color: red; border-color: blue; box-shadow: none; }',
    '@media (prefers-color-scheme: dark) { :root:not([data-color-scheme="light"]) .sombre { padding: 4px; } }',
    '@media (max-width: 820px) { :root[data-color-scheme="light"] .telephone { padding: 4px; } }',
    '@media (max-width: 920px) { :root[data-color-scheme="light"] .tablette { gap: 4px; } }',
    '.titre { font-weight: 950; } .corps { font-weight: 500; }'
  ].join("\n");
  const geo = geometrieDesReglesClaires(echantillon);
  assert.equal(geo.length, 5, geo.join("\n"));
  assert.ok(geo.some(g => /\.tablette/.test(g)), "une regle de 821 a 920 px echappe au jugement");
  assert.ok(!geo.some(g => /\.telephone/.test(g)), "le telephone est juge");
  assert.ok(geo.some(g => /min-height/.test(g)) && geo.some(g => /border-radius/.test(g)));
  assert.ok(geo.some(g => /\{ border: 1px/.test(g)), "le raccourci de bordure n'est pas vu");
  assert.ok(geo.some(g => /font-size: 15px/.test(g)), "html[...] n'est pas vu");
  assert.ok(!geo.some(g => /sombre/.test(g)), "le sombre est pris pour le clair");
  assert.deepEqual(graissesHorsPoppins(echantillon).map(g => g.replace(/^ligne \d+ : /, "")), [".titre { font-weight: 950 }"]);
});

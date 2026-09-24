// Les regles « body:has(...) » de style.css ne parcourent pas toute la page.
//
// Mesure du 24/09 (jeu de forme production, telephone a CPU x4) : quatre
// lettres dans la recherche Clients, 396 ms de recalcul de style avec
// « body:has(#crm.active...) », 56 ms avec « body:has(> .app > main.content >
// #crm.active...) ». Sans chemin, l'argument de :has() se cherche dans TOUTE la
// page, et Chrome le recherche a chaque recalcul du style de <body> -- une
// frappe, un focus, une ligne ajoutee n'importe ou. Avec un chemin d'enfants
// directs, il ne regarde qu'a cette profondeur.
//
// Le second test est le temoin : le chemin vise les MEMES elements que
// l'ancienne regle seulement si les ecrans et le bandeau sont bien des enfants
// directs de main.content, lui-meme enfant de .app, enfant de <body>.
//
// Integration de la performance (24/09) : les lots d'ameliorations ont ajoute
// des conditions en LISTE (« :has(A, B) », « :is(#a, #b).active ») et une qui
// vise un enfant de .app (le menu « Plus »). Chaque element de la liste est
// juge, et chaque identifiant d'un :is(...), pas seulement le premier.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "../public/css/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const HTML = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

/** L'argument entier d'un :has( qui commence a `debut` (parentheses equilibrees). */
function argumentDe(debut) {
  let prof = 0;
  for (let i = debut; i < CSS.length; i++) {
    if (CSS[i] === "(") prof++;
    else if (CSS[i] === ")") {
      if (prof === 0) return CSS.slice(debut, i);
      prof--;
    }
  }
  throw new Error(`:has( non ferme a ${debut}`);
}

/** Les elements d'une liste de selecteurs, coupee aux virgules hors parentheses. */
function elements(argument) {
  const morceaux = [];
  let prof = 0, debut = 0;
  for (let i = 0; i < argument.length; i++) {
    const c = argument[i];
    if (c === "(") prof++;
    else if (c === ")") prof--;
    else if (c === "," && prof === 0) {
      morceaux.push(argument.slice(debut, i));
      debut = i + 1;
    }
  }
  morceaux.push(argument.slice(debut));
  return morceaux.map(m => m.trim());
}

/** Chaque :has() dont le sujet est <body> : [argument entier, extrait]. */
function hasSurBody() {
  const trouves = [];
  const re = /:has\(/g;
  let m;
  while ((m = re.exec(CSS))) {
    // Le compose qui porte ce :has() : depuis le dernier separateur de selecteur
    // (espace, combinateur, virgule, accolade) hors parentheses.
    let i = m.index, prof = 0;
    while (i > 0) {
      const c = CSS[i - 1];
      if (c === ")") prof++;
      else if (c === "(") { if (prof === 0) { i--; continue; } prof--; }
      else if (prof === 0 && /[\s,{}>+~]/.test(c)) break;
      i--;
    }
    const compose = CSS.slice(i, m.index);
    if (!/^body\b/.test(compose)) continue;
    trouves.push([argumentDe(m.index + 5).trim(), CSS.slice(i, m.index + 60).replace(/\s+/g, " ")]);
  }
  return trouves;
}

test("has borne : l'instrument trouve les regles body:has de la feuille", () => {
  // Sans ce temoin, une recherche qui ne trouve rien rendrait le test suivant vert.
  assert.ok(hasSurBody().length >= 40, `seulement ${hasSurBody().length} regles body:has trouvees`);
  // Et il coupe les listes : sans quoi le second element d'une liste passerait
  // sans etre juge.
  const listes = hasSurBody().filter(([argument]) => elements(argument).length > 1);
  assert.ok(listes.length >= 1, "aucune liste « :has(A, B) » vue : le decoupage n'est pas exerce");
});

// Le chemin exact : un ecran (ou le bandeau), enfant direct de main.content ;
// ou un enfant direct de .app (le menu « Plus »). L'identifiant, ou une liste
// d'identifiants :is(#a, #b).
const CHEMIN = /^> \.app > (main\.content > )?(#[\w-]+|:is\(\s*#[\w-]+(?:\s*,\s*#[\w-]+)*\s*\))/;

test("has borne : chaque body:has(...) cherche par un chemin d'enfants directs", () => {
  const sansChemin = hasSurBody()
    .flatMap(([argument, extrait]) => elements(argument).filter(e => !CHEMIN.test(e)).map(e => `${extrait} :: ${e.slice(0, 60)}`));
  assert.deepEqual(sansChemin, []);
});

test("has borne (temoin) : chaque ecran vise est enfant de main.content, enfant de .app, enfant de body", () => {
  // Une pile de balises : la profondeur et le parent de chaque element ouvrant.
  const pile = [];
  const parentDe = new Map();
  const vides = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  const corps = HTML.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "");
  while ((m = re.exec(corps))) {
    const [, fermante, balise, attributs] = m;
    const nom = balise.toLowerCase();
    if (fermante) {
      const k = pile.map(e => e.nom).lastIndexOf(nom);
      if (k >= 0) pile.length = k;
      continue;
    }
    const id = (attributs.match(/\bid="([^"]+)"/) || [])[1] || "";
    const classes = ((attributs.match(/\bclass="([^"]+)"/) || [])[1] || "").split(/\s+/);
    const noeud = { nom, id, classes, parent: pile[pile.length - 1] || null };
    if (id) parentDe.set(id, noeud);
    if (!vides.has(nom) && !/\/\s*$/.test(attributs)) pile.push(noeud);
  }
  // Chaque identifiant que la feuille nomme au bout d'un chemin, avec sa
  // profondeur : sous main.content, ou directement sous .app.
  const vises = new Map();
  for (const [argument] of hasSurBody()) {
    for (const element of elements(argument)) {
      const m = element.match(CHEMIN);
      if (!m) continue;
      for (const [, id] of m[2].matchAll(/#([\w-]+)/g)) vises.set(`${m[1] ? "main" : "app"}:${id}`, id);
    }
  }
  const ids = [...vises.keys()];
  assert.ok(ids.filter(k => k.startsWith("main:")).length >= 5, `seulement ${ids.length} identifiants : ${ids}`);
  for (const [cle, id] of vises) {
    const e = parentDe.get(id);
    assert.ok(e, `#${id} absent de index.html`);
    if (cle.startsWith("app:")) {
      const app = e.parent, body = app?.parent;
      assert.ok(app && app.classes.includes("app"), `#${id} n'est pas un enfant direct de .app`);
      assert.ok(body && body.nom === "body", `.app n'est pas un enfant direct de body (#${id})`);
      continue;
    }
    const main = e.parent, app = main?.parent, body = app?.parent;
    assert.ok(main && main.nom === "main" && main.classes.includes("content"), `#${id} n'est pas un enfant direct de main.content`);
    assert.ok(app && app.classes.includes("app"), `main.content n'est pas un enfant direct de .app (#${id})`);
    assert.ok(body && body.nom === "body", `.app n'est pas un enfant direct de body (#${id})`);
  }
});

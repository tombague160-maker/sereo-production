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

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "../public/css/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const HTML = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

/** Chaque :has() dont le sujet est <body> : [argument, extrait]. */
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
    const argument = CSS.slice(m.index + 5, m.index + 5 + 80).trimStart();
    trouves.push([argument, CSS.slice(i, m.index + 60).replace(/\s+/g, " ")]);
  }
  return trouves;
}

test("has borne : l'instrument trouve les regles body:has de la feuille", () => {
  // Sans ce temoin, une recherche qui ne trouve rien rendrait le test suivant vert.
  assert.ok(hasSurBody().length >= 40, `seulement ${hasSurBody().length} regles body:has trouvees`);
});

// Le chemin exact : un ecran (ou le bandeau), enfant direct de main.content.
const CHEMIN = /^> \.app > main\.content > #([\w-]+)/;

test("has borne : chaque body:has(...) cherche par un chemin d'enfants directs", () => {
  const sansChemin = hasSurBody().filter(([argument]) => !CHEMIN.test(argument)).map(([, extrait]) => extrait);
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
  // Chaque identifiant que la feuille nomme au bout d'un chemin.
  const ids = [...new Set(hasSurBody().map(([argument]) => (argument.match(CHEMIN) || [])[1]).filter(Boolean))];
  assert.ok(ids.length >= 5, `seulement ${ids.length} identifiants : ${ids}`);
  for (const id of ids) {
    const e = parentDe.get(id);
    assert.ok(e, `#${id} absent de index.html`);
    const main = e.parent, app = main?.parent, body = app?.parent;
    assert.ok(main && main.nom === "main" && main.classes.includes("content"), `#${id} n'est pas un enfant direct de main.content`);
    assert.ok(app && app.classes.includes("app"), `main.content n'est pas un enfant direct de .app (#${id})`);
    assert.ok(body && body.nom === "body", `.app n'est pas un enfant direct de body (#${id})`);
  }
});

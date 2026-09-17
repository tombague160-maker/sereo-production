// Les jetons V8 : la charte et la feuille CSS doivent dire la MEME chose.
//
// design/DESIGN.md est la source. Le bloc --v8-* de style.css en est la copie
// executable. Ce test lit les DEUX et echoue si l'un derive sans l'autre : une
// couleur changee dans la charte sans le CSS, ou l'inverse, est exactement le
// genre d'ecart qui survit des mois -- rien ne casse, l'ecran est juste faux.
//
// Il RECALCULE aussi chaque contraste que la charte annonce. Un chiffre ecrit
// a la main dans un tableau n'est pas une mesure : le 17/09, la charte disait
// 5,95 et 6,01 pour la meme paire, a trois lignes d'ecart.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const racine = path.join(__dirname, "..");
// Fins de ligne NORMALISEES a la lecture.
//
// Git convertit en CRLF a la sortie de branche sur Windows. Un marqueur ecrit
// avec un saut de ligne simple ne mord alors plus, et ce test echoue au
// CHARGEMENT du module -- avant meme d annoncer un cas. Il a rendu
// "0 pass, 1 fail" apres un simple git checkout, sans qu une ligne de CSS ait
// bouge : le fichier n avait pas change, sa REPRESENTATION si.
//
// Les retours chariot sont retires par String.fromCharCode(13) et non par une
// sequence d echappement : ce fichier a ete casse deux fois par des scripts ou
// l echappement se perdait en route, produisant un motif qui ne correspondait
// a rien. Une constante nommee ne peut pas se perdre.
const CR = String.fromCharCode(13);
const lire = fichier => fs.readFileSync(fichier, "utf8").split(CR).join("");

const charte = lire(path.join(racine, "design", "DESIGN.md"));
const css = lire(path.join(racine, "public", "css", "style.css"));

// --- WCAG ------------------------------------------------------------------

function luminance(hex) {
  const c = hex.replace("#", "").match(/../g).map(h => parseInt(h, 16) / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// --- Lecture de la charte --------------------------------------------------

/** Lit un tableau markdown "| Role | `#HEX` | ..." entre deux titres. */
function lireTableau(depuis, jusqua) {
  const debut = charte.indexOf(depuis);
  assert.ok(debut >= 0, `titre introuvable dans la charte : ${depuis}`);
  const fin = charte.indexOf(jusqua, debut);
  const bloc = charte.slice(debut, fin < 0 ? undefined : fin);
  const roles = new Map();
  for (const m of bloc.matchAll(/^\| ([^|`]+?) \| `(#[0-9A-Fa-f]{6})` \|/gm)) {
    roles.set(m[1].trim(), m[2].toUpperCase());
  }
  return roles;
}

const charteClair = lireTableau("### Mode clair", "### Mode sombre");
const charteSombre = lireTableau("### Mode sombre", "## 3. Typographie");

// --- Lecture du CSS --------------------------------------------------------

/** Lit les --v8-* d'un bloc CSS a partir d'un marqueur, jusqu'a la prochaine accolade fermante. */
function lireJetonsDepuis(marqueur) {
  const debut = css.indexOf(marqueur);
  assert.ok(debut >= 0, `bloc introuvable dans le CSS : ${marqueur}`);
  const fin = css.indexOf("}", debut);
  const jetons = new Map();
  for (const m of css.slice(debut, fin).matchAll(/(--v8-[a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    jetons.set(m[1], m[2].toUpperCase());
  }
  return jetons;
}

// Le bloc clair : le ":root {" qui precede la premiere declaration --v8-.
const premierV8 = css.indexOf("--v8-principal:");
assert.ok(premierV8 >= 0, "aucun jeton --v8- dans le CSS");
const rootClair = css.lastIndexOf(":root {", premierV8);
const cssClair = lireJetonsDepuis(css.slice(rootClair, rootClair + 7) === ":root {" ? css.slice(rootClair, premierV8 + 20) : "");
const cssSombre = lireJetonsDepuis(':root[data-color-scheme="dark"] {\n  --v8-');
const cssSombreMedia = lireJetonsDepuis(':root:not([data-color-scheme="light"]) {\n    --v8-');

// --- Correspondance role de la charte -> jeton -----------------------------

const CORRESPONDANCE = {
  "Principal": "--v8-principal",
  "Principal appuyé": "--v8-principal-appuye",
  "Accent": "--v8-accent",
  "Vert d'eau": "--v8-vert-eau",
  "Vert d'eau sombre": "--v8-vert-eau",
  "Pêche": "--v8-peche",
  "Pêche sombre": "--v8-peche",
  "Pêche claire": "--v8-peche-claire",
  "Vert clair": "--v8-vert-clair",
  "Fond": "--v8-fond",
  "Surface": "--v8-surface",
  "Surface haute": "--v8-surface-haute",
  "Surface basse": "--v8-surface-basse",
  "Squelette de chargement": "--v8-squelette",
  "Texte": "--v8-texte",
  "Texte secondaire": "--v8-texte-secondaire",
  "Texte sur principal": "--v8-texte-sur-principal",
  "Texte secondaire sur vert": "--v8-texte-secondaire-sur-principal",
  "Texte secondaire sur principal": "--v8-texte-secondaire-sur-principal",
  "Alerte": "--v8-alerte",
  "Avertissement": "--v8-avertissement",
  "Fond d'avertissement": "--v8-avertissement-fond"
};

// --- Tests -----------------------------------------------------------------

test("jetons — la charte est lisible et porte bien ses deux palettes", () => {
  assert.ok(charteClair.size >= 15, `clair : ${charteClair.size} roles lus`);
  assert.ok(charteSombre.size >= 16, `sombre : ${charteSombre.size} roles lus`);
  assert.equal(charteClair.get("Principal"), "#386B6D");
  assert.equal(charteSombre.get("Principal"), "#93CBC9");
});

test("jetons — le CSS porte 19 jetons, dans chacun des trois blocs", () => {
  assert.equal(cssClair.size, 19, `clair : ${[...cssClair.keys()].join(", ")}`);
  assert.equal(cssSombre.size, 19, `sombre : ${[...cssSombre.keys()].join(", ")}`);
  assert.equal(cssSombreMedia.size, 19, `sombre @media : ${[...cssSombreMedia.keys()].join(", ")}`);
});

test("jetons — les deux blocs sombres sont identiques (regle des 3 blocs)", () => {
  for (const [nom, valeur] of cssSombre) {
    assert.equal(cssSombreMedia.get(nom), valeur, `${nom} differe entre les deux blocs sombres`);
  }
});

test("jetons — CLAIR : chaque role de la charte vaut exactement son jeton CSS", () => {
  const ecarts = [];
  for (const [role, hex] of charteClair) {
    const jeton = CORRESPONDANCE[role];
    if (!jeton) continue;                       // ex. "Succès", sans hex propre
    if (cssClair.get(jeton) !== hex) ecarts.push(`${role} : charte ${hex}, CSS ${jeton}=${cssClair.get(jeton)}`);
  }
  assert.deepEqual(ecarts, [], "derive charte/CSS en clair :\n  " + ecarts.join("\n  "));
});

test("jetons — SOMBRE : chaque role de la charte vaut exactement son jeton CSS", () => {
  const ecarts = [];
  for (const [role, hex] of charteSombre) {
    const jeton = CORRESPONDANCE[role];
    assert.ok(jeton, `role sombre sans correspondance : "${role}"`);
    if (cssSombre.get(jeton) !== hex) ecarts.push(`${role} : charte ${hex}, CSS ${jeton}=${cssSombre.get(jeton)}`);
  }
  assert.deepEqual(ecarts, [], "derive charte/CSS en sombre :\n  " + ecarts.join("\n  "));
});

// Chaque paire porte le seuil que la charte lui assigne : 4,5 pour du texte,
// 3 pour une forme ou une icone.
const PAIRES = {
  clair: [
    ["--v8-texte-sur-principal", "--v8-principal", 4.5],
    ["--v8-texte", "--v8-surface", 4.5],
    ["--v8-texte", "--v8-fond", 4.5],
    ["--v8-texte-secondaire", "--v8-surface", 4.5],
    ["--v8-texte-secondaire", "--v8-fond", 4.5],
    ["--v8-texte-secondaire", "--v8-surface-basse", 4.5],
    ["--v8-texte-secondaire-sur-principal", "--v8-principal", 4.5],
    ["--v8-principal-appuye", "--v8-peche-claire", 4.5],
    ["--v8-principal-appuye", "--v8-vert-clair", 4.5],
    ["--v8-alerte", "--v8-surface", 4.5],
    ["--v8-alerte", "--v8-fond", 4.5],
    ["--v8-avertissement", "--v8-surface", 4.5],
    ["--v8-avertissement", "--v8-fond", 4.5],
    ["--v8-avertissement", "--v8-surface-basse", 4.5],
    ["--v8-avertissement", "--v8-avertissement-fond", 4.5],
    ["--v8-principal", "--v8-surface", 3.0]          // icone / forme
  ],
  sombre: [
    ["--v8-texte", "--v8-fond", 4.5],
    ["--v8-texte", "--v8-surface", 4.5],
    ["--v8-texte", "--v8-surface-haute", 4.5],
    ["--v8-texte", "--v8-surface-basse", 4.5],
    ["--v8-texte", "--v8-vert-eau", 4.5],
    ["--v8-texte", "--v8-peche", 4.5],
    ["--v8-texte", "--v8-peche-claire", 4.5],
    ["--v8-texte", "--v8-vert-clair", 4.5],
    ["--v8-texte-secondaire", "--v8-fond", 4.5],
    ["--v8-texte-secondaire", "--v8-surface", 4.5],
    ["--v8-texte-secondaire", "--v8-surface-haute", 4.5],
    ["--v8-texte-sur-principal", "--v8-principal", 4.5],
    ["--v8-alerte", "--v8-fond", 4.5],
    ["--v8-alerte", "--v8-surface", 4.5],
    ["--v8-alerte", "--v8-surface-haute", 4.5],
    ["--v8-avertissement", "--v8-fond", 4.5],
    ["--v8-avertissement", "--v8-surface", 4.5],
    ["--v8-avertissement", "--v8-surface-haute", 4.5],
    ["--v8-avertissement", "--v8-avertissement-fond", 4.5],
    ["--v8-principal", "--v8-fond", 3.0],
    ["--v8-accent", "--v8-fond", 3.0]
  ]
};

for (const [mode, paires] of Object.entries(PAIRES)) {
  test(`jetons — ${mode.toUpperCase()} : les ${paires.length} paires annoncees tiennent leur seuil`, () => {
    const jetons = mode === "clair" ? cssClair : cssSombre;
    const echecs = [];
    for (const [fg, bg, seuil] of paires) {
      const r = contraste(jetons.get(fg), jetons.get(bg));
      if (r < seuil) echecs.push(`${fg} sur ${bg} : ${r.toFixed(2)} < ${seuil}`);
    }
    assert.deepEqual(echecs, [], "paires sous le seuil :\n  " + echecs.join("\n  "));
  });
}

test("jetons — les INTERDICTIONS de la charte sont fondees", () => {
  // Contre-temoin : si l'accent passait 4,5 sur blanc, la regle "jamais du
  // texte" ne reposerait sur rien. Elle repose sur 2,34. Meme chose pour
  // "pas de badge" sur la peche : 3,91.
  const accent = contraste(cssClair.get("--v8-accent"), cssClair.get("--v8-surface"));
  assert.ok(accent < 3, `l'accent sur blanc donne ${accent.toFixed(2)} : l'interdiction n'aurait plus d'objet`);
  const peche = contraste(cssClair.get("--v8-principal"), cssClair.get("--v8-peche"));
  assert.ok(peche < 4.5, `principal sur peche donne ${peche.toFixed(2)} : "pas de badge" n'aurait plus d'objet`);
});

test("jetons — les trois signaux sont INDISCERNABLES, et c'est mesure", () => {
  // La charte interdit de faire voyager un signal par la couleur seule. Ce
  // test verifie que l'interdiction reste FONDEE : si un jour les trois se
  // distinguaient nettement, la regle deviendrait du bruit. Tant qu'une paire
  // est sous 1,6 dans chaque mode, elle tient.
  //
  // Le detail compte : ce n'est pas la MEME paire selon le mode. Le sombre
  // confond l'accent avec les deux autres ; le clair confond l'avertissement
  // avec l'alerte -- les deux signaux qu'on a le plus besoin de distinguer,
  // et l'ecart y est le pire du tableau (1,07).
  for (const [mode, jetons] of [["clair", cssClair], ["sombre", cssSombre]]) {
    const paires = [["accent", "alerte"], ["accent", "avertissement"], ["alerte", "avertissement"]]
      .map(([a, b]) => contraste(jetons.get("--v8-" + a), jetons.get("--v8-" + b)));
    const pire = Math.min(...paires);
    assert.ok(pire < 1.6,
      mode + " : la paire la plus proche vaut " + pire.toFixed(2)
      + " — au-dessus de 1,6, la regle \"jamais par la couleur seule\" perdrait son fondement");
  }
});

test("jetons — la marge de 0,13 annoncee sur le secondaire-sur-vert est REELLE", () => {
  // La charte ecrit "0,13 de marge : rien ne se pose dessous". Une marge large
  // rendrait l'avertissement inutile ; une marge negative serait un defaut. Elle
  // doit etre exactement etroite.
  const r = contraste(cssClair.get("--v8-texte-secondaire-sur-principal"), cssClair.get("--v8-principal"));
  assert.ok(r >= 4.5 && r < 4.7, `marge reelle : ${(r - 4.5).toFixed(2)}`);
});

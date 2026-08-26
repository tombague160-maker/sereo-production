/**
 * Genere le jeu complet d'icones PWA a partir de la marque Sereo.
 *
 * Pourquoi ce script existe : le manifeste ne declarait qu'un SVG, ce qui
 * suffit a Firefox mais pas au reste du monde.
 *   - Chrome exige un PNG 192 ET un PNG 512 pour considerer l'app installable.
 *   - Android applique un masque adaptatif : il faut des variantes "maskable"
 *     dont le contenu tient dans les 80 % centraux, sinon les bords sont rognes.
 *   - iOS IGNORE totalement les icones du manifeste et ne lit que la balise
 *     <link rel="apple-touch-icon">, qui doit pointer un PNG a fond opaque.
 *
 * Sortie dans public/icons/ et NON dans public/brand/ : en prod un volume est
 * monte sur /app/public/brand et masque les fichiers bakes dans l'image (piege
 * documente dans CLAUDE.md). public/icons/ n'est monte nulle part.
 *
 * Usage : npm run icons
 */

const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("@playwright/test");

const OUT_DIR = path.join(__dirname, "..", "public", "icons");

// Palette de la marque, reprise telle quelle de public/favicon.svg.
const TEAL = "#356f70";
const MINT = "#a8cbc7";
const CORAL = "#ef8f77";

// Le motif seul, exprime dans un carre de 64x64. Les cercles depassent
// volontairement a droite : ils sont rognes par le clip, c'est le dessin.
const GLYPH = `
    <circle cx="24" cy="31" r="19" fill="${MINT}"/>
    <circle cx="53" cy="31" r="19" fill="${MINT}"/>
    <path d="M20 50c13 9 30 9 43-1" fill="none" stroke="${CORAL}" stroke-width="8" stroke-linecap="round"/>`;

/** Icone classique : coins arrondis, motif pleine taille. */
function svgAny() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><clipPath id="c"><rect width="64" height="64" rx="14"/></clipPath></defs>
  <g clip-path="url(#c)">
    <rect width="64" height="64" fill="${TEAL}"/>${GLYPH}
  </g>
</svg>`;
}

/**
 * Icone masquable : fond a fond perdu (le systeme dessine sa propre forme) et
 * motif reduit a 80 % au centre, la zone que la specification garantit visible
 * quel que soit le masque applique par le lanceur Android.
 */
function svgMaskable() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><clipPath id="c"><rect x="6.4" y="6.4" width="51.2" height="51.2" rx="11.2"/></clipPath></defs>
  <rect width="64" height="64" fill="${TEAL}"/>
  <g clip-path="url(#c)" transform="translate(6.4,6.4) scale(0.8)">
    <rect width="64" height="64" fill="${TEAL}"/>${GLYPH}
  </g>
</svg>`;
}

/**
 * Icone iOS : carre plein, sans transparence ni coins arrondis. iOS applique
 * lui-meme son masque ; une icone deja arrondie donnerait un double arrondi.
 */
function svgApple() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${TEAL}"/>${GLYPH}
</svg>`;
}

const TARGETS = [
  { file: "icon-192.png", size: 192, svg: svgAny },
  { file: "icon-512.png", size: 512, svg: svgAny },
  { file: "icon-maskable-192.png", size: 192, svg: svgMaskable },
  { file: "icon-maskable-512.png", size: 512, svg: svgMaskable },
  { file: "apple-touch-icon.png", size: 180, svg: svgApple },
  { file: "apple-touch-icon-152.png", size: 152, svg: svgApple },
  { file: "apple-touch-icon-167.png", size: 167, svg: svgApple }
];

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: "msedge" });
  try {
    for (const target of TARGETS) {
      const context = await browser.newContext({
        viewport: { width: target.size, height: target.size },
        deviceScaleFactor: 1
      });
      const page = await context.newPage();

      // omitBackground laisse le fond du SVG decider : les icones "any" gardent
      // leurs coins transparents, les autres sont pleines.
      await page.setContent(
        `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${target.size}px;height:${target.size}px}</style>${target.svg()}`,
        { waitUntil: "load" }
      );

      const outPath = path.join(OUT_DIR, target.file);
      await page.screenshot({ path: outPath, omitBackground: true });
      await context.close();

      const bytes = fs.statSync(outPath).size;
      console.log(`  ${target.file.padEnd(28)} ${target.size}x${target.size}  ${bytes} o`);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${TARGETS.length} icones generees dans public/icons/`);
})().catch(error => {
  console.error("Echec generation icones :", error);
  process.exit(1);
});

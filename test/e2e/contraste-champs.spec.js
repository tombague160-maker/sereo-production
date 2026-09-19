// E2E : le contraste du texte DANS LES CHAMPS de saisie.
//
// POURQUOI UN BANC SEPARE, ET CE QU'IL DIT DE L'AUTRE.
// `contraste-application.spec.js` annonce 1275 textes et 0 defaut. Il ne ment
// pas, mais sa portee est plus etroite que son titre. Il selectionne ainsi :
//
//     if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
//
// Un element n'est juge que s'il porte un NOEUD TEXTE enfant. Or un `<input>`
// n'en a jamais -- il ne peut pas avoir d'enfants du tout. Deux familles
// entieres etaient donc INVISIBLES a l'instrument :
//
//   1. le TEXTE INDICATIF (`::placeholder`),
//   2. la VALEUR SAISIE et le libelle d'un `<select>`.
//
// Et la cecite etait double pour le texte indicatif : `::placeholder` porte sa
// PROPRE declaration de couleur, si bien que `el.style.color = "transparent"`
// ne l'efface pas. Meme s'il avait ete selectionne, ses glyphes seraient
// apparus IDENTIQUES dans les deux photographies -- donc comptes a zero, donc
// jamais juges. Un zero qui rassure.
//
// C'est un controle negatif de la DEUXIEME cause : non pas "il n'y en a pas",
// mais "je ne vois pas". L'instrument ici rend les placeholders transparents
// par une feuille INJECTEE, seul moyen d'atteindre un pseudo-element.
//
// CE QUI A MOTIVE LA RECHERCHE. La charte (§9) note, sur les maquettes :
// "texte indicatif des champs de recherche 3,27:1 -- jamais mesure par
// personne". Et `style.css` porte trois declarations `::placeholder`, TOUTES
// prefixees `:root[data-color-scheme="light"]`. C'est exactement la forme du
// defaut de l'accordeon : une regle juste, scopee a un seul mode.

const { test, expect } = require("./tuiles");

const DIFF_MIN = 40;     // difference de canal qui fait un glyphe
const PART_MIN = 0.02;   // 2 % des glyphes...
const PIXELS_MIN = 8;    // ...ET 8 pixels : le relatif seul echoue sur un petit champ
const MARGE = 1;         // on n'approche pas le bord : l'antialiasing y ment

/** Luminance relative sRGB (WCAG 2.x). */
function luminance([r, g, b]) {
  const c = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function contraste(a, b) {
  const [h, l] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (h + 0.05) / (l + 0.05);
}
/**
 * Rend [r, g, b, a]. L'ALPHA COMPTE : `rgba(255,255,255,0.72)` lu comme du
 * blanc pur surestime le contraste, et c'est precisement la couleur du texte
 * indicatif de la barre laterale. Le fond, lui, est lu SOUS les glyphes, donc
 * deja opaque -- c'est sur lui qu'il faut composer.
 */
function rgba(chaine) {
  const n = (chaine.match(/[\d.]+/g) || []).map(Number);
  if (n.length < 3) return null;
  return [n[0], n[1], n[2], n.length >= 4 ? n[3] : 1];
}

/** Compose un devant translucide sur un fond opaque. */
function composer([r, g, b, a], fond) {
  if (a >= 1) return [r, g, b];
  return [0, 1, 2].map(i => Math.round(a * [r, g, b][i] + (1 - a) * fond[i]));
}

/** Les champs visibles de l'onglet actif, avec la couleur de ce qu'ils MONTRENT. */
function releverChamps(page) {
  return page.evaluate(() => {
    const dedans = el => {
      const s = el.closest("section.page");
      return !s || s.classList.contains("active");
    };
    return [...document.querySelectorAll("input, textarea, select")]
      .filter(el => !["hidden", "checkbox", "radio", "file", "range", "color"].includes(el.type))
      .filter(dedans)
      .map(el => {
        const r = el.getBoundingClientRect();
        // Un champ VIDE montre son placeholder ; un champ REMPLI montre sa
        // valeur. Ce ne sont pas les memes declarations de couleur, et juger
        // l'une pour l'autre rendrait un nombre du mauvais objet.
        const montreIndication = el.tagName !== "SELECT" && el.value === "" && !!el.placeholder;
        const cs = montreIndication ? getComputedStyle(el, "::placeholder") : getComputedStyle(el);
        const texte = montreIndication
          ? el.placeholder
          : (el.tagName === "SELECT" ? (el.selectedOptions[0]?.textContent || "") : el.value);
        return {
          nom: el.id ? "#" + el.id : (String(el.className).trim().split(/\s+/)[0] || el.tagName.toLowerCase()),
          genre: montreIndication ? "indication" : "valeur",
          texte: String(texte).trim(),
          couleur: cs.color,
          taille: parseFloat(getComputedStyle(el).fontSize),
          gras: parseInt(getComputedStyle(el).fontWeight, 10) >= 700,
          x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height)
        };
      })
      .filter(c => c.w > 8 && c.h > 8 && c.texte.length > 0
        && c.y >= 0 && c.y + c.h <= window.innerHeight && c.x >= 0);
  });
}

/**
 * Photographie avec puis sans le texte des champs, et rend le fond LU SOUS LES
 * GLYPHES de chacun. Le placeholder exige une feuille injectee -- c'est le
 * seul moyen d'atteindre un pseudo-element depuis le script.
 */
async function mesurer(page, champs) {
  if (!champs.length) return [];
  // `.toString("base64")` et NON `{ encoding: "base64" }` : cette option n'est
  // pas honoree ici, page.screenshot() rend un Buffer, et le Buffer traverse
  // page.evaluate en "[object Object]". L'Image echoue alors a se charger et le
  // banc meurt d'un "page.evaluate: Event" qui n'accuse rien de precis.
  const avec = (await page.screenshot()).toString("base64");
  const style = await page.addStyleTag({
    content: "::placeholder{color:transparent !important}" +
             "input,textarea,select{color:transparent !important}"
  });
  await page.waitForTimeout(120);
  const sans = (await page.screenshot()).toString("base64");
  await style.evaluate(el => el.remove());

  return page.evaluate(async ([a, b, zones, seuil, partMin, pixMin, marge]) => {
    const charger = src => new Promise((ok, ko) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = ko;
      i.src = "data:image/png;base64," + src;
    });
    const [ia, ib] = await Promise.all([charger(a), charger(b)]);
    const cv = document.createElement("canvas");
    cv.width = ia.width; cv.height = ia.height;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(ia, 0, 0);
    const pa = cx.getImageData(0, 0, cv.width, cv.height).data;
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.drawImage(ib, 0, 0);
    const pb = cx.getImageData(0, 0, cv.width, cv.height).data;
    const e = cv.width / window.innerWidth;

    return zones.map(z => {
      const x0 = Math.max(0, Math.round((z.x + marge) * e));
      const y0 = Math.max(0, Math.round((z.y + marge) * e));
      const x1 = Math.min(cv.width, Math.round((z.x + z.w - marge) * e));
      const y1 = Math.min(cv.height, Math.round((z.y + z.h - marge) * e));
      const compte = new Map();
      let glyphes = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const k = (y * cv.width + x) * 4;
          const d = Math.abs(pa[k] - pb[k]) + Math.abs(pa[k + 1] - pb[k + 1]) + Math.abs(pa[k + 2] - pb[k + 2]);
          if (d < seuil) continue;
          glyphes++;
          const cle = pb[k] + "," + pb[k + 1] + "," + pb[k + 2];
          compte.set(cle, (compte.get(cle) || 0) + 1);
        }
      }
      const fonds = [...compte.entries()]
        .filter(([, n]) => n >= pixMin && n / glyphes >= partMin)
        .map(([c]) => c.split(",").map(Number));
      return { glyphes, fonds };
    });
  }, [avec, sans, champs, DIFF_MIN, PART_MIN, PIXELS_MIN, MARGE]);
}

for (const mode of ["light", "dark"]) {
  test(`champs — le texte des champs tient son seuil en mode ${mode}`, async ({ browser }) => {
    test.setTimeout(420000);
    const ctx = await browser.newContext({ colorScheme: mode, viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(m => {
      try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ }
    }, mode);
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    // Les TRANSITIONS, et non `fullPage`, sont ce qui avait produit 333 faux
    // defauts sur le banc voisin : une couleur photographiee a mi-chemin d'une
    // transition n'est celle d'aucun etat. On les coupe avant de mesurer.
    await page.addStyleTag({
      content: "*, *::before, *::after { transition: none !important; animation: none !important; }"
    });
    // La barre laterale n'a plus de section depliable : ses huit entrees
    // sont toujours visibles, il n'y a plus rien a ouvrir avant de mesurer.
    await page.waitForTimeout(600);

    // La liste des ecrans se prend a SA SOURCE, pas aux boutons de la barre.
    // Depuis que huit entrees ouvrent seize ecrans, compter les boutons ne
    // parcourait plus que la moitie de l'application -- sans rien dire.
    const onglets = await page.evaluate(() =>
      import("/js/config/tabs.js").then(m => [...m.mainTabs]));
    expect(onglets.length, "aucun onglet : rien n'a ete parcouru").toBeGreaterThan(10);

    const defauts = [];
    let juges = 0;
    let muets = 0;

    for (const onglet of onglets) {
      await page.evaluate(id => { location.hash = "#" + id; }, onglet);
      await page.waitForTimeout(400);
      const champs = await releverChamps(page);
      const fonds = await mesurer(page, champs);

      champs.forEach((c, i) => {
        const mesure = fonds[i];
        const devant = rgba(c.couleur);
        if (!devant || !mesure) return;
        // Un champ sans glyphe detecte n'est pas un champ conforme : c'est un
        // champ NON JUGE. On le compte a part plutot que de le taire.
        if (!mesure.glyphes || !mesure.fonds.length) { muets++; return; }
        const seuil = (c.taille >= 24 || (c.gras && c.taille >= 18.66)) ? 3 : 4.5;
        for (const fond of mesure.fonds) {
          juges++;
          const r = contraste(composer(devant, fond), fond);
          if (r < seuil) {
            defauts.push(`[${onglet}] ${c.nom} (${c.genre}) « ${c.texte.slice(0, 24)} » : `
              + `${c.couleur} sur rgb(${fond}) = ${r.toFixed(2)} < ${seuil}`);
          }
        }
      });
    }

    console.log(`\n[${mode}] ${onglets.length} onglets, ${juges} texte(s) de champ mesure(s), `
      + `${muets} non juge(s), ${defauts.length} defaut(s)`);

    // Le prealable qui empeche un vert vide : sans lui, un selecteur casse
    // rendrait 0 champ, 0 defaut, et un banc triomphalement vert.
    expect(juges, "aucun texte de champ mesure : l'instrument n'a rien vu").toBeGreaterThan(5);
    expect([...new Set(defauts)], `contraste insuffisant dans les champs (${mode})`).toEqual([]);

    await ctx.close();
  });
}

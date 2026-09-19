// E2E : contraste REEL de TOUT le texte de l'application, onglet par onglet.
//
// On lit les pixels SOUS LES GLYPHES, jamais la couleur declaree : la page est
// photographiee avec son texte, puis avec tout le texte rendu transparent. Les
// pixels qui changent dans le rectangle d'un element sont ses glyphes ; on lit
// alors le fond a ces positions dans la seconde image.
//
// Ce que ca traverse et que l'arithmetique ne traverse pas : les couches
// translucides, les degrades, les backdrop-filter, et surtout la CASCADE --
// neuf regles se disputent .tab.active dans cette feuille, et la couleur
// declaree dans la regle de base n'est pas celle qui s'affiche.
//
// --- DEUX CAPTURES PAR ONGLET, ET NON DEUX PAR ELEMENT ---------------------
//
// Une version precedente photographiait chaque element separement. Elle etait
// juste mais impraticable : ~19 000 allers-retours navigateur, plus d'une
// heure en CI, dix minutes pour UN onglet.
//
// Son en-tete justifiait ce choix en accusant `fullPage` d'AGRANDIR la fenetre
// et de decaler les coordonnees. MESURE LE 18/09 : c'est FAUX. innerWidth,
// innerHeight, scrollHeight et le rectangle d'un element sont identiques avant
// et apres une capture, `fullPage` compris. La vraie cause des 333 faux
// defauts de ce jour-la etait les TRANSITIONS -- `.button` anime `color` sur
// 160 ms, et la capture "sans texte" attrapait le milieu du fondu. Corriger
// deux choses a la fois et attribuer le gain a la mauvaise est une erreur
// facile ; elle a coute ici un instrument cent fois trop lent.
//
// --- GARDE-FOUS, chacun paye par un instrument qui a menti -----------------
//   - POPULATION, relative ET absolue : un fond doit porter >= 2 % des pixels
//     de glyphe ET au moins 8 pixels. Le relatif seul ne suffit pas : sur une
//     pastille ronde de 24 px, un chiffre fait ~40 pixels et 2 % vaut moins
//     d'UN pixel -- un seul pixel de bord courbe inventait un fond.
//   - MARGE de 2 px exclue sur chaque bord : le contour anticrenele d'une
//     pastille n'est pas du glyphe.
//   - PORTEE : le test echoue s'il a mesure trop peu de textes.
//   - SEUIL selon la TAILLE : 3:1 pour le gros texte (>= 24px, ou >= 18,66px
//     gras), 4,5:1 sinon.
//   - TRANSITIONS ET ANIMATIONS COUPEES : on veut l'etat final.
//   - Controles INACTIFS exemptes (WCAG 1.4.3), elements a opacite reduite
//     ecartes : on y lirait une couleur DECLAREE sur un fond RENDU.
//   - OCCLUSION : un element recouvert n'est pas mesure.
//   - Le logotype est exempte (WCAG 1.4.3).

const { test, expect } = require("./tuiles");

const PART_MIN = 0.02;
const PIXELS_MIN = 8;
const DIFF_MIN = 40;
const MARGE = 2;
const PORTEE_MIN = 120;

function luminance(r, g, b) {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contraste(a, b) {
  const la = luminance(...a), lb = luminance(...b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Releve les elements portant directement du texte, avec leur rectangle en
 * coordonnees de PAGE. Les elements recouverts, inactifs ou semi-transparents
 * sont ecartes ici, une fois, plutot qu'a la mesure.
 */
async function relever(page) {
  // MARGE est une constante Node : le navigateur ne la voit pas. Elle est donc
  // PASSEE, pas refermee -- une page.evaluate ne capture rien de la portee du
  // test, et une reference oubliee echoue a l'execution, pas a la lecture.
  return page.evaluate(marge => {
    /** Le rectangle des LIGNES DE TEXTE d'un element, en coordonnees page. */
    const boiteDuTexte = (el, secours) => {
      const plage = document.createRange();
      plage.selectNodeContents(el);
      const rects = [...plage.getClientRects()].filter(b => b.width > 0 && b.height > 0);
      const b = rects.length
        ? rects.reduce((acc, r) => ({
            left: Math.min(acc.left, r.left), top: Math.min(acc.top, r.top),
            right: Math.max(acc.right, r.right), bottom: Math.max(acc.bottom, r.bottom)
          }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
        : null;
      const f = b ? { left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top } : secours;
      return { x: f.left + scrollX, y: f.top + scrollY, w: f.width, h: f.height };
    };

    const feuilles = [];
    const marche = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = marche.nextNode())) {
      if (["SCRIPT", "STYLE", "SVG", "PATH", "USE"].includes(el.tagName)) continue;
      const texte = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
      if (!texte) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
      // Le mot-marque « sereo » de la barre laterale. Mesure : #EF9177 sur
      // #386B6D = 2,57:1, sous les 3:1 du texte large -- et c'est conforme.
      // WCAG 2.1 SC 1.4.3 exempte nommement « le texte qui fait partie d'un
      // logo ou d'un nom de marque ». L'exemption est ECRITE ici, avec son
      // chiffre, pour qu'un futur lecteur sache qu'elle a ete mesuree et non
      // subie. En mode sombre le meme couple donne 6,99:1.
      if (el.closest(".marque, .brand-preview, [data-brand-preview]")) continue;
      if (el.closest("[disabled], [aria-disabled='true'], .is-disabled, .disabled")) continue;
      let opaque = true, p = el;
      while (p && p !== document.body) {
        if (parseFloat(getComputedStyle(p).opacity) < 0.99) { opaque = false; break; }
        p = p.parentElement;
      }
      if (!opaque) continue;

      const r = el.getBoundingClientRect();
      if (r.width < 2 * marge + 3 || r.height < 2 * marge + 3) continue;
      // Occlusion : ce qui est au centre doit etre l'element ou l'un des siens.
      const devant = document.elementFromPoint(
        Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1),
        Math.min(Math.max(r.top + Math.min(r.height / 2, 8), 1), innerHeight - 1)
      );
      if (devant && !(devant === el || el.contains(devant) || devant.contains(el))) continue;

      feuilles.push({
        texte: texte.slice(0, 40),
        chemin: (el.className && typeof el.className === "string")
          ? "." + el.className.trim().split(/\s+/).join(".")
          : el.tagName.toLowerCase(),
        // ON MESURE LA BOITE DU TEXTE, PAS CELLE DE L'ELEMENT.
        //
        // La boite d'un element contient son remplissage, sa bordure et,
        // s'il est arrondi, des COINS qui ne sont pas peints par lui : on y
        // lit le fond du dessous. Mesure du 19/09 sur un bouton-pilule de
        // Parametres : 17 pixels du coin superieur gauche, soit 2,8 % des
        // pixels retenus -- au-dessus du seuil de population cense justement
        // ecarter ce cas -- et un verdict de 1,05:1 sur un texte qui tient
        // largement son seuil.
        //
        // Un Range sur le contenu rend les rectangles des LIGNES de texte.
        // C'est ce que l'en-tete de ce fichier promet de mesurer.
        ...boiteDuTexte(el, r),
        couleur: cs.color,
        taille: parseFloat(cs.fontSize),
        gras: parseInt(cs.fontWeight, 10) >= 700
      });
    }
    return feuilles;
  }, MARGE);
}

/**
 * Rend [r, g, b, a] -- l'ALPHA COMPTE. `couleur.match(/\d+/g).slice(0, 3)`
 * decoupait `rgba(255,255,255,0.72)` en (255,255,255) et SURESTIMAIT le
 * contraste : ce blanc-la vaut 3,45 sur le vert du champ de recherche, pas
 * 4,25. Mesure du 18/09, 45 defauts reels rendus invisibles par ce seul
 * `slice`.
 */
function avecAlpha(chaine) {
  const n = (chaine.match(/[\d.]+/g) || []).map(Number);
  if (n.length < 3) return null;
  return [n[0], n[1], n[2], n.length >= 4 ? n[3] : 1];
}

/** Compose un devant translucide sur un fond OPAQUE (celui lu sous les glyphes). */
function composerSurFond([r, g, b, a], fond) {
  if (a >= 1) return [r, g, b];
  return [0, 1, 2].map(i => Math.round(a * [r, g, b][i] + (1 - a) * fond[i]));
}

/** Rend tout le texte transparent, et retourne de quoi le restaurer. */
/**
 * Fige transitions et animations pendant les captures.
 *
 * Sans cela, `color: transparent` s'applique EN FONDU sur les elements qui
 * declarent une transition, et la capture « sans texte » attrape le milieu du
 * fondu : le texte est alors present dans les deux images, et la couleur lue
 * « sous les glyphes » est le texte lui-meme. Mesure du 19/09 sur le bouton
 * Supprimer de Parametres : 89,8 % d'opacite restante a l'instant de la
 * capture. On fige plutot que d'attendre -- une attente est un nombre devine.
 */
async function figerTransitions(page) {
  await page.evaluate(() => {
    if (document.getElementById("__fige-transitions")) return;
    const style = document.createElement("style");
    style.id = "__fige-transitions";
    style.textContent = "*, *::before, *::after { transition: none !important;"
      + " animation: none !important; }";
    document.head.appendChild(style);
  });
}

async function degelerTransitions(page) {
  await page.evaluate(() => document.getElementById("__fige-transitions")?.remove());
}

async function masquerTexte(page) {
  await page.evaluate(() => {
    window.__sauv = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      window.__sauv.push([el, el.style.color]);
      el.style.color = "transparent";
    }
  });
}
async function restaurerTexte(page) {
  await page.evaluate(() => { (window.__sauv || []).forEach(([el, c]) => { el.style.color = c; }); });
}

/** Mesure les fonds sous les glyphes de chaque region, dans deux captures. */
async function mesurerRegions(page, avec, sans, regions) {
  return page.evaluate(async ([a, b, regs, seuil, partMin, pixMin, marge]) => {
    const charger = src => new Promise((ok, ko) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = ko;
      im.src = "data:image/png;base64," + src;
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
    // L'echelle relie les coordonnees CSS aux pixels de l'image (DPR).
    const echelle = cv.width / document.documentElement.scrollWidth;

    return regs.map(f => {
      const x0 = Math.max(0, Math.round((f.x + marge) * echelle));
      const y0 = Math.max(0, Math.round((f.y + marge) * echelle));
      const x1 = Math.min(cv.width, Math.round((f.x + f.w - marge) * echelle));
      const y1 = Math.min(cv.height, Math.round((f.y + f.h - marge) * echelle));
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
  // MARGE VAUT ZERO DEPUIS QUE LA REGION EST LA BOITE DU TEXTE.
  //
  // Les 2 px servaient a ecarter le contour anticrenele de l'ELEMENT. La boite
  // du texte n'a ni contour ni coin : il n'y a plus rien a ecarter. Et la marge
  // y devenait nuisible -- sur « 1 » dans .op-step-number, une boite de quelques
  // pixels, elle mangeait toute la region et le banc declarait le chiffre
  // invisible. Une marge calculee pour une boite ne vaut pas pour l'autre.
  }, [avec, sans, regions, DIFF_MIN, PART_MIN, PIXELS_MIN, 0]);
}

for (const mode of ["light", "dark"]) {
  test("tout le texte de l'application tient son seuil en mode " + mode, async ({ browser }) => {
    test.setTimeout(600000);
    const ctx = await browser.newContext({ colorScheme: mode, viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(m => { try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ } }, mode);
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    // La barre laterale n'a plus de section depliable : ses huit entrees
    // sont toujours visibles, il n'y a plus rien a ouvrir avant de mesurer.

    // La liste des ecrans se prend a SA SOURCE, pas aux boutons de la barre.
    // Depuis que huit entrees ouvrent seize ecrans, compter les boutons ne
    // parcourait plus que la moitie de l'application -- sans rien dire.
    const onglets = await page.evaluate(() =>
      import("/js/config/tabs.js").then(m => [...m.mainTabs]));
    expect(onglets.length, "aucun onglet trouve").toBeGreaterThan(5);

    const defauts = [];
    const invisibles = [];
    let totalMesure = 0;

    for (const onglet of onglets) {
      await page.evaluate(id => { location.hash = "#" + id; }, onglet);
      await page.waitForTimeout(600);
      if (await page.locator(".leaflet-container").count()) {
        await page.locator(".leaflet-control-zoom-in").first()
          .waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      }
      await page.evaluate(() => window.scrollTo(0, 0));

      const feuilles = await relever(page);
      if (!feuilles.length) continue;

      // DEUX captures pour tout l'onglet. L'ordre compte : on photographie
      // d'abord AVEC le texte, puis on masque -- l'inverse laisserait une
      // chance au navigateur de reflow entre le releve et la premiere image.
      await figerTransitions(page);
      const avec = (await page.screenshot({ fullPage: true })).toString("base64");
      await masquerTexte(page);
      const sans = (await page.screenshot({ fullPage: true })).toString("base64");
      await restaurerTexte(page);
      await degelerTransitions(page);

      const mesures = await mesurerRegions(page, avec, sans, feuilles);
      feuilles.forEach((f, i) => {
        const m = mesures[i];
        // ZERO GLYPHE N'EST PAS UNE CONFORMITE.
        //
        // L'element a passe tous les filtres de mise en page : il a du texte, il
        // n'est ni `display:none`, ni `visibility:hidden`, ni transparent, et sa
        // boite a une surface. S'il ne produit malgre tout AUCUNE difference
        // entre la photographie avec texte et celle sans, c'est que personne ne
        // le voit -- il est RECOUVERT, ou de la couleur exacte de son fond. Les
        // deux sont des defauts.
        //
        // Mesure du 18/09 : c'est exactement ce qui cachait `.map-empty`, peint
        // sous les panneaux Leaflet (z-index 200+ contre `auto`). Un harnais de
        // mutation a retire son z-index sans qu'aucun banc ne bronche -- parce
        // que ce `return` muet le rangeait avec les cas sans texte.
        //
        // Le controle d'occlusion en amont ne l'attrape pas : il interroge
        // `elementFromPoint`, en coordonnees de FENETRE, alors que l'element
        // peut etre mille pixels plus bas. Ici on lit la page entiere.
        if (!m.glyphes || !m.fonds.length) { invisibles.push(f); return; }
        totalMesure++;
        const txt = avecAlpha(f.couleur);
        if (!txt) return;
        const gros = f.taille >= 24 || (f.taille >= 18.66 && f.gras);
        const seuil = gros ? 3 : 4.5;
        for (const fond of m.fonds) {
          const r = contraste(composerSurFond(txt, fond), fond);
          if (r < seuil) {
            defauts.push("[" + mode + "/" + onglet + "] " + r.toFixed(2) + ":1 < " + seuil
              + '  "' + f.texte + '"  ' + f.chemin + "  " + f.couleur
              + " sur rgb(" + fond.join(",") + ")  " + f.taille + "px" + (f.gras ? " gras" : ""));
          }
        }
      });
    }

    console.log("\n[" + mode + "] " + onglets.length + " onglets, " + totalMesure + " textes mesures, "
      + defauts.length + " defaut(s), " + invisibles.length + " texte(s) INVISIBLE(S)");
    for (const f of invisibles.slice(0, 12)) {
      console.log("  invisible : \"" + f.texte + "\"  " + f.chemin);
    }
    for (const d of [...new Set(defauts)].slice(0, 40)) console.log("  " + d);

    expect(totalMesure, "portee insuffisante").toBeGreaterThanOrEqual(PORTEE_MIN);

    // Un texte pose, mis en page, et que PERSONNE NE VOIT. Zero au 18/09 :
    // l'assertion porte donc sur un etat mesure, pas sur un espoir. C'est elle
    // qui attrape un element recouvert -- le `.map-empty` peint sous les
    // panneaux Leaflet avait echappe a tout le reste, parce qu'un element
    // recouvert ne produit aucun glyphe et se rangeait, muet, avec les cas sans
    // texte.
    expect(invisibles.map(f => f.chemin + " : \u00ab " + f.texte + " \u00bb"),
      "texte(s) presents dans la page mais qui n'apparaissent nulle part").toEqual([]);
    expect([...new Set(defauts)], "textes sous leur seuil").toEqual([]);
    await ctx.close();
  });
}

// E2E : contraste REEL de TOUT le texte de l'application, onglet par onglet.
//
// Generalisation de contraste-navigation.spec.js a l'ensemble des ecrans. Meme
// principe -- on lit les pixels SOUS LES GLYPHES, jamais la couleur declaree :
// chaque element est photographie avec son texte, puis avec le texte rendu
// transparent. Les pixels qui changent sont ses glyphes ; on lit alors le fond
// a ces positions dans la seconde image.
//
// POURQUOI PAR ELEMENT ET PAS PAR PAGE : une premiere version prenait deux
// captures pleine page et decoupait. Elle accusait un bouton primaire d'etre
// "blanc sur #EAF0F0" (1,15:1) alors qu'il rend #386B6D, 6,01:1. Cause :
// `fullPage` AGRANDIT la fenetre a la hauteur du document, et une mise en page
// en 100vh se reorganise -- les coordonnees relevees avant pointaient sur
// autre chose apres. 333 faux defauts, tous plausibles. La capture par element
// est plus lente et ne peut pas se tromper de cible.
//
// Ce que ca traverse que l'arithmetique ne traverse pas : les couches
// translucides, les degrades, les backdrop-filter, et surtout la CASCADE --
// neuf regles se disputent .tab.active dans cette feuille, et la couleur
// declaree dans la regle de base n'est pas celle qui s'affiche.
//
// Garde-fous, chacun paye par un instrument qui a menti :
//   - plancher de POPULATION, relatif ET absolu (2 % des pixels de glyphe, et
//     au moins 8 pixels) : ecarte l'anticrenelage. Le relatif seul ne suffit
//     pas -- sur une pastille de 24 px, 2 % vaut moins d'un pixel
//   - plancher de PORTEE : le test echoue s'il a mesure trop peu de textes
//   - le seuil suit la TAILLE : 3:1 pour le gros texte (>= 24px, ou >= 18,66px
//     gras), 4,5:1 sinon
//   - les controles INACTIFS sont exemptes (WCAG 1.4.3), et les elements a
//     opacite reduite ecartes : l'instrument y lirait une couleur DECLAREE sur
//     un fond RENDU, deux mondes differents
//   - OCCLUSION : un element recouvert n'est pas mesure, la capture "sans
//     texte" montrerait ce qui est devant et non son fond
//   - BORDS EXCLUS : la zone mesuree est retrecie de 2 px de chaque cote. Sur
//     une pastille ronde de 24 px, le contour anticrenele pese plus que le
//     chiffre : un glissement sous-pixel entre les deux captures le faisait
//     passer pour du glyphe, et l'instrument lisait le fond A MI-CHEMIN entre
//     la pastille et ce qu'il y a derriere (#A4B9BA pour un "1" vert sur une
//     pastille blanche : 2,93 au lieu de 6,01).
//   - TRANSITIONS COUPEES pendant la mesure. `.button` anime `color` sur
//     160 ms : la capture "sans texte" attrapait le MILIEU DU FONDU, du blanc
//     a moitie efface, et l'instrument lisait ce blanc delave comme le fond.
//     Un bouton #386B6D (6,01:1) etait accuse de "blanc sur #94AFB0" (2,33).
//     Chaque faux fond etait une couleur plausible : rien ne le trahissait
//     sauf de photographier le bouton et de VOIR le texte fantome.
//
// Le logotype est exempte (WCAG 1.4.3).

const { test, expect } = require("@playwright/test");

const PART_MIN = 0.02;
// Plancher ABSOLU, en plus du plancher relatif. Sur une pastille ronde de
// 24 px, un chiffre fait ~40 pixels de glyphe : 2 % vaut moins d'UN pixel, et
// un seul pixel de bord courbe suffisait a inventer un fond. Symptome : deux
// executions identiques, meme portee (582 textes), verdicts differents -- 4
// defauts, puis 0, puis 2. Un ou deux pixels ne sont jamais "le fond sur
// lequel le texte se pose".
const PIXELS_MIN = 8;
const DIFF_MIN = 40;
const PORTEE_MIN = 120;    // textes par mode en dessous desquels un zero ne vaut rien

function luminance(r, g, b) {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contraste(a, b) {
  const la = luminance(...a), lb = luminance(...b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

async function listerOnglets(page) {
  return page.evaluate(() => [...document.querySelectorAll(".tab[data-tab]")].map(t => t.dataset.tab));
}

/**
 * Releve les elements portant directement du texte, visibles, non recouverts,
 * non inactifs ; les marque d'un index pour la mesure.
 */
async function relever(page) {
  return page.evaluate(() => {
    const feuilles = [];
    document.querySelectorAll("[data-pl-idx]").forEach(e => delete e.dataset.plIdx);
    const marche = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = marche.nextNode())) {
      if (["SCRIPT", "STYLE", "SVG", "PATH", "USE"].includes(el.tagName)) continue;
      const texte = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
      if (!texte) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
      if (el.closest(".brand-logo, .brand-preview, [data-brand-preview]")) continue;
      if (el.closest("[disabled], [aria-disabled='true'], .is-disabled, .disabled")) continue;
      let opaque = true, p = el;
      while (p && p !== document.body) {
        if (parseFloat(getComputedStyle(p).opacity) < 0.99) { opaque = false; break; }
        p = p.parentElement;
      }
      if (!opaque) continue;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const rv = el.getBoundingClientRect();
      const devant = document.elementFromPoint(rv.left + rv.width / 2, rv.top + Math.min(rv.height / 2, 8));
      if (!devant || !(devant === el || el.contains(devant) || devant.contains(el))) continue;
      el.dataset.plIdx = String(feuilles.length);
      feuilles.push({
        texte: texte.slice(0, 40),
        chemin: (el.className && typeof el.className === "string")
          ? "." + el.className.trim().split(/\s+/).join(".")
          : el.tagName.toLowerCase(),
        couleur: cs.color,
        taille: parseFloat(cs.fontSize),
        gras: parseInt(cs.fontWeight, 10) >= 700
      });
    }
    return feuilles;
  });
}

/** Photographie UN element avec puis sans son texte ; rend ses fonds sous glyphes. */
async function mesurerElement(page, idx) {
  const el = page.locator("[data-pl-idx='" + idx + "']").first();
  await el.scrollIntoViewIfNeeded();
  // el.screenshot() ne se trompe jamais de cible ; le contour de l'element
  // est exclu plus bas, dans l'analyse, pas dans la capture.
  // Deux captures stables : on attend que le rendu se soit pose avant chacune.
  // Sans cette attente, deux executions identiques rendaient des verdicts
  // differents a portee EGALE (582 textes, 4 defauts puis 0) -- l'instabilite
  // la plus dangereuse, parce qu'un vert la masque et qu'un rouge passe pour
  // un vrai defaut.
  await el.evaluate(e => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const avec = (await el.screenshot()).toString("base64");
  await el.evaluate(e => {
    e.__sauv = [[e, e.style.color]];
    e.querySelectorAll("*").forEach(c => { e.__sauv.push([c, c.style.color]); c.style.color = "transparent"; });
    e.style.color = "transparent";
  });
  await el.evaluate(e => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const sans = (await el.screenshot()).toString("base64");
  await el.evaluate(e => { (e.__sauv || []).forEach(([n, c]) => { n.style.color = c; }); });

  return page.evaluate(async ([a, b, seuil, partMin, pixMin]) => {
    const charger = src => new Promise((ok, ko) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = ko; im.src = "data:image/png;base64," + src;
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
    const compte = new Map();
    let glyphes = 0;
    // Marge de 2 px CSS exclue sur chaque bord : le contour anticrenele de
    // l'element (pastille ronde, bordure) n'est pas du glyphe.
    const marge = Math.round(2 * (window.devicePixelRatio || 1));
    for (let y = marge; y < cv.height - marge; y++) {
      for (let x = marge; x < cv.width - marge; x++) {
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
  }, [avec, sans, DIFF_MIN, PART_MIN, PIXELS_MIN]);
}

for (const mode of ["light", "dark"]) {
  test("tout le texte de l'application tient son seuil en mode " + mode, async ({ browser }) => {
    test.setTimeout(900000);
    const ctx = await browser.newContext({ colorScheme: mode, viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(m => { try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ } }, mode);
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    // Aucune transition ni animation pendant la mesure : on veut l'etat final,
    // pas une image intermediaire.
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    await page.evaluate(() => document.querySelectorAll(".sidebar .nav-section").forEach(s => s.classList.add("open")));

    const onglets = await listerOnglets(page);
    expect(onglets.length, "aucun onglet trouve").toBeGreaterThan(5);

    const defauts = [];
    let totalMesure = 0;

    for (const onglet of onglets) {
      await page.evaluate(id => { location.hash = "#" + id; }, onglet);
      await page.waitForTimeout(900);
      const feuilles = await relever(page);

      for (let i = 0; i < feuilles.length; i++) {
        const f = feuilles[i];
        let m;
        try { m = await mesurerElement(page, i); } catch { continue; }
        if (!m.glyphes || !m.fonds.length) continue;
        totalMesure++;
        const txt = f.couleur.match(/\d+/g).slice(0, 3).map(Number);
        const gros = f.taille >= 24 || (f.taille >= 18.66 && f.gras);
        const seuil = gros ? 3 : 4.5;
        for (const fond of m.fonds) {
          const r = contraste(txt, fond);
          if (r < seuil) {
            defauts.push("[" + mode + "/" + onglet + "] " + r.toFixed(2) + ":1 < " + seuil + '  "' + f.texte + '"  ' + f.chemin
              + "  " + f.couleur + " sur rgb(" + fond.join(",") + ")  " + f.taille + "px" + (f.gras ? " gras" : ""));
          }
        }
      }
    }

    console.log("\n[" + mode + "] " + onglets.length + " onglets, " + totalMesure + " textes mesures, " + defauts.length + " defaut(s)");
    for (const d of defauts) console.log("  " + d);

    expect(totalMesure, "portee insuffisante").toBeGreaterThanOrEqual(PORTEE_MIN);
    expect(defauts, "textes sous leur seuil").toEqual([]);
    await ctx.close();
  });
}

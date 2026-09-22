// E2E : l'anneau de focus clavier, mesure SUR LES PIXELS.
//
// LE DEFAUT, MESURE LE 18/09. La feuille portait :
//
//     /* Focus clavier OPAQUE (WCAG 2.4.11/1.4.11 >= 3:1) : l'alpha 0.36
//        rendait l'anneau quasi invisible. Orange plein, bien visible sur
//        fond sombre. */
//     outline: 3px solid #f47a5a;
//
// Le commentaire CITE le critere, et c'est precisement ce qui a empeche qu'on
// le remesure. Les chiffres, eux :
//
//     #f47a5a sur #FFFFFF  2,70     sur #FBF7F5  2,54
//             sur #F5F1EE  2,40     sur le vert de la barre  1,85
//
// TOUT LE MODE CLAIR sous le seuil, sur toutes les surfaces. Le mode sombre,
// lui, tient (5,28 a 6,84) -- et le commentaire le disait : « bien visible sur
// fond SOMBRE ». Le clair n'avait jamais ete mesure.
//
// POURQUOI UN INDICATEUR A DEUX TONS, ET PAS UNE COULEUR MIEUX CHOISIE.
// Balayage de l'espace des couleurs : en mode clair, 31 couleurs seulement
// tiennent 3:1 sur les cinq surfaces a la fois, et elles sont toutes quasi
// noires. En mode SOMBRE, AUCUNE couleur unique ne tient : il y a toujours une
// surface ou elle tombe. Un ton unique est donc impossible, ce n'est pas une
// preference.
//
// Deux tons opposes, eux, contrastent ENTRE EUX a 18,46 quelle que soit la page
// derriere : l'indicateur reste percevable sans avoir a enumerer tous les fonds
// possibles. C'est la technique que l'entendement de WCAG 2.4.11 decrit.
//
// CE BANC NE LIT PAS LES DECLARATIONS. Il photographie l'element non focalise,
// puis focalise, et lit les pixels QUI ONT CHANGE -- c'est l'indicateur, tel
// qu'il est rendu. Une regle juste battue par une autre ne tromperait pas cette
// mesure.

const { test, expect } = require("./tuiles");

const SEUIL = 3;          // WCAG 1.4.11, indicateur non textuel
const DIFF_MIN = 40;      // un pixel a change

function luminance([r, g, b]) {
  const c = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function contraste(a, b) {
  const [h, l] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (h + 0.05) / (l + 0.05);
}

/** Les controles visibles de l'onglet actif, jusqu'a `max`. */
function releverControles(page, max) {
  return page.evaluate(n => {
    const sel = "section.page.active button, section.page.active a[href], "
      + "section.page.active input:not([type=hidden]), section.page.active select, "
      // .topbar a disparu (aucune planche desktop n'en porte) : l'en-tete
      // d'ecran l'a remplacee. Viser l'ancienne classe laissait ce banc VERT
      // sans rien regarder de l'en-tete -- releve de la relecture du 22/09.
      + ".sidebar button, .ecran-entete button, .ecran-entete select";
    return [...document.querySelectorAll(sel)]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 12 && r.height > 12
          && r.top >= 0 && r.bottom <= window.innerHeight
          && r.left >= 0 && r.right <= window.innerWidth
          && !el.disabled;
      })
      .slice(0, n)
      .map((el, i) => {
        el.dataset.sondeFocus = String(i);
        const r = el.getBoundingClientRect();
        return {
          i,
          nom: (el.id || String(el.className).trim().split(/\s+/)[0] || el.tagName).slice(0, 26),
          texte: (el.textContent || "").trim().slice(0, 18),
          // La zone photographiee deborde l'element : l'anneau est DEHORS.
          x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8),
          w: Math.min(window.innerWidth, r.right + 8) - Math.max(0, r.left - 8),
          h: Math.min(window.innerHeight, r.bottom + 8) - Math.max(0, r.top - 8)
        };
      });
  }, max);
}

/**
 * Photographie sans focus puis avec, et rend les couleurs de l'INDICATEUR --
 * c'est-a-dire des pixels qui ont change -- ainsi que celles qu'il touche.
 */
async function mesurerIndicateur(page, ctrl) {
  await page.evaluate(i => {
    document.activeElement?.blur();
    const el = document.querySelector(`[data-sonde-focus="${i}"]`);
    el?.blur();
  }, ctrl.i);
  await page.waitForTimeout(90);
  const sans = (await page.screenshot()).toString("base64");

  await page.evaluate(i => {
    const el = document.querySelector(`[data-sonde-focus="${i}"]`);
    // `focus-visible` ne s'active qu'au CLAVIER. Un `.focus()` nu ne suffit pas
    // sur un bouton : Chromium n'y pose pas :focus-visible. On force donc le
    // contexte clavier en marquant la navigation comme telle.
    el?.focus({ focusVisible: true });
  }, ctrl.i);
  await page.waitForTimeout(90);
  const avec = (await page.screenshot()).toString("base64");

  return page.evaluate(async ([a, b, z, diffMin]) => {
    const charger = src => new Promise((ok, ko) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = ko;
      im.src = "data:image/png;base64," + src;
    });
    const [ia, ib] = await Promise.all([charger(a), charger(b)]);
    const cv = document.createElement("canvas");
    cv.width = ia.width; cv.height = ia.height;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(ia, 0, 0);
    const p0 = cx.getImageData(0, 0, cv.width, cv.height).data;   // SANS focus
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.drawImage(ib, 0, 0);
    const p1 = cx.getImageData(0, 0, cv.width, cv.height).data;   // AVEC focus
    const e = cv.width / window.innerWidth;

    const indicateur = new Map();   // couleur APRES -> occurrences
    const dessous = new Map();      // couleur AVANT, au meme endroit
    for (let y = Math.round(z.y * e); y < Math.round((z.y + z.h) * e); y++) {
      for (let x = Math.round(z.x * e); x < Math.round((z.x + z.w) * e); x++) {
        const k = (y * cv.width + x) * 4;
        const d = Math.abs(p0[k] - p1[k]) + Math.abs(p0[k + 1] - p1[k + 1])
          + Math.abs(p0[k + 2] - p1[k + 2]);
        if (d < diffMin) continue;
        const ap = p1[k] + "," + p1[k + 1] + "," + p1[k + 2];
        const av = p0[k] + "," + p0[k + 1] + "," + p0[k + 2];
        indicateur.set(ap, (indicateur.get(ap) || 0) + 1);
        dessous.set(av, (dessous.get(av) || 0) + 1);
      }
    }
    const tri = m => [...m.entries()].sort((u, v) => v[1] - u[1]);
    return {
      pixels: [...indicateur.values()].reduce((s, n) => s + n, 0),
      indicateur: tri(indicateur).slice(0, 6).map(([c, n]) => ({ c: c.split(",").map(Number), n })),
      dessous: tri(dessous).slice(0, 6).map(([c, n]) => ({ c: c.split(",").map(Number), n }))
    };
  }, [sans, avec, ctrl, DIFF_MIN]);
}

for (const mode of ["light", "dark"]) {
  test(`focus — l'anneau clavier est PERCEVABLE en mode ${mode}`, async ({ browser }) => {
    test.setTimeout(240000);
    const ctx = await browser.newContext({ colorScheme: mode, viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(m => {
      try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ }
    }, mode);
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await page.addStyleTag({
      content: "*, *::before, *::after { transition: none !important; animation: none !important; }"
    });
    await page.waitForTimeout(700);

    const controles = await releverControles(page, 14);
    expect(controles.length, "aucun controle mesurable : rien n'a ete juge").toBeGreaterThan(5);

    const defauts = [];
    let juges = 0;
    let muets = 0;
    const sansIndicateur = [];

    for (const ctrl of controles) {
      const m = await mesurerIndicateur(page, ctrl);
      // Aucun pixel change = aucun indicateur visible du tout. C'est le pire
      // des cas, pas un cas neutre : on le compte a part et on le refuse.
      if (m.pixels < 20) { muets++; sansIndicateur.push(ctrl.nom + " « " + ctrl.texte + " »"); continue; }
      juges++;

      // L'indicateur doit se distinguer de CE QU'IL RECOUVRE. On prend la
      // couleur dominante de l'anneau et celle qui etait dessous.
      const anneau = m.indicateur[0].c;
      const fond = m.dessous[0].c;
      const contreLeFond = contraste(anneau, fond);

      // ...OU se distinguer de son PROPRE second ton. Un indicateur a deux tons
      // reste percevable meme sur un fond qui ressemble a l'un des deux -- et
      // c'est la seule construction qui tienne, puisqu'aucune couleur unique ne
      // passe sur toutes les surfaces du mode sombre.
      const second = m.indicateur.find(x => contraste(x.c, anneau) >= SEUIL && x.n >= 8);
      const deuxTons = second ? contraste(second.c, anneau) : 0;

      const meilleur = Math.max(contreLeFond, deuxTons);
      if (meilleur < SEUIL) {
        defauts.push(`[${mode}] ${ctrl.nom} « ${ctrl.texte} » : anneau rgb(${anneau}) `
          + `sur rgb(${fond}) = ${contreLeFond.toFixed(2)}, second ton = ${deuxTons.toFixed(2)}`);
      }
    }

    console.log(`\n[focus/${mode}] ${controles.length} controle(s), ${juges} juge(s), `
      + `${muets} sans indicateur, ${defauts.length} defaut(s)`);
    for (const d of defauts.slice(0, 10)) console.log("   " + d);

    expect(juges, "aucun indicateur mesure : le zero ne distinguerait rien").toBeGreaterThan(4);
    expect(sansIndicateur, "des controles n'ont AUCUN indicateur de focus visible").toEqual([]);
    expect([...new Set(defauts)], `anneau de focus sous ${SEUIL}:1 (${mode})`).toEqual([]);

    await ctx.close();
  });
}

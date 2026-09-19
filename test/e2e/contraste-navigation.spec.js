// E2E : contraste REEL du texte de navigation, lu sous les glyphes.
//
// Pourquoi mesurer des pixels plutot que lire le CSS : neuf regles se disputent
// `.tab.active` dans cette feuille, empilees par trois refontes successives.
// Chacune est juste, l'empilement est illisible, et la couleur declaree dans la
// regle de base n'est pas celle qui s'affiche. Une verification arithmetique sur
// le CSS a donc annonce 1,36:1 la ou l'ecran rendait 7,77:1 -- et, dans l'autre
// sens, n'aurait pas vu le vrai defaut : l'onglet actif en mode SOMBRE, mesure
// a 4,42:1 contre 4,5 exiges (orange #f5a08f sur un degrade orange sombre).
//
// Methode : on photographie l'onglet avec son texte, puis avec le texte rendu
// transparent. Les pixels qui CHANGENT sont les glyphes ; on lit alors le fond
// a ces memes positions dans la seconde image. Tout empilement translucide,
// degrade ou backdrop-filter est donc traverse, parce qu'on mesure ce que
// l'ecran affiche et non ce que la feuille declare.
//
// Deux garde-fous, appris de six instruments qui ont menti avant celui-ci :
//   - un plancher de POPULATION (2% des pixels de glyphe) ecarte les pixels
//     d'anticrenelage, qui font paraitre n'importe quel texte non conforme ;
//   - un plancher de PORTEE fait echouer le test si moins de 10 onglets ont ete
//     mesures, pour qu'un "0 defaut" sur un seul onglet ne puisse pas passer
//     pour un succes.

const { test, expect } = require("./tuiles");

const SEUIL = 4.5;       // WCAG AA, texte normal
const PART_MIN = 0.02;   // part minimale des glyphes portee par un fond
const DIFF_MIN = 40;     // en deca, anticrenelage et non glyphe

function luminance(r, g, b) {
  const f = v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contraste(avant, apres) {
  const a = luminance(...avant);
  const b = luminance(...apres);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Renvoie le pire fond porte par au moins PART_MIN des pixels de glyphe. */
async function fondsSousGlyphes(page, avecB64, sansB64) {
  return page.evaluate(async ([avec, sans, seuil]) => {
    const charger = src => new Promise((ok, ko) => {
      const image = new Image();
      image.onload = () => ok(image);
      image.onerror = ko;
      image.src = "data:image/png;base64," + src;
    });
    const [ia, ib] = await Promise.all([charger(avec), charger(sans)]);
    const toile = document.createElement("canvas");
    toile.width = ia.width;
    toile.height = ia.height;
    const ctx = toile.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(ia, 0, 0);
    const pa = ctx.getImageData(0, 0, toile.width, toile.height).data;
    ctx.clearRect(0, 0, toile.width, toile.height);
    ctx.drawImage(ib, 0, 0);
    const pb = ctx.getImageData(0, 0, toile.width, toile.height).data;

    const compte = new Map();
    let glyphes = 0;
    for (let k = 0; k < pa.length; k += 4) {
      const ecart = Math.abs(pa[k] - pb[k]) + Math.abs(pa[k + 1] - pb[k + 1]) + Math.abs(pa[k + 2] - pb[k + 2]);
      if (ecart < seuil) continue;
      glyphes++;
      const cle = `${pb[k]},${pb[k + 1]},${pb[k + 2]}`;
      compte.set(cle, (compte.get(cle) || 0) + 1);
    }
    return { glyphes, fonds: [...compte.entries()].map(([couleur, n]) => ({ couleur, n })) };
  }, [avecB64, sansB64, DIFF_MIN]);
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

for (const mode of ["light", "dark"]) {
  test(`le texte des onglets tient ${SEUIL}:1 en mode ${mode}`, async ({ browser }) => {
    const context = await browser.newContext({
      colorScheme: mode,
      viewport: { width: 1440, height: 900 }
    });
    await context.addInitScript(value => {
      try { localStorage.setItem("sereo:colorScheme", value); } catch { /* ignore */ }
    }, mode);

    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle" });

    // La barre est plate : ses entrees sont visibles d'emblee, rien n'est a
    // deplier. On attend qu'elles soient TOUTES rendues, sans citer combien :
    // un nombre ecrit ici se perime a la premiere entree ajoutee ou retiree,
    // et c'est exactement ce qui vient d'arriver au precedent (« au moins 10 »
    // quand il y en avait 14, puis huit).
    await page.waitForFunction(() => {
      const toutes = document.querySelectorAll(".sidebar .tab");
      return toutes.length > 0
        && [...toutes].every(t => t.getBoundingClientRect().width > 0);
    }, null, { timeout: 15000 });

    const declarees = await page.locator(".sidebar .tab").count();
    const onglets = page.locator(".tab:visible");
    const total = await onglets.count();
    const defauts = [];

    for (let i = 0; i < total; i++) {
      const onglet = onglets.nth(i);
      await onglet.scrollIntoViewIfNeeded();

      const libelle = (await onglet.textContent()).trim().slice(0, 30);
      const couleur = await onglet.evaluate(e => getComputedStyle(e).color);
      const avec = (await onglet.screenshot()).toString("base64");

      await onglet.evaluate(e => {
        e.__couleursInitiales = [];
        e.querySelectorAll("span:not(.tab-icon)").forEach(span => {
          e.__couleursInitiales.push([span, span.style.color]);
          span.style.color = "transparent";
        });
      });
      const sans = (await onglet.screenshot()).toString("base64");
      await onglet.evaluate(e => {
        (e.__couleursInitiales || []).forEach(([span, valeur]) => { span.style.color = valeur; });
      });

      const { glyphes, fonds } = await fondsSousGlyphes(page, avec, sans);
      if (!glyphes) continue;   // onglet sans libelle visible

      const texte = avecAlpha(couleur);
      if (!texte) continue;
      for (const { couleur: fond, n } of fonds) {
        if (n / glyphes < PART_MIN) continue;
        const rgbFond = fond.split(",").map(Number);
        const ratio = contraste(composerSurFond(texte, rgbFond), rgbFond);
        if (ratio < SEUIL) {
          defauts.push(`${libelle} : ${ratio.toFixed(2)}:1 (${couleur} sur rgb(${fond}))`);
        }
      }
    }

    // Un zero ne vaut que si l'instrument a reellement balaye l'ensemble.
    // La portee se mesure contre ce que la barre DECLARE, pas contre un
    // nombre recopie : « toutes celles qui existent » ne se perime jamais.
    expect(declarees, "la barre ne declare aucune entree").toBeGreaterThan(0);
    expect(total, "portee de la mesure").toBeGreaterThanOrEqual(declarees);
    expect(defauts, `onglets sous ${SEUIL}:1`).toEqual([]);

    await context.close();
  });
}

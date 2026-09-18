// E2E : le dialogue du motif, mesure OUVERT.
//
// POURQUOI CE BANC EXISTE. Les balayages de contraste et de cibles tactiles
// parcourent les quinze onglets, mais ce dialogue est FERME pendant tout leur
// passage : `<dialog>` non ouvert n'a ni surface ni glyphe. Une interface neuve
// echappait donc a toutes les regles de la charte, en silence -- exactement la
// forme du defaut qu'on a passe la journee a fermer ailleurs (un zero qui ne
// distingue rien).
//
// On l'ouvre donc, et on lui applique les memes seuils qu'au reste :
//   contraste  4,5:1 (texte normal)
//   cibles     44 px, le plancher de la charte, au-dessus des 24 px WCAG
//
// ET ON VERIFIE QU'IL SE FERME. Un dialogue modal qui ne rend jamais la main
// bloque tout : `showModal()` rend l'arriere-plan inerte, donc un livreur devant
// un dialogue qui ne repond pas ne peut plus rien faire du tout. C'est pire que
// l'absence de dialogue.

const { test, expect } = require("./tuiles");

const SEUIL_TEXTE = 4.5;
const CIBLE_MIN = 44;   // charte Sereo, et Apple HIG

/** Ouvre le dialogue en le remplissant comme le ferait le vrai geste. */
async function ouvrirDialogue(browser, mode) {
  const ctx = await browser.newContext({ colorScheme: mode, viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(m => {
    try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ }
  }, mode);
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }"
  });

  // On remplit la liste avec ce que le SERVEUR repond, et non avec des libelles
  // inventes ici : un banc bati sur mes propres chaines mesurerait mon attente.
  const nb = await page.evaluate(async () => {
    const reponse = await fetch("/api/delivery-problems").then(r => r.json());
    const liste = document.getElementById("motifListe");
    liste.innerHTML = "";
    for (const m of reponse.motifs) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "motif-choix";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", "false");
      b.dataset.motifCle = m.cle;
      b.textContent = m.libelle;
      liste.appendChild(b);
    }
    // Un choix retenu : la moitie des regles ne s'appliquent qu'a cet etat.
    liste.firstElementChild?.setAttribute("aria-checked", "true");
    document.getElementById("motifProblemeDialog").showModal();
    return reponse.motifs.length;
  });
  await page.waitForTimeout(250);
  return { ctx, page, nb };
}

for (const mode of ["light", "dark"]) {
  test(`dialogue motif — tout son texte tient 4,5:1 en mode ${mode}`, async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page, nb } = await ouvrirDialogue(browser, mode);
    expect(nb, "le serveur n'a rendu aucun motif : rien n'a ete juge").toBeGreaterThan(4);

    // ORDRE CRITIQUE : on releve les COULEURS D'ABORD, les photographies
    // ensuite. La premiere redaction lisait `getComputedStyle(el).color` APRES
    // avoir injecte la transparence -- elle rendait `rgba(0, 0, 0, 0)` pour
    // chaque element et annoncait 1,00:1 partout. Un rouge franc, de la
    // mauvaise cause, sur une interface parfaitement lisible.
    const regions = await page.evaluate(() => {
      const dlg = document.getElementById("motifProblemeDialog");
      const sortie = [];
      for (const el of dlg.querySelectorAll("*")) {
        const aDuTexte = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        const estChamp = el.tagName === "INPUT";
        if (!aDuTexte && !estChamp) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) continue;
        const cs = getComputedStyle(el);
        sortie.push({
          nom: String(el.className || el.tagName).trim(),
          texte: el.textContent.trim().slice(0, 22) || el.id,
          couleur: (estChamp && !el.value)
            ? getComputedStyle(el, "::placeholder").color
            : cs.color,
          taille: parseFloat(cs.fontSize),
          gras: parseInt(cs.fontWeight, 10) >= 700,
          x: r.left, y: r.top, w: r.width, h: r.height
        });
      }
      return sortie;
    });
    expect(regions.length, "aucune region relevee dans le dialogue").toBeGreaterThan(5);

    // Le fond est LU sous les glyphes, comme partout ailleurs : le dialogue se
    // superpose a un fond de page et a un `::backdrop` translucide, que des
    // couleurs declarees ne composent pas.
    const avec = (await page.screenshot()).toString("base64");
    await page.addStyleTag({
      content: "#motifProblemeDialog *, #motifProblemeDialog { color: transparent !important }"
        + "#motifProblemeDialog ::placeholder { color: transparent !important }"
    });
    await page.waitForTimeout(150);
    const sans = (await page.screenshot()).toString("base64");

    const defauts = await page.evaluate(async ([a, b, zones, seuil]) => {
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

      const lum = ([r, g, bl]) => {
        const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
      };
      const rt = (p2, q) => { const [h, l] = [lum(p2), lum(q)].sort((u, v) => v - u); return (h + 0.05) / (l + 0.05); };

      const sortie = [];
      for (const z of zones) {
        const n = (z.couleur.match(/[\d.]+/g) || []).map(Number);
        if (n.length < 3) continue;
        const alpha = n.length >= 4 ? n[3] : 1;
        if (alpha === 0) continue;   // reellement invisible : rien a juger

        const compte = new Map();
        let glyphes = 0;
        for (let y = Math.max(0, Math.round((z.y + 1) * e)); y < Math.min(cv.height, Math.round((z.y + z.h - 1) * e)); y++) {
          for (let x = Math.max(0, Math.round((z.x + 1) * e)); x < Math.min(cv.width, Math.round((z.x + z.w - 1) * e)); x++) {
            const k = (y * cv.width + x) * 4;
            const d = Math.abs(pa[k] - pb[k]) + Math.abs(pa[k + 1] - pb[k + 1]) + Math.abs(pa[k + 2] - pb[k + 2]);
            if (d < 40) continue;
            glyphes++;
            const cle = pb[k] + "," + pb[k + 1] + "," + pb[k + 2];
            compte.set(cle, (compte.get(cle) || 0) + 1);
          }
        }
        if (!glyphes) continue;
        for (const [cle, occ] of compte) {
          if (occ < 8 || occ / glyphes < 0.02) continue;
          const fond = cle.split(",").map(Number);
          const devant = alpha >= 1 ? n.slice(0, 3)
            : [0, 1, 2].map(i => Math.round(alpha * n[i] + (1 - alpha) * fond[i]));
          const ratio = rt(devant, fond);
          const gros = z.taille >= 24 || (z.gras && z.taille >= 18.66);
          if (ratio < (gros ? 3 : seuil)) {
            sortie.push(`${z.nom} \u00ab ${z.texte} \u00bb : ${z.couleur} sur rgb(${fond}) = ${ratio.toFixed(2)}`);
          }
        }
      }
      return sortie;
    }, [avec, sans, regions, SEUIL_TEXTE]);

    expect([...new Set(defauts)], `texte du dialogue sous le seuil (${mode})`).toEqual([]);
    await ctx.close();
  });
}

test("dialogue motif — chaque choix fait au moins 44 px de haut", async ({ browser }) => {
  // Vu au telephone, souvent d'une main. 44 px est le plancher de la charte, et
  // il est plus exigeant que les 24 px de WCAG 2.5.8.
  test.setTimeout(120000);
  const { ctx, page, nb } = await ouvrirDialogue(browser, "light");
  expect(nb, "aucun motif : rien n'a ete juge").toBeGreaterThan(4);

  const petites = await page.evaluate(min =>
    [...document.querySelectorAll("#motifProblemeDialog button, #motifProblemeDialog input")]
      .map(el => ({ nom: el.textContent.trim().slice(0, 24) || el.id, h: Math.round(el.getBoundingClientRect().height) }))
      .filter(c => c.h < min)
      .map(c => `${c.nom} : ${c.h}px`), CIBLE_MIN);

  expect(petites, `cibles sous ${CIBLE_MIN}px dans le dialogue`).toEqual([]);
  await ctx.close();
});

test("dialogue motif — un choix retenu ne se signale pas par la SEULE couleur", async ({ browser }) => {
  // La matrice des trois signaux (jetons-v8.test.js) montre qu'accent, alerte et
  // avertissement ont une paire sous 1,6 dans CHAQUE mode. Un etat qui ne voyage
  // que par la couleur ne se distingue pas. Ici la marque est une pastille, et
  // `aria-checked` la porte aux lecteurs d'ecran.
  test.setTimeout(120000);
  const { ctx, page } = await ouvrirDialogue(browser, "light");

  const etat = await page.evaluate(() => {
    const choix = [...document.querySelectorAll("#motifProblemeDialog .motif-choix")];
    const retenu = choix.find(c => c.getAttribute("aria-checked") === "true");
    const autre = choix.find(c => c.getAttribute("aria-checked") !== "true");
    const marque = el => {
      const avant = getComputedStyle(el, "::before");
      return avant.borderTopColor + "|" + avant.padding;
    };
    return {
      role: retenu?.getAttribute("role"),
      aria: retenu?.getAttribute("aria-checked"),
      marqueRetenue: retenu ? marque(retenu) : null,
      marqueAutre: autre ? marque(autre) : null,
      graisseRetenue: getComputedStyle(retenu).fontWeight,
      graisseAutre: getComputedStyle(autre).fontWeight
    };
  });

  expect(etat.role, "un choix doit se declarer comme radio").toBe("radio");
  expect(etat.aria, "l'etat doit voyager par aria-checked").toBe("true");
  expect(etat.marqueRetenue, "la pastille ne distingue pas les deux etats").not.toBe(etat.marqueAutre);
  expect(etat.graisseRetenue, "la graisse ne distingue pas non plus").not.toBe(etat.graisseAutre);

  await ctx.close();
});

test("dialogue motif — il se FERME, et rend la main", async ({ browser }) => {
  // Un modal qui ne rend jamais la main rend l'arriere-plan inerte pour de bon :
  // le livreur ne peut plus rien faire du tout. Pire que l'absence de dialogue.
  test.setTimeout(120000);
  const { ctx, page } = await ouvrirDialogue(browser, "light");
  expect(await page.evaluate(() => document.getElementById("motifProblemeDialog").open)).toBe(true);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.getElementById("motifProblemeDialog").open),
    "Echap ne ferme pas le dialogue").toBe(false);

  await ctx.close();
});

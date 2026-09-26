// E2E : la page de CONNEXION, le seul ecran qui echappait a tout.
//
// POURQUOI ELLE A BESOIN DE SON PROPRE BANC, ET DE SON PROPRE SERVEUR.
//
// Le serveur des autres bancs tourne SANS authentification -- c'est la seule
// facon d'atteindre les quinze onglets. Mais cela rend `/login` inatteignable :
// mesure du 18/09, il repond **200 et sert l'APPLICATION**. Une premiere sonde
// pointee dessus a donc mesure l'app en croyant mesurer la connexion, et elle
// n'a ete prise que parce qu'on imprimait l'URL FINALE :
//
//     LOGIN light statut=200 url=http://127.0.0.1:3100/   <- pas /login
//
// C'est un controle negatif de la DEUXIEME cause. Pas « il n'y a pas de
// defaut », mais « je ne regarde pas la bonne page » -- et le statut 200 le
// rendait rassurant.
//
// CE QUE CETTE PAGE A DE PARTICULIER. C'est le PREMIER ecran, et elle porte
// environ 300 lignes de CSS *inline dans server.js*, hors du systeme de jetons
// v8 (`--pastel-orange-strong`, `--brand-secondary`...). Aucun des balayages de
// contraste, de cibles tactiles ou de rayons ne l'a jamais vue.
//
// Mesure du 18/09 sur le serveur authentifie : **13 zones, 11 jugees, 0 defaut**
// dans les deux modes. La page est saine -- ce banc existe pour qu'elle le reste,
// parce que rien d'autre ne la regarde.

const { test, expect } = require("./tuiles");

// Le serveur AUTHENTIFIE, declare dans playwright.config.js. `baseURL` pointe
// sur l'autre, donc les URL sont absolues ici -- deliberement visible, pour
// qu'on ne croie pas mesurer la meme chose que les autres bancs.
// L adresse du serveur authentifie : 3101 par defaut ; un worktree qui lance ses
// bancs en parallele d autres passe la sienne (SEREO_E2E_AUTH_BASE_URL).
const BASE = process.env.SEREO_E2E_AUTH_BASE_URL || "http://127.0.0.1:3101";

const DIFF_MIN = 40;
const PART_MIN = 0.02;
const PIXELS_MIN = 8;

function luminance([r, g, b]) {
  const c = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function contraste(a, b) {
  const [h, l] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (h + 0.05) / (l + 0.05);
}

for (const mode of ["light", "dark"]) {
  test(`login — tout son texte tient son seuil en mode ${mode}`, async ({ browser }) => {
    test.setTimeout(180000);
    const ctx = await browser.newContext({ colorScheme: mode, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const reponse = await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });

    // PREALABLE QUI AURAIT PRIS LA PREMIERE SONDE. Un 200 ne prouve pas qu'on
    // est sur la bonne page : sans authentification, `/login` sert l'app avec un
    // 200 parfaitement franc. On exige l'URL finale ET un formulaire.
    expect(reponse.status()).toBe(200);
    expect(page.url(), "on a ete redirige : ce n'est pas la page de connexion").toContain("/login");
    expect(await page.locator('input[type="password"]').count(),
      "aucun champ de mot de passe : ce n'est pas la page de connexion").toBeGreaterThan(0);

    await page.addStyleTag({
      content: "*, *::before, *::after { transition: none !important; animation: none !important; }"
    });
    await page.waitForTimeout(350);

    // Les couleurs D'ABORD, les photographies ensuite. Les lire apres avoir
    // injecte la transparence rend `rgba(0, 0, 0, 0)` partout et annonce 1,00:1.
    const regions = await page.evaluate(() => {
      const sortie = [];
      for (const el of document.body.querySelectorAll("*")) {
        if (["SCRIPT", "STYLE", "SVG", "PATH", "USE"].includes(el.tagName)) continue;
        const texte = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
        const champ = el.tagName === "INPUT";
        if (!texte && !champ) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
        sortie.push({
          nom: String(el.className || el.tagName).trim().slice(0, 30),
          texte: (texte || el.placeholder || "").slice(0, 26),
          couleur: (champ && !el.value) ? getComputedStyle(el, "::placeholder").color : cs.color,
          taille: parseFloat(cs.fontSize),
          gras: parseInt(cs.fontWeight, 10) >= 700,
          x: r.left, y: r.top, w: r.width, h: r.height
        });
      }
      return sortie;
    });
    expect(regions.length, "aucune zone relevee : rien n'a ete juge").toBeGreaterThan(6);

    const avec = (await page.screenshot()).toString("base64");
    await page.addStyleTag({
      content: "* { color: transparent !important } ::placeholder { color: transparent !important }"
    });
    await page.waitForTimeout(150);
    const sans = (await page.screenshot()).toString("base64");

    const mesure = await page.evaluate(async ([a, b, zones, seuil, part, pix]) => {
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
      const rt = (p, q) => { const [h, l] = [lum(p), lum(q)].sort((u, v) => v - u); return (h + 0.05) / (l + 0.05); };

      const defauts = [];
      let juges = 0;
      let sansGlyphe = 0;
      for (const z of zones) {
        const n = (z.couleur.match(/[\d.]+/g) || []).map(Number);
        if (n.length < 3) continue;
        const alpha = n.length >= 4 ? n[3] : 1;
        if (alpha === 0) continue;

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
        // Un champ vide n'a rien a rendre : c'est « rien a juger », et non
        // « du texte que personne ne voit ». On le compte a part plutot que de
        // le confondre avec une conformite.
        if (!glyphes) { sansGlyphe++; continue; }
        juges++;
        for (const [cle, occ] of compte) {
          if (occ < pix || occ / glyphes < part) continue;
          const fond = cle.split(",").map(Number);
          const devant = alpha >= 1 ? n.slice(0, 3)
            : [0, 1, 2].map(i => Math.round(alpha * n[i] + (1 - alpha) * fond[i]));
          const ratio = rt(devant, fond);
          const gros = z.taille >= 24 || (z.gras && z.taille >= 18.66);
          if (ratio < (gros ? 3 : seuil)) {
            defauts.push(`${z.nom} « ${z.texte} » : ${z.couleur} sur rgb(${fond}) = ${ratio.toFixed(2)}`);
          }
        }
      }
      return { defauts, juges, sansGlyphe };
    }, [avec, sans, regions, 4.5, PART_MIN, PIXELS_MIN]);

    console.log(`[login/${mode}] ${regions.length} zones, ${mesure.juges} jugee(s), `
      + `${mesure.sansGlyphe} sans glyphe, ${mesure.defauts.length} defaut(s)`);

    expect(mesure.juges, "aucune zone jugee : le zero ne distinguerait rien").toBeGreaterThan(5);
    expect([...new Set(mesure.defauts)], `texte de la connexion sous son seuil (${mode})`).toEqual([]);

    await ctx.close();
    void contraste;   // garde la formule lisible ici, meme si le calcul vit dans la page
  });
}

test("login — les champs et le bouton sont des cibles de 44 px", async ({ browser }) => {
  // On se connecte au telephone comme ailleurs, et la charte ne fait pas
  // d'exception pour le premier ecran.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  expect(page.url(), "on n'est pas sur la page de connexion").toContain("/login");

  const petites = await page.evaluate(() =>
    [...document.querySelectorAll("input:not([type=hidden]), button, a")]
      .map(el => ({ nom: el.id || el.name || el.textContent.trim().slice(0, 20) || el.tagName,
                    h: Math.round(el.getBoundingClientRect().height) }))
      .filter(c => c.h >= 4 && c.h < 44)
      .map(c => `${c.nom} : ${c.h}px`));

  expect([...new Set(petites)], "cibles sous 44 px sur la page de connexion").toEqual([]);
  await ctx.close();
});

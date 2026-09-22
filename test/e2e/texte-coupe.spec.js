// E2E : le texte est-il COUPE quelque part ?
//
// POURQUOI CE BANC ARRIVE MAINTENANT. La charte §3 prescrit Poppins, et le code
// n'a longtemps charge AUCUNE police : tout rendait dans la police systeme.
// Poser Poppins rend le texte **18 % plus large** sur l'echantillon de
// reference (1018 px contre 863). Dans des conteneurs de largeur fixe, un tel
// elargissement se paie en TEXTE COUPE -- et rien ne mesurait ca.
//
// La charte note « texte coupe ou debordant : 2192 textes, 0 » -- mais c'etait
// sur les MAQUETTES. L'application, elle, n'avait jamais ete mesuree sur cet
// axe. Un chiffre juste, d'un autre objet.
//
// CE QUI COMPTE COMME COUPE, ET CE QUI N'Y COMPTE PAS.
//
//   compte    : `scrollWidth > clientWidth` avec un parent qui masque le
//               debordement -- des caracteres sont rendus et personne ne les voit
//   ne compte PAS :
//     `text-overflow: ellipsis` DELIBERE. Les points de suspension sont un
//     choix : ils annoncent la troncature, l'utilisateur sait qu'il manque
//     quelque chose. Les compter noierait le vrai defaut sous le motif voulu.
//     ⛔ Mais on les DENOMBRE quand meme, et on refuse qu'ils augmentent en
//        silence : une ellipse de plus est une information perdue de plus.
//
//     Les zones DEFILABLES (`overflow: auto`/`scroll`). Le contenu y est
//     atteignable, c'est une mise en page, pas une perte.
//
// ⭐ LA TOLERANCE EST DE 1 px, ET C'EST MESURE. `scrollWidth` est un entier
//    arrondi ; un texte qui tient exactement peut rendre 1 px d'ecart sans que
//    rien ne soit coupe. Au-dela de 1, des glyphes manquent.

const { test, expect } = require("./tuiles");

const TOLERANCE = 1;

for (const vue of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
  const [nom, w, h] = vue;
  test(`texte — rien n'est coupe en silence, vue ${nom}`, async ({ browser }) => {
    test.setTimeout(300000);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    // La barre laterale n'a plus de section depliable : ses huit entrees
    // sont toujours visibles, il n'y a plus rien a ouvrir avant de mesurer.
    // La liste des ecrans se prend a SA SOURCE, pas aux boutons de la barre.
    // Depuis que huit entrees ouvrent seize ecrans, compter les boutons ne
    // parcourait plus que la moitie de l'application -- sans rien dire.
    const onglets = await page.evaluate(() =>
      import("/js/config/tabs.js").then(m => [...m.mainTabs]));
    expect(onglets.length, "aucun onglet : rien n'a ete parcouru").toBeGreaterThan(10);

    const coupes = [];
    const ellipses = [];
    let juges = 0;

    for (const onglet of onglets) {
      await page.evaluate(id => { location.hash = "#" + id; }, onglet);
      await page.waitForTimeout(400);
      const r = await page.evaluate(([sec, tol]) => {
        const coupes = [];
        const ellipses = [];
        let juges = 0;
        // .ecran-entete remplace .topbar, qui n'existe plus : viser l'ancienne
        // classe ne trouvait rien, et le banc restait vert sans l'avoir lue.
        for (const el of document.querySelectorAll("section.page.active *, .sidebar *, .ecran-entete *")) {
          const texte = [...el.childNodes].filter(n => n.nodeType === 3)
            .map(n => n.textContent).join("").trim();
          if (!texte) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const b = el.getBoundingClientRect();
          if (b.width < 4 || b.height < 4) continue;
          juges++;

          const deborde = el.scrollWidth - el.clientWidth;
          if (deborde <= tol) continue;

          let p = el, masque = null, defilable = false;
          while (p && p !== document.body) {
            const c = getComputedStyle(p);
            const ox = c.overflowX;
            if (ox === "auto" || ox === "scroll") { defilable = true; break; }
            if (ox === "hidden" || ox === "clip") { masque = p; break; }
            p = p.parentElement;
          }
          if (defilable) continue;

          const etiquette = `[${sec}] ${String(el.className || el.tagName).trim().split(/\s+/)[0]}`
            + ` « ${texte.slice(0, 28)} » : ${deborde}px de trop`;
          if (cs.textOverflow === "ellipsis") ellipses.push(etiquette);
          else if (masque) coupes.push(etiquette);
        }
        return { coupes, ellipses, juges };
      }, [onglet, TOLERANCE]);
      coupes.push(...r.coupes);
      ellipses.push(...r.ellipses);
      juges += r.juges;
    }

    const uniquesCoupes = [...new Set(coupes)];
    const uniquesEllipses = [...new Set(ellipses)];
    console.log(`\n[coupe/${nom}] ${onglets.length} onglets, ${juges} texte(s) juge(s), `
      + `${uniquesCoupes.length} coupe(s) EN SILENCE, ${uniquesEllipses.length} avec ellipse`);
    for (const c of uniquesCoupes.slice(0, 12)) console.log("   " + c);

    // Prealable : sans texte juge, un zero ne distingue rien.
    expect(juges, "aucun texte juge").toBeGreaterThan(100);
    expect(uniquesCoupes, `texte coupe SANS ellipse (${nom}) : des caracteres sont rendus `
      + "et personne ne les voit").toEqual([]);

    await ctx.close();
  });
}

// E2E : la taille des cibles tactiles, mesuree sur L'APPLICATION.
//
// Elles ne l'avaient jamais ete ici. Les 531 cibles annoncees conformes le
// 17/09 l'etaient sur la MAQUETTE -- un fichier HTML autonome. Une maquette et
// une application ne rendent pas les memes boites : un controle reel peut
// avoir une zone de clic plus grande que son dessin (padding, ::before etendu,
// parent cliquable), ou plus petite (contrainte de grille). Annoncer un axe
// clos sur la maquette et le croire clos dans le produit est exactement le
// genre de portee qui ne voyage pas avec son affirmation.
//
// DEUX SEUILS, ET ILS NE SE CONFONDENT PAS :
//   24 px  WCAG 2.2 AA (2.5.8) -- le plancher LEGAL, non negociable
//   44 px  notre charte et Apple HIG -- l'objectif sur mobile
// Un controle entre les deux est signale sans faire echouer : c'est une dette,
// pas une infraction. Sous 24, c'est un echec.
//
// LE PIEGE QUI A COUTE 557 FAUX DEFAUTS SUR LA MAQUETTE : `cursor` est une
// propriete HERITEE. Juger tout element qui calcule `cursor: pointer` compte
// chaque MOT d'une ligne cliquable. On ne juge que l'element le plus EXTERIEUR
// dont le parent ne porte pas le pointeur.
//
// Exemptions, par la norme (WCAG 2.5.8) :
//   - le controle INLINE dans une phrase (un lien au fil du texte)
//   - le controle dont la taille est imposee par le navigateur (inputs natifs
//     de type date/color, que la CSS ne peut pas agrandir de maniere fiable)
//   - le controle INACTIF
// Et une regle qui n'est pas une exemption mais une CORRECTION DE CIBLE : un
// champ etiquete se mesure par son <label>, parce que c'est le label qu'un
// doigt vise et que le clic y focalise le champ.
// Un controle espace de 24 px de ses voisins beneficie aussi d'une exception
// dans la norme ; on ne s'en sert pas, elle est trop facile a invoquer a tort.

const { test, expect } = require("@playwright/test");

const PLANCHER_LEGAL = 24;   // WCAG 2.2 AA
const OBJECTIF_CHARTE = 44;  // notre charte

/** Releve les cibles REELLES : l'element le plus exterieur qui porte le pointeur. */
async function releverCibles(page) {
  return page.evaluate(() => {
    const INTERACTIF = "a[href], button, input, select, textarea, [role='button'], [role='tab'], [role='link'], [tabindex]:not([tabindex='-1'])";
    const vues = new Set();
    const cibles = [];

    const estRacine = el => {
      if (getComputedStyle(el).cursor !== "pointer") return el.matches(INTERACTIF);
      const p = el.parentElement;
      return !p || getComputedStyle(p).cursor !== "pointer";
    };

    for (const el of document.querySelectorAll(INTERACTIF + ", [style*='cursor'], .tab, .mobile-tab, .pill, .button")) {
      if (vues.has(el)) continue;
      vues.add(el);
      if (!estRacine(el)) continue;

      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      // controle natif dont le navigateur impose la taille
      if (el.matches("input[type='date'], input[type='time'], input[type='color'], input[type='file'], select")) continue;
      // lien au fil d'une phrase : exempte par WCAG 2.5.8
      if (el.tagName === "A" && cs.display.startsWith("inline")) {
        const parent = el.parentElement;
        const texteParent = parent ? parent.textContent.trim().length : 0;
        if (texteParent > el.textContent.trim().length + 8) continue;
      }

      // LA CIBLE D'UN CHAMP ETIQUETE EST SON ETIQUETTE, pas le champ.
      // Cliquer n'importe ou dans un <label> focalise le champ qu'il contient
      // ou qu'il designe : c'est donc le label qu'un doigt vise, et sa boite
      // qu'il faut mesurer. Sans cette regle, les deux champs de recherche
      // etaient accuses de 20,9 px -- la hauteur de leur ligne de texte --
      // alors que leur etiquette fait 44 et 50 px, et que le clic sur le bord
      // de l'etiquette focalise bien le champ (verifie).
      let mesure = el;
      if (el.matches("input, textarea, select")) {
        const etiquette = el.closest("label")
          || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        if (etiquette) {
          const re = etiquette.getBoundingClientRect();
          if (re.width >= 1 && re.height >= 1) mesure = etiquette;
        }
      }
      const r = mesure.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;

      cibles.push({
        largeur: Math.round(r.width * 10) / 10,
        hauteur: Math.round(r.height * 10) / 10,
        texte: (el.textContent || el.getAttribute("aria-label") || el.value || "").trim().slice(0, 28),
        chemin: (mesure === el ? "" : mesure.tagName.toLowerCase() + ">") + el.tagName.toLowerCase()
          + (typeof el.className === "string" && el.className.trim()
            ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "")
      });
    }
    return cibles;
  });
}

// Le profil "mobile" doit EMULER UN DOIGT, pas seulement une fenetre etroite.
//
// Sans `hasTouch`/`isMobile`, le navigateur declare `pointer: fine` -- une
// souris -- et toute regle bornee en `@media (pointer: coarse)` reste INERTE.
// Mesure du 17/09 : les boutons de zoom Leaflet rendaient 30x30 dans le test
// alors que la regle qui les porte a 44 px existe, est correcte, et s'applique
// bien sur un vrai telephone. Un profil incomplet n'invente pas un defaut au
// hasard : il invente exactement ceux que le code traite ailleurs.
const PROFILS = [
  { nom: "desktop", viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false },
  { nom: "mobile", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
];

for (const profil of PROFILS) {
  const nom = profil.nom;
  test(`les cibles tactiles tiennent le plancher WCAG en ${nom}`, async ({ browser }) => {
    test.setTimeout(300000);
    const ctx = await browser.newContext(profil);
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    await page.evaluate(() => document.querySelectorAll(".sidebar .nav-section").forEach(s => s.classList.add("open")));

    const onglets = await page.evaluate(() =>
      [...document.querySelectorAll(".tab[data-tab]")].map(t => t.dataset.tab));
    expect(onglets.length, "aucun onglet trouve").toBeGreaterThan(5);

    const sousLeSeuilLegal = [];
    const dette = [];
    let total = 0;

    for (const onglet of onglets) {
      await page.evaluate(id => { location.hash = "#" + id; }, onglet);
      await page.waitForTimeout(400);
      // La carte pose ses controles APRES coup : sans cette attente, ils
      // etaient mesures ou non selon la charge de la machine, et la dette
      // affichait 2 ou 0 d'une execution a l'autre.
      if (await page.locator(".leaflet-container").count()) {
        await page.locator(".leaflet-control-zoom-in").first()
          .waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      }
      for (const c of await releverCibles(page)) {
        total++;
        const petit = Math.min(c.largeur, c.hauteur);
        const ligne = `[${nom}/${onglet}] ${c.largeur}x${c.hauteur}  "${c.texte}"  ${c.chemin}`;
        if (petit < PLANCHER_LEGAL) sousLeSeuilLegal.push(ligne);
        else if (nom === "mobile" && petit < OBJECTIF_CHARTE) dette.push(ligne);
      }
    }

    // La SORTIE prouve quel profil a ete mesure. Une procedure dans les gestes
    // se relit ; une preuve dans le resultat ne se contourne pas.
    const pointeur = await page.evaluate(() => matchMedia("(pointer: coarse)").matches ? "coarse" : "fine");
    expect(pointeur, "le profil " + nom + " doit declarer le bon type de pointeur")
      .toBe(profil.hasTouch ? "coarse" : "fine");
    console.log(`\n[${nom}] pointer:${pointeur} ${onglets.length} onglets, ${total} cibles mesurees`);
    console.log(`  sous ${PLANCHER_LEGAL}px (WCAG 2.2 AA) : ${sousLeSeuilLegal.length}`);
    for (const l of [...new Set(sousLeSeuilLegal)].slice(0, 25)) console.log("    " + l);
    if (nom === "mobile") {
      console.log(`  entre ${PLANCHER_LEGAL} et ${OBJECTIF_CHARTE}px (dette de charte) : ${dette.length}`);
      for (const l of [...new Set(dette)].slice(0, 15)) console.log("    " + l);
    }

    // Un zero ne vaut que si l'instrument a reellement balaye.
    expect(total, "portee insuffisante").toBeGreaterThan(50);
    expect([...new Set(sousLeSeuilLegal)], `cibles sous le plancher legal de ${PLANCHER_LEGAL}px`).toEqual([]);
    await ctx.close();
  });
}

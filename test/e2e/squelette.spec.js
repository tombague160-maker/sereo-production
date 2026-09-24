// E2E : le squelette de chargement, et les deux regles qui le rendent honnete.
//
// La charte (DESIGN.md §2) prevoit un jeton `--v8-squelette` -- "blocs gris qui
// remplacent le texte pendant le chargement, JAMAIS de texte dessus". Il etait
// declare, mesure, et branche NULLE PART. Mesure du 18/09 en ralentissant l'API
// a 2,5 s : les panneaux du tableau de bord etaient des boites blanches vides
// pendant tout le chargement. Rien ne distinguait "ca charge" de "c'est vide"
// ou de "c'est casse".
//
// Deux invariants, et ils comptent autant l'un que l'autre :
//
//   1. JAMAIS DE TEXTE. Un squelette occupe la place de ce qui vient, il
//      n'annonce rien. Consequence utile : il ne porte aucun glyphe, donc le
//      balayage de contraste ne le juge pas et n'a pas a l'exempter -- une
//      exemption de plus serait une porte de plus.
//
//   2. IL DOIT DISPARAITRE. Un squelette qui ne finit jamais ment plus qu'une
//      zone vide : il promet quelque chose qui n'arrive pas. Et `aria-busy`
//      reste sinon a "true", ce qui annonce a un lecteur d'ecran un chargement
//      termine depuis longtemps. Le premier jet posait les blocs sans jamais
//      les retirer -- onze zones l'ont porte a vie avant que la mesure le dise.

const { test, expect } = require("./tuiles");

const LENTEUR_MS = 2500;

/** Charge l'app avec une API ralentie, pour voir l'etat intermediaire. */
async function chargerAuRalenti(browser, mode) {
  const ctx = await browser.newContext({ colorScheme: mode, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(m => {
    try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ }
  }, mode);
  const page = await ctx.newPage();
  await page.route("**/api/**", async route => {
    await new Promise(r => setTimeout(r, LENTEUR_MS));
    route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

for (const mode of ["light", "dark"]) {
  test(`squelette — il apparait pendant le chargement, en mode ${mode}`, async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page } = await chargerAuRalenti(browser, mode);
    await page.waitForTimeout(1200);

    const pendant = await page.evaluate(() => ({
      squelettes: document.querySelectorAll(".squelette").length,
      blocs: document.querySelectorAll(".squelette-bloc").length,
      busy: document.querySelectorAll('[aria-busy="true"]').length,
      // Les blocs doivent avoir une surface : un squelette de largeur nulle
      // existe dans le DOM et ne se voit pas. C'est arrive au graphique --
      // pose dans un conteneur flex, il rendait 90 px au lieu de 556.
      //
      // MAIS on ne juge que l'onglet VISIBLE. Les squelettes des autres onglets
      // sont a 0x0 parce que leur section est masquee -- c'est correct, et une
      // premiere version de ce test les comptait comme defauts. L'instrument
      // accusait le produit d'un choix qu'il avait lui-meme mal cadre.
      //
      // Le selecteur compte : l'application masque par `.page.active`, et NON
      // par l'attribut hidden. Un filtre bati sur cet attribut ne retirait donc
      // rien du tout et laissait passer huit squelettes d'onglets caches -- un
      // filtre qui a l'air juste, qui se lit bien, et qui ne filtre rien.
      // Mesure : les sections inactives portent display:none et h=0.
      invisibles: [...document.querySelectorAll("section.page.active .squelette")].filter(s => {
        const r = s.getBoundingClientRect();
        return r.width < 40 || r.height < 8;
      }).length,
      visiblesJuges: document.querySelectorAll("section.page.active .squelette").length
    }));

    expect(pendant.squelettes, "aucun squelette pendant le chargement").toBeGreaterThan(5);
    expect(pendant.blocs, "des squelettes sans blocs").toBeGreaterThan(pendant.squelettes);
    expect(pendant.busy, "les zones en attente doivent porter aria-busy").toBeGreaterThan(0);
    // Un zero ne vaut que si l'onglet visible en portait.
    expect(pendant.visiblesJuges, "aucun squelette dans l'onglet visible : rien n'a ete juge").toBeGreaterThan(0);
    expect(pendant.invisibles, "squelette(s) de l'onglet VISIBLE sans surface").toBe(0);

    await ctx.close();
  });

  test(`squelette — JAMAIS de texte dessus, en mode ${mode}`, async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page } = await chargerAuRalenti(browser, mode);
    await page.waitForTimeout(1200);

    // Les chiffres en attente (planche 10b) sont des squelettes aussi.
    const avecTexte = await page.evaluate(() =>
      [...document.querySelectorAll(".squelette, .squelette-chiffre")]
        .filter(s => s.textContent.trim().length > 0)
        .map(s => s.textContent.trim().slice(0, 40)));

    expect(avecTexte, "la charte l'interdit : un squelette n'annonce rien, il occupe une place").toEqual([]);
    await ctx.close();
  });

  test(`squelette — il DISPARAIT une fois charge, en mode ${mode}`, async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, page } = await chargerAuRalenti(browser, mode);

    // Prealable : il faut qu'il ait ete la, sinon ce test passerait sur une
    // application qui n'en pose jamais.
    await page.waitForTimeout(1200);
    const avant = await page.evaluate(() => document.querySelectorAll(".squelette").length);
    expect(avant, "prealable : aucun squelette n'a ete pose").toBeGreaterThan(5);

    await page.waitForTimeout(LENTEUR_MS * 2 + 2000);
    const apres = await page.evaluate(() => ({
      squelettes: document.querySelectorAll(".squelette").length,
      chiffres: document.querySelectorAll(".squelette-chiffre").length,
      busy: document.querySelectorAll('[aria-busy="true"]').length
    }));

    expect(apres.squelettes, "des squelettes survivent au chargement").toBe(0);
    expect(apres.chiffres, "des chiffres restent des blocs gris apres le chargement").toBe(0);
    expect(apres.busy, 'aria-busy="true" survit : un lecteur d\'ecran annoncerait un chargement termine').toBe(0);
    await ctx.close();
  });
}

// --- A la taille de ce qu'ils remplacent (planche 10b, 23/09) ----------------
//
// « Les cartes gardent leur forme et leurs libelles ; seuls les chiffres sont
// des blocs aux dimensions du chiffre attendu. [...] La page ne bouge pas quand
// les donnees arrivent. » Mesure du 23/09 avant ce lot, API ralentie : les
// chiffres affichaient « 0 » et « — », le sous-titre recopiait « 0 commande a
// preparer », et TOUT l'ecran descendait a l'arrivee des donnees -- de 22 px au
// bureau, de 72 px au telephone (la pilule du mois, vide, puis large ; le
// sous-titre, sur une ligne, puis deux).
//
// Un serveur SEME : a vide, les chiffres finaux seraient « 0 » et le banc ne
// distinguerait pas un bloc a la taille d'un nombre d'un bloc quelconque.

const { demarrer } = require("./serveur-seme");

test.describe("à la taille de ce qu'ils remplacent", () => {
  // UN serveur, donc un seul ouvrier : deux ouvriers en demarraient chacun un
  // sur le meme port, et le premier arrete coupait le second.
  test.describe.configure({ mode: "serial" });
  let srv;
  test.beforeAll(async () => { srv = await demarrer({ port: 3178 }); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  async function auRalenti(browser, largeur, ancre = "") {
    const ctx = await browser.newContext({ viewport: { width: largeur, height: largeur > 820 ? 900 : 844 }, colorScheme: "light" });
    const page = await ctx.newPage();
    await page.route("**/api/**", async route => {
      await new Promise(r => setTimeout(r, LENTEUR_MS));
      route.continue();
    });
    await page.goto(srv.base + "/" + (ancre ? "#" + ancre : ""), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    return { ctx, page };
  }

  async function chargementFini(page) {
    await page.waitForFunction(() => !document.querySelector('.squelette, .squelette-chiffre, [aria-busy="true"]'), null, { timeout: 30000 });
    await page.waitForTimeout(300);
  }

  const CHIFFRES = ["#opRevenue", "#opBasket", "#dashboardPreparingCount", "#dashboardDeliveringCount",
    "#dashboardPreparingDetail", "#dashboardDeliveringDetail"];
  // Ce qui suit les chiffres dans la page : si l'un bouge, c'est que la page a saute.
  const REPERES = [...CHIFFRES, ".tb-tuile-titre", "#revenueChart"];

  const releve = page => page.evaluate(sel => Object.fromEntries(sel.map(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return [s, { haut: r.top, gauche: r.left, droite: r.right, hauteur: r.height }];
  })), REPERES);

  for (const largeur of [1440, 390]) {
    test(`les chiffres ne bougent pas à l'arrivée des données, à ${largeur} px`, async ({ browser }) => {
      test.setTimeout(120000);
      const { ctx, page } = await auRalenti(browser, largeur);

      const pendant = await page.evaluate(ids => ({
        blocs: ids.map(s => {
          const el = document.querySelector(s);
          const apres = getComputedStyle(el, "::after");
          return { s, bloc: el.classList.contains("squelette-chiffre"), texte: el.textContent.trim(),
            l: parseFloat(apres.width) || 0, h: parseFloat(apres.height) || 0, taille: parseFloat(getComputedStyle(el).fontSize) };
        }),
        sousTitre: document.getElementById("pageSubtitle").textContent
      }), CHIFFRES);
      for (const b of pendant.blocs) {
        expect(b.bloc, `${b.s} : pas de bloc pendant le chargement`).toBe(true);
        expect(b.texte, `${b.s} : un chiffre affiche avant les donnees`).toBe("");
        // A la taille d'un chiffre : ni un filet, ni un pave plus haut que la ligne.
        expect(b.h, `${b.s} : hauteur du bloc`).toBeGreaterThan(b.taille * 0.6);
        expect(b.h, `${b.s} : hauteur du bloc`).toBeLessThanOrEqual(b.taille);
        expect(b.l, `${b.s} : largeur du bloc`).toBeGreaterThan(b.taille * 0.9);
      }
      // Le sous-titre lit la tuile : il ne doit pas annoncer un compte qu'il n'a pas.
      expect(pendant.sousTitre).not.toMatch(/\d+ commandes? à préparer/);

      const avant = await releve(page);
      await chargementFini(page);
      await expect(page.locator("#opRevenue")).toHaveText(/€/);
      const apres = await releve(page);

      const sauts = REPERES.flatMap(s => {
        // Le panier moyen est aligne a DROITE : c'est son bord droit qui tient.
        const bord = s === "#opBasket" ? "droite" : "gauche";
        const dy = Math.abs(apres[s].haut - avant[s].haut), dx = Math.abs(apres[s][bord] - avant[s][bord]);
        // L'histogramme REMPLIT sa carte depuis le 24/09 (decision de Thomas,
        // carte-ca-remplie.spec.js) : sa hauteur suit la rangee, qui grandit
        // quand la carte de tournee arrive avec les donnees. Sa POSITION reste
        // jugee ici ; sa hauteur l'est ci-dessous (elle ne suit que la carte).
        const dh = s === "#revenueChart" ? 0 : Math.abs(apres[s].hauteur - avant[s].hauteur);
        return dy > 2 || dx > 2 || dh > 2
          ? [`${s} : ${Math.round(dy)} px en haut, ${Math.round(dx)} px de cote, ${Math.round(dh)} px de hauteur`] : [];
      });
      expect(sauts, "la page a saute a l'arrivee des donnees").toEqual([]);
      // L'histogramme ne change de hauteur QUE si sa carte en change autant (il
      // la remplit), et jamais sous les 150 px de la planche au bureau.
      const carte = await page.evaluate(() => Math.round(document.querySelector("#journee .tb-ca").getBoundingClientRect().height));
      const dhGraphe = Math.round(apres["#revenueChart"].hauteur - avant["#revenueChart"].hauteur);
      if (largeur > 920) {
        expect(apres["#revenueChart"].hauteur, "histogramme au moins a la hauteur de la planche").toBeGreaterThanOrEqual(150);
        const vide = await page.evaluate(() => {
          const c = document.querySelector("#journee .tb-ca"), g = document.getElementById("revenueChart");
          return Math.round(c.getBoundingClientRect().bottom - parseFloat(getComputedStyle(c).paddingBottom) - g.getBoundingClientRect().bottom);
        });
        expect(vide, `l'histogramme a change de ${dhGraphe} px sans remplir sa carte (${carte} px)`).toBeLessThanOrEqual(2);
      } else {
        expect(Math.abs(dhGraphe), "au telephone, l'histogramme a une hauteur fixe").toBeLessThanOrEqual(2);
      }
      await ctx.close();
    });
  }

  // Les lignes changent de FORME entre 821 et 1280 px : Commandes et Stock y
  // passent en carte a trois rangs (style.css, « la relecture »), et Commandes
  // l'est deja sous 920 px. Le premier jet ne mesurait qu'a 1440 et 390 px :
  // entre les deux, la ligne grise gardait 56 px pour une carte de 90 a 130 px,
  // et la liste sautait de 170 a 290 px a l'arrivee des donnees (relecture du
  // 23/09). 1280 est le bord haut de la plage, 880 est entre 821 et 920.
  for (const largeur of [1440, 1280, 1024, 880, 390]) {
    test(`une ligne grise a la hauteur d'une ligne réelle, à ${largeur} px`, async ({ browser }) => {
      test.setTimeout(180000);
      const ZONES = [["commandes", "#cmdLignes", ".cmd-ligne"], ["stock", "#stockList", ".stk-ligne"], ["crm", "#crmList", ":scope > *"]];
      const ecarts = [];
      for (const [ancre, zone, ligne] of ZONES) {
        const { ctx, page } = await auRalenti(browser, largeur, ancre);
        const grise = await page.evaluate(z => document.querySelector(`${z} .squelette-ligne`)?.getBoundingClientRect().height ?? 0, zone);
        expect(grise, `${zone} : aucune ligne grise pendant le chargement`).toBeGreaterThan(0);
        await chargementFini(page);
        const reelle = await page.evaluate(([z, l]) => document.querySelector(z).querySelector(l)?.getBoundingClientRect().height ?? 0, [zone, ligne]);
        expect(reelle, `${zone} : aucune ligne reelle -- rien a comparer`).toBeGreaterThan(0);
        if (Math.abs(grise - reelle) > 2) ecarts.push(`${zone} : ${Math.round(grise)} px gris pour ${Math.round(reelle)} px reels`);
        await ctx.close();
      }
      expect(ecarts).toEqual([]);
    });
  }
});

// --- Un libelle n'est pas un chiffre (relecture du 23/09) --------------------
//
// « Commandes livrees » (#opDelivered) est dans la liste des chiffres en
// attente : le rendu y ecrit « 12 commandes livrees ». Mais si /api/operations
// echoue, le rendu sort sans rien ecrire, et le premier jet remettait « — »
// dans tout element vide : la tuile montrait « — » au-dessus de « — », sans
// son nom. Le libelle doit revenir ; les vrais chiffres, eux, disent « — ».
test("tableau de bord en erreur : le libellé revient, les chiffres disent « — »", async ({ browser }) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.route("**/api/**", async route => {
    await new Promise(r => setTimeout(r, 800));
    if (new URL(route.request().url()).pathname === "/api/operations") {
      await route.fulfill({ status: 500, json: { error: "panne simulee" } });
      return;
    }
    route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Le squelette a bien ete pose (sinon le banc ne jugerait rien).
  await expect(page.locator("#opDelivered.squelette-chiffre")).toHaveCount(1, { timeout: 5000 });
  await page.waitForFunction(() => !document.querySelector('.squelette, .squelette-chiffre, [aria-busy="true"]'), null, { timeout: 30000 });
  await expect(page.locator("#opDelivered")).toHaveText("Commandes livrées");
  await expect(page.locator("#opRevenue")).toHaveText("—");
  await expect(page.locator("#opBasket")).toHaveText("—");
  await ctx.close();
});

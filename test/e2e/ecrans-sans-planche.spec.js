// E2E : les ecrans que les planches V8 ne dessinent pas -- Analyse (l'ancien
// « Statistiques »), Exports, Rappels, A recommander, et l'habillage de
// Commande client.
//
// Decision de Thomas (deleguee, 23/09) : pas de nouveau dessin. On leur
// APPLIQUE le systeme deja pose ailleurs -- cartes blanches sans trait colore a
// gauche, chiffres de la charte (tabular-nums), graphique plat aux couleurs de
// l'histogramme du tableau de bord, plus de « SEREO commercial » ni de
// progression affichee deux fois, et au telephone des filtres en pilules.
//
// Ce que ce banc distingue : chaque assertion lit un STYLE CALCULE ou un TEXTE
// rendu, sur un serveur seme (deux commandes livrees aujourd'hui : les chiffres,
// les barres et les rangs existent). Sur une base vide, le graphique n'aurait
// que des barres a zero et les rangs un etat vide : rien a mesurer.
//
// Et la dette 7 : les quatre anciennes listes de commandes, invisibles mais
// encore dans la page, en sont retirees ; leurs adresses redirigent toujours.

const { test, expect } = require("./tuiles");
const { demarrer, AUJOURDHUI } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3306 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

// Un rappel SERVI PAR LE BANC : le jeu seme n'en a pas, et une liste vide ne
// montrerait que l'etat vide -- la carte d'un rappel ne serait jamais mesuree.
const RAPPELS = [{
  id: "rel-1", clientId: "c-bellevue", datePrevue: AUJOURDHUI, motif: "Reprendre contact",
  status: "a_faire", commentaire: "Appeler avant midi"
}];

async function ouvrir(page, ecran, { largeur = 1440, schema = "light" } = {}) {
  await page.route("**/api/reminders", route => route.fulfill({ json: RAPPELS }));
  await page.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
  await page.setViewportSize({ width: largeur, height: 900 });
  await page.goto(`${srv.base}/#${ecran}`, { waitUntil: "networkidle" });
  await expect(page.locator(`#${ecran}`)).toHaveClass(/active/);
  await page.waitForTimeout(300);
}

// Les jetons resolus dans le theme courant : un element temoin lit la couleur.
async function jeton(page, nom) {
  return page.evaluate(n => {
    const t = document.createElement("span");
    t.style.color = `var(${n})`;
    document.body.appendChild(t);
    const c = getComputedStyle(t).color;
    t.remove();
    return c;
  }, nom);
}

// Le « trait colore a gauche » des anciennes cartes, sous toutes ses formes :
// une bordure gauche plus epaisse ou d'une autre couleur que les autres, une
// ombre interne, ou un pseudo-element etroit et colore.
// Rend une description du trait trouve, ou null.
async function traitsDe(page, selecteur) {
  return page.locator(selecteur).evaluateAll(els => {
    function traitGauche(el) {
      const cs = getComputedStyle(el);
      const px = v => parseFloat(v) || 0;
      const gauche = cs.borderLeftStyle === "none" ? 0 : px(cs.borderLeftWidth);
      const haut = cs.borderTopStyle === "none" ? 0 : px(cs.borderTopWidth);
      const droite = cs.borderRightStyle === "none" ? 0 : px(cs.borderRightWidth);
      if (gauche > Math.max(haut, droite) + 0.5) return `bordure gauche ${gauche}px (haut ${haut}px)`;
      if (gauche > 0 && cs.borderLeftColor !== cs.borderTopColor) return `bordure gauche ${cs.borderLeftColor} / haut ${cs.borderTopColor}`;
      if (/inset/.test(cs.boxShadow)) return `ombre interne : ${cs.boxShadow}`;
      for (const p of ["::before", "::after"]) {
        const ps = getComputedStyle(el, p);
        if (ps.content === "none" || ps.display === "none") continue;
        const colore = ps.backgroundColor !== "rgba(0, 0, 0, 0)" || ps.backgroundImage !== "none";
        const w = px(ps.width);
        if (colore && w > 0 && w <= 8) return `pseudo ${p} de ${w}px, ${ps.backgroundColor}`;
      }
      return null;
    }
    return els.map(el => ({ texte: (el.innerText || "").trim().slice(0, 40), trait: traitGauche(el) }));
  });
}

function contraste(a, b) {
  const lum = c => {
    const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (h + 0.05) / (l + 0.05);
}

for (const schema of ["light", "dark"]) {
  test(`Analyse (${schema}) : le titre de la passation, plus de bandeau en double`, async ({ page }) => {
    await ouvrir(page, "statistiques", { schema });
    // Le nom de la passation et de la barre laterale.
    await expect(page.locator("#pageTitle")).toHaveText("Analyse");
    await expect(page.locator("#tab-statistiques")).toHaveText("Analyse");
    // Le bandeau « SEREO commercial / Statistiques » et ses deux pilules
    // repetaient le titre et les tuiles : retire.
    await expect(page.locator("#statistiques")).not.toContainText("SEREO commercial");
    await expect(page.locator("#statistiques .stats-hero")).toHaveCount(0);
    // L'evolution de la semaine et celle du mois : UNE fois chacune, dans leur
    // tuile (l'ancien ecran les montrait quatre fois, deux sans dire laquelle).
    const texte = await page.locator("#statistiques").innerText();
    const evolutions = texte.match(/(progression|baisse) [+-]?\d+%|Stable/g) || [];
    expect(evolutions, texte).toHaveLength(2);
    await expect(page.locator("#statsKpis .stat-tile", { hasText: "semaine" })).toContainText(/progression|baisse|Stable/);
    await expect(page.locator("#statsKpis .stat-tile", { hasText: "du mois" })).toContainText(/progression|baisse|Stable/);
  });

  test(`Analyse (${schema}) : des cartes blanches, des chiffres de la charte`, async ({ page }) => {
    await ouvrir(page, "statistiques", { schema });
    const surface = await jeton(page, "--v8-surface");
    const tuiles = page.locator("#statsKpis .stat-tile");
    await expect(tuiles).toHaveCount(6);
    for (const { texte, trait } of await traitsDe(page, "#statsKpis .stat-tile")) {
      expect.soft(trait, `tuile « ${texte} »`).toBeNull();
    }
    const styles = await tuiles.evaluateAll(els => els.map(el => {
      const point = el.querySelector(":scope > i");
      const cs = getComputedStyle(el);
      return {
        fond: cs.backgroundColor,
        image: cs.backgroundImage,
        chiffres: getComputedStyle(el.querySelector("strong")).fontVariantNumeric,
        point: point ? getComputedStyle(point).display : "none"
      };
    }));
    for (const s of styles) {
      expect.soft(s.fond, "fond de tuile").toBe(surface);
      expect.soft(s.image, "degrade de tuile").toBe("none");
      expect.soft(s.chiffres, "chiffres alignes").toContain("tabular-nums");
      // Le point colore du coin : un code couleur sans legende.
      expect.soft(s.point, "point colore").toBe("none");
    }
  });

  test(`Analyse (${schema}) : l'histogramme a le rendu de celui du tableau de bord`, async ({ page }) => {
    await ouvrir(page, "statistiques", { schema });
    const principal = await jeton(page, "--v8-principal");
    const accent = await jeton(page, "--v8-accent-donnee");
    const graphe = page.locator("#salesChart");
    // Ni grille ni fond degrade derriere les barres.
    expect.soft(await graphe.evaluate(el => getComputedStyle(el).backgroundImage)).toBe("none");
    const barres = await page.locator("#salesChart .bar-item > span").evaluateAll(els => els.map(el => {
      const cs = getComputedStyle(el);
      return { image: cs.backgroundImage, couleur: cs.backgroundColor, rayon: cs.borderTopLeftRadius };
    }));
    expect(barres).toHaveLength(14);
    barres.forEach((b, i) => {
      expect.soft(b.image, `barre ${i} : degrade`).toBe("none");
      // Aujourd'hui, la derniere barre : l'accent de donnee, comme le mois
      // courant du tableau de bord ; les autres, le principal.
      expect.soft(b.couleur, `barre ${i}`).toBe(i === barres.length - 1 ? accent : principal);
    });
    // L'etiquette d'un jour tient sur une ligne (« 09- / 10 » se cassait).
    const etiquettes = await page.locator("#salesChart .bar-item small").evaluateAll(els => els
      .filter(el => getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none")
      .map(el => ({ texte: el.textContent, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).fontSize) * 1.7 })));
    expect(etiquettes.length).toBeGreaterThan(0);
    for (const e of etiquettes) expect.soft(e.h, `etiquette « ${e.texte} »`).toBeLessThanOrEqual(e.lh);
    // Les rangs : une jauge plate au principal, pas un degrade corail-vert.
    const jauges = await page.locator("#statistiques .rank-row > i").evaluateAll(els => els.map(el => ({
      image: getComputedStyle(el).backgroundImage, couleur: getComputedStyle(el).backgroundColor
    })));
    expect(jauges.length).toBeGreaterThan(0);
    for (const j of jauges) {
      expect.soft(j.image, "jauge de rang : degrade").toBe("none");
      expect.soft(j.couleur, "jauge de rang").toBe(principal);
    }
    for (const { texte, trait } of await traitsDe(page, "#statistiques .rank-row")) {
      expect.soft(trait, `rang « ${texte} »`).toBeNull();
    }
    const montants = await page.locator("#statistiques .rank-row > em").evaluateAll(els => els.map(el => getComputedStyle(el).fontVariantNumeric));
    for (const m of montants) expect.soft(m, "montant de rang").toContain("tabular-nums");
  });

  test(`Exports, Rappels, À recommander, Commande client (${schema}) : aucune carte à trait coloré`, async ({ page }) => {
    const surface = async () => jeton(page, "--v8-surface");
    const cas = [
      ["exports", "#exportsList > article"],
      ["relances", "#relanceList > article"],
      ["recommande", "#recommandeList > article"],
      ["commande-client", "#customerCatalog .product-card"],
      ["commande-client", "#customerCart .empty-state"]
    ];
    let premier = true;
    for (const [ecran, selecteur] of cas) {
      if (premier) { await ouvrir(page, ecran, { schema }); premier = false; } else {
        await page.evaluate(e => { location.hash = `#${e}`; }, ecran);
        await expect(page.locator(`#${ecran}`)).toHaveClass(/active/);
      }
      await expect(page.locator(selecteur).first(), selecteur).toBeVisible();
      for (const { texte, trait } of await traitsDe(page, selecteur)) {
        expect.soft(trait, `${selecteur} « ${texte} »`).toBeNull();
      }
      const fonds = await page.locator(selecteur).evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
      for (const f of fonds) expect.soft(f, `${selecteur} : fond`).toBe(await surface());
    }
    // Les gestes d'un rappel (Fait, Reporte, Annule) : plus de degrade, et un
    // texte lisible sur ce qui est reellement dessous (le bouton plein, ou la
    // carte pour un bouton a contour).
    await page.evaluate(() => { location.hash = "#relances"; });
    await expect(page.locator("#relances")).toHaveClass(/active/);
    const fondCarte = await surface();
    const gestes = await page.locator("#relanceList .card-actions .button").evaluateAll(els => els.map(el => {
      const cs = getComputedStyle(el);
      return { texte: el.textContent.trim(), image: cs.backgroundImage, fond: cs.backgroundColor, couleur: cs.color };
    }));
    expect(gestes).toHaveLength(3);
    for (const g of gestes) {
      expect.soft(g.image, `geste « ${g.texte} » : degrade`).toBe("none");
      const dessous = g.fond === "rgba(0, 0, 0, 0)" ? fondCarte : g.fond;
      expect.soft(contraste(g.couleur, dessous), `geste « ${g.texte} » : ${g.couleur} / ${dessous}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test(`au téléphone (${schema}) : les filtres sont des pilules, pas des boutons pleine largeur`, async ({ page }) => {
    // Les filtres sont des pilules a leur largeur, plusieurs par rangee. Les
    // trois exports sont des GESTES (un telechargement chacun), pas des
    // filtres : on exige seulement qu'ils ne s'etirent plus sur la rangee
    // entiere -- « Commandes planifiees » fait ~200 px a 14 px, deux ne
    // tiennent pas cote a cote sur 328.
    const cas = [
      ["relances", "#relances .recommend-toolbar .button", 5, "filtre"],
      ["recommande", "#recommande .recommend-toolbar .button", 3, "filtre"],
      ["exports", "#exports .export-actions .button", 3, "geste"]
    ];
    let premier = true;
    for (const [ecran, selecteur, n, nature] of cas) {
      if (premier) { await ouvrir(page, ecran, { schema, largeur: 390 }); premier = false; } else {
        await page.evaluate(e => { location.hash = `#${e}`; }, ecran);
        await expect(page.locator(`#${ecran}`)).toHaveClass(/active/);
      }
      // L'en-tete vert du cadre mobile (deja pose par le lot 1) : un temoin.
      const entete = await page.locator("main.content > .ecran-entete").evaluate(el => getComputedStyle(el).backgroundColor);
      expect.soft(entete, `${ecran} : en-tete`).toBe(await jeton(page, "--v8-carte-tournee"));
      const boutons = page.locator(selecteur);
      await expect(boutons).toHaveCount(n);
      const mesures = await boutons.evaluateAll(els => els.map(el => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const rangee = el.parentElement.getBoundingClientRect();
        return {
          texte: el.textContent.trim(), l: r.width, h: r.height, haut: Math.round(r.top), rangee: rangee.width,
          rayon: parseFloat(cs.borderTopLeftRadius), fond: cs.backgroundColor, couleur: cs.color
        };
      }));
      for (const m of mesures) {
        const limite = nature === "filtre" ? m.rangee * 0.6 : m.rangee - 40;
        expect.soft(m.l, `${ecran} « ${m.texte} » : largeur`).toBeLessThan(limite);
        expect.soft(m.h, `${ecran} « ${m.texte} » : hauteur`).toBeGreaterThanOrEqual(44);
        expect.soft(m.rayon, `${ecran} « ${m.texte} » : pilule`).toBeGreaterThanOrEqual(m.h / 2 - 1);
        expect.soft(contraste(m.couleur, m.fond), `${ecran} « ${m.texte} » : contraste ${m.couleur} / ${m.fond}`).toBeGreaterThanOrEqual(4.5);
      }
      // Une seule hauteur (pas de pilule de 44 a cote d'une de 48) ; et des
      // filtres PARTAGEANT leurs rangees : jamais un par ligne.
      expect.soft(new Set(mesures.map(m => Math.round(m.h))).size, `${ecran} : hauteurs`).toBe(1);
      if (nature === "filtre") {
        expect.soft(new Set(mesures.map(m => m.haut)).size, `${ecran} : rangees`).toBeLessThan(n);
      }
      // Le compte d'un en-tete de carte ne s'etire pas sur toute la carte.
      const pastille = page.locator(`#${ecran} .panel-heading .status-chip`);
      if (await pastille.count()) {
        const [l, carte] = await pastille.first().evaluate(el => [el.getBoundingClientRect().width, el.closest(".panel").getBoundingClientRect().width]);
        expect.soft(l, `${ecran} : pastille du compte`).toBeLessThan(carte * 0.6);
      }
    }
    // A recommander : les quatre chiffres d'un produit tiennent dans leur case.
    await page.evaluate(() => { location.hash = "#recommande"; });
    await expect(page.locator("#recommande")).toHaveClass(/active/);
    const debords = await page.locator("#recommandeList .stock-kpis > span").evaluateAll(els => els
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.trim()));
    expect.soft(debords, "cases qui debordent").toEqual([]);
  });

  test(`au téléphone (${schema}) : la pilule choisie se dit, et l'anneau clavier se voit`, async ({ page }) => {
    await ouvrir(page, "relances", { schema, largeur: 390 });
    const pilule = page.locator('#relances [data-relance-filter="late"]');
    await pilule.click();
    await expect(pilule).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#relances [data-relance-filter="today"]')).toHaveAttribute("aria-pressed", "false");
    // La choisie est pleine : fond different des autres.
    // Le pointeur quitte la rangee : on mesure l'etat au repos, pas le survol.
    await page.mouse.move(0, 0);
    // Le fond est anime (transition des boutons) : on attend qu'il se pose.
    await expect.poll(async () => {
      const fonds = await page.locator("#relances .recommend-toolbar .button").evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
      return new Set(fonds).size;
    }).toBe(2);
    // Clavier : l'anneau (contour ou ombre) est visible sur la pilule.
    await page.locator('#relances [data-relance-filter="week"]').focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const anneau = await page.locator('#relances [data-relance-filter="week"]').evaluate(el => {
      const cs = getComputedStyle(el);
      return { focus: el.matches(":focus-visible"), contour: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0, ombre: cs.boxShadow };
    });
    expect(anneau.focus).toBe(true);
    expect(anneau.contour || anneau.ombre !== "none", JSON.stringify(anneau)).toBe(true);
  });
}

test("Analyse : l'ancien nom « Statistiques » mène encore à l'écran par la recherche du menu", async ({ page }) => {
  // Le titre est devenu « Analyse » : sans ANCIENS_NOMS, un utilisateur qui
  // tape le nom qu'il connaissait ne trouverait plus rien.
  await ouvrir(page, "journee");
  await page.fill("#menuSearch", "statistiques");
  await page.press("#menuSearch", "Enter");
  await expect(page.locator("#statistiques")).toHaveClass(/active/);
  await expect(page.locator("#pageTitle")).toHaveText("Analyse");
});

test("dette 7 : les quatre anciennes listes ont quitté la page, leurs adresses redirigent", async ({ page }) => {
  await ouvrir(page, "commandes");
  const presentes = await page.evaluate(() => ["commandes-jour", "commandes-planifiees", "bons-commande", "commandes-livrees",
    "todayOrdersList", "plannedOrdersList", "bdc-list", "commandesLivreesList"]
    .filter(id => document.getElementById(id)));
  expect(presentes).toEqual([]);
  // GARDE : la fenetre de detail d'une commande vivait entre deux de ces
  // sections ; c'est celle de l'ecran Commandes.
  await expect(page.locator("#bdc-detail-modal")).toHaveCount(1);
  await page.locator("#cmdLignes [data-cmd-ouvrir]").first().click();
  await expect(page.locator("#bdc-detail-modal")).toHaveAttribute("aria-hidden", "false");
  await page.keyboard.press("Escape");
  // Les anciennes adresses arrivent sur l'ecran unique, filtre.
  for (const [ancien, filtre] of [["commandes-jour", "a-envoyer"], ["commandes-livrees", "livrees"]]) {
    await page.evaluate(h => { location.hash = `#${h}`; }, ancien);
    await expect(page.locator("#commandes")).toHaveClass(/active/);
    await expect(page.locator(`[data-cmd-filtre="${filtre}"]`)).toHaveClass(/active-filter/);
  }
});

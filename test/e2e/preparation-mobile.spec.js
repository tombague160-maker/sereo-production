// LA PREPARATION AU TELEPHONE -- planches 7a (la liste) et 7b (une commande),
// posees le 23/09.
//
// Decision de Thomas : au telephone, la Preparation devient UNE liste unique
// avec des mots de statut (au lieu de quatre groupes dont le titre portait le
// statut) ; les pilules de filtre passent dans l'en-tete vert ; le detail
// d'une commande suit la planche 7b (une page, pas un sheet).
// Mesure du 23/09, avant : quatre sections « A preparer / En cours / Pretes
// livraison / Bloquees stock », les pilules et la recherche dans un panneau
// blanc SOUS l'en-tete, et un sheet a trois boutons dont deux grises sans
// raison.
//
// Au bureau, rien ne change : preparation-lignes.spec.js le tient, et le
// dernier cas de ce fichier verifie que franchir 820 px rend les groupes.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, CLIENTS, AUJOURDHUI } = require("./serveur-seme");

const MOBILE = { width: 390, height: 844 };
const TOL = 1;

// En serie : le geste « Passer en preparation » ECRIT sur le serveur seme, et
// vient apres les cas qui lisent l'etat seme.
test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3176 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, base, { viewport = MOBILE, colorScheme = "light", avantChargement = null } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme });
  if (avantChargement) await ctx.addInitScript(avantChargement);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(base + "/#preparation", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

function hex(chaine) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(chaine || "");
  return m ? "#" + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, "0")).join("").toUpperCase() : null;
}

/** Contraste WCAG entre deux couleurs calculees (opaques). */
function contraste(a, b) {
  const lum = c => {
    const [r, g, bl] = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c).slice(1).map(v => {
      const s = +v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Les lignes de la liste, dans l'ordre de l'ecran. */
function lireLignes(page) {
  return page.evaluate(() => [...document.querySelectorAll("#preparationList .commande-ligne")].map(l => {
    const corps = l.querySelector(".commande-ligne-corps");
    const point = l.querySelector(".prep-point");
    const badge = l.querySelector(".pill");
    const detail = corps.querySelector("span");
    return {
      nom: corps.querySelector("strong").textContent.trim(),
      detail: detail.textContent.trim(), detailCouleur: getComputedStyle(detail).color,
      mot: badge.textContent.trim(), badgeFond: getComputedStyle(badge).backgroundColor, badgeTexte: getComputedStyle(badge).color,
      point: point ? { w: Math.round(point.getBoundingClientRect().width), fond: getComputedStyle(point).backgroundColor } : null,
      h: Math.round(l.getBoundingClientRect().height),
      carte: getComputedStyle(l.closest(".prep-liste") || l).backgroundColor
    };
  }));
}

test("7a — UNE liste, triee par statut, chaque ligne dit son statut en toutes lettres", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const r = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const t = n => cs.getPropertyValue(n).trim().toUpperCase();
    return {
      groupes: document.querySelectorAll("#preparationList .commandes-groupe").length,
      listes: document.querySelectorAll("#preparationList .prep-liste").length,
      tokens: { alerte: t("--v8-alerte"), accent: t("--v8-accent"), secondaire: t("--v8-texte-secondaire"), principal: t("--v8-principal") }
    };
  });
  const lignes = await lireLignes(page);
  expect(erreurs).toEqual([]);
  console.log(`[7a] ${lignes.map(l => `${l.mot} (${l.h}px)`).join(" · ")}`);

  expect(r.groupes, "plus aucun groupe au telephone").toBe(0);
  expect(r.listes, "une seule liste").toBe(1);
  // Le tri de la planche : bloquees, en preparation, a preparer, pret livraison.
  expect(lignes.map(l => l.mot)).toEqual(["Bloquée", "En préparation", "À préparer", "Prêt livraison"]);
  expect(lignes.map(l => l.nom)).toEqual(["Clinique Vétérinaire du Doubs", "Pharmacie Centrale de la Gare", "Cabinet Infirmier Dupont-Lefebvre", "EHPAD Résidence Bellevue"]);
  // Le point d'etat de 10 px, a la couleur du statut.
  expect(lignes.map(l => l.point && l.point.w)).toEqual([10, 10, 10, 10]);
  expect(lignes.map(l => hex(l.point.fond))).toEqual([r.tokens.alerte, r.tokens.accent, r.tokens.secondaire, r.tokens.principal]);
  // Le manque en ARTICLES (5 gants), en alerte ; les autres « ville · n articles » (quantites).
  expect(lignes[0].detail).toBe("Il manque 5 articles");
  expect(hex(lignes[0].detailCouleur)).toBe(r.tokens.alerte);
  expect(lignes[2].detail).toBe("Besançon · 6 articles");
  // 72 px (la planche), 96 au plus quand le nom passe a deux lignes.
  expect(lignes.filter(l => l.h < 72 - TOL || l.h > 96 + TOL).map(l => `${l.nom} : ${l.h}`)).toEqual([]);
  // Chaque mot se lit sur son badge (>= 4,5:1).
  expect(lignes.filter(l => contraste(l.badgeTexte, l.badgeFond === "rgba(0, 0, 0, 0)" ? l.carte : l.badgeFond) < 4.5).map(l => l.mot)).toEqual([]);
  await ctx.close();
});

test("7a — les pilules et la loupe dans l'EN-TETE VERT ; la recherche se deplie et se referme vide", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const r = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const t = n => cs.getPropertyValue(n).trim().toUpperCase();
    const entete = document.querySelector("main.content > .ecran-entete");
    const pilules = [...document.querySelectorAll("#preparationSectorPills .filtre-pilule")];
    const loupe = document.getElementById("preparationLoupe");
    const lb = loupe.getBoundingClientRect(), eb = entete.getBoundingClientRect();
    const titre = document.getElementById("pageTitle").getBoundingClientRect();
    return {
      dansEntete: entete.contains(document.getElementById("preparationSectorPills")),
      enteteFond: getComputedStyle(entete).backgroundColor, carteTournee: t("--v8-carte-tournee"),
      surface: t("--v8-surface"), surVert: t("--v8-surface-sur-vert"),
      pilules: pilules.map(p => ({ texte: p.textContent.trim(), fond: getComputedStyle(p).backgroundColor, couleur: getComputedStyle(p).color, h: Math.round(p.getBoundingClientRect().height), presse: p.getAttribute("aria-pressed") })),
      loupe: { visible: loupe.checkVisibility(), w: Math.round(lb.width), h: Math.round(lb.height), droite: Math.round(eb.right - lb.right), haut: Math.round(lb.top), titreHaut: Math.round(titre.top), titreDroite: Math.round(titre.right) },
      rechercheVisible: document.getElementById("preparationSearch").checkVisibility(),
      titrePanneau: document.querySelector("#preparation .panel-heading").checkVisibility(),
      sousTitre: document.getElementById("pageSubtitle").textContent.trim()
    };
  });
  expect(erreurs).toEqual([]);
  console.log(`[7a/en-tete] pilules ${r.pilules.map(p => `${p.texte} ${p.h}`).join(", ")} · loupe ${r.loupe.w}x${r.loupe.h} · « ${r.sousTitre} »`);

  expect(hex(r.enteteFond)).toBe(r.carteTournee);
  expect(r.dansEntete, "les pilules doivent etre DANS l'en-tete vert").toBe(true);
  expect(r.pilules.map(p => p.texte)).toEqual(["Tous", "Besançon", "Champagnole", "Dole"]);
  expect(r.pilules.map(p => p.presse)).toEqual(["true", "false", "false", "false"]);
  // La choisie en blanc, les autres sur la surface verte (planche 7a).
  expect(r.pilules.map(p => hex(p.fond))).toEqual([r.surface, r.surVert, r.surVert, r.surVert]);
  expect(r.pilules.filter(p => contraste(p.couleur, p.fond) < 4.5).map(p => p.texte)).toEqual([]);
  expect(r.pilules.filter(p => p.h < 44).map(p => p.texte)).toEqual([]);
  // La loupe : 44 px, en haut a droite, sur la ligne du titre.
  expect(r.loupe.visible).toBe(true);
  expect([r.loupe.w, r.loupe.h]).toEqual([44, 44]);
  expect(r.loupe.droite).toBe(20);
  expect(Math.abs(r.loupe.haut - r.loupe.titreHaut), "la loupe sur la ligne du titre").toBeLessThanOrEqual(12);
  expect(r.loupe.titreDroite, "le titre ne passe pas sous la loupe").toBeLessThan(390 - 20 - 44);
  expect(r.rechercheVisible, "la recherche est repliee derriere la loupe").toBe(false);
  expect(r.titrePanneau, "le titre du panneau redisait celui de l'en-tete").toBe(false);
  expect(r.sousTitre).toBe("3 commandes à préparer");

  // La loupe deplie la recherche et y met le focus ; la recherche filtre.
  await page.locator("#preparationLoupe").click();
  expect(await page.locator("#preparationLoupe").getAttribute("aria-expanded")).toBe("true");
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("preparationSearch");
  await page.keyboard.type("Pharma");
  await page.waitForTimeout(600);
  expect((await lireLignes(page)).map(l => l.nom)).toEqual(["Pharmacie Centrale de la Gare"]);
  // Refermer la loupe efface la recherche : aucune commande cachee sans le dire.
  await page.locator("#preparationLoupe").click();
  await page.waitForTimeout(300);
  expect(await page.locator("#preparationSearch").inputValue()).toBe("");
  expect((await lireLignes(page)).length).toBe(4);
  // Une pilule filtre, et reste choisie.
  await page.locator("#preparationSectorPills .filtre-pilule", { hasText: "Besançon" }).click();
  await page.waitForTimeout(300);
  expect((await lireLignes(page)).map(l => l.mot)).toEqual(["Bloquée", "À préparer"]);

  // Sur un autre ecran, les filtres de la Preparation quittent l'en-tete.
  await page.locator("nav.mobile-tabbar .mobile-tab[data-tab=\"livreur\"]").click();
  await page.waitForTimeout(400);
  expect(await page.locator("#preparationFiltres").isVisible()).toBe(false);
  expect(await page.locator("#preparationLoupe").isVisible()).toBe(false);
  await page.locator("nav.mobile-tabbar .mobile-tab[data-tab=\"preparation\"]").click();
  await page.waitForTimeout(400);
  expect(await page.locator("#preparationLoupe").isVisible()).toBe(true);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

test("7a — en SOMBRE : la pilule choisie en plein clair, les mots lisibles", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base, { colorScheme: "dark" });
  const r = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const t = n => cs.getPropertyValue(n).trim().toUpperCase();
    const p = document.querySelector("#preparationSectorPills .filtre-pilule[aria-pressed=\"true\"]");
    return { fond: getComputedStyle(p).backgroundColor, couleur: getComputedStyle(p).color, principal: t("--v8-principal"), sombre: document.documentElement.dataset.colorScheme || "" };
  });
  const lignes = await lireLignes(page);
  expect(erreurs).toEqual([]);
  console.log(`[7a/sombre] ${r.sombre} · pilule ${hex(r.fond)} sur ${hex(r.couleur)}`);
  expect(hex(r.fond)).toBe(r.principal);
  expect(contraste(r.couleur, r.fond)).toBeGreaterThanOrEqual(4.5);
  expect(lignes.filter(l => contraste(l.badgeTexte, l.badgeFond === "rgba(0, 0, 0, 0)" ? l.carte : l.badgeFond) < 4.5).map(l => l.mot)).toEqual([]);
  expect(lignes.filter(l => contraste(l.detailCouleur, l.carte) < 4.5).map(l => l.detail)).toEqual([]);
  await ctx.close();
});

test("7b — la ligne ouvre une PAGE : en-tete vert, retour, produits, manque en clair, bouton qui dit pourquoi", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  await page.locator("#preparationList .commande-ligne", { hasText: "Clinique Vétérinaire" }).locator(".commande-ligne-main").click();
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const t = n => cs.getPropertyValue(n).trim().toUpperCase();
    const d = document.getElementById("commandeDetailDialog");
    const b = d.getBoundingClientRect();
    const entete = d.querySelector(".sheet-entete");
    const retour = d.querySelector(".commande-page-retour");
    const bouton = d.querySelector(".commande-page-gestes .button");
    const raison = d.querySelector(".commande-page-raison");
    return {
      ouvert: d.open, cadre: [b.left, b.top, b.width, b.height].map(Math.round),
      enteteFond: getComputedStyle(entete).backgroundColor, carteTournee: t("--v8-carte-tournee"), alerte: t("--v8-alerte"),
      retour: retour.checkVisibility() ? [retour.getBoundingClientRect().width, retour.getBoundingClientRect().height].map(Math.round) : null,
      fermer: d.querySelector(".sheet-fermer").checkVisibility(), poignee: d.querySelector(".sheet-poignee").checkVisibility(),
      meta: document.getElementById("commandeDetailMeta").textContent.trim(),
      titre: document.getElementById("commandeDetailTitre").textContent.trim(),
      puces: [...d.querySelectorAll(".commande-page-puce")].map(p => p.textContent.trim()),
      produits: [...d.querySelectorAll(".commande-page-produit")].map(p => ({
        nom: p.querySelector("strong").textContent.trim(), sous: p.querySelector(".commande-page-produit-texte span").textContent.trim(),
        sousCouleur: getComputedStyle(p.querySelector(".commande-page-produit-texte span")).color,
        qte: p.querySelector(".commande-page-quantite").textContent.trim()
      })),
      // Lectures tolerantes : sans la page 7b, le banc doit rougir sur sa
      // premiere attente (le cadre), pas planter sur un element absent.
      compte: (d.querySelector(".commande-page-compte")?.textContent || "").replace(/\s+/g, " ").trim(),
      bouton: bouton ? { texte: bouton.textContent.trim(), desactive: bouton.disabled, decrit: bouton.getAttribute("aria-describedby"), bas: Math.round(bouton.getBoundingClientRect().bottom), h: Math.round(bouton.getBoundingClientRect().height) } : {},
      raison: raison ? { id: raison.id, texte: raison.textContent.trim(), couleur: getComputedStyle(raison).color, visible: raison.checkVisibility() } : null,
      date: !!d.querySelector("[data-delivery-date-input]"),
      itineraire: !!d.querySelector("[data-action=\"open-order-maps\"]")
    };
  });
  expect(erreurs).toEqual([]);
  console.log(`[7b] ${r.meta} · ${r.titre} · ${r.puces.join(" / ")} · ${r.compte} · « ${r.bouton.texte} » ${r.raison && r.raison.texte}`);
  expect(r.ouvert).toBe(true);
  // Une page : tout l'ecran, pas un sheet.
  expect(r.cadre).toEqual([0, 0, 390, 844]);
  expect(hex(r.enteteFond)).toBe(r.carteTournee);
  expect(r.retour, "le retour de la planche, 44 px").toEqual([44, 44]);
  expect(r.fermer, "le ✕ du sheet n'est plus la").toBe(false);
  expect(r.poignee).toBe(false);
  expect(r.meta).toMatch(/^CMD-\d{4}-\d+ · \d{1,2} [a-zéû]+$/);
  expect(r.titre).toBe("Clinique Vétérinaire du Doubs");
  expect(r.puces).toEqual(["Besançon", "Bloquée"]);
  expect(r.compte).toBe("3 produits 11 articles");
  expect(r.produits.map(p => `${p.nom} ${p.qte}`)).toEqual(["Changes taille L 3", "Alèses 3", "Gants nitrile 5"]);
  // Le manque ecrit en clair, en alerte (planche : « 2 en stock, 2 manquants »).
  expect(r.produits[2].sous).toBe("0 en stock, 5 manquants");
  expect(hex(r.produits[2].sousCouleur)).toBe(r.alerte);
  // Jamais un bouton gris sans explication.
  expect(r.bouton.texte).toBe("Passer en préparation");
  expect(r.bouton.desactive).toBe(true);
  expect(r.raison && r.raison.visible).toBe(true);
  expect(r.raison.texte).toBe("Il manque 5 articles en stock pour commencer");
  expect(r.bouton.decrit).toBe(r.raison.id);
  expect(hex(r.raison.couleur)).toBe(r.alerte);
  expect(r.bouton.h).toBeGreaterThanOrEqual(48 - TOL);
  expect(r.bouton.bas, "le geste sous le pouce, dans l'ecran").toBeLessThanOrEqual(844);
  // Gardes, hors planche : la date de livraison et l'itineraire.
  expect(r.date).toBe(true);
  expect(r.itineraire).toBe(true);

  // Le retour ferme la page ; Echap aussi.
  await page.locator("#commandeDetailDialog .commande-page-retour").click();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.getElementById("commandeDetailDialog").open)).toBe(false);
  await page.locator("#preparationList .commande-ligne-main").first().click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.getElementById("commandeDetailDialog").open)).toBe(false);
  await ctx.close();
});

// Parcours simplifies (24/09) : la page NE SE FERME PLUS apres « Passer en
// preparation » ; elle offre « Preparation terminee » (parcours-simplifies-
// telephone.spec.js). On la ferme ici pour lire la liste.
test("7b — « Passer en preparation » depuis la page : elle reste ouverte, la ligne dit « En preparation » et remonte", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  await page.locator("#preparationList .commande-ligne", { hasText: "Cabinet Infirmier" }).locator(".commande-ligne-main").click();
  await page.waitForTimeout(400);
  const bouton = page.locator("#commandeDetailDialog .commande-page-gestes [data-action=\"start-preparation\"]");
  expect(await bouton.isEnabled()).toBe(true);
  await bouton.click();
  await page.waitForTimeout(1500);
  expect(erreurs).toEqual([]);
  expect(await page.evaluate(() => document.getElementById("commandeDetailDialog").open), "la page reste ouverte").toBe(true);
  expect(await page.locator("#commandeDetailDialog .commande-page-gestes .button").textContent()).toBe("Préparation terminée");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const lignes = await lireLignes(page);
  console.log(`[7b/action] ${lignes.map(l => `${l.nom.slice(0, 12)}=${l.mot}`).join(" · ")}`);
  expect(lignes.find(l => l.nom.startsWith("Cabinet Infirmier")).mot).toBe("En préparation");
  expect(lignes.map(l => l.mot)).toEqual(["Bloquée", "En préparation", "En préparation", "Prêt livraison"]);

  // Et sa page offre maintenant le geste suivant.
  await page.locator("#preparationList .commande-ligne", { hasText: "Cabinet Infirmier" }).locator(".commande-ligne-main").click();
  await page.waitForTimeout(400);
  expect(await page.locator("#commandeDetailDialog .commande-page-gestes .button").textContent()).toBe("Préparation terminée");
  await ctx.close();
});

test("franchir 820 px : au bureau les groupes et les filtres du panneau reviennent", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const lire = () => page.evaluate(() => ({
    groupes: document.querySelectorAll("#preparationList .commandes-groupe").length,
    liste: document.querySelectorAll("#preparationList .prep-liste").length,
    filtresDansPanneau: !!document.querySelector("#preparation .panel #preparationFiltres"),
    filtresVisibles: document.getElementById("preparationFiltres").checkVisibility(),
    loupe: document.getElementById("preparationLoupe").checkVisibility(),
    recherche: document.getElementById("preparationSearch").checkVisibility()
  }));
  expect(await lire()).toMatchObject({ groupes: 0, liste: 1, filtresDansPanneau: false, loupe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  const bureau = await lire();
  console.log(`[820] bureau : ${JSON.stringify(bureau)}`);
  // Trois ou quatre groupes : le cas precedent a passe « A preparer » en
  // preparation, sauf si ce cas est lance seul (-g).
  expect(bureau).toMatchObject({ liste: 0, filtresDansPanneau: true, filtresVisibles: true, loupe: false, recherche: true });
  expect(bureau.groupes).toBeGreaterThanOrEqual(3);
  await page.setViewportSize(MOBILE);
  await page.waitForTimeout(500);
  expect(await lire()).toMatchObject({ groupes: 0, liste: 1, filtresDansPanneau: false, loupe: true, recherche: false });
  expect(erreurs).toEqual([]);
  await ctx.close();
});

const BUREAU = { width: 1440, height: 900 };
const nomsDeLaListe = page => page.evaluate(() =>
  [...document.querySelectorAll("#preparationList .commande-ligne-corps strong")].map(s => s.textContent.trim()));

// Une recherche tapee au bureau, puis la rotation : sous 820 px la recherche
// est repliee derriere la loupe. Si elle restait repliee, la liste resterait
// filtree sans que rien ne le montre.
test("franchir 820 px avec une recherche tapee au bureau : la loupe la montre depliee", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base, { viewport: BUREAU });
  await page.locator("#preparationSearch").fill("Pharma");
  await page.waitForTimeout(600);
  expect(await nomsDeLaListe(page)).toEqual(["Pharmacie Centrale de la Gare"]);
  await page.setViewportSize(MOBILE);
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    visible: document.getElementById("preparationSearch").checkVisibility(),
    valeur: document.getElementById("preparationSearch").value,
    deplie: document.getElementById("preparationLoupe").getAttribute("aria-expanded"),
    focus: document.activeElement && document.activeElement.id
  }));
  console.log(`[820/recherche] ${JSON.stringify(r)}`);
  expect(await nomsDeLaListe(page)).toEqual(["Pharmacie Centrale de la Gare"]);
  expect(r.visible, "la liste est filtree : la recherche doit se voir").toBe(true);
  expect(r.valeur).toBe("Pharma");
  expect(r.deplie).toBe("true");
  expect(r.focus, "une rotation n'ouvre pas le clavier").not.toBe("preparationSearch");
  // Refermer la loupe l'efface, comme d'habitude.
  await page.locator("#preparationLoupe").click();
  await page.waitForTimeout(300);
  expect((await nomsDeLaListe(page)).length).toBeGreaterThan(1);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// La frappe attend 200 ms avant de filtrer. Refermer la loupe PENDANT cette
// attente : le filtre efface ne doit pas revenir quand le minuteur tombe.
test("refermer la loupe moins de 200 ms apres la frappe : la recherche ne revient pas", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base);
  const avant = (await nomsDeLaListe(page)).length;
  expect(avant).toBeGreaterThan(1);
  await page.evaluate(() => {
    document.getElementById("preparationLoupe").click();
    const champ = document.getElementById("preparationSearch");
    champ.value = "Pharma";
    champ.dispatchEvent(new Event("input", { bubbles: true }));
    // Dans la meme tache : bien avant les 200 ms du minuteur.
    document.getElementById("preparationLoupe").click();
  });
  await page.waitForTimeout(600);
  expect(await page.locator("#preparationSearch").inputValue()).toBe("");
  expect((await nomsDeLaListe(page)).length, "le minuteur a reapplique la recherche effacee").toBe(avant);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Safari < 14 : MediaQueryList sans addEventListener. Le module ne doit pas
// lever a son evaluation (sinon l'application entiere ne demarre pas), et le
// franchissement de 820 px doit encore etre entendu (addListener).
test("sans MediaQueryList.addEventListener (Safari < 14) : l'application demarre et entend 820 px", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base, {
    avantChargement: () => {
      Object.defineProperty(MediaQueryList.prototype, "addEventListener", { value: undefined, configurable: true, writable: true });
    }
  });
  expect(await page.evaluate(() => typeof MediaQueryList.prototype.addEventListener)).toBe("undefined");
  expect(erreurs).toEqual([]);
  expect(await page.evaluate(() => document.querySelectorAll("#preparationList .prep-liste").length)).toBe(1);
  await page.setViewportSize(BUREAU);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.querySelectorAll("#preparationList .commandes-groupe").length)).toBeGreaterThanOrEqual(3);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Le sous-titre-compte est celui de la planche 7a, qui est une planche
// TELEPHONE : au bureau, le sous-titre reste celui de tabs.js.
test("le sous-titre « N commandes a preparer » au telephone seulement ; le bureau garde le sien", async ({ browser }) => {
  test.setTimeout(180000);
  const GENERIQUE = "Contrôle le stock, prépare les commandes et les envoie en livraison.";
  const sousTitre = p => p.evaluate(() => document.getElementById("pageSubtitle").textContent.trim());
  const { ctx, page, erreurs } = await ouvrir(browser, srv.base, { viewport: BUREAU });
  expect(await sousTitre(page)).toBe(GENERIQUE);
  await page.setViewportSize(MOBILE);
  await page.waitForTimeout(500);
  expect(await sousTitre(page)).toMatch(/^(\d+ commandes? à préparer|Aucune commande à préparer)$/);
  await page.setViewportSize(BUREAU);
  await page.waitForTimeout(500);
  expect(await sousTitre(page)).toBe(GENERIQUE);
  expect(erreurs).toEqual([]);
  await ctx.close();
});

// Le tri a statut egal : par secteur, puis par numero de bon. Le seme courant
// n'a qu'une commande par statut : il ne distinguerait pas un tri absent.
test("7a — a statut egal, par secteur puis par numero ; « A verifier » a son mot", async ({ browser }) => {
  test.setTimeout(180000);
  const seed = jeuDeDonnees();
  const [tilleuls, , , ssiad] = CLIENTS;
  const base = seed.commandes.find(c => c.id === "o-10");
  seed.commandes.push(
    // Deux « en preparation » : Champagnole (o-7, deja la) et Besancon, ecrite APRES.
    { ...base, id: "o-11", clientId: tilleuls.id, clientName: tilleuls.nom, city: tilleuls.ville, address: tilleuls.rue, status: "en_preparation" },
    { ...base, id: "o-12", clientId: ssiad.id, clientName: ssiad.nom, city: ssiad.ville, address: ssiad.rue, status: "stock_a_verifier", dateCommande: AUJOURDHUI }
  );
  const autre = await demarrer({ port: 3182, seed });
  try {
    const { ctx, page, erreurs } = await ouvrir(browser, autre.base);
    const lignes = await lireLignes(page);
    expect(erreurs).toEqual([]);
    console.log(`[7a/tri] ${lignes.map(l => `${l.nom.slice(0, 14)}=${l.mot}`).join(" · ")}`);
    expect(lignes.map(l => l.mot)).toEqual(["Bloquée", "En préparation", "En préparation", "À préparer", "À vérifier", "Prêt livraison"]);
    // Besancon avant Champagnole, a statut egal -- quel que soit l'ordre d'ecriture.
    expect(lignes[1].nom).toBe("EHPAD Les Tilleuls du Val de Loue");
    expect(lignes[2].nom).toBe("Pharmacie Centrale de la Gare");
    // A preparer (Besancon) avant A verifier (Champagnole) : meme rang, secteur d'abord.
    expect(lignes[3].nom).toBe("Cabinet Infirmier Dupont-Lefebvre");
    await ctx.close();
  } finally {
    await autre.arreter();
  }
});

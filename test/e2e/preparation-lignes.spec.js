// UNE LIGNE PAR COMMANDE -- planche Preparation.png, mesuree sur des DONNEES.
//
// Charte §4 : « Ligne de liste (commande, abonnement, arret) : une ligne de
// 64-72 px, quatre informations maximum, etat porte par un point de couleur +
// un mot. » Et « Pilules de filtre (secteurs, statuts) : hauteur 44 px ».
// Planche : disque d'etat, nom, « ville · n articles » (ou « Il manque 2
// articles » pour une bloquee), badge ; pilules de secteur ; un resume avec
// un anneau. La ligne ouvre le detail, qui porte les actions.
//
// Mesure du 19/09, avant : quatre colonnes de cartes a ~12 informations et
// quatre commandes chacune, quatre « Rien ici » pour les colonnes vides, un
// <select> de secteur, et une legende aux pastilles V7.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

// « tablette » : entre 821 et 920 px, la liste garde ses groupes (bureau) et
// le detail reste un sheet colle au bas de l'ecran. Au telephone (sous
// 820 px), la decision du 23/09 en fait une liste unique et une page :
// preparation-mobile.spec.js.
const VUES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 }, tablette: { width: 900, height: 844 } };
const HAUTEUR_PILULE = { desktop: 44, mobile: 48, tablette: 44 };
const TOL = 1;

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3146 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, vue) {
  const ctx = await browser.newContext({ viewport: VUES[vue] });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(srv.base + "/#preparation", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

function hex(chaine) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(chaine || "");
  return m ? "#" + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, "0")).join("").toUpperCase() : null;
}

for (const vue of ["tablette", "desktop"]) {
  test(`planche Preparation — une LIGNE par commande, des PILULES de secteur, un RESUME, en ${vue}`, async ({ browser }) => {
    test.setTimeout(180000);
    const { ctx, page, erreurs } = await ouvrir(browser, vue);

    const r = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const token = n => cs.getPropertyValue(n).trim().toUpperCase();
      const lignes = [...document.querySelectorAll("#preparationList .commande-ligne")].map(l => {
        const main = l.querySelector(".commande-ligne-main");
        const corps = l.querySelector(".commande-ligne-corps");
        const titre = corps.querySelector("strong");
        const detail = corps.querySelector("span");
        const etat = l.querySelector(".etat-commande");
        return {
          nom: titre.textContent.trim().slice(0, 22),
          h: Math.round(l.getBoundingClientRect().height),
          lignesDeTitre: Math.round(titre.getBoundingClientRect().height / parseFloat(getComputedStyle(titre).lineHeight)),
          infos: main.children.length - 1 + corps.children.length,
          etatFond: getComputedStyle(etat).backgroundColor,
          etatTaille: Math.round(etat.getBoundingClientRect().width),
          detail: detail.textContent.trim(),
          detailCouleur: getComputedStyle(detail).color,
          mot: l.querySelector(".pill").textContent.trim(),
          bouton: main.tagName
        };
      });
      const sections = [...document.querySelectorAll("#preparationList .commandes-groupe")].map(s => {
        const b = s.getBoundingClientRect();
        return { titre: s.querySelector(".commandes-groupe-titre").textContent.replace(/\s+/g, " ").trim(), haut: Math.round(b.top), bas: Math.round(b.bottom) };
      });
      const conteneur = document.getElementById("preparationSectorPills").getBoundingClientRect().width;
      const pilules = [...document.querySelectorAll("#preparationSectorPills .filtre-pilule")].map(p => ({
        texte: p.textContent.trim(), h: Math.round(p.getBoundingClientRect().height), w: Math.round(p.getBoundingClientRect().width),
        rayon: Math.round(parseFloat(getComputedStyle(p).borderTopLeftRadius) || 0), presse: p.getAttribute("aria-pressed")
      }));
      const resume = document.querySelector("#preparationStats .preparation-resume");
      return {
        tokens: { vertClair: token("--v8-vert-clair"), pecheClaire: token("--v8-peche-claire"), alerte: token("--v8-alerte") },
        lignes, sections, pilules, conteneur,
        resume: resume ? resume.querySelector("div").textContent.replace(/\s+/g, " ").trim() : null,
        anneau: resume ? resume.querySelector(".preparation-anneau").getAttribute("aria-label") : null,
        selectRestant: !!document.getElementById("preparationSectorFilter"),
        pastillesV7: document.querySelectorAll("#preparation .dot").length
      };
    });

    expect(erreurs, "erreurs de page").toEqual([]);
    const { tokens } = r;
    console.log(`[preparation/${vue}] ${r.lignes.length} lignes ${r.lignes.map(l => l.h).join("/")} · ${r.sections.length} sections · pilules ${r.pilules.map(p => p.w + "x" + p.h).join(" ")} · ${r.resume}`);

    // LES LIGNES : quatre commandes a preparer, une ligne chacune, 64-72 px.
    expect(r.lignes.length).toBe(4);

    // LES SECTIONS : empilees, jamais cote a cote (avant : quatre colonnes).
    // Juge AVANT les hauteurs : en colonnes etroites les titres s'empilent
    // et les hauteurs rougiraient les premieres, pour la mauvaise ligne.
    expect(r.sections.map(s => s.titre)).toEqual(["À préparer 1", "En cours 1", "Prêtes livraison 1", "Bloquées stock 1"]);
    for (let i = 1; i < r.sections.length; i++) {
      expect(r.sections[i].haut, `la section ${i + 1} doit venir SOUS la ${i}`).toBeGreaterThanOrEqual(r.sections[i - 1].bas - TOL);
    }

    const horsCharte = r.lignes.filter(l => l.lignesDeTitre <= 1 && (l.h < 64 - TOL || l.h > 72 + TOL)).map(l => `${l.nom} : ${l.h}px`);
    const tropHautes = r.lignes.filter(l => l.lignesDeTitre > 1 && l.h > 96).map(l => `${l.nom} : ${l.h}px sur ${l.lignesDeTitre} lignes`);
    expect(horsCharte, "lignes hors 64-72 px").toEqual([]);
    expect(tropHautes).toEqual([]);
    expect(r.lignes.map(l => l.infos), "quatre informations par ligne").toEqual([4, 4, 4, 4]);
    expect(r.lignes.map(l => l.bouton), "la ligne est un vrai bouton (clavier compris)").toEqual(["BUTTON", "BUTTON", "BUTTON", "BUTTON"]);

    // L'ETAT : un disque de couleur + le mot de la planche.
    const parMot = Object.fromEntries(r.lignes.map(l => [l.mot, l]));
    expect(Object.keys(parMot).sort()).toEqual(["Bloquée", "En cours", "Prête", "À faire"].sort());
    expect(hex(parMot["À faire"].etatFond)).toBe(tokens.vertClair);
    expect(hex(parMot["Prête"].etatFond)).toBe(tokens.vertClair);
    expect(hex(parMot["En cours"].etatFond)).toBe(tokens.pecheClaire);
    expect(hex(parMot["Bloquée"].etatFond)).toBe(tokens.pecheClaire);
    expect(r.lignes.map(l => l.etatTaille)).toEqual([40, 40, 40, 40]);
    // Le manque REMPLACE le detail, en alerte -- « Il manque 2 articles ».
    // En ARTICLES, comme au telephone (audit du 23/09, defaut 11) : cinq gants
    // absents font « 5 articles », pas « 1 » (une ligne de produit). Et le
    // detail compte les quantites (2 produits x 3) : l'ancien motif « \d
    // articles » acceptait aussi bien 2 que 6, et ne distinguait rien.
    expect(parMot["Bloquée"].detail).toBe("Il manque 5 articles");
    expect(hex(parMot["Bloquée"].detailCouleur)).toBe(tokens.alerte);
    expect(parMot["À faire"].detail).toBe("Besançon · 6 articles");

    // LES PILULES : 44/48, rondes, et pas etirees sur la largeur.
    expect(r.pilules.map(p => p.texte)).toEqual(["Tous", "Besançon", "Champagnole", "Dole"]);
    expect(r.pilules.filter(p => Math.abs(p.h - HAUTEUR_PILULE[vue]) > TOL).map(p => `${p.texte} : ${p.h}`), "hauteur des pilules").toEqual([]);
    expect(r.pilules.filter(p => p.rayon < p.h / 2 - TOL).map(p => p.texte), "pilules aux coins carres").toEqual([]);
    expect(r.pilules.filter(p => p.w > r.conteneur * 0.6).map(p => `${p.texte} : ${p.w}px sur ${r.conteneur}`), "pilules etirees").toEqual([]);
    expect(r.pilules.map(p => p.presse)).toEqual(["true", "false", "false", "false"]);
    expect(r.selectRestant, "le <select> de secteur doit avoir disparu").toBe(false);

    // LE RESUME et la fin des pastilles V7.
    expect(r.resume).toBe("1 commande prête 3 restantes · 29 articles au total · 1 bloquée");
    expect(r.anneau).toBe("1 sur 4 prêtes");
    expect(r.pastillesV7).toBe(0);

    await ctx.close();
  });
}

test("la ligne OUVRE un sheet (coins 28, poignee sous 921 px) qui porte les actions ; Echap et ✕ le ferment", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, "tablette");
  await page.locator("#preparationList .commande-ligne-main").first().click();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const d = document.getElementById("commandeDetailDialog");
    const b = d.getBoundingClientRect();
    return {
      ouvert: d.open, rayon: getComputedStyle(d).borderTopLeftRadius, rayonBas: getComputedStyle(d).borderBottomLeftRadius,
      bas: Math.round(b.bottom), poignee: d.querySelector(".sheet-poignee").checkVisibility(),
      titre: document.getElementById("commandeDetailTitre").textContent.trim(),
      actions: [...d.querySelectorAll(".card-actions .button")].map(x => x.textContent.trim()),
      date: !!d.querySelector("[data-delivery-date-input]"),
      fermerCible: Math.round(d.querySelector(".sheet-fermer").getBoundingClientRect().width)
    };
  });
  expect(erreurs).toEqual([]);
  console.log(`[sheet/tablette] ${r.titre} · actions ${r.actions.join(" / ")} · bas ${r.bas}`);
  expect(r.ouvert).toBe(true);
  expect(r.rayon).toBe("28px");
  expect(r.rayonBas, "en mobile le sheet colle au bas de l'ecran, coins bas droits").toBe("0px");
  expect(Math.abs(r.bas - 844) <= 2, `le sheet doit toucher le bas : ${r.bas}`).toBe(true);
  expect(r.poignee).toBe(true);
  expect(r.actions).toEqual(["Passer en préparation", "Préparation terminée", "Itinéraire"]);
  expect(r.date).toBe(true);
  expect(r.fermerCible).toBeGreaterThanOrEqual(44 - TOL);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.getElementById("commandeDetailDialog").open), "Echap doit fermer").toBe(false);
  await page.locator("#preparationList .commande-ligne-main").first().click();
  await page.waitForTimeout(200);
  await page.locator("#commandeDetailDialog .sheet-fermer").click();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.getElementById("commandeDetailDialog").open), "✕ doit fermer").toBe(false);
  await ctx.close();
});

test("en desktop le sheet est centre, sans poignee", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page } = await ouvrir(browser, "desktop");
  await page.locator("#preparationList .commande-ligne-main").first().click();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const d = document.getElementById("commandeDetailDialog");
    const b = d.getBoundingClientRect();
    return { rayonBas: getComputedStyle(d).borderBottomLeftRadius, poignee: d.querySelector(".sheet-poignee").checkVisibility(), centre: Math.round(b.left + b.width / 2), bas: Math.round(b.bottom) };
  });
  expect(r.rayonBas).toBe("28px");
  expect(r.poignee).toBe(false);
  expect(Math.abs(r.centre - 720) <= 4, `centre horizontal : ${r.centre}`).toBe(true);
  expect(r.bas).toBeLessThan(900 - 40);
  await ctx.close();
});

test("« Passer en preparation » depuis le sheet : le sheet se ferme et la ligne change de mot", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, "tablette");
  const ligne = page.locator("#preparationList .commande-ligne", { hasText: "À faire" }).first();
  const nom = await ligne.locator("strong").textContent();
  await ligne.locator(".commande-ligne-main").click();
  await page.waitForTimeout(300);
  await page.locator("#commandeDetailDialog [data-action=\"start-preparation\"]").click();
  await page.waitForTimeout(1500);
  expect(erreurs).toEqual([]);
  expect(await page.evaluate(() => document.getElementById("commandeDetailDialog").open), "le sheet doit se fermer apres l'action").toBe(false);
  const mot = await page.locator("#preparationList .commande-ligne", { hasText: nom.trim() }).first().locator(".pill").textContent();
  console.log(`[sheet/action] ${nom.trim()} : ${mot.trim()}`);
  expect(mot.trim()).toBe("En cours");
  await ctx.close();
});

// « REPLIABLES PLUTOT QUE DEBORDANTES » -- la derniere regle de la charte §4
// qui restait NON JUGEE, faute de pouvoir la mesurer a vide.
//
// Mesure du 19/09 avec dix secteurs : la rangee prenait CINQ rangs, 272 px sur
// un ecran de 844 -- un tiers de l'ecran pour des filtres. Elle ne debordait
// pas horizontalement (elle passe a la ligne), mais elle n'etait pas repliable
// non plus. Plafond a deux rangs, et un bouton qui ne parait QUE si ca depasse.
// Assez de secteurs pour que la rangee deborde DANS LES DEUX VUES. A 1440 px,
// onze pilules tiennent en deux rangs : le plafond y serait invisible, et une
// mutation qui l'enleve survivrait -- c'est arrive.
const VILLES = ["Besancon", "Champagnole", "Dole", "Pontarlier", "Morteau",
  "Salins-les-Bains", "Arbois", "Lons-le-Saunier", "Saint-Claude", "Montbeliard",
  "Baume-les-Dames", "Ornans", "Quingey", "Maiche", "Valdahon", "Levier",
  "Nozeroy", "Poligny", "Mouchard", "Villers-le-Lac", "Le Russey", "Amancey",
  "Rougemont", "Clerval", "Isle-sur-le-Doubs", "Hericourt", "Lure", "Luxeuil"];

/** Une commande par secteur : c'est le nombre de SECTEURS qui fait la rangee. */
function semeMultiSecteurs() {
  const seed = jeuDeDonnees();
  const modele = seed.commandes.find(c => c.status === "importe") || seed.commandes[0];
  seed.commandes = VILLES.map((ville, i) => ({
    ...modele, id: `o-sect-${i}`, city: ville, sector: ville, status: "importe"
  }));
  seed.routes = [];
  return seed;
}

/** Le semé courant n'a que trois secteurs : la rangée n'y dépasse pas. */
test("le bouton de repli ne PARAÎT PAS quand la rangée ne dépasse pas", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, "mobile");
  const r = await page.evaluate(() => {
    const c = document.getElementById("preparationSectorPills");
    return { pilules: c.children.length, h: Math.round(c.getBoundingClientRect().height),
      deborde: c.scrollHeight - c.clientHeight, bouton: !document.getElementById("preparationSectorPlus").checkVisibility() };
  });
  expect(erreurs).toEqual([]);
  console.log(`[repli/sans débordement] ${r.pilules} pilules, ${r.h}px, bouton caché=${r.bouton}`);
  expect(r.deborde, "avec trois secteurs la rangée ne doit pas dépasser").toBe(0);
  expect(r.bouton, "un bouton de repli sur une rangée qui tient serait du bruit").toBe(true);
  await ctx.close();
});

// « tablette » (821-920 px) ajoutee le 23/09 : les pilules y font 44 px, mais
// le plafond etait celui du telephone (2 x 48 + 8 = 104) -- 8 px d'un
// troisieme rang depassaient sous les deux rangs promis.
for (const [vue, attendu] of [["mobile", { plafond: 104 }], ["desktop", { plafond: 96 }], ["tablette", { plafond: 96 }]]) {
  test(`charte §4 — avec dix secteurs, la rangée se REPLIE à deux rangs, en ${vue}`, async ({ browser }) => {
    test.setTimeout(180000);
    const nombreux = await demarrer({ port: vue === "mobile" ? 3154 : vue === "tablette" ? 3300 : 3155, seed: semeMultiSecteurs() });
    try {
      const ctx = await browser.newContext({ viewport: VUES[vue] });
      const page = await ctx.newPage();
      const erreurs = [];
      page.on("pageerror", e => erreurs.push(e.message));
      await page.goto(nombreux.base + "/#preparation", { waitUntil: "networkidle" });
      await page.waitForTimeout(900);

      const lire = () => page.evaluate(() => {
        const c = document.getElementById("preparationSectorPills");
        const b = document.getElementById("preparationSectorPlus");
        const rangs = new Set([...c.children].map(e => Math.round(e.getBoundingClientRect().top))).size;
        return { pilules: c.children.length, h: Math.round(c.getBoundingClientRect().height), rangs,
          coupe: c.scrollHeight - c.clientHeight, boutonVisible: b.checkVisibility(),
          texte: b.textContent.trim(), aria: b.getAttribute("aria-expanded"),
          hauteurBouton: Math.round(b.getBoundingClientRect().height) };
      });

      const avant = await lire();
      expect(erreurs).toEqual([]);
      console.log(`[repli/${vue}] ${avant.pilules} pilules : ${avant.h}px en ${avant.rangs} rang(s) visible(s), bouton=${avant.boutonVisible} « ${avant.texte} »`);
      expect(avant.pilules).toBe(VILLES.length + 1);
      // Le plafond : deux rangs, à la hauteur de pilule de la vue.
      expect(avant.h).toBe(attendu.plafond);
      expect(avant.coupe, "la rangée doit être coupée par le plafond").toBeGreaterThan(0);
      expect(avant.boutonVisible).toBe(true);
      expect(avant.texte).toBe("Tous les secteurs");
      expect(avant.aria).toBe("false");
      expect(avant.hauteurBouton).toBeGreaterThanOrEqual(44 - TOL);

      await page.locator("#preparationSectorPlus").click();
      await page.waitForTimeout(250);
      const apres = await lire();
      console.log(`[repli/${vue}] déplié : ${apres.h}px en ${apres.rangs} rangs`);
      expect(apres.h, "déplié, la rangée montre tout").toBeGreaterThan(avant.h);
      expect(apres.coupe, "déplié, plus rien n'est coupé").toBe(0);
      expect(apres.texte).toBe("Moins de secteurs");
      expect(apres.aria).toBe("true");

      // Et le contrôle qui compte : on choisit le DERNIER secteur (dernier
      // rang), puis on REPLIE. S'il restait à sa place, il disparaîtrait.
      const dernier = (await page.locator("#preparationSectorPills .filtre-pilule").last().textContent()).trim();
      await page.locator("#preparationSectorPills .filtre-pilule").last().click();
      await page.waitForTimeout(500);
      await page.locator("#preparationSectorPlus").click();
      await page.waitForTimeout(300);
      const choisi = await page.evaluate(() => {
        const c = document.getElementById("preparationSectorPills");
        const a = c.querySelector(".active-filter");
        return { texte: a.textContent.trim(), rang: [...c.children].indexOf(a),
          visible: a.getBoundingClientRect().bottom <= c.getBoundingClientRect().bottom + 1,
          replie: !c.classList.contains("filtre-pilules--depliee") };
      });
      console.log(`[repli/${vue}] « ${dernier} » choisi, replié : position ${choisi.rang}, visible=${choisi.visible}`);
      expect(choisi.texte).toBe(dernier);
      expect(choisi.replie, "la rangée doit bien s'être repliée").toBe(true);
      expect(choisi.rang, "le secteur choisi passe en tête, juste après « Tous »").toBe(1);
      expect(choisi.visible, "le filtre actif ne doit jamais être caché par le repli").toBe(true);
      await ctx.close();
    } finally {
      await nombreux.arreter();
    }
  });
}

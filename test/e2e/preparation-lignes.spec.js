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
const { demarrer } = require("./serveur-seme");

const VUES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const HAUTEUR_PILULE = { desktop: 44, mobile: 48 };
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

for (const vue of ["mobile", "desktop"]) {
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
    expect(parMot["Bloquée"].detail).toBe("Il manque 1 article");
    expect(hex(parMot["Bloquée"].detailCouleur)).toBe(tokens.alerte);
    expect(parMot["À faire"].detail).toMatch(/^Besançon · \d articles$/);

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

test("la ligne OUVRE un sheet (coins 28, poignee en mobile) qui porte les actions ; Echap et ✕ le ferment", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, "mobile");
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
  console.log(`[sheet/mobile] ${r.titre} · actions ${r.actions.join(" / ")} · bas ${r.bas}`);
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
  await page.locator(".sheet-fermer").click();
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
  const { ctx, page, erreurs } = await ouvrir(browser, "mobile");
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

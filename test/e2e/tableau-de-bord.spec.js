// LE TABLEAU DE BORD -- planche TableauDeBord.png, mesure sur des DONNEES.
//
// Deux choses de la planche manquaient : la carte « Tournee du jour » (fond
// vert, « 3 arrets sur 8 », la barre, le prochain arret, « Ouvrir la carte »)
// et les listes du tableau de bord, qui etaient des rangees a elles seules
// alors que la planche y montre LES MEMES LIGNES que la preparation.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

const VUES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const TOL = 1;

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => {
  // Un seme OU `faits` ET `rang` DIFFERENT : le dernier arret est livre alors
  // que le 3e est en cours. Sans cela, faits = rang = 3 et le banc ne
  // distinguerait pas une barre qui suit le rang d'une barre qui suit les
  // arrets termines -- une mutation l'a montre.
  const seed = jeuDeDonnees();
  seed.routes[0].stops[5].status = "livre";
  srv = await demarrer({ port: 3151, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, vue, base = srv.base) {
  const ctx = await browser.newContext({ viewport: VUES[vue] });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(base + "/#journee", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

function rgb(chaine) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(chaine || "");
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function hex(chaine) {
  const c = rgb(chaine);
  return c ? "#" + c.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase() : null;
}
function luminance([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contraste(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

for (const vue of ["desktop", "mobile"]) {
  test(`planche TableauDeBord — la carte TOURNÉE DU JOUR, lisible sur son fond vert, en ${vue}`, async ({ browser }) => {
    test.setTimeout(180000);
    const { ctx, page, erreurs } = await ouvrir(browser, vue);
    const r = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const token = n => cs.getPropertyValue(n).trim().toUpperCase();
      const c = document.getElementById("dashboardTournee");
      const s = el => el ? { texte: el.textContent.trim(), couleur: getComputedStyle(el).color, fond: getComputedStyle(el).backgroundColor } : null;
      const bouton = c.querySelector(".button");
      return {
        tokens: { principal: token("--v8-principal"), accent: token("--v8-accent"), surface: token("--v8-surface") },
        visible: c.checkVisibility(),
        fond: getComputedStyle(c).backgroundColor,
        titre: s(c.querySelector("h3")),
        statut: s(document.getElementById("dashboardTourneeStatut")),
        rang: s(document.getElementById("dashboardTourneeRang")),
        unite: s(document.getElementById("dashboardTourneeTotal")),
        barre: { largeur: document.getElementById("dashboardTourneeBarre").style.width, fond: getComputedStyle(document.getElementById("dashboardTourneeBarre")).backgroundColor },
        faits: [...document.querySelectorAll("#dashboardTourneeFaits li")].map(li => ({ texte: li.textContent.trim(), couleur: getComputedStyle(li).color })),
        bouton: { texte: bouton.textContent.trim(), couleur: getComputedStyle(bouton).color, fond: getComputedStyle(bouton).backgroundColor, h: Math.round(bouton.getBoundingClientRect().height), href: bouton.getAttribute("href") },
        aLivrerCache: !document.getElementById("dashboardDeliveringPanel").checkVisibility()
      };
    });
    expect(erreurs, "erreurs de page").toEqual([]);
    const { tokens } = r;
    console.log(`[tdb/${vue}] ${r.titre.texte} · ${r.statut.texte} · ${r.rang.texte} ${r.unite.texte} · barre ${r.barre.largeur} · ${r.faits.length} fait(s)`);

    expect(r.visible, "la carte Tournée du jour doit s'afficher quand une tournée existe").toBe(true);
    expect(hex(r.fond), "la carte est sur le vert principal").toBe(tokens.principal);
    expect(r.rang.texte).toBe("3");
    expect(r.unite.texte).toBe("arrêts sur 6");
    // La barre porte les arrêts TERMINÉS (4 sur 6 : deux livrés, un problème,
    // un dernier livré), PAS le rang de l'arrêt courant, qui vaut 3.
    expect(r.barre.largeur).toBe("67%");
    expect(hex(r.barre.fond), "la barre est en accent -- une forme, pas un texte").toBe(tokens.accent);
    expect(r.faits.map(f => f.texte.slice(0, 9))).toContain("Prochain ");
    expect(r.bouton.texte).toBe("Ouvrir la carte");
    expect(r.bouton.href).toBe("#livreur");
    expect(Math.abs(r.bouton.h - (vue === "mobile" ? 48 : 44)) <= TOL, `« Ouvrir la carte » : ${r.bouton.h}px`).toBe(true);
    // Charte §3 : « sur fond vert = fond blanc texte vert ».
    expect(hex(r.bouton.fond)).toBe(tokens.surface);
    expect(hex(r.bouton.couleur)).toBe(tokens.principal);
    // « À livrer » laisse la place : les deux occupent la même colonne.
    expect(r.aLivrerCache, "« À livrer » doit céder la place à la tournée").toBe(true);

    // TOUT le texte de la carte tient son seuil sur le vert -- c'est le piège
    // d'une carte à fond inversé : les règles génériques la repeignent en doux.
    const sous = [];
    for (const [nom, e] of [["titre", r.titre], ["rang", r.rang], ["unité", r.unite], ...r.faits.map((f, i) => [`fait ${i + 1}`, f])]) {
      const c = contraste(rgb(e.couleur), rgb(r.fond));
      if (c < 4.5) sous.push(`${nom} : ${c.toFixed(2)}:1 « ${e.texte.slice(0, 30)} »`);
    }
    const cStatut = contraste(rgb(r.statut.couleur), rgb(r.statut.fond));
    if (cStatut < 4.5) sous.push(`statut : ${cStatut.toFixed(2)}:1`);
    expect(sous, "textes sous 4,5:1 sur la carte verte").toEqual([]);

    await ctx.close();
  });
}

test("les listes du tableau de bord sont les MÊMES lignes qu'ailleurs, avec leur disque d'état", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, "desktop");
  const r = await page.evaluate(() => {
    const lignes = [...document.querySelectorAll("#dashboardPreparing .commande-ligne, #dashboardDelivering .commande-ligne")].map(l => ({
      nom: l.querySelector("strong").textContent.trim().slice(0, 22),
      disque: !!l.querySelector(".etat-commande"),
      classeEtat: [...l.querySelector(".etat-commande").classList].find(c => c.startsWith("etat-commande--")),
      mot: l.querySelector(".pill").textContent.trim(),
      infos: l.querySelector(".commande-ligne-main").children.length - 1 + l.querySelector(".commande-ligne-corps").children.length
    }));
    return { lignes, anciennesRangees: document.querySelectorAll("#journee .op-order-row").length,
      titre: document.getElementById("dashboardPreparing").closest(".panel").querySelector("h3").textContent.replace(/\s+/g, " ").trim() };
  });
  expect(erreurs).toEqual([]);
  console.log(`[tdb/lignes] ${r.lignes.length} ligne(s) : ${r.lignes.map(l => `${l.nom.slice(0, 12)}=${l.mot}`).join(", ")}`);
  expect(r.lignes.length).toBeGreaterThan(0);
  expect(r.lignes.every(l => l.disque), "chaque ligne porte son disque d'état").toBe(true);
  expect(r.lignes.map(l => l.infos), "quatre informations par ligne").toEqual(r.lignes.map(() => 4));
  expect(r.anciennesRangees, "plus aucune ancienne rangée .op-order-row").toBe(0);
  expect(r.titre, "le titre de la planche").toBe("À préparer aujourd’hui 1");
  await ctx.close();
});

test("sans tournée, la carte se CACHE et « À livrer » reprend sa place", async ({ browser }) => {
  test.setTimeout(180000);
  const seed = jeuDeDonnees();
  seed.routes = [];
  const vide = await demarrer({ port: 3152, seed });
  try {
    const { ctx, page, erreurs } = await ouvrir(browser, "desktop", vide.base);
    const r = await page.evaluate(() => ({
      carte: document.getElementById("dashboardTournee").checkVisibility(),
      aLivrer: document.getElementById("dashboardDeliveringPanel").checkVisibility()
    }));
    expect(erreurs).toEqual([]);
    console.log(`[tdb/sans tournée] carte=${r.carte} à-livrer=${r.aLivrer}`);
    expect(r.carte, "une carte vide dirait « c'est cassé » là où la vérité est « il n'y en a pas »").toBe(false);
    expect(r.aLivrer).toBe(true);
    await ctx.close();
  } finally {
    await vide.arreter();
  }
});

// L'ECRAN DU LIVREUR -- planche Main.png, mesure sur des DONNEES.
//
// Sur la route, un seul ecran compte. La planche dit ce qu'il contient :
//   - l'en-tete : le jour, le nom de la tournee, « 3 sur 8 », la barre ;
//   - la carte de l'arret : un point + un mot d'etat, le nom, l'adresse, les
//     articles a decharger avec leur quantite en disque ;
//   - les trois gestes sous le pouce : Livre (principal), Client absent et
//     Probleme (tertiaire) ; Appeler, Y aller et la carte au-dessus (les mots
//     de la planche 4b depuis le 23/09 -- « Livraison validee » et
//     « Itineraire » avant) ;
//   - le reste replie.
// Et la planification vient APRES, repliee tant que la tournee roule.
//
// Mesure du 19/09, avant : la planification (depart, arrivee, filtres, quatre
// boutons) occupait le haut ; l'arret en cours arrivait apres deux panneaux ;
// HUIT boutons de meme poids ; « Google Maps » la ou la planche dit
// « Itineraire ». Et une legende de carte aux couleurs V7 (bleu, orange,
// vert, rouge) qui ne decrivait plus rien.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

const VUES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const HAUTEUR = { desktop: 44, mobile: 48 };
// Decision de Thomas du 23/09 (planche 4b) : au telephone, « Livre », « Y
// aller » et les ronds qui les encadrent font 56 px ; Client absent et
// Probleme restent a 48, moins hauts. Elle remplace les 48 uniformes du 19/09.
const HAUTEUR_GESTE = { mobile: { appeler: 56, itineraire: 56, livre: 56 } };
const TOL = 1;

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3143 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, vue, base = srv.base) {
  const ctx = await browser.newContext({ viewport: VUES[vue] });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(base + "/#livreur", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
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

for (const vue of ["mobile", "desktop"]) {
  test(`planche Main — l'ARRET EN COURS d'abord, les trois gestes sous le pouce, en ${vue}`, async ({ browser }) => {
    test.setTimeout(180000);
    const { ctx, page, erreurs } = await ouvrir(browser, vue);

    const r = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const token = n => cs.getPropertyValue(n).trim().toUpperCase();
      const y = el => Math.round(el.getBoundingClientRect().top + window.scrollY);
      const bouton = id => {
        const b = document.getElementById(id);
        const s = getComputedStyle(b);
        return { texte: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height), classes: b.className, fond: s.backgroundColor, couleur: s.color, visible: b.checkVisibility() };
      };
      const etat = document.querySelector("#currentClient .arret-etat");
      const point = etat && etat.querySelector(".arret-etat-point");
      const titreArticles = document.querySelector(".arret-articles-titre");
      const plus = document.querySelector(".gestes-plus");
      const resume = plus && plus.querySelector("summary");
      return {
        tokens: { principal: token("--v8-principal"), accent: token("--v8-accent"), surfaceBasse: token("--v8-surface-basse"), pecheClaire: token("--v8-peche-claire") },
        ordre: { entete: y(document.querySelector(".tournee-entete")), carte: y(document.querySelector(".tournee .current-driver-card")), tournee: y(document.getElementById("tourneeActive")), planification: y(document.getElementById("routePlanning")), liste: y(document.getElementById("routeStopsList")) },
        tourneeVisible: !document.getElementById("tourneeActive").hidden,
        planificationOuverte: document.getElementById("routePlanning").open,
        departVisible: document.getElementById("tourneeDepart").checkVisibility(),
        entete: {
          jour: document.getElementById("tourneeJour").textContent.trim(),
          nom: document.getElementById("tourneeNom").textContent.trim(),
          rang: document.querySelector("#routeProgress strong") && document.querySelector("#routeProgress strong").textContent.trim(),
          total: document.querySelector("#routeProgress small") && document.querySelector("#routeProgress small").textContent.trim(),
          barre: document.getElementById("tourneeProgressionBarre").style.width,
          fond: getComputedStyle(document.querySelector(".tournee-entete")).backgroundColor,
          couleurJour: getComputedStyle(document.getElementById("tourneeJour")).color
        },
        arret: {
          etatMot: etat && etat.textContent.trim(),
          etatCouleur: etat && getComputedStyle(etat).color,
          pointCouleur: point && getComputedStyle(point).backgroundColor,
          nom: (document.querySelector("#currentClient .arret-nom") || {}).textContent,
          adresse: (document.querySelector("#currentClient .arret-adresse") || {}).textContent,
          articlesTitre: titreArticles && titreArticles.textContent.trim(),
          articlesCouleur: titreArticles && getComputedStyle(titreArticles).color,
          articlesFond: titreArticles && getComputedStyle(titreArticles.parentElement).backgroundColor,
          disques: [...document.querySelectorAll("#currentClient .arret-article .marqueur--plein")].map(d => d.textContent.trim())
        },
        gestes: {
          appeler: bouton("callClientButton"), itineraire: bouton("mapsButton"),
          livre: bouton("markDeliveredButton"), absent: bouton("markAbsentButton"), probleme: bouton("markProblemButton"),
          reprogrammer: bouton("markRescheduleButton"), suivant: bouton("nextClientButton")
        },
        plusReplie: plus ? !plus.open : null,
        plusResumeHauteur: resume ? Math.round(resume.getBoundingClientRect().height) : 0,
        legende: [...document.querySelectorAll("#livreur .marqueur-legende > span > span")].map(s => s.textContent.trim()),
        anciennesPastilles: document.querySelectorAll("#livreur .blue-dot, #livreur .orange-dot, #livreur .red-dot, #livreur .green-dot").length
      };
    });

    expect(erreurs, "erreurs de page").toEqual([]);
    const { tokens } = r;
    console.log(`[livreur/${vue}] ${r.entete.jour} · ${r.entete.nom} · ${r.entete.rang} ${r.entete.total} · barre ${r.entete.barre} · gestes ${Object.values(r.gestes).map(g => g.h).join("/")}`);

    // L'ORDRE : l'arret d'abord, la liste ensuite, la planification apres -- repliee.
    expect(r.tourneeVisible, "le bloc de tournee doit etre visible").toBe(true);
    // Une ancienne regle mobile (`order: -1` sur la carte) la faisait passer DEVANT l'en-tete.
    expect(r.ordre.entete, "l'en-tete doit preceder la carte de l'arret").toBeLessThan(r.ordre.carte);
    expect(r.ordre.tournee, "la tournee doit preceder la liste").toBeLessThan(r.ordre.liste);
    expect(r.ordre.liste, "la liste doit preceder la planification").toBeLessThan(r.ordre.planification);
    expect(r.planificationOuverte, "la planification doit etre repliee pendant la livraison").toBe(false);
    expect(r.departVisible, "« Demarrer la tournee » n'a pas sa place sur une tournee en cours").toBe(false);

    // L'EN-TETE : le jour, le nom, « 3 sur 6 », la barre a la part des arrets termines (3/6).
    expect(r.entete.jour).toMatch(/^[A-ZÉ][a-zé]+ \d{1,2} [a-zéû]+$/);
    expect(r.entete.nom).toMatch(/^Tournée/);
    expect(r.entete.rang).toBe("3");
    expect(r.entete.total).toBe("sur 6");
    expect(r.entete.barre).toBe("50%");
    expect(hex(r.entete.fond)).toBe(tokens.principal);
    expect(contraste(rgb(r.entete.couleurJour), rgb(r.entete.fond)), "le jour sur l'en-tete").toBeGreaterThanOrEqual(4.5);

    // L'ARRET : un point en ACCENT, un mot en PRINCIPAL (pas en accent : la charte l'interdit).
    expect(r.arret.etatMot).toBe("Arrêt en cours");
    expect(hex(r.arret.pointCouleur), "le point d'etat est en accent").toBe(tokens.accent);
    expect(hex(r.arret.etatCouleur), "le mot d'etat est en principal, jamais en accent").toBe(tokens.principal);
    expect(r.arret.nom).toBe("EHPAD Les Tilleuls du Val de Loue");
    expect(r.arret.adresse, "la ville reprend sa cedille").toContain("Besançon");
    expect(r.arret.articlesTitre).toBe("2 articles à décharger");
    expect(r.arret.disques).toEqual(["3", "3"]);
    expect(hex(r.arret.articlesFond)).toBe(tokens.pecheClaire);
    expect(contraste(rgb(r.arret.articlesCouleur), rgb(r.arret.articlesFond)), "titre des articles sur peche claire").toBeGreaterThanOrEqual(4.5);

    // LES GESTES : les libelles de la planche, les hauteurs de la charte, trois poids.
    // Les mots de la planche 4b (decision du 23/09) : « Y aller », « Livre ».
    expect(r.gestes.itineraire.texte).toBe("Y aller");
    expect(r.gestes.appeler.texte).toBe("Appeler");
    expect(r.gestes.livre.texte).toBe("Livré");
    expect(r.gestes.absent.texte).toBe("Client absent");
    expect(r.gestes.probleme.texte).toBe("Problème");
    for (const [nom, g] of Object.entries(r.gestes)) {
      if (!g.visible) continue;
      const attendu = (HAUTEUR_GESTE[vue] || {})[nom] || HAUTEUR[vue];
      expect(Math.abs(g.h - attendu) <= TOL, `${nom} : ${g.h}px au lieu de ${attendu}`).toBe(true);
    }
    expect(r.gestes.livre.classes).toContain("primary");
    expect(r.gestes.absent.classes).toContain("tertiary");
    expect(hex(r.gestes.absent.fond), "le tertiaire est sur surface basse").toBe(tokens.surfaceBasse);
    expect(contraste(rgb(r.gestes.absent.couleur), rgb(r.gestes.absent.fond)), "texte du tertiaire").toBeGreaterThanOrEqual(4.5);
    // Le reste est replie, derriere un resume qui fait une cible de 44.
    expect(r.plusReplie, "« Autres actions » doit etre replie").toBe(true);
    expect(r.gestes.reprogrammer.visible, "A reprogrammer est derriere le repli").toBe(false);
    expect(r.plusResumeHauteur).toBeGreaterThanOrEqual(44 - TOL);

    // LA LEGENDE : les etats du marqueur, et plus aucune pastille V7.
    expect(r.legende).toEqual(["Livré", "En cours", "À venir", "Absent ou problème"]);
    expect(r.anciennesPastilles).toBe(0);

    await ctx.close();
  });
}

test("sans tournee, la PLANIFICATION vient en premier, ouverte ; le bloc de tournee est cache", async ({ browser }) => {
  test.setTimeout(180000);
  const seed = jeuDeDonnees();
  seed.routes = [];
  const vide = await demarrer({ port: 3144, seed });
  try {
    const { ctx, page, erreurs } = await ouvrir(browser, "mobile", vide.base);
    const r = await page.evaluate(() => {
      const y = el => Math.round(el.getBoundingClientRect().top + window.scrollY);
      const t = document.getElementById("tourneeActive");
      const visibles = [...document.querySelectorAll(".driver-page > *")].filter(e => getComputedStyle(e).display !== "none").sort((a, b) => y(a) - y(b));
      return {
        tourneeCachee: t.hidden && getComputedStyle(t).display === "none",
        planificationOuverte: document.getElementById("routePlanning").open,
        premier: visibles[0] && (visibles[0].id || visibles[0].className),
        departVisible: document.getElementById("departureQuery").offsetParent !== null
      };
    });
    expect(erreurs).toEqual([]);
    console.log(`[livreur/sans tournee] premier bloc visible : ${r.premier}`);
    expect(r.tourneeCachee).toBe(true);
    expect(r.planificationOuverte).toBe(true);
    expect(r.premier).toBe("routePlanning");
    expect(r.departVisible, "le champ de depart doit etre accessible").toBe(true);
    await ctx.close();
  } finally {
    await vide.arreter();
  }
});

test("la planification ne se replie qu'au CHANGEMENT de statut : ce que le livreur ouvre reste ouvert", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page } = await ouvrir(browser, "mobile");
  // Repliee (tournee en cours). Le livreur l'ouvre ; un rafraichissement des
  // donnees ne doit pas la refermer.
  expect(await page.evaluate(() => document.getElementById("routePlanning").open)).toBe(false);
  await page.evaluate(() => { document.getElementById("routePlanning").open = true; });
  await page.locator("[data-action=\"refresh\"], #refreshButton").first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => document.getElementById("routePlanning").open), "un rafraichissement a referme la planification").toBe(true);
  await ctx.close();
});

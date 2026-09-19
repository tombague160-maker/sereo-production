// LA CARTE ET LES LIGNES D'ARRET -- mesurees sur des DONNEES, pas a vide.
//
// Charte §4 :
//   « Ligne de liste (commande, abonnement, arret) : une ligne de 64-72 px,
//     quatre informations maximum, etat porte par un point de couleur + un mot. »
//   « Marqueur de carte : corps vert #386B6D, numero blanc ; l'arret en cours
//     garde un halo orange. »
// Planche Carte.png : trois etats (fait = coche, en cours = numero + anneau
// orange, a venir = numero sur blanc) et un trace en ACCENT.
//
// Jusqu'au 19/09 ces deux regles etaient NON JUGEES : les listes etaient vides
// et aucun marqueur ne se dessine sans client geolocalise. Ce banc leve un
// serveur seme (six clients, une tournee en cours avec les etats d'arret).
//
// Mesure du 19/09, avant le lot : lignes de 184-209 px en mobile, 126-151 en
// desktop ; six circleMarker en quatre couleurs V7 sans numero ; trace bleu ;
// et un cadrage fait sur un conteneur de 0 x 0 qui posait les marqueurs a
// 100 000 px du cadre -- la carte du livreur ne montrait jamais la tournee.
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, CLIENTS } = require("./serveur-seme");

const VUES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const TOL = 1;

// Un seul serveur pour tout le fichier, donc UN worker : en parallele, chaque
// worker relancerait beforeAll sur le meme port.
test.describe.configure({ mode: "serial" });

/** Le seme est fixe : aucun cas ne l'ecrit. */
let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  // La geometrie routiere, comme apres un calcul d'itineraire : c'est le cas
  // normal, et c'est lui qui dessine le trace en accent.
  seed.routes[0].geometry = { type: "LineString", coordinates: CLIENTS.map(c => [c.lng, c.lat]) };
  srv = await demarrer({ port: 3141, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, vue, { parBascule = false } = {}) {
  const ctx = await browser.newContext({ viewport: VUES[vue] });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  if (parBascule) {
    // Le second chemin vers la carte : l'onglet est MASQUE quand les donnees
    // arrivent, puis on y bascule. C'est celui qui cadrait sur 0 x 0.
    await page.goto(srv.base + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.evaluate(() => { location.hash = "#livreur"; });
  } else {
    await page.goto(srv.base + "/#livreur", { waitUntil: "networkidle" });
  }
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

/* ---------- petits outils de couleur, les memes que les autres bancs ---------- */
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
  test(`charte §4 — la LIGNE D'ARRET fait 64-72 px et porte quatre informations, en ${vue}`, async ({ browser }) => {
    test.setTimeout(180000);
    const { ctx, page, erreurs } = await ouvrir(browser, vue);

    const r = await page.evaluate(() =>
      [...document.querySelectorAll("#routeStopsList .route-stop")].map(e => {
        const main = e.querySelector(".route-stop-main");
        const corps = e.querySelector(".route-stop-corps");
        const titre = corps && corps.querySelector("strong");
        const marqueur = e.querySelector(".marqueur");
        const pill = e.querySelector(".pill");
        const lignesDeTitre = titre ? Math.round(titre.getBoundingClientRect().height / parseFloat(getComputedStyle(titre).lineHeight)) : 0;
        return {
          nom: titre ? titre.textContent.trim().slice(0, 24) : "?",
          h: Math.round(e.getBoundingClientRect().height),
          lignesDeTitre,
          // Les quatre informations : marqueur, titre, detail, badge.
          infos: (main ? main.children.length : 0) - 1 + (corps ? corps.children.length : 0),
          point: marqueur ? getComputedStyle(marqueur).backgroundColor : null,
          mot: pill ? pill.textContent.trim() : "",
          flechesRendues: !!e.querySelector(".route-stop-actions")
        };
      }));

    expect(erreurs, "erreurs de page").toEqual([]);
    expect(r.length, "aucune ligne d'arret : le seme n'a pas pris").toBe(6);

    // 64-72 pour un titre sur une ligne. Un titre sur DEUX lignes deborde par
    // construction (la planche elle-meme fait 88 px dans ce cas) : on le
    // tolere jusqu'a 96, et on le NOMME au lieu de le compter conforme.
    const horsCharte = r.filter(l => l.lignesDeTitre <= 1 && (l.h < 64 - TOL || l.h > 72 + TOL))
      .map(l => `${l.nom} : ${l.h}px (titre sur ${l.lignesDeTitre} ligne)`);
    const deuxLignes = r.filter(l => l.lignesDeTitre > 1);
    const tropHautes = deuxLignes.filter(l => l.h > 96).map(l => `${l.nom} : ${l.h}px sur ${l.lignesDeTitre} lignes`);
    console.log(`[lignes/${vue}] ${r.length} lignes, hauteurs ${r.map(l => l.h).join("/")}, ${deuxLignes.length} titre(s) sur deux lignes`);
    expect(horsCharte, "lignes hors 64-72 px").toEqual([]);
    expect(tropHautes, "lignes a deux lignes de titre au-dela de 96 px").toEqual([]);

    // Quatre informations, pas cinq : le motif REMPLACE l'adresse.
    expect(r.map(l => l.infos), "chaque ligne porte exactement quatre informations").toEqual(r.map(() => 4));

    // L'etat : un point de couleur ET un mot.
    expect(r.filter(l => !l.point || l.point === "rgba(0, 0, 0, 0)").map(l => l.nom), "lignes sans point de couleur").toEqual([]);
    expect(r.filter(l => !l.mot).map(l => l.nom), "lignes sans mot d'etat").toEqual([]);
    // Le mot est celui de la charte : « Pret », pas « Pret livraison ».
    expect(r.map(l => l.mot)).toEqual(["Livré", "Livré", "En livraison", "Problème", "Prêt", "Prêt"]);

    // La tournee est EN COURS : aucune fleche de reordonnancement.
    expect(r.filter(l => l.flechesRendues).map(l => l.nom), "fleches rendues sur une tournee en cours").toEqual([]);

    await ctx.close();
  });
}

for (const [chemin, parBascule] of [["arrivee directe", false], ["bascule depuis l'accueil", true]]) {
  test(`la carte CADRE la tournee (${chemin}) : tous les marqueurs dans le conteneur`, async ({ browser }) => {
    test.setTimeout(180000);
    const { ctx, page, erreurs } = await ouvrir(browser, "mobile", { parBascule });
    await page.locator("#map").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    const r = await page.evaluate(() => {
      const m = document.getElementById("map").getBoundingClientRect();
      return [...document.querySelectorAll("#map .leaflet-marker-icon")].map(e => {
        const b = e.getBoundingClientRect();
        return { x: Math.round(b.left + b.width / 2 - m.left), y: Math.round(b.top + b.height / 2 - m.top), w: Math.round(m.width), h: Math.round(m.height) };
      });
    });
    expect(erreurs).toEqual([]);
    expect(r.length, "six marqueurs attendus").toBe(6);
    const dehors = r.filter(p => p.x < 0 || p.y < 0 || p.x > p.w || p.y > p.h).map(p => `(${p.x}, ${p.y}) hors de ${p.w}x${p.h}`);
    console.log(`[cadrage/${chemin}] centres : ${r.map(p => `(${p.x},${p.y})`).join(" ")}`);
    expect(dehors, "marqueurs hors du cadre de la carte").toEqual([]);
    await ctx.close();
  });
}

test("charte §4 — les MARQUEURS : coche, numero blanc + halo orange, numero sur blanc ; trace en accent", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, "mobile");
  await page.locator("#map").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  const r = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const token = n => cs.getPropertyValue(n).trim().toUpperCase();
    const ancres = [...document.querySelectorAll("#map .leaflet-marker-icon")];
    const marqueurs = ancres.map(a => {
      const m = a.querySelector(".marqueur");
      const s = getComputedStyle(m);
      const avant = getComputedStyle(m, "::before");
      const b = m.getBoundingClientRect();
      return {
        etat: [...m.classList].find(c => c.startsWith("marqueur--")) || "(aucun)",
        texte: m.textContent.trim(),
        fond: s.backgroundColor, couleur: s.color, ombre: s.boxShadow,
        diametre: Math.round(b.width), zone: [a.offsetWidth, a.offsetHeight],
        coche: avant.content !== "none" && avant.borderBottomWidth !== "0px",
        exclamation: avant.content
      };
    });
    const trace = document.querySelector("#map path.leaflet-interactive");
    return {
      tokens: { principal: token("--v8-principal"), accent: token("--v8-accent"), surface: token("--v8-surface"), surPrincipal: token("--v8-texte-sur-principal"), pecheClaire: token("--v8-peche-claire") },
      marqueurs,
      trace: trace ? { stroke: (trace.getAttribute("stroke") || "").toUpperCase(), largeur: trace.getAttribute("stroke-width"), pointille: trace.getAttribute("stroke-dasharray") } : null
    };
  });
  expect(erreurs).toEqual([]);
  expect(r.marqueurs.length).toBe(6);
  const { tokens } = r;
  const parEtat = Object.fromEntries(r.marqueurs.map(m => [m.etat, m]));
  console.log(`[marqueurs] ${r.marqueurs.map(m => `${m.etat}:${m.texte || "·"}`).join(" ")} | trace ${r.trace && r.trace.stroke} ${r.trace && r.trace.largeur}px`);

  // La zone de toucher : 44 x 44, le plancher de la charte.
  expect(r.marqueurs.map(m => m.zone)).toEqual(r.marqueurs.map(() => [44, 44]));

  // FAIT : disque principal, coche dessinee, pas de numero.
  const fait = parEtat["marqueur--fait"];
  expect(fait, "aucun marqueur « fait »").toBeTruthy();
  expect(hex(fait.fond)).toBe(tokens.principal);
  expect(fait.coche, "la coche du marqueur fait n'est pas dessinee").toBe(true);
  expect(fait.texte).toBe("");

  // EN COURS : disque principal, numero en texte-sur-principal, anneau ACCENT.
  const enCours = parEtat["marqueur--en-cours"];
  expect(enCours, "aucun marqueur « en cours »").toBeTruthy();
  expect(enCours.texte).toBe("3");
  expect(hex(enCours.fond)).toBe(tokens.principal);
  expect(hex(enCours.couleur)).toBe(tokens.surPrincipal);
  expect(enCours.diametre).toBe(34);
  // La premiere couche de l'ombre est l'anneau ; hex() lit la premiere couleur.
  expect(hex(enCours.ombre), `l'anneau de l'arret en cours n'est pas en accent : ${enCours.ombre}`).toBe(tokens.accent);
  expect(contraste(rgb(enCours.couleur), rgb(enCours.fond)), "numero sur le disque : contraste").toBeGreaterThanOrEqual(4.5);

  // A VENIR : disque surface, numero et contour en principal.
  const aVenir = r.marqueurs.filter(m => m.etat === "marqueur--a-venir");
  expect(aVenir.length).toBe(2);
  for (const m of aVenir) {
    expect(hex(m.fond)).toBe(tokens.surface);
    expect(hex(m.couleur)).toBe(tokens.principal);
    expect(m.ombre.includes("inset") && hex(m.ombre) === tokens.principal, `contour « a venir » : ${m.ombre}`).toBe(true);
    expect(m.diametre).toBe(28);
    expect(contraste(rgb(m.couleur), rgb(m.fond))).toBeGreaterThanOrEqual(4.5);
  }
  expect(aVenir.map(m => m.texte)).toEqual(["5", "6"]);

  // ECHEC : disque peche claire, point d'exclamation.
  const echec = parEtat["marqueur--echec"];
  expect(echec, "aucun marqueur « echec »").toBeTruthy();
  expect(hex(echec.fond)).toBe(tokens.pecheClaire);
  expect(echec.exclamation).toBe('"!"');

  // LE TRACE : accent, 4,5 px, plein.
  expect(r.trace, "aucun trace").toBeTruthy();
  expect(r.trace.stroke).toBe(tokens.accent);
  expect(parseFloat(r.trace.largeur)).toBeCloseTo(4.5, 1);
  expect(r.trace.pointille).toBeNull();

  await ctx.close();
});

test("sans geometrie routiere, le trace de repli est en PRINCIPAL et pointille -- pas en bleu V7", async ({ browser }) => {
  test.setTimeout(180000);
  const propre = await demarrer({ port: 3142 });
  try {
    const ctx = await browser.newContext({ viewport: VUES.mobile });
    const page = await ctx.newPage();
    await page.goto(propre.base + "/#livreur", { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const t = document.querySelector("#map path.leaflet-interactive");
      return { stroke: (t && t.getAttribute("stroke") || "").toUpperCase(), pointille: t && t.getAttribute("stroke-dasharray"),
        principal: getComputedStyle(document.documentElement).getPropertyValue("--v8-principal").trim().toUpperCase() };
    });
    console.log(`[trace de repli] ${r.stroke} pointille=${r.pointille}`);
    expect(r.stroke).toBe(r.principal);
    expect(r.pointille).toBeTruthy();
    await ctx.close();
  } finally {
    await propre.arreter();
  }
});

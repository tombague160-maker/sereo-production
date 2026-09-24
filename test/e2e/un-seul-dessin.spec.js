// E2E : clair et sombre dessinent la MEME application -- seules les couleurs
// changent.
//
// LE DEFAUT, MESURE LE 24/09 (audit « ameliorations », angle bureau). Le
// changement de theme ne changeait pas que les couleurs : titre d'ecran a 30 px
// en clair et 32 en sombre, « Actualiser » et les pilules de filtre a 13,44 px
// contre 16, boutons de fermeture carres (rayon 12) ou ronds, pas -/+ a rayon 8
// ou en pilule, titres de carte en trois rendus (19/600, 18,4/950, 19/700). La
// cause : les couches anciennes ecrites `:root[data-color-scheme="light"] X`,
// qui posaient la GEOMETRIE (taille, graisse, rayon, marge) en plus des
// couleurs. Le sombre ne les voyait pas. Depuis le 17/09 le theme suit le
// systeme : un poste Windows en clair voyait la version la moins finie.
//
// CE QUE CE BANC DISTINGUE. Sur un serveur seme (des lignes, des badges, des
// cartes existent : a vide, il n'y aurait presque rien a comparer), chaque
// ecran est ouvert en clair puis en sombre, a 1440 x 900. Chaque element
// visible est repere par son CHEMIN dans le DOM (le meme dans les deux themes :
// le rendu ne depend pas du theme), et ses proprietes de FORME sont comparees :
// taille et graisse de police, rayons, marges internes, hauteur. Aucune liste
// d'elements codee en dur : un composant ajoute demain est couvert.
//
// Et deux regles de la charte que la comparaison seule ne tient pas (deux
// themes egalement faux seraient egaux) :
//   - §3 : Poppins n'est chargee qu'en 400/500/600/700. Une graisse calculee
//     hors de ces quatre s'affiche dans une autre (950 -> 700) : le code ne dit
//     pas ce que l'ecran montre.
//   - §3 : titre d'ecran 30 px / 700 ; titres de carte 18 px / 600.

const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3526 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

// Douze ecrans du bureau. « Exports » n'y est pas : l'ecran est retire par un
// autre lot (decision 9 du 24/09).
const ECRANS = ["journee", "commandes", "preparation", "livreur", "abonnements", "stock", "crm",
  "statistiques", "relances", "recommande", "commande-client", "parametres"];

/**
 * Releve la forme de chaque element visible sous les racines donnees.
 * Rend { chemin: { tag, nom, fontSize, fontWeight, rayons, padding, hauteur } }.
 */
function releverFormes(racines) {
  const vus = {};
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };
  const nom = el => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
    const texte = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}${texte ? ` « ${texte} »` : ""}`;
  };
  const parcourir = (el, chemin) => {
    // La carte Leaflet : ses tuiles et ses marqueurs arrivent a leur rythme, le
    // nombre d'enfants n'est pas le meme d'un chargement a l'autre.
    if (el.classList && el.classList.contains("leaflet-container")) return;
    if (el.tagName === "svg" || el.tagName === "SCRIPT" || el.tagName === "TEMPLATE") return;
    if (visible(el)) {
      const cs = getComputedStyle(el);
      vus[chemin] = {
        nom: nom(el),
        // L'etat d'un bouton peut dependre du theme sans que ce soit un defaut :
        // dans Parametres, « Clair » est choisi en clair, « Sombre » en sombre.
        etat: ["aria-pressed", "aria-checked", "aria-selected", "aria-current"].map(a => el.getAttribute(a) || "").join("|"),
        "font-size": cs.fontSize,
        "font-weight": cs.fontWeight,
        "border-radius": [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].join(" "),
        padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(" "),
        height: String(Math.round(el.getBoundingClientRect().height))
      };
    }
    [...el.children].forEach((enfant, i) => parcourir(enfant, `${chemin}/${enfant.tagName.toLowerCase()}[${i}]`));
  };
  for (const selecteur of racines) {
    const racine = document.querySelector(selecteur);
    if (racine) parcourir(racine, selecteur);
  }
  return vus;
}

const PROPRIETES = ["font-size", "font-weight", "border-radius", "padding", "height"];

/** Ouvre chaque ecran dans un theme ; rend { ecran: formes }. */
async function formesParEcran(browser, schema, ecrans, avant = null) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: schema });
  await ctx.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
  const page = await ctx.newPage();
  const out = {};
  try {
    for (const ecran of ecrans) {
      await page.goto(`${srv.base}/#${ecran}`, { waitUntil: "networkidle" });
      await expect(page.locator(`#${ecran}`)).toHaveClass(/active/);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      if (avant) await avant(page, ecran);
      out[ecran] = await page.evaluate(releverFormes, [".ecran-entete", `#${ecran}`]);
    }
  } finally {
    await ctx.close();
  }
  return out;
}

/** Les ecarts clair / sombre, regroupes : une ligne par (element, propriete, valeurs). */
function ecarts(clair, sombre) {
  const groupes = new Map();
  for (const [chemin, c] of Object.entries(clair)) {
    const s = sombre[chemin];
    if (!s) continue;
    // Deux etats differents ne sont pas deux dessins du meme element.
    if (c.etat !== s.etat) continue;
    for (const p of PROPRIETES) {
      if (c[p] === s[p]) continue;
      if (p === "height" && Math.abs(Number(c[p]) - Number(s[p])) <= 1) continue;
      const cle = `${c.nom.replace(/ « .*$/, "")} | ${p} : clair ${c[p]} / sombre ${s[p]}`;
      const g = groupes.get(cle) || { n: 0, exemple: c.nom };
      g.n++;
      groupes.set(cle, g);
    }
  }
  return [...groupes].map(([cle, g]) => `${cle}  (x${g.n}, ex. ${g.exemple})`);
}

test("un seul dessin — chaque ecran a la meme forme en clair et en sombre (1440)", async ({ browser }) => {
  test.setTimeout(240000);
  const clair = await formesParEcran(browser, "light", ECRANS);
  const sombre = await formesParEcran(browser, "dark", ECRANS);
  const rapport = [];
  let compares = 0;
  for (const ecran of ECRANS) {
    const communs = Object.keys(clair[ecran]).filter(k => sombre[ecran][k]);
    compares += communs.length;
    // Temoin de l'instrument : chaque ecran a de quoi etre compare.
    expect(communs.length, `${ecran} : trop peu d'elements releves`).toBeGreaterThan(20);
    for (const e of ecarts(clair[ecran], sombre[ecran])) rapport.push(`#${ecran} ${e}`);
  }
  console.log(`un seul dessin : ${compares} elements compares sur ${ECRANS.length} ecrans`);
  expect(rapport, rapport.join("\n")).toEqual([]);
});

// Les fenetres : le detail d'une commande, « Modifier le client », « Nouvel
// abonnement ». Leur bouton de fermeture etait carre en clair, rond en sombre.
const FENETRES = [
  { ecran: "commandes", racine: "#bdc-detail-modal", ouvrir: page => page.locator("#commandes .cmd-ligne").first().click() },
  { ecran: "crm", racine: "#cliDialogue", ouvrir: async page => { await page.locator("#crm .cli-ligne").first().click(); await page.locator("#crm").getByRole("button", { name: /^Modifier$/ }).first().click(); } },
  { ecran: "abonnements", racine: "#subscriptionDialog", ouvrir: page => page.locator(".abo-nouveau").click() }
];

test("un seul dessin — les fenetres ont la meme forme en clair et en sombre", async ({ browser }) => {
  test.setTimeout(180000);
  const releves = {};
  for (const schema of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: schema });
    await ctx.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
    releves[schema] = {};
    for (const f of FENETRES) {
      // Une page par fenetre : un changement d'ancre ne ferme pas la precedente.
      const page = await ctx.newPage();
      await page.goto(`${srv.base}/#${f.ecran}`, { waitUntil: "networkidle" });
      await expect(page.locator(`#${f.ecran}`)).toHaveClass(/active/);
      await page.waitForTimeout(300);
      await f.ouvrir(page);
      await expect(page.locator(f.racine)).toBeVisible();
      await page.waitForTimeout(400);
      releves[schema][f.racine] = await page.evaluate(releverFormes, [f.racine]);
      await page.close();
    }
    await ctx.close();
  }
  const rapport = [];
  for (const f of FENETRES) {
    const communs = Object.keys(releves.light[f.racine]).filter(k => releves.dark[f.racine][k]);
    expect(communs.length, `${f.racine} : trop peu d'elements releves`).toBeGreaterThan(8);
    for (const e of ecarts(releves.light[f.racine], releves.dark[f.racine])) rapport.push(`${f.racine} ${e}`);
  }
  expect(rapport, rapport.join("\n")).toEqual([]);
});

test("un seul dessin — aucune graisse calculee hors de celles que Poppins charge (400/500/600/700)", async ({ browser }) => {
  test.setTimeout(240000);
  const hors = [];
  for (const schema of ["light", "dark"]) {
    const formes = await formesParEcran(browser, schema, ECRANS);
    for (const [ecran, f] of Object.entries(formes)) {
      const groupes = new Map();
      for (const e of Object.values(f)) {
        if (["400", "500", "600", "700"].includes(e["font-weight"])) continue;
        const cle = `${schema} #${ecran} ${e.nom.replace(/ « .*$/, "")} : ${e["font-weight"]}`;
        groupes.set(cle, (groupes.get(cle) || 0) + 1);
      }
      for (const [cle, n] of groupes) hors.push(`${cle} (x${n})`);
    }
  }
  expect(hors, hors.join("\n")).toEqual([]);
});

test("un seul dessin — titre d'ecran 30 px / 700, titres de carte 18 px / 600, dans les deux themes", async ({ browser }) => {
  test.setTimeout(120000);
  const faux = [];
  let vus = 0;
  for (const schema of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: schema });
    await ctx.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
    const page = await ctx.newPage();
    for (const ecran of ECRANS) {
      await page.goto(`${srv.base}/#${ecran}`, { waitUntil: "networkidle" });
      await expect(page.locator(`#${ecran}`)).toHaveClass(/active/);
      await page.waitForTimeout(300);
      const r = await page.evaluate(ecran => {
        const titre = document.getElementById("pageTitle");
        const ct = getComputedStyle(titre);
        // Un titre de carte : un h3 de l'ecran (mesure du 24/09 sur les douze
        // ecrans : les h4 titrent un element DANS une carte, le seul h2 est le
        // nom du client en tete de sa fiche). Deux h3 ne sont pas des titres de
        // carte : le nom de la tournee dans l'en-tete du cockpit, et l'encart
        // « a plat » du Stock.
        const cartes = [...document.querySelectorAll(`#${ecran} h3:not(.tournee-nom):not(#stkAPlatTitre)`)].filter(h => {
          const r = h.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !h.closest(".sr-only") && getComputedStyle(h).position !== "absolute";
        });
        return {
          titre: `${ct.fontSize}/${ct.fontWeight}`,
          cartes: cartes.map(h => ({ t: h.innerText.trim().slice(0, 30), v: `${getComputedStyle(h).fontSize}/${getComputedStyle(h).fontWeight}` }))
        };
      }, ecran);
      if (r.titre !== "30px/700") faux.push(`${schema} #${ecran} titre d'ecran ${r.titre}`);
      vus += r.cartes.length;
      for (const c of r.cartes) if (c.v !== "18px/600") faux.push(`${schema} #${ecran} titre de carte « ${c.t} » ${c.v}`);
    }
    await ctx.close();
  }
  // Temoin : le selecteur trouve bien les titres (une trentaine par theme).
  expect(vus).toBeGreaterThan(40);
  expect(faux, faux.join("\n")).toEqual([]);
});

// Le contre-temoin de `tuiles.js` : AUCUNE demande ne doit sortir vers les
// serveurs de tuiles d'OpenStreetMap.
//
// Sans ce banc, l'interception serait un mecanisme SOIGNE ET NON BRANCHE -- on
// le trouverait en cherchant, on conclurait qu'il marche, et une spec ecrite
// demain sans passer par `tuiles.js` recommencerait a marteler un service
// benevole sans que rien n'echoue.
//
// Les deux cas sont necessaires et ils ne disent pas la meme chose :
//   1. rien ne sort            -> l'interception couvre ce chemin
//   2. la carte affiche bien   -> elle sert quelque chose d'UTILISABLE, et non
//      des tuiles                 un refus qui laisserait la carte vide

const { test, expect, compteurTuiles, remettreCompteurAZero } = require("./tuiles");

test("tuiles — chaque demande de tuile est servie LOCALEMENT", async ({ browser }) => {
  test.setTimeout(120000);
  remettreCompteurAZero();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // On ECOUTE aussi, mais seulement pour compter ce que la carte demande :
  // `page.on("request")` se declenche pour ce qu'une route intercepte ET pour
  // ce que la CSP refuse. Il ne distingue pas ce qui SORT. La comparaison des
  // deux nombres, elle, le distingue.
  const demandees = [];
  page.on("request", r => {
    if (/openstreetmap\.org/i.test(r.url())) demandees.push(r.url());
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() =>
    document.querySelectorAll(".sidebar .nav-section").forEach(s => s.classList.add("open")));
  await page.evaluate(() => { location.hash = "#livreur"; });
  await page.waitForTimeout(4000);

  // Prealable : la carte doit exister, sinon ce zero ne distingue rien.
  expect(await page.locator(".leaflet-container").count(),
    "prealable : aucune carte sur l'onglet livreur").toBeGreaterThan(0);

  expect(demandees.length, "prealable : la carte n'a demande aucune tuile").toBeGreaterThan(3);
  expect(compteurTuiles(),
    `${demandees.length} tuile(s) demandee(s), ${compteurTuiles()} servie(s) localement : `
    + "la difference est partie sur le reseau").toBe(demandees.length);

  await ctx.close();
});

test("tuiles — la carte affiche bien les tuiles servies localement", async ({ browser }) => {
  // Le temoin positif. Un refus sec (route.abort) passerait le cas precedent en
  // laissant la carte vide, et toutes les mesures faites au-dessus d'elle
  // porteraient sur du vide.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() =>
    document.querySelectorAll(".sidebar .nav-section").forEach(s => s.classList.add("open")));
  await page.evaluate(() => { location.hash = "#livreur"; });
  await page.waitForTimeout(4000);

  const etat = await page.evaluate(() => {
    const tuiles = [...document.querySelectorAll("img.leaflet-tile")];
    return {
      nombre: tuiles.length,
      chargees: tuiles.filter(t => t.complete && t.naturalWidth > 0).length,
      largeur: tuiles[0]?.naturalWidth || 0
    };
  });

  expect(etat.nombre, "aucune tuile dans le DOM").toBeGreaterThan(3);
  expect(etat.chargees, "des tuiles n'ont pas pu se charger").toBe(etat.nombre);
  expect(etat.largeur, "la tuile servie n'a pas la taille attendue").toBe(256);

  await ctx.close();
});

// Le jour des donnees semees est celui du SEME, pas celui du chargement du
// module (25/09).
//
// La CI du 24/09 au soir (« 1 flaky ») : a 375 x 667, au premier test de
// telephone-utilisable.spec.js, le nom, l'adresse et les articles de l'arret
// etaient tous 158 px plus bas (nom bas 431 au lieu de 273) et passaient sous
// la barre des gestes ; au second essai, tout etait juste. La CI lance UN
// ouvrier Playwright pour tous les fichiers (workers: 1) : il avait charge
// serveur-seme.js a 21 h 34 UTC, 23 h 34 a Paris, et AUJOURDHUI y etait fige
// au 24/09. Le banc a seme sa tournee a 22 h 03 UTC -- 0 h 03 a Paris, le
// 25/09 --, datee de la VEILLE : l'ecran Tournee a signale, au-dessus de
// l'arret, « Tournee du jeudi 24 septembre n'est pas soldee » (126 px, plus
// l'ecart : 158). Le second essai tournait dans un ouvrier neuf, donc un
// module recharge apres minuit. Reproduit au pixel pres (sonde du 25/09 :
// gestes 447-577, nom bas 431, adresse bas 480, articles 535/563).
//
// Ce banc rejoue l'horloge : le module charge a 23 h 59 (Paris), le seme
// fait a 0 h 03. Il ne lance aucun serveur.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SEME = path.join(__dirname, "e2e", "serveur-seme.js");
const PRODUCTION = path.join(__dirname, "e2e", "jeu-production.js");

// 21 h 59 UTC le 24/09 = 23 h 59 a Paris (heure d'ete) ; 22 h 03 UTC = 0 h 03
// le 25/09. L'heure de la CI du 24/09.
const AVANT_MINUIT = Date.parse("2026-09-24T21:59:00Z");
const APRES_MINUIT = Date.parse("2026-09-24T22:03:41Z");

/** Charge les deux modules comme un ouvrier Playwright neuf, a l'heure donnee. */
function chargerA(instant) {
  mock.timers.setTime(instant);
  delete require.cache[SEME];
  delete require.cache[PRODUCTION];
  return { seme: require(SEME), production: require(PRODUCTION) };
}

test("seme : un module charge AVANT minuit (Paris) seme APRES minuit des donnees du NOUVEAU jour", t => {
  mock.timers.enable({ apis: ["Date"], now: AVANT_MINUIT });
  t.after(() => { mock.timers.reset(); delete require.cache[SEME]; delete require.cache[PRODUCTION]; });
  const { seme } = chargerA(AVANT_MINUIT);
  // Temoin : l'horloge simulee agit -- seme a 23 h 59, c'est le 24.
  assert.equal(seme.jeuDeDonnees().routes[0].deliveryDate, "2026-09-24", "temoin : l'horloge simulee n'agit pas");
  mock.timers.setTime(APRES_MINUIT);
  const donnees = seme.jeuDeDonnees();
  assert.equal(donnees.routes[0].deliveryDate, "2026-09-25", "la tournee semee est datee du jour du CHARGEMENT du module");
  assert.deepEqual([...new Set(donnees.commandes.map(c => c.deliveryDate))], ["2026-09-25"]);
  assert.equal(donnees.commandes[0].deliveredAt, "2026-09-25T09:10:00Z");
  // AUJOURDHUI, lu par les bancs qui semment eux-memes (a leur chargement).
  assert.equal(seme.AUJOURDHUI, "2026-09-25");
});

test("seme « production » : les dates sont comptees depuis le jour du SEME", t => {
  mock.timers.enable({ apis: ["Date"], now: AVANT_MINUIT });
  t.after(() => { mock.timers.reset(); delete require.cache[SEME]; delete require.cache[PRODUCTION]; });
  const { production } = chargerA(AVANT_MINUIT);
  // Temoin : a 23 h 59, trois jours avant le 24.
  assert.equal(production.jeuProduction().commandes[0].deliveredAt, "2026-09-21T08:48:14.707Z", "temoin : l'horloge simulee n'agit pas");
  mock.timers.setTime(APRES_MINUIT);
  assert.equal(production.jeuProduction().commandes[0].deliveredAt, "2026-09-22T08:48:14.707Z", "les dates « production » partent du jour du chargement du module");
});

// Les tuiles de carte, dans les bancs : servies LOCALEMENT, jamais demandees.
//
// POURQUOI. Mesure du 18/09 : les tuiles que le navigateur recevait n'etaient
// pas des cartes. C'etaient des images d'ERREUR d'OpenStreetMap, en HTTP 403 :
//
//     « Access blocked — App is not following the tile usage policy of
//       OpenStreetMap's volunteer-run servers : osm.wiki/Blocked »
//
// Deux consequences, et les deux comptent.
//
//   1. LE BANC MESURAIT AUTRE CHOSE QUE SEREO. Le releve de contraste lisait
//      les fonds sous les glyphes au-dessus de la carte ; ces fonds etaient le
//      graphique d'erreur d'OSM, en gris 78 a 209, inverse en mode sombre par
//      `--leaflet-tile-filter`. Des defauts annonces sur des pixels qui
//      n'appartiennent pas a l'application.
//
//   2. CHAQUE EXECUTION MARTELAIT UN SERVICE BENEVOLE. Quinze onglets, deux
//      modes, une dizaine de bancs, a chaque fois. Le blocage n'est pas un
//      accident : c'est la reponse normale d'OSM a ce comportement.
//
// On sert donc une tuile plate, locale, identique partout. Le banc devient
// deterministe ET cesse de nuire.
//
// APPLIQUE A LA RACINE, DELIBEREMENT. La premiere version posait un appel a
// cote de chacun des dix-huit `browser.newContext()`. Une spec ecrite demain
// aurait oublie l'appel et se serait remise a demander les tuiles, en silence
// et sans que rien n'echoue. On intercepte donc au niveau du `browser`, une
// fois, pour tout le monde -- et `tuiles-bloquees.spec.js` echoue si une seule
// requete s'echappe.

const base = require("@playwright/test");

/** Les hotes de tuiles qu'aucun banc ne doit atteindre. */
const MOTIF_TUILES = /(^|\.)tile\.openstreetmap\.org|tiles?\.(openstreetmap|osm)\./i;

// 256x256 uni #F2EFE9 -- la teinte moyenne d'une vraie tuile OSM, pour que les
// mesures faites au-dessus de la carte restent representatives.
const TUILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACAElEQVR42u3TQQkAAAgEwevf1JdgAt9mcGASLGym" +
  "C96KBBgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgA" +
  "DAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGwAAqYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAA" +
  "YAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgA" +
  "A4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABg" +
  "ADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwAAYQAUMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYA" +
  "A4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA2AAMAAY" +
  "AAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgAD" +
  "gAHAAGAAMAAYAAwABgADgAHAAHAtm2sp1zlLHgEAAAAASUVORK5CYII=", "base64");

/**
 * Combien de demandes de tuiles ont ete servies LOCALEMENT depuis le dernier
 * `remettreCompteurATzero()`.
 *
 * Pourquoi un compteur plutot qu'une ecoute de `page.on("request")` : Playwright
 * emet l'evenement `request` AUSSI pour ce qu'une route intercepte, et meme pour
 * ce que la CSP refuse. L'ecoute ne distingue donc pas "c'est sorti sur le
 * reseau" de "c'est parti dans ma route" -- elle a annonce 17 sorties alors que
 * rien n'etait sorti du tout. Le compteur, lui, ne s'incremente que dans la
 * route, et se compare au nombre de tuiles que la carte a demandees.
 */
let servies = 0;
const compteurTuiles = () => servies;
const remettreCompteurAZero = () => { servies = 0; };

/** Sert la tuile plate a la place de toute demande a un serveur de tuiles. */
async function servirTuilesLocales(cible) {
  await cible.route(MOTIF_TUILES, route => {
    servies++;
    return route.fulfill({ status: 200, contentType: "image/png", body: TUILE_PNG });
  });
}

/**
 * `test` etendu : toute demande de tuile est servie localement, que le banc
 * passe par la fixture `page` ou qu'il fabrique ses propres contextes.
 *
 * Le `browser` est enveloppe plutot que remplace : on garde la fixture d'origine
 * et on habille `newContext`, puis on rend la methode telle qu'elle etait. Sans
 * cela, les dix-huit `browser.newContext()` des bancs existants echapperaient a
 * l'interception -- et ce sont precisement eux qui parcourent les quinze
 * onglets, donc qui touchent la carte.
 */
const test = base.test.extend({
  tuilesLocales: [async ({ browser }, use) => {
    const origine = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      const ctx = await origine(...args);
      await servirTuilesLocales(ctx);
      return ctx;
    };
    await use();
    browser.newContext = origine;
  }, { auto: true }],

  // La fixture `page` construit son contexte par un chemin interne qui ne passe
  // pas forcement par le `newContext` habille ci-dessus. On l'intercepte donc
  // aussi ici. Poser la route deux fois est sans effet : elles font la meme
  // chose et Playwright prend la derniere posee.
  context: async ({ context }, use) => {
    await servirTuilesLocales(context);
    await use(context);
  }
});

module.exports = {
  test, expect: base.expect,
  MOTIF_TUILES, servirTuilesLocales,
  compteurTuiles, remettreCompteurAZero
};

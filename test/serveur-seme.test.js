// Le seme des bancs e2e (test/e2e/serveur-seme.js) ne fuit pas d'un banc a
// l'autre.
//
// Les bancs d'un meme ouvrier Playwright partagent le module. jeuDeDonnees()
// rendait le tableau CLIENTS lui-meme comme `clients` du seme : un banc qui y
// ajoutait deux clients (adresses-a-verifier.spec.js, clients.spec.js)
// l'allongeait pour les bancs lances ensuite, et le routage simule -- dont la
// table se dimensionne sur CLIENTS.length -- rendait une table 8 x 8 a une
// tournee de 6 points. meilleur-trajet.spec.js:45 rougissait alors
// (« Impossible de calculer le trajet routier. »), seulement en suite
// complete, selon l'ouvrier qui le prenait. Reproduit 3 fois sur 3 par
// `playwright test adresses-a-verifier.spec.js meilleur-trajet.spec.js --workers=1`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { jeuDeDonnees, CLIENTS } = require("./e2e/serveur-seme");

test("seme e2e : ce qu'un banc ajoute ou change a son seme ne passe pas au suivant", () => {
  const avant = CLIENTS.length;
  const premier = jeuDeDonnees();
  premier.clients.push({ id: "c-ajoute", nom: "Ajoute par un banc" });
  Object.assign(premier.clients.find(c => c.id === "c-dupont"), { geoPrecision: "rue" });
  premier.clients[0].telephone = "03 81 00 00 00";

  const second = jeuDeDonnees();
  assert.equal(CLIENTS.length, avant, "le modele des clients s'est allonge : le routage simule changera de taille");
  assert.equal(second.clients.length, avant, "le seme suivant herite des clients ajoutes par le precedent");
  assert.equal(second.clients.find(c => c.id === "c-dupont").geoPrecision, undefined, "une precision posee par un banc passe au suivant");
  assert.equal(second.clients[0].telephone, undefined, "un telephone pose par un banc passe au suivant");
});

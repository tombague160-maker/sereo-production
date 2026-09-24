// Garde-fous de saisie (lot « donnees utiles », 24/09) : le serveur
// (lib/saisie.js) et la page (public/js/utils/text.js) calculent la meme chose.
// Un ecart ferait accepter a l'ecran ce que le serveur refuse (un 400 apres
// l'envoi, au lieu d'un message sous le champ), ou l'inverse (un formulaire
// bloque sur une saisie juste).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const serveur = require("../lib/saisie");

const chargerPage = () => import("../public/js/utils/text.js");

// [saisie, normalise attendu (null = refuse)]
const TELEPHONES = [
  ["", ""],
  ["   ", ""],
  ["0612345678", "0612345678"],
  ["06 12 34 56 78", "0612345678"],
  ["06.12.34.56.78", "0612345678"],
  ["06-12-34-56-78", "0612345678"],
  ["06 12 34 56 78", "0612345678"],
  ["+33 6 12 34 56 78", "0612345678"],
  ["+33612345678", "0612345678"],
  ["+33 (0)6 12 34 56 78", "0612345678"],
  ["+330612345678", "0612345678"],
  ["0033 3 81 00 00 01", "0381000001"],
  ["abc", null],
  ["06 12 34", null],
  ["06 12 34 56 78 9", null],
  ["1234567890", null],
  ["0012345678", null],
  ["+41 32 123 45 67", null],
  ["06/12/34/56/78", null]
];

const CODES_POSTAUX = [
  ["", ""],
  ["25000", "25000"],
  ["25 000", "25000"],
  [" 39100 ", "39100"],
  ["ABCDE", null],
  ["3910", null],
  ["391000", null],
  ["2A000", null]
];

test("garde-saisie — la page et le serveur normalisent les memes telephones", async () => {
  const page = await chargerPage();
  for (const [saisi, attendu] of TELEPHONES) {
    assert.equal(serveur.normaliserTelephone(saisi), attendu, `serveur : ${JSON.stringify(saisi)}`);
    assert.equal(page.normaliserTelephone(saisi), attendu, `page : ${JSON.stringify(saisi)}`);
  }
});

test("garde-saisie — la page et le serveur normalisent les memes codes postaux", async () => {
  const page = await chargerPage();
  for (const [saisi, attendu] of CODES_POSTAUX) {
    assert.equal(serveur.normaliserCodePostalSaisi(saisi), attendu, `serveur : ${JSON.stringify(saisi)}`);
    assert.equal(page.normaliserCodePostalSaisi(saisi), attendu, `page : ${JSON.stringify(saisi)}`);
  }
});

test("garde-saisie — le numero s'affiche par deux ; un numero a verifier s'affiche tel quel", async () => {
  const page = await chargerPage();
  for (const impl of [serveur, page]) {
    assert.equal(impl.formaterTelephone("0612345678"), "06 12 34 56 78");
    assert.equal(impl.formaterTelephone("+33 3 81 00 00 01"), "03 81 00 00 01");
    assert.equal(impl.formaterTelephone(" abc "), "abc");
    assert.equal(impl.formaterTelephone(""), "");
  }
});

test("garde-saisie — a la frappe : « incomplet » attend la sortie du champ, « invalide » se dit tout de suite", async () => {
  const { verdictSaisie } = await chargerPage();
  const cas = [
    ["telephone", "", "vide"],
    ["telephone", "06 12", "incomplet"],
    ["telephone", "+33 6 1", "incomplet"],
    ["telephone", "06 12 34 56 78", "valide"],
    ["telephone", "06 12 a", "invalide"],
    ["telephone", "06 12 34 56 78 9", "invalide"],
    ["telephone", "1234567890", "invalide"],
    ["code-postal", "", "vide"],
    ["code-postal", "250", "incomplet"],
    ["code-postal", "25000", "valide"],
    ["code-postal", "2500A", "invalide"],
    ["code-postal", "250000", "invalide"]
  ];
  for (const [genre, saisi, attendu] of cas) {
    assert.equal(verdictSaisie(genre, saisi), attendu, `${genre} ${JSON.stringify(saisi)}`);
  }
});

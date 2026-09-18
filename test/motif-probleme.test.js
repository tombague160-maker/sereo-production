// Le MOTIF d'un arret en echec, et les trois confusions qu'il defait.
//
// LA CHARTE SE TROMPAIT, et c'est la mesure qui le dit. Elle annonce, §9 :
// « Un arret en "probleme" n'enregistre aucune raison [...] Un champ neuf est a
// creer. » Faux : `stop.problemReason` EXISTE. Mesure du 18/09 :
//
//   1. IL N'EST LU NULLE PART. Une seule ecriture dans server.js, zero lecture
//      dans le serveur, zero dans le client, zero dans le HTML. Un mecanisme
//      soigne et branche sur personne -- on le TROUVE en cherchant, donc on
//      conclut qu'il marche.
//
//   2. LE LIVREUR NE PEUT RIEN SAISIR. `updateCurrentDeliveryStatus` envoie
//      `{ status }` et rien d'autre. Aucun ecran ne demande de raison.
//
//   3. CE QU'IL ENREGISTRE N'EST PAS UNE RAISON. Faute de notes envoyees,
//      `stop.notes` garde ce que `createStop` y a mis : LES INSTRUCTIONS DE
//      LIVRAISON DE LA COMMANDE. Marquer un probleme sur une commande portant
//      « code portail 1234 » enregistrait « code portail 1234 » comme cause du
//      probleme. Sinon, une etiquette generique qui ne dit rien.
//
// La correction separe les deux champs pour de bon : `notes` reste l'instruction
// de livraison, `problemReason` devient le motif, et il ne se remplit QUE de ce
// que le livreur a dit.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const racine = path.join(__dirname, "..");
const CR = String.fromCharCode(13);
const lire = f => fs.readFileSync(f, "utf8").split(CR).join("");

const serveur = lire(path.join(racine, "server.js"));
const app = lire(path.join(racine, "public", "js", "app.js"));

/** Le code sans ses commentaires : eux ne s'executent pas. */
function codeSeul(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

test("motif — le champ n'est plus rempli avec les notes de la commande", () => {
  // Le defaut exact : `stop.notes` vient de la commande, pas du livreur.
  const code = codeSeul(serveur);
  assert.ok(!/problemReason\s*=\s*stop\.notes/.test(code),
    "problemReason est encore rempli avec stop.notes, c'est-a-dire avec les "
    + "instructions de livraison recopiees par createStop");
});

test("motif — le serveur accepte un motif distinct des notes", () => {
  const code = codeSeul(serveur);
  assert.match(code, /function updateRouteStop\([^)]*motif/,
    "updateRouteStop doit recevoir le motif comme parametre PROPRE : le passer "
    + "dans `notes` reproduirait exactement la confusion qu'on corrige");
  assert.match(code, /req\.body\.motif/,
    "le point d'entree PATCH doit lire le motif envoye par le client");
});

test("motif — le serveur REFUSE un motif hors de la liste", () => {
  const code = codeSeul(serveur);
  assert.match(code, /MOTIFS_PROBLEME/,
    "une liste fermee de motifs doit exister cote serveur");
  // Un texte libre reste possible, mais sous un motif nomme : sinon la liste ne
  // sert a rien et chacun ecrit ce qu'il veut, ce qui rend le releve inutilisable.
  // `.get(` compte autant que `.has(` : c'est ainsi qu'une Map se consulte. La
  // premiere redaction n'acceptait que `.has` et `.includes` et rendait un rouge
  // sur un code juste -- un motif ecrit d'apres MON attente, pas d'apres l'objet.
  assert.ok(/MOTIFS_PROBLEME\.(get|has)\(/.test(code),
    "la liste doit etre CONSULTEE, pas seulement declaree : un garde non appele "
    + "est plus trompeur qu'un garde absent");
  assert.match(code, /throw badRequest\("Motif de probleme inconnu"\)/,
    "un motif inconnu doit etre REFUSE, pas ignore en silence");
});

test("motif — le client l'ENVOIE, au lieu de n'envoyer que le statut", () => {
  const code = codeSeul(app);
  assert.ok(!/JSON\.stringify\(\{\s*status\s*\}\)/.test(code),
    "le client envoie encore `{ status }` seul : le livreur ne peut rien dire");
  assert.match(code, /JSON\.stringify\(\{\s*status,\s*motif/,
    "le corps doit porter le motif a cote du statut");
});

test("motif — le client le MONTRE, sinon rien ne change pour personne", () => {
  // La lecon de `problemReason` : ecrit une fois, lu nulle part. Un champ qu'on
  // remplit sans jamais l'afficher ne rend service a personne, et c'est
  // exactement l'etat qu'on vient de corriger.
  const code = codeSeul(app);
  const lectures = (code.match(/problemReason/g) || []).length;
  assert.ok(lectures >= 2,
    `problemReason n'apparait que ${lectures} fois dans app.js : il faut au `
    + "moins l'envoyer ET l'afficher");
});

test("motif — les libelles sont en francais accentue", () => {
  // Les motifs sont vus par le livreur sur son telephone. Huit chaines avaient
  // deja perdu leurs accents dans ce projet sans que personne ne le signale.
  // Portee SERREE sur la Map elle-meme. Une fenetre de N caracteres autour du
  // nom attrapait `libelle: "Administrateur"` -- un libelle de ROLE, a 250
  // lignes de la : une fenetre de voisinage n'est pas une appartenance.
  const bloc = serveur.match(/const MOTIFS_PROBLEME = new Map\(\[[\s\S]*?\n\]\);/);
  assert.ok(bloc, "bloc MOTIFS_PROBLEME introuvable");
  const libelles = [...bloc[0].matchAll(/libelle:\s*"([^"]+)"/g)].map(m => m[1]);
  assert.ok(libelles.length >= 5, `${libelles.length} motif(s) : trop peu pour une tournee`);

  const sansAccent = ["Absent", "absent", "Adresse", "Acces", "acces", "Refus",
    "ferme", "Ferme", "abime", "Etablissement", "manquant"];
  const fautes = [];
  for (const l of libelles) {
    for (const mot of ["Acces", "acces", "ferme", "Ferme", "abime", "Etablissement"]) {
      if (new RegExp("\\b" + mot + "\\b").test(l)) fautes.push(`${l} : ${mot}`);
    }
  }
  assert.deepEqual(fautes, [], "accents perdus dans les motifs :\n  " + fautes.join("\n  "));
  void sansAccent;
});

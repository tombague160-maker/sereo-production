// Le MOTIF d'un arret en echec, mesure sur un VRAI serveur.
//
// CE QUE CE BANC PROUVE ET QUE `motif-probleme.test.js` NE PEUT PAS PROUVER.
// L'autre lit la SOURCE : il verifie que des chaines existent. Il passerait sur
// un code qui contient les bons mots et ne fait rien. Ici le serveur tourne, la
// base est ensemencee, et on regarde ce qui est ECRIT apres la requete.
//
// LE DEFAUT MESURE LE 18/09, en trois points. La charte (§9) annoncait qu'« un
// arret en probleme n'enregistre aucune raison » et qu'« un champ neuf est a
// creer ». C'etait faux et vrai a la fois, et la nuance est tout :
//
//   1. `stop.problemReason` EXISTAIT. Mais il etait ecrit a un seul endroit et
//      LU NULLE PART -- zero lecture dans le serveur, le client et le HTML.
//
//   2. LE LIVREUR NE POUVAIT RIEN DIRE : le client envoyait `{ status }` seul.
//
//   3. CE QU'IL ENREGISTRAIT N'ETAIT PAS UNE RAISON. Faute de notes envoyees, il
//      retombait sur `stop.notes`, c'est-a-dire sur les INSTRUCTIONS DE
//      LIVRAISON recopiees de la commande par createStop. Marquer un probleme
//      sur une commande portant « Code portail 1234 » archivait « Code portail
//      1234 » comme cause du probleme.
//
// Le troisieme point est celui que ce banc garde : il ensemence une commande
// avec une instruction de livraison reconnaissable, et exige qu'elle ne ressorte
// JAMAIS comme cause.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-motif-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const { app, closeStorage, defaultDb, readDb, writeDb } = require("../server");

// L'instruction de livraison, ecrite pour etre RECONNAISSABLE dans une sortie.
// Si elle reapparait comme cause d'un probleme, le defaut est revenu.
const INSTRUCTION = "Code portail 1234, sonner chez la voisine";

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function demander(chemin, options = {}) {
  const res = await fetch(`${baseUrl}${chemin}`, options);
  const texte = await res.text();
  return { res, body: texte ? JSON.parse(texte) : null };
}

function patcher(corps) {
  return demander("/api/routes/r-motif/stops/s-motif", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps)
  });
}

/** Une tournee d'un arret, sur une commande qui PORTE une instruction. */
function ensemencer() {
  writeDb({
    ...defaultDb(),
    clients: [{ id: "c-motif", nom: "EHPAD Les Tilleuls", ville: "Dole", statut: "en_cours" }],
    commandes: [{
      id: "o-motif",
      clientId: "c-motif",
      clientName: "EHPAD Les Tilleuls",
      status: "en_livraison",
      deliveryStatus: "en_livraison",
      routeId: "r-motif",
      notes: INSTRUCTION,
      products: [{ code: "A1", nom: "Alèses", quantite: 2 }]
    }],
    routes: [{
      id: "r-motif",
      sector: "Dole",
      status: "en_livraison",
      selectedOrderIds: ["o-motif"],
      stops: [{
        id: "s-motif",
        routeId: "r-motif",
        orderId: "o-motif",
        clientId: "c-motif",
        orderIndex: 1,
        clientName: "EHPAD Les Tilleuls",
        address: "3 rue des Tilleuls",
        city: "Dole",
        postalCode: "39100",
        sector: "Dole",
        status: "en_livraison",
        notes: INSTRUCTION,
        products: [{ code: "A1", nom: "Alèses", quantite: 2 }]
      }]
    }],
    stock: [{ id: "p1", code: "A1", nom: "Alèses", quantite: 10 }]
  }, { backup: false });
}

test("motif — la liste des motifs est servie par le SERVEUR", async () => {
  // Elle doit venir d'ici et non d'une copie dans le client : deux listes
  // derivent, et l'ecart ne se verrait qu'au premier refus, sur le telephone
  // d'un livreur, au pire moment.
  const { res, body } = await demander("/api/delivery-problems");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(body.motifs), "la reponse ne porte pas de liste");
  assert.ok(body.motifs.length >= 5, `${body.motifs.length} motif(s) : trop peu pour une tournee`);
  for (const m of body.motifs) {
    assert.ok(m.cle && m.libelle, "un motif sans cle ou sans libelle");
    assert.ok(Array.isArray(m.statutsAdmis) && m.statutsAdmis.length,
      `le motif "${m.cle}" n'admet aucun statut : il ne pourra jamais etre choisi`);
  }
});

test("motif — l'instruction de livraison ne devient JAMAIS la cause", async () => {
  // LE defaut. Sans motif, l'ancien code archivait `stop.notes`.
  ensemencer();
  const { res } = await patcher({ status: "probleme" });
  assert.equal(res.status, 200);

  const arret = readDb().routes[0].stops[0];
  assert.notEqual(arret.problemReason, INSTRUCTION,
    "l'instruction de livraison de la commande est archivee comme cause du probleme");
  assert.ok(!String(arret.problemReason).includes("portail"),
    `cause archivee : « ${arret.problemReason} » — elle contient l'instruction`);
  // Et l'instruction, elle, DOIT survivre : elle sert a la prochaine tournee.
  assert.equal(arret.notes, INSTRUCTION,
    "l'instruction de livraison a ete ecrasee : elle sera perdue pour la prochaine fois");
});

test("motif — sans motif, la cause dit honnetement que personne n'a explique", async () => {
  ensemencer();
  await patcher({ status: "probleme" });
  const arret = readDb().routes[0].stops[0];
  assert.ok(arret.problemReason, "aucune cause archivee du tout");
  assert.equal(arret.problemReasonKey, "",
    "une cle de motif est archivee alors qu'aucun motif n'a ete choisi");
});

test("motif — un motif choisi est archive, avec sa precision", async () => {
  ensemencer();
  const { res } = await patcher({
    status: "probleme",
    motif: { cle: "acces", commentaire: "Portail neuf, code changé" }
  });
  assert.equal(res.status, 200);

  const arret = readDb().routes[0].stops[0];
  assert.match(arret.problemReason, /Accès impossible/,
    `cause archivee : « ${arret.problemReason} »`);
  assert.match(arret.problemReason, /Portail neuf, code changé/,
    "la precision du livreur n'a pas ete conservee");
  assert.equal(arret.problemReasonKey, "acces",
    "la CLE doit etre archivee a part : c'est elle qui se compte, pas la phrase");
});

test("motif — un motif SANS precision garde juste son libelle", async () => {
  // Le temoin qui distingue « la precision est facultative » de « la precision
  // est perdue ». Sans lui, un code qui jetterait le commentaire passerait.
  ensemencer();
  await patcher({ status: "absent", motif: { cle: "ferme", commentaire: "" } });
  const arret = readDb().routes[0].stops[0];
  assert.equal(arret.problemReason, "Établissement fermé",
    `cause archivee : « ${arret.problemReason} »`);
});

test("motif — un motif INCONNU est refuse, pas ignore en silence", async () => {
  ensemencer();
  const { res, body } = await patcher({ status: "probleme", motif: { cle: "nimportequoi" } });
  assert.equal(res.status, 400, "un motif invente doit etre refuse");
  assert.match(String(body?.error || ""), /[Mm]otif/);

  // Et RIEN ne doit avoir bouge : un refus qui laisse un effet de bord est pire
  // qu'une acceptation.
  const arret = readDb().routes[0].stops[0];
  assert.equal(arret.status, "en_livraison", "le statut a change malgre le refus");
  assert.ok(!arret.problemReason, "une cause a ete archivee malgre le refus");
});

test("motif — un motif qui ne va pas avec le statut est refuse", async () => {
  // « Commande refusée » n'a pas de sens sur un « absent » : il n'y avait
  // personne pour refuser quoi que ce soit. La liste porte cette contrainte,
  // et le serveur la fait respecter.
  ensemencer();
  const { res, body } = await patcher({ status: "absent", motif: { cle: "refus" } });
  assert.equal(res.status, 400, "un motif hors de ses statuts admis doit etre refuse");
  assert.match(String(body?.error || ""), /ne s'applique pas/);
});

test("motif — la cause voyage dans l'HISTORIQUE", async () => {
  // Un statut sans sa cause n'apprend rien a celui qui relit une tournee passee,
  // et l'historique est le seul endroit ou elle se relit.
  ensemencer();
  await patcher({ status: "probleme", motif: { cle: "adresse", commentaire: "" } });

  const db = readDb();
  const lignes = (db.historique || []).filter(h => /Livraison/i.test(h.type || ""));
  assert.ok(lignes.length, "aucune ligne d'historique pour cette livraison");
  const derniere = lignes[lignes.length - 1];
  assert.match(String(derniere.message || derniere.libelle || JSON.stringify(derniere)),
    /Adresse introuvable/,
    "l'historique retient le statut mais pas la cause");
});

test("motif — un arret LIVRE n'archive aucune cause", async () => {
  // Le contre-temoin. Sans lui, un code qui poserait une cause sur tout passerait
  // tous les cas precedents.
  ensemencer();
  const { res } = await patcher({ status: "livre" });
  assert.equal(res.status, 200);
  const arret = readDb().routes[0].stops[0];
  assert.ok(!arret.problemReason, `une cause a ete archivee sur une livraison reussie : « ${arret.problemReason} »`);
});

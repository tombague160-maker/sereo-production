// La file d'attente des ecritures hors ligne.
//
// CE QUE CE BANC PROUVE, ET CE QU'IL NE PROUVE PAS.
//
// Il remplace indexedDB par une doublure en memoire. La doublure ne tient lieu
// que de STOCKAGE : elle ne juge ni la persistance reelle, ni la survie a un
// rechargement, ni le comportement du vrai moteur. Un banc bati avec mes
// propres hypotheses mesure mon attente, pas le produit -- donc ce banc est
// DELIBEREMENT limite a la LOGIQUE DE REJEU, et c'est l'e2e
// (test/e2e/hors-ligne.spec.js) qui mesure le stockage veritable, dans un vrai
// navigateur, avec `context.setOffline(true)`.
//
// Les quatre decisions que la logique de rejeu porte, et que ce banc distingue :
//
//   1. L'ORDRE. Deux ecritures sur la meme commande -- "en preparation" puis
//      "livree" -- rejouees a l'envers laissent la commande dans un etat
//      ANTERIEUR a la realite. Un echec doit donc arreter la file, pas la sauter.
//
//   2. "le reseau n'a pas repondu" != "le serveur a refuse". Un 4xx se retire
//      (le serveur a dit non, insister ferait une file eternelle) ; un echec
//      reseau se garde.
//
//   3. Le compteur d'essais ne compte QUE les 5xx. Il existe pour arreter une
//      entree empoisonnee, et seule une REPONSE peut indiquer un
//      empoisonnement. Premier jet : il comptait aussi les echecs reseau, si
//      bien que cinq reconnexions ratees bloquaient une ecriture valide.
//
//   4. Un envoi de FICHIER ne se differe pas. Rejouer un import Excel trois
//      heures plus tard, sur un stock qui a bouge, ferait plus de degats que de
//      refuser tout de suite.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// --- La doublure de stockage -------------------------------------------------
// Minimale et explicite : les evenements partent en ASYNCHRONE, parce que le
// code assigne ses gestionnaires APRES l'appel. Une doublure synchrone les
// manquerait tous et rendrait un banc vert qui n'a rien execute.

const bases = new Map();

function requete(calcul) {
  const r = { result: undefined, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    try {
      r.result = calcul();
      if (r.onsuccess) r.onsuccess();
    } catch (err) {
      r.error = err;
      if (r.onerror) r.onerror();
    }
  });
  return r;
}

function faireBase(nom) {
  const donnees = new Map();
  let suivant = 1;
  const magasins = new Set();
  return {
    donnees,
    prochainId: () => suivant++,
    magasins,
    objectStoreNames: { contains: n => magasins.has(n) },
    createObjectStore(n) { magasins.add(n); return {}; },
    close() {},
    transaction(_n, _mode) {
      return {
        objectStore() {
          return {
            add: v => requete(() => { const id = suivant++; donnees.set(id, { ...v, id }); return id; }),
            put: v => requete(() => { donnees.set(v.id, { ...v }); return v.id; }),
            delete: id => requete(() => { donnees.delete(id); return undefined; }),
            clear: () => requete(() => { donnees.clear(); return undefined; }),
            getAll: () => requete(() => [...donnees.values()])
          };
        }
      };
    },
    nom
  };
}

globalThis.indexedDB = {
  open(nom) {
    const neuve = !bases.has(nom);
    if (neuve) bases.set(nom, faireBase(nom));
    const base = bases.get(nom);
    const r = { result: base, onupgradeneeded: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      if (neuve && r.onupgradeneeded) r.onupgradeneeded();
      if (r.onsuccess) r.onsuccess();
    });
    return r;
  }
};

const chargerFile = () => import("../public/js/utils/file-attente.js");

beforeEach(async () => {
  const { viderFile } = await chargerFile();
  await viderFile();
});

/** Fabrique un `envoyer` qui rend les reponses prescrites, et note ce qu'il voit. */
function envoyeurScripte(reponses) {
  const vues = [];
  let i = 0;
  const envoyer = async (url, options) => {
    vues.push({ url, methode: options.method, corps: options.body });
    const r = reponses[Math.min(i, reponses.length - 1)];
    i++;
    if (r === "reseau-coupe") throw new TypeError("Failed to fetch");
    return { ok: r >= 200 && r < 300, status: r };
  };
  return { envoyer, vues };
}

test("file — l'ordre de depot est preserve, et un echec ARRETE la file", async () => {
  const { mettreEnAttente, rejouer, lireFile } = await chargerFile();

  await mettreEnAttente("/api/orders/7", { method: "PATCH", body: '{"statut":"en-preparation"}' });
  await mettreEnAttente("/api/orders/7", { method: "PATCH", body: '{"statut":"livree"}' });

  // Le reseau refuse la PREMIERE. Si la file sautait l'entree bloquee, la
  // seconde partirait -- et la commande finirait "en preparation" alors qu'elle
  // est livree. C'est le defaut exact que ce cas distingue.
  const { envoyer, vues } = envoyeurScripte(["reseau-coupe"]);
  const bilan = await rejouer(envoyer);

  assert.equal(vues.length, 1, "la file a continue apres un echec : l'ordre est casse");
  assert.equal(JSON.parse(vues[0].corps).statut, "en-preparation");
  assert.equal(bilan.envoyees, 0);
  assert.equal(bilan.restantes, 2, "un echec reseau ne doit RIEN retirer");
  assert.equal((await lireFile()).length, 2);
});

test("file — les deux ecritures partent DANS L'ORDRE quand le reseau revient", async () => {
  // Le temoin positif du cas precedent. Sans lui, un `rejouer` qui n'enverrait
  // jamais rien passerait le test d'ordre sans rien avoir distingue.
  const { mettreEnAttente, rejouer } = await chargerFile();

  await mettreEnAttente("/api/orders/7", { method: "PATCH", body: '{"statut":"en-preparation"}' });
  await mettreEnAttente("/api/orders/7", { method: "PATCH", body: '{"statut":"livree"}' });

  const { envoyer, vues } = envoyeurScripte([200]);
  const bilan = await rejouer(envoyer);

  assert.equal(bilan.envoyees, 2);
  assert.equal(bilan.restantes, 0);
  assert.deepEqual(vues.map(v => JSON.parse(v.corps).statut), ["en-preparation", "livree"]);
});

test("file — un REFUS du serveur (4xx) retire l'ecriture, un echec reseau la garde", async () => {
  const { mettreEnAttente, rejouer } = await chargerFile();

  await mettreEnAttente("/api/orders", { method: "POST", body: '{"client":"inconnu"}' });
  const refus = await rejouer(envoyeurScripte([422]).envoyer);
  assert.equal(refus.refusees, 1, "un 422 doit retirer : le serveur a dit non");
  assert.equal(refus.restantes, 0, "la file ne se viderait jamais");

  await mettreEnAttente("/api/orders", { method: "POST", body: '{"client":"ok"}' });
  const coupe = await rejouer(envoyeurScripte(["reseau-coupe"]).envoyer);
  assert.equal(coupe.refusees, 0);
  assert.equal(coupe.restantes, 1, "un echec reseau ne doit pas perdre l'ecriture");
});

test("file — un 5xx CONSERVE l'ecriture et arrete la file", async () => {
  const { mettreEnAttente, rejouer } = await chargerFile();
  await mettreEnAttente("/api/orders", { method: "POST", body: '{"a":1}' });
  await mettreEnAttente("/api/orders", { method: "POST", body: '{"b":2}' });

  const { envoyer, vues } = envoyeurScripte([503]);
  const bilan = await rejouer(envoyer);

  assert.equal(vues.length, 1, "le serveur est en panne : insister sur la suite ne sert a rien");
  assert.equal(bilan.restantes, 2, "un 503 n'est pas un refus : le serveur n'a pas juge l'ecriture");
  assert.equal(bilan.refusees, 0);
});

test("file — le compteur d'essais ignore les echecs RESEAU", async () => {
  // Le defaut de mon premier jet : cinq reconnexions ratees suffisaient a
  // bloquer definitivement une ecriture parfaitement valide, parce que le
  // compteur punissait l'entree pour un defaut du reseau.
  const { mettreEnAttente, rejouer, ESSAIS_MAX } = await chargerFile();
  await mettreEnAttente("/api/orders", { method: "POST", body: '{"a":1}' });

  for (let i = 0; i < ESSAIS_MAX + 2; i++) {
    const bilan = await rejouer(envoyeurScripte(["reseau-coupe"]).envoyer);
    assert.equal(bilan.bloquee, false, `bloquee a la tentative ${i + 1} : le reseau n'est pas la faute de l'ecriture`);
  }

  // Et elle part toujours quand le reseau revient.
  const bilan = await rejouer(envoyeurScripte([200]).envoyer);
  assert.equal(bilan.envoyees, 1, "l'ecriture a ete perdue en route");
});

test("file — le compteur d'essais compte les 5xx, et finit par BLOQUER", async () => {
  // Le contre-temoin du precedent : le compteur doit quand meme exister, sinon
  // une entree empoisonnee serait rejouee a l'infini. Le seuil se prouve dans
  // les deux sens -- il ne se declenche pas sur le reseau, il se declenche ici.
  const { mettreEnAttente, rejouer, ESSAIS_MAX } = await chargerFile();
  await mettreEnAttente("/api/orders", { method: "POST", body: '{"a":1}' });

  for (let i = 0; i < ESSAIS_MAX; i++) {
    const bilan = await rejouer(envoyeurScripte([500]).envoyer);
    assert.equal(bilan.bloquee, false, `bloquee trop tot, a la tentative ${i + 1}`);
  }

  const { envoyer, vues } = envoyeurScripte([500]);
  const bilan = await rejouer(envoyer);
  assert.equal(bilan.bloquee, true, `non bloquee apres ${ESSAIS_MAX} refus 5xx`);
  assert.equal(vues.length, 0, "une entree a bout d'essais ne doit plus etre envoyee");
  assert.equal(bilan.restantes, 1, "bloquer n'est pas perdre : l'ecriture reste consultable");
});

test("file — une entree bloquee BLOQUE, elle ne se saute pas", async () => {
  // Le vrai enjeu du blocage. `essais` ne s'incremente qu'apres un echec et un
  // echec fait `break` : c'est donc TOUJOURS la tete de file qui atteint le
  // plafond la premiere. La sauter enverrait la deuxieme ecriture avant la
  // premiere -- exactement le reordonnancement que la file existe pour eviter.
  const { mettreEnAttente, rejouer, ESSAIS_MAX } = await chargerFile();
  await mettreEnAttente("/api/orders/7", { method: "PATCH", body: '{"statut":"en-preparation"}' });
  await mettreEnAttente("/api/orders/7", { method: "PATCH", body: '{"statut":"livree"}' });

  for (let i = 0; i < ESSAIS_MAX; i++) await rejouer(envoyeurScripte([500]).envoyer);

  // Le serveur va mieux. La tete reste bloquee : la SUITE ne doit pas passer.
  const { envoyer, vues } = envoyeurScripte([200]);
  const bilan = await rejouer(envoyer);
  assert.equal(vues.length, 0, "\"livree\" est parti sans \"en preparation\" : l'ordre est casse");
  assert.equal(bilan.bloquee, true);
  assert.equal(bilan.restantes, 2);
});

test("file — un envoi de FICHIER n'est jamais mis en attente", async () => {
  const { mettreEnAttente, compterFile } = await chargerFile();
  const faux = new FormData();
  faux.append("fichier", "stock.xlsx");

  await assert.rejects(
    () => mettreEnAttente("/api/import/stock", { method: "POST", body: faux }),
    /fichier/i,
    "un import differe de trois heures s'appliquerait a un stock qui a bouge");
  assert.equal(await compterFile(), 0, "le refus ne doit rien laisser derriere lui");
});

test("file — des en-tetes Headers sont ramenes a un objet clonable", async () => {
  // indexedDB refuse un objet Headers (non clonable par structured clone). Sans
  // normalisation, la mise en file ECHOUERAIT -- donc perdrait l'ecriture
  // qu'elle existe pour sauver. Le defaut serait invisible : indexedDB rendrait
  // une DataCloneError, notre try/catch la mangerait, et l'application se
  // comporterait exactement comme avant la file.
  const { mettreEnAttente, lireFile } = await chargerFile();
  const entetes = new Headers({ "Content-Type": "application/json" });
  await mettreEnAttente("/api/orders", { method: "POST", headers: entetes, body: "{}" });

  const [entree] = await lireFile();
  assert.equal(Object.getPrototypeOf(entree.entetes), Object.prototype,
    "les en-tetes doivent etre un objet simple");
  assert.equal(entree.entetes["content-type"] || entree.entetes["Content-Type"], "application/json");
});

test("file — la methode par defaut est POST, et elle est conservee telle quelle", async () => {
  const { mettreEnAttente, lireFile } = await chargerFile();
  await mettreEnAttente("/api/a", { body: "{}" });
  await mettreEnAttente("/api/b", { method: "DELETE" });

  const file = await lireFile();
  assert.deepEqual(file.map(e => e.methode), ["POST", "DELETE"]);
});

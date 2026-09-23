// File d'attente des ecritures hors ligne.
//
// LE DEFAUT QU'ELLE FERME, mesure le 18/09 :
//   32 ecritures reseau dans app.js (POST / PATCH / PUT / DELETE)
//    0 ecouteur "online" ou "offline"
//    0 ecouteur "sync" dans le service worker
// Un echec reseau leve une exception, l'utilisateur voit un toast rouge, et la
// donnee est PERDUE. Pour un livreur en zone blanche qui valide une livraison,
// c'est la seule chose que l'application ne devait pas faire.
//
// La LECTURE hors ligne, elle, existait deja : network-first a 3 s puis cache.
// C'est l'ecriture qui manquait, et l'ecart entre les deux est exactement ce
// qui rend le defaut invisible -- l'application paraissait fonctionner hors
// ligne.
//
// --- POURQUOI indexedDB ET NON localStorage ---------------------------------
// localStorage est SYNCHRONE et plafonne a ~5 Mo par origine. Une file
// d'ecritures doit survivre a une fermeture d'onglet, a un rechargement, et a
// un telephone qu'on range dans une poche pendant deux heures. indexedDB
// survit aux trois et n'a pas de limite pratique ici.
//
// --- POURQUOI PAS Background Sync ------------------------------------------
// L'API SyncManager rejouerait la file meme onglet ferme, ce qui serait mieux.
// Mais elle n'existe pas sur iOS Safari, et la tournee se fait au telephone.
// Une solution qui ne marche pas sur la moitie du parc n'en est pas une. On
// rejoue donc a la reconnexion et a l'ouverture, ce qui couvre tous les
// navigateurs, au prix d'un onglet a rouvrir.

const BASE = "sereo-file-attente";
const MAGASIN = "ecritures";
const VERSION = 1;

/** Ouvre la base, en la creant au besoin. */
function ouvrir() {
  return new Promise((ok, ko) => {
    if (typeof indexedDB === "undefined") {
      ko(new Error("indexedDB indisponible"));
      return;
    }
    const demande = indexedDB.open(BASE, VERSION);
    demande.onupgradeneeded = () => {
      const db = demande.result;
      if (!db.objectStoreNames.contains(MAGASIN)) {
        db.createObjectStore(MAGASIN, { keyPath: "id", autoIncrement: true });
      }
    };
    demande.onsuccess = () => ok(demande.result);
    demande.onerror = () => ko(demande.error);
  });
}

function transaction(db, mode) {
  return db.transaction(MAGASIN, mode).objectStore(MAGASIN);
}

function attendre(requete) {
  return new Promise((ok, ko) => {
    requete.onsuccess = () => ok(requete.result);
    requete.onerror = () => ko(requete.error);
  });
}

function resumer(resume) {
  if (!resume || typeof resume !== "object") return null;
  const propre = {};
  for (const cle of ["nature", "nom", "statut", "routeId", "stopId"]) {
    if (typeof resume[cle] === "string" && resume[cle]) propre[cle] = resume[cle].slice(0, 200);
  }
  return Object.keys(propre).length ? propre : null;
}

/** Ramene des en-tetes, quelle que soit leur forme, a un objet clonable. */
function normaliserEntetes(entetes) {
  if (!entetes) return {};
  if (typeof Headers !== "undefined" && entetes instanceof Headers) {
    return Object.fromEntries(entetes.entries());
  }
  if (Array.isArray(entetes)) return Object.fromEntries(entetes);
  return { ...entetes };
}

/**
 * Met une ecriture en attente.
 *
 * On enregistre l'URL, la methode, les en-tetes et le CORPS SERIALISE. Un
 * FormData n'est pas serialisable et n'est donc PAS mis en file : les imports
 * de fichiers restent refuses hors ligne, et c'est voulu -- rejouer un import
 * Excel trois heures plus tard, sur un stock qui a bouge, ferait plus de degats
 * que de refuser.
 */
export async function mettreEnAttente(url, options = {}) {
  if (options.body instanceof FormData) {
    throw new Error("Un envoi de fichier ne peut pas etre mis en attente.");
  }
  const db = await ouvrir();
  const entree = {
    url,
    methode: options.method || "POST",
    // Normalise : un objet Headers n'est PAS clonable par structured clone, et
    // indexedDB le refuserait a l'ecriture. app.js passe des objets simples,
    // mais un seul appelant qui passerait un Headers ferait echouer la mise en
    // file -- donc perdrait l'ecriture qu'on est en train de sauver.
    entetes: normaliserEntetes(options.headers),
    corps: typeof options.body === "string" ? options.body : null,
    depose: new Date().toISOString(),
    essais: 0
  };
  // Ce que l'ecran dira de l'ecriture en attente (« 1 livraison en attente
  // d'envoi : Dupont »). Recopie champ par champ : seules des chaines passent.
  const resume = resumer(options.resume);
  if (resume) entree.resume = resume;
  const id = await attendre(transaction(db, "readwrite").add(entree));
  db.close();
  return id;
}

/** Les ecritures en attente, de la plus ancienne a la plus recente. */
export async function lireFile() {
  try {
    const db = await ouvrir();
    const tout = await attendre(transaction(db, "readonly").getAll());
    db.close();
    return tout.sort((a, b) => String(a.depose).localeCompare(String(b.depose)));
  } catch {
    return [];
  }
}

export async function compterFile() {
  return (await lireFile()).length;
}

async function retirer(id) {
  const db = await ouvrir();
  await attendre(transaction(db, "readwrite").delete(id));
  db.close();
}

async function incrementerEssais(entree) {
  const db = await ouvrir();
  await attendre(transaction(db, "readwrite").put({ ...entree, essais: (entree.essais || 0) + 1 }));
  db.close();
}

/**
 * Au-dela, on cesse de rejouer : l'ecriture est conservee mais plus retentee.
 * Ne compte QUE les refus 5xx du serveur, jamais les echecs reseau.
 */
export const ESSAIS_MAX = 5;

/**
 * Rejoue la file, dans l'ORDRE DE DEPOT.
 *
 * L'ordre n'est pas un detail : deux ecritures sur la meme commande -- "en
 * preparation" puis "livree" -- rejouees a l'envers laisseraient la commande
 * dans un etat anterieur a la realite. On s'arrete donc au premier echec
 * reseau plutot que de continuer la file : si le reseau est reparti, la suite
 * passera au prochain appel ; s'il est toujours coupe, insister ne sert a rien.
 *
 * Un refus du SERVEUR (4xx) est traite autrement : l'ecriture est retiree. Le
 * serveur a repondu, il a dit non, et la rejouer indefiniment ferait une file
 * qui ne se vide jamais. C'est la distinction qui compte -- "le reseau n'a pas
 * repondu" et "le serveur a refuse" ne demandent pas le meme geste.
 *
 * UNE ENTREE A BOUT D'ESSAIS BLOQUE LA FILE, elle ne se saute pas. Premier jet :
 * on passait a la suivante. Mais `essais` ne s'incremente qu'apres un echec, et
 * un echec fait `break` -- c'est donc TOUJOURS la tete de file qui atteint le
 * plafond la premiere. La sauter enverrait la deuxieme ecriture avant la
 * premiere : "livree" avant "en preparation". Bloquer est le comportement
 * correct, et il rend le probleme VISIBLE au lieu de reordonner en silence.
 *
 * CE QUI N'EST PAS UN REFUS (lot 1 de l'audit geo, 23/09) :
 *  - 401 (session expiree) et 429 (connexion verrouillee) : ce n'est pas
 *    l'ecriture que le serveur refuse, c'est la PERSONNE qu'il ne reconnait
 *    pas. Premier jet : un 4xx comme les autres, donc RETIRE -- le livreur qui
 *    rouvrait l'application le lendemain matin perdait les livraisons faites
 *    hors ligne la veille. On s'arrete, on GARDE tout, et on rend
 *    `authRequise` : l'appelant renvoie vers la connexion, et la file repart
 *    apres.
 *  - 408, 502, 503, 504 : le serveur (ou la passerelle devant lui) n'a pas
 *    traite la demande. C'est un echec de transport, comme un fetch qui leve :
 *    on s'arrete sans incrementer.
 *
 * UN SEUL RENVOI A LA FOIS (M9). Le reseau qui clignote en voiture envoie
 * plusieurs « online » pendant qu'un renvoi tourne ; deux boucles lisaient la
 * meme file et envoyaient chaque ecriture deux fois. Un appel pendant un
 * renvoi en cours rend la MEME promesse, et demande un passage de plus a la
 * fin (une ecriture mise en file entre-temps n'attend pas le prochain
 * « online »). Entre deux onglets, le verrou du navigateur (Web Locks) fait
 * la meme chose quand il existe ; la cle X-Sereo-Geste rend de toute facon un
 * double envoi inoffensif cote serveur.
 *
 * @param {Function} envoyer  (url, options) => Response
 * @returns {{envoyees: number, refusees: number, restantes: number, bloquee: boolean,
 *            authRequise: boolean, refus: Array<{resume: object|null, statut: number}>}}
 */
const STATUTS_AUTH = new Set([401, 429]);
const STATUTS_TRANSPORT = new Set([408, 502, 503, 504]);

let rejeuEnCours = null;
let rejeuRedemande = false;

export function rejouer(envoyer) {
  if (rejeuEnCours) {
    rejeuRedemande = true;
    return rejeuEnCours;
  }
  rejeuEnCours = (async () => {
    const bilan = { envoyees: 0, refusees: 0, restantes: 0, bloquee: false, authRequise: false, refus: [] };
    try {
      let passage;
      do {
        rejeuRedemande = false;
        passage = await sousVerrou(() => unPassage(envoyer));
        bilan.envoyees += passage.envoyees;
        bilan.refusees += passage.refusees;
        bilan.refus.push(...passage.refus);
        bilan.bloquee = passage.bloquee;
        bilan.authRequise = passage.authRequise;
      } while (rejeuRedemande && !passage.arrete);
      bilan.restantes = (await lireFile()).length;
      return bilan;
    } finally {
      rejeuEnCours = null;
    }
  })();
  return rejeuEnCours;
}

function sousVerrou(travail) {
  const verrous = typeof navigator !== "undefined" ? navigator.locks : null;
  if (verrous && typeof verrous.request === "function") {
    return verrous.request("sereo-file-attente", travail);
  }
  return travail();
}

async function unPassage(envoyer) {
  const file = await lireFile();
  const passage = { envoyees: 0, refusees: 0, bloquee: false, authRequise: false, arrete: false, refus: [] };

  for (const entree of file) {
    if ((entree.essais || 0) >= ESSAIS_MAX) { passage.bloquee = true; passage.arrete = true; break; }
    let reponse;
    try {
      reponse = await envoyer(entree.url, {
        method: entree.methode,
        headers: entree.entetes,
        body: entree.corps
      });
    } catch {
      // Reseau toujours coupe. On s'arrete, l'ordre est preserve -- et on
      // N'INCREMENTE PAS. Le compteur existe pour arreter une entree EMPOISONNEE,
      // et seule une REPONSE du serveur peut indiquer un empoisonnement ; un
      // fetch qui leve ne dit rien du contenu de l'ecriture. Premier jet : on
      // incrementait ici, si bien que cinq reconnexions ratees bloquaient
      // definitivement une ecriture parfaitement valide.
      passage.arrete = true;
      break;
    }
    const statut = reponse ? reponse.status : 0;
    if (reponse && reponse.ok) {
      await retirer(entree.id);
      passage.envoyees++;
    } else if (STATUTS_AUTH.has(statut)) {
      // Session expiree : l'ecriture RESTE, la file aussi. Voir plus haut.
      passage.authRequise = true;
      passage.arrete = true;
      break;
    } else if (STATUTS_TRANSPORT.has(statut)) {
      passage.arrete = true;
      break;
    } else if (statut >= 400 && statut < 500) {
      // Le serveur a repondu non. La rejouer ferait une file eternelle.
      await retirer(entree.id);
      passage.refusees++;
      passage.refus.push({ resume: entree.resume || null, statut });
    } else {
      await incrementerEssais(entree);
      passage.arrete = true;
      break;
    }
  }

  return passage;
}

/** Vide la file. Reserve a un geste explicite de l'utilisateur. */
export async function viderFile() {
  const db = await ouvrir();
  await attendre(transaction(db, "readwrite").clear());
  db.close();
}

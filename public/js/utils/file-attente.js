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
 * @param {Function} envoyer  (url, options) => Response
 * @returns {{envoyees: number, refusees: number, restantes: number, bloquee: boolean}}
 */
export async function rejouer(envoyer) {
  const file = await lireFile();
  let envoyees = 0;
  let refusees = 0;
  let bloquee = false;

  for (const entree of file) {
    if ((entree.essais || 0) >= ESSAIS_MAX) { bloquee = true; break; }
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
      break;
    }
    if (reponse && reponse.ok) {
      await retirer(entree.id);
      envoyees++;
    } else if (reponse && reponse.status >= 400 && reponse.status < 500) {
      // Le serveur a repondu non. La rejouer ferait une file eternelle.
      await retirer(entree.id);
      refusees++;
    } else {
      await incrementerEssais(entree);
      break;
    }
  }

  return { envoyees, refusees, restantes: (await lireFile()).length, bloquee };
}

/** Vide la file. Reserve a un geste explicite de l'utilisateur. */
export async function viderFile() {
  const db = await ouvrir();
  await attendre(transaction(db, "readwrite").clear());
  db.close();
}

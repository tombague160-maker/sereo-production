// Sauvegarde COHERENTE et VERIFIEE d'une base SQLite en service (garde-fous, 25/09).
//
// Avant : la sauvegarde automatique lisait le FICHIER principal en flux, hors
// verrou, pendant que d'autres ecritures committaient. Un checkpoint du WAL
// (automatique a 1 000 pages, ou force) reecrivait le fichier au milieu de la
// lecture : la copie melangeait des pages d'avant et d'apres (« database disk
// image is malformed », mesure 2 fois sur 2 pendant un gros import). Rien ne le
// verifiait ; la purge des tournees effacait sur la foi de cette copie.
//
// Maintenant, dans un thread de travail (le serveur continue de repondre) :
//   1. `VACUUM INTO` depuis une SECONDE connexion en lecture seule : SQLite
//      copie un instantane de la base tel qu'au debut de sa transaction de
//      lecture, meme si le fil principal ecrit et checkpointe pendant ce temps
//      (WAL : un lecteur ne bloque pas l'ecrivain, et reciproquement) ;
//   2. compression gzip de cette copie ;
//   3. VERIFICATION du fichier compresse lui-meme, tel qu'une restauration le
//      lirait : decompression, ouverture, `PRAGMA integrity_check` = « ok », et
//      le compte (et l'empreinte des identifiants) des tables demandees ;
//   4. seulement alors, renommage atomique vers le nom final.
// Un echec a n'importe quelle etape leve une erreur et ne laisse aucun fichier
// final : une sauvegarde qui porte son nom definitif a ete relue.
//
// L'API `backup()` de node:sqlite a ete essayee d'abord (24/09) : sous des
// ecritures continues, elle ne terminait pas (tuee apres 120 s). VACUUM INTO
// termine en un temps borne : 87 Mo en 354 ms pendant 43 lots d'ecriture, sur
// ce poste.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { Worker } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");

const TRAVAIL = path.join(__dirname, "sauvegarde-travail.js");
const NOM_DE_TABLE = /^[a-z_][a-z0-9_]*$/;

/**
 * Compte et empreinte des identifiants d'une table (connexion node:sqlite).
 * Deux bases qui ont la meme empreinte pour une table en ont exactement les
 * memes lignes, par identifiant. Sert a la verification d'une sauvegarde (le
 * thread de travail) ET au releve de la base en service (le serveur) : la meme
 * requete des deux cotes.
 */
function releverTable(base, table) {
  if (!NOM_DE_TABLE.test(table)) throw new Error(`table invalide : ${table}`);
  const existe = base.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!existe) return { compte: 0, empreinte: "" };
  const ids = base.prepare(`SELECT id FROM ${table} ORDER BY id`).all().map(ligne => String(ligne.id));
  return { compte: ids.length, empreinte: crypto.createHash("sha256").update(ids.join("\n")).digest("hex") };
}

function supprimerBase(chemin) {
  for (const suffixe of ["", "-wal", "-shm", "-journal"]) {
    try { fs.unlinkSync(chemin + suffixe); } catch { /* absent : ok */ }
  }
}

/**
 * Relit une sauvegarde COMPRESSEE comme une restauration la lirait (etape 3
 * du thread de travail) : decompression sous plafond vers `verification`,
 * ouverture en lecture seule, `PRAGMA integrity_check` = « ok », puis le releve
 * des tables demandees. Le fichier de verification est supprime dans tous les
 * cas. Leve si la sauvegarde ne se relit pas.
 *
 * A part (reprise du 26/09) pour etre eprouvee sur une copie abimee APRES son
 * ecriture : le banc de la copie abimait la SOURCE, VACUUM INTO echouait avant
 * toute relecture, et l'integrity_check de la copie n'etait garde par rien
 * (mutant qui le retire : banc vert).
 */
async function relireSauvegarde({ compresse, verification, tables = [], maxOctets = 1024 * 1024 * 1024 }) {
  let decompresses = 0;
  const plafond = new Transform({
    transform(morceau, _encodage, suite) {
      decompresses += morceau.length;
      if (decompresses > maxOctets) suite(new Error("sauvegarde : decompression au-dela du plafond"));
      else suite(null, morceau);
    }
  });
  try {
    await pipeline(
      fs.createReadStream(compresse),
      zlib.createGunzip(),
      plafond,
      fs.createWriteStream(verification)
    );
    const comptes = {};
    const empreintes = {};
    const relue = new DatabaseSync(verification, { readOnly: true });
    try {
      const integrite = relue.prepare("PRAGMA integrity_check").all().map(ligne => Object.values(ligne)[0]);
      if (integrite.length !== 1 || integrite[0] !== "ok") {
        throw new Error(`sauvegarde illisible (integrity_check) : ${integrite.join(" | ").slice(0, 300)}`);
      }
      for (const table of tables) {
        const releve = releverTable(relue, table);
        comptes[table] = releve.compte;
        empreintes[table] = releve.empreinte;
      }
    } finally {
      relue.close();
    }
    return { comptes, empreintes };
  } finally {
    supprimerBase(verification);
  }
}

/**
 * @param {object} options
 * @param {string} options.source       la base en service (.sqlite)
 * @param {string} options.destination  le fichier final (.sqlite.gz)
 * @param {string[]} [options.tables]   tables a compter dans la copie verifiee
 * @param {number} [options.maxOctets]  plafond de decompression a la verification
 * @returns {Promise<{ octets: number, sha256: string, comptes: object, empreintes: object }>}
 */
function copierEtVerifier({ source, destination, tables = [], maxOctets = 1024 * 1024 * 1024 }) {
  return new Promise((resolve, reject) => {
    const travail = new Worker(TRAVAIL, { workerData: { source, destination, tables, maxOctets } });
    let fini = false;
    travail.once("message", message => {
      fini = true;
      if (message && message.ok) resolve(message.resultat);
      else reject(new Error(message?.erreur || "sauvegarde : echec sans message"));
    });
    travail.once("error", error => {
      fini = true;
      reject(error);
    });
    travail.once("exit", code => {
      if (!fini) reject(new Error(`sauvegarde : le thread de travail s'est arrete (code ${code})`));
    });
  });
}

/** Les fichiers de travail d'une sauvegarde (a nettoyer si elle est interrompue). */
function fichiersDeTravail(destination) {
  return {
    copie: `${destination}.travail-copie.sqlite`,
    verification: `${destination}.travail-verif.sqlite`,
    compresse: `${destination}.tmp`
  };
}

// Un nom de fichier de travail laisse par une sauvegarde interrompue (arret du
// processus pendant la copie) : rien d'autre ne les supprime.
const MOTIF_TRAVAIL = /^db-.*\.gz(\.tmp|\.travail-(copie|verif)\.sqlite(-wal|-shm|-journal)?)$/;

module.exports = { copierEtVerifier, fichiersDeTravail, relireSauvegarde, releverTable, MOTIF_TRAVAIL };

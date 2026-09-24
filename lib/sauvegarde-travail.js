// Thread de travail d'une sauvegarde (voir lib/sauvegarde-base.js) : copie
// coherente par VACUUM INTO, compression, puis relecture du fichier compresse
// comme une restauration le lirait. Le fil principal du serveur n'attend rien.

const crypto = require("node:crypto");
const fs = require("node:fs");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const { fichiersDeTravail, releverTable } = require("./sauvegarde-base");

// Ce fichier ne s'execute que comme thread de travail : il n'exporte rien
// (l'importer depuis le fil principal lancerait une sauvegarde sans donnees).

function supprimer(chemin) {
  for (const suffixe of ["", "-wal", "-shm", "-journal"]) {
    try { fs.unlinkSync(chemin + suffixe); } catch { /* absent : ok */ }
  }
}

async function sauvegarder({ source, destination, tables, maxOctets }) {
  const travail = fichiersDeTravail(destination);
  supprimer(travail.copie);
  supprimer(travail.verification);
  try { fs.unlinkSync(travail.compresse); } catch { /* absent : ok */ }

  try {
    // 1. Instantane coherent. Lecture seule : cette connexion n'ecrit jamais
    //    dans la base en service. busy_timeout : un verrou bref (checkpoint en
    //    cours) est attendu plutot que de faire echouer la sauvegarde.
    const lecteur = new DatabaseSync(source, { readOnly: true });
    try {
      lecteur.exec("PRAGMA busy_timeout = 5000");
      lecteur.exec(`VACUUM INTO '${travail.copie.replace(/'/g, "''")}'`);
    } finally {
      lecteur.close();
    }

    // 2. Compression, avec l'empreinte du fichier compresse (pour verifier une
    //    copie dans un second dossier sans la relire deux fois).
    const hachage = crypto.createHash("sha256");
    let octets = 0;
    const compter = new Transform({
      transform(morceau, _encodage, suite) {
        hachage.update(morceau);
        octets += morceau.length;
        suite(null, morceau);
      }
    });
    await pipeline(
      fs.createReadStream(travail.copie),
      zlib.createGzip({ level: 6 }),
      compter,
      fs.createWriteStream(travail.compresse)
    );
    supprimer(travail.copie);

    // 3. Verification du fichier COMPRESSE, tel qu'une restauration le lirait.
    let decompresses = 0;
    const plafond = new Transform({
      transform(morceau, _encodage, suite) {
        decompresses += morceau.length;
        if (decompresses > maxOctets) suite(new Error("sauvegarde : decompression au-dela du plafond"));
        else suite(null, morceau);
      }
    });
    await pipeline(
      fs.createReadStream(travail.compresse),
      zlib.createGunzip(),
      plafond,
      fs.createWriteStream(travail.verification)
    );
    const comptes = {};
    const empreintes = {};
    const relue = new DatabaseSync(travail.verification, { readOnly: true });
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
    supprimer(travail.verification);

    // 4. Le nom final n'est donne qu'a un fichier relu.
    fs.renameSync(travail.compresse, destination);
    return { octets, sha256: hachage.digest("hex"), comptes, empreintes };
  } catch (error) {
    supprimer(travail.copie);
    supprimer(travail.verification);
    try { fs.unlinkSync(travail.compresse); } catch { /* absent : ok */ }
    throw error;
  }
}

sauvegarder(workerData).then(
  resultat => parentPort.postMessage({ ok: true, resultat }),
  error => parentPort.postMessage({ ok: false, erreur: String(error?.message || error) })
);

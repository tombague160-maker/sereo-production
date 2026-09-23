// Le nom du shell que le service worker met en cache, derive du CONTENU des
// fichiers statiques (lot « chargement instantane », 23/09).
//
// Pourquoi : le service worker sert CSS, JS et polices depuis son cache
// d'abord. Il ne sait qu'une page est plus recente que lui que si le nom du
// shell change (en-tete X-Sereo-Shell). Si ce nom ne change qu'a la main
// (bumper CACHE_NAME), chaque livraison qui l'oublie -- la majorite, mesure du
// 23/09 : 8 des 15 derniers commits de main touchant public/js -- fait tourner
// une page neuve sur de vieux scripts au premier chargement. Ici, le nom
// annonce ET le nom inscrit dans le service worker servi portent l'empreinte
// des fichiers : un octet change, le nom change, sans geste de personne.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/** Tous les fichiers sous `racine`, chemins relatifs en « / », tries. */
function fichiersSous(racine) {
  const trouves = [];
  const parcourir = dossier => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const complet = path.join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(complet);
      else if (entree.isFile()) trouves.push(complet);
    }
  };
  parcourir(racine);
  return trouves
    .map(f => path.relative(racine, f).split(path.sep).join("/"))
    .sort();
}

/**
 * Empreinte (12 caracteres hexadecimaux) du contenu d'une liste de sources.
 * Chaque source est { nom, racine } : un dossier parcouru en entier. Un
 * dossier absent compte comme vide (jamais d'erreur au demarrage).
 * Le chemin ET le contenu entrent dans l'empreinte : renommer, ajouter,
 * retirer ou modifier un fichier la change.
 */
function empreinteDesSources(sources) {
  const h = crypto.createHash("sha256");
  for (const { nom, racine } of sources) {
    let fichiers = [];
    try { fichiers = fichiersSous(racine); } catch { fichiers = []; }
    for (const rel of fichiers) {
      const contenu = fs.readFileSync(path.join(racine, ...rel.split("/")));
      h.update(`${nom}/${rel}\0${contenu.length}\0`);
      h.update(contenu);
    }
  }
  return h.digest("hex").slice(0, 12);
}

const MOTIF_CACHE_NAME = /const CACHE_NAME = "([^"]+)"/;

/**
 * Lit le source du service worker et rend { nom, source } : le nom du shell
 * (CACHE_NAME du fichier suivi de l'empreinte) et le source a servir, ou ce
 * nom remplace CACHE_NAME. Sans CACHE_NAME reconnaissable : null, et le
 * fichier est servi tel quel par express.static.
 */
function shellEmpreinte(sourceServiceWorker, empreinte) {
  const trouve = String(sourceServiceWorker || "").match(MOTIF_CACHE_NAME);
  if (!trouve || !empreinte) return null;
  const nom = `${trouve[1]}-${empreinte}`;
  return { nom, source: sourceServiceWorker.replace(MOTIF_CACHE_NAME, `const CACHE_NAME = "${nom}"`) };
}

module.exports = { empreinteDesSources, shellEmpreinte, fichiersSous };

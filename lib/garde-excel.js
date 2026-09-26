"use strict";

// ============================================================================
// GARDE DE L'IMPORT EXCEL (robustesse, 25/09, chasse aux defauts)
// ============================================================================
//
// read-excel-file decompresse TOUTES les parties .xml du classeur en memoire,
// puis en construit l'arbre complet (xmldom) : environ 4 Ko par cellule. Un
// fichier de 0,5 Mo pouvait donc faire monter la memoire a 600 Mo (mesure du
// rapport : 50 000 lignes x 2 cellules), au-dessus des 512 Mo du conteneur ; et
// la feuille est rangee dans un tableau DENSE lignes x colonnes, dimensionne
// sur la plus grande reference (`<dimension ref="A1:XFD1048576"/>`, ou une seule
// cellule en XFD1048576), meme vide. La seule limite etait les 10 Mo envoyes.
//
// Avant de le lire, on ouvre donc le classeur a la main (repertoire du zip),
// on decompresse chaque partie .xml avec un plafond REEL d'octets (pas la
// taille que le zip annonce, qui peut mentir), et on compte : cellules, noeuds
// XML (elements, attributs, textes), derniere ligne et derniere colonne. Au-dela
// des limites, refus avec un message qui dit quoi faire -- avant toute lecture.
//
// Limites, mesurees le 25/09 (serveur sous le tas du conteneur : 259 Mo, base de
// la forme de la production, import reel de ventes au format Ximi, 22 colonnes) :
// 3 000 lignes (66 000 cellules, ~400 000 noeuds) passent ; 3 500 lignes (77 000
// cellules, ~470 000 noeuds) tuent le serveur (« JavaScript heap out of memory »).
// Les limites gardent une marge de 1,6 a 1,9 : 40 000 cellules, soit ~1 800
// lignes Ximi (le fichier actuel : 429 lignes, 9 460 cellules), et 250 000 noeuds.

const zlib = require("node:zlib");

const LIMITES = Object.freeze({
  cellules: 40000,
  noeuds: 250000,
  lignes: 10000,
  colonnes: 100,
  octetsXml: 16 * 1024 * 1024,
  parties: 500
});

class ClasseurRefuse extends Error {
  constructor(message) {
    super(message);
    this.name = "ClasseurRefuse";
  }
}

const ILLISIBLE = "Fichier Excel invalide ou illisible";

const nombre = n => Number(n).toLocaleString("fr-FR");

function lettresDeColonne(index) {
  let s = "";
  let n = index;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function indexDeColonne(lettres) {
  let n = 0;
  for (const c of lettres.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

// Une lecture du zip qui sort des bornes (fichier tronque, offsets faux) :
// illisible, jamais une exception brute.
function lire(fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ClasseurRefuse) throw error;
    throw new ClasseurRefuse(ILLISIBLE);
  }
}

/** Le repertoire central du zip : nom, methode, tailles, position de chaque partie. */
function repertoire(buffer) {
  return lire(() => {
    const plancher = Math.max(0, buffer.length - 22 - 0xffff);
    let fin = -1;
    for (let i = buffer.length - 22; i >= plancher; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
    }
    if (fin < 0) throw new ClasseurRefuse(ILLISIBLE);
    let total = buffer.readUInt16LE(fin + 10);
    let debut = buffer.readUInt32LE(fin + 16);
    if (total === 0xffff || debut === 0xffffffff) {
      // ZIP64 : le localisateur precede la fin du repertoire.
      const localisateur = fin - 20;
      if (localisateur < 0 || buffer.readUInt32LE(localisateur) !== 0x07064b50) throw new ClasseurRefuse(ILLISIBLE);
      const fin64 = Number(buffer.readBigUInt64LE(localisateur + 8));
      if (buffer.readUInt32LE(fin64) !== 0x06064b50) throw new ClasseurRefuse(ILLISIBLE);
      total = Number(buffer.readBigUInt64LE(fin64 + 32));
      debut = Number(buffer.readBigUInt64LE(fin64 + 48));
    }
    const parties = [];
    let p = debut;
    for (let k = 0; k < total; k++) {
      if (buffer.readUInt32LE(p) !== 0x02014b50) throw new ClasseurRefuse(ILLISIBLE);
      const methode = buffer.readUInt16LE(p + 10);
      let compresse = buffer.readUInt32LE(p + 20);
      let decompresse = buffer.readUInt32LE(p + 24);
      const longueurNom = buffer.readUInt16LE(p + 28);
      const longueurExtra = buffer.readUInt16LE(p + 30);
      const longueurCommentaire = buffer.readUInt16LE(p + 32);
      let local = buffer.readUInt32LE(p + 42);
      const nom = buffer.toString("utf8", p + 46, p + 46 + longueurNom);
      if (compresse === 0xffffffff || decompresse === 0xffffffff || local === 0xffffffff) {
        let e = p + 46 + longueurNom;
        const finExtra = e + longueurExtra;
        while (e + 4 <= finExtra) {
          const id = buffer.readUInt16LE(e);
          const n = buffer.readUInt16LE(e + 2);
          if (id === 0x0001) {
            let q = e + 4;
            if (decompresse === 0xffffffff) { decompresse = Number(buffer.readBigUInt64LE(q)); q += 8; }
            if (compresse === 0xffffffff) { compresse = Number(buffer.readBigUInt64LE(q)); q += 8; }
            if (local === 0xffffffff) { local = Number(buffer.readBigUInt64LE(q)); q += 8; }
          }
          e += 4 + n;
        }
      }
      parties.push({ nom, methode, compresse, local });
      p += 46 + longueurNom + longueurExtra + longueurCommentaire;
    }
    return parties;
  });
}

/** Le contenu d'une partie, decompresse sans jamais depasser `plafond` octets. */
function contenu(buffer, partie, plafond) {
  const donnees = lire(() => {
    const l = partie.local;
    if (buffer.readUInt32LE(l) !== 0x04034b50) throw new ClasseurRefuse(ILLISIBLE);
    const debut = l + 30 + buffer.readUInt16LE(l + 26) + buffer.readUInt16LE(l + 28);
    if (debut + partie.compresse > buffer.length) throw new ClasseurRefuse(ILLISIBLE);
    return buffer.subarray(debut, debut + partie.compresse);
  });
  const tropGros = () => new ClasseurRefuse(
    `Fichier Excel trop volumineux une fois décompressé (plus de ${nombre(LIMITES.octetsXml / 1024 / 1024)} Mo de données). `
    + "Exporte une période plus courte, puis importe-la."
  );
  if (partie.methode === 0) {
    if (donnees.length > plafond) throw tropGros();
    return donnees;
  }
  if (partie.methode !== 8) throw new ClasseurRefuse(`${ILLISIBLE} (compression non prise en charge)`);
  try {
    return zlib.inflateRawSync(donnees, { maxOutputLength: Math.max(1, plafond) });
  } catch (error) {
    if (error && (error.code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError)) throw tropGros();
    throw new ClasseurRefuse(ILLISIBLE);
  }
}

const compter = (texte, motif) => {
  let n = 0;
  motif.lastIndex = 0;
  while (motif.exec(texte)) n++;
  return n;
};

// Les motifs acceptent un prefixe d'espace de noms (« x:c »).
const BALISE = /<[^/!?]/g;
const ATTRIBUT = /\s[^\s=<>/"']+\s*=\s*["']/g;
const TEXTE = />[^<]+</g;
const CELLULE = /<(?:[\w.-]+:)?c[\s>/]/g;
const REF_CELLULE = /<(?:[\w.-]+:)?c\s[^>]*?\br\s*=\s*["']([A-Za-z]{1,3})(\d{1,7})["']/g;
const LIGNE = /<(?:[\w.-]+:)?row[\s>/]/g;
const REF_LIGNE = /<(?:[\w.-]+:)?row\s[^>]*?\br\s*=\s*["'](\d{1,7})["']/g;
const DIMENSION = /<(?:[\w.-]+:)?dimension\s[^>]*?\bref\s*=\s*["']([^"']*)["']/g;
const COORDONNEES = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

/**
 * Inspecte un classeur .xlsx (Buffer) avant sa lecture. Rend ce qu'il a compte ;
 * leve ClasseurRefuse (message pour l'ecran) au-dela des limites.
 */
function inspecterClasseur(buffer, limites = LIMITES) {
  const parties = repertoire(buffer).filter(p => /\.xml(\.rels)?$/i.test(p.nom));
  if (parties.length > limites.parties) throw new ClasseurRefuse(`${ILLISIBLE} (${nombre(parties.length)} parties).`);
  const total = { octetsXml: 0, cellules: 0, noeuds: 0, lignes: 0, colonnes: 0 };
  for (const partie of parties) {
    const texte = contenu(buffer, partie, limites.octetsXml - total.octetsXml).toString("latin1");
    total.octetsXml += texte.length;
    // Les cellules d'abord : c'est la limite que l'ecran sait expliquer.
    total.cellules += compter(texte, CELLULE);
    if (total.cellules > limites.cellules) {
      throw new ClasseurRefuse(
        `Fichier Excel trop gros pour l'import : plus de ${nombre(limites.cellules)} cellules remplies. `
        + "Exporte une période plus courte (ou coupe le fichier en deux), puis importe chaque partie."
      );
    }
    total.noeuds += compter(texte, BALISE) + compter(texte, ATTRIBUT) + compter(texte, TEXTE);
    if (total.noeuds > limites.noeuds) {
      throw new ClasseurRefuse(
        `Fichier Excel trop complexe pour l'import (plus de ${nombre(limites.noeuds)} éléments). Exporte une période plus courte, puis importe-la.`
      );
    }
    // La plus grande ligne et la plus grande colonne : le tableau que la
    // lecture allouera en entier, cellules vides comprises.
    let lignes = compter(texte, LIGNE);
    let colonnes = 0;
    REF_CELLULE.lastIndex = 0;
    for (let m; (m = REF_CELLULE.exec(texte));) {
      colonnes = Math.max(colonnes, indexDeColonne(m[1]));
      lignes = Math.max(lignes, Number(m[2]));
    }
    REF_LIGNE.lastIndex = 0;
    for (let m; (m = REF_LIGNE.exec(texte));) lignes = Math.max(lignes, Number(m[1]));
    DIMENSION.lastIndex = 0;
    for (let m; (m = DIMENSION.exec(texte));) {
      for (const coin of m[1].split(":")) {
        const c = COORDONNEES.exec(coin.trim());
        if (!c) continue;
        colonnes = Math.max(colonnes, indexDeColonne(c[1]));
        lignes = Math.max(lignes, Number(c[2]));
      }
    }
    total.lignes = Math.max(total.lignes, lignes);
    total.colonnes = Math.max(total.colonnes, colonnes);
  }
  if (total.lignes > limites.lignes) {
    throw new ClasseurRefuse(
      `Le fichier Excel va jusqu'à la ligne ${nombre(total.lignes)}, au plus ${nombre(limites.lignes)}. `
      + "Si les dernières lignes sont vides, supprime-les dans Excel ; sinon, exporte une période plus courte."
    );
  }
  if (total.colonnes > limites.colonnes) {
    throw new ClasseurRefuse(
      `Le fichier Excel va jusqu'à la colonne ${lettresDeColonne(total.colonnes)} (${nombre(total.colonnes)} colonnes), au plus ${nombre(limites.colonnes)}. `
      + "Supprime les colonnes vides ou inutiles, puis réessaie."
    );
  }
  return total;
}

module.exports = { inspecterClasseur, ClasseurRefuse, LIMITES };

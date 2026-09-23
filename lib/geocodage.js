// Geocodage : UN seul module pour l'import, le lot de fond, la tournee et la
// recherche d'adresse (lot 3 de l'audit geo, 23/09).
//
// Avant ce module, deux chaines coexistaient : celle du lot (server.js, BAN,
// seuil 0,6, code postal en filtre, cache SQLite) et celle de la tournee
// (lib/routing.js, data.geopf.fr code en dur, seuil 0,65, egalite stricte du
// code postal, aucun cache). Une adresse "trouvee" a l'import etait refusee au
// calcul de la tournee, et le resultat du calcul n'etait memorise nulle part.
// Ici : une URL (SEREO_GEOCODER_URL), un seuil, une forme de requete, un
// User-Agent. Le cache reste cote serveur (table geocodages) : ce module ne
// connait pas la base, il dit seulement si une entree de cache est encore bonne.
//
// Source des donnees : Base Adresse Nationale (BAN), Licence Ouverte 2.0. La
// mention est exposee par SOURCE_ADRESSES et affichee a cote de la carte.

const { version } = require("../package.json");

const STATUTS = {
  TROUVE: "trouve",
  AMBIGU: "ambigu",
  INTROUVABLE: "introuvable",
  ERREUR: "erreur"
};

// Mesure sur la BAN reelle (26/08/2026, voir qualifierResultat) : les vraies
// correspondances sont >= 0,97, les rapprochements hasardeux <= 0,46.
const SEUIL_TROUVE = 0.6;
const SEUIL_AMBIGU = 0.4;

// Un rejet (introuvable, ambigu) n'est plus garde a vie : la BAN s'enrichit
// (lotissements neufs) et le nettoyage des adresses progresse. Passe ce delai,
// l'adresse est redemandee au prochain lot.
const DUREE_REJET_JOURS = 30;

// Decision 6 de Thomas (23/09) : une position a plus de 150 km du depot (ou du
// depart de la tournee) est refusee. Plage raisonnable : 80 a 300 km.
const PORTEE_DEPOT_KM = 150;

// Sans depot connu : la France metropolitaine, Corse comprise.
const FRANCE_METROPOLITAINE = { latMin: 41, latMax: 51.6, lngMin: -5.6, lngMax: 9.8 };

const SOURCE_ADRESSES = "Base Adresse Nationale (BAN), Licence Ouverte 2.0";
const URL_PAR_DEFAUT = "https://api-adresse.data.gouv.fr/search/";

// Contact generique : le depot public du projet, jamais une adresse personnelle.
const CONTACT = process.env.SEREO_CONTACT_URL || "https://github.com/tombague160-maker/sereo-production";
const USER_AGENT = `Sereo/${version} (+${CONTACT})`;

function texte(valeur) {
  return String(valeur ?? "").replace(/\s+/g, " ").trim();
}

function urlGeocodeur() {
  return texte(process.env.SEREO_GEOCODER_URL) || URL_PAR_DEFAUT;
}

function delaiMs() {
  const valeur = Number(process.env.SEREO_GEOCODER_TIMEOUT_MS || 8000);
  return Number.isFinite(valeur) && valeur > 0 ? valeur : 8000;
}

/**
 * Code postal normalise. Excel lit 01100 comme le NOMBRE 1100 : un code a
 * quatre chiffres est complete par la gauche. Les espaces ("39 300") tombent.
 * Tout le reste est rendu tel quel (le geocodeur jugera), jamais invente.
 */
function normaliserCodePostal(valeur) {
  const brut = texte(valeur);
  const compact = brut.replace(/\s+/g, "");
  if (/^\d{4}$/.test(compact)) return `0${compact}`;
  if (/^\d{5}$/.test(compact)) return compact;
  return brut;
}

function codePostalValide(valeur) {
  return /^\d{5}$/.test(String(valeur || ""));
}

// Un segment d'adresse qui n'est PAS la voie : residence, batiment,
// appartement, etage, boite postale... Il reste utile au livreur (on le garde
// dans `complement`), mais il fait chuter le score de la BAN (mesure du 23/09 :
// 0,98 sans, 0,37 avec, pour la MEME adresse trouvee).
const SEGMENT_COMPLEMENT = /^(r[ée]s(idence)?\b|r[ée]s\.|b[aâ]t(iment)?\b|b[aâ]t\.|apt\b|apt\.|app(ar)?t(ement)?\b|appt\.|[ée]tage\b|\d+\s*(er|e|eme|ème)\s*[ée]tage|escalier\b|esc\.|porte\b|entr[ée]e\b|immeuble\b|imm\.|ehpad\b|foyer\b|chez\b|c\/o\b|b\.?\s?p\.?\s*\d|cs\s*\d|tsa\s*\d)/i;

// Les memes, colles a la voie ("3 rue de Dole Bat B Apt 12"). "Bat" doit etre
// suivi d'un point ou d'une espace : sans cela, "rue du Bateau", "chemin de la
// Batie" ou "rue de Batz" perdaient la fin de leur nom (relecture du lot 3).
const COMPLEMENT_EN_LIGNE = /\s+(b[aâ]t(iment)?(\.\s*|\s+)[a-z0-9]{1,3}|apt\.?\s*\d+|app(ar)?t(ement)?\.?\s*\d+|appt\.?\s*\d+|[ée]tage\s*\d+|\d+\s*(er|e|eme|ème)\s*[ée]tage|b\.?\s?p\.?\s*\d+|cs\s*\d+|tsa\s*\d+)\b\.?/gi;

// Un numero seul, avec son indice de repetition eventuel : "12", "12 bis", "3B".
const NUMERO_SEUL = /^\d+\s*(bis|ter|quater|[a-z])?$/i;

/**
 * "12, rue de Dole" et "Rue de Dole, 12" : le numero isole par une virgule
 * est recolle a sa voie (le segment voisin qui n'est ni un complement ni un
 * autre numero). Sans cela, "12" etait pris pour la voie et la rue partait en
 * complement : la BAN ne recevait que "12", et deux voies differentes au meme
 * numero partageaient la meme cle de cache (relecture du lot 3).
 */
function rattacherNumerosSeuls(segments) {
  const resultat = [...segments];
  const voieSansNumero = s => Boolean(s) && !/^\d/.test(s) && !SEGMENT_COMPLEMENT.test(s);
  for (let i = 0; i < resultat.length; i += 1) {
    if (!NUMERO_SEUL.test(resultat[i])) continue;
    if (voieSansNumero(resultat[i + 1])) {
      resultat.splice(i, 2, `${resultat[i]} ${resultat[i + 1]}`);
    } else if (voieSansNumero(resultat[i - 1])) {
      resultat.splice(i - 1, 2, `${resultat[i]} ${resultat[i - 1]}`);
      i -= 1;
    }
  }
  return resultat;
}

/**
 * Separe la voie de ses complements, retire "CEDEX" de la ville.
 *
 * Rend { rue, codePostal, ville, complement, cedex }. `rue` est ce qu'on
 * envoie au geocodeur ; `complement` ce qu'on a retire (a montrer au livreur).
 */
function nettoyerAdresse({ rue, codePostal, ville } = {}) {
  let voie = texte(rue);
  const complements = [];

  const segments = rattacherNumerosSeuls(voie.split(/\s*[,;]\s*/).map(texte).filter(Boolean));
  if (segments.length === 1) {
    voie = segments[0];
  } else if (segments.length > 1) {
    // La voie est le premier segment qui commence par un numero et n'est pas
    // lui-meme un complement ("12 Apt" n'existe pas, "3 rue de Dole" oui).
    const indexVoie = segments.findIndex(s => /^\d+/.test(s) && !SEGMENT_COMPLEMENT.test(s));
    if (indexVoie >= 0) {
      voie = segments[indexVoie];
      segments.forEach((s, i) => { if (i !== indexVoie) complements.push(s); });
    } else {
      // Pas de numero (lieu-dit, route) : on ne retire que les complements
      // reconnus, et jamais tout -- un lieu-dit seul EST l'adresse.
      const gardes = segments.filter(s => !SEGMENT_COMPLEMENT.test(s));
      if (gardes.length) {
        segments.filter(s => SEGMENT_COMPLEMENT.test(s)).forEach(s => complements.push(s));
        voie = gardes.join(" ");
      }
    }
  }

  voie = voie.replace(COMPLEMENT_EN_LIGNE, (morceau) => {
    complements.push(texte(morceau).replace(/\.$/, ""));
    return "";
  });
  voie = texte(voie);

  let villePropre = texte(ville);
  let cedex = false;
  if (/\bcedex\b/i.test(villePropre)) {
    cedex = true;
    villePropre = texte(villePropre.replace(/\s*\bcedex\b.*$/i, ""));
  }
  const cp = normaliserCodePostal(codePostal);

  return {
    rue: voie || texte(rue),
    codePostal: cp,
    ville: villePropre,
    complement: complements.join(", "),
    cedex
  };
}

/**
 * Cle de cache : l'adresse NETTOYEE, sans casse, accents ni espaces
 * superflus. Deux ecritures d'une meme voie ("Bat B, 3 rue de Dole" et
 * "3 rue de Dole") partagent la meme entree.
 */
function cleGeocodage(adresse = {}) {
  const n = nettoyerAdresse(adresse);
  return [n.rue, n.codePostal, n.ville]
    .map(part => texte(part).toLowerCase())
    .join("|")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function adresseGeocodable(adresse = {}) {
  // Sans code postal ni ville, la BAN ne peut pas desambiguiser une rue.
  const n = nettoyerAdresse(adresse);
  return Boolean(texte(adresse.rue)) && Boolean(n.codePostal || n.ville);
}

/**
 * Qualifie un resultat de la BAN (seuil mesure, voir SEUIL_TROUVE).
 *
 * `municipality` et `locality` renvoient le centre de la commune ou du
 * lieu-dit, pas la porte : ils ne sont jamais "trouves", quel que soit leur
 * score. Un `housenumber` bien score pour une rue COMPLETEMENT differente
 * ("2 rue des Lilas" -> "2 Impasse des Lilas", 0,46) est ecarte par le score.
 */
function qualifierResultat(score, type) {
  const precis = type === "housenumber" || type === "street";
  if (precis && score >= SEUIL_TROUVE) return STATUTS.TROUVE;
  if (score >= SEUIL_AMBIGU) return STATUTS.AMBIGU;
  return STATUTS.INTROUVABLE;
}

/** La precision d'un point, dans les mots de l'ecran. */
function precisionDuType(type) {
  if (type === "housenumber") return "numero";
  if (type === "street") return "rue";
  if (type === "locality") return "lieu-dit";
  if (type === "municipality") return "commune";
  return "";
}

const LIBELLES_PRECISION = {
  numero: "au numéro",
  rue: "au milieu de la rue",
  "lieu-dit": "au centre du lieu-dit",
  commune: "au centre de la commune",
  manuel: "placée à la main"
};

/** Une position "approximative" : pas a la porte, a verifier. */
function precisionApproximative(precision) {
  return precision === "rue" || precision === "lieu-dit" || precision === "commune";
}

/**
 * Une entree du cache est-elle encore bonne ? Une erreur reseau ne l'est
 * jamais (ce n'est pas une reponse) ; un rejet l'est DUREE_REJET_JOURS jours.
 */
function entreeCacheValide(entree, maintenant = Date.now()) {
  if (!entree || entree.statut === STATUTS.ERREUR) return false;
  if (entree.statut === STATUTS.TROUVE) return true;
  const date = Date.parse(entree.misAJourLe || "");
  if (!Number.isFinite(date)) return false;
  return maintenant - date < DUREE_REJET_JOURS * 24 * 3600 * 1000;
}

function lireTrait(trait) {
  const [lng, lat] = trait?.geometry?.coordinates || [];
  const proprietes = trait?.properties || {};
  const type = String(proprietes.type || "");
  return {
    lat: Number(lat),
    lng: Number(lng),
    score: Number(proprietes.score ?? 0),
    type,
    precision: precisionDuType(type),
    libelle: String(proprietes.label || ""),
    postcode: String(proprietes.postcode || ""),
    city: String(proprietes.city || "")
  };
}

async function appelerBan(parametres, { fetchImpl = fetch } = {}) {
  const url = new URL(urlGeocodeur());
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur !== "" && valeur !== undefined && valeur !== null) url.searchParams.set(cle, String(valeur));
  }
  const reponse = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(delaiMs())
  });
  return reponse;
}

/**
 * Interroge la BAN pour UNE adresse.
 *
 * Ne leve JAMAIS : toute panne devient le statut "erreur", pour qu'un incident
 * reseau ne fasse pas echouer un import. Une requete REFUSEE par la BAN (HTTP
 * 400 : code postal "1100", texte illisible) est une reponse, pas une panne :
 * elle devient "introuvable" et n'est plus retentee a chaque lot.
 */
async function interroger(adresse, options = {}) {
  const n = nettoyerAdresse(adresse);
  const requete = [n.rue, n.ville].filter(Boolean).join(" ");
  // Le code postal CEDEX n'est pas un code de distribution de la BAN : en
  // filtre, il ne rend rien (mesure du 23/09). On le garde pour le controle
  // du departement, pas pour le filtre.
  const filtre = codePostalValide(n.codePostal) && !n.cedex ? n.codePostal : "";

  const essayer = async (q, postcode) => {
    const reponse = await appelerBan({ q, limit: 1, postcode }, options);
    if (reponse.status === 400) return { refus: true };
    if (!reponse.ok) return { erreur: `HTTP ${reponse.status}` };
    const corps = await reponse.json();
    return { trait: Array.isArray(corps?.features) ? corps.features[0] : null };
  };

  try {
    let essai = await essayer(requete || n.codePostal, filtre);
    let sansFiltre = false;
    // Rien avec le filtre (code postal faux ou CEDEX non detecte) : un second
    // essai sans filtre, sous controle du departement plus bas.
    if (!essai.erreur && !essai.refus && !essai.trait && filtre) {
      essai = await essayer(n.ville ? requete : `${requete} ${n.codePostal}`, "");
      sansFiltre = true;
    }
    if (!filtre && !sansFiltre) sansFiltre = true;

    if (essai.erreur) return { statut: STATUTS.ERREUR, message: essai.erreur, requete };
    if (essai.refus) return { statut: STATUTS.INTROUVABLE, message: "requete refusee par la BAN", requete };
    if (!essai.trait) return { statut: STATUTS.INTROUVABLE, requete };

    const r = lireTrait(essai.trait);
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) {
      return { statut: STATUTS.ERREUR, message: "coordonnees absentes", requete };
    }

    let statut = qualifierResultat(r.score, r.type);
    // Sans filtre, la BAN peut repondre dans un autre departement : un
    // resultat hors du departement du code postal n'est qu'une proposition.
    if (sansFiltre && statut === STATUTS.TROUVE && codePostalValide(n.codePostal)
      && r.postcode && r.postcode.slice(0, 2) !== n.codePostal.slice(0, 2)) {
      statut = STATUTS.AMBIGU;
    }

    return { statut, ...r, requete, complement: n.complement };
  } catch (error) {
    return {
      statut: STATUTS.ERREUR,
      message: error?.name === "TimeoutError" ? "delai depasse" : String(error?.message || error),
      requete
    };
  }
}

/**
 * Recherche libre (depart, arrivee, ecran "Adresses a verifier") : plusieurs
 * resultats, avec leur precision. Leve une erreur 400 lisible si la BAN ne
 * repond pas -- ici l'utilisateur attend, il doit savoir pourquoi.
 */
async function rechercher(q, { limite = 5, fetchImpl } = {}) {
  const requete = texte(q);
  if (requete.length < 3 || requete.length > 300) {
    throw Object.assign(new Error("Saisis une adresse ou une ville."), { statusCode: 400 });
  }
  let corps;
  try {
    const reponse = await appelerBan({ q: requete, limit: limite }, { fetchImpl });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    corps = await reponse.json();
  } catch {
    throw Object.assign(
      new Error("La recherche d’adresse (Base Adresse Nationale) ne répond pas. Réessaie dans un instant."),
      { statusCode: 400 }
    );
  }
  return (corps.features || [])
    .map(lireTrait)
    .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .map(r => ({
      label: r.libelle,
      score: r.score,
      type: r.type,
      precision: r.precision,
      postcode: r.postcode,
      city: r.city,
      lat: r.lat,
      lng: r.lng
    }));
}

function distanceKm(a, b) {
  const rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function dansFrance({ lat, lng }) {
  const z = FRANCE_METROPOLITAINE;
  return lat >= z.latMin && lat <= z.latMax && lng >= z.lngMin && lng <= z.lngMax;
}

/**
 * Une position est-elle plausible pour une livraison ?
 *
 * Refuse (0,0), la latitude et la longitude inversees (l'erreur de saisie la
 * plus courante : 5,91 / 46,75 tombe en Somalie), et tout point a plus de
 * `porteeKm` du point de reference (depot ou depart). Sans reference : hors
 * de France metropolitaine. Rend { ok } ou { ok:false, code, message }.
 */
function verifierPosition(point, { reference = null, porteeKm = PORTEE_DEPOT_KM } = {}) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, code: "invalide", message: "position illisible" };
  }
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) {
    return { ok: false, code: "zero", message: "position (0, 0), qui n’est jamais une adresse" };
  }
  const ref = reference && Number.isFinite(Number(reference.lat)) && Number.isFinite(Number(reference.lng))
    ? { lat: Number(reference.lat), lng: Number(reference.lng) }
    : null;
  const proche = p => (ref ? distanceKm(ref, p) <= porteeKm : dansFrance(p));
  if (proche({ lat, lng })) return { ok: true };
  if (Math.abs(lng) <= 90 && proche({ lat: lng, lng: lat })) {
    return { ok: false, code: "inversee", message: "latitude et longitude inversées", corrigee: { lat: lng, lng: lat } };
  }
  if (ref) {
    const km = Math.round(distanceKm(ref, { lat, lng }));
    return { ok: false, code: "hors-zone", message: `à ${km} km du départ (au-delà de ${porteeKm} km)` };
  }
  return { ok: false, code: "hors-zone", message: "hors de France métropolitaine" };
}

module.exports = {
  STATUTS,
  SEUIL_TROUVE,
  SEUIL_AMBIGU,
  DUREE_REJET_JOURS,
  PORTEE_DEPOT_KM,
  SOURCE_ADRESSES,
  USER_AGENT,
  LIBELLES_PRECISION,
  normaliserCodePostal,
  codePostalValide,
  nettoyerAdresse,
  cleGeocodage,
  adresseGeocodable,
  qualifierResultat,
  precisionDuType,
  precisionApproximative,
  entreeCacheValide,
  interroger,
  rechercher,
  distanceKm,
  verifierPosition,
  urlGeocodeur
};

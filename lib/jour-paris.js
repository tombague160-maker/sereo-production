// Le jour calendaire est celui de PARIS (24/09).
//
// En production le conteneur n'a pas de TZ : le processus tourne en UTC. Entre
// minuit et 1 h (hiver) ou 2 h (ete), heure de Paris, « aujourd'hui » vu par
// `new Date().getDate()`, par `toISOString().slice(0, 10)` ou par une troncature
// de `deliveredAt` est encore la VEILLE. Mesure en CI le 23/09 a 22:10 UTC :
// l'histogramme de l'Analyse ne voyait aucune des livraisons du jour.
//
// Deux sortes de valeurs, deux traitements :
//   - un INSTANT (maintenant, deliveredAt, createdAt, faitLe : un horodatage
//     avec un fuseau) : son jour est lu a Paris, par jourParis() ;
//   - une CLE "YYYY-MM-DD" (deliveryDate, dateCommande, startDate...) : une
//     date sans heure, qui ne se decale jamais. Son arithmetique (ajouter des
//     jours, lundi de la semaine, premier du mois) se fait en UTC PUR sur la
//     cle : aucun fuseau, ni celui du processus ni celui de Paris, n'y entre.
//
// Meme lecture que lib/operations-api.js (todayParis) et lib/osrm-local.js.

const JOUR_MS = 86400000;

const FORMAT_PARIS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const CLE_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
// Un horodatage ISO AVEC fuseau (Z ou +hh:mm) : un instant. Sans fuseau
// ("2026-09-24T01:30"), l'heure est deja celle du mur, a Paris : sa date se
// lit telle quelle, on ne la decale pas.
const INSTANT_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Le jour a Paris de `instant` (Date, nombre ms ou texte ISO), "YYYY-MM-DD".
 * Rend "" pour un instant invalide. Par formatToParts : le motif de « en-CA »
 * a deja change d'une version d'ICU a l'autre, les parties non.
 */
function jourParis(instant = new Date()) {
  // null n'est pas « maintenant » ni le 01/01/1970 (new Date(null)) : pas d'instant.
  if (instant === null) return "";
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return "";
  const parties = {};
  for (const { type, value } of FORMAT_PARIS.formatToParts(date)) parties[type] = value;
  return `${parties.year}-${parties.month}-${parties.day}`;
}

/** Vrai pour une cle "YYYY-MM-DD" qui designe un jour qui existe. */
function estCleJour(valeur) {
  const m = typeof valeur === "string" && CLE_JOUR.exec(valeur);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Vrai pour un horodatage ISO qui porte son fuseau : un instant, pas une date. */
function estInstant(valeur) {
  return typeof valeur === "string" && INSTANT_ISO.test(valeur.trim()) && Number.isFinite(Date.parse(valeur.trim()));
}

/**
 * Le jour a Paris d'un INSTANT, ou "" si `valeur` n'en est pas un (une date
 * sans heure, un texte libre) : l'appelant garde alors sa propre lecture.
 */
function jourDeLInstant(valeur) {
  if (valeur instanceof Date) return jourParis(valeur);
  return estInstant(valeur) ? jourParis(valeur.trim()) : "";
}

// --- Arithmetique sur les cles, en UTC pur ----------------------------------

function versUtc(cle) {
  const m = CLE_JOUR.exec(cle);
  if (!m) throw new Error(`cle de jour invalide : ${cle}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function versCle(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `cle` + `jours` (negatif pour reculer). */
function ajouterJours(cle, jours) {
  return versCle(versUtc(cle) + jours * JOUR_MS);
}

/** Le lundi de la semaine de `cle`. */
function debutSemaine(cle) {
  const jour = new Date(versUtc(cle)).getUTCDay() || 7;
  return ajouterJours(cle, 1 - jour);
}

/** Le premier du mois de `cle`. */
function debutMois(cle) {
  return `${cle.slice(0, 7)}-01`;
}

/** Le premier du mois qui suit (ou precede, `decalage` negatif) celui de `cle`. */
function premierDuMois(cle, decalage) {
  const d = new Date(versUtc(cle));
  return versCle(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + decalage, 1));
}

const moisSuivant = cle => premierDuMois(cle, 1);
const moisPrecedent = cle => premierDuMois(cle, -1);

module.exports = {
  jourParis,
  jourDeLInstant,
  estCleJour,
  estInstant,
  ajouterJours,
  debutSemaine,
  debutMois,
  moisSuivant,
  moisPrecedent,
};

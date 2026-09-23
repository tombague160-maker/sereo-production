// Lot 6 de l'audit geo (23/09) : « pratique au quotidien ». Fonctions PURES,
// sans DOM ni reseau : heures d'arrivee, liens de navigation et de SMS,
// historique des tournees. Testees sous Node (test/tournee-pratique.test.js).

import { getEntityCoordinates, getAddressParts } from "../utils/address.js";
import { normalizePhoneNumber } from "../utils/text.js";

const STATUTS_TERMINES = new Set(["livre", "absent", "probleme", "a_reprogrammer"]);
const estTermine = (stop) => STATUTS_TERMINES.has(stop?.status);

// --- Heures d'arrivee ----------------------------------------------------------
//
// La matiere : `route.troncons` (lot 7), un { duree (s), distance (m) } par
// trajet -- depart -> arret 1, ..., arret n -> arrivee -- tels qu'OSRM les
// rend ; plus la duree d'arret des Parametres.
//
// L'heure de reference : maintenant pour une tournee prete (« si tu pars
// maintenant »). En livraison : l'heure du dernier geste (l'arret solde le
// plus recent), du depart, ou du dernier calcul depuis la position GPS
// (`tronconsDepuis`), la plus tardive. On arrive au premier arret restant a
// cette heure plus son trajet -- jamais avant maintenant : un livreur en
// retard sur l'estimation y arrive « maintenant », et tout ce qui suit glisse.
//
// Un arret deja traite AU MILIEU des restants (fait dans le desordre) : le
// trajet d'un restant au suivant passe par lui (somme des deux troncons).
//
// Rend null quand les troncons manquent ou ne correspondent plus a l'ordre
// (tournee reordonnee a la main, calcul « sans depart ») : pas d'heure plutot
// qu'une heure fausse.

function valeurTroncon(t) {
  return t && Number.isFinite(Number(t.duree)) && Number.isFinite(Number(t.distance))
    ? { duree: Number(t.duree), distance: Number(t.distance) }
    : null;
}

function instant(valeur) {
  const t = valeur ? Date.parse(valeur) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

/**
 * @returns {null | {
 *   arrivees: Map<string, number>,   // id d'arret -> instant d'arrivee (ms)
 *   trajets: Map<string, {duree, distance}>, // id -> trajet depuis le restant precedent
 *   retour: number,                  // instant d'arrivee au point d'arrivee (ou de fin du dernier arret)
 *   avecRetour: boolean,             // false : pas d'arrivee, chemin ouvert
 *   metresRestants: number,
 *   premier: string                  // id du premier arret restant
 * }}
 */
export function horairesDeTournee(route, { maintenant = Date.now(), dureeArretMin = 6 } = {}) {
  if (!route || !Array.isArray(route.stops) || !route.stops.length) return null;
  if (route.status === "terminee") return null;
  const stops = route.stops;
  const n = stops.length;
  const troncons = Array.isArray(route.troncons) ? route.troncons : null;
  if (!troncons || troncons.length !== n + 1) return null;
  const restants = [];
  stops.forEach((stop, i) => { if (!estTermine(stop)) restants.push(i); });
  if (!restants.length) return null;
  const legs = troncons.map(valeurTroncon);
  for (let k = restants[0]; k <= n; k++) if (!legs[k]) return null;

  let reference = maintenant;
  if (route.status === "en_livraison") {
    const candidats = [instant(route.startedAt), instant(route.tronconsDepuis)];
    for (const stop of stops) if (estTermine(stop)) candidats.push(instant(stop.deliveredAt));
    const connus = candidats.filter(Number.isFinite);
    if (connus.length) reference = Math.min(maintenant, Math.max(...connus));
  }
  const arret = Math.max(0, Number(dureeArretMin) || 0) * 60000;
  const arrivees = new Map();
  const trajets = new Map();
  let precedent = null;
  let heure = 0;
  let metres = 0;
  for (const i of restants) {
    let duree = 0, distance = 0;
    const debut = precedent === null ? i : precedent + 1;
    for (let k = debut; k <= i; k++) { duree += legs[k].duree; distance += legs[k].distance; }
    heure = precedent === null
      ? Math.max(maintenant, reference + duree * 1000)
      : heure + arret + duree * 1000;
    arrivees.set(String(stops[i].id), heure);
    trajets.set(String(stops[i].id), { duree, distance });
    metres += distance;
    precedent = i;
  }
  let fin = 0, finMetres = 0;
  for (let k = precedent + 1; k <= n; k++) { fin += legs[k].duree; finMetres += legs[k].distance; }
  return {
    arrivees,
    trajets,
    retour: heure + arret + fin * 1000,
    // Relecture adverse du lot 6 : une tournee SANS arrivee (creee « sans
    // depart ») suit un chemin ouvert -- son dernier troncon est nul. Elle
    // finit au dernier arret ; l'ecran dit « fin vers », pas « retour vers ».
    avecRetour: Boolean(route.arrival && getEntityCoordinates(route.arrival)),
    metresRestants: metres + finMetres,
    premier: String(stops[restants[0]].id)
  };
}

/** « 10 h 40 » : l'heure locale, arrondie aux `pas` minutes les plus proches. */
export function formatHeure(ms, pas = 5) {
  if (!Number.isFinite(ms)) return "";
  const pasMs = Math.max(1, pas) * 60000;
  const date = new Date(Math.round(ms / pasMs) * pasMs);
  return `${date.getHours()} h ${String(date.getMinutes()).padStart(2, "0")}`;
}

/** « 18 km », « 6,2 km », « 800 m ». */
export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return "";
  if (metres < 1000) return `${Math.round(metres / 100) * 100 || 100} m`;
  const km = metres / 1000;
  return `${km >= 10 ? Math.round(km) : String(Math.round(km * 10) / 10).replace(".", ",")} km`;
}

/** « environ 14 min », « environ 1 h 25 ». */
export function formatDuree(secondes) {
  if (!Number.isFinite(secondes)) return "";
  const minutes = Math.max(1, Math.round(secondes / 60));
  if (minutes < 60) return `environ ${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `environ ${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}

// --- « Y aller » -----------------------------------------------------------------
//
// Vers les COORDONNEES de l'arret quand elles existent : une position corrigee
// a la main, un lieu-dit sans rue, une entree d'EHPAD mal nommee y menent. A
// defaut -- ou quand le point n'est qu'approximatif et qu'une adresse existe --,
// l'adresse en texte (la regle d'avant : rue et ville). Google Maps,
// Waze, ou Plans -- ce dernier seulement sur iPhone et iPad.

export const APPLIS_NAVIGATION = [
  { cle: "google", libelle: "Google Maps" },
  { cle: "waze", libelle: "Waze" },
  { cle: "apple", libelle: "Plans", appleSeulement: true }
];

/** iPhone, iPad (iPadOS se dit « MacIntel » avec un ecran tactile), iPod. */
export function estAppareilApple(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return false;
  const ua = String(nav.userAgent || "");
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return nav.platform === "MacIntel" && Number(nav.maxTouchPoints) > 1;
}

export function applisDeNavigation(apple) {
  return APPLIS_NAVIGATION.filter((a) => !a.appleSeulement || apple);
}

/** L'appli retenue : celle choisie si elle existe sur cet appareil, sinon Google Maps. */
export function appliRetenue(choix, apple) {
  return applisDeNavigation(apple).some((a) => a.cle === choix) ? choix : "google";
}

function adresseTexte(entity) {
  const parts = getAddressParts(entity || {});
  if (!parts.address || !parts.city) return "";
  return [parts.address, parts.postalCode, parts.city].filter(Boolean).join(" ").trim();
}

// Relecture adverse du lot 6 : un point APPROXIMATIF (lots 3-4 : « au milieu
// de la rue », « au centre du lieu-dit », « de la commune ») menait au milieu
// d'une route de plusieurs kilometres, la ou l'adresse complete -- numero
// compris -- menait a la porte. L'adresse en texte gagne alors, quand il y en
// a une ; sinon le point reste (il ne fait pas pire que rien). Une position
// placee a la main porte la precision « manuel » : elle garde son point.
const PRECISIONS_APPROXIMATIVES = new Set(["rue", "lieu-dit", "commune"]);

export function lienNavigation(entity, appli = "google", { apple = false } = {}) {
  if (!entity) return "";
  const cle = appliRetenue(appli, apple);
  const adresse = adresseTexte(entity);
  const coords = PRECISIONS_APPROXIMATIVES.has(entity.geoPrecision) && adresse ? null : getEntityCoordinates(entity);
  const point = coords ? `${coords.lat},${coords.lng}` : "";
  const texte = point ? "" : adresse;
  if (!point && !texte) return "";
  const q = encodeURIComponent(texte);
  if (cle === "waze") {
    return point
      ? `https://waze.com/ul?ll=${point}&navigate=yes`
      : `https://waze.com/ul?q=${q}&navigate=yes`;
  }
  if (cle === "apple") {
    return `https://maps.apple.com/?daddr=${point || q}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${point || q}`;
}

// --- « Prevenir » -----------------------------------------------------------------
//
// Un lien sms: avec le numero du client et le texte pret : c'est l'application
// SMS du telephone qui envoie. Aucun fournisseur, aucun cout.

export const MESSAGE_PREVENIR_DEFAUT = "Bonjour, je passe vers {heure} pour votre livraison.";
export const MESSAGE_PREVENIR_MAX = 300;

/** Le texte du SMS. Sans heure connue, « vers {heure} » devient « bientôt ». */
export function textePrevenir(modele, heure) {
  const base = String(modele || "").trim() || MESSAGE_PREVENIR_DEFAUT;
  const texte = heure
    ? base.replace(/\{heure\}/g, heure)
    : base.replace(/vers\s+\{heure\}/gi, "bientôt").replace(/\{heure\}/g, "bientôt");
  return texte.slice(0, MESSAGE_PREVENIR_MAX);
}

/**
 * Le lien sms:. iOS lit le corps apres « & », Android apres « ? » (usage
 * constate, non normalise : RFC 5724 dit « ? »).
 */
export function lienSms(telephone, texte, { apple = false } = {}) {
  const numero = normalizePhoneNumber(telephone);
  if (!numero) return "";
  return `sms:${numero}${apple ? "&" : "?"}body=${encodeURIComponent(String(texte || ""))}`;
}

// --- Historique des tournees ----------------------------------------------------
//
// Les donnees existent deja : `startedAt`, `completedAt`, `totalDistance` (km du
// trace prevu, pas ceux roules), le secteur, les arrets. Une ligne par tournee
// terminee, et par mois un total par secteur.

function jourDe(route) {
  const date = String(route.deliveryDate || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const fin = instant(route.completedAt);
  return Number.isFinite(fin) ? new Date(fin).toISOString().slice(0, 10) : "";
}

export function historiqueDesTournees(routes) {
  const tournees = (Array.isArray(routes) ? routes : [])
    .filter((r) => r && r.status === "terminee")
    .map((r) => {
      const debut = instant(r.startedAt), fin = instant(r.completedAt);
      const minutes = Number.isFinite(debut) && Number.isFinite(fin) && fin >= debut
        ? Math.round((fin - debut) / 60000)
        : null;
      const km = Number(r.totalDistance);
      const stops = Array.isArray(r.stops) ? r.stops : [];
      return {
        id: String(r.id),
        jour: jourDe(r),
        secteur: r.sector && r.sector !== "Tous" ? String(r.sector) : "Sans secteur",
        arrets: stops.length,
        livres: stops.filter((s) => s.status === "livre").length,
        km: r.totalDistance !== null && r.totalDistance !== undefined && r.totalDistance !== "" && Number.isFinite(km) ? km : null,
        minutes
      };
    })
    .sort((a, b) => (a.jour < b.jour ? 1 : a.jour > b.jour ? -1 : a.id < b.id ? 1 : -1));

  const parMois = new Map();
  for (const t of tournees) {
    const mois = t.jour.slice(0, 7) || "sans-date";
    if (!parMois.has(mois)) parMois.set(mois, new Map());
    const secteurs = parMois.get(mois);
    const ligne = secteurs.get(t.secteur) || { secteur: t.secteur, tournees: 0, km: 0, kmInconnus: 0, minutes: 0, minutesInconnues: 0, livres: 0 };
    ligne.tournees += 1;
    ligne.livres += t.livres;
    if (t.km === null) ligne.kmInconnus += 1; else ligne.km += t.km;
    if (t.minutes === null) ligne.minutesInconnues += 1; else ligne.minutes += t.minutes;
    secteurs.set(t.secteur, ligne);
  }
  const mois = [...parMois.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([cle, secteurs]) => {
      const lignes = [...secteurs.values()]
        .map((l) => ({ ...l, km: Math.round(l.km * 10) / 10 }))
        .sort((a, b) => a.secteur.localeCompare(b.secteur, "fr"));
      const total = lignes.reduce((s, l) => ({
        tournees: s.tournees + l.tournees,
        km: Math.round((s.km + l.km) * 10) / 10,
        minutes: s.minutes + l.minutes,
        livres: s.livres + l.livres
      }), { tournees: 0, km: 0, minutes: 0, livres: 0 });
      return { mois: cle, secteurs: lignes, total };
    });
  return { tournees, mois };
}

/** « 3 h 25 », « 45 min ». */
export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

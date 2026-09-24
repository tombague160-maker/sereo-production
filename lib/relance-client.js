// Les clients qui ne commandent plus (decision 5 de Thomas, 24/09).
//
// Mesure de l'audit : un client livre tous les mois pendant six mois, puis plus
// rien depuis 150 jours, restait « Client actif » et aucun ecran ne le
// montrait. Le filtre « Clients a relancer » existait, mais ne lisait que le
// statut pose a la main -- et « Confirmer » une commande planifiee ecrit
// « client_actif » en dur (server.js, confirmPlannedOrder) : le statut ne peut
// pas porter ce signal.
//
// La decision : on SIGNALE, sans changer le statut, un client NON abonne qui
// depasse 1,5 fois son rythme habituel -- l'intervalle median entre ses
// livraisons -- ou 90 jours s'il n'a ete livre qu'une fois.
//
// Le signal est DERIVE a chaque lecture, jamais ecrit : il se leve seul quand
// une livraison arrive, et un statut pose a la main n'est jamais touche.

const { jourParis, jourDeLInstant, estCleJour } = require("./jour-paris");

const COEFFICIENT_RYTHME = 1.5;
const SEUIL_UNE_LIVRAISON_JOURS = 90;
const JOUR_MS = 86400000;

// Une commande dans l'un de ces statuts est finie. Toute autre (planifiee, a
// confirmer, en preparation, en tournee, a relivrer...) veut dire que le client
// a quelque chose en cours : il ne s'est pas arrete.
const STATUTS_FINIS = new Set(["livre", "annulee"]);

/** Le jour de la livraison : deliveredAt (un instant, lu a Paris), sinon la date prevue. */
function jourDeLivraison(commande) {
  const instant = jourDeLInstant(commande.deliveredAt);
  if (instant) return instant;
  const prevu = String(commande.deliveryDate || commande.dateCommande || "").slice(0, 10);
  return estCleJour(prevu) ? prevu : "";
}

function ecartJours(de, a) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / JOUR_MS);
}

function mediane(valeurs) {
  const tri = [...valeurs].sort((x, y) => x - y);
  const milieu = Math.floor(tri.length / 2);
  return tri.length % 2 ? tri[milieu] : (tri[milieu - 1] + tri[milieu]) / 2;
}

/**
 * Le signal « a relancer » d'un client, ou null.
 *
 * `commandes` : ses commandes (tous statuts) ; `abonne` : vrai s'il a un
 * abonnement ACTIF ; `statutCrm` : le statut pose (« client_inactif » a la
 * main : deja classe, pas signale une seconde fois) ; `aujourdhui` : la cle du
 * jour a Paris.
 *
 * Rend { derniereLivraison, joursDepuis, rythmeJours (null si une seule
 * livraison), seuilJours }.
 */
function relanceSuggeree({ commandes = [], abonne = false, statutCrm = "", archive = false, aujourdhui = jourParis() } = {}) {
  if (abonne || archive || statutCrm === "client_inactif") return null;
  if (commandes.some(commande => !STATUTS_FINIS.has(commande.status))) return null;

  const jours = [...new Set(commandes
    .filter(commande => commande.status === "livre")
    .map(jourDeLivraison)
    .filter(Boolean))].sort();
  if (!jours.length) return null;

  const derniereLivraison = jours[jours.length - 1];
  const intervalles = jours.slice(1).map((jour, i) => ecartJours(jours[i], jour));
  const rythmeJours = intervalles.length ? mediane(intervalles) : null;
  const seuilJours = rythmeJours === null ? SEUIL_UNE_LIVRAISON_JOURS : rythmeJours * COEFFICIENT_RYTHME;
  const joursDepuis = ecartJours(derniereLivraison, aujourdhui);
  if (!(joursDepuis > seuilJours)) return null;

  return { derniereLivraison, joursDepuis, rythmeJours, seuilJours };
}

module.exports = { relanceSuggeree, COEFFICIENT_RYTHME, SEUIL_UNE_LIVRAISON_JOURS };

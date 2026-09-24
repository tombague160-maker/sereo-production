// Les dates et les heures de l'ecran : UN seul utilitaire (parcours
// simplifies, audit du 24/09).
//
// Mesure de l'audit : la meme date s'ecrivait de cinq facons -- « 24 sept. »
// (Commandes), « Jeu. 24 sept. » (Abonnements), « jeu. 24/09 » (Tournee),
// « Jeudi 24 septembre » (en-tetes), « 24/09/2026 » (Rappels) -- et l'heure de
// deux : « 16:00 » et « 16 h 00 ». Onze fonctions de date dans app.js, chacune
// son format. Il en reste QUATRE formes, toutes ici :
//
//   jourMois   « 24 sept. »            les colonnes et les lignes serrees
//   jourCourt  « jeu. 24 sept. »       une echeance, une livraison, un rappel
//   jourLong   « jeudi 24 septembre »  les en-tetes et les phrases
//   heure      « 16 h 00 »             toujours ainsi (l'usage francais)
//
// L'annee s'ajoute quand ce n'est pas celle d'aujourd'hui : « 1 janv. » d'une
// echeance ratee l'an dernier se lisait comme une date a venir.
//
// Une date SANS heure (« 2026-09-24 ») se lit a midi : un fuseau negatif ne la
// recule pas d'un jour. Un INSTANT (« 2026-09-24T14:32:00Z ») se lit dans le
// fuseau du navigateur -- celui de l'utilisateur, a Paris.

/** Une date (Date, « AAAA-MM-JJ » ou instant ISO) ; null si illisible. */
export function lireDate(valeur) {
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;
  const texte = String(valeur ?? "").trim();
  if (!texte) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(texte) ? new Date(`${texte}T12:00:00`) : new Date(texte);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Chaque forme a SON formateur Intl, construit une fois (integration de la
// performance, 24/09) : toLocaleDateString en construisait un a chaque date --
// 80 ms par frappe dans la recherche des Commandes au telephone. Meme texte :
// toLocaleDateString(l, o) est new Intl.DateTimeFormat(l, o).format(d) des
// qu'une option de date est donnee, ce que chaque forme fait.
const formateurs = new Map();
function formater(d, options) {
  const cle = JSON.stringify(options);
  let formateur = formateurs.get(cle);
  if (!formateur) {
    formateur = new Intl.DateTimeFormat("fr-FR", options);
    formateurs.set(cle, formateur);
  }
  return formateur.format(d);
}

function avecAnnee(d, options) {
  return d.getFullYear() !== new Date().getFullYear() ? { ...options, year: "numeric" } : options;
}

/** « 24 sept. » ; « 24 sept. 2025 » une autre annee ; « — » sans date. */
export function jourMois(valeur) {
  const d = lireDate(valeur);
  return d ? formater(d, avecAnnee(d, { day: "numeric", month: "short" })) : "—";
}

/** « jeu. 24 sept. » ; `majuscule` : « Jeu. 24 sept. » en debut de ligne. */
export function jourCourt(valeur, { majuscule = false } = {}) {
  const d = lireDate(valeur);
  if (!d) return "—";
  const texte = formater(d, avecAnnee(d, { weekday: "short", day: "numeric", month: "short" }));
  return majuscule ? texte.charAt(0).toUpperCase() + texte.slice(1) : texte;
}

/**
 * « jeudi 24 septembre » ; `majuscule` en debut de phrase ; `semaine: false`
 * pour « 24 septembre » seul. « 1er » pour le premier du mois.
 */
export function jourLong(valeur, { majuscule = false, semaine = true } = {}) {
  const d = lireDate(valeur);
  if (!d) return "—";
  const mois = formater(d, { month: "long" });
  const annee = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  const jour = semaine ? `${formater(d, { weekday: "long" })} ` : "";
  const texte = `${jour}${d.getDate() === 1 ? "1er" : d.getDate()} ${mois}${annee}`;
  return majuscule ? texte.charAt(0).toUpperCase() + texte.slice(1) : texte;
}

/** « 16 h 00 », « 9 h 05 » : l'heure a la francaise, jamais « 16:00 ». */
export function heure(valeur) {
  const d = lireDate(valeur);
  return d ? `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}` : "—";
}

/** « 24 septembre à 16 h 00 » : un instant (une importation, une sauvegarde). */
export function jourEtHeure(valeur) {
  const d = lireDate(valeur);
  return d ? `${jourLong(d, { semaine: false })} à ${heure(d)}` : "—";
}

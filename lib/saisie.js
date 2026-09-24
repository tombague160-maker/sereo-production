// Garde-fous de saisie (lot « donnees utiles », 24/09) : un telephone a 10
// chiffres, un code postal a 5 chiffres.
//
// Mesure de l'audit du 24/09 : une commande prise avec le telephone « abc » et
// le code postal « ABCDE » etait acceptee ; le bouton Appeler devenait un lien
// tel: vide et le secteur se deduisait d'un faux code postal.
//
// Trois regles :
//   - une saisie VALIDE est normalisee : « 06.12.34.56.78 », « 06 12 34 56 78 »,
//     « +33 6 12 34 56 78 » deviennent « 0612345678 » (on garde les chiffres,
//     l'affichage les regroupe par deux) ;
//   - une saisie INVALIDE est refusee (400, message nomme) ;
//   - une valeur DEJA en base, meme invalide, n'est jamais reecrite en silence
//     ni refusee quand elle revient telle quelle (un formulaire renvoie tous
//     ses champs) : elle est signalee a l'ecran (« a verifier »), pas corrigee.
//
// Le meme calcul existe cote navigateur (public/js/utils/text.js) : le banc
// test/garde-saisie.test.js passe les memes cas aux deux.

const TELEPHONE_INVALIDE = "Téléphone invalide : 10 chiffres attendus, par exemple 06 12 34 56 78 (le +33 est accepté).";
const CODE_POSTAL_INVALIDE = "Code postal invalide : 5 chiffres attendus, par exemple 25000.";

// Les separateurs acceptes : espaces (dont l'espace insecable), points, tirets.
const SEPARATEURS = /[\s.\-]/g;

/**
 * Le telephone normalise ("0612345678"), "" pour une saisie vide, ou null si
 * la saisie n'est pas un numero francais a 10 chiffres.
 */
function normaliserTelephone(valeur) {
  const brut = String(valeur ?? "").trim();
  if (!brut) return "";
  let compact = brut.replace(SEPARATEURS, "");
  // L'indicatif : +33 ou 0033, suivi des 9 chiffres (le « (0) » d'usage, ou
  // un 0 garde par erreur, sont toleres).
  const indicatif = compact.match(/^(?:\+33|0033)(?:\(0\))?(.*)$/);
  if (indicatif) {
    const reste = indicatif[1];
    compact = /^0/.test(reste) ? reste : `0${reste}`;
  }
  return /^0[1-9]\d{8}$/.test(compact) ? compact : null;
}

/** Le code postal normalise ("25000"), "" pour une saisie vide, ou null. */
function normaliserCodePostalSaisi(valeur) {
  const compact = String(valeur ?? "").replace(/\s+/g, "");
  if (!compact) return "";
  return /^\d{5}$/.test(compact) ? compact : null;
}

/** « 06 12 34 56 78 » pour un numero valide ; sinon la valeur telle quelle. */
function formaterTelephone(valeur) {
  const normalise = normaliserTelephone(valeur);
  if (!normalise) return String(valeur ?? "").trim();
  return normalise.replace(/(\d{2})(?=\d)/g, "$1 ");
}

/** Vrai si la valeur stockee est a verifier (non vide et invalide). */
function telephoneAVerifier(valeur) {
  return normaliserTelephone(valeur) === null;
}

function codePostalAVerifier(valeur) {
  return normaliserCodePostalSaisi(valeur) === null;
}

/**
 * La valeur a enregistrer pour un champ saisi. `nouvelle` undefined : le
 * champ n'est pas envoye, l'ancienne reste telle quelle. Identique a
 * l'ancienne (aux espaces pres) : gardee telle quelle, meme invalide.
 * Sinon : normalisee, ou refusee par `refuser(message)`.
 */
function valeurSaisie(nouvelle, ancienne, normaliser, message, refuser) {
  const avant = String(ancienne ?? "").trim();
  if (nouvelle === undefined) return avant;
  const brut = String(nouvelle ?? "").trim();
  if (brut === avant) return avant;
  const normalisee = normaliser(brut);
  if (normalisee === null) throw refuser(message);
  return normalisee;
}

function telephoneSaisi(nouvelle, ancienne, refuser) {
  return valeurSaisie(nouvelle, ancienne, normaliserTelephone, TELEPHONE_INVALIDE, refuser);
}

function codePostalSaisi(nouvelle, ancienne, refuser) {
  return valeurSaisie(nouvelle, ancienne, normaliserCodePostalSaisi, CODE_POSTAL_INVALIDE, refuser);
}

module.exports = {
  TELEPHONE_INVALIDE,
  CODE_POSTAL_INVALIDE,
  normaliserTelephone,
  normaliserCodePostalSaisi,
  formaterTelephone,
  telephoneAVerifier,
  codePostalAVerifier,
  telephoneSaisi,
  codePostalSaisi
};

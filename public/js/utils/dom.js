// Helpers DOM et echappement.
//
// Module ferme : aucune dependance, ni vers l'etat de l'application ni vers un
// autre module. C'est la brique de base de tout le rendu — chaque chaine
// injectee dans un innerHTML doit passer par escapeHtml ou escapeAttribute.

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeAttribute(value) {
  return escapeHtml(value);
}

export function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value ?? "").replace(/["\\\]]/g, "\\$&");
}

/**
 * Squelette de chargement : des blocs gris a la place du texte, le temps que
 * les donnees arrivent.
 *
 * La charte (DESIGN.md §2) prevoit un jeton pour ca -- `--v8-squelette` -- et
 * il n'etait employe NULLE PART : declare, mesure, jamais branche. Mesure du
 * 18/09 en ralentissant l'API a 2,5 s : les panneaux du tableau de bord sont
 * des boites BLANCHES VIDES pendant tout le chargement. Rien ne dit si ca
 * charge, si c'est vide, ou si c'est casse.
 *
 * Regle de la charte, non negociable : JAMAIS DE TEXTE DESSUS. Un squelette
 * n'annonce pas "chargement", il occupe la place de ce qui vient. Le fait qu'il
 * ne porte aucun glyphe a une consequence utile : le balayage de contraste ne
 * le juge pas, et n'a pas a l'exempter.
 *
 * `aria-hidden` et `aria-busy` sur le conteneur : un lecteur d'ecran ne doit
 * pas enumerer des blocs vides. C'est le conteneur qui annonce l'attente, pas
 * les blocs.
 *
 * @param {number} lignes  nombre de blocs (3 par defaut)
 * @param {"liste"|"lignes"|"carte"|"colonnes"} forme  la silhouette a occuper
 */
export function squelette(lignes = 3, forme = "liste") {
  // Un graphique n'a pas la silhouette d'une liste : ses barres montent depuis
  // le bas, a largeur egale et hauteur variable. Un squelette de lignes
  // horizontales pose dans un conteneur flex y devient une colonne etiree et
  // invisible -- mesure du 18/09 : .revenue-chart est en display:flex avec
  // align-items:stretch, et le squelette de liste y disparaissait.
  if (forme === "colonnes") {
    const hauteurs = [58, 84, 46, 72, 90, 64];
    return `
      <div class="squelette squelette-colonnes" aria-hidden="true">
        ${Array.from({ length: Math.max(1, lignes) }, (_, i) =>
          `<span class="squelette-bloc" style="--squelette-haut:${hauteurs[i % 6]}%"></span>`).join("")}
      </div>
    `;
  }
  // Des LIGNES a la hauteur des lignes reelles (planche 10b : « pas de saut a
  // l'arrivee des donnees »). Chaque ligne porte deux blocs -- le nom et sa
  // ligne de detail -- et sa hauteur vient de la zone, en CSS
  // (--squelette-ligne) : c'est la feuille qui connait la hauteur d'une ligne
  // de commande ou de stock, au bureau comme au telephone.
  if (forme === "lignes") {
    return `
      <div class="squelette squelette-lignes" aria-hidden="true">
        ${Array.from({ length: Math.max(1, lignes) }, (_, i) =>
          `<span class="squelette-ligne"><span class="squelette-bloc" style="--squelette-part:${[62, 48, 56, 44, 58][i % 5]}%"></span>`
          + `<span class="squelette-bloc squelette-bloc--detail" style="--squelette-part:${[38, 30, 34, 26, 32][i % 5]}%"></span></span>`).join("")}
      </div>
    `;
  }
  const bloc = i => `<span class="squelette-bloc" style="--squelette-part:${
    // Largeurs inegales : un squelette a lignes egales ressemble a un tableau,
    // pas a du texte. On alterne sans hasard, pour que deux rendus successifs
    // ne "bougent" pas sous les yeux.
    [92, 74, 86, 61, 80][i % 5]
  }%"></span>`;
  return `
    <div class="squelette squelette-${forme}" aria-hidden="true">
      ${Array.from({ length: Math.max(1, lignes) }, (_, i) => bloc(i)).join("")}
    </div>
  `;
}

/**
 * Etat vide, avec une action facultative.
 *
 * Mesure du 18/09 : 13 des 20 etats vides NOMMAIENT une action -- "Importe le
 * stock", "Cree une fiche", "Importe les dossiers du jour" -- sans l'offrir.
 * Le message disait quoi faire, et laissait l'utilisateur chercher ou.
 *
 * L'action est FACULTATIVE, et le troisieme argument garde l'appel a deux
 * arguments valide : les sept etats vides qui ne menent nulle part ("Les
 * ajustements manuels apparaitront ici") n'ont rien a offrir, et leur mettre
 * un bouton vers un endroit quelconque serait pire que rien.
 *
 * @param {string} title
 * @param {string} message
 * @param {{libelle: string, onglet: string}} [action]  destination, par ancre
 */
export function emptyState(title, message, action) {
  const bouton = action
    ? `<a class="button primary empty-state-action" href="#${escapeAttribute(action.onglet)}">${escapeHtml(action.libelle)}</a>`
    : "";
  return `
    <div class="empty-state">
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(message)}</p>
      ${bouton}
    </div>
  `;
}

/**
 * L'element est-il rendu (une boite a l'ecran) ? `checkVisibility()` n'existe
 * que depuis Safari 17.4 (mars 2024) : sur un iPhone en iOS 15.4 a 17.3,
 * l'appeler levait « checkVisibility is not a function » -- une fausse erreur
 * rouge apres une commande d'abonnement bien creee, et une promesse rejetee a
 * l'ouverture de l'agenda (chasse aux defauts, 25/09). Sans elle : une boite
 * de rendu (display: none n'en a aucune), le critere de toujours.
 */
export function estVisible(element) {
  if (!element) return false;
  if (typeof element.checkVisibility === "function") return element.checkVisibility();
  return element.getClientRects().length > 0;
}

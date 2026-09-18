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
 * @param {"liste"|"carte"|"colonnes"} forme  la silhouette a occuper
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

export function emptyState(title, message) {
  return `
    <div class="empty-state">
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

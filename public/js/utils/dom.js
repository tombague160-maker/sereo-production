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

export function emptyState(title, message) {
  return `
    <div class="empty-state">
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

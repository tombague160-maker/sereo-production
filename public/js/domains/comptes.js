// Comptes utilisateurs — gabarits et libellés.
//
// Module volontairement PUR : uniquement des chaînes et des gabarits HTML,
// aucun appel réseau, aucune lecture de l'état de l'application. Les fonctions
// d'entrée/sortie (apiFetch, notify, runAction) vivent dans app.js et n'y sont
// pas exportées ; les importer ici créerait un cycle app.js ↔ comptes.js, que
// le découpage par domaine ne pourra traiter proprement qu'une fois le store
// partagé en place.
//
// Les rôles reproduits ci-dessous doivent rester alignés sur la table ROLES du
// serveur. En cas de divergence, le serveur fait autorité : il refuse un rôle
// inconnu à la création comme à la modification.

import { escapeHtml, escapeAttribute, emptyState } from "../utils/dom.js";

export const ROLES_COMPTES = [
  { id: "admin", libelle: "Administrateur" },
  { id: "bureau", libelle: "Bureau" },
  { id: "preparateur", libelle: "Préparateur" },
  { id: "livreur", libelle: "Livreur" }
];

export function libelleRole(role) {
  const trouve = ROLES_COMPTES.find(r => r.id === role);
  return trouve ? trouve.libelle : String(role || "—");
}

/**
 * Pastille de rôle. Le rouge est réservé à l'administrateur : ce n'est pas une
 * alerte, c'est le rôle qui peut tout casser, et on veut qu'il se repère d'un
 * coup d'oeil dans la liste.
 */
export function pastilleRole(role) {
  if (role === "admin") return "pill-danger";
  if (role === "bureau") return "pill-blue";
  if (role === "preparateur") return "pill-warning";
  return "pill-ok";
}

export function optionsRoles(roleSelectionne = "livreur") {
  return ROLES_COMPTES.map(
    role =>
      `<option value="${escapeAttribute(role.id)}"${role.id === roleSelectionne ? " selected" : ""}>${escapeHtml(role.libelle)}</option>`
  ).join("");
}

function formatDateCompte(valeur) {
  if (!valeur) return "—";
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * Tableau des comptes.
 *
 * `identifiantCourant` sert à signaler « c'est toi » : supprimer son propre
 * compte est autorisé par le serveur dès lors qu'un autre administrateur
 * existe, mais mieux vaut que ce soit un geste conscient.
 *
 * Les classes du tableau sont celles de l'historique des imports, réutilisées
 * telles quelles : elles portent déjà les surcharges de mode clair et de thème
 * sombre, que des classes neuves n'auraient pas.
 */
export function gabaritTableauComptes(comptes, { identifiantCourant = "" } = {}) {
  if (!comptes.length) {
    return emptyState(
      "Aucun compte",
      "Crée le premier compte ci-dessous. Tant qu'aucun n'existe, l'accès repose uniquement sur les identifiants d'environnement."
    );
  }

  return `
    <div class="imports-archives-table-wrap">
      <table class="imports-archives-table">
        <thead>
          <tr>
            <th>Identifiant</th>
            <th>Rôle</th>
            <th>État</th>
            <th>Dernière connexion</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${comptes.map(compte => gabaritLigneCompte(compte, identifiantCourant)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function gabaritLigneCompte(compte, identifiantCourant) {
  const estMoi = compte.identifiant === identifiantCourant;
  const id = escapeAttribute(compte.id);

  return `
    <tr>
      <td>
        <strong>${escapeHtml(compte.identifiant)}</strong>
        ${estMoi ? ` <span class="muted">(toi)</span>` : ""}
      </td>
      <td>
        <select class="compte-role" data-action="changer-role-compte" data-compte-id="${id}" aria-label="Rôle de ${escapeAttribute(compte.identifiant)}">
          ${optionsRoles(compte.role)}
        </select>
      </td>
      <td>
        <span class="pill ${compte.actif ? "pill-ok" : "pill-danger"}">
          ${compte.actif ? "Actif" : "Désactivé"}
        </span>
      </td>
      <td class="muted">${escapeHtml(formatDateCompte(compte.derniereConnexion))}</td>
      <td class="comptes-actions">
        <button class="button secondary compact" type="button"
                data-action="basculer-compte" data-compte-id="${id}" data-compte-actif="${compte.actif ? "1" : "0"}">
          ${compte.actif ? "Désactiver" : "Réactiver"}
        </button>
        <button class="button secondary compact" type="button"
                data-action="changer-mot-de-passe-compte" data-compte-id="${id}"
                data-compte-identifiant="${escapeAttribute(compte.identifiant)}">
          Mot de passe
        </button>
        <button class="button ghost compact" type="button"
                data-action="supprimer-compte" data-compte-id="${id}"
                data-compte-identifiant="${escapeAttribute(compte.identifiant)}">
          Supprimer
        </button>
      </td>
    </tr>
  `;
}

/**
 * Message affiché à la place de la liste quand l'utilisateur connecté n'est pas
 * administrateur.
 *
 * Le bloc reste visible plutôt que masqué : sinon un préparateur qui cherche
 * « où sont les comptes » croit à un bug de l'application.
 */
export function gabaritAccesRefuse(roleLibelle) {
  return `<p class="muted">La gestion des comptes est réservée aux administrateurs. Ton rôle actuel est « ${escapeHtml(roleLibelle)} ».</p>`;
}

/**
 * Message affiché quand la protection d'accès n'est pas activée du tout
 * (développement local sans identifiants ni comptes).
 */
export function gabaritAuthDesactivee() {
  return `<p class="muted">La protection d'accès est désactivée sur cette instance. Crée un compte pour l'activer, ou renseigne <code>SEREO_AUTH_USER</code> et <code>SEREO_AUTH_PASSWORD</code>.</p>`;
}

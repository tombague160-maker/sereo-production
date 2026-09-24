// Normalisation de texte, codes produit et rendu Markdown minimal.
//
// normalizeTextKey sert de cle de comparaison insensible a la casse et aux
// accents : c'est elle qui fait matcher "Besancon" et "Besançon" dans les
// recherches et le rapprochement client.

import { escapeHtml, escapeAttribute } from "./dom.js";

export function normalizeTextKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Les villes que le serveur range SANS accent (normalizeCity : « Besancon »,
// qui sert aussi de cle de secteur). La valeur stockee ne change pas -- on ne
// reecrit jamais la fiche d'un client --, seul l'AFFICHAGE rend l'orthographe.
// Toute autre ville est rendue telle quelle.
const VILLES_ACCENTUEES = new Map([["besancon", "Besançon"]]);

export function villeAffichee(value) {
  const texte = String(value ?? "");
  return VILLES_ACCENTUEES.get(normalizeTextKey(texte)) || texte;
}

export function normalizePhoneNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const leadingPlus = raw.startsWith("+") ? "+" : "";
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `${leadingPlus}${digits}` : "";
}

// --- Garde-fous de saisie (lot « donnees utiles », 24/09) --------------------
//
// Le meme calcul que lib/saisie.js (le serveur refuse ce que ces fonctions
// refusent) ; test/garde-saisie.test.js passe les memes cas aux deux.
// Un telephone francais a 10 chiffres : espaces, points, tirets et +33 / 0033
// acceptes, « 0612345678 » garde. Un code postal a 5 chiffres.

const SEPARATEURS_TELEPHONE = /[\s.\-]/g;

/** "0612345678", "" (vide) ou null (pas un numero a 10 chiffres). */
export function normaliserTelephone(valeur) {
  const brut = String(valeur ?? "").trim();
  if (!brut) return "";
  let compact = brut.replace(SEPARATEURS_TELEPHONE, "");
  const indicatif = compact.match(/^(?:\+33|0033)(?:\(0\))?(.*)$/);
  if (indicatif) {
    const reste = indicatif[1];
    compact = /^0/.test(reste) ? reste : `0${reste}`;
  }
  return /^0[1-9]\d{8}$/.test(compact) ? compact : null;
}

/** "25000", "" (vide) ou null (pas 5 chiffres). */
export function normaliserCodePostalSaisi(valeur) {
  const compact = String(valeur ?? "").replace(/\s+/g, "");
  if (!compact) return "";
  return /^\d{5}$/.test(compact) ? compact : null;
}

/** « 06 12 34 56 78 » pour un numero valide ; sinon la valeur telle quelle. */
export function formaterTelephone(valeur) {
  const normalise = normaliserTelephone(valeur);
  if (!normalise) return String(valeur ?? "").trim();
  return normalise.replace(/(\d{2})(?=\d)/g, "$1 ");
}

/**
 * Le verdict d'une saisie EN COURS : « vide », « valide », « incomplet »
 * (peut encore devenir juste : on attend la sortie du champ pour le dire) ou
 * « invalide » (ne le deviendra pas : on le dit a la frappe).
 */
export function verdictSaisie(genre, valeur) {
  const brut = String(valeur ?? "").trim();
  if (!brut) return "vide";
  if (genre === "telephone") {
    if (normaliserTelephone(brut) !== null) return "valide";
    const compact = brut.replace(SEPARATEURS_TELEPHONE, "");
    // Une lettre, un signe : ce ne sera jamais un numero.
    if (/[^\d+()]/.test(compact)) return "invalide";
    // Trop de chiffres pour un numero en cours de frappe : faux des maintenant.
    const international = /^(\+|00)/.test(compact);
    const chiffres = compact.replace(/\D/g, "").length;
    return chiffres < (international ? 11 : 10) ? "incomplet" : "invalide";
  }
  if (normaliserCodePostalSaisi(brut) !== null) return "valide";
  const compact = brut.replace(/\s+/g, "");
  return /^\d{0,4}$/.test(compact) ? "incomplet" : "invalide";
}

// Separe un code-barre numerique (8-14 chiffres) du nom produit.
// Ex: "4052199301679 HARTMANN Change complet" -> {code: "4052199301679", name: "HARTMANN Change complet"}
// Si pas de code-barre detecte au debut, retourne {code: null, name: original}.
export function splitProductCode(text) {
  if (!text) return { code: null, name: "" };
  const t = String(text).trim();
  const m = t.match(/^(\d{8,14})\s+(.+)$/);
  if (m) return { code: m[1], name: m[2].trim() };
  return { code: null, name: t };
}

export function productKey(product) {
  if (!product || typeof product !== "object") return "";
  const code = normalizeTextKey(product.code || product.codeProduit || product.sku || product.reference || "");
  const nom = normalizeTextKey(product.nom || product.Nom || product.produit || product.Produit || product.name || "");
  return code || nom;
}

export function inlineMarkdown(text) {
  // S1 v1.13.0 : escape HTML AVANT de transformer le markdown, sinon le texte
  // brut peut injecter du HTML/JS dans la modal "Quoi de neuf" (les notes
  // viennent de GitHub release notes - source externe). escapeHtml ne touche
  // pas aux caracteres markdown ([ ] ( ) * `), donc les regex en dessous
  // fonctionnent toujours sur le contenu deja safe.
  const safe = escapeHtml(text);
  return safe
    // Bold + italic
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*([^*\s][^*]*[^*\s])\*(?=\W|$)/g, "$1<em>$2</em>")
    // Code inline
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Links [text](url) - url restreinte a http(s) ou anchor (filtre javascript:)
    // Le texte ($1) est deja escape par escapeHtml ci-dessus, donc safe.
    // L'URL ($2) est passee dans href : on l'echappe en attribut pour blinder.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#[^)\s]+)\)/g,
      (m, linkText, url) => `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${linkText}</a>`);
}

// Petit renderer markdown sans dependance : gere les titres ##, listes -, bold **,
// italic *, code inline `, links [text](url), paragraphes. Echappe le HTML pour
// eviter toute injection si les release notes contenaient du HTML brut.
export function renderSimpleMarkdown(md) {
  if (!md) return "";
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = escaped.split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      if (inList) { out.push("</ul>"); inList = false; }
      continue;
    }
    // Titres h2/h3
    let m = line.match(/^###\s+(.*)$/);
    if (m) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h3>${inlineMarkdown(m[1])}</h3>`);
      continue;
    }
    m = line.match(/^##\s+(.*)$/);
    if (m) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2>${inlineMarkdown(m[1])}</h2>`);
      continue;
    }
    // Liste -
    m = line.match(/^[\s]*[-*]\s+(.*)$/);
    if (m) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inlineMarkdown(m[1])}</li>`);
      continue;
    }
    // Paragraphe
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

/**
 * « 1 commande », « 3 commandes », « 0 commande » : le nombre et son mot,
 * accorde (parcours simplifies, 24/09 -- plus de « commande(s) »). En
 * francais, 0 et 1 sont au singulier. `pluriel` quand le mot ne prend pas
 * seulement un « s ».
 */
export function accorder(n, mot, pluriel = `${mot}s`) {
  const nombre = Number(n) || 0;
  return `${nombre} ${Math.abs(nombre) > 1 ? pluriel : mot}`;
}

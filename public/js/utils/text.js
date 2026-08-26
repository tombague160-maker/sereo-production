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

export function normalizePhoneNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const leadingPlus = raw.startsWith("+") ? "+" : "";
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `${leadingPlus}${digits}` : "";
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

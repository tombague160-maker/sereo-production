// Adresses, coordonnees et liens sortants (telephone, Google Maps).
//
// Note pour la phase 2 du chantier V8 : toCoordinate et getEntityCoordinates
// sont les seuls points d'entree des coordonnees dans le front. Le geocodage
// automatique viendra les alimenter, sans toucher au reste du rendu.

import { normalizePhoneNumber } from "./text.js";

export function getAddressParts(entity) {
  return {
    address: entity.address || entity.rue || entity.adresse || entity.Rue || "",
    postalCode: entity.postalCode || entity.codePostal || entity.cp || entity["Code Postal"] || "",
    city: entity.city || entity.ville || entity.Ville || ""
  };
}

export function toCoordinate(value, min, max) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;

  return parsed;
}

export function getEntityCoordinates(entity) {
  const lat = toCoordinate(entity.lat ?? entity.latitude, -90, 90);
  const lng = toCoordinate(entity.lng ?? entity.longitude, -180, 180);

  if (lat === null || lng === null) return null;

  return { lat, lng };
}

export function buildGoogleMapsUrl(entity) {
  const parts = getAddressParts(entity);
  const destination = [parts.address, parts.postalCode, parts.city].filter(Boolean).join(" ").trim();

  if (!parts.address || !parts.city || !destination) return "";

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export function buildPhoneUrl(value) {
  const phone = normalizePhoneNumber(value);
  return phone ? `tel:${phone}` : "";
}

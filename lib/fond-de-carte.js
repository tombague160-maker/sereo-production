// Le fond de carte (les tuiles) : UN seul endroit pour le choisir.
//
// Lot 4 de l'audit geo (23/09). Avant, l'URL d'OpenStreetMap etait ecrite en
// dur deux fois : dans public/js/app.js (L.tileLayer) et dans la CSP de
// server.js (img-src). Changer de fournisseur demandait deux modifications et
// un redeploiement ; en oublier une donnait une carte vide, sans message.
//
// Ici, l'environnement decide ; la page recoit le resultat par
// GET /api/carte/fond, et la CSP le lit a chaque reponse. Les deux suivent donc
// le meme hote, par construction.
//
//   SEREO_TUILES_URL          gabarit https avec {z}, {x}, {y} (et {s} permis
//                             dans l'hote seulement)
//   SEREO_TUILES_ATTRIBUTION  HTML de l'attribution exigee par le fournisseur
//   SEREO_TUILES_ZOOM_MAX     zoom maximal servi (defaut 19)
//
// Une URL invalide retombe sur le defaut, AVEC son attribution : garder
// l'attribution d'un autre fournisseur sur les tuiles d'OSM serait faux.

const OSM = Object.freeze({
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  // La licence ODbL et la politique d'usage des tuiles demandent le lien vers
  // la page de licence (constat de l'auditeur carte : il manquait).
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">les contributeurs d’OpenStreetMap</a>',
  zoomMax: 19
});

// L'origine seule part en Referer (pas le chemin ni le #onglet) : c'est ce que
// la politique d'OSM demande pour une page web. Le document garde
// `Referrer-Policy: no-referrer` pour tout le reste ; l'attribut de l'image
// l'emporte pour les tuiles seulement.
const REFERRER_POLICY = "strict-origin-when-cross-origin";

/** L'hote du gabarit, ou null si le gabarit n'est pas acceptable. */
function hoteDuGabarit(url) {
  if (typeof url !== "string" || url.length > 500) return null;
  const m = /^https:\/\/([^/?#]+)\/[^\s"'<>]*$/.exec(url.trim());
  if (!m) return null;
  if (!["{z}", "{x}", "{y}"].every(jeton => url.includes(jeton))) return null;
  const hote = m[1];
  // {s} (sous-domaines a/b/c) est le seul jeton admis dans l'hote : la CSP le
  // traduit en joker. Tout autre jeton ne se traduit pas.
  const sansS = hote.replace("{s}", "a");
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(sansS)) return null;
  return hote.replace("{s}", "*");
}

/**
 * Le fond de carte a utiliser, lu depuis `env`.
 * Rend { url, attribution, zoomMax, referrerPolicy, origineCsp }.
 */
function fondDeCarte(env = process.env) {
  const demande = String(env.SEREO_TUILES_URL || "").trim();
  const hote = demande ? hoteDuGabarit(demande) : null;
  const choisi = hote ? {
    url: demande,
    attribution: String(env.SEREO_TUILES_ATTRIBUTION || "").trim(),
    zoomMax: Number.parseInt(env.SEREO_TUILES_ZOOM_MAX, 10)
  } : { ...OSM };
  if (demande && !hote && !fondDeCarte.dejaSignale) {
    fondDeCarte.dejaSignale = true;
    console.warn("[carte] SEREO_TUILES_URL invalide (https et {z}/{x}/{y} requis) : OpenStreetMap par defaut.");
  }
  if (!Number.isInteger(choisi.zoomMax) || choisi.zoomMax < 1 || choisi.zoomMax > 22) choisi.zoomMax = OSM.zoomMax;
  return {
    ...choisi,
    referrerPolicy: REFERRER_POLICY,
    origineCsp: `https://${hote || hoteDuGabarit(OSM.url)}`
  };
}

module.exports = { fondDeCarte, OSM };

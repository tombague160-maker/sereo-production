// Adresses a verifier (lot 3 de l'audit geo, 23/09 -- H7).
//
// Avant : aucun ecran. Un client sans position ne se voyait nulle part, la
// seule saisie de coordonnees etait deux champs numeriques caches au
// telephone, et elle envoyait l'identifiant de l'ARRET au lieu du client
// (« Client introuvable »). Ici, au bureau comme au telephone :
//   - la liste des clients sans position, a position approximative (rue,
//     lieu-dit, commune) ou dont l'adresse a change apres une saisie manuelle ;
//   - la proposition de la BAN, acceptee d'un clic ;
//   - une recherche d'adresse (ou un « latitude, longitude » colle) ;
//   - une mini-carte Leaflet au marqueur deplacable ;
//   - l'alerte « N clients a livrer sans position » la ou on prepare la
//     tournee, et la liste des adresses douteuses quand un calcul est refuse.
//
// Comme operations.js : les entrees-sorties (apiFetch, notify, loadData)
// arrivent par `initAdresses(context)`. Les importer d'app.js creerait un
// cycle d'imports.

import { escapeHtml, escapeAttribute } from "../utils/dom.js";
import { villeAffichee } from "../utils/text.js";

let ctx = null;
let liste = [];
let enEdition = null; // id du client dont l'editeur est ouvert
let choix = null; // { lat, lng, precision, libelle } : la position a enregistrer
let carte = null;
let marqueur = null;

const JURA = [46.75, 5.9];
const PRECISIONS = {
  numero: "au numéro",
  rue: "au milieu de la rue",
  "lieu-dit": "au centre du lieu-dit",
  commune: "au centre de la commune",
  manuel: "placée à la main"
};
const RAISONS = {
  "sans-position": { mot: "Sans position", classe: "adr-puce--alerte" },
  approximative: { mot: "Approximative", classe: "adr-puce--avertissement" },
  "adresse-modifiee": { mot: "Adresse modifiée", classe: "adr-puce--avertissement" },
  demandee: { mot: "À corriger", classe: "adr-puce--neutre" }
};
const APPROXIMATIVES = new Set(["rue", "lieu-dit", "commune"]);
const A_LIVRER = new Set(["pret_livraison", "a_reprogrammer", "en_livraison"]);

export function initAdresses(context) {
  ctx = context;
  document.addEventListener("click", surClic);
  document.addEventListener("submit", surEnvoi);
  const dialogue = document.getElementById("adressesDialog");
  if (dialogue) dialogue.addEventListener("close", fermerEditeur);
}

// --- L'alerte de la preparation de tournee (sans requete : les donnees sont la) --

function aUnePosition(entite) {
  const lat = Number.parseFloat(entite?.lat);
  const lng = Number.parseFloat(entite?.lng);
  return entite?.lat !== "" && entite?.lng !== "" && Number.isFinite(lat) && Number.isFinite(lng);
}

/**
 * Compte, depuis les donnees deja chargees, les clients a livrer sans
 * position (une commande prete sans point, et un client sans point) et les
 * positions approximatives. Le detail et les propositions viennent du
 * serveur a l'ouverture de l'ecran.
 */
export function compterAdresses(clients = [], commandes = []) {
  const parId = new Map(clients.map(c => [String(c.id), c]));
  const sansPosition = new Set();
  for (const commande of commandes) {
    if (!A_LIVRER.has(commande.status) || aUnePosition(commande)) continue;
    const client = parId.get(String(commande.clientId));
    if (client && aUnePosition(client)) continue;
    sansPosition.add(String(commande.clientId));
  }
  const approximatives = clients.filter(c =>
    !c.crmArchived && aUnePosition(c)
    && ((APPROXIMATIVES.has(c.geoPrecision) && c.geoSource !== "manuel") || c.geoAVerifier === "adresse-modifiee")
  ).length;
  return { aLivrerSansPosition: sansPosition.size, approximatives };
}

export function majAlerteAdresses(clients, commandes) {
  const zone = document.getElementById("adressesAlerte");
  if (!zone) return;
  const { aLivrerSansPosition, approximatives } = compterAdresses(clients, commandes);
  const texte = zone.querySelector("[data-adr-texte]");
  if (!aLivrerSansPosition && !approximatives) {
    zone.hidden = true;
    return;
  }
  const morceaux = [];
  if (aLivrerSansPosition) {
    morceaux.push(aLivrerSansPosition === 1 ? "1 client à livrer sans position" : `${aLivrerSansPosition} clients à livrer sans position`);
  }
  if (approximatives) {
    morceaux.push(approximatives === 1 ? "1 position approximative" : `${approximatives} positions approximatives`);
  }
  if (texte) texte.textContent = morceaux.join(" · ");
  zone.classList.toggle("adr-alerte--bloquante", aLivrerSansPosition > 0);
  zone.hidden = false;
}

/** Un calcul de tournee refuse : TOUTES les adresses douteuses, chacune avec son geste. */
export function afficherErreursTournee(adresses) {
  const zone = document.getElementById("adressesTourneeErreurs");
  if (!zone) return;
  if (!Array.isArray(adresses) || !adresses.length) {
    zone.hidden = true;
    zone.innerHTML = "";
    return;
  }
  zone.innerHTML = `
    <p class="adr-erreurs-titre">${adresses.length === 1 ? "1 adresse bloque le calcul" : `${adresses.length} adresses bloquent le calcul`}</p>
    <ul class="adr-erreurs-liste">
      ${adresses.map(a => `
        <li>
          <span><strong>${escapeHtml(a.clientName)}</strong> <span class="adr-motif">${escapeHtml(a.motif)}</span></span>
          ${a.clientId ? `<button class="button secondary compact" type="button" data-adr="ouvrir" data-adr-client="${escapeAttribute(a.clientId)}">Corriger</button>` : ""}
        </li>`).join("")}
    </ul>`;
  zone.hidden = false;
}

// --- L'ecran ------------------------------------------------------------------

export async function ouvrirAdresses(clientId = "") {
  const dialogue = document.getElementById("adressesDialog");
  if (!dialogue || !ctx) return;
  if (!dialogue.open) {
    if (typeof dialogue.showModal === "function") dialogue.showModal();
    else dialogue.setAttribute("open", "");
  }
  await chargerListe(clientId);
  if (clientId) {
    const ligne = liste.find(l => String(l.id) === String(clientId));
    if (ligne) ouvrirEditeur(ligne.id);
  }
}

async function chargerListe(inclure = "") {
  const resume = document.getElementById("adressesResume");
  const conteneur = document.getElementById("adressesListe");
  if (resume) resume.textContent = "Chargement…";
  try {
    const url = `/api/adresses/a-verifier${inclure ? `?client=${encodeURIComponent(inclure)}` : ""}`;
    const donnees = await ctx.apiFetch(url);
    liste = Array.isArray(donnees?.clients) ? donnees.clients : [];
    if (resume) resume.textContent = resumer(donnees);
    const source = document.getElementById("adressesSource");
    if (source && donnees?.source) source.textContent = `Adresses : ${donnees.source}.`;
  } catch (erreur) {
    liste = [];
    if (resume) resume.textContent = erreur?.message || "Liste indisponible.";
  }
  if (conteneur) conteneur.innerHTML = liste.length ? liste.map(rendreLigne).join("") : `<p class="adr-vide">Toutes les adresses ont une position au numéro. Rien à vérifier.</p>`;
}

function resumer(donnees) {
  if (!donnees || !donnees.total) return "Aucune adresse à vérifier.";
  const morceaux = [];
  if (donnees.sansPosition) morceaux.push(`${donnees.sansPosition} sans position`);
  if (donnees.approximatives) morceaux.push(`${donnees.approximatives} approximative${donnees.approximatives > 1 ? "s" : ""}`);
  if (donnees.adressesModifiees) morceaux.push(`${donnees.adressesModifiees} adresse${donnees.adressesModifiees > 1 ? "s" : ""} modifiée${donnees.adressesModifiees > 1 ? "s" : ""}`);
  return `${donnees.total} client${donnees.total > 1 ? "s" : ""} à vérifier${morceaux.length ? ` : ${morceaux.join(", ")}` : ""}.`;
}

function adresseLisible(ligne) {
  return [ligne.rue, [ligne.codePostal, villeAffichee(ligne.ville)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Adresse manquante";
}

function libellePrecision(precision) {
  return PRECISIONS[precision] || "";
}

function rendreLigne(ligne) {
  const raison = RAISONS[ligne.raison] || RAISONS["sans-position"];
  const aLivrer = ligne.commandesALivrer
    ? `<p class="adr-a-livrer">${ligne.commandesALivrer === 1 ? "1 commande à livrer" : `${ligne.commandesALivrer} commandes à livrer`}</p>`
    : "";
  const precision = ligne.raison === "approximative" && ligne.geoPrecision
    ? `<p class="adr-detail">Position ${escapeHtml(libellePrecision(ligne.geoPrecision))}.</p>`
    : ligne.raison === "adresse-modifiee"
      ? `<p class="adr-detail">L’adresse a changé depuis la position placée à la main.</p>`
      : "";
  const proposition = ligne.proposition
    ? `<button class="button primary adr-accepter" type="button" data-adr="accepter" data-adr-client="${escapeAttribute(ligne.id)}">
        <span>Accepter la proposition</span>
        <span class="adr-proposition">${escapeHtml(ligne.proposition.libelle || `${ligne.proposition.lat}, ${ligne.proposition.lng}`)}${ligne.proposition.precision ? ` · ${escapeHtml(libellePrecision(ligne.proposition.precision))}` : ""}</span>
      </button>`
    : "";
  const garder = ligne.raison === "adresse-modifiee"
    ? `<button class="button secondary" type="button" data-adr="garder" data-adr-client="${escapeAttribute(ligne.id)}">Garder la position</button>`
    : "";
  return `
    <article class="adr-ligne" data-adr-ligne="${escapeAttribute(ligne.id)}">
      <div class="adr-ligne-tete">
        <div class="adr-ligne-texte">
          <strong class="adr-nom">${escapeHtml(ligne.nom)}</strong>
          <span class="adr-adresse">${escapeHtml(adresseLisible(ligne))}</span>
          ${ligne.complement ? `<span class="adr-complement">Complément : ${escapeHtml(ligne.complement)}</span>` : ""}
        </div>
        <span class="adr-puce ${raison.classe}">${escapeHtml(raison.mot)}</span>
      </div>
      ${precision}
      ${aLivrer}
      <div class="adr-actions">
        ${proposition}
        <button class="button secondary" type="button" data-adr="corriger" data-adr-client="${escapeAttribute(ligne.id)}" aria-expanded="false">Placer sur la carte</button>
        ${garder}
      </div>
      <div class="adr-editeur" data-adr-editeur hidden></div>
    </article>`;
}

function ligneDe(id) {
  return liste.find(l => String(l.id) === String(id)) || null;
}

function rendreEditeur(ligne) {
  const recherche = ligne.adresseExploitable || ligne.rue || ligne.ville
    ? [ligne.rue, ligne.codePostal, ligne.ville].filter(Boolean).join(" ")
    : "";
  return `
    <form class="adr-recherche" data-adr-form="recherche">
      <label class="adr-champ">
        <span>Rechercher une adresse, ou coller « latitude, longitude »</span>
        <input name="q" type="search" autocomplete="off" value="${escapeAttribute(recherche)}" data-adr-champ>
      </label>
      <button class="button secondary" type="submit">Rechercher</button>
    </form>
    <div class="adr-resultats" data-adr-resultats></div>
    <div class="adr-carte" id="adresseCarte" role="application" aria-label="Carte : fais glisser le marqueur jusqu’à la porte du client"></div>
    <p class="adr-aide">Fais glisser le marqueur jusqu’à la porte, ou touche la carte à l’endroit exact.</p>
    <p class="adr-position" data-adr-position role="status" aria-live="polite"></p>
    <p class="adr-erreur" data-adr-erreur role="alert" hidden></p>
    <div class="adr-actions">
      <button class="button primary" type="button" data-adr="enregistrer" data-adr-client="${escapeAttribute(ligne.id)}" disabled>Enregistrer cette position</button>
      <button class="button tertiary" type="button" data-adr="annuler">Annuler</button>
    </div>`;
}

function ouvrirEditeur(id) {
  fermerEditeur();
  const ligne = ligneDe(id);
  const article = document.querySelector(`[data-adr-ligne="${cssId(id)}"]`);
  if (!ligne || !article) return;
  enEdition = ligne.id;
  const zone = article.querySelector("[data-adr-editeur]");
  zone.innerHTML = rendreEditeur(ligne);
  zone.hidden = false;
  article.querySelector('[data-adr="corriger"]')?.setAttribute("aria-expanded", "true");
  const depart = aUnePosition(ligne)
    ? { lat: Number(ligne.lat), lng: Number(ligne.lng), precision: ligne.geoPrecision || "manuel", libelle: "" }
    : ligne.proposition
      ? { ...ligne.proposition }
      : null;
  monterCarte(depart);
  choisir(depart, { initial: true });
  article.scrollIntoView?.({ block: "nearest" });
  zone.querySelector("[data-adr-champ]")?.focus();
}

function fermerEditeur() {
  if (carte) {
    carte.remove();
    carte = null;
    marqueur = null;
  }
  document.querySelectorAll("[data-adr-editeur]").forEach(zone => {
    zone.hidden = true;
    zone.innerHTML = "";
  });
  document.querySelectorAll('[data-adr="corriger"]').forEach(b => b.setAttribute("aria-expanded", "false"));
  enEdition = null;
  choix = null;
}

/**
 * Le focus apres un geste qui detruit le bouton actif (Annuler vide
 * l'editeur ; Accepter, Garder et Enregistrer reecrivent la liste). Sans cela
 * il retombait sur <body> et il fallait reparcourir la fenetre au clavier
 * (relecture du lot 3). Ordre : le bouton « Placer sur la carte » de la meme
 * ligne si elle est encore la, sinon la ligne qui a pris sa place, sinon le
 * resume de la liste.
 */
function remettreLeFocus(id, index = 0) {
  const conteneur = document.getElementById("adressesListe");
  if (!conteneur) return;
  const meme = id ? conteneur.querySelector(`[data-adr-ligne="${cssId(id)}"] [data-adr="corriger"]`) : null;
  const lignes = [...conteneur.querySelectorAll("[data-adr-ligne]")];
  const voisine = lignes.length ? lignes[Math.min(Math.max(index, 0), lignes.length - 1)] : null;
  let cible = meme || voisine?.querySelector("button[data-adr]") || null;
  if (!cible) {
    cible = document.getElementById("adressesResume");
    cible?.setAttribute("tabindex", "-1");
  }
  cible?.focus();
}

function cssId(id) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/"/g, '\\"');
}

function monterCarte(depart) {
  const element = document.getElementById("adresseCarte");
  if (!element || typeof L === "undefined") {
    if (element) element.textContent = "Carte indisponible : recherche une adresse ou colle une position.";
    return;
  }
  carte = L.map(element, { zoomControl: true }).setView(depart ? [depart.lat, depart.lng] : JURA, depart ? 17 : 9);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap · Adresses : BAN"
  }).addTo(carte);
  carte.on("click", evenement => choisir({ lat: evenement.latlng.lat, lng: evenement.latlng.lng, precision: "manuel", libelle: "" }));
  // Le dialogue vient de s'ouvrir : Leaflet doit relire sa taille.
  setTimeout(() => carte?.invalidateSize(), 60);
}

function placerMarqueur(point) {
  if (!carte || !point) return;
  if (!marqueur) {
    marqueur = L.marker([point.lat, point.lng], { draggable: true, keyboard: true, title: "Position du client", alt: "Position du client" }).addTo(carte);
    marqueur.on("dragend", () => {
      const p = marqueur.getLatLng();
      choisir({ lat: p.lat, lng: p.lng, precision: "manuel", libelle: "" }, { deplacerCarte: false });
    });
  } else {
    marqueur.setLatLng([point.lat, point.lng]);
  }
}

function arrondi(valeur) {
  return Math.round(Number(valeur) * 1e6) / 1e6;
}

function choisir(point, { initial = false, deplacerCarte = true } = {}) {
  const affichage = document.querySelector("[data-adr-position]");
  const bouton = document.querySelector('[data-adr="enregistrer"]');
  masquerErreur();
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) {
    choix = null;
    if (affichage) affichage.textContent = "Aucune position choisie.";
    if (bouton) bouton.disabled = true;
    return;
  }
  choix = { lat: arrondi(point.lat), lng: arrondi(point.lng), precision: point.precision || "manuel", libelle: point.libelle || "" };
  placerMarqueur(choix);
  if (carte && deplacerCarte) carte.setView([choix.lat, choix.lng], Math.max(carte.getZoom(), 16));
  const precision = libellePrecision(choix.precision);
  if (affichage) {
    affichage.textContent = `${initial ? "Position actuelle" : "Position choisie"} : ${choix.lat.toLocaleString("fr-FR", { maximumFractionDigits: 6 })}, ${choix.lng.toLocaleString("fr-FR", { maximumFractionDigits: 6 })}${precision ? ` (${precision})` : ""}${choix.libelle ? ` — ${choix.libelle}` : ""}`;
  }
  if (bouton) bouton.disabled = false;
}

function montrerErreur(message, corrigee = null) {
  const zone = document.querySelector("[data-adr-erreur]");
  if (!zone) {
    ctx.notify(message, "warning");
    return;
  }
  zone.innerHTML = `${escapeHtml(message)}${corrigee ? ` <button class="button secondary compact" type="button" data-adr="inverser" data-adr-lat="${escapeAttribute(corrigee.lat)}" data-adr-lng="${escapeAttribute(corrigee.lng)}">Inverser</button>` : ""}`;
  zone.hidden = false;
}

function masquerErreur() {
  const zone = document.querySelector("[data-adr-erreur]");
  if (zone) {
    zone.hidden = true;
    zone.textContent = "";
  }
}

async function rechercher(q) {
  const resultats = document.querySelector("[data-adr-resultats]");
  const texte = String(q || "").trim();
  // Une position collee depuis une carte : « 46.7512, 5.9123 ».
  const nombres = texte.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
  if (nombres) {
    if (resultats) resultats.innerHTML = "";
    choisir({ lat: Number(nombres[1].replace(",", ".")), lng: Number(nombres[2].replace(",", ".")), precision: "manuel", libelle: "" });
    return;
  }
  if (resultats) resultats.innerHTML = `<p class="adr-aide">Recherche…</p>`;
  try {
    const trouves = await ctx.apiFetch(`/api/geocode?q=${encodeURIComponent(texte)}`);
    if (!resultats) return;
    if (!Array.isArray(trouves) || !trouves.length) {
      resultats.innerHTML = `<p class="adr-aide">Aucune adresse trouvée. Précise la commune, ou place le marqueur à la main.</p>`;
      return;
    }
    resultats.innerHTML = `<ul class="adr-resultats-liste" aria-label="Résultats de la recherche">${trouves.map((r, i) => `
      <li><button class="adr-resultat" type="button" data-adr="resultat" data-adr-index="${i}">
        <span>${escapeHtml(r.label)}</span>
        <span class="adr-resultat-precision">${escapeHtml(libellePrecision(r.precision) || r.type || "")}</span>
      </button></li>`).join("")}</ul>`;
    resultats.dataset.trouves = JSON.stringify(trouves.map(r => ({ lat: r.lat, lng: r.lng, precision: r.precision, libelle: r.label })));
  } catch (erreur) {
    if (resultats) resultats.innerHTML = `<p class="adr-aide">${escapeHtml(erreur?.message || "Recherche impossible.")}</p>`;
  }
}

async function enregistrer(id, point, bouton) {
  const ligne = ligneDe(id);
  if (!ligne || !point) return;
  if (bouton) bouton.disabled = true;
  try {
    await ctx.apiFetch(`/api/clients/${encodeURIComponent(id)}/coordinates`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: point.lat, lng: point.lng, precision: point.precision || "manuel", libelle: point.libelle || "" })
    });
    ctx.notify(`Position enregistrée pour ${ligne.nom}.`, "success");
    const index = liste.findIndex(l => String(l.id) === String(id));
    fermerEditeur();
    await chargerListe();
    remettreLeFocus(id, index);
    afficherErreursTournee([]);
    await ctx.loadData();
  } catch (erreur) {
    if (bouton) bouton.disabled = false;
    if (erreur?.enFile) {
      ctx.notify(erreur.message, "info");
      return;
    }
    montrerErreur(erreur?.message || "Position refusée.", erreur?.details?.corrigee || null);
  }
}

function surClic(evenement) {
  const cible = evenement.target.closest?.("[data-adr]");
  if (!cible) return;
  const action = cible.dataset.adr;
  const id = cible.dataset.adrClient;
  if (action === "ouvrir") {
    evenement.preventDefault();
    ouvrirAdresses(id || "").catch(e => ctx.notify(e.message, "warning"));
  } else if (action === "ouvrir-cible") {
    const cibleCourante = ctx.getCurrentTarget?.();
    const clientId = cibleCourante?.clientId || cibleCourante?.id || "";
    ouvrirAdresses(clientId).catch(e => ctx.notify(e.message, "warning"));
  } else if (action === "fermer") {
    document.getElementById("adressesDialog")?.close();
  } else if (action === "corriger") {
    if (String(enEdition) === String(id)) fermerEditeur();
    else ouvrirEditeur(id);
  } else if (action === "annuler") {
    const ouvert = enEdition;
    fermerEditeur();
    remettreLeFocus(ouvert);
  } else if (action === "accepter") {
    const ligne = ligneDe(id);
    if (ligne?.proposition) enregistrer(id, ligne.proposition, cible);
  } else if (action === "garder") {
    const ligne = ligneDe(id);
    if (ligne && aUnePosition(ligne)) enregistrer(id, { lat: Number(ligne.lat), lng: Number(ligne.lng), precision: "manuel", libelle: "" }, cible);
  } else if (action === "enregistrer") {
    enregistrer(id, choix, cible);
  } else if (action === "resultat") {
    const zone = document.querySelector("[data-adr-resultats]");
    const trouves = JSON.parse(zone?.dataset.trouves || "[]");
    choisir(trouves[Number(cible.dataset.adrIndex)] || null);
  } else if (action === "inverser") {
    choisir({ lat: Number(cible.dataset.adrLat), lng: Number(cible.dataset.adrLng), precision: "manuel", libelle: "" });
  }
}

function surEnvoi(evenement) {
  const formulaire = evenement.target.closest?.('[data-adr-form="recherche"]');
  if (!formulaire) return;
  evenement.preventDefault();
  rechercher(formulaire.elements.q?.value || "");
}

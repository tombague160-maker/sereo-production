import { initOperations, renderOperations, getRoutePoints, majSousTitreAbonnements } from "./operations.js";
// Sereo — point d'entree du front.
//
// Charge comme module ES (<script type="module"> dans index.html). Les
// utilitaires purs et les donnees de configuration vivent desormais dans
// ./utils/ et ./config/ ; ce fichier conserve l'etat de l'application et le
// rendu, qui seront decoupes par domaine dans les increments suivants.

import { escapeHtml, escapeAttribute, cssEscape, emptyState, squelette } from "./utils/dom.js";
import { mettreEnAttente, compterFile, rejouer } from "./utils/file-attente.js";
import {
  normalizeTextKey,
  normalizePhoneNumber,
  splitProductCode,
  productKey,
  inlineMarkdown,
  renderSimpleMarkdown
} from "./utils/text.js";
import {
  getAddressParts,
  toCoordinate,
  getEntityCoordinates,
  buildGoogleMapsUrl,
  buildPhoneUrl
} from "./utils/address.js";
import {
  DEFAULT_BRAND_IMAGE,
  DEFAULT_BRAND_IMAGE_DARK,
  DEFAULT_BRAND_CACHE_VERSION,
  MAX_BRAND_IMAGE_SIZE,
  applicationThemes
} from "./config/themes.js";
import { mainTabs, MOBILE_OVERFLOW_TABS, titles, GROUPES_NAV, REDIRECTIONS, ECRANS_SECONDAIRES } from "./config/tabs.js";
import {
  gabaritTableauComptes,
  gabaritLignesComptes,
  gabaritFeuilleCompte,
  CHEVRON_LIGNE,
  gabaritAccesRefuse,
  gabaritAuthDesactivee,
  optionsRoles,
  libelleRole
} from "./domains/comptes.js";

let map;
let clients = [];
let orders = [];
let stock = [];
let stockMovements = [];
let ventes = [];
let historique = [];
let crmClients = [];
let crmRelances = [];
let todayCustomerOrders = [];
let plannedOrders = [];
let statistics = null;
let sectors = [];
let deliverySectors = [];
let deliveryRoutes = [];
let dashboard = null;
let route = [];
let activeRoute = null;
let currentIndex = -1;
let activeStopIndex = 0;
// Nombre d'attentes d'envoi d'une livraison en cours (voir solderLivraisonEnSuspens) :
// les gestes d'arret sont desactives pendant ce temps. Le livreur voit que son
// appui est pris, et ne relance pas « Livre » sur un ecran qui n'a pas encore
// bouge (revue du 23/09 : en reseau lent, l'appui impatient livrait l'arret
// SUIVANT, jamais vu).
let gestesVerrouilles = 0;
let markers = [];
let routeLine = null;
let routeLineLisere = null;
let deliverySelection = new Set();
// Faux tant que le PREMIER loadData() n'a pas rendu les commandes. Avant, la
// liste « vide » ne veut rien dire : ni « aucune commande », ni une selection
// possible (voir renderDeliveryCandidates et activerSelectionLivraison).
let commandesChargees = false;
let deliveryFilter = {
  sector: "Tous",
  city: "",
  date: ""
};
let stockFilter = {
  query: "",
  status: "all",
  category: "all"
};
let crmFilter = {
  query: "",
  status: "all",
  // Le secteur (planche 13e) : "" = tous, "__abonnes" = les abonnes.
  secteur: ""
};
// Le client dont la fiche est ouverte (planche 13e : une ligne selectionnee).
let clientChoisi = null;
// Les abonnements et leurs echeances, pour la fiche client.
let abonnementsDonnees = { items: [], occurrences: [] };
let relanceFilter = "today";
let customerProductFilter = {
  query: "",
  category: "all"
};
let customerCart = new Map();
let lastImportSummary = null;
let recommendFilter = "urgent";
let preparationFilter = { query: "", sector: "all" };
let activeThemeId = "sereo";
let activeBrandImage = "/brand/sereo-logo.svg";
// "auto" suit l'OS (prefers-color-scheme), "light"/"dark" force.
// Persistance par appareil dans localStorage. Synchro DB optionnelle (multi-device).
// Defaut "light" : pendant la phase de test, on n'active pas le mode sombre auto.
// L'utilisateur peut basculer via Parametres > Mode d'affichage.
// Defaut "auto" : on suit le systeme tant que personne n'a choisi.
// Doit rester en accord avec anti-fart.js, qui tranche AVANT le rendu.
let activeColorScheme = "auto";

// V8 phase 1 : identite connectee et liste des comptes.
// `moi` reste null tant que /api/me n'a pas repondu ; renderComptes s'en
// sert pour ne PAS appeler /api/comptes quand l'utilisateur n'est pas
// administrateur — un 403 y serait journalise en erreur console et ferait
// echouer le parcours e2e des 15 onglets, dont la liste d'erreurs tolerees
// est volontairement vide.
let moi = null;
let comptes = [];


if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}





document.addEventListener("DOMContentLoaded", () => {
  // Resolution synchrone du mode (avant tout render) :
  // - localStorage "dark"|"light"|"auto" -> on respecte le choix utilisateur
  // - sinon defaut "auto" : on suit le systeme (decision Tom, 17/09)
  try {
    const stored = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
    if (VALID_COLOR_SCHEMES.includes(stored)) activeColorScheme = stored;
  } catch { /* ignore */ }

  applyTheme("sereo", { persist: false });
  applyBrandImage(DEFAULT_BRAND_IMAGE);
  updateMetaThemeColor();
  watchSystemColorScheme();
  bindUi();
  initOperations({apiFetch, loadData, notify, recalculateRoute, formatSectorLabel});
  bindVersionModal();
  bindBonsCommandeUi();
  initMap();
  registerServiceWorker();
  brancherFileHorsLigne();
  // Avant showTab : au telephone, les filtres de la Preparation vivent dans
  // la fente d'en-tete, que showTab montre ou cache par ecran.
  placerFiltresPreparation();
  showTab(getInitialTab(), { updateHash: false });
  loadAppearance();
  loadVersionInfo();
  loadMoi();
  loadData();
  checkStorageRecovery();
});

// B3 v1.16.0 : si le serveur a subi une recovery de corruption SQLite (restore
// d'un backup ou base vierge), on affiche une banniere d'alerte PERSISTANTE pour
// que l'operateur SACHE qu'il y a eu un sinistre (sinon une base vierge ressemble
// a une install neuve et il re-saisit par-dessus sans le savoir).
async function checkStorageRecovery() {
  try {
    const status = await apiFetch("/api/storage/status");
    if (status && status.lastRecovery) {
      showStorageRecoveryBanner(status.lastRecovery);
    }
  } catch { /* endpoint indisponible : pas de banniere, non bloquant */ }
}

function showStorageRecoveryBanner(recovery) {
  if (document.getElementById("storageRecoveryBanner")) return; // deja affichee
  const banner = document.createElement("div");
  banner.id = "storageRecoveryBanner";
  banner.className = "storage-recovery-banner";
  banner.setAttribute("role", "alert");
  const isFresh = recovery.mode === "fresh_empty";
  const titre = isFresh
    ? "⚠️ Base de données réinitialisée à vide"
    : "⚠️ Données restaurées depuis une sauvegarde";
  banner.innerHTML = `
    <div class="storage-recovery-content">
      <strong>${escapeHtml(titre)}</strong>
      <p>${escapeHtml(recovery.message || "Une récupération de la base de données a eu lieu.")}</p>
      <p class="muted">Vérifie tes données avant de continuer. ${isFresh
        ? "Tu peux ré-importer tes fichiers Excel depuis Paramètres → Imports et archives."
        : "Les saisies les plus récentes (avant la dernière sauvegarde) peuvent manquer."}</p>
    </div>
    <button class="storage-recovery-dismiss" type="button" aria-label="Fermer">×</button>
  `;
  banner.querySelector(".storage-recovery-dismiss").addEventListener("click", () => banner.remove());
  document.body.prepend(banner);
}

window.addEventListener("load", () => resetViewportScroll(false), { once: true });

function setNavigationSearchValue(value, sourceInput = null) {
  // #globalNavigationSearch vivait dans la barre du haut, que les planches
  // desktop n'ont pas. Il doublait #menuSearch, dans la barre laterale, qui
  // fait exactement le meme travail : une seule recherche de menu, desormais.
  document.querySelectorAll("#menuSearch").forEach(input => {
    if (input !== sourceInput) input.value = value;
  });
}

// --- La navigation a huit entrees ---------------------------------------
// Il n'y a plus de section depliable : l'accordeon (setNavigationSectionOpen,
// getNavigationSectionForTab, syncNavigationSections, toggleNavSection) a ete
// retire parce que les 49 planches de l'export n'en contiennent aucun. Une
// entree porte un GROUPE ; les ecrans du groupe vivent dans la rangee de
// pilules sous le titre de page.

function groupeDeLOnglet(nomOnglet) {
  // Un ecran SECONDAIRE (la saisie de commande) garde allumee l'entree de son
  // ecran principal : on y arrive par un bouton de l'en-tete, pas par une
  // pilule, mais on est toujours « dans les Commandes ».
  if (nomOnglet in ECRANS_SECONDAIRES) return ECRANS_SECONDAIRES[nomOnglet];
  return Object.keys(GROUPES_NAV).find(groupe => GROUPES_NAV[groupe].includes(nomOnglet)) || null;
}

function libellesDuGroupe(groupe) {
  // La recherche du menu doit trouver un ecran par son ANCIEN nom aussi :
  // « bons » ou « livrees » n'ont plus d'ecran a eux, ils vivent dans
  // Commandes -- et la saisie de commande, ecran secondaire, en fait partie.
  const ecrans = [
    ...(GROUPES_NAV[groupe] || []),
    ...Object.keys(ECRANS_SECONDAIRES).filter(onglet => ECRANS_SECONDAIRES[onglet] === groupe),
    ...Object.keys(REDIRECTIONS).filter(onglet => groupeDeLOnglet(REDIRECTIONS[onglet].onglet) === groupe)
  ];
  // Et les noms que les ecrans portaient AVANT les planches V8 : « livraison »
  // doit encore trouver la Tournee, « CRM » les Clients.
  return [...ecrans.map(onglet => titles[onglet]?.title || ""), ...(ANCIENS_NOMS[groupe] || [])];
}

const ANCIENS_NOMS = { tournee: ["Livraison"], clients: ["CRM"], stock: ["Inventaire"], analyse: ["Statistiques"] };

function renderSousOnglets(nomOnglet) {
  const rangee = document.getElementById("sousOnglets");
  if (!rangee) return;
  const onglets = GROUPES_NAV[groupeDeLOnglet(nomOnglet)] || [];
  // La rangee est reconstruite a chaque changement d'ecran. Si le focus y
  // etait, le bouton qui le portait va disparaitre : sans rien faire, le focus
  // retomberait sur <body> et Tab repartirait du haut de la page.
  const avaitLeFocus = rangee.contains(document.activeElement);
  rangee.innerHTML = onglets.map(onglet => {
    const actif = onglet === nomOnglet;
    // L'identifiant « tab-<onglet> » vit ICI et nulle part ailleurs : c'est lui
    // que visent les aria-labelledby des pages. Les entrees de nav portent
    // « nav-<groupe> », sans quoi les deux le declareraient en double.
    return `<button id="tab-${onglet}" class="button secondary compact filtre-pilule${actif ? " active-filter" : ""}"`
      + ` type="button" role="tab" aria-selected="${actif}" aria-controls="${onglet}"`
      + ` data-tab="${onglet}" data-action="go-tab" data-target-tab="${onglet}">`
      + `${escapeHtml(titles[onglet]?.title || onglet)}</button>`;
  }).join("");
  // Un groupe d'un seul ecran n'apprendrait rien : la rangee reste MASQUEE.
  // Mais sa pilule est quand meme rendue, parce que c'est elle qui porte
  // l'identifiant « tab-<onglet> » que vise l'aria-labelledby de la page :
  // sans elle, le Tableau de bord, la Preparation, la Tournee et les
  // Abonnements n'avaient plus de nom accessible. Un element masque peut
  // nommer un autre element ; un element absent, non.
  rangee.hidden = onglets.length < 2;
  if (avaitLeFocus && !rangee.hidden) rangee.querySelector('[aria-selected="true"]')?.focus();
}

/**
 * Le bloc compte, en bas de la barre.
 *
 * La planche ecrit « Tom / Administrateur ». C'est une donnee de maquette, pas
 * une valeur : l'identite reelle vient de /api/me. Tant qu'elle n'est pas
 * arrivee, on n'invente pas de nom.
 */
function renderCompteBarreLaterale() {
  const nom = document.getElementById("sidebarIdentifiant");
  const role = document.getElementById("sidebarRole");
  const avatar = document.getElementById("sidebarAvatar");
  if (!nom || !role || !avatar) return;
  const identifiant = String(moi?.identifiant || "").trim();
  nom.textContent = identifiant || "Session locale";
  // Tant que /api/me n'a pas repondu, et s'il echoue (le livreur hors ligne),
  // on n'affiche rien plutot qu'un « ... » qui promet une reponse a venir.
  role.textContent = moi?.roleLibelle || (moi ? libelleRole(moi.role) : "");
  avatar.textContent = (identifiant || "S").charAt(0).toUpperCase();
}

/**
 * Les pastilles des entrees de nav.
 *
 * Un badge ne remplace pas le nombre : il le REPETE. Il porte donc un
 * aria-label explicite, faute de quoi un lecteur d'ecran annoncerait
 * « Commandes 5 » sans dire de quoi.
 */
function renderBadgesNav(compteurs) {
  const poser = (groupe, valeur, alerte = false) => {
    const badge = document.querySelector(`.nav-badge[data-badge="${groupe}"]`);
    if (!badge) return;
    const nombre = Number(valeur) || 0;
    badge.textContent = nombre > 99 ? "99+" : String(nombre);
    badge.hidden = nombre === 0;
    badge.toggleAttribute("data-alerte", Boolean(alerte) && nombre > 0);
    badge.setAttribute("aria-label", `${nombre} à traiter`);
  };
  poser("commandes", compteurs.aTraiter);
  poser("tournee", compteurs.livraisonsDuJour);
  poser("stock", compteurs.aRecommander, true);
  // Pas de pastille « Abonnements ». La planche en montre une, mais le compte
  // correspondant vit dans le module Operations et n'est pas lisible d'ici.
  // Un nombre faux coute plus cher qu'un nombre absent : elle sera branchee
  // avec la planche Abonnements, pas devinee maintenant.
}

function filterNavigation(value) {
  const query = normalizeTextKey(value);
  const isSearching = Boolean(query);
  document.querySelectorAll(".sidebar .tab").forEach(entree => {
    // Une entree repond pour elle ET pour les ecrans qu'elle absorbe : taper
    // « bons » doit trouver « Bons de commande », qui n'a plus de ligne a soi.
    const termes = [entree.textContent || "", ...libellesDuGroupe(entree.dataset.groupe)];
    const trouve = !isSearching || termes.some(terme => normalizeTextKey(terme).includes(query));
    entree.classList.toggle("is-hidden-by-search", isSearching && !trouve);
  });
}

function navigateToFirstSearchMatch(value) {
  const query = normalizeTextKey(value);
  if (!query) return;

  filterNavigation(value);
  // On vise d'abord un ECRAN dont le titre correspond : « bons » doit ouvrir
  // Bons de commande, pas seulement mettre Commandes en evidence. A defaut,
  // la premiere entree restee visible.
  // Les anciens ecrans-listes comptent aussi : « bons » doit ouvrir les
  // Commandes, filtrees sur toutes, et « livrees » sur les livrees.
  const ecran = Object.keys(titles).find(onglet => {
    return (mainTabs.has(onglet) || onglet in REDIRECTIONS)
      && normalizeTextKey(titles[onglet].title).includes(query);
  });
  const entree = Array.from(document.querySelectorAll(".sidebar .tab"))
    .find(tab => !tab.classList.contains("is-hidden-by-search"));
  const cible = ecran || entree?.dataset.tab;

  if (!cible) return;
  showTab(cible);
  setNavigationSearchValue("");
  filterNavigation("");
}

function bindNavigationSearch() {
  const inputs = Array.from(document.querySelectorAll("#menuSearch"));
  inputs.forEach(input => {
    input.addEventListener("input", event => {
      const value = event.target.value;
      setNavigationSearchValue(value, event.target);
      filterNavigation(value);
    });

    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        navigateToFirstSearchMatch(event.target.value);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.target.value = "";
        setNavigationSearchValue("");
        filterNavigation("");
      }
    });
  });
}

function bindUi() {
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });
  bindNavigationSearch();

  // Le bouton « Importer les ventes » de l'en-tete ouvre ce selecteur ; le
  // fichier choisi doit alors PARTIR, sinon l'utilisateur croit ses ventes
  // importees alors que rien n'a ete envoye. Relecture du 22/09.
  document.getElementById("ventesFile")?.addEventListener("change", event => {
    const champ = event.target;
    if (champ.dataset.depuisEntete !== "1") return;
    delete champ.dataset.depuisEntete;
    if (champ.files?.length) document.getElementById("ventesForm")?.requestSubmit();
  });

  // Un selecteur ANNULE ne doit pas laisser l'envoi arme : le prochain fichier
  // choisi dans le formulaire de l'accueil partirait sans clic.
  for (const id of ["ventesFile", "stockFile"]) {
    document.getElementById(id)?.addEventListener("cancel", event => { delete event.target.dataset.depuisEntete; });
  }
  // Meme regle que les ventes : le fichier choisi depuis l'en-tete PART.
  document.getElementById("stockFile")?.addEventListener("change", event => {
    const champ = event.target;
    if (champ.dataset.depuisEntete !== "1") return;
    delete champ.dataset.depuisEntete;
    if (champ.files?.length) document.getElementById("stockForm")?.requestSubmit();
  });

  // Une tuile de categorie filtre le tableau ; la meme tuile, rappuyee, rend tout.
  document.getElementById("stkCategories")?.addEventListener("click", event => {
    const tuile = event.target.closest("[data-stk-categorie]");
    if (!tuile) return;
    const cle = tuile.dataset.stkCategorie;
    stockFilter.category = stockFilter.category === cle ? "all" : cle;
    renderStock();
    document.querySelector(`[data-stk-categorie="${CSS.escape(cle)}"]`)?.focus();
  });
  // « Tout voir » : la liste detaillee s'ouvre sur ce que la carte compte
  // (sous le seuil), pas sur « urgent » seul -- sinon deux produits de la
  // carte y manquaient.
  document.querySelector("#stock .stk-tout-voir")?.addEventListener("click", () => {
    recommendFilter = "low";
    renderRecommande();
  });

  bindCommandes();

  document.getElementById("ventesForm")?.addEventListener("submit", event => {
    event.preventDefault();
    runAction(event.submitter, "Import...", () => importFile("ventes", "ventesFile"));
  });

  document.getElementById("stockForm")?.addEventListener("submit", event => {
    event.preventDefault();
    runAction(event.submitter, "Import...", () => importFile("stock", "stockFile"));
  });

  // Debounce 200ms : evite un re-render complet a chaque touche (fluidite sur 2000+ produits)
  let stockSearchTimer = null;
  document.getElementById("stockSearch")?.addEventListener("input", event => {
    const value = event.target.value;
    clearTimeout(stockSearchTimer);
    stockSearchTimer = setTimeout(() => {
      stockFilter.query = value;
      renderStock();
    }, 200);
  });

  document.getElementById("stockStatusFilter")?.addEventListener("change", event => {
    stockFilter.status = event.target.value;
    renderStock();
  });

  document.getElementById("preparationSearch")?.addEventListener("input", event => {
    const value = event.target.value;
    clearTimeout(preparationSearchTimer);
    preparationSearchTimer = setTimeout(() => {
      preparationFilter.query = value;
      renderPreparation();
    }, 200);
  });

  // Charte §4 : « Pilules de filtre (secteurs, statuts) » -- planche Preparation.png.
  document.getElementById("preparationSectorPills")?.addEventListener("click", event => {
    const pilule = event.target.closest("[data-sector]");
    if (!pilule) return;
    preparationFilter.sector = pilule.dataset.sector;
    renderPreparation();
  });

  document.getElementById("crmSearch")?.addEventListener("input", event => {
    crmFilter.query = event.target.value;
    renderCrm();
  });

  document.getElementById("crmStatusFilter")?.addEventListener("change", event => {
    crmFilter.status = event.target.value;
    renderCrm();
  });

  document.getElementById("crmForm")?.addEventListener("submit", event => {
    event.preventDefault();
    runAction(event.submitter, "Enregistrement...", () => saveCrmClient(event.currentTarget));
  });

  bindClients();

  const numerotation = document.getElementById("numerotationForm");
  numerotation?.addEventListener("submit", event => {
    event.preventDefault();
    runAction(event.submitter, "Enregistrement...", () => enregistrerNumerotation(numerotation));
  });
  numerotation?.addEventListener("input", majExempleNumero);

  document.getElementById("relanceForm")?.addEventListener("submit", event => {
    event.preventDefault();
    runAction(event.submitter, "Création...", () => saveRelance(event.currentTarget));
  });

  document.getElementById("deliverySectorForm")?.addEventListener("submit", event => {
    event.preventDefault();
    runAction(event.submitter, "Enregistrement...", () => saveDeliverySector(event.currentTarget));
  });

  document.getElementById("customerOrderForm")?.addEventListener("submit", event => {
    event.preventDefault();
    runAction(event.submitter, "Validation...", () => submitCustomerOrder(event.currentTarget));
  });

  document.getElementById("compteForm")?.addEventListener("submit", event => {
    event.preventDefault();
    runAction(event.submitter, "Création...", () => creerCompte(event.currentTarget));
  });

  // Le changement de role passe par un <select>, qui emet "change" et non
  // "click" : le listener delegue des [data-action] ne le verrait jamais.
  document.addEventListener("change", event => {
    const select = event.target.closest('[data-action="changer-role-compte"]');
    if (!select) return;
    if (select.closest("#parCompteFeuille")) fermerFeuillesParametres();
    runAction(null, null, () => changerRoleCompte(select.dataset.compteId, select.value));
  });

  document.getElementById("customerClientSelect")?.addEventListener("change", event => {
    fillCustomerFormFromClient(event.target.value);
  });

  document.getElementById("customerProductSearch")?.addEventListener("input", event => {
    customerProductFilter.query = event.target.value;
    renderCustomerCatalog();
  });

  document.getElementById("customerCategoryFilter")?.addEventListener("change", event => {
    customerProductFilter.category = event.target.value;
    renderCustomerCatalog();
  });

  document.getElementById("deliveryDate")?.addEventListener("change", event => {
    deliveryFilter.date = event.target.value;
    applyDeliveryFilter();
  });

  document.getElementById("brandImageInput")?.addEventListener("change", event => {
    handleBrandImageImport(event.target);
  });

  document.addEventListener("click", event => {
    const relanceButton = event.target.closest("[data-relance-filter]");
    if (relanceButton) {
      relanceFilter = relanceButton.dataset.relanceFilter || "today";
      renderRelances();
      return;
    }

    const filterButton = event.target.closest("[data-recommend-filter]");
    if (!filterButton) return;

    recommendFilter = filterButton.dataset.recommendFilter || "urgent";
    renderRecommande();
  });

  document.addEventListener("click", event => {
    const stockButton = event.target.closest("[data-stock-delta]");
    if (stockButton) {
      const { productId, stockDelta } = stockButton.dataset;
      // Le rechargement redessine la ligne : on rend le focus au meme pas,
      // sinon il tombe sur <body> et le clavier repart du haut.
      runAction(stockButton, "...", () => changeStock(productId, Number(stockDelta)))
        .then(() => document.querySelector(`#stockList [data-product-id="${CSS.escape(productId)}"][data-stock-delta="${CSS.escape(stockDelta)}"]`)?.focus());
      return;
    }

    const customerButton = event.target.closest("[data-customer-product]");
    if (customerButton) {
      const productId = customerButton.dataset.customerProduct;
      const delta = Number(customerButton.dataset.customerDelta || 1);
      changeCustomerCart(productId, delta);
      return;
    }

    const crmStatusButton = event.target.closest("[data-crm-status-client]");
    if (crmStatusButton) {
      runAction(crmStatusButton, "...", () => updateCrmClientStatus(crmStatusButton.dataset.crmStatusClient, crmStatusButton.dataset.crmStatus));
      return;
    }

    const relanceStatusButton = event.target.closest("[data-relance-status]");
    if (relanceStatusButton) {
      runAction(relanceStatusButton, "...", () => updateRelanceStatus(relanceStatusButton.dataset.relanceId, relanceStatusButton.dataset.relanceStatus));
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const action = actionButton.dataset.action;

    if (action === "refresh") runAction(actionButton, "Actualisation...", loadData);
    if (action === "go-tab") showTab(actionButton.dataset.targetTab || "journee");
    if (action === "cmd-export") exportBdcCsv(commandesFiltrees(), "sereo-commandes");
    if (action === "cmd-filtres-basculer") {
      commandesFiltresOuverts = !commandesFiltresOuverts;
      renderCommandes();
    }
    if (action === "cmd-confirmer" || action === "cmd-annuler") {
      runAction(actionButton, "...", () => gesteDuDetail(action, actionButton.dataset.orderId));
    }
    // Pas de runAction : son « finally » rallumait le bouton APRES le rendu qui
    // l'avait eteint (aucune selection) ; c'est renderCommandes qui decide.
    if (action === "cmd-envoyer" && !envoiEnCours) {
      envoiEnCours = true;
      actionButton.disabled = true;
      envoyerCommandesEnPreparation()
        .catch(error => notifyEchec(error))
        .finally(() => { envoiEnCours = false; renderCommandes(); });
    }
    if (action === "cmd-page") {
      commandesFiltre.page += Number(actionButton.dataset.sens) || 0;
      renderCommandes();
      document.getElementById("cmdLignes")?.scrollIntoView({ block: "nearest" });
    }
    // La planche 6a met « Importer les ventes » en en-tete. Le formulaire
    // d'import, lui, ne bouge pas : le bouton ouvre simplement son selecteur
    // de fichier. Deux chemins vers un seul mecanisme, pas deux mecanismes.
    if (action === "cli-nouveau") ouvrirDialogueClient();
    // « Nouvelle tournee » : la planification, ouverte et montree.
    if (action === "trn-nouvelle") {
      const planification = document.getElementById("routePlanning");
      if (planification) {
        planification.open = true;
        planification.scrollIntoView({ block: "start", behavior: "smooth" });
        planification.querySelector("summary")?.focus({ preventScroll: true });
      }
    }
    if (action === "cmd-client-effacer") {
      Object.assign(commandesFiltre, { client: "", clientNom: "", page: 1 });
      renderCommandes();
      document.getElementById("cmdRecherche")?.focus();
    }
    if (action === "cli-modifier") ouvrirDialogueClient(actionButton.dataset.clientId);
    if (action === "cli-fermer") document.getElementById("cliDialogue")?.close();
    // « Les N autres » : la liste des commandes, cherchee sur ce client.
    if (action === "cli-voir-commandes") {
      showTab("commandes");
      // Une liste PROPRE, comme une redirection : un filtre laisse d'avant
      // cacherait les commandes du client. Et le client par son IDENTIFIANT.
      for (const id of ["cmdRecherche", "cmdDu", "cmdAu"]) {
        const champ = document.getElementById(id);
        if (champ) champ.value = "";
      }
      Object.assign(commandesFiltre, { statut: "toutes", recherche: "", page: 1, bloquees: false, completer: false,
        du: "", au: "", secteur: "", jour: "",
        client: actionButton.dataset.clientId || "", clientNom: actionButton.dataset.clientNom || "" });
      renderCommandes();
    }
    if (action === "importer-stock") {
      const champ = document.getElementById("stockFile");
      if (champ) {
        champ.dataset.depuisEntete = "1";
        champ.click();
      }
    }
    if (action === "importer-ventes") {
      const champ = document.getElementById("ventesFile");
      if (champ) {
        champ.dataset.depuisEntete = "1";
        champ.click();
      }
    }
    if (action === "open-more-menu") openMoreMenu();
    if (action === "close-more-menu") closeMoreMenu();
    if (action === "more-menu-pick") {
      showTab(actionButton.dataset.tab);
      closeMoreMenu();
    }
    if (action === "select-color-scheme") applyColorScheme(actionButton.dataset.colorScheme, { notifyUser: true });
    if (action === "reset-brand-image") resetBrandImage();
    if (action === "deplier-secteurs") {
      document.getElementById("preparationSectorPills")?.classList.toggle("filtre-pilules--depliee");
      ajusterRepliDesSecteurs();
    }
    if (action === "basculer-recherche-preparation") basculerRecherchePreparation();
    if (action === "open-commande-detail") openCommandeDetail(actionButton.dataset.orderId);
    if (action === "close-commande-detail") closeCommandeDetail();
    if (action === "start-preparation") runAction(actionButton, "Démarrage...", () => startPreparation(actionButton.dataset.orderId));
    if (action === "finish-preparation") runAction(actionButton, "Validation...", () => finishPreparation(actionButton.dataset.orderId));
    if (action === "open-order-maps") openOrderMaps(actionButton.dataset.orderId);
    if (action === "apply-delivery-filter") applyDeliveryFilter();
    if (action === "select-all-delivery") selectAllDelivery(true);
    if (action === "clear-delivery-selection") selectAllDelivery(false);
    if (action === "select-current-sector") selectCurrentSector();
    if (action === "create-route") runAction(actionButton, "Création...", createDeliveryRoute);
    if (action === "start-route") runAction(actionButton, "Départ...", startActiveRoute);
    if (action === "select-stop") selectStop(Number(actionButton.dataset.stopIndex));
    if (action === "move-stop-up") runAction(actionButton, "...", () => moveStop(actionButton.dataset.stopId, -1));
    if (action === "move-stop-down") runAction(actionButton, "...", () => moveStop(actionButton.dataset.stopId, 1));
    if (action === "start-tour") startTour();
    if (action === "reset-tour") runAction(actionButton, "Reset...", resetTour);
    if (action === "purge-orders") purgeOrdersHandler(actionButton);
    if (action === "diagnostic-suspicious-dates") runAction(actionButton, "Scan...", runDiagnosticSuspiciousDates);
    // « Livre » : pas de texte d'attente (runAction remplacerait l'icone) --
    // l'ecran avance tout de suite et l'envoi part au terme d'Annuler.
    if (action === "mark-delivered") livrerAvecAnnulation().catch(notifyEchec);
    if (action === "trn-voir-carte") {
      const carte = document.querySelector("#livreur .tournee-carte-panel");
      if (carte) carte.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    if (action === "mark-absent") runAction(actionButton, "Envoi...", () => marquerArret("absent"));
    if (action === "mark-problem") runAction(actionButton, "Envoi...", () => marquerArret("probleme"));
    if (action === "mark-reschedule") runAction(actionButton, "Envoi...", () => marquerArret("a_reprogrammer"));
    if (action === "replan-current-stop") runAction(actionButton, "Planification...", replanCurrentStop);
    if (action === "next-client") nextClient();
    if (action === "open-maps") openGoogleMaps();
    if (action === "call-current-client") callCurrentClient();
    if (action === "save-coordinates") runAction(actionButton, "Sauvegarde...", saveCurrentCoordinates);
    if (action === "export-annex-orders") downloadOrdersExport("annexe");
    if (action === "export-planned-orders") downloadOrdersExport("planned");
    if (action === "export-all-orders") downloadOrdersExport("all");
    if (action === "delete-delivery-sector") runAction(actionButton, "Suppression...", () => deleteDeliverySector(actionButton.dataset.sectorId));
    if (action === "basculer-compte") {
      runAction(actionButton, "...", () => basculerCompte(actionButton.dataset.compteId, actionButton.dataset.compteActif !== "1"));
    }
    if (action === "changer-mot-de-passe-compte") {
      runAction(actionButton, "...", () => changerMotDePasseCompte(actionButton.dataset.compteId, actionButton.dataset.compteIdentifiant));
    }
    if (action === "supprimer-compte") {
      runAction(actionButton, "Suppression...", () => supprimerCompte(actionButton.dataset.compteId, actionButton.dataset.compteIdentifiant));
    }
    // Parametres au telephone (planche 8d).
    if (action === "par-ouvrir-compte") ouvrirFeuilleCompte(actionButton.dataset.compteId);
    if (action === "par-ouvrir-imports") ouvrirFeuilleImports(actionButton.dataset.type || "");
    if (action === "par-fermer-feuille") fermerFeuillesParametres();
    if (action === "par-ajouter-compte") basculerFormulaireCompte(actionButton);
    if (action === "par-ajouter-secteur") ouvrirAjoutSecteur();
    // Un geste de la feuille d'un compte la referme : le tableau et les lignes
    // se redessinent, la feuille montrerait un etat perime.
    if (["basculer-compte", "changer-mot-de-passe-compte", "supprimer-compte"].includes(action)
      && actionButton.closest("#parCompteFeuille")) {
      fermerFeuillesParametres();
    }
  });

  document.addEventListener("change", event => {
    const input = event.target.closest("[data-stock-input]");
    if (input) {
      runAction(input, "Sauvegarde...", () => setStock(input.dataset.productId, input.value));
      return;
    }

    const customerQtyInput = event.target.closest("[data-customer-qty-input]");
    if (customerQtyInput) {
      setCustomerCart(customerQtyInput.dataset.productId, customerQtyInput.value, customerQtyInput);
      return;
    }

    const thresholdInput = event.target.closest("[data-stock-threshold-input]");
    if (thresholdInput) {
      runAction(thresholdInput, "Sauvegarde...", () => setStockThreshold(thresholdInput.dataset.productId, thresholdInput.value));
      return;
    }

    const deliveryCheckbox = event.target.closest("[data-delivery-order]");
    if (deliveryCheckbox) {
      setDeliverySelection(deliveryCheckbox.dataset.deliveryOrder, deliveryCheckbox.checked);
    }
  });

  window.addEventListener("hashchange", () => showTab(getInitialTab(), { updateHash: false }));
  // Le bouton retour du telephone, depuis une fiche client : la liste.
  window.addEventListener("popstate", () => {
    if (document.getElementById("crm")?.dataset.vue === "fiche") ouvrirVueClient("liste", { depuisHistorique: true });
  });
}

function getInitialTab() {
  const hash = window.location.hash.replace("#", "");
  // Un ancien ecran-liste dans l'adresse (un favori, un lien) est rendu tel
  // quel : showTab() le redirige, filtre compris.
  if (hash in REDIRECTIONS) return hash;
  return mainTabs.has(hash) ? hash : "journee";
}


function showTab(tabName, options = {}) {
  // Quitter Clients referme la fiche : y revenir montre la liste (planche 9a).
  const ecranClients = document.getElementById("crm");
  if (ecranClients && ecranClients.dataset.vue === "fiche" && tabName !== "crm") ecranClients.dataset.vue = "liste";
  // De meme, l'agenda des abonnements (planche 3c) : tout changement d'ecran,
  // y compris un toucher sur « Abonnements », ramene la liste.
  const ecranAbonnements = document.getElementById("abonnements");
  if (ecranAbonnements && ecranAbonnements.dataset.vue === "agenda") ecranAbonnements.dataset.vue = "liste";
  const { updateHash = true } = options;
  // Les quatre anciens ecrans-listes de commandes : ils ne sont plus des
  // ecrans, mais on les honore -- l'ecran unique s'ouvre sur LEUR filtre.
  const redirection = REDIRECTIONS[tabName];
  if (redirection) {
    // Un filtre laisse d'une visite precedente (« Bloquees seulement », un
    // jour passe, une recherche) cachait la commande qu'on venait de saisir.
    // Une redirection arrive sur une liste PROPRE, filtree comme l'ancien ecran.
    Object.assign(commandesFiltre, {
      statut: redirection.filtre, completer: redirection.completer || false,
      bloquees: false, recherche: "", du: "", au: "", secteur: "", jour: "", page: 1, client: "", clientNom: ""
    });
    for (const id of ["cmdRecherche", "cmdDu", "cmdAu"]) {
      const champ = document.getElementById(id);
      if (champ) champ.value = "";
    }
    commandesSelection.clear();
    // « Adresses a corriger » arrive filtre : au telephone, le filtre se montre
    // deplie, pour que la liste ne paraisse pas amputee sans raison visible.
    commandesFiltresOuverts = Boolean(redirection.completer);
    tabName = redirection.onglet;
    renderCommandes();
    // L'adresse dit ou l'on est vraiment : #commandes, plus l'ancien nom.
    // replaceState ne declenche pas de hashchange, donc pas de boucle.
    history.replaceState(null, "", `#${tabName}`);
  }
  const nextTab = titles[tabName] && mainTabs.has(tabName) ? tabName : "journee";

  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  // La rangee de pilules AVANT la boucle : elle cree les elements que la
  // boucle doit ensuite marquer.
  renderSousOnglets(nextTab);
  const groupeActif = groupeDeLOnglet(nextTab);
  document.querySelectorAll("[data-tab]").forEach(tab => {
    // Une entree de nav porte un groupe : elle s'allume pour les cinq ecrans
    // de Commandes, pas pour le seul qui est ouvert. Tout le reste (pilules,
    // barre mobile) se compare a l'onglet.
    const isActive = tab.dataset.groupe ? tab.dataset.groupe === groupeActif : tab.dataset.tab === nextTab;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  // Parametres n'a plus de ligne dans la nav : c'est le bloc compte qui le
  // signale, sinon rien n'indiquerait ou l'on est.
  document.querySelector(".sidebar-compte")?.classList.toggle("active", nextTab === "parametres");

  // Bouton "Plus" : actif si l'utilisateur est sur une destination "overflow"
  const moreBtn = document.getElementById("mobile-tab-more");
  if (moreBtn) {
    moreBtn.classList.toggle("active", MOBILE_OVERFLOW_TABS.has(nextTab));
  }

  document.getElementById(nextTab)?.classList.add("active");

  setText("pageTitle", titles[nextTab].title);
  setText("pageSubtitle", titles[nextTab].subtitle);

  // La fente d'en-tete ne montre que les commandes de l'ecran ouvert. Chaque
  // ecran y depose les siennes en balisage, avec data-ecran : rien a deplacer
  // dans le DOM, donc rien a casser quand on change d'onglet.
  document.querySelectorAll("#enteteActions [data-ecran]").forEach(commande => {
    commande.hidden = commande.dataset.ecran !== nextTab;
  });
  majEnteteTableauDeBord(nextTab);
  // Le sous-titre de Commandes est un compte : il se pose APRES le sous-titre
  // generique, sans quoi celui-ci l'ecraserait.
  if (nextTab === "commandes") majSousTitreCommandes();
  if (nextTab === "stock") majSousTitreStock();
  // Rouvrir le Stock refait l'ordre a plat, fige pendant les ajustements.
  if (nextTab === "stock" && ordreAPlat) {
    ordreAPlat = null;
    renderStock();
  }
  if (nextTab === "crm") majSousTitreClients();
  if (nextTab === "abonnements") majSousTitreAbonnements();
  if (nextTab === "livreur") majEnteteTournee();
  if (nextTab === "preparation") {
    majSousTitrePreparation();
    // Le repli des secteurs se MESURE : cache, la rangee n'a pas de hauteur.
    ajusterRepliDesSecteurs();
  }

  updateCustomerCartBar();

  if (updateHash) {
    history.replaceState(null, "", `#${nextTab}`);
  }

  resetViewportScroll(updateHash);

  if (nextTab === "livreur" && map) {
    // Mesure du 19/09 : la carte etait cadree (fitBounds) au chargement des
    // donnees, pendant que l'onglet etait masque -- conteneur de 0 x 0, zoom
    // pousse a 19, marqueurs a 100 000 px du cadre. invalidateSize() rend sa
    // taille a la carte mais NE RECADRE PAS : il faut redessiner.
    setTimeout(() => { map.invalidateSize(); renderMap(); }, 150);
  }
}

// Bottom sheet "Plus" de la mobile-tabbar : pattern iOS/Android pour les
// destinations overflow (> 5 dans une tabbar fixed).
function openMoreMenu() {
  const sheet = document.getElementById("mobile-more-sheet");
  const trigger = document.getElementById("mobile-tab-more");
  if (!sheet) return;
  sheet.hidden = false;
  trigger?.setAttribute("aria-expanded", "true");
  // Focus le 1er item pour la nav clavier
  const firstItem = sheet.querySelector(".more-sheet-item");
  if (firstItem) firstItem.focus({ preventScroll: true });
  // U3 v1.13.0 : focus trap pour empecher Tab de sortir du modal
  if (sheet._releaseTrap) sheet._releaseTrap();
  sheet._releaseTrap = trapFocusWithin(sheet);
}

function closeMoreMenu() {
  const sheet = document.getElementById("mobile-more-sheet");
  const trigger = document.getElementById("mobile-tab-more");
  if (!sheet) return;
  sheet.hidden = true;
  trigger?.setAttribute("aria-expanded", "false");
  if (sheet._releaseTrap) { sheet._releaseTrap(); sheet._releaseTrap = null; }
  trigger?.focus({ preventScroll: true });
}

// Escape ferme le sheet, clic en dehors aussi (gere via .more-sheet-backdrop
// avec data-action="close-more-menu" dans bindUi).
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    const sheet = document.getElementById("mobile-more-sheet");
    if (sheet && !sheet.hidden) closeMoreMenu();
  }
});

function resetViewportScroll(animated = true) {
  const behavior = animated ? "smooth" : "auto";
  window.scrollTo({ top: 0, left: 0, behavior });
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }), 120);
}

function initMap() {
  const mapElement = document.getElementById("map");

  if (typeof L === "undefined") {
    if (mapElement) mapElement.textContent = "Carte indisponible.";
    return;
  }

  map = L.map("map", {
    zoomControl: true
  }).setView([46.9511, 4.9027], 10);

  // Sans le motif `{s}` : la politique d'usage d'OpenStreetMap deconseille
  // explicitement les sous-domaines a.b.c, herites de HTTP/1.1 et inutiles
  // depuis HTTP/2. Mesure du 18/09 : le serveur rendait des tuiles 403
  // "Access blocked -- App is not following the tile usage policy".
  // ⚠ Ceci ne prouve PAS que le blocage vienne de la, ni qu'il soit leve.
  // Le fournisseur de tuiles pour la PRODUCTION est un arbitrage ouvert,
  // note dans la charte.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

/**
 * Pose un squelette dans les zones qui restent VIDES pendant le chargement.
 *
 * Mesure du 18/09, API ralentie a 2,5 s : ces conteneurs etaient des boites
 * blanches vides, sans rien qui distingue "ca charge" de "c'est vide" ou de
 * "c'est casse". Un squelette occupe la place de ce qui vient ; il n'annonce
 * rien et ne porte aucun texte (regle de la charte).
 *
 * On ne le pose QUE sur un conteneur deja vide : au rafraichissement, l'ancien
 * contenu reste lisible pendant que le neuf arrive, ce qui vaut mieux qu'un
 * scintillement gris sur des donnees qu'on avait deja.
 */
function poserSquelettes() {
  // Les listes dont on connait la LIGNE (planche 10b) prennent des lignes a sa
  // hauteur ; les autres gardent les barres de texte.
  const LIGNES = new Set(["dashboardPreparing", "dashboardDelivering", "dashboardSubscriptions", "opAlerts",
    "crmList", "stockList", "cmdLignes"]);
  const zones = [
    ["dashboardPreparing", 3], ["dashboardDelivering", 3], ["dashboardSubscriptions", 2],
    ["crmList", 4], ["stockList", 4], ["todayOrdersList", 4], ["plannedOrdersList", 4],
    ["relanceList", 3], ["exportsList", 3], ["historiqueList", 3], ["stockMovementList", 4],
    // Ajoutes apres mesure : la premiere liste avait ete ecrite de memoire, et
    // le graphique du tableau de bord -- le plus grand vide de l'ecran, 556x184
    // -- n'y figurait pas. On ne devine pas quels conteneurs sont vides, on les
    // releve dans la page pendant que l'API est ralentie.
    ["revenueChart", 6], ["opAlerts", 2],
    // La liste des Commandes restait vide pendant le chargement (23/09).
    ["cmdLignes", 5],
    // Releve le 23/09 : la liste des commandes a livrer restait une boite vide
    // pendant le chargement -- et un « Tout sélectionner » touche a ce moment y
    // affichait « Aucune commande prête à livrer », un faux etat vide.
    ["deliveryCandidates", 3]
  ];
  for (const [id, lignes] of zones) {
    const zone = document.getElementById(id);
    if (!zone || zone.children.length) continue;
    zone.setAttribute("aria-busy", "true");
    zone.innerHTML = squelette(lignes, id === "revenueChart" ? "colonnes" : (LIGNES.has(id) ? "lignes" : "liste"));
  }
  poserChiffresEnAttente();
}

// LES CHIFFRES du tableau de bord (planche 10b, haut) : « les cartes gardent
// leur forme et leurs libelles ; seuls les chiffres sont des blocs aux
// dimensions du chiffre attendu ». Avant le 23/09, ils affichaient « 0 » et
// « — » pendant le chargement : un zero qui MENT (il y avait des commandes),
// que le sous-titre recopiait (« 0 commande a preparer »), puis un saut de
// 22 px (bureau) a 72 px (telephone) a l'arrivee des donnees.
//
// Le bloc est dessine par la feuille (.squelette-chiffre) ; l'element est
// VIDE, donc sans glyphe : la regle « jamais de texte dessus » tient, et le
// sous-titre, qui lit la tuile, ne trouve pas de nombre et n'en invente pas.
// Premier chargement seulement : a l'actualisation, les chiffres qu'on avait
// restent lisibles pendant que les neufs arrivent.
const CHIFFRES_EN_ATTENTE = ["opRevenue", "opBasket", "opDelivered", "dashboardPreparingCount", "dashboardDeliveringCount",
  "dashboardPreparingDetail", "dashboardDeliveringDetail"];
let chiffresDejaCharges = false;

function poserChiffresEnAttente() {
  if (chiffresDejaCharges) return;
  for (const id of CHIFFRES_EN_ATTENTE) {
    const el = document.getElementById(id);
    if (!el) continue;
    // Le texte du balisage est garde : « Commandes livrees » (#opDelivered)
    // est un LIBELLE tant que le rendu ne l'a pas remplace par un compte.
    el.dataset.texteInitial = el.textContent.trim();
    el.textContent = "";
    el.classList.add("squelette-chiffre");
  }
  // Le sous-titre a deja lu « 0 » dans la tuile a l'ouverture de l'ecran : il
  // relit la tuile vide, et ne dit plus « 0 commande a preparer ».
  majEnteteTableauDeBord(getInitialTab());
  // Le mois du chiffre d'affaires : sa pilule etait VIDE (64 px) pendant le
  // chargement, puis « septembre 2026 » (188 px) -- au telephone, l'import
  // passait alors a la ligne et tout l'ecran descendait de 52 px. Le mois
  // courant est connu sans le serveur : c'est celui que le rendu choisit.
  const mois = document.getElementById("revenueMonth");
  if (mois && !mois.options.length) {
    const aujourdhui = new Date();
    const cle = `${aujourdhui.getFullYear()}-${String(aujourdhui.getMonth() + 1).padStart(2, "0")}`;
    const option = document.createElement("option");
    option.value = cle;
    option.textContent = new Date(`${cle}-01T12:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    mois.appendChild(option);
  }
}

/** Retire les squelettes restants : une zone qui n'a pas ete remplie l'est par
 *  son propre rendu, mais une zone en erreur garderait des blocs gris a vie. */
function retirerSquelettes() {
  for (const zone of document.querySelectorAll('[aria-busy="true"]')) {
    zone.removeAttribute("aria-busy");
    if (zone.querySelector(".squelette")) zone.innerHTML = "";
  }
  // Un chiffre que son rendu n'a pas rempli (le tableau de bord en erreur)
  // redevient « — » : un bloc gris a vie promettrait un nombre qui ne vient pas.
  // Un LIBELLE, lui, revient tel quel : /api/operations en erreur donnait « — »
  // au-dessus de « — », et la tuile perdait son nom. Un « 0 » du balisage
  // n'est pas un libelle (c'est le zero qui ment) : il devient « — » aussi.
  for (const el of document.querySelectorAll(".squelette-chiffre")) {
    el.classList.remove("squelette-chiffre");
    const initial = el.dataset.texteInitial || "";
    delete el.dataset.texteInitial;
    if (!el.textContent.trim()) el.textContent = /\p{L}/u.test(initial) ? initial : "—";
  }
  chiffresDejaCharges = true;
}

// --- CHARGEMENT INSTANTANE (lot du 23/09) ------------------------------------
//
// A l'ouverture, la page montre TOUT DE SUITE les dernieres donnees connues --
// celles que le service worker a mises en cache au dernier passage -- puis les
// remplace par celles du reseau. Pendant ce temps la pastille dit « Mise a
// jour… » : une copie n'est jamais annoncee comme fraiche.
//
// Ce cache n'est lu qu'ici, au PREMIER chargement de la page. Apres une
// ecriture, loadData() recharge : relire la copie d'avant l'ecriture ferait
// reculer l'ecran.
//
// Ce que le service worker met en cache n'a pas change de nature : les memes
// reponses d'API, communes a tous les comptes (aucune ne depend de
// l'identite ; /api/me et /api/comptes restent exclus). Le cache part a la
// deconnexion (service worker, POST /logout) et a l'expiration de session
// (apiFetch, 401).
const PREFIXE_CACHE_DONNEES = "sereo-api-";
let premierChargementDesDonnees = true;
// Les URL auxquelles le service worker a repondu par une COPIE (en-tete
// X-Sereo-Cache : le reseau n'a pas repondu a temps), avec la date de la copie.
const reponsesCopiees = new Map();

async function viderCacheDeDonnees() {
  try {
    if (typeof caches === "undefined") return;
    const noms = (await caches.keys()).filter(nom => nom.startsWith(PREFIXE_CACHE_DONNEES));
    await Promise.all(noms.map(nom => caches.delete(nom)));
  } catch { /* stockage indisponible : rien a vider */ }
}

/**
 * Les dernieres donnees connues, lues dans le cache du service worker.
 * Rend { data, date } ou null. Tout ou presque : une copie a moitie montrerait
 * des listes vides qui ne le sont pas. Seul l'endpoint date du jour (`jour`)
 * peut manquer (au premier jour d'ouverture, son URL a change) ; il garde
 * alors sa valeur courante.
 */
async function lireDernieresDonnees(endpoints) {
  try {
    if (typeof caches === "undefined") return null;
    const noms = (await caches.keys()).filter(nom => nom.startsWith(PREFIXE_CACHE_DONNEES));
    if (!noms.length) return null;
    const cache = await caches.open(noms[0]);
    const lus = await Promise.all(endpoints.map(async e => {
      const reponse = await cache.match(e.path);
      if (!reponse || !reponse.ok) return null;
      return { key: e.key, valeur: await reponse.json(), date: Date.parse(reponse.headers.get("Date") || "") };
    }));
    const data = {};
    let date = NaN;
    for (let i = 0; i < endpoints.length; i++) {
      const lu = lus[i];
      if (!lu) {
        if (endpoints[i].jour) continue;
        return null;
      }
      data[lu.key] = lu.valeur;
      if (Number.isFinite(lu.date) && !(lu.date >= date)) date = lu.date;
    }
    return { data, date };
  } catch {
    return null;
  }
}

/** « Données de 14:32 » (aujourd'hui) ou « Données du 21/09 ». Sans date lisible : « Données en cache ». */
function libelleCopie(date) {
  if (!Number.isFinite(date)) return "Données en cache";
  const d = new Date(date);
  const memeJour = d.toDateString() === new Date().toDateString();
  return memeJour
    ? `Données de ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : `Données du ${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`;
}

/** Recopie dans l'etat de la page les cles PRESENTES de `data`. */
function appliquerDonnees(data) {
  const a = key => Object.prototype.hasOwnProperty.call(data, key);
  if (a("clients")) {
    clients = (data.clients || []).map(client => ({
      ...client,
      statut: client.statut || "restant"
    }));
  }
  if (a("stock")) stock = data.stock;
  if (a("ventes")) ventes = data.ventes;
  if (a("historique")) historique = data.historique;
  if (a("orders")) orders = data.orders;
  if (a("crmClients")) crmClients = data.crmClients;
  if (a("subscriptions")) abonnementsDonnees = data.subscriptions || { items: [], occurrences: [] };
  if (a("crmRelances")) crmRelances = data.crmRelances;
  if (a("todayCustomerOrders")) todayCustomerOrders = data.todayCustomerOrders;
  if (a("plannedOrders")) plannedOrders = data.plannedOrders;
  if (a("statistics")) statistics = data.statistics;
  if (a("sectors")) sectors = data.sectors;
  if (a("deliverySectors")) deliverySectors = data.deliverySectors;
  if (a("routes")) deliveryRoutes = data.routes;
  if (a("stockMovements")) stockMovements = data.stockMovements;
  if (a("dashboard")) dashboard = data.dashboard;

  // Les commandes sont la (ou leur repli, si la route a echoue ; ou la copie du
  // cache au demarrage) : la liste peut dire ce qu'elle contient, et la
  // selection peut porter sur quelque chose.
  if (a("orders")) {
    commandesChargees = true;
    activerSelectionLivraison();
  }

  refreshActiveRoute();
  route = activeRoute ? activeRoute.stops : (currentIndex >= 0 ? route : [...clients]);

  renderAll();
  renderOperations({operations:data.operations,subscriptions:data.subscriptions,crmClients,stock,orders});
}

async function loadData() {
  setStatus("Chargement...");
  poserSquelettes();
  const premier = premierChargementDesDonnees;
  premierChargementDesDonnees = false;

  // Chantier 2 (audit 2026-06-04) : Promise.allSettled au lieu de Promise.all.
  // Avant : si UN seul endpoint timeout (30s), tout etait wipe (clients=[],
  // orders=[], stock=[]). UX catastrophique sur slow network.
  // Apres : chaque endpoint a son sort. Si le stock timeout, on garde la prep,
  // les clients, etc. Le user voit "Stock indisponible" sans tout perdre.
  const endpoints = [
    { key: "operations", path: "/api/operations", fallback: null },
    { key: "subscriptions", path: "/api/subscriptions", fallback: {items:[],occurrences:[],today:getTodayDateInput()} },
    { key: "clients", path: "/api/clients", fallback: [] },
    { key: "stock", path: "/api/stock", fallback: [] },
    { key: "ventes", path: "/api/ventes", fallback: [] },
    { key: "historique", path: "/api/historique", fallback: [] },
    { key: "orders", path: "/api/orders", fallback: [] },
    { key: "crmClients", path: "/api/crm/clients", fallback: [] },
    { key: "crmRelances", path: "/api/reminders", fallback: [] },
    { key: "todayCustomerOrders", path: `/api/customer-orders/today?date=${encodeURIComponent(getTodayOrdersDate())}`, fallback: [], jour: true },
    { key: "plannedOrders", path: "/api/planned-orders", fallback: [] },
    { key: "statistics", path: "/api/statistics", fallback: null },
    { key: "sectors", path: "/api/sectors", fallback: [] },
    { key: "deliverySectors", path: "/api/delivery-sectors", fallback: [] },
    { key: "routes", path: "/api/routes", fallback: [] },
    { key: "stockMovements", path: "/api/stock-movements", fallback: [] },
    { key: "dashboard", path: "/api/dashboard", fallback: null }
  ];

  for (const e of endpoints) reponsesCopiees.delete(e.path);
  // Le reseau part D'ABORD : lire le cache ne doit rien lui couter.
  let reseauFini = false;
  const reseau = Promise.allSettled(endpoints.map(e => apiFetch(e.path)));
  reseau.then(() => { reseauFini = true; });

  let copie = null;
  if (premier) {
    copie = await lireDernieresDonnees(endpoints);
    if (copie && !reseauFini) {
      appliquerDonnees(copie.data);
      setStatus("Mise à jour…");
    }
  }

  const results = await reseau;

  // Revue R1 P0 #3 : si un endpoint renvoie 401, apiFetch a deja declenche
  // window.location.href = /login. On abandonne loadData proprement (la
  // redirection en cours va remplacer la page). On detecte le throw via le
  // message "Session expiree" pose par apiFetch lui-meme.
  const sessionExpired = results.some(r =>
    r.status === "rejected"
    && r.reason && String(r.reason.message || "").includes("Session expiree")
  );
  if (sessionExpired) {
    setStatus("Reconnexion...");
    return;
  }

  const failed = [];
  // Les cles dont la valeur affichee est une COPIE : rendue par le cache du
  // service worker (reseau trop lent ou coupe), ou reprise de la copie lue au
  // demarrage quand le reseau a echoue. Elles interdisent « A jour ».
  const copiees = [];
  let dateCopie = NaN;
  const noterCopie = (key, date) => {
    copiees.push(key);
    if (Number.isFinite(date) && !(date >= dateCopie)) dateCopie = date;
  };
  const data = {};
  results.forEach((r, i) => {
    const e = endpoints[i];
    if (r.status === "fulfilled") {
      data[e.key] = r.value;
      if (reponsesCopiees.has(e.path)) noterCopie(e.key, reponsesCopiees.get(e.path));
    } else if (copie && Object.prototype.hasOwnProperty.call(copie.data, e.key)) {
      data[e.key] = copie.data[e.key];
      noterCopie(e.key, copie.date);
    } else {
      data[e.key] = e.fallback;
      failed.push(e.key);
    }
  });

  appliquerDonnees(data);

  if (failed.length === 0 && copiees.length === 0) {
    setStatus("À jour");
  } else if (failed.length === 0) {
    setStatus(libelleCopie(dateCopie));
  } else if (failed.length === endpoints.length) {
    setStatus("Erreur");
    notify("Impossible de joindre le serveur — les données affichées sont vides.", "error");
  } else {
    setStatus(`Partiel (${failed.length} indispo)`);
    // Map cle interne -> label utilisateur lisible
    const labels = {
      clients: "clients", stock: "stock", ventes: "ventes", historique: "historique",
      orders: "commandes", plannedOrders: "commandes planifiées", sectors: "secteurs",
      deliverySectors: "secteurs livraison", routes: "tournées",
      stockMovements: "mouvements stock", dashboard: "tableau de bord"
    };
    const friendly = failed.map(k => labels[k] || k).join(", ");
    notify(copiees.length
      ? `Sections indisponibles : ${friendly}. Le reste vient des dernières données connues.`
      : `Sections indisponibles : ${friendly}. Le reste est à jour.`, "warning");
  }

  // TOUJOURS, quel que soit le sort des endpoints. Les zones remplies par leur
  // propre rendu ont deja remplace leur squelette, mais elles gardent
  // aria-busy="true" -- et une zone qui annonce "je charge" a vie ment a un
  // lecteur d'ecran. Celles dont l'endpoint a echoue garderaient en plus des
  // blocs gris : un squelette qui ne finit jamais promet quelque chose qui
  // n'arrive pas.
  retirerSquelettes();
}

function refreshActiveRoute() {
  if (activeRoute) {
    const updated = deliveryRoutes.find(item => String(item.id) === String(activeRoute.id));
    activeRoute = updated || activeRoute;
    if (activeRoute && activeStopIndex >= activeRoute.stops.length) activeStopIndex = 0;
    // Un rechargement pendant les 4 s d'Annuler ne fait pas reapparaitre
    // l'arret qu'on vient de livrer.
    appliquerLivraisonEnSuspens();
    return;
  }

  activeRoute = deliveryRoutes.find(item => item.status === "en_livraison")
    || deliveryRoutes.find(item => item.status === "prete")
    || null;
  activeStopIndex = 0;
}

/**
 * La carte « Tournee du jour » du tableau de bord (planche TableauDeBord.png).
 * Elle ne montre RIEN quand il n'y a pas de tournee : une carte vide dirait
 * « c'est casse » la ou la verite est « il n'y en a pas ».
 */
/**
 * Le titre du tableau de bord, selon la planche 6a : « Bonjour <nom> » et une
 * phrase qui dit la date et ce qui attend.
 *
 * La planche ecrit « Bonjour Tom ». « Tom » est une donnee de maquette :
 * l'identifiant reel vient de /api/me. Tant qu'il n'est pas arrive, on garde
 * le titre generique plutot que d'inventer un nom.
 */
// Le tableau de bord est rendu par operations.js ; le sous-titre lit sa tuile.
// Il faut donc le recalculer APRES ce rendu, et pas seulement a l'ouverture.
document.addEventListener("tableau-de-bord-rendu", () => majEnteteTableauDeBord(getInitialTab()));

function majEnteteTableauDeBord(ongletActif) {
  if (ongletActif !== "journee") return;
  const titre = document.getElementById("pageTitle");
  const sous = document.getElementById("pageSubtitle");
  if (!titre || !sous) return;

  const nom = String(moi?.identifiant || "").trim();
  titre.textContent = nom ? `Bonjour ${nom}` : titles.journee.title;

  const jour = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long"
  });
  // Le MEME nombre que la tuile « En preparation », lu sur elle : deux sources
  // donneraient deux verites sur le meme ecran -- c'etait le cas.
  const tuile = document.getElementById("dashboardPreparingCount")?.textContent?.trim();
  const aPreparer = tuile && /^\d+$/.test(tuile) ? Number(tuile) : null;
  const morceaux = [jour.charAt(0).toUpperCase() + jour.slice(1)];
  if (aPreparer !== null) {
    morceaux.push(`${aPreparer} commande${aPreparer > 1 ? "s" : ""} à préparer`);
  }
  // Les statuts d'une tournee sont brouillon, prete, en_livraison, terminee
  // (server.js, ROUTE_STATUSES) : « en_cours » n'existait pas, la mention ne
  // pouvait jamais s'afficher.
  if (activeRoute && activeRoute.status === "en_livraison") morceaux.push("une tournée en cours");
  sous.textContent = morceaux.join(" · ");
}

function renderTourneeDuJour() {
  const carte = document.getElementById("dashboardTournee");
  if (!carte) return;
  const panneau = document.getElementById("dashboardDeliveringPanel");
  if (!activeRoute?.stops?.length) {
    carte.hidden = true;
    if (panneau) panneau.hidden = false;
    return;
  }
  carte.hidden = false;
  // Les deux panneaux se partagent une colonne : « A livrer » laisse la place.
  if (panneau) panneau.hidden = true;

  const total = activeRoute.stops.length;
  const faits = activeRoute.stops.filter(stop => isStopTerminal(stop.status)).length;
  const rang = isRouteComplete(activeRoute) ? total : Math.min(activeStopIndex + 1, total);
  const prochain = activeRoute.stops.find((stop, index) => index >= activeStopIndex && !isStopTerminal(stop.status))
    || activeRoute.stops.find(stop => !isStopTerminal(stop.status));

  setText("dashboardTourneeStatut", formatRouteStatus(activeRoute.status));
  setText("dashboardTourneeRang", rang);
  setText("dashboardTourneeTotal", total > 1 ? `arrêts sur ${total}` : "arrêt");
  const barre = document.getElementById("dashboardTourneeBarre");
  if (barre) barre.style.width = `${Math.round((faits / total) * 100)}%`;

  const faitsListe = document.getElementById("dashboardTourneeFaits");
  if (faitsListe) {
    const lignes = [
      prochain ? `Prochain : ${prochain.clientName}` : `${faits} arrêt${faits > 1 ? "s" : ""} terminé${faits > 1 ? "s" : ""}`,
      formatRouteMetrics(activeRoute)
    ].filter(Boolean);
    faitsListe.innerHTML = lignes.map(texte => `<li>${escapeHtml(texte)}</li>`).join("");
  }
}


// ============================================================================
// COMMANDES -- planches 13c / 14c. Un seul tableau, filtre par statut.
// ============================================================================

// Les pilules de la planche, plus UNE : « A envoyer ». Le statut des commandes
// terrain (commande_client_validee) n'etait sous aucune des six, et avec lui le
// geste qui le traite -- l'envoi en preparation par lot -- n'avait plus de
// place. L'ordre suit le chemin d'une commande.
const FILTRES_COMMANDES = [
  { cle: "toutes", libelle: "Toutes", statuts: null },
  { cle: "a-envoyer", libelle: "À envoyer", statuts: ["commande_client_validee"] },
  { cle: "a-preparer", libelle: "À préparer", statuts: ["importe", "stock_a_verifier", "en_preparation", "preparation_terminee"] },
  { cle: "pret", libelle: "Prêt livraison", statuts: ["pret_livraison"] },
  { cle: "en-livraison", libelle: "En livraison", statuts: ["en_livraison"] },
  { cle: "livrees", libelle: "Livrées", statuts: ["livre"] },
  { cle: "planifiees", libelle: "Planifiées", statuts: ["planifiee", "a_confirmer"] }
];

// Les badges de la planche : tiede (peche claire), froid (vert clair), plein
// (principal) ou contour d'alerte. Chaque statut dit son mot : la couleur
// n'est jamais seule a porter l'etat.
const STATUT_COMMANDE = {
  brouillon: ["Brouillon", "neutre"],
  commande_client_validee: ["À envoyer", "tiede"],
  importe: ["Importée", "froid"],
  stock_a_verifier: ["À vérifier", "tiede"],
  en_preparation: ["En préparation", "tiede"],
  preparation_terminee: ["Préparée", "tiede"],
  pret_livraison: ["Prêt livraison", "froid"],
  en_livraison: ["En livraison", "tiede"],
  livre: ["Livrée", "plein"],
  planifiee: ["Planifiée", "froid"],
  a_confirmer: ["À confirmer", "froid"],
  probleme_livraison: ["Problème", "alerte"],
  a_reprogrammer: ["À reprogrammer", "tiede"],
  annulee: ["Annulée", "neutre"]
};

const COMMANDES_PAR_PAGE = 20;
const commandesFiltre = {
  statut: "toutes", bloquees: false, completer: false, recherche: "", tri: "date-desc", page: 1,
  du: "", au: "", secteur: "",
  // Le jour des commandes terrain, comme l'ancien « Commandes du jour ».
  jour: ""
};
// Un envoi en preparation en cours ; la ligne a qui rendre le focus quand le
// detail se ferme.
let envoiEnCours = false;
let retourDuDetail = null;
// Le filtre « A completer » a deux sens : false, « profil » (la case : la
// regle de l'ancien ecran) ou « adresse » (l'alerte du tableau de bord : une
// adresse manquante sur une commande encore a faire -- operations.js).
function adresseACorriger(order) {
  return !["livre", "annulee"].includes(order.status)
    && (!String(order.address || "").trim() || !String(order.city || "").trim());
}
const commandesSelection = new Set();

// Au telephone (planche 8a), les filtres hors planche -- « Bloquees
// seulement », « A completer », le secteur, la periode -- se replient derriere
// un bouton « Filtres » qui dit combien sont actifs. Ils sont GARDES : ce sont
// les seuls chemins vers ces listes et vers l'export d'un mois ou d'un secteur.
let commandesFiltresOuverts = false;
function filtresSecondsActifs() {
  return [commandesFiltre.bloquees, commandesFiltre.completer, commandesFiltre.secteur, commandesFiltre.du, commandesFiltre.au]
    .filter(Boolean).length;
}

// Le seuil de la barre basse (lot mobile 1) : sous 820 px, l'en-tete est vert.
const ecranTelephone = window.matchMedia ? window.matchMedia("(max-width: 820px)") : { matches: false };

// Les pilules de statut des Commandes : dans l'en-tete vert au telephone, sous
// la recherche (planche 8a) ; dans la rangee de filtres au bureau (planche
// 13c). UN seul groupe, deplace -- deux groupes feraient deux noms pour le
// meme geste, et l'un des deux serait toujours cache.
function placerPilulesCommandes() {
  const pilules = document.getElementById("cmdPilules");
  const filtres = document.querySelector("#commandes .cmd-filtres");
  const recherche = document.querySelector('#enteteActions .cmd-recherche[data-ecran="commandes"]');
  if (!pilules || !filtres || !recherche) return;
  if (ecranTelephone.matches) {
    if (pilules.parentElement !== recherche.parentElement) recherche.after(pilules);
    // showTab ne range la fente qu'en changeant d'ecran : ici, on s'y range seul.
    pilules.hidden = !document.getElementById("commandes")?.classList.contains("active");
  } else if (pilules.parentElement !== filtres) {
    filtres.prepend(pilules);
    pilules.hidden = false;
  }
}

function commandeBloquee(order) {
  return ["importe", "stock_a_verifier"].includes(order.status) && order.canPrepare === false;
}

// La date d'une ligne : celle de LIVRAISON pour une commande planifiee (c'est
// la seule qui compte encore), celle de la COMMANDE pour les autres.
function dateDeLaCommande(order) {
  return ["planifiee", "a_confirmer"].includes(order.status)
    ? (order.deliveryDate || order.dateCommande)
    : (order.dateCommande || order.deliveryDate);
}

// « 16 sept. » -> <jour>16</jour> <mois>sept.</mois> (et l'annee, s'il y en a
// une, avec le mois). Le texte lu ne change pas.
function dateEnDeuxMorceaux(texte) {
  const [jour, ...reste] = String(texte).split(" ");
  if (!reste.length) return escapeHtml(texte);
  return `<span class="cmd-date-jour">${escapeHtml(jour)}</span> <span class="cmd-date-mois">${escapeHtml(reste.join(" "))}</span>`;
}

function dateCourte(iso) {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  // L'annee quand ce n'est pas celle-ci : « 1 janv. » d'une echeance ratee
  // l'an dernier se lisait comme une date a venir.
  const autreAnnee = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString("fr-FR", autreAnnee ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" });
}

function articlesDe(order) {
  return (order.products || []).reduce((n, p) => n + (Number(p.quantite) || 0), 0);
}

function commandesFiltrees() {
  const filtre = FILTRES_COMMANDES.find(f => f.cle === commandesFiltre.statut) || FILTRES_COMMANDES[0];
  const q = normalizeTextKey(commandesFiltre.recherche);
  const liste = (orders || []).filter(order => {
    if (filtre.statuts && !filtre.statuts.includes(order.status)) return false;
    if (commandesFiltre.bloquees && !commandeBloquee(order)) return false;
    // La regle de l'ancien ecran, reprise telle quelle (bdcNeedsCompletion).
    if (commandesFiltre.completer === "profil" && !bdcNeedsCompletion(order)) return false;
    if (commandesFiltre.completer === "adresse" && !adresseACorriger(order)) return false;
    if (commandesFiltre.secteur && String(order.sector || "") !== commandesFiltre.secteur) return false;
    if (commandesFiltre.client && String(order.clientId) !== String(commandesFiltre.client)) return false;
    // La periode borne la date de COMMANDE, comme l'ancien export et comme la
    // colonne « Date commande » du CSV -- meme pour une planifiee, dont la
    // ligne montre la date de livraison.
    const jourCommande = String(order.dateCommande || "").slice(0, 10);
    if (commandesFiltre.du && jourCommande < commandesFiltre.du) return false;
    if (commandesFiltre.au && jourCommande > commandesFiltre.au) return false;
    if (filtre.cle === "a-envoyer" && commandesFiltre.jour
      && String(order.dateCommande || "").slice(0, 10) !== commandesFiltre.jour) return false;
    if (!q) return true;
    // La recherche va jusqu'au PRODUIT (planche 13c : « Numero, client,
    // produit... ») ; l'ancienne ne cherchait que le numero et le client.
    const champs = [order.numero, order.clientName, order.sector, order.id,
      ...(order.products || []).map(p => p.nom || p.produit)];
    return champs.some(c => normalizeTextKey(c || "").includes(q));
  });
  const parDate = (a, b) => String(dateDeLaCommande(a) || "").localeCompare(String(dateDeLaCommande(b) || ""));
  const tris = {
    "date-desc": (a, b) => parDate(b, a),
    "date-asc": parDate,
    client: (a, b) => String(a.clientName || "").localeCompare(String(b.clientName || ""), "fr"),
    numero: (a, b) => String(b.numero || "").localeCompare(String(a.numero || ""), "fr", { numeric: true })
  };
  return liste.sort(tris[commandesFiltre.tri] || tris["date-desc"]);
}

function badgeDeCommande(order) {
  if (commandeBloquee(order)) {
    return `<span class="cmd-badge cmd-badge--alerte"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">`
      + `<path d="M12 8v5M12 16.5h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg>Bloquée</span>`;
  }
  const [mot, ton] = STATUT_COMMANDE[order.status] || [order.status || "Inconnu", "neutre"];
  const coche = ton === "plein"
    ? `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path></svg>`
    : "";
  return `<span class="cmd-badge cmd-badge--${ton}">${coche}${escapeHtml(mot)}</span>`;
}

function renderCommandes() {
  const conteneur = document.getElementById("cmdLignes");
  if (!conteneur) return;

  // Les pilules
  const pilules = document.getElementById("cmdPilules");
  if (pilules) {
    pilules.innerHTML = FILTRES_COMMANDES.map(f => {
      const actif = f.cle === commandesFiltre.statut;
      return `<button class="button secondary compact filtre-pilule${actif ? " active-filter" : ""}" type="button"`
        + ` data-cmd-filtre="${f.cle}" aria-pressed="${actif}">${escapeHtml(f.libelle)}</button>`;
    }).join("");
  }
  const caseBloquees = document.getElementById("cmdBloquees");
  if (caseBloquees) caseBloquees.checked = commandesFiltre.bloquees;
  const filtreClient = document.getElementById("cmdClientFiltre");
  if (filtreClient) {
    filtreClient.hidden = !commandesFiltre.client;
    filtreClient.textContent = commandesFiltre.client ? `Client : ${commandesFiltre.clientNom || "…"} ✕` : "";
    filtreClient.setAttribute("aria-label", `Retirer le filtre client ${commandesFiltre.clientNom || ""}`.trim());
  }
  const caseCompleter = document.getElementById("cmdACompleter");
  if (caseCompleter) caseCompleter.checked = Boolean(commandesFiltre.completer);
  setText("cmdACompleterLibelle", commandesFiltre.completer === "adresse" ? "Adresses à corriger" : "À compléter");
  const secteur = document.getElementById("cmdSecteur");
  if (secteur) {
    const secteurs = [...new Set((orders || []).map(o => String(o.sector || "")).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "fr"));
    if (commandesFiltre.secteur && !secteurs.includes(commandesFiltre.secteur)) secteurs.push(commandesFiltre.secteur);
    secteur.innerHTML = `<option value="">Tous les secteurs</option>`
      + secteurs.map(s => `<option value="${escapeAttribute(s)}">${escapeHtml(formatSectorLabel(s))}</option>`).join("");
    secteur.value = commandesFiltre.secteur;
  }
  if (!commandesFiltre.jour) commandesFiltre.jour = getTodayDateInput();
  const jour = document.getElementById("cmdJour");
  if (jour) jour.value = commandesFiltre.jour;
  const tri = document.getElementById("cmdTri");
  if (tri) tri.value = commandesFiltre.tri;

  const liste = commandesFiltrees();
  // Le compte de la planche 8a (« 124 bons ») et le bouton des filtres repliés,
  // au telephone seulement (la feuille les cache au bureau).
  setText("cmdResume", `${liste.length} bon${liste.length > 1 ? "s" : ""}`);
  const actifs = filtresSecondsActifs();
  const boutonFiltres = document.getElementById("cmdFiltresBouton");
  if (boutonFiltres) {
    boutonFiltres.textContent = actifs ? `Filtres · ${actifs}` : "Filtres";
    boutonFiltres.setAttribute("aria-expanded", String(commandesFiltresOuverts));
  }
  document.querySelector("#commandes .cmd-filtres")?.classList.toggle("cmd-filtres--ouverts", commandesFiltresOuverts);
  // La selection ne garde que ce qui est A L'ECRAN : une recherche ou un
  // changement de jour ne doit pas laisser partir des commandes masquees.
  const visibles = new Set(liste.map(o => String(o.id)));
  for (const id of [...commandesSelection]) if (!visibles.has(id)) commandesSelection.delete(id);
  const pages = Math.max(1, Math.ceil(liste.length / COMMANDES_PAR_PAGE));
  commandesFiltre.page = Math.min(Math.max(1, commandesFiltre.page), pages);
  const debut = (commandesFiltre.page - 1) * COMMANDES_PAR_PAGE;
  const page = liste.slice(debut, debut + COMMANDES_PAR_PAGE);
  const choix = commandesFiltre.statut === "a-envoyer";
  document.querySelector("#commandes .cmd-carte")?.classList.toggle("cmd-carte--choix", choix);

  conteneur.innerHTML = page.length ? page.map(order => {
    const bloquee = commandeBloquee(order);
    const articles = articlesDe(order);
    const manquants = (order.stockLines || []).filter(l => l.status !== "ok").length;
    const colonneArticles = bloquee && manquants
      ? `<span class="cmd-manquants">${manquants} manquant${manquants > 1 ? "s" : ""}</span>`
      : `${articles}`;
    const case_ = choix
      ? `<label class="cmd-col-choix"><input type="checkbox" class="cmd-choix" data-cmd-choix="${escapeAttribute(order.id)}"`
        + ` aria-label="Choisir ${escapeAttribute(order.numero || order.clientName || "la commande")}"`
        + `${commandesSelection.has(String(order.id)) ? " checked" : ""}></label>`
      : `<span class="cmd-col-choix"></span>`;
    return `<div class="cmd-ligne" role="listitem" tabindex="0" data-cmd-ouvrir="${escapeAttribute(order.id)}"`
      // Le nom accessible dit AUSSI le statut : « Bloquee » ne doit pas etre
      // reserve a qui voit le badge.
      + ` aria-label="${escapeAttribute(`${order.numero || ""} ${order.clientName || ""}, ${commandeBloquee(order) ? "Bloquée" : (STATUT_COMMANDE[order.status]?.[0] || order.status || "")}`.trim())}">`
      + case_
      + `<span class="cmd-num">${escapeHtml(order.numero || "—")}`
      + `${order.subscriptionId ? '<span class="cmd-abo">Abonnement</span>' : ""}</span>`
      // La date en deux morceaux (planche 8a : le jour en grand, le mois en
      // petit) ; le texte reste « 16 sept. » pour le bureau et les bancs.
      + `<span class="cmd-date">${dateEnDeuxMorceaux(dateCourte(dateDeLaCommande(order)))}</span>`
      + `<span class="cmd-client">${escapeHtml(order.clientName || "Client")}</span>`
      + `<span class="cmd-secteur">${escapeHtml(order.sector ? formatSectorLabel(order.sector) : "—")}</span>`
      // La ligne de detail du telephone (planche 8a) : « CMD-2026-007 · Champagnole ».
      + `<span class="cmd-meta">${escapeHtml([order.subscriptionId ? "Abonnement" : (order.numero || ""), order.sector ? formatSectorLabel(order.sector) : ""].filter(Boolean).join(" · "))}</span>`
      + `<span class="cmd-articles cmd-droite">${colonneArticles}</span>`
      + `<span class="cmd-statut cmd-droite">${badgeDeCommande(order)}</span>`
      + `</div>`;
  }).join("") : emptyState("Aucune commande", commandesFiltre.recherche || commandesFiltre.bloquees || commandesFiltre.statut !== "toutes"
    || commandesFiltre.completer || commandesFiltre.du || commandesFiltre.au || commandesFiltre.secteur
    ? "Aucune commande ne correspond à ce filtre."
    : "Les commandes importées et saisies apparaîtront ici.");

  setText("cmdCompte", liste.length
    ? `${debut + 1}–${debut + page.length} sur ${liste.length}`
    : "0 sur 0");
  const precedent = document.getElementById("cmdPrecedent");
  const suivant = document.getElementById("cmdSuivant");
  if (precedent) precedent.disabled = commandesFiltre.page <= 1;
  if (suivant) suivant.disabled = commandesFiltre.page >= pages;

  // L'envoi par lot, sous « A envoyer » seulement
  const envoi = document.getElementById("cmdEnvoi");
  if (envoi) {
    // Visible meme sans ligne : c'est elle qui porte le choix du JOUR, et un
    // jour vide doit pouvoir mener a un autre.
    envoi.hidden = !choix;
    const toutCase = document.getElementById("cmdToutSelectionner");
    if (toutCase) toutCase.disabled = !liste.length;
    const n = commandesSelection.size;
    setText("cmdEnvoiCompte", n ? `${n} sélectionnée${n > 1 ? "s" : ""}` : "Aucune sélectionnée");
    const bouton = document.getElementById("cmdEnvoyer");
    if (bouton) bouton.disabled = n === 0 || envoiEnCours;
    const tout = document.getElementById("cmdToutSelectionner");
    if (tout) tout.checked = page.length > 0 && page.every(o => commandesSelection.has(String(o.id)));
    setText("cmdToutLibelle", pages > 1 ? "Tout sélectionner sur la page" : "Tout sélectionner");
  }

  majSousTitreCommandes();
}

// Le sous-titre de la planche : « 124 bons depuis janvier · 5 en cours ».
function majSousTitreCommandes() {
  if (!document.getElementById("commandes")?.classList.contains("active")) return;
  const annee = String(new Date().getFullYear());
  const depuisJanvier = (orders || []).filter(o => String(o.dateCommande || "").startsWith(annee)).length;
  const enCours = (orders || []).filter(o => !["livre", "annulee", "brouillon"].includes(o.status)).length;
  setText("pageSubtitle", `${depuisJanvier} bon${depuisJanvier > 1 ? "s" : ""} depuis janvier · ${enCours} en cours`);
}

// Le detail d'une commande : le modal existant, plus les gestes que la planche
// retire de la liste -- confirmer ou annuler une commande planifiee.
function ouvrirDetailCommande(orderId) {
  // Comme l'ouverture d'origine : on n'arrive jamais dans le detail en mode
  // edition, meme apres un Echap pendant une edition precedente.
  bdcState.editingClientId = null;
  openBdcDetail(orderId);
  const order = (orders || []).find(o => String(o.id) === String(orderId));
  const gestes = document.getElementById("cmdDetailGestes");
  if (!gestes) return;
  gestes.hidden = true;
  gestes.innerHTML = "";
  // Le focus entre dans la fenetre (sinon Tab continue derriere elle) et
  // reviendra a la ligne a la fermeture.
  retourDuDetail = String(orderId);
  document.querySelector("#bdc-detail-modal .version-modal-card button")?.focus();
  if (!order || !["planifiee", "a_confirmer"].includes(order.status)) return;
  gestes.innerHTML = `<button class="button ok" type="button" data-action="cmd-confirmer" data-order-id="${escapeAttribute(order.id)}">Confirmer</button>`
    + `<button class="button danger" type="button" data-action="cmd-annuler" data-order-id="${escapeAttribute(order.id)}">Annuler la commande</button>`;
  gestes.hidden = false;
}

// Un geste du detail FERME le detail : sinon la fenetre restait ouverte, figee,
// et « Annuler » pouvait annuler une commande qui venait de passer en
// preparation -- stock reserve rendu, sans rien demander.
async function gesteDuDetail(action, orderId) {
  if (action === "cmd-annuler"
    && !window.confirm("Annuler cette commande planifiée ? Elle ne sera pas livrée.")) return;
  closeBdcDetail();
  if (action === "cmd-confirmer") await confirmPlannedOrder(orderId);
  else await cancelPlannedOrder(orderId);
}

async function envoyerCommandesEnPreparation() {
  const ids = Array.from(commandesSelection);
  if (!ids.length) return;
  await apiFetch("/api/customer-orders/send-preparation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderIds: ids })
  });
  commandesSelection.clear();
  await loadData();
  notify(`${ids.length} commande${ids.length > 1 ? "s" : ""} envoyée${ids.length > 1 ? "s" : ""} en préparation.`, "success");
}

function bindCommandes() {
  const ecran = document.getElementById("commandes");
  if (!ecran) return;
  // Les pilules ecoutent ELLES-MEMES : au telephone, elles vivent dans
  // l'en-tete, hors de l'ecran (placerPilulesCommandes).
  document.getElementById("cmdPilules")?.addEventListener("click", event => {
    const pilule = event.target.closest("[data-cmd-filtre]");
    if (!pilule) return;
    commandesFiltre.statut = pilule.dataset.cmdFiltre;
    commandesFiltre.page = 1;
    commandesSelection.clear();
    renderCommandes();
    // Le rendu refait les pilules : le focus clavier reste sur celle choisie.
    document.querySelector(`#cmdPilules [data-cmd-filtre="${CSS.escape(commandesFiltre.statut)}"]`)?.focus();
  });
  placerPilulesCommandes();
  ecranTelephone.addEventListener?.("change", placerPilulesCommandes);
  ecran.addEventListener("click", event => {
    if (event.target.closest(".cmd-col-choix")) return;   // la case ne doit pas ouvrir le detail
    const ligne = event.target.closest("[data-cmd-ouvrir]");
    if (ligne) ouvrirDetailCommande(ligne.dataset.cmdOuvrir);
  });
  ecran.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const ligne = event.target.closest?.("[data-cmd-ouvrir]");
    if (!ligne || event.target !== ligne) return;
    event.preventDefault();
    ouvrirDetailCommande(ligne.dataset.cmdOuvrir);
  });
  ecran.addEventListener("change", event => {
    if (event.target.id === "cmdBloquees") {
      commandesFiltre.bloquees = event.target.checked;
      commandesFiltre.page = 1;
      renderCommandes();
    } else if (event.target.id === "cmdACompleter") {
      commandesFiltre.completer = event.target.checked ? "profil" : false;
      commandesFiltre.page = 1;
      renderCommandes();
    } else if (["cmdDu", "cmdAu", "cmdJour"].includes(event.target.id)) {
      const cle = { cmdDu: "du", cmdAu: "au", cmdJour: "jour" }[event.target.id];
      commandesFiltre[cle] = event.target.value;
      commandesFiltre.page = 1;
      renderCommandes();
    } else if (event.target.id === "cmdTri") {
      commandesFiltre.tri = event.target.value;
      renderCommandes();
    } else if (event.target.id === "cmdSecteur") {
      commandesFiltre.secteur = event.target.value;
      commandesFiltre.page = 1;
      renderCommandes();
    } else if (event.target.matches("[data-cmd-choix]")) {
      const id = event.target.dataset.cmdChoix;
      if (event.target.checked) commandesSelection.add(id); else commandesSelection.delete(id);
      renderCommandes();
      // Le rendu refait les lignes : sans ceci, le focus tombait sur <body> et
      // la selection au clavier repartait du haut de la page.
      document.querySelector(`[data-cmd-choix="${CSS.escape(id)}"]`)?.focus();
    } else if (event.target.id === "cmdToutSelectionner") {
      // La PAGE, pas toute la liste : une commande d'une autre page ne part
      // pas sans avoir ete vue.
      const debut = (commandesFiltre.page - 1) * COMMANDES_PAR_PAGE;
      commandesFiltrees().slice(debut, debut + COMMANDES_PAR_PAGE).forEach(o => {
        if (event.target.checked) commandesSelection.add(String(o.id)); else commandesSelection.delete(String(o.id));
      });
      renderCommandes();
    }
  });
  document.getElementById("cmdRecherche")?.addEventListener("input", event => {
    commandesFiltre.recherche = event.target.value;
    commandesFiltre.page = 1;
    renderCommandes();
  });
}

// Les anciens ecrans-listes (commandes du jour, planifiees, livrees, bons de
// commande) et deux ecrans hors navigation (produits, alertes) ne sont plus
// atteignables : les planches V8 les ont fondus dans d'autres ecrans, et leurs
// adresses redirigent. Les dessiner a chaque chargement coutait cher -- mesure
// du 23/09 sur 2 000 commandes : 78 000 elements sur 108 000, et une tache de
// 289 ms au demarrage. On ne les dessine que s'ils sont AFFICHES : si l'un
// redevient atteignable, il se redessine sans qu'on touche a cette liste.
function rendreSiAffiche(idSection, rendu) {
  if (document.getElementById(idSection)?.classList.contains("active")) rendu();
}

function renderAll() {
  majEnteteTableauDeBord(getInitialTab());
  // Premier lancement (planche 10b) : aucune commande -> la carte d'accueil
  // remplace « A regler » et « Cette semaine ».
  document.getElementById("journee")?.toggleAttribute("data-premier-lancement", !(orders || []).length);
  const accueil = document.getElementById("tbPremierLancement");
  if (accueil) accueil.hidden = (orders || []).length > 0;
  renderStats();
  renderDailySummary();
  renderImportSummary();
  renderCrm();
  renderRelances();
  renderCustomerOrder();
  renderStatistics();
  renderExports();
  renderStock();
  renderStockMovements();
  renderPreparation();
  renderRecommande();
  // Les quatre anciennes listes de commandes n'ont plus de rendu : leurs
  // sections ont quitte la page le 23/09 (dette 7), l'ecran Commandes les
  // porte toutes.
  renderCommandes();
  rendreSiAffiche("produits", renderProduits);
  renderVentes();
  rendreSiAffiche("alertes", renderAlertes);
  renderHistorique();
  renderDeliveryFilters();
  renderDeliveryCandidates();
  renderRoute();
  renderClients();
  renderSettings();
  renderImportsArchives();
  renderComptes();
  renderMap();
  updateRouteProgress();
  renderTourneeDuJour();
}

async function importFile(type, inputId) {
  const fileInput = document.getElementById(inputId);
  const file = fileInput?.files?.[0];

  if (!file) {
    notify("Choisis un fichier .xlsx avant d'importer.", "warning");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  // U1 v1.13.0 : overlay loader explicite pendant l'import (peut prendre 5-30s
  // pour un gros fichier). Sans ca l'UI gele silencieusement et le user
  // re-clique = double import. showLoader bloque visuellement.
  const sizeKb = Math.round(file.size / 1024);
  showLoader(`Import ${type === "ventes" ? "des dossiers" : "du stock"} en cours… (${sizeKb} Ko)`);

  try {
    const result = await apiFetch(`/api/import/${type}`, {
      method: "POST",
      body: formData
    });

    lastImportSummary = {
      type,
      result,
      importedAt: new Date().toISOString()
    };
    if (fileInput) fileInput.value = "";
    await loadData();
    notify(type === "ventes" ? "Dossiers importés." : "Stock importé.", "success");
  } finally {
    hideLoader();
  }
}

// U1 v1.13.0 : overlay global pour les actions longues (>500ms perceptible).
// L'overlay capture les clics (pas de double-soumission possible), affiche
// un spinner CSS et un message contextuel. aria-busy=true sur le body pour
// les lecteurs d'ecran.
function showLoader(message) {
  const overlay = document.getElementById("appLoader");
  const msg = document.getElementById("appLoaderMessage");
  if (!overlay) return;
  if (msg && message) msg.textContent = message;
  overlay.hidden = false;
  overlay.setAttribute("aria-busy", "true");
  document.body.setAttribute("aria-busy", "true");
}

function hideLoader() {
  const overlay = document.getElementById("appLoader");
  if (!overlay) return;
  overlay.hidden = true;
  overlay.setAttribute("aria-busy", "false");
  document.body.removeAttribute("aria-busy");
}

// U3 v1.13.0 : focus-trap minimal pour les modals. Maintient le focus a
// l'interieur du modal pendant qu'il est ouvert. Branche sur keydown(Tab).
// Le modal a un attribut aria-modal="true" deja, ce qui aide les lecteurs
// d'ecran mais pas la nav clavier sans ce trap.
function trapFocusWithin(container) {
  if (!container) return null;
  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const handler = event => {
    if (event.key !== "Tab") return;
    const focusables = Array.from(container.querySelectorAll(focusableSelector))
      .filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener("keydown", handler);
  return () => container.removeEventListener("keydown", handler);
}

function renderStats() {
  const summary = dashboard || {};
  const orderCounts = summary.orders || {};
  const stockCounts = summary.stock || {};
  const deliveryToday = orderCounts.deliveryToday ?? orders.filter(order => order.deliveryDate === getTodayDateInput() && ["pret_livraison", "en_livraison"].includes(order.status)).length;
  const delivered = orderCounts.delivered ?? (orders.filter(order => order.status === "livre").length || clients.filter(c => c.statut === "livree").length);
  const problems = orderCounts.deliveryProblems ?? (
    orders.filter(order => ["probleme_livraison", "a_reprogrammer"].includes(order.status)).length
    || clients.filter(c => ["absent", "probleme", "non_livre"].includes(c.statut)).length
  );
  const alerts = getAlertItems().length;
  const lowStockCount = stockCounts.low ?? getLowStockProducts().filter(product => getStockLevel(product).label === "Stock faible").length;
  const outStockCount = stockCounts.out ?? stock.filter(product => getProductQuantity(product) === 0).length;
  const recommendCount = lowStockCount + outStockCount;

  setText("statTotal", orderCounts.imported ?? orders.length ?? clients.length);
  const preparable = orderCounts.preparable ?? orders.filter(order => ["importe", "stock_a_verifier"].includes(order.status) && order.canPrepare).length;
  setText("statPreparable", preparable);
  setText("statDeliveryToday", deliveryToday);
  setText("statReadyDelivery", orderCounts.readyDelivery ?? orders.filter(order => order.status === "pret_livraison").length);
  setText("statInDelivery", orderCounts.inDelivery ?? orders.filter(order => order.status === "en_livraison").length);
  setText("statStockTotal", stockCounts.total ?? stock.length);
  setText("statRecommend", recommendCount);
  setText("statStockOk", stockCounts.ok ?? stock.filter(product => getStockLevel(product).label === "Disponible").length);
  setText("statStockLow", lowStockCount);
  setText("statStockOut", outStockCount);
  setText("statDelivered", delivered);
  setText("statProblems", problems);
  setText("statAlerts", alerts);

  // Les pastilles de la barre laterale se nourrissent des memes compteurs :
  // deux sources donneraient deux verites.
  renderBadgesNav({ aTraiter: preparable, livraisonsDuJour: deliveryToday, aRecommander: recommendCount });

  const badge = document.getElementById("alertBadge");
  if (badge) {
    badge.textContent = alerts > 0 ? String(alerts) : "";
    badge.hidden = alerts === 0;
  }
}

function renderDailySummary() {
  const container = document.getElementById("dailySummary");
  if (!container) return;

  const orderCounts = dashboard?.orders || {};
  const stockCounts = dashboard?.stock || {};
  const lowStock = stockCounts.low ?? getLowStockProducts().length;
  const outStock = stockCounts.out ?? stock.filter(product => getProductQuantity(product) === 0).length;
  const blockedOrders = orderCounts.blocked ?? orders.filter(order => order.stockStatus !== "disponible" && ["importe", "stock_a_verifier"].includes(order.status)).length;
  const readyOrders = orderCounts.readyDelivery ?? orders.filter(order => order.status === "pret_livraison").length;
  const inPreparation = orderCounts.preparing ?? orders.filter(order => order.status === "en_preparation").length;
  const missingInfo = (orderCounts.missingAddress || 0) + (orderCounts.missingPhone || 0);
  const deliveryToday = orderCounts.deliveryToday ?? orders.filter(order => order.deliveryDate === getTodayDateInput() && ["pret_livraison", "en_livraison"].includes(order.status)).length;
  const deliveryUpcoming = orderCounts.deliveryUpcoming ?? orders.filter(order => order.deliveryDate && order.deliveryDate > getTodayDateInput() && ["pret_livraison", "en_livraison"].includes(order.status)).length;
  const planned = orderCounts.planned ?? plannedOrders.filter(order => order.status === "planifiee").length;
  const toConfirm = orderCounts.toConfirm ?? plannedOrders.filter(order => order.status === "a_confirmer").length;
  const remindersDue = orderCounts.remindersDue ?? crmRelances.filter(reminder => reminder.status === "a_faire" && reminder.datePrevue <= getTodayDateInput()).length;

  container.innerHTML = `
    <article class="summary-item status-ok">
      <h4>Workflow actif</h4>
      <p>${orders.length} commande(s), ${stock.length} produit(s), ${ventes.length} ligne(s) importée(s)</p>
    </article>

    <article class="summary-item ${lowStock ? "status-warning" : "status-ok"}">
      <h4>Stock à surveiller</h4>
      <p>${lowStock} stock(s) faible(s), ${outStock} rupture(s)</p>
    </article>

    <article class="summary-item ${blockedOrders ? "status-danger" : "status-ok"}">
      <h4>Commandes bloquées</h4>
      <p>${blockedOrders} commande(s) avec stock insuffisant ou inconnu</p>
    </article>

    <article class="summary-item ${readyOrders ? "status-neutral" : "status-ok"}">
      <h4>Prêtes livraison</h4>
      <p>${readyOrders} prête(s), ${inPreparation} en préparation</p>
    </article>

    <article class="summary-item ${missingInfo ? "status-warning" : "status-ok"}">
      <h4>Données à compléter</h4>
      <p>${missingInfo} commande(s) avec adresse ou téléphone manquant</p>
    </article>

    <article class="summary-item ${planned || toConfirm ? "status-neutral" : "status-ok"}">
      <h4>Commandes planifiées</h4>
      <p>${planned} planifiée(s), ${toConfirm} à confirmer</p>
    </article>

    <article class="summary-item ${remindersDue ? "status-warning" : "status-ok"}">
      <h4>Rappels CRM</h4>
      <p>${remindersDue} rappel(s) à traiter aujourd'hui ou en retard</p>
    </article>

    <article class="summary-item status-neutral">
      <h4>Tournées</h4>
      <p>${deliveryToday} livraison(s) aujourd'hui, ${deliveryUpcoming} à venir</p>
    </article>
  `;
}

function renderImportSummary() {
  const container = document.getElementById("importSummary");
  if (!container) return;

  if (!lastImportSummary) {
    container.innerHTML = emptyState("Aucun import récent", "Les prochains imports afficheront ici leur résumé et les alertes détectées.");
    return;
  }

  const { type, result, importedAt } = lastImportSummary;
  const isOrders = type === "ventes";
  const importedCount = isOrders ? (result.commandes?.length || result.clients?.length || 0) : (result.stock?.length || 0);
  const blocked = isOrders ? (result.commandes || []).filter(order => !order.canPrepare).length : 0;
  const sectorsCount = isOrders ? (result.secteurs?.length || 0) : 0;

  container.innerHTML = `
    <article class="summary-item status-ok">
      <h4>${isOrders ? "Dossiers importés" : "Stock importé"}</h4>
      <p>${escapeHtml(importedCount)} élément(s) traités à ${escapeHtml(formatDate(importedAt))}.</p>
    </article>
    ${isOrders ? `
      <article class="summary-item ${blocked ? "status-warning" : "status-ok"}">
        <h4>Analyse stock</h4>
        <p>${escapeHtml(blocked)} commande(s) à corriger ou compléter.</p>
      </article>
      <article class="summary-item status-neutral">
        <h4>Secteurs détectés</h4>
        <p>${escapeHtml(sectorsCount)} secteur(s) disponible(s) pour la livraison.</p>
      </article>
    ` : ""}
  `;
}

function crmStatusLabel(status) {
  const labels = {
    prospect: "Prospect",
    client_actif: "Client actif",
    client_a_relancer: "Client a relancer",
    client_inactif: "Client inactif"
  };
  return labels[status] || "Prospect";
}

function crmStatusPill(status) {
  if (status === "client_actif") return "pill-ok";
  if (status === "client_a_relancer") return "pill-warning";
  if (status === "client_inactif") return "pill-danger";
  return "pill-blue";
}

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
}

const ICONE_CLI = {
  abonnes: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9a5 5 0 0 1 5-5h6l-2-2m6 8a5 5 0 0 1-5 5H8l2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  lieu: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path></svg>',
  tel: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.5 4h3l2 5-2.5 1.5a11 11 0 0 0 4.5 4.5L15 12.5l5 2v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path></svg>',
  retard: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5"></circle><path d="M12 8v4m0 3.5v.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
};

function nomDuClient(client) {
  return [client.prenom, client.nom].filter(Boolean).join(" ") || client.nom || "Client";
}

// Le meme predicat que le serveur (adresseGeocodable) : une rue, et un code
// postal ou une ville. Sans cela, la tournee ne place pas le client.
function adresseClientACorriger(client) {
  return !(String(client.rue || "").trim() && (String(client.codePostal || "").trim() || String(client.ville || "").trim()));
}

// L'abonnement d'un client : l'actif d'abord, sinon celui en pause. Un
// abonnement arrete ne se montre plus (la planche n'en dessine aucun).
function abonnementDuClient(clientId) {
  const siens = (abonnementsDonnees.items || []).filter(s => String(s.clientId) === String(clientId));
  return siens.find(s => s.status === "active") || siens.find(s => s.status === "paused") || null;
}

// La prochaine echeance SANS commande : c'est elle que « Creer la commande »
// produit. En retard si sa date est passee.
function echeanceAFaire(abonnement) {
  return (abonnementsDonnees.occurrences || [])
    .filter(o => o.subscriptionId === abonnement.id && !o.orderId)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
}

function frequenceLisible(abonnement) {
  const f = abonnement.frequency || {};
  const n = Number(f.interval) || 1;
  if (f.unit === "months") return n === 1 ? "tous les mois" : `tous les ${n} mois`;
  return n === 1 ? "tous les jours" : (n % 7 === 0 ? (n === 7 ? "toutes les semaines" : `toutes les ${n / 7} semaines`) : `tous les ${n} j`);
}

function commandesDuClient(clientId) {
  return (orders || []).filter(o => String(o.clientId) === String(clientId))
    .sort((a, b) => String(b.dateCommande || "").localeCompare(String(a.dateCommande || "")));
}

// La derniere LIVRAISON (planche 13e : « livree le 2 sept. »). Les commandes
// sont deja dans la page : le calcul ne coute rien au serveur.
function derniereLivraison(clientId) {
  return commandesDuClient(clientId)
    .filter(o => o.status === "livre")
    // deliveredAt est un instant UTC : on prend le JOUR a Paris (une livraison
    // a 0 h 30 n'est pas celle de la veille).
    .map(o => o.deliveredAt ? new Date(o.deliveredAt).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }) : String(o.deliveryDate || "").slice(0, 10))
    .filter(Boolean)
    .sort()
    .pop() || null;
}

function clientsFiltres() {
  const query = normalizeTextKey(crmFilter.query);
  const today = getTodayDateInput();
  const filtre = crmFilter.status || "all";
  return crmClients.filter(client => {
    if (query && !normalizeTextKey([client.nom, client.prenom, client.telephone, client.rue, client.ville, client.email]
      .join(" ")).includes(query)) return false;
    if (crmFilter.secteur === "__abonnes") {
      if (abonnementDuClient(client.id)?.status !== "active") return false;
    } else if (crmFilter.secteur && String(client.secteur || "") !== crmFilter.secteur) return false;
    if (filtre === "relance_today") return client.nextReminderDate === today;
    if (filtre === "relance_late") return Boolean(client.nextReminderDate && client.nextReminderDate < today);
    if (filtre !== "all") return client.crmStatus === filtre;
    return true;
  }).sort((a, b) => nomDuClient(a).localeCompare(nomDuClient(b), "fr"));
}

// « 47 clients · 6 abonnes · 1 adresse a corriger » (planche 13e).
function majSousTitreClients() {
  if (!document.getElementById("crm")?.classList.contains("active")) return;
  const n = crmClients.length;
  const abonnes = new Set((abonnementsDonnees.items || []).filter(s => s.status === "active")
    .map(s => String(s.clientId)).filter(id => crmClients.some(c => String(c.id) === id))).size;
  const aCorriger = crmClients.filter(adresseClientACorriger).length;
  const morceaux = [`${n} client${n > 1 ? "s" : ""}`, `${abonnes} abonné${abonnes > 1 ? "s" : ""}`];
  if (aCorriger) morceaux.push(`${aCorriger} adresse${aCorriger > 1 ? "s" : ""} à corriger`);
  setText("pageSubtitle", morceaux.join(" · "));
}

function renderCrm() {
  const container = document.getElementById("crmList");
  if (!container) return;
  renderClientSelects();

  // Les pilules : Tous, les secteurs trouves chez les clients, Abonnes.
  const pilules = document.getElementById("cliPilules");
  if (pilules) {
    const secteurs = [...new Set(crmClients.map(c => String(c.secteur || "")).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "fr"));
    const pilule = (cle, libelle, icone = "") => {
      const actif = crmFilter.secteur === cle;
      return `<button class="cli-pilule${actif ? " cli-pilule--active" : ""}" type="button" data-cli-secteur="${escapeAttribute(cle)}" aria-pressed="${actif}">${icone}${escapeHtml(libelle)}</button>`;
    };
    pilules.innerHTML = pilule("", "Tous")
      + secteurs.map(s => pilule(s, formatSectorLabel(s))).join("")
      + pilule("__abonnes", "Abonnés", ICONE_CLI.abonnes);
  }

  const rappels = (crmRelances || []).filter(r => r.status === "a_faire" && String(r.datePrevue || "") <= getTodayDateInput()).length;
  setText("cliRappelsCompte", rappels ? ` · ${rappels}` : "");
  majSousTitreClients();

  const list = clientsFiltres();
  if (!list.some(c => String(c.id) === String(clientChoisi))) clientChoisi = list[0] ? String(list[0].id) : null;

  if (!list.length) {
    container.innerHTML = emptyState("Aucun client", crmClients.length
      ? "Aucun client ne correspond à ce filtre."
      : "Crée une fiche avec « Nouveau client ».");
  } else {
    container.innerHTML = list.map(client => {
      const choisi = String(client.id) === clientChoisi;
      const abonnement = abonnementDuClient(client.id);
      const livraison = derniereLivraison(client.id);
      const meta = adresseClientACorriger(client)
        ? `<span class="cli-meta cli-alerte">${ICONE_CLI.lieu}Adresse à corriger${client.ville ? ` · ${escapeHtml(client.ville)}` : ""}</span>`
        : `<span class="cli-meta">${escapeHtml([client.ville, livraison ? `livrée le ${dateCourte(livraison)}` : ""].filter(Boolean).join(" · ") || "—")}</span>`;
      const badge = abonnement
        ? `<span class="cli-badge cli-badge--${abonnement.status === "active" ? "froid" : "tiede"}">${abonnement.status === "active" ? "Abonné" : "En pause"}</span>`
        : "";
      return `<div role="listitem"><button class="cli-ligne${choisi ? " cli-ligne--choisie" : ""}" type="button" data-cli-choisir="${escapeAttribute(client.id)}" aria-current="${choisi ? "true" : "false"}">`
        + `<span class="cli-ligne-texte"><span class="cli-nom">${escapeHtml(nomDuClient(client))}</span>${meta}</span>${badge}</button></div>`;
    }).join("");
  }
  renderFicheClient();
}

function renderFicheClient() {
  const fiche = document.getElementById("cliFiche");
  if (!fiche) return;
  const client = crmClients.find(c => String(c.id) === String(clientChoisi));
  if (!client) {
    fiche.innerHTML = `<p class="cli-fiche-vide">Choisis un client dans la liste.</p>`;
    return;
  }
  const abonnement = abonnementDuClient(client.id);
  const puces = [client.secteur ? formatSectorLabel(client.secteur) : client.ville, abonnement ? (abonnement.status === "active" ? "Abonné" : "En pause") : ""]
    .filter(Boolean).map((p, i) => `<span class="cli-badge cli-badge--${i === 1 && abonnement?.status !== "active" ? "tiede" : "froid"} cli-puce">${escapeHtml(p)}</span>`).join("");
  const appeler = client.telephone
    ? `<a class="button primary cli-appeler" href="tel:${escapeAttribute(String(client.telephone).replace(/[^\d+]/g, ""))}">${ICONE_CLI.tel}<span>Appeler</span></a>`
    : "";
  // « Itineraire » (planche 8c, le second geste du terrain) : seulement si
  // l'adresse permet un trajet (rue ET ville) -- sinon le lien serait vide.
  const trajet = buildGoogleMapsUrl(client);
  const itineraire = trajet
    ? `<a class="cli-bouton-contour cli-itineraire" href="${escapeAttribute(trajet)}" target="_blank" rel="noopener noreferrer">Itinéraire</a>`
    : "";
  const adresse = adresseClientACorriger(client)
    ? `<p class="cli-valeur cli-alerte">Adresse à corriger</p><p class="cli-note">${escapeHtml([client.rue, client.codePostal, client.ville].filter(Boolean).join(" ") || "Aucune adresse")}</p>`
    : `<p class="cli-valeur">${escapeHtml(client.rue)}<br>${escapeHtml([client.codePostal, client.ville].filter(Boolean).join(" "))}</p>`;
  const contact = `<p class="cli-valeur">${escapeHtml(client.telephone || "Téléphone à compléter")}</p>`
    + (client.email ? `<p class="cli-note">${escapeHtml(client.email)}</p>` : "");

  let carteAbonnement = "";
  if (abonnement) {
    const echeance = echeanceAFaire(abonnement);
    const enRetard = Boolean(echeance?.overdue);
    const produits = (abonnement.products || []).map(p => `${p.quantite} ${p.nom || p.designation || p.code || ""}`.trim()).join(", ");
    const morceaux = [produits, `rappel ${abonnement.reminderDays ?? 0} j`, echeance ? `échéance du ${dateCourte(echeance.date)}` : ""].filter(Boolean);
    const geste = abonnement.status === "active" && echeance
      ? `<button class="cli-bouton-contour" type="button" data-op="generate-sub" data-id="${escapeAttribute(abonnement.id)}" data-date="${escapeAttribute(echeance.date)}">Créer la commande</button>`
      : "";
    carteAbonnement = `<div class="cli-abonnement subscription-card">
      <div class="cli-abonnement-texte">
        <p class="cli-abonnement-titre">Abonnement · ${escapeHtml(frequenceLisible(abonnement))}${enRetard ? `<span class="cli-badge cli-badge--alerte">${ICONE_CLI.retard}En retard</span>` : ""}${abonnement.status !== "active" ? `<span class="cli-badge cli-badge--tiede">En pause</span>` : ""}</p>
        <p class="cli-abonnement-detail">${escapeHtml(morceaux.join(" · "))}</p>
      </div>${geste}</div>`;
  }

  const commandes = commandesDuClient(client.id);
  const annee = String(new Date().getFullYear());
  const depuisJanvier = commandes.filter(o => String(o.dateCommande || "").startsWith(annee)).length;
  const visibles = commandes.slice(0, 4);
  const reste = commandes.length - visibles.length;
  const lignesCommandes = visibles.length
    ? visibles.map(o => `<button class="cli-commande" type="button" data-cli-commande="${escapeAttribute(o.id)}" aria-label="${escapeAttribute(`${o.numero || ""}, ${STATUT_COMMANDE[o.status]?.[0] || o.status || ""}`)}">`
        + `<span class="cli-commande-num">${escapeHtml(o.numero || "—")}</span>`
        + `<span class="cli-commande-date">${escapeHtml(dateCourte(o.dateCommande))}</span>`
        + `<span class="cli-commande-articles">${articlesDe(o)} article${articlesDe(o) > 1 ? "s" : ""}</span>`
        + `<span class="cli-commande-statut">${badgeDeCommande(o)}</span></button>`).join("")
    : `<p class="cli-note">Aucune commande.</p>`;

  const extras = [
    client.nextReminderDate ? `Prochaine relance : ${dateCourte(client.nextReminderDate)}` : "",
    client.needs ? `Besoins : ${client.needs}` : "",
    client.preferences ? `Préférés : ${client.preferences}` : "",
    client.notes || ""
  ].filter(Boolean);

  fiche.innerHTML = `
    <button class="cli-retour" type="button" data-action="cli-retour" aria-label="Retour à la liste des clients"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></svg><span>Clients</span></button>
    <header class="cli-fiche-tete">
      <div class="cli-fiche-identite">
        <h2 class="cli-fiche-nom">${escapeHtml(nomDuClient(client))}</h2>
        <div class="cli-puces">${puces}</div>
      </div>
      <div class="cli-fiche-gestes">${appeler}${itineraire}<button class="cli-bouton-contour" type="button" data-action="cli-modifier" data-client-id="${escapeAttribute(client.id)}">Modifier</button></div>
    </header>
    <div class="cli-champs">
      <div><p class="cli-libelle">Adresse</p>${adresse}</div>
      <div><p class="cli-libelle">Contact</p>${contact}</div>
    </div>
    ${extras.length ? `<div class="cli-notes">${extras.map(e => `<p class="cli-note">${escapeHtml(e)}</p>`).join("")}</div>` : ""}
    <label class="cli-statut">
      <span class="cli-libelle">Statut commercial</span>
      <select data-cli-statut="${escapeAttribute(client.id)}" aria-label="Statut commercial de ${escapeAttribute(nomDuClient(client))}">
        ${["prospect", "client_actif", "client_a_relancer", "client_inactif"].map(s => `<option value="${s}"${(client.crmStatus || "prospect") === s ? " selected" : ""}>${escapeHtml(crmStatusLabel(s))}</option>`).join("")}
      </select>
    </label>
    ${carteAbonnement}
    <section class="cli-commandes" aria-label="Commandes du client">
      <div class="cli-commandes-tete"><h3>Commandes</h3><span class="cli-note">${depuisJanvier} depuis janvier</span></div>
      <div class="cli-commandes-liste">${lignesCommandes}</div>
      ${reste > 0 ? `<button class="cli-autres" type="button" data-action="cli-voir-commandes" data-client-id="${escapeAttribute(client.id)}" data-client-nom="${escapeAttribute(nomDuClient(client))}">Les ${reste} autre${reste > 1 ? "s" : ""}${ICONE_CLI.chevron}</button>` : ""}
    </section>`;
}

function ouvrirDialogueClient(clientId = null) {
  const dialogue = document.getElementById("cliDialogue");
  const form = document.getElementById("crmForm");
  if (!dialogue || !form || typeof dialogue.showModal !== "function") return;
  form.reset();
  const client = clientId ? crmClients.find(c => String(c.id) === String(clientId)) : null;
  setText("cliDialogueTitre", client ? "Modifier le client" : "Nouveau client");
  form.elements.id.value = client ? client.id : "";
  const erreur = document.getElementById("cliErreur");
  if (erreur) { erreur.hidden = true; erreur.textContent = ""; }
  form.dataset.initial = "{}";
  if (client) {
    const valeurs = { nom: client.nom, prenom: client.prenom, telephone: client.telephone, email: client.email,
      adresse: client.rue, codePostal: client.codePostal, ville: client.ville, crmStatus: client.crmStatus || "prospect",
      nextReminderDate: client.nextReminderDate, needs: client.needs, preferences: client.preferences, notes: client.notes };
    for (const [cle, valeur] of Object.entries(valeurs)) if (form.elements[cle]) form.elements[cle].value = valeur ?? "";
    // Ce que le dialogue a MONTRE : on n'enverra que ce qui en differe.
    form.dataset.initial = JSON.stringify(Object.fromEntries(new FormData(form).entries()));
  }
  dialogue.showModal();
  form.elements.nom.focus();
}

// La vue du telephone : « liste » ou « fiche » (sans effet au-dessus de 820 px,
// ou la liste et la fiche sont cote a cote).
function ouvrirVueClient(vue, { depuisHistorique = false } = {}) {
  const ecran = document.getElementById("crm");
  if (!ecran) return;
  // Ouvrir une fiche pose une entree d'historique : le retour du telephone
  // ramene a la liste au lieu de quitter l'ecran. Le bouton « Clients » de la
  // fiche consomme cette entree.
  if (vue === "fiche" && ecran.dataset.vue !== "fiche") history.pushState({ cliVue: "fiche" }, "", location.hash || "#crm");
  if (vue === "liste" && ecran.dataset.vue === "fiche" && !depuisHistorique && history.state?.cliVue === "fiche") {
    history.back();
    return;
  }
  ecran.dataset.vue = vue;
  window.scrollTo({ top: 0 });
  if (vue === "fiche") {
    document.querySelector("#cliFiche .cli-retour")?.focus();
  } else if (clientChoisi) {
    document.querySelector(`[data-cli-choisir="${CSS.escape(clientChoisi)}"]`)?.focus();
  }
}

function bindClients() {
  const ecran = document.getElementById("crm");
  if (!ecran) return;
  ecran.addEventListener("click", event => {
    const pilule = event.target.closest("[data-cli-secteur]");
    if (pilule) {
      crmFilter.secteur = pilule.dataset.cliSecteur;
      renderCrm();
      document.querySelector(`[data-cli-secteur="${CSS.escape(crmFilter.secteur)}"]`)?.focus();
      return;
    }
    const ligne = event.target.closest("[data-cli-choisir]");
    if (ligne) {
      clientChoisi = ligne.dataset.cliChoisir;
      renderCrm();
      document.querySelector(`[data-cli-choisir="${CSS.escape(clientChoisi)}"]`)?.focus();
      // Au telephone (planches 9a puis 8c) : la liste, PUIS la fiche en plein
      // ecran, avec un retour. Entre 821 et 1180 px la fiche est sous la liste :
      // on la montre.
      if (window.matchMedia("(max-width: 820px)").matches) {
        ouvrirVueClient("fiche");
      } else if (window.matchMedia("(max-width: 1180px)").matches) {
        document.getElementById("cliFiche")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      return;
    }
    if (event.target.closest("[data-action='cli-retour']")) {
      ouvrirVueClient("liste");
      return;
    }
    const commande = event.target.closest("[data-cli-commande]");
    if (commande) ouvrirDetailCommande(commande.dataset.cliCommande);
  });
  ecran.addEventListener("change", event => {
    const statut = event.target.closest("[data-cli-statut]");
    if (statut) {
      const id = statut.dataset.cliStatut;
      runAction(statut, "", () => updateCrmClientStatus(id, statut.value))
        .then(() => document.querySelector(`[data-cli-statut="${CSS.escape(id)}"]`)?.focus());
    }
  });
}

function renderClientSelects() {
  const options = `<option value="">Nouveau client</option>` + crmClients
    .slice()
    .sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr"))
    .map(client => `<option value="${escapeAttribute(client.id)}">${escapeHtml([client.prenom, client.nom].filter(Boolean).join(" ") || client.nom)}</option>`)
    .join("");

  const customerSelect = document.getElementById("customerClientSelect");
  if (customerSelect && customerSelect.options.length !== crmClients.length + 1) customerSelect.innerHTML = options;

  const relanceSelect = document.getElementById("relanceClientSelect");
  if (relanceSelect) relanceSelect.innerHTML = options.replace("Nouveau client", "Choisir un client");
}

// Ce qui, dans une fiche, est recopie sur ses COMMANDES par /api/clients/:id :
// l'adresse de livraison, le nom, le telephone. La route CRM ne le fait pas.
const CHAMPS_IDENTITE = { nom: "nom", adresse: "rue", codePostal: "codePostal", ville: "ville", telephone: "telephone" };

async function saveCrmClient(form) {
  const { id, ...data } = Object.fromEntries(new FormData(form).entries());
  const erreur = document.getElementById("cliErreur");
  if (erreur) { erreur.hidden = true; erreur.textContent = ""; }
  try {
    if (!id) {
      const cree = await apiFetch("/api/crm/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      // La fiche creee s'ouvre -- y compris si un filtre l'aurait cachee.
      if (cree?.id) clientChoisi = String(cree.id);
      Object.assign(crmFilter, { query: "", status: "all", secteur: "" });
      const recherche = document.getElementById("crmSearch");
      if (recherche) recherche.value = "";
      const statut = document.getElementById("crmStatusFilter");
      if (statut) statut.value = "all";
    } else {
      // Seulement ce qui a CHANGE : sinon des valeurs calculees par le serveur
      // (prochaine relance, statut deduit) etaient figees dans la fiche.
      const avant = JSON.parse(form.dataset.initial || "{}");
      const change = Object.fromEntries(Object.entries(data).filter(([cle, valeur]) => String(avant[cle] ?? "") !== String(valeur)));
      const identite = {}, crm = {};
      for (const [cle, valeur] of Object.entries(change)) {
        if (cle in CHAMPS_IDENTITE) identite[CHAMPS_IDENTITE[cle]] = valeur; else crm[cle] = valeur;
      }
      if (Object.keys(identite).length) {
        await apiFetch(`/api/clients/${encodeURIComponent(id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identite)
        });
      }
      if (Object.keys(crm).length) {
        await apiFetch(`/api/crm/clients/${encodeURIComponent(id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(crm)
        });
      }
    }
  } catch (error) {
    // Dans le dialogue : un toast serait sous sa couche, assombri et inerte.
    if (erreur) {
      erreur.textContent = error?.message || "Enregistrement impossible.";
      erreur.hidden = false;
      return;
    }
    throw error;
  }
  form.reset();
  document.getElementById("cliDialogue")?.close();
  await loadData();
  notify(id ? "Fiche client mise à jour." : "Client enregistré.", "success");
  // Au telephone, la fiche creee s'ouvre (et pas seulement sa ligne).
  if (!id && window.matchMedia("(max-width: 820px)").matches) ouvrirVueClient("fiche");
  // Le rendu a remplace le bouton retour : le focus y revient.
  if (document.getElementById("crm")?.dataset.vue === "fiche") document.querySelector("#cliFiche .cli-retour")?.focus();
}

async function updateCrmClientStatus(clientId, status) {
  await apiFetch(`/api/crm/clients/${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ crmStatus: status })
  });
  await loadData();
  notify("Statut CRM mis a jour.", "success");
}

function renderRelances() {
  const container = document.getElementById("relanceList");
  const summary = document.getElementById("relanceSummary");
  if (!container) return;

  const today = getTodayDateInput();
  let list = crmRelances.slice();
  if (relanceFilter === "today") list = list.filter(item => item.datePrevue === today);
  if (relanceFilter === "late") list = list.filter(item => item.status === "a_faire" && item.datePrevue < today);
  if (relanceFilter === "week") {
    const limit = new Date();
    limit.setDate(limit.getDate() + 7);
    const max = getTodayDateInput(limit);
    list = list.filter(item => item.datePrevue >= today && item.datePrevue <= max);
  }
  if (relanceFilter === "upcoming") list = list.filter(item => item.status === "a_faire" && item.datePrevue > today);

  // La pilule choisie se dit aussi a un lecteur d'ecran, pas seulement par
  // son fond (comme les pilules de la Preparation).
  document.querySelectorAll("[data-relance-filter]").forEach(button => {
    const choisie = button.dataset.relanceFilter === relanceFilter;
    button.classList.toggle("active-filter", choisie);
    button.setAttribute("aria-pressed", String(choisie));
  });

  const todoCount = crmRelances.filter(item => item.status === "a_faire").length;
  if (summary) summary.textContent = `${todoCount} à faire`;

  if (!list.length) {
    container.innerHTML = emptyState("Aucun rappel", "Les appels, visites et confirmations programmés apparaîtront ici.");
    return;
  }

  container.innerHTML = list.map(item => {
    const client = item.client || crmClients.find(c => String(c.id) === String(item.clientId)) || {};
    const order = item.order || orders.find(order => String(order.id) === String(item.commandeId)) || null;
    const level = item.status === "fait" ? "pill-ok" : (item.datePrevue < today ? "pill-danger" : (item.datePrevue === today ? "pill-warning" : "pill-blue"));
    return `
      <article class="item">
        <div class="item-header">
          <div>
            <h4>${escapeHtml([client.prenom, client.nom].filter(Boolean).join(" ") || client.nom || "Client")}</h4>
            <p>${escapeHtml(item.motif || "Rappel client")} - ${escapeHtml(formatDateDayOnly(item.datePrevue))}</p>
            ${order ? `<p class="muted">${escapeHtml(order.numero || order.id)} - livraison ${escapeHtml(order.deliveryDate ? formatDeliveryDate(order.deliveryDate) : "à dater")}</p>` : ""}
          </div>
          <span class="pill ${level}">${escapeHtml(item.status === "a_faire" ? "À faire" : item.status)}</span>
        </div>
        <p class="muted">${escapeHtml(item.commentaire || "Aucun commentaire")}</p>
        <div class="card-actions">
          <button class="button ok compact" type="button" data-relance-id="${escapeAttribute(item.id)}" data-relance-status="fait">Fait</button>
          <button class="button warning compact" type="button" data-relance-id="${escapeAttribute(item.id)}" data-relance-status="reporte">Reporte</button>
          <button class="button danger compact" type="button" data-relance-id="${escapeAttribute(item.id)}" data-relance-status="annule">Annule</button>
        </div>
      </article>
    `;
  }).join("");
}

async function saveRelance(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  await apiFetch("/api/crm/relances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  form.reset();
  await loadData();
  notify("Rappel créé.", "success");
}

async function updateRelanceStatus(relanceId, status) {
  await apiFetch(`/api/crm/relances/${encodeURIComponent(relanceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, dateRealisation: status === "fait" ? getTodayDateInput() : "" })
  });
  await loadData();
  notify("Rappel mis à jour.", "success");
}

function renderCustomerOrder() {
  renderClientSelects();
  renderCustomerCategoryFilter();
  renderCustomerCatalog();
  renderCustomerCart();
}

function renderCustomerCategoryFilter() {
  const select = document.getElementById("customerCategoryFilter");
  if (!select) return;
  const current = customerProductFilter.category || "all";
  const categories = [...new Set(stock.map(product => product.category || product.type || "").filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr"));
  select.innerHTML = `<option value="all">Toutes catégories</option>${categories.map(category => `<option value="${escapeAttribute(category)}" ${category === current ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}`;
}

function renderCustomerCatalog() {
  const container = document.getElementById("customerCatalog");
  const count = document.getElementById("customerCatalogCount");
  if (!container) return;
  const query = normalizeTextKey(customerProductFilter.query);
  const category = customerProductFilter.category || "all";
  const products = stock.filter(product => {
    if (query && !normalizeTextKey([getProductName(product), product.code, product.category, product.type].join(" ")).includes(query)) return false;
    if (category !== "all" && String(product.category || product.type || "") !== category) return false;
    return true;
  });
  if (count) count.textContent = `${products.length} produit${products.length > 1 ? "s" : ""}`;
  if (!products.length) {
    container.innerHTML = emptyState("Aucun produit", "Importe le stock ou modifie la recherche.", { libelle: "Importer le stock", onglet: "journee" });
    return;
  }
  container.innerHTML = products.map(product => {
    const quantity = getProductQuantity(product);
    const selected = customerCart.get(String(product.id))?.quantite || 0;
    return `
      <article class="product-card">
        <div>
          <h4>${escapeHtml(getProductName(product))}</h4>
          <p>${escapeHtml(product.code || product.sku || "Sans référence")}</p>
          <span class="muted">Stock ${quantity === null ? "?" : escapeHtml(quantity)} - ${formatMoney(getProductPrice(product))}</span>
        </div>
        <div class="product-stepper">
          <button class="button secondary compact stepper-btn" type="button" data-customer-product="${escapeAttribute(product.id)}" data-customer-delta="-1" aria-label="Retirer une unité de ${escapeAttribute(getProductName(product))}">−</button>
          <input class="stepper-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${escapeAttribute(selected)}" data-customer-qty-input data-product-id="${escapeAttribute(product.id)}" aria-label="Quantité ${escapeAttribute(getProductName(product))}">
          <button class="button secondary compact stepper-btn" type="button" data-customer-product="${escapeAttribute(product.id)}" data-customer-delta="1" aria-label="Ajouter une unité de ${escapeAttribute(getProductName(product))}">+</button>
        </div>
      </article>
    `;
  }).join("");
}

function getProductPrice(product) {
  return Number(product.prixUnitaire ?? product.tarif ?? product.prix ?? product.price ?? product.cout ?? 0) || 0;
}

function changeCustomerCart(productId, delta) {
  const product = stock.find(item => String(item.id) === String(productId));
  if (!product) return;
  const current = customerCart.get(String(productId)) || {
    productId: product.id,
    code: product.code || product.sku || "",
    nom: getProductName(product),
    quantite: 0,
    prixUnitaire: getProductPrice(product)
  };
  const available = getProductQuantity(product);
  const nextQuantity = Math.max(0, current.quantite + delta);
  const isPlannedOrder = document.getElementById("customerOrderType")?.value === "planifiee";
  if (!isPlannedOrder && available !== null && nextQuantity > available) {
    notify("Stock insuffisant pour ce produit.", "warning");
    return;
  }
  if (nextQuantity === 0) customerCart.delete(String(productId));
  else customerCart.set(String(productId), { ...current, quantite: nextQuantity });
  renderCustomerCatalog();
  renderCustomerCart();
}

// Audit UI 2026-07 : saisie directe de la quantite (valeur absolue) en plus
// des boutons -/+, pour ne plus taper 30 fois "+". Reutilise la meme
// validation de stock que changeCustomerCart.
// Revue R2 : (1) ne PAS re-rendre tout le catalogue (le re-render sur `change`
// detachait le bouton +/- adjacent avant le mouseup -> clic avale). On met a
// jour uniquement le champ concerne + le panier. (2) une saisie non numerique
// (collage "3x") est ignoree au lieu de supprimer silencieusement l'article.
function setCustomerCart(productId, value, inputEl) {
  const product = stock.find(item => String(item.id) === String(productId));
  if (!product) return;
  const current = customerCart.get(String(productId));
  const currentQuantity = current?.quantite || 0;
  const raw = String(value).trim();

  // Entree invalide (non entier) : on restaure l'affichage sans toucher au panier.
  if (raw !== "" && !/^\d+$/.test(raw)) {
    if (inputEl) inputEl.value = currentQuantity;
    return;
  }

  const available = getProductQuantity(product);
  const isPlannedOrder = document.getElementById("customerOrderType")?.value === "planifiee";
  let nextQuantity = Math.max(0, Math.floor(Number(raw) || 0));
  if (!isPlannedOrder && available !== null && nextQuantity > available) {
    notify("Stock insuffisant pour ce produit.", "warning");
    nextQuantity = available;
  }

  const base = current || {
    productId: product.id,
    code: product.code || product.sku || "",
    nom: getProductName(product),
    quantite: 0,
    prixUnitaire: getProductPrice(product)
  };
  if (nextQuantity === 0) customerCart.delete(String(productId));
  else customerCart.set(String(productId), { ...base, quantite: nextQuantity });

  // Reflete la valeur retenue (utile si clampee) sans re-rendre le catalogue.
  if (inputEl) inputEl.value = nextQuantity;
  renderCustomerCart();
}

function renderCustomerCart() {
  const container = document.getElementById("customerCart");
  const count = document.getElementById("customerCartCount");
  const totalEl = document.getElementById("customerCartTotal");
  if (!container) return;
  const lines = Array.from(customerCart.values());
  const total = lines.reduce((sum, line) => sum + line.quantite * line.prixUnitaire, 0);
  if (count) count.textContent = `${lines.length} produit${lines.length > 1 ? "s" : ""}`;
  if (totalEl) totalEl.textContent = formatMoney(total);
  updateCustomerCartBar();
  if (!lines.length) {
    container.innerHTML = emptyState("Panier vide", "Ajoute les produits depuis le catalogue.");
    return;
  }
  container.innerHTML = lines.map(line => `
    <div class="cart-line">
      <div><strong>${escapeHtml(line.nom)}</strong><span class="muted">x ${escapeHtml(line.quantite)} - ${formatMoney(line.prixUnitaire)}</span></div>
      <strong>${formatMoney(line.quantite * line.prixUnitaire)}</strong>
    </div>
  `).join("");
}

// Barre panier collante (mobile) : visible seulement sur l'onglet Commande
// client ET quand le panier n'est pas vide. Placee au niveau .app (hors des
// .page qui ont un transform residuel piegeant position:fixed).
function updateCustomerCartBar() {
  const bar = document.getElementById("customerCartBar");
  if (!bar) return;
  const totalBar = document.getElementById("customerCartTotalBar");
  const lines = Array.from(customerCart.values());
  const total = lines.reduce((sum, line) => sum + line.quantite * line.prixUnitaire, 0);
  if (totalBar) totalBar.textContent = formatMoney(total);
  const onCustomerTab = document.getElementById("commande-client")?.classList.contains("active");
  const visible = onCustomerTab && lines.length > 0;
  bar.hidden = !visible;
  // La reserve d'espace en bas de l'onglet n'est posee que quand la barre est la.
  document.getElementById("commande-client")?.classList.toggle("has-cart-bar", visible);
}

function fillCustomerFormFromClient(clientId) {
  const client = crmClients.find(item => String(item.id) === String(clientId));
  const form = document.getElementById("customerOrderForm");
  if (!form || !client) return;
  form.elements.nom.value = client.nom || "";
  form.elements.prenom.value = client.prenom || "";
  form.elements.telephone.value = client.telephone || "";
  form.elements.codePostal.value = client.codePostal || "";
  form.elements.adresse.value = client.rue || "";
  form.elements.ville.value = client.ville || "";
  form.elements.email.value = client.email || "";
}

async function submitCustomerOrder(form) {
  const lines = Array.from(customerCart.values());
  if (!lines.length) {
    notify("Ajoute au moins un produit.", "warning");
    return;
  }
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.orderType === "planifiee" && !data.deliveryDate) {
    notify("Choisis une date de livraison pour une commande planifiée.", "warning");
    return;
  }
  const endpoint = data.orderType === "planifiee" ? "/api/planned-orders" : "/api/customer-orders";
  await apiFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: data.clientId,
      client: data,
      products: lines,
      notes: data.notes,
      orderType: data.orderType,
      deliveryDate: data.deliveryDate
    })
  });
  customerCart.clear();
  form.reset();
  await loadData();
  notify(data.orderType === "planifiee" ? "Commande planifiée créée." : "Commande client validée.", "success");
  showTab(data.orderType === "planifiee" ? "commandes-planifiees" : "commandes-jour");
}

// Le jour des commandes terrain que charge loadData. Son champ vivait dans
// l'ancien ecran « Commandes du jour », retire le 23/09 : le jour choisi par
// l'ecran Commandes (#cmdJour) filtre la liste chargee, pas cette requete.
function getTodayOrdersDate() {
  return getTodayDateInput();
}

// Confirmer / Annuler une planifiee : les gestes du detail de l'ecran
// Commandes (cmd-confirmer, cmd-annuler).
async function confirmPlannedOrder(orderId) {
  await apiFetch(`/api/planned-orders/${encodeURIComponent(orderId)}/confirm`, { method: "POST" });
  await loadData();
  notify("Commande confirmée et envoyée en préparation.", "success");
}

async function cancelPlannedOrder(orderId) {
  await apiFetch(`/api/planned-orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "annulee" })
  });
  await loadData();
  notify("Commande planifiée annulée.", "success");
}

function renderExports() {
  const summary = document.getElementById("exportsSummary");
  const list = document.getElementById("exportsList");
  if (summary) summary.textContent = `${orders.length} commande${orders.length > 1 ? "s" : ""}`;
  if (!list) return;
  const annex = orders.filter(order => order.orderType === "annexe" || order.source === "commande_annexe").length;
  list.innerHTML = `
    <article class="item status-neutral">
      <div class="item-header">
        <div>
          <h4>Commandes annexes</h4>
          <p>${escapeHtml(annex)} commande${annex > 1 ? "s" : ""} disponible${annex > 1 ? "s" : ""}</p>
        </div>
        <span class="pill pill-blue">.xlsx</span>
      </div>
    </article>
    <article class="item status-ok">
      <div class="item-header">
        <div>
          <h4>Commandes planifiées</h4>
          <p>${escapeHtml(plannedOrders.length)} commande${plannedOrders.length > 1 ? "s" : ""}</p>
        </div>
        <span class="pill pill-ok">Excel</span>
      </div>
    </article>
  `;
}

function downloadOrdersExport(type) {
  const url = `/api/exports/commandes-annexes.xlsx?type=${encodeURIComponent(type)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  notify("Export Excel lancé.", "success");
}

function renderStatistics() {
  const kpis = document.getElementById("statsKpis");
  if (!kpis || !statistics) return;
  const items = [
    { label: "CA livré du jour", value: formatMoney(statistics.today?.revenue), hint: `${statistics.today?.orders || 0} commande(s)`, tone: "success" },
    { label: "CA livré de la semaine", value: formatMoney(statistics.week?.revenue), hint: formatEvolution(statistics.week?.evolution), tone: getEvolutionTone(statistics.week?.evolution) },
    { label: "CA livré du mois", value: formatMoney(statistics.month?.revenue), hint: `${statistics.month?.orders || 0} commande(s) - ${formatEvolution(statistics.month?.evolution)}`, tone: getEvolutionTone(statistics.month?.evolution) },
    { label: "Panier moyen", value: formatMoney(statistics.averageBasket), hint: "Commandes livrées, toutes périodes", tone: "info" },
    { label: "Nouveaux clients", value: statistics.newClientsMonth || 0, hint: "Ce mois-ci", tone: "warning" },
    { label: "Prospects convertis", value: statistics.convertedProspectsMonth || 0, hint: "Ce mois-ci", tone: "success" }
  ];
  // Ni point colore dans le coin ni bandeau d'evolution au-dessus (ecrans sans
  // planche, 23/09) : le point etait un code couleur sans legende, et le
  // bandeau repetait les deux evolutions des tuiles sans dire laquelle etait
  // la semaine. Chaque evolution se lit UNE fois, dans sa tuile.
  kpis.innerHTML = items.map(item => `
    <article class="stat-tile stat-tile-${escapeAttribute(item.tone)}">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.hint)}</small>
    </article>
  `).join("");

  renderBarChart("salesChart", statistics.salesByDay || []);
  renderRankList("topProductsChart", statistics.topProducts || [], "quantity");
  renderRankList("topClientsChart", statistics.topClients || [], "total");
}

function getEvolutionTone(evolution = {}) {
  if (evolution.label === "baisse") return "danger";
  if (evolution.label === "progression") return "success";
  return "info";
}

function formatEvolution(evolution = {}) {
  if (!evolution.label) return "Stable";
  const sign = Number(evolution.percent) > 0 ? "+" : "";
  return `${evolution.label} ${sign}${evolution.percent || 0}%`;
}

function renderBarChart(id, rows) {
  const container = document.getElementById(id);
  if (!container) return;
  const max = Math.max(1, ...rows.map(row => Number(row.total) || 0));
  // Audit UI 2026-07 : le label monetaire par barre (<em>) se cassait sur
  // plusieurs lignes et devenait illisible (colonnes de ~20px). On le retire
  // (la valeur reste dans le tooltip title) et la hauteur devient strictement
  // proportionnelle (plancher 3% au lieu de 12% qui aplatissait les ecarts).
  // Le rendu de l'histogramme du tableau de bord : la derniere barre (le
  // serveur finit la serie sur aujourd'hui) est le jour courant, et
  // l'etiquette ne garde que le jour du mois -- « 09-10 » se cassait en
  // « 09- / 10 » sous une colonne de 22 px. La date entiere reste dans le nom
  // accessible et l'infobulle.
  container.innerHTML = rows.map((row, index) => {
    const total = Number(row.total) || 0;
    const height = total > 0 ? Math.max(3, total / max * 100) : 2;
    const label = `${row.date} : ${formatMoney(row.total)}`;
    const courant = index === rows.length - 1;
    const jour = String(Number(String(row.date).slice(8, 10)) || String(row.date).slice(5));
    return `
    <div class="bar-item${total > 0 ? " is-active" : ""}${courant ? " bar-courant" : ""}" title="${escapeAttribute(label)}" role="img" aria-label="${escapeAttribute(label)}">
      <span style="height:${height}%"></span>
      <small>${escapeHtml(jour)}</small>
    </div>
  `;
  }).join("");
}

function renderRankList(id, rows, mode) {
  const container = document.getElementById(id);
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = emptyState("Aucune donnée", "Les ventes validées alimenteront ce graphique.");
    return;
  }
  const max = Math.max(1, ...rows.map(row => Number(mode === "total" ? row.total : row.quantity) || 0));
  container.innerHTML = rows.map((row, index) => `
    <div class="rank-row">
      <span>${index + 1}</span>
      <strong>${escapeHtml(row.name || row.clientName || "Client")}</strong>
      <em>${mode === "total" ? formatMoney(row.total) : `${escapeHtml(row.quantity)} vendu(s)`}</em>
      <i style="width:${Math.max(8, (Number(mode === "total" ? row.total : row.quantity) || 0) / max * 100)}%"></i>
    </div>
  `).join("");
}

function renderStock() {
  const container = document.getElementById("stockList");
  if (!container) return;

  container.innerHTML = "";
  renderStockRecommande();
  renderStockCategories();
  majSousTitreStock();
  const entete = document.getElementById("stkEnteteProduit");
  if (entete) {
    entete.textContent = stockFilter.category === "all"
      ? "Produit"
      : `Produit · ${stockFilter.category || "Sans catégorie"}`;
  }

  if (!stock.length) {
    container.innerHTML = emptyState("Aucun stock chargé", "Importe un fichier stock pour initialiser le catalogue.", { libelle: "Importer le stock", onglet: "journee" });
    return;
  }

  const filtered = stockAPlat() ? ordonnerAPlat(getFilteredStock()) : getFilteredStock();

  if (!filtered.length) {
    container.innerHTML = emptyState("Aucun produit trouvé", "Modifie la recherche ou le filtre de statut.");
    return;
  }

  filtered.forEach(product => {
    container.appendChild(creerLigneStock(product));
  });
}

// La cle de categorie d'un produit, telle que le filtre la compare.
function categorieDuProduit(product) {
  return String(product.category || product.type || "");
}

// Le stock est « a plat » quand ses produits n'ont aucune categorie, ou tous
// la meme : il n'y a rien a trier (planche 10a).
function stockAPlat() {
  return stock.length > 0 && new Set(stock.map(categorieDuProduit)).size <= 1;
}

// A plat, « du plus bas au plus haut » (planche 10a) : ce qui est sous le seuil
// d'abord, puis ce qui est a renseigner (une quantite inconnue appelle aussi
// un geste), puis le reste ; dans chaque groupe, la plus petite quantite en tete.
function trierAPlat(produits) {
  const groupe = p => (sousLeSeuil(p) ? 0 : getStockLevel(p).status === "a_renseigner" ? 1 : 2);
  const quantite = p => Number(p.quantityAvailable ?? getProductQuantity(p) ?? 0) || 0;
  return [...produits].sort((a, b) => groupe(a) - groupe(b) || quantite(a) - quantite(b)
    || String(getProductName(a)).localeCompare(getProductName(b), "fr"));
}

// L'ordre a plat est FIGE tant qu'on reste sur l'ecran. Chaque −/+ et chaque
// seuil rechargent la liste : retriee sur la quantite du moment, la ligne
// qu'on touchait changeait de place sous le doigt, et le tap suivant, au meme
// endroit, modifiait le stock d'un AUTRE produit (relecture du 23/09 : Gants
// a 2, six « + », il passe sous Desinfectant a 7, le septieme tombe sur
// Desinfectant). L'ordre se refait en rouvrant l'ecran (showTab), ou quand un
// produit inconnu arrive (un import) ; un produit neuf n'y a pas de rang.
let ordreAPlat = null;

function ordonnerAPlat(produits) {
  if (!ordreAPlat || stock.some(p => !ordreAPlat.has(String(p.id)))) {
    ordreAPlat = new Map(trierAPlat(stock).map((p, rang) => [String(p.id), rang]));
  }
  return [...produits].sort((a, b) => ordreAPlat.get(String(a.id)) - ordreAPlat.get(String(b.id)));
}

function sousLeSeuil(product) {
  return ["stock_faible", "rupture"].includes(getStockLevel(product).status);
}

// « 20 references · 3 sous le seuil · 5 categories » (planche 13d). La planche
// ajoute « trouvees dans le dernier import » : rien ne rattache les categories
// a un import, la provenance n'est pas ecrite.
function majSousTitreStock() {
  if (!document.getElementById("stock")?.classList.contains("active")) return;
  const n = stock.length;
  const sous = getLowStockProducts().length;
  const cles = new Set(stock.map(categorieDuProduit));
  const categories = cles.size;
  // Sans aucune categorie, « 1 categorie » comptait « Sans categorie » comme
  // une categorie. La planche 10a dit « sans catégorie ».
  const compte = categories === 1 && cles.has("")
    ? "sans catégorie"
    : `${categories} catégorie${categories > 1 ? "s" : ""}`;
  setText("pageSubtitle", n
    ? `${n} référence${n > 1 ? "s" : ""} · ${sous} sous le seuil · ${compte}`
    : "Aucun produit importé");
}

// La carte « A recommander » : ce qui est sous le seuil, le plus en retard
// d'abord. Cinq lignes au plus ; la liste complete, avec les besoins estimes,
// reste sur l'ecran « A recommander ».
function renderStockRecommande() {
  const liste = document.getElementById("stkRecoListe");
  if (!liste) return;
  const bas = getLowStockProducts()
    .map(product => {
      const quantite = product.quantityAvailable ?? getProductQuantity(product) ?? 0;
      return { product, quantite, seuil: getProductThreshold(product) };
    })
    .sort((a, b) => (a.quantite - a.seuil) - (b.quantite - b.seuil)
      || String(getProductName(a.product)).localeCompare(getProductName(b.product), "fr"));
  setText("stkRecoCompte", String(bas.length));
  const compte = document.getElementById("stkRecoCompte");
  if (compte) compte.setAttribute("aria-label", `${bas.length} produit${bas.length > 1 ? "s" : ""} sous le seuil`);
  if (!bas.length) {
    liste.innerHTML = `<p class="stk-reco-vide">Rien sous le seuil.</p>`;
    return;
  }
  liste.innerHTML = bas.slice(0, 5).map(({ product, quantite, seuil }) => `
    <div class="stk-reco-ligne">
      <span class="stk-reco-nom">${escapeHtml(getProductName(product))}</span>
      <span class="stk-reco-detail">${escapeHtml(quantite)} en stock · seuil ${escapeHtml(seuil)}</span>
    </div>`).join("");
}

// Les tuiles de categorie : la somme en stock, le nom, et le nombre sous le
// seuil (en alerte) ou, s'il n'y en a pas, le nombre de references. Jusqu'a
// douze, une grille ; au-dela, une liste (passation : « lignes au-dela »).
function renderStockCategories() {
  const bloc = document.getElementById("stkCategories");
  if (!bloc) return;
  const parCategorie = new Map();
  stock.forEach(product => {
    const cle = categorieDuProduit(product);
    const c = parCategorie.get(cle) || { cle, total: 0, references: 0, sous: 0 };
    c.total += Number(product.quantityAvailable ?? getProductQuantity(product) ?? 0) || 0;
    c.references += 1;
    if (sousLeSeuil(product)) c.sous += 1;
    parCategorie.set(cle, c);
  });
  const categories = [...parCategorie.values()]
    .sort((a, b) => (a.cle ? 0 : 1) - (b.cle ? 0 : 1) || a.cle.localeCompare(b.cle, "fr"));
  if (stockFilter.category !== "all" && !parCategorie.has(stockFilter.category)) stockFilter.category = "all";
  bloc.classList.toggle("stk-categories--liste", categories.length > 12);
  // A PLAT (planche 10a) : sans categorie, ou avec une seule, une tuile ne
  // trie rien -- elle montrait « Sans categorie · 200 » au-dessus d'un tableau
  // qui disait deja tout. La carte dit ce qui manque, le tableau suit.
  const aPlat = stockAPlat();
  bloc.hidden = !categories.length || aPlat;
  const tete = document.getElementById("stkCategoriesTete");
  if (tete) tete.hidden = bloc.hidden;
  setText("stkCategoriesCompte", `${categories.length} catégorie${categories.length > 1 ? "s" : ""}`);
  const carte = document.getElementById("stkAPlat");
  if (carte) {
    carte.hidden = !aPlat;
    const seule = categories[0]?.cle;
    setText("stkAPlatTitre", seule ? `Une seule catégorie : ${seule}` : "Pas de catégories dans ce fichier");
    setText("stkAPlatDetail", seule
      ? "Tous les produits sont dans la même catégorie : des tuiles ne trieraient rien. Ils sont affichés à plat, sous le seuil en premier."
      // L'import ne distingue pas une colonne ABSENTE d'une colonne VIDE (le
      // serveur lit "" dans les deux cas) : la carte dit ce qui se voit -- aucun
      // produit n'a de categorie --, pas une cause qu'elle ne connait pas.
      : "Aucun produit de ce fichier n’a de catégorie. Ils sont affichés à plat, sous le seuil en premier. Remplissez la colonne « Catégorie » de votre fichier (ajoutez-la si elle manque) et réimportez-le pour retrouver les tuiles.");
  }
  if (aPlat) {
    bloc.innerHTML = "";
    return;
  }
  bloc.innerHTML = categories.map((c, i) => {
    const nom = c.cle || "Sans catégorie";
    const ligne = c.sous
      ? `<span class="stk-tuile-sous stk-alerte">${c.sous} sous le seuil</span>`
      : `<span class="stk-tuile-sous">${c.references} référence${c.references > 1 ? "s" : ""}</span>`;
    const choisie = stockFilter.category === c.cle;
    return `<button class="stk-tuile${choisie ? " stk-tuile--choisie" : ""}" type="button" data-stk-categorie="${escapeAttribute(c.cle)}" aria-pressed="${choisie}">
      <span class="stk-tuile-pastille stk-tuile-pastille--${i % 2 ? "tiede" : "froid"}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="${ICONE_CATEGORIE}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path></svg></span>
      <span class="stk-tuile-total">${escapeHtml(c.total)}</span>
      <span class="stk-tuile-texte"><span class="stk-tuile-nom">${escapeHtml(nom)}</span>${ligne}</span>
    </button>`;
  }).join("");
}

// Une icone pour toutes : les categories sont LIBRES (lues dans le fichier),
// aucune table ne dit quel dessin va a quel nom. La planche en invente cinq.
const ICONE_CATEGORIE = "M12 3 3 8v8l9 5 9-5V8z";

// Une ligne du tableau (planche 13d). La saisie directe du stock et l'edition
// du seuil sont GARDEES -- la planche les montre en lecture seule, mais ce sont
// les seuls chemins de l'application pour les poser. Les identifiants sont
// propres a l'ecran : l'ecran « produits » rend les memes produits.
function creerLigneStock(product) {
  const level = getStockLevel(product);
  const quantite = product.quantityAvailable ?? getProductQuantity(product);
  const reserve = product.quantityReserved ?? 0;
  const seuil = getProductThreshold(product);
  const id = escapeAttribute(product.id);
  const nom = getProductName(product);
  const enAlerte = ["stock_faible", "rupture"].includes(level.status);
  const ligne = document.createElement("div");
  ligne.className = `stk-ligne${enAlerte ? " stk-ligne--alerte" : ""}`;
  ligne.innerHTML = `
    <span class="stk-nom">${escapeHtml(nom)}${level.status === "a_renseigner" ? ` <span class="stk-a-renseigner">À renseigner</span>` : ""}</span>
    <span class="stk-code">${escapeHtml(product.code || product.sku || "-")}</span>
    <span class="stk-reserve">${escapeHtml(reserve)} sur commandes</span>
    <span class="stk-droite"><label class="sr-only" for="stk-seuil-${id}">Seuil de ${escapeHtml(nom)}</label><input class="stk-saisie stk-saisie--seuil" id="stk-seuil-${id}" data-stock-threshold-input data-product-id="${id}" type="number" min="0" step="1" inputmode="numeric" value="${escapeAttribute(seuil)}"></span>
    <span class="stk-droite"><label class="sr-only" for="stk-qte-${id}">Stock de ${escapeHtml(nom)}${enAlerte ? ", sous le seuil" : ""}</label><input class="stk-saisie stk-saisie--stock" id="stk-qte-${id}" data-stock-input data-product-id="${id}" type="number" min="0" step="1" inputmode="numeric" value="${escapeAttribute(quantite === null ? "" : quantite)}" placeholder="—"></span>
    <span class="stk-ajuster">
      <button class="stk-pas" type="button" data-product-id="${id}" data-stock-delta="-1" aria-label="Retirer 1 unité de ${escapeAttribute(nom)}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg></button>
      <button class="stk-pas stk-pas--plus" type="button" data-product-id="${id}" data-stock-delta="1" aria-label="Ajouter 1 unité à ${escapeAttribute(nom)}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg></button>
    </span>`;
  return ligne;
}

function getFilteredStock() {
  const query = normalizeTextKey(stockFilter.query);
  const status = stockFilter.status || "all";
  // "" est une categorie (« Sans categorie »), pas « toutes » : pas de ||.
  const category = stockFilter.category ?? "all";

  return stock.filter(product => {
    const haystack = normalizeTextKey([
      getProductName(product),
      product.code,
      product.sku,
      product.reference,
      product.category,
      product.type
    ].join(" "));
    if (query && !haystack.includes(query)) return false;
    if (status !== "all" && getStockLevel(product).status !== status) return false;
    if (category !== "all" && String(product.category || product.type || "") !== category) return false;
    return true;
  });
}

function createStockCard(product) {
  const level = getStockLevel(product);
  const quantity = product.quantityAvailable ?? getProductQuantity(product);
  const quantityValue = quantity === null ? "" : quantity;
  const needed = product.quantityNeeded ?? getNeededQuantityForProduct(product);
  const reserved = product.quantityReserved ?? 0;
  const total = product.quantityTotal ?? (quantity === null ? null : quantity + reserved);
  const threshold = getProductThreshold(product);
  const productId = escapeAttribute(product.id);

  const div = document.createElement("article");
  div.className = `item ${level.className}`;

  div.innerHTML = `
    <div class="item-header">
      <div>
        <h4>${escapeHtml(getProductName(product))}</h4>
        <p>Code : ${escapeHtml(product.code || product.sku || "-")} · Catégorie : ${escapeHtml(product.category || product.type || "-")}</p>
      </div>
      <span class="pill ${level.pill}">${escapeHtml(level.label)}</span>
    </div>
    <div class="stock-kpis">
      <span><strong>${quantity === null ? "À renseigner" : escapeHtml(quantity)}</strong><small>Disponible</small></span>
      <span><strong>${escapeHtml(reserved)}</strong><small>Réservé</small></span>
      <span><strong>${escapeHtml(needed)}</strong><small>Nécessaire</small></span>
      <span><strong>${total === null ? "-" : escapeHtml(total)}</strong><small>Total</small></span>
      <span><strong>${escapeHtml(threshold)}</strong><small>Seuil</small></span>
    </div>

    <div class="stock-controls">
      <button class="button secondary compact stepper-dec" type="button" data-product-id="${productId}" data-stock-delta="-5" aria-label="Retirer 5 unités de ${escapeAttribute(getProductName(product))}">-5</button>
      <button class="button secondary compact stepper-dec" type="button" data-product-id="${productId}" data-stock-delta="-1" aria-label="Retirer 1 unité de ${escapeAttribute(getProductName(product))}">-1</button>
      <label class="sr-only" for="stock-${productId}">Quantité ${escapeHtml(getProductName(product))}</label>
      <input id="stock-${productId}" data-stock-input data-product-id="${productId}" type="number" min="0" step="1" value="${escapeAttribute(quantityValue)}">
      <button class="button secondary compact stepper-inc" type="button" data-product-id="${productId}" data-stock-delta="1" aria-label="Ajouter 1 unité à ${escapeAttribute(getProductName(product))}">+1</button>
      <button class="button secondary compact stepper-inc" type="button" data-product-id="${productId}" data-stock-delta="5" aria-label="Ajouter 5 unités à ${escapeAttribute(getProductName(product))}">+5</button>
    </div>
    <div class="stock-threshold-control">
      <label for="stock-threshold-${productId}">Seuil minimum</label>
      <input id="stock-threshold-${productId}" data-stock-threshold-input data-product-id="${productId}" type="number" min="0" step="1" value="${escapeAttribute(threshold)}">
    </div>
  `;

  return div;
}

function renderStockMovements() {
  const container = document.getElementById("stockMovementList");
  if (!container) return;

  const movements = stockMovements.slice(0, 12);
  if (!movements.length) {
    container.innerHTML = emptyState("Aucun mouvement", "Les ajustements manuels apparaîtront ici.");
    return;
  }

  container.innerHTML = "";
  movements.forEach(movement => {
    const item = document.createElement("article");
    item.className = `item ${movement.type === "entree" ? "status-ok" : "status-warning"}`;
    item.innerHTML = `
      <div class="item-header">
        <div>
          <h4>${escapeHtml(movement.productName || "Produit")}</h4>
          <p>${escapeHtml(movement.reason || "Ajustement manuel")} · ${escapeHtml(formatDate(movement.createdAt))}</p>
        </div>
        <span class="pill ${movement.type === "entree" ? "pill-ok" : "pill-warning"}">
          ${movement.type === "entree" ? "+" : "-"}${escapeHtml(movement.quantity || 0)}
        </span>
      </div>
    `;
    container.appendChild(item);
  });
}

async function changeStock(productId, delta) {
  const product = stock.find(p => String(p.id) === String(productId));
  if (!product) return;

  const currentQuantity = getProductQuantity(product) ?? 0;
  const nextQuantity = Math.max(0, currentQuantity + delta);
  await setStock(productId, nextQuantity);
}

async function setStock(productId, value) {
  // Un champ VIDE n'est pas un zero : le vider mettait le produit en rupture.
  if (String(value ?? "").trim() === "") {
    notify("Quantité vide : rien n'a été changé.", "warning");
    await loadData();
    return;
  }
  const quantity = Number(String(value).replace(",", "."));

  if (!Number.isFinite(quantity) || quantity < 0) {
    notify("Quantité invalide.", "warning");
    return;
  }

  await apiFetch(`/api/stock/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      quantite: quantity,
      reason: "Ajustement manuel depuis l'interface"
    })
  });

  await loadData();
  notify("Stock mis à jour.", "success");
}

async function setStockThreshold(productId, value) {
  const raw = String(value ?? "").trim();
  const threshold = Number(raw);

  if (!raw || /[,.]/.test(raw) || !Number.isFinite(threshold) || !Number.isInteger(threshold) || threshold < 0) {
    notify("Seuil minimum invalide.", "warning");
    return;
  }

  await apiFetch(`/api/stock/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      alertThreshold: threshold
    })
  });

  await loadData();
  notify("Seuil minimum mis a jour.", "success");
}

// Audit UI 2026-07 : recherche (client/numero) + filtre secteur sur la
// preparation, pour ne plus scroller tout le backlog.
function matchesPreparationFilter(order) {
  const q = preparationFilter.query.trim().toLowerCase();
  const matchQuery = !q
    || (order.clientName || "").toLowerCase().includes(q)
    || (order.numero || "").toLowerCase().includes(q)
    || (order.city || "").toLowerCase().includes(q);
  const matchSector = preparationFilter.sector === "all"
    || (order.sector || "") === preparationFilter.sector;
  return matchQuery && matchSector;
}

function renderPreparationFilterOptions() {
  const conteneur = document.getElementById("preparationSectorPills");
  if (!conteneur) return;
  const sectors = Array.from(new Set(orders.map(order => order.sector).filter(Boolean))).sort();
  if (preparationFilter.sector !== "all" && !sectors.includes(preparationFilter.sector)) preparationFilter.sector = "all";
  const current = preparationFilter.sector;
  const pilule = (valeur, libelle) =>
    `<button class="button secondary compact filtre-pilule${valeur === current ? " active-filter" : ""}" type="button" data-sector="${escapeAttribute(valeur)}" aria-pressed="${valeur === current}">${escapeHtml(libelle)}</button>`;
  // Le secteur CHOISI passe en tete, juste apres « Tous » : la rangee se
  // replie a deux rangs, et un filtre actif relegue au cinquieme rang
  // disparaitrait -- on ne cache jamais ce que l'utilisateur a choisi.
  // (Premiere version : une garde qui depliait la rangee. Elle ne servait
  // jamais -- apres un choix, la rangee etait deja depliee -- et une mutation
  // l'a montre en survivant.)
  const ordonnes = current === "all" ? sectors : [current, ...sectors.filter(sector => sector !== current)];
  conteneur.innerHTML = pilule("all", "Tous") + ordonnes.map(sector => pilule(sector, formatSectorLabel(sector))).join("");
  ajusterRepliDesSecteurs();
}

/**
 * « Pilules de filtre : repliables plutot que debordantes » (charte §4).
 *
 * Mesure du 19/09 avec dix secteurs : la rangee prenait CINQ rangs, 272 px
 * sur un ecran de 844 -- un tiers de l'ecran pour des filtres. Elle ne
 * debordait pas horizontalement (elle passe a la ligne), mais elle n'etait
 * pas repliable non plus.
 *
 * Le bouton n'apparait QUE si la rangee depasse vraiment son plafond : on le
 * MESURE dans la page (scrollHeight vs clientHeight), on ne le deduit pas du
 * nombre de secteurs -- la largeur d'un libelle decide autant que leur compte.
 */
function ajusterRepliDesSecteurs() {
  const conteneur = document.getElementById("preparationSectorPills");
  const bouton = document.getElementById("preparationSectorPlus");
  if (!conteneur || !bouton) return;
  const deplie = conteneur.classList.contains("filtre-pilules--depliee");
  // On mesure TOUJOURS a l'etat replie : deplie, il n'y a plus rien a voir.
  conteneur.classList.remove("filtre-pilules--depliee");
  const depasse = conteneur.scrollHeight - conteneur.clientHeight > 1;
  conteneur.classList.toggle("filtre-pilules--depliee", deplie);
  bouton.hidden = !depasse;
  const ouvert = conteneur.classList.contains("filtre-pilules--depliee");
  bouton.setAttribute("aria-expanded", String(ouvert));
  bouton.textContent = ouvert ? "Moins de secteurs" : "Tous les secteurs";
}

/*
 * PREPARATION AU TELEPHONE -- planches 7a (la liste) et 7b (une commande).
 * Sous 820 px, la ou la barre basse remplace la barre laterale. Au bureau,
 * rien ne change : les groupes et le sheet restent (aucune planche bureau
 * pour cet ecran).
 */
const PREPARATION_MOBILE = window.matchMedia("(max-width: 820px)");
// Le minuteur de frappe de la recherche (bindUi) : au niveau du module pour
// que refermer la loupe puisse l'annuler.
let preparationSearchTimer = null;

function preparationEnListeUnique() {
  return PREPARATION_MOBILE.matches;
}

/**
 * Le mot de STATUT d'une commande a preparer, celui de la planche 7a et de la
 * charte §4 (En preparation, A verifier, Pret livraison), plus « Bloquee ».
 * Au bureau, la ligne garde le mot de l'ETAPE (A faire, En cours...) : le
 * titre de son groupe dit deja le reste.
 */
function motDeStatutPreparation(order) {
  if (["importe", "stock_a_verifier"].includes(order.status) && !order.canPrepare) return { cle: "bloquee", mot: "Bloquée", rang: 0 };
  if (order.status === "en_preparation") return { cle: "en-preparation", mot: "En préparation", rang: 1 };
  if (order.status === "stock_a_verifier") return { cle: "a-verifier", mot: "À vérifier", rang: 2 };
  if (order.status === "pret_livraison") return { cle: "pret", mot: "Prêt livraison", rang: 3 };
  return { cle: "a-preparer", mot: "À préparer", rang: 2 };
}

/**
 * Le tri de la planche 7a : bloquees d'abord, puis en preparation, a
 * verifier (et a preparer), pret livraison ; a statut egal, par secteur puis
 * par numero de bon. Recalcule a chaque rendu : une commande qui se debloque
 * remonte au rendu suivant.
 */
function comparerPourLaPreparation(a, b) {
  return motDeStatutPreparation(a).rang - motDeStatutPreparation(b).rang
    || String(a.sector || "").localeCompare(String(b.sector || ""), "fr")
    || String(a.numero || "").localeCompare(String(b.numero || ""), "fr", { numeric: true })
    || String(a.clientName || "").localeCompare(String(b.clientName || ""), "fr");
}

/**
 * Les filtres dans l'en-tete vert au telephone (planche 7a), dans le panneau
 * au bureau. On DEPLACE le bloc (memes elements, memes identifiants, memes
 * ecouteurs) : deux copies auraient deux etats a synchroniser.
 */
function placerFiltresPreparation() {
  const filtres = document.getElementById("preparationFiltres");
  const fente = document.getElementById("enteteActions");
  const panneau = document.querySelector("#preparation .panel");
  const liste = document.getElementById("preparationList");
  if (!filtres || !fente || !panneau || !liste) return;
  if (preparationEnListeUnique()) {
    if (filtres.parentElement !== fente) fente.appendChild(filtres);
    filtres.hidden = !document.getElementById("preparation")?.classList.contains("active");
    // Une recherche tapee au bureau survit au passage sous 820 px : la loupe
    // la montre depliee (sans focus : une rotation n'ouvre pas le clavier).
    // Repliee, elle filtrerait la liste sans rien en dire.
    if (document.getElementById("preparationSearch")?.value) basculerRecherchePreparation(true, { focus: false });
  } else {
    if (filtres.parentElement !== panneau) panneau.insertBefore(filtres, liste);
    filtres.hidden = false;
  }
  ajusterRepliDesSecteurs();
}

/** La loupe de la planche 7a : la recherche se deplie a la demande. */
function basculerRecherchePreparation(ouvrir, { focus = true } = {}) {
  const filtres = document.getElementById("preparationFiltres");
  const loupe = document.getElementById("preparationLoupe");
  const champ = document.getElementById("preparationSearch");
  if (!filtres || !loupe || !champ) return;
  const ouverte = typeof ouvrir === "boolean" ? ouvrir : !filtres.classList.contains("prep-filtres--recherche");
  filtres.classList.toggle("prep-filtres--recherche", ouverte);
  loupe.setAttribute("aria-expanded", String(ouverte));
  if (ouverte) {
    if (focus) champ.focus();
  } else if (champ.value || preparationFilter.query) {
    // Refermer la loupe efface la recherche : un filtre qu'on ne voit plus
    // cacherait des commandes sans le dire. La frappe encore en attente
    // (200 ms) est annulee, sinon elle reappliquerait le filtre efface.
    clearTimeout(preparationSearchTimer);
    champ.value = "";
    preparationFilter.query = "";
    renderPreparation();
  }
}

// Le sous-titre de la planche 7a : « 3 commandes a preparer ». Au telephone
// seulement : au bureau (aucune planche, aucune decision), le sous-titre reste
// celui de tabs.js.
function majSousTitrePreparation() {
  if (!document.getElementById("preparation")?.classList.contains("active")) return;
  if (!preparationEnListeUnique()) {
    setText("pageSubtitle", titles.preparation.subtitle);
    return;
  }
  const restantes = (orders || []).filter(order => ["importe", "stock_a_verifier", "en_preparation"].includes(order.status)).length;
  setText("pageSubtitle", restantes
    ? `${restantes} commande${restantes > 1 ? "s" : ""} à préparer`
    : "Aucune commande à préparer");
}

// Franchir 820 px (rotation, fenetre redimensionnee) : la liste change de
// forme et les filtres changent de place. Garde « legacy Safari » (< 14, sans
// MediaQueryList.addEventListener) comme watchSystemColorScheme : au premier
// niveau du module, l'appel nu leverait et l'application ne demarrerait pas.
function surFranchissementPreparation() {
  closeCommandeDetail();
  placerFiltresPreparation();
  renderPreparation();
}
if (PREPARATION_MOBILE.addEventListener) PREPARATION_MOBILE.addEventListener("change", surFranchissementPreparation);
else if (PREPARATION_MOBILE.addListener) PREPARATION_MOBILE.addListener(surFranchissementPreparation);

function renderPreparation() {
  renderPreparationStats();
  renderPreparationFilterOptions();
  majSousTitrePreparation();

  const container = document.getElementById("preparationList");
  if (!container) return;

  container.innerHTML = "";

  if (!orders.length) {
    container.innerHTML = emptyState("Aucune commande à préparer", "Importe les dossiers du jour pour générer la préparation.", { libelle: "Importer les dossiers", onglet: "journee" });
    return;
  }

  const groups = [
    {
      title: "À préparer",
      hint: "Stock disponible, prêt à lancer",
      orders: orders.filter(order => ["importe", "stock_a_verifier"].includes(order.status) && order.canPrepare)
    },
    {
      title: "En cours",
      hint: "Stock réservé, préparation à terminer",
      orders: orders.filter(order => order.status === "en_preparation")
    },
    {
      title: "Prêtes livraison",
      hint: "Disponibles dans le mode livraison",
      orders: orders.filter(order => order.status === "pret_livraison")
    },
    {
      title: "Bloquées stock",
      hint: "Stock insuffisant ou non renseigné",
      orders: orders.filter(order => ["importe", "stock_a_verifier"].includes(order.status) && !order.canPrepare)
    }
  ];

  groups.forEach(group => { group.orders = group.orders.filter(matchesPreparationFilter); });

  const hasFilter = preparationFilter.query.trim() || preparationFilter.sector !== "all";
  if (hasFilter && !groups.some(group => group.orders.length)) {
    container.innerHTML = emptyState("Aucune commande ne correspond", "Ajuste la recherche ou le secteur.");
    return;
  }

  // Au telephone (planche 7a, decision de Thomas du 23/09) : UNE liste, sans
  // groupes, et chaque ligne dit son statut en toutes lettres -- le titre de
  // groupe qui le disait n'est plus la.
  if (preparationEnListeUnique()) {
    const toutes = groups.flatMap(group => group.orders).sort(comparerPourLaPreparation);
    const liste = document.createElement("div");
    liste.className = "prep-liste";
    toutes.forEach(order => liste.appendChild(createPreparationRow(order, { unique: true })));
    container.appendChild(liste);
    return;
  }

  // Planche Preparation.png : UNE LIGNE PAR COMMANDE. Les quatre colonnes
  // deviennent quatre sections empilees ; une section vide ne s'affiche pas
  // (avant : quatre « Rien ici », un par colonne).
  groups.forEach(group => {
    if (!group.orders.length) return;
    const section = document.createElement("section");
    section.className = "commandes-groupe";
    section.innerHTML = `
      <h4 class="commandes-groupe-titre">${escapeHtml(group.title)} <span class="status-chip">${group.orders.length}</span></h4>
    `;
    group.orders.forEach(order => section.appendChild(createPreparationRow(order)));
    container.appendChild(section);
  });
}

/**
 * L'etape de preparation d'une commande, avec le mot de la planche :
 * A faire · En cours · Prete · Bloquee. Ce sont les mots de l'ETAPE, pas
 * ceux du statut (Importee, Pret livraison...) qui restent dans le detail.
 */
function etapeDePreparation(order) {
  if (order.status === "pret_livraison") return { cle: "prete", mot: "Prête" };
  if (order.status === "en_preparation") return { cle: "en-cours", mot: "En cours" };
  if (["importe", "stock_a_verifier"].includes(order.status) && !order.canPrepare) return { cle: "bloquee", mot: "Bloquée" };
  return { cle: "a-faire", mot: "À faire" };
}

/** Ce qui manque, en un mot, pour une commande bloquee -- comme « Il manque 2 articles ». */
function detailDeBlocage(order) {
  const manquants = (order.stockLines || []).filter(ligne => ligne.status !== "ok").length;
  if (manquants === 1) return "Il manque 1 article";
  if (manquants > 1) return `Il manque ${manquants} articles`;
  return formatStockStatus(order.stockStatus) || "Stock à vérifier";
}

function createPreparationRow(order, { unique = false } = {}) {
  if (unique) return createPreparationRowMobile(order);
  const etape = etapeDePreparation(order);
  const lignes = (order.products || []).length;
  const articles = lignes === 1 ? "1 article" : `${lignes} articles`;
  const ville = order.city ? formatSectorLabel(order.city) : (order.sector ? formatSectorLabel(order.sector) : "");
  // Quatre informations : l'etat (disque), le nom, le detail, le badge. Pour
  // une commande bloquee, le manque REMPLACE le detail, comme sur la planche.
  const detail = etape.cle === "bloquee"
    ? `<span class="commande-ligne-alerte">${escapeHtml(detailDeBlocage(order))}</span>`
    : `<span>${escapeHtml([ville, articles].filter(Boolean).join(" · "))}</span>`;
  const row = document.createElement("article");
  row.className = `commande-ligne commande-ligne--${etape.cle}`;
  row.innerHTML = `
    <button class="commande-ligne-main" type="button" data-action="open-commande-detail" data-order-id="${escapeAttribute(order.id)}" aria-label="Ouvrir ${escapeAttribute(order.clientName)}, ${escapeAttribute(etape.mot)}">
      <span class="etat-commande etat-commande--${etape.cle}" aria-hidden="true"></span>
      <span class="commande-ligne-corps">
        <strong>${escapeHtml(order.clientName)}</strong>
        ${detail}
      </span>
      <span class="pill ${getOrderPill(order.status)}">${escapeHtml(etape.mot)}</span>
    </button>
  `;
  return row;
}

/**
 * La ligne de la planche 7a : un point de couleur, le nom, « ville · n
 * articles » (ou le manque, en alerte), et le mot de statut. Quatre
 * informations. « n articles » compte les ARTICLES (les quantites), comme le
 * resume au-dessus -- pas les lignes de produit.
 */
/**
 * Le manque d'une bloquee en ARTICLES, comme la planche (« Il manque 2
 * articles » ; 7b : « 2 en stock, 2 manquants ») : la somme des quantites
 * manquantes, pas le nombre de produits. Un stock non renseigne n'est pas un
 * manque : il se dit tel quel.
 */
function manqueDeLaCommande(order) {
  const manquants = (order.stockLines || [])
    .filter(ligne => ligne.status === "missing")
    .reduce((somme, ligne) => somme + Math.max(0, (Number(ligne.required) || 0) - Math.max(0, Number(ligne.available) || 0)), 0);
  if (manquants === 1) return "Il manque 1 article";
  if (manquants > 1) return `Il manque ${manquants} articles`;
  if ((order.stockLines || []).some(ligne => ligne.status === "unknown")) return "Stock non renseigné";
  return formatStockStatus(order.stockStatus) === "à vérifier" ? "Stock à vérifier" : `Stock ${formatStockStatus(order.stockStatus)}`;
}

function createPreparationRowMobile(order) {
  const statut = motDeStatutPreparation(order);
  const n = getOrderProductCount(order);
  const articles = n === 1 ? "1 article" : `${n} articles`;
  const ville = order.city ? formatSectorLabel(order.city) : (order.sector ? formatSectorLabel(order.sector) : "");
  const detail = statut.cle === "bloquee"
    ? `<span class="commande-ligne-alerte">${escapeHtml(manqueDeLaCommande(order))}</span>`
    : `<span>${escapeHtml([ville, articles].filter(Boolean).join(" · "))}</span>`;
  // Le « ! » de la planche sur le badge Bloquee : l'alerte voyage avec une forme.
  const icone = statut.cle === "bloquee"
    ? `<svg class="prep-badge-icone" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5"></circle><path d="M12 8v4m0 3.5v.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg>`
    : "";
  const row = document.createElement("article");
  row.className = `commande-ligne prep-ligne prep-ligne--${statut.cle}`;
  row.innerHTML = `
    <button class="commande-ligne-main" type="button" data-action="open-commande-detail" data-order-id="${escapeAttribute(order.id)}" aria-label="Ouvrir ${escapeAttribute(order.clientName)}, ${escapeAttribute(statut.mot)}">
      <span class="prep-point prep-point--${statut.cle}" aria-hidden="true"></span>
      <span class="commande-ligne-corps">
        <strong>${escapeHtml(order.clientName)}</strong>
        ${detail}
      </span>
      <span class="pill prep-badge prep-badge--${statut.cle}">${icone}${escapeHtml(statut.mot)}</span>
    </button>
  `;
  return row;
}

/** Le detail d'une commande, en sheet : l'adresse, la date, le stock, et les actions. */
function openCommandeDetail(orderId) {
  const dialogue = document.getElementById("commandeDetailDialog");
  const corps = document.getElementById("commandeDetailCorps");
  const order = orders.find(item => String(item.id) === String(orderId));
  if (!dialogue || !corps || !order || typeof dialogue.showModal !== "function") return;
  corps.innerHTML = "";
  const mobile = preparationEnListeUnique();
  // Au telephone, la page de la planche 7b ; au bureau, le sheet d'avant.
  dialogue.classList.toggle("commande-page", mobile);
  corps.appendChild(mobile ? createPreparationDetailMobile(order) : createPreparationCard(order));
  const titre = document.getElementById("commandeDetailTitre");
  if (titre) titre.textContent = order.clientName;
  remplirEnteteDetailCommande(mobile ? order : null);
  dialogue.showModal();
}

/**
 * L'en-tete vert de la planche 7b : « CMD-2026-007 · 16 septembre » au-dessus
 * du nom, puis deux puces, le secteur et le statut. Vide au bureau.
 */
function remplirEnteteDetailCommande(order) {
  const meta = document.getElementById("commandeDetailMeta");
  const puces = document.getElementById("commandeDetailPuces");
  if (!meta || !puces) return;
  if (!order) {
    meta.textContent = "";
    puces.innerHTML = "";
    return;
  }
  const date = order.dateCommande ? new Date(`${String(order.dateCommande).slice(0, 10)}T12:00:00`) : null;
  const jour = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "";
  meta.textContent = [order.numero, jour].filter(Boolean).join(" · ");
  const secteur = order.sector ? formatSectorLabel(order.sector) : (order.city ? formatSectorLabel(order.city) : "");
  puces.innerHTML = `
    ${secteur ? `<span class="commande-page-puce">${escapeHtml(secteur)}</span>` : ""}
    <span class="commande-page-puce commande-page-puce--statut">${escapeHtml(motDeStatutPreparation(order).mot)}</span>
  `;
}

/** Une ligne de produit de la planche 7b : nom, code, quantite ; le manque en clair. */
function ligneDeProduitPreparation(ligne, reservee) {
  const requis = Number(ligne.required) || 0;
  let sous = escapeHtml(ligne.code || "");
  let alerte = false;
  // Stock reserve (en preparation, prete) : le manque d'aujourd'hui ne la
  // concerne plus, ses articles sont deja mis de cote.
  if (!reservee && ligne.status === "missing") {
    const dispo = Math.max(0, Number(ligne.available) || 0);
    const manque = Math.max(0, requis - dispo);
    sous = `${dispo} en stock, ${manque} manquant${manque > 1 ? "s" : ""}`;
    alerte = true;
  } else if (!reservee && ligne.status === "unknown") {
    sous = [ligne.code, "stock non renseigné"].filter(Boolean).map(escapeHtml).join(" · ");
    alerte = true;
  }
  return `
    <li class="commande-page-produit${alerte ? " commande-page-produit--manque" : ""}">
      <span class="commande-page-produit-texte">
        <strong>${escapeHtml(ligne.nom || ligne.code || "Produit")}</strong>
        <span>${sous}</span>
      </span>
      <span class="commande-page-quantite">${escapeHtml(requis)}</span>
    </li>
  `;
}

/**
 * Le corps de la planche 7b : les produits, l'adresse, puis le geste du
 * statut en bas, sous le pouce. Un bouton desactive dit toujours pourquoi
 * (planche : « jamais un bouton gris sans explication »).
 */
function createPreparationDetailMobile(order) {
  const statut = motDeStatutPreparation(order);
  const reservee = order.stockStatus === "reserve";
  const lignes = (order.stockLines && order.stockLines.length)
    ? order.stockLines
    : (order.products || []).map(p => ({ nom: p.nom, code: p.code, required: Number(p.quantite || 1), status: "ok" }));
  const n = getOrderProductCount(order);
  const deliveryDate = order.deliveryDate || getTodayDateInput();
  const id = escapeAttribute(order.id);

  let geste = "";
  if (statut.cle === "bloquee") {
    const manque = manqueDeLaCommande(order);
    const raison = /^Il manque/.test(manque) ? `${manque} en stock pour commencer` : `${manque} : impossible de commencer`;
    geste = `
      <button class="button primary" type="button" data-action="start-preparation" data-order-id="${id}" disabled aria-describedby="commandeGesteRaison">Passer en préparation</button>
      <p id="commandeGesteRaison" class="commande-page-raison"><svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"></circle><path d="M12 8v4m0 3.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg><span>${escapeHtml(raison)}</span></p>`;
  } else if (statut.cle === "en-preparation") {
    geste = `<button class="button primary" type="button" data-action="finish-preparation" data-order-id="${id}">Préparation terminée</button>`;
  } else if (statut.cle === "pret") {
    geste = `<p class="commande-page-note">Préparation terminée : la commande attend sa tournée.</p>`;
  } else {
    geste = `<button class="button primary" type="button" data-action="start-preparation" data-order-id="${id}">Passer en préparation</button>`;
  }

  const article = document.createElement("div");
  article.className = "commande-page-corps";
  article.innerHTML = `
    <section class="commande-page-carte" aria-label="Produits">
      <div class="commande-page-compte">
        <strong>${lignes.length} produit${lignes.length > 1 ? "s" : ""}</strong>
        <span>${n} article${n > 1 ? "s" : ""}</span>
      </div>
      <ul class="commande-page-produits">
        ${lignes.map(ligne => ligneDeProduitPreparation(ligne, reservee)).join("")}
      </ul>
    </section>
    <section class="commande-page-carte commande-page-adresse" aria-label="Livraison">
      <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><circle cx="12" cy="10" r="2.4" stroke="currentColor" stroke-width="2"></circle></svg>
      <div>
        <strong>${escapeHtml(formatOrderAddress(order))}</strong>
        ${order.phone ? `<a href="tel:${escapeAttribute(String(order.phone).replace(/\s+/g, ""))}">${escapeHtml(formatPhone(order.phone))}</a>` : ""}
      </div>
      <label class="commande-page-date">
        Date de livraison
        <input data-delivery-date-input="${id}" type="date" value="${escapeAttribute(deliveryDate)}">
      </label>
      <button class="button secondary" type="button" data-action="open-order-maps" data-order-id="${id}">Itinéraire</button>
    </section>
    <div class="commande-page-gestes">${geste}</div>
  `;
  return article;
}

function closeCommandeDetail() {
  const dialogue = document.getElementById("commandeDetailDialog");
  if (dialogue && dialogue.open) dialogue.close();
}

function renderPreparationStats() {
  const container = document.getElementById("preparationStats");
  if (!container) return;

  // P3 v1.14.0 : 1 seule passe sur orders au lieu de 4 .filter() consecutifs.
  // Avant : O(4n) sur ~500 commandes = 2000 comparaisons.
  // Apres : O(n) = 500 comparaisons + 1 lookup Map.
  const counts = { imported: 0, preparing: 0, ready: 0, blocked: 0 };
  for (const order of orders) {
    const status = order.status;
    if (status === "importe" || status === "stock_a_verifier") {
      counts.imported += 1;
      if (!order.canPrepare) counts.blocked += 1;
    } else if (status === "en_preparation") {
      counts.preparing += 1;
    } else if (status === "pret_livraison") {
      counts.ready += 1;
    }
  }

  // Planche Preparation.png : un seul resume, un anneau a la part des pretes.
  const total = counts.imported + counts.preparing + counts.ready;
  const restantes = counts.imported + counts.preparing;
  const articles = orders
    .filter(order => ["importe", "stock_a_verifier", "en_preparation", "pret_livraison"].includes(order.status))
    .reduce((somme, order) => somme + getOrderProductCount(order), 0);
  const part = total ? counts.ready / total : 0;
  const rayon = 24, circonference = 2 * Math.PI * rayon;
  container.innerHTML = `
    <article class="preparation-resume">
      <span class="preparation-anneau" role="img" aria-label="${counts.ready} sur ${total} prêtes">
        <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true">
          <circle cx="30" cy="30" r="${rayon}" fill="none" stroke="var(--v8-peche-claire)" stroke-width="7"/>
          <circle cx="30" cy="30" r="${rayon}" fill="none" stroke="var(--v8-accent)" stroke-width="7" stroke-linecap="round"
            stroke-dasharray="${(circonference * part).toFixed(1)} ${circonference.toFixed(1)}" transform="rotate(-90 30 30)"/>
        </svg>
        <strong aria-hidden="true">${counts.ready}</strong>
      </span>
      <div>
        <strong>${counts.ready} commande${counts.ready > 1 ? "s" : ""} prête${counts.ready > 1 ? "s" : ""}</strong>
        <span>${restantes} restante${restantes > 1 ? "s" : ""} · ${articles} article${articles > 1 ? "s" : ""} au total${counts.blocked ? ` · ${counts.blocked} bloquée${counts.blocked > 1 ? "s" : ""}` : ""}</span>
      </div>
    </article>
  `;
}

function createPreparationCard(order) {
  const article = document.createElement("article");
  article.className = `order-card ${order.canPrepare ? "status-ok" : "status-danger"}`;
  const canStart = ["importe", "stock_a_verifier"].includes(order.status) && order.canPrepare;
  const canFinish = order.status === "en_preparation";
  const deliveryDate = order.deliveryDate || getTodayDateInput();

  article.innerHTML = `
    <div class="item-header">
      <p class="arret-adresse">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>${escapeHtml(formatOrderAddress(order))}</span>
      </p>
      <span class="pill ${getOrderPill(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span>
    </div>
    <div class="order-meta">
      <span>Secteur : ${escapeHtml(order.sector ? formatSectorLabel(order.sector) : "-")}</span>
      <span>Produits : ${escapeHtml(getOrderProductCount(order))}</span>
      <span>Stock : ${escapeHtml(formatStockStatus(order.stockStatus))}</span>
      <span>Livraison : ${escapeHtml(order.deliveryDate ? formatDeliveryDate(order.deliveryDate) : "à dater")}</span>
    </div>
    ${renderStockLines(order)}
    <label class="delivery-date-inline">
      Date livraison
      <input data-delivery-date-input="${escapeAttribute(order.id)}" type="date" value="${escapeAttribute(deliveryDate)}">
    </label>
    <div class="card-actions">
      <button class="button primary" type="button" data-action="start-preparation" data-order-id="${escapeAttribute(order.id)}" ${canStart ? "" : "disabled"}>Passer en préparation</button>
      <button class="button ok" type="button" data-action="finish-preparation" data-order-id="${escapeAttribute(order.id)}" ${canFinish ? "" : "disabled"}>Préparation terminée</button>
      <button class="button secondary" type="button" data-action="open-order-maps" data-order-id="${escapeAttribute(order.id)}">Itinéraire</button>
    </div>
  `;

  return article;
}

async function startPreparation(orderId) {
  closeCommandeDetail();
  await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/start-preparation`, {
    method: "POST"
  });
  await loadData();
  notify("Commande passée en préparation. Stock réservé.", "success");
}

async function finishPreparation(orderId) {
  closeCommandeDetail();
  const deliveryDate = document.querySelector(`[data-delivery-date-input="${cssEscape(orderId)}"]`)?.value || getTodayDateInput();

  await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/finish-preparation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ deliveryDate })
  });
  await loadData();
  notify("Préparation terminée. Commande prête à livrer.", "success");
}

function openOrderMaps(orderId) {
  const order = orders.find(item => String(item.id) === String(orderId));
  const mapsUrl = order ? buildGoogleMapsUrl(order) : "";

  if (!mapsUrl) {
    notify("Adresse incomplète, impossible d'ouvrir Google Maps correctement.", "warning");
    return;
  }

  window.open(mapsUrl, "_blank", "noopener,noreferrer");
}

function renderRecommande() {
  const container = document.getElementById("recommandeList");
  if (!container) return;

  container.innerHTML = "";
  updateRecommendFilterButtons();

  const products = getRecommendationItems().filter(item => {
    if (recommendFilter === "all") return true;
    if (recommendFilter === "low") return ["urgent", "bientot"].includes(item.level);
    return item.level === "urgent";
  });

  if (!products.length) {
    container.innerHTML = emptyState("Aucun produit à recommander", "Le stock actuel couvre les seuils et les besoins connus.");
    return;
  }

  products.forEach(item => {
    const article = document.createElement("article");
    article.className = `item ${item.level === "urgent" ? "status-danger" : "status-warning"}`;
    article.innerHTML = `
      <div class="item-header">
        <div>
          <h4>${escapeHtml(getProductName(item.product))}</h4>
          <p>Référence : ${escapeHtml(item.product.code || item.product.sku || "-")}</p>
        </div>
        <span class="pill ${item.level === "urgent" ? "pill-danger" : "pill-warning"}">${escapeHtml(item.label)}</span>
      </div>
      <div class="stock-kpis">
        <span><strong>${escapeHtml(item.available)}</strong><small>Stock actuel</small></span>
        <span><strong>${escapeHtml(item.needed)}</strong><small>Besoin estimé</small></span>
        <span><strong>${escapeHtml(item.threshold)}</strong><small>Seuil</small></span>
        <span><strong>${escapeHtml(item.recommended)}</strong><small>À recommander</small></span>
      </div>
    `;
    container.appendChild(article);
  });
}

function updateRecommendFilterButtons() {
  document.querySelectorAll("[data-recommend-filter]").forEach(button => {
    const choisie = button.dataset.recommendFilter === recommendFilter;
    button.classList.toggle("active-filter", choisie);
    button.setAttribute("aria-pressed", String(choisie));
  });
}


function getRecommendationItems() {
  // Filet de securite : si la base contient des doublons (ex: imports anterieurs
  // a la dedup), on filtre cote frontend pour eviter d'afficher 2x le meme produit.
  // Garde la premiere occurrence par productKey, les produits sans cle sont conserves.
  const seenKeys = new Set();
  const uniqueStock = stock.filter(product => {
    const key = productKey(product);
    if (!key) return true;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  return uniqueStock
    .map(product => {
      const inconnu = (product.quantityAvailable ?? getProductQuantity(product)) === null;
      const available = product.quantityAvailable ?? getProductQuantity(product) ?? 0;
      const needed = product.quantityNeeded ?? getNeededQuantityForProduct(product);
      const threshold = getProductThreshold(product);
      const shortage = Math.max(0, needed - available);
      // « Sous le seuil » = quantite <= seuil, partout (carte du Stock, pastille,
      // getStockLevel). Pour en sortir, il faut repasser AU-DESSUS du seuil.
      const thresholdGap = available <= threshold ? threshold - available + 1 : 0;
      const recommended = inconnu ? 0 : Math.ceil(Math.max(shortage, thresholdGap));
      // Une quantite inconnue n'est pas une rupture : elle est « a renseigner ».
      const level = inconnu ? "ok" : (available <= 0 || shortage > 0 ? "urgent" : (recommended > 0 ? "bientot" : "ok"));

      return {
        product,
        available,
        needed,
        threshold,
        recommended,
        level,
        label: inconnu ? "À renseigner" : (level === "urgent" ? "Urgent" : (level === "bientot" ? "Bientôt" : "OK"))
      };
    })
    .filter(item => item.level !== "ok" || recommendFilter === "all")
    .sort((a, b) => b.recommended - a.recommended || String(getProductName(a.product)).localeCompare(getProductName(b.product), "fr"));
}

function renderProduits() {
  const container = document.getElementById("produitsList");
  if (!container) return;

  container.innerHTML = "";

  if (!stock.length) {
    container.innerHTML = emptyState("Aucun produit", "Importe un fichier stock pour afficher les produits.", { libelle: "Importer le stock", onglet: "journee" });
    return;
  }

  stock.forEach(product => {
    container.appendChild(createStockCard(product));
  });
}

function renderVentes() {
  const container = document.getElementById("ventesList");
  if (!container) return;

  container.innerHTML = "";

  if (!ventes.length) {
    container.innerHTML = emptyState("Aucune vente", "Importe les dossiers du jour pour alimenter cette vue.", { libelle: "Importer les dossiers", onglet: "journee" });
    return;
  }

  ventes.forEach(vente => {
    const div = document.createElement("article");
    div.className = "item";

    div.innerHTML = `
      <h4>${escapeHtml(vente.client || "Client")}</h4>
      <p>Produit : ${escapeHtml(vente.produit || "-")}</p>
      <p>Quantité : ${escapeHtml(vente.quantite || "-")}</p>
      <p>Ville : ${escapeHtml(vente.ville || "-")}</p>
      <p>Date : ${escapeHtml(vente.date || "-")}</p>
    `;

    container.appendChild(div);
  });
}

function renderAlertes() {
  const container = document.getElementById("alertesList");
  if (!container) return;

  container.innerHTML = "";

  const alerts = getAlertItems();

  if (!alerts.length) {
    container.innerHTML = `
      <article class="item status-ok">
        <h4>Aucune alerte</h4>
        <p>Stock renseigné OK et aucune livraison problématique.</p>
      </article>
    `;
    return;
  }

  alerts.forEach(alert => {
    const div = document.createElement("article");
    div.className = `item ${alert.level}`;

    div.innerHTML = `
      <div class="item-header">
        <div>
          <h4>${escapeHtml(alert.title)}</h4>
          <p>${escapeHtml(alert.message)}</p>
        </div>
        <span class="pill ${alert.pill}">${escapeHtml(alert.label)}</span>
      </div>
    `;

    container.appendChild(div);
  });
}

function getAlertItems() {
  const alerts = [];

  stock.forEach(product => {
    const quantity = product.quantityAvailable ?? getProductQuantity(product);
    const level = getStockLevel(product);
    const threshold = getProductThreshold(product);

    if (quantity === null) return;

    if (level.status === "rupture") {
      alerts.push({
        level: "status-danger",
        pill: "pill-danger",
        label: "Rupture",
        title: getProductName(product),
        message: "Produit en rupture de stock."
      });
    } else if (level.status === "stock_faible") {
      alerts.push({
        level: "status-warning",
        pill: "pill-warning",
        label: "Stock faible",
        title: getProductName(product),
        message: `Stock faible : ${quantity} restant(s), seuil minimum ${threshold}.`
      });
    }
  });

  orders
    .filter(order => ["importe", "stock_a_verifier"].includes(order.status) && order.stockStatus !== "disponible")
    .forEach(order => {
      alerts.push({
        level: "status-danger",
        pill: "pill-danger",
        label: "Commande bloquée",
        title: order.clientName,
        message: `Stock ${formatStockStatus(order.stockStatus)} - ${formatOrderAddress(order)}`
      });
    });

  orders
    .filter(order => !order.address || !order.city || !order.phone)
    .forEach(order => {
      alerts.push({
        level: "status-warning",
        pill: "pill-warning",
        label: "Données à compléter",
        title: order.clientName,
        message: !order.address || !order.city ? "Adresse incomplète." : "Téléphone manquant."
      });
    });

  orders
    .filter(order => ["probleme_livraison", "a_reprogrammer"].includes(order.status))
    .forEach(order => {
      alerts.push({
        level: "status-warning",
        pill: "pill-warning",
        label: "Livraison à traiter",
        title: order.clientName,
        message: `${formatOrderStatus(order.status)} - ${formatOrderAddress(order)}`
      });
    });

  return alerts;
}

function renderHistorique() {
  const container = document.getElementById("historiqueList");
  if (!container) return;

  container.innerHTML = `
    <div class="history-cell history-head">Date</div>
    <div class="history-cell history-head">Type</div>
    <div class="history-cell history-head">Action</div>
  `;

  if (!historique.length) {
    container.innerHTML += `
      <div class="history-cell">-</div>
      <div class="history-cell">-</div>
      <div class="history-cell">Aucun historique.</div>
    `;
    return;
  }

  historique.forEach(item => {
    container.innerHTML += `
      <div class="history-cell">${escapeHtml(formatDate(item.date))}</div>
      <div class="history-cell">${escapeHtml(item.type || "-")}</div>
      <div class="history-cell">${escapeHtml(item.message || item.texte || "-")}</div>
    `;
  });
}

// Helpers ERP v1.11.0 (les anciennes listes « Commandes livrees » et « Bons de
// commande » ont quitte la page le 23/09 ; ce format sert le detail et les rappels)

// Format date "seulement jour" : YYYY-MM-DD ou ISO complet -> DD/MM/YYYY (sans heure).
// Avant on utilisait formatDate qui inclut l'heure 02:00:00 (artefact timezone Excel).
function formatDateDayOnly(value) {
  if (!value) return "—";
  const s = String(value).slice(0, 10); // garde juste YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    // valeur deja au format FR ou autre : on coupe juste l'heure si presente
    return String(value).split(/[\sT]/)[0];
  }
  return `${m[3]}/${m[2]}/${m[1]}`;
}


// ============================================================================
// PAGE "BONS DE COMMANDE" (Phase 3 ERP v1.10.0)
//
// Liste triable + filtrable de TOUS les bons de commande (toutes statuts).
// Filtres : recherche texte (numero CMD-... ou client), statut, secteur, date.
// Vue detail : modal avec lignes produits, statut workflow, hash, dates.
// Tri par defaut : dateCommande desc, puis numero desc (plus recent en haut).
// ============================================================================

// L'etat de la fenetre de detail. Les filtres de l'ancienne liste (statut,
// recherche, secteur, dates, vue) sont partis avec elle le 23/09.
const bdcState = {
  editingClientId: null // id du client en cours d'edition dans le modal detail
};

// Un bon est "a completer" si l'adresse ou le telephone manque, ou si le
// secteur n'a pas pu etre derive (-> "Sans Secteur").
function bdcNeedsCompletion(order) {
  if (!order) return false;
  const hasAddress = order.address && order.postalCode && order.city;
  const hasPhone = order.phone && order.phone.trim().length >= 6;
  const hasSector = order.sector && order.sector !== "Sans Secteur";
  return !hasAddress || !hasPhone || !hasSector;
}

const BDC_STATUS_LABELS = {
  importe: "Importée",
  stock_a_verifier: "À vérifier",
  en_preparation: "En préparation",
  preparation_terminee: "Préparation terminée",
  pret_livraison: "Prêt livraison",
  en_livraison: "En livraison",
  livre: "Livrée",
  probleme_livraison: "Problème livraison",
  a_reprogrammer: "À reprogrammer"
};

const BDC_STATUS_TONE = {
  importe: "neutral",
  stock_a_verifier: "warning",
  en_preparation: "info",
  preparation_terminee: "info",
  pret_livraison: "ok",
  en_livraison: "info",
  livre: "ok",
  probleme_livraison: "danger",
  a_reprogrammer: "warning"
};

function bdcStatusBadge(status) {
  const label = BDC_STATUS_LABELS[status] || status || "Inconnu";
  const tone = BDC_STATUS_TONE[status] || "neutral";
  return `<span class="bdc-pill bdc-pill-${tone}">${escapeHtml(label)}</span>`;
}

// Format date ISO YYYY-MM-DD en FR DD/MM/YYYY (defaut, future option dans settings)
function bdcFormatDate(iso) {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Export CSV des bons filtres. Pas d'endpoint backend : Blob + download client-side.
// Format : Numero;Date;Client;Adresse;CP;Ville;Secteur;Statut;Telephone;Lignes;Qté
// Separateur ; (compatibilite Excel FR), encodage UTF-8 BOM pour les accents.
function exportBdcCsv(liste = [], prefixe = "sereo-commandes") {
  // L'ecran Commandes (planche 13c) lui passe SA liste filtree. L'ancien ecran
  // « Bons de commande », qui l'appelait sans argument, a quitte la page.
  const filtered = liste || [];
  if (!filtered.length) {
    notify("Aucun bon à exporter (filtres vides).", "warning");
    return;
  }

  const headers = [
    "Numero", "Date commande", "Client", "Adresse", "Code postal", "Ville",
    "Secteur", "Statut", "Telephone", "Nb lignes", "Total quantite", "Importee livree"
  ];

  const escapeCsv = v => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = filtered.map(o => {
    const productsCount = Array.isArray(o.products) ? o.products.length : 0;
    const totalQty = (o.products || []).reduce((s, p) => s + Number(p.quantite || 0), 0);
    return [
      o.numero || "",
      bdcFormatDate(o.dateCommande),
      o.clientName || "",
      o.address || "",
      o.postalCode || "",
      o.city || "",
      o.sector || "",
      BDC_STATUS_LABELS[o.status] || o.status || "",
      o.phone || "",
      productsCount,
      totalQty,
      o.importedAsLivre ? "Oui" : "Non"
    ].map(escapeCsv).join(";");
  });

  // UTF-8 BOM ﻿ pour qu'Excel detecte l'encodage et n'abime pas les accents
  const csv = "﻿" + headers.join(";") + "\r\n" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${prefixe}-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  notify(`${filtered.length} bon${filtered.length > 1 ? "s" : ""} exporté${filtered.length > 1 ? "s" : ""} en CSV.`, "success");
}

function openBdcDetail(orderId) {
  const order = (orders || []).find(o => String(o.id) === String(orderId));
  if (!order) return;
  // La commande AFFICHEE : editer puis annuler le profil doit y revenir, pas
  // a la premiere commande du meme client -- sinon la fenetre montre un bon
  // et ses boutons en visent un autre.
  bdcState.detailOrderId = String(order.id);

  const modal = document.getElementById("bdc-detail-modal");
  const titleEl = document.getElementById("bdc-detail-title");
  const subtitleEl = document.getElementById("bdc-detail-subtitle");
  const bodyEl = document.getElementById("bdc-detail-body");
  if (!modal || !bodyEl) return;

  const numero = order.numero || "(non numéroté)";
  if (titleEl) titleEl.textContent = `Bon ${numero}`;
  if (subtitleEl) {
    subtitleEl.textContent = `${order.clientName || "Client"} · ${bdcFormatDate(order.dateCommande)}`;
  }

  const products = Array.isArray(order.products) ? order.products : [];
  const productsHtml = products.length
    ? `<table class="bdc-detail-table">
        <thead><tr><th>Code</th><th>Produit</th><th class="bdc-qty">Qté</th></tr></thead>
        <tbody>
          ${products.map(p => {
            // ERP v1.11.0 : separer le code-barre EAN du nom produit si fusionne
            const rawName = p.nom || p.produit || "Produit sans nom";
            const split = splitProductCode(rawName);
            const code = p.code && p.code !== rawName ? p.code : (split.code || "");
            return `
              <tr>
                <td class="muted"><code>${escapeHtml(code || "—")}</code></td>
                <td>${escapeHtml(split.name)}</td>
                <td class="bdc-qty"><strong>${escapeHtml(p.quantite ?? 0)}</strong></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>`
    : `<p class="muted">Aucune ligne produit.</p>`;

  // ERP v1.11.0 : empreinte vide -> texte clair "Creation manuelle" au lieu de —
  const hash = order.excelRowHash
    ? `<code class="bdc-detail-hash" title="Empreinte SHA-256 pour anti-doublon a l'import">${escapeHtml(order.excelRowHash)}</code>`
    : `<span class="muted" title="Ce bon a été créé manuellement, pas via un import Excel">Création manuelle</span>`;

  // Date livraison : si identique a la date commande, afficher discretement
  const sameDates = order.deliveryDate && order.dateCommande &&
    String(order.deliveryDate).slice(0, 10) === String(order.dateCommande).slice(0, 10);
  const dateLivraisonHtml = order.deliveryDate
    ? `<strong>${escapeHtml(bdcFormatDate(order.deliveryDate))}</strong>${sameDates ? ` <span class="muted">(idem date commande)</span>` : ""}`
    : `<span class="muted">Non spécifiée</span>`;

  // Section CLIENT : mode lecture OU edition selon bdcState.editingClientId
  const isEditing = bdcState.editingClientId && String(bdcState.editingClientId) === String(order.clientId);
  const clientSection = isEditing
    ? renderBdcClientEditForm(order)
    : renderBdcClientReadView(order);

  bodyEl.innerHTML = `
    <div class="bdc-detail-grid">
      <div class="bdc-detail-field">
        <span class="bdc-detail-label">Statut</span>
        ${bdcStatusBadge(order.status)}
      </div>
      <div class="bdc-detail-field">
        <span class="bdc-detail-label">Secteur</span>
        <strong>${escapeHtml(order.sector || "—")}</strong>
      </div>
      <div class="bdc-detail-field">
        <span class="bdc-detail-label">Date commande</span>
        <strong>${escapeHtml(bdcFormatDate(order.dateCommande))}</strong>
      </div>
      <div class="bdc-detail-field">
        <span class="bdc-detail-label">Date livraison souhaitée</span>
        ${dateLivraisonHtml}
      </div>
    </div>

    ${clientSection}

    <div class="bdc-detail-section">
      <h3>Lignes produits</h3>
      ${productsHtml}
    </div>

    <div class="bdc-detail-section bdc-detail-tech">
      <h3>Technique</h3>
      <dl class="bdc-detail-dl">
        <dt>ID</dt><dd><code>${escapeHtml(order.id)}</code></dd>
        <dt>Empreinte (anti-doublon)</dt><dd>${hash}</dd>
        <dt>Importée déjà livrée</dt><dd>${order.importedAsLivre ? "Oui" : "Non"}</dd>
        <dt>Créée le</dt><dd>${escapeHtml(formatDateDayOnly(order.createdAt))}</dd>
        <dt>Mise à jour</dt><dd>${escapeHtml(formatDateDayOnly(order.updatedAt))}</dd>
      </dl>
    </div>
  `;

  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("version-modal-open");
  // U3 v1.13.0 : focus trap pour empecher Tab de sortir du modal
  if (modal._releaseTrap) modal._releaseTrap();
  modal._releaseTrap = trapFocusWithin(modal);
}

// Section CLIENT en mode LECTURE (defaut). Affiche un bouton "Modifier le profil"
// + un warning visuel si le profil est incomplet (adresse/telephone manquant).
function renderBdcClientReadView(order) {
  const address = [order.address, order.postalCode, order.city].filter(Boolean).join(" · ");
  const needs = bdcNeedsCompletion(order);
  const phoneHtml = order.phone
    ? `<p class="bdc-detail-phone"><a href="tel:${escapeAttribute(String(order.phone).replace(/\s+/g, ""))}">📞 ${escapeHtml(order.phone)}</a></p>`
    : `<p class="bdc-detail-missing">⚠ Téléphone non renseigné</p>`;
  const addressHtml = address
    ? `<p class="muted">${escapeHtml(address)}</p>`
    : `<p class="bdc-detail-missing">⚠ Adresse non renseignée</p>`;
  const warnBadge = needs
    ? `<span class="bdc-detail-warn-badge" title="Ce client a un profil incomplet">À compléter</span>`
    : "";

  return `
    <div class="bdc-detail-section bdc-detail-client">
      <div class="bdc-detail-client-head">
        <h3>Client ${warnBadge}</h3>
        <button class="button secondary compact" type="button"
                data-action="bdc-edit-client" data-client-id="${escapeAttribute(order.clientId)}">
          ✏️ Modifier le profil
        </button>
      </div>
      <p><strong>${escapeHtml(order.clientName || "—")}</strong></p>
      ${addressHtml}
      ${phoneHtml}
      ${order.notes ? `<p class="bdc-detail-notes">📝 ${escapeHtml(order.notes)}</p>` : ""}
    </div>
  `;
}

// Section CLIENT en mode EDITION. Inputs editables + Save/Cancel.
function renderBdcClientEditForm(order) {
  return `
    <form class="bdc-detail-section bdc-detail-client-form" data-action="bdc-save-client"
          data-client-id="${escapeAttribute(order.clientId)}" onsubmit="return false">
      <div class="bdc-detail-client-head">
        <h3>Modifier le profil client</h3>
      </div>
      <div class="bdc-form-grid">
        <label class="bdc-form-field bdc-form-field-wide">
          <span>Nom</span>
          <input type="text" name="nom" value="${escapeAttribute(order.clientName || "")}" required />
        </label>
        <label class="bdc-form-field bdc-form-field-wide">
          <span>Rue</span>
          <input type="text" name="rue" value="${escapeAttribute(order.address || "")}" placeholder="Ex : 5 Rue des Accacias" />
        </label>
        <label class="bdc-form-field">
          <span>Code postal</span>
          <input type="text" name="codePostal" value="${escapeAttribute(order.postalCode || "")}" placeholder="25000" inputmode="numeric" pattern="[0-9]{4,5}" />
        </label>
        <label class="bdc-form-field">
          <span>Ville</span>
          <input type="text" name="ville" value="${escapeAttribute(order.city || "")}" placeholder="Besancon" />
        </label>
        <label class="bdc-form-field bdc-form-field-wide">
          <span>Téléphone</span>
          <input type="tel" name="telephone" value="${escapeAttribute(order.phone || "")}" placeholder="06 81 23 71 71" />
        </label>
        <label class="bdc-form-field bdc-form-field-wide">
          <span>Notes</span>
          <textarea name="notes" rows="2" placeholder="Sonner 2 fois, code 1234, etc.">${escapeHtml(order.notes || "")}</textarea>
        </label>
      </div>
      <div class="bdc-form-actions">
        <button class="button secondary compact" type="button" data-action="bdc-cancel-edit">Annuler</button>
        <button class="button compact" type="submit" data-action="bdc-save-client" data-client-id="${escapeAttribute(order.clientId)}">💾 Enregistrer</button>
      </div>
    </form>
  `;
}

// Helper utilise par le handler edit : retrouve l'orderId courant a partir d'un clientId
// (utile car le modal est ouvert pour 1 commande mais l'edition vise le client).
function findOrderIdForClient(clientId) {
  const order = (orders || []).find(o => String(o.clientId) === String(clientId));
  return order ? order.id : null;
}

// Sauve l'edition du profil client via PATCH /api/clients/:id puis reload.
async function saveBdcClientEdit(triggerBtn) {
  const form = triggerBtn.closest("form");
  if (!form) return;
  const clientId = triggerBtn.dataset.clientId || form.dataset.clientId;
  if (!clientId) return;

  const formData = new FormData(form);
  const body = {
    nom: formData.get("nom") || "",
    rue: formData.get("rue") || "",
    codePostal: formData.get("codePostal") || "",
    ville: formData.get("ville") || "",
    telephone: formData.get("telephone") || "",
    notes: formData.get("notes") || ""
  };

  await runAction(triggerBtn, "Enregistrement...", async () => {
    const result = await apiFetch(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    bdcState.editingClientId = null;
    notify(`Profil client mis à jour${result.ordersUpdated > 1 ? ` (${result.ordersUpdated} commandes synchronisées)` : ""}.`, "success");

    // Reload data pour avoir l'ordre a jour, puis re-render modal en mode lecture
    await loadData();
    const order = commandeDuDetail(clientId);
    if (order) openBdcDetail(order.id);
  });
}

// La commande que le detail montre ; a defaut, la premiere du client.
function commandeDuDetail(clientId) {
  const affichee = (orders || []).find(o => String(o.id) === String(bdcState.detailOrderId));
  if (affichee && String(affichee.clientId) === String(clientId)) return affichee;
  return (orders || []).find(o => String(o.clientId) === String(clientId));
}

function closeBdcDetail() {
  const modal = document.getElementById("bdc-detail-modal");
  if (!modal) return;
  // Les gestes d'une planifiee ne survivent pas a la fermeture : le detail
  // suivant, ouvert d'ailleurs, ne doit pas en heriter.
  const gestes = document.getElementById("cmdDetailGestes");
  if (gestes) { gestes.hidden = true; gestes.innerHTML = ""; }
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("version-modal-open");
  if (modal._releaseTrap) { modal._releaseTrap(); modal._releaseTrap = null; }
  if (retourDuDetail) {
    const id = retourDuDetail;
    retourDuDetail = null;
    // Apres un geste, la liste se redessine : on retrouve la ligne par son id.
    setTimeout(() => document.querySelector(`[data-cmd-ouvrir="${CSS.escape(id)}"]`)?.focus(), 0);
  }
}

function bindBonsCommandeUi() {
  // La fenetre de detail d'une commande (ouvrir, fermer, editer le client).
  // Les filtres de l'ancienne liste « Bons de commande » (recherche, statut,
  // secteur, dates, vue, export) sont partis avec elle le 23/09 : l'ecran
  // Commandes a les siens.
  document.addEventListener("click", event => {
    const opener = event.target.closest('[data-action="open-bdc-detail"]');
    if (opener) {
      bdcState.editingClientId = null; // reset edit mode a l'ouverture
      openBdcDetail(opener.dataset.orderId);
      return;
    }

    const closer = event.target.closest('[data-action="close-bdc-detail"]');
    if (closer) {
      bdcState.editingClientId = null;
      closeBdcDetail();
      return;
    }

    // Edition client : passe en mode formulaire
    const editBtn = event.target.closest('[data-action="bdc-edit-client"]');
    if (editBtn) {
      bdcState.editingClientId = editBtn.dataset.clientId;
      const currentOrderId = document.querySelector('#bdc-detail-modal[aria-hidden="false"]')
        ? findOrderIdForClient(bdcState.editingClientId) : null;
      // Re-render le modal avec mode edition
      const order = commandeDuDetail(bdcState.editingClientId);
      if (order) openBdcDetail(order.id);
      return;
    }

    // Cancel edition
    if (event.target.closest('[data-action="bdc-cancel-edit"]')) {
      const order = commandeDuDetail(bdcState.editingClientId);
      bdcState.editingClientId = null;
      if (order) openBdcDetail(order.id);
      return;
    }

    // Save edition (delegation : on cherche le form ascendant pour recuperer les valeurs)
    const saveBtn = event.target.closest('button[data-action="bdc-save-client"]');
    if (saveBtn) {
      event.preventDefault();
      saveBdcClientEdit(saveBtn);
      return;
    }
  });

  // Carte au clavier (Enter/Espace) pour a11y
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      const modal = document.getElementById("bdc-detail-modal");
      if (modal && modal.getAttribute("aria-hidden") === "false") {
        closeBdcDetail();
      }
    }
    if (event.key === "Enter" || event.key === " ") {
      const card = event.target.closest && event.target.closest('[data-action="open-bdc-detail"]');
      if (card && document.activeElement === card) {
        event.preventDefault();
        openBdcDetail(card.dataset.orderId);
      }
    }
  });
}

async function loadAppearance() {
  try {
    const appearance = await apiFetch("/api/settings/appearance");

    // Mode de couleur : strictement par-device via localStorage.
    // On NE lit PAS la valeur DB pour eviter qu'un device adopte le choix
    // d'un autre device. Si localStorage est vide, on suit le SYSTEME.
    //
    // Ce defaut est ecrit a QUATRE endroits qui doivent rester d'accord :
    // anti-fart.js (avant le rendu), la valeur initiale d'activeColorScheme,
    // le repli d'applyColorScheme, et ici. Le 17/09, corriger les deux
    // premiers n'a RIEN change a l'ecran : les deux autres reposaient "light"
    // juste apres. Un defaut eparpille ne se corrige pas en un seul endroit.
    let scheme = "auto";
    try {
      const stored = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
      if (VALID_COLOR_SCHEMES.includes(stored)) scheme = stored;
    } catch { /* localStorage indispo : on suit le systeme */ }
    applyColorScheme(scheme, { persist: false });

    applyTheme(appearance.themeId || "sereo", { persist: false });
    applyBrandImage(appearance.brandImage || DEFAULT_BRAND_IMAGE);
  } catch (error) {
    updateBrandImageStatus(false);
    notify(error.message || "Paramètres visuels indisponibles.", "warning");
  }
}

// Cle localStorage pour la persistance par device du mode (auto / light / dark)
const COLOR_SCHEME_STORAGE_KEY = "sereo:colorScheme";
const VALID_COLOR_SCHEMES = ["auto", "light", "dark"];

// Retourne le mode effectivement applique : "light" ou "dark".
// "auto" est resolu via le media query prefers-color-scheme.
function getEffectiveColorScheme() {
  if (activeColorScheme === "dark") return "dark";
  if (activeColorScheme === "light") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getActiveTheme() {
  return applicationThemes[activeThemeId] || applicationThemes.sereo;
}

// Le theme "Noir" ayant ete retire, seul le mode clair/sombre decide.
function isVisuallyDarkTheme() {
  return getEffectiveColorScheme() === "dark";
}

// Applique les variables d'un theme en respectant le mode actif (clair / sombre).
// Le theme pastel definit ses 7 variables --color-* en 2 versions : `vars` et `darkVars`.
// Depuis la marche 3 de la phase 4, plus AUCUNE couleur n'est posee en style
// inline : la feuille lit directement les jetons V8, qui se resolvent
// eux-memes par mode. Il ne reste que l'identifiant sur :root, pour qu'un
// selecteur ou un test puisse savoir quel theme est actif.
//
// Le nom garde son pluriel a dessein : c'est ici que revenaient 470 lignes de
// hex, et la fonction reste le point ou l'on remettrait une couche inline si
// un theme devait un jour en poser. Aujourd'hui, non.
function applyThemeVariables(theme) {
  document.documentElement.dataset.appTheme = theme.id;
}

// Met a jour la meta theme-color (couleur de la barre OS sur mobile)
// pour refleter le mode actif. Utilise la couleur de fond.
function updateMetaThemeColor() {
  const theme = getActiveTheme();
  // Couleur de la barre du navigateur : le FOND de la charte V8, dans chaque mode.
  const color = theme.metaColor || (getEffectiveColorScheme() === "dark" ? "#0D1518" : "#FBF7F5");
  // On force une seule meta sans media query (override les 2 du HTML)
  let tag = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", "theme-color");
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", color);
}

// Change le mode de couleur (auto / light / dark).
// - persist : sauve dans localStorage par device + sync DB serveur
// - notifyUser : affiche un toast de confirmation
function applyColorScheme(scheme, options = {}) {
  const { persist = true, notifyUser = false } = options;
  // Repli sur "auto" -- et non "light" -- si la valeur est invalide : depuis le
  // 17/09 le defaut du produit est de suivre le systeme, et un repli disant
  // "light" reintroduirait l'ancien comportement par la porte de derriere,
  // dans le seul cas ou personne ne regarde.
  const next = VALID_COLOR_SCHEMES.includes(scheme) ? scheme : "auto";
  activeColorScheme = next;

  const root = document.documentElement;
  // On POSE toujours l'attribut, MEME en "auto". Avant le 17/09 on l'effacait
  // pour laisser @media (prefers-color-scheme) decider : plus propre en
  // apparence, faux en pratique. Sans attribut, la page retombe sur le bloc
  // :root de base, qui porte une palette PLUS ANCIENNE que le bloc
  // :root[data-color-scheme="light"]. Mesure sur OS clair : "Auto" rendait
  // --bg #fafaf8 et --text #102a2f, "Clair" rendait #eff3f1 et #183233.
  // activeColorScheme garde "auto" -- c'est le CHOIX de l'utilisateur ; seul
  // l'attribut porte le mode RESOLU.
  root.dataset.colorScheme = next === "auto" ? getEffectiveColorScheme() : next;

  // Re-applique les variables du theme actif avec la bonne palette (light/dark)
  const theme = getActiveTheme();
  applyThemeVariables(theme);
  updateMetaThemeColor();
  // Re-evalue le logo (variante claire/sombre si logo par defaut)
  applyBrandImage(activeBrandImage);

  if (persist) {
    try {
      // Persistance par-device uniquement. On NE sync PAS vers la DB pour
      // que chaque device garde son propre mode (pas de propagation entre
      // appareils connectes au meme compte).
      localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, next);
    } catch { /* localStorage indispo : ignore, on a deja applique le mode */ }
  }

  if (notifyUser) {
    const label = next === "auto" ? "système" : (next === "dark" ? "sombre" : "clair");
    notify(`Mode d'affichage : ${label}.`, "success");
  }

  renderColorSchemeToggle();
}

// Re-evalue le mode si l'OS change de prefers-color-scheme et qu'on est en "auto"
function watchSystemColorScheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (activeColorScheme === "auto") {
      // L'attribut resolu doit suivre le systeme, sinon la page garde la
      // palette de l'ancien mode alors que les variables, elles, changent.
      document.documentElement.dataset.colorScheme = getEffectiveColorScheme();
      const theme = getActiveTheme();
      applyThemeVariables(theme);
      updateMetaThemeColor();
      applyBrandImage(activeBrandImage);
    }
  };
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else if (mq.addListener) mq.addListener(handler); // legacy Safari
}

function applyTheme(themeId, options = {}) {
  const { persist = true, notifyUser = false } = options;
  const theme = applicationThemes[themeId] || applicationThemes.sereo;

  activeThemeId = theme.id;
  applyThemeVariables(theme);
  updateMetaThemeColor();
  applyBrandImage(activeBrandImage);

  if (persist) {
    saveAppearance({ themeId: theme.id })
      .then(() => {
        if (notifyUser) notify(`Thème "${theme.name}" appliqué.`, "success");
      })
      .catch(error => notifyEchec(error));
  } else if (notifyUser) {
    notify(`Thème "${theme.name}" appliqué.`, "success");
  }

}

// Met a jour les boutons Auto/Clair/Sombre pour refleter le mode actif.
// Pas de innerHTML (pour preserver le focus clavier), juste les attributs.
function renderColorSchemeToggle() {
  const buttons = document.querySelectorAll('[data-action="select-color-scheme"]');
  buttons.forEach(btn => {
    const isActive = btn.dataset.colorScheme === activeColorScheme;
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function handleBrandImageImport(input) {
  const file = input?.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    notify("Choisis une image valide pour le logo.", "warning");
    input.value = "";
    return;
  }

  if (file.size > MAX_BRAND_IMAGE_SIZE) {
    notify("Image trop lourde : limite 2 Mo.", "warning");
    input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    const dataUrl = String(reader.result || "");
    if (!dataUrl.startsWith("data:image/")) {
      notify("Impossible de lire cette image.", "error");
      return;
    }

    try {
      await saveAppearance({ brandImage: dataUrl });
      applyBrandImage(dataUrl);
      notify("Photo de l'application mise à jour.", "success");
    } catch (error) {
      notifyEchec(error);
    }

    input.value = "";
  });
  reader.addEventListener("error", () => {
    notify("Impossible de lire cette image.", "error");
    input.value = "";
  });
  reader.readAsDataURL(file);
}

async function resetBrandImage() {
  try {
    await saveAppearance({ brandImage: "" });
    applyBrandImage(DEFAULT_BRAND_IMAGE);
    const input = document.getElementById("brandImageInput");
    if (input) input.value = "";
    notify("Logo séréo restauré.", "success");
  } catch (error) {
    notifyEchec(error);
  }
}

function applyBrandImage(src) {
  const imageSrc = src || DEFAULT_BRAND_IMAGE;
  activeBrandImage = imageSrc;

  // Si c'est le logo par defaut, on swap automatiquement entre la variante claire
  // et sombre selon le mode actif. Si c'est un logo custom uploade, on l'affiche
  // tel quel (l'utilisateur a choisi son image).
  const isDefault = isDefaultBrandImageSrc(imageSrc);
  const defaultSrc = isVisuallyDarkTheme() ? DEFAULT_BRAND_IMAGE_DARK : DEFAULT_BRAND_IMAGE;
  const effectiveSrc = isDefault
    ? `${defaultSrc}?v=${DEFAULT_BRAND_CACHE_VERSION}`
    : imageSrc;

  // .brand-logo a disparu avec l'image de la barre laterale : le mot-marque y
  // est desormais du texte. Seul l'apercu de la page Parametres reste une image.
  document.querySelectorAll("[data-brand-preview]").forEach(image => {
    image.src = effectiveSrc;
  });
  updateBrandImageStatus(!isDefault);
}

function isDefaultBrandImageSrc(src) {
  const cleanSrc = String(src || "").split("?")[0];
  return cleanSrc === DEFAULT_BRAND_IMAGE || cleanSrc === DEFAULT_BRAND_IMAGE_DARK;
}

function updateBrandImageStatus(isCustom = !isDefaultBrandImageSrc(activeBrandImage)) {
  const status = document.getElementById("brandImageStatus");
  if (status) {
    status.textContent = isCustom
      ? "Image personnalisée active pour l'application."
      : "Logo SEREO par défaut.";
  }
}

async function saveAppearance(patch) {
  return apiFetch("/api/settings/appearance", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(patch)
  });
}

// v1.17.1 : reglages tournee (vitesse + duree d'arret). Sliders persistes via
// PATCH /api/settings/tournee avec debounce 500 ms (eviter spam HTTP au scroll).
//
// Revue R1 MAJOR-1 (race double-listener) : pattern promesse singleton +
// dataset.listenerAttached.
// Revue R2 MAJOR (race fetch overwrites user input) : si l'utilisateur bouge
// un slider avant que le fetch initial ne reponde, le fetch ecraserait
// silencieusement sa saisie. Correctif : skip l'overwrite si un timer de
// sauvegarde est en cours (signal explicite d'interaction recente).
let tourneeSettingsLoadingPromise = null;
let tourneeSaveTimer = null;

async function renderTourneeSettings() {
  const speedSlider = document.getElementById("tourneeSpeedSlider");
  const stopSlider = document.getElementById("tourneeStopSlider");
  const speedLabel = document.getElementById("tourneeSpeedValue");
  const stopLabel = document.getElementById("tourneeStopValue");
  const status = document.getElementById("tourneeSettingsStatus");
  if (!speedSlider || !stopSlider) return;

  // Listeners attaches une seule fois (marque DOM = source de verite).
  if (!speedSlider.dataset.listenerAttached) {
    const onInput = () => {
      speedLabel.textContent = `${speedSlider.value} km/h`;
      stopLabel.textContent = `${stopSlider.value} min`;
      if (status) status.textContent = "Enregistrement…";
      clearTimeout(tourneeSaveTimer);
      tourneeSaveTimer = setTimeout(async () => {
        try {
          await apiFetch("/api/settings/tournee", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              averageSpeedKmh: Number(speedSlider.value),
              stopDurationMin: Number(stopSlider.value)
            })
          });
          if (status) status.textContent = "Enregistré ✓";
        } catch (error) {
          // Une mise en file n'est pas une erreur : la prefixer de "Erreur :"
          // dirait exactement le contraire de ce qui vient de se passer.
          if (status) {
            status.textContent = error?.enFile
              ? error.message
              : `Erreur : ${error.message || "réseau"}`;
          }
        } finally {
          tourneeSaveTimer = null;
        }
      }, 500);
    };
    speedSlider.addEventListener("input", onInput);
    stopSlider.addEventListener("input", onInput);
    speedSlider.dataset.listenerAttached = "1";
    stopSlider.dataset.listenerAttached = "1";
  }

  if (tourneeSettingsLoadingPromise) {
    return tourneeSettingsLoadingPromise;
  }
  tourneeSettingsLoadingPromise = (async () => {
    try {
      const tournee = await apiFetch("/api/settings/tournee");
      // R2 MAJOR : ne PAS ecraser le slider si l'utilisateur l'a touche
      // pendant le fetch (timer != null = interaction recente, PATCH en
      // queue). Dans ce cas, sa saisie locale est la source de verite.
      if (tourneeSaveTimer === null) {
        speedSlider.value = String(tournee.averageSpeedKmh);
        stopSlider.value = String(tournee.stopDurationMin);
        speedLabel.textContent = `${tournee.averageSpeedKmh} km/h`;
        stopLabel.textContent = `${tournee.stopDurationMin} min`;
        if (status) status.textContent = "";
      }
    } catch (error) {
      if (status) status.textContent = `Impossible de charger les réglages : ${error.message || "réseau"}`;
      throw error;
    } finally {
      tourneeSettingsLoadingPromise = null;
    }
  })();
  return tourneeSettingsLoadingPromise.catch(() => {});
}

// v1.17.1 : diagnostic des dates suspectes en base (mauvais format, mois 13,
// 30 fevrier, etc.). Lance via bouton dans Parametres, affiche compteur +
// echantillon de 20 cas pour pouvoir agir manuellement.
async function runDiagnosticSuspiciousDates() {
  const status = document.getElementById("diagnosticDatesStatus");
  const sample = document.getElementById("diagnosticDatesSample");
  if (!status || !sample) return;
  status.textContent = "Scan en cours…";
  sample.hidden = true;
  try {
    const result = await apiFetch("/api/diagnostic/suspicious-dates");
    // Revue R2 MINOR : signaler explicitement si le scan a ete tronque
    // (>50000 commandes) pour que l'admin sache que le compteur est partiel.
    const base = `${result.totalCommandes} commandes — ${result.datesSuspectes} dates suspectes, ${result.datesManquantes} sans date.`;
    const trunc = result.troncature
      ? ` ⚠️ Scan tronqué a ${result.commandesAnalysees} commandes (limite de protection event-loop).`
      : "";
    status.textContent = base + trunc;
    if (result.echantillon && result.echantillon.length) {
      sample.textContent = JSON.stringify(result.echantillon, null, 2);
      sample.hidden = false;
    } else {
      sample.hidden = true;
    }
  } catch (error) {
    status.textContent = `Erreur : ${error.message || "réseau"}`;
  }
}

// Le jour du mois d'un secteur tombe parfois un dimanche ou un jour ferie.
// Decision de Tom, 17/09 : on ne deplace pas la date, on PREVIENT -- le choix
// reste humain. Les champs `prochaineDate`, `alerte` et `jourRabattu` sont
// calcules par le serveur a la lecture (GET /api/delivery-sectors) ; rien
// n'est enregistre, et la date planifiee n'est pas modifiee.
function formatDateSeule(ymd) {
  if (!ymd) return "";
  // Midi plutot que minuit : evite qu'un fuseau negatif recule d'un jour.
  const date = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

function avertissementSecteur(sector) {
  const parts = [];
  if (sector.alerte) {
    const quoi = sector.alerte.type === "ferie"
      ? `un jour férié (${sector.alerte.libelle})`
      : "un dimanche";
    parts.push(`La prochaine, le ${formatDateSeule(sector.prochaineDate)}, tombe ${quoi}.`);
  }
  if (sector.jourRabattu) {
    parts.push(`Le mois est trop court : la livraison est ramenée au ${formatDateSeule(sector.prochaineDate)}.`);
  }
  if (!parts.length) return "";
  return `<p class="sector-alerte"><span class="pill pill-warning">À vérifier</span> ${escapeHtml(parts.join(" "))}</p>`;
}

// Planche 13f : les secteurs en pilules de nom seul. La fiche complete reste
// derriere « Gerer les secteurs ».
function renderParSecteursPilules() {
  const pilules = document.getElementById("parSecteursPilules");
  if (!pilules) return;
  const noms = (deliverySectors.length ? deliverySectors : [])
    .map(s => formatSectorLabel(s.secteur || s.name || ""))
    .filter(Boolean);
  pilules.innerHTML = noms.length
    ? noms.map(nom => `<span class="par-pilule">${escapeHtml(nom)}</span>`).join("")
    : `<span class="par-aide">Aucun secteur enregistré.</span>`;
}

// Numerotation des bons (planche 13f) : GET / PATCH /api/settings/order-numbering.
let numerotationChargee = false;
// Le VRAI prochain numero, par la regle du serveur (generateOrderNumber) : le
// plus grand numero existant de ce prefixe (et de cette annee), plus un --
// 3 chiffres par annee, 5 en compteur continu. « -001 » aurait promis un
// numero que le serveur ne donnera jamais sur une base qui a des commandes.
function exempleDeNumero(prefix, resetAnnually) {
  // Le prefixe n'a que des lettres et des chiffres (serveur : ^[A-Z0-9]{2,8}$) :
  // on retire le reste plutot que de l'echapper dans l'expression.
  const p = String(prefix || "CMD").toUpperCase().replace(/[^A-Z0-9]/g, "") || "CMD";
  const annee = String(new Date().getFullYear());
  const motif = resetAnnually ? new RegExp(`^${p}-${annee}-(\\d+)$`) : new RegExp(`^${p}-(\\d+)$`);
  const max = (orders || []).reduce((m, o) => {
    const trouve = String(o.numero || "").match(motif);
    const n = trouve ? Number(trouve[1]) : 0;
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return resetAnnually ? `${p}-${annee}-${String(max + 1).padStart(3, "0")}` : `${p}-${String(max + 1).padStart(5, "0")}`;
}
function majExempleNumero() {
  const prefixe = document.getElementById("parPrefixe")?.value || "";
  const remise = document.getElementById("parRemiseAnnuelle")?.checked;
  setText("parExemple", exempleDeNumero(prefixe || "CMD", remise));
}
async function chargerNumerotation() {
  if (numerotationChargee) return;
  numerotationChargee = true;
  try {
    const reglage = await apiFetch("/api/settings/order-numbering");
    const prefixe = document.getElementById("parPrefixe");
    const remise = document.getElementById("parRemiseAnnuelle");
    if (prefixe) prefixe.value = reglage.prefix || "CMD";
    if (remise) remise.checked = reglage.resetAnnually !== false;
    majExempleNumero();
  } catch {
    numerotationChargee = false;
  }
}
async function enregistrerNumerotation(form) {
  const reglage = await apiFetch("/api/settings/order-numbering", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: form.elements.prefix.value.trim(), resetAnnually: form.elements.resetAnnually.checked })
  });
  form.elements.prefix.value = reglage.prefix;
  form.elements.resetAnnually.checked = reglage.resetAnnually;
  majExempleNumero();
  notify("Numérotation enregistrée.", "success");
}

function renderSettings() {
  updateBrandImageStatus();
  renderTourneeSettings();
  renderParSecteursPilules();
  chargerNumerotation();

  const sectorsContainer = document.getElementById("settingsSectors");
  if (!sectorsContainer) return;

  const planned = deliverySectors.length ? deliverySectors : [
    { id: "preview-besancon", secteur: "Besancon", villePrincipale: "Besancon", jourMois: 25, pointDepart: "Champagnole", frequence: "mensuelle" },
    { id: "preview-champagnole", secteur: "Champagnole", villePrincipale: "Champagnole", jourMois: 5, pointDepart: "Champagnole", frequence: "mensuelle" },
    { id: "preview-dole", secteur: "Dole", villePrincipale: "Dole", jourMois: 15, pointDepart: "Champagnole", frequence: "mensuelle" }
  ];

  sectorsContainer.innerHTML = planned.map(sector => `
    <article class="item status-neutral">
      <div class="item-header">
        <div>
          <h4>${escapeHtml(formatSectorLabel(sector.secteur || sector.name))}</h4>
          <p>${escapeHtml(sector.villePrincipale || "-")} - jour ${escapeHtml(sector.jourMois || "-")} - départ ${escapeHtml(sector.pointDepart || "Champagnole")}</p>
          ${avertissementSecteur(sector)}
        </div>
        <div class="card-actions inline-actions">
          <span class="pill pill-blue">${escapeHtml(sector.frequence || "mensuelle")}</span>
          <button class="button danger compact" type="button" data-action="delete-delivery-sector" data-sector-id="${escapeAttribute(sector.id)}" ${String(sector.id || "").startsWith("preview-") ? "disabled" : ""}>Supprimer</button>
        </div>
      </div>
    </article>
  `).join("");
}

async function saveDeliverySector(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  await apiFetch("/api/delivery-sectors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...data,
      jourMois: Number(data.jourMois || 1),
      pointDepart: data.pointDepart || "Champagnole"
    })
  });
  form.reset();
  if (form.elements.pointDepart) form.elements.pointDepart.value = "Champagnole";
  await loadData();
  notify("Secteur de livraison ajouté.", "success");
}

async function deleteDeliverySector(sectorId) {
  await apiFetch(`/api/delivery-sectors/${encodeURIComponent(sectorId)}`, { method: "DELETE" });
  await loadData();
  notify("Secteur supprimé.", "success");
}

// --- Comptes utilisateurs (V8 phase 1) -------------------------------------

/**
 * Charge l'identite connectee.
 *
 * Volontairement HORS du tableau d'endpoints de loadData : un echec y serait
 * absorbe en degradation partielle et afficherait "Sections indisponibles"
 * a tout le monde. Ici un echec doit rester silencieux et laisser le bloc
 * comptes dans son etat de chargement.
 */
async function loadMoi() {
  try {
    moi = await apiFetch("/api/me");
  } catch {
    // Session expiree : apiFetch a deja redirige vers /login. Tout autre echec
    // laisse `moi` a null, et renderComptes n'affiche simplement rien.
    moi = null;
  }
  renderCompteBarreLaterale();
  // Le titre « Bonjour <identifiant> » depend de /api/me : s'il repond apres
  // le premier rendu, le titre doit suivre.
  majEnteteTableauDeBord(getInitialTab());
  renderComptes();
}

/**
 * Rend le bloc des comptes.
 *
 * Le garde-fou central est de N'APPELER /api/comptes QUE si l'utilisateur est
 * administrateur. L'endpoint repond 403 sinon, ce que le navigateur journalise
 * en erreur console — et le parcours e2e des 15 onglets echoue a la moindre
 * erreur console, sa liste de tolerance etant volontairement vide.
 */
async function renderComptes() {
  const container = document.getElementById("comptesList");
  const form = document.getElementById("compteForm");
  if (!container) return;

  // /api/me n'a pas encore repondu : on laisse le message de chargement.
  if (!moi) return;

  // « Ajouter un compte » (telephone) suit le formulaire qu'il deplie.
  const ajouter = document.getElementById("parAjouterCompte");

  if (!moi.administration) {
    container.innerHTML = gabaritAccesRefuse(moi.roleLibelle || libelleRole(moi.role));
    if (form) form.hidden = true;
    if (ajouter) ajouter.hidden = true;
    return;
  }

  const select = document.getElementById("compteFormRole");
  if (select && !select.options.length) select.innerHTML = optionsRoles("livreur");
  if (form) form.hidden = false;
  if (ajouter) ajouter.hidden = false;

  try {
    comptes = await apiFetch("/api/comptes");
  } catch (error) {
    container.innerHTML = `<p class="muted">Comptes indisponibles : ${escapeHtml(error.message)}</p>`;
    return;
  }

  const entete = moi.source === "desactivee"
    ? gabaritAuthDesactivee()
    : "";

  // Le tableau pour le bureau, les lignes pour le telephone : la feuille de
  // style n'en montre qu'un (planche 8d).
  const tableau = gabaritTableauComptes(comptes, { identifiantCourant: moi.identifiant });
  const lignes = gabaritLignesComptes(comptes, { identifiantCourant: moi.identifiant });
  // Une ligne du telephone avait le focus -- la feuille d'un compte le lui
  // rend en se fermant apres un geste. Le rechargement la redessine : on rend
  // le focus a la meme ligne (ou a sa voisine si le compte a ete supprime),
  // sinon il tombe sur <body> et le clavier repart du haut.
  const anciennes = [...container.querySelectorAll(".par-compte-ligne")];
  const rangFocus = anciennes.indexOf(document.activeElement);
  const idFocus = rangFocus >= 0 ? document.activeElement.dataset.compteId : null;
  container.innerHTML = entete + (lignes
    ? `<div class="par-bureau">${tableau}</div><div class="par-telephone par-comptes-tel">${lignes}</div>`
    : tableau);
  if (rangFocus >= 0) {
    const nouvelles = [...container.querySelectorAll(".par-compte-ligne")];
    const cible = nouvelles.find(l => l.dataset.compteId === idFocus)
      || nouvelles[Math.min(rangFocus, nouvelles.length - 1)]
      || document.getElementById("parAjouterCompte");
    cible?.focus();
  }
}

// La feuille d'un compte (telephone, planche 8d) : ses gestes, un par ligne.
function ouvrirFeuilleCompte(id) {
  const dialogue = document.getElementById("parCompteFeuille");
  const corps = document.getElementById("parCompteFeuilleCorps");
  const compte = comptes.find(c => String(c.id) === String(id));
  if (!dialogue || !corps || !compte || typeof dialogue.showModal !== "function") return;
  setText("parCompteFeuilleTitre", compte.identifiant);
  corps.innerHTML = gabaritFeuilleCompte(compte, { identifiantCourant: moi?.identifiant });
  dialogue.showModal();
}

function fermerFeuillesParametres() {
  for (const id of ["parCompteFeuille", "parImportsFeuille"]) {
    const dialogue = document.getElementById(id);
    if (dialogue?.open) dialogue.close();
  }
}

// « Ajouter un compte » (telephone) : deplie ou replie le formulaire.
function basculerFormulaireCompte(bouton) {
  const bloc = document.getElementById("comptesBlock");
  if (!bloc) return;
  const ouvert = bloc.classList.toggle("par-form-ouvert");
  bouton.setAttribute("aria-expanded", ouvert ? "true" : "false");
  if (ouvert) document.querySelector('#compteForm input[name="identifiant"]')?.focus();
}

// « Ajouter » des secteurs (telephone) : ouvre la fiche et son formulaire.
function ouvrirAjoutSecteur() {
  const details = document.getElementById("parSecteursDetails");
  if (!details) return;
  details.open = true;
  document.querySelector('#deliverySectorForm input[name="secteur"]')?.focus();
}

async function creerCompte(form) {
  const donnees = new FormData(form);
  await apiFetch("/api/comptes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifiant: donnees.get("identifiant"),
      motDePasse: donnees.get("motDePasse"),
      role: donnees.get("role")
    })
  });

  form.reset();
  const select = document.getElementById("compteFormRole");
  if (select) select.innerHTML = optionsRoles("livreur");

  await renderComptes();
  notify("Compte créé.", "success");
}

async function basculerCompte(id, actif) {
  await apiFetch(`/api/comptes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actif })
  });
  await renderComptes();
  notify(actif ? "Compte réactivé." : "Compte désactivé.", "success");
}

async function changerRoleCompte(id, role) {
  await apiFetch(`/api/comptes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role })
  });
  await renderComptes();
  notify(`Rôle changé en « ${libelleRole(role)} ».`, "success");
}

async function changerMotDePasseCompte(id, identifiant) {
  const motDePasse = window.prompt(`Nouveau mot de passe pour « ${identifiant} » (10 caractères minimum)`);
  // Annulation explicite : on ne touche a rien.
  if (motDePasse === null) return;

  await apiFetch(`/api/comptes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ motDePasse })
  });
  notify("Mot de passe changé.", "success");
}

async function supprimerCompte(id, identifiant) {
  if (!window.confirm(`Supprimer définitivement le compte « ${identifiant} » ?`)) return;

  await apiFetch(`/api/comptes/${encodeURIComponent(id)}`, { method: "DELETE" });
  await renderComptes();
  notify("Compte supprimé.", "success");
}

// v1.12.0 : historique des fichiers Excel importes (archives auto).
// Charge dynamiquement via /api/imports/archives a chaque render pour rester
// a jour apres un nouvel import. Affiche un tableau avec date, type, nom,
// stats et bouton de telechargement.
async function renderImportsArchives() {
  const container = document.getElementById("importsArchivesList");
  if (!container) return;

  try {
    const archives = await apiFetch("/api/imports/archives");

    archivesImports = archives;

    if (!archives.length) {
      container.innerHTML = `<p class="muted">Aucun import archivé pour l'instant. Tes prochains imports apparaitront ici.</p>`;
      return;
    }

    container.innerHTML = gabaritLignesImports(archives) + `
      <div class="imports-archives-table-wrap par-bureau">
        <table class="imports-archives-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Fichier</th>
              <th class="imports-num">Lignes</th>
              <th class="imports-num">Taille</th>
              <th>Stats</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${archives.map(a => `
              <tr>
                <td class="muted">${escapeHtml(formatDateTimeShort(a.importedAt))}</td>
                <td>${a.type === "ventes" ? "📋 Ventes" : "📦 Stock"}</td>
                <td class="imports-filename">${escapeHtml(a.filename || "—")}</td>
                <td class="imports-num">${escapeHtml(a.rowsCount ?? "—")}</td>
                <td class="imports-num muted">${formatFileSize(a.fileSize)}</td>
                <td class="muted imports-stats">${formatImportStats(a.stats, a.type)}</td>
                <td>
                  <a class="button secondary compact" href="/api/imports/archives/${encodeURIComponent(a.id)}/download" download="${escapeAttribute(a.filename || "import.xlsx")}">
                    ⬇ Télécharger
                  </a>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    container.innerHTML = `<p class="muted">Impossible de charger l'historique : ${escapeHtml(error.message || "erreur réseau")}</p>`;
  }
}

// Les archives lues au dernier rendu : la feuille du telephone s'en sert.
let archivesImports = [];

// « 16 septembre à 8 h 42 » (planche 8d) -- l'annee en cours se tait. Une
// autre annee se dit : les archives ne sont jamais purgees, et un import d'il
// y a un an, sans son annee, se lirait comme un import de la semaine.
function formatDateLongue(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "—";
  const options = { day: "numeric", month: "long" };
  if (d.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  const jour = d.toLocaleDateString("fr-FR", options);
  return `${jour} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

// « 1 ligne », « 38 lignes » ; un nombre inconnu garde « — lignes ».
function nombreDeLignes(n) {
  if (n === null || n === undefined || n === "" || !Number.isFinite(Number(n))) return "— lignes";
  return `${n} ligne${Number(n) > 1 ? "s" : ""}`;
}

// Au telephone (planche 8d), des lignes a la place du tableau : le dernier
// import de ventes, le dernier de stock, les archives. Chacune ouvre la
// feuille qui liste les fichiers et les rend telechargeables.
function gabaritLignesImports(archives) {
  const ligne = (type, titre, meta) => `
    <li>
      <button type="button" class="par-ligne" data-action="par-ouvrir-imports" data-type="${type}">
        <span class="par-ligne-texte">
          <span class="par-ligne-titre">${titre}</span>
          <span class="par-ligne-meta">${escapeHtml(meta)}</span>
        </span>
        ${CHEVRON_LIGNE}
      </button>
    </li>`;
  const dernier = type => archives.find(a => a.type === type);
  const ventes = dernier("ventes");
  const stock = dernier("stock");
  const n = archives.length;
  return `
    <ul class="par-imports-lignes par-telephone" aria-label="Imports et archives">
      ${ventes ? ligne("ventes", "Dernier import de ventes", `${formatDateLongue(ventes.importedAt)} · ${nombreDeLignes(ventes.rowsCount ?? 0)}`) : ""}
      ${stock ? ligne("stock", "Dernier import de stock", `${formatDateLongue(stock.importedAt)} · ${nombreDeLignes(stock.rowsCount ?? 0)}`) : ""}
      ${ligne("", "Archives", `${n} fichier${n > 1 ? "s" : ""} conservé${n > 1 ? "s" : ""}`)}
    </ul>
  `;
}

// La feuille des imports : les fichiers d'un type (ou tous), du plus recent au
// plus ancien, chacun telechargeable -- ce que porte le tableau du bureau.
function ouvrirFeuilleImports(type) {
  const dialogue = document.getElementById("parImportsFeuille");
  const corps = document.getElementById("parImportsFeuilleCorps");
  if (!dialogue || !corps || typeof dialogue.showModal !== "function") return;
  const liste = type ? archivesImports.filter(a => a.type === type) : archivesImports;
  setText("parImportsFeuilleTitre", type === "ventes" ? "Imports de ventes" : type === "stock" ? "Imports de stock" : "Archives");
  corps.innerHTML = `
    <p class="par-aide">Chaque fichier .xlsx importé est archivé et reste téléchargeable.</p>
    <ul class="par-archives">
      ${liste.map(a => `
        <li class="par-archive">
          <span class="par-ligne-texte">
            <span class="par-ligne-titre par-archive-nom">${escapeHtml(a.filename || "—")}</span>
            <span class="par-ligne-meta">${escapeHtml(formatDateLongue(a.importedAt))} · ${a.type === "ventes" ? "Ventes" : "Stock"} · ${escapeHtml(nombreDeLignes(a.rowsCount))} ·${formatFileSize(a.fileSize)}</span>
            <span class="par-ligne-meta">${formatImportStats(a.stats, a.type)}</span>
          </span>
          <a class="button secondary compact" href="/api/imports/archives/${encodeURIComponent(a.id)}/download" download="${escapeAttribute(a.filename || "import.xlsx")}" aria-label="Télécharger ${escapeAttribute(a.filename || "le fichier")}">Télécharger</a>
        </li>
      `).join("")}
    </ul>
  `;
  dialogue.showModal();
}

function formatDateTimeShort(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch {
    return String(iso).slice(0, 16).replace("T", " ");
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes < 0) return "—";
  const KB = 1024;
  if (bytes < KB) return `${bytes} o`;
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(1)} ko`;
  return `${(bytes / KB / KB).toFixed(2)} Mo`;
}

function formatImportStats(stats, type) {
  if (!stats || typeof stats !== "object") return "—";
  if (type === "ventes") {
    const parts = [];
    if (stats.created) parts.push(`${stats.created} créées`);
    if (stats.updated) parts.push(`${stats.updated} maj`);
    if (stats.skippedIdentical) parts.push(`${stats.skippedIdentical} idem`);
    if (stats.importedAsLivre) parts.push(`${stats.importedAsLivre} déjà livrées`);
    return parts.join(", ") || "—";
  }
  if (type === "stock") {
    const parts = [];
    if (stats.created) parts.push(`${stats.created} créés`);
    if (stats.updated) parts.push(`${stats.updated} maj`);
    if (stats.preserved) parts.push(`${stats.preserved} préservés`);
    if (stats.duplicatesSkipped) parts.push(`${stats.duplicatesSkipped} doublons`);
    return parts.join(", ") || "—";
  }
  return "—";
}

// v1.12.0 : handler du bouton "Purger les bons de commande" en Parametres.
// Double confirmation (window.confirm) avant l'appel API destructif.
async function purgeOrdersHandler(btn) {
  const msg = [
    "⚠️ ATTENTION — action irréversible",
    "",
    "Tu vas supprimer définitivement :",
    "  • toutes les commandes / bons de commande",
    "  • tous les clients",
    "  • toutes les ventes importées",
    "  • toutes les tournées",
    "",
    "Le stock et l'historique sont préservés.",
    "Les archives Excel restent téléchargeables.",
    "",
    "Continuer ?"
  ].join("\n");

  if (!window.confirm(msg)) return;
  if (!window.confirm("Es-tu vraiment sûr ? Tape OK pour confirmer.")) return;

  await runAction(btn, "Purge en cours...", async () => {
    const result = await apiFetch("/api/orders/purge", { method: "POST" });
    notify(
      `Purge OK : ${result.purged.commandes} bon(s), ${result.purged.clients} client(s), ${result.purged.ventes} vente(s), ${result.purged.routes} tournée(s) supprimés. Va dans Imports et archives ci-dessus pour ré-importer tes Excel.`,
      "success"
    );
    await loadData();
  });
}

function renderDeliveryFilters() {
  const select = document.getElementById("deliverySector");
  if (!select) return;

  const current = deliveryFilter.sector || select.value || "Tous";
  const options = [{ name: "Tous", total: orders.length, ready: getDeliverableOrders().length }, ...sectors];

  select.innerHTML = options.map(sector => `
    <option value="${escapeAttribute(sector.name)}" ${sector.name === current ? "selected" : ""}>
      ${escapeHtml(formatSectorLabel(sector.name))} (${sector.ready || 0})
    </option>
  `).join("");

  const cityInput = document.getElementById("deliveryCity");
  if (cityInput && cityInput.value !== deliveryFilter.city) {
    cityInput.value = deliveryFilter.city;
  }

  const dateInput = document.getElementById("deliveryDate");
  if (dateInput && dateInput.value !== deliveryFilter.date) {
    dateInput.value = deliveryFilter.date;
  }
}

function applyDeliveryFilter() {
  deliveryFilter = {
    date: document.getElementById("deliveryDate")?.value || "",
    sector: document.getElementById("deliverySector")?.value || "Tous",
    city: document.getElementById("deliveryCity")?.value || ""
  };
  deliverySelection = new Set([...deliverySelection].filter(orderId => getFilteredDeliveryOrders().some(order => String(order.id) === String(orderId))));
  renderDeliveryCandidates();
  renderMap();
}

function getDeliverableOrders() {
  return orders.filter(order => ["pret_livraison", "a_reprogrammer"].includes(order.status));
}

function getFilteredDeliveryOrders() {
  const cityKey = normalizeTextKey(deliveryFilter.city);
  const sectorKey = normalizeTextKey(deliveryFilter.sector);

  return getDeliverableOrders().filter(order => {
    if (deliveryFilter.date && order.deliveryDate && order.deliveryDate !== deliveryFilter.date) return false;
    if (deliveryFilter.date && !order.deliveryDate) return false;
    if (sectorKey && sectorKey !== "tous" && normalizeTextKey(order.sector) !== sectorKey) return false;
    if (cityKey && normalizeTextKey(order.city) !== cityKey) return false;
    return true;
  });
}

function renderDeliveryCandidates() {
  const container = document.getElementById("deliveryCandidates");
  if (!container) return;
  // Avant les commandes, une liste filtree vide ne prouve rien : on laisse le
  // squelette pose par poserSquelettes() au lieu d'affirmer « Aucune commande
  // prête à livrer ». Le filtre choisi entre-temps est garde et s'appliquera
  // au rendu de loadData().
  if (!commandesChargees) return;

  const filtered = getFilteredDeliveryOrders();
  const summary = document.getElementById("deliveryFilterSummary");
  if (summary) {
    const sector = deliveryFilter.sector && deliveryFilter.sector !== "Tous" ? formatSectorLabel(deliveryFilter.sector) : "tous secteurs";
    const city = deliveryFilter.city ? `, ville ${deliveryFilter.city}` : "";
    const date = deliveryFilter.date ? `, ${formatDeliveryDate(deliveryFilter.date)}` : "";
    summary.textContent = `${filtered.length} commande(s) prête(s) - ${sector}${city}${date}`;
  }

  updateSelectedDeliveryCount();

  if (!filtered.length) {
    container.innerHTML = emptyState("Aucune commande prête à livrer", "Termine des préparations ou change le filtre de secteur.");
    return;
  }

  container.innerHTML = "";
  filtered.forEach(order => {
    const label = document.createElement("label");
    label.className = "delivery-card";
    label.innerHTML = `
      <input type="checkbox" data-delivery-order="${escapeAttribute(order.id)}" ${deliverySelection.has(String(order.id)) ? "checked" : ""}>
      <span class="delivery-card-body">
        <span class="delivery-card-title">${escapeHtml(order.clientName)}</span>
        <span class="delivery-card-court">${escapeHtml([order.numero, articlesDeCommande(order)].filter(Boolean).join(" · "))}</span>
        <span class="delivery-card-contexte">${escapeHtml(contexteDeCommandePrete(order))}</span>
        <span class="delivery-card-adresse">${escapeHtml(formatOrderAddress(order))}</span>
        <span class="order-meta">
          <span>${escapeHtml(formatSectorLabel(order.sector))}</span>
          <span>${escapeHtml(order.deliveryDate ? formatDeliveryDate(order.deliveryDate) : "Sans date")}</span>
          <span>${escapeHtml(formatPhone(order.phone))}</span>
          <span>${escapeHtml(getOrderProductCount(order))} produit(s)</span>
          <span>${escapeHtml(order.priority || "Priorité normale")}</span>
        </span>
        ${getAddressWarning(order) ? `<span class="address-warning">${escapeHtml(getAddressWarning(order))}</span>` : ""}
      </span>
      <span class="pill ${getOrderPill(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span>
    `;
    container.appendChild(label);
  });
}

/**
 * Planche 4a, au telephone : ce qui DISTINGUE deux commandes pretes du meme
 * client. La planche n'en a pas besoin (son en-tete dit le jour) ; ici le
 * filtre par defaut melange les dates et les secteurs, et la ligne n'a pas de
 * detail ou les lire. Le jour et le secteur toujours ; la priorite si elle
 * n'est pas la normale ; « A reprogrammer », seul statut qui n'est pas « Pret ».
 */
function contexteDeCommandePrete(order) {
  const priorite = String(order.priority || "").trim();
  return [
    order.deliveryDate ? formatDeliveryDate(order.deliveryDate) : "Sans date",
    formatSectorLabel(order.sector),
    priorite && !/normal/i.test(priorite) ? priorite : "",
    order.status === "a_reprogrammer" ? formatOrderStatus(order.status) : ""
  ].filter(Boolean).join(" · ");
}

function setDeliverySelection(orderId, checked) {
  if (checked) deliverySelection.add(String(orderId));
  else deliverySelection.delete(String(orderId));

  updateSelectedDeliveryCount();
  renderMap();
}

function updateSelectedDeliveryCount() {
  const element = document.getElementById("selectedDeliveryCount");
  if (element) element.textContent = `${deliverySelection.size} sélection`;

  const createButton = document.getElementById("createRouteButton");
  if (createButton) {
    createButton.disabled = deliverySelection.size === 0;
    createButton.title = deliverySelection.size === 0 ? "Sélectionnez au moins un client pour créer une tournée" : "";
  }
}

/**
 * Les boutons de selection de la tournee naissent desactives (index.html,
 * `data-attend-commandes`) : touches avant l'arrivee des commandes, ils
 * selectionnaient une liste vide, et le geste etait perdu sans rien dire -- les
 * commandes arrivaient decochees. Un bouton desactive le dit ; loadData() les
 * active des que les commandes sont la.
 */
function activerSelectionLivraison() {
  for (const bouton of document.querySelectorAll("[data-attend-commandes]")) bouton.disabled = false;
}

function selectAllDelivery(checked) {
  if (checked) {
    getFilteredDeliveryOrders().forEach(order => deliverySelection.add(String(order.id)));
  } else {
    deliverySelection.clear();
  }

  renderDeliveryCandidates();
  renderMap();
}

function selectCurrentSector() {
  deliverySelection.clear();
  getFilteredDeliveryOrders().forEach(order => deliverySelection.add(String(order.id)));
  renderDeliveryCandidates();
  renderMap();
}

async function createDeliveryRoute() {
  const orderIds = [...deliverySelection];

  if (!orderIds.length) {
    notify("Sélectionnez au moins un client pour créer une tournée.", "warning");
    return;
  }

  const points = getRoutePoints();
  activeRoute = await apiFetch("/api/routes", {
    method: "POST",
    timeoutMs: 90000,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...points,
      sector: deliveryFilter.sector,
      city: deliveryFilter.city,
      deliveryDate: deliveryFilter.date,
      orderIds
    })
  });

  activeStopIndex = 0;
  deliverySelection.clear();
  await loadData();
  showTab("livreur");
  notify("Tournée optimisée créée.", "success");
}

async function startActiveRoute() {
  if (!activeRoute) {
    notify("Crée une tournée avant de la démarrer.", "warning");
    return;
  }

  if (activeRoute.departure && !activeRoute.geometry) await recalculateRoute();
  activeRoute = await apiFetch(`/api/routes/${encodeURIComponent(activeRoute.id)}/start`, {
    method: "POST"
  });
  activeStopIndex = 0;
  await loadData();
  notify("Tournée démarrée.", "success");
}

function renderRoute() {
  const list = document.getElementById("routeStopsList");
  const current = document.getElementById("currentClient");
  const metrics = document.getElementById("routeMetrics");

  if (!list || !current) return;

  if (!activeRoute || !activeRoute.stops?.length) {
    list.innerHTML = emptyState("Aucune tournée créée", "Sélectionnez des commandes prêtes, puis créez une tournée optimisée.");
    current.textContent = "Aucune tournée créée.";
    if (metrics) metrics.textContent = "Distance estimée indisponible.";
    document.querySelectorAll('[data-op="recalculate-route"]').forEach(bouton =>
      bouton.classList.remove("trn-recalculer--requis"));
    setButtonDisabled("startRouteButton", true);
    updateDriverActionButtons(null);
    return;
  }

  if (metrics) metrics.textContent = formatRouteMetrics(activeRoute);
  // Planche 4c : sans trace routier (reordonnee a la main, ou jamais calculee),
  // la carte dessine un pointille ; « Recalculer le trace » se signale alors,
  // cercle d'accent. Meme critere que renderMap : la geometrie.
  // Seulement AVANT le depart : le serveur refuse le recalcul d'une tournee
  // partie (« Recalcule avant le départ. ») -- un cercle y inviterait a un refus.
  const traceARefaire = activeRoute.status === "prete" && !activeRoute.geometry?.coordinates;
  document.querySelectorAll('[data-op="recalculate-route"]').forEach(bouton =>
    bouton.classList.toggle("trn-recalculer--requis", traceARefaire));
  setButtonDisabled("startRouteButton", activeRoute.status === "en_livraison" || isRouteComplete(activeRoute));

  const nextPendingIndex = activeRoute.stops.findIndex(stop => !isStopTerminal(stop.status));
  if (nextPendingIndex >= 0 && isStopTerminal(activeRoute.stops[activeStopIndex]?.status)) {
    activeStopIndex = nextPendingIndex;
  }

  list.innerHTML = "";
  activeRoute.stops.forEach((stop, index) => {
    const row = document.createElement("article");
    row.className = `route-stop ${index === activeStopIndex ? "active-stop" : ""}`;
    // Charte §4, ligne de liste : QUATRE informations. Le marqueur (rang +
    // etat), le nom, une ligne de detail, le badge. Pour un arret en echec,
    // le motif REMPLACE l'adresse -- comme « Il manque 2 articles » sur la
    // planche Preparation -- au lieu de s'ajouter en cinquieme.
    const detail = stop.problemReason
      ? `<span class="route-stop-motif">${escapeHtml(stop.problemReason)}</span>`
      : `<span title="${escapeAttribute(formatStopAddress(stop))}">${escapeHtml(formatStopMeta(stop))}</span>`;
    // Les fleches ne sont rendues QUE quand la tournee se reordonne encore.
    // Avant, deux boutons de 60 px etaient rendus desactives sur chaque
    // ligne d'une tournee en cours : 120 px de vide par arret.
    const reordonnable = activeRoute.status === "prete";
    row.innerHTML = `
      <button class="route-stop-main" type="button" data-action="select-stop" data-stop-index="${index}">
        ${marqueurHtml(stop, index)}
        <span class="route-stop-corps">
          <strong>${escapeHtml(stop.clientName)}</strong>
          ${detail}
        </span>
        <span class="pill ${getStopPill(stop.status)}">${escapeHtml(formatStopStatus(stop.status))}</span>
      </button>
      ${reordonnable ? `
      <div class="route-stop-actions">
        <button class="button secondary compact" type="button" data-action="move-stop-up" data-stop-id="${escapeAttribute(stop.id)}" aria-label="Monter l’arrêt ${index + 1}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="button secondary compact" type="button" data-action="move-stop-down" data-stop-id="${escapeAttribute(stop.id)}" aria-label="Descendre l’arrêt ${index + 1}" ${index === activeRoute.stops.length - 1 ? "disabled" : ""}>↓</button>
      </div>` : ""}
    `;
    list.appendChild(row);
  });

  if (isRouteComplete(activeRoute)) {
    showRouteCompleted(activeRoute);
  } else {
    showCurrentStop(activeRoute.stops[activeStopIndex]);
  }
}

function selectStop(index) {
  if (!activeRoute || !activeRoute.stops[index]) return;
  activeStopIndex = index;
  renderRoute();
  focusEntity(activeRoute.stops[activeStopIndex]);
  updateRouteProgress();
}

async function moveStop(stopId, direction) {
  if (!activeRoute) return;

  const index = activeRoute.stops.findIndex(stop => String(stop.id) === String(stopId));
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= activeRoute.stops.length) return;

  const nextStops = [...activeRoute.stops];
  const [moved] = nextStops.splice(index, 1);
  nextStops.splice(nextIndex, 0, moved);

  activeRoute = await apiFetch(`/api/routes/${encodeURIComponent(activeRoute.id)}/reorder`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      stopIds: nextStops.map(stop => stop.id)
    })
  });

  activeStopIndex = nextIndex;
  await loadData();
  notify("Ordre de tournée mis à jour.", "success");
}

function showCurrentStop(stop) {
  const container = document.getElementById("currentClient");
  if (!container) return;

  if (!stop) {
    container.textContent = "Aucun arrêt sélectionné.";
    updateDriverActionButtons(null);
    return;
  }

  // Planche Main.png : l'etat (un point + un mot), le nom en grand, l'adresse
  // avec son epingle, puis les articles a decharger avec leur quantite en
  // disque. Le point est en ACCENT, le mot en principal : la charte interdit
  // l'accent en texte (2,34:1), la planche l'y mettait -- la charte l'emporte.
  const index = activeRoute ? activeRoute.stops.indexOf(stop) : -1;
  const etat = etatDeLArret(stop, index);
  const lignes = (stop.products || []).length;
  const articles = lignes ? `
    <div class="arret-articles">
      <p class="arret-articles-titre">${lignes === 1 ? "1 article" : `${lignes} articles`} à décharger</p>
      ${(stop.products || []).map(produit => {
        const quantite = typeof produit === "object" ? produit.quantite || produit.quantity || 1 : 1;
        const nom = typeof produit === "object" ? produit.nom || produit.produit || produit.code || "Produit" : produit;
        return `<div class="arret-article"><span class="marqueur marqueur--plein" aria-hidden="true">${escapeHtml(quantite)}</span><span>${escapeHtml(nom)}</span><span class="sr-only">, quantité ${escapeHtml(quantite)}</span></div>`;
      }).join("")}
    </div>` : "";

  // Planche 4b : « Prochain : <client> ». La distance et la duree du trajet
  // (« 6,2 km · environ 14 min ») ne sont calculees nulle part par arret :
  // omises. La ville la remplace.
  const suivant = activeRoute
    ? activeRoute.stops.find((s, i) => i > index && !isStopTerminal(s.status))
    : null;
  const prochain = suivant ? `
    <p class="arret-prochain"><span class="arret-prochain-mot">Prochain : ${escapeHtml(suivant.clientName)}</span>${suivant.city ? `<span class="arret-prochain-lieu">${escapeHtml(formatSectorLabel(suivant.city))}</span>` : ""}</p>` : "";

  container.innerHTML = `
    <div class="current-client-main arret">
      <p class="arret-etat arret-etat--${etat.classe}"><span class="arret-etat-point" aria-hidden="true"></span>${escapeHtml(etat.mot)}</p>
      <strong class="arret-nom">${escapeHtml(stop.clientName)}</strong>
      <p class="arret-adresse">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>${escapeHtml(formatStopAddress(stop))}</span>
      </p>
      ${stop.phone ? `<p class="arret-secondaire">${escapeHtml(formatPhone(stop.phone))}</p>` : ""}
      ${stop.notes ? `<span class="current-client-note">${escapeHtml(stop.notes)}</span>` : ""}
      ${getAddressWarning(stop) ? `<span class="address-warning">${escapeHtml(getAddressWarning(stop))}</span>` : ""}
    </div>
    ${articles}
    ${prochain}
  `;
  updateDriverActionButtons(stop);
}

/**
 * L'etat d'un arret pour la carte de l'arret en cours : un point et un mot.
 * Le mot est celui de la charte (statuts d'arret) ; le point prend la
 * couleur de l'etat du marqueur.
 */
function etatDeLArret(stop, index) {
  const marqueur = marqueurEtat(stop, index);
  if (marqueur === "en-cours") return { classe: "en-cours", mot: "Arrêt en cours" };
  if (marqueur === "fait") return { classe: "fait", mot: "Livré" };
  if (marqueur === "echec") return { classe: "echec", mot: formatStopStatus(stop.status) };
  return { classe: "a-venir", mot: stop.status === "a_reprogrammer" ? "À reprogrammer" : "Arrêt à venir" };
}

function showRouteCompleted(routeData) {
  const container = document.getElementById("currentClient");
  if (!container) return;

  const delivered = routeData.stops.filter(stop => stop.status === "livre").length;
  const absent = routeData.stops.filter(stop => stop.status === "absent").length;
  const problems = routeData.stops.filter(stop => ["probleme", "a_reprogrammer"].includes(stop.status)).length;

  // Planche 4d : les trois chiffres, les problemes NOMMES, le lien vers
  // l'arrivee. Pas de fete. Les heures de debut et de fin existent
  // (startedAt, completedAt) ; les kilometres « parcourus » non -- la
  // distance connue est celle du trace prevu, pas celle roulee : omise.
  const heure = valeur => {
    const date = valeur ? new Date(valeur) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" }).replace(":", " h ")
      : "";
  };
  const debut = heure(routeData.startedAt);
  const fin = heure(routeData.completedAt);
  // « Tournee Besancon du mercredi 16 septembre » ; sans secteur, « Tournee du
  // mercredi... » (et non « Tournee du jour du mercredi »).
  const secteur = routeData.sector && routeData.sector !== "Tous" ? ` ${formatSectorLabel(routeData.sector)}` : "";
  const jour = formatJourDeTournee(routeData.deliveryDate).toLowerCase();
  const phrase = `Tournée${secteur} du ${jour}${debut && fin ? `, de ${debut} à ${fin}` : ""}.`;
  const enEchec = routeData.stops.filter(stop => ["absent", "probleme", "a_reprogrammer"].includes(stop.status));
  const chiffre = (libelle, valeur, classe = "") => `
        <div class="fin-chiffre ${classe}"><span class="fin-chiffre-libelle">${libelle}</span><strong>${escapeHtml(valeur)}</strong></div>`;

  container.innerHTML = `
    <div class="route-complete fin-tournee">
      <strong class="fin-titre">Tournée terminée</strong>
      <p class="fin-phrase">${escapeHtml(phrase)}</p>
      <div class="fin-chiffres">
        ${chiffre("Livrés", delivered)}
        ${chiffre(absent > 1 ? "Clients absents" : "Client absent", absent, absent ? "fin-chiffre--echec" : "")}
        ${chiffre(problems > 1 ? "Problèmes" : "Problème", problems, problems ? "fin-chiffre--echec" : "")}
      </div>
      ${enEchec.length ? `
      <ul class="fin-problemes" aria-label="Arrêts non livrés">
        ${enEchec.map(stop => `<li><strong>${escapeHtml(stop.clientName)}</strong><span>${escapeHtml(stop.problemReason || formatStopStatus(stop.status))}</span></li>`).join("")}
      </ul>` : ""}
      ${routeData.arrival ? `<p class="fin-arrivee"><span class="fin-chiffre-libelle">Arrivée</span><span>${escapeHtml(routeData.arrival.label || "Point choisi")}</span><a class="button primary" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${routeData.arrival.lat},${routeData.arrival.lng}`)}" target="_blank" rel="noopener noreferrer">Y aller</a></p>` : ""}
      <div class="quick-actions">
        <button class="button primary" type="button" data-action="go-tab" data-target-tab="journee">Retour accueil</button>
        <button class="button secondary" type="button" data-action="go-tab" data-target-tab="recommande">Voir à recommander</button>
      </div>
    </div>
  `;
  updateDriverActionButtons(null);
}

// --- LE MOTIF D'UN ARRET EN ECHEC -------------------------------------------
//
// Ce que la mesure du 18/09 a montre, et que la charte disait de travers.
// `stop.problemReason` EXISTAIT cote serveur. Mais il etait ecrit a un seul
// endroit, LU NULLE PART, et ce qu'il enregistrait n'etait pas une raison :
// faute de notes envoyees, il retombait sur `stop.notes`, c'est-a-dire sur les
// INSTRUCTIONS DE LIVRAISON de la commande, recopiees a la creation de l'arret.
// Marquer un probleme sur une commande portant « code portail 1234 »
// enregistrait « code portail 1234 » comme cause du probleme.
//
// Le livreur, lui, n'avait aucun moyen de dire quoi que ce soit : ce fichier
// envoyait `{ status }` et rien d'autre.

const STATUTS_DEMANDANT_UN_MOTIF = new Set(["absent", "probleme", "a_reprogrammer"]);

let motifsProbleme = null;

/**
 * La liste vient du SERVEUR, jamais d'une copie locale. Deux listes derivent, et
 * l'ecart ne se verrait qu'au premier refus -- sur le telephone d'un livreur,
 * au pire moment.
 */
async function chargerMotifsProbleme() {
  if (motifsProbleme) return motifsProbleme;
  const data = await apiFetch("/api/delivery-problems");
  motifsProbleme = Array.isArray(data?.motifs) ? data.motifs : [];
  return motifsProbleme;
}

/**
 * Demande un motif au livreur. Rend `{ cle, commentaire }`, ou `null` s'il
 * renonce -- et renoncer ANNULE le changement de statut. C'est deliberé : un
 * arret marque en echec sans raison est exactement ce qu'on vient de corriger.
 */
function demanderMotif(status, motifs) {
  const dialogue = document.getElementById("motifProblemeDialog");
  const liste = document.getElementById("motifListe");
  const champ = document.getElementById("motifCommentaire");
  if (!dialogue || !liste || !champ || typeof dialogue.showModal !== "function") {
    // Pas de dialogue utilisable : on laisse passer SANS motif plutot que de
    // bloquer le livreur. Le serveur accepte, et l'etiquette generique dira
    // honnetement que personne n'a explique.
    return Promise.resolve(null);
  }

  const admis = motifs.filter(m => m.statutsAdmis.includes(status));
  let choisi = "";
  champ.value = "";
  liste.innerHTML = "";
  for (const m of admis) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "motif-choix";
    bouton.setAttribute("role", "radio");
    bouton.setAttribute("aria-checked", "false");
    bouton.dataset.motifCle = m.cle;
    bouton.textContent = m.libelle;
    liste.appendChild(bouton);
  }

  const sousTitre = document.getElementById("motifSousTitre");
  if (sousTitre) sousTitre.textContent = `Statut : ${formatStopStatus(status)}. Cette raison sera archivée avec la tournée.`;

  return new Promise(resolve => {
    const surClic = evenement => {
      const choix = evenement.target.closest("[data-motif-cle]");
      if (choix) {
        choisi = choix.dataset.motifCle;
        liste.querySelectorAll("[data-motif-cle]").forEach(b =>
          b.setAttribute("aria-checked", String(b === choix)));
        return;
      }
      const action = evenement.target.closest("[data-action]")?.dataset.action;
      if (action === "motif-annuler") terminer(null);
      if (action === "motif-valider") {
        if (!choisi) {
          notify("Choisis une raison, ou annule.", "warning");
          return;
        }
        terminer({ cle: choisi, commentaire: champ.value.trim() });
      }
    };
    // Echap ferme le `<dialog>` natif : c'est une ANNULATION, pas une validation
    // muette. Sans cet ecouteur, la promesse resterait pendante pour toujours et
    // le bouton du livreur resterait desactive par runAction().
    const surFermeture = () => terminer(null);

    function terminer(valeur) {
      dialogue.removeEventListener("click", surClic);
      dialogue.removeEventListener("close", surFermeture);
      if (dialogue.open) dialogue.close();
      resolve(valeur);
    }

    dialogue.addEventListener("click", surClic);
    dialogue.addEventListener("close", surFermeture);
    dialogue.showModal();
  });
}

/** Le geste complet : demander la raison, puis envoyer. */
async function marquerArret(status) {
  // Une livraison en suspens part d'abord : jamais deux gestes en attente.
  // Le geste vise l'arret de l'ecran a l'appui ; si l'attente l'a change, on
  // n'agit pas sur un autre.
  const vise = activeRoute ? arretVise() : null;
  await solderLivraisonEnSuspens();
  if (vise && !arretToujoursVise(vise)) return;
  let motif = null;
  if (STATUTS_DEMANDANT_UN_MOTIF.has(status)) {
    let motifs = [];
    try {
      motifs = await chargerMotifsProbleme();
    } catch {
      // Le serveur ne repond pas : on n'empeche pas le livreur d'avancer.
      motifs = [];
    }
    if (motifs.length) {
      motif = await demanderMotif(status, motifs);
      if (motif === null) return;   // il a renonce : le statut ne change pas
    }
  }
  await updateCurrentDeliveryStatus(status, motif);
}

async function updateCurrentDeliveryStatus(status, motif = null) {
  if (activeRoute) {
    const stop = activeRoute.stops[activeStopIndex];
    if (!stop) {
      notify("Aucun arrêt sélectionné.", "warning");
      return;
    }

    const result = await apiFetch(`/api/routes/${encodeURIComponent(activeRoute.id)}/stops/${encodeURIComponent(stop.id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status, motif })
    });

    activeRoute = result.route;
    if (activeStopIndex < activeRoute.stops.length - 1) activeStopIndex++;
    await loadData();
    notify("Statut livraison enregistré.", "success");
    return;
  }

  await updateLegacyClientDeliveryStatus(status);
}

// --- « LIVRE », SANS CONFIRMATION, AVEC ANNULER (planche 4b) ------------------
//
// La planche : « Passage automatique a l'arret suivant, toast "Livre --
// <client>" avec Annuler pendant 4 s. Pas de confirmation : l'action est
// reversible tant que le toast est la. »
//
// Le serveur, lui, ne sait PAS defaire une livraison : dans la machine d'etat
// des commandes, `livre` n'a aucune sortie (livre: []), et la livraison
// consomme la reservation de stock. Plutot que d'ouvrir une transition
// livre -> en_livraison cote serveur (et de defaire une consommation de
// stock), l'ENVOI est differe : l'arret passe a « Livre » a l'ecran tout de
// suite, la tournee avance, et le PATCH ne part qu'au terme des 4 s. Annuler
// dans ce delai n'a donc rien a defaire cote serveur.
//
// Ce qui force l'envoi avant le terme : un autre geste d'arret (on ne garde
// jamais deux livraisons en suspens), et la page qui passe en arriere-plan
// (verrouillage du telephone, appel, Google Maps ouvert par « Y aller »).
let livraisonEnSuspens = null;
// L'envoi en route d'une livraison (sa promesse), du PATCH a la fin du
// rechargement. Un geste d'arret l'attend avant d'agir.
let envoiLivraison = null;
// Pendant cette attente, les gestes d'arret sont desactives (gestesVerrouilles,
// declare en tete : updateDriverActionButtons le lit des le premier rendu).
// Le bouton ne se desactive pas (l'arret suivant le reprend aussitot) : un
// double appui livrerait DEUX arrets. Un second appui trop proche est ignore.
const LIVRE_DOUBLE_APPUI_MS = 700;
let dernierAppuiLivre = 0;

/** L'arret que le livreur a sous les yeux au moment de son geste. */
function arretVise() {
  const stop = activeRoute?.stops[activeStopIndex];
  return stop ? { routeId: String(activeRoute.id), stopId: String(stop.id) } : null;
}

/** Cet arret est-il encore celui de l'ecran ? (apres une attente reseau) */
function arretToujoursVise(vise) {
  const stop = activeRoute?.stops[activeStopIndex];
  return Boolean(vise && stop && String(activeRoute.id) === vise.routeId && String(stop.id) === vise.stopId);
}

/**
 * Avant un geste d'arret : la livraison en suspens part, et tout envoi deja en
 * route est attendu. Hors ligne, la livraison est mise en file -- ce n'est pas
 * un echec : on l'annonce, et le geste continue (il n'etait pas perdu, le
 * suivant non plus). Un refus du serveur, lui, arrete le geste : l'ecran vient
 * d'etre recharge.
 */
async function solderLivraisonEnSuspens() {
  const lanceIci = Boolean(livraisonEnSuspens);
  const envoi = lanceIci ? envoyerLivraisonEnSuspens() : envoiLivraison;
  if (!envoi) return;
  gestesVerrouilles++;
  updateDriverActionButtons();
  try {
    await envoi;
  } catch (error) {
    // Un envoi lance ailleurs (terme du toast) annonce lui-meme son echec.
    if (lanceIci) {
      if (error && error.enFile) notifyEchec(error);
      else throw error;
    }
  } finally {
    gestesVerrouilles--;
    updateDriverActionButtons();
  }
}

async function livrerAvecAnnulation() {
  const maintenant = Date.now();
  if (maintenant - dernierAppuiLivre < LIVRE_DOUBLE_APPUI_MS) return;
  dernierAppuiLivre = maintenant;
  if (!activeRoute) {
    await updateCurrentDeliveryStatus("livre");
    return;
  }
  // L'arret livre est celui de l'ecran A L'APPUI, jamais celui qu'on trouve
  // apres l'attente reseau.
  const vise = arretVise();
  if (!vise) {
    notify("Aucun arrêt sélectionné.", "warning");
    return;
  }
  await solderLivraisonEnSuspens();
  // Pendant l'attente, l'ecran a pu avancer (un autre appui, un rechargement) :
  // on ne livre que l'arret vise, s'il est encore a l'ecran, et jamais
  // par-dessus une autre livraison en suspens.
  if (livraisonEnSuspens || !arretToujoursVise(vise)) return;
  const stop = activeRoute.stops[activeStopIndex];
  if (activeRoute.status !== "en_livraison" || isStopTerminal(stop.status)) return;

  const suspens = {
    routeId: String(activeRoute.id),
    stopId: String(stop.id),
    statutAvant: stop.status,
    indexAvant: activeStopIndex,
    toast: null
  };
  livraisonEnSuspens = suspens;
  appliquerLivraisonEnSuspens();
  // L'arret suivant : le prochain non termine APRES celui-ci, sinon le premier
  // qui reste (un arret saute plus tot).
  const apres = activeRoute.stops.findIndex((s, i) => i > activeStopIndex && !isStopTerminal(s.status));
  const reste = apres >= 0 ? apres : activeRoute.stops.findIndex(s => !isStopTerminal(s.status));
  if (reste >= 0) activeStopIndex = reste;
  rafraichirTournee();

  suspens.toast = notify(`Livré — ${stop.clientName || "arrêt"}`, "success", {
    action: { libelle: "Annuler", surClic: () => annulerLivraisonEnSuspens(suspens) },
    // Au terme, c'est CETTE livraison qui part, pas celle du moment.
    auTerme: () => { envoyerLivraisonEnSuspens(suspens).catch(notifyEchec); }
  });
}

/** Pose l'etat « livre » en suspens sur la tournee affichee (apres un rechargement aussi). */
function appliquerLivraisonEnSuspens() {
  const s = livraisonEnSuspens;
  if (!s || !activeRoute || String(activeRoute.id) !== s.routeId) return;
  const stop = activeRoute.stops.find(item => String(item.id) === s.stopId);
  if (stop && !isStopTerminal(stop.status)) stop.status = "livre";
}

function rafraichirTournee() {
  renderRoute();
  renderMap();
  updateRouteProgress();
}

function annulerLivraisonEnSuspens(suspens) {
  if (livraisonEnSuspens !== suspens) return;
  livraisonEnSuspens = null;
  if (activeRoute && String(activeRoute.id) === suspens.routeId) {
    const stop = activeRoute.stops.find(item => String(item.id) === suspens.stopId);
    if (stop && stop.status === "livre") stop.status = suspens.statutAvant;
    activeStopIndex = suspens.indexAvant;
  }
  rafraichirTournee();
  document.getElementById("markDeliveredButton")?.focus({ preventScroll: true });
}

/**
 * Envoie la livraison en suspens, s'il y en a une (et, si `attendu` est donne,
 * seulement si c'est encore elle). Rend quand c'est fait.
 */
function envoyerLivraisonEnSuspens(attendu = null) {
  const s = livraisonEnSuspens;
  if (!s || (attendu && s !== attendu)) return Promise.resolve();
  livraisonEnSuspens = null;
  retirerToast(s.toast);
  const envoi = (async () => {
    try {
      await apiFetch(`/api/routes/${encodeURIComponent(s.routeId)}/stops/${encodeURIComponent(s.stopId)}`, {
        method: "PATCH",
        // keepalive : l'envoi declenche par `pagehide` survit a la page.
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "livre", motif: null })
      });
    } catch (error) {
      // Mise en file hors ligne : l'ecriture partira au retour du reseau.
      // L'ecran garde « Livre » -- recharger depuis le cache le defairait.
      if (error && error.enFile) throw error;
      await loadData();
      throw error;
    }
    await loadData();
  })();
  envoiLivraison = envoi;
  const liberer = () => { if (envoiLivraison === envoi) envoiLivraison = null; };
  envoi.then(liberer, liberer);
  return envoi;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") envoyerLivraisonEnSuspens().catch(notifyEchec);
});
window.addEventListener("pagehide", () => {
  envoyerLivraisonEnSuspens().catch(() => {});
});

async function updateLegacyClientDeliveryStatus(status) {
  const client = route[currentIndex];

  if (!client) {
    notify("Aucun client sélectionné.", "warning");
    return;
  }

  const legacyStatus = {
    livre: "livree",
    absent: "absent",
    probleme: "probleme",
    a_reprogrammer: "non_livre"
  }[status] || status;

  await apiFetch("/api/livraison", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      clientId: client.id,
      statut: legacyStatus
    })
  });

  await loadData();
  notify("Statut livraison enregistré.", "success");
}

async function replanCurrentStop() {
  const target = getCurrentDeliveryTarget();
  if (!target?.orderId) {
    notify("Sélectionne une commande livrée ou à reprogrammer.", "warning");
    return;
  }

  const defaultDate = addMonthsToInputDate(getTodayDateInput(), 1);
  const deliveryDate = window.prompt("Date de la prochaine livraison (AAAA-MM-JJ)", defaultDate);
  if (!deliveryDate) return;

  await apiFetch(`/api/orders/${encodeURIComponent(target.orderId)}/replan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deliveryDate })
  });
  await loadData();
  notify("Prochaine commande planifiée.", "success");
  showTab("commandes-planifiees");
}

function renderClients() {
  const container = document.getElementById("clientsList");
  if (!container) return;

  container.innerHTML = "";

  if (!clients.length) {
    container.innerHTML = emptyState("Aucun client", "Importe les dossiers du jour pour générer la tournée.", { libelle: "Importer les dossiers", onglet: "journee" });
    return;
  }

  clients.forEach((client, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item client-button ${getClientClass(client.statut)}`;
    button.addEventListener("click", () => selectClient(index));

    button.innerHTML = `
      <span>
        <strong>${escapeHtml(getClientName(client))}</strong>
        <small>${escapeHtml(formatAddress(client))}</small>
      </span>
      <span class="pill ${getClientPill(client.statut)}">${escapeHtml(formatClientStatus(client.statut))}</span>
    `;

    container.appendChild(button);
  });
}

function selectClient(index) {
  currentIndex = index;
  activeRoute = null;
  route = [...clients];

  const client = clients[index];

  showCurrentClient(client);
  focusEntity(client);
  updateRouteProgress();
}

function startTour() {
  if (!clients.length) {
    notify("Aucun client à livrer.", "warning");
    return;
  }

  activeRoute = null;
  route = clients.filter(client => client.statut === "restant");

  if (!route.length) {
    setCurrentClientMessage("Tous les clients sont terminés.");
    currentIndex = -1;
    updateRouteProgress();
    return;
  }

  currentIndex = 0;

  showCurrentClient(route[currentIndex]);
  focusEntity(route[currentIndex]);
  updateRouteProgress();
}

function nextClient() {
  if (activeRoute) {
    const nextIndex = activeRoute.stops.findIndex((stop, index) => index > activeStopIndex && !isStopTerminal(stop.status));
    if (nextIndex < 0) {
      showRouteCompleted(activeRoute);
      return;
    }

    selectStop(nextIndex);
    return;
  }

  if (!route.length) return;

  currentIndex++;

  if (currentIndex >= route.length) {
    setCurrentClientMessage("Tournée terminée.");
    currentIndex = -1;
    updateRouteProgress();
    return;
  }

  showCurrentClient(route[currentIndex]);
  focusEntity(route[currentIndex]);
  updateRouteProgress();
}

async function resetTour() {
  const confirmed = window.confirm("Réinitialiser tous les statuts de livraison en restant ?");
  if (!confirmed) return;

  await apiFetch("/api/reset-tournee", {
    method: "POST"
  });

  currentIndex = -1;
  activeRoute = null;
  route = [];
  setCurrentClientMessage("Aucune tournée démarrée.");

  await loadData();
  notify("Tournée réinitialisée.", "success");
}

function openGoogleMaps() {
  const target = getCurrentDeliveryTarget();

  if (!target) {
    notify("Aucun client sélectionné.", "warning");
    return;
  }

  const mapsUrl = buildGoogleMapsUrl(target);
  if (!mapsUrl) {
    notify("Adresse incomplète, impossible d'ouvrir Google Maps correctement.", "warning");
    return;
  }

  window.open(mapsUrl, "_blank", "noopener,noreferrer");
}

function callCurrentClient() {
  const target = getCurrentDeliveryTarget();

  if (!target) {
    notify("Aucun client sélectionné.", "warning");
    return;
  }

  const phoneUrl = buildPhoneUrl(target.phone || target.telephone);
  if (!phoneUrl) {
    notify("Numéro de téléphone manquant.", "warning");
    return;
  }

  window.location.href = phoneUrl;
}

function showCurrentClient(client) {
  if (!client) return;

  const container = document.getElementById("currentClient");
  if (!container) return;

  container.innerHTML = `
    <div class="current-client-main">
      <strong>${escapeHtml(getClientName(client))}</strong>
      <span>${escapeHtml(formatAddress(client))}</span>
      <span>${escapeHtml(formatPhone(client.telephone || client.phone))}</span>
      <span>Statut : ${escapeHtml(formatClientStatus(client.statut))}</span>
      ${client.notes ? `<span class="current-client-note">${escapeHtml(client.notes)}</span>` : ""}
      ${getAddressWarning(client) ? `<span class="address-warning">${escapeHtml(getAddressWarning(client))}</span>` : ""}
    </div>
    ${renderProducts(client)}
    <div class="coordinate-controls">
      <label>
        Latitude
        <input id="currentLat" type="number" min="-90" max="90" step="any" value="${escapeAttribute(client.lat ?? "")}">
      </label>
      <label>
        Longitude
        <input id="currentLng" type="number" min="-180" max="180" step="any" value="${escapeAttribute(client.lng ?? "")}">
      </label>
      <button class="button primary" type="button" data-action="save-coordinates">Enregistrer coordonnées</button>
    </div>
  `;
  updateDriverActionButtons(client);
}

function setCurrentClientMessage(message) {
  const currentClient = document.getElementById("currentClient");
  if (currentClient) currentClient.textContent = message;
  updateDriverActionButtons(null);
}

function getCurrentDeliveryTarget() {
  if (activeRoute?.stops?.length) return activeRoute.stops[activeStopIndex] || null;
  if (currentIndex >= 0 && route[currentIndex]) return route[currentIndex];
  return null;
}

function setButtonDisabled(id, disabled) {
  const button = document.getElementById(id);
  if (button) button.disabled = Boolean(disabled);
}

function updateDriverActionButtons(target = getCurrentDeliveryTarget()) {
  const hasTarget = Boolean(target);
  const routeStarted = activeRoute ? activeRoute.status === "en_livraison" : hasTarget;
  const terminalStop = activeRoute ? isStopTerminal(target?.status) : false;
  // Pendant l'envoi d'une livraison, les gestes d'arret attendent (solderLivraisonEnSuspens).
  const canChangeStatus = hasTarget && routeStarted && !terminalStop && !gestesVerrouilles;
  const hasNextStop = activeRoute
    ? activeRoute.stops.some((stop, index) => index > activeStopIndex && !isStopTerminal(stop.status))
    : currentIndex >= 0 && currentIndex < route.length - 1;
  const canReplan = Boolean(target?.orderId && ["livre", "absent", "probleme", "a_reprogrammer"].includes(target.status));

  setButtonDisabled("callClientButton", !hasTarget || !buildPhoneUrl(target?.phone || target?.telephone));
  setButtonDisabled("mapsButton", !hasTarget || !buildGoogleMapsUrl(target));
  setButtonDisabled("markDeliveredButton", !canChangeStatus);
  setButtonDisabled("markAbsentButton", !canChangeStatus);
  setButtonDisabled("markProblemButton", !canChangeStatus);
  setButtonDisabled("markRescheduleButton", !canChangeStatus);
  setButtonDisabled("replanCurrentButton", !canReplan);
  setButtonDisabled("nextClientButton", !hasTarget || !routeStarted || !hasNextStop);
}

async function saveCurrentCoordinates() {
  const client = route[currentIndex];

  if (!client) {
    notify("Aucun client sélectionné.", "warning");
    return;
  }

  const lat = document.getElementById("currentLat")?.value ?? "";
  const lng = document.getElementById("currentLng")?.value ?? "";

  await apiFetch(`/api/clients/${encodeURIComponent(client.id)}/coordinates`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ lat, lng })
  });

  await loadData();

  const nextIndex = clients.findIndex(item => String(item.id) === String(client.id));
  route = [...clients];
  currentIndex = nextIndex;

  if (currentIndex >= 0) {
    showCurrentClient(route[currentIndex]);
    focusEntity(route[currentIndex]);
  }

  notify("Coordonnées enregistrées.", "success");
}

function renderMap() {
  if (!map) return;
  // Un conteneur sans taille (onglet masque) ne se cadre pas : fitBounds y
  // calcule un zoom absurde. On redessinera a l'ouverture de l'onglet.
  const taille = map.getSize();
  if (!taille.x || !taille.y) return;

  markers.forEach(marker => map.removeLayer(marker));
  markers = [];

  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  if (routeLineLisere) {
    map.removeLayer(routeLineLisere);
    routeLineLisere = null;
  }

  const entities = getMapEntities();
  const points = [];

  entities.forEach((entity, index) => {
    const coords = getEntityCoordinates(entity);

    if (!coords) return;

    // Le meme marqueur que dans la ligne d'arret. La zone de toucher fait
    // 44 x 44 (plancher de la charte) ; sur la carte le disque fait 44 lui
    // aussi (decision du 23/09, planche 4c) -- la zone de toucher EST le disque.
    const etat = marqueurEtat(entity, index);
    const marker = L.marker([coords.lat, coords.lng], {
      icon: L.divIcon({
        className: "marqueur-ancre",
        html: marqueurHtml(entity, index),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -20]
      }),
      // L'arret en cours passe devant les autres, puis les arrets a venir,
      // puis les faits : ce qu'on cherche des yeux est ce qu'on doit toucher.
      zIndexOffset: etat === "en-cours" ? 1000 : etat === "a-venir" ? 500 : 0
    }).addTo(map);

    marker.bindPopup(`
      <strong>${escapeHtml(getEntityName(entity))}</strong><br>
      ${escapeHtml(formatEntityAddress(entity))}<br>
      ${escapeHtml(formatEntityStatus(entity))}
    `);

    marker.on("click", () => {
      if (activeRoute) selectStop(index);
    });

    markers.push(marker);
    points.push([coords.lat, coords.lng]);
  });

  const mapEmpty = document.getElementById("mapEmpty");
  if (mapEmpty) mapEmpty.hidden = points.length > 0;

  if (activeRoute?.geometry?.coordinates) {
    const roadPoints = activeRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    // Planche 4c, decision de Thomas du 23/09 (remplace les 4,5 px du 19/09) :
    // le trace est en ACCENT, 7 px, bouts ronds. Une forme, pas un texte --
    // l'orange y est a sa place. Dessous, un lisere blanc de 2 px de chaque
    // cote : sur les tuiles OpenStreetMap reelles (routes orange et jaunes),
    // l'orange seul se perdait -- la planche le craignait, son fond etait une
    // esquisse. Le lisere n'est pas interactif : le clic reste au trace.
    routeLineLisere = L.polyline(roadPoints, {color: "#FFFFFF", weight: 11, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false}).addTo(map);
    routeLine = L.polyline(roadPoints, {color: couleurCharte("--v8-accent", "#EF9177"), weight: 7, opacity: 1, lineCap: "round", lineJoin: "round"}).addTo(map);
    for (const [point, label] of [[activeRoute.departure, "Départ"], [activeRoute.arrival, "Arrivée"]]) {
      if (point) markers.push(L.marker([point.lat, point.lng]).addTo(map).bindPopup(`${label} : ${escapeHtml(point.label || "Point choisi")}`));
    }
    map.fitBounds(routeLine.getBounds(), {padding:[30,30]});
  } else if (points.length > 1) {
    // Sans geometrie routiere : un pointille en PRINCIPAL, pas un bleu V7.
    routeLine = L.polyline(points, {
      dashArray: "6 8",
      color: couleurCharte("--v8-principal", "#386B6D"),
      weight: 3,
      opacity: 0.8,
      lineCap: "round"
    }).addTo(map);

    map.fitBounds(routeLine.getBounds(), {
      padding: [30, 30]
    });
  } else if (points.length === 1) {
    // Audit UI 2026-07 : cas frequent "1 arret" -> fitBounds n'etait pas
    // appele, la carte restait sur le centre code en dur [46.9511,4.9027] et
    // le marqueur unique tombait hors-cadre. On recentre sur ce point.
    map.setView(points[0], 14);
  }
}

function getMapEntities() {
  if (activeRoute?.stops?.length) return activeRoute.stops;

  const selectedOrders = orders.filter(order => deliverySelection.has(String(order.id)));
  if (selectedOrders.length) return selectedOrders;

  const filtered = getFilteredDeliveryOrders();
  if (filtered.length) return filtered;

  return clients;
}

function focusEntity(entity) {
  if (!map) return;

  const coords = getEntityCoordinates(entity);

  if (coords) {
    map.setView([coords.lat, coords.lng], 15);
  }
}

// T4 (v1.16.1) : timeout par defaut sur fetch pour eviter une attente infinie
// si le reseau est dégrade (livreur en zone blanche, OMV qui ne repond plus).
// Plus long pour les imports (peuvent legitimement durer > 30s sur 5000 lignes).
const APIFETCH_DEFAULT_TIMEOUT_MS = 30_000;
const APIFETCH_UPLOAD_TIMEOUT_MS = 120_000;

async function apiFetch(url, options = {}) {
  const isUpload = options.body instanceof FormData;
  const timeoutMs = options.timeoutMs || (isUpload ? APIFETCH_UPLOAD_TIMEOUT_MS : APIFETCH_DEFAULT_TIMEOUT_MS);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  // T4 (revue) : si l'appelant fournit son propre signal, il faut COMBINER
  // avec le timeout interne (sinon le timeout est noop). AbortSignal.any() est
  // dispo dans Node 20+ / Chrome 116+ ; fallback : on chaine manuellement.
  let signal = ac.signal;
  if (options.signal) {
    if (typeof AbortSignal !== "undefined" && AbortSignal.any) {
      signal = AbortSignal.any([options.signal, ac.signal]);
    } else {
      // Fallback : si le signal externe abort, on abort aussi le notre
      options.signal.addEventListener("abort", () => ac.abort(), { once: true });
    }
  }

  let res;
  try {
    res = await fetch(url, { ...options, signal });
  } catch (err) {
    clearTimeout(timer);
    // L'ecriture est-elle recuperable ? Voir estDefinitivementHorsLigne().
    if (await tenterMiseEnFile(url, options)) {
      const attente = new Error("Hors ligne — enregistré, sera envoyé à la reconnexion.");
      attente.enFile = true;
      throw attente;
    }
    if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
      // Si c'est l'appelant qui a abort (pas le timeout), on re-throw l'erreur
      // originale pour preserver la semantique. Sinon notre message "timeout".
      if (options.signal && options.signal.aborted) throw err;
      throw new Error(`Reseau trop lent (timeout ${Math.round(timeoutMs / 1000)}s). Verifie ta connexion.`);
    }
    throw err;
  }
  clearTimeout(timer);

  // Une reponse rendue par le cache du service worker (le reseau n'a pas
  // repondu a temps) : loadData() ne l'annoncera pas « A jour ».
  if (res.headers && res.headers.get("X-Sereo-Cache")) {
    reponsesCopiees.set(url, Date.parse(res.headers.get("Date") || ""));
  }

  // Session expiree (cookie 12h) -> redirige vers /login en preservant l'URL courante.
  // 429 = IP verrouillee (rate-limit auth) : on redirige aussi vers /login, qui
  // affiche le compte a rebours de lockout (sinon l'app afficherait un toast
  // "Erreur HTTP 429" opaque). Garde-fou : si on est deja sur /login, on ne
  // re-redirige pas (boucle infinie possible sur certains navigateurs).
  if ((res.status === 401 || res.status === 429) && !window.location.pathname.startsWith("/login")) {
    const next = window.location.pathname + window.location.search + window.location.hash;
    // La session est finie : ses donnees ne doivent pas s'afficher a la
    // prochaine ouverture, avant que le serveur ait reconnu quelqu'un.
    // (Un 429 n'est pas une fin de session : on ne vide que sur 401.)
    if (res.status === 401) await viderCacheDeDonnees();
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
    // On throw quand meme pour interrompre proprement le code appelant.
    throw new Error("Session expiree, redirection vers /login");
  }

  const text = await res.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const message = body && typeof body === "object" && body.error
      ? body.error
      : `Erreur HTTP ${res.status}`;
    throw new Error(message);
  }

  return body;
}

async function runAction(control, busyText, action) {
  if (control?.disabled) return;

  const originalText = control?.textContent;

  try {
    if (control) {
      control.disabled = true;
      if (busyText && control.tagName === "BUTTON") control.textContent = busyText;
    }

    await action();
  } catch (error) {
    notifyEchec(error);
  } finally {
    if (control) {
      control.disabled = false;
      if (originalText && control.tagName === "BUTTON") control.textContent = originalText;
    }
  }
}

// --- ECRITURES HORS LIGNE ----------------------------------------------------
//
// Mesure du 18/09, avant ce bloc : 32 ecritures reseau dans ce fichier, ZERO
// ecouteur "online"/"offline", ZERO ecouteur "sync" dans le service worker. La
// LECTURE hors ligne existait (network-first puis cache) ; l'ECRITURE etait
// perdue. Un livreur en zone blanche qui validait une livraison la perdait.

const METHODES_FILABLES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `navigator.onLine` n'est fiable que dans UN SENS, et c'est celui-la qu'on
 * utilise : la spec garantit que `false` signifie "certainement hors ligne" --
 * aucune interface reseau, donc la requete N'EST JAMAIS PARTIE. `true` ne
 * promet rien (portail captif, wifi sans internet), on ne s'en sert donc pas
 * pour conclure l'inverse.
 *
 * Cette asymetrie est exactement ce qu'il faut ici. Un TIMEOUT, lui, peut
 * parfaitement signifier que le serveur a RECU et TRAITE la demande : rejouer
 * une ecriture non idempotente apres un timeout la dupliquerait. On ne met donc
 * en file QUE ce dont on sait que le reseau ne l'a pas emporte.
 */
function estDefinitivementHorsLigne() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Met l'ecriture en file si elle est recuperable. Rend true si c'est fait. */
async function tenterMiseEnFile(url, options) {
  if (!estDefinitivementHorsLigne()) return false;
  const methode = String(options.method || "GET").toUpperCase();
  if (!METHODES_FILABLES.has(methode)) return false;
  // Un envoi de fichier ne se differe pas : rejouer un import Excel trois
  // heures plus tard, sur un stock qui a bouge, ferait plus de degats que de
  // refuser tout de suite.
  if (options.body instanceof FormData) return false;
  try {
    await mettreEnAttente(url, { ...options, method: methode });
    await rafraichirEtatFile();
    return true;
  } catch {
    // indexedDB indisponible (navigation privee, quota) : on ne fait pas
    // semblant. L'appelant recoit l'erreur reseau d'origine, comme avant.
    return false;
  }
}

let ecrituresEnAttente = 0;

/** Relit le nombre d'ecritures en attente et le porte a l'ecran. */
async function rafraichirEtatFile() {
  try {
    ecrituresEnAttente = await compterFile();
  } catch {
    ecrituresEnAttente = 0;
  }
  setStatus(dernierStatut);
}

/**
 * Vide la file. On envoie avec `fetch` NU, jamais avec apiFetch : apiFetch
 * remettrait en file ce qu'il vient d'en sortir, et la file se rechargerait
 * elle-meme a chaque tentative.
 */
async function viderLaFile() {
  if (ecrituresEnAttente === 0) return;
  const bilan = await rejouer((u, o) => fetch(u, { ...o, credentials: "same-origin" }));
  await rafraichirEtatFile();

  if (bilan.envoyees > 0) {
    notify(bilan.envoyees === 1
      ? "1 modification envoyée au serveur."
      : `${bilan.envoyees} modifications envoyées au serveur.`, "success");
    loadData();
  }
  if (bilan.refusees > 0) {
    notify(bilan.refusees === 1
      ? "1 modification a été refusée par le serveur et abandonnée."
      : `${bilan.refusees} modifications ont été refusées par le serveur et abandonnées.`, "warning");
  }
  if (bilan.bloquee) {
    notify("Des modifications ne passent pas. Elles sont conservées, mais plus renvoyées.", "warning");
  }
}

// L'heure de la coupure, captee a l'evenement ; inconnue apres un
// rechargement fait hors ligne (le bandeau dit alors « Hors ligne », sans heure).
let horsLigneDepuis = null;

function brancherFileHorsLigne() {
  window.addEventListener("online", () => { horsLigneDepuis = null; setStatus(dernierStatut); viderLaFile(); });
  window.addEventListener("offline", () => { horsLigneDepuis = new Date(); setStatus(dernierStatut); });
  // A l'ouverture : l'onglet a pu etre ferme avec des ecritures en attente.
  // C'est le prix de ne pas utiliser Background Sync, absent d'iOS Safari --
  // une solution qui ne marche pas sur la moitie du parc n'en est pas une.
  rafraichirEtatFile().then(() => { if (navigator.onLine) viderLaFile(); });
}

/**
 * Une ecriture mise en file n'est PAS une erreur : la donnee est conservee et
 * partira. L'annoncer en rouge dirait le contraire de ce qui s'est passe.
 */
function notifyEchec(error, repli = "Action impossible.") {
  notify(error?.message || repli, error?.enFile ? "warning" : "error");
}

let dernierStatut = "Prêt";

/**
 * UN SEUL ecrivain pour #syncStatus. loadData() y ecrit "À jour" / "Erreur" ; le
 * nombre d'ecritures en attente doit survivre a ces ecritures-la, sinon un
 * simple rafraichissement effacerait la seule trace que des donnees ne sont pas
 * encore parties. On memorise donc le dernier statut et on recompose.
 */
function setStatus(message) {
  dernierStatut = message;
  const element = document.getElementById("syncStatus");
  if (!element) return;
  let texte = message;
  if (ecrituresEnAttente > 0) {
    texte = `${message} · ${ecrituresEnAttente} en attente`;
  } else if (estDefinitivementHorsLigne()) {
    texte = `${message} · hors ligne`;
  }
  element.textContent = texte;
  majBandeauHorsLigne();
}

// Planche 10c. Montre hors ligne, OU tant que des modifications attendent.
// « modifications » et non « livraisons » : la file compte des ecritures.
function majBandeauHorsLigne() {
  const bandeau = document.getElementById("bandeauHorsLigne");
  if (!bandeau) return;
  const horsLigne = estDefinitivementHorsLigne();
  // Un import de fichier ne se met pas en file (tenterMiseEnFile) : hors
  // ligne, ses boutons le disent au lieu d'echouer. AVANT le retour anticipe
  // du bandeau masque : sinon, le reseau revenu, ils restaient desactives.
  document.querySelectorAll('[data-action="importer-ventes"], [data-action="importer-stock"], #importVentesButton, #importStockButton')
    .forEach(bouton => {
      bouton.disabled = horsLigne;
      if (horsLigne) bouton.title = "Import impossible hors ligne"; else bouton.removeAttribute("title");
    });
  bandeau.hidden = !horsLigne && ecrituresEnAttente === 0;
  if (bandeau.hidden) return;
  const heure = horsLigneDepuis
    ? horsLigneDepuis.toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" }).replace(":", " h ")
    : "";
  setText("bandeauHorsLigneTitre", horsLigne ? (heure ? `Hors ligne depuis ${heure}` : "Hors ligne") : "Envoi en attente");
  const n = ecrituresEnAttente;
  setText("bandeauHorsLigneDetail", n
    ? `${n} modification${n > 1 ? "s" : ""} en attente d'envoi. ${horsLigne ? "Elles partiront au retour du réseau." : "Envoi en cours."}`
    : "Vos modifications seront gardées et envoyées au retour du réseau. Les imports de fichiers attendront le réseau.");
}

/** Charte §4 : « Toast : bas d'ecran, 4 s, une action possible (Annuler) ». */
const TOAST_DUREE_MS = 4000;

function notify(message, type = "info", options = {}) {
  const region = document.getElementById("toastRegion");
  if (!region) return null;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = message;
  toast.appendChild(text);

  // La charte : « une action possible (Annuler) ». Le bouton ferme le toast
  // puis appelle l'action ; un seul clic compte.
  if (options.action && typeof options.action.surClic === "function") {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "toast-action";
    bouton.textContent = options.action.libelle || "Annuler";
    bouton.addEventListener("click", () => {
      if (toast.dataset.fini) return;
      toast.dataset.fini = "1";
      toast.classList.add("toast-out");
      setTimeout(() => toast.remove(), 250);
      options.action.surClic();
    }, { once: true });
    toast.appendChild(bouton);
  }

  // Bouton de fermeture (utile surtout pour les erreurs persistantes)
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", "Fermer la notification");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 250);
  });
  toast.appendChild(closeBtn);

  region.appendChild(toast);

  // Les erreurs restent affichees jusqu'au clic utilisateur (lecture sans pression).
  // C'est un ECART DELIBERE a la charte, et dans le bon sens : elle dit 4 s pour
  // un toast, sans distinguer les types. Faire disparaitre une erreur toute
  // seule ferait perdre l'information a qui regardait ailleurs.
  //
  // Les autres types (info / success / warning) : 4 s, la valeur de la charte.
  // Le code disait 3500 -- un ecart de 0,5 s que personne n'avait mesure parce
  // que personne ne chronometrait un toast.
  if (type !== "error") {
    setTimeout(() => {
      toast.classList.add("toast-out");
      setTimeout(() => toast.remove(), 250);
      if (!toast.dataset.fini) {
        toast.dataset.fini = "1";
        if (typeof options.auTerme === "function") options.auTerme();
      }
    }, TOAST_DUREE_MS);
  }
  return toast;
}

/** Retire un toast sans declencher ni son action ni son terme. */
function retirerToast(toast) {
  if (!toast || toast.dataset.fini) return;
  toast.dataset.fini = "1";
  toast.classList.add("toast-out");
  setTimeout(() => toast.remove(), 250);
}

/** Le statut de tournee vu la derniere fois : la planification ne se replie qu'au CHANGEMENT. */
let dernierStatutDeTournee = null;

// Planche 13b : le titre de page est la tournee, le sous-titre son jour et
// son avancement. Sans tournee, le titre generique de l'onglet reste.
function majEnteteTournee() {
  if (!document.getElementById("livreur")?.classList.contains("active")) return;
  // Sans tournee (effacee, remise a zero), le titre generique revient : le
  // nom d'une tournee disparue ne reste pas en tete de page.
  if (!activeRoute?.stops?.length) {
    setText("pageTitle", titles.livreur.title);
    setText("pageSubtitle", titles.livreur.subtitle);
    return;
  }
  const total = activeRoute.stops.length;
  const rang = isRouteComplete(activeRoute) ? total : Math.min(activeStopIndex + 1, total);
  setText("pageTitle", document.getElementById("tourneeNom")?.textContent || "Tournée");
  const jour = document.getElementById("tourneeJour")?.textContent || "";
  const etape = isRouteComplete(activeRoute) ? "tournée terminée"
    : activeRoute.status === "prete" ? `${total} arrêt${total > 1 ? "s" : ""}, prête à partir`
    : `arrêt ${rang} sur ${total}`;
  setText("pageSubtitle", [jour, etape]
    .filter(Boolean).join(" · "));
}

function updateRouteProgress() {
  const element = document.getElementById("routeProgress");
  if (!element) return;
  const bloc = document.getElementById("tourneeActive");
  const jour = document.getElementById("tourneeJour");
  const nom = document.getElementById("tourneeNom");
  const barre = document.getElementById("tourneeProgressionBarre");
  const depart = document.getElementById("tourneeDepart");
  const planification = document.getElementById("routePlanning");

  const statut = activeRoute?.stops?.length ? activeRoute.status : null;
  // Sans tournee, la planification passe en tete de page (ordre CSS).
  document.querySelector(".driver-page")?.classList.toggle("sans-tournee", !statut);
  // La planification est ouverte tant qu'aucune tournee ne ROULE. On ne
  // touche a `open` qu'au changement de statut : rouvrir ce que le livreur
  // vient de replier, ou l'inverse, serait pire que ne rien faire.
  if (planification && statut !== dernierStatutDeTournee) {
    planification.open = statut !== "en_livraison";
    dernierStatutDeTournee = statut;
  }

  if (activeRoute?.stops?.length) {
    const total = activeRoute.stops.length;
    // « 3 sur 8 » : le rang de l'arret en cours ; une tournee terminee affiche le total.
    const rang = isRouteComplete(activeRoute) ? total : Math.min(activeStopIndex + 1, total);
    const faits = activeRoute.stops.filter(stop => isStopTerminal(stop.status)).length;
    if (bloc) bloc.hidden = false;
    if (jour) jour.textContent = formatJourDeTournee(activeRoute.deliveryDate);
    if (nom) nom.textContent = activeRoute.sector && activeRoute.sector !== "Tous"
      ? `Tournée ${formatSectorLabel(activeRoute.sector)}`
      : "Tournée du jour";
    element.innerHTML = `<strong>${escapeHtml(rang)}</strong><small>sur ${escapeHtml(total)}</small>`;
    element.setAttribute("aria-label", `Arrêt ${rang} sur ${total}, ${faits} terminé${faits > 1 ? "s" : ""}`);
    if (barre) barre.style.width = `${Math.round((faits / total) * 100)}%`;
    if (depart) depart.hidden = activeRoute.status !== "prete";
    majEnteteTournee();
    return;
  }

  if (bloc) bloc.hidden = true;
  majEnteteTournee();
  if (!route.length || currentIndex < 0) {
    element.textContent = "Aucune tournée";
    return;
  }

  element.textContent = `${currentIndex + 1}/${route.length}`;
}

/** « Mercredi 2 septembre » -- le jour de la tournee, comme sur la planche. */
function formatJourDeTournee(value) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const texte = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}


function renderStockLines(order) {
  const lines = order.stockLines || [];
  if (!lines.length) return `<div class="stock-lines muted">Aucun produit identifié.</div>`;

  return `
    <div class="stock-lines">
      ${lines.map(line => `
        <div class="stock-line ${line.status === "ok" ? "line-ok" : "line-danger"}">
          <span>${escapeHtml(line.nom || line.code || "Produit")}</span>
          <span>Besoin ${escapeHtml(line.required)} · Dispo ${line.available === null ? "?" : escapeHtml(line.available)}</span>
        </div>
      `).join("")}
    </div>
  `;
}







function getProductQuantity(product) {
  const value = product.quantite ?? product.stock ?? product.Stock ?? product.qte;

  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function getProductThreshold(product) {
  const value = product.alertThreshold
    ?? product.stockMinimum
    ?? product.seuilMinimum
    ?? product.seuil_minimum
    ?? product.seuilAlerte
    ?? product.seuil
    ?? product.minimum;
  if (value === null || value === undefined || value === "") return 5;

  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 5;
}

function getProductName(product) {
  return product.nom || product.Nom || product.produit || product.Produit || "Produit";
}

function getStockLevel(product) {
  const quantity = product.quantityAvailable ?? getProductQuantity(product);
  const status = product.stockStatus || "";

  if (status === "a_renseigner" || quantity === null) {
    return {
      className: "status-neutral",
      pill: "pill-blue",
      label: "À renseigner",
      status: "a_renseigner"
    };
  }

  if (status === "rupture" || quantity <= 0) {
    return {
      className: "status-danger",
      pill: "pill-danger",
      label: "Rupture",
      status: "rupture"
    };
  }

  if (status === "stock_faible" || quantity <= getProductThreshold(product)) {
    return {
      className: "status-warning",
      pill: "pill-warning",
      label: "Stock faible",
      status: "stock_faible"
    };
  }

  if (status === "reserve") {
    return {
      className: "status-neutral",
      pill: "pill-blue",
      label: "Réservé",
      status: "reserve"
    };
  }

  return {
    className: "status-ok",
    pill: "pill-ok",
    label: "Disponible",
    status: "disponible"
  };
}

function getLowStockProducts() {
  return stock.filter(product => {
    const level = getStockLevel(product);
    return ["stock_faible", "rupture"].includes(level.status);
  });
}

function getNeededQuantityForProduct(product) {
  if (product.quantityNeeded !== undefined) return product.quantityNeeded;

  const productCode = normalizeTextKey(product.code);
  const productName = normalizeTextKey(getProductName(product));

  return orders.reduce((total, order) => {
    if (!["commande_client_validee", "importe", "stock_a_verifier", "en_preparation"].includes(order.status)) return total;

    return total + (order.products || []).reduce((sum, line) => {
      const lineCode = normalizeTextKey(line.code);
      const lineName = normalizeTextKey(line.nom || line.produit);
      const matches = (productCode && lineCode === productCode) || (productName && lineName === productName);
      return matches ? sum + Number(line.quantite || 1) : sum;
    }, 0);
  }, 0);
}

function getClientName(client) {
  return client.nom || client.client || client.Client || "Client";
}

function getEntityName(entity) {
  return entity.clientName || entity.nom || entity.client || "Client";
}


function getAddressWarning(entity) {
  const parts = getAddressParts(entity);
  if (!String(parts.address).trim() || !String(parts.city).trim()) return "Adresse incomplète";
  return "";
}




function formatPhone(value) {
  return value ? `Téléphone : ${value}` : "Téléphone manquant";
}

function isStopTerminal(status) {
  return ["livre", "absent", "probleme", "a_reprogrammer"].includes(status);
}

function isRouteComplete(routeData) {
  return Boolean(routeData?.stops?.length && routeData.stops.every(stop => isStopTerminal(stop.status)));
}

function formatAddress(client) {
  const { address: rue, postalCode: cp, city: ville } = getAddressParts(client);

  return `${rue} ${cp} ${ville}`.trim() || "Adresse non renseignée";
}

function formatOrderAddress(order) {
  // La ville reprend sa cedille a l'affichage : le serveur la canonise sans.
  const ville = order.city ? formatSectorLabel(order.city) : "";
  return `${order.address || ""} ${order.postalCode || ""} ${ville}`.trim() || "Adresse non renseignée";
}

/** « Besancon · 4 articles » : la ligne de detail d'un arret, comme sur la planche. */
function formatStopMeta(stop) {
  const lignes = (stop.products || []).length;
  const articles = lignes === 0 ? "aucun article" : lignes === 1 ? "1 article" : `${lignes} articles`;
  // Le serveur canonise la ville SANS cedille (c'est une cle de secteur) ;
  // formatSectorLabel lui rend son orthographe a l'affichage.
  const ville = stop.city ? formatSectorLabel(stop.city) : (stop.postalCode || "");
  return [ville, articles].filter(Boolean).join(" · ");
}

function formatStopAddress(stop) {
  // La ville reprend sa cedille a l'affichage : le serveur la canonise sans.
  const ville = stop.city ? formatSectorLabel(stop.city) : "";
  return `${stop.address || ""} ${stop.postalCode || ""} ${ville}`.trim() || "Adresse non renseignée";
}

function formatEntityAddress(entity) {
  if (entity.address !== undefined) return formatOrderAddress(entity);
  if (entity.clientName !== undefined && entity.orderId !== undefined) return formatStopAddress(entity);
  return formatAddress(entity);
}

function renderProducts(entity) {
  const products = entity.produits || entity.products || [];

  if (!Array.isArray(products) || !products.length) return "";

  return `
    <div class="product-lines">
      ${products.map(product => {
        const quantity = typeof product === "object" ? product.quantite || product.quantity || 1 : 1;
        const name = typeof product === "object"
          ? product.nom || product.produit || product.code || "Produit"
          : product;

        return `<div>${escapeHtml(quantity)}x ${escapeHtml(name)}</div>`;
      }).join("")}
    </div>
  `;
}

/** « 4 articles » : le nombre de LIGNES, le meme mot que « n articles a decharger » de l'arret. */
function articlesDeCommande(order) {
  const n = (order.products || []).length;
  return `${n} article${n > 1 ? "s" : ""}`;
}

function getOrderProductCount(order) {
  return (order.products || []).reduce((total, product) => total + Number(product.quantite || 1), 0);
}

function getClientClass(status) {
  if (status === "livree") return "status-ok";
  if (["absent", "probleme", "non_livre"].includes(status)) return "status-danger";
  if (status === "en_cours") return "status-warning";
  return "status-neutral";
}

function getClientPill(status) {
  if (status === "livree") return "pill-ok";
  if (["absent", "probleme", "non_livre"].includes(status)) return "pill-danger";
  if (status === "en_cours") return "pill-warning";
  return "pill-blue";
}

function formatClientStatus(status) {
  if (status === "livree") return "Livrée";
  if (status === "absent") return "Absent";
  if (status === "probleme") return "Problème";
  if (status === "non_livre") return "Non livré";
  if (status === "en_cours") return "En cours";
  return "Restant";
}

function getOrderPill(status) {
  if (["brouillon", "commande_client_validee", "planifiee"].includes(status)) return "pill-blue";
  if (["livre", "pret_livraison"].includes(status)) return "pill-ok";
  if (["a_confirmer", "en_preparation", "en_livraison", "a_reprogrammer"].includes(status)) return "pill-warning";
  if (["probleme_livraison", "annulee"].includes(status)) return "pill-danger";
  return "pill-blue";
}

function formatOrderStatus(status) {
  const labels = {
    brouillon: "Brouillon",
    planifiee: "Planifiée",
    a_confirmer: "À confirmer",
    annulee: "Annulée",
    commande_client_validee: "Commande client validée",
    importe: "Importé",
    stock_a_verifier: "Stock à vérifier",
    en_preparation: "En préparation",
    preparation_terminee: "Préparation terminée",
    pret_livraison: "Prêt livraison",
    en_livraison: "En livraison",
    livre: "Livré",
    probleme_livraison: "Problème livraison",
    a_reprogrammer: "À reprogrammer"
  };

  return labels[status] || "Importé";
}

function formatStockStatus(status) {
  const labels = {
    disponible: "disponible",
    insuffisant: "insuffisant",
    inconnu: "non renseigné",
    reserve: "réservé"
  };

  return labels[status] || "à vérifier";
}

/**
 * Le marqueur d'un arret : le meme composant sur la carte et dans la ligne.
 * Charte §4 + planche Carte.png : fait (coche), en cours (numero + anneau
 * orange), a venir (numero sur blanc) ; et echec (planche Preparation).
 * `index` est le rang dans la tournee, affiche a partir de 1.
 */
function marqueurEtat(stop, index) {
  const status = stop.status || stop.statut;
  if (status === "livre") return "fait";
  if (["absent", "probleme"].includes(status)) return "echec";
  if (index === activeStopIndex && activeRoute && !isRouteComplete(activeRoute)) return "en-cours";
  return "a-venir";
}

function marqueurHtml(stop, index) {
  const etat = marqueurEtat(stop, index);
  // La coche et le « ! » sont dessines en CSS : le numero n'est ecrit que
  // pour les etats qui le montrent.
  const contenu = etat === "fait" || etat === "echec" ? "" : String(index + 1);
  const libelle = etat === "fait" ? "livré" : etat === "echec" ? "en échec" : etat === "en-cours" ? "en cours" : "à venir";
  return `<span class="marqueur marqueur--${etat}" role="img" aria-label="Arrêt ${index + 1}, ${libelle}">${contenu}</span>`;
}

function getStopPill(status) {
  if (status === "livre") return "pill-ok";
  if (["absent", "probleme"].includes(status)) return "pill-danger";
  if (["en_livraison", "a_reprogrammer"].includes(status)) return "pill-warning";
  return "pill-blue";
}

function formatStopStatus(status) {
  const labels = {
    // Charte §4 : « Statuts d'arret : Pret · En livraison · Livre · Absent ·
    // Probleme · A reprogrammer ». Le badge tient en un mot.
    pret_livraison: "Prêt",
    en_livraison: "En livraison",
    livre: "Livré",
    absent: "Absent",
    probleme: "Problème",
    a_reprogrammer: "À reprogrammer"
  };

  return labels[status] || "Prêt";
}

function formatEntityStatus(entity) {
  if (entity.orderId !== undefined) return formatStopStatus(entity.status);
  if (entity.clientName !== undefined) return formatOrderStatus(entity.status);
  return formatClientStatus(entity.statut);
}

function formatRouteStatus(status) {
  const labels = {
    brouillon: "Brouillon",
    prete: "Prête",
    en_livraison: "En livraison",
    terminee: "Terminée"
  };

  return labels[status] || "Prête";
}

function formatRouteMetrics(routeData) {
  const stops = routeData.stops?.length || 0;
  const distance = routeData.totalDistance === null || routeData.totalDistance === undefined
    ? "distance inconnue"
    : `${routeData.totalDistance} km`;
  const duration = routeData.estimatedDuration === null || routeData.estimatedDuration === undefined
    ? "durée inconnue"
    : `${routeData.estimatedDuration} min`;

  return `${stops} arrêt(s) · ${distance} · ${duration} · ${routeData.routingMode === "road" ? "trajet routier, hors trafic" : "tracé à recalculer"}`;
}

function formatSectorLabel(value) {
  if (normalizeTextKey(value) === "besancon") return "Besançon";
  if (normalizeTextKey(value) === "dole") return "Dole";
  return value || "Sans secteur";
}

/** Une couleur de la charte lue dans les tokens CSS, pour ce que Leaflet dessine en SVG. */
function couleurCharte(token, repli) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || repli;
}

function formatDate(value) {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleString("fr-FR");
  } catch {
    return value;
  }
}

function getTodayDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonthsToInputDate(value, months) {
  const base = value ? new Date(`${value}T12:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return getTodayDateInput();
  base.setMonth(base.getMonth() + months);
  return getTodayDateInput(base);
}

function formatDeliveryDate(value) {
  if (!value) return "sans date";

  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit"
    });
  } catch {
    return value;
  }
}

// ============================================================================
// Modal "Quoi de neuf ?" : affiche la version courante + section "Pour toi"
// extraite des release notes GitHub.
//
// Source de donnees : GET /api/version (server.js lit package.json au boot
// et fetch GitHub Releases en cache memoire).
// ============================================================================
let versionInfoCache = null;

async function loadVersionInfo() {
  try {
    versionInfoCache = await apiFetch("/api/version");
  } catch {
    // Si l'endpoint est down, on garde versionInfoCache=null, le bouton
    // affiche "—" et le modal montrera "Notes indisponibles".
    versionInfoCache = null;
  }
  // Met a jour le chip dans la sidebar avec la version
  const versionLabel = document.getElementById("sidebar-version-value");
  if (versionLabel) {
    versionLabel.textContent = versionInfoCache?.version
      ? `v${versionInfoCache.version}`
      : "—";
  }
  // La pastille « A jour » etait ecrite en dur : elle l'affirmait meme quand la
  // version n'avait pas pu etre lue. /api/version ne connait pas la derniere
  // version publiee ; elle ne peut donc dire qu'une chose vraie -- la page
  // tourne sur la version du serveur -- et seulement si elle l'a lue.
  setText("parVersionValeur", versionInfoCache?.version || "—");
  if (!swUpdateNotificationShown) {
    // La barre laterale au bureau, le pied de Parametres au telephone.
    for (const etat of [document.getElementById("sidebarVersionEtat"), document.getElementById("parVersionEtat")]) {
      if (!etat) continue;
      etat.textContent = "À jour";
      etat.hidden = !versionInfoCache?.version;
    }
  }
}

function bindVersionModal() {
  document.addEventListener("click", event => {
    const opener = event.target.closest('[data-action="open-version-modal"]');
    if (opener) {
      event.preventDefault();
      openVersionModal();
      return;
    }
    const closer = event.target.closest('[data-action="close-version-modal"]');
    if (closer) {
      event.preventDefault();
      closeVersionModal();
    }
  });
  // Escape pour fermer
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      const modal = document.getElementById("versionModal");
      if (modal && modal.getAttribute("aria-hidden") === "false") {
        closeVersionModal();
      }
    }
  });
}

function openVersionModal() {
  const modal = document.getElementById("versionModal");
  if (!modal) return;
  populateVersionModal();
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("version-modal-open");
  // U3 v1.13.0 : focus trap
  if (modal._releaseTrap) modal._releaseTrap();
  modal._releaseTrap = trapFocusWithin(modal);
}

function closeVersionModal() {
  const modal = document.getElementById("versionModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("version-modal-open");
  if (modal._releaseTrap) { modal._releaseTrap(); modal._releaseTrap = null; }
}

function populateVersionModal() {
  const info = versionInfoCache;
  const versionEl = document.getElementById("versionModalVersion");
  const dateEl = document.getElementById("versionModalDate");
  const bodyEl = document.getElementById("versionModalBody");
  const linkEl = document.getElementById("versionModalLink");
  if (!info) {
    if (versionEl) versionEl.textContent = "—";
    if (bodyEl) bodyEl.innerHTML = '<p class="version-modal-empty">Notes indisponibles pour le moment.</p>';
    if (linkEl) linkEl.removeAttribute("href");
    return;
  }
  if (versionEl) versionEl.textContent = `v${info.version}`;
  if (dateEl) {
    dateEl.textContent = info.publishedAt
      ? ` • publiée le ${formatDateFR(info.publishedAt)}`
      : "";
  }
  if (linkEl) {
    linkEl.href = info.releaseUrl;
  }
  if (bodyEl) {
    if (info.pourToi) {
      bodyEl.innerHTML = renderSimpleMarkdown(info.pourToi);
    } else if (info.fullNotes) {
      // Fallback : pas de section "Pour toi", on affiche un avertissement
      // et la version brute (utile en attendant que la prochaine release
      // inclue la section dediee).
      bodyEl.innerHTML = `
        <p class="version-modal-empty">Pas encore de résumé en clair pour cette version. Voici les notes complètes :</p>
        ${renderSimpleMarkdown(info.fullNotes)}
      `;
    } else {
      bodyEl.innerHTML = '<p class="version-modal-empty">Notes indisponibles pour le moment.</p>';
    }
  }
}

function formatDateFR(isoString) {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return "";
  }
}



function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // T1 (v1.16.1, revue) : on capture l'EXISTENCE d'un controller AVANT
  // register. Si null -> 1ere install (pas un update) -> on ignore le 1er
  // controllerchange qui suit (sinon faux positif "Nouvelle version" au
  // premier chargement). Si non-null -> c'est un vrai update.
  const hadControllerBefore = !!navigator.serviceWorker.controller;
  let reloadingFromSwUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingFromSwUpdate) return;
    if (!hadControllerBefore) {
      // 1ere install (pas un update) : on ignore ce 1er controllerchange.
      // Les updates ulterieurs (avec hadControllerBefore toujours false dans
      // cette session) sont rares ; en pratique l'utilisateur a refresh
      // entre temps et hadControllerBefore sera true a la prochaine load.
      return;
    }
    reloadingFromSwUpdate = true;
    showSwUpdateNotification();
  });
  navigator.serviceWorker.register("/service-worker.js")
    .then(registration => {
      registration.update();
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            // SW installe pret a prendre le controle ET il y avait deja un
            // controller (vrai update, pas 1ere install).
            showSwUpdateNotification();
          }
        });
      });
    })
    .catch(() => {});
}

// T1 (v1.16.1, revue) : toast PERSISTANT custom (DOM dedie) avec bouton
// "Recharger". L'ancien `notify('info')` disparaissait apres 3.5s et n'avait
// pas de bouton -> l'utilisateur ne voyait rien d'actionnable.
let swUpdateNotificationShown = false;
function showSwUpdateNotification() {
  if (swUpdateNotificationShown) return;
  swUpdateNotificationShown = true;
  // Une nouvelle version attend un rechargement : la pastille cesse de dire
  // « A jour », ce qui serait faux, et le dit.
  for (const etat of [document.getElementById("sidebarVersionEtat"), document.getElementById("parVersionEtat")]) {
    if (!etat) continue;
    etat.textContent = "Mise à jour";
    etat.hidden = false;
  }
  try {
    if (document.getElementById("sw-update-toast")) return;
    const toast = document.createElement("div");
    toast.id = "sw-update-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `
      <span class="sw-update-toast-msg">Nouvelle version de l'app disponible.</span>
      <button type="button" class="sw-update-toast-btn" id="sw-update-reload">Recharger</button>
      <button type="button" class="sw-update-toast-close" id="sw-update-dismiss" aria-label="Fermer">×</button>
    `;
    document.body.appendChild(toast);
    document.getElementById("sw-update-reload").addEventListener("click", () => {
      window.location.reload();
    });
    document.getElementById("sw-update-dismiss").addEventListener("click", () => {
      toast.remove();
    });
  } catch { /* DOM indisponible tres tot : on retentera plus tard */ }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

window.Sereo = {
  loadData,
  showTab
};

async function recalculateRoute() {
  if (!activeRoute) throw new Error("Crée une tournée avant de recalculer.");
  activeRoute = await apiFetch(`/api/routes/${encodeURIComponent(activeRoute.id)}/recalculate`, {method:"POST",timeoutMs:90000,headers:{"Content-Type":"application/json"},body:JSON.stringify({fixedOrder: true})});
  await loadData();
  notify("Tracé routier recalculé.", "success");
}
// Actualise uniquement la vue d'accueil, sans interrompre une saisie ou une tournée.
let operationsRefreshing = false;
setInterval(async () => {
  if (document.hidden || !document.getElementById("journee")?.classList.contains("active") || document.querySelector("dialog[open]") || operationsRefreshing) return;
  operationsRefreshing = true;
  try { await loadData(); } finally { operationsRefreshing = false; }
}, 60000);

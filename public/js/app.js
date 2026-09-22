import { initOperations, renderOperations, getRoutePoints } from "./operations.js";
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
let markers = [];
let routeLine = null;
let deliverySelection = new Set();
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
  status: "all"
};
let relanceFilter = "today";
let customerProductFilter = {
  query: "",
  category: "all"
};
let customerCart = new Map();
let todayOrdersSelection = new Set();
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
        ? "Tu peux ré-importer tes fichiers Excel depuis Paramètres → Historique des imports."
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
  return ecrans.map(onglet => titles[onglet]?.title || "");
}

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

  document.getElementById("stockCategoryFilter")?.addEventListener("change", event => {
    stockFilter.category = event.target.value;
    renderStock();
  });

  let preparationSearchTimer = null;
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

  document.getElementById("todayOrdersDate")?.addEventListener("change", async event => {
    todayOrdersSelection.clear();
    await loadTodayOrders(event.target.value);
    renderTodayOrders();
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
      runAction(stockButton, "...", () => changeStock(stockButton.dataset.productId, Number(stockButton.dataset.stockDelta)));
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
    if (action === "mark-delivered") runAction(actionButton, "Envoi...", () => updateCurrentDeliveryStatus("livre"));
    if (action === "mark-absent") runAction(actionButton, "Envoi...", () => marquerArret("absent"));
    if (action === "mark-problem") runAction(actionButton, "Envoi...", () => marquerArret("probleme"));
    if (action === "mark-reschedule") runAction(actionButton, "Envoi...", () => marquerArret("a_reprogrammer"));
    if (action === "replan-current-stop") runAction(actionButton, "Planification...", replanCurrentStop);
    if (action === "next-client") nextClient();
    if (action === "open-maps") openGoogleMaps();
    if (action === "call-current-client") callCurrentClient();
    if (action === "save-coordinates") runAction(actionButton, "Sauvegarde...", saveCurrentCoordinates);
    if (action === "select-all-today-orders") {
      todayCustomerOrders.forEach(order => todayOrdersSelection.add(String(order.id)));
      renderTodayOrders();
    }
    if (action === "clear-today-orders") {
      todayOrdersSelection.clear();
      renderTodayOrders();
    }
    if (action === "send-today-orders-preparation") runAction(actionButton, "Envoi...", sendTodayOrdersToPreparation);
    if (action === "confirm-planned-order") runAction(actionButton, "Confirmation...", () => confirmPlannedOrder(actionButton.dataset.orderId));
    if (action === "cancel-planned-order") runAction(actionButton, "Annulation...", () => cancelPlannedOrder(actionButton.dataset.orderId));
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

    const todayOrderCheckbox = event.target.closest("[data-today-order]");
    if (todayOrderCheckbox) {
      if (todayOrderCheckbox.checked) todayOrdersSelection.add(String(todayOrderCheckbox.dataset.todayOrder));
      else todayOrdersSelection.delete(String(todayOrderCheckbox.dataset.todayOrder));
      renderTodayOrders();
    }
  });

  window.addEventListener("hashchange", () => showTab(getInitialTab(), { updateHash: false }));
}

function getInitialTab() {
  const hash = window.location.hash.replace("#", "");
  // Un ancien ecran-liste dans l'adresse (un favori, un lien) est rendu tel
  // quel : showTab() le redirige, filtre compris.
  if (hash in REDIRECTIONS) return hash;
  return mainTabs.has(hash) ? hash : "journee";
}


function showTab(tabName, options = {}) {
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
      bloquees: false, recherche: "", du: "", au: "", secteur: "", jour: "", page: 1
    });
    for (const id of ["cmdRecherche", "cmdDu", "cmdAu"]) {
      const champ = document.getElementById(id);
      if (champ) champ.value = "";
    }
    commandesSelection.clear();
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
  const zones = [
    ["dashboardPreparing", 3], ["dashboardDelivering", 3], ["dashboardSubscriptions", 3],
    ["crmList", 4], ["stockList", 5], ["todayOrdersList", 4], ["plannedOrdersList", 4],
    ["relanceList", 3], ["exportsList", 3], ["historiqueList", 3], ["stockMovementList", 4],
    // Ajoutes apres mesure : la premiere liste avait ete ecrite de memoire, et
    // le graphique du tableau de bord -- le plus grand vide de l'ecran, 556x184
    // -- n'y figurait pas. On ne devine pas quels conteneurs sont vides, on les
    // releve dans la page pendant que l'API est ralentie.
    ["revenueChart", 6], ["opAlerts", 3]
  ];
  for (const [id, lignes] of zones) {
    const zone = document.getElementById(id);
    if (!zone || zone.children.length) continue;
    zone.setAttribute("aria-busy", "true");
    zone.innerHTML = squelette(lignes, id === "revenueChart" ? "colonnes" : "liste");
  }
}

/** Retire les squelettes restants : une zone qui n'a pas ete remplie l'est par
 *  son propre rendu, mais une zone en erreur garderait des blocs gris a vie. */
function retirerSquelettes() {
  for (const zone of document.querySelectorAll('[aria-busy="true"]')) {
    zone.removeAttribute("aria-busy");
    if (zone.querySelector(".squelette")) zone.innerHTML = "";
  }
}

async function loadData() {
  setStatus("Chargement...");
  poserSquelettes();

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
    { key: "todayCustomerOrders", path: `/api/customer-orders/today?date=${encodeURIComponent(getTodayOrdersDate())}`, fallback: [] },
    { key: "plannedOrders", path: "/api/planned-orders", fallback: [] },
    { key: "statistics", path: "/api/statistics", fallback: null },
    { key: "sectors", path: "/api/sectors", fallback: [] },
    { key: "deliverySectors", path: "/api/delivery-sectors", fallback: [] },
    { key: "routes", path: "/api/routes", fallback: [] },
    { key: "stockMovements", path: "/api/stock-movements", fallback: [] },
    { key: "dashboard", path: "/api/dashboard", fallback: null }
  ];

  const results = await Promise.allSettled(endpoints.map(e => apiFetch(e.path)));

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
  const data = {};
  results.forEach((r, i) => {
    const e = endpoints[i];
    if (r.status === "fulfilled") {
      data[e.key] = r.value;
    } else {
      data[e.key] = e.fallback;
      failed.push(e.key);
    }
  });

  clients = (data.clients || []).map(client => ({
    ...client,
    statut: client.statut || "restant"
  }));
  stock = data.stock;
  ventes = data.ventes;
  historique = data.historique;
  orders = data.orders;
  crmClients = data.crmClients;
  crmRelances = data.crmRelances;
  todayCustomerOrders = data.todayCustomerOrders;
  plannedOrders = data.plannedOrders;
  statistics = data.statistics;
  sectors = data.sectors;
  deliverySectors = data.deliverySectors;
  deliveryRoutes = data.routes;
  stockMovements = data.stockMovements;
  dashboard = data.dashboard;

  refreshActiveRoute();
  route = activeRoute ? activeRoute.stops : (currentIndex >= 0 ? route : [...clients]);

  renderAll();
  renderOperations({operations:data.operations,subscriptions:data.subscriptions,crmClients,stock,orders});

  if (failed.length === 0) {
    setStatus("À jour");
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
    notify(`Sections indisponibles : ${friendly}. Le reste est à jour.`, "warning");
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

function dateCourte(iso) {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
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
      + `<span class="cmd-date">${escapeHtml(dateCourte(dateDeLaCommande(order)))}</span>`
      + `<span class="cmd-client">${escapeHtml(order.clientName || "Client")}</span>`
      + `<span class="cmd-secteur">${escapeHtml(order.sector ? formatSectorLabel(order.sector) : "—")}</span>`
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
  ecran.addEventListener("click", event => {
    const pilule = event.target.closest("[data-cmd-filtre]");
    if (pilule) {
      commandesFiltre.statut = pilule.dataset.cmdFiltre;
      commandesFiltre.page = 1;
      commandesSelection.clear();
      renderCommandes();
      return;
    }
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

function renderAll() {
  majEnteteTableauDeBord(getInitialTab());
  renderStats();
  renderDailySummary();
  renderImportSummary();
  renderCrm();
  renderRelances();
  renderCustomerOrder();
  renderTodayOrders();
  renderPlannedOrders();
  renderStatistics();
  renderExports();
  renderStock();
  renderStockMovements();
  renderPreparation();
  renderRecommande();
  renderCommandesLivrees();
  renderBonsCommande();
  renderCommandes();
  renderProduits();
  renderVentes();
  renderAlertes();
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

function renderCrm() {
  const container = document.getElementById("crmList");
  const summary = document.getElementById("crmSummary");
  if (!container) return;

  const today = getTodayDateInput();
  const query = normalizeTextKey(crmFilter.query);
  const filter = crmFilter.status || "all";
  let list = crmClients.slice();

  if (query) {
    list = list.filter(client => normalizeTextKey([
      client.nom, client.prenom, client.telephone, client.rue, client.ville, client.email
    ].join(" ")).includes(query));
  }
  if (filter !== "all") {
    if (filter === "relance_today") list = list.filter(client => client.nextReminderDate === today);
    else if (filter === "relance_late") list = list.filter(client => client.nextReminderDate && client.nextReminderDate < today);
    else list = list.filter(client => client.crmStatus === filter);
  }

  if (summary) summary.textContent = `${list.length} contact${list.length > 1 ? "s" : ""}`;
  renderClientSelects();

  if (!list.length) {
    container.innerHTML = emptyState("Aucun contact", "Crée une fiche ou modifie les filtres.");
    return;
  }

  container.innerHTML = list.map(client => `
    <article class="crm-card">
      <header class="item-header">
        <div>
          <h4>${escapeHtml([client.prenom, client.nom].filter(Boolean).join(" ") || client.nom)}</h4>
          <p>${escapeHtml([client.rue, client.codePostal, client.ville].filter(Boolean).join(" - ") || "Adresse a completer")}</p>
        </div>
        <span class="pill ${crmStatusPill(client.crmStatus)}">${escapeHtml(crmStatusLabel(client.crmStatus))}</span>
      </header>
      <div class="crm-meta">
        <span>${escapeHtml(client.telephone || "Telephone a completer")}</span>
        <span>${escapeHtml(client.email || "Email non renseigne")}</span>
        <span>${escapeHtml(client.totalOrders || 0)} commande(s)</span>
        <span>${formatMoney(client.totalRevenue || 0)}</span>
      </div>
      <p class="muted">${escapeHtml(client.notes || client.needs || "Aucune note")}</p>
      <div class="card-actions">
        <button class="button ok compact" type="button" data-crm-status-client="${escapeAttribute(client.id)}" data-crm-status="client_actif">Client actif</button>
        <button class="button warning compact" type="button" data-crm-status-client="${escapeAttribute(client.id)}" data-crm-status="client_a_relancer">A relancer</button>
        <button class="button danger compact" type="button" data-crm-status-client="${escapeAttribute(client.id)}" data-crm-status="client_inactif">Inactif</button>
      </div>
    </article>
  `).join("");
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

async function saveCrmClient(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  await apiFetch("/api/crm/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  form.reset();
  await loadData();
  notify("Fiche CRM enregistree.", "success");
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

  document.querySelectorAll("[data-relance-filter]").forEach(button => {
    button.classList.toggle("active-filter", button.dataset.relanceFilter === relanceFilter);
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

function getTodayOrdersDate() {
  const input = document.getElementById("todayOrdersDate");
  return input?.value || getTodayDateInput();
}

async function loadTodayOrders(date = getTodayOrdersDate()) {
  todayCustomerOrders = await apiFetch(`/api/customer-orders/today?date=${encodeURIComponent(date)}`);
}

function renderTodayOrders() {
  const input = document.getElementById("todayOrdersDate");
  if (input && !input.value) input.value = getTodayDateInput();
  const container = document.getElementById("todayOrdersList");
  if (!container) return;
  if (!todayCustomerOrders.length) {
    container.innerHTML = emptyState("Aucune commande client", "Les commandes validées chez les clients apparaîtront ici.");
    return;
  }
  container.innerHTML = todayCustomerOrders.map(order => `
    <article class="item today-order-card ${getOrderPill(order.status)}">
      <div class="today-order-row">
        <label class="select-row">
          <input type="checkbox" data-today-order="${escapeAttribute(order.id)}" ${todayOrdersSelection.has(String(order.id)) ? "checked" : ""} ${order.status !== "commande_client_validee" ? "disabled" : ""}>
          <span></span>
        </label>
        <div>
          <h4>${escapeHtml(order.clientName)}</h4>
          <p>${escapeHtml(formatOrderAddress(order))}</p>
          <p class="muted">${escapeHtml((order.products || []).map(line => `${line.nom} x${line.quantite}`).join(" - "))}</p>
        </div>
        <div class="today-order-side">
          <span class="pill ${getOrderPill(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span>
          <strong>${formatMoney(order.total || 0)}</strong>
        </div>
      </div>
    </article>
  `).join("");
}

async function sendTodayOrdersToPreparation() {
  await apiFetch("/api/customer-orders/send-preparation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderIds: Array.from(todayOrdersSelection) })
  });
  todayOrdersSelection.clear();
  await loadData();
  notify("Commandes envoyées en préparation.", "success");
}

function renderPlannedOrders() {
  const container = document.getElementById("plannedOrdersList");
  const summary = document.getElementById("plannedOrdersSummary");
  if (!container) return;

  const active = plannedOrders.filter(order => order.status !== "annulee");
  if (summary) summary.textContent = `${active.length} planifiée${active.length > 1 ? "s" : ""}`;

  if (!plannedOrders.length) {
    container.innerHTML = emptyState("Aucune commande planifiée", "Crée une commande planifiée depuis l'onglet Commande client.", { libelle: "Commande client", onglet: "commande-client" });
    return;
  }

  container.innerHTML = plannedOrders.map(order => {
    const reminder = crmRelances.find(item => String(item.commandeId) === String(order.id));
    const canConfirm = ["planifiee", "a_confirmer"].includes(order.status);
    const canCancel = !["annulee", "stock_a_verifier", "en_preparation", "pret_livraison", "en_livraison", "livre"].includes(order.status);
    return `
      <article class="item planned-order-card ${getOrderPill(order.status)}">
        <div class="item-header">
          <div>
            <h4>${escapeHtml(order.clientName)}</h4>
            <p>${escapeHtml(formatOrderAddress(order))}</p>
            <p class="muted">${escapeHtml((order.products || []).map(line => `${line.nom} x${line.quantite}`).join(" - "))}</p>
          </div>
          <span class="pill ${getOrderPill(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span>
        </div>
        <div class="order-meta">
          <span>Livraison : ${escapeHtml(order.deliveryDate ? formatDeliveryDate(order.deliveryDate) : "à dater")}</span>
          <span>Rappel : ${escapeHtml(reminder?.datePrevue ? formatDeliveryDate(reminder.datePrevue) : "-")}</span>
          <span>Total : ${formatMoney(order.total || 0)}</span>
        </div>
        <div class="card-actions">
          <button class="button ok" type="button" data-action="confirm-planned-order" data-order-id="${escapeAttribute(order.id)}" ${canConfirm ? "" : "disabled"}>Confirmer</button>
          <button class="button danger" type="button" data-action="cancel-planned-order" data-order-id="${escapeAttribute(order.id)}" ${canCancel ? "" : "disabled"}>Annuler</button>
        </div>
      </article>
    `;
  }).join("");
}

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
  kpis.innerHTML = items.map(item => `
    <article class="stat-tile stat-tile-${escapeAttribute(item.tone)}">
      <i aria-hidden="true"></i>
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.hint)}</small>
    </article>
  `).join("");

  const evolution = document.getElementById("statsEvolution");
  if (evolution) {
    evolution.innerHTML = `
      <span class="pill ${statistics.week?.evolution?.label === "baisse" ? "pill-danger" : "pill-ok"}">${escapeHtml(formatEvolution(statistics.week?.evolution))}</span>
      <span class="pill ${statistics.month?.evolution?.label === "baisse" ? "pill-danger" : "pill-blue"}">${escapeHtml(formatEvolution(statistics.month?.evolution))}</span>
    `;
  }

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
  container.innerHTML = rows.map(row => {
    const total = Number(row.total) || 0;
    const height = total > 0 ? Math.max(3, total / max * 100) : 2;
    const label = `${row.date} : ${formatMoney(row.total)}`;
    return `
    <div class="bar-item ${total > 0 ? "is-active" : ""}" title="${escapeAttribute(label)}" role="img" aria-label="${escapeAttribute(label)}">
      <span style="height:${height}%"></span>
      <small>${escapeHtml(String(row.date).slice(5))}</small>
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
  renderStockFilterOptions();
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

  const filtered = getFilteredStock();

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
  const categories = new Set(stock.map(categorieDuProduit)).size;
  setText("pageSubtitle", n
    ? `${n} référence${n > 1 ? "s" : ""} · ${sous} sous le seuil · ${categories} catégorie${categories > 1 ? "s" : ""}`
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
  bloc.classList.toggle("stk-categories--liste", categories.length > 12);
  bloc.hidden = !categories.length;
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

function renderStockFilterOptions() {
  const categorySelect = document.getElementById("stockCategoryFilter");
  if (!categorySelect) return;

  const current = stockFilter.category || "all";
  const categories = [...new Set(stock.map(product => product.category || product.type || "").filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr"));

  categorySelect.innerHTML = `
    <option value="all">Toutes</option>
    ${categories.map(category => `
      <option value="${escapeAttribute(category)}" ${category === current ? "selected" : ""}>${escapeHtml(category)}</option>
    `).join("")}
  `;
}

function getFilteredStock() {
  const query = normalizeTextKey(stockFilter.query);
  const status = stockFilter.status || "all";
  const category = stockFilter.category || "all";

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
  const quantity = Number(String(value || 0).replace(",", "."));

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

function renderPreparation() {
  renderPreparationStats();
  renderPreparationFilterOptions();

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

function createPreparationRow(order) {
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

/** Le detail d'une commande, en sheet : l'adresse, la date, le stock, et les actions. */
function openCommandeDetail(orderId) {
  const dialogue = document.getElementById("commandeDetailDialog");
  const corps = document.getElementById("commandeDetailCorps");
  const order = orders.find(item => String(item.id) === String(orderId));
  if (!dialogue || !corps || !order || typeof dialogue.showModal !== "function") return;
  corps.innerHTML = "";
  corps.appendChild(createPreparationCard(order));
  const titre = document.getElementById("commandeDetailTitre");
  if (titre) titre.textContent = order.clientName;
  dialogue.showModal();
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
    button.classList.toggle("active-filter", button.dataset.recommendFilter === recommendFilter);
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
      const available = product.quantityAvailable ?? getProductQuantity(product) ?? 0;
      const needed = product.quantityNeeded ?? getNeededQuantityForProduct(product);
      const threshold = getProductThreshold(product);
      const shortage = Math.max(0, needed - available);
      const thresholdGap = Math.max(0, threshold - available);
      const recommended = Math.ceil(Math.max(shortage, thresholdGap));
      const level = available <= 0 || shortage > 0 ? "urgent" : (recommended > 0 ? "bientot" : "ok");

      return {
        product,
        available,
        needed,
        threshold,
        recommended,
        level,
        label: level === "urgent" ? "Urgent" : (level === "bientot" ? "Bientôt" : "OK")
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

// Helpers ERP v1.11.0 partages entre renderCommandesLivrees et renderBonsCommande

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


function renderCommandesLivrees() {
  const container = document.getElementById("commandesLivreesList");
  const summary = document.getElementById("commandesLivreesSummary");
  if (!container) return;

  const livrees = (orders || []).filter(order => order.status === "livre");

  if (summary) {
    summary.textContent = livrees.length
      ? `${livrees.length} commande${livrees.length > 1 ? "s" : ""} livrée${livrees.length > 1 ? "s" : ""}.`
      : "";
  }

  if (!livrees.length) {
    container.innerHTML = emptyState(
      "Aucune commande livrée",
      "Les commandes terminées via une tournée ou importées comme déjà livrées apparaîtront ici."
    );
    return;
  }

  const sorted = livrees.slice().sort((a, b) => {
    const dateA = a.deliveryDate || a.updatedAt || "";
    const dateB = b.deliveryDate || b.updatedAt || "";
    return String(dateB).localeCompare(String(dateA));
  });

  container.innerHTML = sorted.map(order => {
    const products = Array.isArray(order.products) ? order.products : [];
    const productsHtml = products.length
      ? products.map(p => {
          // Cas 1 : code-barre dans le champ `code` -> on garde tel quel
          // Cas 2 : code-barre fusionne dans le `nom` -> on le separe
          const rawName = p.nom || p.code || "Produit";
          const split = splitProductCode(rawName);
          const codeDisplay = p.code && p.code !== rawName
            ? p.code
            : split.code || "";
          return `
            <li class="commandes-livrees-product">
              <div class="cl-product-main">
                ${codeDisplay ? `<code class="cl-product-code">${escapeHtml(codeDisplay)}</code>` : ""}
                <span>${escapeHtml(split.name)}</span>
              </div>
              <span class="muted">x ${escapeHtml(p.quantite ?? 0)}</span>
            </li>
          `;
        }).join("")
      : `<li class="muted">Aucun produit identifié.</li>`;

    const origin = order.importedAsLivre
      ? `<span class="pill pill-warning">Importée déjà livrée</span>`
      : `<span class="pill pill-ok">Livrée via tournée</span>`;

    // ERP v1.11.0 : numero CMD-... affiche pour coherence avec page Bons de commande,
    // et toute la carte est cliquable pour ouvrir le meme modal detail.
    const numero = order.numero || "(non numéroté)";
    const dateDisplay = order.dateCommande || order.deliveryDate || order.updatedAt;

    return `
      <article class="item commandes-livrees-card" data-action="open-bdc-detail" data-order-id="${escapeAttribute(order.id)}" role="button" tabindex="0" aria-label="Ouvrir le détail du bon ${escapeAttribute(numero)}">
        <header class="item-header">
          <div>
            <div class="cl-numero-line">
              <strong class="cl-numero">${escapeHtml(numero)}</strong>
              <span class="muted">· ${escapeHtml(formatDateDayOnly(dateDisplay))}</span>
            </div>
            <h4>${escapeHtml(order.clientName || "Client")}</h4>
            <p class="muted">${escapeHtml([order.address, order.postalCode, order.city].filter(Boolean).join(" · "))}</p>
          </div>
          ${origin}
        </header>
        <div class="item-meta">
          <span class="muted">Secteur : ${escapeHtml(order.sector || "-")}</span>
        </div>
        <ul class="commandes-livrees-products">
          ${productsHtml}
        </ul>
      </article>
    `;
  }).join("");
}

// ============================================================================
// PAGE "BONS DE COMMANDE" (Phase 3 ERP v1.10.0)
//
// Liste triable + filtrable de TOUS les bons de commande (toutes statuts).
// Filtres : recherche texte (numero CMD-... ou client), statut, secteur, date.
// Vue detail : modal avec lignes produits, statut workflow, hash, dates.
// Tri par defaut : dateCommande desc, puis numero desc (plus recent en haut).
// ============================================================================

const bdcState = {
  status: "all",
  search: "",
  sector: "",
  dateFrom: "",
  dateTo: "",
  view: "cards",       // "cards" | "table"
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

function bdcMatchSearch(order, search) {
  if (!search) return true;
  const q = search.toLowerCase();
  return (
    (order.numero || "").toLowerCase().includes(q) ||
    (order.clientName || "").toLowerCase().includes(q) ||
    (order.id || "").toLowerCase().includes(q)
  );
}

function bdcFilterOrders() {
  return (orders || [])
    .filter(o => o && o.clientId)
    .filter(o => {
      // Filtre statut, avec cas special "to_complete" (filtre meta sur completude profil)
      if (bdcState.status === "all") return true;
      if (bdcState.status === "to_complete") return bdcNeedsCompletion(o);
      return o.status === bdcState.status;
    })
    .filter(o => !bdcState.sector || o.sector === bdcState.sector)
    .filter(o => bdcMatchSearch(o, bdcState.search))
    .filter(o => {
      const d = String(o.dateCommande || "").slice(0, 10);
      if (bdcState.dateFrom && d < bdcState.dateFrom) return false;
      if (bdcState.dateTo && d > bdcState.dateTo) return false;
      return true;
    })
    .sort((a, b) => {
      const dateA = String(a.dateCommande || "").slice(0, 10);
      const dateB = String(b.dateCommande || "").slice(0, 10);
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return String(b.numero || "").localeCompare(String(a.numero || ""));
    });
}

function renderBdcSectorOptions() {
  const select = document.getElementById("bdc-sector");
  if (!select) return;
  const currentValue = select.value;
  const sectors = Array.from(new Set((orders || [])
    .map(o => o.sector)
    .filter(Boolean))).sort();
  select.innerHTML = `<option value="">Tous secteurs</option>` +
    sectors.map(s => `<option value="${escapeAttribute(s)}">${escapeHtml(s)}</option>`).join("");
  // Re-set valeur si elle est toujours dispo
  if (currentValue && sectors.includes(currentValue)) select.value = currentValue;
}

function renderBonsCommande() {
  const container = document.getElementById("bdc-list");
  const summary = document.getElementById("bdc-summary");
  if (!container) return;

  renderBdcSectorOptions();

  const filtered = bdcFilterOrders();
  const allOrders = (orders || []).filter(o => o && o.clientId);
  const total = allOrders.length;
  const toCompleteCount = allOrders.filter(bdcNeedsCompletion).length;

  // Mettre a jour le compteur du bouton "A completer"
  const toCompleteBtn = document.querySelector('[data-bdc-status="to_complete"]');
  if (toCompleteBtn) {
    const baseLabel = "⚠ À compléter";
    toCompleteBtn.textContent = toCompleteCount > 0
      ? `${baseLabel} (${toCompleteCount})`
      : baseLabel;
    toCompleteBtn.disabled = toCompleteCount === 0;
  }

  if (summary) {
    summary.textContent = total === 0
      ? "Aucune commande pour l'instant. Importe ton fichier ventes pour commencer."
      : `${filtered.length} bon${filtered.length > 1 ? "s" : ""} affiché${filtered.length > 1 ? "s" : ""} sur ${total} au total.`;
  }

  // Toggle classes selon la vue active
  container.classList.toggle("bdc-list-table-mode", bdcState.view === "table");

  if (!filtered.length) {
    container.innerHTML = emptyState(
      "Aucun bon ne correspond aux filtres",
      total === 0
        ? "Importe ton fichier de ventes pour voir les bons de commande ici."
        : "Essaie de réinitialiser les filtres ou d'élargir la plage de dates."
    );
    return;
  }

  if (bdcState.view === "table") {
    container.innerHTML = renderBdcTable(filtered);
    return;
  }

  container.innerHTML = filtered.map(order => {
    const productsCount = Array.isArray(order.products) ? order.products.length : 0;
    const totalQty = (order.products || []).reduce((sum, p) => sum + Number(p.quantite || 0), 0);
    const numero = order.numero || `(non numéroté)`;
    const address = [order.address, order.postalCode, order.city].filter(Boolean).join(" · ");
    const livreFromImport = order.importedAsLivre
      ? `<span class="bdc-pill bdc-pill-neutral" title="Importée comme déjà livrée">📥 import livré</span>`
      : "";
    const addressHtml = address
      ? `<p class="muted">${escapeHtml(address)}</p>`
      : `<p class="bdc-card-no-address">⚠ Adresse non renseignée</p>`;

    return `
      <article class="bdc-card" data-action="open-bdc-detail" data-order-id="${escapeAttribute(order.id)}" role="button" tabindex="0" aria-label="Ouvrir le détail du bon ${escapeAttribute(numero)}">
        <header class="bdc-card-head">
          <div class="bdc-card-numero">
            <strong>${escapeHtml(numero)}</strong>
            <span class="bdc-card-date">${escapeHtml(bdcFormatDate(order.dateCommande))}</span>
          </div>
          ${bdcStatusBadge(order.status)}
        </header>
        <div class="bdc-card-client">
          <h4>${escapeHtml(order.clientName || "Client sans nom")}</h4>
          ${addressHtml}
        </div>
        <footer class="bdc-card-foot">
          <span class="muted">Secteur : <strong>${escapeHtml(order.sector || "—")}</strong></span>
          <span class="muted">${productsCount} ligne${productsCount > 1 ? "s" : ""} · ${totalQty} unité${totalQty > 1 ? "s" : ""}</span>
          ${livreFromImport}
        </footer>
      </article>
    `;
  }).join("");
}

// Vue tableau dense : utile pour scanner 100+ bons d'un coup. Sticky header,
// clic sur ligne ouvre le modal detail.
function renderBdcTable(orders) {
  const rows = orders.map(order => {
    const numero = order.numero || "(non numéroté)";
    const totalQty = (order.products || []).reduce((sum, p) => sum + Number(p.quantite || 0), 0);
    const productsCount = Array.isArray(order.products) ? order.products.length : 0;
    const needs = bdcNeedsCompletion(order);
    return `
      <tr data-action="open-bdc-detail" data-order-id="${escapeAttribute(order.id)}" tabindex="0" class="${needs ? "bdc-row-warning" : ""}">
        <td class="bdc-td-numero"><strong>${escapeHtml(numero)}</strong></td>
        <td class="muted">${escapeHtml(bdcFormatDate(order.dateCommande))}</td>
        <td>${escapeHtml(order.clientName || "—")}</td>
        <td class="muted">${escapeHtml(order.sector || "—")}</td>
        <td>${bdcStatusBadge(order.status)}</td>
        <td class="bdc-td-num">${productsCount}</td>
        <td class="bdc-td-num">${totalQty}</td>
        <td>${needs ? `<span class="bdc-row-warning-flag" title="Profil client à compléter">⚠</span>` : ""}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="bdc-table-wrap" role="region" aria-label="Tableau des bons de commande">
      <table class="bdc-table">
        <thead>
          <tr>
            <th>Numéro</th>
            <th>Date</th>
            <th>Client</th>
            <th>Secteur</th>
            <th>Statut</th>
            <th class="bdc-td-num">Lignes</th>
            <th class="bdc-td-num">Qté</th>
            <th aria-label="Alertes"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// Export CSV des bons filtres. Pas d'endpoint backend : Blob + download client-side.
// Format : Numero;Date;Client;Adresse;CP;Ville;Secteur;Statut;Telephone;Lignes;Qté
// Separateur ; (compatibilite Excel FR), encodage UTF-8 BOM pour les accents.
function exportBdcCsv(liste = null, prefixe = "sereo-bons-commande") {
  // Le meme export sert l'ecran Commandes (planche 13c) : on lui passe SA
  // liste filtree. Sans argument, il garde son comportement d'origine.
  const filtered = liste || bdcFilterOrders();
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
  // Recherche texte (event input pour reactivite immediate)
  document.addEventListener("input", event => {
    const search = event.target.closest("#bdc-search");
    if (search) {
      bdcState.search = search.value || "";
      renderBonsCommande();
    }
  });

  // Filtres + clic carte + close modal (delegation au document)
  document.addEventListener("click", event => {
    const statusBtn = event.target.closest("[data-bdc-status]");
    if (statusBtn) {
      bdcState.status = statusBtn.dataset.bdcStatus;
      document.querySelectorAll(".bdc-status-filter").forEach(btn => {
        btn.classList.toggle("active-filter", btn.dataset.bdcStatus === bdcState.status);
      });
      renderBonsCommande();
      return;
    }

    const reset = event.target.closest('[data-action="bdc-reset-filters"]');
    if (reset) {
      bdcState.status = "all";
      bdcState.search = "";
      bdcState.sector = "";
      bdcState.dateFrom = "";
      bdcState.dateTo = "";
      const search = document.getElementById("bdc-search");
      if (search) search.value = "";
      const sector = document.getElementById("bdc-sector");
      if (sector) sector.value = "";
      const dateFrom = document.getElementById("bdc-date-from");
      if (dateFrom) dateFrom.value = "";
      const dateTo = document.getElementById("bdc-date-to");
      if (dateTo) dateTo.value = "";
      document.querySelectorAll(".bdc-status-filter").forEach(btn => {
        btn.classList.toggle("active-filter", btn.dataset.bdcStatus === "all");
      });
      renderBonsCommande();
      return;
    }

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

    // Toggle vue cartes / tableau
    const viewBtn = event.target.closest("[data-bdc-view]");
    if (viewBtn) {
      bdcState.view = viewBtn.dataset.bdcView;
      document.querySelectorAll(".bdc-view-btn").forEach(btn => {
        btn.classList.toggle("active-filter", btn.dataset.bdcView === bdcState.view);
      });
      renderBonsCommande();
      return;
    }

    // Export CSV
    if (event.target.closest('[data-action="bdc-export-csv"]')) {
      exportBdcCsv();
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

  // Selects et date inputs (event change)
  document.addEventListener("change", event => {
    if (event.target.id === "bdc-sector") {
      bdcState.sector = event.target.value || "";
      renderBonsCommande();
    }
    if (event.target.id === "bdc-date-from") {
      bdcState.dateFrom = event.target.value || "";
      renderBonsCommande();
    }
    if (event.target.id === "bdc-date-to") {
      bdcState.dateTo = event.target.value || "";
      renderBonsCommande();
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
    const label = next === "auto" ? "automatique" : (next === "dark" ? "sombre" : "clair");
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

function renderSettings() {
  updateBrandImageStatus();
  renderTourneeSettings();

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

  if (!moi.administration) {
    container.innerHTML = gabaritAccesRefuse(moi.roleLibelle || libelleRole(moi.role));
    if (form) form.hidden = true;
    return;
  }

  const select = document.getElementById("compteFormRole");
  if (select && !select.options.length) select.innerHTML = optionsRoles("livreur");
  if (form) form.hidden = false;

  try {
    comptes = await apiFetch("/api/comptes");
  } catch (error) {
    container.innerHTML = `<p class="muted">Comptes indisponibles : ${escapeHtml(error.message)}</p>`;
    return;
  }

  const entete = moi.source === "desactivee"
    ? gabaritAuthDesactivee()
    : "";

  container.innerHTML = entete + gabaritTableauComptes(comptes, { identifiantCourant: moi.identifiant });
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

    if (!archives.length) {
      container.innerHTML = `<p class="muted">Aucun import archivé pour l'instant. Tes prochains imports apparaitront ici.</p>`;
      return;
    }

    container.innerHTML = `
      <div class="imports-archives-table-wrap">
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
      `Purge OK : ${result.purged.commandes} bon(s), ${result.purged.clients} client(s), ${result.purged.ventes} vente(s), ${result.purged.routes} tournée(s) supprimés. Va dans Historique des imports ci-dessus pour ré-importer tes Excel.`,
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
        <span>${escapeHtml(formatOrderAddress(order))}</span>
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
    setButtonDisabled("startRouteButton", true);
    updateDriverActionButtons(null);
    return;
  }

  if (metrics) metrics.textContent = formatRouteMetrics(activeRoute);
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

  container.innerHTML = `
    <div class="route-complete">
      <strong>Tournée terminée</strong>
      ${routeData.arrival ? `<p><a class="button primary" href="https://www.google.com/maps/dir/?api=1&destination=${routeData.arrival.lat},${routeData.arrival.lng}" target="_blank" rel="noopener noreferrer">Rejoindre l’arrivée : ${escapeHtml(routeData.arrival.label || "point choisi")}</a></p>` : ""}
      <p>${escapeHtml(delivered)} livré(s), ${escapeHtml(absent)} absent(s), ${escapeHtml(problems)} problème(s)</p>
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
  const canChangeStatus = hasTarget && routeStarted && !terminalStop;
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

  const entities = getMapEntities();
  const points = [];

  entities.forEach((entity, index) => {
    const coords = getEntityCoordinates(entity);

    if (!coords) return;

    // Le meme marqueur que dans la ligne d'arret. La zone de toucher fait
    // 44 x 44 (plancher de la charte) ; le disque de 28 ou 34 est centre dedans.
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
    // Planche Carte.png : le trace est en ACCENT, 4,5 px, bouts ronds. Une
    // forme, pas un texte -- l'orange y est a sa place.
    routeLine = L.polyline(roadPoints, {color: couleurCharte("--v8-accent", "#EF9177"), weight: 4.5, opacity: 1, lineCap: "round", lineJoin: "round"}).addTo(map);
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

  // Session expiree (cookie 12h) -> redirige vers /login en preservant l'URL courante.
  // 429 = IP verrouillee (rate-limit auth) : on redirige aussi vers /login, qui
  // affiche le compte a rebours de lockout (sinon l'app afficherait un toast
  // "Erreur HTTP 429" opaque). Garde-fou : si on est deja sur /login, on ne
  // re-redirige pas (boucle infinie possible sur certains navigateurs).
  if ((res.status === 401 || res.status === 429) && !window.location.pathname.startsWith("/login")) {
    const next = window.location.pathname + window.location.search + window.location.hash;
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

function brancherFileHorsLigne() {
  window.addEventListener("online", () => { viderLaFile(); });
  window.addEventListener("offline", () => { setStatus(dernierStatut); });
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
}

/** Charte §4 : « Toast : bas d'ecran, 4 s, une action possible (Annuler) ». */
const TOAST_DUREE_MS = 4000;

function notify(message, type = "info") {
  const region = document.getElementById("toastRegion");
  if (!region) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = message;
  toast.appendChild(text);

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
    }, TOAST_DUREE_MS);
  }
}

/** Le statut de tournee vu la derniere fois : la planification ne se replie qu'au CHANGEMENT. */
let dernierStatutDeTournee = null;

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
    return;
  }

  if (bloc) bloc.hidden = true;
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
  const etat = document.getElementById("sidebarVersionEtat");
  if (etat && !swUpdateNotificationShown) {
    etat.textContent = "À jour";
    etat.hidden = !versionInfoCache?.version;
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
  const etat = document.getElementById("sidebarVersionEtat");
  if (etat) {
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

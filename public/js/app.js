// Sereo — point d'entree du front.
//
// Charge comme module ES (<script type="module"> dans index.html). Les
// utilitaires purs et les donnees de configuration vivent desormais dans
// ./utils/ et ./config/ ; ce fichier conserve l'etat de l'application et le
// rendu, qui seront decoupes par domaine dans les increments suivants.

import { escapeHtml, escapeAttribute, cssEscape, emptyState } from "./utils/dom.js";
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
  pastelThemes,
  applicationThemes
} from "./config/themes.js";
import { mainTabs, MOBILE_OVERFLOW_TABS, titles } from "./config/tabs.js";
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
let activeColorScheme = "light";

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



Object.keys(pastelThemes).forEach(themeId => delete pastelThemes[themeId]);
Object.assign(pastelThemes, applicationThemes);


document.addEventListener("DOMContentLoaded", () => {
  // Resolution synchrone du mode (avant tout render) :
  // - localStorage "dark"|"light"|"auto" -> on respecte le choix utilisateur
  // - sinon defaut "light" (set en haut du fichier)
  try {
    const stored = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
    if (VALID_COLOR_SCHEMES.includes(stored)) activeColorScheme = stored;
  } catch { /* ignore */ }

  applyTheme("sereo", { persist: false });
  applyBrandImage(DEFAULT_BRAND_IMAGE);
  updateMetaThemeColor();
  watchSystemColorScheme();
  bindUi();
  bindVersionModal();
  bindBonsCommandeUi();
  initMap();
  registerServiceWorker();
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
  document.querySelectorAll("#menuSearch, #globalNavigationSearch").forEach(input => {
    if (input !== sourceInput) input.value = value;
  });
}

function setNavigationSectionOpen(section, isOpen) {
  if (!section) return;
  section.classList.toggle("open", Boolean(isOpen));
  section.querySelector(".nav-section-toggle")?.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function getNavigationSectionForTab(tabName) {
  return Array.from(document.querySelectorAll(".sidebar .nav-section")).find(section => {
    return Boolean(section.querySelector(`.tab[data-tab="${tabName}"]`));
  });
}

function syncNavigationSections(activeTabName = getInitialTab()) {
  const activeSection = getNavigationSectionForTab(activeTabName);
  document.querySelectorAll(".sidebar .nav-section").forEach(section => {
    const isActiveSection = section === activeSection;
    section.classList.toggle("has-active-tab", isActiveSection);
    setNavigationSectionOpen(section, isActiveSection);
  });
}

function toggleNavSection(sectionId, forceOpen = null) {
  const section = Array.from(document.querySelectorAll(".sidebar .nav-section")).find(item => {
    return item.dataset.navSectionId === sectionId;
  });
  if (!section) return;
  const shouldOpen = forceOpen === null ? !section.classList.contains("open") : Boolean(forceOpen);
  if (shouldOpen) {
    document.querySelectorAll(".sidebar .nav-section").forEach(item => {
      if (item !== section) setNavigationSectionOpen(item, false);
    });
  }
  setNavigationSectionOpen(section, shouldOpen);
}

function filterNavigation(value) {
  const query = normalizeTextKey(value);
  const isSearching = Boolean(query);

  document.querySelectorAll(".sidebar .nav-section").forEach(section => {
    const categoryLabel = normalizeTextKey(section.querySelector(".nav-section-label")?.textContent || "");
    const categoryMatches = isSearching && categoryLabel.includes(query);
    let hasVisibleTab = false;

    section.querySelectorAll(".tab").forEach(tab => {
      const label = normalizeTextKey(tab.textContent || "");
      const isMatch = !isSearching || categoryMatches || label.includes(query);
      tab.classList.toggle("is-hidden-by-search", isSearching && !isMatch);
      if (isMatch) hasVisibleTab = true;
    });

    section.classList.toggle("is-filtering", isSearching);
    section.classList.toggle("is-hidden-by-search", isSearching && !hasVisibleTab);
    if (isSearching && hasVisibleTab) setNavigationSectionOpen(section, true);
  });

  if (!isSearching) syncNavigationSections(getInitialTab());
}

function navigateToFirstSearchMatch(value) {
  const query = normalizeTextKey(value);
  if (!query) return;

  filterNavigation(value);
  const sidebarTabs = Array.from(document.querySelectorAll(".sidebar .tab"));
  const directMatch = sidebarTabs.find(tab => {
    return normalizeTextKey(tab.textContent || "").includes(query);
  });
  const match = directMatch || sidebarTabs.find(tab => !tab.classList.contains("is-hidden-by-search"));

  if (!match?.dataset.tab) return;
  showTab(match.dataset.tab);
  setNavigationSearchValue("");
  filterNavigation("");
}

function bindNavigationSearch() {
  const inputs = Array.from(document.querySelectorAll("#menuSearch, #globalNavigationSearch"));
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

  document.getElementById("preparationSectorFilter")?.addEventListener("change", event => {
    preparationFilter.sector = event.target.value;
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

    if (action === "toggle-nav-section") {
      toggleNavSection(actionButton.dataset.navSectionTarget);
      return;
    }
    if (action === "refresh") runAction(actionButton, "Actualisation...", loadData);
    if (action === "go-tab") showTab(actionButton.dataset.targetTab || "journee");
    if (action === "open-more-menu") openMoreMenu();
    if (action === "close-more-menu") closeMoreMenu();
    if (action === "more-menu-pick") {
      showTab(actionButton.dataset.tab);
      closeMoreMenu();
    }
    if (action === "select-theme") applyTheme(actionButton.dataset.themeId, { notifyUser: true });
    if (action === "reset-theme") applyTheme("sereo", { notifyUser: true });
    if (action === "select-color-scheme") applyColorScheme(actionButton.dataset.colorScheme, { notifyUser: true });
    if (action === "reset-brand-image") resetBrandImage();
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
    if (action === "mark-absent") runAction(actionButton, "Envoi...", () => updateCurrentDeliveryStatus("absent"));
    if (action === "mark-problem") runAction(actionButton, "Envoi...", () => updateCurrentDeliveryStatus("probleme"));
    if (action === "mark-reschedule") runAction(actionButton, "Envoi...", () => updateCurrentDeliveryStatus("a_reprogrammer"));
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
  return mainTabs.has(hash) ? hash : "journee";
}


function showTab(tabName, options = {}) {
  const { updateHash = true } = options;
  const nextTab = titles[tabName] && mainTabs.has(tabName) ? tabName : "journee";

  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  document.querySelectorAll("[data-tab]").forEach(tab => {
    const isActive = tab.dataset.tab === nextTab;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  syncNavigationSections(nextTab);

  // Bouton "Plus" : actif si l'utilisateur est sur une destination "overflow"
  const moreBtn = document.getElementById("mobile-tab-more");
  if (moreBtn) {
    moreBtn.classList.toggle("active", MOBILE_OVERFLOW_TABS.has(nextTab));
  }

  document.getElementById(nextTab)?.classList.add("active");

  setText("pageTitle", titles[nextTab].title);
  setText("pageSubtitle", titles[nextTab].subtitle);

  updateCustomerCartBar();

  if (updateHash) {
    history.replaceState(null, "", `#${nextTab}`);
  }

  resetViewportScroll(updateHash);

  if (nextTab === "livreur" && map) {
    setTimeout(() => map.invalidateSize(), 150);
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

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

async function loadData() {
  setStatus("Chargement...");

  // Chantier 2 (audit 2026-06-04) : Promise.allSettled au lieu de Promise.all.
  // Avant : si UN seul endpoint timeout (30s), tout etait wipe (clients=[],
  // orders=[], stock=[]). UX catastrophique sur slow network.
  // Apres : chaque endpoint a son sort. Si le stock timeout, on garde la prep,
  // les clients, etc. Le user voit "Stock indisponible" sans tout perdre.
  const endpoints = [
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

function renderAll() {
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
  setText("statPreparable", orderCounts.preparable ?? orders.filter(order => ["importe", "stock_a_verifier"].includes(order.status) && order.canPrepare).length);
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
    container.innerHTML = emptyState("Aucun contact", "Cree une fiche ou modifie les filtres.");
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
    container.innerHTML = emptyState("Aucun produit", "Importe le stock ou modifie la recherche.");
    return;
  }
  container.innerHTML = products.map(product => {
    const quantity = getProductQuantity(product);
    const selected = customerCart.get(String(product.id))?.quantite || 0;
    return `
      <article class="product-card">
        <div>
          <h4>${escapeHtml(getProductName(product))}</h4>
          <p>${escapeHtml(product.code || product.sku || "Sans reference")}</p>
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
    container.innerHTML = emptyState("Aucune commande client", "Les commandes validees chez les clients apparaitront ici.");
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
  notify("Commandes envoyees en preparation.", "success");
}

function renderPlannedOrders() {
  const container = document.getElementById("plannedOrdersList");
  const summary = document.getElementById("plannedOrdersSummary");
  if (!container) return;

  const active = plannedOrders.filter(order => order.status !== "annulee");
  if (summary) summary.textContent = `${active.length} planifiée${active.length > 1 ? "s" : ""}`;

  if (!plannedOrders.length) {
    container.innerHTML = emptyState("Aucune commande planifiée", "Crée une commande planifiée depuis l'onglet Commande client.");
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
    { label: "CA jour", value: formatMoney(statistics.today?.revenue), hint: `${statistics.today?.orders || 0} commande(s)`, tone: "success" },
    { label: "CA semaine", value: formatMoney(statistics.week?.revenue), hint: formatEvolution(statistics.week?.evolution), tone: getEvolutionTone(statistics.week?.evolution) },
    { label: "CA mois", value: formatMoney(statistics.month?.revenue), hint: `${statistics.month?.orders || 0} commande(s) - ${formatEvolution(statistics.month?.evolution)}`, tone: getEvolutionTone(statistics.month?.evolution) },
    { label: "Panier moyen", value: formatMoney(statistics.averageBasket), hint: "Moyenne globale", tone: "info" },
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
    container.innerHTML = emptyState("Aucune donnee", "Les ventes validees alimenteront ce graphique.");
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

  if (!stock.length) {
    container.innerHTML = emptyState("Aucun stock chargé", "Importe un fichier stock pour initialiser le catalogue.");
    return;
  }

  const filtered = getFilteredStock();

  if (!filtered.length) {
    container.innerHTML = emptyState("Aucun produit trouvé", "Modifie la recherche ou le filtre de statut.");
    return;
  }

  filtered.forEach(product => {
    container.appendChild(createStockCard(product));
  });
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
  const select = document.getElementById("preparationSectorFilter");
  if (!select) return;
  const sectors = Array.from(new Set(orders.map(order => order.sector).filter(Boolean))).sort();
  const current = preparationFilter.sector;
  select.innerHTML = `<option value="all">Tous les secteurs</option>`
    + sectors.map(s => `<option value="${escapeAttribute(s)}"${s === current ? " selected" : ""}>${escapeHtml(s)}</option>`).join("");
  if (current !== "all" && !sectors.includes(current)) preparationFilter.sector = "all";
}

function renderPreparation() {
  renderPreparationStats();
  renderPreparationFilterOptions();

  const container = document.getElementById("preparationList");
  if (!container) return;

  container.innerHTML = "";

  if (!orders.length) {
    container.innerHTML = emptyState("Aucune commande à préparer", "Importe les dossiers du jour pour générer la préparation.");
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

  groups.forEach(group => {
    const column = document.createElement("section");
    column.className = "order-column";
    column.innerHTML = `
      <div class="order-column-header">
        <h4>${escapeHtml(group.title)}</h4>
        <span class="status-chip">${group.orders.length}</span>
        <p>${escapeHtml(group.hint)}</p>
      </div>
    `;

    if (!group.orders.length) {
      column.innerHTML += emptyState("Rien ici", "Cette colonne se remplira automatiquement.");
    } else {
      group.orders.forEach(order => column.appendChild(createPreparationCard(order)));
    }

    container.appendChild(column);
  });
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

  container.innerHTML = `
    <article class="workflow-card">
      <span>À analyser</span>
      <strong>${counts.imported}</strong>
    </article>
    <article class="workflow-card">
      <span>En préparation</span>
      <strong>${counts.preparing}</strong>
    </article>
    <article class="workflow-card">
      <span>Prêtes livraison</span>
      <strong>${counts.ready}</strong>
    </article>
    <article class="workflow-card danger-card">
      <span>Bloquées</span>
      <strong>${counts.blocked}</strong>
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
      <div>
        <h4>${escapeHtml(order.clientName)}</h4>
        <p>${escapeHtml(formatOrderAddress(order))}</p>
      </div>
      <span class="pill ${getOrderPill(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span>
    </div>
    <div class="order-meta">
      <span>Secteur : ${escapeHtml(order.sector || "-")}</span>
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
      <button class="button secondary" type="button" data-action="open-order-maps" data-order-id="${escapeAttribute(order.id)}">Google Maps</button>
    </div>
  `;

  return article;
}

async function startPreparation(orderId) {
  await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/start-preparation`, {
    method: "POST"
  });
  await loadData();
  notify("Commande passée en préparation. Stock réservé.", "success");
}

async function finishPreparation(orderId) {
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
    container.innerHTML = emptyState("Aucun produit", "Importe un fichier stock pour afficher les produits.");
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
    container.innerHTML = emptyState("Aucune vente", "Importe les dossiers du jour pour alimenter cette vue.");
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
function exportBdcCsv() {
  const filtered = bdcFilterOrders();
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
  a.download = `sereo-bons-commande-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  notify(`${filtered.length} bon${filtered.length > 1 ? "s" : ""} exporté${filtered.length > 1 ? "s" : ""} en CSV.`, "success");
}

function openBdcDetail(orderId) {
  const order = (orders || []).find(o => String(o.id) === String(orderId));
  if (!order) return;

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
    : `<span class="muted" title="Ce bon a ete cree manuellement, pas via un import Excel">Création manuelle</span>`;

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
    const order = (orders || []).find(o => String(o.clientId) === String(clientId));
    if (order) openBdcDetail(order.id);
  });
}

function closeBdcDetail() {
  const modal = document.getElementById("bdc-detail-modal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("version-modal-open");
  if (modal._releaseTrap) { modal._releaseTrap(); modal._releaseTrap = null; }
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
      const order = (orders || []).find(o => String(o.clientId) === String(bdcState.editingClientId));
      if (order) openBdcDetail(order.id);
      return;
    }

    // Cancel edition
    if (event.target.closest('[data-action="bdc-cancel-edit"]')) {
      const order = (orders || []).find(o => String(o.clientId) === String(bdcState.editingClientId));
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
    // d'un autre device. Si localStorage est vide, on retombe sur "light".
    let scheme = "light";
    try {
      const stored = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
      if (VALID_COLOR_SCHEMES.includes(stored)) scheme = stored;
    } catch { /* localStorage indispo : on garde le defaut "light" */ }
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
  return pastelThemes[activeThemeId] || pastelThemes.sereo;
}

function isVisuallyDarkTheme(theme = getActiveTheme()) {
  return theme.id === "noir" || getEffectiveColorScheme() === "dark";
}

// Applique les variables d'un theme en respectant le mode actif (clair / sombre).
// Le theme pastel definit ses 7 variables --color-* en 2 versions : `vars` et `darkVars`.
function applyThemeVariables(theme) {
  const effective = getEffectiveColorScheme();
  const variables = effective === "dark" && theme.darkVars ? theme.darkVars : theme.vars;
  const root = document.documentElement;
  root.dataset.appTheme = theme.id;
  Object.entries(variables).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
}

// Met a jour la meta theme-color (couleur de la barre OS sur mobile)
// pour refleter le mode actif. Utilise la couleur de fond.
function updateMetaThemeColor() {
  const theme = getActiveTheme();
  const color = theme.metaColor || (getEffectiveColorScheme() === "dark" ? "#0d1518" : "#f7f7f6");
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
  // Defaut "light" si valeur invalide (le mode auto reste choisissable explicitement).
  const next = VALID_COLOR_SCHEMES.includes(scheme) ? scheme : "light";
  activeColorScheme = next;

  const root = document.documentElement;
  if (next === "auto") {
    delete root.dataset.colorScheme;
  } else {
    root.dataset.colorScheme = next;
  }

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
  renderThemePalettes();
}

// Re-evalue le mode si l'OS change de prefers-color-scheme et qu'on est en "auto"
function watchSystemColorScheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (activeColorScheme === "auto") {
      const theme = getActiveTheme();
      applyThemeVariables(theme);
      updateMetaThemeColor();
      applyBrandImage(activeBrandImage);
      renderThemePalettes();
    }
  };
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else if (mq.addListener) mq.addListener(handler); // legacy Safari
}

function applyTheme(themeId, options = {}) {
  const { persist = true, notifyUser = false } = options;
  const theme = pastelThemes[themeId] || pastelThemes.sereo;

  activeThemeId = theme.id;
  applyThemeVariables(theme);
  updateMetaThemeColor();
  applyBrandImage(activeBrandImage);

  if (persist) {
    saveAppearance({ themeId: theme.id })
      .then(() => {
        if (notifyUser) notify(`Thème "${theme.name}" appliqué.`, "success");
      })
      .catch(error => notify(error.message, "error"));
  } else if (notifyUser) {
    notify(`Thème "${theme.name}" appliqué.`, "success");
  }

  renderThemePalettes();
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

function renderThemePalettes() {
  const container = document.getElementById("themePaletteList");
  if (!container) return;

  container.innerHTML = Object.values(pastelThemes).map(theme => {
    const isActive = theme.id === activeThemeId;
    const preview = theme.preview || {};
    return `
      <button class="theme-card ${isActive ? "active" : ""}" type="button" data-action="select-theme" data-theme-id="${escapeAttribute(theme.id)}" aria-pressed="${isActive ? "true" : "false"}">
        <span class="theme-card-header">
          <span class="theme-card-title">${escapeHtml(theme.name)}</span>
          <span class="theme-card-status">${isActive ? "Actif" : "Appliquer"}</span>
        </span>
        <span class="theme-card-hint">${escapeHtml(theme.hint)}</span>
        <span class="theme-card-preview" aria-hidden="true" style="--preview-bg:${escapeAttribute(preview.bg || theme.swatches[0])};--preview-sidebar:${escapeAttribute(preview.sidebar || theme.swatches[0])};--preview-card:${escapeAttribute(preview.card || "#ffffff")};--preview-accent:${escapeAttribute(preview.accent || theme.swatches[1] || theme.swatches[0])}">
          <i></i>
          <b></b>
          <em></em>
        </span>
        <span class="theme-card-swatches" aria-hidden="true">
          ${theme.swatches.map(color => `<i style="--swatch:${escapeAttribute(color)}"></i>`).join("")}
        </span>
      </button>
    `;
  }).join("");
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
      notify(error.message, "error");
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
    notify(error.message, "error");
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

  document.querySelectorAll(".brand-logo, [data-brand-preview]").forEach(image => {
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
          if (status) status.textContent = `Erreur : ${error.message || "réseau"}`;
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

function renderSettings() {
  renderThemePalettes();
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

  activeRoute = await apiFetch("/api/routes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
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
    row.innerHTML = `
      <button class="route-stop-main" type="button" data-action="select-stop" data-stop-index="${index}">
        <strong>${index + 1}. ${escapeHtml(stop.clientName)}</strong>
        <span>${escapeHtml(formatStopAddress(stop))}</span>
        <span class="pill ${getStopPill(stop.status)}">${escapeHtml(formatStopStatus(stop.status))}</span>
      </button>
      <div class="route-stop-actions">
        <button class="button secondary compact" type="button" data-action="move-stop-up" data-stop-id="${escapeAttribute(stop.id)}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="button secondary compact" type="button" data-action="move-stop-down" data-stop-id="${escapeAttribute(stop.id)}" ${index === activeRoute.stops.length - 1 ? "disabled" : ""}>↓</button>
      </div>
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

  container.innerHTML = `
    <div class="current-client-main">
      <strong>${escapeHtml(stop.clientName)}</strong>
      <span>${escapeHtml(formatStopAddress(stop))}</span>
      <span>${escapeHtml(formatPhone(stop.phone))}</span>
      <span>Statut : ${escapeHtml(formatStopStatus(stop.status))} · Secteur : ${escapeHtml(formatSectorLabel(stop.sector))}${stop.deliveryDate ? ` · ${escapeHtml(formatDeliveryDate(stop.deliveryDate))}` : ""}</span>
      ${stop.notes ? `<span class="current-client-note">${escapeHtml(stop.notes)}</span>` : ""}
      ${getAddressWarning(stop) ? `<span class="address-warning">${escapeHtml(getAddressWarning(stop))}</span>` : ""}
    </div>
    ${renderProducts({ produits: stop.products })}
  `;
  updateDriverActionButtons(stop);
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
      <p>${escapeHtml(delivered)} livré(s), ${escapeHtml(absent)} absent(s), ${escapeHtml(problems)} problème(s)</p>
      <div class="quick-actions">
        <button class="button primary" type="button" data-action="go-tab" data-target-tab="journee">Retour accueil</button>
        <button class="button secondary" type="button" data-action="go-tab" data-target-tab="recommande">Voir à recommander</button>
      </div>
    </div>
  `;
  updateDriverActionButtons(null);
}

async function updateCurrentDeliveryStatus(status) {
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
      body: JSON.stringify({ status })
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
    container.innerHTML = emptyState("Aucun client", "Importe les dossiers du jour pour générer la tournée.");
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

    const color = getMapColor(entity.status || entity.statut);

    const marker = L.circleMarker([coords.lat, coords.lng], {
      radius: 9,
      color,
      fillColor: color,
      fillOpacity: 0.95
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

  if (points.length > 1) {
    routeLine = L.polyline(points, {
      color: "#2563eb",
      weight: 4,
      opacity: 0.75
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
    notify(error.message || "Action impossible.", "error");
  } finally {
    if (control) {
      control.disabled = false;
      if (originalText && control.tagName === "BUTTON") control.textContent = originalText;
    }
  }
}

function setStatus(message) {
  const element = document.getElementById("syncStatus");
  if (element) element.textContent = message;
}

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
  // Les autres types (info / success / warning) disparaissent apres 3.5s.
  if (type !== "error") {
    setTimeout(() => {
      toast.classList.add("toast-out");
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }
}

function updateRouteProgress() {
  const element = document.getElementById("routeProgress");
  if (!element) return;

  if (activeRoute?.stops?.length) {
    element.textContent = `${activeStopIndex + 1}/${activeRoute.stops.length} - ${formatRouteStatus(activeRoute.status)}`;
    return;
  }

  if (!route.length || currentIndex < 0) {
    element.textContent = "Aucune tournée";
    return;
  }

  element.textContent = `${currentIndex + 1}/${route.length}`;
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
  return `${order.address || ""} ${order.postalCode || ""} ${order.city || ""}`.trim() || "Adresse non renseignée";
}

function formatStopAddress(stop) {
  return `${stop.address || ""} ${stop.postalCode || ""} ${stop.city || ""}`.trim() || "Adresse non renseignée";
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
    commande_client_validee: "Commande client validee",
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

function getStopPill(status) {
  if (status === "livre") return "pill-ok";
  if (["absent", "probleme"].includes(status)) return "pill-danger";
  if (["en_livraison", "a_reprogrammer"].includes(status)) return "pill-warning";
  return "pill-blue";
}

function formatStopStatus(status) {
  const labels = {
    pret_livraison: "Prêt livraison",
    en_livraison: "En livraison",
    livre: "Livré",
    absent: "Absent",
    probleme: "Problème",
    a_reprogrammer: "À reprogrammer"
  };

  return labels[status] || "Prêt livraison";
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

  return `${stops} arrêt(s) · ${distance} · ${duration}`;
}

function formatSectorLabel(value) {
  if (normalizeTextKey(value) === "besancon") return "Besançon";
  if (normalizeTextKey(value) === "dole") return "Dole";
  return value || "Sans secteur";
}

function getMapColor(status) {
  if (["livree", "livre"].includes(status)) return "#2f9e44";
  if (["absent", "probleme", "non_livre", "probleme_livraison"].includes(status)) return "#d9480f";
  if (["en_cours", "en_livraison", "a_reprogrammer"].includes(status)) return "#f08c00";
  return "#2563eb";
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

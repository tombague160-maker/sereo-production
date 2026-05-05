let map;
let clients = [];
let orders = [];
let stock = [];
let stockMovements = [];
let ventes = [];
let historique = [];
let sectors = [];
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
let lastImportSummary = null;
let recommendFilter = "urgent";
let activeThemeId = "sereo";
let activeBrandImage = "/brand/sereo-logo.svg";

const mainTabs = new Set(["journee", "stock", "preparation", "livreur", "recommande", "parametres"]);
const DEFAULT_BRAND_IMAGE = "/brand/sereo-logo.svg";
const MAX_BRAND_IMAGE_SIZE = 2 * 1024 * 1024;

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

const pastelThemes = {
  sereo: {
    id: "sereo",
    name: "Séréo vert & orange",
    hint: "Vert d'eau, orange pastel et teal séréo.",
    swatches: ["#cfe9e1", "#ffc4a3", "#0e6b63"],
    vars: {
      "--color-brand-teal": "#0e6b63",
      "--color-brand-teal-dark": "#0f3d3d",
      "--color-pastel-green": "#cfe9e1",
      "--color-pastel-green-light": "#e8f4ef",
      "--color-pastel-orange": "#ffc4a3",
      "--color-pastel-orange-light": "#fff0e8",
      "--color-pastel-orange-strong": "#f47a5a",
      "--color-background": "#fafaf8",
      "--color-surface-tint": "#f5fbf8",
      "--border": "#d8ebe5",
      "--border-strong": "#a9d2c8",
      "--blue": "#9fd5cc"
    }
  },
  menthe: {
    id: "menthe",
    name: "Menthe & pêche",
    hint: "Plus clair, très doux sur tablette et mobile.",
    swatches: ["#d8f3e8", "#ffd6bd", "#0f6a5f"],
    vars: {
      "--color-brand-teal": "#0f6a5f",
      "--color-brand-teal-dark": "#0d3f3b",
      "--color-pastel-green": "#d8f3e8",
      "--color-pastel-green-light": "#effaf6",
      "--color-pastel-orange": "#ffd6bd",
      "--color-pastel-orange-light": "#fff3eb",
      "--color-pastel-orange-strong": "#ee8a67",
      "--color-background": "#fbfdfa",
      "--color-surface-tint": "#f6fcf9",
      "--border": "#d5ede5",
      "--border-strong": "#a9d9ca",
      "--blue": "#a8dccc"
    }
  },
  lavande: {
    id: "lavande",
    name: "Lavande & pêche",
    hint: "Pastel plus chaleureux, sans perdre le contraste.",
    swatches: ["#ded8f7", "#ffd1b8", "#5d5486"],
    vars: {
      "--color-brand-teal": "#5d5486",
      "--color-brand-teal-dark": "#332d52",
      "--color-pastel-green": "#ded8f7",
      "--color-pastel-green-light": "#f5f2ff",
      "--color-pastel-orange": "#ffd1b8",
      "--color-pastel-orange-light": "#fff2eb",
      "--color-pastel-orange-strong": "#e88465",
      "--color-background": "#fbf9ff",
      "--color-surface-tint": "#f7f5ff",
      "--border": "#dfd8f3",
      "--border-strong": "#beb3e5",
      "--blue": "#c7bff0"
    }
  },
  ciel: {
    id: "ciel",
    name: "Bleu ciel & abricot",
    hint: "Ambiance fraîche, lisible et très lumineuse.",
    swatches: ["#d8eef8", "#ffd8a8", "#246b7a"],
    vars: {
      "--color-brand-teal": "#246b7a",
      "--color-brand-teal-dark": "#173f48",
      "--color-pastel-green": "#d8eef8",
      "--color-pastel-green-light": "#eef9fd",
      "--color-pastel-orange": "#ffd8a8",
      "--color-pastel-orange-light": "#fff4e6",
      "--color-pastel-orange-strong": "#e99452",
      "--color-background": "#fbfdff",
      "--color-surface-tint": "#f4fbfe",
      "--border": "#d2e9f1",
      "--border-strong": "#a8cfda",
      "--blue": "#a8d7e5"
    }
  },
  sauge: {
    id: "sauge",
    name: "Sauge & rose poudré",
    hint: "Très calme, doux et premium.",
    swatches: ["#dcebd7", "#ffd3d8", "#476a57"],
    vars: {
      "--color-brand-teal": "#476a57",
      "--color-brand-teal-dark": "#284034",
      "--color-pastel-green": "#dcebd7",
      "--color-pastel-green-light": "#f3faf1",
      "--color-pastel-orange": "#ffd3d8",
      "--color-pastel-orange-light": "#fff1f3",
      "--color-pastel-orange-strong": "#df7b86",
      "--color-background": "#fbfdf9",
      "--color-surface-tint": "#f6fbf4",
      "--border": "#d9e9d5",
      "--border-strong": "#b8d4b2",
      "--blue": "#bad9c5"
    }
  },
  vanille: {
    id: "vanille",
    name: "Vanille & corail doux",
    hint: "Plus solaire, mais toujours pastel.",
    swatches: ["#f6edc8", "#ffc7b5", "#6c5d24"],
    vars: {
      "--color-brand-teal": "#6c5d24",
      "--color-brand-teal-dark": "#433817",
      "--color-pastel-green": "#f6edc8",
      "--color-pastel-green-light": "#fff9df",
      "--color-pastel-orange": "#ffc7b5",
      "--color-pastel-orange-light": "#fff0ea",
      "--color-pastel-orange-strong": "#e98368",
      "--color-background": "#fffdf5",
      "--color-surface-tint": "#fffaf0",
      "--border": "#efe5bd",
      "--border-strong": "#dccd8f",
      "--blue": "#eadfbc"
    }
  }
};

const titles = {
  journee: {
    title: "Tableau de bord",
    subtitle: "Vue rapide du stock, des préparations et des livraisons."
  },
  import: {
    title: "Import du jour",
    subtitle: "Charge les dossiers et le stock depuis des fichiers .xlsx."
  },
  stock: {
    title: "Stock / Inventaire",
    subtitle: "Ajuste les quantités, contrôle les écarts et repère les produits à surveiller."
  },
  preparation: {
    title: "Préparation",
    subtitle: "Contrôle le stock, prépare les commandes et les envoie en livraison."
  },
  livreur: {
    title: "Livraison",
    subtitle: "Filtre par date et secteur, crée la tournée et suit les clients."
  },
  recommande: {
    title: "À recommander",
    subtitle: "Produits en rupture ou proches de la rupture."
  },
  produits: {
    title: "Produits",
    subtitle: "Catalogue importé depuis le fichier stock."
  },
  ventes: {
    title: "Ventes",
    subtitle: "Détail des lignes importées pour la tournée."
  },
  alertes: {
    title: "Alertes internes",
    subtitle: "Stock, commandes bloquées et livraisons à traiter."
  },
  historique: {
    title: "Historique",
    subtitle: "Journal local des dernières actions."
  },
  parametres: {
    title: "Paramètres",
    subtitle: "Logo, thème, secteurs et base mobile de l'application."
  }
};

document.addEventListener("DOMContentLoaded", () => {
  applyTheme("sereo", { persist: false });
  applyBrandImage(DEFAULT_BRAND_IMAGE);
  bindUi();
  initMap();
  registerServiceWorker();
  showTab(getInitialTab(), { updateHash: false });
  loadAppearance();
  loadData();
});

window.addEventListener("load", () => resetViewportScroll(false), { once: true });

function bindUi() {
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });

  document.getElementById("ventesForm")?.addEventListener("submit", event => {
    event.preventDefault();
    runAction(event.submitter, "Import...", () => importFile("ventes", "ventesFile"));
  });

  document.getElementById("stockForm")?.addEventListener("submit", event => {
    event.preventDefault();
    runAction(event.submitter, "Import...", () => importFile("stock", "stockFile"));
  });

  document.getElementById("stockSearch")?.addEventListener("input", event => {
    stockFilter.query = event.target.value;
    renderStock();
  });

  document.getElementById("stockStatusFilter")?.addEventListener("change", event => {
    stockFilter.status = event.target.value;
    renderStock();
  });

  document.getElementById("stockCategoryFilter")?.addEventListener("change", event => {
    stockFilter.category = event.target.value;
    renderStock();
  });

  document.getElementById("deliveryDate")?.addEventListener("change", event => {
    deliveryFilter.date = event.target.value;
    applyDeliveryFilter();
  });

  document.getElementById("brandImageInput")?.addEventListener("change", event => {
    handleBrandImageImport(event.target);
  });

  document.addEventListener("click", event => {
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

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const action = actionButton.dataset.action;

    if (action === "refresh") runAction(actionButton, "Actualisation...", loadData);
    if (action === "go-tab") showTab(actionButton.dataset.targetTab || "journee");
    if (action === "select-theme") applyTheme(actionButton.dataset.themeId, { notifyUser: true });
    if (action === "reset-theme") applyTheme("sereo", { notifyUser: true });
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
    if (action === "mark-delivered") runAction(actionButton, "Envoi...", () => updateCurrentDeliveryStatus("livre"));
    if (action === "mark-absent") runAction(actionButton, "Envoi...", () => updateCurrentDeliveryStatus("absent"));
    if (action === "mark-problem") runAction(actionButton, "Envoi...", () => updateCurrentDeliveryStatus("probleme"));
    if (action === "mark-reschedule") runAction(actionButton, "Envoi...", () => updateCurrentDeliveryStatus("a_reprogrammer"));
    if (action === "next-client") nextClient();
    if (action === "open-maps") openGoogleMaps();
    if (action === "call-current-client") callCurrentClient();
    if (action === "save-coordinates") runAction(actionButton, "Sauvegarde...", saveCurrentCoordinates);
  });

  document.addEventListener("change", event => {
    const input = event.target.closest("[data-stock-input]");
    if (input) {
      runAction(input, "Sauvegarde...", () => setStock(input.dataset.productId, input.value));
      return;
    }

    const deliveryCheckbox = event.target.closest("[data-delivery-order]");
    if (deliveryCheckbox) {
      setDeliverySelection(deliveryCheckbox.dataset.deliveryOrder, deliveryCheckbox.checked);
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

  document.getElementById(nextTab)?.classList.add("active");

  setText("pageTitle", titles[nextTab].title);
  setText("pageSubtitle", titles[nextTab].subtitle);

  if (updateHash) {
    history.replaceState(null, "", `#${nextTab}`);
  }

  resetViewportScroll(updateHash);

  if (nextTab === "livreur" && map) {
    setTimeout(() => map.invalidateSize(), 150);
  }
}

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

  try {
    const [
      clientsData,
      stockData,
      ventesData,
      historiqueData,
      ordersData,
      sectorsData,
      routesData,
      stockMovementsData,
      dashboardData
    ] = await Promise.all([
      apiFetch("/api/clients"),
      apiFetch("/api/stock"),
      apiFetch("/api/ventes"),
      apiFetch("/api/historique"),
      apiFetch("/api/orders"),
      apiFetch("/api/sectors"),
      apiFetch("/api/routes"),
      apiFetch("/api/stock-movements"),
      apiFetch("/api/dashboard")
    ]);

    clients = clientsData.map(client => ({
      ...client,
      statut: client.statut || "restant"
    }));
    stock = stockData;
    ventes = ventesData;
    historique = historiqueData;
    orders = ordersData;
    sectors = sectorsData;
    deliveryRoutes = routesData;
    stockMovements = stockMovementsData;
    dashboard = dashboardData;

    refreshActiveRoute();
    route = activeRoute ? activeRoute.stops : (currentIndex >= 0 ? route : [...clients]);

    renderAll();
    setStatus("À jour");
  } catch (error) {
    clients = [];
    orders = [];
    stock = [];
    ventes = [];
    historique = [];
    sectors = [];
    deliveryRoutes = [];
    stockMovements = [];
    dashboard = null;
    route = [];
    activeRoute = null;
    renderAll();
    setStatus("Erreur");
    notify(error.message || "Impossible de charger les données", "error");
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
  renderStock();
  renderStockMovements();
  renderPreparation();
  renderRecommande();
  renderProduits();
  renderVentes();
  renderAlertes();
  renderHistorique();
  renderDeliveryFilters();
  renderDeliveryCandidates();
  renderRoute();
  renderClients();
  renderSettings();
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
  const threshold = product.alertThreshold ?? 5;
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
      <button class="button danger compact" type="button" data-product-id="${productId}" data-stock-delta="-5">-5</button>
      <button class="button danger compact" type="button" data-product-id="${productId}" data-stock-delta="-1">-1</button>
      <label class="sr-only" for="stock-${productId}">Quantité ${escapeHtml(getProductName(product))}</label>
      <input id="stock-${productId}" data-stock-input data-product-id="${productId}" type="number" min="0" step="1" value="${escapeAttribute(quantityValue)}">
      <button class="button ok compact" type="button" data-product-id="${productId}" data-stock-delta="1">+1</button>
      <button class="button ok compact" type="button" data-product-id="${productId}" data-stock-delta="5">+5</button>
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

function renderPreparation() {
  renderPreparationStats();

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

  const counts = {
    imported: orders.filter(order => ["importe", "stock_a_verifier"].includes(order.status)).length,
    preparing: orders.filter(order => order.status === "en_preparation").length,
    ready: orders.filter(order => order.status === "pret_livraison").length,
    blocked: orders.filter(order => ["importe", "stock_a_verifier"].includes(order.status) && !order.canPrepare).length
  };

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

function productKey(product) {
  if (!product || typeof product !== "object") return "";
  const code = normalizeTextKey(product.code || product.codeProduit || product.sku || product.reference || "");
  const nom = normalizeTextKey(product.nom || product.Nom || product.produit || product.Produit || product.name || "");
  return code || nom;
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
      const threshold = product.alertThreshold ?? 5;
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
        message: `Stock faible : ${quantity} restant(s).`
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

async function loadAppearance() {
  try {
    const appearance = await apiFetch("/api/settings/appearance");
    applyTheme(appearance.themeId || "sereo", { persist: false });
    applyBrandImage(appearance.brandImage || DEFAULT_BRAND_IMAGE);
  } catch (error) {
    updateBrandImageStatus(false);
    notify(error.message || "Paramètres visuels indisponibles.", "warning");
  }
}

function applyTheme(themeId, options = {}) {
  const { persist = true, notifyUser = false } = options;
  const theme = pastelThemes[themeId] || pastelThemes.sereo;

  activeThemeId = theme.id;
  Object.entries(theme.vars).forEach(([name, value]) => {
    document.documentElement.style.setProperty(name, value);
  });

  if (persist) {
    saveAppearance({ themeId: theme.id })
      .then(() => {
        if (notifyUser) notify(`Palette "${theme.name}" appliquée.`, "success");
      })
      .catch(error => notify(error.message, "error"));
  } else if (notifyUser) {
    notify(`Palette "${theme.name}" appliquée.`, "success");
  }

  renderThemePalettes();
}

function renderThemePalettes() {
  const container = document.getElementById("themePaletteList");
  if (!container) return;

  container.innerHTML = Object.values(pastelThemes).map(theme => {
    const isActive = theme.id === activeThemeId;
    return `
      <button class="theme-card ${isActive ? "active" : ""}" type="button" data-action="select-theme" data-theme-id="${escapeAttribute(theme.id)}" aria-pressed="${isActive ? "true" : "false"}">
        <span class="theme-card-title">${escapeHtml(theme.name)}</span>
        <span class="theme-card-hint">${escapeHtml(theme.hint)}</span>
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
  document.querySelectorAll(".brand-logo, [data-brand-preview]").forEach(image => {
    image.src = imageSrc;
  });
  updateBrandImageStatus(imageSrc !== DEFAULT_BRAND_IMAGE);
}

function updateBrandImageStatus(isCustom = activeBrandImage !== DEFAULT_BRAND_IMAGE) {
  const status = document.getElementById("brandImageStatus");
  if (status) {
    status.textContent = isCustom
      ? "Image personnalisée active pour l'application."
      : "Logo séréo par défaut.";
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

function renderSettings() {
  renderThemePalettes();
  updateBrandImageStatus();

  const sectorsContainer = document.getElementById("settingsSectors");
  if (!sectorsContainer) return;

  const visibleSectors = sectors.length ? sectors : [
    { name: "Besancon", total: 0, ready: 0 },
    { name: "Champagnole", total: 0, ready: 0 },
    { name: "Dole", total: 0, ready: 0 }
  ];

  sectorsContainer.innerHTML = visibleSectors.map(sector => `
    <article class="item status-neutral">
      <div class="item-header">
        <div>
          <h4>${escapeHtml(formatSectorLabel(sector.name))}</h4>
          <p>${escapeHtml(sector.total || 0)} commande(s), ${escapeHtml(sector.ready || 0)} prête(s)</p>
        </div>
        <span class="pill pill-blue">Actif</span>
      </div>
    </article>
  `).join("");
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

  setButtonDisabled("callClientButton", !hasTarget || !buildPhoneUrl(target?.phone || target?.telephone));
  setButtonDisabled("mapsButton", !hasTarget || !buildGoogleMapsUrl(target));
  setButtonDisabled("markDeliveredButton", !canChangeStatus);
  setButtonDisabled("markAbsentButton", !canChangeStatus);
  setButtonDisabled("markProblemButton", !canChangeStatus);
  setButtonDisabled("markRescheduleButton", !canChangeStatus);
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

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
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
  toast.textContent = message;
  region.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 250);
  }, 3500);
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

function emptyState(title, message) {
  return `
    <div class="empty-state">
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value ?? "").replace(/["\\\]]/g, "\\$&");
}

function normalizeTextKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toCoordinate(value, min, max) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;

  return parsed;
}

function getEntityCoordinates(entity) {
  const lat = toCoordinate(entity.lat ?? entity.latitude, -90, 90);
  const lng = toCoordinate(entity.lng ?? entity.longitude, -180, 180);

  if (lat === null || lng === null) return null;

  return { lat, lng };
}

function getProductQuantity(product) {
  const value = product.quantite ?? product.stock ?? product.Stock ?? product.qte;

  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
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

  if (status === "stock_faible" || quantity <= (product.alertThreshold ?? 5)) {
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
    if (!["importe", "stock_a_verifier", "en_preparation"].includes(order.status)) return total;

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

function getAddressParts(entity) {
  return {
    address: entity.address || entity.rue || entity.adresse || entity.Rue || "",
    postalCode: entity.postalCode || entity.codePostal || entity.cp || entity["Code Postal"] || "",
    city: entity.city || entity.ville || entity.Ville || ""
  };
}

function getAddressWarning(entity) {
  const parts = getAddressParts(entity);
  if (!String(parts.address).trim() || !String(parts.city).trim()) return "Adresse incomplète";
  return "";
}

function buildGoogleMapsUrl(entity) {
  const parts = getAddressParts(entity);
  const destination = [parts.address, parts.postalCode, parts.city].filter(Boolean).join(" ").trim();

  if (!parts.address || !parts.city || !destination) return "";

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function normalizePhoneNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const leadingPlus = raw.startsWith("+") ? "+" : "";
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `${leadingPlus}${digits}` : "";
}

function buildPhoneUrl(value) {
  const phone = normalizePhoneNumber(value);
  return phone ? `tel:${phone}` : "";
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
  if (["livre", "pret_livraison"].includes(status)) return "pill-ok";
  if (["en_preparation", "en_livraison", "a_reprogrammer"].includes(status)) return "pill-warning";
  if (status === "probleme_livraison") return "pill-danger";
  return "pill-blue";
}

function formatOrderStatus(status) {
  const labels = {
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/service-worker.js")
    .then(registration => registration.update())
    .catch(() => {});
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

window.Sereo = {
  loadData,
  showTab
};

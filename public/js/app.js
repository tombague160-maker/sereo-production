let currentPage = "dashboard";
let map = null;
let markers = [];
let routeLayer = null;

let clients = [];
let stock = [];
let ventes = [];
let produits = [];

let tournee = [];
let indexTournee = 0;

// Navigation menu
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".menu-item").forEach(button => {
    button.addEventListener("click", () => {
      const page = button.dataset.page;

      document.querySelectorAll(".menu-item").forEach(b => b.classList.remove("active"));
      button.classList.add("active");

      showPage(page);
    });
  });

  showPage("dashboard");
});

async function showPage(page) {
  currentPage = page;

  const main = document.getElementById("main-content");

  if (page === "dashboard") {
    main.innerHTML = `
      <h1>🏠 Ma journée</h1>
      <p>Bienvenue dans Sereo V7.</p>
      <div class="card">
        <h3>Résumé</h3>
        <p>Importe tes fichiers du jour, vérifie le stock, prépare les commandes puis lance le mode livreur.</p>
      </div>
    `;
  }

  if (page === "import") {
    main.innerHTML = `
      <h1>📥 Import du jour</h1>

      <div class="card">
        <h3>Import Tarifs</h3>
        <input type="file" id="file-tarifs" accept=".xlsx,.xls" />
        <button onclick="importTarifs()">Importer Tarifs</button>
      </div>

      <div class="card">
        <h3>Import Articles de facture</h3>
        <input type="file" id="file-articles" accept=".xlsx,.xls" />
        <button onclick="importArticles()">Importer Articles</button>
      </div>

      <p id="import-result"></p>
    `;
  }

  if (page === "stock") {
    await loadStock();
    main.innerHTML = `
      <h1>📦 Stock</h1>
      <div class="grid">
        ${stock.map(item => `
          <div class="card">
            <h3>${item.nom || item.name || "Produit"}</h3>
            <p>Code : ${item.code || item.id || ""}</p>
            <p>Stock : <strong>${item.quantite ?? item.stock ?? 0}</strong></p>
            <div>
              <button onclick="modifierStock('${item.id || item.code}', -5)">-5</button>
              <button onclick="modifierStock('${item.id || item.code}', -1)">-1</button>
              <button onclick="modifierStock('${item.id || item.code}', 1)">+1</button>
              <button onclick="modifierStock('${item.id || item.code}', 5)">+5</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  if (page === "preparation") {
    await loadVentes();
    main.innerHTML = `
      <h1>🧾 Préparation</h1>
      <div class="card">
        ${ventes.length === 0 ? "<p>Aucune vente importée.</p>" : ventes.map(v => `
          <p>
            <strong>${v.nom || v.produit || "Produit"}</strong>
            — ${v.client || "Client"}
            — Qté : ${v.quantite || 0}
          </p>
        `).join("")}
      </div>
    `;
  }

  if (page === "livraison") {
    main.innerHTML = `
      <h1>🚚 Mode livreur</h1>
      <p>Carte des clients à livrer et suivi de tournée.</p>

      <div class="card">
        <button onclick="calculerTournee()">🚀 Calculer tournée optimale</button>
      </div>

      <div class="card">
        <div id="map" style="height: 450px;"></div>
      </div>

      <div class="card" id="mode-livreur-panel">
        <h2>🚚 Client en cours</h2>
        <p id="livreur-client-nom">Aucune tournée lancée.</p>
        <p id="livreur-client-adresse"></p>
        <p id="livreur-client-progression"></p>

        <div class="mode-livreur-actions">
          <button onclick="validerClientLivreur('Livrée')">✅ Livrée</button>
          <button onclick="validerClientLivreur('Absent')">❌ Absent</button>
          <button onclick="clientSuivantLivreur()">⏭️ Suivant</button>
        </div>
      </div>
    `;

    await initLivraison();
  }

  if (page === "reco") {
    await loadStock();
    main.innerHTML = `
      <h1>🛒 À recommander</h1>
      <div class="grid">
        ${stock
          .filter(item => Number(item.quantite ?? item.stock ?? 0) <= 5)
          .map(item => `
            <div class="card">
              <h3>${item.nom || item.name || "Produit"}</h3>
              <p>Stock faible : ${item.quantite ?? item.stock ?? 0}</p>
            </div>
          `).join("") || "<p>Aucun produit critique.</p>"}
      </div>
    `;
  }

  if (page === "produits") {
    await loadProduits();
    main.innerHTML = `
      <h1>🧾 Produits</h1>
      <div class="grid">
        ${produits.map(p => `
          <div class="card">
            <h3>${p.nom || p.name || "Produit"}</h3>
            <p>Code : ${p.code || ""}</p>
            <p>Tarif : ${p.tarif || p.prix || ""}</p>
          </div>
        `).join("") || "<p>Aucun produit.</p>"}
      </div>
    `;
  }

  if (page === "ventes") {
    await loadVentes();
    main.innerHTML = `
      <h1>📊 Ventes</h1>
      <div class="card">
        ${ventes.map(v => `
          <p>
            <strong>${v.client || "Client"}</strong>
            — ${v.nom || v.produit || "Produit"}
            — Qté : ${v.quantite || 0}
          </p>
        `).join("") || "<p>Aucune vente.</p>"}
      </div>
    `;
  }

  if (page === "alertes") {
    await loadStock();
    main.innerHTML = `
      <h1>⚠️ Alertes</h1>
      <div class="grid">
        ${stock
          .filter(item => Number(item.quantite ?? item.stock ?? 0) <= 5)
          .map(item => `
            <div class="card">
              <h3>${item.nom || item.name || "Produit"}</h3>
              <p>Stock : ${item.quantite ?? item.stock ?? 0}</p>
            </div>
          `).join("") || "<p>Aucune alerte.</p>"}
      </div>
    `;
  }

  if (page === "historique") {
    main.innerHTML = `
      <h1>🗂️ Historique</h1>
      <div class="card">
        <p>Historique prévu pour une prochaine évolution.</p>
      </div>
    `;
  }
}

// Chargements API
async function loadClients() {
  try {
    const res = await fetch("/api/clients");
    clients = await res.json();
  } catch (err) {
    console.error("Erreur clients", err);
    clients = [];
  }
}

async function loadStock() {
  try {
    const res = await fetch("/api/stock");
    stock = await res.json();
  } catch (err) {
    console.error("Erreur stock", err);
    stock = [];
  }
}

async function loadVentes() {
  try {
    const res = await fetch("/api/ventes");
    ventes = await res.json();
  } catch (err) {
    console.error("Erreur ventes", err);
    ventes = [];
  }
}

async function loadProduits() {
  try {
    const res = await fetch("/api/produits");
    produits = await res.json();
  } catch (err) {
    console.error("Erreur produits", err);
    produits = [];
  }
}

// Imports
async function importTarifs() {
  const input = document.getElementById("file-tarifs");
  const result = document.getElementById("import-result");

  if (!input.files.length) {
    result.textContent = "Sélectionne un fichier Tarifs.";
    return;
  }

  const formData = new FormData();
  formData.append("file", input.files[0]);

  const res = await fetch("/api/import/tarifs", {
    method: "POST",
    body: formData
  });

  const data = await res.json();
  result.textContent = data.message || "Import Tarifs terminé.";
}

async function importArticles() {
  const input = document.getElementById("file-articles");
  const result = document.getElementById("import-result");

  if (!input.files.length) {
    result.textContent = "Sélectionne un fichier Articles.";
    return;
  }

  const formData = new FormData();
  formData.append("file", input.files[0]);

  const res = await fetch("/api/import/articles", {
    method: "POST",
    body: formData
  });

  const data = await res.json();
  result.textContent = data.message || "Import Articles terminé.";
}

// Stock
async function modifierStock(id, delta) {
  await fetch(`/api/stock/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ delta })
  });

  showPage("stock");
}

// Livraison / Mode livreur
async function initLivraison() {
  await loadClients();

  setTimeout(() => {
    initMap();
  }, 100);
}

function initMap() {
  if (map) {
    map.remove();
    map = null;
  }

  map = L.map("map").setView([46.7, 5.8], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
  }).addTo(map);

  markers = [];

  const clientsAvecCoords = clients.filter(c => c.latitude && c.longitude);

  clientsAvecCoords.forEach(client => {
    const marker = L.marker([client.latitude, client.longitude]).addTo(map);
    marker.bindPopup(`
      <strong>${client.nom || client.client || "Client"}</strong><br>
      ${client.adresse || ""}
    `);
    markers.push(marker);
  });

  if (clientsAvecCoords.length > 0) {
    const group = L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.2));
  }
}

function calculerTournee() {
  const clientsAvecCoords = clients.filter(c =>
    c.latitude &&
    c.longitude &&
    c.statut !== "Livrée"
  );

  if (clientsAvecCoords.length === 0) {
    alert("Aucun client avec coordonnées à livrer.");
    return;
  }

  // V1 simple : on garde l'ordre actuel des clients.
  // Ensuite on branchera ici l'ordre optimisé OSRM.
  tournee = clientsAvecCoords;
  indexTournee = 0;

  afficherClientLivreur();
  tracerTourneeSimple();
}

function afficherClientLivreur() {
  const nom = document.getElementById("livreur-client-nom");
  const adresse = document.getElementById("livreur-client-adresse");
  const progression = document.getElementById("livreur-client-progression");

  if (!nom) return;

  if (!tournee.length) {
    nom.textContent = "Aucune tournée lancée.";
    adresse.textContent = "";
    progression.textContent = "";
    return;
  }

  const client = tournee[indexTournee];

  if (!client) {
    nom.textContent = "Tournée terminée ✅";
    adresse.textContent = "";
    progression.textContent = "";
    return;
  }

  nom.innerHTML = `<strong>${client.nom || client.client || "Client"}</strong>`;
  adresse.innerHTML = `
    ${client.adresse || "Adresse non renseignée"}<br>
    <a target="_blank" href="https://www.google.com/maps?q=${client.latitude},${client.longitude}">
      📍 Ouvrir GPS
    </a>
  `;
  progression.textContent = `${indexTournee + 1} / ${tournee.length}`;
}

async function validerClientLivreur(statut) {
  const client = tournee[indexTournee];

  if (!client) return;

  await fetch(`/api/clients/${client.id}/status`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ statut })
  });

  client.statut = statut;
  clientSuivantLivreur();
}

function clientSuivantLivreur() {
  indexTournee++;
  afficherClientLivreur();
}

function tracerTourneeSimple() {
  if (!map || !tournee.length) return;

  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  const points = tournee.map(c => [c.latitude, c.longitude]);

  routeLayer = L.polyline(points, {
    weight: 4
  }).addTo(map);

  map.fitBounds(routeLayer.getBounds().pad(0.2));
}
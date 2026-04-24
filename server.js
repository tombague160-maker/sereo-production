const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const XLSX = require("xlsx");

const app = express();
const PORT = 3000;

const dataDir = path.join(__dirname, "data");
const dbFile = path.join(dataDir, "db.json");
const importsDir = path.join(__dirname, "imports");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(importsDir)) fs.mkdirSync(importsDir, { recursive: true });

function createDefaultDb() {
  return {
    clients: [
      {
        id: 1,
        nom: "Dupont",
        ville: "Champagnole",
        adresse: "10 rue de la Gare",
        statut: "Validée",
        lat: 46.7448,
        lon: 5.913
      },
      {
        id: 2,
        nom: "Martin",
        ville: "Poligny",
        adresse: "5 place des Déportés",
        statut: "Validée",
        lat: 46.837,
        lon: 5.7097
      },
      {
        id: 3,
        nom: "Bernard",
        ville: "Lons-le-Saunier",
        adresse: "18 avenue Thurel",
        statut: "Validée",
        lat: 46.6753,
        lon: 5.5557
      }
    ],
    stock: [
      {
        id: 1,
        code: "P001",
        produit: "Alèse",
        stock: 12,
        minimum: 5,
        tarif: 0,
        cout: 0,
        type: "",
        actif: true
      },
      {
        id: 2,
        code: "P002",
        produit: "Déambulateur",
        stock: 4,
        minimum: 3,
        tarif: 0,
        cout: 0,
        type: "",
        actif: true
      },
      {
        id: 3,
        code: "P003",
        produit: "Fauteuil roulant",
        stock: 1,
        minimum: 2,
        tarif: 0,
        cout: 0,
        type: "",
        actif: true
      }
    ],
    ventes: [],
    produits: [],
    imports: {
      tarifs: null,
      articles: null
    }
  };
}

function loadDb() {
  if (!fs.existsSync(dbFile)) {
    const initialDb = createDefaultDb();
    fs.writeFileSync(dbFile, JSON.stringify(initialDb, null, 2), "utf8");
    return initialDb;
  }

  const raw = fs.readFileSync(dbFile, "utf8");

  if (!raw.trim()) {
    const initialDb = createDefaultDb();
    fs.writeFileSync(dbFile, JSON.stringify(initialDb, null, 2), "utf8");
    return initialDb;
  }

  const db = JSON.parse(raw);

  if (!db.clients) db.clients = [];
  if (!db.stock) db.stock = [];
  if (!db.ventes) db.ventes = [];
  if (!db.produits) db.produits = [];
  if (!db.imports) db.imports = { tarifs: null, articles: null };

  return db;
}

function saveDb(db) {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), "utf8");
}

function normalizeString(value) {
  return String(value || "").trim();
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ dest: importsDir });

app.get("/api/clients", (req, res) => {
  try {
    const db = loadDb();
    res.json(db.clients || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/stock", (req, res) => {
  try {
    const db = loadDb();
    res.json(db.stock || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/ventes", (req, res) => {
  try {
    const db = loadDb();
    res.json(db.ventes || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/imports/status", (req, res) => {
  try {
    const db = loadDb();
    res.json(db.imports || { tarifs: null, articles: null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/clients/:id/status", (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const { statut } = req.body;

    const db = loadDb();
    const client = db.clients.find((c) => c.id === clientId);

    if (!client) {
      return res.status(404).json({ error: "Client introuvable" });
    }

    client.statut = statut || client.statut;
    saveDb(db);

    res.json({ ok: true, client });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/stock/:id", (req, res) => {
  try {
    const stockId = Number(req.params.id);
    const { delta } = req.body;

    const db = loadDb();
    const item = db.stock.find((s) => s.id === stockId);

    if (!item) {
      return res.status(404).json({ error: "Produit introuvable" });
    }

    item.stock = Math.max(0, Number(item.stock || 0) + Number(delta || 0));
    saveDb(db);

    res.json({ ok: true, item });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/import/tarifs", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier reçu." });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", range: 2 });

    const db = loadDb();

    const produits = rows.map((row, index) => {
      const code = normalizeString(row["Code"]);
      const produit = normalizeString(row["Nom"]);
      const cout = toNumber(row["Coût"]);
      const tarif = toNumber(row["Tarif"]);
      const type = normalizeString(row["Type"]);
      const statut = normalizeString(row["Statut"]);

      return {
        id: index + 1,
        code: code || `ART-${index + 1}`,
        produit: produit || code || `Produit ${index + 1}`,
        cout,
        tarif,
        type,
        actif: statut.toLowerCase() !== "inactif",
        stock: 0,
        minimum: 0
      };
    }).filter(item => item.produit);

    db.produits = produits;
    db.stock = produits.map((item, index) => ({
      id: index + 1,
      code: item.code,
      produit: item.produit,
      stock: 0,
      minimum: 0,
      tarif: item.tarif,
      cout: item.cout,
      type: item.type,
      actif: item.actif
    }));

    db.imports.tarifs = {
      importedAt: new Date().toISOString(),
      count: produits.length,
      filename: req.file.originalname
    };

    saveDb(db);
    fs.unlinkSync(req.file.path);

    res.json({
      ok: true,
      imported: produits.length,
      type: "tarifs"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/import/articles", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier reçu." });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", range: 2 });

    const db = loadDb();
    let nextClientId = db.clients.length ? Math.max(...db.clients.map((c) => c.id)) + 1 : 1;

    const clientsMap = new Map(
      db.clients.map((client) => [
        `${normalizeString(client.nom)}|${normalizeString(client.ville)}|${normalizeString(client.adresse)}`,
        client
      ])
    );

    const ventes = rows.map((row, index) => {
      const nom = normalizeString(row["Client"]);
      const statut = normalizeString(row["Statut"]) || "Validée";
      const produit = normalizeString(row["Nom"]);
      const code = normalizeString(row["Code"]);
      const date = normalizeString(row["Date"]);
      const quantite = toNumber(row["Quantité"]);

      const clientKey = `${nom}||`;

      if (nom && !clientsMap.has(clientKey)) {
        clientsMap.set(clientKey, {
          id: nextClientId++,
          nom,
          ville: "",
          adresse: "",
          statut,
          lat: 0,
          lon: 0
        });
      }

      return {
        id: index + 1,
        code,
        nomClient: nom,
        produit,
        statut,
        date,
        quantite
      };
    }).filter(item => item.nomClient || item.produit);

    db.clients = Array.from(clientsMap.values());
    db.ventes = ventes;
    db.imports.articles = {
      importedAt: new Date().toISOString(),
      count: ventes.length,
      filename: req.file.originalname
    };

    saveDb(db);
    fs.unlinkSync(req.file.path);

    res.json({
      ok: true,
      imported: ventes.length,
      type: "articles"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/route", async (req, res) => {
  const coords = req.query.coords;
  const url = `http://router.project-osrm.org/trip/v1/driving/${coords}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Sereo V7 Clean lancé sur http://localhost:${PORT}`);
});
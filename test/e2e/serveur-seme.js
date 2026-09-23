// Un serveur Séréo isolé, semé de données fictives, pour mesurer ce qui ne se
// dessine pas à vide : les lignes de liste, les marqueurs de carte, le tracé.
//
// Rien n'est écrit dans l'application réelle : base SQLite dans un dossier
// temporaire, routage simulé en local, aucun accès réseau sortant.
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

const AUJOURDHUI = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

/** Six clients autour de Besançon, tous géolocalisés. */
const CLIENTS = [
  { id: "c-tilleuls", nom: "EHPAD Les Tilleuls du Val de Loue", rue: "12 avenue du Général de Gaulle", ville: "Besançon", codePostal: "25000", lat: 47.238, lng: 6.024 },
  { id: "c-pharma", nom: "Pharmacie Centrale de la Gare", rue: "3 rue de la Gare", ville: "Champagnole", codePostal: "39300", lat: 46.745, lng: 5.910 },
  { id: "c-bellevue", nom: "EHPAD Résidence Bellevue", rue: "8 chemin des Vignes", ville: "Dole", codePostal: "39100", lat: 47.092, lng: 5.490 },
  { id: "c-ssiad", nom: "SSIAD de la Haute Vallée", rue: "22 rue Neuve", ville: "Champagnole", codePostal: "39300", lat: 46.750, lng: 5.905 },
  { id: "c-veto", nom: "Clinique Vétérinaire du Doubs", rue: "1 place du Marché", ville: "Besançon", codePostal: "25000", lat: 47.245, lng: 6.030 },
  { id: "c-dupont", nom: "Cabinet Infirmier Dupont-Lefebvre", rue: "5 rue des Lilas", ville: "Besançon", codePostal: "25000", lat: 47.230, lng: 6.015 }
].map(c => ({ ...c, crmStatus: "client_actif" }));

const PRODUITS = [
  { code: "CH-L", nom: "Changes taille L", prixUnitaire: 12 },
  { code: "ALE", nom: "Alèses", prixUnitaire: 5 }
];

function commande(id, client, status, extra = {}) {
  return {
    id, clientId: client.id, clientName: client.nom, status,
    address: client.rue, city: client.ville, postalCode: client.codePostal,
    lat: client.lat, lng: client.lng, deliveryDate: AUJOURDHUI, dateCommande: AUJOURDHUI,
    products: PRODUITS.map(p => ({ ...p, quantite: 3 })),
    ...extra
  };
}

/** Une tournée EN COURS : deux arrêts livrés, un en cours, un en problème, deux à venir. */
function jeuDeDonnees() {
  const [tilleuls, pharma, bellevue, ssiad, veto, dupont] = CLIENTS;
  const commandes = [
    commande("o-1", bellevue, "livre", { deliveredAt: `${AUJOURDHUI}T09:10:00Z` }),
    commande("o-2", ssiad, "livre", { deliveredAt: `${AUJOURDHUI}T09:40:00Z` }),
    commande("o-3", tilleuls, "en_livraison"),
    commande("o-4", veto, "en_livraison"),
    commande("o-5", pharma, "en_livraison"),
    commande("o-6", dupont, "en_livraison"),
    // Pour la vue de préparation : les quatre états d'une commande à préparer.
    commande("o-7", pharma, "en_preparation"),
    commande("o-8", bellevue, "pret_livraison"),
    // Bloquee : un produit dont le stock est a zero. Le serveur recalcule
    // canPrepare depuis le stock -- un drapeau seme serait ecrase.
    commande("o-9", veto, "importe", { products: [...PRODUITS.map(p => ({ ...p, quantite: 3 })), { code: "GANTS", nom: "Gants nitrile", prixUnitaire: 8, quantite: 5 }] }),
    commande("o-10", dupont, "importe")
  ];
  const arret = (o, status, extra = {}) => ({
    id: `s-${o.id}`, orderId: o.id, clientId: o.clientId, clientName: o.clientName,
    address: o.address, city: o.city, postalCode: o.postalCode, lat: o.lat, lng: o.lng,
    status, products: o.products, ...extra
  });
  return {
    clients: CLIENTS,
    stock: [...PRODUITS.map(p => ({ id: `st-${p.code}`, code: p.code, nom: p.nom, quantite: 100, tarif: p.prixUnitaire })),
      { id: "st-GANTS", code: "GANTS", nom: "Gants nitrile", quantite: 0, tarif: 8 }],
    commandes,
    routes: [{
      id: "r-1", status: "en_livraison", deliveryDate: AUJOURDHUI, name: "Tournée Besançon",
      stops: [
        arret(commandes[0], "livre"),
        arret(commandes[1], "livre"),
        arret(commandes[2], "en_livraison"),
        arret(commandes[3], "probleme", { problemReason: "Adresse introuvable" }),
        arret(commandes[4], "pret_livraison"),
        arret(commandes[5], "pret_livraison")
      ]
    }],
    // Trois abonnements, un par etat. La forme est celle que lib/operations-api.js ecrit.
    subscriptions: [
      { id: "sub-1", clientId: tilleuls.id, status: "active", startDate: AUJOURDHUI, frequency: { unit: "days", interval: 14 }, reminderDays: 2, notes: "",
        products: [{ stockId: "st-CH-L", code: "CH-L", nom: "Changes taille L", quantite: 4, prixUnitaire: 12, totalLigne: 48 }] },
      { id: "sub-2", clientId: bellevue.id, status: "paused", startDate: AUJOURDHUI, frequency: { unit: "months", interval: 1 }, reminderDays: 3, notes: "",
        products: [{ stockId: "st-ALE", code: "ALE", nom: "Alèses", quantite: 10, prixUnitaire: 5, totalLigne: 50 }] },
      { id: "sub-3", clientId: pharma.id, status: "stopped", startDate: AUJOURDHUI, frequency: { unit: "days", interval: 7 }, reminderDays: 1, notes: "",
        products: [{ stockId: "st-CH-L", code: "CH-L", nom: "Changes taille L", quantite: 2, prixUnitaire: 12, totalLigne: 24 }] }
    ]
  };
}

/** Routage simulé : une matrice de durées et une géométrie plausible. */
function demarrerRoutage() {
  const n = CLIENTS.length;
  const durations = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 600 + 60 * Math.abs(i - j))));
  const server = require("node:http").createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url.includes("/table/")
      ? { code: "Ok", durations }
      : { code: "Ok", routes: [{ distance: 18000, duration: 2820, geometry: { type: "LineString", coordinates: CLIENTS.map(c => [c.lng, c.lat]) } }] }));
  });
  server.listen(0, "127.0.0.1");
  return require("node:events").once(server, "listening").then(() => ({ server, url: `http://127.0.0.1:${server.address().port}` }));
}

/**
 * Démarre un serveur semé sur `port`. Rend `{ base, arreter }`.
 * Le port doit être distinct de ceux de playwright.config.js (3100, 3101) et
 * des autres bancs à serveur propre (operations.spec.js : 3118).
 */
async function demarrer({ port, seed = jeuDeDonnees(), env = {} }) {
  const routage = await demarrerRoutage();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-seme-"));
  fs.writeFileSync(path.join(root, "seed.json"), JSON.stringify(seed));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, "../.."),
    env: {
      ...process.env,
      PORT: String(port), SEREO_HOST: "127.0.0.1", SEREO_ROUTING_URL: routage.url,
      SEREO_AUTH_USER: "", SEREO_AUTH_PASSWORD: "",
      SEREO_STORAGE: "sqlite", SEREO_SQLITE_PATH: path.join(root, "db.sqlite"),
      SEREO_DB_PATH: path.join(root, "seed.json"),
      SEREO_UPLOAD_DIR: path.join(root, "uploads"), SEREO_BACKUP_DIR: path.join(root, "backups"),
      SEREO_SKIP_RELEASE_FETCH: "1",
      // Lot 3 (audit geo) : un client cree ou modifie est geocode en fond.
      // Aucun banc n'appelle la vraie BAN : coupe par defaut, et un banc qui
      // en a besoin passe son faux geocodeur (SEREO_GEOCODER_URL) dans `env`.
      SEREO_GEOCODAGE_AUTO: "0",
      ...env
    },
    stdio: "ignore"
  });
  const base = `http://127.0.0.1:${port}`;
  const limite = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(base + "/healthz")).status === 200) break; } catch { /* pas encore levé */ }
    if (Date.now() > limite) throw new Error(`serveur semé injoignable sur ${base}`);
    await new Promise(r => setTimeout(r, 200));
  }
  return {
    base,
    async arreter() {
      child.kill();
      await new Promise(r => child.once("exit", r));
      // close() attend la fin des connexions keep-alive : on les coupe d'abord.
      routage.server.closeAllConnections();
      await new Promise(r => routage.server.close(r));
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

module.exports = { demarrer, jeuDeDonnees, CLIENTS, AUJOURDHUI };

// Un serveur Séréo isolé, semé de données fictives, pour mesurer ce qui ne se
// dessine pas à vide : les lignes de liste, les marqueurs de carte, le tracé.
//
// Rien n'est écrit dans l'application réelle : base SQLite dans un dossier
// temporaire, routage simulé en local, aucun accès réseau sortant.
const { spawn } = require("node:child_process");
const net = require("node:net");
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
].map(c => Object.freeze({ ...c, crmStatus: "client_actif" }));
// GELES (integration des lots, 23/09). jeuDeDonnees() rendait CE tableau comme
// `clients` du seme : un banc qui y ajoutait ses clients (adresses-a-verifier,
// clients : `seed.clients.push(...)`) l'allongeait pour tous les bancs lances
// ensuite dans le MEME processus d'ouvrier Playwright. Le routage simule, qui
// dimensionne sa table sur CLIENTS.length, rendait alors 8 x 8 a une tournee
// de 6 points : « Impossible de calculer le trajet routier. » -- le rouge de
// meilleur-trajet.spec.js:45, seulement en suite complete, selon l'ouvrier.
// Chaque seme recoit desormais sa COPIE ; le modele ne bouge plus.
Object.freeze(CLIENTS);

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
    clients: CLIENTS.map(c => ({ ...c })),
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

/** Vrai si rien n'ecoute sur 127.0.0.1:`port` (on s'y lie, puis on le rend). */
function portLibre(port) {
  return new Promise(resolve => {
    const essai = net.createServer();
    essai.once("error", () => resolve(false));
    essai.listen(port, "127.0.0.1", () => essai.close(() => resolve(true)));
  });
}

/**
 * Routage simulé : une matrice de durées et une géométrie plausible.
 * `adaptatif` (lot 6) : la table et le tracé suivent les points de la
 * requête -- une durée par distance, un tronçon par trajet (`legs`) -- pour
 * juger les heures d'arrivée et les réordonnancements. Le mode par défaut ne
 * change pas : les bancs d'avant restent sur leur table fixe.
 */
function demarrerRoutage({ adaptatif = false } = {}) {
  const n = CLIENTS.length;
  const durations = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 600 + 60 * Math.abs(i - j))));
  const server = require("node:http").createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (adaptatif) {
      const xy = req.url.split("/driving/")[1].split("?")[0].split(";").map(p => p.split(",").map(Number));
      // ~100 km par degre ; 60 km/h de moyenne : 1 m = 0,06 s.
      const m = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 100000);
      const legs = xy.slice(1).map((b, i) => ({ distance: m(xy[i], b), duration: Math.round(m(xy[i], b) * 0.06) }));
      res.end(JSON.stringify(req.url.includes("/table/")
        ? { code: "Ok", durations: xy.map(a => xy.map(b => Math.round(m(a, b) * 0.06))) }
        : { code: "Ok", routes: [{ distance: legs.reduce((s, l) => s + l.distance, 0), duration: legs.reduce((s, l) => s + l.duration, 0), geometry: { type: "LineString", coordinates: xy }, legs }] }));
      return;
    }
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
async function demarrer({ port, volume = "", seed = volume === "production" ? require("./jeu-production.js").jeuProduction() : jeuDeDonnees(), env = {}, routageAdaptatif = false }) {
  // `volume: "production"` (24/09) : un jeu de la MEME FORME que la production
  // (97 clients, 224 commandes, 218 produits, 1 036 entrees d'historique...),
  // invente et deterministe -- voir jeu-production.js. Pour mesurer ce qui ne
  // coute qu'a ce volume : le rendu de l'ouverture, le Stock, les recherches.
  // Le port doit etre LIBRE avant le lancement (integration des lots 1 a 7,
  // 23/09). Sinon le serveur seme meurt aussitot (EADDRINUSE, sortie ignoree)
  // et la boucle d'attente ci-dessous recevait le 200 de /healthz... d'un
  // AUTRE serveur : le banc parlait a une base semee d'autres donnees, et
  // rougissait sur l'ecran (« Expected: 4, Received: 1 » dans
  // meilleur-trajet.spec.js:45, reproduit en occupant 3198). Les ports sont
  // uniques dans CE depot (test/ports-e2e.test.js), pas entre les worktrees
  // qui lancent les memes bancs en meme temps.
  if (!(await portLibre(port))) {
    throw new Error(`port ${port} deja pris par un autre processus : le banc parlerait a un serveur qui n'est pas le sien`);
  }
  const routage = await demarrerRoutage({ adaptatif: routageAdaptatif });
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
  // Un serveur qui s'arrete pendant l'attente n'a pas pu repondre : ce qui
  // repond sur le port est un autre (pris entre le controle et le lancement).
  // Reste ouvert : un autre processus qui prend le port dans les quelques
  // millisecondes entre portLibre et le lancement, et repond avant que le
  // notre ne meure -- /healthz ne dit pas QUI repond.
  let sortie = null;
  child.once("exit", code => { sortie = code; });
  const base = `http://127.0.0.1:${port}`;
  const limite = Date.now() + 20000;
  const arreterRoutage = async () => {
    routage.server.closeAllConnections();
    await new Promise(r => routage.server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  };
  for (;;) {
    if (sortie !== null) {
      await arreterRoutage();
      throw new Error(`serveur semé sur ${port} arrêté au démarrage (code ${sortie}) : port pris ?`);
    }
    try { if ((await fetch(base + "/healthz")).status === 200 && sortie === null) break; } catch { /* pas encore levé */ }
    if (Date.now() > limite) throw new Error(`serveur semé injoignable sur ${base}`);
    await new Promise(r => setTimeout(r, 200));
  }
  return {
    base,
    async arreter() {
      // Deja arrete : « exit » ne viendrait plus, l'attente pendait (afterAll).
      if (sortie === null) {
        const fin = new Promise(r => child.once("exit", r));
        child.kill();
        await fin;
      }
      // close() attend la fin des connexions keep-alive : on les coupe d'abord.
      routage.server.closeAllConnections();
      await new Promise(r => routage.server.close(r));
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

module.exports = { demarrer, jeuDeDonnees, CLIENTS, AUJOURDHUI };

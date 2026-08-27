// Geocodage des adresses — V8 phase 2.
//
// Le projet n'embarque aucune bibliotheque de simulation reseau (ni Jest, ni
// Sinon) : on monte donc un vrai serveur HTTP local qui imite la Base Adresse
// Nationale, et on pointe SEREO_GEOCODER_URL dessus. Le port est fixe, car les
// variables d'environnement sont lues au chargement du module serveur, avant
// que le faux serveur ait pu annoncer un port attribue dynamiquement.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT_FAUX_GEOCODEUR = 3391;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-geo-"));

process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_GEOCODER_URL = `http://127.0.0.1:${PORT_FAUX_GEOCODEUR}/search/`;
// Pas d'attente entre les appels : les tests n'ont pas a etre polis.
process.env.SEREO_GEOCODER_INTERVALLE_MS = "0";
process.env.SEREO_GEOCODER_TIMEOUT_MS = "1500";

const {
  closeStorage,
  readDb,
  writeDb,
  defaultDb,
  cleGeocodage,
  adresseGeocodable,
  qualifierResultat,
  geocoderAdresse,
  geocoderClients,
  etatGeocodage,
  premiereCoordonnee,
  GEOCODAGE_STATUTS
} = require("../server");

// --- Faux geocodeur ---------------------------------------------------------

/** Scenario courant : modifie par chaque test avant d'appeler le geocodeur. */
let scenario = {
  mode: "trouve",
  score: 0.96,
  type: "housenumber",
  delaiMs: 0
};

let requetesRecues = [];
let fauxGeocodeur;

function reponsePourScenario() {
  if (scenario.mode === "vide") return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [5.9806, 47.2378] },
        properties: {
          label: "12 Avenue du General de Gaulle 25000 Besancon",
          score: scenario.score,
          type: scenario.type
        }
      }
    ]
  };
}

before(async () => {
  fauxGeocodeur = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT_FAUX_GEOCODEUR}`);
    requetesRecues.push({
      q: url.searchParams.get("q"),
      postcode: url.searchParams.get("postcode"),
      limit: url.searchParams.get("limit")
    });

    const repondre = () => {
      if (scenario.mode === "http500") {
        res.writeHead(500).end("erreur serveur");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reponsePourScenario()));
    };

    if (scenario.delaiMs > 0) setTimeout(repondre, scenario.delaiMs);
    else repondre();
  });

  fauxGeocodeur.listen(PORT_FAUX_GEOCODEUR);
  await once(fauxGeocodeur, "listening");
});

after(async () => {
  await new Promise(resolve => fauxGeocodeur.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function reinitialiser(clients = []) {
  scenario = { mode: "trouve", score: 0.96, type: "housenumber", delaiMs: 0 };
  requetesRecues = [];
  const db = defaultDb();
  db.clients = clients;
  writeDb(db);
}

function client(id, rue, codePostal, ville, extra = {}) {
  return { id, nom: `Client ${id}`, rue, codePostal, ville, lat: "", lng: "", ...extra };
}

// --- premiereCoordonnee : le bug corrige ------------------------------------

test("geocodage — premiereCoordonnee traite la chaine vide comme absente", () => {
  // C'est tout le sujet du correctif : `a ?? b` ne se declenche PAS sur "",
  // or une coordonnee absente vaut "" partout dans le projet, jamais null.
  assert.equal(premiereCoordonnee("", 47.2), 47.2);
  assert.equal(premiereCoordonnee(null, 47.2), 47.2);
  assert.equal(premiereCoordonnee(undefined, 47.2), 47.2);
  assert.equal(premiereCoordonnee("", "", ""), "");
});

test("geocodage — premiereCoordonnee preserve la valeur zero", () => {
  // Le meridien de Greenwich et l'equateur sont des coordonnees valides : un
  // test de veracite les aurait ecartees.
  assert.equal(premiereCoordonnee(0, 47.2), 0);
  assert.equal(premiereCoordonnee("", 0), 0);
});

// --- Cle de cache -----------------------------------------------------------

test("geocodage — la cle ignore casse, accents et espaces superflus", () => {
  const a = cleGeocodage({ rue: "12 Avenue du Général", codePostal: "25000", ville: "Besançon" });
  const b = cleGeocodage({ rue: "12  avenue du general", codePostal: "25000", ville: "BESANCON" });
  assert.equal(a, b);
});

test("geocodage — deux adresses differentes ont des cles differentes", () => {
  const a = cleGeocodage({ rue: "12 rue A", codePostal: "25000", ville: "Besancon" });
  const b = cleGeocodage({ rue: "13 rue A", codePostal: "25000", ville: "Besancon" });
  assert.notEqual(a, b);
});

test("geocodage — une adresse sans rue n'est pas geocodable", () => {
  assert.equal(adresseGeocodable({ rue: "", codePostal: "25000", ville: "Besancon" }), false);
  // Sans code postal NI ville, la BAN ne peut pas desambiguiser une rue.
  assert.equal(adresseGeocodable({ rue: "12 rue A", codePostal: "", ville: "" }), false);
  assert.equal(adresseGeocodable({ rue: "12 rue A", codePostal: "25000", ville: "" }), true);
  assert.equal(adresseGeocodable({ rue: "12 rue A", codePostal: "", ville: "Besancon" }), true);
});

// --- Qualification des resultats --------------------------------------------

test("geocodage — un numero de rue bien score est trouve", () => {
  assert.equal(qualifierResultat(0.96, "housenumber"), GEOCODAGE_STATUTS.TROUVE);
  assert.equal(qualifierResultat(0.62, "street"), GEOCODAGE_STATUTS.TROUVE);
});

test("geocodage — un centre de commune n'est JAMAIS trouve, meme a score parfait", () => {
  // municipality renvoie le centre du village, pas l'adresse. Le livrer comme
  // une position exacte ferait croire a une precision qui n'existe pas : elle
  // peut etre a plusieurs kilometres de la porte du client.
  assert.equal(qualifierResultat(1, "municipality"), GEOCODAGE_STATUTS.AMBIGU);
  assert.equal(qualifierResultat(0.99, "locality"), GEOCODAGE_STATUTS.AMBIGU);
});

test("geocodage — un score faible est introuvable", () => {
  assert.equal(qualifierResultat(0.2, "housenumber"), GEOCODAGE_STATUTS.INTROUVABLE);
  assert.equal(qualifierResultat(0, "street"), GEOCODAGE_STATUTS.INTROUVABLE);
});

// --- Appel au geocodeur -----------------------------------------------------

test("geocodage — le code postal est envoye en filtre, pas noye dans la requete", async () => {
  reinitialiser();
  await geocoderAdresse(
    { rue: "12 avenue du General", codePostal: "25000", ville: "Besancon" },
    { forcer: true }
  );

  assert.equal(requetesRecues.length, 1);
  assert.equal(requetesRecues[0].postcode, "25000");
  assert.equal(requetesRecues[0].limit, "1");
  // Le code postal ne doit pas etre duplique dans q : il est deja en filtre.
  assert.ok(!requetesRecues[0].q.includes("25000"));
});

test("geocodage — le resultat est mis en cache et l'API n'est plus rappelee", async () => {
  reinitialiser();
  const adresse = { rue: "1 rue du Cache", codePostal: "25000", ville: "Besancon" };

  const premier = await geocoderAdresse(adresse);
  assert.equal(premier.statut, GEOCODAGE_STATUTS.TROUVE);
  assert.equal(requetesRecues.length, 1);

  const second = await geocoderAdresse(adresse);
  assert.equal(second.lat, premier.lat);
  assert.equal(requetesRecues.length, 1, "l'API a ete rappelee alors que le cache suffisait");
});

test("geocodage — une erreur reseau n'est PAS mise en cache definitivement", async () => {
  reinitialiser();
  const adresse = { rue: "2 rue de la Panne", codePostal: "25000", ville: "Besancon" };

  scenario.mode = "http500";
  const echec = await geocoderAdresse(adresse);
  assert.equal(echec.statut, GEOCODAGE_STATUTS.ERREUR);

  // Une erreur n'est pas une reponse : le lancement suivant doit retenter.
  scenario.mode = "trouve";
  const reussite = await geocoderAdresse(adresse);
  assert.equal(reussite.statut, GEOCODAGE_STATUTS.TROUVE);
  assert.equal(requetesRecues.length, 2);
});

test("geocodage — un introuvable EST mis en cache, lui", async () => {
  reinitialiser();
  const adresse = { rue: "3 rue Fantome", codePostal: "25000", ville: "Besancon" };

  scenario.mode = "vide";
  const premier = await geocoderAdresse(adresse);
  assert.equal(premier.statut, GEOCODAGE_STATUTS.INTROUVABLE);

  const second = await geocoderAdresse(adresse);
  assert.equal(second.statut, GEOCODAGE_STATUTS.INTROUVABLE);
  assert.equal(requetesRecues.length, 1, "un introuvable est une reponse, pas une panne");
});

test("geocodage — un delai depasse devient une erreur, sans lever", async () => {
  reinitialiser();
  scenario.delaiMs = 2500; // au-dela de SEREO_GEOCODER_TIMEOUT_MS

  const resultat = await geocoderAdresse(
    { rue: "4 rue Lente", codePostal: "25000", ville: "Besancon" },
    { forcer: true }
  );

  assert.equal(resultat.statut, GEOCODAGE_STATUTS.ERREUR);
  scenario.delaiMs = 0;
});

// --- Geocodage d'un lot de clients ------------------------------------------

test("geocodage — les clients sans coordonnees sont geolocalises", async () => {
  reinitialiser([
    client("c1", "12 avenue du General", "25000", "Besancon"),
    client("c2", "28 avenue Carnot", "39300", "Champagnole")
  ]);

  const bilan = await geocoderClients();
  assert.equal(bilan.candidats, 2);
  assert.equal(bilan.appliques, 2);
  assert.equal(bilan.parStatut.trouve, 2);

  const apres = readDb().clients;
  assert.equal(apres.every(c => c.lat !== "" && c.lng !== ""), true);
});

test("geocodage — un client deja geolocalise n'est pas retraite", async () => {
  reinitialiser([
    client("c1", "12 avenue du General", "25000", "Besancon", { lat: 47.1, lng: 6.0 }),
    client("c2", "28 avenue Carnot", "39300", "Champagnole")
  ]);

  const bilan = await geocoderClients();
  assert.equal(bilan.candidats, 1, "seul le client sans coordonnees devait etre candidat");

  const c1 = readDb().clients.find(c => c.id === "c1");
  assert.equal(c1.lat, 47.1, "les coordonnees existantes ont ete ecrasees");
});

test("geocodage — les coordonnees sont propagees aux commandes du client", async () => {
  // Sans cette propagation, les bons deja importes resteraient sans position
  // et les tournees construites dessus sans distance.
  reinitialiser([client("c1", "12 avenue du General", "25000", "Besancon")]);

  const db = readDb();
  db.commandes = [
    { id: "o1", clientId: "c1", lat: "", lng: "", produits: [] },
    { id: "o2", clientId: "c1", lat: "", lng: "", produits: [] },
    { id: "o3", clientId: "autre", lat: "", lng: "", produits: [] }
  ];
  writeDb(db);

  await geocoderClients();

  const apres = readDb().commandes;
  const duClient = apres.filter(o => o.clientId === "c1");
  assert.equal(duClient.length, 2);
  assert.equal(duClient.every(o => o.lat !== "" && o.lng !== ""), true, "toutes les commandes du client devaient recevoir la position");
  assert.equal(apres.find(o => o.id === "o3").lat, "", "la commande d'un autre client ne doit pas bouger");
});

test("geocodage — un resultat ambigu n'est PAS applique au client", async () => {
  // Adresse volontairement unique : le cache de geocodage vit hors de
  // readDb/writeDb, donc reinitialiser() ne le vide pas. Reutiliser une adresse
  // deja geocodee dans un test precedent renverrait son resultat en cache sans
  // jamais interroger le faux geocodeur — ce qui est precisement le
  // comportement attendu du cache, mais rendrait ce test-ci vacant.
  reinitialiser([client("c1", "77 rue de l'Ambiguite", "25000", "Besancon")]);
  scenario.type = "municipality";

  const bilan = await geocoderClients();
  assert.equal(bilan.parStatut.ambigu, 1);
  assert.equal(bilan.appliques, 0);
  assert.equal(readDb().clients[0].lat, "", "un centre de commune ne doit pas passer pour une adresse");
});

test("geocodage — le lot est plafonne et la troncature est signalee", async () => {
  reinitialiser([
    client("c1", "1 rue A", "25000", "Besancon"),
    client("c2", "2 rue B", "25000", "Besancon"),
    client("c3", "3 rue C", "25000", "Besancon")
  ]);

  const bilan = await geocoderClients({ max: 2 });
  assert.equal(bilan.candidats, 3);
  assert.equal(bilan.traites, 2);
  assert.equal(bilan.tronque, true);
});

test("geocodage — un client sans adresse exploitable est ignore, pas en erreur", async () => {
  reinitialiser([
    client("c1", "", "", ""),
    client("c2", "12 avenue du General", "25000", "Besancon")
  ]);

  const bilan = await geocoderClients();
  assert.equal(bilan.candidats, 1);
  assert.equal(bilan.parStatut.erreur, 0);
});

// --- Etat -------------------------------------------------------------------

test("geocodage — l'etat distingue geolocalises, a faire et sans adresse", async () => {
  reinitialiser([
    client("c1", "12 avenue du General", "25000", "Besancon", { lat: 47.1, lng: 6.0 }),
    client("c2", "28 avenue Carnot", "39300", "Champagnole"),
    client("c3", "", "", "")
  ]);

  const etat = etatGeocodage();
  assert.equal(etat.clients, 3);
  assert.equal(etat.geolocalises, 1);
  assert.equal(etat.aGeocoder, 1);
  assert.equal(etat.sansAdresseExploitable, 1);
});

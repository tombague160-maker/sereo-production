// Lot 4 de l'audit geo (23/09) : « une carte utilisable au telephone », cote
// serveur.
//
// 1. Le fond de carte se regle en UN endroit (lib/fond-de-carte.js, lu depuis
//    l'environnement) : la page le recoit par /api/carte/fond, et la CSP suit
//    le MEME hote. Avant, l'URL etait ecrite en dur deux fois (app.js et la
//    CSP de server.js) : changer de fournisseur demandait deux modifications
//    et un oubli donnait une carte vide, sans message.
// 2. Les tuiles partent avec l'origine en Referer (referrerPolicy) et
//    l'attribution porte le lien vers la licence : la politique d'usage d'OSM
//    exige l'un et l'autre (constat de l'auditeur carte, mesure le 23/09 :
//    21 tuiles sur 21 sans Referer, attribution sans lien).
// 3. Un point « approximatif » (la BAN ne rend que la rue, pas le numero) est
//    DIT comme tel, pour que la carte le distingue.
//
// Aucun appel reseau externe : un faux geocodeur local, le port 3392.

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT_FAUX_GEOCODEUR = 3392;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-carte-"));

process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_GEOCODER_URL = `http://127.0.0.1:${PORT_FAUX_GEOCODEUR}/search/`;
process.env.SEREO_GEOCODER_INTERVALLE_MS = "0";
process.env.SEREO_GEOCODER_TIMEOUT_MS = "1500";
// Un fournisseur de tuiles AUTRE que le defaut : c'est lui que la page et la
// CSP doivent suivre. Un domaine reserve (RFC 2606) : rien n'y part jamais.
process.env.SEREO_TUILES_URL = "https://tuiles.example.org/carte/{z}/{x}/{y}.png";
process.env.SEREO_TUILES_ATTRIBUTION = "&copy; Fournisseur d'essai";

const { app, closeStorage, writeDb, readDb, defaultDb, geocoderClients } = require("../server");

let server;
let baseUrl;
let typeRendu = "street";
let fauxGeocodeur;

before(async () => {
  fauxGeocodeur = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [5.9806, 47.2378] },
        properties: { label: "Rue de la Gare 25000 Besancon", score: 0.95, type: typeRendu }
      }]
    }));
  });
  fauxGeocodeur.listen(PORT_FAUX_GEOCODEUR, "127.0.0.1");
  await once(fauxGeocodeur, "listening");
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  fauxGeocodeur.closeAllConnections();
  await new Promise(resolve => fauxGeocodeur.close(resolve));
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test("fond de carte : la page recoit le fournisseur configure, avec Referer et attribution", async () => {
  const res = await fetch(`${baseUrl}/api/carte/fond`);
  assert.equal(res.status, 200, "GET /api/carte/fond ne repond pas");
  const fond = await res.json();
  assert.equal(fond.url, "https://tuiles.example.org/carte/{z}/{x}/{y}.png");
  assert.equal(fond.attribution, "&copy; Fournisseur d'essai");
  // L'origine seule part (pas le chemin #livreur) : c'est ce qu'OSM demande,
  // et `no-referrer` reste en vigueur pour tout le reste du document.
  assert.equal(fond.referrerPolicy, "strict-origin-when-cross-origin");
  assert.ok(Number.isInteger(fond.zoomMax) && fond.zoomMax > 0);
});

test("fond de carte : la CSP autorise le fournisseur configure, et lui seul", async () => {
  // La page elle-meme : c'est elle qui charge les tuiles.
  const res = await fetch(`${baseUrl}/`);
  const csp = res.headers.get("content-security-policy") || "";
  const imgSrc = csp.split(";").map(s => s.trim()).find(s => s.startsWith("img-src")) || "";
  assert.match(imgSrc, /https:\/\/tuiles\.example\.org(\s|$)/, `img-src ne suit pas le fournisseur : ${imgSrc}`);
  assert.doesNotMatch(imgSrc, /openstreetmap/, `img-src garde l'ancien hote code en dur : ${imgSrc}`);
});

test("fond de carte : le defaut est OpenStreetMap, avec le lien vers la licence", () => {
  const { fondDeCarte } = require("../lib/fond-de-carte");
  const fond = fondDeCarte({});
  assert.equal(fond.url, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assert.match(fond.attribution, /<a href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>/);
  assert.match(fond.attribution, /OpenStreetMap/);
  assert.equal(fond.origineCsp, "https://tile.openstreetmap.org");
});

test("fond de carte : une URL invalide retombe sur le defaut au lieu de casser la carte", () => {
  const { fondDeCarte } = require("../lib/fond-de-carte");
  // http en clair, schema etranger, gabarit sans {z}/{x}/{y}, hote avec un joker non gere.
  for (const url of ["http://tuiles.example.org/{z}/{x}/{y}.png", "javascript:alert(1)//{z}{x}{y}",
    "https://tuiles.example.org/tuile.png", "https://{r}.example.org/{z}/{x}/{y}.png"]) {
    const fond = fondDeCarte({ SEREO_TUILES_URL: url, SEREO_TUILES_ATTRIBUTION: "x" });
    assert.equal(fond.url, "https://tile.openstreetmap.org/{z}/{x}/{y}.png", `accepte a tort : ${url}`);
    // L'attribution va avec le fournisseur : on ne garde pas celle d'un autre.
    assert.match(fond.attribution, /openstreetmap\.org\/copyright/, `attribution etrangere gardee pour : ${url}`);
  }
  // Le sous-domaine {s} : la CSP recoit le joker, que le navigateur comprend.
  const s = fondDeCarte({ SEREO_TUILES_URL: "https://{s}.tuiles.example.org/{z}/{x}/{y}.png" });
  assert.equal(s.origineCsp, "https://*.tuiles.example.org");
});

test("position approximative : un point au milieu de la rue est DIT approximatif, un numero ne l'est pas", async () => {
  const db = defaultDb();
  db.clients = [
    { id: "c-rue", nom: "Client rue", rue: "rue de la Gare", ville: "Besancon", codePostal: "25000" },
    { id: "c-num", nom: "Client numero", rue: "3 rue de la Gare", ville: "Besancon", codePostal: "25001" }
  ];
  db.commandes = [{ id: "o-rue", clientId: "c-rue", clientName: "Client rue", status: "pret_livraison", address: "rue de la Gare", city: "Besancon", postalCode: "25000", products: [] }];
  writeDb(db, { backup: false });

  typeRendu = "street";
  await geocoderClients({ max: 1 });
  typeRendu = "housenumber";
  await geocoderClients({ max: 1 });

  const apres = readDb();
  const rue = apres.clients.find(c => c.id === "c-rue");
  const num = apres.clients.find(c => c.id === "c-num");
  assert.ok(rue.lat && num.lat, "prealable : les deux clients devaient etre geolocalises");
  assert.equal(rue.positionPrecision, "approximative");
  assert.equal(num.positionPrecision, "adresse");
  // La commande du client suit, comme ses coordonnees.
  assert.equal(apres.commandes.find(o => o.id === "o-rue").positionPrecision, "approximative");

  // Une correction a la main n'est plus approximative.
  const res = await fetch(`${baseUrl}/api/clients/c-rue/coordinates`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: 47.24, lng: 6.02 })
  });
  assert.equal(res.status, 200);
  const corrige = readDb();
  assert.equal(corrige.clients.find(c => c.id === "c-rue").positionPrecision, "manuelle");
  assert.equal(corrige.commandes.find(o => o.id === "o-rue").positionPrecision, "manuelle");
});

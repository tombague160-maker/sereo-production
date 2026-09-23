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
//    DIT comme tel, pour que la carte le distingue. Depuis l'integration des
//    lots 3, 4 et 7, il n'y a qu'UN champ : geoPrecision (lot 3 : « numero »,
//    « rue », « lieu-dit », « commune », « manuel ») et son origine geoSource.
//    La carte en derive « approximatif » (rue, lieu-dit, commune). Le champ
//    positionPrecision du lot 4 n'existe plus.
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

const { zipSync, strToU8 } = require("fflate");
const { app, closeStorage, writeDb, readDb, defaultDb, geocoderClients } = require("../server");

/** Un classeur .xlsx minimal (une feuille, cellules texte), comme api.test.js. */
function classeur(lignes) {
  const echapper = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const colonne = i => String.fromCharCode(65 + i);
  const feuille = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lignes.map((ligne, r) =>
    `<row r="${r + 1}">${ligne.map((c, i) => `<c r="${colonne(i)}${r + 1}" t="inlineStr"><is><t>${echapper(c)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const fichiers = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Feuille1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(feuille)
  };
  return new Blob([Buffer.from(zipSync(fichiers))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

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
  assert.equal(rue.geoPrecision, "rue");
  assert.equal(rue.geoSource, "ban");
  assert.equal(num.geoPrecision, "numero");
  // La commande du client suit, comme ses coordonnees.
  assert.equal(apres.commandes.find(o => o.id === "o-rue").geoPrecision, "rue");
  // Un seul champ : l'ancien du lot 4 n'est plus ecrit nulle part.
  for (const e of [rue, num, ...apres.commandes]) assert.equal(e.positionPrecision, undefined, `positionPrecision reapparu sur ${e.id}`);

  // Une correction a la main n'est plus approximative.
  const res = await fetch(`${baseUrl}/api/clients/c-rue/coordinates`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: 47.24, lng: 6.02 })
  });
  assert.equal(res.status, 200);
  const corrige = readDb();
  assert.equal(corrige.clients.find(c => c.id === "c-rue").geoPrecision, "manuel");
  assert.equal(corrige.clients.find(c => c.id === "c-rue").geoSource, "manuel");
  assert.equal(corrige.commandes.find(o => o.id === "o-rue").geoPrecision, "manuel");
});

// Relecture adverse du 23/09 : le « approximatif » ne vivait que sur les
// commandes presentes AU MOMENT du geocodage. Le client est reconstruit a
// chaque import (sa precision perdue), la commande suivante copiait ses
// coordonnees sans elle, et geocoderClients ne repasse pas sur un client deja
// place : l'arret de mardi s'affichait comme une adresse exacte.
test("position approximative : la commande importee APRES le geocodage garde le « approximatif » du client", async () => {
  const db = defaultDb();
  db.clients = [{
    id: "c-gare", nom: "Client gare", rue: "rue de la Gare", ville: "Besancon", codePostal: "25000",
    lat: 47.2378, lng: 5.9806, geoPrecision: "rue", geoSource: "ban"
  }];
  db.commandes = [{
    id: "o-lundi", clientId: "c-gare", clientName: "Client gare", status: "pret_livraison", dateCommande: "2026-09-21",
    address: "rue de la Gare", city: "Besancon", postalCode: "25000", lat: 47.2378, lng: 5.9806,
    geoPrecision: "rue", geoSource: "client", products: []
  }];
  writeDb(db, { backup: false });

  const form = new FormData();
  form.append("file", classeur([
    ["Date", "Client", "Quantite", "Produit", "Rue", "Code postal", "Ville"],
    ["22/09/2026", "Client gare", "1", "Changes taille L", "rue de la Gare", "25000", "Besancon"]
  ]), "ventes.xlsx");
  const res = await fetch(`${baseUrl}/api/import/ventes`, { method: "POST", body: form });
  assert.equal(res.status, 200, `import refuse : ${await res.text()}`);

  const apres = readDb();
  const commandes = apres.commandes.filter(o => String(o.clientId) === "c-gare");
  const mardi = commandes.find(o => o.id !== "o-lundi");
  assert.ok(mardi, `prealable : l'import devait creer la commande de mardi (${commandes.map(o => o.id).join(", ")})`);
  assert.equal(String(mardi.lat), "47.2378", "prealable : la commande de mardi prend le point du client");
  assert.equal(apres.clients.find(c => c.id === "c-gare").geoPrecision, "rue", "le client reimporte a perdu sa precision");
  assert.equal(mardi.geoPrecision, "rue", "la commande de mardi s'affiche comme une adresse exacte");
});

test("position approximative : un client geocode AVANT le lot est rattrape depuis le cache, pas ses commandes livrees ailleurs", async () => {
  const db = defaultDb();
  db.clients = [{ id: "c-ancien", nom: "Client ancien", rue: "rue des Anciens", ville: "Besancon", codePostal: "25002" }];
  db.commandes = [{ id: "o-ancien", clientId: "c-ancien", clientName: "Client ancien", status: "pret_livraison", address: "rue des Anciens", city: "Besancon", postalCode: "25002", products: [] }];
  writeDb(db, { backup: false });
  typeRendu = "street";
  await geocoderClients({ max: 5 });

  // L'etat d'une base d'avant le lot : les points, sans precision ni origine
  // (aucun champ geo*). Une seconde commande est livree AILLEURS (un EHPAD) :
  // elle n'est pas le client.
  const sansGeo = e => { for (const k of Object.keys(e)) if (/^geo/.test(k)) delete e[k]; };
  const avant = readDb();
  sansGeo(avant.clients.find(c => c.id === "c-ancien"));
  const ancienne = avant.commandes.find(o => o.id === "o-ancien");
  sansGeo(ancienne);
  avant.commandes.push({ ...ancienne, id: "o-ehpad", numero: "", lat: 47.1, lng: 5.8, geoPrecision: "" });
  writeDb(avant, { backup: false });
  const place = readDb().clients.find(c => c.id === "c-ancien");
  assert.ok(place.lat, "prealable : le client devait etre place");
  assert.equal(place.geoPrecision || "", "", "prealable : sans precision, comme avant le lot");
  assert.equal(readDb().commandes.find(o => o.id === "o-ancien").geoPrecision || "", "", "prealable : commande sans precision");

  await geocoderClients({ max: 5 });
  const apres = readDb();
  assert.equal(apres.clients.find(c => c.id === "c-ancien").geoPrecision, "rue", "le client d'avant le lot n'est jamais rattrape");
  assert.equal(apres.clients.find(c => c.id === "c-ancien").geoSource, "ban", "le point rattrape vient du cache BAN");
  assert.equal(apres.commandes.find(o => o.id === "o-ancien").geoPrecision, "rue");
  assert.equal(apres.commandes.find(o => o.id === "o-ehpad").geoPrecision || "", "", "la commande livree ailleurs a pris la precision du client");
});

test("fond de carte : un fournisseur sans attribution garde la mention d'OpenStreetMap, et le demarrage le dit", () => {
  const { fondDeCarte } = require("../lib/fond-de-carte");
  const avertissements = [];
  const origine = console.warn;
  console.warn = (...args) => avertissements.push(args.join(" "));
  // L'avertissement ne part qu'une fois par processus : le cas {s} plus haut
  // l'a peut-etre deja consomme.
  fondDeCarte.attributionSignalee = false;
  try {
    const fond = fondDeCarte({ SEREO_TUILES_URL: "https://tile.example-osm-mirror.org/{z}/{x}/{y}.png" });
    assert.equal(fond.url, "https://tile.example-osm-mirror.org/{z}/{x}/{y}.png", "prealable : l'URL valide est gardee");
    assert.match(fond.attribution, /openstreetmap\.org\/copyright/, "la licence ODbL a disparu sans un mot");
    assert.ok(avertissements.some(a => /SEREO_TUILES_ATTRIBUTION/.test(a)), `aucun avertissement : ${JSON.stringify(avertissements)}`);
    // Avec une attribution, c'est elle, et aucun avertissement de plus.
    const n = avertissements.length;
    const fourni = fondDeCarte({ SEREO_TUILES_URL: "https://tile.example-osm-mirror.org/{z}/{x}/{y}.png", SEREO_TUILES_ATTRIBUTION: "&copy; Miroir" });
    assert.equal(fourni.attribution, "&copy; Miroir");
    assert.equal(avertissements.length, n);
  } finally {
    console.warn = origine;
  }
});

// Un jeu de donnees de la MEME FORME que la production (mesure du 24/09,
// lecture seule) : memes comptes, memes repartitions, tailles voisines. Tout
// est invente -- noms, adresses, telephones -- et deterministe : un tirage
// pseudo-aleatoire a graine fixe, et des dates comptees depuis AUJOURDHUI
// (a Paris), pour que « ce mois-ci » et « cette semaine » tombent comme en
// production quel que soit le jour du banc.
//
// Comptes de la production reproduits (rapport du 24/09, section E) :
//   97 clients (26 secteurs, 21 sans position, 22 sans telephone, 14 sans rue),
//   224 commandes toutes livrees (441 lignes, 1 a 14 par commande, 1 client
//   inconnu, 34 dans une tournee, 397 lignes sans prix), 218 produits
//   (179 positifs dont 138 sous le seuil, 29 a zero, 10 a renseigner),
//   429 ventes sur 106 produits, 1 036 entrees d'historique, 633 mouvements
//   (129 produits absents du stock), 18 tournees (15 terminees, 3 pretes),
//   ~120 archives d'import, une image de marque de ~116 Ko.
const zlib = require("node:zlib");

// Le jour du SEME : pose par jeuProduction(), jamais fige au chargement du
// module (un ouvrier Playwright charge avant minuit semait apres minuit des
// dates de la veille -- test/seme-jour-de-paris.test.js, 25/09).
let AUJOURDHUI = jourDeParis();
function jourDeParis() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

/** mulberry32 : un tirage reproductible a graine fixe. */
function tirage(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** La date ISO (AAAA-MM-JJ) de AUJOURDHUI - `jours`. */
function ilYA(jours) {
  const d = new Date(`${AUJOURDHUI}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - jours);
  return d.toISOString().slice(0, 10);
}
const dateFr = iso => iso.split("-").reverse().join("/");

// Une liste de comptes : [[n, valeur], ...] -> [valeur x n, ...].
const deplier = paires => paires.flatMap(([n, v]) => Array(n).fill(v));

function melanger(liste, r) {
  for (let i = liste.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [liste[i], liste[j]] = [liste[j], liste[i]];
  }
  return liste;
}

const TYPES = ["EHPAD", "Pharmacie", "Cabinet infirmier", "SSIAD", "Residence", "Clinique", "Foyer", "Centre de soins", "Maison de sante", "Association"];
const NOMS = ["des Tilleuls", "du Parc", "des Acacias", "de la Source", "du Moulin", "des Lilas", "du Chateau", "des Vignes", "de la Gare", "du Lac",
  "des Cedres", "du Plateau", "de la Foret", "des Roches", "du Vallon", "Saint-Martin", "des Pres", "du Belvedere", "des Sapins", "de la Colline"];
const RUES = ["rue de la Republique", "avenue du General Leclerc", "chemin des Vignes", "place du Marche", "rue Neuve", "route de Lyon", "rue des Ecoles", "impasse des Pres", "boulevard Victor Hugo", "rue du Stade"];
// 26 secteurs (des communes du Jura et du Doubs) : les trois secteurs coeur,
// puis 23 autres. Un 27e n'existe que par la commande au client inconnu.
const SECTEURS = ["Besancon", "Champagnole", "Dole", "Arbois", "Poligny", "Salins-les-Bains", "Lons-le-Saunier", "Ornans", "Quingey", "Saint-Vit",
  "Morez", "Saint-Claude", "Pontarlier", "Baume-les-Dames", "Audincourt", "Montbeliard", "Mouchard", "Nozeroy", "Clairvaux", "Orgelet",
  "Moirans", "Tavaux", "Auxonne", "Gray", "Levier", "Frasne"];
const FAMILLES = ["Gants nitrile", "Changes complets", "Aleses jetables", "Compresses steriles", "Pansements", "Seringues", "Savon doux", "Gel hydroalcoolique",
  "Sondes urinaires", "Poches de recueil", "Bandes de contention", "Masques chirurgicaux", "Blouses", "Draps d'examen", "Lingettes", "Protections anatomiques",
  "Tubulures", "Catheters", "Serum physiologique", "Antiseptique"];
const TAILLES = ["taille S", "taille M", "taille L", "taille XL", "boite de 100", "boite de 50", "carton de 10", "flacon 500 ml", "sachet de 20", "rouleau"];

/** Une image PNG valide de ~116 Ko en base64 (non compressee : deflate niveau 0). */
function imageDeMarque(r) {
  const cote = 170;
  const brut = Buffer.alloc((cote * 3 + 1) * cote);
  for (let y = 0; y < cote; y++) {
    brut[y * (cote * 3 + 1)] = 0;
    for (let x = 0; x < cote * 3; x++) brut[y * (cote * 3 + 1) + 1 + x] = Math.floor(r() * 256);
  }
  const crc = tampon => {
    let c = ~0;
    for (const o of tampon) { c ^= o; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
    return (~c) >>> 0;
  };
  const bloc = (type, donnees) => {
    const t = Buffer.from(type, "ascii");
    const l = Buffer.alloc(4); l.writeUInt32BE(donnees.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, donnees])));
    return Buffer.concat([l, t, donnees, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cote, 0); ihdr.writeUInt32BE(cote, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc("IHDR", ihdr), bloc("IDAT", zlib.deflateSync(brut, { level: 0 })), bloc("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function jeuProduction() {
  AUJOURDHUI = jourDeParis();
  const r = tirage(20260924);
  const choisir = liste => liste[Math.floor(r() * liste.length)];
  const entre = (a, b) => a + Math.floor(r() * (b - a + 1));

  // --- Stock : 218 produits d'une seule categorie. ---
  const etatsStock = melanger(deplier([[138, "faible"], [41, "dispo"], [29, "zero"], [10, "nulle"]]), r);
  const stock = etatsStock.map((etat, i) => {
    const code = String(3401000000000 + i * 7919);
    const quantite = etat === "faible" ? entre(1, 5) : etat === "dispo" ? entre(6, 240) : etat === "zero" ? 0 : null;
    return {
      id: `stk-${String(i + 1).padStart(3, "0")}`,
      code, sku: code,
      nom: `${FAMILLES[i % FAMILLES.length]} ${TAILLES[Math.floor(i / FAMILLES.length) % TAILLES.length]} ref ${100 + i}`,
      tarif: Math.round((2 + r() * 60) * 100) / 100,
      cout: i % 31 === 0 ? 0 : Math.round((1 + r() * 30) * 100) / 100,
      statut: "Actif", type: "Fourniture", category: "Fourniture",
      quantite
    };
  });

  // --- Clients : 97, repartis sur 26 secteurs. ---
  const commandesParClient = melanger(deplier([[52, 1], [17, 2], [11, 3], [7, 4], [5, 5], [2, 9], [1, 9], [1, 10], [1, 14]]), r);
  const sansPosition = new Set(melanger([...Array(97).keys()], r).slice(0, 21));
  const sansTelephone = new Set(melanger([...Array(97).keys()], r).slice(0, 22));
  const sansRue = new Set(melanger([...Array(97).keys()], r).slice(0, 14));
  const clients = commandesParClient.map((n, i) => {
    const secteur = SECTEURS[i < 26 ? i : Math.floor(r() * 6)];
    return {
      id: `cli-${String(i + 1).padStart(3, "0")}`,
      nom: `${choisir(TYPES)} ${choisir(NOMS)} ${i + 1}`,
      rue: sansRue.has(i) ? "" : `${entre(1, 80)} ${choisir(RUES)}`,
      ville: secteur, codePostal: String(entre(25000, 39990)),
      telephone: sansTelephone.has(i) ? "" : `03 84 ${String(entre(10, 99))} ${String(entre(10, 99))} ${String(entre(10, 99))}`,
      statut: "livree", crmStatus: "", secteur,
      lat: sansPosition.has(i) ? "" : Math.round((46.6 + r() * 0.8) * 10000) / 10000,
      lng: sansPosition.has(i) ? "" : Math.round((5.4 + r() * 1.0) * 10000) / 10000,
      geoSource: "", geoPrecision: "", geoCle: "", geoLibelle: "", geoAVerifier: "",
      notes: "", priority: "", deliveryDate: "",
      produits: [], ordersByDate: {},
      _n: n
    };
  });

  // --- Commandes : 224 (223 a des clients connus, 1 a un client inconnu). ---
  const lignesParCommande = melanger(deplier([[119, 1], [56, 2], [26, 3], [10, 4], [6, 5], [3, 6], [1, 8], [1, 10], [1, 12], [1, 14]]), r);
  const proprietaires = melanger(clients.flatMap(c => Array(c._n).fill(c)), r);
  proprietaires.push(null);
  // 397 lignes sans prix sur 441.
  const avecPrix = new Set(melanger([...Array(441).keys()], r).slice(0, 44));
  let ligneGlobale = 0;
  const parAnnee = new Map();
  const commandes = proprietaires.map((client, i) => {
    const age = 6 + Math.floor(Math.pow(r(), 0.8) * 354);
    const dateCommande = ilYA(age);
    const annee = dateCommande.slice(0, 4);
    parAnnee.set(annee, (parAnnee.get(annee) || 0) + 1);
    const nbLignes = lignesParCommande[i];
    const products = [];
    for (let k = 0; k < nbLignes; k++) {
      // Une ligne sur 441 vise un produit inconnu du stock (stockStatus « inconnu »).
      const p = ligneGlobale === 77 ? { code: "9999999999999", nom: "Produit retire du catalogue" } : stock[Math.floor(Math.pow(r(), 1.6) * stock.length)];
      const quantite = ligneGlobale === 3 ? 120 : r() < 0.55 ? 1 : r() < 0.7 ? entre(2, 3) : entre(4, 12);
      const prixUnitaire = avecPrix.has(ligneGlobale) ? p.tarif || 4.5 : 0;
      products.push({ id: `l-${i + 1}-${k + 1}`, code: p.code, nom: p.nom, quantite, prixUnitaire, totalLigne: Math.round(prixUnitaire * quantite * 100) / 100 });
      ligneGlobale++;
    }
    const inconnu = { id: "cli-disparu", nom: "Client supprime", rue: "4 rue du Stade", ville: "Rochefort", codePostal: "39700", telephone: "", secteur: "Rochefort", lat: "", lng: "" };
    const c = client || inconnu;
    const creee = `${ilYA(Math.min(age, 127))}T08:${String(entre(10, 59))}:00.000Z`;
    return {
      id: `cmd-${String(i + 1).padStart(3, "0")}`,
      numero: "",
      dateCommande,
      excelRowHash: (0x10000000 + i * 7777777).toString(16).padStart(16, "0").slice(0, 16),
      clientId: c.id, clientName: c.nom,
      address: c.rue, city: c.ville, postalCode: c.codePostal, sector: c.secteur,
      products, status: "livre", preparationStatus: "terminee", deliveryStatus: "livre",
      createdAt: creee, updatedAt: creee, notes: i % 17 === 0 ? "Livrer a l'accueil, sonner deux fois." : "", priority: "",
      phone: c.telephone, lat: c.lat, lng: c.lng, geoPrecision: "", geoSource: "",
      deliveryDate: "", stockReservedAt: null, stockReleasedAt: null, stockReleaseReason: "",
      routeId: "", importedAsLivre: true, deliveredAt: "", remisA: "",
      subscriptionId: "", subscriptionDate: "", source: "", orderType: "immediate", parentOrderId: "",
      confirmedAt: "", plannedReminderId: "", reminderLeadDays: null, total: 0, sentToPreparationAt: ""
    };
  });
  // Numeros humains par annee, dans l'ordre des dates.
  const compteurs = new Map();
  [...commandes].sort((a, b) => a.dateCommande.localeCompare(b.dateCommande) || a.id.localeCompare(b.id)).forEach(o => {
    const an = o.dateCommande.slice(0, 4);
    const n = (compteurs.get(an) || 0) + 1;
    compteurs.set(an, n);
    o.numero = `CMD-${an}-${String(n).padStart(3, "0")}`;
  });
  // Une seule commande livree porte sa date de livraison (comme en production).
  commandes[0].deliveredAt = `${ilYA(3)}T08:48:14.707Z`;
  commandes[0].importedAsLivre = false;

  // ordersByDate et produits a plat, sur chaque client, depuis SES commandes.
  const clientsParId = new Map(clients.map(c => [c.id, c]));
  for (const o of commandes) {
    const c = clientsParId.get(o.clientId);
    if (!c) continue;
    const seau = c.ordersByDate[o.dateCommande] || (c.ordersByDate[o.dateCommande] = { dateCommande: o.dateCommande, deliveryDate: "", produits: [], factureLivree: true });
    for (const l of o.products) {
      const ligne = { code: l.code, nom: l.nom, quantite: l.quantite, prixUnitaire: l.prixUnitaire, totalLigne: l.totalLigne };
      seau.produits.push({ ...ligne });
      const plat = c.produits.find(x => x.code === l.code);
      if (plat) { plat.quantite += l.quantite; plat.totalLigne = Math.round((plat.totalLigne + l.totalLigne) * 100) / 100; } else c.produits.push({ ...ligne });
    }
  }
  for (const c of clients) delete c._n;

  // --- Tournees : 15 terminees (34 arrets livres), 3 pretes (5 arrets). ---
  const arretsTerminees = melanger([5, 4, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1], r);
  const livrables = commandes.filter(o => o.clientId !== "cli-disparu");
  const enTournee = melanger([...livrables], r).slice(0, 34);
  let curseur = 0;
  const arret = (routeId, o, index, status) => ({
    id: `stop-${routeId}-${index + 1}`, routeId, orderId: o.id, clientId: o.clientId, orderIndex: index + 1,
    clientName: o.clientName, phone: o.phone, address: o.address, city: o.city, postalCode: o.postalCode, sector: o.sector,
    deliveryDate: "", products: o.products, status, notes: "", lat: o.lat, lng: o.lng,
    deliveredAt: status === "livre" ? `${o.dateCommande}T10:15:00.000Z` : ""
  });
  const routes = [];
  arretsTerminees.forEach((n, i) => {
    const id = `route-t${String(i + 1).padStart(2, "0")}`;
    const lot = enTournee.slice(curseur, curseur + n);
    curseur += n;
    lot.forEach(o => { o.routeId = id; });
    const jour = ilYA(20 + i * 7);
    routes.push({
      id, sector: lot[0].sector, city: lot[0].city, deliveryDate: "", selectedOrderIds: lot.map(o => o.id),
      stops: lot.map((o, k) => arret(id, o, k, "livre")), status: "terminee",
      departure: null, arrival: null, geometry: null, routingMode: i === 0 ? "road" : undefined,
      calculatedAt: null, totalDistance: 20 + n * 9, estimatedDuration: 30 + n * 14, troncons: null,
      createdAt: `${jour}T07:00:00.000Z`, startedAt: `${jour}T07:30:00.000Z`, completedAt: `${jour}T11:30:00.000Z`
    });
  });
  // Les trois tournees « pretes » ne sont jamais parties ; leurs commandes sont
  // deja livrees (incoherence de la production, gardee telle quelle).
  [2, 2, 1].forEach((n, i) => {
    const id = `route-p${i + 1}`;
    const lot = enTournee.slice(i * 2, i * 2 + n);
    const jour = ilYA(50 + i * 12);
    routes.unshift({
      id, sector: lot[0].sector, city: lot[0].city, deliveryDate: "", selectedOrderIds: lot.map(o => o.id),
      stops: lot.map((o, k) => arret(id, o, k, "pret_livraison")), status: "prete",
      departure: null, arrival: null, geometry: null, routingMode: "estimate",
      calculatedAt: null, totalDistance: 25, estimatedDuration: 45, troncons: null,
      createdAt: `${jour}T07:00:00.000Z`, startedAt: null, completedAt: null
    });
  });

  // --- Ventes : 429 lignes sur 106 produits (Envoyee sauf 4). ---
  const produitsVendus = stock.slice(0, 106);
  const ventesParProduit = melanger(deplier([[30, 1], [30, 2], [14, 3], [10, 4], [8, 6], [6, 9], [4, 12], [2, 20], [1, 32], [1, 35]]), r);
  const ventes = [];
  ventesParProduit.forEach((n, p) => {
    for (let k = 0; k < n; k++) {
      const o = commandes[Math.floor(r() * commandes.length)];
      const quantite = ventes.length === 11 ? 120 : r() < 0.6 ? 1 : entre(2, 6);
      const prixUnitaire = produitsVendus[p].tarif;
      const ttc = Math.round(prixUnitaire * quantite * 100) / 100;
      ventes.push({
        id: `v-${String(ventes.length + 1).padStart(4, "0")}`, codeProduit: produitsVendus[p].code, produit: produitsVendus[p].nom,
        produitComplet: `${produitsVendus[p].code} ${produitsVendus[p].nom}`, client: o.clientName,
        statutFacture: ventes.length % 107 === 5 ? "Validée" : "Envoyée",
        date: dateFr(o.dateCommande), dateCommandeIso: o.dateCommande, quantite, prixUnitaire,
        ht: Math.round(ttc / 1.2 * 100) / 100, ttc, telephone: o.phone, reference: `FA-${String(1000 + (ventes.length % 229))}`,
        codePostal: o.postalCode, rue: o.address, ville: o.city, secteur: o.sector, notes: "", priority: "", deliveryDate: "", lat: o.lat, lng: o.lng
      });
    }
  });

  // --- Historique : 1 036 entrees, types dans les proportions mesurees. ---
  const typesHisto = melanger(deplier([[716, "Stock"], [76, "Preparation"], [63, "Import ventes"], [60, "Import stock"], [53, "Tournee"], [15, "Tournée"], [49, "Livraison"], [2, "Geocodage"], [1, "CRM"], [1, "Purge"]]), r);
  const historique = typesHisto.map((type, i) => {
    const p = stock[i % stock.length];
    const avant = entre(0, 40);
    return {
      id: `h-${String(i + 1).padStart(4, "0")}`,
      date: `${ilYA(3 + Math.floor(i * 150 / typesHisto.length))}T${String(6 + (i % 12)).padStart(2, "0")}:12:00.000Z`,
      type,
      message: type === "Stock" ? `Stock ajuste pour ${p.nom} : ${avant} -> ${avant + 2}` : `${type} : operation ${i + 1} enregistree sans incident`,
      details: { productId: p.id, oldQuantity: avant, newQuantity: avant + 2, source: "banc" }
    };
  });

  // --- Mouvements de stock : 633 (600 entrees, 33 sorties), 290 produits dont 129 absents. ---
  const idsTouches = [...stock.slice(0, 161).map(p => ({ id: p.id, nom: p.nom, code: p.code })),
    ...Array.from({ length: 129 }, (_, i) => ({ id: `stk-ancien-${i + 1}`, nom: `Ancien produit ${i + 1}`, code: String(3409000000000 + i) }))];
  const parProduit = melanger(deplier([[115, 1], [97, 2], [43, 3], [18, 4], [9, 6], [6, 8], [1, 10], [1, 11]]), r);
  const stockMovements = [];
  parProduit.forEach((n, i) => {
    const p = idsTouches[i];
    for (let k = 0; k < n && stockMovements.length < 633; k++) {
      const sortie = stockMovements.length % 19 === 7 && stockMovements.filter(m => m.type === "sortie").length < 33;
      const quantity = stockMovements.length === 40 ? 100 : r() < 0.5 ? 2 : entre(1, 10);
      const oldQuantity = entre(sortie ? quantity : 0, 60);
      stockMovements.push({
        id: `stock-mv-${String(stockMovements.length + 1).padStart(4, "0")}`, productId: p.id, productName: p.nom, sku: p.code,
        type: sortie ? "sortie" : "entree", quantity, oldQuantity, newQuantity: sortie ? oldQuantity - quantity : oldQuantity + quantity,
        reason: "Ajustement manuel depuis l'ecran Stock",
        createdAt: `${ilYA(9 + Math.floor(stockMovements.length * 138 / 633))}T09:00:00.000Z`, createdBy: "local"
      });
    }
  });
  while (stockMovements.length < 633) {
    const p = idsTouches[stockMovements.length % idsTouches.length];
    stockMovements.push({ id: `stock-mv-${String(stockMovements.length + 1).padStart(4, "0")}`, productId: p.id, productName: p.nom, sku: p.code, type: "entree", quantity: 2, oldQuantity: 3, newQuantity: 5, reason: "Ajustement manuel depuis l'ecran Stock", createdAt: `${ilYA(9)}T09:00:00.000Z`, createdBy: "local" });
  }
  stockMovements.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // --- Archives d'import : ~120 entrees (58 Ko en production). ---
  const importsArchives = Array.from({ length: 123 }, (_, i) => {
    const type = i % 2 ? "stock" : "ventes";
    const jour = ilYA(4 + i);
    const nom = `${type === "ventes" ? "export-ventes" : "stock-complet"}-${jour}.xlsx`;
    return {
      id: `import-${jour}-${String(i).padStart(4, "0")}`, type, filename: nom,
      archivedFilename: `${jour}T08-00-00-000Z_${type}_${nom}`, archivedPath: `/app/data/imports-archives/${jour}_${type}_${nom}`,
      importedAt: `${jour}T08:00:00.000Z`, rowsCount: type === "ventes" ? 429 : 218, fileSize: 24000 + i * 13,
      sha256: (BigInt(i + 1) * 0x9E3779B97F4A7C15n).toString(16).padStart(64, "0").slice(0, 64),
      stats: type === "ventes" ? { rowsCount: 429, created: 0, updated: 0, skipped: 224 } : { rowsCount: 218, created: 0, updated: 218 }
    };
  });

  return {
    clients, stock, commandes, routes, ventes, historique, stockMovements, importsArchives,
    subscriptions: [], relances: [],
    settings: { appearance: { themeId: "sereo", brandImage: imageDeMarque(r), colorScheme: "light" } }
  };
}

module.exports = { jeuProduction };

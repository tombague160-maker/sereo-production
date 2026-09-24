// Un jeu de donnees de MEME FORME que la production (releve du 24/09, en
// lecture seule) : memes comptes, memes tailles moyennes, memes repartitions.
// Tout est invente et deterministe (generateur pseudo-aleatoire a graine
// fixe) : aucun nom, aucune adresse, aucun telephone reel. Les villes sont des
// communes du secteur servi (geographie publique, pas des personnes).
//
// Sert aux bancs et aux mesures qui ne disent rien sur six clients : poids du
// reseau a l'ouverture, taille du DOM, temps des rendus.
//
// Comptes vises (production, 24/09) :
//   97 clients (26 secteurs ; 21 sans position, 22 sans telephone, 14 sans rue)
//   224 commandes, toutes livrees (lignes : moyenne 1,97, max 14 ; 441 lignes)
//   218 produits en stock (179 positifs, 29 a zero, 10 a renseigner)
//   429 ventes, 1 036 lignes d'historique, 633 mouvements de stock
//   18 tournees (15 terminees, 3 pretes), 3 secteurs de livraison
//   une image de marque de ~116 ko en base64 (reglages d'apparence)

/** mulberry32 : un generateur a graine, pour que chaque lancement donne le meme jeu. */
function generateur(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VILLES = [
  ["Besancon", "25000", 47.238, 6.024], ["Champagnole", "39300", 46.745, 5.910], ["Dole", "39100", 47.092, 5.490],
  ["Pontarlier", "25300", 46.904, 6.354], ["Lons-le-Saunier", "39000", 46.674, 5.555], ["Salins-les-Bains", "39110", 46.938, 5.878],
  ["Arbois", "39600", 46.903, 5.774], ["Poligny", "39800", 46.837, 5.706], ["Saint-Vit", "25410", 47.183, 5.812],
  ["Ornans", "25290", 47.105, 6.144], ["Morteau", "25500", 47.058, 6.607], ["Quingey", "25440", 47.101, 5.883],
  ["Mouchard", "39330", 46.975, 5.797], ["Montbarrey", "39380", 47.013, 5.643], ["Mont-sous-Vaudrey", "39380", 46.975, 5.603],
  ["Arc-et-Senans", "25610", 47.031, 5.777], ["Levier", "25270", 46.955, 6.118], ["Nozeroy", "39250", 46.775, 6.035],
  ["Andelot-en-Montagne", "39110", 46.852, 5.935], ["Frasne", "25560", 46.856, 6.160], ["Mouthe", "25240", 46.710, 6.194],
  ["Baume-les-Dames", "25110", 47.352, 6.360], ["Morez", "39400", 46.522, 6.025], ["Saint-Claude", "39200", 46.387, 5.864],
  ["Orgelet", "39270", 46.521, 5.611], ["Osselle-Routelle", "25320", 47.140, 5.855]
];
const ETABLISSEMENTS = ["EHPAD Residence", "Pharmacie", "Cabinet infirmier", "SSIAD", "Maison de sante", "Clinique", "Foyer logement", "Centre de soins", "Residence autonomie"];
const NOMS = ["des Tilleuls", "du Val", "Bellevue", "des Lilas", "du Parc", "des Sources", "Saint-Joseph", "du Moulin", "de la Gare", "des Vignes", "du Lac", "Les Glycines", "du Chateau", "des Pres", "Les Charmilles", "du Centre"];
const RUES = ["rue des Lilas", "avenue de la Republique", "rue du Moulin", "chemin des Vignes", "place du Marche", "rue Neuve", "rue de la Gare", "grande rue", "rue Pasteur", "rue Victor Hugo"];
const ARTICLES = ["Changes complets taille", "Aleses jetables", "Gants nitrile", "Protections anatomiques", "Slips filet", "Carres de soin", "Lingettes nettoyantes", "Creme protectrice", "Draps d'examen", "Masques chirurgicaux", "Blouses de protection", "Tabliers plastique"];
const TAILLES = ["S", "M", "L", "XL", "XXL", "Super", "Maxi", "Nuit", "Jour", "Extra"];

function jourAvant(ymd, jours) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - jours);
  return d.toISOString().slice(0, 10);
}

/** Un identifiant a la forme d'un UUID, tire du generateur. */
function uuid(hasard) {
  const h = () => Math.floor(hasard() * 16).toString(16);
  const bloc = n => Array.from({ length: n }, h).join("");
  return `${bloc(8)}-${bloc(4)}-4${bloc(3)}-a${bloc(3)}-${bloc(12)}`;
}

/** Une image PNG valide, sans compression utile (bruit), de `octets` octets environ. */
function imagePng(hasard, octets) {
  const zlib = require("node:zlib");
  const largeur = 128;
  const hauteur = Math.max(1, Math.round(octets / (largeur * 3 + 1)));
  const brut = Buffer.alloc(hauteur * (largeur * 3 + 1));
  for (let i = 0; i < brut.length; i++) brut[i] = i % (largeur * 3 + 1) === 0 ? 0 : Math.floor(hasard() * 256);
  const bloc = (type, donnees) => {
    const longueur = Buffer.alloc(4); longueur.writeUInt32BE(donnees.length);
    const corps = Buffer.concat([Buffer.from(type, "ascii"), donnees]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(corps) >>> 0);
    return Buffer.concat([longueur, corps, crc]);
  };
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0); entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8; entete[9] = 2; entete[10] = 0; entete[11] = 0; entete[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    bloc("IHDR", entete), bloc("IDAT", zlib.deflateSync(brut, { level: 0 })), bloc("IEND", Buffer.alloc(0))
  ]);
}

/** `aujourdhui` : le jour de Paris (AAAA-MM-JJ) ; les dates du jeu s'y rapportent. */
function jeuProduction(aujourdhui) {
  const hasard = generateur(20260924);
  const entier = (min, max) => min + Math.floor(hasard() * (max - min + 1));
  const choisir = liste => liste[Math.floor(hasard() * liste.length)];

  // --- Stock : 218 produits, une categorie --------------------------------
  const stock = Array.from({ length: 218 }, (_, i) => {
    const code = String(3400000000000 + i * 7919);
    const nom = `${ARTICLES[i % ARTICLES.length]} ${TAILLES[Math.floor(i / ARTICLES.length) % TAILLES.length]} x${10 * (1 + (i % 9))}`;
    // 10 « a renseigner » (quantite nulle), 29 a zero, 179 positifs dont 138 sous le seuil.
    const quantite = i < 10 ? null : i < 39 ? 0 : i < 177 ? entier(1, 8) : entier(40, 400);
    return {
      id: `st-${code}`, code, sku: code, nom, tarif: Math.round((2 + hasard() * 40) * 100) / 100,
      cout: i < 7 ? 0 : Math.round((1 + hasard() * 20) * 100) / 100, statut: "Actif", type: "Fourniture",
      category: "Fourniture", alertThreshold: 10, stockMinimum: 10, seuilMinimum: 10, quantite
    };
  });
  const ligneProduit = (p, quantite, avecPrix) => ({
    code: p.code, nom: p.nom, quantite,
    prixUnitaire: avecPrix ? p.tarif : 0, totalLigne: avecPrix ? Math.round(p.tarif * quantite * 100) / 100 : 0
  });

  // --- Clients : 97, 26 villes --------------------------------------------
  const clients = Array.from({ length: 97 }, (_, i) => {
    const [ville, codePostal, lat, lng] = VILLES[i % VILLES.length];
    const sansPosition = i >= 76;
    return {
      id: uuid(hasard),
      nom: `${choisir(ETABLISSEMENTS)} ${choisir(NOMS)} ${i + 1}`,
      rue: i % 7 === 3 ? "" : `${entier(1, 120)} ${choisir(RUES)}`,
      ville, codePostal,
      telephone: i % 9 === 4 || i % 11 === 0 || i % 31 === 7 ? "" : `03 84 ${String(10 + (i % 89)).padStart(2, "0")} ${String(entier(10, 99))} ${String(entier(10, 99))}`,
      statut: "livree", produits: [],
      lat: sansPosition ? "" : String(Math.round((lat + (hasard() - 0.5) * 0.02) * 1e6) / 1e6),
      lng: sansPosition ? "" : String(Math.round((lng + (hasard() - 0.5) * 0.02) * 1e6) / 1e6),
      secteur: ville, deliveryDate: "", notes: "", priority: "", ordersByDate: {},
      prenom: "", email: "", crmStatus: "", firstContactDate: "", lastVisitDate: "", nextReminderDate: "",
      source: "", preferences: "", needs: "", estimatedFrequency: "", nextDeliveryDate: "",
      crmArchived: false, crmConvertedAt: "", workflowStatus: "livre", preparationStatus: "terminee", deliveryStatus: "livre"
    };
  });

  // --- Commandes : 224 sur 98 clients (dont un client inconnu) -------------
  // Commandes par client : mediane 1, p90 5, max 14 (somme 224).
  const parClient = [14, 12, 10, 9, 8, 7, 6, 6, 5, 5, 5, 5, 4, 4, 4, 3, 3, 3, 3, 3,
    ...Array(27).fill(2), ...Array(51).fill(1)];
  // Lignes par commande : moyenne 1,97, mediane 1, p90 3, max 14 (441 lignes).
  const lignesParCommande = [14, 12, 10, 9, 8, 8, 7, 7, 6, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, ...Array(7).fill(3), ...Array(82).fill(2), ...Array(113).fill(1)];
  const commandes = [];
  let rangLignes = 0;
  let avecPrix = 0;
  parClient.forEach((n, k) => {
    const client = k < clients.length ? clients[k] : null;
    for (let j = 0; j < n; j++) {
      const index = commandes.length;
      // Du 29/09 de l'an dernier au 18/09 : 145 en annee courante, le reste avant.
      const jours = 6 + Math.floor((index * 7919) % 355);
      const dateCommande = jourAvant(aujourdhui, jours);
      const nLignes = lignesParCommande[(rangLignes++ * 37) % lignesParCommande.length];
      const lignes = Array.from({ length: nLignes }, (_, l) => {
        const p = stock[10 + ((index * 13 + l * 29) % 106)];
        const prix = avecPrix < 44 && (index + l) % 10 === 0;
        if (prix) avecPrix++;
        return ligneProduit(p, (index + l) % 97 === 0 ? 120 : entier(1, 4), prix);
      });
      const cible = client || { id: uuid(hasard), nom: "Client retire du fichier", rue: "1 rue Neuve", ville: "Dole", codePostal: "39100", telephone: "", lat: "", lng: "", secteur: "Dole" };
      const numero = `CMD-${dateCommande.slice(0, 4)}-${String(index + 1).padStart(3, "0")}`;
      commandes.push({
        id: `cmd-${numero.toLowerCase()}`, numero, dateCommande,
        excelRowHash: uuid(hasard).replace(/-/g, "").slice(0, 16),
        clientId: cible.id, clientName: cible.nom, address: cible.rue, city: cible.ville, postalCode: cible.codePostal,
        sector: cible.secteur, products: lignes, status: "livre", preparationStatus: "terminee", deliveryStatus: "livre",
        createdAt: `${jourAvant(aujourdhui, Math.min(jours, 120))}T08:${String(index % 60).padStart(2, "0")}:00.000Z`,
        updatedAt: `${jourAvant(aujourdhui, 3)}T08:43:25.042Z`, notes: "", priority: "", phone: cible.telephone,
        lat: cible.lat === "" ? "" : Number(cible.lat), lng: cible.lng === "" ? "" : Number(cible.lng),
        importedAsLivre: index >= 34, deliveredAt: index === 0 ? `${jourAvant(aujourdhui, 3)}T08:48:14.707Z` : "",
        orderType: "immediate", total: 0, reminderLeadDays: 0
      });
      if (client) {
        const bucket = client.ordersByDate[dateCommande] ||= { dateCommande, deliveryDate: "", produits: [], factureLivree: true };
        bucket.produits.push(...lignes.map(l => ({ ...l })));
        for (const l of lignes) {
          const deja = client.produits.find(x => x.code === l.code);
          if (deja) deja.quantite += l.quantite; else client.produits.push({ ...l });
        }
      }
    }
  });

  // --- Tournees : 15 terminees (34 arrets livres), 3 pretes (5 arrets) -----
  const routes = [];
  const arretsTerminees = [5, 4, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1];
  let rangCommande = 0;
  const creerTournee = (n, status, k) => {
    const id = `route-${uuid(hasard)}`;
    const choisies = Array.from({ length: n }, () => commandes[rangCommande++ % 34]);
    const jour = jourAvant(aujourdhui, 10 + k * 6);
    const stops = choisies.map((o, orderIndex) => {
      if (status === "terminee") o.routeId = id;
      if (status === "terminee") o.deliveryDate = jour;
      return {
        id: `stop-${uuid(hasard)}`, routeId: id, orderId: o.id, clientId: o.clientId, orderIndex,
        clientName: o.clientName, phone: o.phone, address: o.address, city: o.city, postalCode: o.postalCode,
        sector: o.sector, deliveryDate: "", products: o.products, status: status === "terminee" ? "livre" : "pret_livraison",
        notes: "", lat: o.lat, lng: o.lng, deliveredAt: status === "terminee" ? `${jour}T10:${String(10 + orderIndex).padStart(2, "0")}:00.000Z` : ""
      };
    });
    routes.push({
      id, sector: stops[0].sector, city: stops[0].city, deliveryDate: "", selectedOrderIds: choisies.map(o => o.id), stops,
      status, departure: { label: "Champagnole", lat: 46.745, lng: 5.91 }, arrival: { label: "Champagnole", lat: 46.745, lng: 5.91 },
      routingMode: k === 0 ? "road" : "", calculatedAt: `${jour}T07:30:00.000Z`, totalDistance: 20 + k * 3, estimatedDuration: 60 + k * 7,
      createdAt: `${jour}T07:00:00.000Z`, startedAt: status === "terminee" ? `${jour}T08:00:00.000Z` : "",
      completedAt: status === "terminee" ? `${jour}T12:00:00.000Z` : ""
    });
  };
  arretsTerminees.forEach((n, k) => creerTournee(n, "terminee", k));
  [2, 2, 1].forEach((n, k) => creerTournee(n, "prete", 15 + k));

  // --- Ventes : 429 lignes, 106 produits -----------------------------------
  const ventes = Array.from({ length: 429 }, (_, i) => {
    const o = commandes[i % commandes.length];
    const p = stock[10 + ((i * 17) % 106)];
    const quantite = i % 143 === 0 ? 120 : entier(1, 4);
    const [a, m, j] = o.dateCommande.split("-");
    return {
      id: uuid(hasard), codeProduit: p.code, produit: p.nom, produitComplet: `${p.nom} - ${p.code}`,
      client: o.clientName, statutFacture: i < 4 ? "Validée" : "Envoyée", date: `${j}/${m}/${a}`, dateCommandeIso: o.dateCommande,
      quantite, prixUnitaire: p.tarif, ht: Math.round(p.tarif * quantite * 100) / 100, ttc: Math.round(p.tarif * quantite * 120) / 100,
      telephone: o.phone, reference: `FA${String(260000 + i)}`, codePostal: o.postalCode, rue: o.address, ville: o.city,
      secteur: o.sector, notes: "", priority: "", deliveryDate: "", lat: String(o.lat), lng: String(o.lng)
    };
  });

  // --- Historique : 1 036 lignes, du plus recent au plus ancien ------------
  const typesHistorique = [["Stock", 716], ["Preparation", 76], ["Import ventes", 63], ["Import stock", 60], ["Tournee", 53], ["Livraison", 49], ["Tournée", 15], ["Geocodage", 2], ["CRM", 1], ["Purge", 1]];
  const typesEtales = typesHistorique.flatMap(([t, n]) => Array(n).fill(t));
  const historique = typesEtales.map((type, i) => {
    const p = stock[i % stock.length];
    return {
      id: uuid(hasard), date: new Date(Date.parse(`${aujourdhui}T08:48:21.233Z`) - i * 3 * 3600 * 1000).toISOString(), type,
      message: type === "Stock" ? `${p.nom} : quantite ajustee de ${entier(0, 50)} a ${entier(0, 60)}` : `${type} : operation numero ${i} enregistree`,
      details: { productId: p.id, code: p.code, avant: entier(0, 50), apres: entier(0, 60), source: "manuel" }
    };
  });

  // --- Mouvements de stock : 633, 290 produits dont 129 absents du stock ----
  const mouvements = Array.from({ length: 633 }, (_, i) => {
    const absent = i % 290 >= 161;
    const rang = i % 290;
    const p = absent ? { id: `st-ancien-${rang}`, nom: `Article retire du catalogue, ancienne reference ${rang}`, code: String(3500000000000 + rang) } : stock[rang % stock.length];
    const entree = i >= 33;
    const quantity = i % 211 === 0 ? 100 : entier(1, 8);
    const oldQuantity = entier(0, 60);
    return {
      id: uuid(hasard), productId: p.id, productName: p.nom, sku: p.code, type: entree ? "entree" : "sortie",
      quantity, oldQuantity, newQuantity: entree ? oldQuantity + quantity : Math.max(0, oldQuantity - quantity),
      reason: "Import stock : quantite mise a jour.", createdAt: new Date(Date.parse(`${aujourdhui}T22:47:57.167Z`) - (9 + i * 0.2) * 86400000).toISOString(),
      createdBy: "local"
    };
  });

  // --- Archives d'import : 63 ventes + 60 stock ---------------------------
  const importsArchives = Array.from({ length: 123 }, (_, i) => {
    const type = i < 63 ? "ventes" : "stock";
    const quand = new Date(Date.parse(`${aujourdhui}T07:00:00.000Z`) - i * 1.2 * 86400000).toISOString();
    const nom = `${type === "ventes" ? "Export_ventes_Ximi" : "Etat_du_stock"}_${quand.slice(0, 10)}.xlsx`;
    return {
      id: `import-${quand.replace(/[:.]/g, "-")}-${uuid(hasard).slice(0, 8)}`, type, filename: nom,
      archivedFilename: `${quand.replace(/[:.]/g, "-")}_${type}_${nom}`, archivedPath: `/app/data/imports-archives/${quand.replace(/[:.]/g, "-")}_${type}_${nom}`,
      importedAt: quand, rowsCount: entier(5, 220), fileSize: entier(9000, 60000), sha256: (uuid(hasard) + uuid(hasard)).replace(/-/g, "").slice(0, 64),
      stats: type === "ventes"
        ? { rowsCount: entier(5, 40), clients: entier(1, 12), commandesCreees: entier(0, 8), commandesMisesAJour: entier(0, 3), identiques: entier(0, 5), importedAsLivre: entier(0, 8) }
        : { rowsCount: entier(150, 220), created: entier(0, 5), updated: entier(0, 60), unchanged: entier(100, 200), mouvements: entier(0, 60) }
    };
  });

  const image = imagePng(hasard, 87000);
  return {
    clients, stock, commandes, routes, ventes, historique, stockMovements: mouvements, importsArchives,
    subscriptions: [], relances: [],
    deliverySectors: [
      { id: "secteur-besancon", secteur: "Besancon", villePrincipale: "Besancon", jourMois: 25, frequence: "mensuelle", pointDepart: "Champagnole", notes: "" },
      { id: "secteur-champagnole", secteur: "Champagnole", villePrincipale: "Champagnole", jourMois: 5, frequence: "mensuelle", pointDepart: "Champagnole", notes: "" },
      { id: "secteur-dole", secteur: "Dole", villePrincipale: "Dole", jourMois: 15, frequence: "mensuelle", pointDepart: "Champagnole", notes: "" }
    ],
    settings: { appearance: { themeId: "sereo", brandImage: `data:image/png;base64,${image.toString("base64")}`, colorScheme: "light" } }
  };
}

module.exports = { jeuProduction };

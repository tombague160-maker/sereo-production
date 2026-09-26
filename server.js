const routing = require("./lib/routing");
const geocodage = require("./lib/geocodage");
const express = require("express");
const compression = require("compression");
const multer = require("multer");
const readXlsxFile = require("read-excel-file/node");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { zipSync, strToU8 } = require("fflate");
const { createSqliteStore, lireTourneesDuFichier, ETAT_DE_LECTURE, AJOUT_EN_TETE } = require("./storage/sqliteStore");
const sauvegardeBase = require("./lib/sauvegarde-base");
const { empreinteDesSources, shellEmpreinte } = require("./lib/empreinte-shell");
const { fondDeCarte } = require("./lib/fond-de-carte");
const { GestionnaireOsrm } = require("./lib/osrm-local");
// Le jour calendaire est celui de Paris, quel que soit le fuseau du processus (24/09).
const { jourParis, jourDeLInstant, ajouterJours, debutSemaine, debutMois, moisSuivant, moisPrecedent } = require("./lib/jour-paris");
// Le calendrier des abonnements, celui de l'ecran Abonnements (« A recommander
// qui voit venir », 24/09 : les echeances ne se recalculent pas autrement).
const calendrierAbonnements = require("./lib/subscriptions");
// Lot « donnees utiles » (24/09) : garde-fous de saisie, clients qui ne
// commandent plus, auteur de chaque ecriture.
const saisie = require("./lib/saisie");
const { relanceSuggeree } = require("./lib/relance-client");
const { AsyncLocalStorage } = require("node:async_hooks");

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.SEREO_HOST || process.env.HOST || "127.0.0.1";

// Chantier 2 (audit 2026-06-04) : detection de version multi-source pour
// gerer le cas ou release-please est en panne et que les tags sont poses
// manuellement (package.json reste figé). Priorite :
// 1. env var SEREO_APP_VERSION : posee par le wrapper sereo-updater
//    (`SEREO_APP_VERSION=$(git describe --tags --abbrev=0 | sed 's/^v//')`).
// 2. fichier VERSION a la racine : ecrit par un script de build/deploy
//    avec `git describe --tags --abbrev=0 > VERSION`. Tolere `v1.18.0` ou `1.18.0`.
// 3. package.json (legacy, valide quand release-please marche).
// 4. fallback "0.0.0" si tout echoue.
//
// Cache memoire process : se rafraichit au prochain redemarrage container.
const APP_VERSION = (() => {
  const normalize = v => String(v || "").trim().replace(/^v/i, "") || null;

  const envVersion = normalize(process.env.SEREO_APP_VERSION);
  if (envVersion) return envVersion;

  try {
    const fileVersion = normalize(require("fs").readFileSync("./VERSION", "utf8"));
    if (fileVersion) return fileVersion;
  } catch (e) { /* fichier absent : tomber sur package.json */ }

  try {
    const pkgVersion = normalize(require("./package.json").version);
    if (pkgVersion) return pkgVersion;
  } catch (e) { /* impossible : tomber sur 0.0.0 */ }

  return "0.0.0";
})();
const GITHUB_REPO = "tombague160-maker/sereo-production";

// Cache memoire des release notes recuperees depuis l'API GitHub.
// Pour eviter de rappeler GitHub a chaque /api/version (rate limit 60/h
// pour requetes anonymes), on cache 1h apres le 1er fetch reussi.
let releaseNotesCache = null;
let releaseNotesCacheAt = 0;
const RELEASE_NOTES_CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchReleaseNotes(version) {
  const now = Date.now();
  if (releaseNotesCache && releaseNotesCache.version === version
      && now - releaseNotesCacheAt < RELEASE_NOTES_CACHE_TTL_MS) {
    return releaseNotesCache;
  }
  const fallbackUrl = `https://github.com/${GITHUB_REPO}/releases/tag/v${version}`;
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/v${version}`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "sereo-app"
      }
    });
    if (!response.ok) {
      const cache = {
        version,
        releaseUrl: fallbackUrl,
        releaseName: `v${version}`,
        publishedAt: "",
        pourToi: "",
        fullNotes: "",
        fetchedAt: new Date().toISOString(),
        fetchError: `HTTP ${response.status}`
      };
      releaseNotesCache = cache;
      releaseNotesCacheAt = now;
      return cache;
    }
    const data = await response.json();
    const body = String(data.body || "");
    // Extrait la section "## 🎁 Pour toi" jusqu'au prochain ## (ou EOF).
    // Si la section n'existe pas, on tombe en fallback sur les notes completes.
    const match = body.match(/^##\s*🎁\s*Pour toi\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
    const pourToi = match ? match[1].trim() : "";
    const cache = {
      version,
      releaseUrl: data.html_url || fallbackUrl,
      releaseName: data.name || `v${version}`,
      publishedAt: data.published_at || "",
      pourToi,
      fullNotes: body,
      fetchedAt: new Date().toISOString(),
      fetchError: null
    };
    releaseNotesCache = cache;
    releaseNotesCacheAt = now;
    return cache;
  } catch (e) {
    const cache = {
      version,
      releaseUrl: fallbackUrl,
      releaseName: `v${version}`,
      publishedAt: "",
      pourToi: "",
      fullNotes: "",
      fetchedAt: new Date().toISOString(),
      fetchError: e.message || "fetch error"
    };
    releaseNotesCache = cache;
    releaseNotesCacheAt = now;
    return cache;
  }
}

const DB_PATH = path.resolve(process.env.SEREO_DB_PATH || path.join(__dirname, "data", "db.json"));
const STORAGE_ENGINE = (process.env.SEREO_STORAGE || "sqlite").toLowerCase();
const SQLITE_PATH = path.resolve(process.env.SEREO_SQLITE_PATH || process.env.SQLITE_PATH || path.join(__dirname, "data", "sereo.sqlite"));
const UPLOAD_DIR = path.resolve(process.env.SEREO_UPLOAD_DIR || path.join(__dirname, "imports"));
const BACKUP_DIR = path.resolve(process.env.SEREO_BACKUP_DIR || path.join(path.dirname(STORAGE_ENGINE === "json" ? DB_PATH : SQLITE_PATH), "backups"));
// Garde-fous (25/09, decision 3) : un SECOND dossier de sauvegarde, optionnel
// (un autre disque, un partage monte). Chaque sauvegarde y est aussi copiee et
// relue ; absent, rien ne change. Le meme dossier que le premier ne compte pas.
const BACKUP_COPY_DIR = (() => {
  const brut = cleanEnv(process.env.SEREO_BACKUP_COPY_DIR);
  if (!brut) return null;
  const dossier = path.resolve(brut);
  if (dossier === BACKUP_DIR) {
    console.warn("[storage] SEREO_BACKUP_COPY_DIR designe le dossier des sauvegardes lui-meme : ignore.");
    return null;
  }
  return dossier;
})();
// v1.12.0 : dossier ou les Excel importes sont archives au format brut pour
// retelechargement et audit. Sous-dossier du data dir, donc persistant sur
// le volume Docker comme la SQLite.
const IMPORTS_ARCHIVES_DIR = path.resolve(process.env.SEREO_IMPORTS_ARCHIVES_DIR || path.join(path.dirname(SQLITE_PATH), "imports-archives"));
// Calcul routier OSRM integre a l'image (23/09) : cartes dans le volume de
// donnees (/app/data/osrm en production). Le gestionnaire ne fait rien tant
// que startServer() ne l'a pas demarre, et rien du tout sans les binaires
// OSRM (poste de developpement, CI). lib/routing.js lui demande a chaque
// calcul si la carte locale est prete.
const osrmLocal = new GestionnaireOsrm({
  dossier: path.resolve(process.env.SEREO_OSRM_DIR || path.join(path.dirname(SQLITE_PATH), "osrm"))
});
routing.definirServeurLocal(() => osrmLocal.urlSiPret());
const LEAFLET_DIST = path.join(__dirname, "node_modules", "leaflet", "dist");
// Le nom du shell, calcule une fois au demarrage : CACHE_NAME du service
// worker SUIVI de l'empreinte du contenu de public/ et de Leaflet
// (lib/empreinte-shell.js). La page l'annonce (en-tete X-Sereo-Shell) et le
// service worker est servi avec CE nom a la place de CACHE_NAME : toute
// modification d'un fichier statique change le nom, donc installe un nouveau
// service worker et fait passer par le reseau le premier chargement d'une page
// neuve -- meme si personne n'a bumpe CACHE_NAME. Illisible : rien n'est
// annonce, le fichier est servi tel quel -- jamais d'erreur au demarrage.
const SHELL = (() => {
  try {
    const source = fs.readFileSync(path.join(__dirname, "public", "service-worker.js"), "utf8");
    const empreinte = empreinteDesSources([
      { nom: "public", racine: path.join(__dirname, "public") },
      { nom: "leaflet", racine: LEAFLET_DIST }
    ]);
    return shellEmpreinte(source, empreinte);
  } catch {
    return null;
  }
})();
const SHELL_ANNONCE = SHELL ? SHELL.nom : "";
const ENABLE_DB_EXPORT = process.env.SEREO_ENABLE_DB_EXPORT === "1";
const AUTH_USER = cleanEnv(process.env.SEREO_AUTH_USER);
const AUTH_PASSWORD = cleanEnv(process.env.SEREO_AUTH_PASSWORD);
const AUTH_REALM = cleanEnv(process.env.SEREO_AUTH_REALM) || "Sereo";
// Le secret de signature integre TOUJOURS le password courant pour qu'un
// changement de mot de passe invalide automatiquement toutes les sessions
// existantes, meme si SEREO_AUTH_SESSION_SECRET est explicitement defini.
//
// S2 v1.13.0 : si SEREO_AUTH_SESSION_SECRET n'est pas defini, on genere un
// secret aleatoire fort (32 bytes base64) au lieu de tomber sur AUTH_REALM
// qui vaut "Sereo" par defaut (brute-forcable). Side-effect : toutes les
// sessions sont invalidees a chaque redemarrage du container (acceptable -
// le user devra se reconnecter une fois apres deploy d'une nouvelle version).
// Pour la persistance des sessions a travers les restarts, definir
// SEREO_AUTH_SESSION_SECRET dans les variables d'environnement (Tom.yml).
//
// Lot 1 de l'audit geo (H2), 23/09 : sans la variable, le secret aleatoire est
// desormais ECRIT dans le dossier de donnees (fichier `session-secret`, a cote
// de la base, jamais dans le depot : data/ est ignore par git) et relu au
// demarrage suivant. Avant, chaque redemarrage -- donc chaque mise a jour
// deployee -- deconnectait tout le monde, et un livreur hors ligne retrouvait
// au retour du reseau une session morte. La variable, si elle est definie,
// reste prioritaire. Si le dossier n'est pas inscriptible, on revient a
// l'ancien comportement, en le disant.
const FICHIER_SECRET_SESSION = path.join(path.dirname(STORAGE_ENGINE === "json" ? DB_PATH : SQLITE_PATH), "session-secret");

function secretDeSessionPersistant(fichier) {
  try {
    const lu = fs.readFileSync(fichier, "utf8").trim();
    if (lu.length >= 32) return { secret: lu, origine: "fichier" };
  } catch { /* absent : on le cree */ }
  const neuf = crypto.randomBytes(32).toString("base64");
  try {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    // Temporaire puis renommage : un fichier a moitie ecrit ne sert jamais de secret.
    const temporaire = `${fichier}.${process.pid}.tmp`;
    fs.writeFileSync(temporaire, neuf, { mode: 0o600 });
    fs.renameSync(temporaire, fichier);
    return { secret: neuf, origine: "cree" };
  } catch (error) {
    return { secret: neuf, origine: "memoire", erreur: error.message };
  }
}

const SECRET_SESSION_ENV = cleanEnv(process.env.SEREO_AUTH_SESSION_SECRET);
const SECRET_SESSION = SECRET_SESSION_ENV
  ? { secret: SECRET_SESSION_ENV, origine: "env" }
  : secretDeSessionPersistant(FICHIER_SECRET_SESSION);
const AUTH_SESSION_SECRET_BASE = SECRET_SESSION.secret;
const AUTH_SESSION_SECRET = `${AUTH_SESSION_SECRET_BASE}|${AUTH_PASSWORD}`;
if (SECRET_SESSION.origine === "cree") {
  console.warn(`[auth] SEREO_AUTH_SESSION_SECRET non defini : secret de session cree dans ${FICHIER_SECRET_SESSION} (garde entre les redemarrages).`);
} else if (SECRET_SESSION.origine === "memoire") {
  console.warn(
    "[auth] SEREO_AUTH_SESSION_SECRET non defini et dossier de donnees non inscriptible "
    + `(${SECRET_SESSION.erreur}) : secret aleatoire en memoire. Les sessions seront invalidees au prochain redemarrage. `
    + "Definir SEREO_AUTH_SESSION_SECRET dans l'environnement pour les garder."
  );
}
const AUTH_COOKIE_NAME = "sereo_access";
const AUTH_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

// Rate limit sur /login pour eviter le brute-force.
// App privee pro derriere SWAG : on prend des valeurs douces pour ne pas
// genaner un utilisateur qui se trompe quelques fois, tout en bloquant un
// attaquant qui tenterait 1000+ tentatives/sec.
//   - MAX_ATTEMPTS : nb de tentatives ratees autorisees avant lockout
//   - WINDOW_MS    : fenetre glissante pour compter les echecs
//   - LOCKOUT_MS   : duree du lockout une fois MAX_ATTEMPTS atteint
// Configurable via env pour ajuster en prod si necessaire.
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = Math.max(1, Number(process.env.SEREO_AUTH_MAX_ATTEMPTS) || 5);
const AUTH_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.SEREO_AUTH_RATE_WINDOW_MS) || 15 * 60 * 1000);
const AUTH_RATE_LIMIT_LOCKOUT_MS = Math.max(1000, Number(process.env.SEREO_AUTH_LOCKOUT_MS) || 15 * 1000);

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const MAX_BRAND_IMAGE_DATA_URL_SIZE = 3 * 1024 * 1024;
const ACCEPTED_EXCEL_EXTENSIONS = [".xlsx"];
const DELIVERY_STATUSES = new Set(["restant", "en_cours", "livree", "absent", "probleme", "non_livre"]);
const ORDER_STATUSES = new Set([
  "brouillon",
  "planifiee",
  "a_confirmer",
  "annulee",
  "commande_client_validee",
  "importe",
  "stock_a_verifier",
  "en_preparation",
  "preparation_terminee",
  "pret_livraison",
  "en_livraison",
  "livre",
  "probleme_livraison",
  "a_reprogrammer"
]);

// Machine d'etat des transitions de status pour les commandes.
// Cette table represente les transitions VALIDES via setOrderStatus().
// Toute tentative de transition non listee est rejetee avec 400.
//
// normalizeOrder() (creation et import) BYPASSE cette validation pour
// permettre l'initialisation d'un objet a n'importe quel etat (utile
// pour `importedAsLivre` : import "Envoyee" -> directement livre).
//
// Le flux principal "happy path" :
//   importe -> stock_a_verifier -> en_preparation -> preparation_terminee
//   -> pret_livraison -> en_livraison -> livre
// + branches problemes :
//   en_livraison -> probleme_livraison -> a_reprogrammer
//   a_reprogrammer -> pret_livraison / en_preparation / en_livraison (retry)
// + raccourcis pratiques pour les cas reels :
//   en_preparation -> pret_livraison (saute preparation_terminee, deja gere ligne 2621)
//   en_livraison -> a_reprogrammer (direct depuis tournee, code existant 2034)
const ORDER_STATUS_TRANSITIONS = {
  brouillon: ["planifiee", "commande_client_validee", "stock_a_verifier", "annulee"],
  planifiee: ["a_confirmer", "annulee"],
  a_confirmer: ["commande_client_validee", "stock_a_verifier", "annulee", "planifiee"],
  annulee: [],
  commande_client_validee: ["stock_a_verifier", "en_preparation", "annulee"],
  importe: ["stock_a_verifier", "en_preparation"],
  stock_a_verifier: ["en_preparation", "pret_livraison", "annulee"],
  en_preparation: ["preparation_terminee", "pret_livraison"],
  preparation_terminee: ["pret_livraison"],
  pret_livraison: ["en_livraison", "en_preparation"],
  en_livraison: ["livre", "probleme_livraison", "a_reprogrammer", "pret_livraison"],
  livre: [],
  probleme_livraison: ["a_reprogrammer", "en_livraison"],
  a_reprogrammer: ["pret_livraison", "en_preparation", "en_livraison"]
};

function isValidOrderStatusTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  const allowed = ORDER_STATUS_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}
// Lot 2 de l'audit geo (23/09) : une tournee se ferme de TROIS facons. Avant,
// seule la fin naturelle existait (`terminee`, tous les arrets soldes) : une
// tournee mal creee bloquait ses commandes, et une tournee finie a moitie
// restait « en livraison » pour toujours (H8).
//   - `annulee`  : une tournee PRETE defaite avant le depart ; ses commandes
//                  redeviennent pretes, rien n'a bouge dans le stock ;
//   - `cloturee` : une tournee EN COURS arretee ; les arrets restants passent
//                  « A reprogrammer », les livres restent livres. Irreversible.
// Un statut inconnu est ramene a « prete » par normalizeRoute : les deux
// nouveaux DOIVENT etre ici, sinon la premiere ecriture les ressusciterait.
const ROUTE_STATUSES = new Set(["brouillon", "prete", "en_livraison", "terminee", "cloturee", "annulee"]);
// Une tournee ACTIVE retient ses commandes ; une tournee FINIE ne se rouvre
// plus par un geste d'arret (seulement par « Corriger le statut »).
const STATUTS_TOURNEE_ACTIVE = new Set(["brouillon", "prete", "en_livraison"]);
const STATUTS_TOURNEE_FINIE = new Set(["terminee", "cloturee", "annulee"]);
const STOP_STATUSES = new Set(["pret_livraison", "en_livraison", "livre", "absent", "probleme", "a_reprogrammer"]);

// --- LE MOTIF D'UN ARRET EN ECHEC -------------------------------------------
//
// LA CHARTE SE TROMPAIT (§9) : elle annonce qu'aucune raison n'est enregistree
// et qu'« un champ neuf est a creer ». Le champ `stop.problemReason` EXISTAIT.
// Mesure du 18/09, et le vrai defaut tient en trois points :
//
//   1. IL N'ETAIT LU NULLE PART. Une ecriture dans server.js, zero lecture --
//      ni serveur, ni client, ni HTML. Un mecanisme soigne et branche sur
//      personne : on le trouve en cherchant, donc on conclut qu'il marche.
//
//   2. LE LIVREUR NE POUVAIT RIEN SAISIR. Le client envoyait `{ status }` et
//      rien d'autre. Aucun ecran ne demandait de raison.
//
//   3. CE QU'IL ENREGISTRAIT N'ETAIT PAS UNE RAISON. Faute de notes envoyees,
//      `stop.notes` gardait ce que createStop y avait mis : LES INSTRUCTIONS DE
//      LIVRAISON DE LA COMMANDE. Marquer un probleme sur une commande portant
//      « code portail 1234 » enregistrait « code portail 1234 » comme cause.
//
// POURQUOI UNE LISTE FERMEE PLUTOT QUE DU TEXTE LIBRE SEUL. Un champ libre se
// remplit de « rien », « rappeler », « cf tel » -- et le releve devient
// inexploitable au moment meme ou on en aurait besoin (relances, recommandes).
// Un motif nomme se compte ; un commentaire, non. Le texte libre reste, mais
// EN PLUS d'un motif, jamais a sa place.
//
// POURQUOI CES SEPT-LA. Ils viennent du terrain de cette tournee -- EHPAD,
// SSIAD, cliniques -- et non d'une liste generique de messagerie. C'est un
// choix de vocabulaire metier : il se change en une ligne si Tom en veut
// d'autres, et rien d'autre dans le code ne depend de ces libelles.
//
// DECISION 10 DE THOMAS (24/09) : « Personne sur place » et « Etablissement
// ferme » decrivent une ABSENCE ; ils ne sont plus PROPOSES pour « Probleme »
// (`proposes`, ce que le dialogue du livreur montre). Ils restent ADMIS
// (`statutsAdmis`, ce que le serveur accepte) : un geste « Probleme / Personne
// sur place » fait hors ligne avant la mise a jour, et rejoue ensuite par la
// file, ne doit pas etre refuse.
const MOTIFS_PROBLEME = new Map([
  ["absent", { libelle: "Personne sur place", statutsAdmis: ["absent", "probleme", "a_reprogrammer"], proposes: ["absent", "a_reprogrammer"] }],
  ["adresse", { libelle: "Adresse introuvable", statutsAdmis: ["probleme", "a_reprogrammer"] }],
  ["acces", { libelle: "Accès impossible (portail, code, étage)", statutsAdmis: ["probleme", "a_reprogrammer"] }],
  ["ferme", { libelle: "Établissement fermé", statutsAdmis: ["absent", "probleme", "a_reprogrammer"], proposes: ["absent", "a_reprogrammer"] }],
  ["refus", { libelle: "Commande refusée", statutsAdmis: ["probleme", "a_reprogrammer"] }],
  ["produit", { libelle: "Produit manquant ou abîmé", statutsAdmis: ["probleme", "a_reprogrammer"] }],
  ["autre", { libelle: "Autre", statutsAdmis: ["absent", "probleme", "a_reprogrammer"] }]
]);

/** Les statuts d'arret qui exigent qu'on dise POURQUOI. */
const STATUTS_EN_ECHEC = new Set(["absent", "probleme", "a_reprogrammer"]);

/**
 * Compose ce qui sera archive comme cause. Le motif porte le sens, le
 * commentaire libre porte le detail -- dans cet ordre, parce que c'est le motif
 * qui se compte.
 */
function composerMotif(cle, commentaire) {
  const motif = MOTIFS_PROBLEME.get(cle);
  if (!motif) return "";
  const detail = clean(commentaire || "");
  return detail ? `${motif.libelle} — ${detail}` : motif.libelle;
}
const CORE_SECTORS = ["Besancon", "Champagnole", "Dole"];
const CRM_STATUSES = new Set(["prospect", "client_actif", "client_a_relancer", "client_inactif"]);
const RELANCE_STATUSES = new Set(["a_faire", "fait", "reporte", "annule"]);

ensureDir(path.dirname(DB_PATH));
ensureDir(path.dirname(SQLITE_PATH));
ensureDir(UPLOAD_DIR);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: 1
  },
  fileFilter(req, file, cb) {
    const extension = path.extname(file.originalname || "").toLowerCase();

    if (!ACCEPTED_EXCEL_EXTENSIONS.includes(extension)) {
      cb(badRequest("Seuls les fichiers Excel .xlsx sont acceptes"));
      return;
    }

    cb(null, true);
  }
});

app.disable("x-powered-by");
// Trust le 1er proxy (SWAG en prod, harmless en dev local).
// Permet a req.ip de retourner la vraie IP client via X-Forwarded-For, ce qui
// est indispensable pour que le rate limit s'applique par utilisateur et pas
// sur l'IP unique du reverse proxy.
app.set("trust proxy", 1);
app.use(securityHeaders);
// Compression des reponses texte (HTML, CSS, JS, JSON de l'API). Mesure du
// 23/09 : Node envoyait tout brut -- 750 Ko a chaque chargement (175 Ko une fois
// compresses), et le JSON des commandes grossit avec la base. Les formats deja
// compresses (polices, images, .xlsx) sont ecartes par le filtre par defaut.
app.use(compression());
app.use("/brand", express.static(path.join(__dirname, "public", "brand"), { immutable: true, maxAge: "1d" }));
// Les polices : la page de connexion les charge avant toute session. Rien de
// sensible (des fichiers de police libres, OFL).
// Pas d'« immutable » : les noms de fichiers n'ont pas d'empreinte.
app.use("/fonts", express.static(path.join(__dirname, "public", "fonts"), { maxAge: "7d" }));
app.get("/favicon.svg", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "favicon.svg"));
});
app.get("/healthz", (req, res) => {
  // Revue #4 : si la recovery storage a totalement echoue (disque plein, FS
  // read-only), le serveur ecoute mais sert 500 sur toutes les routes data.
  // On reflete cet etat zombie via un 503 pour que Docker/SWAG/sereo-updater
  // detectent le container comme non-sain (sinon il reste declare "healthy").
  if (storageRecoveryFatal) {
    return res.status(503).json({ ok: false, error: "storage indisponible (recovery echouee)" });
  }
  res.json({ ok: true });
});

// Endpoint /api/version expose la version courante + les release notes
// simplifiees pour le footer + modal version cote frontend.
// Place AVANT requireAccessAuth pour rester accessible sur /login aussi
// (la version n'est pas une info sensible et permet d'afficher le chip
// "v1.5.0" meme avant connexion).
app.get("/api/version", async (req, res) => {
  try {
    const cache = await fetchReleaseNotes(APP_VERSION);
    // no-store : le client ne doit JAMAIS cacher la version. Sinon apres un
    // auto-deploy le frontend affiche encore l'ancien numero pendant la
    // duree du cache. Le serveur lui-meme cache deja les release notes
    // GitHub 1h en RAM via releaseNotesCache, donc la perf reste OK.
    res.set("Cache-Control", "no-store, max-age=0");
    res.json({
      version: cache.version,
      releaseUrl: cache.releaseUrl,
      releaseName: cache.releaseName,
      publishedAt: cache.publishedAt,
      pourToi: cache.pourToi,
      fullNotes: cache.fullNotes,
      fetchedAt: cache.fetchedAt,
      fetchError: cache.fetchError,
      // available : derive de fetchError pour compat tests. true si on a
      // reussi a fetch les release notes depuis GitHub, false sinon.
      available: !cache.fetchError
    });
  } catch (e) {
    res.status(500).json({ error: "Version indisponible" });
  }
});
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.get("/login", renderLoginPage);
app.get("/login.js", (req, res) => {
  // Asset JS de la page login (countdown lockout). Servi avant requireAccessAuth
  // pour etre accessible sans authentification.
  res.sendFile(path.join(__dirname, "public", "login.js"));
});
// handleLogin est asynchrone depuis la phase 1 (scrypt). Express 4 n'attrape
// PAS le rejet d'un handler async : sans ce .catch, une erreur laisserait la
// requete pendante jusqu'au timeout et remonterait en unhandledRejection.
app.post("/login", (req, res) => {
  handleLogin(req, res).catch(error => {
    console.error("[auth] echec du traitement de la connexion :", error);
    if (res.headersSent) return;
    const next = getSafeRedirectTarget(req.body && req.body.next);
    res.redirect(303, `/login?error=1&next=${encodeURIComponent(next)}`);
  });
});
app.post("/logout", handleLogout);
app.use(requireAccessAuth);
app.use(express.json({ limit: "5mb" }));
app.use("/vendor/leaflet", express.static(LEAFLET_DIST, { immutable: true, maxAge: "7d" }));
// Le service worker, servi avec le nom de shell a empreinte (voir SHELL plus
// haut). « no-cache » : le navigateur revalide a chaque controle de mise a jour,
// comme pour le fichier statique qu'il remplace.
app.get("/service-worker.js", (req, res, next) => {
  if (!SHELL) return next();
  res.set("Content-Type", "application/javascript; charset=UTF-8");
  res.set("Cache-Control", "no-cache");
  res.send(SHELL.source);
});
app.use(express.static(path.join(__dirname, "public"), {
  // La page annonce le shell qu'elle attend : le service worker en place sert
  // les fichiers statiques depuis son cache, et s'il est plus vieux que la page,
  // il doit le savoir AVANT qu'elle demande ses scripts (public/service-worker.js).
  setHeaders(res, chemin) {
    if (path.basename(chemin) !== "index.html") return;
    if (SHELL_ANNONCE) res.setHeader("X-Sereo-Shell", SHELL_ANNONCE);
    const fin = finDeSessionConnue(res.req);
    if (fin !== null) res.setHeader("X-Sereo-Session-Fin", String(fin));
  }
}));

/**
 * Decision 4 (23/09) : jusqu'a quand la page de l'application peut etre
 * rouverte HORS LIGNE (ecran Tournee seulement, public/service-worker.js).
 * La fin de la session du cookie (emission + 12 h), jamais plus : hors ligne,
 * personne ne peut la prolonger. Rien n'est annonce (null : la page ne se
 * garde pas, et ne s'oublie pas non plus) quand il n'y a pas de session du
 * tout : authentification desactivee (developpement, bancs -- « sans session
 * valide connue, on ne montre rien »), ou acces par l'en-tete Basic, sans
 * cookie.
 */
function finDeSessionConnue(req, now = Date.now()) {
  const duree = AUTH_COOKIE_MAX_AGE_SECONDS * 1000;
  if (!isAccessAuthEnabled()) return null;
  const valeur = getAccessSessionCookie(req);
  if (!valeur || !isValidAccessSessionValue(valeur, now)) return null;
  const session = readAccessSession(valeur, now);
  return session ? session.issuedAt + duree : null;
}
app.use("/api", requireTrustedApiRequest);
// L'auteur des ecritures : voir auteurCourant (lot « donnees utiles », 24/09).
app.use("/api", (req, res, next) => contexteRequete.run(req, next));
app.use("/api", gesteIdempotent);

// --- UN GESTE RENVOYE N'EST APPLIQUE QU'UNE FOIS (lot 1 de l'audit geo) ------
//
// Depuis le 23/09, la page met en file TOUTE ecriture dont l'envoi echoue --
// delai depasse, reseau qui ne repond pas, passerelle 502/503/504 -- et plus
// seulement quand le telephone se declare hors ligne (H1). Or un delai depasse
// peut signifier que le serveur a RECU et APPLIQUE l'ecriture : la renvoyer
// creerait une commande terrain ou une tournee en double. D'ou cette cle :
// chaque ecriture porte X-Sereo-Geste (un identifiant tire par la page, garde
// dans la file) ; une cle deja vue rend le statut de la premiere reponse, sans
// rien reappliquer. Une cle en cours de traitement fait attendre la seconde.
// Duree de memoire : GESTES_MEMOIRE_JOURS, au-dela de la borne d'age d'un
// geste (GESTE_AGE_MAX_JOURS). En stockage JSON (migration seulement) : en
// memoire, perdu au redemarrage.
const ENTETE_GESTE = "x-sereo-geste";
const CLE_GESTE_VALIDE = /^[A-Za-z0-9_-]{8,100}$/;
const GESTES_MEMOIRE_JOURS = 14;
const gestesEnCours = new Map();
const gestesRecusEnMemoire = new Map();

function lireGesteRecu(cle) {
  if (useSqliteStorage()) return getSqliteStore().getGesteRecu(cle);
  return gestesRecusEnMemoire.get(cle) || null;
}

function enregistrerGesteRecu(entree) {
  const oublierAvant = new Date(Date.now() - GESTES_MEMOIRE_JOURS * 24 * 3600 * 1000).toISOString();
  if (useSqliteStorage()) {
    getSqliteStore().saveGesteRecu(entree, oublierAvant);
    return;
  }
  gestesRecusEnMemoire.set(entree.cle, entree);
}

function gesteIdempotent(req, res, next) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const cle = String(req.get(ENTETE_GESTE) || "");
  if (!CLE_GESTE_VALIDE.test(cle)) return next();
  const chemin = req.originalUrl;

  const repondreDejaFait = connu => {
    if (connu.methode !== req.method || connu.chemin !== chemin) {
      res.status(409).json({ error: "Cette clé de geste a déjà servi pour une autre écriture." });
      return;
    }
    res.set("X-Sereo-Geste-Rejoue", "1");
    res.status(connu.statut).json({ rejoue: true });
  };

  let connu = null;
  try { connu = lireGesteRecu(cle); } catch { connu = null; }
  if (connu) return repondreDejaFait(connu);

  const enCours = gestesEnCours.get(cle);
  if (enCours) {
    enCours.then(() => {
      let fini = null;
      try { fini = lireGesteRecu(cle); } catch { fini = null; }
      if (fini) repondreDejaFait(fini);
      else next();
    });
    return;
  }

  let liberer;
  gestesEnCours.set(cle, new Promise(resolve => { liberer = resolve; }));
  let note = false;
  const noter = () => {
    if (note) return;
    note = true;
    // Un 5xx n'est pas une reponse definitive : le renvoi doit pouvoir reessayer.
    // Une QUESTION non plus (relecture adverse du 26/09) : le 409 « une fiche
    // existe deja » n'applique rien, et la file renvoie la REPONSE (« nouvelle
    // fiche ») sous la meme cle quand ce 409 s'est perdu en route. Lui rendre
    // le 409 enregistre, sans lire son corps, la faisait abandonner : commande
    // perdue. `res.locals.gesteSansEffet` : pose par handleRouteError.
    if (res.statusCode < 500 && !res.locals.gesteSansEffet) {
      try {
        enregistrerGesteRecu({ cle, methode: req.method, chemin, statut: res.statusCode, recuLe: new Date().toISOString() });
      } catch (error) {
        console.warn("[geste] cle d'idempotence non enregistree :", error.message);
      }
    }
  };
  // Enregistree AVANT l'envoi de la reponse : un renvoi qui arrive pendant que
  // la premiere reponse part trouve deja la cle.
  const envoyer = res.send.bind(res);
  res.send = corps => { noter(); return envoyer(corps); };
  // La cle se LIBERE quand le traitement a fini (sa reponse est ecrite), pas
  // quand la connexion se ferme (relecture adverse du lot 1). Premier jet :
  // `res.on("close")`. Or un client qui abandonne (delai de 10 s, renvoi coupe
  // a 15 s) ferme la connexion PENDANT le traitement : la cle partait, le
  // geste passait en file, et son renvoi -- ne trouvant ni cle enregistree ni
  // traitement en cours -- s'appliquait une seconde fois (commande terrain en
  // double). Une connexion fermee sans reponse garde la cle jusqu'a la fin
  // du traitement ; un filet la libere si le traitement ne finit jamais.
  let libere = false;
  const finir = () => {
    if (libere) return;
    libere = true;
    gestesEnCours.delete(cle);
    liberer();
  };
  const terminer = res.end.bind(res);
  res.end = (...args) => {
    noter();
    const retour = terminer(...args);
    finir();
    return retour;
  };
  res.on("close", () => {
    if (res.writableEnded) { finir(); return; }
    const filet = setTimeout(finir, GESTE_EN_COURS_MAX_MS);
    if (filet.unref) filet.unref();
  });
  next();
}
// Au-dela, un traitement qui n'a jamais repondu ne retient plus sa cle.
const GESTE_EN_COURS_MAX_MS = 3 * 60_000;

function cleanEnv(value) {
  return String(value ?? "").trim();
}

// ============================================================================
// Rate limit auth (en memoire, par IP)
// ============================================================================
// State : Map<ip, { failedTimestamps: number[], lockedUntil: number | null }>
// Volontairement en memoire process : l'app est mono-instance (sereo container
// unique). Les tentatives ratees sont oubliees au redemarrage, ce qui est
// acceptable car (a) un attaquant qui force redemarrage n'est pas notre
// modele de menace, (b) un utilisateur legitime n'attend que 15 min pour
// reset naturel via la fenetre glissante.
const authRateLimitState = new Map();

function getAuthRateLimitStatus(ip, now) {
  const time = now || Date.now();
  const entry = authRateLimitState.get(ip);
  if (!entry) {
    return { attempts: 0, remaining: AUTH_RATE_LIMIT_MAX_ATTEMPTS, locked: false, remainingMs: 0 };
  }
  const cutoff = time - AUTH_RATE_LIMIT_WINDOW_MS;
  entry.failedTimestamps = entry.failedTimestamps.filter(t => t > cutoff);
  if (entry.lockedUntil && entry.lockedUntil > time) {
    return {
      attempts: entry.failedTimestamps.length,
      remaining: 0,
      locked: true,
      remainingMs: entry.lockedUntil - time,
      lockedUntil: entry.lockedUntil
    };
  }
  if (entry.lockedUntil && entry.lockedUntil <= time) {
    // Le lockout vient de finir : on reset le compteur pour que l'utilisateur
    // reparte sur 5 tentatives fraiches.
    entry.failedTimestamps = [];
    entry.lockedUntil = null;
  }
  return {
    attempts: entry.failedTimestamps.length,
    remaining: Math.max(0, AUTH_RATE_LIMIT_MAX_ATTEMPTS - entry.failedTimestamps.length),
    locked: false,
    remainingMs: 0
  };
}

function recordAuthFailure(ip, now) {
  const time = now || Date.now();
  let entry = authRateLimitState.get(ip);
  if (!entry) {
    entry = { failedTimestamps: [], lockedUntil: null };
    authRateLimitState.set(ip, entry);
  }
  const cutoff = time - AUTH_RATE_LIMIT_WINDOW_MS;
  entry.failedTimestamps = entry.failedTimestamps.filter(t => t > cutoff);
  entry.failedTimestamps.push(time);
  if (entry.failedTimestamps.length >= AUTH_RATE_LIMIT_MAX_ATTEMPTS) {
    entry.lockedUntil = time + AUTH_RATE_LIMIT_LOCKOUT_MS;
  }
  return getAuthRateLimitStatus(ip, time);
}

function clearAuthFailures(ip) {
  authRateLimitState.delete(ip);
}

// Garde-fous (25/09) : une limite PAR COMPTE, en plus de celle par adresse.
// Celle par adresse (5 echecs, 15 s de blocage, compteur remis a zero ensuite)
// laissait ~20 essais par minute et par adresse, sans aucune limite pour un
// compte vise depuis de nombreuses adresses (chasse aux defauts, section 3).
// Ici : AUTH_COMPTE_MAX_ATTEMPTS echecs sur un meme identifiant saisi, dans la
// fenetre, bloquent CET identifiant AUTH_COMPTE_LOCKOUT_MS -- les autres
// comptes ne sont pas touches. L'identifiant se compte sans casse ni espaces,
// qu'il existe ou non (rien a enumerer). Le compteur n'est PAS remis a zero a
// la fin du blocage : une attaque qui continue est rebloquee au premier echec
// suivant ; une connexion reussie l'efface.
// Relecture adverse du 26/09 : ce blocage refusait AUSSI le bon mot de passe,
// sur tous les appareils. Un tiers qui connait l'identifiant de Thomas le
// tenait dehors aussi longtemps qu'il le voulait (un echec toutes les 15 min) ;
// un navigateur qui rejoue un vieux mot de passe Basic apres un changement de
// SEREO_AUTH_PASSWORD faisait de meme, sans attaquant. D'ou l'« appareil
// connu » (ci-dessous) : un appareil qui a deja ouvert CE compte n'est ni
// bloque ni compte par sa limite -- il garde la seule limite par adresse,
// celle d'avant le 25/09. La limite du compte ne vise plus que les appareils
// inconnus, ceux d'une attaque repartie. Reste : un appareil NEUF de Thomas
// attend la fin du blocage pendant une attaque (la page le dit).
const AUTH_COMPTE_MAX_ATTEMPTS = Math.max(1, Number(process.env.SEREO_AUTH_MAX_ATTEMPTS_COMPTE) || 20);
const AUTH_COMPTE_WINDOW_MS = Math.max(1000, Number(process.env.SEREO_AUTH_RATE_WINDOW_COMPTE_MS) || 60 * 60 * 1000);
const AUTH_COMPTE_LOCKOUT_MS = Math.max(1000, Number(process.env.SEREO_AUTH_LOCKOUT_COMPTE_MS) || 15 * 60 * 1000);
const authCompteState = new Map();

function cleDeCompte(identifiant) {
  return String(identifiant ?? "").trim().toLowerCase().slice(0, 120);
}

function statutDuCompte(identifiant, now = Date.now()) {
  const entree = authCompteState.get(cleDeCompte(identifiant));
  if (!entree) return { locked: false, remainingMs: 0 };
  entree.failedTimestamps = entree.failedTimestamps.filter(t => t > now - AUTH_COMPTE_WINDOW_MS);
  if (entree.lockedUntil && entree.lockedUntil > now) {
    return { locked: true, remainingMs: entree.lockedUntil - now, lockedUntil: entree.lockedUntil };
  }
  return { locked: false, remainingMs: 0 };
}

function echecDuCompte(identifiant, now = Date.now()) {
  const cle = cleDeCompte(identifiant);
  let entree = authCompteState.get(cle);
  if (!entree) {
    entree = { failedTimestamps: [], lockedUntil: null };
    authCompteState.set(cle, entree);
  }
  entree.failedTimestamps = entree.failedTimestamps.filter(t => t > now - AUTH_COMPTE_WINDOW_MS);
  entree.failedTimestamps.push(now);
  if (entree.failedTimestamps.length >= AUTH_COMPTE_MAX_ATTEMPTS) entree.lockedUntil = now + AUTH_COMPTE_LOCKOUT_MS;
  return statutDuCompte(identifiant, now);
}

function effacerEchecsDuCompte(identifiant) {
  authCompteState.delete(cleDeCompte(identifiant));
}

// L'« appareil connu » (relecture du 26/09 ; le « device cookie » de l'OWASP).
// Une connexion reussie laisse au navigateur un cookie signe : « cet appareil a
// su le mot de passe de ce compte ». Il porte l'empreinte des comptes ouverts
// (au plus 8 : un poste partage), jamais leur nom, et sa date ; il vaut 180
// jours apres la derniere connexion reussie. Signe avec la base du secret de
// session SANS le mot de passe d'environnement : apres un changement de
// SEREO_AUTH_PASSWORD, les appareils de Thomas restent connus -- c'est
// justement quand un vieux mot de passe rejoue ferait bloquer le compte.
// « Se deconnecter » ne l'efface pas : ce n'est pas une session, il n'ouvre
// rien ; il n'exempte que de la limite par compte.
const APPAREIL_COOKIE_NAME = "sereo_appareil";
const APPAREIL_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const APPAREIL_COMPTES_MAX = 8;

function signerAppareil(charge) {
  return crypto.createHmac("sha256", `${AUTH_SESSION_SECRET_BASE}|appareil`).update(charge).digest("base64url");
}

function empreinteDeCompte(identifiant) {
  return crypto.createHash("sha256").update(cleDeCompte(identifiant)).digest("base64url").slice(0, 16);
}

// Les empreintes des comptes que CET appareil a ouverts ; [] si le cookie
// manque, est altere ou trop vieux.
function comptesDeLAppareil(req, now = Date.now()) {
  const valeur = String(parseCookies(req.get("cookie"))[APPAREIL_COOKIE_NAME] || "");
  const point = valeur.lastIndexOf(".");
  if (point <= 0) return [];
  const charge = valeur.slice(0, point);
  if (!constantTimeEqual(valeur.slice(point + 1), signerAppareil(charge))) return [];
  try {
    const { c, t } = JSON.parse(Buffer.from(charge, "base64url").toString("utf8"));
    if (!Array.isArray(c) || !(Number(t) > now - APPAREIL_MAX_AGE_SECONDS * 1000)) return [];
    return c.map(String);
  } catch {
    return [];
  }
}

function appareilConnuDuCompte(req, identifiant) {
  return Boolean(cleDeCompte(identifiant)) && comptesDeLAppareil(req).includes(empreinteDeCompte(identifiant));
}

// Le cookie a poser apres une connexion reussie : ce compte en tete, puis ceux
// que l'appareil connaissait deja.
function cookieAppareil(req, identifiant) {
  const empreinte = empreinteDeCompte(identifiant);
  const comptes = [empreinte, ...comptesDeLAppareil(req).filter(c => c !== empreinte)].slice(0, APPAREIL_COMPTES_MAX);
  const charge = Buffer.from(JSON.stringify({ c: comptes, t: Date.now() })).toString("base64url");
  const parts = [`${APPAREIL_COOKIE_NAME}=${charge}.${signerAppareil(charge)}`, "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${APPAREIL_MAX_AGE_SECONDS}`];
  if (req.secure || req.get("x-forwarded-proto") === "https") parts.push("Secure");
  return parts.join("; ");
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Nettoyage periodique pour eviter une croissance non bornee de la Map.
// Tourne toutes les 5 min, supprime les IPs sans tentative recente ni lockout actif.
const authRateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  const cutoff = now - AUTH_RATE_LIMIT_WINDOW_MS;
  for (const [ip, entry] of authRateLimitState.entries()) {
    const recentFailures = entry.failedTimestamps.some(t => t > cutoff);
    const stillLocked = entry.lockedUntil && entry.lockedUntil > now;
    if (!recentFailures && !stillLocked) {
      authRateLimitState.delete(ip);
    }
  }
  for (const [cle, entree] of authCompteState.entries()) {
    const recents = entree.failedTimestamps.some(t => t > now - AUTH_COMPTE_WINDOW_MS);
    const bloque = entree.lockedUntil && entree.lockedUntil > now;
    if (!recents && !bloque) authCompteState.delete(cle);
  }
}, 5 * 60 * 1000);
authRateLimitCleanupInterval.unref();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  });
}

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      // L'hote des tuiles vient de lib/fond-de-carte.js, le MEME que celui que
      // la page recoit par /api/carte/fond (lot 4 de l'audit geo, 23/09). Il
      // etait ecrit ici en dur, en double de app.js : changer de fournisseur
      // d'un seul cote donnait une carte vide, sans erreur remontee. Un joker
      // CSP `*.exemple.org` ne couvre pas `exemple.org` : le module rend
      // l'hote exact, ou le joker quand le gabarit porte {s}.
      `img-src 'self' data: ${fondDeCarte().origineCsp}`,
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join("; ")
  );
  next();
}

function isEnvAuthConfigured() {
  return Boolean(AUTH_USER && AUTH_PASSWORD);
}

// Garde-fous (25/09) : le mot de passe d'environnement n'avait aucune longueur
// minimale (celui de production faisait 5 lettres ; les comptes en base en
// exigent MIN_PASSWORD_LENGTH = 10). En dessous de 12 caracteres : un
// avertissement au journal du demarrage, et un bandeau pour l'administrateur
// (/api/me). JAMAIS un refus de demarrer : il verrouillerait Thomas hors de son
// application apres la mise a jour, sans moyen de corriger depuis l'ecran.
const MOT_DE_PASSE_ENVIRONNEMENT_MIN = 12;

function motDePasseEnvironnementCourt() {
  return isEnvAuthConfigured() && AUTH_PASSWORD.length < MOT_DE_PASSE_ENVIRONNEMENT_MIN;
}

// Le mot de passe et sa longueur ne sont jamais ecrits.
function avertirMotDePasseCourt() {
  if (!motDePasseEnvironnementCourt()) return;
  console.warn(
    `[auth] SEREO_AUTH_PASSWORD fait moins de ${MOT_DE_PASSE_ENVIRONNEMENT_MIN} caracteres : `
    + "le changer sur le serveur (20 caracteres aleatoires ou plus ; cela ferme aussi toutes les sessions). "
    + "Le serveur demarre quand meme."
  );
}

/**
 * Existe-t-il au moins un compte actif en base ?
 *
 * Enveloppe dans un try/catch parce que cette fonction est appelee sur le
 * chemin d'authentification, donc avant /login — et que le stockage peut etre
 * indisponible (recovery de corruption en cours, mode JSON legacy). Dans ce
 * cas on retombe sur la seule protection par variables d'environnement plutot
 * que de renvoyer 500 sur la page de connexion.
 */
function hasActiveUsers() {
  if (!useSqliteStorage()) return false;
  try {
    return getSqliteStore().countUsers() > 0;
  } catch {
    return false;
  }
}

function isAccessAuthEnabled() {
  return isEnvAuthConfigured() || hasActiveUsers();
}

function isAccessAuthMisconfigured() {
  // Un seul des deux couples d'env vars renseigne reste une erreur de config,
  // independamment des comptes en base.
  return Boolean(AUTH_USER || AUTH_PASSWORD) && !isEnvAuthConfigured();
}

/**
 * Identite associee a une requete authentifiee, ou null.
 *
 * Le role est relu en base a CHAQUE requete plutot que porte par le cookie :
 * ainsi desactiver un compte ou changer son role prend effet immediatement,
 * au lieu d'attendre l'expiration de la session (12 h).
 */
function getRequestIdentity(req) {
  if (!isAccessAuthEnabled()) {
    // Auth desactivee (dev) : tout le monde est administrateur, comme avant.
    return { identifiant: "dev", role: "admin", uid: null, source: "desactivee" };
  }

  const session = readAccessSession(getAccessSessionCookie(req));
  if (session) {
    if (session.uid) {
      const user = lookupActiveUser(session.uid);
      return user
        ? { identifiant: user.identifiant, role: user.role, uid: user.id, source: "compte" }
        : null;
    }
    return { identifiant: AUTH_USER, role: "admin", uid: null, source: "environnement" };
  }

  // Authentification Basic : reservee au couple d'environnement (cf.
  // isAuthorizedRequest). Elle donne donc toujours le role administrateur.
  const credentials = parseBasicAuthHeader(req.get("authorization"));
  if (
    credentials
    && isEnvAuthConfigured()
    && constantTimeEqual(credentials.username, AUTH_USER)
    && constantTimeEqual(credentials.password, AUTH_PASSWORD)
  ) {
    return { identifiant: AUTH_USER, role: "admin", uid: null, source: "basic" };
  }

  return null;
}

function lookupActiveUser(id) {
  if (!useSqliteStorage()) return null;
  try {
    const user = getSqliteStore().getUser(id);
    return user && user.actif ? user : null;
  } catch {
    return null;
  }
}

// --- Service des comptes (V8 phase 1) --------------------------------------
//
// Couche metier entre les endpoints d'administration et le store : c'est ici
// que vivent les validations, pour qu'un compte cree par un test, par l'API ou
// par un script d'amorcage obeisse exactement aux memes regles.

const MIN_PASSWORD_LENGTH = 10;
const MIN_LOGIN_LENGTH = 3;
const MAX_LOGIN_LENGTH = 60;

function normalizeLogin(value) {
  return String(value ?? "").trim();
}

function assertValidLogin(identifiant) {
  if (identifiant.length < MIN_LOGIN_LENGTH || identifiant.length > MAX_LOGIN_LENGTH) {
    throw badRequest(
      `L'identifiant doit faire entre ${MIN_LOGIN_LENGTH} et ${MAX_LOGIN_LENGTH} caracteres.`
    );
  }
  // Espaces et deux-points interdits : le deux-points est le separateur de
  // l'authentification Basic, un identifiant en contenant serait ambigu.
  if (/[\s:]/.test(identifiant)) {
    throw badRequest("L'identifiant ne doit contenir ni espace ni deux-points.");
  }
}

function assertValidPassword(motDePasse) {
  if (String(motDePasse ?? "").length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
}

function assertUsersSupported() {
  if (!useSqliteStorage()) {
    throw badRequest("Les comptes utilisateurs necessitent le stockage SQLite.");
  }
}

async function createUserAccount({ identifiant, motDePasse, role, actif = true }) {
  assertUsersSupported();

  const login = normalizeLogin(identifiant);
  assertValidLogin(login);
  assertValidPassword(motDePasse);

  if (!isKnownRole(role)) {
    throw badRequest(`Role inconnu : ${role}. Roles valides : ${Object.keys(ROLES).join(", ")}.`);
  }

  const store = getSqliteStore();
  if (store.findUserForAuth(login)) {
    throw badRequest("Un compte porte deja cet identifiant.");
  }

  const sel = generatePasswordSalt();
  const compte = {
    id: crypto.randomUUID(),
    identifiant: login,
    hash: await hashPassword(motDePasse, sel),
    sel,
    role: String(role),
    actif: Boolean(actif),
    creeLe: new Date().toISOString()
  };

  store.saveUser(compte);
  return store.getUser(compte.id);
}

/**
 * Met a jour un compte. Seuls les champs fournis sont modifies ; le mot de
 * passe n'est re-hashe que s'il est explicitement transmis.
 */
async function updateUserAccount(id, { role, actif, motDePasse } = {}) {
  assertUsersSupported();

  const store = getSqliteStore();
  const existant = store.getUser(id);
  if (!existant) throw notFound("Compte introuvable.");

  const courant = store.findUserForAuth(existant.identifiant);
  let hash = courant.hash;
  let sel = courant.sel;

  if (motDePasse !== undefined) {
    assertValidPassword(motDePasse);
    sel = generatePasswordSalt();
    hash = await hashPassword(motDePasse, sel);
  }

  if (role !== undefined && !isKnownRole(role)) {
    throw badRequest(`Role inconnu : ${role}.`);
  }

  const cible = {
    id: existant.id,
    identifiant: existant.identifiant,
    hash,
    sel,
    role: role === undefined ? existant.role : String(role),
    actif: actif === undefined ? existant.actif : Boolean(actif),
    creeLe: existant.creeLe,
    derniereConnexion: existant.derniereConnexion
  };

  assertLastAdminRemains(store, cible);
  store.saveUser(cible);
  // Garde-fous (25/09) : un mot de passe change ferme les sessions ouvertes
  // avec l'ancien (un telephone perdu, un cookie copie).
  if (motDePasse !== undefined) fermerSessionsDuCompte(existant.id);
  return store.getUser(id);
}

function deleteUserAccount(id) {
  assertUsersSupported();

  const store = getSqliteStore();
  const existant = store.getUser(id);
  if (!existant) throw notFound("Compte introuvable.");

  assertLastAdminRemains(store, { ...existant, supprime: true });
  return store.deleteUser(id);
}

/**
 * Empeche de supprimer, desactiver ou retrograder le dernier administrateur
 * actif quand aucune protection par variables d'environnement n'existe.
 *
 * Sans cette garde, retirer son propre role admin verrouillerait definitivement
 * l'administration de l'application, sans aucun moyen de revenir en arriere
 * depuis l'interface.
 */
function assertLastAdminRemains(store, cible) {
  if (isEnvAuthConfigured()) return; // Le compte d'environnement reste admin.

  const restants = store
    .listUsers()
    .filter(user => user.id !== cible.id)
    .filter(user => user.actif && getRole(user.role).administration);

  if (restants.length > 0) return;

  const cibleResteAdmin =
    !cible.supprime && cible.actif && getRole(cible.role).administration;

  if (!cibleResteAdmin) {
    throw badRequest(
      "Impossible : ce compte est le dernier administrateur actif. "
        + "Nommer un autre administrateur avant de le modifier."
    );
  }
}

function listUserAccounts() {
  assertUsersSupported();
  return getSqliteStore().listUsers();
}

// --- Geocodage des adresses (V8 phase 2) -----------------------------------
//
// Le geocodage passe OBLIGATOIREMENT par le serveur : la CSP declare
// `connect-src 'self'`, donc le navigateur ne peut appeler aucune API externe.
// Ce n'est pas une contrainte subie, c'est la bonne architecture — on geocode
// une fois, on met en cache, et on ne rappelle jamais l'API pour une adresse
// deja connue.
//
// Service utilise : la Base Adresse Nationale (api-adresse.data.gouv.fr),
// gratuite, sans cle, et conçue pour les adresses francaises. L'URL est
// configurable pour que les tests puissent pointer un faux serveur local :
// le projet n'a aucune bibliotheque de simulation reseau.

// L'URL, le seuil, la requete, le User-Agent et le nettoyage des adresses
// vivent dans lib/geocodage.js, partage avec le calcul de tournee (lot 3 de
// l'audit geo, 23/09). Ici : le cache SQLite, le lot de fond, et ce qu'une
// position fait aux clients et a leurs commandes.

// La BAN tolere une cadence elevee, mais rien ne presse : un import se geocode
// en tache de fond. Cet intervalle evite d'etre pris pour un robot abusif.
const GEOCODER_INTERVALLE_MS = Number(process.env.SEREO_GEOCODER_INTERVALLE_MS || 120);

// Plafond par lancement : evite qu'une base anormalement grosse ne parte en
// boucle de plusieurs heures sans qu'on s'en apercoive.
const GEOCODER_MAX_PAR_LOT = Number(process.env.SEREO_GEOCODER_MAX_PAR_LOT || 300);

const GEOCODAGE_STATUTS = geocodage.STATUTS;
const cleGeocodage = geocodage.cleGeocodage;
const adresseGeocodable = geocodage.adresseGeocodable;
const qualifierResultat = geocodage.qualifierResultat;

/**
 * Premiere coordonnee reellement renseignee.
 *
 * Remplace l'idiome `a ?? b ?? ""`, faux ici : dans tout le projet une
 * coordonnee absente vaut la chaine vide et non null, et `??` ne se declenche
 * pas dessus. Une valeur numerique 0 reste evidemment valide — d'ou le test
 * explicite sur "" plutot qu'un test de veracite.
 */
function premiereCoordonnee(...valeurs) {
  for (const valeur of valeurs) {
    if (valeur === null || valeur === undefined || valeur === "") continue;
    return valeur;
  }
  return "";
}

/**
 * Geocode une adresse, en passant par le cache.
 *
 * `forcer` ignore le cache. Un rejet (introuvable, ambigu) n'est plus garde a
 * vie : il est redemande apres geocodage.DUREE_REJET_JOURS jours. L'entree
 * rendue porte `reseau: true` quand la BAN a vraiment ete appelee (le lot ne
 * s'impose une pause qu'apres un vrai appel).
 */
async function geocoderAdresse(adresse, { forcer = false } = {}) {
  if (!adresseGeocodable(adresse)) return null;
  if (!useSqliteStorage()) {
    // Stockage JSON : pas de table de cache, mais la tournee doit toujours
    // geocoder (avant le lot, routing.geocode le faisait sans condition ;
    // rendre null ici la refusait pour « adresse incomplete », relecture du
    // lot 3). Le lot de fond, lui, reste reserve a SQLite.
    const resultat = await geocodage.interroger(adresse);
    return { ...resultat, cle: cleGeocodage(adresse), precision: geocodage.precisionDuType(resultat.type), reseau: true };
  }

  const cle = cleGeocodage(adresse);
  const store = getSqliteStore();

  if (!forcer) {
    const enCache = store.getGeocodage(cle);
    if (geocodage.entreeCacheValide(enCache)) {
      return { ...enCache, precision: geocodage.precisionDuType(enCache.type), reseau: false };
    }
  }

  const resultat = await geocodage.interroger(adresse);

  const entree = {
    cle,
    requete: resultat.requete,
    lat: resultat.lat ?? null,
    lng: resultat.lng ?? null,
    score: resultat.score ?? null,
    libelle: resultat.libelle || null,
    type: resultat.type || null,
    statut: resultat.statut,
    source: "ban",
    misAJourLe: new Date().toISOString()
  };

  store.saveGeocodage(entree);
  return { ...entree, precision: geocodage.precisionDuType(entree.type), reseau: true };
}

/** Adresse d'un client, sous la forme attendue par le geocodeur. */
function adresseDuClient(client) {
  return {
    rue: client.rue || client.adresse || "",
    codePostal: client.codePostal || "",
    ville: client.ville || ""
  };
}

/** Adresse de livraison d'une commande. */
function adresseDeLaCommande(order) {
  return {
    rue: order.address || "",
    codePostal: order.postalCode || "",
    ville: order.city || ""
  };
}

const STATUTS_COMMANDE_CLOSE = new Set(["livre", "annulee"]);

/**
 * Une commande "suit" l'adresse de son client quand elle n'est ni livree ni
 * annulee, et qu'elle se livre a cette adresse (meme cle) ou n'en a aucune.
 * Une commande livree AILLEURS (EHPAD, proche) ne suit pas : decision 8.
 * `cleClient` permet de comparer a l'ANCIENNE adresse lors d'un demenagement.
 */
function commandeSuitLeClient(order, client, cleClient = cleGeocodage(adresseDuClient(client))) {
  if (String(order.clientId) !== String(client.id)) return false;
  if (STATUTS_COMMANDE_CLOSE.has(order.status)) return false;
  if (!clean(order.address)) return true;
  return cleGeocodage(adresseDeLaCommande(order)) === cleClient;
}

/**
 * Pose une position sur le client et sur les commandes qui le suivent.
 *
 * `position` : { lat, lng, source: "manuel"|"ban"|"calcul"|"import",
 * precision, libelle }. Une commande dont la position a ete placee a la main
 * (geoSource "manuel") garde la sienne. Rend le nombre de commandes touchees.
 */
function appliquerPositionClient(db, client, position) {
  const cle = cleGeocodage(adresseDuClient(client));
  const vide = position.lat === "" || position.lat === null || position.lat === undefined;
  client.lat = vide ? "" : Number(position.lat);
  client.lng = vide ? "" : Number(position.lng);
  client.geoSource = vide ? "" : clean(position.source);
  client.geoPrecision = vide ? "" : clean(position.precision);
  client.geoLibelle = vide ? "" : clean(position.libelle);
  client.geoCle = vide ? "" : cle;
  client.geoAVerifier = "";
  client.geoMajLe = new Date().toISOString();

  let touchees = 0;
  for (const order of db.commandes) {
    if (!commandeSuitLeClient(order, client, cle)) continue;
    if (order.geoSource === "manuel" && position.source !== "manuel") continue;
    order.lat = client.lat;
    order.lng = client.lng;
    order.geoPrecision = client.geoPrecision;
    order.geoSource = client.geoSource ? "client" : "";
    order.updatedAt = new Date().toISOString();
    touchees += 1;
  }
  return touchees;
}

/**
 * H6 : une commande nee dans l'application herite de la position de son
 * client quand elle se livre a son adresse. Avant, elle naissait sans
 * position, et le calcul de tournee repartait du texte : refus complet, ou
 * point du geocodeur a la place d'une correction faite a la main.
 */
function heriterPositionDuClient(order, client) {
  if (!client || !order) return order;
  if (getCoordinates(order)) return order;
  if (!getCoordinates(client)) return order;
  if (!commandeSuitLeClient(order, client)) return order;
  order.lat = client.lat;
  order.lng = client.lng;
  order.geoPrecision = client.geoPrecision || "";
  order.geoSource = "client";
  return order;
}

/**
 * H5, H12 et decision 8 : ce que le changement d'adresse d'un client fait.
 *
 * - Sa position devient fausse : effacee (le lot de fond la recalcule), SAUF
 *   une position placee a la main, gardee mais marquee "a verifier" (elle
 *   corrigeait peut-etre un lieu-dit que la BAN ignore).
 * - Ses commandes non livrees qui se livraient a l'ANCIENNE adresse suivent la
 *   nouvelle ; celles livrees ailleurs (EHPAD, proche) et celles deja livrees
 *   ne bougent pas.
 *
 * `avant` : l'adresse du client AVANT la modification. Rend le nombre de
 * commandes deplacees.
 */
function demenagerClient(db, client, avant) {
  const cleAvant = cleGeocodage(avant);
  const cleApres = cleGeocodage(adresseDuClient(client));
  const suivent = db.commandes.filter(order => commandeSuitLeClient(order, client, cleAvant));

  if (cleAvant === cleApres) {
    // Meme voie, autre ecriture : un complement change ("Apt 12" -> "Apt 14"),
    // la casse, une virgule. La position reste juste, mais le livreur lit le
    // TEXTE de la commande : il suit (relecture du lot 3).
    const apres = adresseDuClient(client);
    const memeTexte = ["rue", "codePostal", "ville"].every(champ => clean(avant[champ]) === clean(apres[champ]));
    if (memeTexte) return { demenage: false, commandes: 0 };
    let touchees = 0;
    for (const order of suivent) {
      if (clean(order.address) === clean(apres.rue) && clean(order.postalCode) === clean(apres.codePostal)
        && clean(order.city) === clean(apres.ville)) continue;
      order.address = apres.rue;
      order.postalCode = apres.codePostal;
      order.city = apres.ville;
      order.updatedAt = new Date().toISOString();
      touchees += 1;
    }
    return { demenage: false, commandes: touchees };
  }

  if (client.geoSource === "manuel" && getCoordinates(client)) {
    client.geoAVerifier = "adresse-modifiee";
  } else {
    client.lat = "";
    client.lng = "";
    client.geoSource = "";
    client.geoPrecision = "";
    client.geoLibelle = "";
    client.geoCle = "";
    client.geoAVerifier = "";
  }

  const now = new Date().toISOString();
  for (const order of suivent) {
    order.address = client.rue;
    order.postalCode = client.codePostal;
    order.city = client.ville;
    order.sector = client.secteur || order.sector;
    // La position de l'ancienne adresse ne vaut plus rien pour la nouvelle :
    // la commande prend celle du client (effacee, ou manuelle a verifier).
    order.lat = client.lat;
    order.lng = client.lng;
    order.geoPrecision = client.geoPrecision || "";
    order.geoSource = getCoordinates(client) ? "client" : "";
    order.updatedAt = now;
  }
  return { demenage: true, commandes: suivent.length };
}

/**
 * La position d'une commande pour le calcul de tournee : la sienne, sinon
 * celle du client quand elle se livre a son adresse. Rend une COPIE : l'appel
 * se fait hors verrou, sur un instantane.
 */
function positionPourTournee(db, order) {
  const copie = { ...order };
  if (getCoordinates(copie)) return copie;
  const client = findClient(db, order.clientId);
  if (client && getCoordinates(client) && commandeSuitLeClient({ ...order, status: "pret_livraison" }, client)) {
    copie.lat = client.lat;
    copie.lng = client.lng;
    copie.geoPrecision = client.geoPrecision || "";
  }
  return copie;
}

function clientAGeocoder(client) {
  return !getCoordinates(client) && adresseGeocodable(adresseDuClient(client));
}

/**
 * Lot 4 de l'audit geo, porte sur le champ du lot 3 (geoPrecision) : un client
 * DEJA place mais sans precision ni origine (geocode avant que la precision
 * existe) la retrouve dans le cache du geocodeur, sans appel reseau, et
 * seulement si le point du cache EST le sien. Un point pose a la main ou venu
 * du fichier ne correspond pas (et porte deja une origine) : il reste tel quel.
 * Ses commandes qui le suivent AU MEME point prennent la precision ; une
 * commande livree ailleurs (EHPAD, proche) ou placee a la main, non.
 * Rend true si le client a ete rattrape.
 */
function rattraperPrecisionDepuisLeCache(db, client) {
  if (client.geoPrecision || client.geoSource) return false;
  const point = getCoordinates(client);
  const adresse = adresseDuClient(client);
  if (!point || !adresseGeocodable(adresse)) return false;
  const cle = cleGeocodage(adresse);
  const entree = getSqliteStore().getGeocodage(cle);
  if (!entree || entree.statut !== GEOCODAGE_STATUTS.TROUVE) return false;
  if (Number(entree.lat) !== point.lat || Number(entree.lng) !== point.lng) return false;
  const precision = geocodage.precisionDuType(entree.type);
  if (!precision) return false;
  client.geoPrecision = precision;
  client.geoSource = "ban";
  client.geoCle = cle;
  client.geoLibelle = clean(entree.libelle);
  for (const order of db.commandes) {
    if (order.geoPrecision || order.geoSource === "manuel") continue;
    if (!commandeSuitLeClient(order, client, cle) || !memePoint(order, client)) continue;
    order.geoPrecision = precision;
    order.geoSource = "client";
  }
  return true;
}

/** Meme point, a 1e-7 pres : une commande livree ailleurs (EHPAD, proche) n'est pas le client. */
function memePoint(a, b) {
  const pa = getCoordinates(a);
  const pb = getCoordinates(b);
  return Boolean(pa && pb) && Math.abs(pa.lat - pb.lat) < 1e-7 && Math.abs(pa.lng - pb.lng) < 1e-7;
}

/**
 * Geocode les clients depourvus de coordonnees.
 *
 * L'ordre des operations est le point critique de cette fonction. Les appels
 * reseau se font AVANT et EN DEHORS de tout verrou : withWriteLock serialise
 * toutes les ecritures et impose un plafond de 60 s, or geocoder 200 clients
 * a 120 ms d'intervalle depasse largement ce budget. Tenir le verrou pendant
 * les appels gelerait l'application entiere pour tout le monde.
 *
 * On lit, on interroge le reseau sans verrou, puis on prend le verrou une
 * seule fois pour ecrire -- en RE-VERIFIANT chaque client (M8) : une position
 * saisie a la main pendant le lot, ou une adresse changee entre-temps, gagne
 * toujours. `forcer` ne touche jamais une position manuelle.
 *
 * Famine : un client dont l'adresse a deja ete rejetee (et dont le rejet est
 * encore valide en cache) n'occupe plus une place du lot ; il attend dans
 * l'ecran "Adresses a verifier".
 */
async function geocoderClients({ forcer = false, max = GEOCODER_MAX_PAR_LOT } = {}) {
  assertGeocodageSupporte();
  const store = getSqliteStore();

  const eligibles = readDb().clients.filter(client => {
    if (!adresseGeocodable(adresseDuClient(client))) return false;
    if (client.geoSource === "manuel") return false;
    if (forcer) return !getCoordinates(client) || client.geoSource === "ban";
    return !getCoordinates(client);
  });

  const aTraiter = forcer
    ? eligibles
    : eligibles.filter(client => {
      const enCache = store.getGeocodage(cleGeocodage(adresseDuClient(client)));
      return !geocodage.entreeCacheValide(enCache) || enCache.statut === GEOCODAGE_STATUTS.TROUVE;
    });

  const lot = aTraiter.slice(0, Math.max(0, Math.min(Number(max) || GEOCODER_MAX_PAR_LOT, GEOCODER_MAX_PAR_LOT)));
  const resultats = new Map();
  let dernierAppelReseau = false;

  for (const client of lot) {
    // Espacement entre deux vrais appels ; une lecture du cache n'attend pas.
    if (dernierAppelReseau) await pause(GEOCODER_INTERVALLE_MS);
    const entree = await geocoderAdresse(adresseDuClient(client), { forcer });
    dernierAppelReseau = Boolean(entree?.reseau);
    if (entree) resultats.set(String(client.id), entree);
  }

  // Une seule prise de verrou, une seule ecriture, une fois le reseau termine.
  const bilan = await withWriteLock(async () => {
    const db = readDb();
    let appliques = 0;
    let rattrapes = 0;

    for (const client of db.clients) {
      const entree = resultats.get(String(client.id));
      if (!entree || entree.statut !== GEOCODAGE_STATUTS.TROUVE) {
        // Lot 4 (audit geo), porte sur le champ du lot 3 : un client place
        // avant que la precision existe n'en a aucune, et son point
        // « approximatif » ne se voyait pas. Rattrape depuis le cache.
        if (rattraperPrecisionDepuisLeCache(db, client)) rattrapes += 1;
        continue;
      }
      // L'adresse a change pendant le lot : ce point est celui de l'ancienne.
      if (cleGeocodage(adresseDuClient(client)) !== entree.cle) continue;
      // Une position manuelle n'est jamais ecrasee, meme par `forcer`.
      if (client.geoSource === "manuel") continue;
      // Une position posee pendant le lot (hors lot automatique) gagne.
      if (getCoordinates(client) && !(forcer && client.geoSource === "ban")) continue;
      if (!geocodage.verifierPosition(entree).ok) continue;

      appliquerPositionClient(db, client, {
        lat: entree.lat,
        lng: entree.lng,
        source: "ban",
        precision: entree.precision || geocodage.precisionDuType(entree.type),
        libelle: entree.libelle
      });
      appliques += 1;
    }

    if (appliques > 0) addHistory(db, "Geocodage", `${appliques} client(s) geolocalise(s) automatiquement`);
    if (appliques > 0 || rattrapes > 0) writeDb(db);

    return appliques;
  });

  const parStatut = { trouve: 0, ambigu: 0, introuvable: 0, erreur: 0 };
  for (const entree of resultats.values()) parStatut[entree.statut] += 1;

  return {
    candidats: aTraiter.length,
    enAttenteDeVerification: eligibles.length - aTraiter.length,
    traites: lot.length,
    tronque: aTraiter.length > lot.length,
    appliques: bilan,
    parStatut
  };
}

function assertGeocodageSupporte() {
  if (!useSqliteStorage()) {
    throw badRequest("Le geocodage necessite le stockage SQLite.");
  }
}

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Etat du geocodage : ce qui reste a faire et ce que le cache contient deja.
 */
function etatGeocodage() {
  assertGeocodageSupporte();

  const clients = readDb().clients;
  const store = getSqliteStore();

  const geolocalises = clients.filter(client => Boolean(getCoordinates(client))).length;
  const sansAdresse = clients.filter(
    client => !getCoordinates(client) && !adresseGeocodable(adresseDuClient(client))
  ).length;

  return {
    clients: clients.length,
    geolocalises,
    aGeocoder: clients.filter(clientAGeocoder).length,
    sansAdresseExploitable: sansAdresse,
    cache: store.countGeocodagesParStatut()
  };
}

const STATUTS_A_LIVRER = new Set(["pret_livraison", "a_reprogrammer", "en_livraison"]);
const STATUTS_ACTIFS = new Set([
  "importe", "stock_a_verifier", "en_preparation", "preparation_terminee",
  "pret_livraison", "en_livraison", "a_reprogrammer", "probleme_livraison",
  "commande_client_validee", "planifiee", "a_confirmer"
]);

/**
 * H7 : la liste de l'ecran "Adresses a verifier".
 *
 * Un client y figure s'il a une commande en cours, ou une adresse exploitable,
 * ET : aucune position (raison "sans-position"), une position approximative
 * -- rue, lieu-dit, commune (raison "approximative") --, ou une position
 * manuelle gardee apres un changement d'adresse ("adresse-modifiee"). La
 * proposition vient du cache (un "ambigu" a deja un point) ; accepter la
 * proposition, c'est l'enregistrer comme une saisie manuelle.
 */
function listerAdressesAVerifier(db, { inclure = "" } = {}) {
  const store = useSqliteStorage() ? getSqliteStore() : null;
  const commandesParClient = new Map();
  const aLivrerParClient = new Map();
  for (const order of db.commandes) {
    const id = String(order.clientId);
    if (STATUTS_ACTIFS.has(order.status)) commandesParClient.set(id, (commandesParClient.get(id) || 0) + 1);
    if (STATUTS_A_LIVRER.has(order.status)) aLivrerParClient.set(id, (aLivrerParClient.get(id) || 0) + 1);
  }

  const lignes = [];
  for (const client of db.clients) {
    if (client.crmArchived) continue;
    const id = String(client.id);
    const actives = commandesParClient.get(id) || 0;
    const adresse = adresseDuClient(client);
    const geocodable = adresseGeocodable(adresse);
    const demande = Boolean(inclure) && String(inclure) === id;
    if (!actives && !geocodable && !demande) continue;

    const position = getCoordinates(client);
    let raison = "";
    if (!position) raison = "sans-position";
    else if (client.geoAVerifier === "adresse-modifiee") raison = "adresse-modifiee";
    // Une position approximative VALIDEE par une personne (proposition
    // acceptee) ne revient pas dans la liste : sa precision reste affichee.
    else if (geocodage.precisionApproximative(client.geoPrecision) && client.geoSource !== "manuel") raison = "approximative";
    // "Corriger la position" depuis un arret : le client est montre meme
    // quand rien ne le signale (la BAN peut se tromper de porte).
    if (!raison && demande) raison = "demandee";
    if (!raison) continue;

    const nettoyee = geocodage.nettoyerAdresse(adresse);
    const enCache = store && geocodable ? store.getGeocodage(cleGeocodage(adresse)) : null;
    const proposition = enCache && Number.isFinite(enCache.lat) && Number.isFinite(enCache.lng)
      && geocodage.verifierPosition(enCache).ok
      && !(position && Number(position.lat) === enCache.lat && Number(position.lng) === enCache.lng)
      ? {
        lat: enCache.lat,
        lng: enCache.lng,
        libelle: enCache.libelle || "",
        score: enCache.score,
        precision: geocodage.precisionDuType(enCache.type),
        statut: enCache.statut
      }
      : null;

    lignes.push({
      id: client.id,
      nom: [client.prenom, client.nom].filter(Boolean).join(" ") || client.nom || "Client",
      rue: client.rue || "",
      codePostal: client.codePostal || "",
      ville: client.ville || "",
      complement: nettoyee.complement,
      adresseExploitable: geocodable,
      lat: position ? position.lat : "",
      lng: position ? position.lng : "",
      geoPrecision: client.geoPrecision || "",
      geoSource: client.geoSource || "",
      raison,
      statutGeocodage: enCache ? enCache.statut : "",
      commandesActives: actives,
      commandesALivrer: aLivrerParClient.get(id) || 0,
      proposition
    });
  }

  const poids = ligne => (ligne.commandesALivrer ? 0 : 2) + (ligne.raison === "sans-position" ? 0 : 1);
  lignes.sort((a, b) => poids(a) - poids(b) || a.nom.localeCompare(b.nom, "fr"));

  return {
    source: geocodage.SOURCE_ADRESSES,
    total: lignes.length,
    sansPosition: lignes.filter(l => l.raison === "sans-position").length,
    approximatives: lignes.filter(l => l.raison === "approximative").length,
    adressesModifiees: lignes.filter(l => l.raison === "adresse-modifiee").length,
    // L'alerte de la preparation de tournee : clients a livrer sans position.
    aLivrerSansPosition: lignes.filter(l => l.raison === "sans-position" && l.commandesALivrer > 0).length,
    clients: lignes
  };
}

function parseBasicAuthHeader(header) {
  const [scheme, encoded] = String(header || "").split(" ");
  if (!encoded || scheme.toLowerCase() !== "basic") return null;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

function constantTimeEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(String(left)).digest();
  const rightHash = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

// --- Mots de passe des comptes utilisateurs (V8 phase 1) -------------------
//
// scrypt via node:crypto : resistant au GPU, et AUCUNE dependance ajoutee.
// bcrypt/argon2 imposeraient un module natif a recompiler a chaque bump de
// Node, sur une image Alpine, pour un gain nul a cette echelle.
//
// Le format stocke embarque les parametres :
//     scrypt$<N>$<r>$<p>$<cle en base64>
// Les relire depuis l'enregistrement permet de durcir les parametres plus tard
// sans invalider les mots de passe existants : un ancien hash se verifie avec
// ses propres parametres, et sera re-hashe au prochain changement.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

// 128 * N * r = 16 Mo pour N=16384, r=8. La limite par defaut de Node est de
// 32 Mo : on la releve explicitement pour garder de la marge si N augmente.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function generatePasswordSalt() {
  return crypto.randomBytes(16).toString("base64");
}

/**
 * scrypt est volontairement lent (~100 ms). On utilise la variante ASYNCHRONE :
 * la version synchrone bloquerait la boucle d'evenements a chaque tentative de
 * connexion, ce qui transformerait le formulaire de login en levier de deni de
 * service, meme derriere le rate-limit par IP.
 */
function derivePasswordKey(password, salt, params) {
  const { N, r, p, keylen } = params;
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      String(password),
      String(salt),
      keylen,
      { N, r, p, maxmem: SCRYPT_MAXMEM },
      (error, derived) => (error ? reject(error) : resolve(derived))
    );
  });
}

async function hashPassword(password, salt) {
  const derived = await derivePasswordKey(password, salt, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${derived.toString("base64")}`;
}

/**
 * Comparaison a temps constant. Retourne false sur tout enregistrement
 * illisible plutot que de lever : un hash corrompu en base doit refuser la
 * connexion, pas faire tomber le serveur sur la page de login.
 */
async function verifyPassword(password, salt, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 5 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  let expected;
  try {
    expected = Buffer.from(parts[4], "base64");
  } catch {
    return false;
  }

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N <= 0 || r <= 0 || p <= 0 || expected.length === 0) return false;

  let derived;
  try {
    derived = await derivePasswordKey(password, salt, { N, r, p, keylen: expected.length });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

// --- Roles et permissions (V8 phase 1) -------------------------------------
//
// SEPARATION DES ACCES : DESACTIVEE.
//
// Decision de Tom, 26/08/2026 : l'equipe fait tout de bout en bout, tout le
// monde doit voir tous les onglets. C'est plus simple a gerer aujourd'hui, et
// la separation viendra si l'equipe grandit.
//
// Les portees par role restent declarees ci-dessous et restent TESTEES via
// roleAllowsTabStrict : elles documentent l'intention, et SEREO_SEPARATION_ROLES=1
// masque les onglets hors portee.
//
// A noter : `onglets` ne pilote que la NAVIGATION -- poser la variable ne
// ferme AUCUNE route (la chasse aux defauts du 24/09 : meme banc, meme
// resultat, variable posee ou non). Les restrictions reelles sont cote
// serveur, sur les routes, independamment de la variable (garde-fous du
// 25/09) : requireAdministration (import, purge, reglages, sauvegardes,
// comptes, numerotation) et refuserAuLivreur (modification du stock). La
// liste complete : test/garde-fous-routes.test.js. `peutEcrire` n'est lu
// nulle part.
const SEPARATION_DES_ROLES = process.env.SEREO_SEPARATION_ROLES === "1";

const ROLES = {
  admin: {
    libelle: "Administrateur",
    onglets: "*",
    peutEcrire: true,
    administration: true
  },
  bureau: {
    libelle: "Bureau",
    onglets: "*",
    peutEcrire: true,
    administration: false
  },
  preparateur: {
    libelle: "Préparateur",
    onglets: [
      "journee",
      "preparation",
      "stock",
      // Les listes de commandes n'en font plus qu'une (planches 13c/14c).
      "commandes",
      "recommande"
    ],
    peutEcrire: true,
    administration: false
  },
  livreur: {
    libelle: "Livreur",
    onglets: ["journee", "livreur", "commandes"],
    peutEcrire: true,
    administration: false
  }
};

const DEFAULT_ROLE = "livreur";

function isKnownRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, String(role));
}

function getRole(role) {
  return ROLES[String(role)] || ROLES[DEFAULT_ROLE];
}

/**
 * Portee reelle, telle qu'elle s'appliquerait si la separation etait active.
 * Toujours testee, meme quand la separation est desactivee : c'est ce qui
 * garantit que la repartition reste coherente et prete a l'emploi.
 */
function roleAllowsTabStrict(role, tab) {
  const definition = getRole(role);
  if (definition.onglets === "*") return true;
  return definition.onglets.includes(String(tab));
}

/** Portee effective aujourd'hui : tout ouvert, sauf si la separation est activee. */
function roleAllowsTab(role, tab) {
  if (!SEPARATION_DES_ROLES) return true;
  return roleAllowsTabStrict(role, tab);
}

/** Liste des onglets visibles, pour /api/me et le filtrage de la navigation. */
function roleTabScope(role) {
  if (!SEPARATION_DES_ROLES) return "*";
  return getRole(role).onglets;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCookies(header) {
  return String(header || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return cookies;

      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!name) return cookies;

      // decodeURIComponent throw sur un cookie malforme (ex: "%" non suivi de
      // 2 hex). parseCookies s'execute AVANT l'auth (getAccessSessionCookie) :
      // une exception ici renverrait 500 avant la verification d'acces (DoS
      // trivial et pre-auth). On retombe sur la valeur brute.
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

function signAuthPayload(payload) {
  return crypto
    .createHmac("sha256", AUTH_SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

/**
 * `now` reste le PREMIER parametre : test/auth.test.js appelle ce helper avec
 * un horodatage en premiere position pour fabriquer des sessions expirees.
 * L'identite arrive donc en second.
 *
 * Une session sans `uid` designe le compte issu des variables d'environnement,
 * seul compte existant avant la phase 1. Les cookies emis avant cette version
 * n'ont pas le champ : ils restent donc valides, personne n'est deconnecte par
 * la mise a jour.
 */
function createAccessSessionValue(now = Date.now(), identity = null) {
  const payload = Buffer.from(JSON.stringify({
    user: identity ? identity.identifiant : AUTH_USER,
    uid: identity ? identity.id : null,
    issuedAt: now
  })).toString("base64url");

  return `${payload}.${signAuthPayload(payload)}`;
}

// --- Sessions fermees (garde-fous du 25/09) ------------------------------------
//
// Avant : « Se deconnecter » ne faisait qu'effacer le cookie du navigateur, et
// un changement de mot de passe ne touchait pas aux sessions ouvertes ; une
// copie du cookie restait valable jusqu'a 12 h (chasse aux defauts, section 3).
// Maintenant :
// - se deconnecter FERME la session : son empreinte (sha256 du cookie) est
//   gardee jusqu'a l'expiration qu'elle aurait eue ; les autres sessions du
//   meme compte (un autre appareil) restent ouvertes ;
// - changer le mot de passe d'un compte en base ferme TOUTES ses sessions
//   ouvertes avant le changement (« sessions depuis ») ; le compte
//   d'environnement, lui, change deja de secret de signature avec son mot de
//   passe.
// Gardees dans app_meta (hors de readDb/writeDb, comme les comptes), relues
// au premier besoin apres un demarrage ; en memoire ensuite. Verifiees dans
// readAccessSession : tous les chemins (acces, identite) les voient.
const CLE_SESSIONS_FERMEES = "sessions_fermees";
const CLE_SESSIONS_DEPUIS = "sessions_depuis";
let etatDesSessions = null;

function sessionsFermees() {
  if (etatDesSessions) return etatDesSessions;
  const etat = { fermees: new Map(), depuis: new Map() };
  if (useSqliteStorage()) {
    try {
      const store = getSqliteStore();
      const maintenant = Date.now();
      for (const [cle, fin] of Object.entries(store.lireMeta(CLE_SESSIONS_FERMEES) || {})) {
        if (Number(fin) > maintenant) etat.fermees.set(cle, Number(fin));
      }
      for (const [uid, depuis] of Object.entries(store.lireMeta(CLE_SESSIONS_DEPUIS) || {})) {
        if (Number.isFinite(Number(depuis))) etat.depuis.set(String(uid), Number(depuis));
      }
    } catch (error) {
      // Base indisponible (restauration en cours) : rien de garde en memoire,
      // on relira au prochain appel.
      console.warn(`[auth] sessions fermees illisibles : ${error.message || error}`);
      return etat;
    }
  }
  etatDesSessions = etat;
  return etat;
}

function cleDeSession(valeur) {
  return crypto.createHash("sha256").update(String(valeur || "")).digest("hex").slice(0, 32);
}

function enregistrerSessions(cle, valeur) {
  if (!useSqliteStorage()) return;
  try {
    getSqliteStore().ecrireMeta(cle, valeur);
  } catch (error) {
    console.warn(`[auth] sessions fermees non enregistrees (gardees en memoire) : ${error.message || error}`);
  }
}

function fermerSession(valeur, session) {
  const etat = sessionsFermees();
  const maintenant = Date.now();
  etat.fermees.set(cleDeSession(valeur), session.issuedAt + AUTH_COOKIE_MAX_AGE_SECONDS * 1000);
  for (const [cle, fin] of etat.fermees) if (fin <= maintenant) etat.fermees.delete(cle);
  enregistrerSessions(CLE_SESSIONS_FERMEES, Object.fromEntries(etat.fermees));
}

function fermerSessionsDuCompte(uid, depuis = Date.now()) {
  const etat = sessionsFermees();
  etat.depuis.set(String(uid), depuis);
  enregistrerSessions(CLE_SESSIONS_DEPUIS, Object.fromEntries(etat.depuis));
}

/**
 * Verifie la signature et la fraicheur, puis retourne la charge utile.
 * Ne dit RIEN de la validite du compte : c'est le role de l'appelant.
 * Garde-fous (25/09) : une session fermee (deconnexion, mot de passe change)
 * n'est plus lue.
 */
function readAccessSession(value, now = Date.now()) {
  const [payload, signature] = String(value || "").split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signAuthPayload(payload);
  if (!constantTimeEqual(signature, expectedSignature)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const issuedAt = Number(session.issuedAt);
    if (!Number.isFinite(issuedAt)) return null;
    if (now - issuedAt > AUTH_COOKIE_MAX_AGE_SECONDS * 1000) return null;

    const uid = session.uid ? String(session.uid) : null;
    const fermees = sessionsFermees();
    if (fermees.fermees.has(cleDeSession(value))) return null;
    if (uid && fermees.depuis.has(uid) && issuedAt < fermees.depuis.get(uid)) return null;

    return {
      user: typeof session.user === "string" ? session.user : "",
      uid,
      issuedAt
    };
  } catch {
    return null;
  }
}

function isValidAccessSessionValue(value, now = Date.now()) {
  const session = readAccessSession(value, now);
  if (!session) return false;

  // Session rattachee a un compte en base : on revalide a chaque requete, de
  // sorte qu'une desactivation prenne effet immediatement plutot qu'au bout
  // des 12 h de duree de vie du cookie.
  if (session.uid) return Boolean(lookupActiveUser(session.uid));

  // Session du compte d'environnement.
  return isEnvAuthConfigured() && session.user === AUTH_USER;
}

function getAccessSessionCookie(req) {
  return parseCookies(req.get("cookie"))[AUTH_COOKIE_NAME];
}

function buildAuthCookie(value, maxAgeSeconds, req) {
  const cookieParts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (req.secure || req.get("x-forwarded-proto") === "https") {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

function isSessionAuthorizedRequest(req) {
  if (!isAccessAuthEnabled()) return true;
  return isValidAccessSessionValue(getAccessSessionCookie(req));
}

function isAuthorizedRequest(req) {
  if (!isAccessAuthEnabled()) return true;

  if (isSessionAuthorizedRequest(req)) return true;

  const credentials = parseBasicAuthHeader(req.get("authorization"));
  if (!credentials) return false;

  // CRITIQUE : depuis la phase 1, l'auth peut etre activee par la seule
  // presence de comptes en base, sans SEREO_AUTH_USER/PASSWORD. Dans ce cas
  // AUTH_USER et AUTH_PASSWORD valent "" — et constantTimeEqual("", "") est
  // vrai. Sans cette garde, un en-tete Basic vide authentifierait n'importe
  // qui. Le couple d'environnement doit etre reellement configure pour que
  // cette voie soit ouverte.
  if (!isEnvAuthConfigured()) return false;

  // L'authentification Basic reste volontairement reservee au couple
  // d'environnement. Les comptes en base passent par le formulaire : leur
  // verification est asynchrone (scrypt), alors que cette fonction est
  // appelee de maniere synchrone sur CHAQUE requete, y compris les assets.
  return constantTimeEqual(credentials.username, AUTH_USER)
    && constantTimeEqual(credentials.password, AUTH_PASSWORD);
}

function isApiRequest(req) {
  return String(req.path || "").startsWith("/api/");
}

function isHtmlNavigationRequest(req) {
  return req.method === "GET"
    && (req.path === "/" || req.path === "/index.html" || String(req.get("accept") || "").includes("text/html"));
}

// Reponse de refus d'acces sur une tentative de credentials, format adapte au
// type de requete.
// - Navigation HTML (GET) : page de login conviviale via renderLoginPage, qui
//   lit l'etat de lockout depuis le store et pose lui-meme 200/429 + Retry-After
//   + le compte a rebours. On EVITE ainsi le dialogue Basic natif du navigateur
//   quand des credentials Basic perimees sont re-envoyees automatiquement
//   (ex. apres rotation du mot de passe : le navigateur rejoue le vieux Basic).
// - API : JSON { error } + Retry-After/WWW-Authenticate selon le cas.
function denyAccessAttempt(req, res, statusCode, message, retryAfterMs = 0) {
  if (req.method === "GET" && isHtmlNavigationRequest(req)) {
    renderLoginPage(req, res);
    return;
  }
  if (retryAfterMs > 0) {
    res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  }
  if (statusCode === 401) {
    res.setHeader("WWW-Authenticate", `Basic realm="${AUTH_REALM}", charset="UTF-8"`);
  }
  if (isApiRequest(req)) {
    res.status(statusCode).json({ error: message });
    return;
  }
  res.status(statusCode).send(message);
}

function requireAccessAuth(req, res, next) {
  if (isAccessAuthMisconfigured()) {
    res.status(500).json({
      error: "Protection d'acces mal configuree. Renseigner SEREO_AUTH_USER et SEREO_AUTH_PASSWORD."
    });
    return;
  }

  // Une session cookie valide autorise directement, sans passer par le
  // rate-limit : ce n'est pas une tentative de credentials (et une session
  // legitime ne doit pas etre bloquee par un lockout d'IP partagee).
  if (isSessionAuthorizedRequest(req)) {
    next();
    return;
  }

  // Pas de session valide. Si des credentials Basic sont presentes, on les
  // verifie sous le MEME rate-limit que POST /login. Sans ca, l'en-tete Basic
  // sur n'importe quelle route protegee permettait un brute-force ILLIMITE du
  // mot de passe (le lockout ne couvrait que /login).
  // isEnvAuthConfigured() et non isAccessAuthEnabled() : depuis la phase 1,
  // la protection peut etre active du seul fait qu'il existe des comptes en
  // base, sans SEREO_AUTH_USER/PASSWORD. AUTH_USER et AUTH_PASSWORD valent
  // alors "", et la comparaison plus bas accepterait un en-tete Basic vide.
  // Cette voie n'est ouverte que si le couple d'environnement existe vraiment.
  const basicCredentials = isEnvAuthConfigured()
    ? parseBasicAuthHeader(req.get("authorization"))
    : null;

  if (basicCredentials) {
    const ip = getClientIp(req);

    const status = getAuthRateLimitStatus(ip);
    if (status.locked) {
      denyAccessAttempt(req, res, 429, "Trop de tentatives de connexion. Reessayez plus tard.", status.remainingMs);
      return;
    }
    // Garde-fous (25/09) : la limite par compte, comme au formulaire -- sauf
    // pour un appareil qui a deja ouvert ce compte (relecture du 26/09).
    const connu = appareilConnuDuCompte(req, basicCredentials.username);
    const compte = connu ? { locked: false } : statutDuCompte(basicCredentials.username);
    if (compte.locked) {
      denyAccessAttempt(req, res, 429, "Trop de tentatives de connexion sur ce compte. Reessayez plus tard.", compte.remainingMs);
      return;
    }

    const valid = constantTimeEqual(basicCredentials.username, AUTH_USER)
      && constantTimeEqual(basicCredentials.password, AUTH_PASSWORD);

    if (valid) {
      clearAuthFailures(ip);
      effacerEchecsDuCompte(basicCredentials.username);
      if (!connu) res.append("Set-Cookie", cookieAppareil(req, basicCredentials.username));
      next();
      return;
    }

    const updated = recordAuthFailure(ip);
    const compteApres = connu ? { locked: false, remainingMs: 0 } : echecDuCompte(basicCredentials.username);
    if (updated.locked || compteApres.locked) {
      denyAccessAttempt(req, res, 429, "Trop de tentatives de connexion. Reessayez plus tard.", Math.max(updated.remainingMs, compteApres.remainingMs));
      return;
    }
    denyAccessAttempt(req, res, 401, "Connexion requise");
    return;
  }

  // Aucun credential presente (navigation anonyme, session SPA expiree...) :
  // parcours normal, sans enregistrer d'echec (sinon un simple navigateur
  // deconnecte declencherait le lockout).
  if (isApiRequest(req)) {
    res.setHeader("WWW-Authenticate", `Basic realm="${AUTH_REALM}", charset="UTF-8"`);
    res.status(401).json({ error: "Connexion requise" });
    return;
  }

  if (req.method === "GET") {
    renderLoginPage(req, res);
    return;
  }

  res.setHeader("WWW-Authenticate", `Basic realm="${AUTH_REALM}", charset="UTF-8"`);
  res.status(401).send("Acces protege");
}

function getSafeRedirectTarget(value) {
  const target = String(value || "/");

  // Doit etre un chemin interne simple. On rejette aussi les backslash : un
  // navigateur peut interpreter "/\evil.com" (ou "/\/evil.com") comme une URL
  // protocole-relative -> open redirect externe apres login.
  if (
    !target.startsWith("/")
    || target.startsWith("//")
    || target.includes("\\")
    || target.startsWith("/login")
  ) {
    return "/";
  }

  return target;
}

/** « 15 secondes », « 2 minutes » : la duree du blocage, dite comme a l'ecran. */
function formatDureeDeBlocage(ms) {
  const secondes = Math.max(1, Math.round(ms / 1000));
  if (secondes < 120) return `${secondes} seconde${secondes > 1 ? "s" : ""}`;
  const minutes = Math.round(secondes / 60);
  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}

function renderLoginPage(req, res) {
  if (!isAccessAuthEnabled()) {
    res.redirect(getSafeRedirectTarget(req.query.next));
    return;
  }

  const hasError = req.query.error === "1";
  const next = getSafeRedirectTarget(req.query.next);
  // Decision 4 (23/09) : la page de connexion dit « aucune session ». Le
  // service worker oublie alors la copie de la tournee ET ses donnees.
  res.setHeader("X-Sereo-Session-Fin", "0");

  // Etat du rate limit pour cette IP, calcule a chaque GET /login.
  // Source de verite serveur (la query ?locked=1 peut etre obsolete si le
  // lockout a expire entre le POST et le GET).
  const status = getAuthRateLimitStatus(getClientIp(req));
  let isLocked = status.locked;
  let lockedUntilMs = isLocked ? status.lockedUntil : 0;
  // Garde-fous (25/09) : le blocage d'un COMPTE ne se lit pas depuis l'adresse
  // (la page ne sait pas quel identifiant sera saisi) ; la redirection du POST
  // porte son echeance. Affichage seulement : le refus est decide au POST,
  // cote serveur. Une echeance passee ou invraisemblable n'affiche rien.
  let parCompte = false;
  if (!isLocked && req.query.compte === "1") {
    const jusqua = Number(req.query.until);
    const reste = jusqua - Date.now();
    if (Number.isFinite(jusqua) && reste > 0 && reste <= AUTH_COMPTE_LOCKOUT_MS) {
      isLocked = true;
      parCompte = true;
      lockedUntilMs = jusqua;
    }
  }
  const lockedSeconds = isLocked ? Math.ceil((parCompte ? lockedUntilMs - Date.now() : status.remainingMs) / 1000) : 0;

  let errorMarkup = "";
  if (isLocked) {
    const plural = lockedSeconds > 1 ? "s" : "";
    // Le mot "seconde(s)" est dans un span separe pour que login.js puisse
    // basculer entre singulier et pluriel quand le compteur descend a 1.
    // Le blocage d'un compte ne vise que les appareils qui ne l'ont jamais
    // ouvert (relecture du 26/09) : la page le dit, c'est la voie de secours.
    const secours = parCompte ? " Un appareil d&eacute;j&agrave; connect&eacute; &agrave; ce compte peut toujours se connecter." : "";
    errorMarkup = `<p class="login-error" role="alert" aria-live="polite">Trop de tentatives${parCompte ? " sur ce compte" : ""}. R&eacute;essaie dans <span id="lockout-countdown">${lockedSeconds}</span> <span id="lockout-unit">seconde${plural}</span>.${secours}</p>`;
  } else if (hasError) {
    // UNE phrase (planche 9c) : « Identifiant ou mot de passe incorrect. Il te
    // reste 2 tentatives avant un blocage de 15 secondes. » Les essais restants
    // etaient un <span> a part, dans un conteneur flex : deux colonnes cote a
    // cote, dans une autre couleur. Ce n'est plus que du texte.
    const attemptsRemaining = status.remaining;
    const attemptsLine = attemptsRemaining > 0 && attemptsRemaining < AUTH_RATE_LIMIT_MAX_ATTEMPTS
      ? ` Il te reste ${attemptsRemaining} tentative${attemptsRemaining > 1 ? "s" : ""} avant un blocage de ${formatDureeDeBlocage(AUTH_RATE_LIMIT_LOCKOUT_MS)}.`
      : "";
    errorMarkup = `<p class="login-error" role="alert">Identifiant ou mot de passe incorrect.${attemptsLine}</p>`;
  }

  const responseStatus = isLocked ? 429 : (hasError ? 401 : 200);
  if (isLocked) {
    res.setHeader("Retry-After", String(lockedSeconds));
  }
  const bodyLockedAttr = isLocked ? ` data-locked-until="${lockedUntilMs}"` : "";

  res.status(responseStatus).send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connexion - s&eacute;r&eacute;o</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    /* CONNEXION -- planches 9b (normal), 9c (3e echec), 9d (bloquee).
       Les jetons de la charte, en clair et en sombre (l'appareil decide : la
       page de connexion n'a pas encore le choix enregistre de l'utilisateur).
       AUCUN BACKTICK ICI : ce bloc vit dans un litteral de gabarit JS. */
    @font-face { font-family: "Poppins"; font-weight: 400; font-display: swap; src: url("/fonts/poppins-400-latin.woff2") format("woff2"); }
    @font-face { font-family: "Poppins"; font-weight: 500; font-display: swap; src: url("/fonts/poppins-500-latin.woff2") format("woff2"); }
    @font-face { font-family: "Poppins"; font-weight: 600; font-display: swap; src: url("/fonts/poppins-600-latin.woff2") format("woff2"); }
    @font-face { font-family: "Poppins"; font-weight: 700; font-display: swap; src: url("/fonts/poppins-700-latin.woff2") format("woff2"); }
    :root {
      --fond: #FBF7F5; --surface: #FFFFFF; --texte: #386B6D; --secondaire: #4F7477;
      --principal: #386B6D; --sur-principal: #FFFFFF; --surface-basse: #F5F1EE;
      --alerte: #C02B0A; --accent: #EF9177; --marque: #386B6D;
      --tache-1: #EDC8C3; --tache-2: #A1C4C0; --focus: 0 0 0 3px #FBF7F5, 0 0 0 5px #386B6D;
      --ombre: 0 1px 2px rgba(15, 61, 61, .05), 0 12px 28px rgba(15, 61, 61, .05);
      color-scheme: light dark;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --fond: #0D1518; --surface: #132224; --texte: #E6F2EE; --secondaire: #A8C4BE;
        --principal: #93CBC9; --sur-principal: #0D1518; --surface-basse: #101D20;
        --alerte: #F2635A; --marque: #EF9177;
        --tache-1: #3A2A28; --tache-2: #1D3B3C; --focus: 0 0 0 3px #0D1518, 0 0 0 5px #93CBC9;
        --ombre: 0 1px 2px rgba(0, 0, 0, .4), 0 12px 28px rgba(0, 0, 0, .3);
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100vh; }
    body {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 32px 16px 24px; overflow-x: hidden; position: relative;
      font-family: "Poppins", system-ui, -apple-system, "Segoe UI", sans-serif;
      background: var(--fond); color: var(--texte);
    }
    /* Deux taches de couleur, floues, derriere la carte (planche 9b). */
    .tache { position: fixed; border-radius: 999px; filter: blur(10px); pointer-events: none; z-index: 0; }
    .tache-1 { top: -120px; right: -100px; width: 320px; height: 320px; background: var(--tache-1); opacity: .5; }
    .tache-2 { bottom: 120px; left: -140px; width: 300px; height: 300px; background: var(--tache-2); opacity: .3; }
    .carte {
      position: relative; z-index: 1; width: 100%; max-width: 420px;
      display: flex; flex-direction: column; gap: 32px;
      padding: 32px 24px; border-radius: 28px; background: var(--surface); box-shadow: var(--ombre);
    }
    .marque { display: flex; flex-direction: column; gap: 14px; }
    .mot { display: flex; align-items: flex-end; gap: 4px; margin: 0; }
    /* Le mot « sereo » : en clair, dans le principal -- l'orange de la planche
       tombe a 2,34:1 sur blanc, sous les 3:1 d'un grand texte ; en sombre,
       l'orange de la planche (7:1). Le sourire garde l'orange. */
    .mot span { font-size: 52px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: var(--marque); }
    .mot svg { width: 36px; height: 20px; margin-bottom: 7px; flex: none; }
    .accroche { margin: 0; font-size: 15.5px; line-height: 1.5; color: var(--secondaire); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    form { display: flex; flex-direction: column; gap: 14px; }
    .champ { display: flex; flex-direction: column; gap: 6px; }
    .champ label { font-size: 13px; font-weight: 500; color: var(--secondaire); }
    .saisie {
      display: flex; align-items: center; height: 48px; border-radius: 18px;
      background: var(--surface-basse); box-shadow: inset 0 0 0 1.5px transparent;
    }
    .saisie:focus-within { background: var(--surface); box-shadow: inset 0 0 0 1.5px var(--principal); }
    .saisie input {
      flex: 1; min-width: 0; height: 100%; padding: 0 18px; border: 0; background: transparent;
      font: inherit; font-size: 15.5px; font-weight: 500; color: var(--texte); outline: none;
    }
    .saisie input:disabled { opacity: .6; }
    .saisie--mdp input { padding-right: 4px; }
    /* 3e echec (planche 9c) : le champ mot de passe passe en contour alerte,
       sans dire lequel des deux est faux. */
    .champ--erreur .saisie { background: var(--surface); box-shadow: inset 0 0 0 1.5px var(--alerte); }
    .voir {
      width: 44px; height: 44px; margin-right: 2px; flex: none; display: flex; align-items: center; justify-content: center;
      border: 0; border-radius: 999px; background: transparent; color: var(--secondaire); cursor: pointer;
    }
    .voir svg { width: 20px; height: 20px; }
    .voir[hidden] { display: none; }
    .voir:focus-visible, .saisie input:focus-visible { outline: none; }
    .voir:focus-visible { box-shadow: var(--focus); }
    .login-error {
      display: flex; gap: 8px; margin: 0; font-size: 13.5px; font-weight: 500; line-height: 1.45; color: var(--alerte);
    }
    .login-error::before {
      content: ""; flex: none; width: 16px; height: 16px; margin-top: 2px; border-radius: 999px;
      box-shadow: inset 0 0 0 2px var(--alerte);
    }
    button[type="submit"] {
      width: 100%; height: 48px; margin-top: 6px; border: 0; border-radius: 999px;
      background: var(--principal); color: var(--sur-principal);
      font: inherit; font-size: 15.5px; font-weight: 600; cursor: pointer; transition: transform 100ms ease-out;
    }
    button[type="submit"]:active:not(:disabled) { transform: scale(.97); }
    button[type="submit"]:disabled { opacity: .55; cursor: not-allowed; }
    button[type="submit"]:focus-visible { outline: none; box-shadow: var(--focus); }
    /* Le pied a son fond (planche 9b) : sur les taches floues, le texte
       secondaire tombait sous 4,5:1 au telephone. */
    .pied {
      position: relative; z-index: 1; width: 100%; max-width: 420px; margin-top: 24px; padding: 8px 12px;
      display: flex; flex-direction: column; gap: 6px; background: var(--fond); border-radius: 16px;
    }
    .pied p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--secondaire); }
    .pied a {
      display: inline-flex; align-items: center; min-height: 44px; padding: 0 10px; margin: -12px -10px;
      font-size: 12.5px; font-weight: 500; color: var(--secondaire); text-decoration: underline; text-underline-offset: 3px;
    }
    .pied a:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 12px; }
    @media (prefers-reduced-motion: reduce) { button[type="submit"] { transition: none; } }
  </style>
</head>
<body${bodyLockedAttr}>
  <div class="tache tache-1" aria-hidden="true"></div>
  <div class="tache tache-2" aria-hidden="true"></div>
  <main class="carte" aria-labelledby="login-title">
    <div class="marque">
      <h1 id="login-title" class="mot"><span>s&eacute;r&eacute;o</span><svg viewBox="0 0 30 16" fill="none" aria-hidden="true"><path d="M4 4c6 8 16 8 22 0" stroke="#EF9177" stroke-width="5" stroke-linecap="round"/></svg><span class="sr-only"> &mdash; connexion</span></h1>
      <p class="accroche">Livraison de mat&eacute;riel m&eacute;dical et d'hygi&egrave;ne, Doubs et Jura.</p>
    </div>
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <div class="champ">
        <label for="username">Identifiant</label>
        <div class="saisie"><input id="username" name="username" autocomplete="username" autofocus ${isLocked ? "disabled" : "required"}></div>
      </div>
      <div class="champ${(hasError || isLocked) ? " champ--erreur" : ""}">
        <label for="password">Mot de passe</label>
        <div class="saisie saisie--mdp">
          <input id="password" name="password" type="password" autocomplete="current-password" ${isLocked ? "disabled" : "required"}${(hasError || isLocked) ? ' aria-describedby="login-erreur"' : ""}${hasError && !isLocked ? ' aria-invalid="true"' : ""}>
          <button class="voir" type="button" aria-label="Afficher le mot de passe" aria-pressed="false" hidden>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </div>
      </div>
      ${errorMarkup.replace('class="login-error"', 'id="login-erreur" class="login-error"')}
      <button type="submit"${isLocked ? " disabled" : ""}>Se connecter</button>
    </form>
  </main>
  <footer class="pied">
    <p>Mot de passe oubli&eacute; : voir Tom.</p>
    <p><a href="https://github.com/${GITHUB_REPO}/releases" target="_blank" rel="noopener noreferrer">Version ${APP_VERSION}</a></p>
  </footer>
  <script src="/login.js"></script>
</body>
</html>`);
}

async function handleLogin(req, res) {
  if (isAccessAuthMisconfigured()) {
    res.status(500).send("Protection d'acces mal configuree.");
    return;
  }

  const next = getSafeRedirectTarget(req.body.next);
  const username = cleanEnv(req.body.username);
  const password = cleanEnv(req.body.password);
  const ip = getClientIp(req);

  if (!isAccessAuthEnabled()) {
    res.redirect(next);
    return;
  }

  // Si l'IP est verrouillee, on rejette AVANT meme de comparer les credentials.
  // Cela protege aussi contre la timing-analysis sur des comptes connus.
  const status = getAuthRateLimitStatus(ip);
  if (status.locked) {
    res.setHeader("Retry-After", String(Math.ceil(status.remainingMs / 1000)));
    res.redirect(303, `/login?locked=1&until=${status.lockedUntil}&next=${encodeURIComponent(next)}`);
    return;
  }
  // Garde-fous (25/09) : le compte vise, lui aussi, avant toute comparaison --
  // sauf depuis un appareil qui l'a deja ouvert (relecture du 26/09) : ses
  // echecs ne comptent pas non plus pour le compte.
  const connu = appareilConnuDuCompte(req, username);
  const compte = connu ? { locked: false } : statutDuCompte(username);
  if (compte.locked) {
    res.setHeader("Retry-After", String(Math.ceil(compte.remainingMs / 1000)));
    res.redirect(303, `/login?locked=1&compte=1&until=${compte.lockedUntil}&next=${encodeURIComponent(next)}`);
    return;
  }

  const identity = await authenticateCredentials(username, password);

  if (!identity) {
    const updated = recordAuthFailure(ip);
    const compteApres = connu ? { locked: false } : echecDuCompte(username);
    if (updated.locked) {
      res.setHeader("Retry-After", String(Math.ceil(updated.remainingMs / 1000)));
      res.redirect(303, `/login?locked=1&until=${updated.lockedUntil}&next=${encodeURIComponent(next)}`);
      return;
    }
    if (compteApres.locked) {
      res.setHeader("Retry-After", String(Math.ceil(compteApres.remainingMs / 1000)));
      res.redirect(303, `/login?locked=1&compte=1&until=${compteApres.lockedUntil}&next=${encodeURIComponent(next)}`);
      return;
    }
    res.redirect(303, `/login?error=1&remaining=${updated.remaining}&next=${encodeURIComponent(next)}`);
    return;
  }

  clearAuthFailures(ip);
  effacerEchecsDuCompte(username);

  if (identity.id) {
    try {
      getSqliteStore().touchUserLogin(identity.id, new Date().toISOString());
    } catch {
      // Horodatage de confort : ne doit jamais empecher de se connecter.
    }
  }

  res.setHeader("Set-Cookie", [
    buildAuthCookie(createAccessSessionValue(Date.now(), identity), AUTH_COOKIE_MAX_AGE_SECONDS, req),
    // L'appareil est desormais connu de ce compte (relecture du 26/09).
    cookieAppareil(req, username)
  ]);
  res.redirect(303, next);
}

/**
 * Hash factice, calcule une seule fois au demarrage.
 *
 * Quand l'identifiant saisi n'existe pas, on verifie quand meme le mot de
 * passe contre ce hash. Sans cela, une reponse instantanee pour un identifiant
 * inconnu et une reponse a ~60 ms pour un identifiant connu permettraient
 * d'enumerer les comptes existants, malgre le message d'erreur identique.
 */
const DUMMY_PASSWORD_SALT = generatePasswordSalt();
let dummyPasswordHash = null;

async function getDummyPasswordHash() {
  if (!dummyPasswordHash) {
    dummyPasswordHash = await hashPassword(crypto.randomBytes(32).toString("hex"), DUMMY_PASSWORD_SALT);
  }
  return dummyPasswordHash;
}

/**
 * Authentifie un couple identifiant/mot de passe.
 *
 * Deux sources, dans cet ordre :
 *   1. le couple SEREO_AUTH_USER / SEREO_AUTH_PASSWORD, conserve tel quel pour
 *      ne pas verrouiller une production existante hors de son application ;
 *   2. les comptes de la table `utilisateurs`.
 *
 * Retourne l'identite en cas de succes, null sinon. Jamais de distinction
 * entre "identifiant inconnu", "mot de passe faux" et "compte desactive" :
 * l'appelant emet un message unique.
 */
async function authenticateCredentials(username, password) {
  if (
    isEnvAuthConfigured()
    && constantTimeEqual(username, AUTH_USER)
    && constantTimeEqual(password, AUTH_PASSWORD)
  ) {
    return { id: null, identifiant: AUTH_USER, role: "admin" };
  }

  if (!useSqliteStorage()) return null;

  let user = null;
  try {
    user = getSqliteStore().findUserForAuth(username);
  } catch {
    return null;
  }

  if (!user) {
    // Compte inexistant : on brule quand meme le temps d'un scrypt.
    await verifyPassword(password, DUMMY_PASSWORD_SALT, await getDummyPasswordHash());
    return null;
  }

  const motDePasseValide = await verifyPassword(password, user.sel, user.hash);

  // La verification du mot de passe est faite AVANT de regarder `actif`, pour
  // qu'un compte desactive coute exactement le meme temps qu'un compte actif.
  if (!motDePasseValide || !user.actif) return null;

  return {
    id: user.id,
    identifiant: user.identifiant,
    role: isKnownRole(user.role) ? user.role : DEFAULT_ROLE
  };
}

function handleLogout(req, res) {
  // Garde-fous (25/09) : la session est FERMEE cote serveur, pas seulement
  // effacee du navigateur (une copie du cookie ne sert plus a rien).
  const valeur = getAccessSessionCookie(req);
  const session = readAccessSession(valeur);
  if (session) fermerSession(valeur, session);
  res.setHeader("Set-Cookie", buildAuthCookie("", 0, req));
  res.redirect(303, "/login");
}

function requireTrustedApiRequest(req, res, next) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");

  if (origin && !isAllowedOrigin(origin, req)) {
    res.status(403).json({ error: "Requete refusee hors application locale" });
    return;
  }

  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    res.status(403).json({ error: "Requete refusee hors application locale" });
    return;
  }

  next();
}

function isAllowedOrigin(origin, req) {
  try {
    const originUrl = new URL(origin);
    const requestHost = req.get("host");
    return Boolean(requestHost && originUrl.host === requestHost);
  } catch {
    return false;
  }
}

function defaultDb() {
  return {
    clients: [],
    ventes: [],
    stock: [],
    historique: [],
    commandes: [],
    routes: [],
    relances: [],
    subscriptions: [],
    deliverySectors: defaultDeliverySectors(),
    stockMovements: [],
    importsArchives: [],
    settings: {
      appearance: {
        themeId: "sereo",
        brandImage: "",
        // colorScheme : "auto" suit l'OS (prefers-color-scheme), "light"/"dark" force.
        // Defaut "light" en attendant que le mode sombre soit valide en production.
        // Les utilisateurs peuvent passer en "auto" ou "dark" via le toggle Parametres.
        colorScheme: "light"
      },
      // Revue R1 NIT-18 : alignement avec normalizeSettings (defaut prod).
      orderNumbering: { prefix: "CMD", resetAnnually: true },
      // Lot 6 (audit geo) : pas de depot tant qu'on ne l'a pas choisi, retour
      // au depot coche, texte du SMS « Prevenir » par defaut.
      tournee: { averageSpeedKmh: 28, stopDurationMin: 6, depot: null, retourAuDepot: true, messagePrevenir: MESSAGE_PREVENIR_DEFAUT }
    }
  };
}

const VALID_COLOR_SCHEMES = new Set(["auto", "light", "dark"]);

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function useSqliteStorage() {
  return STORAGE_ENGINE !== "json";
}

let sqliteStore;
// B3 (v1.16.0) : trace de la derniere recovery de corruption SQLite, exposee
// via /api/storage/status et journalisee dans l'historique au boot. Permet a
// l'operateur de SAVOIR qu'un sinistre a eu lieu (sinon une base vierge ressemble
// a une install neuve et il re-saisit par-dessus sans le savoir).
let lastStorageRecovery = null;
// Memorise un echec TOTAL de recovery (disque plein...) pour ne pas la rejouer
// a chaque requete (revue #2).
let storageRecoveryFatal = null;
// Lot 3 (audit 2026-07-08) : apres une recovery "fresh_empty" (base repartie
// VIERGE), les backups auto sont suspendus pour ne pas gzipper du vide et
// evincer les backups historiques. MAIS ils DOIVENT reprendre des que
// l'operateur re-saisit de vraies donnees, sinon une 2e corruption = perte
// totale definitive (avant : suspension a vie, flag jamais re-arme). Ce flag
// porte la suspension ; writeDb la leve au 1er write contenant des donnees.
let backupsSuspendedFreshEmpty = false;
// Lot 3 : sante des backups exposee via /api/storage/status. Avant, un echec
// de backup async etait totalement silencieux (fausse securite) : l'app
// pouvait tourner des jours sans nouveau backup en paraissant saine.
let lastBackupAt = null;
let lastBackupError = null;
// Carte « Sauvegardes » (24/09) : l'instant de la derniere ecriture de donnees
// DE CE PROCESSUS (ms), ou null s'il n'a encore rien ecrit. Une sauvegarde ne
// part qu'apres une ecriture, au plus une par heure : sans ecriture, une
// sauvegarde de trois jours reste a jour (un week-end sans activite n'est pas
// une panne). L'alerte « perimee » veut donc une ecriture PLUS RECENTE que la
// derniere sauvegarde. Les deux ecritures internes (la mise en coherence du
// demarrage, la ligne d'historique d'une sauvegarde manuelle) ne comptent pas.
let derniereModificationA = null;
// Au-dela, une sauvegarde qui ne couvre pas la derniere ecriture est signalee.
const SAUVEGARDE_PERIMEE_MS = 24 * 60 * 60 * 1000;
// Nombre max de fichiers .corrupt-<ts> conserves (forensic) avant purge
const QUARANTINE_RETENTION = 5;

function openSqliteStore(options = {}) {
  return createSqliteStore({
    sqlitePath: SQLITE_PATH,
    // Revue #2 : sur le chemin recovery-vierge, on passe seedJsonPath=null pour
    // que la base soit VRAIMENT vide et ne ressuscite PAS un db.json legacy
    // perime (sinon le message "base vierge" est mensonger et l'operateur voit
    // reapparaitre du stock/clients fantomes).
    seedJsonPath: options.skipJsonSeed ? null : DB_PATH,
    defaultDb,
    normalizeDb,
    normaliserTable,
    // Leur normalisation pose des defauts a la lecture (date, id, secteurs par
    // defaut) : toujours ecrites, comme avant, meme sans avoir ete lues.
    tablesToujoursEcrites: ["relances", "deliverySectors", "settings"],
    ensureDir
  });
}

function getSqliteStore() {
  if (!sqliteStore) {
    // Revue #2 : si une recovery a deja totalement echoue (disque plein...),
    // on ne la rejoue PAS a chaque requete (sinon spam de quarantaines + boucle
    // CPU/IO + logs). On re-throw l'erreur memorisee directement.
    if (storageRecoveryFatal) {
      throw storageRecoveryFatal;
    }
    try {
      sqliteStore = openSqliteStore();
    } catch (error) {
      // Revue #3 (HIGH) : la recovery est DESTRUCTIVE (quarantaine + wipe). On
      // ne la declenche QUE sur une corruption AVEREE. Une erreur transitoire
      // (verrou "database is locked", I/O, permission) sur une base SAINE ne
      // doit PAS detruire les donnees : on re-throw, le serveur echoue proprement
      // et reessaiera au prochain boot (ex: l'autre container relache le verrou).
      if (!isCorruptionError(error)) {
        console.error(`[storage] Ouverture SQLite echouee mais NON-corruption (${error.code || error.message}). Pas de recovery destructive - re-throw.`);
        throw error;
      }
      // B3 (v1.16.0) : corruption avEREE (coupure courant, disque defaillant).
      // Recovery : quarantaine -> restore backup -> sinon base vierge.
      console.error(`[storage] Corruption SQLite averee (${error.code || error.message}). Tentative de recovery...`);
      try {
        sqliteStore = recoverCorruptSqliteStore(error);
      } catch (fatalError) {
        // Recovery elle-meme impossible (disque plein/permissions) : on memorise
        // pour ne pas rejouer, et on propage.
        storageRecoveryFatal = fatalError;
        throw fatalError;
      }
    }
  }

  return sqliteStore;
}

// Revue #3 : distingue une corruption AVEREE (recovery destructive justifiee)
// d'une erreur transitoire (verrou, I/O, permission - NE PAS detruire la base).
// Liste blanche stricte : on ne recovery QUE sur les signatures de corruption
// connues ; tout le reste est traite comme transitoire (fail-safe = preserver).
function isCorruptionError(error) {
  if (!error) return false;
  // Combine message ET errstr : node:sqlite peut porter la signature dans l'un
  // ou l'autre selon la version/le contexte.
  const msg = [error.message, error.errstr].filter(Boolean).join(" ").toLowerCase();
  return (
    msg.includes("file is not a database")
    || msg.includes("not a database")
    || msg.includes("malformed")          // "database disk image is malformed"
    || msg.includes("file is encrypted")  // header illisible
    || msg.includes("quick_check a echoue")
  );
}

// Nettoie les fichiers sidecar WAL/SHM (peuvent etre corrompus eux aussi)
function removeSqliteSidecars() {
  for (const ext of ["-wal", "-shm"]) {
    try { fs.unlinkSync(SQLITE_PATH + ext); } catch { /* absent : ok */ }
  }
}

// Quarantaine du fichier corrompu pour un eventuel sauvetage externe
// (sqlite3 .recover) AVANT que la recovery ne l'ecrase.
// Revue #2 : (1) on quarantaine AUSSI les sidecars -wal/-shm car des donnees
// committees peuvent y vivre (WAL non checkpointe apres coupure). (2) tag unique
// avec compteur pour eviter la collision si 2 recoveries dans la meme ms.
// (3) fallback rename si copy echoue (disque plein) : rename ne consomme pas
// d'espace et preserve quand meme l'original.
let quarantineCounter = 0;
function quarantineCorruptFile() {
  if (!fs.existsSync(SQLITE_PATH)) return null;
  const tag = `${safeTimestamp()}-${++quarantineCounter}`;
  const quarantinePath = `${SQLITE_PATH}.corrupt-${tag}`;
  // Sidecars d'abord (best-effort, copie pour preserver le WAL committe)
  for (const ext of ["-wal", "-shm"]) {
    if (fs.existsSync(SQLITE_PATH + ext)) {
      try { fs.copyFileSync(SQLITE_PATH + ext, quarantinePath + ext); } catch { /* best-effort */ }
    }
  }
  try {
    fs.copyFileSync(SQLITE_PATH, quarantinePath);
    console.error(`[storage] Fichier corrompu copie en quarantaine : ${quarantinePath}`);
    return quarantinePath;
  } catch (copyErr) {
    // Disque plein probable : on tente un rename (move) qui ne consomme pas
    // d'espace, pour preserver quand meme l'original avant le wipe.
    try {
      fs.renameSync(SQLITE_PATH, quarantinePath);
      console.error(`[storage] Copie impossible (${copyErr.code || copyErr.message}), fichier deplace en quarantaine : ${quarantinePath}`);
      return quarantinePath;
    } catch (renameErr) {
      console.error(`[storage] Quarantaine impossible (copy: ${copyErr.code || copyErr.message}, rename: ${renameErr.code || renameErr.message}) - le fichier corrompu sera ecrase.`);
      return null;
    }
  }
}

// Purge les vieux fichiers .corrupt-* pour eviter de saturer le disque (chacun
// peut peser autant que la base). On garde les QUARANTINE_RETENTION plus recents.
function pruneOldQuarantineFiles() {
  try {
    const dir = path.dirname(SQLITE_PATH);
    const prefix = `${path.basename(SQLITE_PATH)}.corrupt-`;
    fs.readdirSync(dir)
      .filter(name => name.startsWith(prefix))
      .map(name => {
        const full = path.join(dir, name);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
        return { full, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(QUARANTINE_RETENTION)
      .forEach(e => { try { fs.unlinkSync(e.full); } catch { /* best-effort */ } });
  } catch { /* best-effort */ }
}

// Plafond de decompression d'un backup pour eviter un OOM sur un .gz forge/gonfle
const MAX_BACKUP_DECOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1 Go

function recoverCorruptSqliteStore(originalError) {
  // 1. Quarantaine par COPIE (preserve l'original recuperable). On capture le
  //    succes pour le chemin fresh_empty (revue #3 : ne pas wiper sans sauvegarde).
  const quarantinePath = quarantineCorruptFile();
  removeSqliteSidecars();

  // 2. Restaurer le backup gzip le plus recent (du plus recent au plus ancien).
  const backups = listBackupEntries().filter(entry => entry.name.endsWith(".sqlite.gz"));
  for (const entry of backups) {
    let raw;
    try {
      const compressed = fs.readFileSync(entry.fullPath);
      raw = zlib.gunzipSync(compressed, { maxOutputLength: MAX_BACKUP_DECOMPRESSED_BYTES });
    } catch (gzErr) {
      // Backup .gz illisible/corrompu/trop gros : essayer le suivant (non destructif)
      console.error(`[storage] Backup ${entry.name} illisible (${gzErr.code || gzErr.message}), suivant...`);
      continue;
    }
    try {
      fs.writeFileSync(SQLITE_PATH, raw);
    } catch (writeErr) {
      // Revue #3 : erreur d'ecriture NON liee au backup (disque plein, FS en
      // lecture seule). On ABANDONNE (re-throw) au lieu de wiper en fresh_empty :
      // un bon backup existe peut-etre, et l'environnement est defaillant.
      console.error(`[storage] Ecriture du restore impossible (${writeErr.code || writeErr.message}) - abandon recovery, base NON wipee.`);
      throw writeErr;
    }
    removeSqliteSidecars();
    try {
      // Revue #4 : skipJsonSeed pendant la recovery -> ne JAMAIS ressusciter un
      // db.json legacy par-dessus le backup restaure (sinon faux "restore reussi"
      // affichant du stock/clients fantomes). Un backup Sereo legitime contient
      // deja app_meta.initialized, donc ce flag ne change rien pour les vrais
      // backups ; il blinde juste contre les backups vides/etrangers.
      const store = openSqliteStore({ skipJsonSeed: true }); // valide que le backup s'ouvre vraiment
      const backupAgeMin = Math.round((Date.now() - entry.mtimeMs) / 60000);
      lastStorageRecovery = {
        at: new Date().toISOString(),
        mode: "restored_backup",
        source: entry.name,
        message: `Base restauree depuis le backup ${entry.name} (~${backupAgeMin} min de donnees potentiellement perdues)`
      };
      console.error(`[storage] RECOVERY: ${lastStorageRecovery.message}`);
      pruneOldQuarantineFiles();
      return store;
    } catch (openErr) {
      if (!isCorruptionError(openErr)) {
        // Erreur transitoire a l'ouverture du backup restaure (verrou, I/O) :
        // abandonner plutot que de continuer vers fresh_empty destructif.
        console.error(`[storage] Ouverture du backup restaure echouee (NON-corruption: ${openErr.code || openErr.message}) - abandon recovery.`);
        throw openErr;
      }
      // Backup structurellement corrompu : nettoyer et essayer le suivant
      try { fs.unlinkSync(SQLITE_PATH); } catch { /* best-effort */ }
      removeSqliteSidecars();
      console.error(`[storage] Backup ${entry.name} corrompu (${openErr.code || openErr.message}), suivant...`);
    }
  }

  // 3. Aucun backup exploitable : base vierge. Revue #3 : si la quarantaine a
  //    TOTALEMENT echoue (quarantinePath null) ET qu'un fichier corrompu existe
  //    encore, on REFUSE de le wiper (re-throw) pour preserver l'original
  //    recuperable par un outil externe. Mieux vaut un serveur qui refuse de
  //    demarrer qu'une perte de donnees definitive non sauvegardee.
  if (!quarantinePath && fs.existsSync(SQLITE_PATH)) {
    console.error(
      `[storage] RECOVERY ABANDONNEE : aucun backup ET quarantaine impossible. `
      + `Le fichier corrompu est PRESERVE (pas de wipe) pour recuperation manuelle. `
      + `Erreur initiale: ${originalError.message}`
    );
    throw originalError;
  }

  try {
    try { fs.unlinkSync(SQLITE_PATH); } catch { /* best-effort */ }
    removeSqliteSidecars();
    const freshStore = openSqliteStore({ skipJsonSeed: true }); // vraiment vide
    lastStorageRecovery = {
      at: new Date().toISOString(),
      mode: "fresh_empty",
      source: null,
      message: `Aucun backup exploitable : base reinitialisee VIERGE (donnees perdues). Erreur initiale: ${originalError.message}`
    };
    // Lot 3 : suspend les backups auto TANT QUE la base reste vide (evite de
    // gzipper du vide et d'evincer d'eventuels backups). writeDb re-arme des la
    // 1ere re-saisie de donnees (sinon perte totale a la 2e corruption).
    backupsSuspendedFreshEmpty = true;
    console.error(`[storage] RECOVERY: ${lastStorageRecovery.message}`);
    pruneOldQuarantineFiles();
    return freshStore;
  } catch (freshError) {
    console.error(
      `[storage] RECOVERY ECHEC TOTAL : impossible de creer une base vierge `
      + `(${freshError.code || freshError.message}). Storage indisponible - `
      + `verifier l'espace disque et les permissions du volume.`
    );
    throw freshError;
  }
}

function closeStorage() {
  if (sqliteStore) {
    // Revue #2 : close() protege. Si close throw (double close, handle invalide
    // apres recovery, EBUSY Windows), on remet quand meme sqliteStore a null
    // pour qu'un getSqliteStore() ulterieur retente une ouverture propre plutot
    // que de garder un store pointant un handle mort.
    try { sqliteStore.close(); } catch { /* handle deja invalide */ }
    sqliteStore = null;
  }
}

function readDb() {
  if (useSqliteStorage()) {
    return getSqliteStore().readDb();
  }

  if (!fs.existsSync(DB_PATH)) {
    writeDb(defaultDb(), { backup: false });
  }

  const raw = fs.readFileSync(DB_PATH, "utf8");
  let db;
  if (!raw) {
    db = defaultDb();
  } else {
    try {
      db = JSON.parse(raw);
    } catch (error) {
      // db.json corrompu (coupure courant pendant ecriture, etc.) :
      // on sauvegarde le fichier corrompu et on redemarre avec une base vierge
      // plutot que de crasher tout le serveur (qui rendrait /login inaccessible).
      const brokenPath = `${DB_PATH}.broken-${safeTimestamp()}`;
      try { fs.copyFileSync(DB_PATH, brokenPath); } catch { /* best-effort */ }
      console.error(`[readDb] db.json corrompu, sauvegarde dans ${brokenPath} - redemarrage en mode vierge :`, error.message);
      db = defaultDb();
    }
  }

  return normalizeDb(db);
}

// Chaque table se normalise SEULE (24/09) : la lecture paresseuse de la base
// (storage/sqliteStore.js, readDb) ne normalise que les tables qu'une requete
// lit. normalizeDb les normalise toutes, comme avant.
const TABLES_DE_LA_BASE = ["clients", "ventes", "stock", "historique", "commandes", "routes", "subscriptions",
  "relances", "deliverySectors", "stockMovements", "importsArchives", "settings"];

function normaliserTable(cle, valeur, db) {
  if (cle === "relances") return Array.isArray(valeur) ? valeur.map(normalizeCrmReminder) : [];
  if (cle === "deliverySectors") {
    const secteurs = Array.isArray(valeur) ? valeur.map(normalizeDeliverySector) : defaultDeliverySectors();
    return secteurs.length ? secteurs : defaultDeliverySectors().map(normalizeDeliverySector);
  }
  if (cle === "settings") return normalizeSettings(valeur);
  const liste = Array.isArray(valeur) ? valeur : [];
  // Migration retroactive v1.9.0 : attribuer un numero aux commandes qui n'en
  // ont pas (legacy avant cette release). Numerotation chronologique par
  // dateImport pour preserver l'ordre historique reel. (ensureOrderNumbers ne
  // lit que les commandes et les reglages, qu'il normalise lui-meme.)
  if (cle === "commandes") ensureOrderNumbers({ commandes: liste, settings: db.settings });
  return liste;
}

function normalizeDb(db) {
  // Lecture paresseuse (25/09) : une table qu'une ecriture n'a pas lue n'a pas
  // change ; la normaliser la lirait pour rien, et l'ecriture la saute
  // (storage/sqliteStore.js, persistDatabase). `lue` est relu a chaque tour :
  // une table lue en normalisant une autre (les reglages, pour les numeros de
  // commande) est normalisee a son tour, comme avant.
  const etat = db[ETAT_DE_LECTURE];
  for (const cle of TABLES_DE_LA_BASE) {
    if (etat && !etat.lue(cle)) continue;
    db[cle] = normaliserTable(cle, db[cle], db);
  }

  // P1 v1.14.0 : syncWorkflow N'EST PLUS appele ici (avant : a chaque readDb,
  // ce qui ajoutait 50-100ms a chaque requete GET). Il est maintenant appele
  // UNIQUEMENT dans writeDb() avant persistance + au boot du serveur via
  // healDatabaseAtBoot(). Apres tout writeDb la base SQLite est sync, donc
  // les readDb suivants lisent du sync sans recalculer.
  return db;
}

// P1 v1.14.0 : data healing au boot. Si la base SQLite a ete creee par une
// ancienne version sans syncWorkflow OU si elle a ete restauree depuis un
// backup, on s'assure que l'etat est coherent avant d'accepter des requetes.
// Appel unique au demarrage : pas de cout sur les requetes suivantes.
function healDatabaseAtBoot() {
  try {
    const db = readDb();
    // Migration unique et idempotente (25/09) : le montant TTC des commandes
    // dont le CA venait des ventes est fige sur elles (figerMontantsImportes).
    figerMontantsImportes(db, "demarrage");
    // La mise en coherence (syncWorkflow) est faite par writeDb, plus bas : la
    // refaire ici doublait le demarrage (25/09 : 35 s -> 19 s a cinquante fois
    // la base). Rien entre les deux ne lit ce qu'elle calcule : le journal de
    // recuperation ne fait qu'ajouter une ligne, et le rognage des traces
    // arrondit lui-meme la position (positionGpsArrondie).
    // B3 v1.16.0 : si une recovery de corruption a eu lieu pendant le readDb
    // ci-dessus, on la journalise dans l'historique pour que l'operateur la voie
    // (sinon une base vierge ressemble a une install neuve).
    if (lastStorageRecovery) {
      addHistory(db, "Recovery storage", lastStorageRecovery.message, {
        mode: lastStorageRecovery.mode,
        source: lastStorageRecovery.source,
        at: lastStorageRecovery.at
      });
    }
    // Revue du 23/09 (lot 5) : la position « Me localiser » exacte ne dort plus
    // dans le trace des tournees terminees calculees avant le lot.
    rognerTracesGpsTerminees(db);
    // La mise en coherence du demarrage n'est pas une saisie : elle ne rend
    // pas la derniere sauvegarde « perimee » (carte Sauvegardes, 24/09).
    writeDb(db, { backup: false, modification: false });
    if (lastStorageRecovery) {
      console.error(`[boot] ATTENTION : recovery storage detectee au demarrage (${lastStorageRecovery.mode}).`);
    } else {
      console.log("[boot] base coherente apres syncWorkflow initial");
    }
  } catch (error) {
    console.error("[boot] healDatabaseAtBoot a echoue :", error.message);
  }
}

function ensureOrderNumbers(db) {
  const missingNumero = db.commandes.filter(order => !order.numero);
  if (missingNumero.length === 0) return;

  // Tri chronologique stable : dateImport asc, fallback createdAt, fallback id
  // pour garantir l'ordre meme sur des dates manquantes.
  missingNumero.sort((a, b) => {
    const dateA = String(a.dateImport || a.createdAt || "");
    const dateB = String(b.dateImport || b.createdAt || "");
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  // Chantier 2 (audit 2026-06-04) : avant ce fix, chaque appel a
  // generateOrderNumber re-scannait TOUS les numeros existants pour trouver
  // le max -> O(M * (N+M)) au boot sur 5000+ commandes (500 ms+).
  //
  // Maintenant : on pre-compute UNE fois le compteur max par annee, et on
  // incremente localement a chaque allocation. O(N+M).
  const settings = normalizeSettings(db.settings || {});
  const { prefix, resetAnnually } = settings.orderNumbering;
  const existingNumeros = db.commandes.map(o => o.numero).filter(Boolean);

  let continuousCounter = 0;
  const counterByYear = new Map();

  if (resetAnnually) {
    const yearPattern = new RegExp(`^${prefix}-(\\d{4})-(\\d+)$`);
    for (const numero of existingNumeros) {
      const match = numero.match(yearPattern);
      if (!match) continue;
      const year = match[1];
      const seq = Number(match[2]);
      if (!Number.isFinite(seq)) continue;
      const current = counterByYear.get(year) || 0;
      if (seq > current) counterByYear.set(year, seq);
    }
  } else {
    const continuousPattern = new RegExp(`^${prefix}-(\\d+)$`);
    for (const numero of existingNumeros) {
      const match = numero.match(continuousPattern);
      if (!match) continue;
      const seq = Number(match[1]);
      if (Number.isFinite(seq) && seq > continuousCounter) continuousCounter = seq;
    }
  }

  missingNumero.forEach(order => {
    if (!order.dateCommande) {
      // Revue R1 MINOR-14 + R3 hardening : forcer YYYY-MM-DD (10 chars).
      const raw = order.dateImport || order.createdAt || new Date().toISOString();
      const dateStr = raw instanceof Date ? raw.toISOString() : String(raw);
      // dateImport et createdAt sont des INSTANTS : leur jour est celui de Paris.
      order.dateCommande = jourDeLInstant(raw) || dateStr.slice(0, 10);
    }
    if (resetAnnually) {
      const year = String(extractYear(order.dateCommande));
      const next = Math.max(counterByYear.get(year) || 0, plancherDeNumero(db, `${prefix}-${year}`)) + 1;
      counterByYear.set(year, next);
      order.numero = `${prefix}-${year}-${String(next).padStart(3, "0")}`;
    } else {
      continuousCounter = Math.max(continuousCounter, plancherDeNumero(db, prefix)) + 1;
      order.numero = `${prefix}-${String(continuousCounter).padStart(5, "0")}`;
    }
  });
}

// Lot 6 (audit geo) : le depot par defaut. Un libelle (200 caracteres au plus :
// l'audit a vu 200 000 acceptes pour un depart) et une position valide, ou rien.
const DEPOT_LIBELLE_MAX = 200;
const MESSAGE_PREVENIR_MAX = 300;
const MESSAGE_PREVENIR_DEFAUT = "Bonjour, je passe vers {heure} pour votre livraison.";
// L'horizon de « A recommander », en jours (Parametres, 24/09).
const HORIZON_MIN_JOURS = 7;
const HORIZON_MAX_JOURS = 30;
const HORIZON_DEFAUT_JOURS = 14;

function normalizeSettings(settings = {}) {
  const appearance = settings && typeof settings === "object" && settings.appearance && typeof settings.appearance === "object"
    ? settings.appearance
    : {};

  const rawColorScheme = clean(appearance.colorScheme).toLowerCase();
  // Defaut "light" : les utilisateurs sans preference explicite voient le mode clair,
  // ce qui evite un changement visuel surprenant pendant la phase de test du dark mode.
  const colorScheme = VALID_COLOR_SCHEMES.has(rawColorScheme) ? rawColorScheme : "light";

  const orderNumberingRaw = settings && typeof settings === "object" && settings.orderNumbering && typeof settings.orderNumbering === "object"
    ? settings.orderNumbering
    : {};
  // Prefixe alphanumerique 2-8 chars (CMD, ORD, BC, etc.). Defaut CMD.
  const rawPrefix = clean(orderNumberingRaw.prefix).toUpperCase();
  const prefix = /^[A-Z0-9]{2,8}$/.test(rawPrefix) ? rawPrefix : "CMD";
  // resetAnnually par defaut true (standard ERP francais : compteur reset
  // chaque 1er janvier). False = compteur continu (jamais reset).
  const resetAnnually = orderNumberingRaw.resetAnnually !== false;

  // v1.17.1 : parametres tournee calibrables. Defaut 28 km/h + 6 min/arret
  // (estimation initiale apres passage en Haversine). Bornes pour eviter
  // saisies aberrantes : vitesse [10,60] km/h, arret [0,30] min.
  const tourneeRaw = settings && typeof settings === "object" && settings.tournee && typeof settings.tournee === "object"
    ? settings.tournee
    : {};
  const rawSpeed = Number(tourneeRaw.averageSpeedKmh);
  const averageSpeedKmh = Number.isFinite(rawSpeed) && rawSpeed >= 10 && rawSpeed <= 60 ? rawSpeed : 28;
  const rawStop = Number(tourneeRaw.stopDurationMin);
  const stopDurationMin = Number.isFinite(rawStop) && rawStop >= 0 && rawStop <= 30 ? rawStop : 6;
  // Lot 6 (audit geo) : le depot par defaut (le depart prerempli d'une tournee),
  // « retour au depot » coche par defaut, et le texte du SMS « Prevenir ».
  const depot = normaliserDepot(tourneeRaw.depot);
  const retourAuDepot = tourneeRaw.retourAuDepot !== false;
  const messagePrevenir = typeof tourneeRaw.messagePrevenir === "string" && tourneeRaw.messagePrevenir.trim()
    ? tourneeRaw.messagePrevenir.trim().slice(0, MESSAGE_PREVENIR_MAX)
    : MESSAGE_PREVENIR_DEFAUT;

  // « A recommander » qui voit venir (decision de Thomas du 24/09) : l'horizon,
  // en jours, des commandes planifiees et des echeances d'abonnement comptees.
  // Le delai de reassort fournisseur : 7 a 30 jours, 14 par defaut.
  const stockRaw = settings && typeof settings === "object" && settings.stock && typeof settings.stock === "object"
    ? settings.stock
    : {};
  const rawHorizon = Number(stockRaw.horizonJours);
  const horizonJours = Number.isInteger(rawHorizon) && rawHorizon >= HORIZON_MIN_JOURS && rawHorizon <= HORIZON_MAX_JOURS
    ? rawHorizon
    : HORIZON_DEFAUT_JOURS;

  // Revue R1 NIT-15 + R2 minor : si `settings` est une string corrompue,
  // `...settings` spread les indices de caracteres ("0":"a", "1":"b", ...).
  // Si `settings` est un Array, `typeof === "object"` passe mais on spread
  // les indices numeriques. Protection : objet plain (pas Array).
  const base = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  return {
    ...base,
    appearance: {
      themeId: clean(appearance.themeId) || "sereo",
      brandImage: clean(appearance.brandImage),
      colorScheme
    },
    orderNumbering: {
      prefix,
      resetAnnually
    },
    tournee: {
      averageSpeedKmh,
      stopDurationMin,
      depot,
      retourAuDepot,
      messagePrevenir
    },
    stock: {
      horizonJours
    }
  };
}


function normaliserDepot(brut) {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return null;
  const point = routing.coordinates(brut);
  const label = clean(brut.label).slice(0, DEPOT_LIBELLE_MAX);
  if (!point || !label) return null;
  return { label, lat: point.lat, lng: point.lng };
}

function getAppearanceSettings(db) {
  db.settings = normalizeSettings(db.settings);
  return {
    ...db.settings.appearance
  };
}

function validateBrandImage(value) {
  const brandImage = clean(value);
  if (!brandImage) return "";

  if (brandImage.length > MAX_BRAND_IMAGE_DATA_URL_SIZE) {
    throw badRequest("Image trop lourde");
  }

  if (brandImage.startsWith("/brand/")) return brandImage;

  if (!brandImage.startsWith("data:image/") || !brandImage.includes(";base64,")) {
    throw badRequest("Format d'image invalide");
  }

  return brandImage;
}

// Lot 3 : la base contient-elle des donnees metier reelles ? Sert a re-armer
// les backups apres une recovery fresh_empty (ne re-armer que sur du contenu).
function dbHasData(db) {
  return Boolean(
    (db.commandes && db.commandes.length)
    || (db.clients && db.clients.length)
    || (db.stock && db.stock.length)
    || (db.ventes && db.ventes.length)
  );
}

function writeDb(db, options = {}) {
  const { backup = true, modification = true } = options;

  syncWorkflow(db);

  // Lot 3 (audit 2026-07-08) : re-armer les backups auto si l'operateur a
  // re-saisi des donnees apres une recovery fresh_empty. Fait AVANT l'ecriture
  // pour que l'entree d'historique soit persistee dans ce meme write.
  let forceReArmBackup = false;
  if (backupsSuspendedFreshEmpty && dbHasData(db)) {
    backupsSuspendedFreshEmpty = false;
    // Revue #84 : on FORCE le backup de re-arm (bypass throttle). Sinon, quand
    // le fresh_empty vient de .gz CORROMPUS laisses sur disque par la recovery
    // (mtime recent), le throttle 1h se cale dessus et les donnees re-saisies
    // ne sont pas sauvegardees pendant ~1h -> fenetre de re-perte totale.
    forceReArmBackup = true;
    addHistory(db, "Stockage", "Backups automatiques reactives : donnees re-saisies apres reinitialisation vierge.");
  }

  // Ecriture des donnees AVANT tout backup : le backup est un filet de
  // securite, pas un prerequis. Si le disque est plein, on veut au moins que
  // l'application echoue sur l'ecriture des donnees (visible) plutot que sur
  // un backup invisible. Cf revue R1 chantier 1 P1 #2.
  if (useSqliteStorage()) {
    getSqliteStore().writeDb(db);
  } else {
    ensureDir(path.dirname(DB_PATH));
    const tempPath = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), "utf8");
    fs.renameSync(tempPath, DB_PATH);
  }
  if (modification) derniereModificationA = Date.now();

  // Chantier 2 : backup async fire-and-forget. Le main thread ne bloque
  // plus 300-800 ms sur gzipSync d'une base 100 MB — la compression part
  // sur le threadpool libuv via stream pipeline. La requete HTTP repond
  // immediatement apres l'ecriture des donnees.
  //
  // pendingBackup expose une Promise pour les tests qui veulent attendre
  // la fin du backup avant d'assertioner sur le filesystem.
  //
  // Revue #84 : on SERIALISE les backups async (skip si un backup est deja en
  // vol, sauf re-arm force). Deux backups concurrents (fire-and-forget, hors
  // verrou) provoquaient un signal de sante incoherent (un echec tardif
  // ecrasant un succes plus recent) et un risque de torn-read.
  if (backup && (forceReArmBackup || !pendingBackup)) {
    pendingBackup = backupDbIfNeededAsync({ force: forceReArmBackup })
      .catch(backupError => {
        // Lot 3 : tracer l'echec (expose via /api/storage/status) au lieu de le
        // perdre dans les logs -> fin de la "fausse securite" du fire-and-forget.
        lastBackupError = { at: new Date().toISOString(), message: String(backupError.message || backupError) };
        console.error(`[storage] Backup async echec (mutation deja persistee): ${backupError.message || backupError}`);
      })
      .finally(() => { pendingBackup = null; });
  }
}

// Promise du dernier backup async en vol. Utilise par les tests pour
// `await flushPendingBackup()` avant d'assertioner sur le filesystem.
let pendingBackup = null;
async function flushPendingBackup() {
  while (pendingBackup) {
    await pendingBackup;
  }
}

// ============================================================================
// Verrou applicatif global pour les ecritures (Chantier 1, audit 2026-06-04)
// ============================================================================
// Pattern : queue Promise minimaliste sans dependance. Tous les handlers qui
// font le pattern read-mutate-write doivent passer par withWriteLock(async ()
// => { ... }) pour serialiser leurs ecritures. Les LECTURES seules ne
// passent PAS par ici (pas de blocage des GET).
//
// Pourquoi : SQLite BEGIN IMMEDIATE protege l'atomicite SQL mais pas
// l'isolation applicative — `db = readDb(); ...; writeDb(db)` laisse une
// fenetre TOCTOU ou deux requetes lisent le meme snapshot, modifient en
// memoire, puis ecrivent l'une apres l'autre : la 1re ecriture est perdue.
//
// Implementation : une chaine de promesses serialisees. Chaque appel attend
// la fin du precedent (succes OU echec — un fix qui throw ne doit pas
// geler la queue).
//
// Revue R1 chantier 1 (P1 #1) : timeout 60s sur previousQueue ET sur fn(),
// pour eviter qu'un handler bloque (disque defaillant, SQLite verrouille
// indefiniment) ne deadlock toute la chaine d'ecritures. En cas de timeout,
// on log mais on libere le maillon pour ne pas figer les suivants.
const WRITE_LOCK_TIMEOUT_MS = 60000; // 60s — suffit largement pour un import 30MB
let writeQueue = Promise.resolve();

// Promise.race avec setTimeout, MAIS unref pour ne pas retenir le process
// Node a la fin des tests, ET clearTimeout sur succes pour ne pas accumuler
// des handles. Sans cela, chaque withWriteLock laisse un setTimeout actif
// pendant 60s, ce qui empeche `node --test` de quitter rapidement.
async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`withWriteLock: ${label} timeout apres ${ms}ms`)),
      ms
    );
    if (timeoutId.unref) timeoutId.unref();
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function withWriteLock(fn) {
  const previousQueue = writeQueue;
  let resolveNext;
  let rejectNext;
  const next = new Promise((resolve, reject) => {
    resolveNext = resolve;
    rejectNext = reject;
  });
  writeQueue = next.catch(() => {}); // chaine ne meurt jamais

  // Attendre le maillon precedent avec timeout
  try {
    await withTimeout(previousQueue, WRITE_LOCK_TIMEOUT_MS, "previousQueue");
  } catch (err) {
    console.warn(`[lock] previousQueue ${err.message}`);
  }

  // Executer fn() avec timeout
  try {
    const result = await withTimeout(
      Promise.resolve().then(fn),
      WRITE_LOCK_TIMEOUT_MS,
      "fn()"
    );
    resolveNext(result);
    return result;
  } catch (err) {
    rejectNext(err);
    throw err;
  }
}

// Limite la frequence des backups pour ne pas saturer le disque.
// Un backup au plus toutes les BACKUP_THROTTLE_MS, et on conserve uniquement
// les BACKUP_RETENTION plus recents (les plus anciens sont supprimes).
// Les backups sont compresses en gzip pour reduire l'occupation disque
// (typiquement -65% sur une base SQLite).
const BACKUP_THROTTLE_MS = 60 * 60 * 1000; // 1h
const BACKUP_RETENTION = 30;
// Decision de Thomas du 24/09 : EN PLUS des 30 dernieres, une sauvegarde par
// jour (de Paris) pendant 30 jours. Voir sauvegardesAGarder().
const BACKUP_JOURS_JOURNALIERES = 30;
// Garde-fous (25/09, decision 4) : et une par semaine (de Paris, du lundi au
// dimanche) pendant 8 semaines.
const BACKUP_SEMAINES_HEBDOMADAIRES = 8;
// Decision 5 : la sauvegarde faite avant « Purger les bons de commande » est
// HORS rotation -- ni les horaires ni les manuelles ne l'evincent. Le nom de
// genre est reserve (« Sauvegarder maintenant » ne peut pas le prendre).
const GENRE_AVANT_PURGE_COMMANDES = "avant-purge-commandes";
const MOTIF_HORS_ROTATION = /-avant-purge-commandes\.(sqlite|json)\.gz$/;
const BACKUP_FILENAME_PATTERN = /^db-.*\.(sqlite|json)(\.gz)?$/;

// Relecture adverse du 26/09 : les fichiers de travail d'une sauvegarde en
// cours (`…sqlite.gz.travail-copie.sqlite`, `…travail-verif.sqlite`) passaient
// le motif. Plus recents que tout, ils devenaient « la derniere » le temps de
// la copie : servis au telechargement (une base brute en cours d'ecriture),
// affiches sur la carte, comptes par la rotation. Ils ne sont jamais une
// sauvegarde (MOTIF_TRAVAIL, le meme que le nettoyage du demarrage).
function listBackupEntries(dossier = BACKUP_DIR) {
  if (!fs.existsSync(dossier)) return [];
  return fs.readdirSync(dossier)
    .filter(name => BACKUP_FILENAME_PATTERN.test(name) && !sauvegardeBase.MOTIF_TRAVAIL.test(name))
    .map(name => {
      const fullPath = path.join(dossier, name);
      try {
        const stat = fs.statSync(fullPath);
        return { name, fullPath, mtimeMs: stat.mtimeMs, size: stat.size };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    // Tri par mtime DESC, tie-break sur le nom (qui contient safeTimestamp,
    // donc trie chronologiquement de facon fiable). Sans ce tie-break, 2 backups
    // ecrits dans la meme milliseconde ont le meme mtimeMs -> ordre indetermine
    // -> recovery pourrait restaurer un backup plus ancien (audit B3).
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || b.name.localeCompare(a.name));
}

// Les sauvegardes a garder (decision de Thomas du 24/09).
//
// Avant : les 30 plus recentes, point. A une sauvegarde par heure d'activite,
// elles couvraient environ trois jours ouvres : une erreur remarquee une
// semaine plus tard n'avait plus de sauvegarde d'avant elle.
//
// Maintenant : les 30 plus recentes, COMME AVANT, plus la derniere de chaque
// jour de Paris sur les 30 derniers jours (aujourd'hui compris). Une
// journaliere n'est pas un fichier de plus : c'est une sauvegarde deja ecrite
// que la rotation ne supprime pas. Pour les jours que les 30 dernieres
// couvrent deja, elle en fait partie.
//
// L'ensemble garde CONTIENT toujours celui d'avant (les 30 plus recentes) :
// la rotation ne supprime jamais plus qu'avant, meme apres un mois sans
// activite (les 30 plus recentes, toutes vieilles, restent).
//
// Garde-fous (25/09, decisions 4 et 5), EN PLUS :
// - la derniere de chaque semaine de Paris (lundi-dimanche) sur 8 semaines,
//   celle d'aujourd'hui comprise ; « avant-purge » (des tournees) comprises,
//   comme toute sauvegarde : elles sont candidates au meme titre ;
// - les sauvegardes d'avant la purge des bons, toutes : hors rotation. Elles
//   ne prennent pas non plus de place parmi les 30 : les 30 dernieres se
//   comptent sans elles (on en garde donc autant ou plus qu'avant).
// La decision 4 dit « une par jour pendant 14 jours » : les 30 jours posees
// le 24/09 les contiennent, et les ramener a 14 supprimerait plus qu'avant.
// L'ensemble garde contient toujours celui de la regle d'avant (banc
// « jamais plus agressive » de test/garde-fous-sauvegardes.test.js).
//
// `entries` : triees de la plus recente a la plus ancienne (listBackupEntries).
function sauvegardesAGarder(entries, maintenant = new Date()) {
  const horsRotation = entries.filter(entry => MOTIF_HORS_ROTATION.test(entry.name));
  const rotation = entries.filter(entry => !MOTIF_HORS_ROTATION.test(entry.name));
  const garder = new Set(horsRotation.map(entry => entry.name));
  for (const entry of rotation.slice(0, BACKUP_RETENTION)) garder.add(entry.name);
  const aujourdhui = jourParis(maintenant);
  const premierJour = ajouterJours(aujourdhui, -(BACKUP_JOURS_JOURNALIERES - 1));
  const premiereSemaine = ajouterJours(debutSemaine(aujourdhui), -7 * (BACKUP_SEMAINES_HEBDOMADAIRES - 1));
  const joursVus = new Set();
  const semainesVues = new Set();
  for (const entry of rotation) {
    const jour = jourParis(entry.mtimeMs);
    if (!jour) continue;
    if (jour >= premierJour && !joursVus.has(jour)) {
      joursVus.add(jour);
      garder.add(entry.name);
    }
    const semaine = debutSemaine(jour);
    if (semaine >= premiereSemaine && !semainesVues.has(semaine)) {
      semainesVues.add(semaine);
      garder.add(entry.name);
    }
  }
  return garder;
}

function pruneOldBackups(dossier = BACKUP_DIR) {
  const entries = listBackupEntries(dossier);
  const garder = sauvegardesAGarder(entries);
  entries.filter(entry => !garder.has(entry.name)).forEach(entry => {
    try { fs.unlinkSync(entry.fullPath); } catch { /* best-effort */ }
  });
}

// Chantier 1 (2026-06-04) : refonte de la politique post-recovery selon doc
// SQLite + retour d'experience prod (Oldmoe 2024) :
// - mode `fresh_empty` : SUSPENSION maintenue (ne pas gzipper du vide qui
//   evincerait les vrais backups historiques)
// - mode `restored_backup` : faire UN backup IMMEDIAT taggue `post-restore-`
//   pour fermer la fenetre entre l'etat restaure et les futures mutations,
//   PUIS reprendre le throttle 1h normal
// - endpoint manuel /api/backup/now pour forcer un backup hors throttle
let postRestoreBackupDone = false;

// La sauvegarde du hot-path `writeDb` (Chantier 2). Garde-fous (25/09) : la
// variante synchrone, backupDbIfNeeded, n'avait plus d'appelant ; elle est
// retiree avec writeBackupNow (lecture du fichier de la base, voir plus bas).
//
// - fresh_empty : pas de sauvegarde automatique tant que la base reste vide
//   (Lot 3 : drapeau re-armable, leve par writeDb a la re-saisie) ;
// - restored_backup : UN instantane « post-restore », une seule fois (Revue R1
//   P1 #5 : le drapeau n'est pose qu'apres succes) ;
// - sinon, au plus une sauvegarde par BACKUP_THROTTLE_MS.
async function backupDbIfNeededAsync(options = {}) {
  const { force = false, tag = "" } = options;
  const sourcePath = useSqliteStorage() ? SQLITE_PATH : DB_PATH;
  if (!fs.existsSync(sourcePath)) return null;

  // Lot 3 : gate sur le flag re-armable (comme la version sync), et non plus
  // sur lastStorageRecovery.mode qui n'etait JAMAIS re-arme -> les backups auto
  // du hot-path writeDb restaient suspendus a vie apres un fresh_empty.
  if (!force && backupsSuspendedFreshEmpty) {
    return null;
  }
  if (!force && lastStorageRecovery && lastStorageRecovery.mode === "restored_backup" && !postRestoreBackupDone) {
    const p = await writeBackupNowAsync("post-restore");
    if (p) postRestoreBackupDone = true;
    return p;
  }
  if (!force) {
    const entries = listBackupEntries();
    const mostRecent = entries[0];
    if (mostRecent && Date.now() - mostRecent.mtimeMs < BACKUP_THROTTLE_MS) {
      return null;
    }
  }
  return writeBackupNowAsync(tag);
}

// La derniere sauvegarde ecrite par CE processus, et l'ecriture qu'elle couvre
// (la valeur de derniereModificationA quand la copie a commence). Sert a
// « Sauvegarder maintenant » : si rien n'a ete ecrit depuis, la derniere est
// deja a jour (garde-fous, 25/09).
let derniereSauvegardeEcrite = null;

// Garde-fous (25/09) : une sauvegarde COHERENTE et RELUE.
//
// Avant : writeBackupNowAsync lisait le FICHIER de la base en flux, hors verrou,
// apres un checkpoint ; un checkpoint (automatique a 1 000 pages, pendant un
// import) reecrivait le fichier au milieu de la lecture, et la copie melangeait
// des pages d'avant et d'apres -- nommee comme une sauvegarde valide, jamais
// relue (la chasse aux defauts : 2 fois sur 2). writeBackupNow (synchrone)
// lisait d'un bloc, sans ce defaut, mais gelait le serveur le temps de
// compresser la base, sous le verrou d'ecriture.
//
// Maintenant (lib/sauvegarde-base.js, dans un thread de travail) : VACUUM INTO
// depuis une seconde connexion en lecture seule (un instantane coherent, meme
// pendant des ecritures), gzip, puis relecture du .gz tel qu'une restauration
// le lirait (integrity_check « ok », et le releve des `tables` demandees) ;
// le fichier ne prend son nom qu'apres. Rend { chemin, nom, octets, sha256,
// comptes, empreintes }, ou null si la base n'existe pas encore ; leve si la
// copie ou sa relecture echoue (aucun fichier final n'est alors laisse).
//
// Le mode JSON (legacy, migration) garde la copie en flux : le fichier JSON est
// remplace par renommage, jamais reecrit en place. Il est relu (JSON.parse).
//
// `copie: false` : la copie vers le second dossier est laissee a l'appelant
// (la purge des bons, qui la fait apres avoir rendu le verrou d'ecriture).
async function ecrireSauvegardeVerifiee(tag = "", { tables = [], copie = true } = {}) {
  const sourcePath = useSqliteStorage() ? SQLITE_PATH : DB_PATH;
  if (!fs.existsSync(sourcePath)) return null;

  ensureDir(BACKUP_DIR);
  const baseExtension = useSqliteStorage() ? ".sqlite" : ".json";
  const tagPart = tag ? `-${tag.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  const backupPath = path.join(BACKUP_DIR, `db-${safeTimestamp()}${tagPart}${baseExtension}.gz`);
  // Pris AVANT la copie : une ecriture faite entre-temps est dans la copie, et
  // la sauvegarde se dit couvrir un peu moins qu'elle ne couvre, jamais plus.
  const couvre = derniereModificationA;

  let resultat;
  if (useSqliteStorage()) {
    // Ouvre la base (et la restaure si elle est corrompue) avant de la copier.
    getSqliteStore();
    resultat = await sauvegardeBase.copierEtVerifier({
      source: SQLITE_PATH,
      destination: backupPath,
      tables,
      maxOctets: MAX_BACKUP_DECOMPRESSED_BYTES
    });
  } else {
    resultat = await sauvegarderFichierJson(sourcePath, backupPath);
  }

  pruneOldBackups();
  lastBackupAt = new Date().toISOString();
  lastBackupError = null;
  derniereSauvegardeEcrite = { nom: path.basename(backupPath), couvre };
  if (copie) await copierVersSecondDossier(backupPath, resultat.sha256);
  return { chemin: backupPath, nom: path.basename(backupPath), ...resultat };
}

// Le second dossier (SEREO_BACKUP_COPY_DIR, decision 3) : la derniere copie
// reussie et la derniere erreur (null apres une copie reussie). En memoire.
let derniereCopie = null;
let derniereErreurCopie = null;

function empreinteDuFichier(chemin) {
  return new Promise((resolve, reject) => {
    const hachage = crypto.createHash("sha256");
    fs.createReadStream(chemin)
      .on("data", morceau => hachage.update(morceau))
      .on("error", reject)
      .on("end", () => resolve(hachage.digest("hex")));
  });
}

// Relecture adverse du 26/09 : un disque demonte ne se voyait pas. Docker lie
// alors un dossier VIDE du disque systeme a la place du montage (ou le cree),
// et cette fonction recreait le dossier au besoin : les copies y atterrissaient
// sans bruit, « dans le second dossier » a l'ecran. Comparer les disques ne
// suffit pas : la base est souvent sur un disque de donnees, le repli sur le
// disque systeme -- deux numeros differents, rien a signaler. Le second
// dossier porte donc un fichier TEMOIN, pose une fois par Thomas sur l'autre
// disque (DEPLOYMENT.md) : disque demonte, temoin absent, rien n'est copie et
// la carte le dit. Le dossier n'est plus jamais cree ici.
const TEMOIN_SECOND_DOSSIER = "sereo-second-dossier";

// Asynchrone expres : un partage reseau bloque ne gele pas le serveur.
async function verifierTemoinSecondDossier() {
  try {
    await fs.promises.access(path.join(BACKUP_COPY_DIR, TEMOIN_SECOND_DOSSIER));
  } catch {
    throw new Error(`le fichier témoin « ${TEMOIN_SECOND_DOSSIER} » manque dans le second dossier (disque démonté ?) : rien n'y est copié. Si c'est bien l'autre disque, crée ce fichier vide (DEPLOYMENT.md, « Sauvegardes »)`);
  }
}

// Copie une sauvegarde deja relue dans le second dossier : temoin present,
// fichier provisoire, relecture (meme empreinte sha256 que l'originale), meme
// date, renommage ; puis la meme retention que le premier dossier. N'echoue
// jamais : la sauvegarde est faite, seule la copie manque -- et l'alerte
// « copie » le dit.
async function copierVersSecondDossier(chemin, sha256) {
  if (!BACKUP_COPY_DIR) return null;
  const nom = path.basename(chemin);
  const cible = path.join(BACKUP_COPY_DIR, nom);
  const provisoire = `${cible}.tmp`;
  try {
    await verifierTemoinSecondDossier();
    await fs.promises.copyFile(chemin, provisoire);
    const relue = await empreinteDuFichier(provisoire);
    if (relue !== sha256) {
      throw new Error(`la copie ne correspond pas a la sauvegarde (empreinte ${relue.slice(0, 12)} au lieu de ${String(sha256).slice(0, 12)})`);
    }
    const { mtime } = await fs.promises.stat(chemin);
    await fs.promises.utimes(provisoire, mtime, mtime);
    await fs.promises.rename(provisoire, cible);
    pruneOldBackups(BACKUP_COPY_DIR);
    derniereCopie = { nom, at: new Date().toISOString() };
    derniereErreurCopie = null;
    return cible;
  } catch (error) {
    try { await fs.promises.unlink(provisoire); } catch { /* absent : ok */ }
    derniereErreurCopie = { at: new Date().toISOString(), message: String(error.message || error) };
    console.error(`[storage] copie de ${nom} vers le second dossier impossible : ${derniereErreurCopie.message}`);
    return null;
  }
}

async function sauvegarderFichierJson(sourcePath, backupPath) {
  const tmpPath = backupPath + ".tmp";
  try {
    const { pipeline } = require("node:stream/promises");
    await pipeline(
      fs.createReadStream(sourcePath),
      zlib.createGzip({ level: 6 }),
      fs.createWriteStream(tmpPath)
    );
    const compresse = fs.readFileSync(tmpPath);
    const texte = zlib.gunzipSync(compresse, { maxOutputLength: MAX_BACKUP_DECOMPRESSED_BYTES }).toString("utf8");
    if (texte.trim()) JSON.parse(texte);
    fs.renameSync(tmpPath, backupPath);
    return {
      octets: compresse.length,
      sha256: crypto.createHash("sha256").update(compresse).digest("hex"),
      comptes: {},
      empreintes: {}
    };
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
    throw err;
  }
}

// Le chemin de la sauvegarde, ou null (contrat historique : la purge des
// tournees l'injecte, writeDb l'appelle).
async function writeBackupNowAsync(tag = "") {
  const sauvegarde = await ecrireSauvegardeVerifiee(tag);
  return sauvegarde ? sauvegarde.chemin : null;
}

// Une sauvegarde a la fois (revue #84 : deux sauvegardes concurrentes donnaient
// un signal de sante incoherent). Attend celle qui court, puis tient sa place :
// writeDb n'en lance pas d'autre tant que celle-ci n'est pas finie. Aucun
// `await` entre la fin de l'attente et la prise de la place.
async function sauvegardeSeule(ecrire) {
  await flushPendingBackup();
  const enVol = Promise.resolve().then(ecrire);
  const place = enVol.then(() => {}, () => {});
  pendingBackup = place;
  place.then(() => { if (pendingBackup === place) pendingBackup = null; });
  return enVol;
}

// Une sauvegarde interrompue (arret du processus pendant la copie) laisse ses
// fichiers de travail : rien d'autre ne les supprime. Au demarrage.
function nettoyerSauvegardesInterrompues(dossier = BACKUP_DIR) {
  try {
    if (!fs.existsSync(dossier)) return;
    for (const nom of fs.readdirSync(dossier)) {
      if (!sauvegardeBase.MOTIF_TRAVAIL.test(nom)) continue;
      try { fs.unlinkSync(path.join(dossier, nom)); } catch { /* best-effort */ }
    }
  } catch (error) {
    console.warn(`[storage] nettoyage des sauvegardes interrompues : ${error.message || error}`);
  }
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

// --- L'AUTEUR D'UNE ECRITURE (lot « donnees utiles », 24/09) -----------------
//
// Le journal ne disait pas QUI avait fait quoi : un ecart de stock ne pouvait
// pas etre attribue (audit du 24/09). addHistory est appele d'une cinquantaine
// d'endroits, dont deux modules (lib/operations-api.js, lib/tournee-pratique.js) :
// plutot que de passer la requete a chacun, chaque requete /api s'execute dans
// un contexte (AsyncLocalStorage) que l'ecriture relit. Il suit les `await` et
// la file d'ecriture (withWriteLock est appele depuis la requete).
//
// Hors requete (purge planifiee, geocodage de fond) : « automatique ».
const contexteRequete = new AsyncLocalStorage();

function auteurCourant() {
  const req = contexteRequete.getStore();
  if (!req) return "automatique";
  return getRequestIdentity(req)?.identifiant || "";
}

function addHistory(db, type, message, details = {}) {
  ajouterEnTete(db, "historique", {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    type,
    message,
    details,
    auteur: auteurCourant()
  });
}

// Une ligne en tete de l'historique ou des mouvements de stock, SANS lire la
// table quand la base sait l'ecrire seule (25/09) : chaque geste ajoute une
// ligne a l'historique, et le lire en entier pour l'ecrire en entier coutait
// plus que le geste. La table lue plus tard dans la meme requete a la ligne
// en tete, comme avant (storage/sqliteStore.js, AJOUT_EN_TETE).
function ajouterEnTete(db, cle, ligne) {
  if (typeof db[AJOUT_EN_TETE] === "function") db[AJOUT_EN_TETE](cle, ligne);
  else db[cle].unshift(ligne);
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeHeader(value) {
  return normalizeTextKey(value);
}

function normalizeTextKey(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCase(value) {
  const text = clean(value);
  if (!text) return "";

  return text
    .toLowerCase()
    .split(/\s+/)
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : "")
    .join(" ");
}

function normalizeCity(value) {
  const key = normalizeTextKey(value);

  if (!key) return "";
  if (key === "besancon") return "Besancon";
  if (key === "champagnole") return "Champagnole";
  if (key === "dole") return "Dole";

  return titleCase(value);
}

function deriveSector(city, explicitSector = "") {
  const explicit = normalizeTextKey(explicitSector);
  const cityKey = normalizeTextKey(city);
  const key = explicit || cityKey;

  if (!key) return "Sans secteur";
  if (key.includes("besancon")) return "Besancon";
  if (key.includes("champagnole")) return "Champagnole";
  if (key === "dole" || key.includes("dole")) return "Dole";

  return titleCase(explicitSector || city);
}

function number(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  let text = String(value).trim().replace(/\s|\u00a0/g, "");
  text = text.replace(/[^\d,.-]/g, "");
  if (!text) return fallback;
  if (text.includes(".") && text.includes(",")) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else {
    text = text.replace(",", ".");
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const parsed = number(value, NaN);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function optionalQuantity(value) {
  if (clean(value) === "") return null;
  return Math.max(0, number(value, 0));
}

// M2 (v1.16.1) : quantite a l'import = number() clampe a >= 0. Une qty Excel
// negative ou "abc" ne doit pas se propager en commande (sinon fausse les
// calculs de stock disponible / reserve). Le PATCH /api/stock filtre deja les
// negatifs en rejet 400 ; les imports en masse clampent silencieusement a 0
// (compromis : pas d'erreur globale qui bloquerait 5000 lignes pour 1 -5).
function importQuantity(value, fallback = 0) {
  return Math.max(0, number(value, fallback));
}

function excelDate(value) {
  if (!value) return "";

  if (value instanceof Date) {
    return value.toLocaleDateString("fr-FR");
  }

  if (typeof value === "number") {
    // Meme borne que normalizeDateInput/excelDateToIso : un serial aberrant
    // (> ~an 2119) ou negatif ne doit pas produire une date d'affichage
    // fantaisiste (ex: "01/01/3268") ni "Invalid Date".
    if (!Number.isFinite(value) || value < 0 || value > 80000) return "";
    const date = new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000);
    return date.toLocaleDateString("fr-FR", { timeZone: "UTC" });
  }

  return clean(value);
}

// Variante ISO (YYYY-MM-DD) de excelDate. Utilisee pour dateCommande qui doit
// etre stockee en format normalise pour permettre le tri, le filtrage et
// l'identification d'une commande par (clientId, dateCommande). L'affichage
// dans l'UI se fera selon les settings locale du user (Phase 5).
function excelDateToIso(value) {
  // M1 v1.16.1 (revue) : delegue ENTIEREMENT a normalizeDateInput sur tous les
  // paths (texte, Date object, number Excel epoch) pour beneficier de la
  // validation round-trip + bornes [1900,2199]. Avant : Date/number sortaient
  // sans validation -> dateCommandeIso pouvait valoir "3000-01-01" et creer
  // un bucket ERP fantome.
  return normalizeDateInput(value);
}

function normalizeDateInput(value) {
  if (!value) return "";

  if (value instanceof Date) {
    return validateAndFormatYMD(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number") {
    // Excel epoch (1899-12-30). Borne le serial number a une plage realiste pour
    // eviter qu'une valeur aberrante (ex: 99999 = an 2173) ne se faufile.
    if (!Number.isFinite(value) || value < 0 || value > 80000) return "";
    const date = new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000);
    return validateAndFormatYMD(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = clean(value);
  if (!text) return "";

  // M1 (v1.16.1) : on extrait d'abord les composants (ISO ou FR), PUIS on
  // valide qu'ils forment une date reellement existante via round-trip Date
  // (sinon "31/13/2026", "30/02/2026", "29/02/2025" etaient acceptes -> fausse
  // date stockee et bucketing ERP par date incoherent).
  let y, m, d;
  // Accepte un ISO date (YYYY-MM-DD) avec un suffixe horaire optionnel
  // ("2026-05-05T10:00:00.000Z" ou "2026-05-05 10:00") : on tronque a la date.
  // Sans ca, un ISO datetime valide etait rejete (-> "") puis mute vers today
  // par normalizeOrder (P0 audit 2026-07-08). Le suffixe DOIT commencer par
  // "T" ou espace, donc "2026-05-05abc" reste rejete.
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (isoMatch) {
    y = Number(isoMatch[1]); m = Number(isoMatch[2]); d = Number(isoMatch[3]);
  } else {
    // Une heure apres la date FR (« 18/05/2026 10:30 », « 18/05/2026 10h30 »)
    // est acceptee et ignoree (25/09) : l'import datait sinon le bon du jour
    // de l'import (chasse aux defauts du 24/09).
    const fr = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ T]+\d{1,2}[:hH]\d{2}(?::\d{2})?)?$/);
    if (!fr) return "";
    d = Number(fr[1]); m = Number(fr[2]);
    // M1 (revue) : pivot 2 chiffres. "01/01/99" doit etre 1999 (legacy
    // commercial), pas 2099. Convention : <=30 -> 20XX, sinon 19XX.
    if (fr[3].length === 2) {
      const yy = Number(fr[3]);
      y = yy <= 30 ? 2000 + yy : 1900 + yy;
    } else {
      y = Number(fr[3]);
    }
  }

  return validateAndFormatYMD(y, m, d);
}

// Helper M1 : validation round-trip + formatage YYYY-MM-DD. Centralise la
// validation pour qu'elle s'applique aussi au path number/Date (Excel epoch,
// Date object) - pas seulement au path texte.
function validateAndFormatYMD(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2199) return "";
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return "";
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function readExcelRows(filePath) {
  try {
    const parsed = await readXlsxFile(filePath);
    const rows = Array.isArray(parsed[0]) ? parsed : (parsed[0]?.data || []);

    if (!rows.length) {
      throw badRequest("Fichier Excel vide ou invalide");
    }

    return rows;
  } catch (error) {
    if (error.statusCode) throw error;
    throw badRequest("Fichier Excel invalide ou illisible");
  }
}

function findHeaderRow(rows, requiredHeaders) {
  return rows.findIndex(row => {
    const normalizedRow = Array.isArray(row) ? row.map(normalizeHeader) : [];
    return requiredHeaders.every(header => normalizedRow.includes(normalizeHeader(header)));
  });
}

function findHeaderRowGroups(rows, requiredGroups) {
  return rows.findIndex(row => {
    const normalizedRow = Array.isArray(row) ? row.map(normalizeHeader) : [];
    return requiredGroups.every(group => group.some(header => normalizedRow.includes(normalizeHeader(header))));
  });
}

function getIndex(headers, name, occurrence = 1) {
  let count = 0;
  const normalizedName = normalizeHeader(name);

  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeader(headers[i]) === normalizedName) {
      count++;
      if (count === occurrence) return i;
    }
  }

  return -1;
}

function getCell(row, headers, name, occurrence = 1) {
  const index = getIndex(headers, name, occurrence);
  return index >= 0 ? row[index] : "";
}

function getCellByNames(row, headers, names) {
  for (const name of names) {
    const value = getCell(row, headers, name, 1);
    if (clean(value) !== "") return value;
  }

  return "";
}

function parseCoordinate(value, min, max) {
  const text = clean(value);

  if (text === "") {
    return {
      ok: true,
      value: ""
    };
  }

  const parsed = Number(text.replace(",", "."));

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return {
      ok: false,
      value: ""
    };
  }

  return {
    ok: true,
    value: parsed
  };
}

function getCoordinateValue(value, min, max) {
  const parsed = parseCoordinate(value, min, max);
  return parsed.ok ? parsed.value : "";
}

function getCoordinates(entity) {
  const lat = parseCoordinate(entity.lat ?? entity.latitude, -90, 90);
  const lng = parseCoordinate(entity.lng ?? entity.longitude, -180, 180);

  if (!lat.ok || !lng.ok || lat.value === "" || lng.value === "") return null;

  return {
    lat: lat.value,
    lng: lng.value
  };
}

function clientKey(value) {
  return [
    clean(value.nom || value.client || value.clientName),
    clean(value.rue || value.address),
    clean(value.codePostal || value.postalCode),
    clean(value.ville || value.city)
  ].join("|").toLowerCase();
}

// Cle secondaire (nom + code postal, normalises) pour rattraper les doublons
// causes par des variations mineures de saisie (espaces, virgules, accents)
// que clientKey() laisse passer. Vide si nom OU CP manque.
function clientSecondaryKey(value) {
  const nom = normalizeTextKey(value.nom || value.client || value.clientName || "");
  const cp = normalizeTextKey(value.codePostal || value.postalCode || "");
  if (!nom || !cp) return "";
  return `${nom}|${cp}`;
}

// FUSION DES CLIENTS A L'IMPORT DES VENTES (25/09). Regle permanente de Thomas
// (18/05) : tout import est une FUSION par cle metier, jamais un
// « wipe-and-replace ». L'import des ventes reconstruisait pourtant la table
// des clients depuis le fichier (chasse aux defauts du 24/09, constat
// critique) : une fiche absente du fichier disparaissait (sauf si sa DERNIERE
// commande etait en cours), et une fiche presente perdait tout ce que le
// fichier ne porte pas -- email, prenom, preferences, source, archivage. Un
// abonnement dont le client avait disparu ne se suspendait plus.
//
// Maintenant :
//   - chaque ligne du fichier retrouve SA fiche : par la cle complete (nom,
//     rue, code postal, ville), sinon par la cle secondaire (nom + code postal
//     normalises) parmi les fiches que la cle complete ne vise pas ; une fiche
//     n'est prise que par un seul client du fichier ;
//   - la fiche trouvee garde son identifiant et tous ses champs ; une cellule
//     PLEINE du fichier remplace la valeur, une cellule VIDE la laisse ;
//   - une fiche absente du fichier reste telle quelle, a sa place.

/** Les fiches existantes, indexees pour l'import. `clesDuFichier` : les cles completes du fichier. */
function indexerClientsExistants(clients, clesDuFichier) {
  const parCle = new Map();
  const parSecondaire = new Map();
  // Deux fiches de meme cle : la derniere repond, comme avant (l'autre reste).
  clients.forEach(client => parCle.set(clientKey(client), client));
  clients.forEach(client => {
    if (clesDuFichier.has(clientKey(client))) return;
    const secondaire = clientSecondaryKey(client);
    if (secondaire) parSecondaire.set(secondaire, client);
  });
  return { parCle, parSecondaire, prises: new Set() };
}

/** La fiche existante d'un client du fichier, ou null ; `parSecondaire` dit comment. */
function trouverFicheExistante(index, cle, secondaire) {
  const directe = index.parCle.get(cle);
  if (directe && !index.prises.has(directe)) {
    index.prises.add(directe);
    return { fiche: directe, parSecondaire: false };
  }
  const voisine = secondaire ? index.parSecondaire.get(secondaire) : null;
  if (voisine && !index.prises.has(voisine)) {
    index.prises.add(voisine);
    return { fiche: voisine, parSecondaire: true };
  }
  return { fiche: null, parSecondaire: false };
}

/** Une cellule du fichier : pleine, elle remplace ; vide, la valeur en base reste. */
function valeurFusionnee(duFichier, enBase) {
  return clean(duFichier) !== "" ? duFichier : (enBase ?? "");
}

/**
 * La liste des clients apres l'import : chaque fiche existante a sa place
 * (remplacee par sa version fusionnee si le fichier la cite), puis les
 * nouvelles. Rien n'est retire. Les comptes suivent la regle de Thomas :
 * created / updated / preserved.
 */
function mergeImportedClients(db, importedClients) {
  const fusionnees = new Map();
  const nouvelles = [];
  let mergedBySecondary = 0;
  importedClients.forEach(client => {
    const { _ficheExistante: existante, _parSecondaire: parSecondaire, ...fiche } = client;
    if (existante) {
      fusionnees.set(existante, fiche);
      if (parSecondaire) mergedBySecondary += 1;
    } else {
      nouvelles.push(fiche);
    }
  });
  const clients = [...db.clients.map(client => fusionnees.get(client) || client), ...nouvelles];
  return {
    clients,
    created: nouvelles.length,
    updated: fusionnees.size,
    preserved: db.clients.length - fusionnees.size,
    mergedBySecondary
  };
}

/** Le bon d'une ligne de vente : client (cle complete) + date de commande. */
function cleDuBonDeLaVente(vente) {
  return `${clientKey({ nom: vente.client, rue: vente.rue, codePostal: vente.codePostal, ville: vente.ville })}|${vente.dateCommandeIso || ""}`;
}

/**
 * Les ventes apres un import : celles des bons absents du fichier restent,
 * celles d'un bon du fichier sont remplacees par ses lignes (un bon corrige
 * dans Ximi ne garde pas ses anciennes lignes, un fichier reimporte ne double
 * rien). Un fichier cumulatif (le cas de la production) rend donc la meme
 * table qu'avant ; un fichier partiel ou vide n'efface plus rien.
 * `figes` (26/09) : les bons laisses tels quels -- leurs anciennes lignes
 * restent, les lignes du fichier ne s'y ajoutent pas (bon incomplet, voir
 * l'import des ventes). `cleAncienne` (26/09) : le bon d'une ancienne vente,
 * reconnu par sa fiche quand son adresse a change (voir l'import des ventes).
 */
function fusionnerVentes(anciennes, nouvelles, figes = new Set(), cleAncienne = cleDuBonDeLaVente) {
  const retenues = nouvelles.filter(vente => !figes.has(cleDuBonDeLaVente(vente)));
  const bonsDuFichier = new Set(retenues.map(cleDuBonDeLaVente));
  const gardees = (Array.isArray(anciennes) ? anciennes : []).filter(vente => !bonsDuFichier.has(cleAncienne(vente)));
  return { ventes: [...gardees, ...retenues], gardees: gardees.length };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function handleRouteError(error, res, fallbackMessage) {
  const status = error.statusCode || 500;

  if (status >= 500) {
    console.error(error);
  }
  // Un refus qui est une question (doublonDeFiche) : sa cle d'idempotence
  // reste libre pour la reponse (gesteIdempotent).
  if (error.question) res.locals.gesteSansEffet = true;

  res.status(status).json({
    error: status >= 500 ? fallbackMessage : error.message,
    // Lot 3 : un refus peut porter sa liste (ex. toutes les adresses a
    // verifier d'une tournee), que l'ecran affiche une par une.
    ...(status < 500 && error.details ? { details: error.details } : {})
  });
}

function cleanupUploadedFile(filePath) {
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(error);
  }
}

// v1.12.0 : copie le fichier Excel uploade dans /app/data/imports-archives/
// (persistant) avec un nom horodate et ajoute une entree de metadata dans
// db.importsArchives pour retelechargement futur. Doit etre appelee AVANT
// cleanupUploadedFile sinon le fichier est deja supprime.
function archiveImportFile(req, db, type, stats = {}) {
  if (!req?.file?.path) return null;

  try {
    if (!fs.existsSync(IMPORTS_ARCHIVES_DIR)) {
      fs.mkdirSync(IMPORTS_ARCHIVES_DIR, { recursive: true });
    }

    const sourcePath = req.file.path;
    const originalName = req.file.originalname || "import.xlsx";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    // Nom safe : alphanumerique + tirets seulement, ascii only
    const safeName = String(originalName)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80);
    const archivedFilename = `${timestamp}_${type}_${safeName}`;
    const archivedPath = path.join(IMPORTS_ARCHIVES_DIR, archivedFilename);

    fs.copyFileSync(sourcePath, archivedPath);

    const stat = fs.statSync(archivedPath);
    const fileBuffer = fs.readFileSync(archivedPath);
    const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    const archiveEntry = {
      id: `import-${timestamp}-${crypto.randomUUID().slice(0, 8)}`,
      type,
      filename: originalName,
      archivedFilename,
      archivedPath,
      importedAt: new Date().toISOString(),
      rowsCount: Number(stats.rowsCount || 0),
      fileSize: stat.size,
      sha256,
      stats: stats || {}
    };

    db.importsArchives = db.importsArchives || [];
    db.importsArchives.push(archiveEntry);

    return archiveEntry;
  } catch (error) {
    // L'archivage est best-effort : si ca echoue, on ne casse pas l'import.
    console.error("Erreur archivage import :", error);
    return null;
  }
}

function uploadExcel(req, res, next) {
  upload.single("file")(req, res, error => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Fichier trop volumineux, limite 10 Mo" });
      }

      return handleRouteError(error, res, "Erreur upload fichier");
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Fichier Excel manquant"
      });
    }

    next();
  });
}

function getStockQuantity(product) {
  const value = product.quantite ?? product.stock ?? product.Stock ?? product.qte;
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function setStockQuantity(product, value) {
  product.quantite = Math.max(0, Math.round(Number(value) * 100) / 100);
}

function getProductName(product) {
  return clean(product.nom || product.Nom || product.produit || product.Produit || product.productName || "Produit");
}

function getProductCode(product) {
  return clean(product.code || product.sku || product.reference);
}

function productKey(product) {
  if (!product || typeof product !== "object") return "";
  const code = normalizeTextKey(
    product.code || product.codeProduit || product.sku || product.reference || ""
  );
  const nom = normalizeTextKey(
    product.nom || product.Nom || product.produit || product.Produit || product.name || product.productName || ""
  );
  return code || nom;
}

// Set des statuts facture (apres normalizeTextKey) qui signalent une vente
// deja livree dans le systeme source. Permet d'importer la commande
// directement comme "livre" sans la faire passer par la file de preparation.
const FACTURE_STATUS_LIVRE = new Set(["envoyee", "envoye", "expediee", "expedie", "sent"]);
const DEFAULT_STOCK_ALERT_THRESHOLD = 5;

function isFactureStatusLivre(rawStatut) {
  return FACTURE_STATUS_LIVRE.has(normalizeTextKey(rawStatut || ""));
}

function getStockAlertThreshold(product) {
  const raw = product.alertThreshold
    ?? product.stockMinimum
    ?? product.seuilMinimum
    ?? product.seuil_minimum
    ?? product.seuilAlerte
    ?? product.seuil
    ?? product.minimum;
  const threshold = number(raw, DEFAULT_STOCK_ALERT_THRESHOLD);
  return Math.max(0, Math.round(threshold));
}

function parseStockAlertThresholdInput(value) {
  const text = clean(value);
  if (!text || /[,.]/.test(text)) {
    throw badRequest("Seuil minimum invalide");
  }

  const threshold = Number(text);
  if (!Number.isFinite(threshold) || !Number.isInteger(threshold) || threshold < 0) {
    throw badRequest("Seuil minimum invalide");
  }

  return threshold;
}

function stockItemMatchesLine(product, line) {
  const productCode = normalizeTextKey(getProductCode(product));
  const productName = normalizeTextKey(getProductName(product));
  const lineCode = normalizeTextKey(line.code || line.sku || line.reference);
  const lineName = normalizeTextKey(line.nom || line.produit || line.productName || line.name);

  return Boolean(
    (productCode && lineCode && productCode === lineCode)
    || (productName && lineName && productName === lineName)
  );
}

function getQuantityForProductInOrder(product, order) {
  return normalizeProducts(order.products).reduce((total, line) => {
    if (!stockItemMatchesLine(product, line)) return total;
    return total + Math.max(0, number(line.quantite, 0));
  }, 0);
}

// Chantier 1 (2026-06-04) : "probleme_livraison" et "a_reprogrammer"
// MAINTIENNENT la reservation. Avant ce fix, `reserveStockForOrder` deduisait
// physiquement le stock mais `calculateReservedStock` excluait ces statuts de
// la metrique reserved — asymetrie comptable invisible (stock dispo affiche >
// stock physique reel).
//
// Pattern ERP standard (Odoo unrelease, ERPNext stock reservation) : un
// echec de livraison ne libere PAS la reservation (livraison client absent
// = relivraison sous 24-72h sur meme stock). Pour annuler une reservation,
// utiliser l'endpoint explicite POST /api/orders/:id/release-stock.
//
// Chasse aux defauts du 24/09 (lot « stock ») : la reservation se lit sur la
// COMMANDE, plus sur une liste de statuts. Une commande saisie chez le client,
// ou une planifiee confirmee, sort son stock du rayon des sa creation et reste
// « stock_a_verifier » (a preparer) : absente de l'ancienne liste
// (RESERVED_ORDER_STATUSES : en preparation jusqu'a a reprogrammer), elle
// etait reevaluee contre le rayon qu'elle venait de reduire (6 pris sur 10, 4
// restants, « 6 demandes pour 4 » : « Bloquee stock », bouton grise, Reserve 0
// au Stock). Est reservee toute commande qui porte stockReservedAt, sauf une
// livree (la livraison consomme la reservation ; des livrees anciennes gardent
// stockReservedAt, voir la purge) ou une annulee.
const STATUTS_SANS_RESERVATION = new Set(["livre", "annulee"]);

function stockReserveActif(order) {
  return Boolean(order && order.stockReservedAt) && !STATUTS_SANS_RESERVATION.has(order.status);
}

// Une commande qui n'a pas encore ete preparee (importee, a verifier, validee
// chez le client) et qu'une transition fait entrer dans la preparation ou
// au-dela : son stock doit sortir du rayon, comme par « Passer en
// preparation ».
//
// Relecture adverse (25/09) : une commande dont le stock a ete libere a la
// main (release-stock, sur « a reprogrammer » ou en probleme de livraison) et
// qu'une transition remet en PREPARATION (en preparation, terminee, prete) en
// est aussi. « Passer en preparation » sortait son stock ; PATCH non :
// preparee, en carton, pendant que le rayon comptait encore ses articles (une
// autre commande pouvait les prendre, et sa livraison mettait le rayon en
// negatif). Vers « en livraison » ou « livre », rien ne change : la
// livraison reprend le stock (reprendreStockLibere), meme sur un rayon
// insuffisant (decision de Thomas du 23/09), comme la tournee qui la relivre.
const STATUTS_AVANT_PREPARATION = new Set(["brouillon", "importe", "stock_a_verifier", "commande_client_validee"]);
const STATUTS_STOCK_SORTI = new Set(["en_preparation", "preparation_terminee", "pret_livraison", "en_livraison", "livre"]);
const STATUTS_DE_PREPARATION = new Set(["en_preparation", "preparation_terminee", "pret_livraison"]);

function stockLibereALaMain(order) {
  return Boolean(order.stockReleaseReason) && order.stockReleaseReason !== "consumed_by_delivery";
}

function commandeQuiPartEnPreparation(order, statut) {
  const avantPreparation = STATUTS_AVANT_PREPARATION.has(order.status) && STATUTS_STOCK_SORTI.has(statut);
  const repreparee = stockLibereALaMain(order) && STATUTS_DE_PREPARATION.has(statut);
  return statut !== order.status
    && (avantPreparation || repreparee)
    && isValidOrderStatusTransition(order.status, statut)
    && !order.stockReservedAt;
}

// Chantier 2 (audit 2026-06-04) : pre-compute des metriques stock en
// single-pass O(N+M) au lieu de N*M reduce imbriques par produit.
//
// Avant : enrichStockItem(db, product) appele 100 fois -> chaque appel re-itere
// sur db.commandes (1000) -> 100 000 iterations par GET /api/stock + chaque
// iteration normalizeProducts l'order et resolve la match line par produit
// (~5 op) = 500 000+ op effectives. /api/dashboard re-execute.
//
// Apres : buildStockMetricsIndex parcourt commandes UNE SEULE FOIS et accumule
// dans une Map<productKey, {reserved, needed}>. Puis enrichStockItem lit en
// O(1). Total : ~N+M = 1100 iterations + (N * Map.get O(1)).
//
// Statuts qui comptent dans "needed" (commandes a preparer/livrer).
const NEEDED_ORDER_STATUSES = new Set([
  "commande_client_validee",
  "importe",
  "stock_a_verifier",
  "en_preparation",
  "pret_livraison"
]);

// Construit l'index agrege en un seul parcours des commandes.
//
// Revue R1 chantier 2 P0 #1 + #2 : design composite-key.
// L'ancien design (deux Maps separees code: et name:) avait deux bugs :
// - SOUS-COMPTAGE : ligne A (code='A1', sans nom) + ligne B (sans code,
//   nom='Produit A') referencent le meme produit -> seule l'une des deux
//   etait comptee au lookup (premier match l'emportait).
// - SUR-COMPTAGE : deux produits stock partageant le meme code (legal mais
//   pas unique) -> tous deux voyaient la meme quantite reservee.
//
// Nouveau design :
// - Chaque ligne est canonisee en une cle `code|nom` (les deux normalises).
// - Trois Map : { totals: canonicalKey -> {reserved, needed},
//                 byCode: codeNorm -> Set<canonicalKey>,
//                 byName: nameNorm -> Set<canonicalKey> }
// - Au lookup d'un produit : on collecte TOUTES les cles candidates via
//   byCode[productCode] ET byName[productName], on les dedup, on somme.
//
// Correctness : `stockItemMatchesLine` sert de reference (OR sur code/name).
// L'index reproduit fidelement sa semantique en O(N+M) au lieu de O(N*M).
//
// `neededNotDeducted` (relecture adverse du 24/09) : la part de `needed` que
// le stock n'a pas encore sortie du rayon. Une commande dont le stock est
// reserve (stockReservedAt : confirmee, saisie chez le client, en
// preparation) a deja deduit ses quantites de `quantite` ; seules ses lignes
// gardees non deduites (stockNonDeduit, livraison acceptee sur un stock non
// suivi) restent a prendre. « A recommander » compare CE besoin au stock
// d'aujourd'hui : avec `needed`, une commande confirmee manquait deux fois.
function buildStockMetricsIndex(commandes) {
  const totals = new Map(); // canonicalKey -> { reserved, needed, neededNotDeducted }
  const byCode = new Map(); // codeNorm -> Set<canonicalKey>
  const byName = new Map(); // nameNorm -> Set<canonicalKey>

  const ensureCanonical = (canonicalKey) => {
    let slot = totals.get(canonicalKey);
    if (!slot) {
      slot = { reserved: 0, needed: 0, neededNotDeducted: 0 };
      totals.set(canonicalKey, slot);
    }
    return slot;
  };
  const addReverse = (map, key, canonicalKey) => {
    if (!key) return;
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    set.add(canonicalKey);
  };

  for (const order of commandes || []) {
    const isReserved = stockReserveActif(order);
    const isNeeded = NEEDED_ORDER_STATUSES.has(order.status);
    if (!isReserved && !isNeeded) continue;
    // null : rien de deduit, toute la ligne reste a prendre.
    const nonDeduites = order.stockReservedAt ? new Set(order.stockNonDeduit || []) : null;

    for (const line of normalizeProducts(order.products)) {
      const qty = Math.max(0, number(line.quantite, 0));
      if (qty <= 0) continue;

      const codeNorm = normalizeTextKey(line.code || line.sku || line.reference);
      const nameNorm = normalizeTextKey(line.nom || line.produit || line.productName || line.name);
      if (!codeNorm && !nameNorm) continue;

      // Cle canonique = couple (code, name). Chaque ligne contribue exactement
      // une fois a son slot canonique, plus est indexee inversement.
      const canonicalKey = (codeNorm || "_") + "|" + (nameNorm || "_");
      const slot = ensureCanonical(canonicalKey);
      if (isReserved) slot.reserved += qty;
      if (isNeeded) slot.needed += qty;
      if (isNeeded && (!nonDeduites || nonDeduites.has(productKeyFromLine(line)))) slot.neededNotDeducted += qty;

      addReverse(byCode, codeNorm, canonicalKey);
      addReverse(byName, nameNorm, canonicalKey);
    }
  }
  return { totals, byCode, byName };
}

// Lookup correct : reproduit stockItemMatchesLine (match si code OR name).
// On collecte les cles canoniques candidates via les deux index inverses,
// dedup via Set, somme les totaux. Pas de double-comptage car chaque slot
// canonique n'est sommé qu'une fois meme s'il appartient aux 2 inverses.
function lookupStockMetric(index, product, kind) {
  if (!index || !index.totals) return 0;
  const codeNorm = normalizeTextKey(getProductCode(product));
  const nameNorm = normalizeTextKey(getProductName(product));
  if (!codeNorm && !nameNorm) return 0;

  const candidates = new Set();
  if (codeNorm) {
    const fromCode = index.byCode.get(codeNorm);
    if (fromCode) for (const k of fromCode) candidates.add(k);
  }
  if (nameNorm) {
    const fromName = index.byName.get(nameNorm);
    if (fromName) for (const k of fromName) candidates.add(k);
  }
  let total = 0;
  for (const k of candidates) {
    const slot = index.totals.get(k);
    if (slot) total += slot[kind] || 0;
  }
  return total;
}

// « A recommander » qui voit venir (decisions de Thomas du 24/09, 2 et 3).
//
// La demande CONNUE D'AVANCE, sur l'horizon regle dans Parametres (14 jours
// par defaut, 7 a 30), en plus des commandes en cours (quantityNeeded) :
//   - les commandes planifiees (planifiee, a_confirmer) livrees d'ici la fin
//     de l'horizon -- une date passee compte aujourd'hui : elle attend encore ;
//   - les echeances des abonnements ACTIFS pas encore generees, d'aujourd'hui
//     a la fin de l'horizon. Elles viennent de schedule() (lib/subscriptions.js),
//     le calendrier de l'ecran Abonnements : un abonnement en pause ou arrete
//     n'y figure pas, et une echeance deja generee y porte son orderId -- elle
//     est comptee par sa commande, une seule fois. Une echeance PASSEE sans
//     commande n'est pas « a venir » : l'ecran Abonnements la montre en
//     retard (elle peut dater d'avant la saisie de l'abonnement).
// Les lignes se rattachent aux produits comme dans buildStockMetricsIndex
// (code OU nom, cles canoniques) ; chaque produit recoit sa demande par jour.
const STATUTS_PLANIFIES = new Set(["planifiee", "a_confirmer"]);

function buildUpcomingDemandIndex(db, today = jourParis()) {
  const horizonJours = normalizeSettings(db.settings || {}).stock.horizonJours;
  const fin = ajouterJours(today, horizonJours);
  const parCle = new Map(); // canonicalKey -> Map<jour, quantite>
  const byCode = new Map();
  const byName = new Map();
  const indexer = (map, key, canonicalKey) => {
    if (!key) return;
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    set.add(canonicalKey);
  };
  const ajouter = (products, jour) => {
    for (const line of normalizeProducts(products)) {
      const qty = Math.max(0, number(line.quantite, 0));
      if (qty <= 0) continue;
      const codeNorm = normalizeTextKey(line.code || line.sku || line.reference);
      const nameNorm = normalizeTextKey(line.nom || line.produit || line.productName || line.name);
      if (!codeNorm && !nameNorm) continue;
      const canonicalKey = (codeNorm || "_") + "|" + (nameNorm || "_");
      let parJour = parCle.get(canonicalKey);
      if (!parJour) { parJour = new Map(); parCle.set(canonicalKey, parJour); }
      parJour.set(jour, (parJour.get(jour) || 0) + qty);
      indexer(byCode, codeNorm, canonicalKey);
      indexer(byName, nameNorm, canonicalKey);
    }
  };

  for (const order of db.commandes || []) {
    if (!STATUTS_PLANIFIES.has(order.status)) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(order.deliveryDate || "")) ? order.deliveryDate : today;
    if (date > fin) continue;
    ajouter(order.products, date < today ? today : date);
  }
  for (const occurrence of calendrierAbonnements.schedule(db, today, horizonJours)) {
    if (occurrence.orderId || occurrence.date < today || occurrence.date > fin) continue;
    ajouter(occurrence.products, occurrence.date);
  }
  return { parCle, byCode, byName, horizonJours };
}

// La demande a venir d'un produit, par jour croissant : [{ date, quantite }].
function lookupUpcomingDemand(index, product) {
  if (!index || !index.parCle) return [];
  const codeNorm = normalizeTextKey(getProductCode(product));
  const nameNorm = normalizeTextKey(getProductName(product));
  const candidates = new Set();
  if (codeNorm) for (const k of index.byCode.get(codeNorm) || []) candidates.add(k);
  if (nameNorm) for (const k of index.byName.get(nameNorm) || []) candidates.add(k);
  const parJour = new Map();
  for (const k of candidates) {
    for (const [jour, qty] of index.parCle.get(k) || []) parJour.set(jour, (parJour.get(jour) || 0) + qty);
  }
  return [...parJour]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, quantite]) => ({ date, quantite: Math.round(quantite * 100) / 100 }));
}

// Garde l'API publique (utilisee par les tests). Sans index, recompose
// l'ancien algorithme N*M. Avec index, lookup O(matches) tres rapide.
function calculateReservedStock(db, product, index) {
  if (index && index.totals) return lookupStockMetric(index, product, "reserved");
  return db.commandes.reduce((total, order) => {
    const isReserved = stockReserveActif(order);
    return isReserved ? total + getQuantityForProductInOrder(product, order) : total;
  }, 0);
}

function calculateNeededStock(db, product, index) {
  if (index && index.totals) return lookupStockMetric(index, product, "needed");
  return db.commandes.reduce((total, order) => {
    if (!NEEDED_ORDER_STATUSES.has(order.status)) return total;
    return total + getQuantityForProductInOrder(product, order);
  }, 0);
}

function getStockStatus(product, db, index) {
  const quantity = getStockQuantity(product);

  if (quantity === null) return "a_renseigner";
  if (quantity <= 0) return "rupture";
  if (quantity <= getStockAlertThreshold(product)) return "stock_faible";
  if (db && calculateReservedStock(db, product, index) > 0) return "reserve";
  return "disponible";
}

// Signature etendue : `index` est optionnel. S'il est passe (typique via
// getStockView), tout est en O(1). Sans (call-site isole), comportement
// legacy N*M (correct mais lent).
function enrichStockItem(db, product, index, upcomingIndex = buildUpcomingDemandIndex(db)) {
  const quantityAvailable = getStockQuantity(product);
  const quantityReserved = calculateReservedStock(db, product, index);
  const quantityNeeded = calculateNeededStock(db, product, index);
  // Ce qui reste a prendre sur quantityAvailable (buildStockMetricsIndex).
  const quantityNeededNotDeducted = lookupStockMetric(index && index.totals ? index : buildStockMetricsIndex(db.commandes), product, "neededNotDeducted");
  // « A recommander » qui voit venir (24/09) : la demande connue d'avance, par
  // jour, sur l'horizon de Parametres. L'ecran en tire le jour du manque.
  const upcomingDemand = lookupUpcomingDemand(upcomingIndex, product);

  return {
    ...product,
    sku: product.sku || product.reference || product.code || "",
    category: product.category || product.categorie || product.type || "",
    quantityAvailable,
    quantityReserved,
    quantityNeeded,
    quantityNeededNotDeducted,
    quantityUpcoming: Math.round(upcomingDemand.reduce((total, d) => total + d.quantite, 0) * 100) / 100,
    upcomingDemand,
    upcomingHorizonDays: upcomingIndex.horizonJours,
    quantityTotal: quantityAvailable === null ? null : quantityAvailable + quantityReserved,
    alertThreshold: getStockAlertThreshold(product),
    stockMinimum: getStockAlertThreshold(product),
    stockStatus: getStockStatus(product, db, index)
  };
}

function defaultDeliverySectors() {
  return [
    {
      id: "secteur-champagnole",
      secteur: "Champagnole",
      villePrincipale: "Champagnole",
      jourMois: 5,
      frequence: "mensuelle",
      pointDepart: "Champagnole",
      notes: "Secteur local par defaut."
    },
    {
      id: "secteur-dole",
      secteur: "Dole",
      villePrincipale: "Dole",
      jourMois: 15,
      frequence: "mensuelle",
      pointDepart: "Champagnole",
      notes: "Tournee mensuelle sans geocodage externe."
    },
    {
      id: "secteur-besancon",
      secteur: "Besancon",
      villePrincipale: "Besancon",
      jourMois: 25,
      frequence: "mensuelle",
      pointDepart: "Champagnole",
      notes: "Tournee mensuelle sans geocodage externe."
    }
  ];
}

function getStockView(db) {
  // Construit l'index UNE seule fois, puis lookup O(1) par produit.
  const index = buildStockMetricsIndex(db.commandes);
  const upcomingIndex = buildUpcomingDemandIndex(db);
  return db.stock.map(product => enrichStockItem(db, product, index, upcomingIndex));
}

function getRecommendations(db) {
  return getStockView(db)
    .filter(product => ["stock_faible", "rupture", "a_renseigner"].includes(product.stockStatus))
    .map(product => {
      const available = Number(product.quantityAvailable) || 0;
      // Le besoin que le rayon n'a pas encore servi (lot « stock », 24/09) :
      // une commande en preparation a deja sorti ses quantites du rayon.
      // Avec quantityNeeded, 7 sortis sur 10 (rayon 3, seuil 5) donnaient
      // 4 a racheter au lieu de 2. C'est le besoin de l'ecran « A recommander »
      // depuis la relecture adverse du 24/09 (quantityNeededNotDeducted).
      const needed = Number(product.quantityNeededNotDeducted) || 0;
      // Seuil 0 legitime preserve : on ne le remplace par 5 que si la valeur est invalide
      // (null, undefined, NaN, "" -> non finite). Cf. fix v1.1.0 sur normalizeProducts.
      const thresholdRaw = Number(product.alertThreshold);
      const minimum = Number.isFinite(thresholdRaw) ? thresholdRaw : DEFAULT_STOCK_ALERT_THRESHOLD;
      const recommended = Math.max(0, Math.ceil(Math.max(minimum - available, needed - available)));

      return {
        ...product,
        recommendedQuantity: recommended,
        recommendationStatus: product.stockStatus === "rupture" ? "urgent" : "bientot"
      };
    });
}

// `commande` (lot « stock », 24/09) : la commande dont le mouvement vient
// (reservation, liberation, livraison acceptee) -- son id et son numero sont
// gardes sur le mouvement (orderId : la colonne reference_commande de la
// table). Une quantite inconnue (« a renseigner », null) compte pour 0 dans
// le sens et l'ampleur du mouvement, et reste null dans oldQuantity.
function recordStockMovement(db, product, oldQuantity, newQuantity, reason = "Ajustement manuel", { commande = null } = {}) {
  if (oldQuantity === newQuantity) return;
  const ancienne = Number(oldQuantity) || 0;
  const nouvelle = Number(newQuantity) || 0;

  ajouterEnTete(db, "stockMovements", {
    id: `stock-${crypto.randomUUID()}`,
    productId: product.id,
    productName: getProductName(product),
    sku: getProductCode(product),
    type: nouvelle >= ancienne ? "entree" : "sortie",
    quantity: Math.round(Math.abs(nouvelle - ancienne) * 100) / 100,
    oldQuantity,
    newQuantity,
    reason: clean(reason) || "Ajustement manuel",
    ...(commande ? { orderId: String(commande.id), numero: clean(commande.numero) } : {}),
    createdAt: new Date().toISOString(),
    // Avant le 24/09 : « local », toujours. L'auteur est celui de la requete.
    createdBy: auteurCourant()
  });
}

function getDashboardSummary(db, { nombreDeVentes = db.ventes.length } = {}) {
  const stockView = getStockView(db);
  const today = jourParis();
  const orderCounts = {
    imported: db.commandes.length,
    toCheck: db.commandes.filter(order => ["importe", "stock_a_verifier"].includes(order.status)).length,
    preparable: db.commandes.filter(order => ["importe", "stock_a_verifier"].includes(order.status) && order.canPrepare).length,
    blocked: db.commandes.filter(order => ["importe", "stock_a_verifier"].includes(order.status) && !order.canPrepare).length,
    preparing: db.commandes.filter(order => order.status === "en_preparation").length,
    readyDelivery: db.commandes.filter(order => order.status === "pret_livraison").length,
    inDelivery: db.commandes.filter(order => order.status === "en_livraison").length,
    delivered: db.commandes.filter(order => order.status === "livre").length,
    planned: db.commandes.filter(order => order.status === "planifiee").length,
    toConfirm: db.commandes.filter(order => order.status === "a_confirmer").length,
    deliveryProblems: db.commandes.filter(order => ["probleme_livraison", "a_reprogrammer"].includes(order.status)).length,
    missingAddress: db.commandes.filter(order => !clean(order.address) || !clean(order.city)).length,
    missingPhone: db.commandes.filter(order => !clean(order.phone)).length,
    deliveryToday: db.commandes.filter(order => order.deliveryDate === today && ["pret_livraison", "en_livraison"].includes(order.status)).length,
    deliveryUpcoming: db.commandes.filter(order => order.deliveryDate && order.deliveryDate > today && ["pret_livraison", "en_livraison"].includes(order.status)).length,
    remindersDue: db.relances.filter(reminder => reminder.status === "a_faire" && reminder.datePrevue <= today).length
  };
  const stockCounts = {
    total: stockView.length,
    ok: stockView.filter(product => product.stockStatus === "disponible").length,
    low: stockView.filter(product => product.stockStatus === "stock_faible").length,
    out: stockView.filter(product => product.stockStatus === "rupture").length,
    reserved: stockView.filter(product => product.stockStatus === "reserve").length,
    unknown: stockView.filter(product => product.stockStatus === "a_renseigner").length,
    needed: stockView.reduce((total, product) => total + (Number(product.quantityNeeded) || 0), 0)
  };
  const alerts = [
    ...stockView
      .filter(product => ["stock_faible", "rupture", "a_renseigner"].includes(product.stockStatus))
      .map(product => ({
        type: "stock",
        level: product.stockStatus === "rupture" ? "danger" : "warning",
        title: getProductName(product),
        message: product.stockStatus === "rupture"
          ? "Produit en rupture de stock."
          : `Stock a verifier : ${product.quantityAvailable ?? "non renseigne"}.`
      })),
    ...db.commandes
      .filter(order => ["importe", "stock_a_verifier"].includes(order.status) && !order.canPrepare)
      .map(order => ({
        type: "commande",
        level: "danger",
        title: order.clientName,
        message: `Commande bloquee : stock ${order.stockStatus}.`
      })),
    ...db.commandes
      .filter(order => !clean(order.address) || !clean(order.city) || !clean(order.phone))
      .map(order => ({
        type: "donnees",
        level: "warning",
        title: order.clientName,
        message: !clean(order.address) || !clean(order.city)
          ? "Adresse incomplete."
          : "Telephone manquant."
      }))
  ];

  return {
    orders: orderCounts,
    stock: stockCounts,
    // Le compte des lignes de ventes importees (« Resume du jour ») : la page
    // ne charge plus /api/ventes a l'ouverture pour ce seul nombre (24/09).
    ventes: { total: nombreDeVentes },
    alerts: alerts.slice(0, 20),
    routes: {
      draft: db.routes.filter(route => ["brouillon", "prete"].includes(route.status)).length,
      active: db.routes.filter(route => route.status === "en_livraison").length,
      // Lot 2 : une tournee cloturee est finie, comme une terminee ; une
      // annulee n'a jamais roule, elle ne compte nulle part.
      completed: db.routes.filter(route => ["terminee", "cloturee"].includes(route.status)).length
    }
  };
}

function productKeyFromLine(line) {
  const code = normalizeTextKey(line.code || line.sku || line.reference);
  if (code) return `code:${code}`;
  return `name:${normalizeTextKey(line.nom || line.produit || line.productName)}`;
}

// ============================================================================
// ERP v1.9.0 : numerotation bons de commande + detection doublons re-import
// ============================================================================

// Extrait l'annee d'une date ISO ou FR. Retourne l'annee courante (a Paris) en
// fallback pour ne jamais bloquer sur un format inconnu.
function extractYear(dateString) {
  // L'annee de repli est celle de PARIS : le 31/12 a 23:30 UTC, c'est deja l'an neuf.
  const anneeCourante = () => Number(jourParis().slice(0, 4));
  if (!dateString) return anneeCourante();
  const str = String(dateString);
  // Format ISO ou ISO-like : "2026-05-18" / "2026-05-18T..." / "2026/05/18"
  const isoMatch = str.match(/^(\d{4})[-/]/);
  if (isoMatch) return Number(isoMatch[1]);
  // Format francais : "18/05/2026" ou "18-05-2026"
  const frMatch = str.match(/^\d{1,2}[/-]\d{1,2}[/-](\d{4})/);
  if (frMatch) return Number(frMatch[1]);
  return anneeCourante();
}

// Genere le prochain numero de commande au format PREFIX-YYYY-NNN (reset
// annuel) ou PREFIX-NNNNN (continu). Le compteur est calcule a la volee
// depuis MAX(numero) en DB, ce qui evite un compteur en cache qui pourrait
// driver. Convient bien pour Sereo (volume B2B faible, < 10000 commandes/an).
//
// Format reset annuel    : CMD-2026-001, CMD-2026-002, ..., CMD-2027-001
// Format continu (jamais) : CMD-00001, CMD-00002, ..., CMD-12847
function generateOrderNumber(db, dateCommande) {
  const settings = normalizeSettings(db.settings || {});
  const { prefix, resetAnnually } = settings.orderNumbering;
  const existingNumeros = (db.commandes || [])
    .map(order => order.numero)
    .filter(Boolean);

  if (!resetAnnually) {
    // Compteur continu : extraire le plus grand suffixe numerique tout prefixe confondu
    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    const maxSeq = existingNumeros.reduce((max, numero) => {
      const match = numero.match(pattern);
      if (!match) return max;
      const seq = Number(match[1]);
      return Number.isFinite(seq) && seq > max ? seq : max;
    }, plancherDeNumero(db, prefix));
    return `${prefix}-${String(maxSeq + 1).padStart(5, "0")}`;
  }

  // Reset annuel : compteur par annee
  const year = extractYear(dateCommande);
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const maxSeq = existingNumeros.reduce((max, numero) => {
    const match = numero.match(pattern);
    if (!match) return max;
    const seq = Number(match[1]);
    return Number.isFinite(seq) && seq > max ? seq : max;
  }, plancherDeNumero(db, `${prefix}-${year}`));
  return `${prefix}-${year}-${String(maxSeq + 1).padStart(3, "0")}`;
}

// Chasse aux defauts du 24/09 (lot « stock ») : un numero attribue ne l'est
// plus jamais deux fois. La purge des bons retient, avant de vider les
// commandes, le plus grand numero de chaque serie (settings.numerosAttribues,
// retenirNumerosAttribues) ; le compteur part du plus grand des deux. Avant,
// la premiere commande d'apres une purge reprenait CMD-2026-001 et
// l'identifiant cmd-cmd-2026-001 : un rappel survivant visait alors la
// commande d'un autre client.
//
// Le plus grand numero deja attribue d'une serie (« CMD-2026 » : reset
// annuel ; « CMD » : compteur continu), retenu par une purge. 0 sinon.
function plancherDeNumero(db, serie) {
  const retenus = db.settings && typeof db.settings === "object" ? db.settings.numerosAttribues : null;
  const valeur = retenus && typeof retenus === "object" ? Number(retenus[serie]) : 0;
  return Number.isInteger(valeur) && valeur > 0 ? valeur : 0;
}

// A appeler AVANT de supprimer des commandes (la purge) : retient, par serie,
// le plus grand numero attribue, sans jamais faire redescendre un plancher.
function retenirNumerosAttribues(db) {
  const retenus = { ...((db.settings && db.settings.numerosAttribues) || {}) };
  const retenir = (serie, seq) => {
    if (Number.isInteger(seq) && seq > (Number(retenus[serie]) || 0)) retenus[serie] = seq;
  };
  for (const order of db.commandes || []) {
    const numero = String(order.numero || "");
    const annuel = numero.match(/^([A-Z0-9]{2,8})-(\d{4})-(\d+)$/);
    if (annuel) {
      retenir(`${annuel[1]}-${annuel[2]}`, Number(annuel[3]));
      continue;
    }
    const continu = numero.match(/^([A-Z0-9]{2,8})-(\d+)$/);
    if (continu) retenir(continu[1], Number(continu[2]));
  }
  db.settings = { ...(db.settings || {}), numerosAttribues: retenus };
}

// Hash deterministe d'une commande pour detecter les doublons au re-import.
// Combine clientId + dateCommande + lignes produits (code/nom + quantite).
// Deux imports identiques produisent le meme hash -> on peut skip silencieusement.
// Utilise SHA-256 de la chaine canonique pour minimiser les collisions.
function computeOrderHash({ clientId, dateCommande, products }) {
  const safeClientId = String(clientId || "");
  const safeDate = String(dateCommande || "").slice(0, 10); // YYYY-MM-DD ou DD/MM/YYYY
  const safeProducts = (Array.isArray(products) ? products : [])
    .map(p => {
      const code = normalizeTextKey(p.code || p.sku || p.reference);
      const nom = normalizeTextKey(p.nom || p.produit || p.productName);
      const key = code || nom;
      const qty = Number(p.quantite ?? p.quantity ?? 0);
      return `${key}:${qty}`;
    })
    .filter(Boolean)
    .sort()
    .join("|");
  const canonical = `${safeClientId}#${safeDate}#${safeProducts}`;
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function stockLookup(stock) {
  const map = new Map();

  stock.forEach(item => {
    const code = normalizeTextKey(item.code || item.sku || item.reference);
    const name = normalizeTextKey(getProductName(item));

    if (code) map.set(`code:${code}`, item);
    if (name) map.set(`name:${name}`, item);
  });

  return map;
}

function normalizeProducts(products) {
  if (!Array.isArray(products)) return [];

  return products
    .map((product, index) => {
      const isObject = product && typeof product === "object";
      const code = clean(isObject ? product.code || product.sku || product.reference : "");
      const name = clean(isObject ? product.nom || product.produit || product.productName || product.name : product);
      // Math.max(0, ...) au lieu de Math.max(1, ...) : une quantite 0 est conservee telle quelle
      // pour ne pas masquer les saisies invalides ou volontairement nulles. On utilise `??`
      // au lieu de `||` pour ne pas confondre 0 (valide) avec null/undefined (fallback).
      const rawQty = isObject ? (product.quantite ?? product.quantity ?? product.qte) : 1;
      const quantity = Math.max(0, number(rawQty, 1));
      const explicitLineTotal = isObject
        ? firstPositiveNumber(
            product.totalLigne,
            product.lineTotal,
            product.total,
            product.ttc,
            product.TTC,
            product.totalTtc,
            product.montantTtc,
            product.ht,
            product.HT,
            product.totalHt,
            product.montantHt,
            product.montant
          )
        : 0;
      const rawUnitPrice = isObject
        ? firstPositiveNumber(product.prixUnitaire, product.unitPrice, product.price, product.tarif, product.prix)
        : 0;
      const unitPrice = rawUnitPrice || (quantity > 0 && explicitLineTotal ? explicitLineTotal / quantity : 0);
      const lineTotal = explicitLineTotal || (quantity * unitPrice);

      return {
        id: isObject ? product.id || `${code || name || "produit"}-${index}` : `${name || "produit"}-${index}`,
        code,
        nom: name || code || "Produit",
        quantite: quantity,
        prixUnitaire: Math.round(unitPrice * 100) / 100,
        totalLigne: Math.round(lineTotal * 100) / 100
      };
    })
    .filter(product => product.code || product.nom);
}

// Lot « stock » (chasse aux defauts du 24/09) : deux lignes d'une commande qui
// designent le MEME produit du stock (le meme productId deux fois, ou la meme
// reference avec et sans code dans un fichier) etaient controlees chacune
// seule : 3 + 3 sur un rayon de 5 passait, la reservation ramenait le rayon a
// 0 (une unite perdue sans trace, setStockQuantity), et la liberation en
// rendait 6. Les lignes d'un meme produit se partagent desormais le rayon :
// chacune y prend a son tour, et `available` est ce qu'il en reste pour ELLE
// (une ligne seule : le rayon, comme avant). Le manque de la commande est la
// somme des manques, et `quantitesParProduit` donne a la reservation et a la
// liberation la quantite de chaque produit, lignes additionnees.
//
// `lookup` : la table de recherche du catalogue, deja construite par
// l'appelant (syncWorkflow la construit UNE fois pour toutes les commandes).
// Un appel isole (un geste sur une commande) la construit lui-meme.
function analyzeOrderStock(order, stock, lookup = stockLookup(stock)) {
  const restantParProduit = new Map(); // produit du stock -> ce que le rayon laisse aux lignes suivantes
  const lines = normalizeProducts(order.products).map(product => {
    const stockItem = lookup.get(productKeyFromLine(product)) || lookup.get(`name:${normalizeTextKey(product.nom)}`);
    const enRayon = stockItem ? getStockQuantity(stockItem) : null;
    const available = enRayon === null ? null : (restantParProduit.has(stockItem) ? restantParProduit.get(stockItem) : enRayon);
    const required = Math.max(0, number(product.quantite, 0));
    const missing = available === null ? required : Math.max(0, required - available);
    if (available !== null) restantParProduit.set(stockItem, Math.max(0, available - required));
    let status = "ok";

    if (!stockItem || available === null) status = "unknown";
    else if (available < required) status = "missing";

    return {
      code: product.code,
      nom: product.nom,
      required,
      available,
      missing,
      stockId: stockItem?.id ?? null,
      status
    };
  });

  const hasUnknown = lines.some(line => line.status === "unknown");
  const hasMissing = lines.some(line => line.status === "missing");
  const status = hasMissing ? "insuffisant" : (hasUnknown ? "inconnu" : "disponible");

  return {
    status,
    canPrepare: lines.length > 0 && status === "disponible",
    lines
  };
}

// Les lignes d'une analyse (analyzeOrderStock), regroupees par produit du
// stock : [{ stockId, quantite }], lignes du meme produit additionnees. Les
// lignes sans produit connu, ou que `garder` ecarte, ne comptent pas.
function quantitesParProduit(lines, garder = () => true) {
  const parProduit = new Map();
  for (const line of lines) {
    if (line.stockId === null || line.stockId === undefined) continue;
    if (!line.required || line.required <= 0 || !garder(line)) continue;
    const cle = String(line.stockId);
    parProduit.set(cle, (parProduit.get(cle) || 0) + line.required);
  }
  return [...parProduit].map(([stockId, quantite]) => ({ stockId, quantite: Math.round(quantite * 100) / 100 }));
}

// ERP v1.9.0 : syncWorkflow ne regenere PLUS 1 commande par client. Il
// enrichit les commandes existantes (analyse stock) et synchronise les statuts
// des clients en se basant sur leur commande LA PLUS RECENTE. Cela permet le
// modele N commandes par client (1 par dateCommande).
//
// Compatibilite legacy : si un client existe SANS aucune commande (seed test,
// import historique), on en cree une "fallback" pour preserver le comportement
// des anciennes UIs qui supposent qu'un client a toujours une commande.
// Compte des synchronisations, pour les bancs (test/rapidite-serveur.test.js) :
// une ecriture = une synchronisation.
let synchronisations = 0;

function syncWorkflow(db) {
  synchronisations += 1;
  db.clients = db.clients.map(client => normalizeClient(client));

  // Bucket des commandes par clientId (1->N relation)
  const ordersByClientId = new Map();
  db.commandes.forEach(order => {
    const cid = String(order.clientId);
    if (!ordersByClientId.has(cid)) ordersByClientId.set(cid, []);
    ordersByClientId.get(cid).push(order);
  });

  // Legacy compat : un client sans aucune commande recoit une commande
  // fallback (deduite de ses produits) pour ne pas casser les anciennes UIs
  // qui supposent 1 client = 1 commande.
  db.clients.forEach(client => {
    const orders = ordersByClientId.get(String(client.id)) || [];
    if (orders.length > 0) return;
    if (!Array.isArray(client.produits) || client.produits.length === 0) return;

    const today = jourParis();
    const fallback = normalizeOrder({
      clientId: client.id,
      clientName: client.nom,
      address: client.rue,
      city: client.ville,
      postalCode: client.codePostal,
      sector: client.secteur,
      phone: client.telephone,
      products: client.produits,
      lat: client.lat,
      lng: client.lng,
      // Le point du client, et ce qu'il vaut (lots 3 et 4 de l'audit geo).
      geoPrecision: getCoordinates(client) ? client.geoPrecision || "" : "",
      geoSource: getCoordinates(client) ? "client" : "",
      notes: client.notes,
      priority: client.priority,
      dateCommande: today,
      dateImport: new Date().toISOString(),
      numero: generateOrderNumber(db, today),
      status: client.statut === "livree" ? "livre" : "stock_a_verifier"
    });
    fallback.id = `cmd-${fallback.numero.toLowerCase()}`;
    db.commandes.push(fallback);
    ordersByClientId.set(String(client.id), [fallback]);
  });

  // Re-normalisation + enrichissement (analyse stock) de TOUTES les commandes.
  // La table de recherche du catalogue se construit UNE fois (25/09) : chaque
  // commande la reconstruisait -- deux normalisations de texte par produit et
  // par commande, la moitie d'une ecriture en production, 1,3 s a dix fois la
  // base. Rien ne touche au stock pendant l'enrichissement : la table vaut
  // pour toutes les commandes.
  const catalogue = stockLookup(db.stock);
  db.commandes = db.commandes
    .map(order => normalizeOrder(order))
    .map(order => enrichOrder(order, db.stock, catalogue));

  // Statut du client = statut de sa commande la plus recente (par dateCommande)
  const latestOrderByClient = new Map();
  db.commandes.forEach(order => {
    const cid = String(order.clientId);
    const current = latestOrderByClient.get(cid);
    const orderDate = String(order.dateCommande || "");
    const currentDate = current ? String(current.dateCommande || "") : "";
    if (!current || orderDate.localeCompare(currentDate) > 0) {
      latestOrderByClient.set(cid, order);
    }
  });

  db.clients = db.clients.map(client => {
    const order = latestOrderByClient.get(String(client.id));
    if (!order) return client;

    return {
      ...client,
      secteur: order.sector,
      workflowStatus: order.status,
      preparationStatus: order.preparationStatus,
      deliveryStatus: order.deliveryStatus,
      statut: mapOrderStatusToClientStatus(order)
    };
  });

  // Lot 5 (audit geo, 23/09) : l'index des commandes se construit UNE fois pour
  // toutes les tournees. Avant, normalizeRoute le reconstruisait pour chacune :
  // O(tournees x commandes), 134 ms a 250 tournees, a chaque ecriture.
  const orderMap = new Map(db.commandes.map(order => [String(order.id), order]));
  db.routes = db.routes.map(route => normalizeRoute(route, orderMap));
}

function normalizeClient(client) {
  const city = normalizeCity(client.ville || client.city);
  const sector = deriveSector(city, client.secteur || client.sector);

  return {
    ...client,
    id: client.id ?? crypto.randomUUID(),
    nom: clean(client.nom || client.name || client.client || "Client sans nom"),
    rue: clean(client.rue || client.address || client.adresse),
    ville: city,
    codePostal: geocodage.normaliserCodePostal(client.codePostal || client.postalCode || client.cp),
    telephone: clean(client.telephone || client.phone),
    statut: client.statut || "restant",
    produits: normalizeProducts(client.produits || client.products),
    lat: client.lat ?? client.latitude ?? "",
    lng: client.lng ?? client.longitude ?? "",
    secteur: sector,
    notes: clean(client.notes || client.remarques),
    priority: clean(client.priority || client.priorite),
    prenom: clean(client.prenom || client.firstName),
    email: clean(client.email || client.mail),
    crmStatus: CRM_STATUSES.has(client.crmStatus || client.statutCrm) ? (client.crmStatus || client.statutCrm) : "",
    firstContactDate: normalizeDateInput(client.firstContactDate || client.datePremierContact || client.dateCreation),
    lastVisitDate: normalizeDateInput(client.lastVisitDate || client.dateDerniereVisite),
    nextReminderDate: normalizeDateInput(client.nextReminderDate || client.prochaineRelance),
    source: clean(client.source || client.sourceContact),
    preferences: clean(client.preferences || client.produitsPreferes),
    needs: clean(client.needs || client.besoinsParticuliers),
    estimatedFrequency: clean(client.estimatedFrequency || client.frequenceCommande),
    nextDeliveryDate: normalizeDateInput(client.nextDeliveryDate || client.prochaineLivraison),
    crmArchived: Boolean(client.crmArchived),
    crmConvertedAt: client.crmConvertedAt || ""
  };
}

function normalizeDeliverySector(sector = {}) {
  const city = normalizeCity(sector.villePrincipale || sector.mainCity || sector.ville || sector.city);
  const sectorName = clean(sector.secteur || sector.name || sector.nom || deriveSector(city));
  const day = Math.max(1, Math.min(31, Math.round(number(sector.jourMois ?? sector.dayOfMonth, 1))));
  const now = new Date().toISOString();

  return {
    ...sector,
    id: sector.id || `secteur-${crypto.randomUUID()}`,
    secteur: sectorName || "Secteur",
    villePrincipale: city || sectorName || "",
    jourMois: day,
    frequence: clean(sector.frequence || sector.frequency || "mensuelle"),
    pointDepart: clean(sector.pointDepart || sector.departurePoint) || "Champagnole",
    notes: clean(sector.notes || sector.remarques),
    createdAt: sector.createdAt || now,
    updatedAt: sector.updatedAt || now
  };
}

function normalizeOrder(order) {
  const city = normalizeCity(order.city || order.ville);
  const sector = deriveSector(city, order.sector || order.secteur);
  const status = ORDER_STATUSES.has(order.status) ? order.status : inferOrderStatus(order);
  const preparationStatus = order.preparationStatus || inferPreparationStatus(status);
  const deliveryStatus = order.deliveryStatus || inferDeliveryStatus(status);
  const now = new Date().toISOString();

  // P0 (audit 2026-07-08) : dateCommande est la cle de bucket ERP. On ne doit
  // JAMAIS ecraser une date metier existante mais non normalisable par la date
  // du jour : ce fallback silencieux corrompait en masse les dates a chaque
  // writeDb (syncWorkflow re-normalise TOUTES les commandes). On preserve donc
  // la valeur brute (string) telle quelle : le diagnostic /api/diagnostic/
  // suspicious-dates la signale pour correction manuelle, sans perte. Le defaut
  // "aujourd'hui" ne s'applique qu'a une commande SANS aucune date fournie.
  // dateCommande est une date sans heure : lue telle quelle. dateImport et
  // createdAt sont des instants : leur jour est celui de Paris (24/09), comme
  // le defaut « aujourd'hui ».
  const rawDateCommande = order.dateCommande || order.dateImport || order.createdAt;
  const normalizedDateCommande = order.dateCommande
    ? normalizeDateInput(order.dateCommande)
    : jourCalendaire(rawDateCommande);
  const dateCommande = normalizedDateCommande
    || (typeof rawDateCommande === "string" && rawDateCommande.trim()
      ? rawDateCommande.trim()
      : jourParis());

  return {
    id: order.id || `cmd-${order.clientId || crypto.randomUUID()}`,
    // Champs ERP v1.9.0 : numero humain (CMD-2026-001) + date metier de la
    // commande (date Excel ou date import) + hash deterministe pour anti-doublon.
    // Sont attribues par generateOrderNumber() et computeOrderHash() au moment
    // de la creation (import ou creation manuelle), preserves a chaque re-import.
    numero: order.numero || "",
    // dateCommande : ISO YYYY-MM-DD canonique quand normalisable (match exact
    // (clientId, dateCommande) au re-import) ; sinon la valeur brute preservee
    // (cf. calcul ci-dessus), jamais today. normalizeDateInput accepte FR
    // (DD/MM/YYYY), ISO (avec ou sans heure) et Date object.
    dateCommande,
    excelRowHash: order.excelRowHash || "",
    clientId: order.clientId,
    clientName: clean(order.clientName || order.nom || order.client || "Client sans nom"),
    address: clean(order.address || order.rue || order.adresse),
    city,
    postalCode: geocodage.normaliserCodePostal(order.postalCode || order.codePostal || order.cp),
    sector,
    products: normalizeProducts(order.products || order.produits),
    status,
    preparationStatus,
    deliveryStatus,
    createdAt: order.createdAt || now,
    updatedAt: order.updatedAt || now,
    notes: clean(order.notes || order.remarques),
    priority: clean(order.priority || order.priorite),
    phone: clean(order.phone || order.telephone),
    lat: order.lat ?? order.latitude ?? "",
    lng: order.lng ?? order.longitude ?? "",
    // Lot 3 (audit geo) : la precision du point (numero, rue, commune, manuel)
    // et son origine (client, manuel, calcul) survivent a la normalisation.
    geoPrecision: clean(order.geoPrecision),
    geoSource: clean(order.geoSource),
    deliveryDate: normalizeDateInput(order.deliveryDate || order.dateLivraison || order.livraisonDate),
    stockReservedAt: order.stockReservedAt || null,
    // Chantier 1 (2026-06-04) : preserver l'historique des liberations de stock
    // manuelles (audit log). Null tant que jamais libere.
    stockReleasedAt: order.stockReleasedAt || null,
    stockReleaseReason: order.stockReleaseReason || null,
    // Relecture adverse (23/09) : les lignes qu'une livraison acceptee sur un
    // stock non suivi n'a PAS deduites (reprendreStockLibere). La liberation ne
    // les rend pas. Absent de toute autre commande : rien n'est ajoute.
    ...(Array.isArray(order.stockNonDeduit) && order.stockNonDeduit.length ? { stockNonDeduit: order.stockNonDeduit.map(String) } : {}),
    routeId: order.routeId || null,
    importedAsLivre: order.importedAsLivre || false,
    deliveredAt: order.deliveredAt || "",
    // Decision 10 (lot 2 de l'audit geo) : « remis a… », note facultative du
    // geste « Livre ». Sans cette ligne, syncWorkflow l'effacerait a l'ecriture.
    remisA: clean(order.remisA),
    subscriptionId: order.subscriptionId || "",
    subscriptionDate: order.subscriptionDate || "",
    // Decision 8 (24/09) : annulee par la pause ou l'arret de son abonnement.
    ...(order.annuleeAvecAbonnement ? { annuleeAvecAbonnement: clean(order.annuleeAvecAbonnement) } : {}),
    source: clean(order.source || order.orderSource || order.sourceExcel),
    orderType: clean(order.orderType || order.typeCommande || order.type || (order.source === "commande_planifiee" ? "planifiee" : "immediate")),
    parentOrderId: clean(order.parentOrderId || order.commandeOrigineId || order.sourceOrderId),
    confirmedAt: order.confirmedAt || "",
    plannedReminderId: clean(order.plannedReminderId || order.reminderId),
    reminderLeadDays: Math.max(0, Math.round(number(order.reminderLeadDays, 7))),
    total: Math.max(0, number(order.total, 0)),
    // Le montant TTC fige d'une commande importee (25/09, voir montantTtcFige) :
    // absent ailleurs. Sans cette ligne, syncWorkflow l'effacerait a l'ecriture.
    ...(montantTtcFige(order) !== null ? { montantTtc: montantTtcFige(order) } : {}),
    sentToPreparationAt: order.sentToPreparationAt || ""
  };
}

function enrichOrder(order, stock, lookup = stockLookup(stock)) {
  const stockCheck = analyzeOrderStock(order, stock, lookup);
  // Chantier 1 : probleme/a_reprogrammer gardent leur reservation. Lot
  // « stock » (24/09) : une commande a verifier au stock deja sorti aussi --
  // jamais comparee au rayon qu'elle a elle-meme reduit (stockReserveActif).
  const stockReserved = stockReserveActif(order);

  return {
    ...order,
    stockStatus: stockReserved ? "reserve" : stockCheck.status,
    canPrepare: stockReserved || stockCheck.canPrepare,
    stockLines: stockCheck.lines
  };
}

function inferOrderStatus(order) {
  const deliveryStatus = order.deliveryStatus || order.statut;

  if (order.status === "planifiee" || order.orderType === "planifiee") return "planifiee";
  if (deliveryStatus === "livree" || deliveryStatus === "livre") return "livre";
  if (["absent", "probleme", "non_livre"].includes(deliveryStatus)) return "probleme_livraison";
  if (deliveryStatus === "en_cours" || deliveryStatus === "en_livraison") return "en_livraison";
  if (order.preparationStatus === "terminee") return "pret_livraison";

  return "stock_a_verifier";
}

function inferPreparationStatus(status) {
  if (["planifiee", "a_confirmer"].includes(status)) return "planifiee";
  if (status === "annulee") return "annulee";
  if (["en_preparation"].includes(status)) return "en_cours";
  if (["preparation_terminee", "pret_livraison", "en_livraison", "livre", "probleme_livraison", "a_reprogrammer"].includes(status)) return "terminee";
  if (status === "commande_client_validee" || status === "brouillon") return "commande_client";
  return "a_preparer";
}

function inferDeliveryStatus(status) {
  if (["planifiee", "a_confirmer"].includes(status)) return "planifiee";
  if (status === "annulee") return "annulee";
  if (status === "en_livraison") return "en_livraison";
  if (status === "livre") return "livre";
  if (status === "probleme_livraison") return "probleme";
  if (status === "a_reprogrammer") return "a_reprogrammer";
  if (["preparation_terminee", "pret_livraison"].includes(status)) return "pret_livraison";
  return "restant";
}

function mapOrderStatusToClientStatus(order) {
  if (order.deliveryStatus === "livre" || order.status === "livre") return "livree";
  if (order.deliveryStatus === "absent") return "absent";
  if (order.deliveryStatus === "probleme" || order.status === "probleme_livraison") return "probleme";
  if (order.deliveryStatus === "a_reprogrammer") return "non_livre";
  if (order.deliveryStatus === "en_livraison" || order.status === "en_livraison") return "en_cours";
  return "restant";
}

// `quand` : l'heure du GESTE, deja bornee par horodatageDuGeste (lot 1 de
// l'audit geo, M6). Sans elle, l'heure d'arrivee au serveur.
function setOrderStatus(order, status, quand = null) {
  if (!ORDER_STATUSES.has(status)) {
    throw badRequest("Statut commande invalide");
  }
  if (!isValidOrderStatusTransition(order.status, status)) {
    throw badRequest(`Transition non autorisee : ${order.status} -> ${status}`);
  }

  if (status === "livre" && order.status !== "livre") order.deliveredAt = quand || new Date().toISOString();
  order.status = status;
  order.preparationStatus = inferPreparationStatus(status);
  order.deliveryStatus = inferDeliveryStatus(status);
  order.updatedAt = new Date().toISOString();

  // Revue R1 chantier 1 (P1 #4) : sur livraison effective, la reservation
  // est CONSOMMEE (le stock a deja ete physiquement deduit en preparation,
  // la livraison ne refait rien sur le stock). On nullify stockReservedAt
  // pour que calculateReservedStock ne double-compte pas indefiniment.
  if (status === "livre" && order.stockReservedAt) {
    order.stockReservedAt = null;
    order.stockReleasedAt = order.updatedAt;
    order.stockReleaseReason = "consumed_by_delivery";
  }
}

// Lot « stock » (24/09) : la quantite de chaque PRODUIT (lignes du meme
// produit additionnees, quantitesParProduit) sort du rayon, et chaque sortie
// est ecrite au journal des mouvements (recordStockMovement : l'auteur est
// celui de la requete). Avant, rien n'y etait ecrit : un rayon qui avait
// change trois fois laissait /api/stock-movements vide. `motif` : ce que dit
// le mouvement (par defaut, la sortie pour la commande).
function reserveStockForOrder(db, order, motif = `Sortie pour la commande ${nomDeCommande(order)}`) {
  if (order.stockReservedAt) return;

  const stockCheck = analyzeOrderStock(order, db.stock);
  if (!stockCheck.canPrepare) {
    throw badRequest("Stock insuffisant ou non renseigne pour cette commande");
  }

  quantitesParProduit(stockCheck.lines).forEach(({ stockId, quantite }) => {
    const product = db.stock.find(item => String(item.id) === stockId);
    if (!product) return;

    const avant = getStockQuantity(product) ?? 0;
    // canPrepare garantit que le rayon couvre la somme : aucune remise a zero.
    const apres = Math.round((avant - quantite) * 100) / 100;
    product.quantite = apres;
    recordStockMovement(db, product, avant, apres, motif, { commande: order });
  });

  order.stockReservedAt = new Date().toISOString();
  // Toutes les lignes viennent d'etre deduites.
  delete order.stockNonDeduit;
}

// Ce que dit le mouvement d'une liberation, selon sa raison (les codes des
// appelants ; release-stock passe le texte saisi).
const MOTIFS_DE_LIBERATION = {
  order_cancelled: "commande annulée",
  planned_order_cancelled: "commande planifiée annulée",
  purge: "purge des bons de commande",
  manual_release: "libération manuelle",
  release: "libération",
  subscription_paused: "abonnement mis en pause",
  subscription_cancelled: "abonnement arrêté"
};

// Chantier 1 : symetrique de reserveStockForOrder. Restitue les quantites
// physiquement deduites quand une commande quitte le workflow sans etre livree
// (probleme_livraison, a_reprogrammer, annule). Idempotent : ne fait rien si
// la commande n'avait pas de reservation (stockReservedAt null).
//
// Critere d'appel : transitions terminales NON-livre. Si la commande revient
// ensuite en preparation, reserveStockForOrder() re-deduira proprement.
function releaseOrderStockReservation(db, order, reason) {
  if (!order.stockReservedAt) return false;

  // On recalcule les lignes via analyzeOrderStock plutot que de stocker la
  // reservation dans l'order : on garde une source unique de verite (les
  // products de l'order) et on est resilient au schema (lignes ajoutees/
  // retirees apres reservation sont rares mais possibles via un re-import).
  const stockCheck = analyzeOrderStock(order, db.stock);
  // Une ligne qu'aucune deduction n'a sortie du rayon (livraison acceptee sur
  // un stock non suivi) n'y rentre pas : l'ajouter inventerait une quantite.
  const nonDeduites = new Set(order.stockNonDeduit || []);
  const rendue = line => !nonDeduites.has(productKeyFromLine(line));
  // Le compte de l'historique reste celui des LIGNES rendues (« 2 ligne(s)
  // restituee(s) ») ; le rayon, lui, recoit la somme par produit (lot
  // « stock », 24/09 : deux lignes du meme produit rendent ce qu'elles ont pris,
  // ni plus ni moins), ecrite sans remise a zero -- un rayon negatif (livraison
  // acceptee sur stock insuffisant) remonte de la quantite rendue, il ne saute
  // pas a zero.
  const restoredCount = stockCheck.lines
    .filter(line => line.required > 0 && rendue(line) && db.stock.some(item => String(item.id) === String(line.stockId)))
    .length;
  const motif = `Rendue au rayon : commande ${nomDeCommande(order)} (${MOTIFS_DE_LIBERATION[reason] || clean(reason) || "libération"})`;
  quantitesParProduit(stockCheck.lines, rendue).forEach(({ stockId, quantite }) => {
    const product = db.stock.find(item => String(item.id) === stockId);
    if (!product) return;
    const avant = getStockQuantity(product) ?? 0;
    const apres = Math.round((avant + quantite) * 100) / 100;
    product.quantite = apres;
    recordStockMovement(db, product, avant, apres, motif, { commande: order });
  });

  order.stockReservedAt = null;
  order.stockReleasedAt = new Date().toISOString();
  order.stockReleaseReason = reason || "release";
  delete order.stockNonDeduit;

  addHistory(db, "Stock libere", `Commande ${order.numero || order.id} : ${restoredCount} ligne(s) restituee(s)`, {
    orderId: order.id,
    numero: order.numero,
    reason: reason || "release",
    lines: restoredCount
  });

  return true;
}

function findOrder(db, orderId) {
  const order = db.commandes.find(item => String(item.id) === String(orderId));
  if (!order) throw notFound("Commande introuvable");
  return order;
}

function findClient(db, clientId) {
  return db.clients.find(item => String(item.id) === String(clientId));
}

function normalizeCrmStatus(value, fallback = "prospect") {
  const raw = normalizeTextKey(value).replace(/\s+/g, "_");
  const aliases = {
    actif: "client_actif",
    client: "client_actif",
    client_actif: "client_actif",
    a_relancer: "client_a_relancer",
    relancer: "client_a_relancer",
    client_a_relancer: "client_a_relancer",
    inactive: "client_inactif",
    inactif: "client_inactif",
    client_inactif: "client_inactif",
    prospect: "prospect"
  };
  const status = aliases[raw] || raw;
  return CRM_STATUSES.has(status) ? status : fallback;
}

function normalizeRelanceStatus(value, fallback = "a_faire") {
  const raw = normalizeTextKey(value).replace(/\s+/g, "_");
  const aliases = {
    a_faire: "a_faire",
    faire: "a_faire",
    fait: "fait",
    faite: "fait",
    reporte: "reporte",
    reportee: "reporte",
    annule: "annule",
    annulee: "annule"
  };
  const status = aliases[raw] || raw;
  return RELANCE_STATUSES.has(status) ? status : fallback;
}

function normalizeCrmReminder(reminder = {}) {
  const now = new Date().toISOString();
  // Le jour par defaut d'un rappel : aujourd'hui a PARIS, pas la date UTC de `now`.
  const aujourdhui = jourParis(new Date(now));
  const status = normalizeRelanceStatus(reminder.status || reminder.statut);
  return {
    ...reminder,
    id: reminder.id || `relance-${crypto.randomUUID()}`,
    clientId: clean(reminder.clientId || reminder.client_id),
    commandeId: clean(reminder.commandeId || reminder.orderId || reminder.commande_id),
    type: clean(reminder.type || reminder.kind || "crm"),
    datePrevue: normalizeDateInput(reminder.datePrevue || reminder.reminderDate || reminder.date_prevue) || aujourdhui,
    motif: clean(reminder.motif || reminder.reason),
    commentaire: clean(reminder.commentaire || reminder.comment),
    status,
    dateRealisation: status === "fait"
      ? (normalizeDateInput(reminder.dateRealisation || reminder.doneDate) || aujourdhui)
      : normalizeDateInput(reminder.dateRealisation || reminder.doneDate),
    resultat: clean(reminder.resultat || reminder.result),
    createdAt: reminder.createdAt || now,
    updatedAt: reminder.updatedAt || now
  };
}

function getClientOrderHistory(db, clientId) {
  return db.commandes
    .filter(order => String(order.clientId) === String(clientId))
    .sort((a, b) => String(b.dateCommande || "").localeCompare(String(a.dateCommande || "")));
}

function inferCrmStatus(client, orders) {
  const explicit = normalizeCrmStatus(client.crmStatus || client.statutCrm || "");
  if (client.crmStatus || client.statutCrm) return explicit;
  if (orders.some(order => ["planifiee", "a_confirmer"].includes(order.status))) {
    return "client_a_relancer";
  }
  if (orders.some(order => ["livre", "en_livraison", "pret_livraison", "en_preparation", "stock_a_verifier", "commande_client_validee"].includes(order.status))) {
    return "client_actif";
  }
  if (client.nextReminderDate) return "client_a_relancer";
  return "prospect";
}

// Les commandes, les rappels et les abonnes actifs, par client, construits
// UNE fois pour la liste des clients (25/09). crmClientView parcourait toutes
// les commandes et tous les rappels pour chaque client : O(clients x
// commandes), 170 ms a dix fois la base, plusieurs secondes a cinquante. Memes
// listes, dans le meme ordre (meme tri, stable, sur les commandes prises dans
// l'ordre de la table).
function indexCrmParClient(db) {
  const parClient = (liste, champ) => {
    const index = new Map();
    for (const item of liste) {
      const cle = String(item.clientId);
      if (!index.has(cle)) index.set(cle, []);
      index.get(cle).push(item);
    }
    for (const items of index.values()) items.sort((a, b) => String(b[champ] || "").localeCompare(String(a[champ] || "")));
    return index;
  };
  return {
    commandes: parClient(db.commandes, "dateCommande"),
    relances: parClient(db.relances, "datePrevue"),
    abonnes: new Set((db.subscriptions || []).filter(sub => sub.status === "active").map(sub => String(sub.clientId)))
  };
}

// `ventesImportees` : l'index des ventes importees (buildImportedSalesIndex),
// construit UNE fois par la liste des clients plutot qu'une fois par client.
// `parClient` : indexCrmParClient, de meme (la fiche seule s'en passe).
function crmClientView(db, client, ventesImportees = null, parClient = null) {
  const orders = parClient ? parClient.commandes.get(String(client.id)) || [] : getClientOrderHistory(db, client.id);
  const reminders = parClient
    ? parClient.relances.get(String(client.id)) || []
    : db.relances
      .filter(reminder => String(reminder.clientId) === String(client.id))
      .sort((a, b) => String(b.datePrevue || "").localeCompare(String(a.datePrevue || "")));
  const latestOrder = orders[0];
  const firstOrder = orders[orders.length - 1];
  // Le chiffre d'affaires de la fiche (parcours simplifies, 24/09) : les
  // commandes LIVREES seulement, comme l'Analyse. Il additionnait toutes les
  // commandes du client, annulees comprises. Meme repli que computeStatistics
  // pour une commande importee sans montant : ses ventes importees.
  const livrees = orders.filter(order => order.status === "livre");
  let index = ventesImportees;
  const montantLivre = order => {
    const explicite = getOrderTotal(order);
    if (explicite) return explicite;
    index = index || buildImportedSalesIndex(db.ventes);
    return getImportedOrderTotal(index, order, orderDate(order));
  };

  const crmStatus = inferCrmStatus(client, orders);

  return {
    ...client,
    crmStatus,
    // Decision 5 (24/09) : un client non abonne qui depasse 1,5 fois son rythme
    // est SIGNALE, sans que son statut change (lib/relance-client.js). Derive a
    // chaque lecture, jamais ecrit ; du statut, il ne lit que « client_inactif »
    // (deja classe a la main) : « Confirmer » fige le statut en « client_actif »,
    // le signal ne s'y fie donc pas.
    relanceSuggeree: relanceSuggeree({
      commandes: orders,
      abonne: parClient
        ? parClient.abonnes.has(String(client.id))
        : (db.subscriptions || []).some(sub => String(sub.clientId) === String(client.id) && sub.status === "active"),
      statutCrm: crmStatus,
      archive: Boolean(client.crmArchived),
      aujourdhui: jourParis()
    }),
    firstContactDate: client.firstContactDate || firstOrder?.dateCommande || "",
    lastVisitDate: client.lastVisitDate || latestOrder?.dateCommande || "",
    nextReminderDate: client.nextReminderDate || reminders.find(item => item.status === "a_faire")?.datePrevue || "",
    orderHistory: orders,
    reminderHistory: reminders,
    visitHistory: Array.isArray(client.visitHistory) ? client.visitHistory : [],
    totalOrders: orders.length,
    deliveredOrders: livrees.length,
    totalRevenue: Math.round(livrees.reduce((total, order) => total + montantLivre(order), 0) * 100) / 100
  };
}

function getReminderViews(db, query = {}) {
  const today = jourParis();
  const range = clean(query.range || "");
  // Le client et la commande de chaque rappel, par index (25/09) : un find sur
  // toute la table pour chaque rappel. Le premier trouve, comme find.
  const premierParId = liste => {
    const index = new Map();
    for (const item of liste) if (!index.has(String(item.id))) index.set(String(item.id), item);
    return index;
  };
  const clients = db.relances.length ? premierParId(db.clients) : new Map();
  const commandes = db.relances.length ? premierParId(db.commandes) : new Map();
  let list = db.relances.map(reminder => ({
    ...reminder,
    client: clients.get(String(reminder.clientId)) || null,
    order: commandes.get(String(reminder.commandeId)) || null
  }));

  if (query.clientId) {
    list = list.filter(reminder => String(reminder.clientId) === String(query.clientId));
  }
  if (query.orderId || query.commandeId) {
    const orderId = query.orderId || query.commandeId;
    list = list.filter(reminder => String(reminder.commandeId) === String(orderId));
  }
  if (query.status) {
    const status = normalizeRelanceStatus(query.status, "");
    if (status) list = list.filter(reminder => reminder.status === status);
  }
  if (range === "today") list = list.filter(reminder => reminder.datePrevue === today);
  if (range === "late") list = list.filter(reminder => reminder.status === "a_faire" && reminder.datePrevue < today);
  if (range === "upcoming") list = list.filter(reminder => reminder.status === "a_faire" && reminder.datePrevue > today);
  if (range === "week") {
    const limit = ajouterJours(today, 7);
    list = list.filter(reminder => reminder.datePrevue >= today && reminder.datePrevue <= limit);
  }

  return list.sort((a, b) => String(a.datePrevue).localeCompare(String(b.datePrevue)));
}

function validateCrmClientPayload(payload = {}, existing = {}) {
  const city = normalizeCity(payload.ville ?? payload.city ?? existing.ville ?? "");
  const next = {
    ...existing,
    nom: clean(payload.nom ?? existing.nom ?? "Client sans nom"),
    prenom: clean(payload.prenom ?? existing.prenom),
    // Garde-fous de saisie (24/09) : 10 chiffres, 5 chiffres ; refus nomme,
    // et une valeur deja en base qui revient telle quelle n'est pas touchee.
    telephone: saisie.telephoneSaisi(payload.telephone, existing.telephone, badRequest),
    email: clean(payload.email ?? existing.email),
    rue: clean(payload.rue ?? payload.adresse ?? existing.rue),
    ville: city,
    codePostal: saisie.codePostalSaisi(payload.codePostal ?? payload.postalCode, existing.codePostal, badRequest),
    secteur: deriveSector(city, payload.secteur ?? existing.secteur),
    notes: clean(payload.notes ?? existing.notes),
    crmStatus: normalizeCrmStatus(payload.crmStatus ?? payload.statutCrm ?? existing.crmStatus),
    firstContactDate: normalizeDateInput(payload.firstContactDate ?? existing.firstContactDate) || existing.firstContactDate || jourParis(),
    lastVisitDate: normalizeDateInput(payload.lastVisitDate ?? existing.lastVisitDate),
    nextReminderDate: normalizeDateInput(payload.nextReminderDate ?? existing.nextReminderDate),
    source: clean(payload.source ?? existing.source),
    preferences: clean(payload.preferences ?? existing.preferences),
    needs: clean(payload.needs ?? existing.needs),
    estimatedFrequency: clean(payload.estimatedFrequency ?? existing.estimatedFrequency),
    updatedAt: new Date().toISOString()
  };

  if (!next.nom) throw badRequest("Nom client obligatoire");
  return normalizeClient(next);
}

// La cle d'un telephone pour reconnaitre un doublon : le numero normalise
// quand il est valide (« 06 12 34 56 78 » tape = « 0612345678 » en base, depuis
// que la saisie est normalisee, 24/09), sinon le texte comme avant.
function cleTelephone(valeur) {
  return saisie.normaliserTelephone(valeur) || normalizeTextKey(valeur || "");
}

function findDuplicateClient(db, payload, ignoreId = "") {
  const phone = cleTelephone(payload.telephone || payload.phone || "");
  const secondary = clientSecondaryKey({
    nom: [payload.prenom, payload.nom].filter(Boolean).join(" ") || payload.nom,
    codePostal: payload.codePostal || payload.postalCode
  });

  return db.clients.find(client => {
    if (ignoreId && String(client.id) === String(ignoreId)) return false;
    const clientPhone = cleTelephone(client.telephone || "");
    if (phone && clientPhone && phone === clientPhone) return true;
    if (secondary && clientSecondaryKey(client) === secondary) return true;
    return false;
  });
}

// Une commande pour un NOUVEAU client dont le telephone (ou le nom et le code
// postal) est deja celui d'une fiche (chasse aux defauts du 24/09, 25/09).
// Avant : la fiche trouvee prenait tout le formulaire -- « EHPAD Les
// Tilleuls » devenait « Roux », et sa rue, son email, ses notes partaient
// (le formulaire envoie ses champs vides). Le serveur ne devine plus : sans
// choix, il refuse (409) et rend la fiche ; l'ecran propose « rattacher a
// cette fiche » (clientId : prise telle quelle) ou « creer une nouvelle
// fiche » (`nouvelleFiche`). Les numeros se comparent normalises
// (cleTelephone : espaces, points, +33).
function doublonDeFiche(fiche) {
  const nom = [fiche.prenom, fiche.nom].filter(Boolean).join(" ") || fiche.nom || "sans nom";
  const erreur = badRequest(`Une fiche existe déjà avec ce téléphone ou ce nom : ${nom}. Rattache la commande à cette fiche, ou crée une nouvelle fiche.`);
  erreur.statusCode = 409;
  // Une question, rien n'est applique : la cle X-Sereo-Geste ne la garde pas.
  erreur.question = true;
  erreur.details = {
    doublon: {
      id: fiche.id, nom: fiche.nom || "", prenom: fiche.prenom || "", telephone: fiche.telephone || "",
      rue: fiche.rue || "", codePostal: fiche.codePostal || "", ville: fiche.ville || ""
    }
  };
  return erreur;
}

//
// Le 409 ne va qu'a une page qui sait poser la question : elle le demande
// (`demander`, champ `demanderSiDoublon` de la commande). Sans demande ni
// choix -- une page d'avant la mise a jour, ou une commande rejouee par la
// file d'attente --, un refus retirerait la commande de la file (4xx :
// abandonnee) : elle part sur une NOUVELLE fiche, l'existante ne bouge pas.
// Une fiche en double se fusionne ; une commande perdue ne se retrouve pas.
//
// `rattacher` : un appel du SERVEUR lui-meme, qui n'a personne a qui poser la
// question -- « Planifier la suite » d'une commande dont la fiche a disparu
// (relecture adverse du 26/09 ; la production en a une, du 03/06, dont le
// client existe sous un autre identifiant). La commande part sur la fiche
// trouvee, prise TELLE QUELLE (avant le 25/09 : reecrite ; depuis, sans ce
// drapeau : une fiche en double creee en silence).
function findOrCreateCustomerClient(db, payload = {}, { nouvelleFiche = false, demander = false, rattacher = false } = {}) {
  if (payload.clientId) {
    const existing = findClient(db, payload.clientId);
    if (existing) return existing;
  }

  if (!nouvelleFiche && (demander || rattacher)) {
    const duplicate = findDuplicateClient(db, payload);
    if (duplicate && rattacher) return duplicate;
    if (duplicate) throw doublonDeFiche(duplicate);
  }

  const client = validateCrmClientPayload({
    ...payload,
    crmStatus: payload.crmStatus || "prospect"
  }, {
    id: `client-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    produits: []
  });
  db.clients.push(client);
  return client;
}

function getProductUnitPrice(product) {
  return Math.max(0, number(product.prixUnitaire ?? product.unitPrice ?? product.tarif ?? product.prix ?? product.price ?? product.cout, 0));
}

function buildCustomerOrderLines(db, products, options = {}) {
  if (!Array.isArray(products) || !products.length) {
    throw badRequest("Ajoute au moins un produit a la commande");
  }
  const checkStock = options.checkStock !== false;

  return products.map(item => {
    const stockItem = db.stock.find(product => String(product.id) === String(item.productId || item.stockId || item.id))
      || db.stock.find(product => productKey(product) === productKey(item));
    if (!stockItem) throw badRequest(`Produit introuvable : ${clean(item.nom || item.code || item.productId)}`);

    const quantity = Math.max(0, number(item.quantite ?? item.quantity, 0));
    if (quantity <= 0) throw badRequest("Quantite produit invalide");

    const available = getStockQuantity(stockItem);
    if (checkStock && available !== null && quantity > available) {
      throw badRequest(`Stock insuffisant pour ${getProductName(stockItem)} (${available} disponible)`);
    }

    const prixUnitaire = getProductUnitPrice(item) || getProductUnitPrice(stockItem);
    return {
      id: `line-${crypto.randomUUID()}`,
      stockId: stockItem.id,
      code: getProductCode(stockItem),
      nom: getProductName(stockItem),
      quantite: quantity,
      prixUnitaire,
      totalLigne: Math.round(quantity * prixUnitaire * 100) / 100
    };
  });
}

// LE MONTANT TTC FIGE d'une commande importee (25/09). Chasse aux defauts du
// 24/09 : 197 commandes sur 224 n'avaient de montant ni sur elles ni sur leurs
// lignes ; leur chiffre d'affaires se relisait dans `db.ventes`, que chaque
// import remplacait -- un fichier du seul mois courant mettait les mois passes
// a 0. L'import fige desormais le montant de chaque bon sur la commande, et
// une migration unique (figerMontantsImportes) l'a fait pour les commandes
// d'avant. Decision 7 de Thomas (24/09) : c'est un montant TTC, avoirs
// soustraits (il peut etre negatif) ; une ligne sans TTC n'y compte pas.
// null : pas de montant fige (commande saisie dans Sereo, ou ancienne).
function montantTtcFige(order) {
  if (!order || order.montantTtc === undefined || order.montantTtc === null || order.montantTtc === "") return null;
  const montant = Number(order.montantTtc);
  return Number.isFinite(montant) ? Math.round(montant * 100) / 100 : null;
}

function getOrderTotal(order) {
  const fige = montantTtcFige(order);
  if (fige !== null) return fige;
  const explicit = firstPositiveNumber(order.total, order.totalTtc, order.ttc, order.montantTotal, order.montant);
  if (explicit > 0) return Math.round(explicit * 100) / 100;
  return normalizeProducts(order.products).reduce((total, line) => {
    const unit = Math.max(0, number(line.prixUnitaire ?? line.tarif ?? line.price, 0));
    const lineTotal = firstPositiveNumber(line.totalLigne, line.total, line.ttc, line.ht);
    return total + (lineTotal || Math.max(0, number(line.quantite, 0)) * unit);
  }, 0);
}

// « Prospects convertis ce mois » (chasse aux defauts du 24/09) : un client
// devient « converti » a sa premiere commande ferme, s'il etait PROSPECT --
// aucune commande livree ni en cours avant celle-ci (une planifiee pas encore
// confirmee, une annulee ou un brouillon ne font pas un client). Avant,
// crmConvertedAt se posait des qu'il etait vide : une pharmacie cliente
// depuis 2024 qui commandait chez elle comptait comme une conversion (et les
// 97 fiches importees de la production, qui n'en ont pas, l'auraient toutes
// ete a leur premiere commande terrain). `commande` : celle qui convertit,
// ecartee du compte.
const STATUTS_QUI_NE_FONT_PAS_UN_CLIENT = new Set(["planifiee", "a_confirmer", "annulee", "brouillon"]);

function etaitProspect(db, clientId, commande = null) {
  return !(db.commandes || []).some(order => String(order.clientId) === String(clientId)
    && order !== commande
    && !(commande && String(order.id) === String(commande.id))
    && !STATUTS_QUI_NE_FONT_PAS_UN_CLIENT.has(order.status));
}

function createCustomerOrder(db, payload = {}) {
  const requestedType = clean(payload.orderType || payload.typeCommande || payload.type).toLowerCase();
  if (requestedType === "planifiee" || requestedType === "planifie" || requestedType === "planned") {
    return createPlannedOrder(db, payload).order;
  }

  // L'identifiant choisi (« rattacher a cette fiche ») l'emporte sur celui,
  // vide, que le formulaire d'un nouveau client porte dans `client`.
  const client = findOrCreateCustomerClient(db, {
    ...(payload.client || {}),
    clientId: payload.clientId || payload.client?.clientId
  }, { nouvelleFiche: payload.nouvelleFiche === true, demander: payload.demanderSiDoublon === true });
  const dateCommande = normalizeDateInput(payload.dateCommande) || jourParis();
  // Decision 11 de Thomas (24/09) : un produit en rupture (ou au stock non
  // renseigne) ne fait plus REFUSER la commande prise chez le client. Elle est
  // acceptee en « Bloquee », comme une commande importee : rien n'est reserve,
  // et la Preparation la debloque quand le stock arrive.
  const lines = buildCustomerOrderLines(db, payload.products || payload.produits, { checkStock: false });
  const total = Math.round(lines.reduce((sum, line) => sum + line.totalLigne, 0) * 100) / 100;
  const numero = generateOrderNumber(db, dateCommande);
  // Un code postal de livraison propre a la commande : les memes 5 chiffres (24/09).
  const postalCode = payload.postalCode
    ? saisie.codePostalSaisi(payload.postalCode, client.codePostal, badRequest)
    : client.codePostal;
  const order = normalizeOrder({
    id: `cmd-${numero.toLowerCase()}`,
    numero,
    clientId: client.id,
    clientName: [client.prenom, client.nom].filter(Boolean).join(" ") || client.nom,
    address: payload.deliveryAddress || client.rue,
    city: payload.city || client.ville,
    postalCode,
    sector: client.secteur,
    phone: client.telephone,
    products: lines,
    status: "commande_client_validee",
    source: "commande_terrain",
    orderType: "immediate",
    total,
    notes: clean(payload.notes || payload.deliveryNotes),
    dateCommande,
    deliveryDate: normalizeDateInput(payload.deliveryDate || payload.dateLivraison),
    createdAt: new Date().toISOString()
  });

  client.crmStatus = "client_actif";
  if (!client.crmConvertedAt && etaitProspect(db, client.id)) client.crmConvertedAt = new Date().toISOString();
  client.lastVisitDate = dateCommande;
  client.nextReminderDate = client.nextReminderDate || "";
  heriterPositionDuClient(order, client);
  db.commandes.push(order);
  // Le stock suffit : reserve comme avant. Sinon (decision 11) : rien n'est
  // reserve, la commande attend en « Bloquee » (canPrepare faux).
  if (analyzeOrderStock(order, db.stock).canPrepare) reserveStockForOrder(db, order);
  setOrderStatus(order, "stock_a_verifier");
  order.sentToPreparationAt = new Date().toISOString();
  return order;
}

function dateFromYmd(dateString) {
  const normalized = normalizeDateInput(dateString);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function findDeliverySectorConfig(db, sectorOrCity) {
  const key = normalizeTextKey(sectorOrCity);
  if (!key) return null;
  return (db.deliverySectors || []).find(item => {
    return normalizeTextKey(item.secteur) === key
      || normalizeTextKey(item.villePrincipale) === key
      || normalizeTextKey(item.ville) === key;
  }) || null;
}

// ---------------------------------------------------------------------------
// Dates non ouvrees.
//
// Decision de Tom, 17/09 : quand la date d'un secteur tombe un dimanche ou un
// jour ferie, on NE DEPLACE PAS la date -- on PREVIENT. Le choix reste humain.
// Ces fonctions ne servent donc qu'a l'affichage : nextSectorDeliveryDate
// n'est pas modifiee, et aucune donnee enregistree ne change.
//
// Pourquoi un calcul plutot qu'une table : les jours feries francais sont
// entierement derivables. Sept sont a date fixe ; les quatre autres dependent
// de Paques. Une table devrait etre reconduite chaque annee, et une table
// perimee se trompe en silence -- exactement le genre de panne qu'on ne voit
// qu'une fois la tournee partie.

/** Dimanche de Paques (comput gregorien, algorithme de Meeus/Jones/Butcher). */
function dimancheDePaques(annee) {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(annee, mois - 1, jour);
}

/**
 * Jours feries francais (metropole) d'une annee, indexes par date YYYY-MM-DD.
 * L'Alsace-Moselle en compte deux de plus ; Sereo livre dans le Jura, donc on
 * s'en tient a la metropole. A etendre le jour ou un secteur y passe.
 */
function joursFeriesFrance(annee) {
  const paques = dimancheDePaques(annee);
  const depuisPaques = (jours, nom) => {
    const date = new Date(paques.getFullYear(), paques.getMonth(), paques.getDate() + jours);
    return [toYmd(date), nom];
  };
  const fixe = (mois, jour, nom) => [toYmd(new Date(annee, mois - 1, jour)), nom];

  return new Map([
    fixe(1, 1, "Jour de l'an"),
    depuisPaques(1, "Lundi de Paques"),
    fixe(5, 1, "Fete du Travail"),
    fixe(5, 8, "Victoire 1945"),
    depuisPaques(39, "Ascension"),
    depuisPaques(50, "Lundi de Pentecote"),
    fixe(7, 14, "Fete nationale"),
    fixe(8, 15, "Assomption"),
    fixe(11, 1, "Toussaint"),
    fixe(11, 11, "Armistice 1918"),
    fixe(12, 25, "Noel")
  ]);
}

/**
 * Dit pourquoi une date n'est pas ouvree, ou null si elle l'est.
 * Un ferie qui tombe un dimanche est signale comme ferie : c'est l'information
 * la plus utile, et elle contient l'autre.
 */
function alerteDateNonOuvree(ymd) {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [annee, mois, jour] = ymd.split("-").map(Number);
  const date = new Date(annee, mois - 1, jour);
  // Une date inexistante (31 fevrier) deborde sur le mois suivant : on refuse.
  if (date.getMonth() !== mois - 1 || date.getDate() !== jour) return null;

  const ferie = joursFeriesFrance(annee).get(ymd);
  if (ferie) return { type: "ferie", libelle: ferie };
  if (date.getDay() === 0) return { type: "dimanche", libelle: "dimanche" };
  return null;
}

/**
 * Rabattement silencieux du jour du mois : un secteur regle le 31 tombe le 28
 * en fevrier. On ne l'interdit pas -- la politique n'est pas tranchee -- mais
 * on rend la date REELLEMENT retenue, pour qu'elle cesse d'etre une surprise.
 */
function jourDuMoisRabattu(jourVoulu, ymd) {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const jourRetenu = Number(ymd.split("-")[2]);
  return Number.isFinite(jourVoulu) && jourVoulu > jourRetenu;
}

// Le point de depart est AUJOURD'HUI A PARIS (24/09) : entre minuit et 2 h, le
// processus en UTC croyait etre la veille, et un secteur du jour pouvait etre
// propose... pour la veille. Ensuite, tout se calcule sur des cles, en UTC pur.
function nextSectorDeliveryDate(sectorConfig, fromDate = new Date()) {
  const sourceDay = Math.max(1, Math.min(31, Math.round(number(sectorConfig?.jourMois, 1))));
  const base = jourParis(fromDate);
  let year = Number(base.slice(0, 4));
  let month = Number(base.slice(5, 7)) - 1;

  const makeCandidate = () => {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(sourceDay, lastDay))).toISOString().slice(0, 10);
  };

  let candidate = makeCandidate();
  if (candidate < base) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    candidate = makeCandidate();
  }

  return candidate;
}

/**
 * Ajoute a un secteur sa prochaine date et l'eventuelle raison de prevenir.
 * RIEN n'est enregistre : ces champs sont calcules a la lecture. La date
 * elle-meme n'est pas deplacee -- c'est la decision de Tom du 17/09.
 */
function decorerSecteurPourAffichage(secteur) {
  const prochaineDate = nextSectorDeliveryDate(secteur);
  return {
    ...secteur,
    prochaineDate,
    alerte: alerteDateNonOuvree(prochaineDate),
    jourRabattu: jourDuMoisRabattu(Number(secteur?.jourMois), prochaineDate)
  };
}

function resolvePlannedDeliveryDate(db, client, payload = {}) {
  const explicit = normalizeDateInput(payload.deliveryDate || payload.dateLivraison || payload.livraisonDate);
  if (explicit) return explicit;
  const config = findDeliverySectorConfig(db, payload.sector || payload.secteur || client.secteur || client.ville);
  return config ? nextSectorDeliveryDate(config) : "";
}

function refreshClientReminderDate(db, clientId) {
  const client = findClient(db, clientId);
  if (!client) return;
  const next = db.relances
    .filter(reminder => String(reminder.clientId) === String(clientId) && reminder.status === "a_faire")
    .sort((a, b) => String(a.datePrevue).localeCompare(String(b.datePrevue)))[0];
  client.nextReminderDate = next?.datePrevue || "";
}

// Chasse aux defauts du 24/09 (lot « stock et abonnements ») : une commande
// annulee n'a plus rien a confirmer. Ses rappels encore a faire (« Confirmer
// la livraison planifiee ») passent « annule », avec le resultat dit ; avant,
// ils restaient a faire, remontaient dans les relances et le compteur du
// tableau de bord, et le client aurait ete appele pour une livraison annulee.
// Les autres rappels du client ne bougent pas ; son prochain rappel est
// recalcule. Rend le nombre de rappels annules.
function annulerRappelsDeLaCommande(db, order, resultat = "Commande annulée") {
  const maintenant = new Date().toISOString();
  const rappels = (db.relances || [])
    .filter(reminder => String(reminder.commandeId) === String(order.id) && reminder.status === "a_faire");
  rappels.forEach(reminder => {
    reminder.status = "annule";
    reminder.resultat = reminder.resultat || resultat;
    reminder.updatedAt = maintenant;
  });
  if (rappels.length) refreshClientReminderDate(db, order.clientId);
  return rappels.length;
}

// Decision 8 de Thomas (24/09) : arreter ou mettre en pause un abonnement
// ANNULE ses commandes deja generees et pas encore livrees, avec leurs
// rappels ; le stock qu'elles avaient reserve (planifiee confirmee) revient
// au rayon, et le journal des mouvements le dit. Avant, la commande de
// l'echeance restait « planifiee » avec son rappel « a faire », et quittait la
// page Abonnements : une livraison qu'on ne voyait plus. Une commande deja en
// preparation, prete ou en tournee suit son cours (la machine d'etat ne
// l'annule pas) : elle est rendue dans `gardees`, pour que l'ecran la nomme.
// Chaque commande annulee porte `annuleeAvecAbonnement` : l'abonnement repris,
// son echeance a venir se genere de nouveau (lib/subscriptions.js).
function suspendreCommandesDeLAbonnement(db, sub) {
  const statut = sub.status === "cancelled" ? "cancelled" : "paused";
  const raison = statut === "cancelled" ? "subscription_cancelled" : "subscription_paused";
  const resultat = statut === "cancelled" ? "Abonnement arrêté" : "Abonnement mis en pause";
  const annulees = [];
  const gardees = [];
  const resume = order => ({ id: order.id, numero: order.numero, date: order.deliveryDate || order.subscriptionDate, status: order.status });
  for (const order of db.commandes) {
    if (order.subscriptionId !== sub.id || STATUTS_SANS_RESERVATION.has(order.status)) continue;
    if (!isValidOrderStatusTransition(order.status, "annulee")) {
      gardees.push(resume(order));
      continue;
    }
    if (order.stockReservedAt) releaseOrderStockReservation(db, order, raison);
    setOrderStatus(order, "annulee");
    order.annuleeAvecAbonnement = statut;
    annulerRappelsDeLaCommande(db, order, `Commande annulée : ${resultat.toLowerCase()}`);
    annulees.push(resume(order));
  }
  if (annulees.length || gardees.length) {
    const numeros = liste => liste.map(o => o.numero || o.id).join(", ");
    addHistory(db, "Abonnement", [
      `${resultat} : ${annulees.length} commande(s) déjà créée(s) annulée(s)${annulees.length ? ` (${numeros(annulees)})` : ""}`,
      gardees.length ? `${gardees.length} déjà en préparation ou en livraison, gardée(s) (${numeros(gardees)})` : ""
    ].filter(Boolean).join(" ; "), {
      subscriptionId: sub.id,
      annulees: annulees.map(o => o.id),
      gardees: gardees.map(o => o.id)
    });
  }
  return { annulees, gardees };
}

function createAutomaticOrderReminder(db, order, options = {}) {
  if (!order?.clientId || !order.deliveryDate) return null;
  const type = clean(options.type || "confirmation_livraison");
  const leadDays = Math.max(0, Math.round(number(options.leadDays, order.reminderLeadDays ?? 7)));
  const deliveryDate = dateFromYmd(order.deliveryDate);
  if (!deliveryDate) return null;

  const datePrevue = toYmd(addDays(deliveryDate, -leadDays));
  const existing = db.relances.find(reminder =>
    String(reminder.commandeId) === String(order.id)
    && reminder.type === type
    && reminder.status === "a_faire"
  );
  if (existing) {
    existing.datePrevue = datePrevue;
    existing.updatedAt = new Date().toISOString();
    refreshClientReminderDate(db, order.clientId);
    return existing;
  }

  const reminder = normalizeCrmReminder({
    clientId: order.clientId,
    commandeId: order.id,
    type,
    motif: options.motif || "Confirmer la livraison planifiee",
    commentaire: options.commentaire || `Confirmer la commande ${order.numero || order.id} avant livraison du ${order.deliveryDate}.`,
    datePrevue,
    status: "a_faire"
  });
  db.relances.push(reminder);
  order.plannedReminderId = reminder.id;
  refreshClientReminderDate(db, order.clientId);
  return reminder;
}

// `rattacherSiDoublon` : option des appels du serveur (replanOrder), jamais lue
// dans le corps d'une requete.
function createPlannedOrder(db, payload = {}, { rattacherSiDoublon = false } = {}) {
  // L'identifiant choisi (« rattacher a cette fiche ») l'emporte sur celui,
  // vide, que le formulaire d'un nouveau client porte dans `client`.
  const client = findOrCreateCustomerClient(db, {
    ...(payload.client || {}),
    clientId: payload.clientId || payload.client?.clientId
  }, { nouvelleFiche: payload.nouvelleFiche === true, demander: payload.demanderSiDoublon === true, rattacher: rattacherSiDoublon });
  const dateCommande = normalizeDateInput(payload.dateCommande) || jourParis();
  const deliveryDate = resolvePlannedDeliveryDate(db, client, payload);
  if (!deliveryDate) throw badRequest("Date de livraison obligatoire pour une commande planifiee");

  const lines = buildCustomerOrderLines(db, payload.products || payload.produits, { checkStock: false });
  const total = Math.round(lines.reduce((sum, line) => sum + line.totalLigne, 0) * 100) / 100;
  const numero = generateOrderNumber(db, dateCommande);
  const order = normalizeOrder({
    id: `cmd-${numero.toLowerCase()}`,
    numero,
    clientId: client.id,
    clientName: [client.prenom, client.nom].filter(Boolean).join(" ") || client.nom,
    address: payload.deliveryAddress || client.rue,
    city: payload.city || client.ville,
    postalCode: payload.postalCode || client.codePostal,
    sector: payload.sector || client.secteur,
    phone: client.telephone,
    products: lines,
    status: "planifiee",
    source: "commande_planifiee",
    orderType: "planifiee",
    parentOrderId: clean(payload.parentOrderId || payload.sourceOrderId),
    total,
    notes: clean(payload.notes || payload.deliveryNotes),
    dateCommande,
    deliveryDate,
    createdAt: new Date().toISOString()
  });

  client.crmStatus = client.crmStatus === "client_actif" ? client.crmStatus : "client_a_relancer";
  client.nextDeliveryDate = deliveryDate;
  heriterPositionDuClient(order, client);
  db.commandes.push(order);
  const reminder = createAutomaticOrderReminder(db, order, {
    leadDays: payload.reminderLeadDays,
    motif: payload.reminderMotif
  });
  return { order, reminder };
}

function listPlannedOrders(db) {
  return db.commandes
    .filter(order => order.orderType === "planifiee" || order.source === "commande_planifiee" || ["planifiee", "a_confirmer"].includes(order.status))
    .sort((a, b) => {
      const dateCompare = String(a.deliveryDate || "").localeCompare(String(b.deliveryDate || ""));
      if (dateCompare) return dateCompare;
      return String(a.clientName || "").localeCompare(String(b.clientName || ""), "fr");
    });
}

function updatePlannedOrder(db, orderId, payload = {}) {
  const order = findOrder(db, orderId);
  const isPlanned = order.orderType === "planifiee" || order.source === "commande_planifiee" || ["planifiee", "a_confirmer"].includes(order.status);
  if (!isPlanned) throw badRequest("Commande planifiee introuvable");

  if (payload.status !== undefined) {
    const nextStatus = clean(payload.status);
    if (!["planifiee", "a_confirmer", "annulee"].includes(nextStatus)) {
      throw badRequest("Statut planifie invalide");
    }
    if (nextStatus === "annulee" && order.stockReservedAt) {
      releaseOrderStockReservation(db, order, "planned_order_cancelled");
    }
    setOrderStatus(order, nextStatus);
    if (nextStatus === "annulee") annulerRappelsDeLaCommande(db, order);
  }

  if (payload.deliveryDate !== undefined || payload.dateLivraison !== undefined) {
    const nextDeliveryDate = normalizeDateInput(payload.deliveryDate || payload.dateLivraison);
    if (!nextDeliveryDate) throw badRequest("Date de livraison invalide");
    order.deliveryDate = nextDeliveryDate;
  }
  if (payload.notes !== undefined || payload.deliveryNotes !== undefined) {
    order.notes = clean(payload.notes || payload.deliveryNotes);
  }
  if (payload.products !== undefined || payload.produits !== undefined) {
    if (order.stockReservedAt) throw badRequest("Impossible de modifier les produits apres reservation du stock");
    const lines = buildCustomerOrderLines(db, payload.products || payload.produits, { checkStock: false });
    order.products = lines;
    order.total = Math.round(lines.reduce((sum, line) => sum + line.totalLigne, 0) * 100) / 100;
  }

  order.updatedAt = new Date().toISOString();
  if (order.status !== "annulee") createAutomaticOrderReminder(db, order, { leadDays: payload.reminderLeadDays });
  const client = findClient(db, order.clientId);
  if (client) client.nextDeliveryDate = order.deliveryDate || client.nextDeliveryDate;
  return order;
}

function confirmPlannedOrder(db, orderId) {
  const order = findOrder(db, orderId);
  const isPlanned = order.orderType === "planifiee" || order.source === "commande_planifiee" || ["planifiee", "a_confirmer"].includes(order.status);
  if (!isPlanned) throw badRequest("Commande planifiee introuvable");
  if (order.status === "annulee") throw badRequest("Commande planifiee annulee");

  if (order.status === "planifiee") setOrderStatus(order, "a_confirmer");
  if (order.status === "a_confirmer") setOrderStatus(order, "commande_client_validee");
  reserveStockForOrder(db, order);
  setOrderStatus(order, "stock_a_verifier");
  order.confirmedAt = new Date().toISOString();
  order.sentToPreparationAt = order.sentToPreparationAt || order.confirmedAt;

  db.relances
    .filter(reminder => String(reminder.commandeId) === String(order.id) && reminder.status === "a_faire")
    .forEach(reminder => {
      reminder.status = "fait";
      reminder.dateRealisation = jourParis(order.confirmedAt);
      reminder.resultat = reminder.resultat || "Commande confirmee";
      reminder.updatedAt = order.confirmedAt;
    });
  refreshClientReminderDate(db, order.clientId);

  const client = findClient(db, order.clientId);
  if (client) {
    client.crmStatus = "client_actif";
    if (!client.crmConvertedAt && etaitProspect(db, client.id, order)) client.crmConvertedAt = order.confirmedAt;
    client.lastVisitDate = jourParis(order.confirmedAt);
  }

  return order;
}

function replanOrder(db, orderId, payload = {}) {
  const sourceOrder = findOrder(db, orderId);
  // M1 (lot 1 de l'audit geo). Replanifier une commande EN ECHEC la clonait :
  // l'originale restait livrable (double livraison), le clone perdait
  // consignes et coordonnees et reservait le stock une seconde fois. Depuis le
  // 23/09, une commande en echec revient d'elle-meme dans les commandes pretes
  // (updateRouteStop) : la relivrer, c'est la mettre dans une tournee, pas la
  // dupliquer. « Planifier la suite » reste reserve a une commande LIVREE.
  if (STATUTS_A_RELIVRER.includes(sourceOrder.status)) {
    throw badRequest("Cette commande revient dans « Commandes prêtes à livrer » : ajoute-la à une tournée plutôt que de la dupliquer.");
  }
  if (sourceOrder.status !== "livre") {
    throw badRequest("Seules les commandes livrees peuvent etre replanifiees");
  }

  const result = createPlannedOrder(db, {
    clientId: sourceOrder.clientId,
    client: {
      nom: sourceOrder.clientName,
      telephone: sourceOrder.phone,
      adresse: sourceOrder.address,
      codePostal: sourceOrder.postalCode,
      ville: sourceOrder.city
    },
    products: payload.products || sourceOrder.products,
    deliveryDate: payload.deliveryDate || payload.dateLivraison,
    notes: payload.notes || `Replanification depuis ${sourceOrder.numero || sourceOrder.id}`,
    parentOrderId: sourceOrder.id,
    reminderLeadDays: payload.reminderLeadDays
    // La fiche de la commande a pu disparaitre (commande orpheline) : la suite
    // part sur la fiche au meme telephone (ou nom + code postal), sans doublon.
  }, { rattacherSiDoublon: true });

  addHistory(db, "Replanification", `Commande ${sourceOrder.numero || sourceOrder.id} replanifiee vers ${result.order.deliveryDate}`, {
    sourceOrderId: sourceOrder.id,
    newOrderId: result.order.id,
    reminderId: result.reminder?.id
  });
  return result;
}

function getCustomerOrdersForDate(db, date = jourParis()) {
  const target = normalizeDateInput(date) || jourParis();
  return db.commandes
    .filter(order => String(order.dateCommande || "").slice(0, 10) === target)
    .filter(order => order.source === "commande_terrain" || order.status === "commande_client_validee")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function sendCustomerOrdersToPreparation(db, orderIds) {
  const ids = new Set(Array.isArray(orderIds) ? orderIds.map(String) : []);
  if (ids.size === 0) throw badRequest("Aucune commande selectionnee");

  const updated = [];
  db.commandes.forEach(order => {
    if (!ids.has(String(order.id))) return;
    if (order.status === "stock_a_verifier" || order.status === "en_preparation") {
      updated.push(order);
      return;
    }
    if (order.status !== "commande_client_validee") {
      throw badRequest(`Commande ${order.numero || order.id} deja envoyee ou non eligible`);
    }
    reserveStockForOrder(db, order);
    setOrderStatus(order, "stock_a_verifier");
    order.sentToPreparationAt = new Date().toISOString();
    updated.push(order);
  });

  if (!updated.length) throw notFound("Aucune commande trouvee");
  return updated;
}

// addDays et toYmd ne servent plus qu'a des DATES SANS HEURE construites en
// heure locale et relues en heure locale (feries, rappel avant livraison) : le
// fuseau n'y entre pas. Pour le jour d'un INSTANT (maintenant, deliveredAt...),
// c'est jourParis() de lib/jour-paris.js -- jamais toYmd(new Date()) (24/09 :
// startOfLocalDay et startOfWeekMonday, qui le faisaient, sont retirees).
function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Le jour calendaire d'une valeur : un INSTANT (ISO avec fuseau, Date) est lu
// a Paris ; une date sans heure passe par normalizeDateInput, sans decalage.
function jourCalendaire(value) {
  return jourDeLInstant(value) || normalizeDateInput(value);
}

function orderDate(order) {
  return (order.dateCommande ? normalizeDateInput(order.dateCommande) : jourCalendaire(order.createdAt)) || "";
}

function importedSaleDate(vente) {
  return normalizeDateInput(vente.dateCommandeIso || vente.dateCommande || vente.date) || "";
}

// Le montant TTC d'une ligne de vente, ou null si elle n'en a pas (decision 7
// de Thomas, 24/09 : CA en TTC, avoirs soustraits, HT et TTC plus jamais
// additionnes). Avant : le premier montant positif, TTC sinon HT -- deux ventes
// identiques comptaient 120 et 100, et un avoir (negatif) ne comptait pas.
//   - une vente importee depuis le 25/09 porte son montant (`montantTtc`) ;
//   - plus ancienne : son TTC, SIGNE (un avoir est negatif) ; un total sans
//     base declaree ; un HT seul ne vaut pas un TTC (null : « sans montant ») ;
//     sans aucun des deux, le prix unitaire par la quantite.
function montantTtcDeLaVente(vente) {
  if (Object.prototype.hasOwnProperty.call(vente, "montantTtc")) {
    if (vente.montantTtc === null || vente.montantTtc === "") return null;
    const montant = Number(vente.montantTtc);
    return Number.isFinite(montant) ? montant : null;
  }
  const ttc = number(vente.ttc ?? vente.TTC ?? vente.totalTtc, 0);
  if (ttc !== 0) return ttc;
  const total = firstPositiveNumber(vente.totalLigne, vente.total, vente.montant);
  if (total) return total;
  if (number(vente.ht ?? vente.HT, 0) !== 0) return null;
  const parPrix = number(vente.prixUnitaire, 0) * Math.max(0, number(vente.quantite ?? vente.quantity, 0));
  return parPrix > 0 ? parPrix : null;
}

function importedOrderKey(clientName, date) {
  return `${normalizeTextKey(clientName)}|${date || ""}`;
}

function buildImportedSalesIndex(ventes = []) {
  const byOrder = new Map();
  const byOrderProduct = new Map();

  (Array.isArray(ventes) ? ventes : []).forEach(vente => {
    const client = clean(vente.client || vente.clientName || vente.nomClient);
    if (!client) return;
    const date = importedSaleDate(vente);
    const total = montantTtcDeLaVente(vente);
    if (total === null) return;

    const orderKey = importedOrderKey(client, date);
    byOrder.set(orderKey, Math.round(((byOrder.get(orderKey) || 0) + total) * 100) / 100);

    const lineKey = productKey({
      code: vente.codeProduit || vente.code || vente.sku,
      nom: vente.produit || vente.produitComplet || vente.nom
    });
    if (lineKey) {
      const key = `${orderKey}|${lineKey}`;
      byOrderProduct.set(key, Math.round(((byOrderProduct.get(key) || 0) + total) * 100) / 100);
    }
  });

  return { byOrder, byOrderProduct };
}

// Le montant des ventes d'une commande, ou null si aucune vente (avec un
// montant TTC) ne la couvre -- la migration ne fige que ce qui existe.
function montantDesVentesDeLaCommande(importedIndex, order, date) {
  if (!importedIndex || !order) return null;
  const clientName = clean(order.clientName || order.nom || order.client);
  for (const cle of [importedOrderKey(clientName, date), importedOrderKey(clientName, "")]) {
    if (importedIndex.byOrder.has(cle)) return importedIndex.byOrder.get(cle);
  }
  return null;
}

function getImportedOrderTotal(importedIndex, order, date) {
  return montantDesVentesDeLaCommande(importedIndex, order, date) || 0;
}

/**
 * MIGRATION UNIQUE (25/09) : fige le montant TTC de chaque commande dont le
 * chiffre d'affaires venait des ventes -- aucun montant sur elle ni sur ses
 * lignes, et des ventes qui la couvrent (197 commandes sur 224 en
 * production). Le CA de chaque mois ne change pas ; il ne depend plus des
 * ventes. IDEMPOTENTE : une commande figee (ou qui porte son montant) n'est
 * plus visee, une commande sans vente reste sans montant. Rend le compte.
 */
function figerMontantsImportes(db, origine = "demarrage") {
  let index = null;
  let figees = 0;
  (db.commandes || []).forEach(order => {
    if (montantTtcFige(order) !== null || getOrderTotal(order) !== 0) return;
    index = index || buildImportedSalesIndex(db.ventes);
    const montant = montantDesVentesDeLaCommande(index, order, orderDate(order));
    if (montant === null) return;
    order.montantTtc = Math.round(montant * 100) / 100;
    figees += 1;
  });
  if (figees > 0) {
    addHistory(db, "Migration", `${figees} commande(s) : montant TTC fige depuis les ventes importees (${origine}) ; leur chiffre d'affaires ne depend plus du dernier fichier importe.`, { commandes: figees });
  }
  return figees;
}

function getImportedProductTotal(importedIndex, order, date, line) {
  if (!importedIndex || !order || !line) return 0;
  const clientName = clean(order.clientName || order.nom || order.client);
  const lineKey = productKey(line);
  if (!lineKey) return 0;
  const exact = importedIndex.byOrderProduct.get(`${importedOrderKey(clientName, date)}|${lineKey}`);
  if (exact) return exact;
  return importedIndex.byOrderProduct.get(`${importedOrderKey(clientName, "")}|${lineKey}`) || 0;
}

// Toutes les bornes sont des cles "YYYY-MM-DD" du jour a PARIS (24/09) : le
// processus tourne en UTC en production, et `now.getDate()` y rendait la veille
// entre minuit et 2 h. Le jour d'une vente est celui de l'INSTANT deliveredAt,
// lu a Paris ; deliveryDate et dateCommande sont des dates sans heure, prises
// telles quelles. Les cles se comparent en texte, s'additionnent en UTC pur.
function computeStatistics(db, now = new Date()) {
  const today = jourParis(now);
  const weekStart = debutSemaine(today);
  const monthStart = debutMois(today);
  const nextMonthStart = moisSuivant(today);
  const prevWeekStart = ajouterJours(weekStart, -7);
  const prevMonthStart = moisPrecedent(today);
  const prevMonthEnd = monthStart;

  const commercialStatuses = new Set(["livre"]);
  const importedSalesIndex = buildImportedSalesIndex(db.ventes);
  const salesOrders = db.commandes
    .filter(order => commercialStatuses.has(order.status))
    .map(order => {
      const _date = jourCalendaire(order.deliveredAt) || order.deliveryDate || orderDate(order);
      const explicitTotal = getOrderTotal(order);
      return {
        ...order,
        _date,
        _total: explicitTotal || getImportedOrderTotal(importedSalesIndex, order, orderDate(order))
      };
    })
    .filter(order => order._date);

  const inRange = (order, start, end) => order._date >= start && order._date < end;
  const sum = list => Math.round(list.reduce((total, order) => total + order._total, 0) * 100) / 100;
  const todayOrders = salesOrders.filter(order => inRange(order, today, ajouterJours(today, 1)));
  const weekOrders = salesOrders.filter(order => inRange(order, weekStart, ajouterJours(weekStart, 7)));
  const monthOrders = salesOrders.filter(order => inRange(order, monthStart, nextMonthStart));
  const prevWeekOrders = salesOrders.filter(order => inRange(order, prevWeekStart, weekStart));
  const prevMonthOrders = salesOrders.filter(order => inRange(order, prevMonthStart, prevMonthEnd));

  const productMap = new Map();
  const clientMap = new Map();
  monthOrders.forEach(order => {
    clientMap.set(order.clientId, {
      clientId: order.clientId,
      name: order.clientName,
      orders: (clientMap.get(order.clientId)?.orders || 0) + 1,
      total: (clientMap.get(order.clientId)?.total || 0) + order._total
    });
    normalizeProducts(order.products).forEach(line => {
      const key = productKey(line) || line.nom;
      const current = productMap.get(key) || { name: line.nom, quantity: 0, total: 0 };
      current.quantity += Math.max(0, number(line.quantite, 0));
      current.total += firstPositiveNumber(
        line.totalLigne,
        line.total,
        line.ttc,
        line.ht,
        getImportedProductTotal(importedSalesIndex, order, orderDate(order), line)
      )
        || Math.max(0, number(line.quantite, 0)) * Math.max(0, number(line.prixUnitaire, 0));
      productMap.set(key, current);
    });
  });

  const periodEvolution = (current, previous) => {
    if (previous === 0 && current === 0) return { label: "stable", percent: 0 };
    // Rien la periode d'avant : aucun pourcentage n'a de sens (c'etait « +100 % »,
    // une croissance qui n'existe pas). Parcours simplifies, 24/09.
    if (previous === 0) return { label: "nouveau", percent: null };
    const percent = Math.round(((current - previous) / previous) * 1000) / 10;
    return {
      label: Math.abs(percent) < 3 ? "stable" : (percent > 0 ? "progression" : "baisse"),
      percent
    };
  };

  const last14Days = Array.from({ length: 14 }, (_, index) => ajouterJours(today, index - 13))
    .map(day => {
      const list = salesOrders.filter(order => inRange(order, day, ajouterJours(day, 1)));
      return { date: day, total: sum(list), orders: list.length };
    });

  const newClientsMonth = db.clients.filter(client => {
    const created = client.firstContactDate ? normalizeDateInput(client.firstContactDate) : jourCalendaire(client.createdAt);
    return created && created >= monthStart;
  }).length;

  const convertedMonth = db.clients.filter(client => {
    const converted = jourCalendaire(client.crmConvertedAt);
    return converted && converted >= monthStart;
  }).length;

  return {
    today: { revenue: sum(todayOrders), orders: todayOrders.length },
    week: { revenue: sum(weekOrders), orders: weekOrders.length, evolution: periodEvolution(sum(weekOrders), sum(prevWeekOrders)) },
    month: { revenue: sum(monthOrders), orders: monthOrders.length, evolution: periodEvolution(sum(monthOrders), sum(prevMonthOrders)) },
    averageBasket: salesOrders.length ? Math.round((sum(salesOrders) / salesOrders.length) * 100) / 100 : 0,
    newClientsMonth,
    convertedProspectsMonth: convertedMonth,
    topProducts: Array.from(productMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 8),
    topClients: Array.from(clientMap.values()).sort((a, b) => b.total - a.total).slice(0, 8),
    salesByDay: last14Days
  };
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function excelColumnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function buildXlsx(rows) {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${excelColumnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Commandes" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`)
  };

  return Buffer.from(zipSync(files, { level: 6 }));
}

// Les mots des statuts dans l'export : ceux des badges de l'ecran Commandes
// (public/js/app.js STATUT_COMMANDE), pas les cles techniques.
const STATUTS_EXPORT = {
  brouillon: "Brouillon",
  commande_client_validee: "À envoyer",
  importe: "À préparer",
  stock_a_verifier: "À préparer",
  en_preparation: "En préparation",
  preparation_terminee: "Prête",
  pret_livraison: "Prête",
  en_livraison: "En livraison",
  livre: "Livrée",
  planifiee: "Planifiée",
  a_confirmer: "À confirmer",
  probleme_livraison: "Problème",
  a_reprogrammer: "À reprogrammer",
  annulee: "Annulée"
};

/** « 23/09/2026 » depuis une date ISO « 2026-09-23 » ; vide sinon. */
function dateExport(valeur) {
  const m = String(valeur || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** « 23/09/2026 00:30 » : un INSTANT, lu a l'heure de Paris (pas d'UTC). */
function instantExport(valeur) {
  const instant = Date.parse(valeur || "");
  if (!Number.isFinite(instant)) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

// L'export Excel de l'ecran Commandes (decision 9 de Thomas, 24/09 : un seul
// export). Il porte ce qu'il faut pour rapprocher livraisons et factures : le
// numero, la date REELLE de livraison et « remis a » -- aucun des deux anciens
// exports n'avait les trois.
function orderExportRows(orders) {
  const headers = ["Numéro", "Date de commande", "Livraison prévue", "Livrée le", "Remis à", "Client",
    "Adresse", "Code postal", "Ville", "Secteur", "Téléphone", "Produits", "Quantités", "Prix unitaires",
    "Total", "Statut", "Notes"];
  const rows = orders.map(order => {
    const lines = normalizeProducts(order.products);
    return [
      order.numero || "",
      dateExport(order.dateCommande),
      dateExport(order.deliveryDate),
      order.status === "livre" ? instantExport(order.deliveredAt) : "",
      order.remisA || "",
      order.clientName || "",
      order.address || "",
      order.postalCode || "",
      order.city || "",
      order.sector || "",
      order.phone || "",
      lines.map(line => line.nom).join(" | "),
      lines.map(line => line.quantite).join(" | "),
      lines.map(line => line.prixUnitaire || 0).join(" | "),
      getOrderTotal(order),
      STATUTS_EXPORT[order.status] || order.status || "",
      order.notes || ""
    ];
  });
  return [headers, ...rows];
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

// Lot 2 : un geste qui arrive sur un etat qui ne l'admet plus (arret deja
// traite, tournee finie). 409 : la demande est bien formee, c'est l'etat qui
// a change. La file hors ligne la traite comme tout refus 4xx (retiree, nommee).
function conflit(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function getSectors(db) {
  const map = new Map();

  CORE_SECTORS.forEach(sector => {
    map.set(sector, {
      name: sector,
      total: 0,
      ready: 0,
      inDelivery: 0,
      problems: 0
    });
  });

  (db.deliverySectors || []).forEach(sector => {
    const name = sector.secteur || sector.villePrincipale;
    if (!name || map.has(name)) return;
    map.set(name, {
      name,
      total: 0,
      ready: 0,
      inDelivery: 0,
      problems: 0
    });
  });

  db.commandes.forEach(order => {
    const sector = order.sector || deriveSector(order.city);
    if (!map.has(sector)) {
      map.set(sector, {
        name: sector,
        total: 0,
        ready: 0,
        inDelivery: 0,
        problems: 0
      });
    }

    const item = map.get(sector);
    item.total++;
    if (order.status === "pret_livraison") item.ready++;
    if (order.status === "en_livraison") item.inDelivery++;
    if (["probleme_livraison", "a_reprogrammer"].includes(order.status)) item.problems++;
  });

  return Array.from(map.values()).sort((a, b) => {
    const aCore = CORE_SECTORS.indexOf(a.name);
    const bCore = CORE_SECTORS.indexOf(b.name);
    if (aCore !== -1 || bCore !== -1) return (aCore === -1 ? 99 : aCore) - (bCore === -1 ? 99 : bCore);
    return a.name.localeCompare(b.name, "fr");
  });
}

// Ce qui peut entrer dans une tournee (C1, lot 1 de l'audit geo).
// `probleme_livraison` y entre aussi : c'est le statut que prenait un absent
// avant le 23/09. Les commandes deja bloquees ainsi en base reviennent donc
// d'elles-memes, sans migration ; la transition probleme_livraison ->
// en_livraison (depart de la tournee) existe deja.
const STATUTS_A_PLANIFIER = ["pret_livraison", "a_reprogrammer", "probleme_livraison"];
// Une commande A RELIVRER a deja manque son jour : le filtre de date ne la
// cache pas (sinon choisir « demain » la ferait disparaitre de la liste).
const STATUTS_A_RELIVRER = ["a_reprogrammer", "probleme_livraison"];

function getDeliverableOrders(db, filters = {}) {
  const sector = clean(filters.sector);
  const city = normalizeCity(filters.city);

  return db.commandes.filter(order => {
    if (![...STATUTS_A_PLANIFIER, "en_livraison"].includes(order.status)) return false;
    if (sector && sector !== "Tous" && normalizeTextKey(order.sector) !== normalizeTextKey(sector)) return false;
    if (city && normalizeTextKey(order.city) !== normalizeTextKey(city)) return false;
    return true;
  });
}

/**
 * Lot 3 : le resultat du calcul de tournee est MEMORISE. La commande garde le
 * point ; le client aussi, quand la commande se livre a son adresse et qu'il
 * n'avait aucune position (le cache geocodages l'a deja, via geocoderAdresse).
 * Avant, chaque calcul regeocodait chaque commande, et le client restait sans
 * position.
 */
function memoriserPositionDuCalcul(db, order, item) {
  const avait = Boolean(getCoordinates(order));
  order.lat = item.lat;
  order.lng = item.lng;
  order.geoPrecision = item.geoPrecision || order.geoPrecision || "";
  if (!avait) order.geoSource = item.geoTrouve ? "calcul" : "client";
  if (!item.geoTrouve) return;
  const client = findClient(db, order.clientId);
  if (client && !getCoordinates(client) && client.geoSource !== "manuel" && commandeSuitLeClient(order, client)) {
    appliquerPositionClient(db, client, {
      lat: item.lat,
      lng: item.lng,
      source: "ban",
      precision: item.geoPrecision,
      libelle: item.geoTrouve.libelle
    });
  }
}

// Le plafond du calcul routier (lib/routing.js, roadPlan), applique aussi au
// calcul « sans depart » (lot 5).
const MAX_COMMANDES_PAR_TOURNEE = 50;

// --- LOT 2 DE L'AUDIT GEO (23/09) : DEBLOQUER LES TOURNEES --------------------

/** « Tournée Dole du 23/09 » : le nom qu'un message montre. */
function nomDeTournee(route) {
  const secteur = route && route.sector && route.sector !== "Tous" ? ` ${route.sector}` : "";
  // Sans date de livraison (creee sans filtre de date) : le jour de sa
  // creation, a Paris -- celui que l'ecran lui donne aussi.
  const creee = route && Number.isFinite(Date.parse(route.createdAt || ""))
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(route.createdAt))
    : "";
  const jour = normalizeDateInput(route && route.deliveryDate) || creee;
  const date = jour ? ` du ${jour.slice(8, 10)}/${jour.slice(5, 7)}` : "";
  return `Tournée${secteur}${date}`;
}

/** « CMD-2026-012 (EHPAD Les Tilleuls) » : la commande qu'un message nomme. */
function nomDeCommande(order) {
  if (!order) return "inconnue";
  const client = clean(order.clientName);
  const numero = clean(order.numero);
  if (numero && client) return `${numero} (${client})`;
  return numero || client || String(order.id);
}

// Seul un arret ENCORE A FAIRE retient la commande (lot 1) : un absent de ce
// matin, revenu « A reprogrammer », se replanifie meme si sa tournee n'est pas
// finie.
function arretEncoreAFaire(stop) {
  return !STATUTS_ARRET_SOLDE.has(stop.status);
}

/**
 * La tournee ACTIVE (prete ou en cours) ou la commande attend encore son
 * arret, sinon null. `sauf` : l'id d'une tournee a ne pas compter.
 */
function tourneeActiveDeLaCommande(db, orderId, sauf = null) {
  return db.routes.find(route => STATUTS_TOURNEE_ACTIVE.has(route.status)
    && String(route.id) !== String(sauf)
    && (route.stops || []).some(stop => String(stop.orderId) === String(orderId) && arretEncoreAFaire(stop))) || null;
}

/**
 * Pourquoi une commande choisie ne peut pas entrer dans la tournee. Avant, le
 * message disait « Certaines commandes ne sont plus prêtes » ou « appartient
 * déjà à une tournée active » sans dire LAQUELLE : sur 30 commandes cochees,
 * il fallait deviner. Rend null si elle peut entrer.
 */
function raisonDeRefusEnTournee(db, orderId, filtres = {}) {
  const order = db.commandes.find(item => String(item.id) === String(orderId));
  if (!order) return `La commande ${orderId} est introuvable : recharge la liste.`;
  const nom = nomDeCommande(order);
  const occupee = tourneeActiveDeLaCommande(db, order.id);
  if (occupee) return `La commande ${nom} est déjà dans la tournée « ${nomDeTournee(occupee)} » : annule cette tournée ou choisis une autre commande.`;
  if (!STATUTS_A_PLANIFIER.includes(order.status)) return `La commande ${nom} n'est plus prête à livrer : recharge la liste.`;
  const sector = clean(filtres.sector);
  if (sector && sector !== "Tous" && normalizeTextKey(order.sector) !== normalizeTextKey(sector)) {
    return `La commande ${nom} n'est pas du secteur ${sector}.`;
  }
  const city = normalizeCity(filtres.city || "");
  if (city && normalizeTextKey(order.city) !== normalizeTextKey(city)) return `La commande ${nom} n'est pas à ${city}.`;
  const jour = normalizeDateInput(filtres.deliveryDate);
  if (jour && order.deliveryDate !== jour && !STATUTS_A_RELIVRER.includes(order.status)) {
    const prevue = order.deliveryDate ? `le ${order.deliveryDate.slice(8, 10)}/${order.deliveryDate.slice(5, 7)}` : "sans date";
    return `La commande ${nom} est prévue ${prevue}, pas le ${jour.slice(8, 10)}/${jour.slice(5, 7)}.`;
  }
  return null;
}

/** Leve un 400 qui nomme la premiere commande choisie qui ne peut pas entrer. */
function refuserCommandesHorsTournee(db, orderIds, filtres = {}) {
  for (const id of orderIds || []) {
    const raison = raisonDeRefusEnTournee(db, id, filtres);
    if (raison) throw badRequest(raison);
  }
}

function createRoute(db, options = {}) {
  const selectedOrderIds = Array.isArray(options.orderIds) ? options.orderIds.map(String) : [];
  const sector = clean(options.sector || "Tous");
  const city = normalizeCity(options.city || "");
  const deliveryDate = normalizeDateInput(options.deliveryDate);
  // Lot 7 : « a livrer en premier ». En mode routier, l'ordre du plan le
  // respecte deja (lib/routing.js) ; ici on le garde sur l'arret, pour qu'un
  // recalcul le respecte aussi.
  const premiers = new Set((Array.isArray(options.premiers) ? options.premiers : []).map(String));

  let orders = getDeliverableOrders(db, { sector, city }).filter(order => {
    if (!STATUTS_A_PLANIFIER.includes(order.status)) return false;
    if (deliveryDate && order.deliveryDate !== deliveryDate && !STATUTS_A_RELIVRER.includes(order.status)) return false;
    return true;
  });

  if (selectedOrderIds.length) {
    // Lot 2 : une commande choisie qui ne peut pas entrer est NOMMEE. Avant,
    // elle etait retiree en silence (5 cochees, 4 livrees), ou toute la
    // tournee etait refusee sans dire laquelle.
    refuserCommandesHorsTournee(db, selectedOrderIds, { sector, city, deliveryDate });
    const selected = new Set(selectedOrderIds);
    orders = orders.filter(order => selected.has(String(order.id)));
  }

  if (!orders.length) {
    throw badRequest("Aucune commande prete selectionnee pour la tournee");
  }
  // Revue du 23/09 (lot 7) et lot 5 : 50 commandes au plus, dans les deux
  // modes. Sans depart, rien ne bornait l'optimiseur, synchrone et sous le
  // verrou d'ecriture (2 s a 400 commandes, 18 s avec des epingles : le
  // serveur fige ; optimizeOrders est en n² log n).
  if (orders.length > MAX_COMMANDES_PAR_TOURNEE) {
    throw badRequest(`Sélectionne entre 1 et ${MAX_COMMANDES_PAR_TOURNEE} commandes par tournée.`);
  }

  // Lot 2 : une commande n'entre JAMAIS dans deux tournees actives. La garde ne
  // valait qu'en mode routier (`options.plan`) : sans depart, une commande
  // d'une tournee prete (toujours « pret_livraison ») entrait dans une seconde.
  // Seul un arret encore a faire la retient (lot 1).
  for (const order of orders) {
    const occupee = tourneeActiveDeLaCommande(db, order.id);
    if (occupee) {
      throw badRequest(`La commande ${nomDeCommande(order)} est déjà dans la tournée « ${nomDeTournee(occupee)} » : annule cette tournée ou choisis une autre commande.`);
    }
  }
  const optimizedOrders = options.plan ? options.plan.ordered.map(item => {
    const original = orders.find(order => String(order.id) === String(item.id));
    if (!original) throw badRequest("La sélection a changé. Recalcule la tournée.");
    if (["address", "city", "postalCode", "status", "clientId"].some(key => original[key] !== item[key])) throw badRequest("Une adresse ou une commande a changé pendant le calcul. Recommence.");
    const actuelle = getCoordinates(original);
    if (actuelle && (Number(actuelle.lat) !== Number(item.lat) || Number(actuelle.lng) !== Number(item.lng))) {
      throw badRequest("Une position a été corrigée pendant le calcul. Recommence.");
    }
    memoriserPositionDuCalcul(db, original, item);
    return original;
  }) : optimizeOrders(orders, premiers);
  if (optimizedOrders.length !== orders.length) throw badRequest("La sélection a changé. Recalcule la tournée.");
  const routeId = `route-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  // v1.17.1 : passer settings.tournee pour vitesse + duree d'arret calibrables.
  // Invariant : db issu de readDb -> normalizeDb -> normalizeSettings garantit
  // db.settings.tournee. estimateRouteMetrics retombe sur ses defauts si
  // tourneeSettings est undefined (defense en profondeur).
  const metrics = estimateRouteMetrics(optimizedOrders, db.settings && db.settings.tournee);

  const route = {
    id: routeId,
    sector: sector && sector !== "Tous" ? sector : (orders[0]?.sector || "Tous"),
    city,
    deliveryDate,
    selectedOrderIds: optimizedOrders.map(order => order.id),
    stops: optimizedOrders.map((order, index) => createStop(routeId, order, index, premiers.has(String(order.id)))),
    status: "prete",
    departure: options.plan?.departure || null,
    arrival: options.plan?.arrival || null,
    geometry: options.plan?.geometry || null,
    routingMode: options.plan?.routingMode || "estimate",
    calculatedAt: options.plan?.calculatedAt || null,
    totalDistance: options.plan?.totalDistance ?? metrics.totalDistance,
    estimatedDuration: options.plan?.estimatedDuration ?? metrics.estimatedDuration,
    // Lot 7 : une duree (s) et une distance (m) par trajet, depart -> 1er arret
    // -> ... -> arrivee, telles qu'OSRM les rend. Pour les heures d'arrivee.
    troncons: options.plan?.troncons || null,
    createdAt: now,
    startedAt: null,
    completedAt: null
  };

  db.routes.unshift(route);
  optimizedOrders.forEach(order => {
    order.routeId = routeId;
    order.updatedAt = now;
  });

  return route;
}

// Mode « sans depart » (tournee creee sans point de depart ni d'arrivee). Lot 7
// de l'audit geo (23/09) : il partait du premier client dans l'ordre ALPHABETIQUE
// et enchainait les plus proches voisins, sans rien ameliorer -- 16 % au-dessus
// de l'optimum en mediane. Sans depot connu, le meilleur trajet est le plus
// court CHEMIN OUVERT entre les arrets (c'est ce que mesure
// estimateRouteMetrics) : deux noeuds fictifs a cout nul servent de depart et
// d'arrivee libres, et l'optimiseur du mode routier fait le reste, a vol
// d'oiseau. `premiers` : ids des commandes a livrer en premier.
function optimizeOrders(orders, premiers = new Set()) {
  const withCoords = orders.filter(order => getCoordinates(order));
  const withoutCoords = orders.filter(order => !getCoordinates(order));
  const enPremier = order => premiers.has(String(order.id));

  if (withCoords.length <= 1) {
    return [...orders].sort((a, b) => enPremier(b) - enPremier(a) || fallbackOrderSort(a, b));
  }

  const sorted = [...withCoords].sort(fallbackOrderSort);
  const n = sorted.length;
  // Les arcs VERS le depart fictif et DEPUIS l'arrivee fictive ne sont jamais
  // parcourus : 0 aussi. Pas d'« infini » : une somme de tres grands nombres
  // perd sa precision, et l'optimiseur y voyait des gains qui n'existent pas.
  const matrix = Array.from({ length: n + 2 }, (_, i) => Array.from({ length: n + 2 }, (_, j) =>
    i === 0 || j === 0 || i === n + 1 || j === n + 1 || i === j ? 0 : distance(sorted[i - 1], sorted[j - 1])));
  const indices = sorted.map((order, i) => (enPremier(order) ? i : -1)).filter(i => i >= 0);
  const optimized = routing.optimizeMatrix(matrix, n, { premiers: indices }).map(i => sorted[i]);
  // Une commande « en premier » sans coordonnees passe quand meme devant.
  const sansCoords = [...withoutCoords].sort(fallbackOrderSort);
  return [...sansCoords.filter(enPremier), ...optimized, ...sansCoords.filter(order => !enPremier(order))];
}

function fallbackOrderSort(a, b) {
  return [
    String(a.sector || "").localeCompare(String(b.sector || ""), "fr"),
    String(a.city || "").localeCompare(String(b.city || ""), "fr"),
    String(a.postalCode || "").localeCompare(String(b.postalCode || ""), "fr"),
    String(a.address || "").localeCompare(String(b.address || ""), "fr"),
    String(a.clientName || "").localeCompare(String(b.clientName || ""), "fr")
  ].find(result => result !== 0) || 0;
}

function createStop(routeId, order, index, livrerEnPremier = false) {
  return {
    id: `stop-${routeId}-${index + 1}`,
    routeId,
    orderId: order.id,
    clientId: order.clientId,
    orderIndex: index + 1,
    clientName: order.clientName,
    phone: order.phone,
    address: order.address,
    city: order.city,
    postalCode: order.postalCode,
    sector: order.sector,
    deliveryDate: order.deliveryDate || "",
    products: order.products,
    status: "pret_livraison",
    livrerEnPremier: Boolean(livrerEnPremier),
    notes: order.notes || "",
    lat: order.lat,
    lng: order.lng,
    geoPrecision: order.geoPrecision || ""
  };
}

const STATUTS_ARRET_SOLDE = new Set(["livre", "absent", "probleme", "a_reprogrammer"]);

/**
 * M4 (audit geo) : un arret encore a faire LIT sa commande. Avant, l'arret
 * etait une copie figee a la creation : une consigne ajoutee, une adresse ou
 * une position corrigee n'atteignaient jamais le livreur. Un arret solde (ou
 * une tournee terminee) garde, lui, ce qui a ete livre : c'est l'historique.
 */
function arretVivant(route, stop, order) {
  if (!order) return stop;
  // Lot 2 : une tournee cloturee ou annulee est de l'historique, comme une terminee.
  if (STATUTS_TOURNEE_FINIE.has(route.status) || STATUTS_ARRET_SOLDE.has(stop.status)) return stop;
  return {
    ...stop,
    clientName: order.clientName || stop.clientName,
    phone: order.phone || "",
    address: order.address || "",
    city: order.city || "",
    postalCode: order.postalCode || "",
    sector: order.sector || stop.sector,
    deliveryDate: order.deliveryDate || stop.deliveryDate,
    products: order.products || stop.products,
    notes: order.notes || "",
    lat: order.lat,
    lng: order.lng,
    geoPrecision: order.geoPrecision || ""
  };
}

/**
 * M4 : une commande reportee ne se livre plus aujourd'hui. Si sa nouvelle date
 * n'est plus celle d'une tournee prete ou en cours ou elle attend encore, son
 * arret en est retire et elle redevient "prete a livrer" pour la bonne date.
 * Un arret deja solde n'est jamais retire (historique).
 */
function retirerDesTourneesSiReportee(db, order) {
  let retiree = false;
  for (const route of db.routes) {
    if (!["prete", "en_livraison"].includes(route.status)) continue;
    const dateTournee = normalizeDateInput(route.deliveryDate);
    if (!dateTournee || !order.deliveryDate || order.deliveryDate === dateTournee) continue;
    // L'arret ENCORE A FAIRE de la commande. Lot 6 (relecture adverse) : un
    // absent du matin, rajoute a sa propre tournee (« Ajouter a la tournee en
    // cours »), y a DEUX arrets -- le solde d'abord. Prendre le premier
    // laissait l'arret actif en place.
    const index = route.stops.findIndex(stop => String(stop.orderId) === String(order.id) && !STATUTS_ARRET_SOLDE.has(stop.status));
    if (index < 0) continue;
    route.stops.splice(index, 1);
    route.stops.forEach((stop, i) => { stop.orderIndex = i + 1; });
    route.selectedOrderIds = route.stops.map(stop => stop.orderId);
    // Le trace passait par cet arret : a refaire avant le depart. En route,
    // on garde l'ancien plutot que d'effacer la carte sous le livreur.
    if (route.status === "prete") route.geometry = null;
    retiree = true;
  }
  if (!retiree) return false;
  order.routeId = null;
  if (order.status === "en_livraison") setOrderStatus(order, "pret_livraison");
  addHistory(db, "Tournee", `${order.clientName} : commande reportee au ${order.deliveryDate}, retiree de la tournee`, {
    orderId: order.id
  });
  return true;
}

/** @param orders tableau des commandes, ou deja leur index (Map id -> commande). */
function normalizeRoute(route, orders) {
  const routeStatus = ROUTE_STATUSES.has(route.status) ? route.status : "prete";
  const stops = Array.isArray(route.stops) ? route.stops : [];
  const orderMap = orders instanceof Map ? orders : new Map(orders.map(order => [String(order.id), order]));

  const normalizedStops = stops.map((brut, index) => {
    const order = orderMap.get(String(brut.orderId));
    const stop = arretVivant({ ...route, status: routeStatus }, brut, order);
    return {
      ...stop,
      orderIndex: index + 1,
      clientName: stop.clientName || order?.clientName || "Client",
      phone: stop.phone || order?.phone || "",
      address: stop.address || order?.address || "",
      city: normalizeCity(stop.city || order?.city || ""),
      postalCode: stop.postalCode || order?.postalCode || "",
      sector: stop.sector || order?.sector || deriveSector(stop.city || order?.city),
      deliveryDate: normalizeDateInput(stop.deliveryDate || order?.deliveryDate || route.deliveryDate),
      products: normalizeProducts(stop.products || order?.products || []),
      status: STOP_STATUSES.has(stop.status) ? stop.status : "pret_livraison",
      notes: stop.notes || order?.notes || "",
      // `??` ne se declenche que sur null et undefined, PAS sur la chaine vide.
      // Or les coordonnees absentes valent "" dans tout le projet, jamais null
      // (cf. parseCoordinate, qui renvoie {ok:true, value:""}). Avec `??`, un
      // stop cree avant le geocodage gardait donc "" indefiniment : les clients
      // devenaient geolocalises, mais les tournees deja creees restaient sans
      // distance — une panne qu'on aurait mis longtemps a imputer a cette ligne.
      lat: premiereCoordonnee(stop.lat, order?.lat),
      lng: premiereCoordonnee(stop.lng, order?.lng)
    };
  });

  // Lot 5 (decision 5 de Thomas, 23/09) : la position « Me localiser » est
  // stockee arrondie a ~100 m. Ici, a chaque ecriture : les tournees deja
  // enregistrees au centimetre le sont aussi, a la premiere ecriture qui suit.
  const positions = {};
  for (const cle of ["departure", "arrival"]) {
    if (route[cle]) positions[cle] = arrondirPositionGps(route[cle]);
  }

  // Revue du 23/09 : le trace d'une tournee calculee AVANT le lot part de la
  // position exacte (recalee sur la route) ; on le rogne autour de la position
  // arrondie. Seulement s'il est charge : sans propriete `geometry` (tournee
  // terminee, stockage SQLite), le trace en base ne bouge pas ici -- voir
  // rognerTracesGpsTerminees, au demarrage.
  const trace = Object.prototype.hasOwnProperty.call(route, "geometry")
    ? { geometry: rognerTraceGps(route.geometry, { ...route, ...positions }) }
    : {};

  return {
    ...route,
    ...positions,
    ...trace,
    deliveryDate: normalizeDateInput(route.deliveryDate),
    status: routeStatus,
    stops: normalizedStops,
    selectedOrderIds: normalizedStops.map(stop => stop.orderId)
  };
}

// Le libelle que public/js/operations.js donne a la position du telephone.
// Une adresse choisie (un depot, une ville) n'est pas une position personnelle :
// elle n'est pas arrondie.
const LIBELLE_POSITION_GPS = "Ma position actuelle";

/** 3 decimales : ~110 m en latitude, ~75 m en longitude a 46-47° N. */
function arrondirPositionGps(point) {
  if (!point || typeof point !== "object" || point.label !== LIBELLE_POSITION_GPS) return point;
  const arrondi = valeur => {
    const n = Number(valeur);
    return valeur === "" || valeur === null || !Number.isFinite(n) ? valeur : Math.round(n * 1000) / 1000;
  };
  return { ...point, lat: arrondi(point.lat), lng: arrondi(point.lng) };
}

// Le rayon rogne autour de la position arrondie : l'arrondi a 3 decimales
// deplace le point d'au plus ~67 m, le recalage sur la route en ajoute un peu.
const RAYON_TRACE_GPS_M = 150;

/** La position « Me localiser » arrondie, en { lat, lng } ; null sinon. */
function positionGpsArrondie(point) {
  if (!point || typeof point !== "object" || point.label !== LIBELLE_POSITION_GPS) return null;
  const arrondie = arrondirPositionGps(point);
  const lat = Number(arrondie.lat), lng = Number(arrondie.lng);
  return arrondie.lat === "" || arrondie.lng === "" || !Number.isFinite(lat) || !Number.isFinite(lng) ? null : { lat, lng };
}

/**
 * Le trace sans ses sommets a moins de RAYON_TRACE_GPS_M de la position
 * « Me localiser » (depart et/ou arrivee) : ils sont remplaces par la position
 * arrondie. Un trace calcule avant le lot partait de la position exacte.
 * Idempotent (la position arrondie est fixe) : une deuxieme passe ne change
 * rien, donc rien n'est reecrit en base. Rend le meme objet quand rien ne change.
 */
function rognerTraceGps(geometry, route) {
  const coords = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  if (!coords || coords.length < 2) return geometry;
  const depart = positionGpsArrondie(route.departure);
  const arrivee = positionGpsArrondie(route.arrival);
  if (!depart && !arrivee) return geometry;
  const loin = (c, p) => !Array.isArray(c) || distance({ lat: c[1], lng: c[0] }, p) * 1000 > RAYON_TRACE_GPS_M;

  let debut = 0;
  let fin = coords.length;
  if (depart) while (debut < fin && !loin(coords[debut], depart)) debut++;
  if (arrivee) while (fin > debut && !loin(coords[fin - 1], arrivee)) fin--;
  if (debut === 0 && fin === coords.length) return geometry;

  const tete = depart ? [depart.lng, depart.lat] : coords[0];
  const queue = arrivee ? [arrivee.lng, arrivee.lat] : coords[coords.length - 1];
  // Tout le trace tient dans le rayon : il se reduit a ses deux extremites.
  const net = debut >= fin
    ? [tete, queue]
    : [...(debut > 0 ? [tete] : []), ...coords.slice(debut, fin), ...(fin < coords.length ? [queue] : [])];
  // Deja rogne (seules les extremites ont pu etre remplacees, par elles-memes) :
  // le meme objet, pour que rien ne change.
  const meme = (a, b) => Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
  if (net.length === coords.length && meme(net[0], coords[0]) && meme(net[net.length - 1], coords[coords.length - 1])) return geometry;
  return { ...geometry, coordinates: net };
}

/**
 * Au demarrage : les traces des tournees terminees ne sont pas charges par
 * readDb (stockage SQLite), normalizeRoute ne les voit donc jamais. On les lit
 * pour les tournees parties de « Me localiser », et on pose ceux a rogner sur
 * la tournee : l'ecriture qui suit les enregistre. Rend le nombre de traces rognes.
 */
function rognerTracesGpsTerminees(db) {
  if (!useSqliteStorage()) return 0;
  let rognes = 0;
  for (const route of db.routes) {
    if (Object.prototype.hasOwnProperty.call(route, "geometry")) continue;
    if (!positionGpsArrondie(route.departure) && !positionGpsArrondie(route.arrival)) continue;
    const stocke = getSqliteStore().getRouteTrace(route.id);
    const rogne = rognerTraceGps(stocke, route);
    if (rogne === stocke) continue;
    route.geometry = rogne;
    rognes += 1;
  }
  return rognes;
}

function startRoute(db, routeId) {
  const route = db.routes.find(item => String(item.id) === String(routeId));
  if (!route) throw notFound("Tournee introuvable");

  if (route.status === "terminee") throw badRequest("Cette tournée est terminée.");
  // Lot 2 : une tournee cloturee ou annulee ne repart pas (ses commandes sont
  // peut-etre deja dans une autre).
  if (route.status === "cloturee") throw badRequest("Cette tournée est clôturée.");
  if (route.status === "annulee") throw badRequest("Cette tournée est annulée.");
  if (route.status === "en_livraison") return route;
  const now = new Date().toISOString();
  route.status = "en_livraison";
  route.startedAt = route.startedAt || now;

  route.stops.forEach(stop => {
    if (["livre", "absent", "probleme", "a_reprogrammer"].includes(stop.status)) return;
    stop.status = "en_livraison";
    const order = findOrder(db, stop.orderId);
    setOrderStatus(order, "en_livraison");

    const client = findClient(db, order.clientId);
    if (client) client.statut = "en_cours";
  });

  return route;
}

// --- L'HEURE DU GESTE (lot 1 de l'audit geo, M6) ----------------------------
// Le telephone envoie `faitLe` : l'heure a laquelle le livreur a touche le
// bouton. Hors ligne, le geste peut arriver des heures plus tard ; le dater a
// l'arrivee ferait tomber le chiffre d'affaires dans le mauvais jour.
// Le jour de vente est celui de deliveredAt LU A PARIS (corrige le 24/09 : le
// defaut 7, mesure le 23/09 -- computeStatistics tronquait l'ISO en UTC, et
// une livraison entre minuit et 2 h, heure de Paris, comptait pour la veille).
// Toutes les bornes des statistiques sont desormais des jours de Paris
// (lib/jour-paris.js ; banc test/jour-paris.test.js, processus en UTC).
// L'horloge du telephone n'est pas une source de verite : elle est BORNEE.
//  - dans le futur au-dela d'une marge d'horloge : on garde l'heure du serveur ;
//  - plus vieille que GESTE_AGE_MAX_JOURS : on garde l'heure du serveur (un
//    telephone a l'heure fausse, pas une livraison d'il y a trois semaines) ;
//  - avant le depart de la tournee : ramenee au depart (horloge en retard).
// Defaut 7 jours (plage raisonnable : 3 a 14) : un vendredi hors ligne rejoue
// le lundi matin passe encore.
const GESTE_AGE_MAX_JOURS = 7;
const GESTE_AVANCE_HORLOGE_MS = 5 * 60 * 1000;

function horodatageDuGeste(brut, { maintenant = new Date(), plancher = null } = {}) {
  const serveur = maintenant.getTime();
  const t = typeof brut === "string" && brut ? Date.parse(brut) : NaN;
  if (!Number.isFinite(t)) return new Date(serveur).toISOString();
  if (t > serveur + GESTE_AVANCE_HORLOGE_MS) return new Date(serveur).toISOString();
  if (t < serveur - GESTE_AGE_MAX_JOURS * 24 * 3600 * 1000) return new Date(serveur).toISOString();
  let retenu = Math.min(t, serveur);
  const bas = plancher ? Date.parse(plancher) : NaN;
  if (Number.isFinite(bas) && retenu < bas && bas <= serveur) retenu = bas;
  return new Date(retenu).toISOString();
}

/**
 * @param {string} notes  instruction de livraison, telle qu'elle vient de la
 *                        commande. Elle ne dit RIEN de la cause d'un echec.
 * @param {object} motif  { cle, commentaire } -- ce que le LIVREUR a dit.
 *
 * Les deux restent separes pour de bon. Les confondre est precisement le defaut
 * qu'on corrige : passer le motif dans `notes` ecraserait l'instruction de
 * livraison de la commande, et la perdrait pour la prochaine tournee.
 */
function updateRouteStop(db, routeId, stopId, status, notes = "", motif = null, faitLe = null, remisA = "") {
  if (!STOP_STATUSES.has(status)) {
    throw badRequest("Statut arret invalide");
  }

  // Un motif inconnu est REFUSE, il n'est pas ignore en silence : une liste
  // qu'on declare sans la consulter ne sert a rien, et un client qui envoie
  // n'importe quoi doit l'apprendre tout de suite.
  const cleMotif = motif && typeof motif === "object" ? String(motif.cle || "") : "";
  if (cleMotif) {
    const connu = MOTIFS_PROBLEME.get(cleMotif);
    if (!connu) throw badRequest("Motif de probleme inconnu");
    if (!connu.statutsAdmis.includes(status)) {
      throw badRequest(`Le motif "${connu.libelle}" ne s'applique pas au statut "${status}"`);
    }
  }

  const route = db.routes.find(item => String(item.id) === String(routeId));
  if (!route) throw notFound("Tournee introuvable");

  const stop = route.stops.find(item => String(item.id) === String(stopId));
  if (!stop) throw notFound("Arret introuvable");

  // Lot 2 (M2 et gardes de l'API) : un geste ne rouvre plus ce qui est fini.
  // Avant, « Absent » tape sur un arret livre, ou sur une tournee terminee,
  // passait (ou echouait sur une transition de commande, sans rien dire
  // d'utile). La correction a desormais son chemin : « Corriger le statut »
  // (corrigerArret), journalise, qui garde les stocks justes.
  const retard = gesteArriveApresCloture(db, route, stop, status, faitLe);
  if (!retard) {
    if (STATUTS_TOURNEE_FINIE.has(route.status)) {
      const etat = { terminee: "terminée", cloturee: "clôturée", annulee: "annulée" }[route.status];
      throw conflit(`${nomDeTournee(route)} est ${etat} : ${stop.clientName || "cet arrêt"} ne se modifie plus que par « Corriger le statut ».`);
    }
    // Une tournee pas encore partie : ses arrets attendent le depart (qui les
    // met en livraison). Un « Absent » y passait sur une commande a
    // reprogrammer, et l'annulation de la tournee laissait cet arret solde.
    if (route.status !== "en_livraison") {
      throw conflit(`${nomDeTournee(route)} n'est pas partie : démarre-la avant de marquer un arrêt.`);
    }
    if (STATUTS_ARRET_SOLDE.has(stop.status)) {
      // Le meme geste deux fois (un renvoi sans cle d'idempotence) : rien a
      // faire, et ce n'est pas une erreur.
      if (stop.status === status) return { route, stop, order: findOrder(db, stop.orderId), inchange: true };
      throw conflit(`${stop.clientName || "Cet arrêt"} est déjà « ${libelleStatutArret(stop.status)} » : utilise « Corriger le statut ».`);
    }
  }

  // L'heure du GESTE, pas celle de l'arrivee ici (M6) : une livraison faite
  // hors ligne a 9 h 10 et envoyee a 11 h 30 est datee de 9 h 10.
  const now = horodatageDuGeste(faitLe, { plancher: route.startedAt });
  // Relecture adverse (23/09) : EN TEMPS REEL aussi. Une commande dont le
  // stock a ete libere (release-stock) reste « a reprogrammer », donc
  // livrable : elle repart dans une nouvelle tournee, qui ne reserve rien.
  // Son « Livre » la faisait sortir sans deduire le rayon, en silence.
  if (status === "livre") reprendreStockLibere(db, findOrder(db, stop.orderId), retard ? "geste arrivé après la clôture" : "livrée en tournée");
  if (retard) {
    // Le livreur l'a fait AVANT la cloture : c'est la verite du terrain, la
    // cloture avait devine « a reprogrammer ». L'arret n'est plus une
    // supposition de la cloture.
    delete stop.clotureAuto;
    stop.deliveredAt = null;
    stop.problemReason = "";
    stop.problemReasonKey = "";
  }
  stop.status = status;
  stop.notes = clean(notes || stop.notes);
  // La version de la tournee : la page ne remplace jamais sa tournee par une
  // copie plus ancienne (refreshActiveRoute, H4).
  route.updatedAt = new Date().toISOString();

  const order = findOrder(db, stop.orderId);
  const client = findClient(db, order.clientId);

  // C1 (lot 1 de l'audit geo) : un absent ou un probleme n'est plus une
  // impasse. La commande passait en `probleme_livraison`, qu'aucune liste ne
  // propose et qu'aucun bouton ne fait sortir ; son stock restait reserve pour
  // toujours. Elle passe desormais a `a_reprogrammer` : elle REVIENT d'elle-meme
  // dans « Commandes pretes a livrer », marquee « A reprogrammer ». La cause
  // reste lisible dans deliveryStatus (absent / probleme) et dans l'arret.
  // Le stock, lui, reste reserve pour la relivraison (stockReserveActif
  // compte a_reprogrammer) : ni libere, ni reserve une seconde fois -- la
  // tournee suivante ne reserve rien, et la livraison consomme la reservation.
  if (status === "livre") {
    // Un « Livre » arrive apres la cloture : la commande est « a reprogrammer »,
    // qui n'a pas de sortie directe vers « livre ».
    if (retard && STATUTS_A_RELIVRER.includes(order.status)) setOrderStatus(order, "en_livraison");
    setOrderStatus(order, "livre", now);
    if (client) client.statut = "livree";
    // Decision 10 de Thomas (23/09) : « remis a… », facultatif. Sur l'arret ET
    // la commande : le detail de la commande le montre, l'historique aussi.
    const remis = clean(remisA).slice(0, REMIS_A_MAX);
    stop.remisA = remis;
    order.remisA = remis;
  } else if (status === "absent") {
    setOrderStatus(order, "a_reprogrammer");
    order.deliveryStatus = "absent";
    if (client) client.statut = "absent";
  } else if (status === "probleme") {
    setOrderStatus(order, "a_reprogrammer");
    order.deliveryStatus = "probleme";
    if (client) client.statut = "probleme";
  } else if (status === "a_reprogrammer") {
    setOrderStatus(order, "a_reprogrammer");
    if (client) client.statut = "non_livre";
  } else if (status === "en_livraison") {
    setOrderStatus(order, "en_livraison");
    if (client) client.statut = "en_cours";
  }

  if (["livre", "absent", "probleme", "a_reprogrammer"].includes(status)) {
    stop.deliveredAt = stop.deliveredAt || now;
    if (STATUTS_EN_ECHEC.has(status)) {
      // NE JAMAIS retomber sur stop.notes : ce sont les instructions de
      // livraison de la commande, recopiees par createStop. C'etait le defaut.
      // Sans motif, on garde l'etiquette generique -- honnete, et reconnaissable
      // comme "personne n'a dit pourquoi".
      stop.problemReason = cleMotif
        ? composerMotif(cleMotif, motif.commentaire)
        : formatStopProblem(status);
      stop.problemReasonKey = cleMotif || "";
    }
  }

  const activeStatuses = new Set(["pret_livraison", "en_livraison"]);
  const isComplete = route.stops.every(item => !activeStatuses.has(item.status));

  // Une tournee cloturee le reste (un geste arrive en retard ne la « termine » pas).
  if (isComplete && route.status === "en_livraison") {
    route.status = "terminee";
    route.completedAt = route.completedAt || new Date().toISOString();
  }

  return { route, stop, order, retard };
}

// Decision 10 : la note « remis a… » tient en une ligne.
const REMIS_A_MAX = 80;

/**
 * H8 : « Annuler » une tournee PRETE (pas encore partie). Ses commandes
 * redeviennent pretes a livrer : elles n'avaient pas quitte ce statut (la
 * creation d'une tournee ne change ni le statut ni le stock d'une commande),
 * seul leur rattachement a la tournee les retenait. Le stock est donc a
 * l'etat d'avant la creation, sans rien rendre. La tournee reste, annulee,
 * pour l'historique ; elle ne retient plus rien.
 */
function annulerTournee(db, routeId) {
  const route = db.routes.find(item => String(item.id) === String(routeId));
  if (!route) throw notFound("Tournée introuvable");
  if (route.status === "annulee") return { route, commandes: [], deja: true };
  if (route.status === "en_livraison") {
    throw conflit(`${nomDeTournee(route)} est partie : clôture-la au lieu de l'annuler.`);
  }
  if (route.status === "terminee" || route.status === "cloturee") {
    throw conflit(`${nomDeTournee(route)} est déjà finie : il n'y a plus rien à annuler.`);
  }
  const now = new Date().toISOString();
  const commandes = [];
  for (const stop of route.stops || []) {
    const order = db.commandes.find(item => String(item.id) === String(stop.orderId));
    if (!order) continue;
    if (String(order.routeId || "") === String(route.id)) order.routeId = null;
    order.updatedAt = now;
    commandes.push(order);
  }
  route.status = "annulee";
  route.annuleeLe = now;
  // La date de fin : celle que la purge des 12 mois lit (dateDeFinTournee).
  route.completedAt = now;
  route.updatedAt = now;
  return { route, commandes };
}

/**
 * H8 : « Cloturer » une tournee EN COURS. Les arrets restants passent « A
 * reprogrammer », comme un absent (lot 1) : leur commande revient d'elle-meme
 * dans les commandes pretes, stock toujours reserve pour la relivraison. Les
 * arrets deja traites ne bougent pas : un livre reste livre. Irreversible : la
 * tournee ne repart plus, et un arret ne s'y rouvre plus (seulement « Corriger
 * le statut » vers livre, absent ou probleme).
 */
function cloturerTournee(db, routeId) {
  const route = db.routes.find(item => String(item.id) === String(routeId));
  if (!route) throw notFound("Tournée introuvable");
  if (route.status === "cloturee") return { route, commandes: [], deja: true };
  if (route.status === "terminee") throw conflit(`${nomDeTournee(route)} est déjà terminée : tous ses arrêts sont traités.`);
  if (route.status === "annulee") throw conflit(`${nomDeTournee(route)} est annulée.`);
  if (route.status !== "en_livraison") {
    throw conflit(`${nomDeTournee(route)} n'est pas partie : annule-la au lieu de la clôturer.`);
  }
  const now = new Date().toISOString();
  const commandes = [];
  for (const stop of route.stops || []) {
    if (STATUTS_ARRET_SOLDE.has(stop.status)) continue;
    stop.status = "a_reprogrammer";
    // Soldé PAR la cloture, pas par le livreur : un geste fait avant elle et
    // arrive apres (file hors ligne) peut encore dire la verite
    // (gesteArriveApresCloture).
    stop.clotureAuto = true;
    stop.problemReason = "Tournée clôturée avant cet arrêt";
    stop.problemReasonKey = "";
    const order = db.commandes.find(item => String(item.id) === String(stop.orderId));
    if (!order) continue;
    if (order.status === "en_livraison") setOrderStatus(order, "a_reprogrammer");
    const client = findClient(db, order.clientId);
    if (client) client.statut = "non_livre";
    commandes.push(order);
  }
  route.status = "cloturee";
  route.clotureeLe = now;
  route.completedAt = now;
  route.updatedAt = now;
  return { route, commandes };
}

// M2 : ce qu'une correction peut dire. « en_livraison » est « a faire » : le
// livreur y repassera.
const CORRECTIONS_ADMISES = new Set(["livre", "absent", "probleme", "en_livraison"]);
const CAUSE_CORRECTION_MAX = 160;

/**
 * M2 : « Corriger le statut » d'un arret deja traite (livre <-> absent <->
 * probleme <-> a faire). Avant, un « Absent » saisi par erreur ne se
 * corrigeait ni a l'ecran ni au serveur : `a_reprogrammer -> livre` n'existe
 * pas dans la machine d'etat des commandes, et `livre` n'a aucune sortie.
 *
 * La correction est un geste A PART, jamais un geste ordinaire rejoue :
 *  - elle exige sa cause, gardee sur l'arret (`corrections`) et dans
 *    l'historique (type « Correction »), avec qui l'a faite ;
 *  - elle garde les STOCKS justes. Le stock en rayon a ete deduit a la
 *    preparation, pas a la livraison : il ne bouge pas ici. Seule la
 *    reservation suit : « Livre » la consomme, defaire une livraison la
 *    redonne (la marchandise n'est pas chez le client : elle attend sa
 *    relivraison, comme apres un absent). Une exception : vers « Livre »,
 *    une reservation liberee a la main est d'abord reprise sur le rayon,
 *    meme insuffisant (reprendreStockLibere, decision du 23/09) ;
 *  - elle refuse une commande repartie ailleurs (dans une autre tournee, ou
 *    passee par un autre ecran) : ce qu'elle corrigerait n'est plus la.
 * Vers « a faire » : la tournee terminee se rouvre (le livreur y repassera) ;
 * une tournee cloturee, jamais (la cloture est irreversible).
 */
function corrigerArret(db, routeId, stopId, { status, cause } = {}, par = "") {
  if (!CORRECTIONS_ADMISES.has(status)) {
    throw badRequest("Correction possible vers : livré, absent, problème ou à faire.");
  }
  const pourquoi = clean(cause).slice(0, CAUSE_CORRECTION_MAX);
  if (!pourquoi) throw badRequest("Dis pourquoi tu corriges ce statut : la raison est gardée dans l'historique.");

  const route = db.routes.find(item => String(item.id) === String(routeId));
  if (!route) throw notFound("Tournee introuvable");
  const stop = (route.stops || []).find(item => String(item.id) === String(stopId));
  if (!stop) throw notFound("Arret introuvable");

  if (route.status === "annulee") throw conflit(`${nomDeTournee(route)} est annulée : aucun arrêt n'y a été traité.`);
  if (!STATUTS_ARRET_SOLDE.has(stop.status)) {
    throw conflit(`${stop.clientName || "Cet arrêt"} n'est pas encore traité : utilise les gestes de la tournée.`);
  }
  if (stop.status === status) throw badRequest(`${stop.clientName || "Cet arrêt"} est déjà « ${libelleStatutArret(status)} ».`);
  if (status === "en_livraison" && route.status === "cloturee") {
    throw conflit(`${nomDeTournee(route)} est clôturée : un arrêt n'y redevient pas « à faire ». La commande est dans les commandes prêtes.`);
  }

  const order = findOrder(db, stop.orderId);
  const nom = nomDeCommande(order);
  // Sans `routeId` (donnee d'avant createRoute, ou semee a la main), seule la
  // presence dans une autre tournee active compte.
  if ((order.routeId && String(order.routeId) !== String(route.id)) || tourneeActiveDeLaCommande(db, order.id, route.id)) {
    throw conflit(`La commande ${nom} est repartie dans une autre tournée : corrige-la là-bas.`);
  }
  // Un arret en echec dont la commande est restee « en livraison » (donnee
  // d'avant le lot 1, ou semee ainsi) se corrige aussi : rien n'est reparti.
  const attendus = stop.status === "livre" ? ["livre"] : [...STATUTS_A_RELIVRER, "en_livraison"];
  if (!attendus.includes(order.status)) {
    throw conflit(`La commande ${nom} a changé depuis ce geste : corrige-la depuis l'écran Commandes.`);
  }
  // Une reservation liberee a la main (release-stock) a rendu le stock au
  // rayon : dire la commande livree la ferait sortir du stock sans la deduire.
  // Avant, la correction etait refusee ; depuis la decision de Thomas (23/09),
  // la reservation est reprise, meme sur un rayon insuffisant, comme pour le
  // geste arrive apres la cloture (reprendreStockLibere, qui le journalise).
  if (status === "livre") reprendreStockLibere(db, order, "correction du statut");

  const avant = stop.status;
  const now = new Date().toISOString();
  const client = findClient(db, order.clientId);

  // 1. La commande quitte son etat, vers « en livraison ».
  if (order.status === "livre") {
    // Hors de la machine d'etat, deliberement : `livre` n'a aucune sortie pour
    // les gestes ordinaires (ni le livreur ni un import ne defont une
    // livraison). Seule cette correction, journalisee, le fait.
    order.status = "en_livraison";
    order.preparationStatus = inferPreparationStatus("en_livraison");
    order.deliveryStatus = inferDeliveryStatus("en_livraison");
    order.deliveredAt = "";
    order.remisA = "";
    if (order.stockReleaseReason === "consumed_by_delivery") {
      order.stockReservedAt = order.stockReleasedAt || now;
      order.stockReleasedAt = null;
      order.stockReleaseReason = null;
    }
    order.updatedAt = now;
  } else {
    setOrderStatus(order, "en_livraison");
  }

  // 2. Vers le statut corrige.
  if (status === "livre") {
    // L'heure du geste d'origine : c'est la que le livreur etait sur place.
    const quand = Number.isFinite(Date.parse(stop.deliveredAt || "")) ? stop.deliveredAt : now;
    setOrderStatus(order, "livre", quand);
    stop.deliveredAt = quand;
    stop.problemReason = "";
    stop.problemReasonKey = "";
    if (client) client.statut = "livree";
  } else if (status === "absent" || status === "probleme") {
    setOrderStatus(order, "a_reprogrammer");
    order.deliveryStatus = status;
    stop.deliveredAt = stop.deliveredAt || now;
    stop.problemReason = `${libelleStatutArret(status)} (correction : ${pourquoi})`;
    stop.problemReasonKey = "";
    if (client) client.statut = status;
  } else {
    stop.deliveredAt = null;
    stop.problemReason = "";
    stop.problemReasonKey = "";
    if (client) client.statut = "en_cours";
    // Le livreur y repasse : la tournee terminee se rouvre.
    if (route.status === "terminee") {
      route.status = "en_livraison";
      route.completedAt = null;
    }
  }
  if (status !== "livre") stop.remisA = "";
  stop.status = status;
  delete stop.clotureAuto;
  stop.corrections = [
    ...(Array.isArray(stop.corrections) ? stop.corrections : []),
    { de: avant, vers: status, cause: pourquoi, le: now, par: clean(par) }
  ];
  route.updatedAt = now;
  return { route, stop, order, avant, cause: pourquoi };
}

/**
 * Lot 2 : une commande d'une tournee active ne change pas d'etat par un autre
 * ecran (repasser en preparation, par exemple) sans quitter la tournee : la
 * tournee ne demarrait plus (« Transition non autorisee »), et le livreur
 * aurait eu un arret dont la commande est au depot.
 */
function refuserSiDansUneTournee(db, order, geste) {
  const route = tourneeActiveDeLaCommande(db, order.id);
  if (route) {
    throw conflit(`La commande ${nomDeCommande(order)} est dans la tournée « ${nomDeTournee(route)} » : annule ou clôture cette tournée avant de ${geste}.`);
  }
}

/** Le mot de la charte pour un statut d'arret (les memes que l'ecran). */
function libelleStatutArret(status) {
  return {
    pret_livraison: "Prêt",
    en_livraison: "En livraison",
    livre: "Livré",
    absent: "Absent",
    probleme: "Problème",
    a_reprogrammer: "À reprogrammer"
  }[status] || String(status || "");
}

/**
 * Un geste fait AVANT la cloture de sa tournee, et qui n'arrive qu'apres (file
 * hors ligne : le livreur sans reseau, le bureau qui cloture). La cloture a mis
 * l'arret « A reprogrammer » par supposition ; le geste dit ce qui s'est
 * vraiment passe. Il est applique si, et seulement si :
 *  - la tournee est cloturee et l'arret a ete solde PAR la cloture ;
 *  - le geste est un geste du livreur (livre, absent, probleme) date d'avant
 *    la cloture (faitLe, l'heure de l'appui) ;
 *  - la commande n'est pas repartie : toujours rattachee a cette tournee,
 *    toujours a reprogrammer, dans aucune autre tournee active.
 * Sinon, refuse comme tout geste sur une tournee finie. Sans cette exception,
 * cloturer pendant qu'un « Livre » attend dans la file le jetterait : la
 * livraison, faite, serait perdue (lot 1 : « le livreur ne perd plus rien »).
 */
function gesteArriveApresCloture(db, route, stop, status, faitLe) {
  if (route.status !== "cloturee" || !stop.clotureAuto) return false;
  if (!["livre", "absent", "probleme"].includes(status)) return false;
  const fait = typeof faitLe === "string" ? Date.parse(faitLe) : NaN;
  const cloture = Date.parse(route.clotureeLe || route.completedAt || "");
  if (!Number.isFinite(fait) || !Number.isFinite(cloture) || fait > cloture) return false;
  const order = db.commandes.find(item => String(item.id) === String(stop.orderId));
  if (!order || (order.routeId && String(order.routeId) !== String(route.id))) return false;
  if (!STATUTS_A_RELIVRER.includes(order.status)) return false;
  return !tourneeActiveDeLaCommande(db, order.id, route.id);
}

/**
 * Relecture adverse du lot 2 : un « Livre » arrive EN RETARD (apres la
 * cloture, par la file ; ou par « Corriger le statut ») alors que le bureau a
 * libere entre-temps la reservation de la commande (release-stock, admis sur
 * « a reprogrammer ») -- le rayon recompte une marchandise qui est chez le
 * client. La livraison reste la verite du terrain : la reservation est reprise
 * (le rayon est deduit de nouveau), puis consommee par la livraison
 * (setOrderStatus).
 *
 * Decision de Thomas (23/09, « Livre en retard sur un stock a zero ») : si le
 * rayon n'en a plus assez, la livraison est QUAND MEME acceptee -- elle a eu
 * lieu. Avant, elle etait refusee (409), et rien ne permettait de
 * l'enregistrer. Le rayon passe alors en negatif, et c'est DIT : une entree
 * « Livraison acceptée sur stock insuffisant » dans l'historique, le produit
 * en rupture (quantite negative) au Stock et dans « A regler ». Jamais ramene
 * a zero en silence : setStockQuantity le ferait, d'ou l'ecriture directe.
 * Un produit absent du stock, ou sans quantite, n'est pas deduit : il est
 * nomme dans une entree « Livraison acceptée sur un stock non suivi » (si
 * rien ne passe en negatif), et garde sur la commande (stockNonDeduit) pour
 * que la liberation ne le rende jamais.
 *
 * Tous les chemins vers « Livre » l'appellent (relecture adverse du 23/09) :
 * l'arret, en temps reel comme en retard, « Corriger le statut », l'ecran
 * Commandes et POST /api/livraison.
 *
 * `origine` : d'ou vient la livraison, pour l'historique.
 * A appeler APRES les refus du geste et AVANT l'ecriture de l'arret.
 */
function reprendreStockLibere(db, order, origine) {
  if (order.stockReservedAt || !order.stockReleaseReason || order.stockReleaseReason === "consumed_by_delivery") return;
  const verification = analyzeOrderStock(order, db.stock);
  if (verification.canPrepare) {
    reserveStockForOrder(db, order, `Sortie pour la commande ${nomDeCommande(order)}, livrée après la libération de son stock (${origine})`);
    addHistory(db, "Stock deduit", `Commande ${order.numero || order.id} : livree apres la liberation de son stock (${origine})`, {
      orderId: order.id,
      numero: order.numero
    });
    return;
  }

  const manques = [];
  // Relecture adverse (23/09) : les lignes NON deduites sont gardees sur la
  // commande. Sans elles, defaire la livraison puis liberer le stock rendait
  // au rayon une quantite qu'il n'avait jamais perdue (« a renseigner » + 3).
  const nonDeduites = [];
  let negatif = false;
  // Lot « stock » (24/09) : chaque deduction est ecrite au journal des
  // mouvements, negatif compris (« Livree sur stock insuffisant »).
  const motif = `Livrée sur stock insuffisant : commande ${nomDeCommande(order)} (${origine})`;
  verification.lines.forEach(line => {
    if (!line.required || line.required <= 0) return;
    const nom = clean(line.nom || line.code) || "Produit";
    const product = line.stockId === null ? null : db.stock.find(item => String(item.id) === String(line.stockId));
    if (!product) {
      manques.push(`${nom} : absent du stock, rien déduit`);
      nonDeduites.push(productKeyFromLine(line));
      return;
    }
    const avant = getStockQuantity(product);
    if (avant === null) {
      manques.push(`${getProductName(product)} : stock non renseigné, rien déduit`);
      nonDeduites.push(productKeyFromLine(line));
      return;
    }
    const apres = Math.round((avant - line.required) * 100) / 100;
    product.quantite = apres;
    recordStockMovement(db, product, avant, apres, motif, { commande: order });
    if (apres < 0) {
      negatif = true;
      manques.push(`${getProductName(product)} : ${avant} en rayon pour ${line.required} livrés, stock à ${apres}`);
    }
  });
  order.stockReservedAt = new Date().toISOString();
  if (nonDeduites.length) order.stockNonDeduit = nonDeduites;
  else delete order.stockNonDeduit;
  if (!manques.length) return;
  // « Insuffisant » seulement si un rayon passe en negatif : une ligne non
  // suivie (absente du stock, ou « a renseigner ») ne manque pas, elle n'est
  // pas comptee.
  const titre = negatif ? "Livraison acceptée sur stock insuffisant" : "Livraison acceptée sur un stock non suivi";
  addHistory(db, "Stock", `${titre} : commande ${nomDeCommande(order)} (${origine}) — ${manques.join(" ; ")}`, {
    orderId: order.id,
    numero: order.numero,
    manques
  });
}

/**
 * Lot 5 (audit geo, 23/09) : la reponse d'un geste d'arret porte TOUT ce que le
 * geste a change -- la tournee, l'arret, la commande, le client -- tels que
 * les listes (GET /api/routes, /api/orders, /api/clients) les rendraient
 * apres l'ecriture. Le telephone met son ecran a jour avec, au lieu de relancer
 * les 17 requetes du chargement complet (5,5 a 8,8 s apres un an).
 * A appeler APRES writeDb : syncWorkflow a remplace les objets par leur forme
 * normalisee.
 */
function etatApresGesteArret(db, geste) {
  const route = routeAvecTrace(db, geste.route.id) || geste.route;
  const stop = route.stops.find(item => String(item.id) === String(geste.stop.id)) || geste.stop;
  const order = db.commandes.find(item => String(item.id) === String(geste.order.id)) || geste.order;
  const trouve = db.clients.find(item => String(item.id) === String(order.clientId));
  // Le client tel que /api/clients le rend (sans releve d'import, 24/09).
  const client = trouve ? sansReleveDImport(trouve) : null;
  return { route, stop, order, client };
}

function formatStopProblem(status) {
  if (status === "absent") return "Client absent";
  if (status === "a_reprogrammer") return "A reprogrammer";
  return "Probleme livraison";
}

function reorderRouteStops(db, routeId, stopIds) {
  const route = db.routes.find(item => String(item.id) === String(routeId));
  if (!route) throw notFound("Tournee introuvable");

  if (!Array.isArray(stopIds) || stopIds.length !== route.stops.length) {
    throw badRequest("Ordre de tournee invalide");
  }

  // Lot 6 (audit 2026-07-08) : refuser les stopIds DUPLIQUES. Sans ce controle,
  // [s1, s1] passait (longueur ok) : stopMap.get resolvait s1 deux fois, la
  // verification !stop ne detectait rien, et un arret disparaissait
  // silencieusement de la tournee (sa commande gardait routeId mais n'etait
  // plus livrable). On exige une vraie permutation : autant d'ids DISTINCTS
  // que de stops.
  const uniqueIds = new Set(stopIds.map(id => String(id)));
  if (uniqueIds.size !== route.stops.length) {
    throw badRequest("Ordre de tournee invalide (arrets dupliques ou manquants)");
  }

  const stopMap = new Map(route.stops.map(stop => [String(stop.id), stop]));
  const reordered = stopIds.map(id => stopMap.get(String(id)));

  if (reordered.some(stop => !stop)) {
    throw badRequest("Ordre de tournee invalide");
  }

  if (route.status !== "prete") throw badRequest("Le réordonnancement est possible avant le départ uniquement.");
  route.geometry = null;
  route.totalDistance = null;
  route.estimatedDuration = null;
  route.troncons = null;
  route.routingMode = "manual";
  route.stops = reordered.map((stop, index) => ({
    ...stop,
    orderIndex: index + 1
  }));
  // Revue #90 : garder selectedOrderIds coherent avec le nouvel ordre des stops
  // (meme derivation que normalizeRoute), sinon la reponse PATCH immediate est
  // desynchronisee (stops reordonnes vs selectedOrderIds ancien ordre) jusqu'au
  // prochain GET.
  route.selectedOrderIds = route.stops.map(stop => stop.orderId);

  return route;
}

function estimateRouteMetrics(orders, tourneeSettings) {
  // v1.17.1 : vitesse et duree d'arret calibrables via Parametres (defaut
  // 28 km/h, 6 min/arret). L'utilisateur ajuste apres quelques tournees
  // reelles pour coller a son terrain (urbain Besancon vs rural Champagnole).
  //
  // Pieges evites (revue adverse R1) :
  // 1. NE JAMAIS utiliser `|| 28` car stopDurationMin=0 est valide et serait
  //    rebascule a 6 (0 est falsy). Test V1171.f le verifie.
  // 2. averageSpeedKmh DOIT etre > 0 (division par zero produirait Infinity).
  //    Asymetrie volontaire avec stopDurationMin qui accepte >= 0.
  const rawSpeed = tourneeSettings && Number(tourneeSettings.averageSpeedKmh);
  const speed = Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 28;
  const rawStop = tourneeSettings && Number(tourneeSettings.stopDurationMin);
  const stop = Number.isFinite(rawStop) && rawStop >= 0 ? rawStop : 6;

  let totalDistance = null;
  for (let i = 1; i < orders.length; i++) {
    const previous = orders[i - 1];
    const current = orders[i];
    if (!getCoordinates(previous) || !getCoordinates(current)) {
      totalDistance = null;
      break;
    }
    // M6 (v1.16.1) : distance() retourne deja des km (Haversine), plus de * 111
    totalDistance = (totalDistance || 0) + distance(previous, current);
  }

  // Revue R1 MINOR-4 : le temps d'arret existe meme sans distance calculable
  // (1 stop, coords manquantes). Auparavant on retournait null pour
  // estimatedDuration, perdant le signal. Maintenant : stopTime toujours
  // remonte ; driveTime ajoute si distance disponible.
  const stopTime = orders.length * stop;
  const driveTime = totalDistance === null ? null : (totalDistance / speed) * 60;
  const estimatedDuration = driveTime === null
    ? (orders.length > 0 ? Math.round(stopTime) : null)
    : Math.round(driveTime + stopTime);

  return {
    totalDistance: totalDistance === null ? null : Math.round(totalDistance * 10) / 10,
    estimatedDuration
  };
}

// M6 (v1.16.1) : formule HAVERSINE - distance grand-cercle en km. Remplace le
// Pythagore sur (lat,lng) * 111 qui surevalue de ~30% les distances courtes
// Est-Ouest a 45N (un degre de longitude vaut 111*cos(lat) km, pas 111).
// Verification : Besancon-Dole = 45 km (avant: ~61 km).
function distance(a, b) {
  const coordsA = getCoordinates(a);
  const coordsB = getCoordinates(b);

  if (!coordsA || !coordsB) return Number.POSITIVE_INFINITY;

  const R = 6371; // Rayon Terre en km
  const toRad = deg => (deg * Math.PI) / 180;
  const lat1 = toRad(coordsA.lat);
  const lat2 = toRad(coordsB.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(coordsB.lng - coordsA.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// La base entiere (clients, adresses, telephones, comptes) : un telechargement
// de sauvegarde sous un autre nom. Reservee a l'administration (decision 6 du
// 24/09, garde-fous du 25/09) : SEREO_ENABLE_DB_EXPORT=1 l'ouvrait a TOUT
// compte connecte, livreur compris.
app.get("/api/db", requireAdministration, (req, res) => {
  if (!ENABLE_DB_EXPORT) {
    res.status(403).json({
      error: "Export complet de la base desactive. Utiliser SEREO_ENABLE_DB_EXPORT=1 pour diagnostic local."
    });
    return;
  }

  res.json(readDb());
});

// Poids du reseau (24/09, mesure en production) : `ordersByDate`, le releve de
// l'import (une entree par date de commande, avec ses lignes), faisait 43 % de
// /api/clients -- et 14 % de /api/crm/clients, qui le recopie. La page ne le lit
// nulle part : elle a les commandes elles-memes (/api/orders). Il reste en
// base, ou l'import le relit ; seules les LISTES envoyees s'allegent.
function sansReleveDImport({ ordersByDate, ...client }) {
  return client;
}

app.get("/api/clients", (req, res) => {
  res.json(readDb().clients.map(sansReleveDImport));
});

app.get("/api/ventes", (req, res) => {
  res.json(readDb().ventes);
});

app.get("/api/stock", (req, res) => {
  const db = readDb();
  res.json(getStockView(db));
});

// Le journal « qui a fait quoi » (lot « donnees utiles », 24/09). Avant, la
// page chargeait /api/historique EN ENTIER a chaque ouverture (loadData), pour
// le rendre dans un ecran que la navigation n'ouvrait pas ; sans auteur. La
// page ne le charge plus ; la carte « Journal » de Parametres (administration)
// le lit par pages. /api/historique reste pour les outils, reserve comme lui.
app.get("/api/historique", requireAdministration, (req, res) => {
  res.json(readDb().historique);
});

const JOURNAL_PAGE_DEFAUT = 50;
const JOURNAL_PAGE_MAX = 200;

/** « Alèses : −2 · 10 → 8 · Inventaire » : un mouvement de stock en une ligne. */
function messageMouvementStock(mouvement) {
  const signe = mouvement.type === "entree" ? "+" : "−";
  const quantite = Number(mouvement.quantity ?? mouvement.quantite);
  return [
    `${mouvement.productName || mouvement.sku || "Produit"} : ${signe}${Number.isFinite(quantite) ? quantite : "?"}`,
    // Une quantite inconnue (produit cree par un import, « a renseigner ») : « — ».
    mouvement.oldQuantity !== undefined && mouvement.newQuantity !== undefined ? `${mouvement.oldQuantity ?? "—"} → ${mouvement.newQuantity ?? "—"}` : "",
    clean(mouvement.reason || mouvement.raison)
  ].filter(Boolean).join(" · ");
}

// L'auteur d'une ligne : null quand il n'etait pas connu (lignes d'avant le
// 24/09, et « local », que les mouvements portaient tous).
function auteurDuJournal(valeur) {
  const auteur = clean(valeur);
  return auteur && auteur !== "local" ? auteur : null;
}

/**
 * Une page du journal. `genre` : « actions » (l'historique) ou « stock » (les
 * mouvements). Du plus recent au plus ancien ; a date egale, l'ordre d'ecriture.
 * Le curseur `avant` est « date|id » de la derniere ligne de la page precedente :
 * une ligne ecrite entre deux pages arrive en tete, elle ne decale pas la suite.
 */
function pageDuJournal(db, { genre = "actions", limite, avant } = {}) {
  const taille = Math.min(JOURNAL_PAGE_MAX, Math.max(1, Math.floor(Number(limite)) || JOURNAL_PAGE_DEFAUT));
  const lignes = genre === "stock"
    ? (db.stockMovements || []).map(m => ({
      genre: "stock", id: String(m.id), date: String(m.createdAt || m.date || ""), type: "Stock",
      message: messageMouvementStock(m), auteur: auteurDuJournal(m.createdBy || m.utilisateur)
    }))
    : (db.historique || []).map(h => ({
      genre: "action", id: String(h.id), date: String(h.date || ""), type: clean(h.type) || "—",
      message: clean(h.message || h.texte), auteur: auteurDuJournal(h.auteur)
    }));
  // Tri stable : a date egale, l'ordre du tableau (le plus recent en tete, unshift).
  lignes.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));

  let debut = 0;
  if (avant) {
    const [dateCurseur, ...reste] = String(avant).split("|");
    const idCurseur = reste.join("|");
    const rang = lignes.findIndex(l => l.id === idCurseur);
    debut = rang >= 0 ? rang + 1 : lignes.findIndex(l => l.date < dateCurseur);
    if (debut < 0) debut = lignes.length;
  }
  const entrees = lignes.slice(debut, debut + taille);
  const derniere = entrees[entrees.length - 1];
  const suivant = debut + taille < lignes.length && derniere ? `${derniere.date}|${derniere.id}` : null;
  return { genre: genre === "stock" ? "stock" : "actions", entrees, suivant, total: lignes.length };
}

app.get("/api/journal", requireAdministration, (req, res) => {
  try {
    res.json(pageDuJournal(readDb(), {
      genre: req.query.genre === "stock" ? "stock" : "actions",
      limite: req.query.limite,
      avant: req.query.avant
    }));
  } catch (error) {
    handleRouteError(error, res, "Erreur lecture du journal");
  }
});

// Les « Mouvements recents » de l'ecran Stock (relecture adverse du 24/09).
// Cette route part au chargement de l'app, pour TOUS les comptes, et le
// service worker la garde en cache. Elle servait toute la table, avec
// `createdBy` -- qui porte depuis le 24/09 l'identifiant du compte : le verrou
// de /api/journal?genre=stock (administration) ne gardait donc rien. Elle ne
// sert plus que les derniers mouvements (l'ecran en montre 12), sans auteur ;
// « qui » se lit dans le journal de Parametres.
const MOUVEMENTS_STOCK_RECENTS = 50;

app.get("/api/stock-movements", (req, res) => {
  // Les N premiers (les plus recents : recordStockMovement les met en tete).
  // L'ecran Stock n'en montre que 12 et les demande ainsi depuis le 24/09
  // (`limite`, lot reseau) : 222 ko pour 633 mouvements en production, a chaque
  // ouverture. Jamais plus de MOUVEMENTS_STOCK_RECENTS, jamais d'auteur (lot
  // « donnees utiles ») : sans `limite`, ou au-dela, les
  // MOUVEMENTS_STOCK_RECENTS derniers.
  const limite = Number.parseInt(req.query.limite, 10);
  const nombre = Number.isInteger(limite) && limite > 0 ? Math.min(limite, MOUVEMENTS_STOCK_RECENTS) : MOUVEMENTS_STOCK_RECENTS;
  res.json((readDb().stockMovements || []).slice(0, nombre)
    .map(({ createdBy, utilisateur, auteur, ...mouvement }) => mouvement));
});

app.get("/api/dashboard", (req, res) => {
  const db = readDb();
  // Le compte des ventes sans lire la table (revue du 24/09) : sur SQLite, un
  // COUNT ; 429 lignes et 249 ko de JSON decodes pour un nombre, avant.
  res.json(getDashboardSummary(db, useSqliteStorage() ? { nombreDeVentes: getSqliteStore().compterVentes() } : {}));
});

app.get("/api/storage/status", (req, res) => {
  res.json({
    engine: useSqliteStorage() ? "sqlite" : "json",
    persistent: true,
    sharedAfterRefresh: true,
    accessProtected: isAccessAuthEnabled(),
    path: useSqliteStorage() ? SQLITE_PATH : DB_PATH,
    // B3 v1.16.0 : expose la derniere recovery de corruption (null si aucune)
    // pour qu'un client/admin puisse afficher une alerte de perte de donnees.
    lastRecovery: lastStorageRecovery,
    // Chantier 1 : flag indiquant si le snapshot post-restore a deja ete fait
    // (visible pour debug ; le snapshot est cree au premier appel writeDb).
    postRestoreBackupDone,
    // Lot 3 (audit 2026-07-08) : sante des backups. backupsSuspended=true =>
    // recovery fresh_empty en cours, aucun backup auto tant qu'aucune donnee
    // n'est re-saisie (l'UI doit alerter). lastBackupError != null => dernier
    // backup async a echoue (disque plein/permissions) : a surveiller.
    backupsSuspended: backupsSuspendedFreshEmpty,
    lastBackupAt,
    lastBackupError,
    // Calcul routier (23/09) : carte locale ou serveur public, zone, date de
    // la carte, derniere erreur, espace utilise ; `resume` est la ligne de
    // l'ecran Parametres.
    calculRoutier: osrmLocal.etat(),
    // Carte « Sauvegardes » de Parametres (24/09) : ce que ces champs disaient
    // (« l'UI doit alerter »), plus la derniere sauvegarde lue SUR LE DISQUE
    // (lastBackupAt repart a null a chaque demarrage) et le verdict.
    sauvegardes: etatDesSauvegardes(getRequestIdentity(req))
  });
});

// Le telechargement de la base entiere (clients, adresses, telephones, et les
// empreintes des mots de passe des comptes) : a qui est-il ouvert ?
//
// A l'administration seulement (decision de Thomas du 24/09, garde
// requireAdministration sur la route). Mais sans authentification (dev, ou un
// deploiement sans SEREO_AUTH_* ni compte), TOUT visiteur est « administrateur »
// (getRequestIdentity) : le role ne prouve plus rien. C'est le cas que
// SEREO_ENABLE_DB_EXPORT garde deja pour /api/db (export JSON de la base,
// reserve lui aussi a l'administration depuis le 25/09, 0 par defaut) : sans
// authentification, c'est lui qui decide. Avec authentification, la variable
// ne s'applique pas ici : le role suffit.
// Rend null si le telechargement est permis, sinon la raison du refus.
function refusDeTelechargement(identite) {
  if (!identite || !getRole(identite.role).administration) return "Reserve aux administrateurs.";
  if (!isAccessAuthEnabled() && !ENABLE_DB_EXPORT) {
    return "Sans connexion, tout visiteur est administrateur : le telechargement de la base reste ferme (SEREO_ENABLE_DB_EXPORT=1 l'ouvre).";
  }
  return null;
}

// L'etat des sauvegardes pour la carte de Parametres. Des donnees, pas des
// phrases : l'ecran ecrit le texte. `alerte` vaut null quand tout va bien.
// Une lecture du dossier impossible est elle-meme une alerte, jamais un 500 :
// la page de Parametres doit rester lisible quand le disque ne l'est pas.
function etatDesSauvegardes(identite, maintenant = Date.now()) {
  let entries = [];
  let erreurLecture = null;
  try {
    entries = listBackupEntries();
  } catch (error) {
    erreurLecture = String(error.message || error);
  }
  const derniere = entries[0] || null;
  // Les jours de Paris que les sauvegardes sur le disque couvrent.
  const jours = new Set(entries.map(e => jourParis(e.mtimeMs))).size;
  const plusAncienne = entries.length ? entries[entries.length - 1] : null;
  // 2 s de marge : un systeme de fichiers qui date a la seconde (ou a deux,
  // FAT) arrondit la sauvegarde qui suit une ecriture AVANT cette ecriture.
  const perimee = Boolean(derniere)
    && maintenant - derniere.mtimeMs > SAUVEGARDE_PERIMEE_MS
    && derniereModificationA !== null
    && derniereModificationA > derniere.mtimeMs + 2000;

  // Une alerte a la fois, la plus grave d'abord.
  let alerte = null;
  if (erreurLecture) alerte = { type: "lecture", message: erreurLecture };
  else if (lastBackupError) alerte = { type: "echec", at: lastBackupError.at, message: lastBackupError.message };
  else if (derniereErreurCopie) alerte = { type: "copie", at: derniereErreurCopie.at, message: derniereErreurCopie.message };
  else if (backupsSuspendedFreshEmpty) alerte = { type: "suspendues" };
  else if (!derniere) alerte = { type: "aucune" };
  else if (perimee) alerte = { type: "perimee", depuis: new Date(derniereModificationA).toISOString() };

  const refus = refusDeTelechargement(identite);
  return {
    derniere: derniere
      ? { nom: derniere.name, date: new Date(derniere.mtimeMs).toISOString(), taille: derniere.size }
      : null,
    nombre: entries.length,
    jours,
    plusAncienne: plusAncienne ? new Date(plusAncienne.mtimeMs).toISOString() : null,
    alerte,
    politique: {
      heures: BACKUP_THROTTLE_MS / 3600000,
      dernieres: BACKUP_RETENTION,
      joursJournalieres: BACKUP_JOURS_JOURNALIERES,
      semainesHebdomadaires: BACKUP_SEMAINES_HEBDOMADAIRES,
      perimeeApresHeures: SAUVEGARDE_PERIMEE_MS / 3600000
    },
    administration: Boolean(identite && getRole(identite.role).administration),
    telechargement: { permis: refus === null && Boolean(derniere), raison: refus },
    // Le second dossier (decision 3) : pose ou non, et la derniere copie
    // reussie par ce processus. Le chemin n'est pas donne.
    copie: BACKUP_COPY_DIR
      ? { active: true, derniere: derniereCopie ? { nom: derniereCopie.nom, date: derniereCopie.at } : null }
      : { active: false }
  };
}

// Telecharger la derniere sauvegarde (decision de Thomas du 24/09) : le seul
// moyen d'en avoir une copie HORS de la machine -- les sauvegardes vivent sur
// le meme disque que la base (DEPLOYMENT.md). Jamais une autre que la
// derniere : aucun nom de fichier ne vient de la requete.
app.get("/api/sauvegardes/derniere", requireAdministration, (req, res) => {
  try {
    const refus = refusDeTelechargement(req.identite);
    if (refus) {
      res.status(403).json({ error: refus });
      return;
    }
    const derniere = listBackupEntries()[0];
    if (!derniere) {
      res.status(404).json({ error: "Aucune sauvegarde a telecharger." });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.download(derniere.fullPath, derniere.name, { headers: { "Content-Type": "application/gzip" } }, error => {
      if (error && !res.headersSent) handleRouteError(error, res, "Erreur telechargement sauvegarde");
    });
  } catch (error) {
    handleRouteError(error, res, "Erreur telechargement sauvegarde");
  }
});

// Chantier 1 (2026-06-04) : force un backup immediat, hors throttle. Utilise
// par l'admin avant une operation a risque (purge, migration, restauration
// manuelle) ou apres un long deploiement sans mutation. Tag optionnel.
//
// Revue R1 P0 : addHistory + writeDb dans withWriteLock pour persister
// l'entree de log (avant, addHistory(readDb(), ...) sans writeDb perdait
// l'entree silencieusement).
// Decision de Thomas du 24/09 : un geste d'administration (la carte
// « Sauvegardes » de Parametres le porte). Sans authentification (dev), tout le
// monde est administrateur, comme pour la numerotation des bons.
//
// Garde-fous (25/09) : la copie est coherente et relue (ecrireSauvegardeVerifiee)
// et se fait HORS du verrou d'ecriture -- un « Livre » ne l'attend plus ; elle
// attend la sauvegarde automatique en vol puis tient sa place (sauvegardeSeule).
//
// Et elle ne peut plus evincer les autres (chasse aux defauts : une purge puis
// 30 appels remplacaient toutes les sauvegardes par une base vide) :
// - deja a jour : si la derniere sauvegarde sur le disque est celle que ce
//   processus a ecrite et que rien n'a ete ecrit depuis, aucun fichier de plus
//   (reponse `dejaAJour`) ;
// - au plus SAUVEGARDES_MANUELLES_PAR_HEURE sauvegardes manuelles par heure
//   glissante (au-dela : 503 et Retry-After -- pas 429, qu'apiFetch prend pour
//   un verrou de connexion). Les sauvegardes automatiques ne sont pas comptees ;
// - le genre « avant-purge-* » est reserve (hors rotation pour les bons).
const SAUVEGARDES_MANUELLES_PAR_HEURE = 10;
const sauvegardesManuelles = [];

app.post("/api/backup/now", requireAdministration, async (req, res) => {
  try {
    let tag = clean(req.body?.tag || "manual").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    // Le genre « avant-purge » est reserve, ou qu'il soit dans l'etiquette :
    // « x-avant-purge-commandes » sortait la sauvegarde de la rotation
    // (MOTIF_HORS_ROTATION ne lit que la fin du nom ; relecture du 26/09).
    if (/avant-purge/i.test(tag)) tag = "manuelle";

    const derniere = listBackupEntries()[0];
    if (derniere && derniereSauvegardeEcrite
      && derniere.name === derniereSauvegardeEcrite.nom
      && derniereModificationA === derniereSauvegardeEcrite.couvre) {
      res.json({ ok: true, dejaAJour: true, backupPath: derniere.name, tag });
      return;
    }

    const maintenant = Date.now();
    while (sauvegardesManuelles.length && sauvegardesManuelles[0] <= maintenant - 3600000) sauvegardesManuelles.shift();
    if (sauvegardesManuelles.length >= SAUVEGARDES_MANUELLES_PAR_HEURE) {
      const attenteMs = sauvegardesManuelles[0] + 3600000 - maintenant;
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(attenteMs / 1000))));
      res.status(503).json({
        ok: false,
        error: `Trop de sauvegardes manuelles : ${SAUVEGARDES_MANUELLES_PAR_HEURE} dans l’heure. Réessaie dans ${Math.max(1, Math.ceil(attenteMs / 60000))} min ; les sauvegardes automatiques continuent.`
      });
      return;
    }
    // Comptee des la tentative : un disque en panne ne se martele pas non plus.
    sauvegardesManuelles.push(maintenant);

    let sauvegarde;
    try {
      sauvegarde = await sauvegardeSeule(() => ecrireSauvegardeVerifiee(tag));
    } catch (error) {
      // La carte le dira aussi apres un rechargement, pas seulement le toast.
      lastBackupError = { at: new Date().toISOString(), message: String(error.message || error) };
      throw error;
    }
    if (!sauvegarde) {
      return res.status(503).json({ ok: false, error: "Backup impossible (source absente)" });
    }
    await withWriteLock(async () => {
      const db = readDb();
      addHistory(db, "Backup manuel", `Backup forcé créé : ${sauvegarde.nom}`, { tag, backupPath: sauvegarde.chemin });
      // Pas de double-backup recursif ; et cette ligne d'historique ne rend pas
      // la sauvegarde qu'elle annonce « perimee ».
      writeDb(db, { backup: false, modification: false });
    });
    res.json({ ok: true, backupPath: sauvegarde.nom, tag });
  } catch (error) {
    handleRouteError(error, res, "Erreur backup manuel");
  }
});

// v1.17.1 : diagnostic des dates suspectes en DB. M1 a durci normalizeDateInput :
// les commandes pre-1.17 stockees avec une date aberrante (`2025-13-31`,
// `30/02/2026`, an > 2199...) verront cette date mutee vers today au prochain
// readDb. Cet endpoint scan la base AVANT toute mutation pour quantifier
// l'exposition. Lecture seule, aucune modification.
// v1.17.1 : extraction en fonction pure pour pouvoir tester sans passer par
// writeDb (qui normalise les dates aberrantes via normalizeOrder).
//
// Revue adverse R1 :
// - MAJOR-3 : cap a SCAN_MAX_COMMANDES pour eviter event-loop blocking
//   (DoS theorique : 1M commandes * 50us regex/normalize = 50s blocking).
// - MINOR-3/12/14 : ISO datetime 24-char ('2026-05-05T10:00:00.000Z') ecrit
//   par ensureOrderNumbers legacy n'est PAS suspect : son prefixe 10 chars
//   est un ISO valide. On teste le prefixe, pas la chaine entiere.
const SCAN_MAX_COMMANDES = 50000;

function scanSuspiciousDates(commandes) {
  const list = Array.isArray(commandes) ? commandes : [];
  const samples = [];
  let suspicious = 0;
  let missingDate = 0;

  const truncated = list.length > SCAN_MAX_COMMANDES;
  const toScan = truncated ? list.slice(0, SCAN_MAX_COMMANDES) : list;

  for (const order of toScan) {
    // Mirror EXACT de normalizeOrder (meme valeur BRUTE, pas String() qui
    // casserait le path number d'un serial Excel en mode JSON) :
    //   normalizeDateInput(raw) truthy      -> canonisee sans perte (saine)
    //   sinon string non vide               -> PRESERVEE brute (a corriger)
    //   sinon (blanc / non-string / absente)-> today (defaut silencieux)
    const raw = order.dateCommande;
    if (!raw) { missingDate += 1; continue; }
    if (normalizeDateInput(raw)) continue;

    const preservedRaw = typeof raw === "string" && raw.trim();
    if (!preservedRaw) { missingDate += 1; continue; }

    suspicious += 1;
    if (samples.length < 20) {
      samples.push({
        id: order.id,
        numero: order.numero || "(sans numero)",
        clientName: order.clientName || "",
        dateCommandeRaw: String(raw),
        dateCommandeApresValidation: "(non normalisable -> preservee telle quelle, a corriger manuellement)"
      });
    }
  }

  return {
    totalCommandes: list.length,
    commandesAnalysees: toScan.length,
    troncature: truncated,
    datesManquantes: missingDate,
    datesSuspectes: suspicious,
    echantillon: samples,
    note: suspicious === 0
      ? "Aucune date suspecte. Rien a corriger manuellement."
      : `${suspicious} date(s) non normalisable(s) : preservee(s) telle(s) quelle(s) (jamais mutee vers today), a corriger manuellement.`
  };
}

app.get("/api/diagnostic/suspicious-dates", (req, res) => {
  // Revue R1 MINOR-10 : reponse contient PII (clientName, numero), pas de
  // cache cote intermediaire/CDN.
  res.set("Cache-Control", "no-store, max-age=0");
  res.set("Vary", "Cookie");
  const db = readDb();
  res.json(scanSuspiciousDates(db.commandes));
});

// L'endpoint /api/version est declare plus haut (avant requireAccessAuth)
// pour rester accessible sans authentification, notamment sur la page /login.

// L'IMAGE DE MARQUE N'EST PLUS DANS LES REGLAGES (24/09, mesure en production) :
// une image importee est gardee en base64 dans `appearance.brandImage`, et les
// 116 ko repartaient a chaque ouverture -- pour un apercu que seuls les
// Parametres montrent. Les reglages en donnent desormais l'ADRESSE, versionnee
// par l'empreinte de l'image (?v=) : le navigateur ne la demande que si
// l'apercu s'affiche, et la garde ensuite (la meme adresse ne change jamais de
// contenu). La base, l'import et la remise a zero ne changent pas.
const IMAGE_DE_MARQUE_CHEMIN = "/api/settings/appearance/image";

function empreinteImageDeMarque(dataUrl) {
  return crypto.createHash("sha256").update(dataUrl).digest("hex").slice(0, 16);
}

function apparencePourLaPage(appearance) {
  const image = appearance.brandImage || "";
  if (!image.startsWith("data:")) return appearance;
  return { ...appearance, brandImage: `${IMAGE_DE_MARQUE_CHEMIN}?v=${empreinteImageDeMarque(image)}` };
}

app.get("/api/settings/appearance", (req, res) => {
  res.json(apparencePourLaPage(getAppearanceSettings(readDb())));
});

app.get(IMAGE_DE_MARQUE_CHEMIN, (req, res) => {
  const image = getAppearanceSettings(readDb()).brandImage || "";
  const morceaux = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]*)$/i.exec(image);
  if (!morceaux) {
    res.status(404).json({ error: "Aucune image personnalisee" });
    return;
  }
  const empreinte = empreinteImageDeMarque(image);
  res.set("Content-Type", morceaux[1].toLowerCase());
  res.set("ETag", `"${empreinte}"`);
  // Une image importee peut etre un SVG : ouverte seule, elle ne doit rien
  // pouvoir executer (aucun script, document isole).
  res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.set("Cache-Control", req.query.v === empreinte ? "private, max-age=31536000, immutable" : "private, no-cache");
  if (req.fresh) {
    res.status(304).end();
    return;
  }
  res.send(Buffer.from(morceaux[2], "base64"));
});

app.patch("/api/settings/appearance", requireAdministration, async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const appearance = getAppearanceSettings(db);

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "themeId")) {
        const themeId = clean(req.body.themeId);
        if (!themeId || !/^[a-z0-9_-]{1,40}$/i.test(themeId)) {
          throw badRequest("Palette invalide");
        }
        appearance.themeId = themeId;
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "brandImage")) {
        appearance.brandImage = validateBrandImage(req.body.brandImage);
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "colorScheme")) {
        const raw = clean(req.body.colorScheme).toLowerCase();
        if (!VALID_COLOR_SCHEMES.has(raw)) {
          throw badRequest("Mode d'affichage invalide");
        }
        appearance.colorScheme = raw;
      }

      db.settings.appearance = appearance;
      writeDb(db);
      return appearance;
    });
    res.json(apparencePourLaPage(result));
  } catch (error) {
    handleRouteError(error, res, "Erreur parametres");
  }
});

app.get("/api/settings/order-numbering", (req, res) => {
  const db = readDb();
  res.json(normalizeSettings(db.settings || {}).orderNumbering);
});

// v1.17.1 : GET reglages tournee (vitesse + duree d'arret)
app.get("/api/settings/tournee", (req, res) => {
  const db = readDb();
  res.json(normalizeSettings(db.settings || {}).tournee);
});

// « A recommander » qui voit venir (24/09) : l'horizon en jours. Un reglage du
// quotidien, comme ceux de la tournee : ouvert a tout compte connecte.
app.get("/api/settings/stock", (req, res) => {
  const db = readDb();
  res.json(normalizeSettings(db.settings || {}).stock);
});

app.patch("/api/settings/stock", requireAdministration, async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      db.settings = normalizeSettings(db.settings || {});
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "horizonJours")) {
        const brut = req.body.horizonJours;
        // Un nombre entier, borne : Number(null) = 0 et « 14 » passeraient sinon.
        if (typeof brut !== "number" || !Number.isInteger(brut) || brut < HORIZON_MIN_JOURS || brut > HORIZON_MAX_JOURS) {
          throw badRequest(`Horizon invalide : un nombre entier de jours, de ${HORIZON_MIN_JOURS} a ${HORIZON_MAX_JOURS}.`);
        }
        db.settings.stock.horizonJours = brut;
      }
      writeDb(db);
      return normalizeSettings(db.settings).stock;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur parametres stock");
  }
});

// Le fond de carte choisi par l'environnement (lib/fond-de-carte.js). La page
// le lit avant de poser les tuiles ; la CSP lit le meme. Sans l'origine CSP :
// la page n'en a pas l'usage.
app.get("/api/carte/fond", (req, res) => {
  const { url, attribution, zoomMax, referrerPolicy } = fondDeCarte();
  res.json({ url, attribution, zoomMax, referrerPolicy });
});

// Decision de Thomas du 23/09 : changer la numerotation des bons est un geste
// d'administration (la lecture reste ouverte : l'exemple du prochain bon
// s'affiche a tous). Sans authentification (dev), tout le monde est admin.
app.patch("/api/settings/order-numbering", requireAdministration, async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      db.settings = normalizeSettings(db.settings || {});

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "prefix")) {
        const raw = clean(req.body.prefix).toUpperCase();
        if (!/^[A-Z0-9]{2,8}$/.test(raw)) {
          throw badRequest("Prefixe invalide : 2 a 8 caracteres alphanumeriques (ex: CMD, ORD, BC)");
        }
        db.settings.orderNumbering.prefix = raw;
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "resetAnnually")) {
        db.settings.orderNumbering.resetAnnually = !!req.body.resetAnnually;
      }

      writeDb(db);
      return db.settings.orderNumbering;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur parametres numerotation");
  }
});

// v1.17.1 : reglages tournee. L'utilisateur ajuste vitesse moyenne et duree
// d'arret apres confrontation aux tournees reelles (defaut 28 km/h + 6 min).
//
// Revue R1 :
// - MINOR-11 : refuser explicitement les types non-number (Number(null)=0 et
//   Number(false)=0 passeraient le check sinon)
// - MINOR-16 : forcer entier (slider step=1, eviter "35.7 km/h" persiste)
// - MINOR-9 (limite payload inline) : NON applique car le middleware global
//   `app.use(express.json({limit:"5mb"}))` ligne 289 parse deja le body avant
//   un middleware inline. Reduire la limite globale casserait brandImage.
//   La protection reste : typeof + bornes serveur. Backlog : rate-limit
//   global /api/settings/*.
app.patch("/api/settings/tournee", requireAdministration, async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      db.settings = normalizeSettings(db.settings || {});

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "averageSpeedKmh")) {
        if (typeof req.body.averageSpeedKmh !== "number") {
          throw badRequest("averageSpeedKmh doit etre un nombre");
        }
        const raw = req.body.averageSpeedKmh;
        if (!Number.isFinite(raw) || raw < 10 || raw > 60) {
          throw badRequest("Vitesse moyenne invalide : entre 10 et 60 km/h");
        }
        db.settings.tournee.averageSpeedKmh = Math.round(raw);
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "stopDurationMin")) {
        if (typeof req.body.stopDurationMin !== "number") {
          throw badRequest("stopDurationMin doit etre un nombre");
        }
        const raw = req.body.stopDurationMin;
        if (!Number.isFinite(raw) || raw < 0 || raw > 30) {
          throw badRequest("Duree d'arret invalide : entre 0 et 30 minutes");
        }
        db.settings.tournee.stopDurationMin = Math.round(raw);
      }

      // Lot 6 (audit geo) : le depot par defaut. `null` l'efface ; sinon un
      // libelle et une position valides, refuses plutot que tronques en silence.
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "depot")) {
        const brut = req.body.depot;
        if (brut === null) {
          db.settings.tournee.depot = null;
        } else {
          if (!brut || typeof brut !== "object" || Array.isArray(brut)) throw badRequest("Dépôt invalide.");
          if (typeof brut.label !== "string" || !brut.label.trim()) throw badRequest("Donne un nom ou une adresse au dépôt.");
          if (brut.label.trim().length > DEPOT_LIBELLE_MAX) throw badRequest(`Nom du dépôt trop long (${DEPOT_LIBELLE_MAX} caractères au plus).`);
          if (!routing.coordinates(brut)) throw badRequest("Position du dépôt invalide : confirme une adresse.");
          db.settings.tournee.depot = normaliserDepot(brut);
        }
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "retourAuDepot")) {
        if (typeof req.body.retourAuDepot !== "boolean") throw badRequest("retourAuDepot doit etre vrai ou faux");
        db.settings.tournee.retourAuDepot = req.body.retourAuDepot;
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "messagePrevenir")) {
        if (typeof req.body.messagePrevenir !== "string") throw badRequest("Message invalide.");
        if (req.body.messagePrevenir.trim().length > MESSAGE_PREVENIR_MAX) {
          throw badRequest(`Message trop long (${MESSAGE_PREVENIR_MAX} caractères au plus).`);
        }
        // Vide : le texte par defaut revient (normalizeSettings).
        db.settings.tournee.messagePrevenir = req.body.messagePrevenir.trim();
      }

      writeDb(db);
      return normalizeSettings(db.settings).tournee;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur parametres tournee");
  }
});

app.get("/api/orders", (req, res) => {
  const db = readDb();
  const statusFilter = clean(req.query.status || "").toLowerCase();
  if (!statusFilter) return res.json(db.commandes);
  if (!ORDER_STATUSES.has(statusFilter)) {
    return res.status(400).json({ error: "Statut inconnu" });
  }
  res.json(db.commandes.filter(order => order.status === statusFilter));
});

// Recherche d'une commande par son numero humain (CMD-2026-001).
// Utilisee par la barre de recherche dans la nouvelle page Commandes (Phase 3).
app.get("/api/orders/by-number/:numero", (req, res) => {
  const db = readDb();
  const numero = clean(req.params.numero).toUpperCase();
  const order = db.commandes.find(o => String(o.numero).toUpperCase() === numero);
  if (!order) {
    return res.status(404).json({ error: "Commande introuvable" });
  }
  res.json(order);
});

app.get("/api/crm/clients", (req, res) => {
  const db = readDb();
  const query = normalizeTextKey(req.query.q || "");
  const statusFilter = normalizeCrmStatus(req.query.status || "", "");
  const today = jourParis();

  const ventesImportees = buildImportedSalesIndex(db.ventes);
  const parClient = indexCrmParClient(db);
  // La LISTE ne porte plus l'historique des commandes de chaque client (24/09) :
  // `orderHistory` recopiait /api/orders, client par client (66 % des 552 ko
  // mesures en production), et la page ne le lit pas -- elle a deja toutes les
  // commandes. La fiche seule (GET /api/crm/clients/:id) le garde ; les totaux
  // (totalOrders, totalRevenue), les rappels et le reste de la vue restent.
  let list = db.clients
    .filter(client => !client.crmArchived)
    .map(client => {
      const { orderHistory, ...vue } = crmClientView(db, client, ventesImportees, parClient);
      return sansReleveDImport(vue);
    });

  if (query) {
    list = list.filter(client => normalizeTextKey([
      client.nom,
      client.prenom,
      client.telephone,
      client.rue,
      client.ville,
      client.email,
      client.crmStatus
    ].join(" ")).includes(query));
  }

  if (statusFilter) {
    // « A relancer » compte aussi les clients signales (decision 5, 24/09).
    list = list.filter(client => client.crmStatus === statusFilter
      || (statusFilter === "client_a_relancer" && client.relanceSuggeree));
  }

  if (req.query.relance === "today") {
    list = list.filter(client => client.nextReminderDate === today);
  }
  if (req.query.relance === "late") {
    list = list.filter(client => client.nextReminderDate && client.nextReminderDate < today);
  }

  res.json(list.sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr")));
});

app.post("/api/crm/clients", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const duplicate = findDuplicateClient(db, req.body || {});
      if (duplicate) {
        throw Object.assign(badRequest("Client/prospect deja existant"), { statusCode: 409 });
      }
      const client = validateCrmClientPayload(req.body || {}, {
        id: `client-${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
        produits: []
      });
      db.clients.push(client);
      addHistory(db, "CRM", `${[client.prenom, client.nom].filter(Boolean).join(" ") || client.nom} : fiche creee`, {
        clientId: client.id,
        crmStatus: client.crmStatus
      });
      writeDb(db);
      return crmClientView(db, client);
    });
    res.status(201).json(result);
    // Lot 3 : un client cree au CRM est geocode (avant : seulement apres un
    // import Excel -- il restait sans position jusque-la).
    declencherGeocodageEnFond("creation client");
  } catch (error) {
    handleRouteError(error, res, "Erreur CRM");
  }
});

app.get("/api/crm/clients/:id", (req, res) => {
  const db = readDb();
  const client = findClient(db, req.params.id);
  if (!client) return res.status(404).json({ error: "Client introuvable" });
  res.json(crmClientView(db, client));
});

app.patch("/api/crm/clients/:id", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const client = findClient(db, req.params.id);
      if (!client) throw notFound("Client introuvable");
      const duplicate = findDuplicateClient(db, req.body || {}, client.id);
      if (duplicate) throw Object.assign(badRequest("Client/prospect deja existant"), { statusCode: 409 });

      const avant = adresseDuClient(client);
      Object.assign(client, validateCrmClientPayload(req.body || {}, client));
      // H5 : une adresse changee au CRM deplace aussi la position et les
      // commandes a livrer a l'ancienne adresse (decision 8).
      demenagerClient(db, client, avant);
      addHistory(db, "CRM", `${[client.prenom, client.nom].filter(Boolean).join(" ") || client.nom} : fiche mise a jour`, {
        clientId: client.id
      });
      writeDb(db);
      return crmClientView(db, client);
    });
    res.json(result);
    declencherGeocodageEnFond("modification client");
  } catch (error) {
    handleRouteError(error, res, "Erreur CRM");
  }
});

app.delete("/api/crm/clients/:id", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const client = findClient(db, req.params.id);
      if (!client) throw notFound("Client introuvable");
      if (db.subscriptions.some(sub => String(sub.clientId) === String(client.id) && sub.status !== "cancelled")) throw badRequest("Arrête les abonnements de ce client avant d’archiver sa fiche.");
      client.crmArchived = true;
      client.updatedAt = new Date().toISOString();
      addHistory(db, "CRM", `${client.nom} : fiche archivee`, { clientId: client.id });
      writeDb(db);
      return { ok: true, clientId: client.id };
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur archivage CRM");
  }
});

app.get("/api/crm/relances", (req, res) => {
  const db = readDb();
  res.json(getReminderViews(db, req.query));
});

app.get("/api/reminders", (req, res) => {
  const db = readDb();
  res.json(getReminderViews(db, req.query));
});

app.post("/api/crm/relances", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const client = findClient(db, req.body?.clientId);
      if (!client) throw notFound("Client introuvable");
      const reminder = normalizeCrmReminder(req.body || {});
      db.relances.push(reminder);
      refreshClientReminderDate(db, client.id);
      if (client.crmStatus !== "client_actif") client.crmStatus = "client_a_relancer";
      addHistory(db, "Relance CRM", `${client.nom} : relance ${reminder.datePrevue}`, {
        clientId: client.id,
        relanceId: reminder.id,
        orderId: reminder.commandeId
      });
      writeDb(db);
      return reminder;
    });
    res.status(201).json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur relance CRM");
  }
});

app.patch("/api/crm/relances/:id", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const reminder = db.relances.find(item => String(item.id) === String(req.params.id));
      if (!reminder) throw notFound("Relance introuvable");
      const next = normalizeCrmReminder({ ...reminder, ...req.body, id: reminder.id, updatedAt: new Date().toISOString() });
      Object.assign(reminder, next);
      const client = findClient(db, reminder.clientId);
      if (client) refreshClientReminderDate(db, client.id);
      addHistory(db, "Relance CRM", `Relance ${reminder.status}`, {
        clientId: reminder.clientId,
        relanceId: reminder.id
      });
      writeDb(db);
      return reminder;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur relance CRM");
  }
});

app.post("/api/customer-orders", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = createCustomerOrder(db, req.body || {});
      // Decision 11 : acceptee sans reservation, faute de stock -- l'ecran le dit.
      const bloquee = order.status === "stock_a_verifier" && !order.stockReservedAt;
      addHistory(db, "Commande client", `${order.clientName} : commande ${order.numero} validee${bloquee ? ", bloquee faute de stock" : ""}`, {
        orderId: order.id,
        clientId: order.clientId,
        total: order.total
      });
      writeDb(db);
      return { ...order, bloquee };
    });
    res.status(201).json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur commande client");
  }
});

app.get("/api/customer-orders/today", (req, res) => {
  const db = readDb();
  res.json(getCustomerOrdersForDate(db, req.query.date));
});

app.post("/api/customer-orders/send-preparation", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const updated = sendCustomerOrdersToPreparation(db, req.body?.orderIds);
      addHistory(db, "Commande client", `${updated.length} commande(s) envoyee(s) en preparation`, {
        orderIds: updated.map(order => order.id)
      });
      writeDb(db);
      return { updated: updated.length, orders: updated };
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur envoi preparation");
  }
});

app.get("/api/planned-orders", (req, res) => {
  const db = readDb();
  let list = listPlannedOrders(db);
  const status = clean(req.query.status || "");
  if (status) list = list.filter(order => order.status === status);
  res.json(list);
});

app.post("/api/planned-orders", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const planned = createPlannedOrder(db, req.body || {});
      addHistory(db, "Commande planifiee", `${planned.order.clientName} : commande ${planned.order.numero} planifiee au ${planned.order.deliveryDate}`, {
        orderId: planned.order.id,
        clientId: planned.order.clientId,
        reminderId: planned.reminder?.id
      });
      writeDb(db);
      return planned;
    });
    res.status(201).json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur commande planifiee");
  }
});

app.patch("/api/planned-orders/:id", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = updatePlannedOrder(db, req.params.id, req.body || {});
      addHistory(db, "Commande planifiee", `${order.numero || order.id} : mise a jour`, {
        orderId: order.id,
        status: order.status
      });
      writeDb(db);
      return order;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur commande planifiee");
  }
});

app.post("/api/planned-orders/:id/confirm", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = confirmPlannedOrder(db, req.params.id);
      addHistory(db, "Commande planifiee", `${order.numero || order.id} confirmee et envoyee en preparation`, {
        orderId: order.id,
        clientId: order.clientId
      });
      writeDb(db);
      return order;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur confirmation commande planifiee");
  }
});

app.get("/api/statistics", (req, res) => {
  const db = readDb();
  res.json(computeStatistics(db));
});

app.get("/api/recommendations", (req, res) => {
  const db = readDb();
  res.json(getRecommendations(db));
});

app.get("/api/sectors", (req, res) => {
  const db = readDb();
  res.json(getSectors(db));
});

app.get("/api/delivery-sectors", (req, res) => {
  const db = readDb();
  res.json((db.deliverySectors || []).map(decorerSecteurPourAffichage));
});

app.post("/api/delivery-sectors", requireAdministration, async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const sector = normalizeDeliverySector(req.body || {});
      db.deliverySectors.push(sector);
      addHistory(db, "Secteurs livraison", `${sector.secteur} : secteur ajoute`, { sectorId: sector.id });
      writeDb(db);
      return sector;
    });
    res.status(201).json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur secteur livraison");
  }
});

app.patch("/api/delivery-sectors/:id", requireAdministration, async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const sector = (db.deliverySectors || []).find(item => String(item.id) === String(req.params.id));
      if (!sector) throw notFound("Secteur livraison introuvable");
      Object.assign(sector, normalizeDeliverySector({ ...sector, ...req.body, id: sector.id, updatedAt: new Date().toISOString() }));
      addHistory(db, "Secteurs livraison", `${sector.secteur} : secteur mis a jour`, { sectorId: sector.id });
      writeDb(db);
      return sector;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur secteur livraison");
  }
});

app.delete("/api/delivery-sectors/:id", requireAdministration, async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const index = (db.deliverySectors || []).findIndex(item => String(item.id) === String(req.params.id));
      if (index < 0) throw notFound("Secteur livraison introuvable");
      const [sector] = db.deliverySectors.splice(index, 1);
      addHistory(db, "Secteurs livraison", `${sector.secteur} : secteur supprime`, { sectorId: sector.id });
      writeDb(db);
      return { ok: true, sectorId: sector.id };
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur secteur livraison");
  }
});

// L'export Excel de l'ecran Commandes : les commandes de SON filtre, dans son
// ordre (`ids`). Il remplace l'ecran Exports (decision 9, 24/09) et son
// « commandes annexes », une categorie que rien ne cree. POST et non GET :
// la liste filtree peut compter des centaines d'identifiants.
app.post("/api/exports/commandes.xlsx", (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) throw badRequest("Aucune commande à exporter.");
    const db = readDb();
    const parId = new Map(db.commandes.map(order => [String(order.id), order]));
    const commandes = ids.map(id => parId.get(id)).filter(Boolean);
    if (!commandes.length) throw badRequest("Aucune commande à exporter.");
    const buffer = buildXlsx(orderExportRows(commandes));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="sereo-commandes-${jourParis()}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    handleRouteError(error, res, "Erreur export commandes");
  }
});

// Lot 5 (audit geo, 23/09) : la liste n'envoie plus le trace des tournees
// terminees (87 % des 5 Mo relus a chaque chargement apres un an). Le trace
// reste en base ; `traceOmise` le dit, et GET /api/routes/:id le rend a la
// demande. En stockage SQLite, readDb ne l'a meme pas charge.
// Lot 2 : cloturee et annulee aussi (ecart nomme du lot 5 : les deux ensembles,
// ici et storage/sqliteStore.js).
const STATUTS_TOURNEE_SANS_TRACE_EN_LISTE = new Set(["terminee", "cloturee", "annulee"]);

function routePourListe(route) {
  if (!STATUTS_TOURNEE_SANS_TRACE_EN_LISTE.has(route.status)) return route;
  const { geometry, ...sansTrace } = route;
  return { ...sansTrace, traceOmise: true };
}

/** La tournee complete, trace compris, quel que soit son statut. */
function routeAvecTrace(db, routeId) {
  const route = db.routes.find(item => String(item.id) === String(routeId));
  if (!route) return null;
  if (Object.prototype.hasOwnProperty.call(route, "geometry")) return route;
  const trace = useSqliteStorage() ? getSqliteStore().getRouteTrace(route.id) : null;
  return { ...route, geometry: trace ?? null };
}

app.get("/api/routes", (req, res) => {
  const db = readDb();
  res.json(db.routes.map(routePourListe));
});

app.get("/api/routes/:id", (req, res) => {
  const route = routeAvecTrace(readDb(), req.params.id);
  if (!route) return res.status(404).json({ error: "Tournée introuvable" });
  res.json(route);
});

app.post("/api/import/stock", requireAdministration, uploadExcel, async (req, res) => {
  const uploadedPath = req.file?.path;

  try {
    const rows = await readExcelRows(uploadedPath);

    const headerIndex = findHeaderRowGroups(rows, [
      ["Code", "Reference", "Référence", "SKU"],
      ["Nom", "Produit", "Article"]
    ]);

    if (headerIndex === -1) {
      throw badRequest("Colonnes stock non reconnues");
    }

    const headers = rows[headerIndex];
    const dataRows = rows.slice(headerIndex + 1);

    // Chantier 1 : wrap mutations dans withWriteLock pour eviter le TOCTOU
    // contre d'autres imports/PATCH concurrents. Lecture Excel deja faite
    // hors-verrou (cout 5-30s).
    const response = await withWriteLock(async () => {
    const db = readDb();

    // Index des produits existants par productKey (code/nom normalises)
    // pour preserver l'ID + la quantite manuelle quand on reimporte le meme Excel.
    // Bug fix : avant, chaque import recreait tous les produits avec un UUID
    // random et ecrasait db.stock, ce qui detruisait les ajustements +1/-1 que
    // l'utilisateur avait fait manuellement entre 2 imports.
    const existingByKey = new Map();
    db.stock.forEach(product => {
      const key = productKey(product);
      if (key) existingByKey.set(key, product);
    });

    const parsedProducts = dataRows
      .map(row => {
        const code = clean(getCellByNames(row, headers, ["Code", "Reference", "Référence", "SKU"]));
        const nom = clean(getCellByNames(row, headers, ["Nom", "Produit", "Article"]));
        // Lot 4b : cout/tarif/statut/category/seuil d'un produit ne viennent QUE
        // de l'import (jamais edites cote app). Quand une colonne est absente d'un
        // Excel partiel (ou sa cellule vide/illisible), on PRESERVE la valeur DB
        // au lieu de l'ecraser par 0/"". Note (revue #87) : getCellByNames renvoie
        // "" aussi bien pour une colonne absente que pour une cellule vide -> on
        // ne distingue pas les deux (vider volontairement un champ via import
        // n'est pas supporte, c'est le prix de la surete des imports partiels).
        const coutCell = getCellByNames(row, headers, ["Cout", "Coût", "Prix achat"]);
        const tarifCell = getCellByNames(row, headers, ["Tarif", "Prix", "Prix vente"]);
        const statutCell = getCell(row, headers, "Statut", 1);
        // "Presence" = valeur NUMERIQUE valide, pas juste cellule non vide (revue
        // #87) : une cellule Cout/Tarif au contenu texte ('N/A', '-', '12 EUR')
        // ne doit PAS ecraser le prix DB par 0 (number(...,0) donnerait 0).
        const coutParsed = number(coutCell, NaN);
        const tarifParsed = number(tarifCell, NaN);
        const hasCout = Number.isFinite(coutParsed);
        const hasTarif = Number.isFinite(tarifParsed);
        const cout = hasCout ? coutParsed : 0;
        const tarif = hasTarif ? tarifParsed : 0;
        const statut = clean(statutCell);
        const excelQuantite = optionalQuantity(getCellByNames(row, headers, ["Quantite", "Stock", "Qte"]));
        const category = clean(getCellByNames(row, headers, ["Categorie", "Category", "Type"]));
        const alertThreshold = optionalQuantity(getCellByNames(row, headers, ["Seuil", "Seuil alerte", "Minimum", "Alerte"]));

        const fieldsFromExcel = {
          code,
          sku: code,
          nom,
          tarif,
          cout,
          statut,
          type: category,
          category
        };
        if (alertThreshold !== null && alertThreshold !== undefined) {
          const normalizedThreshold = Math.max(0, Math.round(alertThreshold));
          fieldsFromExcel.alertThreshold = normalizedThreshold;
          fieldsFromExcel.stockMinimum = normalizedThreshold;
          fieldsFromExcel.seuilMinimum = normalizedThreshold;
        }

        const key = productKey(fieldsFromExcel);
        const existing = key ? existingByKey.get(key) : null;

        if (existing) {
          // MERGE : preserve l'id et la quantite manuelle (la regle metier dit
          // que c'est l'utilisateur qui gere son stock cote app, l'Excel ne sert
          // qu'a importer le catalogue produits). Une valeur explicite dans la
          // colonne Quantite de l'Excel ecrase quand meme le stock manuel pour
          // permettre une remise a zero ponctuelle si vraiment souhaitee.
          //
          // Lot 4b : pour cout/tarif/statut/category/nom/seuil, on ne prend la
          // valeur Excel QUE si la colonne est presente (sinon on garde la DB).
          // Sinon un reimport partiel [Code,Nom,Quantite] mettait cout=tarif=0 et
          // vidait statut/category pour tous les produits (perte des prix/marges).
          return {
            ...existing,
            ...fieldsFromExcel,
            id: existing.id,
            nom: nom || existing.nom || nom,
            cout: hasCout ? cout : (existing.cout ?? cout),
            tarif: hasTarif ? tarif : (existing.tarif ?? tarif),
            statut: statut || existing.statut || "",
            category: category || existing.category || "",
            type: category || existing.type || existing.category || "",
            alertThreshold: alertThreshold !== null && alertThreshold !== undefined
              ? alertThreshold
              : (existing.alertThreshold ?? null),
            quantite: excelQuantite !== null && excelQuantite !== undefined
              ? excelQuantite
              : existing.quantite
          };
        }

        // Nouveau produit (pas trouve dans la DB) : UUID + valeur Excel (ou null)
        return {
          ...fieldsFromExcel,
          id: crypto.randomUUID(),
          alertThreshold: fieldsFromExcel.alertThreshold ?? DEFAULT_STOCK_ALERT_THRESHOLD,
          stockMinimum: fieldsFromExcel.stockMinimum ?? DEFAULT_STOCK_ALERT_THRESHOLD,
          seuilMinimum: fieldsFromExcel.seuilMinimum ?? DEFAULT_STOCK_ALERT_THRESHOLD,
          quantite: excelQuantite
        };
      })
      .filter(product => product.code || product.nom);

    // Deduplication : garde la PREMIERE occurrence par productKey (code || nom).
    // Un export stock propre ne contient pas de doublons - les lignes suivantes
    // sont ignorees pour eviter des entrees fantomes dans les recommandations.
    const seenProductKeys = new Map();
    let duplicatesSkipped = 0;
    parsedProducts.forEach(product => {
      const key = productKey(product);
      if (!key) return;
      if (seenProductKeys.has(key)) {
        duplicatesSkipped += 1;
        return;
      }
      seenProductKeys.set(key, product);
    });

    // Preservation des produits qui sont dans la DB mais ABSENTS du nouvel Excel.
    // Strategie safe : on ne supprime pas (l'utilisateur peut avoir ajoute des
    // produits hors Excel, ou re-importer un Excel partiel). Une purge explicite
    // pourra etre exposee plus tard via un endpoint dedie si besoin.
    const importedKeys = new Set(seenProductKeys.keys());
    const preservedProducts = db.stock.filter(product => {
      const key = productKey(product);
      return key && !importedKeys.has(key);
    });

    const importedProducts = Array.from(seenProductKeys.values());
    const updatedCount = importedProducts.filter(p => existingByKey.has(productKey(p))).length;
    const createdCount = importedProducts.length - updatedCount;
    // Lot « stock » (24/09) : la colonne Quantite qui CHANGE le rayon est
    // ecrite au journal des mouvements, comme une saisie a la main ; un
    // produit cree avec une quantite aussi. Un rayon inchange n'ecrit rien.
    const motifImport = `Import du stock (${clean(req.file.originalname) || "fichier"})`;
    importedProducts.forEach(product => {
      const existing = existingByKey.get(productKey(product));
      const apres = getStockQuantity(product);
      if (existing) {
        const avant = getStockQuantity(existing);
        if (avant !== apres) recordStockMovement(db, product, avant, apres, motifImport);
      } else if (apres !== null) {
        recordStockMovement(db, product, null, apres, `${motifImport} : produit créé`);
      }
    });

    db.stock = [...importedProducts, ...preservedProducts];

    // Pas de syncWorkflow ici (25/09) : writeDb le fait, et rien d'ici la ne
    // lit ce qu'il calcule (les comptes du message sont deja faits).
    const dedupNote = duplicatesSkipped > 0
      ? `, ${duplicatesSkipped} doublon(s) ignore(s)`
      : "";
    const preservedNote = preservedProducts.length > 0
      ? `, ${preservedProducts.length} produit(s) hors Excel preserve(s)`
      : "";
    addHistory(
      db,
      "Import stock",
      `${createdCount} produit(s) cree(s), ${updatedCount} produit(s) mis a jour${dedupNote}${preservedNote}`,
      { fichier: req.file.originalname }
    );

    // v1.12.0 : archivage du fichier Excel brut pour retelechargement futur
    const archive = archiveImportFile(req, db, "stock", {
      rowsCount: dataRows.length,
      created: createdCount,
      updated: updatedCount,
      preserved: preservedProducts.length,
      duplicatesSkipped
    });

    writeDb(db);

    return {
      success: true,
      stock: db.stock,
      commandes: db.commandes,
      duplicatesSkipped,
      created: createdCount,
      updated: updatedCount,
      preserved: preservedProducts.length,
      archive
    };
    });
    res.json(response);
  } catch (error) {
    handleRouteError(error, res, "Erreur import stock");
  } finally {
    cleanupUploadedFile(uploadedPath);
  }
});

// Decision 1 de Thomas (24/09) : un import de ventes ne touche plus une
// commande deja PRETE, EN TOURNEE ou LIVREE. Mesure de l'audit : une ligne
// visant une commande en tournee remplacait ses produits (3 Changes + 3 Aleses
// devenaient 8 Changes, chez le livreur aussi), sans un mot ; et le stock
// devenait faux, la reservation ayant ete deduite sur les ANCIENS produits
// alors que releaseOrderStockReservation rend les NOUVEAUX. La commande est
// laissee telle quelle (produits, quantites, adresse, empreinte) et le resume
// dit pourquoi. Rend la raison, ou null si l'import peut la mettre a jour.
//
// « Partie en tournee » : Probleme et A reprogrammer n'existent qu'apres une
// tournee ; le carton est prepare et le stock deduit, comme pour une prete.
//
// Stock deja RESERVE (relecture adverse du 24/09) : la preparation lancee, la
// commande terrain (reservee des sa creation), la planifiee confirmee. La
// reservation a ete deduite sur CES produits : les reecrire, c'est la meme
// derive (annulee, une commande terrain rendait 8 Changes et jamais ses 3
// Aleses). Meme regle que la modification a la main : « Impossible de
// modifier les produits apres reservation du stock ».
//
// Chasse aux defauts du 24/09 (lot « donnees clients », 25/09) : seul un bon
// IMPORTE, encore a preparer, suit le fichier. Restaient reecrites : la
// preparation lancee SANS reservation (PATCH de statut -- l'ecart nomme du lot
// pieges), la commande annulee, et surtout les commandes SAISIES dans Sereo --
// la commande terrain acceptee « bloquee » sans reservation (decision 11 du
// 24/09) devenait un autre produit en gardant son ancien total ; une
// planifiee (ou celle d'un abonnement) changeait avant sa confirmation. Le
// fichier Ximi n'en est pas la source : elles gardent ce qui a ete saisi.
function raisonImportIgnore(db, order) {
  if (order.status === "livre") return "livree";
  if (order.status === "en_livraison" || tourneeActiveDeLaCommande(db, order.id)) return "en_tournee";
  if (order.status === "pret_livraison") return "prete";
  if (STATUTS_A_RELIVRER.includes(order.status)) return "partie_en_tournee";
  if (["en_preparation", "preparation_terminee"].includes(order.status)) return "en_preparation";
  if (order.stockReservedAt) return "stock_reserve";
  if (order.status === "annulee") return "annulee";
  if (order.source === "commande_terrain") return "saisie_terrain";
  if (order.source === "commande_planifiee" || order.subscriptionId) return "planifiee";
  return null;
}

app.post("/api/import/ventes", requireAdministration, uploadExcel, async (req, res) => {
  const uploadedPath = req.file?.path;

  // M2 (revue) : compteur des quantites Excel negatives silencieusement
  // clampees a 0. Expose dans la reponse pour traceability (audit) - une
  // qty negative dans Ximi est souvent un retour/avoir, le clamp silencieux
  // pourrait masquer cette info metier.
  let clampedNegativeQtyCount = 0;
  // Positions Latitude/Longitude du fichier ignorees : (0,0), inversees, hors zone.
  let positionsImportRefusees = 0;

  try {
    const rows = await readExcelRows(uploadedPath);

    const headerIndex = findHeaderRowGroups(rows, [
      ["Client", "Nom client", "Client final"],
      ["Quantite", "Quantité", "Qte", "Qté"],
      ["Produit", "Nom", "Article"],
      ["Rue", "Adresse", "Adresse client"],
      ["Ville", "Commune"]
    ]);

    if (headerIndex === -1) {
      throw badRequest("Colonnes ventes non reconnues");
    }

    const headers = rows[headerIndex];
    const dataRows = rows.slice(headerIndex + 1);

    // Chantier 1 : wrap dans withWriteLock pour eviter les races avec
    // d'autres imports/PATCH concurrents.
    const response = await withWriteLock(async () => {
    const db = readDb();
    // Les lignes dont la colonne Secteur est remplie (fusion des fiches, 25/09).
    const ventesAvecSecteur = new Set();

    // Les colonnes de date du bon (25/09) : « Date », et les noms qu'un export
    // ou un tableur lui donne. Une date ECRITE mais illisible met la ligne en
    // erreur (elle datait le bon du jour de l'import) ; une cellule VIDE, ou
    // pas de colonne, garde le repli documente : le jour de l'import.
    const NOMS_DE_LA_DATE = ["Date", "Date facture", "Date de facture", "Date commande", "Date de commande", "Date de vente", "Date vente"];
    // Les lignes ECARTEES, par cause (chasse aux defauts du 24/09, 25/09) :
    // une quantite vide valait 1, une ligne sans client creait une commande
    // « Client sans nom », une date illisible datait le bon du jour de
    // l'import. Une ligne entierement vide (la fin d'une feuille) n'en est pas une.
    const lignesEnErreur = { sansClientNiProduit: 0, sansClient: 0, sansProduit: 0, sansQuantite: 0, dateIllisible: 0 };
    const adresseDeLaLigne = row => ({
      rue: clean(getCellByNames(row, headers, ["Rue", "Adresse", "Adresse client"])),
      codePostal: geocodage.normaliserCodePostal(getCellByNames(row, headers, ["Code Postal", "Code postal", "CP", "PostalCode"])),
      ville: normalizeCity(getCellByNames(row, headers, ["Ville", "Commune"]))
    });
    // Les bons INCOMPLETS du fichier (relecture adverse du 26/09) : une de
    // leurs lignes est en erreur -- quantite vide, produit absent -- alors que
    // son client et sa date se lisent. Jusqu'au 25/09 ces lignes etaient
    // importees (une quantite vide valait 1) : un bon deja importe avec elles,
    // remplace par ses seules lignes lisibles, perdait un produit, et sa
    // commande a preparer son montant. Un bon incomplet deja connu ne
    // remplace ni sa commande ni ses lignes de vente ; le resume dit pourquoi.
    // Un bon NOUVEAU est cree avec ses lignes lisibles (rien a proteger).
    // Une date illisible ne dit pas le bon : jusqu'au 25/09, la ligne allait
    // dans un bon date du jour de l'import, jamais dans celui-ci.
    const bonsIncomplets = new Set();
    const noterBonIncomplet = (row, client) => {
      const dateCell = getCellByNames(row, headers, NOMS_DE_LA_DATE);
      const dateCommandeIso = excelDateToIso(dateCell);
      if (clean(dateCell) !== "" && !dateCommandeIso) return;
      bonsIncomplets.add(cleDuBonDeLaVente({ client, ...adresseDeLaLigne(row), dateCommandeIso }));
    };

    const ventes = dataRows
      .map((row, index) => {
        if (!Array.isArray(row) || !row.some(cell => clean(cell) !== "")) return null;
        const codeProduit = clean(getCellByNames(row, headers, ["Code", "Reference", "Référence", "SKU"]));
        const nomProduit = clean(getCellByNames(row, headers, ["Nom", "Produit", "Article"]));
        const produitComplet = clean(getCell(row, headers, "Produit", 1));
        const client = clean(getCellByNames(row, headers, ["Client", "Nom client", "Client final"]));
        const aUnProduit = Boolean(codeProduit || nomProduit || produitComplet);
        if (!client) {
          lignesEnErreur[aUnProduit ? "sansClient" : "sansClientNiProduit"] += 1;
          return null;
        }
        if (!aUnProduit) {
          lignesEnErreur.sansProduit += 1;
          noterBonIncomplet(row, client);
          return null;
        }
        const celluleQuantite = getCellByNames(row, headers, ["Quantite", "Quantité", "Qte", "Qté"]);
        if (clean(celluleQuantite) === "" || !Number.isFinite(number(celluleQuantite, NaN))) {
          lignesEnErreur.sansQuantite += 1;
          noterBonIncomplet(row, client);
          return null;
        }
        const statutFacture = clean(getCell(row, headers, "Statut", 1));
        // ERP v1.9.0 : la date Excel devient le discriminant entre 2 bons de
        // commande du meme client. Format ISO pour permettre le tri et le
        // matching deterministe. excelDate (FR) reste pour le legacy affichage.
        const dateCell = getCellByNames(row, headers, NOMS_DE_LA_DATE);
        const dateCommandeIso = excelDateToIso(dateCell);
        if (clean(dateCell) !== "" && !dateCommandeIso) {
          lignesEnErreur.dateIllisible += 1;
          return null;
        }
        const date = excelDate(dateCell);
        const deliveryDate = normalizeDateInput(getCellByNames(row, headers, ["Date livraison", "Livraison", "Date de livraison"]));
        const rawQty = number(celluleQuantite, 0);
        const quantite = Math.max(0, rawQty);
        if (rawQty < 0) clampedNegativeQtyCount += 1;
        const cellulePrix = getCell(row, headers, "Prix unitaire", 1);
        const celluleHt = getCell(row, headers, "HT", 1);
        const celluleTtc = getCell(row, headers, "TTC", 1);
        const prixUnitaire = number(cellulePrix, 0);
        const ht = number(celluleHt, 0);
        const ttc = number(celluleTtc, 0);
        // Decision 7 (24/09) : le montant TTC de la ligne, SIGNE -- un avoir
        // (quantite et TTC negatifs) se soustrait. Un HT seul n'est pas un
        // TTC (null : la ligne ne compte pas). Sans HT ni TTC, le prix unitaire
        // par la quantite, comme avant.
        const lisible = cellule => clean(cellule) !== "" && Number.isFinite(number(cellule, NaN));
        const montantTtc = lisible(celluleTtc) ? number(celluleTtc, 0)
          : clean(celluleHt) !== "" ? null
            : lisible(cellulePrix) ? Math.round(number(cellulePrix, 0) * rawQty * 100) / 100
              : null;
        const telephone = clean(getCellByNames(row, headers, ["Telephone favori", "Téléphone favori", "Telephone", "Téléphone", "Mobile", "Phone"]));
        const reference = clean(getCell(row, headers, "Reference", 1));
        // La meme lecture que noterBonIncomplet : la meme cle de bon.
        const { rue, codePostal, ville } = adresseDeLaLigne(row);
        const secteurDuFichier = getCellByNames(row, headers, ["Secteur", "Sector"]);
        const secteur = deriveSector(ville, secteurDuFichier);
        const notes = clean(getCellByNames(row, headers, ["Notes", "Remarque", "Remarques"]));
        const priority = clean(getCellByNames(row, headers, ["Priorite", "Priorite livraison", "Priority"]));
        const lat = getCoordinateValue(getCellByNames(row, headers, ["Latitude", "Lat"]), -90, 90);
        const lng = getCoordinateValue(getCellByNames(row, headers, ["Longitude", "Lng"]), -180, 180);
        const id = crypto.randomUUID();
        if (clean(secteurDuFichier)) ventesAvecSecteur.add(id);

        return {
          id,
          codeProduit,
          produit: nomProduit || produitComplet,
          produitComplet,
          client,
          statutFacture,
          date,
          dateCommandeIso,
          quantite,
          prixUnitaire,
          ht,
          ttc,
          montantTtc,
          telephone,
          reference,
          codePostal,
          rue,
          ville,
          secteur,
          notes,
          priority,
          deliveryDate,
          lat,
          lng
        };
      })
      .filter(Boolean);
    // Les lignes EN ERREUR : ecartees, comptees (le resume de l'ecran dit
    // chaque cause). Le compte garde son nom : l'ecran le lit.
    const lignesIllisibles = Object.values(lignesEnErreur).reduce((total, n) => total + n, 0);

    // Les ventes FUSIONNENT elles aussi (25/09) : `db.ventes = ventes` effacait
    // celles de tout bon absent du fichier -- et le chiffre d'affaires qui en
    // venait. Un bon du fichier (client + date) remplace ses lignes ; les
    // autres restent. La fusion se fait APRES les commandes (26/09) : un bon
    // incomplet dont la commande est laissee telle quelle garde aussi ses lignes.
    // D'abord, figer le montant des commandes dont le CA vient encore des
    // ventes (migration du 25/09, idempotente) : la table va changer.
    figerMontantsImportes(db, "import des ventes");
    // Les cles de vente (cleDuBonDeLaVente) de chaque bon, hors du releve garde sur la fiche.
    const clesDesBons = new WeakMap();
    // Le montant TTC de chaque bon du fichier : { montant, lignes } (lignes : celles qui ont un TTC).
    const montantsDesBons = new WeakMap();
    const arrondi = n => Math.round(n * 100) / 100;
    let montantsRepris = 0;

    // ERP v1.9.0 : bucket par (client, dateCommande) au lieu de juste par client.
    // Chaque (client, date) = 1 bon de commande distinct. Multiples imports
    // d'un meme bon (meme client + meme date) = update du contenu, pas creation
    // de doublon (anti-doublon via excelRowHash).
    const todayIso = jourParis();
    const clientsMap = {};
    // Fusion (25/09) : chaque client du fichier retrouve sa fiche existante --
    // cle complete, sinon nom + code postal -- et la complete sans rien effacer.
    const cleClientDeLaVente = vente => clientKey({ nom: vente.client, rue: vente.rue, codePostal: vente.codePostal, ville: vente.ville });
    const indexFiches = indexerClientsExistants(db.clients, new Set(ventes.map(cleClientDeLaVente)));
    // Les fiches d'AVANT l'import, pour reconnaitre le bon d'une ancienne vente
    // (fusion des ventes, plus bas) : par cle complete quand une seule fiche la
    // porte ; et combien de fiches partagent un nom + code postal.
    const ficheAvantParCle = new Map();
    const fichesParSecondaire = new Map();
    db.clients.forEach(fiche => {
      const cle = clientKey(fiche);
      ficheAvantParCle.set(cle, ficheAvantParCle.has(cle) ? null : fiche.id);
      const secondaire = clientSecondaryKey(fiche);
      if (secondaire) fichesParSecondaire.set(secondaire, (fichesParSecondaire.get(secondaire) || 0) + 1);
    });
    // Les commandes ORPHELINES : leur fiche a disparu (un ancien import la
    // retirait ; la production en a une, du 03/06). Une fiche recreee par le
    // fichier reprend leur identifiant -- sinon la commande serait refaite en
    // double. Par nom normalise, une fiche au plus par identifiant.
    const idsDesFiches = new Set(db.clients.map(client => String(client.id)));
    const orphelines = new Map();
    db.commandes.forEach(order => {
      const nom = normalizeTextKey(order.clientName);
      if (order.clientId && !idsDesFiches.has(String(order.clientId)) && nom && !orphelines.has(nom)) orphelines.set(nom, order.clientId);
    });
    const idOrphelin = nom => {
      const id = orphelines.get(normalizeTextKey(nom));
      if (id !== undefined) orphelines.delete(normalizeTextKey(nom));
      return id;
    };

    ventes.forEach(vente => {
      const key = cleClientDeLaVente(vente);
      const trouvee = clientsMap[key]
        ? { fiche: clientsMap[key]._ficheExistante, parSecondaire: clientsMap[key]._parSecondaire }
        : trouverFicheExistante(indexFiches, key, clientSecondaryKey({ nom: vente.client, codePostal: vente.codePostal }));
      const existingClient = trouvee.fiche || {};
      // Fallback : si la ligne Excel n'a pas de Date, on bucket avec la date du
      // jour (l'utilisateur peut quand meme avoir importe quelque chose hors
      // contexte de bon de commande date). C'est rare en pratique.
      const dateCommande = vente.dateCommandeIso || todayIso;
      const venteFactureLivree = isFactureStatusLivre(vente.statutFacture);

      if (!clientsMap[key]) {
        // Relecture du lot 3 : la position du fichier ne remplace jamais une
        // position placee a la main (M8), et elle passe le meme controle
        // qu'une saisie (M5) : (0,0), inversee ou hors zone, elle est ignoree.
        const manuelle = existingClient.geoSource === "manuel" && Boolean(getCoordinates(existingClient));
        const positionFichier = vente.lat !== "" && vente.lng !== "";
        const fichierRefuse = positionFichier && !geocodage.verifierPosition({ lat: vente.lat, lng: vente.lng }).ok;
        if (fichierRefuse) positionsImportRefusees += 1;
        const prendFichier = positionFichier && !manuelle && !fichierRefuse;
        clientsMap[key] = {
          // Fusion (25/09) : la fiche existante d'abord -- identifiant, email,
          // prenom, preferences, source, statut CRM, archivage... --, puis ce
          // que le fichier dit. Une cellule vide ne remplace rien.
          ...existingClient,
          _ficheExistante: trouvee.fiche,
          _parSecondaire: trouvee.parSecondaire,
          id: existingClient.id || idOrphelin(vente.client) || crypto.randomUUID(),
          nom: vente.client || existingClient.nom || "Client sans nom",
          rue: valeurFusionnee(vente.rue, existingClient.rue),
          ville: valeurFusionnee(vente.ville, existingClient.ville),
          codePostal: valeurFusionnee(vente.codePostal, existingClient.codePostal),
          telephone: valeurFusionnee(vente.telephone, existingClient.telephone),
          statut: existingClient.statut || "restant",
          // Liste flat (legacy compat pour syncWorkflow et anciennes UIs)
          produits: [],
          lat: prendFichier ? vente.lat : (existingClient.lat || ""),
          lng: prendFichier ? vente.lng : (existingClient.lng || ""),
          // Lot 3 (audit geo) : l'origine et la precision de la position
          // suivent la position. Sans elles, une saisie manuelle redevenait
          // anonyme a chaque import, et le lot `forcer` pouvait l'ecraser.
          ...(prendFichier
            ? { geoSource: "import", geoPrecision: "manuel", geoCle: "", geoLibelle: "", geoAVerifier: "" }
            : {
              geoSource: existingClient.geoSource || "",
              geoPrecision: existingClient.geoPrecision || "",
              geoCle: existingClient.geoCle || "",
              geoLibelle: existingClient.geoLibelle || "",
              geoAVerifier: existingClient.geoAVerifier || ""
            }),
          // Le secteur se deduit de la ville (ou de la colonne Secteur) du
          // fichier ; sans l'une ni l'autre, celui de la fiche reste.
          secteur: vente.ville || ventesAvecSecteur.has(vente.id) ? vente.secteur : (existingClient.secteur || vente.secteur),
          deliveryDate: valeurFusionnee(vente.deliveryDate, existingClient.deliveryDate),
          notes: vente.notes || existingClient.notes || "",
          priority: vente.priority || existingClient.priority || "",
          // Multi-commandes : 1 entree par dateCommande pour ce client
          ordersByDate: {}
        };
      }

      // Bucket commande dans le client
      if (!clientsMap[key].ordersByDate[dateCommande]) {
        clientsMap[key].ordersByDate[dateCommande] = {
          dateCommande,
          deliveryDate: vente.deliveryDate,
          produits: [],
          factureLivree: venteFactureLivree
        };
      } else {
        // factureLivree d'une commande = AND de toutes ses lignes
        const order = clientsMap[key].ordersByDate[dateCommande];
        order.factureLivree = order.factureLivree && venteFactureLivree;
        if (!order.deliveryDate && vente.deliveryDate) order.deliveryDate = vente.deliveryDate;
      }
      const clesDuBon = clesDesBons.get(clientsMap[key].ordersByDate[dateCommande]) || new Set();
      clesDuBon.add(cleDuBonDeLaVente(vente));
      clesDesBons.set(clientsMap[key].ordersByDate[dateCommande], clesDuBon);
      // Le montant TTC du bon (decision 7), hors du releve garde sur la fiche.
      const montantDuBon = montantsDesBons.get(clientsMap[key].ordersByDate[dateCommande]) || { montant: 0, lignes: 0 };
      if (vente.montantTtc !== null) {
        montantDuBon.montant += vente.montantTtc;
        montantDuBon.lignes += 1;
      }
      montantsDesBons.set(clientsMap[key].ordersByDate[dateCommande], montantDuBon);

      // Agregation/dedup produit dans la commande (meme produit 2 lignes Excel = somme)
      const lineTotal = firstPositiveNumber(vente.ttc, vente.ht, vente.prixUnitaire * vente.quantite);
      const lineUnitPrice = firstPositiveNumber(
        vente.prixUnitaire,
        vente.quantite > 0 ? lineTotal / vente.quantite : 0
      );
      const newLine = {
        code: vente.codeProduit,
        nom: vente.produit,
        quantite: vente.quantite,
        prixUnitaire: lineUnitPrice,
        totalLigne: lineTotal
      };
      const newLineKey = productKey(newLine);
      const orderBucket = clientsMap[key].ordersByDate[dateCommande];
      const existingOrderLine = newLineKey
        ? orderBucket.produits.find(line => productKey(line) === newLineKey)
        : null;
      if (existingOrderLine) {
        existingOrderLine.quantite = number(existingOrderLine.quantite, 0) + number(newLine.quantite, 0);
        existingOrderLine.totalLigne = Math.round((number(existingOrderLine.totalLigne, 0) + number(newLine.totalLigne, 0)) * 100) / 100;
        existingOrderLine.prixUnitaire = existingOrderLine.quantite > 0
          ? Math.round((existingOrderLine.totalLigne / existingOrderLine.quantite) * 100) / 100
          : number(existingOrderLine.prixUnitaire, 0);
      } else {
        orderBucket.produits.push({ ...newLine });
      }

      // Maintenance de la liste flat (sum sur toutes commandes confondues du client)
      const flatExistingLine = newLineKey
        ? clientsMap[key].produits.find(line => productKey(line) === newLineKey)
        : null;
      if (flatExistingLine) {
        flatExistingLine.quantite = number(flatExistingLine.quantite, 0) + number(newLine.quantite, 0);
        flatExistingLine.totalLigne = Math.round((number(flatExistingLine.totalLigne, 0) + number(newLine.totalLigne, 0)) * 100) / 100;
        flatExistingLine.prixUnitaire = flatExistingLine.quantite > 0
          ? Math.round((flatExistingLine.totalLigne / flatExistingLine.quantite) * 100) / 100
          : number(flatExistingLine.prixUnitaire, 0);
      } else {
        clientsMap[key].produits.push({ ...newLine });
      }
    });

    const importedClients = Object.values(clientsMap);
    const mergedImport = mergeImportedClients(db, importedClients);
    db.clients = mergedImport.clients;

    // ERP v1.9.0 : creation/mise a jour des commandes par (client, dateCommande).
    // 3 chemins :
    //   1. Hash strict match -> noop (re-import identique = idempotent)
    //   2. Match (clientId, dateCommande) -> update produits, preserve status/workflow
    //   3. Nouveau (client, date) -> nouvelle commande avec numero genere
    let createdCount = 0;
    let updatedCount = 0;
    let skippedIdenticalCount = 0;
    let importedAsLivreCount = 0;
    // Decision 1 (24/09) : les commandes laissees telles quelles, et pourquoi.
    const ignorees = [];
    // Les bons dont les lignes de vente restent telles quelles (bons incomplets deja connus).
    const bonsFiges = new Set();

    importedClients.forEach(client => {
      Object.values(client.ordersByDate || {}).forEach(orderData => {
        const hash = computeOrderHash({
          clientId: client.id,
          dateCommande: orderData.dateCommande,
          products: orderData.produits
        });

        // Chemin 1 : hash strict = meme contenu, re-import identique idempotent
        const sameHashOrder = db.commandes.find(o => o.excelRowHash && o.excelRowHash === hash);
        const bon = montantsDesBons.get(orderData) || { montant: 0, lignes: 0 };
        if (sameHashOrder) {
          sameHashOrder.updatedAt = new Date().toISOString();
          skippedIdenticalCount += 1;
          // Memes produits, memes quantites (l'empreinte ignore les montants) :
          // le montant TTC du fichier fait foi -- un avoir ajoute au bon dans
          // Ximi se soustrait. Le resume compte les montants qui changent.
          if (bon.lignes > 0) {
            const avant = getOrderTotal(sameHashOrder);
            sameHashOrder.montantTtc = arrondi(bon.montant);
            if (avant !== 0 && avant !== sameHashOrder.montantTtc) montantsRepris += 1;
          }
          return;
        }

        // Chemin 2 : (clientId, dateCommande) = meme bon mais contenu modifie
        const sameKeyOrder = db.commandes.find(o =>
          String(o.clientId) === String(client.id) &&
          o.dateCommande === orderData.dateCommande
        );
        if (sameKeyOrder) {
          // Deja prete, en tournee ou livree : on n'y touche pas (decision 1).
          // Surtout pas le chemin 3 : ce serait une commande en double.
          // Un bon INCOMPLET dans le fichier (une ligne en erreur) non plus :
          // ses seules lignes lisibles feraient sortir un produit de la
          // commande (relecture adverse du 26/09). Ses ventes restent aussi.
          const clesDuBon = [...(clesDesBons.get(orderData) || [])];
          const incomplet = clesDuBon.some(cle => bonsIncomplets.has(cle));
          if (incomplet) clesDuBon.forEach(cle => bonsFiges.add(cle));
          const raison = raisonImportIgnore(db, sameKeyOrder) || (incomplet ? "ligne_en_erreur" : null);
          if (raison) {
            ignorees.push({
              id: sameKeyOrder.id,
              numero: sameKeyOrder.numero || "",
              clientName: sameKeyOrder.clientName || client.nom,
              status: sameKeyOrder.status,
              raison
            });
            return;
          }
          sameKeyOrder.products = normalizeProducts(orderData.produits);
          sameKeyOrder.excelRowHash = hash;
          // Le montant TTC du bon, fige (0 : aucune ligne n'a de TTC).
          sameKeyOrder.montantTtc = arrondi(bon.montant);
          sameKeyOrder.updatedAt = new Date().toISOString();
          // Sync coordonnees client (peuvent avoir change). lat/lng client manuel
          // (PATCH /api/clients/:id/coordinates) deja merge dans client.lat/lng.
          sameKeyOrder.address = client.rue || sameKeyOrder.address;
          sameKeyOrder.city = client.ville || sameKeyOrder.city;
          sameKeyOrder.postalCode = client.codePostal || sameKeyOrder.postalCode;
          sameKeyOrder.sector = client.secteur || sameKeyOrder.sector;
          sameKeyOrder.phone = client.telephone || sameKeyOrder.phone;
          // Lot 3 : une commande livree garde la position de sa livraison.
          if (client.lat !== "" && client.lng !== "" && !STATUTS_COMMANDE_CLOSE.has(sameKeyOrder.status)) {
            sameKeyOrder.lat = client.lat;
            sameKeyOrder.lng = client.lng;
            sameKeyOrder.geoPrecision = client.geoPrecision || "";
            sameKeyOrder.geoSource = "client";
          }
          updatedCount += 1;
          return;
        }

        // Chemin 3 : nouvelle commande. generateOrderNumber doit voir les
        // commandes deja pushees pour ne pas re-utiliser un numero.
        const newOrder = normalizeOrder({
          clientId: client.id,
          clientName: client.nom,
          address: client.rue,
          city: client.ville,
          postalCode: client.codePostal,
          sector: client.secteur,
          phone: client.telephone,
          products: orderData.produits,
          lat: client.lat,
          lng: client.lng,
          geoPrecision: client.lat !== "" ? client.geoPrecision || "" : "",
          geoSource: client.lat !== "" ? "client" : "",
          notes: client.notes,
          priority: client.priority,
          dateCommande: orderData.dateCommande,
          deliveryDate: orderData.deliveryDate || "",
          dateImport: new Date().toISOString(),
          excelRowHash: hash,
          // Le montant TTC du bon, fige (0 : aucune ligne n'a de TTC).
          montantTtc: arrondi(bon.montant),
          numero: generateOrderNumber(db, orderData.dateCommande),
          status: orderData.factureLivree ? "livre" : "stock_a_verifier",
          deliveryStatus: orderData.factureLivree ? "livre" : "restant",
          preparationStatus: orderData.factureLivree ? "terminee" : "a_preparer",
          importedAsLivre: orderData.factureLivree
        });
        // Id deterministe via numero : evite la collision cmd-${clientId} qui
        // ecrasait l'ancienne commande quand un meme client commandait 2x.
        newOrder.id = `cmd-${newOrder.numero.toLowerCase()}`;
        db.commandes.push(newOrder);
        createdCount += 1;
        if (orderData.factureLivree) importedAsLivreCount += 1;
      });
    });

    // Les ventes, maintenant que les commandes sont decidees.
    //
    // Le bon d'une ANCIENNE vente suit la meme identite que sa commande : la
    // fiche et la date (relecture adverse du 26/09). Sa cle (adresse complete +
    // date) ne suffit plus quand l'adresse change dans Ximi (« 3 rue X »
    // devient « 3 bis rue X », la ville s'ecrit autrement) : la fiche et la
    // commande se retrouvaient (nom + code postal), mais les anciennes lignes
    // de chaque bon restaient et les nouvelles s'y ajoutaient, pour toujours.
    // Une ancienne vente prend la cle du bon du fichier quand sa fiche est SURE
    // des deux cotes : une seule fiche porte son adresse complete, et le
    // fichier rattache son bon de meme date a cette fiche par la cle complete
    // ou par un nom + code postal qu'aucune autre fiche ne partage. Sinon (un
    // homonyme au meme code postal), sa cle reste la sienne, comme avant.
    const ficheSureDuFichier = vente => {
      const entree = clientsMap[cleClientDeLaVente(vente)];
      const fiche = entree?._ficheExistante;
      if (!fiche) return null;
      if (!entree._parSecondaire) return fiche.id;
      return fichesParSecondaire.get(clientSecondaryKey(fiche)) === 1 ? fiche.id : null;
    };
    const bonDuFichierParFiche = new Map();
    ventes.forEach(vente => {
      const id = ficheSureDuFichier(vente);
      if (id) bonDuFichierParFiche.set(`${id}|${vente.dateCommandeIso || ""}`, cleDuBonDeLaVente(vente));
    });
    const cleDeLAncienne = vente => {
      const id = ficheAvantParCle.get(cleClientDeLaVente(vente));
      return (id && bonDuFichierParFiche.get(`${id}|${vente.dateCommandeIso || ""}`)) || cleDuBonDeLaVente(vente);
    };
    // Un bon incomplet qui a deja des lignes les garde (meme sans commande :
    // purgee, par exemple).
    const bonsDesVentes = new Set((Array.isArray(db.ventes) ? db.ventes : []).map(cleDeLAncienne));
    bonsIncomplets.forEach(cle => { if (bonsDesVentes.has(cle)) bonsFiges.add(cle); });
    const fusionVentes = fusionnerVentes(db.ventes, ventes, bonsFiges, cleDeLAncienne);
    db.ventes = fusionVentes.ventes;

    // Pas de syncWorkflow ici (25/09) : writeDb le fait, et rien d'ici la ne
    // lit ce qu'il calcule (les comptes du message sont deja faits).
    // Les comptes de la fusion des fiches (regle de Thomas : created / updated / preserved).
    const clientsImport = { created: mergedImport.created, updated: mergedImport.updated, preserved: mergedImport.preserved };
    const fichesMessage = `, fiches clients : ${clientsImport.created} creee(s), ${clientsImport.updated} mise(s) a jour, ${clientsImport.preserved} absente(s) du fichier conservee(s)`;
    const ventesGardeesMessage = fusionVentes.gardees > 0
      ? `, ${fusionVentes.gardees} vente(s) d'autres bons conservee(s)`
      : "";
    const montantsMessage = montantsRepris > 0
      ? `, ${montantsRepris} montant(s) TTC repris du fichier (bon identique, avoir ou correction)`
      : "";
    const mergedMessage = mergedImport.mergedBySecondary > 0
      ? `, ${mergedImport.mergedBySecondary} doublon(s) client(s) fusionne(s) par cle secondaire`
      : "";
    const livreMessage = importedAsLivreCount > 0
      ? `, ${importedAsLivreCount} commande(s) importee(s) comme deja livree(s) (statut facture Envoyee)`
      : "";
    const commandeStats = `${createdCount} commande(s) creee(s), ${updatedCount} mise(s) a jour, ${skippedIdenticalCount} identique(s) ignoree(s)`;
    const clampedMessage = clampedNegativeQtyCount > 0
      ? `, ⚠ ${clampedNegativeQtyCount} quantite(s) negative(s) clampee(s) a 0 (verifier retours/avoirs Ximi)`
      : "";
    const positionsMessage = positionsImportRefusees > 0
      ? `, ${positionsImportRefusees} position(s) du fichier ignoree(s) (0,0, inversee ou hors zone)`
      : "";
    const ignoreesMessage = ignorees.length > 0
      ? `, ${ignorees.length} commande(s) laissee(s) telle(s) quelle(s) (${ignorees.map(i => `${i.numero || i.id} : ${i.raison}`).join(", ")})`
      : "";
    const causesDesErreurs = [
      [lignesEnErreur.sansClientNiProduit, "sans client ni produit"],
      [lignesEnErreur.sansClient, "sans client"],
      [lignesEnErreur.sansProduit, "sans produit"],
      [lignesEnErreur.sansQuantite, "sans quantite lisible"],
      [lignesEnErreur.dateIllisible, "sans date lisible"]
    ].filter(([n]) => n > 0).map(([n, cause]) => `${n} ${cause}`).join(", ");
    const illisiblesMessage = lignesIllisibles > 0
      ? `, ${lignesIllisibles} ligne(s) en erreur ecartee(s) (${causesDesErreurs})`
      : "";
    addHistory(
      db,
      "Import ventes",
      `${ventes.length} vente(s) importee(s), ${importedClients.length} client(s) detecte(s), ${commandeStats}${ignoreesMessage}${illisiblesMessage}${fichesMessage}${ventesGardeesMessage}${montantsMessage}${mergedMessage}${livreMessage}${clampedMessage}${positionsMessage}`,
      {
        fichier: req.file.originalname
      }
    );

    // v1.12.0 : archivage du fichier Excel brut pour retelechargement futur
    const archive = archiveImportFile(req, db, "ventes", {
      // Les lignes DU FICHIER (la table des ventes, fusionnee, en garde d'autres).
      rowsCount: ventes.length,
      clientsCount: importedClients.length,
      created: createdCount,
      updated: updatedCount,
      skippedIdentical: skippedIdenticalCount,
      ignored: ignorees.length,
      lignesIllisibles,
      lignesEnErreur,
      importedAsLivre: importedAsLivreCount,
      mergedBySecondary: mergedImport.mergedBySecondary,
      clientsImport,
      montantsRepris
    });

    writeDb(db);

    return {
      success: true,
      ventes: db.ventes,
      clients: db.clients,
      commandes: db.commandes,
      secteurs: getSectors(db),
      mergedBySecondary: mergedImport.mergedBySecondary,
      // Fusion des fiches (25/09) : aucune n'est retiree ; `preserved` compte
      // celles que le fichier ne cite pas, laissees telles quelles.
      clientsImport,
      // Decision 7 : bons identiques dont le montant TTC du fichier a change (un avoir).
      montantsRepris,
      importedAsLivre: importedAsLivreCount,
      created: createdCount,
      updated: updatedCount,
      skippedIdentical: skippedIdenticalCount,
      // Decision 1 (24/09) : le resume de l'ecran lit ces comptes, plus
      // `commandes.length` (toute la base : « 12 elements » pour 3 lignes).
      ignored: ignorees.length,
      ignorees,
      lignesIllisibles,
      // Chaque cause (25/09) : l'ecran les dit une par une.
      lignesEnErreur,
      clampedNegativeQuantities: clampedNegativeQtyCount,
      positionsRefusees: positionsImportRefusees,
      archive
    };
    }); // fin withWriteLock
    res.json(response);

    // V8 phase 2 : geocodage des nouveaux clients, APRES avoir repondu.
    //
    // Volontairement non attendu. Un import de 50 clients inconnus prendrait
    // plusieurs secondes de reseau, et l'utilisateur n'a aucune raison de
    // patienter devant un ecran fige pour un traitement dont il n'a pas besoin
    // immediatement. La reponse est deja partie ; le rendu suivant montrera les
    // clients geolocalises.
    //
    // Le catch est indispensable : sans lui, un echec deviendrait un rejet non
    // gere, que Node signale bruyamment et qui peut faire tomber le processus
    // selon la configuration.
    declencherGeocodageEnFond("import ventes");
  } catch (error) {
    handleRouteError(error, res, "Erreur import ventes");
  } finally {
    cleanupUploadedFile(uploadedPath);
  }
});

/**
 * Lance un geocodage en tache de fond, sans jamais propager d'erreur.
 *
 * Un seul lot a la fois : `geocodageEnCours` evite que deux imports rapproches
 * lancent deux series d'appels concurrents vers la BAN, ce qui doublerait la
 * cadence et pourrait nous faire passer pour un robot abusif.
 */
let geocodageEnCours = false;

// Declenchement automatique apres import. Actif par defaut en production, mais
// coupable par variable d'environnement — les tests le desactivent, car des
// tests qui appellent une API publique sont lents, dependants du reseau, et
// impolis envers un service gratuit. Le lancement MANUEL, lui, reste toujours
// disponible via POST /api/geocodage/lancer.
const GEOCODAGE_AUTO = cleanEnv(process.env.SEREO_GEOCODAGE_AUTO) !== "0";

// Une demande pendant un lot n'est plus perdue : un client cree ou demenage
// pendant le lot serait sinon reste sans position jusqu'au prochain import.
let geocodageARelancer = false;

function declencherGeocodageEnFond(origine) {
  if (!GEOCODAGE_AUTO || !useSqliteStorage()) return;
  if (geocodageEnCours) {
    geocodageARelancer = true;
    return;
  }

  geocodageEnCours = true;
  geocodageARelancer = false;
  // Hors du contexte de la requete qui l'a declenche (relecture adverse du
  // 24/09) : le lot suit ses `await` et la file d'ecriture, et la ligne
  // « N client(s) geolocalise(s) automatiquement » du journal etait signee du
  // compte qui avait modifie une fiche -- relance comprise, meme quand un autre
  // compte l'avait provoquee. Un lot de fond est « automatique ».
  contexteRequete.exit(() => geocoderClients())
    .then(bilan => {
      if (bilan.traites > 0) {
        console.log(
          `[geocodage] ${origine} : ${bilan.appliques}/${bilan.traites} client(s) geolocalise(s)`
            + (bilan.tronque ? ` (${bilan.candidats} candidats, lot plafonne)` : "")
        );
      }
    })
    .catch(error => {
      console.error(`[geocodage] ${origine} : echec du lot —`, error.message);
    })
    .finally(() => {
      geocodageEnCours = false;
      if (geocodageARelancer) declencherGeocodageEnFond(`${origine} (relance)`);
    });
}

// v1.12.0 : liste des fichiers Excel archives lors des imports passes.
// Tries du plus recent au plus ancien. Inclut metadata (taille, sha256, stats)
// mais pas le contenu binaire du fichier (recupere via GET /:id/download).
app.get("/api/imports/archives", (req, res) => {
  const db = readDb();
  const archives = (db.importsArchives || []).slice();
  const typeFilter = clean(req.query.type || "").toLowerCase();
  const filtered = typeFilter
    ? archives.filter(a => String(a.type).toLowerCase() === typeFilter)
    : archives;
  filtered.sort((a, b) => String(b.importedAt || "").localeCompare(String(a.importedAt || "")));
  res.json(filtered);
});

// v1.12.0 : telechargement d'un fichier Excel archive. Verifie que l'id est
// connu en DB et que le fichier existe encore sur disque (peut etre purge
// manuellement par le sysadmin).
app.get("/api/imports/archives/:id/download", requireAdministration, (req, res) => {
  try {
    const db = readDb();
    const archive = (db.importsArchives || []).find(a => String(a.id) === String(req.params.id));

    if (!archive) {
      throw notFound("Archive introuvable");
    }

    if (!archive.archivedPath || !fs.existsSync(archive.archivedPath)) {
      throw notFound("Fichier archive supprime du disque");
    }

    res.download(archive.archivedPath, archive.filename || "import.xlsx");
  } catch (error) {
    handleRouteError(error, res, "Erreur telechargement archive");
  }
});

// v1.12.0 : purge des bons de commande pour repartir propre (utile apres
// une migration ou pour effacer des imports cassés). Supprime commandes,
// clients, ventes et routes (cascades logiques), mais PRESERVE :
// - stock (catalogue produits + quantites manuelles)
// - stockMovements (historique des ajustements stock)
// - historique evenements (audit)
// - importsArchives (l'historique des fichiers reste accessible)
// - settings (themes, palette, etc.)
//
// La purge laisse l'utilisateur pouvoir reimporter ses Excel originaux
// depuis Parametres -> Historique imports -> Telecharger.
//
// Garde-fous (25/09, decisions 5 et 6) :
// - reservee a l'administration (requireAdministration) ;
// - precedee, SOUS le verrou d'ecriture (rien ne change entre la copie et
//   l'effacement), d'une sauvegarde « avant-purge-commandes » HORS rotation,
//   coherente et relue (ecrireSauvegardeVerifiee) ;
// - la sauvegarde relue doit contenir EXACTEMENT les lignes que la purge
//   efface (commandes, clients, ventes, tournees : memes comptes, memes
//   identifiants) ; sinon, ou si elle echoue, la purge est refusee (503) et
//   rien n'est efface.
// La base est lue APRES l'attente de la sauvegarde : une ligne d'historique
// ecrite pendant la copie (addHistoryEntry, hors verrou) n'est pas perdue.
const TABLES_PURGEES = ["commandes", "clients", "ventes", "routes"];

function refusDePurge(message) {
  const error = new Error(`Purge refusée : ${message} Rien n'a été effacé.`);
  error.refusDePurge = true;
  return error;
}

app.post("/api/orders/purge", requireAdministration, async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      if (readDb().subscriptions.length) throw badRequest("La purge est désactivée en présence d’abonnements pour préserver les fiches clients et leurs échéances.");

      let sauvegarde;
      try {
        // Sans la copie vers le second dossier : elle se fait apres le verrou
        // (plus bas). Relecture du 26/09 : un partage reseau lent ou bloque
        // suspendait, sous ce verrou, toutes les ecritures des autres comptes.
        sauvegarde = await sauvegardeSeule(() => ecrireSauvegardeVerifiee(GENRE_AVANT_PURGE_COMMANDES, { tables: TABLES_PURGEES, copie: false }));
      } catch (error) {
        lastBackupError = { at: new Date().toISOString(), message: String(error.message || error) };
        throw refusDePurge(`la sauvegarde d'avant purge a échoué (${error.message || error}).`);
      }
      if (!sauvegarde) throw refusDePurge("aucune sauvegarde n'a pu être écrite.");
      if (useSqliteStorage()) {
        const actuel = getSqliteStore().releverTables(TABLES_PURGEES);
        const ecarts = TABLES_PURGEES.filter(table => sauvegarde.comptes[table] !== actuel.comptes[table]
          || sauvegarde.empreintes[table] !== actuel.empreintes[table]);
        if (ecarts.length) throw refusDePurge(`la sauvegarde ${sauvegarde.nom} ne contient pas exactement ce qui serait effacé (${ecarts.join(", ")}).`);
      }

      const db = readDb();
      const purgedCounts = {
        commandes: db.commandes.length,
        clients: db.clients.length,
        ventes: db.ventes.length,
        routes: db.routes.length
      };

      // Lot 5 (audit 2026-07-08) : liberer les reservations de stock AVANT de
      // supprimer les commandes. reserveStockForOrder (start-preparation) deduit
      // physiquement les quantites ; sans release, purger les commandes laisse
      // le stock ampute sans aucune commande pour le justifier -> inventaire
      // sous-compte a vie (l'historique disait pourtant "Stock preserve").
      //
      // Revue #89 : on ne restitue QUE les commandes dont la marchandise est
      // encore en entrepot. Une commande 'livre' (consommee) ou 'en_livraison'
      // (dans le camion) a physiquement quitte le stock -> la restituer
      // sur-compterait l'inventaire. On filtre sur le STATUT et pas seulement sur
      // stockReservedAt : des commandes 'livre' legacy/importees peuvent avoir
      // garde stockReservedAt non nul (le nullify-a-la-livraison est recent).
      const CONSUMED_STATUSES = new Set(["livre", "en_livraison"]);
      let stockReservationsReleased = 0;
      db.commandes.forEach(order => {
        if (CONSUMED_STATUSES.has(order.status)) return;
        if (releaseOrderStockReservation(db, order, "purge")) stockReservationsReleased += 1;
      });

      // Un numero attribue ne revient jamais (lot « stock », 24/09).
      retenirNumerosAttribues(db);
      db.commandes = [];
      db.clients = [];
      db.ventes = [];
      db.routes = [];

      addHistory(
        db,
        "Purge",
        `Reset bons de commande : ${purgedCounts.commandes} commande(s), ${purgedCounts.clients} client(s), ${purgedCounts.ventes} vente(s), ${purgedCounts.routes} tournee(s) supprimees. ${stockReservationsReleased} reservation(s) de stock restituee(s). Catalogue stock et historique preserves. Sauvegarde d'avant purge (hors rotation) : ${sauvegarde.nom}`,
        { ...purgedCounts, stockReservationsReleased, sauvegarde: sauvegarde.nom }
      );

      writeDb(db);
      return { purgedCounts, sauvegarde: sauvegarde.nom, chemin: sauvegarde.chemin, sha256: sauvegarde.sha256 };
    });
    // La copie vers le second dossier, verrou rendu : la decision de purger ne
    // l'attend pas (une copie qui echoue ne fait jamais echouer une
    // sauvegarde), et les ecritures des autres non plus. Une sauvegarde a la
    // fois (sauvegardeSeule) ; la reponse ne l'attend pas.
    sauvegardeSeule(() => copierVersSecondDossier(result.chemin, result.sha256)).catch(() => {});
    res.json({
      success: true,
      purged: result.purgedCounts,
      sauvegarde: result.sauvegarde,
      message: "Bons de commande purges. Re-importez vos Excel depuis Parametres > Historique imports."
    });
  } catch (error) {
    if (error && error.refusDePurge) {
      console.error(`[purge] ${error.message}`);
      res.status(503).json({ error: error.message });
      return;
    }
    handleRouteError(error, res, "Erreur purge bons");
  }
});

app.patch("/api/stock/:id", refuserAuLivreur, async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const product = db.stock.find(p => String(p.id) === String(req.params.id));

      if (!product) {
        throw notFound("Produit introuvable");
      }

      const body = req.body || {};
      const hasQuantity = Object.prototype.hasOwnProperty.call(body, "quantite");
      const thresholdField = ["alertThreshold", "stockMinimum", "seuilMinimum", "seuil_minimum"]
        .find(field => Object.prototype.hasOwnProperty.call(body, field));
      const hasThreshold = Boolean(thresholdField);

      if (!hasQuantity && !hasThreshold) {
        throw badRequest("Aucune modification stock fournie");
      }

      const oldQuantity = getStockQuantity(product) ?? 0;
      let quantityChanged = false;
      let thresholdChanged = false;
      let oldThreshold = getStockAlertThreshold(product);
      let nextThreshold = oldThreshold;

      if (hasQuantity) {
        const nextQuantity = Number(String(body.quantite ?? "").replace(",", "."));

        if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
          throw badRequest("Quantite invalide");
        }

        setStockQuantity(product, nextQuantity);
        quantityChanged = product.quantite !== oldQuantity;
        recordStockMovement(db, product, oldQuantity, product.quantite, body.reason);
      }

      if (hasThreshold) {
        nextThreshold = parseStockAlertThresholdInput(body[thresholdField]);
        product.alertThreshold = nextThreshold;
        product.stockMinimum = nextThreshold;
        product.seuilMinimum = nextThreshold;
        thresholdChanged = nextThreshold !== oldThreshold;
      }

      // Pas de syncWorkflow ici (25/09) : writeDb le fait. Le refaire doublait
      // l'ajustement de stock (2,3 s -> 0,5 s a dix fois la base).
      if (quantityChanged) {
        addHistory(db, "Stock", `${product.nom} : stock ${oldQuantity} -> ${product.quantite}`, {
          produitId: product.id,
          ancienStock: oldQuantity,
          nouveauStock: product.quantite
        });
      }
      if (thresholdChanged) {
        addHistory(db, "Stock", `${product.nom} : seuil minimum ${oldThreshold} -> ${nextThreshold}`, {
          produitId: product.id,
          ancienSeuil: oldThreshold,
          nouveauSeuil: nextThreshold
        });
      }

      writeDb(db);
      // Chantier 2 (revue R1 P1 #1) : passer l'index pre-calcule pour
      // garder le O(1) sur l'enrichissement post-mutation. Sans index,
      // /api/stock/:id PATCH retombait en O(N) sur chaque appel.
      const stockIndex = buildStockMetricsIndex(db.commandes);
      return enrichStockItem(db, product, stockIndex);
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur modification stock");
  }
});

// PATCH /api/clients/:id : mise a jour partielle des champs metier d'un client
// (rue, codePostal, ville, telephone, notes). Utilise par "Modifier le profil"
// depuis le detail d'une commande.
//
// Lot 3 de l'audit geo (H5, H12, decision 8 de Thomas, 23/09) :
// - une commande LIVREE ou annulee n'est plus jamais reecrite (historique) ;
// - l'adresse ne suit que sur les commandes qui se livraient a l'ANCIENNE
//   adresse du client : une commande livree ailleurs (EHPAD, proche) garde la
//   sienne (demenagerClient) ;
// - la position de l'ancienne adresse est effacee et recalculee en fond ;
// - une consigne propre a une commande n'est pas ecrasee par celle du client.
app.patch("/api/clients/:id", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const client = db.clients.find(c => String(c.id) === String(req.params.id));

      if (!client) {
        throw notFound("Client introuvable");
      }

      const avant = adresseDuClient(client);
      const notesAvant = clean(client.notes);
      const telephoneAvant = clean(client.telephone);
      const updates = {};
      if (req.body.nom !== undefined) updates.nom = clean(req.body.nom);
      if (req.body.rue !== undefined) updates.rue = clean(req.body.rue);
      // Garde-fous de saisie (24/09) : le formulaire du detail de commande
      // renvoie TOUS ses champs ; une valeur deja en base qui revient telle
      // quelle est gardee (meme invalide, elle est signalee a l'ecran), une
      // nouvelle doit etre juste.
      if (req.body.codePostal !== undefined) updates.codePostal = saisie.codePostalSaisi(req.body.codePostal, client.codePostal, badRequest);
      if (req.body.ville !== undefined) {
        const newVille = normalizeCity(clean(req.body.ville));
        updates.ville = newVille;
        const explicitSector = req.body.secteur !== undefined ? clean(req.body.secteur) : "";
        updates.secteur = deriveSector(newVille, explicitSector);
      }
      if (req.body.telephone !== undefined) updates.telephone = saisie.telephoneSaisi(req.body.telephone, client.telephone, badRequest);
      if (req.body.notes !== undefined) updates.notes = clean(req.body.notes);

      Object.assign(client, updates);
      client.updatedAt = new Date().toISOString();

      const cleAvant = cleGeocodage(avant);
      const suivent = new Set(
        db.commandes
          .filter(order => commandeSuitLeClient(order, client, cleAvant))
          .map(order => String(order.id))
      );
      const demenagement = demenagerClient(db, client, avant);

      const matchingOrders = db.commandes.filter(o =>
        String(o.clientId) === String(client.id) && !STATUTS_COMMANDE_CLOSE.has(o.status)
      );
      const now = new Date().toISOString();
      matchingOrders.forEach(order => {
        if (updates.nom !== undefined) order.clientName = updates.nom;
        // Comme la consigne : le telephone d'une commande livree ailleurs
        // (EHPAD, proche) est le sien. Seul celui qui etait le numero du client
        // (ou vide) suit ; le formulaire renvoie le telephone a chaque
        // enregistrement, meme quand seules les notes changent.
        if (updates.telephone !== undefined
          && (!clean(order.phone) || clean(order.phone) === telephoneAvant)) {
          order.phone = updates.telephone;
        }
        if (updates.notes !== undefined && suivent.has(String(order.id))
          && (!clean(order.notes) || clean(order.notes) === notesAvant)) {
          order.notes = updates.notes;
        }
        // Une ville changee sans changer la cle (casse, accent) : le secteur suit.
        if (updates.ville !== undefined && suivent.has(String(order.id))) order.sector = updates.secteur;
        order.updatedAt = now;
      });

      addHistory(db, "Client", `${client.nom} : profil mis a jour`, {
        clientId: client.id,
        champsModifies: Object.keys(updates),
        commandesDeplacees: demenagement.commandes
      });

      writeDb(db);
      return { client, ordersUpdated: matchingOrders.length, demenagement };
    });
    res.json(result);
    if (result.demenagement.demenage) declencherGeocodageEnFond("modification client");
  } catch (error) {
    handleRouteError(error, res, "Erreur mise a jour client");
  }
});

/**
 * Lit une position saisie : { lat, lng } en nombres ou en texte ("46,75"), ou
 * un seul champ `position` colle depuis une carte ("46.7512, 5.9123").
 */
function lirePositionSaisie(body = {}) {
  const colle = clean(body.position);
  if (colle) {
    // "46.7512, 5.9123", "46,7512 ; 5,9123", "46.75 5.91" : deux nombres.
    const nombres = colle.match(/-?\d+(?:[.,]\d+)?/g) || [];
    if (nombres.length === 2) return { lat: nombres[0], lng: nombres[1] };
    return { lat: "x", lng: "x" };
  }
  return { lat: body.lat, lng: body.lng };
}

const PRECISIONS_SAISIES = new Set(["numero", "rue", "lieu-dit", "commune", "manuel"]);

// Saisie d'une position par une personne : une proposition acceptee, un
// resultat de recherche choisi, un marqueur deplace, ou deux nombres. Elle est
// marquee "manuelle" et aucun traitement automatique ne l'ecrasera (M8).
// Elle n'atteint que les commandes qui se livrent a l'adresse du client (H12).
app.patch("/api/clients/:id/coordinates", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const client = db.clients.find(c => String(c.id) === String(req.params.id));

      if (!client) {
        throw notFound("Client introuvable");
      }

      const saisie = lirePositionSaisie(req.body);
      const lat = parseCoordinate(saisie.lat, -90, 90);
      const lng = parseCoordinate(saisie.lng, -180, 180);

      if (!lat.ok || !lng.ok) {
        throw badRequest(`Coordonnées invalides pour ${client.nom}.`);
      }

      const efface = lat.value === "" || lng.value === "";
      if (!efface) {
        // M5 : (0,0), latitude et longitude inversees, hors zone : refuses,
        // avec le nom du client et, pour l'inversion, la correction.
        const verdict = geocodage.verifierPosition({ lat: lat.value, lng: lng.value });
        if (!verdict.ok) {
          throw Object.assign(
            badRequest(`Position refusée pour ${client.nom} : ${verdict.message}.`),
            { details: { code: verdict.code, corrigee: verdict.corrigee || null } }
          );
        }
      }

      const precision = PRECISIONS_SAISIES.has(clean(req.body.precision)) ? clean(req.body.precision) : "manuel";
      appliquerPositionClient(db, client, efface
        ? { lat: "", lng: "" }
        : { lat: lat.value, lng: lng.value, source: "manuel", precision, libelle: clean(req.body.libelle).slice(0, 300) });

      addHistory(db, "Coordonnees", `${client.nom} : coordonnees mises a jour`, {
        clientId: client.id,
        lat: client.lat,
        lng: client.lng
      });

      writeDb(db);
      return client;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur coordonnees");
  }
});

// H7 : l'ecran "Adresses a verifier".
app.get("/api/adresses/a-verifier", (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(listerAdressesAVerifier(readDb(), { inclure: clean(req.query.client) }));
  } catch (error) {
    handleRouteError(error, res, "Erreur adresses a verifier");
  }
});

app.post("/api/orders/:id/replan", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const replanned = replanOrder(db, req.params.id, req.body || {});
      writeDb(db);
      return replanned;
    });
    res.status(201).json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur replanification");
  }
});

app.post("/api/orders/:id/start-preparation", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = findOrder(db, req.params.id);

      if (["planifiee", "a_confirmer"].includes(order.status)) {
        throw badRequest("Confirme la commande planifiee avant de lancer la preparation");
      }
      // Lot 2 : pas en preparation tant qu'elle attend dans une tournee.
      refuserSiDansUneTournee(db, order, "la remettre en préparation");
      reserveStockForOrder(db, order);
      setOrderStatus(order, "en_preparation");

      addHistory(db, "Preparation", `${order.clientName} : preparation demarree`, {
        orderId: order.id,
        clientId: order.clientId
      });

      writeDb(db);
      return order;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur preparation");
  }
});

app.post("/api/orders/:id/finish-preparation", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = findOrder(db, req.params.id);

      if (!["en_preparation", "preparation_terminee", "pret_livraison"].includes(order.status)) {
        throw badRequest("La commande doit etre en preparation avant validation");
      }

      setOrderStatus(order, "pret_livraison");
      order.deliveryDate = normalizeDateInput(req.body?.deliveryDate) || order.deliveryDate || jourParis();

      addHistory(db, "Preparation", `${order.clientName} : pret pour livraison`, {
        orderId: order.id,
        clientId: order.clientId,
        deliveryDate: order.deliveryDate
      });

      writeDb(db);
      return order;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur fin preparation");
  }
});

app.patch("/api/orders/:id", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = findOrder(db, req.params.id);

      if (req.body.notes !== undefined) order.notes = clean(req.body.notes);
      if (req.body.priority !== undefined) order.priority = clean(req.body.priority);
      if (req.body.sector !== undefined) order.sector = deriveSector(order.city, req.body.sector);
      if (req.body.deliveryDate !== undefined) {
        order.deliveryDate = normalizeDateInput(req.body.deliveryDate);
        retirerDesTourneesSiReportee(db, order);
      }
      if (req.body.status !== undefined) {
        // Lot 2 : une commande d'une tournee active ne change pas d'etat ici
        // (« pret_livraison -> en_preparation » passait, et la tournee ne
        // demarrait plus). Le meme statut reste accepte (rien ne change).
        if (clean(req.body.status) !== order.status) refuserSiDansUneTournee(db, order, "changer son statut");
        if (clean(req.body.status) === "annulee" && order.stockReservedAt) {
          releaseOrderStockReservation(db, order, "order_cancelled");
        }
        // Lot « stock » (24/09) : la meme transition que « Passer en
        // preparation » (POST /start-preparation) sort le stock du rayon.
        // Avant, « en_preparation » puis « livre » par cette route livraient
        // la commande sans rien sortir (rayon 10 au lieu de 6). Un rayon qui
        // ne couvre pas la commande refuse (400), comme le geste de l'ecran.
        if (commandeQuiPartEnPreparation(order, clean(req.body.status))) {
          reserveStockForOrder(db, order);
        }
        // Un « livre » d'ici sur une commande dont le stock a ete libere :
        // la reservation est reprise, comme sur l'arret (reprendreStockLibere).
        // Apres la transition verifiee : un refus ne touche pas au rayon.
        if (clean(req.body.status) === "livre" && order.status !== "livre" && isValidOrderStatusTransition(order.status, "livre")) {
          reprendreStockLibere(db, order, "écran Commandes");
        }
        setOrderStatus(order, req.body.status);
        if (order.status === "annulee") annulerRappelsDeLaCommande(db, order);
      }

      order.updatedAt = new Date().toISOString();
      writeDb(db);
      return order;
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur commande");
  }
});

// Chantier 1 (2026-06-04) : endpoint admin explicite pour LIBERER la reservation
// de stock d'une commande en `probleme_livraison` ou `a_reprogrammer`. Pattern
// ERP standard (Odoo, ERPNext) : la liberation n'est jamais auto sur ces
// statuts (livraison echouee = relivraison sous 24-72h sur meme stock). Mais
// l'admin doit pouvoir le decider explicitement quand la commande n'est plus
// reprogrammable.
//
// Reponse : { released: bool, lines: number, reason: string }
app.post("/api/orders/:id/release-stock", async (req, res) => {
  try {
    const reason = clean(req.body?.reason) || "manual_release";
    const result = await withWriteLock(async () => {
      const db = readDb();
      const order = findOrder(db, req.params.id);

      if (!order.stockReservedAt) {
        return { released: false, lines: 0, reason: "no_reservation", message: "Aucune reservation active sur cette commande" };
      }
      if (!["probleme_livraison", "a_reprogrammer"].includes(order.status)) {
        throw badRequest("La liberation manuelle de stock est reservee aux commandes en probleme_livraison ou a_reprogrammer");
      }

      const released = releaseOrderStockReservation(db, order, reason);
      order.updatedAt = new Date().toISOString();

      writeDb(db);
      return { released, lines: released ? 1 : 0, reason, order };
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur liberation stock");
  }
});

// Lot 7 : au-dela de 50 commandes, une proposition de decoupage en tournees de
// 50 au plus, par direction depuis le depart (lib/routing.js). Rien n'est ecrit.
app.post("/api/routes/decoupage", (req, res) => {
  try {
    const ids = new Set((Array.isArray(req.body.orderIds) ? req.body.orderIds : []).map(String));
    const selected = getDeliverableOrders(readDb(), {}).filter(o => ids.has(String(o.id)));
    // Les commandes « a livrer en premier » partent dans la premiere tournee.
    const premiers = Array.isArray(req.body.premiers) ? req.body.premiers.map(String) : [];
    const groupes = routing.decouperEnTournees(selected, req.body.departure, 50, premiers);
    res.json({ max: 50, groupes: groupes.map(groupe => groupe.map(o => String(o.id))) });
  } catch (error) {
    handleRouteError(error, res, "Erreur decoupage tournee");
  }
});

app.post("/api/routes", async (req, res) => {
  try {
    let plan = null;
    // Lot 7 : les commandes « a livrer en premier », parmi celles de la tournee.
    const premiers = (Array.isArray(req.body.premiers) ? req.body.premiers : []).map(String);
    let orderIds = req.body.orderIds;
    // Lot 5 (audit geo, 23/09) : le calcul « sans depart » (vol d'oiseau) avait
    // ni selection exigee ni plafond : {} prenait TOUTES les commandes pretes,
    // et 2 000 commandes figeaient le serveur 17 s sous le verrou d'ecriture.
    // Meme regle que le calcul routier : une selection de 1 a 50 commandes.
    const ids = Array.isArray(req.body.orderIds) ? req.body.orderIds : [];
    if (!ids.length || ids.length > MAX_COMMANDES_PAR_TOURNEE) {
      throw badRequest(`Sélectionne entre 1 et ${MAX_COMMANDES_PAR_TOURNEE} commandes par tournée.`);
    }
    if (req.body.departure || req.body.arrival) {
      if (!Array.isArray(req.body.orderIds) || !req.body.orderIds.length) throw badRequest("Sélectionne les commandes de la tournée.");
      const snapshot = readDb();
      const ids = new Set((req.body.orderIds || []).map(String));
      // Lot 2 : AVANT le calcul routier (plusieurs secondes), et en nommant la
      // commande : « Certaines commandes ne sont plus prêtes » ne disait pas
      // laquelle, et une commande deja dans une tournee prete passait ici.
      refuserCommandesHorsTournee(snapshot, [...ids], { sector: req.body.sector, city: req.body.city, deliveryDate: req.body.deliveryDate });
      const selected = getDeliverableOrders(snapshot, req.body).filter(o => ids.has(String(o.id)) && STATUTS_A_PLANIFIER.includes(o.status));
      if (selected.length !== ids.size) throw badRequest("Certaines commandes ne sont plus prêtes.");
      // H6 : la position du client vaut pour ses commandes livrees chez lui ;
      // le reste passe par le geocodeur partage (cache, meme seuil).
      const enPremier = new Set(premiers);
      plan = await routing.roadPlan(
        selected.map(o => ({ ...positionPourTournee(snapshot, o), livrerEnPremier: enPremier.has(String(o.id)) })),
        req.body.departure, req.body.arrival, snapshot.settings.tournee.stopDurationMin, false,
        { geocoder: geocoderAdresse, retirerInjoignables: req.body.retirerInjoignables === true }
      );
      // Un arret injoignable par la route, retire a la demande : sa commande
      // reste « prete », hors de cette tournee, et la reponse le nomme.
      const retires = new Set((plan.injoignablesRetires || []).map(o => String(o.id)));
      if (retires.size) orderIds = req.body.orderIds.filter(id => !retires.has(String(id)));
    }
    const route = await withWriteLock(async () => {
      const db = readDb();
      const r = createRoute(db, {
        sector: req.body.sector,
        city: req.body.city,
        deliveryDate: req.body.deliveryDate,
        orderIds,
        premiers,
        plan
      });

      addHistory(db, "Tournee", `${r.stops.length} arret(s) ajoutes a la tournee ${r.sector}`, {
        routeId: r.id,
        sector: r.sector
      });

      writeDb(db);
      return r;
    });
    res.status(201).json(plan?.injoignablesRetires ? { ...route, injoignablesRetires: plan.injoignablesRetires } : route);
  } catch (error) {
    handleRouteError(error, res, "Erreur creation tournee");
  }
});

app.post("/api/routes/:id/start", async (req, res) => {
  try {
    const route = await withWriteLock(async () => {
      const db = readDb();
      const r = startRoute(db, req.params.id);

      addHistory(db, "Tournee", `${r.stops.length} arret(s) en livraison`, {
        routeId: r.id
      });

      writeDb(db);
      return r;
    });
    res.json(route);
  } catch (error) {
    handleRouteError(error, res, "Erreur demarrage tournee");
  }
});

// Lot 2 de l'audit geo (H8) : annuler une tournee prete, cloturer une tournee
// en cours. L'ecran demande une confirmation explicite pour les deux ; le
// serveur n'en suppose aucune et garde ses propres refus (etat de la tournee).
app.post("/api/routes/:id/annuler", async (req, res) => {
  try {
    const route = await withWriteLock(async () => {
      const db = readDb();
      const r = annulerTournee(db, req.params.id);
      if (r.deja) return routeAvecTrace(db, r.route.id) || r.route;
      addHistory(db, "Tournee", `${nomDeTournee(r.route)} annulée : ${r.commandes.length} commande(s) rendue(s) aux commandes prêtes`, {
        routeId: r.route.id,
        orderIds: r.commandes.map(order => order.id),
        par: getRequestIdentity(req)?.identifiant || ""
      });
      writeDb(db);
      return routeAvecTrace(db, r.route.id) || r.route;
    });
    res.json(route);
  } catch (error) {
    handleRouteError(error, res, "Erreur annulation tournee");
  }
});

app.post("/api/routes/:id/cloturer", async (req, res) => {
  try {
    const route = await withWriteLock(async () => {
      const db = readDb();
      const r = cloturerTournee(db, req.params.id);
      if (r.deja) return routeAvecTrace(db, r.route.id) || r.route;
      const noms = r.commandes.map(order => order.clientName).filter(Boolean);
      addHistory(db, "Tournee", `${nomDeTournee(r.route)} clôturée : ${noms.length ? `${noms.join(", ")} à reprogrammer` : "aucun arrêt restant"}`, {
        routeId: r.route.id,
        orderIds: r.commandes.map(order => order.id),
        par: getRequestIdentity(req)?.identifiant || ""
      });
      writeDb(db);
      return routeAvecTrace(db, r.route.id) || r.route;
    });
    res.json(route);
  } catch (error) {
    handleRouteError(error, res, "Erreur cloture tournee");
  }
});

// M2 : « Corriger le statut » d'un arret deja traite. Un geste a part, avec sa
// cause : jamais un « Livre » ou un « Absent » rejoue sur un arret solde.
app.post("/api/routes/:routeId/stops/:stopId/correction", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const par = getRequestIdentity(req)?.identifiant || "";
      const r = corrigerArret(db, req.params.routeId, req.params.stopId, req.body || {}, par);
      addHistory(db, "Correction", `${r.stop.clientName} : ${libelleStatutArret(r.avant)} → ${libelleStatutArret(r.stop.status)} — ${r.cause}`, {
        routeId: r.route.id,
        stopId: r.stop.id,
        orderId: r.order.id,
        de: r.avant,
        vers: r.stop.status,
        par
      });
      writeDb(db);
      return etatApresGesteArret(db, r);
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur correction statut");
  }
});

// La liste des motifs vient du SERVEUR. La dupliquer dans le client ferait deux
// verites qui derivent : le client proposerait un motif que le serveur refuse,
// et l'ecart ne se verrait qu'au premier refus, sur le telephone d'un livreur.
app.get("/api/delivery-problems", (req, res) => {
  res.json({
    // `proposes` : les statuts pour lesquels le dialogue montre ce motif (par
    // defaut, tous ceux qu'il admet). Decision 10 : voir MOTIFS_PROBLEME.
    motifs: [...MOTIFS_PROBLEME.entries()].map(([cle, m]) => ({
      cle, libelle: m.libelle, statutsAdmis: m.statutsAdmis, proposes: m.proposes || m.statutsAdmis
    }))
  });
});

app.patch("/api/routes/:routeId/stops/:stopId", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const r = updateRouteStop(db, req.params.routeId, req.params.stopId,
        req.body.status, req.body.notes, req.body.motif, req.body.faitLe, req.body.remisA);
      // Le meme geste deux fois : rien n'a change, rien a ecrire (lot 2).
      if (r.inchange) return etatApresGesteArret(db, r);

      // La cause DANS le libelle : l'historique est le seul endroit ou une
      // tournee passee se relit, et un statut sans sa cause n'y apprend rien.
      const cause = r.stop.status !== "livre" && r.stop.problemReason ? ` — ${r.stop.problemReason}` : "";
      // Decision 10 : « remis a… » s'y lit aussi.
      const remis = r.stop.status === "livre" && r.stop.remisA ? ` — remis à ${r.stop.remisA}` : "";
      const tard = r.retard ? " (geste fait avant la clôture de la tournée)" : "";
      addHistory(db, "Livraison", `${r.stop.clientName} : ${r.stop.status}${cause}${remis}${tard}`, {
        routeId: r.route.id,
        stopId: r.stop.id,
        orderId: r.order.id,
        ...(r.stop.status === "livre" && r.stop.remisA ? { remisA: r.stop.remisA } : {})
      });

      writeDb(db);
      return etatApresGesteArret(db, r);
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur statut livraison");
  }
});

app.patch("/api/routes/:id/reorder", async (req, res) => {
  try {
    const route = await withWriteLock(async () => {
      const db = readDb();
      const r = reorderRouteStops(db, req.params.id, req.body.stopIds);

      addHistory(db, "Tournee", "Ordre de tournee modifie", {
        routeId: r.id
      });

      writeDb(db);
      // Lot 5 : la forme normalisee, celle de la liste (mise a jour ciblee).
      return routeAvecTrace(db, r.id) || r;
    });
    res.json(route);
  } catch (error) {
    handleRouteError(error, res, "Erreur ordre tournee");
  }
});

// Revue R1 P1 #7+#8 : depuis Phase 2 ERP, un client peut avoir PLUSIEURS
// commandes actives. L'ancien code ne mettait a jour que la 1re trouvee, et
// retournait 200 meme quand aucune commande n'etait trouvee (silent failure).
// Maintenant :
// - on cherche TOUTES les commandes du client en cours de livraison
// - si aucune trouvee mais le client existe : 200 avec ordersUpdated:0
// - on retourne le compte des commandes mises a jour pour traçabilite
app.post("/api/livraison", async (req, res) => {
  try {
    const result = await withWriteLock(async () => {
      const db = readDb();
      const { clientId, statut, orderId } = req.body;

      if (!DELIVERY_STATUSES.has(statut)) {
        throw badRequest("Statut livraison invalide");
      }

      const c = db.clients.find(x => String(x.id) === String(clientId));
      if (!c) {
        throw notFound("Client introuvable");
      }

      // Filtre des commandes a affecter :
      // - si orderId est fourni : juste cette commande (precis)
      // - sinon : TOUTES les commandes actives (non-livre, non-archived) du client
      const candidateOrders = orderId
        ? db.commandes.filter(item => String(item.id) === String(orderId) && String(item.clientId) === String(clientId))
        : db.commandes.filter(item =>
            String(item.clientId) === String(clientId)
            && !["livre"].includes(item.status)
          );
      // Relecture adverse du lot 2 (M7) : une commande qui attend son arret
      // dans une tournee active ne se livre que par cet arret. Avant, ce
      // chemin la passait « livre » et l'arret restait « en livraison » : la
      // tournee ne se terminait jamais.
      for (const order of candidateOrders) {
        const tournee = tourneeActiveDeLaCommande(db, order.id);
        if (tournee) {
          throw conflit(`La commande ${nomDeCommande(order)} attend son arrêt dans la tournée « ${nomDeTournee(tournee)} » : marque-la depuis l'écran Tournée.`);
        }
      }
      c.statut = statut;

      let ordersUpdated = 0;
      candidateOrders.forEach(order => {
        const targetStatus =
          statut === "livree" ? "livre"
          : statut === "en_cours" ? "en_livraison"
          : ["absent", "probleme", "non_livre"].includes(statut) ? "probleme_livraison"
          : null;
        if (targetStatus && isValidOrderStatusTransition(order.status, targetStatus)) {
          // Comme sur l'arret : une reservation liberee a la main est reprise.
          if (targetStatus === "livre" && order.status !== "livre") reprendreStockLibere(db, order, "livraison du client");
          setOrderStatus(order, targetStatus);
          ordersUpdated += 1;
        }
      });

      addHistory(db, "Livraison", `${c.nom} : ${statut} (${ordersUpdated} commande(s))`, {
        clientId,
        statut,
        ordersUpdated,
        orderId: orderId || null
      });

      writeDb(db);
      return { client: c, ordersUpdated, orderIds: candidateOrders.filter((_, i) => i < ordersUpdated).map(o => o.id) };
    });
    res.json(result);
  } catch (error) {
    handleRouteError(error, res, "Erreur livraison");
  }
});

// Garde-fous (25/09) : l'ancienne route POST /api/reset-tournee est retiree.
// Aucun ecran ni banc ne l'appelait (grep du 24/09), elle etait ouverte a toute
// session, remettait tous les clients a « restant » et tentait de repasser des
// commandes LIVREES en « pretes » -- sur une base sans commande livree, elle
// defaisait une tournee en cours (200 mesure). Une route d'ecriture qu'aucun
// ecran n'appelle ne sert qu'a un attaquant.

// Lot 2 de l'audit geo, decision 7 de Thomas (23/09) : l'ancienne route
// POST /api/optimize-route est retiree. Elle ordonnait les CLIENTS (et non les
// commandes) au plus proche voisin, et, appelee sans liste, REECRIVAIT l'ordre
// de toute la table des clients. Aucun ecran ni banc ne l'appelait (grep du
// 23/09) ; le calcul d'une tournee passe par POST /api/routes.

require("./lib/operations-api").registerOperations(app, {
  readDb, writeDb, withWriteLock, badRequest, notFound, handleRouteError, findClient,
  buildCustomerOrderLines, createPlannedOrder, addHistory, getOrderTotal,
  buildImportedSalesIndex, getImportedOrderTotal, normalizeDateInput,
  geocoderAdresse, positionPourTournee, memoriserPositionDuCalcul,
  // Lot 5 : la limite de debit du relais de recherche d'adresse, par compte et par IP.
  cleDeDebit: req => `${getRequestIdentity(req)?.identifiant || "anonyme"}|${getClientIp(req)}`,
  // Decision 8 (24/09) : pause ou arret d'un abonnement.
  suspendreCommandesDeLAbonnement
});

// Lot 6 de l'audit geo (pratique au quotidien) : reoptimiser, « Faire
// maintenant », « Ajouter a la tournee en cours ».
require("./lib/tournee-pratique").registerTourneePratique(app, {
  readDb, writeDb, withWriteLock, badRequest, notFound, handleRouteError, findClient, sansReleveDImport,
  addHistory, setOrderStatus, createStop, routeAvecTrace, positionPourTournee,
  memoriserPositionDuCalcul, geocoderAdresse, distanceKm: distance,
  statutsAPlanifier: STATUTS_A_PLANIFIER, maxArrets: MAX_COMMANDES_PAR_TOURNEE,
  // Integration de la vague 2 : la garde « deja dans une tournee active » du
  // lot 2, et ses noms, pour « Ajouter a la tournee en cours ».
  tourneeActiveDeLaCommande, nomDeCommande, nomDeTournee
});

// --- API des comptes utilisateurs (V8 phase 1) -----------------------------

/**
 * Identite de la requete en cours.
 *
 * Sert au front pour afficher qui est connecte et, le jour ou la separation
 * des roles sera activee, pour filtrer la navigation. `onglets` vaut "*" tant
 * que tout le monde voit tout.
 */
app.get("/api/me", (req, res) => {
  const identite = getRequestIdentity(req);
  if (!identite) {
    res.status(401).json({ error: "Connexion requise" });
    return;
  }

  res.json({
    identifiant: identite.identifiant,
    role: identite.role,
    roleLibelle: getRole(identite.role).libelle,
    administration: getRole(identite.role).administration,
    onglets: roleTabScope(identite.role),
    separationDesRoles: SEPARATION_DES_ROLES,
    // `source` distingue un compte en base d'un acces par variables
    // d'environnement : le second ne peut pas etre modifie depuis l'interface.
    source: identite.source,
    // Garde-fous (25/09) : a l'administration seulement (un autre compte n'a
    // pas a apprendre que le mot de passe d'administration est court).
    ...(getRole(identite.role).administration && motDePasseEnvironnementCourt()
      ? { motDePasseEnvironnementCourt: true }
      : {})
  });
});

/**
 * Reserve une route a l'administration de l'outil.
 *
 * Volontairement independant de la separation des onglets : meme quand tout le
 * monde voit tout, creer ou supprimer un compte reste une operation
 * d'administration, pas une tache du quotidien.
 */
function requireAdministration(req, res, next) {
  const identite = getRequestIdentity(req);
  if (!identite) {
    res.status(401).json({ error: "Connexion requise" });
    return;
  }

  if (!getRole(identite.role).administration) {
    res.status(403).json({ error: "Reserve aux administrateurs." });
    return;
  }

  req.identite = identite;
  next();
}

/**
 * Refuse une route au role « livreur » (garde-fous du 25/09) : la
 * modification directe du stock. Comme requireAdministration, independant de
 * la separation des onglets -- masquer un onglet ne garde rien.
 * La liste de toutes les routes d'ecriture et de leur garde :
 * test/garde-fous-routes.test.js (et DESIGN.md, garde-fous du 25/09).
 */
function refuserAuLivreur(req, res, next) {
  const identite = getRequestIdentity(req);
  if (!identite) {
    res.status(401).json({ error: "Connexion requise" });
    return;
  }
  if (String(identite.role) === "livreur") {
    res.status(403).json({ error: "Réservé au bureau et à la préparation." });
    return;
  }
  req.identite = identite;
  next();
}

// --- API du geocodage (V8 phase 2) -----------------------------------------

app.get("/api/geocodage/etat", (req, res) => {
  try {
    res.json(etatGeocodage());
  } catch (error) {
    handleRouteError(error, res, "Erreur etat du geocodage");
  }
});

/**
 * Lance un lot de geocodage.
 *
 * Peut durer plusieurs dizaines de secondes : la reponse n'arrive qu'une fois
 * le lot termine, et le front doit prevoir un etat d'attente. C'est assume —
 * une file de taches en arriere-plan serait disproportionnee pour un traitement
 * declenche a la main quelques fois par mois.
 */
app.post("/api/geocodage/lancer", async (req, res) => {
  try {
    // Deux lots en parallele doublaient les appels a la BAN et s'ecrasaient
    // l'un l'autre (audit geo, mesure du 23/09).
    if (geocodageEnCours) {
      throw Object.assign(badRequest("Un géocodage est déjà en cours. Réessaie dans une minute."), { statusCode: 409 });
    }
    geocodageEnCours = true;
    let bilan;
    try {
      bilan = await geocoderClients({
        forcer: req.body?.forcer === true,
        max: Number(req.body?.max) > 0 ? Number(req.body.max) : GEOCODER_MAX_PAR_LOT
      });
    } finally {
      geocodageEnCours = false;
      // Un client cree ou demenage pendant ce lot a demande un geocodage de
      // fond, refuse car un lot tournait : il est relance maintenant, comme
      // apres un lot de fond (relecture du lot 3).
      if (geocodageARelancer) declencherGeocodageEnFond("relance apres le lot manuel");
    }
    res.json(bilan);
  } catch (error) {
    handleRouteError(error, res, "Erreur geocodage");
  }
});

app.get("/api/comptes", requireAdministration, (req, res) => {
  try {
    res.json(listUserAccounts());
  } catch (error) {
    handleRouteError(error, res, "Erreur lecture des comptes");
  }
});

app.post("/api/comptes", requireAdministration, async (req, res) => {
  try {
    const compte = await createUserAccount({
      identifiant: req.body?.identifiant,
      motDePasse: req.body?.motDePasse,
      role: req.body?.role || DEFAULT_ROLE,
      actif: req.body?.actif === undefined ? true : Boolean(req.body.actif)
    });

    addHistoryEntry("Comptes", `Compte cree : ${compte.identifiant} (${compte.role})`);
    res.status(201).json(compte);
  } catch (error) {
    handleRouteError(error, res, "Erreur creation du compte");
  }
});

app.patch("/api/comptes/:id", requireAdministration, async (req, res) => {
  try {
    // On ne transmet que les champs REELLEMENT presents : updateUserAccount
    // distingue "absent" de "vide", et ne re-hashe le mot de passe que s'il a
    // ete explicitement fourni.
    const patch = {};
    if (req.body?.role !== undefined) patch.role = req.body.role;
    if (req.body?.actif !== undefined) patch.actif = Boolean(req.body.actif);
    if (req.body?.motDePasse !== undefined && req.body.motDePasse !== "") {
      patch.motDePasse = req.body.motDePasse;
    }

    const compte = await updateUserAccount(req.params.id, patch);
    // Son PROPRE mot de passe : ses sessions viennent d'etre fermees, celle-ci
    // comprise ; la reponse en ouvre une neuve (sinon le geste deconnecte).
    if (patch.motDePasse !== undefined && req.identite?.uid && String(req.identite.uid) === String(compte.id)) {
      res.setHeader("Set-Cookie", buildAuthCookie(createAccessSessionValue(Date.now(), compte), AUTH_COOKIE_MAX_AGE_SECONDS, req));
    }

    const details = [
      patch.role !== undefined ? `role=${patch.role}` : null,
      patch.actif !== undefined ? (patch.actif ? "reactive" : "desactive") : null,
      patch.motDePasse !== undefined ? "mot de passe change" : null
    ].filter(Boolean).join(", ");

    addHistoryEntry("Comptes", `Compte modifie : ${compte.identifiant}${details ? ` (${details})` : ""}`);
    res.json(compte);
  } catch (error) {
    handleRouteError(error, res, "Erreur modification du compte");
  }
});

app.delete("/api/comptes/:id", requireAdministration, (req, res) => {
  try {
    const store = getSqliteStore();
    const compte = store.getUser(req.params.id);
    deleteUserAccount(req.params.id);

    addHistoryEntry("Comptes", `Compte supprime : ${compte ? compte.identifiant : req.params.id}`);
    res.json({ ok: true });
  } catch (error) {
    handleRouteError(error, res, "Erreur suppression du compte");
  }
});

/**
 * Journalise une action dans l'historique applicatif.
 *
 * Les comptes vivant hors de readDb/writeDb, on relit la base uniquement pour
 * y ajouter la trace. Best-effort : une ecriture d'historique qui echoue ne
 * doit pas faire echouer l'operation deja effectuee.
 */
function addHistoryEntry(categorie, message) {
  try {
    const db = readDb();
    addHistory(db, categorie, message);
    writeDb(db);
  } catch (error) {
    console.error("[comptes] historique non ecrit :", error.message);
  }
}

// ============================================================================
// Lot 5 (audit geo, decision 5 de Thomas, 23/09) : PURGE DES TOURNEES ANCIENNES
// ============================================================================
//
// Les tournees terminees depuis plus de 12 mois partent, avec leurs arrets et
// leur trace (la position de depart du livreur y dort). Les COMMANDES restent :
// le chiffre d'affaires, les statistiques et l'historique des livraisons par
// client se calculent sur elles, pas sur les tournees.
//
// La purge efface pour de bon : elle ne part qu'APRES une sauvegarde forcee
// (« avant-purge », dans la rotation des sauvegardes), et pas du tout si cette
// sauvegarde echoue. Elle est journalisee dans l'historique.
//
// SEREO_PURGE_TOURNEES_MOIS : 12 par defaut ; 0 coupe la purge.
const PURGE_TOURNEES_MOIS = (() => {
  const brut = process.env.SEREO_PURGE_TOURNEES_MOIS;
  const n = Number(brut === undefined || brut === "" ? 12 : brut);
  return Number.isFinite(n) && n >= 0 ? n : 12;
})();
const PURGE_TOURNEES_INTERVALLE_MS = 24 * 60 * 60 * 1000;
// Lot 2 : une tournee cloturee ou annulee est finie : elle part apres 12 mois
// comme une terminee (sa date de fin : completedAt, pose aux deux gestes).
const STATUTS_TOURNEE_PURGEABLES = new Set(["terminee", "cloturee", "annulee"]);

/** La date ou la tournee s'est terminee, sinon celle de sa livraison, sinon de sa creation. */
function dateDeFinTournee(route) {
  for (const valeur of [route.completedAt, route.deliveryDate, route.createdAt]) {
    const t = Date.parse(valeur || "");
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}

function limiteDePurge(maintenant, mois) {
  const limite = new Date(maintenant);
  limite.setMonth(limite.getMonth() - mois);
  return limite;
}

function tourneesAPurger(db, maintenant = new Date(), mois = PURGE_TOURNEES_MOIS) {
  if (!(mois > 0)) return [];
  const limite = limiteDePurge(maintenant, mois).getTime();
  // Une tournee sans date lisible n'est jamais purgee : dans le doute, on garde.
  return db.routes.filter(route => STATUTS_TOURNEE_PURGEABLES.has(route.status) && dateDeFinTournee(route) < limite);
}

/**
 * Les tournees que contient une sauvegarde (.sqlite.gz), par identifiant, sous
 * la forme JSON que readDb leur donne. Decompression hors du fil principal,
 * copie de travail a cote de la sauvegarde (supprimee ensuite), ouverture en
 * lecture seule et integrity_check (lireTourneesDuFichier). Leve si le fichier
 * est illisible.
 */
async function tourneesDeLaSauvegarde(chemin) {
  const compresse = await fs.promises.readFile(chemin);
  const brut = await new Promise((resolve, reject) => {
    zlib.gunzip(compresse, { maxOutputLength: MAX_BACKUP_DECOMPRESSED_BYTES }, (error, sortie) => (error ? reject(error) : resolve(sortie)));
  });
  // Nommee comme celles du thread de sauvegarde : jamais prise pour une
  // sauvegarde (listBackupEntries), effacee au demarrage si elle reste.
  const copie = sauvegardeBase.fichiersDeTravail(chemin).verification;
  await fs.promises.writeFile(copie, brut);
  try {
    const routes = lireTourneesDuFichier(copie);
    return new Map(routes.filter(route => route && route.id !== undefined && route.id !== null)
      .map(route => [String(route.id), JSON.stringify(route)]));
  } finally {
    for (const suffixe of ["", "-wal", "-shm", "-journal"]) {
      try { fs.unlinkSync(copie + suffixe); } catch { /* absent : ok */ }
    }
  }
}

/**
 * @param sauvegarder  la sauvegarde a faire avant (injectable pour les tests) ;
 *                     doit rendre le chemin du fichier, ou lever. Le fichier
 *                     est RELU (tourneesDeLaSauvegarde) : un chemin ne suffit pas.
 * @returns {{ purgees: number, sauvegarde?: string, raison?: string }}
 */
async function purgerTourneesAnciennes({ maintenant = new Date(), mois = PURGE_TOURNEES_MOIS, sauvegarder = writeBackupNowAsync } = {}) {
  // Revue du 23/09 : la sauvegarde se fait HORS du verrou d'ecriture, comme les
  // sauvegardes automatiques de writeDb. Sous le verrou, les « Livre » des
  // livreurs attendaient la compression de toute la base (plusieurs dizaines
  // de Mo), chaque jour a l'heure du demarrage plus une minute.
  const candidates = tourneesAPurger(readDb(), maintenant, mois);
  if (!candidates.length) return { purgees: 0 };

  // Une sauvegarde automatique deja en vol lirait la base en meme temps : on
  // la laisse finir, puis la notre tient sa place (writeDb n'en lance pas
  // d'autre tant qu'elle court). Revue #84 : deux sauvegardes concurrentes.
  let sauvegarde = null;
  try {
    sauvegarde = await sauvegardeSeule(() => sauvegarder("avant-purge"));
  } catch (error) {
    console.error(`[purge] sauvegarde impossible, purge annulee : ${error.message || error}`);
    return { purgees: 0, raison: "sauvegarde impossible" };
  }
  if (!sauvegarde) {
    console.error("[purge] aucune sauvegarde ecrite, purge annulee");
    return { purgees: 0, raison: "sauvegarde impossible" };
  }

  // Garde-fous (25/09) : la sauvegarde est RELUE -- decompressee, ouverte,
  // integrity_check -- et chaque tournee comparee a ce qu'ELLE contient. Avant,
  // un chemin rendu suffisait : la comparaison se faisait a une photo prise en
  // memoire avant la copie, sur la foi d'une copie jamais relue (et qui pouvait
  // sortir dechiree). Une sauvegarde illisible : aucune purge.
  let sauvees;
  try {
    sauvees = await tourneesDeLaSauvegarde(String(sauvegarde));
  } catch (error) {
    console.error(`[purge] sauvegarde ${path.basename(String(sauvegarde))} illisible, purge annulee : ${error.message || error}`);
    return { purgees: 0, raison: "sauvegarde illisible" };
  }

  return withWriteLock(async () => {
    // Relue sous le verrou : les gestes faits pendant la sauvegarde restent.
    // Ne part qu'une tournee que la sauvegarde contient sous sa forme actuelle ;
    // une tournee modifiee entre-temps attend la purge du lendemain.
    const db = readDb();
    const cibles = tourneesAPurger(db, maintenant, mois)
      .filter(route => sauvees.get(String(route.id)) === JSON.stringify(route));
    if (!cibles.length) return { purgees: 0 };

    const ids = new Set(cibles.map(route => String(route.id)));
    const arrets = cibles.reduce((n, route) => n + (route.stops || []).length, 0);
    db.routes = db.routes.filter(route => !ids.has(String(route.id)));
    const limite = jourParis(limiteDePurge(maintenant, mois));
    const fichier = path.basename(String(sauvegarde));
    addHistory(db, "Purge", `${ids.size} tournée(s) terminée(s) avant le ${limite} supprimée(s), ${arrets} arrêt(s) — conservation ${mois} mois. Commandes et chiffre d'affaires intacts. Sauvegarde : ${fichier}`, {
      tournees: ids.size,
      arrets,
      limite,
      sauvegarde: fichier
    });
    writeDb(db, { backup: false });
    console.log(`[purge] ${ids.size} tournee(s) de plus de ${mois} mois supprimee(s) (sauvegarde ${fichier})`);
    return { purgees: ids.size, sauvegarde: fichier };
  });
}

function planifierPurgeDesTournees() {
  if (!(PURGE_TOURNEES_MOIS > 0)) return;
  const lancer = () => purgerTourneesAnciennes().catch(error => {
    console.error(`[purge] echec : ${error.message || error}`);
  });
  // Une minute apres le demarrage (le temps que le serveur reponde), puis chaque jour.
  const premier = setTimeout(lancer, 60 * 1000);
  const suivants = setInterval(lancer, PURGE_TOURNEES_INTERVALLE_MS);
  if (premier.unref) premier.unref();
  if (suivants.unref) suivants.unref();
}

function startServer(port = PORT, host = HOST) {
  // P1 v1.14.0 : healing initial pour garantir la coherence apres restart
  // (notamment apres restauration d'un backup ou montee de version)
  healDatabaseAtBoot();
  avertirMotDePasseCourt();
  nettoyerSauvegardesInterrompues();
  if (BACKUP_COPY_DIR) {
    nettoyerSauvegardesInterrompues(BACKUP_COPY_DIR);
    // Relecture du 26/09 : un disque qui n'est pas revenu apres un redemarrage
    // se dit des l'ouverture de la carte, pas a la premiere sauvegarde.
    verifierTemoinSecondDossier().catch(error => {
      if (!derniereCopie) derniereErreurCopie = { at: new Date().toISOString(), message: String(error.message || error) };
      console.warn(`[storage] second dossier : ${error.message || error}`);
    });
  }
  planifierPurgeDesTournees();
  const serveur = app.listen(port, host, () => {
    console.log(`Sereo lance sur http://${host}:${port}`);
    if (host === "0.0.0.0" || host === "::") {
      console.log("Acces reseau local active. A utiliser seulement sur un reseau de confiance.");
    }
  });
  // Carte OSRM locale : APRES l'ecoute, et sans l'attendre. demarrer() rend
  // la main tout de suite et ne jette jamais ; le travail lourd
  // (telechargement, preparation) tourne en arriere-plan et en processus fils.
  setImmediate(() => {
    try {
      osrmLocal.demarrer();
    } catch (error) {
      console.warn(`[osrm-local] ${error?.message || error}`);
    }
  });
  return serveur;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  // Lot 5 (audit geo) : purge des tournees anciennes
  purgerTourneesAnciennes,
  tourneesAPurger,
  rognerTraceGps,
  _healDatabaseAtBoot: healDatabaseAtBoot,
  dimancheDePaques,
  joursFeriesFrance,
  alerteDateNonOuvree,
  jourDuMoisRabattu,
  nextSectorDeliveryDate,
  decorerSecteurPourAffichage,
  startServer,
  // Calcul routier OSRM integre (23/09)
  _osrmLocal: osrmLocal,
  closeStorage,
  defaultDb,
  normalizeDb,
  readDb,
  writeDb,
  getRecommendations,
  productKey,
  clientSecondaryKey,
  isFactureStatusLivre,
  generateOrderNumber,
  computeOrderHash,
  extractYear,
  ensureOrderNumbers,
  normalizeSettings,
  normalizeCity,
  deriveSector,
  analyzeOrderStock,
  calculateReservedStock,
  calculateNeededStock,
  getStockStatus,
  getStockView,
  getDashboardSummary,
  getDeliverableOrders,
  createRoute,
  horodatageDuGeste,
  optimizeOrders,
  parseCoordinate,
  getCoordinates,
  parseBasicAuthHeader,
  isAuthorizedRequest,
  isAccessAuthEnabled,
  // Geocodage (V8 phase 2)
  cleGeocodage,
  adresseGeocodable,
  qualifierResultat,
  geocoderAdresse,
  geocoderClients,
  etatGeocodage,
  premiereCoordonnee,
  GEOCODAGE_STATUTS,
  // Lot 3 de l audit geo : des adresses justes
  listerAdressesAVerifier,
  getSqliteStoreForTests: () => getSqliteStore(),
  // Comptes utilisateurs (V8 phase 1)
  hashPassword,
  verifyPassword,
  generatePasswordSalt,
  ROLES,
  DEFAULT_ROLE,
  getRole,
  isKnownRole,
  roleAllowsTab,
  roleAllowsTabStrict,
  roleTabScope,
  SEPARATION_DES_ROLES,
  createUserAccount,
  updateUserAccount,
  deleteUserAccount,
  listUserAccounts,
  authenticateCredentials,
  getRequestIdentity,
  isEnvAuthConfigured,
  // Helpers de test : ne pas appeler depuis du code applicatif
  _resetAuthRateLimitForTest: () => { authRateLimitState.clear(); authCompteState.clear(); },
  // Garde-fous (25/09) : oublier les sessions fermees gardees en memoire, comme
  // un redemarrage (elles sont relues dans la base).
  _oublierRevocationsPourTest: () => { etatDesSessions = null; },
  _createAccessSessionValueForTest: createAccessSessionValue,
  _withWriteLockForTest: withWriteLock,
  _synchronisationsPourTest: () => synchronisations,
  _normalizeOrder: normalizeOrder,
  _getLastStorageRecovery: () => lastStorageRecovery,
  // Chantier 2 : permet aux tests d'attendre que le backup async finisse
  // avant d'assertioner sur le filesystem.
  _flushPendingBackup: flushPendingBackup,
  _resetStorageRecoveryForTest: () => { lastStorageRecovery = null; storageRecoveryFatal = null; backupsSuspendedFreshEmpty = false; lastBackupAt = null; lastBackupError = null; derniereModificationA = null; },
  // Carte « Sauvegardes » (24/09) : la regle de retention, pure.
  _sauvegardesAGarder: sauvegardesAGarder,
  // Garde-fous (25/09) : une vraie sauvegarde (coherente, relue), pour les
  // bancs qui injectent la sauvegarde d'avant purge.
  _sauvegarderPourTest: tag => writeBackupNowAsync(tag),
  _nettoyerSauvegardesInterrompues: nettoyerSauvegardesInterrompues,
  _reinitialiserLimiteSauvegardesPourTest: () => { sauvegardesManuelles.length = 0; },
  _isCorruptionError: isCorruptionError,
  _normalizeDateInput: normalizeDateInput,
  _excelDateToIso: excelDateToIso,
  _distance: distance,
  _number: number,
  _importQuantity: importQuantity,
  _estimateRouteMetrics: estimateRouteMetrics,
  _scanSuspiciousDates: scanSuspiciousDates,
  _getAuthRateLimitMaxAttempts: () => AUTH_RATE_LIMIT_MAX_ATTEMPTS,
  DB_PATH,
  SQLITE_PATH,
  STORAGE_ENGINE,
  UPLOAD_DIR,
  BACKUP_DIR,
  HOST
};

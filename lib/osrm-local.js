// Calcul routier OSRM integre a l'image Sereo (decision 2 revue, 23/09).
//
// L'image embarque les binaires OSRM (osrm-extract, -partition, -customize,
// -routed) et le profil voiture. Ce gestionnaire fait TOUT le reste, sans
// aucune manipulation sur le serveur :
//
// 1. Il choisit une zone selon la memoire et le disque (ZONES, plus bas) ;
//    SEREO_OSRM_ZONE la force, SEREO_OSRM_LOCAL=0 coupe tout.
// 2. Il telecharge les extraits Geofabrik (HTTPS, reprise d'un telechargement
//    interrompu, somme MD5 publiee par Geofabrik verifiee : un fichier faux
//    est refuse), les fusionne (osmium) s'il y en a plusieurs.
// 3. Il prepare la carte (extract -> partition -> customize, algorithme MLD)
//    en priorite basse (nice / ionice), dans un dossier de version A COTE de
//    la carte en service. Il ne bascule qu'apres un succes complet : le
//    pointeur `courante.json` est remplace par renommage (atomique). Un echec
//    garde l'ancienne carte, qui continue de servir.
// 4. Il lance osrm-routed sur 127.0.0.1:5000, le surveille et le relance
//    s'il meurt. Tant que la carte locale n'est pas prete (ou si elle tombe),
//    lib/routing.js garde le repli public du lot 7.
// 5. Il refait la carte chaque mois, la nuit (3 h, Europe/Paris), et supprime
//    les anciennes versions.
//
// Rien ici ne doit retarder le demarrage de Sereo ni le faire tomber :
// `demarrer()` rend la main tout de suite, chaque etape est rattrapee, et le
// travail lourd tourne dans des processus fils.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const GEOFABRIK = "https://download.geofabrik.de/";
const GO = 1024 ** 3;
const JOUR_MS = 24 * 3600 * 1000;

// Zones, de la plus grande a la plus petite. Geofabrik decoupe encore la
// France selon les ANCIENNES regions : la Bourgogne-Franche-Comte, c'est
// « bourgogne » + « franche-comte » ; le Grand Est, « alsace » + « lorraine »
// + « champagne-ardenne » ; Auvergne-Rhone-Alpes, « auvergne » +
// « rhone-alpes » ; Centre-Val de Loire, « centre ».
//
// Seuils : estimations PRUDENTES, non mesurees au-dela de Monaco (voir
// DESIGN.md). Taille des extraits le 22/09/2026 : France 5,1 Go ; les
// voisins 2,5 Go ; la region 0,33 Go. Memoire : osrm-extract monte a environ
// 2,5 fois la taille de l'extrait, plus Sereo et l'ancienne carte qui sert
// pendant la preparation. Disque : extraits + fusion + DEUX cartes (l'ancienne
// reste en service jusqu'a la bascule), une carte MLD pesant de l'ordre de 3
// fois l'extrait.
const ZONES = {
  france: {
    libelle: "France entière",
    extraits: ["europe/france"],
    memoire: 24 * GO,
    disque: 50 * GO,
  },
  voisins: {
    libelle: "Bourgogne-Franche-Comté, régions voisines et Suisse",
    extraits: [
      "europe/france/bourgogne",
      "europe/france/franche-comte",
      "europe/france/alsace",
      "europe/france/lorraine",
      "europe/france/champagne-ardenne",
      "europe/france/auvergne",
      "europe/france/rhone-alpes",
      "europe/france/centre",
      "europe/france/ile-de-france",
      "europe/switzerland",
    ],
    memoire: 12 * GO,
    disque: 30 * GO,
  },
  region: {
    libelle: "Bourgogne-Franche-Comté",
    extraits: ["europe/france/bourgogne", "europe/france/franche-comte"],
    memoire: 3 * GO,
    disque: 6 * GO,
  },
};
const ORDRE_DES_ZONES = ["france", "voisins", "region"];
const EXTRAIT_VALIDE = /^[a-z]+(\/[a-z0-9-]+)+$/;
const BINAIRES = ["osrm-extract", "osrm-partition", "osrm-customize", "osrm-routed"];

/**
 * Zone a preparer. `forcee` : SEREO_OSRM_ZONE (« france », « voisins »,
 * « region », « aucune », ou un ou plusieurs chemins Geofabrik separes par
 * des virgules, ex. « europe/monaco »). Sinon, la plus grande zone que la
 * memoire ET le disque permettent. Rend `null` (serveur public) avec une
 * raison.
 */
function choisirZone({ memoire, disque, forcee = "" }) {
  const voulu = String(forcee || "").trim().toLowerCase();
  if (voulu) {
    if (["0", "aucune", "non", "public"].includes(voulu))
      return { zone: null, raison: `zone « ${voulu} » demandée par SEREO_OSRM_ZONE` };
    if (ZONES[voulu]) return { zone: { id: voulu, ...ZONES[voulu] }, raison: "SEREO_OSRM_ZONE" };
    const extraits = voulu.split(",").map((s) => s.trim()).filter(Boolean);
    if (extraits.length && extraits.every((e) => EXTRAIT_VALIDE.test(e)))
      return {
        zone: { id: extraits.join(","), libelle: extraits.join(", "), extraits, memoire: 0, disque: 0 },
        raison: "SEREO_OSRM_ZONE",
      };
    return { zone: null, raison: `SEREO_OSRM_ZONE illisible (« ${voulu} »)` };
  }
  for (const id of ORDRE_DES_ZONES) {
    const z = ZONES[id];
    if (memoire >= z.memoire && disque >= z.disque) return { zone: { id, ...z }, raison: "ressources" };
  }
  return {
    zone: null,
    raison: `mémoire (${enGo(memoire)}) ou disque libre (${enGo(disque)}) insuffisants pour une carte locale`,
  };
}

// Taille lisible : en Mo sous 1 Go (une petite carte n'est pas « 0 Go »).
const enGo = (octets) => {
  const n = Number(octets || 0);
  if (n < GO) return `${Math.max(n > 0 ? 1 : 0, Math.round(n / 1024 ** 2)).toLocaleString("fr-FR")} Mo`;
  return `${(n / GO).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go`;
};

// L'heure seule, en chiffres : format() rendrait « 03 h » en francais.
function heureParis(date) {
  const parties = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  return Number(parties.find((p) => p.type === "hour")?.value);
}
function dateParis(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

// Memoire vue par le conteneur : la limite du cgroup si elle est plus basse
// que la memoire de la machine (os.totalmem() voit la machine entiere).
function memoireDisponible() {
  const totale = os.totalmem();
  const limite = typeof process.constrainedMemory === "function" ? Number(process.constrainedMemory()) : 0;
  return limite > 0 && limite < totale ? limite : totale;
}

async function disqueLibre(dossier) {
  let d = path.resolve(dossier);
  while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d);
  const s = await fsp.statfs(d);
  return Number(s.bavail) * Number(s.bsize);
}

async function tailleDossier(dossier) {
  let total = 0;
  let entrees;
  try {
    entrees = await fsp.readdir(dossier, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entrees) {
    const p = path.join(dossier, e.name);
    try {
      if (e.isDirectory()) total += await tailleDossier(p);
      else total += (await fsp.stat(p)).size;
    } catch {
      /* fichier parti entre-temps */
    }
  }
  return total;
}

async function md5Fichier(chemin) {
  const hash = crypto.createHash("md5");
  for await (const morceau of fs.createReadStream(chemin, { highWaterMark: 1024 * 1024 })) hash.update(morceau);
  return hash.digest("hex");
}

// Ecriture atomique : un lecteur voit l'ancien contenu ou le nouveau, jamais
// un fichier a moitie ecrit (renommage sur le meme disque).
function ecrireAtomique(chemin, contenu) {
  const tmp = `${chemin}.tmp`;
  fs.writeFileSync(tmp, contenu);
  fs.renameSync(tmp, chemin);
}
function lireJson(chemin) {
  try {
    return JSON.parse(fs.readFileSync(chemin, "utf8"));
  } catch {
    return null;
  }
}

// Le journal et l'ecran ne recopient jamais une URL complete ni un chemin
// long : seulement le message, coupe.
const court = (texte, max = 240) => String(texte || "").replace(/\s+/g, " ").trim().slice(0, max);

function priorite() {
  const prefixe = [];
  if (fs.existsSync("/usr/bin/nice")) prefixe.push("/usr/bin/nice", "-n", "19");
  if (fs.existsSync("/usr/bin/ionice")) prefixe.push("/usr/bin/ionice", "-c", "3");
  return prefixe;
}

class GestionnaireOsrm {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.dossier = path.resolve(options.dossier || path.join(process.cwd(), "data", "osrm"));
    this.binaires = options.binaires || "/usr/local/bin";
    this.profil = options.profil || "/opt/osrm/profiles/car.lua";
    this.osmium = options.osmium || "/usr/bin/osmium";
    this.port = Number(options.port || this.env.SEREO_OSRM_PORT || 5000);
    this.fetch = options.fetch || ((...a) => globalThis.fetch(...a));
    this.lancer = options.lancer || spawn;
    this.journal = options.journal || console;
    this.maintenant = options.maintenant || (() => new Date());
    this.memoire = options.memoire || memoireDisponible;
    this.disqueLibre = options.disqueLibre || disqueLibre;
    this.priorite = options.priorite || priorite();
    this.fils = Math.max(1, Math.floor((os.availableParallelism?.() || os.cpus().length || 2) / 2));
    this.delais = {
      premierePreparation: 2 * 60 * 1000,
      verification: 15 * 60 * 1000,
      relances: [2000, 5000, 15000, 60000, 300000],
      sondage: 1000,
      sondageMax: 30 * 60 * 1000,
      silence: 120 * 1000,
      ...(options.delais || {}),
    };
    this.minuteries = new Set();
    this.processus = null;
    this.relance = 0;
    this.enCours = null;
    this.arrete = false;
    this.etatInterne = {
      actif: false,
      pret: false,
      raison: "pas encore démarré",
      zoneVoulue: null,
      etape: null,
      espaceUtilise: 0,
    };
  }

  log(message) {
    try {
      this.journal.log(`[osrm-local] ${message}`);
    } catch {
      /* un journal qui casse ne casse pas le calcul */
    }
  }
  avertir(message) {
    try {
      (this.journal.warn || this.journal.log).call(this.journal, `[osrm-local] ${message}`);
    } catch {
      /* idem */
    }
  }

  get fichierCourante() {
    return path.join(this.dossier, "courante.json");
  }
  get fichierSuivi() {
    return path.join(this.dossier, "suivi.json");
  }
  get courante() {
    const c = lireJson(this.fichierCourante);
    return c && c.version && fs.existsSync(path.join(this.dossier, "versions", c.version)) ? c : null;
  }
  get suivi() {
    return lireJson(this.fichierSuivi) || {};
  }
  noterSuivi(champs) {
    try {
      ecrireAtomique(this.fichierSuivi, JSON.stringify({ ...this.suivi, ...champs }, null, 2));
    } catch (e) {
      this.avertir(`suivi non enregistré : ${court(e.message)}`);
    }
  }

  binaire(nom) {
    return path.join(this.binaires, nom);
  }

  minuterie(fn, ms, repeter = false) {
    const t = (repeter ? setInterval : setTimeout)(() => {
      if (!repeter) this.minuteries.delete(t);
      Promise.resolve()
        .then(fn)
        .catch((e) => this.avertir(`erreur inattendue : ${court(e?.message)}`));
    }, ms);
    t.unref?.();
    this.minuteries.add(t);
    return t;
  }

  /** URL du serveur local s'il repond, sinon "" (lib/routing.js). */
  urlSiPret() {
    return this.etatInterne.actif && this.etatInterne.pret && this.processus ? `http://127.0.0.1:${this.port}` : "";
  }

  /**
   * Rend la main TOUT DE SUITE. Le reste tourne en arriere-plan ; aucune
   * erreur n'en sort.
   */
  demarrer() {
    try {
      this.arrete = false;
      if (this.env.SEREO_OSRM_LOCAL === "0") {
        this.etatInterne = { ...this.etatInterne, actif: false, raison: "coupé par SEREO_OSRM_LOCAL=0" };
        this.log("coupé (SEREO_OSRM_LOCAL=0) : calcul sur le serveur public.");
        return;
      }
      const manquants = [...BINAIRES.map((b) => this.binaire(b)), this.profil].filter((f) => !fs.existsSync(f));
      if (manquants.length) {
        this.etatInterne = { ...this.etatInterne, actif: false, raison: "binaires OSRM absents de cette installation" };
        this.log(`binaires OSRM absents (${manquants.map((f) => path.basename(f)).join(", ")}) : calcul sur le serveur public.`);
        return;
      }
      this.etatInterne = { ...this.etatInterne, actif: true, raison: "" };
      // Garde pour les bancs ; Sereo, lui, ne l'attend jamais.
      this.demarrage = Promise.resolve()
        .then(() => this.demarrerEnFond())
        .catch((e) => this.avertir(`démarrage : ${court(e?.message)}`));
    } catch (e) {
      this.avertir(`démarrage : ${court(e?.message)}`);
    }
  }

  async demarrerEnFond() {
    await fsp.mkdir(path.join(this.dossier, "versions"), { recursive: true });
    await fsp.mkdir(path.join(this.dossier, "telechargements"), { recursive: true });
    // Hors Docker, un osrm-routed orphelin garderait le port 5000.
    if (!this.surSortie) {
      this.surSortie = () => {
        try {
          this.processus?.kill("SIGTERM");
        } catch {
          /* deja parti */
        }
      };
      process.once("exit", this.surSortie);
    }
    const courante = this.courante;
    await this.nettoyerVersions(courante?.version);
    if (courante) {
      this.log(`carte en place : ${courante.libelle} (données du ${dateParis(courante.dateCarte)}).`);
      this.lancerRoutage(courante);
    } else {
      this.log("aucune carte locale : calcul sur le serveur public en attendant.");
    }
    this.mesurerEspace();
    this.minuterie(() => this.verifierPlanning(), this.delais.premierePreparation);
    this.minuterie(() => this.verifierPlanning(), this.delais.verification, true);
  }

  async zoneVoulue() {
    const utilise = await tailleDossier(this.dossier);
    let libre = 0;
    try {
      libre = await this.disqueLibre(this.dossier);
    } catch (e) {
      this.avertir(`espace libre illisible : ${court(e.message)}`);
    }
    // Nos propres cartes comptent comme disponibles : sans cela, la carte
    // installee ferait choisir une zone plus petite le mois suivant.
    const choix = choisirZone({ memoire: this.memoire(), disque: libre + utilise, forcee: this.env.SEREO_OSRM_ZONE });
    this.etatInterne.zoneVoulue = choix.zone ? choix.zone.libelle : null;
    if (!choix.zone) this.etatInterne.raison = choix.raison;
    return choix;
  }

  /**
   * Faut-il preparer une carte maintenant ? Sans carte (ou si la zone voulue
   * a change) : tout de suite la premiere fois, puis a 3 h apres un echec.
   * Avec une carte de 30 jours ou plus : a 3 h (Europe/Paris). Jamais deux
   * essais a moins de 20 h.
   */
  async verifierPlanning() {
    if (this.arrete || this.enCours || !this.etatInterne.actif) return false;
    const { zone } = await this.zoneVoulue();
    if (!zone) return false;
    const maintenant = this.maintenant();
    const courante = this.courante;
    const urgent = !courante || courante.zone !== zone.id;
    const age = courante ? maintenant.getTime() - Date.parse(courante.preparee) : Infinity;
    if (!urgent && age < 30 * JOUR_MS) return false;
    const derniere = Date.parse(this.suivi.derniereTentative || "") || 0;
    if (maintenant.getTime() - derniere < 20 * 3600 * 1000) return false;
    if ((!urgent || derniere) && heureParis(maintenant) !== 3) return false;
    await this.preparer(zone);
    return true;
  }

  /** Telecharge, prepare, bascule. Ne jette jamais : l'echec va dans l'etat. */
  preparer(zone) {
    if (this.enCours) return this.enCours;
    this.enCours = this.preparerSansGarde(zone).finally(() => {
      this.enCours = null;
      this.etatInterne.etape = null;
    });
    return this.enCours;
  }

  async preparerSansGarde(zone) {
    const debut = this.maintenant();
    const version = `v${debut.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-")}`;
    const dossierVersions = path.join(this.dossier, "versions");
    const enCours = path.join(dossierVersions, `${version}-en-cours`);
    const telechargements = path.join(this.dossier, "telechargements");
    const aSupprimer = [];
    this.noterSuivi({ derniereTentative: debut.toISOString() });
    this.log(`préparation de la carte « ${zone.libelle} » (${zone.extraits.length} extrait(s)).`);
    try {
      await fsp.mkdir(telechargements, { recursive: true });
      await fsp.rm(enCours, { recursive: true, force: true });
      await fsp.mkdir(enCours, { recursive: true });

      const fichiers = [];
      let dateCarte = null;
      for (const [i, extrait] of zone.extraits.entries()) {
        const f = await this.telecharger(extrait, telechargements, `${i + 1}/${zone.extraits.length}`);
        fichiers.push(f.chemin);
        aSupprimer.push(f.chemin, `${f.chemin}.json`);
        if (f.date && (!dateCarte || f.date < dateCarte)) dateCarte = f.date;
      }

      let source = fichiers[0];
      if (fichiers.length > 1) {
        if (!fs.existsSync(this.osmium)) throw new Error("osmium absent : impossible de fusionner les extraits");
        source = path.join(telechargements, "zone-fusionnee.osm.pbf");
        aSupprimer.push(source);
        await this.etape("fusion", this.osmium, ["merge", ...fichiers, "-o", source, "--overwrite"]);
      }

      const base = path.join(enCours, "carte.osrm");
      await this.etape("extract", this.binaire("osrm-extract"), [
        "-p", this.profil, "-t", String(this.fils), "-o", base, source,
      ]);
      await this.etape("partition", this.binaire("osrm-partition"), ["-t", String(this.fils), base]);
      await this.etape("customize", this.binaire("osrm-customize"), ["-t", String(this.fils), base]);
      const produits = await fsp.readdir(enCours);
      if (!produits.some((f) => f.endsWith(".cell_metrics")))
        throw new Error("préparation incomplète : fichiers de la carte absents");

      // Bascule : dossier final, puis pointeur remplace par renommage. Avant
      // cette ligne, l'ancienne carte est intacte et continue de servir.
      const final = path.join(dossierVersions, version);
      await fsp.rename(enCours, final);
      const nouvelle = {
        version,
        zone: zone.id,
        libelle: zone.libelle,
        extraits: zone.extraits,
        dateCarte: dateCarte || debut.toISOString(),
        preparee: this.maintenant().toISOString(),
      };
      ecrireAtomique(this.fichierCourante, JSON.stringify(nouvelle, null, 2));
      this.noterSuivi({ derniereErreur: null, derniereReussite: nouvelle.preparee });
      this.log(`carte « ${zone.libelle} » prête (${Math.round((this.maintenant() - debut) / 60000)} min) : bascule.`);
      await this.arreterRoutage();
      this.lancerRoutage(nouvelle);
      await this.nettoyerVersions(version);
      for (const f of aSupprimer) await fsp.rm(f, { force: true });
      return true;
    } catch (e) {
      const message = court(e?.message || e);
      this.noterSuivi({ derniereErreur: { message, date: this.maintenant().toISOString() } });
      this.avertir(`préparation échouée : ${message}. ${this.courante ? "L'ancienne carte reste en service." : "Serveur public en attendant."}`);
      await fsp.rm(enCours, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(path.join(telechargements, "zone-fusionnee.osm.pbf"), { force: true }).catch(() => {});
      return false;
    } finally {
      this.mesurerEspace();
    }
  }

  /** Un extrait Geofabrik, verifie par sa somme MD5 publiee. */
  async telecharger(extrait, dossier, rang) {
    if (!EXTRAIT_VALIDE.test(extrait)) throw new Error(`extrait refusé : ${extrait}`);
    const url = `${GEOFABRIK}${extrait}-latest.osm.pbf`;
    const nom = `${extrait.replace(/\//g, "_")}.osm.pbf`;
    const cible = path.join(dossier, nom);
    const partiel = `${cible}.part`;
    const meta = `${partiel}.json`;
    const entetes = { "User-Agent": "Sereo/1.0 (carte OSRM locale)" };

    this.etatInterne.etape = `téléchargement ${rang} (${extrait})`;
    const somme = await this.fetch(`${url}.md5`, { headers: entetes, signal: AbortSignal.timeout(30000) });
    if (!somme.ok) throw new Error(`somme MD5 introuvable pour ${extrait} (HTTP ${somme.status})`);
    const attendue = (String(await somme.text()).match(/^\s*([0-9a-f]{32})\b/i) || [])[1]?.toLowerCase();
    if (!attendue) throw new Error(`somme MD5 illisible pour ${extrait}`);

    if (fs.existsSync(cible) && (await md5Fichier(cible)) === attendue) {
      this.log(`${extrait} : déjà téléchargé, somme MD5 vérifiée.`);
      return { chemin: cible, date: lireJson(`${cible}.json`)?.date || null };
    }

    const avant = lireJson(meta);
    let deja = 0;
    try {
      deja = fs.statSync(partiel).size;
    } catch {
      deja = 0;
    }
    const demande = { ...entetes };
    if (deja > 0 && avant?.validateur) {
      demande.Range = `bytes=${deja}-`;
      demande["If-Range"] = avant.validateur;
    }
    const controle = new AbortController();
    let silence = setTimeout(() => controle.abort(), this.delais.silence);
    const relancerSilence = () => {
      clearTimeout(silence);
      silence = setTimeout(() => controle.abort(), this.delais.silence);
    };
    try {
      const reponse = await this.fetch(url, { headers: demande, signal: controle.signal });
      if (reponse.status !== 200 && reponse.status !== 206)
        throw new Error(`téléchargement de ${extrait} refusé (HTTP ${reponse.status})`);
      const reprise = reponse.status === 206;
      if (!reprise) deja = 0;
      const validateur = reponse.headers.get("etag") || reponse.headers.get("last-modified") || "";
      const modifie = Date.parse(reponse.headers.get("last-modified") || "");
      const date = Number.isFinite(modifie) ? new Date(modifie).toISOString() : avant?.date || null;
      ecrireAtomique(meta, JSON.stringify({ validateur, date }));
      const total = deja + Number(reponse.headers.get("content-length") || 0);
      this.log(`${extrait} : ${reprise ? `reprise à ${enGo(deja)}` : "téléchargement"} (${enGo(total)}).`);
      const sortie = fs.createWriteStream(partiel, { flags: reprise ? "a" : "w" });
      // Disque plein, droits : sans cet ecouteur, l'erreur d'ecriture ferait
      // tomber Sereo (evenement « error » sans ecouteur).
      let echecEcriture = null;
      sortie.on("error", (e) => {
        echecEcriture = e;
      });
      let recu = deja;
      try {
        for await (const morceau of reponse.body) {
          if (echecEcriture) break;
          relancerSilence();
          recu += morceau.length;
          if (total > 0) this.etatInterne.etape = `téléchargement ${rang} : ${Math.floor((recu / total) * 100)} %`;
          if (!sortie.write(morceau))
            await Promise.race([once(sortie, "drain"), once(sortie, "close")]).catch(() => {});
        }
      } finally {
        sortie.end();
        if (!sortie.closed) await once(sortie, "close").catch(() => {});
      }
      if (echecEcriture) throw new Error(`écriture de ${extrait} impossible (${court(echecEcriture.code || echecEcriture.message, 60)})`);
      const obtenue = await md5Fichier(partiel);
      if (obtenue !== attendue) {
        await fsp.rm(partiel, { force: true });
        await fsp.rm(meta, { force: true });
        throw new Error(`somme MD5 fausse pour ${extrait} : fichier refusé`);
      }
      await fsp.rename(partiel, cible);
      await fsp.rm(meta, { force: true });
      ecrireAtomique(`${cible}.json`, JSON.stringify({ date }));
      this.log(`${extrait} : téléchargé, somme MD5 vérifiée.`);
      return { chemin: cible, date };
    } catch (e) {
      if (controle.signal.aborted) throw new Error(`téléchargement de ${extrait} interrompu (aucune donnée pendant ${this.delais.silence / 1000} s)`);
      throw e;
    } finally {
      clearTimeout(silence);
    }
  }

  /** Une etape de preparation, en priorite basse ; jette si elle echoue. */
  async etape(nom, programme, args) {
    this.etatInterne.etape = `préparation (${nom})`;
    const debut = Date.now();
    this.log(`étape « ${nom} » : début.`);
    const [cmd, ...avant] = this.priorite.length ? this.priorite : [programme];
    const tout = this.priorite.length ? [...avant, programme, ...args] : args;
    const fin = [];
    await new Promise((resolve, reject) => {
      let enfant;
      try {
        enfant = this.lancer(cmd, tout, { stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        reject(new Error(`${nom} : lancement impossible (${court(e.message)})`));
        return;
      }
      const garder = (d) => {
        for (const ligne of String(d).split(/\r?\n/)) if (ligne.trim()) fin.push(ligne.trim());
        if (fin.length > 20) fin.splice(0, fin.length - 20);
      };
      enfant.stdout?.on?.("data", garder);
      enfant.stderr?.on?.("data", garder);
      enfant.on("error", (e) => reject(new Error(`${nom} : lancement impossible (${court(e.message)})`)));
      enfant.on("exit", (code, signal) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `${nom} a échoué (${signal ? `signal ${signal}` : `code ${code}`})${fin.length ? ` : ${court(fin.slice(-3).join(" / "), 200)}` : ""}`,
            ),
          );
      });
    });
    this.log(`étape « ${nom} » : terminée en ${Math.round((Date.now() - debut) / 1000)} s.`);
  }

  lancerRoutage(carte) {
    if (this.arrete) return;
    const base = path.join(this.dossier, "versions", carte.version, "carte.osrm");
    const args = [
      "--algorithm", "mld",
      "--ip", "127.0.0.1",
      "--port", String(this.port),
      // Les fichiers de la carte sont lus sur le disque (mmap) au lieu d'etre
      // recopies en memoire : la memoire vive reste libre pour Sereo.
      "--mmap",
      // Un point a plus de 3 km de toute route de la carte est refuse
      // (NoSegment) au lieu d'etre accroche au bord de la zone : lib/routing.js
      // repasse alors par le serveur public.
      "--default-radius", "3000",
      "--max-table-size", "100",
      "-l", "WARNING",
      base,
    ];
    let enfant;
    this.carteServie = carte;
    try {
      enfant = this.lancer(this.binaire("osrm-routed"), args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      this.avertir(`osrm-routed ne démarre pas : ${court(e.message)}`);
      this.planifierRelance(carte);
      return;
    }
    const fin = [];
    const garder = (d) => {
      for (const ligne of String(d).split(/\r?\n/)) if (ligne.trim()) fin.push(ligne.trim());
      if (fin.length > 10) fin.splice(0, fin.length - 10);
    };
    enfant.stdout?.on?.("data", garder);
    enfant.stderr?.on?.("data", garder);
    this.processus = enfant;
    this.etatInterne.pret = false;
    const lanceA = Date.now();
    const fini = (quoi) => {
      if (this.processus !== enfant) return;
      this.processus = null;
      this.etatInterne.pret = false;
      if (enfant.arretVoulu || this.arrete) return;
      if (Date.now() - lanceA > 10 * 60 * 1000) this.relance = 0;
      this.avertir(`osrm-routed s'est arrêté (${quoi})${fin.length ? ` : ${court(fin.slice(-2).join(" / "), 160)}` : ""}. Serveur public en attendant la relance.`);
      this.planifierRelance(carte);
    };
    enfant.on("error", (e) => fini(`erreur : ${court(e.message, 80)}`));
    enfant.on("exit", (code, signal) => fini(signal ? `signal ${signal}` : `code ${code}`));
    this.log(`osrm-routed lancé sur 127.0.0.1:${this.port} (${carte.libelle}).`);
    this.attendrePret(enfant);
  }

  planifierRelance(carte) {
    const delais = this.delais.relances;
    const attente = delais[Math.min(this.relance, delais.length - 1)];
    this.relance++;
    this.log(`relance d'osrm-routed dans ${Math.round(attente / 1000)} s (${carte.libelle}).`);
    this.minuterie(() => {
      if (this.arrete || this.processus) return;
      // La carte EN SERVICE a la relance (une bascule a pu avoir lieu).
      const courante = this.courante;
      if (courante) this.lancerRoutage(courante);
    }, attente);
  }

  async attendrePret(enfant) {
    const limite = Date.now() + this.delais.sondageMax;
    while (!this.arrete && this.processus === enfant && Date.now() < limite) {
      try {
        // N'importe quelle reponse HTTP (meme un refus) prouve que la carte
        // est chargee : osrm-routed n'ecoute qu'apres l'avoir lue.
        await this.fetch(`http://127.0.0.1:${this.port}/nearest/v1/driving/0,0`, {
          signal: AbortSignal.timeout(2000),
        });
        if (this.processus === enfant) {
          this.etatInterne.pret = true;
          this.log(`carte locale prête : calcul routier sur http://127.0.0.1:${this.port}.`);
        }
        return;
      } catch {
        await new Promise((r) => {
          const t = setTimeout(r, this.delais.sondage);
          t.unref?.();
        });
      }
    }
  }

  async arreterRoutage() {
    const enfant = this.processus;
    if (!enfant) return;
    enfant.arretVoulu = true;
    this.etatInterne.pret = false;
    const parti = once(enfant, "exit").catch(() => {});
    try {
      enfant.kill("SIGTERM");
    } catch {
      /* deja parti */
    }
    const delai = new Promise((r) => {
      const t = setTimeout(r, 10000);
      t.unref?.();
    });
    await Promise.race([parti, delai]);
    if (this.processus === enfant) {
      try {
        enfant.kill("SIGKILL");
      } catch {
        /* deja parti */
      }
      this.processus = null;
    }
  }

  /** Supprime les versions autres que `garder` (et les preparations interrompues). */
  async nettoyerVersions(garder) {
    const dossier = path.join(this.dossier, "versions");
    let noms = [];
    try {
      noms = await fsp.readdir(dossier);
    } catch {
      return;
    }
    for (const nom of noms) {
      if (nom === garder) continue;
      if (this.enCours && nom.endsWith("-en-cours")) continue;
      await fsp.rm(path.join(dossier, nom), { recursive: true, force: true }).catch(() => {});
      this.log(`ancienne version supprimée : ${nom}.`);
    }
  }

  mesurerEspace() {
    tailleDossier(this.dossier)
      .then((t) => {
        this.etatInterne.espaceUtilise = t;
      })
      .catch(() => {});
  }

  /** Arret propre (tests, fin du processus). */
  async arreter() {
    this.arrete = true;
    for (const t of this.minuteries) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.minuteries.clear();
    if (this.surSortie) {
      process.removeListener("exit", this.surSortie);
      this.surSortie = null;
    }
    await this.arreterRoutage();
  }

  /** Etat pour /api/storage/status et l'ecran Parametres. */
  etat() {
    const courante = this.etatInterne.actif ? this.courante : null;
    const suivi = this.etatInterne.actif ? this.suivi : {};
    const e = {
      actif: this.etatInterne.actif,
      pret: Boolean(this.urlSiPret()),
      zone: courante ? courante.libelle : null,
      zoneVoulue: this.etatInterne.zoneVoulue,
      dateCarte: courante ? courante.dateCarte : null,
      preparee: courante ? courante.preparee : null,
      etape: this.etatInterne.etape,
      derniereErreur: suivi.derniereErreur || null,
      espaceUtilise: this.etatInterne.espaceUtilise,
      raison: this.etatInterne.raison || null,
    };
    return { ...e, resume: resumer(e) };
  }
}

/** Une phrase pour Thomas (ligne de l'ecran Parametres). */
function resumer(e) {
  const erreur = e.derniereErreur
    ? ` Dernier essai échoué le ${dateParis(e.derniereErreur.date)} : ${e.derniereErreur.message}.`
    : "";
  if (!e.actif) return `Serveur public (${e.raison || "carte locale inactive"}).`;
  if (e.zone) {
    const carte = `carte locale « ${e.zone} », données du ${dateParis(e.dateCarte)}, ${enGo(e.espaceUtilise)}`;
    if (e.pret)
      return `Sur ${carte}.${e.etape ? ` Mise à jour en cours : ${e.etape}.` : ""}${erreur ? `${erreur} L'ancienne carte reste en service.` : ""}`;
    return `Serveur public le temps que la ${carte} démarre.${erreur}`;
  }
  if (e.etape) return `Serveur public en attendant la carte locale « ${e.zoneVoulue || "?"} » : ${e.etape}.`;
  if (e.raison && !e.zoneVoulue) return `Serveur public (${e.raison}).${erreur}`;
  return `Serveur public en attendant la carte locale${e.zoneVoulue ? ` « ${e.zoneVoulue} »` : ""}.${erreur}${erreur ? " Nouvel essai la nuit, à 3 h." : ""}`;
}

module.exports = {
  GestionnaireOsrm,
  choisirZone,
  heureParis,
  resumer,
  ZONES,
  GO,
};

// Calcul routier OSRM integre a l'image Sereo (23/09) : le gestionnaire
// lib/osrm-local.js, avec des binaires et un reseau SIMULES.
//
// Ce qui est verifie :
// 1. Choix de la zone selon la memoire et le disque ; SEREO_OSRM_ZONE la force.
// 2. Chemin normal : telechargement, somme MD5, fusion, extract -> partition
//    -> customize en priorite basse, bascule, osrm-routed lance et pret.
// 3. Somme MD5 fausse : fichier refuse, aucune carte, rien de lance.
// 4. Preparation qui echoue : l'ancienne carte reste en service.
// 5. Bascule atomique : le pointeur ne change qu'apres le succes complet ;
//    les anciennes versions sont supprimees.
// 6. osrm-routed qui meurt est relance ; entre-temps, pas d'URL locale.
// 7. SEREO_OSRM_LOCAL=0, ou binaires absents : aucun reseau, aucun processus.
// 8. Reprise d'un telechargement interrompu (Range + If-Range).
// 9. Planification : premiere carte tout de suite, puis a 3 h (Europe/Paris)
//    seulement, mensuelle, jamais deux essais a moins de 20 h.
// 10. demarrer() rend la main tout de suite, et une panne ne sort pas.

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const { GestionnaireOsrm, choisirZone, heureParis, ZONES, GO } = require("../lib/osrm-local");

const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusqua(condition, ms = 3000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await attendre(5);
  }
  return false;
}

const gestionnaires = [];
afterEach(async () => {
  while (gestionnaires.length) await gestionnaires.pop().arreter();
});

/** Dossier de donnees + faux binaires + faux profil. */
function installation() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-osrm-"));
  const binaires = path.join(racine, "bin");
  fs.mkdirSync(binaires);
  for (const b of ["osrm-extract", "osrm-partition", "osrm-customize", "osrm-routed", "osmium"])
    fs.writeFileSync(path.join(binaires, b), "");
  const profil = path.join(racine, "car.lua");
  fs.writeFileSync(profil, "-- profil");
  return { racine, binaires, profil, dossier: path.join(racine, "data", "osrm") };
}

/** Faux Geofabrik : extraits, sommes MD5 (fausses sur demande), reprise. */
// `lent` : le corps arrive en deux morceaux, 50 ms d'ecart (un vrai reseau).
function corpsLent(contenu) {
  let envoye = 0;
  return new ReadableStream({
    async pull(ctrl) {
      if (envoye >= 2) return ctrl.close();
      if (envoye++) await attendre(50);
      const moitie = Math.ceil(contenu.length / 2);
      ctrl.enqueue(new Uint8Array(envoye === 1 ? contenu.subarray(0, moitie) : contenu.subarray(moitie)));
    },
  });
}
// `sonde` : faux si osrm-routed n'ecoute pas (carte refusee) ; la sonde echoue.
function fauxReseau(extraits, { md5Faux = [], lent = false, sonde = () => true } = {}) {
  const appels = [];
  const fetch = async (url, init = {}) => {
    url = String(url);
    const entetes = init.headers || {};
    appels.push({ url, entetes });
    // Sonde de osrm-routed : n'importe quelle reponse HTTP.
    if (url.startsWith("http://127.0.0.1:")) {
      if (!sonde()) throw new TypeError("fetch failed (ECONNREFUSED)");
      return new Response('{"code":"NoSegment"}', { status: 400 });
    }
    const m = url.match(/^https:\/\/download\.geofabrik\.de\/(.+)-latest\.osm\.pbf(\.md5)?$/);
    if (!m || !(m[1] in extraits)) return new Response("absent", { status: 404 });
    const contenu = Buffer.from(extraits[m[1]]);
    if (m[2]) {
      const h = md5Faux.includes(m[1]) ? "0123456789abcdef0123456789abcdef" : md5(contenu);
      return new Response(`${h}  ${path.basename(m[1])}-latest.osm.pbf\n`);
    }
    const base = { etag: '"v1"', "last-modified": "Tue, 22 Sep 2026 23:08:07 GMT" };
    const plage = entetes.Range && entetes["If-Range"] === '"v1"' && entetes.Range.match(/^bytes=(\d+)-$/);
    if (plage) {
      const debut = Number(plage[1]);
      return new Response(contenu.subarray(debut), {
        status: 206,
        headers: { ...base, "content-length": String(contenu.length - debut) },
      });
    }
    return new Response(lent ? corpsLent(contenu) : contenu, { status: 200, headers: { ...base, "content-length": String(contenu.length) } });
  };
  return { fetch, appels };
}

/**
 * Faux processus. Les etapes de preparation ecrivent ce que les vrais
 * binaires ecriraient, puis sortent (code 1 pour `echec`). osrm-routed reste
 * vivant jusqu'a kill(). `pendant(prog)` : crochet appele avant la sortie.
 */
// `bloque` : cette etape ne se termine jamais d'elle-meme (seul kill() la
// fait sortir). `refuse(carte)` : osrm-routed refuse ces fichiers (format
// d'une autre version d'OSRM, fichiers abimes) et sort en code 1.
function fauxProcessus({ echec = null, pendant = () => {}, bloque = null, refuse = () => false } = {}) {
  const appels = [];
  const lancer = (cmd, args) => {
    const tout = [cmd, ...args].map(String);
    const prog = path.basename(tout.find((x) => /^(osrm-|osmium)/.test(path.basename(x))) || cmd);
    const enfant = new EventEmitter();
    enfant.stdout = new PassThrough();
    enfant.stderr = new PassThrough();
    enfant.tue = [];
    enfant.kill = (signal) => {
      enfant.tue.push(signal || "SIGTERM");
      setImmediate(() => enfant.emit("exit", null, signal || "SIGTERM"));
      return true;
    };
    appels.push({ prog, cmd, args: args.map(String), enfant });
    if (prog === "osrm-routed" && refuse(String(args.at(-1)))) {
      enfant.refuse = true;
      setImmediate(() => {
        enfant.stderr.write("[error] carte.osrm.fileIndex is incompatible with this version of OSRM\n");
        enfant.emit("exit", 1, null);
      });
    }
    if (prog === bloque) return enfant;
    if (prog !== "osrm-routed")
      setImmediate(() => {
        pendant(prog);
        if (echec === prog) {
          enfant.stderr.write("[error] bad_alloc\n");
          enfant.emit("exit", 1, null);
          return;
        }
        const apres = (opt) => args[args.indexOf(opt) + 1];
        if (prog === "osmium") fs.writeFileSync(apres("-o"), "fusion");
        if (prog === "osrm-extract") fs.writeFileSync(`${apres("-o")}.ebg`, "x");
        if (prog === "osrm-partition") fs.writeFileSync(`${args.at(-1)}.partition`, "x");
        if (prog === "osrm-customize") fs.writeFileSync(`${args.at(-1)}.cell_metrics`, "x");
        enfant.emit("exit", 0, null);
      });
    return enfant;
  };
  return { lancer, appels };
}

function gestionnaire(inst, { env = {}, reseau, processus, maintenant, memoire = 16 * GO, libre = 100 * GO, priorite = [] } = {}) {
  const lignes = [];
  const g = new GestionnaireOsrm({
    env,
    dossier: inst.dossier,
    binaires: inst.binaires,
    profil: inst.profil,
    osmium: path.join(inst.binaires, "osmium"),
    fetch: reseau?.fetch || (async () => { throw new Error("aucun reseau dans ce banc"); }),
    lancer: processus?.lancer || (() => { throw new Error("aucun processus dans ce banc"); }),
    journal: { log: (m) => lignes.push(m), warn: (m) => lignes.push(m) },
    maintenant: maintenant || (() => new Date("2026-09-24T01:00:00Z")),
    memoire: () => memoire,
    disqueLibre: async () => (typeof libre === "function" ? libre() : libre),
    priorite,
    delais: { premierePreparation: 1e9, verification: 1e9, relances: [5, 5], sondage: 5 },
  });
  g.lignes = lignes;
  gestionnaires.push(g);
  return g;
}

const ZONE_TEST = { id: "europe/a,europe/b", libelle: "europe/a, europe/b", extraits: ["europe/a", "europe/b"] };
const lirePointeur = (inst) => JSON.parse(fs.readFileSync(path.join(inst.dossier, "courante.json"), "utf8"));

// --- 1. Choix de la zone -------------------------------------------------------
test("zone : la plus grande que la memoire ET le disque permettent ; SEREO_OSRM_ZONE la force", () => {
  const z = (memoire, disque, forcee) => choisirZone({ memoire: memoire * GO, disque: disque * GO, forcee }).zone?.id ?? null;
  assert.equal(z(32, 200), "france");
  assert.equal(z(16, 200), "voisins", "16 Go de memoire : pas la France entiere");
  assert.equal(z(32, 40), "voisins", "40 Go de disque : pas la France entiere");
  assert.equal(z(8, 200), "region");
  assert.equal(z(16, 10), "region", "10 Go de disque : la seule region");
  assert.equal(z(2, 200), null, "2 Go de memoire : serveur public");
  assert.equal(z(16, 3), null, "3 Go de disque : serveur public");
  // La region, ce sont les deux anciennes regions de Geofabrik.
  assert.deepEqual(ZONES.region.extraits, ["europe/france/bourgogne", "europe/france/franche-comte"]);
  assert.ok(ZONES.voisins.extraits.includes("europe/switzerland"));
  // Forcee : un nom de zone, un chemin Geofabrik, ou « aucune ».
  assert.equal(z(1, 1, "voisins"), "voisins");
  assert.equal(z(64, 500, "europe/monaco"), "europe/monaco");
  assert.deepEqual(choisirZone({ memoire: 0, disque: 0, forcee: "europe/monaco" }).zone.extraits, ["europe/monaco"]);
  assert.equal(z(64, 500, "aucune"), null);
  assert.equal(z(64, 500, "../etc/passwd"), null, "un chemin illisible n'est pas telecharge");
  assert.equal(z(64, 500, "https://ailleurs.exemple/x"), null);
});

// --- 2. Chemin normal ---------------------------------------------------------
test("preparation complete : telecharge, verifie, fusionne, prepare en priorite basse, bascule et lance osrm-routed", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" });
  const processus = fauxProcessus();
  const g = gestionnaire(inst, { reseau, processus, priorite: ["/usr/bin/nice", "-n", "19"] });
  g.demarrer();
  await g.demarrage;
  assert.equal(g.urlSiPret(), "", "aucune carte : pas d'URL locale");

  assert.equal(await g.preparer(ZONE_TEST), true, g.lignes.join("\n"));
  assert.deepEqual(processus.appels.map((a) => a.prog), ["osmium", "osrm-extract", "osrm-partition", "osrm-customize", "osrm-routed"]);
  // Priorite basse pour la preparation, pas pour le service.
  for (const a of processus.appels.slice(0, 4)) assert.equal(a.cmd, "/usr/bin/nice", `${a.prog} sans priorite basse`);
  const routed = processus.appels[4];
  assert.equal(path.basename(routed.cmd), "osrm-routed");
  for (const attendu of [["--algorithm", "mld"], ["--ip", "127.0.0.1"], ["--port", "5000"]])
    assert.equal(routed.args[routed.args.indexOf(attendu[0]) + 1], attendu[1], `${attendu[0]} manquant`);
  assert.ok(routed.args.includes("--mmap"));
  const extract = processus.appels[1].args;
  assert.equal(extract[extract.indexOf("-p") + 1], inst.profil, "profil voiture");

  const pointeur = lirePointeur(inst);
  assert.equal(pointeur.zone, ZONE_TEST.id);
  assert.equal(pointeur.dateCarte, "2026-09-22T23:08:07.000Z", "la date de la carte est celle des donnees");
  assert.ok(fs.existsSync(path.join(inst.dossier, "versions", pointeur.version, "carte.osrm.cell_metrics")));
  assert.ok(await jusqua(() => g.urlSiPret() === "http://127.0.0.1:5000"), "osrm-routed jamais declare pret");
  // Les extraits sont supprimes apres la bascule (place).
  assert.deepEqual(fs.readdirSync(path.join(inst.dossier, "telechargements")), []);
  const etat = g.etat();
  assert.equal(etat.pret, true);
  assert.equal(etat.zone, "europe/a, europe/b");
  assert.equal(etat.derniereErreur, null);
  assert.match(etat.resume, /^Sur carte locale « europe\/a, europe\/b », données du 23\/09\/2026/);
});

// --- 3. Somme MD5 fausse ------------------------------------------------------
test("somme MD5 fausse : le fichier est refuse, aucune carte, rien n'est prepare ni lance", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" }, { md5Faux: ["europe/b"] });
  const processus = fauxProcessus();
  const g = gestionnaire(inst, { reseau, processus });
  g.demarrer();
  await g.demarrage;
  assert.equal(await g.preparer(ZONE_TEST), false);
  assert.deepEqual(processus.appels, [], "une etape a tourne sur un fichier refuse");
  assert.equal(fs.existsSync(path.join(inst.dossier, "courante.json")), false);
  const etat = g.etat();
  assert.match(etat.derniereErreur?.message || "", /somme MD5 fausse pour europe\/b/);
  assert.equal(etat.pret, false);
  // Le fichier refuse n'est pas garde (ni entier, ni partiel).
  const restes = fs.readdirSync(path.join(inst.dossier, "telechargements"));
  assert.ok(!restes.some((f) => f.startsWith("europe_b")), `reste : ${restes}`);
});

// --- 4 et 5. Echec, puis bascule atomique --------------------------------------
test("preparation qui echoue : l'ancienne carte reste en service, rien n'est bascule", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" });
  const ok = fauxProcessus();
  let jour = new Date("2026-08-20T01:00:00Z");
  const g = gestionnaire(inst, { reseau, processus: ok, maintenant: () => jour });
  g.demarrer();
  await g.demarrage;
  assert.equal(await g.preparer(ZONE_TEST), true);
  const ancienne = lirePointeur(inst);
  assert.ok(await jusqua(() => g.urlSiPret() !== ""));

  // Un mois plus tard : partition echoue.
  jour = new Date("2026-09-24T01:00:00Z");
  const ko = fauxProcessus({ echec: "osrm-partition" });
  g.lancer = ko.lancer;
  assert.equal(await g.preparer(ZONE_TEST), false);
  assert.deepEqual(lirePointeur(inst), ancienne, "le pointeur a bouge malgre l'echec");
  assert.deepEqual(fs.readdirSync(path.join(inst.dossier, "versions")), [ancienne.version], "version a moitie preparee laissee");
  assert.ok(!ko.appels.some((a) => a.prog === "osrm-routed"), "osrm-routed relance sur une carte ratee");
  assert.equal(g.urlSiPret(), "http://127.0.0.1:5000", "l'ancienne carte ne sert plus");
  const etat = g.etat();
  assert.match(etat.derniereErreur.message, /partition a échoué \(code 1\) : \[error\] bad_alloc/);
  assert.match(etat.resume, /L'ancienne carte reste en service\.$/);
});

test("bascule atomique : le pointeur ne change qu'apres la derniere etape, puis l'ancienne version est supprimee", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" });
  let jour = new Date("2026-08-20T01:00:00Z");
  const g = gestionnaire(inst, { reseau, processus: fauxProcessus(), maintenant: () => jour });
  g.demarrer();
  await g.demarrage;
  await g.preparer(ZONE_TEST);
  const ancienne = lirePointeur(inst);
  assert.ok(await jusqua(() => g.urlSiPret() !== ""));

  jour = new Date("2026-09-24T01:00:00Z");
  const vus = [];
  const deuxieme = fauxProcessus({
    pendant: (prog) => vus.push([prog, lirePointeur(inst).version, g.urlSiPret()]),
  });
  g.lancer = deuxieme.lancer;
  assert.equal(await g.preparer(ZONE_TEST), true);
  // Pendant TOUTE la preparation : l'ancienne carte, et elle sert.
  assert.deepEqual(vus.map((v) => v[0]), ["osmium", "osrm-extract", "osrm-partition", "osrm-customize"]);
  for (const [prog, version, url] of vus) {
    assert.equal(version, ancienne.version, `pointeur deja bascule pendant ${prog}`);
    assert.equal(url, "http://127.0.0.1:5000", `carte locale coupee pendant ${prog}`);
  }
  const nouvelle = lirePointeur(inst);
  assert.notEqual(nouvelle.version, ancienne.version);
  assert.deepEqual(fs.readdirSync(path.join(inst.dossier, "versions")), [nouvelle.version], "ancienne version gardee");
  assert.ok(!fs.existsSync(path.join(inst.dossier, "courante.json.tmp")));
  // Le service a ete relance sur la nouvelle carte.
  const routed = deuxieme.appels.find((a) => a.prog === "osrm-routed");
  assert.ok(routed.args.at(-1).includes(nouvelle.version));
  assert.ok(await jusqua(() => g.urlSiPret() !== ""));
});

// --- 6. Relance ---------------------------------------------------------------
test("osrm-routed qui meurt est relance ; entre-temps, aucune URL locale (repli public)", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" });
  const processus = fauxProcessus();
  const g = gestionnaire(inst, { reseau, processus });
  g.delais.relances = [150, 150];
  g.demarrer();
  await g.demarrage;
  await g.preparer(ZONE_TEST);
  assert.ok(await jusqua(() => g.urlSiPret() !== ""));
  const premier = processus.appels.filter((a) => a.prog === "osrm-routed");
  assert.equal(premier.length, 1);

  premier[0].enfant.emit("exit", null, "SIGKILL");
  assert.equal(g.urlSiPret(), "", "une URL locale est encore rendue apres la mort d'osrm-routed");
  assert.equal(g.etat().pret, false);
  assert.ok(await jusqua(() => processus.appels.filter((a) => a.prog === "osrm-routed").length === 2), "jamais relance");
  assert.ok(await jusqua(() => g.urlSiPret() === "http://127.0.0.1:5000"), "relance mais jamais pret");
  assert.ok(g.lignes.some((l) => /osrm-routed s'est arrêté \(signal SIGKILL\)/.test(l)), g.lignes.join("\n"));
});

// --- 7. Desactivation ---------------------------------------------------------
test("SEREO_OSRM_LOCAL=0 coupe tout : aucun reseau, aucun processus, aucun dossier", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "A" });
  const processus = fauxProcessus();
  const g = gestionnaire(inst, { env: { SEREO_OSRM_LOCAL: "0" }, reseau, processus });
  g.delais.premierePreparation = 1;
  g.demarrer();
  await attendre(30);
  assert.equal(await g.verifierPlanning(), false);
  assert.deepEqual(reseau.appels, []);
  assert.deepEqual(processus.appels, []);
  assert.equal(fs.existsSync(inst.dossier), false);
  const etat = g.etat();
  assert.equal(etat.actif, false);
  assert.equal(g.urlSiPret(), "");
  assert.match(etat.resume, /SEREO_OSRM_LOCAL=0/);

  // Temoin : sans la variable, la meme installation prepare une carte.
  const temoin = gestionnaire(inst, { reseau, processus });
  temoin.demarrer();
  await temoin.demarrage;
  assert.equal(await temoin.verifierPlanning(), true);
  assert.ok(reseau.appels.length > 0);
});

test("binaires OSRM absents (poste de developpement) : aucun reseau, serveur public", async () => {
  const inst = installation();
  fs.rmSync(path.join(inst.binaires, "osrm-routed"));
  const reseau = fauxReseau({ "europe/a": "A" });
  const g = gestionnaire(inst, { reseau });
  g.delais.premierePreparation = 1;
  g.demarrer();
  await attendre(30);
  assert.deepEqual(reseau.appels, []);
  assert.equal(g.etat().actif, false);
  assert.match(g.etat().resume, /binaires OSRM absents/);
});

// --- 8. Reprise ---------------------------------------------------------------
test("telechargement interrompu : reprise a l'octet pres (Range + If-Range), somme verifiee sur le fichier entier", async () => {
  const inst = installation();
  const contenu = "0123456789".repeat(1000);
  const reseau = fauxReseau({ "europe/a": contenu });
  const g = gestionnaire(inst, { reseau });
  const dossier = path.join(inst.dossier, "telechargements");
  fs.mkdirSync(dossier, { recursive: true });
  const partiel = path.join(dossier, "europe_a.osm.pbf.part");
  fs.writeFileSync(partiel, contenu.slice(0, 4321));
  fs.writeFileSync(`${partiel}.json`, JSON.stringify({ validateur: '"v1"', date: null }));
  const f = await g.telecharger("europe/a", dossier, "1/1");
  assert.equal(fs.readFileSync(f.chemin, "utf8"), contenu);
  const appel = reseau.appels.find((a) => a.url.endsWith(".osm.pbf"));
  assert.equal(appel.entetes.Range, "bytes=4321-");
  assert.equal(appel.entetes["If-Range"], '"v1"');
  assert.ok(!fs.existsSync(partiel));
});

// --- 9. Planification ---------------------------------------------------------
test("planification : premiere carte tout de suite ; ensuite a 3 h (Paris) seulement, chaque mois", async () => {
  const inst = installation();
  const reseau = fauxReseau(Object.fromEntries(ZONES.voisins.extraits.map((e) => [e, `pbf ${e}`])));
  let maintenant = new Date("2026-09-23T12:00:00Z"); // 14 h a Paris
  const g = gestionnaire(inst, { reseau, processus: fauxProcessus(), maintenant: () => maintenant });
  g.demarrer();
  await g.demarrage;
  // Sans carte et sans essai : tout de suite, quelle que soit l'heure.
  assert.equal(await g.verifierPlanning(), true);
  assert.equal(lirePointeur(inst).zone, "voisins", "16 Go et 100 Go libres : les voisins");

  assert.equal(heureParis(new Date("2026-09-24T01:00:00Z")), 3, "heure de Paris illisible");
  const quand = (iso) => { maintenant = new Date(iso); return g.verifierPlanning(); };
  assert.equal(await quand("2026-10-10T01:00:00Z"), false, "carte de 17 jours refaite");
  assert.equal(await quand("2026-10-24T12:00:00Z"), false, "carte de 31 jours refaite a 14 h");
  assert.equal(await quand("2026-10-24T00:00:00Z"), false, "refaite a 2 h (Paris)");
  assert.equal(await quand("2026-10-24T01:30:00Z"), true, "pas refaite a 3 h 30 (Paris) apres 31 jours");
  // Hiver (UTC+1) : 3 h a Paris = 2 h UTC.
  assert.equal(await quand("2026-11-25T01:00:00Z"), false, "2 h a Paris en hiver");
  assert.equal(await quand("2026-11-25T02:00:00Z"), true, "3 h a Paris en hiver");
});

test("planification : apres un echec sans carte, nouvel essai a 3 h, jamais deux essais a moins de 20 h", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "A", "europe/b": "B" });
  let maintenant = new Date("2026-09-23T12:00:00Z");
  const processus = fauxProcessus({ echec: "osrm-extract" });
  const g = gestionnaire(inst, { env: { SEREO_OSRM_ZONE: "europe/a,europe/b" }, reseau, processus, maintenant: () => maintenant });
  g.demarrer();
  await g.demarrage;
  assert.equal(await g.verifierPlanning(), true);
  assert.equal(fs.existsSync(path.join(inst.dossier, "courante.json")), false);
  const quand = (iso) => { maintenant = new Date(iso); return g.verifierPlanning(); };
  assert.equal(await quand("2026-09-23T14:00:00Z"), false, "nouvel essai 2 h apres l'echec");
  assert.equal(await quand("2026-09-24T01:00:00Z"), false, "nouvel essai 13 h apres (3 h a Paris, mais < 20 h)");
  assert.equal(await quand("2026-09-24T12:00:00Z"), false, "nouvel essai a 14 h le lendemain");
  assert.equal(await quand("2026-09-25T01:00:00Z"), true, "pas de nouvel essai a 3 h le surlendemain");
  assert.match(g.etat().resume, /Nouvel essai la nuit, à 3 h\.$/);
});

// --- 10. Jamais bloquant ------------------------------------------------------
test("demarrer() rend la main tout de suite ; une panne dans le gestionnaire ne sort pas", async (t) => {
  const inst = installation();
  const rejets = [];
  const surRejet = (e) => rejets.push(e);
  process.on("unhandledRejection", surRejet);
  t.after(() => process.off("unhandledRejection", surRejet));
  // Tout casse : le disque, le reseau (jamais de reponse), les processus.
  const g = new GestionnaireOsrm({
    env: {},
    dossier: inst.dossier,
    binaires: inst.binaires,
    profil: inst.profil,
    fetch: () => new Promise(() => {}),
    lancer: () => { throw new Error("spawn EACCES"); },
    journal: { log() {}, warn() {} },
    memoire: () => { throw new Error("memoire illisible"); },
    disqueLibre: async () => { throw new Error("statfs"); },
    delais: { premierePreparation: 1, verification: 1e9 },
  });
  gestionnaires.push(g);
  const debut = performance.now();
  const rendu = g.demarrer();
  assert.ok(performance.now() - debut < 50, "demarrer() a bloque");
  assert.equal(rendu, undefined, "demarrer() rend une promesse que Sereo pourrait attendre");
  await attendre(60);
  assert.deepEqual(rejets, []);
  assert.equal(g.urlSiPret(), "");
});

// --- 10 bis. Ecriture impossible (disque plein, droits) --------------------------
test("ecriture impossible pendant le telechargement : la preparation echoue, Sereo ne tombe pas", async (t) => {
  const inst = installation();
  const chutes = [];
  const surChute = (e) => chutes.push(e?.code || e?.message);
  process.prependListener("uncaughtException", surChute);
  t.after(() => process.off("uncaughtException", surChute));
  // Reseau lent : l'erreur d'ecriture tombe PENDANT l'attente des donnees, le
  // moment ou personne d'autre n'ecoute le flux (disque plein en cours de route).
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" }, { lent: true });
  const processus = fauxProcessus();
  const g = gestionnaire(inst, { reseau, processus });
  g.demarrer();
  await g.demarrage;
  // Un dossier a la place du fichier partiel : l'ouverture en ecriture echoue
  // (EISDIR), comme sur un disque plein ou sans droits.
  fs.mkdirSync(path.join(inst.dossier, "telechargements", "europe_a.osm.pbf.part"), { recursive: true });
  assert.equal(await g.preparer(ZONE_TEST), false);
  await attendre(20);
  assert.deepEqual(chutes, [], "une erreur d'ecriture a fait tomber le processus");
  assert.match(g.etat().derniereErreur?.message || "", /écriture de europe\/a impossible \(EISDIR\)/);
  assert.deepEqual(processus.appels, []);
});

// --- 12. Relecture adverse du 23/09 ---------------------------------------------
// Une promesse qui ne se resout jamais rend « jamais fini » au lieu de figer le banc.
const sousDelai = (promesse, ms = 2000) => Promise.race([promesse, attendre(ms).then(() => "jamais fini")]);
const routeds = (processus) => processus.appels.filter((a) => a.prog === "osrm-routed");
const lireSuivi = (inst) => JSON.parse(fs.readFileSync(path.join(inst.dossier, "suivi.json"), "utf8"));
// La sonde ne repond que si le dernier osrm-routed lance a accepte sa carte.
const sondeDuDernier = (get) => () => {
  const r = routeds(get()).at(-1);
  return Boolean(r) && !r.enfant.refuse;
};

test("bascule : une nouvelle carte que osrm-routed refuse ne remplace pas l'ancienne, qui reste en service", async () => {
  const inst = installation();
  let ancienne = null;
  const processus = fauxProcessus({ refuse: (base) => ancienne !== null && !base.includes(ancienne.version) });
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" }, { sonde: sondeDuDernier(() => processus) });
  let jour = new Date("2026-08-20T01:00:00Z");
  const g = gestionnaire(inst, { reseau, processus, maintenant: () => jour });
  g.demarrer();
  await g.demarrage;
  assert.equal(await g.preparer(ZONE_TEST), true);
  ancienne = lirePointeur(inst);
  assert.ok(await jusqua(() => g.urlSiPret() !== ""));

  // Un mois plus tard : customize reussit, mais osrm-routed refuse les fichiers.
  jour = new Date("2026-09-24T01:00:00Z");
  assert.equal(await sousDelai(g.preparer(ZONE_TEST)), false, "une carte que osrm-routed refuse est gardee comme carte en service");
  assert.deepEqual(lirePointeur(inst), ancienne, "le pointeur designe une carte refusee");
  assert.deepEqual(fs.readdirSync(path.join(inst.dossier, "versions")), [ancienne.version],
    "l'ancienne carte supprimee avant que la nouvelle ait demarre, ou la carte refusee gardee");
  assert.ok(await jusqua(() => g.urlSiPret() === "http://127.0.0.1:5000"), "l'ancienne carte n'a pas ete relancee");
  assert.ok(routeds(processus).at(-1).args.at(-1).includes(ancienne.version), "osrm-routed relance sur la carte refusee");
  const etat = g.etat();
  assert.match(etat.derniereErreur?.message || "", /osrm-routed refuse la nouvelle carte .*incompatible/);
  assert.match(etat.resume, /L'ancienne carte reste en service\.$/);
});

test("carte refusee par osrm-routed (montee de version d'OSRM) : erreur visible, carte refaite la nuit suivante sans attendre ses 30 jours", async () => {
  const inst = installation();
  let refusee = null;
  const processus = fauxProcessus({ refuse: (base) => refusee !== null && base.includes(refusee) });
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" }, { sonde: sondeDuDernier(() => processus) });
  let jour = new Date("2026-08-20T01:00:00Z");
  const env = { SEREO_OSRM_ZONE: "europe/a,europe/b" };
  const g = gestionnaire(inst, { env, reseau, processus, maintenant: () => jour });
  g.demarrer();
  await g.demarrage;
  assert.equal(await g.preparer(ZONE_TEST), true);
  const ancienne = lirePointeur(inst);
  assert.ok(await jusqua(() => g.urlSiPret() !== ""));
  await g.arreter();

  // Nouvelle image : le nouvel osrm-routed refuse le format de la carte en place.
  refusee = ancienne.version;
  jour = new Date("2026-08-25T12:00:00Z");
  const g2 = gestionnaire(inst, { env, reseau, processus, maintenant: () => jour });
  g2.demarrer();
  await g2.demarrage;
  assert.ok(await jusqua(() => /osrm-routed ne démarre pas sur la carte/.test(g2.etat().derniereErreur?.message || "")),
    `carte refusee relancee en boucle sans erreur visible : ${g2.etat().resume}`);
  assert.equal(g2.urlSiPret(), "");
  assert.match(g2.etat().resume, /Dernier essai échoué le 25\/08\/2026 : osrm-routed ne démarre pas sur la carte .*incompatible/);
  assert.equal(await g2.verifierPlanning(), false, "carte refaite en pleine journee");
  jour = new Date("2026-08-26T01:00:00Z"); // 3 h a Paris, 6 jours apres le dernier essai
  assert.equal(await g2.verifierPlanning(), true, "carte refusee de 6 jours : pas refaite avant ses 30 jours");
  assert.notEqual(lirePointeur(inst).version, ancienne.version);
  assert.ok(await jusqua(() => g2.urlSiPret() !== ""), "la nouvelle carte ne sert pas");
  assert.equal(g2.etat().derniereErreur, null);
});

test("plancher d'espace libre : la preparation s'arrete avant de remplir le volume de la base, et ne demarre pas en dessous", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" });
  let libre = 100 * GO;
  const processus = fauxProcessus({ bloque: "osrm-extract" });
  const g = gestionnaire(inst, { reseau, processus, libre: () => libre });
  g.delais.disque = 5;
  g.demarrer();
  await g.demarrage;
  const preparation = g.preparer(ZONE_TEST);
  assert.ok(await jusqua(() => processus.appels.some((a) => a.prog === "osrm-extract")), "osrm-extract jamais lance");
  libre = 1 * GO; // osrm-extract remplit le volume
  assert.equal(await sousDelai(preparation), false, "osrm-extract continue d'ecrire sous le plancher");
  const extract = processus.appels.find((a) => a.prog === "osrm-extract");
  assert.ok(extract.enfant.tue.length > 0, "osrm-extract n'a pas ete arrete");
  assert.match(g.etat().derniereErreur?.message || "", /espace disque sous le plancher .*extract/);
  assert.equal(fs.existsSync(path.join(inst.dossier, "courante.json")), false);

  // Sous le plancher des le depart : aucune etape n'est lancee.
  const avant = processus.appels.length;
  assert.equal(await sousDelai(g.preparer(ZONE_TEST)), false);
  assert.equal(processus.appels.length, avant, "une etape lancee sous le plancher");
  assert.match(g.etat().derniereErreur?.message || "", /espace disque sous le plancher/);
});

test("plancher pendant un telechargement : il est interrompu avant de remplir le volume", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" }, { lent: true });
  // Le disque se remplit des que le corps de l'extrait arrive.
  const libre = () => (reseau.appels.some((a) => a.url.endsWith(".osm.pbf")) ? 1 * GO : 100 * GO);
  const processus = fauxProcessus();
  const g = gestionnaire(inst, { reseau, processus, libre });
  g.delais.disque = 5;
  g.demarrer();
  await g.demarrage;
  assert.equal(await g.preparer(ZONE_TEST), false, "telechargement mene a son terme sous le plancher");
  assert.match(g.etat().derniereErreur?.message || "", /espace disque sous le plancher \(téléchargement de europe\/a\)/);
  assert.deepEqual(processus.appels, []);
});

test("plancher dans le choix de la zone ; les extraits d'une autre zone sont rendus au disque", async () => {
  const z = async (libre) => (await gestionnaire(installation(), { libre, memoire: 16 * GO }).zoneVoulue()).zone?.id ?? null;
  assert.equal(await z(9 * GO), "region", "temoin : 9 Go libres suffisent a la region");
  assert.equal(await z(7 * GO), null, "7 Go libres : la region (6 Go) prendrait la place de la base");

  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" });
  const g = gestionnaire(inst, { reseau, processus: fauxProcessus({ echec: "osrm-extract" }) });
  g.demarrer();
  await g.demarrage;
  const tele = path.join(inst.dossier, "telechargements");
  // Restes d'une zone precedente : comptes comme « disponibles » par le choix.
  for (const f of ["europe_ailleurs.osm.pbf", "europe_ailleurs.osm.pbf.json", "europe_loin.osm.pbf.part", "europe_loin.osm.pbf.part.json"])
    fs.writeFileSync(path.join(tele, f), "x");
  assert.equal(await g.preparer(ZONE_TEST), false);
  assert.deepEqual(fs.readdirSync(tele).sort(), ["europe_a.osm.pbf", "europe_a.osm.pbf.json", "europe_b.osm.pbf", "europe_b.osm.pbf.json"],
    "extraits d'une autre zone gardes (ou ceux de la zone perdus apres l'echec)");
});

test("etape sans fin : arretee au bout du delai maximal, le gestionnaire reste libre pour la suite", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "extrait A", "europe/b": "extrait B" });
  const processus = fauxProcessus({ bloque: "osrm-extract" });
  const g = gestionnaire(inst, { reseau, processus });
  g.delais.etapeMax = 50;
  g.demarrer();
  await g.demarrage;
  assert.equal(await sousDelai(g.preparer(ZONE_TEST)), false, "une etape bloquee fige le gestionnaire");
  assert.equal(g.enCours, null);
  assert.match(g.etat().derniereErreur?.message || "", /extract : aucune fin au bout de/);
  assert.ok(processus.appels.find((a) => a.prog === "osrm-extract").enfant.tue.includes("SIGKILL"));
});

test("dossier des cartes supprime a la main : l'essai est note, un echec n'est pas relance tous les quarts d'heure", async () => {
  const inst = installation();
  const reseau = fauxReseau({ "europe/a": "A", "europe/b": "B" });
  let maintenant = new Date("2026-09-23T12:00:00Z");
  const g = gestionnaire(inst, {
    env: { SEREO_OSRM_ZONE: "europe/a,europe/b" }, reseau, processus: fauxProcessus({ echec: "osrm-extract" }), maintenant: () => maintenant,
  });
  g.demarrer();
  await g.demarrage;
  fs.rmSync(inst.dossier, { recursive: true, force: true });
  assert.equal(await g.verifierPlanning(), true, "dossier supprime : la carte n'est pas refaite tout de suite");
  assert.equal(lireSuivi(inst).derniereTentative, "2026-09-23T12:00:00.000Z", "essai non note");
  maintenant = new Date("2026-09-23T12:15:00Z");
  assert.equal(await g.verifierPlanning(), false, "echec relance un quart d'heure plus tard");
});

test("preparation interrompue (conteneur recree par une release) : reprise au demarrage suivant, sauf apres trois interruptions de suite", async () => {
  const reseau = fauxReseau({ "europe/a": "A", "europe/b": "B" });
  const env = { SEREO_OSRM_ZONE: "europe/a,europe/b" };
  const essai = async (suivi) => {
    const inst = installation();
    fs.mkdirSync(inst.dossier, { recursive: true });
    fs.writeFileSync(path.join(inst.dossier, "suivi.json"), JSON.stringify(suivi));
    const g = gestionnaire(inst, { env, reseau, processus: fauxProcessus(), maintenant: () => new Date("2026-09-23T12:00:00Z") });
    g.demarrer();
    await g.demarrage;
    return { inst, lance: await g.verifierPlanning() };
  };
  // Commencee a 10 h, jamais finie : le conteneur a ete recree pendant la preparation.
  const reprise = await essai({ derniereTentative: "2026-09-23T10:00:00.000Z" });
  assert.equal(reprise.lance, true, "preparation interrompue par un redemarrage : repoussee au surlendemain comme un echec");
  assert.equal(lireSuivi(reprise.inst).interruptions, 0, "compteur non remis a zero apres une preparation finie");
  // Temoins : un essai FINI (echec) garde la regle des 20 h ; trois interruptions de suite aussi.
  assert.equal((await essai({ derniereTentative: "2026-09-23T10:00:00.000Z", derniereFin: "2026-09-23T10:30:00.000Z" })).lance, false,
    "un echec termine est relance avant 20 h");
  assert.equal((await essai({ derniereTentative: "2026-09-23T10:00:00.000Z", interruptions: 2 })).lance, false,
    "interrompue trois fois de suite (la preparation fait-elle tomber le conteneur ?) : relancee sans fin");
});

// --- 11. La ligne de l'ecran Parametres ----------------------------------------
test("resume : une phrase par etat, tailles lisibles (Mo sous 1 Go)", () => {
  const { resumer } = require("../lib/osrm-local");
  const carte = { actif: true, zone: "Bourgogne-Franche-Comté", dateCarte: "2026-09-22T23:08:07Z", espaceUtilise: 1247767 };
  assert.equal(resumer({ ...carte, pret: true }), "Sur carte locale « Bourgogne-Franche-Comté », données du 23/09/2026, 1 Mo.");
  assert.equal(resumer({ ...carte, pret: true, espaceUtilise: 3.4 * GO }), "Sur carte locale « Bourgogne-Franche-Comté », données du 23/09/2026, 3,4 Go.");
  assert.match(resumer({ ...carte, pret: false }), /^Serveur public le temps que la carte locale « Bourgogne-Franche-Comté »/);
  assert.equal(resumer({ actif: true, zone: null, zoneVoulue: "Bourgogne-Franche-Comté", etape: "téléchargement 1/2 : 42 %" }),
    "Serveur public en attendant la carte locale « Bourgogne-Franche-Comté » : téléchargement 1/2 : 42 %.");
  assert.equal(resumer({ actif: false, raison: "coupé par SEREO_OSRM_LOCAL=0" }), "Serveur public (coupé par SEREO_OSRM_LOCAL=0).");
});

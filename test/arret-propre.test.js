// Robustesse (25/09, chasse aux defauts, section 4) : l'arret au
// redeploiement. Avant : aucun gestionnaire de SIGTERM -- `docker stop`
// tuait Node sur le coup (749 ms, code 143 mesures), la requete en cours
// recevait une reponse vide, la base n'etait ni validee ni fermee, et une
// sauvegarde interrompue laissait son db-...gz.tmp pour toujours.
//
// Trois bancs : le gestionnaire installe par startServer, appele dans ce
// processus (tous systemes) ; le nettoyage des fichiers temporaires au
// demarrage ; un VRAI SIGTERM envoye a un serveur lance a part (hors Windows :
// `kill` n'y envoie pas de signal, il termine le processus).

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const http = require("node:http");
const { DatabaseSync } = require("node:sqlite");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-arret-"));
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(root, "db.json");
process.env.SEREO_SQLITE_PATH = path.join(root, "db.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(root, "uploads");
process.env.SEREO_BACKUP_DIR = path.join(root, "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";
process.env.SEREO_SKIP_RELEASE_FETCH = "1";
process.env.SEREO_OSRM_LOCAL = "0";
process.env.SEREO_PURGE_TOURNEES_MOIS = "0";

const S = require("../server");
const sorties = [];

before(() => {
  S._quitterPourTest(code => { sorties.push(code); });
});
after(() => {
  S.closeStorage();
  fs.rmSync(root, { recursive: true, force: true });
});

const attendre = ms => new Promise(r => setTimeout(r, ms));

/** Un classeur de stock minimal (une feuille, en-tetes Code / Nom / Quantite). */
function classeurStock() {
  const { zipSync, strToU8 } = require("fflate");
  const cellule = (ref, v) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const feuille = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`
    + `<row r="1">${cellule("A1", "Code")}${cellule("B1", "Nom")}${cellule("C1", "Quantite")}</row>`
    + `<row r="2">${cellule("A2", "P1")}${cellule("B2", "Produit")}${cellule("C2", "12")}</row></sheetData></worksheet>`;
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Stock" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(feuille)
  }));
}

/**
 * Un import dont le fichier arrive en deux fois : la requete est EN COURS
 * (hors de la file d'ecriture) tant que la suite n'est pas envoyee.
 */
function importEnDeuxFois(base) {
  const frontiere = `----sereo-arret-${Date.now()}`;
  const contenu = Buffer.concat([
    Buffer.from(`--${frontiere}\r\nContent-Disposition: form-data; name="file"; filename="stock.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    classeurStock(),
    Buffer.from(`\r\n--${frontiere}--\r\n`)
  ]);
  let envoyerLaSuite;
  const corps = new ReadableStream({
    start(flux) {
      flux.enqueue(new Uint8Array(contenu.subarray(0, 120)));
      envoyerLaSuite = () => { flux.enqueue(new Uint8Array(contenu.subarray(120))); flux.close(); };
    }
  });
  const reponse = fetch(`${base}/api/import/stock`, {
    method: "POST", body: corps, duplex: "half",
    headers: { Origin: base, connection: "close", "Content-Type": `multipart/form-data; boundary=${frontiere}` }
  }).then(async r => ({ status: r.status, body: await r.text() }));
  return { reponse, envoyerLaSuite: () => envoyerLaSuite() };
}

async function demander(base, chemin, init = {}) {
  const res = await fetch(base + chemin, { ...init, headers: { Origin: base, connection: "close", "Content-Type": "application/json", ...(init.headers || {}) } });
  const texte = await res.text();
  let body;
  try { body = JSON.parse(texte); } catch { body = texte; }
  return { status: res.status, body };
}

test("au demarrage, les fichiers temporaires d'une sauvegarde interrompue sont supprimes, les sauvegardes restent", async () => {
  S.writeDb({ ...S.defaultDb(), stock: [{ id: "p1", code: "P1", nom: "Produit", quantite: 10 }] }, { backup: false });
  S.closeStorage();
  const dossier = process.env.SEREO_BACKUP_DIR;
  fs.mkdirSync(dossier, { recursive: true });
  const orphelin = "db-2026-09-24T16-18-27-771Z.sqlite.gz.tmp"; // le nom mesure par le rapport
  const sauvegarde = "db-2026-09-24T09-00-00-000Z.sqlite.gz";
  fs.writeFileSync(path.join(dossier, orphelin), Buffer.alloc(4096, 1));
  fs.writeFileSync(path.join(dossier, sauvegarde), Buffer.alloc(64, 2));
  const deuxHeures = (Date.now() - 2 * 3600 * 1000) / 1000;
  fs.utimesSync(path.join(dossier, sauvegarde), deuxHeures, deuxHeures);

  const serveur = S.startServer(0, "127.0.0.1");
  await new Promise(r => serveur.once("listening", r));
  try {
    const restants = fs.readdirSync(dossier);
    assert.ok(!restants.includes(orphelin), `le fichier temporaire orphelin est reste : ${restants.join(", ")}`);
    assert.ok(restants.includes(sauvegarde), "une vraie sauvegarde a ete supprimee");
  } finally {
    await new Promise(r => serveur.close(r));
  }
});

test("SIGTERM : la requete en cours finit (200), les ecritures et la sauvegarde aussi, la base est fermee, sortie 0", async () => {
  S.writeDb({ ...S.defaultDb(), stock: [{ id: "p1", code: "P1", nom: "Produit", quantite: 10 }] }, { backup: false });
  S.closeStorage();
  // Une sauvegarde vieille de deux heures : le geste en declenchera une neuve.
  fs.mkdirSync(process.env.SEREO_BACKUP_DIR, { recursive: true });
  const ancienne = path.join(process.env.SEREO_BACKUP_DIR, "db-2026-09-24T08-00-00-000Z.sqlite.gz");
  if (!fs.existsSync(ancienne)) fs.writeFileSync(ancienne, Buffer.alloc(64, 2));
  const deuxHeures = (Date.now() - 2 * 3600 * 1000) / 1000;
  for (const nom of fs.readdirSync(process.env.SEREO_BACKUP_DIR)) fs.utimesSync(path.join(process.env.SEREO_BACKUP_DIR, nom), deuxHeures, deuxHeures);
  const avantArret = new Set(fs.readdirSync(process.env.SEREO_BACKUP_DIR));

  const serveur = S.startServer(0, "127.0.0.1");
  await new Promise(r => serveur.once("listening", r));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  let liberer = () => {};
  try {
    const gestionnaires = process.listeners("SIGTERM").filter(f => f.name === "arretPropreDeSereo");
    assert.equal(gestionnaires.length, 1, "startServer n'installe aucun gestionnaire de SIGTERM (ou en installe plusieurs)");

    // Une ecriture en cours : le verrou d'ecriture est tenu, le geste attend.
    // Il passe par une connexion gardee ouverte (keep-alive, comme un
    // navigateur), ou une DEUXIEME requete attend son tour : elle partira sur
    // la meme connexion pendant l'arret.
    const verrou = S._withWriteLockForTest(() => new Promise(r => { liberer = r; }));
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const parAgent = (methode, chemin, corps) => new Promise(resolve => {
      const req = http.request({ host: "127.0.0.1", port: serveur.address().port, path: chemin, method: methode, agent,
        headers: { Origin: base, "Content-Type": "application/json" } }, res => {
        let texte = "";
        res.on("data", d => { texte += d; });
        res.on("end", () => resolve({ status: res.statusCode, body: texte }));
      });
      req.on("error", error => resolve({ status: `coupee (${error.code})` }));
      req.end(corps);
    });
    const geste = parAgent("PATCH", "/api/stock/p1", JSON.stringify({ quantite: 7 }));
    const suivante = parAgent("GET", "/api/stock");
    // Et un import dont le fichier n'est pas encore arrive en entier.
    const envoi = importEnDeuxFois(base);
    await attendre(150);

    gestionnaires[0](); // ce que fait le signal
    await attendre(50);
    await assert.rejects(fetch(base + "/healthz"), "le serveur accepte encore de nouvelles connexions pendant l'arret");
    assert.deepEqual(sorties, [], "le processus est sorti avant la fin de la requete en cours");

    setTimeout(() => liberer(), 200);
    setTimeout(() => envoi.envoyerLaSuite(), 300);
    const reponse = await geste;
    await verrou;
    assert.equal(reponse.status, 200, `la requete en cours a ete coupee : ${JSON.stringify(reponse.body)}`);
    // Arrivee pendant l'arret sur la connexion deja ouverte : 503, que la file
    // hors ligne sait renvoyer -- ni servie a moitie, ni coupee.
    const tardive = await suivante;
    agent.destroy();
    assert.equal(tardive.status, 503, `une requete arrivee pendant l'arret : ${JSON.stringify(tardive)}`);
    const importe = await envoi.reponse.catch(error => ({ status: `coupee (${error.cause?.code || error.message})` }));
    assert.equal(importe.status, 200, `l'import en cours a ete coupe : ${JSON.stringify(importe)}`);

    await S._arreterProprement(); // la meme promesse : attend la fin de l'arret
    assert.deepEqual(sorties, [0]);
  } finally {
    // Sur le code d'avant (aucun arret), rien ne doit rester ouvert.
    liberer();
    if (serveur.listening) {
      serveur.closeAllConnections();
      await new Promise(r => serveur.close(r));
    }
  }
  // La base : validee et fermee (plus de journal WAL), le geste y est.
  assert.ok(!fs.existsSync(`${process.env.SEREO_SQLITE_PATH}-wal`) || fs.statSync(`${process.env.SEREO_SQLITE_PATH}-wal`).size === 0,
    "la base n'a pas ete fermee proprement (journal WAL encore plein)");
  const cnx = new DatabaseSync(process.env.SEREO_SQLITE_PATH, { readOnly: true });
  const quantite = cnx.prepare("SELECT stock_actuel FROM produits WHERE id = 'p1'").get().stock_actuel;
  const mouvements = cnx.prepare("SELECT payload FROM mouvements_stock").all().map(m => JSON.parse(m.payload));
  cnx.close();
  assert.ok(mouvements.some(m => m.oldQuantity === 10 && m.newQuantity === 7), "le geste n'est pas dans la base");
  assert.equal(quantite, 12, "l'import n'est pas dans la base");
  // La sauvegarde partie avec le geste est finie : pas de fichier temporaire.
  const fichiers = fs.readdirSync(process.env.SEREO_BACKUP_DIR);
  assert.deepEqual(fichiers.filter(n => n.endsWith(".tmp")), [], `sauvegarde inachevee : ${fichiers.join(", ")}`);
  assert.equal(fichiers.filter(n => n.endsWith(".sqlite.gz") && !avantArret.has(n)).length, 1, `la sauvegarde du geste manque : ${fichiers.join(", ")}`);
});

test("un vrai SIGTERM (processus a part) : la requete en cours recoit 200 et le serveur sort avec 0", { skip: process.platform === "win32" ? "kill n'envoie pas de signal sous Windows" : false }, async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-arret-reel-"));
  const fichier = path.join(dossier, "db.sqlite");
  // Un port libre, choisi par le systeme.
  const port = await new Promise((resolve, reject) => {
    const sonde = require("node:net").createServer();
    sonde.once("error", reject);
    sonde.listen(0, "127.0.0.1", () => { const p = sonde.address().port; sonde.close(() => resolve(p)); });
  });
  const enfant = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), SEREO_HOST: "127.0.0.1", SEREO_SQLITE_PATH: fichier, SEREO_DB_PATH: path.join(dossier, "x.json"),
      SEREO_UPLOAD_DIR: path.join(dossier, "up"), SEREO_BACKUP_DIR: path.join(dossier, "bk") },
    stdio: "ignore"
  });
  const fin = new Promise(r => enfant.once("exit", (code, signal) => r({ code, signal })));
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + "/healthz", { headers: { connection: "close" } })).ok) break; } catch { /* pas encore */ }
      await attendre(100);
    }
    // Un autre processus tient la base : l'ecriture du serveur attend
    // (busy_timeout, 5 s), SIGTERM arrive pendant l'attente.
    const verrou = new DatabaseSync(fichier);
    verrou.exec("BEGIN EXCLUSIVE");
    const geste = demander(base, "/api/settings/appearance", { method: "PATCH", body: JSON.stringify({ themeId: "menthe" }) });
    await attendre(300);
    enfant.kill("SIGTERM");
    await attendre(700);
    verrou.exec("ROLLBACK");
    verrou.close();
    const reponse = await geste;
    const sortie = await fin;
    assert.equal(reponse.status, 200, `la requete en cours a ete coupee : ${JSON.stringify(reponse.body)}`);
    assert.deepEqual(sortie, { code: 0, signal: null }, "le serveur a ete tue au lieu de s'arreter");
  } finally {
    if (enfant.exitCode === null && enfant.signalCode === null) enfant.kill("SIGKILL");
    await fin;
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

// v1.17.1 — verifie endpoint diagnostic, settings.tournee calibrables,
// estimateRouteMetrics qui les consomme, PATCH /api/settings/tournee bornes.
//
// Posture adverse : tests qui ECHOUERAIENT si l'implementation etait stubbee.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-v17-1-"));
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const {
  app,
  readDb,
  writeDb,
  normalizeSettings,
  _estimateRouteMetrics,
  _scanSuspiciousDates,
  closeStorage
} = require("../server");

let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  return new Promise(resolve => server.close(() => { closeStorage(); resolve(); }));
});

async function api(urlPath, init = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, init);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { status: res.status, body };
}

// ── normalizeSettings : tournee defaut + bornes ──────────────────────────────

test("V1171.a — normalizeSettings injecte tournee defaut (28 km/h, 6 min)", () => {
  const s = normalizeSettings({});
  assert.equal(s.tournee.averageSpeedKmh, 28);
  assert.equal(s.tournee.stopDurationMin, 6);
});

test("V1171.b — normalizeSettings clamp vitesse hors bornes (5 -> 28 defaut)", () => {
  const s = normalizeSettings({ tournee: { averageSpeedKmh: 5 } });
  assert.equal(s.tournee.averageSpeedKmh, 28, "5 km/h trop bas, fallback");

  const s2 = normalizeSettings({ tournee: { averageSpeedKmh: 200 } });
  assert.equal(s2.tournee.averageSpeedKmh, 28, "200 km/h trop haut, fallback");

  const s3 = normalizeSettings({ tournee: { averageSpeedKmh: 35 } });
  assert.equal(s3.tournee.averageSpeedKmh, 35, "35 km/h dans plage");
});

test("V1171.c — normalizeSettings clamp duree d'arret (40 -> 6 defaut)", () => {
  const s = normalizeSettings({ tournee: { stopDurationMin: 40 } });
  assert.equal(s.tournee.stopDurationMin, 6);

  const s2 = normalizeSettings({ tournee: { stopDurationMin: -1 } });
  assert.equal(s2.tournee.stopDurationMin, 6);

  const s3 = normalizeSettings({ tournee: { stopDurationMin: 10 } });
  assert.equal(s3.tournee.stopDurationMin, 10);
});

test("V1171.d — normalizeSettings rejette tournee de type invalide (string -> defaut)", () => {
  const s = normalizeSettings({ tournee: "not an object" });
  assert.equal(s.tournee.averageSpeedKmh, 28);
  assert.equal(s.tournee.stopDurationMin, 6);
});

// ── estimateRouteMetrics : utilise les settings ──────────────────────────────

test("V1171.e — estimateRouteMetrics utilise vitesse settings (56 vs 28 km/h)", () => {
  const orders = [
    { lat: 47.2378, lng: 6.0241 },
    { lat: 47.0937, lng: 5.4906 }
  ];
  const slow = _estimateRouteMetrics(orders, { averageSpeedKmh: 28, stopDurationMin: 0 });
  const fast = _estimateRouteMetrics(orders, { averageSpeedKmh: 56, stopDurationMin: 0 });
  assert.ok(Math.abs(fast.estimatedDuration - slow.estimatedDuration / 2) <= 1,
    `slow=${slow.estimatedDuration} fast=${fast.estimatedDuration} (attendu fast ~ slow/2)`);
});

test("V1171.f — estimateRouteMetrics utilise stopDurationMin (10 min * 3 stops = +30 min)", () => {
  const orders = [
    { lat: 47.2378, lng: 6.0241 },
    { lat: 47.0937, lng: 5.4906 },
    { lat: 47.10, lng: 5.50 }
  ];
  const noStop = _estimateRouteMetrics(orders, { averageSpeedKmh: 30, stopDurationMin: 0 });
  const withStop = _estimateRouteMetrics(orders, { averageSpeedKmh: 30, stopDurationMin: 10 });
  assert.equal(withStop.estimatedDuration - noStop.estimatedDuration, 30);
});

test("V1171.g — estimateRouteMetrics defaut si settings absent", () => {
  const orders = [
    { lat: 47.2378, lng: 6.0241 },
    { lat: 47.0937, lng: 5.4906 }
  ];
  const withDefaults = _estimateRouteMetrics(orders, undefined);
  const withExplicit = _estimateRouteMetrics(orders, { averageSpeedKmh: 28, stopDurationMin: 6 });
  assert.equal(withDefaults.estimatedDuration, withExplicit.estimatedDuration);
});

// ── HTTP : GET + PATCH /api/settings/tournee ────────────────────────────────

test("V1171.h — GET /api/settings/tournee renvoie defaut sur DB fraiche", async () => {
  const r = await api("/api/settings/tournee");
  assert.equal(r.status, 200);
  assert.equal(r.body.averageSpeedKmh, 28);
  assert.equal(r.body.stopDurationMin, 6);
});

test("V1171.i — PATCH /api/settings/tournee accepte 35 km/h + 8 min", async () => {
  const r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ averageSpeedKmh: 35, stopDurationMin: 8 })
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.averageSpeedKmh, 35);
  assert.equal(r.body.stopDurationMin, 8);

  const get = await api("/api/settings/tournee");
  assert.equal(get.body.averageSpeedKmh, 35, "persistance");
});

test("V1171.j — PATCH refuse vitesse 5 km/h (hors plage [10,60])", async () => {
  const r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ averageSpeedKmh: 5 })
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error || "", /Vitesse/i);
});

test("V1171.k — PATCH refuse duree d'arret 50 min", async () => {
  const r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopDurationMin: 50 })
  });
  assert.equal(r.status, 400);
});

test("V1171.l — PATCH accepte stopDurationMin = 0", async () => {
  const r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopDurationMin: 0 })
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.stopDurationMin, 0);
});

// ── /api/diagnostic/suspicious-dates ────────────────────────────────────────

test("V1171.m — scanSuspiciousDates detecte dates aberrantes (fonction pure)", () => {
  // Test direct sur la fonction pure (sans writeDb qui normalise tout via
  // normalizeOrder ligne 2791). Simule des donnees pre-v1.17.0 telles
  // qu'elles existeraient en base apres un ancien import.
  const result = _scanSuspiciousDates([
    { id: "c1", numero: "CMD-2026-001", clientName: "OK", dateCommande: "2026-05-05" },
    { id: "c2", numero: "CMD-2026-002", clientName: "Mois13", dateCommande: "2026-13-05" },
    { id: "c3", numero: "CMD-2026-003", clientName: "Sans", dateCommande: "" },
    { id: "c4", numero: "CMD-2026-004", clientName: "FR-mois13", dateCommande: "31/13/2026" },
    { id: "c5", numero: "CMD-2026-005", clientName: "30fev", dateCommande: "2026-02-30" }
  ]);
  assert.equal(result.totalCommandes, 5);
  assert.equal(result.datesManquantes, 1);
  // c2 (ISO mois 13) + c4 (FR mois 13, mauvais format) + c5 (30 fev) = 3 suspectes
  assert.equal(result.datesSuspectes, 3);
  assert.equal(result.echantillon.length, 3);
});

test("V1171.n — scanSuspiciousDates retourne 0 sur base saine", () => {
  const result = _scanSuspiciousDates([
    { id: "c1", dateCommande: "2026-05-05" },
    { id: "c2", dateCommande: "2026-12-31" }
  ]);
  assert.equal(result.datesSuspectes, 0);
  assert.equal(result.datesManquantes, 0);
  assert.match(result.note, /Aucune date suspecte/i);
});

test("V1171.o — scanSuspiciousDates limite l'echantillon a 20", () => {
  const commandes = Array.from({ length: 50 }, (_, i) => ({
    id: `c${i}`, dateCommande: "2026-13-05"
  }));
  const result = _scanSuspiciousDates(commandes);
  assert.equal(result.datesSuspectes, 50);
  assert.equal(result.echantillon.length, 20, "cap a 20");
});

// ── Revue R1 fixes — regressions ciblees ─────────────────────────────────────

test("V1171.R1.a — estimateRouteMetrics(speed=0) ne divise pas par zero", () => {
  // MAJOR-2 : avant fix, speed=0 -> Infinity en estimatedDuration.
  const orders = [
    { lat: 47.2378, lng: 6.0241 },
    { lat: 47.0937, lng: 5.4906 }
  ];
  const r = _estimateRouteMetrics(orders, { averageSpeedKmh: 0, stopDurationMin: 5 });
  assert.ok(Number.isFinite(r.estimatedDuration), `pas Infinity (got ${r.estimatedDuration})`);
  // speed=0 -> fallback 28, donc resultat doit etre identique au defaut
  const def = _estimateRouteMetrics(orders, { averageSpeedKmh: 28, stopDurationMin: 5 });
  assert.equal(r.estimatedDuration, def.estimatedDuration, "speed=0 utilise le fallback 28");
});

test("V1171.R1.b — estimateRouteMetrics 1 stop : duree = stopTime (pas null)", () => {
  // MINOR-4 : avant fix, totalDistance=null -> estimatedDuration=null
  // meme si on a 5 stops * 6 min = 30 min de manutention.
  const r = _estimateRouteMetrics([{ lat: 47.2378, lng: 6.0241 }], { averageSpeedKmh: 28, stopDurationMin: 8 });
  assert.equal(r.totalDistance, null, "1 stop = pas de distance");
  assert.equal(r.estimatedDuration, 8, "1 stop * 8 min = 8 min (avant : null)");
});

test("V1171.R1.c — estimateRouteMetrics coords manquantes : duree = stopTime", () => {
  const r = _estimateRouteMetrics([
    { lat: 47.2378, lng: 6.0241 },
    { lat: "", lng: "" },
    { lat: 47.0937, lng: 5.4906 }
  ], { averageSpeedKmh: 28, stopDurationMin: 10 });
  assert.equal(r.totalDistance, null);
  assert.equal(r.estimatedDuration, 30, "3 stops * 10 min");
});

test("V1171.R1.d — scanSuspiciousDates accepte ISO datetime complet (legacy ensureOrderNumbers)", () => {
  // MINOR-3/14 : '2026-05-05T10:00:00.000Z' n'est PAS suspect car son prefixe
  // 10 chars est un ISO valide.
  const result = _scanSuspiciousDates([
    { id: "c1", dateCommande: "2026-05-05T10:00:00.000Z" },
    { id: "c2", dateCommande: "2026-05-05" }
  ]);
  assert.equal(result.datesSuspectes, 0, "ISO complet accepte (prefixe 10 chars valide)");
});

test("V1171.R1.f — scanSuspiciousDates mirror EXACT de normalizeOrder (serial/blanc)", () => {
  // Consistance (revue Lot 2) : la valeur BRUTE est passee a normalizeDateInput,
  // exactement comme normalizeOrder. Un serial Excel numerique est sain (path
  // number), un blanc retombe sur today (manquant, pas "a corriger"), seule une
  // vraie date non normalisable compte comme suspecte.
  const result = _scanSuspiciousDates([
    { id: "n", dateCommande: 45000 },        // serial Excel ~2023 -> sain
    { id: "b", dateCommande: "   " },        // blanc -> today (manquant)
    { id: "g", dateCommande: "2026-13-05" }  // mois 13 -> non normalisable -> suspect
  ]);
  assert.equal(result.datesSuspectes, 1, "seule la date non normalisable est suspecte");
  assert.equal(result.datesManquantes, 1, "le blanc compte comme manquant, pas suspect");
});

test("V1171.R1.e — scanSuspiciousDates cap MAX_SCAN avec troncature signalee", () => {
  // MAJOR-3 : 60000 commandes -> 50000 scannees + flag troncature
  const commandes = Array.from({ length: 60000 }, (_, i) => ({
    id: `c${i}`, dateCommande: "2026-05-05"
  }));
  const result = _scanSuspiciousDates(commandes);
  assert.equal(result.totalCommandes, 60000);
  assert.equal(result.commandesAnalysees, 50000);
  assert.equal(result.troncature, true);
});

test("V1171.R1.f — scanSuspiciousDates non-troncature si <= MAX_SCAN", () => {
  const commandes = Array.from({ length: 100 }, (_, i) => ({
    id: `c${i}`, dateCommande: "2026-05-05"
  }));
  const result = _scanSuspiciousDates(commandes);
  assert.equal(result.troncature, false);
  assert.equal(result.commandesAnalysees, 100);
});

test("V1171.R1.g — PATCH refuse averageSpeedKmh string (typeof number strict)", async () => {
  // MINOR-11 : Number("30")=30 passait avant ; maintenant typeof number requis
  const r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ averageSpeedKmh: "30" })
  });
  assert.equal(r.status, 400, "string refuse");
});

test("V1171.R1.h — PATCH refuse averageSpeedKmh false (Number(false)=0 jadis accepte)", async () => {
  const r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ averageSpeedKmh: false })
  });
  assert.equal(r.status, 400);
});

test("V1171.R1.i — PATCH arrondit a l'entier (slider step=1)", async () => {
  // MINOR-16 : 35.7 -> 36 (Math.round)
  const r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ averageSpeedKmh: 35.7 })
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.averageSpeedKmh, 36, "35.7 -> 36 (Math.round)");
});

test("V1171.R1.j — GET diagnostic retourne header Cache-Control: no-store", async () => {
  // MINOR-10 : reponse contient PII, ne doit pas etre cacheable.
  const res = await fetch(`${baseUrl}/api/diagnostic/suspicious-dates`);
  assert.match(res.headers.get("cache-control") || "", /no-store/i);
});

test("V1171.R1.k — normalizeSettings sur string corrompue ne spread pas les index", () => {
  // NIT-15 : si settings = "broken", `...settings` posait '0':'b', '1':'r', etc.
  const s = normalizeSettings("not an object");
  assert.equal(s["0"], undefined, "pas de spread d'indices");
  assert.equal(s.tournee.averageSpeedKmh, 28);
});

test("V1171.R1.l — defaultDb expose tournee + orderNumbering (alignement normalizeSettings)", () => {
  const { defaultDb } = require("../server");
  const db = defaultDb();
  assert.equal(db.settings.tournee.averageSpeedKmh, 28);
  assert.equal(db.settings.tournee.stopDurationMin, 6);
  assert.equal(db.settings.orderNumbering.prefix, "CMD");
  assert.equal(db.settings.orderNumbering.resetAnnually, true);
});

test("V1171.R1.m — PATCH tournee : champs en plus dans le body sont ignores (pas d'echec)", async () => {
  // Le finding MINOR-9 (limit body 1kb) n'est PAS applique car le middleware
  // global express.json({limit:5mb}) parse avant un middleware inline -> no-op.
  // On verifie au moins que les champs inconnus sont ignores silencieusement.
  const r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ averageSpeedKmh: 30, junk: "x".repeat(2000), other: 42 })
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.averageSpeedKmh, 30);
  // Mutation-aware : verifier explicitement que les champs inconnus ne fuient pas dans la reponse
  assert.equal(r.body.junk, undefined, "junk ne doit PAS apparaitre dans la reponse");
  assert.equal(r.body.other, undefined, "other ne doit PAS apparaitre dans la reponse");
});

// ── Revue R2 — renforcements anti-vacuous + nouveaux fixes ──────────────────

test("V1171.R2.a — normalizeSettings rejette Array (typeof===object mais pas plain)", () => {
  // R2 MINOR : Array.isArray check. Sans le fix, ...[1,2,3] spread '0':1, etc.
  const s = normalizeSettings([1, 2, 3]);
  assert.equal(s["0"], undefined, "pas de pollution par index array");
  assert.equal(s["1"], undefined);
  assert.equal(s["2"], undefined);
  assert.equal(s.tournee.averageSpeedKmh, 28, "defauts appliques quand meme");
});

test("V1171.R2.b — estimateRouteMetrics 5 stops + stop=8 = 40 min exact (mutation valeur)", () => {
  // R2 nit : V1171.R1.b ne verifie qu'un stop avec stop=8. Ici on en fait 5 pour
  // s'assurer que la formule est bien orders.length * stop (pas une constante 8).
  const orders = Array.from({ length: 5 }, () => ({}));
  const r = _estimateRouteMetrics(orders, { averageSpeedKmh: 28, stopDurationMin: 8 });
  assert.equal(r.estimatedDuration, 40, "5 * 8 = 40 (mutant : si stub retourne 8, test echoue)");
  assert.equal(r.totalDistance, null);
});

test("V1171.R2.c — scanSuspiciousDates non-troncature : commandesAnalysees == totalCommandes", () => {
  // Mutation : si stub retourne un objet fixe, ce test casse.
  const cmds = [
    { id: "c1", dateCommande: "2026-05-05" },
    { id: "c2", dateCommande: "invalid" },
    { id: "c3", dateCommande: "2026-13-05" }
  ];
  const r = _scanSuspiciousDates(cmds);
  assert.equal(r.totalCommandes, 3);
  assert.equal(r.commandesAnalysees, 3);
  assert.equal(r.troncature, false);
  // Verifie le vrai compte (pas un stub : 2 suspectes = "invalid" + mois 13)
  assert.equal(r.datesSuspectes, 2);
});

test("V1171.R2.d — PATCH stopDurationMin=0 PERSISTE (round-trip GET)", async () => {
  // Renforcement V1171.l : verifier que la valeur 0 est bien lue en GET ensuite,
  // pas juste retournee par le PATCH.
  await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopDurationMin: 0 })
  });
  const get = await api("/api/settings/tournee");
  assert.equal(get.status, 200);
  assert.equal(get.body.stopDurationMin, 0, "0 persiste en base (pas remplace par 6 fallback)");
});

test("V1171.R2.e — PATCH arrondi entre bornes, refus strict hors bornes (validate-then-round)", async () => {
  // R2 minor : V1171.R1.i ne testait qu'un cas. Comportement attendu :
  // - validation lit `raw` brut (pas arrondi), refuse si <10 ou >60
  // - si dans les bornes, Math.round(raw) en storage
  // Cas :
  // - 10.4 -> in bounds -> round -> 10 ✓
  // - 59.6 -> in bounds -> round -> 60 ✓
  // - 60.4 -> raw > 60 -> 400 (rejet strict)
  let r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ averageSpeedKmh: 10.4 })
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.averageSpeedKmh, 10);

  r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ averageSpeedKmh: 59.6 })
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.averageSpeedKmh, 60);

  r = await api("/api/settings/tournee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ averageSpeedKmh: 60.4 })
  });
  // 60.4 > 60 → rejet strict (la validation lit raw, pas round)
  assert.equal(r.status, 400);
});

test("V1171.R3.a — ensureOrderNumbers : Date object brut traite proprement (hardening R3)", () => {
  // R3 finding : si raw est un Date object (theorique), String(date) = "Wed May 30..."
  // -> slice(0,10) = "Wed May 30" -> casse normalizeDateInput. Le hardening
  // garde explicitement instanceof Date pour toISOString.
  const { ensureOrderNumbers } = require("../server");
  const db = {
    commandes: [
      { id: "o1", dateImport: new Date(Date.UTC(2026, 4, 30, 10, 0, 0)) }
    ],
    settings: {}
  };
  ensureOrderNumbers(db);
  assert.equal(db.commandes[0].dateCommande, "2026-05-30",
    `Date object hardening attendu '2026-05-30', got '${db.commandes[0].dateCommande}'`);
});

test("V1171.R2.f — defaultDb identique a normalizeSettings({}) pour tournee+orderNumbering", () => {
  // Mutation : si defaultDb stub retourne {}, normalizeSettings({}).tournee
  // sera 28/6 mais defaultDb.settings.tournee sera undefined -> mismatch.
  const { defaultDb } = require("../server");
  const def = defaultDb().settings;
  const norm = normalizeSettings({});
  assert.deepEqual(def.tournee, norm.tournee, "tournee aligne");
  assert.deepEqual(def.orderNumbering, norm.orderNumbering, "orderNumbering aligne");
});

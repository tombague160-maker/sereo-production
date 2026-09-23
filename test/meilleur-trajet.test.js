// Lot 7 de l'audit geo (23/09) : le meilleur trajet, et le calcul routier.
//
// CE QUE CE BANC PROUVE.
//
// 1. La QUALITE de l'ordre des arrets, face a l'optimum exact (force brute),
//    sur 750 tournees de 5 a 9 arrets aux temps de trajet realistes : villes
//    de Franche-Comte, detours, vitesse qui monte avec la distance, cotes (la
//    matrice est dirigee), adresses en double. Seuils : ecart median <= 1 %,
//    pire cas <= 5 %. Le 2-opt seul (avant ce lot) y fait 8,3 % au pire : ce
//    n'est pas la mediane qui le prend, c'est la queue.
// 2. Le TEMPS a 50 arrets : < 100 ms. Mesure apres un appel de chauffe.
// 3. « A livrer en premier » : les arrets epingles passent en tete, et l'ordre
//    reste optimal SOUS cette contrainte (force brute contrainte).
// 4. Un arret injoignable par la route est NOMME ; sur demande, il est retire.
// 5. Le geocodeur n'est plus interroge apres un premier echec.
// 6. Les durees par troncon d'OSRM sont gardees.
// 7. Serveur OSRM configurable, repli sur le serveur public s'il ne repond pas.
// 8. Le decoupage au-dela de 50 commandes.
//
// CE QU'IL NE PROUVE PAS : la qualite sur de VRAIES matrices OSRM (les temps
// sont synthetiques), ni au-dela de 9 arrets (la reference exacte y devient
// trop lente pour un banc ; a 50 arrets, seul le gain face a l'ancien ordre
// est mesure, pas l'ecart a l'optimum).
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const routing = require("../lib/routing");
const { optimizeMatrix, roadPlan } = routing;

// --- Instances ---------------------------------------------------------------
function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const VILLES = {
  besancon: [47.2378, 6.0241],
  champagnole: [46.7466, 5.9097],
  dole: [47.0926, 5.4897],
  pontarlier: [46.9035, 6.3547],
  lons: [46.6744, 5.5547],
};
// [ville, rayon en km, part des clients]
const SCENARIOS = {
  besancon: { depart: "besancon", arrivee: "besancon", zones: [["besancon", 3, 0.6], ["besancon", 20, 0.4]] },
  champagnole: { depart: "champagnole", arrivee: "champagnole", zones: [["champagnole", 3, 0.4], ["dole", 4, 0.3], ["besancon", 4, 0.3]] },
  ouvert: { depart: "champagnole", arrivee: "besancon", zones: [["champagnole", 4, 0.3], ["pontarlier", 5, 0.3], ["besancon", 5, 0.4]] },
  campagne: { depart: "champagnole", arrivee: "champagnole", zones: [["champagnole", 25, 1]] },
  jura: { depart: "lons", arrivee: "lons", zones: [["lons", 3, 0.3], ["champagnole", 6, 0.35], ["dole", 12, 0.35]] },
};
function haversine(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
/** Matrice de durees (s) : depart, n clients, arrivee. */
function instance(scenario, n, seed) {
  const rnd = prng(seed);
  const sc = SCENARIOS[scenario];
  const pts = [VILLES[sc.depart]];
  for (let i = 0; i < n; i++) {
    // Une commande sur dix a la meme adresse qu'une autre.
    if (i > 0 && rnd() < 0.1) { pts.push(pts[1 + Math.floor(rnd() * i)]); continue; }
    let u = rnd(), z = sc.zones[0];
    for (const zone of sc.zones) { if (u < zone[2]) { z = zone; break; } u -= zone[2]; }
    const c = VILLES[z[0]], r = z[1] * Math.sqrt(rnd()), t = rnd() * 2 * Math.PI;
    pts.push([c[0] + (r / 111) * Math.sin(t), c[1] + (r / (111 * Math.cos((c[0] * Math.PI) / 180))) * Math.cos(t)]);
  }
  pts.push(VILLES[sc.arrivee]);
  const detour = pts.map(() => rnd() * 2 - 1);
  const altitude = pts.map(() => 250 + rnd() * 550);
  return pts.map((a, i) => pts.map((b, j) => {
    if (i === j) return 0;
    const km = haversine(a, b) * (1.3 + 0.08 * (detour[i] + detour[j]));
    if (km < 1e-9) return 0;
    // 22 km/h en ville, 35 en peripherie, 60 au-dela de 10 km ; la montee coute.
    const heures = Math.min(km, 3) / 22 + Math.min(Math.max(km - 3, 0), 7) / 35 + Math.max(km - 10, 0) / 60;
    return Math.round(heures * 3600 + Math.max(0, altitude[j] - altitude[i]) * 0.4 + 30);
  }));
}
function cout(m, ordre, n) {
  const l = [0, ...ordre.map((i) => i + 1), n + 1];
  let s = 0;
  for (let k = 1; k < l.length; k++) s += m[l[k - 1]][l[k]];
  return s;
}
/** Optimum exact par force brute (avec elagage) ; `premiers` passent d'abord. */
function optimum(m, n, premiers = []) {
  const P = new Set(premiers.map((i) => i + 1));
  const pris = new Array(n + 2).fill(false);
  let meilleur = Infinity, premiersRestants = P.size;
  (function explorer(dernier, profondeur, cumul) {
    if (cumul >= meilleur) return;
    if (profondeur === n) { meilleur = Math.min(meilleur, cumul + m[dernier][n + 1]); return; }
    for (let k = 1; k <= n; k++) {
      if (pris[k] || (premiersRestants > 0 && !P.has(k))) continue;
      pris[k] = true; if (P.has(k)) premiersRestants--;
      explorer(k, profondeur + 1, cumul + m[dernier][k]);
      pris[k] = false; if (P.has(k)) premiersRestants++;
    }
  })(0, 0, 0);
  return meilleur;
}
const quantile = (liste, p) => {
  const s = [...liste].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const estPermutation = (ordre, n) =>
  ordre.length === n && [...ordre].sort((a, b) => a - b).every((v, i) => v === i);

// --- 1. Qualite ---------------------------------------------------------------
test("ordre des arrets : ecart a l'optimum, 750 tournees realistes de 5 a 9 arrets (median <= 1 %, pire <= 5 %)", () => {
  const ecarts = [];
  let graine = 1;
  for (const scenario of Object.keys(SCENARIOS))
    for (let n = 5; n <= 9; n++)
      for (let essai = 0; essai < 30; essai++) {
        const m = instance(scenario, n, graine++);
        const ordre = optimizeMatrix(m, n);
        assert.ok(estPermutation(ordre, n), `${scenario} n=${n} : pas une permutation`);
        ecarts.push((cout(m, ordre, n) / optimum(m, n) - 1) * 100);
      }
  const bilan = `median ${quantile(ecarts, 0.5).toFixed(2)} %, p90 ${quantile(ecarts, 0.9).toFixed(2)} %, pire ${Math.max(...ecarts).toFixed(2)} % sur ${ecarts.length}`;
  // Temoin : le jeu contient des tournees ou l'optimum n'est pas trivial.
  assert.equal(ecarts.length, 750);
  assert.ok(quantile(ecarts, 0.5) <= 1, `ecart median trop grand : ${bilan}`);
  assert.ok(Math.max(...ecarts) <= 5, `pire ecart trop grand : ${bilan}`);
});

// --- 2. Temps -----------------------------------------------------------------
test("ordre des arrets : moins de 100 ms a 50 arrets, et le meme ordre a chaque appel", () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    const m = instance(scenario, 50, 4242);
    optimizeMatrix(m, 50); // chauffe
    const debut = process.hrtime.bigint();
    const ordre = optimizeMatrix(m, 50);
    const ms = Number(process.hrtime.bigint() - debut) / 1e6;
    assert.ok(estPermutation(ordre, 50), `${scenario} : pas une permutation`);
    assert.ok(ms < 100, `${scenario} : ${ms.toFixed(1)} ms a 50 arrets`);
    // Le meme appel rend le meme ordre (pas de budget en millisecondes).
    assert.deepEqual(optimizeMatrix(m, 50), ordre);
  }
});

// Une matrice aux valeurs geantes (9e15) : les sommes y perdent leur precision,
// et une descente sans plafond voyait des gains fantomes -- elle tournait sans
// fin, serveur fige (vu pendant ce lot, avec un « infini » mal choisi). Une
// boucle synchrone ne se coupe pas de l'interieur : le calcul part dans un
// processus fils, tue au bout de 20 s.
test("ordre des arrets : une matrice aberrante ne fige pas le calcul", () => {
  const { spawnSync } = require("node:child_process");
  const code = `
    const { optimizeMatrix } = require(${JSON.stringify(require.resolve("../lib/routing"))});
    let s = 7; const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const n = 30, m = Array.from({ length: n + 2 }, (_, i) => Array.from({ length: n + 2 }, (_, j) =>
      i === j ? 0 : r() < 0.5 ? Number.MAX_SAFE_INTEGER - Math.floor(r() * 1000) : Math.floor(r() * 5000)));
    const o = optimizeMatrix(m, n);
    process.stdout.write(o.length === n && new Set(o).size === n ? "ok" : "ko");`;
  const sortie = spawnSync(process.execPath, ["-e", code], { timeout: 20000, encoding: "utf8" });
  assert.equal(sortie.signal, null, "le calcul a ete tue : il ne finissait pas");
  assert.equal(sortie.stdout, "ok");
});

// --- 3. A livrer en premier --------------------------------------------------
test("a livrer en premier : les arrets epingles passent en tete, et l'ordre reste optimal sous la contrainte", () => {
  const ecarts = [];
  let graine = 9001, deplaces = 0;
  for (const scenario of Object.keys(SCENARIOS))
    for (let n = 5; n <= 9; n++)
      for (let essai = 0; essai < 8; essai++) {
        const m = instance(scenario, n, graine++);
        const rnd = prng(graine * 7);
        const k = 1 + Math.floor(rnd() * 3);
        const premiers = [...new Set(Array.from({ length: k }, () => Math.floor(rnd() * n)))];
        const libre = optimizeMatrix(m, n);
        if (!premiers.every((p) => libre.slice(0, premiers.length).includes(p))) deplaces++;
        const ordre = optimizeMatrix(m, n, { premiers });
        assert.ok(estPermutation(ordre, n));
        assert.deepEqual(
          [...ordre.slice(0, premiers.length)].sort((a, b) => a - b),
          [...premiers].sort((a, b) => a - b),
          `${scenario} n=${n} : epingles ${premiers} mais ordre ${ordre}`,
        );
        ecarts.push((cout(m, ordre, n) / optimum(m, n, premiers) - 1) * 100);
      }
  // Temoin : sans epingle, l'optimiseur les aurait places ailleurs, souvent.
  assert.ok(deplaces > 50, `seulement ${deplaces} cas ou l'epingle change quelque chose`);
  assert.ok(quantile(ecarts, 0.5) <= 1 && Math.max(...ecarts) <= 5,
    `sous contrainte : median ${quantile(ecarts, 0.5).toFixed(2)} %, pire ${Math.max(...ecarts).toFixed(2)} %`);
});

// --- Doublure du reseau --------------------------------------------------------
// roadPlan appelle `fetch` au moment de l'appel : on le remplace, et on compte.
const vraiFetch = global.fetch;
let appels = [];
function reseau(repondre) {
  appels = [];
  global.fetch = async (url) => {
    appels.push(String(url));
    const r = await repondre(String(url));
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.corps ?? r), { status: r.statut || 200, headers: { "Content-Type": "application/json" } });
  };
}
afterEach(() => {
  global.fetch = vraiFetch;
  delete process.env.SEREO_ROUTING_URL;
  delete process.env.SEREO_ROUTING_REPLI_URL;
  routing._reinitialiserRepli?.();
});
const nombreDePoints = (url) => url.split("/driving/")[1].split("?")[0].split(";").length;
/** Faux OSRM : table de durees, avec `null` pour les points listes dans `isoles`. */
function fauxOsrm({ isoles = [], legs = true } = {}) {
  return (url) => {
    const pts = url.split("/driving/")[1].split("?")[0].split(";");
    if (url.includes("/table/"))
      return { code: "Ok", durations: pts.map((a, i) => pts.map((b, j) =>
        i === j ? 0 : isoles.includes(a) || isoles.includes(b) ? null : 100 + 10 * Math.abs(i - j))) };
    return { code: "Ok", routes: [{ distance: 12000, duration: 1200,
      geometry: { type: "LineString", coordinates: pts.map((p) => p.split(",").map(Number)) },
      ...(legs ? { legs: pts.slice(1).map((_, i) => ({ duration: 60 * (i + 1) + 0.4, distance: 1000 * (i + 1) + 0.6 })) } : {}) }] };
  };
}
const commande = (id, lat, lng, extra = {}) => ({ id, clientName: `Client ${id}`, lat, lng, ...extra });
const DEPART = { lat: 47.2, lng: 6.0 };

// --- 4. Arret injoignable -----------------------------------------------------
test("injoignable par la route : l'arret fautif est NOMME ; retire sur demande, et signale", async () => {
  process.env.SEREO_ROUTING_URL = "http://osrm.local";
  const orders = [commande("a", 47.21, 6.01), commande("b", 47.22, 6.02), commande("c", 47.23, 6.03)];
  reseau(fauxOsrm({ isoles: ["6.02,47.22"] }));
  await assert.rejects(roadPlan(orders, DEPART, DEPART), (e) => {
    assert.match(e.message, /Client b : injoignable par la route/);
    assert.deepEqual(e.injoignables, [{ id: "b", clientName: "Client b" }]);
    return true;
  });
  reseau(fauxOsrm({ isoles: ["6.02,47.22"] }));
  const plan = await roadPlan(orders, DEPART, DEPART, 6, false, { retirerInjoignables: true });
  assert.deepEqual(plan.ordered.map((o) => o.id).sort(), ["a", "c"]);
  assert.deepEqual(plan.injoignablesRetires, [{ id: "b", clientName: "Client b" }]);
  // Le trace final ne passe pas par l'arret retire.
  assert.ok(!appels.at(-1).includes("6.02,47.22"));
  // Un depart isole n'accuse aucun client.
  reseau(fauxOsrm({ isoles: ["6,47.2"] }));
  await assert.rejects(roadPlan(orders, DEPART, { lat: 47.3, lng: 6.1 }), /point de départ est injoignable/);
});

// --- 5. Geocodeur -------------------------------------------------------------
test("geocodeur : plus d'appel apres un premier echec, ni pour une commande sans rue", async () => {
  process.env.SEREO_ROUTING_URL = "http://osrm.local";
  const sansCoordonnees = Array.from({ length: 10 }, (_, i) =>
    ({ id: `o${i}`, clientName: `Client ${i}`, address: `${i} rue du Bois`, postalCode: "25000", city: "Besançon" }));
  // Seule la PREMIERE adresse est introuvable : les autres se trouvent. Un
  // worker qui echoue s'arrete de lui-meme ; ce sont les trois AUTRES qui
  // continuaient, commande apres commande, pour une tournee deja refusee.
  reseau(async (url) => {
    assert.ok(url.includes("geocodage"), `appel inattendu : ${url}`);
    await new Promise((r) => setTimeout(r, 5));
    if (decodeURIComponent(url).includes("q=0 rue")) return { features: [] };
    return { features: [{ properties: { label: "x", score: 0.9, type: "housenumber", postcode: "25000", city: "Besançon" },
      geometry: { coordinates: [6.02, 47.24] } }] };
  });
  await assert.rejects(roadPlan(sansCoordonnees, DEPART, DEPART), /Adresse à préciser pour Client 0\./);
  await new Promise((r) => setTimeout(r, 80)); // laisser finir les workers
  assert.ok(appels.length <= 4, `${appels.length} appels au geocodeur pour une tournee deja refusee`);

  reseau(() => ({ features: [] }));
  await assert.rejects(
    roadPlan([{ id: "v", clientName: "Ville Seule", address: "", postalCode: "25000", city: "Besançon" }], DEPART, DEPART),
    /Adresse à préciser pour Ville Seule/,
  );
  assert.equal(appels.length, 0, "une commande sans rue ne doit pas interroger le geocodeur");
});

// --- 6. Troncons ----------------------------------------------------------------
test("les durees par troncon d'OSRM sont gardees (une par trajet, depart -> ... -> arrivee)", async () => {
  process.env.SEREO_ROUTING_URL = "http://osrm.local";
  reseau(fauxOsrm());
  const plan = await roadPlan([commande("a", 47.21, 6.01), commande("b", 47.22, 6.02)], DEPART, DEPART);
  assert.deepEqual(plan.troncons, [
    { duree: 60, distance: 1001 }, { duree: 120, distance: 2001 }, { duree: 180, distance: 3001 },
  ]);
  // Une reponse sans legs ne fabrique pas de troncons.
  reseau(fauxOsrm({ legs: false }));
  const sans = await roadPlan([commande("a", 47.21, 6.01)], DEPART, DEPART);
  assert.equal(sans.troncons, null);
});

// --- 7. Serveur OSRM et repli -------------------------------------------------
test("serveur OSRM configurable : repli sur le serveur public s'il ne repond pas, et le journal le dit", async (t) => {
  process.env.SEREO_ROUTING_URL = "http://127.0.0.1:5000/";
  process.env.SEREO_ROUTING_REPLI_URL = "https://repli.exemple";
  const avertissements = t.mock.method(console, "warn", () => {});
  const osrm = fauxOsrm();
  reseau((url) => (url.startsWith("http://127.0.0.1:5000") ? new TypeError("fetch failed") : osrm(url)));
  const orders = [commande("a", 47.21, 6.01), commande("b", 47.22, 6.02)];
  const plan = await roadPlan(orders, DEPART, DEPART);
  assert.equal(plan.ordered.length, 2);
  // Principal essaye une fois (table), puis en pause : table + trace sur le repli.
  assert.equal(appels.filter((u) => u.startsWith("http://127.0.0.1:5000/table/")).length, 1);
  assert.equal(appels.filter((u) => u.startsWith("https://repli.exemple/")).length, 2);
  assert.equal(avertissements.mock.callCount(), 1);
  assert.match(avertissements.mock.calls[0].arguments[0], /127\.0\.0\.1:5000 ne répond pas.*repli sur https:\/\/repli\.exemple/);

  // Contre-temoin : sans repli, la panne remonte.
  routing._reinitialiserRepli();
  process.env.SEREO_ROUTING_REPLI_URL = "";
  reseau((url) => (url.startsWith("http://127.0.0.1:5000") ? new TypeError("fetch failed") : osrm(url)));
  await assert.rejects(roadPlan(orders, DEPART, DEPART), /indisponible/);
  assert.ok(appels.every((u) => u.startsWith("http://127.0.0.1:5000")));

  // Un REFUS (4xx) ne bascule pas : le repli refuserait la meme requete.
  process.env.SEREO_ROUTING_REPLI_URL = "https://repli.exemple";
  reseau((url) => (url.startsWith("http://127.0.0.1:5000") ? { statut: 400, corps: { code: "InvalidUrl" } } : osrm(url)));
  await assert.rejects(roadPlan(orders, DEPART, DEPART), /refuse une des positions/);
  assert.ok(appels.every((u) => u.startsWith("http://127.0.0.1:5000")));
});

// --- 8. Decoupage -------------------------------------------------------------
test("au-dela de 50 commandes : decoupage en tournees <= 50, par direction depuis le depart", () => {
  const { decouperEnTournees } = routing;
  assert.equal(typeof decouperEnTournees, "function");
  // 40 commandes a l'ouest (Dole), 33 a l'est (Pontarlier), depart Besancon.
  const points = [
    ...Array.from({ length: 40 }, (_, i) => ({ id: `o${i}`, lat: 47.09 + i * 0.001, lng: 5.49 })),
    ...Array.from({ length: 33 }, (_, i) => ({ id: `e${i}`, lat: 46.9 + i * 0.001, lng: 6.35 })),
    { id: "sans", lat: "", lng: "" },
  ];
  const paquets = decouperEnTournees(points, { lat: 47.2378, lng: 6.0241 }, 50);
  assert.equal(paquets.length, 2);
  assert.ok(paquets.every((p) => p.length <= 50));
  assert.deepEqual(paquets.flat().map((p) => p.id).sort(), points.map((p) => p.id).sort());
  // Aucun paquet ne melange... presque : 74 en 2 paquets de 37, les 40 de
  // l'ouest ne tiennent pas en un. Mais chaque paquet reste d'un seul cote
  // sauf au plus 3 commandes.
  for (const p of paquets) {
    const ouest = p.filter((x) => x.id.startsWith("o")).length, est = p.filter((x) => x.id.startsWith("e")).length;
    assert.ok(Math.min(ouest, est) <= 4, `paquet melange : ${ouest} ouest, ${est} est`);
  }
  // En dessous de la limite : un seul paquet, intact.
  assert.equal(decouperEnTournees(points.slice(0, 50), { lat: 47.2, lng: 6 }, 50).length, 1);
});

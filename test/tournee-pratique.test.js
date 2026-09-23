// Lot 6 de l'audit geo (23/09) : « pratique au quotidien », les fonctions PURES
// de public/js/domains/tournee-pratique.js (heures d'arrivee, liens « Y aller »
// et « Prevenir », historique) et de lib/tournee-pratique.js (ou inserer une
// commande urgente). Le DOM et le serveur sont juges ailleurs
// (tournee-pratique-serveur.test.js, e2e/tournee-pratique.spec.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const charger = () => import("../public/js/domains/tournee-pratique.js");
const { meilleurePlace } = require("../lib/tournee-pratique");

const MIN = 60000;
const T0 = Date.parse("2026-09-23T08:00:00Z");
const arret = (id, status = "pret_livraison", extra = {}) => ({ id, status, ...extra });
const troncon = (minutes, km) => ({ duree: minutes * 60, distance: km * 1000 });

// --- Heures d'arrivee --------------------------------------------------------------

test("heures : tournee prete, depart maintenant, arret de 6 min entre deux trajets", async () => {
  const { horairesDeTournee } = await charger();
  const route = {
    status: "prete",
    stops: [arret("a"), arret("b"), arret("c")],
    troncons: [troncon(10, 8), troncon(15, 12), troncon(5, 3), troncon(20, 17)]
  };
  const h = horairesDeTournee(route, { maintenant: T0, dureeArretMin: 6 });
  assert.equal(h.arrivees.get("a"), T0 + 10 * MIN);
  assert.equal(h.arrivees.get("b"), T0 + (10 + 6 + 15) * MIN);
  assert.equal(h.arrivees.get("c"), T0 + (10 + 6 + 15 + 6 + 5) * MIN);
  assert.equal(h.retour, T0 + (10 + 6 + 15 + 6 + 5 + 6 + 20) * MIN);
  assert.equal(h.metresRestants, 40000);
  assert.equal(h.premier, "a");
  // La duree d'arret des Parametres compte : a 0 min, tout avance.
  const sansArret = horairesDeTournee(route, { maintenant: T0, dureeArretMin: 0 });
  assert.equal(sansArret.retour, T0 + 50 * MIN);
});

test("heures : en route, recalculees depuis l'heure REELLE du dernier geste", async () => {
  const { horairesDeTournee } = await charger();
  const route = {
    status: "en_livraison",
    startedAt: new Date(T0).toISOString(),
    stops: [
      arret("a", "livre", { deliveredAt: new Date(T0 + 12 * MIN).toISOString() }),
      arret("b", "en_livraison"),
      arret("c", "en_livraison")
    ],
    troncons: [troncon(10, 8), troncon(15, 12), troncon(5, 3), troncon(20, 17)]
  };
  // Livre a 8 h 12, il est 8 h 20 : arrivee chez b a 8 h 12 + 15 min.
  const h = horairesDeTournee(route, { maintenant: T0 + 20 * MIN, dureeArretMin: 6 });
  assert.equal(h.arrivees.get("b"), T0 + 27 * MIN);
  assert.equal(h.arrivees.get("c"), T0 + (27 + 6 + 5) * MIN);
  // Les km restants ne comptent plus le trajet deja fait (depart -> a).
  assert.equal(h.metresRestants, 32000);
  assert.equal(h.premier, "b");
  // En retard sur l'estimation (il est 9 h) : on arrive « maintenant », pas dans le passe.
  const tard = horairesDeTournee(route, { maintenant: T0 + 60 * MIN, dureeArretMin: 6 });
  assert.equal(tard.arrivees.get("b"), T0 + 60 * MIN);
  assert.equal(tard.arrivees.get("c"), T0 + (60 + 6 + 5) * MIN);
});

test("heures : un calcul depuis la position GPS (tronconsDepuis) sert de reference", async () => {
  const { horairesDeTournee } = await charger();
  const route = {
    status: "en_livraison",
    startedAt: new Date(T0).toISOString(),
    tronconsDepuis: new Date(T0 + 40 * MIN).toISOString(),
    stops: [arret("a", "livre", { deliveredAt: new Date(T0 + 12 * MIN).toISOString() }), arret("b", "en_livraison")],
    troncons: [null, troncon(9, 7), troncon(20, 17)]
  };
  const h = horairesDeTournee(route, { maintenant: T0 + 41 * MIN, dureeArretMin: 6 });
  assert.equal(h.arrivees.get("b"), T0 + 49 * MIN);
});

test("heures : un arret fait dans le desordre, au milieu des restants -- le trajet passe par lui", async () => {
  const { horairesDeTournee } = await charger();
  const route = {
    status: "prete",
    stops: [arret("a"), arret("b", "absent"), arret("c")],
    troncons: [troncon(10, 8), troncon(15, 12), troncon(5, 3), troncon(20, 17)]
  };
  const h = horairesDeTournee(route, { maintenant: T0, dureeArretMin: 6 });
  assert.equal(h.arrivees.get("c"), T0 + (10 + 6 + 15 + 5) * MIN);
  assert.equal(h.arrivees.has("b"), false);
  assert.deepEqual(h.trajets.get("c"), { duree: 20 * 60, distance: 15000 });
});

test("heures : rien plutot qu'une heure fausse (troncons absents, desaccordes, troues ; tournee finie)", async () => {
  const { horairesDeTournee } = await charger();
  const base = { status: "prete", stops: [arret("a"), arret("b")] };
  assert.equal(horairesDeTournee({ ...base, troncons: null }, { maintenant: T0 }), null);
  // Reordonnee a la main : le serveur efface les troncons ; une liste qui n'a
  // plus la bonne longueur ne correspond plus a l'ordre.
  assert.equal(horairesDeTournee({ ...base, troncons: [troncon(1, 1), troncon(1, 1)] }, { maintenant: T0 }), null);
  // Un arret retire (commande reportee, retirerDesTourneesSiReportee) laisse
  // un troncon de trop : il ne correspond plus a rien.
  assert.equal(horairesDeTournee({ ...base, troncons: [troncon(1, 1), troncon(1, 1), troncon(1, 1), troncon(1, 1)] }, { maintenant: T0 }), null);
  assert.equal(horairesDeTournee({ ...base, troncons: [troncon(1, 1), null, troncon(1, 1)] }, { maintenant: T0 }), null);
  assert.equal(horairesDeTournee({ ...base, status: "terminee", troncons: [troncon(1, 1), troncon(1, 1), troncon(1, 1)] }, { maintenant: T0 }), null);
  const tousFaits = { status: "en_livraison", stops: [arret("a", "livre"), arret("b", "livre")], troncons: [troncon(1, 1), troncon(1, 1), troncon(1, 1)] };
  assert.equal(horairesDeTournee(tousFaits, { maintenant: T0 }), null);
  // Temoin : la meme tournee, bien formee, rend des heures.
  assert.ok(horairesDeTournee({ ...base, troncons: [troncon(1, 1), troncon(1, 1), troncon(1, 1)] }, { maintenant: T0 }));
});

test("formats : heure arrondie a 5 min, distance, duree", async () => {
  const { formatHeure, formatDistance, formatDuree, formatMinutes } = await charger();
  const d = new Date(2026, 8, 23, 10, 38, 20).getTime();
  assert.equal(formatHeure(d), "10 h 40");
  assert.equal(formatHeure(new Date(2026, 8, 23, 9, 2).getTime()), "9 h 00");
  assert.equal(formatDistance(6200), "6,2 km");
  assert.equal(formatDistance(18400), "18 km");
  assert.equal(formatDistance(420), "400 m");
  assert.equal(formatDuree(14 * 60), "environ 14 min");
  assert.equal(formatDuree(85 * 60), "environ 1 h 25");
  assert.equal(formatMinutes(205), "3 h 25");
});

// --- « Y aller » -------------------------------------------------------------------

test("Y aller : vers les COORDONNEES quand elles existent, pour les trois applications", async () => {
  const { lienNavigation } = await charger();
  const arretGeolocalise = { address: "12 avenue du Général de Gaulle", city: "Besançon", postalCode: "25000", lat: 47.238, lng: 6.024 };
  assert.equal(lienNavigation(arretGeolocalise, "google"), "https://www.google.com/maps/dir/?api=1&destination=47.238,6.024");
  assert.equal(lienNavigation(arretGeolocalise, "waze"), "https://waze.com/ul?ll=47.238,6.024&navigate=yes");
  assert.equal(lienNavigation(arretGeolocalise, "apple", { apple: true }), "https://maps.apple.com/?daddr=47.238,6.024&dirflg=d");
});

test("Y aller : un lieu-dit sans rue mais place a la main a un lien ; sans position, l'adresse en texte", async () => {
  const { lienNavigation } = await charger();
  const lieuDit = { address: "", city: "Foncine-le-Haut", lat: "46.6581", lng: "6.0712" };
  assert.equal(lienNavigation(lieuDit, "google"), "https://www.google.com/maps/dir/?api=1&destination=46.6581,6.0712");
  const texte = { address: "3 rue de la Gare", postalCode: "39300", city: "Champagnole", lat: "", lng: "" };
  assert.equal(lienNavigation(texte, "google"), "https://www.google.com/maps/dir/?api=1&destination=3%20rue%20de%20la%20Gare%2039300%20Champagnole");
  assert.equal(lienNavigation(texte, "waze"), "https://waze.com/ul?q=3%20rue%20de%20la%20Gare%2039300%20Champagnole&navigate=yes");
  // Ni position, ni rue : pas de lien (le bouton se desactive).
  assert.equal(lienNavigation({ city: "Dole" }, "google"), "");
});

test("Y aller : Plans seulement sur iPhone ou iPad ; ailleurs, repli sur Google Maps", async () => {
  const { lienNavigation, applisDeNavigation, estAppareilApple, appliRetenue } = await charger();
  const p = { lat: 47, lng: 6 };
  assert.match(lienNavigation(p, "apple", { apple: false }), /^https:\/\/www\.google\.com\/maps/);
  assert.deepEqual(applisDeNavigation(false).map((a) => a.cle), ["google", "waze"]);
  assert.deepEqual(applisDeNavigation(true).map((a) => a.cle), ["google", "waze", "apple"]);
  assert.equal(estAppareilApple({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }), true);
  assert.equal(estAppareilApple({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(estAppareilApple({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 }), false);
  assert.equal(estAppareilApple({ userAgent: "Mozilla/5.0 (Linux; Android 14)" }), false);
  assert.equal(appliRetenue("inconnue", true), "google");
});

// --- « Prevenir » ------------------------------------------------------------------

test("Prevenir : le SMS porte l'heure estimee, le numero du client, et le texte des Parametres", async () => {
  const { textePrevenir, lienSms, MESSAGE_PREVENIR_DEFAUT } = await charger();
  assert.equal(textePrevenir(MESSAGE_PREVENIR_DEFAUT, "10 h 40"), "Bonjour, je passe vers 10 h 40 pour votre livraison.");
  assert.equal(textePrevenir("", "10 h 40"), "Bonjour, je passe vers 10 h 40 pour votre livraison.");
  assert.equal(textePrevenir("Séréo : arrivée vers {heure}.", "9 h 05"), "Séréo : arrivée vers 9 h 05.");
  // Sans heure connue : « vers {heure} » devient « bientot », jamais « {heure} ».
  assert.equal(textePrevenir(MESSAGE_PREVENIR_DEFAUT, ""), "Bonjour, je passe bientôt pour votre livraison.");
  const texte = "Bonjour, je passe vers 10 h 40 pour votre livraison.";
  assert.equal(lienSms("06 12 34 56 78", texte), `sms:0612345678?body=${encodeURIComponent(texte)}`);
  assert.equal(lienSms("+33 6 12 34 56 78", texte, { apple: true }), `sms:+33612345678&body=${encodeURIComponent(texte)}`);
  assert.equal(lienSms("", texte), "");
});

// --- Historique -----------------------------------------------------------------------

test("historique : km, durees, et par mois un total par secteur (tournees terminees seulement)", async () => {
  const { historiqueDesTournees } = await charger();
  const t = (id, jour, sector, km, debut, fin, livres = 2) => ({
    id, status: "terminee", deliveryDate: jour, sector, totalDistance: km,
    startedAt: `${jour}T${debut}:00Z`, completedAt: `${jour}T${fin}:00Z`,
    stops: [...Array(livres).fill({ status: "livre" }), { status: "absent" }]
  });
  const routes = [
    t("r1", "2026-09-02", "Dole", 42.5, "07:00", "10:30"),
    t("r2", "2026-09-16", "Dole", 38, "07:00", "09:45"),
    t("r3", "2026-09-10", "Besancon", 61.2, "06:30", "11:00", 4),
    t("r4", "2026-08-28", "Dole", 40, "07:00", "10:00"),
    { id: "r5", status: "en_livraison", deliveryDate: "2026-09-23", sector: "Dole", totalDistance: 30, stops: [] },
    { id: "r6", status: "terminee", deliveryDate: "2026-09-20", sector: "Dole", totalDistance: null, startedAt: null, completedAt: "2026-09-20T10:00:00Z", stops: [] }
  ];
  const h = historiqueDesTournees(routes);
  assert.deepEqual(h.tournees.map((x) => x.id), ["r6", "r2", "r3", "r1", "r4"]);
  assert.equal(h.tournees.find((x) => x.id === "r1").minutes, 210);
  assert.deepEqual(h.mois.map((m) => m.mois), ["2026-09", "2026-08"]);
  const sept = h.mois[0];
  assert.deepEqual(sept.secteurs.map((s) => [s.secteur, s.tournees, s.km, s.minutes, s.kmInconnus, s.minutesInconnues]), [
    ["Besancon", 1, 61.2, 270, 0, 0],
    ["Dole", 3, 80.5, 375, 1, 1]
  ]);
  assert.deepEqual(sept.total, { tournees: 4, km: 141.7, minutes: 645, livres: 8 });
});

// --- Ou inserer une commande urgente ------------------------------------------------

test("inserer : la place qui allonge le moins le trajet, egale a la force brute", () => {
  let graine = 7;
  const rnd = () => (graine = (Math.imul(graine, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let essai = 0; essai < 300; essai++) {
    const n = 1 + Math.floor(rnd() * 7);
    const pts = { ancre: [rnd(), rnd()], arrivee: rnd() < 0.2 ? null : [rnd(), rnd()], x: [rnd(), rnd()] };
    for (let i = 0; i < n; i++) pts[i] = [rnd(), rnd()];
    const d = (a, b) => (pts[a] && pts[b] ? Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) : 0);
    const k = meilleurePlace(n, d);
    const suite = (ordre) => ["ancre", ...ordre, "arrivee"].reduce((s, p, i, t) => (i ? s + d(t[i - 1], p) : 0), 0);
    const base = Array.from({ length: n }, (_, i) => i);
    let meilleur = Infinity;
    for (let j = 0; j <= n; j++) meilleur = Math.min(meilleur, suite([...base.slice(0, j), "x", ...base.slice(j)]));
    const obtenu = suite([...base.slice(0, k), "x", ...base.slice(k)]);
    assert.ok(Math.abs(obtenu - meilleur) < 1e-9, `essai ${essai} : place ${k}, ${obtenu} au lieu de ${meilleur}`);
  }
});

// --- Relecture adverse du lot 6 ------------------------------------------------------

test("Y aller : une position APPROXIMATIVE (rue, lieu-dit, commune) laisse la main a l'adresse complete", async () => {
  const { lienNavigation } = await charger();
  const adresse = { address: "48 route de Lons", postalCode: "39300", city: "Champagnole", lat: 46.75, lng: 5.91 };
  const texte = "48%20route%20de%20Lons%2039300%20Champagnole";
  // « au milieu de la rue », « au centre du lieu-dit / de la commune » : le
  // texte (numero compris) mene a la porte, le point non.
  for (const geoPrecision of ["rue", "lieu-dit", "commune"]) {
    assert.equal(lienNavigation({ ...adresse, geoPrecision }, "google"), `https://www.google.com/maps/dir/?api=1&destination=${texte}`, geoPrecision);
    assert.equal(lienNavigation({ ...adresse, geoPrecision }, "waze"), `https://waze.com/ul?q=${texte}&navigate=yes`, geoPrecision);
    assert.equal(lienNavigation({ ...adresse, geoPrecision }, "apple", { apple: true }), `https://maps.apple.com/?daddr=${texte}&dirflg=d`, geoPrecision);
  }
  // Temoins : au numero, placee a la main, ou d'origine inconnue, le point reste.
  for (const geoPrecision of ["numero", "manuel", ""]) {
    assert.equal(lienNavigation({ ...adresse, geoPrecision }, "google"), "https://www.google.com/maps/dir/?api=1&destination=46.75,5.91", geoPrecision || "(vide)");
  }
  // Approximative SANS rue : le texte ne ferait pas mieux, le point reste.
  assert.equal(lienNavigation({ address: "", city: "Foncine-le-Haut", lat: 46.6581, lng: 6.0712, geoPrecision: "lieu-dit" }, "google"),
    "https://www.google.com/maps/dir/?api=1&destination=46.6581,6.0712");
});

test("heures : une tournee SANS arrivee (chemin ouvert) finit, elle ne « revient » pas", async () => {
  const { horairesDeTournee } = await charger();
  const base = { status: "prete", stops: [arret("a"), arret("b")], troncons: [troncon(10, 8), troncon(15, 12), troncon(0, 0)] };
  assert.equal(horairesDeTournee({ ...base, arrival: null }, { maintenant: T0 }).avecRetour, false);
  assert.equal(horairesDeTournee({ ...base, arrival: { lat: 47.2, lng: 6 } }, { maintenant: T0 }).avecRetour, true);
});

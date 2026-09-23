// Lot 6 de l'audit geo (23/09) : « pratique au quotidien », cote serveur.
//
//   POST /api/routes/:id/reoptimiser
//     - tournee PRETE : un nouvel ordre (l'optimiseur du lot 7, « a livrer en
//       premier » garde), avec un autre depart ou une autre arrivee au besoin ;
//     - tournee EN LIVRAISON : les arrets RESTANTS, depuis la position GPS du
//       livreur (arrondie a ~100 m, decision 5) ; les arrets soldes restent en
//       tete, dans leur ordre.
//   POST /api/routes/:id/stops/:stopId/maintenant
//     « Faire maintenant » : l'arret passe en tete des restants.
//   POST /api/routes/:id/ajouter
//     « Ajouter a la tournee en cours » : une commande urgente, inseree la ou
//     elle allonge le moins le trajet.
//
// Chaque ecriture passe par le verrou d'ecriture et par l'idempotence du lot 1
// (X-Sereo-Geste, middleware global). Le calcul routier se fait HORS du verrou,
// sur un instantane ; l'ecriture verifie que la tournee n'a pas change entre-temps.
//
// Les troncons (lot 7) restent alignes sur l'ordre des arrets : un par arret
// (le trajet qui y mene), plus le dernier vers l'arrivee. Apres un changement
// d'ordre en route, les arrets soldes passent en tete et gardent leurs troncons
// d'origine ; ceux des restants sont recalcules. Si le calcul routier echoue,
// l'ordre change quand meme et les troncons tombent (`null`) : l'ecran n'affiche
// plus d'heure plutot qu'une heure fausse, et le dit.

const { randomUUID } = require("node:crypto");
const routing = require("./routing");

const STATUTS_SOLDES = new Set(["livre", "absent", "probleme", "a_reprogrammer"]);
const estSolde = (stop) => STATUTS_SOLDES.has(stop?.status);
const LIBELLE_POSITION_GPS = "Ma position actuelle";

/** La position du telephone, arrondie a 3 decimales (~100 m, decision 5). */
function positionArrondie(brute) {
  const point = routing.coordinates(brute);
  if (!point) return null;
  const arrondi = (v) => Math.round(v * 1000) / 1000;
  return { lat: arrondi(point.lat), lng: arrondi(point.lng), label: LIBELLE_POSITION_GPS };
}

/** Ce qui doit etre identique entre l'instantane du calcul et l'ecriture. */
function empreinteArrets(route) {
  return JSON.stringify([route.status, (route.stops || []).map((s) => [String(s.id), s.status])]);
}

/**
 * Relecture adverse du lot 6 : la position que le calcul a lue pour chaque
 * arret. `empreinteArrets` ne la controle pas ; sans elle, une position
 * corrigee au bureau PENDANT le calcul etait ecrasee par l'ancienne
 * (memoriserPositionDuCalcul), en gardant « placee a la main ». createRoute
 * refuse deja ce cas (lot 3) ; meme message.
 */
function empreintePositions(db, points, positionPourTournee) {
  return JSON.stringify(points.map((p) => {
    const c = routing.coordinates(positionPourTournee(db, p));
    return [String(p.id), c ? c.lat : null, c ? c.lng : null];
  }));
}
const POSITION_CORRIGEE = "Une position a été corrigée pendant le calcul. Recommence.";

/**
 * L'endroit d'ou le livreur repart : l'arret solde le plus recent (par heure
 * du geste) qui a une position, sinon le depart de la tournee.
 */
function pointDeReprise(route) {
  let meilleur = null, heure = -Infinity;
  for (const stop of route.stops || []) {
    if (!estSolde(stop)) continue;
    const point = routing.coordinates(stop);
    const t = Date.parse(stop.deliveredAt || "");
    if (point && (Number.isFinite(t) ? t : 0) >= heure) {
      meilleur = { ...point, label: stop.clientName || "" };
      heure = Number.isFinite(t) ? t : 0;
    }
  }
  return meilleur || routing.coordinates(route.departure);
}

/**
 * Ou inserer `x` dans la suite [ancre, ...restants, arrivee] ? `cout(a, b)`
 * rend le cout du trajet a -> b (a ou b null : extremite absente, cout 0).
 * Rend k : x se place AVANT restants[k] (k = restants.length : a la fin).
 * A cout egal, la place la plus tot. `depuis` : la premiere place permise
 * (relecture adverse du lot 6 : jamais devant un « a livrer en premier »).
 */
function meilleurePlace(nbRestants, cout, depuis = 0) {
  const premiere = Math.min(Math.max(0, depuis), nbRestants);
  let meilleure = premiere, meilleurCout = Infinity;
  for (let k = premiere; k <= nbRestants; k++) {
    const avant = k === 0 ? "ancre" : k - 1;
    const apres = k === nbRestants ? "arrivee" : k;
    const delta = cout(avant, "x") + cout("x", apres) - cout(avant, apres);
    if (delta < meilleurCout - 1e-9) {
      meilleurCout = delta;
      meilleure = k;
    }
  }
  return meilleure;
}

/** Les troncons d'une tournee dont les soldes passent en tete. */
function recomposerTroncons(route, soldes, nouveaux) {
  const anciens = Array.isArray(route.troncons) && route.troncons.length === route.stops.length + 1
    ? route.troncons
    : null;
  const indexParId = new Map(route.stops.map((s, i) => [String(s.id), i]));
  const tete = soldes.map((s) => (anciens ? anciens[indexParId.get(String(s.id))] ?? null : null));
  return nouveaux ? [...tete, ...nouveaux] : null;
}

const sommeConnue = (liste, cle) =>
  (liste || []).reduce((s, t) => s + (t && Number.isFinite(Number(t[cle])) ? Number(t[cle]) : 0), 0);

function registerTourneePratique(app, deps) {
  const {
    readDb,
    writeDb,
    withWriteLock,
    badRequest,
    notFound,
    handleRouteError,
    findClient,
    addHistory,
    setOrderStatus,
    createStop,
    routeAvecTrace,
    positionPourTournee,
    memoriserPositionDuCalcul,
    geocoderAdresse = null,
    distanceKm,
    statutsAPlanifier,
    maxArrets = 50,
  } = deps;

  const wrap = (fn, message) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (e) {
      handleRouteError(e, res, message);
    }
  };
  const trouver = (db, id) => {
    const route = db.routes.find((r) => String(r.id) === String(id));
    if (!route) throw notFound("Tournée introuvable");
    return route;
  };
  const dureeArret = (db) => Number(db.settings?.tournee?.stopDurationMin ?? 6);

  /** Rend la tournee telle que les listes la rendent, et ce que l'ecran doit remplacer. */
  function reponse(db, routeId, orderId = null, extra = {}) {
    const route = routeAvecTrace(db, routeId);
    const order = orderId ? db.commandes.find((o) => String(o.id) === String(orderId)) || null : null;
    const client = order ? findClient(db, order.clientId) || null : null;
    return { route, ...(order ? { order } : {}), ...(client ? { client } : {}), ...extra };
  }

  /**
   * Le trajet des arrets restants dans l'ordre donne, depuis `depart`. Rend
   * null si le calcul routier echoue (ou s'il manque un bout) : l'appelant
   * garde l'ordre et fait tomber les heures.
   */
  async function trajetDansLOrdre(snapshot, restants, depart, arrivee) {
    if (!restants.length || !routing.coordinates(depart) || !routing.coordinates(arrivee)) return null;
    try {
      return await routing.roadPlan(
        restants.map((s) => positionPourTournee(snapshot, s)),
        depart,
        arrivee,
        dureeArret(snapshot),
        true,
        { geocoder: geocoderAdresse },
      );
    } catch {
      return null;
    }
  }

  /** Pose le nouvel ordre [soldes, ...restants] et ce que le calcul a donne. */
  function appliquerOrdre(current, soldes, restants, plan, { depuisPosition = false } = {}) {
    const troncons = recomposerTroncons(current, soldes, plan?.troncons || null);
    current.stops = [...soldes, ...restants].map((s, i) => ({ ...s, orderIndex: i + 1 }));
    current.selectedOrderIds = current.stops.map((s) => s.orderId);
    current.troncons = troncons && troncons.length === current.stops.length + 1 ? troncons : null;
    current.tronconsDepuis = plan && depuisPosition ? new Date().toISOString() : null;
    if (plan) {
      current.geometry = plan.geometry;
      current.routingMode = "road";
      current.calculatedAt = plan.calculatedAt;
      // Le total de la tournee : les trajets deja faits (leurs troncons
      // d'origine, quand on les a) plus le nouveau reste.
      const faits = current.troncons ? current.troncons.slice(0, soldes.length) : [];
      current.totalDistance = Math.round((sommeConnue(faits, "distance") / 1000 + plan.totalDistance) * 10) / 10;
      current.estimatedDuration = Math.round(sommeConnue(faits, "duree") / 60 + soldes.length * (plan.dureeArret ?? 0) + plan.estimatedDuration);
    } else if (current.status === "prete") {
      // Avant le depart, comme un reordonnancement a la main : le trace est a refaire.
      current.geometry = null;
      current.routingMode = "manual";
    }
    // En route, sans calcul : on garde l'ancien trace plutot que d'effacer la
    // carte sous le livreur (meme regle que retirerDesTourneesSiReportee).
    current.updatedAt = new Date().toISOString();
  }

  app.post(
    "/api/routes/:id/reoptimiser",
    wrap(async (req, res) => {
      const snapshot = readDb();
      const route = trouver(snapshot, req.params.id);
      const body = req.body || {};
      if (route.status === "prete") {
        const departure = body.departure || route.departure;
        const arrival = body.arrival || route.arrival;
        // Sans arrivee (tournee creee « sans depart », « retour au depot »
        // decoche) : le chemin ouvert, pas une boucle.
        const plan = await routing.roadPlan(
          route.stops.map((stop) => positionPourTournee(snapshot, stop)),
          departure,
          arrival,
          dureeArret(snapshot),
          false,
          { geocoder: geocoderAdresse, arriveeLibre: !routing.coordinates(arrival) },
        );
        const empreinte = JSON.stringify(route);
        const resultat = await withWriteLock(async () => {
          const db = readDb();
          const current = trouver(db, route.id);
          if (JSON.stringify(current) !== empreinte) throw badRequest("La tournée a changé. Recommence le calcul.");
          plan.ordered.forEach((s) => {
            const order = db.commandes.find((o) => String(o.id) === String(s.orderId));
            if (order) memoriserPositionDuCalcul(db, order, s);
          });
          current.stops = plan.ordered.map(({ geoTrouve, ...s }, i) => ({ ...s, orderIndex: i + 1 }));
          current.selectedOrderIds = current.stops.map((s) => s.orderId);
          const { ordered, ...details } = plan;
          Object.assign(current, details, { tronconsDepuis: null, updatedAt: new Date().toISOString() });
          addHistory(db, "Tournee", "Tournée réoptimisée", { routeId: current.id });
          writeDb(db);
          return reponse(db, current.id);
        });
        return res.json(resultat);
      }
      if (route.status !== "en_livraison") throw badRequest("Cette tournée est terminée.");

      const position = positionArrondie(body.position);
      if (!position) throw badRequest("Position GPS requise pour réoptimiser les arrêts restants.");
      const restants = route.stops.filter((s) => !estSolde(s));
      if (!restants.length) throw badRequest("Plus aucun arrêt à faire dans cette tournée.");
      // Sans arrivee enregistree (tournee creee sans depart) : le plus court
      // CHEMIN OUVERT depuis la position (relecture adverse du lot 6). Avant,
      // l'arrivee devenait la position : une boucle, un retour fictif compte
      // dans les km restants, l'heure de « retour » et totalDistance.
      const arrival = routing.coordinates(route.arrival) ? route.arrival : null;
      const plan = await routing.roadPlan(
        restants.map((stop) => positionPourTournee(snapshot, stop)),
        position,
        arrival,
        dureeArret(snapshot),
        false,
        { geocoder: geocoderAdresse, arriveeLibre: !arrival },
      );
      const empreinte = empreinteArrets(route);
      const positions = empreintePositions(snapshot, restants, positionPourTournee);
      const resultat = await withWriteLock(async () => {
        const db = readDb();
        const current = trouver(db, route.id);
        if (empreinteArrets(current) !== empreinte) throw badRequest("La tournée a changé pendant le calcul. Recommence.");
        if (empreintePositions(db, current.stops.filter((s) => !estSolde(s)), positionPourTournee) !== positions) throw badRequest(POSITION_CORRIGEE);
        const parId = new Map(current.stops.map((s) => [String(s.id), s]));
        plan.ordered.forEach((s) => {
          const order = db.commandes.find((o) => String(o.id) === String(s.orderId));
          if (order) memoriserPositionDuCalcul(db, order, s);
        });
        const soldes = current.stops.filter(estSolde);
        const nouveaux = plan.ordered.map((s) => ({ ...parId.get(String(s.id)), lat: s.lat, lng: s.lng, geoPrecision: s.geoPrecision || "" }));
        appliquerOrdre(current, soldes, nouveaux, { ...plan, dureeArret: dureeArret(db) }, { depuisPosition: true });
        addHistory(db, "Tournee", `Arrêts restants réoptimisés (${nouveaux.length})`, { routeId: current.id });
        writeDb(db);
        return reponse(db, current.id);
      });
      res.json(resultat);
    }, "Erreur réoptimisation tournée"),
  );

  app.post(
    "/api/routes/:id/stops/:stopId/maintenant",
    wrap(async (req, res) => {
      const snapshot = readDb();
      const route = trouver(snapshot, req.params.id);
      if (route.status === "prete") throw badRequest("Avant le départ, déplace l’arrêt avec les flèches.");
      if (route.status !== "en_livraison") throw badRequest("Cette tournée est terminée.");
      const stop = route.stops.find((s) => String(s.id) === String(req.params.stopId));
      if (!stop) throw notFound("Arrêt introuvable");
      if (estSolde(stop)) throw badRequest("Cet arrêt est déjà traité.");
      const soldes = route.stops.filter(estSolde);
      const restants = route.stops.filter((s) => !estSolde(s) && s !== stop);
      const ordre = [stop, ...restants];
      const plan = await trajetDansLOrdre(snapshot, ordre, pointDeReprise(route), route.arrival);
      const empreinte = empreinteArrets(route);
      const resultat = await withWriteLock(async () => {
        const db = readDb();
        const current = trouver(db, route.id);
        if (empreinteArrets(current) !== empreinte) throw badRequest("La tournée a changé pendant le calcul. Recommence.");
        const parId = new Map(current.stops.map((s) => [String(s.id), s]));
        appliquerOrdre(
          current,
          soldes.map((s) => parId.get(String(s.id))),
          ordre.map((s) => parId.get(String(s.id))),
          plan ? { ...plan, dureeArret: dureeArret(db) } : null,
        );
        addHistory(db, "Tournee", `${stop.clientName || "Arrêt"} : fait maintenant`, { routeId: current.id, stopId: stop.id });
        writeDb(db);
        return reponse(db, current.id, stop.orderId, { horairesARecalculer: !plan });
      });
      res.json(resultat);
    }, "Erreur ordre tournée"),
  );

  app.post(
    "/api/routes/:id/ajouter",
    wrap(async (req, res) => {
      const snapshot = readDb();
      const route = trouver(snapshot, req.params.id);
      if (!["prete", "en_livraison"].includes(route.status)) throw badRequest("Cette tournée est terminée.");
      const orderId = String(req.body?.orderId || "");
      const order = snapshot.commandes.find((o) => String(o.id) === orderId);
      if (!order) throw notFound("Commande introuvable");
      // D'abord « deja en tournee » : une commande ajoutee est passee en
      // livraison, et « pas prete » dirait moins bien pourquoi.
      const enCours = (r) => ["prete", "en_livraison"].includes(r.status);
      // Controle refait SOUS le verrou (relecture adverse du lot 6) : une
      // tournee creee au bureau pendant le calcul peut prendre la commande
      // sans changer son statut (createRoute ne pose que routeId).
      const dejaEnTournee = (db) => {
        if (db.routes.some((r) => enCours(r) && r.stops.some((s) => String(s.orderId) === orderId && !estSolde(s))))
          throw badRequest("Cette commande appartient déjà à une tournée active.");
      };
      dejaEnTournee(snapshot);
      if (!statutsAPlanifier.includes(order.status)) throw badRequest("Cette commande n’est pas prête à livrer.");
      if (route.stops.length >= maxArrets) throw badRequest(`Une tournée compte ${maxArrets} arrêts au plus.`);

      const [placee] = await routing.resoudrePositions([positionPourTournee(snapshot, order)], {
        geocoder: geocoderAdresse,
        reference: routing.coordinates(route.departure),
      });
      const restants = route.stops.filter((s) => !estSolde(s));
      const ancre = pointDeReprise(route);
      const arrivee = routing.coordinates(route.arrival);
      const positions = restants.map((s) => routing.coordinates(positionPourTournee(snapshot, s)));
      // Le cout d'un trajet : la duree OSRM quand le serveur repond, sinon la
      // distance a vol d'oiseau (meme classement, a l'echelle pres).
      const noeuds = { ancre, arrivee, x: placee };
      positions.forEach((p, i) => { noeuds[i] = p; });
      const cles = Object.keys(noeuds).filter((k) => noeuds[k]);
      let cout;
      try {
        const table = await routing.tableDesDurees(cles.map((k) => noeuds[k]));
        const rang = new Map(cles.map((k, i) => [k, i]));
        if (table.some((ligne) => ligne.some((v) => !Number.isFinite(v)))) throw new Error("table trouee");
        cout = (a, b) => (rang.has(String(a)) && rang.has(String(b)) ? table[rang.get(String(a))][rang.get(String(b))] : 0);
      } catch {
        cout = (a, b) => (noeuds[a] && noeuds[b] ? distanceKm(noeuds[a], noeuds[b]) : 0);
      }
      // Jamais devant un « a livrer en premier » (decision 9 : il remplace les
      // creneaux) : la premiere place permise suit le dernier d'entre eux.
      const apresLesPremiers = restants.reduce((m, s, i) => (s.livrerEnPremier ? i + 1 : m), 0);
      const k = meilleurePlace(restants.length, cout, apresLesPremiers);

      const nouvelArret = {
        ...createStop(route.id, { ...order, lat: placee.lat, lng: placee.lng, geoPrecision: placee.geoPrecision || "" }, route.stops.length, false),
        // Un identifiant qui ne peut pas deja exister (createStop numerote par
        // rang, et un arret retire laisse son numero a un autre).
        id: `stop-${route.id}-${randomUUID().slice(0, 8)}`,
        status: route.status === "en_livraison" ? "en_livraison" : "pret_livraison",
        ajouteEnRoute: route.status === "en_livraison",
      };
      const ordre = [...restants.slice(0, k), nouvelArret, ...restants.slice(k)];
      const plan = await trajetDansLOrdre(snapshot, ordre, ancre, route.arrival);
      const empreinte = empreinteArrets(route);
      const position = empreintePositions(snapshot, [order], positionPourTournee);
      const resultat = await withWriteLock(async () => {
        const db = readDb();
        const current = trouver(db, route.id);
        if (empreinteArrets(current) !== empreinte) throw badRequest("La tournée a changé pendant le calcul. Recommence.");
        const commande = db.commandes.find((o) => String(o.id) === orderId);
        if (!commande || commande.status !== order.status) throw badRequest("La commande a changé pendant le calcul. Recommence.");
        dejaEnTournee(db);
        if (empreintePositions(db, [commande], positionPourTournee) !== position) throw badRequest(POSITION_CORRIGEE);
        memoriserPositionDuCalcul(db, commande, placee);
        const parId = new Map(current.stops.map((s) => [String(s.id), s]));
        const soldes = current.stops.filter(estSolde);
        appliquerOrdre(
          current,
          soldes,
          ordre.map((s) => (s === nouvelArret ? nouvelArret : parId.get(String(s.id)))),
          plan ? { ...plan, dureeArret: dureeArret(db) } : null,
        );
        commande.routeId = current.id;
        if (current.status === "en_livraison") {
          setOrderStatus(commande, "en_livraison");
          const client = findClient(db, commande.clientId);
          if (client) client.statut = "en_cours";
        }
        commande.updatedAt = new Date().toISOString();
        addHistory(db, "Tournee", `${commande.clientName || "Commande"} : ajoutée à la tournée en cours (arrêt ${soldes.length + k + 1})`, {
          routeId: current.id,
          orderId: commande.id,
        });
        writeDb(db);
        return reponse(db, current.id, commande.id, { horairesARecalculer: !plan, rang: soldes.length + k + 1 });
      });
      res.status(201).json(resultat);
    }, "Erreur ajout à la tournée"),
  );
}

module.exports = {
  registerTourneePratique,
  meilleurePlace,
  pointDeReprise,
  positionArrondie,
  recomposerTroncons,
};

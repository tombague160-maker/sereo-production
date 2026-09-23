const geocodage = require("./geocodage");
const fail = (message, details) =>
  Object.assign(new Error(message), {
    statusCode: 400,
    ...(details ? { details } : {}),
  });
function coordinates(point) {
  if (
    !point ||
    point.lat === "" ||
    point.lng === "" ||
    point.lat == null ||
    point.lng == null
  )
    return null;
  const lat = Number(point.lat),
    lng = Number(point.lng);
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
    ? { lat, lng, label: String(point.label || "") }
    : null;
}
async function json(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": geocodage.USER_AGENT },
    });
    if (!response.ok) throw new Error("Unavailable");
    return await response.json();
  } catch {
    // Seule une vraie panne du service arrive ici : les positions aberrantes
    // sont refusees AVANT l'appel, avec le nom du client (resoudrePositions).
    throw fail(
      "Le service de calcul routier est indisponible. Réessaie dans un instant.",
    );
  }
}
// Libelle d'un probleme d'adresse, a partir d'une entree du geocodeur.
function motifGeocodage(entree) {
  if (!entree) return "adresse incomplète (rue, et ville ou code postal)";
  if (entree.statut === geocodage.STATUTS.ERREUR)
    return "recherche d’adresse indisponible, réessaie dans un instant";
  if (entree.statut === geocodage.STATUTS.AMBIGU)
    return entree.libelle
      ? `adresse ambiguë, proposition : ${entree.libelle}`
      : "adresse ambiguë";
  return "adresse introuvable";
}
/**
 * Resout la position de CHAQUE commande, puis refuse une seule fois en
 * nommant TOUTES les adresses douteuses (avant : arret a la premiere, un
 * aller-retour par adresse, et les autres requetes continuaient pour rien).
 * Ordre : la position de la commande (le serveur y a deja reporte celle du
 * client quand l'adresse est la sienne), sinon le geocodeur partage (cache
 * SQLite, meme seuil que l'import). Toute position est ensuite verifiee :
 * (0,0), inversee, ou a plus de 150 km du depart (decision 6).
 */
async function resoudrePositions(orders, { geocoder = null, reference = null } = {}) {
  const resolved = new Array(orders.length);
  const problemes = [];
  const pending = orders.map((order, index) => ({ order, index }));
  const signaler = (index, order, code, motif, proposition = null) =>
    problemes.push({
      index,
      orderId: order.id,
      clientId: order.clientId,
      clientName: order.clientName || "Client",
      code,
      motif,
      proposition,
    });
  async function worker() {
    while (pending.length) {
      const { order, index } = pending.shift();
      let point = coordinates(order);
      let precision = order.geoPrecision || "";
      let trouve = null;
      if (!point) {
        const adresse = {
          rue: order.address,
          codePostal: order.postalCode,
          ville: order.city,
        };
        const entree =
          geocoder && geocodage.adresseGeocodable(adresse)
            ? await geocoder(adresse)
            : null;
        if (!entree || entree.statut !== geocodage.STATUTS.TROUVE) {
          const aUnPoint =
            entree && Number.isFinite(entree.lat) && Number.isFinite(entree.lng);
          signaler(
            index,
            order,
            entree ? entree.statut : "incomplete",
            motifGeocodage(entree),
            aUnPoint
              ? { lat: entree.lat, lng: entree.lng, libelle: entree.libelle || "" }
              : null,
          );
          continue;
        }
        point = { lat: entree.lat, lng: entree.lng };
        precision = geocodage.precisionDuType(entree.type);
        trouve = entree;
      }
      const verdict = geocodage.verifierPosition(point, { reference });
      if (!verdict.ok) {
        signaler(index, order, verdict.code, verdict.message, verdict.corrigee || null);
        continue;
      }
      resolved[index] = {
        ...order,
        lat: Number(point.lat),
        lng: Number(point.lng),
        geoPrecision: precision,
        ...(trouve
          ? { geoTrouve: { cle: trouve.cle || "", libelle: trouve.libelle || "" } }
          : {}),
      };
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, orders.length) }, () => worker()),
  );
  if (problemes.length) {
    problemes.sort((a, b) => a.index - b.index);
    const liste = problemes.map((p) => `${p.clientName} (${p.motif})`).join(" ; ");
    throw fail(
      problemes.length === 1
        ? `Adresse à vérifier avant le calcul : ${liste}.`
        : `${problemes.length} adresses à vérifier avant le calcul : ${liste}.`,
      { adresses: problemes.map(({ index, ...p }) => p) },
    );
  }
  return resolved;
}
function optimizeMatrix(matrix, count) {
  const remaining = Array.from({ length: count }, (_, i) => i + 1);
  const order = [0];
  while (remaining.length) {
    remaining.sort((a, b) => matrix[order.at(-1)][a] - matrix[order.at(-1)][b]);
    order.push(remaining.shift());
  }
  order.push(count + 1);
  const cost = (list) =>
    list.slice(1).reduce((sum, point, i) => sum + matrix[list[i]][point], 0);
  // Amélioration globale à départ/arrivée fixes ; coût dirigé (sens uniques).
  let best = cost(order);
  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    for (let i = 1; i < order.length - 2; i++)
      for (let j = i + 1; j < order.length - 1; j++) {
        const candidate = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        const value = cost(candidate);
        if (value + 0.01 < best) {
          order.splice(0, order.length, ...candidate);
          best = value;
          improved = true;
        }
      }
    if (!improved) break;
  }
  return order.slice(1, -1).map((i) => i - 1);
}
async function roadPlan(
  orders,
  start,
  end,
  stopMinutes = 6,
  fixedOrder = false,
  { geocoder = null } = {},
) {
  const departure = coordinates(start),
    arrival = coordinates(end);
  if (!departure || !arrival)
    throw fail("Confirme un point de départ et un point d’arrivée.");
  if (!orders.length || orders.length > 50)
    throw fail("Sélectionne entre 1 et 50 commandes par tournée.");
  // Le depart sert de depot (decision 6) : une position a plus de 150 km de
  // lui est refusee, avec le nom du client.
  const resolved = await resoudrePositions(orders, {
    geocoder,
    reference: departure,
  });
  const all = [departure, ...resolved, arrival];
  const base = (
    process.env.SEREO_ROUTING_URL || "https://router.project-osrm.org"
  ).replace(/\/$/, "");
  const coords = (list) => list.map((p) => `${p.lng},${p.lat}`).join(";");
  let ordered = resolved;
  if (!fixedOrder && resolved.length > 1) {
    const table = await json(
      `${base}/table/v1/driving/${coords(all)}?annotations=duration`,
    );
    if (
      table.code !== "Ok" ||
      table.durations?.length !== all.length ||
      table.durations.some(
        (row) =>
          row.length !== all.length || row.some((v) => !Number.isFinite(v)),
      )
    )
      throw fail(
        "Un trajet est inaccessible par la route. Vérifie les adresses.",
      );
    ordered = optimizeMatrix(table.durations, resolved.length).map(
      (i) => resolved[i],
    );
  }
  const result = await json(
    `${base}/route/v1/driving/${coords([departure, ...ordered, arrival])}?overview=full&geometries=geojson&steps=false`,
  );
  const route = result.routes?.[0];
  if (
    result.code !== "Ok" ||
    !route?.geometry?.coordinates ||
    !Number.isFinite(route.distance) ||
    !Number.isFinite(route.duration)
  )
    throw fail("Impossible de calculer le trajet routier.");
  return {
    ordered,
    departure,
    arrival,
    geometry: route.geometry,
    routingMode: "road",
    totalDistance: Math.round(route.distance / 100) / 10,
    estimatedDuration: Math.round(
      route.duration / 60 + ordered.length * stopMinutes,
    ),
    calculatedAt: new Date().toISOString(),
  };
}
module.exports = { coordinates, optimizeMatrix, roadPlan, resoudrePositions };

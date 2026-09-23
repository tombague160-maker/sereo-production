const fail = (message) =>
  Object.assign(new Error(message), { statusCode: 400 });
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
      headers: { "User-Agent": "Sereo/1.0 delivery-planner" },
    });
    if (!response.ok) throw new Error("Unavailable");
    return await response.json();
  } catch {
    throw fail(
      "Le service de calcul routier ou de recherche d’adresse est indisponible. Réessaie dans un instant.",
    );
  }
}
async function geocode(query) {
  if (
    typeof query !== "string" ||
    query.trim().length < 3 ||
    query.length > 300
  )
    throw fail("Saisis une adresse ou une ville.");
  const data = await json(
    `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=5`,
  );
  return (data.features || []).map((item) => ({
    label: item.properties.label,
    score: item.properties.score,
    type: item.properties.type,
    postcode: item.properties.postcode,
    city: item.properties.city,
    lat: item.geometry.coordinates[1],
    lng: item.geometry.coordinates[0],
  }));
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
) {
  const departure = coordinates(start),
    arrival = coordinates(end);
  if (!departure || !arrival)
    throw fail("Confirme un point de départ et un point d’arrivée.");
  if (!orders.length || orders.length > 50)
    throw fail("Sélectionne entre 1 et 50 commandes par tournée.");
  const resolved = new Array(orders.length);
  const pending = orders.map((order, index) => ({ order, index }));
  const cache = new Map();
  async function worker() {
    while (pending.length) {
      const { order, index } = pending.shift();
      let point = coordinates(order);
      if (!point) {
        const address = [order.address, order.postalCode, order.city]
          .filter(Boolean)
          .join(" ");
        if (!cache.has(address)) cache.set(address, geocode(address));
        const matches = await cache.get(address);
        const match = matches[0];
        if (
          !order.address ||
          !match ||
          match.score < 0.65 ||
          (order.postalCode &&
            String(match.postcode) !== String(order.postalCode)) ||
          !["housenumber", "street"].includes(match.type)
        )
          throw fail(
            `Adresse à préciser pour ${order.clientName}. Renseigne les coordonnées du client avant le calcul.`,
          );
        // Une rue sans numero : le point est au milieu de la rue (lot 4 de
        // l'audit geo, la carte le dit « approximatif »).
        point = { ...match, positionPrecision: match.type === "housenumber" ? "adresse" : "approximative" };
      }
      resolved[index] = { ...order, lat: point.lat, lng: point.lng, ...(point.positionPrecision ? { positionPrecision: point.positionPrecision } : {}) };
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, orders.length) }, () => worker()),
  );
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
module.exports = { coordinates, geocode, optimizeMatrix, roadPlan };

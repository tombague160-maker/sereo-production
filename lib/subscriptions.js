const DAY = 86400000;
const ymd = (date) => date.toISOString().slice(0, 10);
function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    ymd(new Date(value)) === value
  );
}
function occurrenceDate(subscription, index) {
  const anchor = new Date(`${subscription.startDate}T12:00:00Z`);
  if (subscription.frequency.unit === "days")
    return ymd(
      new Date(+anchor + index * subscription.frequency.interval * DAY),
    );
  const month = new Date(
    Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + index * subscription.frequency.interval,
      1,
      12,
    ),
  );
  const last = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();
  month.setUTCDate(Math.min(anchor.getUTCDate(), last));
  return ymd(month);
}
function validateSchedule(payload) {
  if (!validDate(payload.startDate) || payload.startDate < "2000-01-01")
    throw new Error("Choisis une première date valide.");
  const frequency = payload.frequency || {};
  if (
    !["days", "months"].includes(frequency.unit) ||
    !Number.isInteger(frequency.interval) ||
    frequency.interval < 1 ||
    frequency.interval > (frequency.unit === "days" ? 366 : 12)
  )
    throw new Error("Fréquence invalide : 1 à 366 jours ou 1 à 12 mois.");
  if (
    !Number.isInteger(payload.reminderDays) ||
    payload.reminderDays < 0 ||
    payload.reminderDays > 60
  )
    throw new Error("Le rappel doit être compris entre 0 et 60 jours.");
  if (!["active", "paused", "cancelled"].includes(payload.status))
    throw new Error("Statut abonnement invalide.");
}
function schedule(db, today, days = 90) {
  const end = ymd(new Date(Date.parse(today) + days * DAY));
  const result = [];
  for (const sub of db.subscriptions || []) {
    if (sub.status !== "active") continue;
    const client = db.clients.find(
      (c) => String(c.id) === String(sub.clientId),
    );
    const generated = new Map(
      db.commandes
        .filter((o) => o.subscriptionId === sub.id)
        .map((o) => [o.subscriptionDate, o]),
    );
    for (let index = 0; index < 50000; index++) {
      const date = occurrenceDate(sub, index);
      if (date > end) break;
      const order = generated.get(date);
      if (order?.status === "livre" || order?.status === "annulee") continue;
      const effectiveDate = order?.deliveryDate || date;
      const reminderDate = ymd(
        new Date(Date.parse(effectiveDate) - sub.reminderDays * DAY),
      );
      result.push({
        subscriptionId: sub.id,
        date: effectiveDate,
        reminderDate,
        overdue: effectiveDate < today,
        due: reminderDate <= today,
        clientId: sub.clientId,
        clientName:
          [client?.prenom, client?.nom].filter(Boolean).join(" ") ||
          "Client introuvable",
        city: client?.ville || "",
        products: sub.products,
        orderId: order?.id || null,
        orderStatus: order?.status || null,
      });
    }
  }
  return result.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.clientName.localeCompare(b.clientName, "fr"),
  );
}
function isOccurrence(sub, date) {
  if (!validDate(date) || date < sub.startDate) return false;
  if (sub.frequency.unit === "days")
    return (
      Math.round((Date.parse(date) - Date.parse(sub.startDate)) / DAY) %
        sub.frequency.interval ===
      0
    );
  const a = new Date(sub.startDate),
    b = new Date(date);
  const months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    b.getUTCMonth() -
    a.getUTCMonth();
  return (
    months % sub.frequency.interval === 0 &&
    occurrenceDate(sub, months / sub.frequency.interval) === date
  );
}
module.exports = {
  validDate,
  occurrenceDate,
  validateSchedule,
  schedule,
  isOccurrence,
};

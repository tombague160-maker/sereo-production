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
// Une commande annulee PAR la pause ou l'arret de son abonnement (decision 8
// de Thomas, 24/09 : annuleeAvecAbonnement) ne retient pas son echeance :
// l'abonnement repris, l'echeance a venir se genere de nouveau. Une commande
// annulee a la main, elle, la retient (l'echeance est sautee, comme avant).
const commandeDeLEcheance = (o) => !o.annuleeAvecAbonnement;
// La date d'effet (decision 8) : posee au changement de frequence et a la
// reprise ; les echeances d'avant, sans commande, ne sont plus proposees.
const dateDEffet = (sub) =>
  validDate(sub.effectiveFrom) ? sub.effectiveFrom : "";
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
        .filter((o) => o.subscriptionId === sub.id && commandeDeLEcheance(o))
        .map((o) => [o.subscriptionDate, o]),
    );
    const debut = dateDEffet(sub);
    const echeance = (date, order) => {
      const effectiveDate = order?.deliveryDate || date;
      const reminderDate = ymd(
        new Date(Date.parse(effectiveDate) - sub.reminderDays * DAY),
      );
      return {
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
      };
    };
    for (let index = 0; index < 50000; index++) {
      const date = occurrenceDate(sub, index);
      if (date > end) break;
      const order = generated.get(date);
      if (order?.status === "livre" || order?.status === "annulee") continue;
      // Decision 8 : avant la date d'effet, une echeance sans commande est
      // ignoree (ni « en retard », ni proposee a la generation).
      if (!order && debut && date < debut) continue;
      result.push(echeance(date, order));
    }
    // Decision 8 : une commande generee que le calendrier actuel ne porte plus
    // (la frequence a change) reste montree tant qu'elle n'est ni livree ni
    // annulee -- sinon elle partait en livraison a cote des nouvelles
    // echeances, sans que rien ne le montre.
    for (const [date, order] of generated) {
      if (order.status === "livre" || order.status === "annulee") continue;
      if (isOccurrence(sub, date)) continue;
      if ((order.deliveryDate || date) > end) continue;
      result.push(echeance(date, order));
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

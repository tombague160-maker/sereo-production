import { escapeHtml as h } from "./utils/dom.js";
let context,
  data = {},
  selectedMonth = "",
  weekOffset = 0,
  editingId = null;
let departure = null,
  arrival = null;
const money = (value) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    value || 0,
  );
const day = (value) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "short",
      })
    : "Date non précisée";
const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const plus = (value, days) => {
  const d = new Date(`${value}T12:00:00`);
  d.setDate(d.getDate() + days);
  return iso(d);
};
const name = (c) => [c.prenom, c.nom].filter(Boolean).join(" ");
const frequency = (sub) =>
  sub.frequency.unit === "months"
    ? sub.frequency.interval === 1
      ? "Tous les mois"
      : `Tous les ${sub.frequency.interval} mois`
    : sub.frequency.interval === 7
      ? "Chaque semaine"
      : sub.frequency.interval === 14
        ? "Toutes les 2 semaines"
        : `Tous les ${sub.frequency.interval} jours`;
const products = (lines) =>
  (lines || []).map((p) => `${p.quantite} × ${p.nom}`).join(" · ");
const empty = (text) => `<div class="op-empty">${h(text)}</div>`;
const button = (action, label, extra = "", style = "secondary") =>
  `<button type="button" class="button ${style}" data-op="${action}" ${extra}>${label}</button>`;
const status = (value) =>
  ({
    planifiee: "À confirmer",
    a_confirmer: "À confirmer",
    stock_a_verifier: "À préparer",
    en_preparation: "En préparation",
    pret_livraison: "Prête",
    en_livraison: "En livraison",
    probleme_livraison: "Problème de livraison",
    a_reprogrammer: "À reprogrammer",
    livre: "Livrée",
  })[value] || value;
/** L'etat d'un abonnement : un disque et un mot. */
const etatAbonnement = (sub) =>
  sub.status === "active"
    ? { cle: "actif", mot: "Actif", pill: "pill-ok" }
    : sub.status === "paused"
      ? { cle: "pause", mot: "En pause", pill: "pill-warning" }
      : { cle: "arrete", mot: "Arrêté", pill: "pill-blue" };

/** Le detail d'un abonnement, en sheet : les faits, le panier, les actions. */
function openSubDetail(id) {
  const dialogue = document.getElementById("abonnementDetailDialog");
  const corps = document.getElementById("abonnementDetailCorps");
  const s = data.subscriptions.items.find((item) => item.id === id);
  if (!dialogue || !corps || !s || typeof dialogue.showModal !== "function") return;
  const client = data.crmClients.find((c) => String(c.id) === String(s.clientId));
  const next = data.subscriptions.occurrences.find((o) => o.subscriptionId === s.id);
  const etat = etatAbonnement(s);
  document.getElementById("abonnementDetailTitre").textContent = name(client || {}) || "Client introuvable";
  // .subscription-card : le dispatcher y desactive les boutons freres pendant une action.
  corps.innerHTML = `<div class="subscription-card"><p class="arret-adresse"><span>${h(client?.ville || "Adresse à compléter")}</span><span class="pill ${etat.pill}">${h(etat.mot)}</span></p><p class="sub-basket">${h(products(s.products))}</p><div class="sub-facts"><div><small>Fréquence</small><strong>${h(frequency(s))}</strong></div><div><small>Prochaine échéance</small><strong>${h(next ? day(next.date) : "—")}</strong></div><div><small>Rappel</small><strong>${s.reminderDays} jour(s) avant</strong></div><div><small>Panier prévu</small><strong>${h(money(s.products.reduce((sum, p) => sum + p.totalLigne, 0)))}</strong></div></div><div class="card-actions">${button("edit-sub", "Modifier", `data-id="${h(s.id)}"`, "primary")}${button("toggle-sub", s.status === "active" ? "Mettre en pause" : "Réactiver", `data-id="${h(s.id)}"`)}</div></div>`;
  dialogue.showModal();
}

function closeSubDetail() {
  const dialogue = document.getElementById("abonnementDetailDialog");
  if (dialogue && dialogue.open) dialogue.close();
}

export function initOperations(api) {
  context = api;
  document.addEventListener("click", async (event) => {
    const el = event.target.closest("[data-op]");
    if (!el) return;
    const action = el.dataset.op;
    if (action === "new-sub") return openEditor();
    if (action === "open-sub-detail") return openSubDetail(el.dataset.id);
    if (action === "close-sub-detail") return closeSubDetail();
    // L'editeur est un second <dialog> : on ferme le sheet avant de l'ouvrir.
    if (action === "edit-sub") { closeSubDetail(); return openEditor(el.dataset.id); }
    if (action === "view-order") return;
    if (action === "close-sub")
      return document.getElementById("subscriptionDialog").close();
    if (action === "add-line") return addLine();
    if (action === "remove-line")
      return el.closest(".sub-product-line").remove();
    if (
      action === "week-prev" ||
      action === "week-next" ||
      action === "week-today"
    ) {
      weekOffset =
        action === "week-today"
          ? 0
          : Math.min(
              12,
              Math.max(-52, weekOffset + (action === "week-prev" ? -1 : 1)),
            );
      renderSubscriptions();
      return;
    }
    el.disabled = true;
    const related = [
      ...(el.closest(".subscription-card")?.querySelectorAll("button") || []),
    ];
    related.forEach((button) => (button.disabled = true));
    try {
      if (action === "toggle-sub") {
        closeSubDetail();
        const sub = data.subscriptions.items.find(
          (s) => s.id === el.dataset.id,
        );
        await context.apiFetch(
          `/api/subscriptions/${encodeURIComponent(sub.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: sub.status === "active" ? "paused" : "active",
            }),
          },
        );
        await context.loadData();
      }
      if (action === "generate-sub") {
        await context.apiFetch(
          `/api/subscriptions/${encodeURIComponent(el.dataset.id)}/orders`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: el.dataset.date }),
          },
        );
        await context.loadData();
        context.notify(
          "Commande créée. Confirme-la dans Commandes planifiées pour la préparer.",
          "success",
        );
      }
      if (action === "locate") await locate();
      if (action === "search-departure" || action === "search-arrival")
        await searchPoint(action.slice(7));
      if (action === "refresh-operations") await context.loadData();
      if (action === "recalculate-route") await context.recalculateRoute();
    } catch (error) {
      // `enFile` : l'ecriture est hors ligne, conservee, et partira. Le dire en
      // rouge annoncerait une perte de donnee qui n'a pas eu lieu.
      context.notify(error.message, error?.enFile ? "warning" : "error");
    } finally {
      el.disabled = false;
      related.forEach((button) => (button.disabled = false));
    }
  });
  document
    .getElementById("revenueMonth")
    .addEventListener("change", (event) => {
      selectedMonth = event.target.value;
      renderDashboard();
    });
  document
    .getElementById("subscriptionSearch")
    .addEventListener("input", renderSubscriptions);
  document
    .getElementById("subscriptionForm")
    .addEventListener("submit", saveSubscription);
  document.getElementById("subClient").addEventListener("change", (event) => {
    document.getElementById("subNewClient").hidden =
      event.target.value !== "new";
    for (const input of document.querySelectorAll(
      "#subNewClient [data-required]",
    ))
      input.required = event.target.value === "new";
  });
  document.getElementById("subFrequency").addEventListener("change", () => {
    document.getElementById("subCustomWrap").hidden =
      document.getElementById("subFrequency").value !== "custom";
    previewSchedule();
  });
  document
    .getElementById("subStart")
    .addEventListener("change", previewSchedule);
  for (const point of ["departure", "arrival"]) {
    document.getElementById(`${point}Query`).addEventListener("input", () => {
      if (point === "departure") departure = null;
      else arrival = null;
      document.getElementById(`${point}Results`).hidden = true;
    });
    document
      .getElementById(`${point}Results`)
      .addEventListener("change", (event) => {
        const option = event.target.selectedOptions[0];
        const value = option?.dataset.point
          ? JSON.parse(option.dataset.point)
          : null;
        if (point === "departure") departure = value;
        else arrival = value;
      });
  }
}
export function renderOperations(next) {
  data = next;
  // Une fiche archivée reste visible dans l'historique de ses abonnements.
  for (const c of next.subscriptions?.clients || [])
    if (!data.crmClients.some((item) => String(item.id) === String(c.id)))
      data.crmClients.push(c);
  renderDashboard();
  renderSubscriptions();
}
function occurrenceCard(item) {
  const action = item.orderId
    ? button(
        "view-order",
        h(status(item.orderStatus)),
        `data-action="go-tab" data-target-tab="commandes-planifiees"`,
      )
    : button(
        "generate-sub",
        "Créer la commande",
        `data-id="${h(item.subscriptionId)}" data-date="${h(item.date)}"`,
      );
  return `<article class="op-occurrence ${item.overdue ? "is-overdue" : ""}"><div><span class="op-eyebrow">${h(day(item.date))}${item.overdue ? " · En retard" : ""}</span><strong>${h(item.clientName)}</strong><p>${h(products(item.products))}</p></div>${action}</article>`;
}
function renderDashboard() {
  const op = data.operations;
  if (!op) return;
  selectedMonth = selectedMonth || op.today.slice(0, 7);
  const select = document.getElementById("revenueMonth");
  select.innerHTML = op.history
    .map(
      (m) =>
        `<option value="${h(m.month)}" ${m.month === selectedMonth ? "selected" : ""}>${h(new Date(`${m.month}-01T12:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }))}</option>`,
    )
    .join("");
  const month =
    op.history.find((m) => m.month === selectedMonth) || op.history[0];
  document.getElementById("opRevenue").textContent = money(month.revenue);
  document.getElementById("opBasket").textContent = money(month.averageBasket);
  document.getElementById("opDelivered").textContent =
    `${month.orders} commande${month.orders > 1 ? "s" : ""} livrée${month.orders > 1 ? "s" : ""}`;
  document.getElementById("opSubscriptions").textContent =
    op.activeSubscriptions;
  document.getElementById("opDue").textContent = op.subscriptions.filter(
    (s) => s.due && !s.orderId,
  ).length;
  document.getElementById("opUpdated").textContent =
    `Mis à jour à ${new Date(op.updatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  document.getElementById("revenueCaveat").textContent = [
    month.missingPrices
      ? `${month.missingPrices} commande(s) sans montant à compléter.`
      : "",
    month.estimatedDates
      ? `${month.estimatedDates} ancienne(s) commande(s) : date prévue ou date de commande utilisée faute de date de livraison réelle.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const months = op.history.slice(0, 6).reverse(),
    max = Math.max(1, ...months.map((m) => m.revenue));
  document.getElementById("revenueChart").innerHTML = months
    .map(
      (m) =>
        `<div class="revenue-column"><span>${h(money(m.revenue))}</span><div class="revenue-track"><i style="height:${Math.max(2, (m.revenue / max) * 100)}%"></i></div><small>${h(new Date(`${m.month}-01T12:00:00`).toLocaleDateString("fr-FR", { month: "short" }))}</small></div>`,
    )
    .join("");
  const weekEnd = plus(op.today, 6);
  const upcoming = op.subscriptions.filter((s) => s.date <= weekEnd);
  document.getElementById("dashboardSubscriptions").innerHTML =
    upcoming.slice(0, 8).map(occurrenceCard).join("") ||
    empty(
      "Aucune livraison d’abonnement à prévoir dans les 7 prochains jours.",
    );
  document.getElementById("opWeekCount").textContent =
    `${upcoming.length} échéance${upcoming.length > 1 ? "s" : ""}`;
  for (const [id, list] of [
    ["dashboardPreparing", op.preparing],
    ["dashboardDelivering", op.delivering],
  ]) {
    document.getElementById(id + "Count").textContent = list.length;
    document.getElementById(id).innerHTML =
      list
        .slice(0, 5)
        .map(
          (o) =>
            `<div class="op-order-row"><div><strong>${h(o.clientName)}</strong><p>${h(products(o.products))}</p></div><span class="status-chip">${h(status(o.status))}</span></div>`,
        )
        .join("") || empty("Aucune commande pour le moment.");
  }
  const alerts = [];
  const overdue = op.subscriptions.filter((s) => s.overdue).length;
  if (overdue) alerts.push(`${overdue} échéance(s) d’abonnement en retard`);
  const out = data.stock.filter((p) => p.stockStatus === "rupture").length;
  if (out) alerts.push(`${out} produit(s) en rupture de stock`);
  const low = data.stock.filter((p) => p.stockStatus === "stock_faible").length;
  if (low) alerts.push(`${low} produit(s) avec un stock faible`);
  const issues = data.orders.filter((o) =>
    ["probleme_livraison", "a_reprogrammer"].includes(o.status),
  ).length;
  if (issues) alerts.push(`${issues} livraison(s) à reprendre`);
  document.getElementById("opAlerts").innerHTML =
    alerts.map((t) => `<div class="op-alert">${h(t)}</div>`).join("") ||
    empty("Aucune alerte prioritaire.");
}
function renderSubscriptions() {
  if (!data.subscriptions) return;
  const query = document
    .getElementById("subscriptionSearch")
    .value.toLowerCase();
  const items = data.subscriptions.items.filter((s) => {
    const c = data.crmClients.find((c) => String(c.id) === String(s.clientId));
    return `${name(c || {})} ${products(s.products)}`
      .toLowerCase()
      .includes(query);
  });
  document.getElementById("subscriptionList").innerHTML =
    items
      .map((s) => {
        const client = data.crmClients.find(
          (c) => String(c.id) === String(s.clientId),
        );
        const next = data.subscriptions.occurrences.find(
          (o) => o.subscriptionId === s.id,
        );
        // Charte §4, ligne de liste : quatre informations -- l'etat (disque),
        // le nom, « ville · frequence », le badge. Le reste (echeance, rappel,
        // panier, actions) vit dans le sheet que la ligne ouvre.
        const etat = etatAbonnement(s);
        const detail = [client?.ville ? context.formatSectorLabel(client.ville) : "", frequency(s)].filter(Boolean).join(" · ");
        return `<article class="commande-ligne abonnement-ligne"><button class="commande-ligne-main" type="button" data-op="open-sub-detail" data-id="${h(s.id)}" aria-label="Ouvrir ${h(name(client || {}) || "Client introuvable")}, ${h(etat.mot)}"><span class="etat-commande etat-commande--${etat.cle}" aria-hidden="true"></span><span class="commande-ligne-corps"><strong>${h(name(client || {}) || "Client introuvable")}</strong><span>${h(detail || "Adresse à compléter")}</span></span><span class="pill ${etat.pill}">${h(etat.mot)}</span></button></article>`;
      })
      .join("") ||
    empty(
      query
        ? "Aucun abonnement ne correspond à ta recherche."
        : "Crée ton premier abonnement : un client, ses produits et son rythme de livraison.",
    );
  const today = data.subscriptions.today,
    d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOffset * 7);
  const start = iso(d);
  document.getElementById("subscriptionWeekLabel").textContent =
    `${day(start)} — ${day(plus(start, 6))}`;
  document.getElementById("subscriptionCalendar").innerHTML = Array.from(
    { length: 7 },
    (_, i) => {
      const date = plus(start, i),
        events = data.subscriptions.occurrences.filter((o) => o.date === date);
      return `<div class="calendar-day ${date === today ? "is-today" : ""}"><h4>${h(day(date))}</h4>${events.map((o) => `<button type="button" class="calendar-event" data-op="edit-sub" data-id="${h(o.subscriptionId)}"><strong>${h(o.clientName)}</strong><small>${h(o.orderId ? status(o.orderStatus) : "À planifier")}</small></button>`).join("") || '<span class="calendar-free">—</span>'}</div>`;
    },
  ).join("");
  const due = data.subscriptions.occurrences.filter((o) => o.due && !o.orderId);
  document.getElementById("subscriptionReminders").innerHTML =
    due.map(occurrenceCard).join("") || empty("Tous les rappels sont à jour.");
}
function addLine(line) {
  const row = document.createElement("div");
  row.className = "sub-product-line";
  row.innerHTML = `<label>Produit<select class="sub-product" required><option value="">Choisir un produit</option>${data.stock.map((p) => `<option value="${h(p.id)}" ${line && (String(line.stockId) === String(p.id) || line.code === p.code) ? "selected" : ""}>${h(p.nom || p.produit || p.name || p.code)}${p.code ? " · " + h(p.code) : ""}</option>`).join("")}</select></label><label>Quantité<input class="sub-quantity" type="number" min="1" max="10000" step="1" required value="${line?.quantite || 1}"></label>${button("remove-line", "Retirer")}`;
  document.getElementById("subProducts").append(row);
}
function previewSchedule() {
  const date = document.getElementById("subStart").value,
    f = document.getElementById("subFrequency").value;
  document.getElementById("subScheduleHint").textContent = date
    ? `Première livraison : ${day(date)}. ${["7", "14", "21", "28"].includes(f) ? "Le jour de la semaine sera conservé." : f === "monthly" ? "Même date chaque mois ; dernier jour si le mois est plus court." : "Le jour de la semaine peut varier selon l’intervalle."}`
    : "";
}
function openEditor(id) {
  editingId = id || null;
  const sub = data.subscriptions?.items.find((s) => s.id === id);
  const form = document.getElementById("subscriptionForm");
  form.reset();
  document.getElementById("subDialogTitle").textContent = sub
    ? "Modifier l’abonnement"
    : "Nouvel abonnement";
  document.getElementById("subClient").innerHTML =
    '<option value="">Choisir un client</option><option value="new">+ Créer une fiche client</option>' +
    data.crmClients
      .filter((c) => !c.crmArchived || String(c.id) === String(sub?.clientId))
      .map(
        (c) =>
          `<option value="${h(c.id)}" ${String(sub?.clientId) === String(c.id) ? "selected" : ""}>${h(name(c))} · ${h(c.ville || "")}</option>`,
      )
      .join("");
  document.getElementById("subNewClient").hidden = true;
  for (const input of document.querySelectorAll(
    "#subNewClient [data-required]",
  ))
    input.required = false;
  document.getElementById("subStart").value =
    sub?.startDate || data.subscriptions.today;
  const value = sub
    ? sub.frequency.unit === "months"
      ? "monthly"
      : String(sub.frequency.interval)
    : "monthly";
  document.getElementById("subFrequency").value = [
    "7",
    "10",
    "14",
    "15",
    "21",
    "28",
    "monthly",
  ].includes(value)
    ? value
    : "custom";
  document.getElementById("subCustom").value = sub?.frequency.interval || 10;
  document.getElementById("subCustomWrap").hidden =
    document.getElementById("subFrequency").value !== "custom";
  document.getElementById("subReminder").value = sub?.reminderDays ?? 7;
  document.getElementById("subNotes").value = sub?.notes || "";
  document.getElementById("subStatus").value = sub?.status || "active";
  document.getElementById("subProducts").innerHTML = "";
  (sub?.products || [null]).forEach(addLine);
  document.getElementById("subError").textContent = "";
  previewSchedule();
  document.getElementById("subscriptionDialog").showModal();
}
async function saveSubscription(event) {
  event.preventDefault();
  const save = document.getElementById("subSave");
  save.disabled = true;
  try {
    const lines = [...document.querySelectorAll(".sub-product-line")].map(
      (row) => ({
        productId: row.querySelector("select").value,
        quantite: Number(row.querySelector("input").value),
      }),
    );
    if (!lines.length) throw new Error("Ajoute au moins un produit.");
    let clientId = document.getElementById("subClient").value;
    if (clientId === "new") {
      const client = await context.apiFetch("/api/crm/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom: document.getElementById("subLastName").value,
          prenom: document.getElementById("subFirstName").value,
          rue: document.getElementById("subAddress").value,
          codePostal: document.getElementById("subPostal").value,
          ville: document.getElementById("subCity").value,
          telephone: document.getElementById("subPhone").value,
          crmStatus: "client_actif",
        }),
      });
      clientId = client.id;
      data.crmClients.push(client);
      const opt = new Option(name(client), clientId, true, true);
      document.getElementById("subClient").add(opt);
      document.getElementById("subNewClient").hidden = true;
    }
    const f = document.getElementById("subFrequency").value;
    const payload = {
      clientId,
      products: lines,
      startDate: document.getElementById("subStart").value,
      frequency: {
        unit: f === "monthly" ? "months" : "days",
        interval:
          f === "monthly"
            ? 1
            : f === "custom"
              ? Number(document.getElementById("subCustom").value)
              : Number(f),
      },
      reminderDays: Number(document.getElementById("subReminder").value),
      notes: document.getElementById("subNotes").value,
      status: document.getElementById("subStatus").value,
    };
    await context.apiFetch(
      editingId
        ? `/api/subscriptions/${encodeURIComponent(editingId)}`
        : "/api/subscriptions",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    document.getElementById("subscriptionDialog").close();
    await context.loadData();
    context.notify("Abonnement enregistré.", "success");
  } catch (e) {
    document.getElementById("subError").textContent = e.message;
  } finally {
    save.disabled = false;
  }
}
async function searchPoint(point) {
  const input = document.getElementById(`${point}Query`),
    select = document.getElementById(`${point}Results`);
  const results = await context.apiFetch(
    `/api/geocode?q=${encodeURIComponent(input.value)}`,
  );
  if (!results.length)
    throw new Error(
      "Aucune adresse trouvée. Précise la ville ou le code postal.",
    );
  select.innerHTML =
    '<option value="">Confirmer une adresse</option>' +
    results
      .map(
        (p, i) =>
          `<option value="${i}" data-point="${h(JSON.stringify(p))}">${h(p.label)}</option>`,
      )
      .join("");
  select.hidden = false;
  select.focus();
}
async function locate() {
  if (!navigator.geolocation)
    throw new Error(
      "La localisation n’est pas disponible. Saisis une adresse de départ.",
    );
  const location = await new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      resolve,
      () =>
        reject(
          new Error(
            "Localisation refusée ou indisponible. Autorise-la dans le navigateur ou saisis ton départ.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    ),
  );
  departure = {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    label: "Ma position actuelle",
  };
  document.getElementById("departureQuery").value =
    `Ma position · précision ${Math.round(location.coords.accuracy)} m`;
  document.getElementById("departureResults").hidden = true;
  document.getElementById("routeLocationStatus").textContent =
    "Position de départ enregistrée.";
}
export function getRoutePoints() {
  if (!departure)
    throw new Error("Choisis ton départ : localisation ou adresse confirmée.");
  const end = document.getElementById("returnToStart").checked
    ? departure
    : arrival;
  if (!end)
    throw new Error(
      "Choisis une adresse d’arrivée ou coche le retour au départ.",
    );
  return { departure, arrival: end };
}

const { randomUUID } = require("node:crypto");
const calendar = require("./subscriptions");
const routing = require("./routing");
const todayParis = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function registerOperations(app, deps) {
  const {
    readDb,
    writeDb,
    withWriteLock,
    badRequest,
    notFound,
    handleRouteError,
    findClient,
    buildCustomerOrderLines,
    createPlannedOrder,
    addHistory,
    getOrderTotal,
    buildImportedSalesIndex,
    getImportedOrderTotal,
    normalizeDateInput,
  } = deps;
  const wrap = (fn) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (e) {
      handleRouteError(e, res, "Impossible de terminer cette action");
    }
  };
  const save = (fn) =>
    withWriteLock(async () => {
      const db = readDb();
      const result = fn(db);
      writeDb(db);
      return result;
    });
  const find = (db, id) => {
    const sub = db.subscriptions.find((s) => s.id === id);
    if (!sub) throw notFound("Abonnement introuvable");
    return sub;
  };
  function validate(db, payload, existing = {}) {
    const next = { ...existing, ...payload };
    try {
      calendar.validateSchedule(next);
    } catch (e) {
      throw badRequest(e.message);
    }
    if (
      !findClient(db, next.clientId) ||
      findClient(db, next.clientId).crmArchived
    )
      throw badRequest("Sélectionne un client existant.");
    if (
      !Array.isArray(next.products) ||
      !next.products.length ||
      next.products.length > 100
    )
      throw badRequest("Ajoute entre 1 et 100 produits.");
    if (
      next.products.some(
        (p) =>
          !Number.isInteger(Number(p.quantite)) ||
          Number(p.quantite) < 1 ||
          Number(p.quantite) > 10000,
      )
    )
      throw badRequest(
        "Les quantités doivent être des nombres entiers positifs.",
      );
    const products = buildCustomerOrderLines(db, next.products, {
      checkStock: false,
    });
    // Conserve la référence catalogue ; normalizeProducts des commandes retire stockId.
    return {
      id: existing.id || `sub-${randomUUID()}`,
      clientId: next.clientId,
      products,
      startDate: next.startDate,
      frequency: {
        unit: next.frequency.unit,
        interval: next.frequency.interval,
      },
      reminderDays: next.reminderDays,
      status: next.status,
      notes: String(next.notes || "").slice(0, 2000),
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  app.get(
    "/api/subscriptions",
    wrap(async (req, res) => {
      const db = readDb(),
        today = todayParis();
      const occurrences = calendar.schedule(db, today);
      res.json({
        items: db.subscriptions,
        occurrences,
        today,
        clients: db.clients.filter((c) =>
          db.subscriptions.some((sub) => String(sub.clientId) === String(c.id)),
        ),
      });
    }),
  );
  app.post(
    "/api/subscriptions",
    wrap(async (req, res) => {
      const sub = await save((db) => {
        const sub = validate(db, req.body);
        db.subscriptions.push(sub);
        addHistory(db, "Abonnement", "Abonnement créé", {
          subscriptionId: sub.id,
        });
        return sub;
      });
      res.status(201).json(sub);
    }),
  );
  app.patch(
    "/api/subscriptions/:id",
    wrap(async (req, res) => {
      res.json(
        await save((db) => {
          const existing = find(db, req.params.id);
          const next = validate(db, req.body, existing);
          Object.assign(existing, next);
          addHistory(db, "Abonnement", "Abonnement modifié", {
            subscriptionId: existing.id,
          });
          return existing;
        }),
      );
    }),
  );
  app.post(
    "/api/subscriptions/:id/orders",
    wrap(async (req, res) => {
      const result = await save((db) => {
        const sub = find(db, req.params.id),
          date = req.body.date;
        const existing = db.commandes.find(
          (o) => o.subscriptionId === sub.id && o.subscriptionDate === date,
        );
        if (existing) return { order: existing, created: false };
        if (sub.status !== "active")
          throw badRequest("Cet abonnement est en pause ou arrêté.");
        if (!calendar.isOccurrence(sub, date))
          throw badRequest(
            "Cette date ne correspond pas au calendrier de cet abonnement.",
          );
        const { order } = createPlannedOrder(db, {
          clientId: sub.clientId,
          products: sub.products,
          deliveryDate: date,
          reminderLeadDays: sub.reminderDays,
          notes: sub.notes,
        });
        order.subscriptionId = sub.id;
        order.subscriptionDate = date;
        addHistory(db, "Abonnement", `Échéance du ${date} : commande créée`, {
          subscriptionId: sub.id,
          orderId: order.id,
        });
        return { order, created: true };
      });
      res.status(result.created ? 201 : 200).json(result);
    }),
  );
  app.get(
    "/api/operations",
    wrap(async (req, res) => {
      const db = readDb(),
        today = todayParis(),
        month = today.slice(0, 7),
        index = buildImportedSalesIndex(db.ventes);
      const sales = db.commandes
        .filter((o) => o.status === "livre")
        .map((o) => {
          const date =
            (o.deliveredAt && Number.isFinite(Date.parse(o.deliveredAt))
              ? new Intl.DateTimeFormat("en-CA", {
                  timeZone: "Europe/Paris",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                }).format(new Date(o.deliveredAt))
              : "") ||
            o.deliveryDate ||
            normalizeDateInput(o.dateCommande);
          const amount =
            getOrderTotal(o) ||
            getImportedOrderTotal(index, o, normalizeDateInput(o.dateCommande));
          return {
            date,
            amount,
            estimatedDate: !o.deliveredAt,
            missingPrice: amount === 0,
          };
        });
      const periods = new Set([
        month,
        ...sales.map((s) => s.date?.slice(0, 7)).filter(Boolean),
      ]);
      // Toujours les 12 derniers mois, y compris les mois sans ventes.
      for (let i = 0; i < 12; i++) {
        const d = new Date(`${month}-01T12:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - i);
        periods.add(d.toISOString().slice(0, 7));
      }
      const history = [...periods]
        .sort()
        .reverse()
        .map((key) => {
          const list = sales.filter((s) => s.date?.startsWith(key));
          const revenue =
            Math.round(list.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;
          return {
            month: key,
            revenue,
            orders: list.length,
            averageBasket: list.length
              ? Math.round((revenue / list.length) * 100) / 100
              : 0,
            missingPrices: list.filter((s) => s.missingPrice).length,
            estimatedDates: list.filter((s) => s.estimatedDate).length,
          };
        });
      const summary = (statuses) =>
        db.commandes
          .filter((o) => statuses.includes(o.status))
          .map((o) => ({
            id: o.id,
            clientName: o.clientName,
            numero: o.numero,
            status: o.status,
            products: o.products,
            deliveryDate: o.deliveryDate,
          }));
      res.json({
        today,
        updatedAt: new Date().toISOString(),
        history,
        subscriptions: calendar.schedule(db, today),
        activeSubscriptions: db.subscriptions.filter(
          (s) => s.status === "active",
        ).length,
        preparing: summary([
          "stock_a_verifier",
          "en_preparation",
          "preparation_terminee",
        ]),
        delivering: summary(["pret_livraison", "en_livraison"]),
      });
    }),
  );
  app.get(
    "/api/geocode",
    wrap(async (req, res) => res.json(await routing.geocode(req.query.q))),
  );
  app.post(
    "/api/routes/:id/recalculate",
    wrap(async (req, res) => {
      const snapshot = readDb(),
        route = snapshot.routes.find((r) => r.id === req.params.id);
      if (!route) throw notFound("Tournée introuvable");
      if (route.status !== "prete")
        throw badRequest("Recalcule avant le départ.");
      const fingerprint = JSON.stringify(route);
      const plan = await routing.roadPlan(
        route.stops,
        req.body.departure || route.departure,
        req.body.arrival || route.arrival,
        snapshot.settings.tournee.stopDurationMin,
        Boolean(req.body.fixedOrder),
      );
      res.json(
        await save((db) => {
          const current = db.routes.find((r) => r.id === route.id);
          if (!current || JSON.stringify(current) !== fingerprint)
            throw badRequest("La tournée a changé. Recommence le calcul.");
          current.stops = plan.ordered.map((s, i) => ({
            ...s,
            orderIndex: i + 1,
          }));
          current.selectedOrderIds = current.stops.map((s) => s.orderId);
          const { ordered, ...details } = plan;
          Object.assign(current, details);
          return current;
        }),
      );
    }),
  );
}
module.exports = { registerOperations };

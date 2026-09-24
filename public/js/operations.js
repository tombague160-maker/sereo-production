import { escapeHtml as h } from "./utils/dom.js";
import { normalizeTextKey, villeAffichee } from "./utils/text.js";
import { getAddressParts } from "./utils/address.js";
// Les dates et les heures de l'ecran : un seul utilitaire (parcours simplifies, 24/09).
import * as datesFr from "./utils/dates.js";
let context,
  data = {},
  selectedMonth = "",
  editingId = null;
let departure = null,
  arrival = null;
const money = (value) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    value || 0,
  );
// « jeudi 24 septembre » (utils/dates.js) : la forme longue des phrases.
const day = (value) =>
  value ? datesFr.jourLong(value) : "Date non précisée";
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
/**
 * Une commande « a preparer » : ce que l'ecran Preparation compte comme
 * RESTANTE -- importee, a verifier, en preparation, bloquees comprises. UN
 * seul compte partout (parcours simplifies, 24/09) : la pastille de l'entree
 * Preparation, la tuile du tableau de bord, le resume de la Preparation, et
 * /api/operations (lib/operations-api.js, `preparing`) cote serveur. Il y en
 * avait trois (1 / 1 / 3 sur les memes donnees).
 */
export const STATUTS_A_PREPARER = ["importe", "stock_a_verifier", "en_preparation"];
export const commandeAPreparer = (o) => STATUTS_A_PREPARER.includes(o?.status);
const status = (value) =>
  ({
    planifiee: "À confirmer",
    a_confirmer: "À confirmer",
    importe: "À préparer",
    stock_a_verifier: "À préparer",
    en_preparation: "En préparation",
    // Comptee avec les pretes (relecture adverse) : son mot, pas sa cle.
    preparation_terminee: "Prête",
    pret_livraison: "Prête",
    en_livraison: "En livraison",
    probleme_livraison: "Problème de livraison",
    a_reprogrammer: "À reprogrammer",
    livre: "Livrée",
  })[value] || value;
/**
 * L'etat d'une commande vue du tableau de bord, pour le disque de la ligne.
 * Les mots restent ceux du statut (status()) : ici on ne montre pas l'etape
 * de preparation, on montre la commande.
 */
const etatDeLaCommande = (statut) =>
  statut === "pret_livraison" || statut === "preparation_terminee" || statut === "livre"
    ? { cle: "prete", pill: "pill-ok" }
    : statut === "en_preparation" || statut === "en_livraison"
      ? { cle: "en-cours", pill: "pill-warning" }
      : statut === "probleme_livraison" || statut === "a_reprogrammer"
        ? { cle: "bloquee", pill: "pill-danger" }
        : { cle: "a-faire", pill: "pill-blue" };

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
  // La meme echeance que la ligne (prochaineEcheance), et dite en retard comme
  // elle : une echeance passee deja commandee n'est plus « la prochaine ».
  const next = prochaineEcheance(s);
  const retard = s.status === "active" && enRetard(next);
  const etat = etatAbonnement(s);
  document.getElementById("abonnementDetailTitre").textContent = name(client || {}) || "Client introuvable";
  // .subscription-card : le dispatcher y desactive les boutons freres pendant une action.
  corps.innerHTML = `<div class="subscription-card"><p class="arret-adresse"><span>${h(villeAffichee(client?.ville) || "Adresse à compléter")}</span><span class="pill ${etat.pill}">${h(etat.mot)}</span></p><p class="sub-basket">${h(products(s.products))}</p><div class="sub-facts"><div><small>Fréquence</small><strong>${h(frequency(s))}</strong></div><div><small>Prochaine échéance</small><strong${retard ? ' class="abo-alerte"' : ""}>${h(next ? day(next.date) + (retard ? " · en retard" : "") : "—")}</strong></div><div><small>Rappel</small><strong>${s.reminderDays} jour${s.reminderDays > 1 ? "s" : ""} avant</strong></div><div><small>Panier prévu</small><strong>${h(money(s.products.reduce((sum, p) => sum + p.totalLigne, 0)))}</strong></div></div><div class="card-actions">${button("edit-sub", "Modifier", `data-id="${h(s.id)}"`, "primary")}${button("toggle-sub", s.status === "active" ? "Mettre en pause" : "Réactiver", `data-id="${h(s.id)}"`)}</div></div>`;
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
    // La creation d'un abonnement (planches 3b / 5b) : des gestes locaux au
    // formulaire, sans appel au serveur.
    if (action === "sub-client") {
      $("subClient").value = el.dataset.id;
      majClient();
      document.querySelector('[data-op="sub-client-changer"]').focus();
      return;
    }
    if (action === "sub-client-changer") {
      $("subClient").value = "";
      majClient();
      $("subClientSearch").focus();
      return;
    }
    if (action === "sub-nouveau-client") {
      ficheNouvelle = !ficheNouvelle;
      majClient();
      (ficheNouvelle ? $("subLastName") : $("subNouveauClient")).focus();
      return;
    }
    if (action === "sub-catalogue") return basculerCatalogue();
    if (action === "sub-ajouter") {
      ajouterProduit(el.dataset.id);
      // Le catalogue est redessine : le focus revient au meme « + ».
      $("subCatalogueListe").querySelector(`[data-id="${CSS.escape(el.dataset.id)}"]`)?.focus();
      return;
    }
    if (action === "sub-moins" || action === "sub-plus")
      return changerQuantite(el.closest(".sub-product-line"), action === "sub-plus" ? 1 : -1);
    if (action === "sub-retirer") return retirerLigne(el.closest(".sub-product-line"), "sub-retirer");
    if (action === "abo-filtre") {
      aboFiltre = el.dataset.filtre || "tous";
      renderSubscriptions();
      document.querySelector(`[data-op="abo-filtre"][data-filtre="${aboFiltre}"]`)?.focus();
      return;
    }
    if (action === "abo-vue") return ouvrirVueAbonnements(el.dataset.vue || "liste");
    if (action === "agenda-deplier") {
      agendaDeplie = !agendaDeplie;
      renderAgenda();
      document.getElementById("aboAgendaPlus")?.focus();
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
          "Commande créée, planifiée : « Confirmer » sur l’échéance quand le client a donné son accord.",
          "success",
        );
        // Le rendu a detruit le bouton : le focus va a « Confirmer » de cette
        // echeance (decision 6 : le geste suivant, au meme endroit), sinon a
        // l'echeance suivante du meme abonnement -- jamais sur <body>.
        const suivant = [...document.querySelectorAll(`[data-op="confirm-sub-order"][data-id="${CSS.escape(el.dataset.id)}"], [data-op="generate-sub"][data-id="${CSS.escape(el.dataset.id)}"]`)]
          .find((b) => b.checkVisibility());
        suivant?.focus();
      }
      // Decision 6 : confirmer SUR l'echeance, sans changer d'ecran. La
      // commande passe « A preparer » (le serveur reserve le stock).
      if (action === "confirm-sub-order") {
        await context.apiFetch(
          `/api/planned-orders/${encodeURIComponent(el.dataset.orderId)}/confirm`,
          { method: "POST" },
        );
        await context.loadData();
        context.notify("Commande confirmée : elle est à préparer.", "success");
        const badge = [...document.querySelectorAll(`[data-op="confirm-sub-order"][data-id="${CSS.escape(el.dataset.id)}"], [data-op="generate-sub"][data-id="${CSS.escape(el.dataset.id)}"]`)]
          .find((b) => b.checkVisibility());
        (badge || document.getElementById("subscriptionAgenda"))?.focus?.();
      }
      // « Creer les N commandes dues » : une commande par echeance due, l'une
      // apres l'autre (le serveur refuse un doublon : un second appui ne cree
      // rien de plus). Chacune se confirme ensuite sur son echeance.
      if (action === "generate-dues") {
        const dues = echeancesDues();
        let creees = 0;
        try {
          for (const o of dues) {
            await context.apiFetch(
              `/api/subscriptions/${encodeURIComponent(o.subscriptionId)}/orders`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date: o.date }),
              },
            );
            creees += 1;
          }
        } finally {
          await context.loadData();
        }
        context.notify(
          `${creees} commande${creees > 1 ? "s" : ""} créée${creees > 1 ? "s" : ""}, planifiée${creees > 1 ? "s" : ""} : « Confirmer » sur chaque échéance quand le client a donné son accord.`,
          "success",
        );
        document.getElementById("subscriptionAgenda")?.querySelector('[data-op="confirm-sub-order"]')?.focus();
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
  // Le bouton retour du telephone, depuis l'agenda : la liste.
  window.addEventListener("popstate", () => {
    if (vueAbonnements() === "agenda" && history.state?.aboVue !== "agenda") ouvrirVueAbonnements("liste", { depuisHistorique: true });
  });
  // Un rechargement depuis l'agenda repart sur la liste, mais l'entree
  // d'historique garde { aboVue: "agenda" } : la fleche retombait dessus, et
  // popstate ne faisait rien (il fallait toucher deux fois). On l'efface.
  if (history.state?.aboVue === "agenda") history.replaceState(null, "", location.href);
  // L'agenda ouvert, l'ecran passe au-dessus de 820 px (une tablette qu'on
  // tourne) : le bureau montre la liste et l'agenda cote a cote, sans fleche.
  // Il retrouve la vue liste, son titre, et une entree d'historique neutre.
  window.matchMedia?.("(max-width: 820px)").addEventListener?.("change", (event) => {
    if (event.matches || vueAbonnements() !== "agenda") return;
    if (history.state?.aboVue === "agenda") history.replaceState(null, "", location.href);
    document.getElementById("abonnements").dataset.vue = "liste";
    majSousTitreAbonnements();
  });
  document.getElementById("aboTri")?.addEventListener("change", (event) => {
    aboTri = event.target.value;
    renderSubscriptions();
  });
  document
    .getElementById("subscriptionSearch")
    .addEventListener("input", renderSubscriptions);
  document
    .getElementById("subscriptionForm")
    .addEventListener("submit", saveSubscription);
  // La recherche du client et celle du catalogue : Entree n'envoie pas le
  // formulaire (elle choisirait un abonnement a moitie rempli).
  $("subClientSearch").addEventListener("input", rendreClients);
  $("subClientSearch").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const cartes = $("subClientResults").querySelectorAll('[data-op="sub-client"]');
    if (cartes.length === 1) cartes[0].click();
  });
  $("subCatalogueSearch").addEventListener("input", rendreCatalogue);
  $("subCatalogueSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
  });
  $("subProducts").addEventListener("input", (event) => {
    const ligne = event.target.closest(".sub-product-line");
    if (ligne) majLigne(ligne);
  });
  // Le change d'une quantite part au mousedown du geste suivant (le champ perd
  // le focus). Redessiner le catalogue a cet instant remplacait le « + » sous
  // le pointeur : le premier clic n'ajoutait rien. Les comptes changent en place.
  $("subProducts").addEventListener("change", () => {
    if (!$("subCatalogue").hidden) majComptesCatalogue();
  });
  // Les pilules sont des boutons radio : le changement remonte au groupe.
  $("subFrequency").addEventListener("change", majFrequence);
  $("subCustom").addEventListener("input", previewSchedule);
  $("subCustomUnit").addEventListener("change", majFrequence);
  $("subStart").addEventListener("input", previewSchedule);
  $("subStart").addEventListener("change", previewSchedule);
  for (const radio of document.querySelectorAll('input[name="subRappel"]'))
    radio.addEventListener("change", () => majRappel({ depuisPilule: true }));
  $("subReminder").addEventListener("input", () => majRappel());
  for (const point of ["departure", "arrival"]) {
    document.getElementById(`${point}Query`).addEventListener("input", () => {
      if (point === "departure") {
        departure = null;
        departDuDepot = false;
      } else arrival = null;
      document.getElementById(`${point}Results`).hidden = true;
    });
    document
      .getElementById(`${point}Results`)
      .addEventListener("change", (event) => {
        const option = event.target.selectedOptions[0];
        const value = option?.dataset.point
          ? JSON.parse(option.dataset.point)
          : null;
        if (point === "departure") {
          departure = value;
          departDuDepot = false;
        } else {
          arrival = value;
          // Lot 6 : « retour au depart » est coche par defaut ; confirmer une
          // AUTRE arrivee dit le contraire, la case suit (sans changer le
          // reglage memorise : seul un geste sur la case l'ecrit). Et les
          // reglages qui arrivent APRES ne la recochent pas : les commandes
          // (donc les reglages) peuvent arriver apres le choix, sur un
          // reseau lent (operations.spec.js le rejoue).
          const retour = document.getElementById("returnToStart");
          if (value && retour) {
            retour.checked = false;
            retourTouche = true;
          }
        }
      });
  }
  // Lot 6 : une fois touchee par le livreur, la case « retour » n'est plus
  // reprise des Parametres pendant la session (app.js memorise son choix).
  document.getElementById("returnToStart")?.addEventListener("change", () => {
    retourTouche = true;
  });
}

// Lot 6 de l'audit geo (23/09) : le depot par defaut des Parametres remplit le
// depart tant que le livreur n'en a pas choisi un autre (recherche,
// localisation, saisie) ; « retour au depart » suit le reglage tant qu'il n'a
// pas touche la case. Preparer une tournee tient alors en deux gestes :
// choisir les commandes, creer. `forcer` : le reglage vient d'etre change dans
// les Parametres, il s'applique meme a une case deja touchee.
let departDuDepot = false,
  retourTouche = false;
export function preremplirDepart(depot, retour, { forcer = false } = {}) {
  const champ = document.getElementById("departureQuery");
  const caseRetour = document.getElementById("returnToStart");
  if (!champ) return;
  if (depot && (!departure || departDuDepot)) {
    departure = { lat: depot.lat, lng: depot.lng, label: depot.label };
    departDuDepot = true;
    champ.value = depot.label;
    document.getElementById("departureResults").hidden = true;
  } else if (!depot && departDuDepot) {
    departure = null;
    departDuDepot = false;
    champ.value = "";
  }
  if (caseRetour && typeof retour === "boolean" && (forcer || !retourTouche)) {
    caseRetour.checked = retour;
    if (forcer) retourTouche = false;
  }
}

/** Le depart choisi pour la tournee a creer (null s'il n'y en a pas encore). */
export function departChoisi() {
  return departure;
}
export function renderOperations(next) {
  // Une COPIE : pousser dans next.crmClients ajoutait les fiches archivees au
  // tableau que l'ecran Clients liste et compte.
  data = { ...next, crmClients: [...(next.crmClients || [])] };
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
        // « Voir la commande » : une fois confirmee, elle quitte « Planifiees »
        // -- on ouvre donc toutes les commandes, ou elle se trouve toujours.
        `data-action="go-tab" data-target-tab="bons-commande"`,
      )
    : button(
        "generate-sub",
        "Créer la commande",
        `data-id="${h(item.subscriptionId)}" data-date="${h(item.date)}"`,
      );
  return `<article class="op-occurrence ${item.overdue ? "is-overdue" : ""}"><div><span class="op-eyebrow">${h(day(item.date))}${item.overdue ? " · En retard" : ""}</span><strong>${h(item.clientName)}</strong><p>${h(products(item.products))}</p></div>${action}</article>`;
}
/** Une tuile de jour de « Cette semaine » (planche 6a). */
function tuileDeJour(o) {
  const d = new Date(`${o.date}T12:00:00`);
  const semaine = d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "");
  return `<button class="tb-jour" type="button" data-action="go-tab" data-target-tab="abonnements">`
    + `<span class="tb-jour-date"><span class="tb-jour-semaine">${h(semaine)}</span>`
    + `<span class="tb-jour-quantieme">${h(String(d.getDate()))}</span></span>`
    + `<span class="tb-jour-corps"><span class="tb-jour-client">${h(o.clientName || "Client")}</span>`
    + `<span class="tb-jour-produits">${o.overdue ? '<span class="tb-jour-retard">En retard</span> · ' : ""}${h(products(o.products))}</span></span></button>`;
}

/**
 * Une ligne d'anomalie de « A regler » (planche 6a).
 *
 * L'icone est la MEME pour toutes : la planche en dessine plusieurs, mais une
 * icone par type ferait porter la distinction a un dessin de 20 px. Le titre
 * la porte deja, en toutes lettres.
 */
function ligneAnomalie(a) {
  return `<button class="tb-anomalie" type="button" data-action="go-tab" data-target-tab="${h(a.cible)}">`
    + `<svg class="tb-anomalie-icone" viewBox="0 0 24 24" fill="none" aria-hidden="true">`
    + `<path d="M12 9v4M12 17h.01M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20.3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" `
    + `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`
    + `<span class="tb-anomalie-corps"><span class="tb-anomalie-titre">${h(a.titre)}</span>`
    + `<span class="tb-anomalie-detail">${h(a.detail)}</span></span>`
    + `<svg class="tb-anomalie-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true">`
    + `<path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" `
    + `stroke-linejoin="round"></path></svg></button>`;
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
    `Mis à jour à ${datesFr.heure(op.updatedAt)}`;
  document.getElementById("revenueCaveat").textContent = [
    month.missingPrices
      ? `${month.missingPrices} commande${month.missingPrices > 1 ? "s" : ""} sans montant à compléter.`
      : "",
    month.estimatedDates
      ? `${month.estimatedDates} ancienne${month.estimatedDates > 1 ? "s commandes" : " commande"} : date prévue ou date de commande utilisée faute de date de livraison réelle.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  // HUIT barres, pas six (planche 6a). Une lettre par mois, aucun montant
  // ecrit au-dessus : la planche laisse la hauteur porter la donnee.
  // Le mois courant prend une classe -- sa couleur ET la graisse de son
  // etiquette le disent, pour ne pas faire porter le sens a la seule couleur.
  const months = op.history.slice(0, 8).reverse(),
    max = Math.max(1, ...months.map((m) => m.revenue));
  document.getElementById("revenueChart").innerHTML = months
    .map((m) => {
      const courant = m.month === op.today.slice(0, 7);
      const lettre = new Date(`${m.month}-01T12:00:00`)
        .toLocaleDateString("fr-FR", { month: "narrow" });
      return `<div class="revenue-column${courant ? " revenue-courant" : ""}" title="${h(new Date(`${m.month}-01T12:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }))} : ${h(money(m.revenue))}"><span>${h(money(m.revenue))}</span><div class="revenue-track"><i style="height:${Math.max(2, (m.revenue / max) * 100)}%"></i></div><small>${h(lettre)}</small></div>`;
    })
    .join("");
  const weekEnd = plus(op.today, 6);
  const upcoming = op.subscriptions.filter((s) => s.date <= weekEnd);
  // Des TUILES DE JOUR (planche 6a), et non les cartes d'occurrence : celles-ci
  // restent telles quelles dans l'ecran Abonnements, qui les partage.
  document.getElementById("dashboardSubscriptions").innerHTML =
    upcoming.slice(0, 4).map(tuileDeJour).join("") ||
    empty(
      "Aucune livraison d’abonnement à prévoir dans les 7 prochains jours.",
    );
  document.getElementById("opWeekCount").textContent =
    `${upcoming.length} échéance${upcoming.length > 1 ? "s" : ""}`;
  // « A preparer » : les commandes chargees par la page, filtrees par LE
  // predicat partage (commandeAPreparer) -- la pastille de Preparation et le
  // resume de l'ecran lisent les memes. Repli sur le serveur (meme
  // definition) si la liste des commandes n'est pas arrivee.
  const aPreparer = Array.isArray(data.orders) && data.orders.length
    ? data.orders.filter(commandeAPreparer)
    : op.preparing;
  for (const [id, list] of [
    ["dashboardPreparing", aPreparer],
    ["dashboardDelivering", op.delivering],
  ]) {
    document.getElementById(id + "Count").textContent = list.length;
    // Le meme compte, dans le titre de la liste detaillee sous le depliant.
    const compteDetail = document.getElementById(id + "CountDetail");
    if (compteDetail) compteDetail.textContent = list.length;
    // Le sous-titre de la tuile : ce que la planche met sous le nombre.
    const detail = document.getElementById(id + "Detail");
    if (detail) {
      const articles = list.reduce(
        (n, o) => n + (o.products || []).reduce((q, p) => q + (Number(p.quantite) || 0), 0),
        0,
      );
      detail.textContent = list.length
        ? `${articles} article${articles > 1 ? "s" : ""}`
        : "Rien à traiter";
    }
    document.getElementById(id).innerHTML =
      list
        .slice(0, 5)
        .map(
          (o) =>
            // La meme ligne qu'ailleurs (planche TableauDeBord.png : le
            // tableau de bord montre les memes lignes que la preparation).
            `<div class="commande-ligne commande-ligne--tableau"><div class="commande-ligne-main"><span class="etat-commande etat-commande--${etatDeLaCommande(o.status).cle}" aria-hidden="true"></span><span class="commande-ligne-corps"><strong>${h(o.clientName)}</strong><span>${h(products(o.products))}</span></span><span class="pill ${etatDeLaCommande(o.status).pill}">${h(status(o.status))}</span></div></div>`,
        )
        .join("") || empty("Aucune commande pour le moment.");
  }
  // La planche 6a donne a chaque anomalie un TITRE et un DETAIL, et la rend
  // cliquable vers l'ecran qui la traite. Une alerte qu'on ne peut pas suivre
  // ne sert qu'a inquieter.
  const alerts = [];
  // « En retard » = echue ET sans commande, comme l'ecran Abonnements : une
  // echeance deja commandee n'attend plus rien de l'utilisateur.
  const overdue = op.subscriptions.filter((s) => s.overdue && !s.orderId).length;
  if (overdue) {
    alerts.push({
      titre: `${overdue} échéance${overdue > 1 ? "s" : ""} d’abonnement en retard`,
      detail: op.subscriptions
        .filter((s) => s.overdue && !s.orderId)
        .slice(0, 2)
        .map((s) => s.clientName)
        .join(" · ") || "À preparer au plus vite",
      cible: "abonnements",
    });
  }
  // L'ORDRE EST CELUI DE LA PLANCHE (1b, annotation l.194 ; 6a) : « tri par
  // urgence, pas par type -- abonnement en retard, commande bloquee, stock
  // sous le seuil, adresse a corriger ». Les ruptures et les livraisons a
  // reprendre, que l'application connaissait deja, prennent leur rang dans
  // cette echelle au lieu d'etre ajoutees a la fin.
  // (Relecture du 22/09 : « commande bloquee » et « adresse a corriger »
  // manquaient, alors que le serveur les calcule.)
  const bloquees = data.orders.filter((o) =>
    ["importe", "stock_a_verifier"].includes(o.status) && !o.canPrepare,
  );
  if (bloquees.length) {
    alerts.push({
      titre: `${bloquees.length} commande${bloquees.length > 1 ? "s" : ""} bloquée${bloquees.length > 1 ? "s" : ""}`,
      detail: bloquees.slice(0, 2).map((o) => o.numero || o.clientName).filter(Boolean).join(" · ")
        || "Stock insuffisant pour les préparer",
      cible: "preparation",
    });
  }
  const issues = data.orders.filter((o) =>
    ["probleme_livraison", "a_reprogrammer"].includes(o.status),
  ).length;
  if (issues) {
    alerts.push({
      titre: `${issues} livraison${issues > 1 ? "s" : ""} à reprendre`,
      detail: "Absent, refus ou adresse introuvable",
      cible: "livreur",
    });
  }
  // Decision du 23/09 : un « Livre » en retard est accepte meme sur un rayon
  // insuffisant, qui passe alors en negatif. Ce n'est pas une rupture comme
  // une autre : le stock affiche est FAUX tant qu'on n'a pas recompte. Il a sa
  // ligne, avant les ruptures, et n'est pas compte deux fois.
  const estNegatif = (p) => p.quantityAvailable !== null && p.quantityAvailable !== undefined
    && Number(p.quantityAvailable) < 0;
  const negatifs = data.stock.filter(estNegatif);
  if (negatifs.length) {
    alerts.push({
      titre: `${negatifs.length} produit${negatifs.length > 1 ? "s" : ""} en stock négatif`,
      detail: `Livré sur stock insuffisant, à recompter : ${negatifs
        .slice(0, 3)
        .map((p) => `${p.nom || p.name || p.libelle || "Produit"} (${p.quantityAvailable})`)
        .join(", ")}`,
      cible: "stock",
    });
  }
  const ruptures = data.stock.filter((p) => p.stockStatus === "rupture" && !estNegatif(p));
  const out = ruptures.length;
  if (out) {
    alerts.push({
      titre: `${out} produit${out > 1 ? "s" : ""} en rupture`,
      detail: ruptures
        .slice(0, 3)
        .map((p) => p.nom || p.name || p.libelle || "Produit")
        .join(", "),
      cible: "recommande",
    });
  }
  const low = data.stock.filter((p) => p.stockStatus === "stock_faible").length;
  if (low) {
    alerts.push({
      titre: `${low} produit${low > 1 ? "s" : ""} sous le seuil`,
      detail: data.stock
        .filter((p) => p.stockStatus === "stock_faible")
        .slice(0, 3)
        .map((p) => p.nom || p.name || p.libelle || "Produit")
        .join(", "),
      cible: "stock",
    });
  }
  // Une adresse manquante n'appelle un geste que sur une commande ENCORE A
  // FAIRE : le serveur compte aussi les commandes livrees ou annulees, dont
  // l'adresse ne sera plus jamais utilisee. On ne signale que ce qu'on peut
  // encore corriger utilement.
  const sansAdresse = data.orders.filter((o) =>
    !["livre", "annulee"].includes(o.status)
      && (!String(o.address || "").trim() || !String(o.city || "").trim()),
  );
  if (sansAdresse.length) {
    alerts.push({
      titre: `${sansAdresse.length} adresse${sansAdresse.length > 1 ? "s" : ""} à corriger`,
      detail: sansAdresse.slice(0, 2).map((o) => o.clientName).filter(Boolean).join(" · ")
        || "Commandes sans adresse complète",
      cible: "commandes-a-completer",
    });
  }
  // Le sous-titre de l'en-tete lit la tuile « En preparation » : il doit etre
  // recalcule apres ce rendu.
  document.dispatchEvent(new CustomEvent("tableau-de-bord-rendu"));
  const compteAlertes = document.getElementById("opAlertsCount");
  if (compteAlertes) {
    compteAlertes.textContent = alerts.length;
    compteAlertes.hidden = alerts.length === 0;
  }
  document.getElementById("opAlerts").innerHTML =
    alerts.map(ligneAnomalie).join("") ||
    empty("Aucune alerte prioritaire.");
}
// Planche 13a : les filtres d'etat, le tri, et l'agenda deplie ou non.
let aboFiltre = "tous",
  aboTri = "prochaine",
  agendaDeplie = false;
const panier = (lines) =>
  (lines || []).map((p) => `${p.quantite} ${p.nom}`).join(", ");
// « Mer. 23 sept. » (planche 13a) ; l'annee si ce n'est pas celle-ci --
// utils/dates.js, jourCourt en debut de ligne.
const jourCourt = (value) => (value ? datesFr.jourCourt(value, { majuscule: true }) : "—");
// « Mercredi 23 septembre », ou « 12 septembre » sans le jour (planche 3a) ;
// « 1er » pour le premier du mois, l'annee si ce n'est pas celle-ci.
const dateLongue = (value, avecJour = true) =>
  datesFr.jourLong(value, { majuscule: true, semaine: avecJour });
// « Mar » : le jour de la semaine d'une echeance de l'agenda (planche 3c).
const jourSemaine = (value) => {
  const t = new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
// Au telephone, la liste ou l'agenda (planches 3a / 3c). Au bureau, les deux
// se voient cote a cote et la vue ne change rien (CSS).
const vueAbonnements = () => document.getElementById("abonnements")?.dataset.vue || "liste";
function ouvrirVueAbonnements(vue, { depuisHistorique = false } = {}) {
  const ecran = document.getElementById("abonnements");
  if (!ecran) return;
  if (vue === "agenda" && ecran.dataset.vue !== "agenda") history.pushState({ aboVue: "agenda" }, "", location.hash || "#abonnements");
  if (vue === "liste" && ecran.dataset.vue === "agenda" && !depuisHistorique && history.state?.aboVue === "agenda") {
    // Le retour de la page et celui du telephone font la meme chose : un pas
    // en arriere dans l'historique, que popstate ramene ici.
    history.back();
    return;
  }
  ecran.dataset.vue = vue;
  majSousTitreAbonnements();
  window.scrollTo(0, 0);
  const cible = vue === "agenda" ? document.getElementById("aboAgendaRetour") : document.querySelector(".abo-agenda-ouvrir");
  if (cible?.checkVisibility()) cible.focus();
}
// La prochaine echeance d'un abonnement ; en retard si elle n'a pas de
// commande et que sa date est passee.
// Une echeance PASSEE et deja commandee n'est plus « la prochaine » : la ligne
// affichait sa date (passee, sans alerte) des qu'on commandait le plus ancien
// de deux retards.
const prochaineEcheance = (sub) =>
  data.subscriptions.occurrences.find((o) => o.subscriptionId === sub.id
    && (!o.orderId || o.date >= data.subscriptions.today)) || null;
const enRetard = (o) => Boolean(o && o.overdue && !o.orderId);
// Les livraisons que l'agenda compte : a venir, ou deja commandees.
const aVenirAgenda = () =>
  data.subscriptions.occurrences.filter((o) => o.date >= data.subscriptions.today || o.orderId);
// Les echeances DUES : leur rappel est arrive, aucune commande encore. Le meme
// compte que la pastille Abonnements (app.js renderBadgesNav).
const echeancesDues = () =>
  (data.subscriptions?.occurrences || []).filter((o) => o.due && !o.orderId);

/** Le sous-titre de l'ecran : « 6 actifs · 1 en pause · 2 echeances en retard ». */
export function majSousTitreAbonnements() {
  if (!data.subscriptions || !document.getElementById("abonnements")?.classList.contains("active")) return;
  // L'agenda du telephone (planche 3c) : son titre et son compte dans l'en-tete.
  const titre = document.getElementById("pageTitle");
  if (vueAbonnements() === "agenda") {
    const n = aVenirAgenda().length;
    if (titre) titre.textContent = "Les 90 jours";
    const sous = document.getElementById("pageSubtitle");
    if (sous) sous.textContent = `${n} livraison${n > 1 ? "s" : ""} prévue${n > 1 ? "s" : ""}`;
    return;
  }
  if (titre) titre.textContent = "Abonnements";
  const items = data.subscriptions.items;
  const actifs = items.filter((s) => s.status === "active").length;
  const pause = items.filter((s) => s.status === "paused").length;
  const retard = data.subscriptions.occurrences.filter(enRetard).length;
  const morceaux = [`${actifs} actif${actifs > 1 ? "s" : ""}`, `${pause} en pause`];
  if (retard) morceaux.push(`${retard} échéance${retard > 1 ? "s" : ""} en retard`);
  const sous = document.getElementById("pageSubtitle");
  if (sous) sous.textContent = morceaux.join(" · ");
}

function renderSubscriptions() {
  if (!data.subscriptions) return;
  const query = (document.getElementById("subscriptionSearch")?.value || "").toLowerCase();
  const pilules = document.getElementById("aboPilules");
  if (pilules) {
    pilules.innerHTML = [["tous", "Tous"], ["active", "Actifs"], ["paused", "En pause"]]
      .map(([cle, mot]) => `<button class="abo-pilule${aboFiltre === cle ? " abo-pilule--active" : ""}" type="button" data-op="abo-filtre" data-filtre="${cle}" aria-pressed="${aboFiltre === cle}">${mot}</button>`)
      .join("");
  }
  const tri = document.getElementById("aboTri");
  if (tri) tri.value = aboTri;
  const clientDe = (s) => data.crmClients.find((c) => String(c.id) === String(s.clientId));
  const items = data.subscriptions.items
    .filter((s) => aboFiltre === "tous" || s.status === aboFiltre)
    .filter((s) => `${name(clientDe(s) || {})} ${products(s.products)}`.toLowerCase().includes(query))
    .sort((a, b) => {
      if (aboTri === "client") return name(clientDe(a) || {}).localeCompare(name(clientDe(b) || {}), "fr");
      const da = prochaineEcheance(a)?.date || "9999", db = prochaineEcheance(b)?.date || "9999";
      return da.localeCompare(db) || name(clientDe(a) || {}).localeCompare(name(clientDe(b) || {}), "fr");
    });
  document.getElementById("subscriptionList").innerHTML =
    items
      .map((s) => {
        const client = clientDe(s);
        const next = prochaineEcheance(s);
        const retard = s.status === "active" && enRetard(next);
        // Au telephone : la ligne de la charte (disque, nom, « ville ·
        // frequence », badge). Au bureau (planche 13a) : nom et panier, puis
        // frequence, prochaine livraison, etat -- le disque et la ville se
        // retirent (CSS), le panier et les deux cellules apparaissent.
        const etat = etatAbonnement(s);
        const detail = [client?.ville ? context.formatSectorLabel(client.ville) : "", frequency(s)].filter(Boolean).join(" · ");
        const prochaine = s.status !== "active" || !next
          ? "—"
          : retard ? `Échue le ${h(jourCourt(next.date).replace(/^\S+ /, ""))}` : h(jourCourt(next.date));
        const badge = retard
          ? `<span class="pill abo-badge abo-badge--retard"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5"></circle><path d="M12 8v4m0 3.5v.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg>En retard</span>`
          : `<span class="pill abo-badge abo-badge--${etat.cle} ${etat.pill}">${h(etat.mot)}</span>`;
        const nomClient = h(name(client || {}) || "Client introuvable");
        // Au telephone (planche 3a, ligne de 96 px decidee le 23/09) : trois
        // rangees -- client et etat ; echeance et frequence ; panier et rappel.
        // Une pause n'a ni echeance ni rappel : la frequence descend au panier.
        // La forme courte de la planche (« tous les 15 j », « mensuel ») : la
        // longue (« toutes les 2 semaines ») etait coupee derriere l'echeance.
        const frequenceMin = s.frequency.unit === "months"
          ? s.frequency.interval === 1 ? "mensuel" : `tous les ${s.frequency.interval} mois`
          : `tous les ${s.frequency.interval} j`;
        const rythme = s.status === "paused" ? "Livraisons suspendues"
          : s.status !== "active" ? "Plus de livraison"
            : !next ? "Aucune échéance prévue"
              : retard ? `Échéance du ${dateLongue(next.date, false)}` : dateLongue(next.date);
        const rangeeRythme = `<span class="abo-rythme"><span class="abo-rythme-date${retard ? " abo-alerte" : ""}">${h(rythme)}</span>${s.status === "active" ? ` <span class="abo-rythme-frequence">· ${h(frequenceMin)}</span>` : ""}</span>`;
        const rangeePanier = `<span class="abo-panier-rappel">${h([panier(s.products) || "Panier vide", s.status === "active" ? `rappel ${s.reminderDays ?? 0} j` : frequenceMin].join(" · "))}</span>`;
        return `<article class="commande-ligne abonnement-ligne abonnement-ligne--${etat.cle}"><button class="commande-ligne-main" type="button" data-op="open-sub-detail" data-id="${h(s.id)}" aria-label="Ouvrir ${nomClient}, ${h(retard ? "en retard" : etat.mot)}, ${h(frequency(s))}${s.status === "active" && next ? `, prochaine livraison ${h(jourCourt(next.date))}` : ""}"><span class="etat-commande etat-commande--${etat.cle}" aria-hidden="true"></span><span class="commande-ligne-corps"><strong>${nomClient}</strong><span class="abo-detail">${h(detail || "Adresse à compléter")}</span><span class="abo-panier">${h(panier(s.products) || "Panier vide")}</span>${rangeeRythme}${rangeePanier}</span><span class="abo-cellule abo-frequence">${h(frequency(s))}</span><span class="abo-cellule abo-prochaine${retard ? " abo-alerte" : ""}">${prochaine}</span>${badge}</button></article>`;
      })
      .join("") ||
    empty(
      query || aboFiltre !== "tous"
        ? "Aucun abonnement ne correspond à ce filtre."
        : "Crée ton premier abonnement : un client, ses produits et son rythme de livraison.",
    );
  renderAgenda();
  majSousTitreAbonnements();
}

// « Les 90 jours » : d'abord ce qui est EN RETARD (echu, sans commande), puis
// les semaines a partir de CELLE-CI -- deux visibles, le reste derriere « Les N
// semaines suivantes ». Le serveur rend aussi les echeances passees depuis le
// debut de l'abonnement : les grouper par semaine ouvrait l'agenda sur les
// plus anciennes (un abonnement reactive apres deux mois ouvrait sur l'ete).
function renderAgenda() {
  const corps = document.getElementById("subscriptionAgenda");
  if (!corps) return;
  const today = data.subscriptions.today;
  const occurrences = data.subscriptions.occurrences;
  const retards = occurrences.filter(enRetard);
  const aVenir = aVenirAgenda();
  const compte = document.getElementById("aboAgendaCompte");
  if (compte) compte.textContent = `${aVenir.length} livraison${aVenir.length > 1 ? "s" : ""}`;
  const lundiDe = (date) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return iso(d);
  };
  const cetteSemaine = lundiDe(today);
  const semaines = new Map();
  for (const o of aVenir) {
    const cle = o.date < cetteSemaine ? cetteSemaine : lundiDe(o.date);
    if (!semaines.has(cle)) semaines.set(cle, []);
    semaines.get(cle).push(o);
  }
  const groupes = [...semaines.entries()].sort(([a], [b]) => a.localeCompare(b));
  const visibles = agendaDeplie ? groupes : groupes.slice(0, 2);
  const numero = (date) => {
    const j = new Date(`${date}T12:00:00`).getDate();
    return j === 1 ? "1er" : String(j);
  };
  const jourLong = (date) => {
    const d = new Date(`${date}T12:00:00`);
    const mois = d.toLocaleDateString("fr-FR", { month: "long" });
    return `${d.getDate() === 1 ? "1er" : d.getDate()} ${mois}`;
  };
  const ligne = (o) => {
    const retard = enRetard(o);
    // Le RAPPEL : l'abonnement promet « rappel N jours avant ». L'echeance
    // dont le rappel est arrive le dit, sans le panneau d'avant.
    const rappel = !retard && o.due && !o.orderId;
    // Decision 6 de Thomas (24/09) : la commande d'abonnement reste
    // « Planifiee » jusqu'a l'accord du client, et se CONFIRME ici, sur
    // l'echeance. Le badge « A confirmer » ne confirmait rien : il ouvrait
    // Commandes, filtre Planifiees, ou il fallait retrouver la ligne.
    const aConfirmer = o.orderId && ["planifiee", "a_confirmer"].includes(o.orderStatus);
    const geste = aConfirmer
      ? `<button class="abo-creer abo-confirmer" type="button" data-op="confirm-sub-order" data-order-id="${h(o.orderId)}" data-id="${h(o.subscriptionId)}" aria-label="Confirmer la commande du ${h(jourCourt(o.date))} pour ${h(o.clientName)}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></svg><span class="abo-creer-mot">Confirmer</span></button>`
      : o.orderId
        ? `<button class="pill abo-badge abo-badge--commande" type="button" data-action="go-tab" data-target-tab="bons-commande" aria-label="${h(status(o.orderStatus))} : voir dans Commandes">${h(status(o.orderStatus))}</button>`
        : `<button class="abo-creer" type="button" data-op="generate-sub" data-id="${h(o.subscriptionId)}" data-date="${h(o.date)}" aria-label="Créer la commande du ${h(jourCourt(o.date))} pour ${h(o.clientName)}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg><span class="abo-creer-mot">Créer la commande</span></button>`;
    return `<div class="abo-echeance subscription-card${retard ? " abo-echeance--retard" : ""}"><span class="abo-jour" title="${h(jourCourt(o.date))}"><span class="abo-jour-semaine">${h(jourSemaine(o.date))}</span>${numero(o.date)}</span><span class="abo-echeance-texte"><strong>${h(o.clientName)}</strong><span>${h(panier(o.products))}${retard ? ` · échue le ${h(jourCourt(o.date).replace(/^\S+ /, ""))}` : rappel ? " · rappel arrivé" : ""}</span></span>${geste}</div>`;
  };
  const blocs = [];
  if (retards.length) {
    blocs.push(`<section class="abo-semaine abo-semaine--retard" aria-label="En retard"><p class="abo-semaine-titre abo-alerte">En retard · ${retards.length}</p><div class="abo-semaine-lignes">${retards.map(ligne).join("")}</div></section>`);
  }
  for (const [lundi, liste] of visibles) {
    const titre = lundi === cetteSemaine ? "Cette semaine" : `Semaine du ${jourLong(lundi)}`;
    blocs.push(`<section class="abo-semaine" aria-label="${h(titre)}"><p class="abo-semaine-titre">${h(titre)} · ${liste.length}</p><div class="abo-semaine-lignes">${liste.map(ligne).join("")}</div></section>`);
  }
  corps.innerHTML = blocs.length
    ? blocs.join('<div class="abo-separateur" aria-hidden="true"></div>')
    : empty("Aucune livraison prévue dans les 90 jours.");
  // « Creer les N commandes dues » : les echeances dont le rappel est arrive
  // et qui n'ont pas encore de commande -- le compte de la pastille
  // Abonnements. Chacune se confirme ensuite sur son echeance.
  const dues = echeancesDues();
  const toutes = document.getElementById("aboCreerDues");
  if (toutes) {
    toutes.hidden = dues.length < 2;
    toutes.textContent = `Créer les ${dues.length} commandes dues`;
  }
  const plus = document.getElementById("aboAgendaPlus");
  if (plus) {
    const reste = groupes.length - 2;
    plus.hidden = reste <= 0;
    plus.setAttribute("aria-expanded", String(agendaDeplie));
    plus.innerHTML = agendaDeplie
      ? `Moins de semaines<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 15 6-6 6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>`
      : `Les ${reste} semaine${reste > 1 ? "s" : ""} suivante${reste > 1 ? "s" : ""}<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
  }
}
/* ---------------------------------------------------------------------------
 * LA CREATION D'UN ABONNEMENT -- planches 3b / 5b, posee le 23/09.
 * Le client se choisit en carte (recherche), le panier se compose depuis le
 * catalogue avec le stock disponible, la frequence est une pilule et
 * l'apercu des trois prochaines dates se recalcule a chaque geste. Rien de
 * ce que l'ancien formulaire permettait n'est perdu : fiche client creee a la
 * volee, quantite saisie au clavier, nombre de jours ou de MOIS quelconque,
 * rappel de 0 a 60 jours, statut et notes (sous « Plus d'options »).
 * ------------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
// Une fiche nouvelle en cours de saisie, a la place du choix d'un client.
let ficheNouvelle = false;
// La prochaine livraison de l'apercu : la note du rappel en depend.
let prochaineLivraison = "";
const nomProduit = (p) => p.nom || p.produit || p.name || p.code || "Produit";
// Le disponible du serveur (stock moins les commandes actives), sinon le stock.
const quantiteDisponible = (p) => {
  const v = p.quantityAvailable ?? p.quantite ?? p.stock ?? p.qte;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const texteStock = (p) => {
  const q = quantiteDisponible(p);
  return [p.code, q === null ? "stock à renseigner" : q <= 0 ? "rupture" : `${q} en stock`]
    .filter(Boolean)
    .join(" · ");
};
const adresseClient = (c) => {
  const a = getAddressParts(c);
  const ville = [a.postalCode, villeAffichee(a.city)].filter(Boolean).join(" ");
  const secteur = c.ville ? context.formatSectorLabel(c.ville) : "";
  // La planche ecrit « ..., 25000 Besancon · Besancon » : le secteur n'est
  // ajoute que s'il dit autre chose que la ville.
  return [[a.address, ville].filter(Boolean).join(", "), normalizeTextKey(secteur) !== normalizeTextKey(a.city) ? secteur : ""]
    .filter(Boolean)
    .join(" · ");
};
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const jourSemaineDe = (value) => JOURS[new Date(`${value}T12:00:00Z`).getUTCDay()];
// « Mardi 22 septembre », « Jeudi 1er octobre » ; l'annee si elle change.
const jourLong = (value) => {
  const d = new Date(`${value}T12:00:00Z`);
  const n = d.getUTCDate();
  const annee = d.getUTCFullYear() !== Number(String(data.subscriptions?.today || "").slice(0, 4)) ? ` ${d.getUTCFullYear()}` : "";
  return `${majuscule(jourSemaineDe(value))} ${n === 1 ? "1er" : n} ${MOIS[d.getUTCMonth()]}${annee}`;
};
const jourCourtLong = (value) => jourLong(value).replace(/^\S+ /, "");
// La meme regle que lib/subscriptions.js occurrenceDate : l'apercu dit ce que
// le serveur calculera (dernier jour du mois quand il est plus court).
function dateOccurrence(start, frequence, index) {
  const a = new Date(`${start}T12:00:00Z`);
  if (frequence.unit === "days")
    return new Date(+a + index * frequence.interval * 86400000).toISOString().slice(0, 10);
  const m = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + index * frequence.interval, 1, 12));
  const dernier = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate();
  m.setUTCDate(Math.min(a.getUTCDate(), dernier));
  return m.toISOString().slice(0, 10);
}
const frequenceChoisie = () =>
  document.querySelector('input[name="subFrequence"]:checked')?.value || "monthly";
function lireFrequence() {
  const f = frequenceChoisie();
  if (f === "monthly") return { unit: "months", interval: 1 };
  if (f === "custom")
    return { unit: $("subCustomUnit").value === "months" ? "months" : "days", interval: Number($("subCustom").value) };
  return { unit: "days", interval: Number(f) };
}
function cocher(nom, valeur) {
  const radio = document.querySelector(`input[name="${nom}"][value="${valeur}"]`)
    || document.querySelector(`input[name="${nom}"][value="custom"]`);
  radio.checked = true;
}

/* Le client : une recherche, des cartes ; la carte choisie devient le champ. */
function rendreClients() {
  rendreRechercheClients({
    saisie: $("subClientSearch").value,
    clients: data.crmClients,
    liste: $("subClientResults"),
    note: $("subClientReste"),
    geste: 'data-op="sub-client"',
  });
}

/**
 * La recherche d'un client en cartes (planches 3b / 5b). PARTAGEE par la
 * creation d'abonnement et par la nouvelle commande (parcours simplifies,
 * 24/09) : un seul composant, un seul comportement -- nom, ville, rue ou
 * code postal ; trois chiffres ou plus cherchent le telephone ; six cartes au
 * plus, la note dit le reste. `geste` : l'attribut que porte chaque carte
 * (data-op="sub-client" ici, data-action="cc-client" dans app.js).
 */
export function rendreRechercheClients({ saisie, clients, liste, note, geste }) {
  const q = normalizeTextKey(saisie);
  const chiffres = String(saisie || "").replace(/\D/g, "");
  const actifs = (clients || []).filter((c) => !c.crmArchived);
  const trouves = actifs
    .filter((c) =>
      !q
      || normalizeTextKey([name(c), c.ville, c.rue, c.address, c.codePostal].join(" ")).includes(q)
      || (chiffres.length >= 3 && String(c.telephone || c.phone || "").replace(/\D/g, "").includes(chiffres)))
    .sort((a, b) => name(a).localeCompare(name(b), "fr"));
  const MAX = 6;
  liste.innerHTML = trouves
    .slice(0, MAX)
    .map((c) => `<div role="listitem"><button type="button" class="abo-cr-client-carte" ${geste} data-id="${h(c.id)}"><strong>${h(name(c) || "Client sans nom")}</strong><span>${h(adresseClient(c) || "Adresse à compléter")}</span></button></div>`)
    .join("");
  note.hidden = trouves.length > 0 && trouves.length <= MAX;
  note.textContent = !trouves.length
    ? actifs.length
      ? "Aucun client ne correspond : crée sa fiche."
      : "Aucun client pour l’instant : crée sa fiche."
    : `${trouves.length - MAX} autre${trouves.length - MAX > 1 ? "s" : ""} : précise la recherche.`;
}

/** « 12 avenue ..., 25000 Besançon » : l'adresse d'une carte de client. */
export function adresseDeCarteClient(c) {
  return adresseClient(c);
}
function majClient() {
  const id = $("subClient").value;
  const c = id ? data.crmClients.find((x) => String(x.id) === String(id)) : null;
  $("subClientChoisi").hidden = !c || ficheNouvelle;
  $("subClientRecherche").hidden = Boolean(c) || ficheNouvelle;
  const fiche = $("subNewClient");
  fiche.hidden = !ficheNouvelle;
  fiche.disabled = !ficheNouvelle;
  const bouton = $("subNouveauClient");
  bouton.textContent = ficheNouvelle ? "Choisir un client existant" : "Créer une fiche client";
  bouton.setAttribute("aria-expanded", String(ficheNouvelle));
  // Le client choisi, la carte se replie sur lui : « Creer une fiche client »
  // n'a plus lieu d'etre (la croix du champ rend la recherche).
  bouton.hidden = Boolean(c) && !ficheNouvelle;
  if (c) {
    $("subClientNom").textContent = name(c) || "Client sans nom";
    $("subClientAdresse").querySelector("span").textContent = adresseClient(c) || "Adresse à compléter";
  } else if (!ficheNouvelle) rendreClients();
}

/* Le panier : une ligne par produit, quantite en pas de un ou au clavier. */
function majLigne(ligne) {
  const nom = ligne.querySelector(".abo-cr-produit-nom").textContent;
  const q = Number(ligne.querySelector(".sub-quantity").value);
  ligne.querySelector('[data-op="sub-moins"]').setAttribute("aria-label", q <= 1 ? `Retirer ${nom}` : `Un de moins : ${nom}`);
}
function majPanier() {
  const vide = !document.querySelector("#subProducts .sub-product-line");
  $("subPanierVide").hidden = !vide;
  if (!$("subCatalogue").hidden) rendreCatalogue();
}
function ligneProduit(produit, quantite, secours) {
  const ligne = document.createElement("div");
  ligne.className = "sub-product-line abo-cr-produit";
  ligne.dataset.productId = produit ? String(produit.id) : String(secours?.stockId || "");
  const nom = produit ? nomProduit(produit) : secours?.nom || "Produit";
  const stock = produit ? texteStock(produit) : [secours?.code, "retiré du catalogue"].filter(Boolean).join(" · ");
  // « Retirer » : l'ancien formulaire retirait une ligne d'un geste, quelle que
  // soit sa quantite ; « − » ne le fait qu'a un.
  ligne.innerHTML = `<span class="abo-cr-produit-texte"><span class="abo-cr-produit-nom">${h(nom)}</span><span class="abo-cr-produit-stock">${h(stock)}</span><button type="button" class="abo-cr-lien abo-cr-retirer" data-op="sub-retirer" aria-label="Retirer ${h(nom)} du panier">Retirer</button></span><span class="abo-cr-pas"><button type="button" class="abo-cr-pas-bouton abo-cr-pas--moins" data-op="sub-moins"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg></button><input class="sub-quantity abo-cr-quantite" type="number" min="1" max="10000" step="1" inputmode="numeric" required value="${h(quantite)}" aria-label="Quantité de ${h(nom)}"><button type="button" class="abo-cr-pas-bouton abo-cr-pas--plus" data-op="sub-plus" aria-label="Un de plus : ${h(nom)}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg></button></span>`;
  majLigne(ligne);
  return ligne;
}
const ligneDuPanier = (id) =>
  [...document.querySelectorAll("#subProducts .sub-product-line")].find((l) => l.dataset.productId === String(id));
function ajouterProduit(id) {
  const existante = ligneDuPanier(id);
  if (existante) {
    const input = existante.querySelector(".sub-quantity");
    input.value = Math.min(10000, (Number(input.value) || 0) + 1);
    majLigne(existante);
  } else {
    const produit = data.stock.find((p) => String(p.id) === String(id));
    if (!produit) return;
    $("subProducts").append(ligneProduit(produit, 1));
  }
  majPanier();
}
// Le focus ne tombe pas sur <body> : le meme geste sur la ligne suivante,
// sinon le catalogue.
function retirerLigne(ligne, geste) {
  const suivante = ligne.nextElementSibling || ligne.previousElementSibling;
  ligne.remove();
  majPanier();
  (suivante?.querySelector(`[data-op="${geste}"]`) || $("subCatalogueBouton")).focus();
}
function changerQuantite(ligne, pas) {
  const input = ligne.querySelector(".sub-quantity");
  const q = (Number(input.value) || 0) + pas;
  if (q < 1) return retirerLigne(ligne, "sub-moins");
  input.value = Math.min(10000, q);
  majLigne(ligne);
  if (!$("subCatalogue").hidden) rendreCatalogue();
}
// « code · stock », et « N au panier » quand il y est.
function texteCatalogue(p) {
  const dans = ligneDuPanier(p.id);
  const combien = dans ? Number(dans.querySelector(".sub-quantity").value) : 0;
  return `${texteStock(p)}${combien ? ` · ${combien} au panier` : ""}`;
}
// Les comptes du catalogue, sans toucher a ses boutons.
function majComptesCatalogue() {
  for (const bouton of $("subCatalogueListe").querySelectorAll('[data-op="sub-ajouter"]')) {
    const p = (data.stock || []).find((x) => String(x.id) === bouton.dataset.id);
    const texte = bouton.closest(".abo-cr-produit")?.querySelector(".abo-cr-produit-stock");
    if (p && texte) texte.textContent = texteCatalogue(p);
  }
}
function rendreCatalogue() {
  const q = normalizeTextKey($("subCatalogueSearch").value);
  const trouves = (data.stock || [])
    .filter((p) => !q || normalizeTextKey(`${nomProduit(p)} ${p.code || ""}`).includes(q))
    .sort((a, b) => nomProduit(a).localeCompare(nomProduit(b), "fr"));
  const MAX = 40;
  const lignes = trouves.slice(0, MAX).map((p) => {
    const nom = nomProduit(p);
    return `<div role="listitem" class="abo-cr-produit"><span class="abo-cr-produit-texte"><span class="abo-cr-produit-nom">${h(nom)}</span><span class="abo-cr-produit-stock">${h(texteCatalogue(p))}</span></span><button type="button" class="abo-cr-pas-bouton abo-cr-pas--plus" data-op="sub-ajouter" data-id="${h(p.id)}" aria-label="Ajouter ${h(nom)} au panier"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path></svg></button></div>`;
  });
  $("subCatalogueListe").innerHTML = lignes.join("")
    || `<p class="abo-cr-note">${data.stock?.length ? "Aucun produit ne correspond." : "Le catalogue est vide : ajoute des produits dans Stock."}</p>`;
  if (trouves.length > MAX)
    $("subCatalogueListe").insertAdjacentHTML("beforeend", `<p class="abo-cr-note">${trouves.length - MAX} autres : précise la recherche.</p>`);
}
function basculerCatalogue(ouvrir) {
  const catalogue = $("subCatalogue");
  catalogue.hidden = ouvrir === undefined ? !catalogue.hidden : !ouvrir;
  $("subCatalogueBouton").setAttribute("aria-expanded", String(!catalogue.hidden));
  $("subCatalogueBouton").textContent = catalogue.hidden ? "Catalogue" : "Fermer le catalogue";
  if (!catalogue.hidden) rendreCatalogue();
}

/* La frequence, l'apercu des trois dates, le rappel. */
function majFrequence() {
  const autre = frequenceChoisie() === "custom";
  $("subCustomWrap").hidden = !autre;
  $("subCustomWrap").disabled = !autre;
  $("subCustom").max = $("subCustomUnit").value === "months" ? "12" : "366";
  previewSchedule();
}
function previewSchedule() {
  const start = $("subStart").value;
  const f = lireFrequence();
  const max = f.unit === "months" ? 12 : 366;
  const liste = $("subApercu");
  const note = $("subScheduleHint");
  prochaineLivraison = "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(f.interval) || f.interval < 1 || f.interval > max) {
    liste.innerHTML = "";
    note.textContent = !start
      ? "Choisis la date de la première livraison."
      : "Fréquence invalide : 1 à 366 jours ou 1 à 12 mois.";
    majRappel();
    return;
  }
  // Les trois PROCHAINES : un abonnement qu'on modifie a commence il y a des
  // mois ; ses premieres dates sont passees.
  const today = data.subscriptions?.today || iso(new Date());
  let i = 0;
  while (i < 5000 && dateOccurrence(start, f, i) < today) i++;
  const dates = [0, 1, 2].map((k) => ({ index: i + k, date: dateOccurrence(start, f, i + k) }));
  prochaineLivraison = dates[0].date;
  const ecart = f.unit === "days" ? `+ ${f.interval} j` : `+ ${f.interval} mois`;
  liste.innerHTML = dates
    .map((d, k) => `<li class="abo-cr-apercu-date${k === 0 ? " abo-cr-apercu-date--premiere" : ""}"><span class="abo-cr-point" aria-hidden="true"></span><span class="abo-cr-apercu-jour">${h(jourLong(d.date))}</span><span class="abo-cr-apercu-ecart">${d.index === 0 ? "départ" : ecart}</span></li>`)
    .join("");
  if (f.unit === "months") {
    const jour = Number(start.slice(8, 10));
    note.textContent = `Le ${jour === 1 ? "1er" : jour} ${f.interval === 1 ? "de chaque mois" : `du mois, tous les ${f.interval} mois`}${jour >= 29 ? " ; le dernier jour du mois quand il est plus court." : "."}`;
  } else if (f.interval % 7 === 0) {
    note.textContent = `Toujours le ${jourSemaineDe(dates[0].date)} : un intervalle de ${f.interval} jours garde le jour de la semaine.`;
  } else {
    const semaines = majuscule(dates.map((d) => jourSemaineDe(d.date)).join(", "));
    const proche = f.interval <= 31 ? `« ${Math.min(28, Math.max(7, Math.round(f.interval / 7) * 7))} j »` : "un multiple de 7 jours";
    note.textContent = `${semaines} : un intervalle de ${f.interval} jours décale le jour de la semaine. Choisis « Mensuel » pour garder la même date, ${proche} pour garder le même jour.`;
  }
  majRappel();
}
function majRappel({ depuisPilule = false } = {}) {
  const choix = document.querySelector('input[name="subRappel"]:checked')?.value;
  if (depuisPilule && choix && choix !== "custom") $("subReminder").value = choix;
  $("subReminderWrap").hidden = choix !== "custom";
  const n = Number($("subReminder").value);
  const valide = $("subReminder").value !== "" && Number.isInteger(n) && n >= 0 && n <= 60;
  $("subRappelValeur").textContent = !valide ? "—" : n === 0 ? "Aucun" : `${n} j`;
  // La promesse est celle du serveur (due = rappel <= aujourd'hui) : le compte
  // « Echeances a preparer » du tableau de bord.
  $("subRappelNote").textContent = !valide
    ? "Le rappel va de 0 à 60 jours."
    : !prochaineLivraison
      ? "L’échéance compte dans « Échéances à préparer » du tableau de bord. De 0 à 60 jours."
      : n === 0
        ? `Sans rappel, la livraison du ${jourCourtLong(prochaineLivraison)} compte dans « Échéances à préparer » du tableau de bord le jour même. De 0 à 60 jours.`
        : `Le ${jourCourtLong(plus(prochaineLivraison, -n))}, la livraison du ${jourCourtLong(prochaineLivraison)} passe dans « Échéances à préparer » du tableau de bord. De 0 à 60 jours.`;
}
function openEditor(id) {
  editingId = id || null;
  const sub = data.subscriptions?.items.find((s) => s.id === id);
  const form = document.getElementById("subscriptionForm");
  form.reset();
  $("subDialogTitle").textContent = sub
    ? "Modifier l’abonnement"
    : "Nouvel abonnement";
  $("subSave").textContent = sub ? "Enregistrer les modifications" : "Créer l’abonnement";
  // Le client : la fiche de l'abonnement (meme archivee), sinon la recherche.
  $("subClient").value = sub ? String(sub.clientId) : "";
  $("subClientSearch").value = "";
  ficheNouvelle = false;
  majClient();
  // Le panier. Une ligne dont le produit a quitte le catalogue reste visible,
  // nommee : l'enregistrement le signalera plutot que de la perdre en silence.
  $("subProducts").innerHTML = "";
  for (const line of sub?.products || []) {
    const produit = data.stock.find((p) => String(p.id) === String(line.stockId))
      || data.stock.find((p) => line.code && p.code === line.code);
    $("subProducts").append(ligneProduit(produit, line.quantite || 1, line));
  }
  $("subCatalogueSearch").value = "";
  majPanier();
  // Un panier vide ouvre le catalogue : c'est le seul chemin pour le remplir.
  basculerCatalogue(!sub?.products?.length);
  $("subStart").value = sub?.startDate || data.subscriptions.today;
  // La frequence. « Tous les 2 mois » n'a pas de pilule : « Autre... » en mois
  // (l'ancien formulaire rouvrait tout abonnement en mois sur « Mensuel » :
  // l'enregistrer en faisait « tous les mois »).
  const f = sub?.frequency || { unit: "months", interval: 1 };
  const pilule = f.unit === "months"
    ? f.interval === 1 ? "monthly" : "custom"
    : ["7", "10", "14", "15", "21", "28"].includes(String(f.interval)) ? String(f.interval) : "custom";
  cocher("subFrequence", pilule);
  $("subCustom").value = pilule === "custom" ? f.interval : 10;
  $("subCustomUnit").value = pilule === "custom" && f.unit === "months" ? "months" : "days";
  $("subReminder").value = sub?.reminderDays ?? 7;
  cocher("subRappel", String(sub?.reminderDays ?? 7));
  $("subNotes").value = sub?.notes || "";
  $("subStatus").value = sub?.status || "active";
  // Ce qui est regle hors des defauts se voit : le statut et les notes.
  $("subOptions").open = Boolean(sub && (sub.status !== "active" || sub.notes));
  $("subModifNote").hidden = !sub;
  $("subError").textContent = "";
  majFrequence();
  $("subscriptionDialog").showModal();
}
async function saveSubscription(event) {
  event.preventDefault();
  const save = document.getElementById("subSave");
  save.disabled = true;
  try {
    const lines = [...document.querySelectorAll("#subProducts .sub-product-line")].map(
      (row) => ({
        productId: row.dataset.productId,
        quantite: Number(row.querySelector(".sub-quantity").value),
      }),
    );
    if (!lines.length) throw new Error("Ajoute au moins un produit.");
    let clientId = document.getElementById("subClient").value;
    if (!ficheNouvelle && !clientId)
      throw new Error("Choisis un client, ou crée sa fiche.");
    if (ficheNouvelle) {
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
      // La fiche existe : un second envoi (apres une erreur) ne la recree pas.
      document.getElementById("subClient").value = String(clientId);
      ficheNouvelle = false;
      majClient();
    }
    const payload = {
      clientId,
      products: lines,
      startDate: document.getElementById("subStart").value,
      frequency: lireFrequence(),
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
    // L'erreur est en bas du formulaire : elle se voit, sans chercher.
    document.getElementById("subError").scrollIntoView?.({ block: "nearest" });
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
  // Lot 5 (decision 5 de Thomas, 23/09) : ~100 m (3 decimales). La position
  // exacte ne quitte pas le telephone : ni le serveur ni le calcul routier ne
  // la recoivent. Le serveur arrondit aussi ce qu'il stocke (normalizeRoute).
  const arrondi = (v) => Math.round(v * 1000) / 1000;
  departure = {
    lat: arrondi(location.coords.latitude),
    lng: arrondi(location.coords.longitude),
    label: "Ma position actuelle",
  };
  departDuDepot = false;
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

// AUCUNE DONNEE PERDUE, sur une base de la FORME DE LA PRODUCTION (25/09), par
// l'API seule, sur un serveur seme (port 3603). Lot « donnees clients » de la
// chasse aux defauts du 24/09.
//
// La base : le jeu « production » (jeu-production.js : 97 clients, 224
// commandes livrees dont la plupart sans montant, 429 ventes), enrichi de ce
// que l'import effacait -- des fiches CRM (email, prenom, preferences,
// source...), deux fiches archivees que le fichier cite, trois prospects
// absents du fichier, un abonnement et un rappel.
//
// Ce qui est prouve, avant / apres :
//   - au demarrage, la migration fige le montant TTC des commandes dont le CA
//     venait des ventes, et le CA de CHAQUE MOIS est celui que l'ancien calcul
//     donnait (recalcule ici depuis les donnees brutes, sans le serveur) ;
//     la rejouer (redemarrage) ne change rien ;
//   - pour un import COMPLET (les ventes de la base), PARTIEL (un seul mois)
//     et VIDE (l'en-tete seul) : aucune fiche, commande, vente, abonnement ou
//     rappel ne disparait ; les champs CRM de chaque fiche sont identiques ;
//     les commandes existantes gardent produits, statut et montant ; le CA des
//     mois ne bouge pas (hors commandes que l'import cree).
//
// SEREO_BASE_SQLITE (facultatif) : le meme banc sur une base SQLite ecrite
// par une autre version (preuve « base ecrite par v1.45.1 ») ; elle est
// copiee, jamais modifiee.
const { test, expect } = require("./tuiles");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { demarrer } = require("./serveur-seme");
const { jeuProduction } = require("./jeu-production");
const { classeur } = require("../aide-import-ventes");

test.describe.configure({ mode: "serial" });

const BASE_EXTERNE = process.env.SEREO_BASE_SQLITE || "";
const CHAMPS_CRM = ["id", "nom", "prenom", "email", "telephone", "rue", "codePostal", "ville", "notes", "source", "preferences",
  "needs", "estimatedFrequency", "crmStatus", "crmArchived", "firstContactDate", "crmConvertedAt", "createdAt"];

/** Le jeu « production », enrichi de ce que l'ancien import effacait. */
function semeEnrichi() {
  const seed = jeuProduction();
  const cites = new Set(seed.ventes.map(v => v.client));
  const dansLeFichier = seed.clients.filter(c => cites.has(c.nom));
  dansLeFichier.slice(0, 12).forEach((c, i) => Object.assign(c, {
    prenom: `Contact ${i + 1}`, email: `contact${i + 1}@exemple.test`, preferences: "Gants taille M", source: "salon",
    needs: "Livrer le matin", estimatedFrequency: "mensuelle", crmStatus: "client_actif", createdAt: "2026-03-01T08:00:00.000Z"
  }));
  dansLeFichier.slice(12, 14).forEach(c => Object.assign(c, { crmArchived: true, email: "archive@exemple.test" }));
  const prospects = [1, 2, 3].map(i => ({
    id: `prospect-${i}`, nom: `Prospect ${i}`, prenom: "Julie", email: `prospect${i}@exemple.test`, telephone: `038400000${i}`,
    rue: `${i} rue Neuve`, codePostal: "39300", ville: "Champagnole", crmStatus: "prospect", source: "salon",
    firstContactDate: "2026-09-01", createdAt: "2026-09-01T08:00:00.000Z", produits: []
  }));
  seed.clients.push(...prospects);
  seed.subscriptions = [{
    id: "sub-prospect", clientId: "prospect-1", status: "active", startDate: "2026-10-01", frequency: { unit: "months", interval: 1 },
    reminderDays: 2, notes: "", products: [{ stockId: seed.stock[0].id, code: seed.stock[0].code, nom: seed.stock[0].nom, quantite: 2, prixUnitaire: 5, totalLigne: 10 }]
  }];
  seed.relances = [{ id: "rel-prospect", clientId: "prospect-2", datePrevue: "2026-10-02", status: "a_faire", motif: "Rappeler pour le devis", type: "appel" }];
  return seed;
}

/** Les tables d'une base SQLite (copie), lues sans le serveur. */
function lireBase(fichier) {
  const base = new DatabaseSync(fichier, { readOnly: true });
  const table = nom => base.prepare(`SELECT payload FROM ${nom} ORDER BY sort_order`).all().map(l => JSON.parse(l.payload));
  const lu = { clients: table("clients"), commandes: table("commandes"), ventes: table("ventes") };
  base.close();
  return lu;
}

// --- L'ANCIEN calcul du CA (v1.46.0), refait depuis les donnees brutes ------------
const cle = v => String(v ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const nombre = v => {
  if (v === null || v === undefined || v === "") return NaN;
  let t = String(v).trim().replace(/\s| /g, "").replace(/[^\d,.-]/g, "");
  if (t.includes(".") && t.includes(",")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else t = t.replace(",", ".");
  return Number(t);
};
const premierPositif = (...vs) => { for (const v of vs) { const n = nombre(v); if (Number.isFinite(n) && n > 0) return n; } return 0; };
const jourParis = instant => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));

function caAncienParMois({ commandes, ventes }) {
  const parBon = new Map();
  for (const v of ventes) {
    const q = Math.max(0, nombre(v.quantite ?? v.quantity) || 0);
    const total = premierPositif(v.totalLigne, v.total, v.ttc, v.TTC, v.ht, v.HT, v.montant, (nombre(v.prixUnitaire) || 0) * q);
    if (!total || !v.client) continue;
    const k = `${cle(v.client)}|${String(v.dateCommandeIso || "").slice(0, 10)}`;
    parBon.set(k, Math.round(((parBon.get(k) || 0) + total) * 100) / 100);
  }
  const mois = {};
  for (const o of commandes.filter(c => c.status === "livre")) {
    const lignes = (o.products || []).reduce((s, l) => s + (premierPositif(l.totalLigne, l.total, l.ttc, l.ht)
      || Math.max(0, nombre(l.quantite) || 0) * Math.max(0, nombre(l.prixUnitaire) || 0)), 0);
    const explicite = premierPositif(o.total, o.totalTtc, o.ttc, o.montantTotal, o.montant) || lignes;
    const montant = explicite || parBon.get(`${cle(o.clientName)}|${o.dateCommande}`) || parBon.get(`${cle(o.clientName)}|`) || 0;
    const jour = (o.deliveredAt && jourParis(o.deliveredAt)) || o.deliveryDate || o.dateCommande;
    const m = String(jour).slice(0, 7);
    mois[m] = Math.round(((mois[m] || 0) + montant) * 100) / 100;
  }
  return mois;
}

// --- Le serveur ---------------------------------------------------------------------
const racine = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-fusion-prod-"));
const FICHIER_BASE = path.join(racine, "base.sqlite");
let srv;
let brut; // la base avant le premier demarrage : { clients, commandes, ventes }

async function lancer() {
  if (srv) await srv.arreter();
  // Le port n'est ecrit qu'ICI (test/ports-e2e.test.js).
  srv = await demarrer({ port: 3603, volume: "production", seed: semeEnrichi(), env: { SEREO_SQLITE_PATH: FICHIER_BASE } });
}

/** Une base neuve : le jeu enrichi, ou une copie de SEREO_BASE_SQLITE. */
async function baseNeuve() {
  if (srv) { await srv.arreter(); srv = null; }
  for (const f of fs.readdirSync(racine)) fs.rmSync(path.join(racine, f), { force: true, recursive: true });
  if (BASE_EXTERNE) {
    fs.copyFileSync(BASE_EXTERNE, FICHIER_BASE);
    brut = lireBase(FICHIER_BASE);
  } else {
    const seed = semeEnrichi();
    brut = { clients: seed.clients, commandes: seed.commandes, ventes: seed.ventes };
  }
  await lancer();
}

test.afterAll(async () => {
  if (srv) await srv.arreter();
  fs.rmSync(racine, { recursive: true, force: true });
});

const api = async chemin => (await fetch(srv.base + chemin)).json();
const liste = r => (Array.isArray(r) ? r : r.orders || r.items || []);
async function instantane() {
  const operations = await api("/api/operations");
  return {
    clients: await api("/api/clients"),
    commandes: liste(await api("/api/orders")),
    ventes: await api("/api/ventes"),
    abonnements: (await api("/api/subscriptions")).items,
    rappels: await api("/api/crm/relances"),
    ca: Object.fromEntries(operations.history.filter(m => m.revenue !== 0).map(m => [m.month, m.revenue]))
  };
}

const fr = iso => String(iso || "").slice(0, 10).split("-").reverse().join("/");
/** Un fichier de ventes fait des lignes `ventes` (la forme d'un export Ximi). */
function fichier(ventes) {
  const entete = ["Date", "Statut", "Client", "Code", "Produit", "Quantite", "Prix unitaire", "HT", "TTC", "Telephone", "Rue", "Code Postal", "Ville"];
  const lignes = ventes.map(v => [fr(v.dateCommandeIso), v.statutFacture || "", v.client, v.codeProduit || "", v.produit || "", String(v.quantite),
    String(v.prixUnitaire ?? ""), String(v.ht ?? ""), String(v.ttc ?? ""), v.telephone || "", v.rue || "", v.codePostal || "", v.ville || ""]);
  return classeur([entete, ...lignes]);
}
async function importer(ventes) {
  const form = new FormData();
  form.append("file", new Blob([fichier(ventes)]), "ventes.xlsx");
  const r = await fetch(srv.base + "/api/import/ventes", { method: "POST", body: form });
  return { status: r.status, body: await r.json() };
}

/** Rien n'a disparu, rien n'a change en dehors de ce que le fichier dit. */
function verifierRienPerdu(avant, apres, { nom }) {
  const clientsApres = new Map(apres.clients.map(c => [c.id, c]));
  const perdus = avant.clients.filter(c => !clientsApres.has(c.id)).map(c => c.nom);
  expect(perdus, `${nom} : fiches disparues`).toEqual([]);
  const crm = c => Object.fromEntries(CHAMPS_CRM.map(ch => [ch, c?.[ch] ?? ""]));
  const changees = avant.clients.filter(c => JSON.stringify(crm(c)) !== JSON.stringify(crm(clientsApres.get(c.id))))
    .map(c => ({ avant: crm(c), apres: crm(clientsApres.get(c.id)) }));
  expect(changees, `${nom} : champs CRM changes`).toEqual([]);

  const commandesApres = new Map(apres.commandes.map(o => [o.id, o]));
  expect(avant.commandes.filter(o => !commandesApres.has(o.id)).map(o => o.id), `${nom} : commandes disparues`).toEqual([]);
  const forme = o => JSON.stringify([o.status, o.montantTtc ?? null, (o.products || []).map(p => [p.code, p.nom, Number(p.quantite)])]);
  expect(avant.commandes.filter(o => forme(o) !== forme(commandesApres.get(o.id))).map(o => o.id), `${nom} : commandes existantes changees`).toEqual([]);

  const ventesApres = new Set(apres.ventes.map(v => `${v.client}|${v.dateCommandeIso}|${v.codeProduit}|${v.quantite}|${v.ttc}`));
  const ventesPerdues = avant.ventes.filter(v => !ventesApres.has(`${v.client}|${v.dateCommandeIso}|${v.codeProduit}|${v.quantite}|${v.ttc}`));
  expect(ventesPerdues.length, `${nom} : ventes disparues`).toBe(0);
  expect(apres.ventes.length, `${nom} : ventes en plus (doublons)`).toBe(avant.ventes.length);

  expect(apres.abonnements.map(s => s.id), `${nom} : abonnements`).toEqual(avant.abonnements.map(s => s.id));
  expect(apres.rappels.map(r => r.id).sort(), `${nom} : rappels`).toEqual(avant.rappels.map(r => r.id).sort());

  // Le CA de chaque mois, hors commandes que l'import vient de creer.
  const nouvelles = apres.commandes.filter(o => !avant.commandes.some(a => a.id === o.id));
  const caSansNouvelles = { ...apres.ca };
  for (const o of nouvelles.filter(c => c.status === "livre")) {
    const m = String(o.dateCommande).slice(0, 7);
    caSansNouvelles[m] = Math.round(((caSansNouvelles[m] || 0) - (o.montantTtc || 0)) * 100) / 100;
    if (caSansNouvelles[m] === 0) delete caSansNouvelles[m];
  }
  expect(caSansNouvelles, `${nom} : CA d'un mois change`).toEqual(avant.ca);
  return { nouvelles: nouvelles.length };
}

test("demarrage : la migration fige les montants ; le CA de chaque mois est celui de l'ancien calcul ; la rejouer ne change rien", async () => {
  test.setTimeout(180000);
  await baseNeuve();
  const attendu = caAncienParMois(brut);
  const premier = await instantane();
  const figees = premier.commandes.filter(o => o.montantTtc !== undefined);
  console.log(`[migration${BASE_EXTERNE ? " base externe" : ""}] ${figees.length} commande(s) figee(s) sur ${premier.commandes.length} ; `
    + `${Object.keys(attendu).length} mois ; ventes ${premier.ventes.length} ; fiches ${premier.clients.length}`);
  expect(figees.length, "aucune commande figee : la migration n'a pas tourne").toBeGreaterThan(0);
  const vides = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== 0));
  expect(premier.ca, "la migration a change le CA d'un mois").toEqual(vides(attendu));
  expect(premier.clients.length).toBe(brut.clients.length);

  // Redemarrer sur la MEME base : la migration ne refait rien.
  await lancer();
  const second = await instantane();
  expect(second.commandes.map(o => [o.id, o.montantTtc ?? null])).toEqual(premier.commandes.map(o => [o.id, o.montantTtc ?? null]));
  expect(second.ca).toEqual(premier.ca);
});

for (const [nom, choisir] of [
  ["COMPLET (toutes les ventes de la base)", ventes => ventes],
  ["PARTIEL (le mois le plus vendu)", ventes => {
    const parMois = new Map();
    for (const v of ventes) parMois.set(String(v.dateCommandeIso).slice(0, 7), (parMois.get(String(v.dateCommandeIso).slice(0, 7)) || 0) + 1);
    const mois = [...parMois].sort((a, b) => b[1] - a[1])[0][0];
    return ventes.filter(v => String(v.dateCommandeIso).startsWith(mois));
  }],
  ["VIDE (l'en-tete seul)", () => []]
]) {
  test(`import ${nom} : rien ne disparait, aucun champ CRM ne change, le CA des mois ne bouge pas`, async () => {
    test.setTimeout(180000);
    await baseNeuve();
    const avant = await instantane();
    const lignes = choisir(avant.ventes);
    const r = await importer(lignes);
    expect(r.status, r.body?.error).toBe(200);
    const apres = await instantane();
    const { nouvelles } = verifierRienPerdu(avant, apres, { nom });
    console.log(`[${nom}] ${lignes.length} ligne(s) ; fiches ${JSON.stringify(r.body.clientsImport)} ; commandes : ${r.body.created} creee(s), `
      + `${r.body.updated} mise(s) a jour, ${r.body.ignored} ignoree(s), ${r.body.skippedIdentical} identique(s) ; ${nouvelles} nouvelle(s) ; `
      + `ventes ${avant.ventes.length} -> ${apres.ventes.length} ; erreurs ${r.body.lignesIllisibles}`);
    expect(r.body.clientsImport.preserved + r.body.clientsImport.updated, "des fiches ne sont pas comptees").toBe(avant.clients.length);
    // Les fiches archivees restent archivees ; l'abonnement du prospect se suspend.
    expect(apres.clients.filter(c => c.crmArchived).map(c => c.id).sort()).toEqual(avant.clients.filter(c => c.crmArchived).map(c => c.id).sort());
    if (avant.abonnements.length) {
      const pause = await fetch(`${srv.base}/api/subscriptions/${avant.abonnements[0].id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paused" })
      });
      expect(pause.status, "l'abonnement d'une fiche absente du fichier ne se suspend plus").toBe(200);
    }
  });
}

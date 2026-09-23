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

// --- Serveur de calcul routier (OSRM) ----------------------------------------
//
// Ce bloc est place APRES le geocodeur, qui garde son texte de main : le lot 3
// (fix/adresses-justes) le reecrit, et deux reecritures des memes lignes ne se
// fusionnent qu'a la main (revue du 23/09).
const INDISPONIBLE =
  "Le service de calcul routier ou de recherche d’adresse est indisponible. Réessaie dans un instant.";
// Un appel HTTP qui distingue « pas de reponse » (reseau, delai, 5xx : un
// autre serveur peut repondre) de « le serveur a refuse » (4xx : la meme
// requete serait refusee ailleurs).
async function lire(url) {
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Sereo/1.0 delivery-planner" },
    });
  } catch (cause) {
    throw Object.assign(new Error(cause?.name || "reseau"), { panne: true });
  }
  if (!response.ok)
    throw Object.assign(new Error(`HTTP ${response.status}`), {
      statut: response.status,
      panne: response.status >= 500 || response.status === 429,
    });
  try {
    return await response.json();
  } catch {
    throw Object.assign(new Error("reponse illisible"), { panne: true });
  }
}

// SEREO_ROUTING_URL designe NOTRE serveur (une adresse locale comme
// http://127.0.0.1:5000 se branche telle quelle). S'il ne repond pas -- reseau,
// delai, 5xx --, le calcul part sur le serveur public de demonstration, et le
// journal le dit : les coordonnees du jour sortent alors chez ce tiers.
// SEREO_ROUTING_REPLI_URL change ce repli ; vide, il n'y a pas de repli.
// Un refus (4xx) ne bascule pas : la meme requete serait refusee ailleurs.
// Apres une panne, le serveur principal n'est plus essaye pendant 60 s : sans
// cela, chaque calcul paierait deux fois le delai de 10 s avant le repli.
const OSRM_PUBLIC = "https://router.project-osrm.org";
const PAUSE_APRES_PANNE_MS = 60000;
let panne = { url: "", jusqua: 0 };
const sansBarreFinale = (url) => String(url).trim().replace(/\/+$/, "");
function serveursRoutiers() {
  const principal = sansBarreFinale(process.env.SEREO_ROUTING_URL || OSRM_PUBLIC);
  const brut = process.env.SEREO_ROUTING_REPLI_URL;
  const repli = sansBarreFinale(brut === undefined ? OSRM_PUBLIC : brut);
  return { principal, repli: repli && repli !== principal ? repli : "" };
}
// Le journal ne doit pas recopier un identifiant glisse dans l'URL.
function origine(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "(adresse illisible)";
  }
}
function traduire(erreur) {
  if (erreur.statut >= 400 && erreur.statut < 500 && !erreur.panne)
    return fail(
      "Le calcul routier refuse une des positions. Vérifie les coordonnées des clients de la tournée.",
    );
  return fail(INDISPONIBLE);
}
async function osrm(chemin) {
  const { principal, repli } = serveursRoutiers();
  const local = await osrmLocal(chemin, principal);
  if (local) return local.reponse;
  const enPause = repli && panne.url === principal && Date.now() < panne.jusqua;
  if (!enPause) {
    try {
      return await lire(principal + chemin);
    } catch (erreur) {
      if (!repli || !erreur.panne) throw traduire(erreur);
      panne = { url: principal, jusqua: Date.now() + PAUSE_APRES_PANNE_MS };
      console.warn(
        `[routage] Le serveur OSRM ${origine(principal)} ne répond pas (${erreur.message}) : ` +
          `repli sur ${origine(repli)} pendant ${PAUSE_APRES_PANNE_MS / 1000} s. ` +
          "Les coordonnées de la tournée partent chez ce tiers.",
      );
    }
  }
  try {
    return await lire(repli + chemin);
  } catch (erreur) {
    throw traduire(erreur);
  }
}
function _reinitialiserRepli() {
  panne = { url: "", jusqua: 0 };
  pauseLocale = 0;
}

// --- Carte locale (OSRM integre a l'image, lib/osrm-local.js) ----------------
//
// Quand le gestionnaire a une carte prete, elle passe AVANT la chaine du lot 7
// (SEREO_ROUTING_URL, puis son repli), qui reste le repli. Differences avec le
// serveur principal : un refus (4xx) de la carte locale bascule aussi, car la
// carte ne couvre qu'une zone -- osrm-routed y est lance avec un rayon
// maximal, et un point hors zone rend « NoSegment » (400), que le serveur
// suivant, lui, sait calculer. Une panne (reseau, delai, 5xx) met la carte
// locale en pause 60 s, comme le principal.
let serveurLocal = () => "";
let pauseLocale = 0;
function definirServeurLocal(fournisseur) {
  serveurLocal = typeof fournisseur === "function" ? fournisseur : () => "";
}
async function osrmLocal(chemin, principal) {
  let local = "";
  try {
    local = sansBarreFinale(serveurLocal() || "");
  } catch {
    local = "";
  }
  if (!local || local === principal || Date.now() < pauseLocale) return null;
  try {
    return { reponse: await lire(local + chemin) };
  } catch (erreur) {
    if (erreur.panne) pauseLocale = Date.now() + PAUSE_APRES_PANNE_MS;
    console.warn(
      `[routage] La carte locale ${erreur.panne ? "ne répond pas" : "ne couvre pas un des points"} (${erreur.message}) : ` +
        `calcul sur ${origine(principal)}.`,
    );
    return null;
  }
}

// --- Ordre des arrets --------------------------------------------------------
//
// Noeuds : 0 = depart, 1..count = arrets, count + 1 = arrivee. La matrice est
// DIRIGEE (sens uniques, pentes) : matrix[a][b] n'est pas matrix[b][a].
//
// cheminOptimal() ordonne des noeuds entre un depart et une arrivee fixes :
// 1. Plus proche voisin.
// 2. Descente : 2-opt (inverser un morceau) puis Or-opt (deplacer un arret ou
//    un bloc de 2 ou 3, dans un sens ou dans l'autre), jusqu'a ce que plus
//    rien n'ameliore. Le 2-opt seul s'arretait a 10-16 % de l'optimum dans
//    les pires cas mesures (audit geo du 23/09) : il ne sait pas DEPLACER un
//    arret, seulement retourner un morceau.
// 3. Perturbations (« double pont ») : on bouscule le meilleur ordre, on
//    redescend, on garde si c'est mieux. Nombre d'essais FIXE et tirage a
//    graine fixe, jamais un budget en millisecondes : le meme appel rend le
//    meme ordre sur toutes les machines.
const EPS = 1e-6;
function cheminOptimal(m, depart, noeuds, arrivee, essaisVoulus) {
  if (noeuds.length <= 1) return noeuds.slice();
  const cout = (o) => {
    let s = 0;
    for (let k = 1; k < o.length; k++) s += m[o[k - 1]][o[k]];
    return s;
  };

  // 1. Plus proche voisin (a egalite, le premier de la liste : deterministe).
  const restants = noeuds.slice();
  let ordre = [depart];
  while (restants.length) {
    const dernier = ordre[ordre.length - 1];
    let choix = 0;
    for (let k = 1; k < restants.length; k++)
      if (m[dernier][restants[k]] < m[dernier][restants[choix]]) choix = k;
    ordre.push(restants.splice(choix, 1)[0]);
  }
  ordre.push(arrivee);

  // 2-opt : inverser o[i..j]. Cout dirige : l'interieur du morceau change de
  // sens, d'ou les sommes cumulees dans les deux sens (delta en O(1)).
  function deuxOpt(o) {
    const n = o.length;
    const av = new Float64Array(n),
      ar = new Float64Array(n);
    for (let encore = true; encore && mouvements++ < plafond; ) {
      encore = false;
      for (let k = 1; k < n; k++) {
        av[k] = av[k - 1] + m[o[k - 1]][o[k]];
        ar[k] = ar[k - 1] + m[o[k]][o[k - 1]];
      }
      balayage: for (let i = 1; i < n - 2; i++)
        for (let j = i + 1; j < n - 1; j++) {
          const delta =
            m[o[i - 1]][o[j]] +
            m[o[i]][o[j + 1]] +
            (ar[j] - ar[i]) -
            m[o[i - 1]][o[i]] -
            m[o[j]][o[j + 1]] -
            (av[j] - av[i]);
          if (delta < -EPS) {
            for (let a = i, b = j; a < b; a++, b--) [o[a], o[b]] = [o[b], o[a]];
            encore = true;
            break balayage;
          }
        }
    }
  }

  // Or-opt : deplacer o[a..b] (1 a 3 arrets) entre deux autres noeuds, dans
  // son sens ou retourne. S'arrete au premier deplacement qui ameliore.
  function orOpt(o) {
    const n = o.length;
    for (let L = 1; L <= 3; L++)
      for (let a = 1; a + L - 1 <= n - 2; a++) {
        const b = a + L - 1;
        const p = o[a - 1],
          s = o[b + 1],
          f = o[a],
          l = o[b];
        let interne = 0,
          inverse = 0;
        for (let t = a; t < b; t++) {
          interne += m[o[t]][o[t + 1]];
          inverse += m[o[t + 1]][o[t]];
        }
        const retrait = m[p][s] - m[p][f] - m[l][s];
        for (let k = 0; k < n - 1; k++) {
          if (k >= a - 1 && k <= b) continue;
          const x = o[k],
            y = o[k + 1];
          const droit = retrait + m[x][f] + m[l][y] - m[x][y];
          const retourne =
            L > 1
              ? retrait + m[x][l] + m[f][y] - m[x][y] + (inverse - interne)
              : Infinity;
          if (Math.min(droit, retourne) < -EPS) {
            const bloc = o.slice(a, b + 1);
            if (retourne < droit) bloc.reverse();
            const reste = [...o.slice(0, a), ...o.slice(b + 1)];
            reste.splice(k < a ? k + 1 : k + 1 - L, 0, ...bloc);
            o.splice(0, o.length, ...reste);
            return true;
          }
        }
      }
    return false;
  }

  // Chaque mouvement gagne plus que EPS : la descente finit. Le plafond ne sert
  // que si une matrice aberrante (valeurs geantes, arrondis) faisait croire a
  // des gains qui n'existent pas : mieux vaut un ordre moyen qu'un serveur fige.
  let mouvements = 0;
  const plafond = 50 * (noeuds.length + 2) ** 2;
  function descente(o) {
    while (mouvements++ < plafond) {
      deuxOpt(o);
      if (!orOpt(o)) return o;
    }
    return o;
  }

  descente(ordre);
  let meilleur = cout(ordre);

  // 3. Double pont sur les arrets : A B C D -> A C B D (utile des 8 arrets).
  const taille = noeuds.length;
  let graine = (taille * 2654435761) >>> 0 || 1;
  const hasard = (borne) => {
    graine = (Math.imul(graine, 1664525) + 1013904223) >>> 0;
    return Math.floor((graine / 4294967296) * borne);
  };
  const essais = taille < 8 ? 0 : (essaisVoulus ?? Math.min(60, 4 * taille));
  for (let e = 0; e < essais; e++) {
    const coupes = [hasard(taille - 1) + 1, hasard(taille - 1) + 1, hasard(taille - 1) + 1].sort(
      (u, v) => u - v,
    );
    if (coupes[0] === coupes[1] || coupes[1] === coupes[2]) continue;
    const [c1, c2, c3] = coupes;
    const essai = [
      ...ordre.slice(0, c1),
      ...ordre.slice(c2, c3),
      ...ordre.slice(c1, c2),
      ...ordre.slice(c3),
    ];
    descente(essai);
    const valeur = cout(essai);
    if (valeur < meilleur - EPS) {
      ordre = essai;
      meilleur = valeur;
    }
  }
  return ordre.slice(1, -1);
}

// `options.premiers` : indices (0..count-1) des arrets « a livrer en premier ».
// Ils passent avant tous les autres ; leur ordre ENTRE EUX, et celui du reste,
// sont optimises. Le reste part du DERNIER epingle : on essaie chacun comme
// dernier (les 6 plus proches du reste s'il y en a plus), la tete est le
// meilleur chemin du depart a lui par les autres epingles, la queue le
// meilleur chemin de lui a l'arrivee par les arrets libres. Optimiser les deux
// groupes d'un seul tenant, en interdisant les mouvements qui les melangent,
// restait coince jusqu'a 20 % de l'optimum sous contrainte (mesure du banc).
// `options.essais` : nombre de perturbations (reglage du banc).
function optimizeMatrix(matrix, count, options = {}) {
  if (!(count > 0)) return [];
  const m = matrix;
  const fin = count + 1;
  const tous = Array.from({ length: count }, (_, i) => i + 1);
  const epingles = new Set();
  for (const i of options.premiers || [])
    if (Number.isInteger(i) && i >= 0 && i < count) epingles.add(i + 1);
  const premiers = tous.filter((k) => epingles.has(k));
  const autres = tous.filter((k) => !epingles.has(k));
  const essais = options.essais;
  if (!premiers.length || !autres.length)
    return cheminOptimal(m, 0, tous, fin, essais).map((i) => i - 1);

  const proximite = (p) => Math.min(...autres.map((r) => m[p][r]));
  const candidats =
    premiers.length <= 6
      ? premiers
      : [...premiers].sort((a, b) => proximite(a) - proximite(b) || a - b).slice(0, 6);
  let meilleur = null,
    meilleurCout = Infinity;
  for (const dernier of candidats) {
    const tete = [
      ...cheminOptimal(m, 0, premiers.filter((p) => p !== dernier), dernier, essais),
      dernier,
    ];
    const queue = cheminOptimal(m, dernier, autres, fin, essais);
    const ordre = [0, ...tete, ...queue, fin];
    let total = 0;
    for (let k = 1; k < ordre.length; k++) total += m[ordre[k - 1]][ordre[k]];
    if (total < meilleurCout - EPS) {
      meilleur = [...tete, ...queue];
      meilleurCout = total;
    }
  }
  return meilleur.map((i) => i - 1);
}

// Qui est injoignable par la route ? OSRM rend `null` pour une paire qu'il ne
// relie pas. Un seul point isole (ile, chemin prive, mauvais geocodage) met
// des null sur toute sa ligne et toute sa colonne : on retire, tant qu'il en
// reste, le noeud qui en porte le plus. Rend les indices de noeuds retires.
function injoignables(durations) {
  const n = durations.length;
  const actifs = new Set(Array.from({ length: n }, (_, i) => i));
  const trou = (i, j) => i !== j && !Number.isFinite(durations[i]?.[j]);
  const retires = [];
  for (;;) {
    let pire = -1,
      pireCompte = 0;
    for (const i of actifs) {
      let compte = 0;
      for (const j of actifs) if (trou(i, j) || trou(j, i)) compte++;
      // A egalite, un arret plutot que le depart ou l'arrivee : un depart
      // coupe d'un seul arret n'est pas un depart injoignable.
      const extremite = i === 0 || i === n - 1;
      const pireExtremite = pire === 0 || pire === n - 1;
      if (compte > pireCompte || (compte === pireCompte && compte > 0 && pireExtremite && !extremite)) {
        pire = i;
        pireCompte = compte;
      }
    }
    if (pire < 0) return retires;
    retires.push(pire);
    actifs.delete(pire);
  }
}

// --- Decoupage au-dela de 50 commandes ----------------------------------------
//
// Balayage angulaire autour du depart : les commandes sont rangees par
// direction, et le tour commence a la plus grande trouee angulaire, pour ne
// pas couper une ville en deux. Puis des paquets consecutifs de tailles
// equilibrees, chacun <= max. Les commandes sans coordonnees vont a la fin.
// `premiers` : ids des commandes « a livrer en premier ». Elles partent dans la
// PREMIERE tournee (revue du 23/09 : le balayage les laissait dans la tournee
// de leur direction, creee plus tard) ; voir placerLesPremiers().
function decouperEnTournees(points, depart, max = 50, premiers = []) {
  const liste = Array.isArray(points) ? points : [];
  if (liste.length <= max) return [liste.slice()];
  const centre = coordinates(depart);
  const avec = [],
    sans = [];
  for (const p of liste) (coordinates(p) && centre ? avec : sans).push(p);
  const angle = (p) => {
    const c = coordinates(p);
    const x = (c.lng - centre.lng) * Math.cos((centre.lat * Math.PI) / 180);
    return Math.atan2(c.lat - centre.lat, x);
  };
  const tries = avec
    .map((p, i) => ({ p, a: angle(p), i }))
    .sort((u, v) => u.a - v.a || u.i - v.i);
  let depuis = 0;
  if (tries.length > 1) {
    let trou = -1;
    tries.forEach((t, i) => {
      const suivant = tries[(i + 1) % tries.length];
      const ecart = i === tries.length - 1 ? suivant.a + 2 * Math.PI - t.a : suivant.a - t.a;
      if (ecart > trou) {
        trou = ecart;
        depuis = (i + 1) % tries.length;
      }
    });
  }
  const suite = [...tries.slice(depuis), ...tries.slice(0, depuis)].map((t) => t.p).concat(sans);
  const nombre = Math.ceil(suite.length / max);
  const paquets = [];
  let debut = 0;
  for (let k = 0; k < nombre; k++) {
    const taille = Math.floor(suite.length / nombre) + (k < suite.length % nombre ? 1 : 0);
    paquets.push(suite.slice(debut, debut + taille));
    debut += taille;
  }
  return placerLesPremiers(paquets, premiers);
}

// La tournee qui part d'abord est celle qui porte le plus d'epingles (on
// tourne la liste : l'ordre des directions est garde). Chaque epingle restee
// ailleurs y prend la place de la derniere commande sans epingle de la
// premiere tournee, qui passe en tete de celle qu'elle quitte : les tailles
// ne bougent pas. Plus d'epingles que de places : le surplus reste ou il est.
function placerLesPremiers(paquets, premiers) {
  const ids = new Set((Array.isArray(premiers) ? premiers : []).map(String));
  if (!ids.size || paquets.length < 2) return paquets;
  const epingle = (p) => ids.has(String(p?.id));
  const compte = (paquet) => paquet.filter(epingle).length;
  let tete = 0;
  paquets.forEach((paquet, k) => {
    if (compte(paquet) > compte(paquets[tete])) tete = k;
  });
  const tournes = [...paquets.slice(tete), ...paquets.slice(0, tete)].map((paquet) => paquet.slice());
  const premiere = tournes[0];
  for (const paquet of tournes.slice(1))
    for (let i = 0; i < paquet.length; i++) {
      if (!epingle(paquet[i])) continue;
      let libre = premiere.length - 1;
      while (libre >= 0 && epingle(premiere[libre])) libre--;
      if (libre < 0) return tournes;
      const [cede] = premiere.splice(libre, 1, paquet[i]);
      paquet.splice(i, 1);
      paquet.unshift(cede);
    }
  return tournes;
}

const nommer = (liste) =>
  liste.length > 1
    ? `${liste.slice(0, -1).join(", ")} et ${liste.at(-1)}`
    : liste[0] || "";

async function roadPlan(
  orders,
  start,
  end,
  stopMinutes = 6,
  fixedOrder = false,
  options = {},
) {
  const { geocoder = null } = options;
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
  const coords = (list) => list.map((p) => `${p.lng},${p.lat}`).join(";");
  let retenus = resolved;
  let ordered = resolved;
  const retires = [];
  if (!fixedOrder && resolved.length > 1) {
    const table = await osrm(
      `/table/v1/driving/${coords(all)}?annotations=duration`,
    );
    if (
      table.code !== "Ok" ||
      table.durations?.length !== all.length ||
      table.durations.some((row) => row?.length !== all.length)
    )
      throw fail("Impossible de calculer le trajet routier.");
    const isoles = injoignables(table.durations);
    if (isoles.includes(0))
      throw fail(
        "Le point de départ est injoignable par la route. Choisis un autre départ.",
      );
    if (isoles.includes(all.length - 1))
      throw fail(
        "Le point d’arrivée est injoignable par la route. Choisis une autre arrivée.",
      );
    if (isoles.length) {
      const fautifs = isoles.sort((a, b) => a - b).map((i) => resolved[i - 1]);
      const noms = nommer(fautifs.map((o) => o.clientName || "Client"));
      // Le detail va sous `details`, comme au lot 3 (fix/adresses-justes) ;
      // fail() garde son texte de main, que le lot 3 reecrit.
      if (!options.retirerInjoignables || fautifs.length === resolved.length)
        throw Object.assign(
          fail(
            `${noms} : injoignable par la route. Vérifie l’adresse, ou retire la commande de la tournée.`,
          ),
          {
            details: {
              injoignables: fautifs.map((o) => ({
                id: o.id,
                clientName: o.clientName,
              })),
            },
          },
        );
      retires.push(...fautifs);
    }
    const gardes = all
      .map((_, i) => i)
      .filter((i) => !isoles.includes(i));
    const matrice = gardes.map((i) => gardes.map((j) => table.durations[i][j]));
    retenus = gardes.slice(1, -1).map((i) => resolved[i - 1]);
    const premiers = retenus
      .map((o, i) => (o.livrerEnPremier ? i : -1))
      .filter((i) => i >= 0);
    ordered = optimizeMatrix(matrice, retenus.length, { premiers }).map(
      (i) => retenus[i],
    );
  }
  const result = await osrm(
    `/route/v1/driving/${coords([departure, ...ordered, arrival])}?overview=full&geometries=geojson&steps=false`,
  );
  const route = result.routes?.[0];
  if (
    result.code !== "Ok" ||
    !route?.geometry?.coordinates ||
    !Number.isFinite(route.distance) ||
    !Number.isFinite(route.duration)
  )
    throw fail("Impossible de calculer le trajet routier.");
  // Un troncon par trajet : depart -> 1er arret, ..., dernier -> arrivee. Les
  // heures d'arrivee par arret en decoulent ; OSRM les donnait, on les jetait.
  const legs = Array.isArray(route.legs) ? route.legs : [];
  const troncons =
    legs.length === ordered.length + 1 &&
    legs.every((l) => Number.isFinite(l?.duration) && Number.isFinite(l?.distance))
      ? legs.map((l) => ({
          duree: Math.round(l.duration),
          distance: Math.round(l.distance),
        }))
      : null;
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
    troncons,
    ...(retires.length
      ? {
          injoignablesRetires: retires.map((o) => ({
            id: o.id,
            clientName: o.clientName,
          })),
        }
      : {}),
    calculatedAt: new Date().toISOString(),
  };
}
module.exports = {
  coordinates,
  optimizeMatrix,
  injoignables,
  roadPlan,
  decouperEnTournees,
  resoudrePositions,
  definirServeurLocal,
  _reinitialiserRepli,
};

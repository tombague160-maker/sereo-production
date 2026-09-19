// Inventaire des onglets et libelles d'en-tete.
//
// mainTabs fait autorite sur ce qui est un onglet valide : le routage par hash
// s'y refere pour rejeter une ancre inconnue. MOBILE_OVERFLOW_TABS liste ce qui
// bascule dans le menu "Plus" sur mobile, la barre basse ne tenant que 4 items.

export const mainTabs = new Set(["abonnements", "journee", "stock", "crm", "commande-client", "commandes-jour", "commandes-planifiees", "relances", "statistiques", "exports", "preparation", "bons-commande", "livreur", "recommande", "commandes-livrees", "parametres"]);

// Tabs accessibles uniquement via le menu "Plus" de la mobile-tabbar (overflow
// car > 5 destinations). Quand l'utilisateur navigue vers l'une d'elles, le
// bouton "Plus" recoit la classe `.active` pour montrer visuellement qu'on est
// dans ce groupe.
// Les DESTINATIONS de la barre basse, tranchees par Tom le 17/09 :
//   Tableau de bord · Preparation · Tournee · Abonnements   (+ "Plus")
//
// Cette liste est le COMPLEMENT de celle-la, et rien d'autre. La tenir a la
// main invitait a la desynchroniser : "abonnements" y figurait alors qu'il
// venait d'entrer dans la barre, et "stock" en sortait alors qu'il en etait
// parti. Elle est donc DERIVEE -- un onglet deplace dans la barre basse suit
// tout seul, et les deux ne peuvent plus dire le contraire l'une de l'autre.
export const MOBILE_MAIN_TABS = ["journee", "preparation", "livreur", "abonnements"];

export const MOBILE_OVERFLOW_TABS = new Set(
  [...mainTabs].filter(onglet => !MOBILE_MAIN_TABS.includes(onglet))
);

export const titles = {
  abonnements: {title: "Abonnements", subtitle: "Les produits de vos clients, livrés au bon rythme."},
  journee: {
    title: "Tableau de bord",
    subtitle: "Chiffre d’affaires livré, abonnements et opérations du jour."
  },
  import: {
    title: "Import du jour",
    subtitle: "Charge les dossiers et le stock depuis des fichiers .xlsx."
  },
  stock: {
    title: "Stock / Inventaire",
    subtitle: "Ajuste les quantités, contrôle les écarts et repère les produits à surveiller."
  },
  crm: {
    title: "CRM",
    subtitle: "Prospects, clients, relances et historique commercial."
  },
  "commande-client": {
    title: "Commande client",
    subtitle: "Prends une commande simple et visuelle directement chez le client."
  },
  "commandes-jour": {
    title: "Commandes du jour",
    subtitle: "Regroupe les commandes terrain et envoie-les en préparation."
  },
  "commandes-planifiees": {
    title: "Commandes planifiées",
    subtitle: "Rappels, confirmations et commandes futures."
  },
  relances: {
    title: "Rappels",
    subtitle: "Appels, visites et confirmations liées aux commandes."
  },
  statistiques: {
    title: "Statistiques",
    subtitle: "Ventes, progression, paniers moyens et meilleurs clients."
  },
  preparation: {
    title: "Préparation",
    subtitle: "Contrôle le stock, prépare les commandes et les envoie en livraison."
  },
  livreur: {
    title: "Livraison",
    subtitle: "Filtre par date et secteur, crée la tournée et suit les clients."
  },
  "bons-commande": {
    title: "Bons de commande",
    subtitle: "Tous les bons importés, triables et filtrables par statut, secteur ou date."
  },
  exports: {
    title: "Exports",
    subtitle: "Télécharge les commandes au format Excel."
  },
  recommande: {
    title: "À recommander",
    subtitle: "Produits en rupture ou proches de la rupture."
  },
  "commandes-livrees": {
    title: "Commandes livrées",
    subtitle: "Historique des livraisons effectuées et des ventes importées comme déjà livrées."
  },
  produits: {
    title: "Produits",
    subtitle: "Catalogue importé depuis le fichier stock."
  },
  ventes: {
    title: "Ventes",
    subtitle: "Détail des lignes importées pour la tournée."
  },
  alertes: {
    title: "Alertes internes",
    subtitle: "Stock, commandes bloquées et livraisons à traiter."
  },
  historique: {
    title: "Historique",
    subtitle: "Journal local des dernières actions."
  },
  parametres: {
    title: "Paramètres",
    subtitle: "Logo, thème, secteurs et base mobile de l'application."
  }
};

// Les HUIT entrees de la barre laterale, et les ecrans que chacune absorbe.
//
// La planche « Barre laterale » de l'export n'a que huit lignes, sans rien de
// repliable. L'application en avait seize reparties en six groupes qui se
// depliaient. Les seize ecrans existent toujours : ceux qu'une entree absorbe
// se rejoignent par la rangee de pilules sous le titre de page.
//
// L'ordre des cles est l'ordre d'affichage ; le PREMIER onglet d'un groupe est
// celui que l'entree ouvre.
export const GROUPES_NAV = {
  journee: ["journee"],
  commandes: ["commandes-jour", "commande-client", "commandes-planifiees", "bons-commande", "commandes-livrees"],
  preparation: ["preparation"],
  tournee: ["livreur"],
  abonnements: ["abonnements"],
  stock: ["stock", "recommande"],
  clients: ["crm", "relances"],
  analyse: ["statistiques", "exports"]
};

// « parametres » n'appartient a aucun groupe : la planche le sort de la liste
// et le confie a l'engrenage du bloc compte. Il reste un onglet valide.
export const ONGLETS_HORS_NAV = new Set(["parametres"]);

// Deux inventaires qui se contredisent en silence, c'est la panne qu'on ne
// voit qu'a l'usage : un ecran sans chemin, ou une entree qui ouvre du vide.
// La verification est donc faite au CHARGEMENT du module, pas dans un banc.
const ongletsGroupes = Object.values(GROUPES_NAV).flat();
const attendus = [...mainTabs].filter(onglet => !ONGLETS_HORS_NAV.has(onglet));
const orphelins = attendus.filter(onglet => !ongletsGroupes.includes(onglet));
const inconnus = ongletsGroupes.filter(onglet => !mainTabs.has(onglet));
if (orphelins.length || inconnus.length) {
  throw new Error(
    `GROUPES_NAV incoherent -- sans entree : [${orphelins}] ; hors mainTabs : [${inconnus}]`
  );
}

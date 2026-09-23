# Tableau de bord, abonnements et tournées

## Tableau de bord

- CA et panier moyen : **commandes livrées uniquement**, par mois sélectionné.
- Les nouvelles livraisons conservent leur date réelle (`deliveredAt`). Les anciennes commandes sans cette date utilisent leur date de livraison prévue, puis leur date de commande. Le tableau de bord signale cette approximation et les commandes sans montant.
- Les montants sont ceux enregistrés/importés dans l’application. Ce tableau n’est pas une comptabilité de factures acquittées ; le mélange historique HT/TTC doit être corrigé à la source.
- Mise à jour après les actions, au clic sur Actualiser et toutes les 60 secondes lorsque l’accueil est visible. Aucun mécanisme de push serveur.
- Les nouvelles API de pilotage et d’abonnements ne sont pas servies depuis un cache hors ligne.

## Abonnements

Ouvrir **Commandes → Abonnements**, puis **Nouvel abonnement**. Sélectionner un client (ou créer sa fiche), les produits du catalogue, les quantités, la première livraison, la fréquence et le délai du rappel.

Fréquences : 7, 10, 14, 15, 21, 28 jours, mensuelle ou nombre de jours personnalisé. Un jeudi toutes les deux semaines utilise 14 jours. Un intervalle de 15 jours décale le jour de la semaine. Le mensuel garde la date d’origine : 31 janvier → 28 février → 31 mars, sans dérive.

Le calendrier couvre les 90 prochains jours. Les rappels en retard restent visibles tant que l’échéance n’a pas été traitée. Une commande livrée ou annulée clôt son échéance. Les rappels sont visibles dans l’application : pas de SMS, d’email ou de notification lorsque l’application est fermée.

**Créer la commande** crée une commande planifiée et son rappel CRM. Confirmer cette commande depuis **Commandes planifiées** pour la faire entrer en préparation. La création est idempotente : plusieurs clics, même simultanés, renvoient la même commande. Créer l’abonnement ou une échéance future ne réserve pas immédiatement tout le stock.

Modifier ou mettre en pause agit sur les échéances de l’abonnement. Les commandes déjà créées restent à gérer dans le circuit existant. Pour reprendre après une longue pause sans rattrapage, modifier la première date au redémarrage. Les produits/prix d’une commande déjà créée ne sont pas réécrits par une modification d’abonnement.

Les abonnements sont stockés dans la table SQLite `abonnements`, intégrée aux snapshots et aux sauvegardes existantes. La migration ajoute cette table sans supprimer les données. Une fiche avec abonnement non arrêté ne peut pas être archivée. La purge globale des commandes/clients est refusée en présence d’abonnements pour éviter de perdre leur historique et recréer des échéances déjà traitées.

## Livraison

1. Choisir le départ : **Me localiser** ou rechercher une adresse/ville, puis confirmer le résultat.
2. Choisir l’arrivée de la même manière, ou cocher **Retour au point de départ**.
3. Sélectionner les commandes prêtes et créer la tournée. Sous chaque commande choisie, **À livrer en premier** la place en tête de tournée (plusieurs possibles : l’ordre entre elles est optimisé aussi). Au-delà de 50 commandes, l’écran propose de les répartir en plusieurs tournées, par direction depuis le départ : il crée la première (celle des commandes « À livrer en premier ») et garde les autres sélectionnées pour la suivante. Ce découpage demande le réseau.
4. Démarrer. Chaque validation Livré/Absent passe à l’arrêt suivant. Google Maps ouvre la navigation vers le client. Après le dernier arrêt, un lien permet de rejoindre l’arrivée.

Le serveur utilise le géocodage IGN pour les adresses sans coordonnées, puis OSRM pour les temps routiers et le tracé. Les noms, téléphones et produits ne sont pas transmis : le géocodeur reçoit les adresses, le moteur routier reçoit les coordonnées. Une adresse trop incertaine bloque le calcul avec une demande de correction.

L’ordre part du client le plus proche en temps routier puis est amélioré en tenant compte de l’arrivée fixe : inversion de morceaux (2-opt), déplacement d’un arrêt ou d’un bloc de 2-3 (Or-opt), et quelques perturbations à graine fixe. C’est une heuristique : aucune garantie du minimum mathématique absolu (sur 750 tournées réalistes de 5 à 9 arrêts, écart médian 0 %, pire 1,7 % ; `test/meilleur-trajet.test.js`), pas de trafic en temps réel ni de contraintes horaires. Limite : 50 commandes par tournée. Une même adresse avec plusieurs commandes peut apparaître plusieurs fois.

Un arrêt injoignable par la route (île, chemin privé, mauvaise position) est nommé. Depuis l’écran, il est retiré de la tournée et signalé ; sa commande reste prête à livrer. La tournée garde la durée et la distance de chaque trajet (`troncons`), pour les heures d’arrivée.

Une tournée créée sans départ (par l’API) suit le plus court chemin entre les arrêts, à vol d’oiseau ; 50 commandes au plus, comme avec un départ.

Une tournée manuellement réordonnée perd son ancien tracé ; **Recalculer le tracé** le reconstruit en conservant cet ordre. Le démarrage recalcule automatiquement si le tracé a été invalidé. Une tournée démarrée ne remet jamais ses arrêts déjà traités à zéro.

### Dépendances externes et exploitation

- Géocodage : un seul module, `lib/geocodage.js`, pour l’import, le lot de fond, la tournée et la recherche d’adresse. Base Adresse Nationale, `SEREO_GEOCODER_URL`, par défaut `https://api-adresse.data.gouv.fr/search/` (Licence Ouverte 2.0, source citée à l’écran). Résultats gardés dans la table `geocodages` ; un rejet est redemandé après 30 jours. Avant le 23/09, la tournée interrogeait `data.geopf.fr` avec un autre seuil et sans cache.
- Itinéraire : `SEREO_ROUTING_URL`, par défaut `https://router.project-osrm.org` ([documentation OSRM](https://project-osrm.org/docs/v5.22.0/api/)). Le serveur public ne fournit pas de garantie de disponibilité. Prévoir un service dédié avant un usage intensif : une adresse locale (`http://127.0.0.1:5000`) se branche telle quelle. Si le serveur configuré ne répond pas (réseau, délai, erreur 5xx), le calcul part sur le serveur public, pendant 60 s, et le journal le signale : les coordonnées de la tournée sortent alors chez ce tiers. `SEREO_ROUTING_REPLI_URL` change ce repli ; vide, il n’y a pas de repli.
- Localisation : HTTPS en production et autorisation de l’utilisateur dans le navigateur. Le header `Permissions-Policy` autorise désormais `geolocation=(self)`.
- Si un service échoue, aucune tournée partielle n’est enregistrée. Les anciennes tournées sans calcul routier sont explicitement signalées comme tracés à recalculer.

## Vérification

`npm run check`, `npm test`, `npm run test:e2e`.

Les tests couvrent : persistance SQLite, calendrier mensuel/bissextile, intervalles et changement d’heure, doublons concurrents, pause/reprise, CA livré mensuel, ordre routier et arrivée fixe, erreur de calcul, redémarrage de tournée, navigation de tous les onglets, formulaires avec produits, mobile et refus de géolocalisation. Les tests utilisent des bases temporaires et des données fictives.

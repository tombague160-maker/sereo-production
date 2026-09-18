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
3. Sélectionner les commandes prêtes et créer la tournée.
4. Démarrer. Chaque validation Livré/Absent passe à l’arrêt suivant. Google Maps ouvre la navigation vers le client. Après le dernier arrêt, un lien permet de rejoindre l’arrivée.

Le serveur utilise le géocodage IGN pour les adresses sans coordonnées, puis OSRM pour les temps routiers et le tracé. Les noms, téléphones et produits ne sont pas transmis : le géocodeur reçoit les adresses, le moteur routier reçoit les coordonnées. Une adresse trop incertaine bloque le calcul avec une demande de correction.

L’ordre part du client le plus proche en temps routier puis est amélioré en tenant compte de l’arrivée fixe. C’est une heuristique : aucune garantie du minimum mathématique absolu, pas de trafic en temps réel ni de contraintes horaires. Limite : 50 commandes par tournée. Une même adresse avec plusieurs commandes peut apparaître plusieurs fois.

Une tournée manuellement réordonnée perd son ancien tracé ; **Recalculer le tracé** le reconstruit en conservant cet ordre. Le démarrage recalcule automatiquement si le tracé a été invalidé. Une tournée démarrée ne remet jamais ses arrêts déjà traités à zéro.

### Dépendances externes et exploitation

- Géocodage : `https://data.geopf.fr/geocodage/search` ([documentation IGN](https://ignf.github.io/cartes.gouv.fr-documentation/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/)).
- Itinéraire : `SEREO_ROUTING_URL`, par défaut `https://router.project-osrm.org` ([documentation OSRM](https://project-osrm.org/docs/v5.22.0/api/)). Le serveur public ne fournit pas de garantie de disponibilité. Prévoir un service dédié avant un usage intensif.
- Localisation : HTTPS en production et autorisation de l’utilisateur dans le navigateur. Le header `Permissions-Policy` autorise désormais `geolocation=(self)`.
- Si un service échoue, aucune tournée partielle n’est enregistrée. Les anciennes tournées sans calcul routier sont explicitement signalées comme tracés à recalculer.

## Vérification

`npm run check`, `npm test`, `npm run test:e2e`.

Les tests couvrent : persistance SQLite, calendrier mensuel/bissextile, intervalles et changement d’heure, doublons concurrents, pause/reprise, CA livré mensuel, ordre routier et arrivée fixe, erreur de calcul, redémarrage de tournée, navigation de tous les onglets, formulaires avec produits, mobile et refus de géolocalisation. Les tests utilisent des bases temporaires et des données fictives.

# Brief Claude Design — Séréo V8

À coller tel quel dans un projet Claude Design, après avoir chargé les pièces
jointes listées en fin de fichier. Rédigé le 16 septembre 2026 à partir des
demandes de Tom (message vocal et réponses du 16/09), des six planches du
2 septembre et de la charte `design/DESIGN.md`.

---

## Objectif

Redessine **Séréo**, l'application interne d'une petite entreprise de livraison
de matériel médical et d'hygiène (Doubs et Jura), pour qu'elle soit **lisible
d'un coup d'œil, la plus intuitive possible, et d'un niveau premium**, en
**deux versions, claire et sombre, dans la charte vert et orange** de la marque.
Tu conçois une application, pas un site : elle s'installe sur téléphone
(PWA aujourd'hui, Android et iOS natifs demain) et s'utilise au bureau sur
grand écran.

## Public

- **Tom**, gérant-livreur. Le matin il prépare les commandes à l'entrepôt, l'après-midi il livre des EHPAD, SSIAD, cliniques et pharmacies sur trois secteurs : Besançon, Champagnole, Dole. Sur la route il a le téléphone d'une main, parfois au soleil, parfois avec des gants.
- Une petite équipe (bureau, préparateur, livreur) partage l'outil. **Tout le monde voit tout** ; seule l'administration des comptes est réservée.
- Pas de formation : l'écran doit s'expliquer seul. Tout est en français, sans anglicisme.

## Ce que fait l'application

Import des ventes depuis Excel → bons de commande (`CMD-2026-001`) → préparation par statuts (Importée · À vérifier · En préparation · Préparation terminée · Prêt livraison · En livraison · Livrée) → tournée de livraison avec carte → stock et alertes de réassort → fiches clients (CRM léger). **Nouveau** : les abonnements, c'est-à-dire des livraisons récurrentes planifiées par client.

## Ce qui existe déjà et que tu dois réutiliser

1. **Six planches validées le 2 septembre**, jointes en PNG : Cockpit livreur, Carte de tournée, Préparation, Navigation mobile, Tableau de bord desktop, Navigation desktop. Elles fixent le vocabulaire visuel : pilules pour les actions, grands rayons sur les cartes, marque « séréo » en minuscules avec son sourire orange, formes organiques en fond, **une ligne compacte par commande**, **trois gestes sous le pouce** en tournée. Pars d'elles, ne repars pas de zéro.
2. **La navigation par catégories**, que Tom aime : Accueil · Commandes · Livraison · Stock · Clients · Analyse. Sur mobile, quatre destinations en bas et le reste derrière « Plus ».
3. **La charte** dans `DESIGN.md` joint : valeurs exactes, rôles et contrastes mesurés. Résumé :
   - Principal **`#386B6D`** (vert profond) : actions, titres, navigation active. Blanc dessus = 5,95:1.
   - Accent **`#EF9177`** (orange saumon) : **jamais un fond de texte** (blanc dessus = 2,34:1). Barres de progression, halo de l'arrêt en cours, points d'état, logo.
   - Vert d'eau `#A1C4C0`, pêche `#EDC8C3`, fond `#FBF7F5`, texte secondaire `#4F7477` (5,05:1).
   - Alerte `#C02B0A`, texte et icônes seulement.
   - Sombre : fond `#0D1518`, surface `#132224`, texte `#E6F2EE`, principal `#93CBC9`, accent `#F5A08F` — points de départ à recalibrer par mesure.
   - Police **Poppins** 400/500/600/700, chiffres tabulaires, titres serrés (−0,02 em).
   - Cibles tactiles **≥ 44 px** partout, boutons 48 px sur mobile.
4. **Les logos SVG** joints (clair, sombre, monogramme).

## Principes de design à appliquer

Ils viennent du skill « apple-design » joint (fichier `SKILL.md`) ; applique-le en entier, et en particulier :

- **Simplicité, pas minimalisme** : chaque élément gagne sa place ; la hiérarchie vient de l'ordre, de l'espace et du contraste, pas des bordures.
- **Wayfinding** : chaque écran répond à *Où suis-je ? Où puis-je aller ? Comment je sors ?*
- **Libellés directs** : « Tournée », « Abonnements », « Préparation » — pas « Accueil » vague (on garde « Tableau de bord »).
- **Quatre retours** : statut, achèvement, avertissement, erreur — visibles sans lire.
- **Grouper par proximité** ; un contrôle près de ce qu'il modifie ; si un libellé doit expliquer un contrôle, le placement est mauvais.
- **Matériaux** : barres et sheets translucides, contenu qui défile dessous ; jamais deux surfaces translucides claires superposées ; opaque sous `prefers-reduced-transparency`.
- **Typographie** : interlettrage selon la taille, interligne inverse à la taille, hiérarchie = poids + taille + interligne ensemble.
- **Mouvement** : discret, interruptible, ressort amorti (pas de rebond sauf après un geste), retour immédiat au toucher, tout coupé sous `prefers-reduced-motion`.
- **Confirmer seulement l'irréversible** ; annuler doit être facile.

## Écrans à produire

Chaque écran en **quatre variantes** : mobile 390 × 844 et desktop 1440 × 900, clair et sombre. Données réalistes (secteurs Besançon / Champagnole / Dole, clients EHPAD Les Tilleuls du Val de Loue, SSIAD de la Haute Vallée, Clinique Vétérinaire ; produits changes molletonnés taille L, alèses), jamais de faux texte.

### Priorité 1

**A. Tableau de bord (Accueil)**
- Sélecteur de mois. **CA du mois = commandes livrées uniquement** (décision de Tom), avec les mois précédents en barres (6 à 12 mois) et le **panier moyen**.
- Alertes : stock bas, commandes bloquées, échéances d'abonnement en retard, adresses à corriger.
- « Cette semaine » : les livraisons d'abonnement jour par jour — *Mardi · EHPAD Les Tilleuls · 3 changes L, 2 alèses*.
- En préparation (n commandes, n produits) et En livraison (n) — chaque bloc ouvre la liste.
- Peu de chiffres, gros. Mobile : deux colonnes ; desktop : grille douze colonnes. Reprends la planche « Tableau de bord » et corrige-la si tu vois mieux.

**B. Abonnements**
- Liste : client, produits résumés, fréquence, prochaine livraison, état (actif / en pause), rappel.
- Fiche et création : client (recherche ou nouvelle fiche), produits et quantités depuis le catalogue, première livraison, **fréquence en choix rapides** — 7 j · 10 j · 14 j · 15 j · 21 j · 28 j · Mensuel · Autre (n jours ou n mois) — et délai de rappel (0 à 60 jours). Tom veut choisir lui-même : montre **les trois prochaines dates calculées** à côté du choix, parce qu'un intervalle de 15 jours change le jour de la semaine et qu'il doit le voir.
- Calendrier des 90 prochains jours, par semaine. Sur une échéance : « Créer la commande » en un geste. Pause et reprise.

**C. Tournée (Livraison)** — quatre étapes
1. **Préparer** : point de départ (« Me localiser » ou rechercher une ville / adresse), arrivée (adresse, ou « Retour au point de départ »), sélection des commandes prêtes filtrées par secteur, bouton **Créer la tournée** avec kilomètres et durée estimés.
2. **Cockpit** (reprends la planche « Cockpit livreur ») : arrêt en cours, *3 sur 8*, distance et temps jusqu'au prochain, **Y aller** (ouvre Google Maps), puis **Livré / Absent / Problème** sous le pouce. Carte repliable.
3. **Carte** (reprends « Carte de tournée ») : tracé routier, arrêts numérotés, arrêt en cours avec halo orange. Réordonner à la main invalide le tracé → bouton « Recalculer le tracé ».
4. **Fin de tournée** : récapitulatif kilomètres, durée, livrés, absents, problèmes ; lien vers l'arrivée.

### Priorité 2

- **D. Préparation** (reprends la planche) : une ligne par commande, cinq visibles d'un coup, filtre secteur, recherche, statut.
- **E. Commandes** : liste triable (numéro, date, client, secteur, statut) et fiche.
- **F. Stock** : tuiles par catégorie, seuil, « À recommander ».
- **G. Clients** : fiche avec adresse, secteur, téléphone, commandes, abonnement.
- **H. Paramètres** : thème clair / sombre / système, comptes (administrateur).
- **États** : vide, chargement, erreur réseau (l'application fonctionne hors ligne), écran de connexion.

## Contraintes d'implémentation

Le résultat sera codé **à la main en HTML, CSS et JavaScript natifs** : pas de framework, pas de bibliothèque d'animation. Donc des composants simples, des tokens en variables CSS, des animations CSS. La carte est **Leaflet + OpenStreetMap** (Google Maps uniquement pour « Y aller »). Un seul set d'icônes SVG linéaires (style Lucide, 20/24 px, trait 2). Poppins sera auto-hébergée. Pas de texte dans les images.

## Livrables

1. **Design system** : tokens clair et sombre avec les contrastes calculés, échelle typographique, espacements (4 / 8), rayons, ombres, et les composants : boutons, pilules de filtre, cartes, badges de statut, lignes de liste, champs, sélecteur de fréquence, barre basse, barre latérale, sheet, toast, marqueur de carte.
2. Les écrans **A, B, C** en quatre variantes, puis **D à H**.
3. Des annotations courtes : ce qui se passe au tap, les états, la règle de tri.
4. **Ton avis d'abord** : avant de dessiner, dis-moi en dix lignes ce que tu changerais dans les six planches et pourquoi.

## Ce qu'on ne fait pas

Pas de refonte du logo. Pas de texte sur fond orange. Pas de gris neutres (tout gris est teinté vert). Pas de dégradés lourds, de néons, d'ombres épaisses. Pas de « dashboard SaaS » générique. Pas d'anglais. Pas plus de quatre informations par ligne.

## Questions ouvertes (réponds-y par une proposition, Tom tranchera)

1. Les quatre destinations mobiles : Tableau de bord · Préparation · Tournée · Abonnements ?
2. Fréquence : intervalle strict (« tous les 15 jours ») ou jour ancré (« un jeudi sur deux ») ? Le modèle actuel est l'intervalle ; l'aperçu des dates doit rendre la différence visible.
3. Le mode sombre : préférence, ou mode du soir en tournée ? Par défaut, suivre le système.

## Par quoi commencer

Commence par **le design system, puis le Tableau de bord mobile en clair**. Attends ma validation avant les autres écrans.

---

## Pièces à joindre au projet Claude Design (dans cet ordre)

| Pièce | Où la trouver | Pourquoi |
|---|---|---|
| `design/DESIGN.md` | dépôt | La charte, au format que Claude Design lit pour bâtir un design system |
| `design/maquettes-v8/captures/*.png` (6 fichiers) | dépôt, générés par `design/maquettes-v8/capturer.js` | Les planches validées : vocabulaire à reprendre |
| `public/brand/sereo-logo.svg`, `sereo-logo-dark.svg`, `sereo-mark.svg` | dépôt | Marque |
| `SKILL.md` du skill apple-design | `https://raw.githubusercontent.com/emilkowalski/skills/main/skills/apple-design/SKILL.md` | Les principes de design demandés par Tom |

Ne pas lier le dépôt GitHub comme source du design system : l'application actuelle a dérivé de la charte (`#0e6b63`, `#f47a5a`…) et Claude Design en extrairait les mauvaises couleurs. Le dépôt se lie plus tard, au moment de passer le design à Claude Code.

## Prompts de suite (un par message, après validation)

1. « Passe le Tableau de bord en sombre avec les mêmes tokens. Liste chaque paire de contraste avec sa valeur. »
2. « Dessine Abonnements : la liste et la fiche de création, mobile clair, avec le sélecteur de fréquence et l'aperçu des trois prochaines dates. »
3. « Tournée : les quatre étapes en mobile clair, en reprenant le cockpit de la planche jointe. »
4. « Les mêmes écrans en desktop 1440 × 900, clair puis sombre. »
5. « Préparation, Commandes, Stock, Clients, Paramètres, et les états vide / chargement / erreur / connexion. »
6. « Exporte en HTML autonome et prépare le passage à Claude Code. »

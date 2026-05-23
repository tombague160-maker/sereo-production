# 📋 Backlog UX Sereo — Idées pour plus tard

> Idées d'améliorations UX/UI proposées le 2026-05-23 mais reportées (focus actuel : rester simple). À piocher selon priorité et envie quand on s'y remet.

---

## 🎨 Page Paramètres

### ✅ Fait (v1.14.x)
- Grid 3 colonnes sur grand écran (≥1400px)
- Liste secteurs en 2 sous-colonnes

### 🟡 À faire si on y revient
- **Accordéons mobile** : sections pliables (par défaut Identité ouverte, le reste fermé)
- **Header sticky** "Paramètres" avec bouton retour
- **Section navigation rapide** en haut : "Aller à : Thème · Secteurs · Mobile · Imports · Danger" (ancres scroll-to)
- **Sticky banner "Modifications non enregistrées"** si l'user touche le thème/palette avant de cliquer Save (actuellement ça s'enregistre auto mais pas de feedback explicite)

---

## 📋 Page Bons de commande

### PC
- **Tri par colonne** : clic sur en-tête tableau (Numéro / Date / Client / Statut) → tri asc/desc
- **Pagination** si > 100 bons (actuellement on charge tout, ralentit le rendu DOM)
- **Sélection multi** (checkboxes) → actions groupées : "Marquer X bons en livraison", "Exporter CSV de la sélection seulement"
- **Sticky header tableau** pour garder les colonnes visibles en scrollant
- **Vue split** : liste à gauche + détail à droite (au lieu de modal)

### Mobile
- **Filtres en bottom sheet** (pattern des cartes "Plus") au lieu de prendre 30% du haut
- **Pull to refresh** au sommet de la liste
- **Swipe sur card** : swipe gauche = "À livrer", swipe droite = "Voir détail"

---

## 📦 Page Stock / Inventaire (page la plus utilisée)

### PC
- **Vue tableau dense** (alternative aux cards via le toggle existant) → 30 produits visibles d'un coup au lieu de 5
- **Quick edit inline** : clic sur la valeur stock → input direct → Enter → save (plus rapide que +1/-1 répétés × 50)
- **Recherche avec highlight** des résultats matchés
- **Filtre rapide** : boutons "Tous · Stock bas · Ruptures · À renseigner"
- **Raccourcis clavier** : `/` = focus recherche, `J/K` = produit suivant/précédent (style Gmail)

### Mobile
- **Cards 1 ligne** : code | nom | stock + boutons compacts (au lieu de 2 lignes actuellement)
- **Clavier numpad** (`inputmode="numeric"`) sur tous les inputs stock → évite le clavier alphabétique mobile
- **Scan code-barre via caméra** (PWA + Barcode Detection API) → super UX pour saisie rapide

---

## 🚚 Mode Livreur (terrain mobile)

### Mobile (prio sur cette page)
- **Carte plein écran** par défaut + bouton bascule liste/carte
- **Boutons sticky bas** : "Appeler · Maps · Livré · Absent" toujours visibles peu importe le scroll
- **Haptic feedback** (`navigator.vibrate(50)`) à chaque action validée → confirmation tactile
- **Mode navigation** : passage automatique à l'étape suivante après "Livré" (pas besoin de cliquer "Suivant")
- **Indicateur réseau** : badge "hors-ligne" si pas de connexion (PWA queue les actions pour sync au retour)

---

## 🔍 Améliorations transverses (toutes pages)

### Recherche & navigation
- **Recherche globale** (`Ctrl+K` ou icône 🔍 dans sidebar) : cherche dans clients + produits + bons numéros
- **Bouton "retour en haut"** : sticky `↑` qui apparaît après 500 px de scroll
- **Breadcrumb** (fil d'Ariane) : "Paramètres > Identité visuelle"
- **Raccourcis clavier** globaux : `?` ouvre cheat-sheet, `g d` = dashboard, `g s` = stock, etc. (style GitHub)

### Visuel & confort
- **Print-friendly CSS** : `@media print` pour imprimer un bon de commande propre (sans sidebar, sans boutons)
- **Mode "haute densité"** : option dans Paramètres pour réduire tous les paddings de 30%
- **Tour guidé au premier login** : flèches qui montrent les boutons clés (Tableau de bord, Import, etc.)

### Notifications & feedback
- **Notifications push PWA** : alerte mobile quand stock bas / quand un import est terminé
- **Centre de notifications** : historique des toasts + lien vers historique app (au lieu de toasts qui disparaissent)

---

## 🚀 Idées plus ambitieuses (long terme)

### Dashboard
- **Widgets customisables** : déplacer/cacher chaque KPI
- **Stats mensuelles** : nombre de bons livrés / mois, secteurs les plus actifs, produits les plus vendus
- **Mini-graph d'évolution** (sparklines) à côté de chaque KPI

### Collaboration
- **Multi-utilisateurs** avec rôles (préparateur, livreur, admin) → traçabilité des actions par user
- **Mode collaboration temps réel** : voir qui est connecté, qui édite quoi (WebSocket basique)
- **Commentaires sur les bons** : annotations entre collègues

### Productivité
- **Intégration calendrier** : voir les livraisons à venir dans une vue agenda mensuel/hebdo
- **Export PDF** d'un bon de commande (impression professionnelle avec logo)
- **Modèles de bons** : créer un bon récurrent (client fixe + produits habituels) en 1 clic

### Métier
- **Réception fournisseur** : workflow inverse → import bons de livraison entrants pour incrémenter le stock
- **Inventaire physique** : mode "comptage" pour valider le stock en magasin (terminal portable)
- **Alertes intelligentes** : suggestion de commande fournisseur quand seuil bas + historique de consommation

---

## 📊 Top 5 priorisé (si on attaque le backlog)

| Ratio impact/effort | Item | Effort |
|---|---|---|
| 🟢🟢🟢 | Vue tableau dense + quick edit inline sur Stock | 1h |
| 🟢🟢🟢 | Tri tableau + sélection multi Bons de commande | 2h |
| 🟢🟢 | Recherche globale `Ctrl+K` | 2h |
| 🟢🟢 | Boutons sticky bas + haptic livreur mobile | 1.5h |
| 🟡🟡 | Scan code-barre PWA (Stock) | 3h |

---

## 🗓️ Quand y revenir ?

- Pas d'urgence — l'app fonctionne très bien comme elle est en v1.14.x
- Piocher 1 ou 2 items quand tu auras un nouveau workflow douloureux à fluidifier
- Le file `AUDIT_2026_05_20.md` reste la référence pour les findings techniques (sécurité, perf)

# DESIGN.md — Séréo V8

Charte de l'application Séréo, écrite pour un agent de design (Claude Design)
et pour l'implémentation en phase 4. Les valeurs viennent du site
groupe-sereo.fr et des six planches du 2 septembre 2026
(`design/maquettes-v8/`), dont les contrastes ont été mesurés. Elles font
autorité sur les couleurs de `public/js/config/themes.js`, qui avaient dérivé.

## 1. Thème visuel et atmosphère

Outil de terrain premium, pas un tableau de bord SaaS. Calme, arrondi, chaud.
Une couleur qui commande (vert profond), une couleur qui signale (orange),
beaucoup d'air. L'utilisateur lit un chiffre ou un nom en une seconde, souvent
au soleil, souvent d'une main. Rien de décoratif qui ne serve la lecture.

## 2. Palette et rôles

### Mode clair

| Rôle | Valeur | Usage | Contraste mesuré |
|---|---|---|---|
| Principal | `#386B6D` | Actions principales, titres, navigation active, corps des marqueurs | blanc dessus **6,01:1** |
| Principal appuyé | `#2A5254` | Survol, texte sur fond vert d'eau | — |
| Accent | `#EF9177` | **Jamais un fond de texte.** Barres de progression, halo de l'arrêt en cours, points d'état, logo | blanc dessus 2,34:1 → interdit |
| Vert d'eau | `#A1C4C0` | Surfaces secondaires et icônes inactives sur fond vert. Pas de texte : 3,20:1 avec le vert profond | — |
| Pêche | `#EDC8C3` | Fonds doux et formes organiques **uniquement**. Pas de badge : le vert profond n'y donne que 3,91:1 | — |
| Pêche claire | `#F7E4E0` | Fond de badge tiède. Texte en `#2A5254` | 7,04:1 |
| Vert clair | `#DDEBE9` | Fond de badge froid. Texte en `#2A5254` | 7,04:1 |
| Fond | `#FBF7F5` | Fond de page | — |
| Surface | `#FFFFFF` | Cartes, panneaux, pilule de navigation active | — |
| Surface basse | `#F5F1EE` | Champs, pistes de progression | le texte secondaire y tient 4,56:1 |
| Squelette de chargement | `#EDE6E2` | Blocs gris qui remplacent le texte pendant le chargement. Jamais de texte dessus | — |
| Texte | `#386B6D` | Texte courant (le vert profond est aussi la couleur du texte, comme sur le site) | 5,95:1 sur blanc |
| Texte secondaire | `#4F7477` | Sous-titres, métadonnées. Remplace six gris-teal non conformes | 5,13:1 sur blanc · 4,81 sur fond · 4,56 sur surface basse |
| Texte secondaire sur vert | `#D6E5E3` | Sur fond `#386B6D`. **0,13 de marge : rien ne se pose dessous** | 4,63:1 |
| Alerte | `#C02B0A` | Texte et icônes d'alerte uniquement. Jamais couleur de lien, jamais pour un simple compteur | — |

**Règle d'alerte, valable dans les deux modes.** Une alerte ne voyage **jamais
par la couleur seule** : elle porte toujours une icône ou un mot. L'accent
`#EF9177` et le rouge d'alerte partagent la même famille de teinte (10° contre
4°), et en mode sombre l'écart entre eux tombe à 1,5:1 — indiscernable à l'œil.
Un point rouge et un point orange côte à côte ne se distinguent pas ; « Bloquée »
écrit à côté, si.
| Succès | `#386B6D` + coche | Le vert principal sert de succès ; pas de second vert | — |

### Mode sombre

Points de départ pris dans `themes.js` (palette « Séréo premium », jeu sombre)
et dans la feuille de route. À recalibrer par mesure ; exiger 4,5:1 sur le
texte courant, 3:1 sur le gros texte et les icônes.

| Rôle | Valeur | Note |
|---|---|---|
| Fond | `#0D1518` | Teinté vert, pas gris neutre |
| Surface | `#132224` | Cartes |
| Surface haute | `#182E31` | Barres, sheets, éléments survolés |
| Texte | `#E6F2EE` | |
| Texte secondaire | `#A8C4BE` | |
| Principal | `#93CBC9` | Le vert profond éclairci ; texte sombre `#0D1518` dessus |
| Accent | `#F5A08F` | Orange désaturé et éclairci ; reste un accent, jamais un fond de texte |
| Vert d'eau sombre | `#243F42` | Surfaces secondaires |
| Pêche sombre | `#3B2724` | Fonds doux |
| Alerte | `#F2635A` | 5,23:1 sur surface, 5,90:1 sur le fond. Écart avec l'accent 1,54:1 — le meilleur possible sans passer sous 4,5:1, d'où la règle d'alerte ci-dessus. `#FF9478` était écarté : 1,06:1 avec l'accent, soit la même couleur |
| Pêche claire sombre | `#3A2A28` | Fond de badge tiède |
| Vert clair sombre | `#1D3B3C` | Fond de badge froid |

Règle des deux modes : mêmes rôles, mêmes noms de tokens, valeurs différentes.
Un composant ne connaît que les rôles.

## 3. Typographie

- Famille : **Poppins** 400 / 500 / 600 / 700. Repli `"Segoe UI", system-ui, sans-serif`.
  En production la police est auto-hébergée (`font-src 'self'`) : pas de Google Fonts.
- Titres d'écran : 26–30 px, 700, interlettrage −0,02 em, interligne 1,1.
- Gros chiffres (tableau de bord) : 34–44 px, 700, chiffres tabulaires (`font-variant-numeric: tabular-nums`), interlettrage −0,02 em.
- Titres de carte : 16–18 px, 600, interlettrage −0,01 em.
- Corps : 15–16 px, 400–500, interligne 1,5, interlettrage 0.
- Métadonnées et libellés de navigation : 13–14,5 px, 500.
- Mobile : jamais sous 13 px. Respecter la taille de texte du système (`rem`, pas `px`).
- Marque : « séréo » en minuscules Poppins 700 orange, sourire orange sous le « o » (comme le logo).

## 4. Composants

- **Boutons** : pilules (rayon 999 px), hauteur 48 px mobile / 44 px desktop.
  Principal = fond `#386B6D` texte blanc ; sur fond vert = fond blanc texte vert.
  Secondaire = contour 1,5 px vert, fond transparent. Jamais de fond orange.
  Retour immédiat au toucher : `transform: scale(.97)` en 100 ms.
- **Pilules de filtre** (secteurs, statuts) : hauteur 44 px, repliables plutôt que débordantes.
- **Cartes** : rayon 24 px (mobile) à 36 px (desktop), fond surface, ombre légère
  (`0 1px 2px rgba(15,61,61,.05), 0 12px 28px rgba(15,61,61,.05)`), sans bordure.
- **Ligne de liste** (commande, abonnement, arrêt) : une ligne de 64–72 px,
  quatre informations maximum, état porté par un point de couleur + un mot.
- **Badge de statut** : pilule 24 px, fond **pêche claire `#F7E4E0` ou vert clair `#DDEBE9`**, texte **`#2A5254`** (7,04:1). Ni pêche `#EDC8C3` ni vert d'eau `#A1C4C0` en fond de badge : le texte n'y tiendrait que 3,91:1 et 3,20:1, insuffisant à 12,5 px.
  Statuts de commande : Importée · À vérifier · En préparation · Préparation terminée · Prêt livraison · En livraison · Livrée.
  Statuts d'arrêt : Prêt · En livraison · Livré · Absent · Problème · À reprogrammer.
- **Champs** : hauteur 48 px, rayon 18 px, fond surface basse, libellé au-dessus. Erreur de saisie annoncée sous le champ, à la frappe et non à l'envoi, avec l'icône d'alerte et le mot.

**Pourquoi la surface basse a changé de valeur.** Elle valait `#F3EFEC` jusqu'au
16/09. Le texte secondaire n'y tenait que **4,48:1**, sous le seuil — défaut
relevé en dessinant les champs, pas en relisant la charte. Assombrir le
secondaire était le réflexe, mais il tombe alors à 1,06:1 du principal, soit la
même couleur à l'œil : la hiérarchie du texte disparaissait pour sauver un
contraste. C'est donc la surface qui s'éclaircit, à `#F5F1EE` — 4,56:1 pour le
secondaire, et elle reste visible sur le blanc comme sur le fond.
- **Sélecteur de fréquence** (abonnements) : pilules « 7 j · 10 j · 14 j · 15 j · 21 j · 28 j · Mensuel · Autre… » + aperçu des trois prochaines dates calculées.
- **Barre basse mobile** : 4 destinations + « Plus », items ≥ 44 px, translucide (`backdrop-filter: blur(20px) saturate(180%)`), contenu qui défile dessous.
- **Barre latérale desktop** : 258 px, fond `#386B6D`, angle droit arrondi 36 px, item actif = pilule blanche.
- **Marqueur de carte** : corps vert `#386B6D`, numéro blanc ; l'arrêt en cours garde un halo orange.
- **Sheet / modale** : coins 28 px, poignée, fond surface haute ; scrim uniquement pour le bloquant.
- **Toast** : bas d'écran, 4 s, une action possible (Annuler).

## 5. Mise en page

- Grille d'espacement : 4 / 8 / 12 / 16 / 24 / 32 / 48.
- Mobile 390 × 844 : une colonne, marges 16 px, contenu qui tient dans un écran pour les vues du quotidien (cockpit, préparation).
- Desktop 1440 × 900 : barre latérale 258 px + contenu 1 100–1 180 px, grille 12 colonnes, gouttière 24 px.
- Tablette 820–1 024 : barre latérale repliée en icônes, deux colonnes.
- Un écran = une intention. Les chiffres regardés le matin sont gros et peu nombreux ; le détail est un tap plus loin.
- Formes organiques de fond (pêche / vert d'eau) : grandes, floues, jamais derrière du texte courant.

## 6. Profondeur et élévation

Trois niveaux, pas plus : fond → surface (cartes) → surface haute (barres, sheets, menus).
Les barres sont translucides et le contenu défile dessous ; un dégradé de fondu remplace le trait de séparation.
Jamais deux surfaces translucides claires superposées. Sous `prefers-reduced-transparency`, tout devient opaque.

**Une forme décorative ne passe sous du texte que si la couleur composée tient le seuil.**
Ronds pastel, halos, taches : la question n'est pas leur présence mais la valeur qu'ils
produisent une fois composés. Deux mesures du 16 septembre :

- `#A1C4C0` à 30 % sur le fond clair compose `#DFE7E4` : le secondaire y tombe à **4,07:1** au
  lieu de 4,81. Écart franc.
- un halo blanc à 5–7 % sur le vert principal compose `#427274` à `#467577` : le secondaire sur
  vert y tombe à **3,97–4,16:1** au lieu de 4,63. Écart d'un cheveu, et pourtant sous le seuil,
  parce que ce couple-là n'a que 0,13 de marge.

Aucune relecture de code ne voit ni l'un ni l'autre : la couleur *déclarée* reste juste, seule
la couleur *affichée* change. **Et la mesure ne se prend pas au centre de la ligne** — une forme
qui n'en couvre qu'un bout y échappe ; c'est le pire point de l'intersection qui compte.

Dans cette palette la condition est intenable sur fond vert : survivre à un halo à 7 %
demanderait d'éclaircir le secondaire jusqu'à `#EAF3F1`, qui ne se lit plus comme un
secondaire. Donc c'est la forme qui bouge. Une exception : WCAG 1.4.3 exempte les logotypes,
et la marque orange sur l'en-tête vert (2,28:1 sous halo) n'est pas à corriger.

## 7. À faire / à ne pas faire

**Faire** : hiérarchie par taille et espace · un seul set d'icônes linéaires (style Lucide, 20/24 px, trait 2) · libellés directs (« Tournée », « Abonnements », « Préparation ») · confirmer seulement l'irréversible · état vide qui dit quoi faire · animations 200–350 ms, ressort amorti (pas de rebond sauf après un geste), toutes coupées sous `prefers-reduced-motion`.

**Ne pas faire** : texte sur fond orange · gris neutres (tout gris est teinté vert) · dégradés lourds, néons, ombres épaisses · plus de quatre informations par ligne · icônes sans libellé dans la navigation · anglais (« Home », « Dashboard », « Settings ») · texte dans les images · un composant qui existe en deux versions · une forme décorative sous du texte sans avoir mesuré la couleur composée.

## 8. Comportement responsive

Mobile d'abord. Ce qui est en bas sur mobile (actions) passe en haut à droite sur desktop.
Les cartes KPI : 2 colonnes mobile, 4 à 6 desktop. Les tableaux deviennent des lignes de liste sous 600 px.
La carte (Leaflet + OpenStreetMap) : plein écran mobile avec le cockpit en surimpression ; desktop 60 / 40 carte / liste.

## 9. Dette relevée dans le code actuel, à solder en phase 4

Constats de la lecture du dépôt par Claude Design le 16/09, **chacun revérifié
ici**. Ils ne changent pas la charte : ils disent ce que la refonte doit défaire.

| Constat | Vérifié | Mesure exacte |
|---|---|---|
| Un arrêt en « problème » n'enregistre aucune raison | oui | `createStop` (server.js:5539) porte un champ `notes`, mais il recopie les notes de la commande. Le statut `probleme` existe sans motif. Un champ neuf est à créer |
| Trois rayons de carte concurrents | oui, et pire qu'annoncé | `--radius-card` vaut 8, 22 **et** 28 px dans `style.css` |
| Trois oranges pour un seul rôle | oui | `#f18c79` (14×), `#f47a5a` (3×), `#ef8f77` dans `sereo-mark.svg`, `sereo-sidebar-bg.svg`, `favicon.svg` et `generate-icons.js` |
| Générations de tokens empilées | oui | `--color-pastel-` 95 déclarations, `--palette-` 186, `--neo-` 121 |
| 15 onglets pour 6 catégories | oui | `mainTabs` en compte 15, dont 5 listes de commandes filtrées différemment |
| Du texte vivant dans les SVG de marque | oui | les 3 fichiers portent `<text font-family="Segoe UI, Arial">` — à vectoriser |
| `--color-text-soft` sous le seuil | **non, affirmation fausse** | `#5e6d6d` sur `#FBF7F5` donne **5,08:1**, au-dessus de 4,5. Rien à corriger |

### Écarts entre les écrans dessinés et le code — relevés le 16/09 sur l'export 3

Ce ne sont pas des dettes : ce sont des promesses faites par une maquette et que le
code ne tient pas encore, ou des comportements que le code tient déjà et que la
maquette oublie. Les deux coûtent cher si personne ne les nomme avant le chiffrage.

| Écart | Sens | Mesure exacte |
|---|---|---|
| ~~L'écran de connexion n'a pas d'état bloqué~~ — **réglé le 16/09, planches 9c et 9d** | le code le fait, l'écran le montre | `server.js` bloque après **5 tentatives** ratées dans une fenêtre glissante de **15 min**, pour **15 s** (`AUTH_RATE_LIMIT_*`). La page actuelle affiche les tentatives restantes, puis un décompte vivant avec les champs désactivés (`renderLoginPage`, l. 1502-1526). Le mot « tentative » n'apparaît nulle part dans l'export |
| La file d'attente hors ligne n'existe pas | l'écran le promet, le code ne le fait pas | `service-worker.js` l. 113 : tout ce qui n'est pas un GET same-origin est laissé passer tel quel. Aucun écouteur `sync`, aucun magasin de reprise, et `app.js` n'écoute ni `online` ni `offline` pour ses **32 écritures réseau**. La *lecture* hors ligne, elle, est réelle : network-first à 3 s puis cache, sur tout `/api/` sauf `status`, `version`, `me`, `comptes` |
| Le thème par défaut | écart mineur, assumé | le code force `light` au départ (« pendant la phase de test, on n'active pas le mode sombre auto ») ; la maquette met « Système ». Le choix par appareil, lui, est exactement ce que fait `app.js` : `localStorage` seul, la valeur en base est délibérément ignorée |
| Le blocage se compte par adresse IP, pas par personne | à dire à l'écran | `authRateLimitState` est une `Map` indexée par `getClientIp(req)` (`server.js` l. 348-404), `trust proxy` à 1. Cinq échecs derrière une même connexion — le wifi de l'entrepôt, un NAT d'opérateur — bloquent tout le monde. Un écran qui annonce « 5 essais ratés » accuse quelqu'un qui n'a peut-être rien tapé |

## 10. Guide pour l'agent

- Toujours produire les deux modes (clair et sombre) avec les mêmes tokens ; lister les contrastes calculés.
- Toujours produire mobile 390 × 844 et desktop 1440 × 900.
- Réutiliser le vocabulaire des six planches jointes (`design/maquettes-v8/captures/*.png`) : pilules, grands rayons, sourire de la marque, une ligne par commande, trois gestes sous le pouce.
- Données réelles plutôt que du faux texte : secteurs Besançon / Champagnole / Dole ; clients de démonstration EHPAD Les Tilleuls du Val de Loue, SSIAD de la Haute Vallée, Clinique Vétérinaire ; produits changes molletonnés taille L, alèses ; numéros de commande `CMD-2026-001`.
- Le résultat sera codé à la main en HTML, CSS et JavaScript natifs, sans framework : composants simples, tokens en variables CSS, aucune bibliothèque d'animation.

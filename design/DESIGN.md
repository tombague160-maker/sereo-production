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
| Accent | `#EF9177` | **Ni un fond de texte, ni du texte.** C'est une forme : barre de progression, halo, point d'état. Seule exception, le logotype, exempté par WCAG 1.4.3 | sur blanc 2,34:1 · sur vert 2,57:1 → interdit dans les deux sens |
| Vert d'eau | `#A1C4C0` | Surfaces secondaires et icônes inactives sur fond vert. Pas de texte : 3,20:1 avec le vert profond | — |
| Pêche | `#EDC8C3` | Fonds doux et formes organiques **uniquement**. Pas de badge : le vert profond n'y donne que 3,91:1 | — |
| Pêche claire | `#F7E4E0` | Fond de badge tiède. Texte en `#2A5254` | 7,04:1 |
| Vert clair | `#DDEBE9` | Fond de badge froid. Texte en `#2A5254` | 7,04:1 |
| Fond | `#FBF7F5` | Fond de page | — |
| Surface | `#FFFFFF` | Cartes, panneaux, pilule de navigation active | — |
| Surface basse | `#F5F1EE` | Champs, pistes de progression | le texte secondaire y tient 4,56:1 |
| Squelette de chargement | `#EDE6E2` | Blocs gris qui remplacent le texte pendant le chargement. Jamais de texte dessus | — |
| Texte | `#386B6D` | Texte courant (le vert profond est aussi la couleur du texte, comme sur le site) | **6,01:1** sur blanc — c'est le principal, donc exactement sa valeur. La charte a longtemps écrit 5,95 ici et 6,01 trois lignes plus haut, pour la même paire. Corrigé le 17/09 par recalcul |
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

Neuf valeurs prises dans `themes.js` (palette « Séréo premium », jeu sombre) et
dans la feuille de route ; **sept complétées par mesure le 17/09**, en partant
des valeurs sombres que l'app portait déjà, pour garder la continuité. Seuils :
4,5:1 sur le texte courant, 3:1 sur le gros texte, les icônes et les formes.
Chaque contraste ci-dessous est recalculé par `test/jetons-v8.test.js`.

| Rôle | Valeur | Contraste mesuré |
|---|---|---|
| Principal | `#93CBC9` | Le vert profond éclairci ; texte sombre `#0D1518` dessus **10,22** |
| Principal appuyé | `#B9E1DF` | **13,10** sur le fond. Continuité avec `--color-brand-teal-dark` sombre |
| Accent | `#F5A08F` | Orange désaturé et éclairci ; reste une forme. **9,06** sur le fond. **1,55** avec l'alerte : indiscernables sans mot |
| Fond | `#0D1518` | Teinté vert, pas gris neutre |
| Surface | `#132224` | Cartes |
| Surface haute | `#182E31` | Barres, sheets, éléments survolés. Texte **12,42**, secondaire **7,67** |
| Surface basse | `#101D20` | Champs. Texte **15,02**, secondaire **9,28** |
| Squelette de chargement | `#1C3033` | Jamais de texte dessus |
| Vert d'eau sombre | `#243F42` | Surfaces secondaires. Texte dessus **9,81** |
| Pêche sombre | `#3B2724` | Fonds doux. Texte dessus **12,19** |
| Pêche claire | `#4A302B` | Fond de badge tiède. Texte **10,46** |
| Vert clair | `#172B2D` | Fond de badge froid. Texte **12,89**, secondaire **7,96** |
| Texte | `#E6F2EE` | **16,09** fond · **14,27** surface · **12,42** surface haute |
| Texte secondaire | `#A8C4BE` | **9,94** fond · **8,82** surface · **7,67** surface haute |
| Texte sur principal | `#0D1518` | **10,22** |
| Texte secondaire sur principal | `#0D1518` | même valeur : sur `#93CBC9`, le sombre est le seul texte qui tienne |
| Alerte | `#F85E3C` | Le rouge d'alerte, teinte gardée (11°), éclairci jusqu'à tenir 4,5 sur la surface la plus dure : **5,85** fond · **5,19** surface · **4,52** surface haute. `#C02B0A` ne donne que 3,16 sur le fond sombre |

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

**Aucune couche translucide ne passe sous du texte sans que la couleur composée
soit mesurée.** Ronds flous, halos, pilules de filtre, fonds de champ : la forme
de la couche n'a aucune importance, seule compte la valeur qu'elle produit.
Ronds pastel, halos, taches : la question n'est pas leur présence mais la valeur qu'ils
produisent une fois composés. Deux mesures du 16 septembre :

- `#A1C4C0` à 30 % sur le fond clair compose `#DFE7E4` : le secondaire y tombe à **4,07:1** au
  lieu de 4,81. Écart franc.
- un halo blanc à 5–7 % sur le vert principal compose `#427274` à `#467577` : le secondaire sur
  vert y tombe à **3,97–4,16:1** au lieu de 4,63. Écart d'un cheveu, et pourtant sous le seuil,
  parce que ce couple-là n'a que 0,13 de marge.

**Et la mesure se prend sous les glyphes, pas ailleurs.** Quatre instruments ont
menti avant de dire vrai : masquer le texte par `visibility` efface aussi le fond
propre du bouton ; le pixel isolé le plus sombre attrape les bords anticrénelés ;
`elementFromPoint` rend `null` hors de la fenêtre et écarte alors tout en silence ;
et « quelque chose devant » ne veut pas dire « caché », puisqu'un voile à 5 % est
justement le défaut cherché. Ce qui marche : deux photos de la planche, la seconde
en `color: transparent`, et le pire fond porté par au moins 2 % des pixels de glyphe.

Aucune relecture de code ne voit ni l'un ni l'autre : la couleur *déclarée* reste juste, seule
la couleur *affichée* change. **Et la mesure ne se prend pas au centre de la ligne** — une forme
qui n'en couvre qu'un bout y échappe ; c'est le pire point de l'intersection qui compte.

Dans cette palette la condition est intenable sur fond vert : survivre à un halo à 7 %
demanderait d'éclaircir le secondaire jusqu'à `#EAF3F1`, qui ne se lit plus comme un
secondaire. Donc c'est la forme qui bouge. Une exception : WCAG 1.4.3 exempte les logotypes,
et la marque orange sur l'en-tête vert (2,28:1 sous halo) n'est pas à corriger.

## 7. À faire / à ne pas faire

**Faire** : hiérarchie par taille et espace · un seul set d'icônes linéaires (style Lucide, 20/24 px, trait 2) · libellés directs (« Tournée », « Abonnements », « Préparation ») · confirmer seulement l'irréversible · état vide qui dit quoi faire · animations 200–350 ms, ressort amorti (pas de rebond sauf après un geste), toutes coupées sous `prefers-reduced-motion`.

**Ne pas faire** : texte orange · texte sur fond orange · gris neutres (tout gris est teinté vert) · dégradés lourds, néons, ombres épaisses · plus de quatre informations par ligne · icônes sans libellé dans la navigation · anglais (« Home », « Dashboard », « Settings ») · texte dans les images · un composant qui existe en deux versions · une forme décorative sous du texte sans avoir mesuré la couleur composée.

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
| Le sur-titre était orange sur blanc | l'écran l'inventait, la charte ne l'interdisait pas | « ARRÊT EN COURS » en `#EF9177` 12 px sur `#FFFFFF` vaut **2,34:1**. La charte interdisait l'orange comme *fond* de texte, pas comme texte : le trou est comblé. Les mots passent en principal, le point rond à côté garde l'orange |
| Les pilules de filtre sur en-tête vert | jamais mesuré par personne | `rgba(255,255,255,.16)` sur `#386B6D` compose `#588284` : blanc **4,25:1**, texte indicatif des champs de recherche **3,27:1**. Dix planches, présent depuis le premier export |
| Les cibles tactiles n'ont jamais été mesurées | axe neuf, ouvert le 16/09 | **41 contrôles sous le seuil** sur l'export 6. Deux familles : les liens texte nus (20-21 px de haut — « Catalogue », « Tout cocher », « Ajouter », « Tous les abonnements ») qui ratent même le plancher WCAG 2.2 AA de 24 px ; et les contrôles à 32-36 px (bouton d'effacement, « Commander », sélecteurs de tri, « Annuler » du toast) qui ratent notre 44. Le « Plus » de la barre basse fait **35 px de large** sur dix écrans : l'item est dimensionné par son libellé, et « Plus » est court |
| `cursor` est une propriété **héritée** | piège de mesure | Juger chaque élément qui rend `cursor: pointer` compte chaque mot d'une ligne cliquable : 557 faux défauts au lieu de 41. On ne juge que l'élément le plus extérieur dont le parent ne porte pas le pointeur |
| Les 48 planches, mesurées | **quatre axes, trois clos** | contraste : **1983 textes**, 0 défaut réel *(12 logotypes exemptés WCAG 1.4.3, 1 ligne à 3 % des glyphes sous la résolution)* · cibles tactiles : **531**, 0 sous le seuil · texte coupé ou débordant : **2192 textes**, 0 · couleurs : 28, aucune intruse |
| ~~Le contraste des ICÔNES~~ — **clos le 17/09** | fermé par l'arithmétique, pas par le rendu | Mon instrument photographique plafonnait à 35 icônes sur 574 ; l'axe a été fermé par le calcul, depuis les couleurs déclarées de chaque SVG, en exemptant (WCAG 1.4.11) toute icône **doublée d'un mot**. Dix classes soumises passent, de **4,56** à **10,22**. **Deux tombaient**, et ce sont des *contours de composant* — donc invisibles à une sonde à glyphes, faute de glyphe dessous : le marqueur « à venir » (`#A1C4C0` sur carte, **1,62:1**) et les cases non cochées (`#A1C4C0` sur fond **1,77:1** ; `#243F42` sur `#0D1518` en sombre **1,64:1**). Corrigées en `#386B6D` / `#4F7477` et `#A8C4BE`, **13 occurrences**. Contre-épreuve : la luminance du fond de carte, déduite d'un seul de ces chiffres, prédit l'autre à **0,004** près |

### ⛔ Le piège qui a produit un chiffre faux — mesuré le 17/09 dans le code

**Une charte se vérifie sur des pixels rendus, jamais sur des couleurs déclarées.**
J'ai lu `color: var(--color-pastel-orange-strong)` dans la règle `.tab`, composé à
la main les couches translucides au-dessus, et annoncé **1,36:1** sur la barre de
navigation. C'était faux. Le navigateur a montré **neuf règles** en concurrence sur
`.tab.active`, empilées par trois refontes successives ; la gagnante, scopée
`:root[data-color-scheme="light"]`, rendait déjà **7,77:1**.

| | Ce que disait l'arithmétique | Ce que rendait l'écran |
|---|---|---|
| Onglet actif, clair | 1,95:1 ❌ | **7,77:1** ✅ |
| Onglet actif, sombre | 3,74:1 ❌ | **4,42:1** ❌ *(défaut réel, mais marginal)* |

Chaque règle prise isolément est juste. C'est l'**empilement** qui décide, et aucune
relecture ne le voit : il faut demander au moteur `el.matches(sel)` sur chaque règle
de chaque feuille, ou photographier. Corollaire pour la phase 4 :

> **Un ratio calculé depuis le CSS est un indice. Seul un ratio lu sous les glyphes
> est une mesure.** Les deux se trompent dans des directions opposées — l'arithmétique
> rate la cascade, la sonde rate ce qui n'a pas de glyphe (contours, cases vides,
> marqueurs). **Il faut les deux, et elles ne se remplacent pas.**

### Deux défauts soldés dans le code le 17/09

| Défaut | Mesure | Remède |
|---|---|---|
| Onglet actif illisible en mode sombre | **4,42:1** — orange `#f5a08f` sur un dégradé orange sombre | Fond rendu **opaque** (`var(--surface)`, plus aucun composite) et libellé en teal : **11,50:1**. L'orange n'est pas perdu, il devient la **barre** d'onglet actif — une forme, ce que la charte a toujours autorisé |
| L'accordéon de la barre latérale ne repliait rien en mode sombre | au clic : clair 248 px → 0 ✅ · sombre 250 px → **250** ❌ | Les quatre règles de repli étaient toutes préfixées `:root[data-color-scheme="light"]`. Le repli est **structurel**, pas thématique : deux règles sans portée de thème ont été ajoutées. Le cas grave n'était pas visuel — `aria-expanded="false"` annonçait un repli qui n'avait pas eu lieu |

**Et les palettes sont tombées de 5 à 1.** Cinq combinaisons palette × mode sur huit
écrivaient du texte de navigation sous 4,5:1 d'après leurs couleurs déclarées. Tenir
dix palettes conformes coûtait dix fois la mesure, pour un choix que personne n'avait
demandé. Le seul axe d'apparence restant est **clair / sombre**, et il est désormais
couvert par deux tests e2e qui échouent l'un et l'autre si le défaut revient.

## 10. Guide pour l'agent

- Toujours produire les deux modes (clair et sombre) avec les mêmes tokens ; lister les contrastes calculés.
- Toujours produire mobile 390 × 844 et desktop 1440 × 900.
- Réutiliser le vocabulaire des six planches jointes (`design/maquettes-v8/captures/*.png`) : pilules, grands rayons, sourire de la marque, une ligne par commande, trois gestes sous le pouce.
- Données réelles plutôt que du faux texte : secteurs Besançon / Champagnole / Dole ; clients de démonstration EHPAD Les Tilleuls du Val de Loue, SSIAD de la Haute Vallée, Clinique Vétérinaire ; produits changes molletonnés taille L, alèses ; numéros de commande `CMD-2026-001`.
- Le résultat sera codé à la main en HTML, CSS et JavaScript natifs, sans framework : composants simples, tokens en variables CSS, aucune bibliothèque d'animation.

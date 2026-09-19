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
| Avertissement | `#9A5A18` | Texte et icônes d'avertissement — un problème qui n'empêche pas d'agir. Ajouté le 17/09 : l'app portait ce rôle (`.pill-warning`, `.button.warning`, `.status-warning`) sans que la charte le nomme | 5,46 surface · 5,12 fond · 4,86 surface basse |
| Fond d'avertissement | `#FFF1D8` | Fond de badge tiède propre à l'avertissement. **La pêche claire ne suffit pas** : `#9A5A18` n'y donne que 4,45 | 4,89:1 |
| Alerte | `#C02B0A` | Texte et icônes d'alerte uniquement. Jamais couleur de lien, jamais pour un simple compteur | — |
| Anneau de focus | `#0D1518` | L'indicateur de focus **clavier**. 18,46 sur blanc · 2,44 au pire, sur le vert le plus sombre de la barre latérale — d'où le second ton | — |
| Second ton du focus | `#FFFFFF` | Le compagnon de l'anneau. **18,46 avec lui, quel que soit le fond derrière** — c'est ce qui rend l'indicateur percevable sans avoir à énumérer les surfaces | — |

**Règle des trois signaux, valable dans les deux modes.** Accent, avertissement
et alerte ne voyagent **jamais par la couleur seule** : chacun porte toujours
une icône ou un mot. Ce n'est pas une précaution, c'est une conséquence
mesurée — la matrice complète, recalculée le 17/09 :

| Paire | Clair | Sombre |
|---|---|---|
| accent / alerte | 2,50 | **1,55** |
| accent / avertissement | 2,33 | **1,44** |
| alerte / avertissement | **1,07** | 2,23 |

**Chaque mode a une paire sous 1,6, et ce n'est pas la même.** Le sombre confond
l'accent avec les deux autres ; le clair confond l'avertissement avec l'alerte —
précisément les deux signaux qu'on a le plus besoin de distinguer, et l'écart y
est le pire du tableau, 1,07. La charte ne notait que le cas sombre, ce qui
laissait croire à un défaut du mode sombre. C'est structurel : les trois
signaux partagent la même famille de teinte, par construction de la marque.
Un point rouge et un point orange côte à côte ne se distinguent pas ;
« Bloquée » écrit à côté, si.
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
| Avertissement | `#FFD0AA` | **13,06** fond · **11,59** surface · **12,19** surface basse |
| Fond d'avertissement | `#775841` | Le plus **clair** qui tienne 4,5 sous `#FFD0AA` (**4,56**) : il reste un badge, pas un trou noir |
| Alerte | `#F85E3C` | Le rouge d'alerte, teinte gardée (11°), éclairci jusqu'à tenir 4,5 sur la surface la plus dure : **5,85** fond · **5,19** surface · **4,52** surface haute. `#C02B0A` ne donne que 3,16 sur le fond sombre |
| Anneau de focus | `#E6F2EE` | 14,27 sur la surface, 16,09 sur le fond |
| Second ton du focus | `#0D1518` | Les deux tons s'échangent entre les modes |

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
| ~~Un arrêt en « problème » n'enregistre aucune raison~~ — **soldé le 18/09** | oui dans l'effet, **non dans la cause** | La charte disait « un champ neuf est à créer ». **Faux : `stop.problemReason` existait.** Le défaut réel était ailleurs, et il tenait en trois points — détail plus bas |
| ~~Trois rayons de carte concurrents~~ — **soldé le 18/09** | oui, et **encore pire qu'annoncé** | `--radius-card` valait 8, 22 **et** 28 px — et surtout **22 en clair, 8 en sombre**, les deux déclarations gagnantes étant scopées `light`. Détail plus bas |
| ~~Trois oranges pour un seul rôle~~ — **soldé le 18/09, sauf `--warning`** | oui | Distance sRGB à `--v8-accent` : `#ef8f77` **2**, `#f18c79` **6** — imperceptibles ; `#f47a5a` **37** — visiblement autre. Les marques, le favicon et le générateur d'icônes prennent l'accent ; `--warning` est **laissé exprès**, détail plus bas |
| ~~Générations de tokens empilées~~ — **soldé le 18/09** | oui à l'époque | Était : `--color-pastel-` 95, `--palette-` 186, `--neo-` 121. **Remesuré le 18/09 : zéro déclaration des trois.** Seules trois lignes de commentaire les nommaient encore, dont une périmée — corrigées |
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
| ~~La file d'attente hors ligne n'existe pas~~ — **soldée le 18/09, v1.31.0** | l'écran le promettait, le code ne le faisait pas | `service-worker.js` l. 113 : tout ce qui n'est pas un GET same-origin est laissé passer tel quel. Aucun écouteur `sync`, aucun magasin de reprise, et `app.js` n'écoute ni `online` ni `offline` pour ses **32 écritures réseau**. La *lecture* hors ligne, elle, est réelle : network-first à 3 s puis cache, sur tout `/api/` sauf `status`, `version`, `me`, `comptes` |
| Le thème par défaut | écart mineur, assumé | le code force `light` au départ (« pendant la phase de test, on n'active pas le mode sombre auto ») ; la maquette met « Système ». Le choix par appareil, lui, est exactement ce que fait `app.js` : `localStorage` seul, la valeur en base est délibérément ignorée |
| Le blocage se compte par adresse IP, pas par personne | à dire à l'écran | `authRateLimitState` est une `Map` indexée par `getClientIp(req)` (`server.js` l. 348-404), `trust proxy` à 1. Cinq échecs derrière une même connexion — le wifi de l'entrepôt, un NAT d'opérateur — bloquent tout le monde. Un écran qui annonce « 5 essais ratés » accuse quelqu'un qui n'a peut-être rien tapé |
| Le sur-titre était orange sur blanc | l'écran l'inventait, la charte ne l'interdisait pas | « ARRÊT EN COURS » en `#EF9177` 12 px sur `#FFFFFF` vaut **2,34:1**. La charte interdisait l'orange comme *fond* de texte, pas comme texte : le trou est comblé. Les mots passent en principal, le point rond à côté garde l'orange |
| ~~Les pilules de filtre sur en-tête vert~~ — **mesuré et soldé le 18/09** | jamais mesuré par personne, et pour une raison d'instrument | `rgba(255,255,255,.16)` sur `#386B6D` compose `#588284` : blanc **4,25:1**, texte indicatif des champs de recherche **3,27:1**. Dix planches, présent depuis le premier export |
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

### La file d'attente hors ligne — construite le 18/09, et ce qu'elle a révélé

La promesse de la planche 15 est tenue : une écriture faite sans réseau est
conservée dans `indexedDB` et repart à la reconnexion. Trois décisions portent tout
le mécanisme, et chacune a été prise **contre** une première version plus simple qui
était fausse.

**`navigator.onLine` n'est fiable que dans un sens, et c'est celui-là qu'on utilise.**
La spécification garantit que `false` signifie « certainement hors ligne » : aucune
interface réseau, donc la requête n'est **jamais partie**. `true` ne promet rien
(portail captif, wifi sans internet). On ne met donc en file que ce dont on *sait*
que le réseau ne l'a pas emporté. Un **délai dépassé**, lui, peut parfaitement
signifier que le serveur a reçu et traité la demande : le rejouer dupliquerait une
écriture non idempotente. C'est la seule raison pour laquelle la file peut se passer
d'une clé d'idempotence côté serveur — **si cette garde tombe un jour, il en faut une.**

**« Le réseau n'a pas répondu » et « le serveur a refusé » ne demandent pas le même
geste.** Un 4xx retire l'écriture : le serveur a jugé, insister ferait une file qui ne
se vide jamais. Un échec réseau la garde. C'est cette distinction qui impose d'envoyer
le rejeu avec `fetch` **nu** et non avec `apiFetch` — `apiFetch` lève sur toute
réponse non-ok, si bien qu'un refus lui arriverait sous forme d'exception, donc serait
pris pour une panne, donc conservé pour toujours.

**Un échec arrête la file, il ne la saute pas.** Deux écritures sur la même commande
— « en préparation » puis « livrée » — rejouées à l'envers laisseraient la commande
dans un état **antérieur à la réalité**. Corollaire non évident : le compteur
d'essais ne compte **que** les 5xx. Il existe pour arrêter une entrée empoisonnée, et
seule une *réponse* peut indiquer un empoisonnement ; ma première version comptait
aussi les échecs réseau, si bien que cinq reconnexions ratées bloquaient
définitivement une écriture parfaitement valide.

Les envois de **fichiers** restent refusés hors ligne, délibérément : rejouer un
import Excel trois heures plus tard, sur un stock qui a bougé, ferait plus de dégâts
que de refuser tout de suite.

| Mesuré le 18/09 | Avant | Après |
|---|---|---|
| Écriture faite hors ligne | perdue, toast rouge | conservée, rejouée à la reconnexion |
| Écouteurs `online` / `offline` | 0 | 2 |
| Ce que voit l'utilisateur | « Erreur : Failed to fetch » | « Hors ligne — enregistré, sera envoyé à la reconnexion », et un compteur dans la puce d'état |
| Bancs | — | **10 unitaires + 8 e2e**, 13 mutations distinguées |

### ⛔ Ce que la file a révélé, et qui n'est pas à moi de trancher

En essayant de recharger l'onglet hors ligne, le banc a rendu
`ERR_INTERNET_DISCONNECTED`. Cause mesurée : `service-worker.js` l. 126,
`if (request.mode === "navigate") return;` — **les navigations ne sont pas mises en
cache**, et le commentaire dit pourquoi : « auth-sensible ».

> **L'application ne peut pas être ROUVERTE hors ligne.** « La lecture hors ligne
> fonctionne » n'est vrai que pour un onglet **déjà ouvert**. Un livreur qui ferme
> l'application en zone blanche ne peut plus la rouvrir avant d'avoir du réseau.

Mettre la coquille HTML en cache réglerait le problème en trois lignes, et c'est le
patron habituel d'une PWA. Mais cela revient à servir l'interface authentifiée à
quelqu'un qui n'est plus connecté — les données, elles, resteraient inaccessibles
(les appels `/api/` rendent 401 et renvoient vers `/login`). **C'est un arbitrage de
sécurité, donc il revient à Thomas, pas à moi.** La file d'attente fonctionne sans
lui : elle se vide au retour du réseau dans l'onglet ouvert, et au démarrage suivant.

### Trois cécités de l'instrument de contraste — fermées le 18/09

Le banc annonçait **1 275 textes, 0 défaut**. Il ne mentait pas ; sa **portée**
était plus étroite que son titre, de trois façons indépendantes. Chacune rendait
un zéro qui rassure.

**① Les champs de saisie n'étaient pas jugés.** La sélection gardait les éléments
portant un *nœud texte enfant* — or un `<input>` n'en a jamais. Le texte indicatif
(`::placeholder`), la valeur saisie et le libellé d'un `<select>` étaient donc hors
champ. Et la cécité était double pour l'indication : `::placeholder` porte sa
**propre** déclaration de couleur, si bien que `el.style.color = "transparent"` ne
l'efface pas — ses glyphes seraient apparus identiques dans les deux
photographies, donc comptés à zéro. *Mesure* : **40 textes indicatifs à 3,56:1 en
mode sombre**, cause unique — les trois déclarations `::placeholder` de la feuille
étaient toutes préfixées `:root[data-color-scheme="light"]`, et le navigateur
posait son défaut à lui, `#757575`. *La même forme que le défaut de l'accordéon :
une règle juste, scopée à un seul mode.*

**② L'alpha était jeté.** `couleur.match(/\d+/g).slice(0, 3)` transformait
`rgba(255,255,255,0.72)` en blanc pur et **surévaluait** le contraste. *Mesure* :
**215 textes translucides sur le vert de la barre latérale, dont 175 sous le
seuil**, de 3,45 à 4,49. La charte l'avait pressenti sur les maquettes (« 3,27 —
jamais mesuré par personne ») ; c'est le même défaut, au même endroit.

*Contre-épreuve, par une méthode qui ne partage pas l'hypothèse* : au lieu de
composer la couleur déclarée, lire la couleur **rendue** des glyphes dans la
photographie. Les deux s'accordent à **0,13** près, et le rendu est toujours le
plus sévère des deux.

> **Il n'y a pas de place pour un blanc atténué sur ce vert**, et c'est mesuré :
> blanc pur **4,99** · blanc à 0,94 **4,63** · blanc à 0,90 **4,39** · `#D6E5E3`
> (le jeton « secondaire sur principal ») **3,85** — il avait été calculé pour
> `#386B6D`, or le champ *éclaircit* ce vert. Entre le blanc et le seuil il reste
> **0,49**. La hiérarchie passe donc par la taille et la graisse, plus par
> l'opacité. ⛔ **Rien de plus sombre que le blanc ne peut se poser sur la barre
> latérale.**

**③ Un texte recouvert était compté comme « rien à juger ».** Un élément que
personne ne voit ne produit aucune différence entre les deux photographies : zéro
glyphe, donc `return` muet, donc rangé avec les cas sans texte. *Mesure* : le
message « Aucun client avec coordonnées. » était **peint sous la carte** dans les
deux modes — Leaflet pose ses panneaux à z-index 200 et plus, `.map-empty` était
en `z-index: auto`. Cet état vide n'a jamais été vu par personne. Le contrôle
d'occlusion en amont ne l'attrapait pas : il interroge `elementFromPoint`, en
coordonnées de **fenêtre**, sur un élément qui peut être mille pixels plus bas.

> **Zéro glyphe n'est pas une conformité.** Le banc compte désormais les textes
> *mis en page mais invisibles* et échoue s'il y en a un.

| Après | clair | sombre |
|---|---|---|
| textes de l'application | 627, **0 défaut**, 0 invisible | 649, **0 défaut**, 0 invisible |
| textes des champs | 83, **0 défaut** | 53, **0 défaut** |
| cibles tactiles | 332 (fine) | 234 (coarse), 0 sous 24 px |

### ⛔ Les bancs martelaient OpenStreetMap, et mesuraient son message d'erreur

En photographiant l'onglet livreur, les tuiles reçues n'étaient pas des cartes.
C'étaient des images d'erreur **HTTP 403** :

> *« Access blocked — App is not following the tile usage policy of
> OpenStreetMap's volunteer-run servers : osm.wiki/Blocked »*

Deux conséquences, et les deux comptent. **Le banc mesurait autre chose que
Séréo** — les fonds lus sous les glyphes au-dessus de la carte étaient le
graphique d'erreur d'OSM, en gris 78 à 209, inversé en sombre par
`--leaflet-tile-filter`. Et **chaque exécution frappait un service bénévole** :
quinze onglets, deux modes, une dizaine de bancs, à chaque fois. Le blocage n'est
pas un accident, c'est la réponse normale d'OSM à ce comportement.

Les bancs servent désormais une tuile plate, locale, et `tuiles-bloquees.spec.js`
échoue si une seule demande s'échappe. Le `{s}` de l'URL (sous-domaines `a.b.c`,
hérités de HTTP/1.1, **explicitement déconseillés** par la politique d'usage
d'OSM) a été retiré — ce qui a immédiatement révélé que la CSP du serveur
n'autorisait que `https://*.tile.openstreetmap.org`, **et un joker CSP ne couvre
pas le domaine nu**. Les deux hôtes y figurent maintenant.

> **Ce que je ne sais pas, et que je n'affirme pas :** si la PRODUCTION est
> bloquée elle aussi. Je n'ai aucune mesure depuis l'hébergeur. Ce qui est
> certain, c'est que la machine de développement l'est.
>
> **Arbitrage ouvert, pour Thomas :** le fournisseur de tuiles. OSM demande aux
> usages soutenus de passer par un fournisseur dédié. Retirer le `{s}` va dans le
> sens de leur politique mais **ne prouve pas** que le blocage soit levé. Les
> options sont : vérifier depuis la production, souscrire un fournisseur de
> tuiles, ou héberger les siennes. C'est un choix de coût et de dépendance, donc
> le sien.

### Les grands rayons — mesurés et posés le 18/09

« Grands rayons » est l'un des cinq mots du vocabulaire de V8 (§10), au même titre
que les pilules et le sourire de la marque. Le §4 le chiffre : **24 px en mobile,
36 px en desktop**. Trois mesures, et la troisième est un défaut *visible*.

**① Le jeton ne servait presque à rien.** `var(--radius-card)` n'apparaissait
**qu'une fois** dans toute la feuille. La chaîne `--radius-card` → `--radius` →
`.card` existait, mais **quatre** redéfinitions directes de `--radius` la
coupaient.

**② Tout rendait en dessous de la charte.**

| | avant, desktop | avant, mobile | charte |
|---|---|---|---|
| `.card` | 22 px | 16 px | **36 / 24** |
| `.panel` | 18 px | 16 px | 36 / 24 |
| `.op-kpi` | 18 px | 14 px | 36 / 24 |

**③ Le jeton valait 22 px en clair et 8 px en sombre.** Les deux déclarations qui
gagnaient étaient préfixées `:root[data-color-scheme="light"]` ; en sombre plus
rien ne s'appliquait et le jeton retombait sur le `8px` de `:root`. **Huit cartes
du tableau de bord passaient d'arrondies à presque carrées selon le mode.**

> ⚠ **Quatrième occurrence de la même forme**, après les onglets, l'accordéon et
> les textes indicatifs : *une règle juste, scopée à un seul mode*. Ni un repli,
> ni un rayon, ni un texte indicatif n'est une propriété thématique. Quand une
> règle porte `[data-color-scheme="light"]`, la question à poser est : **« et en
> sombre, qui s'applique ? »** — la réponse est souvent « personne ».

Le correctif est un bloc **non scopé**, en fin de feuille :
`:root[data-color-scheme]` pèse autant que `:root[data-color-scheme="light"]`
(0,1,1) mais s'applique aux **deux** modes, et l'ordre tranche l'égalité. *La
spécificité seule ne suffisait pas, l'ordre seul non plus.*

Un seul écart a résisté : `#journee > .panel` porte un **ID**, donc (1,1,1), et
battait mécaniquement le bloc à (0,2,1). Surenchérir en spécificité aurait masqué
le problème — c'est là que le `18px` en dur était la déviation, et c'est là qu'il
a été remplacé par le jeton.

Le « 24 à 36 » est lu comme un **palier à 921 px** (breakpoint déjà présent dans la
feuille) et non comme une interpolation fluide : *un palier se mesure, une
interpolation se discute.* `test/e2e/rayons.spec.js` échoue si une carte s'en
écarte de plus d'1 px, **et si le jeton diffère entre les deux modes** — la
seconde assertion n'est pas redondante : deux modes peuvent être justes par deux
chemins différents, et le prochain qui touche à l'un casse l'autre.

*Après : 20 cartes, 0 hors charte, dans les deux modes et les deux vues.*

### ⬜ Ce que la charte demande et que le code ne fait pas encore — la typographie

Mesure du 18/09, et c'est le plus large des écarts restants.

Le §3 dit : « **Poppins** 400 / 500 / 600 / 700 […] en production la police est
auto-hébergée (`font-src 'self'`) ». Le code déclare
`font-family: Inter, "Segoe UI", Arial` et **ne charge aucune police** : zéro
fichier `.woff`/`.ttf` dans le dépôt, zéro `@font-face`, zéro lien Google Fonts.
Ni Poppins ni Inter n'étant installées sur une machine ordinaire, **tout
s'affiche dans la police système**.

La CSP est déjà prête (`font-src 'self' data:`) : c'est le contenu qui manque.

> ⚠ **Ce n'est pas un détail cosmétique.** Les hauteurs de ligne, les hauteurs de
> rangée (64–72 px), les troncatures et la couverture des glyphes ont **toutes**
> été mesurées dans une police qui n'est pas la bonne. Poser Poppins **déplacera
> ces mesures**, et il faudra les refaire — pas les relire.

### Le motif d'un arrêt en échec — et une ligne de cette charte qui était fausse

**La charte se trompait, et c'est la mesure qui l'a dit.** Le §9 annonçait « un
arrêt en "problème" n'enregistre aucune raison […] un champ neuf est à créer ».
Le champ `stop.problemReason` **existait**. La conclusion était juste, la cause ne
l'était pas — et c'est la cause qui dit quoi faire.

Le défaut réel tenait en trois points, tous mesurés le 18/09 :

**① Il était écrit une fois et lu nulle part.** Une seule écriture dans
`server.js`, **zéro** lecture — ni serveur, ni client, ni HTML. *Un mécanisme
soigné et branché sur personne est plus trompeur qu'un mécanisme absent : on le
trouve en cherchant, donc on conclut qu'il marche.*

**② Le livreur ne pouvait rien dire.** `updateCurrentDeliveryStatus` envoyait
`{ status }` et rien d'autre. Aucun écran ne demandait de raison.

**③ Ce qu'il enregistrait n'était pas une raison.** Faute de notes envoyées, il
retombait sur `stop.notes` — c'est-à-dire sur les **instructions de livraison de
la commande**, recopiées par `createStop`. Marquer un problème sur une commande
portant « Code portail 1234 » archivait « Code portail 1234 » **comme cause du
problème**.

#### Ce qui a été posé

Les deux champs sont séparés pour de bon : `notes` reste l'instruction de
livraison et **survit** (elle sert à la prochaine tournée), `problemReason` ne se
remplit **que** de ce que le livreur a dit. Une clé `problemReasonKey` est
archivée à part : *c'est elle qui se compte, pas la phrase.*

| Motif | s'applique à |
|---|---|
| Personne sur place | absent · problème · à reprogrammer |
| Adresse introuvable | problème · à reprogrammer |
| Accès impossible (portail, code, étage) | problème · à reprogrammer |
| Établissement fermé | absent · problème · à reprogrammer |
| Commande refusée | problème · à reprogrammer |
| Produit manquant ou abîmé | problème · à reprogrammer |
| Autre | absent · problème · à reprogrammer |

> **Pourquoi une liste fermée plutôt qu'un champ libre seul.** Un champ libre se
> remplit de « rien », « rappeler », « cf tel » — et le relevé devient
> inexploitable au moment même où on en aurait besoin (relances, recommandes).
> **Un motif nommé se compte ; un commentaire, non.** Le texte libre reste, mais
> *en plus* d'un motif, jamais à sa place.
>
> **Ces sept-là sont un choix de vocabulaire métier, pas une vérité.** Ils
> viennent du terrain de cette tournée — EHPAD, SSIAD, cliniques — et non d'une
> liste générique. Ils se changent en une ligne : rien d'autre dans le code ne
> dépend de ces libellés. **À revoir avec Tom.**

Un motif inconnu, ou qui ne va pas avec le statut (« Commande refusée » sur un
« absent » : il n'y avait personne pour refuser), est **refusé en 400** et ne
laisse aucun effet de bord. La liste est servie par `GET /api/delivery-problems`
et jamais recopiée dans le client : *deux listes dérivent, et l'écart ne se
verrait qu'au premier refus, sur le téléphone d'un livreur.*

Et la cause voyage dans l'**historique** : c'est le seul endroit où une tournée
passée se relit, et un statut sans sa cause n'y apprend rien.

#### Une interface neuve échappait à tous les balayages

Le dialogue du motif est un `<dialog>` : **fermé**, il n'a ni surface ni glyphe.
Les balayages de contraste et de cibles tactiles parcourent les quinze onglets et
ne l'auraient **jamais** jugé — la même forme de défaut que celles fermées plus
haut, un zéro qui ne distingue rien. `test/e2e/motif-dialogue.spec.js` l'ouvre et
lui applique les mêmes seuils : **4,5:1**, **44 px**, un état qui ne voyage jamais
par la seule couleur, et *il rend la main* (un modal qui ne se ferme pas rend
l'arrière-plan inerte pour de bon).

> ⚠ **Règle générale à retenir pour la phase 4 :** toute interface qui n'est pas
> visible à l'état de repos — dialogue, feuille, menu, infobulle — **est hors de
> portée des balayages** et a besoin de son propre banc. Sinon elle naît non
> conforme et personne ne le voit.

*Bancs : 9 au niveau de l'API (vrai serveur, base ensemencée), 6 sur la source du
client, 5 sur le dialogue ouvert. **7 mutations, 7 tuées par le cas prévu.***

### La page de connexion — le seul écran que rien ne regardait

Elle est le **premier** écran, elle porte environ 300 lignes de CSS *inline dans
`server.js`*, hors du système de jetons v8, et **aucun balayage ne l'avait jamais
vue** — ni contraste, ni cibles tactiles, ni rayons.

**Pourquoi elle était hors de portée, et comment la première sonde a menti.** Le
serveur des bancs e2e tourne *sans authentification* — c'est la seule façon
d'atteindre les quinze onglets. Mais alors `GET /login` répond **200 en servant
l'application**. Une sonde pointée dessus a donc mesuré l'app en croyant mesurer
la connexion, et elle n'a été prise que parce qu'on imprimait l'**URL finale** :

```
LOGIN light statut=200 url=http://127.0.0.1:3100/     <- pas /login
```

> **Un contrôle négatif a trois causes** : ce n'est pas là · je ne vois pas ·
> **je regarde ailleurs**. Ici c'était la troisième, et le `200` la rendait
> rassurante. Le banc exige désormais l'URL finale **et** la présence d'un champ
> de mot de passe avant de juger quoi que ce soit.

La configuration Playwright déclare maintenant **deux serveurs** : celui sans
authentification pour l'application, et un second, authentifié, qui existe pour
cette page seule.

| Mesuré le 18/09 | résultat |
|---|---|
| contraste, clair et sombre | 13 zones, 11 jugées, **0 défaut** |
| 2 zones non jugées | un champ vide, et un élément déclaré transparent — *rien à mesurer*, et non *du texte invisible* |
| cibles tactiles | **1 défaut** : le lien de version faisait **16 px** de haut |

Ce lien (`<a>` vers les releases GitHub) passait sous le plancher **légal** de
24 px, pas seulement sous nos 44. Il tient désormais 44 px par un rembourrage
compensé de marges négatives : la cible grandit, la mise en page ne bouge pas.

*La page est saine. Le banc existe pour qu'elle le reste — parce que rien d'autre
ne la regarde.*

### L'anneau de focus clavier — et un commentaire qui a tenu lieu de mesure

**Le défaut.** La feuille portait vingt-deux règles `:focus-visible`, avec **six
traitements différents**. Relevé du banc en mode clair, sur 14 contrôles :

```
5 controles SANS AUCUN indicateur visible
6 anneaux sous le seuil, entre 1,14 et 1,19
```

Le mode sombre, lui, passait — 14 jugés, 0 défaut.

> ⛔ **Et le commentaire du code citait le critère.**
> *« Focus clavier OPAQUE (WCAG 2.4.11/1.4.11 >= 3:1) […] bien visible sur fond
> sombre »* — écrit au-dessus d'une règle qui rendait **2,40**. La phrase
> contenait même l'aveu : *« sur fond **sombre** »*. Personne n'a lu ça comme
> « le clair n'a pas été mesuré », parce que **citer un critère suffit à ce que
> personne ne le remesure**.

#### Pourquoi deux tons, et non une couleur mieux choisie

Balayage de l'espace des couleurs contre les surfaces réelles :

| | résultat |
|---|---|
| mode clair | **31** couleurs seulement tiennent 3:1 sur les cinq surfaces — toutes quasi noires |
| mode sombre | **aucune** couleur unique ne tient : il y a toujours une surface où elle tombe |

> Un ton unique est donc **impossible**, ce n'est pas une préférence. Deux tons
> opposés contrastent **entre eux à 18,46**, quelle que soit la page derrière :
> l'indicateur reste percevable **sans avoir à énumérer les fonds possibles**.

#### Trois causes distinctes, trois remèdes

**① Une couleur en dur battait le jeton.** `outline: 3px solid #0e6b63` rendait
**1,19** sur le vert de la barre. Remplacé par `var(--v8-focus)` **à la source**,
et non par une surenchère de spécificité.

**② `overflow: hidden` DÉCOUPAIT l'anneau.** Cinq entêtes de section ne rendaient
**aucun pixel** d'indicateur — alors que `getComputedStyle` annonçait
« blanc, 3 px ». Le conteneur de l'accordéon a `overflow: hidden`, nécessaire au
repli, et l'anneau dessiné à 2 px *à l'extérieur* tombait hors cadre. Remède : un
**décalage négatif**, l'anneau se dessine à l'intérieur.

> ⭐ C'est la raison pour laquelle ce banc **photographie** au lieu de lire les
> déclarations : le style était juste et **rien n'était peint**.

**③ Un halo à 34 % d'alpha** portait seul l'indicateur pour deux contrôles.
Rendu opaque, en deux tons.

#### ⚠ Un faux négatif de harnais, et il m'a fait révoquer un remède juste

La mutation de ③ a d'abord **survécu**, et j'en ai conclu que le changement
n'était distingué par personne — donc qu'il ne devait pas avoir lieu. Je l'ai
révoqué. La révocation, elle, a fait tomber **deux cas**.

Cause : le jeton `--focus-ring` est déclaré **deux fois**, et ma mutation n'en
remplaçait **qu'une** (`str.replace(v, n, 1)`). L'autre continuait de fournir un
anneau.

> ⛔ **Une mutation qui ne change qu'UNE déclaration sur N équivalentes ne mute
> pas la RÈGLE : elle mesure la redondance.** Un faux négatif de harnais coûte
> exactement ce que coûte un faux vert — ici, il a failli faire supprimer une
> correction nécessaire au nom de la rigueur.

*Après : 14 contrôles jugés, **0 sans indicateur, 0 défaut**, dans les deux modes.
Trois mutations, trois tuées — 6, 5 et 2 défauts respectivement.*

### La police de la charte, posée le 18/09 — et les onze textes qu'elle a coupés

Le §3 prescrit **Poppins**, auto-hébergée. Le code déclarait
`font-family: Inter, "Segoe UI", Arial` et **ne chargeait aucune police** : zéro
fichier, zéro `@font-face`, zéro lien distant. Ni Poppins ni Inter n'étant
installées sur une machine ordinaire, **tout s'affichait dans la police
système**. *La charte décrivait un écran que personne n'avait jamais vu.*

| | |
|---|---|
| ce qui est posé | 4 graisses × 2 alphabets (`latin`, `latin-ext`), **76 Ko** licence comprise |
| licence | SIL OFL 1.1, jointe dans `public/fonts/OFL.txt` — la redistribution l'exige |
| chargement | `font-display: swap` : le texte s'affiche tout de suite dans le repli, puis bascule |

#### ⛔ Deux témoins évidents qui ne valaient rien

**`document.fonts.check("400 16px Poppins")` rend `true`** sur une page où
**zéro** face Poppins est enregistrée. Mesuré avant tout ajout.

**Comparer la largeur de `"Poppins"` au repli déclaré** ne vaut rien non plus :
sans la police, le navigateur résout « Poppins » vers **sa** police par défaut,
qui n'est pas `"Segoe UI", system-ui`. Les largeurs différaient déjà — 863,8
contre 915,61 — et ce témoin **passait au vert sur une page sans police**.

> ⭐ **Le témoin sain : comparer à une famille GARANTIE ABSENTE.** Les deux
> retombent alors sur exactement la même police par défaut. Largeurs égales →
> non chargée ; différentes → elle rend vraiment. C'est la seule construction où
> le vert ne peut pas venir d'ailleurs.

#### Ce que la police a déplacé — causé, et non révélé

Poppins rend **18 % plus large** que ce qui rendait avant. Mesure d'attribution,
faite **avant** de corriger quoi que ce soit :

| | desktop | mobile |
|---|---|---|
| sans Poppins | **0** coupure | **0** coupure |
| avec Poppins | **6** | **5** |

> La distinction compte : **révéler se documente, causer se répare.** Ces onze
> coupures sont à ce lot.

**① Le libellé de navigation** demandait 169 px dans une boîte de 156. La charte
le chiffre pourtant — *« 13-14,5 px, 500 »* — et le code était à **14,08 px en
graisse 850**. Revenir à la charte sur les deux axes suffit :
`169 × (13/14,08) × (188,84/192,05) = 153,4 < 156`.

**② Le résumé du tableau de bord**, à 390 px : deux colonnes → 141 px par carte,
105 utiles — et « Commandes » **seul** en demande 108. *Ce n'est pas un mot à
couper, c'est une colonne de trop.* Une seule colonne sous 430 px.

#### ⛔ Une hypothèse écartée par la mesure, avant de toucher 55 lignes

La feuille déclare des graisses **hors charte** : 650, 750, 760, 800, 820, 850,
880, 900, 920, 930, 950 — **55 déclarations**. J'ai cru qu'elles étaient
*synthétisées* par le navigateur, donc plus larges, donc coupables :

```
400 -> 187,11    500 -> 188,84    600 -> 190,31
650 a 950 -> 192,05 px, TOUTES IDENTIQUES
```

**Aucune synthèse.** Au-delà de 600, tout retombe sur la face 700. Ces graisses
restent une non-conformité au §3 — qui n'en déclare que quatre — mais elles ne
coupent **rien**, et elles n'ont pas été touchées. *Cinquante-cinq lignes non
modifiées parce qu'une mesure a contredit une intuition plausible.*

#### ⚠ Ce que la police ne corrigera PAS, et il faut le savoir

Les SVG de marque portent du **texte vivant** (`font-family="Segoe UI, Arial"`,
et `"Arial Black"` pour la barre latérale). Mesuré : sans Segoe UI, le mot-marque
« SEREO » passe de **231,1 à 279,5 px** (+21 %), et le « s » de la marque de
22,2 à 28,1 (+27 %). Pas de débordement du `viewBox`, mais un dessin **visiblement
différent** sur Mac, Linux et Android — donc sur la plupart des téléphones.

> ⛔ **Auto-héberger Poppins n'y change rien**, et c'est mesuré : ces SVG sont
> chargés en `<img src>` et en `url()` CSS. Dans ce mode un SVG **ne peut charger
> aucune ressource externe**, `@font-face` compris. La seule issue reste la
> **vectorisation** (texte → tracés), qui demande un outil de fontes absent de
> cette machine. *Écrit ici pour épargner la tentative au suivant.*

*Bancs : `typographie.spec.js` (2 cas) et `texte-coupe.spec.js` (2 cas, 1 130
textes jugés). Trois mutations, trois tuées — 6 coupures, 5 coupures, et la
police absente.*

### Les trois oranges — soldés le 18/09, sauf un, et il est nommé

Mesure préalable, distance euclidienne en sRGB contre `--v8-accent` (`#EF9177`) :

| | distance | verdict |
|---|---|---|
| `#ef8f77` | **2** | imperceptible |
| `#f18c79` | **6** | imperceptible |
| `#f47a5a` | **37** | **visiblement autre** |

*Deux sont un pur nettoyage sans risque visuel. La troisième demandait d'être
regardée cas par cas — et elle l'a été.*

**`#ef8f77`** — marque, fond de barre latérale, favicon, générateur d'icônes :
quatre fichiers, passés à l'accent.

**`#f47a5a`** — deux endroits, deux sorts différents :
- la règle de focus qui le posait **ne peignait plus rien** depuis le lot
  précédent (elle pèse (0,1,1) contre (0,2,1)). Elle est retirée **avec son
  commentaire**, qui citait *« WCAG 2.4.11/1.4.11 >= 3:1 »* au-dessus d'une valeur
  qui rendait **2,40**. ⛔ *Une ligne morte qui affirme le contraire de la mesure
  est pire qu'une ligne absente : on la croit.*
- sur la page de connexion, il colorait les icônes de `.brand-features`, qui sont
  **doublées d'un mot** — donc exemptées de 1.4.11. Passé à l'accent.

#### ⛔ `--warning` reste tel quel, et ce n'est pas un oubli

| | |
|---|---|
| déclarations | **cinq** |
| valeurs distinctes | **cinq** : `#f1a447`, `#ed9d72` (×2), `var(--v8-accent)`, `#f18c79` |

Deux d'entre elles sont des **ambres**, pas le corail. Ce n'est donc pas
« un troisième orange » : c'est une **famille entière qui a dérivé**.

> Et le brancher sur `--v8-accent` serait **sémantiquement faux** : la charte
> porte un rôle **avertissement** dédié (`--v8-avertissement` `#9A5A18` texte,
> `--v8-avertissement-fond` `#FFF1D8` fond). Y brancher `--warning` changerait un
> fond orange en crème pâle — visible — et **tout texte posé dessus serait à
> remesurer**. C'est un lot à part, avec sa propre mesure.

*Nommé dans le code, à l'endroit exact, plutôt que fait à moitié.*

#### ⚠ Un piège de rédaction, payé une fois

Le bloc CSS de la page de connexion vit dans un **littéral de gabarit
JavaScript**. Un **backtick** dans un commentaire CSS y **termine la chaîne** :
la première rédaction a produit un
`SyntaxError: missing ) after argument list` **à deux cents lignes de là**.
*Le message n'accuse pas l'endroit fautif.*

#### ⚪ Ce qui reste, mesuré et non promis

**26 couleurs littérales dans des propriétés** de `style.css` (contre 190 dans
des déclarations de jetons, qui sont légitimes — c'est là que les couleurs
vivent). Les plus nombreuses : `#ffffff` ×14 en `background`. **Aucun garde ne
le vérifie aujourd'hui.** Chiffre posé ici pour qui reprendra.

### La FORME du §4, posée le 18/09 — l'interface ressemble enfin à ce qui a été décidé

Jusqu'ici les bancs tenaient la **qualité** : contraste, cibles, focus, coupures,
police. Aucun ne tenait la **forme**. Une interface peut être parfaitement
conforme et ne pas ressembler au dessin. C'était l'état, et la mesure le disait :

| composant | charte | mesuré avant |
|---|---|---|
| Boutons | pilules, 48 mobile / 44 desktop | **rayon 9 px**, 44 partout |
| Champs | 48 px, rayon 18 | 46 px, rayon 14 |
| Barre latérale | **258 px**, angle droit **36** | **276 px**, angle **0** |
| Sheets | 28 px | 36 et 24 |
| Barre basse | `blur(20px) saturate(180%)` | `blur(6px) saturate(110%)` |

*Après : 7 cas sur 7, dans les deux vues.*

#### ⛔ Trois erreurs de ma part, toutes prises par la mesure

**① Une variable d'état sans remise à zéro.** Pour relever les planchers de
bouton à l'intérieur des `@media` étroites, j'ai suivi le `max-width` avec une
variable… jamais réinitialisée à la fermeture du bloc. **Quatorze règles
relevées, dont neuf hors media** — des boutons desktop poussés à 48 là où la
charte dit 44, et **aucun banc ne pouvait le voir** : ils ne vérifient qu'un
plancher. Refait avec un vrai comptage d'accolades.

> *Une variable d'état sans sa remise à zéro est un `if` toujours vrai.*

**② Une règle posée sans son `@media`.** J'ai écrit `width: 258px` sur la barre
latérale **sans condition**. En mobile elle est passée de 390 px (pleine largeur)
à 258, laissant **132 px au contenu**. Le mot était pourtant dans la ligne de la
charte : « barre latérale **desktop** ». *Je ne l'avais pas lu.*

**③ Un préalable deviné au lieu d'être mesuré.** Le banc exigeait `> 2` champs
mesurés ; en mobile l'enveloppe de recherche de la barre latérale est masquée et
il n'en reste que **2**. Un préalable trop haut transforme une mesure juste en
faux rouge.

#### Ce que la cascade a encore appris

Huit règles se disputaient la hauteur d'un bouton, dont
`@media (max-width: 700px) […] #refreshButton` — un **sélecteur d'ID**, (1,3,1).
Le banc a rendu la **liste complète** des règles qui touchent l'élément, avec
leur valeur ; il a suffi d'aligner la spécificité **exactement** sur les deux qui
gagnaient.

> ⭐ **`@media` n'ajoute aucune spécificité.** C'est écrit dans cette charte
> depuis le 17/09, et c'est la **cinquième fois** que ça décide d'un correctif.

#### Le libellé de navigation passe à la ligne, et c'était le seul levier restant

Rétrécir la barre à 258 px a coupé « Commandes planifiées » de **15 px**. Les
trois autres leviers étaient fermés, et c'est mesuré : la taille était déjà au
**bas** de la fourchette (13 px sur 13–14,5), la graisse déjà à **500**, et
`-0,02 em` sur 20 caractères ne rend que **5,2 px** sur les 15 manquants.

Restait l'ellipse ou le retour à la ligne. *L'ellipse perd de l'information en
silence ; le retour à la ligne n'en perd aucune*, et le « 64–72 px » de la charte
vise les **lignes de liste**, pas les items de navigation.

*Bancs : `charte-composants.spec.js`, 7 cas. Trois mutations, trois tuées.
405 unitaires + 75 e2e.*

### Les deux derniers ecarts mesurables du §4 — et les trois qui ne le sont pas

**Le toast durait 3,5 s** là où la charte dit **4**. Un écart de 0,5 s que
personne n'avait vu — *personne ne chronomètre un toast*. La durée est désormais
une constante nommée, `TOAST_DUREE_MS`, donc mesurable depuis un banc.

> ⚠ **L'erreur reste jusqu'au clic, et c'est un écart DÉLIBÉRÉ.** La charte dit
> 4 s sans distinguer les types ; faire disparaître une erreur toute seule ferait
> perdre l'information à qui regardait ailleurs. Le banc l'exige dans **ce**
> sens-là, et refuserait qu'on la rende éphémère.

**Les pilules de filtre avaient des coins carrés.** Hauteur conforme (44 desktop,
48 mobile), mais **rayon 8** alors que le mot de la charte est « pilules ». Le
banc a nommé l'adversaire : `:root[data-color-scheme="light"] .compact` à
**(0,3,0)**, contre ma règle à (0,2,0) — *la spécificité l'emporte sur l'ordre,
toujours*, même en fin de feuille.

#### ⚪ Ce qui restait NON MESURABLE le 18/09 — et ce qu'il en est le 19/09

| règle | 18/09 | 19/09 |
|---|---|---|
| **Ligne de liste 64–72 px** | listes vides, `POST /api/clients` rend 404 | **mesurée** sur un serveur semé — voir ci-dessous. *Pour les arrêts.* Les commandes et les abonnements sont encore des cartes |
| **Marqueur de carte** | aucun marqueur sans client géolocalisé | **mesurée**, même serveur — et un bug de cadrage trouvé au passage |
| **« repliables plutôt que débordantes »** | un **comportement**, pas une forme | toujours non jugée |

*Un non-jugé n'est pas une conformité. Il en reste un.*

### Le marqueur et la ligne d'arrêt, posés le 19/09 — deux règles qu'on ne pouvait pas juger à vide

Les deux règles étaient **non jugées** faute de données : rien ne se dessine
sans client géolocalisé. Le banc lève désormais son propre serveur, semé de six
clients autour de Besançon et d'une tournée en cours qui porte les états
d'arrêt (`test/e2e/serveur-seme.js`). *Rien n'écrit dans l'application réelle.*

| composant | charte / planche | mesuré avant | après |
|---|---|---|---|
| Ligne d'arrêt, desktop | 64–72 px | **126–151 px** | 64 ×6 |
| Ligne d'arrêt, mobile | 64–72 px | **184–209 px** | 64 (titre sur une ligne), 75 (sur deux) |
| Informations par ligne | quatre au plus | 3 à 4, plus deux boutons | quatre, exactement |
| Marqueur | corps vert, numéro blanc, halo orange | **`circleMarker` rayon 9, quatre couleurs V7, sans numéro** | trois états de la planche + un |
| Tracé | orange (planche) | `#2b7062` plein / `#2563eb` pointillé | accent 4,5 px / principal pointillé |
| Badge d'arrêt « prêt » | **« Prêt »** (§4, statuts d'arrêt) | « Prêt livraison » | « Prêt » |

#### D'où venaient les 120 px de trop

Deux boutons **↑ ↓ de 60 px rendus désactivés** sur chaque ligne d'une tournée
en cours — on ne réordonne plus une tournée démarrée, mais les boutons restaient
là, morts. Et une pilule étirée sur toute la largeur. Les flèches ne sont plus
rendues que quand la tournée se réordonne (statut « prête »), en boutons de
44 px.

#### La planche dit plus que la phrase de la charte

« Corps vert, numéro blanc, halo orange » comprime trois états de `Carte.png` :
**fait** (coche blanche sur vert), **en cours** (numéro blanc sur vert, anneau
orange 3,5 px, halo qui bat), **à venir** (numéro vert sur blanc, contour). Le
contour « à venir » est en **principal**, pas en vert d'eau comme sur la
planche : la charte l'avait corrigé le 17/09 (1,62:1 sur le fond de carte) et
la planche, elle, n'a pas été reprise. *Deux sources, une règle : celle qui a été
mesurée l'emporte.*

Un **quatrième état** n'est sur aucune des deux : l'arrêt **en échec** (absent,
problème). Je l'ai pris sur la planche `Preparation.png` — disque pêche claire,
point d'exclamation en alerte, la ligne « Bloquée ». C'est une **interprétation**,
et elle est nommée comme telle.

Le même composant `.marqueur` sert la carte et la ligne : le disque d'état à
gauche de la ligne **est** le marqueur. Anneau et halo sont deux couches d'une
`box-shadow` — peinte sous le fond, sans pseudo-élément ni contexte d'empilement
à négocier. La coche est en bordures tournées : Poppins n'a pas de U+2713 et le
glyphe de repli changeait selon l'appareil.

#### Un bug trouvé par la mesure, pas par une plainte

Les premiers marqueurs mesurés étaient à **±100 000 px** du cadre. `fitBounds`
tournait au chargement des données, pendant que l'onglet était masqué —
conteneur de 0 × 0, zoom poussé à 19 sur un centre arbitraire. Et
`invalidateSize()`, appelé à l'ouverture de l'onglet, rend sa taille à la carte
mais **ne recadre pas**. Reproduit dans les deux chemins (arrivée directe sur
`#livreur`, bascule depuis l'accueil). **La carte du livreur ne montrait jamais
la tournée.** `renderMap` refuse maintenant un conteneur sans taille, et
l'ouverture de l'onglet redessine. Le banc tient les deux chemins.

> *Un mécanisme appelé au bon moment sur un objet qui n'a pas encore de taille
> produit un résultat plausible et faux. Personne ne l'avait signalé : une
> carte vide ressemble à une carte sans données.*

#### Ce que le banc tolère, et le dit

Un titre sur **deux lignes** fait 75 px en mobile, hors des 64–72. La planche
elle-même fait 88 px dans ce cas. Le banc l'accepte jusqu'à 96 et **compte ces
lignes à part** au lieu de les déclarer conformes : 5 titres sur 6 passent à
deux lignes à 390 px — c'est le nom des clients, pas la ligne.

La ligne de détail est « ville · n articles », comme la planche, et non
l'adresse complète coupée par une ellipse dès le premier mot de trop.
L'adresse vit dans le panneau de l'arrêt en cours et dans la bulle du
marqueur. La ville reprend sa cédille à l'affichage (`formatSectorLabel`) : le
serveur la canonise **sans** — c'est une clé de secteur, pas un libellé.

*Banc : `carte-et-lignes.spec.js`, 6 cas. Quatre mutations (cadrage, tracé,
bloc CSS de la ligne, anneau de l'arrêt en cours), quatre tuées pour la bonne
cause. 405 unitaires.*

#### ⛔ Ce que ce lot ne fait PAS

La ligne de liste est tenue pour les **arrêts**. Les **commandes** (préparation :
colonnes de cartes à ~12 informations et 4 boutons ; bons de commande : cartes
et tableau) et les **abonnements** (cartes à ~9 informations) restent des cartes.
Les passer en lignes déplace leurs actions dans un détail : c'est un redessin,
pas un réglage, et il vient après.

## 10. Guide pour l'agent

- Toujours produire les deux modes (clair et sombre) avec les mêmes tokens ; lister les contrastes calculés.
- Toujours produire mobile 390 × 844 et desktop 1440 × 900.
- Réutiliser le vocabulaire des six planches jointes (`design/maquettes-v8/captures/*.png`) : pilules, grands rayons, sourire de la marque, une ligne par commande, trois gestes sous le pouce.
- Données réelles plutôt que du faux texte : secteurs Besançon / Champagnole / Dole ; clients de démonstration EHPAD Les Tilleuls du Val de Loue, SSIAD de la Haute Vallée, Clinique Vétérinaire ; produits changes molletonnés taille L, alèses ; numéros de commande `CMD-2026-001`.
- Le résultat sera codé à la main en HTML, CSS et JavaScript natifs, sans framework : composants simples, tokens en variables CSS, aucune bibliothèque d'animation.

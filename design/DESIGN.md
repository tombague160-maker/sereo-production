# DESIGN.md — Séréo V8

Charte de l'application Séréo, écrite pour un agent de design (Claude Design)
et pour l'implémentation en phase 4. Les valeurs viennent du site
groupe-sereo.fr et des six planches du 2 septembre 2026
(`design/maquettes-v8/`), dont les contrastes ont été mesurés. Elles font
autorité sur les couleurs de `public/js/config/themes.js`, qui avaient dérivé.

> ⚠️ **Deux corpus de planches, et le plus petit avait fait autorité.**
> `design/maquettes-v8/` contient **six** planches ; l'export Claude Design
> `design/export-v8/sereo-v8-export-2026-09-17-passation.html` en contient
> **quarante-neuf**, dont les **quatorze écrans desktop** et une planche de
> passation. Tout ce qui a été implémenté jusqu'au 19/09 l'a été d'après les
> six — c'est pourquoi l'application ne ressemblait pas aux planches. Devant
> un désaccord entre les deux corpus, **c'est l'export qui tranche**, et
> devant un désaccord entre une planche et le composant qu'elle importe,
> **c'est le composant** : il est partagé par les douze écrans desktop, la
> copie inline d'une planche ne l'est pas.

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
| Carte de tournée | `#386B6D` | Le fond de la carte « Tournée du jour » du tableau de bord (planches 6a/6b). **Un rôle, pas une couleur** : en clair il vaut le principal, en sombre la surface haute — la carte tenue sur `--v8-principal` devenait menthe en sombre | texte dessus **6,01:1** |
| Texte sur carte de tournée | `#FFFFFF` | Le texte de cette carte | **6,01:1** |
| Secondaire sur carte de tournée | `#D6E5E3` | Le texte secondaire de cette carte. **Rien ne se pose dessous** : la marge est de 0,13 | **4,63:1** |
| Surface sur vert | `#2A5254` | La surface secondaire **posée sur le vert** (pastille de statut, piste de progression). La passation le tranche : « on teinte en sombre, pas en clair », et opaque — aucune couleur composée | blanc dessus **8,63:1** · accent dessus **3,69:1** |
| Accent de donnée | `#E8643F` | L'accent, quand il **porte une donnée** sur fond clair (la barre du mois courant). Même teinte (13°) et même saturation que l'accent, clarté descendue à 0,58 : l'accent pur n'y donne que 2,34:1, sous les 3:1 d'un objet graphique porteur de sens | sur blanc **3,32:1** · sur le fond **3,12:1** |

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
| Pêche claire | `#3A2A28` | Fond de badge tiède. Texte **11,87**, principal **7,54**. Valeur relevée dans l'export : elle y figure 23 fois, l'ancienne jamais |
| Vert clair | `#1D3B3C` | Fond de badge froid. Texte **10,50**, secondaire **6,49**, principal **6,67**. Valeur relevée dans l'export : elle y figure 47 fois, l'ancienne jamais |
| Texte | `#E6F2EE` | **16,09** fond · **14,27** surface · **12,42** surface haute |
| Texte secondaire | `#A8C4BE` | **9,94** fond · **8,82** surface · **7,67** surface haute |
| Texte sur principal | `#0D1518` | **10,22** |
| Texte secondaire sur principal | `#0D1518` | même valeur : sur `#93CBC9`, le sombre est le seul texte qui tienne |
| Avertissement | `#FFD0AA` | **13,06** fond · **11,59** surface · **12,19** surface basse |
| Fond d'avertissement | `#775841` | Le plus **clair** qui tienne 4,5 sous `#FFD0AA` (**4,56**) : il reste un badge, pas un trou noir |
| Alerte | `#F2635A` | Le rouge d'alerte, éclairci jusqu'à tenir 4,5 sur la surface la plus dure : **5,90** fond · **5,23** surface · **4,55** surface haute. `#C02B0A` ne donne que 3,16 sur le fond sombre. Valeur relevée dans l'export : elle y figure 48 fois, l'ancienne jamais |
| Anneau de focus | `#E6F2EE` | 14,27 sur la surface, 16,09 sur le fond |
| Second ton du focus | `#0D1518` | Les deux tons s'échangent entre les modes |
| Carte de tournée | `#182E31` | La surface haute, comme la planche 6b la dessine — pas le principal menthe |
| Texte sur carte de tournée | `#E6F2EE` | **12,42** sur la carte |
| Secondaire sur carte de tournée | `#A8C4BE` | **7,67** sur la carte |
| Surface sur vert | `#243F42` | Texte dessus **9,81** · accent dessus **5,53** |
| Accent de donnée | `#F5A08F` | L'accent tel quel : **8,04** sur la surface, rien à assombrir |

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
| **Ligne de liste 64–72 px** | listes vides, `POST /api/clients` rend 404 | **mesurée** sur un serveur semé — voir ci-dessous. Pour les **trois** listes de la charte : arrêts, commandes à préparer, abonnements |
| **Marqueur de carte** | aucun marqueur sans client géolocalisé | **mesurée**, même serveur — et un bug de cadrage trouvé au passage |
| **« repliables plutôt que débordantes »** | un **comportement**, pas une forme | **mesurée** le 19/09 — voir ci-dessous |

*Les trois sont mesurées. Il ne reste aucun non-jugé dans le §4.*

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
| Tracé | orange (planche) | `#2b7062` plein / `#2563eb` pointillé | accent 4,5 px / principal pointillé — **7 px depuis le 23/09** |
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

### L'écran du livreur, posé le 19/09 — la planche `Main.png`, enfin

C'est l'écran le plus regardé de l'application, et le seul qui compte sur la
route. Il n'existait pas : la page « Livraison » commençait par la
**planification** (départ, arrivée, filtres, quatre boutons), l'arrêt en cours
arrivait après deux panneaux, avec **huit boutons de même poids** sur deux
rangées de quatre, et « Google Maps » là où la planche dit « Itinéraire ».

| élément | planche | avant | après |
|---|---|---|---|
| Ordre de la page | l'arrêt d'abord | planification, candidats, **puis** l'arrêt | l'arrêt, la liste, la carte, puis la planification **repliée** |
| En-tête | jour, nom, « 3 sur 8 », barre | un chip « 3/6 - En livraison » | jour, nom de tournée, anneau « 3 sur 6 », barre à la part des arrêts terminés |
| État de l'arrêt | ● + mot | « Statut : En livraison · Secteur : … » | point en accent + « Arrêt en cours » en principal |
| Articles | quantité en disque, titre « n articles à décharger » | « 3x Changes taille L » | disque `.marqueur--plein`, boîte pêche claire |
| Gestes | Appeler · Itinéraire / **Livraison validée** / Client absent · Problème | 8 boutons identiques | trois poids ; le reste derrière « Autres actions » |
| Légende de carte | — | bleu · orange · vert · rouge (V7) | les quatre états du marqueur |

*Bancs : `ecran-livreur.spec.js`, 4 cas — mobile, desktop, sans tournée,
et la planification qui ne se referme pas sous les doigts du livreur.*

#### Où la charte l'emporte sur la planche, et où la planche l'emporte

- **Le mot d'état est en principal, pas en orange.** La planche écrit « ARRÊT
  EN COURS » en accent ; la charte l'interdit en texte (2,34:1 sur blanc). Le
  point reste en accent — c'est une forme.
- **Les boutons gardent 48 / 44** *(au téléphone, remplacé le 23/09 : « Livré », « Y aller »
  et leurs deux ronds font 56 — voir « Tournée mobile »)*. La planche fait « Livraison validée » à
  62 px et « Appeler » à 56. La charte dit 48 mobile, 44 desktop, et c'est ce
  que les bancs tiennent depuis le 18/09. Le geste principal se distingue par
  son poids (plein, ombre portée, 17 px), pas par sa hauteur.
- **Un troisième poids de bouton**, absent de la charte jusqu'ici : `tertiary`,
  surface basse + texte secondaire (4,56:1), ni contour ni ombre. C'est ce que
  la planche dessine pour « Client absent » et « Problème » : présents, sans
  réclamer.
- **La planification se replie au changement de statut, jamais autrement.**
  Un `<details>` que le JS ne touche qu'au passage prête → en livraison. Si le
  livreur l'ouvre pendant la tournée, un rafraîchissement ne la referme pas —
  mesuré.

#### ⛔ Deux pièges pris par la mesure

**Une ancienne règle mobile faisait passer la carte devant l'en-tête.**
`.current-driver-card { order: -1 }` — l'ancienne tentative de hisser l'arrêt
en haut de page — agissait maintenant *dans* la grille de l'en-tête. L'en-tête
se rendait à 892 px du haut, sous la carte. Remis à `order: 0`.

**`display` de classe écrase l'attribut `hidden`.** `.tournee-depart { display:
flex }` rendait « Démarrer la tournée » visible sur une tournée en cours, malgré
`hidden = true`. Le cas est nommé dans le CSS : `.tournee[hidden],
.tournee-depart[hidden] { display: none }`.

Et un troisième, dans le banc : **`offsetParent` ne voit pas un `<details>`
fermé.** Chrome replie son contenu par `content-visibility: hidden`, et les
éléments y gardent un `offsetParent`. `checkVisibility()` le voit. Le premier
rouge accusait le code ; c'était l'instrument.

### Une ligne par commande, posée le 19/09 — la planche `Preparation.png`

Le guide de cette charte range « une ligne par commande » parmi les cinq mots
du vocabulaire de V8. La préparation était **quatre colonnes de cartes** à
~12 informations et quatre commandes chacune (date, trois boutons), avec quatre
« Rien ici » pour les colonnes vides, un `<select>` de secteur là où la charte
dit pilules, et une légende aux pastilles V7.

| élément | planche | avant | après |
|---|---|---|---|
| Une commande | une ligne : disque d'état, nom, « ville · n articles », badge | une carte à ~12 informations et 4 commandes | une ligne de **64 px** (75 si le nom passe à deux lignes), quatre informations |
| Une bloquée | « Il manque 2 articles » en alerte, à la place du détail | « Stock : insuffisant » parmi 12 lignes | « Il manque 1 article », en alerte, à la place du détail |
| Les actions | dans le détail, que la ligne ouvre | sur chaque carte | dans un **sheet** (coins 28, poignée, `<dialog>` natif) : adresse, date, stock, trois actions |
| Secteurs | pilules | `<select>` | pilules 44 / 48, `aria-pressed` |
| Résumé | anneau + « 2 commandes prêtes · 3 restantes · 68 articles » | quatre tuiles | un anneau à la part des prêtes, une ligne |
| Colonnes vides | — | quatre « Rien ici » | une section vide ne s'affiche pas |

*Bancs : `preparation-lignes.spec.js`, 5 cas — lignes ×2 vues, sheet mobile
(Échap, ✕), sheet desktop, et l'action « Passer en préparation » depuis le
sheet, qui ferme le sheet et change le mot de la ligne. Quatre mutations,
quatre tuées pour la bonne cause.*

#### Les mots du badge : ceux de l'ÉTAPE, pas ceux du statut

La charte §4 liste les statuts de commande (Importée · À vérifier · En
préparation · …). La planche écrit sur le badge le mot de l'**étape** de
préparation : **À faire · En cours · Prête · Bloquée**. Ce sont deux choses :
« Importée » et « À vérifier » sont toutes deux « À faire » pour qui prépare.
Le badge de la ligne porte le mot de la planche ; le statut reste dans le
détail. *Nommé ici pour que personne ne prenne l'un pour une dérive de l'autre.*

#### ⛔ Trois adversaires nommés par la mesure

- **`@media (max-width: 560px) :root[data-color-scheme="light"] .button {
  width: 100% }`** (0,3,0) étirait chaque pilule de secteur sur toute la
  largeur, en colonne. Une pilule de filtre n'est pas un bouton de formulaire :
  `.button.compact.filtre-pilule` à (0,4,0). Le même adversaire étirait le ✕
  du sheet.
- **Le bloc des grands rayons posait déjà `:root[data-color-scheme] .sheet`**
  à 28 px sur les quatre coins — un `.sheet` écrit avant qu'un sheet n'existe.
  En mobile les coins bas sont droits (il colle à l'écran) : même spécificité,
  après.
- **Le serveur recalcule `canPrepare` depuis le stock** : un drapeau semé
  `canPrepare: false` était écrasé et la commande « bloquée » du banc passait
  pour « à faire ». Le semé porte maintenant un produit à stock zéro — on ne
  sème pas une conclusion, on sème sa cause.

#### Et les abonnements, le même jour — la troisième liste de la charte

Des cartes à ~9 informations (avatar, nom, ville, chip, panier, quatre faits,
deux boutons) en colonnes de 330 px. Après : **la même ligne** que les commandes
— disque d'état (actif ✓ · en pause ‖ · arrêté ○), nom, « ville · fréquence »,
badge — et un sheet pour les quatre faits, le panier, « Modifier » et « Mettre
en pause / Réactiver ». « Modifier » ferme le sheet avant d'ouvrir l'éditeur :
jamais deux dialogues empilés. `abonnements-lignes.spec.js`, 3 cas.

*Les trois lignes de liste de la charte (§4 : « commande, abonnement, arrêt »)
sont tenues et mesurées, sur les mêmes composants.*

### Le tableau de bord, posé le 19/09 — la sixième et dernière planche

Deux choses de `TableauDeBord.png` manquaient. La **carte « Tournée du jour »** :
fond vert, « 3 arrêts sur 8 », la barre, le prochain arrêt, et le seul geste qui
compte depuis cet écran — *ouvrir la carte*. Et les **listes du tableau de bord**,
qui étaient des rangées à elles seules alors que la planche y montre **les mêmes
lignes** que la préparation.

| élément | avant | après |
|---|---|---|
| Tournée du jour | *absente* | carte verte : statut, « 3 arrêts sur 6 », barre aux arrêts **terminés**, prochain arrêt, distance |
| « À livrer » | un panneau toujours là | cède sa colonne à la tournée quand il y en a une ; revient sinon |
| Listes | `.op-order-row` (nom, produits, chip) | la ligne partagée : disque d'état, nom, produits, badge |
| Titre | « À préparer » | « À préparer aujourd'hui », le mot de la planche |
| Sans tournée | — | la carte **ne s'affiche pas** : une carte vide dirait « c'est cassé » là où la vérité est « il n'y en a pas » |

Le bouton « Ouvrir la carte » est **blanc sur le vert** — la charte §4 le dit
(« sur fond vert = fond blanc texte vert ») — et fait 44 / 48.

*Banc : `tableau-de-bord.spec.js`, 4 cas.*

#### ⛔ Le harnais a trouvé ce que le banc ne distinguait pas

Quatre mutations, et **deux ont d'abord SURVÉCU** :

**① Une mutation qui mesurait une redondance.** J'avais écrit *deux* règles pour
la même couleur — une sur le `<p>`, une sur ses enfants. Retirer la première ne
changeait rien : la seconde peignait déjà. *Une mutation qui change une des N
déclarations équivalentes ne mute pas la règle, elle mesure la redondance.* Les
deux règles fusionnées en une, la mutation mord.

**② Un banc qui ne pouvait rien distinguer.** La barre suit les arrêts
**terminés** ; la mutation la faisait suivre le **rang** de l'arrêt courant.
Dans le semé les deux valaient **3** — même pourcentage, banc vert, mutation
vivante. Le banc se donne maintenant un semé où les deux diffèrent (4 terminés,
rang 3 → 67 % et non 50 %).

> *Un banc vert sur une mutation n'accuse pas toujours le banc : il faut
> d'abord demander si les données pouvaient faire varier le résultat.*

Et un troisième, dans le harnais lui-même : après avoir corrigé le semé, le
filtre cherchait encore `"50%"`, la valeur d'avant. Il rapportait « tuée mais
autre cause » sur une mutation tuée pour **exactement** la bonne. *Un filtre de
harnais se périme avec la valeur qu'il cite.*

#### Les six planches sont posées

`Main` · `Carte` · `Preparation` · `NavMobile` · `NavDesktop` · `TableauDeBord`.

### « Repliables plutôt que débordantes » — le dernier non-jugé, clos le 19/09

La règle attendait des données : avec trois secteurs, une rangée de pilules ne
déborde jamais. Avec **dix**, mesure du 19/09 : **cinq rangs, 272 px** sur un
écran de 844 — *un tiers de l'écran pour des filtres*. Elle ne débordait pas
horizontalement (elle passe à la ligne), mais elle n'était pas **repliable**
non plus. C'est exactement ce que le mot de la charte vise.

| état | mobile (390) | desktop (1440) |
|---|---|---|
| Replié | **104 px** (2 rangs) | **96 px** (2 rangs) |
| Déplié (29 pilules) | 608 px | 148 px |
| Bouton | paraît | paraît |
| Avec 3 secteurs | *rien ne dépasse* → **pas de bouton** | idem |

Le bouton n'apparaît **que si la rangée dépasse vraiment** : c'est mesuré dans
la page (`scrollHeight` contre `clientHeight`), jamais déduit du nombre de
secteurs — la largeur d'un libellé décide autant que leur compte.

Et le secteur **choisi passe en tête**, juste après « Tous » : replié à deux
rangs, un filtre actif relégué au cinquième rang disparaîtrait. *On ne cache
jamais ce que l'utilisateur a choisi.*

#### ⛔ Ce que le harnais a trouvé, encore

Quatre mutations, **deux survivantes** au premier tour.

**① Un plafond invisible faute de données.** Retirer le `max-height` de base
(desktop) ne changeait rien : onze pilules tiennent de toute façon en deux
rangs à 1440 px. Le banc ne pouvait pas distinguer. Il se donne maintenant
**vingt-huit** secteurs — assez pour déborder **dans les deux vues**.

> *Un plafond ne se mesure que sur des données qui le touchent.*

**② Une garde qui ne s'exécutait jamais.** J'avais écrit un repli
« si le filtre actif tombe hors du plafond, déplier ». Après un choix, la
rangée était **déjà** dépliée : la garde ne servait jamais, et la mutation qui
l'enlevait survivait. Remplacée par le **tri** — le secteur choisi passe en
tête. Plus simple, et le banc l'éprouve : choisir le dernier secteur, replier,
vérifier qu'il est en position 1 et visible.

Au passage, un défaut d'origine pris par la mesure : **`offsetTop` se mesure
contre l'ancêtre *positionné*, pas contre le conteneur.** Le conteneur étant en
position statique, la garde lisait un nombre bien plus grand et se déclenchait
**toujours** — la rangée arrivait dépliée. Les rectangles, eux, sont dans le
même repère.

Et deux fois de suite, le **filtre du harnais** citait des valeurs périmées
(`"50%"`, puis `104` là où la vue desktop rend `96`) : il rapportait « tuée
mais autre cause » sur des mutations tuées pour exactement la bonne. *Un filtre
de harnais se périme avec la valeur qu'il cite — le relire fait partie du
verdict.*

### La barre latérale, posée le 19/09 — et le corpus de planches qu'on avait ignoré

Thomas a mis une capture de l'application à côté de l'export Claude Design et
posé la question juste : *« ça ne ressemble pas vraiment à ce que l'on avait
décidé comme planches »*. Il avait raison, et la cause n'était pas un retard
d'exécution : **on implémentait depuis le mauvais corpus**. Six planches
(`maquettes-v8/`) au lieu de quarante-neuf (`export-v8/`).

**Ce que l'export dit, et qui se mesure sans rien interpréter.** Un élément
repliable ne peut pas exister sans `aria-expanded` : la question « y a-t-il un
dépliant dans les planches ? » se tranche donc par un comptage, pas par une
lecture de maquette.

| | `aria-expanded` | `nav-section` |
|---|---|---|
| Les 49 planches de l'export | **0** | **0** |
| L'application, avant ce lot | 8 | 55 |

La planche de passation l'écrit en toutes lettres : *« **Nav desktop à huit
entrées**, sans dépliant sous Commandes : les cinq listes fusionnent en une.
Paramètres par l'engrenage. »*

**La source exacte.** Le composant « Barre latérale » a été extrait du
manifeste gzip de l'export, pas relevé à l'œil : c'est lui que les **douze**
planches desktop importent, et il déclare `actif ∈ {Tableau de bord,
Commandes, Préparation, Tournée, Abonnements, Stock, Clients, Analyse}`.
Toutes les valeurs posées dans `style.css` en sont copiées — 258 px de large,
coins `0 36px 36px 0`, entrées de 48 px en pilule, champ de 44 px, bloc compte
de rayon 24, et les deux jeux de couleurs `CLAIR` / `SOMBRE`.

**Contrastes recalculés sur ces deux jeux : 23 cas sur 24 tiennent leur
seuil.** Le vingt-quatrième est le mot-marque, `#EF9177` sur `#386B6D` =
**2,57:1**, sous les 3:1 du texte large. Ce n'est pas un manquement : WCAG 2.1
SC 1.4.3 exempte nommément *« le texte qui fait partie d'un logo ou d'un nom
de marque »*. L'exemption est écrite dans la feuille **et** dans le banc, avec
son chiffre, pour qu'un futur audit sache qu'elle a été mesurée et non subie.
En sombre le même couple donne 6,99:1.

**Huit entrées pour seize écrans.** Le risque que crée la fusion est précis :
un écran qui existe encore mais que plus rien n'ouvre. Les écrans qu'une
entrée absorbe reparaissent en **pilules** sous le titre de page, et
`GROUPES_NAV` (dans `config/tabs.js`, auprès de `mainTabs`) vérifie **au
chargement du module** qu'aucun onglet n'est orphelin ni inventé. Le banc
`tabs.spec.js` suit la chaîne entière — cliquer les huit entrées, cliquer
chaque pilule qu'elles font apparaître, exiger que l'union couvre les seize.

**Trois choses que ce lot a apprises, et qui valent au-delà de lui.**

1. **Un garde textuel accuse sa propre prose.** Trois fois de suite, un
   `assert` du genre `"nav-section" not in fichier` s'est déclenché sur le
   *commentaire* qui expliquait la suppression. Un garde doit mesurer la forme
   appelable (`X(`), la structure, le sélecteur — jamais le mot.

2. **Un préambule qui prépare le vide ne dit rien.** Neuf bancs ouvraient
   l'accordéon avant de mesurer. La ligne a continué de s'exécuter sans rien
   trouver. Pire : cinq bancs se donnaient leur liste d'écrans en comptant les
   **boutons** de la barre. Tant qu'il y avait un bouton par écran, cela
   revenait au même ; depuis la planche, ils ne parcouraient plus que **huit
   écrans sur seize**, en silence. La liste se prend désormais à sa source,
   `mainTabs`. La couverture de `contraste-application` est passée de 8 à
   **16 écrans, 648 textes en clair et 670 en sombre**.

3. **Une purge hérite de ce que les règles supprimées gardaient.** La feuille
   portait 728 surcharges `data-color-scheme="light"`, la barre y ayant été
   redéfinie **quatre fois**. Ajouter une cinquième couche aurait reproduit la
   cause : 121 règles ont été supprimées et 19 allégées, soit −21,5 ko. Mais
   l'une d'elles masquait `.sidebar-visual`, et le décor orange est revenu à
   l'écran — **qu'aucun banc n'a vu**, l'élément portant `aria-hidden` et ne
   contenant aucun texte. Il a été retiré du balisage : un élément dont la
   seule raison d'être est d'être invisible n'en a pas.

**Ce que la couverture retrouvée a révélé, et qui n'était pas de ce lot.**

- `.item-header` : `justify-content: space-between` ne dit pas *qui* cède la
  place. La colonne de texte s'écrasait à **80 px** sous des actions
  incompressibles ; dans Paramètres, « Champagnole » débordait de 39 px et se
  posait sur la pilule voisine, où le banc de contraste lisait 1,41:1 sur un
  fond qui n'était pas le sien. **Mesuré sur l'arbre d'avant le lot
  (`c9ad1ce`) : 39 px, boîte de 80 px** — le défaut préexistait, il était
  seulement hors de portée des bancs.

- **Deux défauts de l'instrument de contraste, tous deux dans le sens de
  l'alarme.** ① `color: transparent` s'applique **en fondu** sur les éléments
  qui déclarent une transition : à l'instant de la capture « sans texte », le
  bouton mesuré gardait **89,8 % d'opacité**, et le texte figurait donc dans
  les deux images. ② Le banc échantillonnait la boîte de l'**élément** : pour
  un bouton en pilule, les coins de cette boîte tombent hors de la forme
  peinte et laissent voir la carte. **17 pixels du coin supérieur gauche, soit
  2,8 % des pixels retenus** — au-dessus du seuil de population écrit contre
  ce cas — suffisaient à faire conclure *1,05:1* sur un texte qui tient
  largement son seuil. Corrigé en figeant les transitions et en
  échantillonnant la boîte du **texte** (un `Range` sur le contenu), ce que
  l'en-tête du banc promettait déjà de mesurer. Un faux positif coûte plus
  cher qu'un faux négatif : il a la forme exacte d'un vrai défaut et pousse à
  « corriger » du code sain.

**Un écart assumé avec la planche, et un seul.** La ligne de version y est un
texte de 24 px ; ici c'est un **bouton** — il ouvre les nouveautés. Une cible
cliquable doit mesurer 44 px (WCAG 2.5.5), d'où la hauteur minimale.

**Ce qui n'est pas branché, et qui est nommé plutôt que deviné.** La planche
montre une pastille sur *Abonnements*. Le compte correspondant vit dans le
module Operations et n'est pas lisible depuis `renderStats` : la pastille
reste absente. Un nombre faux coûte plus cher qu'un nombre absent.

**Reste à faire :** les quatorze écrans desktop de l'export (6a, 6b, 13a–f,
14a–f). Le tableau de bord 6a vient en premier, et il n'a pas de `topbar` —
celle qui existe aujourd'hui appartient à ce lot-là, pas à celui-ci.

### Le tableau de bord des planches 6a/6b, posé le 22/09 — et la barre du haut qui n'existait pas

**Mesure qui a tout déclenché** : sur les quatorze planches desktop de l'export,
**aucune** ne porte de barre du haut — zéro « Recherche rapide », zéro bouton
« Actualiser » hors de la barre latérale. Chaque écran commence par son propre
titre, dans la colonne, et défile avec elle. La `topbar` est donc remplacée par un
**en-tête d'écran** (titre 30 px / 700, sous-titre 15,5 px) qui porte une fente,
`#enteteActions`, où chaque écran dépose ses propres commandes (`data-ecran`).
Ce qui reste, parce que ce sont des fonctions et pas des ornements : l'état de
synchronisation et l'actualisation. Ce qui part pour de bon : la recherche
globale, qui doublait celle de la barre latérale.

**La grille de la planche** : douze colonnes, gap 24 ; la colonne large alterne,
7 + 5 puis 5 + 7. Carte « Chiffre d'affaires livré » avec son histogramme de huit
mois ; deux tuiles chiffrées ; la carte de tournée ; « À régler » ; « Cette
semaine ». Toutes les valeurs sont copiées des styles en ligne de 6a/6b.

**Trois écarts avec la planche, chacun un défaut mesuré de la planche elle-même** :

| Élément | Planche | Mesure | Posé |
|---|---|---|---|
| Barre du mois courant | accent `#EF9177` sur blanc | **2,34:1**, sous les 3:1 d'un objet graphique porteur de sens — la passation rejette le vert d'eau à 1,88 pour ce motif exact | `--v8-accent-donnee` `#E8643F` : même teinte, même saturation, clarté 0,58 → **3,32:1** ; l'étiquette du mois passe en gras, le sens ne tient pas qu'à la couleur |
| Piste de progression | blanc à 22 % sur le vert, composé `#648C8D` | accent dessus **1,58:1** : rempli et vide indiscernables | `--v8-surface-sur-vert` `#2A5254` opaque → **3,69:1**, la règle même que la passation énonce |
| Carte de tournée en sombre | `#182E31` | le CSS la tenait sur `--v8-principal`, qui vaut `#93CBC9` en sombre : un bloc menthe à texte noir | `--v8-carte-tournee` et ses deux textes : **un rôle n'est pas une couleur** |

**Ce que la planche ne dessine pas et qui reste** : les listes « à préparer / à
livrer » (règle « une ligne par commande » du §4), les chiffres d'abonnements, le
résumé du jour et les imports Excel. Une maquette qui ne dessine pas une fonction
ne décide pas de la supprimer. Les listes et les chiffres passent sous un dépliant
fermé, « Détail du jour » ; `renderDashboard()` lit seize identifiants **sans
garde**, et en retirer un interromprait tout le rendu.

**Deux dérives de la palette, soldées le même jour.** ① Trois jetons sombres ne
figuraient nulle part dans l'export : `#4A302B` → `#3A2A28` (présent 23 fois dans
les planches), `#172B2D` → `#1D3B3C` (47 fois), `#F85E3C` → `#F2635A` (48 fois).
② Les cinq jetons de rôle du tableau de bord sont entrés dans le CSS **sans** être
portés à la charte ; `test/jetons-v8.test.js` est tombé, et c'est exactement ce
pour quoi il existe (« le compte est EXACT et non un minimum »). Ils sont portés
ci-dessus, en §2, avec leurs contrastes recalculés : 26 jetons, 48 paires.

**Ce que les bancs ont appris** :
- un dépliant **fermé** n'affiche pas son contenu ; le banc de contraste le comptait
  comme un texte « invisible ». Il l'ignore désormais — 633 textes mesurés en
  clair, 634 en sombre ;
- le banc des champs exigeait **deux** champs sur téléphone : la recherche de la
  barre du haut et le mois. La barre du haut est partie ; il en reste **un**. Un
  seuil qui cite un compte se périme avec lui ;
- le test de fumée attendait le titre « Tableau de bord », que la planche remplace
  par « Bonjour <identifiant> » dès que `/api/me` répond : il faisait la **course**
  contre l'API, vert ou rouge selon qui arrivait le premier ;
- sur téléphone, la pilule du mois était **écrasée à 32 px** de large — invisible au
  banc des champs, qui ignore justement ce qui fait moins de 40 px. Vue à l'œil.

**La relecture indépendante, avant publication — verdict « bloquant », à raison.**
Huit bancs neufs (`tableau-de-bord-relecture.spec.js`), **chacun lancé d'abord sur le
code fautif** : sept rougissaient pour leur propre raison, le huitième est un témoin
inverse. Deux constats méritent d'être retenus :
- **L'histogramme était plat.** `align-items: flex-end` empêchait les colonnes de
  s'étirer : huit barres à 6 px **quelles que soient les données**. La première
  capture le montrait, et je l'avais mis sur le compte d'une base de test sans
  chiffre d'affaires — explication plausible, jamais vérifiée. Le jeu semé a du
  chiffre sur le mois courant : une barre doit monter, et c'est ce que le banc exige.
- **« Importer les ventes » n'importait rien** : le bouton ouvrait le sélecteur, et
  le fichier choisi ne partait jamais, sans un mot. L'envoi n'est automatique que
  depuis ce bouton ; le formulaire du bas garde son geste (choisir, puis importer).

Et trois leçons d'instrument :
- deux bancs visaient encore `.topbar` : **verts sans avoir rien regardé**. Repointés sur
  l'en-tête d'écran, ils ont aussitôt trouvé un contrôle **sans anneau de focus** — le
  sélecteur de mois, dont j'avais retiré l'ombre qui portait l'anneau ;
- un banc de chevauchement comparait des **boîtes** : la boîte du montant se
  rétrécit (`min-width: 0`) et le texte déborde par-dessus sa voisine. Il compare
  désormais les **étendues de texte** ;
- un banc de cohérence (sous-titre contre tuile) passait **par hasard** : avec ces
  données, deux calculs différents tombaient sur le même nombre. Une commande « en
  préparation », que l'un compte et pas l'autre, le fait mordre.

« À régler » suit maintenant l'ordre d'urgence de la planche (abonnement en retard,
commande bloquée, livraison à reprendre, rupture, sous le seuil, adresse à
corriger) ; les commandes bloquées et les adresses manquaient. Une adresse n'est
signalée que sur une commande encore à faire : le serveur compte aussi les
commandes livrées, dont l'adresse ne servira plus.

**Relevé pour le lot mobile** (audit du 20/09) : la planche 1b donne au tableau de
bord mobile **son propre en-tête**, un bloc vert aux coins bas arrondis, et des
libellés de barre basse non abrégés (« Préparer », « Abonnements »). Hors de ce lot.

### Commandes des planches 13c/14c, posé le 22/09 — cinq listes, un tableau

La passation : « **les cinq listes fusionnent en une** ». Un seul écran, `#commandes` :
un tableau de six colonnes (Numéro, Date, Client, Secteur, Articles, Statut), des
pilules de **statut**, une case « Bloquées seulement », un tri, une recherche locale
qui va jusqu'au **produit** (l'ancienne ne cherchait que le numéro et le client),
l'export CSV du filtre courant, une pagination côté navigateur (la passation la
classe « inventée » faute de pagination serveur ; `/api/orders` rend tout, il suffit
de découper). Aucun travail serveur.

**Ce que la fusion ne devait pas perdre, et où c'est passé** :

| Ancien écran | Son geste | Aujourd'hui |
|---|---|---|
| Commandes du jour | envoyer en préparation, **par lot** | pilule « À envoyer » : une colonne de choix et le bouton « Envoyer en préparation » |
| Commandes planifiées | confirmer / annuler | le détail de la ligne (le modal existant) porte les deux boutons |
| Commandes livrées | le détail produit ligne à ligne | le détail de la ligne |
| Bons de commande | liste, recherche, export | le tableau lui-même |
| Commande client | **créer** une commande — le seul chemin de l'application | un écran secondaire, atteint par « Nouvelle commande » dans l'en-tête ; l'entrée Commandes reste allumée |

**Un écart avec la planche, qui comble un trou de la planche** : une septième pilule,
« À envoyer ». Le statut des commandes terrain (`commande_client_validee`) n'était sous
**aucune** des six pilules dessinées — et son geste n'avait plus de place.

**Les anciens identifiants ne meurent pas** : `#bons-commande`, `#commandes-jour`,
`#commandes-planifiees`, `#commandes-livrees` **redirigent** vers l'écran unique, filtré
comme l'ancien écran, et l'adresse est réécrite en `#commandes`. Un favori, un lien, un
`showTab("…")` codé en dur arrivent au bon endroit. La recherche du menu les trouve encore
sous leur ancien nom. `config/tabs.js` refuse de charger si une redirection vise un
écran absent.

Précédent / Suivant font 44 px et non 36 : la planche les invente, la charte exige 44.

**Trois outils de l'ancien écran que la planche ne dessine pas, gardés** (règle : ce qui
existe et n'est pas dessiné est gardé, dans l'idiome de la planche, et nommé) :

- le **jour** des commandes terrain, dans la barre « À envoyer » (aujourd'hui par défaut).
  Sans lui, « Tout sélectionner » envoyait aussi une commande d'un jour passé, gardée
  exprès. La barre reste visible même quand le jour est vide, parce que c'est elle qui
  permet d'en choisir un autre ;
- la case **« À compléter »** : adresse, téléphone ou secteur manquant, même règle que
  l'ancien écran (`bdcNeedsCompletion`). L'alerte « adresses à corriger » du tableau de
  bord y mène, par la redirection `#commandes-a-completer` ;
- la période **Du / Au**, qui borne la liste **et** l'export. Sans elle, on ne pouvait
  plus exporter un mois.

- le **secteur**, en pilule de sélection à côté du tri : sans lui, plus d'export par
  secteur.

La sélection ne garde que ce qui est à l'écran : une recherche ou un changement de jour
retire les commandes masquées, pour qu'aucune ne parte sans avoir été vue. « Tout
sélectionner » coche la **page** (« … sur la page » quand il y en a plusieurs).

La période borne la date de **commande**, comme l'ancien export et comme la colonne
« Date commande » du CSV — même pour une planifiée, dont la ligne montre la date de
livraison.

L'alerte « N adresses à corriger » du tableau de bord ouvre **exactement** son compte
(adresse ou ville manquante sur une commande ni livrée ni annulée), et la case se lit
alors « Adresses à corriger ». La case cochée à la main garde la règle plus large de
l'ancien écran.

Une redirection (une saisie qui renvoie vers « À envoyer », un ancien lien) arrive sur une
liste **propre** : « Bloquées seulement », la recherche, la période, le secteur et le jour
sont remis à zéro. Sinon la commande qu'on vient de saisir pouvait être cachée.

Le détail suit la commande **affichée** : « Modifier le profil » puis « Annuler » y revient,
au lieu de rouvrir la première commande du même client. Il prend le focus à l'ouverture et
le rend à la ligne à la fermeture ; cocher une ligne au clavier garde le focus sur la case.

**Dette nommée** : les anciennes sections (`#commandes-jour`, `#commandes-planifiees`,
`#bons-commande`, `#commandes-livrees`) restent dans la page, inatteignables, et se
dessinent encore. Les retirer touche leurs rendus et leurs bancs : un lot à part.

**Portées de rôles** (dormantes tant que `SEREO_SEPARATION_ROLES` n'est pas posé) : le
préparateur et le livreur nommaient les anciennes listes ; ils nomment maintenant
`commandes`, ce qui leur **élargit** la vue (toutes les commandes, y compris les gestes
des planifiées). Une liste unique ne se découpe plus par écran ; si la séparation revient,
c'est un filtre par rôle qu'il faudra, pas une liste d'écrans.

Les gestes d'une commande planifiée (Confirmer, Annuler) sont posés **hors** du corps
du détail, parce que « Modifier le profil » redessine ce corps. Un geste **ferme** le
détail, et « Annuler » demande confirmation.

### Stock des planches 13d/14d, posé le 23/09 — une carte, des tuiles, un tableau

La planche fusionne « Stock » et « À recommander » en **un** écran, sans pilule : la carte
« À recommander » (span 5), les tuiles de catégorie (span 7, trois colonnes), le tableau
(span 12 : Produit · catégorie, Code, Réservé « N sur commandes », Seuil, Stock, Ajuster
− / +). Le titre devient « Stock » ; la recherche « Produit ou code » (pilule 280 px) et
« Importer le stock » passent dans l'en-tête. Le bouton d'en-tête ouvre le sélecteur du
formulaire de l'accueil et **envoie** le fichier choisi : un mécanisme, deux chemins.

Règles posées là où la planche ne décide pas :

- le badge de la carte est **le même compte** que la pastille de la barre latérale
  (stock faible + rupture) ; la carte montre les cinq plus en retard sur leur seuil ;
- une tuile dit, en alerte, combien de ses produits sont sous le seuil, sinon son nombre
  de références ; son grand nombre reste neutre (la planche n'en donne aucune règle). La
  pastille alterne froide / tiède par position, comme la planche ;
- une tuile filtre le tableau, **la même tuile rappuyée rend tout** ; `aria-pressed` le dit ;
- au-delà de **douze** catégories, les tuiles deviennent des lignes (passation) ;
- les produits sans catégorie ont leur tuile, « Sans catégorie ».

**Gardés, hors planche** (règle : ce qui existe et n'est pas dessiné est gardé, dans
l'idiome de la planche, et nommé) :

- la **saisie directe** du stock et l'**édition du seuil**, dans les colonnes Stock et
  Seuil : des champs qui se lisent comme les valeurs de la planche et se révèlent au
  survol et au focus. Ce sont les seuls chemins de l'application pour les poser ;
- le **filtre de statut** (disponible, réservé, faible, rupture, à renseigner), en pilule
  au-dessus du tableau ;
- les **mouvements récents** ;
- l'écran **« À recommander »** détaillé (besoins estimés), devenu écran secondaire : le
  lien « Tout voir » de la carte y mène, et l'entrée Stock reste allumée.

**Écarts assumés** :

- pas de bouton « Commander » : aucune route ne commande à un fournisseur (les « bons de
  commande » de l'application sont des commandes clients) ;
- une seule icône de catégorie : les catégories sont libres, lues dans le fichier, et
  aucune table ne dit quel dessin va à quel nom. La planche en invente cinq ;
- pas de tuile d'aide : « Trois colonnes jusqu'à douze catégories ; au-delà, tableau »
  est une note de la charte, pas un contenu pour l'utilisateur ;
- le sous-titre ne dit pas « trouvées dans le dernier import » : rien ne rattache les
  catégories à un import ;
- les pas − / + font 36 px au bureau, 44 px au téléphone. Aucune planche mobile pour cet
  écran : sous **1280 px**, la ligne devient une carte à trois rangs, avec « Seuil » et
  « Stock » écrits devant leur champ (sans en-tête de colonnes, c'étaient deux nombres
  sans nom). Même chose pour la ligne des Commandes : entre 921 et 1280 px, les colonnes
  fixes (740 px au Stock, 766 aux Commandes) ne laissaient rien au nom.

« Sous le seuil » veut dire **quantité ≤ seuil**, partout : carte, pastille, écran « À
recommander » (qui recommande de repasser au-dessus du seuil). Une quantité inconnue
est « à renseigner », jamais une rupture. « Tout voir » ouvre la liste détaillée sur
« sous le seuil ». Vider le champ Stock ne met plus le produit à zéro.

### Clients des planches 13e/14e, posé le 23/09 — une liste, une fiche

Liste à gauche (5 fr), fiche à droite (7 fr). Titre « Clients », compte « N clients ·
N abonnés · N adresses à corriger ». Recherche « Nom, ville, téléphone » et « Nouveau
client » dans l'en-tête. Pilules : Tous, les secteurs trouvés chez les clients, Abonnés.

- **Ligne** : le nom, puis la ville et la **dernière livraison** (« livrée le 2 sept. »),
  calculée depuis les commandes livrées déjà chargées dans la page — la passation la
  classait « inventée, côté serveur » ; elle ne coûte rien côté navigateur. Une adresse
  qui ne se géocode pas (même prédicat que le serveur : une rue, et un code postal ou une
  ville) s'écrit en alerte « Adresse à corriger · ville ». Badge Abonné / En pause.
- **Fiche** : nom, puces (secteur, abonnement), Appeler (`tel:`), Modifier ; Adresse /
  Contact ; la carte d'abonnement (fréquence, « En retard », panier · rappel · échéance,
  « Créer la commande » sur la prochaine échéance **sans** commande) ; les quatre
  dernières commandes, « N depuis janvier », et « Les N autres », qui ouvre la liste des
  commandes cherchée sur ce client.

**Gardés, hors planche** :

- le **statut commercial** (prospect, actif, à relancer, inactif) : en sélection dans la
  fiche, et en filtre à côté des pilules (avec « relances du jour / en retard ») ;
- le **formulaire** de l'ancien écran, dans un dialogue : « Nouveau client » le vide,
  « Modifier » le pré-remplit — mêmes champs, mêmes noms, POST ou PATCH ;
- les **rappels commerciaux** : l'écran « Rappels » devient secondaire, atteint par
  « Rappels · N » dans l'en-tête (N = rappels à faire aujourd'hui ou en retard). La planche
  ne le dessine pas ; c'est le seul endroit où ils se créent et se ferment.

**Écarts assumés** : pas d'« interlocuteur » ni d'« instruction de livraison » (« Mme
Ferrand, cadre de santé », « entrée de service ») — le modèle client n'a pas ces champs ;
les notes, besoins et produits préférés s'affichent à leur place. Les pilules font
44 px (la planche : 40), la charte l'exige.

### Abonnements des planches 13a/14a, posé le 23/09 — un tableau, les 90 jours

**Au bureau** (≥ 921 px) : à gauche (7 colonnes), les pilules Tous / Actifs / En pause, le
tri « Prochaine livraison » ou « Client », et **une** carte-tableau : Client (nom et
panier « 3 changes molletonnés L, 2 alèses »), Fréquence, Prochaine (« Mer. 23 sept. », ou
« Échue le 12 sept. » en alerte), État. À droite (5 colonnes), **« Les 90 jours »** :
l'horizon que le serveur calcule déjà, groupé par semaine (« Semaine du 21 septembre ·
3 »), deux semaines visibles et « Les N semaines suivantes ». Chaque échéance porte son
geste (« Créer la commande », ou le statut de la commande déjà créée). Sous-titre :
« 6 actifs · 1 en pause · 2 échéances en retard ».

**Au téléphone** : la ligne de la charte ne change pas (disque d'état, nom, « ville ·
fréquence », badge) ; le détail s'ouvre toujours dans le sheet. Les planches mobiles 3a–3c
viendront avec le lot mobile.

**Remplacés** : le calendrier d'une semaine (et sa navigation) et « Rappels à traiter »
fusionnent dans « Les 90 jours » — la planche le décide. **Gardés** : la recherche (dans
l'en-tête), le sheet de détail et ses actions, l'éditeur.

**Écarts assumés** :

- pas d'opacité sur la ligne en pause (la planche : 0,78) — composée sur blanc, elle
  donnait **3,70:1** au nom et **3,29:1** au panier, sous le seuil ; le badge dit « En
  pause » ;
- « Arrêté », que la planche ne dessine pas, prend le badge neutre (surface basse) : sans
  le disque, il avait les couleurs d'« Actif » ;
- « Créer la commande » fait 44 px (la planche : 36) ;
- pas de « Depuis le 4 sept. » sur une ligne en pause : aucun champ ne date la pause ;
- la fréquence garde les libellés de l'application (« Toutes les 2 semaines ») plutôt que
  « Tous les 15 j » / « Mensuel » : un seul vocabulaire entre la ligne, le sheet et
  l'éditeur ;
- entre 921 et **1439 px**, l'agenda passe sous le tableau : au-dessus de 1280, sept colonnes
  sur douze moins 420 px de colonnes fixes ne laissaient qu'une dizaine de pixels au nom
  (la planche, à 1440, lui en donne 122).

**L'agenda s'ouvre sur le présent** : d'abord « En retard · N » (échu, sans commande), puis
« Cette semaine » et la suivante. Le serveur rend aussi les échéances passées depuis le
début de l'abonnement ; les grouper par semaine ouvrait l'agenda sur les plus anciennes.
Une échéance dont le rappel est arrivé le dit (« · rappel arrivé ») — la promesse « rappel
N jours avant » de l'éditeur reste tenue sans le panneau « Rappels à traiter ». Une
échéance déjà commandée montre le statut de sa commande, qui mène à Commandes.

« En retard » = échue **et sans commande**, partout : le sous-titre de l'écran et
l'alerte du tableau de bord comptent la même chose.

Le badge « En pause » prend le texte principal appuyé de la planche (**7,04:1**) au lieu
de l'avertissement (4,45:1, sous le seuil).

### Tournée des planches 13b/14b, posé le 23/09 — la carte à gauche

**Au bureau** (≥ 1181 px) : la grille « 60 / 40 » de la planche — la carte à gauche
(3 fr), pleine hauteur d'écran (une hauteur **explicite**, que Leaflet connaît au moment du
rendu) ; à droite (2 fr) l'arrêt en cours puis la liste des arrêts ; la planification et les
commandes prêtes dessous, pleine largeur. Sans tournée, la planification passe en tête.
Le **titre de page** est la tournée (« Tournée Besançon ») et le sous-titre son jour et son
avancement (« Mercredi 16 septembre · arrêt 3 sur 8 »). « Nouvelle tournée » (ouvre la
planification, repliée pendant la livraison) et « Recalculer le tracé » sont dans
l'en-tête. Sur la carte, ni titre ni légende. Sous 1181 px : l'écran du téléphone, empilé.

**Gardés, hors planche** : Appeler, Itinéraire, « Autres actions » (à reprogrammer,
planifier la suite, suivant) — ils existent et servent sur la route.

**Décisions du 19/09 maintenues contre la planche** (elles sont testées et datées) :

- les flèches de réordonnancement ne s'affichent que sur une tournée **prête**, pas sur
  une tournée qui roule (la planche les montre en livraison) ;
- ~~les marqueurs de carte gardent 34 / 28 px et le tracé 4,5 px (la planche : 44 et 7)~~ —
  **remplacé le 23/09** par la décision de Thomas : marqueurs de 44 px, tracé de 7 px (voir
  « Tournée mobile ») ;
- pas de distance par arrêt ni de « km restants » : la planche ne dit pas de quoi c'est la
  distance, et rien ne la calcule côté navigateur.

### Paramètres des planches 13f/14f, posé le 23/09 — une grille de cartes

La grille de la planche : **Thème**, **Secteurs**, **Numérotation des bons** (4 colonnes
chacune), puis **Comptes** et **Imports et archives** (6 colonnes). Le thème devient une
bascule à trois segments « Clair · Sombre · Système » (44 px, la planche : 40). Les
secteurs se montrent en pilules de nom. « Numérotation des bons » est **neuve à
l'écran** mais pas au serveur : `GET / PATCH /api/settings/order-numbering` existait
sans interface ; la carte montre le prochain numéro (« CMD-2026-001 »).

**Gardés, hors planche** (règle : ce qui existe et n'est pas dessiné est gardé, dans
l'idiome de la planche, et nommé) :

- le **logo**, dans la carte Thème, derrière « Logo de l'application » ;
- la **fiche de chaque secteur** (ville, jour, départ, fréquence) et son formulaire,
  derrière « Gérer les secteurs » ;
- le **tableau des comptes** complet (rôle, état, mot de passe, suppression) — la planche
  n'en montre qu'une ligne ;
- le **tableau des imports** et ses téléchargements ;
- les **réglages de tournée** (vitesse, durée d'arrêt) et le **diagnostic des dates**, en
  cartes de même forme ;
- la **zone dangereuse** : la planche la réduit à une incise ; une purge définitive garde
  son bloc, son contour d'alerte et sa liste de ce qui part et de ce qui reste.

**Retiré** : le bloc « Application mobile » (deux phrases statiques, aucun réglage).

**Écarts assumés** : Comptes et Imports prennent chacun **toute la largeur** (la planche :
côte à côte) — à demi-largeur, le tableau des comptes (cinq colonnes) cassait ses libellés
lettre par lettre, défaut déjà mesuré et corrigé une fois. « Prochain bon » affiche le
**vrai** prochain numéro, par la règle du serveur (le plus grand de ce préfixe — et de
cette année — plus un ; trois chiffres par année, cinq en compteur continu) : un
« CMD-2026-001 » d'exemple aurait promis un numéro que le serveur ne donnera jamais sur
une base qui a des commandes.

**Réserve nommée** : `GET / PATCH /api/settings/order-numbering` n'exige pas le rôle
d'administration ; la carte rend le réglage atteignable pour tout compte connecté.
Tant que la séparation des rôles est éteinte, tout le monde voit tout ; le jour où elle
s'allume, ce point est à fermer côté serveur.

### Connexion des planches 9b/9c/9d, posé le 23/09

Une carte centrée sur le fond de la charte et ses deux taches floues : la marque
(« séréo » et son sourire), la phrase « Livraison de matériel médical et d'hygiène, Doubs et
Jura. », Identifiant, Mot de passe (avec « afficher », qui n'apparaît que si le script
tourne), « Se connecter » ; dessous, « Mot de passe oublié : voir Tom. » et la version. Clair
et sombre suivent l'appareil (la page n'a pas encore le choix de l'utilisateur).
Un échec (9c) passe le champ **mot de passe** en contour d'alerte avec le message dessous,
relié au champ (`aria-describedby`), sans dire lequel des deux est faux ; le blocage (9d)
garde son compte à rebours. Les polices sont servies **avant** la session (`/fonts`).

**Écarts assumés** : « séréo » est au principal en clair (l'orange de la planche tombe à
2,34:1 sur blanc) et à l'orange en sombre (7:1) ; le sourire garde l'orange. Pas de case
« Rester connecté » : aucune option ne la porterait (la session dure 12 h pour tous). La
planche écrit « Un seul compte, partagé par l'équipe » : ce n'est plus vrai depuis les
comptes par personne, la phrase est retirée.

### Mobile, lot 1 — le cadre commun, posé le 23/09

Sous **820 px** (le seuil réel de la barre basse — pas 920) :

- **l'en-tête vert** de toutes les planches mobiles : le titre de l'écran (28 px), son
  compte, ses gestes, sur `--v8-carte-tournee`, coins bas de 28 px, collé à la barre de
  marque (gardée : elle existe, et porte le compte et le thème). Sur le vert, la règle de
  la charte : un bouton plein devient blanc à texte vert (plein clair en sombre), un bouton
  à contour prend le contour clair, les recherches la surface sur vert ;
- **la barre basse** de la planche : pleine largeur, posée au bord, libellés « Tableau de
  bord », « Préparer », « Tournée », « Abonnements », « Plus » ; l'onglet actif se dit par
  sa couleur, sans pastille. **Écart** : opaque, pas translucide à 74 % — le texte
  secondaire ne tient que 4,81:1 sur le fond plein, et toute transparence au-dessus d'un
  contenu vert le faisait tomber sous 4,5 ;
- **le menu « Plus »** : les cinq destinations de la passation — Commandes, Stock, Clients,
  Analyse, Paramètres. Les écrans secondaires s'ouvrent depuis leur écran. Stock n'y était
  pas : il n'avait **aucun** accès au téléphone ; un banc vérifie maintenant que chaque
  entrée de la barre latérale est atteignable à 390 px ;
- les marges de la charte : 16 px sur les côtés, dans les deux thèmes (les anciennes règles
  mobiles, écrites pour le clair seul, faisaient deux mises en page).

### États limites (planches 10b, 10c), posé le 23/09

- **Hors ligne** : un bandeau vert clair sous l'en-tête, « Hors ligne depuis 14 h 08 »
  (l'heure de l'événement ; « Hors ligne » seul après un rechargement fait hors ligne), et
  ce qui attend : « N modifications en attente d'envoi ». La file d'attente existe depuis la
  v1.31 — la passation, qui la disait inventée, est périmée sur ce point ; seul l'écran
  manquait. Le bandeau reste tant que des modifications attendent. « Modifications » et
  non « livraisons » : la file compte des écritures. Hors ligne, les **imports de
  fichiers** sont désactivés avec leur raison (« Import impossible hors ligne ») : ils ne
  se mettent jamais en file ; tout le reste continue et part au retour du réseau (la
  planche désactivait toutes les écritures — contraire à la file qui existe).
- **Premier lancement** : sans aucune commande, une carte « Commencez par importer vos
  ventes » remplace « À régler » et « Cette semaine », avec le bouton d'import.

Le chargement en blocs de la taille d'un chiffre (10b haut) et le Stock sans catégorie à
plat (10a) : posés le 23/09, voir « Commandes + Stock mobile + squelettes » en fin de fichier.

## 10. Guide pour l'agent

- Toujours produire les deux modes (clair et sombre) avec les mêmes tokens ; lister les contrastes calculés.
- Toujours produire mobile 390 × 844 et desktop 1440 × 900.
- Réutiliser le vocabulaire des six planches jointes (`design/maquettes-v8/captures/*.png`) : pilules, grands rayons, sourire de la marque, une ligne par commande, trois gestes sous le pouce.
- Données réelles plutôt que du faux texte : secteurs Besançon / Champagnole / Dole ; clients de démonstration EHPAD Les Tilleuls du Val de Loue, SSIAD de la Haute Vallée, Clinique Vétérinaire ; produits changes molletonnés taille L, alèses ; numéros de commande `CMD-2026-001`.
- Le résultat sera codé à la main en HTML, CSS et JavaScript natifs, sans framework : composants simples, tokens en variables CSS, aucune bibliothèque d'animation.

## Chargement instantané, posé le 23/09

But : le moins d'attente possible à l'ouverture. Aucune planche ne dessine ce lot ; il ne
change aucun écran, seulement **quand** ils se remplissent et ce que dit la pastille de
synchro (`#syncStatus`).

### Ce qui est posé

- **Fichiers statiques depuis le cache** (CSS, JS, polices, icônes, Leaflet) : le service
  worker répond depuis son cache puis revalide en arrière-plan (*stale-while-revalidate*).
  Shell renommé `sereo-shell-20260923-instantane`. `file-attente.js` (importé par `app.js`,
  absent de la liste) et les quatre graisses Poppins entrent dans la liste préchargée.
- **Dernières données connues tout de suite** : au premier chargement de la page, `app.js`
  lit le cache de données du service worker et dessine tout ce qu'il contient, **pendant**
  que le réseau part (il part d'abord ; lire le cache ne lui coûte rien). La pastille dit
  « Mise à jour… » jusqu'à la réponse, puis « À jour ». Relu seulement au premier
  chargement : après une écriture, relire la copie d'avant ferait reculer l'écran.
- **Une copie n'est jamais dite fraîche** : toute réponse que le service worker tire de son
  cache (réseau coupé ou plus lent que 3 s) porte l'en-tête `X-Sereo-Cache`. La pastille
  dit alors « Données de 14:32 » (« Données du 21/09 » si ce n'est pas le jour même) et
  jamais « À jour ». Avant ce lot, le repli sur le cache était annoncé « À jour ».
- **Polices préchargées** : `<link rel="preload">` des quatre graisses `poppins-{400,500,600,700}-latin.woff2`,
  les seules que le tableau de bord charge à 1440 et 390 px (mesuré ; aucune `latin-ext`).
- **La nouvelle version arrive** : au démarrage, le serveur calcule le nom du shell =
  `CACHE_NAME` de `service-worker.js` **suivi de l'empreinte du contenu** de `public/` et de
  Leaflet (`lib/empreinte-shell.js`, SHA-256 tronqué à 12). Il l'annonce dans l'en-tête
  `X-Sereo-Shell` de la page et sert `service-worker.js` avec ce nom à la place de
  `CACHE_NAME`. Un octet change dans `public/` : le nom change, le navigateur installe un
  nouveau service worker, et l'ancien, plus vieux que la page, sert CE chargement par le
  réseau (l'ancienne stratégie). Aucun bump à la main n'est requis (voir « Relecture
  adverse » plus bas).
- **Fin de session** : `POST /logout` vide le cache de données (dans le service worker, quelle
  que soit la page qui déconnecte) ; un 401 le vide aussi avant de renvoyer vers `/login`.

### Décisions prises

1. **`/api/operations` et `/api/subscriptions` entrent dans le cache de données.** Ils
   étaient exclus depuis le 16/09 sans raison écrite, et ils portent les chiffres du tableau
   de bord : sans eux, rien d'instantané. Justification : aucun des deux ne lit l'identité
   (comme `/api/orders`, déjà en cache) ; le défaut que l'exclusion évitait — une copie
   montrée comme fraîche — est tenu désormais par `X-Sereo-Cache`. `/api/me`,
   `/api/comptes`, `/api/version`, `/api/storage/status`, `/api/geocode` restent exclus.
2. **Le HTML reste servi par le réseau, jamais du cache.** C'est la requête de la page qui
   porte le contrôle de session : sans session, le serveur rend la page de connexion et
   l'application ne tourne pas, donc aucune donnée en cache ne s'affiche avant que le
   serveur ait reconnu quelqu'un. Le coût : l'application ne se rouvre toujours pas hors
   ligne (dette déjà nommée, inchangée).
3. **Tout ou rien** pour l'affichage immédiat : une copie partielle montrerait des listes
   vides qui ne le sont pas. Seule exception, les commandes du jour (leur URL porte la
   date : à la première ouverture du jour, elle manque ; elles gardent alors leur valeur).
4. **« Mise à jour… » et non un horodatage** pendant la mise à jour : elle dure moins d'une
   seconde en ligne. L'heure de la copie n'apparaît que si la copie **reste** affichée.
5. **Pas de *navigation preload*** : il aurait doublé la requête de `/login`, que le service
   worker laisse passer. Gain possible, à mesurer sur téléphone.

### Écarts nommés

- `X-Sereo-Shell` repose sur une mémoire du service worker : si le navigateur l'arrête entre
  la page et ses scripts (rare, quelques secondes), ce chargement-là retombe sur le cache
  d'abord, donc sur l'ancienne version une fois ; le chargement suivant a la nouvelle.
- L'empreinte est calculée **au démarrage** : un fichier de `public/` modifié à chaud, sans
  redémarrer le serveur, n'est pas vu (en production, chaque livraison redémarre le
  conteneur). Toute livraison qui touche `public/` réinstalle le shell complet chez chaque
  utilisateur (≈ 1 Mo, polices comprises), ce que faisait déjà un bump.
- Aucune déconnexion n'existe dans l'interface aujourd'hui (seulement la route `POST /logout`) ;
  le vidage est posé dans le service worker pour qu'il vaille pour tout futur bouton.

### Mesure, avant / après

Banc `test/e2e/chargement-instantane.spec.js`, test « mesure » : serveur semé, second
chargement à cache chaud, temps depuis le début de la navigation jusqu'au premier chiffre du
tableau de bord (`#opRevenue`), médiane de 5 (min–max), machine partagée par plusieurs
agents — les écarts absolus bougent, l'ordre de grandeur non.

| Réseau simulé sur l'API | Avant (main, 3 passes) | Après (ce lot, 3 passes) |
|---|---|---|
| aucun (localhost) | médianes 320, 245, 220 ms | médianes 277, 242, 269 ms |
| +300 ms par réponse | médianes 1 470, 1 435, 1 461 ms | médianes 223, 333, 208 ms |

Sur localhost, **aucun gain mesurable** : le réseau y est instantané, les deux colonnes
sont dans le bruit. Avec 300 ms par réponse (un téléphone en 4G moyenne), le premier chiffre
passe d'environ 1,45 s à environ 0,25 s : il ne dépend plus du réseau. Une première passe
« avant », machine plus chargée, avait donné 551 ms et 1 753 ms.

Pourquoi 1,45 s pour 300 ms de latence, avant : dix-sept appels sur six connexions HTTP/1.1
font trois vagues, et le chiffre attend la plus lente.

### Bancs

`test/e2e/chargement-instantane.spec.js` (port 3174 et un mandataire HTTP sur port libre,
qui sait retenir, retarder ou réécrire les réponses) : chiffres affichés avant le réseau
sous « Mise à jour… » · repli sur le cache jamais « À jour » · statique servi quand le réseau
se tait · nouveau shell dès le premier chargement · revalidation au chargement suivant ·
déconnexion et 401 vident le cache · polices préchargées = polices du premier rendu (mesurées
sur la même page **sans** ses préchargements).
`test/api.test.js` : la page annonce `X-Sereo-Shell` = le `CACHE_NAME` du service worker servi,
et seulement la page ; ce nom = `CACHE_NAME` du fichier + empreinte du contenu.
`test/empreinte-shell.test.js` : un octet modifié, un fichier ajouté ou renommé changent
l'empreinte ; un dossier absent ne fait pas échouer le démarrage.

### Relecture adverse, 23/09

1. **Livraison sans bump de `CACHE_NAME` — vrai, corrigé.** Le nom du shell ne changeait
   qu'à la main ; or 8 des 15 derniers commits de `main` touchant `public/js` ne touchent pas
   `service-worker.js` (ex. 19fa441 : nouvel export `GROUPES_NAV` importé par `app.js`, sans
   bump). Au premier chargement après une telle livraison, la page neuve (réseau) tournait sur
   l'`app.js` et le `style.css` de l'ancien cache. Décision : le nom est désormais dérivé du
   contenu par le serveur (voir « La nouvelle version arrive »), plutôt qu'un garde de CI qui
   exigerait le bump : un garde se contourne ou s'oublie, une empreinte ne demande aucun geste.
   L'ancienne phrase « une page neuve ne tourne jamais sur un vieux script » est vraie
   désormais, à l'exception nommée plus haut (service worker arrêté entre la page et ses
   fichiers).
2. **Banc des polices, moitié « et seulement elles » — vrai, corrigé.** Une police préchargée
   est toujours téléchargée, donc toujours dans les ressources mesurées : l'inclusion était
   vraie par construction. Le banc mesure maintenant les polices utilisées sur la même page
   dont les `<link rel="preload" as="font">` sont retirés (route Playwright), et exige
   l'égalité des deux ensembles.

### Tournée mobile (planches 4a, 4b, 4c, 4d ; 5c, 11a-11c en sombre), posé le 23/09

**Le cockpit (4b).** Trois gestes sous le pouce, selon la décision de Thomas : une rangée
Appeler (rond de 56) · **« Y aller »** (56, plein) · Carte (rond de 56) ; **« Livré »** en 56
pleine largeur ; « Client absent » et « Problème » dessous, à 48, surface basse, sans couleur.
« Y aller » est l'ancien « Itinéraire » : il ouvrait déjà Google Maps sur
`https://www.google.com/maps/dir/?api=1&destination=<adresse encodée>` — le libellé change,
le mécanisme reste. Au bureau, les gestes gardent 44 px (planche 13b).

- **Mesure avant : le geste principal était SOUS la barre basse.** À 390 × 844, « Livraison
  validée » tombait à y ≈ 740, la barre basse commence à 754. Les gestes collent maintenant
  au bas de l'écran, au-dessus de la barre (`position: sticky`), tant que la carte de l'arrêt
  est à l'écran. Il a fallu `overflow-x: clip` au lieu de `hidden` sur `<body>` et `<main>`
  (sur cet écran seul) : `hidden` en fait des conteneurs de défilement, et le collage se
  faisait au bas de la page entière, jamais à celui de l'écran.
- **« Autres actions »** (À reprogrammer, Planifier suite, Suivant) sort du bloc des gestes :
  gardée, repliée, sous la carte de l'arrêt — elle n'a pas à coller au pouce.
- **« Prochain : <client> · ville »** sous les articles. **Omis** : « 6,2 km · environ
  14 min » — aucune distance par arrêt n'est calculée, ni au serveur ni au navigateur.

**Après « Livré » : sans confirmation, avec Annuler.** L'arrêt passe à « Livré » à l'écran,
la tournée avance d'elle-même à l'arrêt suivant non terminé, et un toast « Livré — <client> »
porte **Annuler** pendant 4 s (la durée de la charte). **Décision** : le serveur ne sait pas
défaire une livraison — dans la machine d'état des commandes, `livre` n'a aucune sortie, et la
livraison consomme la réservation de stock. Plutôt que d'ouvrir une transition
`livre → en_livraison` (et de défaire une consommation de stock), **l'envoi est différé** :
le `PATCH` part au terme des 4 s. Annuler n'a donc rien à défaire côté serveur. L'envoi part
plus tôt si un autre geste d'arrêt suit (jamais deux livraisons en suspens), ou si la page
passe en arrière-plan (téléphone verrouillé, Google Maps ouvert) — `keepalive` pour
`pagehide`. Hors ligne, l'écriture rejoint la file existante. Un double appui dans les
700 ms est ignoré : sans cela il livrait deux arrêts. **Risque nommé** : si le navigateur
est tué dans les 4 s sans passer par `visibilitychange`/`pagehide`, la livraison n'est pas
envoyée ; l'arrêt reste « En livraison » au rechargement, visible, à refaire.

**« Problème » : motifs prédéfinis + précision libre — tranché, et c'était déjà là.** La
question ouverte de la planche (« sheet à motifs prédéfinis ou champ libre ? ») est tranchée
par ce qui existe depuis le 18/09 : le dialogue `#motifProblemeDialog` propose les motifs du
serveur (`MOTIFS_PROBLEME` : personne sur place, adresse introuvable, accès impossible
— portail, code, étage —, établissement fermé, commande refusée, produit manquant ou abîmé,
autre) **et** un champ « Précision » libre de 120 caractères, stocké avec le motif. Les trois
motifs de la planche (portail fermé, refus, erreur d'adresse) y sont. Rien n'est ajouté.

**La carte (4c).** Décision de Thomas, qui **remplace** celle du 19/09 : marqueurs de
**44 px** (la zone de toucher est le disque ; chiffre 17 px, ombre portée de la planche) et
tracé de **7 px**. **Décision** : un **liseré blanc** de 2 px de chaque côté, sous le tracé,
non interactif — sur les vraies tuiles OpenStreetMap, dont les routes sont orange et jaunes,
l'orange seul se perdait ; la planche le craignait elle-même (« le fond de carte ici est une
esquisse »). Les marqueurs de la **liste** gardent 28 / 34 : la ligne tient 64–72 px.
**Gardé** : réordonner invalide le tracé (le serveur efface la géométrie ; la carte dessine le
pointillé en principal). Nouveau : « Recalculer le tracé » est alors **cerclé d'accent** (un
contour, pas une ombre — l'anneau de focus reste visible avec). **Écarts** : la carte n'est
pas un mode plein écran à « sheet » en surimpression ; le bouton Carte du cockpit y fait
défiler. Pas de puce « 18 km restants » : le reste n'est calculé nulle part.

**Préparer (4a).** Au téléphone, la commande prête se lit comme la planche : le client, puis
« CMD-2026-009 · 2 articles » (articles = lignes, le même mot que « n articles à décharger »).
L'adresse, le téléphone et le badge quittent la ligne ; l'avertissement d'adresse
incomplète reste. Le jour et le secteur restent, dessous (corrigé par la revue du 23/09, voir
plus bas). **Gardés hors planche** : les filtres date / secteur / ville et les trois
boutons de sélection. **Omis** : « 38 km · 1 h 25 » recalculés à chaque coche (aucun calcul
avant la création de la tournée), les pilules de secteur de la planche (le filtre « Secteur »
existe), et le pied collant « n arrêts sélectionnés · Créer la tournée » (le compte et le
bouton existent dans la planification) — non faits dans ce lot.

**Fin de tournée (4d).** « Tournée terminée », la phrase « Tournée <secteur> du <jour>, de
13 h 40 à 17 h 05 » (heures depuis `startedAt` / `completedAt`, omises si l'une manque), les
**trois chiffres** (Livrés, Clients absents, Problèmes — `a_reprogrammer` compté en
problème), les **problèmes nommés** (client + motif enregistré), l'arrivée et son « Y aller ».
Pas de fête. **Omis** : « 62 km parcourus » (la distance connue est celle du tracé prévu, pas
celle roulée) et « 3 h 25 sur la route » en chiffre séparé (l'intervalle est dans la phrase) ;
**« Clôturer »** — aucune clôture n'existe côté serveur, la tournée passe `terminee` d'elle-même
au dernier arrêt ; **« Reprogrammer »** sur l'écran de fin (« Planifier suite » existe sur
l'arrêt). Gardés : « Retour accueil », « Voir à recommander ».

**Écarts nommés.**

- **La barre basse reste** sur le cockpit et la carte. La planche la retire (« la barre
  basse cède la place aux trois gestes », « retour par la flèche ») ; le cadre commun du lot 1
  la tient sur tous les écrans, et aucune flèche de retour n'existe. Les gestes collent
  au-dessus d'elle.
- **Le bouton de droite est la carte, pas les articles.** L'annotation dit « articles à
  droite », le dessin montre une carte pliée ; les articles sont déjà sur la carte de l'arrêt.
- **Les ronds font 56** (48 sur la planche), pour tenir la rangée de « Y aller » à 56.
- **L'en-tête de tournée** ne garde au téléphone que l'anneau et la barre : le jour et le nom
  sont déjà le titre de l'en-tête vert (même donnée, deux fois).
- **Le toast couvre la rangée « Client absent / Problème »** pendant ses 4 s : il se pose
  au-dessus de la barre basse, et Annuler tombe sous le pouce.

*Bancs : `tournee-mobile.spec.js` (9 cas, ports 3175 et 3181) ; `ecran-livreur.spec.js` et
`carte-et-lignes.spec.js` mis à jour (libellés et 56 px ; 44 px, 7 px et liseré) ;
`operations.spec.js` attend l'envoi différé (10 s au lieu de 5).*

### Tournée mobile — revue adverse, corrigée le 23/09

Une relecture adverse du lot a nommé cinq défauts. Les cinq sont vrais ; les cinq sont
corrigés, chacun avec un banc qui échoue sans le correctif.

- **« Livré » en réseau lent livrait un arrêt jamais vu.** L'envoi d'une livraison en
  suspens attendait le `PATCH` et le rechargement sans rien bloquer : un appui impatient
  posait B en suspens, l'appui précédent reprenait, lisait l'arrêt de l'écran (devenu C)
  et écrasait B ; au terme du toast de B, c'est C qui partait. **Décision** : le geste vise
  l'arrêt de l'écran **à l'appui** ; après l'attente, il n'agit que si cet arrêt est encore
  à l'écran et qu'aucune autre livraison n'est en suspens. Pendant l'attente, les gestes
  d'arrêt sont **désactivés** (le livreur voit que l'appui est pris). Le terme d'un toast
  n'envoie que **sa** livraison. Le garde de 700 ms du double appui reste.
- **Hors ligne, le geste qui suivait un « Livré » était perdu sous « enregistré ».** La mise
  en file de la livraison en suspens arrêtait le geste suivant (Livré, Client absent,
  Problème). **Décision** : une mise en file n'est pas un échec — elle est annoncée, et le
  geste continue ; il rejoint la file à son tour. Un refus du serveur, lui, arrête toujours
  le geste (l'écran vient d'être rechargé).
- **Préparer (4a) : la ligne ne disait plus le jour.** Le filtre par défaut mélange les dates
  et les secteurs, et la carte n'a **aucun détail** (une case à cocher) : deux commandes du
  même EHPAD, aujourd'hui et demain, se lisaient pareil. **Décision** : sous « CMD-… · n
  articles », une ligne de contexte, 13 px, texte secondaire : le **jour** et le **secteur**
  toujours, la **priorité** si elle n'est pas la normale, « **À reprogrammer** » (le seul
  statut qui n'est pas « Prêt »). **Écart nommé** : la planche n'a pas cette ligne — son
  en-tête dit le jour, et ses pilules de secteur, non posées, disaient le secteur.
- **« Recalculer le tracé » cerclé sur une tournée partie.** Le serveur refuse le recalcul
  dès le départ (« Recalcule avant le départ. ») : le cercle invitait à un refus. Il ne se
  pose plus que sur une tournée **prête** sans tracé — le cas de la planche (réordonner
  n'est possible qu'avant le départ).
- **Fin de tournée (4d) : les gestes d'arrêt restaient collés.** Six boutons inertes, ~200 px
  au-dessus de la barre basse, sur la lecture des chiffres. Au téléphone, ils disparaissent
  quand l'écran de fin est rendu ; « Retour accueil » et « Voir à recommander » restent.
  **Gardé** : au bureau (ils n'y collent pas), les gestes désactivés restent visibles, comme
  avant ce lot.

*Bancs : `tournee-mobile.spec.js`, 12 cas (ports 3175 et 3181, inchangés) — deux neufs
(réseau lent : `PATCH` retardé de 2,5 s ; hors ligne : la file indexedDB réelle, puis le
rejeu), trois renforcés (4a : le jour et deux commandes du même client ; 4c : une tournée
« prête » lue par interception, et la tournée partie ; 4d : les gestes masqués).*

### Mobile, Préparation (planches 7a, 7b), posé le 23/09 — une liste, une page

Décision de Thomas (OUI du 23/09) : au téléphone, la Préparation devient **une liste
unique avec des mots de statut** ; les pilules de filtre passent dans l'**en-tête vert** ;
le détail d'une commande suit la planche **7b**. Tout vaut **sous 820 px**.

| élément | planche | avant | après |
|---|---|---|---|
| La liste | une carte, cinq lignes de 72 px | quatre sections « À préparer / En cours / Prêtes livraison / Bloquées stock » | **une** carte blanche, sans titre de groupe, triée |
| L'état | point de 10 px + mot de statut | disque de 40 px + mot d'**étape** (À faire, En cours, Prête) | point de 10 px + mot de **statut** : Bloquée · En préparation · À vérifier · À préparer · Prêt livraison |
| Le tri | bloquées, en préparation, à vérifier, prêt livraison ; puis secteur, puis numéro | l'ordre des groupes | celui de la planche, recalculé à chaque rendu (une commande débloquée remonte) |
| Filtres | pilules sur le vert, loupe en haut à droite | pilules et recherche dans un panneau blanc sous l'en-tête | le même bloc **déplacé** dans la fente de l'en-tête ; la loupe déplie la recherche |
| Détail | une page : retour, « CMD-… · date », nom, puces secteur + statut, produits, adresse, un geste en bas | un sheet à trois boutons, deux grisés sans raison | la page 7b (le même `<dialog>`, plein écran) ; **un** geste selon le statut, et sa raison quand il est désactivé |

*Bancs : `preparation-mobile.spec.js`, 11 cas (ports 3176 et 3182) — liste et tri,
en-tête et loupe, sombre, page 7b, geste depuis la page, franchissement de 820 px, tri à
statut égal ; et, après relecture adverse : recherche tapée au bureau puis rotation,
loupe refermée avant les 200 ms, Safari < 14 (sans `MediaQueryList.addEventListener`),
sous-titre au téléphone seulement. `preparation-lignes.spec.js` : ses cas « mobile » passent à **900 px**
(entre 821 et 920 px, la liste garde ses groupes et le détail reste un sheet collé en
bas) — la couverture du sheet n'est pas perdue, elle change de largeur.
`navigation-mobile.spec.js` : l'en-tête de la Préparation rejoint les six en-têtes
jugés « vert, rien n'y déborde ».*

**Décisions prises là où la planche ne tranche pas** :

- **« À préparer »** pour une commande importée dont le stock suffit. La planche ne
  montre que « À vérifier » avant la préparation ; la charte dit « Importée », qui ne
  dit rien à qui prépare. « À préparer » est le mot de la pilule de Commandes et du
  tableau de bord. « À vérifier » reste pour le statut `stock_a_verifier`. Même rang de
  tri que « À vérifier ».
- **Le manque se compte en articles**, pas en produits : « Il manque 5 articles » (la
  somme des quantités manquantes), comme la planche (« Il manque 2 articles » / « 2 en
  stock, 2 manquants »). Un stock non renseigné n'est pas un manque : « Stock non
  renseigné ». Au bureau, la ligne garde « Il manque 1 article » (un produit) : le
  banc du bureau le tient, et c'est un écart **nommé** entre les deux vues.
- **« n articles »** sur la ligne mobile compte les quantités (6 pour deux produits à
  3), comme le résumé au-dessus (« 29 articles au total »). La ligne du bureau compte
  encore les **produits** (« 2 articles ») : les deux nombres se contredisaient déjà
  sur le même écran ; **relevé, non corrigé au bureau** (hors de la décision).
- **Le sous-titre** : « 3 commandes à préparer » = les commandes **restantes**
  (importées, bloquées comprises, et en préparation), le même nombre que « 3
  restantes » du résumé. La planche écrit « 5 commandes à préparer aujourd'hui » en
  comptant les prêtes, et « aujourd'hui » serait faux : la liste n'est pas bornée au
  jour. Posé **au téléphone seulement** (sous 820 px) : au bureau, le sous-titre reste
  celui de `tabs.js` (« Contrôle le stock, prépare les commandes… »), et franchir 820 px
  le remet. Les autres écrans (Commandes, Stock, Clients, Abonnements) gardent leur
  sous-titre-compte à toutes les largeurs ; celui-ci vient de la planche 7a, une
  planche **téléphone**, et la Préparation n'a pas de planche bureau. (Une première
  version le posait partout et la documentation disait à la fois « rien ne change au
  bureau » et « seul changement visible au bureau » : relevé en relecture, tranché
  pour « rien ne change ».)
- **Le nom passe sur deux lignes** au lieu de l'ellipse de la planche : à 390 px, avec
  « En préparation » à côté, il restait « Pharmacie Centra… » et « Champagnole · 6
  artic… ». La ligne fait 72 px et monte à 96 au plus ; le détail n'est jamais coupé.
- **La loupe** replie la recherche (gardée : la planche ne la dessine pas) ; la
  refermer **efface** la recherche — un filtre qu'on ne voit plus cacherait des
  commandes sans le dire. Même règle dans les deux cas limites : une recherche tapée
  **au bureau** qui passe sous 820 px (rotation d'une tablette) arrive **dépliée**
  derrière la loupe, sans focus (une rotation n'ouvre pas le clavier) ; refermer la
  loupe **pendant** les 200 ms d'attente de la frappe annule cette frappe.
- **Un seul geste** en bas de la page 7b, celui du statut : « Passer en préparation »
  (à préparer, à vérifier), « Préparation terminée » (en préparation), rien pour une
  prête (une phrase le dit). Bloquée : le bouton est **désactivé et dit pourquoi**
  (« Il manque 5 articles en stock pour commencer », relié par `aria-describedby`),
  dessiné au contour de la planche plutôt qu'en plein grisé.
- **Au bureau (> 820 px), rien ne change** : il n'existe **aucune planche bureau** de
  la Préparation dans l'export (7a/7b sont des planches téléphone) ; la décision de
  Thomas vise le téléphone. Groupes, mots d'étape et sheet restent. Franchir 820 px
  (rotation, fenêtre) redessine la liste et replace les filtres — mesuré.

**Écarts nommés** :

- pilules de **48 px** et non 44 : la hauteur de pilule mobile de la charte, déjà
  tenue par `preparation-lignes.spec.js` ;
- pas de pilules de **statut** : la décision les autorise, la planche 7a n'en dessine
  aucune (seulement les secteurs) ; ne pas les inventer ;
- le fond du geste en bas est **opaque** (planche : 82 % flouté), pour la même raison que
  la barre basse du lot 1 : la raison en alerte ne passe jamais sur un contenu qui défile ;
- la puce de statut de 7b porte le mot de statut de la ligne (« Bloquée », « À
  préparer »), pas le statut technique.

**Gardés, hors planche** (ils existent et servent) : la **recherche** (derrière la
loupe), le **repli des secteurs** (« Tous les secteurs », le secteur choisi passe en
tête), la **date de livraison** (lue par « Préparation terminée ») et l'**Itinéraire**,
dans la carte d'adresse de 7b ; la pastille de synchro et « Actualiser » de l'en-tête
(lot 1).

**Omis faute de données** (règle : ce qu'une planche invente sans données est omis) :

- **cocher les lignes** une à une, « 4 lignes sur 6 préparées », la barre de progression,
  et « Préparation terminée » désactivé tant que tout n'est pas coché : aucune donnée ne
  garde une ligne cochée (la planche veut qu'elle survive à la fermeture de
  l'application), et le serveur ne conditionne pas la fin de préparation à un pointage.
  La planche elle-même hésite (« Cocher ligne par ligne, ou une seule case ? »). La
  consigne de départ parlait de « garder le cocher » : **il n'existait pas** dans la
  Préparation — les seules cases de l'application sont la sélection des Commandes
  (« À envoyer ») et celle de la planification de Tournée, intactes ;
- « Commander » / « Livrer partiellement » sur une ligne manquante : aucune route ne
  commande à un fournisseur ni ne livre une partie (même écart que le Stock du 23/09) ;
- « livraison le matin » sous le téléphone : aucun champ d'instruction de livraison.

**Relevé, hors lot** : entre 821 et 920 px, les pilules font 44 px mais le plafond de
repli est calculé sur 48 (`calc(2 * 48px + 8px)`) — un demi-rang de trop visible. Pas
touché : ni téléphone ni bureau.

### Mobile, Abonnements (planches 3a, 3c, 5a), posé le 23/09

Sous **820 px**. `abonnements-mobile.spec.js` (12 cas, port 3177) ; `abonnements-lignes.spec.js`
et `abonnements.spec.js` suivent la nouvelle ligne.

**Posé**

- **La ligne de 96 px** (décision de Thomas) : trois rangées — le client et son badge d'état ;
  l'échéance et la fréquence (« Mercredi 23 septembre · tous les 14 j », ou « Échéance du
  13 septembre » en couleur d'alerte quand elle est en retard) ; le panier et le rappel
  (« 4 Changes taille L · rappel 2 j »). Carte blanche de 24 px de rayon, 12 × 18 px de marge
  intérieure : 12 + 24 (badge) + 6 + 19 + 6 + 17 + 12 = 96. Le disque d'état se retire : le badge
  porte l'état, comme sur la planche. Le tap ouvre toujours le sheet de détail.
- **« Nouvel abonnement » fixé en bas**, pleine largeur moins 16 px de chaque côté, 48 px, à 14 px
  au-dessus de la barre basse. La liste lui **réserve sa place** (172 px sous le dernier
  abonnement, zone sûre en plus) : tout en bas, le dernier abonnement est entièrement au-dessus
  du bouton — mesuré. Le bouton reste le même élément que celui de l'en-tête du bureau (un seul
  geste, deux positions). Il disparaît dans l'agenda (3c n'en a pas).
- **L'en-tête vert** prolongé dans le bloc des filtres : les pilules Tous / Actifs / En pause
  sur le vert (inactives en surface sur vert, active en blanc à texte vert ; en sombre, plein
  clair), un seul bloc arrondi de 28 px sous les pilules.
- **Le calendrier** rond de 44 px en haut à droite de l'en-tête ouvre **« Les 90 jours »** (3c) :
  l'en-tête dit « Les 90 jours » et « N livraisons prévues », une flèche de retour à gauche du
  titre ; chaque semaine est une carte, chaque échéance a son jour en deux étages (« MER » / 23)
  et son **« + » rond de 44 px** (nom accessible : « Créer la commande du … pour … »). Le
  retour du téléphone, la flèche, ou tout changement d'écran ramènent la liste.

**Décisions prises (questions ouvertes de la planche)**

- La fréquence prend, **au téléphone seulement**, la forme courte de la planche (« tous les
  15 j », « mensuel », « tous les 2 mois ») : la forme longue (« toutes les 2 semaines ») était
  coupée derrière l'échéance à 390 px. Le bureau, le sheet et l'éditeur gardent la forme longue.
- Un nom sur deux lignes est gardé (deux lignes au plus, puis ellipse) : la ligne passe alors à
  112 px. Couper un nom de client pour tenir 96 px aurait caché ce qui distingue deux EHPAD.
- Une ligne **en pause** dit « Livraisons suspendues » et descend la fréquence au panier ; une
  ligne **arrêtée** dit « Plus de livraison ». Un abonnement actif sans échéance dans l'horizon :
  « Aucune échéance prévue ».
- **« La prochaine échéance »** ne compte plus une échéance passée déjà commandée : commander le
  plus ancien de deux retards faisait afficher sa date passée, sans alerte, comme « prochaine ».
  Le correctif vaut aussi pour la colonne « Prochaine » du bureau, le tri, **et le sheet de
  détail** que la ligne ouvre (il gardait l'ancien calcul : la ligne disait « Échéance du 20 »,
  le sheet « Prochaine échéance : 13 », une date passée déjà commandée). Le sheet dit aussi le
  retard comme la ligne : « … · en retard », en couleur d'alerte.
- **Le bandeau « Hors ligne » / « Envoi en attente »** s'intercale dans le DOM entre l'en-tête et
  les filtres. Tant qu'il est là, l'en-tête garde son arrondi de 28 px et les filtres deviennent
  une carte verte fermée (28 px, dans la gouttière) sous le bandeau : deux verts fermés plutôt
  qu'un vert coupé à angles droits. Le réseau revenu, l'en-tête se prolonge à nouveau.
- **L'écran passe au-dessus de 820 px, l'agenda ouvert** (tablette qu'on tourne) : la vue revient
  à la liste, le titre « Abonnements » et son compte, et l'entrée d'historique de l'agenda est
  neutralisée (sinon la flèche, revenu au téléphone, aurait demandé deux touchers).
- **Un rechargement depuis l'agenda** repart sur la liste et efface l'état `{ aboVue: "agenda" }`
  de l'entrée courante : la flèche ramène la liste du premier toucher. Le même motif existe pour
  la fiche client (`app.js`), hors de ce lot, non corrigé ici.
- **Au bureau**, l'emballage des échéances d'une semaine (`.abo-semaine-lignes`, la carte du
  téléphone) est en `display: contents` : les échéances retrouvent leurs 8 px d'écart (elles se
  touchaient sur la première version du lot).

**Gardés, hors planche** : la recherche (dans l'en-tête), le tri « Prochaine livraison /
Client » (pilule sur le vert, à côté des filtres), la pastille de synchronisation et
« Actualiser », le statut de commande d'une échéance déjà commandée (il mène à Commandes).

**Écarts nommés**

- pas d'opacité sur la ligne en pause (la planche : 0,78) — même raison qu'au bureau, le
  contraste tombait sous 4,5 ;
- les titres de semaine gardent le vocabulaire du bureau (« Cette semaine · 3 », « Semaine du
  28 septembre · 2 ») au lieu de « Semaine du 21 septembre » + « 3 livraisons » ;
- « En retard · N » reste en tête de l'agenda (la planche 3c n'en montre pas ; décision du bureau
  maintenue) ;
- le bouton fixe est à 14 px de la barre basse telle qu'elle est rendue (90 px à 390, « Tableau de
  bord » sur deux lignes) — pas des 88 px de la planche ;
- un retour arrière depuis l'agenda, après un changement d'écran, consomme une entrée
  d'historique vide (l'agenda pose une entrée pour que le retour du téléphone le ferme).

**Omis, faute de données**

- « En pause depuis le 4 septembre » : aucun champ ne date la pause ;
- le toast « Bon CMD-2026-0xx créé » avec **Annuler** : la création reste celle de l'application
  (une notification, sans annulation — aucune route ne supprime une commande d'abonnement) ;
- la création 3b (sélecteur client en carte, catalogue avec stock, pilules de fréquence, aperçu
  des trois dates) : l'éditeur actuel est gardé tel quel, c'est un lot à part ;
- la tache floue rose derrière la liste (décor).

**`CACHE_NAME`** : réglé à l'intégration du 23/09. Le lot « chargement instantané » l'a porté à
`sereo-shell-20260923-instantane`, et surtout le nom annoncé porte désormais l'empreinte du
contenu de `public/` : tout fichier modifié renouvelle le shell sans geste de personne.

### Mobile, Paramètres (planches 8d/12d), posé le 23/09

Sous **820 px** ; au bureau, rien ne change (ce qui est propre au téléphone porte
`.par-telephone`, ce qui est propre au bureau `.par-bureau`). Banc :
`test/e2e/parametres-mobile.spec.js` (port 3179), comptes et archives servis par le banc.

**Posé, d'après la planche** :

- les cartes à la mesure de 8d : rayon 24, marge 18, écart 14, titre 17 px, aide 13 px ;
- **les comptes en lignes** : initiale sur disque vert (40 px), nom, rôle, et le badge
  d'état (« Actif » / « Désactivé ») — le tableau à cinq colonnes n'est plus rendu ;
- **« Ajouter un compte »**, bouton contour pleine largeur : il déplie le formulaire de
  création, replié par défaut. Il n'est rendu que pour l'administration, comme le
  formulaire ;
- **les imports en lignes** : « Dernier import de ventes » et « Dernier import de stock »
  (« 16 septembre à 8 h 42 · 38 lignes »), puis « Archives » (« N fichiers conservés »).
  L'année en cours se tait, comme sur la planche ; **une autre année se dit**
  (« 20 septembre 2025 à 9 h 05 ») : les archives ne sont jamais purgées, et un import
  d'il y a un an, sans son année, se lirait comme un import de la semaine. « lignes »
  s'accorde (« 1 ligne »), sur la ligne comme dans la feuille ;
- **« Ajouter »** sur la ligne du titre des Secteurs : il ouvre la fiche des secteurs et
  place le curseur dans le formulaire ;
- **la version au pied** (« Version 1.40.2 · À jour ») : au téléphone, la barre latérale
  qui la porte n'est pas rendue. La pastille suit la même règle que celle de la barre
  latérale : « À jour » seulement si la version a été lue, « Mise à jour » si une
  nouvelle version attend.

**Décisions prises** (les questions que la planche laisse ouvertes) :

- **la feuille d'un compte.** La planche ne montre qu'une ligne, sans geste ; or le
  tableau porte quatre gestes (rôle, désactivation, mot de passe, suppression). La
  **ligne entière** est le geste : elle ouvre une feuille (`<dialog class="sheet">`, comme
  le détail d'une commande) qui porte les quatre, un par ligne, avec les mêmes
  `data-action` que le tableau. Un geste referme la feuille (la liste se redessine,
  elle montrerait un état périmé), et **le focus revient sur la ligne du compte**
  redessinée — sur sa voisine si le compte est supprimé — au lieu de tomber sur
  `<body>`. Le titre de la feuille est l'identifiant (jusqu'à 60 caractères sans
  espace) : il **se coupe** (`overflow-wrap: anywhere`), sans pousser le ✕ hors de la
  feuille à 360 px ;
- **la feuille des imports.** Chaque ligne ouvre la feuille de ses fichiers : ventes,
  stock, ou toutes les archives, du plus récent au plus ancien, chacun avec
  « Télécharger ». C'est ce que porte le tableau du bureau ; la passation laissait
  l'écran de destination non dessiné ;
- **« Actif » n'est pas une `.pill`** : un badge informatif de 24 px (`.par-badge`),
  pour ne pas compter comme une cible à marge nulle dans `cibles-tactiles` ;
- le badge « Désactivé » prend le fond bas et le texte secondaire (et non le rouge de
  l'ancien tableau) : un compte éteint n'est pas une alerte.

**Écarts nommés** :

- la **zone dangereuse** reste une carte au téléphone : la planche la met derrière
  « Archives » ; une purge définitive garde son bloc, son contour d'alerte et sa liste
  (même décision qu'au bureau) ;
- le texte d'aide du Thème garde la phrase du bureau (« Réglage de cet appareil… ») :
  celle de la planche dit la même chose, et changer l'élément aurait changé le bureau ;
- l'aide « Chaque fichier .xlsx importé est archivé… » passe dans la feuille des
  imports, au téléphone.

**Gardés hors planche** (au téléphone aussi, dans leur carte) : Numérotation des bons,
le logo (derrière « Logo de l'application »), la fiche des secteurs, les réglages de
tournée, le diagnostic des dates, la zone dangereuse.

**Omis faute de données** : « Un seul compte aujourd'hui, partagé par le bureau, le
préparateur et le livreur… » (faux dès qu'un compte par personne existe) ; « Les trois
secteurs d'origine ne se suppriment pas » (le serveur supprime n'importe quel secteur) ;
« compte partagé » dans la méta du compte (aucun champ ne le dit d'un compte listé).

**Ce que le banc mesure** (corrigé après relecture, le 23/09) : `contraste-application`
et `cibles-tactiles` ne voient ni ces lignes ni ces feuilles (leur base n'a ni compte
ni import, et ils n'ouvrent pas les feuilles). C'est `parametres-mobile.spec.js` qui
mesure, dans les deux thèmes, le contraste ≥ 4,5:1 des lignes, de la feuille d'un
compte **et de la feuille des imports** ; et la hauteur ≥ 44 px de **chaque** cible du
lot : lignes des comptes et des imports, « Ajouter un compte », « Ajouter » des
secteurs, pied de version, gestes et ✕ des deux feuilles, « Télécharger ». La première
version du banc ne mesurait ni la feuille des imports ni ces hauteurs, alors que son
rapport le disait.

**`CACHE_NAME`** : réglé à l'intégration du 23/09. Le lot « chargement instantané » l'a porté à
`sereo-shell-20260923-instantane`, et surtout le nom annoncé porte désormais l'empreinte du
contenu de `public/` : tout fichier modifié renouvelle le shell sans geste de personne.

### Commandes + Stock mobile + squelettes (planches 8a, 8b, 10a, 10b), posé le 23/09

**Commandes au téléphone (planche 8a).**

- Les **pilules de statut** passent dans l'en-tête vert, sous la recherche, en 44 px :
  la choisie en blanc à texte vert (plein clair en sombre), les autres sur la surface
  sur vert. C'est **le même groupe**, déplacé par `placerPilulesCommandes()` au seuil de
  820 px, et remis dans la rangée de filtres au bureau (planche 13c) : deux groupes
  auraient fait deux noms pour le même geste, dont un toujours caché. Il écoute ses
  propres clics (il vit hors de l'écran au téléphone) et, rangé dans la fente, suit la
  règle `data-ecran` : il ne suit pas sur un autre écran.
- Sous l'en-tête, la ligne de la planche : **le compte** à gauche (« 10 bons », le compte
  de la liste filtrée), **le tri** à droite.
- **Gardés hors planche, repliés** : « Bloquées seulement », « À compléter », le secteur
  et la période n'ont pas de place sur la planche 8a ; ce sont les seuls chemins vers ces
  listes et vers l'export d'un mois ou d'un secteur. Ils se replient derrière un bouton
  « Filtres » (44 px, `aria-expanded`) qui **dit combien sont actifs** (« Filtres · 1 »),
  même replié : un filtre actif ne se cache jamais sans le dire. L'alerte « adresses à
  corriger » du tableau de bord arrive filtres dépliés. Le filtre client (« Client : … ✕ »)
  reste toujours visible.
- **Écart** : « Exporter en CSV » et « Nouvelle commande » restent dans l'en-tête (lot 1) ;
  la planche ne les dessine pas, ce sont les seuls chemins de l'export et de la saisie.
- Le balayage de contraste de l'application tourne à 1440 px et ne voit pas l'en-tête
  vert : un banc de ce lot mesure pilules, compte et « Filtres » dans les deux thèmes
  (≥ 4,5:1), et l'anneau clavier de la pilule sur le vert.

**Stock au téléphone (planches 8b, 10a).**

- **À plat** (planche 10a) : quand aucun produit n'a de catégorie, **ou tous la même**,
  plus de tuiles — une seule tuile « Sans catégorie · 200 » ne triait rien. À leur place,
  au bureau comme au téléphone, une carte qui dit ce qui manque et comment le retrouver :
  « Pas de catégories dans ce fichier » (ou « Une seule catégorie : Hygiène »), puis le
  tableau **à plat, du plus bas au plus haut** : sous le seuil d'abord, puis « à
  renseigner » (une quantité inconnue appelle aussi un geste), puis le reste, chaque
  groupe par quantité croissante. Le sous-titre dit « sans catégorie » au lieu de
  « 1 catégorie ».
- **L'ordre à plat est figé tant qu'on reste sur l'écran** (relecture du 23/09). Chaque
  − / + et chaque seuil rechargent la liste ; retriée sur la quantité du moment, la ligne
  touchée changeait de place sous le doigt, et le tap suivant, au même endroit, ajustait
  **un autre produit** (Gants à 2, Désinfectant à 7 : au 6ᵉ « + », le doigt tombait sur
  Désinfectant). L'ordre se refait en **rouvrant l'écran** ou quand un produit inconnu
  arrive (un import). Prix nommé : un produit réassorti reste en tête jusque-là.
- La carte dit **ce qui se voit** : « Aucun produit de ce fichier n'a de catégorie ». Le
  premier jet affirmait « le fichier n'a pas de colonne « Catégorie » », or l'import lit
  une colonne absente et une colonne vide de la même façon ; il disait « ajoutez » à qui
  l'avait déjà. Elle dit maintenant « Remplissez la colonne… (ajoutez-la si elle manque) ».
- Deux catégories ou plus : les tuiles, et au téléphone leur **titre** « Catégories » et
  leur compte (planche 8b).
- **Décision** : la carte « à plat » s'applique aussi au bureau. Le cas est une propriété
  des données, pas de l'écran ; et une tuile unique était aussi vide de sens à 1440 px.
- **Décision** : vouvoiement dans la carte (« Remplissez la colonne… »), comme la carte de
  premier lancement ; la planche tutoie.
- **Omis faute de données** : « Commander » (aucune route ne commande à un fournisseur,
  déjà nommé au 23/09) ; « trouvées dans le dernier import » (rien ne rattache une
  catégorie à un import) — le titre des tuiles dit « 4 catégories ».
- **Gardé hors planche** : la ligne de stock garde ses champs Seuil et Stock et ses pas
  − / + (seuls chemins pour les poser) ; la planche 10a montre une liste en lecture seule.

**Squelettes (planche 10b).**

- **Les chiffres** du tableau de bord (chiffre d'affaires, panier moyen, commandes
  livrées, les deux tuiles et leur détail) sont, pendant le **premier** chargement, des
  blocs gris **à la taille du chiffre attendu** (le montant ≈ 3,8 em sur 0,86 em, un
  compte de tuile ≈ 1,1 em). L'élément est vide — un espace sans chasse en
  pseudo-élément lui garde sa hauteur de ligne — et le bloc est dessiné par-dessus : rien
  n'est écrit, la règle « jamais de texte dessus » tient. Pulsation d'opacité à 1,6 s,
  coupée sous `prefers-reduced-motion`. À l'actualisation, les chiffres qu'on avait
  restent lisibles.
- Avant : « 0 » et « — » pendant le chargement — un **zéro qui mentait**, que le
  sous-titre recopiait (« 0 commande à préparer ») — puis tout l'écran descendait de
  **22 px** au bureau et **72 px** au téléphone. Trois causes, trois remèdes : les
  chiffres (ci-dessus) ; la pilule du mois, vide (64 px) puis « septembre 2026 » (188 px),
  qui faisait passer l'import à la ligne — elle porte le mois courant dès le départ (il
  est connu sans serveur) ; le sous-titre, qui passait sur deux lignes en se complétant —
  il **réserve deux lignes** sur le tableau de bord (**écart** : jusqu'à 22 px d'air sous
  un sous-titre d'une ligne, le prix d'un écran qui ne saute plus).
- **Les lignes** : les listes dont on connaît la ligne (commandes, stock, clients, « À
  régler », « Cette semaine », « À préparer », « À livrer ») prennent des lignes grises à
  la hauteur de la ligne réelle — 56 / 72 px pour une commande, 56 / 141 px pour un
  produit, 60 / 72 px pour un client, au bureau / au téléphone. La liste des Commandes,
  vide pendant le chargement, a maintenant les siennes.
- **Entre 821 et 1280 px**, Commandes et Stock sont des **cartes à trois rangs** : la ligne
  grise y mesure **95 px** (commande, de 821 à 1280 px) et **129 px** (produit, de 921 à
  1280 px). Le premier jet gardait 56 px et la liste sautait de ~170 à ~290 px ; son banc
  ne mesurait qu'à 1440 et 390 px, il ne pouvait pas le voir (relecture du 23/09).
- **Un libellé n'est pas un chiffre** : « Commandes livrées » est vidé pendant le
  chargement comme les chiffres (le rendu y écrit « 12 commandes livrées »). Si
  `/api/operations` échoue, le libellé revient ; les chiffres, eux, disent « — ». Le premier
  jet montrait « — » au-dessus de « — ».
- Banc : les chiffres et ce qui les suit bougent de **0 px** à l'arrivée des données, à
  1440 et à 390 px (tolérance 2 px) ; une ligne grise mesure la ligne réelle à 2 px près, à
  1440, 1280, 1024, 880 et 390 px.
- **Non fait, nommé** : le **nombre** de lignes grises reste une estimation (on ne le sait
  qu'avec les données) — ce qui est **sous** une liste peut encore bouger. La colonne
  droite du tableau de bord change de carte à l'arrivée des données (« À livrer » laisse
  la place à la tournée du jour) : un changement de contenu, pas un squelette. Le compte
  « Cette semaine » affiche encore « 0 » pendant le chargement. Au téléphone, les toasts
  « Stock mis à jour » s'empilent depuis le bas et peuvent couvrir un bouton − / + après
  cinq ou six ajustements rapides (constat du banc, antérieur à ce lot, non traité).

## Lot du 23/09 — deux bancs instables

Deux bancs rouges par intermittence en suite complète locale, verts seuls. Méthode
suivie : faire tomber chaque banc SOUS CHARGE, lire la cause du rouge, corriger la
cause (jamais un retry, jamais une attente allongée), puis rejouer la même charge.
La charge : des bancs qui parlent au serveur commun (`badges`, `tabs`, `smoke`,
`hors-ligne`, `contraste-application`, `themes`…) plus `contraste-champs`, répétés,
huit ouvriers, sur un serveur isolé du worktree — pendant que le banc visé tourne
en boucle dans un second processus. **Composition NON vérifiable** (relecture
adverse du 23/09, voir plus bas) : le premier jet disait « les dix-huit bancs »,
or le dépôt en compte vingt qui touchent le serveur commun en plus de
`contraste-champs`, et la configuration de charge a été supprimée sans être
commitée. On ne sait donc plus lesquels manquaient.

### `operations.spec.js`, cas « départ et arrivée, calcul routier… » — CORRIGÉ

**Cause, mesurée.** `loadData()` part au `DOMContentLoaded` sans être attendu par
`page.goto()` et interroge dix-sept routes. Le banc cliquait « Tout sélectionner »
dès les deux adresses confirmées. Si les commandes n'étaient pas encore arrivées,
`selectAllDelivery()` sélectionnait une liste VIDE, « Créer une tournée optimisée »
restait désactivé, et le banc mourait d'un timeout de 30 s sur ce bouton.

**Ce n'était PAS qu'un défaut de banc** (le premier jet disait « l'application n'a
rien de faux » : c'était faux, relevé par la relecture adverse). Un livreur sur
réseau lent qui touche « Tout sélectionner » avant la fin du chargement perdait le
même geste : rien de sélectionné, « Aucune commande prête à livrer — Termine des
préparations… » affiché à tort, puis les commandes arrivaient décochées, « 0
sélection », création de tournée désactivée. Le banc attendait les données ; un
humain ne le fait pas. Le produit est corrigé, voir « Relecture adverse » plus bas.

**Reproduit avant la correction, sans artifice** : 1 rouge sur 60 sous charge
(cas seul, `--repeat-each=60`, pendant 582 tests sur le serveur commun). Une sonde
posée dans la page datait l'apparition des commandes candidates et l'instant du clic :
sur les 59 verts, le clic venait 135 ms à 1,1 s après elles (médiane 398 ms) ; sur le
rouge, elles n'étaient PAS encore affichées au clic (1 223 ms après le chargement).
Rouge lu : `locator.click: Test timeout` sur `#createRouteButton`, « element is not
enabled ». Même rouge, déterministe, en retardant `/api/orders` de 2,5 s par
`page.route`. Ce stimulus n'était pas commité au premier jet, et les artefacts du
rouge naturel ont été effacés par Playwright au passage vert suivant : la sonde
de datation n'existe plus nulle part. Le stimulus EST désormais commité dans le
cas lui-même (première réponse de `/api/orders` retardée de 2,5 s, à chaque
passage) : le rouge d'avant se rejoue, voir « Relecture adverse ».

**Correction** : attendre l'état réel — les deux commandes prêtes affichées parmi les
candidates — avant « Tout sélectionner », puis que le bouton de création soit actif.
Aucune attente fixe. Avec le retard de 2,5 s, le banc corrigé passe (5/5).
Après correction, même charge : 60 verts sur 60. Ce chiffre seul ne prouve pas grand
chose — à un rouge sur 60, zéro sur 60 arrive une fois sur trois sans rien corriger ;
la preuve est le stimulus : rouge avant, vert après, à chaque fois.

### `contraste-champs.spec.js`, cas « mode light » — NON REPRODUIT, rien de corrigé

**126 répétitions du cas clair sous charge, 0 rouge** (10 + 30 + 70 + 4 + 6 + 6, jusqu'à
huit ouvriers, avec les bancs qui écrivent sur le même serveur : réglages de tournée
de `smoke`, rejeux de `hors-ligne`…). Et pas seulement vert : sur 70 exécutions
journalisées, les 37 champs mesurés ont rendu 70 fois la même couleur de texte et le
même fond. Le seuil n'est pas frôlé : le texte indicatif le plus pâle sur fond blanc
(`rgb(79,116,119)`) est à 5,1:1.

Portée de ce « 0 rouge » : il vaut pour la charge JOUÉE ce jour-là, dont la liste
n'est plus vérifiable (voir l'en-tête du lot). Il ne dit rien d'une charge qui
inclurait les bancs manquants ; « non reproduit » n'est donc pas « absent ».

Pistes vérifiées et écartées : le mode de couleur est par appareil (localStorage,
jamais lu du serveur) ; le thème serveur (`/api/settings/appearance`) n'est écrit par
aucun banc ; le rafraîchissement périodique (60 s) ne tourne que sur l'accueil ; les
transitions sont coupées par le banc lui-même.

Aucune cause n'est donc affirmée. Une hypothèse NON vérifiée mérite d'être nommée :
`playwright.config.js` a `reuseExistingServer: !CI`. En local, si un serveur écoute
déjà sur 3100 — celui d'un autre worktree, ou un serveur lancé à la main sur un autre
état du code —, la suite le réutilise sans rien dire et mesure le CSS de CET autre
code. Cela rendrait exactement « rouge en suite locale, vert seul et en CI » ; rien
ne prouve que ce soit arrivé ce jour-là. Et « vert en CI » ne départage rien : la CI
tourne avec `workers: 1` et `retries: 2` (`playwright.config.js`, lignes 11-12) —
sans charge parallèle, et un rouge intermittent y serait rejoué deux fois avant
d'être compté. La charge locale expliquerait le même schéma aussi bien que
`reuseExistingServer` (omission relevée par la relecture adverse).

**Durcissements proposés, non posés** (chacun avec son risque) :

1. Joindre au rapport, sur rouge seulement, les deux photographies (avec / sans
   texte) de l'onglet fautif. Ne change aucun verdict ; le prochain rouge dira sa
   cause. Risque : quelques Mo d'artefacts par rouge.
2. Vérifier, avant de mesurer, que le serveur interrogé sert le `style.css` du
   worktree (empreinte comparée au fichier local). Prendrait l'hypothèse ci-dessus.
   Risque : casse un lancement volontaire contre un autre serveur
   (`SEREO_E2E_BASE_URL`) ; à poser dans une configuration commune, pas dans ce banc.
3. Remplacer les attentes fixes (400 ms après le changement d'onglet, 120 ms entre
   les deux photographies) par l'attente de la section active et de deux images
   d'animation. Risque : une attente mal ciblée (un onglet qui redirige) pend au
   lieu de mesurer ; et rien ne montre aujourd'hui que ces délais soient en cause.

### Relecture adverse du 23/09 — trois défauts, trois vrais

**1. (important) Le produit partageait le défaut du banc — VRAI, corrigé.** Mesuré
avant correction par le banc neuf `test/e2e/livraison-chargement.spec.js` (serveur
semé, port 3186, `/api/orders` retardé de 4 s) : un toucher sur « Tout
sélectionner » pendant le chargement affichait « Aucune commande prête à livrer ».

Posé :
- Les trois boutons de sélection de la tournée (« Tout sélectionner », « Tout
  désélectionner », « Sélectionner ce secteur ») naissent `disabled` dans
  `index.html` (marqués `data-attend-commandes`) ; `loadData()` les active dès que
  les commandes sont assignées (`activerSelectionLivraison()`).
- `#deliveryCandidates` entre dans `poserSquelettes()` : la liste porte un
  squelette et `aria-busy="true"` pendant le chargement, comme les treize autres
  zones de la liste.
- `renderDeliveryCandidates()` ne dessine rien tant que le premier chargement n'est
  pas fini (`commandesChargees`) : « Filtrer », resté actif, ne peut plus afficher
  le faux état vide, et le filtre choisi entre-temps s'applique au rendu final.

Décisions : **désactiver plutôt que mémoriser le geste.** Retenir « il a touché Tout
sélectionner » et l'appliquer à l'arrivée des données aurait sélectionné des
commandes que le livreur n'a jamais vues ; un bouton désactivé dit « pas encore »,
et le squelette dit pourquoi. « Tout désélectionner » est désactivé avec les deux
autres pour que le groupe se lise d'un bloc, bien qu'il soit inoffensif seul.
« Créer une tournée optimisée » n'est pas touché : sans sélection il refuse déjà
avec un message.

Écarts nommés, NON corrigés :
- Si la route `/api/orders` ÉCHOUE, `loadData()` retombe sur `[]` : la liste dit
  alors « Aucune commande prête à livrer » alors qu'on ne sait pas. Une notification
  « Sections indisponibles : commandes » l'accompagne ; l'état vide lui-même ment
  encore. Hors de ce lot.
- Même classe ailleurs, mesurée par lecture seulement : « Tout sélectionner » des
  commandes du jour (`select-all-today-orders`) sélectionne `todayCustomerOrders`
  tel qu'il est au toucher, sans attendre le chargement. Non rejoué, non corrigé.
  Celui des Commandes (`#cmdToutSelectionner`) se protège déjà : désactivé quand
  la liste est vide.

Preuves rouges (chaque mutation seule, puis restauration) :
- produit d'avant (`app.js` et `index.html` de 4eb6e5a) : rouge « faux état vide
  affiché avant l'arrivée des commandes », reçu « Aucune commande prête à livrer » ;
- boutons non désactivés seuls : rouge « Tout sélectionner accepte un toucher qui
  ne sélectionnera rien », attendu `false`, reçu `true` ;
- sans le squelette seul : rouge « la liste n'annonce pas son chargement »,
  attendu `"true"`, reçu `null` ;
- sans la garde du rendu seule : rouge « faux état vide », via « Filtrer » ;
- boutons jamais réactivés : rouge « ne se réactive pas », reçu `disabled`.

**2. (mineur) La composition de la charge — VRAI, corrigé dans le texte.** Mesure
sur le dépôt : vingt fichiers de bancs touchent le serveur commun en plus de
`contraste-champs` — les dix-neuf que liste la relecture, plus `etats-limites`
(son premier cas, « hors ligne », fait `goto("/")` sans serveur semé ; la relecture
l'avait manqué aussi). La configuration de charge n'ayant pas été commitée, la
liste jouée ce jour-là ne se reconstitue pas : l'en-tête du lot et la conclusion
« non reproduit » de `contraste-champs` le disent désormais. Aucune charge n'a été
rejouée pour réparer ce chiffre : sept worktrees tournaient en parallèle.

**3. (mineur) Le « rouge avant » ne se rejouait pas — VRAI, corrigé.** Le stimulus
est commité dans `operations.spec.js` : la PREMIÈRE réponse de `/api/orders`
arrive 2,5 s après les autres, à chaque passage (les rechargements suivants ne
sont pas ralentis). Rejoué ce jour, stimulus en place :
- produit d'avant + banc d'avant (sans les deux attentes) : rouge
  `locator.click: Test timeout` sur `#createRouteButton`, « element is not
  enabled » — le rouge naturel, trait pour trait ;
- produit d'avant + banc corrigé : vert (l'attente du banc suffit au banc) ;
- produit corrigé + banc d'avant : vert (le clic de Playwright attend désormais que
  « Tout sélectionner » soit actif — ce que fait un humain qui voit un bouton grisé).
La sonde de datation du premier jet (MutationObserver) reste perdue ; elle n'est
pas refaite, le stimulus commité la remplace comme preuve.

### Reprise du 23/09 (après une coupure réseau) — le banc neuf était instable lui aussi

La correction de la relecture a été interrompue avant ses commits de fin. Reprise
sur la branche, tout re-mesuré plutôt que relayé :

**Le banc neuf `livraison-chargement.spec.js` tombait : 1 rouge sur 30 sous
charge.** Rouge lu : `locator.click: Element is outside of the viewport`, sur le
toucher forcé (`click({ force: true })`) de « Tout sélectionner » ; la photographie
du rouge montre la page REMONTÉE en haut. Cause, mesurée par une sonde (fenêtre
1280 × 720, commandes retardées) : pendant le chargement le bouton est à 1 170 px,
il faut donc faire défiler ; or l'app remet la page en haut au `DOMContentLoaded`
(`showTab` → `resetViewportScroll`) puis au `load` (`app.js`, écouteur `load`) —
tout de suite, à l'image suivante, et 120 ms plus tard. Quand une de ces remises
tombe entre le défilement de Playwright et son clic, le bouton n'est plus à l'écran.
Sous charge, le `load` arrive plus tard et la fenêtre s'élargit.

Correction du banc : le toucher passe par `HTMLElement.click()` (via
`locator.evaluate`), l'activation telle que la spec HTML la définit — sans effet sur
un bouton désactivé, un vrai clic sur un bouton actif. Plus de défilement, donc plus
de course avec la remise en haut. Écartés : une fenêtre haute (le bouton suit la
hauteur de la carte, 880 px au plus : il aurait fallu 2 400 px et un couplage à la
mise en page), une attente du `load` puis des 120 ms (attente calée sur une
constante de l'app), `dispatchEvent("click")` (passe outre `disabled`, le banc
n'aurait plus rien jugé).

Preuves, rejouées sur le banc final (chaque mutation seule, restauration par
`git show HEAD:` puis `git diff --quiet`) :
- produit de 4eb6e5a : rouge « faux état vide », reçu « Aucune commande prête à
  livrer » ;
- boutons sans `disabled` : rouge « accepte un toucher… », attendu `false`, reçu
  `true` ;
- `deliveryCandidates` retiré de `poserSquelettes()` : rouge « n'annonce pas son
  chargement », attendu `"true"`, reçu `null` ;
- garde `if (!commandesChargees) return;` retirée : rouge « faux état vide » ;
- `activerSelectionLivraison()` jamais appelé : rouge « ne se réactive pas », reçu
  `disabled`.
Les trois combinaisons du défaut 3 (`operations.spec.js`) sont aussi rejouées :
produit et banc d'avant → rouge « element is not enabled » sur `#createRouteButton`,
les deux autres → vert.

Répétitions sous charge (charge : les dix-neuf bancs du serveur commun plus
`contraste-champs`, quatre ouvriers, répétés, serveur isolé 3212 ; `etats-limites`
en est exclu car ses serveurs semés ont des ports fixes) :
- `livraison-chargement` : rouge 1/30 AVANT (ci-dessus) ; 40/40 vert APRÈS ;
- `operations`, cas de route, stimulus commité (la course a lieu à CHAQUE passage) :
  40/40 vert ;
- `contraste-champs`, cas « mode light » : 40/40 vert à quatre ouvriers, en plus de
  ses passages dans les charges elles-mêmes (396/396 puis 1 485/1 485, soit 19
  « mode light » de plus) — 59 passages ce jour, 185 avec ceux du premier jet :
  toujours non reproduit, toujours aucune cause affirmée.
Les bancs à serveur semé à port fixe se répètent à UN ouvrier (quatre ouvriers se
disputeraient le port), la charge tournant à côté dans un second processus.

Écart nommé, NON corrigé (même classe que le défaut 1 : un geste perdu pendant le
chargement) : un utilisateur qui fait défiler la page avant la fin du `load` est
renvoyé en haut par `resetViewportScroll(false)`. Mesuré par la sonde sur la seule
position qu'elle avait : `scrollY` 138 au `DOMContentLoaded` (le défilement vers
l'ancre `#livreur`), 0 au `load` — la remise écrase toute position prise avant.
Le défilement d'un humain n'a pas été rejoué. Hors de ce lot.

## Lot 4 de l audit géo : une carte utilisable au téléphone — 23/09

Source : rapport d'audit géo du 23/09 (commit audité `019788c`), §2 H10 et M3, §5 « carte
au téléphone », « sans tournée », petites finitions, §6 fond de carte. Décisions de Thomas
du 23/09 appliquées ici : garder les tuiles OpenStreetMap une fois le Referer corrigé.

### Fait

- **Fond de carte en UN endroit.** `lib/fond-de-carte.js` lit `SEREO_TUILES_URL`,
  `SEREO_TUILES_ATTRIBUTION`, `SEREO_TUILES_ZOOM_MAX` (documentés dans `.env.example`) ;
  OpenStreetMap par défaut. La page le reçoit par `GET /api/carte/fond` ; la CSP
  (`img-src`) lit le même module. L'URL était écrite en dur deux fois (`app.js` et la CSP).
  Une URL invalide (pas https, pas de `{z}/{x}/{y}`, jeton inconnu dans l'hôte) retombe sur
  OSM **avec l'attribution d'OSM**.
- **Referer et licence.** Les tuiles portent `referrerPolicy:
  "strict-origin-when-cross-origin"` : l'origine seule part (mesure : `http://127.0.0.1:3194/`
  sur chaque tuile, `null` avant). Le document garde `Referrer-Policy: no-referrer`.
  L'attribution porte le lien `https://www.openstreetmap.org/copyright` (« © les
  contributeurs d'OpenStreetMap »).
- **Fond indisponible.** Quatre tuiles refusées d'affilée affichent « Fond de carte
  indisponible — la liste des arrêts reste utilisable. » ; une tuile qui revient l'efface.
- **H10.** On ne cadre plus qu'au **changement de tournée affichée** (autre tournée, arrêts
  ajoutés ou retirés ; l'ordre n'en fait pas partie). Le rechargement qui suit « Livré »,
  « Absent », et le changement d'onglet gardent le zoom et le cadre du livreur (mesure avant :
  996 px de déplacement des marqueurs après un rechargement). Quand l'arrêt en cours
  **change**, la carte glisse vers lui (`panTo`), au zoom du livreur. Bouton **Recentrer**.
- **M3.** Choisir un arrêt (ligne ou marqueur) met à jour le marqueur « en cours » de la
  carte (avant : la carte gardait l'anneau sur l'arrêt 3 quand la liste disait 5).
- **Mise à jour ciblée.** Un marqueur par clé ; seul ce qui change est touché (`setIcon`,
  qui réutilise l'élément, `setLatLng`, bulle, `zIndexOffset`). Le tracé ne se redessine
  que si la tournée ou sa géométrie changent. Un rechargement ne recrée plus aucun marqueur.
- **Ma position.** Bouton à bascule (`aria-pressed`) : `watchPosition`, point bleu et cercle
  de précision, « Ma position : ± 30 m » ; au-delà de 150 m, « — position imprécise » sur fond
  d'avertissement. **Rien n'est envoyé au serveur** (le banc écoute toutes les requêtes).
  Quitter l'écran Tournée arrête le suivi.
- **Sans tournée.** Plus de pointillé ni de « Arrêt N » : la carte montre les commandes
  prêtes à livrer (filtrées, plus la sélection) par des **points sans numéro**, pleins si
  cochés, nommés « <client>, sélectionnée / non sélectionnée », hors de la tabulation (la
  liste est l'équivalent clavier). **Jamais les clients de la base.** Le sous-titre et la
  légende suivent le mode.
- **Centre par défaut** sur le Jura et le Doubs (Champagnole, Dole, Besançon), plus Beaune.
- **Téléphone.** Un doigt fait défiler la page, deux doigts déplacent et zooment la carte
  (mesure avant : page 0 px, carte 160 px ; après : page 145 px, carte 0 px). Une astuce
  « Deux doigts pour déplacer la carte » apparaît 1,5 s. **Plein écran** : bouton de la
  carte, et « Carte » du cockpit au téléphone ; le doigt seul y déplace la carte ; Échap ou
  le bouton en sortent, le focus revient à ce qui l'avait ouvert.
- **Départ et arrivée** : repères carrés « D » et « A » (« D·A » au même point), nommés
  « Départ : <libellé> ». Ils sont dessinés **même sans tracé** — ils disparaissaient après un
  réordonnancement (le serveur efface la géométrie, pas le départ). Le pointillé de repli
  relie désormais départ, arrêts et arrivée dans l'ordre de la tournée.
- **Arrêts à la même adresse regroupés** : un marqueur « 3·7 » (au-delà de deux, « 3+2 »),
  nommé « Arrêts 3 et 7, en cours : <client> » ; l'état montré est le plus urgent.
- **Point approximatif** : anneau en tirets, « position approximative » dans le nom et la
  bulle. Le serveur le dit : `positionPrecision` (`adresse`, `approximative`, `manuelle`)
  posé par le géocodage par lot (type BAN `street` = approximatif), par le calcul de tournée,
  et « manuelle » par la correction à la main ; copié dans l'arrêt.
- **Libellés en français** : « Zoomer », « Dézoomer », « Fermer » (bulle) ; chaque marqueur
  d'arrêt dit son client.
- **Décisions gardées** : marqueurs de 44 px, tracé de 7 px et liseré blanc.

### Décisions prises

- **Suivre sans zoomer.** Choisir un arrêt faisait `setView(…, 15)` ; le zoom du livreur
  est maintenant gardé partout (il avait rezoomé à la main, on ne le lui reprend pas).
- **Le fond vient d'une requête.** Un fond qui ne se charge pas (requête refusée) affiche le
  même message qu'une panne de tuiles. `/api/carte/fond` passe par la copie de secours du
  service worker comme les autres `GET /api`.
- **Seuil de 4 tuiles** en échec d'affilée : un échec isolé (tuile hors zone) ne dit rien.
- **Plein écran sans l'API Fullscreen** : une classe sur le panneau (`position: fixed`,
  z-index 1150 : au-dessus de la barre basse, sous les feuilles et les messages). L'entrée
  d'écran `pageFadeIn` (`both`) laissait un `transform` identité sur `#livreur`, qui faisait
  de la page le cadre du `fixed` : la carte restait dans la page (358 × 2 106 px à
  y = −1 273). Le plein écran coupe l'animation de `#livreur`. Le banc garde les animations
  pour ce cas : les figer masquait le défaut.
- **Point bleu** `--carte-position` (#1A73E8, #8AB4F8 en sombre) : la convention des cartes ;
  aucun jeton v8 n'est bleu.

### Écarts nommés

- **Le Referer ne prouve pas la levée des blocages** « Access blocked » du 18/09 : à
  vérifier une fois depuis la production (décision 3 : observer une semaine).
- **Une tuile 403 servie AVEC une image** (l'« Access blocked » d'OSM) peut s'afficher sans
  déclencher `tileerror` : le message ne couvre que les refus sans image et les coupures.
- **En préparation**, deux commandes au même point ne sont pas regroupées, et toucher un
  point ne coche pas la commande (constat « moyenne » de l'audit, non fait).
- **« Me localiser » du départ** (arrondi à ~100 m, décision 5) et la purge à 12 mois ne sont
  pas dans ce lot : la position en direct, elle, ne quitte jamais le navigateur.
- **Les arrêts restent des copies** (M4, lot 3) : un arrêt créé avant ce lot n'a pas de
  `positionPrecision` ; un client corrigé ensuite ne met pas à jour l'arrêt existant.
- **Hors ligne**, les tuiles ne sont pas en cache (service worker : autre origine ignorée ;
  selon l'audit, la politique d'OSM l'interdit). La carte devrait rester grise, avec le
  message : **déduit, non rejoué**.
- **Sans banc** : l'astuce « Deux doigts », le repère « D·A » au même point, le « 3+2 »
  au-delà de deux arrêts, le retour du message quand une tuile revient.

### Ce qui reste

- Mesurer depuis la production que les tuiles passent (Referer) ; trancher le fournisseur si
  les blocages continuent (un changement se fait par `SEREO_TUILES_URL`, sans code).
- Carte de préparation : cocher en touchant un point ; regrouper au-delà de ~50 points.
- Le lot 3 (bonnes adresses) peut s'appuyer sur `positionPrecision` et la remplir aussi pour
  les adresses corrigées depuis l'écran « Adresses à vérifier ».

*Bancs : `test/e2e/carte-telephone.spec.js` (12 cas, ports 3194 et 3195) — tous rouges sur
la carte d'avant, chacun pour sa cause ; cinq mutants tués (repères sans tracé, recadrage au
changement d'onglet, `panTo` retiré, position envoyée, repli sur les clients).
`test/carte-telephone.test.js` (5 cas, faux géocodeur 3392) : `/api/carte/fond`, CSP,
défaut OSM avec licence, URL invalide, `positionPrecision`. Verts aussi :
`carte-et-lignes`, `tournee`, `tournee-mobile`, `ecran-livreur`, `operations`,
`tuiles-bloquees`, `tabs`, `cibles-tactiles`, `focus-clavier`, `contraste-application`,
`etats-limites`, `hors-ligne`, `chargement-instantane`, `navigation-mobile`.*

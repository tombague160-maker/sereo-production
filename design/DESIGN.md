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
| ~~Le thème par défaut~~ — **aligné, relu le 23/09** | le code suit la maquette | Sans préférence enregistrée, le thème démarre sur « Système », comme la maquette : `anti-fart.js` résout l'appareil en clair ou en sombre avant le premier rendu. *Cette ligne disait jusqu'au 23/09 que le code forçait le clair : c'était vrai le 16/09, plus depuis.* Le choix par appareil, lui, est exactement ce que fait `app.js` : `localStorage` seul, la valeur en base est délibérément ignorée |
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
*(23/09 : la garde est tombée, et la clé existe — voir « Lot 1 de l'audit géo » en fin
de fichier.)*

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

> **Tranché le 23/09 (décision 4 de Thomas)** : l'écran Tournée, et lui seul, se
> rouvre hors ligne, sous session valide connue. Voir la dernière section, « L écran
> Tournée se rouvre sans réseau ».

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
**Soldée le 23/09** — voir « Écrans sans planche au style V8 », en fin de fichier.

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
  faisait au bas de la page entière, jamais à celui de l'écran. (Depuis le 23/09, `clip`
  vaut pour toute l'application : « Panier collant et ordre du clavier », en fin de
  fichier.)
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
  des trois dates) : l'éditeur actuel est gardé tel quel, c'est un lot à part —
  posé depuis, voir « Création d'abonnement (planches 3b, 5b) » en fin de fichier ;
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

## Lot 7 de l audit géo : meilleur trajet et calcul routier (23/09)

Audit de référence : rapport du 23/09 (copie `019788c`), §3a, §3b, §5, §6 et lot 7,
plus la partie « calcul routier » du lot 8. Décisions de Thomas du 23/09 appliquées :
n° 2 (serveur OSRM à nous, **révisée en cours de lot** : aucune manipulation sur son
serveur, OSRM sera intégré plus tard à l'image Séréo par l'intégrateur) et n° 9 (pas de
créneaux horaires : « À livrer en premier »).

### Fait

- **Or-opt (§3a).** `lib/routing.js` : après le plus proche voisin, une descente 2-opt
  puis Or-opt (déplacer un arrêt ou un bloc de 2-3, dans son sens ou retourné), jusqu'à
  stabilité, puis des perturbations « double pont » en nombre FIXE et à graine fixe (le
  même appel rend le même ordre sur toute machine). Deltas en O(1), sommes cumulées dans
  les deux sens pour le 2-opt (la matrice est dirigée). Banc
  `test/meilleur-trajet.test.js` : 750 tournées de 5 à 9 arrêts (cinq scénarios de
  Franche-Comté, détours, vitesse qui monte avec la distance, côtes, adresses en
  double), comparées à la force brute : médian 0 %, pire **1,65 %** (avant : pire
  **8,31 %**). À 50 arrêts : 8 à 12 ms (plafond du banc : 100 ms), gain de 0,7 à 2,8 %
  sur l'ancien ordre.
- **« À livrer en premier » (§5, décision 9).** Une case sous chaque commande choisie de
  l'écran de préparation ; `premiers` dans `POST /api/routes` ; drapeau
  `livrerEnPremier` sur l'arrêt, respecté par un recalcul. L'optimiseur essaie chaque
  épinglé comme dernier de la tête (les six plus proches du reste s'il y en a plus),
  optimise la tête et la queue séparément. Optimiser d'un tenant en interdisant les
  mouvements mixtes restait à 20 % de l'optimum sous contrainte : abandonné.
- **Mode « sans départ » (§3a, 16 %).** `optimizeOrders` : plus court chemin OUVERT
  (départ et arrivée fictifs à coût nul) par le même optimiseur, à vol d'oiseau, au lieu
  du voisin alphabétique. Banc `test/trajet-serveur.test.js` : 200 instances, avant
  médian 7,87 % / pire 56,70 %, après ≤ 1 % / ≤ 5 %.
- **Arrêt injoignable (§2 basse).** `injoignables()` retire le nœud qui porte le plus de
  `null` jusqu'à une table complète ; le message nomme le client (« Client b :
  injoignable par la route… ») ou le départ/l'arrivée. Option `retirerInjoignables` :
  l'arrêt sort de la tournée, sa commande reste prête, la réponse le nomme
  (`injoignablesRetires`). L'écran l'envoie toujours, et l'annonce par une notification.
- **Géocodeur (§2 basse) : cédé au lot 3** (revue du 23/09, voir plus bas). La boucle
  de géocodage de `roadPlan` est rendue telle que sur main.
- **Tronçons (§3b).** `route.troncons` : `{ duree (s), distance (m) }` par trajet,
  départ → … → arrivée, tels qu'OSRM les rend (`legs`). Rien de neuf n'est affiché :
  c'est la matière des heures d'arrivée du lot 6. Un réordonnancement à la main les
  efface avec le tracé.
- **Serveur de calcul routier (§6, décision 2).** `SEREO_ROUTING_URL` désigne notre
  serveur ; une adresse locale (`http://127.0.0.1:5000`) se branche telle quelle. S'il
  ne répond pas (réseau, délai, 5xx), repli sur le serveur public, pendant 60 s, avec un
  avertissement au journal (origine seule, jamais un identifiant glissé dans l'URL).
  `SEREO_ROUTING_REPLI_URL` change le repli ; vide, aucun. Un refus (4xx) ne bascule
  pas, et son message dit « refuse une des positions » au lieu de « réessaie ».
- **Découpage au-delà de 50 (§3b, lot 8).** `POST /api/routes/decoupage` (n'écrit
  rien) : balayage angulaire autour du départ, coupé à la plus grande trouée, paquets
  équilibrés de 50 au plus ; les commandes « À livrer en premier » partent dans la
  première. L'écran le propose (confirmation), crée la première tournée et garde les
  autres commandes sélectionnées pour la suivante. Hors ligne, il refuse sans rien
  mettre en file.
- **Garde-fou.** La descente a un plafond de mouvements : une matrice aux valeurs
  géantes (un « infini » à 9e15, vu pendant ce lot) faisait voir des gains fantômes à
  l'arrondi, et la boucle ne finissait pas. Banc : processus fils tué au bout de 20 s.

### Preuves rouges (ancien code, cause lue)

- Qualité : « pire écart trop grand : médian 0,00 %, p90 0,93 %, pire 8,31 % sur 750 ».
  Mutant sans Or-opt (perturbations gardées) : pire 7,07 %, rouge aussi.
- Épingles : « épinglés 4,0 mais ordre 3,1,0,2,4 ».
- Injoignable : reçu « Un trajet est inaccessible par la route. Vérifie les adresses. ».
- Tronçons : reçu `undefined` (lib), « la tournée n'a pas gardé ses tronçons » (serveur) ;
  mutant qui ne les efface pas au réordonnancement : rouge.
- Repli : « …indisponible. Réessaie… » au lieu d'un calcul.
- Découpage : fonction absente ; route 404.
- Sans départ : « médian 7,87 %, pire 56,70 % sur 200 ».
- Plafond retiré : « le calcul a été tué : il ne finissait pas » (SIGTERM).
- E2E `meilleur-trajet.spec.js` sur l'ancien `app.js` : « element(s) not found » pour la
  case, « Expected substring: "55 commandes" / Received string: "" ».

### Écarts nommés

- **`deploy/osrm/` non fait**, sur contre-ordre du 23/09 (OSRM viendra dans l'image
  Séréo, lot de l'intégrateur). Le défaut reste donc le serveur public de
  démonstration, et le repli y renvoie les coordonnées : tant que notre serveur n'existe
  pas, la question RGPD du §6 reste entière.
- « À livrer en premier » vit sur l'ARRÊT, pas sur la commande : la case n'est pas
  mémorisée d'une préparation à l'autre, ne s'affiche pas dans la liste des arrêts et
  ne se change plus après la création (sauf réordonner à la main).
- La qualité est mesurée sur des temps synthétiques et jusqu'à 9 arrêts ; à 50, seul le
  gain sur l'ancien ordre est mesuré, pas l'écart à l'optimum. Aucune vraie matrice
  OSRM.
- Le découpage est un balayage angulaire, pas un regroupement : deux villes dans la même
  direction peuvent tomber ensemble, une ville à cheval sur deux paquets reste
  possible. Une seule tournée se voit à la fois (H9, lot 2) : la deuxième se crée après.
- Hors périmètre, au plus petit : dans `server.js`, `createRoute`, `createStop`,
  `reorderRouteStops` (une ligne), `POST /api/routes` et la nouvelle route de
  découpage ; dans `app.js`, la liste de préparation et `createDeliveryRoute`.
  `apiFetch` n'est pas touché (lot 1).
- Deux modifications de JS (`server.js`, remplacement de la section de l'optimiseur)
  ont été faites par script au lieu de l'outil Edit, relues par `node --check` et les
  bancs.
- Instabilités vues, non imputées : un rouge `toHaveText` dans la première passe des
  bancs e2e (probablement `operations.spec.js:247`, `#opSubscriptions`, sans rapport
  avec ce lot) non reproduit en deux passes (40/40, 42/42) ; `C2.stock.a` (250 ms) rouge
  une fois en `npm test` sous charge (1 988 ms), vert seul (237 ms).

### Ce qui reste

- Mesurer l'ordre sur de vraies matrices OSRM, une fois notre serveur dans l'image ;
  relever alors la limite de 50 (elle protège le serveur public).
- Heures d'arrivée par arrêt à partir de `troncons` (lot 6), « Réoptimiser » depuis
  l'écran (lot 6).
- Afficher « en premier » dans la liste des arrêts ; vrais créneaux horaires (VROOM)
  si la décision 9 change.

### Revue adverse du 23/09 : six défauts, six vrais

- **Bancs du découpage aveugles au regroupement (important) : vrai, corrigé.** Les trois
  bancs recevaient des commandes déjà rangées par côté ; le mutant « couper dans l'ordre
  reçu » les passait. L'entrée alterne désormais ouest et est, et chaque groupe doit
  être d'un seul côté : `[[37, 0], [0, 37]]` (lib), `[[37, 0], [0, 36]]` (serveur),
  28 commandes de l'ouest sur 28 (e2e). Mutant : reçu `[[19, 18], [18, 19]]`,
  `[[19, 18], [18, 18]]`, « Expected: 28 / Received: 14 ». Le code était juste.
- **Conflit avec le lot 3, `fix/adresses-justes` (important) : vrai, corrigé de ce
  côté.** La résolution des adresses d'une tournée appartient au lot 3 (« un seul module
  de géocodage »), qui résout TOUTES les commandes pour nommer TOUTES les adresses
  douteuses ; « arrêter au premier échec » disait l'inverse, dans les mêmes lignes. Ce
  lot rend la boucle de main, retire son banc, range le détail d'un refus sous
  `error.details` (convention du lot 3 ; banc : reçu `undefined` sur l'ancien code), et
  ne réécrit plus les lignes que le lot 3 réécrit (`fail`, `json`, `geocode`, la fin de
  `createStop`). Mesure `git merge-tree` avec `fix/adresses-justes` : `lib/routing.js`
  passe de 5 blocs en conflit à 2, `server.js` de 2 à 1. Restent, à résoudre à la main
  par UNION : la signature de `roadPlan` (`{ geocoder = null, ...options } = {}` ou
  deux lectures), `module.exports` (garder `resoudrePositions`, `injoignables`,
  `decouperEnTournees`, `_reinitialiserRepli` ; retirer `geocode`, que le lot 3 a
  déplacé), l'appel de `roadPlan` dans `POST /api/routes` (passer `geocoder` ET
  `retirerInjoignables`), `createDeliveryRoute` dans `app.js` (le `try` du lot 3
  autour du `POST /api/routes` du lot 7), la fin de `style.css`, `DESIGN.md` et la
  doc. Après fusion : `Object.assign(fail(msg), { details })` reste juste avec le
  `fail` du lot 3.
- **Hors ligne, découpage mis en file (mineur) : vrai, corrigé.** Au-delà de 50
  commandes et hors ligne, l'écran dit « le découpage en tournées demande le réseau.
  Rien n'a été enregistré » avant tout appel. Ancien code : « Hors ligne — enregistré,
  sera envoyé à la reconnexion » et « 1 en attente ». **À la fusion du lot 1**, qui met
  en file sur TOUT échec réseau (pas seulement `navigator.onLine === false`) : ajouter
  `/^\/api\/routes\/decoupage$/` à `JAMAIS_EN_FILE`, sinon le cas « réseau présent mais
  muet » revient.
- **Sans départ, aucun plafond (mineur) : vrai, corrigé.** Mesuré sur la copie de la
  branche : 400 commandes 1,6 s, avec 8 épingles 17,8 s (200 : 0,14 s et 2,2 s).
  `createRoute` refuse au-delà de 50 dans les deux modes (« Sélectionne entre 1 et 50
  commandes par tournée. »), y compris l'appel sans liste (toutes les commandes
  prêtes). Ancien code : 201. L'écran n'utilise pas ce mode ; un appel d'API qui créait
  une tournée de plus de 50 est désormais refusé.
- **Le découpage ignorait « À livrer en premier » (mineur) : vrai, corrigé.**
  `decouperEnTournees(points, depart, max, premiers)` : la tournée qui porte le plus
  d'épingles part d'abord (rotation, l'ordre des directions est gardé) ; une épingle
  restée ailleurs prend la place de la dernière commande sans épingle de la première,
  qui passe en tête de la tournée qu'elle quitte (tailles gardées). Écart : plus
  d'épingles que de places, le surplus reste où il est, sans message.
- **Notification qui taisait la suite (mineur) : vrai, corrigé.** Un arrêt retiré ET
  des commandes pour la suivante : les deux phrases, dans le même message. Mutant
  (ancien message) : reçu « Tournée créée sans Client 00 : injoignable… » seul.
- **Conséquence du cédage au lot 3.** Tant que le lot 3 n'est pas fusionné, `main` garde
  l'ancienne boucle : après un premier échec, les autres workers continuent d'interroger
  le géocodeur (§2 basse). Le lot 3 la remplace par une résolution complète, voulue.

## 23/09 — Lot 3 de l audit géo : des adresses justes

Référence : rapport d'audit du 23/09 (`audit-geo-rapport.md`, code audité `019788c`),
décisions de Thomas du même jour, toutes « oui » aux défauts. Branche
`fix/adresses-justes`, depuis `main` (v1.41.1).

### Ce qui est fait

- **Un seul géocodeur** (`lib/geocodage.js`) pour l'import, le lot de fond, le calcul
  de tournée et la recherche d'adresse : la BAN (`api-adresse.data.gouv.fr`,
  `SEREO_GEOCODER_URL`), un seuil (0,6), une requête (voie + commune, code postal en
  filtre), un cache (table `geocodages`), un User-Agent `Sereo/<version>
  (+<dépôt public>)` — un contact générique, jamais une adresse e-mail. Avant, la
  tournée interrogeait `data.geopf.fr` codé en dur, seuil 0,65, sans cache : une
  adresse « trouvée » à l'import y était refusée.
- **H6** : une commande créée dans l'application (terrain, planifiée, abonnement,
  replanifiée) hérite de la position de son client quand elle se livre à son
  adresse. Le calcul de tournée prend la position du client avant le géocodeur, et
  **mémorise** ce qu'il trouve (commande, client s'il n'en avait pas, cache).
- **H5, H12, décision 8** : un changement d'adresse (Modifier le profil, fiche CRM,
  commande terrain qui corrige le client) efface la position de l'ancienne adresse
  et relance le géocodage en fond. Les commandes non livrées qui se livraient à
  l'ANCIENNE adresse suivent la nouvelle ; celles livrées ailleurs (EHPAD, proche)
  et celles déjà livrées ou annulées ne sont plus réécrites (adresse, téléphone,
  consigne). Une consigne propre à une commande n'est plus écrasée par celle du client.
- **M8** : une position placée par une personne est marquée `geoSource: "manuel"`.
  Le lot ne l'écrase jamais, même avec `forcer` ; il re-vérifie chaque client sous
  le verrou (saisie pendant le lot, adresse changée pendant le lot). Deux lots ne
  tournent plus en parallèle (409), `max` est borné.
- **M5, décision 6** : (0,0), latitude et longitude inversées, et toute position à
  plus de **150 km du départ** de la tournée sont refusés avant l'appel à OSRM, en
  NOMMANT le client ; l'inversion est proposée corrigée. Sans départ (saisie
  manuelle), la borne est la France métropolitaine. « Réessaie » n'est plus dit que
  d'une vraie panne de service.
- **Le calcul liste TOUTES les adresses douteuses d'un coup** (`details.adresses`
  dans la réponse 400), chacune avec son motif et, s'il y en a une, sa proposition.
- **H11** : « Résidence…, Bât. B, Apt 12, », « BP 40012 » sont retirés de la requête
  (l'adresse enregistrée ne change pas : le livreur les lit toujours) ; « CEDEX » et
  le code CEDEX (qui n'est pas un filtre de la BAN) sont gérés ; un code postal lu
  comme un nombre par Excel (1100) redevient 01100 ; un rejet est redemandé après
  30 jours, et n'occupe plus une place du lot en attendant (famine).
- **La précision est gardée** (`geoPrecision` : numéro, rue, lieu-dit, commune,
  manuel) sur le client, la commande et l'arrêt, et signalée : « Position
  approximative : au milieu de la rue ».
- **M4** : un arrêt encore à faire lit sa commande (consigne, adresse, position,
  téléphone, articles). Un arrêt soldé, ou une tournée terminée, garde ce qui a été
  livré. Une commande reportée à une autre date quitte la tournée prête ou en cours
  et redevient « prête à livrer ».
- **Client créé ou modifié au CRM : géocodé** en fond. Une demande pendant un lot
  n'est plus perdue (relance).
- **H7 — écran « Adresses à vérifier »** (sheet au téléphone, fenêtre au bureau,
  `public/js/domains/adresses.js`) : clients sans position, approximatifs, ou dont
  l'adresse a changé après une saisie manuelle ; proposition de la BAN acceptée
  d'un clic ; recherche d'adresse ou « latitude, longitude » collé ; mini-carte
  Leaflet au marqueur déplaçable (ou toucher la carte). Alerte « N clients à livrer
  sans position » dans « Préparer une tournée » (calculée sur les données chargées :
  aucune requête de plus au rechargement). « Corriger la position » dans les autres
  actions de l'arrêt remplace les deux champs numériques qui envoyaient
  l'identifiant de l'ARRÊT au lieu du client. Source citée : « Adresses : BAN ».

### Décisions prises dans le lot

- Accepter une proposition, choisir un résultat de recherche ou déplacer le
  marqueur, c'est une saisie **manuelle** : elle est protégée, et un point
  approximatif ainsi validé ne revient pas dans la liste (sa précision reste affichée).
- Un changement d'adresse garde une position manuelle mais la marque « à vérifier »
  (« Adresse modifiée ») : elle corrigeait peut-être un lieu-dit que la BAN ignore.
- La référence des 150 km est le **départ** de la tournée : aucun dépôt n'est encore
  réglé dans l'application (lot 6).
- Une commande reportée pendant la tournée en est **retirée** (pas seulement
  signalée). En route, le tracé est gardé plutôt qu'effacé sous le livreur.

### Écarts nommés

- **`--focus-ring` n'existe pas en mode sombre** (défini sous
  `:root[data-color-scheme="light"]` seulement) : `box-shadow: var(--focus-ring)`
  n'y peint rien. Trouvé par le banc de ce lot, contourné ici (anneau écrit en
  clair), NON corrigé ailleurs (`.cli-retour`, `.cmd-ligne`…) : hors périmètre.
- L'import Excel, chemin 2 (même bon, contenu modifié), recopie toujours l'adresse
  du fichier sur la commande ; seule la position y est désormais protégée pour une
  commande livrée.
- Le point approximatif n'est pas encore dessiné autrement sur la carte (marqueur
  creux) : c'est le lot 4.
- La consigne d'un arrêt à faire suit celle de la commande : une note saisie par le
  livreur sur un arrêt NON soldé serait remplacée (rare ; les notes d'échec, elles,
  vont dans `problemReason`).
- Une adresse de livraison distincte (EHPAD) n'a pas d'écran propre : elle se
  géocode par son adresse au calcul de tournée (cache), et se corrige dans l'écran
  seulement via le client.
- Mesuré une fois : `carte-et-lignes.spec.js` « trace de repli » a dépassé 3 min
  sous la charge de six fichiers à deux ouvriers ; vert seul (3 s) et au second
  passage de la même charge (44/44). Non reproduit, cause non affirmée.

### Ce qui reste

- Lot 6 : un dépôt réglé (il remplacera le départ comme référence des 150 km, et
  la France métropolitaine pour la saisie manuelle).
- Lot 4 : le marqueur « approximatif » sur la carte, la mention BAN à côté de la
  licence OSM.
- Lot 2 : retirer l'ancien panneau « Clients tournée » (décision 7) — sa saisie de
  coordonnées est déjà remplacée par le bouton de cet écran.
- Plus tard : l'appel groupé CSV de la BAN pour les gros imports ; une colonne
  « Complément » reconnue à l'import.

### Relecture adverse du 23/09 — sept défauts, sept vrais

Chacun a son banc, rouge sur le code relu (`1daf3d9`) pour la cause nommée, vert
après. Aucun n'était faux.

- **Bloquant — la virgule après le numéro** (« 12, rue de Dole », « Rue de Dole,
  12 », « 12 bis, rue X ») : le numéro seul devenait la voie, la rue partait en
  complément. La BAN ne recevait que « 12 », et deux voies différentes au même
  numéro avaient la même clé de cache : un déménagement de « 12, rue de Dole » à
  « 12, avenue Foch » passait inaperçu (position et commandes figées). Le numéro
  isolé est recollé à sa voie. En plus : quand la clé ne change pas mais le texte si
  (« Apt 12 » → « Apt 14 »), le texte suit sur les commandes à livrer et la position
  reste.
- **« Bat » dans un nom de voie** (« rue du Bateau », « chemin de la Batie », « rue
  de Batz ») était coupé comme un bâtiment. « Bat » doit maintenant être suivi d'un
  point ou d'une espace (« Bat B », « Bât. C », « Batiment 2 » restent retirés).
- **Téléphone d'une commande livrée ailleurs** : « Modifier le profil » renvoie le
  téléphone à chaque enregistrement et l'écrasait sur la commande EHPAD. Il ne suit
  plus que si la commande avait le numéro du client (ou aucun), comme la consigne.
  Le paragraphe « Ce qui est fait » disait « adresse, téléphone, consigne » des
  commandes LIVRÉES : c'était vrai d'elles seulement.
- **Import Excel avec Latitude/Longitude** : il écrasait une position placée à la
  main et ne passait pas `verifierPosition`. Une position manuelle est gardée ; une
  position du fichier (0,0), inversée ou hors de France est ignorée et comptée
  (`positionsRefusees` dans la réponse, et dans l'historique).
- **Lot lancé à la main** : une demande arrivée pendant ce lot était perdue (seul le
  lot de fond relançait). Il relance aussi.
- **Stockage JSON** : le calcul de tournée refusait toute commande sans position
  pour « adresse incomplète ». Il interroge de nouveau la BAN, sans cache ; le lot
  de fond reste réservé à SQLite.
- **Focus dans « Adresses à vérifier »** : Annuler, Accepter, Garder et Enregistrer
  détruisaient le bouton actif et le focus retombait sur `<body>`. Il revient sur
  « Placer sur la carte » de la même ligne, sinon sur la ligne qui a pris sa place,
  sinon sur le résumé.

Écarts nommés :

- Le téléphone d'une commande à l'adresse du client, mais qui portait un autre
  numéro (un proche), ne suit plus un changement du numéro du client : c'est voulu,
  comme pour la consigne.
- L'import Excel ne sait toujours pas comparer la position du fichier au départ
  d'une tournée (aucun dépôt réglé, lot 6) : il la borne à la France métropolitaine.
- Un client rattaché par la clé secondaire de l'import (nom + code postal, adresse
  légèrement différente) repart d'une fiche vide côté position, comme avant ce lot :
  non traité ici.
- « Bâtiment C 3 rue de Dole » (complément en tête, SANS virgule) n'est pas nettoyé (le motif
  « en ligne » exige une espace avant) : inchangé, la BAN le trouve souvent quand même.

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

### Relecture adverse du 23/09 — cinq défauts, cinq vrais

Relecture de `f7eed6d`. Chaque défaut a été vérifié avant d'être corrigé ; chaque correctif
a un banc rouge sur le code relu, pour la cause nommée.

- **Important — le « approximatif » disparaissait sur les commandes suivantes.** Vrai, et
  plus large que dit : le client est **reconstruit** à chaque import (`clientsMap`), sa
  précision était perdue ; la commande créée ensuite (chemin 3), la commande de secours de
  `syncWorkflow` et la mise à jour (chemin 2) copiaient le point sans elle. Corrigé : l'import
  garde la précision du point qu'il conserve (un point venu du fichier n'en porte pas) et la
  copie sur les commandes. **Données d'avant le lot** : `geocoderClients` relit la précision
  dans le cache du géocodeur, sans appel réseau, **seulement si le point du cache est celui
  du client** (un point posé à la main ou venu du fichier reste sans mention), et la pose
  sur ses commandes **au même point** — pas sur celles livrées ailleurs (EHPAD, proche).
  Le rattrapage a lieu au prochain géocodage (après un import, ou « Lancer » à la main).
  Rouges : « le client réimporté a perdu sa précision » (`undefined`), « la commande de
  mardi s'affiche comme une adresse exacte » (`''`, chemin 3 seul retiré), « le client
  d'avant le lot n'est jamais rattrapé », « la commande livrée ailleurs a pris la précision
  du client » (garde du même point retirée).
  *Partie fausse du constat* : les commandes terrain et planifiées ne copient **pas** le
  point du client (`createCustomerOrder`, `createPlannedOrder` : ni `lat` ni `lng`) ; le
  calcul de tournée les géocode lui-même et pose la précision (`lib/routing.js`).
- **Mineur — la légende restait en préparation.** Vrai : `.legend.vertical` (grid) et
  `.marqueur-legende` (flex) battaient `[hidden]`. Corrigé par `#carteLegende[hidden]`.
  Rouge : `toBeHidden()` → « visible » au téléphone, sans tournée. Témoin positif : visible
  avec une tournée.
- **Mineur — un échec de `/api/carte/fond` laissait la carte grise.** Vrai. Corrigé : le
  fond est redemandé à 3 s, 10 s, 30 s puis toutes les 60 s, et dès l'événement `online` ;
  une seule couche posée (garde contre deux appels croisés). Rouge : 0 tuile après 12 s.
- **Mineur — la précision GPS recouvrait « N arrêts sans position ».** Vrai (mesure :
  précision 45,610 246×60 sur message 51,612 288×70). Corrigé : les deux sont **empilés** dans
  `.carte-bas` (flex en colonne, précision au-dessus), à 28 px du bas comme l'était la
  précision (le message était à 16 px). Rouge : rectangles qui se croisent.
- **Mineur — un fournisseur sans `SEREO_TUILES_ATTRIBUTION` perdait la licence.** Vrai.
  Décision : la mention d'OpenStreetMap (ODbL, avec le lien) s'affiche à sa place — les fonds
  courants sont faits de ses données — et le démarrage l'écrit dans le journal. Rouge :
  attribution `''`.

**Écarts nommés.** Le géocodage par lot (`geocoderClients`, antérieur au lot 4) réécrit
toujours le point de **toutes** les commandes du client quand il le géocode, y compris
celles livrées ailleurs : la décision « sauf celles livrées ailleurs » relève du lot des
adresses (lot 3), non fait ici. Un arrêt de tournée déjà créé garde sa copie (M4). Si le
service worker a déjà mis `/api/carte/fond` en cache, la relance peut le servir de là :
c'est voulu (hors ligne), et le banc ne compte donc pas les relances, il compte les tuiles.

*Bancs ajoutés : `test/carte-telephone.test.js` (+3 cas : import après géocodage, rattrapage
depuis le cache et commande livrée ailleurs, attribution absente) ;
`test/e2e/carte-telephone.spec.js` (+3 cas « relecture », ports 3194 et 3195).*

## Intégration des lots 1, 3, 4, 5 et 7 (branche integration/geo-vague1) — 23/09

Ordre : lot 7 (meilleur trajet), lot 3 (adresses justes), puis lot 4 (carte au téléphone) ;
ensuite lot 1 (le livreur ne perd plus rien) et lot 5 (rapidité), en fin de section.

**Un seul champ pour la précision d'un point : `geoPrecision`** (lot 3), avec son origine
`geoSource`, portés par le client, la commande et l'arrêt. Le lot 4 avait inventé
`positionPrecision` (`adresse`, `approximative`, `manuelle`) pour la même idée : il est
**retiré partout** (serveur, `app.js`, bancs). Ce que la carte en tire :

| `geoPrecision` | Sur la carte |
| --- | --- |
| `numero` | exact (disque plein) |
| `rue`, `lieu-dit`, `commune` | **approximatif** (`marqueur--approx`, « position approximative » dans le nom, la bulle dit où est le point) |
| `manuel` (posé à la main, ou venu du fichier) | exact — pas dit approximatif |
| vide (point d'avant la précision, non rattrapé) | exact, sans mention |

La partition est celle de `geocodage.precisionApproximative` (écran « Adresses à vérifier »).
Une proposition « rue » acceptée à la main garde `geoPrecision: "rue"` : l'écran ne la
redemande plus (`geoSource: "manuel"`), mais la carte la dit toujours approximative — le
point reste au milieu de la rue.

**Ce qui a été réconcilié.**
- `lib/routing.js` : `resoudrePositions` du lot 3 (décision 150 km, `geoPrecision` déjà portée
  jusqu'à l'arrêt) remplace la boucle de géocodage du lot 4.
- `server.js` : géocodage par lot, normalisation, `createRoute`, `createStop`, import (×3) et
  saisie des coordonnées suivent le lot 3. Le **rattrapage** du lot 4 (client placé avant que
  la précision existe, relu dans le cache BAN s'il est au même point) est gardé, porté sur
  `geoPrecision` : il écrit aussi `geoSource: "ban"`, et ne touche que les commandes qui
  suivent le client **au même point** (ni livrées ailleurs, ni placées à la main). La commande
  de repli de `syncWorkflow` hérite `geoPrecision` comme l'import.
- Un arrêt en cours relit sa commande (`arretVivant`, M4 du lot 3) : la précision se pose sur
  la commande, l'arrêt suit. Le banc e2e du lot 4 la posait sur l'arrêt seul ; il la pose
  maintenant sur les deux, comme `createStop`.
- Les deux « écarts nommés » du lot 4 sont soldés par le lot 3 : le géocodage par lot ne
  réécrit plus les commandes livrées ailleurs (`commandeSuitLeClient`), et une commande née
  dans l'application hérite du point de son client (`heriterPositionDuClient`).
- Conflits en fin de fichier (`DESIGN.md`, `style.css`) : base + ajout de chaque côté,
  reconstruits depuis les trois versions, jamais en ôtant les marqueurs.

**Bancs adaptés, sans les affaiblir.** `test/carte-telephone.test.js` : mêmes cas, mesurés sur
`rue` / `numero` / `manuel`, plus l'absence de `positionPrecision`. `test/e2e/carte-telephone.spec.js` :
arrêt 6 `rue` (approximatif), arrêt 5 `manuel` et arrêt 2 `numero` (non), et en préparation un
point `commune` (approximatif) à côté d'un `numero` et d'un `manuel`. Mutations, chacune rouge
pour sa cause : la carte relit `positionPrecision` (le défaut d'intégration même) ; seule
`rue` approximative ; `manuel` ou `numero` dits approximatifs ; rattrapage coupé ; garde du
même point retirée ; import qui perd la précision ; saisie manuelle dite `numero` ;
`street` rendu `numero`.

*Non couvert par un banc : la commande de repli de `syncWorkflow` (héritage de
`geoPrecision`).*

### Lots 1 et 5, fusionnés ensuite (23/09)

Ordre : lot 1 (`fix/livreur-ne-perd-rien`, fusion `1486edc`), puis lot 5
(`perf/tournees-rapides`, fusion `c2dfa87`), puis la réconciliation (`19f399b`).

**Conflits de texte.**
- `DESIGN.md` : ajouts en fin des deux côtés, et pour le lot 1 une note au milieu
  (§ file hors ligne, « la garde est tombée ») : `ajouts.py` refuse (code 2) ;
  reconstruit depuis les trois versions — notre version, la note du lot 1, puis la
  section de chaque lot (219 et 186 lignes, exactement leurs diffs).
- `style.css` : ajouts en fin (`ajouts.py`).
- `app.js` : la carte « À livrer en premier » (lot 7) et le statut affiché
  « À reprogrammer » (lot 1), indépendants : les deux ; l'écoute des réponses
  tardives (lot 1) et `recopierApresGeste` (lot 5) : les deux ; `refreshActiveRoute`
  garde la garde `updatedAt` du lot 1 et `garderTrace`/`chargerTraceOmise` du lot 5.
- `sqliteStore.js` : `gestes_recus` (lot 1) et `traces_tournees` (lot 5), les deux.
- `server.js` : le plafond de 50 commandes posé deux fois (revue du lot 7, lot 5) : un
  seul, sur `MAX_COMMANDES_PAR_TOURNEE` ; `arretVivant` (lot 4) et l'index `Map` des
  commandes (lot 5) dans `normalizeRoute` ; `premiers` (lot 7) et la sélection exigée
  (lot 5) dans `POST /api/routes`.
- `operations-api.js` : `/api/geocode` garde le cache et la limite de débit du lot 5
  devant le géocodeur du lot 3 (`geocodage.rechercher`, BAN). Conflit sémantique : le
  banc du relais bouchonnait `data.geopf.fr` ; la recherche part désormais vers
  `api-adresse.data.gouv.fr` et le banc échouait. Le bouchon prend les deux.

**Le chemin des gestes d'arrêt : les deux garanties.** Le lot 1 tenait l'écran après
un geste PAR le rechargement complet qui le suivait (`refreshActiveRoute` : jamais une
tournée plus ancienne, gestes en file superposés ; `X-Sereo-Frais` ; copie du service
worker rafraîchie par ce rechargement). Le lot 5 a remplacé ce rechargement par la mise
à jour ciblée (`appliquerGesteArret`), qui ne passait par aucune de ces gardes. Sur la
fusion brute, quatre trous, chacun corrigé :

| Trou (fusion brute `c2dfa87`) | Correctif | Banc |
|---|---|---|
| la réponse d'un geste effaçait de l'écran un geste qui attend dans la file | `appliquerGesteArret` appelle `appliquerGestesEnFile` | e2e « un geste EN FILE reste à l'écran » |
| deux réponses croisées : la plus ancienne ramenait l'arrêt suivant « Prêt » | garde `updatedAt` dans `appliquerGesteArret` ; une réponse tardive ne déplace plus l'écran si le livreur a choisi un autre arrêt | e2e « se CROISENT » |
| un chargement parti avant un geste et fini après remettait les commandes d'avant, et plus rien ne les relisait | ce croisement (et lui seul) relance un chargement frais ; il n'efface plus le drapeau « écriture non relue » | e2e « chargement parti AVANT » |
| le service worker rangeait, par-dessus la recopie de la page, la réponse d'une requête partie avant le geste | la page annonce chaque écriture (`sereo-ecriture`) ; le service worker ne range plus une réponse à une requête partie avant | `service-worker-api.test.js` + e2e « annonce chaque écriture » |

Les bancs e2e : `test/e2e/integration-lots-1-5.spec.js` (port 3190, service worker
bloqué sauf pour le dernier cas). Chacun rouge sur la fusion brute, lancé seul (le mode
`serial` laisse les suivants « did not run » après un premier rouge), et sur chaque
correctif retiré seul (mutation par copie, restauration vérifiée par empreinte) : 5
mutants sur 5, chacun de sa cause.

**Côté serveur, rien à corriger — prouvé.** L'écriture ciblée du lot 5 écrit ce que le
lot 1 ajoute : `test/integration-lots-1-5.test.js` relit le FICHIER par une seconde
connexion (ni cache du store, ni `readDb`) après « Absent » (`a_reprogrammer` en colonne
et en payload, la cause, `updatedAt` de la tournée), après « Livré » avec `faitLe`
(`deliveredAt` de la commande et de l'arrêt), et après d'autres écritures ciblées puis
une réécriture complète (`gestes_recus` intact, le renvoi n'applique rien). Pris par 4
mutants sur 4 : mise à jour sautée (seules les insertions), empreinte aveugle au
payload, écriture qui vide `gestes_recus`, `faitLe` non transmis par la route.

**`meilleur-trajet.spec.js:45` — cause trouvée, au banc.** « Impossible de calculer le
trajet routier. » (400), en suite complète seulement. Rejoué 25 fois sous la charge de la
suite : vert. Journal du serveur semé et de `lib/routing.js` pendant un rouge : la table
du routage simulé faisait **8 × 8** pour une tournée de 6 points. `jeuDeDonnees()` rendait
le tableau `CLIENTS` du module comme `clients` du semé ; `adresses-a-verifier.spec.js` et
`clients.spec.js` y ajoutent deux clients chacun : les bancs lancés ensuite dans le même
ouvrier héritaient d'un `CLIENTS` allongé, et `demarrerRoutage()` dimensionne sa table
dessus. Reproduit 3/3 (`adresses-a-verifier.spec.js meilleur-trajet.spec.js
--workers=1`) ; corrigé (clients gelés, chaque semé reçoit sa copie) : 3/3 vert ; banc
`test/serveur-seme.test.js`. Vu en chemin, défaut distinct et corrigé aussi : un port déjà
pris faisait parler `demarrer()` au serveur d'un autre (le 200 de `/healthz` d'autrui) —
reproduit en occupant 3198, il refuse désormais de démarrer. Ce n'était pas la cause de
ce rouge : le commit `f1fd819` le présente comme mécanisme possible, la cause est dans
`18f299c`.

**Vérifié** sur `18f299c` : `npm run check` ; `npm test` 538/538 ; e2e des bancs des lots
1, 3, 4, 5, 7 et de l'intégration + tournee, tournee-mobile, ecran-livreur, hors-ligne,
operations, livraison-chargement, chargement-instantane : 97/97 (sur `19f399b`) ; suite
e2e complète deux fois : 401/401 et 401/401.

**Écarts nommés.**
- La recopie du lot 5 écrit dans le cache ce que l'écran montre, gestes en file
  superposés compris (avec « En attente d'envoi ») : rouverte, la copie les montre faits.
  La file les superpose de toute façon et retire la mention s'ils sont partis ; un geste
  refusé au renvoi reste montré fait jusqu'au prochain chargement — comme l'écran.
- La barrière du service worker est en mémoire : un service worker redémarré entre le
  geste et l'arrivée d'une réponse d'avant ne la connaît plus (même limite que la garde
  du lot 1, dite dans sa section).
- `demarrer()` : un port pris dans les millisecondes entre son contrôle et le lancement
  n'est pas vu (`/healthz` ne dit pas qui répond). Les ports sont uniques dans ce dépôt,
  pas entre les worktrees qui lancent les mêmes bancs en même temps.
- `service-worker.js` : `CACHE_NAME` n'a pas été changé (lots 1, 3, 5) ; le nom servi
  suit l'empreinte du contenu de `public/` (`lib/empreinte-shell.js`), le changement est
  donc pris sans lui.

## Lot 1 de l'audit géo — « le livreur ne perd plus rien », posé le 23/09

Source : audit « localisation, carte, tournées » du 23/09 (code audité : `019788c`),
constats C1, H1, H2, H3, H4, M1, M6, M9. Décision retenue pour C1 : **retour
automatique**, marqué « À reprogrammer », sans bouton à toucher.

### Ce qui est posé

- **C1 — un absent n'est plus une impasse.** « Absent » et « Problème » passent la
  commande à `a_reprogrammer` (et non plus `probleme_livraison`, qu'aucune liste ne
  proposait et qu'aucun bouton ne faisait sortir). La cause reste dans
  `deliveryStatus` et dans l'arrêt. La commande revient d'elle-même dans « Commandes
  prêtes à livrer », badge « À reprogrammer ». Les commandes **déjà** bloquées en
  `probleme_livraison` reviennent aussi (serveur et écran les listent ; la transition
  `probleme_livraison → en_livraison` existait). Une commande à relivrer n'est pas
  cachée par le filtre de date, et un arrêt déjà traité ne la retient plus dans sa
  tournée (« appartient déjà à une tournée active » ne compte que les arrêts encore
  à faire).
- **Le stock** : la réservation est **gardée** pour la relivraison (le patron déjà
  écrit en tête de `RESERVED_ORDER_STATUSES`), jamais prise une seconde fois (le
  départ de tournée ne réserve rien), et **consommée** à la livraison. Mesuré sur le
  banc : 12 réservées avant l'absent, 12 après, 12 après le départ de la nouvelle
  tournée, 8 après « Livré » ; le stock en rayon ne bouge pas.
- **M1** : une commande en échec ne se replanifie plus en clone (400, message qui
  renvoie aux commandes prêtes) ; « Planifier la suite » ne s'active que sur un arrêt
  livré. La suite d'une commande livrée reste permise.
- **H1** : toute écriture dont l'envoi échoue — réseau muet alors que le téléphone
  se croit en ligne, délai dépassé (10 s pour un geste d'arrêt, 30 s sinon),
  passerelle 502/503/504 — part en file. Le risque qui justifiait l'ancienne prudence
  (un délai dépassé alors que le serveur a traité : le renvoi dupliquerait) est tenu
  par une **clé d'idempotence** : chaque écriture porte `X-Sereo-Geste`, gardée dans
  la file ; le serveur (`gesteIdempotent`) n'applique une clé qu'une fois, et fait
  attendre un doublon simultané. Table SQLite `gestes_recus`, hors `readDb/writeDb`,
  14 jours. Le bandeau nomme ce qui attend (« 1 livraison en attente d'envoi :
  Dupont. », « … : Martin (absent) ») et l'arrêt porte « En attente d'envoi ». La
  file repart seule : à la première réponse du serveur, et toutes les 20 s — le
  téléphone qui se croit en ligne n'émet jamais « online ». Plus aucun message brut
  du navigateur (« Failed to fetch ») : « Impossible de joindre le serveur. Vérifie ta
  connexion. » La **purge** et les **comptes** ne sont jamais mis en file (rejouée plus
  tard, une purge effacerait le travail fait entre-temps ; un mot de passe n'a rien à
  faire en clair dans `indexedDB`).
- **H2** : au renvoi, 401 et 429 **gardent** toute la file et renvoient vers la
  connexion (une fois par minute au plus, pour ne pas boucler) ; la file repart à la
  réouverture. Un geste qui rencontre la session expirée en direct part en file avant
  la redirection. Le **secret de session** : sans `SEREO_AUTH_SESSION_SECRET`, le
  serveur écrit un secret aléatoire dans le dossier de données (`session-secret`, à
  côté de la base, jamais dans le dépôt) et le relit ; un redémarrage — donc chaque
  mise à jour déployée — ne déconnecte plus. La variable reste prioritaire. Dossier
  non inscriptible : ancien comportement, dit dans le journal.
- **H3** : un geste mis en file fait avancer l'écran à l'arrêt **suivant** de celui du
  geste, comme en ligne. Un second geste sur un arrêt déjà en file est refusé à
  l'écran (il aurait été refusé au renvoi, donc perdu).
- **H4** : le service worker met en cache la réponse arrivée **après** son repli de
  3 s et prévient la page (`sereo-api-tardive`), qui remplace la copie à l'écran —
  sauf si la requête est partie avant la dernière écriture. Après une écriture,
  `loadData` envoie `X-Sereo-Frais` : pas de repli, et un échec **garde** ce que
  l'écran montre (« Mise à jour impossible »), jamais la copie d'avant le geste ni
  une liste vide. La tournée affichée n'est jamais remplacée par une version plus
  ancienne (`updatedAt`, posé à chaque geste d'arrêt). Les gestes d'arrêt en file
  sont superposés à toute donnée rechargée.
- **M9** : un seul renvoi à la fois (promesse partagée, et Web Locks entre onglets),
  plus un tour pour ce qui a été déposé pendant.
- **M6** : « Livré » envoie l'heure de l'**appui** (`faitLe`), gardée dans la file ; le
  serveur date l'arrêt et la commande de cette heure, bornée : pas dans le futur
  (marge 5 min), pas plus de 7 jours (défaut ; plage raisonnable 3 à 14), pas avant le
  départ de la tournée.

### Bancs, et le rouge de chacun

Chaque correctif retiré seul (mutation par copie, restauration par copie), le banc
rougit de la bonne cause :

| Correctif retiré | Banc | Rouge |
|---|---|---|
| absent → `probleme_livraison` | `livreur-ne-perd-rien.test.js` | reçu `probleme_livraison`, attendu `a_reprogrammer` |
| bloquées hors de la liste | idem | « Aucune commande prete selectionnee », 400 au lieu de 201 |
| filtre de date sans exception | idem | 400 au lieu de 201 (4 cas) |
| garde « tournée active » sur tous les arrêts | idem | « appartient déjà à une tournée active » |
| M1 retiré | idem | 201 au lieu de 400 : le clone est créé |
| M6 serveur retiré | idem | daté de l'arrivée, deux heures après le geste |
| idempotence débranchée | idem | 6 commandes au lieu de 5 ; 7 pour 3 envois simultanés |
| secret aléatoire | idem | deux signatures différentes après redémarrage |
| 401/429 traités en refus | `file-attente.test.js`, e2e H2 | file vidée (0 au lieu de 2) ; pas de renvoi vers la connexion |
| 502/504 comptés en essais | `file-attente.test.js` | bloquée à la 6ᵉ tentative |
| verrou de renvoi (les deux) | idem | 9 requêtes pour 3 écritures |
| relance après dépôt | idem | l'écriture déposée pendant le renvoi reste en file |
| résumé non gardé | idem | `resume` indéfini |
| service worker de v1.41.1 | `service-worker-api.test.js` | copie jamais rafraîchie ; copie servie après écriture ; copie au lieu de l'échec |
| mise en file seulement hors ligne | e2e H1, `hors-ligne` | file vide : « le Livré est perdu » |
| bandeau sans noms | e2e H1 | « 1 modification en attente d'envoi. » |
| aucun renvoi sans « online » | e2e H1 | le serveur reste `en_livraison` |
| message brut | e2e purge | « Failed to fetch » |
| purge mise en file | e2e purge | « enregistré, sera envoyé » |
| H3 retiré | e2e H3 | l'écran revient au premier arrêt restant au lieu du suivant |
| redirection retirée | e2e H2 | pas de nouveau document |
| `faitLe` non envoyé | e2e H2 + M6 | `NaN` |
| `X-Sereo-Frais` retiré | e2e H4 | 111 échantillons « En livraison » après « Livré » |
| écoute des réponses tardives retirée | e2e H4 | reçu « Prêt », attendu « Livré » |
| front C1 (bloquées, date) | e2e C1 | carte absente |

Deux redondances, dites : le verrou de la page seul retiré, les Web Locks tiennent
encore la concurrence (seule la relance rougit) ; le cas e2e H2 rougit sur la
redirection avant la file (le banc unitaire, lui, montre la file vidée). Et une
leçon : le premier banc H3 ne distinguait rien — la superposition des gestes en file
fait déjà sauter l'écran au premier arrêt restant, qui était aussi le suivant.
Il saute désormais un arrêt d'abord.

Le banc `hors-ligne.spec.js` « en ligne — un échec réseau n'est PAS mis en file » est
**renversé**, pas supprimé : il exige désormais la mise en file ET la clé.

Exécutions : `npm test` 439/439 ; e2e des bancs touchés (livreur-ne-perd-rien,
hors-ligne, tournee, tournee-mobile, ecran-livreur, livraison-chargement,
chargement-instantane, operations, etats-limites, abonnements-mobile, tabs) : 75/75
au second passage. Au premier, à deux ouvriers, deux rouges non reproduits seuls ni
au second passage : `tournee-mobile` « Annuler DÉFAIT » (le clic est tombé après les
4 s du toast : l'envoi est parti) et `chargement-instantane` « requêtes retenues »
(précondition : aucune requête encore arrivée au mandataire). Dits, non corrigés.
*(Le second est fermé le 23/09 : voir « Banc chargement-instantane stabilisé ».)*

### Écarts nommés, hors de ce lot

- **M10 / arbitrage 4** : l'application ne se rouvre toujours pas hors ligne ; seule la
  superposition des gestes d'arrêt en file est faite.
- **La file est celle du navigateur, pas de la personne** : si un autre compte se
  connecte sur le même téléphone, il renvoie les gestes du premier sous son nom.
- **Une commande « À reprogrammer » ne s'annule pas** : aucune transition
  `a_reprogrammer → annulee`, aucun bouton ; une commande refusée par le client revient
  donc dans les commandes prêtes, stock réservé, jusqu'à la libération manuelle par
  l'API (`release-stock`).
- **« Planifier la suite » d'une commande livrée** perd toujours consignes et
  coordonnées (le reste de M1).
- **L'ancien arrêt d'une commande reprogrammée** reste « Absent » dans sa tournée ;
  rien n'empêche encore de le re-marquer (M2, lot 2).
- Une écriture en direct peut passer **avant** des écritures plus anciennes en file ;
  seul le même arrêt est protégé.
- Les écritures autres que les gestes d'arrêt, mises en file, ne sont pas superposées
  à l'écran (une commande terrain en attente n'apparaît qu'une fois envoyée).

### Relecture adverse du lot 1 (23/09) — sept défauts vérifiés, six corrigés

Chacun vérifié avant d'être corrigé ; chaque correctif a son banc, rouge prouvé sur
l'ancien code (ou sur un mutant qui ne retire que lui).

- **Un 500 passager bloquait la file pour toujours** (important, vrai). Un 5xx comptait
  un essai sans pause, et le renvoi repart toutes les 20 s et à chaque lecture réussie :
  cinq essais en quelques secondes, puis l'entrée n'était plus jamais renvoyée, sous un
  toast répété. Désormais : pause après un 5xx (30 s, 1 min, 2 min, 4 min, puis 15 min),
  une entrée à bout d'essais est **retentée tous les quarts d'heure** au lieu d'être
  abandonnée, et le blocage est annoncé **une fois** (et dans le bandeau). (Une garde
  « un passage arrêté ne se relance pas » a été retirée à la reprise, voir plus bas.)
  Bancs : `file-attente.test.js`
  (rafale : 5 envois → 1 ; entrée bloquée avant la mise à jour : repart),
  `livreur-ne-perd-rien.spec.js` « 500 passager » (ancien code : `Received: 5` ; mutant
  « toast à chaque fois » : `Received: 8`).
- **Le renvoi n'avait aucun délai** (important, vrai). Chaque envoi de la file est coupé à
  15 s (signal + course), compté comme un échec réseau, sans essai. Banc :
  `file-attente.test.js` « renvoi MUET » (ancien code : la file reste gelée).
- **L'idempotence se libérait à la fermeture de la connexion** (mineur, vrai). La clé se
  libère désormais à la fin du traitement (`res.end`) ; une connexion fermée sans réponse
  la garde (filet de 3 min). Banc : `livreur-ne-perd-rien.test.js` « ABANDONNE »
  (mutant `close` : 6 commandes au lieu de 5). **Reste ouvert** : `withWriteLock` qui
  expire à 60 s répond 500 pendant que le traitement continue ; la clé n'est pas gardée
  (5xx) et un renvoi peut s'appliquer une seconde fois.
- **Le service worker rangeait une réponse tardive par-dessus une plus récente** (mineur,
  vrai). Numéro d'ordre par requête : une réponse ne se range (ni ne s'annonce) que si
  aucune requête partie après elle n'a rangé la sienne. Banc :
  `service-worker-api.test.js` (ancien code : la copie revient à `en_livraison`).
- **Le corps de la réponse sans délai ni traduction** (mineur, vrai, antérieur au lot).
  Délai propre au corps ; message français ; si les en-têtes disaient 2xx, le geste est
  fait : l'écran avance comme sur un succès. Bancs e2e « corps CASSE » et « corps qui ne
  vient JAMAIS » (ancien code : l'écran reste sur l'arrêt).
- **`data/session-secret` pas exclu du contexte Docker** (mineur, vrai). `.dockerignore`
  exclut `data/` en entier, comme `.gitignore`. Banc : `dockerignore.test.js`.
- **Le jour de vente reste la date UTC de `deliveredAt`** (mineur, vrai, antérieur) :
  mesuré (`2026-09-23T22:40Z` → `2026-09-23`, Paris : le 24). **Non corrigé** : il faut
  passer toutes les bornes de `computeStatistics` en Europe/Paris, hors du lot ; le
  commentaire M6 le dit désormais.

Vu en passant, non corrigé : `tournee-mobile` « 4b — hors ligne : les gestes qui suivent
un Livre » échoue lancé seul (`-g`, 4 fois sur 4) **aussi sur `main` (ef470c6)** ; il
passe dans son fichier complet. Le banc H2 de ce lot avait une course (le vrai « online »
de `setOffline(false)` renvoie vers `/login` pendant le `page.evaluate`) : tolérée.

### Reprise de la correction (23/09, après une limite d'utilisation) — chaque rouge rejoué

L'agent de correction a été coupé après ses commits, avant son compte rendu. Chaque
correctif annoncé ci-dessus a été rejoué **contre l'ancien code**, par copie restaurée :

- `file-attente.js` de 1b33cdc : « rafale » `5` envois au lieu de `1` ; « bloquée avant la
  mise à jour » `0` au lieu de `1` ; « renvoi MUET » : la file reste gelée.
- `service-worker.js` de 1b33cdc : la copie revient à `{ arret: 'en_livraison' }` ; le
  témoin (réponse tardive sans requête plus récente) reste vert.
- `gesteIdempotent` libérant à la fermeture : `6` commandes au lieu de `5`.
- `.dockerignore` de 1b33cdc : `data/session-secret` n'est pas exclu ; le témoin reste vert.
- `app.js` de 1b33cdc, file neuve : le blocage annoncé `4` fois au lieu d'`1` ; app et file
  de 1b33cdc : `Received: 5` renvois. « corps CASSE » et « corps qui ne vient JAMAIS » :
  l'écran reste sur « EHPAD Les Tilleuls… ». (Attention : lancés ensemble, en mode
  `serial`, un premier rouge laisse les suivants « did not run » ; chaque rouge a été
  rejoué seul.)

Deux écarts trouvés, et réglés :

- **Un correctif sans banc.** La garde `!bilan.arrete` de `viderLaFile` (« un passage
  arrêté ne se relance pas aussitôt ») : retirée seule, **tout reste vert** — la pause
  après un 5xx fait déjà qu'un tour redemandé s'arrête sans rien envoyer. Retirée du code
  plutôt que gardée sans preuve.
- **Le chemin le plus fréquent n'avait pas de banc.** Les bancs « corps » passent par
  « Absent ». Le `return` sur `recuParLeServeur` de `envoyerLivraisonEnSuspens` (le
  « Livré » différé, soldé par le geste suivant) n'était distingué par rien. Nouveau banc
  « « Livré » dont le corps CASSE, puis « Absent » aussitôt » : sans ce `return` (mutant, et
  app.js de 1b33cdc), l'erreur remonte, `solderLivraisonEnSuspens` la prend pour un refus
  et **arrête le geste suivant** — `Received: "pret_livraison"` pour l'arrêt qui devait
  passer « Absent ».

Toujours ouvert : `withWriteLock` qui expire à 60 s (voir plus haut). Et une lecture
(GET) dont le corps casse lève « Le serveur a bien reçu la demande… » (lu dans
`apiFetch`, non mesuré à l'écran) : exact, mais écrit pour une écriture.

## Lot 5 de l'audit géo : rapidité (23/09)

Source : rapport d'audit du 23/09, §4 (performance), §6 (vie privée) et décision 5
de Thomas (« oui » : position « Me localiser » à ~100 m, purge à 12 mois). Branche
`perf/tournees-rapides`, partie de `main` 1.41.1 (`ef470c6`).

### Fait

- **§4, « une ligne »** — `syncWorkflow` construit l'index des commandes UNE fois ;
  `normalizeRoute` le reconstruisait pour chaque tournée (O(tournées × commandes)).
  Banc : 1 000 commandes, 200 tournées, insertions dans des `Map` comptées pendant
  `writeDb` — 201 010 avant, sous 60 000 après.
- **§4, écriture ciblée** — `storage/sqliteStore.js` ne supprime plus 13 tables
  pour les réinsérer : il calcule les mêmes lignes qu'avant, les compare à
  l'empreinte (sha1) de ce que la base contient, et n'écrit que ce qui change,
  dans une transaction. L'état connu est un cache vérifié à chaque écriture par
  `PRAGMA data_version` (une autre connexion a écrit → relu) : un cache faux peut
  faire une écriture de trop, jamais en sauter une. Les rangs (`sort_order`) sont
  gardés tant que l'ordre relatif tient ; un ajout en tête (`addHistory`,
  `createRoute`) prend un rang plus petit. Un seul chemin d'écriture (la graine
  JSON d'une base neuve passe par le même).
- **§4, tracés hors de la liste** — le tracé d'une tournée vit dans
  `traces_tournees`, hors du payload ; `readDb` ne le charge que pour les
  tournées non terminées ; migration à CHAQUE ouverture, sur les seuls payloads
  qui portent encore un tracé (une sauvegarde d'avant, ou un retour à une version
  d'avant puis une remontée : ce tracé-là est le plus récent, il remplace celui
  de la table). `GET /api/routes` n'envoie plus le tracé
  des tournées terminées (`traceOmise: true`) ; `GET /api/routes/:id` le rend.
- **§4, mise à jour ciblée** — la réponse d'un geste d'arrêt porte la tournée,
  l'arrêt, la commande et le client tels que les listes les rendent
  (`etatApresGesteArret`, après `writeDb`). « Livré » (`envoyerLivraisonEnSuspens`),
  « Absent » / « Problème » (`updateCurrentDeliveryStatus`) et le déplacement d'un
  arrêt remplacent ces objets et redessinent (`renderAll({ lectures: false })`)
  au lieu de relancer `loadData()`. Points d'entrée des gestes et file d'attente
  (lot 1) inchangés : seul le rechargement qui suivait le succès est remplacé ; un
  échec recharge comme avant. La fin de tournée recharge une fois. Une tournée
  terminée garde son tracé à l'écran (`garderTrace`), ou le redemande.
- **Décision 5, position** — « Me localiser » arrondit à 3 décimales sur le
  téléphone (la position exacte ne part plus, ni au serveur ni au calcul routier) ;
  `normalizeRoute` arrondit aussi à chaque écriture ce qui porte le libellé
  « Ma position actuelle », y compris les tournées déjà enregistrées. Leur
  **tracé** aussi : les sommets à moins de 150 m de la position arrondie sont
  remplacés par elle (`rognerTraceGps`, dans `normalizeRoute` ; au démarrage pour
  les tournées terminées, dont `readDb` ne charge pas le tracé).
- **Décision 5, purge** — chaque jour (une minute après le démarrage, puis toutes
  les 24 h), les tournées **terminées** depuis plus de 12 mois partent avec leurs
  arrêts et leur tracé. Avant : `writeBackupNowAsync("avant-purge")`, forcée ; si
  elle échoue ou n'écrit rien, pas de purge. La sauvegarde se fait HORS du verrou
  d'écriture (les « Livré » ne l'attendent pas) ; la base est relue sous le
  verrou, et seule part une tournée que la sauvegarde contient sous sa forme
  actuelle. Les commandes restent (chiffre
  d'affaires et statistiques se calculent sur elles : banc « statistiques
  identiques avant/après »). Journalisée (historique, type « Purge »).
  `SEREO_PURGE_TOURNEES_MOIS` (0 = coupée), documentée dans `.env.example`.
  Mécanisme de sauvegarde vérifié : `writeBackupNowAsync` fait un checkpoint WAL,
  gzip le fichier, renomme atomiquement ; rotation à 30 fichiers.
- **§4, plafond « sans départ »** — `POST /api/routes` exige 1 à 50 commandes,
  avec ou sans départ (avant : `{}` prenait toutes les commandes prêtes) ;
  `createRoute` plafonne aussi.
- **§4 et §6, relais d'adresse** — `/api/geocode` : cache de 500 recherches (24 h,
  saisie normalisée) et seau à jetons par compte et par IP (rafale 5, puis 1/s).

### Mesures avant / après

Script de l'audit (`perf-db.js` : 600 clients, 25 arrêts par tournée, tracé réel
de 3 000 points ≈ 100 km), même PC, `ef470c6` contre ce lot, lancés à la suite.
Le poste était partagé avec d'autres agents : les deux séries « avant » à 250
diffèrent du simple au double ; ce sont des ordres de grandeur.

| Historique | Mesure | Avant | Après |
|---|---|---|---|
| 0 | « Livré » (PATCH), médiane de 5 | 28 ms | 19 ms |
| 250 | « Livré » (PATCH), médiane de 5, deux séries | 1 578 / 1 711 ms | 372 / 599 ms |
| 250 | `readDb` | 413-665 ms | 108-154 ms |
| 250 | `writeDb` (base inchangée, `syncWorkflow` compris) | 1 178-1 476 ms | 282-476 ms |
| 250 | `GET /api/routes` (gzip) | 5 118 Ko | 263 Ko |
| 250 | chargement complet (17 requêtes) | 7,8-14,8 s | 2,2-2,6 s |
| 250 | après un geste | le chargement complet | 0 requête (réponse du PATCH, 21 Ko) |
| 500 | « Livré » (PATCH), médiane de 5 | 2 736 ms | 547 ms |
| 500 | `GET /api/routes` (gzip) | 10 215 Ko | 506 Ko |
| 500 | chargement complet (17 requêtes) | 15,6 s | 3,3 s |

Un profil (`--cpu-prof`) a montré que l'empreinte coûtait plus en petits
`update()` qu'en hachage : une chaîne, un `update` — écriture sans changement,
store seul, 290-470 ms → 150-210 ms.

### Bancs et preuves

`test/lot5-rapidite.test.js` (16 cas depuis la revue) et
`test/e2e/rapidite-tournee.spec.js` (6 cas, serveurs semés 3196 et 3197). Rouges sur le code d'avant, de la bonne cause :
index des commandes (201 010 insertions) ; écriture ciblée (journal par
déclencheurs SQLite : « les tournées terminées ont été réécrites ») ; migration
(« le tracé d'une tournée terminée est encore relu ») ; liste (« la liste envoie le
tracé ») ; réponse du geste (« ne porte pas le client ») ; position (« stockée au
centimètre ») ; purge (« la tournée de 13 mois n'a pas été purgée ») ; plafond
(60 arrêts sans sélection) ; relais (« la même recherche est repartie 2 fois ») ;
e2e « Livré » et « Absent » (22 lectures après le geste) ; fin de tournée (« le
tracé a disparu de la carte ») — CE défaut-là naît du lot lui-même (la liste sans
tracé), le banc le tient ; « Me localiser » (47.2381234 reçu).
Gardes neuves prouvées par mutants (le code d'avant n'a pas de purge ni
d'écriture différentielle) : banc d'équivalence (60 mutations au hasard, base
différentielle = base réécrite d'un coup) pris par 4 mutants sur 4 (rang en tête,
tracé absent effacé, suppression oubliée, renumérotation oubliée) ; purge prise
par 3 sur 3 (échec de sauvegarde ignoré, pas de sauvegarde, tournée active
purgée) ; relais pris par 2 sur 2 (sans limite, sans cache).

### Écarts nommés

- **503, pas 429**, pour le relais d'adresse saturé : `apiFetch` traite tout 429
  comme un verrou de connexion et renvoie à `/login`.
- **Tableau de bord, statistiques, historique** ne sont plus rechargés à chaque
  geste : à la fin de la tournée, par le sondage de l'accueil (60 s), ou à la
  prochaine ouverture. Pendant la tournée, ils peuvent retarder de quelques arrêts.
- **« Sans tracé » = `terminee` seulement** (liste et `readDb`). Un statut de
  clôture ajouté plus tard (lot 2 : annulée, clôturée) charge son tracé tant qu'il
  n'est pas ajouté aux deux ensembles : plus lent, jamais faux.
- **L'arrondi de position se fonde sur le libellé** « Ma position actuelle »
  (seul `operations.js` le pose). Une adresse choisie (dépôt) n'est pas arrondie.
- **La sauvegarde « avant-purge » est dans la rotation** (30 fichiers) : elle part
  avec elle. Voulu : la purge sert la vie privée, une archive éternelle la
  contredirait. C'est un filet contre une purge fautive, pas une archive.
- **Une commande garde son `routeId`** vers une tournée purgée (rien ne le suit à
  l'écran ; `shouldPreserveClientAfterImport` s'en sert encore, dans le bon sens).
- **Revenir à une version d'avant** : elle ne lit pas `traces_tournees`, les tracés
  des tournées en cours ne s'y affichent pas (recalculables) ; en remontant, les
  tracés reviennent, et un tracé écrit entre-temps dans un payload (recalculé, ou
  effacé : `geometry: null`) gagne sur celui de la table, à l'ouverture.
- **La copie « dernières données » après un geste** est recopiée par la page
  (tournées, commandes, clients), pas relue au serveur : elle dit ce que l'écran
  affiche. Son en-tête `Date` reste celui de la copie d'avant : l'étiquette
  « Données de 08:00 » peut sous-estimer sa fraîcheur, jamais la surestimer. Les
  autres données (tableau de bord, statistiques) y gardent leur retard.
- **Un geste sur un arrêt déjà terminé** (« Absent » tapé sur un arrêt livré)
  reste accepté par le serveur : c'est aussi le chemin d'une correction légitime
  (« Livré » tapé par erreur). Pas de garde ajoutée ici (lot 1, gestes du livreur).
- **Tracé rogné autour de « Me localiser »** : le tracé part d'un segment droit
  depuis la position arrondie (au plus 150 m de route invisibles), aussi pour les
  tournées calculées après le lot.
- **Sauvegarde « avant-purge » hors verrou** : comme les sauvegardes automatiques
  de `writeDb`, elle lit le fichier pendant que des écritures peuvent passer par le
  WAL ; un checkpoint automatique (1 000 pages) pendant la compression la rendrait
  incohérente — risque partagé avec toutes les sauvegardes existantes, non mesuré.
  Une autre sauvegarde automatique ne court jamais en même temps (`pendingBackup`).
- **`sort_order` de `lignes_commande` et `livraisons`** devient un rang global
  (c'était l'indice de ligne) ; aucune lecture ne s'en sert (grep).
- Sous charge (autres agents sur le poste), trois rouges vus une fois et non
  reproduits : `C2.stock.a` (seuil de 250 ms, 1 suite complète sur 3),
  `tournee-mobile` « sous le pouce » (1 sur 3), `carte-et-lignes`
  `ERR_CONNECTION_REFUSED` sur 3141 (port fixe, partagé entre worktrees). Aucune
  cause affirmée.

### Revue adverse (23/09)

Quatre défauts relevés sur `73cc8de`, tous vérifiés vrais, tous corrigés :

- **Important — la copie du service worker ne suivait plus les gestes.** Plus
  aucune lecture après un geste : `/api/routes` et `/api/orders` restaient ceux
  du matin dans le cache ; un écran rouvert avant le réseau montrait des arrêts
  livrés « à livrer ». Correctif : `recopierApresGeste` (écritures en série).
  Banc e2e : geste, réseau retenu, réouverture — « En livraison » au lieu de
  « Livré » avant, « Livré » après.
- **Mineur — le tracé d'avant le lot gardait la position exacte.** Correctif :
  `rognerTraceGps` (idempotent : 20 000 cas au hasard, une deuxième passe ne
  change rien). Banc : rouge « le tracé stocké d'une tournée terminée part encore
  de la position exacte » ; chaque site d'appel pris par son mutant.
- **Mineur — aller-retour de version.** Le drapeau de migration empêchait de
  relire un tracé écrit entre-temps dans le payload. Banc : rouge « le tracé
  d'avant le retour a écrasé celui recalculé » ; l'effacement pris par mutant.
- **Mineur — la purge tenait le verrou pendant la sauvegarde.** Banc : une
  sauvegarde retenue, un « Livré » pendant — rouge « le geste a attendu », puis
  vert, et la purge n'efface pas le geste. Garde neuve (une tournée modifiée
  pendant la sauvegarde attend le lendemain) prise par son mutant.

### Ce qui reste

- Le **chargement complet** reste à 2,2-3,3 s à 250-500 tournées : 17 requêtes,
  17 `readDb` (≈ 130 ms chacun, surtout les commandes). Il n'a plus lieu après
  chaque geste, mais à l'ouverture et au sondage. Levier suivant : un seul
  `readDb` par vague (point d'entrée agrégé, ou lecture mémorisée par
  `data_version`).
- `syncWorkflow` renormalise **toutes** les commandes à chaque écriture
  (≈ 150-250 ms à 6 000 commandes) : c'est le gros du « Livré » restant.
- L'**historique texte** n'est jamais purgé (§4, réserve †).
- Hors lot : tracés OSRM compacts (`polyline6` / `overview=simplified`, avec le
  serveur OSRM hébergé) ; marqueurs recréés à chaque rendu de carte (lot 4).

## Finitions d interface (audit du 23/09)

L'audit de complétude contre les 49 planches V8 a relevé une liste de défauts ; ce
lot en solde dix, plus une phrase périmée de ce fichier. Les numéros sont ceux du
rapport d'audit. Le CSS est au bout de `public/css/style.css` (bloc « FINITIONS
D'INTERFACE ») ; le reste vit dans `app.js`, `login.js`, `index.html` et
`renderLoginPage`.

### Ce qui est fait, et ce qui a été décidé

| # | Défaut | Ce qui change | Décision nommée |
|---|---|---|---|
| 2 | Les quatre zones de texte (notes client, notes de commande, commentaire de rappel, notes d'abonnement) en police à chasse fixe | `textarea { font: inherit }` : la règle `button, input, select` l'oubliait | Sélecteur nu : les règles plus précises (taille des notes du bon de commande) gardent la main |
| 3 | « Commande client » au bureau : formulaire de 280 px, « Type » et « Date » coupés (« dd/mm/y ») | Une colonne de 821 à 1180 px ; de 1181 à 1599, le formulaire en haut sur toute la largeur, puis le catalogue et, à côté, le panier (revu à la relecture, voir plus bas) ; trois colonnes à partir de 1600 (formulaire ≥ 360 px). Les champs ne vont par deux que s'ils tiennent (13,5 rem chacun), jamais plus de deux, 16 px entre les blocs, la saisie en 500 | Seule la mise en page : l'habillage de l'écran est un autre lot (« Écrans sans planche au style V8 ») |
| 5 | Connexion : l'identifiant effacé après un échec ; les essais restants dans une seconde colonne | L'identifiant est gardé (planche 9c) ; l'échec et les essais restants font UNE phrase qui dit aussi la durée : « Identifiant ou mot de passe incorrect. Il te reste 4 tentatives avant un blocage de 15 secondes. » | Gardé par l'onglet (`sessionStorage`), rendu seulement sur `?error=1` ou `?locked=1`, oublié par toute autre ouverture de `/login` — dont celle qui suit « Se déconnecter ». Ni dans l'URL de la redirection (historique, journaux du proxy), ni renvoyé par le serveur. Le mot de passe n'est jamais gardé ; le curseur y va |
| 8 | `--warning` déclaré cinq fois avec cinq valeurs (`#f1a447`, `#ed9d72` ×2, `var(--v8-accent)`, `#f18c79`) | Les cinq déclarations valent `var(--v8-avertissement)`. Le seul texte posé sur cette famille, le bouton « warning » (« Reporte » des rappels), prend la paire de la charte : texte `--v8-avertissement` sur `--v8-avertissement-fond`, **4,89:1** en clair, **4,56:1** en sombre ; le survol pose un contour au lieu de changer les couleurs | Avant : 4,45 au repos et 3,55 au survol en clair, ~1,0 en sombre. Le commentaire « ⛔ NON BRANCHÉ, délibérément » est remplacé par ce qui a été mesuré |
| 10 | Pas de pastille sur « Abonnements » | Le nombre d'échéances **à générer** — rappel arrivé, pas encore de commande — lu dans `/api/subscriptions`, la source de l'écran ; en alerte (comme celle du Stock) s'il y en a une en retard ; `aria-label` « n échéances à générer » | Le nombre qui appelle un geste. Les retards en font partie (une échéance passée a son rappel derrière elle) : les compter à part aurait fait deux nombres pour une seule file |
| 11 | Préparation au bureau : « 2 articles » là où le téléphone dit « 6 articles » | « n articles » compte les quantités (`getOrderProductCount`), le manque aussi (`manqueDeLaCommande`, celui du téléphone) : cinq gants absents font « Il manque 5 articles », plus « 1 article » | `detailDeBlocage`, qui comptait les lignes de produit, est retiré |
| 12 | Chargement hors tournée | « Cette semaine » (`#opWeekCount`) a son squelette au lieu d'un 0 ; « Stock mis à jour » ne s'empile plus (un toast par clé, `notify(…, { cle })`, remplacé à chaque − / +) ; la page ne remonte plus si l'on a défilé avant le `load` ; une lecture des commandes en échec dit « Commandes indisponibles » avec « Réessayer », pas « Aucune commande » (Commandes et Préparation) ; « Tout sélectionner » / « Tout désélectionner » des commandes du jour restent désactivés jusqu'à LEUR liste (`data-attend-commandes-du-jour`, le motif de la tournée) ; les sous-titres de Commandes et de Préparation disent aussi « Commandes indisponibles » | Le défilement : un geste de l'utilisateur (`wheel`, `touchmove`, `keydown`, `pointerdown`) avant `load` gagne sur `resetViewportScroll(false)`. C'est l'« écart nommé, NON corrigé » de la section « Lot du 23/09 — deux bancs instables » : il est corrigé ici |
| 13 | De 821 à 920 px, un demi-rang de pilules en trop | Le plafond du repli y vaut 2 × 44 + 8 = 96 px (les pilules du bureau), plus 104 (celui du téléphone) | `:not(.filtre-pilules--depliee)` : la rangée dépliée garde ses deux classes, et la règle, écrite après, l'aurait repliée |
| 14 | Aucun bouton « Se déconnecter » | Au bureau sous le bloc compte de la barre, dans la voix de la ligne de version (texte secondaire, 4,63:1 sur le vert, 44 px) ; au téléphone dans « Plus », après un filet, comme une action et non une destination. UN formulaire `POST /logout` (attribut `form`) qui navigue : le service worker y vide le cache de données. Hors ligne (`navigator.onLine === false`), rien ne part : un message le dit | Aucune planche ne le dessine. Les cinq destinations du menu « Plus » restent cinq |
| — | Ce fichier disait que le thème démarre en clair | La ligne « Le thème par défaut » dit « Système », comme le code (`anti-fart.js`) | — |

### Écarts nommés

- **« Se déconnecter » sans authentification.** Sur un serveur lancé sans
  `SEREO_AUTH_*` (le développement, le serveur commun des bancs), le bouton est
  là et ne fait que recharger : `/login` y renvoie à l'application. En
  exploitation l'authentification est active. Le masquer demanderait de lire
  `moi.source === "desactivee"` (`/api/me`) : pas fait, rien ne le demande.
- **L'identifiant gardé survit à une connexion réussie**, dans le
  `sessionStorage` de l'onglet, jusqu'à la prochaine ouverture ordinaire de
  `/login` (celle de « Se déconnecter » comprise) ou la fermeture de l'onglet.
  Ce n'est pas un secret : le mot de passe n'y passe jamais.
- **Le blocage se compte par adresse IP** (écart déjà nommé plus haut) : la
  phrase « avant un blocage de 15 secondes » n'y change rien.

### Bancs

Chacun a été lancé sur le code d'avant (fichiers produit de `main` remis en place,
bancs du lot gardés, puis restauration par `git checkout HEAD --` et
`git diff --quiet`) et rougit pour la bonne cause :

- `test/e2e/interface-finitions.spec.js` (serveur semé **3301**) :
  2 → reçu `notes : monospace` ×2, `commentaire`, `subNotes` ; 3 → 60 champs
  coupés, dont « 1024px customerOrderType « Commande immédiate » : 108px pour
  221 » et « formulaire de 280px » ; 10 → la pastille reste `hidden` ;
  12 « Cette semaine » → reçu `"0"` ; 12 toasts → reçu 3, attendu 1 ;
  12 défilement → `scrollY` reçu 0, attendu > 200 (le banc ralentit les tuiles
  de 3 s : servies localement, `load` tombait à ~140 ms, avant tout geste, et le
  banc passait sur le défaut) ; 12 erreur → « Aucune commande » au lieu de
  « Commandes indisponibles » ; 12 « Tout sélectionner » → `enabled` ;
  14 → bouton absent ; 8 → `--warning` vaut `#F18C79` en clair, `#ED9D72` en
  sombre.
- `test/e2e/preparation-lignes.spec.js` : 11 → « Il manque 1 article » au lieu de
  « Il manque 5 articles » (tablette et bureau) ; 13, nouvelle vue « tablette »
  (serveur semé **3300**) → plafond reçu 104, attendu 96.
- `test/e2e/connexion.spec.js` (serveur authentifié) : identifiant reçu `""` ;
  « Se déconnecter » introuvable dans la barre.
- `test/auth.test.js` : reçu le `<span class="login-error-attempts">` à part.
- `test/interface-finitions.test.js` : `--warning` en quatre valeurs distinctes ;
  la ligne du thème par défaut ; et cette section, que citent la feuille et le
  banc (présente une fois — sa place dans le fichier n'est pas jugée, voir la
  relecture).

Non-régression verte sur le produit final : `npm test` ; `navigation-mobile`,
`cibles-tactiles`, `texte-coupe`, `contraste-application`, `charte-composants`,
`focus-clavier`, `themes`, `typographie`, `operations` ; `commandes`, `stock`,
`preparation-mobile`, `livraison-chargement`, `squelette`, `parametres-mobile`,
`abonnements`, `abonnements-mobile` ; `contraste-login` et `connexion` sur un
serveur authentifié à part (copies locales non suivies visant 3311).

### Relecture adverse du 23/09

Six défauts relevés sur le lot ; chacun vérifié avant d'être corrigé, et chaque
correction a un banc qui rougit sans elle.

| Défaut relevé | Verdict | Ce qui change |
|---|---|---|
| Le banc « la dernière section de DESIGN.md est celle du lot » rougit dès qu'un lot frère ajoute la sienne | Vrai : une section ajoutée après celle-ci le fait rougir sans aucune régression | Il exige que la section existe, une seule fois ; sa place n'est plus jugée |
| « Tout sélectionner » des commandes du jour s'active sur `orders`, alors qu'il agit sur `todayCustomerOrders` | Vrai : au premier chargement du jour, la copie du cache a `orders` mais pas l'URL du jour, et les boutons s'activaient sur une liste vide | Les deux boutons attendent leur propre liste (`data-attend-commandes-du-jour`, `activerSelectionDuJour`) ; ceux de la tournée gardent `data-attend-commandes` |
| De 1181 à 1599 px, le panier passe sous tout le catalogue ; le formulaire, collant et plus haut que la fenêtre, cache « Valider la commande » | Vrai pour la place du panier. Faux pour l'effet du « collant » : **aucun** `position: sticky` de l'écran n'agit, avant comme après le lot. `html`, `body` et `.content` ont `overflow-x: hidden`, ce qui fait de `.content` le conteneur de défilement de référence, et `.content` ne défile jamais : c'est la fenêtre qui défile (mesure : à 1600 px, le panier « collant » part à −1 696 px) | De 1181 à 1599 : formulaire en haut sur toute la largeur, puis le catalogue et, à côté, le panier — l'ordre de la colonne unique, avec le panier au niveau du catalogue et non plus après lui. À partir de 1181 px, le formulaire n'est plus déclaré collant (un champ par ligne, ~1 200 px) : rien ne change aujourd'hui, mais ce piège n'attend plus le jour où le collant revivra |
| Au téléphone et hors ligne, « Se déconnecter » efface le cache de données, puis remplace l'application par la page d'erreur du navigateur, alors que la session reste ouverte | Vrai (mesure : l'adresse devient `chrome-error://chromewebdata/`) | Un écouteur `submit` sur le document : `navigator.onLine === false` → rien ne part, et le toast « Hors ligne : la déconnexion attend le retour du réseau. Rien n'a été effacé. » s'affiche. Le même geste, une fois en ligne, déconnecte |
| Lecture des commandes en échec : les sous-titres disent encore le vide (« Aucune commande à préparer » au téléphone, « 0 bon depuis janvier · 0 en cours » dans Commandes) | Vrai | `majSousTitrePreparation` et `majSousTitreCommandes` disent « Commandes indisponibles », comme la liste |
| `auto-fit` ouvre trois colonnes quand le formulaire est large : trous et champs orphelins | Vrai à 1100 et 1180 px (et de 3 à 5 colonnes à partir de 1181 px dans la nouvelle mise en page) | Chaque piste mesure au moins la moitié de la grille (et 13,5 rem) : `minmax(min(100%, max(13.5rem, calc((100% - 12px) / 2))), 1fr)`, donc deux colonnes au plus |

**Écarts nommés.**

- **Le collant inerte** vaut pour tout l'écran, et sans doute pour d'autres :
  le réparer (`overflow-x: clip` au lieu de `hidden` sur `html`, `body` et
  `.content`) réveillerait **tous** les `position: sticky` de la feuille à la
  fois. C'est un lot à part, qui les passerait tous en revue. Tant qu'il n'est
  pas fait, le panier ne suit pas le défilement, à aucune largeur. **Fermé le
  23/09** : ce lot est fait (« Panier collant et ordre du clavier », en fin de
  fichier).
- **De 1181 à 1599 px, le premier écran est le formulaire** : catalogue et
  panier commencent sous la ligne de flottaison, comme dans la colonne unique.
  C'est le prix d'un panier au niveau du catalogue sans casser les champs.
- **Hors ligne : seul le cas sûr est gardé.** `navigator.onLine === true` ne
  prouve pas que le réseau répond (réseau qui ment) : dans ce cas le geste part
  comme avant, et le service worker efface le cache avant de savoir si le POST
  est arrivé. Le rendre conditionnel au succès toucherait le service worker, ce
  que ce lot ne fait pas. Pas de confirmation non plus : aucune planche n'en
  dessine, et en ligne une déconnexion par erreur ne coûte qu'une reconnexion.

**Bancs.** Chacun a d'abord été lancé sur le code d'avant (fichier produit de
`46637aa` remis en place, puis restauré) :

- `test/interface-finitions.test.js` : sur le banc d'avant, une section
  « ## Clients au téléphone (23/09) » ajoutée en fin de fichier → « la derniere
  section n'est pas celle du lot », sans régression. Le banc neuf reste vert
  dans ce cas, et rougit si la section manque (reçu 0) ou si elle est en double
  (reçu 2).
- `test/e2e/interface-finitions.spec.js` : « copie du cache sans la liste du
  jour » (cache posé à la main, service worker bloqué, API ralentie) → reçu
  `enabled` ; « sous-titres » → reçu « Aucune commande à préparer » à 390 px ;
  « hors ligne » → reçu `chrome-error://chromewebdata/` ; « panier à côté du
  catalogue » → « le panier n'est pas a cote du catalogue (4233px plus bas) » de
  1181 à 1599 px, et « customer-client-panel collant de 1193px pour 816px de
  fenetre » (le formulaire seul remis collant : rouge à 1181, 1600 et 1920) ;
  « au plus par deux » → 3 colonnes à 1100 et 1180 px (5 à 1599 avec la
  nouvelle mise en page et l'ancienne règle).

## Clients au téléphone (planches 9a, 8c, 12c), posé le 23/09

Sous **820 px** ; au bureau (planche 13e), rien ne change : ce qui est propre au téléphone
est caché hors du media, et le tri n'y est ni rendu ni appliqué. CSS : le bloc « CLIENTS AU
TELEPHONE » en fin de `style.css`. Banc : `test/e2e/clients-mobile.spec.js` (18 cas, port
3302, dont 3 ajoutés par la revue adverse, plus bas) ; `clients.spec.js` reste vert.

**Posé — la liste (9a)**

- **Les filtres dans le vert** : l'en-tête se prolonge dans le bloc des pilules (Tous, les
  secteurs, Abonnés), un seul vert arrondi de 28 px dessous — le motif des Abonnements (3a).
  Pilules de 44 px : inactives en surface sur vert, l'active en blanc à texte vert (plein
  clair en sombre). Le **statut commercial** (hors planche, gardé) y est une pilule de plus,
  sur la surface sur vert.
- **La ligne « N clients » / tri**, sous le vert : le compte de la liste **filtrée**
  (« 1 client » sous « Abonnés »), et le tri **« Dernière livraison »** ou **« Nom »**.
- **« Nouveau client » fixé en bas**, pleine largeur moins 16 px, 48 px, à 14 px au-dessus
  de la barre basse. La liste lui réserve sa place (172 px sous le dernier client) : tout
  en bas, le dernier client est entièrement au-dessus du bouton — mesuré. Même élément que
  le bouton de l'en-tête du bureau (un geste, deux positions) ; il disparaît dans la fiche.
- **« Rappels »** (hors planche, gardé : seul chemin vers les rappels) partage sa rangée avec
  la pastille de synchro et « Actualiser », au lieu d'en faire une de plus.

**Posé — la fiche (8c clair, 12c sombre)**

- **Le bloc vert de la fiche** : la flèche de retour (rond de 44 px, surface sur vert) à
  gauche du nom (24 px), les puces dessous — le lieu en surface sur vert, l'abonnement en
  blanc à texte vert (en sombre : vert clair sombre, texte principal, comme 12c) — puis
  **« Appeler »** (blanc ; plein clair en sombre) et **« Itinéraire »** (contour clair ; en
  sombre, contour et texte principal, comme 12c), 48 px, côte à côte. Le bloc prolonge
  l'en-tête de l'écran, dont le titre « Clients » et les gestes de la liste s'effacent.
- **« Itinéraire »** ouvre Google Maps sur l'adresse du client, encodée : le même
  constructeur (`buildGoogleMapsUrl`) que « Y aller » de la tournée ; il n'est rendu que si
  l'adresse a une rue **et** une ville (sinon le lien serait vide).
- **Le reste en cartes V8** (surface, rayon 24, marge 18) : adresse et contact avec leur
  icône et un filet entre eux ; les notes ; le statut commercial ; l'abonnement (titre et
  badge sur une rangée, « Créer la commande » en pleine largeur) ; les commandes (le
  numéro, puis « date · articles », le badge à droite, un filet entre elles ; « Les N
  autres » centré).
- **Le passage liste → fiche → retour** : la flèche et le retour du téléphone ramènent la
  liste, le focus revient sur la ligne ouverte. Mesuré aussi après un rechargement depuis
  une fiche : la liste revient, et la fiche rouverte se referme d'une seule flèche — la
  flèche s'arrête à la liste, sans second recul dans l'historique (garde : le code de
  `main` le fait déjà ; le `popstate` privé de `depuisHistorique` recule d'une entrée de
  trop et le cas le prend, `cliVue` reçu `null` au lieu de `"fiche"`).

**Décisions prises**

- **Le tri par défaut, au téléphone, est « Dernière livraison »** : c'est celui de la
  planche, et la passation le dit « le plus utile en tournée ». Il est calculé **dans le
  navigateur**, depuis les commandes déjà chargées (même décision qu'au bureau pour « livrée
  le … » : rien de neuf côté serveur). Les clients jamais livrés viennent ensuite, par nom.
  Au bureau la liste reste par nom ; passer le seuil de 820 px (une tablette qu'on tourne)
  redessine la liste dans l'ordre de la largeur.
- **« Modifier »** (hors planche, gardé : seul chemin vers le formulaire) est un **rond de
  48 px** au bout de la rangée Appeler / Itinéraire, avec un crayon ; son nom accessible
  reste le mot « Modifier », caché à l'œil seulement. À trois boutons pleine largeur,
  « Appeler » et « Itinéraire » ne tenaient plus sur 358 px.
- **La pastille de synchro et « Actualiser » restent** en haut du vert de la fiche (la
  planche ne les dessine pas ; gardés comme dans « Les 90 jours » des Abonnements).
- **L'ordre des cartes est celui du DOM du bureau** : adresse et contact, notes, statut,
  abonnement, commandes. Les réordonner au seul téléphone (`order`) aurait séparé l'ordre
  du clavier de l'ordre lu.
- Les libellés « Adresse » / « Contact » sont **cachés à l'œil**, lus par les lecteurs
  d'écran : la planche met l'icône à leur place. Le statut commercial passe **en colonne**
  (côte à côte, « Statut commercial » tenait sur deux lignes).
- **Hors ligne**, le bandeau s'intercale entre l'en-tête et l'écran : l'en-tête garde son
  arrondi, et les filtres (liste) ou le bloc de la fiche deviennent une carte verte fermée
  — deux verts fermés plutôt qu'un vert coupé (le motif des Abonnements).
- **L'anneau clavier hors du vert** (« Nouveau client » fixé, les lignes de la liste,
  « Créer la commande », les commandes de la fiche, « Les N autres ») écrit ses deux tons en clair (`--v8-focus-halo`, `--v8-focus`) au lieu
  de `var(--focus-ring)` : ce jeton n'est défini que sous le thème clair, et en sombre la
  déclaration `box-shadow` devenait invalide — aucun anneau (mesuré : ombre `none`, contour
  `none`, sur les trois). Le tri garde `--focus-ring` : en sombre, le contour du `select`
  porte l'anneau, le banc l'y voit.
- **La puce « En pause »** prend la teinte tiède partout. Avant, sans secteur ni ville, elle
  devenait la première puce et prenait la teinte froide d'« Abonné » ; seul effet au bureau,
  sur ce seul cas — gardé à la revue adverse, et désormais couvert par un banc.

**Écarts nommés**

- le titre de la carte d'abonnement garde sa fréquence (« Abonnement · toutes les 2
  semaines ») au lieu de « Abonnement » seul et « Tous les 15 j · rappel … » dessous : la
  carte est celle du bureau ;
- la fiche commence sous la rangée synchro / Actualiser : une rangée de plus que 8c ;
- barre basse opaque et bouton à 14 px d'elle telle qu'elle est rendue (lot 1).

**Omis, faute de données** : l'interlocuteur (« Mme Ferrand, cadre de santé ») et
l'instruction de livraison (« entrée de service ») — le modèle client n'a pas ces champs ;
les notes s'affichent dans leur carte, comme au bureau.

**Constaté hors du lot, non corrigé** : au bureau, « Itinéraire » **se voit**, souligné
(capture de l'audit `crm-bureau-light.png`, sur `main`), alors que la section 13e décide
« au téléphone, pas au bureau » : `.cli-itineraire { display: none }` (0,1,0) perd contre
`:root[data-color-scheme] #crm .cli-bouton-contour { display: inline-flex }` (1,2,0). La
consigne « au bureau, rien ne change » m'interdisait de le retirer. À trancher : l'ôter
(la décision écrite) ou le garder et le styler comme « Modifier ».

**Constaté hors du lot, non corrigé (2)** : au bureau **en sombre**, « Modifier » et les
commandes de la fiche n'ont **aucun anneau** au clavier (sonde à 1280 px : ombre `none`,
contour `none`) — `#crm .cli-bouton-contour:focus-visible` et `#crm
.cli-commande:focus-visible` comptent sur `--focus-ring`, défini sous le seul thème clair.
Même chose, par la même règle ou sa voisine, pour les lignes de la liste
(`#crm .cli-ligne:focus-visible`) et « Créer la commande » : au téléphone, la revue
adverse les a fait corriger (plus bas) ; au bureau, ils restent sans anneau en sombre.
Sur `main`, pas de ce lot ; même remède que ci-dessus, à poser au bureau.

**Ce que le banc mesure** : dans les deux thèmes, le vert des filtres et de la fiche collé
à l'en-tête, les rayons, le contraste ≥ 4,5:1 de tout texte de l'en-tête de fiche et des
cartes, la hauteur des pilules (≥ 44) et des gestes (≥ 48), la couleur d'« Appeler » ; le
tri et le compte ; le bouton fixe (position, place réservée) ; le lien d'« Itinéraire »
(l'adresse affichée, encodée) ; ce qui est gardé ; l'anneau clavier sur chaque geste du
vert, et hors du vert dans les deux thèmes (tri, « Nouveau client », une ligne, « Créer la
commande », une commande, « Les N autres ») ; le rechargement depuis une fiche ; le bandeau hors ligne ; le bureau inchangé (ligne de tri cachée, bouton non fixe,
fiche en carte blanche, icônes cachées, liste par nom, retour au bon ordre au passage du
seuil). **Ne voit pas** : les règles `prefers-color-scheme` sans `data-color-scheme` —
l'application pose toujours l'attribut, elles ne servent qu'avant le script (comme dans
les autres lots).

**Preuves rouges** : les 13 premiers cas échouent avec le HTML, le CSS et le JS de `main`
(sauf le lien d'« Itinéraire », vert sur `main` : il existait, le cas est une garde) —
rejoué cas par cas à la reprise, chacun rouge sur sa propre assertion ; douze mutations
ciblées (un morceau du lot retiré à la fois) ont été prises chacune par son cas (mesure de
la session d'implémentation, non rejouée à la reprise). L'anneau hors du vert : avant le
remède, le cas sombre liste « Nouveau client », la commande et « Les N autres » sans
anneau ; chacune des trois déclarations remise seule à `var(--focus-ring)` (ou retirée)
rend le cas sombre rouge sur son seul élément, le cas clair restant vert. La
couleur d'« Appeler » en sombre est posée sous les deux portées du thème : retirer l'une ne
suffit pas, retirer les deux rend le cas rouge.

**`CACHE_NAME`** : non touché — le nom annoncé porte l'empreinte du contenu de `public/`.

### Clients au téléphone — revue adverse, corrigée le 23/09

Une relecture adverse du lot (au SHA `6a9a619`) a nommé cinq défauts. Les cinq sont vrais.
Trois sont corrigés, chacun avec un banc qui échoue sans le correctif ; le quatrième (un
changement voulu, sans banc) est gardé et reçoit son banc ; le cinquième est nommé, non
corrigé.

- **Tourner une tablette vidait le client d'un rappel en cours de saisie** (important).
  L'écouteur du seuil de 820 px relance `renderCrm`, qui recrée la liste du formulaire
  « Nouveau rappel » : le client choisi retombait sur « Choisir un client » (champ requis).
  **Remède** : `renderClientSelects` remet le client choisi s'il existe encore. Après
  l'envoi, le formulaire est remis à zéro **avant** le rechargement : rien ne reste. Le même
  remède couvre tout autre rechargement pendant la saisie. **Banc** : « tourner la tablette
  ne perd pas le client choisi… » (1180 → 820 → 1180 px, sur l'écran Rappels ; témoin : la
  liste des clients est bien redessinée dans l'ordre du téléphone). **Rouge sans lui** :
  `Expected: "c-tilleuls"`, `Received: ""`.
- **En sombre, au téléphone, les lignes de la liste et « Créer la commande » n'avaient
  aucun anneau** (important). Leurs règles communes (`#crm .cli-ligne:focus-visible`,
  `#crm .cli-bouton-contour:focus-visible`) posent `outline: none` et ne comptent que sur
  `--focus-ring`, défini sous le seul thème clair ; la règle du bloc vert n'atteint pas
  « Créer la commande », qui est dans la carte Abonnement. **Remède** : les deux tons
  écrits en clair, dans le bloc du lot, comme pour les commandes. **Banc** : le cas
  « l'anneau se voit hors du vert » regarde aussi une ligne et « Créer la commande ».
  **Rouge sans lui** : le cas sombre liste `ligne` et `creer` (ombre `none`, contour
  `none`), le clair reste vert ; chacun des deux sélecteurs neutralisé seul rend le cas
  sombre rouge sur son seul élément.
- **La dernière livraison était calculée deux fois par client** (mineur) : une fois pour le
  tri, une fois pour la ligne, chaque calcul parcourant toutes les commandes. **Remède** :
  `renderCrm` la calcule une fois par client et par rendu, et la passe au tri
  (`clientsTries(livraisonDe)`). **Banc** : on compte les jours pris à Paris
  (`toLocaleDateString`, fuseau `Europe/Paris`) pendant un rendu : autant au tri par
  livraison qu'au tri par nom. **Rouge sans lui** : `Expected: 8`, `Received: 16`.
- **« En pause » change de teinte au bureau, sans banc** (mineur). Le changement est
  **gardé** : c'est un défaut de `main` (sans secteur ni ville, la puce « En pause »
  devenait la première et prenait la teinte froide d'« Abonné », alors que le badge de la
  ligne est tiède). **Banc** : « au bureau, « En pause » garde la teinte tiède… » (le
  client sans lieu est obtenu en interceptant `/api/crm/clients`). **Rouge avec le code de
  `main`** : `Expected pattern: /cli-badge--tiede/`, `Received: "cli-badge
  cli-badge--froid cli-puce"`.
- **Au téléphone, « Nouveau client » est en bas de l'écran mais tôt dans l'ordre du
  clavier** (mineur) — **vrai, non corrigé**. Mesuré à 390 px : recherche, « Rappels »,
  **« Nouveau client »** (en bas, `top` 692), « Actualiser », puis les pilules. Le bouton
  vit dans l'en-tête partagé des écrans, et le placer ailleurs dans le DOM au seul
  téléphone déplacerait aussi le bouton du bureau, ou le dédoublerait : pas un correctif
  bon marché. Même motif, déjà en place, que « Nouvel abonnement » (Abonnements, 3a). À
  trancher avec lui : l'action principale reste atteinte tôt (le motif du bouton flottant),
  ou les deux boutons passent après leur liste. **Fermé le 23/09** : Thomas a retenu la
  seconde ; au téléphone, les deux boutons sont déplacés après les écrans dans le DOM, et
  le bureau garde le sien dans l'en-tête (« Panier collant et ordre du clavier »).

### Création d'abonnement (planches 3b, 5b), posé le 23/09

L'ancien formulaire « Nouvel abonnement » (un `<select>` de clients, une ligne
« Produit / Quantité / Retirer » par produit, une liste déroulante de fréquences) est
remplacé ; le `<dialog id="subscriptionDialog">` et ses identifiants de champ restent,
l'intérieur est neuf. `abonnement-creation.spec.js` (12 cas depuis la relecture adverse,
port 3304) ;
`operations.spec.js` suit les nouveaux gestes.

**Posé**

- **Au téléphone** (sous 820 px) : une page pleine. L'en-tête vert de la planche
  (`--v8-carte-tournee`, arrondi 0 0 28 28), sa flèche ronde de 44 px sur la surface sur
  vert, le titre 24 px/700 ; des cartes blanches de 24 px de rayon, 18 px de marge
  intérieure ; en bas « Annuler » (contour) et « Créer l'abonnement » (plein, qui prend
  la largeur), 48 px. En sombre (5b) : les jetons de la planche, le creux des champs en
  `--v8-fond` (« surface basse → fond en creux » de la passation).
- **Au bureau** : la même logique dans une fenêtre V8 — 640 px, coins 28, fond `--v8-fond`,
  les mêmes cartes, le titre à gauche et la croix ronde de 44 px à droite, la barre du
  bas alignée à droite. Le corps défile, l'en-tête et la barre restent.
- **Le client en carte** : une recherche (nom, ville, rue, code postal ; ou trois chiffres
  du téléphone) et des cartes de 60 px (nom ; « rue, CP ville »). Choisie, la carte
  devient le champ vert clair de la planche (nom en principal appuyé, 7,04:1) avec sa
  croix ronde « Changer de client », et l'adresse dessous. Entrée sur un résultat unique
  le choisit ; Entrée n'envoie jamais le formulaire depuis une recherche.
- **Le catalogue** : « Catalogue » ouvre la liste des produits avec **le stock
  disponible du serveur** (`quantityAvailable`, sinon la quantité) : « CH-L · 100 en
  stock », « rupture », « stock à renseigner » ; « N au panier » quand il y est. Chaque
  produit a son « + » rond de 44 px. Une recherche filtre par nom ou code (40 lignes au
  plus, puis « N autres : précise la recherche »). Un panier vide ouvre le catalogue
  d'office : c'est le seul chemin pour le remplir.
- **Le panier** : une ligne par produit, nom, « code · stock », et le pas de la planche
  (− rond en creux, quantité 19 px/700, + rond plein). À un, « − » s'appelle « Retirer … »
  et retire la ligne ; le focus passe à la ligne voisine, sinon à « Catalogue ». Chaque
  ligne porte aussi un lien « Retirer » sous son stock : le geste d'un clic de l'ancien
  formulaire, quelle que soit la quantité (voir la relecture adverse, plus bas).
- **Les pilules de fréquence** : 7 j · 10 j · 14 j · 15 j · 21 j · 28 j · Mensuel ·
  Autre…, des boutons radio (flèches du clavier, nom accessible « Tous les 15 jours »),
  44 px, la choisie en plein principal.
- **Les trois prochaines livraisons** : recalculées à chaque geste, sans validation
  (règle de `lib/subscriptions.js` recopiée : dernier jour du mois quand il est plus
  court). La première porte le point pêche et « départ », les suivantes « + 15 j » ou
  « + 2 mois ». La note dit ce que l'intervalle fait : « Samedi, dimanche, lundi : un
  intervalle de 15 jours décale le jour de la semaine. Choisis « Mensuel » pour garder la
  même date, « 14 j » pour garder le même jour », ou « Toujours le mardi », ou « Le 31 de
  chaque mois ; le dernier jour du mois quand il est plus court ».
- **Le rappel** : Aucun · 2 j · 3 j · 7 j · 15 j · Autre… (0 à 60), sa valeur en 19 px à
  droite du titre.

**Gardé de l'ancien formulaire** (rien de ce que l'API reçoit n'est perdu — le banc
compare le corps du `POST /api/subscriptions` champ par champ) :

- `clientId`, et la **fiche client créée à la volée** (« Créer une fiche client » : nom,
  prénom, adresse, code postal, ville, téléphone ; `POST /api/crm/clients` puis
  l'abonnement). Une fiche créée n'est pas recréée si l'enregistrement échoue ensuite ;
- `products[]` `{ productId, quantite }`, **la quantité saisie au clavier** (1 à 10 000) ;
- `startDate` (le champ date natif) ;
- `frequency` : les six intervalles et le mensuel, et **« Autre… » en jours (1 à 366)
  OU EN MOIS (1 à 12)** — l'API acceptait les mois, l'ancien formulaire non ;
- `reminderDays` (0 à 60) ;
- sous **« Plus d'options »** (la planche ne les dessine pas) : `status` (Actif, En pause,
  Arrêté) et `notes` (« Notes de livraison », 2 000 caractères). Le bloc s'ouvre seul à
  la modification quand le statut n'est pas « Actif » ou qu'une note existe ;
- à la modification : le titre « Modifier l'abonnement », « Enregistrer les
  modifications », et la phrase « Les modifications s'appliquent aux prochaines
  échéances… ».

**Décisions prises (questions ouvertes)**

- **« Tous les 2 mois » se rouvre en « Autre… 2 mois ».** L'ancien éditeur rouvrait tout
  abonnement en mois sur « Mensuel », donc `{ unit: "months", interval: 2 }` aussi — et
  l'enregistrer en faisait « tous les mois » (`interval: 1`). Corrigé, prouvé par
  mutation. (Écrit d'abord « tous les 2 jours » : faux, relevé par la relecture adverse,
  mesuré sur les lignes de `ef470c6`.)
- **Les trois « prochaines » dates** partent d'aujourd'hui quand l'abonnement a commencé
  avant (modification) : les premières dates d'un abonnement de juin sont passées.
  « départ » n'est écrit que sur la vraie première livraison.
- **La note du rappel dit ce que fait le serveur**, pas ce que dit la planche. La planche
  écrit « Le rappel remonte dans « À régler » du tableau de bord » ; c'est faux : « À
  régler » ne montre que les échéances EN RETARD. Le rappel fait compter l'échéance dans
  « Échéances à préparer » (`due = rappel <= aujourd'hui`) et dire « rappel arrivé » dans
  Les 90 jours. La note : « Le 16 septembre, la livraison du 23 septembre passe dans
  « Échéances à préparer » du tableau de bord. De 0 à 60 jours. »
- **Le rappel par défaut reste 7 jours** (l'ancien défaut ; la planche montre 3 j
  choisi). Changer un défaut change ce que les abonnements créés demain voudront dire.
- **Le secteur** n'est ajouté à l'adresse (« …, 25000 Besançon · Besançon ») que s'il dit
  autre chose que la ville.
- **La barre du bas est opaque** (la planche : fond à 82 %), comme la barre basse du
  lot 1 : un bouton à contour posé sur un texte qui défile dessous perdait son contraste.
- **Un produit retiré du catalogue** reste dans le panier d'un abonnement qu'on modifie,
  nommé « retiré du catalogue » : l'enregistrement le signale plutôt que de le perdre en
  silence.
- **Sans client**, le formulaire dit « Choisis un client, ou crée sa fiche. » et n'envoie
  rien (le `<select required>` le faisait).

**Écarts nommés**

- la première livraison garde le champ date natif (« 23/09/2026 ») au lieu du champ
  « Mardi 22 septembre 2026 » à icône : la date longue est dite juste dessous, dans
  l'aperçu, et le sélecteur natif est celui que le téléphone sait ouvrir ;
- l'en-tête prend 16 px + la zone sûre en haut, pas les 54 px de la planche (qui
  comptent la barre d'état dessinée) ;
- la planche ne montre pas la recherche du client (elle montre un client déjà choisi) :
  les cartes de résultats sont dessinées dans ses jetons (creux, 18 px, nom 15/600,
  adresse 13/500) ;
- les pilules ne se replient pas (« Autre… » passe à la ligne à 390 px, comme sur la
  planche).

**Omis, faute de données** : rien — chaque texte de la planche a sa source. La planche
invente seulement l'exemple « 42 en stock » : c'est le chiffre du serveur qui s'affiche.

**Relevé, non corrigé (hors de ce lot)** : le jeton `--focus-ring` n'est déclaré que
sous `:root[data-color-scheme="light"]` (deux fois). En sombre, toute règle
`box-shadow: var(--focus-ring)` vaut `none` : l'anneau de focus disparaît. Le banc de ce
lot l'a pris (cas sombre, « Expected: not "none" ») ; ce bloc pose son propre anneau
(`--abo-anneau`, mêmes valeurs). Les autres écrans qui s'appuient sur `--focus-ring` en
sombre ne sont pas vérifiés ici.

**Preuves rouges** (index.html, operations.js et style.css de `main` remis, le banc
neuf lancé sans `serial`, un ouvrier) : 10 rouges sur 10. La croix : attendu 44 × 44,
reçu **316 × 48** ; au bureau : attendu 640 px et une croix de 44, reçu 740 et 50 ; la
recherche du client et le catalogue : « Expected: visible — element(s) not found » ; les
six autres cas s'arrêtent sur le contrôle absent (pilule, recherche, « Créer une fiche
client », « Ajouter … au panier »). Deux mutations du code neuf : rouvrir « Autre… » en
jours → « Expected: "months" / Received: "days" » ; l'anneau remis sur `--focus-ring` →
cas sombre « Expected: not "none" », cas clair vert. Tout restauré par copie depuis le
commit.

### Relecture adverse de la création d'abonnement (23/09) — cinq défauts, quatre vrais

Relecture de `f0cc23a`. Chaque défaut a été mesuré avant d'être corrigé ; banc :
`abonnement-creation.spec.js` (port 3304), lancé avec l'ancien code puis avec le nouveau.

- **Le premier « + » du catalogue ne faisait rien après une quantité tapée** (important,
  VRAI). Le `change` du champ part au mousedown du clic suivant ; il redessinait tout
  `#subCatalogueListe`, et le « + » sous le pointeur était remplacé avant le mouseup.
  Corrigé : le `change` met à jour « N au panier » en place (`majComptesCatalogue`),
  sans toucher aux boutons. Cas « une quantité tapée, puis « + » du catalogue » (saisie
  au clavier, pas `fill`) : ancien code **Expected 2 / Received 1** ; le compte mis à
  jour en place, mutant « change inerte » : Received « … · 12 au panier ».
- **Plus de retrait d'un seul geste pour une ligne au-delà de 1** (mineur, VRAI).
  L'ancien formulaire avait « Retirer » sur chaque ligne. Rendu : un lien « Retirer »
  sous le stock de chaque ligne (nom accessible « Retirer … du panier », 44 px, l'anneau
  du lot ; pas de marge haute négative, l'anneau couvrait « code · stock » en capture).
  Le focus passe au « Retirer » voisin, sinon à « Catalogue ». « − » à un retire
  toujours la ligne. Cas « une ligne de 120 se retire d'un seul geste » : ancien code,
  contrôle absent ; mutant du focus rendu à « − » : Expected focused / Received inactive.
- **Le fait écrit sur l'ancien formulaire était faux** (mineur, VRAI). Il ne faisait pas
  « tous les 2 jours » d'un abonnement de 2 mois, il en faisait « tous les mois » :
  les lignes de `ef470c6` exécutées telles quelles rouvrent sur `monthly` et enregistrent
  `{"unit":"months","interval":1}`. Corrigé ici (Décisions prises), dans le commentaire
  d'`openEditor` et dans celui du banc. Rien ne change au code.
- **Le banc « Entrée n'envoie pas le formulaire » ne pouvait pas voir un envoi**
  (mineur, VRAI sur le fond, FAUX sur le scénario). Le scénario du relecteur (retirer
  `preventDefault` de la recherche client fait partir le formulaire) ne se produit pas :
  mesuré, **0 envoi**. Entrée active « Changer de client », qui vient de prendre le
  focus, et le banc tombait déjà (Expected "c-bellevue" / Received ""). Le fond est juste :
  l'assertion `open` ne distinguait rien, et rien ne comptait les envois. Le banc compte
  désormais les `submit` et presse Entrée sur plusieurs résultats et dans la recherche du
  catalogue. Deux mutants que l'ancien banc laissait passer (`preventDefault` seulement
  sur un résultat unique ; `preventDefault` retiré du catalogue) : Expected 0 / Received 1.
- **Le nom accessible de « Mensuel » ne contenait pas « Mensuel »** (mineur, VRAI,
  WCAG 2.5.3). Il devient « Mensuel : tous les mois, même date ». Le banc des pilules
  vérifie que chaque nom contient son texte visible : ancien code, Received
  `["Mensuel → Tous les mois, même date"]` ; les treize autres pilules passaient.

Tous les mutants ont été restaurés par copie. Au vert : `abonnement-creation.spec.js`
12 sur 12, et `operations.spec.js` 5 sur 5.

## Écrans sans planche au style V8, posé le 23/09

Les écrans que les planches V8 ne dessinent pas : **Analyse** (l'ancien
« Statistiques »), **Exports**, **Rappels**, **À recommander** (la liste détaillée
derrière la carte du Stock) et l'**habillage** de **Commande client**. Décision de
Thomas, déléguée : **pas de nouveau dessin**. On leur applique le système déjà posé
ailleurs, et rien d'autre. Bloc « ECRANS SANS PLANCHE » en fin de `style.css` ; toutes
ses règles portent l'`#id` de l'écran (elles battent les
`:root[data-color-scheme="light"] X` des couches anciennes).

**Ce qui est appliqué**

- **Analyse** : le titre de l'écran suit la passation et la barre latérale
  (« Analyse », `config/tabs.js`). Deux noms pour un lieu, c'était un de trop.
  « Statistiques » reste trouvable par la recherche du menu (`ANCIENS_NOMS`).
- Le bandeau « SEREO commercial / Statistiques » est **retiré** : il répétait le titre
  de l'écran, et ses deux pilules d'évolution répétaient les tuiles sans dire laquelle
  était la semaine et laquelle le mois. Chaque évolution se lit **une fois**, dans sa
  tuile.
- Les six tuiles chiffrées ont le rendu de celles du tableau de bord : blanches,
  sans trait coloré à gauche ni point coloré dans le coin (un code couleur sans
  légende), chiffres en `tabular-nums`. Une baisse se dit par le mot **et** par la
  couleur d'alerte. Une tuile ne se soulève plus au survol : ce n'est pas un bouton.
- L'**histogramme** a le rendu de celui du tableau de bord : ni grille ni dégradé,
  barres pleines au principal, le jour courant (la dernière barre) à l'accent de
  donnée, son étiquette en gras — la même information sans la couleur. L'étiquette ne
  garde que le **jour du mois** (« 09-10 » se cassait en « 09- / 10 » sous une colonne
  de 22 px) ; la date entière reste dans le nom accessible et l'infobulle. Au
  téléphone, tous les jours sont lisibles (l'ancienne règle en cachait un sur deux, à
  9 px). Un **jour sans vente** est un moignon **vert d'eau**, pas une barre au
  principal : relevé au plancher de 6 px, il se lisait comme une petite vente (relecture
  du 23/09 ; en sombre, l'ancien écran les distinguait). 3,20:1 entre les deux états en
  clair, ~6:1 en sombre. Aujourd'hui sans vente reste un moignon ; son étiquette en gras
  dit encore quel jour c'est.
- Les **classements** (meilleurs clients, produits) : des lignes à filet, rang en
  pastille, montant en `tabular-nums`, une jauge plate au principal (plus de dégradé
  corail-vert).
- **Exports, Rappels, À recommander, Commande client** : les cartes imbriquées sont
  blanches à filet régulier (surface basse en clair, vert d'eau en sombre), sans trait
  coloré ; les listes n'ont plus de fond dégradé. Commande client : **seules** ses
  cartes (catalogue, panier vide) — la grille de son formulaire n'est pas touchée, un
  autre lot la reprend.
- Les **gestes d'un rappel** (Fait, Reporté, Annulé) n'ont plus de dégradé : un geste
  plein (Fait) et deux à contour ; « Annulé » garde la couleur d'alerte, avec son mot.
  « Reporté » passait à 4,45:1 sur son ancien fond ; il est au-dessus de 4,5:1 partout.
- **Au téléphone**, dans le cadre commun (en-tête vert, barre basse) : les filtres des
  Rappels et d'À recommander sont des **pilules** de 44 px à leur largeur, plusieurs
  par rangée (et non cinq gros boutons pleine largeur empilés) ; la choisie est pleine
  au principal et se dit par `aria-pressed`. L'anneau clavier est écrit avec les jetons
  `--v8-focus` / `--v8-focus-halo`, **pas** `--focus-ring`, qui n'est défini qu'en
  clair (en sombre l'anneau tombait à « none »). Les trois exports sont des **gestes**,
  pas des filtres : des boutons à leur largeur qui passent à la ligne. La pastille de
  compte d'un en-tête de carte garde sa largeur. Les quatre chiffres d'un produit à
  recommander passent deux par rangée : à trois, « À recommander » débordait de sa case.

**Dette 7, soldée** : les quatre anciennes listes de commandes (`#commandes-jour`,
`#commandes-planifiees`, `#bons-commande`, `#commandes-livrees`), inatteignables depuis
l'écran unique des Commandes mais encore dessinées, quittent la page avec leurs rendus,
leurs filtres et leurs gestes propres. Vérifié avant (grep) : aucune portée de rôle ne
les nomme plus (les rôles nomment `commandes`), aucun geste atteignable n'y menait
(leurs adresses redirigeaient déjà), et les bancs qui les visaient ont été repris
(`performance.spec.js` ne mesure plus des identifiants absents, qui rendaient −1 et
passaient ; `etats-vides.test.js` vise la clé « livrees »). **Gardé** :

- les **redirections** et les titres des anciens écrans (`config/tabs.js`) : un favori,
  un lien ou un `showTab("commandes-planifiees")` codé en dur arrivent sur l'écran
  Commandes, filtré ; la recherche du menu les trouve encore ;
- la **fenêtre de détail** d'une commande (`#bdc-detail-modal`), qui vivait entre deux
  de ces sections : c'est celle de l'écran Commandes ;
- `confirmPlannedOrder` / `cancelPlannedOrder` (les gestes Confirmer / Annuler du
  détail), `bdcNeedsCompletion` (la case « À compléter ») et `exportBdcCsv` (l'export
  de l'écran Commandes, qui lui passe sa liste filtrée).

`loadData` ne demande **plus** `/api/customer-orders/today` : seul l'ancien écran
« Commandes du jour » lisait ces commandes. La requête partait encore à chaque
chargement, et son échec affichait « Partiel (1 indispo) » avec un toast nommant la clé
brute `todayCustomerOrders`, pour des données qu'aucun écran ne montre. L'écran
Commandes filtre `orders` (`/api/orders`) par son propre jour (`#cmdJour`). La route
serveur reste (`test/api.test.js` la tient) ; la porte « endpoint du jour » de
`lireDernieresDonnees` aussi, sans occupant.

**Croisement avec `fix/interface-finitions`** (relecture du 23/09 ; mesuré sur
`bff9ee7`, branche encore mouvante). Ce lot-là, point 12 de l'audit, fait attendre
leurs commandes à « Tout sélectionner » / « Tout désélectionner » de `#commandes-jour`
(`data-attend-commandes-du-jour disabled`, `activerSelectionDuJour()` quand
`todayCustomerOrders` arrive) — la section et la liste que celui-ci retire. Conflit dans
`public/index.html`, `style.css` et ce fichier ; `app.js` fusionne **sans** conflit, et
c'est le piège. **Résolution, éprouvée** sur un arbre fusionné :

1. `index.html` : garder la **suppression**. Reprendre la section ramènerait deux
   boutons inertes (leurs gestionnaires ont quitté `app.js`), et
   `test/ecrans-sans-planche.test.js` le refuse.
2. `app.js` : retirer `if (a("todayCustomerOrders")) activerSelectionDuJour();` et
   `activerSelectionDuJour()` — plus aucune clé ni aucun bouton à activer ; code mort
   que la fusion automatique laisse passer.
3. `style.css` et ce fichier : deux ajouts en fin de fichier, à garder **entiers**. Ôter
   les seuls marqueurs ne suffit pas : git a sorti du conflit des lignes communes, et le
   résultat perd le `}` qui ferme le `@media` de ce lot et l'ouverture du commentaire
   d'en-tête des finitions (CSS cassée : cinq bancs des finitions et de
   `preparation-lignes.spec.js` rouges). Reconstruire : les deux fins de fichier bout à
   bout, 13 629 lignes pour `style.css`.
4. `test/e2e/interface-finitions.spec.js` : le test « 12 — Tout sélectionner des
   commandes du jour attend les commandes » attend 2 boutons et en trouve 0 : le
   **réécrire**, ce qu'il protège vaut pour les boutons qui restent (ceux de la
   tournée) :

   ```js
   // « Tout sélectionner » des commandes du jour est parti avec son écran (lot
   // « écrans sans planche ») ; la règle vaut pour ceux qui restent.
   const boutons = page.locator("[data-attend-commandes]");
   expect(await boutons.count()).toBeGreaterThan(0);
   await expect(page.locator('[data-action="select-all-today-orders"]')).toHaveCount(0);
   for (const b of await boutons.all()) await expect(b).toBeDisabled();
   for (const b of await boutons.all()) await expect(b).toBeEnabled({ timeout: 15000 });
   ```

   Et **supprimer** « 12 — une copie du cache sans la liste du jour n'active pas… » :
   après la fusion il reste **vert sans rien juger** (ses boucles portent sur zéro
   bouton), et la liste du jour qu'il protégeait n'est plus chargée.

Sur l'arbre ainsi résolu : `interface-finitions.spec.js`, `ecrans-sans-planche.spec.js`,
`performance.spec.js`, `preparation-lignes.spec.js` — 43 verts ; les bancs Node des deux
lots (`ecrans-sans-planche`, `interface-finitions`, `etats-vides`, `jetons-v8`, `auth`)
verts. `connexion.spec.js` (serveur authentifié) n'y a pas été rejoué.

**Non fait, nommé** : les règles CSS des anciennes listes (`.bdc-list`, `.bdc-search`,
`.stats-hero`, `.commandes-livrees-card`…) restent dans `style.css`, sans élément à
styler. Les retirer touche des dizaines de sélecteurs groupés dans les couches
anciennes, pendant que d'autres lots écrivent ce fichier : un nettoyage à part.

Bancs : `test/e2e/ecrans-sans-planche.spec.js` (serveur semé, port 3306 ; clair et
sombre ; styles calculés et textes rendus) et `test/ecrans-sans-planche.test.js` (plus
aucune référence aux conteneurs disparus ; contre-témoin : les quatre redirections).

## Intégration des lots d'interface du 23/09 (branche integration/geo-vague1)

Sur la vague géo (lots 1, 3, 4, 5, 7, `0e16b19`), quatre lots d'interface partis de
v1.41.1 (`ef470c6`), fusionnés dans cet ordre : `fix/interface-finitions` (`8ab6988`),
`feat/clients-mobile` (`6b10eaa`), `feat/abonnement-creation` (`b5034b6`),
`feat/ecrans-sans-planche-v8` (`16042d3`) ; puis deux réconciliations (`3b32456`) et
un banc repris (`2e728e1`).

**Conflits de fin de fichier** (`DESIGN.md`, `style.css`, aux quatre fusions) : notre
côté avait aussi modifié le milieu (la note du lot 1 ici, la famille `--warning` des
finitions dans la feuille), `ajouts.py` refusait (code 2). Reconstruits depuis les
trois versions, jamais en ôtant les marqueurs : l'ajout en fin de chaque côté
détaché, les têtes fusionnées à trois voies (`git merge-file`, propre), puis les deux
ajouts bout à bout. Contrôle à chaque fusion : le diff du résultat contre `HEAD` est
**exactement** le diff du lot contre sa base (lignes ajoutées et retirées, triées).

**Conflits de code, et ce qui a été gardé.**
- `loadData` (finitions × lot 1) : le mode frais du lot 1 (`clesEnCopie`, écriture
  croisée) et l'erreur des finitions (`commandesEnErreur`), les deux. En mode frais,
  des commandes **gardées** faute de réseau gardent aussi l'erreur qu'elles
  montraient : sinon une liste vide se serait dite « Aucune commande ».
- Les quatre anciennes listes (écrans sans planche) : la section `#commandes-jour`
  retirée, ses gestes aussi ; `save-coordinates` n'est repris par aucun côté (le lot 3
  a retiré sa fonction) ; la case « À livrer en premier » (lot 7) gardée. Aucun code
  des lots géo ne lisait `todayCustomerOrders` ni ces listes (grep : les fonctions
  retirées n'ont plus d'appelant, les identifiants retirés ne sont cités que par les
  redirections de `config/tabs.js`). `/api/customer-orders/today` a quitté
  `endpointsDeChargement` (lot 1) par la fusion automatique ; la porte `jour` de
  `lireDernieresDonnees` reste, sans occupant.
- Le croisement finitions × écrans, résolu **comme le lot écrans l'a écrit et
  éprouvé** : `activerSelectionDuJour` et son appel retirés (code mort que la fusion
  automatique laissait) ; « Tout sélectionner attend les commandes » porte sur les
  boutons qui restent (`data-attend-commandes`) ; le cas « copie du cache sans la
  liste du jour » retiré (vert sans rien juger).

**Réconciliations**, chacune avec un banc qui rougit sans elle
(`test/e2e/integration-interface.spec.js`, serveurs semés 3308 et 3309) :

| Défaut de la combinaison | Correctif | Rouge sans lui |
|---|---|---|
| Une réponse tardive (lot 1 : repli de 3 s sans copie, puis la réponse arrive) n'effaçait pas « Commandes indisponibles » (finitions) : une liste vraiment vide restait « indisponible » jusqu'au rechargement | `appliquerReponsesTardives` remet `commandesEnErreur` à faux quand elle apporte les commandes | la liste garde « Commandes indisponibles » après la réponse |
| `--focus-ring` n'existait qu'en clair : en sombre, toute règle `outline: none; box-shadow: var(--focus-ring)` n'avait **aucun** indicateur. Relevé par le lot 3, Clients au téléphone, Création d'abonnement, Écrans sans planche ; chacun l'a contourné dans son bloc | le jeton est déclaré sur `:root` (bloc « INTEGRATION DES LOTS D'INTERFACE » en fin de feuille) : les mêmes deux tons, qui suivent déjà le thème. Les anneaux écrits en clair par les lots (`--abo-anneau`, Clients, Écrans) ont la même valeur et restent | au bureau en sombre : une ligne de Clients, « Modifier » et une commande de la fiche, ombre `none` et contour `none` ; le même relevé en clair, vert |

**Banc repris** : `interface-finitions.spec.js`, « 12 — la page ne remonte pas toute
seule », tombait sur son préalable (`load` déjà passé), 3 fois sur 3 seul. Cause
sondée : l'adresse des tuiles vient du serveur (`/api/carte/fond`), demandée après
les scripts ; `load` tombe à 150 ms, la première tuile part à 160 ms, ralentir les
tuiles ne retient plus `load`. Le banc ralentit le logo de la barre à leur place.
Vert 3/3 ; le mutant « `resetViewportScroll` toujours » rouge pour sa cause.

**Ports e2e** : 3300 à 3306 (lots d'interface), 3308 et 3309 (ce banc), 3190 (lots
1-5) : chacun une seule fois (`test/ports-e2e.test.js`).

**Vérifié** sur `2e728e1` : `node --check` de `server.js`, `app.js`, `operations.js` ;
`npm run check` ; `npm test` 545/545 ; suite e2e complète deux fois, 469/469 et
469/469 (dont `connexion.spec.js` et `contraste-login.spec.js` sur le serveur
authentifié, que le lot écrans n'avait pas rejoués sur l'arbre fusionné).

**Écarts nommés.**
- `--focus-ring` global : là où une règle garde aussi son contour, le sombre montre
  désormais contour **et** anneau — mesuré sur le tri de Clients au téléphone : contour
  plein de 3 px sur le `select`, anneau à deux tons sur son étiquette `.cli-tri`.
- Les règles CSS des anciennes listes (`.bdc-list`, `.stats-hero`,
  `.commandes-livrees-card`…) restent sans élément à styler (déjà nommé par le lot
  écrans).
- Les écarts nommés par chaque lot restent les leurs (le collant inerte de Commande
  client, « Se déconnecter » sans authentification, « Nouveau client » tôt dans
  l'ordre du clavier, « Itinéraire » visible au bureau…). Le collant inerte et
  l'ordre du clavier sont fermés depuis (« Panier collant et ordre du clavier »,
  23/09).

## Lot 2 de l audit géo : débloquer les tournées (23/09)

Source : rapport d'audit du 23/09 (code audité `019788c`), constats H8, H9, M2, M7 et
les gardes « (API) » du §2 basse ; décisions de Thomas n° 7 (retirer l'ancien panneau
et `/api/optimize-route`) et n° 10 (pas de contestations : une note « remis à… »).
Branche `feat/tournees-annulables`, partie de `c05e6f1` (release 1.42.0). Attention :
la branche locale `main` du dépôt principal est restée à 1.41.1 (`ef470c6`) ; les
preuves rouges sont rejouées contre `c05e6f1`, pas contre `main`.

### Fait

- **H8 — annuler une tournée prête.** `POST /api/routes/:id/annuler`. Ses commandes
  n'avaient pas quitté « prête » (créer une tournée ne change ni le statut ni le
  stock d'une commande) : seul leur rattachement (`routeId`) est défait ; le stock
  est donc celui d'avant, sans rien rendre (mesuré : quantité et réservé identiques
  avant la création et après l'annulation). Refusée sur une tournée partie
  (« clôture-la »). À l'écran : « Annuler la tournée » à côté de « Démarrer ».
- **H8 — clôturer une tournée en cours.** `POST /api/routes/:id/cloturer`. Les arrêts
  restants passent « À reprogrammer » (« Tournée clôturée avant cet arrêt »), leur
  commande revient d'elle-même dans les commandes prêtes, réservation gardée pour
  la relivraison (comme un absent, lot 1) ; les livrés restent livrés. Irréversible :
  la tournée ne repart plus, un geste ne l'y rouvre plus. À l'écran : dans « Autres
  actions ». Une tournée finie à moitié ne reste donc plus « en livraison ».
- **Deux statuts de tournée** : `annulee` et `cloturee`, dans `ROUTE_STATUSES` (sinon
  `normalizeRoute` les ramenait à « prête » à la première écriture — pris par
  mutant). Finis partout : arrêts figés (`arretVivant`), tracé hors de la liste et
  non chargé par `readDb` (les deux ensembles, écart nommé du lot 5), purgeables à
  12 mois (`completedAt` posé aux deux gestes) ; « terminées » au tableau de bord
  compte aussi les clôturées.
- **Confirmation explicite** pour les deux gestes (`window.confirm`, comme le
  découpage et la purge) : elle dit ce qui va se passer — « sa commande redevient
  prête à livrer, et le stock ne bouge pas » ; « 1 livraison reste livrée. À
  reprogrammer (1) : Foyer de la Veille. … C'est définitif ». Refuser ne fait rien
  (banc). Les deux ne sont **jamais mis en file** hors ligne (`JAMAIS_EN_FILE`) :
  rejouée des heures plus tard, une clôture arrêterait une tournée que le livreur a
  continuée ; elles échouent franchement.
- **H9 — la tournée du jour d'abord.** `choisirTourneeAffichee` : du jour en cours,
  sinon du jour prête ; sans tournée du jour, une passée non soldée ; sinon une à
  venir. Le jour d'une tournée sans date est celui de sa création. Le choix
  « Tournées du jour » apparaît dès qu'il y a deux candidates (celles du jour, les
  passées non soldées, et celle qu'on regarde). Une tournée d'un jour passé non
  soldée est **signalée en tête de page** (« Tournée Dole du mardi 22 septembre
  n'est pas soldée : 1 arrêt à faire »), avec « Voir » et « Clôturer » (ou
  « Annuler » si elle n'est jamais partie).
- **M2 — un arrêt traité en lecture seule.** Toucher un arrêt déjà traité le garde à
  l'écran (`arretConsulte`) au lieu de sauter au suivant ; « Livré », « Absent »,
  « Problème » y sont désactivés ; un encart dit ce qui a été fait (« Problème ·
  Adresse introuvable », « Livré à 9 h 10 · remis à … »), avec « Corriger le statut »
  et « Revenir à l'arrêt à faire ». Un bouton désactivé dit pourquoi (geste en
  attente d'envoi, livraison dans ses 4 s d'Annuler, tournée annulée).
- **M2 — « Corriger le statut ».** Un dialogue (mêmes pièces que le motif) : livré,
  client absent, problème, « à faire : j'y repasse » ; la **cause est obligatoire**.
  Serveur : `POST /api/routes/:routeId/stops/:stopId/correction`, un geste à part,
  jamais un geste ordinaire rejoué. Journalisée (historique « Correction »,
  « Cabinet Dupont : Absent → Livré — Absent tapé par erreur », avec qui), gardée sur
  l'arrêt (`corrections`). **Stocks** : le rayon a été déduit à la préparation et ne
  bouge jamais ici ; seule la réservation suit (« Livré » la consomme, défaire une
  livraison la redonne — mesuré, l'aller-retour livré → absent → livré rend le stock
  d'avant). Une livraison corrigée est datée du geste d'origine. « À faire » rouvre
  une tournée terminée, jamais une clôturée. Refusée si la commande est repartie
  (autre tournée), a changé d'état par un autre écran, ou si sa réservation a été
  libérée à la main. Hors ligne, elle passe par la file et se montre faite, « En
  attente d'envoi » (`gesteArretDeLEntree` reconnaît aussi `…/correction`).
- **Gardes de l'API.**
  - une commande n'entre **jamais dans deux tournées actives**, aussi sans départ (la
    garde ne valait qu'en mode routier), et `createRoute` appelé sans sélection non
    plus ;
  - une commande d'une tournée active ne **repasse pas en préparation**
    (`start-preparation`, `PATCH /api/orders/:id` avec un autre statut) : 409 qui
    nomme la tournée ;
  - **aucun geste sur une tournée finie** (terminée, clôturée, annulée), ni sur une
    tournée pas encore partie, ni un geste **différent** sur un arrêt déjà traité
    (409, « utilise « Corriger le statut » ») ; le **même** geste renvoyé est un
    succès sans écriture ;
  - exception, pour ne rien perdre (lot 1) : un geste du livreur **fait avant la
    clôture** (son `faitLe`) et arrivé après (file hors ligne) s'applique sur un
    arrêt soldé **par la clôture**, si la commande n'est pas repartie ; la tournée
    reste clôturée.
  - les refus **nomment la commande et la tournée** : « La commande CMD-2026-012
    (EHPAD Les Tilleuls) est déjà dans la tournée « Tournée Dole du 23/09 » »,
    « … est prévue le 23/09, pas le 25/09 », « … n'est plus prête à livrer ». Avant,
    une commande choisie hors filtre était **retirée en silence** (5 cochées, 4
    livrées).
- **Liste des commandes à mettre en tournée** : le filtre de date s'ouvre sur le jour
  (les « à reprogrammer » le passent, lot 1) ; une commande déjà dans une tournée
  active est **grisée** (case désactivée, fond et trait pointillé, jamais l'opacité du
  texte), en fin de liste, avec « Déjà dans « Tournée Dole du mercredi 23 septembre »
  (prête) » ; « Tout sélectionner » et « Sélectionner ce secteur » ne la prennent pas.
- **Décision 10 — « remis à… ».** Un champ « Remis à » (facultatif, 80 caractères) au
  dessus de « Livré », lu à l'appui et envoyé avec le geste (donc avec lui dans la file
  hors ligne), vidé à l'arrêt suivant, rendu au champ par « Annuler ». Gardé sur
  l'arrêt **et** la commande (`normalizeOrder` le laisse passer), lu dans l'historique
  (« … : livre — remis à la voisine »), dans l'encart de l'arrêt traité et dans le
  détail de la commande (« Livrée : 23 septembre à 9 h 10 · Remis à … »).
- **Décision 7.** L'ancien panneau « Clients tournée » est retiré (HTML, `renderClients`,
  `selectClient`, `startTour`, `resetTour`, le chemin « client sans tournée » de
  `updateCurrentDeliveryStatus` et `nextClient`, et les aides devenues mortes) ; la
  grille du bureau perd sa rangée. `POST /api/optimize-route` est retirée : `grep` du
  23/09, aucun écran ni banc ne l'appelait (un commentaire de `api.test.js` la
  nommait seulement).

### Preuves rouges (ancien code `c05e6f1`, cause lue)

- Banc serveur `test/tournees-debloquees.test.js` (21 cas) contre `server.js` et
  `sqliteStore.js` de `c05e6f1` : **18 rouges sur les 18 cas d'alors**, chacun de sa
  cause — `Cannot POST /api/routes/r-cours/annuler` (et `/cloturer`, `/correction`) ;
  « une commande est entrée dans deux tournées » (201) ; « la tournée est créée sans
  la commande choisie » ; « la commande repasse en préparation » (200,
  `en_preparation`) ; « l'arrêt s'est rouvert » (200, arrêt `en_livraison` sur une
  tournée `terminee`) ; `Transition non autorisee : livre -> a_reprogrammer` au lieu
  du 409 qui renvoie à la correction ; `remisA` perdu ; « l'ancienne route répond
  encore : 200 ».
- Gardes neuves prises par mutant (copie restaurée, empreinte vérifiée) : 16 sur 16 —
  statuts retirés de `ROUTE_STATUSES` (7 rouges : la tournée clôturée redevient
  « prête »), liste (« la liste envoie encore le tracé »), `sqliteStore`
  (« readDb charge encore le tracé »), purge, exception « geste avant la clôture »
  (deux mutants : retirée ; sans la borne de date, le témoin rougit), réservation non
  rendue, tournée finie, arrêt soldé, préparation, nommer, les deux tournées (d'abord
  **redondant** avec la garde qui nomme, vert ; un cas « `createRoute` sans
  sélection » ajouté le prend), `remisA` dans `normalizeOrder`, réouverture d'une
  terminée, clôturée qui resterait clôturée, tournée pas partie.
- Banc e2e `test/e2e/tournees-debloquees.spec.js` (11 cas, ports 3330 et 3331), chaque
  cas **seul** (le mode `serial` laisse les suivants « did not run ») contre
  `server.js`, `sqliteStore.js`, `app.js`, `index.html` et `style.css` de `c05e6f1` :
  9 rouges sur les 9 cas d'alors — « la tournée d'hier masque celle du jour » ;
  `#deliveryDate` reçu `""` ; aucun `#tourneeChoix`, aucun signal, aucun
  `#cloturerTourneeButton`. Trois de ces rouges tombent sur la tournée d'hier
  affichée (préalable) : leur propre cause est prise par mutant d'`app.js`, 8 sur 8 —
  choix de l'ancienne tournée (« masque celle du jour »), signal caché, relecture
  (« toucher un arrêt traité affiche un autre arrêt », reçu « EHPAD Les Tilleuls… »),
  date vide, grisé retiré (« une commande déjà en tournée se coche »), `remisA` non
  envoyé (reçu `""`), annuler/clôturer mis en file (« la clôture attend dans la
  file »), correction non superposée (« reçu « Livré », attendu « Absent » »).

### Bancs et résultats (sur `9bba7a8` et suivants)

`npm run check` ; `npm test` 566/566 ; en une passe sur `9bba7a8` : e2e du lot,
tournee, tournee-mobile, ecran-livreur, carte-telephone, meilleur-trajet,
livreur-ne-perd-rien, integration-lots-1-5, operations, hors-ligne 84/84 ; et
(sur `754f406`, avant la retouche d'`app.js` de `9bba7a8`, rejouée depuis par les
84), parce qu'ils visitent la Tournée ou le
détail d'une commande : adresses-a-verifier, barre-laterale-finitions,
carte-et-lignes, clients, commandes, ecrans-sans-planche, integration-interface,
livraison-chargement, motif-dialogue, navigation-mobile, rapidite-tournee,
tableau-de-bord, tabs, tuiles-bloquees, cibles-tactiles, focus-clavier,
contraste-application, etats-limites, chargement-instantane : 174/174. Contrastes
mesurés par le banc : signal 4,89 (clair) / 4,56 (sombre) ; « Déjà dans » 4,56 /
9,28. Cibles : champ « Remis à », choix, gestes du signal ≥ 44 px.

**Banc adapté, sans l'affaiblir** : `tournee-mobile.spec.js` « 4a » comptait deux
commandes du même client, aujourd'hui et demain, **dans le filtre par défaut** — que ce
lot change (le jour). Il retire désormais le filtre de date avant de compter ; ce
qu'il garde (deux jours se distinguent sur la ligne) est intact.

Deux rouges vus en route, **non imputables** : « port 3188 / 3175 déjà pris par un
autre processus » (un autre worktree lançait les mêmes bancs en même temps) ; relancés,
verts.

### Décisions prises dans le lot

- Deux statuts neufs plutôt qu'un drapeau sur `terminee` : une annulée n'a jamais roulé
  (elle ne compte pas au tableau de bord), une clôturée si ; et le refus d'un geste
  doit dire laquelle.
- La correction est un **point d'entrée à part**, pas un geste ordinaire rouvert : le
  geste du livreur garde ses gardes (idempotence, arrêt soldé), la correction a les
  siennes (cause, commande non repartie, stock).
- « Livré » corrigé : daté du geste d'origine (`deliveredAt` de l'arrêt), c'est là que
  le livreur était.
- Un geste arrivé après la clôture mais fait avant elle **passe** : c'est la vérité du
  terrain, et le lot 1 promet que le livreur ne perd rien.
- Correction d'un arrêt en échec dont la commande est restée « en livraison » (donnée
  d'avant le lot 1, ou semée ainsi) : acceptée, rien n'est reparti.
- Annuler et clôturer demandent le réseau (jamais en file).

### Écarts nommés

- **`POST /api/livraison` et `POST /api/reset-tournee` restent** : la décision 7 ne les
  nomme pas. Plus aucun écran ne les appelle (le premier servait l'ancien panneau).
  `reset-tournee` remet une tournée en cours à « prête » et des commandes **livrées** à
  « prête » : à retirer, ou à garder derrière une confirmation, par décision.
- **La correction vers « Absent » ou « Problème » ne propose pas la liste des motifs** :
  la cause libre sert de motif (« Absent (correction : …) »).
- **Les rôles** ne restreignent que les onglets (déjà vrai) : un compte « livreur »
  peut annuler ou clôturer une tournée.
- Le champ « Remis à » ajoute une ligne (≈ 56 px) au-dessus de « Livré » : au
  téléphone de 390 × 844, « Client absent » finit à 13 px au-dessus de la barre basse
  (banc « sous le pouce » vert).
- `window.confirm` n'est pas au style V8 (même choix que le découpage et la purge).
- Trois remplacements dans `server.js` (étendre les ensembles de statuts finis, 3
  lignes) et un dans `sqliteStore.js` ont été faits par un script `py` au lieu de
  l'outil Edit ; relus par `node --check`, le diff et les bancs (dont les mutants qui
  les retirent).
- Hors périmètre, non touché : `CACHE_NAME` (le nom du shell suit l'empreinte).

### Ce qui reste

- Décider du sort de `/api/livraison` et `/api/reset-tournee`.
- Proposer les motifs dans la correction vers « Absent » / « Problème ».
- Une commande « À reprogrammer » ne s'annule toujours pas (écart du lot 1).
- Un sélecteur des tournées d'autres jours (hors « du jour » et « à solder ») n'existe
  pas : une tournée terminée hier ne se rouvre pas à l'écran (le serveur la rend).

### Relecture adverse du lot 2 (23/09) — cinq défauts, cinq vrais, cinq corrigés

Relus sur `f063247`, chacun vérifié sur le code avant d'y toucher.

- **Important, vrai : un « Livré » arrivé après la clôture ignorait une libération du
  stock faite entre-temps.** Clôture (la commande passe « À reprogrammer », réservée),
  puis `release-stock` à la main (le rayon recompte 4), puis le « Livré » en file, fait
  avant la clôture : il passait (`gesteArriveApresCloture` ne regarde pas le stock), ne
  consommait rien (plus de réservation) : le rayon comptait une marchandise livrée.
  Corrigé (`reprendreStockLibere`) : la réservation est reprise (le rayon est déduit de
  nouveau), puis consommée par la livraison, et l'historique le dit (« Stock deduit »).
  Si le rayon n'en a plus assez, le geste est **refusé en le disant** (409) : le stock ne
  passe jamais sous zéro en silence, la commande reste à reprogrammer. Rouge sur
  l'ancien code : `actual: { rayon: 24, reserve: 16 }`, attendu `{ rayon: 20, reserve: 16 }` ;
  le refus : `actual: 200, expected: 409`. **Le refus est remplacé le 23/09** (décision
  de Thomas, section « Livré en retard sur un stock à zéro », en fin de fichier) : le
  geste est accepté, le rayon passe en négatif, et c'est signalé.
- **Important, vrai : rouvert, l'écran ne montrait jamais une tournée finie.**
  `choisirTourneeAffichee` ne prenait que les tournées non soldées : la seule tournée du
  jour, terminée, donnait « Aucune tournée créée. » après un rechargement, et le
  sélecteur (caché sous deux options) n'y menait pas : l'arrêt à corriger (M2) et le
  bilan n'étaient atteignables qu'avant un rechargement. Corrigé : la dernière tournée
  du jour finie (terminée ou clôturée) est choisie après les tournées passées à solder,
  avant une tournée d'un jour à venir. Rouge : `Expected substring: "Tournée terminée"`,
  `Received string: "Aucune tournée créée."`.
- **Mineur, vrai : Entrée dans la cause de « Corriger le statut » annulait en silence.**
  Un seul champ texte, aucun bouton `submit` : Entrée soumet, `method="dialog"` ferme, et
  la fermeture valait « Annuler ». Corrigé : Entrée vaut « Corriger » (sans statut
  choisi, le dialogue reste et le dit). Rouge : `Expected: "livre"`, `Received: "probleme"`.
- **Mineur, vrai : la liste du jour cachait sans le dire les commandes prêtes en retard
  et sans date.** Corrigé par un signal dans le résumé (« Hors de cette date : 1
  commande prête en retard et 1 sans date ; vide la date pour les voir. »). Les
  commandes d'un jour à venir ne sont pas signalées : elles ne manquent rien. Rouge :
  `Received string: "3 commande(s) prête(s) - tous secteurs, mer. 23/09"`.
- **Mineur, vrai : `POST /api/livraison` restait une porte vers M7.** Elle livrait une
  commande qui attend son arrêt dans une tournée active sans solder l'arrêt. Elle
  **refuse** désormais (409, la tournée nommée) ; hors tournée, rien ne change (C1.R2
  verts). La route n'est pas retirée : son sort reste une décision (écart nommé plus
  haut). Rouge : `actual: 200, expected: 409`.

Bancs : `test/tournees-debloquees.test.js` (+3 cas, 24/24), `test/e2e/tournees-debloquees.spec.js`
(+3 cas, 14/14 ; les serveurs sont resemés sur leurs ports par `resemer`, le port
n'est écrit qu'une fois : `test/ports-e2e.test.js` vert). Verts aussi : tournee,
tournee-mobile, ecran-livreur, carte-telephone, meilleur-trajet, livreur-ne-perd-rien,
integration-lots-1-5, operations, hors-ligne (87/87 avec le banc du lot) et `npm test`
(569/569).

Ce qui reste après la relecture :

- Le dialogue du **motif** (« Client absent », « Problème », lot 1) a la même forme :
  Entrée dans la précision ferme sans enregistrer. Hors de cette relecture, non touché.
- ~~`corrigerArret` refuse toujours « Livré » sur une commande dont le stock a été libéré
  (choix du lot) ; le geste en retard, lui, reprend le stock. Aligner les deux est une
  décision.~~ **Fermé le 23/09** (décision de Thomas) : les deux reprennent le stock.
- ~~Un « Livré » en retard refusé faute de stock n'a aujourd'hui aucun chemin pour être
  enregistré (`corrigerArret` le refuse aussi) : la commande reste à reprogrammer. À décider.~~
  **Fermé le 23/09** (décision de Thomas) : il est accepté, le rayon passe en négatif et
  c'est signalé. Voir « Livré en retard sur un stock à zéro », en fin de fichier.

## Lot 6 de l audit géo : pratique au quotidien (23/09)

Audit de référence : rapport du 23/09, §3b, §5 et lot 6. Décisions de Thomas du 23/09
appliquées : n° 5 (position « Me localiser » arrondie à ~100 m : aussi pour
« Réoptimiser les arrêts restants »), n° 6 (150 km), n° 9 (pas de créneaux : « À livrer en
premier » est gardé par chaque réoptimisation). Branche `feat/tournee-pratique`, partie de
`main` 1.42.0 (`c05e6f1`).

### Fait

- **Heure d'arrivée par arrêt, km restants, heure de retour** (planches 4a/4b, 13b).
  `public/js/domains/tournee-pratique.js` (`horairesDeTournee`, pur) lit les tronçons
  OSRM du lot 7 (`route.troncons`) et la durée d'arrêt des Paramètres. Référence : maintenant
  pour une tournée prête (« si tu pars maintenant ») ; en route, l'heure du dernier geste
  (arrêt soldé le plus récent), du départ ou du dernier calcul depuis la position GPS
  (`tronconsDepuis`), la plus tardive — et jamais avant maintenant : un livreur en retard
  arrive « maintenant », la suite glisse. Un arrêt fait dans le désordre, au milieu des
  restants : le trajet passe par lui. Tronçons absents ou désaccordés (réordonnancement à la
  main, arrêt retiré d'une commande reportée) : **aucune heure plutôt qu'une heure fausse**.
  Affichage : « · vers 10 h 40 » DANS la ligne de détail (la ligne garde ses quatre
  informations, charte §4) ; cockpit « Arrivée prévue vers 10 h 40 » et « Prochain : … ·
  6,2 km · environ 14 min » (la planche 4b, posée en entier) ; en-tête « 69 km restants,
  retour vers 15 h 20 » (planche 13b) ; même chose à la suite des métriques. Heures
  arrondies à 5 min.
- **Dépôt par défaut** (Paramètres → Réglages tournée) : recherche d'adresse (le relais
  `/api/geocode` du lot 5), confirmation, « Effacer ». `settings.tournee.depot`
  `{ label ≤ 200, lat, lng }` validé au serveur (refusé plutôt que tronqué), `retourAuDepot`
  (défaut **vrai**, y compris pour une base d'avant le lot), `messagePrevenir`. Le départ de
  la préparation est prérempli tant que le livreur n'en a pas choisi un autre ; « Retour au
  point de départ » suit le réglage, et **décocher la case dans la préparation le
  mémorise** (PATCH discret, en file hors ligne). Préparer une tournée : « Tout
  sélectionner », « Créer » — **deux gestes** (banc : deux clics, départ et arrivée = dépôt).
- **« Y aller »** vers les **coordonnées** de l'arrêt quand elles existent, sinon l'adresse
  (rue et ville, la règle d'avant) : un lieu-dit sans rue, placé à la main, a son bouton.
  Un point **approximatif** (rue, lieu-dit, commune) cède à l'adresse complète quand elle
  existe (relecture adverse, ci-dessous).
  Google Maps, Waze, Plans (**seulement sur iPhone/iPad**, iPadOS compris) ; le choix vit
  dans Paramètres, **par appareil** (`localStorage`, repli sur la session), titre du bouton
  « Ouvrir l'itinéraire dans Waze ». L'écran de fin suit le même choix.
- **« Prévenir »** (cockpit, « Autres actions ») : un lien `sms:` avec le numéro du client et
  « Bonjour, je passe vers 10 h 40 pour votre livraison. » ; texte modifiable dans
  Paramètres (`{heure}` ; sans heure connue, « vers {heure} » devient « bientôt »). Aucun
  fournisseur, aucun coût : c'est l'application SMS du téléphone qui envoie. Le lien est
  refait à l'instant du toucher (l'heure a pu avancer depuis le rendu). iOS : `&body=`,
  ailleurs `?body=`.
- **« Réoptimiser »** (`POST /api/routes/:id/reoptimiser`) : tournée **prête** → dialogue
  « Partir de » (le départ prévu, le dépôt s'il diffère, ma position) ; une tournée qui
  revenait à son départ revient au nouveau. Tournée **en livraison** → « Réoptimiser les
  arrêts restants » depuis la position GPS arrondie à 3 décimales **sur le téléphone** (et
  au serveur) ; les arrêts soldés restent en tête ; le départ enregistré ne change pas.
  L'optimiseur est celui du lot 7 ; « À livrer en premier » reste devant.
- **« Faire maintenant »** (`POST …/stops/:stopId/maintenant`) : un arrêt choisi hors de
  l'ordre montre, dans le cockpit, « Prévu après X » et le bouton (pas dans la ligne : elle
  garde ses quatre informations). L'arrêt passe en tête des restants ; les tronçons des
  restants sont recalculés depuis le dernier arrêt soldé.
- **« Ajouter à la tournée en cours »** (`POST /api/routes/:id/ajouter`) : sur chaque
  commande prête, quand une tournée roule. Insertion au **moindre détour** entre le point de
  reprise, les restants et l'arrivée (table OSRM ; repli à vol d'oiseau), égale à la force
  brute sur 300 tirages. La commande passe en livraison, l'arrêt a un identifiant neuf (un
  arrêt retiré laisse son numéro à un autre : `createStop` numérote par rang).
- **Historique des tournées** (Tournée, repliable, sous la préparation) : par mois, un
  total par secteur (tournées, km **du tracé prévu**, durée **réelle** départ → dernier
  arrêt, livrés), les tournées sans tracé ou sans heures comptées à part ; les dix
  dernières. Calculé sur les tournées déjà chargées : aucune requête de plus.
- **File hors ligne et idempotence (lot 1)** : « Faire maintenant », « Ajouter », les
  réglages passent par `apiFetch` (clé `X-Sereo-Geste`, file). Un « Faire maintenant »
  hors ligne attend dans la file et l'écran montre déjà l'arrêt. Une même clé renvoyée
  n'ajoute qu'une fois (banc, deux envois simultanés puis un troisième).
- Toute réponse d'écriture porte la tournée (et la commande, le client) telle que les
  listes la rendent, avec `updatedAt` : l'écran l'applique par la mise à jour ciblée du
  lot 5 (`appliquerGesteArret`), gardes du lot 1 comprises (jamais une tournée plus
  ancienne, gestes en file superposés).

### Décisions prises

- **Réoptimiser n'est jamais mis en file** (`JAMAIS_EN_FILE`), et l'écran le refuse hors
  ligne avant tout envoi : c'est un calcul routier depuis la position de l'instant ;
  rejoué une heure plus tard, il réordonnerait la tournée d'après un endroit quitté. Même
  famille que la purge et le découpage.
- **Sans calcul routier** (OSRM muet), « Faire maintenant » et « Ajouter » changent quand
  même l'ordre ; les tronçons tombent (`null`), la réponse le dit
  (`horairesARecalculer`), la notification invite à « Réoptimiser les arrêts restants ».
  En route, le tracé reste (on n'efface pas la carte sous le livreur) ; avant le départ, il
  est à refaire, comme après un réordonnancement à la main.
- **Tronçons alignés sur l'ordre** : après un changement d'ordre en route, les soldés
  passent en tête et gardent leurs tronçons d'origine (historique), ceux des restants sont
  recalculés ; `totalDistance` = trajets faits connus + nouveau reste.
- **« Retour au départ » décoché dès qu'une AUTRE arrivée est confirmée**, sans toucher
  au réglage (seul un geste sur la case l'écrit), et les réglages qui arrivent après ne la
  recochent pas. Cause : `operations.spec.js` (commandes lentes) choisissait une arrivée,
  puis les réglages recochaient la case — l'arrivée choisie était ignorée.
- **Le choix de l'application est par appareil**, dans Paramètres, sans question au
  premier « Y aller » : le geste le plus fréquent garde un seul toucher (Google Maps par
  défaut, comme avant).
- Une commande urgente ne s'ajoute qu'à une tournée **qui roule** (bouton) ; le serveur
  accepte aussi une tournée prête (API).

### Écarts nommés

- **Hors périmètre, laissés aux autres lots de la vague 2** : l'ancien panneau
  « Clients tournée » et `/api/optimize-route` (décision 7 ; lot « tournées
  annulables », M7) ; la note « remis à… » (décision 10) ; l'écran Tournée hors ligne
  (le module neuf est dans `APP_SHELL`) ; OSRM dans l'image.
- **`tournee-mobile.spec.js` « 4b — Y aller » renversé**, pas supprimé : il attendait
  l'adresse en texte, il attend désormais les coordonnées de l'arrêt semé.
- Le SMS : le séparateur `&body=` (iOS) / `?body=` (ailleurs) est l'usage constaté, non
  mesuré sur un vrai téléphone ; un fixe ne reçoit pas de SMS (rien ne le distingue).
- Les heures sont des estimations hors trafic (tronçons OSRM + durée d'arrêt fixe) ; la
  référence en route est l'heure du dernier geste **connu du serveur** : un geste encore en
  file n'en donne pas.
- La position envoyée pour « Réoptimiser les arrêts restants » n'est pas stockée ; le tracé
  recalculé part d'elle (arrondie, ~100 m) et n'est pas rogné par `rognerTraceGps`, qui ne
  lit que départ et arrivée.
- `lib/routing.js` : une fonction ajoutée (`tableDesDurees`), en fin de fichier.
  `serveur-seme.js` : une option `routageAdaptatif` (table et tronçons suivant la
  requête), le mode par défaut ne change pas.
- Une modification de `server.js` faite par script (déplacement des constantes du lot
  avant `normalizeSettings`), et une de `package.json` (script `check`), au lieu de l'outil
  Edit ; relues par `node --check`, `npm run check` et les bancs.
- `ecrans-sans-planche.spec.js` a refusé de partir une fois (port 3306 pris par un autre
  worktree, refus voulu) ; rejoué ensuite : vert.

### Preuves rouges

Ancien code (`c05e6f1`, fichiers remis par copie, restaurés, empreinte vérifiée) :
- `tournee-pratique-serveur.test.js` : 15 rouges sur 15 — `404` sur les trois routes
  neuves, `depot` `undefined` au lieu de `null`.
- `tournee-pratique.spec.js` (un cas à la fois) : la ligne d'arrêt sans « vers … »
  (`toContainText`, heures), `#prevenirButton`, `#reoptimiserButton`, `.arret-hors-ordre button`,
  `[data-action="ajouter-a-la-tournee"]`, `#parDepotActuel` « element(s) not found » ;
  « Expected: Entrepôt de démonstration / Received: "" » (deux gestes) ; `retourAuDepot`
  « Expected: false / Received: undefined » ; historique et contraste : le panneau
  n'existe pas (le clic attend jusqu'au délai).

Mutants (copie, restauration vérifiée par empreinte), chacun rouge pour sa cause :
insertion toujours en fin (`['a','b','d','u']` au lieu de `['a','b','u','d']`) ; soldés
oubliés en tête ; position exacte envoyée (`6.0512345,47.2004567`) ; panne qui garde les
tronçons ; ajout sans passage en livraison (`pret_livraison`) ; dépôt non validé (200 au
lieu de 400) ; retour au dépôt décoché par défaut sur une base ancienne ; « à livrer en
premier » oublié en route (`d` au lieu de `a`) ; heure de référence toujours maintenant ;
retard dans le passé ; durée d'arrêt ignorée ; tronçon de trop accepté (renforcé : le premier
banc passait par une autre garde) ; « Y aller » sans les coordonnées ; Plans hors Apple ;
SMS sans heure qui garde `{heure}` ; tournées en cours dans l'historique ; trajet qui ne
passe pas par l'arrêt fait. À l'écran : heures non branchées ; lien « Prévenir » non
rafraîchi aux réglages (le défaut qu'a trouvé le premier passage du banc, corrigé) ;
« Y aller » qui ignore le choix ; réoptimiser mis en file sur un réseau muet ; réoptimiser
hors ligne non refusé ; départ non prérempli ; retour non mémorisé ; position exacte
envoyée ; arrivée confirmée qui ne décoche pas le retour (et la variante « seulement si
déjà cochée », prise par `operations.spec.js`). Un défaut trouvé par un banc existant :
`cibles-tactiles.spec.js`, le `<label>` du message dans le titre faisait 20 px de haut —
nommé désormais par `aria-labelledby`.

### Bancs

`test/tournee-pratique.test.js` (12, pur), `test/tournee-pratique-serveur.test.js` (15,
serveur et faux OSRM local), `test/e2e/tournee-pratique.spec.js` (14, ports **3332** et
**3333**, horloge du navigateur figée, contraste ≥ 4,5:1 en clair et en sombre, 44 px).

Vérifié sur `1a2db4e` (le code de la tête ; seul ce fichier a changé depuis) :
`npm run check` ; `npm test` 572/572 ; e2e tournee-pratique, tournee, tournee-mobile,
ecran-livreur, carte-telephone, meilleur-trajet, livreur-ne-perd-rien,
integration-lots-1-5, operations, hors-ligne, carte-et-lignes, rapidite-tournee,
ecrans-sans-planche : 116/116. Sur `b268646` (même code) : parametres,
parametres-mobile, cibles-tactiles 28/28 ; texte-coupe, focus-clavier,
contraste-application, contraste-champs, integration-interface, typographie,
charte-composants, etats-limites : verts. Sur `076813c` (avant le correctif du
`<label>`, une ligne de `index.html`) : themes, tabs, livraison-chargement,
chargement-instantane verts.

### Ce qui reste

- Mesurer les heures annoncées contre les heures réelles (les gestes sont datés) et
  ajuster la durée d'arrêt par client ou par secteur.
- Un « Prévenir » groupé (les N prochains clients) ; le choix de l'application au premier
  « Y aller » si les livreurs ne vont pas dans Paramètres.
- Réoptimiser en route sans GPS (depuis le dernier arrêt soldé).
- L'historique : km **roulés** (aucune trace n'est enregistrée), export.

### Relecture adverse du 23/09 : six défauts, six vrais

Relecture de `f5c572d`. Chaque défaut a été vérifié par un banc écrit AVANT le correctif et
commité rouge (`8a2991a`, sur le code de `f5c572d`) ; correctifs `4e610bd` (serveur) et
`5110ba7` (écran).

1. **Important, vrai : « Y aller » préférait tout point, même approximatif.** Une commande
   géocodée « au milieu de la rue » (type BAN `street`, accepté comme TROUVÉ) ouvrait
   Google Maps au milieu d'une route de plusieurs kilomètres, là où le texte « 48 route de
   Lons 39300 Champagnole » menait au numéro (la règle d'avant le lot). Corrigé :
   `lienNavigation` lit `geoPrecision` ; `rue`, `lieu-dit`, `commune` cèdent à l'adresse
   complète quand elle existe. Sans adresse, le point reste (le texte ne ferait pas mieux) ;
   `numero`, `manuel` (position placée à la main) et une précision vide gardent le point.
   Rouge : `actual: '…destination=46.75,5.91'`, `expected: '…destination=48%20route%20de%20Lons…'`.
2. **Important, vrai : l'ajout en route pouvait passer devant un « À livrer en premier ».**
   `meilleurePlace` comparait toutes les places de 0 à n. Corrigé : un argument `depuis`, la
   place qui suit le dernier « en premier » des restants. Rouge : tournée [d (en premier),
   c, b, a], `u` près du dépôt → `expected: 'd'`, `actual: 'u'` ; témoin sans épingle : `u`
   passe bien en tête.
3. **Important, vrai : une tournée sans arrivée se réoptimisait en boucle.** En route,
   l'arrivée devenait la position du livreur : ordre de circuit fermé, retour fictif dans
   les km restants, l'heure de « retour » et `totalDistance` (repris par l'historique).
   Avant le départ, le serveur refusait une réoptimisation sans arrivée, et le dialogue en
   imposait une (le nouveau départ) sans lire « retour au dépôt ». Corrigé : `roadPlan`
   prend `arriveeLibre` — le chemin OUVERT du lot 7 (l'arrivée coûte 0 depuis chaque arrêt,
   le tracé s'arrête au dernier, le tronçon « vers l'arrivée » est nul : toujours un par
   arrêt, plus un) ; le serveur l'emploie dès qu'aucune arrivée n'existe ; le dialogue,
   pour une tournée sans arrivée, n'en envoie une (le nouveau départ) que si « retour au
   dépôt » est coché ; l'écran dit « fin vers » au lieu de « retour vers »
   (`horairesDeTournee` rend `avecRetour`). Rouges : `totalDistance` `expected: 3.5`,
   `actual: 6` (en route) ; `400 « Confirme un point de départ et un point d'arrivée. »`
   (prête) ; e2e « Expected substring: "fin vers" / Received: "… retour vers 23 h 25" » ;
   mutant du seul dialogue : « Expected path: not "arrival" / Received value: {Entrepôt…} ».
4. **Mineur, vrai : une position corrigée pendant le calcul était écrasée.** L'empreinte de
   la tournée ne contrôle que ids et statuts ; `memoriserPositionDuCalcul` réécrivait le
   point de l'instantané en gardant `geoSource: "manuel"`. Corrigé : l'empreinte des
   positions lues pour le calcul (celle de `positionPourTournee`, client compris) est
   recomparée sous le verrou, pour les restants (réoptimiser) et pour la commande
   (ajouter) ; même refus que `createRoute` : « Une position a été corrigée pendant le
   calcul. Recommence. ». Rouges : `[47.2, 6.02, 'manuel']` au lieu de `[47.21, 6.022,
   'manuel']` (et de même pour l'ajout). Le banc joue la correction PENDANT la requête OSRM
   (crochet `pendantLeCalcul` du faux OSRM).
5. **Mineur, vrai : une commande absente rajoutée à SA tournée n'était plus retirée par un
   report.** Décision : l'ajout reste permis (repasser l'après-midi chez un absent du matin
   est un usage) ; c'est `retirerDesTourneesSiReportee` (M4, lot 1) qui prend désormais
   l'arrêt ENCORE À FAIRE de la commande, pas le premier. Un arrêt soldé n'est toujours
   jamais retiré. Rouge : `['absent', 'en_livraison']` au lieu de `['absent']`.
6. **Mineur, vrai : « déjà dans une tournée active » n'était vérifié que sur
   l'instantané.** Une tournée prête créée au bureau pendant le calcul prenait la commande
   sans changer son statut. Corrigé : le contrôle est refait sous le verrou. Rouge :
   `expected: 400`, `actual: 201` (la tournée concurrente créée par le crochet du faux OSRM).

**Écarts nommés.** Une précision vide (point d'origine inconnue, antérieur au lot 3) garde
le point : rien ne dit qu'il est approximatif. Une position placée à la main dans
« Adresses à vérifier » sans déplacer le marqueur garde la précision d'origine (`rue`…) ;
l'arrêt ne porte pas `geoSource`, « Y aller » la traite donc comme approximative et suit
l'adresse. « Faire maintenant » et « Ajouter » sur une tournée sans arrivée font toujours
tomber les heures (`trajetDansLOrdre` exige une arrivée) : rien de faux n'est affiché.
Constaté hors du lot, non corrigé : `createRoute` SANS départ (pas de `plan`) ne vérifie
pas « déjà dans une tournée active » ; une tournée prête peut donc reprendre une commande
d'une autre tournée prête. Deux mutations temporaires d'`app.js` faites par script
(copie, restaurée par `cp` et `cmp`), rien de commité ainsi.

**Bancs.** `test/tournee-pratique.test.js` +2 (14), `test/tournee-pratique-serveur.test.js`
+7 (22), `test/e2e/tournee-pratique.spec.js` +1 (15, port 3333, réponse du serveur
retouchée pour une tournée sans départ). Résultats sur `5110ba7` : `npm test` 581/581 ;
e2e tournee-pratique, tournee, tournee-mobile, ecran-livreur, carte-telephone,
meilleur-trajet, livreur-ne-perd-rien, integration-lots-1-5, operations, hors-ligne :
88/88.

## 23/09 — L écran Tournée se rouvre sans réseau (décision 4)

Source : arbitrage ouvert le 18/09 (section de la file hors ligne, plus haut), M10 de
l'audit géo du 23/09. Décision de Thomas : **l'écran Tournée, et seulement lui**, se
rouvre sans réseau — onglet fermé, téléphone redémarré. Branche
`feat/tournee-hors-ligne`, partie de `main` v1.42.0 (`c05e6f1`).

### Fait

- **Le service worker garde la page** (`public/service-worker.js`, `naviguer`). La
  navigation passe toujours au réseau d'abord : c'est elle qui porte le contrôle de
  session. Chaque navigation réussie range le HTML de l'application **dans le cache
  de données** (`sereo-api-…`, clé `/__sereo/page-tournee`) : il part donc avec lui à
  la déconnexion (`POST /logout`) et à l'expiration de session (401, `apiFetch`).
- **Il ne la rend que pour la tournée**, et à quatre conditions : la navigation vise
  `#livreur` (ou `?ecran=livreur`, pour un navigateur qui ne transmettrait pas
  l'ancre) ; le réseau a échoué, se tait depuis 5 s, ou la passerelle répond
  502/503/504 ; la session connue n'est pas finie ; la page gardée annonce le shell de
  **ce** service worker (sinon ses scripts, servis par ce cache-ci, ne seraient pas
  les siens). La copie garde les en-têtes de la page (CSP comprise) et porte
  `data-ouverte-hors-ligne` sur `<html>`.
- **La session, dite par le serveur** (`server.js`, `finDeSessionConnue`) : la page
  annonce `X-Sereo-Session-Fin` = émission du cookie + 12 h, jamais plus (hors ligne,
  personne ne peut la prolonger). L'en-tête est aussi sur le 304 d'une revalidation
  (le navigateur remplace les en-têtes gardés par ceux du 304). La **page de
  connexion** annonce « 0 » : le service worker vide alors tout le cache de données,
  page et données — la session est finie, rien ne se rouvre. Qu'elle soit rendue en
  place sur « / » ou ouverte directement (`/login`, favori) : ce second cas ne passait
  pas par le service worker, corrigé par la relecture adverse (plus bas). Sans session du tout
  (authentification désactivée, ou accès Basic sans cookie), rien n'est annoncé :
  la page n'est ni gardée ni oubliée.
- **Les autres écrans, hors ligne** : une navigation vers un autre écran rend une
  page du service worker, « Hors ligne — cet écran demande le réseau », avec un
  bouton « Ouvrir la tournée » seulement si une copie valide existe (sans session :
  « Séréo demande le réseau pour s’ouvrir. », rien d'autre). Dans la page rouverte,
  les autres onglets ne montrent pas leurs données de secours : `#ecranDemandeReseau`
  le dit à leur place (état vide de la charte, bouton 44 px vers la tournée).
- **Le bandeau** dit « Hors ligne — données de HH:MM » (ou « du JJ/MM ») dès que
  l'écran montre des copies, et dès la copie lue au démarrage. Des données fraiches,
  puis une coupure : « Hors ligne depuis HH h MM », comme avant.
- **Les gestes en file** restent superposés (lot 1) : l'arrêt livré hors ligne revient
  « Livré — En attente d’envoi » après le redémarrage, et l'écran ne propose pas de
  le relivrer.
- **Au retour du réseau** (`auRetourDuReseau`) : la file part **d'abord**, puis, si
  l'écran montre des copies, tout se relit. Au premier chargement complet venu du
  réseau, la page redevient entière (`quitterOuvertureHorsLigne` : marque retirée,
  identité et version relues).
- `registration.update()` sans `catch` : hors ligne, son rejet remontait en erreur de
  page. Il n'était jamais atteint avant (la page ne s'ouvrait pas hors ligne).

### Décisions prises dans le lot

- **La page vit dans le cache de données, pas dans celui du shell** : elle hérite
  ainsi des deux purges existantes (déconnexion, 401) sans code de plus.
- **« Seulement la tournée » lu strictement** : l'icône de l'écran d'accueil
  (`start_url` = `/`) rouvre, hors ligne, la page « demande le réseau » avec son
  bouton « Ouvrir la tournée » — un toucher de plus, plutôt qu'une application
  entière servie sans réseau.
- **Réseau muet** : copie au bout de **5 s** (défaut ; plage raisonnable 3 à 10 s : en
  dessous, un serveur lent au réveil ferait ouvrir la copie ; au-dessus, le livreur
  attend devant un écran blanc). Seulement pour la tournée : un autre écran attend le
  réseau.
- **Sans authentification, pas d'ouverture hors ligne** : il n'y a pas de session,
  donc pas de « session valide connue ». Mesuré : la première version annonçait 12 h
  dans ce cas, et `chargement-instantane.spec.js` « la déconnexion vide le cache de
  données » rougissait (le serveur sans authentification sert l'application à la
  place de `/login`, et la navigation remettait la page dans le cache). La
  production a l'authentification (DEPLOYMENT.md).

### Écarts nommés

- **Une nouvelle version activée pendant que la page est ouverte** (le toast
  « Recharger ») : la page gardée annonce l'ancien shell, elle n'est plus rendue ;
  la tournée ne se rouvre hors ligne qu'après une navigation en ligne sur la nouvelle
  version. Choisi : jamais d'ancien HTML sous de nouveaux scripts.
- **La session ne glisse pas** : elle finit 12 h après la connexion. Un livreur
  connecté la veille au soir ne rouvre pas sa tournée hors ligne le matin — le
  serveur l'aurait refusé de toute façon. Allonger la session est une décision de
  sécurité, hors de ce lot. **Tranché le 23/09** : Thomas garde 12 h (« Session de
  12 h gardée », en fin de fichier).
- **Une session qui expire pendant que la page rouverte est affichée** : la page ne
  se referme pas d'elle-même ; seule la réouverture suivante est refusée.
- **Un compte désactivé, ou une session invalidée côté serveur**, pendant que le
  téléphone est hors ligne : le téléphone ne peut pas le savoir. La copie se rouvre
  jusqu'à la fin annoncée (émission + 12 h), avec les noms, adresses et téléphones de
  la tournée. Au premier contact avec le serveur (navigation, sonde de retour, toute
  lecture), le refus arrive : page de connexion ou 401, et le cache de données part.
  Fermer cet écart demanderait de ne rien rouvrir hors ligne — contraire à la
  décision 4 ; raccourcir la fenêtre, c'est raccourcir la session (décision de
  sécurité, hors de ce lot). **Tranché le 23/09 par Thomas (défaut validé)** : la
  session de 12 h est gardée, et cet écart est accepté comme le prix de la
  décision 4. Voir « Session de 12 h gardée », en fin de fichier.
- **Safari et l'ancre** : non mesuré (aucun banc WebKit). Le bouton « Ouvrir la
  tournée » passe par `?ecran=livreur`, que le service worker reconnaît sans l'ancre ;
  un favori `/#livreur` sur iPhone, lui, reste non vérifié.
- **L'instrument** : Playwright 1.61 + Chromium, profil relancé hors ligne — les
  requêtes d'API du service worker échappaient à l'émulation (16 « requestfinished »
  côté service worker, pastille « À jour » hors ligne). Le banc coupe donc aussi le
  chemin (mandataire qui ferme toute connexion) ; `navigator.onLine` vient de
  `setOffline`.
- **La file est celle du navigateur** (lot 1) : inchangé.

### Bancs, et le rouge de chacun

`test/e2e/tournee-hors-ligne.spec.js` (serveur semé **authentifié**, port 3334, connexion
par le formulaire, navigateur fermé puis relancé sur le même profil) :

1. fermée puis rouverte hors ligne, téléphone redémarré : la tournée revient, geste en
   file compris ; le reste demande le réseau ; tout repart au retour ;
2. après la déconnexion, rien ne se rouvre (témoin dans le cas : la même ouverture,
   avant, rend la tournée ; puis, file vide, le retour du réseau relit tout) ;
3. session perdue (la page de connexion) : copie et données oubliées (témoin : avant,
   elles sont là) ;
4. rouverte par une passerelle en erreur (502), téléphone qui se croit en ligne : au
   retour du serveur, tout repart sans événement `online` (relecture adverse).

`test/tournee-hors-ligne.test.js` : 15 cas du service worker (vrai fichier, bac à sable ;
2 ajoutés par la relecture adverse)
et 3 cas du serveur (HTTP, authentification active). `test/api.test.js` : sans
authentification, aucune fin annoncée.

| Retiré (v1.42.0, ou mutant par copie, restauré par copie) | Banc | Rouge |
|---|---|---|
| tout (sources de `c05e6f1`) | e2e 1 | `page.goto: net::ERR_FAILED at …/#livreur` |
| idem | e2e 2 | témoin : `net::ERR_FAILED` |
| idem | e2e 3 | témoin : la clé `/__sereo/page-tournee` absente |
| idem | unitaires | 11 rouges sur 16 (les 5 verts : négatifs dont le témoin rougit) |
| fin de session ignorée | unitaire « session EXPIREE » | `'copie'` au lieu de `'hors-ligne'` |
| tous les écrans rendus | unitaires « AUTRE écran », « réseau MUET » | `'copie'` ; `'repondu'` au lieu de `'attend'` |
| pas de purge sur la page de connexion | unitaire « CONNEXION » | `true` au lieu de `false` |
| shell ignoré | unitaire « AUTRE version » | `'copie'` |
| pas de délai | unitaire « réseau MUET » | `null` |
| pas de repli sur 502 | unitaire « passerelle » | `null` au lieu de `'copie'` |
| pas de marque | unitaire « COPIE, marquée » | le HTML sans `data-ouverte-hors-ligne` |
| en-tête de fin retiré | unitaire « serveur — fin de SA session » | `null` |
| « 0 » retiré de la page de connexion | unitaire ; e2e 3 | `null` ; 24 clés restent en cache |
| 12 h sans authentification | `api.test.js` | `'1790231224895'` au lieu de `null` |
| titre du bandeau sans date | e2e 1 | reçu « Hors ligne » |
| `#ecranDemandeReseau` jamais montré | e2e 1 | `hidden` |
| jamais de sortie du mode | e2e 1 | le bandeau reste visible |
| retour du réseau sans relecture | e2e 2 | reçu « Données de 20:21 » au lieu de « À jour » |
| `registration.update()` sans `catch` | e2e 1 | `Failed to update a ServiceWorker…` en erreur de page |
| règle CSS des pages retirée | e2e 1 | `#stock` visible |

**Exécutions** (sur l'arbre final) : `npm run check` ; `node --check` du service
worker ; `npm test` 562/562 ;
e2e tournee-hors-ligne, tournee, tournee-mobile, ecran-livreur, carte-telephone,
meilleur-trajet, livreur-ne-perd-rien, integration-lots-1-5, operations, hors-ligne,
etats-limites, chargement-instantane, tabs : 92/92 (un premier passage a buté sur des
ports pris par d'autres worktrees — 3188, 3190, 3194 —, rejoués verts) ;
interface-finitions, abonnements-mobile, clients-mobile : 45/45.

### Relecture adverse (23/09) : trois défauts, trois corrections

- **Rouverte par le délai de 5 s ou par une passerelle en erreur, la page ne
  revenait jamais d'elle-même** (important, vrai). Le seul déclencheur du retour
  était l'événement `online` ; un téléphone qui se croit en ligne (4G sans débit,
  serveur OMV arrêté pendant que `sereo-updater` reconstruit l'image) ne l'émet
  jamais. La page restait « Hors ligne », figée, les autres écrans bloqués. Corrigé
  (`app.js`, `sonderLeRetourDuReseau`) : tant que la page est rouverte hors ligne,
  toutes les 20 s (le rythme du renvoi de la file) et au retour au premier plan, une
  sonde légère (`GET /api/me`, jamais mise en cache par le service worker, 8 s au
  plus) ; toute réponse qui ne vient pas d'une passerelle en erreur (502/503/504)
  lance `auRetourDuReseau` — un 401 aussi : la relecture renvoie alors vers la
  connexion et vide le cache. `auRetourDuReseau` ne se lance plus deux fois en même
  temps (sonde et `online` peuvent se croiser). Page ouverte normalement : rien ne
  change, la sonde ne part pas.
- **Une copie déjà rendue, puis la page réseau d'une version plus récente**
  (mineur, vrai) : le service worker classait quand même la page « en retard »,
  et ses fichiers suivants arrivaient en nouvelle version sous l'ancien HTML.
  Corrigé (`service-worker.js`, `naviguer`) : la page n'est « en retard » que si
  c'est la page réseau qui est rendue.
- **La page de connexion ouverte directement ne vidait rien** (mineur, vrai) : le
  service worker laissait passer toute navigation vers `/login`. Corrigé : une
  navigation vers `/login` passe par lui ; si le serveur rend la page de connexion
  (« 0 »), le cache de données part. Hors ligne, rien n'est vidé : le livreur qui
  ouvre `/login` par erreur garde sa tournée. `/login.js` et `POST /login` restent
  hors du service worker. La révocation hors ligne, elle, est un écart nommé
  (plus haut) : aucune correction ne la ferme sans renoncer à la décision 4.

| Retiré (code de `1d20c2f`) | Banc | Rouge |
|---|---|---|
| sonde de retour | e2e 4 « PASSERELLE en erreur (502) » | reçu « Données de 20:45 » au lieu de « À jour » après 45 s (préalables verts : copie, `navigator.onLine` vrai, bandeau daté) |
| garde « page réseau rendue » | unitaire « copie rendue PUIS page réseau » | `'nouveau'` au lieu de `'ancien'` (témoin, page réseau rendue : `'nouveau'`, vert) |
| `/login` par le service worker | unitaire « navigation DIRECTE vers /login » | `true` au lieu de `false` (témoin hors ligne : rien vidé, vert) |

### Ce qui reste

- Vérifier sur un vrai téléphone (Android Chrome, iPhone Safari) : icône de l'écran
  d'accueil hors ligne, puis « Ouvrir la tournée » ; redémarrage du téléphone.
- ~~La durée de session (12 h, sans glissement) décide de ce qui se rouvre le matin :
  à trancher si les tournées commencent loin de la connexion.~~ **Fermé le 23/09** :
  Thomas garde la session de 12 h (« Session de 12 h gardée », en fin de fichier).
- Relecture adverse de ce lot.

## Calcul routier OSRM intégré à l image Séréo (23/09)

Décision 2 revue par Thomas : **aucune manipulation de sa part**. Son serveur (OMV,
Docker, service `sereo-updater`, builder Docker LEGACY) reconstruit l'image depuis le
`Dockerfile` à chaque release ; le compose côté serveur, hors dépôt, ne change pas.
Tout le reste est dans l'image et dans Séréo. Branche `feat/osrm-integre`.

### Fait

- **Image.** `Dockerfile` : base `node:24-trixie-slim` (Debian 13, la même que l'image
  OSRM) au lieu de `node:24-alpine`, dont la libc (musl) n'exécute pas les binaires
  OSRM officiels (glibc). Étape `FROM ghcr.io/project-osrm/osrm-backend:v26.9.0-debian
  AS osrm` (version **épinglée** ; l'image Docker Hub `osrm/osrm-backend` n'est plus
  publiée depuis 2021, v5.25) ; `COPY --from=osrm` de `osrm-extract`, `-partition`,
  `-customize`, `-routed` et du profil voiture (`/opt/osrm/profiles/car.lua` et son
  dossier `lib/`). Par apt (`--no-install-recommends`) : `tini`, `osmium-tool`,
  `ca-certificates`. `/sbin/tini` est un lien vers `/usr/bin/tini` : ENTRYPOINT
  inchangé. HEALTHCHECK par `node -e fetch(...)` (pas de `wget` sur slim). Utilisateur
  `node` (uid 1000), `NODE_ENV`, variables : inchangés.
- **Vérifié dans l'image construite** (builder legacy, `DOCKER_BUILDKIT=0`) : `ldd` des
  quatre binaires OSRM et d'`osmium` : **0 bibliothèque manquante** (OSRM ne dépend que
  de libstdc++, libgcc, libm, libc) ; `osrm-routed --version` v26.9.0 ; osmium 1.18.0 ;
  `node:sqlite` (SQLite 3.53.4) ; `nice` et `ionice` présents ; `id` = 1000(node).
- **Taille de l'image** : 76,4 Mo → **113 Mo** compressés (contenu) ; 312 Mo → **464 Mo**
  sur disque (mesures `docker image ls`, avant = arbre de `main` `c05e6f1`).
- **Gestionnaire `lib/osrm-local.js`**, démarré par `startServer()` APRÈS l'écoute et
  sans être attendu (`demarrer()` rend la main, ne jette jamais, `setImmediate`) :
  1. choisit la zone selon la mémoire (`os.totalmem`, ou la limite du cgroup
     `process.constrainedMemory()` si plus basse) et le disque libre du volume
     (`statfs`, plus la place déjà prise par nos cartes) — tableau plus bas ;
     `SEREO_OSRM_ZONE` la force (`france`, `voisins`, `region`, `aucune`, ou des
     chemins Geofabrik comme `europe/monaco`) ;
  2. télécharge les extraits Geofabrik en HTTPS dans `/app/data/osrm/telechargements`,
     reprend un téléchargement interrompu (`Range` + `If-Range` sur l'ETag), vérifie la
     somme MD5 **publiée par Geofabrik** : un fichier faux est supprimé et refusé ;
  3. **fusionne** plusieurs extraits avec `osmium merge`. Choix : `osrm-extract` ne lit
     qu'un fichier, et préparer chaque région à part donnerait des cartes séparées où
     Besançon → Mulhouse ou Dole → Lausanne serait incalculable ; osmium coûte
     quelques Mo dans l'image ;
  4. prépare `extract → partition → customize` (MLD, profil voiture) sous `nice -n 19`
     et `ionice -c 3`, avec la moitié des cœurs, dans `versions/<v…>-en-cours`, **à
     côté** de la carte en service ; ne bascule qu'après succès complet : renommage du
     dossier, puis pointeur `courante.json` réécrit par renommage (atomique). Un échec
     supprime le dossier en cours et **garde l'ancienne carte**, qui continue de
     servir ;
  5. lance `osrm-routed --algorithm mld --ip 127.0.0.1 --port 5000 --mmap
     --default-radius 3000`, le sonde (prêt au premier HTTP), le surveille et le
     **relance** s'il meurt (2 s, 5 s, 15 s, 60 s, puis 5 min) ;
  6. refait la carte **chaque mois** : à 3 h (Europe/Paris) quand elle a 30 jours ; la
     toute première carte part 2 minutes après le démarrage, à toute heure ; après un
     échec, nouvel essai à 3 h, jamais deux essais à moins de 20 h ; supprime les
     anciennes versions et les extraits après une bascule réussie ;
  7. journalise chaque étape (`[osrm-local] …`, sans URL complète ni donnée
     personnelle) ; `SEREO_OSRM_LOCAL=0` coupe tout (ni réseau, ni processus, ni
     dossier) ; sans binaires OSRM (poste de développement, CI), il ne fait rien.
- **Routage.** `lib/routing.js` : `definirServeurLocal()`. Quand la carte locale est
  prête, elle passe AVANT la chaîne du lot 7 (`SEREO_ROUTING_URL`, puis son repli), qui
  reste le repli. Un refus de la carte locale (4xx, typiquement `NoSegment` : point à
  plus de 3 km de toute route de la zone) envoie CE calcul au serveur suivant, sans
  pause ; une panne (réseau, délai, 5xx) met la carte locale en pause 60 s, comme le
  principal. Le code du lot 7 est inchangé ; ses bancs restent verts.
- **État visible.** `/api/storage/status` porte `calculRoutier` (actif, prêt, zone, date
  de la carte, étape en cours, dernière erreur, espace utilisé, raison, `resume`).
  Paramètres → « Réglages tournée » : une ligne « Calcul routier » affiche `resume`,
  par exemple « Sur carte locale « Bourgogne-Franche-Comté », données du 22/09/2026,
  1,2 Go. » ou « Serveur public en attendant la carte locale « … » : téléchargement
  1/2 : 42 %. ». Aucun CSS ajouté (`.item`, `.muted` existants).
- `.env.example` : `SEREO_OSRM_LOCAL`, `SEREO_OSRM_ZONE`, `SEREO_OSRM_DIR`,
  `SEREO_OSRM_PORT`. `npm run check` vérifie `lib/osrm-local.js`.

### Zones et défauts prudents

Seuils = mémoire ET disque (libre + nos cartes). Tailles des extraits Geofabrik
relevées le 22/09/2026 ; Geofabrik découpe la France selon les ANCIENNES régions.

| Zone | Extraits | Téléchargement | Mémoire exigée | Disque exigé |
|---|---|---|---|---|
| `france` | `europe/france` | 5,1 Go | ≥ 24 Go | ≥ 50 Go |
| `voisins` | bourgogne, franche-comte, alsace, lorraine, champagne-ardenne, auvergne, rhone-alpes, centre, ile-de-france, switzerland | 2,5 Go | ≥ 12 Go | ≥ 30 Go |
| `region` | bourgogne, franche-comte | 0,33 Go | ≥ 3 Go | ≥ 6 Go |
| (rien) | serveur public | — | — | — |

Base des seuils (estimations, **non mesurées au-delà de Monaco**) : `osrm-extract`
monte à environ 2,5 fois l'extrait en mémoire, plus Séréo et l'ancienne carte qui sert
pendant la mise à jour ; disque = extraits + fusion + DEUX cartes (l'ancienne reste
jusqu'à la bascule), une carte MLD pesant 2 à 4 fois l'extrait (Monaco mesuré : 1,25 Mo
de carte pour 0,69 Mo d'extrait, 1,8×).

### Vérification réelle (Docker Desktop, ce poste, 23/09)

Image construite avec `DOCKER_BUILDKIT=0`, lancée avec `SEREO_OSRM_ZONE=europe/monaco`
et un volume neuf :

- `/healthz` : **200 en 0,5 s** après `docker run` ; conteneur `healthy` (healthcheck
  node, code 0).
- Au bout de 2 min : téléchargement (MD5 vérifiée), extract, partition, customize,
  bascule, `osrm-routed` lancé et prêt, **en 2 s** au total ; `courante.json`, un seul
  dossier de version, extraits supprimés, 1,25 Mo sur le disque ; `osrm-routed` à 7 Mo
  de mémoire (mmap).
- Dans le conteneur : `/route` Ok (2 009 m, 228 s) ; un point à Paris → **400
  NoSegment** : le rayon de 3 km refuse bien un point hors zone.
- **Tournée par Séréo** : conteneur relancé avec `SEREO_ROUTING_URL=http://127.0.0.1:9`
  (injoignable) et `SEREO_ROUTING_REPLI_URL=` (aucun repli) : la carte locale était
  le SEUL chemin possible. `POST /api/routes` sur 3 commandes fictives à Monaco :
  **201, `routingMode: road`, 4,6 km**. Au redémarrage, la carte en place est relancée
  sans rien retélécharger.
- **Relance réelle** : `osrm-routed` tué (`SIGKILL`) → la tournée suivante échoue
  (« indisponible » : aucun repli dans ce montage, contre-témoin) → relance au bout de
  2 s → la tournée d'après passe (201, 4,6 km).
- `docker stop` : 0,37 s. Conteneur, volume, images de test, image OSRM et
  `node:24-trixie-slim` supprimés ensuite.

### Preuves rouges (ancien code, ou mutant ; cause lue)

- `test/dockerfile-osrm.test.js` sur l'ancien `Dockerfile` : « aucune etape OSRM : FROM
  node:24-alpine » ; « wget n'existe pas sur l'image slim : le healthcheck echouerait
  toujours ».
- `test/osrm-routage-local.test.js` sur les anciens `lib/routing.js` et `server.js` :
  « server.js n'a pas de gestionnaire de carte locale », « lib/routing.js ne connait pas
  la carte locale » (×3).
- `test/e2e/calcul-routier.spec.js` sur l'ancien `app.js` + `index.html` : « element(s)
  not found » (×2) ; nouvel `index.html` avec l'ancien `app.js` : « Expected: "Serveur
  public (binaires OSRM absents de cette installation)." / Received: "Chargement…" ».
- `lib/osrm-local.js` est neuf : son banc (`test/osrm-local.test.js`) et celui du
  routage sont éprouvés par **20 mutants, 20 rouges, 0 échappé** (harnais en TAP ;
  témoin : bancs non mutés verts). Un par comportement : ressources ignorées (« 16 Go
  de memoire : pas la France entiere ») ; MD5 non vérifiée (préparation réussie sur un
  fichier faux) ; bascule avant la préparation (« pointeur deja bascule pendant
  osrm-extract », « le pointeur a bouge malgre l'echec ») ; dossier en cours gardé
  (« version a moitie preparee laissee ») ; pas de relance (« jamais relance ») ;
  `SEREO_OSRM_LOCAL` ignoré ; binaires non vérifiés ; pas de reprise ; planning sans
  l'heure (« carte de 31 jours refaite a 14 h ») ; sans le délai de 20 h ; pas de
  priorité basse (« osmium sans priorite basse ») ; `demarrer()` qui rend une promesse ;
  anciennes versions gardées ; heure de Paris par `format()` (« heure de Paris
  illisible » : `fr-FR` rend « 03 h », `Number` donne NaN — défaut réel, trouvé par le
  banc pendant l'écriture) ; tailles en Go seulement ; refus local sans bascule (« Le
  calcul routier refuse une des positions… ») ; pas de pause après panne ; carte
  jamais consultée ; `server.js` qui ne branche pas son gestionnaire ; état absent de
  `/api/storage/status`.
- **Défaut trouvé en relisant, corrigé** (`f27206a`) : le flux d'écriture de l'extrait
  n'avait pas d'écouteur « error ». Banc « ecriture impossible pendant le
  telechargement » (réseau lent, dossier à la place du fichier partiel) sur le code
  d'avant : **exception non rattrapée** `EISDIR … open …europe_a.osm.pbf.part` (Séréo
  serait tombé), puis préparation bloquée jusqu'au délai de silence. Harnais repassé
  sur le code final : 20 mutants, 0 échappé (témoins : 14 et 4 `ok`).
- Le premier passage du harnais disait **20 échappés** : il cherchait des lignes TAP
  (`not ok`) dans la sortie du rapporteur par défaut. Instrument muet, pris par son
  propre compte ; corrigé (`--test-reporter=tap`, témoin qui compte les `ok`) avant
  tout verdict.

### Bancs

`npm run check` ; `npm test` **565/565** (dont `test/osrm-local.test.js` 14, `test/osrm-routage-local.test.js` 4, `test/dockerfile-osrm.test.js` 2). E2E par `pw-lot.config.js` (port 3326) :
`calcul-routier`, `carte-telephone`, `ecran-livreur`, `hors-ligne`,
`integration-lots-1-5`, `livreur-ne-perd-rien`, `meilleur-trajet`, `operations`,
`parametres`, `parametres-mobile`, `tournee`, `tournee-mobile`, `tabs`. Premier passage
86/88 : rouges `carte-telephone:140` et `ecran-livreur:65`, verts au passage suivant
(19/19), cause non lue. Second passage 77/80 : les trois rouges sont des **ports pris
par un autre processus** (3188, 3175, et 3118 pour `operations.spec.js`, qui ne vérifie
pas le sien) pendant que d'autres agents lançaient les mêmes bancs ; repassés seuls,
verts (tournee-mobile, operations, livreur-ne-perd-rien 11/11).

### Écarts nommés

- La vérification Docker a porté sur l'arbre de `6ad728d` ; le correctif d'écriture
  (`f27206a`) n'a été éprouvé que par les bancs, pas rejoué dans une image.
- **Seuils de zone estimés**, pas mesurés : la première préparation chez Thomas sera la
  première mesure réelle d'une région. La ligne de Paramètres et `docker logs` diront
  la zone choisie, la durée de chaque étape et l'espace pris.
- **Bascule mensuelle : quelques secondes de coupure.** `osrm-routed` est arrêté puis
  relancé sur la nouvelle carte (un seul port, 5000). Pendant ce temps, tant que la
  première carte n'est pas prête, et pour un point hors zone, le calcul passe par le
  repli du lot 7 : les coordonnées de ces tournées-là sortent chez le serveur public.
- **Rayon de 3 km** : un point hors zone mais à moins de 3 km d'une route de la zone est
  accroché à cette route (calcul approché) au lieu d'aller au serveur public.
- **Mémoire vue** : sans limite de mémoire sur le conteneur, `os.totalmem()` voit la
  machine entière, y compris la part prise par les autres services de l'OMV. Les seuils
  sont prudents pour cela ; `SEREO_OSRM_ZONE=region` le règle si besoin.
- **Nouvelle dépendance de construction** : l'image OSRM vient de `ghcr.io`. Si le
  serveur ne l'atteint pas pendant une reconstruction, le build échoue et le conteneur
  reste sur l'ancienne image (repli non destructif de `sereo-updater`).
- La zone `voisins` prend les anciennes régions ENTIÈRES (tout Rhône-Alpes, tout le
  Centre…) : plus large que le rayon de 150 km, c'est voulu (« zone plus large que la
  région pour tout couvrir »).
- Hors Docker, si Node est tué par un signal, `osrm-routed` peut lui survivre (le
  gestionnaire ne le tue que sur `exit`) ; dans Docker, il disparaît avec le conteneur
  (mesuré : `docker stop` 0,37 s).
- Le crochet « hawkscan » proposé après le commit n'a pas été lancé (aucune clé, aucune
  application exposée pour lui).
- Docker Desktop a été démarré sur ce poste pour la vérification (il était arrêté) ; il
  reste démarré.

### Ce qui reste

- Relever, après la release, sur la ligne de Paramètres et dans `docker logs sereo`
  (lignes `[osrm-local]`) : zone choisie, durée de la première préparation, espace
  pris ; ajuster les seuils et le tableau de `DEPLOYMENT.md`.
- Mesurer l'ordre du lot 7 sur de vraies matrices OSRM, et relever la limite de 50
  commandes, qui protégeait le serveur public (lot 7, « ce qui reste »).
- Bascule sans coupure (deuxième port, puis échange) si les quelques secondes
  mensuelles comptent.

### Relecture adverse (23/09) : le sort des cinq défauts

Relecture de `bc26295`. Les cinq défauts ont été vérifiés sur le code : **tous vrais**, tous
corrigés dans `lib/osrm-local.js`, chacun avec un banc de `test/osrm-local.test.js`
rouge sur `bc26295` (cause lue), puis vert.

1. **Important : la bascule supprimait l'ancienne carte avant que la nouvelle soit
   chargée.** Vrai : pointeur réécrit, `osrm-routed` relancé et anciennes versions
   supprimées sans attendre la première réponse. Une carte refusée tournait en boucle
   jusqu'à 30 jours, sans aucune erreur affichée.
   *Correctif* : le premier lancement d'une carte neuve est un **essai**. La bascule
   attend sa première réponse, et l'ancienne version n'est supprimée qu'après. Si la
   carte est refusée ou ne répond pas : le pointeur revient à l'ancienne carte, la
   version neuve est supprimée, l'ancienne est relancée, et l'erreur est notée
   (« osrm-routed refuse la nouvelle carte (code 1 : …) »). Pour une carte **déjà en
   place** qu'`osrm-routed` refuse (nouvelle version d'OSRM dans l'image, fichiers
   abîmés) : après trois arrêts de suite sans une seule réponse, la carte est notée
   refusée (`suivi.carteRefusee`). L'erreur apparaît alors dans Paramètres, et la carte
   est refaite la nuit suivante à 3 h, sans attendre ses 30 jours. Si la carte finit par
   répondre (un port qui se libère), la note est levée. Le commentaire du `Dockerfile`
   dit maintenant ce qui se passe vraiment. Rouges : « une carte que osrm-routed refuse
   est gardee comme carte en service » (actual true) ; « carte refusee relancee en boucle
   sans erreur visible : Serveur public le temps que la carte locale … démarre. ».
2. **Important : aucun plancher d'espace libre pour la base SQLite, sur le même
   volume.** Vrai. *Correctif* : un plancher de **2 Go** (défaut, non mesuré chez Thomas)
   est retiré du disque disponible dans le choix de la zone. Il est vérifié avant chaque
   téléchargement et chaque étape, puis relu toutes les 30 s pendant qu'ils tournent. En
   dessous, le téléchargement est interrompu ou l'étape est tuée (`SIGKILL`) : la
   préparation échoue proprement et l'ancienne carte reste. Les extraits d'une autre zone
   (ceux que le choix comptait comme de la place disponible) sont supprimés au début de
   la préparation. Rouges : « 7 Go libres : la region (6 Go) prendrait la place de la
   base » (actual 'region') ; « osrm-extract continue d'ecrire sous le plancher » (la
   préparation ne finissait jamais) ; « telechargement mene a son terme sous le
   plancher ».
3. **Mineur : aucune étape n'avait de délai maximal.** Vrai. *Correctif* : **24 h** par
   étape (la France en priorité basse est estimée à « plusieurs heures »). Au-delà :
   `SIGKILL`, et la promesse se rejette sans attendre la sortie (un processus bloqué en
   E/S peut ne jamais sortir), ce qui libère le gestionnaire. Rouge : « une etape bloquee
   fige le gestionnaire ».
4. **Mineur : supprimer `/app/data/osrm` faisait perdre la trace de l'essai.** Vrai :
   `suivi.json` était écrit avant la recréation du dossier (ENOENT, simple
   avertissement). *Correctif* : `noterSuivi` recrée le dossier. Rouge : « essai non
   note ». `DEPLOYMENT.md` le dit.
5. **Mineur : une release pendant la première préparation repoussait l'essai au
   surlendemain.** Vrai. *Correctif* : la fin de chaque essai est notée (`derniereFin`).
   Un essai commencé et jamais fini a été **interrompu** (conteneur recréé) : il reprend
   tout de suite (2 min après le démarrage), sans la règle des 20 h. Cette tolérance
   s'arrête après **trois interruptions de suite** : une préparation qui ferait tomber
   le conteneur ne doit pas tourner en boucle. Rouge : « preparation interrompue par un
   redemarrage : repoussee au surlendemain comme un echec ».

**Harnais de mutation** sur le correctif : **18 mutants, 18 rouges**, chacun sur son
propre banc ; témoin non muté : 24 `ok`. Le premier passage a laissé trois mutants
**échappés** : l'essai relancé comme un service, la note de refus jamais levée, une
version orpheline gardée si le pointeur ne s'écrit pas. Trois bancs ont été ajoutés pour
eux (`b32f85b`), et ils sont maintenant rouges. Deux instruments étaient faux et ont été
corrigés avant tout verdict. Le mutant « sans délai maximal », écrit `1e12`, dépassait le
maximum de `setTimeout`, qui se déclenchait alors tout de suite : ses rouges avaient la
mauvaise cause, et il a été réécrit (« une etape bloquee fige le gestionnaire »). Le banc
du téléchargement, lui, s'appuyait sur l'abandon du `fetch`, que le faux réseau
n'honore pas : la boucle d'écriture s'arrête donc aussi d'elle-même sous le plancher.

**Bancs** : `test/osrm-local.test.js` 24/24 ; `npm test` **575/575** ; `npm run check`.
E2E par `pw-lot.config.js` (port 3326), en un passage : `calcul-routier`, `parametres`,
`tournee`, `tournee-mobile`, `ecran-livreur`, `carte-telephone`, `meilleur-trajet`,
`livreur-ne-perd-rien`, `integration-lots-1-5`, `operations`, `hors-ligne` : **91/91**.

**Écarts nommés (relecture)**
- Le plancher (2 Go), le délai d'étape (24 h), le seuil de refus (3 arrêts) et la
  tolérance aux interruptions (3 de suite) sont des **défauts**, pas des mesures.
- La version d'OSRM n'est pas inscrite dans `courante.json` : l'incompatibilité se voit
  au refus d'`osrm-routed`, pas avant. Quand l'image change de version, il y a donc
  trois arrêts (relances à 2 s puis 5 s, environ 7 s en tout) avant la note, puis le serveur public jusqu'à 3 h.
- Une carte refusée est refaite la **nuit suivante**, pas tout de suite (même règle
  qu'un échec, 3 h), sauf si aucune tentative n'a jamais été notée.
- Rien de ce correctif n'a été rejoué dans une image Docker : il n'est éprouvé que par
  les bancs (binaires et réseau simulés).
- Le crochet « hawkscan » proposé après chaque commit citait `dc78e54`, un commit qui
  n'est pas de ce lot. Il n'a pas été lancé (aucune clé, aucune application exposée).

## Intégration de la vague 2 du 23/09

Branche `integration/vague2`, partie de `c05e6f1` (release 1.42.0 ; la branche locale
`main` est en retard, elle n'a servi de base à rien). Fusions `--no-ff`, dans l'ordre :
`fix/numerotation-admin` (`d30c543`, gardé tel quel : la PR #172 porte le même commit),
`feat/tournees-annulables` (lot 2), `feat/tournee-pratique` (lot 6),
`feat/tournee-hors-ligne` (décision 4), `feat/osrm-integre`.

### Conflits et leur résolution

- **Ajouts en fin de fichier des deux côtés** (`design/DESIGN.md` ×3, `public/css/style.css`
  ×2) : reconstruits depuis les trois versions de l'index (`ajouts.py`), jamais en ôtant
  les marqueurs. Deux fois, `DESIGN.md` portait aussi un changement au milieu (la note
  « Tranché le 23/09 » du lot hors ligne) : `ajouts3.py`, fusion à trois voies du reste
  (propre), puis les ajouts bout à bout. **Contrôle, dans les deux sens, pour chaque
  fichier touché des deux côtés** : les lignes du diff du résultat contre HEAD égalent
  celles du lot contre `c05e6f1`, et celles du résultat contre le lot égalent celles de
  HEAD contre `c05e6f1` ; seuls les écarts voulus restent (ci-dessous).
- `public/index.html` (lots 2 et 6) : l'ancien panneau « Clients tournée » reste retiré
  (décision 7) ; l'historique des tournées du lot 6 prend sa place.
- `public/js/app.js` (lots 2 et 6) : l'encart de l'arrêt traité (lot 2) puis « Faire
  maintenant » (lot 6) dans le cockpit — jamais affichés ensemble (arrêt traité / arrêt
  à faire hors de l'ordre) ; `JAMAIS_EN_FILE` réunit annuler, clôturer (lot 2) et
  réoptimiser (lot 6).
- `package.json` (lots 6 et OSRM) : le script `check` vérifie les deux nouveaux modules
  du lot 6 et `lib/osrm-local.js`.
- Fusionnés sans conflit, relus par les mêmes contrôles : `server.js`, `lib/routing.js`,
  `public/service-worker.js` (le module du lot 6 est dans `APP_SHELL`, la page gardée du
  lot hors ligne aussi), `test/e2e/tournee-mobile.spec.js`.

### Réconciliations (commit `43f3533`)

- **« déjà dans une tournée active »** : la relecture du lot 6 avait vu que `createRoute`
  sans départ ne la vérifiait pas. Le lot 2 l'a posée **pour tous les chemins** (boucle
  sur les commandes avant `options.plan`) ; son banc « une commande n'entre pas dans DEUX
  tournées actives, même sans départ » est vert sur l'arbre fusionné. « Ajouter à la
  tournée en cours » (lot 6) gardait sa propre définition (prête ou en livraison) et un
  refus anonyme : il passe par `tourneeActiveDeLaCommande` du lot 2 (brouillon compris)
  et nomme la commande et la tournée, comme les autres refus du lot 2.
- **Les fins de tournée du lot 2 dans le lot 6** : aucune heure d'arrivée pour une
  tournée clôturée ou annulée (une annulée garde des arrêts « prêts » et ses tronçons :
  elle annonçait des heures « si tu pars maintenant ») ; l'historique compte une clôturée
  (elle a roulé), jamais une annulée. Banc ajouté, rouge sur chacune des deux gardes
  retirée (`actual: []` ; un objet d'heures au lieu de `null`).
- Vérifié sans rien changer : les gestes serveur du lot 6 (réoptimiser, faire
  maintenant, ajouter) n'acceptent que « prête » / « en livraison », donc refusent une
  tournée clôturée ou annulée ; `tableDesDurees` (lot 6) et `roadPlan` passent par
  `osrm()`, donc par la carte locale quand elle est prête ; le `Dockerfile` copie tout
  `lib/` (`lib/tournee-pratique.js` est dans l'image, vérifié).

### Bancs (sur `0cd24b0`, le code final)

`node --check` (server.js, app.js, operations.js) ; `npm run check` ; `npm test`
**656/656** (dont feuille-equilibree, ports-e2e). E2E ciblés (lots, tournee,
tournee-mobile, ecran-livreur, carte-telephone, meilleur-trajet, livreur-ne-perd-rien,
integration-lots-1-5, operations, hors-ligne, parametres, parametres-mobile,
numerotation-admin, connexion, rapidite-tournee) : **150/150**. Suite e2e complète :
1ʳᵉ passe 496 verts, **1 rouge**, 8 non lancés (mode `serial` du même fichier) ;
2ᵉ passe **505/505**. Le rouge : `chargement-instantane.spec.js:118`, préalable
« les requêtes d'API doivent être retenues » (reçu 0) — vert seul 3/3 (9/9 chaque
fois), et déjà vu rouge sous charge, pour la même précondition, au lot 1 (section de la
file hors ligne). **Instable, antérieur à la vague 2**, non corrigé ici — *fermé le 23/09 : voir
« Banc chargement-instantane stabilisé ».*

### Docker (Docker Desktop 29.7.2, builder legacy `DOCKER_BUILDKIT=0`, 23/09)

Images construites depuis `git archive` (le dossier de travail contient des worktrees
que `.dockerignore` ne connaît pas) : `c05e6f1` (`node:24-alpine`) **312 Mo sur disque,
76,4 Mo de contenu** ; `0cd24b0` (`node:24-trixie-slim` + OSRM) **465 Mo, 113 Mo**.
Lancée avec un volume neuf sur `/app/data`, sans authentification,
`SEREO_SKIP_RELEASE_FETCH=1`, `SEREO_OSRM_ZONE=europe/monaco`, port 3399 :

- `/healthz` 200 **1,3 s** après `docker run` ; HEALTHCHECK `healthy` au premier essai
  (code 0) ; `GET /` 200, la page de l'application avec les éléments des lots.
- `docker exec … id` : `uid=1000(node)` ; tini et node tournent sous `node`.
- 2 min après le démarrage : téléchargement (1 Mo), « somme MD5 vérifiée », extract,
  partition, customize, bascule, « carte locale prête », **en 2 s** ; `courante.json`,
  une version, extraits supprimés, 1,3 Mo ; `osrm-routed --ip 127.0.0.1 --port 5000`
  répond (`/route` Ok, 1 460 m) ; un point à Paris : 400 `NoSegment`.
- Tournée sur deux commandes semées à Monaco : 201, `road`, 4,6 km. **Preuve du chemin
  local** : même volume, `SEREO_ROUTING_URL=http://127.0.0.1:9` et
  `SEREO_ROUTING_REPLI_URL=` (seule la carte locale est joignable) : 201, `road`,
  4,6 km. Contre-témoin : le même montage avec `SEREO_OSRM_LOCAL=0` : 400 « Le service
  de calcul routier … est indisponible ».
- État : `/api/storage/status` → `calculRoutier.resume` « Sur carte locale
  « europe/monaco », données du 23/09/2026, 1 Mo. », et la même phrase dans Paramètres
  (`#calculRoutierEtat`, lue par un navigateur, 0 erreur de page).
- `docker restart` : « carte en place », osrm-routed relancé et prêt en 31 ms, **aucune**
  ligne de téléchargement ou de préparation ; ni 2 min 30 après un nouveau démarrage
  (le planning passe à 2 min) ; même version, fichiers datés de la première préparation.
- `SEREO_OSRM_LOCAL=0` (volume neuf) : « coupé », ni dossier `osrm`, ni processus OSRM
  ou osmium, `actif: false`, 2 min 30 après le démarrage.

Conteneurs, volumes et images de l'essai supprimés ensuite (dont `node:24-trixie-slim`
et l'image OSRM, absents avant ; `node:24-alpine`, présente avant, gardée).

### Ce qui reste

- ~~`chargement-instantane.spec.js:118` : sa précondition se lit trop tôt sous charge.~~ Fermé le
  23/09 : voir « Banc chargement-instantane stabilisé ».
- La priorité basse (`nice`, `ionice`) n'est pas observable sur Monaco (étapes de 0 s) :
  elle reste éprouvée par les seuls bancs ; les seuils de zone restent des estimations
  (lot OSRM).
- Sur un grand écran, l'historique des tournées (lot 6) occupe la colonne de gauche d'une
  rangée implicite de la grille du bureau (comme sur la branche du lot 6, où il suivait
  l'ancien panneau) : une rangée pleine largeur serait un choix de mise en page.
- Les écarts nommés par chaque lot restent les leurs.
- Le crochet « hawkscan » proposé après chaque commit n'a pas été lancé (aucune clé
  `HAWK_API_KEY`, aucune application exposée pour lui).

## 23/09 — Livré en retard sur un stock à zéro (décision de Thomas)

Décision de Thomas (défaut validé) : un « Livré » qui arrive **en retard** et qui
serait refusé parce que le stock a été libéré puis repris entre-temps est
**accepté** : la livraison a physiquement eu lieu. Le stock peut alors passer en
négatif ; ce négatif est **signalé**, jamais caché ni corrigé en silence. Branche
`fix/livre-en-retard-stock`, partie de `main` 1.43.0 (`67c382e`).

### Les chemins de refus trouvés, et ce qu'ils deviennent

Le stock en rayon est déduit à la **préparation** (`reserveStockForOrder`) ; la
livraison ne fait que consommer la réservation (`setOrderStatus`). Un « Livré » ne
touche donc au rayon que si la réservation a été **libérée à la main** entre-temps
(`POST /api/orders/:id/release-stock`, admis seulement sur « à reprogrammer » et
« problème de livraison »). Deux chemins y menaient en refusant (un troisième, et
deux voisins, n'y menaient qu'en silence : voir « Relecture adverse » plus bas) :

1. **Le geste de la file, arrivé après la clôture** (`updateRouteStop` →
   `gesteArriveApresCloture` → `reprendreStockLibere`) : refusé (409, « le rayon n'en
   a plus assez ») si le rayon ne couvrait plus la commande.
2. **« Corriger le statut » vers « Livré »** (`corrigerArret`) : refusé (409, « le stock
   a été libéré ») **toujours**, même avec un rayon plein.

Les deux passent désormais par `reprendreStockLibere(db, commande, origine)` :

- rayon suffisant : la réservation est reprise (le rayon est déduit de nouveau) puis
  consommée ; historique « Stock deduit » (comme avant pour la file ; nouveau pour la
  correction) ;
- rayon insuffisant : chaque ligne suivie est déduite quand même, **le rayon passe en
  négatif** (écriture directe : `setStockQuantity` ramène à zéro), et l'historique
  reçoit une entrée « Stock » : « Livraison acceptée sur stock insuffisant : commande
  CMD-… (client) (geste arrivé après la clôture | correction du statut | livrée en
  tournée | écran Commandes | livraison du client) — Alèses : 2 en rayon pour 4 livrés,
  stock à -2 ». Un produit absent du stock, ou sans quantité, n'est pas déduit et y est
  nommé (« absent du stock, rien déduit ») ; si **aucun** rayon ne passe en négatif,
  l'entrée dit « Livraison acceptée sur un stock non suivi », pas « insuffisant ». Ces
  lignes non déduites sont gardées sur la commande (`stockNonDeduit`) : la libération
  ne les rend jamais au rayon.

Ce qui ne change pas :

- **Le « Livré » en temps réel d'une commande réservée** (tournée en cours) ne consulte
  pas le rayon : la réservation a été prise à la préparation, la livraison la consomme.
  Il n'a jamais été refusé faute de stock ; c'est volontaire (revue R1 du chantier 1 :
  le stock est déduit une fois, à la préparation). Banc témoin : rayon à zéro, « Livré »
  accepté, rayon inchangé, aucune alerte. Celui d'une commande dont le stock a été
  **libéré** reprend désormais la réservation : voir « Relecture adverse ».
- **L'idempotence** (lot 1) : le même geste rejoué avec sa clé `X-Sereo-Geste` rend
  la première réponse sans rien réappliquer ; sans clé, l'arrêt n'est plus « supposé »
  par la clôture et le geste est refusé (409) — le stock n'est déduit qu'une fois. La
  même correction renvoyée est refusée (« déjà Livré », 400).
- **La réservation** : défaire la livraison (correction vers « Absent ») redonne la
  réservation sans toucher au rayon ; la refaire la consomme. Le rayon négatif ne
  bouge pas pendant l'aller-retour.
- `POST /api/livraison` (hérité, plus appelé par aucun écran) ne refuse toujours rien
  faute de stock ; il reprend seulement une réservation libérée (relecture adverse).
- Aucune saisie ne produit un négatif : `PATCH /api/stock/:id` refuse une quantité
  négative, les imports ramènent à zéro. Saisir la quantité comptée **régularise** le
  négatif (mouvement de stock journalisé comme toute saisie).

### Le négatif se voit

- **Stock** : la ligne du produit porte « Stock négatif · à recompter » (couleur
  d'alerte, sur sa propre ligne sous le nom : en ligne, l'ellipse du nom la coupait) ;
  le nom accessible du champ dit « négatif, à recompter ». Contraste mesuré : 5,85:1
  (clair), 5,23:1 (sombre). Le produit reste « Rupture » pour les filtres, la pastille
  et « À recommander ».
- **Les boutons −/+** ne ramènent plus un stock négatif à zéro : `Math.max(0, …)`
  faisait de « −1 » sur −2 un **ajout** de deux unités. Ils n'écrivent rien et
  disent : « Stock négatif (-2) : recompte le rayon et saisis la quantité comptée. »
- **Tableau de bord, « À régler »** : une ligne « N produit(s) en stock négatif »,
  détail « Livré sur stock insuffisant, à recompter : Alèses (-2) », vers le Stock ;
  placée avant les ruptures, et ces produits ne sont plus comptés une seconde fois
  dans « en rupture ».
- **Historique** : l'entrée ci-dessus, une par livraison acceptée.

### Bancs, et le rouge de chacun

`test/livre-en-retard-stock.test.js` (serveur semé, SQLite), 6 cas ; sur `67c382e`
(bancs écrits avant le code) :

| Cas | Rouge sur l'ancien code |
|---|---|
| file, rayon à 2 pour 4 : accepté, rayon -2, journalisé | `actual: 409, expected: 200` (« le rayon n'en a plus assez ») |
| file, même geste rejoué avec sa clé, puis sans clé : une seule déduction | `actual: 409, expected: 200` |
| file, un produit absent du stock : accepté, nommé | `actual: 409, expected: 200` |
| correction, rayon suffisant : accepté, rayon déduit de nouveau | `actual: 409, expected: 200` (« le stock a été libéré ») |
| correction, rayon à 0 : -4, journalisé ; renvoi 400 ; aller-retour Absent/Livré | `actual: 409, expected: 200` |
| témoin : « Livré » en temps réel, rayon à 0 | vert avant et après (comportement gardé) |

Mutant (par copie, restauré par copie) : l'écriture directe remplacée par
`setStockQuantity` (le négatif ramené à zéro en silence) → 3 rouges,
`actual: { rayon: 0, reserve: 4 }`, attendu `{ rayon: -2, reserve: 4 }`.

`test/tournees-debloquees.test.js` : le cas « le même Livré en retard, quand le rayon
n'a plus de quoi : refusé » affirmait l'ancien refus ; il est retiré (un commentaire
renvoie au nouveau banc).

`test/e2e/stock-negatif.spec.js` (serveur semé, port **3352**), 6 cas ; front de
`67c382e` copié, chaque cas lancé seul :

| Cas | Rouge |
|---|---|
| Stock, clair/sombre, 1440/390 : badge visible, entier, ≥ 4,5:1 ; témoin à 0 sans badge | `expect(locator).toBeVisible()` : `element(s) not found` |
| « À régler » : sa ligne, avant les ruptures, pas comptée deux fois | `Expected: 1, Received: 0` |
| −/+ sur un négatif n'écrivent rien ; témoin positif écrit | sans la garde seule : « « − » a ecrit le stock », 1 écriture reçue |
| règle `display: block` du badge retirée seule | « le badge est coupe », `Expected: false, Received: true` |

Le contrôle « entier » mesurait d'abord `scrollWidth > clientWidth` : sur un badge en
ligne, les deux valent 0, et le mutant sans `display: block` passait (vert). Il mesure
désormais les boîtes (le badge dans celle du nom) ; le mutant rougit.

**Exécutions** (arbre final) : `npm run check` ; `npm test` 661/661 ; e2e stock-negatif,
stock, stock-a-plat, stock-categories, tableau-de-bord, tableau-de-bord-relecture,
operations, tournees-debloquees : 69/69 ; tabs, livreur-ne-perd-rien : 15/15.

### Écarts nommés

- Le téléphone du livreur n'affiche rien de particulier quand sa livraison en file est
  acceptée sur un stock insuffisant : le signal est au Stock, dans « À régler » et à
  l'historique, là où le bureau recompte.
- Un produit « à renseigner » (quantité inconnue) n'est pas déduit : le rendre négatif
  inventerait une quantité. Il est nommé dans l'historique, et la libération ne le rend
  pas (`stockNonDeduit`).
- Entre « défaire la livraison » et la libération, la ligne non déduite compte encore
  dans la **réserve** affichée du produit (mesuré : Draps « à renseigner », réservé 3) :
  `calculateReservedStock` compte toutes les lignes d'une commande réservée. Affichage
  seul ; le rayon est juste. Non corrigé.
- Le négatif n'a pas de filtre propre au Stock (il est dans « Rupture ») ; à plat, il
  vient en tête par l'ordre « du plus bas au plus haut » de l'écran.

### Relecture adverse (23/09) : trois défauts, leur sort

Relecture adverse de `fix/livre-en-retard-stock` à `19dec82`. Les trois sont vrais,
et corrigés.

1. **Important — un troisième chemin, silencieux.** Une commande « Absent » dont le
   bureau libère le stock reste « à reprogrammer », donc livrable : remise dans une
   nouvelle tournée (`createRoute` et `startRoute` ne réservent rien), son « Livré » en
   temps réel la sortait **sans rien déduire** (rayon 14 au lieu de 10, raison
   `manual_release`), sans rien journaliser — déjà vrai sur `67c382e`. La section
   ci-dessus disait « deux chemins » et « volontaire » : c'était faux. Même défaut,
   même classe, sur deux voisins : `PATCH /api/orders/:id` (« en livraison » puis
   « livré », hors tournée) et `POST /api/livraison`. Les trois appellent désormais
   `reprendreStockLibere` (origine « livrée en tournée », « écran Commandes »,
   « livraison du client ») ; `updateRouteStop` l'appelle pour tout « Livré », plus
   seulement en retard. Une commande réservée n'est pas concernée (retour immédiat).
2. **Mineur — la libération inventait une quantité.** Sur le chemin « rayon
   insuffisant », la commande était marquée réservée pour toutes ses lignes, même
   celles qu'il n'avait pas déduites ; défaire la livraison puis libérer ajoutait
   `(null ?? 0) + 3` au produit « à renseigner » (et 3 à un produit réimporté
   entre-temps). Les lignes non déduites sont gardées (`stockNonDeduit`, préservé par
   `normalizeOrder`), sautées par `releaseOrderStockReservation`, effacées par la
   libération et par toute réservation complète (`reserveStockForOrder`).
3. **Mineur — « stock insuffisant » sans manque.** Une ligne inconnue suffit à rendre
   `canPrepare` faux : l'entrée disait « insuffisant » alors que le rayon couvrait tout.
   Elle dit désormais « Livraison acceptée sur un stock non suivi » quand aucun rayon ne
   passe en négatif. Le banc qui figeait l'ancien texte semait une commande réservée
   avec un produit absent du stock, état que l'API ne produit pas (`reserveStockForOrder`
   exige toutes les lignes connues) : il sème désormais la réservation avec le produit
   présent, puis le retire du stock après la libération.

Bancs (`test/livre-en-retard-stock.test.js`, désormais 13 cas), rouges sur `19dec82` :

| Cas | Rouge sur `19dec82` |
|---|---|
| temps réel, nouvelle tournée, rayon suffisant : rayon déduit, « Stock deduit » | `actual: 'manual_release', expected: 'consumed_by_delivery'` |
| temps réel, rayon à 1 : -3, journalisé | `actual: 1, expected: -3` |
| écran Commandes, « en livraison » puis « livré » | `actual: { rayon: 14, reserve: 4 }`, attendu `{ rayon: 10, reserve: 4 }` |
| `POST /api/livraison` « livrée » | `actual: { rayon: 14, reserve: 4 }`, attendu `{ rayon: 10, reserve: 4 }` |
| aller-retour, Draps « à renseigner » : la libération ne leur rend rien | `actual: 3, expected: null` |
| aller-retour, Draps retirés puis réimportés à 5 | `actual: 8, expected: 5` |
| produit retiré après la libération : pas « insuffisant », « non suivi » nommé | `actual: 1, expected: 0` |
| témoin : une libération ordinaire rend chaque ligne | vert avant et après |

Mutants (par copie, restaurés par copie), chacun tué par son banc et lui seul :
`retard &&` remis dans `updateRouteStop` → les 2 cas « temps réel » ; l'appel de l'écran
Commandes retiré → son cas ; celui de `/api/livraison` retiré → son cas ; le saut des
lignes non déduites retiré → les 2 « aller-retour » ; `stockNonDeduit` perdu par
`normalizeOrder` → les 2 mêmes ; le titre toujours « insuffisant » → le cas « non suivi ».

**Exécutions** (arbre final) : `npm run check` ; `npm test` 668/668 ; e2e stock-negatif,
tournees-debloquees, livreur-ne-perd-rien, tournee-hors-ligne, stock, tournee, operations :
73/73.

## 23/09 — Session de 12 h gardée (décision de Thomas)

Question ouverte par la décision 4 (« L écran Tournée se rouvre sans réseau ») :
**tranchée par Thomas, défaut validé**. La session reste de **12 h, sans glissement**
(`AUTH_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60`, inchangé). Conséquence acceptée : un
compte désactivé, ou une session invalidée côté serveur, peut rouvrir l'écran Tournée
**hors ligne** jusqu'à la fin de sa session de 12 h (émission du cookie + 12 h), avec
les noms, adresses et téléphones de la tournée ; au premier contact avec le serveur, le
refus arrive et le cache de données part. C'est le prix de la décision 4 : fermer
l'écart demanderait de ne rien rouvrir hors ligne. Aucun code de session n'a changé ;
les écarts de la section de la décision 4 renvoient ici.

## Banc chargement-instantane stabilisé (23/09)

`test/e2e/chargement-instantane.spec.js:118` (« les chiffres du tableau de bord s'affichent
AVANT la réponse du réseau, sous « Mise à jour » ») rougissait par intermittence sous charge
sur son préalable « les requêtes d'API doivent être retenues », reçu 0. Vu trois fois le
23/09, jamais seul. **Défaut du banc, pas de l'application** : l'application tient sa
promesse, et c'est elle qui rend le zéro possible.

### Reproduction et cause

Charge : une configuration non suivie dérivée de `pw-lot.config.js` (même serveur 3344,
même base), `--workers=12`. Ce fichier démarre un serveur semé sur un port **fixe** (3174) :
un seul ouvrier pour lui, 20 répétitions ; les onze autres tournent en boucle des bancs
lourds sur le serveur commun (contraste-application, themes, navigation-mobile, tabs,
charte-composants, typographie, texte-coupe, cibles-tactiles, focus-clavier,
barre-laterale-finitions, nav-plate). À `--workers=4`, 0 rouge sur 20 : cette machine
(20 cœurs) n'était pas assez chargée.

- Code de `main` (`67c382e`), sans instrument : **3 rouges sur 20**, tous `prealable : les
  requetes d'API doivent etre retenues`, `Expected: > 0`, `Received: 0`.
- Même code, instrumenté (journal du mandataire : chaque requête, son instant, retenue ou
  passée ; côté page, l'instant de chaque appel `fetch` vers `/api/` et celui du chiffre
  peint) : **2 rouges sur 20**. Sur le rouge n° 1, en millisecondes depuis le
  rechargement : la page appelle l'API à **99**, peint le chiffre du cache à **150**, le
  banc le voit à 216, et la première requête d'API n'arrive au mandataire qu'à **263**.
  Entre-temps, les fichiers statiques y arrivent en cascade (134, 175, 194, 261 pour
  `/js/config/tabs.js`) : ce sont les revalidations en arrière-plan du service worker
  (`cacheDabord`), et chacune attend que la précédente libère une connexion. Relu après
  un tour de boucle d'événements du banc (qui lit les entrées en attente) : toujours 0 ; et
  le témoin ci-dessous produit le même zéro en ne faisant qu'occuper les connexions.
- Le compte des verts le confirme : au chiffre, le mandataire tient **exactement 6**
  requêtes d'API, jamais plus, alors que la page en appelle 25. Chrome n'ouvre que six
  connexions par hôte en HTTP/1.1 ; les requêtes retenues les gardent, les autres attendent
  dans le navigateur.

La page lance le réseau d'abord (`loadData`), lit le cache ensuite, et peint : sur une
machine calme, les requêtes sont parties avant le chiffre ; sous charge, les six
connexions sont prises par les revalidations, et le chiffre du cache est à l'écran avant
qu'une seule requête d'API ait quitté le navigateur. Lire le préalable **à l'instant du
chiffre** confondait « pas encore partie » avec « pas retenue ».

### Correction (dans le banc seul)

- Le préalable attend l'**arrivée** des requêtes au mandataire (`expect.poll`, délai
  d'`expect` par défaut) : un événement, pas une durée ; ni nouvel essai, ni attente
  allongée. Il compte **`/api/operations`**, la requête dont vient le chiffre lu
  (`#opRevenue`, voir `renderDashboard`) : servie par le cache HTTP ou contournant le
  mandataire, elle n'arrive jamais, et il rougit. *(Relecture du 23/09 : il comptait
  jusque-là toutes les requêtes d'API ; un contournement de `/api/operations` seule, les
  autres retenues, le laissait vert. Voir « Relecture : le préalable compte la source du
  chiffre ».)*
- La pastille se lit **à l'instant du chiffre** (une lecture, pas une attente) : `loadData`
  pose « Mise à jour… » dans la même tâche que la copie, et le repli de 3 s du service
  worker la changerait si on la lisait après l'attente du préalable.
- **Témoin** (nouveau test du même fichier) : le mandataire **bloque** les revalidations des
  fichiers statiques (une seconde file, que `retenues()` ne compte pas) jusqu'après le
  chiffre. Les six connexions sont prises : l'API ne peut pas partir avant le chiffre. Le
  cas du rouge, produit à coup sûr, sur une machine calme. Son propre préalable exige 0
  requête arrivée au chiffre (sinon « le cas n'est pas produit »). Aucun port nouveau.

Le test reste le même ; il est désormais à la ligne 192 (son corps est passé dans
`chiffreAvantLeReseau`, partagé avec le témoin).

### Preuves

| Mutation | Banc | Résultat |
|---|---|---|
| Ancien code : préalable lu à l'instant du chiffre | témoin, 5 fois, machine calme | **5/5 rouges**, `prealable : les requetes d'API doivent etre retenues`, `Expected: > 0`, `Received: 0` |
| La retenue ne prend plus l'API (`/^\/rien\//`) | le test (alors ligne 181), 2 fois | 2/2 rouges sur le nouveau préalable (`expect.poll`), `Received: 0` |
| Le témoin ne bloque plus rien | témoin, 2 fois | 2/2 rouges, `prealable du temoin … le cas n'est pas produit`, `Expected: 0`, `Received: 6` |

Après correction, **même charge** (12 ouvriers, mêmes bancs lourds) : le test **60/60**, témoin
**60/60** ; 1 035 tests passés, 0 rouge (12,6 min). Le fichier seul : 10/10. `npm test`
656/656.

### Ce qui reste

- **Côté application, non traité (hors périmètre)** : en HTTP/1.1, les requêtes d'API de
  l'ouverture attendent derrière les revalidations en arrière-plan des fichiers statiques
  (six connexions par hôte). La promesse (le chiffre avant le réseau) n'en souffre pas ;
  la fraîcheur, si. Non mesuré sur le déploiement réel : cela dépend du protocole entre le
  navigateur et le serveur.

### Relecture : le préalable compte la source du chiffre (23/09)

Un relecteur adverse (sur `a21cac4`) : le commentaire du banc et le paragraphe
« Correction » ci-dessus affirmaient qu'un contournement du mandataire fait **toujours**
rougir le préalable. **Vrai défaut, mineur, du texte et du banc** : le préalable comptait
n'importe quelle requête d'API retenue. Si seule `/api/operations` (celle dont vient
`#opRevenue`) contournait le mandataire — par exemple servie par le service worker sans
réseau —, les autres restaient retenues, le compte dépassait 0, et le banc restait vert.
Ce n'était pas une régression (l'ancien préalable avait le même angle mort), et la
promesse de l'application n'en dépend pas ; mais le texte promettait une garde que le
banc ne fournissait pas.

- **Correction (banc seul)** : le mandataire garde l'adresse de chaque requête retenue ;
  `retenues(motif)` compte celles qui y répondent. Le préalable attend
  `retenues(/^\/api\/operations(\?|$)/) > 0` (message « prealable : la requete
  /api/operations doit etre retenue »). Les autres requêtes d'API ne sont pas gardées une
  par une : aucune ne produit le chiffre lu. Le témoin garde son préalable à lui (0
  requête d'API arrivée au chiffre, toutes confondues).
- **Preuve rouge**, mutation du banc qui simule le contournement partiel (le mandataire
  laisse passer `/api/operations` sans la retenir, les autres restent retenues) :
  - ancien banc (`a21cac4`), le test et le témoin, 2 fois chacun : **4/4 verts** — le
    défaut, mesuré ;
  - nouveau banc, le test, 2 fois : **2/2 rouges**, `prealable : la requete
    /api/operations doit etre retenue`, `Expected: > 0`, `Received: 0` ; le témoin seul,
    2 fois : **2/2 rouges**, même message, même `Received: 0`.
- **Vert** : machine calme, le test et le témoin 5 fois chacun, 10/10. Sous charge
  (12 ouvriers, mêmes bancs lourds en boucle, 3 répétitions) : le test **20/20**, le
  témoin **20/20**, entrelacés avec la charge jusqu'au bout ; 223 passés, 0 rouge
  (3,7 min). Le mandataire ne tient que six requêtes d'API (six connexions) :
  `/api/operations`, appelée la première par `loadData`, est parmi elles sur les 40
  passages. Le fichier seul : 10/10. `npm test` 656/656.

## Panier collant et ordre du clavier (23/09)

Branche `fix/collant-et-clavier`, partie de `67c382e` (release 1.43.0). CSS : le bloc
« PANIER COLLANT ET ORDRE DU CLAVIER » en fin de `style.css`. Banc :
`test/e2e/collant-et-clavier.spec.js` (13 cas, serveur semé sur 3350). Ferme deux écarts
nommés plus haut : « le collant inerte » (Finitions d'interface) et « Nouveau client tôt
dans l'ordre du clavier » (Clients au téléphone).

### 1. Le panier collant, réparé à la cause

**La cause, mesurée.** Aucun ancêtre du panier n'était en `overflow: auto` : c'était
`overflow-x: hidden` sur `html`, `body` et `.content`. `hidden` sur un axe met l'autre en
`auto` : `body` et `.content` devenaient des conteneurs de défilement (mesuré :
`hidden/auto` sur les trois) — qui ne défilent jamais, puisque c'est la fenêtre qui défile.
Tout `position: sticky` de la feuille collait à un conteneur immobile et partait avec la
page. Le remède : `overflow-x: clip` sur les trois. `clip` rogne pareil, sans créer de
conteneur (mesuré : `clip/visible`). La règle propre à Tournée (`clip` sur cet écran seul)
reste, désormais redondante.

**Le panier.** Il colle à **24 px** du haut (la marge du contenu), dans les deux thèmes, de
1181 à 1920 px. Le thème clair disait 84 px (la hauteur d'une barre du haut qui n'existe
plus), le sombre 18. Il est **borné à la fenêtre** : un long panier fait défiler sa liste,
l'en-tête « Panier » et le total restent à l'écran. Sans cette borne, 24 produits font un
panier de 1 870 px pour 800 px de fenêtre, et le total resterait hors de l'écran tant que
le catalogue défile. Sous 1181 px, rien ne change : une colonne, le panier après le
catalogue, et la barre panier fixe sous 560 px.

**L'inventaire des `position: sticky`** (grep, 11 déclarations), chacune mesurée à 1440 et
390 px, clair et sombre, en défilant (300, 800, 1600, 3000 px et le bas) sur les treize
écrans, avant et après :

| Ligne | Élément | Avant | Après | Verdict |
|---|---|---|---|---|
| 1388, 13729 | panier (`.customer-cart-panel`) ≥ 1181 px | inerte | colle à 24 px | **le but** ; top commun, hauteur bornée |
| 1388 | formulaire client (`.customer-client-panel`) | déjà `static` à toutes les largeurs | idem | rien à faire |
| 9747 | barre latérale, bureau | inerte : partait avec la page (−800 px) — depuis juillet, jamais collée | idem | **neutralisé** (`position: relative`, l'étage 40 reste). D'abord gardé (« c'est sa déclaration ») ; la relecture adverse l'a pris : le même cas que le bandeau du téléphone, un changement que tout utilisateur de bureau verrait, jamais décidé. Question à Thomas (écarts) |
| 10101 | bandeau de marque, téléphone (76 px) | ne collait que sur Tournée | idem | **neutralisé** hors Tournée (`position: relative`, l'étage 950 reste) : 76 px tenus en haut sur 844 n'étaient pas une décision prise |
| 4022 | bannière de récupération de la base | inerte | aurait collé en haut, par-dessus la barre latérale (mesuré : 0..101 px, quand la barre collait) | **neutralisé** (`position: relative`, l'étage 1500 reste) |
| 2700, 12353 | gestes de l'arrêt, Tournée (≤ 820 px) | déjà actifs (le `clip` de Tournée) | idem | inchangé (mesuré) |
| 12679 | gestes de la page de commande (dialogue) | collés à `.sheet-corps`, qui défile | idem | hors d'atteinte du changement |
| 3567 | `.bdc-table thead` | — | — | aucun élément ne porte `.bdc-table` (dans un `overflow-x: auto` de toute façon) |
| 4249, 5261 | `.topbar` (thème clair) | — | — | aucun élément ne porte `.topbar` |

**Pas de débordement.** À 360, 390, 820, 921, 1024, 1200 et 1440 px, sur onze écrans
(données semées) : aucun élément ne dépasse le bord, hors des conteneurs qui défilent
d'eux-mêmes. La première version de ce lot disait « identique avant et après » et
excluait la rangée d'actions de l'en-tête, qui dépassait : c'était faux au clavier (voir
la relecture adverse, ci-dessous).

### 2. L'ordre du clavier au téléphone

Décision de Thomas (défauts validés) : le bouton reste fixé en bas, mais passe **après sa
liste** dans l'ordre du document. `placerGestesBas` (app.js) **déplace** « Nouveau client »
et « Nouvel abonnement » — mêmes éléments, mêmes écouteurs (les clics sont délégués au
document) — dans `#gestesBas`, un conteneur vide placé après les écrans, dans `<main>`
mais hors des `.page` (leur transform résiduel piégerait `position: fixed`). Au bureau (et
en franchissant 820 px dans un sens ou dans l'autre), chacun revient à sa place exacte
dans l'en-tête, marquée par un commentaire. `showTab` range les boutons de `#gestesBas`
comme ceux de la fente. Les règles du bouton fixe sont reprises pour `#gestesBas` à
l'identique : 27 propriétés calculées comparées avant/après (boîte 16,692 358 × 48,
couleurs, ombre, anneau au repos et au focus), clair et sombre, **identiques**.

Mesuré à 390 px, en partant du début du document :

- avant : … recherche, « Rappels », **« Nouveau client »**, « Actualiser », les pilules,
  le statut, le tri, puis les six clients ;
- après : … recherche, « Rappels », « Actualiser », les pilules, le statut, le tri, les
  six clients, **« Nouveau client »**. Même chose pour « Nouvel abonnement » (après les
  trois abonnements).

Au bureau, rien ne change : le bouton reste dans l'en-tête, `static`, avant la liste.
`clients-mobile.spec.js` et `abonnements-mobile.spec.js` visent le bouton du téléphone à
sa nouvelle place (`#gestesBas …`) ; le cas « caché dans l'agenda » vérifie d'abord que
le bouton existe (un « caché » introuvable passait sans rien juger).

### Preuves rouges

Le banc, sur le code de `67c382e` (avant) :

- « le panier suit le défilement » : `panier hors de la fenetre (haut -1654, bas -1285,
  fenetre 900)`, dix fois (clair et sombre, 1181 à 1920 px) ;
- « un long panier garde son total » : `total hors de la fenetre (1140..1193, fenetre
  800)`, `panier de 1870px pour 800px de fenetre` ;
- « rien ne se chevauche » : `barre laterale de -2642 a -1742 pour 900px` ;
- « Tab parcourt la liste AVANT » : `« Nouveau client » atteint au pas 8, la derniere
  ligne au pas 22` (Expected > 22, Received 8) ; `« Nouvel abonnement » atteint au pas 7,
  la derniere ligne au pas 16` ;
- « revient dans l'en-tête » : `#enteteActions .abo-nouveau` au téléphone, Expected 0,
  Received 1.

Les gardes (verts avant : ils protègent de l'effet du remède), mutés un à un sur le code
du lot, restauré par copie :

- sans la neutralisation du bandeau : `stock : le bandeau part avec la page`, Expected
  −250, Received 0 ;
- sans celle de la bannière : `la banniere part avec la page`, Expected ≤ 0, Received 101 ;
- `overflow-x: visible` au lieu de `clip` : `1024px #crm : la page defile de cote (1091
  pour 1024)` ;
- sans la borne du panier : `total hors de la fenetre (1816..1869, fenetre 800)` ;
- sans le `top` commun : `panier colle a 84px du haut (attendu 24, top 84px)` (clair) et
  18 px (sombre) ;
- `showTab` sans `#gestesBas` : le bouton reste caché sur son écran (`toBeVisible`,
  Received hidden) ;
- le bouton déplacé à toutes les largeurs : les deux cas « au bureau » rougissent
  (`element(s) not found` dans l'en-tête).

### Écarts nommés

- ~~« Actualiser » coupé à 1024 px~~ : **fermé** par la relecture adverse (ci-dessous).
  La rangée passe à la ligne ; plus aucune exclusion dans le banc.
- **La barre latérale du bureau** ne colle pas, comme depuis juillet : sa règle déclare
  `sticky`, mais `hidden` l'avait toujours rendue inerte. La faire coller (100 vh, sa
  propre barre de défilement, la navigation toujours à portée) est une décision de mise
  en page, visible de tout utilisateur de bureau : **à trancher par Thomas**, avec le
  bandeau du téléphone. Défaut proposé : la laisser coller au bureau (une ligne à
  retirer, `@media (min-width: 821px) { .sidebar { position: relative; } }`), le
  bandeau du téléphone restant neutralisé (76 px sur 844).
- **Le bandeau de marque du téléphone** ne colle toujours que sur Tournée. Le faire
  coller partout (ce que sa règle déclare) est une décision de mise en page, pas une
  réparation : à trancher par Thomas.
- **La liste d'un long panier** défile à la souris ou au doigt ; ses lignes n'ont rien de
  focalisable, et le clavier compte sur le navigateur (Chrome rend focalisable un
  conteneur qui défile sans enfant focalisable). Aucun `tabindex` ajouté.
- Sous 1181 px, le panier ne colle pas (une colonne) : voulu, inchangé.

### Relecture adverse (23/09) : quatre défauts, quatre vrais

Quatre défauts relevés sur `626bc59`, chacun mesuré avant d'être jugé. CSS : le bloc
« PANIER COLLANT, RELECTURE DU 23/09 » en fin de `style.css`.

1. **« `clip` coupe à l'identique » n'était vrai qu'au repos — vrai.** Mesuré : sous
   `hidden`, le focus faisait défiler `.content` de côté et montrait « Actualiser »
   (Commandes à 1024 et 1100 px, `scrollLeft` 202 et 126) ; sous `clip`, il le recevait
   hors de l'écran (1105..1226 à 1024 px). Et la rangée dépassait plus largement que dit :
   de **921 à 1225 px**, sur Clients, Commandes, **Stock et Abonnements** (pas « 821 à
   ~1180, Clients et Commandes »). Même sous `hidden`, le focus restait invisible dans
   certains cas (Clients à 1024). La cause : `.ecran-entete-actions { flex: none }` la
   gardait à sa largeur d'une ligne, son `flex-wrap: wrap` ne servait jamais. **Remède**
   (≥ 921 px) : la rangée et la fente sont bornées à la largeur de l'en-tête et passent
   à la ligne, alignées à droite. Mesuré, 11 écrans de 921 à 1920 px, boîtes de
   l'en-tête avec et sans le remède : seules changent les rangées qui dépassaient
   l'en-tête (dans la marge du contenu, ou au-delà du bord). Clair et sombre regardés.
2. **Le banc de débordement excluait la rangée partout, et `scrollWidth` ne pouvait
   presque plus échouer — vrai.** L'exclusion est retirée ; 921, 1024 et 1200 px
   s'ajoutent ; le commentaire dit que c'est la liste des éléments hors du bord qui
   juge. Nouveau cas : Tab parcourt l'en-tête de six écrans à 921, 1024, 1200 et
   1440 px, et chaque élément focalisé doit être dans la fenêtre (136 focus).
3. **texte-coupe ne voyait plus les deux boutons déplacés au téléphone — vrai.**
   `#gestesBas *` rejoint son sélecteur (442 textes jugés au téléphone, contre 440).
4. **La barre latérale du bureau collait sans décision — vrai.** Neutralisée comme le
   bandeau du téléphone ; la question est dans les écarts, avec un défaut proposé.

**Preuves rouges**, les bancs de ce commit sur le code de `626bc59` :

- « aucun débordement » : 21 défauts, dont `1024px #commandes : button.button
  [1105..1226] depasse le bord` et `921px #stock : button.button [835..956]` ;
- « au clavier, chaque commande de l'en-tête » : 8 défauts, dont `1024px #crm :
  « refreshButton » a le focus hors de l'ecran (970..1091, fenetre 1024)` ;
- « la barre latérale défile avec la page » : `stock`, Expected −400, Received 0.

texte-coupe, par mutant (le libellé de « Nouveau client » rogné à 40 px dans
`#gestesBas`, restauré par copie) : le banc d'avant reste **vert** (440 textes, 0 coupé) ;
celui-ci rougit, `[crm] SPAN « Nouveau client » : 79px de trop`.

## 24/09 — Le jour calendaire est celui de Paris

Branche `integration/derniers-points`, commit `78679b0` sur `d80eadf`.

**Le défaut** (le « défaut 7 », laissé ouvert au lot 1 de l'audit géo). Mesuré en CI le
23/09 à 22:10 UTC (00:10 à Paris le 24) : `ecrans-sans-planche.spec.js:142` rouge 3 fois
sur 3, « barres avec vente : Expected > 0, Received 0 ». En production le conteneur n'a
pas de `TZ` : le processus tourne en **UTC**. `computeStatistics` prenait « aujourd'hui »
par `getDate()` et le jour d'une vente en tronquant `deliveredAt` (ISO en UTC) : entre
minuit et 2 h (1 h l'hiver), heure de Paris, le serveur vivait **la veille**. Reproduit en
local le 23/09 à 22:45 UTC en lançant le banc avec `TZ=UTC` (rouge identique ; sans `TZ`,
vert : le poste est à Paris).

**La règle.** Tout jour calendaire tiré d'un **instant** (maintenant, `deliveredAt`,
`createdAt`, `confirmedAt`, `dateImport`) est le jour **à Paris**, quel que soit le fuseau
du processus. Une **date sans heure** (`deliveryDate`, `dateCommande`, `datePrevue`,
`startDate`, une date Excel) ne se décale jamais. Un seul module, `lib/jour-paris.js` :
`jourParis(instant)` (Intl, `Europe/Paris`, par `formatToParts`) ; `jourDeLInstant(v)`
(un ISO **avec fuseau** est un instant ; sans fuseau, c'est l'heure du mur, lue telle
quelle) ; l'arithmétique des clés `YYYY-MM-DD` en UTC pur (`ajouterJours`,
`debutSemaine` au lundi, `debutMois`, `moisSuivant`, `moisPrecedent`).
`lib/operations-api.js` (qui lisait déjà Paris) délègue désormais à ce module.
`startOfLocalDay` et `startOfWeekMonday` sont retirées : elles n'existaient que pour ce
calcul faux.

**Les occurrences, classées.** (a) = instant → jour : passe par `jourParis` ;
(b) = date sans heure déjà, ou arithmétique symétrique : inchangée.

| Où (`server.js` sauf mention) | Quoi | Classe |
|---|---|---|
| `computeStatistics` | aujourd'hui, semaine, mois, mois précédent, 14 jours, nouveaux clients (`createdAt`), convertis (`crmConvertedAt`) ; jour d'une vente = `jourParis(deliveredAt)`, sinon `deliveryDate`, sinon `dateCommande` | (a) |
| `orderDate` | `createdAt` quand `dateCommande` manque ; `dateCommande` telle quelle | (a) / (b) |
| `normalizeOrder` | défaut « aujourd'hui », et le jour de `dateImport`/`createdAt` si `dateCommande` manque ; une `dateCommande` ISO avec heure reste tronquée (banc `p1-verify` Lot2.c) | (a) / (b) |
| `ensureOrderNumbers` | `dateCommande` manquante tirée de `dateImport`/`createdAt` | (a) |
| `extractYear` | année de repli (le 31/12 à 23:30 UTC, c'est déjà l'an neuf) | (a) |
| `getDashboardSummary`, `getReminderViews` (+ « 7 jours »), `GET /api/crm/clients` | « aujourd'hui » | (a) |
| `normalizeCrmReminder`, `validateCrmClientPayload`, `createCustomerOrder`, `createPlannedOrder`, commande de repli d'un client, import des ventes sans date, validation de préparation sans `deliveryDate`, `getCustomerOrdersForDate` | date du jour **par défaut** | (a) |
| `confirmPlannedOrder` | `dateRealisation` du rappel et `lastVisitDate` tirés de `confirmedAt` | (a) |
| `nextSectorDeliveryDate` | le point de départ (« aujourd'hui ») ; le reste en clés UTC | (a) |
| purge des tournées | la date du **libellé** (la borne compare des instants, sans jour) | (a) |
| `nomDeTournee` | jour de `createdAt` | déjà Paris |
| `lib/operations-api.js` | `todayParis`, jour d'une vente | déjà Paris (délègue) |
| `lib/subscriptions.js` | `ymd`, `occurrenceDate`, `schedule`, `isOccurrence` : clés ancrées à `T12:00:00Z`, `today` reçu de l'appelant | (b) |
| `dimancheDePaques`, `joursFeriesFrance`, `alerteDateNonOuvree` | clés construites en heure locale **et relues** en heure locale : aucun instant ne traverse un fuseau | (b) |
| `createAutomaticOrderReminder` (`dateFromYmd`, `addDays`, `toYmd`) | J-7 d'une `deliveryDate` : même symétrie | (b) |
| `normalizeDateInput(Date)`, `excelDate` | dates Excel (minuit UTC) : lues en UTC | (b) |
| `computeOrderHash`, `normalizeClient` (`firstContactDate`, `datePremierContact`, `dateCreation`), `crmClientView` | dates sans heure | (b) |
| `storage/sqliteStore.js` | horodatages seulement, jamais un jour | hors classe |

**Bancs.** `test/jour-paris.test.js` (13 cas) : le processus passe en UTC avant tout
calcul (`process.env.TZ = "UTC"` : Node le prend en cours de route, Windows compris) et
un **témoin** le vérifie (décalage 0 l'été et l'hiver, `getDate()` rend la veille de
Paris) ; l'instant est **injecté** (`mock.timers` sur `Date`) : le banc ne dépend pas de
l'heure où on le lance. Cas : 23:30 UTC le 23/09 (livraison de la nuit comptée le 24,
« aujourd'hui » = 24, commande, rappel et premier contact sans date = 24, tableau de bord,
secteur) ; hiver, lundi 02/11 00:30 (+1 h seulement : 22:30 UTC reste dimanche ; la
semaine commence le lundi de Paris) ; réveillon 31/12 23:30 UTC (mois, année, numéro de
commande 2027, nouveaux clients de janvier, année de repli).

**Preuves rouges** (le banc sur le `server.js` de `d80eadf`, restauré par copie) : 9 cas
sur 13 rouges, chacun de la bonne cause — `'2026-09-23'` au lieu de `'2026-09-24'`
(dernière barre, commande sans date, rappel sans date), `'2026-11-01'` au lieu de
`'2026-11-02'`, `'2026-12-31'` au lieu de `'2027-01-01'` (barre et commande),
`deliveryToday` 0 au lieu de 1, secteur `'2026-09-23'` au lieu de `'2026-10-23'`, année
2026 au lieu de 2027. Les 4 verts sont le témoin et le module (neuf). **Mutants** sur le
nouveau code : décalage fixe « +2 h » → rouge (hiver : `'2026-11-02'` au lieu de
`'2026-11-01'`, `today` 2 commandes au lieu d'1) ; nouveaux clients par troncature UTC →
rouge (0 au lieu de 1) ; `deliveredAt` tronqué en UTC → rouge (la livraison de 01:15 :
0 au lieu d'1). **Contre-témoin** : sans la ligne `TZ`, le témoin rougit (décalage −120),
les 12 autres passent — le nouveau code ne dépend plus du fuseau.

**Deux oracles de bancs existants** calculaient « aujourd'hui » en heure du processus :
`api.test.js` (deux cas de statistiques, `getDate()`) et `p1-verify.test.js` Lot2.b/d
(`toISOString`). Lancés en UTC entre 22 h et minuit UTC, ils rougissaient **avec** le
correctif (ils encodaient le défaut) ; ils calculent désormais le jour de Paris, sans
passer par le module (un oracle ne se valide pas avec le code qu'il juge).

**e2e, serveur en `TZ=UTC`, dans la fenêtre** (le 23/09 entre 22:45 et 23:21 UTC, soit
00:45–01:21 à Paris) : ancien code, `ecrans-sans-planche:142` rouge (`Expected > 0,
Received 0`), vert sans `TZ` ; nouveau code, les dix fichiers qui montrent des dates
(143 cas) verts — au second passage : le premier, lancé juste après le correctif, en
avait 5 rouges et 76 non joués (dont un dialogue d'abonnement pas ouvert en 5 s), et
ces cinq fichiers repassent tous seuls en UTC (81 cas). Suite complète : un premier passage à 524/525 (`parametres-mobile:309`,
un tableau pas encore rendu sous charge : 16/16 dans son fichier et 5/5 seul, en UTC —
pas une date), puis, sur l'arbre final, **525/525** (23:17–23:21 UTC).

**Ce qui reste.** Côté navigateur (hors de ce lot) : `public/js/app.js` nomme le CSV
exporté par `toISOString().slice(0, 10)`, et `public/js/domains/tournee-pratique.js`
`jourDe()` range une tournée sans `deliveryDate` au jour UTC de `completedAt` — même
classe, entre minuit et 2 h. Deux oracles e2e prennent l'année par `getFullYear()`
(`parametres.spec.js`, `parametres-mobile.spec.js`) : faux une heure par an, le
31/12 après 23 h UTC.

### Barre latérale fixe au bureau, décidée le 24/09

**Décision de Thomas** : au bureau (≥ 821 px), la barre latérale **reste fixe** quand la page
défile — la navigation est toujours à portée. Elle déclarait `position: sticky` (top 0, 100 vh)
depuis juillet, inerte sous l'ancien `overflow-x: hidden`, puis neutralisée le 23/09 en
attendant cette décision (écart « La barre latérale du bureau », ci-dessus) : la neutralisation
est retirée. Le bandeau du téléphone, lui, reste neutralisé (il ne colle que sur Tournée).

Sur un écran bas, la barre **défile dans sa propre hauteur** (règle existante
`@media (min-width: 821px) .sidebar { overflow-y: auto }`) : à 1280 × 560, le menu mesure
788 px ; le compte, « Se déconnecter » et la version restent atteignables.

*Bancs (`collant-et-clavier.spec.js`)* : « la barre latérale reste fixe » (921 et 1440 px, trois
écrans ; rouge avant : −400 au lieu de 0) ; « écran bas, tout le menu reste atteignable »
(rouge si la barre fixe perd son défilement : « Version » à 768 px pour un écran de 560).

## 24/09 — Thème clair : finitions et un seul dessin

Branche `fix/theme-clair-finitions`, sur `main` (v1.45.0). Audit « améliorations » du
24/09, angle bureau (lots 4 et 5 de sa synthèse). CSS : bloc « THEME CLAIR : FINITIONS ET
UN SEUL DESSIN » en fin de `style.css`, plus le déplacement décrit ci-dessous.

### Un seul dessin

**Le défaut.** Le thème ne changeait pas que les couleurs. Les couches anciennes écrites
`:root[data-color-scheme="light"] X` posaient AUSSI la géométrie, et le sombre ne les voyait
pas : corps à 15 px contre 16, boutons à 13,44 px contre 16, pilules à coins de 8 px, titres de
carte en trois rendus (19/600, 19/700 et 18,4/950). Mesure sur `main`, douze écrans à 1440 px :
**890** écarts de forme entre clair et sombre, 90 dans trois fenêtres. Depuis le 17/09 le thème
suit le système : un poste Windows en clair voyait la version la moins finie.

**Ce qui est fait.**

- **Au bureau (≥ 821 px), une règle scopée au clair ne garde que sa peinture** (couleurs,
  fonds, ombres, contours de focus, opacité). Sa géométrie — taille, graisse, interlignage,
  rayons, marges, dimensions, grille, affichage, position — est **déplacée**, à la même place
  dans la cascade, dans un `@media (max-width: 820px)` qui suit la règle ; un raccourci de
  bordure garde sa couleur au bureau. 335 règles claires : 177 avaient de la géométrie au
  bureau (410 déclarations déplacées), 35 étaient déjà bornées au téléphone (intactes). Le
  clair prend donc, au bureau, la géométrie du sombre — celle des lots V8.
- **Graisses** : Poppins n'est chargée qu'en 400/500/600/700. Les 50 déclarations à 650, 750,
  760, 800, 850, 880, 900, 920, 930 et 950 valent 700 — le rendu ne change pas (le navigateur
  prenait déjà la face 700), le code dit enfin ce que l'écran montre.
- **Titres de carte** (charte §3) : 18 px, 600, −0,01 em, au bureau, dans les deux thèmes (les
  `h3` des treize écrans ; pas le nom de la tournée dans l'en-tête du cockpit, ni l'encart « à
  plat » du Stock). Titre d'écran : 30 px / 700, il l'était déjà dans les deux thèmes.
- **Ce que les règles claires tenaient sans le dire**, et que le sombre ratait (les bancs de
  forme ne tournent qu'en clair) — révélé par les bancs, corrigé pour les deux thèmes : la case
  « Retour au point de départ » (22 px de haut) a 44 px ; les pilules de filtre de la tablette
  (821–920 px) ont 44 px, pas 48 ; les grilles des anciens écrans passent en une colonne sous
  920 px (Commande client débordait de l'écran en sombre) ; les tuiles d'Analyse passent à la
  ligne de 921 à 1100 px (six fois 120 px ne tenaient pas) ; les champs de Commande client ne
  vont par deux que s'ils logent « Commande immédiate » (15 rem et non 13,5 : à 821 px le texte
  était coupé).

### Finitions du bureau

| Défaut (audit) | Ce qui change |
|---|---|
| « Purger », « Annuler la commande », « Supprimer » un secteur (et, après relecture, « Supprimer » un compte dans le tableau du bureau) : habillés comme « Enregistrer » ou comme les gestes courants en clair, dégradé corail ou rose pâle en sombre | Contour d'alerte 1,5 px sur la surface, texte d'alerte, sans dégradé ; au survol, surface basse et contour épaissi (l'alerte n'est jamais un fond, charte §2) ; la corbeille et les listes ✗ / ✓ deviennent des icônes linéaires |
| La seconde confirmation de la purge dit « Tape OK » | « Dernière vérification : les commandes, clients, ventes et tournées seront supprimés pour de bon. Purger maintenant ? » |
| « Tous les abonnements ↗ », « Tout voir ↗ » dans le bleu du navigateur | Principal, 600, sans soulignement (souligné au survol) : la règle existait, bornée au téléphone |
| Filtre choisi invisible en clair (Préparation « Tous », Analyse / Exports) | La pilule choisie est pleine au principal, comme en sombre et comme dans Commandes |
| Clients : la fiche affichée et le survol ne se voyaient dans aucun thème (spécificité (1,2,0) contre (1,3,0)) | Au bureau : survol au fond ; la ligne choisie au fond avec un anneau de 2 px au principal (le téléphone n'est pas touché) |
| Indications des champs en gras, comme la valeur | Au bureau : indication 400, saisie 500 |
| Préparation au bureau : « Bloquée » au badge vert de « À faire » | Le badge du téléphone : contour d'alerte et « ! » (mots du 19/09 gardés) |
| « Besancon » sans cédille (liste et fiche client, « Modifier », Nouvel abonnement, détail de commande, Adresses à vérifier, secteurs par défaut) | `villeAffichee` (`utils/text.js`) rend l'orthographe **à l'affichage** ; la valeur stockée ne change pas. « Itinéraire » (fiche client) vise l'adresse affichée, cédille comprise (`clients-mobile.spec.js` l'exige) |
| « Modifier le client » : Notes, un carré de 189 px, libellé en bas | Pleine largeur, 96 px, libellé au-dessus |
| Commandes et Stock à 1280 px : des cartes, 3 commandes à l'écran ; à 1281, le client coupé à 133 px | Le tableau reste un tableau dès 1280 px ; colonnes resserrées (numéro 120, date 84 « 24 sept. », secteur 110, articles 64, statut 132 ; Stock : code 104) ; le nom d'un produit passe à la ligne. De 1280 à 1439 px : en-tête des Commandes sur une ligne (recherche 200 px, « Actualiser » réduit à son icône), espaces de 12 px, lignes de 48 px — **8 commandes entières à 1280 × 720** |
| Abonnements : « EHPAD Les Till… », « EHPAD Résid… » coupés à 1440 | Fréquence 168 px (« Toutes les 2 semaines » entier), Prochaine 112, État 96 ; « Les 90 jours » sous le tableau jusqu'à 1599 px. Aucun nom coupé à 1280, 1440 ni 1600 |
| Détail de commande : « Technique » déplié, ✏️ 📞 ⚠ 📝 💾 | `<details>` fermé ; icônes linéaires ; « (idem date commande) » devient « le jour de la commande » ; le secteur avec sa cédille |
| Nouvel abonnement : le client choisi, « Créer une fiche client » restait | Il disparaît ; la croix du champ rend la recherche et le bouton |
| À recommander : les quatre chiffres en rouge d'alerte en clair | Texte courant ; seul un stock à zéro reste en alerte, avec son mot |
| Exports, Rappels, À recommander : première et dernière carte rognées | 4 px de marge intérieure dans la liste qui défile |
| Deux « À jour » : données (en-tête) et version (barre latérale) | Au bureau, la version dit « Installée » (dans la barre, sous le numéro) ; « À jour » reste aux données, et au pied de Paramètres du téléphone (planche 6a) |
| L'icône d'« Actualiser » collée à son mot (en sombre, et en clair une fois sa géométrie partie) | Au bureau, 8 px entre l'icône et le mot de tout bouton, dans les deux thèmes |

### Décisions prises dans le lot

- **La référence est la charte, valeur par valeur, et à défaut la géométrie V8** (celle du
  sombre) : c'est elle que les lots du 18 au 23/09 ont posée et mesurée, en règles
  `:root[data-color-scheme]` qui valent pour les deux thèmes. Le clair y perdait ses restes.
- **Le texte des données ne change pas** : les bancs de la file hors ligne attendent « À jour »
  (`tournee-hors-ligne`, `livreur-ne-perd-rien`, `chargement-instantane`). C'est la version qui
  change de mot.
- **Ne jamais réécrire la fiche d'un client** : la ville s'affiche « Besançon », le formulaire
  « Modifier » n'envoie toujours que ce qui diffère de ce qu'il a montré (banc : un téléphone
  modifié part seul, la ville reste « Besancon » en base).
- **8 lignes à 1280 × 720 par la densité, pas en retirant** : aucun filtre ni geste n'est
  retiré ; l'en-tête se resserre et la ligne passe à 48 px, au-dessus de la cible de 44.

### Écarts nommés

- **Le téléphone (≤ 820 px) garde, en clair, la géométrie de ses couches** : le lot téléphone
  y mesure en clair, en parallèle de celui-ci. Clair et sombre y diffèrent encore (corps 15 /
  16 px, boutons pleine largeur sous 560 px en clair…). `test/un-seul-dessin.test.js` ne juge
  que ce qui s'applique au bureau, et le dit.
- **Le clair change à l'œil au bureau** : corps 16 px (15 avant), boutons 16 px (13,44), pilules
  rondes, titres de carte à 18 px. C'est le but ; c'est aussi un changement que Thomas verra.
- **La tablette (821–920 px)** prend elle aussi la géométrie du sombre, hors les trois
  corrections ci-dessus.
- **Abonnements** : de 1440 à 1599 px, « Les 90 jours » passe sous le tableau, alors que la
  planche 13a les met côte à côte à 1440 — côte à côte, même resserré, le tableau n'avait pas la
  place d'un nom d'EHPAD.
- **Commandes, 1280–1439 px** : lignes de 48 px (la planche 13c : 56) et « Actualiser » en icône
  (son nom accessible reste « Actualiser »).
- **La version dit « Installée » au bureau**, la planche 6a écrit « À jour » (le téléphone le
  garde, `parametres-mobile.spec.js` inchangé depuis `main`).
- **`normalizeCity` (serveur) range toujours « Besancon »** : c'est aussi la clé de secteur
  (`CORE_SECTORS`, `deriveSector`). La commande client pré-remplie garde la valeur stockée (seul
  son texte indicatif a sa cédille). Le champ Ville du détail d'une commande montre « Besançon »
  (relecture) : ce formulaire renvoie tous ses champs, et le serveur range la ville comme avant.
- **La page de connexion** (CSS dans `server.js`) garde ses graisses : hors de ce lot.
- **« Exports »** n'est pas dans le banc de comparaison : l'écran est retiré par un autre lot
  (décision 9).

### Bancs, et le rouge de chacun

Chaque banc a été lancé sur le code de `main` (fichiers produit remis par `git checkout
12da3d4 --`, bancs du lot gardés, puis restauration et `git diff --quiet HEAD`) :

- `test/e2e/un-seul-dessin.spec.js` (serveur semé, port **3526**) : douze écrans à 1440 et
  trois fenêtres, chaque élément visible repéré par son chemin dans le DOM, forme comparée
  (taille et graisse, rayons, marges, hauteur ; un état `aria-pressed` différent n'est pas un
  écart). Rouges sur `main` : **890** écarts (1 361 éléments), **90** dans les fenêtres, **197**
  graisses hors Poppins, **66** titres de carte hors charte.
- `test/un-seul-dessin.test.js` : aucune règle claire ne pose de géométrie au bureau, aucune
  graisse hors 400/500/600/700 ; témoins (le sombre `:not([…="light"])` n'est pas pris pour le
  clair, une règle de 821–920 px est jugée, une règle du téléphone ne l'est pas). Rouge sur
  `main` : 410 déclarations de géométrie au bureau (la première : `body { font-size: 15px }`),
  50 graisses hors Poppins (la première : `.eyebrow { font-weight: 800 }`).
- `test/e2e/theme-clair-finitions.spec.js` (serveur semé, port **3527**, 31 cas) : chacun rouge
  sur `main`, de la bonne cause — Purger au fond d'« Enregistrer » `rgb(42, 82, 84)` (clair) et
  `linear-gradient(135deg, …)` (sombre) ; « Annuler la commande » en blanc sur principal ;
  « Tape OK » ; lien `rgb(0, 0, 238)` / `rgb(158, 158, 255)` ; « Tous » en `rgb(255, 255,
  255)` ; ligne client transparente ; indications et saisies en 800 ; badge « Bloquée » sans
  icône ; « Besancon » ; notes de 189 / 210 px pour 584 ; à 1280 × 720 pas d'en-tête de tableau
  (cartes) ; Abonnements « EHPAD Les Tilleuls du Val de Loue (116/251) » à 1440 et « Toutes les
  2 semaines (150/161) » à 1280 ; « Technique » en `DIV` ; « Créer une fiche client » visible ;
  « Besoin estimé 5 » en `rgb(192, 43, 10)` (clair), « Stock actuel 0 » en texte (sombre) ;
  « À jour » dans la barre ; le champ Ville à « Besancon ».

Non-régression, sur le code final : `npm test` (686/686) ; 38 fichiers e2e du bureau
(conception, contraste, cibles, focus, typographie, thèmes, texte coupé, et chaque écran) et
20 fichiers du téléphone et des garanties (file hors ligne, tournée, rapidité, chargement) ;
`numerotation-admin.spec.js` sur un serveur authentifié à part (copie locale non suivie visant
3507). Deux rouges de charge pendant la suite (port 3304 pris par un autre arbre de travail ;
« la page défile » mesuré avant le rendu) : relancés seuls, verts, sans rien changer. Après la
relecture à l'écran (icônes, barre latérale, Itinéraire), les 18 fichiers qu'elle touche ont été
relancés : 231 cas verts.

### Relecture adverse (24/09)

Quatre défauts relevés sur `be2b6bb` ; tous vérifiés à l'écran, tous vrais, tous corrigés. Chaque
banc a d'abord été lancé sur le code de `be2b6bb` (rouge, de la bonne cause), puis sur le
correctif (vert). Bancs dans `theme-clair-finitions.spec.js`, section 10.

| Défaut | Mesure sur `be2b6bb` | Correctif |
|---|---|---|
| Clients au téléphone : la première ligne, choisie d'office par `renderCrm`, portait fond et anneau alors que la fiche est cachée (la règle du lot n'avait pas de media query) | 390 px : fond `rgb(251, 247, 245)` (clair), `rgb(13, 21, 24)` (sombre) | Les règles du survol et de la ligne choisie passent sous `@media (min-width: 821px)`. Banc : à 390 px, fond transparent, aucune ombre, survol transparent ; témoin, la même ligne à 1440 px porte l'anneau |
| « Supprimer » un compte (tableau du bureau) en `ghost` : en clair, fond, texte et contour identiques à « Désactiver » et « Mot de passe » ; en sombre, rose pâle. La note « les gestes Désactiver gardent leur style ghost » se trompait de bouton | clair : texte `rgb(42, 82, 84)` pour les trois ; sombre : `rgb(236, 148, 130)` sur `rgba(229, 139, 124, 0.1)` | `button danger compact`, comme « Supprimer » un secteur : texte et contour d'alerte (`rgb(192, 43, 10)` / `rgb(242, 99, 90)`), 44 px. Banc : comptes servis par le banc (un vrai compte activerait l'authentification) ; témoin, « Mot de passe » n'est pas en alerte |
| « Dernière version » affirmait ce que `/api/version` ne sait pas (elle ne rend que la version du serveur), et changeait aussi le mot du téléphone (planche 6a) | barre et pied de Paramètres : « Dernière version » | Barre latérale : « Installée » ; téléphone : « À jour », `parametres-mobile.spec.js` rendu à `main`. « Mise à jour » (nouvelle version en attente) ne change pas |
| Détail d'une commande, « Modifier le profil » : le champ Ville montrait « Besancon », la fenêtre « Modifier le client » « Besançon » | valeur du champ : « Besancon » | `villeAffichee(order.city)`. Banc : le champ montre « Besançon » ; enregistré (téléphone changé), la fiche garde « Besancon » et son secteur |

Le fichier passe de 31 à 36 cas. Non-régression sur le correctif : `npm test` (686/686) ;
`theme-clair-finitions`, `parametres-mobile`, `barre-laterale-finitions` (59 cas) ; Clients
(bureau et téléphone), Paramètres, Commandes, Adresses à vérifier, `un-seul-dessin`, contraste,
cibles, focus, charte, thèmes, typographie, texte coupé, finitions, intégration, onglets,
navigation du téléphone (179 cas ; Commandes relancé seul après un port 3160 pris par un autre
arbre de travail) ; file hors ligne, tournée hors ligne, livreur, chargement instantané, tableau
de bord, navigation (43 cas).

### Ce qui reste

- Le téléphone en un seul dessin (après le lot téléphone).
- « Annuler la tournée » reste un bouton secondaire (écran Tournée, hors de ce lot).
- La feuille d'un compte au téléphone : « Supprimer le compte » reste `ghost` avec le texte
  d'alerte (`par-geste-danger`) ; c'est au lot téléphone.
- Migrer la valeur stockée « Besancon » avec un banc, dans un lot à part.
- Les graisses de la page de connexion.

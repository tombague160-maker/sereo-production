# Reprise du chantier V8 — dossier de passation

**Dernière mise à jour : 16 septembre 2026** — la section 0 résume ce qui a
changé depuis le 26 août.
Ce document existe pour qu'un assistant qui n'a jamais vu ce projet puisse
reprendre exactement où le précédent s'est arrêté, sans rien redécouvrir et
sans rien re-décider.

Lis-le **en entier** avant de toucher au code. Il t'évitera plusieurs heures
d'investigation et au moins trois bugs déjà rencontrés.

---

## 0. Ce qui a changé depuis le 26 août (mise à jour du 16 septembre 2026)

- **Six planches de maquettes** livrées le 2 septembre (`design/maquettes-v8/`,
  commits `83d2809` et `7891448`) : cockpit livreur, carte, préparation, deux
  navigations, tableau de bord. Charte relevée sur groupe-sereo.fr — vert
  `#386B6D`, orange `#EF9177` **en accent seulement** (2,34:1 avec du blanc),
  Poppins. Mode clair uniquement. Canvas publié :
  https://claude.ai/artifact/UCCU1Bx9zBPZf1Vhffyt5J
- **Tom a tranché le 16/09** (détail en §5) : CA = commandes livrées ;
  fréquence d'abonnement au choix ; départ de tournée = GPS ou adresse
  recherchée, pas d'entrepôt fixe ; arrivée = adresse ou retour au départ ;
  heure de départ = l'instant de « Démarrer ». Il demande un design **clair et
  sombre, vert et orange**, « le plus intuitif possible », avec le skill
  apple-design d'Emil Kowalski.
- **PR 96 (brouillon, Tom, 16/09)** : branche `feat/abonnements-pilotage-tournees`
  partie de `main`, un commit de 2 763 lignes — abonnements (table SQLite,
  `lib/subscriptions.js`), tableau de bord CA livré, tournée IGN + OSRM.
  **Cinq fichiers en conflit avec cette branche** (mesuré par `git merge-tree`) :
  `server.js`, `style.css`, `service-worker.js`, `package.json`, `.env.example`.
  Recommandation : livrer la V8 telle quelle, puis rebaser la PR 96 dessus.
- **Brief Claude Design prêt** : `agents/PROMPT-CLAUDE-DESIGN.md` (à coller),
  `design/DESIGN.md` (charte au format design system), captures PNG des
  planches par `node design/maquettes-v8/capturer.js`.
- **Claude Design prend la phase 3, et seulement elle.** Fable 5.1 y est
  sélectionnable (vérifié par Thomas le 16/09 ; la doc de lancement disait
  Opus 4.7 sans sélecteur). Le code, les tests, la fusion de la PR 96, la
  carte et les apps natives restent dans le dépôt, avec Claude Code. L'export
  de Claude Design est un point de départ pour la phase 4, pas la phase 4.
- **Corrections à ce dossier** : le §10 était faux (GitHub Actions tourne) ;
  le §2 disait l'arbre propre alors que `data/` porte 17 fichiers non suivis,
  dont deux Excel, sur un dépôt **public** ; le pré-cache désaligné concerne
  trois URL, pas une (§8) ; le §11 gagne un piège git.
- **Feuille de route** : https://claude.ai/artifact/ARDPsebcvn5gkWTFX6GJL4 —
  elle est bien sur ce compte. Le 28/08, une liste d'artifacts tronquée avait
  fait conclure le contraire.

---

## 1. À lire, dans cet ordre

| Ordre | Fichier | Pourquoi |
|---|---|---|
| 1 | `CLAUDE.md` | Architecture, conventions, workflow de release, pièges connus. **Fait autorité.** |
| 2 | Ce fichier | Où en est le chantier V8, décisions prises, questions ouvertes |
| 3 | `agents/maintenance.md` | Notes d'exploitation |
| 4 | `CONTRIBUTING.md` | Format des commits (Conventional Commits, obligatoire) |
| 5 | `DEPLOYMENT.md` | Déploiement prod, variables d'environnement |

Puis, seulement si tu touches à ces zones :

- `storage/sqliteStore.js` — schéma et couche d'accès
- `test/e2e/tabs.spec.js` et `test/e2e/themes.spec.js` — le filet de sécurité du front
- `test/geocodage.test.js` — comment tester sans réseau

**Ne lis pas `server.js` ni `public/js/app.js` en entier.** Ils font
respectivement ~7 960 et ~5 150 lignes. Cible tes lectures avec `grep`.

---

## 2. État exact au moment de la passation

```
Dépôt      : https://github.com/tombague160-maker/sereo-production
Branche    : feat/v8-phase1-comptes  (poussée, à jour — mais invisible à `git branch -r`, voir §11)
Base       : main, tag v1.22.0, déployée et confirmée en production
Arbre      : 17 fichiers non suivis dans data/ (résidus d'audit, à ignorer ou supprimer)
```

**Huit commits accumulés, non livrés :**

```
7891448  design(v8): contraste, cibles tactiles et coherence des maquettes
83d2809  design(v8): six planches de maquettes dans la charte relevee sur le site
980e036  docs(v8): prompt de reprise pret a coller dans une nouvelle conversation
656b556  docs(v8): dossier de passation pour reprendre le chantier
0db2ac4  feat(geocodage): declenchement automatique apres import, coupable par variable
93d341d  feat(geocodage): geocodage automatique des adresses via la BAN
75c173c  feat(comptes): ecran d'administration des comptes dans les Parametres
8887159  feat(comptes): API d'administration des comptes et endpoint /api/me
```

**Vérification actuelle — tout doit rester vert :**

```bash
npm run check                        # syntaxe : serveur + TOUS les modules front
npm test                             # 335 tests, ~6 s
npx playwright test --project=chromium   # 13 tests e2e
```

Si `npm test` dépasse ~10 s, quelque chose appelle le réseau. Voir §6.

---

## 3. Ce qui est déjà en production (v1.22.0)

- **Icônes PWA complètes** Android + iOS. L'app s'installe correctement sur
  l'écran d'accueil, ce qui n'était pas le cas avant.
- **Modules ES natifs** : `app.js` découpé, sans bundler.
- **Comptes utilisateurs** : table, hachage scrypt, quatre rôles, connexion par
  compte — **sans casser** l'authentification par variables d'environnement.
- **Deux suites e2e** : parcours des 15 onglets, parité des thèmes.

Confirmé en ligne : `curl -s https://sereo.dockerswag2024.duckdns.org/api/version`

---

## 4. Ce qui attend sur la branche

- **API des comptes** : `GET /api/me`, et CRUD sur `/api/comptes`.
- **Écran d'administration des comptes** dans les Paramètres.
- **Géocodage** via la Base Adresse Nationale, avec cache, déclenchement
  automatique après import, et plafond de lot.

---

## 5. Décisions déjà prises — ne pas les rouvrir

Tom a tranché ces points. Les remettre en cause lui ferait perdre du temps.

| Sujet | Décision | Date |
|---|---|---|
| Ampleur | Refonte totale de l'interface, architecture front comprise | 26/08 |
| Framework | **Aucun.** Vanilla JS en modules ES natifs, aucun bundler | 26/08 |
| Rôles | **Tout le monde voit tout.** L'équipe fait le travail de bout en bout. La séparation existe dans le code mais reste éteinte (`SEREO_SEPARATION_ROLES`) | 26/08 |
| Administration des comptes | Reste réservée au rôle `admin` — c'est de la sécurité, pas du quotidien | 26/08 |
| Rythme de livraison | **Un tag par phase**, pas par lot. Accumuler sur la branche | 26/08 |
| Claude Design | Intervient en **phase 3**, avant la refonte des écrans — pas à la fin | 26/08 |
| Carte | Objectif « hyper complet » : optimisation réelle, trafic temps réel, distances depuis l'entrepôt, règle de fin de trajet | 26/08 |
| Applications natives | Objectif à terme : APK Android + iOS, avec notifications. Via Capacitor, qui réutilise la SPA existante | 26/08 |
| Chiffre d'affaires | Le tableau de bord compte **les commandes livrées uniquement** | 16/09 |
| Fréquence d'abonnement | **Au choix de Tom** : 7 / 10 / 14 / 15 / 21 / 28 jours, mensuel, ou personnalisé — plusieurs choix proposés, il sélectionne | 16/09 |
| Départ de tournée | **Pas d'entrepôt fixe.** Position GPS du téléphone, ou ville / adresse recherchée | 16/09 |
| Arrivée de tournée | Adresse choisie, ou « Retour au point de départ » | 16/09 |
| Heure de départ | L'instant où l'on appuie sur « Démarrer la tournée » | 16/09 |
| Direction visuelle | **Clair et sombre**, vert et orange, « le plus intuitif possible », principes du skill apple-design | 16/09 |
| Comptes | **Un seul compte utilisé pour l'instant.** Les comptes par personne existent (v1.22.0) et attendent le besoin réel, les notifications | 16/09 |

---

## 6. Questions ouvertes — à poser à Tom, pas à décider seul

Les trois questions du 26 août (entrepôt, fin de tournée, heure de départ) sont
**tranchées** depuis le 16/09 — voir §5. Il en reste trois, posées à Tom dans
le brief Claude Design :

1. **Les quatre destinations mobiles.** Proposition de Claude Design, 16/09 :
   Tableau de bord · Préparation · Tournée · Abonnements ; dans « Plus » :
   Commandes, Stock, Clients, Analyse, Paramètres. **En attente de Tom.**
2. **Intervalle strict ou jour ancré.** Proposition, 16/09 : garder
   l'intervalle strict et rendre la dérive visible par un aperçu des trois
   prochaines dates avec leur jour. Le mode « un jeudi sur deux » viendrait
   plus tard, jamais comme défaut caché. **En attente de Tom.**
3. **Mode sombre.** Proposition, 16/09 : suivre le système, avec bascule
   manuelle dans les Paramètres. Pas de bascule automatique au crépuscule :
   l'écran ne doit pas changer en pleine tournée. **En attente de Tom.**
4. **Ordre de fusion** de la branche V8 et de la PR 96 (voir §0). Décision de
   Tom et Thomas, pas de l'assistant.

---

## 7. Feuille de route

Publiée comme Artifact : https://claude.ai/artifact/ARDPsebcvn5gkWTFX6GJL4
**Elle doit être republiée après chaque incrément, sans qu'on ait à le
demander** — c'est une consigne explicite de Tom.

**Sa source est versionnée ici : `agents/feuille-de-route.html`.** Le 16/09,
en cours de session, l'accès aux Artifacts a basculé sur un autre compte :
l'Artifact et le canvas des maquettes sont devenus « introuvables » sans avoir
été supprimés, et la dernière republication a échoué. Règle : modifier le
fichier du dépôt, puis republier **depuis le compte propriétaire** avec l'URL
ci-dessus. Ne jamais republier sans URL, ça crée un doublon qui divergera.

```
Phase 0  Fondations                          TERMINÉE, en production
Phase 1  Comptes et rôles                    sur la branche
Phase 2  Géocodage et départ de tournée      back fait ; questions tranchées le 16/09
Phase 3  Maquettes                           ← EN COURS : 6 planches faites (02/09) ; passage Claude Design clair + sombre à faire
Phase 4  Refonte des écrans + abonnements    après les maquettes ; PR 96 à rebaser d'abord
Phase 5  Cartographie et trafic réel
Phase 6  Applications natives (Capacitor)
```

**Reports à ne pas perdre :**

- Restructuration du CSS en couches → phase 4 (`@layer` change la résolution de
  spécificité ; une migration partielle inverserait la cascade)
- Découpage de `app.js` par domaine → nécessite d'abord un store partagé
- Fragilité de la suite e2e → voir §8
- Pré-cache du service worker désaligné → voir §8
- `formatImportStats` reste dans `app.js` (seule fonction de sa famille à lire
  l'état global)
- Poppins à auto-héberger dans `public/fonts/` (`font-src 'self'`) → phase 4
- Rebasage de la PR 96 sur la V8 (cinq conflits, voir §0) → avant tout tag
- `data/` : 17 fichiers non suivis à ignorer ou supprimer → phase 1
- `test/corruption.test.js` vu binaire par git → `.gitattributes`, phase 1 (§8)

---

## 8. Pièges vérifiés — chacun a coûté du temps

Tous ont été constatés dans **ce** code, pas supposés.

### Front

- **`??` ne se déclenche pas sur la chaîne vide.** Les coordonnées absentes
  valent `""` partout ici, jamais `null`. Utiliser `premiereCoordonnee`.
- **Un `<select>` émet `change`, pas `click`.** Le dispatcher `[data-action]`
  délégué sur `click` ne le verra jamais.
- **Aucune fonction n'est globale** en mode module ES, et la CSP interdit tout
  script inline. Le seul mécanisme d'action est le listener délégué.
- **`.settings-grid > .panel:nth-of-type(N)`** compte les `<div>`, pas la
  classe. Ajouter un `.panel` décale toutes les règles de placement ≥ 1400 px.
- **`.settings-block` n'est pleine largeur qu'au-delà de 1400 px.** En dessous,
  un tableau se retrouve dans ~470 px et les libellés se cassent lettre par
  lettre.
- **Tout module ES ajouté doit l'être à TROIS endroits** : l'`import` dans
  `app.js`, `APP_SHELL` du service worker, et le script `check` du
  `package.json`. Un oubli dans `APP_SHELL` casse le mode hors ligne en silence.
- **Bumper `CACHE_NAME`** à chaque modification d'un fichier d'`APP_SHELL`.
- **`cache.addAll` est atomique.** Une seule URL en échec et le service worker
  ne s'installe jamais, sans aucune trace visible.
- **Piège majeur non corrigé :** `requireAccessAuth` rend la page de connexion
  avec un statut **200**. Si le service worker s'installe pendant que la session
  est expirée, `cache.addAll` réussit et met du HTML de login sous les clés
  `/js/app.js` et `/css/style.css`. À traiter.
- **Le pré-cache est désaligné** : le worker cache `/js/app.js` mais la page
  demande `/js/app.js?v=…`. Vérifié le 28/08 : **trois** URL sont concernées
  (`app.js`, `style.css`, `sereo-logo.svg`). L'API Cache compare l'URL complète. **Ne PAS
  ajouter `ignoreSearch`** : ça ferait resservir du code périmé après
  déploiement, et mélangerait les réponses de `/api/imports/archives?type=…`.

### Serveur

- **Les appels réseau ne doivent JAMAIS être faits sous `withWriteLock`.** Le
  verrou sérialise toutes les écritures avec un plafond de 60 s. Lire, appeler
  le réseau sans verrou, puis prendre le verrou une seule fois pour écrire.
- **`persistDatabase` fait un DELETE + réinsertion complète** de toutes les
  tables qu'il connaît, à chaque écriture. Les tables `utilisateurs` et
  `geocodages` en sont délibérément absentes.
- **`mergeImportedClients` reconstruit entièrement `db.clients`** à chaque
  import et ne reprend que `statut`, `lat`, `lng`, `notes`, `priority`. Tout
  autre champ ajouté sur un client est effacé, en silence.
- **`normalizeOrder` ne fait pas `...order`** : tout champ ajouté sur une
  commande est perdu au prochain `syncWorkflow`.
- **Ne jamais mettre de backtick dans un commentaire SQL** : ces chaînes sont
  dans un template literal JavaScript, un backtick le termine.
- **Un identifiant vide passe `constantTimeEqual`** quand `AUTH_USER` vaut `""`.
  Deux gardes `isEnvAuthConfigured()` protègent cette voie — ne pas les retirer.

### Tests

- **`npm test` ne charge JAMAIS le front.** Les 335 tests frappent le serveur en
  HTTP. Seul l'e2e couvre `public/js/`.
- **`isVisible({ timeout })` NE PATIENTE PAS.** Playwright ignore explicitement
  cette option. C'est un instantané. Source connue de tests fragiles dans
  `smoke.spec.js`.
- **Aucun test ne doit appeler une API externe.** Lent, dépendant du réseau,
  impoli. Tous les fichiers posent `SEREO_GEOCODAGE_AUTO = "0"`. Le seul moyen
  propre de tester le géocodage est un faux serveur local, comme dans
  `test/geocodage.test.js`.
- **Un panneau devient `active` AVANT d'avoir du contenu.** `showTab` pose la
  classe de façon synchrone ; le rendu arrive après `loadData()`.
- **Le cache de géocodage survit à `writeDb`.** Réutiliser une adresse déjà
  géocodée dans un autre test renverra le cache sans appeler le faux serveur.
- **La suite e2e est fragile** : 10 workers en parallèle sur un seul serveur et
  une seule base SQLite, dont un test qui écrit des réglages sans les restaurer.
  Observé une fois, non reproduit sur cinq exécutions. Cause de fond réelle.
- **`test/corruption.test.js` est vu binaire par git.** Il contient un octet
  nul (l'en-tête « SQLite format 3 » qu'il fabrique, ligne 102), donc aucun
  diff n'en est jamais affiché — ni en PR, ni dans `git log -p`. Un
  `.gitattributes` avec `*.js diff` rétablit la revue sans toucher au test.

---

## 9. Protocole de travail attendu

C'est la manière dont le chantier a été mené jusqu'ici. La conserver.

### Avant de coder

1. **Lire le code réel**, avec numéros de ligne. Ne jamais supposer.
2. **Vérifier les affirmations de la documentation.** `CLAUDE.md` annonçait
   2 700 lignes pour `server.js` qui en faisait 6 900.
3. **Construire le filet avant le refactor**, pas après.

### Avant de commiter

```bash
npm run check && npm test && npx playwright test --project=chromium
```

Obligatoire dès que `server.js` ou `public/js/` est touché. L'updater déploie
sans valider : une typo casse la production en silence.

### Niveau de preuve

- Un test qui passe ne prouve rien tant qu'on n'a pas montré qu'il **peut
  échouer**. Prouver par mutation, puis retirer la mutation. Le projet le fait
  déjà (« B3.f prouvé non-vacuous par mutation »).
- Pour un refactor censé ne rien changer : comparer des captures d'écran
  **avant/après**, et faire une **expérience de contrôle** (deux captures du
  code identique) pour connaître le bruit de fond.
- Pour une intégration d'API externe : vérifier contre l'**API réelle**, pas
  seulement contre son propre simulacre. C'est ce qui a révélé que la BAN
  renvoie une rue différente avec un type `housenumber` rassurant.
- Pour un écran : le **piloter réellement** dans un navigateur, pas seulement
  lire le code.

### Commits

Conventional Commits, en français, obligatoires — `release-please` en dépend.
Les messages de ce chantier sont longs et expliquent le **pourquoi**, les
alternatives écartées et les pièges évités. Conserver ce niveau.

### Communication avec Tom

- **Tout en français**, y compris le code, les commentaires et les commits.
- Il écrit vite et avec des fautes de frappe : lire l'intention.
- Signaler ce qui a été **reporté**, jamais le laisser tomber en silence.
- Corriger explicitement ses propres erreurs quand elles changent ce que Tom
  croit de son code.
- Ne pas polir un visuel qui sera refait en phase 4. Investir dans le câblage,
  qui survivra.

---

## 10. Infrastructure — état réel

- **GitHub Actions tourne.** Vérifié le 28/08 puis le 16/09 : les deux
  workflows sont `active`, `release-please` a produit la 1.22.0 le 26/08 et la
  CI a validé la PR 96 le 16/09. L'affirmation contraire du 26 août venait
  d'une liste de runs tronquée. **Ne pas poser de tag à la main** : le cycle
  normal (merge sur `main` → PR de release → tag) fonctionne, et un tag manuel
  par-dessus produirait deux bumps de version.
- **Substitut à la CI** : construire l'image Docker et démarrer réellement le
  conteneur. C'est plus complet que la CI, qui ne charge jamais le front.
- **Un tag `vX.Y.Z` déclenche l'auto-déploiement OMV sous 15 minutes.** Ne
  jamais taguer sans intention de livrer.
- **Le format des notes de release compte** : le serveur extrait la section
  `## 🎁 Pour toi` et la sert dans `/api/version` pour alimenter la modale
  « Quoi de neuf ». Des notes au format brut laisseraient cette modale vide.

---

## 11. Environnement de développement

```
Répertoire   : C:\Users\blanc\projects\sereo-production
Plateforme   : Windows, PowerShell et Git Bash disponibles
Node         : 24 minimum (module node:sqlite natif)
Docker       : présent, daemon à démarrer manuellement
Playwright   : chromium installé
```

**Piège shell rencontré plusieurs fois :** les heredocs Bash mangent les
doubles antislashs. Pour écrire `\u0300` dans un fichier depuis un script,
construire l'antislash avec `chr(92)` en Python, ou utiliser l'outil d'écriture
de fichier plutôt que le shell. Reproduit le 16/09 même avec `<<'EOF'`.

**Piège git :** `remote.origin.fetch` vaut `+refs/heads/main:refs/remotes/origin/main`.
`git fetch` ne ramène donc que `main`, et `git branch -r` ne montre jamais une
branche de travail, même poussée. Vérifier avec `git ls-remote --heads origin`,
et récupérer une PR par `git fetch origin pull/N/head:refs/remotes/origin/pr-N`.

Lancer l'app en local :

```bash
SEREO_AUTH_USER=test SEREO_AUTH_PASSWORD=mot-de-passe-de-test PORT=3000 node server.js
```

---

## 12. Mémoire de session

Ces éléments vivaient dans la mémoire de l'assistant précédent. Ils sont
reproduits ici parce qu'ils ne suivent pas d'un compte à l'autre.

**Consigne explicite de Tom, 26/08/2026 :**
« tout ce que tu n'as pas fait faut pas l'oublier, marque-le dans la suite du
plan » puis « ça doit être automatique, je dois pas avoir à te le dire ».

→ Tenir la feuille de route à jour fait partie du travail, jamais d'une demande
séparée. Après chaque lot : republier avec ce qui est fait, ce qui est reporté
et vers quelle phase, et ce qui a été découvert en chemin. Ne jamais annoncer
un travail terminé en laissant le plan décrire l'état d'avant.

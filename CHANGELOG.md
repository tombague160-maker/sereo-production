# Changelog

## [1.22.0](https://github.com/tombague160-maker/sereo-production/compare/v1.21.0...v1.22.0) (2026-08-26)


### ✨ Nouvelles fonctionnalités

* **v8:** fondations du chantier V8 — icônes PWA, modules ES, comptes utilisateurs ([#95](https://github.com/tombague160-maker/sereo-production/issues/95)) ([fa57f04](https://github.com/tombague160-maker/sereo-production/commit/fa57f044d675d3ed4f612d9bd6354a72a68a79d9))


### 🐛 Corrections

* **sécurité:** un en-tête Basic vide n'authentifie plus lorsque la protection provient des comptes en base et non des variables d'environnement
* **pwa:** icône unique marquée `any maskable` rognée par Android, et absence totale d'icône sur iOS
* **docker:** `data/imports-archives/` entrait dans l'image à chaque build

## [1.21.0](https://github.com/tombague160-maker/sereo-production/compare/v1.20.0...v1.21.0) (2026-07-22)


### ✨ Nouvelles fonctionnalités

* **ui:** refonte mobile app-like + densité + cohérence dark + a11y ([#94](https://github.com/tombague160-maker/sereo-production/issues/94)) ([b9c8d93](https://github.com/tombague160-maker/sereo-production/commit/b9c8d9322eb377d0a6ffdefed68569a4660b6a6a))

## [1.20.0](https://github.com/tombague160-maker/sereo-production/compare/v1.19.2...v1.20.0) (2026-07-22)


### Nouvelles fonctionnalites

* finalise SEREO V7 CRM, themes et workflow livraison ([#92](https://github.com/tombague160-maker/sereo-production/issues/92)) ([897b2ba](https://github.com/tombague160-maker/sereo-production/commit/897b2ba1385975d8eba965e4c0207c2d390ce005))


### Documentation

* **audit:** audit ultra-complet 2026-06-04 (12 lentilles, 160 findings) ([#78](https://github.com/tombague160-maker/sereo-production/issues/78)) ([4c16501](https://github.com/tombague160-maker/sereo-production/commit/4c16501e3bdc35531ab3d26a867d9079289b8343))

## [1.19.2](https://github.com/tombague160-maker/sereo-production/compare/v1.19.1...v1.19.2) (2026-07-08)


### 🐛 Corrections de bugs

* **import:** MERGE stock préserve coût/tarif/statut quand la colonne Excel manque (Lot 4b) ([#87](https://github.com/tombague160-maker/sereo-production/issues/87)) ([aa2fd79](https://github.com/tombague160-maker/sereo-production/commit/aa2fd79cbdf57b82fc090366de91f5a75c425003))
* **stock:** purge libère les réservations de stock (Lot 5) ([#89](https://github.com/tombague160-maker/sereo-production/issues/89)) ([5a72737](https://github.com/tombague160-maker/sereo-production/commit/5a72737452e956289c5ea263abbcccd8726457d3))
* **tournee:** reorderRouteStops rejette les stopIds dupliqués (Lot 6) ([#90](https://github.com/tombague160-maker/sereo-production/issues/90)) ([08a7e94](https://github.com/tombague160-maker/sereo-production/commit/08a7e94f1eb1093ab2df77667b799fe3d60f5a1c))

## [1.19.1](https://github.com/tombague160-maker/sereo-production/compare/v1.19.0...v1.19.1) (2026-07-08)


### 🐛 Corrections de bugs

* **auth:** rate-limit Basic auth + durcissement cookie/redirect (Lot 1 — P0 audit) ([#82](https://github.com/tombague160-maker/sereo-production/issues/82)) ([a14b1d6](https://github.com/tombague160-maker/sereo-production/commit/a14b1d6417f33abdc2b750e8eb2bdd1bbadf6ac4))
* **backups:** re-arme les backups apres fresh_empty + expose la sante backup (Lot 3a — P0 audit) ([#84](https://github.com/tombague160-maker/sereo-production/issues/84)) ([157a18e](https://github.com/tombague160-maker/sereo-production/commit/157a18e113320ac174fc80171502b6a30b587354))
* **dates:** stoppe la mutation en masse des dateCommande vers today (Lot 2 — P0 audit) ([#83](https://github.com/tombague160-maker/sereo-production/issues/83)) ([d5640e2](https://github.com/tombague160-maker/sereo-production/commit/d5640e25d337ac58dc4d2816eb80bb572242f6f5))
* **release:** restaure la version 1.19.0 sur main (manifest + package.json) ([#81](https://github.com/tombague160-maker/sereo-production/issues/81)) ([14fb956](https://github.com/tombague160-maker/sereo-production/commit/14fb956170666826f573974cc24e41aefbdf2b40))

## [1.16.0](https://github.com/tombague160-maker/sereo-production/compare/v1.15.0...v1.16.0) (2026-06-17)


### ✨ Nouvelles fonctionnalités

* **audit:** lot P1 + revue adverse - M1 date stricte, M2 qty import, M6 Haversine, T1 SW notif, T4 timeout, M3 ellipsis ([#76](https://github.com/tombague160-maker/sereo-production/issues/76)) ([90187bc](https://github.com/tombague160-maker/sereo-production/commit/90187bc2c0daf6240696ecef4e3495bd1a4bfbfa))
* **concurrency:** verrou applicatif + integrite stock + backup post-recovery ([#79](https://github.com/tombague160-maker/sereo-production/issues/79)) ([c8f35c5](https://github.com/tombague160-maker/sereo-production/commit/c8f35c5d01f07806315bb2c7fe5d357d4ea832f7))
* **storage:** recovery automatique sur corruption SQLite (B3) + alerte perte de donnees ([#75](https://github.com/tombague160-maker/sereo-production/issues/75)) ([8a397a9](https://github.com/tombague160-maker/sereo-production/commit/8a397a9a274c5900e1947584d703b8846f5ae4f6))
* **tournee:** calibrage vitesse/arret + diagnostic dates suspectes ([#77](https://github.com/tombague160-maker/sereo-production/issues/77)) ([905812d](https://github.com/tombague160-maker/sereo-production/commit/905812d8c8abffc99f29bac29da4021d4e35a622))


### 🐛 Corrections de bugs

* **ui:** Parametres v1.15 - Historique + Zone danger en pleine largeur sous les 3 panels ([#72](https://github.com/tombague160-maker/sereo-production/issues/72)) ([6f27675](https://github.com/tombague160-maker/sereo-production/commit/6f27675b05a412ee0c3f151fe54c65173341681e))


### ⚡ Optimisations

* chantier 2 audit 2026-06-04 + fix version v1.15.0 figee (v1.19.0) ([#80](https://github.com/tombague160-maker/sereo-production/issues/80)) ([7ca6f0d](https://github.com/tombague160-maker/sereo-production/commit/7ca6f0d6e2d5de427dddd801e072ff16ab51983f))


### 📚 Documentation

* **audit:** rapport complet 25 mai 2026 (10 axes parallels) ([#73](https://github.com/tombague160-maker/sereo-production/issues/73)) ([55eff4e](https://github.com/tombague160-maker/sereo-production/commit/55eff4e92754ee877aa55f0d2e45db007cf3d532))

## [1.15.0](https://github.com/tombague160-maker/sereo-production/compare/v1.14.1...v1.15.0) (2026-05-23)


### ✨ Nouvelles fonctionnalités

* **ui:** page Parametres en grille 3 colonnes sur grand ecran + secteurs en 2 sous-colonnes ([#70](https://github.com/tombague160-maker/sereo-production/issues/70)) ([29e3af6](https://github.com/tombague160-maker/sereo-production/commit/29e3af6eaa9bb80a2c93bae2662c03b04a83dbbd))

## [1.14.1](https://github.com/tombague160-maker/sereo-production/compare/v1.14.0...v1.14.1) (2026-05-23)


### 🐛 Corrections de bugs

* **build:** retirer @playwright/test des devDependencies (build Docker echouait) ([#68](https://github.com/tombague160-maker/sereo-production/issues/68)) ([b921197](https://github.com/tombague160-maker/sereo-production/commit/b921197590e3c9a15cc70fbbdb0a8bc4c365be1e))

## [1.14.0](https://github.com/tombague160-maker/sereo-production/compare/v1.13.1...v1.14.0) (2026-05-21)


### ✨ Nouvelles fonctionnalités

* **qa:** sprint 3 - Playwright E2E + a11y polish + schema doc ([#66](https://github.com/tombague160-maker/sereo-production/issues/66)) ([77c17e9](https://github.com/tombague160-maker/sereo-production/commit/77c17e90a87d48c236799a8cb42a619013762632))

## [1.13.1](https://github.com/tombague160-maker/sereo-production/compare/v1.13.0...v1.13.1) (2026-05-21)


### ⚡ Optimisations

* **core:** sprint 2 - syncWorkflow hors readDb + N+1 stats + test stress 5000 lignes + ADR 0001 ([#64](https://github.com/tombague160-maker/sereo-production/issues/64)) ([a903b65](https://github.com/tombague160-maker/sereo-production/commit/a903b65c0e10988d3614578441be8bc5172f4c04))

## [1.13.0](https://github.com/tombague160-maker/sereo-production/compare/v1.12.0...v1.13.0) (2026-05-21)


### ✨ Nouvelles fonctionnalités

* **hardening:** sprint 1 audit (XSS fix, auth secret, spinner, dark contrast, focus trap, indexes, README, CLAUDE.md) ([#63](https://github.com/tombague160-maker/sereo-production/issues/63)) ([e2a938c](https://github.com/tombague160-maker/sereo-production/commit/e2a938c824f9eef05b6ed6af330fc687077dbf30))


### 📚 Documentation

* **audit:** rapport complet 20 mai 2026 (5 axes, plan en 3 sprints) ([#61](https://github.com/tombague160-maker/sereo-production/issues/61)) ([b55c9ff](https://github.com/tombague160-maker/sereo-production/commit/b55c9ff9077eb38fa05bb63204a016ba3e5c0798))

## [1.12.0](https://github.com/tombague160-maker/sereo-production/compare/v1.11.0...v1.12.0) (2026-05-20)


### ✨ Nouvelles fonctionnalités

* **imports:** archivage auto des Excel + bouton purge bons de commande ([#59](https://github.com/tombague160-maker/sereo-production/issues/59)) ([e6b20da](https://github.com/tombague160-maker/sereo-production/commit/e6b20da4574625b8a5b6d7250d6fba894e7c65b6))

## [1.11.0](https://github.com/tombague160-maker/sereo-production/compare/v1.10.1...v1.11.0) (2026-05-18)


### ✨ Nouvelles fonctionnalités

* **ui:** coherence Commandes livrees + filtre A completer + edition profil + vue tableau + export CSV ([#57](https://github.com/tombague160-maker/sereo-production/issues/57)) ([d7c4bc4](https://github.com/tombague160-maker/sereo-production/commit/d7c4bc4595f18cbc149b1aefa73061b672b7bdde))

## [1.10.1](https://github.com/tombague160-maker/sereo-production/compare/v1.10.0...v1.10.1) (2026-05-18)


### 🐛 Corrections de bugs

* **ui:** modal detail bon de commande sans fond + lisibilite cartes ([#55](https://github.com/tombague160-maker/sereo-production/issues/55)) ([a25afba](https://github.com/tombague160-maker/sereo-production/commit/a25afba11239d3f219d6b13bd8204dd043147c19))

## [1.10.0](https://github.com/tombague160-maker/sereo-production/compare/v1.9.1...v1.10.0) (2026-05-18)


### ✨ Nouvelles fonctionnalités

* **ui:** nouvelle page "Bons de commande" avec filtres + modal detail (Phase 3 ERP) ([#53](https://github.com/tombague160-maker/sereo-production/issues/53)) ([9435a33](https://github.com/tombague160-maker/sereo-production/commit/9435a33d00cae801ea472eaf9faf5f2897df476d))

## [1.9.1](https://github.com/tombague160-maker/sereo-production/compare/v1.9.0...v1.9.1) (2026-05-18)


### 🐛 Corrections de bugs

* **sqlite:** migration v1.9.0 cassee en prod - CREATE INDEX avant ALTER TABLE ([#51](https://github.com/tombague160-maker/sereo-production/issues/51)) ([3327435](https://github.com/tombague160-maker/sereo-production/commit/3327435a8f45b5fcd6d89d5678adbc362dfb6149))

## [1.9.0](https://github.com/tombague160-maker/sereo-production/compare/v1.8.3...v1.9.0) (2026-05-18)


### ✨ Nouvelles fonctionnalités

* **orders:** refonte ERP des bons de commande (Phase 1+2 - modele + import) ([#49](https://github.com/tombague160-maker/sereo-production/issues/49)) ([19e9aeb](https://github.com/tombague160-maker/sereo-production/commit/19e9aeb92d5e97ded8c6920d0984a23c9333f99d))

## [1.8.3](https://github.com/tombague160-maker/sereo-production/compare/v1.8.2...v1.8.3) (2026-05-18)


### 🐛 Corrections de bugs

* **import:** preserver les ajustements manuels du stock lors d'un re-import Excel ([#46](https://github.com/tombague160-maker/sereo-production/issues/46)) ([e0ebe36](https://github.com/tombague160-maker/sereo-production/commit/e0ebe36b2f9fde723fa238e98287a1f90378d548))

## [1.8.2](https://github.com/tombague160-maker/sereo-production/compare/v1.8.1...v1.8.2) (2026-05-14)


### 🐛 Corrections de bugs

* **mobile:** tabbar 6 tabs cassait sur telephone, refonte 5 max + menu Plus ([#44](https://github.com/tombague160-maker/sereo-production/issues/44)) ([9891066](https://github.com/tombague160-maker/sereo-production/commit/989106632ab31a366f66c550518105e3687a8db4))

## [1.8.1](https://github.com/tombague160-maker/sereo-production/compare/v1.8.0...v1.8.1) (2026-05-14)


### 🐛 Corrections de bugs

* **login:** proportions mobile + autofill jaune navigateur ([09eaab7](https://github.com/tombague160-maker/sereo-production/commit/09eaab7ca873adde59a551365a1eeba8a15b4078))
* **login:** proportions mobile + autofill jaune navigateur ([700c3da](https://github.com/tombague160-maker/sereo-production/commit/700c3dadcdee78d4649fd72b9ef0cbc31db49937))

## [1.8.0](https://github.com/tombague160-maker/sereo-production/compare/v1.7.0...v1.8.0) (2026-05-14)


### ✨ Nouvelles fonctionnalités

* **login:** refonte split-screen desktop (pattern B2B SaaS 2026) ([562c2c0](https://github.com/tombague160-maker/sereo-production/commit/562c2c0b18ee79dba676dbd2b4ce401a94e4eaca))
* **login:** refonte split-screen desktop (pattern B2B SaaS 2026) ([868c1e3](https://github.com/tombague160-maker/sereo-production/commit/868c1e33a9be25972447efb03c4669656680e2f2))


### 🐛 Corrections de bugs

* **version:** /api/version pas mis en cache (HTTP + Service Worker) ([98deaad](https://github.com/tombague160-maker/sereo-production/commit/98deaad885517d606b62647f82c33d4fabd30046))
* **version:** /api/version pas mis en cache (HTTP + Service Worker) ([0bfc0c5](https://github.com/tombague160-maker/sereo-production/commit/0bfc0c5bf1299673c143956fe92ecbc6219cb763))

## [1.7.0](https://github.com/tombague160-maker/sereo-production/compare/v1.6.0...v1.7.0) (2026-05-14)


### ✨ Nouvelles fonctionnalités

* **login:** refonte plus luxe/pro - couleurs brand sereo animees subtilement ([7aac506](https://github.com/tombague160-maker/sereo-production/commit/7aac50622a10bd12f50a1daf20145f68c931bef7))
* **login:** refonte plus luxe/pro - couleurs brand sereo animees subtilement ([d3a11af](https://github.com/tombague160-maker/sereo-production/commit/d3a11af149535a87bb383bd54dede71fda35e94f))

## [1.6.0](https://github.com/tombague160-maker/sereo-production/compare/v1.5.0...v1.6.0) (2026-05-14)


### ✨ Nouvelles fonctionnalités

* **ui:** version chip + modal "Quoi de neuf ?" + refonte login ([afe2a2b](https://github.com/tombague160-maker/sereo-production/commit/afe2a2b55715b2ded32856625d7be5a9d6be2c5b))
* **ui:** version chip + modal release notes + refonte login + fix singulier ([5286675](https://github.com/tombague160-maker/sereo-production/commit/5286675bc85474b03995c00afe154aea1cf7045d))

## [1.5.0](https://github.com/tombague160-maker/sereo-production/compare/v1.4.0...v1.5.0) (2026-05-14)


### ✨ Nouvelles fonctionnalités

* **workflow:** state machine pour les transitions de status de commande ([5880b84](https://github.com/tombague160-maker/sereo-production/commit/5880b84cee5768c54c6f9888a61ea1846224c1b1))
* **workflow:** state machine pour les transitions de status de commande ([919b3d2](https://github.com/tombague160-maker/sereo-production/commit/919b3d2bff8ee1fad1963afd81faa0ea5ff9c77c))


### 🧪 Tests

* ajoute 14 tests (CSP guard + import sequentiel + multi-stops routes) ([d73fc59](https://github.com/tombague160-maker/sereo-production/commit/d73fc59bb8afddf2829b87136eecd44e97bc4b64))
* ajoute 14 tests (CSP guard + import sequentiel + multi-stops routes) ([12b5fca](https://github.com/tombague160-maker/sereo-production/commit/12b5fca98cee61fb69dc530a8de2d9089caec605))

## [1.4.0](https://github.com/tombague160-maker/sereo-production/compare/v1.3.9...v1.4.0) (2026-05-14)


### ✨ Nouvelles fonctionnalités

* **security:** rate limit /login + CI test workflow + session HMAC robuste ([9f14e41](https://github.com/tombague160-maker/sereo-production/commit/9f14e41e321f91057bc7e95c4576d02d45befd3d))
* **security:** rate limit /login + CI test workflow + session HMAC robuste ([fbe9d56](https://github.com/tombague160-maker/sereo-production/commit/fbe9d5670aac5e4273103858b9231d65f6c81559))


### 🐛 Corrections de bugs

* **theme:** boutons et badges danger lisibles en dark mode ([e4aa473](https://github.com/tombague160-maker/sereo-production/commit/e4aa473f7385e80edbe238399cf0ace57315f167))
* **theme:** boutons et badges danger lisibles en dark mode ([29969c6](https://github.com/tombague160-maker/sereo-production/commit/29969c68139d7a5add5320efaee88d685135d56f))


### 📚 Documentation

* **env:** documente les nouvelles variables auth (session secret + rate limit) ([fff1b4a](https://github.com/tombague160-maker/sereo-production/commit/fff1b4a508c5a05e70aedd51937f7976f5169c27))

## [1.3.9](https://github.com/tombague160-maker/sereo-production/compare/v1.3.8...v1.3.9) (2026-05-09)


### ♻️ Refactorisation

* **theme:** consolide 17 variables -&gt; 9 + ajoute CLAUDE.md ([ec1d68f](https://github.com/tombague160-maker/sereo-production/commit/ec1d68f38c9b79301d756419743c0f9cf3914353))
* **theme:** consolide les variables de gradient/overlay (17 -&gt; 9) ([2a362ea](https://github.com/tombague160-maker/sereo-production/commit/2a362ea634a356fbafaa70db655a302749cff092))


### 📚 Documentation

* ajoute CLAUDE.md pour orienter les futurs agents IA ([aeb36f5](https://github.com/tombague160-maker/sereo-production/commit/aeb36f556718743c215c976cede095e9da55d2e0))

## [1.3.8](https://github.com/tombague160-maker/sereo-production/compare/v1.3.7...v1.3.8) (2026-05-09)


### 🐛 Corrections de bugs

* **ui:** masque la decoration sidebar grise + remplace l'icone parametres ([e9aa943](https://github.com/tombague160-maker/sereo-production/commit/e9aa94399d4aae3827dbc39b8f5f7eb3500f0087))
* **ui:** masque la sidebar-visual grise + nouvelle icone parametres ([b15f336](https://github.com/tombague160-maker/sereo-production/commit/b15f336e5cacaa8cff2666fe4d2e35d62663fe0e))

## [1.3.7](https://github.com/tombague160-maker/sereo-production/compare/v1.3.6...v1.3.7) (2026-05-09)


### 🐛 Corrections de bugs

* **theme:** externalise le script anti-FART (CSP bloquait inline) ([b1641a4](https://github.com/tombague160-maker/sereo-production/commit/b1641a4bb5f17c0ab8dfa98392357876c835ccab))
* **theme:** externalise le script anti-FART pour contourner la CSP ([3fb84b5](https://github.com/tombague160-maker/sereo-production/commit/3fb84b5cc6da026c0708456437823a1c70fcea54))

## [1.3.6](https://github.com/tombague160-maker/sereo-production/compare/v1.3.5...v1.3.6) (2026-05-09)


### 🐛 Corrections de bugs

* **theme:** renforce l'anti-FART (body bg + meta theme-color initial) ([7f82579](https://github.com/tombague160-maker/sereo-production/commit/7f8257914998325930d2760aeb08999c40a512fc))
* **theme:** renforce l'anti-FART (body bg + meta theme-color initial) ([864ff0f](https://github.com/tombague160-maker/sereo-production/commit/864ff0f64efed7c994713705243ff43dca40bcae))

## [1.3.5](https://github.com/tombague160-maker/sereo-production/compare/v1.3.4...v1.3.5) (2026-05-09)


### 🐛 Corrections de bugs

* **theme:** supprime le flash de mode sombre au reload ([33f4af3](https://github.com/tombague160-maker/sereo-production/commit/33f4af35a18c013e06815ff48f8e80addacab305))
* **theme:** supprime le flash de mode sombre au reload (FART) ([9a8d262](https://github.com/tombague160-maker/sereo-production/commit/9a8d26228216a70aff7e148922332b21218a02fb))

## [1.3.4](https://github.com/tombague160-maker/sereo-production/compare/v1.3.3...v1.3.4) (2026-05-09)


### 🐛 Corrections de bugs

* **theme:** mode d'affichage strictement par device ([37adac0](https://github.com/tombague160-maker/sereo-production/commit/37adac02511a3dd455d2a23c09e8ad37955e614f))
* **theme:** mode d'affichage strictement par device (plus de sync entre appareils) ([2575a7a](https://github.com/tombague160-maker/sereo-production/commit/2575a7ad524ebacb23d69aa937d55593bfa26b48))

## [1.3.3](https://github.com/tombague160-maker/sereo-production/compare/v1.3.2...v1.3.3) (2026-05-09)


### 🐛 Corrections de bugs

* **theme:** chrome dark mode (sidebar, topbar, tab, inputs) ([56c59fd](https://github.com/tombague160-maker/sereo-production/commit/56c59fdfae3ff503fd982d349587f2218dc12838))
* **theme:** chrome de l'app (sidebar, topbar, tab) adaptes au mode sombre ([a3cb247](https://github.com/tombague160-maker/sereo-production/commit/a3cb24741d79cac10c78da7f64b6dff9e93ac2db))

## [1.3.2](https://github.com/tombague160-maker/sereo-production/compare/v1.3.1...v1.3.2) (2026-05-09)


### 🐛 Corrections de bugs

* **theme:** corrige fonds blancs hardcodes invisibles en mode sombre ([3c10fce](https://github.com/tombague160-maker/sereo-production/commit/3c10fceb7bf37f1fd6268739667757f30449f69c))
* **theme:** corrige fonds blancs hardcodes invisibles en mode sombre ([86911f9](https://github.com/tombague160-maker/sereo-production/commit/86911f963ff3f0e331621ccfe08af3e2d4d4d9ec))

## [1.3.1](https://github.com/tombague160-maker/sereo-production/compare/v1.3.0...v1.3.1) (2026-05-09)


### 🐛 Corrections de bugs

* **theme:** defaut "light" au lieu de "auto" pendant la phase de test ([0d3de7d](https://github.com/tombague160-maker/sereo-production/commit/0d3de7d138994b1f3aba1f8242bb4ffea966ef47))
* **theme:** defaut light au lieu de auto pendant la phase de test ([fc8f69c](https://github.com/tombague160-maker/sereo-production/commit/fc8f69ca8d3c71080a8258ea4d64fc6de1f6ba46))

## [1.3.0](https://github.com/tombague160-maker/sereo-production/compare/v1.2.0...v1.3.0) (2026-05-09)


### ✨ Nouvelles fonctionnalités

* **theme:** mode sombre complet avec toggle Auto/Clair/Sombre par device ([ebbeaed](https://github.com/tombague160-maker/sereo-production/commit/ebbeaed993291140846377928d370d70797ea5b9))
* **theme:** mode sombre complet avec toggle Auto/Clair/Sombre par device ([9ac7f12](https://github.com/tombague160-maker/sereo-production/commit/9ac7f12f41cbbe3ed8252a0ad0382c0a8f60135b))

## [1.2.0](https://github.com/tombague160-maker/sereo-production/compare/v1.1.0...v1.2.0) (2026-05-08)


### ✨ Nouvelles fonctionnalités

* cache offline + UX (api SWR, redirect 401, fermeture toasts) ([e4427b8](https://github.com/tombague160-maker/sereo-production/commit/e4427b85ce7d7088bc8a385cca3e4424d9b1572d))


### 🐛 Corrections de bugs

* corrections issues de l'audit v1.1.0 ([4b9ee71](https://github.com/tombague160-maker/sereo-production/commit/4b9ee717e4f7095d961ac05b13e6f41dc501dac7))
* **docker:** retire --mount=type=cache pour compat builder legacy (sereo-updater) ([c76bd68](https://github.com/tombague160-maker/sereo-production/commit/c76bd6861ea7e54d1612f58c1f928c6f2d68f614))
* **docker:** retire --mount=type=cache pour compat builder legacy (sereo-updater) ([08e2d0e](https://github.com/tombague160-maker/sereo-production/commit/08e2d0edf64168cb34b3afaad6c3352b292a7aaa))


### 💄 Style / UI

* **a11y:** ajoute h1 cache pour la navigation lecteurs d'ecran ([4c4c871](https://github.com/tombague160-maker/sereo-production/commit/4c4c871f6b0d1b47c043ede78168b70dde6b993e))

## [1.1.0](https://github.com/tombague160-maker/sereo-production/compare/v1.0.0...v1.1.0) (2026-05-05)


### ✨ Nouvelles fonctionnalités

* prépare l'app pour la mise en production ([29ade00](https://github.com/tombague160-maker/sereo-production/commit/29ade003cad6ed6d6a76e22f8d0ab64da723b2d4))


### 🐛 Corrections de bugs

* deduplique les produits dans les imports Excel et les recommandations ([b187339](https://github.com/tombague160-maker/sereo-production/commit/b187339c895868bee18214adcfab40057c9ed7bd))
* deduplique les produits lors des imports Excel et dans les recommandations ([5feb0ba](https://github.com/tombague160-maker/sereo-production/commit/5feb0ba8139fc5215e331065160c9ec1967bc0d5))
* **import:** respecte statut facture, anti-doublon client, qty 0, vue commandes livrees ([6b01ab9](https://github.com/tombague160-maker/sereo-production/commit/6b01ab94b248fd32567142a40a5e40ebd0da85fd))
* **import:** respecte statut facture, anti-doublon client, qty 0, vue commandes livrees ([2711a4b](https://github.com/tombague160-maker/sereo-production/commit/2711a4be4138bb53e49f8c77226b51dc40674920))


### 📚 Documentation

* **agents:** ajoute agent de maintenance ([12c3b20](https://github.com/tombague160-maker/sereo-production/commit/12c3b208365102120dfbf996ed934ff7affce094))

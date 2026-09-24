# Changelog

## [1.45.0](https://github.com/tombague160-maker/sereo-production/compare/v1.44.0...v1.45.0) (2026-09-24)


### ✨ Nouvelles fonctionnalités

* **interface:** la barre latérale reste fixe au bureau ([93b3722](https://github.com/tombague160-maker/sereo-production/commit/93b372261dd0d5143ae7e6c8b127fa8f8f4a4ae0))
* **interface:** la barre latérale reste fixe au bureau ([#178](https://github.com/tombague160-maker/sereo-production/issues/178)) ([f45f008](https://github.com/tombague160-maker/sereo-production/commit/f45f0083eccce622f1da8ceaac5c63f7ad7aa72b))

## [1.44.0](https://github.com/tombague160-maker/sereo-production/compare/v1.43.0...v1.44.0) (2026-09-24)


### ✨ Nouvelles fonctionnalités

* **stock:** un stock négatif se voit au Stock et dans « À régler » ([4440fed](https://github.com/tombague160-maker/sereo-production/commit/4440fed590da9bcdb92109e297560ec00208accd))


### 🐛 Corrections de bugs

* **dates:** côté navigateur aussi, le jour est celui de Paris ([7312aa4](https://github.com/tombague160-maker/sereo-production/commit/7312aa49ab9b7a303f3e4a770db64109850173b9))
* **dates:** le jour calendaire est celui de Paris, quel que soit le fuseau du processus ([78679b0](https://github.com/tombague160-maker/sereo-production/commit/78679b0ba9b1219faaa72dd38d9e187f972d02de))
* **interface:** l'en-tete passe a la ligne au lieu de cacher « Actualiser », la barre laterale ne colle plus ([b22f4a4](https://github.com/tombague160-maker/sereo-production/commit/b22f4a49d017cd06279b5957e76e3c62e71318f2))
* **interface:** le panier colle au defilement et Tab parcourt la liste avant le bouton fixe ([3ce8609](https://github.com/tombague160-maker/sereo-production/commit/3ce860976f9e6e02319043b2ca9537fcaf100ecd))
* panier collant, ordre du clavier, Livré en retard sur stock à zéro, jour de Paris, banc stabilisé ([#176](https://github.com/tombague160-maker/sereo-production/issues/176)) ([a99be53](https://github.com/tombague160-maker/sereo-production/commit/a99be535c317c0bbee0a99b38832f6a8713f36ef))
* **stock:** tout « Livré » reprend un stock libéré ; une ligne non déduite n'est jamais rendue ([14587ff](https://github.com/tombague160-maker/sereo-production/commit/14587ff824464d41dcfc5face27a88b7a0a77419))
* **tournee:** un « Livré » en retard est accepté même sur un stock insuffisant ([b35df0b](https://github.com/tombague160-maker/sereo-production/commit/b35df0bef1ee0815e89ecc43395256c1756a436d))


### 📚 Documentation

* **design:** banc chargement-instantane stabilise (23/09) ([a21cac4](https://github.com/tombague160-maker/sereo-production/commit/a21cac477bf1be9cd98651ba92d82fefe3f69c2c))
* **design:** le jour calendaire est celui de Paris (24/09) ([8ba8aff](https://github.com/tombague160-maker/sereo-production/commit/8ba8aff41b975cc8f0ff24e8e74441695b173a11))
* **design:** Livré en retard sur un stock à zéro, et session de 12 h gardée ([19dec82](https://github.com/tombague160-maker/sereo-production/commit/19dec8252eb0e3e28a12e71019d768bf606ed601))
* **design:** panier collant et ordre du clavier (23/09) ([626bc59](https://github.com/tombague160-maker/sereo-production/commit/626bc59f48d917ebee1552c39968a92d1ec592ed))
* **design:** relecture adverse du « Livré en retard » — trois défauts, leur sort ([582a670](https://github.com/tombague160-maker/sereo-production/commit/582a6705c5d93618dca3e90c4ff458f8db4471a4))
* **design:** relecture adverse du panier collant (23/09) ([3541602](https://github.com/tombague160-maker/sereo-production/commit/35416027f779020a904ab651e63a592eb65a79f4))
* **design:** relecture du banc chargement-instantane, le prealable compte /api/operations (23/09) ([6d10f1e](https://github.com/tombague160-maker/sereo-production/commit/6d10f1e558a83126f04804d36c30ef804a74997b))


### 🧪 Tests

* **chargement-instantane:** le prealable compte /api/operations, pas toute l'API ([0c67ac8](https://github.com/tombague160-maker/sereo-production/commit/0c67ac8e26eb2ae6235d33130a7147fdbab72295))
* **chargement-instantane:** lire le prealable a l'arrivee des requetes, pas a l'instant du chiffre ([7813a28](https://github.com/tombague160-maker/sereo-production/commit/7813a2862da24ce20236f98f21054ac5a5594498))
* **stock:** le badge négatif reste entier sous un nom long ; −/+ mesurés avant le message ([558f5c7](https://github.com/tombague160-maker/sereo-production/commit/558f5c732f25e8b0f24af9f9fe05fccd9e614e35))
* **stock:** le badge négatif se mesure par ses boîtes, pas par scrollWidth ([8ca4a42](https://github.com/tombague160-maker/sereo-production/commit/8ca4a428c71ed22516f55a9f80ef5b99ec6be386))

## [1.43.0](https://github.com/tombague160-maker/sereo-production/compare/v1.42.1...v1.43.0) (2026-09-23)


### ✨ Nouvelles fonctionnalités

* **tournee:** tournées annulables, pratique au quotidien, Tournée hors ligne, calcul routier OSRM intégré ([#174](https://github.com/tombague160-maker/sereo-production/issues/174)) ([0e66cd3](https://github.com/tombague160-maker/sereo-production/commit/0e66cd32c2c3d29d0ca5fa1c4788541cba5dd95a))


### 📚 Documentation

* **design:** intégration de la vague 2 du 23/09 ([a1004ef](https://github.com/tombague160-maker/sereo-production/commit/a1004ef9b300981343ba1b65af9c757c6a03a57c))

## [1.42.1](https://github.com/tombague160-maker/sereo-production/compare/v1.42.0...v1.42.1) (2026-09-23)


### 🐛 Corrections de bugs

* **parametres:** la numérotation des bons est réservée à l'administration ([d30c543](https://github.com/tombague160-maker/sereo-production/commit/d30c543d101348dc85f995b1a33de9e4aacbda68))
* **parametres:** la numérotation des bons est réservée à l'administration ([#172](https://github.com/tombague160-maker/sereo-production/issues/172)) ([f5b5d03](https://github.com/tombague160-maker/sereo-production/commit/f5b5d035a6398f6823ee9d2693baad1611f4dff1))

## [1.42.0](https://github.com/tombague160-maker/sereo-production/compare/v1.41.1...v1.42.0) (2026-09-23)


### ✨ Nouvelles fonctionnalités

* **abonnements:** création d'un abonnement des planches 3b / 5b ([e56f703](https://github.com/tombague160-maker/sereo-production/commit/e56f703315aabf9c67f0e0415d1e6aa1de1f272c))
* **adresses:** écran « Adresses à vérifier » au bureau et au téléphone (H7) ([2e1ec0b](https://github.com/tombague160-maker/sereo-production/commit/2e1ec0b4f0ad5a8931eda4270b135c64d684c104))
* **carte:** fond de carte reglable en un seul endroit, point approximatif dit ([1fff257](https://github.com/tombague160-maker/sereo-production/commit/1fff2577d20734a4ae20b9e9f154c4e670043059))
* **clients:** l'écran Clients au téléphone (planches 9a, 8c, 12c) ([cf9e7ba](https://github.com/tombague160-maker/sereo-production/commit/cf9e7ba7896e0b506f08d8603e10158b938988a5))
* **ecrans:** Analyse, Exports, Rappels, A recommander et Commande client au style V8 ; retrait des quatre anciennes listes ([b0e7a73](https://github.com/tombague160-maker/sereo-production/commit/b0e7a73ce00c850e71872ad2f92d5fa4986cf9da))
* **tournee:** « À livrer en premier » et découpage au-delà de 50 commandes ([870ba34](https://github.com/tombague160-maker/sereo-production/commit/870ba3404133052edda98c8369f2a5aeb9eb786b))
* **tournee:** audit géo (livreur, adresses, carte, rapidité, trajet) et fin de l'interface V8 ([#170](https://github.com/tombague160-maker/sereo-production/issues/170)) ([f85d534](https://github.com/tombague160-maker/sereo-production/commit/f85d534e192d66c09fd60e32a2d53b52bc52561a))
* **tournees:** purge des tournees terminees de plus de 12 mois, position « Me localiser » a ~100 m ([1530f35](https://github.com/tombague160-maker/sereo-production/commit/1530f35a4d20df134247409e037eb9b289574e56))
* **trajet:** Or-opt, « à livrer en premier », arrêt injoignable nommé, repli OSRM ([ae34766](https://github.com/tombague160-maker/sereo-production/commit/ae347667441e9a393b935a35430e3ad9bf61bce0))


### 🐛 Corrections de bugs

* **abonnements:** « Retirer » rend le geste d'un clic sur chaque ligne du panier ([72d5402](https://github.com/tombague160-maker/sereo-production/commit/72d54023b7ba8c68a26a8d69f9ed706297ca10ec))
* **abonnements:** le nom accessible de la pilule « Mensuel » contient « Mensuel » ([307f7ad](https://github.com/tombague160-maker/sereo-production/commit/307f7ad096ca5db75c7094e94ab35fe3540fbb13))
* **abonnements:** le premier « + » du catalogue ajoute après une quantité tapée ([6eea9e2](https://github.com/tombague160-maker/sereo-production/commit/6eea9e24ed5a323838f5464d125ec32c99388324))
* **adresses:** le focus reste dans « Adresses a verifier » apres Annuler et Enregistrer ([0c0f541](https://github.com/tombague160-maker/sereo-production/commit/0c0f54124a6d10b83c44c767f1458172f97ca078))
* **adresses:** telephone, import Excel, relance et stockage JSON (relecture du lot 3) ([eee9177](https://github.com/tombague160-maker/sereo-production/commit/eee91771d68d6ad43a691efd481c7c7c6ab842ab))
* **adresses:** un seul géocodeur, positions justes et protégées (lot 3 audit géo) ([73730c0](https://github.com/tombague160-maker/sereo-production/commit/73730c06ed47d9ee0c8aae6c74b6c8a5d92cb4f0))
* **adresses:** une virgule apres le numero ne coupe plus la voie, « Bateau » n'est plus un batiment ([737a4f6](https://github.com/tombague160-maker/sereo-production/commit/737a4f63db7a795e9f8e4a8ad2695d918f7b6877))
* **carte:** le point approximatif suit les commandes creees apres le geocodage ([9bd4df3](https://github.com/tombague160-maker/sereo-production/commit/9bd4df3478d18f7b3b4973b0d80ffc56d228bba3))
* **carte:** legende cachee en preparation, fond redemande, bas de carte empile ([906addc](https://github.com/tombague160-maker/sereo-production/commit/906addce58e245972d29abccd385929a150fc339))
* **carte:** une carte utilisable au telephone (lot 4 de l'audit geo) ([b153d73](https://github.com/tombague160-maker/sereo-production/commit/b153d73da48d61c6480b3efbec3a67ba546a5e3a))
* **clients:** l'anneau clavier hors du vert se voit en sombre, au téléphone ([9e18dd3](https://github.com/tombague160-maker/sereo-production/commit/9e18dd3fdbab8185537e91a1c381d0338a29cb55))
* **clients:** revue adverse — le client d'un rappel survit au seuil, l'anneau des lignes en sombre ([1a6d372](https://github.com/tombague160-maker/sereo-production/commit/1a6d372810989029e24e4789d76a5aee3e007b8f))
* **docker:** le contexte de build exclut tout le dossier data/ ([9882871](https://github.com/tombague160-maker/sereo-production/commit/988287188a97bcff03ed9c2db6e11d2c2367362d))
* **ecrans:** plus de squelette pour les listes retirees ; recherche « Statistiques » tenue ; DESIGN.md du lot ([56a96cf](https://github.com/tombague160-maker/sereo-production/commit/56a96cff7553b7f3d711634098933b1d5b3847b8))
* **ecrans:** suites de la relecture — jour sans vente, requete orpheline, croisement avec les finitions ([b90eb60](https://github.com/tombague160-maker/sereo-production/commit/b90eb603824686ce32502dac010ff16279720e8d))
* **hors-ligne:** le livreur ne perd plus un geste, et l'écran ne recule plus ([8bd2712](https://github.com/tombague160-maker/sereo-production/commit/8bd27124db9f810317d86c0c6d8004e3830ec887))
* **hors-ligne:** un 500 passager ne bloque plus la file, un renvoi muet ne la gèle plus ([a986004](https://github.com/tombague160-maker/sereo-production/commit/a986004d46525c85af0540d0f717e15ae9ccf6a1))
* **integration:** l'anneau clavier en sombre, et l'erreur des commandes effacée par une réponse tardive ([3b32456](https://github.com/tombague160-maker/sereo-production/commit/3b32456ec9937179127cdbe4031f690bca1d5020))
* **integration:** les gestes d'arrêt gardent les garanties des lots 1 et 5 ([19f399b](https://github.com/tombague160-maker/sereo-production/commit/19f399b0f303442f2a5cf6d56793f327a1e5445f))
* **interface:** finitions de l'audit du 23/09 ([61d421f](https://github.com/tombague160-maker/sereo-production/commit/61d421f4b5c5dc14f010c19014b74c8e20493837))
* **interface:** relecture des finitions du 23/09 ([bff9ee7](https://github.com/tombague160-maker/sereo-production/commit/bff9ee747598f41198f4ce966e941ef674944849))
* **stockage:** un trace ecrit par une version d'avant gagne a la remontee ([e047248](https://github.com/tombague160-maker/sereo-production/commit/e047248d228103c54e7a6a6e18a801951ff2c22b))
* **tournee:** apres un geste d'arret, la copie du service worker suit l'ecran ([3afb59f](https://github.com/tombague160-maker/sereo-production/commit/3afb59f14fc7b8ebbf9749730d2be96ac9e08b6f))
* **tournee:** découpage — les « en premier » d'abord, rien en file hors ligne, 50 au plus sans départ ([ab51100](https://github.com/tombague160-maker/sereo-production/commit/ab51100ee00ae31832f421fb90d03ee88d9436e9))
* **tournee:** la clé d'un geste se libère à la fin du traitement, pas à la fermeture ([0394967](https://github.com/tombague160-maker/sereo-production/commit/03949678b11aae906b649bd5fd192ab1bdac030b))
* **tournees:** le trace d'une tournee d'avant le lot ne garde plus la position « Me localiser » exacte ([2bcc8b5](https://github.com/tombague160-maker/sereo-production/commit/2bcc8b54a23fa3e824080b41f5538617ac734b38))
* **tournee:** un absent revient « À reprogrammer », un geste renvoyé ne s'applique qu'une fois ([8c69372](https://github.com/tombague160-maker/sereo-production/commit/8c69372d9fb542c1e26dbc35effe019a5396e601))


### ⚡ Optimisations

* **purge:** la sauvegarde d'avant purge se fait hors du verrou d'ecriture ([49f8288](https://github.com/tombague160-maker/sereo-production/commit/49f82880e41e1daefbeda03ad55f5042a6f4b356))
* **stockage:** ecriture ciblee en base, traces des tournees hors du chemin chaud ([b0ac78d](https://github.com/tombague160-maker/sereo-production/commit/b0ac78d67128a2c050257a69e397156867716d44))
* **stockage:** l'empreinte d'une ligne se calcule en un seul update ([eb7b4ff](https://github.com/tombague160-maker/sereo-production/commit/eb7b4ff41ef2b452bb2eeccfbc6f0e31a6fa0865))
* **tournee:** apres un geste d'arret, l'ecran se met a jour avec la reponse ([ecfa25a](https://github.com/tombague160-maker/sereo-production/commit/ecfa25adf435756a7777c8934e2c24b26b1d01a6))
* **tournees:** l'index des commandes se construit une fois pour toutes les tournees ([f653011](https://github.com/tombague160-maker/sereo-production/commit/f653011686944ca4f623ca38f498f465dee04535))
* **tournees:** plafond du calcul « sans depart », cache et limite de debit du relais d'adresse ([57b4b2b](https://github.com/tombague160-maker/sereo-production/commit/57b4b2b7c571b6ff083279bf140be3e12cb66f01))


### ♻️ Refactorisation

* **carte:** un seul champ de precision, geoPrecision du lot 3 ([d4b8c10](https://github.com/tombague160-maker/sereo-production/commit/d4b8c1067ef05a37c8a2a4d5223a83a8317c3739))
* **hors-ligne:** retire une garde du renvoi que rien ne distinguait ([e424066](https://github.com/tombague160-maker/sereo-production/commit/e424066ae081f34918139d3eea4c85e99c918816))
* **trajet:** cède la résolution des adresses au lot 3 et adopte sa convention d'erreur ([1d7db43](https://github.com/tombague160-maker/sereo-production/commit/1d7db432244a955bab0ae7d7ed09b616befbd058))
* **trajet:** fail() garde son texte de main, le détail d'un refus reste sous details ([f20d1a3](https://github.com/tombague160-maker/sereo-production/commit/f20d1a35a450e8be2e83ce6b5b6e02d85ee674bd))


### 📚 Documentation

* **adresses:** exemple juste pour l'ecart « complement en tete sans virgule » ([014dd66](https://github.com/tombague160-maker/sereo-production/commit/014dd66d9aa02d859be792073a363f539f1d69b0))
* **adresses:** lot 3 de l'audit géo dans DESIGN.md, géocodeur unique documenté ([1daf3d9](https://github.com/tombague160-maker/sereo-production/commit/1daf3d96c899716ef96597f09b24abf462f7ac96))
* **adresses:** relecture adverse du lot 3 dans DESIGN.md ([0199473](https://github.com/tombague160-maker/sereo-production/commit/01994738728130437a5b9ea31d0aba51d2cc1a28))
* **design:** Clients au téléphone — le sort des cinq défauts de la revue adverse ([3a333f3](https://github.com/tombague160-maker/sereo-production/commit/3a333f3a7656a5197a4c65f4b2795d9ebb22ff5f))
* **design:** Clients au téléphone (planches 9a, 8c, 12c) ([6a9a619](https://github.com/tombague160-maker/sereo-production/commit/6a9a6193187bcaf45ba99bc4e5812bf5c53abf50))
* **design:** création d'abonnement des planches 3b / 5b ([f0cc23a](https://github.com/tombague160-maker/sereo-production/commit/f0cc23a9492f78f24e0b6d9c953a95ce414fd8ec))
* **design:** croisement avec fix/interface-finitions — resolution eprouvee sur un arbre fusionne ([a815bae](https://github.com/tombague160-maker/sereo-production/commit/a815baee390919ef754d387e39854460e8a1d905))
* **design:** intégration des lots 1, 3, 4, 5 et 7 — conflits, garanties, bancs ([0e16b19](https://github.com/tombague160-maker/sereo-production/commit/0e16b1907f0aed96ee45b7cb3c96cfe32174d416))
* **design:** integration des lots 3, 4 et 7, un seul champ geoPrecision ([092f0b8](https://github.com/tombague160-maker/sereo-production/commit/092f0b8380e2ebf768adba3f4c13729397949ff9))
* **design:** intégration des lots d'interface du 23/09 ([dc78e54](https://github.com/tombague160-maker/sereo-production/commit/dc78e54a9b146528d80e6913a4cd131753f10d82))
* **design:** l'ancien formulaire faisait « tous les mois » d'un abonnement de 2 mois ([747a855](https://github.com/tombague160-maker/sereo-production/commit/747a855425bac695588342d17b6ef9eb29e4a4aa))
* **design:** lot 1 de l'audit géo — le livreur ne perd plus rien ([1b33cdc](https://github.com/tombague160-maker/sereo-production/commit/1b33cdcc8aec68af8d49597efe91691a22390220))
* **design:** lot 4 de l'audit geo, une carte utilisable au telephone ([f7eed6d](https://github.com/tombague160-maker/sereo-production/commit/f7eed6d1a621ec01e73cdeeade495fce5a79b231))
* **design:** lot 5 de l'audit geo, rapidite — fait, mesures avant/apres, ecarts, ce qui reste ([73cc8de](https://github.com/tombague160-maker/sereo-production/commit/73cc8de03e8584d72ea748b5e2af5ccce3359fc2))
* **design:** lot 5, rapidite — revue adverse, quatre defauts corriges, ecarts nommes ([1e266c4](https://github.com/tombague160-maker/sereo-production/commit/1e266c407bb4aa84225bfcc6cee24e30dabb56e1))
* **design:** relecture adverse du lot 1 — le sort de chaque défaut ([f719e60](https://github.com/tombague160-maker/sereo-production/commit/f719e600d1a97d7fa1c2ba6e3b1f32b506d3b0ca))
* **design:** relecture adverse du lot 4 de l'audit geo, cinq defauts corriges ([2f3f29e](https://github.com/tombague160-maker/sereo-production/commit/2f3f29ee905389a4499d77fb8c809866e9926d33))
* **design:** reprise de la correction du lot 1 — chaque rouge rejoué ([089105d](https://github.com/tombague160-maker/sereo-production/commit/089105d547e7689137cecf3998b8a687566c8f2f))
* **design:** section des finitions d'interface du 23/09, et son banc ([46637aa](https://github.com/tombague160-maker/sereo-production/commit/46637aab19957a270d17e82b1dce233bed09f88e))
* **trajet:** lot 7 de l'audit géo — fait, preuves, écarts, ce qui reste ([547e558](https://github.com/tombague160-maker/sereo-production/commit/547e5582a6dd2713fa0fb0ce4b7c05c8303a3b80))
* **trajet:** revue adverse du lot 7 — six défauts, leur sort, la recette de fusion avec le lot 3 ([871c6b7](https://github.com/tombague160-maker/sereo-production/commit/871c6b72d70bb71f0be52dba2b9b7ac9e8f0dc26))


### 🧪 Tests

* **abonnements:** le banc « Entrée n'envoie pas le formulaire » compte les envois ([96adaad](https://github.com/tombague160-maker/sereo-production/commit/96adaad246b952e056db857248ca935798b3dcf5))
* **carte:** banc du lot 4 de l'audit geo, rouge sur la carte actuelle ([a7e3cab](https://github.com/tombague160-maker/sereo-production/commit/a7e3cab476c87872c4b18068ce4ea6badc129181))
* **carte:** sans commande prete, aucun client de la base n'est dessine ([615d498](https://github.com/tombague160-maker/sereo-production/commit/615d498e0531ff2c662136d6cffd4ea518d4d18c))
* **clients:** la rangée Rappels / synchro et le statut en pleine largeur, au téléphone ([8f88f69](https://github.com/tombague160-maker/sereo-production/commit/8f88f69fefa8a239a8eda859ccf99a40a94eb66d))
* **design:** la section du lot doit exister, pas être la dernière ([ccd7440](https://github.com/tombague160-maker/sereo-production/commit/ccd744004487689ce109ebcfdc60c2254e65aec1))
* **e2e:** chaque banc de rapidite vise l'arret de l'ecran et tient seul ([9afeea3](https://github.com/tombague160-maker/sereo-production/commit/9afeea361c366d5dcc3c0956676a998e23480d38))
* **e2e:** la case « en premier » existe avant d'être jugée cachée ([5d6fe23](https://github.com/tombague160-maker/sereo-production/commit/5d6fe23887a1f71052ad83f23eeeefc53c3e014c))
* **e2e:** le banc « Me localiser » termine lui-meme la tournee en cours ([a99242c](https://github.com/tombague160-maker/sereo-production/commit/a99242c41dba0c85b62e46808ae4768d300f228f))
* **e2e:** le semé des bancs ne fuit plus d'un banc à l'autre — cause de meilleur-trajet:45 ([18f299c](https://github.com/tombague160-maker/sereo-production/commit/18f299ca71200011d923c88d2a207707a52cde75))
* **e2e:** un serveur semé refuse un port déjà pris au lieu de parler à un autre ([f1fd819](https://github.com/tombague160-maker/sereo-production/commit/f1fd819fd5737d9f4b6656bc8eb25ba8c27549b9))
* **ecrans:** banc des ecrans sans planche au style V8 (rouge attendu) ([52499de](https://github.com/tombague160-maker/sereo-production/commit/52499de316261f3d824593438a0849714bc1f7b9))
* **hors-ligne:** banc du « Livré » dont la réponse casse, soldé par le geste suivant ([21812dd](https://github.com/tombague160-maker/sereo-production/commit/21812dd0452f18736049ce337aabdb162de3ad4a))
* **interface:** le banc du defilement rend aux tuiles leur lenteur ([4340643](https://github.com/tombague160-maker/sereo-production/commit/4340643e0048d0befed7fd893968019a916313f3))
* **interface:** le banc du défilement retient `load` par le logo, plus par les tuiles ([2e728e1](https://github.com/tombague160-maker/sereo-production/commit/2e728e169ed6a78fc6ac3f592e89ef41cd359182))
* **lot5:** le banc de migration tolere une base sans table des traces ([c013e91](https://github.com/tombague160-maker/sereo-production/commit/c013e91485205a5fe5c759203f4ec0ec4eee57d4))
* **lot5:** le journal des ecritures ne pose ses declencheurs que sur les tables presentes ([fa8b4f7](https://github.com/tombague160-maker/sereo-production/commit/fa8b4f7ff441952da0758bb38cbe34714fd86aa5))
* **trajet:** la matrice aberrante reproduit le cas qui figeait la descente ([a6b5b08](https://github.com/tombague160-maker/sereo-production/commit/a6b5b08282814bad635b859001fefeaecad87db6))
* **trajet:** le banc du géocodeur reproduit le cas de l'audit (seule la première adresse échoue) ([bc5b3a2](https://github.com/tombague160-maker/sereo-production/commit/bc5b3a2b29baa0952ff5972c229b41e848319826))
* **trajet:** les bancs du découpage jugent le regroupement par direction ([ad63e63](https://github.com/tombague160-maker/sereo-production/commit/ad63e6367e0d3d01f64e0970ab940c1ef9ae6ba3))
* **trajet:** les rouges du banc serveur disent leur cause (assertion, pas un plantage) ([cafc299](https://github.com/tombague160-maker/sereo-production/commit/cafc2990f26a3746a4eed695e7c77ed494c78acc))

## [1.41.1](https://github.com/tombague160-maker/sereo-production/compare/v1.41.0...v1.41.1) (2026-09-23)


### 🐛 Corrections de bugs

* **e2e:** operations attend les commandes chargées avant « Tout sélectionner » ([710017a](https://github.com/tombague160-maker/sereo-production/commit/710017a70d7d4a2ce7bcfe7acbc34905ccf1e237))
* **tournee:** « Tout sélectionner » attend les commandes ; deux bancs instables guéris par la cause ([#168](https://github.com/tombague160-maker/sereo-production/issues/168)) ([b2522a5](https://github.com/tombague160-maker/sereo-production/commit/b2522a5e3ca66cf3ab9bc4fe654565850b361cf9))
* **tournee:** « Tout sélectionner » attend les commandes au lieu d'un faux état vide ([b0e7e37](https://github.com/tombague160-maker/sereo-production/commit/b0e7e373a752a8b36256aee609f84a646e07166c))


### 📚 Documentation

* **design:** les bancs instables du 23/09 — cause, preuves, ce qui reste ouvert ([08b52b2](https://github.com/tombague160-maker/sereo-production/commit/08b52b2ec97699284193c6f01baf0c6e4de21441))

## [1.41.0](https://github.com/tombague160-maker/sereo-production/compare/v1.40.2...v1.41.0) (2026-09-23)


### ✨ Nouvelles fonctionnalités

* **mobile:** Abonnements au telephone (planches 3a, 3c, 5a) ([33be2c1](https://github.com/tombague160-maker/sereo-production/commit/33be2c1f0a5fd16f198ccf583f13cc691935969c))
* **mobile:** Commandes et Stock au telephone, squelettes a la taille des chiffres ([e2dcbae](https://github.com/tombague160-maker/sereo-production/commit/e2dcbae4457a85d53d11ba2c7d4a2545cc032b0b))
* **mobile:** Parametres au telephone (planches 8d/12d) ([7585efa](https://github.com/tombague160-maker/sereo-production/commit/7585efa75ea80af349d39930e645a9f354b350b0))
* **mobile:** Preparation en liste unique, filtres dans l'en-tete vert, detail en page (planches 7a, 7b) ([c48f2fd](https://github.com/tombague160-maker/sereo-production/commit/c48f2fdaec06d74d143ce0e0fbb8e24cb1e2ffcf))
* **mobile:** tournee au telephone -- cockpit, carte, preparer, fin (planches 4a-4d) ([edfcd01](https://github.com/tombague160-maker/sereo-production/commit/edfcd011c69f7dd747b998af9272fdac35e06e07))
* **mobile:** Tournée, Préparation, Abonnements, Paramètres, Commandes et Stock au téléphone ; chargement instantané ([#166](https://github.com/tombague160-maker/sereo-production/issues/166)) ([b28455d](https://github.com/tombague160-maker/sereo-production/commit/b28455d7774f930f325bc5ad0b6a46ac4922e678))


### 🐛 Corrections de bugs

* **css:** rend leurs accolades aux blocs des lots mobiles mutilés par la fusion ([e0e8f74](https://github.com/tombague160-maker/sereo-production/commit/e0e8f7499cf599c590fa1b1bbafb82230969681e))
* **mobile:** Abonnements -- relecture adverse du lot ([ba10b4d](https://github.com/tombague160-maker/sereo-production/commit/ba10b4d6c1f4bf1e8e9edd7cb481f3804e604d3a))
* **mobile:** Preparation, la recherche ne filtre jamais sans se voir ; sous-titre au telephone seulement ([8841c69](https://github.com/tombague160-maker/sereo-production/commit/8841c6962cd0a089e4ddbca9a2d8f0b828bf55da))
* **mobile:** tournee -- corrections de la revue adverse du 23/09 ([a93072d](https://github.com/tombague160-maker/sereo-production/commit/a93072d6d5f1583dbf20aeaa1e324be756a67cd5))
* **parametres:** corrige quatre défauts de la relecture du lot téléphone ([51836c1](https://github.com/tombague160-maker/sereo-production/commit/51836c1cd15669b1ce1695a3b57eabd8d85ae609))
* **service-worker:** le nom du shell porte l'empreinte du contenu statique ([64ff245](https://github.com/tombague160-maker/sereo-production/commit/64ff245f5fd536aa9eb8449376215bdb0f406120))
* **squelettes:** lignes grises a la hauteur des cartes de 821 a 1280 px, le libelle « Commandes livrees » survit a une erreur ([efef943](https://github.com/tombague160-maker/sereo-production/commit/efef9432a38048917a7f1bd8aab82ce810abef0e))
* **stock:** l'ordre a plat ne bouge plus sous le doigt, la carte dit ce qui se voit ([5ff7260](https://github.com/tombague160-maker/sereo-production/commit/5ff7260e1cde84590012d82686d4ab0363e3cce6))


### ⚡ Optimisations

* **chargement:** ouverture instantanee -- statique en cache d'abord, dernieres donnees affichees avant le reseau ([3eacfb3](https://github.com/tombague160-maker/sereo-production/commit/3eacfb3cb57b40c9b1e539c00dd012264bcc199d))


### 📚 Documentation

* **design:** chargement instantane -- decisions, ecarts et mesure avant/apres ([b400ee3](https://github.com/tombague160-maker/sereo-production/commit/b400ee3d9f9363665ddc536f94452cbaafa2ffd5))
* **design:** corrections de la relecture du lot Commandes + Stock mobile ([f409a2d](https://github.com/tombague160-maker/sereo-production/commit/f409a2dd030f768caecb5d972d4be6c864185360))
* **design:** le CACHE_NAME des lots mobiles est réglé par l'empreinte du shell ([019788c](https://github.com/tombague160-maker/sereo-production/commit/019788c4f3a2b9dfe097c8bb4be608e9020fb90d))
* **design:** Paramètres au téléphone, corrections de la relecture ([14c7569](https://github.com/tombague160-maker/sereo-production/commit/14c756995e0aa68fd73afe4d58653701c3278d3b))


### 🧪 Tests

* **chargement:** les polices utilisees se mesurent sans les prechargements ([ecb55e5](https://github.com/tombague160-maker/sereo-production/commit/ecb55e53ad85ec1aeb248b5f506c550a7081f606))
* **mobile:** la page 7b rougit sur son cadre, pas sur un element absent ([194bc34](https://github.com/tombague160-maker/sereo-production/commit/194bc34b519477836349177ffebd870db4bf2f29))
* **mobile:** le franchissement de 820 px ne depend plus du cas qui ecrit ([c199c1d](https://github.com/tombague160-maker/sereo-production/commit/c199c1d676df4855299f85402f4a5bea17bb208d))
* **mobile:** les pilules se rangent cachees en passant sous 820 px, et la choisie suit la planche en sombre ([498e663](https://github.com/tombague160-maker/sereo-production/commit/498e66319b7613aa1d5f904d1adb4721f9bbf9db))
* **mobile:** temoin des noms sur une ligne dans le banc des 96 px ([137e909](https://github.com/tombague160-maker/sereo-production/commit/137e9096581026a0c6b9e505a13bdc9236939eb4))

## [1.40.2](https://github.com/tombague160-maker/sereo-production/compare/v1.40.1...v1.40.2) (2026-09-23)


### 🐛 Corrections de bugs

* **tournee:** en sombre, le bandeau de la tournée est vert profond ([#163](https://github.com/tombague160-maker/sereo-production/issues/163)) ([8450465](https://github.com/tombague160-maker/sereo-production/commit/845046542864f0c711876d4b030e9e8b1c09dc25))

## [1.40.1](https://github.com/tombague160-maker/sereo-production/compare/v1.40.0...v1.40.1) (2026-09-23)


### 🐛 Corrections de bugs

* **deps:** npm audit fix — multer 2.4, express 4.22.3, fflate 0.8.3, xmldom 0.9.12, body-parser, qs (0 vulnérabilité) ([68c198b](https://github.com/tombague160-maker/sereo-production/commit/68c198bec402dfd5260bddd65ac15f2a26a49fca))
* **deps:** npm audit fix, 0 vulnérabilité ([#161](https://github.com/tombague160-maker/sereo-production/issues/161)) ([fbd9516](https://github.com/tombague160-maker/sereo-production/commit/fbd9516a3262da55a418b9545315360d8d9dd2df))

## [1.40.0](https://github.com/tombague160-maker/sereo-production/compare/v1.39.0...v1.40.0) (2026-09-23)


### ✨ Nouvelles fonctionnalités

* **etats:** bandeau hors ligne (depuis quand, ce qui attend) et carte de premier lancement (planches 10b, 10c) ([b64ca30](https://github.com/tombague160-maker/sereo-production/commit/b64ca3007f6dd442e045471cba6f8d9636d3a94d))
* **etats:** bandeau hors ligne et carte de premier lancement ([#160](https://github.com/tombague160-maker/sereo-production/issues/160)) ([e383146](https://github.com/tombague160-maker/sereo-production/commit/e3831460444670f3a2f44ced22d96b83963b4172))


### 🧪 Tests

* **tdb:** le banc vise le bouton d'import de l'en-tête (la carte de premier lancement en porte un second) ([8cda32a](https://github.com/tombague160-maker/sereo-production/commit/8cda32a02170cf9e11c6c0b88de214b82475c793))

## [1.39.0](https://github.com/tombague160-maker/sereo-production/compare/v1.38.1...v1.39.0) (2026-09-23)


### ✨ Nouvelles fonctionnalités

* **mobile:** Clients — la liste, puis la fiche en plein écran avec retour, Itinéraire (planches 9a, 8c) ([3485d98](https://github.com/tombague160-maker/sereo-production/commit/3485d981e2d2cc095e2f98833ddf08dafe5121dd))
* **mobile:** Commandes — la ligne de 72 px de la planche 8a (date en colonne, client, numéro · secteur) ([627d406](https://github.com/tombague160-maker/sereo-production/commit/627d406f7c2bdce7acfeb25c338917d13e3e97e8))
* **mobile:** le cadre des planches — en-tête vert, barre basse pleine largeur, menu « Plus » à cinq destinations, marges ([c113c92](https://github.com/tombague160-maker/sereo-production/commit/c113c92dc2ef40d9488d8a08fb539feb6ba656aa))
* **mobile:** le cadre des planches, Clients, Commandes, tableau de bord, Stock, Paramètres ([#158](https://github.com/tombague160-maker/sereo-production/issues/158)) ([a4f9d1b](https://github.com/tombague160-maker/sereo-production/commit/a4f9d1b9961f59105822d2da5e728bc4663d9db7))
* **mobile:** tableau de bord, stock et paramètres aux mesures des planches 1b, 8b, 8d ([0cd1ea6](https://github.com/tombague160-maker/sereo-production/commit/0cd1ea620130497f89a418a0aac31be9a6e561cc))


### 🐛 Corrections de bugs

* **mobile:** relecture — focus visible (barre basse, recherches, retour), onglet actif marqué, libellés sans chevauchement, retour du téléphone, nouvelle fiche ouverte ([3ed035a](https://github.com/tombague160-maker/sereo-production/commit/3ed035a692426082507d461e723a3bfa5432a7ca))

## [1.38.1](https://github.com/tombague160-maker/sereo-production/compare/v1.38.0...v1.38.1) (2026-09-23)


### 🐛 Corrections de bugs

* **mobile:** Stock atteignable au téléphone par le menu « Plus », et un banc pour chaque entrée ([56a4209](https://github.com/tombague160-maker/sereo-production/commit/56a4209ed6fe302009e02ae9325b7f2943e5d039))


### ⚡ Optimisations

* compression des réponses, et les écrans décrochés ne se dessinent plus (-72 % du DOM sur 2 000 commandes) ([1962157](https://github.com/tombague160-maker/sereo-production/commit/1962157fbf7ff02b4125a0fe58c884a0c2557e4d))
* écrans décrochés non dessinés, compression ; mobile : Stock atteignable ([#156](https://github.com/tombague160-maker/sereo-production/issues/156)) ([c99cafd](https://github.com/tombague160-maker/sereo-production/commit/c99cafd13bd2a25d691a3c4e07c2c96e135fbfcb))

## [1.38.0](https://github.com/tombague160-maker/sereo-production/compare/v1.37.0...v1.38.0) (2026-09-23)


### ✨ Nouvelles fonctionnalités

* **connexion:** la page des planches 9b/9c/9d — carte, marque, afficher le mot de passe, échec lié au champ, polices avant la session ([27574e1](https://github.com/tombague160-maker/sereo-production/commit/27574e18b05689bf96f6572bc64d445ea8e6cd0a))
* Paramètres et page de connexion des planches V8 ([#154](https://github.com/tombague160-maker/sereo-production/issues/154)) ([c6f9c04](https://github.com/tombague160-maker/sereo-production/commit/c6f9c045a64a67780c4322f6319afe1280b1269c))
* **parametres:** l'écran des planches 13f/14f — grille de cartes, thème, secteurs, numérotation des bons ([71cb59c](https://github.com/tombague160-maker/sereo-production/commit/71cb59cd1f5dcd448ed18eab471977bfd43b0f62))


### 🐛 Corrections de bugs

* **connexion:** relecture — le banc des polices exige une police, pied sur son fond, mot de passe remasqué, aria-invalid ([fa73316](https://github.com/tombague160-maker/sereo-production/commit/fa73316196f5d2e103a32c11e845bcc802a39a89))
* **parametres:** la fiche des secteurs passe à la ligne dans sa carte étroite ([969250d](https://github.com/tombague160-maker/sereo-production/commit/969250da3891124dadd82ca6ec418a417f3c8a18))
* **parametres:** relecture — le vrai prochain numéro, anneau de focus du thème, contour d'alerte en sombre, tableaux pleine largeur, libellés ([2061a71](https://github.com/tombague160-maker/sereo-production/commit/2061a7134c9eb2357b5849d52e2a27de3cbff60d))


### 📚 Documentation

* **parametres:** écarts nommés, la réserve sur la numérotation ([3936636](https://github.com/tombague160-maker/sereo-production/commit/3936636e3d8e946f77d5064fc508cbc52b4df783))

## [1.37.0](https://github.com/tombague160-maker/sereo-production/compare/v1.36.0...v1.37.0) (2026-09-23)


### ✨ Nouvelles fonctionnalités

* Abonnements et Tournée des planches V8 ([#152](https://github.com/tombague160-maker/sereo-production/issues/152)) ([5fe2d9d](https://github.com/tombague160-maker/sereo-production/commit/5fe2d9d78c6df84f11b12cbb84eadb71101ea5c8))
* **abonnements:** l'écran des planches 13a/14a — tableau, « Les 90 jours », filtres, tri ([fa0133e](https://github.com/tombague160-maker/sereo-production/commit/fa0133ed21bb82d2dff624ffb1290018ef7f42cc))
* **tournee:** l'écran des planches 13b/14b au bureau — carte à gauche, tournée à droite, titre de page ([79e1204](https://github.com/tombague160-maker/sereo-production/commit/79e1204259f52546ba665b22462fc010ec80d70a))


### 🐛 Corrections de bugs

* **abonnements:** relecture — agenda ouvert sur le retard puis cette semaine, rappel, retard aligné au tableau de bord, 1439 px ([2633ac2](https://github.com/tombague160-maker/sereo-production/commit/2633ac2b03f3bd35935ce199e5d4b0943fea5fa9))
* **tournee:** relecture — boutons d'en-tête au bureau seulement, titre générique sans tournée, carte à sa hauteur, « livraison » retrouvé ([a5a3509](https://github.com/tombague160-maker/sereo-production/commit/a5a3509294beabb5c010f628f64cdaafce24078d))


### 📚 Documentation

* **abonnements:** l'agenda s'ouvre sur le présent, une définition du retard ([7dff97e](https://github.com/tombague160-maker/sereo-production/commit/7dff97ef4903793af4a29b3904782ebecdfc41f1))
* **abonnements:** la section des planches 13a/14a ([5f7e5ca](https://github.com/tombague160-maker/sereo-production/commit/5f7e5cac2068e8adcc46753ad8d2f10fe725e64a))


### 🧪 Tests

* **a11y:** chaque écran a un nom accessible, par aria-labelledby ou aria-label — dix écrans ([9f176d4](https://github.com/tombague160-maker/sereo-production/commit/9f176d464049a708ac702c2f58a7fff7e1215a14))
* **abonnements:** tri distingué, règles 921-1280 séparées du téléphone ([8666ff7](https://github.com/tombague160-maker/sereo-production/commit/8666ff798a3786655c913a9b28b748ee886f0b35))

## [1.36.0](https://github.com/tombague160-maker/sereo-production/compare/v1.35.0...v1.36.0) (2026-09-22)


### ✨ Nouvelles fonctionnalités

* **clients:** l'écran des planches 13e/14e — liste, fiche, abonnement, commandes ([b075d93](https://github.com/tombague160-maker/sereo-production/commit/b075d933720977b247fd4a86a053806426dd5f3c))
* Commandes, Stock et Clients des planches V8 ([#150](https://github.com/tombague160-maker/sereo-production/issues/150)) ([586d022](https://github.com/tombague160-maker/sereo-production/commit/586d022b7c5528dcc42e8233bc6cb379d14b1bd6))
* **commandes:** l'écran unique des planches 13c/14c ([39db2c2](https://github.com/tombague160-maker/sereo-production/commit/39db2c2ad2569835e6ba02aa75a06f0bcc250599))
* **stock:** l'écran des planches 13d/14d — carte « À recommander », tuiles, tableau ([902b45c](https://github.com/tombague160-maker/sereo-production/commit/902b45c15a34dc120541197c3718e7b789f7d11e))


### 🐛 Corrections de bugs

* **clients:** relecture — Modifier répercute sur les commandes, archivés exclus, « Les N autres » par identifiant, 409 dans le dialogue, a11y, 1320 px ([5c4ee07](https://github.com/tombague160-maker/sereo-production/commit/5c4ee0759f6045d4885d3ca40188507d05ec3c18))
* **commandes:** seconde relecture — détail, redirections, secteur, période, focus, ports e2e ([7ae92cf](https://github.com/tombague160-maker/sereo-production/commit/7ae92cf98ad7ee84b170d1578c6c04bec203d0ca))
* **stock:** relecture — « Sans catégorie » filtre, « Tout voir » aligné, 921-1280 px, focus, champ vide ([81e8ad6](https://github.com/tombague160-maker/sereo-production/commit/81e8ad6741373497baa89e4d61066eb78a7736df))


### 🧪 Tests

* **clients:** « Les N autres » sous un filtre laissé, fiche pleine largeur au téléphone ([5fef3e0](https://github.com/tombague160-maker/sereo-production/commit/5fef3e0d57b34e2d7c2752e4c2467f94fe8a53f9))
* **clients:** le débordement se mesure à 1190 px, la largeur la plus étroite à deux colonnes ([68adf20](https://github.com/tombague160-maker/sereo-production/commit/68adf200930dec7e13e9adf59933efef103b8e2e))
* **commandes:** le débordement mobile se mesure au bord, pas au scrollWidth ([71a2145](https://github.com/tombague160-maker/sereo-production/commit/71a2145733fb5dfa031c949c12a9b089f4c1a6f8))
* **e2e:** le navigateur de test vit à Paris, comme le serveur et les utilisateurs ([3ffea7e](https://github.com/tombague160-maker/sereo-production/commit/3ffea7e0dcdcd7755dfd86c959003da79a2e46e4))

## [1.35.0](https://github.com/tombague160-maker/sereo-production/compare/v1.34.0...v1.35.0) (2026-09-22)


### ✨ Nouvelles fonctionnalités

* **v8:** le tableau de bord des planches 6a/6b, sans barre du haut ([056f475](https://github.com/tombague160-maker/sereo-production/commit/056f475ec2eb522e72adef037441a5177e87084d))

## [1.34.0](https://github.com/tombague160-maker/sereo-production/compare/v1.33.0...v1.34.0) (2026-09-22)


### ✨ Nouvelles fonctionnalités

* **v8:** la barre laterale des planches -- huit entrees plates ([19fa441](https://github.com/tombague160-maker/sereo-production/commit/19fa441a59222a04a2a6f0141b728dd9e792a3f4))
* **v8:** la barre latérale des planches — huit entrées plates ([8658c0e](https://github.com/tombague160-maker/sereo-production/commit/8658c0eddce0bbe003d7b1768925fdce3d4505db))


### 🐛 Corrections de bugs

* **v8:** les finitions de la barre laterale, avant publication ([5c164d3](https://github.com/tombague160-maker/sereo-production/commit/5c164d38f421f75c3dce20924c823fbcf64c730f))

## [1.33.0](https://github.com/tombague160-maker/sereo-production/compare/v1.32.0...v1.33.0) (2026-09-19)


### ✨ Nouvelles fonctionnalités

* **v8:** des pilules de filtre repliables -- le dernier non-juge du §4 ([c9ad1ce](https://github.com/tombague160-maker/sereo-production/commit/c9ad1ce456d38ae8d0133b30d35671d45b743f7a))
* **v8:** l'ecran du livreur -- la planche Main.png, enfin ([d8dd403](https://github.com/tombague160-maker/sereo-production/commit/d8dd403fbbd9434bbf9c183adb3df9ad23c47229))
* **v8:** le marqueur de carte et la ligne d'arret -- deux regles enfin jugees ([6fc8bae](https://github.com/tombague160-maker/sereo-production/commit/6fc8bae4f12796ea124a7bd2a3bc55cc5366c396))
* **v8:** le tableau de bord -- la sixieme et derniere planche ([9bd7d94](https://github.com/tombague160-maker/sereo-production/commit/9bd7d946ad152d9e1b01289ab14bc688c0f27286))
* **v8:** une ligne par abonnement -- la troisieme liste de la charte ([650c03b](https://github.com/tombague160-maker/sereo-production/commit/650c03bbd5e40841f904713640a418cacf902f62))
* **v8:** une ligne par commande -- la planche Preparation.png ([4792738](https://github.com/tombague160-maker/sereo-production/commit/47927389bea4e04d154abd1ece8098e78b72543f))


### 📚 Documentation

* **charte:** le marqueur et la ligne d'arret -- deux non-juges deviennent des mesures ([db70b0a](https://github.com/tombague160-maker/sereo-production/commit/db70b0a6f0d5524a7dd09076d7c9f041175aa9ca))

## [1.32.0](https://github.com/tombague160-maker/sereo-production/compare/v1.31.0...v1.32.0) (2026-09-19)


### ✨ Nouvelles fonctionnalités

* **v8:** la FORME du §4 -- l'interface ressemble enfin a ce qui a ete decide ([353c304](https://github.com/tombague160-maker/sereo-production/commit/353c3042483b3e15b052c1cecda0601fa77b47fb))
* **v8:** la police de la charte, posee -- et les onze textes qu'elle a coupes ([22a12dd](https://github.com/tombague160-maker/sereo-production/commit/22a12ddc39c99677e947b95a205f0232293da771))
* **v8:** le toast a 4 s et les pilules de filtre en pilules -- le §4 est tenu ([4089771](https://github.com/tombague160-maker/sereo-production/commit/408977109e936840f9d6b2bba60713536949b47b))


### 🐛 Corrections de bugs

* **v8:** l'anneau de focus clavier, et un commentaire qui a tenu lieu de mesure ([41124ab](https://github.com/tombague160-maker/sereo-production/commit/41124ab0d81fd52c0dc73ad73e199099e358f94f))
* **v8:** les trois oranges pour un seul role -- soldes, sauf un, et il est nomme ([a27b613](https://github.com/tombague160-maker/sereo-production/commit/a27b61361621f232b12f82664a9b19b9175e67e8))

## [1.31.0](https://github.com/tombague160-maker/sereo-production/compare/v1.30.0...v1.31.0) (2026-09-18)


### ✨ Nouvelles fonctionnalités

* **v8:** le motif d'un arret en echec, et une ligne de la charte qui etait fausse ([a778cc7](https://github.com/tombague160-maker/sereo-production/commit/a778cc736219e97373556e5876f6476cc6433d36))
* **v8:** phase 5 -- la file d'attente hors ligne, et ce qu'elle a revele ([be97c51](https://github.com/tombague160-maker/sereo-production/commit/be97c514f83d0df5211bfc4ffb2234df9f721f6f))


### 🐛 Corrections de bugs

* **v8:** la page de connexion, le seul ecran que rien ne regardait ([b7a5124](https://github.com/tombague160-maker/sereo-production/commit/b7a51248ef38912e4fb433df20e4c80aa5d45343))
* **v8:** les grands rayons, et la QUATRIEME regle scopee a un seul mode ([0f36eda](https://github.com/tombague160-maker/sereo-production/commit/0f36edacac94f2403f1b8ef1e8974ef0f49bb352))
* **v8:** trois cecites de l'instrument de contraste, et les defauts qu'elles cachaient ([bea02a8](https://github.com/tombague160-maker/sereo-production/commit/bea02a843c11df925d3cd588694c4593abbd72a2))

## [1.30.0](https://github.com/tombague160-maker/sereo-production/compare/v1.29.0...v1.30.0) (2026-09-18)


### ✨ Nouvelles fonctionnalités

* **v8:** phase 4, marche 4d -- les badges de statut a 24 px, comme la charte le dit ([5c38f04](https://github.com/tombague160-maker/sereo-production/commit/5c38f0429c6cfb0a79aff5d360799da621131198))

## [1.29.0](https://github.com/tombague160-maker/sereo-production/compare/v1.28.0...v1.29.0) (2026-09-18)


### ✨ Nouvelles fonctionnalités

* **v8:** phase 4, marche 4c -- les etats vides offrent leur sortie, et retrouvent leurs accents ([bedf102](https://github.com/tombague160-maker/sereo-production/commit/bedf10259c624dd449b63416076341374c708700))

## [1.28.0](https://github.com/tombague160-maker/sereo-production/compare/v1.27.0...v1.28.0) (2026-09-18)


### ✨ Nouvelles fonctionnalités

* **v8:** phase 4, marche 4b -- le squelette de chargement que la charte prevoyait ([2ecc672](https://github.com/tombague160-maker/sereo-production/commit/2ecc672ca560e2eef61f75b39d70260b48e73469))

## [1.27.0](https://github.com/tombague160-maker/sereo-production/compare/v1.26.2...v1.27.0) (2026-09-18)


### ✨ Nouvelles fonctionnalités

* **v8:** phase 4, marche 4a -- la barre basse mobile applique la decision de Tom ([b16d980](https://github.com/tombague160-maker/sereo-production/commit/b16d9804440b3b942d60f717f258f9ae4381fc9f))


### 📚 Documentation

* **changelog:** crediter la PR 96 dans la 1.26.2 ([26c4f8f](https://github.com/tombague160-maker/sereo-production/commit/26c4f8fa8d17b9f644a9c2221f6ebc9577c98c33))
* **changelog:** crediter la PR 96 dans la 1.26.2 ([51544c7](https://github.com/tombague160-maker/sereo-production/commit/51544c781d83c2f5d995b42d94bd2ce5f81ad39a))

## [1.26.2](https://github.com/tombague160-maker/sereo-production/compare/v1.26.1...v1.26.2) (2026-09-18)


### ✨ Fonctionnalités

* tableau de bord simplifié, abonnements et tournées routières ([7d93ceb](https://github.com/tombague160-maker/sereo-production/commit/7d93ceb)) — travail de @tombague160-maker, PR #96, repris sur `main` 56 commits plus tard et porté sur les jetons V8 (PR #113). Chiffre d'affaires livré et panier moyen sur le mois choisi ; abonnements avec calendrier hebdomadaire, pause/reprise et création idempotente d'une commande planifiée par échéance ; tournée avec départ géolocalisé, matrice de temps OSRM et tracé routier.

  *Ajouté à la main : release-please n'a pas retenu ce `feat:` parce qu'il est arrivé par un commit de fusion, et la 1.26.2 ne créditait que l'optimisation des tests. Le code était bien livré ; c'est le journal qui sous-déclarait.*

### ⚡ Optimisations

* **tests:** le balayage de contraste passe d'une heure a quatre minutes ([18df0c5](https://github.com/tombague160-maker/sereo-production/commit/18df0c5e91f1fc60ea47e33e8d61d0adc00a34cd))

## [1.26.1](https://github.com/tombague160-maker/sereo-production/compare/v1.26.0...v1.26.1) (2026-09-17)


### 🐛 Corrections de bugs

* **tests:** le profil "mobile" n'emulait pas un doigt, et un checkout rendait le garde rouge ([bd9ec0a](https://github.com/tombague160-maker/sereo-production/commit/bd9ec0aee9fc4b01ca2d1818c2050f57d57a98b3))

## [1.26.0](https://github.com/tombague160-maker/sereo-production/compare/v1.25.1...v1.26.0) (2026-09-17)


### ✨ Nouvelles fonctionnalités

* **v8:** mesurer les cibles tactiles sur L'APPLICATION, et lever la reserve ([9ff2999](https://github.com/tombague160-maker/sereo-production/commit/9ff29993d814d7a235d9a1cbd1ca611298945e6c))
* **v8:** phase 4, marche 3b -- zero couleur litterale, et le role que la charte oubliait ([c304105](https://github.com/tombague160-maker/sereo-production/commit/c3041052c1c53c5caae37ef21bde8d41f4813ce1))

## [1.25.1](https://github.com/tombague160-maker/sereo-production/compare/v1.25.0...v1.25.1) (2026-09-17)


### 📚 Documentation

* **v8:** phase 4, marches 1 et 2 closes ([0d811eb](https://github.com/tombague160-maker/sereo-production/commit/0d811ebf929ca09c13590cfaf4bf056cdb75e178))
* **v8:** phase 4, marches 1 et 2 closes, les trois suivantes nommees ([295cefa](https://github.com/tombague160-maker/sereo-production/commit/295cefa7b3a454761aab2cf7a370b1d6576649a9))

## [1.25.0](https://github.com/tombague160-maker/sereo-production/compare/v1.24.1...v1.25.0) (2026-09-17)


### ✨ Nouvelles fonctionnalités

* **v8:** phase 4, marche 1 -- le socle de jetons, et la palette sombre completee ([1623ab4](https://github.com/tombague160-maker/sereo-production/commit/1623ab4200a65d1da492acd03778e61944fe30ee))
* **v8:** phase 4, marche 2 -- l'application parle V8, et 1164 textes le prouvent ([a1ea65a](https://github.com/tombague160-maker/sereo-production/commit/a1ea65a5de2e88e4ab2944a30b80421c9f3eb60e))

## [1.24.1](https://github.com/tombague160-maker/sereo-production/compare/v1.24.0...v1.24.1) (2026-09-17)


### 🐛 Corrections de bugs

* **theme:** suivre le systeme par defaut, et reparer le mode "Auto" ([e4086b6](https://github.com/tombague160-maker/sereo-production/commit/e4086b665d04871d34541eee91e0ad878416eef1))

## [1.24.0](https://github.com/tombague160-maker/sereo-production/compare/v1.23.0...v1.24.0) (2026-09-17)


### ✨ Nouvelles fonctionnalités

* **tournees:** prevenir quand la date d'un secteur tombe un dimanche ou un ferie ([5b1ad26](https://github.com/tombague160-maker/sereo-production/commit/5b1ad26c0d5df25fc708390b2d2d928ac13fb16c))

## [1.23.0](https://github.com/tombague160-maker/sereo-production/compare/v1.22.0...v1.23.0) (2026-09-17)


### ✨ Nouvelles fonctionnalités

* **comptes:** API d'administration des comptes et endpoint /api/me ([8887159](https://github.com/tombague160-maker/sereo-production/commit/8887159ae37e98d55e6bdc92fa7b81ca274c3fb9))
* **comptes:** ecran d'administration des comptes dans les Parametres ([75c173c](https://github.com/tombague160-maker/sereo-production/commit/75c173c4b2f15b7ea24133943c8009afdeb652ea))
* **geocodage:** declenchement automatique apres import, coupable par variable ([0db2ac4](https://github.com/tombague160-maker/sereo-production/commit/0db2ac43eb88942eaacfa47a8a47ee2951329970))
* **geocodage:** geocodage automatique des adresses via la Base Adresse Nationale ([93d341d](https://github.com/tombague160-maker/sereo-production/commit/93d341d06d56d1158747cf1130c7b199f9bb338d))
* **ui:** une seule palette, et les deux defauts que sa mesure a reveles ([706713c](https://github.com/tombague160-maker/sereo-production/commit/706713c095c59ec2b6d2822f53330b2c0bd75659))


### 📚 Documentation

* **design:** clore l'axe des icones, et enregistrer le piege de la cascade ([be84a6b](https://github.com/tombague160-maker/sereo-production/commit/be84a6be6666a4dfe66a6fc9d5b3f2e5f68eb393))
* **v8:** brief Claude Design, charte DESIGN.md et mise a jour de la passation ([7fc6990](https://github.com/tombague160-maker/sereo-production/commit/7fc6990b6977415209b09b8edb4206cd7c531a0b))
* **v8:** dossier de passation pour reprendre le chantier ([656b556](https://github.com/tombague160-maker/sereo-production/commit/656b5562f271d85819c8b845997a2175e860e7f4))
* **v8:** Fable 5.1 est bien selectionnable dans Claude Design, un seul compte pour l'instant ([d7ff858](https://github.com/tombague160-maker/sereo-production/commit/d7ff858345d2ec89d5b4114e863f980b8232858d))
* **v8:** prompt de reprise pret a coller dans une nouvelle conversation ([980e036](https://github.com/tombague160-maker/sereo-production/commit/980e036c55ca8dbe90cfe233afc0789be1832bcf))
* **v8:** prompt de suite en un seul bloc, avec points de controle ([1f8814d](https://github.com/tombague160-maker/sereo-production/commit/1f8814d58a1022ac9994af275598978f230d7198))
* **v8:** versionner la source de la feuille de route, comme les maquettes ([c758291](https://github.com/tombague160-maker/sereo-production/commit/c758291196ea02b68959f0af0e972bf9348f73f4))

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

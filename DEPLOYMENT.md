# Deploiement Sereo avec persistance serveur

## Stockage choisi

L'application utilise maintenant SQLite cote serveur par defaut (`SEREO_STORAGE=sqlite`).
La base est partagee par tous les utilisateurs qui accedent au meme serveur. Apres un
rafraichissement de page ou un redemarrage du serveur, les donnees restent presentes si
`SEREO_SQLITE_PATH` pointe vers un volume disque persistant.

Le fichier historique `data/db.json` reste une source de migration initiale, mais il n'est
plus la verite principale en production.

## Donnees persistantes

La base SQLite contient les tables suivantes :

- `produits` : stock, references, seuils, stock bloque.
- `clients` : nom, adresse, ville, telephone, secteur.
- `commandes` : statut, dates de preparation/livraison, source import.
- `lignes_commande` : produits et quantites par commande.
- `livraisons` : statut de livraison, secteur, note probleme.
- `mouvements_stock` : historique des ajustements de stock.
- `ventes` : donnees d'import conservees pour compatibilite.
- `historique` : evenements metier.
- `routes` : tournees et arrets livreur.
- `app_meta` : etat technique de la base et parametres visuels partages.

## Variables d'environnement

Copier `.env.example` puis adapter :

```bash
NODE_ENV=production
PORT=3000
SEREO_HOST=0.0.0.0
SEREO_STORAGE=sqlite
SEREO_SQLITE_PATH=/data/sereo.sqlite
SEREO_DB_PATH=./data/db.json
SEREO_UPLOAD_DIR=/tmp/sereo-uploads
SEREO_BACKUP_DIR=/data/backups
# SEREO_BACKUP_COPY_DIR=/sauvegardes-copie   (un autre disque : voir « Sauvegardes »)
SEREO_ENABLE_DB_EXPORT=0
SEREO_AUTH_USER=votre-identifiant
SEREO_AUTH_PASSWORD=mot-de-passe-long-et-prive
SEREO_AUTH_REALM=Sereo
```

Important : `/data` doit etre un volume persistant sur l'hebergeur. Si l'hebergeur
efface le disque au redemarrage, utiliser un volume persistant ou migrer vers une base
geree type Postgres.

### Toutes les variables (25/09)

Liste complete de ce que le serveur lit ; le detail de chacune est dans `.env.example`.
Le banc `test/variables-environnement.test.js` rougit si le code lit une variable
absente de ce tableau ou de `.env.example`. « Image » : valeur posee par le `Dockerfile`.

| Variable | Defaut | Role |
|---|---|---|
| `NODE_ENV` | `production` (image) | Lue par Express, pas par Sereo : masque le detail des erreurs. |
| `TZ` | vide : UTC | Heure du conteneur. **Ne pas la poser** : voir « Heure du conteneur » plus bas. |
| `PORT` | `3000` | Port d'ecoute. |
| `SEREO_HOST` | `127.0.0.1` ; `0.0.0.0` (image) | Adresse d'ecoute. |
| `HOST` | — | Ancien nom de `SEREO_HOST`, lu si celle-ci est vide. |
| `SEREO_APP_VERSION` | fichier `VERSION`, sinon `package.json` | Version affichee ; posee par `sereo-updater` depuis l'etiquette git. |
| `SEREO_SKIP_RELEASE_FETCH` | vide | `1` : `/api/version` n'appelle pas l'API GitHub (tests, serveurs d'essai). |
| `SEREO_STORAGE` | `sqlite` | `json` : ancien mode, migration seulement. |
| `SEREO_SQLITE_PATH` | `data/sereo.sqlite` ; `/app/data/sereo.sqlite` (image) | La base. Sur un volume persistant. |
| `SQLITE_PATH` | — | Ancien nom de `SEREO_SQLITE_PATH`, lu si celle-ci est vide. |
| `SEREO_DB_PATH` | `data/db.json` | Ancien JSON, source de la migration initiale. |
| `SEREO_UPLOAD_DIR` | `imports/` ; `/app/uploads` (image) | Fichiers Excel en cours d'import (temporaires). |
| `SEREO_BACKUP_DIR` | `backups/` a cote de la base | Sauvegardes automatiques. |
| `SEREO_BACKUP_COPY_DIR` | vide (pas de seconde copie) | Second dossier de sauvegarde, sur un autre disque : chaque sauvegarde y est copiee et relue, s'il porte le fichier temoin `sereo-second-dossier` (voir « Sauvegardes »). |
| `SEREO_IMPORTS_ARCHIVES_DIR` | `imports-archives/` a cote de la base | Copie brute de chaque Excel importe. |
| `SEREO_OSRM_DIR` | `osrm/` a cote de la base | Cartes du calcul routier local. |
| `SEREO_ENABLE_DB_EXPORT` | `0` | `1` : export complet de la base (administration locale), reserve aux comptes administrateurs. |
| `SEREO_AUTH_USER` | vide | Identifiant ; avec le mot de passe, protege tout l'acces. |
| `SEREO_AUTH_PASSWORD` | vide | Mot de passe du compte ci-dessus ; au moins 12 caracteres (plus court : le serveur demarre, le journal et l'administration le signalent). |
| `SEREO_AUTH_REALM` | `Sereo` | Nom du domaine d'authentification. |
| `SEREO_AUTH_SESSION_SECRET` | fichier `session-secret` a cote de la base | Secret des cookies de session. |
| `SEREO_AUTH_MAX_ATTEMPTS` | `5` | Essais de connexion rates avant blocage. |
| `SEREO_AUTH_RATE_WINDOW_MS` | `900000` (15 min) | Fenetre de comptage des essais. |
| `SEREO_AUTH_LOCKOUT_MS` | `15000` (15 s) | Duree du blocage. |
| `SEREO_AUTH_MAX_ATTEMPTS_COMPTE` | `20` | Essais rates sur un meme identifiant, quelle que soit l'adresse, avant de bloquer cet identifiant (appareils inconnus seulement). |
| `SEREO_AUTH_RATE_WINDOW_COMPTE_MS` | `3600000` (1 h) | Fenetre de comptage par identifiant. |
| `SEREO_AUTH_LOCKOUT_COMPTE_MS` | `900000` (15 min) | Duree du blocage d'un identifiant. |
| `SEREO_SEPARATION_ROLES` | vide (desactivee, decision du 26/08) | `1` : onglets selon le role. Navigation seulement ; les droits sont appliques par le serveur. |
| `SEREO_PURGE_TOURNEES_MOIS` | `12` | Conservation des tournees terminees, en mois ; `0` coupe la purge. |
| `SEREO_GEOCODAGE_AUTO` | `1` | `0` : geocodage sur demande seulement. |
| `SEREO_GEOCODER_URL` | Base Adresse Nationale | Point d'acces du geocodeur. |
| `SEREO_GEOCODER_INTERVALLE_MS` | `120` | Pause entre deux appels. |
| `SEREO_GEOCODER_TIMEOUT_MS` | `8000` | Delai maximal d'un appel. |
| `SEREO_GEOCODER_MAX_PAR_LOT` | `300` | Adresses par lancement. |
| `SEREO_CONTACT_URL` | le depot public | Contact inscrit dans le User-Agent envoye au geocodeur. |
| `SEREO_ROUTING_URL` | `https://router.project-osrm.org` | Service de calcul routier (service public). |
| `SEREO_ROUTING_REPLI_URL` | le service public | Repli si le premier ne repond pas ; vide : pas de repli. |
| `SEREO_OSRM_LOCAL` | `1` | `0` : coupe la carte locale (voir « Calcul routier » plus bas). |
| `SEREO_OSRM_ZONE` | selon memoire et disque | Force la zone de la carte locale. |
| `SEREO_OSRM_PORT` | `5000` | Port local d'`osrm-routed` dans le conteneur. |
| `SEREO_TUILES_URL` | OpenStreetMap | Fond de carte (gabarit https). |
| `SEREO_TUILES_ATTRIBUTION` | celle d'OpenStreetMap | Mention exigee par le fournisseur de tuiles. |
| `SEREO_TUILES_ZOOM_MAX` | `19` | Zoom maximal servi. |

### Heure du conteneur (TZ)

L'image ne pose pas `TZ` : le processus tourne en **UTC**, et c'est le reglage que les
tests verifient. Il ne faut pas la poser. Les jours et heures du metier sont calcules a
**Paris** par le code, quelle que soit l'heure du conteneur (`lib/jour-paris.js` : jour de
livraison, « aujourd'hui », preparation de nuit de la carte a 3 h). Seuls les horodatages
techniques sont en UTC, 1 h de moins que Paris l'hiver et 2 h l'ete : les journaux
(`docker logs sereo`) et les noms des sauvegardes (`db-2026-09-25T14-00-00-000Z...`).

## Protection d'acces

L'application peut proteger toute l'interface et toutes les routes API avec un identifiant
et un mot de passe HTTP Basic.

Variables a configurer avant publication :

```bash
SEREO_AUTH_USER=votre-identifiant
SEREO_AUTH_PASSWORD=mot-de-passe-long-et-prive
SEREO_AUTH_REALM=Sereo
```

Important :

- Configurer `SEREO_AUTH_USER` et `SEREO_AUTH_PASSWORD` ensemble. Si une seule valeur est
  renseignee, l'application refuse les requetes avec une erreur de configuration.
- Ne jamais commiter le fichier `.env`.
- Utiliser un mot de passe long, unique et non partage ailleurs : **au moins 12 caracteres**.
  Plus court, l'application demarre quand meme (un refus verrouillerait l'administrateur
  dehors apres une mise a jour), mais le journal le signale au demarrage et l'administration
  voit un bandeau d'alerte a chaque ouverture.
- Tentatives de connexion : 5 echecs par adresse bloquent cette adresse 15 secondes
  (`SEREO_AUTH_MAX_ATTEMPTS`, `SEREO_AUTH_RATE_WINDOW_MS`, `SEREO_AUTH_LOCKOUT_MS`) ; et
  20 echecs sur un meme identifiant dans l'heure, d'ou qu'ils viennent, bloquent cet
  identifiant 15 minutes (`SEREO_AUTH_MAX_ATTEMPTS_COMPTE`, `SEREO_AUTH_RATE_WINDOW_COMPTE_MS`,
  `SEREO_AUTH_LOCKOUT_COMPTE_MS`). Ce blocage ne vise que les appareils qui n'ont jamais
  ouvert ce compte : un appareil deja connecte (cookie « appareil connu », 180 jours apres la
  derniere connexion reussie) n'est ni bloque ni compte, et garde la seule limite par adresse.
  Pendant une attaque, un appareil NEUF attend la fin du blocage ; les blocages ne vivent qu'en
  memoire, redemarrer le conteneur les leve tous.
- « Se deconnecter » ferme la session cote serveur ; changer le mot de passe d'un compte ferme
  toutes ses sessions ouvertes. Changer `SEREO_AUTH_PASSWORD` ferme TOUTES les sessions, de
  tous les comptes (ce mot de passe entre dans le secret qui signe les cookies).
- Import, purge, reglages, sauvegardes, comptes et export de la base sont reserves a
  l'administration, cote serveur (voir `design/DESIGN.md`, garde-fous du 25/09, pour la liste
  des routes et de leur garde).
- Sur Internet, utiliser HTTPS. HTTP Basic protege l'acces applicatif, mais le mot de passe
  doit transiter dans un tunnel chiffre.

## Migration locale depuis JSON

Pour migrer l'ancien `data/db.json` vers SQLite :

```bash
npm run migrate:sqlite
```

Avec chemins explicites :

```bash
node scripts/migrate-json-to-sqlite.js ./data/db.json ./data/sereo.sqlite
```

Le script affiche uniquement des compteurs, pas les donnees personnelles.

## Commandes utiles

```bash
npm install
npm run check
npm test
npm start
```

Verifier la persistance :

1. Demarrer le serveur.
2. Ouvrir `/api/storage/status`.
3. Modifier un stock depuis l'application.
4. Rafraichir la page : la quantite doit rester.
5. Redemarrer le serveur : la quantite doit rester.
6. Ouvrir l'application depuis un autre navigateur : la meme quantite doit apparaitre.

## Deploiement type avec volume persistant

1. Installer Node.js 24 ou plus recent.
2. Installer les dependances : `npm ci`.
3. Monter un volume persistant, par exemple `/data`.
4. Configurer `SEREO_SQLITE_PATH=/data/sereo.sqlite`.
5. Configurer `SEREO_BACKUP_DIR=/data/backups`.
6. Configurer `SEREO_AUTH_USER` et `SEREO_AUTH_PASSWORD`.
7. Lancer `npm run migrate:sqlite` une seule fois si des donnees JSON existent.
8. Lancer `npm start`.

## Sauvegardes

Le serveur sauvegarde la base seul : au plus une fois par heure, a la premiere ecriture
qui suit. Chaque sauvegarde (`db-<date>[-genre].sqlite.gz` dans `SEREO_BACKUP_DIR`) est
une copie coherente de la base, meme pendant un import (copie SQLite `VACUUM INTO`), et
elle est **relue** avant de porter son nom (decompression, `integrity_check`). Une copie
qui ne se relit pas n'est jamais nommee comme une sauvegarde.

Conservation (garde-fous du 25/09) :

- les 30 plus recentes ;
- plus la derniere de chaque jour pendant 30 jours ;
- plus la derniere de chaque semaine (lundi-dimanche) pendant 8 semaines ;
- plus, toujours, celles faites juste avant « Purger les bons de commande »
  (`...-avant-purge-commandes.sqlite.gz`) : elles ne sont jamais supprimees
  automatiquement. Les effacer a la main quand elles ne servent plus.

« Sauvegarder maintenant » (Parametres, administrateur) : au plus 10 par heure ; si rien
n'a change depuis la derniere, aucun fichier de plus.

### Une copie sur un autre disque

Les sauvegardes vivent par defaut sur le meme disque que la base : une panne de ce disque
emporte les deux. `SEREO_BACKUP_COPY_DIR` designe un second dossier -- un autre disque, un
partage reseau -- ou chaque sauvegarde est aussi copiee, relue (meme empreinte sha256) et
gardee selon la meme regle. Exemple de montage dans le compose :

```yaml
    volumes:
      - /srv/dev-disk-by-uuid-XXXX/sereo:/data
      - /srv/dev-disk-by-uuid-YYYY/sereo-sauvegardes:/sauvegardes-copie   # AUTRE disque
    environment:
      SEREO_BACKUP_COPY_DIR: /sauvegardes-copie
```

**Une fois, sur l'autre disque, poser le fichier temoin** (vide) a la racine de ce dossier :

```sh
touch /srv/dev-disk-by-uuid-YYYY/sereo-sauvegardes/sereo-second-dossier
```

C'est a lui que Sereo reconnait le bon disque. Si le disque n'est pas monte (panne, redemarrage
sans montage), Docker lie a sa place un dossier vide du disque systeme : le temoin y manque,
rien n'y est copie, et la carte « Sauvegardes » le dit des le demarrage. Sereo ne cree jamais
ce dossier lui-meme.

Variable absente : rien ne change. Une copie qui echoue (temoin absent, disque plein) ne fait
pas echouer la sauvegarde ; la carte « Sauvegardes » l'affiche en alerte jusqu'a la prochaine
copie reussie. Ce dossier ne doit contenir que les sauvegardes de Sereo : les fichiers
`db-*.sqlite.gz` y suivent la rotation.

### Restaurer une sauvegarde (a la main)

1. Arreter le conteneur (`docker stop sereo`).
2. Dans le dossier de donnees, mettre la base actuelle de cote sans rien supprimer :
   renommer `sereo.sqlite` en `sereo.sqlite.avant-restauration`, et de meme
   `sereo.sqlite-wal` et `sereo.sqlite-shm` s'ils existent.
3. Decompresser la sauvegarde choisie a la place : `gunzip -c backups/<sauvegarde>.sqlite.gz`
   vers `sereo.sqlite`.
4. Redemarrer le conteneur (`docker start sereo`). Au demarrage, la base est verifiee
   (`quick_check`) puis remise en coherence.

La derniere sauvegarde se telecharge aussi depuis Parametres (administrateur).

## Limites connues

- La synchronisation temps reel n'est pas active : les autres utilisateurs voient les
  changements apres rafraichissement. C'est volontaire pour garder une base simple et fiable.
- Les preferences visuelles globales (theme/photo) sont partagees via la base. Si plusieurs
  utilisateurs les changent en meme temps, la derniere sauvegarde devient la valeur active.
- Pour un hebergement sans disque persistant, il faudra brancher une base geree comme
  PostgreSQL/Supabase/Neon/Railway Postgres.

## Calcul routier OSRM local (integre a l'image Docker, 23/09)

> **En production aujourd'hui : service public.** La carte locale s'active quand le
> conteneur a au moins 3 Go de memoire (et 6 Go libres sur le volume de donnees, en plus
> des 2 Go gardes pour la base). Le conteneur de production est limite a **512 Mo**
> (mesure du 24/09, `/api/storage/status`) :
> les tournees se calculent donc sur le service public (`SEREO_ROUTING_URL`), comme
> avant la v1.42, et les coordonnees des arrets partent chez ce tiers. Decision du
> 24/09 : on reste ainsi, sans rien retirer de l'image ; la carte locale s'activera
> d'elle-meme le jour ou la limite du conteneur passera a 3 Go. **Parametres → Reglages
> tournee → Calcul routier** le dit : « Service public — la carte locale s'active quand
> le conteneur a au moins 3 Go de mémoire (il en a 512 Mo). »

Depuis la release qui suit la v1.42.0, l'image Docker de Sereo contient le moteur de
calcul routier OSRM. Il n'y a rien a installer : ni compose a modifier, ni conteneur a
ajouter, ni carte a telecharger a la main -- mais il faut la memoire dite ci-dessus. Hors
Docker (poste de developpement, CI), les binaires OSRM n'existent pas et rien ne se passe.

### Ce qui se passe apres la release

1. `sereo-updater` reconstruit l'image comme d'habitude. Elle est plus grosse :
   environ 113 Mo compresses au lieu de 76 Mo (464 Mo sur disque au lieu de 312 Mo).
   La construction telecharge en plus l'image OSRM depuis `ghcr.io` ; si le serveur ne
   l'atteint pas, la construction echoue et Sereo reste sur l'ancienne image.
2. Sereo demarre et repond tout de suite (healthcheck compris). Les tournees se
   calculent sur le serveur public, comme avant, le temps que la carte locale soit
   prete.
3. **2 minutes apres le demarrage**, Sereo choisit une zone selon la memoire et le
   disque du serveur (en dessous de 3 Go de memoire, aucune : il reste sur le service
   public et s'arrete la), telecharge la carte depuis Geofabrik dans `/app/data/osrm/`
   (le volume de donnees), verifie sa somme MD5 et la prepare **en priorite basse**
   (`nice`, `ionice`) : le reste du serveur garde la main.
4. Des que la carte est prete, les tournees sont calculees **dans le conteneur**
   (`127.0.0.1:5000`) : les coordonnees des clients ne sortent plus. Un point hors de
   la zone, ou une carte locale en panne, repasse par le serveur public (repli).
5. Ensuite, **chaque mois**, la nuit (3 h, heure de Paris), la carte est refaite a
   cote de l'ancienne ; l'ancienne sert jusqu'a la bascule et reste en service si la
   nouvelle echoue, y compris si `osrm-routed` refuse de la charger. L'ancienne version
   n'est supprimee qu'une fois la nouvelle chargee.

### Zone, espace, memoire, duree (estimations)

| Zone choisie | Quand | Telechargement | Disque exige (libre) | Memoire exigee |
|---|---|---|---|---|
| France entiere | memoire ≥ 24 Go ET disque ≥ 50 Go | 5,1 Go | 50 Go | 24 Go |
| Bourgogne-Franche-Comte + Grand Est, Auvergne-Rhone-Alpes, Centre-Val de Loire, Ile-de-France, Suisse | memoire ≥ 12 Go ET disque ≥ 30 Go | 2,5 Go | 30 Go | 12 Go |
| Bourgogne-Franche-Comte | memoire ≥ 3 Go ET disque ≥ 6 Go | 0,33 Go | 6 Go | 3 Go |
| Aucune (service public) — **la production, a 512 Mo** | en dessous | — | — | — |

Ce sont des seuils prudents, **estimes** (seul Monaco a ete prepare pour de vrai : 2 s).
Ordres de grandeur attendus, a confirmer par la premiere preparation :

- Carte preparee : 2 a 4 fois la taille telechargee (region : 1 Go environ ; voisins :
  5 a 10 Go ; France : 10 a 20 Go). Pendant une mise a jour, deux cartes coexistent.
- Duree de la premiere preparation, en priorite basse : de l'ordre de 10 a 30 min pour
  la region, 1 a 2 h pour les voisins, plusieurs heures pour la France (plus le
  telechargement).
- Memoire : pendant la preparation, `osrm-extract` prend de l'ordre de 2,5 fois la
  taille telechargee ; ensuite, `osrm-routed` lit la carte sur le disque (`--mmap`) et
  garde peu de memoire propre.
- **Place de la base** : Sereo laisse toujours **2 Go libres** sur le volume de donnees
  (la base SQLite, ses sauvegardes et les archives d'import vivent au meme endroit).
  Le choix de la zone les retire du disque disponible ; un telechargement ou une etape
  qui ferait passer le volume en dessous est arrete, la preparation est notee en echec
  et l'ancienne carte reste en service. Les extraits d'une zone abandonnee sont
  supprimes au debut de la preparation suivante.

### Verifier que ca marche

- **Parametres → Reglages tournee → Calcul routier** : une ligne dit « Sur carte locale
  « … », donnees du …, … Go. », ou ce qui se passe (« Serveur public en attendant la
  carte locale … : telechargement 1/2 : 42 %. », derniere erreur, etc.).
- `/api/storage/status` → champ `calculRoutier` (zone, date de la carte, pret ou non,
  derniere erreur, espace utilise).
- `docker logs sereo 2>&1 | grep osrm-local` : chaque etape (telechargement, somme MD5,
  extract, partition, customize, bascule, lancement, relance) avec sa duree.

### Couper, forcer une zone

- `SEREO_OSRM_LOCAL=0` dans l'environnement du conteneur coupe tout : pas de
  telechargement, pas de preparation, pas de processus ; calcul sur le serveur public
  comme avant. (C'est une modification du compose : a ne faire qu'en cas de probleme.)
- `SEREO_OSRM_ZONE=region` (ou `voisins`, `france`, `aucune`, ou un chemin Geofabrik
  comme `europe/monaco`) force la zone.
- Les cartes vivent dans `/app/data/osrm/` : on peut supprimer ce dossier entier ;
  Sereo le refait de lui-meme dans le quart d'heure (le suivi des essais part avec
  lui ; l'essai suivant est de nouveau note : un echec n'est retente que la nuit, a
  3 h), puis chaque mois comme d'habitude.

### Risque

La **premiere preparation est lourde** (processeur, disque, memoire), d'autant plus que
la zone est grande. Elle tourne en priorite basse (`nice -n 19`, `ionice -c 3`, moitie
des coeurs) et a cote du service : Sereo continue de repondre, et une preparation qui
echoue (memoire insuffisante, plancher de 2 Go atteint, reseau, etape de plus de 24 h)
ne casse rien — elle est notee, et reessayee la nuit suivante a 3 h. Une preparation
coupee par un redemarrage du conteneur (release) reprend 2 minutes apres, sauf apres
trois coupures de suite. Une carte que `osrm-routed` refuse (par exemple apres une
nouvelle version d'OSRM dans l'image) est signalee dans Parametres et refaite la nuit
suivante ; le serveur public calcule en attendant. Si le serveur souffre malgre tout,
`SEREO_OSRM_ZONE=region` reduit la charge, `SEREO_OSRM_LOCAL=0` la supprime.

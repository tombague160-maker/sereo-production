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
SEREO_ENABLE_DB_EXPORT=0
SEREO_AUTH_USER=votre-identifiant
SEREO_AUTH_PASSWORD=mot-de-passe-long-et-prive
SEREO_AUTH_REALM=Sereo
```

Important : `/data` doit etre un volume persistant sur l'hebergeur. Si l'hebergeur
efface le disque au redemarrage, utiliser un volume persistant ou migrer vers une base
geree type Postgres.

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
- Utiliser un mot de passe long, unique et non partage ailleurs.
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

## Limites connues

- La synchronisation temps reel n'est pas active : les autres utilisateurs voient les
  changements apres rafraichissement. C'est volontaire pour garder une base simple et fiable.
- Les preferences visuelles globales (theme/photo) sont partagees via la base. Si plusieurs
  utilisateurs les changent en meme temps, la derniere sauvegarde devient la valeur active.
- Pour un hebergement sans disque persistant, il faudra brancher une base geree comme
  PostgreSQL/Supabase/Neon/Railway Postgres.

## Calcul routier OSRM local (integre a l'image Docker, 23/09)

Depuis la release qui suit la v1.42.0, l'image Docker de Sereo contient le moteur de
calcul routier OSRM. **Il n'y a rien a faire sur le serveur** : ni compose a modifier,
ni conteneur a ajouter, ni carte a telecharger a la main. Hors Docker (poste de
developpement, CI), les binaires OSRM n'existent pas et rien ne se passe.

### Ce qui se passe apres la release

1. `sereo-updater` reconstruit l'image comme d'habitude. Elle est plus grosse :
   environ 113 Mo compresses au lieu de 76 Mo (464 Mo sur disque au lieu de 312 Mo).
   La construction telecharge en plus l'image OSRM depuis `ghcr.io` ; si le serveur ne
   l'atteint pas, la construction echoue et Sereo reste sur l'ancienne image.
2. Sereo demarre et repond tout de suite (healthcheck compris). Les tournees se
   calculent sur le serveur public, comme avant, le temps que la carte locale soit
   prete.
3. **2 minutes apres le demarrage**, Sereo choisit une zone selon la memoire et le
   disque du serveur, telecharge la carte depuis Geofabrik dans `/app/data/osrm/`
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
| Aucune (serveur public) | en dessous | — | — | — |

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

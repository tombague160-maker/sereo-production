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
```

Important : `/data` doit etre un volume persistant sur l'hebergeur. Si l'hebergeur
efface le disque au redemarrage, utiliser un volume persistant ou migrer vers une base
geree type Postgres.

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
6. Lancer `npm run migrate:sqlite` une seule fois si des donnees JSON existent.
7. Lancer `npm start`.

## Limites connues

- La synchronisation temps reel n'est pas active : les autres utilisateurs voient les
  changements apres rafraichissement. C'est volontaire pour garder une base simple et fiable.
- Les preferences visuelles globales (theme/photo) sont partagees via la base. Si plusieurs
  utilisateurs les changent en meme temps, la derniere sauvegarde devient la valeur active.
- Pour un hebergement sans disque persistant, il faudra brancher une base geree comme
  PostgreSQL/Supabase/Neon/Railway Postgres.

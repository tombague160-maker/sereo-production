# Sereo

> Application web de **gestion de stock, préparations et tournées de livraison** pour le matériel médical et d'hygiène en milieu B2B (EHPAD, particuliers à domicile).

[![tests](https://img.shields.io/badge/tests-130%2B%20passing-brightgreen)](#tests)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-blue)](#prérequis)
[![Licence](https://img.shields.io/badge/licence-Propriétaire-lightgrey)](LICENSE)

## Fonctionnalités

- 📋 **Import Excel** des dossiers Ximi (ventes / facture) et du catalogue (tarifs / stock) avec **anti-doublons** et **archivage automatique**
- 📦 **Gestion stock** : inventaire, ajustements manuels (+1, -5…), seuils d'alerte, historique des mouvements
- 🔄 **Workflow préparation** : `stock à vérifier → en préparation → prêt livraison → livré`
- 🗺️ **Tournée livreur** : optimisation par secteur, carte Leaflet, statut par client (livré / absent / problème)
- 📑 **Bons de commande** numérotés `CMD-AAAA-NNN` (modèle ERP) avec édition profil client en ligne
- 📥 **Export CSV** des bons filtrés
- 🌗 **Mode clair / sombre / auto**, palettes pastel customisables, logo configurable
- 🔐 **Auth HTTP Basic** + cookie HMAC, rate limit anti brute-force
- 📦 **Auto-déploiement** : push d'un tag Git `vX.Y.Z` → OMV récupère et rebuild dans 15 min

## Prérequis

- **Node 24+** (module natif `node:sqlite` requis)
- npm 11+
- (Optionnel) Docker pour la prod

## Démarrage local

```bash
git clone https://github.com/tombague160-maker/sereo-production.git
cd sereo-production
npm install
npm start
```

Ouvre [http://localhost:3000](http://localhost:3000). Par défaut, l'auth est **désactivée en dev** (laisse `SEREO_AUTH_USER` et `SEREO_AUTH_PASSWORD` vides).

### Configuration

Copie `.env.example` puis adapte selon ton environnement :

```bash
cp .env.example .env
# Edite .env si besoin
```

Variables principales :

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port d'écoute HTTP |
| `SEREO_STORAGE` | `sqlite` | `sqlite` (prod) ou `json` (legacy migration) |
| `SEREO_SQLITE_PATH` | `./data/sereo.sqlite` | Fichier SQLite (volume persistant en prod) |
| `SEREO_AUTH_USER` | _vide_ | Identifiant HTTP Basic |
| `SEREO_AUTH_PASSWORD` | _vide_ | Mot de passe HTTP Basic (les 2 ensemble) |
| `SEREO_AUTH_SESSION_SECRET` | _aléatoire_ | Secret HMAC cookies (à définir en prod pour persister les sessions) |
| `SEREO_ENABLE_DB_EXPORT` | `0` | Mettre à `1` uniquement pour debug local |

Voir [`.env.example`](.env.example) et [`DEPLOYMENT.md`](DEPLOYMENT.md) pour la liste complète.

## Tests

```bash
npm run check    # syntax check (node --check) — obligatoire avant tout commit
npm test         # 127+ tests backend via node --test natif
```

Lancer un seul test :
```bash
node --test test/api.test.js --test-name-pattern="re-import stock"
```

### Tests E2E (Playwright, v1.14.0+)

Playwright n'est **pas dans `devDependencies`** pour ne pas alourdir l'image Docker de prod. Pour l'utiliser en dev :

```bash
npm install --save-dev @playwright/test    # installe Playwright local (NE PAS commit package.json)
npx playwright install chromium            # installe le navigateur (~150 MB, 1 fois)
npm run test:e2e                           # mode headless
npm run test:e2e:ui                        # mode interactif debug
```

⚠️ Après `npm install --save-dev`, ne **PAS** commit le package.json modifié (sinon le build Docker prod va re-tenter de l'installer dans le container et alourdir l'image de 200 MB).

Les tests E2E couvrent les **golden paths** (dashboard, Bons de commande, Paramètres, modal version, erreur import). Voir [`test/e2e/smoke.spec.js`](test/e2e/smoke.spec.js) et [`playwright.config.js`](playwright.config.js).

## Architecture

- **Backend** : Express 4 monolithique (`server.js`)
- **Storage** : SQLite via `node:sqlite` natif (couche `storage/sqliteStore.js`)
- **Frontend** : SPA vanilla JS sans framework ni bundler (`public/js/app.js`)
- **Carte** : Leaflet + tuiles OpenStreetMap
- **Import Excel** : `read-excel-file` (.xlsx uniquement, max 10 MB)
- **PWA** : Service Worker pour offline-light + auto-update

Détails dans :
- [`CLAUDE.md`](CLAUDE.md) — instructions pour les agents IA + conventions
- [`docs/internal/AUDIT_2026_05_20.md`](docs/internal/AUDIT_2026_05_20.md) — audit complet 5 axes + plan en 3 sprints
- [`docs/SCHEMA.md`](docs/SCHEMA.md) — schéma SQLite avec diagramme ER
- [`docs/adr/`](docs/adr/) — Architecture Decision Records (rationale des choix structurants)

## Workflow Git

Le projet utilise **Conventional Commits** et **release-please** pour les versions automatiques :

- `feat:` → bump minor (`1.X.0`)
- `fix:` → bump patch (`1.0.X`)
- `feat!:` ou `BREAKING CHANGE:` → bump major
- `refactor:`, `style:`, `test:`, `docs:` → pas de bump

Voir [`CONTRIBUTING.md`](CONTRIBUTING.md) pour le détail.

## Production

L'app est déployée sur un **OMV** avec Docker + SWAG en reverse proxy sur `sereo.dockerswag2024.duckdns.org`.

Le déploiement est **automatique** : merger une PR de release créée par release-please → tag Git → l'OMV récupère et rebuild dans les 15 min via `sereo-updater`.

Voir [`DEPLOYMENT.md`](DEPLOYMENT.md) pour les détails opérationnels.

## Licence

Application propriétaire — usage interne. Code source visible sur GitHub à des fins de transparence et de contribution restreinte.

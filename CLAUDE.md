# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

Sereo V7 est une application locale Node.js/Express + SPA vanilla JS pour gérer **stock, ventes, préparation et tournées de livraison** en milieu B2B (matériel médical / hygiène). Code et UI en français. Production : OMV + Docker + SWAG sur `sereo.dockerswag2024.duckdns.org`.

## Commandes courantes

```bash
npm install                  # Installation des dépendances
npm start                    # Lance le serveur sur PORT (défaut 3000)
npm test                     # 48 tests via node --test (api.test.js + auth.test.js)
npm run check                # node --check sur server.js, app.js, sqliteStore.js, scripts
npm run migrate:sqlite       # Migration data/db.json -> data/sereo.sqlite (one-shot)
```

Lancer un seul test : `node --test test/api.test.js --test-name-pattern="<regex sur le titre du test>"`.

Avant tout commit qui touche `server.js` ou `public/js/app.js` : **toujours `npm run check` puis `npm test`**. Le syntax check est obligatoire car ces fichiers font 2700+ lignes et une typo casse la prod silencieusement (l'updater déploie sans valider).

## Architecture

### Stack
- **Backend** : Express 4 (`server.js`, ~2700 lignes, monolithique)
- **Storage** : SQLite via `node:sqlite` natif (Node 24 requis), couche dans `storage/sqliteStore.js`. Le mode JSON (`SEREO_STORAGE=json`) est gardé pour migration mais n'est plus la source de vérité prod.
- **Frontend** : SPA vanilla JS (`public/js/app.js`, ~2800 lignes), pas de framework, pas de bundler. Routing par `#hash`.
- **Carte** : Leaflet + tuiles OpenStreetMap (mode livreur, calcul de tournée).
- **Import Excel** : `read-excel-file` pour les fichiers ventes/clients Ximi (.xlsx uniquement).
- **Upload** : `multer` plafonné à 10 MB, fichiers .xlsx exclusivement.

### Flux de données
1. **Import Ximi** → ventes (table `ventes`) + clients (table `clients`) + commandes (table `commandes`) générées par `mergeImportedClients` + `syncWorkflow`.
2. **Préparation** → workflow par statuts d'`ORDER_STATUSES` (`importe` → `stock_a_verifier` → `en_preparation` → `pret_livraison` → `livre`).
3. **Stock** → réservation/déduction calculée à la volée depuis les commandes actives.
4. **Tournée** → `routes` + `stops` (un client par stop), statut `STOP_STATUSES`.

### Tables SQLite
`produits`, `clients`, `commandes`, `lignes_commande`, `livraisons`, `mouvements_stock`, `ventes`, `historique`, `routes`, `app_meta`. Schéma dans `storage/sqliteStore.js`.

### Système de thème (dark/light)
- Mode stocké **strictement en localStorage par device** (pas sync serveur, par choix UX).
- Anti-FART : `public/js/anti-fart.js` chargé synchrone dans `<head>` avant le CSS, pose `data-color-scheme="light"|"dark"` sur `<html>`. **NE PAS remettre ce script en inline** : la CSP `script-src 'self'` le bloquerait.
- Critical CSS dans `<head>` (avant `<link>` style.css) pour éviter le flash.
- Variables sémantiques dans `:root`, surchargées dans `:root[data-color-scheme="dark"]` ET `@media (prefers-color-scheme: dark) :root:not([data-color-scheme="light"])`. Les deux blocs doivent rester synchronisés.
- Palettes pastel (sereo, menthe, lavande...) définies en JS dans `app.js:51` (`pastelThemes`), avec `vars` (light) et `darkVars` (dark) appliquées via `setProperty` sur `:root`.

### Auth
- HTTP Basic via `SEREO_AUTH_USER` + `SEREO_AUTH_PASSWORD` env vars. Si une seule des deux est définie → erreur de config (refus).
- Cookie HMAC `sereo_access` pour la session (12h).
- `/healthz` reste public (pour Docker healthcheck).
- Désactivable en dev en laissant les 2 vars vides.

### Sécurité
- CSP stricte définie dans `server.js:124` (`securityHeaders`). Notamment `script-src 'self'` → **AUCUN** script inline accepté. Tout nouveau JS doit être un fichier servi par le serveur.
- `style-src 'self' 'unsafe-inline'` autorise les `<style>` inline (pour le critical CSS).
- Headers : X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy no-referrer, Permissions-Policy strict.

## Workflow Git & releases

### Conventional Commits obligatoires
Le projet utilise **release-please** (`.github/workflows/release-please.yml`). Format des messages :
- `feat:` → bump minor (1.X.0)
- `fix:` → bump patch (1.0.X)
- `feat!:` ou `BREAKING CHANGE:` → bump major
- `perf:` → bump patch
- `refactor:`, `docs:`, `style:`, `test:`, `build:` → pas de bump
- `chore:`, `ci:` → cachés du changelog

Voir `CONTRIBUTING.md` pour la liste complète + `.release-please-config.json` pour les sections changelog (avec emojis).

### Cycle de release
1. Push de commits sur `main`.
2. release-please ouvre/met à jour une PR `chore(main): release vX.Y.Z` avec changelog auto-généré.
3. Merger la PR de release → tag + GitHub release créés.
4. **L'OMV récupère automatiquement dans 15 min** (sereo-updater poll les tags via `git tag --points-at HEAD`).

### Auto-deploy en prod
- Le service `sereo-updater` (Tom.yml côté OMV, hors repo) ne déploie **que les tags `vX.Y.Z`**, pas les commits intermédiaires sur main. Donc une PR feature mergée n'est pas déployée tant que release-please n'a pas créé la release.
- Si le rebuild échoue, le container `sereo` reste sur l'ancienne image (fallback non-destructif). Logs visibles via `docker logs sereo-updater`.

## Variables d'environnement

Voir `.env.example` pour la liste complète. Les principales :
- `SEREO_STORAGE` : `sqlite` (défaut) ou `json` (legacy migration only)
- `SEREO_SQLITE_PATH` : chemin du fichier .sqlite (doit être sur volume persistant en prod)
- `SEREO_AUTH_USER` / `SEREO_AUTH_PASSWORD` : couple obligatoire si exposé sur Internet
- `SEREO_UPLOAD_DIR` / `SEREO_BACKUP_DIR` : volumes persistants
- `SEREO_ENABLE_DB_EXPORT` : `0` par défaut (laisser pour ne pas exposer la DB)

## Conventions du projet

- **Toutes les commandes/messages/UI en français**, y compris les commits.
- **Pas de framework frontend**. Garder la SPA en vanilla JS, pas d'introduction de React/Vue/Svelte.
- **Pas de TypeScript**. Le projet est en JS pur.
- **Pas de backwards-compat avec `db.json`** sauf pour la migration explicite. La SQLite est la source de vérité.
- **Tests via `node --test` natif** (pas de Jest/Mocha/Vitest). Les tests démarrent un serveur express temporaire et frappent les endpoints en HTTP.
- **Aucun framework CSS** (pas de Tailwind/Bootstrap). Tout est custom dans `style.css`.
- **Sectorisation hardcodée** : `Besancon`, `Champagnole`, `Dole` sont les `CORE_SECTORS` (autres secteurs ajoutables dynamiquement via API).

## Pièges connus

- **Node 24 minimum** : le module `node:sqlite` (natif, sync) est utilisé directement. `engines` du package.json le force.
- **CSP bloque les inline scripts** : tout `<script>` inline dans index.html sera silencieusement ignoré et causera des bugs visuels (flash dark mode résolu par PR #23 qui a externalisé le script anti-FART).
- **Variables CSS dupliquées** dans 3 blocs (`:root`, `@media dark`, `[data-color-scheme="dark"]`). Garder les 3 synchronisés.
- **Volume `brand:` à NE PAS monter en prod** : le mount `/app/public/brand` overshadowe les SVG bakés dans l'image → 404. Les brand images custom sont stockées en base64 dans la DB (`appearance.brandImage`), pas sur disque.
- **`Math.max(0, ...)` et non `Math.max(1, ...)`** sur les quantités produit (PR antérieure). Une qty 0 est légitime (erreur métier signalée), ne pas la forcer à 1.
- **`pull_policy: build` + auto-update** : le `docker compose up --force-recreate` doit être lancé avec `--no-build` côté sereo-updater, sinon il tente de re-build le context host depuis le container. Configuration côté OMV (Tom.yml).

## Fichiers de référence

- `AGENTS.md` : instructions courtes pour agents IA (ancien, à compléter par ce CLAUDE.md).
- `CONTRIBUTING.md` : workflow Git détaillé avec exemples Conventional Commits.
- `DEPLOYMENT.md` : déploiement prod, variables d'env, vérification persistance.
- `agents/maintenance.md` : notes de maintenance opérationnelle.
- `Dockerfile` : image de prod (Node 24 alpine + tini + healthcheck `/healthz`).
- `.release-please-config.json` : config du bumping automatique des versions.

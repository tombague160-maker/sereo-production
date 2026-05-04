# Contribuer à Sereo

## Format des messages de commit

Le projet utilise [Conventional Commits](https://www.conventionalcommits.org/) pour générer
automatiquement les releases et le changelog via `release-please`.

### Types disponibles

| Type | Effet sur la version | Exemple |
|---|---|---|
| `feat:` | Bump **minor** (1.X.0) | `feat: ajoute export PDF des tournees` |
| `fix:` | Bump **patch** (1.0.X) | `fix: corrige le calcul du stock reserve` |
| `feat!:` | Bump **major** (X.0.0) | `feat!: change le format de l'API stock` |
| `perf:` | Bump patch | `perf: ajoute index SQLite sur commandes` |
| `refactor:` | Pas de bump | `refactor: simplifie syncWorkflow` |
| `docs:` | Pas de bump | `docs: ajoute schema d'architecture` |
| `style:` | Pas de bump | `style: refonte tableau stock` |
| `test:` | Pas de bump | `test: ajoute tests d'auth` |
| `build:` | Pas de bump | `build: passe a Node 26` |
| `chore:` | Pas de bump (cache) | `chore: maj package-lock` |
| `ci:` | Pas de bump (cache) | `ci: ajoute workflow tests` |

### Breaking changes

Pour signaler un changement incompatible (qui casse l'existant) :

```
feat!: change le format de stockage SQLite

BREAKING CHANGE: la table produits a maintenant une colonne reference UNIQUE,
les anciennes bases doivent etre migrees via scripts/migrate-v2.js
```

Le `!` ou la mention `BREAKING CHANGE:` dans le corps fait passer en version majeure (`v2.0.0`).

### Scope (optionnel)

On peut préciser la zone touchée entre parenthèses :

```
feat(stock): ajoute le filtre par categorie
fix(api): corrige le 500 sur PATCH /api/stock/:id
docs(readme): ajoute la section deploiement
```

## Workflow de release

1. Tu pousses des commits sur `main` (en suivant le format ci-dessus).
2. L'action `release-please` crée/met à jour une PR `chore(main): release vX.Y.Z` avec :
   - Le numéro de version calculé automatiquement
   - Un changelog généré à partir des commits
3. Tu peux **éditer le changelog** dans la PR pour le rendre plus narratif si tu veux.
4. Tu **merges la PR** → tag Git + release GitHub créés automatiquement.

## Cycle complet d'une MAJ jusqu'à l'OMV

```
1. Code sur Windows + commit "feat: ..." + git push
2. (si tu veux une release) Tu merges la PR release-please
3. (sur OMV) sereo-updater detecte le commit dans les 15 min
4. Rebuild + restart automatiques
```

Sans étape 2, l'OMV se met quand même à jour. La release n'est qu'une **trace propre** de ce qui a été déployé.

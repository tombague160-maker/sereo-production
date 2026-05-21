# ADR 0001 — Bucketing des commandes par (client, dateCommande)

- **Statut** : Adopté (v1.9.0, mai 2026)
- **Date** : 2026-05-18
- **Décideurs** : utilisateur (propriétaire produit) + Claude (assistant dev)

## Contexte

Avant v1.9.0, chaque client en base avait **exactement une commande** identifiée par son `clientId`. Lors d'un import Excel ventes, l'app regroupait toutes les lignes du client dans cette unique commande, écrasant le contenu précédent.

Limites métier :
- Si un client commande 3 fois sur 3 mois différents, l'app ne voit qu'une seule commande
- Impossible d'historiser les bons par date de livraison
- Aucun numéro humain (juste un UUID `cmd-<uuid>`)
- Ré-importer un Excel = perte des modifications manuelles (statut workflow, notes)

L'utilisateur souhaitait fonctionner comme un **vrai ERP** : 1 commande = 1 bon livrable identifiable, multiple bons possibles par client, numérotation humaine.

## Décision

À partir de v1.9.0, une commande est identifiée par le **couple `(clientId, dateCommande)`** :

- Un client peut avoir **N commandes**, une par date différente
- Chaque commande a un **numéro humain** : `CMD-{année}-{NNN}` (préfixe configurable, reset annuel par défaut)
- Chaque commande a un **`excelRowHash`** SHA-256 sur `(clientId, dateCommande, products)` pour détecter les re-imports idempotents

À l'import, 3 chemins de matching :

1. **Hash strict** : même contenu Excel → no-op (re-import = idempotent)
2. **`(clientId, dateCommande)`** : même bon mais contenu modifié → update produits, **préserve le statut workflow** (ne fait jamais reculer une commande de "livré" à "à vérifier")
3. **Aucun match** : nouvelle commande avec numéro frais via `generateOrderNumber()`

## Conséquences

### Positives

- ✅ Modèle métier ERP correct (1 bon livrable = 1 entité)
- ✅ Numérotation lisible pour l'humain (`CMD-2026-001` apparaît partout : UI, CSV, recherche)
- ✅ Re-import idempotent (ne crée pas de doublons)
- ✅ Workflow préservé entre imports (commandes en préparation ne reviennent pas en arrière)
- ✅ Historique riche : on peut voir 6 mois de commandes pour un même client

### Négatives / Coût

- ⚠ Migration nécessaire des données pré-v1.9.0 (anciennes commandes avec `dateCommande = today` à purger via `POST /api/orders/purge` puis ré-importer — voir v1.12.0 pour l'outillage)
- ⚠ `syncWorkflow()` doit gérer N commandes par client (refacto v1.9.0)
- ⚠ Pour les imports historiques, l'utilisateur doit ré-importer ses Excel mois par mois

### Alternatives rejetées

- **1 commande par ligne Excel** : trop granulaire (un client achète 10 produits le même jour = 10 commandes ?)
- **Numéro UUID** : illisible, impossible à dire au téléphone à un client
- **Date d'import comme pivot** : pas métier (même livraison = différentes dates selon quand on importe)

## Liens

- Commit principal : v1.9.0 (PR fusionnée le 2026-05-18)
- Hotfix migration : v1.9.1 (PR #51) — ordre `CREATE TABLE` → `ALTER TABLE` → `CREATE INDEX`
- Archivage Excel : ADR 0003 (v1.12.0)
- Mémoire utilisateur : `feedback_sereo_imports_no_wipe.md`

# Schéma SQLite Sereo (v1.13.2)

> Source unique : `storage/sqliteStore.js` (fonction `migrateSchema`).
> Ce document est un **guide visuel** pour comprendre les relations, pas une définition normative. Les types et contraintes officielles restent dans le code.

## Tables (10)

```mermaid
erDiagram
    produits ||--o{ lignes_commande : "produit_id"
    produits ||--o{ mouvements_stock : "produit_id"
    clients ||--o{ commandes : "client_id"
    commandes ||--o{ lignes_commande : "commande_id"
    commandes ||--o{ livraisons : "commande_id"
    routes ||--o{ livraisons : "(via stops[])"

    produits {
        TEXT id PK
        TEXT reference
        TEXT nom
        REAL stock_actuel
        REAL stock_minimum "defaut 5"
        REAL stock_bloque
        TEXT unite
        TEXT updated_at
        TEXT payload "JSON complet"
        INTEGER sort_order
    }

    clients {
        TEXT id PK
        TEXT nom
        TEXT adresse
        TEXT ville
        TEXT code_postal
        TEXT telephone
        TEXT secteur
        TEXT updated_at
        TEXT payload "JSON"
        INTEGER sort_order
    }

    commandes {
        TEXT id PK "cmd-CMD-2026-001"
        TEXT numero "CMD-2026-001"
        TEXT date_commande "ISO YYYY-MM-DD"
        TEXT excel_row_hash "SHA256-16"
        TEXT client_id FK
        TEXT date_import
        TEXT date_preparation
        TEXT date_livraison
        TEXT statut "ORDER_STATUSES"
        TEXT source_excel
        TEXT updated_at
        TEXT payload "JSON"
        INTEGER sort_order
    }

    lignes_commande {
        TEXT id PK
        TEXT commande_id FK
        TEXT produit_id
        REAL quantite
        REAL quantite_preparee
        TEXT statut
        INTEGER stock_suffisant
        TEXT payload
        INTEGER sort_order
    }

    livraisons {
        TEXT id PK
        TEXT commande_id
        TEXT client_id
        TEXT date_livraison
        TEXT secteur
        TEXT statut "STOP_STATUSES"
        TEXT note_probleme
        TEXT date_mise_a_jour
        TEXT payload
        INTEGER sort_order
    }

    mouvements_stock {
        TEXT id PK
        TEXT produit_id
        TEXT type "ajout|retrait|ajustement"
        REAL quantite
        TEXT raison
        TEXT reference_commande
        TEXT date
        TEXT utilisateur
        TEXT payload
        INTEGER sort_order
    }

    ventes {
        TEXT id PK
        TEXT payload "JSON ligne Excel"
        INTEGER sort_order
    }

    historique {
        TEXT id PK
        TEXT type
        TEXT message
        TEXT date
        TEXT payload
        INTEGER sort_order
    }

    routes {
        TEXT id PK
        TEXT statut "ROUTE_STATUSES"
        TEXT secteur
        TEXT date_livraison
        TEXT payload "JSON avec stops[]"
        INTEGER sort_order
    }

    imports_archives {
        TEXT id PK
        TEXT type "ventes|stock"
        TEXT filename
        TEXT archived_path "/app/data/imports-archives/..."
        TEXT imported_at
        INTEGER rows_count
        INTEGER file_size
        TEXT sha256
        TEXT stats_json
        TEXT payload
        INTEGER sort_order
    }

    app_meta {
        TEXT key PK "initialized|last_write_at|settings|..."
        TEXT value
        TEXT updated_at
    }
```

## Indexes

```sql
-- commandes
CREATE INDEX idx_commandes_numero ON commandes(numero);                       -- recherche par numéro humain
CREATE INDEX idx_commandes_client_date ON commandes(client_id, date_commande); -- match (clientId, date) à l'import
CREATE INDEX idx_commandes_hash ON commandes(excel_row_hash);                  -- détection re-import idempotent
CREATE INDEX idx_commandes_statut ON commandes(statut);                        -- filtre page Bons (v1.13.0+)
CREATE INDEX idx_commandes_date_livraison ON commandes(date_livraison);        -- filtre page Livraison (v1.13.0+)

-- imports_archives
CREATE INDEX idx_imports_archives_at ON imports_archives(imported_at DESC);
CREATE INDEX idx_imports_archives_type ON imports_archives(type, imported_at DESC);
```

## Notes

- **`payload` JSON** : chaque table principale stocke aussi le JSON complet de l'objet dans `payload` (TEXT). Permet de garder des champs custom hors schéma SQL sans migration. Le code parse/serialize via `JSON.parse/stringify`.
- **Pas de `FOREIGN KEY` strict** sur les relations clients↔commandes : préserver la souplesse en cas de purge sélective. Les jointures se font côté code.
- **Seuil stock minimum** : `produits.stock_minimum` vaut `5` par défaut pour préserver l'ancien comportement. Le payload produit expose aussi `alertThreshold` / `stockMinimum`; la logique métier recommande un produit quand `stock_actuel <= seuil minimum`.
- **Pas de soft-delete** : un `DELETE` est définitif. Pour préserver l'historique, utiliser `mouvements_stock` (stock) ou `historique` (général).
- **WAL mode** activé pour les écritures concurrentes (`PRAGMA journal_mode = WAL`).
- **Numérotation `commandes.numero`** : voir [ADR 0001](adr/0001-erp-bucketing-par-client-date.md).

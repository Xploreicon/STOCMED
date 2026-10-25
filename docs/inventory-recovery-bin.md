# Inventory recovery bin

Select medicines or Store items using their checkboxes, or select the current page (up to 100 items). Choose **Remove selected**, review the names, choose a reason and confirm. The existing superintendent authorization settings and staff stock-adjustment permission apply. An item with an active reservation must be resolved or removed from the selection first. Nothing is removed automatically based on similar names.

Removed stock is excluded from active inventory, POS and patient search. The **Recovery bin** filter shows recoverable items, the removal reason and restore-by date. Select items there to **Restore selected**, or restore a single item. A request affecting several items is atomic: an unavailable item, an expired recovery window or a conflicting active barcode/catalogue product rejects the entire selection.

The database sets a 60-day recovery deadline when an item is first removed. Retries do not reset that deadline. Restoration is rejected at or after the deadline, including through the older single-item endpoint. Expired entries disappear from the recovery bin when inventory is read. Historical inventory rows, batches, stock movements, sales and removal events remain for reporting and referential integrity; no cascading deletion occurs. The recovery bin is a logical temporary area in the database, not an exported file or publicly accessible storage bucket.

Existing delisted items get a full 60-day recovery window at rollout. Migration: `20261025132235_inventory_recovery_bin.sql`. Verify locally using `scripts/test-inventory-recovery-db.cjs` against its disposable localhost database and the inventory unit tests.

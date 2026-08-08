-- Production's inventory movement vocabulary is captured here for fresh
-- replays. The pharmacy_inventory notes column is added later, after the
-- production-ordered deleted_at and image_url columns.

-- Production's canonical stock_movement_type intentionally has no write_off
-- label. Inventory write-offs use the existing expiry_writeoff/adjustment
-- labels, so a fresh replay must not introduce a migration-only enum value.

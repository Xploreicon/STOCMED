# Inventory read rollback plan

Release scope:

- migration `20260905160000_set_based_inventory_read.sql`;
- the `lib/pharmacyInventory.ts` switch from the legacy fan-out to
  `get_pharmacy_inventory_enriched`;
- no catalogue or inventory writes.

Known-good pre-change application commit: `da835da`.
Known-good production deployment:
`https://stocmed-da4jng2oa-xploreicons-projects.vercel.app`.

Fresh pre-release database archive:
`/private/tmp/stocmed-inventory-read-fix/reports/backups/production-pre-inventory-read-20260905T213641Z.sql.dump`.

SHA-256:
`41a063674968ef1f76fcb7f31894c9f5ae64a99abb7e2fbd2c582a7c7f8c8839`.

## Before production promotion

1. Take a fresh production dump immediately before the release.
2. Write its absolute path and SHA-256 into the release record.
3. Verify the dump checksum and inspect it with `pg_restore --list`.
4. Deploy the migration and application change together.

## Normal rollback

Roll the application back to `da835da` first so no live request depends on the
new RPC. Then apply this reviewed rollback migration through the normal
migration runner:

```sql
BEGIN;
DROP FUNCTION IF EXISTS public.get_pharmacy_inventory_enriched(UUID, BOOLEAN);
NOTIFY pgrst, 'reload schema';
COMMIT;
```

The old application then resumes its existing paginated and per-chunk reads.
This restores the known-good behavior, including its old latency, without
changing inventory or catalogue data.

## Restore fallback

A database restore is not expected for this read-only function. If an incident
lead nevertheless authorizes full recovery, stop writes, verify the fresh dump
checksum, inspect the archive, and restore it in the approved maintenance
window:

```sh
shasum -a 256 -c /private/tmp/stocmed-inventory-read-fix/reports/backups/production-pre-inventory-read-20260905T213641Z.sql.dump.sha256
pg_restore --list /private/tmp/stocmed-inventory-read-fix/reports/backups/production-pre-inventory-read-20260905T213641Z.sql.dump
pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname "$INVENTORY_READ_PRODUCTION_DATABASE_URL" \
  /private/tmp/stocmed-inventory-read-fix/reports/backups/production-pre-inventory-read-20260905T213641Z.sql.dump
```

After either rollback, confirm `products` is still 3,419 rows with the approved
catalogue digest, raw inventory counts reconcile, and the known-good inventory
endpoint works before reopening traffic.

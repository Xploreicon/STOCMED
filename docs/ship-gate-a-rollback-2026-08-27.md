# Ship Gate A rollback runbook — 2026-08-27

Scope: Prompts 1–4 only. The release adds these migrations, in order:

1. `20260826230000_import_matching_staging.sql`
2. `20260827000000_set_based_import_matching.sql`
3. `20260827010000_stage_import_job_rpc.sql`

The pre-promotion production backup is:

`/Users/divineajie/stocmed-mvp/reports/backups/production-pre-ship-gate-a-20260827T011713Z.dump`

Its SHA-256 is recorded beside it in a `.sha256` file. Verify that digest and
`pg_restore --list` before any rollback.

## Preferred rollback

1. Stop new inventory imports at the application edge.
2. Roll Vercel production back to
   `stocmed-lmbab97kk-xploreicons-projects.vercel.app`, built from commit
   `168089bf4e43fce01884fa099f2215b54c185e38`.
3. Apply a reviewed down migration that reverses the three migrations in
   reverse order:

```sql
BEGIN;

DROP FUNCTION IF EXISTS public.stage_import_job(UUID, JSONB);
DROP FUNCTION IF EXISTS public.match_import_job(UUID);
DROP FUNCTION IF EXISTS public.normalize_import_match_name(TEXT);

DROP TABLE IF EXISTS public.import_staging;
DROP TABLE IF EXISTS public.import_jobs;
DROP TABLE IF EXISTS public.barcode_catalogue_map;
DROP FUNCTION IF EXISTS public.set_import_matching_updated_at();

DELETE FROM supabase_migrations.schema_migrations
WHERE version IN ('20260826230000', '20260827000000', '20260827010000');

COMMIT;
```

The legacy per-row matching functions are not removed by Gate A, so the
pre-release application remains functional after this reversal.

## Full restore fallback

Use this only if the down migration cannot recover service or data integrity.
It is destructive and requires an incident lead to stop writes first.

```sh
export SHIP_GATE_A_PRODUCTION_URL='postgresql://<production-restore-role>@<production-host>/postgres'
shasum -a 256 -c /Users/divineajie/stocmed-mvp/reports/backups/production-pre-ship-gate-a-20260827T011713Z.dump.sha256
pg_restore --list /Users/divineajie/stocmed-mvp/reports/backups/production-pre-ship-gate-a-20260827T011713Z.dump
pg_restore --clean --if-exists --no-owner --no-acl --dbname "$SHIP_GATE_A_PRODUCTION_URL" /Users/divineajie/stocmed-mvp/reports/backups/production-pre-ship-gate-a-20260827T011713Z.dump
```

After either rollback, verify the catalogue count and digest, then run a
read-only inventory smoke test before reopening imports.

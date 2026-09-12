# Catalogue admin review rollback runbook

## 2026-09-12 product-unlock release

Known-good pre-release application commit: `d23c4fb`.

Fresh verified production backup:

- path: `reports/backups/production-pre-product-unlock-20260911.sql.dump`;
- SHA-256: `2817fb274fab051a721299277d7bd70baa216619ba3c2c716f1e7fc7e61bf32b`;
- 1,431 TOC entries;
- checksum match, TOC parse, and complete offline payload read passed.

The production migration audit confirmed that `20260827020000`,
`20260827021000`, `20260901110000`, `20260905150000`, and
`20260905160000`, and `20260906000000` were already applied. The only database migration pending for
this release is `20260911230000_unverified_catalogue_product_review.sql`.

Rollback sequence:

1. Roll the application back to the known-good `d23c4fb` deployment.
2. Stop catalogue-review writes and preserve
   `catalogue_product_submission_audit`; do not erase review provenance merely
   to remove an unused additive function.
3. If the new schema must be removed before any review action occurred, apply a
   reviewed rollback migration that drops
   `review_unverified_catalogue_product(UUID, TEXT, JSONB, TEXT)` and then the
   empty `catalogue_product_submission_audit` table, followed by
   `NOTIFY pgrst, 'reload schema';`.
4. If product rows were changed incorrectly, use the audit records for a
   separately reviewed corrective migration. For broad or uncertain
   corruption, restore the verified backup in an approved maintenance window.

The application release exposes the already-live Store-to-Medicine RPC and the
already-live 10,287-row catalogue review queue. It must not run the catalogue
loader or alter `products` during deployment; the pre-release products count is
3,419.

Release scope:

- migration `20260905150000_catalogue_source_staging.sql`;
- migration `20260906000000_catalogue_admin_review.sql`;
- catalogue package loader and the server-gated `/admin/catalogue-review` UI;
- no AI processing and no automatic or bulk catalogue promotion.

Known-good pre-change production application commit: `06b62b1`.

Superseded Stop Gate 1 backup (read-only, full custom-format dump):

- path: `reports/backups/production-pre-catalogue-review-20260906T142641Z.dump`;
- SHA-256: `8ebe1c23539e5571a696c10fb467006f8e475340ffbcd43e66880279a544cd4f`;
- `shasum -a 256 -c` passed and `pg_restore --list` parsed 1,343 TOC entries,
  but a full offline `pg_restore` payload read later failed with unexpected EOF;
- production baseline at capture: 3,419 `products` rows;
- status: **invalid and not restorable**. It is superseded and must never be
  used for recovery. Take a new backup with the safe runner, whose verification
  now streams every archive entry before publishing the dump.

The dump and checksum are gitignored. If approval is not followed by deployment
in the same release window, replace this candidate with a newly captured dump
and checksum immediately before applying either migration. Do not put database
credentials in this file, logs, or chat.

## Required pre-flight

1. Put the rotated production database URL in a protected file outside the
   repository (`chmod 600`) and expose only its path through
   `STOCMED_PRODUCTION_DATABASE_URL_FILE`.
2. Export a fresh custom-format production dump to a gitignored backup path
   with the credential-safe archive runner:

   ```sh
   npm run db:archive -- backup \
     --connection-file "$STOCMED_PRODUCTION_DATABASE_URL_FILE" \
     --archive /absolute/gitignored/path/production-pre-catalogue-review.dump
   ```

3. Never pass the URL itself to `pg_dump`, `pg_restore`, `psql`, or a process
   diagnostic. Never use `ps`/`pgrep` modes that display arguments or the
   environment while database tooling is running.
4. Verify the generated SHA-256 sidecar, archive TOC, and complete payload before
   applying either migration:

   ```sh
   npm run db:archive -- verify \
     --archive /absolute/gitignored/path/production-pre-catalogue-review.dump
   ```

5. Confirm deployed production is still based on `06b62b1` plus any explicitly
   reviewed intervening production commits.
6. Confirm the release diff contains the two migrations above, their tests, the
   loader, and the admin review application changes only.
7. Record `products` count and the approved deterministic products digest before
   applying the release. Applying the schema and loading source evidence must
   leave both unchanged.

At Stop Gate 1, the Git release ancestry is exactly `06b62b1` plus four bounded
commits: catalogue staging, schema-cache hygiene, administrator review/promotion,
and database-command credential hardening. The database migration baseline ends
at `20260905160000`; neither catalogue staging migration is present. The owner
confirmed `06b62b1` as the live application base, corroborating the public
production markers observed during drift diagnosis. Git drift is therefore
resolved. Hosted-preview verification is complete. A new safe-runner backup is
still blocked: the previously exposed production credential continues to
authenticate, so the attempted rotation did not invalidate it. Do not make
another production connection until the correct project credential is rotated,
the old credential fails authentication, and the new credential is installed by
protected file reference.

## Application rollback

Roll the application back to the known-good deployment for `06b62b1` before
removing any RPC on which the review UI depends. This disables the new review
surface while preserving all staging and provenance data for investigation.

## Schema rollback before any promotion

If no row exists in `public.catalogue_product_promotions`, apply the following
through the migration runner in an approved window. This removes only the review
and staging objects and does not modify `public.products`.

```sql
BEGIN;

DROP FUNCTION IF EXISTS public.promote_catalogue_reconciliation_candidate(UUID);
DROP FUNCTION IF EXISTS public.search_catalogue_products_for_review(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.get_catalogue_reconciliation_review(TEXT, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.review_catalogue_reconciliation_candidate(UUID, TEXT, JSONB, TEXT[], JSONB, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.catalogue_reconciliation_approval_blockers(UUID);
DROP TRIGGER IF EXISTS catalogue_reconciliation_queue_initialize_edit
  ON public.catalogue_reconciliation_queue;
DROP FUNCTION IF EXISTS public.initialize_catalogue_reconciliation_edit_trigger();
DROP FUNCTION IF EXISTS public.initialize_catalogue_reconciliation_edit(UUID);
DROP FUNCTION IF EXISTS public.catalogue_category_for_atc(TEXT);

DROP TABLE IF EXISTS public.catalogue_product_promotions;
DROP TABLE IF EXISTS public.catalogue_reconciliation_edits;

ALTER TABLE public.catalogue_reconciliation_audit
  DROP COLUMN IF EXISTS previous_review_values,
  DROP COLUMN IF EXISTS new_review_values,
  DROP COLUMN IF EXISTS resolved_conflict_reasons,
  DROP COLUMN IF EXISTS resolution_evidence;

DROP FUNCTION IF EXISTS public.set_catalogue_reconciliation_decision(UUID, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.reconcile_catalogue_source_snapshot(UUID);
DROP TABLE IF EXISTS public.catalogue_reconciliation_audit;
DROP TABLE IF EXISTS public.catalogue_reconciliation_queue;
DROP TABLE IF EXISTS public.catalogue_source_records;
DROP TABLE IF EXISTS public.catalogue_source_snapshots;
DROP FUNCTION IF EXISTS public.touch_catalogue_source_updated_at();
DROP FUNCTION IF EXISTS public.normalize_catalogue_source_nrn(TEXT);
DROP FUNCTION IF EXISTS public.normalize_catalogue_source_text(TEXT);

COMMIT;
NOTIFY pgrst, 'reload schema';
```

Before running this block, assert that the promotion ledger is empty. Stop if it
is not:

```sql
SELECT COUNT(*) AS promotions_that_block_schema_only_rollback
FROM public.catalogue_product_promotions;
```

## Recovery after a promotion

Do not drop the provenance tables or reverse product rows ad hoc. First roll the
application back, stop catalogue-review writes, and preserve
`catalogue_product_promotions`. For a small reviewed batch, prepare a separately
reviewed corrective migration from each ledger row's `product_before` and
`product_after`. For broad or uncertain corruption, the authoritative fallback
is restoration from the verified pre-release dump in an approved maintenance
window:

```sh
npm run db:archive -- restore \
  --connection-file "$STOCMED_PRODUCTION_DATABASE_URL_FILE" \
  --archive "$CATALOGUE_REVIEW_BACKUP" \
  --confirm RESTORE_VERIFIED_ARCHIVE
```

## Post-rollback verification

- the application serves the known-good pre-review build;
- the products count and digest match the pre-release values;
- no orphaned or partially promoted catalogue identity remains;
- pharmacy inventory, matching, and Store-to-Medicine promotion still work;
- raw SQL, raw REST, and the application endpoint agree after the schema-cache
  reload.

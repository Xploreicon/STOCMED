# Catalogue expansion staging

Snapshot date: 2026-09-05
Package ZIP SHA-256: `10f0dd0faa5ac3ccdcfd5d367384d705217801474c10d08bd32c8578c6baf0ea`

This release stages external catalogue evidence for review. It does not change
`public.products`, pharmacy inventory, barcodes, or matching behavior.

## Inputs and scope

- Read the package's `AGENT_HANDOFF.md`, `README.md`, `DATA_DICTIONARY.md`,
  `coverage_summary.json`, and `file_manifest.json` before importing.
- JSONL is authoritative. CSV files are inspection copies only.
- Reconciliation uses a products-only production export. Do not clone pharmacy,
  patient, staff, authentication, or configuration data into a preview system.
- The supplied package is an expansion source, not an exhaustive or already
  deduplicated list of Nigerian medicines.

The validated package contains 14,300 source rows across 14 JSONL datasets,
including 7,627 human Greenbook records and 1,344 other regulated records. The
products-only comparison export contains 3,419 rows.

## Staging import

Apply `20260905150000_catalogue_source_staging.sql` to a non-production branch,
then set both environment variables before running the loader:

```bash
export CATALOGUE_STAGING_DATABASE_URL='<non-production postgres URL>'
export CATALOGUE_STAGING_CONFIRM_NON_PRODUCTION=YES
node scripts/catalogue/import-source-package.mjs \
  --package-dir '<extracted package directory>' \
  --package-zip '<package ZIP>' \
  --package-sha256 10f0dd0faa5ac3ccdcfd5d367384d705217801474c10d08bd32c8578c6baf0ea
```

The loader verifies all 33 manifest file digests and every JSONL row count
before it opens a database connection. It computes the ZIP digest itself,
rejects a changed row inside an existing snapshot, and uses
`(snapshot_id, dataset, record_id)` as the idempotency key.

It also refuses to run unless the explicit non-production confirmation is set,
and refuses a staging URL equal to `DATABASE_URL` or
`PRODUCTION_DATABASE_URL` when either is present.

## Reconciliation result

The full local staging run against the 3,419-row production export completed in
6.86 seconds. An immediate replay used the same snapshot and completed in 2.27
seconds without adding source or queue rows.

| Queue | Rows |
| --- | ---: |
| Existing identity / enrichment | 2,550 |
| Candidate new identity | 2,165 |
| Ambiguous / conflicting match | 3,764 |
| Non-human / non-medicine scope | 1,808 |
| **Total review rows** | **10,287** |

The remaining 4,013 source rows are supporting evidence such as manufacturers,
ingredient strings, formulary candidates, source registrations, duplicate
groups, alerts, aliases, and the unverified barcode candidate.

Queue labels are proposals, not approval outcomes. The reconciliation function
does not contain an `INSERT`, `UPDATE`, or `DELETE` against `public.products`.
The loader also compares the products row count before and after the transaction
and aborts if it changes.

## Safety behavior

- All 2,425 inactive human records are in the ambiguous queue. None became an
  existing or new identity proposal.
- All 466 human rows in repeated-NRN groups stay ambiguous. The 34 human rows in
  repeated source-fingerprint groups also stay ambiguous.
- Ninety-two exact-NRN comparisons have conflicting identity fields and stay
  unresolved.
- The 162 rows with unresolved ingredient-strength pairing remain review-held.
- All ten curated unregistered/alert records carry a regulatory alert hold.
- Brustan-N tablets, Brustan-N suspension, Brustan Plus, and Brustan Extra remain
  four distinct records and queue rows.
- `Daktarcort -> Daktacort` remains a suggestion with `auto_correct=false`.
- The one structurally valid retailer EAN remains supporting evidence only. It
  is not written to a verified barcode or crosswalk field.

`set_catalogue_reconciliation_decision` rejects approval while any safety or
identity requirement remains unresolved. The current `products` table does not
model route, release characteristics, or applicant/authorization holder, so
human proposals fail closed until that identity model and its evidence workflow
exist. Reject and hold decisions remain available and are written to an
append-only audit table.

## Verification completed

- Migration applied successfully to a temporary PostgreSQL database.
- Full package imported and reconciled against the products-only export.
- Same package replayed with identical source, queue, and snapshot counts.
- Transactional safety assertions passed for inactive records, repeated NRNs,
  alerts, Brustan variants, Daktarcort, decision authorization, audit history,
  and the products write boundary.
- Application tests: 32 files and 208 tests passed.

The repository pgtap test is
`supabase/tests/20260905150000_catalogue_source_staging.test.sql`. The local
Homebrew PostgreSQL installation did not include pgtap, so equivalent
transactional assertions were executed directly. CI or a Supabase preview must
still run the checked-in pgtap file before promotion.

## Promotion prerequisites

Do not apply this migration or source package to production yet. Before a
production release:

1. Apply the migration and loader on a Supabase preview branch.
2. Run the checked-in pgtap test and verify RLS as an authorized admin,
   authenticated non-admin, anonymous user, and service role.
3. Model route, release characteristics, and applicant/authorization holder, or
   retain the approval block.
4. Build an evidence-linked admin review interface. No automatic promotion.
5. Take a fresh production backup and SHA-256 immediately before any approved
   production migration.
6. Record a down migration and known-good application commit before deployment.

## Rollback boundary

Before production use, create a down migration that drops, in dependency order:

1. `set_catalogue_reconciliation_decision` and
   `reconcile_catalogue_source_snapshot`.
2. `catalogue_reconciliation_audit`, `catalogue_reconciliation_queue`,
   `catalogue_source_records`, and `catalogue_source_snapshots`.
3. `touch_catalogue_source_updated_at`, `normalize_catalogue_source_nrn`, and
   `normalize_catalogue_source_text`.

Dropping these staging objects does not reverse or alter `products`, because
this release never writes to the catalogue.

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
put its database URL in a mode-0600 file outside the repository, and expose only
the file path to the loader:

```bash
export CATALOGUE_STAGING_DATABASE_URL_FILE='/protected/path/preview-database-url'
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

The full isolated Supabase preview run against the 3,419-row production export
completed successfully. An immediate replay used the same snapshot without
adding source or queue rows.

| Queue | Rows |
| --- | ---: |
| Existing identity / enrichment | 2,543 |
| Candidate new identity | 2,165 |
| Ambiguous / conflicting match | 3,771 |
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
- Nine exact identity comparisons whose existing catalogue row carries a
  different non-null NAFDAC/NRN are forced into the ambiguous queue with an
  `identity_nrn_conflict`; they cannot ride the quick-enrichment path.
- The 162 rows with unresolved ingredient-strength pairing remain review-held.
- All ten curated unregistered/alert records carry a regulatory alert hold.
- Brustan-N tablets, Brustan-N suspension, Brustan Plus, and Brustan Extra remain
  four distinct records and queue rows.
- `Daktarcort -> Daktacort` remains a suggestion with `auto_correct=false`.
- The one structurally valid retailer EAN remains supporting evidence only. It
  is not written to a verified barcode or crosswalk field.

`review_catalogue_reconciliation_candidate` rejects approval while any safety
or identity requirement remains unresolved. Route, release characteristics,
and applicant/authorization-holder evidence remain attached to the immutable
source record and the promotion provenance; they are not unconditional
catalogue blockers. Reject and hold decisions remain available and every edit,
conflict resolution, and decision is written to the append-only audit table.

Approval and promotion are deliberately separate. Approval records the human
decision in staging only. A second explicit, administrator-only call to
`promote_catalogue_reconciliation_candidate` creates or enriches a product and
writes an immutable source-to-product provenance row. Active official NAFDAC
records approved by an authorized administrator use the existing official-source
convention and enter the catalogue with `is_verified=true`.

## Verification completed

- Both migrations applied successfully to an isolated local Supabase preview.
- Full package imported and reconciled against the products-only export.
- Same package replayed with identical source, queue, and snapshot counts.
- Transactional safety assertions passed for inactive records, repeated NRNs,
  alerts, identity/NRN conflicts, Brustan variants, Daktarcort, decision
  authorization, audit history, and the products write boundary.
- Catalogue database tests: 61 assertions passed across the staging and review
  migrations.
- Application tests: 38 files and 234 tests passed, including database-command
  credential-output regression coverage.
- TypeScript validation and the optimized Next.js production build passed.
- Browser verification used synthetic `.invalid` accounts only. An authorized
  admin could load, search, filter, edit, resolve and approve review rows; an
  authenticated pharmacist was redirected before the review shell loaded.
- Approval alone left `products` at 3,419 rows. Separate promotion enriched one
  existing product and inserted one new product, producing 3,420 rows and two
  provenance records. Replaying both promotion calls was an idempotent no-op.

The checked-in pgtap suites are
`supabase/tests/20260905150000_catalogue_source_staging.test.sql` and
`supabase/tests/20260906000000_catalogue_admin_review.test.sql`. The isolated
local Supabase preview proves the implementation. Hosted preview verification
is recorded separately after the production-base rebase and remains a
production-gate prerequisite until every check completes.

## Hosted preview verification after production-base rebase

The release was rebased onto production commit `06b62b1` and verified against
the isolated, no-data hosted preview project `swmxbnjzjwwhgaukrsin`. No production
pharmacy, patient, configuration, or inventory rows were copied. The preview was
bootstrapped with the current `public` schema, controlled dosage/category lookup
rows, and the products-only reference export. Two synthetic `.invalid` users
were created solely for the admin-versus-pharmacist route check.

The Supabase platform's automatic no-data branch replay stops in the historical
migration chain before these two migrations, so the branch status remains
`MIGRATIONS_FAILED`. That is a legacy clean-install issue, not a failure in the
catalogue migrations: the current production schema was restored schema-only,
the two reviewed migrations were applied directly in order, both `NOTIFY`
statements ran, and raw PostgREST immediately resolved the new objects. No
production data or production write was involved.

Hosted results:

- products seed: 3,419 rows; deterministic digest
  `f93e9d49b04d98c8ca0a51dbfbbb65a6`;
- source load and immediate replay: one snapshot, 14,300 immutable source rows,
  10,287 queue rows, and unchanged queue/source counts on replay;
- reconciliation buckets: 2,543 existing-identity enrichments, 2,165 candidate
  new identities, 3,771 ambiguous/conflicting rows, and 1,808 non-human or
  non-medicine rows;
- products before and after both loader runs: 3,419; importer mutation flag:
  false;
- hosted database tests: all 31 staging assertions and all 30 admin-review
  assertions passed against the populated queue. The fixtures now scope their
  own snapshot/search so they stay repeatable alongside real staged evidence;
- raw REST: the service role read the single snapshot, anonymous catalogue
  staging and admin-RPC calls were denied, and anonymous products count remained
  3,419. Permission errors, rather than missing-object errors, prove the schema
  cache saw the new tables/functions after `NOTIFY`;
- browser: the synthetic admin loaded the evidence view and all four bucket
  counts; a synthetic licensed pharmacist was redirected to `/dashboard` before
  the catalogue-review shell loaded;
- approval/promotion separation: one complete active NAFDAC record was approved
  while products stayed at 3,419 with the original digest. A separate explicit
  promotion inserted one verified product, changing preview products to 3,420
  and writing one provenance row. Two immediate replays returned HTTP 200 with
  the same product and created no duplicate;
- identity checks: the four Brustan presentations remain four source records;
  `Daktarcort -> Daktacort` remains `auto_correct=false` supporting evidence and
  creates no automatic queue/promotion row.

## Promotion prerequisites

Do not apply this migration or source package to production yet. Before a
production release:

1. Apply the migration and loader on a Supabase preview branch.
2. Run both checked-in pgtap tests and verify RLS as an authorized admin,
   authenticated non-admin, and anonymous user.
3. Verify the evidence-linked admin review interface and explicit, separate
   promotion action on preview. No automatic or bulk promotion.
4. Take a fresh production backup and SHA-256 immediately before any approved
   production migration.
5. Confirm production drift and the known-good application commit before
   deployment, then use the checked-in rollback runbook.

## Rollback boundary

Use `docs/catalogue-admin-review-rollback-2026-09-06.md`. Before the first
production promotion, the schema-only rollback leaves `products` unchanged.
After any promotion, retain the provenance tables and use an approved recovery
window; a blind down migration is not an authoritative way to undo catalogue
identity changes.

# DeLaw field stocktake onboarding

## Implemented

- Detect inventory headers below pharmacy titles and spacer rows in CSV and XLSX. Preserve physical source row numbers and every non-empty inventory row.
- Map product name, composition and manufacturer separately. When composition is present it supplies the generic name, while the supplied product name is retained as the brand/display name. Catalogue candidates still come from the original product name.
- Extract only a single explicit strength from a name (for example `500mg` or `25mg/1ml`). Do not invent strengths from bare numbers, bottle volumes or incomplete combination doses. Reviewers can confirm/edit strength before import.
- Interpret `MM/YY` and `MM/YYYY` expiry as month-end. Two-digit years mean 2000–2099. Do not silently repair old years or allow expired stock through the existing import checks.
- Keep missing/mixed-unit quantities unresolved, not zero. Preserve batch text and leading zeroes. Naira prices continue converting to integer Kobo in staging.
- Add the recommended dosage forms and categories through an additive migration. Keep existing catalogue references unchanged. Route-specific drops, ointments and gels remain distinct when matching. Unknown or combination classifications require review instead of fuzzy substitution.
- Load manual-add dropdowns from the same database lookup tables used by imports. Review can now display source errors and more than 150 rows.
- Pass manufacturer into new unverified catalogue products without modifying existing products. Preserve the atomic import engine, duplicate-import checks and the five-argument superintendent-authorization wrapper.
- Save every source row in a pharmacy-owned onboarding batch. Import complete rows independently; retain incomplete and failed rows for correction and resumption. Saved intake is not saleable stock.
- Detect already-stocked products conservatively and hold them for reconciliation rather than adding their opening stock again. Serialize submissions per pharmacy and retain committed row snapshots so retries do not double-import.
- Allow quantity, selling price, batch, expiry and strength corrections in the review screen. Offer save-only and save-and-import-ready actions, with reconciled result counts.

## Source acceptance and outstanding data

The supplied CSV and XLSX each contain 160 inventory rows and produce identical normalized staging data after excluding source row numbers. CSV headers are on row 3; XLSX headers are on row 4. The original files have not been modified or copied into the repository.

As of 26 September 2026:

| Check | Records needing review |
| --- | ---: |
| Blank or unit-bearing/mixed quantities | 30 |
| Missing selling price | 2 |
| Missing batch number | 7 |
| Missing expiry | 6 |
| Expiry month already past | 8 |

These counts overlap and must not be added. Three past-expiry records contain `09/09` or `04/09`; verify the printed dates rather than assuming the year was mistyped. Some names also lack an explicit strength, and several category descriptions or the ambiguous `Tablet/Capsule` form require pharmacist confirmation.

Missing prices are CSV rows 13 and 151. Missing batches are rows 62, 120, 125, 127, 154, 157 and 158. Missing expiry dates are rows 120, 125, 127, 154, 157 and 158. Past-expiry records are rows 12, 13, 37, 93, 95, 100, 146 and 153. Add one to locate the corresponding XLSX row.

Do not add packs and sachets without a confirmed pack conversion and price-per-selling-unit basis. Save the intake and resume it to correct confirmed values. The application deliberately does not bypass required medicine strength, controlled classification, catalogue selection, price, batch or expiry checks.

## Rollout

1. Apply the three `20260926` migrations before promoting the application release. Do not re-grant client access to the private four-argument import function.
2. In DeLaw's authenticated pharmacy account, upload one master file, not both versions. Save all rows, inspect existing-stock matches and unresolved rows, then import ready rows. Newly created catalogue entries remain unverified.
3. Resume the saved batch to complete pharmacist-confirmed missing values. Do not replace existing stock counts without a separate reconciliation decision.

## Verification

- Regression tests cover title rows, CSV/XLSX parity, source row numbering, month-end dates, leading-zero batch identifiers, identity mapping, route-specific forms, explicit strength extraction, category aliases and missing quantities.
- Optional local-file acceptance: set `FIELD_STOCKTAKE_DIR` to the folder containing the two original inventory files and run `npm test -- tests/unit/field-stocktake-import.test.ts`.
- Database regression coverage is in `supabase/tests/20260926000000_field_stocktake.test.sql`. Run it against a disposable local database with the migration chain applied before rollout.
- Local checks passed: unit suite (including both supplied files), TypeScript, targeted lint and whitespace checks. A regression test also confirms that the replacement atomic import function differs only in manufacturer forwarding.
- `scripts/test-onboarding-db.cjs` is a disposable-local-PostgreSQL contract test. It exercises the actual atomic import and onboarding engines with minimal dependency fixtures: tenant isolation, retries, partial failures and rollback, existing-stock detection, saved row retention, manufacturer forwarding and private-engine permissions. It refuses non-local database targets.

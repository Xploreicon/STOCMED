# NAFDAC Greenbook catalogue import

Snapshot date: 2026-07-24

## Access findings

NAFDAC Greenbook provides a public searchable web database at
<https://greenbook.nafdac.gov.ng/>. The search page uses an undocumented,
unauthenticated server-side DataTables JSON endpoint at the same URL. At the
time of extraction it reported 9,020 active and inactive records across drugs,
biologics, devices, veterinary products, and natural health products.

The JSON response includes product name, active ingredient, strength, dosage
form, pack size, NAFDAC registration number, ATC code, product category,
marketing category, status, approval/expiry dates, and manufacturer ID.
Manufacturer names are exposed in a separate public, paginated HTML index.
Individual product detail pages expose the same fields plus composition and
manufacturer details.

No documented public API or current full CSV/XLSX download was found. NAFDAC
also publishes an older PDF list of locally manufactured drugs for 2016-2018,
but it is not a suitable current catalogue source. The importer therefore
depends on a public but undocumented interface whose shape may change.
`robots.txt` contained no disallow rules at the time of extraction.

## Schema mapping

| Greenbook field | StocMed `products` field |
| --- | --- |
| `ingredient.ingredient_name` | `generic_name` |
| `product_name` | `brand_name` |
| manufacturer index name | `manufacturer` |
| `strength` | `strength` |
| `form.name` | `dosage_form` |
| `pack_size` | `pack_size` |
| `NAFDAC` | `nafdac_number` |
| `atc` | `atc_code` |
| marketing category POM | `requires_prescription=true` |
| active official record | `is_verified=true` |

Display-only `#`/`*` markers and the Greenbook's `(check pack size)` suffix are
removed from brand names. Other source values are preserved after HTML entity
decoding and whitespace normalization.

## First import scope

Only active human drugs with all requested catalogue fields were imported.
Fast-moving categories were selected by ATC prefix:

| StocMed category | ATC scope | Added |
| --- | --- | ---: |
| Analgesics | N02 | 410 |
| Antibiotics | J01 | 983 |
| Antimalarials | P01B | 504 |
| Antihypertensives | C02, C03, C07-C09 | 371 |
| Diabetes | A10 | 122 |
| Respiratory (antihistamines) | R06 | 102 |
| Gastrointestinal | A02-A04, A06, A07, A09 | 281 |
| Vitamins | A11, B03 | 175 |
| **Total** |  | **2,948** |

The importer removed 24 duplicate source rows using a normalized
`(generic_name, strength, dosage_form, pack_size, brand_name)` key. It observed
74 repeated NAFDAC numbers but retained records whose five-field catalogue key
differed. This is intentional because a registration can expose distinct
presentations and the legacy seed contains placeholder-looking NAFDAC values.

Excluded source records:

- 3,537 were inactive or not human drugs.
- 2,274 active human drugs were outside the first-priority ATC groups.
- 235 priority records had no pack size.
- 2 priority records had no NAFDAC registration number.

## Result and coverage

The configured catalogue grew from 341 to 3,289 products. Verified products
with a NAFDAC registration number grew from 300 to 3,248.

Final priority-category coverage:

| Category | Products | Distinct generics | Distinct brands |
| --- | ---: | ---: | ---: |
| Analgesics | 497 | 38 | 399 |
| Antibiotics | 1,110 | 95 | 986 |
| Antimalarials | 536 | 25 | 499 |
| Antihypertensives | 389 | 58 | 376 |
| Diabetes | 139 | 30 | 131 |
| Respiratory | 103 | 27 | 103 |
| Gastrointestinal | 284 | 77 | 283 |
| Vitamins | 217 | 79 | 189 |

`is_verified=true` means the row was mapped from an active official Greenbook
record in this snapshot. It does not assert current market availability or
replace batch-level authenticity checks.

## Refresh and fallback

Run `node scripts/import-nafdac-greenbook.mjs` to regenerate the idempotent
migration from the current public source. Review source counts and rejection
reasons before applying because the endpoint is undocumented.

If Greenbook access or response shape becomes unavailable, continue catalogue
growth through pilot-pharmacy inventory imports and the existing self-enriching
catalogue. Those rows should remain unverified until matched back to an
official registration record.

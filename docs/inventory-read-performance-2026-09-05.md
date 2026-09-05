# Inventory read performance baseline and contract

Date: 2026-09-05  
Environment measured: production, Ceres Pharmacy Ltd  
Production inventory at measurement: 2,670 active rows

This work changes only how the existing inventory payload is read. It does not
change catalogue contents, inventory identity, quantities, matching, or AI and
privacy behavior.

## P1.0 baseline

The authenticated `GET /api/pharmacy/drugs` request exceeded the browser's
23,267 ms navigation deadline and completed with the full JSON response during
the next five-second observation window. The cold response was therefore
between 23.3 and 28.3 seconds, matching the earlier 23–28 second reports.

Direct production checks separated the layers:

- direct SQL returned the promoted Tarivid row and the 13 Medicine / 2,657
  Store counts correctly;
- a raw PostgREST table read returned HTTP 200 in 549 ms;
- a raw PostgREST call to `reservation_sellable_quantities` returned HTTP 200
  in 502 ms;
- the application endpoint was slow because its implementation serialised many
  successful raw REST requests, not because PostgREST could not see the schema.

For 2,670 inventory rows, the legacy `getEnrichedInventory` issued 87 database
requests in sequence:

1. Six 500-row `pharmacy_inventory` pages, each embedding `products`, `batches`,
   and `selling_units`.
2. Twenty-seven 100-ID calls to `reservation_sellable_quantities`.
3. Twenty-seven 100-ID calls to `reservation_batch_quantities`.
4. Twenty-seven 100-ID reads from `stock_movements`.

The surrounding route also performs authentication and pharmacy-profile work;
the 87-to-1 target specifically replaces the inventory helper's database
fan-out.

## Output contract

The top-level response remains `{ drugs, stats }`. Every `drugs` row retains
these fields:

`id`, `pharmacy_id`, `product_id`, `item_type`, `tracks_expiry`,
`batch_capture_required`, `item_name`, `unit_description`, `store_category`,
`unit_cost`, `name`, `generic_name`, `brand_name`, `manufacturer`,
`nafdac_number`, `barcode`, `category`, `dosage_form`, `strength`, `pack_size`,
`requires_prescription`, `image_url`, `pharmacy_image_url`,
`display_image_url`, `price`, `quantity_in_stock`, `reserved_quantity`,
`sellable_quantity`, `low_stock_threshold`, `notes`, `is_listed`, `deleted_at`,
`created_at`, `updated_at`, `stock_status`, `expiry_date`, `is_expired`,
`is_expiring_soon`, `batches`, `selling_units`, `base_unit_name`, and
`whole_pack_only`.

Each `batches` entry retains `id`, `batch_number`, `expiry_date`,
`quantity_received`, `cost_price`, `remaining_qty`, `is_expired`, and
`is_expiring_soon`. Empty or fully consumed batches remain filtered out, and
the active entries remain ordered by expiry date.

Each `selling_units` entry preserves the database row fields returned before
this change, including `id`, `inventory_id`, `unit_name`, `units_per`, `price`,
`barcode`, `is_default`, `sort_order`, `created_at`, and `updated_at`.

`stats` retains `total`, `in_stock`, `low_stock`, `out_of_stock`, and
`expiring_soon`.

## Set-based replacement

`get_pharmacy_inventory_enriched(pharmacy_id, show_delisted)` performs one
owner-scoped, set-based read. It returns inventory and catalogue fields,
selling units, batch ledger totals, active reservations, batch reservations,
and server-computed sellable quantities in one PostgREST RPC response. The
existing TypeScript projection still produces the public payload contract.

The function is `SECURITY DEFINER`, permits only the owning authenticated
pharmacy (plus `service_role` for controlled verification), and is not
executable by `anon`.

An isolated PostgreSQL fixture with 2,670 inventory rows executed the final
single-JSON-array function in **30.168 ms** (`EXPLAIN ANALYZE`) and returned all
2,670 rows without exposure to PostgREST's 1,000-row set limit. The same
fixture verified stock 10 − reservation 3 = sellable 7, batch-ledger and
batch-reservation aggregation, selling-unit inclusion, and a zero-row result
for a different authenticated pharmacy. This is database execution evidence;
the hosted preview result below is the end-to-end release evidence.

## Hosted preview gate

The exact migration was applied to the isolated
`store-promotion-prompt-b-preview` branch. The branch retained its 3,419-row
catalogue and received deterministic synthetic Store rows only, bringing one
test pharmacy to 2,670 active inventory rows. No production inventory or
patient data was cloned.

The migration's final `NOTIFY pgrst, 'reload schema';` made the function
available to the very next raw REST call; no manual cache reload or project
restart was required. The checked-in comparison command was:

```bash
INVENTORY_READ_VERIFY_CONFIRM_NON_PRODUCTION=YES \
INVENTORY_READ_VERIFY_SUPABASE_URL='<preview URL>' \
INVENTORY_READ_VERIFY_SERVICE_ROLE_KEY='<preview service-role key>' \
INVENTORY_READ_VERIFY_PHARMACY_ID='<test pharmacy UUID>' \
INVENTORY_READ_VERIFY_MIN_ROWS=2670 \
node scripts/inventory/verify-set-based-read.mjs
```

The script performs both reads, fails on the first field-level difference, and
prints only row count, timing, request count, and a canonical SHA-256—not the
inventory contents. The hosted preview result was:

- rows: **2,670**;
- legacy path: **87 requests, 19,330 ms**;
- set-based path: **1 request, 666 ms**;
- canonical payload equality: **true**;
- payload SHA-256:
  `2fdb60bfa177e491a7bd93ee630e90703d45f8d4fcce7eb10ebeadfbe70ac43f`.

The preview security checks also passed: the owner received all 2,670 rows, a
different authenticated pharmacy received zero, and an anonymous REST call
was denied with HTTP 401. The 14-test pgTAP suite passed, including reservation
and batch availability, product strength, selling units, Store null-product
shape, `SECURITY DEFINER`, stable/read-only volatility, and grants.

This clears the preview performance and equivalence gate. Production remains
untouched; promotion still requires a fresh production backup, a documented
rollback path, coordinated migration plus app deployment, and the same timing,
payload, security, and 3,419-row catalogue checks in production.

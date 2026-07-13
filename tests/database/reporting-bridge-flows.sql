\set ON_ERROR_STOP on

BEGIN;

SELECT u.user_id AS pharmacy_user_id, ph.id AS pharmacy_id
FROM public.users u
JOIN public.pharmacies ph ON ph.user_id = u.user_id
WHERE u.email = 'pharmacy.test@stocmed.local'
LIMIT 1
\gset

SELECT p.id AS product_id
FROM public.products p
LIMIT 1
\gset

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'pharmacy_user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT public.stage_quickbooks_import(
  :'pharmacy_id'::uuid,
  jsonb_build_array(jsonb_build_object(
    'selected_product_id', :'product_id'::uuid,
    'mapped', jsonb_build_object(
      'generic_name', 'QuickBooks fixture',
      'sku', 'QB-TXN-1',
      'quantity', 3,
      'unit_cost', 100,
      'price', 150
    )
  ))
) AS staged_result;

SELECT id AS staging_id
FROM public.quickbooks_import_staging
WHERE pharmacy_id = :'pharmacy_id'::uuid AND sku = 'QB-TXN-1' AND status = 'pending'
ORDER BY created_at DESC LIMIT 1
\gset

SELECT public.capture_quickbooks_expiry(
  :'pharmacy_id'::uuid,
  :'staging_id'::uuid,
  'QB-TXN-BATCH-1',
  CURRENT_DATE + 365
) AS capture_result;

SELECT CASE WHEN COUNT(*) = 1 THEN true ELSE false END AS bridge_atomic
FROM public.batches b
JOIN public.stock_movements sm ON sm.batch_id = b.id
WHERE b.batch_number = 'QB-TXN-BATCH-1'
  AND b.cost_price = 100
  AND sm.quantity = 3
  AND sm.type = 'opening'
\gset
\if :bridge_atomic
\else
  \echo 'QuickBooks expiry capture was not atomic'
  \quit 1
\endif

SELECT COUNT(*) >= 0 AS reorder_rpc_worked
FROM public.get_reorder_suggestions(:'pharmacy_id'::uuid, 8)
\gset
\if :reorder_rpc_worked
\else
  \quit 1
\endif

SELECT
  reports ?& ARRAY['daily_sales','stock_valuation','margin_per_product','dead_stock','expiry_exposure']
    AS five_reports_present
FROM (SELECT public.get_pharmacy_reports(:'pharmacy_id'::uuid, CURRENT_DATE - 30, CURRENT_DATE) AS reports) result
\gset
\if :five_reports_present
\else
  \echo 'One or more required reports are missing'
  \quit 1
\endif

RESET ROLE;
ROLLBACK;

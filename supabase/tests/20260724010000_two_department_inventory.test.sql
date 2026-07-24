BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(19);

INSERT INTO public.products (
  id, generic_name, brand_name, strength, dosage_form, category, pack_size, is_verified
) VALUES (
  '81000000-0000-4000-8000-000000000001',
  'Two Department Paracetamol', 'TestMed', '500mg', 'tablet', 'Analgesics', '10s', TRUE
);

INSERT INTO public.pharmacy_inventory (
  id, pharmacy_id, product_id, item_type, tracks_expiry,
  price, unit_cost, low_stock_threshold, quantity_in_stock, is_listed
) VALUES (
  '82000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'medicine', TRUE, 100, 60, 2, 0, TRUE
);
INSERT INTO public.pharmacy_inventory (
  id, pharmacy_id, product_id, item_type, tracks_expiry,
  item_name, brand, barcode, unit_description, store_category,
  price, unit_cost, low_stock_threshold, quantity_in_stock, is_listed
) VALUES
(
  '82000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  NULL, 'store', FALSE, 'TwoDepartmentSoap', 'TestClean',
  '2000000000002', '75g bar', 'Personal care', 200, 100, 2, 0, TRUE
),
(
  '82000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  NULL, 'store', TRUE, 'TwoDepartmentFormula', 'TestBaby',
  '2000000000003', '400g tin', 'Baby care', 300, 180, 2, 0, TRUE
);

INSERT INTO public.batches (
  id, inventory_id, batch_number, expiry_date, quantity_received, cost_price
) VALUES
(
  '83000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'MED-01', CURRENT_DATE + 365, 10, 60
),
(
  '83000000-0000-4000-8000-000000000003',
  '82000000-0000-4000-8000-000000000003',
  'STORE-EXP-01', CURRENT_DATE + 180, 10, 180
);
INSERT INTO public.stock_movements (
  inventory_id, batch_id, type, quantity, reason, reference
) VALUES
(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  'opening', 10, 'two department test', 'TEST'
),
(
  '82000000-0000-4000-8000-000000000002',
  NULL, 'opening', 10, 'two department test', 'TEST'
),
(
  '82000000-0000-4000-8000-000000000003',
  '83000000-0000-4000-8000-000000000003',
  'opening', 10, 'two department test', 'TEST'
);

SELECT throws_ok(
  $$INSERT INTO public.pharmacy_inventory (
      pharmacy_id, product_id, item_type, tracks_expiry, item_name, price
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000001',
      'store', FALSE, 'Invalid store', 1
    )$$,
  '23514',
  NULL,
  'store items cannot reference the medicine catalogue'
);
SELECT throws_ok(
  $$INSERT INTO public.pharmacy_inventory (
      pharmacy_id, product_id, item_type, tracks_expiry, price
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000001',
      'medicine', FALSE, 1
    )$$,
  '23514',
  NULL,
  'medicine must always track expiry'
);
SELECT is(
  (SELECT product_id FROM public.pharmacy_inventory WHERE id = '82000000-0000-4000-8000-000000000002'),
  NULL::UUID,
  'store row has no product ID'
);
SELECT is(
  (
    SELECT COUNT(*)
    FROM public.match_catalogue_product('TwoDepartmentSoap') match
    JOIN public.pharmacy_inventory inventory ON inventory.product_id = match.id
    WHERE inventory.item_type = 'store'
  ),
  0::BIGINT,
  'direct catalogue search results cannot resolve to a Store item'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT COUNT(*) FROM public.pharmacy_inventory
   WHERE id IN (
     '82000000-0000-4000-8000-000000000002',
     '82000000-0000-4000-8000-000000000003'
   )),
  0::BIGINT,
  'patient RLS cannot read Store inventory'
);
SELECT is(
  (SELECT COUNT(*) FROM public.pharmacy_inventory
   WHERE id = '82000000-0000-4000-8000-000000000001'),
  1::BIGINT,
  'patient RLS still exposes listed medicine'
);
RESET ROLE;

SELECT is(
  has_function_privilege('authenticated', 'public.sync_pos_sale(uuid,jsonb)', 'EXECUTE'),
  FALSE,
  'lower-level POS sync remains inaccessible to clients'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', TRUE);
END $$;
SELECT lives_ok(
  $$SELECT public.sync_pos_sale(
    '30000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id', '84000000-0000-4000-8000-000000000001',
      'payment_method', 'cash',
      'discount', 60,
      'items', jsonb_build_array(
        jsonb_build_object(
          'inventory_id', '82000000-0000-4000-8000-000000000001',
          'batch_id', '83000000-0000-4000-8000-000000000001',
          'quantity', 1
        ),
        jsonb_build_object(
          'inventory_id', '82000000-0000-4000-8000-000000000002',
          'batch_id', NULL,
          'quantity', 1
        ),
        jsonb_build_object(
          'inventory_id', '82000000-0000-4000-8000-000000000003',
          'batch_id', '83000000-0000-4000-8000-000000000003',
          'quantity', 1
        )
      )
    )
  )$$,
  'medicine and both Store expiry modes complete in one sale'
);
SELECT is(
  (SELECT COUNT(*) FROM public.sale_items WHERE sale_id = '84000000-0000-4000-8000-000000000001'),
  3::BIGINT,
  'mixed sale writes three lines'
);
SELECT is(
  (SELECT COUNT(*) FROM public.sale_items
   WHERE sale_id = '84000000-0000-4000-8000-000000000001' AND batch_id IS NULL),
  1::BIGINT,
  'only the non-expiry Store line is batchless'
);
SELECT is(
  (SELECT total FROM public.sales WHERE id = '84000000-0000-4000-8000-000000000001'),
  540::NUMERIC,
  'mixed sale total reconciles after discount'
);
SELECT is(
  (SELECT quantity_in_stock FROM public.pharmacy_inventory WHERE id = '82000000-0000-4000-8000-000000000002'),
  9,
  'batchless Store sale decrements the shared ledger'
);

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE product_count_before AS SELECT COUNT(*) AS count FROM public.products;
SELECT lives_ok(
  $$SELECT public.import_inventory_file(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_array(
      jsonb_build_object(
        'selected_product_id', '',
        'mapped', jsonb_build_object(
          'item_type', 'store', 'tracks_expiry', FALSE,
          'generic_name', 'Imported Private Store Item',
          'brand_name', 'Private Brand', 'sku', '2000000000099',
          'category', 'Household', 'pack_size', '1 unit',
          'price', 450, 'unit_cost', 300, 'quantity', 5
        )
      ),
      jsonb_build_object(
        'selected_product_id', '81000000-0000-4000-8000-000000000001',
        'mapped', jsonb_build_object(
          'item_type', 'medicine', 'generic_name', 'Two Department Paracetamol',
          'price', 100, 'unit_cost', 60, 'quantity', 2,
          'batch_number', 'MED-IMPORT', 'expiry_date', CURRENT_DATE + 500
        )
      )
    )
  )$$,
  'one import atomically accepts medicine and Store rows'
);
SELECT is(
  (SELECT COUNT(*) FROM public.products),
  (SELECT count FROM product_count_before),
  'Store import does not create a shared catalogue product'
);
SELECT is(
  (SELECT item_type::TEXT FROM public.pharmacy_inventory WHERE item_name = 'Imported Private Store Item'),
  'store',
  'unmatched imported item is tenant Store stock'
);
SELECT throws_ok(
  $$SELECT public.import_inventory_file(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_array(
      jsonb_build_object(
        'selected_product_id', '',
        'mapped', jsonb_build_object(
          'item_type', 'store', 'tracks_expiry', FALSE,
          'generic_name', 'Must Roll Back', 'price', 100, 'quantity', 1
        )
      ),
      jsonb_build_object(
        'selected_product_id', '',
        'mapped', jsonb_build_object(
          'item_type', 'medicine', 'generic_name', 'Invalid medicine',
          'price', 100, 'quantity', 1
        )
      )
    )
  )$$,
  'P0001',
  NULL,
  'a failed row rolls back the whole import'
);
SELECT is(
  (SELECT COUNT(*) FROM public.pharmacy_inventory WHERE item_name = 'Must Roll Back'),
  0::BIGINT,
  'atomic import leaves no partial Store row'
);
SELECT is(
  (
    SELECT (day->>'medicine_sales')::NUMERIC + (day->>'store_sales')::NUMERIC
    FROM jsonb_array_elements(
      public.get_pharmacy_reports(
        '30000000-0000-4000-8000-000000000001',
        CURRENT_DATE,
        CURRENT_DATE
      )->'daily_sales'
    ) day
    LIMIT 1
  ),
  (
    SELECT (day->>'total_sales')::NUMERIC
    FROM jsonb_array_elements(
      public.get_pharmacy_reports(
        '30000000-0000-4000-8000-000000000001',
        CURRENT_DATE,
        CURRENT_DATE
      )->'daily_sales'
    ) day
    LIMIT 1
  ),
  'department sales reconcile to the combined total'
);
SELECT is(
  (
    SELECT COUNT(DISTINCT row->>'department')
    FROM jsonb_array_elements(
      public.get_pharmacy_reports(
        '30000000-0000-4000-8000-000000000001',
        CURRENT_DATE,
        CURRENT_DATE
      )->'stock_valuation'
    ) row
    WHERE row->>'inventory_id' IN (
      '82000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000002'
    )
  ),
  2::BIGINT,
  'stock valuation contains both departments'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

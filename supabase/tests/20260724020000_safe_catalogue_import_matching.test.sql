BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

INSERT INTO public.products (
  id, generic_name, brand_name, strength, dosage_form, category, is_verified
) VALUES
(
  '91000000-0000-4000-8000-000000000001',
  'SafetyMatch QZX', 'Safe Tablet', '500 mg', 'tablet', 'Analgesics', TRUE
),
(
  '91000000-0000-4000-8000-000000000002',
  'SafetyMatch QZX', 'Wrong Syrup', '500 mg', 'syrup', 'Analgesics', TRUE
),
(
  '91000000-0000-4000-8000-000000000003',
  'SafetyMatch QZX', 'Wrong Strength', '250 mg', 'tablet', 'Analgesics', TRUE
);

SELECT is(
  (
    SELECT id FROM public.match_catalogue_product_for_import(
      'SafetyMatch QZX', NULL, '500mg', 'Tablet'
    ) LIMIT 1
  ),
  '91000000-0000-4000-8000-000000000001'::UUID,
  'exact generic, strength, and form ranks first'
);
SELECT is(
  (
    SELECT strength_match FROM public.match_catalogue_product_for_import(
      'SafetyMatch QZX', NULL, '500mg', 'Tablet'
    ) WHERE id = '91000000-0000-4000-8000-000000000001'
  ),
  TRUE,
  'equivalent strength spacing matches'
);
SELECT is(
  (
    SELECT form_match FROM public.match_catalogue_product_for_import(
      'SafetyMatch QZX', NULL, '500mg', 'Tablets'
    ) WHERE id = '91000000-0000-4000-8000-000000000001'
  ),
  TRUE,
  'tablet plural normalizes safely'
);
SELECT is(
  (
    SELECT form_match FROM public.match_catalogue_product_for_import(
      'SafetyMatch QZX', NULL, '500mg', 'Tablet'
    ) WHERE id = '91000000-0000-4000-8000-000000000002'
  ),
  FALSE,
  'syrup conflict is explicit'
);
SELECT cmp_ok(
  (
    SELECT confidence FROM public.match_catalogue_product_for_import(
      'SafetyMatch QZX', NULL, '500mg', 'Tablet'
    ) WHERE id = '91000000-0000-4000-8000-000000000002'
  ),
  '<',
  0.31::NUMERIC,
  'form conflict is capped below auto-accept'
);
SELECT ok(
  (
    SELECT mismatch_reasons @> ARRAY['form differs']
    FROM public.match_catalogue_product_for_import(
      'SafetyMatch QZX', NULL, '500mg', 'Tablet'
    ) WHERE id = '91000000-0000-4000-8000-000000000002'
  ),
  'form conflict is labelled'
);
SELECT is(
  (
    SELECT strength_match FROM public.match_catalogue_product_for_import(
      'SafetyMatch QZX', NULL, '500mg', 'Tablet'
    ) WHERE id = '91000000-0000-4000-8000-000000000003'
  ),
  FALSE,
  'strength conflict is explicit'
);
SELECT cmp_ok(
  (
    SELECT confidence FROM public.match_catalogue_product_for_import(
      'SafetyMatch QZX', NULL, '500mg', 'Tablet'
    ) WHERE id = '91000000-0000-4000-8000-000000000003'
  ),
  '<',
  0.26::NUMERIC,
  'strength conflict is capped below auto-accept'
);
SELECT ok(
  (
    SELECT mismatch_reasons @> ARRAY['strength differs']
    FROM public.match_catalogue_product_for_import(
      'SafetyMatch QZX', NULL, '500mg', 'Tablet'
    ) WHERE id = '91000000-0000-4000-8000-000000000003'
  ),
  'strength conflict is labelled'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.match_catalogue_product_for_import(text,text,text,text)',
    'EXECUTE'
  ),
  TRUE,
  'authenticated import flow can execute the safe matcher'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.import_inventory_file(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'selected_product_id', '91000000-0000-4000-8000-000000000001',
      'mapped', jsonb_build_object(
        'item_type', 'medicine', 'generic_name', 'SafetyMatch QZX',
        'strength', '250mg', 'dosage_form', 'tablet',
        'price', 100, 'quantity', 1,
        'batch_number', 'UNSAFE-STRENGTH', 'expiry_date', CURRENT_DATE + 365
      )
    ))
  )$$,
  'P0001',
  NULL,
  'database import boundary rejects a conflicting strength'
);
SELECT throws_ok(
  $$SELECT public.import_inventory_file(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'selected_product_id', '91000000-0000-4000-8000-000000000001',
      'mapped', jsonb_build_object(
        'item_type', 'medicine', 'generic_name', 'SafetyMatch QZX',
        'strength', '500mg', 'dosage_form', 'syrup',
        'price', 100, 'quantity', 1,
        'batch_number', 'UNSAFE-FORM', 'expiry_date', CURRENT_DATE + 365
      )
    ))
  )$$,
  'P0001',
  NULL,
  'database import boundary rejects a conflicting dosage form'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

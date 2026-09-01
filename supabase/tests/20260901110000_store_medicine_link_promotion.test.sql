BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT plan(17);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'f5100000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'prompt-b-owner@stocmed.invalid',
    '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f5100000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'prompt-b-other@stocmed.invalid',
    '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
  );

DO $fixture$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    INSERT INTO public.users (id, user_id, email, full_name, phone, role) VALUES
      (
        'f5100000-0000-4000-8000-000000000001',
        'f5100000-0000-4000-8000-000000000001',
        'prompt-b-owner@stocmed.invalid', 'Prompt B Owner', '+2348000000511', 'pharmacy'
      ),
      (
        'f5100000-0000-4000-8000-000000000002',
        'f5100000-0000-4000-8000-000000000002',
        'prompt-b-other@stocmed.invalid', 'Prompt B Other', '+2348000000512', 'pharmacy'
      );
  ELSE
    INSERT INTO public.users (user_id, email, full_name, phone, role) VALUES
      (
        'f5100000-0000-4000-8000-000000000001',
        'prompt-b-owner@stocmed.invalid', 'Prompt B Owner', '+2348000000511', 'pharmacy'
      ),
      (
        'f5100000-0000-4000-8000-000000000002',
        'prompt-b-other@stocmed.invalid', 'Prompt B Other', '+2348000000512', 'pharmacy'
      );
  END IF;
END
$fixture$;

INSERT INTO public.pharmacies (
  id, user_id, pharmacy_name, license_number, address, city, state, phone, is_active
) VALUES
  (
    'f5110000-0000-4000-8000-000000000001',
    'f5100000-0000-4000-8000-000000000001',
    'Prompt B Owner Pharmacy', '9024511',
    '11 Link Street', 'Ikeja', 'Lagos', '+2348000000511', TRUE
  ),
  (
    'f5110000-0000-4000-8000-000000000002',
    'f5100000-0000-4000-8000-000000000002',
    'Prompt B Other Pharmacy', '9024512',
    '12 Link Street', 'Ikeja', 'Lagos', '+2348000000512', TRUE
  );

INSERT INTO public.products (
  id, generic_name, brand_name, strength, dosage_form, category, is_verified
) VALUES
  (
    'f5120000-0000-4000-8000-000000000001',
    'Levocetirizine', 'Xyzal', '5mg', 'tablet', 'Others', TRUE
  ),
  (
    'f5120000-0000-4000-8000-000000000002',
    'Clotrimazole + Hydrocortisone', 'Daktacort', '2% + 1%', 'cream', 'Others', TRUE
  );

INSERT INTO public.pharmacy_inventory (
  id, pharmacy_id, product_id, item_type, tracks_expiry, item_name,
  unit_description, store_category, price, quantity_in_stock,
  low_stock_threshold, is_listed, batch_capture_required
) VALUES
  (
    'f5130000-0000-4000-8000-000000000001',
    'f5110000-0000-4000-8000-000000000001', NULL, 'store', FALSE,
    'XYZAL TAB', '5MG', 'Airtime/Other', 2500, 12, 3, TRUE, FALSE
  ),
  (
    'f5130000-0000-4000-8000-000000000002',
    'f5110000-0000-4000-8000-000000000001', NULL, 'store', FALSE,
    'DAKTACORT CREAM', NULL, 'Airtime/Other', 4200, 4, 2, TRUE, FALSE
  ),
  (
    'f5130000-0000-4000-8000-000000000003',
    'f5110000-0000-4000-8000-000000000002', NULL, 'store', FALSE,
    'OTHER PHARMACY XYZAL', NULL, 'Airtime/Other', 2400, 2, 1, TRUE, FALSE
  );

SELECT ok(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'public.update_pharmacy_inventory_item(uuid,jsonb,text)'::regprocedure),
  'inventory update RPC remains SECURITY DEFINER'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.update_pharmacy_inventory_item(uuid,jsonb,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.update_pharmacy_inventory_item(uuid,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.update_pharmacy_inventory_item(uuid,jsonb,text)', 'EXECUTE'),
  'authenticated and service roles can execute while anonymous callers cannot'
);
SELECT ok(
  POSITION('product_id IS NOT NULL' IN pg_get_constraintdef((
    SELECT oid FROM pg_constraint
    WHERE conrelid = 'public.pharmacy_inventory'::regclass
      AND conname = 'pharmacy_inventory_department_shape'
  ))) > 0,
  'Medicine-to-product constraint remains unchanged'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000001', TRUE);
END
$$;
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.update_pharmacy_inventory_item(
    'f5130000-0000-4000-8000-000000000001',
    '{"product_id":"f5120000-0000-4000-8000-000000000001"}'::jsonb,
    NULL
  )$$,
  'P0001', 'Promotion must set only item_type and product_id together',
  'a catalogue link cannot be written without the transition'
);
SELECT throws_ok(
  $$SELECT public.update_pharmacy_inventory_item(
    'f5130000-0000-4000-8000-000000000001',
    '{"item_type":"store","product_id":"f5120000-0000-4000-8000-000000000001"}'::jsonb,
    NULL
  )$$,
  'P0001', 'Store inventory can only be promoted to medicine',
  'the transition cannot be used for arbitrary identity changes'
);
SELECT throws_ok(
  $$SELECT public.update_pharmacy_inventory_item(
    'f5130000-0000-4000-8000-000000000001',
    '{"item_type":"medicine","product_id":"f5120000-0000-4000-8000-000000000099"}'::jsonb,
    NULL
  )$$,
  'P0001', 'Selected catalogue product does not exist',
  'a missing catalogue product cannot promote a Store item'
);
SELECT lives_ok(
  $$SELECT public.update_pharmacy_inventory_item(
    'f5130000-0000-4000-8000-000000000001',
    '{"item_type":"medicine","product_id":"f5120000-0000-4000-8000-000000000001"}'::jsonb,
    NULL
  )$$,
  'the owner can promote by linking a real catalogue product'
);
RESET ROLE;

SELECT is(
  (SELECT item_type::TEXT FROM public.pharmacy_inventory
   WHERE id = 'f5130000-0000-4000-8000-000000000001'),
  'medicine',
  'the item is now in Medicines'
);
SELECT is(
  (SELECT product_id FROM public.pharmacy_inventory
   WHERE id = 'f5130000-0000-4000-8000-000000000001'),
  'f5120000-0000-4000-8000-000000000001'::UUID,
  'the promoted item links to the selected catalogue product'
);
SELECT ok(
  (SELECT tracks_expiry AND batch_capture_required
   FROM public.pharmacy_inventory
   WHERE id = 'f5130000-0000-4000-8000-000000000001'),
  'promotion enables expiry tracking and requires batch capture'
);
SELECT is(
  (SELECT quantity_in_stock FROM public.pharmacy_inventory
   WHERE id = 'f5130000-0000-4000-8000-000000000001'),
  12,
  'promotion preserves existing stock quantity'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000001', TRUE);
END
$$;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.update_pharmacy_inventory_item(
    'f5130000-0000-4000-8000-000000000001',
    '{"item_type":"medicine","product_id":"f5120000-0000-4000-8000-000000000001"}'::jsonb,
    NULL
  )$$,
  'retrying the same completed promotion is safe'
);
SELECT throws_ok(
  $$SELECT public.update_pharmacy_inventory_item(
    'f5130000-0000-4000-8000-000000000001',
    '{"item_type":"medicine","product_id":"f5120000-0000-4000-8000-000000000002"}'::jsonb,
    NULL
  )$$,
  'P0001', 'Only a Store item can be promoted to Medicine',
  'a Medicine cannot be relinked to a different catalogue identity'
);
RESET ROLE;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000001', TRUE);
END
$$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.update_pharmacy_inventory_item(
    'f5130000-0000-4000-8000-000000000003',
    '{"item_type":"medicine","product_id":"f5120000-0000-4000-8000-000000000002"}'::jsonb,
    NULL
  )$$,
  'P0001', 'Inventory item not found',
  'one pharmacy cannot promote another pharmacy inventory item'
);
RESET ROLE;
SELECT is(
  (SELECT item_type::TEXT FROM public.pharmacy_inventory
   WHERE id = 'f5130000-0000-4000-8000-000000000003'),
  'store',
  'the other pharmacy item remains untouched'
);

INSERT INTO public.pharmacy_inventory (
  id, pharmacy_id, product_id, item_type, tracks_expiry, price,
  quantity_in_stock, low_stock_threshold, is_listed, batch_capture_required
) VALUES (
  'f5130000-0000-4000-8000-000000000004',
  'f5110000-0000-4000-8000-000000000001',
  'f5120000-0000-4000-8000-000000000002',
  'medicine', TRUE, 4000, 1, 1, TRUE, TRUE
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000001', TRUE);
END
$$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.update_pharmacy_inventory_item(
    'f5130000-0000-4000-8000-000000000002',
    '{"item_type":"medicine","product_id":"f5120000-0000-4000-8000-000000000002"}'::jsonb,
    NULL
  )$$,
  'P0001', 'This catalogue medicine is already in inventory',
  'promotion cannot create duplicate catalogue stock'
);
RESET ROLE;
SELECT is(
  (SELECT item_type::TEXT FROM public.pharmacy_inventory
   WHERE id = 'f5130000-0000-4000-8000-000000000002'),
  'store',
  'the duplicate target remains safely in Store'
);

SELECT * FROM finish();
ROLLBACK;

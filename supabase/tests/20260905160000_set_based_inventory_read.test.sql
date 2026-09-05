BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT plan(14);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'f5200000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'inventory-read-owner@stocmed.invalid',
    '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f5200000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'inventory-read-other@stocmed.invalid',
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
        'f5200000-0000-4000-8000-000000000001',
        'f5200000-0000-4000-8000-000000000001',
        'inventory-read-owner@stocmed.invalid', 'Inventory Read Owner',
        '+2348000000521', 'pharmacy'
      ),
      (
        'f5200000-0000-4000-8000-000000000002',
        'f5200000-0000-4000-8000-000000000002',
        'inventory-read-other@stocmed.invalid', 'Inventory Read Other',
        '+2348000000522', 'pharmacy'
      );
  ELSE
    INSERT INTO public.users (user_id, email, full_name, phone, role) VALUES
      (
        'f5200000-0000-4000-8000-000000000001',
        'inventory-read-owner@stocmed.invalid', 'Inventory Read Owner',
        '+2348000000521', 'pharmacy'
      ),
      (
        'f5200000-0000-4000-8000-000000000002',
        'inventory-read-other@stocmed.invalid', 'Inventory Read Other',
        '+2348000000522', 'pharmacy'
      );
  END IF;
END
$fixture$;

INSERT INTO public.pharmacies (
  id, user_id, pharmacy_name, license_number, address, city, state, phone,
  is_active, reservations_enabled
) VALUES
  (
    'f5210000-0000-4000-8000-000000000001',
    'f5200000-0000-4000-8000-000000000001',
    'Inventory Read Owner Pharmacy', '9024521', '21 Set Street',
    'Ikeja', 'Lagos', '+2348000000521', TRUE, TRUE
  ),
  (
    'f5210000-0000-4000-8000-000000000002',
    'f5200000-0000-4000-8000-000000000002',
    'Inventory Read Other Pharmacy', '9024522', '22 Set Street',
    'Ikeja', 'Lagos', '+2348000000522', TRUE, TRUE
  );

-- The verification lifecycle trigger intentionally forces new pharmacy
-- fixtures to reservations-disabled. Enable reservations only for this
-- rolled-back test fixture so reservation aggregation can be asserted.
SELECT set_config('app.pilot_role_provenance_reset', 'on', TRUE);
UPDATE public.pharmacies
SET reservations_enabled = TRUE
WHERE id = 'f5210000-0000-4000-8000-000000000001';
SELECT set_config('app.pilot_role_provenance_reset', 'off', TRUE);

INSERT INTO public.products (
  id, generic_name, brand_name, strength, dosage_form, category, is_verified
) VALUES
  (
    'f5220000-0000-4000-8000-000000000001',
    'Ofloxacin', 'Tarivid 200 mg Tablet', '200 mg', 'tablet', NULL, TRUE
  ),
  (
    'f5220000-0000-4000-8000-000000000002',
    'Levocetirizine', 'Xyzal', '5 mg', 'tablet', NULL, TRUE
  );

INSERT INTO public.pharmacy_inventory (
  id, pharmacy_id, product_id, item_type, tracks_expiry, item_name,
  unit_description, store_category, price, quantity_in_stock,
  low_stock_threshold, is_listed, batch_capture_required, deleted_at
) VALUES
  (
    'f5230000-0000-4000-8000-000000000001',
    'f5210000-0000-4000-8000-000000000001',
    'f5220000-0000-4000-8000-000000000001', 'medicine', TRUE,
    'Tarivid 200mg', '10 tablets', NULL, 500, 0, 5, TRUE, FALSE, NULL
  ),
  (
    'f5230000-0000-4000-8000-000000000002',
    'f5210000-0000-4000-8000-000000000001',
    NULL, 'store', FALSE, 'Custard', '500 g', 'Food', 1500, 4, 2, TRUE, FALSE, NULL
  ),
  (
    'f5230000-0000-4000-8000-000000000003',
    'f5210000-0000-4000-8000-000000000001',
    'f5220000-0000-4000-8000-000000000002', 'medicine', TRUE,
    'Old Xyzal', '5 mg', NULL, 700, 1, 1, TRUE, FALSE, NOW()
  ),
  (
    'f5230000-0000-4000-8000-000000000004',
    'f5210000-0000-4000-8000-000000000002',
    'f5220000-0000-4000-8000-000000000002', 'medicine', TRUE,
    'Other Xyzal', '5 mg', NULL, 750, 2, 1, TRUE, FALSE, NULL
  );

INSERT INTO public.batches (
  id, inventory_id, batch_number, expiry_date, quantity_received, cost_price
) VALUES (
  'f5240000-0000-4000-8000-000000000001',
  'f5230000-0000-4000-8000-000000000001',
  'LIVE-READ-1', '2099-01-01', 10, 400
);

INSERT INTO public.stock_movements (
  inventory_id, batch_id, type, quantity, reason, reference
) VALUES (
  'f5230000-0000-4000-8000-000000000001',
  'f5240000-0000-4000-8000-000000000001',
  'opening', 10, 'Set-based read fixture', 'READ-FIXTURE-1'
);

INSERT INTO public.reservations (
  id, session_id, pharmacy_id, inventory_id, batch_id, quantity,
  status, expires_at, pickup_code
) VALUES (
  'f5250000-0000-4000-8000-000000000001',
  'inventory-read-session',
  'f5210000-0000-4000-8000-000000000001',
  'f5230000-0000-4000-8000-000000000001',
  'f5240000-0000-4000-8000-000000000001',
  3, 'active', NOW() + INTERVAL '1 hour', '905211'
);

INSERT INTO public.selling_units (
  id, inventory_id, unit_name, units_per, price, is_default, sort_order
) VALUES (
  'f5260000-0000-4000-8000-000000000001',
  'f5230000-0000-4000-8000-000000000001',
  'card', 10, 5000, TRUE, 1
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'public.get_pharmacy_inventory_enriched(uuid,boolean)'::regprocedure),
  'inventory read RPC is SECURITY DEFINER'
);
SELECT is(
  (SELECT provolatile::TEXT FROM pg_proc
   WHERE oid = 'public.get_pharmacy_inventory_enriched(uuid,boolean)'::regprocedure),
  's',
  'inventory read RPC is stable and read-only'
);
SELECT ok(
  has_function_privilege(
    'authenticated', 'public.get_pharmacy_inventory_enriched(uuid,boolean)', 'EXECUTE'
  )
  AND has_function_privilege(
    'service_role', 'public.get_pharmacy_inventory_enriched(uuid,boolean)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon', 'public.get_pharmacy_inventory_enriched(uuid,boolean)', 'EXECUTE'
  ),
  'authenticated and service roles can execute while anonymous callers cannot'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f5200000-0000-4000-8000-000000000001', TRUE);
END
$$;
SET LOCAL ROLE authenticated;

SELECT is(
  JSONB_ARRAY_LENGTH(public.get_pharmacy_inventory_enriched(
    'f5210000-0000-4000-8000-000000000001', FALSE
  )),
  2,
  'owner receives active Medicine and Store rows in one result set'
);
SELECT is(
  JSONB_ARRAY_LENGTH(public.get_pharmacy_inventory_enriched(
    'f5210000-0000-4000-8000-000000000001', TRUE
  )),
  3,
  'show-delisted includes the owner delisted row'
);
SELECT is(
  JSONB_ARRAY_LENGTH(public.get_pharmacy_inventory_enriched(
    'f5210000-0000-4000-8000-000000000002', FALSE
  )),
  0,
  'an authenticated pharmacy cannot read another pharmacy inventory'
);
SELECT is(
  (SELECT (entry->>'reserved_quantity')::INTEGER
   FROM JSONB_ARRAY_ELEMENTS(public.get_pharmacy_inventory_enriched(
     'f5210000-0000-4000-8000-000000000001', FALSE
   )) AS snapshot(entry)
   WHERE entry->'inventory'->>'id' = 'f5230000-0000-4000-8000-000000000001'),
  3,
  'active reservation quantity is aggregated server-side'
);
SELECT is(
  (SELECT (entry->>'sellable_quantity')::INTEGER
   FROM JSONB_ARRAY_ELEMENTS(public.get_pharmacy_inventory_enriched(
     'f5210000-0000-4000-8000-000000000001', FALSE
   )) AS snapshot(entry)
   WHERE entry->'inventory'->>'id' = 'f5230000-0000-4000-8000-000000000001'),
  7,
  'sellable quantity is stock minus active reservations'
);
SELECT is(
  (SELECT entry->'product'->>'strength'
   FROM JSONB_ARRAY_ELEMENTS(public.get_pharmacy_inventory_enriched(
     'f5210000-0000-4000-8000-000000000001', FALSE
   )) AS snapshot(entry)
   WHERE entry->'inventory'->>'id' = 'f5230000-0000-4000-8000-000000000001'),
  '200 mg',
  'catalogue strength is included in the same snapshot'
);
SELECT is(
  (SELECT (entry->'batches'->0->>'__ledger_remaining')::INTEGER
   FROM JSONB_ARRAY_ELEMENTS(public.get_pharmacy_inventory_enriched(
     'f5210000-0000-4000-8000-000000000001', FALSE
   )) AS snapshot(entry)
   WHERE entry->'inventory'->>'id' = 'f5230000-0000-4000-8000-000000000001'),
  10,
  'batch ledger quantity is aggregated in the snapshot'
);
SELECT is(
  (SELECT (entry->'batches'->0->>'__reserved_quantity')::INTEGER
   FROM JSONB_ARRAY_ELEMENTS(public.get_pharmacy_inventory_enriched(
     'f5210000-0000-4000-8000-000000000001', FALSE
   )) AS snapshot(entry)
   WHERE entry->'inventory'->>'id' = 'f5230000-0000-4000-8000-000000000001'),
  3,
  'batch reservation quantity is aggregated in the snapshot'
);
SELECT is(
  (SELECT entry->'selling_units'->0->>'unit_name'
   FROM JSONB_ARRAY_ELEMENTS(public.get_pharmacy_inventory_enriched(
     'f5210000-0000-4000-8000-000000000001', FALSE
   )) AS snapshot(entry)
   WHERE entry->'inventory'->>'id' = 'f5230000-0000-4000-8000-000000000001'),
  'card',
  'selling units are included in the same snapshot'
);
SELECT ok(
  (SELECT entry->'product' = 'null'::JSONB
   FROM JSONB_ARRAY_ELEMENTS(public.get_pharmacy_inventory_enriched(
     'f5210000-0000-4000-8000-000000000001', FALSE
   )) AS snapshot(entry)
   WHERE entry->'inventory'->>'id' = 'f5230000-0000-4000-8000-000000000002'),
  'Store rows without a catalogue link retain a null product relation'
);

RESET ROLE;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END
$$;
SET LOCAL ROLE service_role;
SELECT is(
  JSONB_ARRAY_LENGTH(public.get_pharmacy_inventory_enriched(
    'f5210000-0000-4000-8000-000000000002', FALSE
  )),
  1,
  'service role can execute the owner-scoped read for server verification'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

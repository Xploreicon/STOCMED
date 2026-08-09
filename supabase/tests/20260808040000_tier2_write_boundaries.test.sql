BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(120);

CREATE FUNCTION pg_temp.sqlstate_for(p_sql TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN '00000';
EXCEPTION
  WHEN OTHERS THEN
    RETURN SQLSTATE;
END;
$$;

CREATE TEMP TABLE tier2_mutation_rpc_manifest (
  signature TEXT PRIMARY KEY
);

INSERT INTO tier2_mutation_rpc_manifest(signature) VALUES
  ('public.admin_reset_sp_authorization_code(uuid,text)'),
  ('public.authorize_sp_action(uuid,text,text,text)'),
  ('public.cancel_reservation(uuid,text)'),
  ('public.capture_quickbooks_expiry(uuid,uuid,text,date)'),
  ('public.capture_quickbooks_expiry(uuid,uuid,text,date,text)'),
  ('public.capture_store_product(uuid,text,text,text,text,text)'),
  ('public.configure_sp_authorization(text,text,text,jsonb)'),
  ('public.create_inventory_item(uuid,jsonb)'),
  ('public.create_inventory_selling_unit(uuid,text,integer,numeric,text,text)'),
  ('public.create_purchase_order(uuid,uuid,date,text,jsonb)'),
  ('public.create_unverified_catalog_product(uuid,text,text,text,text,text,text,text,text)'),
  ('public.delist_pharmacy_inventory_item(uuid,text)'),
  ('public.expire_reservations()'),
  ('public.handle_sale_completion()'),
  ('public.import_inventory_file(uuid,uuid,jsonb,uuid)'),
  ('public.import_inventory_file(uuid,uuid,jsonb,uuid,text)'),
  ('public.import_inventory_row(uuid,uuid,text,jsonb)'),
  ('public.mark_pharmacy_reservation_queue_seen(uuid)'),
  ('public.purge_expired_health_data()'),
  ('public.purge_expired_user_search_history()'),
  ('public.receive_goods(uuid,uuid,uuid,text,jsonb)'),
  ('public.receive_goods_t2_internal(uuid,uuid,uuid,text,jsonb)'),
  ('public.record_guarded_stock_adjustment(uuid,text,integer,text,uuid,text,date,numeric,text)'),
  ('public.remove_inventory_selling_unit(uuid,uuid,text)'),
  ('public.restore_pharmacy_inventory_item(uuid,text)'),
  ('public.reverse_completed_sale(uuid,uuid,text,text,text)'),
  ('public.seed_pharmacy_features()'),
  ('public.seed_pharmacy_sp_action_gates()'),
  ('public.set_authenticated_pharmacy_features(jsonb,text)'),
  ('public.set_stocked_product_image(uuid,uuid,text)'),
  ('public.stage_quickbooks_import(uuid,jsonb)'),
  ('public.sync_pos_sale(uuid,jsonb)'),
  ('public.sync_pos_sale_with_shift(uuid,jsonb)'),
  ('public.sync_shift_close(uuid,uuid,numeric,text,timestamptz)'),
  ('public.sync_shift_open(uuid,uuid,numeric,timestamptz)'),
  ('public.update_authenticated_pharmacy_profile(jsonb,text)'),
  ('public.update_pharmacy_inventory_item(uuid,jsonb,text)'),
  ('public.update_sp_authorization_settings(numeric,integer,boolean,text)'),
  ('public.validate_sp_authorization(uuid,text,text)'),
  ('public.verify_and_audit_sp_action(uuid,text,text,text)'),
  ('public.verify_current_sp_code(uuid,text,text,text)'),
  ('public.verify_gated_sp_action(uuid,text,text,text)');

SELECT is(
  (
    SELECT COUNT(*)
    FROM information_schema.role_table_grants grant_row
    WHERE grant_row.grantee IN ('anon', 'authenticated')
      AND grant_row.table_schema = 'public'
      AND grant_row.table_name IN (
        'pharmacies', 'pharmacy_inventory', 'batches', 'selling_units',
        'sales', 'sale_items', 'pharmacy_features', 'pharmacy_sp_action_gates'
      )
      AND grant_row.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ),
  0::BIGINT,
  'client roles have no direct table write grants on protected write-path tables'
);

SELECT is(
  (
    SELECT COUNT(*)
    FROM information_schema.column_privileges grant_row
    WHERE grant_row.grantee IN ('anon', 'authenticated')
      AND grant_row.table_schema = 'public'
      AND grant_row.table_name IN (
        'pharmacies', 'pharmacy_inventory', 'batches', 'selling_units',
        'sales', 'sale_items', 'pharmacy_features', 'pharmacy_sp_action_gates'
      )
      AND grant_row.privilege_type IN ('INSERT', 'UPDATE')
  ),
  0::BIGINT,
  'client roles have no residual protected column write grants'
);

SELECT is(
  (
    WITH client_roles(role_name) AS (VALUES ('anon'), ('authenticated')),
    protected_tables(table_name) AS (VALUES
      ('pharmacies'), ('pharmacy_inventory'), ('batches'), ('selling_units'),
      ('sales'), ('sale_items'), ('pharmacy_features'), ('pharmacy_sp_action_gates')
    ),
    write_operations(operation) AS (VALUES
      ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')
    )
    SELECT COUNT(*)
    FROM client_roles
    CROSS JOIN protected_tables
    CROSS JOIN write_operations
    WHERE has_table_privilege(
      role_name,
      'public.' || table_name,
      operation
    )
  ),
  0::BIGINT,
  'client roles have no effective protected table writes through PUBLIC or inheritance'
);

SELECT is(
  (
    WITH client_roles(role_name) AS (VALUES ('anon'), ('authenticated')),
    protected_columns AS (
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (
          'pharmacies', 'pharmacy_inventory', 'batches', 'selling_units',
          'sales', 'sale_items', 'pharmacy_features', 'pharmacy_sp_action_gates'
        )
    ),
    write_operations(operation) AS (VALUES ('INSERT'), ('UPDATE'))
    SELECT COUNT(*)
    FROM client_roles
    CROSS JOIN protected_columns
    CROSS JOIN write_operations
    WHERE has_column_privilege(
      role_name,
      'public.' || table_name,
      column_name,
      operation
    )
  ),
  0::BIGINT,
  'client roles have no effective protected column writes through PUBLIC or inheritance'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.pharmacies', 'sp_code_hash', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.pharmacies', 'sp_code_hash', 'SELECT'),
  'Tier 1 SP hash denial remains intact for authenticated and anonymous roles'
);

SELECT ok(
  procedure.oid IS NOT NULL
    AND procedure.prosecdef
    AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE'),
  format(
    'Tier 2 mutation RPC %s exists, is SECURITY DEFINER, and denies anon',
    manifest.signature
  )
)
FROM tier2_mutation_rpc_manifest manifest
LEFT JOIN pg_proc procedure
  ON procedure.oid = to_regprocedure(manifest.signature)
ORDER BY manifest.signature;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'anon', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END
$$;
SET LOCAL ROLE anon;

SELECT is(
  pg_temp.sqlstate_for($sql$
    INSERT INTO public.sales (
      id, pharmacy_id, cashier_id, subtotal, discount, total, payment_method, status
    ) VALUES (
      'a0000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      1, 0, 1, 'cash', 'completed'
    )
  $sql$),
  '42501',
  'anonymous direct sales insert is denied'
);

RESET ROLE;

CREATE TEMP TABLE issued_sp_tokens (
  action_key TEXT PRIMARY KEY,
  token TEXT NOT NULL
);

GRANT SELECT, INSERT ON TABLE issued_sp_tokens TO authenticated;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-8000-000000000001',
    TRUE
  );
END
$$;
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.sqlstate_for(bypass.statement),
  '42501',
  format(
    'direct authenticated %s on protected table %s is denied',
    bypass.operation,
    bypass.table_name
  )
)
FROM (VALUES
  (1, 'pharmacies', 'INSERT', $sql$
    INSERT INTO public.pharmacies (
      id, user_id, pharmacy_name, license_number, address, city, state, phone,
      is_verified, is_active, reservations_enabled
    ) VALUES (
      'a1000000-0000-4000-8000-000000000101',
      '10000000-0000-4000-8000-000000000003',
      'Forbidden Pharmacy', '981101', '1 Bypass Street', 'Ikeja', 'Lagos',
      '+2348000000101', FALSE, TRUE, FALSE
    )
  $sql$),
  (2, 'pharmacies', 'UPDATE', $sql$
    UPDATE public.pharmacies SET sp_code_hash = 'forged' WHERE FALSE
  $sql$),
  (3, 'pharmacies', 'DELETE', $sql$
    DELETE FROM public.pharmacies WHERE FALSE
  $sql$),
  (4, 'pharmacy_inventory', 'INSERT', $sql$
    INSERT INTO public.pharmacy_inventory (
      id, pharmacy_id, product_id, price, low_stock_threshold, is_listed
    ) SELECT
      'a1000000-0000-4000-8000-000000000102',
      '30000000-0000-4000-8000-000000000001',
      product_id, 1, 0, TRUE
    FROM public.pharmacy_inventory
    WHERE id = '40000000-0000-4000-8000-000000000001'
  $sql$),
  (5, 'pharmacy_inventory', 'UPDATE', $sql$
    UPDATE public.pharmacy_inventory SET price = 1 WHERE FALSE
  $sql$),
  (6, 'pharmacy_inventory', 'DELETE', $sql$
    DELETE FROM public.pharmacy_inventory WHERE FALSE
  $sql$),
  (7, 'batches', 'INSERT', $sql$
    INSERT INTO public.batches (
      id, inventory_id, batch_number, expiry_date, quantity_received, cost_price
    ) VALUES (
      'a1000000-0000-4000-8000-000000000103',
      '40000000-0000-4000-8000-000000000001',
      'FORBIDDEN-BATCH', CURRENT_DATE + 365, 1, 1
    )
  $sql$),
  (8, 'batches', 'UPDATE', $sql$
    UPDATE public.batches SET expiry_date = CURRENT_DATE + 365 WHERE FALSE
  $sql$),
  (9, 'batches', 'DELETE', $sql$
    DELETE FROM public.batches WHERE FALSE
  $sql$),
  (10, 'selling_units', 'INSERT', $sql$
    INSERT INTO public.selling_units (
      id, inventory_id, unit_name, units_per, price
    ) VALUES (
      'a1000000-0000-4000-8000-000000000104',
      '40000000-0000-4000-8000-000000000001',
      'Forbidden unit', 2, 1
    )
  $sql$),
  (11, 'selling_units', 'UPDATE', $sql$
    UPDATE public.selling_units SET price = 1 WHERE FALSE
  $sql$),
  (12, 'selling_units', 'DELETE', $sql$
    DELETE FROM public.selling_units WHERE FALSE
  $sql$),
  (13, 'sales', 'INSERT', $sql$
    INSERT INTO public.sales (
      id, pharmacy_id, cashier_id, subtotal, discount, total, payment_method, status
    ) VALUES (
      'a1000000-0000-4000-8000-000000000105',
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      1, 0, 1, 'cash', 'completed'
    )
  $sql$),
  (14, 'sales', 'UPDATE', $sql$
    UPDATE public.sales SET status = 'refunded' WHERE FALSE
  $sql$),
  (15, 'sales', 'DELETE', $sql$
    DELETE FROM public.sales WHERE FALSE
  $sql$),
  (16, 'sale_items', 'INSERT', $sql$
    INSERT INTO public.sale_items (
      id, sale_id, inventory_id, quantity, unit_price, line_total
    ) VALUES (
      'a1000000-0000-4000-8000-000000000106',
      'a1000000-0000-4000-8000-000000000105',
      '40000000-0000-4000-8000-000000000001',
      1, 1, 1
    )
  $sql$),
  (17, 'sale_items', 'UPDATE', $sql$
    UPDATE public.sale_items SET quantity = 2 WHERE FALSE
  $sql$),
  (18, 'sale_items', 'DELETE', $sql$
    DELETE FROM public.sale_items WHERE FALSE
  $sql$),
  (19, 'pharmacy_features', 'INSERT', $sql$
    INSERT INTO public.pharmacy_features (
      pharmacy_id, feature_key, is_enabled
    ) VALUES (
      '30000000-0000-4000-8000-000000000001', 'reservations', TRUE
    )
  $sql$),
  (20, 'pharmacy_features', 'UPDATE', $sql$
    UPDATE public.pharmacy_features SET is_enabled = TRUE WHERE FALSE
  $sql$),
  (21, 'pharmacy_features', 'DELETE', $sql$
    DELETE FROM public.pharmacy_features WHERE FALSE
  $sql$),
  (22, 'pharmacy_sp_action_gates', 'INSERT', $sql$
    INSERT INTO public.pharmacy_sp_action_gates (
      pharmacy_id, action_key, is_gated
    ) VALUES (
      '30000000-0000-4000-8000-000000000001', 'price_change', TRUE
    )
  $sql$),
  (23, 'pharmacy_sp_action_gates', 'UPDATE', $sql$
    UPDATE public.pharmacy_sp_action_gates SET is_gated = TRUE WHERE FALSE
  $sql$),
  (24, 'pharmacy_sp_action_gates', 'DELETE', $sql$
    DELETE FROM public.pharmacy_sp_action_gates WHERE FALSE
  $sql$)
) AS bypass(ordinal, table_name, operation, statement)
ORDER BY bypass.ordinal;

SELECT ok(
  (
    public.configure_sp_authorization('set_code', '246810', NULL, NULL)->>'success'
  )::BOOLEAN,
  'first SP code setup succeeds without a current code'
);

SELECT is(
  public.configure_sp_authorization(
    'set_code', '975310', NULL, NULL
  )->>'code',
  'SP_CURRENT_CODE_REQUIRED',
  'an existing SP code cannot be changed without the current code'
);

SELECT is(
  public.configure_sp_authorization(
    'set_gates', NULL, NULL, jsonb_build_object('price_change', TRUE)
  )->>'code',
  'SP_CURRENT_CODE_REQUIRED',
  'action gating cannot be changed without the current SP code'
);

SELECT ok(
  NOT (
    public.configure_sp_authorization(
      'set_gates', NULL, '000000', jsonb_build_object('price_change', TRUE)
    )->>'success'
  )::BOOLEAN,
  'wrong current code cannot change action gates'
);

SELECT is(
  (
    SELECT is_gated FROM public.pharmacy_sp_action_gates
    WHERE pharmacy_id = '30000000-0000-4000-8000-000000000001'
      AND action_key = 'price_change'
  ),
  FALSE,
  'failed gate change leaves the gate unchanged'
);

SELECT ok(
  (
    public.configure_sp_authorization(
      'set_gates',
      NULL,
      '246810',
      jsonb_build_object(
        'price_change', TRUE,
        'large_discount', TRUE,
        'stock_adjustment', TRUE
      )
    )->>'success'
  )::BOOLEAN,
  'current code atomically enables action gates'
);

SELECT ok(
  (public.update_authenticated_pharmacy_profile(
    jsonb_build_object('city', 'Lagos Mainland'), NULL
  )->>'id') = '30000000-0000-4000-8000-000000000001',
  'ungated profile update succeeds without an SP token and returns an allowlisted profile'
);

SELECT ok(
  NOT public.update_authenticated_pharmacy_profile(
    jsonb_build_object('phone', '+2348000000000'), NULL
  ) ? 'sp_code_hash',
  'profile mutation RPC never returns the SP hash'
);

SELECT is(
  public.update_pharmacy_inventory_item(
    '40000000-0000-4000-8000-000000000001',
    jsonb_build_object('price', 1600),
    NULL
  )->>'code',
  'SP_AUTH_REQUIRED',
  'gated price change is denied inside the mutation transaction without a token'
);

SELECT is(
  (SELECT price FROM public.pharmacy_inventory
   WHERE id = '40000000-0000-4000-8000-000000000001'),
  1500::NUMERIC,
  'denied price change leaves inventory unchanged'
);

SELECT is(
  public.update_pharmacy_inventory_item(
    '40000000-0000-4000-8000-000000000001',
    jsonb_build_object('price', 1601),
    'not-a-valid-sp-token'
  )->>'code',
  'SP_AUTH_REQUIRED',
  'an invalid SP token cannot authorize a gated price change'
);

INSERT INTO issued_sp_tokens(action_key, token)
SELECT 'wrong_action', public.authorize_sp_action(
  '30000000-0000-4000-8000-000000000001',
  '246810',
  'financial_reports',
  'T2 wrong-action token test'
);

SELECT ok(
  public.validate_sp_authorization(
    '30000000-0000-4000-8000-000000000001',
    (SELECT token FROM issued_sp_tokens WHERE action_key = 'wrong_action'),
    'financial_reports'
  ),
  'wrong-action fixture token is valid for the action it was issued for'
);

SELECT is(
  public.update_pharmacy_inventory_item(
    '40000000-0000-4000-8000-000000000001',
    jsonb_build_object('price', 1602),
    (SELECT token FROM issued_sp_tokens WHERE action_key = 'wrong_action')
  )->>'code',
  'SP_AUTH_REQUIRED',
  'an SP token issued for another action cannot authorize a price change'
);

INSERT INTO issued_sp_tokens(action_key, token)
SELECT 'expired_price', public.authorize_sp_action(
  '30000000-0000-4000-8000-000000000001',
  '246810',
  'price_change',
  'T2 expired token test'
);

SELECT ok(
  public.validate_sp_authorization(
    '30000000-0000-4000-8000-000000000001',
    (SELECT token FROM issued_sp_tokens WHERE action_key = 'expired_price'),
    'price_change'
  ),
  'expiry fixture token is valid before its grant is expired'
);

RESET ROLE;
UPDATE public.sp_authorization_grants
SET expires_at = NOW() - INTERVAL '1 minute'
WHERE token_hash = encode(
  extensions.digest(
    (SELECT token FROM issued_sp_tokens WHERE action_key = 'expired_price'),
    'sha256'
  ),
  'hex'
);
SET LOCAL ROLE authenticated;

SELECT is(
  public.update_pharmacy_inventory_item(
    '40000000-0000-4000-8000-000000000001',
    jsonb_build_object('price', 1603),
    (SELECT token FROM issued_sp_tokens WHERE action_key = 'expired_price')
  )->>'code',
  'SP_AUTH_REQUIRED',
  'an expired SP token cannot authorize a gated price change'
);

SELECT is(
  (SELECT price FROM public.pharmacy_inventory
   WHERE id = '40000000-0000-4000-8000-000000000001'),
  1500::NUMERIC,
  'invalid, wrong-action, and expired tokens leave the price unchanged'
);

INSERT INTO issued_sp_tokens(action_key, token)
SELECT 'price_change', public.authorize_sp_action(
  '30000000-0000-4000-8000-000000000001',
  '246810',
  'price_change',
  'T2 price test'
);

SELECT ok(
  (public.update_pharmacy_inventory_item(
    '40000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'price', 1600,
      'low_stock_threshold', 7,
      'whole_pack_only', FALSE,
      'image_url', 'https://example.test/item.png'
    ),
    (SELECT token FROM issued_sp_tokens WHERE action_key = 'price_change')
  )->>'success')::BOOLEAN,
  'matching price token updates only allowlisted inventory metadata'
);

RESET ROLE;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-8000-000000000002',
    TRUE
  );
END
$$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.configure_sp_authorization('set_code', '135790', NULL, NULL);
  IF NOT COALESCE((v_result->>'success')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Cross-tenant fixture could not set its SP code';
  END IF;
  v_result := public.configure_sp_authorization(
    'set_gates', NULL, '135790', jsonb_build_object('price_change', TRUE)
  );
  IF NOT COALESCE((v_result->>'success')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Cross-tenant fixture could not enable its price gate';
  END IF;
END
$$;

SELECT is(
  public.update_pharmacy_inventory_item(
    '40000000-0000-4000-8000-000000000002',
    jsonb_build_object('price', 1750),
    (SELECT token FROM issued_sp_tokens WHERE action_key = 'price_change')
  )->>'code',
  'SP_AUTH_REQUIRED',
  'an SP token cannot be reused by another authenticated pharmacy tenant'
);

SELECT is(
  (SELECT price FROM public.pharmacy_inventory
   WHERE id = '40000000-0000-4000-8000-000000000002'),
  1700::NUMERIC,
  'cross-tenant token rejection leaves the other pharmacy price unchanged'
);

RESET ROLE;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-8000-000000000001',
    TRUE
  );
END
$$;
SET LOCAL ROLE authenticated;

SELECT is(
  public.import_inventory_file(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_array(
      jsonb_build_object(
        'selected_product_id', (
          SELECT id::TEXT FROM public.products WHERE barcode = '61500000001' LIMIT 1
        ),
        'mapped', jsonb_build_object('item_type', 'medicine', 'price', 100)
      ),
      jsonb_build_object(
        'selected_product_id', (
          SELECT id::TEXT FROM public.products WHERE barcode = '61500000001' LIMIT 1
        ),
        'mapped', jsonb_build_object('item_type', 'medicine', 'price', 200)
      )
    ),
    'a4000000-0000-4000-8000-000000000001',
    NULL
  )->>'code',
  'SP_AUTH_REQUIRED',
  'duplicate import targets cannot create then change a price without authorization'
);

SELECT is(
  (
    SELECT COUNT(*)
    FROM public.pharmacy_inventory inventory
    JOIN public.products product ON product.id = inventory.product_id
    WHERE inventory.pharmacy_id = '30000000-0000-4000-8000-000000000001'
      AND product.barcode = '61500000001'
  ),
  0::BIGINT,
  'denied duplicate-target import leaves no partial inventory item'
);

SELECT ok(
  NOT (
    public.update_sp_authorization_settings(12, 6, TRUE, '000000')->>'success'
  )::BOOLEAN,
  'wrong current code cannot change SP thresholds'
);

SELECT ok(
  (
    public.update_sp_authorization_settings(10, 6, TRUE, '246810')->>'success'
  )::BOOLEAN,
  'current code changes threshold, grace, and report gate in one transaction'
);

SELECT is(
  public.get_pharmacy_reports(
    '30000000-0000-4000-8000-000000000001', CURRENT_DATE, CURRENT_DATE, NULL
  )->>'code',
  'SP_AUTH_REQUIRED',
  'gated full reports reject a missing token inside the report RPC'
);

SELECT ok(
  public.get_pharmacy_dashboard_summary(
    '30000000-0000-4000-8000-000000000001', CURRENT_DATE, CURRENT_DATE
  ) ? 'stock_valuation',
  'dashboard summary remains available through its restricted RPC'
);

INSERT INTO issued_sp_tokens(action_key, token)
SELECT 'financial_reports', public.authorize_sp_action(
  '30000000-0000-4000-8000-000000000001',
  '246810',
  'financial_reports',
  'T2 report test'
);

SELECT ok(
  public.get_pharmacy_reports(
    '30000000-0000-4000-8000-000000000001',
    CURRENT_DATE,
    CURRENT_DATE,
    (SELECT token FROM issued_sp_tokens WHERE action_key = 'financial_reports')
  ) ? 'stock_valuation',
  'matching report token returns the full authoritative report'
);

SELECT ok(
  NOT (
    public.set_authenticated_pharmacy_features(
      jsonb_build_array(jsonb_build_object(
        'feature_key', 'reservations', 'is_enabled', TRUE
      )),
      NULL
    )->>'success'
  )::BOOLEAN,
  'feature changes require the current raw code when a code exists'
);

SELECT ok(
  (
    public.set_authenticated_pharmacy_features(
      jsonb_build_array(
        jsonb_build_object('feature_key', 'reservations', 'is_enabled', TRUE),
        jsonb_build_object('feature_key', 'packs_and_units', 'is_enabled', TRUE)
      ),
      '246810'
    )->>'success'
  )::BOOLEAN,
  'feature and reservation settings update through one self-protecting RPC'
);

SELECT ok(
  (
    SELECT feature.is_enabled = pharmacy.reservations_enabled
    FROM public.pharmacy_features feature
    JOIN public.pharmacies pharmacy ON pharmacy.id = feature.pharmacy_id
    WHERE feature.pharmacy_id = '30000000-0000-4000-8000-000000000001'
      AND feature.feature_key = 'reservations'
  ),
  'reservation feature row and pharmacy compatibility flag agree'
);

SELECT throws_ok(
  $$SELECT public.record_guarded_stock_adjustment(
    '40000000-0000-4000-8000-000000000001',
    'sale', -1, 'forged sale',
    '50000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL
  )$$,
  'P0001',
  'This stock movement type cannot be created as an adjustment',
  'stock adjustment RPC cannot forge a sale ledger movement'
);

SELECT is(
  public.record_guarded_stock_adjustment(
    '40000000-0000-4000-8000-000000000001',
    'restock', 2, 'new batch atomic test',
    NULL, 'T2-ATOMIC-BATCH', CURRENT_DATE + 500, 1000, NULL
  )->>'code',
  'SP_AUTH_REQUIRED',
  'enabled stock-adjustment gate also protects manual restock operations'
);

SELECT is(
  (SELECT COUNT(*) FROM public.batches WHERE batch_number = 'T2-ATOMIC-BATCH'),
  0::BIGINT,
  'denied gated restock leaves no orphan batch'
);

INSERT INTO issued_sp_tokens(action_key, token)
SELECT 'stock_adjustment', public.authorize_sp_action(
  '30000000-0000-4000-8000-000000000001',
  '246810',
  'stock_adjustment',
  'T2 stock adjustment test'
);

SELECT ok(
  (public.record_guarded_stock_adjustment(
    '40000000-0000-4000-8000-000000000001',
    'restock', 2, 'new batch atomic test',
    NULL, 'T2-ATOMIC-BATCH', CURRENT_DATE + 500, 1000,
    (SELECT token FROM issued_sp_tokens WHERE action_key = 'stock_adjustment')
  )->>'success')::BOOLEAN,
  'new batch and restock movement commit through one RPC'
);

SELECT is(
  (
    SELECT COUNT(*)
    FROM public.batches batch
    JOIN public.stock_movements movement ON movement.batch_id = batch.id
    WHERE batch.batch_number = 'T2-ATOMIC-BATCH'
      AND movement.type = 'restock'
      AND movement.quantity = 2
  ),
  1::BIGINT,
  'atomic new-batch adjustment created exactly one batch and one movement'
);

SELECT throws_ok(
  $$SELECT public.record_guarded_stock_adjustment(
    '40000000-0000-4000-8000-000000000001',
    'restock', 1, 'must roll back',
    NULL, 'T2-INVALID-BATCH', CURRENT_DATE - 1, 1000,
    (SELECT token FROM issued_sp_tokens WHERE action_key = 'stock_adjustment')
  )$$,
  'P0001',
  'Expired batches cannot be added to stock',
  'invalid new-batch adjustment fails atomically'
);

SELECT is(
  (SELECT COUNT(*) FROM public.batches WHERE batch_number = 'T2-INVALID-BATCH'),
  0::BIGINT,
  'failed new-batch adjustment leaves no orphan batch'
);

SELECT public.sync_shift_open(
  'a2000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  0,
  NOW()
);

SELECT is(
  public.sync_pos_sale_with_shift(
    '30000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id', 'a3000000-0000-4000-8000-000000000001',
      'shift_id', 'a2000000-0000-4000-8000-000000000001',
      'payment_method', 'cash',
      'subtotal', 999999,
      'discount', 320,
      'items', jsonb_build_array(jsonb_build_object(
        'inventory_id', '40000000-0000-4000-8000-000000000001',
        'batch_id', '50000000-0000-4000-8000-000000000001',
        'quantity', 1,
        'unit_price', 1,
        'line_total', 1
      ))
    )
  )->>'code',
  'SP_AUTH_REQUIRED',
  'inflated client subtotal cannot bypass the server-computed discount threshold'
);

SELECT is(
  (SELECT COUNT(*) FROM public.sales WHERE id = 'a3000000-0000-4000-8000-000000000001'),
  0::BIGINT,
  'denied discount sale leaves no partial sale row'
);

INSERT INTO issued_sp_tokens(action_key, token)
SELECT 'large_discount', public.authorize_sp_action(
  '30000000-0000-4000-8000-000000000001',
  '246810',
  'large_discount',
  'T2 POS discount test'
);

SELECT ok(
  (public.sync_pos_sale_with_shift(
    '30000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id', 'a3000000-0000-4000-8000-000000000001',
      'shift_id', 'a2000000-0000-4000-8000-000000000001',
      'payment_method', 'cash',
      'subtotal', 999999,
      'discount', 320,
      'sp_authorization_token', (
        SELECT token FROM issued_sp_tokens WHERE action_key = 'large_discount'
      ),
      'items', jsonb_build_array(jsonb_build_object(
        'inventory_id', '40000000-0000-4000-8000-000000000001',
        'batch_id', '50000000-0000-4000-8000-000000000001',
        'quantity', 1,
        'unit_price', 1,
        'line_total', 1
      ))
    )
  )->>'success')::BOOLEAN,
  'authorized sale succeeds using the authoritative inventory price'
);

SELECT is(
  (SELECT total FROM public.sales WHERE id = 'a3000000-0000-4000-8000-000000000001'),
  1280::NUMERIC,
  'POS persisted server subtotal minus discount, never the inflated client subtotal'
);

SELECT ok(
  (public.sync_pos_sale_with_shift(
    '30000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id', 'a3000000-0000-4000-8000-000000000001',
      'shift_id', 'a2000000-0000-4000-8000-000000000001',
      'payment_method', 'cash',
      'discount', 320,
      'items', jsonb_build_array(jsonb_build_object(
        'inventory_id', '40000000-0000-4000-8000-000000000001',
        'batch_id', '50000000-0000-4000-8000-000000000001',
        'quantity', 1
      ))
    )
  )->>'replayed')::BOOLEAN,
  'replaying the same completed offline sale is idempotent'
);

SELECT is(
  (SELECT COUNT(*) FROM public.stock_movements
   WHERE reference = 'a3000000-0000-4000-8000-000000000001'),
  1::BIGINT,
  'POS replay writes exactly one sale stock movement'
);

SELECT ok(
  (public.reverse_completed_sale(
    '30000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    'void',
    'T2 ungated reversal',
    NULL
  )->>'success')::BOOLEAN,
  'ungated reversal succeeds without a token'
);

SELECT is(
  (SELECT COUNT(*) FROM public.stock_movements
   WHERE reference = 'void_a3000000-0000-4000-8000-000000000001'),
  1::BIGINT,
  'reversal restores stock exactly once'
);

SELECT ok(
  NOT (
    public.configure_sp_authorization('remove_code', NULL, '000000', NULL)->>'success'
  )::BOOLEAN,
  'wrong current code cannot remove SP protection'
);

SELECT ok(
  (
    public.configure_sp_authorization('remove_code', NULL, '246810', NULL)->>'success'
  )::BOOLEAN,
  'correct current code removes the SP code'
);

SELECT ok(
  (
    public.update_pharmacy_inventory_item(
      '40000000-0000-4000-8000-000000000001',
      jsonb_build_object('price', 1650),
      NULL
    )->>'success'
  )::BOOLEAN,
  'configured gate is dormant without an SP code'
);

SELECT is(
  (
    SELECT is_gated FROM public.pharmacy_sp_action_gates
    WHERE pharmacy_id = '30000000-0000-4000-8000-000000000001'
      AND action_key = 'price_change'
  ),
  TRUE,
  'removing the code preserves gate preferences for later setup'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

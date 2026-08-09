BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT no_plan();

CREATE FUNCTION pg_temp.raises_insufficient_privilege(p_sql TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN FALSE;
EXCEPTION
  WHEN insufficient_privilege THEN
    RETURN TRUE;
END;
$$;

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

SELECT is(
  (
    SELECT COUNT(*)
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = 'void_sale'
  ),
  0::BIGINT,
  'legacy void_sale is removed'
);

SELECT is(
  (
    SELECT COUNT(*)
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = 'create_guarded_stock_adjustment'
  ),
  0::BIGINT,
  'legacy stock-adjustment overload is removed'
);

SELECT is(
  (
    SELECT COUNT(*)
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'authorize_sp_action', 'configure_sp_authorization',
        'update_sp_authorization_settings', 'update_authenticated_pharmacy_profile',
        'update_pharmacy_inventory_item', 'delist_pharmacy_inventory_item',
        'restore_pharmacy_inventory_item', 'create_inventory_selling_unit',
        'remove_inventory_selling_unit', 'set_authenticated_pharmacy_features',
        'record_guarded_stock_adjustment', 'sync_pos_sale_with_shift',
        'reverse_completed_sale', 'import_inventory_file',
        'stage_quickbooks_import', 'capture_quickbooks_expiry', 'receive_goods',
        'seed_pharmacy_features', 'seed_pharmacy_sp_action_gates',
        'cancel_reservation', 'capture_store_product',
        'mark_pharmacy_reservation_queue_seen', 'expire_reservations',
        'purge_expired_health_data', 'purge_expired_user_search_history',
        'handle_sale_completion'
      )
      AND has_function_privilege('anon', procedure.oid, 'EXECUTE')
  ),
  0::BIGINT,
  'anonymous callers cannot execute any mutation RPC overload'
);

SELECT ok(
  (
    SELECT BOOL_AND(procedure.prosecdef)
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'configure_sp_authorization', 'update_sp_authorization_settings',
        'update_authenticated_pharmacy_profile', 'update_pharmacy_inventory_item',
        'delist_pharmacy_inventory_item', 'restore_pharmacy_inventory_item',
        'create_inventory_selling_unit', 'remove_inventory_selling_unit',
        'set_authenticated_pharmacy_features', 'record_guarded_stock_adjustment'
      )
  ),
  'replacement mutation RPCs are SECURITY DEFINER'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'anon', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END
$$;
SET LOCAL ROLE anon;

SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    INSERT INTO public.sales (
      id, pharmacy_id, cashier_id, subtotal, discount, total, payment_method, status
    ) VALUES (
      'a0000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      1, 0, 1, 'cash', 'completed'
    )
  $sql$),
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

SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    UPDATE public.pharmacies
    SET sp_code_hash = 'forged'
    WHERE id = '30000000-0000-4000-8000-000000000001'
  $sql$),
  'direct authenticated SP hash update is denied'
);

SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    UPDATE public.pharmacy_inventory
    SET price = 1
    WHERE id = '40000000-0000-4000-8000-000000000001'
  $sql$),
  'direct authenticated inventory price update is denied'
);

SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    INSERT INTO public.sales (
      id, pharmacy_id, cashier_id, subtotal, discount, total, payment_method, status
    ) VALUES (
      'a1000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      1, 0, 1, 'cash', 'completed'
    )
  $sql$),
  'direct authenticated sales insert is denied'
);

SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    UPDATE public.pharmacy_features
    SET is_enabled = TRUE, enabled_at = NOW(), enabled_by = auth.uid()
    WHERE pharmacy_id = '30000000-0000-4000-8000-000000000001'
      AND feature_key = 'reservations'
  $sql$),
  'direct authenticated pharmacy feature update is denied'
);

SELECT ok(
  (
    public.configure_sp_authorization('set_code', '246810', NULL, NULL)->>'success'
  )::BOOLEAN,
  'first SP code setup succeeds without a current code'
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

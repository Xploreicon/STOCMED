-- Tier 2 authenticated write boundary, phase 2.
-- Apply only after the application has moved to the replacement RPCs created
-- in 20260808030000_tier2_secure_write_rpcs.sql.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.pharmacies
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.pharmacy_inventory
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.batches
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.selling_units
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.sales
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.sale_items
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.pharmacy_features
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.pharmacy_sp_action_gates
  FROM anon, authenticated;

-- Table-level REVOKE does not remove historical column ACL entries. Remove
-- every residual authenticated INSERT/UPDATE column privilege dynamically so
-- future schema additions cannot be missed by a hard-coded list.
DO $tier2_column_revoke$
DECLARE
  target RECORD;
  operation TEXT;
  client_role TEXT;
BEGIN
  FOR target IN
    SELECT column_row.table_schema, column_row.table_name, column_row.column_name
    FROM information_schema.columns column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name IN (
        'pharmacies',
        'pharmacy_inventory',
        'batches',
        'selling_units',
        'sales',
        'sale_items',
        'pharmacy_features',
        'pharmacy_sp_action_gates'
      )
  LOOP
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      FOREACH operation IN ARRAY ARRAY['INSERT', 'UPDATE']
      LOOP
        IF has_column_privilege(
          client_role,
          format('%I.%I', target.table_schema, target.table_name),
          target.column_name,
          operation
        ) THEN
          EXECUTE format(
            'REVOKE %s (%I) ON TABLE %I.%I FROM %I',
            operation,
            target.column_name,
            target.table_schema,
            target.table_name,
            client_role
          );
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$tier2_column_revoke$;

-- Retire every old authenticated overload that would otherwise bypass the new
-- gate or atomicity contract.
DROP FUNCTION IF EXISTS public.void_sale(UUID, UUID);
DROP FUNCTION IF EXISTS public.set_sp_authorization_code(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_guarded_stock_adjustment(
  UUID, UUID, UUID, public.stock_movement_type, INTEGER, TEXT
);

REVOKE ALL ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.capture_quickbooks_expiry(UUID, UUID, TEXT, DATE)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_pharmacy_reports(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_pharmacy_reservations_enabled_client(BOOLEAN)
  FROM PUBLIC, anon, authenticated;

-- Core helpers remain owner-only. Clients execute only the complete public
-- transaction boundaries.
REVOKE ALL ON FUNCTION public.sync_pos_sale(UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.import_inventory_row(UUID, UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_and_audit_sp_action(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.seed_pharmacy_features()
  FROM PUBLIC, anon, authenticated, service_role;

-- Older migrations revoked PUBLIC but local/hosted Supabase role bootstrap also
-- grants EXECUTE directly to anon. Close those residual writer entrypoints.
REVOKE ALL ON FUNCTION public.cancel_reservation(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.capture_store_product(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_pharmacy_reservation_queue_seen(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.expire_reservations()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_expired_health_data()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_expired_user_search_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_sale_completion()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.cancel_reservation(UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_store_product(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_pharmacy_reservation_queue_seen(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_reservations()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_health_data()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_user_search_history()
  TO service_role;

-- Re-state every client mutation ACL. PostgreSQL grants EXECUTE to PUBLIC on a
-- new function unless it is explicitly removed.
REVOKE ALL ON FUNCTION public.authorize_sp_action(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_sp_authorization(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reset_sp_authorization_code(UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configure_sp_authorization(TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_sp_authorization_settings(NUMERIC, INTEGER, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_authenticated_pharmacy_profile(JSONB, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_pharmacy_inventory_item(UUID, JSONB, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delist_pharmacy_inventory_item(UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_pharmacy_inventory_item(UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_inventory_selling_unit(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_inventory_selling_unit(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_authenticated_pharmacy_features(JSONB, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_guarded_stock_adjustment(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, DATE, NUMERIC, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_pos_sale_with_shift(UUID, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_completed_sale(UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_inventory_item(UUID, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_unverified_catalog_product(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_stocked_product_image(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_purchase_order(UUID, UUID, DATE, TEXT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stage_quickbooks_import(UUID, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capture_quickbooks_expiry(UUID, UUID, TEXT, DATE, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_goods(UUID, UUID, UUID, TEXT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_shift_open(UUID, UUID, NUMERIC, TIMESTAMPTZ)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_shift_close(UUID, UUID, NUMERIC, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.authorize_sp_action(UUID, TEXT, TEXT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_sp_authorization(UUID, TEXT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_sp_authorization_code(UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configure_sp_authorization(TEXT, TEXT, TEXT, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_sp_authorization_settings(NUMERIC, INTEGER, BOOLEAN, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_authenticated_pharmacy_profile(JSONB, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_pharmacy_inventory_item(UUID, JSONB, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delist_pharmacy_inventory_item(UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_pharmacy_inventory_item(UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_inventory_selling_unit(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_inventory_selling_unit(UUID, UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_authenticated_pharmacy_features(JSONB, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_guarded_stock_adjustment(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, DATE, NUMERIC, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_pos_sale_with_shift(UUID, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_completed_sale(UUID, UUID, TEXT, TEXT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_inventory_item(UUID, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_unverified_catalog_product(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_stocked_product_image(UUID, UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(UUID, UUID, DATE, TEXT, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB, UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stage_quickbooks_import(UUID, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_quickbooks_expiry(UUID, UUID, TEXT, DATE, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_goods(UUID, UUID, UUID, TEXT, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_shift_open(UUID, UUID, NUMERIC, TIMESTAMPTZ)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_shift_close(UUID, UUID, NUMERIC, TEXT, TIMESTAMPTZ)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

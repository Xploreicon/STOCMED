-- Tier 1 emergency lockdown: remove direct SP/config reads and unnecessary
-- anonymous privileges without changing authenticated mutation privileges.

-- Ordinary clients receive only the pharmacy columns required by public
-- discovery or the authenticated owner profile. Table-level SELECT must be
-- removed first because it overrides column-level restrictions.
REVOKE SELECT ON TABLE public.pharmacies FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  pharmacy_name,
  license_number,
  address,
  city,
  state,
  latitude,
  longitude,
  phone,
  is_verified,
  is_active,
  reservations_enabled,
  verification_status,
  provisional_expires_at,
  logo_url,
  opening_time,
  closing_time
) ON TABLE public.pharmacies TO anon;

GRANT SELECT (
  id,
  user_id,
  pharmacy_name,
  license_number,
  address,
  city,
  state,
  latitude,
  longitude,
  phone,
  is_verified,
  is_active,
  reservations_enabled,
  verification_status,
  pcn_confirmation_status,
  provisional_started_at,
  provisional_expires_at,
  verification_submitted_at,
  pcn_standards_accepted_at,
  created_at,
  updated_at,
  logo_url,
  opening_time,
  closing_time
) ON TABLE public.pharmacies TO authenticated;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.pharmacies FROM anon;

-- The service-only settings reader never returns the hash. It evaluates hash
-- presence inside the database and returns only the state needed by trusted
-- application routes. Existing bcrypt/token checks remain inside their
-- dedicated SECURITY DEFINER authorization functions.
CREATE OR REPLACE FUNCTION public.get_internal_pharmacy_sp_config(
  p_pharmacy_id UUID
)
RETURNS TABLE (
  configured BOOLEAN,
  failed_attempts INTEGER,
  locked_until TIMESTAMPTZ,
  discount_threshold NUMERIC,
  grace_minutes INTEGER,
  require_financial_reports BOOLEAN
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ph.sp_code_hash IS NOT NULL,
    ph.sp_failed_attempts,
    ph.sp_locked_until,
    ph.sp_discount_threshold,
    ph.sp_grace_minutes,
    ph.sp_require_financial_reports
  FROM public.pharmacies ph
  WHERE ph.id = p_pharmacy_id;
$$;

ALTER FUNCTION public.get_internal_pharmacy_sp_config(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_internal_pharmacy_sp_config(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_internal_pharmacy_sp_config(UUID)
  TO service_role;

COMMENT ON FUNCTION public.get_internal_pharmacy_sp_config(UUID) IS
  'Service-role-only SP configuration reader. The SP hash never leaves PostgreSQL.';

-- Column grants do not redact a composite row returned by a SECURITY DEFINER
-- RPC. Keep the authoritative write functions, but remove direct client access
-- and expose allowlisted JSON wrappers so no current or future private column
-- can hitchhike in an RPC response.
CREATE OR REPLACE FUNCTION public.internal_client_pharmacy_profile(
  p_pharmacy public.pharmacies
)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p_pharmacy.id,
    'user_id', p_pharmacy.user_id,
    'pharmacy_name', p_pharmacy.pharmacy_name,
    'license_number', p_pharmacy.license_number,
    'address', p_pharmacy.address,
    'city', p_pharmacy.city,
    'state', p_pharmacy.state,
    'latitude', p_pharmacy.latitude,
    'longitude', p_pharmacy.longitude,
    'phone', p_pharmacy.phone,
    'is_verified', p_pharmacy.is_verified,
    'is_active', p_pharmacy.is_active,
    'reservations_enabled', p_pharmacy.reservations_enabled,
    'verification_status', p_pharmacy.verification_status,
    'pcn_confirmation_status', p_pharmacy.pcn_confirmation_status,
    'provisional_started_at', p_pharmacy.provisional_started_at,
    'provisional_expires_at', p_pharmacy.provisional_expires_at,
    'verification_submitted_at', p_pharmacy.verification_submitted_at,
    'pcn_standards_accepted_at', p_pharmacy.pcn_standards_accepted_at,
    'created_at', p_pharmacy.created_at,
    'updated_at', p_pharmacy.updated_at,
    'logo_url', p_pharmacy.logo_url,
    'opening_time', p_pharmacy.opening_time,
    'closing_time', p_pharmacy.closing_time
  );
$$;

ALTER FUNCTION public.internal_client_pharmacy_profile(public.pharmacies)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.internal_client_pharmacy_profile(public.pharmacies)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_provisional_pharmacy_client(
  p_pharmacy_name TEXT,
  p_license_number TEXT,
  p_address TEXT,
  p_city TEXT,
  p_state TEXT,
  p_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.pharmacies;
BEGIN
  result := public.register_provisional_pharmacy(
    p_pharmacy_name,
    p_license_number,
    p_address,
    p_city,
    p_state,
    p_phone
  );
  RETURN public.internal_client_pharmacy_profile(result);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_pharmacy_verification_requirements_client(
  p_document_reference TEXT,
  p_standards_version TEXT,
  p_agree_to_standards BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.pharmacies;
BEGIN
  result := public.submit_pharmacy_verification_requirements(
    p_document_reference,
    p_standards_version,
    p_agree_to_standards
  );
  RETURN public.internal_client_pharmacy_profile(result);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_pharmacy_reservations_enabled_client(
  p_enabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.pharmacies;
BEGIN
  result := public.set_pharmacy_reservations_enabled(p_enabled);
  RETURN public.internal_client_pharmacy_profile(result);
END;
$$;

ALTER FUNCTION public.register_provisional_pharmacy_client(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.submit_pharmacy_verification_requirements_client(
  TEXT, TEXT, BOOLEAN
) OWNER TO postgres;
ALTER FUNCTION public.set_pharmacy_reservations_enabled_client(BOOLEAN)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.register_provisional_pharmacy(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_pharmacy_verification_requirements(
  TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_pharmacy_reservations_enabled(BOOLEAN)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.register_provisional_pharmacy(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_pharmacy_verification_requirements(
  TEXT, TEXT, BOOLEAN
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_pharmacy_reservations_enabled(BOOLEAN)
  TO service_role;

REVOKE ALL ON FUNCTION public.register_provisional_pharmacy_client(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_pharmacy_verification_requirements_client(
  TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_pharmacy_reservations_enabled_client(BOOLEAN)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.register_provisional_pharmacy_client(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_pharmacy_verification_requirements_client(
  TEXT, TEXT, BOOLEAN
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_pharmacy_reservations_enabled_client(BOOLEAN)
  TO authenticated, service_role;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Revoke both
-- PUBLIC and anon so anonymous callers have no inherited execution path, then
-- state the legitimate server/authenticated grants explicitly.
REVOKE EXECUTE ON FUNCTION public.get_pharmacy_reports(UUID, DATE, DATE)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_pos_sale_with_shift(UUID, JSONB)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB, UUID)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.stage_quickbooks_import(UUID, JSONB)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_pharmacy_reports(UUID, DATE, DATE)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_pos_sale_with_shift(UUID, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB, UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stage_quickbooks_import(UUID, JSONB)
  TO authenticated, service_role;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.sales FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.pharmacy_features FROM anon;

-- Remove unusual anonymous TRUNCATE privileges from every application table.
-- Supabase-managed schemas are deliberately out of scope.
DO $tier1$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND has_table_privilege('anon', c.oid, 'TRUNCATE')
  LOOP
    EXECUTE format(
      'REVOKE TRUNCATE ON TABLE %I.%I FROM anon',
      target.schema_name,
      target.table_name
    );
  END LOOP;
END;
$tier1$;

-- Canonicalize the pilot pharmacy roster, make registration idempotent, and
-- enforce sale tenant ownership at the database boundary.

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS pcn_confirmation_status TEXT NOT NULL DEFAULT 'confirmed';

ALTER TABLE public.pharmacies
  DROP CONSTRAINT IF EXISTS pharmacies_pcn_registration_number_format;

UPDATE public.pharmacies
SET pcn_confirmation_status = CASE
  WHEN public.is_plausible_pcn_registration_number(license_number)
    THEN 'confirmed'
  ELSE 'to_be_confirmed'
END;

ALTER TABLE public.pharmacies
  DROP CONSTRAINT IF EXISTS pharmacies_pcn_confirmation_status_check;
ALTER TABLE public.pharmacies
  ADD CONSTRAINT pharmacies_pcn_confirmation_status_check
  CHECK (pcn_confirmation_status IN ('confirmed', 'to_be_confirmed'));

ALTER TABLE public.pharmacies
  ADD CONSTRAINT pharmacies_pcn_registration_number_format
  CHECK (
    pcn_confirmation_status = 'to_be_confirmed'
    OR public.is_plausible_pcn_registration_number(license_number)
  ) NOT VALID;

ALTER TABLE public.pharmacies
  DROP CONSTRAINT IF EXISTS pharmacies_full_requires_confirmed_pcn;
ALTER TABLE public.pharmacies
  ADD CONSTRAINT pharmacies_full_requires_confirmed_pcn
  CHECK (verification_status <> 'full' OR pcn_confirmation_status = 'confirmed');

-- The two deterministic test-account sales are discarded as voids. The
-- existing void function creates idempotent reversing stock movements, so the
-- ledger remains auditable without contributing to completed-sale reporting.
SELECT public.void_sale(
  '82000000-0000-4000-8000-000000000001'::UUID,
  'e7ead772-e6a4-4b4f-be81-5d1fa8577c44'::UUID
)
WHERE EXISTS (
  SELECT 1 FROM public.sales
  WHERE id = '82000000-0000-4000-8000-000000000001'::UUID
    AND pharmacy_id = 'b3d43a06-a765-4936-8ec2-bc6f1a0b023d'::UUID
);

SELECT public.void_sale(
  '92000000-0000-4000-8000-000000000001'::UUID,
  'e7ead772-e6a4-4b4f-be81-5d1fa8577c44'::UUID
)
WHERE EXISTS (
  SELECT 1 FROM public.sales
  WHERE id = '92000000-0000-4000-8000-000000000001'::UUID
    AND pharmacy_id = 'b3d43a06-a765-4936-8ec2-bc6f1a0b023d'::UUID
);

DO $$
DECLARE
  v_window_start TIMESTAMPTZ := NOW();
  v_real_ids UUID[] := ARRAY[
    '17815a5a-57bf-4f73-8c66-1d1df9af1164'::UUID, -- #4 Ski
    'f765d0c7-636c-4aab-a1b1-04d73df77844'::UUID, -- #8 Ceres
    '6a3c1f40-52ab-448c-ab54-f21fb50be8d9'::UUID, -- #10 BrigidCare
    '5233495e-e71d-4870-975e-67e8afca206a'::UUID, -- #11 Nolix
    'd92f0aa1-6a80-4d76-9966-27d7fec112ca'::UUID, -- #13 Kleeno
    '59b9fe13-5d66-4926-a894-e31455011b3e'::UUID, -- #15 Bouyanthealth
    '630aa9ad-180d-49eb-b332-98d27d0ba9f1'::UUID, -- #17 Mediarts
    '730d6524-e649-4222-ab98-bf6de08ec127'::UUID  -- #19 IFAM
  ];
  v_inactive_ids UUID[] := ARRAY[
    '822fd904-a23c-45a0-b6c2-1a4fa1133c8b'::UUID, -- #1 duplicate
    'ff377d6a-e957-4ebe-a6da-b32138e2724c'::UUID, -- #3 duplicate
    '197b9fe4-fe59-43d8-91b7-05f73868765c'::UUID, -- #5 junk
    'b200604f-d2c9-4ac9-9af9-3fb07589d063'::UUID, -- #6 junk
    'ea509e6b-b7fc-458c-a2bd-da4c6109adac'::UUID, -- #7 duplicate
    '67b6f3ea-f4a8-4706-85d7-08f6eb2c669a'::UUID, -- #9 duplicate
    'd8c81b05-3169-4b21-8dca-0e779f65bf1d'::UUID, -- #12 duplicate
    '4c709457-6c54-45a0-b612-3e5b0f50476e'::UUID, -- #14 duplicate
    '2f7e3d01-0e57-4cea-aea4-ec81b884185d'::UUID, -- #16 duplicate
    'ced612bb-0214-438a-8d3f-41b02fc8c67f'::UUID, -- #18 duplicate
    'b3d43a06-a765-4936-8ec2-bc6f1a0b023d'::UUID  -- #20 test pharmacy
  ];
BEGIN
  PERFORM set_config('app.pharmacy_verification_transition', 'on', TRUE);
  PERFORM set_config('app.pilot_pharmacy_verification', 'on', TRUE);
  PERFORM set_config('app.reservation_toggle_rpc', 'on', TRUE);

  UPDATE public.pharmacies
  SET is_active = FALSE,
      is_verified = FALSE,
      verification_status = 'revoked',
      verification_authorized_at = NULL,
      verification_authorization_basis = NULL,
      verification_documents_evidence_basis = NULL,
      verification_standards_evidence_basis = NULL,
      reservations_enabled = FALSE,
      updated_at = NOW()
  WHERE id = ANY(v_inactive_ids);

  -- Spirit remains the operator account but is deliberately not patient-visible.
  UPDATE public.pharmacies
  SET is_active = TRUE,
      is_verified = FALSE,
      verification_status = 'revoked',
      reservations_enabled = FALSE,
      updated_at = NOW()
  WHERE id = '2937265c-c164-4fda-918f-cb4ece9e29f2'::UUID;

  UPDATE public.pharmacies
  SET is_active = TRUE,
      is_verified = FALSE,
      verification_status = 'provisional',
      provisional_started_at = v_window_start,
      provisional_expires_at = v_window_start + INTERVAL '30 days',
      verification_authorized_at = NULL,
      verification_authorization_basis = NULL,
      verification_documents_evidence_basis = NULL,
      verification_standards_evidence_basis = NULL,
      reservations_enabled = FALSE,
      updated_at = NOW()
  WHERE id = ANY(v_real_ids);

  UPDATE public.pharmacies
  SET pcn_confirmation_status = 'to_be_confirmed', updated_at = NOW()
  WHERE id = ANY(ARRAY[
    '5233495e-e71d-4870-975e-67e8afca206a'::UUID,
    'd92f0aa1-6a80-4d76-9966-27d7fec112ca'::UUID,
    '630aa9ad-180d-49eb-b332-98d27d0ba9f1'::UUID
  ]);

  PERFORM set_config('app.reservation_toggle_rpc', 'off', TRUE);
  PERFORM set_config('app.pilot_pharmacy_verification', 'off', TRUE);
  PERFORM set_config('app.pharmacy_verification_transition', 'off', TRUE);

  IF (SELECT COUNT(*) FROM public.pharmacies WHERE id = ANY(v_real_ids)) NOT IN (0, 8)
     OR (SELECT COUNT(*) FROM public.pharmacies WHERE id = ANY(v_real_ids)
         AND is_active AND verification_status = 'provisional')
        <> (SELECT COUNT(*) FROM public.pharmacies WHERE id = ANY(v_real_ids)) THEN
    RAISE EXCEPTION 'Canonical real-pharmacy provisioning did not update all eight rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pharmacies
    WHERE id = ANY(v_inactive_ids) AND is_active
  ) THEN
    RAISE EXCEPTION 'A junk or test pharmacy remained active';
  END IF;
END;
$$;

-- One currently active pharmacy per authenticated account and PCN premises
-- number. Historical soft-deactivated rows remain available for audit.
CREATE UNIQUE INDEX IF NOT EXISTS pharmacies_one_active_per_user_idx
  ON public.pharmacies (user_id)
  WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS pharmacies_one_active_normalized_pcn_idx
  ON public.pharmacies (public.normalize_pcn_registration_number(license_number))
  WHERE is_active = TRUE;

CREATE OR REPLACE FUNCTION public.register_provisional_pharmacy(
  p_pharmacy_name TEXT,
  p_license_number TEXT,
  p_address TEXT,
  p_city TEXT,
  p_state TEXT,
  p_phone TEXT
)
RETURNS public.pharmacies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result public.pharmacies;
  v_license TEXT := public.normalize_pcn_registration_number(p_license_number);
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid() AND u.role = 'pharmacy'
  ) THEN
    RAISE EXCEPTION 'A pharmacy user profile is required';
  END IF;
  IF NOT public.is_plausible_pcn_registration_number(v_license) THEN
    RAISE EXCEPTION 'PCN premises number format is invalid';
  END IF;
  IF NULLIF(TRIM(p_pharmacy_name), '') IS NULL
     OR NULLIF(TRIM(p_address), '') IS NULL
     OR NULLIF(TRIM(p_city), '') IS NULL
     OR NULLIF(TRIM(p_state), '') IS NULL
     OR NULLIF(TRIM(p_phone), '') IS NULL THEN
    RAISE EXCEPTION 'Pharmacy name, address, city, state, and phone are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('pharmacy-user:' || auth.uid()::TEXT));
  PERFORM pg_advisory_xact_lock(hashtext('pharmacy-pcn:' || v_license));

  SELECT * INTO v_result
  FROM public.pharmacies ph
  WHERE ph.user_id = auth.uid() AND ph.is_active
  FOR UPDATE;
  IF FOUND THEN
    IF public.normalize_pcn_registration_number(v_result.license_number) = v_license THEN
      RETURN v_result;
    END IF;
    RAISE EXCEPTION 'This account already has a pharmacy registration';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pharmacies existing
    WHERE public.normalize_pcn_registration_number(existing.license_number) = v_license
  ) THEN
    RAISE EXCEPTION 'This PCN premises number already has a registration';
  END IF;

  PERFORM set_config('app.pharmacy_registration_rpc', 'on', TRUE);
  INSERT INTO public.pharmacies (
    user_id, pharmacy_name, license_number, address, city, state, phone,
    is_verified, is_active, reservations_enabled, pcn_confirmation_status
  ) VALUES (
    auth.uid(), TRIM(p_pharmacy_name), v_license, TRIM(p_address),
    TRIM(p_city), TRIM(p_state), TRIM(p_phone), FALSE, TRUE, FALSE, 'confirmed'
  ) RETURNING * INTO v_result;
  PERFORM set_config('app.pharmacy_registration_rpc', 'off', TRUE);

  INSERT INTO public.pharmacy_verification_audit (
    pharmacy_id, action, basis, actor_user_id, actor_role
  ) VALUES (
    v_result.id, 'registered_provisional',
    'Format-plausible PCN premises number accepted; verification evidence pending',
    auth.uid(), auth.role()
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.register_provisional_pharmacy(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_provisional_pharmacy(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_sale_operator_pharmacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cashier_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = NEW.pharmacy_id
      AND ph.user_id = NEW.cashier_id
      AND ph.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Sale pharmacy must match the authenticated operator pharmacy';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_sale_operator_pharmacy_trigger ON public.sales;
CREATE TRIGGER enforce_sale_operator_pharmacy_trigger
BEFORE INSERT OR UPDATE OF pharmacy_id, cashier_id ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.enforce_sale_operator_pharmacy();

-- Repair the only operator metadata pointer explicitly in scope. The server
-- resolver also verifies ownership and no longer trusts this cache by itself.
UPDATE auth.users
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
  || jsonb_build_object('pharmacy_id', '2937265c-c164-4fda-918f-cb4ece9e29f2')
WHERE id = 'd19fb6e7-96b9-45be-aaca-fa2af59edfdd'::UUID;

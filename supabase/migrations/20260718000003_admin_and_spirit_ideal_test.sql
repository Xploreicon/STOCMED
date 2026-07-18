-- Explicit pilot identities requested for production dogfooding.
-- All synthetic evidence is clearly marked TEST ONLY and remains auditable.

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS test_account_label TEXT;

ALTER TABLE public.pharmacies
  DROP CONSTRAINT IF EXISTS pharmacies_test_account_label_complete;
ALTER TABLE public.pharmacies
  ADD CONSTRAINT pharmacies_test_account_label_complete CHECK (
    (is_test_account AND NULLIF(TRIM(test_account_label), '') IS NOT NULL)
    OR (NOT is_test_account AND test_account_label IS NULL)
  );

DO $$
DECLARE
  v_admin_user_id UUID := '8d9b16a1-05d4-49f8-b13f-2211cc26abbc'::UUID;
  v_spirit_user_id UUID := 'd19fb6e7-96b9-45be-aaca-fa2af59edfdd'::UUID;
  v_spirit_pharmacy_id UUID := '2937265c-c164-4fda-918f-cb4ece9e29f2'::UUID;
  v_admin_basis TEXT :=
    'Owner-authorized production administrator: iconfavour005@gmail.com; 2026-07-18';
  v_test_basis TEXT :=
    'TEST ONLY: Spirit end-to-end dogfood account; synthetic PCN and document bypass explicitly authorized by owner on 2026-07-18; not regulatory evidence';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = v_admin_user_id AND LOWER(email) = 'iconfavour005@gmail.com'
  ) THEN
    RAISE EXCEPTION 'Expected administrator auth identity was not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacies
    WHERE id = v_spirit_pharmacy_id AND user_id = v_spirit_user_id
  ) THEN
    RAISE EXCEPTION 'Expected Spirit pharmacy ownership was not found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pharmacies
    WHERE id <> v_spirit_pharmacy_id
      AND public.normalize_pcn_registration_number(license_number) = '990000002'
  ) THEN
    RAISE EXCEPTION 'Reserved Spirit test PCN is already in use';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id <> v_spirit_user_id
      AND public.normalize_pharmacist_license_number(pharmacist_license_number) = 'TEST-SP-0002'
  ) THEN
    RAISE EXCEPTION 'Reserved Spirit test pharmacist licence is already in use';
  END IF;

  -- Migration-time provenance reset is the auditable provisioning mechanism;
  -- normal application sessions cannot alter these protected fields.
  PERFORM set_config('app.pilot_role_provenance_reset', 'on', TRUE);
  PERFORM set_config('app.pharmacy_verification_transition', 'on', TRUE);
  PERFORM set_config('app.pilot_pharmacy_verification', 'on', TRUE);
  PERFORM set_config('app.reservation_toggle_rpc', 'on', TRUE);

  UPDATE public.users
  SET is_admin = TRUE,
      admin_authorized_at = NOW(),
      admin_authorization_basis = v_admin_basis,
      updated_at = NOW()
  WHERE user_id = v_admin_user_id;

  UPDATE public.users
  SET is_licensed_pharmacist = TRUE,
      pharmacist_license_number = 'TEST-SP-0002',
      pharmacist_license_verified_at = NOW(),
      pharmacist_license_verification_basis = v_test_basis,
      is_stocmed_sp = FALSE,
      stocmed_sp_authorized_at = NULL,
      stocmed_sp_authorization_basis = NULL,
      updated_at = NOW()
  WHERE user_id = v_spirit_user_id;

  UPDATE public.pharmacies
  SET license_number = '990000002',
      pcn_confirmation_status = 'confirmed',
      is_active = TRUE,
      is_verified = TRUE,
      verification_status = 'full',
      provisional_started_at = NOW(),
      -- These timestamps remain a historical registration window even after
      -- FULL promotion and must satisfy the lifecycle's exact-30-day invariant.
      provisional_expires_at = NOW() + INTERVAL '30 days',
      verification_submitted_at = NOW(),
      pcn_standards_accepted_at = NOW(),
      verification_authorized_at = NOW(),
      verification_authorization_basis = v_test_basis,
      verification_documents_evidence_basis =
        'TEST ONLY: premises certificate and superintendent annual licence requirements bypassed for Spirit dogfood account',
      verification_standards_evidence_basis =
        'TEST ONLY: current PCN standards treated as accepted for Spirit dogfood account',
      legacy_verification_bootstrap_eligible = FALSE,
      reservations_enabled = TRUE,
      is_test_account = TRUE,
      test_account_label = 'SPIRIT_IDEAL_E2E_TEST_ONLY',
      updated_at = NOW()
  WHERE id = v_spirit_pharmacy_id;

  PERFORM set_config('app.reservation_toggle_rpc', 'off', TRUE);
  PERFORM set_config('app.pilot_pharmacy_verification', 'off', TRUE);
  PERFORM set_config('app.pharmacy_verification_transition', 'off', TRUE);
  PERFORM set_config('app.pilot_role_provenance_reset', 'off', TRUE);

  INSERT INTO public.pilot_provisioning_audit (
    target_user_id, capability, action, basis, provisioned_by, provisioner_role
  ) VALUES
    (v_admin_user_id, 'admin', 'provision', v_admin_basis, v_admin_user_id, 'migration_owner_authorization'),
    (v_spirit_user_id, 'licensed_pharmacist', 'provision', v_test_basis, v_admin_user_id, 'migration_owner_authorization');

  INSERT INTO public.pilot_provisioning_audit (
    target_pharmacy_id, capability, action, basis, provisioned_by, provisioner_role
  ) VALUES (
    v_spirit_pharmacy_id, 'pharmacy_verification', 'provision', v_test_basis,
    v_admin_user_id, 'migration_owner_authorization'
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = v_admin_user_id AND is_admin
      AND admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(admin_authorization_basis), '') IS NOT NULL
  ) THEN RAISE EXCEPTION 'Administrator provisioning failed'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    JOIN public.users sp ON sp.user_id = ph.user_id
    WHERE ph.id = v_spirit_pharmacy_id
      AND ph.is_test_account AND ph.is_active AND ph.is_verified
      AND ph.verification_status = 'full'
      AND ph.pcn_confirmation_status = 'confirmed'
      AND ph.reservations_enabled
      AND sp.is_licensed_pharmacist
      AND NOT sp.is_stocmed_sp
  ) THEN RAISE EXCEPTION 'Spirit ideal test provisioning failed'; END IF;
END;
$$;

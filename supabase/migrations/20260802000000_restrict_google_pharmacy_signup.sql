-- Google may authenticate an existing pharmacy identity, but it may never
-- provision a new pharmacy account. public.users remains authoritative for an
-- existing role; user-editable auth metadata is not consulted for elevation.

CREATE OR REPLACE FUNCTION public.complete_oauth_profile(
  p_role TEXT,
  p_full_name TEXT,
  p_phone TEXT,
  p_location TEXT,
  p_pharmacy_name TEXT DEFAULT NULL,
  p_license_number TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_account auth.users;
  v_existing_role TEXT;
  v_existing_pharmacy_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_account FROM auth.users WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_account.email IS NULL THEN
    RAISE EXCEPTION 'Authenticated account not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE user_id = auth.uid() AND provider = 'google'
  ) THEN
    RAISE EXCEPTION 'OAuth profile completion requires a linked Google identity';
  END IF;

  -- Existing profiles are immutable here. This preserves an established
  -- patient or pharmacy role regardless of any crafted onboarding payload.
  SELECT profile.role INTO v_existing_role
  FROM public.users profile
  WHERE profile.user_id = auth.uid()
  FOR UPDATE;

  IF FOUND THEN
    SELECT pharmacy.id INTO v_existing_pharmacy_id
    FROM public.pharmacies pharmacy
    WHERE pharmacy.user_id = auth.uid() AND pharmacy.is_active = TRUE
    ORDER BY pharmacy.created_at
    LIMIT 1;

    RETURN jsonb_build_object(
      'role', v_existing_role,
      'pharmacy_id', v_existing_pharmacy_id,
      'existing_profile', TRUE
    );
  END IF;

  -- This check occurs before the shared profile writer. A rejected request
  -- cannot leave a public.users or pharmacies row behind.
  IF p_role IS DISTINCT FROM 'patient' THEN
    RAISE EXCEPTION 'New pharmacy accounts cannot be created with Google; use email and password';
  END IF;

  PERFORM public.create_required_profile_for_auth_identity(
    v_account.id, v_account.email, 'patient', p_full_name, p_phone, p_location
  );

  UPDATE auth.users
  SET raw_user_meta_data = (
      COALESCE(raw_user_meta_data, '{}'::JSONB)
      - 'pharmacy_id'
      - 'pharmacy_profile'
    ) || jsonb_build_object(
      'role', 'patient',
      'full_name', TRIM(p_full_name),
      'phone', p_phone,
      'location', TRIM(p_location)
    ),
    updated_at = NOW()
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'role', 'patient',
    'pharmacy_id', NULL,
    'existing_profile', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_oauth_profile(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_oauth_profile(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.complete_oauth_profile(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS 'Completes new Google identities as patients only; existing persisted roles are returned unchanged.';

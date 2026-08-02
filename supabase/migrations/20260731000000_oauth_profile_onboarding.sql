-- Keep password and OAuth signup on one authoritative profile-creation path.
-- OAuth identities intentionally arrive without a role and complete this path
-- only after the user chooses patient or pharmacy.

CREATE OR REPLACE FUNCTION public.create_required_profile_for_auth_identity(
  p_user_id UUID,
  p_email TEXT,
  p_role TEXT,
  p_full_name TEXT,
  p_phone TEXT,
  p_location TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id_type TEXT;
BEGIN
  IF p_role NOT IN ('patient', 'pharmacy') THEN
    RAISE EXCEPTION 'Unsupported StocMed signup role';
  END IF;
  IF p_user_id IS NULL OR NULLIF(TRIM(p_email), '') IS NULL
     OR NULLIF(TRIM(p_full_name), '') IS NULL
     OR NULLIF(TRIM(p_phone), '') IS NULL THEN
    RAISE EXCEPTION 'Name, phone, and email are required to create a StocMed profile';
  END IF;
  IF p_phone !~ '^\+234[789][01][0-9]{8}$' THEN
    RAISE EXCEPTION 'Enter a valid Nigerian mobile number in +234 format';
  END IF;
  IF NULLIF(TRIM(p_location), '') IS NULL THEN
    RAISE EXCEPTION 'Location is required to create a StocMed profile';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('stocmed-profile:' || p_user_id::TEXT));

  IF EXISTS (SELECT 1 FROM public.users WHERE user_id = p_user_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE user_id = p_user_id AND role = p_role
        AND NULLIF(TRIM(location), '') = TRIM(p_location)
    ) THEN
      RAISE EXCEPTION 'This account already has a different StocMed profile';
    END IF;
    RETURN;
  END IF;

  SELECT data_type INTO v_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id';

  IF v_id_type = 'uuid' THEN
    INSERT INTO public.users (id, user_id, email, full_name, phone, role, location)
    VALUES (
      p_user_id, p_user_id, LOWER(TRIM(p_email)), TRIM(p_full_name),
      p_phone, p_role, TRIM(p_location)
    );
  ELSE
    INSERT INTO public.users (user_id, email, full_name, phone, role, location)
    VALUES (
      p_user_id, LOWER(TRIM(p_email)), TRIM(p_full_name),
      p_phone, p_role, TRIM(p_location)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_user_id AND role = p_role
      AND NULLIF(TRIM(location), '') = TRIM(p_location)
  ) THEN
    RAISE EXCEPTION 'StocMed profile verification failed';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_required_profile_for_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT := NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), '');
BEGIN
  -- OAuth signup is completed after role selection. Returning here avoids a
  -- second, partial profile-creation path.
  IF v_role IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.create_required_profile_for_auth_identity(
    NEW.id,
    NEW.email,
    v_role,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'location'
  );
  RETURN NEW;
END;
$$;

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
  v_pharmacy public.pharmacies;
  v_location TEXT := CASE WHEN p_role = 'pharmacy' THEN p_city ELSE p_location END;
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

  PERFORM public.create_required_profile_for_auth_identity(
    v_account.id, v_account.email, p_role, p_full_name, p_phone, v_location
  );

  UPDATE auth.users
  SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
    || jsonb_build_object(
      'role', p_role,
      'full_name', TRIM(p_full_name),
      'phone', p_phone,
      'location', TRIM(v_location)
    ),
    updated_at = NOW()
  WHERE id = auth.uid();

  IF p_role = 'pharmacy' THEN
    SELECT * INTO v_pharmacy
    FROM public.register_provisional_pharmacy(
      p_pharmacy_name, p_license_number, p_address, p_city, p_state, p_phone
    );

    UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data
      || jsonb_build_object('pharmacy_id', v_pharmacy.id),
      updated_at = NOW()
    WHERE id = auth.uid();
  END IF;

  RETURN jsonb_build_object(
    'role', p_role,
    'pharmacy_id', CASE WHEN v_pharmacy.id IS NULL THEN NULL ELSE v_pharmacy.id END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_required_profile_for_auth_identity(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_required_profile_for_auth_user()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_oauth_profile(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_oauth_profile(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.create_required_profile_for_auth_identity(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) IS 'Single authoritative and idempotent profile creation path for password and OAuth signup.';

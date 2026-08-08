-- Make application signup profile creation part of the auth.users transaction.
-- An exception from this trigger aborts the auth signup instead of leaving an
-- orphaned account that only appeared to save its location.

CREATE OR REPLACE FUNCTION public.create_required_profile_for_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role_text TEXT := NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), '');
  v_full_name TEXT := NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), '');
  v_phone TEXT := NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), '');
  v_location TEXT := NULLIF(TRIM(NEW.raw_user_meta_data->>'location'), '');
  v_id_type TEXT;
BEGIN
  -- Auth identities created outside the StocMed signup form (for example local
  -- seed/admin identities) remain the responsibility of their explicit
  -- provisioning path.
  IF v_role_text IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_role_text NOT IN ('patient', 'pharmacy') THEN
    RAISE EXCEPTION 'Unsupported StocMed signup role';
  END IF;
  IF v_full_name IS NULL OR v_phone IS NULL OR NEW.email IS NULL THEN
    RAISE EXCEPTION 'Name, phone, and email are required to create a StocMed profile';
  END IF;
  IF v_location IS NULL THEN
    RAISE EXCEPTION 'Location is required to create a StocMed profile';
  END IF;

  SELECT data_type
  INTO v_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'id';

  IF v_id_type = 'uuid' THEN
    INSERT INTO public.users (
      id, user_id, email, full_name, phone, role, location
    ) VALUES (
      NEW.id, NEW.id, NEW.email, v_full_name, v_phone,
      v_role_text::public.user_role, v_location
    );
  ELSE
    INSERT INTO public.users (
      user_id, email, full_name, phone, role, location
    ) VALUES (
      NEW.id, NEW.email, v_full_name, v_phone,
      v_role_text::public.user_role, v_location
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users profile
    WHERE profile.user_id = NEW.id
      AND profile.role = v_role_text::public.user_role
      AND NULLIF(TRIM(profile.location), '') = v_location
  ) THEN
    RAISE EXCEPTION 'StocMed profile verification failed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_required_profile_after_auth_signup ON auth.users;
CREATE TRIGGER create_required_profile_after_auth_signup
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.create_required_profile_for_auth_user();

REVOKE ALL ON FUNCTION public.create_required_profile_for_auth_user()
FROM PUBLIC, anon, authenticated;

-- Recover only values already present in authoritative auth metadata. Never
-- infer a patient's primary location from searches or device coordinates.
DO $$
DECLARE
  v_id_type TEXT;
BEGIN
  SELECT data_type
  INTO v_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'id';

  IF v_id_type = 'uuid' THEN
    INSERT INTO public.users (
      id, user_id, email, full_name, phone, role, location
    )
    SELECT
      account.id,
      account.id,
      account.email,
      COALESCE(NULLIF(TRIM(account.raw_user_meta_data->>'full_name'), ''), account.email),
      COALESCE(NULLIF(TRIM(account.raw_user_meta_data->>'phone'), ''), ''),
      (account.raw_user_meta_data->>'role')::public.user_role,
      NULLIF(TRIM(account.raw_user_meta_data->>'location'), '')
    FROM auth.users account
    LEFT JOIN public.users profile ON profile.user_id = account.id
    WHERE profile.user_id IS NULL
      AND account.raw_user_meta_data->>'role' IN ('patient', 'pharmacy')
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    INSERT INTO public.users (
      user_id, email, full_name, phone, role, location
    )
    SELECT
      account.id,
      account.email,
      COALESCE(NULLIF(TRIM(account.raw_user_meta_data->>'full_name'), ''), account.email),
      COALESCE(NULLIF(TRIM(account.raw_user_meta_data->>'phone'), ''), ''),
      (account.raw_user_meta_data->>'role')::public.user_role,
      NULLIF(TRIM(account.raw_user_meta_data->>'location'), '')
    FROM auth.users account
    LEFT JOIN public.users profile ON profile.user_id = account.id
    WHERE profile.user_id IS NULL
      AND account.raw_user_meta_data->>'role' IN ('patient', 'pharmacy')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  UPDATE public.users profile
  SET location = NULLIF(TRIM(account.raw_user_meta_data->>'location'), ''),
      updated_at = NOW()
  FROM auth.users account
  WHERE account.id = profile.user_id
    AND NULLIF(TRIM(profile.location), '') IS NULL
    AND NULLIF(TRIM(account.raw_user_meta_data->>'location'), '') IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.create_required_profile_for_auth_user() IS
  'Creates and verifies the required public.users profile inside auth signup; exceptions roll back auth.users insertion.';

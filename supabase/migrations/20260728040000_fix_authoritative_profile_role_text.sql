-- Production's canonical public.users.role column is text. The authoritative
-- signup trigger still compared it to user_role, which raises
-- "operator does not exist: text = user_role" for real signup metadata.
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
      v_role_text, v_location
    );
  ELSE
    INSERT INTO public.users (
      user_id, email, full_name, phone, role, location
    ) VALUES (
      NEW.id, NEW.email, v_full_name, v_phone,
      v_role_text, v_location
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users profile
    WHERE profile.user_id = NEW.id
      AND profile.role = v_role_text
      AND NULLIF(TRIM(profile.location), '') = v_location
  ) THEN
    RAISE EXCEPTION 'StocMed profile verification failed';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_required_profile_for_auth_user()
FROM PUBLIC, anon, authenticated;

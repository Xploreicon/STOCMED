-- Production is the schema source of truth for the legacy identity/search
-- objects below. The initial migrations carry their exact table definitions
-- so a fresh replay gets the correct column order, types, nullability and FKs.
-- This end-of-chain baseline is intentionally additive and guarded: it fills
-- in production-live policies/triggers/indexes, but never rewrites a core
-- column or existing row.

DO $$
DECLARE
  v_users_id_type TEXT;
  v_users_role_type TEXT;
  v_search_session_type TEXT;
  v_chat_session_type TEXT;
BEGIN
  SELECT data_type INTO v_users_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id';

  SELECT data_type INTO v_users_role_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role';

  SELECT data_type INTO v_search_session_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'searches' AND column_name = 'session_id';

  SELECT data_type INTO v_chat_session_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'session_id';

  IF v_users_id_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION
      'Baseline guard: public.users.id is %, expected bigint; structural reconciliation requires explicit approval',
      COALESCE(v_users_id_type, '<missing>');
  END IF;
  IF v_users_role_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION
      'Baseline guard: public.users.role is %, expected text; structural reconciliation requires explicit approval',
      COALESCE(v_users_role_type, '<missing>');
  END IF;
  IF v_search_session_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION
      'Baseline guard: public.searches.session_id is %, expected uuid; structural reconciliation requires explicit approval',
      COALESCE(v_search_session_type, '<missing>');
  END IF;
  IF v_chat_session_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION
      'Baseline guard: public.chat_messages.session_id is %, expected uuid; structural reconciliation requires explicit approval',
      COALESCE(v_chat_session_type, '<missing>');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_enum enum_value
    JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
    JOIN pg_namespace enum_schema ON enum_schema.oid = enum_type.typnamespace
    WHERE enum_schema.nspname = 'public'
      AND enum_type.typname = 'stock_movement_type'
      AND enum_value.enumlabel = 'write_off'
  ) THEN
    RAISE EXCEPTION
      'Baseline guard: stock_movement_type contains non-production label write_off; enum removal requires explicit approval';
  END IF;
END;
$$;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS operating_hours VARCHAR(255),
  ADD COLUMN IF NOT EXISTS p2p_verified BOOLEAN DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS users_user_id_idx
  ON public.users (user_id);

DO $baseline$
BEGIN
  IF to_regprocedure('public.set_timestamp()') IS NULL THEN
    EXECUTE $ddl$
CREATE FUNCTION public.set_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
$ddl$;
  END IF;

  IF to_regprocedure('public.set_users_timestamp()') IS NULL THEN
    EXECUTE $ddl$
CREATE FUNCTION public.set_users_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
$ddl$;
  END IF;

  IF to_regprocedure('public.sync_user_profile()') IS NULL THEN
    EXECUTE $ddl$
CREATE FUNCTION public.sync_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
begin
  insert into public.users (user_id, email, full_name, phone, role, location, created_at, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'role', 'patient'),
    coalesce(new.raw_user_meta_data->>'location', ''),
    new.created_at,
    now()
  )
  on conflict (user_id)
  do update set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone,
    role = excluded.role,
    location = excluded.location,
    updated_at = now();

  return new;
end;
$function$
$ddl$;
  END IF;
END;
$baseline$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.pharmacies'::regclass
      AND tgname = 'set_timestamp'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER set_timestamp
    BEFORE UPDATE ON public.pharmacies
    FOR EACH ROW EXECUTE FUNCTION public.set_timestamp();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.users'::regclass
      AND tgname = 'set_users_timestamp'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER set_users_timestamp
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.set_users_timestamp();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND tgname = 'sync_user_profile_trigger'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER sync_user_profile_trigger
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.sync_user_profile();
  END IF;
END;
$$;

-- Remove replay-only policies that are absent from production. These names do
-- not exist on production, so this section is a no-op there.
DROP POLICY IF EXISTS "Allow users to insert own pharmacy" ON public.pharmacies;
DROP POLICY IF EXISTS "Allow users to update own pharmacy" ON public.pharmacies;
DROP POLICY IF EXISTS "Allow users to view own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Allow users/anon to insert chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Allow users to update own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Allow users to delete own chat messages" ON public.chat_messages;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users'
      AND policyname = 'Users can read their own record'
  ) THEN
    CREATE POLICY "Users can read their own record"
      ON public.users FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users'
      AND policyname = 'Users can update their own record'
  ) THEN
    CREATE POLICY "Users can update their own record"
      ON public.users FOR UPDATE TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users'
      AND policyname = 'allow insert to own row'
  ) THEN
    CREATE POLICY "allow insert to own row"
      ON public.users FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users'
      AND policyname = 'allow select for analytics'
  ) THEN
    CREATE POLICY "allow select for analytics"
      ON public.users FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users'
      AND policyname = 'analytics-read-users'
  ) THEN
    CREATE POLICY "analytics-read-users"
      ON public.users FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users'
      AND policyname = 'users_insert_own_row'
  ) THEN
    CREATE POLICY "users_insert_own_row"
      ON public.users FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users'
      AND policyname = 'users_select_own_or_analytics'
  ) THEN
    CREATE POLICY "users_select_own_or_analytics"
      ON public.users FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pharmacies'
      AND policyname = 'Users can insert their own pharmacy'
  ) THEN
    CREATE POLICY "Users can insert their own pharmacy"
      ON public.pharmacies FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pharmacies'
      AND policyname = 'Users can update their own pharmacy'
  ) THEN
    CREATE POLICY "Users can update their own pharmacy"
      ON public.pharmacies FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pharmacies'
      AND policyname = 'Users can view their own pharmacy'
  ) THEN
    CREATE POLICY "Users can view their own pharmacy"
      ON public.pharmacies FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'searches'
      AND policyname = 'Anyone can insert searches'
  ) THEN
    CREATE POLICY "Anyone can insert searches"
      ON public.searches FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'searches'
      AND policyname = 'Users can view their own searches'
  ) THEN
    CREATE POLICY "Users can view their own searches"
      ON public.searches FOR SELECT
      USING (auth.uid() = user_id OR user_id IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'chat_messages'
      AND policyname = 'Users can insert their own messages'
  ) THEN
    CREATE POLICY "Users can insert their own messages"
      ON public.chat_messages FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'chat_messages'
      AND policyname = 'Users can view their own messages'
  ) THEN
    CREATE POLICY "Users can view their own messages"
      ON public.chat_messages FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END;
$$;

-- Complete the shared email library and add consent-scoped PWA web push.
-- Provider calls remain outside database transactions: profile creation only
-- creates a durable welcome job, and the application cron queues the email.

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS body_format TEXT NOT NULL DEFAULT 'markdown';

ALTER TABLE public.broadcasts
  DROP CONSTRAINT IF EXISTS broadcasts_body_format_check;
ALTER TABLE public.broadcasts
  ADD CONSTRAINT broadcasts_body_format_check
  CHECK (body_format IN ('markdown', 'html'));

CREATE TABLE IF NOT EXISTS public.welcome_email_jobs (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('patient', 'pharmacy')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queued_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS welcome_email_jobs_pending_idx
  ON public.welcome_email_jobs(next_attempt_at, created_at)
  WHERE status = 'pending';

ALTER TABLE public.welcome_email_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.welcome_email_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.welcome_email_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.queue_welcome_email_after_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('patient', 'pharmacy') AND NOT COALESCE(NEW.is_admin, FALSE) THEN
    INSERT INTO public.welcome_email_jobs(user_id, role)
    VALUES (NEW.user_id, NEW.role)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Email infrastructure must never roll back account/profile creation.
  RAISE WARNING 'Could not create welcome email job for %: %', NEW.user_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS queue_welcome_email_after_profile ON public.users;
CREATE TRIGGER queue_welcome_email_after_profile
AFTER INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.queue_welcome_email_after_profile();

REVOKE ALL ON FUNCTION public.queue_welcome_email_after_profile()
  FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL CHECK (char_length(endpoint) BETWEEN 1 AND 2048),
  p256dh TEXT NOT NULL CHECK (char_length(p256dh) BETWEEN 1 AND 512),
  auth_key TEXT NOT NULL CHECK (char_length(auth_key) BETWEEN 1 AND 256),
  user_agent TEXT CHECK (char_length(user_agent) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON public.push_subscriptions(user_id, updated_at DESC);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_owner_select ON public.push_subscriptions;
CREATE POLICY push_subscriptions_owner_select ON public.push_subscriptions
FOR SELECT TO authenticated USING (user_id = auth.uid());

GRANT SELECT ON public.push_subscriptions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.push_subscriptions
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

CREATE OR REPLACE FUNCTION public.set_authenticated_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth_key TEXT,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.push_subscriptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(p_endpoint), '') IS NULL OR char_length(p_endpoint) > 2048
     OR p_endpoint !~ '^https://' THEN
    RAISE EXCEPTION 'A valid HTTPS push endpoint is required';
  END IF;
  IF NULLIF(trim(p_p256dh), '') IS NULL OR char_length(p_p256dh) > 512
     OR NULLIF(trim(p_auth_key), '') IS NULL OR char_length(p_auth_key) > 256 THEN
    RAISE EXCEPTION 'Valid push encryption keys are required';
  END IF;

  INSERT INTO public.push_subscriptions(
    user_id, endpoint, p256dh, auth_key, user_agent, updated_at
  ) VALUES (
    auth.uid(), trim(p_endpoint), trim(p_p256dh), trim(p_auth_key),
    NULLIF(left(trim(COALESCE(p_user_agent, '')), 500), ''), NOW()
  )
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    p256dh = EXCLUDED.p256dh,
    auth_key = EXCLUDED.auth_key,
    user_agent = EXCLUDED.user_agent,
    updated_at = NOW()
  WHERE public.push_subscriptions.user_id = auth.uid()
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'This push subscription belongs to another account' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notification_preferences(user_id, patient_push_consent, updated_at)
  VALUES (auth.uid(), TRUE, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    patient_push_consent = TRUE,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'id', v_row.id,
    'endpoint', v_row.endpoint,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_authenticated_push_subscription(
  p_endpoint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_deleted BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE user_id = auth.uid() AND endpoint = p_endpoint;
  v_deleted := FOUND;

  IF NOT EXISTS (
    SELECT 1 FROM public.push_subscriptions WHERE user_id = auth.uid()
  ) THEN
    UPDATE public.notification_preferences
    SET patient_push_consent = FALSE, updated_at = NOW()
    WHERE user_id = auth.uid();
  END IF;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.set_authenticated_push_subscription(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_authenticated_push_subscription(TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_authenticated_push_subscription(TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_authenticated_push_subscription(TEXT)
  TO authenticated;

-- Email audiences exclude broadcast suppressions. "All users" and individual
-- user lookup cover both patient and pharmacy profiles; pharmacy-only segments
-- retain their active/tier/feature filters.
CREATE OR REPLACE FUNCTION public.resolve_broadcast_audience(
  p_actor_id UUID,
  p_audience JSONB
)
RETURNS TABLE (
  user_id UUID,
  pharmacy_id UUID,
  email TEXT,
  display_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_kind TEXT := p_audience->>'kind';
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.broadcast_admin_is_authorized(p_actor_id) THEN
    RAISE EXCEPTION 'Authorized administrator required' USING ERRCODE = '42501';
  END IF;
  IF p_audience IS NULL OR jsonb_typeof(p_audience) <> 'object' THEN
    RAISE EXCEPTION 'Audience is required';
  END IF;

  IF v_kind IN (
    'all_pharmacies', 'premium_pharmacies', 'free_pharmacies',
    'individual_pharmacy', 'custom'
  ) THEN
    RETURN QUERY
    SELECT account.id, pharmacy.id, lower(account.email::TEXT), pharmacy.pharmacy_name::TEXT
    FROM public.pharmacies pharmacy
    JOIN auth.users account ON account.id = pharmacy.user_id
    WHERE pharmacy.is_active = TRUE
      AND NULLIF(trim(account.email::TEXT), '') IS NOT NULL
      AND (v_kind <> 'premium_pharmacies' OR pharmacy.subscription_tier = 'premium')
      AND (v_kind <> 'free_pharmacies' OR pharmacy.subscription_tier = 'free')
      AND (v_kind <> 'individual_pharmacy' OR pharmacy.id = (p_audience->>'pharmacy_id')::UUID)
      AND (v_kind <> 'custom' OR NULLIF(trim(p_audience->>'city'), '') IS NULL
        OR pharmacy.city ILIKE '%' || trim(p_audience->>'city') || '%')
      AND (v_kind <> 'custom' OR NULLIF(trim(p_audience->>'verification_status'), '') IS NULL
        OR pharmacy.verification_status = p_audience->>'verification_status')
      AND (v_kind <> 'custom' OR NULLIF(trim(p_audience->>'feature_key'), '') IS NULL
        OR EXISTS (
          SELECT 1 FROM public.pharmacy_features feature
          WHERE feature.pharmacy_id = pharmacy.id
            AND feature.feature_key = p_audience->>'feature_key'
            AND feature.is_enabled = COALESCE(NULLIF(p_audience->>'feature_enabled', '')::BOOLEAN, TRUE)
        ))
      AND (v_kind <> 'custom' OR NULLIF(p_audience->>'last_active_after', '') IS NULL
        OR account.last_sign_in_at >= (p_audience->>'last_active_after')::TIMESTAMPTZ)
      AND NOT EXISTS (
        SELECT 1 FROM public.email_suppressions suppression
        WHERE suppression.user_id = account.id AND suppression.category = 'broadcast'
      )
    ORDER BY pharmacy.pharmacy_name, account.id;
    RETURN;
  END IF;

  IF v_kind IN ('all_users', 'all_patients', 'individual_user') THEN
    RETURN QUERY
    SELECT account.id, pharmacy.id, lower(account.email::TEXT),
      COALESCE(
        CASE WHEN profile.role = 'pharmacy' THEN NULLIF(trim(pharmacy.pharmacy_name), '') END,
        NULLIF(trim(profile.full_name), ''),
        split_part(account.email::TEXT, '@', 1)
      )::TEXT
    FROM auth.users account
    JOIN public.users profile ON profile.user_id = account.id
    LEFT JOIN LATERAL (
      SELECT candidate.id, candidate.pharmacy_name
      FROM public.pharmacies candidate
      WHERE candidate.user_id = account.id
      ORDER BY candidate.is_active DESC, candidate.created_at DESC
      LIMIT 1
    ) pharmacy ON TRUE
    WHERE profile.role IN ('patient', 'pharmacy')
      AND (v_kind = 'individual_user' OR profile.is_admin = FALSE)
      AND NULLIF(trim(account.email::TEXT), '') IS NOT NULL
      AND (v_kind <> 'all_patients' OR profile.role = 'patient')
      AND (v_kind <> 'individual_user' OR account.id = (p_audience->>'user_id')::UUID)
      AND NOT EXISTS (
        SELECT 1 FROM public.email_suppressions suppression
        WHERE suppression.user_id = account.id AND suppression.category = 'broadcast'
      )
    ORDER BY 4 NULLS LAST, account.id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Unsupported broadcast audience';
END;
$$;

-- Push segments intentionally ignore email suppression. An active browser
-- subscription is the push consent boundary.
CREATE OR REPLACE FUNCTION public.resolve_push_audience(
  p_actor_id UUID,
  p_audience JSONB
)
RETURNS TABLE (
  user_id UUID,
  pharmacy_id UUID,
  email TEXT,
  display_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_kind TEXT := p_audience->>'kind';
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.broadcast_admin_is_authorized(p_actor_id) THEN
    RAISE EXCEPTION 'Authorized administrator required' USING ERRCODE = '42501';
  END IF;
  IF p_audience IS NULL OR jsonb_typeof(p_audience) <> 'object' THEN
    RAISE EXCEPTION 'Audience is required';
  END IF;

  IF v_kind IN (
    'all_pharmacies', 'premium_pharmacies', 'free_pharmacies',
    'individual_pharmacy', 'custom'
  ) THEN
    RETURN QUERY
    SELECT account.id, pharmacy.id, lower(account.email::TEXT), pharmacy.pharmacy_name::TEXT
    FROM public.pharmacies pharmacy
    JOIN auth.users account ON account.id = pharmacy.user_id
    WHERE pharmacy.is_active = TRUE
      AND EXISTS (SELECT 1 FROM public.push_subscriptions subscription WHERE subscription.user_id = account.id)
      AND EXISTS (
        SELECT 1 FROM public.notification_preferences preference
        WHERE preference.user_id = account.id AND preference.patient_push_consent = TRUE
      )
      AND (v_kind <> 'premium_pharmacies' OR pharmacy.subscription_tier = 'premium')
      AND (v_kind <> 'free_pharmacies' OR pharmacy.subscription_tier = 'free')
      AND (v_kind <> 'individual_pharmacy' OR pharmacy.id = (p_audience->>'pharmacy_id')::UUID)
      AND (v_kind <> 'custom' OR NULLIF(trim(p_audience->>'city'), '') IS NULL
        OR pharmacy.city ILIKE '%' || trim(p_audience->>'city') || '%')
      AND (v_kind <> 'custom' OR NULLIF(trim(p_audience->>'verification_status'), '') IS NULL
        OR pharmacy.verification_status = p_audience->>'verification_status')
      AND (v_kind <> 'custom' OR NULLIF(trim(p_audience->>'feature_key'), '') IS NULL
        OR EXISTS (
          SELECT 1 FROM public.pharmacy_features feature
          WHERE feature.pharmacy_id = pharmacy.id
            AND feature.feature_key = p_audience->>'feature_key'
            AND feature.is_enabled = COALESCE(NULLIF(p_audience->>'feature_enabled', '')::BOOLEAN, TRUE)
        ))
      AND (v_kind <> 'custom' OR NULLIF(p_audience->>'last_active_after', '') IS NULL
        OR account.last_sign_in_at >= (p_audience->>'last_active_after')::TIMESTAMPTZ)
    ORDER BY pharmacy.pharmacy_name, account.id;
    RETURN;
  END IF;

  IF v_kind IN ('all_users', 'all_patients', 'individual_user') THEN
    RETURN QUERY
    SELECT account.id, pharmacy.id, lower(account.email::TEXT),
      COALESCE(
        CASE WHEN profile.role = 'pharmacy' THEN NULLIF(trim(pharmacy.pharmacy_name), '') END,
        NULLIF(trim(profile.full_name), ''),
        split_part(account.email::TEXT, '@', 1)
      )::TEXT
    FROM auth.users account
    JOIN public.users profile ON profile.user_id = account.id
    LEFT JOIN LATERAL (
      SELECT candidate.id, candidate.pharmacy_name
      FROM public.pharmacies candidate
      WHERE candidate.user_id = account.id
      ORDER BY candidate.is_active DESC, candidate.created_at DESC
      LIMIT 1
    ) pharmacy ON TRUE
    WHERE profile.role IN ('patient', 'pharmacy')
      AND (v_kind = 'individual_user' OR profile.is_admin = FALSE)
      AND EXISTS (SELECT 1 FROM public.push_subscriptions subscription WHERE subscription.user_id = account.id)
      AND EXISTS (
        SELECT 1 FROM public.notification_preferences preference
        WHERE preference.user_id = account.id AND preference.patient_push_consent = TRUE
      )
      AND (v_kind <> 'all_patients' OR profile.role = 'patient')
      AND (v_kind <> 'individual_user' OR account.id = (p_audience->>'user_id')::UUID)
    ORDER BY 4 NULLS LAST, account.id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Unsupported push audience';
END;
$$;

-- Individual user search is account-wide, while the pharmacy directory keeps
-- its pharmacy-specific display and filtering.
CREATE OR REPLACE FUNCTION public.search_broadcast_directory(
  p_actor_id UUID,
  p_kind TEXT,
  p_query TEXT
)
RETURNS TABLE (
  user_id UUID,
  pharmacy_id UUID,
  email TEXT,
  display_name TEXT,
  detail TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_query TEXT := trim(COALESCE(p_query, ''));
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.broadcast_admin_is_authorized(p_actor_id) THEN
    RAISE EXCEPTION 'Authorized administrator required' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_query) < 2 THEN RETURN; END IF;

  IF p_kind = 'pharmacy' THEN
    RETURN QUERY
    SELECT account.id, pharmacy.id, lower(account.email::TEXT),
      pharmacy.pharmacy_name::TEXT,
      concat_ws(', ', pharmacy.city, pharmacy.state)::TEXT
    FROM public.pharmacies pharmacy
    JOIN auth.users account ON account.id = pharmacy.user_id
    WHERE account.email IS NOT NULL
      AND (pharmacy.pharmacy_name ILIKE '%' || v_query || '%'
        OR account.email ILIKE '%' || v_query || '%')
    ORDER BY pharmacy.pharmacy_name
    LIMIT 20;
  ELSIF p_kind = 'user' THEN
    RETURN QUERY
    SELECT account.id, pharmacy.id, lower(account.email::TEXT),
      COALESCE(
        CASE WHEN profile.role = 'pharmacy' THEN NULLIF(trim(pharmacy.pharmacy_name), '') END,
        NULLIF(trim(profile.full_name), ''), split_part(account.email::TEXT, '@', 1)
      )::TEXT,
      concat(profile.role, ' · ', account.email)::TEXT
    FROM auth.users account
    JOIN public.users profile ON profile.user_id = account.id
    LEFT JOIN LATERAL (
      SELECT candidate.id, candidate.pharmacy_name
      FROM public.pharmacies candidate
      WHERE candidate.user_id = account.id
      ORDER BY candidate.is_active DESC, candidate.created_at DESC
      LIMIT 1
    ) pharmacy ON TRUE
    WHERE profile.role IN ('patient', 'pharmacy')
      AND account.email IS NOT NULL
      AND (account.email ILIKE '%' || v_query || '%'
        OR profile.full_name ILIKE '%' || v_query || '%'
        OR pharmacy.pharmacy_name ILIKE '%' || v_query || '%')
    ORDER BY 4 NULLS LAST, account.email
    LIMIT 20;
  ELSE
    RAISE EXCEPTION 'Unsupported directory kind';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_broadcast_audience(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_push_audience(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_broadcast_directory(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_broadcast_audience(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_push_audience(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_broadcast_directory(UUID, TEXT, TEXT) TO service_role;

COMMENT ON TABLE public.welcome_email_jobs IS
  'Failure-isolated, one-row-per-account jobs consumed by the welcome email cron.';
COMMENT ON TABLE public.push_subscriptions IS
  'Authenticated PWA Web Push subscriptions; all writes go through owner-scoped RPCs.';

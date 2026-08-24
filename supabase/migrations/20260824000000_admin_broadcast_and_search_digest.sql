-- Admin email broadcasts and daily pharmacy search-demand digests.
-- All mutations are service-role-only; authenticated users only receive the
-- narrowly scoped reads granted by RLS.

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'free';

ALTER TABLE public.pharmacies
  DROP CONSTRAINT IF EXISTS pharmacies_subscription_tier_check;
ALTER TABLE public.pharmacies
  ADD CONSTRAINT pharmacies_subscription_tier_check
  CHECK (subscription_tier IN ('free', 'premium'));

ALTER TABLE public.pharmacy_notification_preferences
  ADD COLUMN IF NOT EXISTS search_digest_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('broadcast', 'search_digest')),
  unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS public.broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL CHECK (char_length(trim(subject)) BETWEEN 1 AND 200),
  body_markdown TEXT NOT NULL CHECK (char_length(trim(body_markdown)) BETWEEN 1 AND 20000),
  template TEXT NOT NULL CHECK (
    template IN ('announcement', 'product_update', 'medication_alert', 'custom')
  ),
  audience JSONB NOT NULL CHECK (jsonb_typeof(audience) = 'object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'scheduled', 'queued', 'sending', 'completed', 'failed')
  ),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  delivered_count INTEGER NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL CHECK (recipient_email = lower(trim(recipient_email))),
  display_name TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'queued' CHECK (
    delivery_status IN (
      'queued', 'sending', 'sent', 'delivered', 'bounced',
      'complained', 'failed', 'skipped'
    )
  ),
  notification_delivery_id UUID REFERENCES public.notification_deliveries(id) ON DELETE SET NULL,
  provider_message_id TEXT,
  provider_status TEXT,
  last_error TEXT,
  unsubscribed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (broadcast_id, user_id)
);

CREATE INDEX IF NOT EXISTS broadcasts_history_idx
  ON public.broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS broadcast_recipients_broadcast_status_idx
  ON public.broadcast_recipients(broadcast_id, delivery_status);
CREATE INDEX IF NOT EXISTS broadcast_recipients_delivery_idx
  ON public.broadcast_recipients(notification_delivery_id)
  WHERE notification_delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS broadcast_recipients_provider_idx
  ON public.broadcast_recipients(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_suppressions_owner_select ON public.email_suppressions;
CREATE POLICY email_suppressions_owner_select ON public.email_suppressions
FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS broadcasts_admin_select ON public.broadcasts;
CREATE POLICY broadcasts_admin_select ON public.broadcasts
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.users viewer
  WHERE viewer.user_id = auth.uid()
    AND viewer.is_admin = TRUE
    AND viewer.admin_authorized_at IS NOT NULL
    AND NULLIF(trim(viewer.admin_authorization_basis), '') IS NOT NULL
));

DROP POLICY IF EXISTS broadcast_recipients_admin_select ON public.broadcast_recipients;
CREATE POLICY broadcast_recipients_admin_select ON public.broadcast_recipients
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.users viewer
  WHERE viewer.user_id = auth.uid()
    AND viewer.is_admin = TRUE
    AND viewer.admin_authorized_at IS NOT NULL
    AND NULLIF(trim(viewer.admin_authorization_basis), '') IS NOT NULL
));

GRANT SELECT ON public.email_suppressions, public.broadcasts, public.broadcast_recipients
  TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.email_suppressions, public.broadcasts,
  public.broadcast_recipients FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.broadcast_admin_is_authorized(p_actor_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users viewer
    WHERE viewer.user_id = p_actor_id
      AND viewer.is_admin = TRUE
      AND viewer.admin_authorized_at IS NOT NULL
      AND NULLIF(trim(viewer.admin_authorization_basis), '') IS NOT NULL
  )
$$;

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
    SELECT
      account.id,
      pharmacy.id,
      lower(account.email::TEXT),
      pharmacy.pharmacy_name::TEXT
    FROM public.pharmacies pharmacy
    JOIN auth.users account ON account.id = pharmacy.user_id
    WHERE pharmacy.is_active = TRUE
      AND NULLIF(trim(account.email::TEXT), '') IS NOT NULL
      AND (v_kind <> 'premium_pharmacies' OR pharmacy.subscription_tier = 'premium')
      AND (v_kind <> 'free_pharmacies' OR pharmacy.subscription_tier = 'free')
      AND (
        v_kind <> 'individual_pharmacy'
        OR pharmacy.id = (p_audience->>'pharmacy_id')::UUID
      )
      AND (
        v_kind <> 'custom'
        OR NULLIF(trim(p_audience->>'city'), '') IS NULL
        OR pharmacy.city ILIKE '%' || trim(p_audience->>'city') || '%'
      )
      AND (
        v_kind <> 'custom'
        OR NULLIF(trim(p_audience->>'verification_status'), '') IS NULL
        OR pharmacy.verification_status = p_audience->>'verification_status'
      )
      AND (
        v_kind <> 'custom'
        OR NULLIF(trim(p_audience->>'feature_key'), '') IS NULL
        OR EXISTS (
          SELECT 1 FROM public.pharmacy_features feature
          WHERE feature.pharmacy_id = pharmacy.id
            AND feature.feature_key = p_audience->>'feature_key'
            AND feature.is_enabled = COALESCE(
              NULLIF(p_audience->>'feature_enabled', '')::BOOLEAN,
              TRUE
            )
        )
      )
      AND (
        v_kind <> 'custom'
        OR NULLIF(p_audience->>'last_active_after', '') IS NULL
        OR account.last_sign_in_at >= (p_audience->>'last_active_after')::TIMESTAMPTZ
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.email_suppressions suppression
        WHERE suppression.user_id = account.id
          AND suppression.category = 'broadcast'
      )
    ORDER BY pharmacy.pharmacy_name, account.id;
    RETURN;
  END IF;

  IF v_kind IN ('all_patients', 'individual_user') THEN
    RETURN QUERY
    SELECT
      account.id,
      NULL::UUID,
      lower(account.email::TEXT),
      COALESCE(NULLIF(trim(profile.full_name), ''), split_part(account.email::TEXT, '@', 1))
    FROM auth.users account
    JOIN public.users profile ON profile.user_id = account.id
    WHERE COALESCE(profile.role, 'patient') = 'patient'
      AND profile.is_admin = FALSE
      AND NULLIF(trim(account.email::TEXT), '') IS NOT NULL
      AND (
        v_kind <> 'individual_user'
        OR account.id = (p_audience->>'user_id')::UUID
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.email_suppressions suppression
        WHERE suppression.user_id = account.id
          AND suppression.category = 'broadcast'
      )
    ORDER BY profile.full_name NULLS LAST, account.id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Unsupported broadcast audience';
END;
$$;

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
      AND (
        pharmacy.pharmacy_name ILIKE '%' || v_query || '%'
        OR account.email ILIKE '%' || v_query || '%'
      )
    ORDER BY pharmacy.pharmacy_name
    LIMIT 20;
  ELSIF p_kind = 'user' THEN
    RETURN QUERY
    SELECT account.id, NULL::UUID, lower(account.email::TEXT),
      COALESCE(NULLIF(trim(profile.full_name), ''), split_part(account.email::TEXT, '@', 1)),
      account.email::TEXT
    FROM auth.users account
    JOIN public.users profile ON profile.user_id = account.id
    WHERE COALESCE(profile.role, 'patient') = 'patient'
      AND profile.is_admin = FALSE
      AND account.email IS NOT NULL
      AND (
        account.email ILIKE '%' || v_query || '%'
        OR profile.full_name ILIKE '%' || v_query || '%'
      )
    ORDER BY profile.full_name NULLS LAST, account.email
    LIMIT 20;
  ELSE
    RAISE EXCEPTION 'Unsupported directory kind';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_broadcast_stats(p_broadcast_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INTEGER;
  v_queued INTEGER;
  v_sending INTEGER;
  v_sent INTEGER;
  v_delivered INTEGER;
  v_failed INTEGER;
BEGIN
  SELECT
    count(*)::INTEGER,
    count(*) FILTER (WHERE delivery_status = 'queued')::INTEGER,
    count(*) FILTER (WHERE delivery_status = 'sending')::INTEGER,
    count(*) FILTER (WHERE delivery_status IN ('sent', 'delivered'))::INTEGER,
    count(*) FILTER (WHERE delivery_status = 'delivered')::INTEGER,
    count(*) FILTER (WHERE delivery_status IN ('bounced', 'complained', 'failed', 'skipped'))::INTEGER
  INTO v_total, v_queued, v_sending, v_sent, v_delivered, v_failed
  FROM public.broadcast_recipients
  WHERE broadcast_id = p_broadcast_id;

  UPDATE public.broadcasts broadcast SET
    recipient_count = v_total,
    sent_count = v_sent,
    delivered_count = v_delivered,
    failed_count = v_failed,
    status = CASE
      WHEN v_total = 0 THEN broadcast.status
      WHEN v_queued > 0 AND broadcast.scheduled_at > NOW() THEN 'scheduled'
      WHEN v_sending > 0 THEN 'sending'
      WHEN v_queued > 0 THEN 'queued'
      ELSE 'completed'
    END,
    started_at = CASE
      WHEN v_sending > 0 OR v_sent > 0 OR v_failed > 0
        THEN COALESCE(broadcast.started_at, NOW())
      ELSE broadcast.started_at
    END,
    completed_at = CASE
      WHEN v_total > 0 AND v_queued = 0 AND v_sending = 0 THEN COALESCE(broadcast.completed_at, NOW())
      ELSE NULL
    END,
    updated_at = NOW()
  WHERE broadcast.id = p_broadcast_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_admin_broadcast_recipients(
  p_actor_id UUID,
  p_broadcast_id UUID,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row JSONB;
  v_delivery public.notification_deliveries%ROWTYPE;
  v_queued INTEGER := 0;
  v_suppressed INTEGER := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.broadcast_admin_is_authorized(p_actor_id) THEN
    RAISE EXCEPTION 'Authorized administrator required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.broadcasts
    WHERE id = p_broadcast_id AND created_by = p_actor_id
      AND status IN ('draft', 'scheduled', 'queued')
  ) THEN
    RAISE EXCEPTION 'Broadcast is not queueable';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 100 THEN
    RAISE EXCEPTION 'A queue batch must contain at most 100 recipients';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.email_suppressions suppression
      WHERE suppression.user_id = (v_row->>'user_id')::UUID
        AND suppression.category = 'broadcast'
    ) THEN
      v_suppressed := v_suppressed + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.notification_deliveries (
      notification_id, channel, notification_type, provider,
      pharmacy_id, user_id, recipient, recipient_hash,
      idempotency_key, status, payload, send_after
    ) VALUES (
      NULL, 'email', 'broadcast', 'resend',
      NULLIF(v_row->>'pharmacy_id', '')::UUID,
      (v_row->>'user_id')::UUID,
      lower(trim(v_row->>'email')),
      v_row->>'recipient_hash',
      v_row->>'idempotency_key',
      'queued',
      COALESCE(v_row->'payload', '{}'::JSONB),
      COALESCE(NULLIF(v_row->>'send_after', '')::TIMESTAMPTZ, NOW())
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
    RETURNING * INTO v_delivery;

    INSERT INTO public.broadcast_recipients (
      broadcast_id, user_id, pharmacy_id, recipient_email, display_name,
      delivery_status, notification_delivery_id, provider_message_id,
      provider_status, sent_at, delivered_at, updated_at
    ) VALUES (
      p_broadcast_id,
      (v_row->>'user_id')::UUID,
      NULLIF(v_row->>'pharmacy_id', '')::UUID,
      lower(trim(v_row->>'email')),
      NULLIF(trim(v_row->>'display_name'), ''),
      CASE
        WHEN v_delivery.status = 'delivered' THEN 'delivered'
        WHEN v_delivery.status = 'sent' THEN 'sent'
        WHEN v_delivery.status IN ('failed', 'skipped') THEN v_delivery.status
        ELSE 'queued'
      END,
      v_delivery.id,
      v_delivery.provider_message_id,
      v_delivery.provider_status,
      v_delivery.sent_at,
      v_delivery.delivered_at,
      NOW()
    )
    ON CONFLICT (broadcast_id, user_id) DO UPDATE SET
      notification_delivery_id = EXCLUDED.notification_delivery_id,
      delivery_status = EXCLUDED.delivery_status,
      provider_message_id = EXCLUDED.provider_message_id,
      provider_status = EXCLUDED.provider_status,
      updated_at = NOW();
    v_queued := v_queued + 1;
  END LOOP;

  PERFORM public.refresh_broadcast_stats(p_broadcast_id);
  RETURN jsonb_build_object('queued', v_queued, 'suppressed', v_suppressed);
END;
$$;

CREATE OR REPLACE FUNCTION public.suppress_email_category(
  p_user_id UUID,
  p_category TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_broadcast_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_category NOT IN ('broadcast', 'search_digest') THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.email_suppressions(user_id, category, unsubscribed_at, updated_at)
  VALUES (p_user_id, p_category, NOW(), NOW())
  ON CONFLICT (user_id, category) DO UPDATE SET
    unsubscribed_at = COALESCE(public.email_suppressions.unsubscribed_at, NOW()),
    updated_at = NOW();

  IF p_category = 'search_digest' THEN
    UPDATE public.pharmacy_notification_preferences preference
    SET search_digest_email_opt_in = FALSE, updated_at = NOW()
    FROM public.pharmacies pharmacy
    WHERE pharmacy.id = preference.pharmacy_id
      AND pharmacy.user_id = p_user_id;
  ELSE
    FOR v_broadcast_id IN
      SELECT DISTINCT recipient.broadcast_id
      FROM public.broadcast_recipients recipient
      WHERE recipient.user_id = p_user_id
        AND recipient.delivery_status IN ('queued', 'sending')
    LOOP
      UPDATE public.notification_deliveries delivery SET
        status = 'skipped', recipient = NULL, payload = '{}'::JSONB,
        last_error = 'Recipient unsubscribed before dispatch', updated_at = NOW()
      FROM public.broadcast_recipients recipient
      WHERE recipient.broadcast_id = v_broadcast_id
        AND recipient.user_id = p_user_id
        AND recipient.notification_delivery_id = delivery.id
        AND delivery.status IN ('queued', 'retry');

      UPDATE public.broadcast_recipients SET
        delivery_status = 'skipped', unsubscribed_at = NOW(),
        last_error = 'Recipient unsubscribed before dispatch', updated_at = NOW()
      WHERE broadcast_id = v_broadcast_id AND user_id = p_user_id
        AND delivery_status IN ('queued', 'sending');
      PERFORM public.refresh_broadcast_stats(v_broadcast_id);
    END LOOP;
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_search_digest_candidates(
  p_since TIMESTAMPTZ,
  p_until TIMESTAMPTZ
)
RETURNS TABLE (
  pharmacy_id UUID,
  user_id UUID,
  email TEXT,
  pharmacy_name TEXT,
  items JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_since >= p_until
     OR p_until - p_since > INTERVAL '25 hours' THEN
    RAISE EXCEPTION 'Digest window must be positive and no longer than 25 hours';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT pharmacy.id, pharmacy.user_id, pharmacy.pharmacy_name,
      pharmacy.city, pharmacy.state, lower(preference.owner_email) AS owner_email
    FROM public.pharmacies pharmacy
    JOIN public.pharmacy_notification_preferences preference
      ON preference.pharmacy_id = pharmacy.id
     AND preference.search_digest_email_opt_in = TRUE
     AND NULLIF(trim(preference.owner_email), '') IS NOT NULL
    JOIN public.pharmacy_features feature
      ON feature.pharmacy_id = pharmacy.id
     AND feature.feature_key = 'notifications'
     AND feature.is_enabled = TRUE
    WHERE pharmacy.is_active = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.email_suppressions suppression
        WHERE suppression.user_id = pharmacy.user_id
          AND suppression.category = 'search_digest'
      )
  ), demand AS (
    SELECT eligible.id AS pharmacy_id, eligible.user_id,
      eligible.owner_email, eligible.pharmacy_name,
      product.id AS product_id,
      COALESCE(NULLIF(product.brand_name, ''), product.generic_name) AS medication,
      count(DISTINCT search.id)::INTEGER AS search_count,
      bool_or(
        inventory.id IS NOT NULL
        AND inventory.quantity_in_stock > 0
        AND inventory.is_listed = TRUE
        AND inventory.deleted_at IS NULL
      ) AS in_stock
    FROM eligible
    JOIN public.searches search
      ON search.timestamp >= p_since
     AND search.timestamp < p_until
     AND search.product_id IS NOT NULL
     AND search.location IS NOT NULL
     AND (
       search.location ILIKE '%' || eligible.city || '%'
       OR search.location ILIKE '%' || eligible.state || '%'
     )
    JOIN public.products product ON product.id = search.product_id
    LEFT JOIN public.pharmacy_inventory inventory
      ON inventory.pharmacy_id = eligible.id
     AND inventory.product_id = product.id
     AND inventory.item_type = 'medicine'
    GROUP BY eligible.id, eligible.user_id, eligible.owner_email,
      eligible.pharmacy_name, product.id, product.brand_name, product.generic_name
  ), ranked AS (
    SELECT demand.*,
      row_number() OVER (PARTITION BY demand.pharmacy_id ORDER BY demand.search_count DESC, demand.medication) AS rank
    FROM demand
  )
  SELECT ranked.pharmacy_id, ranked.user_id, ranked.owner_email,
    ranked.pharmacy_name::TEXT,
    jsonb_agg(jsonb_build_object(
      'product_id', ranked.product_id,
      'medication', ranked.medication,
      'search_count', ranked.search_count,
      'in_stock', ranked.in_stock,
      'suggested_action', CASE WHEN ranked.in_stock
        THEN 'Check that your listing and stock count are current'
        ELSE 'Consider adding this medication to your catalogue'
      END
    ) ORDER BY ranked.search_count DESC, ranked.medication)
  FROM ranked
  WHERE ranked.rank <= 20
  GROUP BY ranked.pharmacy_id, ranked.user_id, ranked.owner_email, ranked.pharmacy_name;
END;
$$;

-- Extend the owner-managed preference RPC with the dedicated search digest opt-in.
CREATE OR REPLACE FUNCTION public.set_authenticated_pharmacy_notification_preferences(
  p_preferences JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pharmacy_id UUID;
  v_row public.pharmacy_notification_preferences%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT pharmacy.id INTO v_pharmacy_id
  FROM public.pharmacies pharmacy
  WHERE pharmacy.user_id = auth.uid()
  ORDER BY pharmacy.is_active DESC, pharmacy.created_at DESC
  LIMIT 1;
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = v_pharmacy_id
      AND feature.feature_key = 'notifications' AND feature.is_enabled
  ) THEN
    RAISE EXCEPTION 'The notifications feature is disabled' USING ERRCODE = '42501';
  END IF;
  IF p_preferences IS NULL OR jsonb_typeof(p_preferences) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_preferences) key
    WHERE key NOT IN (
      'owner_phone', 'owner_email', 'reservation_sms_opt_in',
      'stock_digest_sms_opt_in', 'daily_sms_cap',
      'low_stock_email_opt_in', 'low_stock_sms_opt_in',
      'expiry_email_opt_in', 'expiry_sms_opt_in',
      'daily_summary_email_opt_in', 'daily_summary_sms_opt_in',
      'search_digest_email_opt_in', 'daily_email_cap'
    )
  ) THEN
    RAISE EXCEPTION 'Invalid pharmacy notification preferences';
  END IF;

  INSERT INTO public.pharmacy_notification_preferences (
    pharmacy_id, owner_phone, owner_email, reservation_sms_opt_in,
    stock_digest_sms_opt_in, daily_sms_cap,
    low_stock_email_opt_in, low_stock_sms_opt_in,
    expiry_email_opt_in, expiry_sms_opt_in,
    daily_summary_email_opt_in, daily_summary_sms_opt_in,
    search_digest_email_opt_in, daily_email_cap, updated_at
  ) VALUES (
    v_pharmacy_id,
    NULLIF(trim(p_preferences->>'owner_phone'), ''),
    lower(NULLIF(trim(p_preferences->>'owner_email'), '')),
    COALESCE((p_preferences->>'reservation_sms_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'stock_digest_sms_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'daily_sms_cap')::INTEGER, 10),
    COALESCE((p_preferences->>'low_stock_email_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'low_stock_sms_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'expiry_email_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'expiry_sms_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'daily_summary_email_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'daily_summary_sms_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'search_digest_email_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'daily_email_cap')::INTEGER, 20),
    NOW()
  )
  ON CONFLICT (pharmacy_id) DO UPDATE SET
    owner_phone = EXCLUDED.owner_phone,
    owner_email = EXCLUDED.owner_email,
    reservation_sms_opt_in = EXCLUDED.reservation_sms_opt_in,
    stock_digest_sms_opt_in = EXCLUDED.stock_digest_sms_opt_in,
    daily_sms_cap = EXCLUDED.daily_sms_cap,
    low_stock_email_opt_in = EXCLUDED.low_stock_email_opt_in,
    low_stock_sms_opt_in = EXCLUDED.low_stock_sms_opt_in,
    expiry_email_opt_in = EXCLUDED.expiry_email_opt_in,
    expiry_sms_opt_in = EXCLUDED.expiry_sms_opt_in,
    daily_summary_email_opt_in = EXCLUDED.daily_summary_email_opt_in,
    daily_summary_sms_opt_in = EXCLUDED.daily_summary_sms_opt_in,
    search_digest_email_opt_in = EXCLUDED.search_digest_email_opt_in,
    daily_email_cap = EXCLUDED.daily_email_cap,
    updated_at = NOW()
  RETURNING * INTO v_row;

  -- Saving the preference as enabled is an explicit re-subscribe action by
  -- the authenticated pharmacy owner.
  IF v_row.search_digest_email_opt_in THEN
    DELETE FROM public.email_suppressions
    WHERE user_id = auth.uid() AND category = 'search_digest';
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- Keep broadcast history synchronized with the durable outbox.
CREATE OR REPLACE FUNCTION public.claim_notification_delivery(p_delivery_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_delivery public.notification_deliveries%ROWTYPE;
  v_broadcast_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notification_deliveries
  SET status = 'sending', attempts = attempts + 1, updated_at = NOW()
  WHERE id = p_delivery_id AND status IN ('queued', 'retry')
  RETURNING * INTO v_delivery;

  IF v_delivery.id IS NOT NULL THEN
    UPDATE public.broadcast_recipients SET delivery_status = 'sending', updated_at = NOW()
    WHERE notification_delivery_id = v_delivery.id
    RETURNING broadcast_id INTO v_broadcast_id;
    IF v_broadcast_id IS NOT NULL THEN PERFORM public.refresh_broadcast_stats(v_broadcast_id); END IF;
  END IF;
  RETURN CASE WHEN v_delivery.id IS NULL THEN NULL ELSE to_jsonb(v_delivery) END;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_notification_delivery(
  p_delivery_id UUID,
  p_result JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_status TEXT := p_result->>'status';
  v_terminal BOOLEAN;
  v_broadcast_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('sent', 'delivered', 'retry', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'Unsupported delivery result';
  END IF;
  v_terminal := v_status IN ('sent', 'delivered', 'failed', 'skipped');

  UPDATE public.notification_deliveries SET
    status = v_status,
    provider_message_id = NULLIF(p_result->>'provider_message_id', ''),
    provider_status = NULLIF(p_result->>'provider_status', ''),
    cost = CASE WHEN p_result ? 'cost' AND p_result->>'cost' IS NOT NULL
      THEN (p_result->>'cost')::NUMERIC ELSE NULL END,
    last_error = left(NULLIF(p_result->>'error', ''), 500),
    send_after = COALESCE(NULLIF(p_result->>'retry_at', '')::TIMESTAMPTZ, NOW()),
    sent_at = CASE WHEN v_status IN ('sent', 'delivered') THEN NOW() ELSE NULL END,
    delivered_at = CASE WHEN v_status = 'delivered' THEN NOW() ELSE NULL END,
    recipient = CASE WHEN v_terminal THEN NULL ELSE recipient END,
    payload = CASE WHEN v_terminal THEN '{}'::JSONB ELSE payload END,
    updated_at = NOW()
  WHERE id = p_delivery_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE public.broadcast_recipients SET
    delivery_status = CASE WHEN v_status = 'retry' THEN 'queued' ELSE v_status END,
    provider_message_id = NULLIF(p_result->>'provider_message_id', ''),
    provider_status = NULLIF(p_result->>'provider_status', ''),
    last_error = left(NULLIF(p_result->>'error', ''), 500),
    sent_at = CASE WHEN v_status IN ('sent', 'delivered') THEN NOW() ELSE sent_at END,
    delivered_at = CASE WHEN v_status = 'delivered' THEN NOW() ELSE delivered_at END,
    updated_at = NOW()
  WHERE notification_delivery_id = p_delivery_id
  RETURNING broadcast_id INTO v_broadcast_id;
  IF v_broadcast_id IS NOT NULL THEN PERFORM public.refresh_broadcast_stats(v_broadcast_id); END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_notification_provider_event(
  p_provider TEXT,
  p_provider_message_id TEXT,
  p_status TEXT,
  p_provider_status TEXT DEFAULT NULL,
  p_cost NUMERIC DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_delivery_id UUID;
  v_broadcast_id UUID;
  v_recipient_status TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('resend', 'termii') OR p_status NOT IN ('sent', 'delivered', 'failed') THEN
    RAISE EXCEPTION 'Unsupported provider event';
  END IF;

  UPDATE public.notification_deliveries delivery SET
    status = CASE
      WHEN delivery.status = 'delivered' AND p_status = 'sent' THEN 'delivered'
      ELSE p_status
    END,
    provider_status = NULLIF(p_provider_status, ''), cost = p_cost,
    delivered_at = CASE WHEN p_status = 'delivered' THEN NOW() ELSE delivery.delivered_at END,
    recipient = NULL, payload = '{}'::JSONB, updated_at = NOW()
  WHERE delivery.provider = p_provider
    AND delivery.provider_message_id = p_provider_message_id
  RETURNING delivery.id INTO v_delivery_id;
  IF v_delivery_id IS NULL THEN RETURN FALSE; END IF;

  v_recipient_status := CASE p_provider_status
    WHEN 'email.bounced' THEN 'bounced'
    WHEN 'email.complained' THEN 'complained'
    WHEN 'email.failed' THEN 'failed'
    WHEN 'email.suppressed' THEN 'failed'
    WHEN 'email.delivered' THEN 'delivered'
    ELSE p_status
  END;
  UPDATE public.broadcast_recipients recipient SET
    delivery_status = CASE
      WHEN recipient.delivery_status = 'delivered' AND v_recipient_status = 'sent'
        THEN 'delivered'
      ELSE v_recipient_status
    END,
    provider_status = NULLIF(p_provider_status, ''),
    provider_message_id = p_provider_message_id,
    delivered_at = CASE WHEN v_recipient_status = 'delivered' THEN NOW() ELSE recipient.delivered_at END,
    updated_at = NOW()
  WHERE recipient.notification_delivery_id = v_delivery_id
  RETURNING recipient.broadcast_id INTO v_broadcast_id;
  IF v_broadcast_id IS NOT NULL THEN PERFORM public.refresh_broadcast_stats(v_broadcast_id); END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_admin_is_authorized(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_broadcast_audience(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_broadcast_directory(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_broadcast_stats(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_admin_broadcast_recipients(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suppress_email_category(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_search_digest_candidates(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_authenticated_pharmacy_notification_preferences(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_notification_delivery(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_notification_delivery(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_notification_provider_event(TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_broadcast_audience(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_broadcast_directory(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_admin_broadcast_recipients(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.suppress_email_category(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_search_digest_candidates(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_authenticated_pharmacy_notification_preferences(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_delivery(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_notification_delivery(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_notification_provider_event(TEXT, TEXT, TEXT, TEXT, NUMERIC) TO service_role;

COMMENT ON TABLE public.email_suppressions IS
  'Category-scoped email opt-outs. Broadcast and search-demand email preferences remain independent.';
COMMENT ON TABLE public.broadcast_recipients IS
  'Per-recipient broadcast audit linked to the durable notification delivery outbox.';

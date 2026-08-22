-- Notifications: production write boundaries, idempotent events, and complete
-- owner preference controls. Provider credentials remain optional at runtime.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_event_key_unique_idx
  ON public.notifications(event_key)
  WHERE event_key IS NOT NULL;

ALTER TABLE public.pharmacy_notification_preferences
  ADD COLUMN IF NOT EXISTS owner_email TEXT,
  ADD COLUMN IF NOT EXISTS low_stock_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS low_stock_sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS expiry_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS expiry_sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_summary_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_summary_sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_email_cap INTEGER NOT NULL DEFAULT 20;

ALTER TABLE public.pharmacy_notification_preferences
  DROP CONSTRAINT IF EXISTS pharmacy_notification_preferences_daily_email_cap_check;
ALTER TABLE public.pharmacy_notification_preferences
  ADD CONSTRAINT pharmacy_notification_preferences_daily_email_cap_check
  CHECK (daily_email_cap BETWEEN 1 AND 100);

CREATE OR REPLACE FUNCTION public.set_authenticated_notification_preferences(
  p_preferences JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.notification_preferences%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_preferences IS NULL OR jsonb_typeof(p_preferences) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_preferences) key
    WHERE key NOT IN (
      'product_email_opt_in', 'refill_email_opt_in', 'reminder_sms_opt_in',
      'patient_email_consent', 'patient_sms_consent', 'patient_push_consent'
    )
  ) THEN
    RAISE EXCEPTION 'Invalid notification preferences';
  END IF;

  INSERT INTO public.notification_preferences (
    user_id,
    product_email_opt_in,
    refill_email_opt_in,
    reminder_sms_opt_in,
    patient_email_consent,
    patient_sms_consent,
    patient_push_consent,
    unsubscribed_at,
    updated_at
  ) VALUES (
    auth.uid(),
    COALESCE((p_preferences->>'product_email_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'refill_email_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'reminder_sms_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'patient_email_consent')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'patient_sms_consent')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'patient_push_consent')::BOOLEAN, FALSE),
    CASE WHEN COALESCE((p_preferences->>'product_email_opt_in')::BOOLEAN, FALSE)
      THEN NULL ELSE NOW() END,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    product_email_opt_in = EXCLUDED.product_email_opt_in,
    refill_email_opt_in = EXCLUDED.refill_email_opt_in,
    reminder_sms_opt_in = EXCLUDED.reminder_sms_opt_in,
    patient_email_consent = EXCLUDED.patient_email_consent,
    patient_sms_consent = EXCLUDED.patient_sms_consent,
    patient_push_consent = EXCLUDED.patient_push_consent,
    unsubscribed_at = EXCLUDED.unsubscribed_at,
    updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row) - 'type_channels' - 'pharmacy_id';
END;
$$;

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
      AND feature.feature_key = 'notifications'
      AND feature.is_enabled
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
      'daily_email_cap'
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
    daily_email_cap, updated_at
  ) VALUES (
    v_pharmacy_id,
    NULLIF(TRIM(p_preferences->>'owner_phone'), ''),
    LOWER(NULLIF(TRIM(p_preferences->>'owner_email'), '')),
    COALESCE((p_preferences->>'reservation_sms_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'stock_digest_sms_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'daily_sms_cap')::INTEGER, 10),
    COALESCE((p_preferences->>'low_stock_email_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'low_stock_sms_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'expiry_email_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'expiry_sms_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'daily_summary_email_opt_in')::BOOLEAN, FALSE),
    COALESCE((p_preferences->>'daily_summary_sms_opt_in')::BOOLEAN, FALSE),
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
    daily_email_cap = EXCLUDED.daily_email_cap,
    updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_notification_once(
  p_event_key TEXT,
  p_recipient_type TEXT,
  p_recipient_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_pharmacy_id UUID DEFAULT NULL,
  p_data JSONB DEFAULT '{}'::JSONB,
  p_deliveries JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_notification_id UUID;
  v_delivery JSONB;
  v_duplicate BOOLEAN := FALSE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(TRIM(p_event_key), '') IS NULL THEN RAISE EXCEPTION 'Event key is required'; END IF;
  IF p_recipient_type NOT IN ('patient', 'pharmacist') THEN RAISE EXCEPTION 'Unsupported recipient type'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_recipient_id) THEN RAISE EXCEPTION 'Recipient not found'; END IF;
  IF p_recipient_type = 'pharmacist' AND NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = p_recipient_id
  ) THEN RAISE EXCEPTION 'Pharmacist recipient does not own the pharmacy'; END IF;
  IF jsonb_typeof(COALESCE(p_data, '{}'::JSONB)) <> 'object' THEN RAISE EXCEPTION 'Notification data must be an object'; END IF;
  IF jsonb_typeof(COALESCE(p_deliveries, '[]'::JSONB)) <> 'array' THEN RAISE EXCEPTION 'Deliveries must be an array'; END IF;

  INSERT INTO public.notifications (
    event_key, recipient_type, recipient_id, pharmacy_id, type, title, body, data
  ) VALUES (
    TRIM(p_event_key), p_recipient_type, p_recipient_id, p_pharmacy_id,
    p_type, TRIM(p_title), TRIM(p_body), COALESCE(p_data, '{}'::JSONB)
  )
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO v_notification_id;

  IF v_notification_id IS NULL THEN
    SELECT id INTO v_notification_id FROM public.notifications WHERE event_key = TRIM(p_event_key);
    v_duplicate := TRUE;
  ELSE
    FOR v_delivery IN SELECT value FROM jsonb_array_elements(COALESCE(p_deliveries, '[]'::JSONB))
    LOOP
      PERFORM public.enqueue_notification_delivery(
        v_notification_id,
        v_delivery->>'channel',
        v_delivery->>'provider',
        v_delivery->>'idempotency_key',
        jsonb_build_object(
          'notification_type', p_type,
          'pharmacy_id', p_pharmacy_id,
          'user_id', p_recipient_id,
          'recipient', v_delivery->>'recipient',
          'recipient_hash', v_delivery->>'recipient_hash',
          'status', 'queued',
          'payload', COALESCE(v_delivery->'payload', '{}'::JSONB)
        )
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'notification_id', v_notification_id,
    'duplicate', v_duplicate
  );
END;
$$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.notification_preferences, public.pharmacy_notification_preferences
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_preferences, public.pharmacy_notification_preferences
  TO authenticated;

REVOKE ALL ON FUNCTION public.set_authenticated_notification_preferences(JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_authenticated_pharmacy_notification_preferences(JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_notification_once(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_authenticated_notification_preferences(JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_authenticated_pharmacy_notification_preferences(JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification_once(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, JSONB, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.create_notification_once(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, JSONB, JSONB)
  IS 'Service-only idempotent event generator that atomically creates the inbox row and provider outbox rows.';

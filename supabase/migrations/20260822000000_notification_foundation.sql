-- Shared notification substrate and in-app inbox.
--
-- This migration deliberately evolves the earlier provider outbox rather than
-- replacing it. The additional legacy delivery columns/statuses are retained
-- until the provider runtime is audited, while all new writes are forced
-- through SECURITY DEFINER RPCs.

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_type TEXT NOT NULL
    CHECK (recipient_type IN ('patient', 'pharmacist')),
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (
    type IN ('low_stock', 'expiry', 'daily_summary', 'broadcast', 'order')
    OR type ~ '^reservation_[a-z0-9_]+$'
  ),
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 2000),
  data JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(data) = 'object'),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications(recipient_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_pharmacy_created_idx
  ON public.notifications(pharmacy_id, created_at DESC)
  WHERE pharmacy_id IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_recipient_select ON public.notifications;
CREATE POLICY notifications_recipient_select
ON public.notifications FOR SELECT TO authenticated
USING (recipient_id = auth.uid());

REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;

-- Extend the previously shipped preference row with the shared, per-type
-- channel map. In-app starts on; provider-backed channels remain opt-in.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS pharmacy_id UUID,
  ADD COLUMN IF NOT EXISTS type_channels JSONB NOT NULL DEFAULT
    '{
      "low_stock":{"in_app":true,"email":false,"sms":false,"push":false},
      "expiry":{"in_app":true,"email":false,"sms":false,"push":false},
      "daily_summary":{"in_app":true,"email":false,"sms":false,"push":false},
      "reservation":{"in_app":true,"email":false,"sms":false,"push":false},
      "broadcast":{"in_app":true,"email":false,"sms":false,"push":false},
      "order":{"in_app":true,"email":false,"sms":false,"push":false}
    }'::JSONB,
  ADD COLUMN IF NOT EXISTS patient_email_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS patient_sms_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS patient_push_consent BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_preferences_pharmacy_id_fkey'
      AND conrelid = 'public.notification_preferences'::regclass
  ) THEN
    ALTER TABLE public.notification_preferences
      ADD CONSTRAINT notification_preferences_pharmacy_id_fkey
      FOREIGN KEY (pharmacy_id) REFERENCES public.pharmacies(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_preferences_type_channels_object'
      AND conrelid = 'public.notification_preferences'::regclass
  ) THEN
    ALTER TABLE public.notification_preferences
      ADD CONSTRAINT notification_preferences_type_channels_object
      CHECK (jsonb_typeof(type_channels) = 'object');
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_pharmacy_unique_idx
  ON public.notification_preferences(pharmacy_id)
  WHERE pharmacy_id IS NOT NULL;

DROP POLICY IF EXISTS notification_preferences_owner_select
  ON public.notification_preferences;
CREATE POLICY notification_preferences_owner_select
ON public.notification_preferences FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND (
    pharmacy_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.pharmacies pharmacy
      WHERE pharmacy.id = notification_preferences.pharmacy_id
        AND pharmacy.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS notification_preferences_owner_insert
  ON public.notification_preferences;
CREATE POLICY notification_preferences_owner_insert
ON public.notification_preferences FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    pharmacy_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.pharmacies pharmacy
      WHERE pharmacy.id = notification_preferences.pharmacy_id
        AND pharmacy.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS notification_preferences_owner_update
  ON public.notification_preferences;
CREATE POLICY notification_preferences_owner_update
ON public.notification_preferences FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND (
    pharmacy_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.pharmacies pharmacy
      WHERE pharmacy.id = notification_preferences.pharmacy_id
        AND pharmacy.user_id = auth.uid()
    )
  )
);

-- Link the existing durable provider outbox to the in-app notification. Null is
-- retained only for pre-foundation audit rows created by the legacy runtime.
ALTER TABLE public.notification_deliveries
  ADD COLUMN IF NOT EXISTS notification_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_deliveries_notification_id_fkey'
      AND conrelid = 'public.notification_deliveries'::regclass
  ) THEN
    ALTER TABLE public.notification_deliveries
      ADD CONSTRAINT notification_deliveries_notification_id_fkey
      FOREIGN KEY (notification_id) REFERENCES public.notifications(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

ALTER TABLE public.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check,
  DROP CONSTRAINT IF EXISTS notification_deliveries_provider_check,
  DROP CONSTRAINT IF EXISTS notification_deliveries_status_check,
  DROP CONSTRAINT IF EXISTS pending_delivery_has_recipient;

ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check
    CHECK (channel IN ('email', 'sms', 'push')),
  ADD CONSTRAINT notification_deliveries_provider_check
    CHECK (provider IN ('resend', 'termii', 'web_push')),
  ADD CONSTRAINT notification_deliveries_status_check
    CHECK (status IN (
      'pending', 'queued', 'sending', 'sent', 'delivered',
      'retry', 'failed', 'skipped'
    )),
  ADD CONSTRAINT pending_delivery_has_recipient CHECK (
    status IN ('sent', 'delivered', 'failed', 'skipped')
    OR recipient IS NOT NULL
    OR notification_id IS NOT NULL
  );

ALTER TABLE public.notification_deliveries
  ALTER COLUMN status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS notification_deliveries_notification_idx
  ON public.notification_deliveries(notification_id, created_at);

REVOKE ALL ON public.notification_deliveries FROM PUBLIC, anon, authenticated;

-- Service-only escape hatch for the legacy provider runtime. Keeping this RPC
-- separate makes it impossible for application code to insert outbox rows
-- directly while Prompt 2 transitions every generator to linked notifications.
CREATE OR REPLACE FUNCTION public.enqueue_notification_delivery(
  p_notification_id UUID,
  p_channel TEXT,
  p_provider TEXT,
  p_idempotency_key TEXT,
  p_legacy JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_delivery public.notification_deliveries%ROWTYPE;
  v_notification_type TEXT;
  v_status TEXT;
  v_recipient TEXT;
  v_recipient_hash TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_channel NOT IN ('email', 'sms', 'push') THEN
    RAISE EXCEPTION 'Unsupported notification channel';
  END IF;
  IF p_provider NOT IN ('resend', 'termii', 'web_push') THEN
    RAISE EXCEPTION 'Unsupported notification provider';
  END IF;
  IF NULLIF(trim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;
  IF p_notification_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.notifications WHERE id = p_notification_id
  ) THEN
    RAISE EXCEPTION 'Notification not found';
  END IF;

  SELECT type INTO v_notification_type
  FROM public.notifications
  WHERE id = p_notification_id;
  v_notification_type := COALESCE(
    v_notification_type,
    NULLIF(p_legacy->>'notification_type', '')
  );
  IF v_notification_type IS NULL THEN
    RAISE EXCEPTION 'Notification type is required';
  END IF;

  v_status := COALESCE(NULLIF(p_legacy->>'status', ''), 'pending');
  v_recipient := NULLIF(p_legacy->>'recipient', '');
  v_recipient_hash := COALESCE(
    NULLIF(p_legacy->>'recipient_hash', ''),
    md5(COALESCE(v_recipient, p_notification_id::TEXT, p_idempotency_key))
  );

  INSERT INTO public.notification_deliveries (
    notification_id,
    channel,
    notification_type,
    provider,
    pharmacy_id,
    user_id,
    recipient,
    recipient_hash,
    idempotency_key,
    status,
    payload
  ) VALUES (
    p_notification_id,
    p_channel,
    v_notification_type,
    p_provider,
    NULLIF(p_legacy->>'pharmacy_id', '')::UUID,
    NULLIF(p_legacy->>'user_id', '')::UUID,
    v_recipient,
    v_recipient_hash,
    p_idempotency_key,
    v_status,
    COALESCE(p_legacy->'payload', '{}'::JSONB)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_delivery;

  IF FOUND THEN
    RETURN jsonb_build_object('delivery', to_jsonb(v_delivery), 'duplicate', FALSE);
  END IF;

  SELECT * INTO v_delivery
  FROM public.notification_deliveries
  WHERE idempotency_key = p_idempotency_key;
  RETURN jsonb_build_object('delivery', to_jsonb(v_delivery), 'duplicate', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_notification(
  p_recipient_type TEXT,
  p_recipient_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_pharmacy_id UUID DEFAULT NULL,
  p_data JSONB DEFAULT '{}'::JSONB,
  p_deliveries JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_notification_id UUID;
  v_delivery JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_type NOT IN ('patient', 'pharmacist') THEN
    RAISE EXCEPTION 'Unsupported recipient type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_recipient_id) THEN
    RAISE EXCEPTION 'Recipient not found';
  END IF;
  IF p_recipient_type = 'pharmacist' AND (
    p_pharmacy_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.pharmacies pharmacy
      WHERE pharmacy.id = p_pharmacy_id
        AND pharmacy.user_id = p_recipient_id
    )
  ) THEN
    RAISE EXCEPTION 'Pharmacist recipient does not own the pharmacy';
  END IF;
  IF jsonb_typeof(COALESCE(p_data, '{}'::JSONB)) <> 'object' THEN
    RAISE EXCEPTION 'Notification data must be a JSON object';
  END IF;
  IF jsonb_typeof(COALESCE(p_deliveries, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'Deliveries must be a JSON array';
  END IF;

  INSERT INTO public.notifications (
    recipient_type, recipient_id, pharmacy_id, type, title, body, data
  ) VALUES (
    p_recipient_type,
    p_recipient_id,
    p_pharmacy_id,
    p_type,
    trim(p_title),
    trim(p_body),
    COALESCE(p_data, '{}'::JSONB)
  )
  RETURNING id INTO v_notification_id;

  FOR v_delivery IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_deliveries, '[]'::JSONB))
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
        'status', 'pending',
        'payload', COALESCE(v_delivery->'payload', '{}'::JSONB)
      )
    );
  END LOOP;

  RETURN v_notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_read_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notifications
  SET read_at = COALESCE(read_at, NOW())
  WHERE id = p_notification_id
    AND recipient_id = auth.uid()
  RETURNING read_at INTO v_read_at;

  RETURN v_read_at IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notifications
  SET read_at = NOW()
  WHERE recipient_id = auth.uid()
    AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification_delivery(UUID, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_notification(TEXT, UUID, TEXT, TEXT, TEXT, UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_delivery(UUID, TEXT, TEXT, TEXT, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(TEXT, UUID, TEXT, TEXT, TEXT, UUID, JSONB, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END
$$;

COMMENT ON TABLE public.notifications IS
  'User-visible notification inbox. Rows are service-created and recipient-readable only.';
COMMENT ON COLUMN public.notification_preferences.type_channels IS
  'Per-notification-type channel toggles; in-app defaults on and provider channels default off.';
COMMENT ON COLUMN public.notification_deliveries.notification_id IS
  'Required for foundation-era deliveries; nullable only for pre-foundation legacy audit rows.';

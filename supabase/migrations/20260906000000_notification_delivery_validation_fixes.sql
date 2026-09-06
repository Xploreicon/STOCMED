-- Repair idempotent notification generation and persist provider webhook
-- receipts so a valid signed event cannot be replayed.

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
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_notification_id;

  IF v_notification_id IS NULL THEN
    SELECT id INTO v_notification_id
    FROM public.notifications
    WHERE event_key = TRIM(p_event_key);
    v_duplicate := TRUE;
  ELSE
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

REVOKE ALL ON FUNCTION public.create_notification_once(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification_once(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, JSONB, JSONB)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.notification_webhook_events (
  provider TEXT NOT NULL CHECK (provider IN ('resend', 'termii')),
  event_id TEXT NOT NULL CHECK (char_length(trim(event_id)) BETWEEN 1 AND 255),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, event_id)
);

ALTER TABLE public.notification_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_webhook_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_notification_provider_event_once(
  p_provider TEXT,
  p_event_id TEXT,
  p_payload_sha256 TEXT,
  p_provider_message_id TEXT,
  p_status TEXT,
  p_provider_status TEXT DEFAULT NULL,
  p_cost NUMERIC DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_inserted BOOLEAN := FALSE;
  v_recorded BOOLEAN;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('resend', 'termii') THEN RAISE EXCEPTION 'Unsupported webhook provider'; END IF;
  IF NULLIF(TRIM(p_event_id), '') IS NULL THEN RAISE EXCEPTION 'Webhook event ID is required'; END IF;
  IF COALESCE(p_payload_sha256, '') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid webhook payload hash'; END IF;

  INSERT INTO public.notification_webhook_events(provider, event_id, payload_sha256)
  VALUES (p_provider, TRIM(p_event_id), p_payload_sha256)
  ON CONFLICT (provider, event_id) DO NOTHING
  RETURNING TRUE INTO v_inserted;

  IF NOT COALESCE(v_inserted, FALSE) THEN
    RETURN 'replay';
  END IF;

  v_recorded := public.record_notification_provider_event(
    p_provider,
    p_provider_message_id,
    p_status,
    p_provider_status,
    p_cost
  );

  IF NOT v_recorded THEN
    DELETE FROM public.notification_webhook_events
    WHERE provider = p_provider AND event_id = TRIM(p_event_id);
    RETURN 'unknown';
  END IF;
  RETURN 'recorded';
END;
$$;

REVOKE ALL ON FUNCTION public.record_notification_provider_event_once(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notification_provider_event_once(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC)
  TO service_role;

COMMENT ON TABLE public.notification_webhook_events IS
  'Service-only receipt ledger used to reject replayed Resend and Termii delivery events.';
COMMENT ON FUNCTION public.record_notification_provider_event_once(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) IS
  'Atomically claims a signed provider event and applies its delivery transition once.';

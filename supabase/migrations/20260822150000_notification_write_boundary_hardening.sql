-- Keep every notification mutation behind a bounded SECURITY DEFINER RPC.
-- These functions are service-only because callers have already authenticated
-- provider webhooks, cron jobs, or signed unsubscribe links on the server.

CREATE OR REPLACE FUNCTION public.unsubscribe_notification_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.notification_preferences (
    user_id, product_email_opt_in, refill_email_opt_in,
    unsubscribed_at, updated_at
  ) VALUES (
    p_user_id, FALSE, FALSE, NOW(), NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    product_email_opt_in = FALSE,
    refill_email_opt_in = FALSE,
    unsubscribed_at = NOW(),
    updated_at = NOW();
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_notification_delivery(p_delivery_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_delivery public.notification_deliveries%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notification_deliveries
  SET status = 'sending', attempts = attempts + 1, updated_at = NOW()
  WHERE id = p_delivery_id AND status IN ('queued', 'retry')
  RETURNING * INTO v_delivery;

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
    last_error = LEFT(NULLIF(p_result->>'error', ''), 500),
    send_after = COALESCE(NULLIF(p_result->>'retry_at', '')::TIMESTAMPTZ, NOW()),
    sent_at = CASE WHEN v_status IN ('sent', 'delivered') THEN NOW() ELSE NULL END,
    delivered_at = CASE WHEN v_status = 'delivered' THEN NOW() ELSE NULL END,
    recipient = CASE WHEN v_terminal THEN NULL ELSE recipient END,
    payload = CASE WHEN v_terminal THEN '{}'::JSONB ELSE payload END,
    updated_at = NOW()
  WHERE id = p_delivery_id;
  RETURN FOUND;
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
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('resend', 'termii') OR p_status NOT IN ('sent', 'delivered', 'failed') THEN
    RAISE EXCEPTION 'Unsupported provider event';
  END IF;

  UPDATE public.notification_deliveries SET
    status = p_status,
    provider_status = NULLIF(p_provider_status, ''),
    cost = p_cost,
    delivered_at = CASE WHEN p_status = 'delivered' THEN NOW() ELSE delivered_at END,
    recipient = NULL,
    payload = '{}'::JSONB,
    updated_at = NOW()
  WHERE provider = p_provider
    AND provider_message_id = p_provider_message_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.unsubscribe_notification_user(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_notification_delivery(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_notification_delivery(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_notification_provider_event(TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.unsubscribe_notification_user(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_delivery(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_notification_delivery(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_notification_provider_event(TEXT, TEXT, TEXT, TEXT, NUMERIC) TO service_role;

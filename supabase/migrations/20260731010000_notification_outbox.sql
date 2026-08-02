-- Durable, service-role-only notification outbox. Recipient values are kept
-- only while delivery is pending; recipient_hash remains for long-term audit.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  product_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  refill_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  unsubscribed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pharmacy_notification_preferences (
  pharmacy_id UUID PRIMARY KEY REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  owner_phone TEXT,
  reservation_sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  stock_digest_sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  daily_sms_cap INTEGER NOT NULL DEFAULT 10 CHECK (daily_sms_cap BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  notification_type TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('resend', 'termii')),
  pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient TEXT,
  recipient_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'retry', 'failed', 'skipped')),
  provider_message_id TEXT,
  provider_status TEXT,
  cost NUMERIC(12, 4),
  attempts INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_error TEXT,
  send_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_delivery_has_recipient CHECK (
    status IN ('sent', 'delivered', 'failed', 'skipped') OR recipient IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS notification_deliveries_dispatch_idx
  ON public.notification_deliveries(send_after, created_at)
  WHERE status IN ('queued', 'retry');
CREATE INDEX IF NOT EXISTS notification_deliveries_pharmacy_daily_idx
  ON public.notification_deliveries(pharmacy_id, channel, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_deliveries_provider_message_idx
  ON public.notification_deliveries(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_owner_select ON public.notification_preferences;
CREATE POLICY notification_preferences_owner_select ON public.notification_preferences
FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS notification_preferences_owner_insert ON public.notification_preferences;
CREATE POLICY notification_preferences_owner_insert ON public.notification_preferences
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS notification_preferences_owner_update ON public.notification_preferences;
CREATE POLICY notification_preferences_owner_update ON public.notification_preferences
FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS pharmacy_notification_preferences_owner_select
  ON public.pharmacy_notification_preferences;
CREATE POLICY pharmacy_notification_preferences_owner_select
ON public.pharmacy_notification_preferences FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.pharmacies
  WHERE id = pharmacy_notification_preferences.pharmacy_id AND user_id = auth.uid()
));
DROP POLICY IF EXISTS pharmacy_notification_preferences_owner_insert
  ON public.pharmacy_notification_preferences;
CREATE POLICY pharmacy_notification_preferences_owner_insert
ON public.pharmacy_notification_preferences FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.pharmacies
  WHERE id = pharmacy_notification_preferences.pharmacy_id AND user_id = auth.uid()
));
DROP POLICY IF EXISTS pharmacy_notification_preferences_owner_update
  ON public.pharmacy_notification_preferences;
CREATE POLICY pharmacy_notification_preferences_owner_update
ON public.pharmacy_notification_preferences FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.pharmacies
  WHERE id = pharmacy_notification_preferences.pharmacy_id AND user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.pharmacies
  WHERE id = pharmacy_notification_preferences.pharmacy_id AND user_id = auth.uid()
));

GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pharmacy_notification_preferences TO authenticated;
REVOKE ALL ON public.notification_deliveries FROM anon, authenticated;

COMMENT ON TABLE public.notification_deliveries IS
  'Durable notification audit/outbox. Raw recipients and message payloads are erased after terminal delivery state.';

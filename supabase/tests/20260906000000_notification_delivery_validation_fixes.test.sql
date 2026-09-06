BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT no_plan();

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'c9600000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'notification-fix@stocmed.invalid',
  '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
);

SELECT ok(
  to_regclass('public.notification_webhook_events') IS NOT NULL,
  'provider webhook receipt ledger exists'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_webhook_events'::regclass),
  'provider webhook receipt ledger has RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.notification_webhook_events', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.notification_webhook_events', 'INSERT')
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_notification_provider_event_once(text,text,text,text,text,text,numeric)',
    'EXECUTE'
  ),
  'webhook receipts and mutation RPC remain service-only'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END
$$;
SET LOCAL ROLE service_role;

CREATE TEMP TABLE pg_temp.notification_once_results(result JSONB);
INSERT INTO pg_temp.notification_once_results(result)
SELECT public.create_notification_once(
  'pgtap:notification-fix:one',
  'patient',
  'c9600000-0000-4000-8000-000000000001',
  'low_stock',
  'Controlled low-stock test',
  'This transaction will be rolled back.',
  NULL,
  '{"source":"pgtap"}'::JSONB,
  '[{
    "channel":"email",
    "provider":"resend",
    "idempotency_key":"pgtap:notification-fix:delivery-one",
    "recipient":"notification-fix@stocmed.invalid",
    "recipient_hash":"pgtap-hash",
    "payload":{"subject":"Controlled test"}
  }]'::JSONB
);
INSERT INTO pg_temp.notification_once_results(result)
SELECT public.create_notification_once(
  'pgtap:notification-fix:one',
  'patient',
  'c9600000-0000-4000-8000-000000000001',
  'low_stock',
  'Controlled low-stock retry',
  'This duplicate must not create another row.',
  NULL,
  '{}'::JSONB,
  '[{
    "channel":"email",
    "provider":"resend",
    "idempotency_key":"pgtap:notification-fix:delivery-two",
    "recipient":"notification-fix@stocmed.invalid",
    "recipient_hash":"pgtap-hash-two",
    "payload":{"subject":"Duplicate"}
  }]'::JSONB
);

SELECT is(
  (SELECT array_agg((result->>'duplicate')::BOOLEAN ORDER BY ctid)
   FROM pg_temp.notification_once_results),
  ARRAY[FALSE, TRUE],
  'create_notification_once creates once and reports the retry as a duplicate'
);
SELECT is(
  (SELECT count(*) FROM public.notifications WHERE event_key = 'pgtap:notification-fix:one'),
  1::BIGINT,
  'event key partial uniqueness leaves exactly one notification'
);
SELECT is(
  (SELECT count(*) FROM public.notification_deliveries
   WHERE idempotency_key LIKE 'pgtap:notification-fix:delivery-%'),
  1::BIGINT,
  'duplicate event generation leaves exactly one provider delivery'
);

SELECT ok(
  public.finish_notification_delivery(
    (SELECT id FROM public.notification_deliveries
     WHERE idempotency_key = 'pgtap:notification-fix:delivery-one'),
    '{"status":"sent","provider_message_id":"pgtap-provider-message-one","provider_status":"accepted"}'::JSONB
  ),
  'controlled provider delivery reaches sent before the webhook'
);
SELECT is(
  public.record_notification_provider_event_once(
    'resend', 'pgtap-webhook-event-one', repeat('a', 64),
    'pgtap-provider-message-one', 'delivered', 'email.delivered', NULL
  ),
  'recorded',
  'the first signed webhook event is recorded'
);
SELECT is(
  (SELECT status FROM public.notification_deliveries
   WHERE idempotency_key = 'pgtap:notification-fix:delivery-one'),
  'delivered',
  'the provider event advances sent to delivered'
);
SELECT is(
  public.record_notification_provider_event_once(
    'resend', 'pgtap-webhook-event-one', repeat('a', 64),
    'pgtap-provider-message-one', 'delivered', 'email.delivered', NULL
  ),
  'replay',
  'an identical signed provider event is rejected as a replay'
);

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.notification_webhook_events
   WHERE provider = 'resend' AND event_id = 'pgtap-webhook-event-one'),
  1::BIGINT,
  'only one webhook receipt is retained'
);

SELECT * FROM finish();
ROLLBACK;

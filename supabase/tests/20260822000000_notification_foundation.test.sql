BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
-- The linked project's extensions schema is intentionally not exposed to app
-- roles. Grant temporary test-only visibility; the final ROLLBACK removes it.
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
DO $$
DECLARE
  v_pgtap_schema TEXT;
BEGIN
  SELECT namespace.nspname INTO v_pgtap_schema
  FROM pg_extension extension
  JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pgtap';
  PERFORM set_config(
    'search_path',
    'public,' || quote_ident(v_pgtap_schema) || ',auth,pg_temp',
    TRUE
  );
END
$$;
SELECT no_plan();

CREATE FUNCTION pg_temp.raises_insufficient_privilege(p_sql TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN FALSE;
EXCEPTION
  WHEN insufficient_privilege THEN
    RETURN TRUE;
END;
$$;

CREATE FUNCTION pg_temp.raises_unique_violation(p_sql TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN FALSE;
EXCEPTION
  WHEN unique_violation THEN
    RETURN TRUE;
END;
$$;

-- Production-safe fixtures. The enclosing transaction rolls these accounts and
-- every notification assertion back after the test completes.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'c6100000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'notification-owner@stocmed.invalid',
    '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'c6100000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'notification-non-owner@stocmed.invalid',
    '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
  );

SELECT ok(to_regclass('public.notifications') IS NOT NULL, 'notifications table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notifications'::regclass),
  'notifications has row-level security enabled'
);
SELECT is(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'notifications'
     AND column_name IN (
       'id', 'recipient_type', 'recipient_id', 'pharmacy_id', 'type',
       'title', 'body', 'data', 'read_at', 'created_at'
     )),
  10::BIGINT,
  'notifications exposes every foundation column'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.notifications', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.notifications', 'DELETE'),
  'authenticated users have no direct notification writes'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.notification_deliveries', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.notification_deliveries', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.notification_deliveries', 'DELETE'),
  'authenticated users have no direct delivery writes'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.create_notification(text,uuid,text,text,text,uuid,jsonb,jsonb)',
    'EXECUTE'
  ),
  'notification creation RPC is not callable by authenticated users'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated', 'public.claim_notification_delivery(uuid)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated', 'public.finish_notification_delivery(uuid,jsonb)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_notification_provider_event(text,text,text,text,numeric)',
    'EXECUTE'
  ),
  'provider delivery mutation RPCs are service-only'
);
SELECT ok(
  has_function_privilege(
    'authenticated', 'public.mark_notification_read(uuid)', 'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated', 'public.mark_all_notifications_read()', 'EXECUTE'
  ),
  'authenticated users can call the bounded read-state RPCs'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END
$$;
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$SELECT public.create_notification(
    'patient',
    'c6100000-0000-4000-8000-000000000001',
    'order',
    'Order ready',
    'Your order is ready for collection.',
    NULL,
    '{"href":"/reservations"}'::JSONB,
    '[{"channel":"email","provider":"resend","idempotency_key":"foundation:test:linked-owner"}]'::JSONB
  )$$,
  'service role creates a notification and linked delivery through the RPC'
);

SELECT lives_ok(
  $$SELECT public.create_notification(
    'patient',
    'c6100000-0000-4000-8000-000000000002',
    'broadcast',
    'Another recipient',
    'This row must remain private to its recipient.',
    NULL,
    '{"href":"/dashboard"}'::JSONB
  )$$,
  'service role creates a second recipient notification through the RPC'
);

SELECT is(
  (SELECT status FROM public.notification_deliveries
   WHERE idempotency_key = 'foundation:test:linked-owner'),
  'pending',
  'new provider delivery starts pending'
);
SELECT ok(
  (SELECT notification_id IS NOT NULL FROM public.notification_deliveries
   WHERE idempotency_key = 'foundation:test:linked-owner'),
  'new provider delivery links to its in-app notification'
);

SELECT ok(
  pg_temp.raises_unique_violation($sql$
    INSERT INTO public.notification_deliveries (
      notification_id, channel, notification_type, provider,
      recipient_hash, idempotency_key, status
    )
    SELECT
      notification_id, channel, notification_type, provider,
      recipient_hash, idempotency_key, status
    FROM public.notification_deliveries
    WHERE idempotency_key = 'foundation:test:linked-owner'
  $sql$),
  'delivery idempotency key unique constraint rejects a duplicate insert'
);

SELECT ok(
  (
    public.enqueue_notification_delivery(
      (SELECT notification_id FROM public.notification_deliveries
       WHERE idempotency_key = 'foundation:test:linked-owner'),
      'email', 'resend', 'foundation:test:linked-owner', '{}'
    )->>'duplicate'
  )::BOOLEAN,
  'delivery RPC handles an idempotent retry without inserting another row'
);
SELECT is(
  (SELECT COUNT(*) FROM public.notification_deliveries
   WHERE idempotency_key = 'foundation:test:linked-owner'),
  1::BIGINT,
  'idempotent delivery retry leaves exactly one outbox row'
);

RESET ROLE;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config(
    'request.jwt.claim.sub',
    'c6100000-0000-4000-8000-000000000001',
    TRUE
  );
END
$$;
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT COUNT(*) FROM public.notifications),
  1::BIGINT,
  'RLS exposes only the signed-in recipient notification'
);
SELECT is(
  (SELECT COUNT(*) FROM public.notifications
   WHERE recipient_id = 'c6100000-0000-4000-8000-000000000002'),
  0::BIGINT,
  'authenticated non-owner cannot read another recipient notification'
);
SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    INSERT INTO public.notifications (
      recipient_type, recipient_id, type, title, body
    ) VALUES (
      'patient', auth.uid(), 'order', 'Forged', 'Direct insert must fail'
    )
  $sql$),
  'direct authenticated notification insert is denied'
);
SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    INSERT INTO public.notification_deliveries (
      channel, notification_type, provider, recipient_hash,
      idempotency_key, status
    ) VALUES (
      'email', 'order', 'resend', 'forged',
      'foundation:test:forged-delivery', 'pending'
    )
  $sql$),
  'direct authenticated delivery insert is denied'
);
SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    UPDATE public.notifications SET read_at = NOW()
  $sql$),
  'direct authenticated notification update is denied'
);
SELECT ok(
  public.mark_notification_read(
    (SELECT id FROM public.notifications WHERE recipient_id = auth.uid() LIMIT 1)
  ),
  'recipient marks one notification read through the RPC'
);
SELECT is(
  public.mark_all_notifications_read(),
  0,
  'mark-all is idempotent after the only notification was read'
);

SELECT public.set_authenticated_notification_preferences(jsonb_build_object(
  'product_email_opt_in', FALSE,
  'refill_email_opt_in', FALSE,
  'reminder_sms_opt_in', FALSE,
  'patient_email_consent', FALSE,
  'patient_sms_consent', FALSE,
  'patient_push_consent', FALSE
));

SELECT ok(
  (SELECT (type_channels #>> '{low_stock,in_app}')::BOOLEAN
   FROM public.notification_preferences WHERE user_id = auth.uid())
  AND NOT (SELECT (type_channels #>> '{low_stock,email}')::BOOLEAN
   FROM public.notification_preferences WHERE user_id = auth.uid())
  AND NOT (SELECT patient_email_consent
   FROM public.notification_preferences WHERE user_id = auth.uid())
  AND NOT (SELECT patient_sms_consent
   FROM public.notification_preferences WHERE user_id = auth.uid()),
  'preference defaults enable in-app and keep email/SMS consent off'
);

SELECT * FROM finish();
ROLLBACK;

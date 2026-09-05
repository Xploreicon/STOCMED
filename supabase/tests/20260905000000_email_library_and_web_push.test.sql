BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT no_plan();

CREATE FUNCTION pg_temp.sqlstate_for(p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at
) VALUES
  ('00000000-0000-0000-0000-000000000000','c9500000-0000-4000-8000-000000000001','authenticated','authenticated','admin@email-library.stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW(),NOW()),
  ('00000000-0000-0000-0000-000000000000','c9500000-0000-4000-8000-000000000002','authenticated','authenticated','patient@email-library.stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW(),NOW()),
  ('00000000-0000-0000-0000-000000000000','c9500000-0000-4000-8000-000000000003','authenticated','authenticated','pharmacy@email-library.stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW(),NOW()),
  ('00000000-0000-0000-0000-000000000000','c9500000-0000-4000-8000-000000000004','authenticated','authenticated','outsider@email-library.stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW(),NOW());

SELECT set_config('app.pilot_role_provenance_reset', 'on', TRUE);
INSERT INTO public.users (
  user_id, email, full_name, role, is_admin,
  admin_authorized_at, admin_authorization_basis
) VALUES
  ('c9500000-0000-4000-8000-000000000001','admin@email-library.stocmed.invalid','Email Admin','patient',TRUE,NOW(),'pgTAP administrator fixture'),
  ('c9500000-0000-4000-8000-000000000002','patient@email-library.stocmed.invalid','Email Patient','patient',FALSE,NULL,NULL),
  ('c9500000-0000-4000-8000-000000000003','pharmacy@email-library.stocmed.invalid','Email Owner','pharmacy',FALSE,NULL,NULL);
SELECT set_config('app.pilot_role_provenance_reset', 'off', TRUE);

INSERT INTO public.pharmacies (
  id, user_id, pharmacy_name, license_number, address, city, state, phone,
  is_active, subscription_tier
) VALUES (
  'c9500000-0000-4000-8000-000000000010',
  'c9500000-0000-4000-8000-000000000003',
  'Email Library Pharmacy', '950000', '95 Email Road', 'Ikeja', 'Lagos',
  '+2348019500000', TRUE, 'free'
);

SELECT ok(to_regclass('public.welcome_email_jobs') IS NOT NULL, 'welcome email job table exists');
SELECT ok(to_regclass('public.push_subscriptions') IS NOT NULL, 'push subscription table exists');
SELECT has_column('public', 'broadcasts', 'body_format', 'broadcasts record the body format');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.push_subscriptions'::regclass),
  'push subscriptions have row-level security enabled'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.push_subscriptions', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.push_subscriptions', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.welcome_email_jobs', 'SELECT'),
  'clients cannot bypass push or welcome server write boundaries'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.set_authenticated_push_subscription(text,text,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.delete_authenticated_push_subscription(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.resolve_push_audience(uuid,jsonb)', 'EXECUTE'),
  'owner push mutations are authenticated while admin audience resolution is service-only'
);
SELECT is(
  (SELECT count(*) FROM public.welcome_email_jobs),
  2::BIGINT,
  'profile creation makes exactly one welcome job for each non-admin account'
);
UPDATE public.users SET full_name = full_name WHERE user_id = 'c9500000-0000-4000-8000-000000000002';
SELECT is(
  (SELECT count(*) FROM public.welcome_email_jobs WHERE user_id = 'c9500000-0000-4000-8000-000000000002'),
  1::BIGINT,
  'profile retries and updates do not duplicate a welcome job'
);
SELECT is(
  pg_temp.sqlstate_for($sql$
    INSERT INTO public.broadcasts(
      subject, body_markdown, body_format, template, audience, created_by
    ) VALUES (
      'Bad format', 'Body', 'javascript', 'custom', '{"kind":"all_users"}',
      'c9500000-0000-4000-8000-000000000001'
    )
  $sql$),
  '23514',
  'broadcast body format rejects unsupported values'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'c9500000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;

SELECT lives_ok($sql$
  SELECT public.set_authenticated_push_subscription(
    'https://push.example.test/patient-device', 'patient-p256dh', 'patient-auth', 'pgTAP browser'
  )
$sql$, 'authenticated owner subscribes through the narrow RPC');
SELECT is(
  (SELECT count(*) FROM public.push_subscriptions),
  1::BIGINT,
  'owner can read the single push subscription belonging to the current account'
);
SELECT is(
  pg_temp.sqlstate_for($sql$
    INSERT INTO public.push_subscriptions(user_id, endpoint, p256dh, auth_key)
    VALUES (
      'c9500000-0000-4000-8000-000000000002',
      'https://push.example.test/direct', 'key', 'auth'
    )
  $sql$),
  '42501',
  'direct authenticated push subscription insert is denied'
);

RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'c9500000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT lives_ok($sql$
  SELECT public.set_authenticated_push_subscription(
    'https://push.example.test/admin-device', 'admin-p256dh', 'admin-auth', 'pgTAP admin PWA'
  )
$sql$, 'an admin can subscribe a PWA device for an individual test push');

RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'c9500000-0000-4000-8000-000000000004', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.push_subscriptions),
  0::BIGINT,
  'a non-owner cannot read another user push subscription'
);

RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*) FROM public.resolve_broadcast_audience(
    'c9500000-0000-4000-8000-000000000001', '{"kind":"all_users"}'::JSONB
  ) WHERE user_id IN (
    'c9500000-0000-4000-8000-000000000002',
    'c9500000-0000-4000-8000-000000000003'
  )),
  2::BIGINT,
  'all-users email audience includes patient and pharmacy accounts but not admins'
);
SELECT is(
  (SELECT count(*) FROM public.resolve_broadcast_audience(
    'c9500000-0000-4000-8000-000000000001', '{"kind":"free_pharmacies"}'::JSONB
  ) WHERE pharmacy_id = 'c9500000-0000-4000-8000-000000000010'),
  1::BIGINT,
  'non-premium segment treats a free pharmacy as eligible'
);
SELECT is(
  (SELECT count(*) FROM public.resolve_push_audience(
    'c9500000-0000-4000-8000-000000000001', '{"kind":"all_users"}'::JSONB
  )),
  1::BIGINT,
  'push audience includes only accounts with an active subscription and consent'
);
SELECT is(
  (SELECT count(*) FROM public.resolve_push_audience(
    'c9500000-0000-4000-8000-000000000001',
    '{"kind":"individual_user","user_id":"c9500000-0000-4000-8000-000000000001"}'::JSONB
  )),
  1::BIGINT,
  'individual-user push audience permits an explicitly selected subscribed admin'
);
SELECT ok(
  public.suppress_email_category('c9500000-0000-4000-8000-000000000002', 'broadcast'),
  'patient opts out of broadcast email'
);
SELECT is(
  (SELECT count(*) FROM public.resolve_broadcast_audience(
    'c9500000-0000-4000-8000-000000000001', '{"kind":"all_users"}'::JSONB
  ) WHERE user_id = 'c9500000-0000-4000-8000-000000000002'),
  0::BIGINT,
  'email-unsubscribed account is excluded from broadcast email'
);
SELECT is(
  (SELECT count(*) FROM public.resolve_push_audience(
    'c9500000-0000-4000-8000-000000000001', '{"kind":"all_users"}'::JSONB
  ) WHERE user_id = 'c9500000-0000-4000-8000-000000000002'),
  1::BIGINT,
  'email unsubscribe does not revoke independent push consent'
);

RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'c9500000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT ok(
  public.delete_authenticated_push_subscription('https://push.example.test/patient-device'),
  'authenticated owner removes the subscription through the narrow RPC'
);

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.push_subscriptions
   WHERE user_id = 'c9500000-0000-4000-8000-000000000002'),
  0::BIGINT,
  'unsubscribe removes the push endpoint'
);
SELECT is(
  (SELECT patient_push_consent FROM public.notification_preferences
   WHERE user_id = 'c9500000-0000-4000-8000-000000000002'),
  FALSE,
  'removing the final endpoint clears push consent'
);

SELECT * FROM finish();
ROLLBACK;

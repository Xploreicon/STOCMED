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
  ('00000000-0000-0000-0000-000000000000','b2400000-0000-4000-8000-000000000001','authenticated','authenticated','broadcast-admin@stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW(),NOW()),
  ('00000000-0000-0000-0000-000000000000','b2400000-0000-4000-8000-000000000002','authenticated','authenticated','owner@digest.stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW(),NOW()),
  ('00000000-0000-0000-0000-000000000000','b2400000-0000-4000-8000-000000000003','authenticated','authenticated','patient@broadcast.stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW(),NOW());

SELECT set_config('app.pilot_role_provenance_reset', 'on', TRUE);
INSERT INTO public.users (
  user_id, email, full_name, role, is_admin,
  admin_authorized_at, admin_authorization_basis
) VALUES
  ('b2400000-0000-4000-8000-000000000001','broadcast-admin@stocmed.invalid','Broadcast Admin','patient',TRUE,NOW(),'pgTAP administrator fixture'),
  ('b2400000-0000-4000-8000-000000000002','owner@digest.stocmed.invalid','Digest Owner','pharmacy',FALSE,NULL,NULL),
  ('b2400000-0000-4000-8000-000000000003','patient@broadcast.stocmed.invalid','Broadcast Patient','patient',FALSE,NULL,NULL);
SELECT set_config('app.pilot_role_provenance_reset', 'off', TRUE);

INSERT INTO public.pharmacies (
  id, user_id, pharmacy_name, license_number, address, city, state, phone,
  is_active, subscription_tier
) VALUES (
  'b2400000-0000-4000-8000-000000000010',
  'b2400000-0000-4000-8000-000000000002',
  'Digest Pharmacy', '924000', '24 Digest Road', 'Ikeja', 'Lagos',
  '+2348012400000', TRUE, 'premium'
);

UPDATE public.pharmacy_features SET
  is_enabled = TRUE, enabled_at = NOW(), enabled_by = 'b2400000-0000-4000-8000-000000000002'
WHERE pharmacy_id = 'b2400000-0000-4000-8000-000000000010'
  AND feature_key = 'notifications';

INSERT INTO public.pharmacy_notification_preferences (
  pharmacy_id, owner_email, search_digest_email_opt_in
) VALUES (
  'b2400000-0000-4000-8000-000000000010',
  'owner@digest.stocmed.invalid', TRUE
);

INSERT INTO public.products (
  id, generic_name, brand_name, strength, is_verified
) VALUES (
  'b2400000-0000-4000-8000-000000000020',
  'Amoxicillin', 'Amoxil', '500 mg', TRUE
);

INSERT INTO public.pharmacy_inventory (
  id, pharmacy_id, product_id, item_type, price, quantity_in_stock, is_listed
) VALUES (
  'b2400000-0000-4000-8000-000000000030',
  'b2400000-0000-4000-8000-000000000010',
  'b2400000-0000-4000-8000-000000000020',
  'medicine', 1000, 12, TRUE
);

INSERT INTO public.searches (
  id, user_id, session_id, query_text, product_id, results_count, location,
  metadata, timestamp
) VALUES (
  'b2400000-0000-4000-8000-000000000040',
  NULL, NULL, 'Amoxil', 'b2400000-0000-4000-8000-000000000020', 1,
  'Ikeja, Lagos', NULL, NOW() - INTERVAL '1 hour'
);

SELECT ok(to_regclass('public.broadcasts') IS NOT NULL, 'broadcasts table exists');
SELECT ok(to_regclass('public.broadcast_recipients') IS NOT NULL, 'broadcast recipient history exists');
SELECT ok(to_regclass('public.email_suppressions') IS NOT NULL, 'category email suppressions exist');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.broadcasts'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.broadcast_recipients'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_suppressions'::regclass),
  'broadcast tables and suppression state have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.broadcasts', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.broadcast_recipients', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.email_suppressions', 'INSERT'),
  'authenticated clients cannot bypass server-side broadcast writes'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.resolve_broadcast_audience(uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.queue_admin_broadcast_recipients(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.suppress_email_category(uuid,text)', 'EXECUTE'),
  'audience, queue, and unsubscribe mutation RPCs are service-only'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
SET LOCAL ROLE service_role;

SELECT is(
  (SELECT count(*) FROM public.resolve_broadcast_audience(
    'b2400000-0000-4000-8000-000000000001',
    '{"kind":"premium_pharmacies"}'::JSONB
  )),
  1::BIGINT,
  'authorized admin resolves the subscribed premium pharmacy audience'
);
SELECT is(
  (SELECT count(*) FROM public.resolve_broadcast_audience(
    'b2400000-0000-4000-8000-000000000001',
    '{"kind":"all_patients"}'::JSONB
  ) WHERE user_id = 'b2400000-0000-4000-8000-000000000003'),
  1::BIGINT,
  'patient audience resolves eligible patient accounts'
);
SELECT is(
  (SELECT (items->0->>'search_count')::INTEGER
   FROM public.get_search_digest_candidates(NOW() - INTERVAL '24 hours', NOW())
   WHERE pharmacy_id = 'b2400000-0000-4000-8000-000000000010'),
  1,
  'daily digest aggregates nearby searches over the requested window'
);
SELECT is(
  (SELECT items->0->>'in_stock'
   FROM public.get_search_digest_candidates(NOW() - INTERVAL '24 hours', NOW())
   WHERE pharmacy_id = 'b2400000-0000-4000-8000-000000000010'),
  'true',
  'daily digest identifies medication that the pharmacy carries in stock'
);

RESET ROLE;
INSERT INTO public.broadcasts (
  id, subject, body_markdown, template, audience, created_by, scheduled_at
) VALUES (
  'b2400000-0000-4000-8000-000000000050',
  'Test broadcast', 'A safe test message.', 'announcement',
  '{"kind":"premium_pharmacies"}',
  'b2400000-0000-4000-8000-000000000001', NOW()
);
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
SET LOCAL ROLE service_role;

SELECT lives_ok($sql$
  SELECT public.queue_admin_broadcast_recipients(
    'b2400000-0000-4000-8000-000000000001',
    'b2400000-0000-4000-8000-000000000050',
    '[{
      "user_id":"b2400000-0000-4000-8000-000000000002",
      "pharmacy_id":"b2400000-0000-4000-8000-000000000010",
      "email":"owner@digest.stocmed.invalid",
      "display_name":"Digest Pharmacy",
      "recipient_hash":"broadcast-test-hash",
      "idempotency_key":"broadcast:test:recipient",
      "payload":{"subject":"Test broadcast","html":"<p>Test</p>","text":"Test","unsubscribeUrl":"https://askstocmed.com/u/test"}
    }]'::JSONB
  )
$sql$, 'service RPC queues a broadcast delivery');
SELECT is(
  (SELECT count(*) FROM public.notification_deliveries WHERE idempotency_key = 'broadcast:test:recipient'),
  1::BIGINT,
  'broadcast queue creates one durable notification delivery'
);
SELECT lives_ok($sql$
  SELECT public.queue_admin_broadcast_recipients(
    'b2400000-0000-4000-8000-000000000001',
    'b2400000-0000-4000-8000-000000000050',
    '[{
      "user_id":"b2400000-0000-4000-8000-000000000002",
      "pharmacy_id":"b2400000-0000-4000-8000-000000000010",
      "email":"owner@digest.stocmed.invalid",
      "display_name":"Digest Pharmacy",
      "recipient_hash":"broadcast-test-hash",
      "idempotency_key":"broadcast:test:recipient",
      "payload":{"subject":"Test broadcast"}
    }]'::JSONB
  )
$sql$, 'queue retry is idempotent');
SELECT is(
  (SELECT count(*) FROM public.notification_deliveries WHERE idempotency_key = 'broadcast:test:recipient'),
  1::BIGINT,
  'queue retry does not create a duplicate delivery'
);
SELECT ok(
  public.suppress_email_category('b2400000-0000-4000-8000-000000000002', 'broadcast'),
  'signed-link service path records a broadcast unsubscribe'
);
SELECT ok(
  public.suppress_email_category('b2400000-0000-4000-8000-000000000002', 'broadcast'),
  'broadcast unsubscribe is idempotent'
);
SELECT is(
  (SELECT count(*) FROM public.resolve_broadcast_audience(
    'b2400000-0000-4000-8000-000000000001',
    '{"kind":"all_pharmacies"}'::JSONB
  ) WHERE user_id = 'b2400000-0000-4000-8000-000000000002'),
  0::BIGINT,
  'unsubscribed pharmacy is excluded from subsequent broadcasts'
);
RESET ROLE;
SELECT is(
  (SELECT delivery_status FROM public.broadcast_recipients
   WHERE broadcast_id = 'b2400000-0000-4000-8000-000000000050'),
  'skipped',
  'unsubscribe cancels a queued recipient before dispatch'
);
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
SET LOCAL ROLE service_role;
SELECT ok(
  public.suppress_email_category('b2400000-0000-4000-8000-000000000002', 'search_digest'),
  'search-demand unsubscribe records its independent category'
);

RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'b2400000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT lives_ok($sql$
  SELECT public.set_authenticated_pharmacy_notification_preferences(
    '{"owner_email":"owner@digest.stocmed.invalid","search_digest_email_opt_in":true}'::JSONB
  )
$sql$, 'pharmacy owner can explicitly re-enable the daily demand email');
SELECT is(
  (SELECT count(*) FROM public.email_suppressions
   WHERE user_id = 'b2400000-0000-4000-8000-000000000002'
     AND category = 'search_digest'),
  0::BIGINT,
  'explicit settings opt-in clears only the search-demand suppression'
);

RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'b2400000-0000-4000-8000-000000000003', TRUE);
END $$;
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.sqlstate_for($sql$
    INSERT INTO public.broadcasts(
      subject, body_markdown, template, audience, created_by
    ) VALUES (
      'Forbidden', 'Direct client write', 'custom', '{"kind":"all_patients"}',
      'b2400000-0000-4000-8000-000000000003'
    )
  $sql$),
  '42501',
  'direct authenticated broadcast insert is denied'
);
SELECT is(
  pg_temp.sqlstate_for('SELECT count(*) FROM public.broadcasts'),
  '42501',
  'non-admin cannot read broadcast history directly'
);
SELECT is(
  pg_temp.sqlstate_for('SELECT count(*) FROM public.broadcast_recipients'),
  '42501',
  'non-admin cannot read per-recipient delivery history directly'
);

RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'b2400000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT is(
  pg_temp.sqlstate_for('SELECT count(*) FROM public.broadcasts'),
  '42501',
  'authorized admin still uses the server boundary for broadcast history'
);
SELECT is(
  pg_temp.sqlstate_for('SELECT count(*) FROM public.broadcast_recipients'),
  '42501',
  'authorized admin still uses the server boundary for recipient history'
);

SELECT * FROM finish();
ROLLBACK;

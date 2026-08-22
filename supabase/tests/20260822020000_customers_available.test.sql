BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT plan(12);

SELECT has_table('public', 'customers', 'customers table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.customers'::regclass),
  'customers has RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.customers', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.customers', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.customers', 'DELETE'),
  'authenticated callers cannot write customers directly'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.save_authenticated_customer(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.delete_authenticated_customer(uuid)', 'EXECUTE'),
  'bounded customer write RPCs are executable'
);

UPDATE public.pharmacy_features SET
  is_enabled = TRUE,
  enabled_at = NOW(),
  enabled_by = pharmacy.user_id
FROM public.pharmacies pharmacy
WHERE pharmacy.id = pharmacy_features.pharmacy_id
  AND pharmacy_features.feature_key = 'customers';

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.save_authenticated_customer('{"name":"Ada Okafor","phone":"+2348030000000","consent_whatsapp":true}'::jsonb)$$,
  'owner creates a customer through the RPC'
);
SELECT is((SELECT count(*) FROM public.customers), 1::bigint, 'owner sees the customer');
SELECT is((SELECT name FROM public.customers LIMIT 1), 'Ada Okafor', 'saved customer fields are returned through RLS');

SELECT throws_ok(
  $$INSERT INTO public.customers(pharmacy_id,name) VALUES ('30000000-0000-4000-8000-000000000001','Bypass')$$,
  '42501', NULL,
  'direct customer insert is denied'
);

RESET ROLE;
UPDATE public.customers SET id = 'c6200000-0000-4000-8000-000000000001'
WHERE name = 'Ada Okafor';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.customers), 0::bigint, 'another pharmacy cannot see the customer');
SELECT throws_ok(
  $$SELECT public.save_authenticated_customer('{"id":"c6200000-0000-4000-8000-000000000001","name":"Forged"}'::jsonb)$$,
  'P0001', 'Customer not found',
  'another pharmacy cannot update a customer it does not own'
);

RESET ROLE;
UPDATE public.pharmacy_features SET is_enabled = FALSE, enabled_at = NULL, enabled_by = NULL
WHERE pharmacy_id = '30000000-0000-4000-8000-000000000001' AND feature_key = 'customers';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.save_authenticated_customer('{"name":"Feature bypass"}'::jsonb)$$,
  '42501', 'The customers feature is disabled',
  'feature off denies the customer write API'
);
SELECT is((SELECT count(*) FROM public.customers), 1::bigint, 'feature off preserves and still owner-scopes existing data');

SELECT * FROM finish();
ROLLBACK;

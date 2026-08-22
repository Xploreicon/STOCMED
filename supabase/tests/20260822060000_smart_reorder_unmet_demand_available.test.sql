BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres,service_role,authenticated;
SET LOCAL search_path=public,extensions,auth,pg_temp;
SELECT plan(8);

SELECT ok(has_function_privilege('authenticated','public.get_reorder_suggestions(uuid,integer)','EXECUTE'),'reorder suggestion read RPC is available');
SELECT ok(has_function_privilege('authenticated','public.get_unmet_demand(uuid,numeric,numeric,text)','EXECUTE'),'unmet demand read RPC is available');
SELECT ok(NOT has_table_privilege('authenticated','public.pharmacy_features','UPDATE'),'feature flags cannot be bypassed with direct writes');

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;

SELECT ok((public.set_authenticated_pharmacy_features('[{"feature_key":"smart_reorder","is_enabled":true}]',NULL)->>'success')::boolean,'smart reorder can be enabled through the feature RPC');
SELECT ok((SELECT is_enabled FROM public.pharmacy_features WHERE pharmacy_id='30000000-0000-4000-8000-000000000001' AND feature_key='purchase_orders_and_receiving'),'enabling smart reorder also enables procurement');
SELECT ok((public.set_authenticated_pharmacy_features('[{"feature_key":"purchase_orders_and_receiving","is_enabled":false}]',NULL)->>'success')::boolean,'procurement can be turned off through the feature RPC');
SELECT ok(NOT (SELECT is_enabled FROM public.pharmacy_features WHERE pharmacy_id='30000000-0000-4000-8000-000000000001' AND feature_key='smart_reorder'),'turning off procurement also hides smart reorder');
SELECT lives_ok(
  $$SELECT public.get_unmet_demand('30000000-0000-4000-8000-000000000001',NULL,NULL,'Lagos')$$,
  'existing unmet demand backend returns safely for the authenticated pharmacy'
);

SELECT * FROM finish();
ROLLBACK;

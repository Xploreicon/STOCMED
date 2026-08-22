BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres,service_role,authenticated;
SET LOCAL search_path=public,extensions,auth,pg_temp;
SELECT plan(27);

SELECT has_table('public','pharmacy_loyalty_config','loyalty configuration exists');
SELECT has_table('public','customer_loyalty_points','append-only points ledger exists');
SELECT ok(NOT has_table_privilege('authenticated','public.customer_loyalty_points','INSERT') AND NOT has_table_privilege('authenticated','public.pharmacy_loyalty_config','UPDATE'),'loyalty writes cannot bypass RPCs');
SELECT ok(has_function_privilege('authenticated','public.sync_pos_featured_sale_with_shift(uuid,jsonb)','EXECUTE'),'composed POS loyalty RPC is executable');

CREATE TEMP TABLE loyalty_fixture(customer_id UUID);
GRANT SELECT,INSERT ON loyalty_fixture TO authenticated;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT ok((public.set_authenticated_pharmacy_features('[{"feature_key":"loyalty","is_enabled":true}]',NULL)->>'success')::boolean,'loyalty enables through the feature RPC');
SELECT ok((SELECT is_enabled FROM public.pharmacy_features WHERE pharmacy_id='30000000-0000-4000-8000-000000000001' AND feature_key='customers'),'enabling loyalty also enables customers');
INSERT INTO loyalty_fixture SELECT (public.save_authenticated_customer('{"name":"Loyal Customer","phone":"+2348034444444"}')->>'id')::UUID;
SELECT is((SELECT count(*) FROM public.customers WHERE id=(SELECT customer_id FROM loyalty_fixture)),1::bigint,'customer is created through the bounded customer RPC');
SELECT ok((public.set_loyalty_config(0.1,1,100)->>'success')::boolean,'earning and redemption rules are configurable');
SELECT lives_ok($$SELECT public.sync_shift_open('c6800000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,NOW())$$,'cashier opens a loyalty sale shift');
SELECT lives_ok($$SELECT public.sync_pos_featured_sale_with_shift(
  '30000000-0000-4000-8000-000000000001',jsonb_build_object(
    'id','c6800000-0000-4000-8000-000000000002','shift_id','c6800000-0000-4000-8000-000000000001',
    'customer_id',(SELECT customer_id FROM loyalty_fixture),'discount',0,'manual_discount',0,
    'loyalty_points_redeemed',0,'payment_method','cash','created_at',NOW(),
    'items',jsonb_build_array(jsonb_build_object('inventory_id','40000000-0000-4000-8000-000000000001','batch_id','50000000-0000-4000-8000-000000000001','quantity',1))
  ))$$,'first qualifying sale completes atomically');
SELECT is((SELECT loyalty_points_earned FROM public.sales WHERE id='c6800000-0000-4000-8000-000000000002'),150,'sale earns configured points');
SELECT is((public.get_customer_loyalty((SELECT customer_id FROM loyalty_fixture))->>'balance')::integer,150,'customer balance reflects earned points');
SELECT throws_ok($$SELECT public.sync_pos_featured_sale_with_shift(
  '30000000-0000-4000-8000-000000000001',jsonb_build_object(
    'id','c6800000-0000-4000-8000-000000000003','shift_id','c6800000-0000-4000-8000-000000000001',
    'customer_id',(SELECT customer_id FROM loyalty_fixture),'discount',999999,'manual_discount',0,
    'loyalty_discount',999999,'loyalty_points_redeemed',999999,'payment_method','cash','created_at',NOW(),
    'items',jsonb_build_array(jsonb_build_object('inventory_id','40000000-0000-4000-8000-000000000001','batch_id','50000000-0000-4000-8000-000000000001','quantity',1))
  ))$$,'P0001','Customer loyalty balance changed. Refresh it and try again','overspending points is rejected before stock changes');
SELECT is((SELECT count(*) FROM public.sales WHERE id='c6800000-0000-4000-8000-000000000003'),0::bigint,'invalid redemption leaves no partial sale');
SELECT lives_ok($$SELECT public.sync_pos_featured_sale_with_shift(
  '30000000-0000-4000-8000-000000000001',jsonb_build_object(
    'id','c6800000-0000-4000-8000-000000000004','shift_id','c6800000-0000-4000-8000-000000000001',
    'customer_id',(SELECT customer_id FROM loyalty_fixture),'discount',150,'manual_discount',50,
    'loyalty_discount',100,'loyalty_points_redeemed',100,'payment_method','cash','created_at',NOW(),
    'items',jsonb_build_array(jsonb_build_object('inventory_id','40000000-0000-4000-8000-000000000001','batch_id','50000000-0000-4000-8000-000000000001','quantity',1))
  ))$$,'valid redemption and sale complete in one transaction');
SELECT is((SELECT total FROM public.sales WHERE id='c6800000-0000-4000-8000-000000000004'),1350::numeric,'points reduce the authoritative sale total after the normal discount');
SELECT is((public.get_customer_loyalty((SELECT customer_id FROM loyalty_fixture))->>'balance')::integer,185,'redemption and new earning update the running balance');
SELECT is((public.get_loyalty_report(CURRENT_DATE-1,CURRENT_DATE)->'summary'->>'points_issued')::integer,285,'report totals points issued');
SELECT is((public.get_loyalty_report(CURRENT_DATE-1,CURRENT_DATE)->'summary'->>'points_redeemed')::integer,100,'report totals points redeemed');
SELECT is((public.get_loyalty_report(CURRENT_DATE-1,CURRENT_DATE)->'summary'->>'outstanding')::integer,185,'report totals outstanding liability');
SELECT lives_ok($$SELECT public.reverse_completed_sale('30000000-0000-4000-8000-000000000001','c6800000-0000-4000-8000-000000000004','refund','Customer returned the order',NULL)$$,'refund completes through the existing guarded reversal RPC');
SELECT is((public.get_customer_loyalty((SELECT customer_id FROM loyalty_fixture))->>'balance')::integer,150,'refund restores redeemed points and reverses points earned by that sale');
SELECT is((SELECT count(*) FROM public.customer_loyalty_points WHERE sale_id='c6800000-0000-4000-8000-000000000004'),4::bigint,'reversal ledger entries are append-only and auditable');
SELECT is((public.get_loyalty_report(CURRENT_DATE-1,CURRENT_DATE)->'summary'->>'outstanding')::integer,150,'outstanding report reflects the refund reconciliation');

RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.customer_loyalty_points),0::bigint,'another pharmacy cannot see loyalty entries');

RESET ROLE;
UPDATE public.pharmacy_features SET is_enabled=FALSE,enabled_at=NULL,enabled_by=NULL WHERE pharmacy_id='30000000-0000-4000-8000-000000000001' AND feature_key='loyalty';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.get_customer_loyalty((SELECT customer_id FROM loyalty_fixture))$$,'42501','The loyalty feature is disabled','feature off denies loyalty APIs');
SELECT is((SELECT count(*) FROM public.customer_loyalty_points),5::bigint,'feature off preserves loyalty history');

SELECT * FROM finish();
ROLLBACK;

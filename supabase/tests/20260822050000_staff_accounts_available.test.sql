BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres,service_role,authenticated;
SET LOCAL search_path=public,extensions,auth,pg_temp;
SELECT plan(20);

SELECT has_table('public','pharmacy_staff','staff table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.pharmacy_staff'::regclass),'staff rows have RLS');
SELECT ok(
  NOT has_table_privilege('authenticated','public.pharmacy_staff','INSERT')
  AND NOT has_table_privilege('authenticated','public.pharmacy_staff','UPDATE'),
  'authenticated callers cannot write staff rows directly'
);
SELECT ok(
  NOT has_column_privilege('authenticated','public.pharmacy_staff','pin_hash','SELECT')
  AND NOT has_table_privilege('authenticated','public.pharmacy_staff_sessions','SELECT'),
  'PIN hashes and sessions are not readable through the API'
);
SELECT ok(has_function_privilege('authenticated','public.authenticate_pharmacy_staff(uuid,text)','EXECUTE'),'bounded PIN authentication RPC is executable');

UPDATE public.pharmacy_features SET is_enabled=TRUE,enabled_at=NOW(),enabled_by=pharmacy.user_id
FROM public.pharmacies pharmacy
WHERE pharmacy.id=pharmacy_features.pharmacy_id AND pharmacy_features.feature_key='staff_accounts';

CREATE TEMP TABLE staff_fixture(staff_id UUID,token TEXT);
GRANT SELECT,INSERT,UPDATE ON staff_fixture TO authenticated;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;

INSERT INTO staff_fixture(staff_id)
SELECT (public.save_authenticated_staff(
  '{"name":"Amaka Cashier","role":"cashier","permissions":{"can_sell":true,"can_adjust_stock":false,"can_view_reports":true,"can_change_prices":false,"can_refund":false}}',
  '2468',NULL
)->'staff'->>'id')::UUID;
SELECT is((SELECT count(*) FROM public.pharmacy_staff),1::bigint,'owner creates and sees a staff account');

SELECT lives_ok($$SELECT public.authenticate_pharmacy_staff((SELECT staff_id FROM staff_fixture),'0000')$$,'first bad PIN is handled without leaking details');
SELECT lives_ok($$SELECT public.authenticate_pharmacy_staff((SELECT staff_id FROM staff_fixture),'0000')$$,'second bad PIN is handled');
SELECT lives_ok($$SELECT public.authenticate_pharmacy_staff((SELECT staff_id FROM staff_fixture),'0000')$$,'third bad PIN is handled');
SELECT lives_ok($$SELECT public.authenticate_pharmacy_staff((SELECT staff_id FROM staff_fixture),'0000')$$,'fourth bad PIN is handled');
SELECT is((public.authenticate_pharmacy_staff((SELECT staff_id FROM staff_fixture),'0000')->>'code'),'STAFF_PIN_LOCKED','fifth bad PIN locks the account');
SELECT is((public.authenticate_pharmacy_staff((SELECT staff_id FROM staff_fixture),'2468')->>'code'),'STAFF_PIN_LOCKED','correct PIN remains blocked during lockout');
SELECT public.reset_authenticated_staff_pin((SELECT staff_id FROM staff_fixture),'1357',NULL);
UPDATE staff_fixture SET token=(public.authenticate_pharmacy_staff(staff_id,'1357')->>'token');
SELECT ok(length((SELECT token FROM staff_fixture))>=32,'PIN reset clears lockout and creates an opaque session');
SELECT ok((public.authorize_staff_permission((SELECT token FROM staff_fixture),'can_sell')->>'allowed')::boolean,'allowed permission succeeds');
SELECT ok(NOT (public.authorize_staff_permission((SELECT token FROM staff_fixture),'can_refund')->>'allowed')::boolean,'missing permission is denied');

SELECT public.sync_shift_open('c6500000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,NOW());
SELECT lives_ok($$SELECT public.sync_pos_staff_sale_with_shift(
  '30000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'id','c6500000-0000-4000-8000-000000000002','shift_id','c6500000-0000-4000-8000-000000000001',
    'staff_session_token',(SELECT token FROM staff_fixture),'discount',0,'payment_method','cash','created_at',NOW(),
    'items',jsonb_build_array(jsonb_build_object(
      'inventory_id','40000000-0000-4000-8000-000000000001',
      'batch_id','50000000-0000-4000-8000-000000000001','quantity',1
    ))
  )
)$$,'staff sale completes through the authoritative POS wrapper');
SELECT is((SELECT staff_id FROM public.sales WHERE id='c6500000-0000-4000-8000-000000000002'),(SELECT staff_id FROM staff_fixture),'sale is attributed to the authenticated staff member');
SELECT is(((public.get_staff_performance(CURRENT_DATE-1,CURRENT_DATE)->'by_staff'->0->>'sale_count')::integer),1,'staff report includes the attributed sale');

RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.pharmacy_staff),0::bigint,'another pharmacy cannot see staff accounts');

RESET ROLE;
UPDATE public.pharmacy_features SET is_enabled=FALSE,enabled_at=NULL,enabled_by=NULL
WHERE pharmacy_id='30000000-0000-4000-8000-000000000001' AND feature_key='staff_accounts';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.authenticate_pharmacy_staff((SELECT staff_id FROM staff_fixture),'1357')$$,
  '42501','The staff accounts feature is disabled','feature off denies new staff authentication'
);

SELECT * FROM finish();
ROLLBACK;

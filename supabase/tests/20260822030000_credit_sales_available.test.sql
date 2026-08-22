BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT plan(16);

SELECT has_table('public','customer_credit_ledger','credit ledger exists');
SELECT has_table('public','customer_credit_limits','credit limits exist');
SELECT ok(
  NOT has_table_privilege('authenticated','public.customer_credit_ledger','INSERT')
  AND NOT has_table_privilege('authenticated','public.customer_credit_limits','UPDATE'),
  'credit tables deny direct authenticated writes'
);
SELECT ok(
  has_function_privilege('authenticated','public.sync_pos_credit_sale_with_shift(uuid,jsonb)','EXECUTE'),
  'bounded credit POS RPC is executable'
);

UPDATE public.pharmacy_features SET is_enabled=TRUE,enabled_at=NOW(),enabled_by=pharmacy.user_id
FROM public.pharmacies pharmacy
WHERE pharmacy.id=pharmacy_features.pharmacy_id
  AND pharmacy_features.feature_key IN ('customers','credit_sales');

CREATE TEMP TABLE credit_fixture(customer_id UUID);
GRANT SELECT, INSERT ON credit_fixture TO authenticated;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;

INSERT INTO credit_fixture
SELECT (public.save_authenticated_customer('{"name":"Credit Test Customer","phone":"+2348031111111"}'::jsonb)->>'id')::UUID;
SELECT lives_ok(
  $$SELECT public.set_customer_credit_limit((SELECT customer_id FROM credit_fixture),2000,NULL)$$,
  'owner sets a credit limit through the RPC'
);
SELECT lives_ok(
  $$SELECT public.sync_shift_open('c6300000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,NOW())$$,
  'cashier opens the credit-sale shift'
);
SELECT lives_ok(
  $$SELECT public.sync_pos_credit_sale_with_shift(
    '30000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id','c6300000-0000-4000-8000-000000000002',
      'pharmacy_id','30000000-0000-4000-8000-000000000001',
      'cashier_id','10000000-0000-4000-8000-000000000001',
      'shift_id','c6300000-0000-4000-8000-000000000001',
      'customer_id',(SELECT customer_id FROM credit_fixture),
      'discount',0,'payment_method','credit','created_at',NOW(),
      'items',jsonb_build_array(jsonb_build_object(
        'inventory_id','40000000-0000-4000-8000-000000000001',
        'batch_id','50000000-0000-4000-8000-000000000001','quantity',1
      ))
    )
  )$$,
  'credit sale posts atomically through POS'
);
SELECT is((SELECT SUM(amount) FROM public.customer_credit_ledger),1500::numeric,'credit sale creates the outstanding balance');
SELECT is((SELECT customer_id FROM public.sales WHERE id='c6300000-0000-4000-8000-000000000002'),(SELECT customer_id FROM credit_fixture),'sale is attributed to the customer');

SELECT throws_ok(
  $$SELECT public.sync_pos_credit_sale_with_shift(
    '30000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id','c6300000-0000-4000-8000-000000000003','shift_id','c6300000-0000-4000-8000-000000000001',
      'customer_id',(SELECT customer_id FROM credit_fixture),'discount',0,
      'payment_method','credit','created_at',NOW(),
      'items',jsonb_build_array(jsonb_build_object(
        'inventory_id','40000000-0000-4000-8000-000000000001',
        'batch_id','50000000-0000-4000-8000-000000000001','quantity',1
      ))
    )
  )$$,
  'P0001',NULL,'credit limit rejects a sale that would exceed it'
);
SELECT is((SELECT count(*) FROM public.sales WHERE id='c6300000-0000-4000-8000-000000000003'),0::bigint,'rejected credit sale rolls back the sale and stock write');

SELECT lives_ok(
  $$SELECT public.record_customer_credit_adjustment((SELECT customer_id FROM credit_fixture),'payment',500,'Part payment','credit-test-payment',NULL)$$,
  'part payment posts through the ledger RPC'
);
SELECT is((SELECT balance_after FROM public.customer_credit_ledger WHERE entry_type='payment'),1000::numeric,'part payment updates running balance');
SELECT is(((public.get_customer_credit_report(CURRENT_DATE-1,CURRENT_DATE)->'summary'->>'outstanding')::numeric),1000::numeric,'credit report returns outstanding balance');

RESET ROLE;
UPDATE public.pharmacy_features SET is_enabled=FALSE,enabled_at=NULL,enabled_by=NULL
WHERE pharmacy_id='30000000-0000-4000-8000-000000000001' AND feature_key='credit_sales';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.record_customer_credit_adjustment((SELECT customer_id FROM credit_fixture),'payment',100,'','feature-off-payment',NULL)$$,
  '42501','The credit sales feature is disabled','feature off denies credit writes'
);
SELECT is((SELECT count(*) FROM public.customer_credit_ledger),2::bigint,'feature off preserves credit history');

SELECT * FROM finish();
ROLLBACK;

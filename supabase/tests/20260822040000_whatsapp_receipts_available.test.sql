BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
SET LOCAL search_path=public,extensions,auth,pg_temp;
SELECT plan(10);

SELECT ok(has_function_privilege('authenticated','public.log_whatsapp_receipt_share(uuid)','EXECUTE'),'share log RPC is executable');
SELECT ok(
  NOT has_table_privilege('authenticated','public.notification_deliveries','INSERT'),
  'delivery audit still denies direct writes'
);
-- Test-only visibility for audit assertions; the enclosing rollback removes it.
GRANT SELECT ON public.notification_deliveries TO authenticated;
CREATE POLICY whatsapp_test_audit_select ON public.notification_deliveries
FOR SELECT TO authenticated USING (TRUE);

UPDATE public.pharmacy_features SET is_enabled=TRUE,enabled_at=NOW(),enabled_by=pharmacy.user_id
FROM public.pharmacies pharmacy
WHERE pharmacy.id=pharmacy_features.pharmacy_id
  AND pharmacy_features.feature_key IN ('customers','whatsapp_receipts');
CREATE TEMP TABLE whatsapp_fixture(customer_id UUID);
GRANT SELECT,INSERT ON whatsapp_fixture TO authenticated;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;

INSERT INTO whatsapp_fixture
SELECT (public.save_authenticated_customer('{"name":"WhatsApp Customer","phone":"+2348032222222","consent_whatsapp":true}'::jsonb)->>'id')::UUID;
SELECT public.sync_shift_open('c6400000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,NOW());
SELECT lives_ok(
  $$SELECT public.sync_pos_sale_with_shift(
    '30000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id','c6400000-0000-4000-8000-000000000002','shift_id','c6400000-0000-4000-8000-000000000001',
      'discount',0,'payment_method','cash','created_at',NOW(),
      'items',jsonb_build_array(jsonb_build_object(
        'inventory_id','40000000-0000-4000-8000-000000000001',
        'batch_id','50000000-0000-4000-8000-000000000001','quantity',1
      ))
    )
  )$$,
  'sale completes before sharing'
);
SELECT public.attach_authenticated_sale_customer('c6400000-0000-4000-8000-000000000002',(SELECT customer_id FROM whatsapp_fixture));
SELECT lives_ok(
  $$SELECT public.log_whatsapp_receipt_share('c6400000-0000-4000-8000-000000000002')$$,
  'consented customer receipt share is logged'
);
SELECT is((SELECT channel FROM public.notification_deliveries WHERE idempotency_key='whatsapp-receipt:c6400000-0000-4000-8000-000000000002'),'whatsapp','audit records WhatsApp channel');
SELECT is((SELECT status FROM public.notification_deliveries WHERE idempotency_key='whatsapp-receipt:c6400000-0000-4000-8000-000000000002'),'initiated','audit records initiation status');
SELECT lives_ok(
  $$SELECT public.log_whatsapp_receipt_share('c6400000-0000-4000-8000-000000000002')$$,
  'repeat tap is idempotent'
);
SELECT is((SELECT count(*) FROM public.notification_deliveries WHERE idempotency_key='whatsapp-receipt:c6400000-0000-4000-8000-000000000002'),1::bigint,'repeat tap does not duplicate audit rows');

RESET ROLE;
UPDATE public.pharmacy_features SET is_enabled=FALSE,enabled_at=NULL,enabled_by=NULL
WHERE pharmacy_id='30000000-0000-4000-8000-000000000001' AND feature_key='whatsapp_receipts';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.log_whatsapp_receipt_share('c6400000-0000-4000-8000-000000000002')$$,
  '42501','The WhatsApp receipts feature is disabled','feature off denies share audit API'
);
SELECT is((SELECT count(*) FROM public.notification_deliveries),1::bigint,'feature off preserves audit history');

SELECT * FROM finish();
ROLLBACK;

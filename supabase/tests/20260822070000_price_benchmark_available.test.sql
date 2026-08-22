BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres,service_role,authenticated;
SET LOCAL search_path=public,extensions,auth,pg_temp;
SELECT plan(13);

SELECT ok(has_function_privilege('authenticated','public.get_local_price_benchmark(uuid)','EXECUTE'),'benchmark read RPC is available');
SELECT ok(has_function_privilege('authenticated','public.set_price_benchmark_radius(numeric)','EXECUTE'),'radius settings write RPC is available');
SELECT ok(NOT has_table_privilege('authenticated','public.pharmacy_features','UPDATE'),'benchmark settings cannot bypass the feature RPC');

UPDATE public.pharmacies SET latitude=6.5244,longitude=3.3792 WHERE id='30000000-0000-4000-8000-000000000001';
INSERT INTO public.pharmacies(id,pharmacy_name,license_number,address,city,state,phone,is_active,latitude,longitude) VALUES
  ('37000000-0000-4000-8000-000000000001','Peer One','910001','1 Peer Street','Lagos','Lagos','+2348010000001',TRUE,6.5245,3.3793),
  ('37000000-0000-4000-8000-000000000002','Peer Two','910002','2 Peer Street','Lagos','Lagos','+2348010000002',TRUE,6.5250,3.3800),
  ('37000000-0000-4000-8000-000000000003','Peer Three','910003','3 Peer Street','Lagos','Lagos','+2348010000003',TRUE,6.5260,3.3810),
  ('37000000-0000-4000-8000-000000000004','Hidden Peer','910004','4 Peer Street','Lagos','Lagos','+2348010000004',FALSE,6.5246,3.3794);
INSERT INTO public.pharmacy_inventory(id,pharmacy_id,product_id,price,quantity_in_stock,is_listed)
SELECT fixture.id,fixture.pharmacy_id,owner.product_id,fixture.price,10,TRUE
FROM public.pharmacy_inventory owner CROSS JOIN (VALUES
  ('47000000-0000-4000-8000-000000000001'::uuid,'37000000-0000-4000-8000-000000000001'::uuid,1000::numeric),
  ('47000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000002',2000),
  ('47000000-0000-4000-8000-000000000004','37000000-0000-4000-8000-000000000004',50)
) fixture(id,pharmacy_id,price)
WHERE owner.id='40000000-0000-4000-8000-000000000001';

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT ok((public.set_authenticated_pharmacy_features('[{"feature_key":"price_benchmark","is_enabled":true}]',NULL)->>'success')::boolean,'price benchmark feature enables through the feature RPC');
SELECT is((public.get_local_price_benchmark('40000000-0000-4000-8000-000000000001')->>'code'),'PRIVACY_THRESHOLD','two visible peers do not pass the privacy threshold');

RESET ROLE;
INSERT INTO public.pharmacy_inventory(id,pharmacy_id,product_id,price,quantity_in_stock,is_listed)
SELECT '47000000-0000-4000-8000-000000000003','37000000-0000-4000-8000-000000000003',product_id,3000,10,TRUE
FROM public.pharmacy_inventory WHERE id='40000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT ok((public.get_local_price_benchmark('40000000-0000-4000-8000-000000000001')->>'available')::boolean,'three visible peers unlock aggregate guidance');
SELECT is((public.get_local_price_benchmark('40000000-0000-4000-8000-000000000001')->>'peer_count')::integer,3,'inactive pharmacies are excluded from the peer count');
SELECT is((public.get_local_price_benchmark('40000000-0000-4000-8000-000000000001')->>'local_average')::numeric,2000::numeric,'local average is anonymous and accurate');
SELECT is((public.get_local_price_benchmark('40000000-0000-4000-8000-000000000001')->>'local_min')::numeric,1000::numeric,'local minimum is accurate');
SELECT is((public.get_local_price_benchmark('40000000-0000-4000-8000-000000000001')->>'local_max')::numeric,3000::numeric,'local maximum is accurate');
SELECT is((public.set_price_benchmark_radius(10)->>'radius_km')::numeric,10::numeric,'owner can configure the radius through the RPC');

RESET ROLE;
UPDATE public.pharmacy_features SET is_enabled=TRUE,enabled_at=NOW(),enabled_by='10000000-0000-4000-8000-000000000002'
WHERE pharmacy_id='30000000-0000-4000-8000-000000000002' AND feature_key='price_benchmark';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.get_local_price_benchmark('40000000-0000-4000-8000-000000000001')$$,
  'P0001','Inventory item not found','another pharmacy cannot benchmark an inventory row it does not own'
);

RESET ROLE;
UPDATE public.pharmacy_features SET is_enabled=FALSE,enabled_at=NULL,enabled_by=NULL
WHERE pharmacy_id='30000000-0000-4000-8000-000000000001' AND feature_key='price_benchmark';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',TRUE);
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.get_local_price_benchmark('40000000-0000-4000-8000-000000000001')$$,
  '42501','The price benchmark feature is disabled','feature off denies the benchmark API'
);

SELECT * FROM finish();
ROLLBACK;

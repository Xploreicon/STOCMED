-- Run after migrations and supabase/seed.sql in a disposable database.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion failed: %', message;
  END IF;
END $$;

SELECT pg_temp.assert_true(
  (SELECT column_default LIKE '%30 days%'
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'pharmacies'
     AND column_name = 'provisional_expires_at'),
  'new pharmacy provisional default is not 30 days'
);

-- A mismatched cashier/pharmacy pair must fail even if SQL bypasses the API.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.sales (
      id, pharmacy_id, cashier_id, subtotal, discount, total,
      payment_method, status
    ) VALUES (
      '99000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      100, 0, 100, 'cash', 'pending'
    );
    RAISE EXCEPTION 'cross-pharmacy sale unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-pharmacy sale unexpectedly succeeded' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Sale pharmacy must match%' THEN RAISE; END IF;
  END;
END $$;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.sales
    WHERE id = '99000000-0000-4000-8000-000000000001'
  ),
  'rejected cross-pharmacy sale persisted'
);

-- The registration RPC is idempotent for retries by the same account/PCN.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  TRUE
);
SELECT set_config('request.jwt.claim.role', 'authenticated', TRUE);

SELECT pg_temp.assert_true(
  (public.register_provisional_pharmacy(
    'StocMed Test Pharmacy', '900001', '1 Test Street',
    'Ikeja', 'Lagos', '08000000001'
  )).id = '30000000-0000-4000-8000-000000000001'::UUID,
  'idempotent registration did not return the existing pharmacy'
);

RESET ROLE;
ROLLBACK;


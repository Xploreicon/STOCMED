BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.pharmacies', 'sp_code_hash', 'SELECT'),
  'authenticated still cannot select the SP hash'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.pharmacies', 'sp_failed_attempts', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.pharmacies', 'sp_locked_until', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.pharmacies', 'sp_discount_threshold', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.pharmacies', 'sp_grace_minutes', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.pharmacies', 'sp_require_financial_reports', 'SELECT'),
  'authenticated still cannot select SP lockout, threshold, or config columns'
);

SELECT ok(
  NOT has_column_privilege('anon', 'public.pharmacies', 'sp_code_hash', 'SELECT'),
  'anon still cannot select the SP hash'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-8000-000000000001',
    TRUE
  );
END
$$;
SET LOCAL ROLE authenticated;

SELECT is(
  public.get_authenticated_pharmacy_profile()->>'id',
  '30000000-0000-4000-8000-000000000001',
  'owner profile resolves from auth.uid()'
);

SELECT ok(
  NOT public.get_authenticated_pharmacy_profile() ?| ARRAY[
    'sp_code_hash',
    'sp_failed_attempts',
    'sp_locked_until',
    'sp_discount_threshold',
    'sp_grace_minutes',
    'sp_require_financial_reports',
    'reservation_hold_minutes',
    'verification_authorization_basis'
  ],
  'owner profile RPC returns no private pharmacy fields'
);

SELECT lives_ok(
  $$SELECT inventory.id, batch.id
    FROM public.pharmacy_inventory AS inventory
    LEFT JOIN public.batches AS batch ON batch.inventory_id = inventory.id
    WHERE inventory.pharmacy_id = '30000000-0000-4000-8000-000000000001'$$,
  'owner inventory read with embedded batches no longer raises 42501'
);

SELECT throws_ok(
  $$SELECT sp_code_hash FROM public.pharmacies LIMIT 1$$,
  '42501',
  'permission denied for table pharmacies',
  'direct authenticated SP hash read remains denied'
);

SELECT is(
  public.get_authenticated_pharmacy_profile()->>'user_id',
  '10000000-0000-4000-8000-000000000001',
  'owner profile cannot be redirected to another tenant by client input'
);

RESET ROLE;

SET LOCAL ROLE anon;
SELECT lives_ok(
  $$SELECT inventory.id, batch.expiry_date
    FROM public.pharmacy_inventory AS inventory
    LEFT JOIN public.batches AS batch ON batch.inventory_id = inventory.id
    WHERE inventory.item_type = 'medicine'
      AND inventory.is_listed = TRUE
      AND inventory.deleted_at IS NULL$$,
  'anonymous public inventory read with embedded batches no longer raises 42501'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

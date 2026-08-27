BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT plan(14);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'f2900000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'prompt4-owner@stocmed.invalid',
    '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f2900000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'prompt4-other@stocmed.invalid',
    '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
  );

-- The preview branch retains the original UUID users.id shape, while a fresh
-- local migration chain uses the later identity column. Keep the fixture valid
-- on both schemas without changing the production function contract.
DO $fixture$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'id'
      AND data_type = 'uuid'
  ) THEN
    INSERT INTO public.users (id, user_id, email, full_name, phone, role) VALUES
      (
        'f2900000-0000-4000-8000-000000000001',
        'f2900000-0000-4000-8000-000000000001',
        'prompt4-owner@stocmed.invalid', 'Prompt 4 Owner', '+2348000000291', 'pharmacy'
      ),
      (
        'f2900000-0000-4000-8000-000000000002',
        'f2900000-0000-4000-8000-000000000002',
        'prompt4-other@stocmed.invalid', 'Prompt 4 Other', '+2348000000292', 'pharmacy'
      );
  ELSE
    INSERT INTO public.users (user_id, email, full_name, phone, role) VALUES
      (
        'f2900000-0000-4000-8000-000000000001',
        'prompt4-owner@stocmed.invalid', 'Prompt 4 Owner', '+2348000000291', 'pharmacy'
      ),
      (
        'f2900000-0000-4000-8000-000000000002',
        'prompt4-other@stocmed.invalid', 'Prompt 4 Other', '+2348000000292', 'pharmacy'
      );
  END IF;
END
$fixture$;

INSERT INTO public.pharmacies (
  id, user_id, pharmacy_name, license_number, address, city, state, phone, is_active
) VALUES (
  'f2910000-0000-4000-8000-000000000001',
  'f2900000-0000-4000-8000-000000000001',
  'Prompt 4 Test Pharmacy', '9024291',
  '4 Stage Street', 'Ikeja', 'Lagos', '+2348000000291', TRUE
);

SELECT has_function(
  'public',
  'stage_import_job',
  ARRAY['uuid', 'jsonb'],
  'stage import RPC exists'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.stage_import_job(uuid,jsonb)'::regprocedure),
  'stage import RPC is SECURITY DEFINER'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.stage_import_job(uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.stage_import_job(uuid,jsonb)', 'EXECUTE'),
  'authenticated callers can stage while anonymous callers cannot'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f2900000-0000-4000-8000-000000000001', TRUE);
END
$$;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.stage_import_job(
    'f2910000-0000-4000-8000-000000000001',
    '[
      {
        "source_row_number": 2,
        "raw_name": "Prompt 4 Exact",
        "norm_name": "prompt 4 exact",
        "barcode": "12345678",
        "cost_kobo": 1000,
        "price_kobo": 1500,
        "qty": 4,
        "min_qty": 1,
        "expiry": "2028-12-31"
      },
      {
        "source_row_number": 3,
        "raw_name": "Prompt 4 Error",
        "norm_name": "prompt 4 error",
        "parse_error": "column_shift"
      }
    ]'::jsonb
  )$$,
  'owner can atomically stage normalized rows'
);
RESET ROLE;

SELECT is(
  (SELECT COUNT(*) FROM public.import_jobs WHERE pharmacy_id = 'f2910000-0000-4000-8000-000000000001'),
  1::BIGINT,
  'one import job is created'
);
SELECT is(
  (SELECT total_rows FROM public.import_jobs WHERE pharmacy_id = 'f2910000-0000-4000-8000-000000000001'),
  2,
  'job total is derived from the JSON array'
);
SELECT is(
  (SELECT parsed_rows FROM public.import_jobs WHERE pharmacy_id = 'f2910000-0000-4000-8000-000000000001'),
  1,
  'parser errors are excluded from parsed rows'
);
SELECT is(
  (SELECT error_rows FROM public.import_jobs WHERE pharmacy_id = 'f2910000-0000-4000-8000-000000000001'),
  1,
  'parser errors are counted on the job'
);
SELECT is(
  (SELECT COUNT(*) FROM public.import_staging WHERE job_id = (
    SELECT id FROM public.import_jobs WHERE pharmacy_id = 'f2910000-0000-4000-8000-000000000001'
  )),
  2::BIGINT,
  'all normalized rows are staged'
);
SELECT is(
  (SELECT ARRAY_AGG(source_row_number ORDER BY source_row_number) FROM public.import_staging WHERE job_id = (
    SELECT id FROM public.import_jobs WHERE pharmacy_id = 'f2910000-0000-4000-8000-000000000001'
  )),
  ARRAY[2, 3],
  'source row numbers are retained deterministically'
);
SELECT is(
  (SELECT price_kobo FROM public.import_staging WHERE source_row_number = 2 AND job_id = (
    SELECT id FROM public.import_jobs WHERE pharmacy_id = 'f2910000-0000-4000-8000-000000000001'
  )),
  1500::BIGINT,
  'normalized integer Kobo is preserved'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f2900000-0000-4000-8000-000000000001', TRUE);
END
$$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.stage_import_job(
    'f2910000-0000-4000-8000-000000000001',
    '[
      {"source_row_number": 8, "raw_name": "One", "norm_name": "one"},
      {"source_row_number": 8, "raw_name": "Two", "norm_name": "two"}
    ]'::jsonb
  )$$,
  '23505', NULL,
  'duplicate source rows abort staging'
);
RESET ROLE;
SELECT is(
  (SELECT COUNT(*) FROM public.import_jobs WHERE pharmacy_id = 'f2910000-0000-4000-8000-000000000001'),
  1::BIGINT,
  'a failed staging call leaves no orphan job'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f2900000-0000-4000-8000-000000000002', TRUE);
END
$$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.stage_import_job(
    'f2910000-0000-4000-8000-000000000001',
    '[{"source_row_number": 9, "raw_name": "Forged", "norm_name": "forged"}]'::jsonb
  )$$,
  '42501', 'Not authorized for this pharmacy',
  'another tenant cannot stage against the owner pharmacy'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

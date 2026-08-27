BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT plan(24);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'f2800000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'prompt3-owner@stocmed.invalid',
    '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f2800000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'prompt3-other@stocmed.invalid',
    '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
  );

DO $fixture$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    INSERT INTO public.users (id, user_id, email, full_name, phone, role) VALUES
      ('f2800000-0000-4000-8000-000000000001', 'f2800000-0000-4000-8000-000000000001', 'prompt3-owner@stocmed.invalid', 'Prompt 3 Owner', '+2348000000281', 'pharmacy'),
      ('f2800000-0000-4000-8000-000000000002', 'f2800000-0000-4000-8000-000000000002', 'prompt3-other@stocmed.invalid', 'Prompt 3 Other', '+2348000000282', 'pharmacy');
  ELSE
    INSERT INTO public.users (user_id, email, full_name, phone, role) VALUES
      ('f2800000-0000-4000-8000-000000000001', 'prompt3-owner@stocmed.invalid', 'Prompt 3 Owner', '+2348000000281', 'pharmacy'),
      ('f2800000-0000-4000-8000-000000000002', 'prompt3-other@stocmed.invalid', 'Prompt 3 Other', '+2348000000282', 'pharmacy');
  END IF;
END
$fixture$;

INSERT INTO public.pharmacies (
  id, user_id, pharmacy_name, license_number, address, city, state, phone, is_active
) VALUES (
  'f2810000-0000-4000-8000-000000000001',
  'f2800000-0000-4000-8000-000000000001',
  'Prompt 3 Test Pharmacy', '9024281',
  '3 Set Street', 'Ikeja', 'Lagos', '+2348000000281', TRUE
);

INSERT INTO public.products (
  id, generic_name, brand_name, manufacturer, strength, dosage_form,
  category, pack_size, barcode, is_verified
) VALUES
  (
    'f2830000-0000-4000-8000-000000000001',
    'Promptthree Direct Molecule', 'Promptthree Directbrand', 'Test', '10mg',
    'tablet', 'Others', '10s', '89012345', TRUE
  ),
  (
    'f2830000-0000-4000-8000-000000000002',
    'Promptthree Cross Molecule', 'Promptthree Crossbrand', 'Test', '20mg',
    'tablet', 'Others', '10s', NULL, TRUE
  ),
  (
    'f2830000-0000-4000-8000-000000000003',
    'Promptthree Exact Molecule', 'Promptthree Exactbrand', 'Test', '30mg',
    'tablet', 'Others', '10s', NULL, TRUE
  ),
  (
    'f2830000-0000-4000-8000-000000000004',
    'Promptthree Fuzzy Molecule', 'Promptthree Fuzzybrand With Extended Name', 'Test', '40mg',
    'tablet', 'Others', '10s', NULL, TRUE
  ),
  (
    'f2830000-0000-4000-8000-000000000005',
    'Promptthree Review Molecule', 'Promptthree Reviewbrand', 'Test', '50mg',
    'tablet', 'Others', '10s', NULL, TRUE
  );

INSERT INTO public.barcode_catalogue_map (
  barcode, catalogue_id, confirmed_by, source
) VALUES (
  '123456789012',
  'f2830000-0000-4000-8000-000000000002',
  'f2800000-0000-4000-8000-000000000001',
  'review'
);

INSERT INTO public.import_jobs (
  id, pharmacy_id, status, total_rows, parsed_rows
) VALUES (
  'f2820000-0000-4000-8000-000000000001',
  'f2810000-0000-4000-8000-000000000001',
  'staging', 7, 7
);

INSERT INTO public.import_staging (
  job_id, source_row_number, raw_name, norm_name, barcode, parse_error
) VALUES
  ('f2820000-0000-4000-8000-000000000001', 2, 'Direct', 'direct', '89012345', NULL),
  ('f2820000-0000-4000-8000-000000000001', 3, 'Cross', 'cross', '123456789012', NULL),
  ('f2820000-0000-4000-8000-000000000001', 4, 'Promptthree Exactbrand 30mg', 'promptthree exactbrand', '1234567890123', NULL),
  ('f2820000-0000-4000-8000-000000000001', 5, 'Promptthree Fuzzybrand With Extended Nam', 'promptthree fuzzybrand with extended nam', '12345678901234', NULL),
  ('f2820000-0000-4000-8000-000000000001', 6, 'Promptthree Review', 'promptthree review', NULL, NULL),
  ('f2820000-0000-4000-8000-000000000001', 7, 'Breakfast Custard Milk', 'breakfast custard milk', NULL, NULL),
  ('f2820000-0000-4000-8000-000000000001', 8, 'Shifted Error', 'shifted error', NULL, 'column_shift');

SELECT has_function(
  'public',
  'match_import_job',
  ARRAY['uuid'],
  'bulk match RPC exists'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.match_import_job(uuid)'::regprocedure),
  'bulk match RPC is SECURITY DEFINER'
);
SELECT is(
  public.normalize_import_match_name('B. P ARENAX 80/480mg Pack of 4 X6'),
  'bp arenax',
  'SQL name normalization removes dose and pack tokens'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.match_import_job(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.match_import_job(uuid)', 'EXECUTE'),
  'only authenticated server roles can execute the RPC'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f2800000-0000-4000-8000-000000000001', TRUE);
END
$$;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.match_import_job('f2820000-0000-4000-8000-000000000001')$$,
  'the owning pharmacy can match the whole job in one RPC call'
);
RESET ROLE;

SELECT is(
  (SELECT tier FROM public.import_staging WHERE source_row_number = 2 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  'barcode_direct',
  'strict direct GTIN is the first tier'
);
SELECT is(
  (SELECT tier FROM public.import_staging WHERE source_row_number = 3 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  'barcode_crosswalk',
  'learned crosswalk is the second tier'
);
SELECT is(
  (SELECT tier FROM public.import_staging WHERE source_row_number = 4 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  'exact',
  'normalized brand equality resolves in the exact tier'
);
SELECT is(
  (SELECT matched_catalogue_id FROM public.import_staging WHERE source_row_number = 4 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  'f2830000-0000-4000-8000-000000000003'::UUID,
  'exact brand matching selects its catalogue row'
);
SELECT is(
  (SELECT tier FROM public.import_staging WHERE source_row_number = 5 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  'fuzzy',
  'two-column trigram matching resolves a near brand spelling'
);
SELECT ok(
  (SELECT confidence >= 0.90 FROM public.import_staging WHERE source_row_number = 5 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  'fuzzy confidence preserves the best trigram score'
);
SELECT is(
  (SELECT tier FROM public.import_staging WHERE source_row_number = 6 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  'fuzzy',
  'a sub-0.90 candidate remains in the fuzzy tier'
);
SELECT is(
  (SELECT match_status FROM public.import_staging WHERE source_row_number = 6 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  'review',
  'a sub-0.90 fuzzy candidate is held for review'
);
SELECT is(
  (SELECT match_status FROM public.import_staging WHERE source_row_number = 7 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  'unmatched',
  'non-drug text below threshold remains unmatched for Store'
);
SELECT is(
  (SELECT match_status FROM public.import_staging WHERE source_row_number = 8 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  'error',
  'parser errors are never catalogue matched'
);
SELECT is(
  (SELECT confidence FROM public.import_staging WHERE source_row_number = 2 AND job_id = 'f2820000-0000-4000-8000-000000000001'),
  1.0000::NUMERIC,
  'barcode confidence is one'
);
SELECT is(
  (SELECT COUNT(*) FROM public.barcode_catalogue_map WHERE source = 'name_match' AND barcode IN ('1234567890123', '12345678901234')),
  2::BIGINT,
  'high-confidence name matches write valid GTINs to the crosswalk'
);
SELECT is(
  (SELECT matched_rows FROM public.import_jobs WHERE id = 'f2820000-0000-4000-8000-000000000001'),
  4,
  'job matched count is updated from the set result'
);
SELECT is(
  (SELECT unmatched_rows FROM public.import_jobs WHERE id = 'f2820000-0000-4000-8000-000000000001'),
  1,
  'job unmatched count is updated from the set result'
);
SELECT is(
  (SELECT error_rows FROM public.import_jobs WHERE id = 'f2820000-0000-4000-8000-000000000001'),
  1,
  'job error count is updated from the set result'
);
SELECT is(
  (SELECT review_rows FROM public.import_jobs WHERE id = 'f2820000-0000-4000-8000-000000000001'),
  1,
  'sub-0.90 fuzzy candidates populate the review count'
);
SELECT is(
  (SELECT status FROM public.import_jobs WHERE id = 'f2820000-0000-4000-8000-000000000001'),
  'review',
  'a job with unresolved rows advances to review'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f2800000-0000-4000-8000-000000000002', TRUE);
END
$$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.match_import_job('f2820000-0000-4000-8000-000000000001')$$,
  '42501',
  'Not authorized for this import job',
  'another pharmacy cannot invoke matching for the owner job'
);
RESET ROLE;

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.match_catalogue_product_for_import(text,text,text,text)'
  ) IS NULL
  OR obj_description(
    pg_catalog.to_regprocedure(
      'public.match_catalogue_product_for_import(text,text,text,text)'
    ),
    'pg_proc'
  ) = 'Legacy per-row matcher. Keep for compatibility until Prompt 4, but do not use in new request paths; match_import_job(UUID) is the authoritative bulk matcher.',
  'legacy per-row matcher is absent or explicitly deprecated'
);

SELECT * FROM finish();
ROLLBACK;

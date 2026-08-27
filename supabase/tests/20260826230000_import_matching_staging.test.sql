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
    'f2600000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'matching-owner@stocmed.invalid',
    '', NOW(), '', '', '', '', '{}', '{}', NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f2600000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'matching-other@stocmed.invalid',
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
      ('f2600000-0000-4000-8000-000000000001', 'f2600000-0000-4000-8000-000000000001', 'matching-owner@stocmed.invalid', 'Matching Owner', '+2348000000261', 'pharmacy'),
      ('f2600000-0000-4000-8000-000000000002', 'f2600000-0000-4000-8000-000000000002', 'matching-other@stocmed.invalid', 'Matching Other', '+2348000000262', 'pharmacy');
  ELSE
    INSERT INTO public.users (user_id, email, full_name, phone, role) VALUES
      ('f2600000-0000-4000-8000-000000000001', 'matching-owner@stocmed.invalid', 'Matching Owner', '+2348000000261', 'pharmacy'),
      ('f2600000-0000-4000-8000-000000000002', 'matching-other@stocmed.invalid', 'Matching Other', '+2348000000262', 'pharmacy');
  END IF;
END
$fixture$;

INSERT INTO public.pharmacies (
  id, user_id, pharmacy_name, license_number, address, city, state, phone, is_active
) VALUES
  (
    'f2610000-0000-4000-8000-000000000001',
    'f2600000-0000-4000-8000-000000000001',
    'Matching Owner Pharmacy', '9024261',
    '1 Gate Street', 'Ikeja', 'Lagos', '+2348000000261', TRUE
  ),
  (
    'f2610000-0000-4000-8000-000000000002',
    'f2600000-0000-4000-8000-000000000002',
    'Matching Other Pharmacy', '9024262',
    '2 Gate Street', 'Abuja', 'FCT', '+2348000000262', TRUE
  );

SELECT has_table('public', 'import_jobs', 'import_jobs exists');
SELECT has_table('public', 'import_staging', 'import_staging exists');
SELECT has_table('public', 'barcode_catalogue_map', 'barcode_catalogue_map exists');
SELECT ok(
  (SELECT bool_and(relrowsecurity)
   FROM pg_class
   WHERE oid IN (
     'public.import_jobs'::regclass,
     'public.import_staging'::regclass,
     'public.barcode_catalogue_map'::regclass
   )),
  'all three tables have RLS enabled'
);
SELECT is(
  (SELECT COUNT(*) FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'import_jobs'),
  4::BIGINT,
  'import_jobs has owner CRUD policies'
);
SELECT is(
  (SELECT COUNT(*) FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'import_staging'),
  4::BIGINT,
  'import_staging has owner CRUD policies'
);
SELECT ok(
  (SELECT COUNT(*) = 0 FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'barcode_catalogue_map')
  AND NOT has_table_privilege('authenticated', 'public.barcode_catalogue_map', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.barcode_catalogue_map', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.barcode_catalogue_map', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.barcode_catalogue_map', 'DELETE'),
  'crosswalk denies all direct authenticated access'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'barcode_catalogue_map'
      AND indexname = 'barcode_catalogue_map_barcode_key'
      AND indexdef LIKE '%USING btree (barcode)%'
  ),
  'crosswalk barcode has a unique B-tree index'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.import_staging'::regclass
      AND conname = 'import_staging_job_source_row_key'
      AND contype = 'u'
  ),
  'staging enforces unique job and source row number'
);
SELECT ok(
  (SELECT COUNT(*) = 3
   FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'products'
     AND indexname IN (
       'products_generic_name_trgm_idx',
       'products_brand_name_trgm_idx',
       'products_barcode_idx'
     )),
  'existing catalogue trigram and barcode indexes remain present'
);
SELECT is(
  (SELECT COUNT(*) FROM public.barcode_catalogue_map),
  0::BIGINT,
  'crosswalk starts empty'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f2600000-0000-4000-8000-000000000001', TRUE);
END
$$;
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.import_jobs (
      id, pharmacy_id, total_rows, parsed_rows
    ) VALUES (
      'f2620000-0000-4000-8000-000000000001',
      'f2610000-0000-4000-8000-000000000001', 1, 1
    )$$,
  'owner inserts an import job'
);
SELECT is(
  (SELECT COUNT(*) FROM public.import_jobs),
  1::BIGINT,
  'owner reads its import job'
);
SELECT lives_ok(
  $$INSERT INTO public.import_staging (
      id, job_id, source_row_number, raw_name, norm_name,
      barcode, price_kobo, qty, min_qty
    ) VALUES (
      'f2630000-0000-4000-8000-000000000001',
      'f2620000-0000-4000-8000-000000000001', 2,
      'Paracetamol 500mg X10', 'paracetamol', '12345678', 150000, 4, 1
    )$$,
  'owner inserts a normalized staging row'
);
SELECT is(
  (SELECT source_row_number FROM public.import_staging),
  2,
  'owner reads the exact spreadsheet row number'
);

RESET ROLE;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f2600000-0000-4000-8000-000000000002', TRUE);
END
$$;
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT COUNT(*) FROM public.import_jobs),
  0::BIGINT,
  'another pharmacy cannot read the owner job'
);
SELECT is(
  (SELECT COUNT(*) FROM public.import_staging),
  0::BIGINT,
  'another pharmacy cannot read owner staging rows'
);
SELECT throws_ok(
  $$INSERT INTO public.import_staging (
      job_id, source_row_number, raw_name, norm_name
    ) VALUES (
      'f2620000-0000-4000-8000-000000000001', 3, 'Forged', 'forged'
    )$$,
  '42501', NULL,
  'another pharmacy cannot insert into the owner job'
);

RESET ROLE;
SELECT throws_ok(
  $$INSERT INTO public.import_staging (
      job_id, source_row_number, raw_name, norm_name
    ) VALUES (
      'f2620000-0000-4000-8000-000000000001', 2, 'Duplicate', 'duplicate'
    )$$,
  '23505', NULL,
  'duplicate source row is rejected within a job'
);
SELECT throws_ok(
  $$INSERT INTO public.import_staging (
      job_id, source_row_number, raw_name, norm_name, barcode
    ) VALUES (
      'f2620000-0000-4000-8000-000000000001', 4, 'Bad GTIN', 'bad gtin', '61500000001'
    )$$,
  '23514', NULL,
  '11-digit staging barcode is rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.barcode_catalogue_map (barcode, catalogue_id, source)
    SELECT '61500000001', id, 'name_match' FROM public.products LIMIT 1$$,
  '23514', NULL,
  '11-digit crosswalk barcode is rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.barcode_catalogue_map (barcode, catalogue_id, source)
    SELECT '1234567890123', id, 'manual' FROM public.products LIMIT 1$$,
  '23514', NULL,
  'unknown crosswalk source is rejected'
);
SELECT lives_ok(
  $$INSERT INTO public.barcode_catalogue_map (barcode, catalogue_id, source)
    SELECT '1234567890123', id, 'name_match' FROM public.products LIMIT 1$$,
  'valid GTIN-shaped crosswalk row is accepted'
);
SELECT is(
  (SELECT source FROM public.barcode_catalogue_map WHERE barcode = '1234567890123'),
  'name_match',
  'accepted crosswalk row preserves its source'
);

SELECT * FROM finish();
ROLLBACK;

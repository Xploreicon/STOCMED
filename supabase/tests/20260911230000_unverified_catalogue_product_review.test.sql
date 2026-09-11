BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, authenticated, anon;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT plan(13);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000','f7100000-0000-4000-8000-000000000001','authenticated','authenticated','submission-admin@stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW()),
  ('00000000-0000-0000-0000-000000000000','f7100000-0000-4000-8000-000000000002','authenticated','authenticated','submission-pharmacist@stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW());

SELECT set_config('app.pilot_role_provenance_reset', 'on', TRUE);
INSERT INTO public.users (
  user_id, email, full_name, role, is_admin, admin_authorized_at,
  admin_authorization_basis, is_licensed_pharmacist,
  pharmacist_license_number, pharmacist_license_verified_at,
  pharmacist_license_verification_basis
) VALUES
  ('f7100000-0000-4000-8000-000000000001','submission-admin@stocmed.invalid','Submission Admin','patient',TRUE,NOW(),'pgTAP admin authorization',FALSE,NULL,NULL,NULL),
  ('f7100000-0000-4000-8000-000000000002','submission-pharmacist@stocmed.invalid','Submission Pharmacist','pharmacy',FALSE,NULL,NULL,TRUE,'PCN-TEST-7102',NOW(),'pgTAP pharmacist license');
SELECT set_config('app.pilot_role_provenance_reset', 'off', TRUE);

INSERT INTO public.products (
  id, generic_name, brand_name, strength, dosage_form, category,
  nafdac_number, is_verified
) VALUES
  ('f7110000-0000-4000-8000-000000000001','Submission Ingredient','Submission Brand','5 mg','tablet','Others',NULL,FALSE),
  ('f7110000-0000-4000-8000-000000000002','Incomplete Submission',NULL,'10 mg',NULL,'Others',NULL,FALSE),
  ('f7110000-0000-4000-8000-000000000003','Rejectable Submission',NULL,'20 mg','tablet','Others','A4-SUB-REJECT',FALSE);

SELECT has_table('public', 'catalogue_product_submission_audit', 'submission audit table exists');
SELECT ok(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'public.review_unverified_catalogue_product(uuid,text,jsonb,text)'::regprocedure),
  'submission review RPC is SECURITY DEFINER'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.review_unverified_catalogue_product(uuid,text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.review_unverified_catalogue_product(uuid,text,jsonb,text)', 'EXECUTE'),
  'only authenticated callers can reach the admin-checking RPC'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.catalogue_product_submission_audit', 'INSERT'),
  'browser roles cannot forge submission audit rows'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f7100000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.review_unverified_catalogue_product('f7110000-0000-4000-8000-000000000001','verify','{}',NULL)$$,
  'P0001', 'Administrator authorization required',
  'a licensed pharmacist cannot review catalogue submissions'
);
RESET ROLE;

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f7100000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.review_unverified_catalogue_product('f7110000-0000-4000-8000-000000000002','verify','{}',NULL)$$,
  'P0001', 'Strength, dosage form, and NAFDAC/NRN are required before verification',
  'an incomplete product cannot be verified'
);
SELECT lives_ok(
  $$SELECT public.review_unverified_catalogue_product(
    'f7110000-0000-4000-8000-000000000001','edit',
    '{"generic_name":"Correct Ingredient","strength":"7.5 mg","dosage_form":"tablet","nafdac_number":"A4-SUB-VERIFY"}',
    'identity corrected from source evidence'
  )$$,
  'an admin can save corrected identity fields without verifying'
);
SELECT lives_ok(
  $$SELECT public.review_unverified_catalogue_product('f7110000-0000-4000-8000-000000000001','verify','{}','review complete')$$,
  'a complete corrected product can be verified'
);
RESET ROLE;

SELECT ok(
  (SELECT is_verified AND generic_name = 'Correct Ingredient' AND nafdac_number = 'A4-SUB-VERIFY'
   FROM public.products WHERE id = 'f7110000-0000-4000-8000-000000000001'),
  'verification persists the reviewed identity and unlocks the product'
);
SELECT is(
  (SELECT COUNT(*) FROM public.catalogue_product_submission_audit
   WHERE product_id = 'f7110000-0000-4000-8000-000000000001'),
  2::BIGINT,
  'edit and verify are both append-only audited'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f7100000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.review_unverified_catalogue_product('f7110000-0000-4000-8000-000000000003','reject','{}',NULL)$$,
  'P0001', 'A rejection reason is required',
  'reject requires an audit reason'
);
SELECT lives_ok(
  $$SELECT public.review_unverified_catalogue_product('f7110000-0000-4000-8000-000000000003','reject','{}','not a valid medicine identity')$$,
  'an unused invalid submission can be rejected with a reason'
);
RESET ROLE;

SELECT is(
  (SELECT COUNT(*) FROM public.products WHERE id = 'f7110000-0000-4000-8000-000000000003'),
  0::BIGINT,
  'rejection removes only the reviewed unused product'
);

SELECT * FROM finish();
ROLLBACK;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'new-google-patient@stocmed.test', '', NOW(),
    '', '', '', '',
    '{"provider":"google","providers":["google"]}',
    '{"full_name":"New Google User"}', NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'existing-google-pharmacy@stocmed.test', '', NOW(),
    '', '', '', '',
    '{"provider":"google","providers":["google"]}',
    '{"role":"pharmacy","full_name":"Existing Pharmacist","phone":"+2348030000002","location":"Lagos"}',
    NOW(), NOW()
  );

INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider,
  created_at, updated_at, last_sign_in_at
) VALUES
  (
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'google-new-patient',
    '{"sub":"google-new-patient","email":"new-google-patient@stocmed.test"}',
    'google', NOW(), NOW(), NOW()
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    'google-existing-pharmacy',
    '{"sub":"google-existing-pharmacy","email":"existing-google-pharmacy@stocmed.test"}',
    'google', NOW(), NOW(), NOW()
  );

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.complete_oauth_profile(
    'pharmacy', 'Crafted Pharmacy', '+2348030000001', 'Lagos',
    'Crafted Pharmacy Ltd', '1234567', '1 Test Street', 'Lagos', 'Lagos'
  )$$,
  'P0001',
  'New pharmacy accounts cannot be created with Google; use email and password',
  'a direct RPC cannot create a new pharmacy through Google'
);
RESET ROLE;

SELECT is(
  (SELECT COUNT(*) FROM public.users WHERE user_id = '91000000-0000-4000-8000-000000000001'),
  0::BIGINT,
  'rejected Google pharmacy signup leaves no public profile'
);
SELECT is(
  (SELECT COUNT(*) FROM public.pharmacies WHERE user_id = '91000000-0000-4000-8000-000000000001'),
  0::BIGINT,
  'rejected Google pharmacy signup leaves no pharmacy row'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.complete_oauth_profile(
    'patient', 'New Google Patient', '+2348030000001', 'Lagos',
    NULL, NULL, NULL, NULL, NULL
  )$$,
  'a new Google identity can complete patient onboarding'
);
RESET ROLE;

SELECT is(
  (SELECT role FROM public.users WHERE user_id = '91000000-0000-4000-8000-000000000001'),
  'patient',
  'new Google account persists as patient'
);
SELECT is(
  (SELECT COUNT(*) FROM public.pharmacies WHERE user_id = '91000000-0000-4000-8000-000000000001'),
  0::BIGINT,
  'patient Google onboarding never creates a pharmacy'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT is(
  (public.complete_oauth_profile(
    'patient', 'Ignored', '+2348039999999', 'Abuja',
    NULL, NULL, NULL, NULL, NULL
  )->>'role'),
  'pharmacy',
  'existing Google-linked pharmacy role is preserved unchanged'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

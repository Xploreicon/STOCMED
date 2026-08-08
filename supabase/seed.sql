-- Local development and automated test data only.
-- Password for seeded users: StocMedTest123!

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'pharmacy.test@stocmed.local', crypt('StocMedTest123!', gen_salt('bf')), now(),
   '', '', '', '',
   '{"provider":"email","providers":["email"]}', '{"role":"pharmacy","full_name":"Test Cashier","phone":"+2348000000001","location":"Ikeja","pharmacy_id":"30000000-0000-4000-8000-000000000001"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'pharmacy.other@stocmed.local', crypt('StocMedTest123!', gen_salt('bf')), now(),
   '', '', '', '',
   '{"provider":"email","providers":["email"]}', '{"role":"pharmacy","full_name":"Other Pharmacy","phone":"+2348000000002","location":"Abuja","pharmacy_id":"30000000-0000-4000-8000-000000000002"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'patient.test@stocmed.local', crypt('StocMedTest123!', gen_salt('bf')), now(),
   '', '', '', '',
   '{"provider":"email","providers":["email"]}', '{"role":"patient","full_name":"Test Patient","phone":"+2348000000003","location":"Lagos"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'admin.test@stocmed.local', crypt('StocMedTest123!', gen_salt('bf')), now(),
   '', '', '', '',
   '{"provider":"email","providers":["email"]}', '{"role":"patient","full_name":"Test Administrator","phone":"+2348000000004","location":"Lagos"}', now(), now())
ON CONFLICT (id) DO UPDATE SET
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = now(),
  confirmation_token = '',
  recovery_token = '',
  email_change_token_new = '',
  email_change = '',
  raw_user_meta_data = EXCLUDED.raw_user_meta_data;

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'pharmacy.test@stocmed.local',
   '{"sub":"10000000-0000-4000-8000-000000000001","email":"pharmacy.test@stocmed.local"}', 'email', now(), now(), now()),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'pharmacy.other@stocmed.local',
   '{"sub":"10000000-0000-4000-8000-000000000002","email":"pharmacy.other@stocmed.local"}', 'email', now(), now(), now()),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'patient.test@stocmed.local',
   '{"sub":"10000000-0000-4000-8000-000000000003","email":"patient.test@stocmed.local"}', 'email', now(), now(), now()),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 'admin.test@stocmed.local',
   '{"sub":"10000000-0000-4000-8000-000000000004","email":"admin.test@stocmed.local"}', 'email', now(), now(), now())
ON CONFLICT (provider_id, provider) DO NOTHING;

DO $$
DECLARE users_id_type text;
BEGIN
  SELECT data_type INTO users_id_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='users' AND column_name='id';

  IF users_id_type = 'bigint' THEN
    INSERT INTO public.users (user_id, email, full_name, phone, role, is_admin, is_licensed_pharmacist)
    VALUES
      ('10000000-0000-4000-8000-000000000001', 'pharmacy.test@stocmed.local', 'Test Cashier', '+2348000000001', 'pharmacy', false, false),
      ('10000000-0000-4000-8000-000000000002', 'pharmacy.other@stocmed.local', 'Other Pharmacy', '+2348000000002', 'pharmacy', false, false),
      ('10000000-0000-4000-8000-000000000003', 'patient.test@stocmed.local', 'Test Patient', '+2348000000003', 'patient', false, false),
      ('10000000-0000-4000-8000-000000000004', 'admin.test@stocmed.local', 'Test Administrator', '+2348000000004', 'patient', false, false)
    ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name;
  ELSE
    INSERT INTO public.users (id, user_id, email, full_name, phone, role, is_admin, is_licensed_pharmacist)
    VALUES
      ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'pharmacy.test@stocmed.local', 'Test Cashier', '+2348000000001', 'pharmacy', false, false),
      ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'pharmacy.other@stocmed.local', 'Other Pharmacy', '+2348000000002', 'pharmacy', false, false),
      ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'patient.test@stocmed.local', 'Test Patient', '+2348000000003', 'patient', false, false),
      ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 'admin.test@stocmed.local', 'Test Administrator', '+2348000000004', 'patient', false, false)
    ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name;
  END IF;
END $$;

INSERT INTO public.pharmacies (id, user_id, pharmacy_name, license_number, address, city, state, phone, is_verified, is_active)
VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'StocMed Test Pharmacy', '900001', '1 Test Street', 'Ikeja', 'Lagos', '+2348000000001', false, true),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Isolation Test Pharmacy', '900002', '2 Test Street', 'Abuja', 'FCT', '+2348000000002', false, true)
ON CONFLICT (id) DO UPDATE SET pharmacy_name = EXCLUDED.pharmacy_name;

-- Seed trust through the same append-only, service-only provisioning path used
-- by the pilot. No development fixture bypasses the production role guards.
INSERT INTO public.pharmacy_verification_upload_staging (
  object_path, pharmacy_id, uploaded_by
) VALUES
  ('30000000-0000-4000-8000-000000000001/premises-test.pdf', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000001/superintendent-test.pdf', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002/premises-test.pdf', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('30000000-0000-4000-8000-000000000002/superintendent-test.pdf', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002')
ON CONFLICT (object_path) DO NOTHING;

-- Synthetic local storage catalogue entries mirror the objects that the
-- server-only upload route creates in production. No fixture is public.
INSERT INTO storage.objects (bucket_id, name)
VALUES
  ('pharmacy-verification-documents', '30000000-0000-4000-8000-000000000001/premises-test.pdf'),
  ('pharmacy-verification-documents', '30000000-0000-4000-8000-000000000001/superintendent-test.pdf'),
  ('pharmacy-verification-documents', '30000000-0000-4000-8000-000000000002/premises-test.pdf'),
  ('pharmacy-verification-documents', '30000000-0000-4000-8000-000000000002/superintendent-test.pdf')
ON CONFLICT (bucket_id, name) DO NOTHING;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', TRUE);
  PERFORM public.submit_pharmacy_verification_requirements(
    '{"premises_certificate":"30000000-0000-4000-8000-000000000001/premises-test.pdf","superintendent_annual_licence":"30000000-0000-4000-8000-000000000001/superintendent-test.pdf"}',
    'pilot-v1', TRUE
  );
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', TRUE);
  PERFORM public.submit_pharmacy_verification_requirements(
    '{"premises_certificate":"30000000-0000-4000-8000-000000000002/premises-test.pdf","superintendent_annual_licence":"30000000-0000-4000-8000-000000000002/superintendent-test.pdf"}',
    'pilot-v1', TRUE
  );
END $$;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  PERFORM public.provision_pilot_role(
    '10000000-0000-4000-8000-000000000004',
    'admin', TRUE, 'Local development fixture: synthetic accountable administrator'
  );
  PERFORM public.provision_licensed_pharmacist(
    '10000000-0000-4000-8000-000000000001',
    'PCN/900001', TRUE, 'Local development fixture: synthetic PCN licence'
  );

  -- The accountable admin must use the same logged evidence-open flow that
  -- production approval requires before the service-role decision.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', TRUE);
  PERFORM public.authorize_and_log_pharmacy_verification_document_access(
    (SELECT id FROM public.pharmacy_verification_submissions
      WHERE pharmacy_id = '30000000-0000-4000-8000-000000000001'
      ORDER BY submitted_at DESC, id DESC LIMIT 1),
    'premises_certificate', 'local-seed-premises-1'
  );
  PERFORM public.authorize_and_log_pharmacy_verification_document_access(
    (SELECT id FROM public.pharmacy_verification_submissions
      WHERE pharmacy_id = '30000000-0000-4000-8000-000000000001'
      ORDER BY submitted_at DESC, id DESC LIMIT 1),
    'superintendent_annual_licence', 'local-seed-sp-1'
  );
  PERFORM public.authorize_and_log_pharmacy_verification_document_access(
    (SELECT id FROM public.pharmacy_verification_submissions
      WHERE pharmacy_id = '30000000-0000-4000-8000-000000000002'
      ORDER BY submitted_at DESC, id DESC LIMIT 1),
    'premises_certificate', 'local-seed-premises-2'
  );
  PERFORM public.authorize_and_log_pharmacy_verification_document_access(
    (SELECT id FROM public.pharmacy_verification_submissions
      WHERE pharmacy_id = '30000000-0000-4000-8000-000000000002'
      ORDER BY submitted_at DESC, id DESC LIMIT 1),
    'superintendent_annual_licence', 'local-seed-sp-2'
  );

  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  PERFORM public.provision_full_pharmacy_verification(
    '30000000-0000-4000-8000-000000000001',
    'Local development fixture: synthetic PCN premises and SP documents reviewed',
    'Local development fixture: pilot-v1 standards accepted',
    '10000000-0000-4000-8000-000000000004'
  );
  PERFORM public.provision_full_pharmacy_verification(
    '30000000-0000-4000-8000-000000000002',
    'Local development fixture: synthetic PCN premises and SP documents reviewed',
    'Local development fixture: pilot-v1 standards accepted',
    '10000000-0000-4000-8000-000000000004'
  );
END $$;

INSERT INTO public.pharmacy_inventory (id, pharmacy_id, product_id, price, low_stock_threshold, is_listed)
SELECT '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', id, 1500, 10, true
FROM public.products WHERE barcode = '61500000002' LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pharmacy_inventory (id, pharmacy_id, product_id, price, low_stock_threshold, is_listed)
SELECT '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', id, 1700, 10, true
FROM public.products WHERE barcode = '61500000002' LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.batches (id, inventory_id, batch_number, expiry_date, quantity_received, cost_price, received_at)
VALUES
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'TEST-BATCH-01', CURRENT_DATE + 365, 40, 900, now()),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'OTHER-BATCH-01', CURRENT_DATE + 365, 20, 950, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.stock_movements (id, inventory_id, batch_id, type, quantity, reason, reference, created_by)
VALUES
  ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'opening', 40, 'Local test seed', 'SEED', '10000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'opening', 20, 'Local isolation seed', 'SEED', '10000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

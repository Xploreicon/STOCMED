-- Local development and automated test data only.
-- Password for both seeded users: StocMedTest123!

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'pharmacy.test@stocmed.local', crypt('StocMedTest123!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Test Cashier"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'pharmacy.other@stocmed.local', crypt('StocMedTest123!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Other Pharmacy"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'patient.test@stocmed.local', crypt('StocMedTest123!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Test Patient"}', now(), now())
ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, email_confirmed_at = now();

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'pharmacy.test@stocmed.local',
   '{"sub":"10000000-0000-4000-8000-000000000001","email":"pharmacy.test@stocmed.local"}', 'email', now(), now(), now()),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'pharmacy.other@stocmed.local',
   '{"sub":"10000000-0000-4000-8000-000000000002","email":"pharmacy.other@stocmed.local"}', 'email', now(), now(), now()),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'patient.test@stocmed.local',
   '{"sub":"10000000-0000-4000-8000-000000000003","email":"patient.test@stocmed.local"}', 'email', now(), now(), now())
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
      ('10000000-0000-4000-8000-000000000001', 'pharmacy.test@stocmed.local', 'Test Cashier', '08000000001', 'pharmacy', false, true),
      ('10000000-0000-4000-8000-000000000002', 'pharmacy.other@stocmed.local', 'Other Pharmacy', '08000000002', 'pharmacy', false, false),
      ('10000000-0000-4000-8000-000000000003', 'patient.test@stocmed.local', 'Test Patient', '08000000003', 'patient', false, false)
    ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name;
  ELSE
    INSERT INTO public.users (id, user_id, email, full_name, phone, role, is_admin, is_licensed_pharmacist)
    VALUES
      ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'pharmacy.test@stocmed.local', 'Test Cashier', '08000000001', 'pharmacy', false, true),
      ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'pharmacy.other@stocmed.local', 'Other Pharmacy', '08000000002', 'pharmacy', false, false),
      ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'patient.test@stocmed.local', 'Test Patient', '08000000003', 'patient', false, false)
    ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name;
  END IF;
END $$;

INSERT INTO public.pharmacies (id, user_id, pharmacy_name, license_number, address, city, state, phone, is_verified, is_active)
VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'StocMed Test Pharmacy', 'PCN-TEST-001', '1 Test Street', 'Ikeja', 'Lagos', '08000000001', true, true),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Isolation Test Pharmacy', 'PCN-TEST-002', '2 Test Street', 'Abuja', 'FCT', '08000000002', true, true)
ON CONFLICT (id) DO UPDATE SET pharmacy_name = EXCLUDED.pharmacy_name;

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

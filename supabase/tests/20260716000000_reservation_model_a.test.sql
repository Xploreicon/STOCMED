BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(79);

CREATE FUNCTION pg_temp.raises_insufficient_privilege(p_sql TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN FALSE;
EXCEPTION
  WHEN insufficient_privilege THEN
    RETURN TRUE;
END;
$$;

-- Local seed identities.
-- destination SP: 100...001 / pharmacy 300...001
-- other pharmacy: 100...002 / pharmacy 300...002
-- patient:        100...003

SELECT is(
  has_function_privilege('anon', 'public.create_reservation(uuid,integer,text,text)', 'EXECUTE'),
  FALSE,
  'anonymous callers cannot execute reservation creation'
);

SELECT is((SELECT public FROM storage.buckets WHERE id = 'prescriptions'), FALSE, 'Rx bucket is private');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'prescriptions'), 5242880::BIGINT, 'Rx bucket enforces 5 MB');
SELECT ok(
  (SELECT allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'application/pdf'] FROM storage.buckets WHERE id = 'prescriptions'),
  'Rx bucket enforces the required MIME allowlist'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE public.users SET is_admin = TRUE WHERE user_id = '10000000-0000-4000-8000-000000000003'$$,
  '23514',
  'new row for relation "users" violates check constraint "users_admin_provenance_complete"',
  'a patient cannot self-promote to admin'
);
SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    INSERT INTO public.products (generic_name, strength, dosage_form, category)
    VALUES ('Forged product', '10mg', 'tablet', 'Others')
  $sql$),
  'authenticated clients cannot directly insert catalogue products'
);
SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    UPDATE public.products SET requires_prescription = FALSE
  $sql$),
  'authenticated clients cannot directly change product prescription status'
);
SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    INSERT INTO public.stock_movements (
      inventory_id, type, quantity, reason, reference, created_by
    ) VALUES (
      '40000000-0000-4000-8000-000000000001', 'adjustment', 100,
      'forged stock', 'BYPASS', '10000000-0000-4000-8000-000000000003'
    )
  $sql$),
  'authenticated clients cannot directly insert ledger movements'
);
SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    UPDATE public.pharmacy_inventory
    SET quantity_in_stock = 999
    WHERE id = '40000000-0000-4000-8000-000000000001'
  $sql$),
  'authenticated clients cannot directly overwrite inventory quantity'
);
SELECT is(
  has_function_privilege('authenticated', 'public.sync_pos_sale(uuid,jsonb)', 'EXECUTE'),
  FALSE,
  'authenticated clients cannot execute the lower-level POS sync bypass'
);
SELECT ok(
  pg_temp.raises_insufficient_privilege($sql$
    INSERT INTO public.symptom_intakes (user_id, symptoms, status)
    VALUES (
      '10000000-0000-4000-8000-000000000003',
      'forged pilot intake', 'submitted'
    )
  $sql$),
  'authenticated clients cannot submit the pilot-gated symptom intake directly'
);
RESET ROLE;

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.set_authenticated_pharmacy_features(
      jsonb_build_array(jsonb_build_object(
        'feature_key', 'reservations', 'is_enabled', TRUE
      )),
      NULL
    )$$,
  'a FULL pharmacy can enable OTC reservations without a destination SP'
);
RESET ROLE;

SELECT is(
  (SELECT sellable_quantity FROM public.reservation_sellable_quantities(ARRAY['40000000-0000-4000-8000-000000000001'::UUID])),
  40,
  'opted-out pharmacy exposes full ledger stock'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.set_authenticated_pharmacy_features(
      jsonb_build_array(jsonb_build_object(
        'feature_key', 'reservations', 'is_enabled', TRUE
      )),
      NULL
    )$$,
  'verified licensed destination SP can enable reservations'
);
SELECT throws_ok(
  $$SELECT public.record_guarded_stock_adjustment(
      '40000000-0000-4000-8000-000000000001', 'sale', -1, 'spoofed sale',
      NULL, NULL, NULL, NULL, NULL
    )$$,
  'P0001',
  'This stock movement type cannot be created as an adjustment',
  'adjustment RPC cannot forge a POS sale movement'
);
SELECT throws_ok(
  $$SELECT public.record_guarded_stock_adjustment(
      '40000000-0000-4000-8000-000000000001', 'restock', -1, 'wrong sign',
      NULL, NULL, NULL, NULL, NULL
    )$$,
  'P0001',
  'Restock and return quantities must be positive',
  'adjustment RPC enforces positive restock quantities'
);
SELECT throws_ok(
  $$SELECT public.record_guarded_stock_adjustment(
      '40000000-0000-4000-8000-000000000001', 'write_off', 1, 'wrong sign',
      NULL, NULL, NULL, NULL, NULL
    )$$,
  'P0001',
  'Write-off and expiry quantities must be negative',
  'adjustment RPC enforces negative write-off quantities'
);
SELECT throws_ok(
  $$SELECT public.record_guarded_stock_adjustment(
      '40000000-0000-4000-8000-000000000001', 'adjustment', 0, 'zero',
      NULL, NULL, NULL, NULL, NULL
    )$$,
  'P0001',
  'Adjustment quantity must be a non-zero whole number',
  'adjustment RPC rejects a zero quantity'
);
SELECT throws_ok(
  $$SELECT public.record_guarded_stock_adjustment(
      '40000000-0000-4000-8000-000000000001', 'adjustment', 1, '   ',
      NULL, NULL, NULL, NULL, NULL
    )$$,
  'P0001',
  'A reason is required for every stock change',
  'adjustment RPC requires an audit reason'
);
RESET ROLE;

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.create_reservation('40000000-0000-4000-8000-000000000001', 2, NULL, NULL)$$,
  'signed-in patient can create an exact OTC hold at an opted-in pharmacy'
);
RESET ROLE;

SELECT is(
  (SELECT reserved_quantity FROM public.reservation_sellable_quantities(ARRAY['40000000-0000-4000-8000-000000000001'::UUID])),
  2,
  'active hold is counted as reserved'
);
SELECT is(
  (SELECT sellable_quantity FROM public.reservation_sellable_quantities(ARRAY['40000000-0000-4000-8000-000000000001'::UUID])),
  38,
  'active hold leaves public sellable stock'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.set_authenticated_pharmacy_features(
      jsonb_build_array(jsonb_build_object(
        'feature_key', 'reservations', 'is_enabled', FALSE
      )),
      NULL
    )$$,
  'P0001',
  'Resolve active holds and pending prescription reviews before turning reservations off',
  'pharmacy cannot opt out while an active hold exists'
);
RESET ROLE;

UPDATE public.reservations
SET expires_at = NOW() - INTERVAL '1 minute'
WHERE inventory_id = '40000000-0000-4000-8000-000000000001' AND status = 'active';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
SET LOCAL ROLE service_role;
SELECT is(public.expire_reservations(), 1, 'expiry job releases the lapsed hold');
RESET ROLE;
SELECT is(
  (SELECT sellable_quantity FROM public.reservation_sellable_quantities(ARRAY['40000000-0000-4000-8000-000000000001'::UUID])),
  40,
  'expired hold restores sellable stock'
);

INSERT INTO public.sales (
  id, pharmacy_id, cashier_id, subtotal, discount, total, payment_method, status
) VALUES (
  '69000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 1500, 0, 1500, 'cash', 'completed'
);
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.sync_pos_sale_with_shift(
      '30000000-0000-4000-8000-000000000001',
      jsonb_build_object('id', '69000000-0000-4000-8000-000000000001')
    )$$,
  'P0001',
  'Not authorized for this pharmacy',
  'completed-sale replay still enforces pharmacy ownership'
);
RESET ROLE;

-- Seed a POM inventory item at the destination pharmacy.
INSERT INTO public.products (
  id, generic_name, brand_name, strength, dosage_form, category, pack_size,
  requires_prescription, is_verified
) VALUES (
  '70000000-0000-4000-8000-000000000001',
  'Amoxicillin/Clavulanate potassium', 'Aquaclav Pilot', '625mg',
  'tablet', 'Antibiotics', '10s', FALSE, TRUE
);
INSERT INTO public.pharmacy_inventory (
  id, pharmacy_id, product_id, price, low_stock_threshold, is_listed
) VALUES (
  '71000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001', 2500, 2, TRUE
);
INSERT INTO public.batches (
  id, inventory_id, batch_number, expiry_date, quantity_received, cost_price, received_at
) VALUES (
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001', 'PILOT-RX-01', CURRENT_DATE + 365, 10, 1500, NOW()
);
INSERT INTO public.stock_movements (
  id, inventory_id, batch_id, type, quantity, reason, reference, created_by
) VALUES (
  '73000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001', 'opening', 10,
  'Model A test stock', 'TEST', '10000000-0000-4000-8000-000000000001'
);

SELECT is(
  (SELECT reservations_enabled
   FROM public.reservation_inventory_capabilities(
     ARRAY['71000000-0000-4000-8000-000000000001'::UUID]
   )),
  FALSE,
  'known POM cannot advertise digital reservation before retention is confirmed'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$INSERT INTO public.rx_submissions (
      id, user_id, product_name, file_url, flow_model, destination_pharmacy_id,
      inventory_id, requested_quantity
    ) VALUES (
      '74000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000003', 'spoofed', '10000000-0000-4000-8000-000000000003/test-rx.pdf',
      'destination_model_a', '30000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001', 2
    )$$,
  'P0001',
  'Prescription retention policy is not yet confirmed',
  'Model A submission fails closed while retention is unconfirmed'
);

SELECT lives_ok(
  $$SELECT public.provision_pilot_role(
      '10000000-0000-4000-8000-000000000002', 'admin', TRUE,
      'Local test approval: synthetic StocMed administrator'
    )$$,
  'service role provisions the oversight administrator with an audit basis'
);
RESET ROLE;
INSERT INTO public.symptom_intakes (
  id, user_id, symptoms, status
) VALUES (
  '75000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', 'Local policy test', 'submitted'
);
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.set_rx_retention_policy(30, 'Local test approval only')$$,
  'admin can record a confirmed retention policy and basis'
);
UPDATE public.symptom_intakes
SET pharmacist_response = 'unlicensed answer', status = 'answered'
WHERE id = '75000000-0000-4000-8000-000000000001';
SELECT is(
  (SELECT status::TEXT FROM public.symptom_intakes
   WHERE id = '75000000-0000-4000-8000-000000000001'),
  'submitted',
  'an unlicensed admin cannot answer a clinical symptom intake'
);
RESET ROLE;

SELECT is(
  (SELECT reservations_enabled
   FROM public.reservation_inventory_capabilities(
     ARRAY['71000000-0000-4000-8000-000000000001'::UUID]
   )),
  TRUE,
  'known POM becomes digitally reservable only after retention is confirmed'
);

SELECT is(
  has_table_privilege('authenticated', 'public.rx_submissions', 'INSERT'),
  FALSE,
  'patients cannot bypass the server submission path with direct inserts'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$INSERT INTO public.rx_submissions (
      id, user_id, product_name, file_url, flow_model, destination_pharmacy_id,
      inventory_id, requested_quantity
    ) VALUES (
      '74000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000003', 'spoofed', '10000000-0000-4000-8000-000000000003/test-rx.pdf',
      'destination_model_a', '30000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001', 2
    )$$,
  'server path creates a Model A submission after retention confirmation'
);
RESET ROLE;
SELECT is((SELECT product_name FROM public.rx_submissions WHERE id = '74000000-0000-4000-8000-000000000001'), 'Aquaclav Pilot', 'server derives product name');
SELECT is((SELECT COUNT(*)::INTEGER FROM public.rx_audit_records WHERE submission_id = '74000000-0000-4000-8000-000000000001'), 1, 'submission atomically creates one audit record');
SELECT ok(
  (SELECT purge_after BETWEEN NOW() + INTERVAL '29 days' AND NOW() + INTERVAL '31 days'
   FROM public.rx_submissions WHERE id = '74000000-0000-4000-8000-000000000001'),
  'submission snapshots the configured retention deadline'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT is((SELECT COUNT(*)::INTEGER FROM public.rx_submissions WHERE id = '74000000-0000-4000-8000-000000000001'), 1, 'destination SP can read assigned Rx');
SELECT is(
  (SELECT pending_prescriptions FROM public.get_pharmacy_reservation_summary('30000000-0000-4000-8000-000000000001')),
  1,
  'sticky summary includes pending prescription review'
);
SELECT throws_ok(
  $$SELECT public.set_authenticated_pharmacy_features(
      jsonb_build_array(jsonb_build_object(
        'feature_key', 'reservations', 'is_enabled', FALSE
      )),
      NULL
    )$$,
  'P0001',
  'Resolve active holds and pending prescription reviews before turning reservations off',
  'pending Rx prevents unsafe opt-out'
);
RESET ROLE;

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT is((SELECT COUNT(*)::INTEGER FROM public.rx_submissions WHERE id = '74000000-0000-4000-8000-000000000001'), 0, 'other pharmacy and admin cannot read destination Rx row');
SELECT is((SELECT COUNT(*)::INTEGER FROM public.rx_audit_records WHERE submission_id = '74000000-0000-4000-8000-000000000001'), 1, 'StocMed admin can read only the oversight projection');
SELECT throws_ok(
  $$SELECT public.review_destination_prescription('74000000-0000-4000-8000-000000000001', 'verified', NULL)$$,
  'P0001',
  'Only a provenance-verified destination SP or StocMed clinical reviewer can pre-review this prescription',
  'admin is not allowed to approve destination prescription'
);
SELECT lives_ok(
  $$SELECT public.authorize_and_log_rx_document_access(
      '74000000-0000-4000-8000-000000000001', 'stocmed_oversight', 'test-request'
    )$$,
  'oversight document open is explicitly authorized and logged'
);
RESET ROLE;

SELECT is((SELECT COUNT(*)::INTEGER FROM public.rx_document_access_logs WHERE submission_id = '74000000-0000-4000-8000-000000000001'), 1, 'oversight open produces one access log');

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.review_destination_prescription(
      '74000000-0000-4000-8000-000000000001', 'verified', 'blind approval'
    )$$,
  'P0001',
  'Open the prescription document through the matching audited clinical-review flow before deciding',
  'destination pharmacist cannot decide before opening the Rx through the audited flow'
);
SELECT lives_ok(
  $$SELECT public.authorize_and_log_rx_document_access(
      '74000000-0000-4000-8000-000000000001', 'destination_review', 'destination-test-request'
    )$$,
  'destination prescription open is explicitly authorized and logged'
);
SELECT lives_ok(
  $$SELECT public.review_destination_prescription(
      '74000000-0000-4000-8000-000000000001', 'verified', 'Valid local test Rx'
    )$$,
  'destination licensed SP atomically approves Rx and creates hold'
);
SELECT lives_ok(
  $$SELECT public.review_destination_prescription(
      '74000000-0000-4000-8000-000000000001', 'verified', 'retry'
    )$$,
  'duplicate approval is idempotent'
);
RESET ROLE;

SELECT is(
  (SELECT COUNT(*)::INTEGER
   FROM public.rx_document_access_logs
   WHERE submission_id = '74000000-0000-4000-8000-000000000001'
     AND access_context = 'destination_review'
     AND outcome = 'authorized'),
  1,
  'destination review produces exactly one authorized document-access log'
);

SELECT ok(
  (SELECT status = 'verified' AND reservation_id IS NOT NULL
   FROM public.rx_submissions WHERE id = '74000000-0000-4000-8000-000000000001'),
  'verified Rx is linked to the resulting hold'
);
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.reservations r
   JOIN public.rx_submissions rx ON rx.reservation_id = r.id
   WHERE rx.id = '74000000-0000-4000-8000-000000000001'),
  1,
  'idempotent review creates exactly one hold'
);
SELECT is(
  (SELECT sellable_quantity FROM public.reservation_sellable_quantities(ARRAY['71000000-0000-4000-8000-000000000001'::UUID])),
  8,
  'approved POM hold immediately reduces sellable stock'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (COALESCE(qual, '') ILIKE '%prescriptions%' OR COALESCE(with_check, '') ILIKE '%prescriptions%')),
  0,
  'no direct prescription storage policy can bypass logged signing'
);
SELECT is(has_table_privilege('authenticated', 'public.rx_audit_records', 'INSERT'), FALSE, 'audit projection is client read-only');
SELECT is(has_table_privilege('authenticated', 'public.rx_document_access_logs', 'INSERT'), FALSE, 'access log is append-only through the security function');

SELECT ok(
  public.is_plausible_pcn_registration_number('0023841')
    AND NOT public.is_plausible_pcn_registration_number('12345')
    AND NOT public.is_plausible_pcn_registration_number('PCN-TEST-001'),
  'PCN format accepts only six-to-nine numeric digits'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.provision_licensed_pharmacist(uuid,text,boolean,text)',
    'EXECUTE'
  ),
  FALSE,
  'authenticated callers cannot provision a pharmacist licence identity'
);
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT public.provision_licensed_pharmacist(
      '10000000-0000-4000-8000-000000000002',
      'pcn/981234', TRUE, 'Dedicated pgTAP licence fixture'
    )$$,
  'service role provisions a dedicated pharmacist licence fixture'
);
SELECT is(
  (SELECT pharmacist_license_number FROM public.users
   WHERE user_id = '10000000-0000-4000-8000-000000000002'),
  'PCN/981234',
  'licence provisioning persists the normalized structured PCN identity'
);
SELECT throws_ok(
  $$SELECT public.provision_licensed_pharmacist(
      '10000000-0000-4000-8000-000000000003',
      'Pcn/981234', TRUE, 'Synthetic duplicate licence test'
    )$$,
  'P0001',
  'This PCN pharmacist licence is already provisioned to another account',
  'the same normalized PCN pharmacist licence cannot provision two accounts'
);
RESET ROLE;
SELECT ok(
  (SELECT public = FALSE
      AND file_size_limit = 5242880
      AND allowed_mime_types <@ ARRAY['image/jpeg', 'image/png', 'application/pdf']::TEXT[]
      AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'application/pdf']::TEXT[]
   FROM storage.buckets
   WHERE id = 'pharmacy-verification-documents'),
  'pharmacy verification evidence bucket is private, 5 MB, and exact-MIME restricted'
);
SELECT is(
  (SELECT current_standards_version FROM public.pharmacy_verification_config WHERE singleton = TRUE),
  'pilot-v1',
  'pharmacy verification uses the configured pilot standards version'
);
SELECT is(
  (SELECT review_notes FROM public.rx_audit_records
   WHERE submission_id = '74000000-0000-4000-8000-000000000001'),
  'Valid local test Rx',
  'Rx oversight projection preserves the clinical review notes'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT public.provision_full_pharmacy_verification(
      '30000000-0000-4000-8000-000000000001',
      'synthetic document evidence', 'synthetic standards evidence', NULL::UUID
    )$$,
  'P0001',
  'The accountable authorizing administrator is not provenance-authorized',
  'FULL verification cannot be provisioned without an accountable authorized admin'
);
SELECT lives_ok(
  $$SELECT public.set_pilot_pharmacy_verification(
      '30000000-0000-4000-8000-000000000001', FALSE,
      'Local fail-closed visibility test'
    )$$,
  'service-role revocation closes the pharmacy safely'
);
RESET ROLE;

SELECT ok(
  (SELECT verification_status = 'revoked'
      AND is_verified = FALSE
      AND reservations_enabled = FALSE
   FROM public.pharmacies
   WHERE id = '30000000-0000-4000-8000-000000000001'),
  'revocation clears verification and digital reservations'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'anon', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
SET LOCAL ROLE anon;
SELECT is(
  (SELECT COUNT(*)::INTEGER
   FROM public.reservation_sellable_quantities(
     ARRAY['40000000-0000-4000-8000-000000000001'::UUID]
   )),
  0,
  'revoked pharmacy inventory is absent from the anonymous sellable-quantity RPC'
);
SELECT is(
  (SELECT COUNT(*)::INTEGER
   FROM public.reservation_inventory_capabilities(
     ARRAY['40000000-0000-4000-8000-000000000001'::UUID]
   )),
  0,
  'revoked pharmacy inventory is absent from the anonymous capability RPC'
);
RESET ROLE;

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.bootstrap_legacy_full_pharmacy_verification(uuid,text,text,text,text,timestamptz,text,text,text,uuid)',
    'EXECUTE'
  ),
  FALSE,
  'authenticated callers cannot execute the legacy FULL bootstrap'
);

-- A post-migration pharmacy starts ineligible. The explicit eligibility update
-- below models only the marker stamped on pre-existing rows by migration 00003.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;
INSERT INTO public.pharmacies (
  id, user_id, pharmacy_name, license_number, address, city, state, phone,
  is_verified, is_active, reservations_enabled
) VALUES
  (
    '32000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'Legacy Bootstrap Fixture', '812345', '3 Test Street', 'Ikeja', 'Lagos',
    '08000000003', FALSE, TRUE, FALSE
  ),
  (
    '32000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    'Revoked Legacy Duplicate', '812345', '4 Test Street', 'Ikeja', 'Lagos',
    '08000000004', FALSE, FALSE, FALSE
  );
SELECT is(
  (SELECT legacy_verification_bootstrap_eligible FROM public.pharmacies
   WHERE id = '32000000-0000-4000-8000-000000000001'),
  FALSE,
  'new registrations never receive legacy bootstrap eligibility'
);

SELECT set_config('app.pharmacy_verification_transition', 'on', TRUE);
UPDATE public.pharmacies
SET legacy_verification_bootstrap_eligible = TRUE,
    verification_status = 'revoked'
WHERE id IN (
  '32000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000002'
);
SELECT set_config('app.pharmacy_verification_transition', 'off', TRUE);
UPDATE public.pharmacy_verification_config
SET standards_document_hash = repeat('a', 64),
    change_basis = 'Local pgTAP standards hash fixture', updated_at = NOW()
WHERE singleton = TRUE;

SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT public.bootstrap_legacy_full_pharmacy_verification(
      '32000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000001/premises.pdf',
      '32000000-0000-4000-8000-000000000001/sp.pdf',
      'pilot-v1', repeat('a', 64), NOW(),
      'Synthetic premises and SP evidence reviewed',
      'Synthetic standards acceptance reviewed',
      'Local legacy bootstrap test only',
      '10000000-0000-4000-8000-000000000004'
    )$$,
  'P0001',
  'Both private verification evidence objects must exist before legacy bootstrap',
  'legacy bootstrap refuses path-only evidence without private storage objects'
);
RESET ROLE;

INSERT INTO storage.objects (bucket_id, name)
VALUES
  ('pharmacy-verification-documents', '32000000-0000-4000-8000-000000000001/premises.pdf'),
  ('pharmacy-verification-documents', '32000000-0000-4000-8000-000000000001/sp.pdf')
ON CONFLICT (bucket_id, name) DO NOTHING;

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT public.bootstrap_legacy_full_pharmacy_verification(
      '32000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000001/premises.pdf',
      '32000000-0000-4000-8000-000000000001/sp.pdf',
      'pilot-v1', repeat('a', 64), NOW(),
      'Synthetic premises and SP evidence reviewed',
      'Synthetic standards acceptance reviewed',
      'Local legacy bootstrap test only',
      '10000000-0000-4000-8000-000000000004'
    )$$,
  'service role can bootstrap one eligible legacy pharmacy with complete evidence'
);
SELECT throws_ok(
  $$SELECT public.bootstrap_legacy_full_pharmacy_verification(
      '32000000-0000-4000-8000-000000000002',
      '32000000-0000-4000-8000-000000000002/premises.pdf',
      '32000000-0000-4000-8000-000000000002/sp.pdf',
      'pilot-v1', repeat('a', 64), NOW(),
      'Synthetic duplicate evidence reviewed',
      'Synthetic standards acceptance reviewed',
      'Local duplicate canonicalization test only',
      '10000000-0000-4000-8000-000000000004'
    )$$,
  'P0001',
  'Another current pharmacy registration already uses this PCN premises number',
  'the first FULL bootstrap permanently blocks a revoked duplicate PCN row'
);
RESET ROLE;

SELECT ok(
  (SELECT verification_status = 'full' AND is_verified = TRUE
      AND legacy_verification_bootstrap_eligible = FALSE
   FROM public.pharmacies
   WHERE id = '32000000-0000-4000-8000-000000000001'),
  'successful legacy bootstrap atomically reaches FULL and consumes eligibility'
);
SELECT is(
  (SELECT COUNT(*)::INTEGER
   FROM public.pharmacy_verification_document_access_logs access_log
   JOIN public.pharmacy_verification_submissions submission
     ON submission.id = access_log.submission_id
   WHERE submission.pharmacy_id = '32000000-0000-4000-8000-000000000001'
     AND access_log.viewer_user_id = '10000000-0000-4000-8000-000000000004'),
  2,
  'legacy bootstrap records both accountable admin evidence accesses'
);
SELECT is(
  (SELECT COUNT(*)::INTEGER
   FROM public.pharmacy_verification_decisions decision
   WHERE decision.pharmacy_id = '32000000-0000-4000-8000-000000000001'
     AND decision.decision = 'approved'),
  1,
  'legacy bootstrap writes one immutable approval decision'
);
SELECT is(
  (SELECT COUNT(*)::INTEGER
   FROM public.pharmacy_verification_audit audit
   WHERE audit.pharmacy_id = '32000000-0000-4000-8000-000000000001'
     AND audit.action = 'full_provisioned'),
  1,
  'legacy bootstrap writes the FULL verification audit event'
);

INSERT INTO public.reservations (
  id, patient_id, pharmacy_id, inventory_id, quantity, expires_at, pickup_code
) VALUES (
  '76000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  1, NOW() + INTERVAL '1 hour', '909090'
);
SELECT throws_ok(
  $$UPDATE public.reservations
    SET status = 'collected'
    WHERE id = '76000000-0000-4000-8000-000000000001'$$,
  'P0001',
  'Reservation pickup requires a currently verified pharmacy',
  'a revoked pharmacy cannot collect a still-future hold while maintenance is delayed'
);

SELECT * FROM finish();
ROLLBACK;

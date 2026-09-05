BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT plan(29);

SELECT has_table('public', 'catalogue_source_snapshots', 'source snapshot table exists');
SELECT has_table('public', 'catalogue_source_records', 'source evidence table exists');
SELECT has_table('public', 'catalogue_reconciliation_queue', 'four-way review queue exists');
SELECT has_table('public', 'catalogue_reconciliation_audit', 'decision audit table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.catalogue_source_records'::regclass),
  'source records have RLS enabled'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'public.reconcile_catalogue_source_snapshot(uuid)'::regprocedure),
  'reconciliation is SECURITY DEFINER'
);
SELECT ok(
  has_function_privilege('service_role', 'public.reconcile_catalogue_source_snapshot(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.reconcile_catalogue_source_snapshot(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.reconcile_catalogue_source_snapshot(uuid)', 'EXECUTE'),
  'only service_role can execute reconciliation'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.catalogue_reconciliation_queue', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.catalogue_reconciliation_queue', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.catalogue_reconciliation_queue', 'SELECT'),
  'admins get an RLS-filtered read surface and clients get no direct write surface'
);

CREATE TEMP TABLE product_count_before AS SELECT COUNT(*) AS count FROM public.products;

INSERT INTO public.products (
  id, generic_name, brand_name, manufacturer, strength, dosage_form,
  category, pack_size, nafdac_number, is_verified
) VALUES (
  'f7000000-0000-4000-8000-000000000001', 'QA Levocetirizine Dihydrochloride', 'Xyzal QA Fixture',
  'QA UCB Pharma', '5 mg', 'tablet', 'Others', 'QA 1 x 10', 'A4-XYZAL-QA', TRUE
);

INSERT INTO public.catalogue_source_snapshots (
  id, source_key, snapshot_date, package_sha256, manifest
) VALUES (
  'f7010000-0000-4000-8000-000000000001', 'test-package', '2026-09-05',
  repeat('a', 64), '{"snapshot_date":"2026-09-05","files":[]}'::jsonb
);

INSERT INTO public.catalogue_source_records (
  snapshot_id, dataset, record_id, record_sha256, source_identity_fingerprint,
  source_status, review_status, source_url, payload
) VALUES
  (
    'f7010000-0000-4000-8000-000000000001', 'nafdac_human_medicines', 'nafdac:5826',
    repeat('0',64), 'xyzal-fingerprint', 'Active', 'pending_admin_review',
    'https://greenbook.nafdac.gov.ng/products/details/5826',
    '{"product_name_display":"Xyzal QA Fixture","generic_ingredient_raw":"QA Levocetirizine Dihydrochloride","strength_raw":"5 mg","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"QA UCB Pharma","nafdac_number_raw":"A4-XYZAL-QA","nafdac_status_raw":"Active","registration_date_assessment":"within_registration_date_window","components_candidate":[{"ingredient_raw":"QA Levocetirizine Dihydrochloride","strength_raw":"5 mg"}],"quality_flags":[]}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nafdac_human_medicines', 'nafdac:new',
    repeat('1',64), 'new-fingerprint', 'Active', 'pending_admin_review',
    'https://greenbook.nafdac.gov.ng/products/details/new',
    '{"product_name_display":"Novel Safe Candidate","generic_ingredient_raw":"Example INN","strength_raw":"10 mg","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"Example Manufacturer","nafdac_number_raw":"A4-NEW","nafdac_status_raw":"Active","components_candidate":[{"ingredient_raw":"Example INN","strength_raw":"10 mg"}],"quality_flags":[]}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nafdac_human_medicines', 'nafdac:inactive',
    repeat('2',64), 'inactive-fingerprint', 'Inactive', 'pending_admin_review',
    'https://greenbook.nafdac.gov.ng/products/details/inactive',
    '{"product_name_display":"Inactive Drug","generic_ingredient_raw":"Inactive INN","strength_raw":"20 mg","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"Example Manufacturer","nafdac_number_raw":"A4-INACTIVE","nafdac_status_raw":"Inactive","components_candidate":[{"ingredient_raw":"Inactive INN","strength_raw":"20 mg"}],"quality_flags":[]}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nafdac_human_medicines', 'nafdac:repeat-a',
    repeat('3',64), 'repeat-a-fingerprint', 'Active', 'pending_admin_review', NULL,
    '{"product_name_display":"Repeat A","generic_ingredient_raw":"Repeat INN","strength_raw":"20 mg","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"Example Manufacturer","nafdac_number_raw":"A4-REPEAT","nafdac_status_raw":"Active","components_candidate":[{"ingredient_raw":"Repeat INN","strength_raw":"20 mg"}],"quality_flags":[]}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nafdac_human_medicines', 'nafdac:repeat-b',
    repeat('4',64), 'repeat-b-fingerprint', 'Active', 'pending_admin_review', NULL,
    '{"product_name_display":"Repeat B","generic_ingredient_raw":"Repeat INN","strength_raw":"40 mg","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"Example Manufacturer","nafdac_number_raw":"A4-REPEAT","nafdac_status_raw":"Active","components_candidate":[{"ingredient_raw":"Repeat INN","strength_raw":"40 mg"}],"quality_flags":[]}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nafdac_human_medicines', 'nafdac:6053',
    repeat('5',64), 'brustan-n-tablet', 'Active', 'pending_admin_review', NULL,
    '{"product_name_display":"Brustan-N Tablets","generic_ingredient_raw":"Ibuprofen","strength_raw":"400 mg","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"Ranbaxy","nafdac_number_raw":"04-0694","nafdac_status_raw":"Active","components_candidate":[{"ingredient_raw":"Ibuprofen","strength_raw":"400 mg"}],"quality_flags":[]}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nafdac_human_medicines', 'nafdac:6052',
    repeat('6',64), 'brustan-n-suspension', 'Active', 'pending_admin_review', NULL,
    '{"product_name_display":"Brustan-N Suspension","generic_ingredient_raw":"Ibuprofen","strength_raw":"100 mg/5 mL","dosage_form_raw":"Suspension","route_raw":"Oral","manufacturer_name":"Ranbaxy","nafdac_number_raw":"A4-0488","nafdac_status_raw":"Active","components_candidate":[{"ingredient_raw":"Ibuprofen","strength_raw":"100 mg/5 mL"}],"quality_flags":[]}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nafdac_human_medicines', 'nafdac:4743',
    repeat('7',64), 'brustan-plus-tablet', 'Active', 'pending_admin_review', NULL,
    '{"product_name_display":"Brustan Plus Tablets","generic_ingredient_raw":"Ibuprofen; Paracetamol","strength_raw":"400 mg; 325 mg","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"Ranbaxy","nafdac_number_raw":"B4-6109","nafdac_status_raw":"Active","components_candidate":[{"ingredient_raw":"Ibuprofen","strength_raw":"400 mg"},{"ingredient_raw":"Paracetamol","strength_raw":"325 mg"}],"quality_flags":[]}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nafdac_human_medicines', 'nafdac:5545',
    repeat('8',64), 'brustan-extra-capsule', 'Active', 'pending_admin_review', NULL,
    '{"product_name_display":"Brustan Extra Capsules","generic_ingredient_raw":"Ibuprofen; Paracetamol; Caffeine","strength_raw":"200 mg; 325 mg; 30 mg","dosage_form_raw":"Capsule","route_raw":"Oral","manufacturer_name":"Ranbaxy","nafdac_number_raw":"A4-BRUSTAN-EXTRA","nafdac_status_raw":"Active","components_candidate":[{"ingredient_raw":"Ibuprofen","strength_raw":"200 mg"},{"ingredient_raw":"Paracetamol","strength_raw":"325 mg"},{"ingredient_raw":"Caffeine","strength_raw":"30 mg"}],"quality_flags":[]}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nafdac_other_regulated_products', 'nafdac:other',
    repeat('9',64), 'other-fingerprint', 'Active', 'pending_admin_review', NULL,
    '{"product_name_display":"Other Regulated Item","product_category_raw":"Device","nafdac_status_raw":"Active"}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nigeria_market_candidates', 'market:medicine',
    repeat('a',64), NULL, 'not_checked_product_by_product', 'identity_and_regulatory_review_required',
    'https://example.invalid/market-medicine',
    '{"product_name_raw":"Market Medicine","scope_candidate":"medicine_candidate","regulatory_status":"not_checked_product_by_product"}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'nigeria_market_candidates', 'market:fmcg',
    repeat('b',64), NULL, 'not_checked_product_by_product', 'identity_and_regulatory_review_required',
    'https://example.invalid/market-fmcg',
    '{"product_name_raw":"Market FMCG","scope_candidate":"non_medicine_or_device","regulatory_status":"not_checked_product_by_product"}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'unregistered_and_flagged_products', 'alert:test',
    repeat('c',64), NULL, 'unregistered_product', 'regulatory_alert_hold',
    'https://nafdac.gov.ng/example-alert',
    '{"product_name":"Held Product","status_at_alert":"unregistered_product","sellable":false,"review_status":"regulatory_alert_hold","alert_scope_note":"Exact product only"}'
  ),
  (
    'f7010000-0000-4000-8000-000000000001', 'priority_alias_review', 'alias:daktarcort',
    repeat('d',64), NULL, NULL, 'manual_review', 'https://example.invalid/daktacort',
    '{"input_term":"Daktarcort","candidate_term":"Daktacort","relationship":"possible_typo","auto_correct":false}'
  );

SELECT lives_ok(
  $$SELECT * FROM public.reconcile_catalogue_source_snapshot('f7010000-0000-4000-8000-000000000001')$$,
  'a snapshot reconciles in one set-based call'
);

SELECT is(
  (SELECT queue_type FROM public.catalogue_reconciliation_queue WHERE record_id = 'nafdac:5826'),
  'existing_identity_enrichment',
  'unique NRN plus agreeing identity proposes existing enrichment'
);
SELECT is(
  (SELECT candidate_product_id FROM public.catalogue_reconciliation_queue WHERE record_id = 'nafdac:5826'),
  'f7000000-0000-4000-8000-000000000001'::uuid,
  'existing enrichment points to the exact product'
);
SELECT is(
  (SELECT queue_type FROM public.catalogue_reconciliation_queue WHERE record_id = 'nafdac:new'),
  'candidate_new_identity',
  'clean active evidence with no match becomes a reviewable new candidate'
);
SELECT is(
  (SELECT queue_type FROM public.catalogue_reconciliation_queue WHERE record_id = 'nafdac:inactive'),
  'ambiguous_conflicting_match',
  'inactive records cannot become new or existing identity proposals'
);
SELECT ok(
  (SELECT conflict_reasons @> ARRAY['source_inactive']::text[]
   FROM public.catalogue_reconciliation_queue WHERE record_id = 'nafdac:inactive'),
  'inactive status is carried as a blocking reason'
);
SELECT is(
  (SELECT COUNT(*) FROM public.catalogue_reconciliation_queue
   WHERE record_id IN ('nafdac:repeat-a', 'nafdac:repeat-b')
     AND queue_type = 'ambiguous_conflicting_match'
     AND conflict_reasons @> ARRAY['repeated_source_nrn']::text[]),
  2::bigint,
  'every member of a repeated NRN group stays unresolved'
);
SELECT is(
  (SELECT COUNT(*) FROM public.catalogue_reconciliation_queue
   WHERE record_id IN ('nafdac:6053', 'nafdac:6052', 'nafdac:4743', 'nafdac:5545')),
  4::bigint,
  'all four Brustan presentations remain separate review identities'
);
SELECT is(
  (SELECT COUNT(DISTINCT record_id) FROM public.catalogue_reconciliation_queue
   WHERE record_id IN ('nafdac:6053', 'nafdac:6052', 'nafdac:4743', 'nafdac:5545')),
  4::bigint,
  'Brustan names, strengths, forms, and combinations are not collapsed'
);
SELECT is(
  (SELECT queue_type FROM public.catalogue_reconciliation_queue WHERE record_id = 'nafdac:other'),
  'non_human_non_medicine_scope',
  'other regulated products stay outside the medicine catalogue'
);
SELECT is(
  (SELECT queue_type FROM public.catalogue_reconciliation_queue WHERE record_id = 'market:medicine'),
  'ambiguous_conflicting_match',
  'market medicine observations require identity and registration review'
);
SELECT is(
  (SELECT queue_type FROM public.catalogue_reconciliation_queue WHERE record_id = 'market:fmcg'),
  'non_human_non_medicine_scope',
  'market non-medicine items stay outside medicine scope'
);
SELECT ok(
  (SELECT conflict_reasons @> ARRAY['regulatory_alert_hold']::text[]
   FROM public.catalogue_reconciliation_queue WHERE record_id = 'alert:test'),
  'official alert holds are explicit blockers'
);
SELECT ok(
  (SELECT payload->>'input_term' = 'Daktarcort'
      AND payload->>'candidate_term' = 'Daktacort'
      AND payload->>'auto_correct' = 'false'
   FROM public.catalogue_source_records WHERE record_id = 'alias:daktarcort')
  AND NOT EXISTS (
    SELECT 1 FROM public.catalogue_reconciliation_queue WHERE record_id = 'alias:daktarcort'
  ),
  'Daktarcort is preserved as a non-automatic typo suggestion'
);

SELECT lives_ok(
  $$SELECT * FROM public.reconcile_catalogue_source_snapshot('f7010000-0000-4000-8000-000000000001')$$,
  're-running reconciliation is idempotent'
);
SELECT is(
  (SELECT COUNT(*) FROM public.catalogue_reconciliation_queue
   WHERE snapshot_id = 'f7010000-0000-4000-8000-000000000001'),
  13::bigint,
  'reconciliation retry creates no duplicate queue rows'
);
SELECT is(
  (SELECT COUNT(*) FROM public.products),
  (SELECT count + 1 FROM product_count_before),
  'reconciliation does not mutate the product catalogue'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
END
$$;
SET LOCAL ROLE service_role;
SELECT throws_ok(
  format(
    'SELECT public.set_catalogue_reconciliation_decision(%L, %L, NULL, %L)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'nafdac:inactive'),
    'approved', 'must remain blocked'
  ),
  'P0001', 'This source record has unresolved safety or identity requirements',
  'inactive source evidence cannot be approved'
);
SELECT throws_ok(
  format(
    'SELECT public.set_catalogue_reconciliation_decision(%L, %L, NULL, %L)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'nafdac:new'),
    'approved', 'route and release model is incomplete'
  ),
  'P0001', 'This source record has unresolved safety or identity requirements',
  'a clean candidate cannot be approved before route and release are modelled'
);
SELECT lives_ok(
  format(
    'SELECT public.set_catalogue_reconciliation_decision(%L, %L, NULL, %L)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'nafdac:new'),
    'held', 'needs clinical review'
  ),
  'an authorized decision is recorded through the RPC'
);
RESET ROLE;
SELECT is(
  (SELECT COUNT(*) FROM public.catalogue_reconciliation_audit audit
   JOIN public.catalogue_reconciliation_queue queue ON queue.id = audit.queue_id
   WHERE queue.record_id = 'nafdac:new'),
  1::bigint,
  'decision changes are append-only audited'
);

SELECT * FROM finish();
ROLLBACK;

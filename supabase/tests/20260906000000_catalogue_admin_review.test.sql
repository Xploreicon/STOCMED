BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, authenticated, anon;
SET LOCAL search_path = public, extensions, auth, pg_temp;
SELECT no_plan();

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at
) VALUES
  ('00000000-0000-0000-0000-000000000000','f6000000-0000-4000-8000-000000000001','authenticated','authenticated','catalogue-review-admin@stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW(),NOW()),
  ('00000000-0000-0000-0000-000000000000','f6000000-0000-4000-8000-000000000002','authenticated','authenticated','catalogue-review-pharmacist@stocmed.invalid','',NOW(),'','','','','{}','{}',NOW(),NOW(),NOW());

SELECT set_config('app.pilot_role_provenance_reset', 'on', TRUE);
INSERT INTO public.users (
  user_id, email, full_name, role, is_admin, admin_authorized_at,
  admin_authorization_basis, is_licensed_pharmacist,
  pharmacist_license_number, pharmacist_license_verified_at,
  pharmacist_license_verification_basis
) VALUES
  ('f6000000-0000-4000-8000-000000000001','catalogue-review-admin@stocmed.invalid','Catalogue Review Admin','patient',TRUE,NOW(),'pgTAP admin authorization',FALSE,NULL,NULL,NULL),
  ('f6000000-0000-4000-8000-000000000002','catalogue-review-pharmacist@stocmed.invalid','Catalogue Review Pharmacist','pharmacy',FALSE,NULL,NULL,TRUE,'PCN-TEST-6002',NOW(),'pgTAP pharmacist license');
SELECT set_config('app.pilot_role_provenance_reset', 'off', TRUE);

INSERT INTO public.products (
  id, generic_name, brand_name, manufacturer, strength, dosage_form, category,
  pack_size, nafdac_number, atc_code, requires_prescription, is_verified
) VALUES (
  'f6000000-0000-4000-8000-000000000010',
  'Review Existing Ingredient', 'Review Existing Brand', 'Old Manufacturer',
  '5 mg', 'tablet', 'Others', '1 x 10', 'A4-REVIEW-EXIST', NULL, FALSE, TRUE
);

CREATE TEMP TABLE catalogue_review_products_before AS
SELECT COUNT(*)::INTEGER AS row_count FROM public.products;
GRANT SELECT ON catalogue_review_products_before TO authenticated;

INSERT INTO public.catalogue_source_snapshots (
  id, source_key, snapshot_date, package_sha256, manifest
) VALUES (
  'f6000000-0000-4000-8000-000000000020',
  'catalogue-review-test', '2026-09-06', repeat('6', 64),
  '{"snapshot_date":"2026-09-06","files":[]}'::JSONB
);

INSERT INTO public.catalogue_source_records (
  snapshot_id, dataset, record_id, record_sha256, source_identity_fingerprint,
  source_status, review_status, source_url, payload
) VALUES
  (
    'f6000000-0000-4000-8000-000000000020','nafdac_human_medicines','review:new',repeat('1',64),'review-new','Active','pending_admin_review','https://greenbook.nafdac.gov.ng/products/details/review-new',
    '{"product_name_display":"Review New Brand","generic_ingredient_raw":"Review New Ingredient","strength_raw":"10 mg","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"Review Manufacturer","applicant_name":"Review Applicant","pack_size_raw":"1 x 20","nafdac_number_raw":"A4-REVIEW-NEW","nafdac_status_raw":"Active","atc_code_raw":"N02BE01","marketing_category_id_raw":1,"components_candidate":[{"ingredient_raw":"Review New Ingredient","strength_raw":"10 mg"}],"quality_flags":[]}'
  ),
  (
    'f6000000-0000-4000-8000-000000000020','nafdac_human_medicines','review:existing',repeat('2',64),'review-existing','Active','pending_admin_review','https://greenbook.nafdac.gov.ng/products/details/review-existing',
    '{"product_name_display":"Review Existing Brand","generic_ingredient_raw":"Review Existing Ingredient","strength_raw":"5 mg","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"Old Manufacturer","applicant_name":"Review Applicant","pack_size_raw":"1 x 10","nafdac_number_raw":"A4-REVIEW-EXIST","nafdac_status_raw":"Active","atc_code_raw":"N02BE01","marketing_category_id_raw":1,"components_candidate":[{"ingredient_raw":"Review Existing Ingredient","strength_raw":"5 mg"}],"quality_flags":[]}'
  ),
  (
    'f6000000-0000-4000-8000-000000000020','nafdac_human_medicines','review:incomplete',repeat('3',64),'review-incomplete','Active','pending_admin_review',NULL,
    '{"product_name_display":"Review Incomplete","generic_ingredient_raw":"Review Incomplete Ingredient","strength_raw":"","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"Review Manufacturer","nafdac_number_raw":"A4-REVIEW-INCOMPLETE","nafdac_status_raw":"Active","components_candidate":[],"quality_flags":["missing_or_unresolved_strength"]}'
  ),
  (
    'f6000000-0000-4000-8000-000000000020','nafdac_human_medicines','review:inactive',repeat('4',64),'review-inactive','Inactive','pending_admin_review',NULL,
    '{"product_name_display":"Review Inactive","generic_ingredient_raw":"Review Inactive Ingredient","strength_raw":"20 mg","dosage_form_raw":"Tablet","route_raw":"Oral","manufacturer_name":"Review Manufacturer","nafdac_number_raw":"A4-REVIEW-INACTIVE","nafdac_status_raw":"Inactive","components_candidate":[{"ingredient_raw":"Review Inactive Ingredient","strength_raw":"20 mg"}],"quality_flags":[]}'
  );

SELECT lives_ok(
  $$SELECT * FROM public.reconcile_catalogue_source_snapshot('f6000000-0000-4000-8000-000000000020')$$,
  'review test snapshot reconciles'
);

SELECT has_table('public', 'catalogue_reconciliation_edits', 'review edits table exists');
SELECT has_table('public', 'catalogue_product_promotions', 'promotion provenance table exists');
SELECT ok(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'public.promote_catalogue_reconciliation_candidate(uuid)'::regprocedure),
  'promotion RPC is SECURITY DEFINER'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.promote_catalogue_reconciliation_candidate(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.promote_catalogue_reconciliation_candidate(uuid)', 'EXECUTE'),
  'promotion RPC is callable only by an authenticated role and checks admin provenance internally'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.catalogue_reconciliation_edits', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.catalogue_product_promotions', 'INSERT'),
  'browser roles cannot bypass the review and promotion RPCs with direct writes'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f6000000-0000-4000-8000-000000000002', TRUE);
END $$;
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.get_catalogue_reconciliation_review('candidate_new_identity','pending',NULL,25,0)$$,
  'P0001', 'Administrator authorization required',
  'a licensed pharmacist without admin provenance cannot read the review RPC'
);
SELECT throws_ok(
  format(
    'SELECT public.review_catalogue_reconciliation_candidate(%L,%L)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'review:new'),
    'approved'
  ),
  'P0001', 'Administrator authorization required',
  'a pharmacist cannot approve catalogue evidence'
);
SELECT is(
  (SELECT COUNT(*) FROM public.catalogue_reconciliation_queue),
  0::BIGINT,
  'RLS exposes no staging queue rows to a non-admin pharmacist'
);

RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', 'f6000000-0000-4000-8000-000000000001', TRUE);
END $$;
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT (public.get_catalogue_reconciliation_review(
    'candidate_new_identity','pending','review:new',25,0
  )->>'total')::INTEGER),
  1,
  'authorized admin reads the filtered new-identity queue'
);
SELECT is(
  (SELECT public.get_catalogue_reconciliation_review(
    'candidate_new_identity','pending','review:new',25,0
  )->'rows'->0->>'can_approve'),
  'true',
  'route, release and applicant provenance no longer jam a complete identity'
);
SELECT throws_ok(
  format(
    'SELECT public.review_catalogue_reconciliation_candidate(%L,%L)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'review:incomplete'),
    'approved'
  ),
  'P0001', 'Catalogue approval blocked: ambiguous_resolution_evidence_required, missing_strength, resolution_action_required, unresolved:missing_or_unresolved_strength, unresolved:missing_strength',
  'a missing strength cannot be approved'
);
SELECT throws_ok(
  format(
    'SELECT public.review_catalogue_reconciliation_candidate(%L,%L)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'review:inactive'),
    'approved'
  ),
  'P0001', 'Catalogue approval blocked: ambiguous_resolution_evidence_required, resolution_action_required, source_inactive, source_not_active',
  'an inactive record cannot be approved'
);
SELECT throws_ok(
  format(
    'SELECT public.review_catalogue_reconciliation_candidate(%L,%L,%L::jsonb,NULL,NULL,NULL,NULL,NULL)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'review:new'),
    'rejected', '{}'
  ),
  'P0001', 'A reason is required for reject or hold decisions',
  'reject requires a reason'
);

SELECT lives_ok(
  format(
    'SELECT public.review_catalogue_reconciliation_candidate(%L,%L)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'review:new'),
    'approved'
  ),
  'a complete active new identity can be approved'
);
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.products),
  (SELECT row_count FROM catalogue_review_products_before),
  'approval records a decision without writing products'
);
SELECT is(
  (SELECT COUNT(*) FROM public.catalogue_reconciliation_audit audit
   JOIN public.catalogue_reconciliation_queue queue ON queue.id = audit.queue_id
   WHERE queue.record_id = 'review:new' AND audit.new_status = 'approved'),
  1::BIGINT,
  'approval is append-only audited'
);

SELECT lives_ok(
  format(
    'SELECT public.promote_catalogue_reconciliation_candidate(%L)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'review:new')
  ),
  'an approved new identity promotes through the admin RPC'
);
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.products),
  (SELECT row_count + 1 FROM catalogue_review_products_before),
  'one approved new identity inserts exactly one product'
);
SELECT ok(
  (SELECT product.is_verified
   FROM public.catalogue_product_promotions promotion
   JOIN public.products product ON product.id = promotion.product_id
   WHERE promotion.record_id = 'review:new'),
  'active official evidence plus explicit admin approval uses the verified convention'
);
SELECT ok(
  (SELECT source.payload->>'route_raw' = 'Oral'
      AND source.payload->>'applicant_name' = 'Review Applicant'
   FROM public.catalogue_product_promotions promotion
   JOIN public.catalogue_source_records source
     ON source.snapshot_id = promotion.snapshot_id
    AND source.dataset = promotion.dataset
    AND source.record_id = promotion.record_id
   WHERE promotion.record_id = 'review:new'),
  'route and applicant remain linked provenance rather than discarded blockers'
);
SELECT is(
  (SELECT public.promote_catalogue_reconciliation_candidate(queue.id)->>'idempotent_noop'
   FROM public.catalogue_reconciliation_queue queue WHERE queue.record_id = 'review:new'),
  'true',
  're-running promotion is an idempotent no-op'
);
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.products),
  (SELECT row_count + 1 FROM catalogue_review_products_before),
  'idempotent replay creates no duplicate product'
);

SELECT lives_ok(
  format(
    'SELECT public.review_catalogue_reconciliation_candidate(%L,%L,%L::jsonb)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'review:existing'),
    'approved', '{"manufacturer":"New Manufacturer"}'
  ),
  'a complete existing identity enrichment can be approved'
);
SELECT lives_ok(
  format(
    'SELECT public.promote_catalogue_reconciliation_candidate(%L)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'review:existing')
  ),
  'an approved enrichment updates its linked product'
);
SELECT is(
  (SELECT manufacturer FROM public.products
   WHERE id = 'f6000000-0000-4000-8000-000000000010'),
  'New Manufacturer',
  'enrichment applies the reviewed diff to the existing product'
);
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.products),
  (SELECT row_count + 1 FROM catalogue_review_products_before),
  'enrichment does not insert a duplicate product'
);
SELECT ok(
  (SELECT promotion.promotion_action = 'enrich'
      AND promotion.product_before->>'manufacturer' = 'Old Manufacturer'
      AND promotion.product_after->>'manufacturer' = 'New Manufacturer'
   FROM public.catalogue_product_promotions promotion
   WHERE promotion.record_id = 'review:existing'),
  'enrichment provenance records its before and after values'
);
SELECT throws_ok(
  format(
    'SELECT public.promote_catalogue_reconciliation_candidate(%L)',
    (SELECT id FROM public.catalogue_reconciliation_queue WHERE record_id = 'review:incomplete')
  ),
  'P0001', 'Only an explicitly approved candidate can be promoted',
  'unapproved rows cannot reach products'
);
SELECT is(
  (SELECT COUNT(*) FROM public.catalogue_product_promotions),
  2::BIGINT,
  'only the two explicitly approved rows have promotion provenance'
);

SELECT * FROM finish();
ROLLBACK;

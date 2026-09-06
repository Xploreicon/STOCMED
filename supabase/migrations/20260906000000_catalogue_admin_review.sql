-- Human-gated review and idempotent promotion for staged catalogue evidence.
-- Source records remain immutable. A decision never writes public.products;
-- promotion is a separate, explicit administrator action.

BEGIN;

CREATE TABLE public.catalogue_reconciliation_edits (
  queue_id UUID PRIMARY KEY
    REFERENCES public.catalogue_reconciliation_queue(id) ON DELETE CASCADE,
  generic_name TEXT,
  brand_name TEXT,
  manufacturer TEXT,
  strength TEXT,
  dosage_form TEXT,
  category TEXT,
  pack_size TEXT,
  nafdac_number TEXT,
  atc_code TEXT,
  requires_prescription BOOLEAN,
  resolution_action TEXT CHECK (
    resolution_action IS NULL
    OR resolution_action IN ('new_identity', 'existing_enrichment')
  ),
  target_product_id UUID REFERENCES public.products(id),
  resolved_conflict_reasons TEXT[] NOT NULL DEFAULT '{}',
  resolution_evidence JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(resolution_evidence) = 'object'),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    resolution_action <> 'existing_enrichment'
    OR target_product_id IS NOT NULL
  ),
  CHECK (
    resolution_action <> 'new_identity'
    OR target_product_id IS NULL
  )
);

CREATE INDEX catalogue_reconciliation_edits_target_idx
  ON public.catalogue_reconciliation_edits(target_product_id)
  WHERE target_product_id IS NOT NULL;

CREATE TABLE public.catalogue_product_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL UNIQUE
    REFERENCES public.catalogue_reconciliation_queue(id) ON DELETE RESTRICT,
  snapshot_id UUID NOT NULL,
  dataset TEXT NOT NULL,
  record_id TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  promotion_action TEXT NOT NULL
    CHECK (promotion_action IN ('insert', 'enrich')),
  approving_admin_id UUID NOT NULL REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ NOT NULL,
  promoted_by UUID NOT NULL REFERENCES auth.users(id),
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fields_applied JSONB NOT NULL CHECK (jsonb_typeof(fields_applied) = 'object'),
  product_before JSONB CHECK (
    product_before IS NULL OR jsonb_typeof(product_before) = 'object'
  ),
  product_after JSONB NOT NULL CHECK (jsonb_typeof(product_after) = 'object'),
  verification_basis TEXT NOT NULL DEFAULT 'active_nafdac_admin_approved',
  FOREIGN KEY (snapshot_id, dataset, record_id)
    REFERENCES public.catalogue_source_records(snapshot_id, dataset, record_id)
    ON DELETE RESTRICT,
  UNIQUE (snapshot_id, dataset, record_id)
);

CREATE INDEX catalogue_product_promotions_product_idx
  ON public.catalogue_product_promotions(product_id, promoted_at DESC);

ALTER TABLE public.catalogue_reconciliation_audit
  ADD COLUMN previous_review_values JSONB,
  ADD COLUMN new_review_values JSONB,
  ADD COLUMN resolved_conflict_reasons TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN resolution_evidence JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE public.catalogue_reconciliation_audit
  ADD CONSTRAINT catalogue_reconciliation_audit_previous_review_object
    CHECK (
      previous_review_values IS NULL
      OR jsonb_typeof(previous_review_values) = 'object'
    ),
  ADD CONSTRAINT catalogue_reconciliation_audit_new_review_object
    CHECK (
      new_review_values IS NULL
      OR jsonb_typeof(new_review_values) = 'object'
    ),
  ADD CONSTRAINT catalogue_reconciliation_audit_resolution_evidence_object
    CHECK (jsonb_typeof(resolution_evidence) = 'object');

COMMENT ON TABLE public.catalogue_reconciliation_edits IS
  'Administrator-reviewed product identity proposed from immutable source evidence.';
COMMENT ON TABLE public.catalogue_product_promotions IS
  'One immutable provenance record per explicit queue-to-products promotion.';
COMMENT ON COLUMN public.catalogue_product_promotions.verification_basis IS
  'Active official NAFDAC evidence explicitly approved by an authorized StocMed administrator.';

CREATE OR REPLACE FUNCTION public.catalogue_category_for_atc(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN UPPER(TRIM(COALESCE(value, ''))) LIKE 'N02%' THEN 'Analgesics'
    WHEN UPPER(TRIM(COALESCE(value, ''))) LIKE 'J01%' THEN 'Antibiotics'
    WHEN UPPER(TRIM(COALESCE(value, ''))) LIKE 'P01B%' THEN 'Antimalarials'
    WHEN LEFT(UPPER(TRIM(COALESCE(value, ''))), 3) IN ('C02','C03','C07','C08','C09')
      THEN 'Antihypertensives'
    WHEN UPPER(TRIM(COALESCE(value, ''))) LIKE 'A10%' THEN 'Diabetes'
    WHEN UPPER(TRIM(COALESCE(value, ''))) LIKE 'R06%' THEN 'Respiratory'
    WHEN LEFT(UPPER(TRIM(COALESCE(value, ''))), 3) IN ('A02','A03','A04','A06','A07','A09')
      THEN 'Gastrointestinal'
    WHEN LEFT(UPPER(TRIM(COALESCE(value, ''))), 3) IN ('A11','B03') THEN 'Vitamins'
    ELSE 'Others'
  END;
$$;

CREATE OR REPLACE FUNCTION public.initialize_catalogue_reconciliation_edit(
  p_queue_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.catalogue_reconciliation_edits (
    queue_id, generic_name, brand_name, manufacturer, strength, dosage_form,
    category, pack_size, nafdac_number, atc_code, requires_prescription,
    resolution_action, target_product_id
  )
  SELECT
    queue.id,
    NULLIF(TRIM(source.payload->>'generic_ingredient_raw'), ''),
    NULLIF(TRIM(COALESCE(
      source.payload->>'product_name_display',
      source.payload->>'product_name_raw',
      source.payload->>'product_name'
    )), ''),
    NULLIF(TRIM(source.payload->>'manufacturer_name'), ''),
    NULLIF(TRIM(source.payload->>'strength_raw'), ''),
    LOWER(NULLIF(TRIM(source.payload->>'dosage_form_raw'), '')),
    CASE WHEN source.dataset = 'nafdac_human_medicines'
      THEN public.catalogue_category_for_atc(source.payload->>'atc_code_raw')
      ELSE NULL END,
    NULLIF(TRIM(source.payload->>'pack_size_raw'), ''),
    NULLIF(TRIM(source.payload->>'nafdac_number_raw'), ''),
    NULLIF(UPPER(TRIM(source.payload->>'atc_code_raw')), ''),
    CASE source.payload->>'marketing_category_id_raw'
      WHEN '1' THEN TRUE
      WHEN '2' THEN FALSE
      ELSE NULL
    END,
    CASE queue.queue_type
      WHEN 'existing_identity_enrichment' THEN 'existing_enrichment'
      WHEN 'candidate_new_identity' THEN 'new_identity'
      ELSE NULL
    END,
    CASE WHEN queue.queue_type = 'existing_identity_enrichment'
      THEN queue.candidate_product_id ELSE NULL END
  FROM public.catalogue_reconciliation_queue queue
  JOIN public.catalogue_source_records source
    ON source.snapshot_id = queue.snapshot_id
   AND source.dataset = queue.dataset
   AND source.record_id = queue.record_id
  WHERE queue.id = p_queue_id
  ON CONFLICT (queue_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.initialize_catalogue_reconciliation_edit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.initialize_catalogue_reconciliation_edit(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalogue_reconciliation_queue_initialize_edit
AFTER INSERT ON public.catalogue_reconciliation_queue
FOR EACH ROW EXECUTE FUNCTION public.initialize_catalogue_reconciliation_edit_trigger();

-- Route, release and applicant information stays in immutable source payloads
-- and promotion provenance. Its absence from products no longer jams every row.
UPDATE public.catalogue_reconciliation_queue
SET conflict_reasons = ARRAY_REMOVE(
  ARRAY_REMOVE(conflict_reasons, 'route_and_release_not_modelled_in_products'),
  'applicant_authorization_not_modelled_in_products'
);

INSERT INTO public.catalogue_reconciliation_edits (queue_id)
SELECT queue.id
FROM public.catalogue_reconciliation_queue queue
ON CONFLICT (queue_id) DO NOTHING;

UPDATE public.catalogue_reconciliation_edits edit
SET generic_name = NULLIF(TRIM(source.payload->>'generic_ingredient_raw'), ''),
    brand_name = NULLIF(TRIM(COALESCE(
      source.payload->>'product_name_display',
      source.payload->>'product_name_raw',
      source.payload->>'product_name'
    )), ''),
    manufacturer = NULLIF(TRIM(source.payload->>'manufacturer_name'), ''),
    strength = NULLIF(TRIM(source.payload->>'strength_raw'), ''),
    dosage_form = LOWER(NULLIF(TRIM(source.payload->>'dosage_form_raw'), '')),
    category = CASE WHEN source.dataset = 'nafdac_human_medicines'
      THEN public.catalogue_category_for_atc(source.payload->>'atc_code_raw')
      ELSE NULL END,
    pack_size = NULLIF(TRIM(source.payload->>'pack_size_raw'), ''),
    nafdac_number = NULLIF(TRIM(source.payload->>'nafdac_number_raw'), ''),
    atc_code = NULLIF(UPPER(TRIM(source.payload->>'atc_code_raw')), ''),
    requires_prescription = CASE source.payload->>'marketing_category_id_raw'
      WHEN '1' THEN TRUE
      WHEN '2' THEN FALSE
      ELSE NULL
    END,
    resolution_action = CASE queue.queue_type
      WHEN 'existing_identity_enrichment' THEN 'existing_enrichment'
      WHEN 'candidate_new_identity' THEN 'new_identity'
      ELSE NULL
    END,
    target_product_id = CASE WHEN queue.queue_type = 'existing_identity_enrichment'
      THEN queue.candidate_product_id ELSE NULL END,
    updated_at = NOW()
FROM public.catalogue_reconciliation_queue queue
JOIN public.catalogue_source_records source
  ON source.snapshot_id = queue.snapshot_id
 AND source.dataset = queue.dataset
 AND source.record_id = queue.record_id
WHERE edit.queue_id = queue.id;

CREATE OR REPLACE FUNCTION public.catalogue_reconciliation_approval_blockers(
  p_queue_id UUID
)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue public.catalogue_reconciliation_queue;
  v_source public.catalogue_source_records;
  v_edit public.catalogue_reconciliation_edits;
  v_reason TEXT;
  v_blockers TEXT[] := '{}';
  v_ignored_reasons CONSTANT TEXT[] := ARRAY[
    'route_and_release_not_modelled_in_products',
    'applicant_authorization_not_modelled_in_products',
    'missing_route',
    'missing_or_unresolved_route',
    'missing_manufacturer',
    'missing_or_unresolved_manufacturer',
    'missing_product_name'
  ];
  v_absolute_reasons CONSTANT TEXT[] := ARRAY[
    'source_inactive',
    'regulatory_alert_hold',
    'non_human_greenbook_scope',
    'market_observed_registration_unresolved',
    'market_non_medicine_or_unresolved_scope'
  ];
BEGIN
  SELECT * INTO v_queue
  FROM public.catalogue_reconciliation_queue queue
  WHERE queue.id = p_queue_id;
  IF NOT FOUND THEN
    RETURN ARRAY['unknown_queue_row'];
  END IF;

  SELECT * INTO v_source
  FROM public.catalogue_source_records source
  WHERE source.snapshot_id = v_queue.snapshot_id
    AND source.dataset = v_queue.dataset
    AND source.record_id = v_queue.record_id;

  SELECT * INTO v_edit
  FROM public.catalogue_reconciliation_edits edit
  WHERE edit.queue_id = p_queue_id;
  IF NOT FOUND THEN
    RETURN ARRAY['review_fields_not_initialized'];
  END IF;

  IF v_source.dataset <> 'nafdac_human_medicines' THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'non_nafdac_human_source');
  END IF;
  IF COALESCE(v_source.source_status, '') <> 'Active' THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'source_not_active');
  END IF;
  IF v_queue.queue_type = 'non_human_non_medicine_scope' THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'non_human_non_medicine_scope');
  END IF;

  IF NULLIF(TRIM(v_edit.generic_name), '') IS NULL THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'missing_ingredient');
  END IF;
  IF NULLIF(TRIM(v_edit.strength), '') IS NULL THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'missing_strength');
  END IF;
  IF NULLIF(TRIM(v_edit.dosage_form), '') IS NULL THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'missing_dosage_form');
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.dosage_forms form
    WHERE form.name = LOWER(TRIM(v_edit.dosage_form))
  ) THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'unsupported_dosage_form');
  END IF;
  IF NULLIF(TRIM(v_edit.nafdac_number), '') IS NULL THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'missing_nafdac_number');
  END IF;
  IF v_edit.category IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_categories category
    WHERE category.name = v_edit.category
  ) THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'unsupported_category');
  END IF;

  IF v_edit.resolution_action IS NULL THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'resolution_action_required');
  ELSIF v_edit.resolution_action = 'existing_enrichment'
    AND v_edit.target_product_id IS NULL THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'target_product_required');
  END IF;

  FOREACH v_reason IN ARRAY COALESCE(v_queue.conflict_reasons, '{}') LOOP
    IF v_reason = ANY(v_ignored_reasons) THEN
      CONTINUE;
    END IF;
    IF v_reason = ANY(v_absolute_reasons) THEN
      v_blockers := ARRAY_APPEND(v_blockers, v_reason);
      CONTINUE;
    END IF;
    IF NOT v_reason = ANY(COALESCE(v_edit.resolved_conflict_reasons, '{}')) THEN
      v_blockers := ARRAY_APPEND(v_blockers, 'unresolved:' || v_reason);
    END IF;
  END LOOP;

  IF CARDINALITY(COALESCE(v_edit.resolved_conflict_reasons, '{}')) > 0
    AND NULLIF(TRIM(v_edit.resolution_evidence->>'summary'), '') IS NULL THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'resolution_evidence_required');
  END IF;
  IF v_queue.queue_type = 'ambiguous_conflicting_match'
    AND NULLIF(TRIM(v_edit.resolution_evidence->>'summary'), '') IS NULL THEN
    v_blockers := ARRAY_APPEND(v_blockers, 'ambiguous_resolution_evidence_required');
  END IF;

  RETURN COALESCE((
    SELECT ARRAY_AGG(DISTINCT blocker ORDER BY blocker)
    FROM UNNEST(v_blockers) blocker
  ), '{}');
END;
$$;

CREATE OR REPLACE FUNCTION public.review_catalogue_reconciliation_candidate(
  p_queue_id UUID,
  p_decision_status TEXT,
  p_edit JSONB DEFAULT '{}'::JSONB,
  p_resolved_conflict_reasons TEXT[] DEFAULT NULL,
  p_resolution_evidence JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_resolution_action TEXT DEFAULT NULL,
  p_target_product_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue public.catalogue_reconciliation_queue;
  v_before_queue public.catalogue_reconciliation_queue;
  v_before_edit public.catalogue_reconciliation_edits;
  v_after_edit public.catalogue_reconciliation_edits;
  v_blockers TEXT[];
  v_unknown_key TEXT;
  v_reason TEXT;
  v_resolved TEXT[];
BEGIN
  IF NOT public.authenticated_user_is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;
  IF p_decision_status NOT IN ('pending', 'approved', 'rejected', 'held') THEN
    RAISE EXCEPTION 'Invalid catalogue reconciliation decision';
  END IF;
  IF p_edit IS NULL OR jsonb_typeof(p_edit) <> 'object' THEN
    RAISE EXCEPTION 'Review edit must be a JSON object';
  END IF;
  IF p_resolution_evidence IS NOT NULL
    AND jsonb_typeof(p_resolution_evidence) <> 'object' THEN
    RAISE EXCEPTION 'Resolution evidence must be a JSON object';
  END IF;
  IF p_resolution_action IS NOT NULL
    AND p_resolution_action NOT IN ('new_identity', 'existing_enrichment') THEN
    RAISE EXCEPTION 'Invalid resolution action';
  END IF;
  IF p_decision_status IN ('rejected', 'held')
    AND NULLIF(TRIM(p_notes), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for reject or hold decisions';
  END IF;

  SELECT key INTO v_unknown_key
  FROM jsonb_object_keys(p_edit) key
  WHERE key NOT IN (
    'generic_name', 'brand_name', 'manufacturer', 'strength', 'dosage_form',
    'category', 'pack_size', 'nafdac_number', 'atc_code',
    'requires_prescription'
  )
  LIMIT 1;
  IF v_unknown_key IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported review field: %', v_unknown_key;
  END IF;
  IF p_edit ? 'requires_prescription'
    AND p_edit->'requires_prescription' <> 'null'::JSONB
    AND jsonb_typeof(p_edit->'requires_prescription') <> 'boolean' THEN
    RAISE EXCEPTION 'requires_prescription must be boolean or null';
  END IF;

  SELECT * INTO v_queue
  FROM public.catalogue_reconciliation_queue queue
  WHERE queue.id = p_queue_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown catalogue reconciliation queue row';
  END IF;
  v_before_queue := v_queue;

  IF EXISTS (
    SELECT 1 FROM public.catalogue_product_promotions promotion
    WHERE promotion.queue_id = p_queue_id
  ) AND p_decision_status <> 'approved' THEN
    RAISE EXCEPTION 'A promoted catalogue decision cannot be changed';
  END IF;

  PERFORM public.initialize_catalogue_reconciliation_edit(p_queue_id);
  SELECT * INTO v_before_edit
  FROM public.catalogue_reconciliation_edits edit
  WHERE edit.queue_id = p_queue_id
  FOR UPDATE;

  v_resolved := CASE WHEN p_resolved_conflict_reasons IS NULL
    THEN v_before_edit.resolved_conflict_reasons
    ELSE COALESCE((
      SELECT ARRAY_AGG(DISTINCT reason ORDER BY reason)
      FROM UNNEST(p_resolved_conflict_reasons) reason
    ), '{}') END;

  FOREACH v_reason IN ARRAY COALESCE(v_resolved, '{}') LOOP
    IF NOT v_reason = ANY(COALESCE(v_queue.conflict_reasons, '{}')) THEN
      RAISE EXCEPTION 'Conflict reason is not present on this queue row: %', v_reason;
    END IF;
    IF v_reason IN (
      'source_inactive', 'regulatory_alert_hold', 'non_human_greenbook_scope',
      'market_observed_registration_unresolved',
      'market_non_medicine_or_unresolved_scope'
    ) THEN
      RAISE EXCEPTION 'This conflict cannot be resolved through catalogue review: %', v_reason;
    END IF;
  END LOOP;

  UPDATE public.catalogue_reconciliation_edits edit
  SET generic_name = CASE WHEN p_edit ? 'generic_name'
        THEN NULLIF(TRIM(p_edit->>'generic_name'), '') ELSE edit.generic_name END,
      brand_name = CASE WHEN p_edit ? 'brand_name'
        THEN NULLIF(TRIM(p_edit->>'brand_name'), '') ELSE edit.brand_name END,
      manufacturer = CASE WHEN p_edit ? 'manufacturer'
        THEN NULLIF(TRIM(p_edit->>'manufacturer'), '') ELSE edit.manufacturer END,
      strength = CASE WHEN p_edit ? 'strength'
        THEN NULLIF(TRIM(p_edit->>'strength'), '') ELSE edit.strength END,
      dosage_form = CASE WHEN p_edit ? 'dosage_form'
        THEN LOWER(NULLIF(TRIM(p_edit->>'dosage_form'), '')) ELSE edit.dosage_form END,
      category = CASE WHEN p_edit ? 'category'
        THEN NULLIF(TRIM(p_edit->>'category'), '') ELSE edit.category END,
      pack_size = CASE WHEN p_edit ? 'pack_size'
        THEN NULLIF(TRIM(p_edit->>'pack_size'), '') ELSE edit.pack_size END,
      nafdac_number = CASE WHEN p_edit ? 'nafdac_number'
        THEN NULLIF(TRIM(p_edit->>'nafdac_number'), '') ELSE edit.nafdac_number END,
      atc_code = CASE WHEN p_edit ? 'atc_code'
        THEN NULLIF(UPPER(TRIM(p_edit->>'atc_code')), '') ELSE edit.atc_code END,
      requires_prescription = CASE WHEN p_edit ? 'requires_prescription'
        THEN CASE WHEN p_edit->'requires_prescription' = 'null'::JSONB
          THEN NULL ELSE (p_edit->>'requires_prescription')::BOOLEAN END
        ELSE edit.requires_prescription END,
      resolution_action = COALESCE(p_resolution_action, edit.resolution_action),
      target_product_id = CASE
        WHEN COALESCE(p_resolution_action, edit.resolution_action) = 'new_identity' THEN NULL
        WHEN p_target_product_id IS NOT NULL THEN p_target_product_id
        ELSE edit.target_product_id END,
      resolved_conflict_reasons = COALESCE(v_resolved, '{}'),
      resolution_evidence = COALESCE(p_resolution_evidence, edit.resolution_evidence),
      updated_by = auth.uid(),
      updated_at = NOW()
  WHERE edit.queue_id = p_queue_id
  RETURNING * INTO v_after_edit;

  v_blockers := public.catalogue_reconciliation_approval_blockers(p_queue_id);
  IF p_decision_status = 'approved' AND CARDINALITY(v_blockers) > 0 THEN
    RAISE EXCEPTION 'Catalogue approval blocked: %', ARRAY_TO_STRING(v_blockers, ', ');
  END IF;

  UPDATE public.catalogue_reconciliation_queue queue
  SET decision_status = p_decision_status,
      candidate_product_id = CASE
        WHEN v_after_edit.resolution_action = 'existing_enrichment'
          THEN v_after_edit.target_product_id
        ELSE queue.candidate_product_id END,
      decided_by = CASE WHEN p_decision_status = 'pending' THEN NULL ELSE auth.uid() END,
      decided_at = CASE WHEN p_decision_status = 'pending' THEN NULL ELSE NOW() END,
      decision_notes = p_notes
  WHERE queue.id = p_queue_id
  RETURNING * INTO v_queue;

  INSERT INTO public.catalogue_reconciliation_audit (
    queue_id, actor_user_id, previous_status, new_status,
    previous_candidate_product_id, new_candidate_product_id, notes,
    previous_review_values, new_review_values,
    resolved_conflict_reasons, resolution_evidence
  ) VALUES (
    p_queue_id, auth.uid(), v_before_queue.decision_status, v_queue.decision_status,
    v_before_queue.candidate_product_id, v_queue.candidate_product_id, p_notes,
    TO_JSONB(v_before_edit), TO_JSONB(v_after_edit),
    v_after_edit.resolved_conflict_reasons, v_after_edit.resolution_evidence
  );

  RETURN JSONB_BUILD_OBJECT(
    'queue', TO_JSONB(v_queue),
    'review', TO_JSONB(v_after_edit),
    'approval_blockers', v_blockers
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_catalogue_reconciliation_decision(
  p_queue_id UUID,
  p_decision_status TEXT,
  p_candidate_product_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.catalogue_reconciliation_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result public.catalogue_reconciliation_queue;
BEGIN
  PERFORM public.review_catalogue_reconciliation_candidate(
    p_queue_id, p_decision_status, '{}'::JSONB, NULL, NULL, p_notes,
    NULL, p_candidate_product_id
  );
  SELECT * INTO v_result
  FROM public.catalogue_reconciliation_queue queue
  WHERE queue.id = p_queue_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_catalogue_reconciliation_review(
  p_queue_type TEXT DEFAULT 'existing_identity_enrichment',
  p_decision_status TEXT DEFAULT 'pending',
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.authenticated_user_is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;
  IF p_queue_type IS NOT NULL AND p_queue_type NOT IN (
    'existing_identity_enrichment', 'candidate_new_identity',
    'ambiguous_conflicting_match', 'non_human_non_medicine_scope'
  ) THEN
    RAISE EXCEPTION 'Invalid reconciliation queue type';
  END IF;
  IF p_decision_status IS NOT NULL
    AND p_decision_status NOT IN ('pending', 'approved', 'rejected', 'held') THEN
    RAISE EXCEPTION 'Invalid reconciliation decision status';
  END IF;
  IF p_limit < 1 OR p_limit > 100 OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid pagination';
  END IF;

  WITH filtered AS (
    SELECT
      queue.*,
      source.source_status,
      source.source_url,
      source.payload,
      edit.generic_name,
      edit.brand_name,
      edit.manufacturer,
      edit.strength,
      edit.dosage_form,
      edit.category,
      edit.pack_size,
      edit.nafdac_number,
      edit.atc_code,
      edit.requires_prescription,
      edit.resolution_action,
      edit.target_product_id,
      edit.resolved_conflict_reasons,
      edit.resolution_evidence,
      edit.updated_at AS review_updated_at,
      CASE WHEN product.id IS NULL THEN NULL ELSE TO_JSONB(product) - 'search_vector' END
        AS existing_product,
      promotion.product_id AS promoted_product_id,
      promotion.promotion_action,
      promotion.promoted_at,
      public.catalogue_reconciliation_approval_blockers(queue.id) AS approval_blockers
    FROM public.catalogue_reconciliation_queue queue
    JOIN public.catalogue_source_records source
      ON source.snapshot_id = queue.snapshot_id
     AND source.dataset = queue.dataset
     AND source.record_id = queue.record_id
    LEFT JOIN public.catalogue_reconciliation_edits edit ON edit.queue_id = queue.id
    LEFT JOIN public.products product
      ON product.id = COALESCE(edit.target_product_id, queue.candidate_product_id)
    LEFT JOIN public.catalogue_product_promotions promotion ON promotion.queue_id = queue.id
    WHERE (p_queue_type IS NULL OR queue.queue_type = p_queue_type)
      AND (p_decision_status IS NULL OR queue.decision_status = p_decision_status)
      AND (
        NULLIF(TRIM(p_search), '') IS NULL
        OR COALESCE(edit.generic_name, '') ILIKE '%' || TRIM(p_search) || '%'
        OR COALESCE(edit.brand_name, '') ILIKE '%' || TRIM(p_search) || '%'
        OR COALESCE(edit.nafdac_number, '') ILIKE '%' || TRIM(p_search) || '%'
        OR COALESCE(edit.manufacturer, '') ILIKE '%' || TRIM(p_search) || '%'
        OR queue.record_id ILIKE '%' || TRIM(p_search) || '%'
      )
  ),
  page AS (
    SELECT * FROM filtered
    ORDER BY created_at, id
    LIMIT p_limit OFFSET p_offset
  ),
  bucket_counts AS (
    SELECT queue.queue_type, COUNT(*) AS row_count
    FROM public.catalogue_reconciliation_queue queue
    WHERE p_decision_status IS NULL OR queue.decision_status = p_decision_status
    GROUP BY queue.queue_type
  )
  SELECT JSONB_BUILD_OBJECT(
    'counts', COALESCE((
      SELECT JSONB_OBJECT_AGG(bucket.queue_type, bucket.row_count)
      FROM bucket_counts bucket
    ), '{}'::JSONB),
    'total', (SELECT COUNT(*) FROM filtered),
    'rows', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'id', row.id,
        'snapshot_id', row.snapshot_id,
        'dataset', row.dataset,
        'record_id', row.record_id,
        'queue_type', row.queue_type,
        'decision_status', row.decision_status,
        'match_basis', row.match_basis,
        'candidate_product_id', row.candidate_product_id,
        'conflict_reasons', row.conflict_reasons,
        'decision_notes', row.decision_notes,
        'decided_by', row.decided_by,
        'decided_at', row.decided_at,
        'proposal', JSONB_BUILD_OBJECT(
          'generic_name', row.generic_name,
          'brand_name', row.brand_name,
          'manufacturer', row.manufacturer,
          'strength', row.strength,
          'dosage_form', row.dosage_form,
          'category', row.category,
          'pack_size', row.pack_size,
          'nafdac_number', row.nafdac_number,
          'atc_code', row.atc_code,
          'requires_prescription', row.requires_prescription,
          'resolution_action', row.resolution_action,
          'target_product_id', row.target_product_id
        ),
        'resolved_conflict_reasons', row.resolved_conflict_reasons,
        'resolution_evidence', row.resolution_evidence,
        'approval_blockers', row.approval_blockers,
        'can_approve', CARDINALITY(row.approval_blockers) = 0,
        'can_quick_approve', row.queue_type IN (
          'existing_identity_enrichment', 'candidate_new_identity'
        ) AND CARDINALITY(row.approval_blockers) = 0,
        'source', JSONB_BUILD_OBJECT(
          'status', row.source_status,
          'url', row.source_url,
          'quality_flags', COALESCE(row.payload->'quality_flags', '[]'::JSONB),
          'route', row.payload->>'route_raw',
          'applicant', row.payload->>'applicant_name',
          'components', COALESCE(row.payload->'components_candidate', '[]'::JSONB),
          'raw', row.payload
        ),
        'existing_product', row.existing_product,
        'promotion', CASE WHEN row.promoted_product_id IS NULL THEN NULL
          ELSE JSONB_BUILD_OBJECT(
            'product_id', row.promoted_product_id,
            'action', row.promotion_action,
            'promoted_at', row.promoted_at
          ) END,
        'review_updated_at', row.review_updated_at
      ) ORDER BY row.created_at, row.id)
      FROM page row
    ), '[]'::JSONB),
    'dosage_forms', COALESCE((
      SELECT JSONB_AGG(form.name ORDER BY form.name) FROM public.dosage_forms form
    ), '[]'::JSONB),
    'categories', COALESCE((
      SELECT JSONB_AGG(category.name ORDER BY category.name)
      FROM public.product_categories category
    ), '[]'::JSONB)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_catalogue_products_for_review(
  p_query TEXT,
  p_limit INTEGER DEFAULT 12
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.authenticated_user_is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;
  IF LENGTH(TRIM(COALESCE(p_query, ''))) < 2 OR p_limit < 1 OR p_limit > 25 THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(result) ORDER BY result.rank DESC), '[]'::JSONB)
  INTO v_result
  FROM (
    SELECT
      product.id,
      product.generic_name,
      product.brand_name,
      product.manufacturer,
      product.strength,
      product.dosage_form,
      product.pack_size,
      product.nafdac_number,
      product.is_verified,
      GREATEST(
        public.SIMILARITY(product.generic_name, p_query),
        public.SIMILARITY(COALESCE(product.brand_name, ''), p_query),
        CASE WHEN UPPER(COALESCE(product.nafdac_number, '')) = UPPER(TRIM(p_query))
          THEN 1.0 ELSE 0.0 END
      ) AS rank
    FROM public.products product
    WHERE product.generic_name ILIKE '%' || TRIM(p_query) || '%'
       OR COALESCE(product.brand_name, '') ILIKE '%' || TRIM(p_query) || '%'
       OR COALESCE(product.nafdac_number, '') ILIKE '%' || TRIM(p_query) || '%'
    ORDER BY rank DESC, product.is_verified DESC, product.id
    LIMIT p_limit
  ) result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_catalogue_reconciliation_candidate(
  p_queue_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue public.catalogue_reconciliation_queue;
  v_edit public.catalogue_reconciliation_edits;
  v_existing_promotion public.catalogue_product_promotions;
  v_product public.products;
  v_before JSONB;
  v_after JSONB;
  v_blockers TEXT[];
  v_action TEXT;
  v_category TEXT;
BEGIN
  IF NOT public.authenticated_user_is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('catalogue-promotion:' || p_queue_id::TEXT, 0));

  SELECT * INTO v_existing_promotion
  FROM public.catalogue_product_promotions promotion
  WHERE promotion.queue_id = p_queue_id;
  IF FOUND THEN
    RETURN JSONB_BUILD_OBJECT(
      'promoted', FALSE,
      'idempotent_noop', TRUE,
      'product_id', v_existing_promotion.product_id,
      'promotion_action', v_existing_promotion.promotion_action
    );
  END IF;

  SELECT * INTO v_queue
  FROM public.catalogue_reconciliation_queue queue
  WHERE queue.id = p_queue_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown catalogue reconciliation queue row';
  END IF;
  IF v_queue.decision_status <> 'approved'
    OR v_queue.decided_by IS NULL
    OR v_queue.decided_at IS NULL THEN
    RAISE EXCEPTION 'Only an explicitly approved candidate can be promoted';
  END IF;

  SELECT * INTO v_edit
  FROM public.catalogue_reconciliation_edits edit
  WHERE edit.queue_id = p_queue_id
  FOR UPDATE;

  v_blockers := public.catalogue_reconciliation_approval_blockers(p_queue_id);
  IF CARDINALITY(v_blockers) > 0 THEN
    RAISE EXCEPTION 'Catalogue promotion blocked: %', ARRAY_TO_STRING(v_blockers, ', ');
  END IF;

  v_action := v_edit.resolution_action;
  v_category := COALESCE(v_edit.category, 'Others');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'catalogue-nrn:' || public.normalize_catalogue_source_nrn(v_edit.nafdac_number), 0
  ));

  IF v_action = 'new_identity' THEN
    IF EXISTS (
      SELECT 1 FROM public.products product
      WHERE public.normalize_catalogue_source_nrn(product.nafdac_number)
        = public.normalize_catalogue_source_nrn(v_edit.nafdac_number)
    ) THEN
      RAISE EXCEPTION 'A product with this NAFDAC/NRN now exists; reconcile it as an enrichment';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.products product
      WHERE public.normalize_catalogue_source_text(product.generic_name)
          = public.normalize_catalogue_source_text(v_edit.generic_name)
        AND public.normalize_catalogue_source_text(product.strength)
          = public.normalize_catalogue_source_text(v_edit.strength)
        AND public.normalize_catalogue_source_text(product.dosage_form)
          = public.normalize_catalogue_source_text(v_edit.dosage_form)
        AND public.normalize_catalogue_source_text(product.pack_size)
          = public.normalize_catalogue_source_text(v_edit.pack_size)
        AND public.normalize_catalogue_source_text(product.brand_name)
          = public.normalize_catalogue_source_text(v_edit.brand_name)
    ) THEN
      RAISE EXCEPTION 'This catalogue identity already exists; reconcile it as an enrichment';
    END IF;

    INSERT INTO public.products (
      generic_name, brand_name, manufacturer, strength, dosage_form, category,
      pack_size, nafdac_number, atc_code, requires_prescription, is_verified,
      updated_at
    ) VALUES (
      TRIM(v_edit.generic_name), NULLIF(TRIM(v_edit.brand_name), ''),
      NULLIF(TRIM(v_edit.manufacturer), ''), TRIM(v_edit.strength),
      LOWER(TRIM(v_edit.dosage_form)), v_category,
      NULLIF(TRIM(v_edit.pack_size), ''), TRIM(v_edit.nafdac_number),
      NULLIF(UPPER(TRIM(v_edit.atc_code)), ''),
      COALESCE(v_edit.requires_prescription, TRUE), TRUE, NOW()
    ) RETURNING * INTO v_product;
    v_before := NULL;
    v_after := TO_JSONB(v_product) - 'search_vector';
  ELSIF v_action = 'existing_enrichment' THEN
    SELECT * INTO v_product
    FROM public.products product
    WHERE product.id = v_edit.target_product_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected catalogue product no longer exists';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.products product
      WHERE product.id <> v_product.id
        AND public.normalize_catalogue_source_nrn(product.nafdac_number)
          = public.normalize_catalogue_source_nrn(v_edit.nafdac_number)
    ) THEN
      RAISE EXCEPTION 'The approved NAFDAC/NRN is already assigned to another product';
    END IF;

    v_before := TO_JSONB(v_product) - 'search_vector';
    UPDATE public.products product
    SET generic_name = TRIM(v_edit.generic_name),
        brand_name = COALESCE(NULLIF(TRIM(v_edit.brand_name), ''), product.brand_name),
        manufacturer = COALESCE(NULLIF(TRIM(v_edit.manufacturer), ''), product.manufacturer),
        strength = TRIM(v_edit.strength),
        dosage_form = LOWER(TRIM(v_edit.dosage_form)),
        category = v_category,
        pack_size = COALESCE(NULLIF(TRIM(v_edit.pack_size), ''), product.pack_size),
        nafdac_number = TRIM(v_edit.nafdac_number),
        atc_code = COALESCE(NULLIF(UPPER(TRIM(v_edit.atc_code)), ''), product.atc_code),
        requires_prescription = COALESCE(v_edit.requires_prescription, product.requires_prescription),
        is_verified = TRUE,
        updated_at = NOW()
    WHERE product.id = v_product.id
    RETURNING * INTO v_product;
    v_after := TO_JSONB(v_product) - 'search_vector';
  ELSE
    RAISE EXCEPTION 'The approved review has no promotion resolution';
  END IF;

  INSERT INTO public.catalogue_product_promotions (
    queue_id, snapshot_id, dataset, record_id, product_id, promotion_action,
    approving_admin_id, approved_at, promoted_by, fields_applied,
    product_before, product_after
  ) VALUES (
    v_queue.id, v_queue.snapshot_id, v_queue.dataset, v_queue.record_id,
    v_product.id, CASE WHEN v_action = 'new_identity' THEN 'insert' ELSE 'enrich' END,
    v_queue.decided_by, v_queue.decided_at, auth.uid(),
    TO_JSONB(v_edit) - ARRAY['queue_id','updated_by','created_at','updated_at'],
    v_before, v_after
  );

  RETURN JSONB_BUILD_OBJECT(
    'promoted', TRUE,
    'idempotent_noop', FALSE,
    'product_id', v_product.id,
    'promotion_action', CASE WHEN v_action = 'new_identity' THEN 'insert' ELSE 'enrich' END,
    'is_verified', v_product.is_verified
  );
END;
$$;

ALTER TABLE public.catalogue_reconciliation_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogue_product_promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalogue_reconciliation_edits_admin_select
ON public.catalogue_reconciliation_edits FOR SELECT TO authenticated
USING (public.authenticated_user_is_admin());

CREATE POLICY catalogue_product_promotions_admin_select
ON public.catalogue_product_promotions FOR SELECT TO authenticated
USING (public.authenticated_user_is_admin());

REVOKE ALL ON TABLE public.catalogue_reconciliation_edits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.catalogue_product_promotions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.catalogue_reconciliation_edits TO authenticated;
GRANT SELECT ON TABLE public.catalogue_product_promotions TO authenticated;
GRANT ALL ON TABLE public.catalogue_reconciliation_edits TO service_role;
GRANT ALL ON TABLE public.catalogue_product_promotions TO service_role;

REVOKE ALL ON FUNCTION public.catalogue_category_for_atc(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.initialize_catalogue_reconciliation_edit(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.initialize_catalogue_reconciliation_edit_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogue_reconciliation_approval_blockers(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.review_catalogue_reconciliation_candidate(
  UUID, TEXT, JSONB, TEXT[], JSONB, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_catalogue_reconciliation_decision(UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_catalogue_reconciliation_review(TEXT, TEXT, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_catalogue_products_for_review(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.promote_catalogue_reconciliation_candidate(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.review_catalogue_reconciliation_candidate(
  UUID, TEXT, JSONB, TEXT[], JSONB, TEXT, TEXT, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_catalogue_reconciliation_decision(UUID, TEXT, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalogue_reconciliation_review(TEXT, TEXT, TEXT, INTEGER, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_catalogue_products_for_review(TEXT, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_catalogue_reconciliation_candidate(UUID)
  TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Stages external catalogue evidence for administrator review.
-- This migration never inserts, updates, or deletes public.products rows.

BEGIN;

CREATE TABLE public.catalogue_source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  package_sha256 TEXT NOT NULL CHECK (package_sha256 ~ '^[0-9a-f]{64}$'),
  manifest JSONB NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'reconciled', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_key, snapshot_date)
);

CREATE TABLE public.catalogue_source_records (
  snapshot_id UUID NOT NULL REFERENCES public.catalogue_source_snapshots(id) ON DELETE CASCADE,
  dataset TEXT NOT NULL CHECK (dataset ~ '^[a-z0-9_]+$'),
  record_id TEXT NOT NULL CHECK (LENGTH(TRIM(record_id)) > 0),
  record_sha256 TEXT NOT NULL CHECK (record_sha256 ~ '^[0-9a-f]{64}$'),
  source_identity_fingerprint TEXT,
  source_status TEXT,
  review_status TEXT,
  source_url TEXT,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (snapshot_id, dataset, record_id)
);

CREATE INDEX catalogue_source_records_dataset_idx
  ON public.catalogue_source_records (snapshot_id, dataset);
CREATE INDEX catalogue_source_records_fingerprint_idx
  ON public.catalogue_source_records (snapshot_id, source_identity_fingerprint)
  WHERE source_identity_fingerprint IS NOT NULL;
CREATE INDEX catalogue_source_records_status_idx
  ON public.catalogue_source_records (snapshot_id, source_status);

CREATE TABLE public.catalogue_reconciliation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES public.catalogue_source_snapshots(id) ON DELETE CASCADE,
  dataset TEXT NOT NULL,
  record_id TEXT NOT NULL,
  queue_type TEXT NOT NULL CHECK (queue_type IN (
    'existing_identity_enrichment',
    'candidate_new_identity',
    'ambiguous_conflicting_match',
    'non_human_non_medicine_scope'
  )),
  candidate_product_id UUID REFERENCES public.products(id),
  match_basis TEXT,
  conflict_reasons TEXT[] NOT NULL DEFAULT '{}',
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(evidence) = 'object'),
  decision_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision_status IN ('pending', 'approved', 'rejected', 'held')),
  decided_by UUID REFERENCES auth.users(id),
  decided_at TIMESTAMPTZ,
  decision_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_id, dataset, record_id),
  FOREIGN KEY (snapshot_id, dataset, record_id)
    REFERENCES public.catalogue_source_records(snapshot_id, dataset, record_id)
    ON DELETE CASCADE,
  CHECK (
    (decision_status = 'pending' AND decided_at IS NULL)
    OR (decision_status <> 'pending' AND decided_at IS NOT NULL)
  )
);

CREATE INDEX catalogue_reconciliation_queue_work_idx
  ON public.catalogue_reconciliation_queue (snapshot_id, queue_type, decision_status);
CREATE INDEX catalogue_reconciliation_queue_product_idx
  ON public.catalogue_reconciliation_queue (candidate_product_id)
  WHERE candidate_product_id IS NOT NULL;

CREATE TABLE public.catalogue_reconciliation_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue_id UUID NOT NULL REFERENCES public.catalogue_reconciliation_queue(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES auth.users(id),
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  previous_candidate_product_id UUID REFERENCES public.products(id),
  new_candidate_product_id UUID REFERENCES public.products(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX catalogue_reconciliation_audit_queue_idx
  ON public.catalogue_reconciliation_audit (queue_id, created_at);

COMMENT ON TABLE public.catalogue_source_snapshots IS
  'Immutable version boundary for an external catalogue evidence package.';
COMMENT ON TABLE public.catalogue_source_records IS
  'Authoritative source JSONL rows. These are evidence records, not StocMed products.';
COMMENT ON TABLE public.catalogue_reconciliation_queue IS
  'Administrator review proposals. No queue state automatically mutates products.';
COMMENT ON TABLE public.catalogue_reconciliation_audit IS
  'Append-only decision history for reversible catalogue reconciliation review.';

CREATE OR REPLACE FUNCTION public.normalize_catalogue_source_text(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT LOWER(REGEXP_REPLACE(COALESCE(value, ''), '[^a-zA-Z0-9]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.normalize_catalogue_source_nrn(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT UPPER(REGEXP_REPLACE(COALESCE(value, ''), '[^a-zA-Z0-9]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.touch_catalogue_source_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalogue_source_snapshots_touch_updated_at
BEFORE UPDATE ON public.catalogue_source_snapshots
FOR EACH ROW EXECUTE FUNCTION public.touch_catalogue_source_updated_at();

CREATE TRIGGER catalogue_source_records_touch_updated_at
BEFORE UPDATE ON public.catalogue_source_records
FOR EACH ROW EXECUTE FUNCTION public.touch_catalogue_source_updated_at();

CREATE TRIGGER catalogue_reconciliation_queue_touch_updated_at
BEFORE UPDATE ON public.catalogue_reconciliation_queue
FOR EACH ROW EXECUTE FUNCTION public.touch_catalogue_source_updated_at();

CREATE OR REPLACE FUNCTION public.reconcile_catalogue_source_snapshot(p_snapshot_id UUID)
RETURNS TABLE (queue_type TEXT, row_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.catalogue_source_snapshots snapshot
    WHERE snapshot.id = p_snapshot_id
  ) INTO v_snapshot_exists;

  IF NOT v_snapshot_exists THEN
    RAISE EXCEPTION 'Unknown catalogue source snapshot';
  END IF;

  -- Human Greenbook records are proposed conservatively. The current products
  -- schema has no route/release columns, so those remain explicit evidence gaps.
  WITH human AS (
    SELECT
      source.*,
      public.normalize_catalogue_source_nrn(source.payload->>'nafdac_number_raw') AS nrn,
      public.normalize_catalogue_source_text(source.payload->>'product_name_display') AS product_name,
      public.normalize_catalogue_source_text(source.payload->>'generic_ingredient_raw') AS ingredient,
      public.normalize_catalogue_source_text(source.payload->>'strength_raw') AS strength,
      public.normalize_catalogue_source_text(source.payload->>'dosage_form_raw') AS dosage_form,
      public.normalize_catalogue_source_text(source.payload->>'route_raw') AS route,
      public.normalize_catalogue_source_text(source.payload->>'manufacturer_name') AS manufacturer,
      COALESCE(source.payload->'quality_flags', '[]'::JSONB) AS quality_flags
    FROM public.catalogue_source_records source
    WHERE source.snapshot_id = p_snapshot_id
      AND source.dataset = 'nafdac_human_medicines'
  ),
  duplicate_counts AS (
    SELECT
      human.*,
      CASE WHEN human.nrn = '' THEN 0
        ELSE COUNT(*) OVER (PARTITION BY human.nrn) END AS source_nrn_count,
      CASE WHEN COALESCE(human.source_identity_fingerprint, '') = '' THEN 0
        ELSE COUNT(*) OVER (PARTITION BY human.source_identity_fingerprint) END AS source_fingerprint_count
    FROM human
  ),
  normalized_products AS MATERIALIZED (
    SELECT
      product.id,
      public.normalize_catalogue_source_nrn(product.nafdac_number) AS nrn,
      public.normalize_catalogue_source_text(product.brand_name) AS product_name,
      public.normalize_catalogue_source_text(product.generic_name) AS ingredient,
      public.normalize_catalogue_source_text(product.strength) AS strength,
      public.normalize_catalogue_source_text(product.dosage_form) AS dosage_form,
      public.normalize_catalogue_source_text(product.manufacturer) AS manufacturer
    FROM public.products product
  ),
  nrn_matches AS (
    SELECT
      source.record_id,
      COUNT(product.id)::INTEGER AS match_count,
      (ARRAY_AGG(product.id ORDER BY product.id)
        FILTER (WHERE product.id IS NOT NULL))[1] AS product_id
    FROM duplicate_counts source
    LEFT JOIN normalized_products product
      ON source.nrn <> '' AND product.nrn = source.nrn
    GROUP BY source.record_id
  ),
  identity_matches AS (
    SELECT
      source.record_id,
      COUNT(product.id)::INTEGER AS match_count,
      (ARRAY_AGG(product.id ORDER BY product.id)
        FILTER (WHERE product.id IS NOT NULL))[1] AS product_id
    FROM duplicate_counts source
    LEFT JOIN normalized_products product
      ON source.product_name <> ''
     AND source.ingredient <> ''
     AND source.strength <> ''
     AND source.dosage_form <> ''
     AND source.manufacturer <> ''
     AND product.product_name = source.product_name
     AND product.ingredient = source.ingredient
     AND product.strength = source.strength
     AND product.dosage_form = source.dosage_form
     AND product.manufacturer = source.manufacturer
    GROUP BY source.record_id
  ),
  matched AS (
    SELECT
      source.*,
      nrn_match.match_count AS nrn_match_count,
      nrn_match.product_id AS nrn_product_id,
      nrn_product.generic_name AS nrn_generic_name,
      nrn_product.brand_name AS nrn_brand_name,
      nrn_product.strength AS nrn_strength,
      nrn_product.dosage_form AS nrn_dosage_form,
      nrn_product.manufacturer AS nrn_manufacturer,
      identity_match.match_count AS identity_match_count,
      identity_match.product_id AS identity_product_id
    FROM duplicate_counts source
    JOIN nrn_matches nrn_match ON nrn_match.record_id = source.record_id
    LEFT JOIN public.products nrn_product ON nrn_product.id = nrn_match.product_id
    JOIN identity_matches identity_match ON identity_match.record_id = source.record_id
  ),
  classified AS (
    SELECT
      source.*,
      (
        source.nrn_match_count = 1
        AND (
          public.normalize_catalogue_source_text(source.nrn_generic_name) = source.ingredient
          OR public.normalize_catalogue_source_text(source.nrn_generic_name) = ''
        )
        AND (
          public.normalize_catalogue_source_text(source.nrn_brand_name) = source.product_name
          OR public.normalize_catalogue_source_text(source.nrn_brand_name) = ''
        )
        AND (
          public.normalize_catalogue_source_text(source.nrn_strength) = source.strength
          OR public.normalize_catalogue_source_text(source.nrn_strength) = ''
        )
        AND (
          public.normalize_catalogue_source_text(source.nrn_dosage_form) = source.dosage_form
          OR public.normalize_catalogue_source_text(source.nrn_dosage_form) = ''
        )
        AND (
          public.normalize_catalogue_source_text(source.nrn_manufacturer) = source.manufacturer
          OR public.normalize_catalogue_source_text(source.nrn_manufacturer) = ''
        )
      ) AS unique_nrn_identity_agrees,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN COALESCE(source.source_status, '') <> 'Active' THEN 'source_inactive' END,
        CASE WHEN source.source_nrn_count > 1 THEN 'repeated_source_nrn' END,
        CASE WHEN source.source_fingerprint_count > 1 THEN 'repeated_source_identity_fingerprint' END,
        CASE WHEN source.nrn_match_count > 1 THEN 'multiple_products_share_nrn' END,
        CASE WHEN source.identity_match_count > 1 THEN 'multiple_products_share_identity' END,
        CASE WHEN source.nrn_match_count = 1 AND NOT (
          (public.normalize_catalogue_source_text(source.nrn_generic_name) = source.ingredient OR public.normalize_catalogue_source_text(source.nrn_generic_name) = '')
          AND (public.normalize_catalogue_source_text(source.nrn_brand_name) = source.product_name OR public.normalize_catalogue_source_text(source.nrn_brand_name) = '')
          AND (public.normalize_catalogue_source_text(source.nrn_strength) = source.strength OR public.normalize_catalogue_source_text(source.nrn_strength) = '')
          AND (public.normalize_catalogue_source_text(source.nrn_dosage_form) = source.dosage_form OR public.normalize_catalogue_source_text(source.nrn_dosage_form) = '')
          AND (public.normalize_catalogue_source_text(source.nrn_manufacturer) = source.manufacturer OR public.normalize_catalogue_source_text(source.nrn_manufacturer) = '')
        ) THEN 'nrn_identity_conflict' END,
        CASE WHEN source.product_name = '' THEN 'missing_product_name' END,
        CASE WHEN source.ingredient = '' THEN 'missing_ingredient' END,
        CASE WHEN source.strength = '' THEN 'missing_strength' END,
        CASE WHEN source.dosage_form = '' THEN 'missing_dosage_form' END,
        CASE WHEN source.route = '' THEN 'missing_route' END,
        CASE WHEN source.manufacturer = '' THEN 'missing_manufacturer' END,
        CASE WHEN source.nrn = '' THEN 'missing_nafdac_number' END,
        CASE WHEN source.quality_flags ? 'ingredient_strength_pairing_unresolved'
          THEN 'ingredient_strength_pairing_unresolved' END,
        CASE WHEN source.quality_flags ? 'missing_or_unresolved_strength'
          THEN 'missing_or_unresolved_strength' END,
        CASE WHEN source.quality_flags ? 'missing_or_unresolved_route'
          THEN 'missing_or_unresolved_route' END,
        CASE WHEN source.quality_flags ? 'missing_or_unresolved_manufacturer'
          THEN 'missing_or_unresolved_manufacturer' END,
        CASE WHEN source.quality_flags ? 'missing_or_unresolved_nafdac_number'
          THEN 'missing_or_unresolved_nafdac_number' END,
        CASE WHEN source.quality_flags ? 'source_name_contains_review_note'
          THEN 'source_name_contains_review_note' END,
        'route_and_release_not_modelled_in_products',
        'applicant_authorization_not_modelled_in_products'
      ], NULL)::TEXT[] AS reasons
    FROM matched source
  ),
  proposals AS (
    SELECT
      source.snapshot_id,
      source.dataset,
      source.record_id,
      CASE
        WHEN source.source_status = 'Active'
          AND source.source_nrn_count <= 1
          AND source.source_fingerprint_count <= 1
          AND source.unique_nrn_identity_agrees
          THEN 'existing_identity_enrichment'
        WHEN source.source_status = 'Active'
          AND source.source_nrn_count <= 1
          AND source.source_fingerprint_count <= 1
          AND source.nrn_match_count = 0
          AND source.identity_match_count = 1
          THEN 'existing_identity_enrichment'
        WHEN source.source_status = 'Active'
          AND source.source_nrn_count <= 1
          AND source.source_fingerprint_count <= 1
          AND source.nrn_match_count = 0
          AND source.identity_match_count = 0
          AND source.product_name <> ''
          AND source.ingredient <> ''
          AND source.strength <> ''
          AND source.dosage_form <> ''
          AND source.route <> ''
          AND source.manufacturer <> ''
          AND source.nrn <> ''
          AND NOT (source.quality_flags ?| ARRAY[
            'ingredient_strength_pairing_unresolved',
            'missing_or_unresolved_strength',
            'missing_or_unresolved_route',
            'missing_or_unresolved_manufacturer',
            'missing_or_unresolved_nafdac_number',
            'source_name_contains_review_note'
          ])
          THEN 'candidate_new_identity'
        ELSE 'ambiguous_conflicting_match'
      END AS queue_type,
      CASE
        WHEN source.unique_nrn_identity_agrees THEN source.nrn_product_id
        WHEN source.nrn_match_count = 0 AND source.identity_match_count = 1 THEN source.identity_product_id
        ELSE NULL
      END AS candidate_product_id,
      CASE
        WHEN source.unique_nrn_identity_agrees THEN 'unique_nrn_plus_identity_fields'
        WHEN source.nrn_match_count = 0 AND source.identity_match_count = 1 THEN 'strict_identity_fields'
        WHEN source.nrn_match_count = 0 AND source.identity_match_count = 0 THEN 'no_existing_product_candidate'
        ELSE 'manual_resolution_required'
      END AS match_basis,
      source.reasons AS conflict_reasons,
      JSONB_BUILD_OBJECT(
        'source_status', source.source_status,
        'source_url', source.source_url,
        'normalized_nrn', source.nrn,
        'nrn_match_count', source.nrn_match_count,
        'identity_match_count', source.identity_match_count,
        'source_nrn_count', source.source_nrn_count,
        'source_fingerprint_count', source.source_fingerprint_count,
        'registration_date_assessment', source.payload->>'registration_date_assessment',
        'quality_flags', source.quality_flags,
        'route_raw', source.payload->>'route_raw',
        'applicant_name', source.payload->>'applicant_name',
        'components_candidate', COALESCE(source.payload->'components_candidate', '[]'::JSONB),
        'unresolved_fields', JSONB_BUILD_ARRAY(
          'release_characteristics', 'applicant_authorization_holder'
        )
      ) AS evidence
    FROM classified source
  )
  INSERT INTO public.catalogue_reconciliation_queue (
    snapshot_id, dataset, record_id, queue_type, candidate_product_id,
    match_basis, conflict_reasons, evidence
  )
  SELECT
    proposal.snapshot_id, proposal.dataset, proposal.record_id, proposal.queue_type,
    proposal.candidate_product_id, proposal.match_basis, proposal.conflict_reasons,
    proposal.evidence
  FROM proposals proposal
  ON CONFLICT (snapshot_id, dataset, record_id) DO UPDATE
  SET queue_type = EXCLUDED.queue_type,
      candidate_product_id = EXCLUDED.candidate_product_id,
      match_basis = EXCLUDED.match_basis,
      conflict_reasons = EXCLUDED.conflict_reasons,
      evidence = EXCLUDED.evidence
  WHERE catalogue_reconciliation_queue.decision_status = 'pending';

  -- Non-human Greenbook rows are retained as evidence and never proposed as medicines.
  INSERT INTO public.catalogue_reconciliation_queue (
    snapshot_id, dataset, record_id, queue_type, match_basis, conflict_reasons, evidence
  )
  SELECT source.snapshot_id, source.dataset, source.record_id,
    'non_human_non_medicine_scope', 'source_scope', ARRAY['non_human_greenbook_scope'],
    JSONB_BUILD_OBJECT(
      'source_status', source.source_status,
      'source_url', source.source_url,
      'product_category_raw', source.payload->>'product_category_raw'
    )
  FROM public.catalogue_source_records source
  WHERE source.snapshot_id = p_snapshot_id
    AND source.dataset = 'nafdac_other_regulated_products'
  ON CONFLICT (snapshot_id, dataset, record_id) DO UPDATE
  SET queue_type = EXCLUDED.queue_type,
      candidate_product_id = NULL,
      match_basis = EXCLUDED.match_basis,
      conflict_reasons = EXCLUDED.conflict_reasons,
      evidence = EXCLUDED.evidence
  WHERE catalogue_reconciliation_queue.decision_status = 'pending';

  -- Retail observations are not regulatory identities. Medicine-like rows stay
  -- ambiguous; FMCG/supplement/device rows stay outside medicine scope.
  INSERT INTO public.catalogue_reconciliation_queue (
    snapshot_id, dataset, record_id, queue_type, match_basis, conflict_reasons, evidence
  )
  SELECT source.snapshot_id, source.dataset, source.record_id,
    CASE WHEN source.payload->>'scope_candidate' IN (
      'medicine_candidate', 'manufacturer_health_product_candidate'
    ) THEN 'ambiguous_conflicting_match'
    ELSE 'non_human_non_medicine_scope' END,
    'market_observation_only',
    CASE WHEN source.payload->>'scope_candidate' IN (
      'medicine_candidate', 'manufacturer_health_product_candidate'
    ) THEN ARRAY['market_observed_registration_unresolved']
    ELSE ARRAY['market_non_medicine_or_unresolved_scope'] END,
    JSONB_BUILD_OBJECT(
      'source_url', source.source_url,
      'scope_candidate', source.payload->>'scope_candidate',
      'regulatory_status', source.payload->>'regulatory_status',
      'gtin', source.payload->>'gtin'
    )
  FROM public.catalogue_source_records source
  WHERE source.snapshot_id = p_snapshot_id
    AND source.dataset = 'nigeria_market_candidates'
  ON CONFLICT (snapshot_id, dataset, record_id) DO UPDATE
  SET queue_type = EXCLUDED.queue_type,
      candidate_product_id = NULL,
      match_basis = EXCLUDED.match_basis,
      conflict_reasons = EXCLUDED.conflict_reasons,
      evidence = EXCLUDED.evidence
  WHERE catalogue_reconciliation_queue.decision_status = 'pending';

  -- Official holds remain explicit and cannot be mistaken for product candidates.
  INSERT INTO public.catalogue_reconciliation_queue (
    snapshot_id, dataset, record_id, queue_type, match_basis, conflict_reasons, evidence
  )
  SELECT source.snapshot_id, source.dataset, source.record_id,
    'ambiguous_conflicting_match', 'official_alert',
    ARRAY['regulatory_alert_hold'],
    JSONB_BUILD_OBJECT(
      'source_url', source.source_url,
      'source_status', source.source_status,
      'sellable', source.payload->'sellable',
      'alert_scope_note', source.payload->>'alert_scope_note',
      'batch_reported', source.payload->>'batch_reported'
    )
  FROM public.catalogue_source_records source
  WHERE source.snapshot_id = p_snapshot_id
    AND source.dataset = 'unregistered_and_flagged_products'
  ON CONFLICT (snapshot_id, dataset, record_id) DO UPDATE
  SET queue_type = EXCLUDED.queue_type,
      candidate_product_id = NULL,
      match_basis = EXCLUDED.match_basis,
      conflict_reasons = EXCLUDED.conflict_reasons,
      evidence = EXCLUDED.evidence
  WHERE catalogue_reconciliation_queue.decision_status = 'pending';

  UPDATE public.catalogue_source_snapshots
  SET status = 'reconciled'
  WHERE id = p_snapshot_id;

  RETURN QUERY
  SELECT queue.queue_type, COUNT(*)
  FROM public.catalogue_reconciliation_queue queue
  WHERE queue.snapshot_id = p_snapshot_id
  GROUP BY queue.queue_type
  ORDER BY queue.queue_type;
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
  v_before public.catalogue_reconciliation_queue;
  v_after public.catalogue_reconciliation_queue;
  v_is_service BOOLEAN := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF NOT v_is_service AND NOT public.authenticated_user_is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;

  IF p_decision_status NOT IN ('pending', 'approved', 'rejected', 'held') THEN
    RAISE EXCEPTION 'Invalid catalogue reconciliation decision';
  END IF;

  SELECT * INTO v_before
  FROM public.catalogue_reconciliation_queue queue
  WHERE queue.id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown catalogue reconciliation queue row';
  END IF;

  IF p_decision_status = 'approved' AND (
    v_before.queue_type = 'non_human_non_medicine_scope'
    OR v_before.conflict_reasons @> ARRAY['source_inactive']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['regulatory_alert_hold']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['repeated_source_nrn']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['repeated_source_identity_fingerprint']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['multiple_products_share_nrn']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['multiple_products_share_identity']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['nrn_identity_conflict']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_product_name']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_ingredient']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_strength']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_dosage_form']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_route']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_manufacturer']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_nafdac_number']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['ingredient_strength_pairing_unresolved']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_or_unresolved_strength']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_or_unresolved_route']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_or_unresolved_manufacturer']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['missing_or_unresolved_nafdac_number']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['source_name_contains_review_note']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['market_observed_registration_unresolved']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['route_and_release_not_modelled_in_products']::TEXT[]
    OR v_before.conflict_reasons @> ARRAY['applicant_authorization_not_modelled_in_products']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'This source record has unresolved safety or identity requirements';
  END IF;

  UPDATE public.catalogue_reconciliation_queue
  SET decision_status = p_decision_status,
      candidate_product_id = COALESCE(p_candidate_product_id, candidate_product_id),
      decided_by = CASE WHEN p_decision_status = 'pending' THEN NULL ELSE auth.uid() END,
      decided_at = CASE WHEN p_decision_status = 'pending' THEN NULL ELSE NOW() END,
      decision_notes = p_notes
  WHERE id = p_queue_id
  RETURNING * INTO v_after;

  INSERT INTO public.catalogue_reconciliation_audit (
    queue_id, actor_user_id, previous_status, new_status,
    previous_candidate_product_id, new_candidate_product_id, notes
  ) VALUES (
    p_queue_id, auth.uid(), v_before.decision_status, v_after.decision_status,
    v_before.candidate_product_id, v_after.candidate_product_id, p_notes
  );

  RETURN v_after;
END;
$$;

ALTER TABLE public.catalogue_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogue_source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogue_reconciliation_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogue_reconciliation_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalogue_source_snapshots_admin_select
ON public.catalogue_source_snapshots FOR SELECT TO authenticated
USING (public.authenticated_user_is_admin());

CREATE POLICY catalogue_source_records_admin_select
ON public.catalogue_source_records FOR SELECT TO authenticated
USING (public.authenticated_user_is_admin());

CREATE POLICY catalogue_reconciliation_queue_admin_select
ON public.catalogue_reconciliation_queue FOR SELECT TO authenticated
USING (public.authenticated_user_is_admin());

CREATE POLICY catalogue_reconciliation_audit_admin_select
ON public.catalogue_reconciliation_audit FOR SELECT TO authenticated
USING (public.authenticated_user_is_admin());

REVOKE ALL ON TABLE public.catalogue_source_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.catalogue_source_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.catalogue_reconciliation_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.catalogue_reconciliation_audit FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.catalogue_source_snapshots TO authenticated;
GRANT SELECT ON TABLE public.catalogue_source_records TO authenticated;
GRANT SELECT ON TABLE public.catalogue_reconciliation_queue TO authenticated;
GRANT SELECT ON TABLE public.catalogue_reconciliation_audit TO authenticated;
GRANT ALL ON TABLE public.catalogue_source_snapshots TO service_role;
GRANT ALL ON TABLE public.catalogue_source_records TO service_role;
GRANT ALL ON TABLE public.catalogue_reconciliation_queue TO service_role;
GRANT ALL ON TABLE public.catalogue_reconciliation_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.catalogue_reconciliation_audit_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.normalize_catalogue_source_text(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_catalogue_source_nrn(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_catalogue_source_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_catalogue_source_snapshot(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_catalogue_reconciliation_decision(UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.normalize_catalogue_source_text(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_catalogue_source_nrn(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_catalogue_source_snapshot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_catalogue_reconciliation_decision(UUID, TEXT, UUID, TEXT)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

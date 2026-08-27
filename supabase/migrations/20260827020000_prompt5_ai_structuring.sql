-- Prompt 5: durable, residual-only AI structuring followed by a deterministic
-- ingredient + strength + dosage-form + brand decision in PostgreSQL.
--
-- The model never receives catalogue rows and never supplies a product ID.
-- Only the SECURITY DEFINER completion function below can turn structured
-- fields into a catalogue assignment, and only at confidence >= 0.90.

BEGIN;

ALTER TABLE public.import_jobs
  ADD COLUMN ai_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN ai_total_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN ai_processed_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN ai_resolved_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN ai_candidate_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN ai_failed_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN ai_input_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN ai_output_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN ai_started_at TIMESTAMPTZ,
  ADD COLUMN ai_completed_at TIMESTAMPTZ,
  ADD COLUMN ai_error_message TEXT,
  ADD CONSTRAINT import_jobs_ai_status_check CHECK (
    ai_status IN ('idle', 'queued', 'processing', 'completed', 'partial', 'failed')
  ),
  ADD CONSTRAINT import_jobs_ai_totals_nonnegative CHECK (
    ai_total_rows >= 0
    AND ai_processed_rows >= 0
    AND ai_resolved_rows >= 0
    AND ai_candidate_rows >= 0
    AND ai_failed_rows >= 0
    AND ai_input_tokens >= 0
    AND ai_output_tokens >= 0
  );

ALTER TABLE public.import_staging
  ADD COLUMN source_fields JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN structure_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN structured_is_drug BOOLEAN,
  ADD COLUMN structured_ingredients TEXT[],
  ADD COLUMN structured_ingredient_key TEXT,
  ADD COLUMN structured_strength TEXT,
  ADD COLUMN structured_dosage_form TEXT,
  ADD COLUMN structured_brand TEXT,
  ADD COLUMN structured_pack TEXT,
  ADD COLUMN structurer_confidence NUMERIC(5,4),
  ADD COLUMN structured_at TIMESTAMPTZ,
  ADD CONSTRAINT import_staging_source_fields_object_check CHECK (
    jsonb_typeof(source_fields) = 'object'
  ),
  ADD CONSTRAINT import_staging_structure_status_check CHECK (
    structure_status IN ('idle', 'queued', 'processing', 'structured', 'failed', 'skipped')
  ),
  ADD CONSTRAINT import_staging_structurer_confidence_check CHECK (
    structurer_confidence IS NULL
    OR (structurer_confidence >= 0 AND structurer_confidence <= 1)
  );

ALTER TABLE public.import_staging
  DROP CONSTRAINT import_staging_tier_check;

ALTER TABLE public.import_staging
  ADD CONSTRAINT import_staging_tier_check CHECK (
    tier IS NULL
    OR tier IN (
      'barcode_direct', 'barcode_crosswalk', 'exact', 'fuzzy', 'ai', 'review',
      'structured_exact', 'structured_review', 'ai_candidate'
    )
  );

CREATE TABLE public.import_ai_queue (
  staging_id UUID PRIMARY KEY
    REFERENCES public.import_staging(id) ON DELETE CASCADE,
  job_id UUID NOT NULL
    REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  pharmacy_id UUID NOT NULL
    REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT import_ai_queue_status_check CHECK (
    status IN ('queued', 'processing', 'completed', 'failed')
  ),
  CONSTRAINT import_ai_queue_attempts_check CHECK (attempts >= 0 AND attempts <= 3),
  CONSTRAINT import_ai_queue_claim_shape_check CHECK (
    (status = 'processing' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL)
    OR status <> 'processing'
  ),
  CONSTRAINT import_ai_queue_job_staging_unique UNIQUE (job_id, staging_id)
);

CREATE INDEX import_ai_queue_claim_idx
  ON public.import_ai_queue (status, created_at, job_id)
  WHERE status IN ('queued', 'processing');

CREATE INDEX import_ai_queue_job_status_idx
  ON public.import_ai_queue (job_id, status, created_at);

CREATE TABLE public.catalogue_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_staging_id UUID NOT NULL UNIQUE
    REFERENCES public.import_staging(id) ON DELETE CASCADE,
  job_id UUID NOT NULL
    REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  pharmacy_id UUID NOT NULL
    REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  raw_name TEXT NOT NULL,
  ingredients TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ingredient_key TEXT,
  strength TEXT,
  dosage_form TEXT,
  brand_name TEXT,
  pack_size TEXT,
  structurer_confidence NUMERIC(5,4),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalogue_candidates_status_check CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  CONSTRAINT catalogue_candidates_confidence_check CHECK (
    structurer_confidence IS NULL
    OR (structurer_confidence >= 0 AND structurer_confidence <= 1)
  )
);

CREATE INDEX catalogue_candidates_status_created_idx
  ON public.catalogue_candidates (status, created_at);

CREATE INDEX catalogue_candidates_job_idx
  ON public.catalogue_candidates (job_id, source_staging_id);

ALTER TABLE public.import_ai_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogue_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_ai_queue_owner_select
ON public.import_ai_queue
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.pharmacies AS pharmacy
  WHERE pharmacy.id = import_ai_queue.pharmacy_id
    AND pharmacy.user_id = auth.uid()
));

CREATE POLICY catalogue_candidates_owner_select
ON public.catalogue_candidates
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.pharmacies AS pharmacy
  WHERE pharmacy.id = catalogue_candidates.pharmacy_id
    AND pharmacy.user_id = auth.uid()
));

REVOKE ALL ON TABLE public.import_ai_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.catalogue_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.import_ai_queue TO authenticated;
GRANT SELECT ON TABLE public.catalogue_candidates TO authenticated;
GRANT ALL ON TABLE public.import_ai_queue TO service_role;
GRANT ALL ON TABLE public.catalogue_candidates TO service_role;

CREATE TRIGGER import_ai_queue_set_updated_at
BEFORE UPDATE ON public.import_ai_queue
FOR EACH ROW EXECUTE FUNCTION public.set_import_matching_updated_at();

CREATE TRIGGER catalogue_candidates_set_updated_at
BEFORE UPDATE ON public.catalogue_candidates
FOR EACH ROW EXECUTE FUNCTION public.set_import_matching_updated_at();

CREATE OR REPLACE FUNCTION public.normalize_import_ai_ingredient_key(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_value TEXT := LOWER(COALESCE(p_value, ''));
  v_parts TEXT[];
BEGIN
  -- Catalogue names commonly use "Base ingredient (salt form)". Prefer the
  -- base identity before the parenthesis so the structurer is not required to
  -- guess a salt spelling merely to find the same active ingredient.
  IF STRPOS(v_value, '(') > 1 THEN
    v_value := SPLIT_PART(v_value, '(', 1);
  END IF;

  v_value := REGEXP_REPLACE(
    v_value,
    '\m(tablets?|tabs?|caplets?|capsules?|caps?|syrups?|suspensions?|creams?|ointments?|gels?|drops?|injections?|injectables?|solutions?|elixirs?|pessaries|suppositories|sachets?|ampoules?|vials?|bp|usp)\M',
    ' ',
    'g'
  );

  SELECT ARRAY_AGG(part ORDER BY part)
  INTO v_parts
  FROM (
    SELECT DISTINCT NULLIF(
      REGEXP_REPLACE(BTRIM(raw_part), '[^a-z0-9]+', '', 'g'),
      ''
    ) AS part
    FROM REGEXP_SPLIT_TO_TABLE(
      REGEXP_REPLACE(v_value, '\mand\M', ';', 'g'),
      '[;+,/&]+'
    ) AS raw_part
  ) AS normalized
  WHERE part IS NOT NULL;

  RETURN NULLIF(ARRAY_TO_STRING(v_parts, '+'), '');
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_import_ai_strength_key(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  WITH lowered AS (
    SELECT REPLACE(REPLACE(REPLACE(LOWER(COALESCE(p_value, '')), 'µg', 'mcg'), 'μg', 'mcg'), 'ug', 'mcg') AS value
  ),
  compact AS (
    SELECT REGEXP_REPLACE(value, '[[:space:]]+', '', 'g') AS value
    FROM lowered
  ),
  separated AS (
    SELECT REGEXP_REPLACE(value, '[;,+]+', '/', 'g') AS value
    FROM compact
  ),
  expanded_two_part AS (
    SELECT REGEXP_REPLACE(
      value,
      '(^|/)([0-9]+([.][0-9]+)?)/([0-9]+([.][0-9]+)?)(mg|mcg|kg|g|ml|cl|l|iu|units?|%)($|/)',
      '\1\2\6/\4\6\7',
      'g'
    ) AS value
    FROM separated
  )
  SELECT NULLIF(REGEXP_REPLACE(value, '[^a-z0-9.%/]+', '', 'g'), '')
  FROM expanded_two_part;
$$;

CREATE OR REPLACE FUNCTION public.normalize_import_ai_brand_key(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT NULLIF(
    BTRIM(REGEXP_REPLACE(
      REGEXP_REPLACE(
        COALESCE(public.normalize_import_match_name(p_value), ''),
        '\m(tablets?|tabs?|caplets?|capsules?|caps?|syrups?|suspensions?|creams?|ointments?|gels?|drops?|injections?|injectables?|solutions?|elixirs?|pessaries|suppositories|sachets?|ampoules?|vials?)\M',
        ' ',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_import_ai_dosage_form(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NULLIF(BTRIM(p_value), '') IS NULL THEN NULL
    WHEN LOWER(p_value) ~ '(caplet|tablet|(^|[^a-z])tab([^a-z]|$))' THEN 'tablet'
    WHEN LOWER(p_value) ~ '(capsule|(^|[^a-z])cap([^a-z]|$))' THEN 'capsule'
    WHEN LOWER(p_value) LIKE '%suspension%' THEN 'suspension'
    WHEN LOWER(p_value) LIKE '%syrup%' THEN 'syrup'
    WHEN LOWER(p_value) LIKE '%elixir%' THEN 'elixir'
    WHEN LOWER(p_value) LIKE '%solution%' THEN 'solution'
    WHEN LOWER(p_value) LIKE '%injection%' OR LOWER(p_value) LIKE '%injectable%' THEN 'injection'
    WHEN LOWER(p_value) LIKE '%cream%' THEN 'cream'
    WHEN LOWER(p_value) LIKE '%ointment%' THEN 'ointment'
    WHEN LOWER(p_value) LIKE '%gel%' THEN 'gel'
    WHEN LOWER(p_value) LIKE '%drop%' THEN 'drops'
    WHEN LOWER(p_value) LIKE '%suppositor%' THEN 'suppository'
    WHEN LOWER(p_value) LIKE '%inhal%' THEN 'inhalation'
    ELSE REGEXP_REPLACE(LOWER(BTRIM(p_value)), '[^a-z0-9]+', '', 'g')
  END;
$$;

CREATE OR REPLACE FUNCTION public.import_ai_strength_is_source_grounded(
  p_raw_name TEXT,
  p_source_fields JSONB,
  p_structured_strength TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_source TEXT := LOWER(
    COALESCE(p_raw_name, '') || ' '
    || COALESCE(p_source_fields->>'strength', '') || ' '
    || COALESCE(p_source_fields->>'pack_size', '')
  );
  v_structured TEXT := LOWER(COALESCE(p_structured_strength, ''));
  v_token TEXT;
BEGIN
  v_source := REPLACE(REPLACE(REPLACE(v_source, 'µg', 'mcg'), 'μg', 'mcg'), 'ug', 'mcg');
  v_structured := REPLACE(REPLACE(REPLACE(v_structured, 'µg', 'mcg'), 'μg', 'mcg'), 'ug', 'mcg');

  IF NULLIF(BTRIM(v_structured), '') IS NULL THEN RETURN FALSE; END IF;

  FOR v_token IN
    SELECT DISTINCT match[1]
    FROM REGEXP_MATCHES(v_structured, '([0-9]+([.][0-9]+)?)', 'g') AS match
  LOOP
    IF v_source !~ (
      '(^|[^0-9.])'
      || REGEXP_REPLACE(v_token, '[.]', '\\.', 'g')
      || '([^0-9.]|$)'
    ) THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  FOR v_token IN
    SELECT DISTINCT match[1]
    FROM REGEXP_MATCHES(v_structured, '(mcg|mg|kg|g|ml|cl|l|iu|units?|%)', 'g') AS match
  LOOP
    IF v_source !~ (
      '[0-9]+([.][0-9]+)?'
      || '([[:space:]]*[/;,+-][[:space:]]*[0-9]+([.][0-9]+)?)*'
      || '[[:space:]]*' || v_token || '([^a-z]|$)'
    ) THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_ai_form_is_source_grounded(
  p_raw_name TEXT,
  p_source_fields JSONB,
  p_structured_form TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_source TEXT := LOWER(
    COALESCE(p_raw_name, '') || ' '
    || COALESCE(p_source_fields->>'dosage_form', '')
  );
  v_form TEXT := public.normalize_import_ai_dosage_form(p_structured_form);
BEGIN
  RETURN CASE v_form
    WHEN 'tablet' THEN v_source ~ '(^|[^a-z])(tablet|tablets|tab|tabs|caplet|caplets)([^a-z]|$)'
    WHEN 'capsule' THEN v_source ~ '(^|[^a-z])(capsule|capsules|cap|caps)([^a-z]|$)'
    WHEN 'suspension' THEN v_source ~ '(^|[^a-z])(suspension|susp)([^a-z]|$)'
    WHEN 'syrup' THEN v_source ~ '(^|[^a-z])(syrup|syr)([^a-z]|$)'
    WHEN 'elixir' THEN v_source ~ '(^|[^a-z])elixir([^a-z]|$)'
    WHEN 'solution' THEN v_source ~ '(^|[^a-z])(solution|soln)([^a-z]|$)'
    WHEN 'injection' THEN v_source ~ '(^|[^a-z])(injection|injectable|inj)([^a-z]|$)'
    WHEN 'cream' THEN v_source ~ '(^|[^a-z])cream([^a-z]|$)'
    WHEN 'ointment' THEN v_source ~ '(^|[^a-z])(ointment|oint)([^a-z]|$)'
    WHEN 'gel' THEN v_source ~ '(^|[^a-z])gel([^a-z]|$)'
    WHEN 'drops' THEN v_source ~ '(^|[^a-z])(drop|drops)([^a-z]|$)'
    WHEN 'suppository' THEN v_source ~ '(^|[^a-z])(suppository|suppositories)([^a-z]|$)'
    WHEN 'inhalation' THEN v_source ~ '(^|[^a-z])(inhalation|inhaler)([^a-z]|$)'
    ELSE FALSE
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_row_looks_drug_like(
  p_raw_name TEXT,
  p_source_fields JSONB DEFAULT '{}'::JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  WITH source AS (
    SELECT LOWER(
      COALESCE(p_raw_name, '') || ' '
      || COALESCE(p_source_fields->>'strength', '') || ' '
      || COALESCE(p_source_fields->>'dosage_form', '')
    ) AS value
  )
  SELECT
    value ~ '(^|[^a-z])(tab(let)?s?|caps?(ule)?s?|caplets?|syr(up)?|susp(ension)?|cream|ointment|gel|drops?|injection|injectable|inhaler|solution|elixir|pessary|suppositor(y|ies)|sachet|ampoule|vial)([^a-z]|$)'
    AND value ~ '[0-9]+([.][0-9]+)?[[:space:]]*(mg|mcg|ug|g|ml|iu|%)([^a-z]|$)'
  FROM source;
$$;

REVOKE ALL ON FUNCTION public.normalize_import_ai_ingredient_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_import_ai_strength_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_import_ai_brand_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_import_ai_dosage_form(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_ai_strength_is_source_grounded(TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_ai_form_is_source_grounded(TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_row_looks_drug_like(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_import_ai_ingredient_key(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_import_ai_strength_key(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_import_ai_brand_key(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_import_ai_dosage_form(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_ai_strength_is_source_grounded(TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_ai_form_is_source_grounded(TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_row_looks_drug_like(TEXT, JSONB) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enqueue_import_ai_residual(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total INTEGER;
BEGIN
  PERFORM 1
  FROM public.import_jobs AS job
  JOIN public.pharmacies AS pharmacy ON pharmacy.id = job.pharmacy_id
  WHERE job.id = p_job_id
    AND pharmacy.user_id = auth.uid()
  FOR UPDATE OF job;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized for this import job';
  END IF;

  INSERT INTO public.import_ai_queue (staging_id, job_id, pharmacy_id)
  SELECT staging.id, staging.job_id, job.pharmacy_id
  FROM public.import_staging AS staging
  JOIN public.import_jobs AS job ON job.id = staging.job_id
  WHERE staging.job_id = p_job_id
    AND staging.parse_error IS NULL
    AND staging.match_status <> 'matched'
    AND (
      staging.match_status = 'review'
      OR (
        staging.match_status = 'unmatched'
        AND public.import_row_looks_drug_like(staging.raw_name, staging.source_fields)
      )
    )
  ON CONFLICT (staging_id) DO NOTHING;

  UPDATE public.import_staging AS staging
  SET structure_status = 'queued', updated_at = clock_timestamp()
  FROM public.import_ai_queue AS queue
  WHERE queue.job_id = p_job_id
    AND queue.staging_id = staging.id
    AND queue.status = 'queued'
    AND staging.structure_status = 'idle';

  SELECT COUNT(*)::INTEGER INTO v_total
  FROM public.import_ai_queue
  WHERE job_id = p_job_id;

  UPDATE public.import_jobs
  SET
    ai_status = CASE WHEN v_total > 0 THEN 'queued' ELSE 'completed' END,
    ai_total_rows = v_total,
    ai_processed_rows = 0,
    ai_resolved_rows = 0,
    ai_candidate_rows = 0,
    ai_failed_rows = 0,
    ai_input_tokens = 0,
    ai_output_tokens = 0,
    ai_started_at = CASE WHEN v_total > 0 THEN clock_timestamp() ELSE NULL END,
    ai_completed_at = CASE WHEN v_total = 0 THEN clock_timestamp() ELSE NULL END,
    ai_error_message = NULL,
    updated_at = clock_timestamp()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'status', CASE WHEN v_total > 0 THEN 'queued' ELSE 'completed' END,
    'queued_rows', v_total,
    'batch_size', 25,
    'auto_accept_threshold', 0.90
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_import_ai_residual(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_import_ai_residual(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_import_ai_batch(p_limit INTEGER DEFAULT 25)
RETURNS TABLE (
  claim_token UUID,
  staging_id UUID,
  job_id UUID,
  pharmacy_id UUID,
  source_row_number INTEGER,
  raw_name TEXT,
  source_fields JSONB
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim_token UUID := gen_random_uuid();
  v_job_id UUID;
BEGIN
  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'AI batch size must be between 1 and 50';
  END IF;

  UPDATE public.import_ai_queue
  SET
    status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
    claim_token = NULL,
    claimed_at = NULL,
    last_error = 'worker lease expired',
    completed_at = CASE WHEN attempts >= 3 THEN clock_timestamp() ELSE NULL END,
    updated_at = clock_timestamp()
  WHERE status = 'processing'
    AND claimed_at < clock_timestamp() - INTERVAL '10 minutes';

  UPDATE public.import_staging AS staging
  SET
    structure_status = CASE WHEN queue.status = 'failed' THEN 'failed' ELSE 'queued' END,
    updated_at = clock_timestamp()
  FROM public.import_ai_queue AS queue
  WHERE queue.staging_id = staging.id
    AND staging.structure_status = 'processing'
    AND queue.status IN ('queued', 'failed');

  WITH queue_counts AS (
    SELECT
      queue.job_id,
      COUNT(*)::INTEGER AS total_rows,
      COUNT(*) FILTER (WHERE queue.status IN ('completed', 'failed'))::INTEGER AS processed_rows,
      COUNT(*) FILTER (WHERE queue.status = 'failed')::INTEGER AS failed_rows,
      COUNT(*) FILTER (WHERE queue.status IN ('queued', 'processing'))::INTEGER AS remaining_rows
    FROM public.import_ai_queue AS queue
    GROUP BY queue.job_id
  )
  UPDATE public.import_jobs AS job
  SET
    ai_processed_rows = counts.processed_rows,
    ai_failed_rows = counts.failed_rows,
    ai_status = CASE
      WHEN counts.remaining_rows > 0 THEN 'processing'
      WHEN counts.failed_rows = counts.total_rows AND counts.total_rows > 0 THEN 'failed'
      WHEN counts.failed_rows > 0 THEN 'partial'
      ELSE job.ai_status
    END,
    ai_completed_at = CASE WHEN counts.remaining_rows = 0 THEN clock_timestamp() ELSE NULL END,
    ai_error_message = CASE WHEN counts.failed_rows > 0 THEN 'One or more structuring rows failed after retries' ELSE job.ai_error_message END,
    updated_at = clock_timestamp()
  FROM queue_counts AS counts
  WHERE job.id = counts.job_id
    AND job.ai_status = 'processing';

  SELECT queue.job_id INTO v_job_id
  FROM public.import_ai_queue AS queue
  WHERE queue.status = 'queued'
    AND queue.attempts < 3
  ORDER BY queue.created_at, queue.job_id
  LIMIT 1;

  IF v_job_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH claimed AS MATERIALIZED (
    SELECT queue.staging_id
    FROM public.import_ai_queue AS queue
    WHERE queue.job_id = v_job_id
      AND queue.status = 'queued'
      AND queue.attempts < 3
    ORDER BY queue.created_at, queue.staging_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.import_ai_queue AS queue
    SET
      status = 'processing',
      attempts = queue.attempts + 1,
      claim_token = v_claim_token,
      claimed_at = clock_timestamp(),
      last_error = NULL,
      updated_at = clock_timestamp()
    FROM claimed
    WHERE queue.staging_id = claimed.staging_id
    RETURNING queue.*
  ),
  staging_update AS (
    UPDATE public.import_staging AS staging
    SET structure_status = 'processing', updated_at = clock_timestamp()
    FROM updated
    WHERE staging.id = updated.staging_id
    RETURNING staging.id
  )
  SELECT
    v_claim_token,
    staging.id,
    updated.job_id,
    updated.pharmacy_id,
    staging.source_row_number,
    staging.raw_name,
    staging.source_fields
  FROM updated
  JOIN public.import_staging AS staging ON staging.id = updated.staging_id
  ORDER BY staging.source_row_number;

  UPDATE public.import_jobs
  SET ai_status = 'processing', updated_at = clock_timestamp()
  WHERE id = v_job_id AND ai_status IN ('queued', 'processing');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_import_ai_batch(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_import_ai_batch(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_import_ai_batch(
  p_claim_token UUID,
  p_results JSONB,
  p_model TEXT,
  p_input_tokens INTEGER,
  p_output_tokens INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result JSONB;
  v_queue public.import_ai_queue%ROWTYPE;
  v_staging public.import_staging%ROWTYPE;
  v_job_id UUID;
  v_expected INTEGER;
  v_received INTEGER;
  v_ingredients TEXT[];
  v_ingredient_key TEXT;
  v_strength TEXT;
  v_strength_key TEXT;
  v_form TEXT;
  v_form_key TEXT;
  v_strength_grounded BOOLEAN;
  v_form_grounded BOOLEAN;
  v_brand TEXT;
  v_brand_key TEXT;
  v_pack TEXT;
  v_is_drug BOOLEAN;
  v_structurer_confidence NUMERIC;
  v_identity_match_count INTEGER;
  v_acceptable_count INTEGER;
  v_catalogue_id UUID;
  v_brand_score NUMERIC;
  v_resolved INTEGER;
  v_candidates INTEGER;
  v_failed INTEGER;
  v_processed INTEGER;
  v_total INTEGER;
  v_remaining INTEGER;
  v_status TEXT;
  v_job_matched INTEGER;
  v_job_review INTEGER;
  v_job_unmatched INTEGER;
  v_crosswalk_rows INTEGER := 0;
  v_crosswalk_inserted INTEGER;
BEGIN
  IF p_claim_token IS NULL
     OR jsonb_typeof(p_results) IS DISTINCT FROM 'array'
     OR p_input_tokens < 0
     OR p_output_tokens < 0
     OR NULLIF(BTRIM(p_model), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid AI completion payload';
  END IF;

  SELECT COUNT(*)::INTEGER, (ARRAY_AGG(job_id))[1]
  INTO v_expected, v_job_id
  FROM public.import_ai_queue
  WHERE claim_token = p_claim_token AND status = 'processing';

  v_received := jsonb_array_length(p_results);
  IF v_expected < 1 OR v_received <> v_expected THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'AI result count does not match the claimed batch';
  END IF;

  FOR v_result IN SELECT value FROM jsonb_array_elements(p_results)
  LOOP
    SELECT * INTO v_queue
    FROM public.import_ai_queue
    WHERE staging_id = NULLIF(v_result->>'id', '')::UUID
      AND claim_token = p_claim_token
      AND status = 'processing'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'AI result does not belong to the claimed batch';
    END IF;

    SELECT * INTO v_staging
    FROM public.import_staging
    WHERE id = v_queue.staging_id
    FOR UPDATE;

    SELECT COALESCE(ARRAY_AGG(BTRIM(value)) FILTER (WHERE BTRIM(value) <> ''), ARRAY[]::TEXT[])
    INTO v_ingredients
    FROM jsonb_array_elements_text(COALESCE(v_result->'ingredients', '[]'::JSONB));

    v_is_drug := COALESCE((v_result->>'is_drug')::BOOLEAN, FALSE);
    v_ingredient_key := public.normalize_import_ai_ingredient_key(ARRAY_TO_STRING(v_ingredients, ';'));
    v_strength := NULLIF(BTRIM(v_result->>'strength'), '');
    v_strength_key := public.normalize_import_ai_strength_key(v_strength);
    v_form := NULLIF(BTRIM(v_result->>'dosage_form'), '');
    v_form_key := public.normalize_import_ai_dosage_form(v_form);
    v_strength_grounded := public.import_ai_strength_is_source_grounded(
      v_staging.raw_name,
      v_staging.source_fields,
      v_strength
    );
    v_form_grounded := public.import_ai_form_is_source_grounded(
      v_staging.raw_name,
      v_staging.source_fields,
      v_form
    );
    v_brand := NULLIF(BTRIM(v_result->>'brand'), '');
    v_brand_key := public.normalize_import_ai_brand_key(v_brand);
    v_pack := NULLIF(BTRIM(v_result->>'pack'), '');
    v_structurer_confidence := LEAST(1, GREATEST(0, COALESCE((v_result->>'confidence')::NUMERIC, 0)));
    v_identity_match_count := 0;
    v_acceptable_count := 0;
    v_catalogue_id := NULL;
    v_brand_score := 0;

    UPDATE public.import_staging
    SET
      structure_status = 'structured',
      structured_is_drug = v_is_drug,
      structured_ingredients = v_ingredients,
      structured_ingredient_key = v_ingredient_key,
      structured_strength = v_strength,
      structured_dosage_form = v_form,
      structured_brand = v_brand,
      structured_pack = v_pack,
      structurer_confidence = v_structurer_confidence,
      structured_at = clock_timestamp(),
      updated_at = clock_timestamp()
    WHERE id = v_queue.staging_id;

    IF v_is_drug
       AND v_ingredient_key IS NOT NULL
       AND v_strength_key IS NOT NULL
       AND v_form_key IS NOT NULL THEN
      WITH identity_candidates AS (
        SELECT
          product.id,
          product.is_verified,
          CASE
            WHEN v_brand_key IS NULL THEN NULL
            ELSE public.similarity(
              COALESCE(public.normalize_import_ai_brand_key(product.brand_name), ''),
              v_brand_key
            )::NUMERIC
          END AS brand_score
        FROM public.products AS product
        WHERE public.normalize_import_ai_ingredient_key(product.generic_name) = v_ingredient_key
          AND public.normalize_import_ai_strength_key(product.strength) = v_strength_key
          AND public.normalize_import_ai_dosage_form(product.dosage_form) = v_form_key
      ), acceptable AS (
        SELECT *
        FROM identity_candidates
        WHERE v_brand_key IS NULL OR brand_score >= 0.90
      )
      SELECT
        COUNT(*)::INTEGER,
        (ARRAY_AGG(id ORDER BY brand_score DESC NULLS LAST, is_verified DESC, id))[1],
        COALESCE(MAX(brand_score), 0)
      INTO v_identity_match_count, v_catalogue_id, v_brand_score
      FROM acceptable;

      v_acceptable_count := CASE
        WHEN v_structurer_confidence >= 0.90
          AND v_strength_grounded
          AND v_form_grounded THEN v_identity_match_count
        ELSE 0
      END;
    END IF;

    IF v_is_drug AND v_acceptable_count = 1 THEN
      UPDATE public.import_staging
      SET
        match_status = 'matched',
        matched_catalogue_id = v_catalogue_id,
        confidence = CASE
          WHEN v_brand_key IS NULL THEN LEAST(v_structurer_confidence, 0.9000)
          ELSE ROUND(LEAST(v_structurer_confidence, v_brand_score)::NUMERIC, 4)
        END,
        tier = 'structured_exact',
        updated_at = clock_timestamp()
      WHERE id = v_queue.staging_id;

      IF v_staging.barcode ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$' THEN
        INSERT INTO public.barcode_catalogue_map (
          barcode,
          catalogue_id,
          confirmed_by,
          source
        ) VALUES (
          v_staging.barcode,
          v_catalogue_id,
          NULL,
          'ai'
        )
        ON CONFLICT (barcode) DO NOTHING;
        GET DIAGNOSTICS v_crosswalk_inserted = ROW_COUNT;
        v_crosswalk_rows := v_crosswalk_rows + v_crosswalk_inserted;
      END IF;
    ELSIF v_is_drug THEN
      UPDATE public.import_staging
      SET
        match_status = 'review',
        matched_catalogue_id = CASE WHEN v_acceptable_count > 1 THEN v_catalogue_id ELSE NULL END,
        confidence = CASE WHEN v_acceptable_count > 1 THEN 0.8900 ELSE NULL END,
        tier = CASE
          WHEN v_identity_match_count > 0 THEN 'structured_review'
          WHEN v_structurer_confidence >= 0.90
            AND v_ingredient_key IS NOT NULL
            AND v_strength_key IS NOT NULL
            AND v_form_key IS NOT NULL THEN 'ai_candidate'
          ELSE 'structured_review'
        END,
        updated_at = clock_timestamp()
      WHERE id = v_queue.staging_id;

      IF v_identity_match_count = 0
         AND v_structurer_confidence >= 0.90
         AND v_ingredient_key IS NOT NULL
         AND v_strength_key IS NOT NULL
         AND v_form_key IS NOT NULL THEN
        INSERT INTO public.catalogue_candidates (
          source_staging_id,
          job_id,
          pharmacy_id,
          raw_name,
          ingredients,
          ingredient_key,
          strength,
          dosage_form,
          brand_name,
          pack_size,
          structurer_confidence
        ) VALUES (
          v_queue.staging_id,
          v_queue.job_id,
          v_queue.pharmacy_id,
          v_staging.raw_name,
          v_ingredients,
          v_ingredient_key,
          v_strength,
          v_form,
          v_brand,
          v_pack,
          v_structurer_confidence
        )
        ON CONFLICT (source_staging_id) DO UPDATE SET
          ingredients = EXCLUDED.ingredients,
          ingredient_key = EXCLUDED.ingredient_key,
          strength = EXCLUDED.strength,
          dosage_form = EXCLUDED.dosage_form,
          brand_name = EXCLUDED.brand_name,
          pack_size = EXCLUDED.pack_size,
          structurer_confidence = EXCLUDED.structurer_confidence,
          updated_at = clock_timestamp();
      END IF;
    ELSE
      -- A fuzzy name suggestion can still be an FMCG row. Once the structurer
      -- identifies it as a non-drug, clear that suggestion and route it to
      -- Store instead of leaving it in the medicine review queue.
      UPDATE public.import_staging
      SET
        match_status = 'unmatched',
        matched_catalogue_id = NULL,
        confidence = NULL,
        tier = NULL,
        updated_at = clock_timestamp()
      WHERE id = v_queue.staging_id;
    END IF;

    UPDATE public.import_ai_queue
    SET
      status = 'completed',
      claim_token = NULL,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
    WHERE staging_id = v_queue.staging_id;
  END LOOP;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE status IN ('completed', 'failed'))::INTEGER,
    COUNT(*) FILTER (WHERE status = 'failed')::INTEGER,
    COUNT(*) FILTER (WHERE status IN ('queued', 'processing'))::INTEGER
  INTO v_total, v_processed, v_failed, v_remaining
  FROM public.import_ai_queue
  WHERE job_id = v_job_id;

  SELECT COUNT(*)::INTEGER INTO v_resolved
  FROM public.import_staging
  WHERE job_id = v_job_id AND tier = 'structured_exact' AND match_status = 'matched';

  SELECT COUNT(*)::INTEGER INTO v_candidates
  FROM public.catalogue_candidates
  WHERE job_id = v_job_id AND status = 'pending';

  SELECT
    COUNT(*) FILTER (WHERE match_status = 'matched')::INTEGER,
    COUNT(*) FILTER (WHERE match_status = 'review')::INTEGER,
    COUNT(*) FILTER (WHERE match_status = 'unmatched')::INTEGER
  INTO v_job_matched, v_job_review, v_job_unmatched
  FROM public.import_staging
  WHERE job_id = v_job_id;

  v_status := CASE
    WHEN v_remaining > 0 THEN 'processing'
    WHEN v_failed = v_total AND v_total > 0 THEN 'failed'
    WHEN v_failed > 0 THEN 'partial'
    ELSE 'completed'
  END;

  UPDATE public.import_jobs
  SET
    ai_status = v_status,
    ai_total_rows = v_total,
    ai_processed_rows = v_processed,
    ai_resolved_rows = v_resolved,
    ai_candidate_rows = v_candidates,
    ai_failed_rows = v_failed,
    ai_input_tokens = ai_input_tokens + p_input_tokens,
    ai_output_tokens = ai_output_tokens + p_output_tokens,
    matched_rows = v_job_matched,
    review_rows = v_job_review,
    unmatched_rows = v_job_unmatched,
    ai_completed_at = CASE WHEN v_remaining = 0 THEN clock_timestamp() ELSE NULL END,
    ai_error_message = CASE WHEN v_failed > 0 THEN 'One or more structuring rows failed after retries' ELSE NULL END,
    updated_at = clock_timestamp()
  WHERE id = v_job_id;

  RETURN jsonb_build_object(
    'job_id', v_job_id,
    'status', v_status,
    'batch_rows', v_received,
    'processed_rows', v_processed,
    'resolved_rows', v_resolved,
    'candidate_rows', v_candidates,
    'failed_rows', v_failed,
    'remaining_rows', v_remaining,
    'crosswalk_rows_written', v_crosswalk_rows,
    'input_tokens', p_input_tokens,
    'output_tokens', p_output_tokens,
    'model', p_model,
    'auto_accept_threshold', 0.90
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_import_ai_batch(UUID, JSONB, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_import_ai_batch(UUID, JSONB, TEXT, INTEGER, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_import_ai_batch(
  p_claim_token UUID,
  p_error TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_id UUID;
  v_failed INTEGER;
  v_remaining INTEGER;
  v_total INTEGER;
BEGIN
  SELECT job_id INTO v_job_id
  FROM public.import_ai_queue
  WHERE claim_token = p_claim_token AND status = 'processing'
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RETURN jsonb_build_object('status', 'missing_claim');
  END IF;

  UPDATE public.import_ai_queue
  SET
    status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
    claim_token = NULL,
    claimed_at = NULL,
    last_error = LEFT(COALESCE(p_error, 'structuring failed'), 500),
    completed_at = CASE WHEN attempts >= 3 THEN clock_timestamp() ELSE NULL END,
    updated_at = clock_timestamp()
  WHERE claim_token = p_claim_token AND status = 'processing';

  UPDATE public.import_staging AS staging
  SET
    structure_status = CASE WHEN queue.status = 'failed' THEN 'failed' ELSE 'queued' END,
    updated_at = clock_timestamp()
  FROM public.import_ai_queue AS queue
  WHERE queue.job_id = v_job_id AND queue.staging_id = staging.id;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE status = 'failed')::INTEGER,
    COUNT(*) FILTER (WHERE status IN ('queued', 'processing'))::INTEGER
  INTO v_total, v_failed, v_remaining
  FROM public.import_ai_queue
  WHERE job_id = v_job_id;

  UPDATE public.import_jobs
  SET
    ai_status = CASE
      WHEN v_remaining > 0 THEN 'processing'
      WHEN v_failed = v_total AND v_total > 0 THEN 'failed'
      WHEN v_failed > 0 THEN 'partial'
      ELSE 'completed'
    END,
    ai_failed_rows = v_failed,
    ai_processed_rows = (
      SELECT COUNT(*) FROM public.import_ai_queue
      WHERE job_id = v_job_id AND status IN ('completed', 'failed')
    ),
    ai_completed_at = CASE WHEN v_remaining = 0 THEN clock_timestamp() ELSE NULL END,
    ai_error_message = LEFT(COALESCE(p_error, 'structuring failed'), 500),
    updated_at = clock_timestamp()
  WHERE id = v_job_id;

  RETURN jsonb_build_object(
    'job_id', v_job_id,
    'failed_rows', v_failed,
    'remaining_rows', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fail_import_ai_batch(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_import_ai_batch(UUID, TEXT) TO service_role;

-- Persist the mapped source fields required to rebuild the review queue after
-- asynchronous structuring. Only product/import fields are retained; no
-- pharmacy account, staff, patient, or other PII is copied into staging.
CREATE OR REPLACE FUNCTION public.stage_import_job(
  p_pharmacy_id UUID,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_id UUID := gen_random_uuid();
  v_total_rows INTEGER;
  v_error_rows INTEGER;
  v_inserted_rows INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.pharmacies AS pharmacy
    WHERE pharmacy.id = p_pharmacy_id
      AND pharmacy.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized for this pharmacy';
  END IF;

  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Import staging rows must be a JSON array';
  END IF;

  v_total_rows := jsonb_array_length(p_rows);
  IF v_total_rows < 1 OR v_total_rows > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Import staging requires between 1 and 10000 rows';
  END IF;

  SELECT COUNT(*) FILTER (
    WHERE NULLIF(BTRIM(row_data.parse_error), '') IS NOT NULL
  )::INTEGER
  INTO v_error_rows
  FROM jsonb_to_recordset(p_rows) AS row_data (parse_error TEXT);

  INSERT INTO public.import_jobs (
    id, pharmacy_id, status, total_rows, parsed_rows, error_rows, started_at
  ) VALUES (
    v_job_id, p_pharmacy_id, 'staging', v_total_rows,
    v_total_rows - v_error_rows, v_error_rows, clock_timestamp()
  );

  INSERT INTO public.import_staging (
    job_id, source_row_number, raw_name, norm_name, barcode,
    cost_kobo, price_kobo, qty, min_qty, expiry, parse_error, source_fields
  )
  SELECT
    v_job_id,
    row_data.source_row_number,
    COALESCE(row_data.raw_name, ''),
    COALESCE(row_data.norm_name, ''),
    row_data.barcode,
    row_data.cost_kobo,
    row_data.price_kobo,
    row_data.qty,
    row_data.min_qty,
    row_data.expiry,
    NULLIF(BTRIM(row_data.parse_error), ''),
    COALESCE(row_data.source_fields, '{}'::JSONB)
  FROM jsonb_to_recordset(p_rows) AS row_data (
    source_row_number INTEGER,
    raw_name TEXT,
    norm_name TEXT,
    barcode TEXT,
    cost_kobo BIGINT,
    price_kobo BIGINT,
    qty INTEGER,
    min_qty INTEGER,
    expiry DATE,
    parse_error TEXT,
    source_fields JSONB
  );

  GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
  IF v_inserted_rows <> v_total_rows THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Staging row count did not match the parsed import';
  END IF;

  RETURN jsonb_build_object(
    'job_id', v_job_id,
    'status', 'staging',
    'total_rows', v_total_rows,
    'parsed_rows', v_total_rows - v_error_rows,
    'error_rows', v_error_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stage_import_job(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_import_job(UUID, JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.enqueue_import_ai_residual(UUID) IS
  'Queues only low-fuzzy review rows and strongly drug-like unmatched rows; already matched rows are never sent to the model.';
COMMENT ON FUNCTION public.complete_import_ai_batch(UUID, JSONB, TEXT, INTEGER, INTEGER) IS
  'Persists model-produced structure, then applies the database-owned >=0.90 deterministic identity gate or creates a non-promoted catalogue candidate.';
COMMENT ON TABLE public.catalogue_candidates IS
  'Structured coverage-gap proposals. Prompt 5 never promotes these rows into products; Prompt 6 adds the admin-only approval path.';

COMMIT;

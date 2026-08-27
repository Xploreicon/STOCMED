-- One-call, set-based catalogue matching for a complete import job.
--
-- public.products currently has zero valid GTIN-8/12/13/14 barcodes: all 300
-- populated catalogue barcodes are 11-digit legacy placeholders. The direct
-- barcode CTE is intentionally retained and validates both sides, so it is a
-- safe no-op today and activates automatically when catalogue GTINs are fixed.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_import_match_name(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  WITH lower_name AS (
    SELECT LOWER(COALESCE(p_value, '')) AS value
  ),
  fixed_bp AS (
    SELECT REGEXP_REPLACE(
      value,
      '\mb[[:space:]]*\.[[:space:]]*p\.?\M',
      'bp',
      'g'
    ) AS value
    FROM lower_name
  ),
  without_pack AS (
    SELECT REGEXP_REPLACE(
      REGEXP_REPLACE(
        value,
        '\mpack[[:space:]]+of[[:space:]]+[0-9]+\M',
        ' ',
        'g'
      ),
      '\mx[[:space:]]*[0-9]+[[:space:]]*(tablets?|tabs?|capsules?|caps?|sachets?|ampoules?|vials?|bottles?)?\M',
      ' ',
      'g'
    ) AS value
    FROM fixed_bp
  ),
  without_ratio_dose AS (
    SELECT REGEXP_REPLACE(
      value,
      '\m[0-9]+([.][0-9]+)?[[:space:]]*(mg|mcg|µg|ug|kg|g|ml|cl|l|iu|units?|%)?([[:space:]]*/[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(mg|mcg|µg|ug|kg|g|ml|cl|l|iu|units?|%)?)+\M',
      ' ',
      'g'
    ) AS value
    FROM without_pack
  ),
  without_single_dose AS (
    SELECT REGEXP_REPLACE(
      value,
      '\m[0-9]+([.][0-9]+)?[[:space:]]*(mg|mcg|µg|ug|kg|g|ml|cl|l|iu|units?|%)\M',
      ' ',
      'g'
    ) AS value
    FROM without_ratio_dose
  )
  SELECT NULLIF(
    BTRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(value, '[^a-z0-9]+', ' ', 'g'),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  )
  FROM without_single_dose;
$$;

CREATE OR REPLACE FUNCTION public.match_import_job(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_started_at TIMESTAMPTZ := clock_timestamp();
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Not authorized for this import job';
  END IF;

  -- The job lock prevents two requests from matching the same staging rows at
  -- once. The ownership check is inside the SECURITY DEFINER boundary.
  PERFORM 1
  FROM public.import_jobs AS job
  JOIN public.pharmacies AS pharmacy ON pharmacy.id = job.pharmacy_id
  WHERE job.id = p_job_id
    AND pharmacy.user_id = auth.uid()
  FOR UPDATE OF job;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Not authorized for this import job';
  END IF;

  WITH target_rows AS MATERIALIZED (
    SELECT
      staging.id AS staging_id,
      staging.source_row_number,
      staging.norm_name,
      staging.barcode,
      staging.parse_error
    FROM public.import_staging AS staging
    WHERE staging.job_id = p_job_id
  ),
  eligible_rows AS MATERIALIZED (
    SELECT target.*
    FROM target_rows AS target
    WHERE target.parse_error IS NULL
      AND NULLIF(BTRIM(target.norm_name), '') IS NOT NULL
  ),
  barcode_direct AS MATERIALIZED (
    SELECT DISTINCT ON (eligible.staging_id)
      eligible.staging_id,
      product.id AS catalogue_id,
      'barcode_direct'::TEXT AS tier,
      1.0000::NUMERIC AS confidence
    FROM eligible_rows AS eligible
    JOIN public.products AS product
      ON product.barcode = eligible.barcode
    WHERE eligible.barcode ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'
      AND product.barcode ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'
    ORDER BY eligible.staging_id, product.is_verified DESC, product.id
  ),
  barcode_crosswalk AS MATERIALIZED (
    SELECT
      eligible.staging_id,
      map.catalogue_id,
      'barcode_crosswalk'::TEXT AS tier,
      1.0000::NUMERIC AS confidence
    FROM eligible_rows AS eligible
    JOIN public.barcode_catalogue_map AS map ON map.barcode = eligible.barcode
    WHERE NOT EXISTS (
      SELECT 1
      FROM barcode_direct AS direct
      WHERE direct.staging_id = eligible.staging_id
    )
  ),
  catalogue_names AS MATERIALIZED (
    SELECT
      product.id AS catalogue_id,
      public.normalize_import_match_name(product.generic_name) AS norm_name,
      'generic'::TEXT AS name_source,
      product.is_verified
    FROM public.products AS product

    UNION ALL

    SELECT
      product.id AS catalogue_id,
      public.normalize_import_match_name(product.brand_name) AS norm_name,
      'brand'::TEXT AS name_source,
      product.is_verified
    FROM public.products AS product
    WHERE NULLIF(BTRIM(product.brand_name), '') IS NOT NULL
  ),
  exact_name AS MATERIALIZED (
    SELECT DISTINCT ON (eligible.staging_id)
      eligible.staging_id,
      catalogue.catalogue_id,
      'exact'::TEXT AS tier,
      1.0000::NUMERIC AS confidence
    FROM eligible_rows AS eligible
    JOIN catalogue_names AS catalogue ON catalogue.norm_name = eligible.norm_name
    WHERE NOT EXISTS (
      SELECT 1 FROM barcode_direct AS direct
      WHERE direct.staging_id = eligible.staging_id
    )
      AND NOT EXISTS (
        SELECT 1 FROM barcode_crosswalk AS crosswalk
        WHERE crosswalk.staging_id = eligible.staging_id
      )
    ORDER BY
      eligible.staging_id,
      (catalogue.name_source = 'brand') DESC,
      catalogue.is_verified DESC,
      catalogue.catalogue_id
  ),
  fuzzy_name AS MATERIALIZED (
    SELECT
      eligible.staging_id,
      candidate.catalogue_id,
      'fuzzy'::TEXT AS tier,
      ROUND(candidate.score::NUMERIC, 4) AS confidence
    FROM eligible_rows AS eligible
    CROSS JOIN LATERAL (
      SELECT
        scored.catalogue_id,
        scored.generic_score,
        scored.brand_score,
        GREATEST(scored.generic_score, scored.brand_score) AS score
      FROM (
        SELECT
          raw_candidate.catalogue_id,
          MAX(raw_candidate.generic_score) AS generic_score,
          MAX(raw_candidate.brand_score) AS brand_score
        FROM (
          SELECT
            product.id AS catalogue_id,
            public.similarity(product.generic_name, eligible.norm_name) AS generic_score,
            public.similarity(COALESCE(product.brand_name, ''), eligible.norm_name) AS brand_score
          FROM public.products AS product
          WHERE product.generic_name OPERATOR(public.%) eligible.norm_name

          UNION ALL

          SELECT
            product.id AS catalogue_id,
            public.similarity(product.generic_name, eligible.norm_name) AS generic_score,
            public.similarity(COALESCE(product.brand_name, ''), eligible.norm_name) AS brand_score
          FROM public.products AS product
          WHERE product.brand_name OPERATOR(public.%) eligible.norm_name
        ) AS raw_candidate
        GROUP BY raw_candidate.catalogue_id
      ) AS scored
      ORDER BY
        GREATEST(scored.generic_score, scored.brand_score) DESC,
        (scored.brand_score >= scored.generic_score) DESC,
        scored.catalogue_id
      LIMIT 1
    ) AS candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM barcode_direct AS direct
      WHERE direct.staging_id = eligible.staging_id
    )
      AND NOT EXISTS (
        SELECT 1 FROM barcode_crosswalk AS crosswalk
        WHERE crosswalk.staging_id = eligible.staging_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM exact_name AS exact
        WHERE exact.staging_id = eligible.staging_id
      )
      AND candidate.score >= 0.45
  ),
  resolved AS MATERIALIZED (
    SELECT * FROM barcode_direct
    UNION ALL
    SELECT * FROM barcode_crosswalk
    UNION ALL
    SELECT * FROM exact_name
    UNION ALL
    SELECT * FROM fuzzy_name
  ),
  assignments AS MATERIALIZED (
    SELECT
      target.staging_id,
      CASE
        WHEN target.parse_error IS NOT NULL THEN 'error'
        WHEN resolved.tier = 'fuzzy' AND resolved.confidence < 0.90 THEN 'review'
        WHEN resolved.catalogue_id IS NOT NULL THEN 'matched'
        ELSE 'unmatched'
      END::TEXT AS match_status,
      resolved.catalogue_id,
      resolved.confidence,
      resolved.tier
    FROM target_rows AS target
    LEFT JOIN resolved ON resolved.staging_id = target.staging_id
  ),
  updated AS (
    UPDATE public.import_staging AS staging
    SET
      match_status = assignment.match_status,
      matched_catalogue_id = assignment.catalogue_id,
      confidence = assignment.confidence,
      tier = assignment.tier,
      updated_at = clock_timestamp()
    FROM assignments AS assignment
    WHERE staging.id = assignment.staging_id
    RETURNING
      staging.id,
      staging.barcode,
      staging.parse_error,
      staging.match_status,
      staging.matched_catalogue_id,
      staging.confidence,
      staging.tier
  ),
  crosswalk_candidates AS MATERIALIZED (
    SELECT DISTINCT ON (updated.barcode)
      updated.barcode,
      updated.matched_catalogue_id AS catalogue_id,
      updated.confidence
    FROM updated
    WHERE updated.barcode IS NOT NULL
      AND updated.matched_catalogue_id IS NOT NULL
      AND updated.tier IN ('exact', 'fuzzy')
      AND updated.match_status = 'matched'
      AND updated.confidence >= 0.90
      AND updated.barcode ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'
    ORDER BY updated.barcode, updated.confidence DESC, updated.matched_catalogue_id
  ),
  crosswalk_write AS (
    INSERT INTO public.barcode_catalogue_map (
      barcode,
      catalogue_id,
      confirmed_by,
      source
    )
    SELECT
      candidate.barcode,
      candidate.catalogue_id,
      auth.uid(),
      'name_match'
    FROM crosswalk_candidates AS candidate
    ON CONFLICT (barcode) DO NOTHING
    RETURNING barcode
  ),
  job_counts AS (
    SELECT
      COUNT(*)::INTEGER AS total_rows,
      COUNT(*) FILTER (WHERE parse_error IS NULL)::INTEGER AS parsed_rows,
      COUNT(*) FILTER (WHERE match_status = 'matched')::INTEGER AS matched_rows,
      COUNT(*) FILTER (WHERE match_status = 'unmatched')::INTEGER AS unmatched_rows,
      COUNT(*) FILTER (WHERE match_status = 'review')::INTEGER AS review_rows,
      COUNT(*) FILTER (WHERE match_status = 'error')::INTEGER AS error_rows,
      COUNT(*) FILTER (WHERE tier = 'barcode_direct')::INTEGER AS barcode_direct_rows,
      COUNT(*) FILTER (WHERE tier = 'barcode_crosswalk')::INTEGER AS barcode_crosswalk_rows,
      COUNT(*) FILTER (WHERE tier = 'exact')::INTEGER AS exact_rows,
      COUNT(*) FILTER (WHERE tier = 'fuzzy')::INTEGER AS fuzzy_rows,
      COUNT(*) FILTER (
        WHERE tier = 'fuzzy' AND match_status = 'matched'
      )::INTEGER AS fuzzy_auto_matched_rows,
      COUNT(*) FILTER (
        WHERE tier = 'fuzzy' AND match_status = 'review'
      )::INTEGER AS fuzzy_review_rows
    FROM updated
  ),
  job_update AS (
    UPDATE public.import_jobs AS job
    SET
      status = CASE
        WHEN counts.unmatched_rows > 0 OR counts.review_rows > 0 OR counts.error_rows > 0
          THEN 'review'
        ELSE 'completed'
      END,
      total_rows = counts.total_rows,
      parsed_rows = counts.parsed_rows,
      matched_rows = counts.matched_rows,
      unmatched_rows = counts.unmatched_rows,
      review_rows = counts.review_rows,
      error_rows = counts.error_rows,
      error_message = NULL,
      started_at = COALESCE(job.started_at, v_started_at),
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
    FROM job_counts AS counts
    WHERE job.id = p_job_id
    RETURNING
      job.status,
      counts.total_rows,
      counts.parsed_rows,
      counts.matched_rows,
      counts.unmatched_rows,
      counts.review_rows,
      counts.error_rows,
      counts.barcode_direct_rows,
      counts.barcode_crosswalk_rows,
      counts.exact_rows,
      counts.fuzzy_rows,
      counts.fuzzy_auto_matched_rows,
      counts.fuzzy_review_rows
  )
  SELECT JSONB_BUILD_OBJECT(
    'job_id', p_job_id,
    'status', job_update.status,
    'total_rows', job_update.total_rows,
    'parsed_rows', job_update.parsed_rows,
    'matched_rows', job_update.matched_rows,
    'unmatched_rows', job_update.unmatched_rows,
    'review_rows', job_update.review_rows,
    'error_rows', job_update.error_rows,
    'barcode_direct_rows', job_update.barcode_direct_rows,
    'barcode_crosswalk_rows', job_update.barcode_crosswalk_rows,
    'exact_rows', job_update.exact_rows,
    'fuzzy_rows', job_update.fuzzy_rows,
    'fuzzy_auto_matched_rows', job_update.fuzzy_auto_matched_rows,
    'fuzzy_review_rows', job_update.fuzzy_review_rows,
    'crosswalk_rows_written', (SELECT COUNT(*) FROM crosswalk_write),
    'fuzzy_threshold', 0.45,
    'auto_accept_threshold', 0.90,
    'crosswalk_confidence_band', 0.90
  )
  INTO v_result
  FROM job_update;

  RETURN v_result || JSONB_BUILD_OBJECT(
    'execution_ms', ROUND(
      (EXTRACT(EPOCH FROM (clock_timestamp() - v_started_at)) * 1000)::NUMERIC,
      3
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_import_match_name(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_import_job(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_import_job(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.normalize_import_match_name(TEXT) IS
  'SQL equivalent of import name cleanup for exact catalogue matching.';
COMMENT ON FUNCTION public.match_import_job(UUID) IS
  'Matches every staging row for one owned import job in one set-based statement: strict direct GTIN, learned GTIN crosswalk, exact name, then two-column trigram fuzzy matching.';
DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.match_catalogue_product_for_import(text,text,text,text)'
  ) IS NOT NULL THEN
    EXECUTE $comment$
      COMMENT ON FUNCTION public.match_catalogue_product_for_import(TEXT, TEXT, TEXT, TEXT) IS
      'Legacy per-row matcher. Keep for compatibility until Prompt 4, but do not use in new request paths; match_import_job(UUID) is the authoritative bulk matcher.'
    $comment$;
  END IF;
END;
$$;

COMMIT;

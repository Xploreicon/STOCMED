-- Atomically create one tenant-owned import job and its normalized staging rows.
-- The caller supplies parser output, but ownership, allowed columns, types, row
-- counts, and constraints are all re-established inside PostgreSQL.

BEGIN;

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
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Not authorized for this pharmacy';
  END IF;

  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Import staging rows must be a JSON array';
  END IF;

  v_total_rows := jsonb_array_length(p_rows);
  IF v_total_rows < 1 OR v_total_rows > 10000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Import staging requires between 1 and 10000 rows';
  END IF;

  WITH parsed_rows AS (
    SELECT row_data.*
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
      parse_error TEXT
    )
  )
  SELECT COUNT(*) FILTER (
    WHERE NULLIF(BTRIM(parsed_rows.parse_error), '') IS NOT NULL
  )::INTEGER
  INTO v_error_rows
  FROM parsed_rows;

  INSERT INTO public.import_jobs (
    id,
    pharmacy_id,
    status,
    total_rows,
    parsed_rows,
    error_rows,
    started_at
  ) VALUES (
    v_job_id,
    p_pharmacy_id,
    'staging',
    v_total_rows,
    v_total_rows - v_error_rows,
    v_error_rows,
    clock_timestamp()
  );

  INSERT INTO public.import_staging (
    job_id,
    source_row_number,
    raw_name,
    norm_name,
    barcode,
    cost_kobo,
    price_kobo,
    qty,
    min_qty,
    expiry,
    parse_error
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
    NULLIF(BTRIM(row_data.parse_error), '')
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
    parse_error TEXT
  );

  GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
  IF v_inserted_rows <> v_total_rows THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Staging row count did not match the parsed import';
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

COMMENT ON FUNCTION public.stage_import_job(UUID, JSONB) IS
  'Atomically creates an owned import job and inserts only normalized staging fields before match_import_job(UUID).';

COMMIT;

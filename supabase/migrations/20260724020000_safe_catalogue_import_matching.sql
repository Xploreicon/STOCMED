-- Patient-safety matcher for inventory imports. Name similarity alone must
-- never auto-select a conflicting strength or dosage form.

CREATE OR REPLACE FUNCTION public.normalize_product_strength(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(REGEXP_REPLACE(LOWER(COALESCE(p_value, '')), '[^a-z0-9.]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_dosage_form(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN NULLIF(TRIM(p_value), '') IS NULL THEN NULL
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
    ELSE REGEXP_REPLACE(LOWER(TRIM(p_value)), '[^a-z0-9]+', '', 'g')
  END;
$$;

CREATE OR REPLACE FUNCTION public.match_catalogue_product_for_import(
  p_generic_name TEXT,
  p_brand_name TEXT DEFAULT NULL,
  p_strength TEXT DEFAULT NULL,
  p_dosage_form TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  generic_name TEXT,
  brand_name TEXT,
  manufacturer TEXT,
  strength TEXT,
  dosage_form TEXT,
  category TEXT,
  pack_size TEXT,
  confidence NUMERIC,
  strength_match BOOLEAN,
  form_match BOOLEAN,
  mismatch_reasons TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH input AS (
    SELECT
      LOWER(TRIM(COALESCE(p_generic_name, ''))) AS generic_name,
      LOWER(TRIM(COALESCE(p_brand_name, ''))) AS brand_name,
      public.normalize_product_strength(p_strength) AS strength,
      public.normalize_dosage_form(p_dosage_form) AS dosage_form
  ),
  candidates AS (
    SELECT
      p.*,
      i.strength AS requested_strength,
      i.dosage_form AS requested_form,
      GREATEST(
        SIMILARITY(LOWER(p.generic_name), i.generic_name),
        SIMILARITY(LOWER(COALESCE(p.brand_name, '')), i.generic_name),
        CASE
          WHEN i.brand_name <> '' THEN SIMILARITY(LOWER(COALESCE(p.brand_name, '')), i.brand_name)
          ELSE 0
        END,
        CASE
          WHEN LOWER(p.generic_name) = i.generic_name THEN 1
          WHEN LOWER(p.generic_name) LIKE i.generic_name || ' (%)' THEN 0.98
          WHEN LOWER(p.generic_name) LIKE i.generic_name || '%' THEN 0.95
          ELSE 0
        END
      )::NUMERIC AS name_score,
      CASE
        WHEN i.strength IS NULL THEN NULL
        ELSE public.normalize_product_strength(p.strength) = i.strength
      END AS strength_match,
      CASE
        WHEN i.dosage_form IS NULL THEN NULL
        ELSE public.normalize_dosage_form(p.dosage_form) = i.dosage_form
      END AS form_match
    FROM public.products p
    CROSS JOIN input i
    WHERE i.generic_name <> ''
      AND (
        LOWER(p.generic_name) LIKE '%' || i.generic_name || '%'
        OR i.generic_name LIKE '%' || LOWER(p.generic_name) || '%'
        OR LOWER(COALESCE(p.brand_name, '')) LIKE '%' || i.generic_name || '%'
        OR (i.brand_name <> '' AND LOWER(COALESCE(p.brand_name, '')) LIKE '%' || i.brand_name || '%')
        OR SIMILARITY(LOWER(p.generic_name), i.generic_name) >= 0.25
        OR SIMILARITY(LOWER(COALESCE(p.brand_name, '')), i.generic_name) >= 0.25
      )
  ),
  scored AS (
    SELECT
      c.*,
      CASE
        WHEN c.strength_match IS FALSE AND c.form_match IS FALSE THEN
          LEAST(0.15, c.name_score * 0.55)
        WHEN c.strength_match IS FALSE THEN
          LEAST(0.25, c.name_score * 0.55 + CASE WHEN c.form_match IS TRUE THEN 0.15 ELSE 0 END)
        WHEN c.form_match IS FALSE THEN
          LEAST(0.30, c.name_score * 0.55 + CASE WHEN c.strength_match IS TRUE THEN 0.30 ELSE 0 END)
        ELSE
          c.name_score * 0.55
          + CASE WHEN c.strength_match IS TRUE THEN 0.30 ELSE 0 END
          + CASE WHEN c.form_match IS TRUE THEN 0.15 ELSE 0 END
      END::NUMERIC AS safe_confidence
    FROM candidates c
  )
  SELECT
    s.id,
    s.generic_name,
    s.brand_name,
    s.manufacturer,
    s.strength,
    s.dosage_form,
    s.category,
    s.pack_size,
    ROUND(s.safe_confidence, 4) AS confidence,
    s.strength_match,
    s.form_match,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN s.strength_match IS FALSE THEN 'strength differs' END,
      CASE WHEN s.form_match IS FALSE THEN 'form differs' END,
      CASE WHEN s.strength_match IS NULL THEN 'strength not supplied' END,
      CASE WHEN s.form_match IS NULL THEN 'form not supplied' END
    ], NULL)::TEXT[] AS mismatch_reasons
  FROM scored s
  ORDER BY
    (s.strength_match IS TRUE AND s.form_match IS TRUE) DESC,
    s.safe_confidence DESC,
    s.name_score DESC,
    s.generic_name,
    s.brand_name NULLS LAST
  LIMIT 8;
$$;

REVOKE ALL ON FUNCTION public.normalize_product_strength(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_dosage_form(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_catalogue_product_for_import(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_catalogue_product_for_import(TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_inventory_file(
  p_pharmacy_id UUID,
  p_user_id UUID,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_row_number INTEGER := 0;
  v_result JSONB;
  v_product public.products%ROWTYPE;
  v_selected_product_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Import must contain at least one row';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_row_number := v_row_number + 1;
    IF COALESCE(v_row->'mapped'->>'item_type', 'medicine') <> 'store' THEN
      IF NULLIF(v_row->>'selected_product_id', '') IS NULL THEN
        RAISE EXCEPTION 'Row % failed: medicine requires a catalogue selection', v_row_number;
      END IF;
      v_selected_product_id := (v_row->>'selected_product_id')::UUID;
      SELECT * INTO v_product FROM public.products WHERE id = v_selected_product_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Row % failed: selected catalogue product does not exist', v_row_number;
      END IF;
      IF public.normalize_product_strength(v_row->'mapped'->>'strength') IS NULL THEN
        RAISE EXCEPTION 'Row % failed: medicine strength is required', v_row_number;
      END IF;
      IF public.normalize_dosage_form(v_row->'mapped'->>'dosage_form') IS NULL THEN
        RAISE EXCEPTION 'Row % failed: medicine dosage form is required', v_row_number;
      END IF;
      IF public.normalize_product_strength(v_product.strength)
         IS DISTINCT FROM public.normalize_product_strength(v_row->'mapped'->>'strength') THEN
        RAISE EXCEPTION 'Row % failed: selected catalogue strength differs (% vs %)',
          v_row_number, COALESCE(v_product.strength, 'missing'),
          COALESCE(v_row->'mapped'->>'strength', 'missing');
      END IF;
      IF public.normalize_dosage_form(v_product.dosage_form)
         IS DISTINCT FROM public.normalize_dosage_form(v_row->'mapped'->>'dosage_form') THEN
        RAISE EXCEPTION 'Row % failed: selected catalogue form differs (% vs %)',
          v_row_number, COALESCE(v_product.dosage_form, 'missing'),
          COALESCE(v_row->'mapped'->>'dosage_form', 'missing');
      END IF;
    END IF;

    v_result := public.import_inventory_row(
      p_pharmacy_id,
      p_user_id,
      v_row->>'selected_product_id',
      v_row->'mapped'
    );
    IF NOT COALESCE((v_result->>'success')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION 'Row % failed: %',
        v_row_number, COALESCE(v_result->>'error', 'unknown error');
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'imported', v_row_number,
    'total', v_row_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB) TO authenticated;

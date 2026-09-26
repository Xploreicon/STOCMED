BEGIN;

-- A saved intake is not saleable inventory. Incomplete source records stay here
-- until confirmed, without fake quantities, prices, strengths or expiry dates.
CREATE TABLE public.pharmacy_onboarding_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  file_name TEXT NOT NULL,
  source_rows JSONB NOT NULL CHECK (jsonb_typeof(source_rows) = 'array'),
  review_rows JSONB NOT NULL CHECK (jsonb_typeof(review_rows) = 'array'),
  imported_source_rows INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, source_hash)
);
ALTER TABLE public.pharmacy_onboarding_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY pharmacy_onboarding_owner_read ON public.pharmacy_onboarding_batches
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.pharmacies p WHERE p.id = pharmacy_id AND p.user_id = auth.uid()
  ));
REVOKE ALL ON public.pharmacy_onboarding_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pharmacy_onboarding_batches TO authenticated;

CREATE OR REPLACE FUNCTION public.save_pharmacy_onboarding(
  p_pharmacy_id UUID, p_file_name TEXT, p_source_rows JSONB,
  p_review_rows JSONB, p_commit BOOLEAN DEFAULT FALSE, p_sp_token TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_batch public.pharmacy_onboarding_batches%ROWTYPE;
  v_row JSONB;
  v_mapped JSONB;
  v_result JSONB;
  v_rows JSONB := '[]'::JSONB;
  v_errors JSONB;
  v_number INTEGER;
  v_imported INTEGER := 0;
  v_existing INTEGER := 0;
  v_pending INTEGER := 0;
  v_name TEXT;
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies WHERE id = p_pharmacy_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  IF jsonb_typeof(p_source_rows) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_review_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_source_rows) NOT BETWEEN 1 AND 10000
     OR jsonb_array_length(p_source_rows) <> jsonb_array_length(p_review_rows) THEN
    RAISE EXCEPTION 'Every source row must be retained in onboarding';
  END IF;
  IF (SELECT count(DISTINCT (r->>'source_row_number')::INTEGER) FROM jsonb_array_elements(p_review_rows) r)
       <> jsonb_array_length(p_review_rows)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_review_rows) r
       WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_source_rows) s
         WHERE (s->>'__row_number')::INTEGER = (r->>'source_row_number')::INTEGER)
     ) THEN RAISE EXCEPTION 'Source row identities do not match'; END IF;

  -- Serialize onboarding submissions across files for this pharmacy. Repeat
  -- requests lock the same durable batch and cannot import its rows twice.
  PERFORM pg_advisory_xact_lock(hashtextextended('pharmacy-onboarding:' || p_pharmacy_id::TEXT, 0));
  INSERT INTO public.pharmacy_onboarding_batches (pharmacy_id, source_hash, file_name, source_rows, review_rows)
  VALUES (p_pharmacy_id, md5(p_source_rows::TEXT), left(COALESCE(p_file_name, 'Inventory upload'), 240), p_source_rows, p_review_rows)
  ON CONFLICT (pharmacy_id, source_hash) DO NOTHING;
  SELECT * INTO STRICT v_batch FROM public.pharmacy_onboarding_batches
  WHERE pharmacy_id = p_pharmacy_id AND source_hash = md5(p_source_rows::TEXT) FOR UPDATE;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_review_rows) LOOP
    v_number := (v_row->>'source_row_number')::INTEGER;
    v_mapped := v_row->'mapped';
    v_errors := CASE WHEN jsonb_typeof(v_row->'review_errors') = 'array' THEN v_row->'review_errors' ELSE '[]'::JSONB END;
    v_row := v_row - 'onboarding_status';
    IF v_number = ANY(v_batch.imported_source_rows) THEN
      -- Retain the committed snapshot, not later client edits to an imported row.
      SELECT value INTO v_row FROM jsonb_array_elements(v_batch.review_rows)
      WHERE (value->>'source_row_number')::INTEGER = v_number;
      v_rows := v_rows || jsonb_build_array(v_row);
      CONTINUE;
    END IF;

    v_name := regexp_replace(lower(COALESCE(v_mapped->>'source_name', v_mapped->>'brand_name', v_mapped->>'generic_name', '')), '[^a-z0-9]+', '', 'g');
    IF v_name <> '' AND EXISTS (
      SELECT 1 FROM public.pharmacy_inventory pi LEFT JOIN public.products p ON p.id = pi.product_id
      WHERE pi.pharmacy_id = p_pharmacy_id AND pi.deleted_at IS NULL AND (
        pi.product_id::TEXT = NULLIF(v_row->>'selected_product_id', '')
        OR v_name = regexp_replace(lower(COALESCE(pi.item_name, '')), '[^a-z0-9]+', '', 'g')
        OR v_name = regexp_replace(lower(COALESCE(pi.brand, '')), '[^a-z0-9]+', '', 'g')
        OR v_name = regexp_replace(lower(COALESCE(p.brand_name, '')), '[^a-z0-9]+', '', 'g')
        OR (NULLIF(p.brand_name, '') IS NULL AND v_name = regexp_replace(lower(COALESCE(p.generic_name, '')), '[^a-z0-9]+', '', 'g'))
      )
    ) THEN
      v_existing := v_existing + 1;
      v_rows := v_rows || jsonb_build_array(v_row || jsonb_build_object(
        'onboarding_status', 'existing', 'review_errors', v_errors || '["Already stocked: reconcile the count instead of adding opening stock again"]'::JSONB));
      CONTINUE;
    END IF;

    -- Independent DB guards. A direct RPC caller cannot bypass missing-value
    -- checks merely by submitting an empty review_errors array.
    BEGIN
      IF jsonb_typeof(v_mapped) IS DISTINCT FROM 'object'
        OR NULLIF(btrim(v_mapped->>'generic_name'), '') IS NULL
        OR jsonb_typeof(v_mapped->'quantity') IS DISTINCT FROM 'number'
        OR (v_mapped->>'quantity')::NUMERIC < 0
        OR (v_mapped->>'quantity')::NUMERIC <> trunc((v_mapped->>'quantity')::NUMERIC)
        OR jsonb_typeof(v_mapped->'price') IS DISTINCT FROM 'number'
        OR (v_mapped->>'price')::NUMERIC <= 0 THEN
        v_errors := v_errors || '["Confirm item name, whole-number quantity and selling price"]'::JSONB;
      END IF;
      IF COALESCE(v_mapped->>'item_type', 'medicine') <> 'store' OR COALESCE((v_mapped->>'tracks_expiry')::BOOLEAN, FALSE) THEN
        IF NULLIF(btrim(v_mapped->>'batch_number'), '') IS NULL
          OR NULLIF(v_mapped->>'expiry_date', '') IS NULL
          OR (v_mapped->>'expiry_date')::DATE < CURRENT_DATE THEN
          v_errors := v_errors || '["Confirm batch number and an unexpired expiry date"]'::JSONB;
        END IF;
      END IF;
      IF NULLIF(v_row->>'parse_error', '') IS NOT NULL THEN
        v_errors := v_errors || jsonb_build_array('Source data needs correction: ' || (v_row->>'parse_error'));
      END IF;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
      v_errors := v_errors || '["Invalid quantity, price or expiry format"]'::JSONB;
    END;

    IF p_commit AND jsonb_array_length(v_errors) = 0 THEN
      BEGIN
        v_id := gen_random_uuid();
        v_result := public.import_inventory_file(p_pharmacy_id, auth.uid(), jsonb_build_array(v_row), v_id, p_sp_token);
        IF v_result->>'success' IS DISTINCT FROM 'true' OR (v_result->>'imported')::INTEGER IS DISTINCT FROM 1 THEN
          RAISE EXCEPTION '%', COALESCE(v_result->>'error', 'Import requires authorization or further review');
        END IF;
        v_batch.imported_source_rows := array_append(v_batch.imported_source_rows, v_number);
        v_imported := v_imported + 1;
        v_row := v_row || jsonb_build_object('onboarding_status', 'imported', 'inventory_import_id', v_id, 'review_errors', '[]'::JSONB);
      EXCEPTION WHEN OTHERS THEN
        -- One bad row rolls back its own stock write, not the entire intake.
        v_errors := v_errors || jsonb_build_array(left(SQLERRM, 350));
      END;
    END IF;
    IF v_row->>'onboarding_status' IS DISTINCT FROM 'imported' THEN
      v_pending := v_pending + 1;
      v_row := v_row || jsonb_build_object('onboarding_status', CASE WHEN jsonb_array_length(v_errors) = 0 THEN 'ready' ELSE 'needs_review' END, 'review_errors', v_errors);
    END IF;
    v_rows := v_rows || jsonb_build_array(v_row);
  END LOOP;
  UPDATE public.pharmacy_onboarding_batches SET review_rows = v_rows,
    imported_source_rows = v_batch.imported_source_rows, updated_at = now() WHERE id = v_batch.id;
  RETURN jsonb_build_object('success', TRUE, 'batch_id', v_batch.id, 'saved', jsonb_array_length(v_rows),
    'imported', v_imported, 'imported_total', cardinality(v_batch.imported_source_rows),
    'existing', v_existing, 'pending', v_pending, 'rows', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.save_pharmacy_onboarding(UUID, TEXT, JSONB, JSONB, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_pharmacy_onboarding(UUID, TEXT, JSONB, JSONB, BOOLEAN, TEXT) TO authenticated;
COMMIT;

-- Durable import idempotency plus verified DB result counts.
CREATE TABLE IF NOT EXISTS public.inventory_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  import_id UUID NOT NULL,
  row_fingerprint TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count > 0),
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed')),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (pharmacy_id, import_id)
);

CREATE INDEX IF NOT EXISTS inventory_import_runs_fingerprint_idx
  ON public.inventory_import_runs (pharmacy_id, row_fingerprint, created_at DESC);

ALTER TABLE public.inventory_import_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_import_runs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_inventory_file(
  p_pharmacy_id UUID,
  p_user_id UUID,
  p_rows JSONB,
  p_import_id UUID
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
  v_inventory_id UUID;
  v_imported INTEGER := 0;
  v_skipped INTEGER := 0;
  v_errors INTEGER := 0;
  v_fingerprint TEXT;
  v_final_result JSONB;
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
  IF p_import_id IS NULL THEN
    RAISE EXCEPTION 'Import batch ID is required';
  END IF;

  v_fingerprint := md5(p_rows::TEXT);
  PERFORM pg_advisory_xact_lock(
    hashtextextended('inventory-import-id:' || p_pharmacy_id::TEXT || ':' || p_import_id::TEXT, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.inventory_import_runs
    WHERE pharmacy_id = p_pharmacy_id AND import_id = p_import_id
  ) THEN
    RAISE EXCEPTION 'Duplicate import batch ID: this import was already submitted';
  END IF;

  -- A second browser/request can generate a different UUID. Serialize identical
  -- payloads per pharmacy, then reject a recent completed copy.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('inventory-import-payload:' || p_pharmacy_id::TEXT || ':' || v_fingerprint, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.inventory_import_runs
    WHERE pharmacy_id = p_pharmacy_id
      AND row_fingerprint = v_fingerprint
      AND status = 'completed'
      AND created_at >= NOW() - INTERVAL '10 minutes'
  ) THEN
    RAISE EXCEPTION 'Identical import blocked: this pharmacy imported the same row set within the last 10 minutes';
  END IF;

  INSERT INTO public.inventory_import_runs (
    pharmacy_id, import_id, row_fingerprint, row_count, status
  ) VALUES (
    p_pharmacy_id, p_import_id, v_fingerprint, jsonb_array_length(p_rows), 'processing'
  );

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_row_number := v_row_number + 1;
    IF COALESCE(v_row->'mapped'->>'item_type', 'medicine') <> 'store' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.dosage_forms
        WHERE name = v_row->'mapped'->>'dosage_form'
      ) THEN
        RAISE EXCEPTION 'Row % failed: dosage form "%" is not in the controlled list',
          v_row_number, COALESCE(v_row->'mapped'->>'dosage_form', 'missing');
      END IF;

      IF v_row->>'selected_product_id' = 'create_new' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.product_categories
          WHERE name = v_row->'mapped'->>'category'
        ) THEN
          RAISE EXCEPTION 'Row % failed: category "%" is not in the controlled list',
            v_row_number, COALESCE(v_row->'mapped'->>'category', 'missing');
        END IF;
        v_product := public.create_unverified_catalog_product(
          p_pharmacy_id,
          v_row->'mapped'->>'generic_name',
          v_row->'mapped'->>'brand_name',
          NULL,
          v_row->'mapped'->>'strength',
          v_row->'mapped'->>'dosage_form',
          v_row->'mapped'->>'category',
          v_row->'mapped'->>'pack_size',
          NULL
        );
        v_selected_product_id := v_product.id;
        v_row := jsonb_set(v_row, '{selected_product_id}', to_jsonb(v_selected_product_id::TEXT));
      ELSE
        IF NULLIF(v_row->>'selected_product_id', '') IS NULL THEN
          RAISE EXCEPTION 'Row % failed: medicine requires a catalogue selection', v_row_number;
        END IF;
        v_selected_product_id := (v_row->>'selected_product_id')::UUID;
        SELECT * INTO v_product FROM public.products WHERE id = v_selected_product_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Row % failed: selected catalogue product does not exist', v_row_number;
        END IF;
      END IF;

      IF public.normalize_product_strength(v_row->'mapped'->>'strength') IS NULL THEN
        RAISE EXCEPTION 'Row % failed: medicine strength is required', v_row_number;
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
      p_pharmacy_id, p_user_id, v_row->>'selected_product_id', v_row->'mapped'
    );
    IF NOT COALESCE((v_result->>'success')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION 'Row % failed: %', v_row_number, COALESCE(v_result->>'error', 'unknown error');
    END IF;

    v_inventory_id := NULLIF(v_result->>'inventory_id', '')::UUID;
    IF v_inventory_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.pharmacy_inventory pi
      WHERE pi.id = v_inventory_id AND pi.pharmacy_id = p_pharmacy_id
    ) THEN
      RAISE EXCEPTION 'Row % failed persistence verification', v_row_number;
    END IF;
    v_imported := v_imported + 1;
  END LOOP;

  IF v_imported + v_skipped + v_errors <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'Import count verification failed';
  END IF;

  v_final_result := jsonb_build_object(
    'success', TRUE,
    'import_id', p_import_id,
    'imported', v_imported,
    'skipped', v_skipped,
    'errors', v_errors,
    'total', jsonb_array_length(p_rows)
  );
  UPDATE public.inventory_import_runs
  SET status = 'completed', result = v_final_result, completed_at = NOW()
  WHERE pharmacy_id = p_pharmacy_id AND import_id = p_import_id;

  RETURN v_final_result;
END;
$$;

REVOKE ALL ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB, UUID) TO authenticated;

-- Prevent older application versions from bypassing the idempotency contract.
REVOKE ALL ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;

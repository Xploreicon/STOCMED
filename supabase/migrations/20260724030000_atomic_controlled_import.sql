-- Validate controlled catalogue values and create new catalogue products inside
-- the same transaction as the inventory import.
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
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'imported', v_row_number, 'total', v_row_number);
END;
$$;

REVOKE ALL ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB) TO authenticated;

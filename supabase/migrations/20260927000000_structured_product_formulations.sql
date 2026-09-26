BEGIN;

-- Unverified products keep their historical strength text for existing readers,
-- but complex products additionally carry their exact, confirmed formulation.
CREATE OR REPLACE FUNCTION public.formulation_display(p_formulation JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_entry JSONB;
  v_name TEXT;
  v_amount TEXT;
  v_unit TEXT;
  v_parts TEXT[] := '{}';
  v_names TEXT[] := '{}';
  v_basis INTEGER;
BEGIN
  IF jsonb_typeof(p_formulation) IS DISTINCT FROM 'object'
     OR p_formulation->>'kind' IS NULL OR p_formulation->>'kind' NOT IN ('fixed_combination', 'multivitamin')
     OR p_formulation->'label_confirmed' IS DISTINCT FROM 'true'::JSONB
     OR jsonb_typeof(p_formulation->'basis_quantity') IS DISTINCT FROM 'number'
     OR (p_formulation->>'basis_quantity') !~ '^[0-9]{1,4}$'
     OR p_formulation->>'basis_unit' IS NULL OR p_formulation->>'basis_unit' NOT IN ('tablet','capsule','softgel','gummy','sachet','mL','vial','ampoule')
     OR jsonb_typeof(p_formulation->'ingredients') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  v_basis := (p_formulation->>'basis_quantity')::INTEGER;
  IF v_basis NOT BETWEEN 1 AND 1000 OR jsonb_array_length(p_formulation->'ingredients') NOT BETWEEN 2 AND 40 THEN RETURN NULL; END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_formulation->'ingredients') LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
    v_name := btrim(v_entry->>'name');
    v_amount := btrim(v_entry->>'amount');
    v_unit := v_entry->>'unit';
    IF v_name IS NULL OR length(v_name) > 100 OR v_name !~ '^[A-Za-z0-9][A-Za-z0-9 ().+/-]*$'
       OR v_amount IS NULL OR v_amount !~ '^[0-9]{1,7}(\.[0-9]{1,4})?$'
       OR v_amount::NUMERIC <= 0 OR v_unit IS NULL OR v_unit NOT IN ('mg','mcg','g','IU','mL','units','mcg RAE','mcg DFE','mg NE')
       OR lower(v_name) = ANY(v_names) THEN RETURN NULL; END IF;
    v_names := array_append(v_names, lower(v_name));
    v_parts := array_append(v_parts, v_name || ' ' || v_amount || v_unit);
  END LOOP;
  RETURN (SELECT string_agg(part, ' + ' ORDER BY lower(name) COLLATE "C")
          FROM unnest(v_names, v_parts) AS entry(name, part)) || ' per ' || v_basis || ' ' || (p_formulation->>'basis_unit');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN NULL;
END;
$$;

ALTER TABLE public.products ADD COLUMN formulation JSONB;
ALTER TABLE public.products ADD CONSTRAINT products_formulation_strength_check
  CHECK (formulation IS NULL OR strength = public.formulation_display(formulation));

COMMIT;

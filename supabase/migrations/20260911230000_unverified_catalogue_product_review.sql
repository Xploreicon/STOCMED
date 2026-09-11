-- Give authorized administrators a reviewed, auditable write boundary for the
-- pharmacy-submitted products that predate the reconciliation queue.

BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogue_product_submission_audit (
  id BIGSERIAL PRIMARY KEY,
  product_id UUID,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL CHECK (action IN ('edit', 'verify', 'reject')),
  product_before JSONB NOT NULL,
  product_after JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.catalogue_product_submission_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogue_product_submission_audit_admin_select
  ON public.catalogue_product_submission_audit;
CREATE POLICY catalogue_product_submission_audit_admin_select
ON public.catalogue_product_submission_audit FOR SELECT TO authenticated
USING (public.authenticated_user_is_admin());

REVOKE ALL ON TABLE public.catalogue_product_submission_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.catalogue_product_submission_audit TO authenticated;
GRANT ALL ON TABLE public.catalogue_product_submission_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.catalogue_product_submission_audit_id_seq
  TO service_role;

CREATE OR REPLACE FUNCTION public.review_unverified_catalogue_product(
  p_product_id UUID,
  p_action TEXT,
  p_edit JSONB DEFAULT '{}'::JSONB,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_before JSONB;
  v_after JSONB;
  v_unknown_key TEXT;
  v_generic_name TEXT;
  v_brand_name TEXT;
  v_manufacturer TEXT;
  v_strength TEXT;
  v_dosage_form TEXT;
  v_category TEXT;
  v_pack_size TEXT;
  v_nafdac_number TEXT;
  v_barcode TEXT;
  v_requires_prescription BOOLEAN;
BEGIN
  IF NOT public.authenticated_user_is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;
  IF p_action NOT IN ('edit', 'verify', 'reject') THEN
    RAISE EXCEPTION 'Invalid catalogue product review action';
  END IF;
  IF p_action = 'reject' AND NULLIF(TRIM(COALESCE(p_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;
  IF p_edit IS NULL OR jsonb_typeof(p_edit) <> 'object' THEN
    RAISE EXCEPTION 'Catalogue product edits must be an object';
  END IF;

  SELECT key INTO v_unknown_key
  FROM jsonb_object_keys(p_edit) AS key
  WHERE key NOT IN (
    'generic_name', 'brand_name', 'manufacturer', 'strength', 'dosage_form',
    'category', 'pack_size', 'nafdac_number', 'barcode', 'requires_prescription'
  )
  LIMIT 1;
  IF v_unknown_key IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported catalogue product field: %', v_unknown_key;
  END IF;

  SELECT product.* INTO v_product
  FROM public.products product
  WHERE product.id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catalogue product not found'; END IF;
  IF v_product.is_verified THEN
    RAISE EXCEPTION 'Only an unverified catalogue product may be reviewed';
  END IF;

  v_before := to_jsonb(v_product);
  v_generic_name := CASE WHEN p_edit ? 'generic_name'
    THEN NULLIF(TRIM(p_edit->>'generic_name'), '') ELSE v_product.generic_name END;
  v_brand_name := CASE WHEN p_edit ? 'brand_name'
    THEN NULLIF(TRIM(p_edit->>'brand_name'), '') ELSE v_product.brand_name END;
  v_manufacturer := CASE WHEN p_edit ? 'manufacturer'
    THEN NULLIF(TRIM(p_edit->>'manufacturer'), '') ELSE v_product.manufacturer END;
  v_strength := CASE WHEN p_edit ? 'strength'
    THEN NULLIF(TRIM(p_edit->>'strength'), '') ELSE v_product.strength END;
  v_dosage_form := CASE WHEN p_edit ? 'dosage_form'
    THEN NULLIF(TRIM(p_edit->>'dosage_form'), '') ELSE v_product.dosage_form END;
  v_category := CASE WHEN p_edit ? 'category'
    THEN NULLIF(TRIM(p_edit->>'category'), '') ELSE v_product.category END;
  v_pack_size := CASE WHEN p_edit ? 'pack_size'
    THEN NULLIF(TRIM(p_edit->>'pack_size'), '') ELSE v_product.pack_size END;
  v_nafdac_number := CASE WHEN p_edit ? 'nafdac_number'
    THEN NULLIF(TRIM(p_edit->>'nafdac_number'), '') ELSE v_product.nafdac_number END;
  v_barcode := CASE WHEN p_edit ? 'barcode'
    THEN NULLIF(TRIM(p_edit->>'barcode'), '') ELSE v_product.barcode END;
  v_requires_prescription := CASE WHEN p_edit ? 'requires_prescription'
    THEN (p_edit->>'requires_prescription')::BOOLEAN
    ELSE v_product.requires_prescription END;

  IF v_generic_name IS NULL OR v_strength IS NULL THEN
    RAISE EXCEPTION 'Ingredient/name and strength are required';
  END IF;
  IF p_action = 'verify' AND (v_dosage_form IS NULL OR v_nafdac_number IS NULL) THEN
    RAISE EXCEPTION 'Strength, dosage form, and NAFDAC/NRN are required before verification';
  END IF;
  IF p_action = 'verify' AND EXISTS (
    SELECT 1 FROM public.products other
    WHERE other.id <> p_product_id
      AND other.is_verified
      AND LOWER(TRIM(COALESCE(other.nafdac_number, ''))) = LOWER(TRIM(v_nafdac_number))
  ) THEN
    RAISE EXCEPTION 'This NAFDAC/NRN already belongs to a verified catalogue product';
  END IF;

  IF p_action = 'reject' THEN
    IF EXISTS (
      SELECT 1 FROM public.pharmacy_inventory inventory
      WHERE inventory.product_id = p_product_id
    ) THEN
      RAISE EXCEPTION 'This product is already used by pharmacy inventory; keep it unverified or correct and verify it';
    END IF;
    DELETE FROM public.products WHERE id = p_product_id;
    INSERT INTO public.catalogue_product_submission_audit (
      product_id, actor_user_id, action, product_before, product_after, notes
    ) VALUES (p_product_id, auth.uid(), p_action, v_before, NULL, p_notes);
    RETURN jsonb_build_object('success', TRUE, 'action', p_action, 'product_id', p_product_id);
  END IF;

  UPDATE public.products
  SET generic_name = v_generic_name,
      brand_name = v_brand_name,
      manufacturer = v_manufacturer,
      strength = v_strength,
      dosage_form = v_dosage_form,
      category = v_category,
      pack_size = v_pack_size,
      nafdac_number = v_nafdac_number,
      barcode = v_barcode,
      requires_prescription = v_requires_prescription,
      is_verified = p_action = 'verify',
      updated_at = NOW()
  WHERE id = p_product_id
  RETURNING to_jsonb(products.*) INTO v_after;

  INSERT INTO public.catalogue_product_submission_audit (
    product_id, actor_user_id, action, product_before, product_after, notes
  ) VALUES (p_product_id, auth.uid(), p_action, v_before, v_after, p_notes);

  RETURN jsonb_build_object(
    'success', TRUE,
    'action', p_action,
    'product_id', p_product_id,
    'is_verified', p_action = 'verify'
  );
END;
$$;

ALTER FUNCTION public.review_unverified_catalogue_product(UUID, TEXT, JSONB, TEXT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_unverified_catalogue_product(UUID, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_unverified_catalogue_product(UUID, TEXT, JSONB, TEXT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.review_unverified_catalogue_product(UUID, TEXT, JSONB, TEXT) IS
  'Admin-only audited review of pharmacy-submitted unverified catalogue products.';

COMMIT;
NOTIFY pgrst, 'reload schema';

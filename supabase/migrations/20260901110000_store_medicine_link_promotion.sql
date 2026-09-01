-- Prompt B: a Store item can become a Medicine only by linking it to an
-- existing canonical products row. No inventory identity snapshots are added,
-- and the pharmacy_inventory_department_shape constraint remains unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_pharmacy_inventory_item(
  p_inventory_id UUID,
  p_patch JSONB,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventory public.pharmacy_inventory%ROWTYPE;
  v_price_changed BOOLEAN := FALSE;
  v_is_promotion BOOLEAN := FALSE;
  v_product_id UUID;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION 'At least one inventory field is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_patch) key
    WHERE key NOT IN (
      'price', 'low_stock_threshold', 'whole_pack_only', 'image_url',
      'item_type', 'product_id'
    )
  ) THEN
    RAISE EXCEPTION 'The inventory patch contains a protected or unknown field';
  END IF;

  v_is_promotion := p_patch ? 'item_type' OR p_patch ? 'product_id';
  IF v_is_promotion THEN
    IF NOT (p_patch ? 'item_type' AND p_patch ? 'product_id')
       OR (SELECT COUNT(*) FROM jsonb_object_keys(p_patch)) <> 2 THEN
      RAISE EXCEPTION 'Promotion must set only item_type and product_id together';
    END IF;
    IF jsonb_typeof(p_patch->'item_type') <> 'string'
       OR p_patch->>'item_type' <> 'medicine' THEN
      RAISE EXCEPTION 'Store inventory can only be promoted to medicine';
    END IF;
    IF jsonb_typeof(p_patch->'product_id') <> 'string'
       OR NULLIF(TRIM(p_patch->>'product_id'), '') IS NULL THEN
      RAISE EXCEPTION 'Link a catalogue drug to promote';
    END IF;
    BEGIN
      v_product_id := (p_patch->>'product_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Link a valid catalogue drug to promote';
    END;
  END IF;

  IF p_patch ? 'price' AND (
    p_patch->'price' = 'null'::JSONB OR (p_patch->>'price')::NUMERIC <= 0
  ) THEN
    RAISE EXCEPTION 'Price must be greater than zero';
  END IF;
  IF p_patch ? 'low_stock_threshold' AND (
    p_patch->'low_stock_threshold' = 'null'::JSONB
    OR (p_patch->>'low_stock_threshold')::INTEGER < 0
    OR (p_patch->>'low_stock_threshold')::NUMERIC <> (p_patch->>'low_stock_threshold')::INTEGER
  ) THEN
    RAISE EXCEPTION 'Low-stock threshold must be a non-negative whole number';
  END IF;
  IF p_patch ? 'whole_pack_only' AND jsonb_typeof(p_patch->'whole_pack_only') <> 'boolean' THEN
    RAISE EXCEPTION 'Whole-pack-only must be a boolean';
  END IF;
  IF p_patch ? 'image_url' AND jsonb_typeof(p_patch->'image_url') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'Inventory image must be a URL string or null';
  END IF;

  SELECT inventory.* INTO v_inventory
  FROM public.pharmacy_inventory inventory
  JOIN public.pharmacies pharmacy ON pharmacy.id = inventory.pharmacy_id
  WHERE inventory.id = p_inventory_id
    AND pharmacy.user_id = auth.uid()
  FOR UPDATE OF inventory;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;

  IF v_is_promotion THEN
    -- Safe retry after a network timeout: the same completed transition is a
    -- replay, but a medicine can never be relinked to a different identity.
    IF v_inventory.item_type = 'medicine'
       AND v_inventory.product_id = v_product_id THEN
      RETURN jsonb_build_object(
        'success', TRUE,
        'id', p_inventory_id,
        'product_id', v_product_id,
        'item_type', 'medicine',
        'replayed', TRUE
      );
    END IF;
    IF v_inventory.item_type <> 'store' OR v_inventory.product_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only a Store item can be promoted to Medicine';
    END IF;
    IF v_inventory.deleted_at IS NOT NULL OR NOT v_inventory.is_listed THEN
      RAISE EXCEPTION 'Restore the Store item before promoting it';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products product WHERE product.id = v_product_id
    ) THEN
      RAISE EXCEPTION 'Selected catalogue product does not exist';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.pharmacy_inventory inventory
      WHERE inventory.pharmacy_id = v_inventory.pharmacy_id
        AND inventory.id <> p_inventory_id
        AND inventory.product_id = v_product_id
    ) THEN
      RAISE EXCEPTION 'This catalogue medicine is already in inventory';
    END IF;

    UPDATE public.pharmacy_inventory inventory
    SET product_id = v_product_id,
        item_type = 'medicine',
        tracks_expiry = TRUE,
        batch_capture_required = NOT EXISTS (
          SELECT 1
          FROM public.batches batch
          WHERE batch.inventory_id = p_inventory_id
            AND batch.expiry_date > CURRENT_DATE
        ),
        updated_at = NOW()
    WHERE inventory.id = p_inventory_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'id', p_inventory_id,
      'product_id', v_product_id,
      'item_type', 'medicine',
      'batch_capture_required', NOT EXISTS (
        SELECT 1
        FROM public.batches batch
        WHERE batch.inventory_id = p_inventory_id
          AND batch.expiry_date > CURRENT_DATE
      ),
      'replayed', FALSE
    );
  END IF;

  v_price_changed := p_patch ? 'price'
    AND v_inventory.price IS DISTINCT FROM (p_patch->>'price')::NUMERIC;
  IF v_price_changed AND NOT public.verify_gated_sp_action(
    v_inventory.pharmacy_id,
    p_sp_token,
    'price_change',
    'Change inventory price for ' || p_inventory_id::TEXT
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;

  UPDATE public.pharmacy_inventory inventory
  SET price = CASE WHEN p_patch ? 'price' THEN (p_patch->>'price')::NUMERIC ELSE inventory.price END,
      low_stock_threshold = CASE WHEN p_patch ? 'low_stock_threshold' THEN (p_patch->>'low_stock_threshold')::INTEGER ELSE inventory.low_stock_threshold END,
      whole_pack_only = CASE WHEN p_patch ? 'whole_pack_only' THEN (p_patch->>'whole_pack_only')::BOOLEAN ELSE inventory.whole_pack_only END,
      image_url = CASE WHEN p_patch ? 'image_url' THEN NULLIF(TRIM(p_patch->>'image_url'), '') ELSE inventory.image_url END,
      updated_at = NOW()
  WHERE inventory.id = p_inventory_id;

  RETURN jsonb_build_object('success', TRUE, 'id', p_inventory_id);
END;
$$;

ALTER FUNCTION public.update_pharmacy_inventory_item(UUID, JSONB, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_pharmacy_inventory_item(UUID, JSONB, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_pharmacy_inventory_item(UUID, JSONB, TEXT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.update_pharmacy_inventory_item(UUID, JSONB, TEXT) IS
  'Owner-scoped inventory updates. Identity fields are accepted only as an atomic Store-to-Medicine link to an existing products row.';

COMMIT;

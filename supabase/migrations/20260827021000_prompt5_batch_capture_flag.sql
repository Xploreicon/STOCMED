-- Prompt 5 commit rule: batch details may be captured after bulk onboarding,
-- but expiry-tracked stock remains unsellable until an owned, unexpired batch
-- exists. The sale RPC already enforces that boundary transactionally.

BEGIN;

ALTER TABLE public.pharmacy_inventory
  ADD COLUMN batch_capture_required BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.pharmacy_inventory AS inventory
SET batch_capture_required = TRUE
WHERE inventory.tracks_expiry
  AND inventory.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.batches AS batch
    WHERE batch.inventory_id = inventory.id
      AND batch.expiry_date > CURRENT_DATE
  );

CREATE OR REPLACE FUNCTION public.refresh_inventory_batch_capture_required()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_inventory_id UUID;
  v_old_inventory_id UUID;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_new_inventory_id := NEW.inventory_id;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_old_inventory_id := OLD.inventory_id;
  END IF;

  UPDATE public.pharmacy_inventory AS inventory
  SET
    batch_capture_required = inventory.tracks_expiry AND NOT EXISTS (
      SELECT 1
      FROM public.batches AS batch
      WHERE batch.inventory_id = inventory.id
        AND batch.expiry_date > CURRENT_DATE
    ),
    updated_at = NOW()
  WHERE inventory.id IN (v_new_inventory_id, v_old_inventory_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_inventory_batch_capture_required() FROM PUBLIC;

CREATE TRIGGER batches_refresh_capture_required
AFTER INSERT OR UPDATE OR DELETE ON public.batches
FOR EACH ROW EXECUTE FUNCTION public.refresh_inventory_batch_capture_required();

CREATE OR REPLACE FUNCTION public.import_inventory_row(
  p_pharmacy_id UUID,
  p_user_id UUID,
  p_selected_product_id TEXT,
  p_mapped JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.inventory_item_type :=
    COALESCE(NULLIF(p_mapped->>'item_type', ''), 'medicine')::public.inventory_item_type;
  v_tracks_expiry BOOLEAN :=
    CASE WHEN v_type = 'medicine' THEN TRUE
         ELSE COALESCE((p_mapped->>'tracks_expiry')::BOOLEAN, FALSE) END;
  v_product_id UUID;
  v_inventory_id UUID;
  v_batch_id UUID;
  v_quantity INTEGER := COALESCE((p_mapped->>'quantity')::INTEGER, 0);
  v_price NUMERIC := (p_mapped->>'price')::NUMERIC;
  v_cost NUMERIC := NULLIF(p_mapped->>'unit_cost', '')::NUMERIC;
  v_batch_number TEXT := NULLIF(TRIM(p_mapped->>'batch_number'), '');
  v_expiry_date DATE := NULLIF(p_mapped->>'expiry_date', '')::DATE;
  v_batch_pending BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;
  IF v_price <= 0 OR v_quantity < 0 OR COALESCE(v_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Price, quantity, or cost is invalid';
  END IF;

  IF v_type = 'medicine' THEN
    IF p_selected_product_id IS NULL
       OR p_selected_product_id = ''
       OR p_selected_product_id = 'create_new' THEN
      RAISE EXCEPTION 'Medicine rows require a catalogue match';
    END IF;
    v_product_id := p_selected_product_id::UUID;
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_product_id) THEN
      RAISE EXCEPTION 'Selected catalogue product does not exist';
    END IF;

    SELECT pi.id INTO v_inventory_id
    FROM public.pharmacy_inventory pi
    WHERE pi.pharmacy_id = p_pharmacy_id
      AND pi.product_id = v_product_id
      AND pi.deleted_at IS NULL
    FOR UPDATE;

    IF v_inventory_id IS NULL THEN
      INSERT INTO public.pharmacy_inventory (
        pharmacy_id, product_id, item_type, tracks_expiry,
        price, unit_cost, low_stock_threshold, quantity_in_stock, is_listed,
        batch_capture_required
      ) VALUES (
        p_pharmacy_id, v_product_id, 'medicine', TRUE,
        v_price, v_cost, 10, 0, TRUE,
        v_batch_number IS NULL OR v_expiry_date IS NULL
      ) RETURNING id INTO v_inventory_id;
    ELSE
      UPDATE public.pharmacy_inventory
      SET
        price = v_price,
        unit_cost = COALESCE(v_cost, unit_cost),
        updated_at = NOW()
      WHERE id = v_inventory_id;
    END IF;
  ELSE
    v_product_id := NULL;
    IF NULLIF(TRIM(p_mapped->>'generic_name'), '') IS NULL THEN
      RAISE EXCEPTION 'Store item name is required';
    END IF;

    SELECT pi.id INTO v_inventory_id
    FROM public.pharmacy_inventory pi
    WHERE pi.pharmacy_id = p_pharmacy_id
      AND pi.item_type = 'store'
      AND pi.deleted_at IS NULL
      AND (
        (
          NULLIF(TRIM(p_mapped->>'sku'), '') IS NOT NULL
          AND pi.barcode = TRIM(p_mapped->>'sku')
        )
        OR (
          NULLIF(TRIM(p_mapped->>'sku'), '') IS NULL
          AND LOWER(TRIM(pi.item_name)) = LOWER(TRIM(p_mapped->>'generic_name'))
          AND LOWER(COALESCE(TRIM(pi.brand), '')) =
              LOWER(COALESCE(NULLIF(TRIM(p_mapped->>'brand_name'), ''), ''))
        )
      )
    FOR UPDATE;

    IF v_inventory_id IS NULL THEN
      INSERT INTO public.pharmacy_inventory (
        pharmacy_id, product_id, item_type, tracks_expiry,
        item_name, brand, barcode, unit_description, store_category,
        price, unit_cost, low_stock_threshold, quantity_in_stock, is_listed,
        batch_capture_required
      ) VALUES (
        p_pharmacy_id, NULL, 'store', v_tracks_expiry,
        TRIM(p_mapped->>'generic_name'),
        NULLIF(TRIM(p_mapped->>'brand_name'), ''),
        NULLIF(TRIM(p_mapped->>'sku'), ''),
        NULLIF(TRIM(p_mapped->>'pack_size'), ''),
        COALESCE(NULLIF(TRIM(p_mapped->>'category'), ''), 'Airtime/Other'),
        v_price, v_cost, 10, 0, TRUE,
        v_tracks_expiry AND (v_batch_number IS NULL OR v_expiry_date IS NULL)
      ) RETURNING id INTO v_inventory_id;
    ELSE
      UPDATE public.pharmacy_inventory
      SET
        price = v_price,
        unit_cost = COALESCE(v_cost, unit_cost),
        tracks_expiry = v_tracks_expiry,
        batch_capture_required = CASE
          WHEN NOT v_tracks_expiry THEN FALSE
          ELSE batch_capture_required
        END,
        updated_at = NOW()
      WHERE id = v_inventory_id;
    END IF;
  END IF;

  IF v_tracks_expiry THEN
    IF (v_batch_number IS NULL) <> (v_expiry_date IS NULL) THEN
      RAISE EXCEPTION 'Batch number and expiry date must be supplied together';
    END IF;

    IF v_batch_number IS NULL THEN
      UPDATE public.pharmacy_inventory AS inventory
      SET
        batch_capture_required = NOT EXISTS (
          SELECT 1
          FROM public.batches AS batch
          WHERE batch.inventory_id = inventory.id
            AND batch.expiry_date > CURRENT_DATE
        ),
        updated_at = NOW()
      WHERE id = v_inventory_id;
      SELECT batch_capture_required INTO v_batch_pending
      FROM public.pharmacy_inventory
      WHERE id = v_inventory_id;
    ELSE
      IF v_expiry_date <= CURRENT_DATE THEN
        RAISE EXCEPTION 'Expired stock cannot be imported';
      END IF;
      INSERT INTO public.batches (
        inventory_id, batch_number, expiry_date, quantity_received, cost_price
      ) VALUES (
        v_inventory_id, v_batch_number, v_expiry_date, v_quantity, v_cost
      ) RETURNING id INTO v_batch_id;
      v_batch_pending := FALSE;
    END IF;
  END IF;

  IF v_quantity > 0 THEN
    INSERT INTO public.stock_movements (
      inventory_id, batch_id, type, quantity, reason, reference, created_by
    ) VALUES (
      v_inventory_id, v_batch_id, 'opening', v_quantity,
      CASE WHEN v_batch_pending
        THEN 'Opening stock (Imported; batch capture required before dispensing)'
        ELSE 'Opening stock (Imported)'
      END,
      'INVENTORY_IMPORT', p_user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'product_id', v_product_id,
    'inventory_id', v_inventory_id,
    'batch_id', v_batch_id,
    'batch_capture_required', v_batch_pending,
    'warning', CASE WHEN v_batch_pending
      THEN 'Batch number and expiry must be captured before dispensing'
      ELSE NULL
    END,
    'item_type', v_type
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.import_inventory_row(UUID, UUID, TEXT, JSONB) FROM PUBLIC;

COMMENT ON COLUMN public.pharmacy_inventory.batch_capture_required IS
  'True when expiry-tracked stock was onboarded without a sellable batch. The sale RPC still requires an owned, unexpired batch.';

COMMIT;

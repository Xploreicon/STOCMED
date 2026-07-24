-- Unified medicine + store inventory. Store rows remain tenant-private and
-- structurally excluded from patient discovery and demand intelligence.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_item_type') THEN
    CREATE TYPE public.inventory_item_type AS ENUM ('medicine', 'store');
  END IF;
END
$$;

ALTER TABLE public.pharmacy_inventory
  ALTER COLUMN product_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS item_type public.inventory_item_type NOT NULL DEFAULT 'medicine',
  ADD COLUMN IF NOT EXISTS tracks_expiry BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS unit_description TEXT,
  ADD COLUMN IF NOT EXISTS store_category TEXT,
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC;

ALTER TABLE public.pharmacy_inventory
  DROP CONSTRAINT IF EXISTS pharmacy_inventory_department_shape,
  ADD CONSTRAINT pharmacy_inventory_department_shape CHECK (
    (
      item_type = 'medicine'
      AND product_id IS NOT NULL
      AND tracks_expiry = TRUE
    )
    OR
    (
      item_type = 'store'
      AND product_id IS NULL
      AND NULLIF(TRIM(item_name), '') IS NOT NULL
    )
  ),
  DROP CONSTRAINT IF EXISTS pharmacy_inventory_unit_cost_non_negative,
  ADD CONSTRAINT pharmacy_inventory_unit_cost_non_negative CHECK (
    unit_cost IS NULL OR unit_cost >= 0
  );

CREATE INDEX IF NOT EXISTS pharmacy_inventory_department_idx
  ON public.pharmacy_inventory (pharmacy_id, item_type)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_inventory_store_barcode_unique
  ON public.pharmacy_inventory (pharmacy_id, barcode)
  WHERE item_type = 'store'
    AND barcode IS NOT NULL
    AND NULLIF(TRIM(barcode), '') IS NOT NULL
    AND deleted_at IS NULL;

-- Store rows are never visible through patient/anonymous inventory access.
DROP POLICY IF EXISTS inventory_listed_anon_select ON public.pharmacy_inventory;
CREATE POLICY inventory_listed_anon_select
ON public.pharmacy_inventory
FOR SELECT
TO anon
USING (
  item_type = 'medicine'
  AND is_listed = TRUE
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS inventory_authenticated_select ON public.pharmacy_inventory;
CREATE POLICY inventory_authenticated_select
ON public.pharmacy_inventory
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = pharmacy_inventory.pharmacy_id
      AND ph.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users usr
    WHERE usr.user_id = auth.uid()
      AND (
        usr.is_admin = TRUE
        OR (
          usr.role = 'patient'
          AND pharmacy_inventory.item_type = 'medicine'
          AND pharmacy_inventory.is_listed = TRUE
          AND pharmacy_inventory.deleted_at IS NULL
        )
      )
  )
);

-- Purchase and receiving lines can target either a catalogue product or an
-- existing tenant-owned store inventory row.
ALTER TABLE public.purchase_order_items
  ALTER COLUMN product_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS inventory_id UUID
    REFERENCES public.pharmacy_inventory(id) ON DELETE RESTRICT;

ALTER TABLE public.purchase_order_items
  DROP CONSTRAINT IF EXISTS purchase_order_items_target_shape,
  ADD CONSTRAINT purchase_order_items_target_shape CHECK (
    (product_id IS NOT NULL AND inventory_id IS NULL)
    OR (product_id IS NULL AND inventory_id IS NOT NULL)
  );

ALTER TABLE public.goods_receipt_items
  ALTER COLUMN product_id DROP NOT NULL,
  ALTER COLUMN batch_id DROP NOT NULL;

-- Atomic add path for both departments.
CREATE OR REPLACE FUNCTION public.create_inventory_item(
  p_pharmacy_id UUID,
  p_item JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.inventory_item_type :=
    COALESCE(NULLIF(p_item->>'item_type', ''), 'medicine')::public.inventory_item_type;
  v_tracks_expiry BOOLEAN :=
    CASE WHEN v_type = 'medicine' THEN TRUE
         ELSE COALESCE((p_item->>'tracks_expiry')::BOOLEAN, FALSE) END;
  v_product_id UUID := NULLIF(p_item->>'product_id', '')::UUID;
  v_inventory_id UUID;
  v_batch_id UUID;
  v_quantity INTEGER := COALESCE((p_item->>'quantity_in_stock')::INTEGER, 0);
  v_price NUMERIC := (p_item->>'price')::NUMERIC;
  v_cost NUMERIC := NULLIF(p_item->>'unit_cost', '')::NUMERIC;
  v_batch_number TEXT := NULLIF(TRIM(p_item->>'batch_number'), '');
  v_expiry_date DATE := NULLIF(p_item->>'expiry_date', '')::DATE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;

  IF v_price <= 0 OR v_quantity < 0 OR COALESCE(v_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Price, quantity, or cost is invalid';
  END IF;

  IF v_type = 'medicine' THEN
    IF v_product_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.products p WHERE p.id = v_product_id
    ) THEN
      RAISE EXCEPTION 'A valid catalogue product is required for medicine';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.pharmacy_inventory pi
      WHERE pi.pharmacy_id = p_pharmacy_id
        AND pi.product_id = v_product_id
        AND pi.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'This medicine is already in inventory';
    END IF;
  ELSE
    v_product_id := NULL;
    IF NULLIF(TRIM(p_item->>'item_name'), '') IS NULL THEN
      RAISE EXCEPTION 'Store item name is required';
    END IF;
    IF NULLIF(TRIM(p_item->>'barcode'), '') IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.pharmacy_inventory pi
      WHERE pi.pharmacy_id = p_pharmacy_id
        AND pi.item_type = 'store'
        AND pi.barcode = TRIM(p_item->>'barcode')
        AND pi.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'This barcode is already in store inventory';
    END IF;
  END IF;

  IF v_tracks_expiry AND (v_batch_number IS NULL OR v_expiry_date IS NULL) THEN
    RAISE EXCEPTION 'Batch number and expiry date are required for expiry-tracked items';
  END IF;
  IF v_tracks_expiry AND v_expiry_date <= CURRENT_DATE THEN
    RAISE EXCEPTION 'Expired stock cannot be added';
  END IF;

  INSERT INTO public.pharmacy_inventory (
    pharmacy_id, product_id, item_type, tracks_expiry,
    item_name, brand, barcode, unit_description, store_category,
    price, unit_cost, low_stock_threshold, quantity_in_stock,
    is_listed, image_url
  ) VALUES (
    p_pharmacy_id, v_product_id, v_type, v_tracks_expiry,
    CASE WHEN v_type = 'store' THEN TRIM(p_item->>'item_name') END,
    CASE WHEN v_type = 'store' THEN NULLIF(TRIM(p_item->>'brand'), '') END,
    CASE WHEN v_type = 'store' THEN NULLIF(TRIM(p_item->>'barcode'), '') END,
    CASE WHEN v_type = 'store' THEN NULLIF(TRIM(p_item->>'unit_description'), '') END,
    CASE WHEN v_type = 'store' THEN COALESCE(NULLIF(TRIM(p_item->>'store_category'), ''), 'Airtime/Other') END,
    v_price, v_cost,
    COALESCE((p_item->>'low_stock_threshold')::INTEGER, 10),
    0, TRUE, NULLIF(p_item->>'pharmacy_image_url', '')
  )
  RETURNING id INTO v_inventory_id;

  IF v_tracks_expiry THEN
    INSERT INTO public.batches (
      inventory_id, batch_number, expiry_date, quantity_received, cost_price
    ) VALUES (
      v_inventory_id, v_batch_number, v_expiry_date, v_quantity, v_cost
    ) RETURNING id INTO v_batch_id;
  END IF;

  IF v_quantity > 0 THEN
    INSERT INTO public.stock_movements (
      inventory_id, batch_id, type, quantity, reason, reference, created_by
    ) VALUES (
      v_inventory_id, v_batch_id, 'opening', v_quantity,
      'Opening stock', 'CREATE_INVENTORY_ITEM', auth.uid()
    );
  END IF;

  RETURN v_inventory_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_inventory_item(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_inventory_item(UUID, JSONB) TO authenticated;

-- Mixed import router. Store rows never create products.
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
        price, unit_cost, low_stock_threshold, quantity_in_stock, is_listed
      ) VALUES (
        p_pharmacy_id, v_product_id, 'medicine', TRUE,
        v_price, v_cost, 10, 0, TRUE
      ) RETURNING id INTO v_inventory_id;
    ELSE
      UPDATE public.pharmacy_inventory
      SET price = v_price, unit_cost = COALESCE(v_cost, unit_cost), updated_at = NOW()
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
        price, unit_cost, low_stock_threshold, quantity_in_stock, is_listed
      ) VALUES (
        p_pharmacy_id, NULL, 'store', v_tracks_expiry,
        TRIM(p_mapped->>'generic_name'),
        NULLIF(TRIM(p_mapped->>'brand_name'), ''),
        NULLIF(TRIM(p_mapped->>'sku'), ''),
        NULLIF(TRIM(p_mapped->>'pack_size'), ''),
        COALESCE(NULLIF(TRIM(p_mapped->>'category'), ''), 'Airtime/Other'),
        v_price, v_cost, 10, 0, TRUE
      ) RETURNING id INTO v_inventory_id;
    ELSE
      UPDATE public.pharmacy_inventory
      SET price = v_price,
          unit_cost = COALESCE(v_cost, unit_cost),
          tracks_expiry = v_tracks_expiry,
          updated_at = NOW()
      WHERE id = v_inventory_id;
    END IF;
  END IF;

  IF v_tracks_expiry THEN
    IF v_batch_number IS NULL OR v_expiry_date IS NULL THEN
      RAISE EXCEPTION 'Batch and expiry are required for expiry-tracked rows';
    END IF;
    IF v_expiry_date <= CURRENT_DATE THEN
      RAISE EXCEPTION 'Expired stock cannot be imported';
    END IF;
    INSERT INTO public.batches (
      inventory_id, batch_number, expiry_date, quantity_received, cost_price
    ) VALUES (
      v_inventory_id, v_batch_number, v_expiry_date, v_quantity, v_cost
    ) RETURNING id INTO v_batch_id;
  END IF;

  IF v_quantity > 0 THEN
    INSERT INTO public.stock_movements (
      inventory_id, batch_id, type, quantity, reason, reference, created_by
    ) VALUES (
      v_inventory_id, v_batch_id, 'opening', v_quantity,
      'Opening stock (Imported)', 'INVENTORY_IMPORT', p_user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'product_id', v_product_id,
    'inventory_id', v_inventory_id,
    'batch_id', v_batch_id,
    'item_type', v_type
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.import_inventory_row(UUID, UUID, TEXT, JSONB) FROM PUBLIC;

-- Patient demand remains catalogue-backed and explicitly ignores store rows.
CREATE OR REPLACE FUNCTION public.get_unmet_demand(
  p_pharmacy_id UUID,
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_city TEXT
)
RETURNS TABLE (
  id UUID,
  generic_name TEXT,
  brand_name TEXT,
  strength TEXT,
  dosage_form TEXT,
  category TEXT,
  search_volume BIGINT,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.generic_name, p.brand_name, p.strength, p.dosage_form, p.category,
    COUNT(s.id) AS search_volume,
    CASE WHEN pi.id IS NULL THEN 'Not Stocked'::TEXT ELSE 'Out of Stock'::TEXT END
  FROM public.searches s
  JOIN public.products p ON p.id = s.product_id
  LEFT JOIN public.pharmacy_inventory pi
    ON pi.product_id = p.id
   AND pi.pharmacy_id = p_pharmacy_id
   AND pi.item_type = 'medicine'
  WHERE s.timestamp >= NOW() - INTERVAL '7 days'
    AND (
      (
        p_lat IS NOT NULL AND p_lng IS NOT NULL
        AND (s.metadata->>'latitude') IS NOT NULL
        AND (s.metadata->>'longitude') IS NOT NULL
        AND 6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians((s.metadata->>'latitude')::NUMERIC))
          * cos(radians((s.metadata->>'longitude')::NUMERIC) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians((s.metadata->>'latitude')::NUMERIC))
        ))) <= 15
      )
      OR (
        p_city IS NOT NULL
        AND s.location IS NOT NULL
        AND s.location ILIKE '%' || p_city || '%'
      )
    )
    AND (pi.id IS NULL OR pi.quantity_in_stock = 0)
  GROUP BY p.id, p.generic_name, p.brand_name, p.strength,
           p.dosage_form, p.category, pi.id
  ORDER BY search_volume DESC
  LIMIT 5;
END;
$$;

-- One mixed sale. Batches are mandatory only for expiry-tracked rows.
CREATE OR REPLACE FUNCTION public.sync_pos_sale(
  p_pharmacy_id UUID,
  p_sale JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID := (p_sale->>'id')::UUID;
  v_status TEXT;
  v_item JSONB;
  v_inventory_id UUID;
  v_batch_id UUID;
  v_quantity INTEGER;
  v_available INTEGER;
  v_unit_price NUMERIC;
  v_tracks_expiry BOOLEAN;
  v_subtotal NUMERIC := 0;
  v_discount NUMERIC := COALESCE((p_sale->>'discount')::NUMERIC, 0);
  v_total NUMERIC;
  v_group RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  IF jsonb_typeof(p_sale->'items') <> 'array'
     OR jsonb_array_length(p_sale->'items') = 0 THEN
    RAISE EXCEPTION 'A sale must contain at least one item';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_sale_id::TEXT));
  SELECT s.status INTO v_status FROM public.sales s
  WHERE s.id = v_sale_id FOR UPDATE;
  IF v_status = 'completed' THEN
    RETURN jsonb_build_object('success', TRUE, 'id', v_sale_id, 'replayed', TRUE);
  END IF;
  IF v_status IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = v_sale_id AND s.pharmacy_id = p_pharmacy_id
  ) THEN RAISE EXCEPTION 'Sale ID belongs to another pharmacy'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_sale->'items')
  LOOP
    v_inventory_id := (v_item->>'inventory_id')::UUID;
    v_batch_id := NULLIF(v_item->>'batch_id', '')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Sale quantities must be positive'; END IF;

    SELECT pi.quantity_in_stock, pi.price, pi.tracks_expiry
    INTO v_available, v_unit_price, v_tracks_expiry
    FROM public.pharmacy_inventory pi
    WHERE pi.id = v_inventory_id
      AND pi.pharmacy_id = p_pharmacy_id
      AND pi.deleted_at IS NULL
      AND pi.is_listed
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventory item % is not sellable for this pharmacy', v_inventory_id;
    END IF;

    IF v_tracks_expiry AND (
      v_batch_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.batches b
        WHERE b.id = v_batch_id
          AND b.inventory_id = v_inventory_id
          AND b.expiry_date > CURRENT_DATE
      )
    ) THEN
      RAISE EXCEPTION 'A valid unexpired owned batch is required for inventory item %', v_inventory_id;
    END IF;
    IF NOT v_tracks_expiry AND v_batch_id IS NOT NULL THEN
      RAISE EXCEPTION 'Non-expiry inventory item % must not reference a batch', v_inventory_id;
    END IF;
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
  END LOOP;

  FOR v_group IN
    SELECT (item->>'inventory_id')::UUID AS inventory_id,
           SUM((item->>'quantity')::INTEGER)::INTEGER AS requested
    FROM jsonb_array_elements(p_sale->'items') item
    GROUP BY (item->>'inventory_id')::UUID
  LOOP
    SELECT pi.quantity_in_stock INTO v_available
    FROM public.pharmacy_inventory pi
    WHERE pi.id = v_group.inventory_id AND pi.pharmacy_id = p_pharmacy_id
    FOR UPDATE;
    IF v_available < v_group.requested THEN
      RAISE EXCEPTION 'Insufficient stock for inventory item %: requested %, available %',
        v_group.inventory_id, v_group.requested, v_available;
    END IF;
  END LOOP;

  FOR v_group IN
    SELECT (item->>'batch_id')::UUID AS batch_id,
           SUM((item->>'quantity')::INTEGER)::INTEGER AS requested
    FROM jsonb_array_elements(p_sale->'items') item
    WHERE NULLIF(item->>'batch_id', '') IS NOT NULL
    GROUP BY (item->>'batch_id')::UUID
  LOOP
    SELECT COALESCE(SUM(sm.quantity), 0)::INTEGER INTO v_available
    FROM public.stock_movements sm WHERE sm.batch_id = v_group.batch_id;
    IF v_available < v_group.requested THEN
      RAISE EXCEPTION 'Insufficient batch stock for batch %: requested %, available %',
        v_group.batch_id, v_group.requested, v_available;
    END IF;
  END LOOP;

  IF v_discount < 0 OR v_discount > v_subtotal THEN
    RAISE EXCEPTION 'Discount must be between zero and subtotal';
  END IF;
  v_total := v_subtotal - v_discount;

  INSERT INTO public.sales (
    id, pharmacy_id, cashier_id, subtotal, discount, total,
    payment_method, status, created_at, synced_at, updated_at
  ) VALUES (
    v_sale_id, p_pharmacy_id, auth.uid(), v_subtotal, v_discount, v_total,
    (p_sale->>'payment_method')::public.payment_method_type, 'pending',
    COALESCE((p_sale->>'created_at')::TIMESTAMPTZ, NOW()), NOW(), NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET subtotal = EXCLUDED.subtotal,
      discount = EXCLUDED.discount,
      total = EXCLUDED.total,
      payment_method = EXCLUDED.payment_method,
      synced_at = NOW(),
      updated_at = NOW()
  WHERE public.sales.pharmacy_id = p_pharmacy_id
    AND public.sales.status = 'pending';

  DELETE FROM public.sale_items WHERE sale_id = v_sale_id;
  INSERT INTO public.sale_items (
    sale_id, inventory_id, batch_id, quantity, unit_price, line_total
  )
  SELECT
    v_sale_id,
    (item->>'inventory_id')::UUID,
    NULLIF(item->>'batch_id', '')::UUID,
    (item->>'quantity')::NUMERIC,
    pi.price,
    (item->>'quantity')::NUMERIC * pi.price
  FROM jsonb_array_elements(p_sale->'items') item
  JOIN public.pharmacy_inventory pi
    ON pi.id = (item->>'inventory_id')::UUID
   AND pi.pharmacy_id = p_pharmacy_id;

  UPDATE public.sales
  SET status = 'completed', synced_at = NOW(), updated_at = NOW()
  WHERE id = v_sale_id AND pharmacy_id = p_pharmacy_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale could not be completed'; END IF;

  RETURN jsonb_build_object(
    'success', TRUE, 'id', v_sale_id, 'replayed', FALSE,
    'subtotal', v_subtotal, 'discount', v_discount, 'total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_pos_sale(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_pos_sale(UUID, JSONB) FROM authenticated, anon;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_items_inventory_unique
  ON public.purchase_order_items (po_id, inventory_id)
  WHERE inventory_id IS NOT NULL;

-- Purchase orders accept catalogue medicines or existing store inventory rows.
CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_pharmacy_id UUID,
  p_supplier_id UUID,
  p_expected_date DATE,
  p_notes TEXT,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po_id UUID;
  v_po_number TEXT;
  v_subtotal NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = p_supplier_id AND s.pharmacy_id = p_pharmacy_id AND s.is_active
  ) THEN RAISE EXCEPTION 'Supplier is not active for this pharmacy'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Purchase order must contain at least one item';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) item
    LEFT JOIN public.products p
      ON p.id = NULLIF(item->>'product_id', '')::UUID
    LEFT JOIN public.pharmacy_inventory pi
      ON pi.id = NULLIF(item->>'inventory_id', '')::UUID
     AND pi.pharmacy_id = p_pharmacy_id
     AND pi.item_type = 'store'
     AND pi.deleted_at IS NULL
    WHERE COALESCE((item->>'quantity_ordered')::INTEGER, 0) <= 0
       OR COALESCE((item->>'unit_cost')::NUMERIC, -1) < 0
       OR (
         (p.id IS NULL AND pi.id IS NULL)
         OR (p.id IS NOT NULL AND pi.id IS NOT NULL)
       )
  ) THEN
    RAISE EXCEPTION 'Each PO line needs one valid medicine or store item and valid quantity/cost';
  END IF;

  SELECT SUM(
    (item->>'quantity_ordered')::INTEGER * (item->>'unit_cost')::NUMERIC
  ) INTO v_subtotal
  FROM jsonb_array_elements(p_items) item;

  v_po_number := 'PO-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 6));
  INSERT INTO public.purchase_orders (
    pharmacy_id, supplier_id, po_number, expected_date, subtotal, notes, created_by
  ) VALUES (
    p_pharmacy_id, p_supplier_id, v_po_number, p_expected_date, v_subtotal,
    NULLIF(TRIM(p_notes), ''), auth.uid()
  ) RETURNING id INTO v_po_id;

  INSERT INTO public.purchase_order_items (
    po_id, product_id, inventory_id, quantity_ordered, unit_cost, line_total
  )
  SELECT
    v_po_id,
    NULLIF(item->>'product_id', '')::UUID,
    NULLIF(item->>'inventory_id', '')::UUID,
    (item->>'quantity_ordered')::INTEGER,
    (item->>'unit_cost')::NUMERIC,
    (item->>'quantity_ordered')::INTEGER * (item->>'unit_cost')::NUMERIC
  FROM jsonb_array_elements(p_items) item;

  RETURN v_po_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_order(UUID, UUID, DATE, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(UUID, UUID, DATE, TEXT, JSONB) TO authenticated;

-- Goods receiving follows the target inventory item's expiry policy.
CREATE OR REPLACE FUNCTION public.receive_goods(
  p_pharmacy_id UUID,
  p_supplier_id UUID,
  p_po_id UUID,
  p_notes TEXT,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_id UUID;
  v_receipt_number TEXT;
  v_line JSONB;
  v_product_id UUID;
  v_requested_inventory_id UUID;
  v_po_item_id UUID;
  v_inventory_id UUID;
  v_batch_id UUID;
  v_quantity INTEGER;
  v_unit_cost NUMERIC;
  v_batch_number TEXT;
  v_expiry_date DATE;
  v_remaining INTEGER;
  v_po_status TEXT;
  v_tracks_expiry BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = p_supplier_id AND s.pharmacy_id = p_pharmacy_id AND s.is_active
  ) THEN RAISE EXCEPTION 'Supplier is not active for this pharmacy'; END IF;
  IF p_po_id IS NOT NULL THEN
    SELECT po.status INTO v_po_status
    FROM public.purchase_orders po
    WHERE po.id = p_po_id
      AND po.pharmacy_id = p_pharmacy_id
      AND po.supplier_id = p_supplier_id
    FOR UPDATE;
    IF v_po_status IS NULL OR v_po_status IN ('received', 'cancelled') THEN
      RAISE EXCEPTION 'Purchase order is not open for receiving';
    END IF;
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one receiving line is required';
  END IF;

  v_receipt_number := 'GR-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 6));
  INSERT INTO public.goods_receipts (
    pharmacy_id, supplier_id, po_id, receipt_number, notes, received_by
  ) VALUES (
    p_pharmacy_id, p_supplier_id, p_po_id, v_receipt_number,
    NULLIF(TRIM(p_notes), ''), auth.uid()
  ) RETURNING id INTO v_receipt_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::UUID;
    v_requested_inventory_id := NULLIF(v_line->>'inventory_id', '')::UUID;
    v_po_item_id := NULLIF(v_line->>'po_item_id', '')::UUID;
    v_quantity := COALESCE((v_line->>'quantity_received')::INTEGER, 0);
    v_unit_cost := COALESCE((v_line->>'unit_cost')::NUMERIC, -1);
    v_batch_number := NULLIF(TRIM(v_line->>'batch_number'), '');
    v_expiry_date := NULLIF(v_line->>'expiry_date', '')::DATE;

    IF v_quantity <= 0 OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Receiving line has invalid quantity or cost';
    END IF;
    IF (v_product_id IS NULL) = (v_requested_inventory_id IS NULL) THEN
      RAISE EXCEPTION 'Receiving line must identify one medicine or store item';
    END IF;

    IF v_product_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_product_id) THEN
        RAISE EXCEPTION 'Catalogue product does not exist';
      END IF;
      INSERT INTO public.pharmacy_inventory (
        pharmacy_id, product_id, item_type, tracks_expiry,
        price, unit_cost, quantity_in_stock, is_listed
      ) VALUES (
        p_pharmacy_id, v_product_id, 'medicine', TRUE,
        v_unit_cost, v_unit_cost, 0, TRUE
      )
      ON CONFLICT (pharmacy_id, product_id) DO NOTHING;
      SELECT pi.id, pi.tracks_expiry INTO v_inventory_id, v_tracks_expiry
      FROM public.pharmacy_inventory pi
      WHERE pi.pharmacy_id = p_pharmacy_id
        AND pi.product_id = v_product_id
        AND pi.deleted_at IS NULL
      FOR UPDATE;
    ELSE
      SELECT pi.id, pi.tracks_expiry INTO v_inventory_id, v_tracks_expiry
      FROM public.pharmacy_inventory pi
      WHERE pi.id = v_requested_inventory_id
        AND pi.pharmacy_id = p_pharmacy_id
        AND pi.item_type = 'store'
        AND pi.deleted_at IS NULL
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Store inventory item is not owned by this pharmacy'; END IF;
    END IF;

    IF p_po_id IS NOT NULL THEN
      SELECT poi.quantity_ordered - poi.quantity_received
      INTO v_remaining
      FROM public.purchase_order_items poi
      WHERE poi.id = v_po_item_id
        AND poi.po_id = p_po_id
        AND (
          (v_product_id IS NOT NULL AND poi.product_id = v_product_id)
          OR (v_requested_inventory_id IS NOT NULL AND poi.inventory_id = v_requested_inventory_id)
        )
      FOR UPDATE;
      IF v_remaining IS NULL THEN RAISE EXCEPTION 'Receiving line does not belong to this PO'; END IF;
      IF v_quantity > v_remaining THEN
        RAISE EXCEPTION 'Received quantity % exceeds PO remainder %', v_quantity, v_remaining;
      END IF;
    ELSIF v_po_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'Direct receipt cannot reference a PO line';
    END IF;

    v_batch_id := NULL;
    IF v_tracks_expiry THEN
      IF v_batch_number IS NULL OR v_expiry_date IS NULL THEN
        RAISE EXCEPTION 'Batch number and expiry date are required for this item';
      END IF;
      IF v_expiry_date <= CURRENT_DATE THEN RAISE EXCEPTION 'Expired batches cannot be received'; END IF;
      IF v_expiry_date < (CURRENT_DATE + INTERVAL '4 months')::DATE
         AND COALESCE((v_line->>'short_dated_confirmed')::BOOLEAN, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'Short-dated batch % requires explicit confirmation', v_batch_number;
      END IF;
      SELECT b.id INTO v_batch_id
      FROM public.batches b
      WHERE b.inventory_id = v_inventory_id
        AND b.batch_number = v_batch_number
        AND b.expiry_date = v_expiry_date
        AND b.supplier_id = p_supplier_id
      FOR UPDATE;
      IF v_batch_id IS NULL THEN
        INSERT INTO public.batches (
          inventory_id, batch_number, expiry_date, quantity_received,
          cost_price, supplier_id, purchase_order_id,
          purchase_order_item_id, received_at
        ) VALUES (
          v_inventory_id, v_batch_number, v_expiry_date, v_quantity,
          v_unit_cost, p_supplier_id, p_po_id, v_po_item_id, NOW()
        ) RETURNING id INTO v_batch_id;
      ELSE
        UPDATE public.batches
        SET quantity_received = quantity_received + v_quantity,
            cost_price = v_unit_cost,
            received_at = NOW()
        WHERE id = v_batch_id;
      END IF;
    END IF;

    UPDATE public.pharmacy_inventory
    SET unit_cost = v_unit_cost
    WHERE id = v_inventory_id;
    INSERT INTO public.stock_movements (
      inventory_id, batch_id, type, quantity, reason, reference, created_by
    ) VALUES (
      v_inventory_id, v_batch_id, 'restock', v_quantity,
      CASE WHEN p_po_id IS NULL THEN 'Direct goods receipt' ELSE 'Purchase order receipt' END,
      COALESCE(p_po_id::TEXT, v_receipt_id::TEXT), auth.uid()
    );
    INSERT INTO public.goods_receipt_items (
      receipt_id, po_item_id, product_id, inventory_id, batch_id,
      quantity_received, unit_cost, line_total
    ) VALUES (
      v_receipt_id, v_po_item_id, v_product_id, v_inventory_id, v_batch_id,
      v_quantity, v_unit_cost, v_quantity * v_unit_cost
    );
    IF v_po_item_id IS NOT NULL THEN
      UPDATE public.purchase_order_items
      SET quantity_received = quantity_received + v_quantity,
          unit_cost = v_unit_cost,
          line_total = quantity_ordered * v_unit_cost
      WHERE id = v_po_item_id;
    END IF;
  END LOOP;

  IF p_po_id IS NOT NULL THEN
    UPDATE public.purchase_orders po
    SET status = CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM public.purchase_order_items poi
        WHERE poi.po_id = po.id AND poi.quantity_received < poi.quantity_ordered
      ) THEN 'received'
      ELSE 'partially_received'
    END,
    subtotal = (
      SELECT COALESCE(SUM(poi.line_total), 0)
      FROM public.purchase_order_items poi WHERE poi.po_id = po.id
    ),
    updated_at = NOW()
    WHERE po.id = p_po_id;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_goods(UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_goods(UUID, UUID, UUID, TEXT, JSONB) TO authenticated;

-- The same ledger feeds combined totals and department-aware detail.
CREATE OR REPLACE FUNCTION public.get_pharmacy_reports(
  p_pharmacy_id UUID,
  p_from DATE DEFAULT CURRENT_DATE - 30,
  p_to DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_daily JSONB;
  v_valuation JSONB;
  v_margin JSONB;
  v_dead JSONB;
  v_expiry JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  IF p_from > p_to OR p_to - p_from > 366 THEN RAISE EXCEPTION 'Invalid reporting range'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.sale_date DESC), '[]'::JSONB)
  INTO v_daily
  FROM (
    SELECT
      s.created_at::DATE AS sale_date,
      COUNT(*)::INTEGER AS transaction_count,
      COALESCE(SUM(lines.item_count), 0)::INTEGER AS item_count,
      SUM(s.total)::NUMERIC(14,2) AS total_sales,
      COALESCE(SUM(
        CASE WHEN s.subtotal > 0
          THEN lines.medicine_sales * s.total / s.subtotal ELSE 0 END
      ), 0)::NUMERIC(14,2) AS medicine_sales,
      COALESCE(SUM(
        CASE WHEN s.subtotal > 0
          THEN lines.store_sales * s.total / s.subtotal ELSE 0 END
      ), 0)::NUMERIC(14,2) AS store_sales,
      COALESCE(SUM(lines.medicine_items), 0)::INTEGER AS medicine_items,
      COALESCE(SUM(lines.store_items), 0)::INTEGER AS store_items,
      SUM(s.total) FILTER (WHERE s.payment_method = 'cash')::NUMERIC(14,2) AS cash,
      SUM(s.total) FILTER (WHERE s.payment_method = 'bank_transfer')::NUMERIC(14,2) AS bank_transfer,
      SUM(s.total) FILTER (WHERE s.payment_method = 'pharmacy_pos_terminal')::NUMERIC(14,2) AS terminal,
      SUM(s.total) FILTER (WHERE s.payment_method = 'other')::NUMERIC(14,2) AS other
    FROM public.sales s
    JOIN LATERAL (
      SELECT
        SUM(si.quantity)::NUMERIC AS item_count,
        COALESCE(SUM(si.line_total) FILTER (WHERE pi.item_type = 'medicine'), 0) AS medicine_sales,
        COALESCE(SUM(si.line_total) FILTER (WHERE pi.item_type = 'store'), 0) AS store_sales,
        COALESCE(SUM(si.quantity) FILTER (WHERE pi.item_type = 'medicine'), 0) AS medicine_items,
        COALESCE(SUM(si.quantity) FILTER (WHERE pi.item_type = 'store'), 0) AS store_items
      FROM public.sale_items si
      JOIN public.pharmacy_inventory pi ON pi.id = si.inventory_id
      WHERE si.sale_id = s.id
    ) lines ON TRUE
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.status = 'completed'
      AND s.created_at >= p_from::TIMESTAMPTZ
      AND s.created_at < (p_to + 1)::TIMESTAMPTZ
    GROUP BY s.created_at::DATE
  ) row_data;

  WITH batch_cost AS (
    SELECT
      b.inventory_id,
      CASE WHEN SUM(sm.quantity) > 0
        THEN SUM(sm.quantity * COALESCE(b.cost_price, 0)) / SUM(sm.quantity)
        ELSE 0 END AS unit_cost
    FROM public.batches b
    JOIN public.stock_movements sm ON sm.batch_id = b.id
    GROUP BY b.inventory_id
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.retail_value DESC), '[]'::JSONB)
  INTO v_valuation
  FROM (
    SELECT
      pi.id AS inventory_id,
      pi.product_id,
      pi.item_type AS department,
      COALESCE(p.generic_name, pi.item_name) AS generic_name,
      COALESCE(p.brand_name, pi.brand) AS brand_name,
      COALESCE(p.strength, pi.unit_description) AS strength,
      pi.quantity_in_stock AS quantity,
      ROUND(COALESCE(bc.unit_cost, pi.unit_cost, 0), 2) AS unit_cost,
      pi.price AS retail_price,
      ROUND(pi.quantity_in_stock * COALESCE(bc.unit_cost, pi.unit_cost, 0), 2) AS cost_value,
      ROUND(pi.quantity_in_stock * pi.price, 2) AS retail_value
    FROM public.pharmacy_inventory pi
    LEFT JOIN public.products p ON p.id = pi.product_id
    LEFT JOIN batch_cost bc ON bc.inventory_id = pi.id
    WHERE pi.pharmacy_id = p_pharmacy_id
      AND pi.deleted_at IS NULL
      AND pi.quantity_in_stock > 0
  ) row_data;

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.margin DESC), '[]'::JSONB)
  INTO v_margin
  FROM (
    SELECT
      pi.id AS inventory_id,
      pi.product_id,
      pi.item_type AS department,
      COALESCE(p.generic_name, pi.item_name) AS generic_name,
      COALESCE(p.brand_name, pi.brand) AS brand_name,
      COALESCE(p.strength, pi.unit_description) AS strength,
      SUM(si.quantity)::NUMERIC AS quantity_sold,
      SUM(si.line_total)::NUMERIC(14,2) AS revenue,
      SUM(si.quantity * COALESCE(b.cost_price, pi.unit_cost, 0))::NUMERIC(14,2) AS cogs,
      (SUM(si.line_total) - SUM(si.quantity * COALESCE(b.cost_price, pi.unit_cost, 0)))::NUMERIC(14,2) AS margin
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    JOIN public.pharmacy_inventory pi ON pi.id = si.inventory_id
    LEFT JOIN public.products p ON p.id = pi.product_id
    LEFT JOIN public.batches b ON b.id = si.batch_id
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.status = 'completed'
      AND s.created_at >= p_from::TIMESTAMPTZ
      AND s.created_at < (p_to + 1)::TIMESTAMPTZ
    GROUP BY pi.id, pi.product_id, pi.item_type, p.generic_name, p.brand_name,
             p.strength, pi.item_name, pi.brand, pi.unit_description
  ) row_data;

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.capital_tied_up DESC), '[]'::JSONB)
  INTO v_dead
  FROM (
    SELECT
      pi.id AS inventory_id,
      pi.product_id,
      pi.item_type AS department,
      COALESCE(p.generic_name, pi.item_name) AS generic_name,
      COALESCE(p.brand_name, pi.brand) AS brand_name,
      COALESCE(p.strength, pi.unit_description) AS strength,
      pi.quantity_in_stock AS quantity,
      MAX(sm.created_at) FILTER (WHERE sm.type = 'sale') AS last_sale_at,
      ROUND(pi.quantity_in_stock * COALESCE(pi.unit_cost, recent.cost_price, 0), 2) AS capital_tied_up
    FROM public.pharmacy_inventory pi
    LEFT JOIN public.products p ON p.id = pi.product_id
    LEFT JOIN public.stock_movements sm ON sm.inventory_id = pi.id
    LEFT JOIN LATERAL (
      SELECT b.cost_price FROM public.batches b
      WHERE b.inventory_id = pi.id
      ORDER BY COALESCE(b.received_at, b.created_at) DESC LIMIT 1
    ) recent ON TRUE
    WHERE pi.pharmacy_id = p_pharmacy_id
      AND pi.deleted_at IS NULL
      AND pi.quantity_in_stock > 0
    GROUP BY pi.id, pi.product_id, pi.item_type, p.generic_name, p.brand_name,
             p.strength, pi.item_name, pi.brand, pi.unit_description, recent.cost_price
    HAVING MAX(sm.created_at) FILTER (WHERE sm.type = 'sale') IS NULL
      OR MAX(sm.created_at) FILTER (WHERE sm.type = 'sale') < NOW() - INTERVAL '90 days'
  ) row_data;

  WITH exposure AS (
    SELECT
      pi.item_type AS department,
      b.expiry_date,
      GREATEST(COALESCE(SUM(sm.quantity), 0), 0)::NUMERIC AS quantity,
      COALESCE(b.cost_price, pi.unit_cost, 0) AS cost_price,
      pi.price
    FROM public.batches b
    JOIN public.pharmacy_inventory pi ON pi.id = b.inventory_id
    LEFT JOIN public.stock_movements sm ON sm.batch_id = b.id
    WHERE pi.pharmacy_id = p_pharmacy_id
      AND pi.tracks_expiry
      AND b.expiry_date >= CURRENT_DATE
      AND b.expiry_date <= CURRENT_DATE + 90
    GROUP BY pi.item_type, b.id, b.expiry_date, b.cost_price, pi.unit_cost, pi.price
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.days, row_data.department), '[]'::JSONB)
  INTO v_expiry
  FROM (
    SELECT
      bucket.days,
      department.item_type AS department,
      ROUND(COALESCE(SUM(exposure.quantity * exposure.cost_price), 0), 2) AS cost_value,
      ROUND(COALESCE(SUM(exposure.quantity * exposure.price), 0), 2) AS retail_value,
      COALESCE(SUM(exposure.quantity), 0)::INTEGER AS units
    FROM (VALUES (30), (60), (90)) bucket(days)
    CROSS JOIN (VALUES ('medicine'::public.inventory_item_type), ('store'::public.inventory_item_type)) department(item_type)
    LEFT JOIN exposure
      ON exposure.department = department.item_type
     AND exposure.expiry_date <= CURRENT_DATE + bucket.days
     AND exposure.expiry_date > CURRENT_DATE +
       CASE bucket.days WHEN 30 THEN 0 ELSE bucket.days - 30 END
    GROUP BY bucket.days, department.item_type
  ) row_data;

  RETURN jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'daily_sales', v_daily,
    'stock_valuation', v_valuation,
    'margin_per_product', v_margin,
    'dead_stock', v_dead,
    'expiry_exposure', v_expiry
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pharmacy_reports(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pharmacy_reports(UUID, DATE, DATE) TO authenticated;

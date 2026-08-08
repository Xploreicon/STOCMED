CREATE TABLE IF NOT EXISTS public.selling_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES public.pharmacy_inventory(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL CHECK (length(trim(unit_name)) BETWEEN 2 AND 80),
  units_per INTEGER NOT NULL CHECK (units_per > 1),
  price NUMERIC(14,2) NOT NULL CHECK (price > 0),
  barcode TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(inventory_id, unit_name),
  UNIQUE(barcode)
);

ALTER TABLE public.pharmacy_inventory
  ADD COLUMN IF NOT EXISTS base_unit_name TEXT NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS whole_pack_only BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS selling_unit_id UUID REFERENCES public.selling_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_selling_units_inventory
  ON public.selling_units(inventory_id, sort_order, created_at);

ALTER TABLE public.selling_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS selling_units_owner_all ON public.selling_units;
CREATE POLICY selling_units_owner_all
ON public.selling_units FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pharmacy_inventory inventory
    JOIN public.pharmacies pharmacy ON pharmacy.id = inventory.pharmacy_id
    WHERE inventory.id = selling_units.inventory_id
      AND pharmacy.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pharmacy_inventory inventory
    JOIN public.pharmacies pharmacy ON pharmacy.id = inventory.pharmacy_id
    WHERE inventory.id = selling_units.inventory_id
      AND pharmacy.user_id = auth.uid()
  )
);

-- Patient reads are intentionally not granted: selling-unit pricing is till data.
REVOKE ALL ON public.selling_units FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.selling_units TO authenticated;

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
  v_selling_unit_id UUID;
  v_quantity INTEGER;
  v_available INTEGER;
  v_unit_price NUMERIC;
  v_tracks_expiry BOOLEAN;
  v_whole_pack_only BOOLEAN;
  v_units_per INTEGER;
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
  SELECT s.status INTO v_status FROM public.sales s WHERE s.id = v_sale_id FOR UPDATE;
  IF v_status = 'completed' THEN
    RETURN jsonb_build_object('success', TRUE, 'id', v_sale_id, 'replayed', TRUE);
  END IF;
  IF v_status IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id = v_sale_id AND s.pharmacy_id = p_pharmacy_id
  ) THEN RAISE EXCEPTION 'Sale ID belongs to another pharmacy'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_sale->'items')
  LOOP
    v_inventory_id := (v_item->>'inventory_id')::UUID;
    v_batch_id := NULLIF(v_item->>'batch_id', '')::UUID;
    v_selling_unit_id := NULLIF(v_item->>'selling_unit_id', '')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Sale quantities must be positive'; END IF;

    SELECT pi.quantity_in_stock, pi.price, pi.tracks_expiry, pi.whole_pack_only
    INTO v_available, v_unit_price, v_tracks_expiry, v_whole_pack_only
    FROM public.pharmacy_inventory pi
    WHERE pi.id = v_inventory_id
      AND pi.pharmacy_id = p_pharmacy_id
      AND pi.deleted_at IS NULL
      AND pi.is_listed
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item % is not sellable', v_inventory_id; END IF;

    IF v_selling_unit_id IS NOT NULL THEN
      SELECT su.units_per, su.price / su.units_per
      INTO v_units_per, v_unit_price
      FROM public.selling_units su
      WHERE su.id = v_selling_unit_id AND su.inventory_id = v_inventory_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Selling unit does not belong to this item'; END IF;
    ELSE
      v_units_per := 1;
      IF v_whole_pack_only THEN RAISE EXCEPTION 'This medicine must be sold as a whole pack'; END IF;
    END IF;

    IF v_tracks_expiry AND (
      v_batch_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.batches b
        WHERE b.id = v_batch_id AND b.inventory_id = v_inventory_id AND b.expiry_date > CURRENT_DATE
      )
    ) THEN RAISE EXCEPTION 'A valid unexpired owned batch is required'; END IF;
    IF NOT v_tracks_expiry AND v_batch_id IS NOT NULL THEN
      RAISE EXCEPTION 'Non-expiry inventory must not reference a batch';
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
      RAISE EXCEPTION 'Insufficient stock: requested %, available %', v_group.requested, v_available;
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
      RAISE EXCEPTION 'Insufficient batch stock: requested %, available %', v_group.requested, v_available;
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
  SET subtotal = EXCLUDED.subtotal, discount = EXCLUDED.discount, total = EXCLUDED.total,
      payment_method = EXCLUDED.payment_method, synced_at = NOW(), updated_at = NOW()
  WHERE public.sales.pharmacy_id = p_pharmacy_id AND public.sales.status = 'pending';

  DELETE FROM public.sale_items WHERE sale_id = v_sale_id;
  INSERT INTO public.sale_items (
    sale_id, inventory_id, batch_id, quantity, unit_price, line_total, selling_unit_id
  )
  SELECT
    v_sale_id,
    (item->>'inventory_id')::UUID,
    NULLIF(item->>'batch_id', '')::UUID,
    (item->>'quantity')::NUMERIC,
    CASE WHEN su.id IS NULL THEN pi.price ELSE su.price / su.units_per END,
    (item->>'quantity')::NUMERIC *
      CASE WHEN su.id IS NULL THEN pi.price ELSE su.price / su.units_per END,
    su.id
  FROM jsonb_array_elements(p_sale->'items') item
  JOIN public.pharmacy_inventory pi
    ON pi.id = (item->>'inventory_id')::UUID AND pi.pharmacy_id = p_pharmacy_id
  LEFT JOIN public.selling_units su
    ON su.id = NULLIF(item->>'selling_unit_id', '')::UUID AND su.inventory_id = pi.id;

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

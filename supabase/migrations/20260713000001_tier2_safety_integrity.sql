-- Tier 2: safety semantics, transactional POS/imports, canonical demand, append-only ledger.

ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.handle_sale_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    item RECORD;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.stock_movements WHERE reference = NEW.id::TEXT
    ) THEN
        RETURN NEW;
    END IF;

    FOR item IN
        SELECT
            inventory_id,
            batch_id,
            SUM(quantity)::INTEGER AS quantity
        FROM public.sale_items
        WHERE sale_id = NEW.id
        GROUP BY inventory_id, batch_id
    LOOP
        INSERT INTO public.stock_movements (
            inventory_id,
            batch_id,
            type,
            quantity,
            reason,
            reference,
            created_by
        ) VALUES (
            item.inventory_id,
            item.batch_id,
            'sale',
            -item.quantity,
            'Sale #' || NEW.id,
            NEW.id::TEXT,
            NEW.cashier_id
        )
        ON CONFLICT DO NOTHING;
    END LOOP;

    RETURN NEW;
END;
$$;

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
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.pharmacies ph
        WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized for this pharmacy';
    END IF;

    IF jsonb_typeof(p_sale->'items') <> 'array'
       OR jsonb_array_length(p_sale->'items') = 0 THEN
        RAISE EXCEPTION 'A sale must contain at least one item';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_sale_id::TEXT));

    SELECT status
    INTO v_status
    FROM public.sales
    WHERE id = v_sale_id
    FOR UPDATE;

    IF v_status = 'completed' THEN
        RETURN jsonb_build_object('success', TRUE, 'id', v_sale_id, 'replayed', TRUE);
    END IF;

    IF v_status IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.sales WHERE id = v_sale_id AND pharmacy_id = p_pharmacy_id
    ) THEN
        RAISE EXCEPTION 'Sale ID belongs to another pharmacy';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_sale->'items')
    LOOP
        v_inventory_id := (v_item->>'inventory_id')::UUID;
        v_batch_id := NULLIF(v_item->>'batch_id', '')::UUID;
        v_quantity := (v_item->>'quantity')::INTEGER;

        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'Sale quantities must be positive';
        END IF;

        SELECT quantity_in_stock
        INTO v_available
        FROM public.pharmacy_inventory
        WHERE id = v_inventory_id AND pharmacy_id = p_pharmacy_id
        FOR UPDATE;

        IF v_available IS NULL THEN
            RAISE EXCEPTION 'Inventory item % is not owned by this pharmacy', v_inventory_id;
        END IF;

        IF v_batch_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.batches
            WHERE id = v_batch_id AND inventory_id = v_inventory_id
        ) THEN
            RAISE EXCEPTION 'Batch % does not belong to inventory item %', v_batch_id, v_inventory_id;
        END IF;

        SELECT COALESCE(SUM((item->>'quantity')::INTEGER), 0)
        INTO v_quantity
        FROM jsonb_array_elements(p_sale->'items') item
        WHERE (item->>'inventory_id')::UUID = v_inventory_id;

        IF v_available < v_quantity THEN
            RAISE EXCEPTION 'Insufficient stock for inventory item %: requested %, available %',
                v_inventory_id, v_quantity, v_available;
        END IF;
    END LOOP;

    INSERT INTO public.sales (
        id,
        pharmacy_id,
        cashier_id,
        subtotal,
        discount,
        total,
        payment_method,
        status,
        created_at,
        synced_at,
        updated_at
    ) VALUES (
        v_sale_id,
        p_pharmacy_id,
        auth.uid(),
        (p_sale->>'subtotal')::NUMERIC,
        COALESCE((p_sale->>'discount')::NUMERIC, 0),
        (p_sale->>'total')::NUMERIC,
        (p_sale->>'payment_method')::public.payment_method_type,
        'pending',
        COALESCE((p_sale->>'created_at')::TIMESTAMPTZ, NOW()),
        NOW(),
        NOW()
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
        sale_id,
        inventory_id,
        batch_id,
        quantity,
        unit_price,
        line_total
    )
    SELECT
        v_sale_id,
        (item->>'inventory_id')::UUID,
        NULLIF(item->>'batch_id', '')::UUID,
        (item->>'quantity')::NUMERIC,
        (item->>'unit_price')::NUMERIC,
        (item->>'line_total')::NUMERIC
    FROM jsonb_array_elements(p_sale->'items') item;

    UPDATE public.sales
    SET status = 'completed', synced_at = NOW(), updated_at = NOW()
    WHERE id = v_sale_id AND pharmacy_id = p_pharmacy_id AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale could not be completed';
    END IF;

    RETURN jsonb_build_object('success', TRUE, 'id', v_sale_id, 'replayed', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_pos_sale(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_pos_sale(UUID, JSONB) TO authenticated;

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
    v_result JSONB;
    v_row_number INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL
       OR auth.uid() <> p_user_id
       OR NOT EXISTS (
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
        v_result := public.import_inventory_row(
            p_pharmacy_id,
            p_user_id,
            v_row->>'selected_product_id',
            v_row->'mapped'
        );

        IF NOT COALESCE((v_result->>'success')::BOOLEAN, FALSE) THEN
            RAISE EXCEPTION 'Row % failed: %', v_row_number, COALESCE(v_result->>'error', 'unknown error');
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', TRUE,
        'imported', v_row_number,
        'total', v_row_number
    );
END;
$$;

REVOKE ALL ON FUNCTION public.import_inventory_row(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_inventory_row(UUID, UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.import_inventory_row(UUID, UUID, TEXT, JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB) TO authenticated;

ALTER TABLE public.searches
    ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS searches_product_id_timestamp_idx
    ON public.searches(product_id, timestamp DESC);

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
        p.id,
        p.generic_name,
        p.brand_name,
        p.strength,
        p.dosage_form,
        p.category,
        COUNT(s.id) AS search_volume,
        CASE WHEN pi.id IS NULL THEN 'Not Stocked'::TEXT ELSE 'Out of Stock'::TEXT END
    FROM public.searches s
    JOIN public.products p ON p.id = s.product_id
    LEFT JOIN public.pharmacy_inventory pi
        ON pi.product_id = p.id AND pi.pharmacy_id = p_pharmacy_id
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
    GROUP BY p.id, p.generic_name, p.brand_name, p.strength, p.dosage_form, p.category, pi.id
    ORDER BY search_volume DESC
    LIMIT 5;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_stock_movement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'stock_movements is append-only; % is prohibited', TG_OP
        USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_movements_append_only ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_append_only
BEFORE UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.prevent_stock_movement_mutation();

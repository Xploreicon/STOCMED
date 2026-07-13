-- Close the four Tier 2 verification gaps on already-migrated databases.

-- Backfill canonical product IDs for historical anonymous demand records.
WITH candidates AS (
    SELECT
        s.id AS search_id,
        COALESCE(
            CASE
                WHEN (s.interpreted_query->>'product_id') ~* '^[0-9a-f-]{36}$'
                THEN (s.interpreted_query->>'product_id')::UUID
            END,
            (
                SELECT p.id
                FROM public.products p
                WHERE s.query_text NOT LIKE 'hash:%'
                  AND (
                      LOWER(p.generic_name) = LOWER(COALESCE(
                          s.interpreted_query->'parsed'->>'drug_name', s.query_text
                      ))
                      OR LOWER(COALESCE(p.brand_name, '')) = LOWER(COALESCE(
                          s.interpreted_query->'parsed'->>'drug_name', s.query_text
                      ))
                      OR similarity(p.generic_name, COALESCE(
                          s.interpreted_query->'parsed'->>'drug_name', s.query_text
                      )) >= 0.35
                      OR similarity(COALESCE(p.brand_name, ''), COALESCE(
                          s.interpreted_query->'parsed'->>'drug_name', s.query_text
                      )) >= 0.35
                  )
                ORDER BY
                    CASE
                        WHEN LOWER(p.generic_name) = LOWER(COALESCE(
                            s.interpreted_query->'parsed'->>'drug_name', s.query_text
                        )) THEN 2
                        WHEN LOWER(COALESCE(p.brand_name, '')) = LOWER(COALESCE(
                            s.interpreted_query->'parsed'->>'drug_name', s.query_text
                        )) THEN 2
                        ELSE 1
                    END DESC,
                    GREATEST(
                        similarity(p.generic_name, COALESCE(
                            s.interpreted_query->'parsed'->>'drug_name', s.query_text
                        )),
                        similarity(COALESCE(p.brand_name, ''), COALESCE(
                            s.interpreted_query->'parsed'->>'drug_name', s.query_text
                        ))
                    ) DESC
                LIMIT 1
            )
        ) AS product_id
    FROM public.searches s
    WHERE s.product_id IS NULL
)
UPDATE public.searches s
SET product_id = candidates.product_id,
    interpreted_query = COALESCE(s.interpreted_query, '{}'::JSONB)
        || jsonb_build_object('product_id', candidates.product_id)
FROM candidates
WHERE s.id = candidates.search_id
  AND candidates.product_id IS NOT NULL;

-- Ledger history owns its foreign keys. Parent deletion is explicitly restricted.
ALTER TABLE public.stock_movements
    DROP CONSTRAINT IF EXISTS stock_movements_inventory_id_fkey;
ALTER TABLE public.stock_movements
    ADD CONSTRAINT stock_movements_inventory_id_fkey
    FOREIGN KEY (inventory_id) REFERENCES public.pharmacy_inventory(id) ON DELETE RESTRICT;

ALTER TABLE public.stock_movements
    DROP CONSTRAINT IF EXISTS stock_movements_batch_id_fkey;
ALTER TABLE public.stock_movements
    ADD CONSTRAINT stock_movements_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES public.batches(id) ON DELETE RESTRICT;

-- Recompute all monetary arithmetic from authoritative inventory prices and quantities.
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
    v_subtotal NUMERIC := 0;
    v_discount NUMERIC := COALESCE((p_sale->>'discount')::NUMERIC, 0);
    v_total NUMERIC;
    v_group RECORD;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.pharmacies ph
        WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized for this pharmacy';
    END IF;

    IF jsonb_typeof(p_sale->'items') <> 'array'
       OR jsonb_array_length(p_sale->'items') = 0 THEN
        RAISE EXCEPTION 'A sale must contain at least one item';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_sale_id::TEXT));

    SELECT s.status INTO v_status
    FROM public.sales s
    WHERE s.id = v_sale_id
    FOR UPDATE;

    IF v_status = 'completed' THEN
        RETURN jsonb_build_object('success', TRUE, 'id', v_sale_id, 'replayed', TRUE);
    END IF;

    IF v_status IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.id = v_sale_id AND s.pharmacy_id = p_pharmacy_id
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

        SELECT pi.quantity_in_stock, pi.price
        INTO v_available, v_unit_price
        FROM public.pharmacy_inventory pi
        WHERE pi.id = v_inventory_id AND pi.pharmacy_id = p_pharmacy_id
        FOR UPDATE;

        IF v_available IS NULL THEN
            RAISE EXCEPTION 'Inventory item % is not owned by this pharmacy', v_inventory_id;
        END IF;

        IF v_batch_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.batches b
            WHERE b.id = v_batch_id AND b.inventory_id = v_inventory_id
        ) THEN
            RAISE EXCEPTION 'A valid owned batch is required for inventory item %', v_inventory_id;
        END IF;

        v_subtotal := v_subtotal + (v_quantity * v_unit_price);
    END LOOP;

    FOR v_group IN
        SELECT
            (item->>'inventory_id')::UUID AS inventory_id,
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
        SELECT
            (item->>'batch_id')::UUID AS batch_id,
            SUM((item->>'quantity')::INTEGER)::INTEGER AS requested
        FROM jsonb_array_elements(p_sale->'items') item
        GROUP BY (item->>'batch_id')::UUID
    LOOP
        SELECT COALESCE(SUM(sm.quantity), 0)::INTEGER INTO v_available
        FROM public.stock_movements sm
        WHERE sm.batch_id = v_group.batch_id;

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
        (item->>'batch_id')::UUID,
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

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale could not be completed';
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'id', v_sale_id,
        'replayed', FALSE,
        'subtotal', v_subtotal,
        'discount', v_discount,
        'total', v_total
    );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_pos_sale(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_pos_sale(UUID, JSONB) TO authenticated;

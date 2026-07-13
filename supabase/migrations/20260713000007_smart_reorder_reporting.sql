-- Part B.4 and Part D: smart reorder and thin ledger-derived reporting.

CREATE TABLE IF NOT EXISTS public.quickbooks_import_staging (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    source_name TEXT NOT NULL,
    sku TEXT,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    retail_price NUMERIC(14,2) NOT NULL CHECK (retail_price >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS quickbooks_import_staging_queue_idx
    ON public.quickbooks_import_staging(pharmacy_id, status, created_at);
ALTER TABLE public.quickbooks_import_staging ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quickbooks_import_staging_owner_all ON public.quickbooks_import_staging;
CREATE POLICY quickbooks_import_staging_owner_all ON public.quickbooks_import_staging FOR ALL
USING (EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = quickbooks_import_staging.pharmacy_id AND ph.user_id = auth.uid()
))
WITH CHECK (EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = quickbooks_import_staging.pharmacy_id AND ph.user_id = auth.uid()
));

CREATE OR REPLACE FUNCTION public.stage_quickbooks_import(
    p_pharmacy_id UUID,
    p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.pharmacies ph
        WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
    ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
    IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
        RAISE EXCEPTION 'QuickBooks import must contain at least one row';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_rows) row
        LEFT JOIN public.products p ON p.id = NULLIF(row->>'selected_product_id', '')::UUID
        WHERE p.id IS NULL
           OR COALESCE((row->'mapped'->>'quantity')::INTEGER, -1) < 0
           OR COALESCE((row->'mapped'->>'price')::NUMERIC, -1) < 0
    ) THEN RAISE EXCEPTION 'Every QuickBooks row needs a catalogue match and valid quantity/price'; END IF;

    INSERT INTO public.quickbooks_import_staging(
        pharmacy_id, product_id, source_name, sku, quantity,
        unit_cost, retail_price, created_by
    )
    SELECT p_pharmacy_id, (row->>'selected_product_id')::UUID,
           COALESCE(NULLIF(row->'mapped'->>'generic_name', ''), p.generic_name),
           NULLIF(row->'mapped'->>'sku', ''),
           (row->'mapped'->>'quantity')::INTEGER,
           COALESCE((row->'mapped'->>'unit_cost')::NUMERIC, 0),
           (row->'mapped'->>'price')::NUMERIC,
           auth.uid()
    FROM jsonb_array_elements(p_rows) row
    JOIN public.products p ON p.id = (row->>'selected_product_id')::UUID;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('success', TRUE, 'staged', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_quickbooks_expiry(
    p_pharmacy_id UUID,
    p_staging_id UUID,
    p_batch_number TEXT,
    p_expiry_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_stage public.quickbooks_import_staging%ROWTYPE; v_product public.products%ROWTYPE; v_result JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.pharmacies ph
        WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
    ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
    IF NULLIF(TRIM(p_batch_number), '') IS NULL OR p_expiry_date <= CURRENT_DATE THEN
        RAISE EXCEPTION 'A batch number and future expiry date are required';
    END IF;

    SELECT * INTO v_stage FROM public.quickbooks_import_staging
    WHERE id = p_staging_id AND pharmacy_id = p_pharmacy_id AND status = 'pending'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pending QuickBooks item not found'; END IF;
    SELECT * INTO v_product FROM public.products WHERE id = v_stage.product_id;

    v_result := public.import_inventory_row(
        p_pharmacy_id,
        auth.uid(),
        v_stage.product_id::TEXT,
        jsonb_build_object(
            'generic_name', v_product.generic_name,
            'brand_name', v_product.brand_name,
            'strength', v_product.strength,
            'dosage_form', v_product.dosage_form,
            'category', v_product.category,
            'pack_size', v_product.pack_size,
            'price', v_stage.retail_price,
            'quantity', v_stage.quantity,
            'batch_number', TRIM(p_batch_number),
            'expiry_date', p_expiry_date
        )
    );
    IF NOT COALESCE((v_result->>'success')::BOOLEAN, FALSE) THEN
        RAISE EXCEPTION 'Expiry capture failed: %', COALESCE(v_result->>'error', 'unknown error');
    END IF;
    UPDATE public.batches SET cost_price = v_stage.unit_cost
    WHERE id = (v_result->>'batch_id')::UUID;
    UPDATE public.quickbooks_import_staging
    SET status = 'completed', completed_at = NOW() WHERE id = v_stage.id;
    RETURN v_result || jsonb_build_object('staging_id', v_stage.id, 'success', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.stage_quickbooks_import(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stage_quickbooks_import(UUID, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.capture_quickbooks_expiry(UUID, UUID, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_quickbooks_expiry(UUID, UUID, TEXT, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_reorder_suggestions(
    p_pharmacy_id UUID,
    p_limit INTEGER DEFAULT 8
)
RETURNS TABLE (
    inventory_id UUID,
    product_id UUID,
    generic_name TEXT,
    brand_name TEXT,
    strength TEXT,
    dosage_form TEXT,
    current_stock INTEGER,
    daily_velocity NUMERIC,
    days_to_stockout INTEGER,
    unmet_demand BIGINT,
    unit_margin NUMERIC,
    suggested_quantity INTEGER,
    supplier_id UUID,
    supplier_name TEXT,
    unit_cost NUMERIC,
    rank_score NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.pharmacies ph
        WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
    ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;

    RETURN QUERY
    WITH sold AS (
        SELECT si.inventory_id, SUM(si.quantity)::NUMERIC / 30 AS velocity
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
        WHERE s.pharmacy_id = p_pharmacy_id
          AND s.status = 'completed'
          AND s.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY si.inventory_id
    ), demand AS (
        SELECT s.product_id, COUNT(*)::BIGINT AS demand_count
        FROM public.searches s
        CROSS JOIN public.pharmacies ph
        WHERE ph.id = p_pharmacy_id
          AND s.product_id IS NOT NULL
          AND s.timestamp >= NOW() - INTERVAL '7 days'
          AND (
              (ph.city IS NOT NULL AND s.location ILIKE '%' || ph.city || '%')
              OR (ph.city IS NULL AND s.location IS NULL)
          )
        GROUP BY s.product_id
    )
    SELECT
        pi.id,
        p.id,
        p.generic_name,
        p.brand_name,
        p.strength,
        p.dosage_form,
        pi.quantity_in_stock,
        ROUND(COALESCE(sold.velocity, 0), 2),
        CASE
            WHEN COALESCE(sold.velocity, 0) <= 0 THEN NULL
            ELSE CEIL(pi.quantity_in_stock / sold.velocity)::INTEGER
        END,
        COALESCE(demand.demand_count, 0),
        GREATEST(pi.price - COALESCE(recent.cost_price, 0), 0),
        GREATEST(
            pi.low_stock_threshold * 2 - pi.quantity_in_stock,
            CEIL(COALESCE(sold.velocity, 0) * 30 - pi.quantity_in_stock)::INTEGER,
            1
        ),
        recent.supplier_id,
        recent.supplier_name,
        COALESCE(recent.cost_price, 0),
        ROUND(
            GREATEST(COALESCE(sold.velocity, 0), 0.01)
            * GREATEST(COALESCE(demand.demand_count, 0), 1)
            * GREATEST(pi.price - COALESCE(recent.cost_price, 0), 0.01),
            2
        )
    FROM public.pharmacy_inventory pi
    JOIN public.products p ON p.id = pi.product_id
    LEFT JOIN sold ON sold.inventory_id = pi.id
    LEFT JOIN demand ON demand.product_id = pi.product_id
    LEFT JOIN LATERAL (
        SELECT b.supplier_id, s.name AS supplier_name, b.cost_price
        FROM public.batches b
        LEFT JOIN public.suppliers s ON s.id = b.supplier_id
        WHERE b.inventory_id = pi.id
        ORDER BY COALESCE(b.received_at, b.created_at) DESC
        LIMIT 1
    ) recent ON TRUE
    WHERE pi.pharmacy_id = p_pharmacy_id
      AND pi.is_listed = TRUE
      AND (
          pi.quantity_in_stock <= pi.low_stock_threshold
          OR (COALESCE(sold.velocity, 0) > 0 AND pi.quantity_in_stock / sold.velocity <= 14)
          OR (pi.quantity_in_stock = 0 AND COALESCE(demand.demand_count, 0) > 0)
      )
    ORDER BY 16 DESC, 10 DESC, 8 DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25);
END;
$$;

REVOKE ALL ON FUNCTION public.get_reorder_suggestions(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reorder_suggestions(UUID, INTEGER) TO authenticated;

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
        SELECT s.created_at::DATE AS sale_date,
               COUNT(*)::INTEGER AS transaction_count,
               COALESCE(SUM(si.item_count), 0)::INTEGER AS item_count,
               SUM(s.total)::NUMERIC(14,2) AS total_sales,
               SUM(s.total) FILTER (WHERE s.payment_method = 'cash')::NUMERIC(14,2) AS cash,
               SUM(s.total) FILTER (WHERE s.payment_method = 'bank_transfer')::NUMERIC(14,2) AS bank_transfer,
               SUM(s.total) FILTER (WHERE s.payment_method = 'pharmacy_pos_terminal')::NUMERIC(14,2) AS terminal,
               SUM(s.total) FILTER (WHERE s.payment_method = 'other')::NUMERIC(14,2) AS other
        FROM public.sales s
        LEFT JOIN LATERAL (
            SELECT SUM(quantity)::INTEGER AS item_count FROM public.sale_items WHERE sale_id = s.id
        ) si ON TRUE
        WHERE s.pharmacy_id = p_pharmacy_id AND s.status = 'completed'
          AND s.created_at >= p_from::TIMESTAMPTZ
          AND s.created_at < (p_to + 1)::TIMESTAMPTZ
        GROUP BY s.created_at::DATE
    ) row_data;

    WITH batch_stock AS (
        SELECT b.inventory_id, SUM(sm.quantity)::NUMERIC AS quantity,
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
        SELECT pi.id AS inventory_id, p.id AS product_id, p.generic_name, p.brand_name,
               p.strength, pi.quantity_in_stock AS quantity,
               ROUND(COALESCE(bs.unit_cost, 0), 2) AS unit_cost, pi.price AS retail_price,
               ROUND(pi.quantity_in_stock * COALESCE(bs.unit_cost, 0), 2) AS cost_value,
               ROUND(pi.quantity_in_stock * pi.price, 2) AS retail_value
        FROM public.pharmacy_inventory pi
        JOIN public.products p ON p.id = pi.product_id
        LEFT JOIN batch_stock bs ON bs.inventory_id = pi.id
        WHERE pi.pharmacy_id = p_pharmacy_id AND pi.quantity_in_stock > 0
    ) row_data;

    SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.margin DESC), '[]'::JSONB)
    INTO v_margin
    FROM (
        SELECT p.id AS product_id, p.generic_name, p.brand_name, p.strength,
               SUM(si.quantity)::NUMERIC AS quantity_sold,
               SUM(si.line_total)::NUMERIC(14,2) AS revenue,
               SUM(si.quantity * COALESCE(b.cost_price, 0))::NUMERIC(14,2) AS cogs,
               (SUM(si.line_total) - SUM(si.quantity * COALESCE(b.cost_price, 0)))::NUMERIC(14,2) AS margin
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
        JOIN public.pharmacy_inventory pi ON pi.id = si.inventory_id
        JOIN public.products p ON p.id = pi.product_id
        LEFT JOIN public.batches b ON b.id = si.batch_id
        WHERE s.pharmacy_id = p_pharmacy_id AND s.status = 'completed'
          AND s.created_at >= p_from::TIMESTAMPTZ
          AND s.created_at < (p_to + 1)::TIMESTAMPTZ
        GROUP BY p.id, p.generic_name, p.brand_name, p.strength
    ) row_data;

    SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.capital_tied_up DESC), '[]'::JSONB)
    INTO v_dead
    FROM (
        SELECT pi.id AS inventory_id, p.id AS product_id, p.generic_name, p.brand_name,
               p.strength, pi.quantity_in_stock AS quantity,
               MAX(sm.created_at) FILTER (WHERE sm.type = 'sale') AS last_sale_at,
               ROUND(pi.quantity_in_stock * COALESCE(cost.unit_cost, 0), 2) AS capital_tied_up
        FROM public.pharmacy_inventory pi
        JOIN public.products p ON p.id = pi.product_id
        LEFT JOIN public.stock_movements sm ON sm.inventory_id = pi.id
        LEFT JOIN LATERAL (
            SELECT b.cost_price AS unit_cost FROM public.batches b
            WHERE b.inventory_id = pi.id ORDER BY COALESCE(b.received_at, b.created_at) DESC LIMIT 1
        ) cost ON TRUE
        WHERE pi.pharmacy_id = p_pharmacy_id AND pi.quantity_in_stock > 0
        GROUP BY pi.id, p.id, p.generic_name, p.brand_name, p.strength, cost.unit_cost
        HAVING MAX(sm.created_at) FILTER (WHERE sm.type = 'sale') IS NULL
            OR MAX(sm.created_at) FILTER (WHERE sm.type = 'sale') < NOW() - INTERVAL '90 days'
    ) row_data;

    WITH exposure AS (
        SELECT b.id, b.expiry_date, GREATEST(COALESCE(SUM(sm.quantity), 0), 0)::NUMERIC AS quantity,
               COALESCE(b.cost_price, 0) AS cost_price, pi.price
        FROM public.batches b
        JOIN public.pharmacy_inventory pi ON pi.id = b.inventory_id
        LEFT JOIN public.stock_movements sm ON sm.batch_id = b.id
        WHERE pi.pharmacy_id = p_pharmacy_id
          AND b.expiry_date >= CURRENT_DATE AND b.expiry_date <= CURRENT_DATE + 90
        GROUP BY b.id, b.expiry_date, b.cost_price, pi.price
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.days), '[]'::JSONB)
    INTO v_expiry
    FROM (
        SELECT bucket.days,
               ROUND(COALESCE(SUM(exposure.quantity * exposure.cost_price), 0), 2) AS cost_value,
               ROUND(COALESCE(SUM(exposure.quantity * exposure.price), 0), 2) AS retail_value,
               COALESCE(SUM(exposure.quantity), 0)::INTEGER AS units
        FROM (VALUES (30), (60), (90)) bucket(days)
        LEFT JOIN exposure ON exposure.expiry_date <= CURRENT_DATE + bucket.days
          AND exposure.expiry_date > CURRENT_DATE + CASE bucket.days WHEN 30 THEN 0 ELSE bucket.days - 30 END
        GROUP BY bucket.days
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

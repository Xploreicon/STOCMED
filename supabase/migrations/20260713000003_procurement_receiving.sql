-- Part B.1-B.3: suppliers, purchase orders, and atomic goods receiving.

CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    payment_terms TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (pharmacy_id, name)
);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    po_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'partially_received', 'received', 'cancelled')),
    expected_date DATE,
    subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    notes TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (pharmacy_id, po_number)
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
    quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
    unit_cost NUMERIC(14, 2) NOT NULL CHECK (unit_cost >= 0),
    line_total NUMERIC(14, 2) NOT NULL CHECK (line_total >= 0),
    UNIQUE (po_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.goods_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    po_id UUID REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
    receipt_number TEXT NOT NULL,
    notes TEXT,
    received_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (pharmacy_id, receipt_number)
);

ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS supplier_id UUID;
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS purchase_order_id UUID;
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS purchase_order_item_id UUID;
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

ALTER TABLE public.batches DROP CONSTRAINT IF EXISTS batches_supplier_id_fkey;
ALTER TABLE public.batches ADD CONSTRAINT batches_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;
ALTER TABLE public.batches DROP CONSTRAINT IF EXISTS batches_purchase_order_id_fkey;
ALTER TABLE public.batches ADD CONSTRAINT batches_purchase_order_id_fkey
    FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;
ALTER TABLE public.batches DROP CONSTRAINT IF EXISTS batches_purchase_order_item_id_fkey;
ALTER TABLE public.batches ADD CONSTRAINT batches_purchase_order_item_id_fkey
    FOREIGN KEY (purchase_order_item_id) REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.goods_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES public.goods_receipts(id) ON DELETE RESTRICT,
    po_item_id UUID REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    inventory_id UUID NOT NULL REFERENCES public.pharmacy_inventory(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE RESTRICT,
    quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
    unit_cost NUMERIC(14, 2) NOT NULL CHECK (unit_cost >= 0),
    line_total NUMERIC(14, 2) NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS suppliers_pharmacy_idx ON public.suppliers(pharmacy_id, is_active);
CREATE INDEX IF NOT EXISTS purchase_orders_pharmacy_idx ON public.purchase_orders(pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_order_items_po_idx ON public.purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS goods_receipts_pharmacy_idx ON public.goods_receipts(pharmacy_id, received_at DESC);
CREATE INDEX IF NOT EXISTS batches_supplier_idx ON public.batches(supplier_id);
CREATE INDEX IF NOT EXISTS batches_purchase_order_idx ON public.batches(purchase_order_id);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_owner_all ON public.suppliers;
CREATE POLICY suppliers_owner_all ON public.suppliers FOR ALL
USING (EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = suppliers.pharmacy_id AND ph.user_id = auth.uid()
))
WITH CHECK (EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = suppliers.pharmacy_id AND ph.user_id = auth.uid()
));

DROP POLICY IF EXISTS purchase_orders_owner_all ON public.purchase_orders;
CREATE POLICY purchase_orders_owner_all ON public.purchase_orders FOR ALL
USING (EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = purchase_orders.pharmacy_id AND ph.user_id = auth.uid()
))
WITH CHECK (EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = purchase_orders.pharmacy_id AND ph.user_id = auth.uid()
));

DROP POLICY IF EXISTS purchase_order_items_owner_all ON public.purchase_order_items;
CREATE POLICY purchase_order_items_owner_all ON public.purchase_order_items FOR ALL
USING (EXISTS (
    SELECT 1 FROM public.purchase_orders po
    JOIN public.pharmacies ph ON ph.id = po.pharmacy_id
    WHERE po.id = purchase_order_items.po_id AND ph.user_id = auth.uid()
))
WITH CHECK (EXISTS (
    SELECT 1 FROM public.purchase_orders po
    JOIN public.pharmacies ph ON ph.id = po.pharmacy_id
    WHERE po.id = purchase_order_items.po_id AND ph.user_id = auth.uid()
));

DROP POLICY IF EXISTS goods_receipts_owner_select ON public.goods_receipts;
CREATE POLICY goods_receipts_owner_select ON public.goods_receipts FOR SELECT
USING (EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = goods_receipts.pharmacy_id AND ph.user_id = auth.uid()
));

DROP POLICY IF EXISTS goods_receipt_items_owner_select ON public.goods_receipt_items;
CREATE POLICY goods_receipt_items_owner_select ON public.goods_receipt_items FOR SELECT
USING (EXISTS (
    SELECT 1 FROM public.goods_receipts gr
    JOIN public.pharmacies ph ON ph.id = gr.pharmacy_id
    WHERE gr.id = goods_receipt_items.receipt_id AND ph.user_id = auth.uid()
));

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
        SELECT 1 FROM jsonb_array_elements(p_items) item
        WHERE COALESCE((item->>'quantity_ordered')::INTEGER, 0) <= 0
           OR COALESCE((item->>'unit_cost')::NUMERIC, -1) < 0
    ) THEN RAISE EXCEPTION 'PO quantities and costs are invalid'; END IF;

    SELECT COALESCE(SUM(
        (item->>'quantity_ordered')::INTEGER * (item->>'unit_cost')::NUMERIC
    ), 0) INTO v_subtotal
    FROM jsonb_array_elements(p_items) item;

    v_po_number := 'PO-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' ||
        UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 6));

    INSERT INTO public.purchase_orders (
        pharmacy_id, supplier_id, po_number, expected_date, subtotal,
        notes, created_by
    ) VALUES (
        p_pharmacy_id, p_supplier_id, v_po_number, p_expected_date,
        v_subtotal, NULLIF(TRIM(p_notes), ''), auth.uid()
    ) RETURNING id INTO v_po_id;

    INSERT INTO public.purchase_order_items (
        po_id, product_id, quantity_ordered, unit_cost, line_total
    )
    SELECT
        v_po_id,
        (item->>'product_id')::UUID,
        (item->>'quantity_ordered')::INTEGER,
        (item->>'unit_cost')::NUMERIC,
        (item->>'quantity_ordered')::INTEGER * (item->>'unit_cost')::NUMERIC
    FROM jsonb_array_elements(p_items) item
    JOIN public.products p ON p.id = (item->>'product_id')::UUID;

    IF (SELECT COUNT(*) FROM public.purchase_order_items WHERE po_id = v_po_id)
       <> jsonb_array_length(p_items) THEN
        RAISE EXCEPTION 'One or more catalogue products do not exist';
    END IF;

    RETURN v_po_id;
END;
$$;

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
    v_po_item_id UUID;
    v_inventory_id UUID;
    v_batch_id UUID;
    v_quantity INTEGER;
    v_unit_cost NUMERIC;
    v_batch_number TEXT;
    v_expiry_date DATE;
    v_remaining INTEGER;
    v_po_status TEXT;
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
        v_product_id := (v_line->>'product_id')::UUID;
        v_po_item_id := NULLIF(v_line->>'po_item_id', '')::UUID;
        v_quantity := (v_line->>'quantity_received')::INTEGER;
        v_unit_cost := (v_line->>'unit_cost')::NUMERIC;
        v_batch_number := TRIM(v_line->>'batch_number');
        v_expiry_date := (v_line->>'expiry_date')::DATE;

        IF v_quantity <= 0 OR v_unit_cost < 0 OR v_batch_number = '' THEN
            RAISE EXCEPTION 'Receiving line has invalid quantity, cost, or batch number';
        END IF;
        IF v_expiry_date <= CURRENT_DATE THEN
            RAISE EXCEPTION 'Expired batches cannot be received';
        END IF;
        IF v_expiry_date < (CURRENT_DATE + INTERVAL '4 months')::DATE
           AND COALESCE((v_line->>'short_dated_confirmed')::BOOLEAN, FALSE) IS NOT TRUE THEN
            RAISE EXCEPTION 'Short-dated batch % requires explicit confirmation', v_batch_number;
        END IF;

        IF p_po_id IS NOT NULL THEN
            SELECT poi.quantity_ordered - poi.quantity_received
            INTO v_remaining
            FROM public.purchase_order_items poi
            WHERE poi.id = v_po_item_id
              AND poi.po_id = p_po_id
              AND poi.product_id = v_product_id
            FOR UPDATE;
            IF v_remaining IS NULL THEN RAISE EXCEPTION 'Receiving line does not belong to this PO'; END IF;
            IF v_quantity > v_remaining THEN
                RAISE EXCEPTION 'Received quantity % exceeds PO remainder %', v_quantity, v_remaining;
            END IF;
        ELSIF v_po_item_id IS NOT NULL THEN
            RAISE EXCEPTION 'Direct receipt cannot reference a PO line';
        END IF;

        INSERT INTO public.pharmacy_inventory (
            pharmacy_id, product_id, price, quantity_in_stock, is_listed
        ) VALUES (
            p_pharmacy_id, v_product_id, v_unit_cost, 0, TRUE
        )
        ON CONFLICT (pharmacy_id, product_id) DO NOTHING;

        SELECT pi.id INTO v_inventory_id
        FROM public.pharmacy_inventory pi
        WHERE pi.pharmacy_id = p_pharmacy_id AND pi.product_id = v_product_id
        FOR UPDATE;

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
                    WHERE poi.po_id = p_po_id AND poi.quantity_received < poi.quantity_ordered
                ) THEN 'received'
                ELSE 'partially_received'
            END,
            updated_at = NOW(),
            subtotal = (
                SELECT COALESCE(SUM(poi.line_total), 0)
                FROM public.purchase_order_items poi WHERE poi.po_id = p_po_id
            )
        WHERE po.id = p_po_id;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'receipt_id', v_receipt_id,
        'receipt_number', v_receipt_number
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_order(UUID, UUID, DATE, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(UUID, UUID, DATE, TEXT, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.receive_goods(UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_goods(UUID, UUID, UUID, TEXT, JSONB) TO authenticated;

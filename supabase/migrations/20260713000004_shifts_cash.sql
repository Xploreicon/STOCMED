-- Part C: cashier shifts, cash reconciliation, and Z-reporting.

CREATE TABLE IF NOT EXISTS public.shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
    cashier_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opening_float NUMERIC(14, 2) NOT NULL CHECK (opening_float >= 0),
    closed_at TIMESTAMPTZ,
    counted_cash NUMERIC(14, 2),
    expected_cash NUMERIC(14, 2),
    variance NUMERIC(14, 2),
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (status = 'open' AND closed_at IS NULL AND counted_cash IS NULL)
        OR
        (status = 'closed' AND closed_at IS NOT NULL AND counted_cash IS NOT NULL
         AND expected_cash IS NOT NULL AND variance IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_cashier_idx
    ON public.shifts(pharmacy_id, cashier_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS shifts_pharmacy_history_idx
    ON public.shifts(pharmacy_id, opened_at DESC);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS shift_id UUID;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_shift_id_fkey;
ALTER TABLE public.sales ADD CONSTRAINT sales_shift_id_fkey
    FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sales_shift_idx ON public.sales(shift_id, status);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shifts_owner_all ON public.shifts;
CREATE POLICY shifts_owner_all ON public.shifts FOR ALL
USING (EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = shifts.pharmacy_id AND ph.user_id = auth.uid()
))
WITH CHECK (EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = shifts.pharmacy_id AND ph.user_id = auth.uid()
));

CREATE OR REPLACE FUNCTION public.sync_shift_open(
    p_shift_id UUID,
    p_pharmacy_id UUID,
    p_opening_float NUMERIC,
    p_opened_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_existing public.shifts%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.pharmacies ph
        WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
    ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
    IF p_opening_float < 0 THEN RAISE EXCEPTION 'Opening float cannot be negative'; END IF;

    SELECT * INTO v_existing FROM public.shifts WHERE id = p_shift_id;
    IF FOUND THEN
        IF v_existing.pharmacy_id <> p_pharmacy_id OR v_existing.cashier_id <> auth.uid() THEN
            RAISE EXCEPTION 'Shift ID belongs to another cashier or pharmacy';
        END IF;
        RETURN jsonb_build_object('success', TRUE, 'id', p_shift_id, 'replayed', TRUE);
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.shifts
        WHERE pharmacy_id = p_pharmacy_id AND cashier_id = auth.uid() AND status = 'open'
    ) THEN RAISE EXCEPTION 'This cashier already has an open shift'; END IF;

    INSERT INTO public.shifts(id, pharmacy_id, cashier_id, opening_float, opened_at)
    VALUES(p_shift_id, p_pharmacy_id, auth.uid(), p_opening_float, COALESCE(p_opened_at, NOW()));
    RETURN jsonb_build_object('success', TRUE, 'id', p_shift_id, 'replayed', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_pos_sale_with_shift(
    p_pharmacy_id UUID,
    p_sale JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
    v_shift_id UUID := NULLIF(p_sale->>'shift_id', '')::UUID;
BEGIN
    IF v_shift_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.shifts s
        WHERE s.id = v_shift_id
          AND s.pharmacy_id = p_pharmacy_id
          AND s.cashier_id = auth.uid()
          AND s.status = 'open'
    ) THEN RAISE EXCEPTION 'An open cashier shift is required'; END IF;

    v_result := public.sync_pos_sale(p_pharmacy_id, p_sale);
    UPDATE public.sales
    SET shift_id = v_shift_id, updated_at = NOW()
    WHERE id = (p_sale->>'id')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND (shift_id IS NULL OR shift_id = v_shift_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Sale could not be attached to shift'; END IF;
    RETURN v_result || jsonb_build_object('shift_id', v_shift_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_shift_close(
    p_shift_id UUID,
    p_pharmacy_id UUID,
    p_counted_cash NUMERIC,
    p_notes TEXT,
    p_closed_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_shift public.shifts%ROWTYPE;
    v_cash_sales NUMERIC;
    v_expected NUMERIC;
    v_variance NUMERIC;
BEGIN
    IF auth.uid() IS NULL OR p_counted_cash < 0 THEN
        RAISE EXCEPTION 'Valid cashier and counted cash are required';
    END IF;
    SELECT * INTO v_shift FROM public.shifts
    WHERE id = p_shift_id AND pharmacy_id = p_pharmacy_id AND cashier_id = auth.uid()
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
    IF v_shift.status = 'closed' THEN
        RETURN jsonb_build_object(
            'success', TRUE, 'id', v_shift.id, 'replayed', TRUE,
            'expected_cash', v_shift.expected_cash, 'variance', v_shift.variance
        );
    END IF;

    SELECT COALESCE(SUM(total), 0) INTO v_cash_sales
    FROM public.sales
    WHERE shift_id = p_shift_id AND status = 'completed' AND payment_method = 'cash';
    v_expected := v_shift.opening_float + v_cash_sales;
    v_variance := p_counted_cash - v_expected;

    UPDATE public.shifts SET
        status = 'closed', closed_at = COALESCE(p_closed_at, NOW()),
        counted_cash = p_counted_cash, expected_cash = v_expected,
        variance = v_variance, notes = NULLIF(TRIM(p_notes), ''), updated_at = NOW()
    WHERE id = p_shift_id;

    RETURN jsonb_build_object(
        'success', TRUE, 'id', p_shift_id, 'replayed', FALSE,
        'expected_cash', v_expected, 'variance', v_variance
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_shift_report(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_report JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.shifts s JOIN public.pharmacies ph ON ph.id = s.pharmacy_id
        WHERE s.id = p_shift_id AND ph.user_id = auth.uid()
    ) THEN RAISE EXCEPTION 'Shift not found'; END IF;

    SELECT jsonb_build_object(
        'shift', to_jsonb(s),
        'cashier', COALESCE(u.full_name, 'Cashier'),
        'transaction_count', COALESCE(sa.transaction_count, 0),
        'item_count', COALESCE(items.item_count, 0),
        'total_sales', COALESCE(sa.total_sales, 0),
        'cash_sales', COALESCE(sa.cash_sales, 0),
        'bank_transfer_sales', COALESCE(sa.bank_transfer_sales, 0),
        'terminal_sales', COALESCE(sa.terminal_sales, 0),
        'other_sales', COALESCE(sa.other_sales, 0)
    ) INTO v_report
    FROM public.shifts s
    LEFT JOIN public.users u ON u.id = s.cashier_id
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*) AS transaction_count,
            COALESCE(SUM(sale.total), 0) AS total_sales,
            COALESCE(SUM(sale.total) FILTER (WHERE sale.payment_method = 'cash'), 0) AS cash_sales,
            COALESCE(SUM(sale.total) FILTER (WHERE sale.payment_method = 'bank_transfer'), 0) AS bank_transfer_sales,
            COALESCE(SUM(sale.total) FILTER (WHERE sale.payment_method = 'pharmacy_pos_terminal'), 0) AS terminal_sales,
            COALESCE(SUM(sale.total) FILTER (WHERE sale.payment_method = 'other'), 0) AS other_sales
        FROM public.sales sale
        WHERE sale.shift_id = s.id AND sale.status = 'completed'
    ) sa ON TRUE
    LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(si.quantity), 0) AS item_count
        FROM public.sale_items si
        JOIN public.sales sale ON sale.id = si.sale_id
        WHERE sale.shift_id = s.id AND sale.status = 'completed'
    ) items ON TRUE
    WHERE s.id = p_shift_id
    GROUP BY s.id, u.full_name, sa.transaction_count, sa.total_sales, sa.cash_sales,
        sa.bank_transfer_sales, sa.terminal_sales, sa.other_sales, items.item_count;
    RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_shift_open(UUID, UUID, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_shift_open(UUID, UUID, NUMERIC, TIMESTAMPTZ) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_pos_sale_with_shift(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_pos_sale_with_shift(UUID, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_shift_close(UUID, UUID, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_shift_close(UUID, UUID, NUMERIC, TEXT, TIMESTAMPTZ) TO authenticated;
REVOKE ALL ON FUNCTION public.get_shift_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shift_report(UUID) TO authenticated;

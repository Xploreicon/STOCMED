-- Isolated live fix: shifts.cashier_id is an Auth UUID and public.users.id is
-- the legacy bigint. Join through canonical public.users.user_id.
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
    LEFT JOIN public.users u ON u.user_id = s.cashier_id
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

REVOKE ALL ON FUNCTION public.get_shift_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shift_report(UUID) TO authenticated;

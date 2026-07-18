-- Final server-side integrity guards found during the Model A pilot review.

CREATE OR REPLACE FUNCTION public.create_guarded_stock_adjustment(
  p_pharmacy_id UUID,
  p_inventory_id UUID,
  p_batch_id UUID,
  p_type public.stock_movement_type,
  p_quantity INTEGER,
  p_reason TEXT
)
RETURNS public.stock_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock INTEGER;
  v_reserved INTEGER;
  v_batch_stock INTEGER;
  v_batch_reserved INTEGER;
  v_result public.stock_movements;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;

  IF p_type::TEXT NOT IN ('restock', 'adjustment', 'return', 'write_off', 'expiry_writeoff') THEN
    RAISE EXCEPTION 'This stock movement type cannot be created as an adjustment';
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity must be non-zero';
  END IF;
  IF p_type::TEXT IN ('restock', 'return') AND p_quantity <= 0 THEN
    RAISE EXCEPTION 'Restock and return quantities must be positive';
  END IF;
  IF p_type::TEXT IN ('write_off', 'expiry_writeoff') AND p_quantity >= 0 THEN
    RAISE EXCEPTION 'Write-off and expiry quantities must be negative';
  END IF;
  IF NULLIF(TRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for every stock change';
  END IF;

  SELECT quantity_in_stock INTO v_stock FROM public.pharmacy_inventory
  WHERE id = p_inventory_id AND pharmacy_id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF p_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.batches WHERE id = p_batch_id AND inventory_id = p_inventory_id
  ) THEN RAISE EXCEPTION 'Batch does not belong to this medication'; END IF;

  IF p_quantity < 0 THEN
    SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_reserved FROM public.reservations
    WHERE inventory_id = p_inventory_id AND status = 'active' AND expires_at > NOW();
    IF v_stock + p_quantity < v_reserved THEN
      RAISE EXCEPTION 'This adjustment would consume stock held for pickup';
    END IF;
    IF p_batch_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_batch_stock
      FROM public.stock_movements WHERE batch_id = p_batch_id;
      SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_batch_reserved
      FROM public.reservations WHERE batch_id = p_batch_id AND status = 'active' AND expires_at > NOW();
      IF v_batch_stock + p_quantity < v_batch_reserved THEN
        RAISE EXCEPTION 'This adjustment would consume a batch held for pickup';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.stock_movements (
    inventory_id, batch_id, type, quantity, reason, reference, created_by
  ) VALUES (
    p_inventory_id, p_batch_id, p_type, p_quantity, TRIM(p_reason), 'ADJUST_STOCK', auth.uid()
  ) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

-- A completed-sale replay is intentionally idempotent, but it must still prove
-- that the caller owns the pharmacy before returning the prior result.
CREATE OR REPLACE FUNCTION public.sync_pos_sale_with_shift(
  p_pharmacy_id UUID, p_sale JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_shift_id UUID := NULLIF(p_sale->>'shift_id', '')::UUID;
  v_reservation_id UUID := NULLIF(p_sale->>'reservation_id', '')::UUID;
  v_sale_id UUID := (p_sale->>'id')::UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = v_sale_id AND s.pharmacy_id = p_pharmacy_id AND s.status = 'completed'
      AND (v_reservation_id IS NULL OR EXISTS (
        SELECT 1 FROM public.reservations r
        WHERE r.id = v_reservation_id AND r.status = 'collected' AND r.sale_id = s.id
      ))
  ) THEN
    RETURN jsonb_build_object('success', TRUE, 'id', v_sale_id, 'replayed', TRUE, 'shift_id', v_shift_id);
  END IF;
  IF v_shift_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.shifts s WHERE s.id = v_shift_id AND s.pharmacy_id = p_pharmacy_id
      AND s.cashier_id = auth.uid() AND s.status = 'open'
  ) THEN RAISE EXCEPTION 'An open cashier shift is required'; END IF;
  PERFORM public.assert_reservation_sellable_stock(p_pharmacy_id, p_sale);
  v_result := public.sync_pos_sale(p_pharmacy_id, p_sale);
  UPDATE public.sales SET shift_id = v_shift_id, updated_at = NOW()
  WHERE id = v_sale_id AND pharmacy_id = p_pharmacy_id
    AND (shift_id IS NULL OR shift_id = v_shift_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale could not be attached to shift'; END IF;
  IF v_reservation_id IS NOT NULL THEN
    UPDATE public.reservations r SET status = 'collected', collected_at = NOW(), sale_id = v_sale_id
    WHERE r.id = v_reservation_id AND r.pharmacy_id = p_pharmacy_id AND r.status = 'active'
      AND r.expires_at > NOW() AND r.sale_id IS NULL;
    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM public.reservations WHERE id = v_reservation_id AND sale_id = v_sale_id AND status = 'collected'
    ) THEN RAISE EXCEPTION 'Reservation cannot be collected'; END IF;
  END IF;
  RETURN v_result || jsonb_build_object('shift_id', v_shift_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_guarded_stock_adjustment(UUID, UUID, UUID, public.stock_movement_type, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_pos_sale_with_shift(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_guarded_stock_adjustment(UUID, UUID, UUID, public.stock_movement_type, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_pos_sale_with_shift(UUID, JSONB) TO authenticated;

-- Administrators may oversee symptom-intake records, but only an identity whose
-- pharmacist licence has been verified may claim or answer clinical intake.
DROP POLICY IF EXISTS "Allow admins/pharmacists to update symptom intakes" ON public.symptom_intakes;
CREATE POLICY "Only licensed pharmacists can update symptom intakes"
ON public.symptom_intakes
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid() AND u.is_licensed_pharmacist = TRUE
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid() AND u.is_licensed_pharmacist = TRUE
  )
);

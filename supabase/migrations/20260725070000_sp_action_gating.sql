-- Complete SP gating with an auditable token check used by every sensitive
-- application mutation. Authorization attempts and actual action checks are
-- separate audit events so grace-window reuse remains visible.

CREATE OR REPLACE FUNCTION public.verify_and_audit_sp_action(
  p_pharmacy_id UUID,
  p_token TEXT,
  p_action TEXT,
  p_target_description TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_authorized BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  ) THEN
    RETURN FALSE;
  END IF;

  v_authorized := COALESCE(public.validate_sp_authorization(
    p_pharmacy_id, p_token, p_action
  ), FALSE);

  INSERT INTO public.sp_authorization_audit(
    pharmacy_id, actor_user_id, action, target_description,
    succeeded, failure_reason
  ) VALUES (
    p_pharmacy_id, auth.uid(), p_action, NULLIF(TRIM(p_target_description), ''),
    v_authorized,
    CASE WHEN v_authorized THEN NULL ELSE 'Missing, invalid, or expired authorization grant' END
  );

  RETURN v_authorized;
END;
$$;

-- The legacy function accepted any sale UUID and a caller-supplied cashier.
-- Remove client access and replace it with an owned, completed-sale reversal.
REVOKE ALL ON FUNCTION public.void_sale(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reverse_completed_sale(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_kind TEXT,
  p_reason TEXT,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_item RECORD;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;
  IF p_kind NOT IN ('void', 'refund') THEN
    RAISE EXCEPTION 'Reversal kind must be void or refund';
  END IF;
  IF length(TRIM(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'A reversal reason is required';
  END IF;
  IF NOT public.verify_and_audit_sp_action(
    p_pharmacy_id,
    p_sp_token,
    'void_or_refund',
    p_kind || ' sale ' || p_sale_id::TEXT || ': ' || TRIM(p_reason)
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;

  v_status := CASE WHEN p_kind = 'refund' THEN 'refunded' ELSE 'voided' END;
  IF v_sale.status = v_status THEN
    RETURN jsonb_build_object('success', TRUE, 'id', p_sale_id, 'status', v_status, 'replayed', TRUE);
  END IF;
  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed sale can be reversed';
  END IF;

  FOR v_item IN
    SELECT inventory_id, batch_id, SUM(quantity)::INTEGER AS quantity
    FROM public.sale_items
    WHERE sale_id = p_sale_id
    GROUP BY inventory_id, batch_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.stock_movements movement
      WHERE movement.reference = p_kind || '_' || p_sale_id::TEXT
        AND movement.inventory_id = v_item.inventory_id
        AND movement.batch_id IS NOT DISTINCT FROM v_item.batch_id
    ) THEN
      INSERT INTO public.stock_movements(
        inventory_id, batch_id, type, quantity, reason, reference, created_by
      ) VALUES (
        v_item.inventory_id, v_item.batch_id, 'return', v_item.quantity,
        INITCAP(p_kind) || ' of sale #' || p_sale_id || ': ' || TRIM(p_reason),
        p_kind || '_' || p_sale_id::TEXT, auth.uid()
      );
    END IF;
  END LOOP;

  UPDATE public.sales
  SET status = v_status, updated_at = NOW()
  WHERE id = p_sale_id AND pharmacy_id = p_pharmacy_id;

  RETURN jsonb_build_object('success', TRUE, 'id', p_sale_id, 'status', v_status, 'replayed', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_and_audit_sp_action(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_completed_sale(UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_and_audit_sp_action(UUID, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_completed_sale(UUID, UUID, TEXT, TEXT, TEXT)
  TO authenticated;

-- Reservation / hold-for-pickup foundation. This migration is additive: it never
-- writes stock movements for a hold. Stock changes only when the normal sale completes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_status') THEN
    CREATE TYPE public.reservation_status AS ENUM ('active', 'collected', 'expired', 'cancelled');
  END IF;
END $$;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS reservation_hold_minutes INTEGER NOT NULL DEFAULT 240
    CHECK (reservation_hold_minutes BETWEEN 30 AND 1440),
  ADD COLUMN IF NOT EXISTS reservations_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,
  patient_phone TEXT,
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  inventory_id UUID NOT NULL REFERENCES public.pharmacy_inventory(id) ON DELETE RESTRICT,
  batch_id UUID REFERENCES public.batches(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status public.reservation_status NOT NULL DEFAULT 'active',
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  collected_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  sale_id UUID REFERENCES public.sales(id) ON DELETE RESTRICT,
  pickup_code TEXT NOT NULL UNIQUE CHECK (pickup_code ~ '^[0-9]{6}$'),
  seen_at TIMESTAMPTZ,
  CONSTRAINT reservation_owner_required CHECK (patient_id IS NOT NULL OR session_id IS NOT NULL),
  CONSTRAINT reservation_collection_consistency CHECK (
    (status <> 'collected') OR (collected_at IS NOT NULL AND sale_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS reservations_active_inventory_idx
  ON public.reservations (inventory_id, expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS reservations_pharmacy_active_idx
  ON public.reservations (pharmacy_id, expires_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS reservations_patient_active_idx
  ON public.reservations (patient_id, expires_at DESC) WHERE status = 'active';

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reservation_patient_select ON public.reservations;
CREATE POLICY reservation_patient_select ON public.reservations
FOR SELECT TO authenticated
USING (patient_id = auth.uid());

DROP POLICY IF EXISTS reservation_pharmacy_select ON public.reservations;
CREATE POLICY reservation_pharmacy_select ON public.reservations
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.pharmacies ph WHERE ph.id = reservations.pharmacy_id AND ph.user_id = auth.uid()
));

-- Treat lapsed holds as non-active on every read/write path. A scheduled call to
-- expire_reservations is still required for accurate queue history and notifications.
CREATE OR REPLACE FUNCTION public.expire_reservations()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.reservations
  SET status = 'expired'
  WHERE status = 'active' AND expires_at <= NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_sellable_quantities(p_inventory_ids UUID[])
RETURNS TABLE (inventory_id UUID, reserved_quantity INTEGER, sellable_quantity INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pi.id,
    CASE WHEN ph.reservations_enabled
      THEN COALESCE(SUM(r.quantity) FILTER (WHERE r.status = 'active' AND r.expires_at > NOW()), 0)::INTEGER
      ELSE 0
    END,
    CASE WHEN ph.reservations_enabled
      THEN GREATEST(pi.quantity_in_stock - COALESCE(SUM(r.quantity) FILTER (WHERE r.status = 'active' AND r.expires_at > NOW()), 0), 0)::INTEGER
      ELSE pi.quantity_in_stock
    END
  FROM public.pharmacy_inventory pi
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  LEFT JOIN public.reservations r ON r.inventory_id = pi.id
  WHERE pi.id = ANY(p_inventory_ids)
  GROUP BY pi.id, pi.quantity_in_stock, ph.reservations_enabled;
$$;

CREATE OR REPLACE FUNCTION public.reservation_batch_quantities(p_inventory_ids UUID[])
RETURNS TABLE (batch_id UUID, reserved_quantity INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.batch_id, SUM(r.quantity)::INTEGER
  FROM public.reservations r
  JOIN public.pharmacies ph ON ph.id = r.pharmacy_id
  WHERE r.inventory_id = ANY(p_inventory_ids)
    AND ph.reservations_enabled = TRUE
    AND r.status = 'active' AND r.expires_at > NOW() AND r.batch_id IS NOT NULL
  GROUP BY r.batch_id;
$$;

CREATE OR REPLACE FUNCTION public.assert_reservation_sellable_stock(p_pharmacy_id UUID, p_sale JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group RECORD; v_stock INTEGER; v_reserved INTEGER; v_reservation_id UUID := NULLIF(p_sale->>'reservation_id', '')::UUID;
BEGIN
  PERFORM public.expire_reservations();
  IF v_reservation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.id = v_reservation_id AND r.pharmacy_id = p_pharmacy_id AND r.status = 'active' AND r.expires_at > NOW()
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_sale->'items') item
        WHERE (item->>'inventory_id')::UUID = r.inventory_id AND (item->>'batch_id')::UUID = r.batch_id
          AND (item->>'quantity')::INTEGER = r.quantity)
  ) THEN RAISE EXCEPTION 'Pickup does not match an active reservation'; END IF;
  FOR v_group IN SELECT (item->>'inventory_id')::UUID AS inventory_id, SUM((item->>'quantity')::INTEGER)::INTEGER AS requested
    FROM jsonb_array_elements(p_sale->'items') item GROUP BY (item->>'inventory_id')::UUID
  LOOP
    SELECT quantity_in_stock INTO v_stock FROM public.pharmacy_inventory
    WHERE id = v_group.inventory_id AND pharmacy_id = p_pharmacy_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item is not owned by this pharmacy'; END IF;
    SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_reserved FROM public.reservations
    WHERE inventory_id = v_group.inventory_id AND status = 'active' AND expires_at > NOW()
      AND (v_reservation_id IS NULL OR id <> v_reservation_id);
    IF v_stock - v_reserved < v_group.requested THEN
      RAISE EXCEPTION 'Insufficient sellable stock: % held for pickup', v_reserved;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_reservation(
  p_inventory_id UUID,
  p_quantity INTEGER,
  p_session_id TEXT DEFAULT NULL,
  p_patient_phone TEXT DEFAULT NULL
)
RETURNS public.reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inventory public.pharmacy_inventory;
  v_product_requires_rx BOOLEAN;
  v_reserved INTEGER;
  v_batch_id UUID;
  v_batch_available INTEGER;
  v_hold_minutes INTEGER;
  v_code TEXT;
  v_result public.reservations;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Reservation quantity must be between 1 and 10';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before creating a reservation';
  END IF;
  IF (SELECT COUNT(*) FROM public.reservations
    WHERE patient_id = auth.uid() AND status = 'active' AND expires_at > NOW()) >= 3 THEN
    RAISE EXCEPTION 'You already have the maximum of three active holds';
  END IF;

  PERFORM public.expire_reservations();
  SELECT pi.* INTO v_inventory FROM public.pharmacy_inventory pi
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  WHERE pi.id = p_inventory_id AND pi.is_listed = TRUE AND pi.deleted_at IS NULL
    AND ph.reservations_enabled = TRUE AND ph.is_active = TRUE AND ph.is_verified = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medication is not available for reservation'; END IF;

  SELECT requires_prescription INTO v_product_requires_rx FROM public.products WHERE id = v_inventory.product_id;
  IF v_product_requires_rx THEN RAISE EXCEPTION 'A verified prescription is required before this medication can be reserved'; END IF;

  SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_reserved
  FROM public.reservations WHERE inventory_id = p_inventory_id AND status = 'active' AND expires_at > NOW();
  IF v_inventory.quantity_in_stock - v_reserved < p_quantity THEN
    RAISE EXCEPTION 'Only % unit(s) are currently available to hold', GREATEST(v_inventory.quantity_in_stock - v_reserved, 0);
  END IF;

  SELECT b.id,
    (COALESCE(SUM(sm.quantity), 0) - COALESCE((
      SELECT SUM(r.quantity) FROM public.reservations r
      WHERE r.batch_id = b.id AND r.status = 'active' AND r.expires_at > NOW()
    ), 0))::INTEGER INTO v_batch_id, v_batch_available
  FROM public.batches b LEFT JOIN public.stock_movements sm ON sm.batch_id = b.id
  WHERE b.inventory_id = p_inventory_id AND b.expiry_date > CURRENT_DATE
  GROUP BY b.id, b.expiry_date
  HAVING COALESCE(SUM(sm.quantity), 0) - COALESCE((
    SELECT SUM(r.quantity) FROM public.reservations r
    WHERE r.batch_id = b.id AND r.status = 'active' AND r.expires_at > NOW()
  ), 0) >= p_quantity
  ORDER BY b.expiry_date ASC, b.id ASC LIMIT 1;
  IF v_batch_id IS NULL THEN RAISE EXCEPTION 'No unexpired batch can fulfil this hold'; END IF;

  SELECT reservation_hold_minutes INTO v_hold_minutes FROM public.pharmacies WHERE id = v_inventory.pharmacy_id;
  LOOP
    v_code := LPAD((floor(random() * 1000000))::TEXT, 6, '0');
    BEGIN
      INSERT INTO public.reservations (patient_id, session_id, patient_phone, pharmacy_id, inventory_id, batch_id, quantity, expires_at, pickup_code)
      VALUES (auth.uid(), NULL, NULLIF(p_patient_phone, ''), v_inventory.pharmacy_id, p_inventory_id, v_batch_id, p_quantity, NOW() + make_interval(mins => v_hold_minutes), v_code)
      RETURNING * INTO v_result;
      RETURN v_result;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (SELECT 1 FROM public.reservations WHERE pickup_code = v_code) THEN CONTINUE; ELSE RAISE; END IF;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_reservation(p_reservation_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS public.reservations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result public.reservations;
BEGIN
  PERFORM public.expire_reservations();
  UPDATE public.reservations r SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = NULLIF(p_reason, '')
  WHERE r.id = p_reservation_id AND r.status = 'active' AND r.expires_at > NOW()
    AND (r.patient_id = auth.uid() OR EXISTS (SELECT 1 FROM public.pharmacies ph WHERE ph.id = r.pharmacy_id AND ph.user_id = auth.uid()))
  RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active reservation not found'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pharmacy_reservations(p_pharmacy_id UUID)
RETURNS TABLE (
 id UUID, pickup_code TEXT, quantity INTEGER, status public.reservation_status, reserved_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
 patient_name TEXT, patient_phone TEXT, inventory_id UUID, product_name TEXT, strength TEXT, batch_id UUID, batch_number TEXT, seen_at TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.pickup_code, r.quantity, r.status, r.reserved_at, r.expires_at,
    u.full_name, COALESCE(r.patient_phone, u.phone), r.inventory_id,
    COALESCE(p.brand_name, p.generic_name), p.strength, r.batch_id, b.batch_number, r.seen_at
  FROM public.reservations r
  JOIN public.pharmacy_inventory pi ON pi.id = r.inventory_id
  JOIN public.products p ON p.id = pi.product_id
  LEFT JOIN public.users u ON u.user_id = r.patient_id
  LEFT JOIN public.batches b ON b.id = r.batch_id
  WHERE r.pharmacy_id = p_pharmacy_id AND EXISTS (SELECT 1 FROM public.pharmacies ph WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid())
  ORDER BY (r.status = 'active' AND r.expires_at > NOW()) DESC, r.reserved_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.sync_pos_sale_with_shift(
  p_pharmacy_id UUID, p_sale JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
  v_shift_id UUID := NULLIF(p_sale->>'shift_id', '')::UUID;
  v_reservation_id UUID := NULLIF(p_sale->>'reservation_id', '')::UUID;
BEGIN
  IF v_shift_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.shifts s WHERE s.id = v_shift_id AND s.pharmacy_id = p_pharmacy_id
      AND s.cashier_id = auth.uid() AND s.status = 'open'
  ) THEN RAISE EXCEPTION 'An open cashier shift is required'; END IF;
  PERFORM public.assert_reservation_sellable_stock(p_pharmacy_id, p_sale);
  v_result := public.sync_pos_sale(p_pharmacy_id, p_sale);
  UPDATE public.sales SET shift_id = v_shift_id, updated_at = NOW()
  WHERE id = (p_sale->>'id')::UUID AND pharmacy_id = p_pharmacy_id
    AND (shift_id IS NULL OR shift_id = v_shift_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale could not be attached to shift'; END IF;
  IF v_reservation_id IS NOT NULL THEN
    UPDATE public.reservations r SET status = 'collected', collected_at = NOW(), sale_id = (p_sale->>'id')::UUID
    WHERE r.id = v_reservation_id AND r.pharmacy_id = p_pharmacy_id AND r.status = 'active'
      AND r.expires_at > NOW() AND r.sale_id IS NULL;
    IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.reservations WHERE id = v_reservation_id AND sale_id = (p_sale->>'id')::UUID AND status = 'collected') THEN
      RAISE EXCEPTION 'Reservation cannot be collected';
    END IF;
  END IF;
  RETURN v_result || jsonb_build_object('shift_id', v_shift_id);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_reservations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reservation_sellable_quantities(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reservation_batch_quantities(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_reservation_sellable_stock(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_reservation(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pharmacy_reservations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservation_sellable_quantities(UUID[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_batch_quantities(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation(UUID, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pharmacy_reservations(UUID) TO authenticated;

-- Configure a scheduled call in Supabase after applying this migration:
-- SELECT cron.schedule('expire-reservations-every-five-minutes', '*/5 * * * *', $$SELECT public.expire_reservations()$$);

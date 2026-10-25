BEGIN;

ALTER TABLE public.pharmacy_inventory
  ADD COLUMN recovery_expires_at TIMESTAMPTZ,
  ADD COLUMN deletion_reason TEXT,
  ADD COLUMN deleted_by UUID;

-- Existing delisted stock receives a full recovery window when this launches.
-- Ledger rows remain tombstoned after the window; they are never cascade-deleted.
UPDATE public.pharmacy_inventory
SET recovery_expires_at = NOW() + INTERVAL '60 days'
WHERE deleted_at IS NOT NULL;

CREATE INDEX pharmacy_inventory_recovery_idx
  ON public.pharmacy_inventory(pharmacy_id, recovery_expires_at)
  WHERE deleted_at IS NOT NULL;

CREATE TABLE public.inventory_removal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id),
  inventory_id UUID NOT NULL REFERENCES public.pharmacy_inventory(id),
  action TEXT NOT NULL CHECK (action IN ('remove', 'restore')),
  reason TEXT,
  actor_id UUID NOT NULL,
  recovery_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX inventory_removal_events_pharmacy_idx
  ON public.inventory_removal_events(pharmacy_id, created_at DESC);
ALTER TABLE public.inventory_removal_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_removal_events_owner_read ON public.inventory_removal_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.pharmacies p
      WHERE p.id = pharmacy_id AND p.user_id = (SELECT auth.uid()))
  );
REVOKE ALL ON public.inventory_removal_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_removal_events TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_change_pharmacy_inventory(
  p_pharmacy_id UUID,
  p_inventory_ids UUID[],
  p_action TEXT,
  p_reason TEXT DEFAULT NULL,
  p_sp_token TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total INTEGER;
  v_owned INTEGER;
  v_changed INTEGER;
  v_action TEXT;
  v_ids UUID[];
  v_deadline TIMESTAMPTZ := NOW() + INTERVAL '60 days';
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies WHERE id = p_pharmacy_id AND user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('success',FALSE,'code','NOT_FOUND','error','Inventory not found');
  END IF;
  v_total := cardinality(p_inventory_ids);
  IF v_total IS NULL OR v_total < 1 OR v_total > 500
     OR EXISTS(SELECT 1 FROM unnest(p_inventory_ids) id WHERE id IS NULL)
     OR (SELECT count(DISTINCT id) FROM unnest(p_inventory_ids) id) <> v_total
     OR p_action IS NULL OR p_action NOT IN ('remove','restore')
     OR length(COALESCE(p_reason,'')) > 300
     OR (p_action = 'remove' AND NULLIF(trim(p_reason),'') IS NULL) THEN
    RETURN jsonb_build_object('success',FALSE,'code','INVALID_SELECTION','error','Select 1–500 unique items and a removal reason');
  END IF;
  -- Serialize this pharmacy's bulk actions, then lock selected rows in ID order.
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-recovery:' || p_pharmacy_id::TEXT,0));
  PERFORM 1 FROM public.pharmacy_inventory
    WHERE pharmacy_id=p_pharmacy_id AND id=ANY(p_inventory_ids) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_owned FROM public.pharmacy_inventory
    WHERE pharmacy_id=p_pharmacy_id AND id=ANY(p_inventory_ids);
  IF v_owned <> v_total THEN
    RETURN jsonb_build_object('success',FALSE,'code','NOT_FOUND','error','One or more selected items are no longer available');
  END IF;
  IF p_action='restore' AND EXISTS (
    SELECT 1 FROM public.pharmacy_inventory WHERE id=ANY(p_inventory_ids)
      AND deleted_at IS NOT NULL AND (recovery_expires_at IS NULL OR recovery_expires_at <= NOW())
  ) THEN
    RETURN jsonb_build_object('success',FALSE,'code','RECOVERY_EXPIRED','error','One or more items are outside the 60-day recovery window. Refresh your selection.');
  END IF;
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM public.pharmacy_inventory
    WHERE id=ANY(p_inventory_ids) AND
      ((p_action='remove' AND deleted_at IS NULL) OR (p_action='restore' AND deleted_at IS NOT NULL));
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('success',TRUE,'changed',0,'already_in_state',v_total,'action',p_action);
  END IF;
  -- An active patient hold must be resolved before removing its inventory item.
  IF p_action='remove' AND EXISTS (
    SELECT 1 FROM public.reservations WHERE inventory_id=ANY(v_ids) AND status='active' AND expires_at>NOW()
  ) THEN
    RETURN jsonb_build_object('success',FALSE,'code','ACTIVE_RESERVATION','error','A selected item has an active reservation. Resolve the reservation or deselect that item.');
  END IF;
  IF p_action='restore' AND EXISTS (
    SELECT 1 FROM public.pharmacy_inventory selected
    JOIN public.pharmacy_inventory other ON other.pharmacy_id=p_pharmacy_id AND other.id<>selected.id
      AND (other.deleted_at IS NULL OR other.id=ANY(v_ids))
    WHERE selected.id=ANY(v_ids) AND (
      (selected.product_id IS NOT NULL AND selected.product_id=other.product_id)
      OR (selected.barcode IS NOT NULL AND selected.barcode=other.barcode)
    )
  ) THEN
    RETURN jsonb_build_object('success',FALSE,'code','ACTIVE_DUPLICATE','error','An active or selected item already uses the same catalogue product or barcode. Restore one copy only.');
  END IF;
  v_action := CASE p_action WHEN 'remove' THEN 'delist_inventory' ELSE 'restore_inventory' END;
  IF NOT public.verify_gated_sp_action(p_pharmacy_id,p_sp_token,v_action,
    initcap(p_action) || ' ' || cardinality(v_ids)::TEXT || ' inventory items') THEN
    RETURN jsonb_build_object('success',FALSE,'code','SP_AUTH_REQUIRED','error','Superintendent authorization is required or has expired.');
  END IF;
  INSERT INTO public.inventory_removal_events(pharmacy_id,inventory_id,action,reason,actor_id,recovery_expires_at)
    SELECT p_pharmacy_id,id,p_action,NULLIF(trim(p_reason),''),auth.uid(),
      CASE WHEN p_action='remove' THEN v_deadline ELSE recovery_expires_at END
    FROM public.pharmacy_inventory WHERE id=ANY(v_ids);
  UPDATE public.pharmacy_inventory
    SET deleted_at=CASE WHEN p_action='remove' THEN NOW() ELSE NULL END,
      recovery_expires_at=CASE WHEN p_action='remove' THEN v_deadline ELSE NULL END,
      deletion_reason=CASE WHEN p_action='remove' THEN trim(p_reason) ELSE NULL END,
      deleted_by=CASE WHEN p_action='remove' THEN auth.uid() ELSE NULL END,
      is_listed=(p_action='restore'), updated_at=NOW()
    WHERE id=ANY(v_ids);
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN jsonb_build_object('success',TRUE,'changed',v_changed,'already_in_state',v_total-v_changed,
    'action',p_action,'recovery_expires_at',CASE WHEN p_action='remove' THEN v_deadline ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION public.bulk_change_pharmacy_inventory(UUID,UUID[],TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_change_pharmacy_inventory(UUID,UUID[],TEXT,TEXT,TEXT) TO authenticated;

-- Older clients use the same recovery and authorization rules as bulk actions.
CREATE OR REPLACE FUNCTION public.delist_pharmacy_inventory_item(p_inventory_id UUID,p_sp_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_pharmacy_id UUID; v_result JSONB;
BEGIN
  SELECT i.pharmacy_id INTO v_pharmacy_id FROM public.pharmacy_inventory i JOIN public.pharmacies p ON p.id=i.pharmacy_id
    WHERE i.id=p_inventory_id AND p.user_id=auth.uid();
  v_result := public.bulk_change_pharmacy_inventory(v_pharmacy_id,ARRAY[p_inventory_id],'remove','Removed individually',p_sp_token);
  RETURN v_result || jsonb_build_object('id',p_inventory_id,'replayed',COALESCE((v_result->>'changed')::INTEGER=0,FALSE));
END; $$;
CREATE OR REPLACE FUNCTION public.restore_pharmacy_inventory_item(p_inventory_id UUID,p_sp_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_pharmacy_id UUID; v_result JSONB;
BEGIN
  SELECT i.pharmacy_id INTO v_pharmacy_id FROM public.pharmacy_inventory i JOIN public.pharmacies p ON p.id=i.pharmacy_id
    WHERE i.id=p_inventory_id AND p.user_id=auth.uid();
  v_result := public.bulk_change_pharmacy_inventory(v_pharmacy_id,ARRAY[p_inventory_id],'restore',NULL,p_sp_token);
  RETURN v_result || jsonb_build_object('id',p_inventory_id,'replayed',COALESCE((v_result->>'changed')::INTEGER=0,FALSE));
END; $$;
REVOKE ALL ON FUNCTION public.delist_pharmacy_inventory_item(UUID,TEXT), public.restore_pharmacy_inventory_item(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delist_pharmacy_inventory_item(UUID,TEXT), public.restore_pharmacy_inventory_item(UUID,TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

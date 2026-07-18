-- Pilot reservations opt-in and destination-pharmacy prescription flow (Model A).
-- Prescription retention deliberately fails closed until an administrator records
-- a DPO/PCN/legal-approved duration in rx_retention_policy.

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS reservations_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reservation_hold_minutes INTEGER NOT NULL DEFAULT 240;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_stocmed_sp BOOLEAN NOT NULL DEFAULT FALSE;

-- Align catalogue flags with the deterministic POM dictionary already used by
-- triage. This keeps sourcing visible while ensuring the digital hold uses Rx.
UPDATE public.products
SET requires_prescription = TRUE, updated_at = NOW()
WHERE LOWER(generic_name) = ANY (ARRAY[
  'amoxicillin', 'ciprofloxacin', 'metronidazole', 'lisinopril', 'amlodipine',
  'metformin', 'sitagliptin', 'glibenclamide', 'insulin', 'warfarin',
  'atorvastatin', 'losartan', 'sildenafil', 'tadalafil', 'albuterol',
  'salbutamol', 'prednisolone', 'dexamethasone'
]) OR LOWER(COALESCE(brand_name, '')) = ANY (ARRAY[
  'augmentin', 'ciprotab', 'flagyl', 'zestril', 'norvasc', 'glucophage',
  'januvia', 'daonil', 'lantus', 'actrapid', 'lipitor', 'cozaar', 'viagra',
  'cialis', 'ventolin'
]);

-- Never infer consent from historical data. If an older foundation already
-- created holds while the pharmacy is OFF, stop for explicit operator cleanup.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reservations r
    JOIN public.pharmacies ph ON ph.id = r.pharmacy_id
    WHERE r.status = 'active' AND r.expires_at > NOW() AND NOT ph.reservations_enabled
  ) THEN
    RAISE EXCEPTION 'Resolve active holds at an ineligible pharmacy before applying reservation opt-in';
  END IF;
END $$;

-- Prevent authenticated users from promoting themselves into a privileged role,
-- reassigning a pharmacy, or self-verifying a pharmacy.
CREATE OR REPLACE FUNCTION public.protect_privileged_identity_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') THEN
    IF TG_TABLE_NAME = 'users' THEN
      IF TG_OP = 'INSERT' AND (
        NEW.user_id IS DISTINCT FROM auth.uid() OR NEW.is_admin OR
        NEW.is_licensed_pharmacist OR NEW.is_stocmed_sp
      ) THEN
        RAISE EXCEPTION 'Privileged identity fields can only be set by the service role';
      ELSIF TG_OP = 'UPDATE' AND (
        NEW.user_id IS DISTINCT FROM OLD.user_id OR
        NEW.role IS DISTINCT FROM OLD.role OR
        NEW.is_admin IS DISTINCT FROM OLD.is_admin OR
        NEW.is_licensed_pharmacist IS DISTINCT FROM OLD.is_licensed_pharmacist OR
        NEW.is_stocmed_sp IS DISTINCT FROM OLD.is_stocmed_sp
      ) THEN
        RAISE EXCEPTION 'Privileged identity fields can only be changed by the service role';
      END IF;
    END IF;

    IF TG_TABLE_NAME = 'pharmacies' THEN
      IF TG_OP = 'INSERT' AND (NEW.user_id IS DISTINCT FROM auth.uid() OR NEW.is_verified) THEN
        RAISE EXCEPTION 'A pharmacy cannot self-assign ownership or verification';
      ELSIF TG_OP = 'UPDATE' AND (
        NEW.user_id IS DISTINCT FROM OLD.user_id OR
        NEW.is_verified IS DISTINCT FROM OLD.is_verified OR
        NEW.license_number IS DISTINCT FROM OLD.license_number
      ) THEN
        RAISE EXCEPTION 'Pharmacy ownership and verification fields can only be changed by the service role';
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'users' AND TG_OP = 'UPDATE' THEN
    IF OLD.is_licensed_pharmacist AND NOT NEW.is_licensed_pharmacist
       AND EXISTS (
         SELECT 1 FROM public.pharmacies ph
         WHERE ph.user_id = OLD.user_id AND ph.reservations_enabled = TRUE
           AND (
             EXISTS (SELECT 1 FROM public.reservations r WHERE r.pharmacy_id = ph.id AND r.status = 'active' AND r.expires_at > NOW())
             OR EXISTS (SELECT 1 FROM public.rx_submissions rx WHERE rx.destination_pharmacy_id = ph.id AND rx.status IN ('submitted', 'under_review'))
           )
       ) THEN
      RAISE EXCEPTION 'Resolve active holds and prescription reviews before revoking the destination SP licence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_privileged_user_fields ON public.users;
CREATE TRIGGER protect_privileged_user_fields
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.protect_privileged_identity_fields();

DROP TRIGGER IF EXISTS protect_privileged_pharmacy_fields ON public.pharmacies;
CREATE TRIGGER protect_privileged_pharmacy_fields
BEFORE INSERT OR UPDATE ON public.pharmacies
FOR EACH ROW EXECUTE FUNCTION public.protect_privileged_identity_fields();

CREATE TABLE IF NOT EXISTS public.rx_retention_policy (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  retention_days INTEGER CHECK (retention_days BETWEEN 1 AND 3650),
  is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  legal_basis TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rx_retention_confirmation_complete CHECK (
    NOT is_confirmed OR (retention_days IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);

INSERT INTO public.rx_retention_policy (singleton, retention_days, is_confirmed)
VALUES (TRUE, NULL, FALSE)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.rx_retention_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rx_retention_admin_select ON public.rx_retention_policy;
CREATE POLICY rx_retention_admin_select ON public.rx_retention_policy
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.user_id = auth.uid() AND (u.is_admin OR (u.is_stocmed_sp AND u.is_licensed_pharmacist))
));

CREATE OR REPLACE FUNCTION public.set_rx_retention_policy(
  p_retention_days INTEGER,
  p_legal_basis TEXT
)
RETURNS public.rx_retention_policy
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result public.rx_retention_policy;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.user_id = auth.uid() AND u.is_admin
  ) THEN
    RAISE EXCEPTION 'Only a StocMed administrator can configure prescription retention';
  END IF;
  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 3650 THEN
    RAISE EXCEPTION 'Retention must be between 1 and 3650 days';
  END IF;
  IF COALESCE(NULLIF(TRIM(p_legal_basis), ''), '') = '' THEN
    RAISE EXCEPTION 'Record the approved legal or regulatory basis';
  END IF;

  INSERT INTO public.rx_retention_policy (
    singleton, retention_days, is_confirmed, confirmed_by, confirmed_at, legal_basis, updated_at
  ) VALUES (
    TRUE, p_retention_days, TRUE, auth.uid(), NOW(), TRIM(p_legal_basis), NOW()
  )
  ON CONFLICT (singleton) DO UPDATE SET
    retention_days = EXCLUDED.retention_days,
    is_confirmed = TRUE,
    confirmed_by = auth.uid(),
    confirmed_at = NOW(),
    legal_basis = EXCLUDED.legal_basis,
    updated_at = NOW()
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

ALTER TABLE public.rx_submissions
  ADD COLUMN IF NOT EXISTS flow_model TEXT NOT NULL DEFAULT 'central_legacy',
  ADD COLUMN IF NOT EXISTS destination_pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS inventory_id UUID REFERENCES public.pharmacy_inventory(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS requested_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destination_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS rx_submissions_reservation_unique_idx
  ON public.rx_submissions (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rx_submissions_destination_pending_idx
  ON public.rx_submissions (destination_pharmacy_id, created_at)
  WHERE flow_model = 'destination_model_a' AND status IN ('submitted', 'under_review');
CREATE INDEX IF NOT EXISTS rx_submissions_purge_idx
  ON public.rx_submissions (purge_after)
  WHERE flow_model = 'destination_model_a' AND purge_after IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rx_submissions_flow_model_check') THEN
    ALTER TABLE public.rx_submissions ADD CONSTRAINT rx_submissions_flow_model_check
      CHECK (flow_model IN ('central_legacy', 'destination_model_a'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rx_submissions_model_a_complete_check') THEN
    ALTER TABLE public.rx_submissions ADD CONSTRAINT rx_submissions_model_a_complete_check
      CHECK (
        flow_model <> 'destination_model_a' OR (
          user_id IS NOT NULL AND destination_pharmacy_id IS NOT NULL AND inventory_id IS NOT NULL AND
          requested_quantity BETWEEN 1 AND 10 AND purge_after IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.rx_audit_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL UNIQUE REFERENCES public.rx_submissions(id) ON DELETE CASCADE,
  destination_pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  inventory_id UUID NOT NULL REFERENCES public.pharmacy_inventory(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity BETWEEN 1 AND 10),
  status TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  purge_after TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.rx_document_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID REFERENCES public.rx_submissions(id) ON DELETE SET NULL,
  audit_record_id UUID REFERENCES public.rx_audit_records(id) ON DELETE SET NULL,
  viewer_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  access_context TEXT NOT NULL CHECK (access_context IN ('destination_review', 'stocmed_oversight')),
  outcome TEXT NOT NULL DEFAULT 'authorized',
  request_id TEXT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rx_document_access_logs_submission_idx
  ON public.rx_document_access_logs (submission_id, accessed_at DESC);

CREATE TABLE IF NOT EXISTS public.rx_purge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_path_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  purged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rx_audit_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rx_document_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rx_purge_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rx_audit_oversight_select ON public.rx_audit_records;
CREATE POLICY rx_audit_oversight_select ON public.rx_audit_records
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.user_id = auth.uid() AND (u.is_admin OR (u.is_stocmed_sp AND u.is_licensed_pharmacist))
));

DROP POLICY IF EXISTS rx_access_log_oversight_select ON public.rx_document_access_logs;
CREATE POLICY rx_access_log_oversight_select ON public.rx_document_access_logs
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.user_id = auth.uid() AND (u.is_admin OR (u.is_stocmed_sp AND u.is_licensed_pharmacist))
));

DROP POLICY IF EXISTS rx_purge_events_admin_select ON public.rx_purge_events;
CREATE POLICY rx_purge_events_admin_select ON public.rx_purge_events
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = auth.uid() AND u.is_admin));

-- Validate Model A metadata and snapshot the confirmed retention period.
CREATE OR REPLACE FUNCTION public.prepare_model_a_rx_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy_id UUID;
  v_product_name TEXT;
  v_requires_rx BOOLEAN;
  v_retention_days INTEGER;
BEGIN
  IF NEW.flow_model <> 'destination_model_a' THEN
    RETURN NEW;
  END IF;

  SELECT pi.pharmacy_id, COALESCE(p.brand_name, p.generic_name), p.requires_prescription
  INTO v_pharmacy_id, v_product_name, v_requires_rx
  FROM public.pharmacy_inventory pi
  JOIN public.products p ON p.id = pi.product_id
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  JOIN public.users sp ON sp.user_id = ph.user_id
  WHERE pi.id = NEW.inventory_id
    AND pi.is_listed = TRUE AND pi.deleted_at IS NULL
    AND ph.is_active = TRUE AND ph.is_verified = TRUE AND ph.reservations_enabled = TRUE
    AND sp.is_licensed_pharmacist = TRUE;

  IF v_pharmacy_id IS NULL OR v_pharmacy_id IS DISTINCT FROM NEW.destination_pharmacy_id THEN
    RAISE EXCEPTION 'The selected pharmacy is not eligible for digital prescription reservations';
  END IF;
  IF NOT COALESCE(v_requires_rx, FALSE) THEN
    RAISE EXCEPTION 'This upload flow is only for prescription-only medicines';
  END IF;
  IF NEW.user_id IS NULL OR NEW.requested_quantity IS NULL OR NEW.requested_quantity < 1 OR NEW.requested_quantity > 10 THEN
    RAISE EXCEPTION 'A signed-in patient and quantity between 1 and 10 are required';
  END IF;

  SELECT retention_days INTO v_retention_days
  FROM public.rx_retention_policy
  WHERE singleton = TRUE AND is_confirmed = TRUE;
  IF v_retention_days IS NULL THEN
    RAISE EXCEPTION 'Prescription retention policy is not yet confirmed';
  END IF;

  NEW.product_name := v_product_name;
  NEW.status := 'submitted';
  NEW.reviewed_by := NULL;
  NEW.reviewed_at := NULL;
  NEW.reservation_id := NULL;
  NEW.purge_after := COALESCE(NEW.purge_after, NOW() + make_interval(days => v_retention_days));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_model_a_rx_submission_trigger ON public.rx_submissions;
CREATE TRIGGER prepare_model_a_rx_submission_trigger
BEFORE INSERT ON public.rx_submissions
FOR EACH ROW EXECUTE FUNCTION public.prepare_model_a_rx_submission();

CREATE OR REPLACE FUNCTION public.sync_rx_audit_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.flow_model <> 'destination_model_a' THEN RETURN NEW; END IF;
  INSERT INTO public.rx_audit_records (
    submission_id, destination_pharmacy_id, inventory_id, product_name,
    requested_quantity, status, submitted_at, reviewed_at, reviewed_by, purge_after, updated_at
  ) VALUES (
    NEW.id, NEW.destination_pharmacy_id, NEW.inventory_id, NEW.product_name,
    NEW.requested_quantity, NEW.status, NEW.created_at, NEW.reviewed_at, NEW.reviewed_by, NEW.purge_after, NOW()
  )
  ON CONFLICT (submission_id) DO UPDATE SET
    status = EXCLUDED.status,
    reviewed_at = EXCLUDED.reviewed_at,
    reviewed_by = EXCLUDED.reviewed_by,
    purge_after = EXCLUDED.purge_after,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_rx_audit_record_trigger ON public.rx_submissions;
CREATE TRIGGER sync_rx_audit_record_trigger
AFTER INSERT OR UPDATE OF status, reviewed_at, reviewed_by, reservation_id ON public.rx_submissions
FOR EACH ROW EXECUTE FUNCTION public.sync_rx_audit_record();

-- Replace broad legacy Rx policies with patient-own and destination-SP-only reads.
DROP POLICY IF EXISTS "Allow users to view own rx submissions" ON public.rx_submissions;
DROP POLICY IF EXISTS "Allow users to insert own rx submissions" ON public.rx_submissions;
DROP POLICY IF EXISTS "Allow admins/pharmacists to update rx submissions" ON public.rx_submissions;
DROP POLICY IF EXISTS rx_patient_select ON public.rx_submissions;
CREATE POLICY rx_patient_select ON public.rx_submissions
FOR SELECT TO authenticated
USING (user_id = auth.uid());
DROP POLICY IF EXISTS rx_destination_sp_select ON public.rx_submissions;
CREATE POLICY rx_destination_sp_select ON public.rx_submissions
FOR SELECT TO authenticated
USING (
  flow_model = 'destination_model_a' AND EXISTS (
    SELECT 1
    FROM public.pharmacies ph
    JOIN public.users sp ON sp.user_id = ph.user_id
    WHERE ph.id = rx_submissions.destination_pharmacy_id
      AND ph.user_id = auth.uid() AND ph.is_verified = TRUE
      AND sp.is_licensed_pharmacist = TRUE
  )
);

REVOKE INSERT, UPDATE, DELETE ON public.rx_submissions FROM anon, authenticated;
GRANT SELECT ON public.rx_submissions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.rx_audit_records FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.rx_document_access_logs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.rx_purge_events FROM anon, authenticated;

-- All staff document access goes through a server endpoint that invokes the
-- logged authorization function below. No staff can mint a URL directly.
DROP POLICY IF EXISTS "Users Read Own Prescriptions" ON storage.objects;
DROP POLICY IF EXISTS "Users Upload Own Prescriptions" ON storage.objects;
DROP POLICY IF EXISTS "Allow owner or staff to view prescriptions" ON storage.objects;
DROP POLICY IF EXISTS "Allow users to upload prescriptions" ON storage.objects;
DROP POLICY IF EXISTS "Allow owner or staff to manage prescriptions" ON storage.objects;

CREATE OR REPLACE FUNCTION public.reservation_inventory_capabilities(p_inventory_ids UUID[])
RETURNS TABLE (inventory_id UUID, reservations_enabled BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pi.id,
    (ph.reservations_enabled AND ph.is_active AND ph.is_verified AND sp.is_licensed_pharmacist)
  FROM public.pharmacy_inventory pi
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  JOIN public.users sp ON sp.user_id = ph.user_id
  WHERE pi.id = ANY(p_inventory_ids);
$$;

CREATE OR REPLACE FUNCTION public.reservation_sellable_quantities(p_inventory_ids UUID[])
RETURNS TABLE (inventory_id UUID, reserved_quantity INTEGER, sellable_quantity INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pi.id,
    CASE WHEN ph.reservations_enabled THEN
      COALESCE(SUM(r.quantity) FILTER (WHERE r.status = 'active' AND r.expires_at > NOW()), 0)::INTEGER
    ELSE 0 END,
    CASE WHEN ph.reservations_enabled THEN
      GREATEST(pi.quantity_in_stock - COALESCE(SUM(r.quantity) FILTER (
        WHERE r.status = 'active' AND r.expires_at > NOW()
      ), 0), 0)::INTEGER
    ELSE GREATEST(pi.quantity_in_stock, 0)::INTEGER END
  FROM public.pharmacy_inventory pi
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  LEFT JOIN public.reservations r ON r.inventory_id = pi.id
  WHERE pi.id = ANY(p_inventory_ids)
  GROUP BY pi.id, pi.quantity_in_stock, ph.reservations_enabled;
$$;

CREATE OR REPLACE FUNCTION public.reservation_batch_quantities(p_inventory_ids UUID[])
RETURNS TABLE (batch_id UUID, reserved_quantity INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.batch_id, SUM(r.quantity)::INTEGER
  FROM public.reservations r
  JOIN public.pharmacy_inventory pi ON pi.id = r.inventory_id
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id AND ph.reservations_enabled = TRUE
  WHERE r.inventory_id = ANY(p_inventory_ids)
    AND r.status = 'active' AND r.expires_at > NOW() AND r.batch_id IS NOT NULL
  GROUP BY r.batch_id;
$$;

CREATE OR REPLACE FUNCTION public.guard_pharmacy_reservation_setting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reservations_enabled AND NOT OLD.reservations_enabled AND (
    NOT NEW.is_active OR NOT NEW.is_verified OR NOT EXISTS (
      SELECT 1 FROM public.users u WHERE u.user_id = NEW.user_id AND u.is_licensed_pharmacist
    )
  ) THEN
    RAISE EXCEPTION 'A verified, active pharmacy with a licensed superintendent pharmacist is required';
  END IF;

  IF OLD.reservations_enabled
     AND (NOT NEW.reservations_enabled OR NOT NEW.is_active OR NOT NEW.is_verified OR NEW.user_id IS DISTINCT FROM OLD.user_id)
     AND (
    EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.pharmacy_id = NEW.id AND r.status = 'active' AND r.expires_at > NOW()
    ) OR EXISTS (
      SELECT 1 FROM public.rx_submissions rx
      WHERE rx.destination_pharmacy_id = NEW.id AND rx.flow_model = 'destination_model_a'
        AND rx.status IN ('submitted', 'under_review')
    )
  ) THEN
    RAISE EXCEPTION 'Resolve active holds and pending prescription reviews before turning reservations off';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_pharmacy_reservation_setting_trigger ON public.pharmacies;
CREATE TRIGGER guard_pharmacy_reservation_setting_trigger
BEFORE UPDATE OF reservations_enabled, is_active, is_verified, user_id ON public.pharmacies
FOR EACH ROW EXECUTE FUNCTION public.guard_pharmacy_reservation_setting();

CREATE OR REPLACE FUNCTION public.set_pharmacy_reservations_enabled(p_enabled BOOLEAN)
RETURNS public.pharmacies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result public.pharmacies;
BEGIN
  UPDATE public.pharmacies ph
  SET reservations_enabled = p_enabled, updated_at = NOW()
  WHERE ph.user_id = auth.uid()
  RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy profile not found'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_reservation(
  p_inventory_id UUID,
  p_quantity INTEGER,
  p_session_id TEXT DEFAULT NULL,
  p_patient_phone TEXT DEFAULT NULL
)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventory public.pharmacy_inventory;
  v_product_requires_rx BOOLEAN;
  v_reserved INTEGER;
  v_batch_id UUID;
  v_hold_minutes INTEGER;
  v_code TEXT;
  v_result public.reservations;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to reserve medication'; END IF;
  IF p_session_id IS NOT NULL OR p_patient_phone IS NOT NULL THEN
    RAISE EXCEPTION 'Guest reservation context is not supported for the pilot';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Reservation quantity must be between 1 and 10';
  END IF;
  IF (SELECT COUNT(*) FROM public.reservations
      WHERE patient_id = auth.uid() AND status = 'active' AND expires_at > NOW()) >= 3 THEN
    RAISE EXCEPTION 'You already have the maximum of three active holds';
  END IF;

  PERFORM public.expire_reservations();
  SELECT pi.* INTO v_inventory
  FROM public.pharmacy_inventory pi
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  JOIN public.users sp ON sp.user_id = ph.user_id
  WHERE pi.id = p_inventory_id AND pi.is_listed = TRUE AND pi.deleted_at IS NULL
    AND ph.is_active = TRUE AND ph.is_verified = TRUE AND ph.reservations_enabled = TRUE
    AND sp.is_licensed_pharmacist = TRUE
  FOR UPDATE OF pi;
  IF NOT FOUND THEN RAISE EXCEPTION 'This pharmacy is not accepting reservations'; END IF;

  SELECT requires_prescription INTO v_product_requires_rx FROM public.products WHERE id = v_inventory.product_id;
  IF v_product_requires_rx THEN
    RAISE EXCEPTION 'Use Reserve with prescription for this medication';
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_reserved
  FROM public.reservations
  WHERE inventory_id = p_inventory_id AND status = 'active' AND expires_at > NOW();
  IF v_inventory.quantity_in_stock - v_reserved < p_quantity THEN
    RAISE EXCEPTION 'Only % unit(s) are currently available to hold', GREATEST(v_inventory.quantity_in_stock - v_reserved, 0);
  END IF;

  SELECT b.id INTO v_batch_id
  FROM public.batches b
  LEFT JOIN public.stock_movements sm ON sm.batch_id = b.id
  WHERE b.inventory_id = p_inventory_id AND b.expiry_date > CURRENT_DATE
  GROUP BY b.id, b.expiry_date
  HAVING COALESCE(SUM(sm.quantity), 0) - COALESCE((
    SELECT SUM(r.quantity) FROM public.reservations r
    WHERE r.batch_id = b.id AND r.status = 'active' AND r.expires_at > NOW()
  ), 0) >= p_quantity
  ORDER BY b.expiry_date ASC, b.id ASC LIMIT 1;
  IF v_batch_id IS NULL THEN RAISE EXCEPTION 'No unexpired batch can fulfil this hold'; END IF;

  SELECT reservation_hold_minutes INTO v_hold_minutes
  FROM public.pharmacies WHERE id = v_inventory.pharmacy_id;
  LOOP
    v_code := LPAD((floor(random() * 1000000))::TEXT, 6, '0');
    BEGIN
      INSERT INTO public.reservations (
        patient_id, pharmacy_id, inventory_id, batch_id, quantity, expires_at, pickup_code
      ) VALUES (
        auth.uid(), v_inventory.pharmacy_id, p_inventory_id, v_batch_id, p_quantity,
        NOW() + make_interval(mins => v_hold_minutes), v_code
      ) RETURNING * INTO v_result;
      RETURN v_result;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (SELECT 1 FROM public.reservations WHERE pickup_code = v_code) THEN CONTINUE; ELSE RAISE; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Unable to generate a unique pickup code';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pharmacy_reservation_summary(p_pharmacy_id UUID)
RETURNS TABLE (
  reservations_enabled BOOLEAN,
  active_count INTEGER,
  unseen_count INTEGER,
  pending_prescriptions INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  PERFORM public.expire_reservations();
  RETURN QUERY
  SELECT ph.reservations_enabled,
    (SELECT COUNT(*)::INTEGER FROM public.reservations r
      WHERE r.pharmacy_id = ph.id AND r.status = 'active' AND r.expires_at > NOW()),
    ((SELECT COUNT(*) FROM public.reservations r
      WHERE r.pharmacy_id = ph.id AND r.status = 'active' AND r.expires_at > NOW() AND r.seen_at IS NULL) +
     (SELECT COUNT(*) FROM public.rx_submissions rx
      WHERE rx.destination_pharmacy_id = ph.id AND rx.flow_model = 'destination_model_a'
        AND rx.status IN ('submitted', 'under_review') AND rx.destination_seen_at IS NULL))::INTEGER,
    (SELECT COUNT(*)::INTEGER FROM public.rx_submissions rx
      WHERE rx.destination_pharmacy_id = ph.id AND rx.flow_model = 'destination_model_a'
        AND rx.status IN ('submitted', 'under_review'))
  FROM public.pharmacies ph WHERE ph.id = p_pharmacy_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_pharmacy_reservation_queue_seen(p_pharmacy_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  UPDATE public.reservations SET seen_at = COALESCE(seen_at, NOW())
  WHERE pharmacy_id = p_pharmacy_id AND status = 'active' AND expires_at > NOW() AND seen_at IS NULL;
  UPDATE public.rx_submissions SET destination_seen_at = COALESCE(destination_seen_at, NOW())
  WHERE destination_pharmacy_id = p_pharmacy_id AND flow_model = 'destination_model_a'
    AND status IN ('submitted', 'under_review') AND destination_seen_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_destination_prescription_queue(p_pharmacy_id UUID)
RETURNS TABLE (
  id UUID, product_name TEXT, requested_quantity INTEGER, status TEXT,
  created_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ, review_notes TEXT,
  patient_name TEXT, patient_phone TEXT, reservation_id UUID,
  pickup_code TEXT, destination_seen_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rx.id, rx.product_name, rx.requested_quantity, rx.status,
    rx.created_at, rx.reviewed_at, rx.review_notes,
    u.full_name, u.phone, rx.reservation_id, r.pickup_code, rx.destination_seen_at
  FROM public.rx_submissions rx
  JOIN public.pharmacies ph ON ph.id = rx.destination_pharmacy_id
  JOIN public.users sp ON sp.user_id = ph.user_id
  LEFT JOIN public.users u ON u.user_id = rx.user_id
  LEFT JOIN public.reservations r ON r.id = rx.reservation_id
  WHERE rx.destination_pharmacy_id = p_pharmacy_id
    AND rx.flow_model = 'destination_model_a'
    AND ph.user_id = auth.uid() AND ph.is_verified = TRUE AND sp.is_licensed_pharmacist = TRUE
  ORDER BY (rx.status IN ('submitted', 'under_review')) DESC, rx.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.review_destination_prescription(
  p_submission_id UUID,
  p_decision TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rx public.rx_submissions;
  v_inventory public.pharmacy_inventory;
  v_reserved INTEGER;
  v_batch_id UUID;
  v_hold_minutes INTEGER;
  v_phone TEXT;
  v_code TEXT;
  v_reservation public.reservations;
BEGIN
  IF p_decision NOT IN ('verified', 'rejected') THEN RAISE EXCEPTION 'Decision must be verified or rejected'; END IF;
  SELECT * INTO v_rx FROM public.rx_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND OR v_rx.flow_model <> 'destination_model_a' THEN RAISE EXCEPTION 'Prescription request not found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    JOIN public.users sp ON sp.user_id = ph.user_id
    WHERE ph.id = v_rx.destination_pharmacy_id AND ph.user_id = auth.uid()
      AND ph.is_active = TRUE AND ph.is_verified = TRUE AND ph.reservations_enabled = TRUE
      AND sp.is_licensed_pharmacist = TRUE
  ) THEN RAISE EXCEPTION 'Only the destination pharmacy licensed SP can review this prescription'; END IF;

  IF v_rx.status = 'verified' AND v_rx.reservation_id IS NOT NULL AND p_decision = 'verified' THEN
    SELECT * INTO v_reservation FROM public.reservations WHERE id = v_rx.reservation_id;
    RETURN jsonb_build_object('submission', to_jsonb(v_rx), 'reservation', to_jsonb(v_reservation), 'replayed', TRUE);
  END IF;
  IF v_rx.status NOT IN ('submitted', 'under_review') THEN RAISE EXCEPTION 'This prescription has already been decided'; END IF;

  IF p_decision = 'rejected' THEN
    UPDATE public.rx_submissions SET
      status = 'rejected', reviewed_by = auth.uid(), reviewed_at = NOW(),
      review_notes = NULLIF(TRIM(p_notes), ''), updated_at = NOW()
    WHERE id = v_rx.id RETURNING * INTO v_rx;
    RETURN jsonb_build_object('submission', to_jsonb(v_rx), 'reservation', NULL, 'replayed', FALSE);
  END IF;

  PERFORM public.expire_reservations();
  IF (SELECT COUNT(*) FROM public.reservations
      WHERE patient_id = v_rx.user_id AND status = 'active' AND expires_at > NOW()) >= 3 THEN
    RAISE EXCEPTION 'The patient already has the maximum of three active holds';
  END IF;

  SELECT pi.* INTO v_inventory FROM public.pharmacy_inventory pi
  WHERE pi.id = v_rx.inventory_id AND pi.pharmacy_id = v_rx.destination_pharmacy_id
    AND pi.is_listed = TRUE AND pi.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medication is no longer available at this pharmacy'; END IF;

  SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_reserved
  FROM public.reservations
  WHERE inventory_id = v_rx.inventory_id AND status = 'active' AND expires_at > NOW();
  IF v_inventory.quantity_in_stock - v_reserved < v_rx.requested_quantity THEN
    RAISE EXCEPTION 'Insufficient stock to approve this prescription reservation';
  END IF;

  SELECT b.id INTO v_batch_id
  FROM public.batches b LEFT JOIN public.stock_movements sm ON sm.batch_id = b.id
  WHERE b.inventory_id = v_rx.inventory_id AND b.expiry_date > CURRENT_DATE
  GROUP BY b.id, b.expiry_date
  HAVING COALESCE(SUM(sm.quantity), 0) - COALESCE((
    SELECT SUM(r.quantity) FROM public.reservations r
    WHERE r.batch_id = b.id AND r.status = 'active' AND r.expires_at > NOW()
  ), 0) >= v_rx.requested_quantity
  ORDER BY b.expiry_date ASC, b.id ASC LIMIT 1;
  IF v_batch_id IS NULL THEN RAISE EXCEPTION 'No unexpired batch can fulfil this hold'; END IF;

  SELECT ph.reservation_hold_minutes, u.phone INTO v_hold_minutes, v_phone
  FROM public.pharmacies ph LEFT JOIN public.users u ON u.user_id = v_rx.user_id
  WHERE ph.id = v_rx.destination_pharmacy_id;

  LOOP
    v_code := LPAD((floor(random() * 1000000))::TEXT, 6, '0');
    BEGIN
      INSERT INTO public.reservations (
        patient_id, patient_phone, pharmacy_id, inventory_id, batch_id,
        quantity, expires_at, pickup_code
      ) VALUES (
        v_rx.user_id, v_phone, v_rx.destination_pharmacy_id, v_rx.inventory_id, v_batch_id,
        v_rx.requested_quantity, NOW() + make_interval(mins => v_hold_minutes), v_code
      ) RETURNING * INTO v_reservation;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (SELECT 1 FROM public.reservations WHERE pickup_code = v_code) THEN CONTINUE; ELSE RAISE; END IF;
    END;
  END LOOP;

  UPDATE public.rx_submissions SET
    status = 'verified', reviewed_by = auth.uid(), reviewed_at = NOW(),
    review_notes = NULLIF(TRIM(p_notes), ''), reservation_id = v_reservation.id, updated_at = NOW()
  WHERE id = v_rx.id RETURNING * INTO v_rx;

  RETURN jsonb_build_object('submission', to_jsonb(v_rx), 'reservation', to_jsonb(v_reservation), 'replayed', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_and_log_rx_document_access(
  p_submission_id UUID,
  p_context TEXT,
  p_request_id TEXT DEFAULT NULL
)
RETURNS TABLE (file_path TEXT, access_log_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_file_path TEXT;
  v_audit_id UUID;
  v_log_id UUID;
BEGIN
  IF p_context = 'destination_review' THEN
    SELECT rx.file_url, audit.id INTO v_file_path, v_audit_id
    FROM public.rx_submissions rx
    LEFT JOIN public.rx_audit_records audit ON audit.submission_id = rx.id
    JOIN public.pharmacies ph ON ph.id = rx.destination_pharmacy_id
    JOIN public.users sp ON sp.user_id = ph.user_id
    WHERE rx.id = p_submission_id AND rx.flow_model = 'destination_model_a'
      AND ph.user_id = auth.uid() AND ph.is_verified = TRUE AND sp.is_licensed_pharmacist = TRUE;
  ELSIF p_context = 'stocmed_oversight' THEN
    SELECT rx.file_url, audit.id INTO v_file_path, v_audit_id
    FROM public.rx_submissions rx
    JOIN public.rx_audit_records audit ON audit.submission_id = rx.id
    WHERE rx.id = p_submission_id AND EXISTS (
      SELECT 1 FROM public.users u WHERE u.user_id = auth.uid()
        AND (u.is_admin OR (u.is_stocmed_sp AND u.is_licensed_pharmacist))
    );
  ELSE
    RAISE EXCEPTION 'Invalid prescription access context';
  END IF;

  IF v_file_path IS NULL THEN RAISE EXCEPTION 'Prescription document access denied'; END IF;
  INSERT INTO public.rx_document_access_logs (
    submission_id, audit_record_id, viewer_user_id, access_context, outcome, request_id
  ) VALUES (
    p_submission_id, v_audit_id, auth.uid(), p_context, 'authorized', NULLIF(p_request_id, '')
  ) RETURNING id INTO v_log_id;
  RETURN QUERY SELECT v_file_path, v_log_id;
END;
$$;

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

-- Make reservation collection replay-safe even if the first HTTP response was lost.
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

REVOKE ALL ON FUNCTION public.set_rx_retention_policy(INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reservation_inventory_capabilities(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_pharmacy_reservations_enabled(BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pharmacy_reservation_summary(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_pharmacy_reservation_queue_seen(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_destination_prescription_queue(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_destination_prescription(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authorize_and_log_rx_document_access(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_guarded_stock_adjustment(UUID, UUID, UUID, public.stock_movement_type, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_reservation(UUID, INTEGER, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.expire_reservations() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_rx_retention_policy(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_inventory_capabilities(UUID[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_sellable_quantities(UUID[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_pharmacy_reservations_enabled(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pharmacy_reservation_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_pharmacy_reservation_queue_seen(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_destination_prescription_queue(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_destination_prescription(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_and_log_rx_document_access(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_guarded_stock_adjustment(UUID, UUID, UUID, public.stock_movement_type, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation(UUID, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_reservations() TO service_role;

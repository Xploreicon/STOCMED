-- Pilot security closure: trusted role/pharmacy provenance, immutable stock gates,
-- Model-A retention enforcement, and transactional patient-data erasure.

-- ---------------------------------------------------------------------------
-- Trusted role and pharmacy-verification provenance
-- ---------------------------------------------------------------------------

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS admin_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_authorization_basis TEXT,
  ADD COLUMN IF NOT EXISTS pharmacist_license_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pharmacist_license_verification_basis TEXT,
  ADD COLUMN IF NOT EXISTS stocmed_sp_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stocmed_sp_authorization_basis TEXT;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS verification_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_authorization_basis TEXT;

-- Legacy production was created before inventory notes became part of the
-- canonical table shape. Later column-level grants reference this field.
ALTER TABLE public.pharmacy_inventory
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Catalogue flags remain the editable source of truth, but this deterministic
-- floor prevents a known POM molecule/brand from becoming an OTC hold merely
-- because legacy or imported data left requires_prescription = FALSE.
CREATE OR REPLACE FUNCTION public.is_pilot_pom_product(
  p_generic_name TEXT,
  p_brand_name TEXT,
  p_requires_prescription BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(p_requires_prescription, FALSE)
    OR LOWER(CONCAT_WS(' ', p_generic_name, p_brand_name)) ~
      '(^|[^a-z0-9])(amoxicillin|augmentin|ciprofloxacin|ciprotab|metronidazole|flagyl|lisinopril|zestril|amlodipine|norvasc|metformin|glucophage|sitagliptin|januvia|glibenclamide|daonil|insulin|lantus|actrapid|warfarin|atorvastatin|lipitor|losartan|cozaar|sildenafil|viagra|tadalafil|cialis|ventolin|albuterol|salbutamol|prednisolone|dexamethasone)([^a-z0-9]|$)';
$$;

UPDATE public.products
SET requires_prescription = TRUE,
    updated_at = NOW()
WHERE requires_prescription = FALSE
  AND public.is_pilot_pom_product(generic_name, brand_name, requires_prescription);

CREATE TABLE IF NOT EXISTS public.pilot_provisioning_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID REFERENCES public.users(user_id) ON DELETE RESTRICT,
  target_pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  capability TEXT NOT NULL CHECK (capability IN (
    'admin', 'licensed_pharmacist', 'stocmed_sp', 'pharmacy_verification'
  )),
  action TEXT NOT NULL CHECK (action IN ('provision', 'revoke', 'provenance_reset')),
  basis TEXT NOT NULL CHECK (length(trim(basis)) > 0),
  provisioned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provisioner_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pilot_provisioning_target_check CHECK (
    (target_user_id IS NOT NULL AND target_pharmacy_id IS NULL AND capability <> 'pharmacy_verification')
    OR
    (target_user_id IS NULL AND target_pharmacy_id IS NOT NULL AND capability = 'pharmacy_verification')
  )
);

ALTER TABLE public.pilot_provisioning_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pilot_provisioning_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.pilot_provisioning_audit TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_pilot_provisioning_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Pilot provisioning audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS pilot_provisioning_audit_append_only ON public.pilot_provisioning_audit;
CREATE TRIGGER pilot_provisioning_audit_append_only
BEFORE UPDATE OR DELETE ON public.pilot_provisioning_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_pilot_provisioning_audit_mutation();

CREATE OR REPLACE FUNCTION public.guard_pharmacy_reservation_setting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.pilot_role_provenance_reset', TRUE) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.reservations_enabled AND (
    NOT NEW.is_active
    OR NOT NEW.is_verified
    OR NEW.verification_authorized_at IS NULL
    OR NULLIF(TRIM(NEW.verification_authorization_basis), '') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.user_id = NEW.user_id
        AND u.is_licensed_pharmacist = TRUE
        AND u.pharmacist_license_verified_at IS NOT NULL
        AND NULLIF(TRIM(u.pharmacist_license_verification_basis), '') IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'A provenance-verified pharmacy and licensed superintendent pharmacist are required';
  END IF;

  IF OLD.reservations_enabled
     AND (NOT NEW.reservations_enabled OR NOT NEW.is_active OR NOT NEW.is_verified
          OR NEW.user_id IS DISTINCT FROM OLD.user_id)
     AND (
       EXISTS (
         SELECT 1 FROM public.reservations r
         WHERE r.pharmacy_id = NEW.id AND r.status = 'active' AND r.expires_at > NOW()
       )
       OR EXISTS (
         SELECT 1 FROM public.rx_submissions rx
         WHERE rx.destination_pharmacy_id = NEW.id
           AND rx.flow_model = 'destination_model_a'
           AND rx.status IN ('submitted', 'under_review')
       )
     ) THEN
    RAISE EXCEPTION 'Resolve active holds and pending prescription reviews before turning reservations off';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_privileged_identity_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_reset BOOLEAN := current_setting('app.pilot_role_provenance_reset', TRUE) = 'on';
  v_role_rpc BOOLEAN := current_setting('app.pilot_role_provisioning', TRUE) = 'on'
    AND COALESCE(auth.role(), '') = 'service_role';
  v_verify_rpc BOOLEAN := current_setting('app.pilot_pharmacy_verification', TRUE) = 'on'
    AND COALESCE(auth.role(), '') = 'service_role';
  v_toggle_rpc BOOLEAN := current_setting('app.reservation_toggle_rpc', TRUE) = 'on';
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_admin OR NEW.is_licensed_pharmacist OR NEW.is_stocmed_sp
         OR NEW.admin_authorized_at IS NOT NULL
         OR NEW.admin_authorization_basis IS NOT NULL
         OR NEW.pharmacist_license_verified_at IS NOT NULL
         OR NEW.pharmacist_license_verification_basis IS NOT NULL
         OR NEW.stocmed_sp_authorized_at IS NOT NULL
         OR NEW.stocmed_sp_authorization_basis IS NOT NULL THEN
        IF NOT (v_role_reset OR v_role_rpc) THEN
          RAISE EXCEPTION 'Pilot roles can only be set through the service provisioning RPC';
        END IF;
      END IF;

      IF COALESCE(auth.role(), '') IN ('anon', 'authenticated')
         AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'A user profile can only be created for the authenticated identity';
      END IF;
    ELSE
      IF (
        NEW.is_admin IS DISTINCT FROM OLD.is_admin
        OR NEW.is_licensed_pharmacist IS DISTINCT FROM OLD.is_licensed_pharmacist
        OR NEW.is_stocmed_sp IS DISTINCT FROM OLD.is_stocmed_sp
        OR NEW.admin_authorized_at IS DISTINCT FROM OLD.admin_authorized_at
        OR NEW.admin_authorization_basis IS DISTINCT FROM OLD.admin_authorization_basis
        OR NEW.pharmacist_license_verified_at IS DISTINCT FROM OLD.pharmacist_license_verified_at
        OR NEW.pharmacist_license_verification_basis IS DISTINCT FROM OLD.pharmacist_license_verification_basis
        OR NEW.stocmed_sp_authorized_at IS DISTINCT FROM OLD.stocmed_sp_authorized_at
        OR NEW.stocmed_sp_authorization_basis IS DISTINCT FROM OLD.stocmed_sp_authorization_basis
      ) AND NOT (v_role_reset OR v_role_rpc) THEN
        RAISE EXCEPTION 'Pilot roles can only be changed through the service provisioning RPC';
      END IF;

      IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND (
        NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.role IS DISTINCT FROM OLD.role
      ) THEN
        RAISE EXCEPTION 'Privileged identity fields can only be changed by the service role';
      END IF;

      IF NOT v_role_reset
         AND OLD.is_licensed_pharmacist AND NOT NEW.is_licensed_pharmacist
         AND EXISTS (
           SELECT 1
           FROM public.pharmacies ph
           WHERE ph.user_id = OLD.user_id
             AND ph.reservations_enabled = TRUE
             AND (
               EXISTS (
                 SELECT 1 FROM public.reservations r
                 WHERE r.pharmacy_id = ph.id AND r.status = 'active' AND r.expires_at > NOW()
               )
               OR EXISTS (
                 SELECT 1 FROM public.rx_submissions rx
                 WHERE rx.destination_pharmacy_id = ph.id
                   AND rx.status IN ('submitted', 'under_review')
               )
             )
         ) THEN
        RAISE EXCEPTION 'Resolve active holds and prescription reviews before revoking the destination SP licence';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'pharmacies' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.reservations_enabled THEN
        RAISE EXCEPTION 'New pharmacies start with reservations off and must opt in through the toggle RPC';
      END IF;
      IF NEW.is_verified OR NEW.verification_authorized_at IS NOT NULL
         OR NEW.verification_authorization_basis IS NOT NULL THEN
        RAISE EXCEPTION 'New pharmacies must be verified through the service verification RPC';
      END IF;
      IF COALESCE(auth.role(), '') IN ('anon', 'authenticated')
         AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'A pharmacy cannot self-assign ownership';
      END IF;
    ELSE
      IF NEW.reservations_enabled IS DISTINCT FROM OLD.reservations_enabled
         AND NOT (v_role_reset OR v_toggle_rpc) THEN
        RAISE EXCEPTION 'Reservation opt-in can only be changed through the pharmacy toggle RPC';
      END IF;

      IF (
        NEW.is_verified IS DISTINCT FROM OLD.is_verified
        OR NEW.verification_authorized_at IS DISTINCT FROM OLD.verification_authorized_at
        OR NEW.verification_authorization_basis IS DISTINCT FROM OLD.verification_authorization_basis
      ) AND NOT (v_role_reset OR v_verify_rpc) THEN
        RAISE EXCEPTION 'Pharmacy verification can only be changed through the service verification RPC';
      END IF;

      IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND (
        NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.license_number IS DISTINCT FROM OLD.license_number
      ) THEN
        RAISE EXCEPTION 'Pharmacy ownership and licence fields can only be changed by the service role';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Record and remove every pre-provenance privilege. Live access is deliberately
-- closed until service-role provisioning is completed explicitly.
INSERT INTO public.pilot_provisioning_audit (
  target_user_id, capability, action, basis, provisioned_by, provisioner_role
)
SELECT u.user_id, role_row.capability, 'provenance_reset',
  'Legacy privilege reset: no trusted provisioning provenance was available',
  NULL, 'migration'
FROM public.users u
CROSS JOIN LATERAL (
  VALUES
    ('admin'::TEXT, u.is_admin),
    ('licensed_pharmacist'::TEXT, u.is_licensed_pharmacist),
    ('stocmed_sp'::TEXT, u.is_stocmed_sp)
) AS role_row(capability, was_enabled)
WHERE role_row.was_enabled;

INSERT INTO public.pilot_provisioning_audit (
  target_pharmacy_id, capability, action, basis, provisioned_by, provisioner_role
)
SELECT ph.id, 'pharmacy_verification', 'provenance_reset',
  'Legacy pharmacy verification reset: no trusted authorization provenance was available',
  NULL, 'migration'
FROM public.pharmacies ph
WHERE ph.is_verified;

SELECT set_config('app.pilot_role_provenance_reset', 'on', TRUE);
UPDATE public.users
SET is_admin = FALSE,
    is_licensed_pharmacist = FALSE,
    is_stocmed_sp = FALSE,
    admin_authorized_at = NULL,
    admin_authorization_basis = NULL,
    pharmacist_license_verified_at = NULL,
    pharmacist_license_verification_basis = NULL,
    stocmed_sp_authorized_at = NULL,
    stocmed_sp_authorization_basis = NULL
WHERE is_admin OR is_licensed_pharmacist OR is_stocmed_sp
   OR admin_authorized_at IS NOT NULL OR admin_authorization_basis IS NOT NULL
   OR pharmacist_license_verified_at IS NOT NULL OR pharmacist_license_verification_basis IS NOT NULL
   OR stocmed_sp_authorized_at IS NOT NULL OR stocmed_sp_authorization_basis IS NOT NULL;

UPDATE public.pharmacies
SET is_verified = FALSE,
    verification_authorized_at = NULL,
    verification_authorization_basis = NULL
WHERE is_verified OR verification_authorized_at IS NOT NULL
   OR verification_authorization_basis IS NOT NULL;
SELECT set_config('app.pilot_role_provenance_reset', 'off', TRUE);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND conname = 'users_admin_provenance_complete'
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_admin_provenance_complete CHECK (
      (is_admin AND admin_authorized_at IS NOT NULL AND NULLIF(TRIM(admin_authorization_basis), '') IS NOT NULL)
      OR (NOT is_admin AND admin_authorized_at IS NULL AND admin_authorization_basis IS NULL)
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND conname = 'users_pharmacist_provenance_complete'
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_pharmacist_provenance_complete CHECK (
      (is_licensed_pharmacist AND pharmacist_license_verified_at IS NOT NULL
        AND NULLIF(TRIM(pharmacist_license_verification_basis), '') IS NOT NULL)
      OR (NOT is_licensed_pharmacist AND pharmacist_license_verified_at IS NULL
        AND pharmacist_license_verification_basis IS NULL)
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND conname = 'users_stocmed_sp_provenance_complete'
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_stocmed_sp_provenance_complete CHECK (
      (is_stocmed_sp AND is_licensed_pharmacist AND stocmed_sp_authorized_at IS NOT NULL
        AND NULLIF(TRIM(stocmed_sp_authorization_basis), '') IS NOT NULL)
      OR (NOT is_stocmed_sp AND stocmed_sp_authorized_at IS NULL
        AND stocmed_sp_authorization_basis IS NULL)
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pharmacies'::regclass AND conname = 'pharmacies_verification_provenance_complete'
  ) THEN
    ALTER TABLE public.pharmacies ADD CONSTRAINT pharmacies_verification_provenance_complete CHECK (
      (is_verified AND verification_authorized_at IS NOT NULL
        AND NULLIF(TRIM(verification_authorization_basis), '') IS NOT NULL)
      OR (NOT is_verified AND verification_authorized_at IS NULL
        AND verification_authorization_basis IS NULL)
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.provision_pilot_role(
  p_user_id UUID,
  p_role TEXT,
  p_enabled BOOLEAN,
  p_basis TEXT
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users;
  v_basis TEXT := NULLIF(TRIM(p_basis), '');
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only the service role can provision pilot roles';
  END IF;
  IF p_enabled IS NULL OR v_basis IS NULL THEN
    RAISE EXCEPTION 'A role decision and nonblank verification basis are required';
  END IF;
  IF p_role NOT IN ('admin', 'licensed_pharmacist', 'stocmed_sp') THEN
    RAISE EXCEPTION 'Unknown pilot role';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;
  IF p_role = 'stocmed_sp' AND p_enabled AND (
    NOT v_user.is_licensed_pharmacist
    OR v_user.pharmacist_license_verified_at IS NULL
    OR NULLIF(TRIM(v_user.pharmacist_license_verification_basis), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'StocMed SP access requires a provenance-verified pharmacist licence';
  END IF;
  IF p_role = 'licensed_pharmacist' AND NOT p_enabled AND v_user.is_stocmed_sp THEN
    RAISE EXCEPTION 'Revoke StocMed SP access before revoking the pharmacist licence';
  END IF;

  PERFORM set_config('app.pilot_role_provisioning', 'on', TRUE);
  IF p_role = 'admin' THEN
    UPDATE public.users SET
      is_admin = p_enabled,
      admin_authorized_at = CASE WHEN p_enabled THEN NOW() ELSE NULL END,
      admin_authorization_basis = CASE WHEN p_enabled THEN v_basis ELSE NULL END,
      updated_at = NOW()
    WHERE user_id = p_user_id RETURNING * INTO v_user;
  ELSIF p_role = 'licensed_pharmacist' THEN
    UPDATE public.users SET
      is_licensed_pharmacist = p_enabled,
      pharmacist_license_verified_at = CASE WHEN p_enabled THEN NOW() ELSE NULL END,
      pharmacist_license_verification_basis = CASE WHEN p_enabled THEN v_basis ELSE NULL END,
      updated_at = NOW()
    WHERE user_id = p_user_id RETURNING * INTO v_user;
  ELSE
    UPDATE public.users SET
      is_stocmed_sp = p_enabled,
      stocmed_sp_authorized_at = CASE WHEN p_enabled THEN NOW() ELSE NULL END,
      stocmed_sp_authorization_basis = CASE WHEN p_enabled THEN v_basis ELSE NULL END,
      updated_at = NOW()
    WHERE user_id = p_user_id RETURNING * INTO v_user;
  END IF;
  PERFORM set_config('app.pilot_role_provisioning', 'off', TRUE);

  INSERT INTO public.pilot_provisioning_audit (
    target_user_id, capability, action, basis, provisioned_by, provisioner_role
  ) VALUES (
    p_user_id, p_role, CASE WHEN p_enabled THEN 'provision' ELSE 'revoke' END,
    v_basis, auth.uid(), COALESCE(auth.role(), 'unknown')
  );
  RETURN v_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_pilot_pharmacy_verification(
  p_pharmacy_id UUID,
  p_verified BOOLEAN,
  p_basis TEXT
)
RETURNS public.pharmacies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy public.pharmacies;
  v_basis TEXT := NULLIF(TRIM(p_basis), '');
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only the service role can verify pilot pharmacies';
  END IF;
  IF p_verified IS NULL OR v_basis IS NULL THEN
    RAISE EXCEPTION 'A verification decision and nonblank basis are required';
  END IF;

  PERFORM set_config('app.pilot_pharmacy_verification', 'on', TRUE);
  UPDATE public.pharmacies
  SET is_verified = p_verified,
      verification_authorized_at = CASE WHEN p_verified THEN NOW() ELSE NULL END,
      verification_authorization_basis = CASE WHEN p_verified THEN v_basis ELSE NULL END,
      updated_at = NOW()
  WHERE id = p_pharmacy_id
  RETURNING * INTO v_pharmacy;
  PERFORM set_config('app.pilot_pharmacy_verification', 'off', TRUE);
  IF v_pharmacy.id IS NULL THEN RAISE EXCEPTION 'Pharmacy profile not found'; END IF;

  INSERT INTO public.pilot_provisioning_audit (
    target_pharmacy_id, capability, action, basis, provisioned_by, provisioner_role
  ) VALUES (
    p_pharmacy_id, 'pharmacy_verification',
    CASE WHEN p_verified THEN 'provision' ELSE 'revoke' END,
    v_basis, auth.uid(), COALESCE(auth.role(), 'unknown')
  );
  RETURN v_pharmacy;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_pharmacy_reservations_enabled(p_enabled BOOLEAN)
RETURNS public.pharmacies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result public.pharmacies;
BEGIN
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Reservation setting is required'; END IF;
  PERFORM set_config('app.reservation_toggle_rpc', 'on', TRUE);
  UPDATE public.pharmacies ph
  SET reservations_enabled = p_enabled, updated_at = NOW()
  WHERE ph.user_id = auth.uid()
  RETURNING * INTO v_result;
  PERFORM set_config('app.reservation_toggle_rpc', 'off', TRUE);
  IF v_result.id IS NULL THEN RAISE EXCEPTION 'Pharmacy profile not found'; END IF;
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Catalogue and inventory/ledger privilege closure
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow authenticated users to insert products" ON public.products;
DROP POLICY IF EXISTS "Allow authenticated users to update products" ON public.products;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.products FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_unverified_catalog_product(
  p_pharmacy_id UUID,
  p_generic_name TEXT,
  p_brand_name TEXT,
  p_manufacturer TEXT,
  p_strength TEXT,
  p_dosage_form TEXT,
  p_category TEXT,
  p_pack_size TEXT,
  p_image_url TEXT
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result public.products;
  v_search_name TEXT;
  v_requires_rx BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;

  IF NULLIF(TRIM(p_generic_name), '') IS NULL
     OR NULLIF(TRIM(p_strength), '') IS NULL
     OR NULLIF(TRIM(p_dosage_form), '') IS NULL
     OR NULLIF(TRIM(p_category), '') IS NULL THEN
    RAISE EXCEPTION 'Generic name, strength, dosage form, and category are required';
  END IF;

  v_search_name := LOWER(CONCAT_WS(' ', TRIM(p_generic_name), NULLIF(TRIM(p_brand_name), '')));
  v_requires_rx := v_search_name ~
    '(^|[^a-z0-9])(amoxicillin|augmentin|ciprofloxacin|ciprotab|metronidazole|flagyl|lisinopril|zestril|amlodipine|norvasc|metformin|glucophage|sitagliptin|januvia|glibenclamide|daonil|insulin|lantus|actrapid|warfarin|atorvastatin|lipitor|losartan|cozaar|sildenafil|viagra|tadalafil|cialis|ventolin|albuterol|salbutamol|prednisolone|dexamethasone)([^a-z0-9]|$)';

  INSERT INTO public.products (
    generic_name, brand_name, manufacturer, strength, dosage_form, category,
    pack_size, image_url, requires_prescription, is_verified, updated_at
  ) VALUES (
    TRIM(p_generic_name), NULLIF(TRIM(p_brand_name), ''), NULLIF(TRIM(p_manufacturer), ''),
    TRIM(p_strength), TRIM(p_dosage_form), TRIM(p_category), NULLIF(TRIM(p_pack_size), ''),
    NULLIF(TRIM(p_image_url), ''), v_requires_rx, FALSE, NOW()
  ) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_stocked_product_image(
  p_pharmacy_id UUID,
  p_product_id UUID,
  p_image_url TEXT
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result public.products;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_inventory pi
    JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
    WHERE pi.pharmacy_id = p_pharmacy_id AND pi.product_id = p_product_id
      AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Only a pharmacy stocking this product can change its image'; END IF;

  UPDATE public.products
  SET image_url = NULLIF(TRIM(p_image_url), ''), updated_at = NOW()
  WHERE id = p_product_id
  RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  RETURN v_result;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.stock_movements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_pos_sale(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_pos_sale(UUID, JSONB) FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.pharmacy_inventory FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  id, pharmacy_id, product_id, price, low_stock_threshold, is_listed, notes, image_url, deleted_at
) ON TABLE public.pharmacy_inventory TO authenticated;
GRANT UPDATE (
  price, low_stock_threshold, is_listed, image_url, deleted_at, updated_at
) ON TABLE public.pharmacy_inventory TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.batches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.batches TO anon, authenticated;
GRANT INSERT ON TABLE public.batches TO authenticated;

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
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;

  IF p_type::TEXT NOT IN ('opening', 'restock', 'adjustment', 'return', 'write_off', 'expiry_writeoff') THEN
    RAISE EXCEPTION 'This stock movement type cannot be created as an adjustment';
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity must be non-zero';
  END IF;
  IF p_type::TEXT IN ('opening', 'restock', 'return') AND p_quantity <= 0 THEN
    RAISE EXCEPTION 'Opening, restock, and return quantities must be positive';
  END IF;
  IF p_type::TEXT IN ('write_off', 'expiry_writeoff') AND p_quantity >= 0 THEN
    RAISE EXCEPTION 'Write-off and expiry quantities must be negative';
  END IF;
  IF NULLIF(TRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for every stock change';
  END IF;

  SELECT quantity_in_stock INTO v_stock
  FROM public.pharmacy_inventory
  WHERE id = p_inventory_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF p_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.batches WHERE id = p_batch_id AND inventory_id = p_inventory_id
  ) THEN RAISE EXCEPTION 'Batch does not belong to this medication'; END IF;

  IF p_type::TEXT = 'opening' AND EXISTS (
    SELECT 1 FROM public.stock_movements WHERE inventory_id = p_inventory_id
  ) THEN RAISE EXCEPTION 'Opening stock is only allowed before the first ledger movement'; END IF;

  IF p_quantity < 0 THEN
    SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_reserved
    FROM public.reservations
    WHERE inventory_id = p_inventory_id AND status = 'active' AND expires_at > NOW();
    IF v_stock + p_quantity < v_reserved THEN
      RAISE EXCEPTION 'This adjustment would consume stock held for pickup';
    END IF;
    IF p_batch_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_batch_stock
      FROM public.stock_movements WHERE batch_id = p_batch_id;
      SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_batch_reserved
      FROM public.reservations
      WHERE batch_id = p_batch_id AND status = 'active' AND expires_at > NOW();
      IF v_batch_stock + p_quantity < v_batch_reserved THEN
        RAISE EXCEPTION 'This adjustment would consume a batch held for pickup';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.stock_movements (
    inventory_id, batch_id, type, quantity, reason, reference, created_by
  ) VALUES (
    p_inventory_id, p_batch_id, p_type, p_quantity, TRIM(p_reason),
    CASE WHEN p_type::TEXT = 'opening' THEN 'OPENING_STOCK' ELSE 'ADJUST_STOCK' END,
    auth.uid()
  ) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Private-file staging and deletion work queues (service-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rx_upload_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_path TEXT NOT NULL UNIQUE CHECK (length(trim(object_path)) > 0),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rx_upload_staging_expiry_idx
  ON public.rx_upload_staging (expires_at);

CREATE TABLE IF NOT EXISTS public.private_file_deletion_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL CHECK (length(trim(bucket)) > 0),
  object_path TEXT NOT NULL CHECK (length(trim(object_path)) > 0),
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT private_file_deletion_queue_object_unique UNIQUE (bucket, object_path)
);

ALTER TABLE public.rx_upload_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_file_deletion_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rx_upload_staging FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.private_file_deletion_queue FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rx_upload_staging TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.private_file_deletion_queue TO service_role;

CREATE OR REPLACE FUNCTION public.touch_private_file_work_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rx_upload_staging_touch_updated_at ON public.rx_upload_staging;
CREATE TRIGGER rx_upload_staging_touch_updated_at
BEFORE UPDATE ON public.rx_upload_staging
FOR EACH ROW EXECUTE FUNCTION public.touch_private_file_work_item();

DROP TRIGGER IF EXISTS private_file_deletion_queue_touch_updated_at ON public.private_file_deletion_queue;
CREATE TRIGGER private_file_deletion_queue_touch_updated_at
BEFORE UPDATE ON public.private_file_deletion_queue
FOR EACH ROW EXECUTE FUNCTION public.touch_private_file_work_item();

CREATE OR REPLACE FUNCTION public.consume_rx_upload_staging()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rx_upload_staging WHERE object_path = NEW.file_url;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consume_rx_upload_staging_after_submission ON public.rx_submissions;
CREATE TRIGGER consume_rx_upload_staging_after_submission
AFTER INSERT ON public.rx_submissions
FOR EACH ROW EXECUTE FUNCTION public.consume_rx_upload_staging();

-- ---------------------------------------------------------------------------
-- Provenance-aware staff access and fail-closed retention
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS rx_retention_admin_select ON public.rx_retention_policy;
CREATE POLICY rx_retention_admin_select ON public.rx_retention_policy
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.users u
  WHERE u.user_id = auth.uid()
    AND (
      (u.is_admin = TRUE AND u.admin_authorized_at IS NOT NULL
        AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL)
      OR
      (u.is_stocmed_sp = TRUE AND u.stocmed_sp_authorized_at IS NOT NULL
        AND NULLIF(TRIM(u.stocmed_sp_authorization_basis), '') IS NOT NULL
        AND u.is_licensed_pharmacist = TRUE
        AND u.pharmacist_license_verified_at IS NOT NULL
        AND NULLIF(TRIM(u.pharmacist_license_verification_basis), '') IS NOT NULL)
    )
));

DROP POLICY IF EXISTS rx_audit_oversight_select ON public.rx_audit_records;
CREATE POLICY rx_audit_oversight_select ON public.rx_audit_records
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.users u
  WHERE u.user_id = auth.uid()
    AND (
      (u.is_admin = TRUE AND u.admin_authorized_at IS NOT NULL
        AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL)
      OR
      (u.is_stocmed_sp = TRUE AND u.stocmed_sp_authorized_at IS NOT NULL
        AND NULLIF(TRIM(u.stocmed_sp_authorization_basis), '') IS NOT NULL
        AND u.is_licensed_pharmacist = TRUE
        AND u.pharmacist_license_verified_at IS NOT NULL
        AND NULLIF(TRIM(u.pharmacist_license_verification_basis), '') IS NOT NULL)
    )
));

DROP POLICY IF EXISTS rx_access_log_oversight_select ON public.rx_document_access_logs;
CREATE POLICY rx_access_log_oversight_select ON public.rx_document_access_logs
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.users u
  WHERE u.user_id = auth.uid()
    AND (
      (u.is_admin = TRUE AND u.admin_authorized_at IS NOT NULL
        AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL)
      OR
      (u.is_stocmed_sp = TRUE AND u.stocmed_sp_authorized_at IS NOT NULL
        AND NULLIF(TRIM(u.stocmed_sp_authorization_basis), '') IS NOT NULL
        AND u.is_licensed_pharmacist = TRUE
        AND u.pharmacist_license_verified_at IS NOT NULL
        AND NULLIF(TRIM(u.pharmacist_license_verification_basis), '') IS NOT NULL)
    )
));

DROP POLICY IF EXISTS rx_purge_events_admin_select ON public.rx_purge_events;
CREATE POLICY rx_purge_events_admin_select ON public.rx_purge_events
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.users u
  WHERE u.user_id = auth.uid()
    AND u.is_admin = TRUE
    AND u.admin_authorized_at IS NOT NULL
    AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
));

DROP POLICY IF EXISTS rx_patient_select ON public.rx_submissions;
CREATE POLICY rx_patient_select ON public.rx_submissions
FOR SELECT TO authenticated
USING (user_id = auth.uid() AND purge_after IS NOT NULL AND purge_after > NOW());

DROP POLICY IF EXISTS rx_destination_sp_select ON public.rx_submissions;
CREATE POLICY rx_destination_sp_select ON public.rx_submissions
FOR SELECT TO authenticated
USING (
  flow_model = 'destination_model_a'
  AND purge_after IS NOT NULL
  AND purge_after > NOW()
  AND EXISTS (
    SELECT 1
    FROM public.pharmacies ph
    JOIN public.users sp ON sp.user_id = ph.user_id
    WHERE ph.id = rx_submissions.destination_pharmacy_id
      AND ph.user_id = auth.uid()
      AND ph.is_verified = TRUE
      AND ph.verification_authorized_at IS NOT NULL
      AND NULLIF(TRIM(ph.verification_authorization_basis), '') IS NOT NULL
      AND sp.is_licensed_pharmacist = TRUE
      AND sp.pharmacist_license_verified_at IS NOT NULL
      AND NULLIF(TRIM(sp.pharmacist_license_verification_basis), '') IS NOT NULL
  )
);

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
    SELECT 1
    FROM public.users u
    WHERE u.user_id = auth.uid()
      AND u.is_admin = TRUE
      AND u.admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Only a provenance-authorized StocMed administrator can configure prescription retention';
  END IF;
  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 3650 THEN
    RAISE EXCEPTION 'Retention must be between 1 and 3650 days';
  END IF;
  IF NULLIF(TRIM(p_legal_basis), '') IS NULL THEN
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

  -- No duration is invented: legacy rows receive the duration just confirmed
  -- by the accountable administrator, measured from their original creation.
  UPDATE public.rx_submissions
  SET purge_after = created_at + make_interval(days => p_retention_days),
      updated_at = NOW()
  WHERE flow_model = 'central_legacy' AND purge_after IS NULL;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_inventory_capabilities(p_inventory_ids UUID[])
RETURNS TABLE (inventory_id UUID, reservations_enabled BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pi.id,
    (
      ph.reservations_enabled
      AND ph.is_active
      AND ph.is_verified
      AND ph.verification_authorized_at IS NOT NULL
      AND NULLIF(TRIM(ph.verification_authorization_basis), '') IS NOT NULL
      AND sp.is_licensed_pharmacist
      AND sp.pharmacist_license_verified_at IS NOT NULL
      AND NULLIF(TRIM(sp.pharmacist_license_verification_basis), '') IS NOT NULL
      AND p.is_verified
      AND (
        NOT public.is_pilot_pom_product(
          p.generic_name, p.brand_name, p.requires_prescription
        )
        OR EXISTS (
          SELECT 1
          FROM public.rx_retention_policy retention
          WHERE retention.singleton = TRUE
            AND retention.is_confirmed = TRUE
            AND retention.retention_days IS NOT NULL
            AND retention.confirmed_by IS NOT NULL
            AND retention.confirmed_at IS NOT NULL
            AND NULLIF(TRIM(retention.legal_basis), '') IS NOT NULL
        )
      )
    )
  FROM public.pharmacy_inventory pi
  JOIN public.products p ON p.id = pi.product_id
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  JOIN public.users sp ON sp.user_id = ph.user_id
  WHERE pi.id = ANY(p_inventory_ids);
$$;

-- Human symptom intake is intentionally unavailable for the pilot. Existing
-- records remain readable under their existing policies and answerable only by
-- a pharmacist whose licence has trusted provisioning provenance.
DROP POLICY IF EXISTS "Allow users to insert own symptom intakes" ON public.symptom_intakes;
DROP POLICY IF EXISTS "Only licensed pharmacists can update symptom intakes" ON public.symptom_intakes;
DROP POLICY IF EXISTS "Allow admins/pharmacists to update symptom intakes" ON public.symptom_intakes;
REVOKE INSERT ON TABLE public.symptom_intakes FROM PUBLIC, anon, authenticated;
CREATE POLICY "Only provenance-verified pharmacists can update symptom intakes"
ON public.symptom_intakes
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.user_id = auth.uid()
    AND u.is_licensed_pharmacist = TRUE
    AND u.pharmacist_license_verified_at IS NOT NULL
    AND NULLIF(TRIM(u.pharmacist_license_verification_basis), '') IS NOT NULL
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.user_id = auth.uid()
    AND u.is_licensed_pharmacist = TRUE
    AND u.pharmacist_license_verified_at IS NOT NULL
    AND NULLIF(TRIM(u.pharmacist_license_verification_basis), '') IS NOT NULL
));

-- ---------------------------------------------------------------------------
-- Digital reservation and prescription gates
-- ---------------------------------------------------------------------------

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
  v_hold_minutes INTEGER;
  v_expires_at TIMESTAMPTZ;
  v_reserved INTEGER;
  v_batch_id UUID;
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

  -- Serialize the per-patient active-hold quota across different inventory rows.
  PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::TEXT));
  PERFORM public.expire_reservations();
  IF (SELECT COUNT(*) FROM public.reservations
      WHERE patient_id = auth.uid() AND status = 'active' AND expires_at > NOW()) >= 3 THEN
    RAISE EXCEPTION 'You already have the maximum of three active holds';
  END IF;

  SELECT pi.*
  INTO v_inventory
  FROM public.pharmacy_inventory pi
  JOIN public.products p ON p.id = pi.product_id
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  JOIN public.users sp ON sp.user_id = ph.user_id
  WHERE pi.id = p_inventory_id
    AND pi.is_listed = TRUE
    AND pi.deleted_at IS NULL
    AND p.is_verified = TRUE
    AND NOT public.is_pilot_pom_product(
      p.generic_name, p.brand_name, p.requires_prescription
    )
    AND ph.is_active = TRUE
    AND ph.is_verified = TRUE
    AND ph.verification_authorized_at IS NOT NULL
    AND NULLIF(TRIM(ph.verification_authorization_basis), '') IS NOT NULL
    AND ph.reservations_enabled = TRUE
    AND sp.is_licensed_pharmacist = TRUE
    AND sp.pharmacist_license_verified_at IS NOT NULL
    AND NULLIF(TRIM(sp.pharmacist_license_verification_basis), '') IS NOT NULL
  FOR UPDATE OF pi;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This verified non-prescription medicine is not available for reservation';
  END IF;

  SELECT ph.reservation_hold_minutes
  INTO v_hold_minutes
  FROM public.pharmacies ph
  WHERE ph.id = v_inventory.pharmacy_id;

  v_expires_at := NOW() + make_interval(mins => v_hold_minutes);

  SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_reserved
  FROM public.reservations
  WHERE inventory_id = p_inventory_id AND status = 'active' AND expires_at > NOW();
  IF v_inventory.quantity_in_stock - v_reserved < p_quantity THEN
    RAISE EXCEPTION 'Only % unit(s) are currently available to hold',
      GREATEST(v_inventory.quantity_in_stock - v_reserved, 0);
  END IF;

  SELECT b.id INTO v_batch_id
  FROM public.batches b
  LEFT JOIN public.stock_movements sm ON sm.batch_id = b.id
  WHERE b.inventory_id = p_inventory_id
    AND b.expiry_date > v_expires_at::DATE
  GROUP BY b.id, b.expiry_date
  HAVING COALESCE(SUM(sm.quantity), 0) - COALESCE((
    SELECT SUM(r.quantity)
    FROM public.reservations r
    WHERE r.batch_id = b.id AND r.status = 'active' AND r.expires_at > NOW()
  ), 0) >= p_quantity
  ORDER BY b.expiry_date ASC, b.id ASC
  LIMIT 1;
  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'No batch remains valid through the requested hold period';
  END IF;

  LOOP
    v_code := LPAD((floor(random() * 1000000))::TEXT, 6, '0');
    BEGIN
      INSERT INTO public.reservations (
        patient_id, session_id, patient_phone, pharmacy_id, inventory_id,
        batch_id, quantity, expires_at, pickup_code
      ) VALUES (
        auth.uid(), NULL, NULL, v_inventory.pharmacy_id, p_inventory_id,
        v_batch_id, p_quantity, v_expires_at, v_code
      ) RETURNING * INTO v_result;
      RETURN v_result;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (SELECT 1 FROM public.reservations WHERE pickup_code = v_code) THEN
        CONTINUE;
      END IF;
      RAISE;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_reservation_sellable_stock(
  p_pharmacy_id UUID,
  p_sale JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group RECORD;
  v_stock INTEGER;
  v_reserved INTEGER;
  v_reservation_id UUID := NULLIF(p_sale->>'reservation_id', '')::UUID;
BEGIN
  PERFORM public.expire_reservations();
  IF v_reservation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.reservations r
    JOIN public.batches b ON b.id = r.batch_id
    WHERE r.id = v_reservation_id
      AND r.pharmacy_id = p_pharmacy_id
      AND r.status = 'active'
      AND r.expires_at > NOW()
      AND b.expiry_date > CURRENT_DATE
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_sale->'items') item
        WHERE (item->>'inventory_id')::UUID = r.inventory_id
          AND (item->>'batch_id')::UUID = r.batch_id
          AND (item->>'quantity')::INTEGER = r.quantity
      )
  ) THEN
    RAISE EXCEPTION 'Pickup does not match an active reservation with a sellable batch';
  END IF;

  FOR v_group IN
    SELECT (item->>'inventory_id')::UUID AS inventory_id,
      SUM((item->>'quantity')::INTEGER)::INTEGER AS requested
    FROM jsonb_array_elements(p_sale->'items') item
    GROUP BY (item->>'inventory_id')::UUID
  LOOP
    SELECT quantity_in_stock INTO v_stock
    FROM public.pharmacy_inventory
    WHERE id = v_group.inventory_id AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item is not owned by this pharmacy'; END IF;

    SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_reserved
    FROM public.reservations
    WHERE inventory_id = v_group.inventory_id
      AND status = 'active'
      AND expires_at > NOW()
      AND (v_reservation_id IS NULL OR id <> v_reservation_id);
    IF v_stock - v_reserved < v_group.requested THEN
      RAISE EXCEPTION 'Insufficient sellable stock: % held for pickup', v_reserved;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_model_a_rx_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy_id UUID;
  v_product_name TEXT;
  v_retention_days INTEGER;
BEGIN
  IF NEW.flow_model <> 'destination_model_a' THEN RETURN NEW; END IF;

  -- Serialize new destination submissions with the same patient's hold quota.
  IF NEW.user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::TEXT));
  END IF;

  SELECT pi.pharmacy_id, COALESCE(p.brand_name, p.generic_name)
  INTO v_pharmacy_id, v_product_name
  FROM public.pharmacy_inventory pi
  JOIN public.products p ON p.id = pi.product_id
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  JOIN public.users sp ON sp.user_id = ph.user_id
  WHERE pi.id = NEW.inventory_id
    AND pi.is_listed = TRUE
    AND pi.deleted_at IS NULL
    AND p.is_verified = TRUE
    AND public.is_pilot_pom_product(
      p.generic_name, p.brand_name, p.requires_prescription
    )
    AND ph.is_active = TRUE
    AND ph.is_verified = TRUE
    AND ph.verification_authorized_at IS NOT NULL
    AND NULLIF(TRIM(ph.verification_authorization_basis), '') IS NOT NULL
    AND ph.reservations_enabled = TRUE
    AND sp.is_licensed_pharmacist = TRUE
    AND sp.pharmacist_license_verified_at IS NOT NULL
    AND NULLIF(TRIM(sp.pharmacist_license_verification_basis), '') IS NOT NULL;

  IF v_pharmacy_id IS NULL OR v_pharmacy_id IS DISTINCT FROM NEW.destination_pharmacy_id THEN
    RAISE EXCEPTION 'The selected verified medicine and pharmacy are not eligible for digital prescription reservations';
  END IF;
  IF NEW.user_id IS NULL OR NEW.requested_quantity IS NULL
     OR NEW.requested_quantity < 1 OR NEW.requested_quantity > 10 THEN
    RAISE EXCEPTION 'A signed-in patient and quantity between 1 and 10 are required';
  END IF;
  IF NEW.file_url IS NULL OR NEW.file_url !~ ('^' || NEW.user_id::TEXT || '/') THEN
    RAISE EXCEPTION 'Prescription object path must belong to the signed-in patient';
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
  NEW.purge_after := NOW() + make_interval(days => v_retention_days);
  RETURN NEW;
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
    patient.full_name, patient.phone, rx.reservation_id, r.pickup_code, rx.destination_seen_at
  FROM public.rx_submissions rx
  JOIN public.pharmacies ph ON ph.id = rx.destination_pharmacy_id
  JOIN public.users sp ON sp.user_id = ph.user_id
  LEFT JOIN public.users patient ON patient.user_id = rx.user_id
  LEFT JOIN public.reservations r ON r.id = rx.reservation_id
  WHERE rx.destination_pharmacy_id = p_pharmacy_id
    AND rx.flow_model = 'destination_model_a'
    AND rx.purge_after IS NOT NULL
    AND rx.purge_after > NOW()
    AND ph.user_id = auth.uid()
    AND ph.is_verified = TRUE
    AND ph.verification_authorized_at IS NOT NULL
    AND NULLIF(TRIM(ph.verification_authorization_basis), '') IS NOT NULL
    AND sp.is_licensed_pharmacist = TRUE
    AND sp.pharmacist_license_verified_at IS NOT NULL
    AND NULLIF(TRIM(sp.pharmacist_license_verification_basis), '') IS NOT NULL
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
  v_hold_expires_at TIMESTAMPTZ;
  v_phone TEXT;
  v_code TEXT;
  v_reservation public.reservations;
BEGIN
  IF p_decision NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be verified or rejected';
  END IF;

  SELECT * INTO v_rx
  FROM public.rx_submissions
  WHERE id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND OR v_rx.flow_model <> 'destination_model_a' THEN
    RAISE EXCEPTION 'Prescription request not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pharmacies ph
    JOIN public.users sp ON sp.user_id = ph.user_id
    WHERE ph.id = v_rx.destination_pharmacy_id
      AND ph.user_id = auth.uid()
      AND ph.is_active = TRUE
      AND ph.is_verified = TRUE
      AND ph.verification_authorized_at IS NOT NULL
      AND NULLIF(TRIM(ph.verification_authorization_basis), '') IS NOT NULL
      AND ph.reservations_enabled = TRUE
      AND sp.is_licensed_pharmacist = TRUE
      AND sp.pharmacist_license_verified_at IS NOT NULL
      AND NULLIF(TRIM(sp.pharmacist_license_verification_basis), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Only the provenance-verified destination pharmacy pharmacist can review this prescription';
  END IF;

  IF v_rx.purge_after IS NULL OR v_rx.purge_after <= NOW() THEN
    RAISE EXCEPTION 'This prescription submission has expired and cannot be reviewed';
  END IF;

  -- The review endpoint must first authorize and log the same viewer's access
  -- to the destination document. This prevents blind approval and audit gaps.
  IF NOT EXISTS (
    SELECT 1
    FROM public.rx_document_access_logs access_log
    WHERE access_log.submission_id = v_rx.id
      AND access_log.viewer_user_id = auth.uid()
      AND access_log.access_context = 'destination_review'
      AND access_log.outcome = 'authorized'
  ) THEN
    RAISE EXCEPTION 'Open the prescription document through the audited review flow before deciding';
  END IF;

  IF v_rx.status = 'verified' AND v_rx.reservation_id IS NOT NULL
     AND p_decision = 'verified' THEN
    SELECT * INTO v_reservation
    FROM public.reservations
    WHERE id = v_rx.reservation_id;
    RETURN jsonb_build_object(
      'submission', to_jsonb(v_rx), 'reservation', to_jsonb(v_reservation), 'replayed', TRUE
    );
  END IF;
  IF v_rx.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'This prescription has already been decided';
  END IF;

  IF p_decision = 'rejected' THEN
    UPDATE public.rx_submissions
    SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = NOW(),
        review_notes = NULLIF(TRIM(p_notes), ''), updated_at = NOW()
    WHERE id = v_rx.id
    RETURNING * INTO v_rx;
    RETURN jsonb_build_object(
      'submission', to_jsonb(v_rx), 'reservation', NULL, 'replayed', FALSE
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_rx.user_id::TEXT));
  PERFORM public.expire_reservations();
  IF (SELECT COUNT(*) FROM public.reservations
      WHERE patient_id = v_rx.user_id AND status = 'active' AND expires_at > NOW()) >= 3 THEN
    RAISE EXCEPTION 'The patient already has the maximum of three active holds';
  END IF;

  SELECT pi.*
  INTO v_inventory
  FROM public.pharmacy_inventory pi
  JOIN public.products p ON p.id = pi.product_id
  WHERE pi.id = v_rx.inventory_id
    AND pi.pharmacy_id = v_rx.destination_pharmacy_id
    AND pi.is_listed = TRUE
    AND pi.deleted_at IS NULL
    AND p.is_verified = TRUE
    AND public.is_pilot_pom_product(
      p.generic_name, p.brand_name, p.requires_prescription
    )
  FOR UPDATE OF pi;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verified prescription medication is no longer available at this pharmacy';
  END IF;

  SELECT ph.reservation_hold_minutes, patient.phone
  INTO v_hold_minutes, v_phone
  FROM public.pharmacies ph
  LEFT JOIN public.users patient ON patient.user_id = v_rx.user_id
  WHERE ph.id = v_rx.destination_pharmacy_id;

  v_hold_expires_at := NOW() + make_interval(mins => v_hold_minutes);
  IF v_rx.purge_after <= v_hold_expires_at THEN
    RAISE EXCEPTION 'Prescription retention must remain valid beyond the new hold expiry';
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_reserved
  FROM public.reservations
  WHERE inventory_id = v_rx.inventory_id AND status = 'active' AND expires_at > NOW();
  IF v_inventory.quantity_in_stock - v_reserved < v_rx.requested_quantity THEN
    RAISE EXCEPTION 'Insufficient stock to approve this prescription reservation';
  END IF;

  SELECT b.id INTO v_batch_id
  FROM public.batches b
  LEFT JOIN public.stock_movements sm ON sm.batch_id = b.id
  WHERE b.inventory_id = v_rx.inventory_id
    AND b.expiry_date > v_hold_expires_at::DATE
  GROUP BY b.id, b.expiry_date
  HAVING COALESCE(SUM(sm.quantity), 0) - COALESCE((
    SELECT SUM(r.quantity)
    FROM public.reservations r
    WHERE r.batch_id = b.id AND r.status = 'active' AND r.expires_at > NOW()
  ), 0) >= v_rx.requested_quantity
  ORDER BY b.expiry_date ASC, b.id ASC
  LIMIT 1;
  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'No batch remains valid through the requested hold period';
  END IF;

  LOOP
    v_code := LPAD((floor(random() * 1000000))::TEXT, 6, '0');
    BEGIN
      INSERT INTO public.reservations (
        patient_id, patient_phone, pharmacy_id, inventory_id, batch_id,
        quantity, expires_at, pickup_code
      ) VALUES (
        v_rx.user_id, v_phone, v_rx.destination_pharmacy_id, v_rx.inventory_id,
        v_batch_id, v_rx.requested_quantity, v_hold_expires_at, v_code
      ) RETURNING * INTO v_reservation;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (SELECT 1 FROM public.reservations WHERE pickup_code = v_code) THEN
        CONTINUE;
      END IF;
      RAISE;
    END;
  END LOOP;

  UPDATE public.rx_submissions
  SET status = 'verified', reviewed_by = auth.uid(), reviewed_at = NOW(),
      review_notes = NULLIF(TRIM(p_notes), ''), reservation_id = v_reservation.id,
      updated_at = NOW()
  WHERE id = v_rx.id
  RETURNING * INTO v_rx;

  RETURN jsonb_build_object(
    'submission', to_jsonb(v_rx), 'reservation', to_jsonb(v_reservation), 'replayed', FALSE
  );
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF p_context = 'destination_review' THEN
    SELECT rx.file_url, audit.id INTO v_file_path, v_audit_id
    FROM public.rx_submissions rx
    LEFT JOIN public.rx_audit_records audit ON audit.submission_id = rx.id
    JOIN public.pharmacies ph ON ph.id = rx.destination_pharmacy_id
    JOIN public.users sp ON sp.user_id = ph.user_id
    WHERE rx.id = p_submission_id
      AND rx.flow_model = 'destination_model_a'
      AND rx.purge_after IS NOT NULL
      AND rx.purge_after > NOW()
      AND ph.user_id = auth.uid()
      AND ph.is_verified = TRUE
      AND ph.verification_authorized_at IS NOT NULL
      AND NULLIF(TRIM(ph.verification_authorization_basis), '') IS NOT NULL
      AND sp.is_licensed_pharmacist = TRUE
      AND sp.pharmacist_license_verified_at IS NOT NULL
      AND NULLIF(TRIM(sp.pharmacist_license_verification_basis), '') IS NOT NULL;
  ELSIF p_context = 'stocmed_oversight' THEN
    SELECT rx.file_url, audit.id INTO v_file_path, v_audit_id
    FROM public.rx_submissions rx
    JOIN public.rx_audit_records audit ON audit.submission_id = rx.id
    WHERE rx.id = p_submission_id
      AND rx.purge_after IS NOT NULL
      AND rx.purge_after > NOW()
      AND EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.user_id = auth.uid()
          AND (
            (u.is_admin = TRUE AND u.admin_authorized_at IS NOT NULL
              AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL)
            OR
            (u.is_stocmed_sp = TRUE AND u.stocmed_sp_authorized_at IS NOT NULL
              AND NULLIF(TRIM(u.stocmed_sp_authorization_basis), '') IS NOT NULL
              AND u.is_licensed_pharmacist = TRUE
              AND u.pharmacist_license_verified_at IS NOT NULL
              AND NULLIF(TRIM(u.pharmacist_license_verification_basis), '') IS NOT NULL)
          )
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

-- ---------------------------------------------------------------------------
-- Patient erasure without destroying regulated prescription records
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_my_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_count BIGINT := 0;
  v_total BIGINT := 0;
  v_files_queued BIGINT := 0;
  v_reservations_anonymized BIGINT := 0;
  v_triage_anonymized BIGINT := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_user::TEXT));

  -- The account remains linked until the approved retention worker has removed
  -- every prescription row and its private object.
  IF EXISTS (SELECT 1 FROM public.rx_submissions WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'Prescription records are retained until the approved retention period ends';
  END IF;

  INSERT INTO public.private_file_deletion_queue (
    bucket, object_path, requested_by, completed_at, last_error, updated_at
  )
  SELECT 'prescriptions', si.photo_url, v_user, NULL, NULL, NOW()
  FROM public.symptom_intakes si
  WHERE si.user_id = v_user AND NULLIF(TRIM(si.photo_url), '') IS NOT NULL
  ON CONFLICT (bucket, object_path) DO UPDATE SET
    requested_by = EXCLUDED.requested_by,
    completed_at = NULL,
    last_error = NULL,
    updated_at = NOW();
  GET DIAGNOSTICS v_files_queued = ROW_COUNT;
  v_total := v_total + v_files_queued;

  UPDATE public.reservations
  SET status = CASE
        WHEN status = 'active' THEN 'cancelled'::public.reservation_status
        ELSE status
      END,
      cancelled_at = CASE WHEN status = 'active' THEN NOW() ELSE cancelled_at END,
      cancellation_reason = CASE
        WHEN status = 'active' THEN 'Cancelled during patient data erasure'
        ELSE cancellation_reason
      END,
      session_id = 'erased:' || encode(extensions.digest(id::TEXT, 'sha256'), 'hex'),
      patient_id = NULL,
      patient_phone = NULL
  WHERE patient_id = v_user;
  GET DIAGNOSTICS v_reservations_anonymized = ROW_COUNT;
  v_total := v_total + v_reservations_anonymized;

  DELETE FROM public.user_search_history WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;

  -- Remove linked de-identified copies first, while their source IDs are still
  -- available, so plaintext cannot survive merely because linkage was erased.
  DELETE FROM public.chat_messages anonymous_copy
  WHERE anonymous_copy.source_message_id IN (
    SELECT owned.id FROM public.chat_messages owned WHERE owned.user_id = v_user
  );
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;

  DELETE FROM public.chat_messages WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM public.searches WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM public.research_consent WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM public.thread_locks WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM public.symptom_intakes WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;

  UPDATE public.triage_logs
  SET user_id = NULL, thread_id = NULL
  WHERE user_id = v_user;
  GET DIAGNOSTICS v_triage_anonymized = ROW_COUNT;
  v_total := v_total + v_triage_anonymized;

  RETURN jsonb_build_object(
    'success', TRUE,
    'records_removed_or_anonymized', v_total,
    'private_files_queued', v_files_queued,
    'reservations_anonymized', v_reservations_anonymized,
    'triage_logs_anonymized', v_triage_anonymized
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Explicit function ACLs: SECURITY DEFINER never implies public invocation
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.prevent_pilot_provisioning_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_pilot_pom_product(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_pharmacy_reservation_setting() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_privileged_identity_fields() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.provision_pilot_role(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_pilot_pharmacy_verification(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_pharmacy_reservations_enabled(BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_unverified_catalog_product(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_stocked_product_image(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_guarded_stock_adjustment(UUID, UUID, UUID, public.stock_movement_type, INTEGER, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.touch_private_file_work_item() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_rx_upload_staging() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_rx_retention_policy(INTEGER, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reservation_inventory_capabilities(UUID[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_reservation(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_reservation_sellable_stock(UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_model_a_rx_submission() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_destination_prescription_queue(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.review_destination_prescription(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.authorize_and_log_rx_document_access(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_my_data() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.provision_pilot_role(UUID, TEXT, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_pilot_pharmacy_verification(UUID, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_pharmacy_reservations_enabled(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_unverified_catalog_product(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_stocked_product_image(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_guarded_stock_adjustment(UUID, UUID, UUID, public.stock_movement_type, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_rx_retention_policy(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_inventory_capabilities(UUID[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation(UUID, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_destination_prescription_queue(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_destination_prescription(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_and_log_rx_document_access(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_data() TO authenticated;

-- Trigger-only and lower-level functions remain non-callable. The guarded sale
-- wrapper can invoke these as its definer, but browser roles cannot bypass it.
REVOKE EXECUTE ON FUNCTION public.sync_pos_sale(UUID, JSONB) FROM PUBLIC, anon, authenticated;

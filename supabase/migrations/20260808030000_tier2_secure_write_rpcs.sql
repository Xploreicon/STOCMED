-- Tier 2 authenticated write boundary, phase 1.
--
-- This migration is deliberately additive: it creates the tenant-resolving,
-- self-protecting RPCs before the application is moved off direct table DML.
-- The companion 20260808040000 migration closes the old grants only after all
-- replacement paths exist.

CREATE TABLE public.pharmacy_sp_action_gates (
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL,
  is_gated BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (pharmacy_id, action_key),
  CONSTRAINT pharmacy_sp_action_gates_known_action CHECK (action_key IN (
    'large_discount',
    'price_change',
    'stock_adjustment',
    'delist_inventory',
    'restore_inventory',
    'void_or_refund',
    'pharmacy_settings',
    'financial_reports',
    'data_export',
    'staff_accounts'
  ))
);

ALTER TABLE public.pharmacy_sp_action_gates ENABLE ROW LEVEL SECURITY;

CREATE POLICY pharmacy_sp_action_gates_owner_select
ON public.pharmacy_sp_action_gates
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.pharmacies pharmacy
  WHERE pharmacy.id = pharmacy_sp_action_gates.pharmacy_id
    AND pharmacy.user_id = auth.uid()
));

REVOKE ALL ON TABLE public.pharmacy_sp_action_gates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pharmacy_sp_action_gates TO authenticated;

-- Per-action protection is opt-in. Keep the legacy report mirror aligned with
-- that new default so there is only one effective source of truth.
UPDATE public.pharmacies
SET sp_require_financial_reports = FALSE
WHERE sp_require_financial_reports IS DISTINCT FROM FALSE;

INSERT INTO public.pharmacy_sp_action_gates (pharmacy_id, action_key)
SELECT pharmacy.id, action.action_key
FROM public.pharmacies pharmacy
CROSS JOIN (VALUES
  ('large_discount'),
  ('price_change'),
  ('stock_adjustment'),
  ('delist_inventory'),
  ('restore_inventory'),
  ('void_or_refund'),
  ('pharmacy_settings'),
  ('financial_reports'),
  ('data_export'),
  ('staff_accounts')
) AS action(action_key)
ON CONFLICT (pharmacy_id, action_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_pharmacy_sp_action_gates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pharmacy_sp_action_gates (pharmacy_id, action_key)
  SELECT NEW.id, action.action_key
  FROM (VALUES
    ('large_discount'),
    ('price_change'),
    ('stock_adjustment'),
    ('delist_inventory'),
    ('restore_inventory'),
    ('void_or_refund'),
    ('pharmacy_settings'),
    ('financial_reports'),
    ('data_export'),
    ('staff_accounts')
  ) AS action(action_key)
  ON CONFLICT (pharmacy_id, action_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_pharmacy_sp_action_gates_after_insert ON public.pharmacies;
CREATE TRIGGER seed_pharmacy_sp_action_gates_after_insert
AFTER INSERT ON public.pharmacies
FOR EACH ROW EXECUTE FUNCTION public.seed_pharmacy_sp_action_gates();

-- Private helpers. They intentionally have no client EXECUTE grant.
CREATE OR REPLACE FUNCTION public.authenticated_pharmacy_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pharmacy.id
  FROM public.pharmacies pharmacy
  WHERE pharmacy.user_id = auth.uid()
  ORDER BY pharmacy.is_active DESC, pharmacy.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.sp_action_is_gated(
  p_pharmacy_id UUID,
  p_action_key TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pharmacies pharmacy
    JOIN public.pharmacy_sp_action_gates action_gate
      ON action_gate.pharmacy_id = pharmacy.id
     AND action_gate.action_key = p_action_key
     AND action_gate.is_gated
    WHERE pharmacy.id = p_pharmacy_id
      AND pharmacy.sp_code_hash IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.verify_gated_sp_action(
  p_pharmacy_id UUID,
  p_token TEXT,
  p_action_key TEXT,
  p_target_description TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  ) THEN
    RETURN FALSE;
  END IF;

  IF NOT public.sp_action_is_gated(p_pharmacy_id, p_action_key) THEN
    RETURN TRUE;
  END IF;

  RETURN public.verify_and_audit_sp_action(
    p_pharmacy_id,
    p_token,
    p_action_key,
    p_target_description
  );
END;
$$;

-- Raw-code verification for policy changes. Returning a structured failure is
-- essential: raising after a failed check would roll back the audit entry and
-- the rate-limit counter in the same transaction.
CREATE OR REPLACE FUNCTION public.verify_current_sp_code(
  p_pharmacy_id UUID,
  p_code TEXT,
  p_audit_action TEXT,
  p_target_description TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pharmacy public.pharmacies%ROWTYPE;
  v_failures INTEGER;
BEGIN
  SELECT * INTO v_pharmacy
  FROM public.pharmacies pharmacy
  WHERE pharmacy.id = p_pharmacy_id
    AND pharmacy.user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pharmacy not found';
  END IF;

  IF v_pharmacy.sp_code_hash IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'SP_CODE_REQUIRED',
      'error', 'Set the superintendent code first.'
    );
  END IF;

  IF v_pharmacy.sp_locked_until IS NOT NULL AND v_pharmacy.sp_locked_until > NOW() THEN
    INSERT INTO public.sp_authorization_audit (
      pharmacy_id, actor_user_id, action, target_description, succeeded, failure_reason
    ) VALUES (
      p_pharmacy_id, auth.uid(), p_audit_action,
      NULLIF(TRIM(p_target_description), ''), FALSE, 'Temporarily locked'
    );
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'SP_LOCKED',
      'error', 'Too many failed attempts. Try again later.'
    );
  END IF;

  IF p_code IS NULL
     OR p_code !~ '^[0-9]{6}$'
     OR crypt(p_code, v_pharmacy.sp_code_hash) <> v_pharmacy.sp_code_hash THEN
    v_failures := v_pharmacy.sp_failed_attempts + 1;
    UPDATE public.pharmacies
    SET sp_failed_attempts = CASE WHEN v_failures >= 5 THEN 0 ELSE v_failures END,
        sp_locked_until = CASE
          WHEN v_failures >= 5 THEN NOW() + INTERVAL '15 minutes'
          ELSE NULL
        END
    WHERE id = p_pharmacy_id;
    INSERT INTO public.sp_authorization_audit (
      pharmacy_id, actor_user_id, action, target_description, succeeded, failure_reason
    ) VALUES (
      p_pharmacy_id, auth.uid(), p_audit_action,
      NULLIF(TRIM(p_target_description), ''), FALSE, 'Current code rejected'
    );
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', CASE WHEN v_failures >= 5 THEN 'SP_LOCKED' ELSE 'SP_CURRENT_CODE_REQUIRED' END,
      'error', CASE
        WHEN v_failures >= 5 THEN 'Too many failed attempts. Try again in 15 minutes.'
        ELSE 'The current superintendent code is incorrect.'
      END
    );
  END IF;

  UPDATE public.pharmacies
  SET sp_failed_attempts = 0,
      sp_locked_until = NULL
  WHERE id = p_pharmacy_id;
  INSERT INTO public.sp_authorization_audit (
    pharmacy_id, actor_user_id, action, target_description, succeeded
  ) VALUES (
    p_pharmacy_id, auth.uid(), p_audit_action,
    NULLIF(TRIM(p_target_description), ''), TRUE
  );
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- Constrain grant issuance to the same canonical action vocabulary used by the
-- gate table and all existing clients.
CREATE OR REPLACE FUNCTION public.authorize_sp_action(
  p_pharmacy_id UUID,
  p_code TEXT,
  p_action TEXT,
  p_target_description TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pharmacy public.pharmacies%ROWTYPE;
  v_token TEXT;
  v_failures INTEGER;
BEGIN
  IF p_action NOT IN (
    'large_discount', 'price_change', 'stock_adjustment',
    'delist_inventory', 'restore_inventory', 'void_or_refund',
    'pharmacy_settings', 'financial_reports', 'data_export', 'staff_accounts'
  ) THEN
    RAISE EXCEPTION 'Unknown superintendent action';
  END IF;

  SELECT * INTO v_pharmacy
  FROM public.pharmacies pharmacy
  WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF v_pharmacy.sp_code_hash IS NULL THEN
    RAISE EXCEPTION 'Set the superintendent code in settings first';
  END IF;

  IF v_pharmacy.sp_locked_until IS NOT NULL AND v_pharmacy.sp_locked_until > NOW() THEN
    INSERT INTO public.sp_authorization_audit (
      pharmacy_id, actor_user_id, action, target_description, succeeded, failure_reason
    ) VALUES (
      p_pharmacy_id, auth.uid(), p_action, p_target_description, FALSE, 'Temporarily locked'
    );
    RETURN '__ERROR__:Too many failed attempts. Try again later';
  END IF;

  IF p_code !~ '^[0-9]{6}$'
     OR crypt(p_code, v_pharmacy.sp_code_hash) <> v_pharmacy.sp_code_hash THEN
    v_failures := v_pharmacy.sp_failed_attempts + 1;
    UPDATE public.pharmacies
    SET sp_failed_attempts = CASE WHEN v_failures >= 5 THEN 0 ELSE v_failures END,
        sp_locked_until = CASE
          WHEN v_failures >= 5 THEN NOW() + INTERVAL '15 minutes'
          ELSE NULL
        END
    WHERE id = p_pharmacy_id;
    INSERT INTO public.sp_authorization_audit (
      pharmacy_id, actor_user_id, action, target_description, succeeded, failure_reason
    ) VALUES (
      p_pharmacy_id, auth.uid(), p_action, p_target_description, FALSE, 'Code rejected'
    );
    RETURN CASE WHEN v_failures >= 5
      THEN '__ERROR__:Too many failed attempts. Try again in 15 minutes'
      ELSE '__ERROR__:Incorrect superintendent code'
    END;
  END IF;

  UPDATE public.pharmacies
  SET sp_failed_attempts = 0, sp_locked_until = NULL
  WHERE id = p_pharmacy_id;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.sp_authorization_grants (
    pharmacy_id, actor_user_id, token_hash, action, expires_at
  ) VALUES (
    p_pharmacy_id,
    auth.uid(),
    encode(digest(v_token, 'sha256'), 'hex'),
    p_action,
    NOW() + make_interval(mins => v_pharmacy.sp_grace_minutes)
  );
  INSERT INTO public.sp_authorization_audit (
    pharmacy_id, actor_user_id, action, target_description, succeeded
  ) VALUES (
    p_pharmacy_id, auth.uid(), p_action, p_target_description, TRUE
  );
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_sp_authorization(
  p_operation TEXT,
  p_new_code TEXT,
  p_current_code TEXT,
  p_gate_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pharmacy public.pharmacies%ROWTYPE;
  v_verification JSONB;
  v_gate RECORD;
  v_has_code BOOLEAN;
BEGIN
  IF p_operation NOT IN ('set_code', 'remove_code', 'set_gates') THEN
    RAISE EXCEPTION 'Unknown SP configuration operation';
  END IF;

  SELECT * INTO v_pharmacy
  FROM public.pharmacies pharmacy
  WHERE pharmacy.user_id = auth.uid()
  ORDER BY pharmacy.is_active DESC, pharmacy.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  v_has_code := v_pharmacy.sp_code_hash IS NOT NULL;

  IF p_operation = 'set_code' THEN
    IF p_new_code IS NULL OR p_new_code !~ '^[0-9]{6}$' THEN
      RAISE EXCEPTION 'The superintendent code must contain exactly 6 digits';
    END IF;
    IF v_has_code THEN
      v_verification := public.verify_current_sp_code(
        v_pharmacy.id, p_current_code, 'change_sp_code', 'Change superintendent code'
      );
      IF NOT COALESCE((v_verification->>'success')::BOOLEAN, FALSE) THEN
        RETURN v_verification;
      END IF;
    ELSE
      INSERT INTO public.sp_authorization_audit (
        pharmacy_id, actor_user_id, action, target_description, succeeded
      ) VALUES (
        v_pharmacy.id, auth.uid(), 'set_sp_code', 'Set superintendent code', TRUE
      );
    END IF;

    UPDATE public.pharmacies
    SET sp_code_hash = crypt(p_new_code, gen_salt('bf', 12)),
        sp_failed_attempts = 0,
        sp_locked_until = NULL,
        sp_code_changed_at = NOW()
    WHERE id = v_pharmacy.id;
    DELETE FROM public.sp_authorization_grants WHERE pharmacy_id = v_pharmacy.id;
    RETURN jsonb_build_object('success', TRUE, 'configured', TRUE);
  END IF;

  IF p_operation = 'remove_code' THEN
    IF NOT v_has_code THEN
      RETURN jsonb_build_object('success', TRUE, 'configured', FALSE, 'replayed', TRUE);
    END IF;
    v_verification := public.verify_current_sp_code(
      v_pharmacy.id, p_current_code, 'remove_sp_code', 'Remove superintendent code'
    );
    IF NOT COALESCE((v_verification->>'success')::BOOLEAN, FALSE) THEN
      RETURN v_verification;
    END IF;
    UPDATE public.pharmacies
    SET sp_code_hash = NULL,
        sp_failed_attempts = 0,
        sp_locked_until = NULL,
        sp_code_changed_at = NOW()
    WHERE id = v_pharmacy.id;
    DELETE FROM public.sp_authorization_grants WHERE pharmacy_id = v_pharmacy.id;
    RETURN jsonb_build_object('success', TRUE, 'configured', FALSE, 'replayed', FALSE);
  END IF;

  IF p_gate_updates IS NULL
     OR jsonb_typeof(p_gate_updates) <> 'object'
     OR p_gate_updates = '{}'::JSONB THEN
    RAISE EXCEPTION 'At least one action gate is required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(p_gate_updates) gate
    WHERE gate.key NOT IN (
      'large_discount', 'price_change', 'stock_adjustment',
      'delist_inventory', 'restore_inventory', 'void_or_refund',
      'pharmacy_settings', 'financial_reports', 'data_export', 'staff_accounts'
    ) OR jsonb_typeof(gate.value) <> 'boolean'
  ) THEN
    RAISE EXCEPTION 'Action gates must contain only known boolean actions';
  END IF;

  IF v_has_code THEN
    v_verification := public.verify_current_sp_code(
      v_pharmacy.id, p_current_code, 'change_sp_gates', 'Change superintendent action gates'
    );
    IF NOT COALESCE((v_verification->>'success')::BOOLEAN, FALSE) THEN
      RETURN v_verification;
    END IF;
  ELSE
    INSERT INTO public.sp_authorization_audit (
      pharmacy_id, actor_user_id, action, target_description, succeeded
    ) VALUES (
      v_pharmacy.id, auth.uid(), 'change_sp_gates',
      'Change superintendent action gates before code setup', TRUE
    );
  END IF;

  FOR v_gate IN SELECT key, value FROM jsonb_each(p_gate_updates)
  LOOP
    INSERT INTO public.pharmacy_sp_action_gates (
      pharmacy_id, action_key, is_gated, updated_at, updated_by
    ) VALUES (
      v_pharmacy.id, v_gate.key, (v_gate.value #>> '{}')::BOOLEAN, NOW(), auth.uid()
    )
    ON CONFLICT (pharmacy_id, action_key) DO UPDATE
    SET is_gated = EXCLUDED.is_gated,
        updated_at = NOW(),
        updated_by = auth.uid();
  END LOOP;

  IF p_gate_updates ? 'financial_reports' THEN
    UPDATE public.pharmacies
    SET sp_require_financial_reports = (p_gate_updates->>'financial_reports')::BOOLEAN
    WHERE id = v_pharmacy.id;
  END IF;
  DELETE FROM public.sp_authorization_grants WHERE pharmacy_id = v_pharmacy.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'gates', (
      SELECT jsonb_object_agg(action_key, is_gated ORDER BY action_key)
      FROM public.pharmacy_sp_action_gates
      WHERE pharmacy_id = v_pharmacy.id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_sp_authorization_settings(
  p_discount_threshold NUMERIC,
  p_grace_minutes INTEGER,
  p_require_financial_reports BOOLEAN,
  p_current_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pharmacy_id UUID;
  v_verification JSONB;
BEGIN
  IF p_discount_threshold IS NULL OR p_discount_threshold < 0 OR p_discount_threshold > 100 THEN
    RAISE EXCEPTION 'Discount threshold must be between 0 and 100';
  END IF;
  IF p_grace_minutes IS NULL OR p_grace_minutes < 1 OR p_grace_minutes > 15 THEN
    RAISE EXCEPTION 'Grace window must be between 1 and 15 minutes';
  END IF;
  IF p_require_financial_reports IS NULL THEN
    RAISE EXCEPTION 'Financial report protection setting is required';
  END IF;

  v_pharmacy_id := public.authenticated_pharmacy_id();
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  v_verification := public.verify_current_sp_code(
    v_pharmacy_id,
    p_current_code,
    'change_sp_settings',
    'Update SP discount threshold, grace window, and report protection'
  );
  IF NOT COALESCE((v_verification->>'success')::BOOLEAN, FALSE) THEN
    RETURN v_verification;
  END IF;

  UPDATE public.pharmacies
  SET sp_discount_threshold = p_discount_threshold,
      sp_grace_minutes = p_grace_minutes,
      sp_require_financial_reports = p_require_financial_reports,
      updated_at = NOW()
  WHERE id = v_pharmacy_id;
  INSERT INTO public.pharmacy_sp_action_gates (
    pharmacy_id, action_key, is_gated, updated_at, updated_by
  ) VALUES (
    v_pharmacy_id, 'financial_reports', p_require_financial_reports, NOW(), auth.uid()
  )
  ON CONFLICT (pharmacy_id, action_key) DO UPDATE
  SET is_gated = EXCLUDED.is_gated,
      updated_at = NOW(),
      updated_by = auth.uid();
  DELETE FROM public.sp_authorization_grants WHERE pharmacy_id = v_pharmacy_id;

  RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_authenticated_pharmacy_profile(
  p_patch JSONB,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy public.pharmacies%ROWTYPE;
  v_result public.pharmacies%ROWTYPE;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION 'At least one pharmacy profile field is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_patch) key
    WHERE key NOT IN (
      'pharmacy_name', 'address', 'city', 'state', 'phone',
      'latitude', 'longitude', 'logo_url', 'is_active',
      'opening_time', 'closing_time'
    )
  ) THEN
    RAISE EXCEPTION 'The pharmacy profile patch contains a protected or unknown field';
  END IF;
  IF (p_patch ? 'latitude') <> (p_patch ? 'longitude') THEN
    RAISE EXCEPTION 'Latitude and longitude must be updated together';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_patch) key
    WHERE key IN ('pharmacy_name', 'address', 'city', 'state', 'phone')
      AND NULLIF(TRIM(p_patch->>key), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Required pharmacy profile text cannot be blank';
  END IF;
  IF p_patch ? 'latitude' AND (
    (p_patch->'latitude' <> 'null'::JSONB AND (p_patch->>'latitude')::NUMERIC NOT BETWEEN -90 AND 90)
    OR (p_patch->'longitude' <> 'null'::JSONB AND (p_patch->>'longitude')::NUMERIC NOT BETWEEN -180 AND 180)
    OR ((p_patch->'latitude' = 'null'::JSONB) <> (p_patch->'longitude' = 'null'::JSONB))
  ) THEN
    RAISE EXCEPTION 'Invalid pharmacy coordinates';
  END IF;
  IF p_patch ? 'is_active' AND jsonb_typeof(p_patch->'is_active') <> 'boolean' THEN
    RAISE EXCEPTION 'Pharmacy visibility must be a boolean';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_patch) key
    WHERE key IN ('opening_time', 'closing_time')
      AND p_patch->key <> 'null'::JSONB
      AND (p_patch->>key) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ) THEN
    RAISE EXCEPTION 'Opening and closing times must use 24-hour HH:MM format';
  END IF;

  SELECT * INTO v_pharmacy
  FROM public.pharmacies pharmacy
  WHERE pharmacy.user_id = auth.uid()
  ORDER BY pharmacy.is_active DESC, pharmacy.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;

  IF NOT public.verify_gated_sp_action(
    v_pharmacy.id,
    p_sp_token,
    'pharmacy_settings',
    'Update pharmacy profile: ' || array_to_string(ARRAY(SELECT jsonb_object_keys(p_patch) ORDER BY 1), ', ')
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;

  UPDATE public.pharmacies pharmacy
  SET pharmacy_name = CASE WHEN p_patch ? 'pharmacy_name' THEN TRIM(p_patch->>'pharmacy_name') ELSE pharmacy.pharmacy_name END,
      address = CASE WHEN p_patch ? 'address' THEN TRIM(p_patch->>'address') ELSE pharmacy.address END,
      city = CASE WHEN p_patch ? 'city' THEN TRIM(p_patch->>'city') ELSE pharmacy.city END,
      state = CASE WHEN p_patch ? 'state' THEN TRIM(p_patch->>'state') ELSE pharmacy.state END,
      phone = CASE WHEN p_patch ? 'phone' THEN TRIM(p_patch->>'phone') ELSE pharmacy.phone END,
      latitude = CASE WHEN p_patch ? 'latitude' THEN NULLIF(p_patch->>'latitude', '')::NUMERIC ELSE pharmacy.latitude END,
      longitude = CASE WHEN p_patch ? 'longitude' THEN NULLIF(p_patch->>'longitude', '')::NUMERIC ELSE pharmacy.longitude END,
      logo_url = CASE WHEN p_patch ? 'logo_url' THEN NULLIF(TRIM(p_patch->>'logo_url'), '') ELSE pharmacy.logo_url END,
      is_active = CASE WHEN p_patch ? 'is_active' THEN (p_patch->>'is_active')::BOOLEAN ELSE pharmacy.is_active END,
      opening_time = CASE WHEN p_patch ? 'opening_time' THEN NULLIF(p_patch->>'opening_time', '')::TIME ELSE pharmacy.opening_time END,
      closing_time = CASE WHEN p_patch ? 'closing_time' THEN NULLIF(p_patch->>'closing_time', '')::TIME ELSE pharmacy.closing_time END,
      updated_at = NOW()
  WHERE pharmacy.id = v_pharmacy.id
  RETURNING * INTO v_result;

  IF v_result.opening_time IS NOT NULL
     AND v_result.closing_time IS NOT NULL
     AND v_result.opening_time = v_result.closing_time THEN
    RAISE EXCEPTION 'Opening and closing times must be different';
  END IF;

  RETURN public.internal_client_pharmacy_profile(v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_pharmacy_inventory_item(
  p_inventory_id UUID,
  p_patch JSONB,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventory public.pharmacy_inventory%ROWTYPE;
  v_price_changed BOOLEAN := FALSE;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION 'At least one inventory field is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_patch) key
    WHERE key NOT IN ('price', 'low_stock_threshold', 'whole_pack_only', 'image_url')
  ) THEN
    RAISE EXCEPTION 'The inventory patch contains a protected or unknown field';
  END IF;
  IF p_patch ? 'price' AND (
    p_patch->'price' = 'null'::JSONB OR (p_patch->>'price')::NUMERIC <= 0
  ) THEN
    RAISE EXCEPTION 'Price must be greater than zero';
  END IF;
  IF p_patch ? 'low_stock_threshold' AND (
    p_patch->'low_stock_threshold' = 'null'::JSONB
    OR (p_patch->>'low_stock_threshold')::INTEGER < 0
    OR (p_patch->>'low_stock_threshold')::NUMERIC <> (p_patch->>'low_stock_threshold')::INTEGER
  ) THEN
    RAISE EXCEPTION 'Low-stock threshold must be a non-negative whole number';
  END IF;
  IF p_patch ? 'whole_pack_only' AND jsonb_typeof(p_patch->'whole_pack_only') <> 'boolean' THEN
    RAISE EXCEPTION 'Whole-pack-only must be a boolean';
  END IF;
  IF p_patch ? 'image_url' AND jsonb_typeof(p_patch->'image_url') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'Inventory image must be a URL string or null';
  END IF;

  SELECT inventory.* INTO v_inventory
  FROM public.pharmacy_inventory inventory
  JOIN public.pharmacies pharmacy ON pharmacy.id = inventory.pharmacy_id
  WHERE inventory.id = p_inventory_id
    AND pharmacy.user_id = auth.uid()
  FOR UPDATE OF inventory;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;

  v_price_changed := p_patch ? 'price'
    AND v_inventory.price IS DISTINCT FROM (p_patch->>'price')::NUMERIC;
  IF v_price_changed AND NOT public.verify_gated_sp_action(
    v_inventory.pharmacy_id,
    p_sp_token,
    'price_change',
    'Change inventory price for ' || p_inventory_id::TEXT
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;

  UPDATE public.pharmacy_inventory inventory
  SET price = CASE WHEN p_patch ? 'price' THEN (p_patch->>'price')::NUMERIC ELSE inventory.price END,
      low_stock_threshold = CASE WHEN p_patch ? 'low_stock_threshold' THEN (p_patch->>'low_stock_threshold')::INTEGER ELSE inventory.low_stock_threshold END,
      whole_pack_only = CASE WHEN p_patch ? 'whole_pack_only' THEN (p_patch->>'whole_pack_only')::BOOLEAN ELSE inventory.whole_pack_only END,
      image_url = CASE WHEN p_patch ? 'image_url' THEN NULLIF(TRIM(p_patch->>'image_url'), '') ELSE inventory.image_url END,
      updated_at = NOW()
  WHERE inventory.id = p_inventory_id;

  RETURN jsonb_build_object('success', TRUE, 'id', p_inventory_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.delist_pharmacy_inventory_item(
  p_inventory_id UUID,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventory public.pharmacy_inventory%ROWTYPE;
BEGIN
  SELECT inventory.* INTO v_inventory
  FROM public.pharmacy_inventory inventory
  JOIN public.pharmacies pharmacy ON pharmacy.id = inventory.pharmacy_id
  WHERE inventory.id = p_inventory_id AND pharmacy.user_id = auth.uid()
  FOR UPDATE OF inventory;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF v_inventory.deleted_at IS NOT NULL AND NOT v_inventory.is_listed THEN
    RETURN jsonb_build_object('success', TRUE, 'id', p_inventory_id, 'replayed', TRUE);
  END IF;
  IF NOT public.verify_gated_sp_action(
    v_inventory.pharmacy_id, p_sp_token, 'delist_inventory',
    'Delist inventory item ' || p_inventory_id::TEXT
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE, 'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;
  UPDATE public.pharmacy_inventory
  SET deleted_at = NOW(), is_listed = FALSE, updated_at = NOW()
  WHERE id = p_inventory_id;
  RETURN jsonb_build_object('success', TRUE, 'id', p_inventory_id, 'replayed', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_pharmacy_inventory_item(
  p_inventory_id UUID,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventory public.pharmacy_inventory%ROWTYPE;
BEGIN
  SELECT inventory.* INTO v_inventory
  FROM public.pharmacy_inventory inventory
  JOIN public.pharmacies pharmacy ON pharmacy.id = inventory.pharmacy_id
  WHERE inventory.id = p_inventory_id AND pharmacy.user_id = auth.uid()
  FOR UPDATE OF inventory;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF v_inventory.deleted_at IS NULL AND v_inventory.is_listed THEN
    RETURN jsonb_build_object('success', TRUE, 'id', p_inventory_id, 'replayed', TRUE);
  END IF;
  IF NOT public.verify_gated_sp_action(
    v_inventory.pharmacy_id, p_sp_token, 'restore_inventory',
    'Restore inventory item ' || p_inventory_id::TEXT
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE, 'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;
  IF v_inventory.item_type = 'store'
     AND v_inventory.barcode IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.pharmacy_inventory active_inventory
       WHERE active_inventory.pharmacy_id = v_inventory.pharmacy_id
         AND active_inventory.id <> v_inventory.id
         AND active_inventory.deleted_at IS NULL
         AND active_inventory.barcode = v_inventory.barcode
     ) THEN
    RAISE EXCEPTION 'An active store item already uses this barcode';
  END IF;
  UPDATE public.pharmacy_inventory
  SET deleted_at = NULL, is_listed = TRUE, updated_at = NOW()
  WHERE id = p_inventory_id;
  RETURN jsonb_build_object('success', TRUE, 'id', p_inventory_id, 'replayed', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_inventory_selling_unit(
  p_inventory_id UUID,
  p_unit_name TEXT,
  p_units_per INTEGER,
  p_price NUMERIC,
  p_barcode TEXT,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy_id UUID;
  v_result public.selling_units%ROWTYPE;
BEGIN
  SELECT inventory.pharmacy_id INTO v_pharmacy_id
  FROM public.pharmacy_inventory inventory
  JOIN public.pharmacies pharmacy ON pharmacy.id = inventory.pharmacy_id
  WHERE inventory.id = p_inventory_id
    AND inventory.deleted_at IS NULL
    AND pharmacy.user_id = auth.uid()
  FOR UPDATE OF inventory;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = v_pharmacy_id
      AND feature.feature_key = 'packs_and_units'
      AND feature.is_enabled
  ) THEN
    RAISE EXCEPTION 'The packs and units feature is disabled';
  END IF;
  IF length(TRIM(COALESCE(p_unit_name, ''))) NOT BETWEEN 2 AND 80
     OR p_units_per IS NULL OR p_units_per < 2
     OR p_price IS NULL OR p_price <= 0
     OR (NULLIF(TRIM(p_barcode), '') IS NOT NULL AND length(TRIM(p_barcode)) NOT BETWEEN 4 AND 64) THEN
    RAISE EXCEPTION 'Invalid selling-unit details';
  END IF;
  IF NOT public.verify_gated_sp_action(
    v_pharmacy_id, p_sp_token, 'price_change',
    'Add selling unit to inventory ' || p_inventory_id::TEXT
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE, 'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;
  INSERT INTO public.selling_units (
    inventory_id, unit_name, units_per, price, barcode
  ) VALUES (
    p_inventory_id, TRIM(p_unit_name), p_units_per, p_price, NULLIF(TRIM(p_barcode), '')
  ) RETURNING * INTO v_result;
  RETURN jsonb_build_object('success', TRUE, 'selling_unit', to_jsonb(v_result));
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_inventory_selling_unit(
  p_inventory_id UUID,
  p_selling_unit_id UUID,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy_id UUID;
BEGIN
  SELECT inventory.pharmacy_id INTO v_pharmacy_id
  FROM public.pharmacy_inventory inventory
  JOIN public.pharmacies pharmacy ON pharmacy.id = inventory.pharmacy_id
  WHERE inventory.id = p_inventory_id
    AND inventory.deleted_at IS NULL
    AND pharmacy.user_id = auth.uid()
  FOR UPDATE OF inventory;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = v_pharmacy_id
      AND feature.feature_key = 'packs_and_units'
      AND feature.is_enabled
  ) THEN
    RAISE EXCEPTION 'The packs and units feature is disabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.selling_units selling_unit
    WHERE selling_unit.id = p_selling_unit_id
      AND selling_unit.inventory_id = p_inventory_id
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE, 'code', 'NOT_FOUND', 'error', 'Selling unit not found.'
    );
  END IF;
  IF NOT public.verify_gated_sp_action(
    v_pharmacy_id, p_sp_token, 'price_change',
    'Remove selling unit ' || p_selling_unit_id::TEXT
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE, 'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;
  DELETE FROM public.selling_units
  WHERE id = p_selling_unit_id AND inventory_id = p_inventory_id;
  RETURN jsonb_build_object('success', TRUE, 'id', p_selling_unit_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_authenticated_pharmacy_features(
  p_changes JSONB,
  p_current_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pharmacy public.pharmacies%ROWTYPE;
  v_verification JSONB;
BEGIN
  IF p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'array'
     OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'At least one feature change is required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_changes) change
    WHERE jsonb_typeof(change) <> 'object'
       OR change->>'feature_key' NOT IN (
         'packs_and_units', 'staff_accounts', 'customers', 'credit_sales',
         'purchase_orders_and_receiving', 'multi_branch', 'notifications',
         'reservations', 'stock_exchange', 'price_benchmark',
         'whatsapp_receipts', 'loyalty', 'unmet_demand_widget',
         'smart_reorder', 'quickbooks_export'
       )
       OR jsonb_typeof(change->'is_enabled') <> 'boolean'
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(change) key
         WHERE key NOT IN ('feature_key', 'is_enabled')
       )
  ) THEN
    RAISE EXCEPTION 'Feature changes contain an unknown key or invalid value';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_changes) change
    WHERE change->>'feature_key' = 'stock_exchange'
      AND (change->>'is_enabled')::BOOLEAN
  ) THEN
    RAISE EXCEPTION 'Near-expiry stock exchange is awaiting legal clearance';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_changes) change
    GROUP BY change->>'feature_key'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'A feature may appear only once per request';
  END IF;

  SELECT * INTO v_pharmacy
  FROM public.pharmacies pharmacy
  WHERE pharmacy.user_id = auth.uid()
  ORDER BY pharmacy.is_active DESC, pharmacy.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;

  IF v_pharmacy.sp_code_hash IS NOT NULL THEN
    v_verification := public.verify_current_sp_code(
      v_pharmacy.id,
      p_current_code,
      'change_pharmacy_features',
      'Change pharmacy feature configuration'
    );
    IF NOT COALESCE((v_verification->>'success')::BOOLEAN, FALSE) THEN
      RETURN v_verification;
    END IF;
  END IF;

  INSERT INTO public.pharmacy_features (
    pharmacy_id, feature_key, is_enabled, enabled_at, enabled_by, updated_at
  )
  SELECT
    v_pharmacy.id,
    change->>'feature_key',
    (change->>'is_enabled')::BOOLEAN,
    CASE WHEN (change->>'is_enabled')::BOOLEAN THEN NOW() ELSE NULL END,
    CASE WHEN (change->>'is_enabled')::BOOLEAN THEN auth.uid() ELSE NULL END,
    NOW()
  FROM jsonb_array_elements(p_changes) change
  ON CONFLICT (pharmacy_id, feature_key) DO UPDATE
  SET is_enabled = EXCLUDED.is_enabled,
      enabled_at = EXCLUDED.enabled_at,
      enabled_by = EXCLUDED.enabled_by,
      updated_at = NOW();

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_changes) change
    WHERE change->>'feature_key' = 'reservations'
  ) THEN
    PERFORM set_config('app.reservation_toggle_rpc', 'on', TRUE);
    UPDATE public.pharmacies
    SET reservations_enabled = (
      SELECT (change->>'is_enabled')::BOOLEAN
      FROM jsonb_array_elements(p_changes) change
      WHERE change->>'feature_key' = 'reservations'
    ),
    updated_at = NOW()
    WHERE id = v_pharmacy.id;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'features', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'feature_key', feature.feature_key,
        'is_enabled', feature.is_enabled,
        'enabled_at', feature.enabled_at,
        'settings', feature.settings
      ) ORDER BY feature.feature_key), '[]'::JSONB)
      FROM public.pharmacy_features feature
      WHERE feature.pharmacy_id = v_pharmacy.id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_guarded_stock_adjustment(
  p_inventory_id UUID,
  p_type TEXT,
  p_quantity INTEGER,
  p_reason TEXT,
  p_batch_id UUID,
  p_new_batch_number TEXT,
  p_new_batch_expiry_date DATE,
  p_new_batch_cost_price NUMERIC,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventory public.pharmacy_inventory%ROWTYPE;
  v_type_text TEXT := LOWER(REPLACE(TRIM(COALESCE(p_type, '')), '-', '_'));
  v_db_type public.stock_movement_type;
  v_final_batch_id UUID := p_batch_id;
  v_stock INTEGER;
  v_reserved INTEGER;
  v_batch_stock INTEGER;
  v_batch_reserved INTEGER;
  v_movement public.stock_movements%ROWTYPE;
BEGIN
  IF v_type_text = 'expiry' THEN v_type_text := 'expiry_writeoff'; END IF;
  IF v_type_text NOT IN ('restock', 'return', 'adjustment', 'write_off', 'expiry_writeoff') THEN
    RAISE EXCEPTION 'This stock movement type cannot be created as an adjustment';
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity must be a non-zero whole number';
  END IF;
  IF v_type_text IN ('restock', 'return') AND p_quantity <= 0 THEN
    RAISE EXCEPTION 'Restock and return quantities must be positive';
  END IF;
  IF v_type_text IN ('write_off', 'expiry_writeoff') AND p_quantity >= 0 THEN
    RAISE EXCEPTION 'Write-off and expiry quantities must be negative';
  END IF;
  IF NULLIF(TRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for every stock change';
  END IF;
  IF p_new_batch_cost_price IS NOT NULL AND p_new_batch_cost_price < 0 THEN
    RAISE EXCEPTION 'Batch cost cannot be negative';
  END IF;

  SELECT inventory.* INTO v_inventory
  FROM public.pharmacy_inventory inventory
  JOIN public.pharmacies pharmacy ON pharmacy.id = inventory.pharmacy_id
  WHERE inventory.id = p_inventory_id
    AND inventory.deleted_at IS NULL
    AND pharmacy.user_id = auth.uid()
  FOR UPDATE OF inventory;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  v_stock := v_inventory.quantity_in_stock;

  IF NOT public.verify_gated_sp_action(
       v_inventory.pharmacy_id,
       p_sp_token,
       'stock_adjustment',
       INITCAP(REPLACE(v_type_text, '_', ' ')) || ' for inventory ' || p_inventory_id::TEXT
         || ': ' || TRIM(p_reason)
     ) THEN
    RETURN jsonb_build_object(
      'success', FALSE, 'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;

  IF p_batch_id IS NOT NULL
     AND (p_new_batch_number IS NOT NULL OR p_new_batch_expiry_date IS NOT NULL) THEN
    RAISE EXCEPTION 'Choose an existing batch or provide a new batch, not both';
  END IF;
  IF p_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.batches batch
    WHERE batch.id = p_batch_id AND batch.inventory_id = p_inventory_id
  ) THEN
    RAISE EXCEPTION 'Batch does not belong to this inventory item';
  END IF;

  IF v_inventory.tracks_expiry THEN
    IF v_final_batch_id IS NULL THEN
      IF v_type_text <> 'restock'
         OR p_quantity <= 0
         OR NULLIF(TRIM(p_new_batch_number), '') IS NULL
         OR p_new_batch_expiry_date IS NULL THEN
        RAISE EXCEPTION 'A batch selection or complete new-batch details are required';
      END IF;
      IF p_new_batch_expiry_date <= CURRENT_DATE THEN
        RAISE EXCEPTION 'Expired batches cannot be added to stock';
      END IF;
      INSERT INTO public.batches (
        inventory_id, batch_number, expiry_date, quantity_received, cost_price
      ) VALUES (
        p_inventory_id, TRIM(p_new_batch_number), p_new_batch_expiry_date,
        p_quantity, p_new_batch_cost_price
      ) RETURNING id INTO v_final_batch_id;
    END IF;
  ELSIF v_final_batch_id IS NOT NULL
        OR p_new_batch_number IS NOT NULL
        OR p_new_batch_expiry_date IS NOT NULL THEN
    RAISE EXCEPTION 'Non-expiry inventory must not reference a batch';
  END IF;

  IF p_quantity < 0 THEN
    SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_reserved
    FROM public.reservations
    WHERE inventory_id = p_inventory_id
      AND status = 'active'
      AND expires_at > NOW();
    IF v_stock + p_quantity < v_reserved THEN
      RAISE EXCEPTION 'This adjustment would consume stock held for pickup';
    END IF;
    IF v_final_batch_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_batch_stock
      FROM public.stock_movements WHERE batch_id = v_final_batch_id;
      SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_batch_reserved
      FROM public.reservations
      WHERE batch_id = v_final_batch_id
        AND status = 'active'
        AND expires_at > NOW();
      IF v_batch_stock + p_quantity < v_batch_reserved THEN
        RAISE EXCEPTION 'This adjustment would consume a batch held for pickup';
      END IF;
    END IF;
  END IF;

  -- The production enum intentionally has no write_off value. Preserve the
  -- semantic reason while recording the signed correction as an adjustment.
  v_db_type := CASE
    WHEN v_type_text = 'write_off' THEN 'adjustment'::public.stock_movement_type
    ELSE v_type_text::public.stock_movement_type
  END;
  INSERT INTO public.stock_movements (
    inventory_id, batch_id, type, quantity, reason, reference, created_by
  ) VALUES (
    p_inventory_id,
    v_final_batch_id,
    v_db_type,
    p_quantity,
    CASE WHEN v_type_text = 'write_off' THEN 'Write-off: ' || TRIM(p_reason) ELSE TRIM(p_reason) END,
    'ADJUST_STOCK',
    auth.uid()
  ) RETURNING * INTO v_movement;

  RETURN jsonb_build_object(
    'success', TRUE,
    'movement', to_jsonb(v_movement),
    'batch_id', v_final_batch_id
  );
END;
$$;

-- POS keeps its existing signature because the action token is already part of
-- the durable/offline sale envelope. The threshold is evaluated only after all
-- line prices have been resolved from authoritative inventory/selling-unit rows.
CREATE OR REPLACE FUNCTION public.sync_pos_sale(
  p_pharmacy_id UUID,
  p_sale JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID := (p_sale->>'id')::UUID;
  v_status TEXT;
  v_item JSONB;
  v_inventory_id UUID;
  v_batch_id UUID;
  v_selling_unit_id UUID;
  v_quantity INTEGER;
  v_available INTEGER;
  v_unit_price NUMERIC;
  v_tracks_expiry BOOLEAN;
  v_whole_pack_only BOOLEAN;
  v_units_per INTEGER;
  v_subtotal NUMERIC := 0;
  v_discount NUMERIC := COALESCE((p_sale->>'discount')::NUMERIC, 0);
  v_discount_threshold NUMERIC;
  v_discount_percent NUMERIC := 0;
  v_total NUMERIC;
  v_group RECORD;
BEGIN
  SELECT pharmacy.sp_discount_threshold INTO v_discount_threshold
  FROM public.pharmacies pharmacy
  WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  IF v_sale_id IS NULL THEN RAISE EXCEPTION 'Sale ID is required'; END IF;
  IF jsonb_typeof(p_sale->'items') <> 'array'
     OR jsonb_array_length(p_sale->'items') = 0 THEN
    RAISE EXCEPTION 'A sale must contain at least one item';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_sale_id::TEXT));
  SELECT sale.status INTO v_status
  FROM public.sales sale
  WHERE sale.id = v_sale_id
  FOR UPDATE;
  IF v_status = 'completed' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sales sale
      WHERE sale.id = v_sale_id AND sale.pharmacy_id = p_pharmacy_id
    ) THEN
      RAISE EXCEPTION 'Sale ID belongs to another pharmacy';
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'id', v_sale_id, 'replayed', TRUE);
  END IF;
  IF v_status IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales sale
    WHERE sale.id = v_sale_id AND sale.pharmacy_id = p_pharmacy_id
  ) THEN
    RAISE EXCEPTION 'Sale ID belongs to another pharmacy';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_sale->'items')
  LOOP
    v_inventory_id := (v_item->>'inventory_id')::UUID;
    v_batch_id := NULLIF(v_item->>'batch_id', '')::UUID;
    v_selling_unit_id := NULLIF(v_item->>'selling_unit_id', '')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Sale quantities must be positive'; END IF;

    SELECT
      inventory.quantity_in_stock,
      inventory.price,
      inventory.tracks_expiry,
      inventory.whole_pack_only
    INTO v_available, v_unit_price, v_tracks_expiry, v_whole_pack_only
    FROM public.pharmacy_inventory inventory
    WHERE inventory.id = v_inventory_id
      AND inventory.pharmacy_id = p_pharmacy_id
      AND inventory.deleted_at IS NULL
      AND inventory.is_listed
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventory item % is not sellable', v_inventory_id;
    END IF;

    IF v_selling_unit_id IS NOT NULL THEN
      SELECT selling_unit.units_per, selling_unit.price / selling_unit.units_per
      INTO v_units_per, v_unit_price
      FROM public.selling_units selling_unit
      WHERE selling_unit.id = v_selling_unit_id
        AND selling_unit.inventory_id = v_inventory_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Selling unit does not belong to this item'; END IF;
    ELSE
      v_units_per := 1;
      IF v_whole_pack_only THEN RAISE EXCEPTION 'This medicine must be sold as a whole pack'; END IF;
    END IF;

    IF v_tracks_expiry AND (
      v_batch_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.batches batch
        WHERE batch.id = v_batch_id
          AND batch.inventory_id = v_inventory_id
          AND batch.expiry_date > CURRENT_DATE
      )
    ) THEN
      RAISE EXCEPTION 'A valid unexpired owned batch is required';
    END IF;
    IF NOT v_tracks_expiry AND v_batch_id IS NOT NULL THEN
      RAISE EXCEPTION 'Non-expiry inventory must not reference a batch';
    END IF;
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
  END LOOP;

  FOR v_group IN
    SELECT
      (item->>'inventory_id')::UUID AS inventory_id,
      SUM((item->>'quantity')::INTEGER)::INTEGER AS requested
    FROM jsonb_array_elements(p_sale->'items') item
    GROUP BY (item->>'inventory_id')::UUID
  LOOP
    SELECT inventory.quantity_in_stock INTO v_available
    FROM public.pharmacy_inventory inventory
    WHERE inventory.id = v_group.inventory_id
      AND inventory.pharmacy_id = p_pharmacy_id
    FOR UPDATE;
    IF v_available < v_group.requested THEN
      RAISE EXCEPTION 'Insufficient stock: requested %, available %',
        v_group.requested, v_available;
    END IF;
  END LOOP;

  FOR v_group IN
    SELECT
      (item->>'batch_id')::UUID AS batch_id,
      SUM((item->>'quantity')::INTEGER)::INTEGER AS requested
    FROM jsonb_array_elements(p_sale->'items') item
    WHERE NULLIF(item->>'batch_id', '') IS NOT NULL
    GROUP BY (item->>'batch_id')::UUID
  LOOP
    SELECT COALESCE(SUM(movement.quantity), 0)::INTEGER INTO v_available
    FROM public.stock_movements movement
    WHERE movement.batch_id = v_group.batch_id;
    IF v_available < v_group.requested THEN
      RAISE EXCEPTION 'Insufficient batch stock: requested %, available %',
        v_group.requested, v_available;
    END IF;
  END LOOP;

  IF v_discount < 0 OR v_discount > v_subtotal THEN
    RAISE EXCEPTION 'Discount must be between zero and subtotal';
  END IF;
  IF v_subtotal > 0 THEN
    v_discount_percent := (v_discount * 100) / v_subtotal;
  END IF;
  IF v_discount_percent > v_discount_threshold
     AND NOT public.verify_gated_sp_action(
       p_pharmacy_id,
       p_sale->>'sp_authorization_token',
       'large_discount',
       'Sale ' || v_sale_id::TEXT || ': '
         || ROUND(v_discount_percent, 2)::TEXT || '% discount'
     ) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required for this discount.'
    );
  END IF;
  v_total := v_subtotal - v_discount;

  INSERT INTO public.sales (
    id, pharmacy_id, cashier_id, subtotal, discount, total,
    payment_method, status, created_at, synced_at, updated_at
  ) VALUES (
    v_sale_id, p_pharmacy_id, auth.uid(), v_subtotal, v_discount, v_total,
    (p_sale->>'payment_method')::public.payment_method_type, 'pending',
    COALESCE((p_sale->>'created_at')::TIMESTAMPTZ, NOW()), NOW(), NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET subtotal = EXCLUDED.subtotal,
      discount = EXCLUDED.discount,
      total = EXCLUDED.total,
      payment_method = EXCLUDED.payment_method,
      synced_at = NOW(),
      updated_at = NOW()
  WHERE public.sales.pharmacy_id = p_pharmacy_id
    AND public.sales.status = 'pending';

  DELETE FROM public.sale_items WHERE sale_id = v_sale_id;
  INSERT INTO public.sale_items (
    sale_id, inventory_id, batch_id, quantity, unit_price, line_total, selling_unit_id
  )
  SELECT
    v_sale_id,
    (item->>'inventory_id')::UUID,
    NULLIF(item->>'batch_id', '')::UUID,
    (item->>'quantity')::NUMERIC,
    CASE WHEN selling_unit.id IS NULL
      THEN inventory.price
      ELSE selling_unit.price / selling_unit.units_per
    END,
    (item->>'quantity')::NUMERIC * CASE WHEN selling_unit.id IS NULL
      THEN inventory.price
      ELSE selling_unit.price / selling_unit.units_per
    END,
    selling_unit.id
  FROM jsonb_array_elements(p_sale->'items') item
  JOIN public.pharmacy_inventory inventory
    ON inventory.id = (item->>'inventory_id')::UUID
   AND inventory.pharmacy_id = p_pharmacy_id
  LEFT JOIN public.selling_units selling_unit
    ON selling_unit.id = NULLIF(item->>'selling_unit_id', '')::UUID
   AND selling_unit.inventory_id = inventory.id;

  UPDATE public.sales
  SET status = 'completed', synced_at = NOW(), updated_at = NOW()
  WHERE id = v_sale_id
    AND pharmacy_id = p_pharmacy_id
    AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale could not be completed'; END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'id', v_sale_id,
    'replayed', FALSE,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total', v_total
  );
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
  v_reservation_id UUID := NULLIF(p_sale->>'reservation_id', '')::UUID;
  v_sale_id UUID := (p_sale->>'id')::UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sales sale
    WHERE sale.id = v_sale_id
      AND sale.pharmacy_id = p_pharmacy_id
      AND sale.status = 'completed'
      AND (v_reservation_id IS NULL OR EXISTS (
        SELECT 1 FROM public.reservations reservation
        WHERE reservation.id = v_reservation_id
          AND reservation.status = 'collected'
          AND reservation.sale_id = sale.id
      ))
  ) THEN
    RETURN jsonb_build_object(
      'success', TRUE, 'id', v_sale_id, 'replayed', TRUE, 'shift_id', v_shift_id
    );
  END IF;
  IF v_shift_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.shifts shift
    WHERE shift.id = v_shift_id
      AND shift.pharmacy_id = p_pharmacy_id
      AND shift.cashier_id = auth.uid()
      AND shift.status = 'open'
  ) THEN
    RAISE EXCEPTION 'An open cashier shift is required';
  END IF;

  PERFORM public.assert_reservation_sellable_stock(p_pharmacy_id, p_sale);
  v_result := public.sync_pos_sale(p_pharmacy_id, p_sale);
  IF NOT COALESCE((v_result->>'success')::BOOLEAN, FALSE) THEN
    RETURN v_result || jsonb_build_object('shift_id', v_shift_id);
  END IF;

  UPDATE public.sales
  SET shift_id = v_shift_id, updated_at = NOW()
  WHERE id = v_sale_id
    AND pharmacy_id = p_pharmacy_id
    AND (shift_id IS NULL OR shift_id = v_shift_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale could not be attached to shift'; END IF;

  IF v_reservation_id IS NOT NULL THEN
    UPDATE public.reservations reservation
    SET status = 'collected', collected_at = NOW(), sale_id = v_sale_id
    WHERE reservation.id = v_reservation_id
      AND reservation.pharmacy_id = p_pharmacy_id
      AND reservation.status = 'active'
      AND reservation.expires_at > NOW()
      AND reservation.sale_id IS NULL;
    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM public.reservations reservation
      WHERE reservation.id = v_reservation_id
        AND reservation.sale_id = v_sale_id
        AND reservation.status = 'collected'
    ) THEN
      RAISE EXCEPTION 'Reservation cannot be collected';
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object('shift_id', v_shift_id);
END;
$$;

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
  IF NOT public.verify_gated_sp_action(
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
  FROM public.sales sale
  WHERE sale.id = p_sale_id AND sale.pharmacy_id = p_pharmacy_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;

  v_status := CASE WHEN p_kind = 'refund' THEN 'refunded' ELSE 'voided' END;
  IF v_sale.status = v_status THEN
    RETURN jsonb_build_object(
      'success', TRUE, 'id', p_sale_id, 'status', v_status, 'replayed', TRUE
    );
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
      INSERT INTO public.stock_movements (
        inventory_id, batch_id, type, quantity, reason, reference, created_by
      ) VALUES (
        v_item.inventory_id,
        v_item.batch_id,
        'return',
        v_item.quantity,
        INITCAP(p_kind) || ' of sale #' || p_sale_id || ': ' || TRIM(p_reason),
        p_kind || '_' || p_sale_id::TEXT,
        auth.uid()
      );
    END IF;
  END LOOP;

  UPDATE public.sales
  SET status = v_status, updated_at = NOW()
  WHERE id = p_sale_id AND pharmacy_id = p_pharmacy_id;

  RETURN jsonb_build_object(
    'success', TRUE, 'id', p_sale_id, 'status', v_status, 'replayed', FALSE
  );
END;
$$;

-- Five-argument modern import entrypoint. The old four-argument function stays
-- private after cutover and remains the already-audited atomic import engine.
CREATE OR REPLACE FUNCTION public.import_inventory_file(
  p_pharmacy_id UUID,
  p_user_id UUID,
  p_rows JSONB,
  p_import_id UUID,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_existing_price NUMERIC;
  v_mapped_price NUMERIC;
  v_requires_price_authorization BOOLEAN := FALSE;
  v_target_key TEXT;
  v_seen_target_prices JSONB := '{}'::JSONB;
BEGIN
  IF auth.uid() IS NULL
     OR auth.uid() <> p_user_id
     OR NOT EXISTS (
       SELECT 1 FROM public.pharmacies pharmacy
       WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Import must contain at least one row';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_existing_price := NULL;
    v_mapped_price := NULLIF(v_row->'mapped'->>'price', '')::NUMERIC;
    v_target_key := NULL;
    IF COALESCE(v_row->'mapped'->>'item_type', 'medicine') = 'store' THEN
      v_target_key := CASE
        WHEN NULLIF(TRIM(v_row->'mapped'->>'sku'), '') IS NOT NULL
          THEN 'store:sku:' || TRIM(v_row->'mapped'->>'sku')
        ELSE 'store:name:' || LOWER(TRIM(v_row->'mapped'->>'generic_name'))
          || ':brand:' || LOWER(COALESCE(NULLIF(TRIM(v_row->'mapped'->>'brand_name'), ''), ''))
      END;
      SELECT inventory.price INTO v_existing_price
      FROM public.pharmacy_inventory inventory
      WHERE inventory.pharmacy_id = p_pharmacy_id
        AND inventory.item_type = 'store'
        AND inventory.deleted_at IS NULL
        AND (
          (
            NULLIF(TRIM(v_row->'mapped'->>'sku'), '') IS NOT NULL
            AND inventory.barcode = TRIM(v_row->'mapped'->>'sku')
          )
          OR (
            NULLIF(TRIM(v_row->'mapped'->>'sku'), '') IS NULL
            AND LOWER(TRIM(inventory.item_name)) = LOWER(TRIM(v_row->'mapped'->>'generic_name'))
            AND LOWER(COALESCE(TRIM(inventory.brand), '')) =
                LOWER(COALESCE(NULLIF(TRIM(v_row->'mapped'->>'brand_name'), ''), ''))
          )
        )
      LIMIT 1
      FOR UPDATE;
    ELSIF NULLIF(v_row->>'selected_product_id', '') IS NOT NULL
          AND v_row->>'selected_product_id' <> 'create_new' THEN
      v_target_key := 'medicine:' || (v_row->>'selected_product_id');
      SELECT inventory.price INTO v_existing_price
      FROM public.pharmacy_inventory inventory
      WHERE inventory.pharmacy_id = p_pharmacy_id
        AND inventory.product_id = (v_row->>'selected_product_id')::UUID
        AND inventory.deleted_at IS NULL
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_existing_price IS NOT NULL
       AND v_mapped_price IS NOT NULL
       AND v_existing_price IS DISTINCT FROM v_mapped_price THEN
      v_requires_price_authorization := TRUE;
      EXIT;
    END IF;

    -- A file can target the same as-yet-unstocked product/store item more than
    -- once. The first row creates it and a later row then becomes a price
    -- update inside the atomic import, so include that transition in preflight.
    IF v_target_key IS NOT NULL
       AND v_mapped_price IS NOT NULL
       AND v_seen_target_prices ? v_target_key
       AND (v_seen_target_prices->>v_target_key)::NUMERIC
           IS DISTINCT FROM v_mapped_price THEN
      v_requires_price_authorization := TRUE;
      EXIT;
    END IF;
    IF v_target_key IS NOT NULL AND v_mapped_price IS NOT NULL THEN
      v_seen_target_prices := v_seen_target_prices
        || jsonb_build_object(v_target_key, v_mapped_price);
    END IF;
  END LOOP;

  IF v_requires_price_authorization
     AND NOT public.verify_gated_sp_action(
       p_pharmacy_id,
       p_sp_token,
       'price_change',
       'Import changes one or more existing inventory prices'
     ) THEN
    RETURN jsonb_build_object(
      'success', FALSE, 'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;

  RETURN public.import_inventory_file(p_pharmacy_id, p_user_id, p_rows, p_import_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_quickbooks_expiry(
  p_pharmacy_id UUID,
  p_staging_id UUID,
  p_batch_number TEXT,
  p_expiry_date DATE,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage public.quickbooks_import_staging%ROWTYPE;
  v_existing_price NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;

  SELECT * INTO v_stage
  FROM public.quickbooks_import_staging staging
  WHERE staging.id = p_staging_id
    AND staging.pharmacy_id = p_pharmacy_id
    AND staging.status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending QuickBooks item not found'; END IF;

  SELECT inventory.price INTO v_existing_price
  FROM public.pharmacy_inventory inventory
  WHERE inventory.pharmacy_id = p_pharmacy_id
    AND inventory.product_id = v_stage.product_id
    AND inventory.deleted_at IS NULL
  LIMIT 1
  FOR UPDATE;
  IF v_existing_price IS NOT NULL
     AND v_existing_price IS DISTINCT FROM v_stage.retail_price
     AND NOT public.verify_gated_sp_action(
       p_pharmacy_id,
       p_sp_token,
       'price_change',
       'QuickBooks expiry capture changes an existing inventory price'
     ) THEN
    RETURN jsonb_build_object(
      'success', FALSE, 'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;

  RETURN public.capture_quickbooks_expiry(
    p_pharmacy_id, p_staging_id, p_batch_number, p_expiry_date
  );
END;
$$;

-- Receiving changes cost and stock, not an existing retail price. No current
-- SP action gate applies, but feature enforcement belongs inside the RPC rather
-- than only in the route. Preserve the audited receiving engine behind it.
ALTER FUNCTION public.receive_goods(UUID, UUID, UUID, TEXT, JSONB)
  RENAME TO receive_goods_t2_internal;

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
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = p_pharmacy_id
      AND feature.feature_key = 'purchase_orders_and_receiving'
      AND feature.is_enabled
  ) THEN
    RAISE EXCEPTION 'The buying and receiving feature is disabled';
  END IF;
  RETURN public.receive_goods_t2_internal(
    p_pharmacy_id, p_supplier_id, p_po_id, p_notes, p_lines
  );
END;
$$;

-- Full reports are action-gated. The dashboard gets a separate allowlisted
-- summary rather than a caller-controlled boolean that could expose the full
-- report payload without authorization.
CREATE OR REPLACE FUNCTION public.get_pharmacy_reports(
  p_pharmacy_id UUID,
  p_from DATE,
  p_to DATE,
  p_sp_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;
  IF NOT public.verify_gated_sp_action(
    p_pharmacy_id,
    p_sp_token,
    'financial_reports',
    'View financial reports from ' || p_from::TEXT || ' to ' || p_to::TEXT
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE, 'code', 'SP_AUTH_REQUIRED',
      'error', 'Superintendent authorization is required or has expired.'
    );
  END IF;
  RETURN public.get_pharmacy_reports(p_pharmacy_id, p_from, p_to);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pharmacy_dashboard_summary(
  p_pharmacy_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reports JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;
  v_reports := public.get_pharmacy_reports(p_pharmacy_id, p_from, p_to);
  RETURN jsonb_build_object(
    'range', v_reports->'range',
    'daily_sales', v_reports->'daily_sales',
    'stock_valuation', v_reports->'stock_valuation'
  );
END;
$$;

ALTER FUNCTION public.seed_pharmacy_sp_action_gates() OWNER TO postgres;
ALTER FUNCTION public.authenticated_pharmacy_id() OWNER TO postgres;
ALTER FUNCTION public.sp_action_is_gated(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.verify_gated_sp_action(UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.verify_current_sp_code(UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.authorize_sp_action(UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.configure_sp_authorization(TEXT, TEXT, TEXT, JSONB) OWNER TO postgres;
ALTER FUNCTION public.update_sp_authorization_settings(NUMERIC, INTEGER, BOOLEAN, TEXT) OWNER TO postgres;
ALTER FUNCTION public.update_authenticated_pharmacy_profile(JSONB, TEXT) OWNER TO postgres;
ALTER FUNCTION public.update_pharmacy_inventory_item(UUID, JSONB, TEXT) OWNER TO postgres;
ALTER FUNCTION public.delist_pharmacy_inventory_item(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.restore_pharmacy_inventory_item(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.create_inventory_selling_unit(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.remove_inventory_selling_unit(UUID, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.set_authenticated_pharmacy_features(JSONB, TEXT) OWNER TO postgres;
ALTER FUNCTION public.record_guarded_stock_adjustment(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, DATE, NUMERIC, TEXT) OWNER TO postgres;
ALTER FUNCTION public.sync_pos_sale(UUID, JSONB) OWNER TO postgres;
ALTER FUNCTION public.sync_pos_sale_with_shift(UUID, JSONB) OWNER TO postgres;
ALTER FUNCTION public.reverse_completed_sale(UUID, UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.import_inventory_file(UUID, UUID, JSONB, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.capture_quickbooks_expiry(UUID, UUID, TEXT, DATE, TEXT) OWNER TO postgres;
ALTER FUNCTION public.receive_goods_t2_internal(UUID, UUID, UUID, TEXT, JSONB) OWNER TO postgres;
ALTER FUNCTION public.receive_goods(UUID, UUID, UUID, TEXT, JSONB) OWNER TO postgres;
ALTER FUNCTION public.get_pharmacy_reports(UUID, DATE, DATE, TEXT) OWNER TO postgres;
ALTER FUNCTION public.get_pharmacy_dashboard_summary(UUID, DATE, DATE) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.seed_pharmacy_sp_action_gates()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.authenticated_pharmacy_id()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sp_action_is_gated(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_gated_sp_action(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_current_sp_code(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.receive_goods_t2_internal(UUID, UUID, UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.configure_sp_authorization(TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_sp_authorization_settings(NUMERIC, INTEGER, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_authenticated_pharmacy_profile(JSONB, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_pharmacy_inventory_item(UUID, JSONB, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delist_pharmacy_inventory_item(UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_pharmacy_inventory_item(UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_inventory_selling_unit(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_inventory_selling_unit(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_authenticated_pharmacy_features(JSONB, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_guarded_stock_adjustment(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, DATE, NUMERIC, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capture_quickbooks_expiry(UUID, UUID, TEXT, DATE, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_goods(UUID, UUID, UUID, TEXT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_pharmacy_reports(UUID, DATE, DATE, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_pharmacy_dashboard_summary(UUID, DATE, DATE)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.configure_sp_authorization(TEXT, TEXT, TEXT, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_sp_authorization_settings(NUMERIC, INTEGER, BOOLEAN, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_authenticated_pharmacy_profile(JSONB, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_pharmacy_inventory_item(UUID, JSONB, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delist_pharmacy_inventory_item(UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_pharmacy_inventory_item(UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_inventory_selling_unit(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_inventory_selling_unit(UUID, UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_authenticated_pharmacy_features(JSONB, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_guarded_stock_adjustment(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, DATE, NUMERIC, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_inventory_file(UUID, UUID, JSONB, UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_quickbooks_expiry(UUID, UUID, TEXT, DATE, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_goods(UUID, UUID, UUID, TEXT, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pharmacy_reports(UUID, DATE, DATE, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pharmacy_dashboard_summary(UUID, DATE, DATE)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

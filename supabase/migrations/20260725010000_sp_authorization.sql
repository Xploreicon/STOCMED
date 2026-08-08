CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS sp_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS sp_discount_threshold NUMERIC(5,2) NOT NULL DEFAULT 10
    CHECK (sp_discount_threshold >= 0 AND sp_discount_threshold <= 100),
  ADD COLUMN IF NOT EXISTS sp_grace_minutes INTEGER NOT NULL DEFAULT 5
    CHECK (sp_grace_minutes BETWEEN 1 AND 15),
  ADD COLUMN IF NOT EXISTS sp_require_financial_reports BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sp_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sp_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sp_code_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.sp_authorization_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_description TEXT,
  succeeded BOOLEAN NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sp_authorization_audit_pharmacy_created
  ON public.sp_authorization_audit(pharmacy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sp_authorization_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sp_grants_lookup
  ON public.sp_authorization_grants(pharmacy_id, actor_user_id, expires_at);

ALTER TABLE public.sp_authorization_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_authorization_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sp_audit_owner_read ON public.sp_authorization_audit;
CREATE POLICY sp_audit_owner_read ON public.sp_authorization_audit
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = sp_authorization_audit.pharmacy_id
      AND pharmacy.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users app_user
    WHERE app_user.user_id = auth.uid() AND app_user.is_admin = TRUE
  )
);

-- No client INSERT/UPDATE/DELETE policies: audit entries are append-only through
-- security-definer functions. Grants are likewise invisible to clients.

CREATE OR REPLACE FUNCTION public.set_sp_authorization_code(
  p_pharmacy_id UUID,
  p_new_code TEXT,
  p_current_code TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pharmacy public.pharmacies%ROWTYPE;
BEGIN
  IF p_new_code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'The superintendent code must contain exactly 6 digits';
  END IF;

  SELECT * INTO v_pharmacy
  FROM public.pharmacies
  WHERE id = p_pharmacy_id AND user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;

  IF v_pharmacy.sp_code_hash IS NOT NULL
     AND (p_current_code IS NULL OR crypt(p_current_code, v_pharmacy.sp_code_hash) <> v_pharmacy.sp_code_hash) THEN
    INSERT INTO public.sp_authorization_audit(
      pharmacy_id, actor_user_id, action, target_description, succeeded, failure_reason
    ) VALUES (
      p_pharmacy_id, auth.uid(), 'change_sp_code', 'Superintendent code', FALSE, 'Current code rejected'
    );
    RAISE EXCEPTION 'Current superintendent code is incorrect';
  END IF;

  UPDATE public.pharmacies
  SET sp_code_hash = crypt(p_new_code, gen_salt('bf', 12)),
      sp_failed_attempts = 0,
      sp_locked_until = NULL,
      sp_code_changed_at = NOW()
  WHERE id = p_pharmacy_id;

  DELETE FROM public.sp_authorization_grants WHERE pharmacy_id = p_pharmacy_id;
  INSERT INTO public.sp_authorization_audit(
    pharmacy_id, actor_user_id, action, target_description, succeeded
  ) VALUES (
    p_pharmacy_id, auth.uid(), 'change_sp_code', 'Superintendent code', TRUE
  );
END;
$$;

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
  SELECT * INTO v_pharmacy
  FROM public.pharmacies
  WHERE id = p_pharmacy_id AND user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF v_pharmacy.sp_code_hash IS NULL THEN RAISE EXCEPTION 'Set the superintendent code in settings first'; END IF;

  IF v_pharmacy.sp_locked_until IS NOT NULL AND v_pharmacy.sp_locked_until > NOW() THEN
    INSERT INTO public.sp_authorization_audit(
      pharmacy_id, actor_user_id, action, target_description, succeeded, failure_reason
    ) VALUES (
      p_pharmacy_id, auth.uid(), p_action, p_target_description, FALSE, 'Temporarily locked'
    );
    RETURN '__ERROR__:Too many failed attempts. Try again later';
  END IF;

  IF p_code !~ '^[0-9]{6}$' OR crypt(p_code, v_pharmacy.sp_code_hash) <> v_pharmacy.sp_code_hash THEN
    v_failures := v_pharmacy.sp_failed_attempts + 1;
    UPDATE public.pharmacies
    SET sp_failed_attempts = CASE WHEN v_failures >= 5 THEN 0 ELSE v_failures END,
        sp_locked_until = CASE WHEN v_failures >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END
    WHERE id = p_pharmacy_id;
    INSERT INTO public.sp_authorization_audit(
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
  INSERT INTO public.sp_authorization_grants(
    pharmacy_id, actor_user_id, token_hash, action, expires_at
  ) VALUES (
    p_pharmacy_id,
    auth.uid(),
    encode(digest(v_token, 'sha256'), 'hex'),
    p_action,
    NOW() + make_interval(mins => v_pharmacy.sp_grace_minutes)
  );
  INSERT INTO public.sp_authorization_audit(
    pharmacy_id, actor_user_id, action, target_description, succeeded
  ) VALUES (
    p_pharmacy_id, auth.uid(), p_action, p_target_description, TRUE
  );
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_sp_authorization(
  p_pharmacy_id UUID,
  p_token TEXT,
  p_action TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sp_authorization_grants grant_row
    WHERE grant_row.pharmacy_id = p_pharmacy_id
      AND grant_row.actor_user_id = auth.uid()
      AND grant_row.token_hash = encode(digest(p_token, 'sha256'), 'hex')
      AND grant_row.action = p_action
      AND grant_row.expires_at > NOW()
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_sp_authorization_code(
  p_pharmacy_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users app_user
    WHERE app_user.user_id = auth.uid() AND app_user.is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'A verified reset reason is required';
  END IF;

  UPDATE public.pharmacies
  SET sp_code_hash = NULL,
      sp_failed_attempts = 0,
      sp_locked_until = NULL,
      sp_code_changed_at = NULL
  WHERE id = p_pharmacy_id;
  DELETE FROM public.sp_authorization_grants WHERE pharmacy_id = p_pharmacy_id;
  INSERT INTO public.sp_authorization_audit(
    pharmacy_id, actor_user_id, action, target_description, succeeded
  ) VALUES (
    p_pharmacy_id, auth.uid(), 'admin_reset_sp_code', trim(p_reason), TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_sp_authorization_code(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authorize_sp_action(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_sp_authorization(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_sp_authorization_code(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_sp_authorization_code(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_sp_action(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_sp_authorization(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_sp_authorization_code(UUID, TEXT) TO authenticated;

REVOKE ALL ON public.sp_authorization_audit, public.sp_authorization_grants FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sp_authorization_audit FROM authenticated;
REVOKE ALL ON public.sp_authorization_grants FROM authenticated;
GRANT SELECT ON public.sp_authorization_audit TO authenticated;

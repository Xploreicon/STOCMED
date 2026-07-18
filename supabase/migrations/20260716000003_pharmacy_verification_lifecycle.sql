-- Pilot pharmacy verification lifecycle.
--
-- A format-plausible PCN premises number grants at most thirty days of
-- provisional discovery. Format validation is deliberately not treated as
-- verification: FULL status requires two private documents, acceptance of the
-- current StocMed PCN standards, and a service-role evidence decision.

-- ---------------------------------------------------------------------------
-- PCN registration-number normalization and lifecycle state
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_pcn_registration_number(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT UPPER(TRIM(COALESCE(p_value, '')));
$$;

CREATE OR REPLACE FUNCTION public.is_plausible_pcn_registration_number(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  -- PCN does not publish a checksum or public machine-readable syntax.
  -- Current pilot premises numbers are six-to-nine digits. Passing this
  -- plausibility check grants a short provisional window only; it is never
  -- regulatory verification.
  SELECT public.normalize_pcn_registration_number(p_value) ~ '^[0-9]{6,9}$';
$$;

CREATE OR REPLACE FUNCTION public.normalize_pharmacist_license_number(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT UPPER(TRIM(COALESCE(p_value, '')));
$$;

CREATE OR REPLACE FUNCTION public.is_plausible_pharmacist_license_number(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  -- PCN does not publish a checksum suitable for local verification. Preserve
  -- the exact normalized identifier while rejecting prose and malformed
  -- separators; service provisioning still requires external PCN evidence.
  SELECT
    LENGTH(public.normalize_pharmacist_license_number(p_value)) BETWEEN 4 AND 32
    AND public.normalize_pharmacist_license_number(p_value)
      ~ '^[A-Z0-9]+([/-][A-Z0-9]+)*$'
    AND LENGTH(REGEXP_REPLACE(
      public.normalize_pharmacist_license_number(p_value), '[^0-9]', '', 'g'
    )) BETWEEN 4 AND 10;
$$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pharmacist_license_number TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_pharmacist_license_identity_complete'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_pharmacist_license_identity_complete CHECK (
        (
          is_licensed_pharmacist = TRUE
          AND public.is_plausible_pharmacist_license_number(
            pharmacist_license_number
          )
        )
        OR
        (
          is_licensed_pharmacist = FALSE
          AND pharmacist_license_number IS NULL
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_pharmacist_license_number_unique_idx
  ON public.users (
    public.normalize_pharmacist_license_number(pharmacist_license_number)
  )
  WHERE pharmacist_license_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_pharmacist_license_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_reset BOOLEAN :=
    current_setting('app.pilot_role_provenance_reset', TRUE) = 'on';
  v_role_rpc BOOLEAN :=
    current_setting('app.pilot_role_provisioning', TRUE) = 'on'
    AND COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.pharmacist_license_number IS NOT NULL
       AND NOT (v_role_reset OR v_role_rpc) THEN
      RAISE EXCEPTION 'Pharmacist licence identity can only be set through service provisioning';
    END IF;
  ELSIF NEW.pharmacist_license_number
      IS DISTINCT FROM OLD.pharmacist_license_number
      AND NOT (v_role_reset OR v_role_rpc) THEN
    RAISE EXCEPTION 'Pharmacist licence identity can only be changed through service provisioning';
  END IF;

  IF NEW.pharmacist_license_number IS NOT NULL THEN
    NEW.pharmacist_license_number :=
      public.normalize_pharmacist_license_number(
        NEW.pharmacist_license_number
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_pharmacist_license_identity_trigger
  ON public.users;
CREATE TRIGGER guard_pharmacist_license_identity_trigger
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_pharmacist_license_identity();

CREATE OR REPLACE FUNCTION public.provision_licensed_pharmacist(
  p_user_id UUID,
  p_license_number TEXT,
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
  v_license TEXT := public.normalize_pharmacist_license_number(p_license_number);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only the service role can provision pharmacist licences';
  END IF;
  IF p_enabled IS NULL OR v_basis IS NULL THEN
    RAISE EXCEPTION 'A licence decision and nonblank verification basis are required';
  END IF;
  IF p_enabled AND NOT public.is_plausible_pharmacist_license_number(v_license) THEN
    RAISE EXCEPTION 'A valid structured PCN pharmacist licence number is required';
  END IF;

  IF p_enabled THEN
    PERFORM pg_advisory_xact_lock(hashtext('pcn-pharmacist:' || v_license));
    IF EXISTS (
      SELECT 1 FROM public.users existing
      WHERE existing.user_id <> p_user_id
        AND public.normalize_pharmacist_license_number(
          existing.pharmacist_license_number
        ) = v_license
    ) THEN
      RAISE EXCEPTION 'This PCN pharmacist licence is already provisioned to another account';
    END IF;
  END IF;

  SELECT * INTO v_user
  FROM public.users u
  WHERE u.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;
  IF NOT p_enabled AND v_user.is_stocmed_sp THEN
    RAISE EXCEPTION 'Revoke StocMed SP access before revoking the pharmacist licence';
  END IF;

  PERFORM set_config('app.pilot_role_provisioning', 'on', TRUE);
  UPDATE public.users
  SET is_licensed_pharmacist = p_enabled,
      pharmacist_license_number = CASE WHEN p_enabled THEN v_license ELSE NULL END,
      pharmacist_license_verified_at = CASE WHEN p_enabled THEN NOW() ELSE NULL END,
      pharmacist_license_verification_basis = CASE WHEN p_enabled THEN v_basis ELSE NULL END,
      updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING * INTO v_user;
  PERFORM set_config('app.pilot_role_provisioning', 'off', TRUE);

  INSERT INTO public.pilot_provisioning_audit (
    target_user_id, capability, action, basis, provisioned_by, provisioner_role
  ) VALUES (
    p_user_id, 'licensed_pharmacist',
    CASE WHEN p_enabled THEN 'provision' ELSE 'revoke' END,
    CASE WHEN p_enabled
      THEN v_basis || '; PCN pharmacist licence: ' || v_license
      ELSE v_basis
    END,
    auth.uid(), auth.role()
  );
  RETURN v_user;
END;
$$;

-- Keep the original role RPC for admin and StocMed-SP decisions, but route all
-- pharmacist licence decisions through the structured-identity API above.
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
  IF p_role = 'licensed_pharmacist' THEN
    RETURN public.provision_licensed_pharmacist(
      p_user_id, NULL, p_enabled, v_basis
    );
  END IF;

  SELECT * INTO v_user
  FROM public.users u
  WHERE u.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;
  IF p_role = 'stocmed_sp' AND p_enabled AND (
    NOT v_user.is_licensed_pharmacist
    OR NOT public.is_plausible_pharmacist_license_number(
      v_user.pharmacist_license_number
    )
    OR v_user.pharmacist_license_verified_at IS NULL
    OR NULLIF(TRIM(v_user.pharmacist_license_verification_basis), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'StocMed SP access requires a structured, provenance-verified pharmacist licence';
  END IF;

  PERFORM set_config('app.pilot_role_provisioning', 'on', TRUE);
  IF p_role = 'admin' THEN
    UPDATE public.users SET
      is_admin = p_enabled,
      admin_authorized_at = CASE WHEN p_enabled THEN NOW() ELSE NULL END,
      admin_authorization_basis = CASE WHEN p_enabled THEN v_basis ELSE NULL END,
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

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS verification_status TEXT,
  ADD COLUMN IF NOT EXISTS provisional_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisional_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pcn_standards_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_documents_evidence_basis TEXT,
  ADD COLUMN IF NOT EXISTS verification_standards_evidence_basis TEXT,
  ADD COLUMN IF NOT EXISTS legacy_verification_bootstrap_eligible BOOLEAN
    NOT NULL DEFAULT FALSE;

-- 20260716000002 intentionally removed legacy verification trust. Preserve
-- that fail-closed posture here while avoiding a search blackout during the
-- coordinated rollout: each valid, unique registration that predates this
-- migration receives one fresh thirty-day provisional window. Valid duplicate
-- legacy rows stay revoked, but retain one bootstrap marker so the approved
-- exact row can be selected as the canonical registration. The marker is
-- consumed by the evidence-backed legacy bootstrap below and is forced FALSE
-- for every pharmacy registered after this migration.
SELECT set_config('app.pilot_role_provenance_reset', 'on', TRUE);
SELECT set_config('app.pharmacy_verification_transition', 'on', TRUE);
SELECT set_config('app.pilot_pharmacy_verification', 'on', TRUE);
SELECT set_config('app.reservation_toggle_rpc', 'on', TRUE);

UPDATE public.pharmacies ph
SET is_verified = FALSE,
    verification_authorized_at = NULL,
    verification_authorization_basis = NULL,
    verification_documents_evidence_basis = NULL,
    verification_standards_evidence_basis = NULL,
    verification_status = CASE
      WHEN public.is_plausible_pcn_registration_number(ph.license_number)
        AND 1 = (
          SELECT COUNT(*)
          FROM public.pharmacies duplicate
          WHERE public.normalize_pcn_registration_number(duplicate.license_number) =
            public.normalize_pcn_registration_number(ph.license_number)
        )
      THEN 'provisional'
      ELSE 'revoked'
    END,
    provisional_started_at = NOW(),
    provisional_expires_at = NOW() + INTERVAL '30 days',
    legacy_verification_bootstrap_eligible = CASE
      WHEN public.is_plausible_pcn_registration_number(ph.license_number)
      THEN TRUE
      ELSE FALSE
    END,
    reservations_enabled = CASE
      WHEN public.is_plausible_pcn_registration_number(ph.license_number)
        AND 1 = (
          SELECT COUNT(*)
          FROM public.pharmacies duplicate
          WHERE public.normalize_pcn_registration_number(duplicate.license_number) =
            public.normalize_pcn_registration_number(ph.license_number)
        )
      THEN ph.reservations_enabled
      ELSE FALSE
    END,
    updated_at = NOW();

SELECT set_config('app.reservation_toggle_rpc', 'off', TRUE);
SELECT set_config('app.pilot_pharmacy_verification', 'off', TRUE);
SELECT set_config('app.pharmacy_verification_transition', 'off', TRUE);
SELECT set_config('app.pilot_role_provenance_reset', 'off', TRUE);

ALTER TABLE public.pharmacies
  ALTER COLUMN verification_status SET DEFAULT 'provisional',
  ALTER COLUMN verification_status SET NOT NULL,
  ALTER COLUMN provisional_started_at SET DEFAULT NOW(),
  ALTER COLUMN provisional_started_at SET NOT NULL,
  ALTER COLUMN provisional_expires_at SET DEFAULT (NOW() + INTERVAL '30 days'),
  ALTER COLUMN provisional_expires_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pharmacies'::regclass
      AND conname = 'pharmacies_pcn_registration_number_format'
  ) THEN
    -- NOT VALID keeps an unknown legacy format from aborting the coordinated
    -- rollout, while PostgreSQL still enforces the rule for every new or
    -- changed registration. FULL provisioning also checks it explicitly.
    ALTER TABLE public.pharmacies
      ADD CONSTRAINT pharmacies_pcn_registration_number_format
      CHECK (public.is_plausible_pcn_registration_number(license_number))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pharmacies'::regclass
      AND conname = 'pharmacies_verification_status_check'
  ) THEN
    ALTER TABLE public.pharmacies
      ADD CONSTRAINT pharmacies_verification_status_check
      CHECK (verification_status IN ('provisional', 'full', 'revoked'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pharmacies'::regclass
      AND conname = 'pharmacies_provisional_window_exact'
  ) THEN
    ALTER TABLE public.pharmacies
      ADD CONSTRAINT pharmacies_provisional_window_exact
      CHECK (provisional_expires_at = provisional_started_at + INTERVAL '30 days');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pharmacies'::regclass
      AND conname = 'pharmacies_full_verification_complete'
  ) THEN
    ALTER TABLE public.pharmacies
      ADD CONSTRAINT pharmacies_full_verification_complete CHECK (
        (
          verification_status = 'full'
          AND is_verified = TRUE
          AND verification_authorized_at IS NOT NULL
          AND NULLIF(TRIM(verification_authorization_basis), '') IS NOT NULL
          AND verification_submitted_at IS NOT NULL
          AND pcn_standards_accepted_at IS NOT NULL
          AND NULLIF(TRIM(verification_documents_evidence_basis), '') IS NOT NULL
          AND NULLIF(TRIM(verification_standards_evidence_basis), '') IS NOT NULL
        )
        OR
        (
          verification_status <> 'full'
          AND is_verified = FALSE
          AND verification_authorized_at IS NULL
          AND verification_authorization_basis IS NULL
          AND verification_documents_evidence_basis IS NULL
          AND verification_standards_evidence_basis IS NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pharmacies'::regclass
      AND conname = 'pharmacies_legacy_bootstrap_consumed_for_full'
  ) THEN
    ALTER TABLE public.pharmacies
      ADD CONSTRAINT pharmacies_legacy_bootstrap_consumed_for_full
      CHECK (verification_status <> 'full' OR legacy_verification_bootstrap_eligible = FALSE);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS pharmacies_verification_visibility_idx
  ON public.pharmacies (verification_status, provisional_expires_at)
  WHERE is_active = TRUE;

-- Non-unique by design: unknown live legacy duplicates must not abort this
-- rollout. The registration RPC serializes and rejects any current duplicate.
CREATE INDEX IF NOT EXISTS pharmacies_normalized_pcn_lookup_idx
  ON public.pharmacies (
    public.normalize_pcn_registration_number(license_number)
  );

CREATE OR REPLACE FUNCTION public.pharmacy_verification_is_current(
  p_status TEXT,
  p_provisional_expires_at TIMESTAMPTZ,
  p_is_verified BOOLEAN,
  p_verification_authorized_at TIMESTAMPTZ,
  p_verification_authorization_basis TEXT,
  p_documents_evidence_basis TEXT,
  p_standards_evidence_basis TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_status = 'provisional' THEN
      p_is_verified = FALSE
      AND p_provisional_expires_at IS NOT NULL
      AND p_provisional_expires_at > NOW()
    WHEN p_status = 'full' THEN
      p_is_verified = TRUE
      AND p_verification_authorized_at IS NOT NULL
      AND NULLIF(TRIM(p_verification_authorization_basis), '') IS NOT NULL
      AND NULLIF(TRIM(p_documents_evidence_basis), '') IS NOT NULL
      AND NULLIF(TRIM(p_standards_evidence_basis), '') IS NOT NULL
    ELSE FALSE
END;
$$;

-- A delayed maintenance worker must never let a pharmacy collect a hold after
-- its provisional trust has expired or its verification has been revoked.
-- Enforce this at the reservation state boundary so every POS/API path fails
-- closed independently of cron timing.
CREATE OR REPLACE FUNCTION public.guard_reservation_collection_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'collected' AND OLD.status IS DISTINCT FROM 'collected'
     AND NOT EXISTS (
       SELECT 1
       FROM public.pharmacies ph
       WHERE ph.id = NEW.pharmacy_id
         AND public.pharmacy_verification_is_current(
           ph.verification_status,
           ph.provisional_expires_at,
           ph.is_verified,
           ph.verification_authorized_at,
           ph.verification_authorization_basis,
           ph.verification_documents_evidence_basis,
           ph.verification_standards_evidence_basis
         )
     ) THEN
    RAISE EXCEPTION 'Reservation pickup requires a currently verified pharmacy';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_reservation_collection_verification_trigger
  ON public.reservations;
CREATE TRIGGER guard_reservation_collection_verification_trigger
BEFORE UPDATE OF status ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.guard_reservation_collection_verification();

-- ---------------------------------------------------------------------------
-- Private evidence records and append-only access/audit logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pharmacy_verification_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
  current_standards_version TEXT NOT NULL
    CHECK (LENGTH(TRIM(current_standards_version)) BETWEEN 1 AND 100),
  standards_document_hash TEXT CHECK (
    standards_document_hash IS NULL
    OR standards_document_hash ~ '^[0-9a-f]{64}$'
  ),
  change_basis TEXT NOT NULL CHECK (LENGTH(TRIM(change_basis)) > 0),
  updated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.pharmacy_verification_config (
  singleton, current_standards_version, standards_document_hash, change_basis
) VALUES (
  TRUE, 'pilot-v1', NULL,
  'Initial StocMed pilot pharmacy-verification standards version'
)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.pharmacy_verification_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pharmacy_verification_config
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.pharmacy_verification_config TO authenticated, service_role;
GRANT INSERT, UPDATE ON TABLE public.pharmacy_verification_config TO service_role;

DROP POLICY IF EXISTS pharmacy_verification_config_authenticated_select
  ON public.pharmacy_verification_config;
CREATE POLICY pharmacy_verification_config_authenticated_select
ON public.pharmacy_verification_config
FOR SELECT TO authenticated
USING (singleton = TRUE);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pharmacy-verification-documents',
  'pharmacy-verification-documents',
  FALSE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']::TEXT[]
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.pharmacy_verification_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  submitted_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  premises_certificate_path TEXT NOT NULL,
  superintendent_annual_licence_path TEXT NOT NULL,
  standards_version TEXT NOT NULL CHECK (LENGTH(TRIM(standards_version)) BETWEEN 1 AND 100),
  standards_document_hash TEXT CHECK (
    standards_document_hash IS NULL
    OR standards_document_hash ~ '^[0-9a-f]{64}$'
  ),
  standards_accepted_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pharmacy_verification_submission_distinct_documents CHECK (
    premises_certificate_path <> superintendent_annual_licence_path
  ),
  CONSTRAINT pharmacy_verification_submission_safe_paths CHECK (
    premises_certificate_path !~ '(^|/)\.\.(/|$)'
    AND superintendent_annual_licence_path !~ '(^|/)\.\.(/|$)'
    AND premises_certificate_path ~ '^[0-9a-f-]{36}/[^/]+$'
    AND superintendent_annual_licence_path ~ '^[0-9a-f-]{36}/[^/]+$'
  )
);

CREATE TABLE IF NOT EXISTS public.pharmacy_verification_upload_staging (
  object_path TEXT PRIMARY KEY,
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pharmacy_verification_staging_safe_path CHECK (
    object_path !~ '(^|/)\.\.(/|$)'
    AND object_path ~ '^[0-9a-f-]{36}/[^/]+$'
  )
);

CREATE INDEX IF NOT EXISTS pharmacy_verification_upload_staging_age_idx
  ON public.pharmacy_verification_upload_staging (created_at);

CREATE INDEX IF NOT EXISTS pharmacy_verification_submissions_pharmacy_idx
  ON public.pharmacy_verification_submissions (pharmacy_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.pharmacy_verification_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  submission_id UUID REFERENCES public.pharmacy_verification_submissions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'registered_provisional', 'requirements_submitted', 'full_provisioned',
    'requirements_rejected', 'verification_revoked', 'provisional_expired'
  )),
  basis TEXT NOT NULL CHECK (LENGTH(TRIM(basis)) > 0),
  actor_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pharmacy_verification_audit_pharmacy_idx
  ON public.pharmacy_verification_audit (pharmacy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pharmacy_verification_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.pharmacy_verification_submissions(id) ON DELETE RESTRICT,
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  documents_evidence_basis TEXT,
  standards_evidence_basis TEXT,
  review_basis TEXT NOT NULL CHECK (LENGTH(TRIM(review_basis)) > 0),
  reviewed_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  reviewer_role TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pharmacy_verification_decision_evidence_check CHECK (
    (decision = 'approved'
      AND NULLIF(TRIM(documents_evidence_basis), '') IS NOT NULL
      AND NULLIF(TRIM(standards_evidence_basis), '') IS NOT NULL)
    OR
    (decision = 'rejected'
      AND documents_evidence_basis IS NULL
      AND standards_evidence_basis IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_verification_one_decision_idx
  ON public.pharmacy_verification_decisions (submission_id);
CREATE INDEX IF NOT EXISTS pharmacy_verification_decisions_pharmacy_idx
  ON public.pharmacy_verification_decisions (pharmacy_id, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS public.pharmacy_verification_document_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  submission_id UUID NOT NULL REFERENCES public.pharmacy_verification_submissions(id) ON DELETE RESTRICT,
  viewer_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  viewer_role TEXT NOT NULL,
  document_kind TEXT NOT NULL CHECK (document_kind IN (
    'premises_certificate', 'superintendent_annual_licence'
  )),
  outcome TEXT NOT NULL DEFAULT 'authorized' CHECK (outcome IN ('authorized')),
  request_id TEXT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pharmacy_verification_document_access_idx
  ON public.pharmacy_verification_document_access_logs (submission_id, accessed_at DESC);

ALTER TABLE public.pharmacy_verification_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_verification_upload_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_verification_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_verification_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_verification_document_access_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pharmacy_verification_submissions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.pharmacy_verification_upload_staging
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.pharmacy_verification_audit
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.pharmacy_verification_decisions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.pharmacy_verification_document_access_logs
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.pharmacy_verification_submissions TO authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.pharmacy_verification_upload_staging TO service_role;
GRANT SELECT ON TABLE public.pharmacy_verification_audit TO authenticated, service_role;
GRANT SELECT ON TABLE public.pharmacy_verification_decisions TO authenticated, service_role;
GRANT SELECT ON TABLE public.pharmacy_verification_document_access_logs TO authenticated, service_role;
GRANT INSERT ON TABLE public.pharmacy_verification_submissions TO service_role;
GRANT INSERT ON TABLE public.pharmacy_verification_audit TO service_role;
GRANT INSERT ON TABLE public.pharmacy_verification_decisions TO service_role;
GRANT INSERT ON TABLE public.pharmacy_verification_document_access_logs TO service_role;

DROP POLICY IF EXISTS pharmacy_verification_submission_owner_select
  ON public.pharmacy_verification_submissions;
CREATE POLICY pharmacy_verification_submission_owner_select
ON public.pharmacy_verification_submissions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = pharmacy_verification_submissions.pharmacy_id
      AND ph.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid()
      AND u.is_admin = TRUE
      AND u.admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
  )
);

DROP POLICY IF EXISTS pharmacy_verification_audit_admin_select
  ON public.pharmacy_verification_audit;
CREATE POLICY pharmacy_verification_audit_admin_select
ON public.pharmacy_verification_audit
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = pharmacy_verification_audit.pharmacy_id
      AND ph.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid()
      AND u.is_admin = TRUE
      AND u.admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
  )
);

DROP POLICY IF EXISTS pharmacy_verification_decisions_admin_select
  ON public.pharmacy_verification_decisions;
CREATE POLICY pharmacy_verification_decisions_admin_select
ON public.pharmacy_verification_decisions
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.user_id = auth.uid()
    AND u.is_admin = TRUE
    AND u.admin_authorized_at IS NOT NULL
    AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
));

DROP POLICY IF EXISTS pharmacy_verification_access_log_admin_select
  ON public.pharmacy_verification_document_access_logs;
CREATE POLICY pharmacy_verification_access_log_admin_select
ON public.pharmacy_verification_document_access_logs
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.user_id = auth.uid()
    AND u.is_admin = TRUE
    AND u.admin_authorized_at IS NOT NULL
    AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
));

CREATE OR REPLACE FUNCTION public.prevent_pharmacy_verification_record_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Pharmacy verification evidence and audit records are append-only';
END;
$$;

DROP TRIGGER IF EXISTS pharmacy_verification_submissions_append_only
  ON public.pharmacy_verification_submissions;
CREATE TRIGGER pharmacy_verification_submissions_append_only
BEFORE UPDATE OR DELETE ON public.pharmacy_verification_submissions
FOR EACH ROW EXECUTE FUNCTION public.prevent_pharmacy_verification_record_mutation();

DROP TRIGGER IF EXISTS pharmacy_verification_audit_append_only
  ON public.pharmacy_verification_audit;
CREATE TRIGGER pharmacy_verification_audit_append_only
BEFORE UPDATE OR DELETE ON public.pharmacy_verification_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_pharmacy_verification_record_mutation();

DROP TRIGGER IF EXISTS pharmacy_verification_decisions_append_only
  ON public.pharmacy_verification_decisions;
CREATE TRIGGER pharmacy_verification_decisions_append_only
BEFORE UPDATE OR DELETE ON public.pharmacy_verification_decisions
FOR EACH ROW EXECUTE FUNCTION public.prevent_pharmacy_verification_record_mutation();

DROP TRIGGER IF EXISTS pharmacy_verification_access_log_append_only
  ON public.pharmacy_verification_document_access_logs;
CREATE TRIGGER pharmacy_verification_access_log_append_only
BEFORE UPDATE OR DELETE ON public.pharmacy_verification_document_access_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_pharmacy_verification_record_mutation();

-- No direct browser policy exists for this private bucket. Uploads, cleanup,
-- and signed reads go through authenticated server routes using service access;
-- each admin read must first call the logging authorization RPC below.
DROP POLICY IF EXISTS pharmacy_verification_documents_select ON storage.objects;
DROP POLICY IF EXISTS pharmacy_verification_documents_insert ON storage.objects;
DROP POLICY IF EXISTS pharmacy_verification_documents_update ON storage.objects;
DROP POLICY IF EXISTS pharmacy_verification_documents_delete ON storage.objects;

-- ---------------------------------------------------------------------------
-- Guarded registration, evidence submission, and service decisions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_pharmacy_verification_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registration_rpc BOOLEAN :=
    current_setting('app.pharmacy_registration_rpc', TRUE) = 'on';
  v_requirements_rpc BOOLEAN :=
    current_setting('app.pharmacy_verification_requirements_rpc', TRUE) = 'on';
  v_transition_rpc BOOLEAN :=
    current_setting('app.pharmacy_verification_transition', TRUE) = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(auth.role(), '') IN ('anon', 'authenticated')
       AND NOT v_registration_rpc THEN
      RAISE EXCEPTION 'Pharmacies must register through the provisional registration RPC';
    END IF;

    NEW.license_number := public.normalize_pcn_registration_number(NEW.license_number);
    IF NOT public.is_plausible_pcn_registration_number(NEW.license_number) THEN
      RAISE EXCEPTION 'PCN premises number format is invalid';
    END IF;

    -- A caller cannot backdate registration to extend or evade the deadline.
    NEW.created_at := NOW();
    NEW.updated_at := NOW();
    NEW.verification_status := 'provisional';
    NEW.provisional_started_at := NEW.created_at;
    NEW.provisional_expires_at := NEW.created_at + INTERVAL '30 days';
    NEW.verification_submitted_at := NULL;
    NEW.pcn_standards_accepted_at := NULL;
    NEW.verification_documents_evidence_basis := NULL;
    NEW.verification_standards_evidence_basis := NULL;
    NEW.legacy_verification_bootstrap_eligible := FALSE;
    NEW.is_verified := FALSE;
    NEW.verification_authorized_at := NULL;
    NEW.verification_authorization_basis := NULL;
    NEW.reservations_enabled := FALSE;
    RETURN NEW;
  END IF;

  IF NEW.license_number IS DISTINCT FROM OLD.license_number THEN
    NEW.license_number := public.normalize_pcn_registration_number(NEW.license_number);
    IF NOT public.is_plausible_pcn_registration_number(NEW.license_number) THEN
      RAISE EXCEPTION 'PCN premises number format is invalid';
    END IF;
  END IF;

  IF (
    NEW.verification_status IS DISTINCT FROM OLD.verification_status
    OR NEW.provisional_started_at IS DISTINCT FROM OLD.provisional_started_at
    OR NEW.provisional_expires_at IS DISTINCT FROM OLD.provisional_expires_at
    OR NEW.verification_documents_evidence_basis
      IS DISTINCT FROM OLD.verification_documents_evidence_basis
    OR NEW.verification_standards_evidence_basis
      IS DISTINCT FROM OLD.verification_standards_evidence_basis
    OR NEW.legacy_verification_bootstrap_eligible
      IS DISTINCT FROM OLD.legacy_verification_bootstrap_eligible
  ) AND NOT v_transition_rpc THEN
    RAISE EXCEPTION 'Verification status can only change through the service verification RPC';
  END IF;

  IF (
    NEW.verification_submitted_at IS DISTINCT FROM OLD.verification_submitted_at
    OR NEW.pcn_standards_accepted_at IS DISTINCT FROM OLD.pcn_standards_accepted_at
  ) AND NOT (v_requirements_rpc OR v_transition_rpc) THEN
    RAISE EXCEPTION 'Verification evidence can only be recorded through the submission RPC';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_pharmacy_verification_lifecycle_trigger
  ON public.pharmacies;
CREATE TRIGGER guard_pharmacy_verification_lifecycle_trigger
BEFORE INSERT OR UPDATE ON public.pharmacies
FOR EACH ROW EXECUTE FUNCTION public.guard_pharmacy_verification_lifecycle();

CREATE OR REPLACE FUNCTION public.register_provisional_pharmacy(
  p_pharmacy_name TEXT,
  p_license_number TEXT,
  p_address TEXT,
  p_city TEXT,
  p_state TEXT,
  p_phone TEXT
)
RETURNS public.pharmacies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result public.pharmacies;
  v_license TEXT := public.normalize_pcn_registration_number(p_license_number);
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid() AND u.role = 'pharmacy'
  ) THEN
    RAISE EXCEPTION 'A pharmacy user profile is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pharmacies ph WHERE ph.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'This account already has a pharmacy registration';
  END IF;
  IF NOT public.is_plausible_pcn_registration_number(v_license) THEN
    RAISE EXCEPTION 'PCN premises number format is invalid';
  END IF;

  -- A premises number receives one registration lifecycle. Expiry is not a
  -- way to mint another thirty-day visibility window under a new account.
  PERFORM pg_advisory_xact_lock(hashtext(v_license));
  IF EXISTS (
    SELECT 1 FROM public.pharmacies existing
    WHERE public.normalize_pcn_registration_number(existing.license_number) = v_license
  ) THEN
    RAISE EXCEPTION 'This PCN premises number already has a registration';
  END IF;
  IF NULLIF(TRIM(p_pharmacy_name), '') IS NULL
     OR NULLIF(TRIM(p_address), '') IS NULL
     OR NULLIF(TRIM(p_city), '') IS NULL
     OR NULLIF(TRIM(p_state), '') IS NULL
     OR NULLIF(TRIM(p_phone), '') IS NULL THEN
    RAISE EXCEPTION 'Pharmacy name, address, city, state, and phone are required';
  END IF;

  PERFORM set_config('app.pharmacy_registration_rpc', 'on', TRUE);
  INSERT INTO public.pharmacies (
    user_id, pharmacy_name, license_number, address, city, state, phone,
    is_verified, is_active, reservations_enabled
  ) VALUES (
    auth.uid(), TRIM(p_pharmacy_name), v_license, TRIM(p_address),
    TRIM(p_city), TRIM(p_state), TRIM(p_phone), FALSE, TRUE, FALSE
  ) RETURNING * INTO v_result;
  PERFORM set_config('app.pharmacy_registration_rpc', 'off', TRUE);

  INSERT INTO public.pharmacy_verification_audit (
    pharmacy_id, action, basis, actor_user_id, actor_role
  ) VALUES (
    v_result.id, 'registered_provisional',
    'Format-plausible PCN premises number accepted; verification evidence pending',
    auth.uid(), auth.role()
  );

  RETURN v_result;
END;
$$;

-- The SECURITY DEFINER registration RPC above is the only authenticated
-- creation path. Keeping an INSERT policy without table privilege cannot be
-- used as a shadow registration bypass.
REVOKE INSERT ON TABLE public.pharmacies FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.submit_pharmacy_verification_requirements(
  p_document_reference TEXT,
  p_standards_version TEXT,
  p_agree_to_standards BOOLEAN
)
RETURNS public.pharmacies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy public.pharmacies;
  v_documents JSONB;
  v_premises_path TEXT;
  v_superintendent_path TEXT;
  v_submission public.pharmacy_verification_submissions;
  v_current_standards_version TEXT;
  v_current_standards_hash TEXT;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_agree_to_standards IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'The current StocMed PCN standards must be accepted';
  END IF;
  IF NULLIF(TRIM(p_standards_version), '') IS NULL
     OR LENGTH(TRIM(p_standards_version)) > 100 THEN
    RAISE EXCEPTION 'A valid standards version is required';
  END IF;

  SELECT * INTO v_pharmacy
  FROM public.pharmacies ph
  WHERE ph.user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy profile not found'; END IF;
  IF v_pharmacy.verification_status = 'full' THEN
    RAISE EXCEPTION 'This pharmacy is already fully verified';
  END IF;
  IF v_pharmacy.verification_status <> 'provisional'
     OR v_pharmacy.provisional_expires_at <= NOW() THEN
    RAISE EXCEPTION 'The thirty-day provisional verification window has expired';
  END IF;

  SELECT config.current_standards_version, config.standards_document_hash
  INTO v_current_standards_version, v_current_standards_hash
  FROM public.pharmacy_verification_config config
  WHERE config.singleton = TRUE;
  IF v_current_standards_version IS NULL
     OR TRIM(p_standards_version) IS DISTINCT FROM v_current_standards_version THEN
    RAISE EXCEPTION 'The current StocMed PCN standards version must be accepted';
  END IF;

  BEGIN
    v_documents := p_document_reference::JSONB;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Document reference must be valid JSON';
  END;
  IF JSONB_TYPEOF(v_documents) <> 'object' THEN
    RAISE EXCEPTION 'Document reference must be a JSON object';
  END IF;

  v_premises_path := NULLIF(TRIM(v_documents ->> 'premises_certificate'), '');
  v_superintendent_path := NULLIF(TRIM(
    v_documents ->> 'superintendent_annual_licence'
  ), '');
  IF v_premises_path IS NULL OR v_superintendent_path IS NULL THEN
    RAISE EXCEPTION 'Both the PCN premises certificate and superintendent annual licence are required';
  END IF;
  IF v_premises_path = v_superintendent_path
     OR v_premises_path !~ ('^' || v_pharmacy.id::TEXT || '/[^/]+$')
     OR v_superintendent_path !~ ('^' || v_pharmacy.id::TEXT || '/[^/]+$')
     OR v_premises_path ~ '(^|/)\.\.(/|$)'
     OR v_superintendent_path ~ '(^|/)\.\.(/|$)' THEN
    RAISE EXCEPTION 'Verification document paths must be distinct objects owned by this pharmacy';
  END IF;
  IF (
    SELECT COUNT(*)
    FROM public.pharmacy_verification_upload_staging staging
    WHERE staging.pharmacy_id = v_pharmacy.id
      AND staging.object_path IN (v_premises_path, v_superintendent_path)
  ) <> 2 THEN
    RAISE EXCEPTION 'Both verification uploads must be registered by the secure staging path';
  END IF;

  INSERT INTO public.pharmacy_verification_submissions (
    pharmacy_id, submitted_by, premises_certificate_path,
    superintendent_annual_licence_path, standards_version,
    standards_document_hash, standards_accepted_at
  ) VALUES (
    v_pharmacy.id, auth.uid(), v_premises_path, v_superintendent_path,
    TRIM(p_standards_version), v_current_standards_hash, NOW()
  ) RETURNING * INTO v_submission;

  DELETE FROM public.pharmacy_verification_upload_staging staging
  WHERE staging.pharmacy_id = v_pharmacy.id
    AND staging.object_path IN (v_premises_path, v_superintendent_path);

  PERFORM set_config('app.pharmacy_verification_requirements_rpc', 'on', TRUE);
  UPDATE public.pharmacies
  SET verification_submitted_at = v_submission.submitted_at,
      pcn_standards_accepted_at = v_submission.standards_accepted_at,
      updated_at = NOW()
  WHERE id = v_pharmacy.id
  RETURNING * INTO v_pharmacy;
  PERFORM set_config('app.pharmacy_verification_requirements_rpc', 'off', TRUE);

  INSERT INTO public.pharmacy_verification_audit (
    pharmacy_id, submission_id, action, basis, actor_user_id, actor_role
  ) VALUES (
    v_pharmacy.id, v_submission.id, 'requirements_submitted',
    'Two private PCN evidence objects submitted; standards version ' ||
      TRIM(p_standards_version) || ' accepted',
    auth.uid(), auth.role()
  );

  RETURN v_pharmacy;
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_full_pharmacy_verification(
  p_pharmacy_id UUID,
  p_documents_evidence_basis TEXT,
  p_standards_evidence_basis TEXT,
  p_authorizing_admin_id UUID
)
RETURNS public.pharmacies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy public.pharmacies;
  v_submission public.pharmacy_verification_submissions;
  v_documents_basis TEXT := NULLIF(TRIM(p_documents_evidence_basis), '');
  v_standards_basis TEXT := NULLIF(TRIM(p_standards_evidence_basis), '');
  v_combined_basis TEXT;
  v_license TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only the service role can fully verify pilot pharmacies';
  END IF;
  IF v_documents_basis IS NULL OR v_standards_basis IS NULL THEN
    RAISE EXCEPTION 'Nonblank document-review and standards-agreement evidence are required';
  END IF;
  IF p_authorizing_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = p_authorizing_admin_id
      AND u.is_admin = TRUE
      AND u.admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The accountable authorizing administrator is not provenance-authorized';
  END IF;

  SELECT * INTO v_pharmacy
  FROM public.pharmacies ph
  WHERE ph.id = p_pharmacy_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy profile not found'; END IF;
  IF NOT public.is_plausible_pcn_registration_number(v_pharmacy.license_number) THEN
    RAISE EXCEPTION 'The pharmacy PCN premises number does not pass format validation';
  END IF;
  IF v_pharmacy.verification_status NOT IN ('provisional', 'revoked') THEN
    RAISE EXCEPTION 'Only a provisional or revoked pharmacy can be promoted to FULL verification';
  END IF;
  v_license := public.normalize_pcn_registration_number(v_pharmacy.license_number);
  PERFORM pg_advisory_xact_lock(hashtext(v_license));
  IF EXISTS (
    SELECT 1
    FROM public.pharmacies duplicate
    WHERE duplicate.id <> p_pharmacy_id
      AND public.normalize_pcn_registration_number(duplicate.license_number) = v_license
      AND (
        duplicate.verification_status = 'full'
        OR (
          duplicate.verification_status = 'provisional'
          AND duplicate.provisional_expires_at > NOW()
        )
      )
  ) THEN
    RAISE EXCEPTION 'Another current pharmacy registration already uses this PCN premises number';
  END IF;

  SELECT * INTO v_submission
  FROM public.pharmacy_verification_submissions submission
  WHERE submission.pharmacy_id = p_pharmacy_id
    AND submission.premises_certificate_path ~ ('^' || p_pharmacy_id::TEXT || '/[^/]+$')
    AND submission.superintendent_annual_licence_path ~ ('^' || p_pharmacy_id::TEXT || '/[^/]+$')
    AND submission.standards_accepted_at IS NOT NULL
    AND NULLIF(TRIM(submission.standards_version), '') IS NOT NULL
    AND submission.submitted_at <= v_pharmacy.provisional_expires_at
    AND submission.standards_version = (
      SELECT config.current_standards_version
      FROM public.pharmacy_verification_config config
      WHERE config.singleton = TRUE
    )
    AND submission.standards_document_hash IS NOT DISTINCT FROM (
      SELECT config.standards_document_hash
      FROM public.pharmacy_verification_config config
      WHERE config.singleton = TRUE
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.pharmacy_verification_decisions decision
      WHERE decision.submission_id = submission.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.pharmacy_verification_submissions newer
      WHERE newer.pharmacy_id = submission.pharmacy_id
        AND (
          newer.submitted_at > submission.submitted_at
          OR (
            newer.submitted_at = submission.submitted_at
            AND newer.id > submission.id
          )
        )
    )
  ORDER BY submission.submitted_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A complete current verification submission is required';
  END IF;

  IF (
    SELECT COUNT(DISTINCT evidence.name)
    FROM storage.objects evidence
    JOIN storage.buckets bucket ON bucket.id = evidence.bucket_id
    WHERE bucket.id = 'pharmacy-verification-documents'
      AND bucket.public = FALSE
      AND evidence.name IN (
        v_submission.premises_certificate_path,
        v_submission.superintendent_annual_licence_path
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'Both private verification evidence objects must exist before approval';
  END IF;

  IF (
    SELECT COUNT(DISTINCT access_log.document_kind)
    FROM public.pharmacy_verification_document_access_logs access_log
    WHERE access_log.submission_id = v_submission.id
      AND access_log.viewer_user_id = p_authorizing_admin_id
      AND access_log.outcome = 'authorized'
      AND access_log.document_kind IN (
        'premises_certificate', 'superintendent_annual_licence'
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'The accountable administrator must open both evidence documents through the logged review flow';
  END IF;

  v_combined_basis := 'Documents: ' || v_documents_basis ||
    '; PCN standards: ' || v_standards_basis;

  PERFORM set_config('app.pharmacy_verification_transition', 'on', TRUE);
  PERFORM set_config('app.pilot_pharmacy_verification', 'on', TRUE);
  UPDATE public.pharmacies
  SET verification_status = 'full',
      is_verified = TRUE,
      verification_authorized_at = NOW(),
      verification_authorization_basis = v_combined_basis,
      verification_documents_evidence_basis = v_documents_basis,
      verification_standards_evidence_basis = v_standards_basis,
      legacy_verification_bootstrap_eligible = FALSE,
      verification_submitted_at = v_submission.submitted_at,
      pcn_standards_accepted_at = v_submission.standards_accepted_at,
      updated_at = NOW()
  WHERE id = p_pharmacy_id
  RETURNING * INTO v_pharmacy;
  PERFORM set_config('app.pilot_pharmacy_verification', 'off', TRUE);
  PERFORM set_config('app.pharmacy_verification_transition', 'off', TRUE);

  INSERT INTO public.pilot_provisioning_audit (
    target_pharmacy_id, capability, action, basis, provisioned_by, provisioner_role
  ) VALUES (
    p_pharmacy_id, 'pharmacy_verification', 'provision', v_combined_basis,
    p_authorizing_admin_id, auth.role()
  );
  INSERT INTO public.pharmacy_verification_decisions (
    submission_id, pharmacy_id, decision, documents_evidence_basis,
    standards_evidence_basis, review_basis, reviewed_by, reviewer_role
  ) VALUES (
    v_submission.id, p_pharmacy_id, 'approved', v_documents_basis,
    v_standards_basis, v_combined_basis,
    p_authorizing_admin_id, auth.role()
  );
  INSERT INTO public.pharmacy_verification_audit (
    pharmacy_id, submission_id, action, basis, actor_user_id, actor_role
  ) VALUES (
    p_pharmacy_id, v_submission.id, 'full_provisioned', v_combined_basis,
    p_authorizing_admin_id, auth.role()
  );

  RETURN v_pharmacy;
END;
$$;

-- One coordinated-rollout bridge for pharmacies that predate this migration.
-- Eligibility is stamped only by the migration-time reset, is FALSE for every
-- later registration, and is consumed atomically on success. This is not a
-- general alternative to the normal submission and review flow.
CREATE OR REPLACE FUNCTION public.bootstrap_legacy_full_pharmacy_verification(
  p_pharmacy_id UUID,
  p_premises_certificate_path TEXT,
  p_superintendent_annual_licence_path TEXT,
  p_standards_version TEXT,
  p_standards_document_hash TEXT,
  p_standards_accepted_at TIMESTAMPTZ,
  p_documents_evidence_basis TEXT,
  p_standards_evidence_basis TEXT,
  p_bootstrap_basis TEXT,
  p_authorizing_admin_id UUID
)
RETURNS public.pharmacies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy public.pharmacies;
  v_submission public.pharmacy_verification_submissions;
  v_current_standards_version TEXT;
  v_current_standards_hash TEXT;
  v_premises_path TEXT := NULLIF(TRIM(p_premises_certificate_path), '');
  v_superintendent_path TEXT := NULLIF(TRIM(p_superintendent_annual_licence_path), '');
  v_documents_basis TEXT := NULLIF(TRIM(p_documents_evidence_basis), '');
  v_standards_basis TEXT := NULLIF(TRIM(p_standards_evidence_basis), '');
  v_bootstrap_basis TEXT := NULLIF(TRIM(p_bootstrap_basis), '');
  v_supplied_hash TEXT := LOWER(NULLIF(TRIM(p_standards_document_hash), ''));
  v_license TEXT;
  v_combined_basis TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only the service role can bootstrap legacy pharmacy verification';
  END IF;
  IF v_premises_path IS NULL OR v_superintendent_path IS NULL
     OR v_documents_basis IS NULL OR v_standards_basis IS NULL
     OR v_bootstrap_basis IS NULL THEN
    RAISE EXCEPTION 'Both evidence objects and nonblank document, standards, and bootstrap bases are required';
  END IF;
  IF p_standards_accepted_at IS NULL OR p_standards_accepted_at > NOW() THEN
    RAISE EXCEPTION 'A non-future standards acceptance timestamp is required';
  END IF;
  IF v_supplied_hash IS NULL OR v_supplied_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A valid SHA-256 standards document hash is required';
  END IF;
  IF p_authorizing_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users admin_user
    WHERE admin_user.user_id = p_authorizing_admin_id
      AND admin_user.is_admin = TRUE
      AND admin_user.admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(admin_user.admin_authorization_basis), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The accountable authorizing administrator is not provenance-authorized';
  END IF;

  SELECT * INTO v_pharmacy
  FROM public.pharmacies ph
  WHERE ph.id = p_pharmacy_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy profile not found'; END IF;
  IF v_pharmacy.legacy_verification_bootstrap_eligible IS DISTINCT FROM TRUE
     OR v_pharmacy.verification_status NOT IN ('provisional', 'revoked')
     OR v_pharmacy.provisional_expires_at <= NOW() THEN
    RAISE EXCEPTION 'This pharmacy is not eligible for the in-window legacy verification bootstrap';
  END IF;
  IF p_standards_accepted_at < v_pharmacy.provisional_started_at
     OR p_standards_accepted_at > v_pharmacy.provisional_expires_at THEN
    RAISE EXCEPTION 'Standards acceptance must occur during the migration-time provisional window';
  END IF;
  IF NOT public.is_plausible_pcn_registration_number(v_pharmacy.license_number) THEN
    RAISE EXCEPTION 'Legacy bootstrap requires a valid PCN premises number';
  END IF;
  v_license := public.normalize_pcn_registration_number(v_pharmacy.license_number);
  PERFORM pg_advisory_xact_lock(hashtext(v_license));
  IF EXISTS (
    SELECT 1
    FROM public.pharmacies duplicate
    WHERE duplicate.id <> p_pharmacy_id
      AND public.normalize_pcn_registration_number(duplicate.license_number) = v_license
      AND (
        duplicate.verification_status = 'full'
        OR (
          duplicate.verification_status = 'provisional'
          AND duplicate.provisional_expires_at > NOW()
        )
      )
  ) THEN
    RAISE EXCEPTION 'Another current pharmacy registration already uses this PCN premises number';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pharmacy_verification_submissions existing
    WHERE existing.pharmacy_id = p_pharmacy_id
  ) THEN
    RAISE EXCEPTION 'Legacy bootstrap is only available before the first verification submission';
  END IF;

  SELECT config.current_standards_version, config.standards_document_hash
  INTO v_current_standards_version, v_current_standards_hash
  FROM public.pharmacy_verification_config config
  WHERE config.singleton = TRUE;
  IF v_current_standards_hash IS NULL
     OR TRIM(p_standards_version) IS DISTINCT FROM v_current_standards_version
     OR v_supplied_hash IS DISTINCT FROM v_current_standards_hash THEN
    RAISE EXCEPTION 'The current StocMed standards version and SHA-256 hash must be accepted';
  END IF;

  IF v_premises_path = v_superintendent_path
     OR v_premises_path !~ ('^' || p_pharmacy_id::TEXT || '/[^/]+$')
     OR v_superintendent_path !~ ('^' || p_pharmacy_id::TEXT || '/[^/]+$')
     OR v_premises_path ~ '(^|/)\.\.(/|$)'
     OR v_superintendent_path ~ '(^|/)\.\.(/|$)' THEN
    RAISE EXCEPTION 'Verification document paths must be distinct objects owned by this pharmacy';
  END IF;
  IF (
    SELECT COUNT(DISTINCT evidence.name)
    FROM storage.objects evidence
    JOIN storage.buckets bucket ON bucket.id = evidence.bucket_id
    WHERE bucket.id = 'pharmacy-verification-documents'
      AND bucket.public = FALSE
      AND evidence.name IN (v_premises_path, v_superintendent_path)
  ) <> 2 THEN
    RAISE EXCEPTION 'Both private verification evidence objects must exist before legacy bootstrap';
  END IF;

  INSERT INTO public.pharmacy_verification_submissions (
    pharmacy_id, submitted_by, premises_certificate_path,
    superintendent_annual_licence_path, standards_version,
    standards_document_hash, standards_accepted_at, submitted_at
  ) VALUES (
    v_pharmacy.id, v_pharmacy.user_id, v_premises_path,
    v_superintendent_path, v_current_standards_version,
    v_current_standards_hash, p_standards_accepted_at, NOW()
  ) RETURNING * INTO v_submission;

  INSERT INTO public.pharmacy_verification_document_access_logs (
    pharmacy_id, submission_id, viewer_user_id, viewer_role,
    document_kind, outcome, request_id
  ) VALUES
    (v_pharmacy.id, v_submission.id, p_authorizing_admin_id,
      'legacy_bootstrap_admin', 'premises_certificate', 'authorized',
      'legacy-bootstrap:' || v_submission.id::TEXT),
    (v_pharmacy.id, v_submission.id, p_authorizing_admin_id,
      'legacy_bootstrap_admin', 'superintendent_annual_licence', 'authorized',
      'legacy-bootstrap:' || v_submission.id::TEXT);

  v_combined_basis := 'Legacy bootstrap: ' || v_bootstrap_basis ||
    '; Documents: ' || v_documents_basis ||
    '; PCN standards: ' || v_standards_basis;

  PERFORM set_config('app.pharmacy_verification_transition', 'on', TRUE);
  PERFORM set_config('app.pilot_pharmacy_verification', 'on', TRUE);
  UPDATE public.pharmacies
  SET verification_status = 'full',
      is_verified = TRUE,
      verification_authorized_at = NOW(),
      verification_authorization_basis = v_combined_basis,
      verification_documents_evidence_basis = v_documents_basis,
      verification_standards_evidence_basis = v_standards_basis,
      verification_submitted_at = v_submission.submitted_at,
      pcn_standards_accepted_at = v_submission.standards_accepted_at,
      legacy_verification_bootstrap_eligible = FALSE,
      updated_at = NOW()
  WHERE id = p_pharmacy_id
  RETURNING * INTO v_pharmacy;
  PERFORM set_config('app.pilot_pharmacy_verification', 'off', TRUE);
  PERFORM set_config('app.pharmacy_verification_transition', 'off', TRUE);

  INSERT INTO public.pilot_provisioning_audit (
    target_pharmacy_id, capability, action, basis, provisioned_by, provisioner_role
  ) VALUES (
    p_pharmacy_id, 'pharmacy_verification', 'provision', v_combined_basis,
    p_authorizing_admin_id, 'service_role_legacy_bootstrap'
  );
  INSERT INTO public.pharmacy_verification_decisions (
    submission_id, pharmacy_id, decision, documents_evidence_basis,
    standards_evidence_basis, review_basis, reviewed_by, reviewer_role
  ) VALUES (
    v_submission.id, p_pharmacy_id, 'approved', v_documents_basis,
    v_standards_basis, v_combined_basis, p_authorizing_admin_id,
    'service_role_legacy_bootstrap'
  );
  INSERT INTO public.pharmacy_verification_audit (
    pharmacy_id, submission_id, action, basis, actor_user_id, actor_role
  ) VALUES (
    p_pharmacy_id, v_submission.id, 'full_provisioned', v_combined_basis,
    p_authorizing_admin_id, 'service_role_legacy_bootstrap'
  );

  RETURN v_pharmacy;
END;
$$;

-- Keep the old service RPC only as an explicit revocation path. A caller can
-- no longer manufacture FULL status without the two evidence decisions above.
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
    RAISE EXCEPTION 'Only the service role can revoke pilot pharmacy verification';
  END IF;
  IF p_verified IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Use provision_full_pharmacy_verification for FULL status';
  END IF;
  IF v_basis IS NULL THEN RAISE EXCEPTION 'A nonblank revocation basis is required'; END IF;

  SELECT * INTO v_pharmacy FROM public.pharmacies
  WHERE id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy profile not found'; END IF;
  -- Trust revocation is fail-closed and cannot wait for a clinical queue.
  -- Pending digital requests are administratively cancelled; this is not a
  -- dispensing decision and therefore has no clinical reviewer/source.
  UPDATE public.rx_submissions
  SET status = 'rejected',
      reviewed_by = NULL,
      reviewed_at = NOW(),
      review_notes = 'Digital request cancelled because destination pharmacy verification was revoked: ' || v_basis,
      clinical_review_source = NULL,
      dispensing_authorized = FALSE,
      updated_at = NOW()
  WHERE destination_pharmacy_id = p_pharmacy_id
    AND status IN ('submitted', 'under_review');

  UPDATE public.reservations
  SET status = 'cancelled', cancelled_at = NOW(),
      cancellation_reason = 'Pharmacy verification revoked'
  WHERE pharmacy_id = p_pharmacy_id
    AND status = 'active' AND expires_at > NOW();

  PERFORM set_config('app.pharmacy_verification_transition', 'on', TRUE);
  PERFORM set_config('app.pilot_pharmacy_verification', 'on', TRUE);
  PERFORM set_config('app.reservation_toggle_rpc', 'on', TRUE);
  UPDATE public.pharmacies
  SET verification_status = 'revoked',
      is_verified = FALSE,
      verification_authorized_at = NULL,
      verification_authorization_basis = NULL,
      verification_documents_evidence_basis = NULL,
      verification_standards_evidence_basis = NULL,
      reservations_enabled = FALSE,
      updated_at = NOW()
  WHERE id = p_pharmacy_id
  RETURNING * INTO v_pharmacy;
  PERFORM set_config('app.reservation_toggle_rpc', 'off', TRUE);
  PERFORM set_config('app.pilot_pharmacy_verification', 'off', TRUE);
  PERFORM set_config('app.pharmacy_verification_transition', 'off', TRUE);

  INSERT INTO public.pilot_provisioning_audit (
    target_pharmacy_id, capability, action, basis, provisioned_by, provisioner_role
  ) VALUES (
    p_pharmacy_id, 'pharmacy_verification', 'revoke', v_basis,
    auth.uid(), auth.role()
  );
  INSERT INTO public.pharmacy_verification_audit (
    pharmacy_id, action, basis, actor_user_id, actor_role
  ) VALUES (
    p_pharmacy_id, 'verification_revoked', v_basis, auth.uid(), auth.role()
  );

  RETURN v_pharmacy;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_pharmacy_verification_submission(
  p_submission_id UUID,
  p_basis TEXT,
  p_authorizing_admin_id UUID
)
RETURNS public.pharmacies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.pharmacy_verification_submissions;
  v_pharmacy public.pharmacies;
  v_basis TEXT := NULLIF(TRIM(p_basis), '');
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only the service role can reject pharmacy verification evidence';
  END IF;
  IF v_basis IS NULL THEN RAISE EXCEPTION 'A nonblank rejection basis is required'; END IF;
  IF p_authorizing_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = p_authorizing_admin_id
      AND u.is_admin = TRUE
      AND u.admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The accountable authorizing administrator is not provenance-authorized';
  END IF;

  SELECT * INTO v_submission
  FROM public.pharmacy_verification_submissions submission
  WHERE submission.id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verification submission not found'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.pharmacy_verification_decisions decision
    WHERE decision.submission_id = p_submission_id
  ) THEN
    RAISE EXCEPTION 'This verification submission has already been decided';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pharmacy_verification_submissions newer
    WHERE newer.pharmacy_id = v_submission.pharmacy_id
      AND (
        newer.submitted_at > v_submission.submitted_at
        OR (newer.submitted_at = v_submission.submitted_at AND newer.id > v_submission.id)
      )
  ) THEN
    RAISE EXCEPTION 'Only the latest verification submission can be decided';
  END IF;

  SELECT * INTO v_pharmacy FROM public.pharmacies ph
  WHERE ph.id = v_submission.pharmacy_id FOR UPDATE;
  IF v_pharmacy.verification_status = 'full' THEN
    RAISE EXCEPTION 'Revoke FULL verification through the explicit revocation RPC';
  END IF;

  UPDATE public.reservations
  SET status = 'cancelled', cancelled_at = NOW(),
      cancellation_reason = 'Pharmacy verification evidence rejected'
  WHERE pharmacy_id = v_pharmacy.id
    AND status = 'active' AND expires_at > NOW();

  PERFORM set_config('app.pharmacy_verification_transition', 'on', TRUE);
  PERFORM set_config('app.reservation_toggle_rpc', 'on', TRUE);
  UPDATE public.pharmacies
  SET verification_status = 'revoked', reservations_enabled = FALSE,
      updated_at = NOW()
  WHERE id = v_pharmacy.id
  RETURNING * INTO v_pharmacy;
  PERFORM set_config('app.reservation_toggle_rpc', 'off', TRUE);
  PERFORM set_config('app.pharmacy_verification_transition', 'off', TRUE);

  INSERT INTO public.pharmacy_verification_decisions (
    submission_id, pharmacy_id, decision, review_basis, reviewed_by, reviewer_role
  ) VALUES (
    v_submission.id, v_pharmacy.id, 'rejected', v_basis,
    p_authorizing_admin_id, auth.role()
  );
  INSERT INTO public.pharmacy_verification_audit (
    pharmacy_id, submission_id, action, basis, actor_user_id, actor_role
  ) VALUES (
    v_pharmacy.id, v_submission.id, 'requirements_rejected', v_basis,
    p_authorizing_admin_id, auth.role()
  );

  RETURN v_pharmacy;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pharmacy_verification_queue()
RETURNS TABLE (
  id UUID,
  pharmacy_id UUID,
  pharmacy_name TEXT,
  license_number TEXT,
  pharmacy_verification_status TEXT,
  provisional_expires_at TIMESTAMPTZ,
  submitted_by UUID,
  premises_certificate_path TEXT,
  superintendent_annual_licence_path TEXT,
  standards_version TEXT,
  standards_accepted_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  status TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  review_basis TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid()
      AND u.is_admin = TRUE
      AND u.admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Only a provenance-authorized administrator can view the verification queue';
  END IF;

  RETURN QUERY
  SELECT latest.id, latest.pharmacy_id, ph.pharmacy_name, ph.license_number,
    ph.verification_status, ph.provisional_expires_at, latest.submitted_by,
    latest.premises_certificate_path, latest.superintendent_annual_licence_path,
    latest.standards_version, latest.standards_accepted_at, latest.submitted_at,
    COALESCE(decision.decision, 'submitted') AS status,
    decision.reviewed_at, decision.reviewed_by, decision.review_basis
  FROM (
    SELECT DISTINCT ON (submission.pharmacy_id) submission.*
    FROM public.pharmacy_verification_submissions submission
    ORDER BY submission.pharmacy_id, submission.submitted_at DESC, submission.id DESC
  ) latest
  JOIN public.pharmacies ph ON ph.id = latest.pharmacy_id
  LEFT JOIN public.pharmacy_verification_decisions decision
    ON decision.submission_id = latest.id
  ORDER BY
    (decision.id IS NULL) DESC,
    latest.submitted_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_provisional_pharmacies()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_expired_ids UUID[];
BEGIN
  -- Visibility itself fails closed at provisional_expires_at, independent of
  -- cron timing. This maintenance function records the transition, disables
  -- opt-in, and releases all outstanding provisional OTC holds.
  SELECT ARRAY_AGG(expired.id) INTO v_expired_ids
  FROM (
    SELECT ph.id
    FROM public.pharmacies ph
    WHERE ph.verification_status = 'provisional'
      AND ph.provisional_expires_at <= NOW()
    FOR UPDATE
  ) expired;

  IF COALESCE(CARDINALITY(v_expired_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.reservations r
  SET status = 'cancelled', cancelled_at = NOW(),
      cancellation_reason = 'Provisional pharmacy verification window expired'
  WHERE r.pharmacy_id = ANY(v_expired_ids)
    AND r.status = 'active' AND r.expires_at > NOW();

  PERFORM set_config('app.pharmacy_verification_transition', 'on', TRUE);
  PERFORM set_config('app.reservation_toggle_rpc', 'on', TRUE);
  UPDATE public.pharmacies ph
  SET verification_status = 'revoked', reservations_enabled = FALSE,
      updated_at = NOW()
  WHERE ph.id = ANY(v_expired_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.reservation_toggle_rpc', 'off', TRUE);
  PERFORM set_config('app.pharmacy_verification_transition', 'off', TRUE);

  INSERT INTO public.pharmacy_verification_audit (
    pharmacy_id, action, basis, actor_user_id, actor_role
  )
  SELECT expired.id, 'provisional_expired',
    'Automatic thirty-day provisional visibility deadline reached',
    NULL, 'scheduled_maintenance'
  FROM UNNEST(v_expired_ids) AS expired(id);

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_and_log_pharmacy_verification_document_access(
  p_submission_id UUID,
  p_document_kind TEXT,
  p_request_id TEXT DEFAULT NULL
)
RETURNS TABLE (file_path TEXT, access_log_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.pharmacy_verification_submissions;
  v_path TEXT;
  v_log_id UUID;
  v_actor_role TEXT := COALESCE(auth.role(), 'unknown');
BEGIN
  IF p_document_kind NOT IN ('premises_certificate', 'superintendent_annual_licence') THEN
    RAISE EXCEPTION 'Unknown pharmacy verification document kind';
  END IF;
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid()
      AND u.is_admin = TRUE
      AND u.admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Only a provenance-authorized administrator can open verification evidence';
  END IF;

  SELECT * INTO v_submission
  FROM public.pharmacy_verification_submissions submission
  WHERE submission.id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verification submission not found'; END IF;

  v_path := CASE p_document_kind
    WHEN 'premises_certificate' THEN v_submission.premises_certificate_path
    ELSE v_submission.superintendent_annual_licence_path
  END;

  INSERT INTO public.pharmacy_verification_document_access_logs (
    pharmacy_id, submission_id, viewer_user_id, viewer_role,
    document_kind, outcome, request_id
  ) VALUES (
    v_submission.pharmacy_id, v_submission.id, auth.uid(), v_actor_role,
    p_document_kind, 'authorized', NULLIF(TRIM(p_request_id), '')
  ) RETURNING id INTO v_log_id;

  RETURN QUERY SELECT v_path, v_log_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Effective visibility and OTC opt-in
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow active pharmacies to be publicly viewable"
  ON public.pharmacies;
CREATE POLICY "Allow current pilot pharmacies to be publicly viewable"
ON public.pharmacies
FOR SELECT
USING (
  user_id = auth.uid()
  OR (
    is_active = TRUE
    AND public.pharmacy_verification_is_current(
      verification_status, provisional_expires_at, is_verified,
      verification_authorized_at, verification_authorization_basis,
      verification_documents_evidence_basis,
      verification_standards_evidence_basis
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid()
      AND u.is_admin = TRUE
      AND u.admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
  )
);

DROP POLICY IF EXISTS inventory_listed_anon_select ON public.pharmacy_inventory;
CREATE POLICY inventory_listed_anon_select
ON public.pharmacy_inventory
FOR SELECT TO anon
USING (
  is_listed = TRUE
  AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = pharmacy_inventory.pharmacy_id
      AND ph.is_active = TRUE
      AND public.pharmacy_verification_is_current(
        ph.verification_status, ph.provisional_expires_at, ph.is_verified,
        ph.verification_authorized_at, ph.verification_authorization_basis,
        ph.verification_documents_evidence_basis,
        ph.verification_standards_evidence_basis
      )
  )
);

DROP POLICY IF EXISTS inventory_authenticated_select ON public.pharmacy_inventory;
CREATE POLICY inventory_authenticated_select
ON public.pharmacy_inventory
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = pharmacy_inventory.pharmacy_id
      AND ph.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid()
      AND u.is_admin = TRUE
      AND u.admin_authorized_at IS NOT NULL
      AND NULLIF(TRIM(u.admin_authorization_basis), '') IS NOT NULL
  )
  OR (
    is_listed = TRUE
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.pharmacies ph
      WHERE ph.id = pharmacy_inventory.pharmacy_id
        AND ph.is_active = TRUE
        AND public.pharmacy_verification_is_current(
          ph.verification_status, ph.provisional_expires_at, ph.is_verified,
          ph.verification_authorized_at, ph.verification_authorization_basis,
          ph.verification_documents_evidence_basis,
          ph.verification_standards_evidence_basis
        )
    )
  )
);

-- Some deployments retained the legacy drugs table while newer clean schemas
-- use pharmacy_inventory directly. Tighten it only where it actually exists.
DO $legacy_drugs_policy$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'drugs'
      AND relation.relkind IN ('r', 'p')
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Allow viewing drugs of active pharmacies" ON public.drugs';
    EXECUTE $policy$
      CREATE POLICY "Allow viewing drugs of current pilot pharmacies"
      ON public.drugs
      FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.pharmacies ph
        WHERE ph.id = drugs.pharmacy_id
          AND (
            ph.user_id = auth.uid()
            OR (
              ph.is_active = TRUE
              AND public.pharmacy_verification_is_current(
                ph.verification_status, ph.provisional_expires_at, ph.is_verified,
                ph.verification_authorized_at, ph.verification_authorization_basis,
                ph.verification_documents_evidence_basis,
                ph.verification_standards_evidence_basis
              )
            )
          )
      ))
    $policy$;
  END IF;
END
$legacy_drugs_policy$;

DROP POLICY IF EXISTS "Allow active pharmacies' batches to be viewed" ON public.batches;
CREATE POLICY "Allow current pharmacies' batches to be viewed"
ON public.batches
FOR SELECT
USING (EXISTS (
  SELECT 1
  FROM public.pharmacy_inventory pi
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  WHERE pi.id = batches.inventory_id
    AND (
      ph.user_id = auth.uid()
      OR (
        ph.is_active = TRUE
        AND public.pharmacy_verification_is_current(
          ph.verification_status, ph.provisional_expires_at, ph.is_verified,
          ph.verification_authorized_at, ph.verification_authorization_basis,
          ph.verification_documents_evidence_basis,
          ph.verification_standards_evidence_basis
        )
      )
  )
));

DROP POLICY IF EXISTS "Only provenance-verified pharmacists can update symptom intakes"
  ON public.symptom_intakes;
DROP POLICY IF EXISTS "Only licensed pharmacists can update symptom intakes"
  ON public.symptom_intakes;
CREATE POLICY "Only accountable pilot pharmacists can update symptom intakes"
ON public.symptom_intakes
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.users reviewer
  WHERE reviewer.user_id = auth.uid()
    AND reviewer.is_licensed_pharmacist = TRUE
    AND reviewer.pharmacist_license_verified_at IS NOT NULL
    AND NULLIF(TRIM(reviewer.pharmacist_license_verification_basis), '') IS NOT NULL
    AND (
      (
        reviewer.is_stocmed_sp = TRUE
        AND reviewer.stocmed_sp_authorized_at IS NOT NULL
        AND NULLIF(TRIM(reviewer.stocmed_sp_authorization_basis), '') IS NOT NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.pharmacies ph
        WHERE ph.user_id = reviewer.user_id
          AND ph.is_active = TRUE
          AND ph.verification_status = 'full'
          AND public.pharmacy_verification_is_current(
            ph.verification_status, ph.provisional_expires_at, ph.is_verified,
            ph.verification_authorized_at, ph.verification_authorization_basis,
            ph.verification_documents_evidence_basis,
            ph.verification_standards_evidence_basis
          )
      )
    )
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.users reviewer
  WHERE reviewer.user_id = auth.uid()
    AND reviewer.is_licensed_pharmacist = TRUE
    AND reviewer.pharmacist_license_verified_at IS NOT NULL
    AND NULLIF(TRIM(reviewer.pharmacist_license_verification_basis), '') IS NOT NULL
    AND (
      (
        reviewer.is_stocmed_sp = TRUE
        AND reviewer.stocmed_sp_authorized_at IS NOT NULL
        AND NULLIF(TRIM(reviewer.stocmed_sp_authorization_basis), '') IS NOT NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.pharmacies ph
        WHERE ph.user_id = reviewer.user_id
          AND ph.is_active = TRUE
          AND ph.verification_status = 'full'
          AND public.pharmacy_verification_is_current(
            ph.verification_status, ph.provisional_expires_at, ph.is_verified,
            ph.verification_authorized_at, ph.verification_authorization_basis,
            ph.verification_documents_evidence_basis,
            ph.verification_standards_evidence_basis
          )
      )
    )
));

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
    OR NOT public.pharmacy_verification_is_current(
      NEW.verification_status, NEW.provisional_expires_at, NEW.is_verified,
      NEW.verification_authorized_at, NEW.verification_authorization_basis,
      NEW.verification_documents_evidence_basis,
      NEW.verification_standards_evidence_basis
    )
  ) THEN
    RAISE EXCEPTION 'A currently visible provisional or fully verified pharmacy is required';
  END IF;

  IF OLD.reservations_enabled
     AND (
       NOT NEW.reservations_enabled
       OR NOT NEW.is_active
       OR NOT public.pharmacy_verification_is_current(
         NEW.verification_status, NEW.provisional_expires_at, NEW.is_verified,
         NEW.verification_authorized_at, NEW.verification_authorization_basis,
         NEW.verification_documents_evidence_basis,
         NEW.verification_standards_evidence_basis
       )
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
     )
     AND (
       EXISTS (
         SELECT 1 FROM public.reservations r
         WHERE r.pharmacy_id = NEW.id
           AND r.status = 'active' AND r.expires_at > NOW()
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

CREATE OR REPLACE FUNCTION public.reservation_sellable_quantities(
  p_inventory_ids UUID[]
)
RETURNS TABLE (
  inventory_id UUID,
  reserved_quantity INTEGER,
  sellable_quantity INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pi.id,
    CASE WHEN ph.reservations_enabled THEN
      COALESCE(SUM(r.quantity) FILTER (
        WHERE r.status = 'active' AND r.expires_at > NOW()
      ), 0)::INTEGER
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
    AND (
      COALESCE(auth.role(), '') = 'service_role'
      OR ph.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.users admin_user
        WHERE admin_user.user_id = auth.uid()
          AND admin_user.is_admin = TRUE
          AND admin_user.admin_authorized_at IS NOT NULL
          AND NULLIF(TRIM(admin_user.admin_authorization_basis), '') IS NOT NULL
      )
      OR (
        pi.is_listed = TRUE
        AND pi.deleted_at IS NULL
        AND ph.is_active = TRUE
        AND public.pharmacy_verification_is_current(
          ph.verification_status, ph.provisional_expires_at, ph.is_verified,
          ph.verification_authorized_at, ph.verification_authorization_basis,
          ph.verification_documents_evidence_basis,
          ph.verification_standards_evidence_basis
        )
      )
    )
  GROUP BY pi.id, pi.quantity_in_stock, ph.reservations_enabled;
$$;

CREATE OR REPLACE FUNCTION public.reservation_batch_quantities(
  p_inventory_ids UUID[]
)
RETURNS TABLE (batch_id UUID, reserved_quantity INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.batch_id, SUM(r.quantity)::INTEGER
  FROM public.reservations r
  JOIN public.pharmacy_inventory pi ON pi.id = r.inventory_id
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  WHERE r.inventory_id = ANY(p_inventory_ids)
    AND r.status = 'active'
    AND r.expires_at > NOW()
    AND r.batch_id IS NOT NULL
    AND ph.reservations_enabled = TRUE
    AND (
      COALESCE(auth.role(), '') = 'service_role'
      OR ph.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.users admin_user
        WHERE admin_user.user_id = auth.uid()
          AND admin_user.is_admin = TRUE
          AND admin_user.admin_authorized_at IS NOT NULL
          AND NULLIF(TRIM(admin_user.admin_authorization_basis), '') IS NOT NULL
      )
    )
  GROUP BY r.batch_id;
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
      AND public.pharmacy_verification_is_current(
        ph.verification_status, ph.provisional_expires_at, ph.is_verified,
        ph.verification_authorized_at, ph.verification_authorization_basis,
        ph.verification_documents_evidence_basis,
        ph.verification_standards_evidence_basis
      )
      AND p.is_verified
      AND (
        NOT public.is_pilot_pom_product(
          p.generic_name, p.brand_name, p.requires_prescription
        )
        OR (
          ph.verification_status = 'full'
          AND EXISTS (
            SELECT 1 FROM public.rx_retention_policy retention
            WHERE retention.singleton = TRUE
              AND retention.is_confirmed = TRUE
              AND retention.retention_days IS NOT NULL
              AND retention.confirmed_by IS NOT NULL
              AND retention.confirmed_at IS NOT NULL
              AND NULLIF(TRIM(retention.legal_basis), '') IS NOT NULL
          )
          AND (
            EXISTS (
              SELECT 1 FROM public.users destination_sp
              WHERE destination_sp.user_id = ph.user_id
                AND destination_sp.is_licensed_pharmacist = TRUE
                AND destination_sp.pharmacist_license_verified_at IS NOT NULL
                AND NULLIF(TRIM(
                  destination_sp.pharmacist_license_verification_basis
                ), '') IS NOT NULL
            )
            OR EXISTS (
              SELECT 1 FROM public.users central_sp
              WHERE central_sp.is_stocmed_sp = TRUE
                AND central_sp.stocmed_sp_authorized_at IS NOT NULL
                AND NULLIF(TRIM(central_sp.stocmed_sp_authorization_basis), '') IS NOT NULL
                AND central_sp.is_licensed_pharmacist = TRUE
                AND central_sp.pharmacist_license_verified_at IS NOT NULL
                AND NULLIF(TRIM(
                  central_sp.pharmacist_license_verification_basis
                ), '') IS NOT NULL
            )
          )
        )
      )
    )
  FROM public.pharmacy_inventory pi
  JOIN public.products p ON p.id = pi.product_id
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  WHERE pi.id = ANY(p_inventory_ids)
    AND (
      COALESCE(auth.role(), '') = 'service_role'
      OR ph.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.users admin_user
        WHERE admin_user.user_id = auth.uid()
          AND admin_user.is_admin = TRUE
          AND admin_user.admin_authorized_at IS NOT NULL
          AND NULLIF(TRIM(admin_user.admin_authorization_basis), '') IS NOT NULL
      )
      OR (
        pi.is_listed = TRUE
        AND pi.deleted_at IS NULL
        AND ph.is_active = TRUE
        AND public.pharmacy_verification_is_current(
          ph.verification_status, ph.provisional_expires_at, ph.is_verified,
          ph.verification_authorized_at, ph.verification_authorization_basis,
          ph.verification_documents_evidence_basis,
          ph.verification_standards_evidence_basis
        )
      )
    );
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

  PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::TEXT));
  PERFORM public.expire_reservations();
  IF (SELECT COUNT(*) FROM public.reservations
      WHERE patient_id = auth.uid() AND status = 'active' AND expires_at > NOW()) >= 3 THEN
    RAISE EXCEPTION 'You already have the maximum of three active holds';
  END IF;

  SELECT pi.* INTO v_inventory
  FROM public.pharmacy_inventory pi
  JOIN public.products p ON p.id = pi.product_id
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  WHERE pi.id = p_inventory_id
    AND pi.is_listed = TRUE
    AND pi.deleted_at IS NULL
    AND p.is_verified = TRUE
    AND NOT public.is_pilot_pom_product(
      p.generic_name, p.brand_name, p.requires_prescription
    )
    AND ph.is_active = TRUE
    AND ph.reservations_enabled = TRUE
    AND public.pharmacy_verification_is_current(
      ph.verification_status, ph.provisional_expires_at, ph.is_verified,
      ph.verification_authorized_at, ph.verification_authorization_basis,
      ph.verification_documents_evidence_basis,
      ph.verification_standards_evidence_basis
    )
  FOR UPDATE OF pi;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This verified non-prescription medicine is not available for reservation';
  END IF;

  SELECT ph.reservation_hold_minutes INTO v_hold_minutes
  FROM public.pharmacies ph WHERE ph.id = v_inventory.pharmacy_id;
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
    SELECT SUM(r.quantity) FROM public.reservations r
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

-- ---------------------------------------------------------------------------
-- FULL-only POM intake and accountable clinical pre-review
-- ---------------------------------------------------------------------------

ALTER TABLE public.rx_submissions
  ADD COLUMN IF NOT EXISTS clinical_review_source TEXT,
  ADD COLUMN IF NOT EXISTS dispensing_authorized BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.rx_audit_records
  ADD COLUMN IF NOT EXISTS clinical_review_source TEXT,
  ADD COLUMN IF NOT EXISTS dispensing_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_notes TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rx_submissions'::regclass
      AND conname = 'rx_submissions_clinical_review_source_check'
  ) THEN
    ALTER TABLE public.rx_submissions
      ADD CONSTRAINT rx_submissions_clinical_review_source_check
      CHECK (clinical_review_source IS NULL OR clinical_review_source IN (
        'destination_sp', 'stocmed_sp_pre_review'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rx_submissions'::regclass
      AND conname = 'rx_submissions_no_dispensing_authorization'
  ) THEN
    ALTER TABLE public.rx_submissions
      ADD CONSTRAINT rx_submissions_no_dispensing_authorization
      CHECK (dispensing_authorized = FALSE);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rx_audit_records'::regclass
      AND conname = 'rx_audit_clinical_review_source_check'
  ) THEN
    ALTER TABLE public.rx_audit_records
      ADD CONSTRAINT rx_audit_clinical_review_source_check
      CHECK (clinical_review_source IS NULL OR clinical_review_source IN (
        'destination_sp', 'stocmed_sp_pre_review'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rx_audit_records'::regclass
      AND conname = 'rx_audit_no_dispensing_authorization'
  ) THEN
    ALTER TABLE public.rx_audit_records
      ADD CONSTRAINT rx_audit_no_dispensing_authorization
      CHECK (dispensing_authorized = FALSE);
  END IF;
END $$;

ALTER TABLE public.rx_document_access_logs
  DROP CONSTRAINT IF EXISTS rx_document_access_logs_access_context_check;
ALTER TABLE public.rx_document_access_logs
  ADD CONSTRAINT rx_document_access_logs_access_context_check
  CHECK (access_context IN (
    'destination_review', 'stocmed_clinical_review', 'stocmed_oversight'
  ));

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
  IF NEW.user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::TEXT));
  END IF;

  SELECT pi.pharmacy_id, COALESCE(p.brand_name, p.generic_name)
  INTO v_pharmacy_id, v_product_name
  FROM public.pharmacy_inventory pi
  JOIN public.products p ON p.id = pi.product_id
  JOIN public.pharmacies ph ON ph.id = pi.pharmacy_id
  WHERE pi.id = NEW.inventory_id
    AND pi.is_listed = TRUE
    AND pi.deleted_at IS NULL
    AND p.is_verified = TRUE
    AND public.is_pilot_pom_product(
      p.generic_name, p.brand_name, p.requires_prescription
    )
    AND ph.is_active = TRUE
    AND ph.reservations_enabled = TRUE
    AND ph.verification_status = 'full'
    AND public.pharmacy_verification_is_current(
      ph.verification_status, ph.provisional_expires_at, ph.is_verified,
      ph.verification_authorized_at, ph.verification_authorization_basis,
      ph.verification_documents_evidence_basis,
      ph.verification_standards_evidence_basis
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.users destination_sp
        WHERE destination_sp.user_id = ph.user_id
          AND destination_sp.is_licensed_pharmacist = TRUE
          AND destination_sp.pharmacist_license_verified_at IS NOT NULL
          AND NULLIF(TRIM(
            destination_sp.pharmacist_license_verification_basis
          ), '') IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.users central_sp
        WHERE central_sp.is_stocmed_sp = TRUE
          AND central_sp.stocmed_sp_authorized_at IS NOT NULL
          AND NULLIF(TRIM(central_sp.stocmed_sp_authorization_basis), '') IS NOT NULL
          AND central_sp.is_licensed_pharmacist = TRUE
          AND central_sp.pharmacist_license_verified_at IS NOT NULL
          AND NULLIF(TRIM(
            central_sp.pharmacist_license_verification_basis
          ), '') IS NOT NULL
      )
    );

  IF v_pharmacy_id IS NULL OR v_pharmacy_id IS DISTINCT FROM NEW.destination_pharmacy_id THEN
    RAISE EXCEPTION 'Only a FULL pharmacy with an accountable licensed reviewer can accept digital prescription reservations';
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
  NEW.clinical_review_source := NULL;
  NEW.dispensing_authorized := FALSE;
  NEW.purge_after := NOW() + make_interval(days => v_retention_days);
  RETURN NEW;
END;
$$;

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
    requested_quantity, status, submitted_at, reviewed_at, reviewed_by,
    review_notes, purge_after, clinical_review_source, dispensing_authorized,
    updated_at
  ) VALUES (
    NEW.id, NEW.destination_pharmacy_id, NEW.inventory_id, NEW.product_name,
    NEW.requested_quantity, NEW.status, NEW.created_at, NEW.reviewed_at,
    NEW.reviewed_by, NEW.review_notes, NEW.purge_after,
    NEW.clinical_review_source, FALSE, NOW()
  )
  ON CONFLICT (submission_id) DO UPDATE SET
    status = EXCLUDED.status,
    reviewed_at = EXCLUDED.reviewed_at,
    reviewed_by = EXCLUDED.reviewed_by,
    review_notes = EXCLUDED.review_notes,
    purge_after = EXCLUDED.purge_after,
    clinical_review_source = EXCLUDED.clinical_review_source,
    dispensing_authorized = FALSE,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_rx_audit_record_trigger ON public.rx_submissions;
CREATE TRIGGER sync_rx_audit_record_trigger
AFTER INSERT OR UPDATE OF status, reviewed_at, reviewed_by, reservation_id,
  clinical_review_source, review_notes
ON public.rx_submissions
FOR EACH ROW EXECUTE FUNCTION public.sync_rx_audit_record();

DROP POLICY IF EXISTS rx_destination_sp_select ON public.rx_submissions;
CREATE POLICY rx_destination_sp_select
ON public.rx_submissions
FOR SELECT TO authenticated
USING (
  flow_model = 'destination_model_a'
  AND purge_after IS NOT NULL
  AND purge_after > NOW()
  AND EXISTS (
    SELECT 1
    FROM public.pharmacies ph
    WHERE ph.id = rx_submissions.destination_pharmacy_id
      AND ph.verification_status = 'full'
      AND public.pharmacy_verification_is_current(
        ph.verification_status, ph.provisional_expires_at, ph.is_verified,
        ph.verification_authorized_at, ph.verification_authorization_basis,
        ph.verification_documents_evidence_basis,
        ph.verification_standards_evidence_basis
      )
      AND (
        (
          ph.user_id = auth.uid()
          AND EXISTS (
            SELECT 1 FROM public.users destination_sp
            WHERE destination_sp.user_id = auth.uid()
              AND destination_sp.is_licensed_pharmacist = TRUE
              AND destination_sp.pharmacist_license_verified_at IS NOT NULL
              AND NULLIF(TRIM(
                destination_sp.pharmacist_license_verification_basis
              ), '') IS NOT NULL
          )
        )
        OR EXISTS (
          SELECT 1 FROM public.users central_sp
          WHERE central_sp.user_id = auth.uid()
            AND central_sp.is_stocmed_sp = TRUE
            AND central_sp.stocmed_sp_authorized_at IS NOT NULL
            AND NULLIF(TRIM(central_sp.stocmed_sp_authorization_basis), '') IS NOT NULL
            AND central_sp.is_licensed_pharmacist = TRUE
            AND central_sp.pharmacist_license_verified_at IS NOT NULL
            AND NULLIF(TRIM(
              central_sp.pharmacist_license_verification_basis
            ), '') IS NOT NULL
        )
      )
  )
);

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
    patient.full_name, patient.phone, rx.reservation_id, r.pickup_code,
    rx.destination_seen_at
  FROM public.rx_submissions rx
  JOIN public.pharmacies ph ON ph.id = rx.destination_pharmacy_id
  LEFT JOIN public.users patient ON patient.user_id = rx.user_id
  LEFT JOIN public.reservations r ON r.id = rx.reservation_id
  WHERE rx.destination_pharmacy_id = p_pharmacy_id
    AND rx.flow_model = 'destination_model_a'
    AND rx.purge_after IS NOT NULL
    AND rx.purge_after > NOW()
    AND ph.verification_status = 'full'
    AND public.pharmacy_verification_is_current(
      ph.verification_status, ph.provisional_expires_at, ph.is_verified,
      ph.verification_authorized_at, ph.verification_authorization_basis,
      ph.verification_documents_evidence_basis,
      ph.verification_standards_evidence_basis
    )
    AND (
      (
        ph.user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.users destination_sp
          WHERE destination_sp.user_id = auth.uid()
            AND destination_sp.is_licensed_pharmacist = TRUE
            AND destination_sp.pharmacist_license_verified_at IS NOT NULL
            AND NULLIF(TRIM(
              destination_sp.pharmacist_license_verification_basis
            ), '') IS NOT NULL
        )
      )
      OR EXISTS (
        SELECT 1 FROM public.users central_sp
        WHERE central_sp.user_id = auth.uid()
          AND central_sp.is_stocmed_sp = TRUE
          AND central_sp.stocmed_sp_authorized_at IS NOT NULL
          AND NULLIF(TRIM(central_sp.stocmed_sp_authorization_basis), '') IS NOT NULL
          AND central_sp.is_licensed_pharmacist = TRUE
          AND central_sp.pharmacist_license_verified_at IS NOT NULL
          AND NULLIF(TRIM(
            central_sp.pharmacist_license_verification_basis
          ), '') IS NOT NULL
      )
    )
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
  v_review_source TEXT;
  v_required_access_context TEXT;
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

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.pharmacies ph
      JOIN public.users destination_sp ON destination_sp.user_id = ph.user_id
      WHERE ph.id = v_rx.destination_pharmacy_id
        AND ph.user_id = auth.uid()
        AND ph.is_active = TRUE
        AND ph.reservations_enabled = TRUE
        AND ph.verification_status = 'full'
        AND public.pharmacy_verification_is_current(
          ph.verification_status, ph.provisional_expires_at, ph.is_verified,
          ph.verification_authorized_at, ph.verification_authorization_basis,
          ph.verification_documents_evidence_basis,
          ph.verification_standards_evidence_basis
        )
        AND destination_sp.is_licensed_pharmacist = TRUE
        AND destination_sp.pharmacist_license_verified_at IS NOT NULL
        AND NULLIF(TRIM(
          destination_sp.pharmacist_license_verification_basis
        ), '') IS NOT NULL
    ) THEN 'destination_sp'
    WHEN EXISTS (
      SELECT 1
      FROM public.users central_sp
      JOIN public.pharmacies ph ON ph.id = v_rx.destination_pharmacy_id
      WHERE central_sp.user_id = auth.uid()
        AND central_sp.is_stocmed_sp = TRUE
        AND central_sp.stocmed_sp_authorized_at IS NOT NULL
        AND NULLIF(TRIM(central_sp.stocmed_sp_authorization_basis), '') IS NOT NULL
        AND central_sp.is_licensed_pharmacist = TRUE
        AND central_sp.pharmacist_license_verified_at IS NOT NULL
        AND NULLIF(TRIM(
          central_sp.pharmacist_license_verification_basis
        ), '') IS NOT NULL
        AND ph.is_active = TRUE
        AND ph.reservations_enabled = TRUE
        AND ph.verification_status = 'full'
        AND public.pharmacy_verification_is_current(
          ph.verification_status, ph.provisional_expires_at, ph.is_verified,
          ph.verification_authorized_at, ph.verification_authorization_basis,
          ph.verification_documents_evidence_basis,
          ph.verification_standards_evidence_basis
        )
    ) THEN 'stocmed_sp_pre_review'
    ELSE NULL
  END INTO v_review_source;

  IF v_review_source IS NULL THEN
    RAISE EXCEPTION 'Only a provenance-verified destination SP or StocMed clinical reviewer can pre-review this prescription';
  END IF;
  v_required_access_context := CASE v_review_source
    WHEN 'destination_sp' THEN 'destination_review'
    ELSE 'stocmed_clinical_review'
  END;

  IF v_rx.purge_after IS NULL OR v_rx.purge_after <= NOW() THEN
    RAISE EXCEPTION 'This prescription submission has expired and cannot be reviewed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rx_document_access_logs access_log
    WHERE access_log.submission_id = v_rx.id
      AND access_log.viewer_user_id = auth.uid()
      AND access_log.access_context = v_required_access_context
      AND access_log.outcome = 'authorized'
  ) THEN
    RAISE EXCEPTION 'Open the prescription document through the matching audited clinical-review flow before deciding';
  END IF;

  IF v_rx.status = 'verified' AND v_rx.reservation_id IS NOT NULL
     AND p_decision = 'verified' THEN
    SELECT * INTO v_reservation FROM public.reservations
    WHERE id = v_rx.reservation_id;
    RETURN jsonb_build_object(
      'submission', to_jsonb(v_rx), 'reservation', to_jsonb(v_reservation),
      'replayed', TRUE, 'dispensing_authorized', FALSE
    );
  END IF;
  IF v_rx.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'This prescription has already been decided';
  END IF;

  IF p_decision = 'rejected' THEN
    UPDATE public.rx_submissions
    SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = NOW(),
        review_notes = NULLIF(TRIM(p_notes), ''),
        clinical_review_source = v_review_source,
        dispensing_authorized = FALSE, updated_at = NOW()
    WHERE id = v_rx.id
    RETURNING * INTO v_rx;
    RETURN jsonb_build_object(
      'submission', to_jsonb(v_rx), 'reservation', NULL,
      'replayed', FALSE, 'dispensing_authorized', FALSE
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_rx.user_id::TEXT));
  PERFORM public.expire_reservations();
  IF (SELECT COUNT(*) FROM public.reservations
      WHERE patient_id = v_rx.user_id AND status = 'active' AND expires_at > NOW()) >= 3 THEN
    RAISE EXCEPTION 'The patient already has the maximum of three active holds';
  END IF;

  SELECT pi.* INTO v_inventory
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
    RAISE EXCEPTION 'Insufficient stock to create this prescription-backed digital hold';
  END IF;

  SELECT b.id INTO v_batch_id
  FROM public.batches b
  LEFT JOIN public.stock_movements sm ON sm.batch_id = b.id
  WHERE b.inventory_id = v_rx.inventory_id
    AND b.expiry_date > v_hold_expires_at::DATE
  GROUP BY b.id, b.expiry_date
  HAVING COALESCE(SUM(sm.quantity), 0) - COALESCE((
    SELECT SUM(r.quantity) FROM public.reservations r
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
      clinical_review_source = v_review_source,
      dispensing_authorized = FALSE, updated_at = NOW()
  WHERE id = v_rx.id
  RETURNING * INTO v_rx;

  RETURN jsonb_build_object(
    'submission', to_jsonb(v_rx), 'reservation', to_jsonb(v_reservation),
    'replayed', FALSE, 'dispensing_authorized', FALSE
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
    JOIN public.users destination_sp ON destination_sp.user_id = ph.user_id
    WHERE rx.id = p_submission_id
      AND rx.flow_model = 'destination_model_a'
      AND rx.purge_after IS NOT NULL AND rx.purge_after > NOW()
      AND ph.user_id = auth.uid()
      AND ph.verification_status = 'full'
      AND public.pharmacy_verification_is_current(
        ph.verification_status, ph.provisional_expires_at, ph.is_verified,
        ph.verification_authorized_at, ph.verification_authorization_basis,
        ph.verification_documents_evidence_basis,
        ph.verification_standards_evidence_basis
      )
      AND destination_sp.is_licensed_pharmacist = TRUE
      AND destination_sp.pharmacist_license_verified_at IS NOT NULL
      AND NULLIF(TRIM(
        destination_sp.pharmacist_license_verification_basis
      ), '') IS NOT NULL;
  ELSIF p_context = 'stocmed_clinical_review' THEN
    SELECT rx.file_url, audit.id INTO v_file_path, v_audit_id
    FROM public.rx_submissions rx
    LEFT JOIN public.rx_audit_records audit ON audit.submission_id = rx.id
    JOIN public.pharmacies ph ON ph.id = rx.destination_pharmacy_id
    WHERE rx.id = p_submission_id
      AND rx.flow_model = 'destination_model_a'
      AND rx.purge_after IS NOT NULL AND rx.purge_after > NOW()
      AND ph.verification_status = 'full'
      AND public.pharmacy_verification_is_current(
        ph.verification_status, ph.provisional_expires_at, ph.is_verified,
        ph.verification_authorized_at, ph.verification_authorization_basis,
        ph.verification_documents_evidence_basis,
        ph.verification_standards_evidence_basis
      )
      AND EXISTS (
        SELECT 1 FROM public.users central_sp
        WHERE central_sp.user_id = auth.uid()
          AND central_sp.is_stocmed_sp = TRUE
          AND central_sp.stocmed_sp_authorized_at IS NOT NULL
          AND NULLIF(TRIM(central_sp.stocmed_sp_authorization_basis), '') IS NOT NULL
          AND central_sp.is_licensed_pharmacist = TRUE
          AND central_sp.pharmacist_license_verified_at IS NOT NULL
          AND NULLIF(TRIM(
            central_sp.pharmacist_license_verification_basis
          ), '') IS NOT NULL
      );
  ELSIF p_context = 'stocmed_oversight' THEN
    SELECT rx.file_url, audit.id INTO v_file_path, v_audit_id
    FROM public.rx_submissions rx
    JOIN public.rx_audit_records audit ON audit.submission_id = rx.id
    WHERE rx.id = p_submission_id
      AND rx.purge_after IS NOT NULL AND rx.purge_after > NOW()
      AND EXISTS (
        SELECT 1 FROM public.users u
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
    p_submission_id, v_audit_id, auth.uid(), p_context, 'authorized',
    NULLIF(p_request_id, '')
  ) RETURNING id INTO v_log_id;

  RETURN QUERY SELECT v_file_path, v_log_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled transition and explicit ACLs
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-provisional-pharmacies') THEN
      PERFORM cron.unschedule('expire-provisional-pharmacies');
    END IF;
    PERFORM cron.schedule(
      'expire-provisional-pharmacies',
      '*/5 * * * *',
      'SELECT public.expire_provisional_pharmacies()'
    );
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.normalize_pcn_registration_number(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_plausible_pcn_registration_number(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.normalize_pharmacist_license_number(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_plausible_pharmacist_license_number(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_pharmacist_license_identity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.provision_licensed_pharmacist(
  UUID, TEXT, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.provision_pilot_role(UUID, TEXT, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pharmacy_verification_is_current(
  TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_reservation_collection_verification()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_pharmacy_verification_record_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_pharmacy_verification_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.register_provisional_pharmacy(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_pharmacy_verification_requirements(
  TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.provision_full_pharmacy_verification(
  UUID, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bootstrap_legacy_full_pharmacy_verification(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_pilot_pharmacy_verification(UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_pharmacy_verification_submission(
  UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.expire_provisional_pharmacies()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_pharmacy_verification_queue()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.authorize_and_log_pharmacy_verification_document_access(
  UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.pharmacy_verification_is_current(
  TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO anon, authenticated;
-- These immutable format helpers participate in CHECK constraints and index
-- expressions evaluated during ordinary authenticated profile updates.
GRANT EXECUTE ON FUNCTION public.normalize_pcn_registration_number(TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_plausible_pcn_registration_number(TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_pharmacist_license_number(TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_plausible_pharmacist_license_number(TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provision_licensed_pharmacist(
  UUID, TEXT, BOOLEAN, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.provision_pilot_role(UUID, TEXT, BOOLEAN, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.register_provisional_pharmacy(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_pharmacy_verification_requirements(
  TEXT, TEXT, BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provision_full_pharmacy_verification(
  UUID, TEXT, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_legacy_full_pharmacy_verification(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_pilot_pharmacy_verification(UUID, BOOLEAN, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_pharmacy_verification_submission(
  UUID, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_provisional_pharmacies() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pharmacy_verification_queue()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_and_log_pharmacy_verification_document_access(
  UUID, TEXT, TEXT
) TO authenticated, service_role;

-- Replacement POM functions retain their previous grants under CREATE OR
-- REPLACE, but state them again so this migration is auditable in isolation.
REVOKE ALL ON FUNCTION public.prepare_model_a_rx_submission()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_rx_audit_record()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.review_destination_prescription(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.authorize_and_log_rx_document_access(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_destination_prescription(UUID, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_and_log_rx_document_access(UUID, TEXT, TEXT)
  TO authenticated;

-- Isolated live fix: the queue contract returns text while the two legacy
-- pharmacy identity columns are varchar. Cast at the function boundary.
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
  SELECT latest.id, latest.pharmacy_id,
    ph.pharmacy_name::TEXT, ph.license_number::TEXT,
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

REVOKE ALL ON FUNCTION public.get_pharmacy_verification_queue()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pharmacy_verification_queue()
TO authenticated, service_role;

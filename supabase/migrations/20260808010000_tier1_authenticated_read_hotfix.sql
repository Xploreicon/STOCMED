-- Tier 1 authenticated-read hotfix.
--
-- Keep private pharmacy columns denied while restoring owner profile reads and
-- RLS-protected relations whose policies previously read denied verification
-- provenance columns from public.pharmacies.

CREATE OR REPLACE FUNCTION public.get_authenticated_pharmacy_profile()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.internal_client_pharmacy_profile(pharmacy)
  FROM public.pharmacies AS pharmacy
  WHERE pharmacy.user_id = auth.uid()
  ORDER BY pharmacy.is_active DESC, pharmacy.created_at DESC
  LIMIT 1;
$$;

ALTER FUNCTION public.get_authenticated_pharmacy_profile() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_authenticated_pharmacy_profile()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authenticated_pharmacy_profile()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_authenticated_pharmacy_profile() IS
  'Returns only the authenticated user own allowlisted pharmacy profile; never returns SP or private verification fields.';

-- Policies on related tables cannot read the provenance columns that Tier 1
-- intentionally removed from client grants. Evaluate the existing verification
-- predicate as the function owner and expose only its boolean result.
CREATE OR REPLACE FUNCTION public.pharmacy_verification_is_current_by_id(
  p_pharmacy_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT public.pharmacy_verification_is_current(
      pharmacy.verification_status,
      pharmacy.provisional_expires_at,
      pharmacy.is_verified,
      pharmacy.verification_authorized_at,
      pharmacy.verification_authorization_basis,
      pharmacy.verification_documents_evidence_basis,
      pharmacy.verification_standards_evidence_basis
    )
    FROM public.pharmacies AS pharmacy
    WHERE pharmacy.id = p_pharmacy_id
  ), FALSE);
$$;

ALTER FUNCTION public.pharmacy_verification_is_current_by_id(UUID)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pharmacy_verification_is_current_by_id(UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pharmacy_verification_is_current_by_id(UUID)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.pharmacy_verification_is_current_by_id(UUID) IS
  'Boolean-only verification predicate used by RLS without exposing private verification provenance.';

DROP POLICY IF EXISTS "Allow current pharmacies' batches to be viewed"
  ON public.batches;
CREATE POLICY "Allow current pharmacies' batches to be viewed"
ON public.batches
FOR SELECT
USING (EXISTS (
  SELECT 1
  FROM public.pharmacy_inventory AS inventory
  JOIN public.pharmacies AS pharmacy
    ON pharmacy.id = inventory.pharmacy_id
  WHERE inventory.id = batches.inventory_id
    AND (
      pharmacy.user_id = auth.uid()
      OR (
        pharmacy.is_active = TRUE
        AND public.pharmacy_verification_is_current_by_id(pharmacy.id)
      )
    )
));

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
    FROM public.pharmacies AS pharmacy
    WHERE pharmacy.id = rx_submissions.destination_pharmacy_id
      AND pharmacy.verification_status = 'full'
      AND public.pharmacy_verification_is_current_by_id(pharmacy.id)
      AND (
        (
          pharmacy.user_id = auth.uid()
          AND EXISTS (
            SELECT 1
            FROM public.users AS destination_sp
            WHERE destination_sp.user_id = auth.uid()
              AND destination_sp.is_licensed_pharmacist = TRUE
              AND destination_sp.pharmacist_license_verified_at IS NOT NULL
              AND NULLIF(TRIM(
                destination_sp.pharmacist_license_verification_basis
              ), '') IS NOT NULL
          )
        )
        OR EXISTS (
          SELECT 1
          FROM public.users AS central_sp
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

DROP POLICY IF EXISTS "Only accountable pilot pharmacists can update symptom intakes"
  ON public.symptom_intakes;
CREATE POLICY "Only accountable pilot pharmacists can update symptom intakes"
ON public.symptom_intakes
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.users AS reviewer
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
        FROM public.pharmacies AS pharmacy
        WHERE pharmacy.user_id = reviewer.user_id
          AND pharmacy.is_active = TRUE
          AND pharmacy.verification_status = 'full'
          AND public.pharmacy_verification_is_current_by_id(pharmacy.id)
      )
    )
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.users AS reviewer
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
        FROM public.pharmacies AS pharmacy
        WHERE pharmacy.user_id = reviewer.user_id
          AND pharmacy.is_active = TRUE
          AND pharmacy.verification_status = 'full'
          AND public.pharmacy_verification_is_current_by_id(pharmacy.id)
      )
    )
));

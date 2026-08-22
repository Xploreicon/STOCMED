-- Fresh local databases do not inherit the hosted project's legacy default
-- grants. Re-state the intended read surface and keep private user provenance
-- behind boolean SECURITY DEFINER helpers used by RLS.
CREATE OR REPLACE FUNCTION public.authenticated_user_is_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE((SELECT user_row.is_admin=TRUE AND user_row.admin_authorized_at IS NOT NULL
    AND NULLIF(TRIM(user_row.admin_authorization_basis),'') IS NOT NULL
    FROM public.users user_row WHERE user_row.user_id=auth.uid()),FALSE);
$$;
CREATE OR REPLACE FUNCTION public.authenticated_user_is_patient()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE((SELECT user_row.role='patient' FROM public.users user_row WHERE user_row.user_id=auth.uid()),FALSE);
$$;
CREATE OR REPLACE FUNCTION public.authenticated_user_is_clinical_reviewer()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE((SELECT user_row.is_admin=TRUE OR user_row.is_licensed_pharmacist=TRUE
    FROM public.users user_row WHERE user_row.user_id=auth.uid()),FALSE);
$$;
CREATE OR REPLACE FUNCTION public.authenticated_user_is_accountable_pharmacist()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE((SELECT user_row.is_licensed_pharmacist=TRUE
    AND user_row.pharmacist_license_verified_at IS NOT NULL
    AND NULLIF(TRIM(user_row.pharmacist_license_verification_basis),'') IS NOT NULL
    AND ((user_row.is_stocmed_sp=TRUE AND user_row.stocmed_sp_authorized_at IS NOT NULL
      AND NULLIF(TRIM(user_row.stocmed_sp_authorization_basis),'') IS NOT NULL)
      OR EXISTS(SELECT 1 FROM public.pharmacies pharmacy WHERE pharmacy.user_id=user_row.user_id
        AND pharmacy.is_active=TRUE AND pharmacy.verification_status='full'
        AND public.pharmacy_verification_is_current_by_id(pharmacy.id)))
    FROM public.users user_row WHERE user_row.user_id=auth.uid()),FALSE);
$$;
ALTER FUNCTION public.authenticated_user_is_admin() OWNER TO postgres;
ALTER FUNCTION public.authenticated_user_is_patient() OWNER TO postgres;
ALTER FUNCTION public.authenticated_user_is_clinical_reviewer() OWNER TO postgres;
ALTER FUNCTION public.authenticated_user_is_accountable_pharmacist() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.authenticated_user_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authenticated_user_is_patient() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authenticated_user_is_clinical_reviewer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authenticated_user_is_accountable_pharmacist() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authenticated_user_is_admin() TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authenticated_user_is_patient() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authenticated_user_is_clinical_reviewer() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authenticated_user_is_accountable_pharmacist() TO authenticated,service_role;

DROP POLICY IF EXISTS "Allow current pilot pharmacies to be publicly viewable" ON public.pharmacies;
CREATE POLICY "Allow current pilot pharmacies to be publicly viewable" ON public.pharmacies FOR SELECT USING(
  user_id=auth.uid() OR (is_active=TRUE AND public.pharmacy_verification_is_current(
    verification_status,provisional_expires_at,is_verified,verification_authorized_at,
    verification_authorization_basis,verification_documents_evidence_basis,verification_standards_evidence_basis
  )) OR public.authenticated_user_is_admin()
);

DROP POLICY IF EXISTS inventory_authenticated_select ON public.pharmacy_inventory;
CREATE POLICY inventory_authenticated_select ON public.pharmacy_inventory FOR SELECT TO authenticated USING(
  public.authenticated_user_owns_pharmacy(pharmacy_id)
  OR (public.authenticated_user_is_patient() AND item_type='medicine' AND is_listed=TRUE AND deleted_at IS NULL)
);

DROP POLICY IF EXISTS "Allow users to view own symptom intakes" ON public.symptom_intakes;
CREATE POLICY "Allow users to view own symptom intakes" ON public.symptom_intakes FOR SELECT TO authenticated USING(
  user_id=auth.uid() OR public.authenticated_user_is_clinical_reviewer()
);
DROP POLICY IF EXISTS "Only accountable pilot pharmacists can update symptom intakes" ON public.symptom_intakes;
CREATE POLICY "Only accountable pilot pharmacists can update symptom intakes" ON public.symptom_intakes FOR UPDATE TO authenticated
USING(public.authenticated_user_is_accountable_pharmacist())
WITH CHECK(public.authenticated_user_is_accountable_pharmacist());

GRANT SELECT ON public.pharmacy_inventory TO anon,authenticated;
GRANT SELECT,UPDATE ON public.symptom_intakes TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.notification_deliveries TO service_role;

-- Preserve the legal-retention gate for every real pharmacy. The explicitly
-- marked Spirit test account alone may exercise synthetic Model A flows.

CREATE OR REPLACE FUNCTION public.reservation_inventory_capabilities(p_inventory_ids UUID[])
RETURNS TABLE (inventory_id UUID, reservations_enabled BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pi.id,
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
      NOT public.is_pilot_pom_product(p.generic_name, p.brand_name, p.requires_prescription)
      OR (
        ph.verification_status = 'full'
        AND (
          ph.is_test_account
          OR EXISTS (
            SELECT 1 FROM public.rx_retention_policy retention
            WHERE retention.singleton AND retention.is_confirmed
              AND retention.retention_days IS NOT NULL
              AND retention.confirmed_by IS NOT NULL
              AND retention.confirmed_at IS NOT NULL
              AND NULLIF(TRIM(retention.legal_basis), '') IS NOT NULL
          )
        )
        AND (
          EXISTS (
            SELECT 1 FROM public.users destination_sp
            WHERE destination_sp.user_id = ph.user_id
              AND destination_sp.is_licensed_pharmacist
              AND destination_sp.pharmacist_license_verified_at IS NOT NULL
              AND NULLIF(TRIM(destination_sp.pharmacist_license_verification_basis), '') IS NOT NULL
          )
          OR EXISTS (
            SELECT 1 FROM public.users central_sp
            WHERE central_sp.is_stocmed_sp
              AND central_sp.stocmed_sp_authorized_at IS NOT NULL
              AND NULLIF(TRIM(central_sp.stocmed_sp_authorization_basis), '') IS NOT NULL
              AND central_sp.is_licensed_pharmacist
              AND central_sp.pharmacist_license_verified_at IS NOT NULL
              AND NULLIF(TRIM(central_sp.pharmacist_license_verification_basis), '') IS NOT NULL
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
        WHERE admin_user.user_id = auth.uid() AND admin_user.is_admin
          AND admin_user.admin_authorized_at IS NOT NULL
          AND NULLIF(TRIM(admin_user.admin_authorization_basis), '') IS NOT NULL
      )
      OR (
        pi.is_listed AND pi.deleted_at IS NULL AND ph.is_active
        AND public.pharmacy_verification_is_current(
          ph.verification_status, ph.provisional_expires_at, ph.is_verified,
          ph.verification_authorized_at, ph.verification_authorization_basis,
          ph.verification_documents_evidence_basis,
          ph.verification_standards_evidence_basis
        )
      )
    );
$$;

-- Complete fresh-database read grants for established POS/catalogue surfaces.
GRANT SELECT ON public.products TO anon,authenticated;
GRANT SELECT ON public.sales,public.sale_items,public.shifts TO authenticated;

CREATE OR REPLACE FUNCTION public.authenticated_user_is_verified_pharmacist()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE((SELECT user_row.is_licensed_pharmacist=TRUE
    AND user_row.pharmacist_license_verified_at IS NOT NULL
    AND NULLIF(TRIM(user_row.pharmacist_license_verification_basis),'') IS NOT NULL
    FROM public.users user_row WHERE user_row.user_id=auth.uid()),FALSE);
$$;
CREATE OR REPLACE FUNCTION public.authenticated_user_is_central_sp()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE((SELECT user_row.is_stocmed_sp=TRUE AND user_row.stocmed_sp_authorized_at IS NOT NULL
    AND NULLIF(TRIM(user_row.stocmed_sp_authorization_basis),'') IS NOT NULL
    AND user_row.is_licensed_pharmacist=TRUE AND user_row.pharmacist_license_verified_at IS NOT NULL
    AND NULLIF(TRIM(user_row.pharmacist_license_verification_basis),'') IS NOT NULL
    FROM public.users user_row WHERE user_row.user_id=auth.uid()),FALSE);
$$;
CREATE OR REPLACE FUNCTION public.authenticated_user_can_view_rx_oversight()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.authenticated_user_is_admin() OR public.authenticated_user_is_central_sp();
$$;
ALTER FUNCTION public.authenticated_user_is_verified_pharmacist() OWNER TO postgres;
ALTER FUNCTION public.authenticated_user_is_central_sp() OWNER TO postgres;
ALTER FUNCTION public.authenticated_user_can_view_rx_oversight() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.authenticated_user_is_verified_pharmacist() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authenticated_user_is_central_sp() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authenticated_user_can_view_rx_oversight() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authenticated_user_is_verified_pharmacist() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authenticated_user_is_central_sp() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authenticated_user_can_view_rx_oversight() TO authenticated,service_role;

DROP POLICY IF EXISTS rx_destination_sp_select ON public.rx_submissions;
CREATE POLICY rx_destination_sp_select ON public.rx_submissions FOR SELECT TO authenticated USING(
  flow_model='destination_model_a' AND purge_after IS NOT NULL AND purge_after>NOW()
  AND EXISTS(SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id=rx_submissions.destination_pharmacy_id
      AND pharmacy.verification_status='full' AND public.pharmacy_verification_is_current_by_id(pharmacy.id)
      AND ((pharmacy.user_id=auth.uid() AND public.authenticated_user_is_verified_pharmacist())
        OR public.authenticated_user_is_central_sp()))
);
DROP POLICY IF EXISTS rx_audit_oversight_select ON public.rx_audit_records;
CREATE POLICY rx_audit_oversight_select ON public.rx_audit_records FOR SELECT TO authenticated
USING(public.authenticated_user_can_view_rx_oversight());
DROP POLICY IF EXISTS rx_access_log_oversight_select ON public.rx_document_access_logs;
CREATE POLICY rx_access_log_oversight_select ON public.rx_document_access_logs FOR SELECT TO authenticated
USING(public.authenticated_user_can_view_rx_oversight());

-- Dependency triggers can also run from trusted maintenance contexts where
-- auth.uid() is absent. Preserve the owning pharmacy as enabled_by in that case.
CREATE OR REPLACE FUNCTION public.enforce_customer_feature_dependencies()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.feature_key IN ('credit_sales','whatsapp_receipts','loyalty') AND NEW.is_enabled THEN
    UPDATE public.pharmacy_features SET is_enabled=TRUE,enabled_at=COALESCE(enabled_at,NOW()),
      enabled_by=COALESCE(enabled_by,auth.uid(),(SELECT pharmacy.user_id FROM public.pharmacies pharmacy WHERE pharmacy.id=NEW.pharmacy_id)),updated_at=NOW()
    WHERE pharmacy_id=NEW.pharmacy_id AND feature_key='customers';
  ELSIF NEW.feature_key='customers' AND NOT NEW.is_enabled AND EXISTS(
    SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=NEW.pharmacy_id
      AND feature_key IN ('credit_sales','whatsapp_receipts','loyalty') AND is_enabled
  ) THEN RAISE EXCEPTION 'Turn off customer-dependent features before turning off customers'; END IF;
  RETURN NEW;
END;
$$;

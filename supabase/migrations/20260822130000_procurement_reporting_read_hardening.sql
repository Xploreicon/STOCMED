-- Re-state fresh-database privileges for established procurement/reporting
-- screens. Supplier writes remain tenant-filtered by their existing RLS policy;
-- all transactional stock/order work continues through SECURITY DEFINER RPCs.
GRANT SELECT,INSERT,UPDATE ON public.suppliers TO authenticated;
GRANT SELECT ON public.quickbooks_import_staging TO authenticated;

DROP POLICY IF EXISTS sp_audit_owner_read ON public.sp_authorization_audit;
CREATE POLICY sp_audit_owner_read ON public.sp_authorization_audit FOR SELECT TO authenticated USING(
  public.authenticated_user_owns_pharmacy(pharmacy_id) OR public.authenticated_user_is_admin()
);

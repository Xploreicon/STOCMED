-- Dependency propagation must run after a multi-feature statement has finished;
-- BEFORE row triggers can otherwise modify a row that the same statement still
-- intends to visit (for example presets that include both Customers and Credit).
DROP TRIGGER IF EXISTS enforce_customer_feature_dependencies_trigger ON public.pharmacy_features;
CREATE TRIGGER enforce_customer_feature_dependencies_trigger
AFTER INSERT OR UPDATE OF is_enabled ON public.pharmacy_features
FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_feature_dependencies();
DROP TRIGGER IF EXISTS enforce_procurement_feature_dependency_trigger ON public.pharmacy_features;
CREATE TRIGGER enforce_procurement_feature_dependency_trigger
AFTER INSERT OR UPDATE OF is_enabled ON public.pharmacy_features
FOR EACH ROW EXECUTE FUNCTION public.enforce_procurement_feature_dependency();

-- These are authenticated, RLS-filtered read models used by the existing
-- audit and POS verification surfaces. Mutations remain RPC-only.
GRANT SELECT ON public.rx_audit_records,public.rx_document_access_logs TO authenticated;
GRANT SELECT ON public.stock_movements TO authenticated;

-- Smart reorder depends on the procurement workspace. Keep both sides of the
-- relationship consistent even when a feature change is made through the RPC.
CREATE OR REPLACE FUNCTION public.enforce_procurement_feature_dependency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF NEW.feature_key='smart_reorder' AND NEW.is_enabled THEN
    UPDATE public.pharmacy_features SET
      is_enabled=TRUE,
      enabled_at=COALESCE(enabled_at,NOW()),
      enabled_by=COALESCE(enabled_by,auth.uid()),
      updated_at=NOW()
    WHERE pharmacy_id=NEW.pharmacy_id AND feature_key='purchase_orders_and_receiving';
  ELSIF NEW.feature_key='purchase_orders_and_receiving' AND NOT NEW.is_enabled THEN
    UPDATE public.pharmacy_features SET
      is_enabled=FALSE,enabled_at=NULL,enabled_by=NULL,updated_at=NOW()
    WHERE pharmacy_id=NEW.pharmacy_id AND feature_key='smart_reorder' AND is_enabled;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_procurement_feature_dependency_trigger ON public.pharmacy_features;
CREATE TRIGGER enforce_procurement_feature_dependency_trigger
BEFORE INSERT OR UPDATE OF is_enabled ON public.pharmacy_features
FOR EACH ROW EXECUTE FUNCTION public.enforce_procurement_feature_dependency();

REVOKE ALL ON FUNCTION public.enforce_procurement_feature_dependency() FROM PUBLIC,anon,authenticated;

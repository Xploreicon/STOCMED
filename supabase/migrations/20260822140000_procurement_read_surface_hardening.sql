-- Restore the authenticated privileges required by the established procurement
-- screens after the Tier 2 direct-write revocations. Tenant isolation remains
-- enforced by the ownership policies on every table.
GRANT SELECT,UPDATE ON public.purchase_orders TO authenticated;
GRANT SELECT ON public.purchase_order_items TO authenticated;
GRANT SELECT ON public.goods_receipts TO authenticated;
GRANT SELECT ON public.goods_receipt_items TO authenticated;

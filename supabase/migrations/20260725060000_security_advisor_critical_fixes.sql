-- Close the three production Security Advisor critical findings.
--
-- The controlled lookup tables are public-readable catalogue data, but only
-- trusted database/service roles may mutate them. The legacy drugs view remains
-- temporarily available because production query statistics show active
-- PostgREST consumers; SECURITY INVOKER makes its underlying tenant RLS apply.

ALTER TABLE public.dosage_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dosage_forms_public_read ON public.dosage_forms;
CREATE POLICY dosage_forms_public_read
ON public.dosage_forms
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS product_categories_public_read ON public.product_categories;
CREATE POLICY product_categories_public_read
ON public.product_categories
FOR SELECT
TO anon, authenticated
USING (true);

REVOKE ALL ON TABLE public.dosage_forms FROM anon, authenticated;
REVOKE ALL ON TABLE public.product_categories FROM anon, authenticated;
GRANT SELECT ON TABLE public.dosage_forms TO anon, authenticated;
GRANT SELECT ON TABLE public.product_categories TO anon, authenticated;

CREATE OR REPLACE VIEW public.drugs
WITH (security_invoker = true)
AS
SELECT
  inventory.id,
  inventory.pharmacy_id,
  COALESCE(product.brand_name, product.generic_name) AS name,
  product.generic_name,
  product.brand_name,
  product.category,
  product.dosage_form,
  product.strength,
  product.description,
  inventory.price,
  inventory.quantity_in_stock,
  inventory.low_stock_threshold,
  product.requires_prescription,
  product.manufacturer,
  (
    SELECT batch.expiry_date
    FROM public.batches batch
    WHERE batch.inventory_id = inventory.id
    ORDER BY batch.expiry_date
    LIMIT 1
  ) AS expiry_date,
  inventory.created_at,
  inventory.updated_at,
  product.image_url
FROM public.pharmacy_inventory inventory
JOIN public.products product ON product.id = inventory.product_id;

REVOKE ALL ON TABLE public.drugs FROM anon, authenticated;
GRANT SELECT ON TABLE public.drugs TO anon, authenticated;

COMMENT ON VIEW public.drugs IS
  'Temporary security-invoker compatibility view; canonical runtime uses products and pharmacy_inventory.';

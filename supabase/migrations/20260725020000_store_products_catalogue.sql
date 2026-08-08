CREATE TABLE IF NOT EXISTS public.store_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT NOT NULL UNIQUE CHECK (barcode ~ '^[0-9A-Za-z-]{4,64}$'),
  item_name TEXT NOT NULL CHECK (length(trim(item_name)) BETWEEN 2 AND 200),
  brand TEXT,
  manufacturer TEXT,
  pack_size TEXT,
  category TEXT,
  image_url TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_by_pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_products_barcode
  ON public.store_products(barcode);
CREATE INDEX IF NOT EXISTS idx_store_products_unverified
  ON public.store_products(created_at DESC) WHERE is_verified = FALSE;

ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_products_authenticated_read ON public.store_products;
CREATE POLICY store_products_authenticated_read
ON public.store_products FOR SELECT TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS store_products_admin_review ON public.store_products;
CREATE POLICY store_products_admin_review
ON public.store_products FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users app_user
    WHERE app_user.user_id = auth.uid() AND app_user.is_admin = TRUE
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users app_user
    WHERE app_user.user_id = auth.uid() AND app_user.is_admin = TRUE
  )
);

DROP POLICY IF EXISTS store_products_admin_reject ON public.store_products;
CREATE POLICY store_products_admin_reject
ON public.store_products FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users app_user
    WHERE app_user.user_id = auth.uid() AND app_user.is_admin = TRUE
  )
);

-- Creation goes through a function so the submitting pharmacy is derived from
-- the authenticated user and existing catalogue data cannot be overwritten.
CREATE OR REPLACE FUNCTION public.capture_store_product(
  p_pharmacy_id UUID,
  p_barcode TEXT,
  p_item_name TEXT,
  p_brand TEXT DEFAULT NULL,
  p_pack_size TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL
)
RETURNS public.store_products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.store_products%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Pharmacy access required'; END IF;
  IF trim(COALESCE(p_barcode, '')) !~ '^[0-9A-Za-z-]{4,64}$' THEN
    RAISE EXCEPTION 'Enter a valid barcode';
  END IF;
  IF length(trim(COALESCE(p_item_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Item name is required';
  END IF;

  INSERT INTO public.store_products(
    barcode, item_name, brand, pack_size, category, submitted_by_pharmacy_id
  ) VALUES (
    trim(p_barcode), trim(p_item_name), NULLIF(trim(p_brand), ''),
    NULLIF(trim(p_pack_size), ''), NULLIF(trim(p_category), ''), p_pharmacy_id
  )
  ON CONFLICT (barcode) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.store_products WHERE barcode = trim(p_barcode);
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON public.store_products FROM anon;
REVOKE INSERT ON public.store_products FROM authenticated;
GRANT SELECT, UPDATE, DELETE ON public.store_products TO authenticated;
REVOKE ALL ON FUNCTION public.capture_store_product(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_store_product(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

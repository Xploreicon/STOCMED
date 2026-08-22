-- Customers: tenant-scoped records, RPC-only writes, and optional POS sale
-- attribution. Walk-in sales retain a null customer_id.

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  phone TEXT,
  email TEXT,
  consent_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  consent_sms BOOLEAN NOT NULL DEFAULT FALSE,
  consent_email BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 2000),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customers_contact_present CHECK (
    phone IS NOT NULL OR email IS NOT NULL OR char_length(trim(name)) > 0
  )
);

CREATE INDEX IF NOT EXISTS customers_pharmacy_name_idx
  ON public.customers(pharmacy_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_pharmacy_phone_idx
  ON public.customers(pharmacy_id, phone)
  WHERE deleted_at IS NULL AND phone IS NOT NULL;

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_owner_select ON public.customers;
CREATE POLICY customers_owner_select ON public.customers
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.pharmacies pharmacy
  WHERE pharmacy.id = customers.pharmacy_id
    AND pharmacy.user_id = auth.uid()
));

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS customer_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_customer_id_fkey'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS sales_customer_created_idx
  ON public.sales(customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.save_authenticated_customer(p_customer JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pharmacy_id UUID;
  v_customer_id UUID := NULLIF(p_customer->>'id', '')::UUID;
  v_customer public.customers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_customer IS NULL OR jsonb_typeof(p_customer) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_customer) key
    WHERE key NOT IN (
      'id', 'name', 'phone', 'email', 'consent_whatsapp',
      'consent_sms', 'consent_email', 'notes'
    )
  ) THEN RAISE EXCEPTION 'Invalid customer'; END IF;

  SELECT pharmacy.id INTO v_pharmacy_id
  FROM public.pharmacies pharmacy
  WHERE pharmacy.user_id = auth.uid()
  ORDER BY pharmacy.is_active DESC, pharmacy.created_at DESC
  LIMIT 1;
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = v_pharmacy_id
      AND feature.feature_key = 'customers'
      AND feature.is_enabled
  ) THEN RAISE EXCEPTION 'The customers feature is disabled' USING ERRCODE = '42501'; END IF;
  IF NULLIF(TRIM(p_customer->>'name'), '') IS NULL THEN RAISE EXCEPTION 'Customer name is required'; END IF;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (
      pharmacy_id, name, phone, email, consent_whatsapp,
      consent_sms, consent_email, notes
    ) VALUES (
      v_pharmacy_id,
      TRIM(p_customer->>'name'),
      NULLIF(TRIM(p_customer->>'phone'), ''),
      LOWER(NULLIF(TRIM(p_customer->>'email'), '')),
      COALESCE((p_customer->>'consent_whatsapp')::BOOLEAN, FALSE),
      COALESCE((p_customer->>'consent_sms')::BOOLEAN, FALSE),
      COALESCE((p_customer->>'consent_email')::BOOLEAN, FALSE),
      NULLIF(TRIM(p_customer->>'notes'), '')
    ) RETURNING * INTO v_customer;
  ELSE
    UPDATE public.customers SET
      name = TRIM(p_customer->>'name'),
      phone = NULLIF(TRIM(p_customer->>'phone'), ''),
      email = LOWER(NULLIF(TRIM(p_customer->>'email'), '')),
      consent_whatsapp = COALESCE((p_customer->>'consent_whatsapp')::BOOLEAN, FALSE),
      consent_sms = COALESCE((p_customer->>'consent_sms')::BOOLEAN, FALSE),
      consent_email = COALESCE((p_customer->>'consent_email')::BOOLEAN, FALSE),
      notes = NULLIF(TRIM(p_customer->>'notes'), ''),
      updated_at = NOW()
    WHERE id = v_customer_id
      AND pharmacy_id = v_pharmacy_id
      AND deleted_at IS NULL
    RETURNING * INTO v_customer;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  END IF;
  RETURN to_jsonb(v_customer);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_authenticated_customer(p_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pharmacy_id UUID;
BEGIN
  SELECT pharmacy.id INTO v_pharmacy_id
  FROM public.pharmacies pharmacy
  WHERE pharmacy.user_id = auth.uid()
  ORDER BY pharmacy.is_active DESC, pharmacy.created_at DESC
  LIMIT 1;
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = v_pharmacy_id
      AND feature.feature_key = 'customers'
      AND feature.is_enabled
  ) THEN RAISE EXCEPTION 'The customers feature is disabled' USING ERRCODE = '42501'; END IF;

  UPDATE public.customers
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE id = p_customer_id AND pharmacy_id = v_pharmacy_id AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_authenticated_sale_customer(
  p_sale_id UUID,
  p_customer_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pharmacy_id UUID;
BEGIN
  SELECT pharmacy.id INTO v_pharmacy_id
  FROM public.pharmacies pharmacy
  WHERE pharmacy.user_id = auth.uid()
  ORDER BY pharmacy.is_active DESC, pharmacy.created_at DESC
  LIMIT 1;
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = v_pharmacy_id
      AND feature.feature_key = 'customers'
      AND feature.is_enabled
  ) THEN RAISE EXCEPTION 'The customers feature is disabled' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers customer
    WHERE customer.id = p_customer_id
      AND customer.pharmacy_id = v_pharmacy_id
      AND customer.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Customer not found'; END IF;

  UPDATE public.sales
  SET customer_id = p_customer_id, updated_at = NOW()
  WHERE id = p_sale_id AND pharmacy_id = v_pharmacy_id
    AND (customer_id IS NULL OR customer_id = p_customer_id);
  RETURN FOUND;
END;
$$;

REVOKE ALL ON public.customers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customers TO authenticated;
REVOKE ALL ON FUNCTION public.save_authenticated_customer(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_authenticated_customer(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attach_authenticated_sale_customer(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_authenticated_customer(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_authenticated_customer(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_authenticated_sale_customer(UUID, UUID) TO authenticated;

COMMENT ON TABLE public.customers IS
  'Pharmacy-owned customer records. Direct writes are denied; authenticated SECURITY DEFINER RPCs enforce tenant and feature boundaries.';

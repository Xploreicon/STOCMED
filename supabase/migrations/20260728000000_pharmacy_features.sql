-- One authoritative home for every optional pharmacy capability.
CREATE TABLE IF NOT EXISTS public.pharmacy_features (
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_at TIMESTAMPTZ,
  enabled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pharmacy_id, feature_key),
  CONSTRAINT pharmacy_features_known_key CHECK (feature_key IN (
    'packs_and_units', 'staff_accounts', 'customers', 'credit_sales',
    'purchase_orders_and_receiving', 'multi_branch', 'notifications',
    'reservations', 'stock_exchange', 'price_benchmark', 'whatsapp_receipts',
    'loyalty', 'unmet_demand_widget', 'smart_reorder', 'quickbooks_export'
  )),
  CONSTRAINT pharmacy_features_enabled_metadata CHECK (
    (is_enabled AND enabled_at IS NOT NULL AND enabled_by IS NOT NULL)
    OR (NOT is_enabled AND enabled_at IS NULL AND enabled_by IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS pharmacy_features_enabled_idx
  ON public.pharmacy_features(pharmacy_id, feature_key)
  WHERE is_enabled;

ALTER TABLE public.pharmacy_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_features_owner_select ON public.pharmacy_features;
CREATE POLICY pharmacy_features_owner_select ON public.pharmacy_features
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.pharmacies pharmacy
  WHERE pharmacy.id = pharmacy_features.pharmacy_id
    AND pharmacy.user_id = auth.uid()
));

DROP POLICY IF EXISTS pharmacy_features_owner_insert ON public.pharmacy_features;
CREATE POLICY pharmacy_features_owner_insert ON public.pharmacy_features
FOR INSERT TO authenticated
WITH CHECK (
  (enabled_by IS NULL OR enabled_by = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = pharmacy_features.pharmacy_id
      AND pharmacy.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS pharmacy_features_owner_update ON public.pharmacy_features;
CREATE POLICY pharmacy_features_owner_update ON public.pharmacy_features
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.pharmacies pharmacy
  WHERE pharmacy.id = pharmacy_features.pharmacy_id
    AND pharmacy.user_id = auth.uid()
))
WITH CHECK (
  (enabled_by IS NULL OR enabled_by = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = pharmacy_features.pharmacy_id
      AND pharmacy.user_id = auth.uid()
  )
);

-- Every optional capability starts off. Reservations alone preserve the legacy
-- opt-in state during the migration.
INSERT INTO public.pharmacy_features (
  pharmacy_id, feature_key, is_enabled, enabled_at, enabled_by
)
SELECT
  pharmacy.id,
  feature.key,
  CASE WHEN feature.key = 'reservations' THEN pharmacy.reservations_enabled ELSE FALSE END,
  CASE WHEN feature.key = 'reservations' AND pharmacy.reservations_enabled
    THEN COALESCE(pharmacy.updated_at, NOW()) ELSE NULL END,
  CASE WHEN feature.key = 'reservations' AND pharmacy.reservations_enabled
    THEN pharmacy.user_id ELSE NULL END
FROM public.pharmacies pharmacy
CROSS JOIN (VALUES
  ('packs_and_units'), ('staff_accounts'), ('customers'), ('credit_sales'),
  ('purchase_orders_and_receiving'), ('multi_branch'), ('notifications'),
  ('reservations'), ('stock_exchange'), ('price_benchmark'),
  ('whatsapp_receipts'), ('loyalty'), ('unmet_demand_widget'),
  ('smart_reorder'), ('quickbooks_export')
) AS feature(key)
ON CONFLICT (pharmacy_id, feature_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_pharmacy_features()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pharmacy_features(pharmacy_id, feature_key)
  SELECT NEW.id, feature.key
  FROM (VALUES
    ('packs_and_units'), ('staff_accounts'), ('customers'), ('credit_sales'),
    ('purchase_orders_and_receiving'), ('multi_branch'), ('notifications'),
    ('reservations'), ('stock_exchange'), ('price_benchmark'),
    ('whatsapp_receipts'), ('loyalty'), ('unmet_demand_widget'),
    ('smart_reorder'), ('quickbooks_export')
  ) AS feature(key)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_pharmacy_features_after_insert ON public.pharmacies;
CREATE TRIGGER seed_pharmacy_features_after_insert
AFTER INSERT ON public.pharmacies
FOR EACH ROW EXECUTE FUNCTION public.seed_pharmacy_features();

GRANT SELECT, INSERT, UPDATE ON public.pharmacy_features TO authenticated;
REVOKE DELETE ON public.pharmacy_features FROM authenticated, anon;

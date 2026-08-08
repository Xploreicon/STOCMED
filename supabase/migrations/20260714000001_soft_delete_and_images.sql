-- Soft-delete support for pharmacy_inventory (delist without destroying ledger/sales history)
-- and pharmacy-level image override (separate from the shared catalogue image on products).

-- 1. Add soft-delete timestamp column
ALTER TABLE public.pharmacy_inventory
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Add pharmacy-level image override column
ALTER TABLE public.pharmacy_inventory
  ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;

-- 3. Keep the production column order for the inventory notes field.
ALTER TABLE public.pharmacy_inventory
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 4. Partial index for efficient active-item queries
CREATE INDEX IF NOT EXISTS idx_pharmacy_inventory_active
  ON public.pharmacy_inventory (pharmacy_id)
  WHERE deleted_at IS NULL;

-- 5. Update RLS policies to exclude delisted items from patient / anon views
--    while allowing pharmacy owners to see their own delisted rows.

-- Anon: only active + listed items
DROP POLICY IF EXISTS inventory_listed_anon_select ON public.pharmacy_inventory;
CREATE POLICY inventory_listed_anon_select
ON public.pharmacy_inventory
FOR SELECT
TO anon
USING (is_listed = TRUE AND deleted_at IS NULL);

-- Authenticated: pharmacy owners see everything (including delisted);
-- patients/admins see only active + listed.
DROP POLICY IF EXISTS inventory_authenticated_select ON public.pharmacy_inventory;
CREATE POLICY inventory_authenticated_select
ON public.pharmacy_inventory
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.pharmacies ph
        WHERE ph.id = pharmacy_inventory.pharmacy_id
          AND ph.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.users usr
        WHERE usr.user_id = auth.uid()
          AND (
              usr.is_admin = TRUE
              OR (usr.role = 'patient' AND pharmacy_inventory.is_listed = TRUE AND pharmacy_inventory.deleted_at IS NULL)
          )
    )
);

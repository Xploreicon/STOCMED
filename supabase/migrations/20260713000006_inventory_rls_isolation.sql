-- Preserve public/patient discovery while preventing one pharmacy account from
-- directly reading another pharmacy's inventory.

ALTER TABLE public.pharmacy_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anyone to view listed pharmacy inventory"
    ON public.pharmacy_inventory;
DROP POLICY IF EXISTS inventory_listed_anon_select
    ON public.pharmacy_inventory;
DROP POLICY IF EXISTS inventory_authenticated_select
    ON public.pharmacy_inventory;

CREATE POLICY inventory_listed_anon_select
ON public.pharmacy_inventory
FOR SELECT
TO anon
USING (is_listed = TRUE);

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
              OR (usr.role = 'patient' AND pharmacy_inventory.is_listed = TRUE)
          )
    )
);

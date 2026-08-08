-- Follow-up for the Tier 1 authenticated-read hotfix.
--
-- The legacy batch owner-management policy was declared TO public. PostgreSQL
-- therefore evaluated its pharmacies.user_id subquery for anonymous SELECTs,
-- even though anonymous users can never own a pharmacy. Keep ownership checks
-- tenant-derived while preventing anonymous evaluation of owner-only policy.

CREATE OR REPLACE FUNCTION public.authenticated_user_owns_pharmacy(
  p_pharmacy_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.pharmacies AS pharmacy
    WHERE pharmacy.id = p_pharmacy_id
      AND pharmacy.user_id = auth.uid()
  );
$$;

ALTER FUNCTION public.authenticated_user_owns_pharmacy(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.authenticated_user_owns_pharmacy(UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authenticated_user_owns_pharmacy(UUID)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.authenticated_user_owns_pharmacy(UUID) IS
  'Boolean-only tenant ownership check resolved from auth.uid(); accepts no client-supplied user identity.';

DROP POLICY IF EXISTS "Allow current pharmacies' batches to be viewed"
  ON public.batches;
CREATE POLICY "Allow current pharmacies' batches to be viewed"
ON public.batches
FOR SELECT
USING (EXISTS (
  SELECT 1
  FROM public.pharmacy_inventory AS inventory
  JOIN public.pharmacies AS pharmacy
    ON pharmacy.id = inventory.pharmacy_id
  WHERE inventory.id = batches.inventory_id
    AND (
      public.authenticated_user_owns_pharmacy(pharmacy.id)
      OR (
        pharmacy.is_active = TRUE
        AND public.pharmacy_verification_is_current_by_id(pharmacy.id)
      )
    )
));

DROP POLICY IF EXISTS "Allow pharmacies to manage own batches"
  ON public.batches;
CREATE POLICY "Allow pharmacies to manage own batches"
ON public.batches
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.pharmacy_inventory AS inventory
  WHERE inventory.id = batches.inventory_id
    AND public.authenticated_user_owns_pharmacy(inventory.pharmacy_id)
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.pharmacy_inventory AS inventory
  WHERE inventory.id = batches.inventory_id
    AND public.authenticated_user_owns_pharmacy(inventory.pharmacy_id)
));

-- A legacy analytics policy used USING (TRUE) for every role, which OR-ed with
-- the lifecycle policy and exposed inactive/revoked rows to anonymous clients.
-- Service-role analytics bypasses RLS and does not require this policy.
DROP POLICY IF EXISTS "analytics-read-pharmacies" ON public.pharmacies;


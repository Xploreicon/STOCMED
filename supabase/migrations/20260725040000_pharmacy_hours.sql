-- Pharmacy hours were rendered in Settings from 2026-07-05 but had no backing
-- columns, so every save was silently discarded. Keep NULL distinct from closed:
-- NULL means the pharmacy has not supplied reliable hours yet.
ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS opening_time TIME,
  ADD COLUMN IF NOT EXISTS closing_time TIME;

COMMENT ON COLUMN public.pharmacies.opening_time IS
  'Daily public opening time in the pharmacy local timezone (Africa/Lagos for the current pilot).';
COMMENT ON COLUMN public.pharmacies.closing_time IS
  'Daily public closing time; values earlier than opening_time represent overnight operation.';

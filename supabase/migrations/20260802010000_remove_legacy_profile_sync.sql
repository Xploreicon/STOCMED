-- The production baseline retained a legacy AFTER INSERT OR UPDATE trigger
-- that defaulted missing roles to patient and wrote public.users independently.
-- It races the authoritative signup trigger and defeats OAuth no-profile checks.

DROP TRIGGER IF EXISTS sync_user_profile_trigger ON auth.users;
DROP FUNCTION IF EXISTS public.sync_user_profile();

COMMENT ON FUNCTION public.create_required_profile_for_auth_identity(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) IS 'Only authoritative public.users writer for password and Google patient onboarding.';

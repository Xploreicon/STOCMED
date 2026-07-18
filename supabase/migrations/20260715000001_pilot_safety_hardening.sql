-- Safety audit events may only be written by trusted server code using service_role.
DROP POLICY IF EXISTS "Allow anyone to insert triage logs" ON public.triage_logs;
REVOKE INSERT ON TABLE public.triage_logs FROM anon, authenticated;
GRANT INSERT ON TABLE public.triage_logs TO service_role;

-- The prescriptions bucket may already exist, so update its enforcement metadata
-- instead of relying on an INSERT ... ON CONFLICT DO NOTHING migration.
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY[
    'image/png',
    'image/jpeg',
    'application/pdf'
  ]::text[]
WHERE id = 'prescriptions';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'prescriptions') THEN
    RAISE EXCEPTION 'prescriptions storage bucket is missing';
  END IF;
END $$;

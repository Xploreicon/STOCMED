-- Ensure storage schema exists and objects table has RLS (enabled by default in Supabase)
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Create public drug-images storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'drug-images',
  'drug-images',
  true,
  5242880, -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Create PRIVATE prescriptions storage bucket for patient NDPR health data protection
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'prescriptions',
  'prescriptions',
  false, -- PRIVATE bucket: requires signed URL or RLS authorization
  10485760, -- 10MB limit
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public select access to drug-images
DROP POLICY IF EXISTS "Public Access Drug Images" ON storage.objects;
CREATE POLICY "Public Access Drug Images" ON storage.objects
  FOR SELECT USING (bucket_id = 'drug-images');

-- Allow authenticated users to insert drug-images
DROP POLICY IF EXISTS "Authenticated Insert Drug Images" ON storage.objects;
CREATE POLICY "Authenticated Insert Drug Images" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'drug-images' AND auth.uid() IS NOT NULL);

-- Prescriptions Bucket Policies: Private and restricted to authenticated owners / admins
DROP POLICY IF EXISTS "Users Read Own Prescriptions" ON storage.objects;
CREATE POLICY "Users Read Own Prescriptions" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'prescriptions' AND
    (auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text)
  );

DROP POLICY IF EXISTS "Users Upload Own Prescriptions" ON storage.objects;
CREATE POLICY "Users Upload Own Prescriptions" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'prescriptions' AND
    auth.uid() IS NOT NULL AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

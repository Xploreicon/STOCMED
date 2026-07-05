-- Ensure storage schema exists and objects table has RLS (enabled by default in Supabase)
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Create drug-images storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('drug-images', 'drug-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public select access to drug-images
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access" ON storage.objects
  FOR SELECT USING (bucket_id = 'drug-images');

-- Allow authenticated users to insert objects
DROP POLICY IF EXISTS "Authenticated Insert" ON storage.objects;
CREATE POLICY "Authenticated Insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'drug-images' AND auth.uid() IS NOT NULL);

-- Allow authenticated users to update objects
DROP POLICY IF EXISTS "Authenticated Update" ON storage.objects;
CREATE POLICY "Authenticated Update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'drug-images' AND auth.uid() IS NOT NULL);

-- Allow authenticated users to delete objects
DROP POLICY IF EXISTS "Authenticated Delete" ON storage.objects;
CREATE POLICY "Authenticated Delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'drug-images' AND auth.uid() IS NOT NULL);

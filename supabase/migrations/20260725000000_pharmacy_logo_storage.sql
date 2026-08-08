-- Public pharmacy logos. Writes are restricted to the owning pharmacy's folder.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pharmacy-assets',
  'pharmacy-assets',
  TRUE,
  1048576,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS pharmacy_logos_public_read ON storage.objects;
CREATE POLICY pharmacy_logos_public_read
ON storage.objects FOR SELECT
USING (bucket_id = 'pharmacy-assets');

DROP POLICY IF EXISTS pharmacy_logos_owner_insert ON storage.objects;
CREATE POLICY pharmacy_logos_owner_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'pharmacy-assets'
  AND EXISTS (
    SELECT 1
    FROM public.pharmacies pharmacy
    WHERE pharmacy.user_id = auth.uid()
      AND pharmacy.id::TEXT = (storage.foldername(name))[1]
  )
);

DROP POLICY IF EXISTS pharmacy_logos_owner_update ON storage.objects;
CREATE POLICY pharmacy_logos_owner_update
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'pharmacy-assets'
  AND EXISTS (
    SELECT 1
    FROM public.pharmacies pharmacy
    WHERE pharmacy.user_id = auth.uid()
      AND pharmacy.id::TEXT = (storage.foldername(name))[1]
  )
)
WITH CHECK (
  bucket_id = 'pharmacy-assets'
  AND EXISTS (
    SELECT 1
    FROM public.pharmacies pharmacy
    WHERE pharmacy.user_id = auth.uid()
      AND pharmacy.id::TEXT = (storage.foldername(name))[1]
  )
);

DROP POLICY IF EXISTS pharmacy_logos_owner_delete ON storage.objects;
CREATE POLICY pharmacy_logos_owner_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'pharmacy-assets'
  AND EXISTS (
    SELECT 1
    FROM public.pharmacies pharmacy
    WHERE pharmacy.user_id = auth.uid()
      AND pharmacy.id::TEXT = (storage.foldername(name))[1]
  )
);

-- Store supporting-document bytes in a private Supabase Storage bucket.

BEGIN;

ALTER TABLE public.supporting_documents
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'land-application-documents',
  'land-application-documents',
  FALSE,
  5242880,
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'application/json']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS anagu_private_documents_restrict_access ON storage.objects;
CREATE POLICY anagu_private_documents_restrict_access
  ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (bucket_id <> 'land-application-documents')
  WITH CHECK (bucket_id <> 'land-application-documents');

COMMIT;

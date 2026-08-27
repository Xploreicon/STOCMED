-- Durable, tenant-scoped staging for set-based catalogue matching.
--
-- Production catalogue note (2026-08-26): all 300 populated
-- public.products.barcode values are 11 digits and therefore are not valid
-- GTIN-8/12/13/14 values. Do not relax either GTIN constraint below to match
-- those legacy placeholders. The learned crosswalk is the authoritative
-- barcode asset until catalogue barcode data is cleaned separately.

BEGIN;

CREATE TABLE public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_rows INTEGER NOT NULL DEFAULT 0,
  parsed_rows INTEGER NOT NULL DEFAULT 0,
  matched_rows INTEGER NOT NULL DEFAULT 0,
  unmatched_rows INTEGER NOT NULL DEFAULT 0,
  review_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT import_jobs_pharmacy_fkey
    FOREIGN KEY (pharmacy_id) REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  CONSTRAINT import_jobs_status_check CHECK (
    status IN ('pending', 'staging', 'matching', 'review', 'completed', 'failed')
  ),
  CONSTRAINT import_jobs_totals_nonnegative CHECK (
    total_rows >= 0
    AND parsed_rows >= 0
    AND matched_rows >= 0
    AND unmatched_rows >= 0
    AND review_rows >= 0
    AND error_rows >= 0
  )
);

CREATE INDEX import_jobs_pharmacy_created_idx
  ON public.import_jobs (pharmacy_id, created_at DESC);

CREATE INDEX import_jobs_pharmacy_status_idx
  ON public.import_jobs (pharmacy_id, status, updated_at DESC);

CREATE TABLE public.import_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  source_row_number INTEGER NOT NULL,
  raw_name TEXT NOT NULL,
  norm_name TEXT NOT NULL,
  barcode TEXT,
  cost_kobo BIGINT,
  price_kobo BIGINT,
  qty INTEGER,
  min_qty INTEGER,
  expiry DATE,
  parse_error TEXT,
  match_status TEXT NOT NULL DEFAULT 'pending',
  matched_catalogue_id UUID,
  confidence NUMERIC(5,4),
  tier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT import_staging_job_fkey
    FOREIGN KEY (job_id) REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  CONSTRAINT import_staging_catalogue_fkey
    FOREIGN KEY (matched_catalogue_id) REFERENCES public.products(id) ON DELETE SET NULL,
  CONSTRAINT import_staging_job_source_row_key UNIQUE (job_id, source_row_number),
  CONSTRAINT import_staging_source_row_positive CHECK (source_row_number > 0),
  CONSTRAINT import_staging_barcode_gtin_check CHECK (
    barcode IS NULL
    OR (barcode ~ '^[0-9]+$' AND LENGTH(barcode) IN (8, 12, 13, 14))
  ),
  CONSTRAINT import_staging_cost_nonnegative CHECK (cost_kobo IS NULL OR cost_kobo >= 0),
  CONSTRAINT import_staging_price_nonnegative CHECK (price_kobo IS NULL OR price_kobo >= 0),
  CONSTRAINT import_staging_qty_nonnegative CHECK (qty IS NULL OR qty >= 0),
  CONSTRAINT import_staging_min_qty_nonnegative CHECK (min_qty IS NULL OR min_qty >= 0),
  CONSTRAINT import_staging_match_status_check CHECK (
    match_status IN ('pending', 'matched', 'unmatched', 'review', 'error')
  ),
  CONSTRAINT import_staging_confidence_check CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  CONSTRAINT import_staging_tier_check CHECK (
    tier IS NULL
    OR tier IN ('barcode_direct', 'barcode_crosswalk', 'exact', 'fuzzy', 'ai', 'review')
  )
);

CREATE INDEX import_staging_job_match_status_idx
  ON public.import_staging (job_id, match_status, source_row_number);

CREATE INDEX import_staging_matched_catalogue_idx
  ON public.import_staging (matched_catalogue_id)
  WHERE matched_catalogue_id IS NOT NULL;

CREATE TABLE public.barcode_catalogue_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT NOT NULL,
  catalogue_id UUID NOT NULL,
  confirmed_by UUID,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT barcode_catalogue_map_barcode_key UNIQUE (barcode),
  CONSTRAINT barcode_catalogue_map_catalogue_fkey
    FOREIGN KEY (catalogue_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT barcode_catalogue_map_confirmed_by_fkey
    FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT barcode_catalogue_map_source_check CHECK (
    source IN ('name_match', 'review', 'ai')
  ),
  CONSTRAINT barcode_catalogue_map_gtin_check CHECK (
    barcode ~ '^[0-9]+$' AND LENGTH(barcode) IN (8, 12, 13, 14)
  )
);

-- barcode_catalogue_map_barcode_key is the required unique B-tree lookup
-- index. This second index supports reverse inspection and catalogue cleanup.
CREATE INDEX barcode_catalogue_map_catalogue_idx
  ON public.barcode_catalogue_map (catalogue_id);

CREATE FUNCTION public.set_import_matching_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_import_matching_updated_at() FROM PUBLIC;

CREATE TRIGGER import_jobs_set_updated_at
BEFORE UPDATE ON public.import_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_import_matching_updated_at();

CREATE TRIGGER import_staging_set_updated_at
BEFORE UPDATE ON public.import_staging
FOR EACH ROW EXECUTE FUNCTION public.set_import_matching_updated_at();

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barcode_catalogue_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_jobs_owner_select
ON public.import_jobs
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.pharmacies AS pharmacy
  WHERE pharmacy.id = import_jobs.pharmacy_id
    AND pharmacy.user_id = auth.uid()
));

CREATE POLICY import_jobs_owner_insert
ON public.import_jobs
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.pharmacies AS pharmacy
  WHERE pharmacy.id = import_jobs.pharmacy_id
    AND pharmacy.user_id = auth.uid()
));

CREATE POLICY import_jobs_owner_update
ON public.import_jobs
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.pharmacies AS pharmacy
  WHERE pharmacy.id = import_jobs.pharmacy_id
    AND pharmacy.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.pharmacies AS pharmacy
  WHERE pharmacy.id = import_jobs.pharmacy_id
    AND pharmacy.user_id = auth.uid()
));

CREATE POLICY import_jobs_owner_delete
ON public.import_jobs
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.pharmacies AS pharmacy
  WHERE pharmacy.id = import_jobs.pharmacy_id
    AND pharmacy.user_id = auth.uid()
));

CREATE POLICY import_staging_owner_select
ON public.import_staging
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.import_jobs AS job
  JOIN public.pharmacies AS pharmacy ON pharmacy.id = job.pharmacy_id
  WHERE job.id = import_staging.job_id
    AND pharmacy.user_id = auth.uid()
));

CREATE POLICY import_staging_owner_insert
ON public.import_staging
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.import_jobs AS job
  JOIN public.pharmacies AS pharmacy ON pharmacy.id = job.pharmacy_id
  WHERE job.id = import_staging.job_id
    AND pharmacy.user_id = auth.uid()
));

CREATE POLICY import_staging_owner_update
ON public.import_staging
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.import_jobs AS job
  JOIN public.pharmacies AS pharmacy ON pharmacy.id = job.pharmacy_id
  WHERE job.id = import_staging.job_id
    AND pharmacy.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.import_jobs AS job
  JOIN public.pharmacies AS pharmacy ON pharmacy.id = job.pharmacy_id
  WHERE job.id = import_staging.job_id
    AND pharmacy.user_id = auth.uid()
));

CREATE POLICY import_staging_owner_delete
ON public.import_staging
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.import_jobs AS job
  JOIN public.pharmacies AS pharmacy ON pharmacy.id = job.pharmacy_id
  WHERE job.id = import_staging.job_id
    AND pharmacy.user_id = auth.uid()
));

REVOKE ALL ON TABLE public.import_jobs FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.import_staging FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.barcode_catalogue_map FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.import_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.import_staging TO authenticated;
GRANT ALL ON TABLE public.import_jobs TO service_role;
GRANT ALL ON TABLE public.import_staging TO service_role;
GRANT ALL ON TABLE public.barcode_catalogue_map TO service_role;

COMMENT ON TABLE public.import_jobs IS
  'Tenant-owned inventory import lifecycle and progress counters.';
COMMENT ON TABLE public.import_staging IS
  'Normalized, row-addressable inventory import staging for set-based matching.';
COMMENT ON COLUMN public.import_staging.source_row_number IS
  'One-based spreadsheet row number; unique within a job for ordering, errors, and idempotency.';
COMMENT ON TABLE public.barcode_catalogue_map IS
  'Global learned GTIN-to-catalogue crosswalk; direct client access is denied and writes occur through authoritative RPCs.';
COMMENT ON COLUMN public.barcode_catalogue_map.barcode IS
  'Strict GTIN-shaped barcode: digits only with length 8, 12, 13, or 14.';

COMMIT;

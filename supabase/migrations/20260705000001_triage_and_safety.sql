-- 1. Modify users table to support roles
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_licensed_pharmacist BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Create triage_logs table
CREATE TABLE IF NOT EXISTS public.triage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_hash TEXT NOT NULL,
    intent TEXT NOT NULL,
    risk_tier TEXT NOT NULL,
    confidence NUMERIC NOT NULL,
    layers_triggered TEXT[] NOT NULL,
    matched_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    thread_id TEXT,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create thread_locks table
CREATE TABLE IF NOT EXISTS public.thread_locks (
    thread_id TEXT PRIMARY KEY,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lock_reason TEXT NOT NULL, -- 'RESTRICTED' | 'CRISIS'
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- 4. Create triage_config table
CREATE TABLE IF NOT EXISTS public.triage_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key TEXT NOT NULL UNIQUE, -- 'restricted_terms', 'red_flag_terms', 'crisis_terms', 'pom_molecules'
    config_value JSONB NOT NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Create rx_submissions table
CREATE TABLE IF NOT EXISTS public.rx_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    thread_id TEXT,
    product_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted', -- 'submitted', 'under_review', 'verified', 'rejected'
    reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Create symptom_intakes table
CREATE TABLE IF NOT EXISTS public.symptom_intakes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    thread_id TEXT,
    symptoms TEXT NOT NULL,
    duration TEXT,
    severity TEXT, -- 'mild', 'moderate', 'severe'
    age TEXT,
    pregnancy_breastfeeding BOOLEAN DEFAULT FALSE,
    current_medications TEXT,
    allergies TEXT,
    photo_url TEXT,
    status TEXT NOT NULL DEFAULT 'submitted', -- 'submitted', 'under_review', 'answered'
    assigned_pharmacist UUID REFERENCES public.users(id) ON DELETE SET NULL,
    pharmacist_response TEXT,
    sla_deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Create research_consent table
CREATE TABLE IF NOT EXISTS public.research_consent (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
    consented BOOLEAN NOT NULL,
    consent_text_version TEXT NOT NULL,
    sessions_since_consent INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Enable Row Level Security (RLS)
ALTER TABLE public.triage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triage_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rx_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_consent ENABLE ROW LEVEL SECURITY;

-- 9. Setup RLS Policies

-- Triage Logs: Admins can view; system/authenticated/anon can insert
DROP POLICY IF EXISTS "Allow admins to view triage logs" ON public.triage_logs;
CREATE POLICY "Allow admins to view triage logs" ON public.triage_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    );

DROP POLICY IF EXISTS "Allow anyone to insert triage logs" ON public.triage_logs;
CREATE POLICY "Allow anyone to insert triage logs" ON public.triage_logs
    FOR INSERT WITH CHECK (true);

-- Thread Locks: Anyone can view; only admins can manage
DROP POLICY IF EXISTS "Allow anyone to view thread locks" ON public.thread_locks;
CREATE POLICY "Allow anyone to view thread locks" ON public.thread_locks
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow admins to manage thread locks" ON public.thread_locks;
CREATE POLICY "Allow admins to manage thread locks" ON public.thread_locks
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    );

-- Triage Config: Anyone can view; only admins can edit
DROP POLICY IF EXISTS "Allow anyone to view triage config" ON public.triage_config;
CREATE POLICY "Allow anyone to view triage config" ON public.triage_config
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow admins to manage triage config" ON public.triage_config;
CREATE POLICY "Allow admins to manage triage config" ON public.triage_config
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    );

-- Rx Submissions: Users can view/manage own; admins/pharmacists can view/review
DROP POLICY IF EXISTS "Allow users to view own rx submissions" ON public.rx_submissions;
CREATE POLICY "Allow users to view own rx submissions" ON public.rx_submissions
    FOR SELECT USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() AND (users.is_admin = TRUE OR users.is_licensed_pharmacist = TRUE)
        )
    );

DROP POLICY IF EXISTS "Allow users to insert own rx submissions" ON public.rx_submissions;
CREATE POLICY "Allow users to insert own rx submissions" ON public.rx_submissions
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Allow admins/pharmacists to update rx submissions" ON public.rx_submissions;
CREATE POLICY "Allow admins/pharmacists to update rx submissions" ON public.rx_submissions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() AND (users.is_admin = TRUE OR users.is_licensed_pharmacist = TRUE)
        )
    );

-- Symptom Intakes: Users can view/manage own; admins/pharmacists can view/review
DROP POLICY IF EXISTS "Allow users to view own symptom intakes" ON public.symptom_intakes;
CREATE POLICY "Allow users to view own symptom intakes" ON public.symptom_intakes
    FOR SELECT USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() AND (users.is_admin = TRUE OR users.is_licensed_pharmacist = TRUE)
        )
    );

DROP POLICY IF EXISTS "Allow users to insert own symptom intakes" ON public.symptom_intakes;
CREATE POLICY "Allow users to insert own symptom intakes" ON public.symptom_intakes
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Allow admins/pharmacists to update symptom intakes" ON public.symptom_intakes;
CREATE POLICY "Allow admins/pharmacists to update symptom intakes" ON public.symptom_intakes
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() AND (users.is_admin = TRUE OR users.is_licensed_pharmacist = TRUE)
        )
    );

-- Research Consent: Users can view/manage own; admins can view
DROP POLICY IF EXISTS "Allow users/admins to view research consent" ON public.research_consent;
CREATE POLICY "Allow users/admins to view research consent" ON public.research_consent
    FOR SELECT USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() AND users.is_admin = TRUE
        )
    );

DROP POLICY IF EXISTS "Allow users to manage own research consent" ON public.research_consent;
CREATE POLICY "Allow users to manage own research consent" ON public.research_consent
    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 10. Storage Bucket for Prescriptions (Private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('prescriptions', 'prescriptions', false)
ON CONFLICT (id) DO NOTHING;

-- Policies for prescriptions bucket
DROP POLICY IF EXISTS "Allow owner or staff to view prescriptions" ON storage.objects;
CREATE POLICY "Allow owner or staff to view prescriptions" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'prescriptions' AND (
      owner = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() AND (users.is_admin = TRUE OR users.is_licensed_pharmacist = TRUE)
      )
    )
  );

DROP POLICY IF EXISTS "Allow users to upload prescriptions" ON storage.objects;
CREATE POLICY "Allow users to upload prescriptions" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'prescriptions' AND 
    auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Allow owner or staff to manage prescriptions" ON storage.objects;
CREATE POLICY "Allow owner or staff to manage prescriptions" ON storage.objects
  FOR ALL USING (
    bucket_id = 'prescriptions' AND (
      owner = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() AND users.is_admin = TRUE
      )
    )
  );

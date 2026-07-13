-- Repair identity references around the canonical Supabase Auth UUID.
-- public.users.id may be a legacy bigint; public.users.user_id is canonical.

DO $$
DECLARE
    users_id_type TEXT;
BEGIN
    SELECT data_type INTO users_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id';

    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS user_id UUID;

    -- Fresh installations historically used the Auth UUID directly as id.
    IF users_id_type = 'uuid' THEN
        UPDATE public.users SET user_id = id WHERE user_id IS NULL;
    ELSIF users_id_type <> 'bigint' THEN
        RAISE EXCEPTION 'Unsupported public.users.id type: %', users_id_type;
    END IF;

    IF EXISTS (SELECT 1 FROM public.users WHERE user_id IS NULL) THEN
        RAISE EXCEPTION 'Cannot enforce canonical users.user_id: NULL values exist';
    END IF;
    IF (SELECT count(*) FROM public.users) <> (SELECT count(DISTINCT user_id) FROM public.users) THEN
        RAISE EXCEPTION 'Cannot enforce canonical users.user_id: duplicate UUID values exist';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.users usr
        WHERE NOT EXISTS (SELECT 1 FROM auth.users auth_usr WHERE auth_usr.id = usr.user_id)
    ) THEN
        RAISE EXCEPTION 'Cannot enforce canonical users.user_id: UUID missing from auth.users';
    END IF;
END $$;

ALTER TABLE public.users ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_user_id_key;
ALTER TABLE public.users ADD CONSTRAINT users_user_id_key UNIQUE (user_id);
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_user_id_fkey;
ALTER TABLE public.users ADD CONSTRAINT users_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "Allow users to view own profile" ON public.users;
CREATE POLICY "Allow users to view own profile" ON public.users
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Allow users to insert own profile" ON public.users;
CREATE POLICY "Allow users to insert own profile" ON public.users
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Allow users to update own profile" ON public.users;
CREATE POLICY "Allow users to update own profile" ON public.users
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.triage_logs DROP CONSTRAINT IF EXISTS triage_logs_user_id_fkey;
ALTER TABLE public.triage_logs ADD CONSTRAINT triage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.thread_locks DROP CONSTRAINT IF EXISTS thread_locks_user_id_fkey;
ALTER TABLE public.thread_locks ADD CONSTRAINT thread_locks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.triage_config DROP CONSTRAINT IF EXISTS triage_config_updated_by_fkey;
ALTER TABLE public.triage_config ADD CONSTRAINT triage_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.rx_submissions DROP CONSTRAINT IF EXISTS rx_submissions_user_id_fkey;
ALTER TABLE public.rx_submissions ADD CONSTRAINT rx_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.rx_submissions DROP CONSTRAINT IF EXISTS rx_submissions_reviewed_by_fkey;
ALTER TABLE public.rx_submissions ADD CONSTRAINT rx_submissions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.symptom_intakes DROP CONSTRAINT IF EXISTS symptom_intakes_user_id_fkey;
ALTER TABLE public.symptom_intakes ADD CONSTRAINT symptom_intakes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.symptom_intakes DROP CONSTRAINT IF EXISTS symptom_intakes_assigned_pharmacist_fkey;
ALTER TABLE public.symptom_intakes ADD CONSTRAINT symptom_intakes_assigned_pharmacist_fkey FOREIGN KEY (assigned_pharmacist) REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.research_consent DROP CONSTRAINT IF EXISTS research_consent_user_id_fkey;
ALTER TABLE public.research_consent ADD CONSTRAINT research_consent_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;

-- public.drugs remains until runtime retirement is separately verified.
DROP TABLE IF EXISTS public.drugs_old;

-- Recreate triage/admin policies against the canonical users.user_id UUID.
DROP POLICY IF EXISTS "Allow admins to view triage logs" ON public.triage_logs;
CREATE POLICY "Allow admins to view triage logs" ON public.triage_logs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users WHERE users.user_id = auth.uid() AND users.is_admin = TRUE)
    );

DROP POLICY IF EXISTS "Allow anyone to insert triage logs" ON public.triage_logs;
CREATE POLICY "Allow anyone to insert triage logs" ON public.triage_logs
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anyone to view thread locks" ON public.thread_locks;
CREATE POLICY "Allow anyone to view thread locks" ON public.thread_locks
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow admins to manage thread locks" ON public.thread_locks;
CREATE POLICY "Allow admins to manage thread locks" ON public.thread_locks
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE users.user_id = auth.uid() AND users.is_admin = TRUE)
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.users WHERE users.user_id = auth.uid() AND users.is_admin = TRUE)
    );

DROP POLICY IF EXISTS "Allow anyone to view triage config" ON public.triage_config;
CREATE POLICY "Allow anyone to view triage config" ON public.triage_config
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow admins to manage triage config" ON public.triage_config;
CREATE POLICY "Allow admins to manage triage config" ON public.triage_config
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE users.user_id = auth.uid() AND users.is_admin = TRUE)
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.users WHERE users.user_id = auth.uid() AND users.is_admin = TRUE)
    );

DROP POLICY IF EXISTS "Allow users to view own rx submissions" ON public.rx_submissions;
CREATE POLICY "Allow users to view own rx submissions" ON public.rx_submissions
    FOR SELECT USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.user_id = auth.uid() AND (users.is_admin = TRUE OR users.is_licensed_pharmacist = TRUE)
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
            WHERE users.user_id = auth.uid() AND (users.is_admin = TRUE OR users.is_licensed_pharmacist = TRUE)
        )
    );

DROP POLICY IF EXISTS "Allow users to view own symptom intakes" ON public.symptom_intakes;
CREATE POLICY "Allow users to view own symptom intakes" ON public.symptom_intakes
    FOR SELECT USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.user_id = auth.uid() AND (users.is_admin = TRUE OR users.is_licensed_pharmacist = TRUE)
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
            WHERE users.user_id = auth.uid() AND (users.is_admin = TRUE OR users.is_licensed_pharmacist = TRUE)
        )
    );

DROP POLICY IF EXISTS "Allow users/admins to view research consent" ON public.research_consent;
CREATE POLICY "Allow users/admins to view research consent" ON public.research_consent
    FOR SELECT USING (
        user_id = auth.uid() OR
        EXISTS (SELECT 1 FROM public.users WHERE users.user_id = auth.uid() AND users.is_admin = TRUE)
    );

DROP POLICY IF EXISTS "Allow users to manage own research consent" ON public.research_consent;
CREATE POLICY "Allow users to manage own research consent" ON public.research_consent
    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Allow owner or staff to view prescriptions" ON storage.objects;
CREATE POLICY "Allow owner or staff to view prescriptions" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'prescriptions' AND (
            owner = auth.uid() OR
            EXISTS (
                SELECT 1 FROM public.users
                WHERE users.user_id = auth.uid() AND (users.is_admin = TRUE OR users.is_licensed_pharmacist = TRUE)
            )
        )
    );

DROP POLICY IF EXISTS "Allow users to upload prescriptions" ON storage.objects;
CREATE POLICY "Allow users to upload prescriptions" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'prescriptions' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow owner or staff to manage prescriptions" ON storage.objects;
CREATE POLICY "Allow owner or staff to manage prescriptions" ON storage.objects
    FOR ALL USING (
        bucket_id = 'prescriptions' AND (
            owner = auth.uid() OR
            EXISTS (SELECT 1 FROM public.users WHERE users.user_id = auth.uid() AND users.is_admin = TRUE)
        )
    );

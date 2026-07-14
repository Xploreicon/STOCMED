-- Keep patient-visible search history separate from de-identified demand analytics.

CREATE TABLE IF NOT EXISTS public.user_search_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL CHECK (
        length(trim(query_text)) BETWEEN 1 AND 1000
        AND query_text NOT LIKE 'hash:%'
    ),
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    results_count INTEGER CHECK (results_count IS NULL OR results_count >= 0),
    location TEXT,
    searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '365 days')
);

CREATE INDEX IF NOT EXISTS user_search_history_owner_time_idx
    ON public.user_search_history(user_id, searched_at DESC);
CREATE INDEX IF NOT EXISTS user_search_history_expiry_idx
    ON public.user_search_history(expires_at);

ALTER TABLE public.user_search_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own search history" ON public.user_search_history;
CREATE POLICY "Users can read own search history"
    ON public.user_search_history FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can add own search history" ON public.user_search_history;
CREATE POLICY "Users can add own search history"
    ON public.user_search_history FOR INSERT
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own search history" ON public.user_search_history;
CREATE POLICY "Users can delete own search history"
    ON public.user_search_history FOR DELETE
    USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.user_search_history TO authenticated;

-- Recover any old readable owner rows, then remove all identity-linked analytics rows.
-- Existing hash:* values cannot be reversed and must never be presented as history.
INSERT INTO public.user_search_history (
    id, user_id, query_text, product_id, results_count, location, searched_at
)
SELECT id, user_id, query_text, product_id, results_count, location, timestamp
FROM public.searches
WHERE user_id IS NOT NULL
  AND query_text NOT LIKE 'hash:%'
  AND EXISTS (SELECT 1 FROM auth.users WHERE auth.users.id = searches.user_id)
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.searches WHERE user_id IS NOT NULL;

-- Analytics records are anonymous by contract, including at direct API/RLS level.
DROP POLICY IF EXISTS "Allow users to view own searches" ON public.searches;
DROP POLICY IF EXISTS "Allow anyone to insert searches" ON public.searches;
DROP POLICY IF EXISTS "Allow updating own/anonymous searches for click metadata" ON public.searches;
DROP POLICY IF EXISTS "Allow users to delete own searches" ON public.searches;

DROP POLICY IF EXISTS "Allow anonymous demand analytics inserts" ON public.searches;
CREATE POLICY "Allow anonymous demand analytics inserts"
    ON public.searches FOR INSERT
    WITH CHECK (user_id IS NULL AND session_id IS NULL AND metadata IS NULL);

DROP POLICY IF EXISTS "Admins can read de-identified demand analytics" ON public.searches;
CREATE POLICY "Admins can read de-identified demand analytics"
    ON public.searches FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.user_id = auth.uid() AND users.is_admin = TRUE
        )
    );

CREATE OR REPLACE FUNCTION public.purge_expired_user_search_history()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE deleted_count BIGINT;
BEGIN
    DELETE FROM public.user_search_history WHERE expires_at <= NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_user_search_history() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.delete_my_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid(); v_count BIGINT := 0; v_total BIGINT := 0;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
    DELETE FROM public.user_search_history WHERE user_id = v_user;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
    DELETE FROM public.chat_messages WHERE user_id = v_user;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
    DELETE FROM public.searches WHERE user_id = v_user;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
    DELETE FROM public.research_consent WHERE user_id = v_user;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
    DELETE FROM public.thread_locks WHERE user_id = v_user;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
    DELETE FROM public.symptom_intakes WHERE user_id = v_user;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
    DELETE FROM public.rx_submissions WHERE user_id = v_user;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
    UPDATE public.triage_logs SET user_id = NULL WHERE user_id = v_user;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
    RETURN jsonb_build_object('success', TRUE, 'records_removed_or_anonymized', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_data() TO authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-user-search-history') THEN
            PERFORM cron.schedule(
                'purge-expired-user-search-history',
                '23 2 * * *',
                'SELECT public.purge_expired_user_search_history()'
            );
        END IF;
    END IF;
END $$;

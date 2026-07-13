-- NDPR health-data separation, retention, purge, and user erasure.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS source_message_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_source_message_uidx
    ON public.chat_messages(source_message_id) WHERE source_message_id IS NOT NULL;

-- Preserve content for de-identified aggregate analysis, then remove plaintext from identity rows.
-- source_message_id makes this safe after a partially completed prior run.
INSERT INTO public.chat_messages(
    role, content, timestamp, user_id, session_id, content_hash, expires_at, source_message_id
)
SELECT
    role, content, timestamp, NULL, NULL,
    encode(digest(lower(trim(content)), 'sha256'), 'hex'),
    timestamp + INTERVAL '30 days', id
FROM public.chat_messages
WHERE user_id IS NOT NULL
  AND content NOT LIKE 'hash:%'
  AND NOT EXISTS (
      SELECT 1
      FROM public.chat_messages anonymous_copy
      WHERE anonymous_copy.user_id IS NULL
        AND anonymous_copy.session_id IS NULL
        AND anonymous_copy.role = chat_messages.role
        AND anonymous_copy.content = chat_messages.content
        AND anonymous_copy.timestamp = chat_messages.timestamp
  )
ON CONFLICT (source_message_id) WHERE source_message_id IS NOT NULL DO NOTHING;

UPDATE public.chat_messages
SET content_hash = encode(digest(lower(trim(content)), 'sha256'), 'hex'),
    content = 'hash:' || encode(digest(lower(trim(content)), 'sha256'), 'hex'),
    expires_at = COALESCE(expires_at, timestamp + INTERVAL '365 days')
WHERE user_id IS NOT NULL AND content NOT LIKE 'hash:%';

UPDATE public.chat_messages
SET expires_at = COALESCE(expires_at, timestamp + INTERVAL '30 days')
WHERE user_id IS NULL;

ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_no_linked_plaintext;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_no_linked_plaintext
CHECK (user_id IS NULL OR content = 'hash:' || content_hash);
CREATE INDEX IF NOT EXISTS chat_messages_expiry_idx ON public.chat_messages(expires_at);

CREATE OR REPLACE FUNCTION public.purge_expired_health_data()
RETURNS TABLE(chat_messages_deleted BIGINT, searches_deleted BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_chat BIGINT; v_searches BIGINT;
BEGIN
    DELETE FROM public.chat_messages WHERE expires_at <= NOW();
    GET DIAGNOSTICS v_chat = ROW_COUNT;
    DELETE FROM public.searches
    WHERE timestamp <= NOW() - CASE WHEN user_id IS NULL THEN INTERVAL '30 days' ELSE INTERVAL '365 days' END;
    GET DIAGNOSTICS v_searches = ROW_COUNT;
    RETURN QUERY SELECT v_chat, v_searches;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid(); v_count BIGINT := 0; v_total BIGINT := 0;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
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

REVOKE ALL ON FUNCTION public.purge_expired_health_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_my_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_data() TO authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-health-data') THEN
            PERFORM cron.schedule('purge-expired-health-data', '17 2 * * *', 'SELECT public.purge_expired_health_data()');
        END IF;
    END IF;
END $$;

\set ON_ERROR_STOP on

BEGIN;

SELECT
  to_regprocedure('public.purge_expired_health_data()') AS purge_function,
  to_regprocedure('public.delete_my_data()') AS erasure_function;

SELECT user_id AS patient_user_id
FROM public.users
WHERE email = 'patient.test@stocmed.local'
LIMIT 1
\gset

INSERT INTO public.chat_messages(role, content, timestamp, expires_at)
VALUES ('user', 'NDPR transactional purge fixture', now() - interval '31 days', now() - interval '1 day');

SELECT chat_messages_deleted, searches_deleted
FROM public.purge_expired_health_data()
\gset purge_

SELECT (:purge_chat_messages_deleted::bigint >= 1) AS purge_worked
\gset
\if :purge_worked
\else
  \echo 'purge_expired_health_data did not delete the expired fixture'
  \quit 1
\endif

SELECT
  :purge_chat_messages_deleted::bigint AS purged_chat_messages,
  :purge_searches_deleted::bigint AS purged_searches;

INSERT INTO public.chat_messages(
  role, content, timestamp, user_id, content_hash, expires_at
)
SELECT
  'user',
  'hash:' || encode(digest('NDPR transactional erasure fixture', 'sha256'), 'hex'),
  now(),
  :'patient_user_id'::uuid,
  encode(digest('NDPR transactional erasure fixture', 'sha256'), 'hex'),
  now() + interval '365 days';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'patient_user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT public.delete_my_data() AS erasure_result
\gset

SELECT :'erasure_result'::jsonb AS erasure_result;

RESET ROLE;
ROLLBACK;

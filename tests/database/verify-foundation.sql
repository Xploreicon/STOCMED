\set ON_ERROR_STOP on

SELECT
  conrelid::regclass AS child_table,
  a.attname AS child_column,
  confrelid::regclass AS parent_table,
  af.attname AS parent_column
FROM pg_constraint c
JOIN pg_attribute a
  ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
JOIN pg_attribute af
  ON af.attrelid = c.confrelid AND af.attnum = ANY(c.confkey)
WHERE c.contype = 'f'
  AND c.conrelid IN (
    'public.triage_logs'::regclass,
    'public.thread_locks'::regclass,
    'public.triage_config'::regclass,
    'public.rx_submissions'::regclass,
    'public.symptom_intakes'::regclass,
    'public.research_consent'::regclass
  )
ORDER BY 1, 2;

SELECT
  count(*) AS drugs_rows,
  count(*) FILTER (WHERE u.email IS DISTINCT FROM 'pharmacy.test@stocmed.local') AS original_drugs_rows,
  to_regclass('public.drugs') AS drugs_view,
  to_regclass('public.drugs_old') AS drugs_old
FROM public.drugs d
LEFT JOIN public.pharmacies p ON p.id = d.pharmacy_id
LEFT JOIN public.users u ON u.user_id = p.user_id;

SELECT
  count(*) AS users_total,
  count(*) FILTER (WHERE au.id = u.user_id) AS auth_uuid_matches,
  count(*) FILTER (WHERE au.id IS NULL) AS auth_uuid_misses
FROM public.users u
LEFT JOIN auth.users au ON au.id = u.user_id;

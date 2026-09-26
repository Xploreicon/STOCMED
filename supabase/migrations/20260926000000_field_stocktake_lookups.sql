-- Field onboarding additions. Preserve existing values and catalogue references.
BEGIN;

INSERT INTO public.dosage_forms (name) VALUES
  ('suspension'), ('oral drops'), ('eye drops'), ('ear drops'), ('eye/ear drops'),
  ('eye ointment'), ('ointment'), ('lotion'), ('solution'), ('softgel'),
  ('powder'), ('oral powder'), ('sachet'), ('powder / sachet'), ('gel'),
  ('eye gel'), ('mouthwash'), ('suppository'), ('nasal spray'), ('topical spray'),
  ('inhalation solution'), ('nebulizer solution'), ('transdermal patch'),
  ('oil'), ('sanitizer'), ('mixture')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.product_categories (name) VALUES
  ('Anthelmintics / Anti-parasitics'), ('Antiseptics & Disinfectants'),
  ('Ophthalmics (Eye Preparations)'), ('NSAIDs'), ('Corticosteroids'),
  ('Antihistamines / Anti-allergics'), ('Cold, Cough & Flu'),
  ('Antacids & Anti-ulcer'), ('Muscle Relaxants'), ('Antispasmodics'),
  ('Vitamins & Supplements'), ('Joint Care / Osteoarthritis'),
  ('Anticoagulants / Antiplatelets'), ('Hormones / Progestogens'),
  ('Enzymes'), ('Probiotics'), ('Dermatologicals'), ('Antifungals'),
  ('Antivirals'), ('Diuretics'), ('Antifibrinolytics')
ON CONFLICT (name) DO NOTHING;

-- Match the application's route-specific comparisons. Generic drops must not
-- authorize an eye/ear/oral substitution. Keep pre-existing tablet aliases.
CREATE OR REPLACE FUNCTION public.normalize_dosage_form(p_value TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN NULLIF(TRIM(p_value), '') IS NULL THEN NULL
    WHEN LOWER(p_value) ~ '\m(eye|ophthalmic)\M' AND LOWER(p_value) ~ '\m(ear|otic)\M'
      AND LOWER(p_value) LIKE '%drop%' THEN 'eye/ear drops'
    WHEN LOWER(p_value) ~ '\m(eye|ophthalmic)\M' AND LOWER(p_value) LIKE '%drop%' THEN 'eye drops'
    WHEN LOWER(p_value) ~ '\m(ear|otic)\M' AND LOWER(p_value) LIKE '%drop%' THEN 'ear drops'
    WHEN LOWER(p_value) ~ '\moral\M' AND LOWER(p_value) LIKE '%drop%' THEN 'oral drops'
    WHEN LOWER(p_value) ~ '\m(eye|ophthalmic)\M' AND LOWER(p_value) LIKE '%ointment%' THEN 'eye ointment'
    WHEN LOWER(p_value) ~ '\m(ear|otic)\M' AND LOWER(p_value) LIKE '%ointment%' THEN 'ear ointment'
    WHEN LOWER(p_value) ~ '\moral\M' AND LOWER(p_value) LIKE '%ointment%' THEN 'oral ointment'
    WHEN LOWER(p_value) ~ '\m(eye|ophthalmic)\M' AND LOWER(p_value) LIKE '%gel%' THEN 'eye gel'
    WHEN LOWER(p_value) ~ '\m(ear|otic)\M' AND LOWER(p_value) LIKE '%gel%' THEN 'ear gel'
    WHEN LOWER(p_value) ~ '\moral\M' AND LOWER(p_value) LIKE '%gel%' THEN 'oral gel'
    WHEN LOWER(p_value) ~ 'soft\s*gel' THEN 'softgel'
    WHEN LOWER(p_value) ~ '(caplet|tablet|(^|[^a-z])tab([^a-z]|$))' THEN 'tablet'
    WHEN LOWER(p_value) ~ '(capsule|(^|[^a-z])cap([^a-z]|$))' THEN 'capsule'
    WHEN LOWER(p_value) LIKE '%suspension%' THEN 'suspension'
    WHEN LOWER(p_value) LIKE '%syrup%' THEN 'syrup'
    WHEN LOWER(p_value) LIKE '%elixir%' THEN 'elixir'
    WHEN LOWER(p_value) LIKE '%solution%' THEN 'solution'
    WHEN LOWER(p_value) LIKE '%injection%' OR LOWER(p_value) LIKE '%injectable%' THEN 'injection'
    WHEN LOWER(p_value) LIKE '%cream%' THEN 'cream'
    WHEN LOWER(p_value) LIKE '%ointment%' THEN 'ointment'
    WHEN LOWER(p_value) LIKE '%gel%' THEN 'gel'
    WHEN LOWER(p_value) LIKE '%drop%' THEN 'drops'
    WHEN LOWER(p_value) LIKE '%suppositor%' THEN 'suppository'
    WHEN LOWER(p_value) LIKE '%inhal%' THEN 'inhalation'
    ELSE REGEXP_REPLACE(LOWER(TRIM(p_value)), '[^a-z0-9]+', '', 'g')
  END;
$$;

COMMIT;

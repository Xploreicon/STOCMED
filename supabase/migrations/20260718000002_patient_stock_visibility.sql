-- Patient stock visibility follows the pharmacy verification lifecycle and
-- the pharmacy's inventory ledger. products.is_verified remains catalogue
-- quality metadata and is intentionally not rewritten here.

DO $$
BEGIN
  PERFORM set_config('app.pharmacy_verification_transition', 'on', TRUE);
  PERFORM set_config('app.pilot_pharmacy_verification', 'on', TRUE);
  PERFORM set_config('app.reservation_toggle_rpc', 'on', TRUE);

  -- Spirit is the retained operator/test pharmacy. Make it patient-visible for
  -- end-to-end pilot testing, but keep reservations disabled until its real
  -- PCN evidence is confirmed.
  UPDATE public.pharmacies
  SET is_active = TRUE,
      is_verified = FALSE,
      verification_status = 'provisional',
      provisional_started_at = NOW(),
      provisional_expires_at = NOW() + INTERVAL '30 days',
      verification_authorized_at = NULL,
      verification_authorization_basis = NULL,
      verification_documents_evidence_basis = NULL,
      verification_standards_evidence_basis = NULL,
      pcn_confirmation_status = 'to_be_confirmed',
      reservations_enabled = FALSE,
      updated_at = NOW()
  WHERE id = '2937265c-c164-4fda-918f-cb4ece9e29f2'::UUID;

  PERFORM set_config('app.reservation_toggle_rpc', 'off', TRUE);
  PERFORM set_config('app.pilot_pharmacy_verification', 'off', TRUE);
  PERFORM set_config('app.pharmacy_verification_transition', 'off', TRUE);

  IF NOT EXISTS (
    SELECT 1
    FROM public.pharmacies
    WHERE id = '2937265c-c164-4fda-918f-cb4ece9e29f2'::UUID
      AND is_active
      AND verification_status = 'provisional'
      AND provisional_expires_at > NOW() + INTERVAL '29 days'
      AND reservations_enabled = FALSE
  ) THEN
    RAISE EXCEPTION 'Spirit patient-test visibility provisioning failed';
  END IF;
END;
$$;

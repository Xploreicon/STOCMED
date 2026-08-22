-- WhatsApp receipt initiation audit. The message is opened by the cashier in
-- wa.me; no WhatsApp provider credentials or background delivery are involved.

ALTER TABLE public.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check,
  DROP CONSTRAINT IF EXISTS notification_deliveries_provider_check,
  DROP CONSTRAINT IF EXISTS notification_deliveries_status_check,
  DROP CONSTRAINT IF EXISTS pending_delivery_has_recipient;
ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check
    CHECK (channel IN ('email','sms','push','whatsapp')),
  ADD CONSTRAINT notification_deliveries_provider_check
    CHECK (provider IN ('resend','termii','web_push','wa_me')),
  ADD CONSTRAINT notification_deliveries_status_check
    CHECK (status IN ('pending','queued','sending','sent','delivered','retry','failed','skipped','initiated')),
  ADD CONSTRAINT pending_delivery_has_recipient CHECK (
    status IN ('sent','delivered','failed','skipped','initiated')
    OR recipient IS NOT NULL OR notification_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.log_whatsapp_receipt_share(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_pharmacy_id UUID := public.authenticated_pharmacy_id();
  v_sale public.sales%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_delivery public.notification_deliveries%ROWTYPE;
  v_key TEXT;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = v_pharmacy_id
      AND feature.feature_key = 'whatsapp_receipts' AND feature.is_enabled
  ) THEN RAISE EXCEPTION 'The WhatsApp receipts feature is disabled' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_sale FROM public.sales sale
  WHERE sale.id = p_sale_id AND sale.pharmacy_id = v_pharmacy_id AND sale.status = 'completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Completed sale not found'; END IF;
  SELECT * INTO v_customer FROM public.customers customer
  WHERE customer.id = v_sale.customer_id AND customer.pharmacy_id = v_pharmacy_id
    AND customer.deleted_at IS NULL;
  IF NOT FOUND OR v_customer.phone IS NULL OR NOT v_customer.consent_whatsapp THEN
    RAISE EXCEPTION 'Customer WhatsApp consent and phone are required';
  END IF;

  v_key := 'whatsapp-receipt:' || p_sale_id::TEXT;
  INSERT INTO public.notification_deliveries(
    channel,notification_type,provider,pharmacy_id,user_id,recipient_hash,
    idempotency_key,status,payload,attempts,sent_at
  ) VALUES (
    'whatsapp','sale_receipt','wa_me',v_pharmacy_id,auth.uid(),
    encode(digest(lower(trim(v_customer.phone)),'sha256'),'hex'),
    v_key,'initiated',jsonb_build_object('sale_id',p_sale_id),1,NOW()
  )
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING * INTO v_delivery;
  IF NOT FOUND THEN
    SELECT * INTO v_delivery FROM public.notification_deliveries
    WHERE idempotency_key = v_key AND pharmacy_id = v_pharmacy_id;
  END IF;
  RETURN jsonb_build_object('success',TRUE,'delivery_id',v_delivery.id,'duplicate',v_delivery.created_at < NOW()-INTERVAL '1 second');
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_customer_feature_dependencies()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.feature_key IN ('credit_sales','whatsapp_receipts') AND NEW.is_enabled THEN
    UPDATE public.pharmacy_features SET
      is_enabled=TRUE,enabled_at=COALESCE(enabled_at,NOW()),
      enabled_by=COALESCE(enabled_by,auth.uid()),updated_at=NOW()
    WHERE pharmacy_id=NEW.pharmacy_id AND feature_key='customers';
  ELSIF NEW.feature_key='customers' AND NOT NEW.is_enabled AND EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id=NEW.pharmacy_id
      AND feature.feature_key IN ('credit_sales','whatsapp_receipts')
      AND feature.is_enabled
  ) THEN
    RAISE EXCEPTION 'Turn off customer-dependent features before turning off customers';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_whatsapp_receipt_share(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_whatsapp_receipt_share(UUID) TO authenticated;

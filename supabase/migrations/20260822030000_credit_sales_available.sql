-- Credit sales: append-only customer ledger, limits, atomic POS credit posting,
-- part payments, write-offs, aging, and opt-in SP control.

ALTER TYPE public.payment_method_type ADD VALUE IF NOT EXISTS 'credit';

CREATE TABLE IF NOT EXISTS public.customer_credit_limits (
  customer_id UUID PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.customer_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES public.sales(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('credit_sale', 'payment', 'write_off')),
  amount NUMERIC(12,2) NOT NULL CHECK (
    (entry_type = 'credit_sale' AND amount > 0)
    OR (entry_type IN ('payment', 'write_off') AND amount < 0)
  ),
  balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  request_key TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_credit_sale_unique_idx
  ON public.customer_credit_ledger(sale_id)
  WHERE entry_type = 'credit_sale';
CREATE INDEX IF NOT EXISTS customer_credit_ledger_customer_created_idx
  ON public.customer_credit_ledger(customer_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customer_credit_ledger_pharmacy_created_idx
  ON public.customer_credit_ledger(pharmacy_id, created_at DESC);

ALTER TABLE public.customer_credit_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_credit_limits_owner_select ON public.customer_credit_limits
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.pharmacies pharmacy
  WHERE pharmacy.id = customer_credit_limits.pharmacy_id AND pharmacy.user_id = auth.uid()
));
CREATE POLICY customer_credit_ledger_owner_select ON public.customer_credit_ledger
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.pharmacies pharmacy
  WHERE pharmacy.id = customer_credit_ledger.pharmacy_id AND pharmacy.user_id = auth.uid()
));

ALTER TABLE public.pharmacy_sp_action_gates
  DROP CONSTRAINT IF EXISTS pharmacy_sp_action_gates_known_action;
ALTER TABLE public.pharmacy_sp_action_gates
  ADD CONSTRAINT pharmacy_sp_action_gates_known_action CHECK (action_key IN (
    'large_discount', 'price_change', 'stock_adjustment', 'delist_inventory',
    'restore_inventory', 'void_or_refund', 'pharmacy_settings',
    'financial_reports', 'data_export', 'staff_accounts', 'credit_controls'
  ));
INSERT INTO public.pharmacy_sp_action_gates(pharmacy_id, action_key)
SELECT id, 'credit_controls' FROM public.pharmacies ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_customer_feature_dependencies()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.feature_key = 'credit_sales' AND NEW.is_enabled THEN
    UPDATE public.pharmacy_features SET
      is_enabled = TRUE,
      enabled_at = COALESCE(enabled_at, NOW()),
      enabled_by = COALESCE(enabled_by, auth.uid()),
      updated_at = NOW()
    WHERE pharmacy_id = NEW.pharmacy_id AND feature_key = 'customers';
  ELSIF NEW.feature_key = 'customers' AND NOT NEW.is_enabled AND EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = NEW.pharmacy_id
      AND feature.feature_key = 'credit_sales'
      AND feature.is_enabled
  ) THEN
    RAISE EXCEPTION 'Turn off credit sales before turning off customers';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_customer_feature_dependencies_trigger ON public.pharmacy_features;
CREATE TRIGGER enforce_customer_feature_dependencies_trigger
BEFORE INSERT OR UPDATE OF is_enabled ON public.pharmacy_features
FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_feature_dependencies();

CREATE OR REPLACE FUNCTION public.set_authenticated_feature_sp_gate(
  p_action_key TEXT,
  p_is_gated BOOLEAN,
  p_current_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pharmacy public.pharmacies%ROWTYPE;
  v_verification JSONB;
BEGIN
  IF p_action_key NOT IN ('credit_controls') THEN RAISE EXCEPTION 'Unknown feature control'; END IF;
  SELECT * INTO v_pharmacy FROM public.pharmacies pharmacy
  WHERE pharmacy.user_id = auth.uid()
  ORDER BY pharmacy.is_active DESC, pharmacy.created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF v_pharmacy.sp_code_hash IS NOT NULL THEN
    v_verification := public.verify_current_sp_code(
      v_pharmacy.id, p_current_code, 'change_sp_gates', 'Change ' || p_action_key || ' protection'
    );
    IF NOT COALESCE((v_verification->>'success')::BOOLEAN, FALSE) THEN RETURN v_verification; END IF;
  END IF;
  INSERT INTO public.pharmacy_sp_action_gates(pharmacy_id, action_key, is_gated, updated_at, updated_by)
  VALUES (v_pharmacy.id, p_action_key, p_is_gated, NOW(), auth.uid())
  ON CONFLICT (pharmacy_id, action_key) DO UPDATE SET
    is_gated = EXCLUDED.is_gated, updated_at = NOW(), updated_by = auth.uid();
  DELETE FROM public.sp_authorization_grants WHERE pharmacy_id = v_pharmacy.id;
  RETURN jsonb_build_object('success', TRUE, 'action_key', p_action_key, 'is_gated', p_is_gated);
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_sp_action(
  p_pharmacy_id UUID,
  p_code TEXT,
  p_action TEXT,
  p_target_description TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pharmacy public.pharmacies%ROWTYPE;
  v_token TEXT;
  v_failures INTEGER;
BEGIN
  IF p_action NOT IN (
    'large_discount', 'price_change', 'stock_adjustment',
    'delist_inventory', 'restore_inventory', 'void_or_refund',
    'pharmacy_settings', 'financial_reports', 'data_export', 'staff_accounts',
    'credit_controls'
  ) THEN RAISE EXCEPTION 'Unknown superintendent action'; END IF;
  SELECT * INTO v_pharmacy FROM public.pharmacies pharmacy
  WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF v_pharmacy.sp_code_hash IS NULL THEN RAISE EXCEPTION 'Set the superintendent code in settings first'; END IF;
  IF v_pharmacy.sp_locked_until IS NOT NULL AND v_pharmacy.sp_locked_until > NOW() THEN
    INSERT INTO public.sp_authorization_audit(pharmacy_id,actor_user_id,action,target_description,succeeded,failure_reason)
    VALUES (p_pharmacy_id,auth.uid(),p_action,p_target_description,FALSE,'Temporarily locked');
    RETURN '__ERROR__:Too many failed attempts. Try again later';
  END IF;
  IF p_code !~ '^[0-9]{6}$' OR crypt(p_code, v_pharmacy.sp_code_hash) <> v_pharmacy.sp_code_hash THEN
    v_failures := v_pharmacy.sp_failed_attempts + 1;
    UPDATE public.pharmacies SET
      sp_failed_attempts = CASE WHEN v_failures >= 5 THEN 0 ELSE v_failures END,
      sp_locked_until = CASE WHEN v_failures >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END
    WHERE id = p_pharmacy_id;
    INSERT INTO public.sp_authorization_audit(pharmacy_id,actor_user_id,action,target_description,succeeded,failure_reason)
    VALUES (p_pharmacy_id,auth.uid(),p_action,p_target_description,FALSE,'Code rejected');
    RETURN CASE WHEN v_failures >= 5
      THEN '__ERROR__:Too many failed attempts. Try again in 15 minutes'
      ELSE '__ERROR__:Incorrect superintendent code' END;
  END IF;
  UPDATE public.pharmacies SET sp_failed_attempts = 0, sp_locked_until = NULL WHERE id = p_pharmacy_id;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.sp_authorization_grants(pharmacy_id,actor_user_id,token_hash,action,expires_at)
  VALUES (p_pharmacy_id,auth.uid(),encode(digest(v_token,'sha256'),'hex'),p_action,
    NOW() + make_interval(mins => v_pharmacy.sp_grace_minutes));
  INSERT INTO public.sp_authorization_audit(pharmacy_id,actor_user_id,action,target_description,succeeded)
  VALUES (p_pharmacy_id,auth.uid(),p_action,p_target_description,TRUE);
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_customer_credit_limit(
  p_customer_id UUID,
  p_credit_limit NUMERIC,
  p_sp_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pharmacy_id UUID := public.authenticated_pharmacy_id();
  v_row public.customer_credit_limits%ROWTYPE;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF p_credit_limit IS NULL OR p_credit_limit < 0 THEN RAISE EXCEPTION 'Credit limit must be zero or more'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = v_pharmacy_id AND feature.feature_key = 'credit_sales' AND feature.is_enabled
  ) THEN RAISE EXCEPTION 'The credit sales feature is disabled' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers customer
    WHERE customer.id = p_customer_id AND customer.pharmacy_id = v_pharmacy_id AND customer.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF NOT public.verify_gated_sp_action(v_pharmacy_id,p_sp_token,'credit_controls','Set customer credit limit') THEN
    RETURN jsonb_build_object('success',FALSE,'code','SP_AUTH_REQUIRED','error','Superintendent authorization is required or has expired.');
  END IF;
  INSERT INTO public.customer_credit_limits(customer_id,pharmacy_id,credit_limit,updated_by)
  VALUES (p_customer_id,v_pharmacy_id,p_credit_limit,auth.uid())
  ON CONFLICT (customer_id) DO UPDATE SET credit_limit = EXCLUDED.credit_limit, updated_by = auth.uid(), updated_at = NOW()
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('success',TRUE,'limit',to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_pos_credit_sale_with_shift(
  p_pharmacy_id UUID,
  p_sale JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_customer_id UUID := NULLIF(p_sale->>'customer_id','')::UUID;
  v_sale_id UUID := (p_sale->>'id')::UUID;
  v_limit NUMERIC := 0;
  v_balance NUMERIC := 0;
  v_total NUMERIC;
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies pharmacy
    WHERE pharmacy.id = p_pharmacy_id AND pharmacy.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  IF p_sale->>'payment_method' <> 'credit' THEN RAISE EXCEPTION 'Credit payment method required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = p_pharmacy_id AND feature.feature_key = 'credit_sales' AND feature.is_enabled
  ) THEN RAISE EXCEPTION 'The credit sales feature is disabled' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = p_pharmacy_id AND feature.feature_key = 'customers' AND feature.is_enabled
  ) THEN RAISE EXCEPTION 'The customers feature is disabled' USING ERRCODE = '42501'; END IF;
  IF NOT public.verify_gated_sp_action(
    p_pharmacy_id,p_sale->>'credit_authorization_token','credit_controls','Credit sale ' || v_sale_id::TEXT
  ) THEN RETURN jsonb_build_object('success',FALSE,'code','SP_AUTH_REQUIRED','error','Superintendent authorization is required for this credit sale.'); END IF;

  SELECT * INTO v_customer FROM public.customers customer
  WHERE customer.id = v_customer_id AND customer.pharmacy_id = p_pharmacy_id AND customer.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A valid customer is required for credit'; END IF;
  SELECT credit_limit INTO v_limit FROM public.customer_credit_limits WHERE customer_id = v_customer_id;
  v_limit := COALESCE(v_limit,0);
  SELECT COALESCE(SUM(amount),0) INTO v_balance
  FROM public.customer_credit_ledger WHERE customer_id = v_customer_id;

  IF EXISTS (
    SELECT 1 FROM public.customer_credit_ledger
    WHERE sale_id = v_sale_id AND entry_type = 'credit_sale'
  ) THEN
    RETURN public.sync_pos_sale_with_shift(p_pharmacy_id,p_sale) || jsonb_build_object('credit_balance',v_balance,'credit_replayed',TRUE);
  END IF;

  v_result := public.sync_pos_sale_with_shift(p_pharmacy_id,p_sale);
  IF NOT COALESCE((v_result->>'success')::BOOLEAN,FALSE) THEN RETURN v_result; END IF;
  v_total := (v_result->>'total')::NUMERIC;
  IF v_balance + v_total > v_limit THEN
    RAISE EXCEPTION 'Credit limit exceeded. Available credit is %', GREATEST(v_limit - v_balance,0);
  END IF;

  UPDATE public.sales SET customer_id = v_customer_id, updated_at = NOW()
  WHERE id = v_sale_id AND pharmacy_id = p_pharmacy_id;
  INSERT INTO public.customer_credit_ledger(
    pharmacy_id,customer_id,sale_id,entry_type,amount,balance_after,notes,request_key,created_by
  ) VALUES (
    p_pharmacy_id,v_customer_id,v_sale_id,'credit_sale',v_total,v_balance+v_total,
    'Credit sale ' || upper(left(v_sale_id::TEXT,8)),'credit-sale:' || v_sale_id::TEXT,auth.uid()
  );
  RETURN v_result || jsonb_build_object('credit_balance',v_balance+v_total,'credit_replayed',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_customer_credit_adjustment(
  p_customer_id UUID,
  p_entry_type TEXT,
  p_amount NUMERIC,
  p_notes TEXT,
  p_request_key TEXT,
  p_sp_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pharmacy_id UUID := public.authenticated_pharmacy_id();
  v_balance NUMERIC;
  v_row public.customer_credit_ledger%ROWTYPE;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF p_entry_type NOT IN ('payment','write_off') THEN RAISE EXCEPTION 'Entry must be a payment or write-off'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  IF NULLIF(TRIM(p_request_key),'') IS NULL THEN RAISE EXCEPTION 'Request key is required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = v_pharmacy_id AND feature.feature_key = 'credit_sales' AND feature.is_enabled
  ) THEN RAISE EXCEPTION 'The credit sales feature is disabled' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.customers customer
  WHERE customer.id = p_customer_id AND customer.pharmacy_id = v_pharmacy_id AND customer.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF p_entry_type = 'write_off' AND NOT public.verify_gated_sp_action(
    v_pharmacy_id,p_sp_token,'credit_controls','Write off customer credit'
  ) THEN RETURN jsonb_build_object('success',FALSE,'code','SP_AUTH_REQUIRED','error','Superintendent authorization is required or has expired.'); END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_balance FROM public.customer_credit_ledger WHERE customer_id = p_customer_id;
  IF p_amount > v_balance THEN RAISE EXCEPTION 'Amount exceeds the outstanding balance'; END IF;
  INSERT INTO public.customer_credit_ledger(
    pharmacy_id,customer_id,entry_type,amount,balance_after,notes,request_key,created_by
  ) VALUES (
    v_pharmacy_id,p_customer_id,p_entry_type,-p_amount,v_balance-p_amount,NULLIF(TRIM(p_notes),''),TRIM(p_request_key),auth.uid()
  )
  ON CONFLICT (request_key) DO NOTHING RETURNING * INTO v_row;
  IF NOT FOUND THEN SELECT * INTO v_row FROM public.customer_credit_ledger WHERE request_key = TRIM(p_request_key) AND pharmacy_id = v_pharmacy_id; END IF;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Request key belongs to another pharmacy'; END IF;
  RETURN jsonb_build_object('success',TRUE,'entry',to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_credit_report(
  p_from DATE DEFAULT CURRENT_DATE - 29,
  p_to DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pharmacy_id UUID := public.authenticated_pharmacy_id();
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_features feature
    WHERE feature.pharmacy_id = v_pharmacy_id AND feature.feature_key = 'credit_sales' AND feature.is_enabled
  ) THEN RAISE EXCEPTION 'The credit sales feature is disabled' USING ERRCODE = '42501'; END IF;
  IF p_from > p_to OR p_to - p_from > 366 THEN RAISE EXCEPTION 'Invalid reporting range'; END IF;
  RETURN jsonb_build_object(
    'customers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'customer_id', customer.id, 'name', customer.name, 'phone', customer.phone,
        'balance', COALESCE(ledger.balance,0), 'credit_limit', COALESCE(limits.credit_limit,0),
        'available_credit', GREATEST(COALESCE(limits.credit_limit,0)-COALESCE(ledger.balance,0),0),
        'last_activity', ledger.last_activity
      ) ORDER BY COALESCE(ledger.balance,0) DESC, customer.name), '[]'::jsonb)
      FROM public.customers customer
      LEFT JOIN LATERAL (
        SELECT SUM(amount) balance, MAX(created_at) last_activity
        FROM public.customer_credit_ledger entry WHERE entry.customer_id = customer.id
      ) ledger ON TRUE
      LEFT JOIN public.customer_credit_limits limits ON limits.customer_id = customer.id
      WHERE customer.pharmacy_id = v_pharmacy_id AND customer.deleted_at IS NULL
    ),
    'summary', (
      WITH balances AS (
        SELECT customer_id, SUM(amount) balance FROM public.customer_credit_ledger
        WHERE pharmacy_id = v_pharmacy_id GROUP BY customer_id
      ), credits AS (
        SELECT entry.customer_id, entry.amount, entry.created_at, balances.balance,
          COALESCE(SUM(entry.amount) OVER (
            PARTITION BY entry.customer_id ORDER BY entry.created_at DESC, entry.id DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),0) newer_credit
        FROM public.customer_credit_ledger entry JOIN balances USING(customer_id)
        WHERE entry.entry_type = 'credit_sale' AND balances.balance > 0
      ), remaining AS (
        SELECT created_at, LEAST(amount,GREATEST(balance-newer_credit,0)) amount
        FROM credits
      )
      SELECT jsonb_build_object(
        'outstanding', COALESCE((SELECT SUM(balance) FROM balances),0),
        'age_0_30', COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW()-INTERVAL '30 days'),0),
        'age_31_60', COALESCE(SUM(amount) FILTER (WHERE created_at < NOW()-INTERVAL '30 days' AND created_at >= NOW()-INTERVAL '60 days'),0),
        'age_61_90', COALESCE(SUM(amount) FILTER (WHERE created_at < NOW()-INTERVAL '60 days' AND created_at >= NOW()-INTERVAL '90 days'),0),
        'age_90_plus', COALESCE(SUM(amount) FILTER (WHERE created_at < NOW()-INTERVAL '90 days'),0),
        'credit_in_period', COALESCE((SELECT SUM(amount) FROM public.customer_credit_ledger
          WHERE pharmacy_id = v_pharmacy_id AND entry_type = 'credit_sale'
            AND created_at >= p_from::timestamptz AND created_at < (p_to+1)::timestamptz),0),
        'payments_in_period', COALESCE(-(SELECT SUM(amount) FROM public.customer_credit_ledger
          WHERE pharmacy_id = v_pharmacy_id AND entry_type = 'payment'
            AND created_at >= p_from::timestamptz AND created_at < (p_to+1)::timestamptz),0),
        'write_offs_in_period', COALESCE(-(SELECT SUM(amount) FROM public.customer_credit_ledger
          WHERE pharmacy_id = v_pharmacy_id AND entry_type = 'write_off'
            AND created_at >= p_from::timestamptz AND created_at < (p_to+1)::timestamptz),0)
      ) FROM remaining
    )
  );
END;
$$;

REVOKE ALL ON public.customer_credit_limits, public.customer_credit_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customer_credit_limits, public.customer_credit_ledger TO authenticated;
REVOKE ALL ON FUNCTION public.set_authenticated_feature_sp_gate(TEXT,BOOLEAN,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_customer_credit_limit(UUID,NUMERIC,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_pos_credit_sale_with_shift(UUID,JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_customer_credit_adjustment(UUID,TEXT,NUMERIC,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_credit_report(DATE,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_authenticated_feature_sp_gate(TEXT,BOOLEAN,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_credit_limit(UUID,NUMERIC,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_pos_credit_sale_with_shift(UUID,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_credit_adjustment(UUID,TEXT,NUMERIC,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_credit_report(DATE,DATE) TO authenticated;

CREATE TABLE public.pharmacy_loyalty_config (
  pharmacy_id UUID PRIMARY KEY REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  points_per_naira NUMERIC(12,6) NOT NULL DEFAULT 0.01 CHECK(points_per_naira>=0 AND points_per_naira<=10),
  redemption_naira_per_point NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK(redemption_naira_per_point>0 AND redemption_naira_per_point<=10000),
  minimum_redemption_points INTEGER NOT NULL DEFAULT 100 CHECK(minimum_redemption_points BETWEEN 1 AND 1000000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE TABLE public.customer_loyalty_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES public.sales(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('earn','redeem','earn_reversal','redeem_reversal')),
  points INTEGER NOT NULL CHECK(points<>0),
  balance_after INTEGER NOT NULL CHECK(balance_after>=0),
  naira_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(naira_value>=0),
  request_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX customer_loyalty_points_customer_idx ON public.customer_loyalty_points(customer_id,created_at DESC);
CREATE INDEX customer_loyalty_points_pharmacy_idx ON public.customer_loyalty_points(pharmacy_id,created_at DESC);
ALTER TABLE public.pharmacy_loyalty_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_loyalty_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY pharmacy_loyalty_config_owner_select ON public.pharmacy_loyalty_config FOR SELECT TO authenticated USING (EXISTS(
  SELECT 1 FROM public.pharmacies pharmacy WHERE pharmacy.id=pharmacy_loyalty_config.pharmacy_id AND pharmacy.user_id=auth.uid()
));
CREATE POLICY customer_loyalty_points_owner_select ON public.customer_loyalty_points FOR SELECT TO authenticated USING (EXISTS(
  SELECT 1 FROM public.pharmacies pharmacy WHERE pharmacy.id=customer_loyalty_points.pharmacy_id AND pharmacy.user_id=auth.uid()
));
INSERT INTO public.pharmacy_loyalty_config(pharmacy_id) SELECT id FROM public.pharmacies ON CONFLICT DO NOTHING;

ALTER TABLE public.sales ADD COLUMN loyalty_points_earned INTEGER NOT NULL DEFAULT 0 CHECK(loyalty_points_earned>=0);
ALTER TABLE public.sales ADD COLUMN loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0 CHECK(loyalty_points_redeemed>=0);
ALTER TABLE public.sales ADD COLUMN loyalty_discount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(loyalty_discount>=0);

CREATE OR REPLACE FUNCTION public.set_loyalty_config(
  p_points_per_naira NUMERIC,p_redemption_naira_per_point NUMERIC,p_minimum_redemption_points INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_pharmacy_id UUID:=public.authenticated_pharmacy_id(); v_row public.pharmacy_loyalty_config%ROWTYPE;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='loyalty' AND is_enabled)
    THEN RAISE EXCEPTION 'The loyalty feature is disabled' USING ERRCODE='42501'; END IF;
  IF p_points_per_naira IS NULL OR p_points_per_naira<0 OR p_points_per_naira>10
    OR p_redemption_naira_per_point IS NULL OR p_redemption_naira_per_point<=0 OR p_redemption_naira_per_point>10000
    OR p_minimum_redemption_points IS NULL OR p_minimum_redemption_points<1 OR p_minimum_redemption_points>1000000
    THEN RAISE EXCEPTION 'Check the loyalty earning and redemption settings'; END IF;
  INSERT INTO public.pharmacy_loyalty_config(pharmacy_id,points_per_naira,redemption_naira_per_point,minimum_redemption_points,updated_by)
  VALUES(v_pharmacy_id,p_points_per_naira,p_redemption_naira_per_point,p_minimum_redemption_points,auth.uid())
  ON CONFLICT(pharmacy_id) DO UPDATE SET points_per_naira=EXCLUDED.points_per_naira,
    redemption_naira_per_point=EXCLUDED.redemption_naira_per_point,minimum_redemption_points=EXCLUDED.minimum_redemption_points,
    updated_at=NOW(),updated_by=auth.uid() RETURNING * INTO v_row;
  RETURN jsonb_build_object('success',TRUE,'config',to_jsonb(v_row)-'updated_by');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_loyalty(p_customer_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_pharmacy_id UUID:=public.authenticated_pharmacy_id(); v_config public.pharmacy_loyalty_config%ROWTYPE;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='loyalty' AND is_enabled)
    THEN RAISE EXCEPTION 'The loyalty feature is disabled' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id AND pharmacy_id=v_pharmacy_id AND deleted_at IS NULL)
    THEN RAISE EXCEPTION 'Customer not found'; END IF;
  SELECT * INTO v_config FROM public.pharmacy_loyalty_config WHERE pharmacy_id=v_pharmacy_id;
  RETURN jsonb_build_object(
    'customer_id',p_customer_id,
    'balance',COALESCE((SELECT SUM(points) FROM public.customer_loyalty_points WHERE customer_id=p_customer_id),0),
    'config',jsonb_build_object('points_per_naira',COALESCE(v_config.points_per_naira,0.01),
      'redemption_naira_per_point',COALESCE(v_config.redemption_naira_per_point,1),
      'minimum_redemption_points',COALESCE(v_config.minimum_redemption_points,100)),
    'entries',(SELECT COALESCE(jsonb_agg(to_jsonb(entry) ORDER BY entry.created_at DESC),'[]'::jsonb) FROM(
      SELECT id,entry_type,points,balance_after,naira_value,sale_id,created_at
      FROM public.customer_loyalty_points WHERE customer_id=p_customer_id ORDER BY created_at DESC LIMIT 50
    ) entry)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_pos_featured_sale_with_shift(p_pharmacy_id UUID,p_sale JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE
  v_pharmacy_id UUID:=public.authenticated_pharmacy_id(); v_sale_id UUID:=(p_sale->>'id')::UUID;
  v_customer_id UUID:=NULLIF(p_sale->>'customer_id','')::UUID; v_staff_auth JSONB; v_staff_id UUID;
  v_result JSONB; v_base_sale JSONB; v_manual_discount NUMERIC; v_requested_points INTEGER:=0;
  v_balance INTEGER:=0; v_points_per_naira NUMERIC:=0.01; v_naira_per_point NUMERIC:=1; v_minimum INTEGER:=100;
  v_loyalty_discount NUMERIC:=0; v_total NUMERIC; v_earned INTEGER:=0;
BEGIN
  IF v_pharmacy_id IS NULL OR v_pharmacy_id<>p_pharmacy_id THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='loyalty' AND is_enabled)
    THEN RAISE EXCEPTION 'The loyalty feature is disabled' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.sales WHERE id=v_sale_id AND pharmacy_id=v_pharmacy_id AND status='completed') THEN
    RETURN (SELECT jsonb_build_object('success',TRUE,'id',sale.id,'replayed',TRUE,'total',sale.total,
      'loyalty_points_earned',sale.loyalty_points_earned,'loyalty_points_redeemed',sale.loyalty_points_redeemed,'loyalty_discount',sale.loyalty_discount)
      FROM public.sales sale WHERE sale.id=v_sale_id);
  END IF;
  IF COALESCE(p_sale->>'loyalty_points_redeemed','0') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Loyalty points must be a whole number'; END IF;
  v_requested_points:=COALESCE((p_sale->>'loyalty_points_redeemed')::INTEGER,0);
  v_manual_discount:=COALESCE(NULLIF(p_sale->>'manual_discount','')::NUMERIC,
    GREATEST(COALESCE((p_sale->>'discount')::NUMERIC,0)-COALESCE(NULLIF(p_sale->>'loyalty_discount','')::NUMERIC,0),0));
  v_base_sale:=jsonb_set(p_sale,'{discount}',to_jsonb(v_manual_discount),TRUE);

  IF EXISTS(SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='staff_accounts' AND is_enabled) THEN
    v_staff_auth:=public.authorize_staff_permission(p_sale->>'staff_session_token','can_sell');
    IF NOT COALESCE((v_staff_auth->>'allowed')::BOOLEAN,FALSE) THEN
      RETURN jsonb_build_object('success',FALSE,'code',v_staff_auth->>'code','error',v_staff_auth->>'error'); END IF;
    v_staff_id:=(v_staff_auth->>'staff_id')::UUID;
  END IF;

  IF v_customer_id IS NOT NULL THEN
    PERFORM 1 FROM public.customers WHERE id=v_customer_id AND pharmacy_id=v_pharmacy_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
    SELECT points_per_naira,redemption_naira_per_point,minimum_redemption_points
    INTO v_points_per_naira,v_naira_per_point,v_minimum FROM public.pharmacy_loyalty_config WHERE pharmacy_id=v_pharmacy_id;
    v_points_per_naira:=COALESCE(v_points_per_naira,0.01); v_naira_per_point:=COALESCE(v_naira_per_point,1); v_minimum:=COALESCE(v_minimum,100);
    SELECT COALESCE(SUM(points),0)::INTEGER INTO v_balance FROM public.customer_loyalty_points WHERE customer_id=v_customer_id;
    IF v_requested_points>0 THEN
      IF p_sale->>'payment_method'='credit' THEN RAISE EXCEPTION 'Loyalty points cannot be redeemed on a credit sale'; END IF;
      IF v_requested_points<v_minimum THEN RAISE EXCEPTION 'The minimum loyalty redemption is % points',v_minimum; END IF;
      IF v_requested_points>v_balance THEN RAISE EXCEPTION 'Customer loyalty balance changed. Refresh it and try again'; END IF;
      v_loyalty_discount:=ROUND(v_requested_points*v_naira_per_point,2);
    END IF;
  ELSIF v_requested_points>0 THEN RAISE EXCEPTION 'Choose a customer before redeeming loyalty points'; END IF;

  IF p_sale->>'payment_method'='credit' THEN v_result:=public.sync_pos_credit_sale_with_shift(v_pharmacy_id,v_base_sale);
  ELSE v_result:=public.sync_pos_sale_with_shift(v_pharmacy_id,v_base_sale); END IF;
  IF NOT COALESCE((v_result->>'success')::BOOLEAN,FALSE) THEN RETURN v_result; END IF;
  SELECT total INTO v_total FROM public.sales WHERE id=v_sale_id AND pharmacy_id=v_pharmacy_id FOR UPDATE;
  IF v_loyalty_discount>v_total THEN RAISE EXCEPTION 'Loyalty redemption cannot exceed the amount due'; END IF;

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.sales SET customer_id=v_customer_id WHERE id=v_sale_id AND pharmacy_id=v_pharmacy_id;
    IF v_requested_points>0 THEN
      v_balance:=v_balance-v_requested_points;
      INSERT INTO public.customer_loyalty_points(pharmacy_id,customer_id,sale_id,entry_type,points,balance_after,naira_value,request_key,created_by)
      VALUES(v_pharmacy_id,v_customer_id,v_sale_id,'redeem',-v_requested_points,v_balance,v_loyalty_discount,'loyalty:sale:'||v_sale_id||':redeem',auth.uid())
      ON CONFLICT(request_key) DO NOTHING;
      UPDATE public.sales SET discount=discount+v_loyalty_discount,total=total-v_loyalty_discount,
        loyalty_points_redeemed=v_requested_points,loyalty_discount=v_loyalty_discount WHERE id=v_sale_id;
      v_total:=v_total-v_loyalty_discount;
    END IF;
    v_earned:=FLOOR(GREATEST(v_total,0)*v_points_per_naira)::INTEGER;
    IF v_earned>0 THEN
      v_balance:=v_balance+v_earned;
      INSERT INTO public.customer_loyalty_points(pharmacy_id,customer_id,sale_id,entry_type,points,balance_after,naira_value,request_key,created_by)
      VALUES(v_pharmacy_id,v_customer_id,v_sale_id,'earn',v_earned,v_balance,0,'loyalty:sale:'||v_sale_id||':earn',auth.uid())
      ON CONFLICT(request_key) DO NOTHING;
      UPDATE public.sales SET loyalty_points_earned=v_earned WHERE id=v_sale_id;
    END IF;
  END IF;
  IF v_staff_id IS NOT NULL THEN UPDATE public.sales SET staff_id=v_staff_id WHERE id=v_sale_id AND (staff_id IS NULL OR staff_id=v_staff_id); END IF;
  RETURN v_result||jsonb_build_object('total',v_total,'staff_id',v_staff_id,'loyalty_points_earned',v_earned,
    'loyalty_points_redeemed',v_requested_points,'loyalty_discount',v_loyalty_discount,'loyalty_balance',v_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_loyalty_report(p_from DATE,p_to DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_pharmacy_id UUID:=public.authenticated_pharmacy_id(); v_config public.pharmacy_loyalty_config%ROWTYPE;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='loyalty' AND is_enabled)
    THEN RAISE EXCEPTION 'The loyalty feature is disabled' USING ERRCODE='42501'; END IF;
  IF p_from>p_to OR p_to-p_from>366 THEN RAISE EXCEPTION 'Invalid reporting range'; END IF;
  SELECT * INTO v_config FROM public.pharmacy_loyalty_config WHERE pharmacy_id=v_pharmacy_id;
  RETURN jsonb_build_object('config',to_jsonb(v_config)-'updated_by',
    'summary',jsonb_build_object(
      'points_issued',COALESCE((SELECT SUM(points) FROM public.customer_loyalty_points WHERE pharmacy_id=v_pharmacy_id AND entry_type='earn' AND created_at>=p_from::timestamptz AND created_at<(p_to+1)::timestamptz),0),
      'points_redeemed',COALESCE(-(SELECT SUM(points) FROM public.customer_loyalty_points WHERE pharmacy_id=v_pharmacy_id AND entry_type='redeem' AND created_at>=p_from::timestamptz AND created_at<(p_to+1)::timestamptz),0),
      'outstanding',COALESCE((SELECT SUM(points) FROM public.customer_loyalty_points WHERE pharmacy_id=v_pharmacy_id),0),
      'redemption_value',COALESCE((SELECT SUM(naira_value) FROM public.customer_loyalty_points WHERE pharmacy_id=v_pharmacy_id AND entry_type='redeem' AND created_at>=p_from::timestamptz AND created_at<(p_to+1)::timestamptz),0)
    ),
    'customers',(SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.balance DESC,row_data.name),'[]'::jsonb) FROM(
      SELECT customer.id customer_id,customer.name,customer.phone,COALESCE(SUM(points.points),0)::INTEGER balance,MAX(points.created_at) last_activity
      FROM public.customers customer LEFT JOIN public.customer_loyalty_points points ON points.customer_id=customer.id
      WHERE customer.pharmacy_id=v_pharmacy_id AND customer.deleted_at IS NULL GROUP BY customer.id,customer.name,customer.phone
    ) row_data));
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_customer_feature_dependencies()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.feature_key IN ('credit_sales','whatsapp_receipts','loyalty') AND NEW.is_enabled THEN
    UPDATE public.pharmacy_features SET is_enabled=TRUE,enabled_at=COALESCE(enabled_at,NOW()),
      enabled_by=COALESCE(enabled_by,auth.uid()),updated_at=NOW()
    WHERE pharmacy_id=NEW.pharmacy_id AND feature_key='customers';
  ELSIF NEW.feature_key='customers' AND NOT NEW.is_enabled AND EXISTS(
    SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=NEW.pharmacy_id
      AND feature_key IN ('credit_sales','whatsapp_receipts','loyalty') AND is_enabled
  ) THEN RAISE EXCEPTION 'Turn off customer-dependent features before turning off customers'; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON public.pharmacy_loyalty_config,public.customer_loyalty_points FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.pharmacy_loyalty_config,public.customer_loyalty_points TO authenticated;
REVOKE ALL ON FUNCTION public.set_loyalty_config(NUMERIC,NUMERIC,INTEGER) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_customer_loyalty(UUID) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.sync_pos_featured_sale_with_shift(UUID,JSONB) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_loyalty_report(DATE,DATE) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_loyalty_config(NUMERIC,NUMERIC,INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_loyalty(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_pos_featured_sale_with_shift(UUID,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_loyalty_report(DATE,DATE) TO authenticated;

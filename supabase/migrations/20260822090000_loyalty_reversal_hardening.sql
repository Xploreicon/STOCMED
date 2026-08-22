-- Reversing a completed sale restores redeemed points and removes as many of
-- that sale's earned points as remain, without ever creating a negative balance.
CREATE OR REPLACE FUNCTION public.reconcile_loyalty_sale_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_customer_id UUID; v_balance INTEGER; v_earned INTEGER; v_redeemed INTEGER; v_remove INTEGER;
BEGIN
  IF OLD.status<>'completed' OR NEW.status NOT IN ('voided','refunded') THEN RETURN NEW; END IF;
  SELECT customer_id INTO v_customer_id FROM public.sales WHERE id=NEW.id;
  IF v_customer_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.customers WHERE id=v_customer_id FOR UPDATE;
  SELECT COALESCE(SUM(points),0)::INTEGER INTO v_balance FROM public.customer_loyalty_points WHERE customer_id=v_customer_id;
  SELECT COALESCE(SUM(points) FILTER(WHERE entry_type='earn'),0)::INTEGER,
    COALESCE(-SUM(points) FILTER(WHERE entry_type='redeem'),0)::INTEGER
  INTO v_earned,v_redeemed FROM public.customer_loyalty_points WHERE sale_id=NEW.id;
  IF v_redeemed>0 THEN
    v_balance:=v_balance+v_redeemed;
    INSERT INTO public.customer_loyalty_points(pharmacy_id,customer_id,sale_id,entry_type,points,balance_after,naira_value,request_key,created_by)
    VALUES(NEW.pharmacy_id,v_customer_id,NEW.id,'redeem_reversal',v_redeemed,v_balance,NEW.loyalty_discount,
      'loyalty:sale:'||NEW.id||':redeem-reversal',auth.uid()) ON CONFLICT(request_key) DO NOTHING;
  END IF;
  v_remove:=LEAST(v_earned,v_balance);
  IF v_remove>0 THEN
    v_balance:=v_balance-v_remove;
    INSERT INTO public.customer_loyalty_points(pharmacy_id,customer_id,sale_id,entry_type,points,balance_after,naira_value,request_key,created_by)
    VALUES(NEW.pharmacy_id,v_customer_id,NEW.id,'earn_reversal',-v_remove,v_balance,0,
      'loyalty:sale:'||NEW.id||':earn-reversal',auth.uid()) ON CONFLICT(request_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reconcile_loyalty_sale_reversal_trigger ON public.sales;
CREATE TRIGGER reconcile_loyalty_sale_reversal_trigger
AFTER UPDATE OF status ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.reconcile_loyalty_sale_reversal();
REVOKE ALL ON FUNCTION public.reconcile_loyalty_sale_reversal() FROM PUBLIC,anon,authenticated;

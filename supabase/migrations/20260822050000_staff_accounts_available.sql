-- Staff accounts: owner-managed identities, bcrypt PINs, lockout, scoped
-- permission sessions, POS attribution, and staff/shift performance reports.

CREATE TABLE IF NOT EXISTS public.pharmacy_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  role TEXT NOT NULL CHECK (role IN ('owner','pharmacist','technician','cashier')),
  pin_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  permissions JSONB NOT NULL DEFAULT '{"can_sell":true,"can_adjust_stock":false,"can_view_reports":false,"can_change_prices":false,"can_refund":false}'::JSONB,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (pin_failed_attempts BETWEEN 0 AND 5),
  pin_locked_until TIMESTAMPTZ,
  last_authenticated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pharmacy_staff_permissions_object CHECK (jsonb_typeof(permissions)='object')
);

CREATE INDEX IF NOT EXISTS pharmacy_staff_active_name_idx
  ON public.pharmacy_staff(pharmacy_id,lower(name)) WHERE is_active;
ALTER TABLE public.pharmacy_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY pharmacy_staff_owner_select ON public.pharmacy_staff
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.pharmacies pharmacy
  WHERE pharmacy.id=pharmacy_staff.pharmacy_id AND pharmacy.user_id=auth.uid()
));

CREATE TABLE IF NOT EXISTS public.pharmacy_staff_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.pharmacy_staff(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pharmacy_staff_sessions_active_idx
  ON public.pharmacy_staff_sessions(pharmacy_id,expires_at)
  WHERE revoked_at IS NULL;
ALTER TABLE public.pharmacy_staff_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS staff_id UUID;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='sales_staff_id_fkey' AND conrelid='public.sales'::regclass
  ) THEN ALTER TABLE public.sales ADD CONSTRAINT sales_staff_id_fkey
    FOREIGN KEY(staff_id) REFERENCES public.pharmacy_staff(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sales_staff_created_idx ON public.sales(staff_id,created_at DESC) WHERE staff_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.staff_permissions_normalized(p_permissions JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path=public
AS $$
DECLARE v_key TEXT;
BEGIN
  IF p_permissions IS NULL OR jsonb_typeof(p_permissions)<>'object' THEN RAISE EXCEPTION 'Permissions must be an object'; END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_permissions) LOOP
    IF v_key NOT IN ('can_sell','can_adjust_stock','can_view_reports','can_change_prices','can_refund')
       OR jsonb_typeof(p_permissions->v_key)<>'boolean' THEN RAISE EXCEPTION 'Unknown or invalid staff permission'; END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'can_sell',COALESCE((p_permissions->>'can_sell')::BOOLEAN,FALSE),
    'can_adjust_stock',COALESCE((p_permissions->>'can_adjust_stock')::BOOLEAN,FALSE),
    'can_view_reports',COALESCE((p_permissions->>'can_view_reports')::BOOLEAN,FALSE),
    'can_change_prices',COALESCE((p_permissions->>'can_change_prices')::BOOLEAN,FALSE),
    'can_refund',COALESCE((p_permissions->>'can_refund')::BOOLEAN,FALSE)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_authenticated_staff(
  p_staff JSONB,
  p_pin TEXT,
  p_sp_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth,extensions
AS $$
DECLARE
  v_pharmacy_id UUID:=public.authenticated_pharmacy_id();
  v_id UUID:=NULLIF(p_staff->>'id','')::UUID;
  v_row public.pharmacy_staff%ROWTYPE;
  v_permissions JSONB;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pharmacy_features feature WHERE feature.pharmacy_id=v_pharmacy_id AND feature.feature_key='staff_accounts' AND feature.is_enabled)
    THEN RAISE EXCEPTION 'The staff accounts feature is disabled' USING ERRCODE='42501'; END IF;
  IF NOT public.verify_gated_sp_action(v_pharmacy_id,p_sp_token,'staff_accounts','Create or edit staff account') THEN
    RETURN jsonb_build_object('success',FALSE,'code','SP_AUTH_REQUIRED','error','Superintendent authorization is required or has expired.');
  END IF;
  IF p_staff IS NULL OR jsonb_typeof(p_staff)<>'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_staff) key WHERE key NOT IN ('id','name','role','permissions')
  ) THEN RAISE EXCEPTION 'Invalid staff details'; END IF;
  IF NULLIF(TRIM(p_staff->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Staff name is required'; END IF;
  IF p_staff->>'role' NOT IN ('owner','pharmacist','technician','cashier') THEN RAISE EXCEPTION 'Choose a valid staff role'; END IF;
  v_permissions:=public.staff_permissions_normalized(COALESCE(p_staff->'permissions','{}'::jsonb));
  IF v_id IS NULL THEN
    IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN RAISE EXCEPTION 'PIN must contain 4 to 6 digits'; END IF;
    INSERT INTO public.pharmacy_staff(pharmacy_id,name,role,pin_hash,permissions)
    VALUES(v_pharmacy_id,TRIM(p_staff->>'name'),p_staff->>'role',crypt(p_pin,gen_salt('bf',12)),v_permissions)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.pharmacy_staff SET name=TRIM(p_staff->>'name'),role=p_staff->>'role',permissions=v_permissions,updated_at=NOW()
    WHERE id=v_id AND pharmacy_id=v_pharmacy_id RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  END IF;
  RETURN jsonb_build_object('success',TRUE,'staff',(to_jsonb(v_row)-'pin_hash'-'pin_failed_attempts'));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_authenticated_staff_active(
  p_staff_id UUID,p_is_active BOOLEAN,p_sp_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth
AS $$
DECLARE v_pharmacy_id UUID:=public.authenticated_pharmacy_id();
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='staff_accounts' AND is_enabled)
    THEN RAISE EXCEPTION 'The staff accounts feature is disabled' USING ERRCODE='42501'; END IF;
  IF NOT public.verify_gated_sp_action(v_pharmacy_id,p_sp_token,'staff_accounts','Change staff account status') THEN
    RETURN jsonb_build_object('success',FALSE,'code','SP_AUTH_REQUIRED','error','Superintendent authorization is required or has expired.'); END IF;
  UPDATE public.pharmacy_staff SET is_active=p_is_active,updated_at=NOW(),pin_failed_attempts=0,pin_locked_until=NULL
  WHERE id=p_staff_id AND pharmacy_id=v_pharmacy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  IF NOT p_is_active THEN UPDATE public.pharmacy_staff_sessions SET revoked_at=NOW() WHERE staff_id=p_staff_id AND revoked_at IS NULL; END IF;
  RETURN jsonb_build_object('success',TRUE,'id',p_staff_id,'is_active',p_is_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_authenticated_staff_pin(
  p_staff_id UUID,p_new_pin TEXT,p_sp_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions
AS $$
DECLARE v_pharmacy_id UUID:=public.authenticated_pharmacy_id();
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{4,6}$' THEN RAISE EXCEPTION 'PIN must contain 4 to 6 digits'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='staff_accounts' AND is_enabled)
    THEN RAISE EXCEPTION 'The staff accounts feature is disabled' USING ERRCODE='42501'; END IF;
  IF NOT public.verify_gated_sp_action(v_pharmacy_id,p_sp_token,'staff_accounts','Reset staff PIN') THEN
    RETURN jsonb_build_object('success',FALSE,'code','SP_AUTH_REQUIRED','error','Superintendent authorization is required or has expired.'); END IF;
  UPDATE public.pharmacy_staff SET pin_hash=crypt(p_new_pin,gen_salt('bf',12)),pin_failed_attempts=0,pin_locked_until=NULL,updated_at=NOW()
  WHERE id=p_staff_id AND pharmacy_id=v_pharmacy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  UPDATE public.pharmacy_staff_sessions SET revoked_at=NOW() WHERE staff_id=p_staff_id AND revoked_at IS NULL;
  RETURN jsonb_build_object('success',TRUE,'id',p_staff_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.authenticate_pharmacy_staff(p_staff_id UUID,p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions
AS $$
DECLARE
  v_pharmacy_id UUID:=public.authenticated_pharmacy_id();
  v_staff public.pharmacy_staff%ROWTYPE;
  v_failures INTEGER;
  v_token TEXT;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='staff_accounts' AND is_enabled)
    THEN RAISE EXCEPTION 'The staff accounts feature is disabled' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_staff FROM public.pharmacy_staff WHERE id=p_staff_id AND pharmacy_id=v_pharmacy_id FOR UPDATE;
  IF NOT FOUND OR NOT v_staff.is_active THEN RAISE EXCEPTION 'Staff account is not active'; END IF;
  IF v_staff.pin_locked_until IS NOT NULL AND v_staff.pin_locked_until>NOW() THEN
    RETURN jsonb_build_object('success',FALSE,'code','STAFF_PIN_LOCKED','error','Too many attempts. Try again later.','locked_until',v_staff.pin_locked_until);
  END IF;
  IF p_pin IS NULL OR crypt(p_pin,v_staff.pin_hash)<>v_staff.pin_hash THEN
    v_failures:=v_staff.pin_failed_attempts+1;
    UPDATE public.pharmacy_staff SET
      pin_failed_attempts=CASE WHEN v_failures>=5 THEN 0 ELSE v_failures END,
      pin_locked_until=CASE WHEN v_failures>=5 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END,
      updated_at=NOW() WHERE id=v_staff.id;
    RETURN jsonb_build_object('success',FALSE,
      'code',CASE WHEN v_failures>=5 THEN 'STAFF_PIN_LOCKED' ELSE 'STAFF_PIN_INVALID' END,
      'error',CASE WHEN v_failures>=5 THEN 'Too many attempts. Try again in 15 minutes.' ELSE 'Incorrect PIN.' END,
      'attempts_remaining',GREATEST(5-v_failures,0));
  END IF;
  UPDATE public.pharmacy_staff SET pin_failed_attempts=0,pin_locked_until=NULL,last_authenticated_at=NOW(),updated_at=NOW() WHERE id=v_staff.id;
  v_token:=encode(gen_random_bytes(32),'hex');
  INSERT INTO public.pharmacy_staff_sessions(pharmacy_id,staff_id,token_hash,expires_at)
  VALUES(v_pharmacy_id,v_staff.id,encode(digest(v_token,'sha256'),'hex'),NOW()+INTERVAL '12 hours');
  RETURN jsonb_build_object('success',TRUE,'token',v_token,'expires_at',NOW()+INTERVAL '12 hours',
    'staff',jsonb_build_object('id',v_staff.id,'name',v_staff.name,'role',v_staff.role,'permissions',v_staff.permissions));
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_staff_permission(p_session_token TEXT,p_permission TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions
AS $$
DECLARE v_pharmacy_id UUID:=public.authenticated_pharmacy_id(); v_staff public.pharmacy_staff%ROWTYPE; v_session_id UUID;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF p_permission NOT IN ('can_sell','can_adjust_stock','can_view_reports','can_change_prices','can_refund') THEN RAISE EXCEPTION 'Unknown staff permission'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='staff_accounts' AND is_enabled) THEN
    RETURN jsonb_build_object('allowed',TRUE,'staff_id',NULL,'staff_name',NULL,'feature_enabled',FALSE);
  END IF;
  IF NULLIF(TRIM(p_session_token),'') IS NULL THEN RETURN jsonb_build_object('allowed',FALSE,'code','STAFF_AUTH_REQUIRED','error','Choose a staff member and enter their PIN.'); END IF;
  SELECT staff.id,staff.pharmacy_id,staff.name,staff.role,staff.pin_hash,staff.is_active,
    staff.permissions,staff.pin_failed_attempts,staff.pin_locked_until,staff.last_authenticated_at,
    staff.created_at,staff.updated_at,session.id
  INTO v_staff.id,v_staff.pharmacy_id,v_staff.name,v_staff.role,v_staff.pin_hash,v_staff.is_active,
    v_staff.permissions,v_staff.pin_failed_attempts,v_staff.pin_locked_until,v_staff.last_authenticated_at,
    v_staff.created_at,v_staff.updated_at,v_session_id
  FROM public.pharmacy_staff_sessions session JOIN public.pharmacy_staff staff ON staff.id=session.staff_id
  WHERE session.pharmacy_id=v_pharmacy_id AND session.token_hash=encode(digest(p_session_token,'sha256'),'hex')
    AND session.revoked_at IS NULL AND session.expires_at>NOW() AND staff.is_active;
  IF v_session_id IS NULL THEN RETURN jsonb_build_object('allowed',FALSE,'code','STAFF_SESSION_EXPIRED','error','Staff session expired. Enter the PIN again.'); END IF;
  IF COALESCE((v_staff.permissions->>p_permission)::BOOLEAN,FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed',FALSE,'code','STAFF_PERMISSION_DENIED','error','This staff member does not have permission for this action.','staff_id',v_staff.id);
  END IF;
  UPDATE public.pharmacy_staff_sessions SET last_used_at=NOW() WHERE id=v_session_id;
  RETURN jsonb_build_object('allowed',TRUE,'staff_id',v_staff.id,'staff_name',v_staff.name,'role',v_staff.role,'permissions',v_staff.permissions,'feature_enabled',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_staff_session(p_session_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions
AS $$
DECLARE v_pharmacy_id UUID:=public.authenticated_pharmacy_id();
BEGIN
  UPDATE public.pharmacy_staff_sessions SET revoked_at=NOW()
  WHERE pharmacy_id=v_pharmacy_id AND token_hash=encode(digest(p_session_token,'sha256'),'hex') AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_pos_staff_sale_with_shift(p_pharmacy_id UUID,p_sale JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_authorization JSONB; v_result JSONB; v_staff_id UUID; v_sale_id UUID:=(p_sale->>'id')::UUID;
BEGIN
  v_authorization:=public.authorize_staff_permission(p_sale->>'staff_session_token','can_sell');
  IF NOT COALESCE((v_authorization->>'allowed')::BOOLEAN,FALSE) THEN
    RETURN jsonb_build_object('success',FALSE,'code',v_authorization->>'code','error',v_authorization->>'error');
  END IF;
  v_staff_id:=(v_authorization->>'staff_id')::UUID;
  IF p_sale->>'payment_method'='credit' THEN v_result:=public.sync_pos_credit_sale_with_shift(p_pharmacy_id,p_sale);
  ELSE v_result:=public.sync_pos_sale_with_shift(p_pharmacy_id,p_sale); END IF;
  IF NOT COALESCE((v_result->>'success')::BOOLEAN,FALSE) THEN RETURN v_result; END IF;
  UPDATE public.sales SET staff_id=v_staff_id,updated_at=NOW()
  WHERE id=v_sale_id AND pharmacy_id=p_pharmacy_id AND (staff_id IS NULL OR staff_id=v_staff_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale belongs to a different staff member'; END IF;
  RETURN v_result||jsonb_build_object('staff_id',v_staff_id,'staff_name',v_authorization->>'staff_name');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_staff_performance(p_from DATE,p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth
AS $$
DECLARE v_pharmacy_id UUID:=public.authenticated_pharmacy_id();
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='staff_accounts' AND is_enabled)
    THEN RAISE EXCEPTION 'The staff accounts feature is disabled' USING ERRCODE='42501'; END IF;
  IF p_from>p_to OR p_to-p_from>366 THEN RAISE EXCEPTION 'Invalid reporting range'; END IF;
  RETURN jsonb_build_object(
    'by_staff',(SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.total_sales DESC),'[]'::jsonb) FROM (
      SELECT staff.id staff_id,staff.name,staff.role,COUNT(sale.id) sale_count,
        COALESCE(SUM(sale.total),0) total_sales,COALESCE(AVG(sale.total),0) average_sale,
        COUNT(DISTINCT sale.shift_id) shifts_worked
      FROM public.pharmacy_staff staff LEFT JOIN public.sales sale ON sale.staff_id=staff.id
        AND sale.status='completed' AND sale.created_at>=p_from::timestamptz AND sale.created_at<(p_to+1)::timestamptz
      WHERE staff.pharmacy_id=v_pharmacy_id GROUP BY staff.id,staff.name,staff.role
    ) row_data),
    'by_shift',(SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.opened_at DESC),'[]'::jsonb) FROM (
      SELECT shift.id shift_id,shift.opened_at,shift.closed_at,shift.status,staff.id staff_id,staff.name,
        COUNT(sale.id) sale_count,COALESCE(SUM(sale.total),0) total_sales
      FROM public.shifts shift JOIN public.sales sale ON sale.shift_id=shift.id
      LEFT JOIN public.pharmacy_staff staff ON staff.id=sale.staff_id
      WHERE shift.pharmacy_id=v_pharmacy_id AND shift.opened_at>=p_from::timestamptz AND shift.opened_at<(p_to+1)::timestamptz
      GROUP BY shift.id,shift.opened_at,shift.closed_at,shift.status,staff.id,staff.name
    ) row_data)
  );
END;
$$;

REVOKE ALL ON public.pharmacy_staff,public.pharmacy_staff_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT (id,pharmacy_id,name,role,is_active,permissions,pin_locked_until,last_authenticated_at,created_at,updated_at)
  ON public.pharmacy_staff TO authenticated;
REVOKE ALL ON FUNCTION public.staff_permissions_normalized(JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_authenticated_staff(JSONB,TEXT,TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_authenticated_staff_active(UUID,BOOLEAN,TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.reset_authenticated_staff_pin(UUID,TEXT,TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.authenticate_pharmacy_staff(UUID,TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.authorize_staff_permission(TEXT,TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.revoke_staff_session(TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.sync_pos_staff_sale_with_shift(UUID,JSONB) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_staff_performance(DATE,DATE) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_authenticated_staff(JSONB,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_authenticated_staff_active(UUID,BOOLEAN,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_authenticated_staff_pin(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_pharmacy_staff(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_staff_permission(TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_staff_session(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_pos_staff_sale_with_shift(UUID,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_performance(DATE,DATE) TO authenticated;

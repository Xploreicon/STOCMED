BEGIN;

-- Each delivery is an immutable cost layer. Existing historical costs are frozen
-- at the best value still available; overwritten legacy costs cannot be recovered.
ALTER TABLE public.sale_items ADD COLUMN unit_cost_snapshot NUMERIC(18,6),
  ADD COLUMN cost_snapshot_estimated BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE public.sale_items si SET unit_cost_snapshot=COALESCE(b.cost_price,pi.unit_cost,0),cost_snapshot_estimated=TRUE
FROM public.pharmacy_inventory pi LEFT JOIN public.batches b ON b.inventory_id=pi.id
WHERE si.inventory_id=pi.id AND si.batch_id=b.id;
UPDATE public.sale_items si SET unit_cost_snapshot=COALESCE(pi.unit_cost,0),cost_snapshot_estimated=TRUE
FROM public.pharmacy_inventory pi WHERE si.inventory_id=pi.id AND si.unit_cost_snapshot IS NULL;
ALTER TABLE public.batches ALTER COLUMN cost_price TYPE NUMERIC(18,6);
ALTER TABLE public.pharmacy_inventory ALTER COLUMN unit_cost TYPE NUMERIC(18,6);
ALTER TABLE public.goods_receipt_items ALTER COLUMN unit_cost TYPE NUMERIC(18,6),
  ADD COLUMN receiving_unit TEXT NOT NULL DEFAULT 'base' CHECK(receiving_unit IN ('base','pack')),
  ADD COLUMN receiving_quantity INTEGER,
  ADD COLUMN units_per_pack INTEGER NOT NULL DEFAULT 1 CHECK(units_per_pack>0),
  ADD COLUMN purchase_unit_cost NUMERIC(14,2);
ALTER TABLE public.goods_receipts ADD COLUMN request_key UUID,
  ADD COLUMN request_fingerprint TEXT,
  ADD COLUMN invoice_reference TEXT,
  ADD COLUMN staff_id UUID REFERENCES public.pharmacy_staff(id),
  ADD COLUMN reversed_at TIMESTAMPTZ,
  ADD COLUMN reversal_reason TEXT,
  ADD COLUMN reversed_by UUID,
  ADD COLUMN reversal_staff_id UUID REFERENCES public.pharmacy_staff(id);
ALTER TABLE public.purchase_orders ADD COLUMN staff_id UUID REFERENCES public.pharmacy_staff(id);
CREATE UNIQUE INDEX goods_receipts_request_unique ON public.goods_receipts(pharmacy_id,request_key) WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX goods_receipts_supplier_invoice_unique ON public.goods_receipts(pharmacy_id,supplier_id,lower(invoice_reference))
  WHERE invoice_reference IS NOT NULL AND reversed_at IS NULL;
CREATE INDEX goods_receipts_staff_idx ON public.goods_receipts(staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX goods_receipts_reversal_staff_idx ON public.goods_receipts(reversal_staff_id) WHERE reversal_staff_id IS NOT NULL;
CREATE INDEX purchase_orders_staff_idx ON public.purchase_orders(staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX stock_movements_batch_created_idx ON public.stock_movements(batch_id,created_at);

CREATE OR REPLACE FUNCTION public.capture_sale_item_cost()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.unit_cost_snapshot IS DISTINCT FROM OLD.unit_cost_snapshot
      OR NEW.cost_snapshot_estimated IS DISTINCT FROM OLD.cost_snapshot_estimated
      OR NEW.inventory_id IS DISTINCT FROM OLD.inventory_id OR NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
      RAISE EXCEPTION 'Sale cost and inventory references are immutable';
    END IF;
    RETURN NEW;
  END IF;
  SELECT COALESCE(b.cost_price,pi.unit_cost,0) INTO NEW.unit_cost_snapshot
    FROM public.pharmacy_inventory pi LEFT JOIN public.batches b ON b.id=NEW.batch_id AND b.inventory_id=pi.id
    WHERE pi.id=NEW.inventory_id;
  IF NEW.unit_cost_snapshot IS NULL THEN RAISE EXCEPTION 'Sale inventory not found'; END IF;
  IF NEW.batch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.batches WHERE id=NEW.batch_id AND inventory_id=NEW.inventory_id) THEN
    RAISE EXCEPTION 'Sale batch does not belong to inventory';
  END IF;
  NEW.cost_snapshot_estimated:=FALSE;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.capture_sale_item_cost() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_sale_item_cost BEFORE INSERT OR UPDATE ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION public.capture_sale_item_cost();

CREATE OR REPLACE FUNCTION public.get_pharmacy_reports(
  p_pharmacy_id UUID,
  p_from DATE DEFAULT CURRENT_DATE - 30,
  p_to DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_daily JSONB;
  v_valuation JSONB;
  v_margin JSONB;
  v_dead JSONB;
  v_expiry JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  IF p_from > p_to OR p_to - p_from > 366 THEN RAISE EXCEPTION 'Invalid reporting range'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.sale_date DESC), '[]'::JSONB)
  INTO v_daily
  FROM (
    SELECT
      s.created_at::DATE AS sale_date,
      COUNT(*)::INTEGER AS transaction_count,
      COALESCE(SUM(lines.item_count), 0)::INTEGER AS item_count,
      SUM(s.total)::NUMERIC(14,2) AS total_sales,
      COALESCE(SUM(
        CASE WHEN s.subtotal > 0
          THEN lines.medicine_sales * s.total / s.subtotal ELSE 0 END
      ), 0)::NUMERIC(14,2) AS medicine_sales,
      COALESCE(SUM(
        CASE WHEN s.subtotal > 0
          THEN lines.store_sales * s.total / s.subtotal ELSE 0 END
      ), 0)::NUMERIC(14,2) AS store_sales,
      COALESCE(SUM(lines.medicine_items), 0)::INTEGER AS medicine_items,
      COALESCE(SUM(lines.store_items), 0)::INTEGER AS store_items,
      SUM(s.total) FILTER (WHERE s.payment_method = 'cash')::NUMERIC(14,2) AS cash,
      SUM(s.total) FILTER (WHERE s.payment_method = 'bank_transfer')::NUMERIC(14,2) AS bank_transfer,
      SUM(s.total) FILTER (WHERE s.payment_method = 'pharmacy_pos_terminal')::NUMERIC(14,2) AS terminal,
      SUM(s.total) FILTER (WHERE s.payment_method = 'other')::NUMERIC(14,2) AS other
    FROM public.sales s
    JOIN LATERAL (
      SELECT
        SUM(si.quantity)::NUMERIC AS item_count,
        COALESCE(SUM(si.line_total) FILTER (WHERE pi.item_type = 'medicine'), 0) AS medicine_sales,
        COALESCE(SUM(si.line_total) FILTER (WHERE pi.item_type = 'store'), 0) AS store_sales,
        COALESCE(SUM(si.quantity) FILTER (WHERE pi.item_type = 'medicine'), 0) AS medicine_items,
        COALESCE(SUM(si.quantity) FILTER (WHERE pi.item_type = 'store'), 0) AS store_items
      FROM public.sale_items si
      JOIN public.pharmacy_inventory pi ON pi.id = si.inventory_id
      WHERE si.sale_id = s.id
    ) lines ON TRUE
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.status = 'completed'
      AND s.created_at >= p_from::TIMESTAMPTZ
      AND s.created_at < (p_to + 1)::TIMESTAMPTZ
    GROUP BY s.created_at::DATE
  ) row_data;

  WITH batch_cost AS (
    SELECT
      b.inventory_id,
      CASE WHEN SUM(sm.quantity) > 0
        THEN SUM(sm.quantity * COALESCE(b.cost_price, 0)) / SUM(sm.quantity)
        ELSE 0 END AS unit_cost
    FROM public.batches b
    JOIN public.stock_movements sm ON sm.batch_id = b.id
    GROUP BY b.inventory_id
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.retail_value DESC), '[]'::JSONB)
  INTO v_valuation
  FROM (
    SELECT
      pi.id AS inventory_id,
      pi.product_id,
      pi.item_type AS department,
      COALESCE(p.generic_name, pi.item_name) AS generic_name,
      COALESCE(p.brand_name, pi.brand) AS brand_name,
      COALESCE(p.strength, pi.unit_description) AS strength,
      pi.quantity_in_stock AS quantity,
      ROUND(COALESCE(bc.unit_cost, pi.unit_cost, 0), 2) AS unit_cost,
      pi.price AS retail_price,
      ROUND(pi.quantity_in_stock * COALESCE(bc.unit_cost, pi.unit_cost, 0), 2) AS cost_value,
      ROUND(pi.quantity_in_stock * pi.price, 2) AS retail_value
    FROM public.pharmacy_inventory pi
    LEFT JOIN public.products p ON p.id = pi.product_id
    LEFT JOIN batch_cost bc ON bc.inventory_id = pi.id
    WHERE pi.pharmacy_id = p_pharmacy_id
      AND pi.deleted_at IS NULL
      AND pi.quantity_in_stock > 0
  ) row_data;

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.margin DESC), '[]'::JSONB)
  INTO v_margin
  FROM (
    SELECT
      pi.id AS inventory_id,
      pi.product_id,
      pi.item_type AS department,
      COALESCE(p.generic_name, pi.item_name) AS generic_name,
      COALESCE(p.brand_name, pi.brand) AS brand_name,
      COALESCE(p.strength, pi.unit_description) AS strength,
      SUM(si.quantity)::NUMERIC AS quantity_sold,
      BOOL_OR(si.cost_snapshot_estimated) AS cost_estimated,
      SUM(si.line_total)::NUMERIC(14,2) AS revenue,
      SUM(si.quantity * COALESCE(si.unit_cost_snapshot, b.cost_price, pi.unit_cost, 0))::NUMERIC(14,2) AS cogs,
      (SUM(si.line_total) - SUM(si.quantity * COALESCE(si.unit_cost_snapshot, b.cost_price, pi.unit_cost, 0)))::NUMERIC(14,2) AS margin
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    JOIN public.pharmacy_inventory pi ON pi.id = si.inventory_id
    LEFT JOIN public.products p ON p.id = pi.product_id
    LEFT JOIN public.batches b ON b.id = si.batch_id
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.status = 'completed'
      AND s.created_at >= p_from::TIMESTAMPTZ
      AND s.created_at < (p_to + 1)::TIMESTAMPTZ
    GROUP BY pi.id, pi.product_id, pi.item_type, p.generic_name, p.brand_name,
             p.strength, pi.item_name, pi.brand, pi.unit_description
  ) row_data;

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.capital_tied_up DESC), '[]'::JSONB)
  INTO v_dead
  FROM (
    SELECT
      pi.id AS inventory_id,
      pi.product_id,
      pi.item_type AS department,
      COALESCE(p.generic_name, pi.item_name) AS generic_name,
      COALESCE(p.brand_name, pi.brand) AS brand_name,
      COALESCE(p.strength, pi.unit_description) AS strength,
      pi.quantity_in_stock AS quantity,
      MAX(sm.created_at) FILTER (WHERE sm.type = 'sale') AS last_sale_at,
      ROUND(pi.quantity_in_stock * COALESCE(pi.unit_cost, recent.cost_price, 0), 2) AS capital_tied_up
    FROM public.pharmacy_inventory pi
    LEFT JOIN public.products p ON p.id = pi.product_id
    LEFT JOIN public.stock_movements sm ON sm.inventory_id = pi.id
    LEFT JOIN LATERAL (
      SELECT b.cost_price FROM public.batches b
      WHERE b.inventory_id = pi.id
      ORDER BY COALESCE(b.received_at, b.created_at) DESC LIMIT 1
    ) recent ON TRUE
    WHERE pi.pharmacy_id = p_pharmacy_id
      AND pi.deleted_at IS NULL
      AND pi.quantity_in_stock > 0
    GROUP BY pi.id, pi.product_id, pi.item_type, p.generic_name, p.brand_name,
             p.strength, pi.item_name, pi.brand, pi.unit_description, recent.cost_price
    HAVING MAX(sm.created_at) FILTER (WHERE sm.type = 'sale') IS NULL
      OR MAX(sm.created_at) FILTER (WHERE sm.type = 'sale') < NOW() - INTERVAL '90 days'
  ) row_data;

  WITH exposure AS (
    SELECT
      pi.item_type AS department,
      b.expiry_date,
      GREATEST(COALESCE(SUM(sm.quantity), 0), 0)::NUMERIC AS quantity,
      COALESCE(b.cost_price, pi.unit_cost, 0) AS cost_price,
      pi.price
    FROM public.batches b
    JOIN public.pharmacy_inventory pi ON pi.id = b.inventory_id
    LEFT JOIN public.stock_movements sm ON sm.batch_id = b.id
    WHERE pi.pharmacy_id = p_pharmacy_id
      AND pi.tracks_expiry
      AND b.expiry_date >= CURRENT_DATE
      AND b.expiry_date <= CURRENT_DATE + 90
    GROUP BY pi.item_type, b.id, b.expiry_date, b.cost_price, pi.unit_cost, pi.price
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.days, row_data.department), '[]'::JSONB)
  INTO v_expiry
  FROM (
    SELECT
      bucket.days,
      department.item_type AS department,
      ROUND(COALESCE(SUM(exposure.quantity * exposure.cost_price), 0), 2) AS cost_value,
      ROUND(COALESCE(SUM(exposure.quantity * exposure.price), 0), 2) AS retail_value,
      COALESCE(SUM(exposure.quantity), 0)::INTEGER AS units
    FROM (VALUES (30), (60), (90)) bucket(days)
    CROSS JOIN (VALUES ('medicine'::public.inventory_item_type), ('store'::public.inventory_item_type)) department(item_type)
    LEFT JOIN exposure
      ON exposure.department = department.item_type
     AND exposure.expiry_date <= CURRENT_DATE + bucket.days
     AND exposure.expiry_date > CURRENT_DATE +
       CASE bucket.days WHEN 30 THEN 0 ELSE bucket.days - 30 END
    GROUP BY bucket.days, department.item_type
  ) row_data;

  RETURN jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'daily_sales', v_daily,
    'stock_valuation', v_valuation,
    'margin_per_product', v_margin,
    'dead_stock', v_dead,
    'expiry_exposure', v_expiry
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_procurement_delivery(
  p_pharmacy_id UUID,
  p_supplier_id UUID,
  p_po_id UUID,
  p_notes TEXT,
  p_lines JSONB,
  p_request_key UUID,
  p_invoice_reference TEXT,
  p_staff_id UUID,
  p_staff_token TEXT,
  p_sp_tokens JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt_id UUID;
  v_previous public.goods_receipts%ROWTYPE;
  v_fingerprint TEXT;
  v_purchase_quantity INTEGER;
  v_units_per_pack INTEGER;
  v_receiving_unit TEXT;
  v_purchase_unit_cost NUMERIC;
  v_selling_price NUMERIC;
  v_inventory public.pharmacy_inventory%ROWTYPE;
  v_authorization JSONB;
  v_restore JSONB;
  v_receipt_number TEXT;
  v_line JSONB;
  v_product_id UUID;
  v_requested_inventory_id UUID;
  v_po_item_id UUID;
  v_inventory_id UUID;
  v_batch_id UUID;
  v_quantity INTEGER;
  v_unit_cost NUMERIC;
  v_batch_number TEXT;
  v_expiry_date DATE;
  v_remaining INTEGER;
  v_po_status TEXT;
  v_tracks_expiry BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacies ph
    WHERE ph.id = p_pharmacy_id AND ph.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Not authorized for this pharmacy'; END IF;
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'A delivery request reference is required'; END IF;
  v_fingerprint:=md5(jsonb_build_object('supplier',p_supplier_id,'po',p_po_id,'notes',p_notes,'lines',p_lines,'invoice',NULLIF(trim(p_invoice_reference),''))::TEXT);
  SELECT * INTO v_previous FROM public.goods_receipts WHERE pharmacy_id=p_pharmacy_id AND request_key=p_request_key;
  IF FOUND THEN
    IF v_previous.request_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'This delivery reference was already used for different details'; END IF;
    IF v_previous.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'This receipt was reversed. Start a new delivery'; END IF;
    RETURN jsonb_build_object('success',TRUE,'receipt_id',v_previous.id,'receipt_number',v_previous.receipt_number,'replayed',TRUE);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = p_supplier_id AND s.pharmacy_id = p_pharmacy_id AND (s.is_active OR p_po_id IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Supplier is not active for this pharmacy'; END IF;
  IF p_po_id IS NOT NULL THEN
    SELECT po.status INTO v_po_status
    FROM public.purchase_orders po
    WHERE po.id = p_po_id
      AND po.pharmacy_id = p_pharmacy_id
      AND po.supplier_id = p_supplier_id
    FOR UPDATE;
    IF v_po_status IS NULL OR v_po_status NOT IN ('sent', 'partially_received') THEN
      RAISE EXCEPTION 'Purchase order is not open for receiving';
    END IF;
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one receiving line is required';
  END IF;

  v_receipt_number := 'GR-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 6));
  INSERT INTO public.goods_receipts (
    pharmacy_id, supplier_id, po_id, receipt_number, notes, received_by, request_key, request_fingerprint, invoice_reference, staff_id
  ) VALUES (
    p_pharmacy_id, p_supplier_id, p_po_id, v_receipt_number,
    NULLIF(TRIM(p_notes), ''), auth.uid(),p_request_key,v_fingerprint,NULLIF(trim(p_invoice_reference),''),p_staff_id
  ) RETURNING id INTO v_receipt_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::UUID;
    v_requested_inventory_id := NULLIF(v_line->>'inventory_id', '')::UUID;
    v_po_item_id := NULLIF(v_line->>'po_item_id', '')::UUID;
    v_purchase_quantity:=COALESCE((v_line->>'quantity_received')::INTEGER,0);
    v_units_per_pack:=COALESCE((v_line->>'units_per_pack')::INTEGER,1);
    v_receiving_unit:=COALESCE(v_line->>'receiving_unit','base');
    v_purchase_unit_cost:=COALESCE((v_line->>'unit_cost')::NUMERIC,-1);
    IF v_receiving_unit NOT IN ('base','pack') OR v_units_per_pack<1 OR (v_receiving_unit='base' AND v_units_per_pack<>1)
      OR v_purchase_quantity<1 OR v_purchase_unit_cost<0 OR v_purchase_unit_cost::TEXT='NaN' OR v_purchase_unit_cost<>round(v_purchase_unit_cost,2) THEN
      RAISE EXCEPTION 'Choose a valid receiving unit, quantity, conversion and cost';
    END IF;
    v_quantity:=v_purchase_quantity*v_units_per_pack;
    v_unit_cost:=round(v_purchase_unit_cost/v_units_per_pack,6);
    v_selling_price:=NULLIF(v_line->>'selling_price','')::NUMERIC;
    v_batch_number := NULLIF(TRIM(v_line->>'batch_number'), '');
    v_expiry_date := NULLIF(v_line->>'expiry_date', '')::DATE;

    IF v_quantity <= 0 OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Receiving line has invalid quantity or cost';
    END IF;
    IF (v_product_id IS NULL) = (v_requested_inventory_id IS NULL) THEN
      RAISE EXCEPTION 'Receiving line must identify one medicine or store item';
    END IF;

    IF v_product_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_product_id) THEN
        RAISE EXCEPTION 'Catalogue product does not exist';
      END IF;
      SELECT * INTO v_inventory FROM public.pharmacy_inventory
        WHERE pharmacy_id=p_pharmacy_id AND product_id=v_product_id FOR UPDATE;
      IF NOT FOUND THEN
        IF v_selling_price IS NULL OR v_selling_price<=0 OR v_selling_price::TEXT='NaN' THEN
          RAISE EXCEPTION 'Enter a selling price per base unit for each new medicine';
        END IF;
        v_authorization:=public.authorize_staff_permission(p_staff_token,'can_change_prices');
        IF (v_authorization->>'allowed')::BOOLEAN IS NOT TRUE THEN RAISE EXCEPTION '%',v_authorization->>'error' USING ERRCODE='42501'; END IF;
        IF public.verify_gated_sp_action(p_pharmacy_id,p_sp_tokens->>'price_change','price_change','Price new medicine during receiving') IS NOT TRUE THEN
          RAISE EXCEPTION 'Superintendent price authorization is required' USING ERRCODE='42501',HINT='price_change';
        END IF;
        INSERT INTO public.pharmacy_inventory(pharmacy_id,product_id,item_type,tracks_expiry,price,unit_cost,quantity_in_stock,is_listed,base_unit_name)
          VALUES(p_pharmacy_id,v_product_id,'medicine',TRUE,v_selling_price,v_unit_cost,0,TRUE,COALESCE(NULLIF(left(trim(v_line->>'base_unit_name'),40),''),'unit'))
          RETURNING * INTO v_inventory;
      END IF;
    ELSE
      SELECT * INTO v_inventory FROM public.pharmacy_inventory
        WHERE id=v_requested_inventory_id AND pharmacy_id=p_pharmacy_id AND item_type='store' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Store inventory item is not owned by this pharmacy'; END IF;
    END IF;
    IF v_inventory.deleted_at IS NOT NULL THEN
      IF COALESCE((v_line->>'restore_deleted')::BOOLEAN,FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'This item is removed. Choose Restore and receive or use the recovery bin';
      END IF;
      v_restore:=public.bulk_change_pharmacy_inventory(p_pharmacy_id,ARRAY[v_inventory.id],'restore',NULL,p_sp_tokens->>'restore_inventory');
      IF (v_restore->>'success')::BOOLEAN IS NOT TRUE THEN
        RAISE EXCEPTION '%',v_restore->>'error' USING HINT='restore_inventory';
      END IF;
    END IF;
    v_inventory_id:=v_inventory.id;
    v_tracks_expiry:=v_inventory.tracks_expiry;

    IF p_po_id IS NOT NULL THEN
      SELECT poi.quantity_ordered - poi.quantity_received
      INTO v_remaining
      FROM public.purchase_order_items poi
      WHERE poi.id = v_po_item_id
        AND poi.po_id = p_po_id
        AND (
          (v_product_id IS NOT NULL AND poi.product_id = v_product_id)
          OR (v_requested_inventory_id IS NOT NULL AND poi.inventory_id = v_requested_inventory_id)
        )
      FOR UPDATE;
      IF v_remaining IS NULL THEN RAISE EXCEPTION 'Receiving line does not belong to this PO'; END IF;
      IF v_quantity > v_remaining THEN
        RAISE EXCEPTION 'Received quantity % exceeds PO remainder %', v_quantity, v_remaining;
      END IF;
    ELSIF v_po_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'Direct receipt cannot reference a PO line';
    END IF;

    v_batch_id := NULL;
    IF v_tracks_expiry THEN
      IF v_batch_number IS NULL OR v_expiry_date IS NULL THEN
        RAISE EXCEPTION 'Batch number and expiry date are required for this item';
      END IF;
      IF v_expiry_date <= CURRENT_DATE THEN RAISE EXCEPTION 'Expired batches cannot be received'; END IF;
      IF v_expiry_date < (CURRENT_DATE + INTERVAL '4 months')::DATE
         AND COALESCE((v_line->>'short_dated_confirmed')::BOOLEAN, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'Short-dated batch % requires explicit confirmation', v_batch_number;
      END IF;
      -- A receipt owns its cost layer even when manufacturer batch numbers repeat.
      INSERT INTO public.batches(inventory_id,batch_number,expiry_date,quantity_received,cost_price,supplier_id,purchase_order_id,purchase_order_item_id,received_at)
        VALUES(v_inventory_id,v_batch_number,v_expiry_date,v_quantity,v_unit_cost,p_supplier_id,p_po_id,v_po_item_id,NOW())
        RETURNING id INTO v_batch_id;
    END IF;

    UPDATE public.pharmacy_inventory
    SET unit_cost = CASE WHEN GREATEST(quantity_in_stock,0)+v_quantity>0
      THEN round((GREATEST(quantity_in_stock,0)*COALESCE(unit_cost,0)+v_purchase_quantity*v_purchase_unit_cost)/(GREATEST(quantity_in_stock,0)+v_quantity),6)
      ELSE v_unit_cost END
    WHERE id = v_inventory_id;
    INSERT INTO public.stock_movements (
      inventory_id, batch_id, type, quantity, reason, reference, created_by
    ) VALUES (
      v_inventory_id, v_batch_id, 'restock', v_quantity,
      CASE WHEN p_po_id IS NULL THEN 'Direct goods receipt' ELSE 'Purchase order receipt' END,
      v_receipt_id::TEXT, auth.uid()
    );
    INSERT INTO public.goods_receipt_items (
      receipt_id, po_item_id, product_id, inventory_id, batch_id,
      quantity_received, unit_cost, line_total,receiving_unit,receiving_quantity,units_per_pack,purchase_unit_cost
    ) VALUES (
      v_receipt_id, v_po_item_id, v_product_id, v_inventory_id, v_batch_id,
      v_quantity,v_unit_cost,v_purchase_quantity*v_purchase_unit_cost,v_receiving_unit,v_purchase_quantity,v_units_per_pack,v_purchase_unit_cost
    );
    IF v_po_item_id IS NOT NULL THEN
      UPDATE public.purchase_order_items
      SET quantity_received = quantity_received + v_quantity
      WHERE id = v_po_item_id;
    END IF;
  END LOOP;

  IF p_po_id IS NOT NULL THEN
    UPDATE public.purchase_orders po
    SET status = CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM public.purchase_order_items poi
        WHERE poi.po_id = po.id AND poi.quantity_received < poi.quantity_ordered
      ) THEN 'received'
      ELSE 'partially_received'
    END,
    updated_at = NOW()
    WHERE po.id = p_po_id;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number
  );
END;
$$;

-- A single staff-authorized boundary covers supplier, order and receipt writes.
CREATE OR REPLACE FUNCTION public.write_procurement(
  p_pharmacy_id UUID,p_command JSONB,p_staff_token TEXT DEFAULT NULL,p_sp_tokens JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_action TEXT:=p_command->>'action';
  v_staff JSONB;
  v_staff_id UUID;
  v_id UUID;
  v_supplier UUID:=NULLIF(p_command->>'supplier_id','')::UUID;
  v_po public.purchase_orders%ROWTYPE;
  v_receipt public.goods_receipts%ROWTYPE;
  v_item RECORD;
  v_name TEXT;
  v_items JSONB;
  v_total NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.pharmacies WHERE id=p_pharmacy_id AND user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=p_pharmacy_id AND feature_key='purchase_orders_and_receiving' AND is_enabled) THEN
    RAISE EXCEPTION 'The buying and receiving feature is disabled' USING ERRCODE='42501'; END IF;
  v_staff:=public.authorize_staff_permission(p_staff_token,'can_adjust_stock');
  IF (v_staff->>'allowed')::BOOLEAN IS NOT TRUE THEN RETURN v_staff||jsonb_build_object('success',FALSE); END IF;
  v_staff_id:=NULLIF(v_staff->>'staff_id','')::UUID;
  -- Serializes delivery retries, PO edits and receipt reversals for this tenant.
  PERFORM pg_advisory_xact_lock(hashtextextended('procurement:'||p_pharmacy_id::TEXT,0));
  IF v_action IN ('receive','receipt_reverse') THEN
    -- Recovery actions take this lock before inventory rows; use the same order.
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-recovery:'||p_pharmacy_id::TEXT,0));
  END IF;
  IF v_action IN ('supplier_create','supplier_update') THEN
    v_name:=NULLIF(trim(p_command->>'name'),'');
    IF v_action='supplier_create' OR p_command ? 'name' THEN
      IF v_name IS NULL OR length(v_name)>160 THEN RAISE EXCEPTION 'Enter a supplier name up to 160 characters'; END IF;
    END IF;
    IF v_action='supplier_create' THEN
      INSERT INTO public.suppliers(pharmacy_id,name,contact_person,phone,email,address,payment_terms,notes)
        VALUES(p_pharmacy_id,v_name,NULLIF(trim(p_command->>'contact_person'),''),NULLIF(trim(p_command->>'phone'),''),
          NULLIF(trim(p_command->>'email'),''),NULLIF(trim(p_command->>'address'),''),NULLIF(trim(p_command->>'payment_terms'),''),NULLIF(trim(p_command->>'notes'),''))
        RETURNING id INTO v_id;
    ELSE
      v_id:=(p_command->>'id')::UUID;
      UPDATE public.suppliers SET name=CASE WHEN p_command ? 'name' THEN v_name ELSE name END,
        contact_person=CASE WHEN p_command ? 'contact_person' THEN NULLIF(trim(p_command->>'contact_person'),'') ELSE contact_person END,
        phone=CASE WHEN p_command ? 'phone' THEN NULLIF(trim(p_command->>'phone'),'') ELSE phone END,
        email=CASE WHEN p_command ? 'email' THEN NULLIF(trim(p_command->>'email'),'') ELSE email END,
        address=CASE WHEN p_command ? 'address' THEN NULLIF(trim(p_command->>'address'),'') ELSE address END,
        payment_terms=CASE WHEN p_command ? 'payment_terms' THEN NULLIF(trim(p_command->>'payment_terms'),'') ELSE payment_terms END,
        notes=CASE WHEN p_command ? 'notes' THEN NULLIF(trim(p_command->>'notes'),'') ELSE notes END,
        is_active=CASE WHEN p_command ? 'is_active' THEN (p_command->>'is_active')::BOOLEAN ELSE is_active END
        WHERE id=v_id AND pharmacy_id=p_pharmacy_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found'; END IF;
    END IF;
    RETURN jsonb_build_object('success',TRUE,'supplier_id',v_id);
  ELSIF v_action IN ('po_create','po_update') THEN
    v_items:=p_command->'items';
    IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Choose 1–200 purchase order lines'; END IF;
    IF v_action='po_create' THEN
      v_id:=public.create_purchase_order(p_pharmacy_id,v_supplier,NULLIF(p_command->>'expected_date','')::DATE,p_command->>'notes',v_items);
      UPDATE public.purchase_orders SET staff_id=v_staff_id WHERE id=v_id;
    ELSE
      v_id:=(p_command->>'id')::UUID;
      SELECT * INTO v_po FROM public.purchase_orders WHERE id=v_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
      IF NOT FOUND OR v_po.status<>'draft' THEN RAISE EXCEPTION 'Only draft orders can be edited'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=v_supplier AND pharmacy_id=p_pharmacy_id AND is_active) THEN
        RAISE EXCEPTION 'Choose an active supplier'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) item
        LEFT JOIN public.products p ON p.id=NULLIF(item->>'product_id','')::UUID
        LEFT JOIN public.pharmacy_inventory pi ON pi.id=NULLIF(item->>'inventory_id','')::UUID AND pi.pharmacy_id=p_pharmacy_id AND pi.item_type='store' AND pi.deleted_at IS NULL
        WHERE (p.id IS NULL)=(pi.id IS NULL) OR COALESCE((item->>'quantity_ordered')::INTEGER,0)<=0 OR COALESCE((item->>'unit_cost')::NUMERIC,-1)<0) THEN
        RAISE EXCEPTION 'Each order line needs one valid item, quantity and cost'; END IF;
      DELETE FROM public.purchase_order_items WHERE po_id=v_id;
      INSERT INTO public.purchase_order_items(po_id,product_id,inventory_id,quantity_ordered,unit_cost,line_total)
        SELECT v_id,NULLIF(item->>'product_id','')::UUID,NULLIF(item->>'inventory_id','')::UUID,
          (item->>'quantity_ordered')::INTEGER,(item->>'unit_cost')::NUMERIC,(item->>'quantity_ordered')::INTEGER*(item->>'unit_cost')::NUMERIC
        FROM jsonb_array_elements(v_items) item;
      SELECT sum(line_total) INTO v_total FROM public.purchase_order_items WHERE po_id=v_id;
      UPDATE public.purchase_orders SET supplier_id=v_supplier,expected_date=NULLIF(p_command->>'expected_date','')::DATE,
        notes=NULLIF(trim(p_command->>'notes'),''),subtotal=v_total,updated_at=NOW() WHERE id=v_id;
    END IF;
    RETURN jsonb_build_object('success',TRUE,'purchase_order_id',v_id);
  ELSIF v_action='po_status' THEN
    v_id:=(p_command->>'id')::UUID;
    SELECT * INTO v_po FROM public.purchase_orders WHERE id=v_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
    IF NOT FOUND OR NOT ((p_command->>'status'='sent' AND v_po.status='draft') OR (p_command->>'status'='cancelled' AND v_po.status IN ('draft','sent'))) THEN
      RAISE EXCEPTION 'This order cannot make that status change'; END IF;
    UPDATE public.purchase_orders SET status=p_command->>'status',updated_at=NOW() WHERE id=v_id;
    RETURN jsonb_build_object('success',TRUE,'id',v_id);
  ELSIF v_action='receive' THEN
    IF jsonb_typeof(p_command->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_command->'lines') NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Choose 1–200 delivered batch lines'; END IF;
    RETURN public.receive_procurement_delivery(p_pharmacy_id,v_supplier,NULLIF(p_command->>'po_id','')::UUID,
      p_command->>'notes',p_command->'lines',NULLIF(p_command->>'request_key','')::UUID,p_command->>'invoice_reference',v_staff_id,p_staff_token,p_sp_tokens);
  ELSIF v_action='receipt_reverse' THEN
    v_id:=(p_command->>'id')::UUID;
    IF length(trim(COALESCE(p_command->>'reason',''))) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'Enter a reversal reason (3–300 characters)'; END IF;
    SELECT * INTO v_receipt FROM public.goods_receipts WHERE id=v_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
    IF v_receipt.reversed_at IS NOT NULL THEN RETURN jsonb_build_object('success',TRUE,'replayed',TRUE); END IF;
    IF v_receipt.request_key IS NULL THEN RAISE EXCEPTION 'Legacy receipts need a reviewed stock adjustment because their batches may be shared'; END IF;
    IF public.verify_gated_sp_action(p_pharmacy_id,p_sp_tokens->>'stock_adjustment','stock_adjustment','Reverse goods receipt '||v_receipt.receipt_number) IS NOT TRUE THEN
      RETURN jsonb_build_object('success',FALSE,'code','SP_AUTH_REQUIRED','action','stock_adjustment','error','Superintendent authorization is required'); END IF;
    PERFORM 1 FROM public.pharmacy_inventory WHERE id IN (SELECT inventory_id FROM public.goods_receipt_items WHERE receipt_id=v_id) ORDER BY id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.reservations WHERE inventory_id IN (SELECT inventory_id FROM public.goods_receipt_items WHERE receipt_id=v_id) AND status='active' AND expires_at>NOW()) THEN
      RAISE EXCEPTION 'Resolve active reservations before reversing this receipt'; END IF;
    IF EXISTS(SELECT 1 FROM public.goods_receipt_items ri JOIN public.stock_movements sm ON sm.inventory_id=ri.inventory_id
      WHERE ri.receipt_id=v_id AND sm.quantity<0 AND ((ri.batch_id IS NOT NULL AND sm.batch_id=ri.batch_id) OR (ri.batch_id IS NULL AND sm.created_at>=v_receipt.received_at))) THEN
      RAISE EXCEPTION 'Stock from this receipt has been sold or used. Use a reviewed stock adjustment instead'; END IF;
    IF EXISTS(SELECT 1 FROM public.goods_receipt_items ri JOIN public.pharmacy_inventory pi ON pi.id=ri.inventory_id
      WHERE ri.receipt_id=v_id GROUP BY pi.id,pi.quantity_in_stock HAVING pi.quantity_in_stock<sum(ri.quantity_received)) THEN
      RAISE EXCEPTION 'Insufficient stock to reverse this receipt'; END IF;
    FOR v_item IN SELECT inventory_id,sum(quantity_received) qty,sum(line_total) cost FROM public.goods_receipt_items WHERE receipt_id=v_id GROUP BY inventory_id LOOP
      UPDATE public.pharmacy_inventory SET unit_cost=CASE WHEN quantity_in_stock>v_item.qty
        THEN GREATEST(round((quantity_in_stock*COALESCE(unit_cost,0)-v_item.cost)/(quantity_in_stock-v_item.qty),6),0) ELSE 0 END
        WHERE id=v_item.inventory_id;
    END LOOP;
    INSERT INTO public.stock_movements(inventory_id,batch_id,type,quantity,reason,reference,created_by)
      SELECT inventory_id,batch_id,'adjustment',-quantity_received,'Receipt reversal: '||trim(p_command->>'reason'),v_id::TEXT,auth.uid()
      FROM public.goods_receipt_items WHERE receipt_id=v_id;
    IF v_receipt.po_id IS NOT NULL THEN
      PERFORM 1 FROM public.purchase_orders WHERE id=v_receipt.po_id FOR UPDATE;
      UPDATE public.purchase_order_items poi SET quantity_received=poi.quantity_received-undo.qty
        FROM (SELECT po_item_id,sum(quantity_received)::INTEGER qty FROM public.goods_receipt_items WHERE receipt_id=v_id GROUP BY po_item_id) undo WHERE poi.id=undo.po_item_id;
      UPDATE public.purchase_orders SET status=CASE WHEN EXISTS(SELECT 1 FROM public.purchase_order_items WHERE po_id=v_receipt.po_id AND quantity_received>0) THEN 'partially_received' ELSE 'sent' END,updated_at=NOW() WHERE id=v_receipt.po_id;
    END IF;
    UPDATE public.goods_receipts SET reversed_at=NOW(),reversal_reason=trim(p_command->>'reason'),reversed_by=auth.uid(),reversal_staff_id=v_staff_id WHERE id=v_id;
    RETURN jsonb_build_object('success',TRUE,'receipt_id',v_id);
  END IF;
  RAISE EXCEPTION 'Unknown procurement action';
END; $$;

ALTER FUNCTION public.create_purchase_order(UUID,UUID,DATE,TEXT,JSONB) SET search_path=public,pg_temp;

-- Old write paths cannot bypass staff sessions or duplicate protection.
REVOKE ALL ON FUNCTION public.create_purchase_order(UUID,UUID,DATE,TEXT,JSONB),
  public.receive_goods(UUID,UUID,UUID,TEXT,JSONB),
  public.receive_goods_t2_internal(UUID,UUID,UUID,TEXT,JSONB),
  public.receive_procurement_delivery(UUID,UUID,UUID,TEXT,JSONB,UUID,TEXT,UUID,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.suppliers,public.purchase_orders,public.purchase_order_items,public.goods_receipts,public.goods_receipt_items FROM authenticated;
REVOKE ALL ON FUNCTION public.write_procurement(UUID,JSONB,TEXT,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.write_procurement(UUID,JSONB,TEXT,JSONB) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

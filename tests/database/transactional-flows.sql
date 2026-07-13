-- Run after all migrations and supabase/seed.sql in a disposable database.
-- This script exercises real RPCs, triggers, transactions, and RLS, then rolls back.
BEGIN;

SELECT u.user_id AS pharmacy_user_id, ph.id AS pharmacy_id
FROM public.users u
JOIN public.pharmacies ph ON ph.user_id = u.user_id
WHERE u.email = 'pharmacy.test@stocmed.local'
LIMIT 1
\gset

SELECT ph.id AS other_pharmacy_id
FROM public.pharmacies ph
WHERE ph.id <> :'pharmacy_id'::uuid
LIMIT 1
\gset

SELECT p.id AS product_id
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.pharmacy_inventory pi
  WHERE pi.product_id=p.id AND pi.pharmacy_id IN (:'pharmacy_id'::uuid, :'other_pharmacy_id'::uuid)
)
LIMIT 1
\gset

\if :{?pharmacy_user_id}
\else
  \quit 1
\endif
\if :{?other_pharmacy_id}
\else
  \quit 1
\endif
\if :{?product_id}
\else
  \quit 1
\endif

SELECT set_config('test.pharmacy_id', :'pharmacy_id', true);

INSERT INTO public.pharmacy_inventory(id, pharmacy_id, product_id, price, quantity_in_stock, low_stock_threshold, is_listed)
VALUES
  ('40000000-0000-4000-8000-000000000001', :'pharmacy_id', :'product_id', 1500, 0, 10, true),
  ('40000000-0000-4000-8000-000000000002', :'other_pharmacy_id', :'product_id', 1700, 0, 10, true);

INSERT INTO public.batches(id, inventory_id, batch_number, expiry_date, quantity_received, cost_price, received_at)
VALUES ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','TXN-OPENING-1',current_date+365,40,900,now());

INSERT INTO public.stock_movements(id, inventory_id, batch_id, type, quantity, reason, reference, created_by)
VALUES ('60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','opening',40,'Transactional test fixture','TXN-SEED',:'pharmacy_user_id');

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion failed: %', message;
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'pharmacy_user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- RLS: pharmacy A cannot see pharmacy B inventory.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.pharmacy_inventory
   WHERE pharmacy_id = :'other_pharmacy_id'::uuid) = 0,
  'pharmacy A can read pharmacy B inventory'
);

-- Open one shift, then sync one cash sale twice.
SELECT public.sync_shift_open(
  '71000000-0000-4000-8000-000000000001',
  :'pharmacy_id'::uuid,
  500,
  now()
);

SELECT public.sync_pos_sale_with_shift(
  :'pharmacy_id'::uuid,
  jsonb_build_object(
    'id', '72000000-0000-4000-8000-000000000001',
    'shift_id', '71000000-0000-4000-8000-000000000001',
    'payment_method', 'cash',
    'discount', 0,
    'created_at', now(),
    'items', jsonb_build_array(jsonb_build_object(
      'inventory_id', '40000000-0000-4000-8000-000000000001',
      'batch_id', '50000000-0000-4000-8000-000000000001',
      'quantity', 1,
      'unit_price', 1,
      'line_total', 1
    ))
  )
);

SELECT public.sync_pos_sale_with_shift(
  :'pharmacy_id'::uuid,
  jsonb_build_object(
    'id', '72000000-0000-4000-8000-000000000001',
    'shift_id', '71000000-0000-4000-8000-000000000001',
    'payment_method', 'cash',
    'discount', 0,
    'created_at', now(),
    'items', jsonb_build_array(jsonb_build_object(
      'inventory_id', '40000000-0000-4000-8000-000000000001',
      'batch_id', '50000000-0000-4000-8000-000000000001',
      'quantity', 1,
      'unit_price', 999999,
      'line_total', 999999
    ))
  )
);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.stock_movements
   WHERE reference = '72000000-0000-4000-8000-000000000001') = 1,
  'replayed sale deducted stock more than once'
);
SELECT pg_temp.assert_true(
  (SELECT total FROM public.sales WHERE id = '72000000-0000-4000-8000-000000000001') = 1500,
  'server trusted client line totals instead of inventory price'
);

-- Transfer and terminal sales accrue to the shift but never to expected drawer cash.
SELECT public.sync_pos_sale_with_shift(
  :'pharmacy_id'::uuid,
  jsonb_build_object('id','72000000-0000-4000-8000-000000000002','shift_id','71000000-0000-4000-8000-000000000001','payment_method','bank_transfer','discount',0,'items',jsonb_build_array(jsonb_build_object('inventory_id','40000000-0000-4000-8000-000000000001','batch_id','50000000-0000-4000-8000-000000000001','quantity',1)))
);
SELECT public.sync_pos_sale_with_shift(
  :'pharmacy_id'::uuid,
  jsonb_build_object('id','72000000-0000-4000-8000-000000000003','shift_id','71000000-0000-4000-8000-000000000001','payment_method','pharmacy_pos_terminal','discount',0,'items',jsonb_build_array(jsonb_build_object('inventory_id','40000000-0000-4000-8000-000000000001','batch_id','50000000-0000-4000-8000-000000000001','quantity',1)))
);
SELECT public.sync_shift_close('71000000-0000-4000-8000-000000000001',:'pharmacy_id'::uuid,1900,'test variance',now());
SELECT pg_temp.assert_true(
  (SELECT expected_cash = 2000 AND variance = -100 FROM public.shifts
   WHERE id = '71000000-0000-4000-8000-000000000001'),
  'shift expected cash includes non-cash sales or variance is wrong'
);

-- Receiving: one partial delivery creates receipt, batch, movement, and cost atomically.
INSERT INTO public.suppliers(id, pharmacy_id, name)
VALUES ('73000000-0000-4000-8000-000000000001',:'pharmacy_id'::uuid,'Transactional test supplier');

SELECT public.create_purchase_order(
  :'pharmacy_id'::uuid,
  '73000000-0000-4000-8000-000000000001',
  current_date + 7,
  'transactional test',
  jsonb_build_array(jsonb_build_object(
    'product_id', :'product_id'::uuid,
    'quantity_ordered', 5,
    'unit_cost', 800
  ))
);

DO $$
DECLARE v_po uuid; v_item uuid; v_product uuid;
BEGIN
  SELECT po.id, poi.id, poi.product_id INTO v_po, v_item, v_product
  FROM public.purchase_orders po JOIN public.purchase_order_items poi ON poi.po_id=po.id
  WHERE po.supplier_id='73000000-0000-4000-8000-000000000001';
  PERFORM public.receive_goods(
    current_setting('test.pharmacy_id')::uuid,
    '73000000-0000-4000-8000-000000000001',
    v_po,
    'partial',
    jsonb_build_array(jsonb_build_object(
      'product_id',v_product,'po_item_id',v_item,'quantity_received',2,
      'unit_cost',850,'batch_number','ATOMIC-PARTIAL-1',
      'expiry_date',(current_date + 365)::text,'short_dated_confirmed',false
    ))
  );
END $$;

SELECT pg_temp.assert_true(
  (SELECT po.status='partially_received' AND poi.quantity_received=2
   FROM public.purchase_orders po JOIN public.purchase_order_items poi ON poi.po_id=po.id
   WHERE po.supplier_id='73000000-0000-4000-8000-000000000001'),
  'partial receipt did not preserve PO remainder'
);
SELECT pg_temp.assert_true(
  (SELECT count(*)=1 FROM public.goods_receipt_items gri
   JOIN public.batches b ON b.id=gri.batch_id
   JOIN public.stock_movements sm ON sm.batch_id=b.id AND sm.type='restock'
   WHERE b.batch_number='ATOMIC-PARTIAL-1' AND gri.quantity_received=2
     AND gri.unit_cost=850 AND sm.quantity=2),
  'receipt, batch, cost, and restock movement were not committed together'
);

-- A later invalid line must roll back the entire receiving call.
DO $$
DECLARE v_product uuid;
BEGIN
  SELECT product_id INTO v_product FROM public.pharmacy_inventory
  WHERE id='40000000-0000-4000-8000-000000000001';
  BEGIN
    PERFORM public.receive_goods(
      current_setting('test.pharmacy_id')::uuid,
      '73000000-0000-4000-8000-000000000001',
      NULL,
      'must roll back',
      jsonb_build_array(
        jsonb_build_object('product_id',v_product,'quantity_received',1,'unit_cost',700,'batch_number','ATOMIC-ROLLBACK-1','expiry_date',(current_date+365)::text,'short_dated_confirmed',false),
        jsonb_build_object('product_id',v_product,'quantity_received',0,'unit_cost',700,'batch_number','ATOMIC-ROLLBACK-2','expiry_date',(current_date+365)::text,'short_dated_confirmed',false)
      )
    );
    RAISE EXCEPTION 'invalid receiving call unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid receiving call unexpectedly succeeded' THEN RAISE; END IF;
  END;
END $$;

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.batches WHERE batch_number IN ('ATOMIC-ROLLBACK-1','ATOMIC-ROLLBACK-2')),
  'failed receiving call partially committed a batch'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.goods_receipts WHERE notes='must roll back'),
  'failed receiving call partially committed a receipt'
);

ROLLBACK;

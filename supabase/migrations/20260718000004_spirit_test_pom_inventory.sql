-- Give the explicitly labelled Spirit dogfood account one verified POM line so
-- its destination-Model-A workflow can be exercised without touching real
-- pharmacy inventory or globally enabling staffed clinical flows.

DO $$
DECLARE
  v_pharmacy_id UUID := '2937265c-c164-4fda-918f-cb4ece9e29f2'::UUID;
  v_product_id UUID;
  v_inventory_id UUID;
  v_batch_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacies
    WHERE id = v_pharmacy_id AND is_test_account AND is_verified
      AND verification_status = 'full' AND reservations_enabled
  ) THEN
    RAISE NOTICE 'Skipping Spirit POM fixture: Spirit ideal test account is not present in this environment';
    RETURN;
  END IF;

  SELECT id INTO v_product_id
  FROM public.products
  WHERE is_verified AND requires_prescription
  ORDER BY CASE WHEN LOWER(generic_name) LIKE 'amlodipine%' THEN 0 ELSE 1 END, id
  LIMIT 1;
  IF v_product_id IS NULL THEN RAISE EXCEPTION 'No verified POM catalogue product exists'; END IF;

  INSERT INTO public.pharmacy_inventory (
    pharmacy_id, product_id, price, low_stock_threshold, is_listed, notes
  ) VALUES (
    v_pharmacy_id, v_product_id, 1000, 5, TRUE,
    'TEST ONLY: Spirit Model A digital-Rx dogfood stock'
  )
  ON CONFLICT (pharmacy_id, product_id) DO UPDATE
  SET is_listed = TRUE, deleted_at = NULL,
      notes = EXCLUDED.notes, updated_at = NOW()
  RETURNING id INTO v_inventory_id;

  SELECT id INTO v_batch_id FROM public.batches
  WHERE inventory_id = v_inventory_id AND batch_number = 'SPIRIT-RX-TEST-001';
  IF v_batch_id IS NULL THEN
    INSERT INTO public.batches (
      inventory_id, batch_number, expiry_date, quantity_received, cost_price
    ) VALUES (
      v_inventory_id, 'SPIRIT-RX-TEST-001', CURRENT_DATE + 365, 20, 500
    ) RETURNING id INTO v_batch_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE inventory_id = v_inventory_id
      AND reference = 'SPIRIT_RX_TEST_OPENING'
  ) THEN
    INSERT INTO public.stock_movements (
      inventory_id, batch_id, type, quantity, reason, reference,
      created_by
    ) VALUES (
      v_inventory_id, v_batch_id, 'opening', 20,
      'TEST ONLY: Spirit Model A dogfood opening stock',
      'SPIRIT_RX_TEST_OPENING',
      'd19fb6e7-96b9-45be-aaca-fa2af59edfdd'::UUID
    );
  END IF;
END;
$$;

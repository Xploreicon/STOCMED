-- Database migration for ledger fixes and atomicity

-- 1. Update handle_sale_completion to be idempotent and store reference
CREATE OR REPLACE FUNCTION public.handle_sale_completion()
RETURNS TRIGGER AS $$
DECLARE
    item RECORD;
BEGIN
    -- Check if stock movements already exist for this sale
    IF EXISTS (
        SELECT 1 FROM public.stock_movements 
        WHERE reference = NEW.id::text
    ) THEN
        RETURN NEW;
    END IF;

    -- Loop through all items in the sale
    FOR item IN 
        SELECT * FROM public.sale_items WHERE sale_id = NEW.id
    Loop
        -- Insert negative stock movement for each item
        INSERT INTO public.stock_movements (
            inventory_id,
            batch_id,
            type,
            quantity,
            reason,
            reference,
            created_by
        ) VALUES (
            item.inventory_id,
            item.batch_id,
            'sale',
            -item.quantity, -- negative to deduct stock
            'Sale #' || NEW.id,
            NEW.id::text,
            NEW.cashier_id
        );
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Add CHECK constraint on pharmacy_inventory(quantity_in_stock) to prevent negative stock counts
UPDATE public.pharmacy_inventory SET quantity_in_stock = 0 WHERE quantity_in_stock < 0;
ALTER TABLE public.pharmacy_inventory DROP CONSTRAINT IF EXISTS quantity_in_stock_non_negative;
ALTER TABLE public.pharmacy_inventory ADD CONSTRAINT quantity_in_stock_non_negative CHECK (quantity_in_stock >= 0);

-- 3. Implement void_sale function
CREATE OR REPLACE FUNCTION public.void_sale(p_sale_id UUID, p_cashier_id UUID)
RETURNS VOID AS $$
DECLARE
    v_status TEXT;
    v_mov RECORD;
BEGIN
    -- Get current status of the sale
    SELECT status INTO v_status FROM public.sales WHERE id = p_sale_id;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Sale not found';
    END IF;
    IF v_status = 'voided' THEN
        -- Already voided, do nothing
        RETURN;
    END IF;
    
    -- Update sale status to voided
    UPDATE public.sales 
    SET status = 'voided', updated_at = NOW() 
    WHERE id = p_sale_id;

    -- Reverse stock movements
    FOR v_mov IN 
        SELECT * FROM public.stock_movements 
        WHERE reference = p_sale_id::text OR reason = 'Sale #' || p_sale_id
    LOOP
        -- Insert reversing movement if not already reversed
        IF NOT EXISTS (
            SELECT 1 FROM public.stock_movements 
            WHERE reference = 'void_' || p_sale_id::text 
              AND inventory_id = v_mov.inventory_id
              AND COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_mov.batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ) THEN
            INSERT INTO public.stock_movements (
                inventory_id,
                batch_id,
                type,
                quantity,
                reason,
                reference,
                created_by
            ) VALUES (
                v_mov.inventory_id,
                v_mov.batch_id,
                'return',
                -v_mov.quantity, -- Reversing: positive quantity to restore stock
                'Void of Sale #' || p_sale_id,
                'void_' || p_sale_id::text,
                p_cashier_id
            );
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Implement import_inventory_row function for atomic imports
CREATE OR REPLACE FUNCTION public.import_inventory_row(
    p_pharmacy_id UUID,
    p_user_id UUID,
    p_selected_product_id TEXT,
    p_mapped JSONB
)
RETURNS JSONB AS $$
DECLARE
    v_product_id UUID;
    v_inventory_id UUID;
    v_batch_id UUID;
    v_batch_number TEXT;
    v_expiry_date TEXT;
    v_quantity INTEGER;
    v_price NUMERIC;
    v_generic_name TEXT;
    v_brand_name TEXT;
    v_strength TEXT;
    v_dosage_form TEXT;
    v_category TEXT;
    v_pack_size TEXT;
    v_result JSONB;
BEGIN
    -- Extract values from JSONB
    v_generic_name := p_mapped->>'generic_name';
    v_brand_name := p_mapped->>'brand_name';
    v_strength := COALESCE(p_mapped->>'strength', 'unspecified');
    v_dosage_form := COALESCE(p_mapped->>'dosage_form', 'Tablet');
    v_category := COALESCE(p_mapped->>'category', 'Others');
    v_pack_size := p_mapped->>'pack_size';
    
    v_price := (p_mapped->>'price')::NUMERIC;
    v_quantity := COALESCE((p_mapped->>'quantity')::INTEGER, 0);
    v_batch_number := p_mapped->>'batch_number';
    v_expiry_date := p_mapped->>'expiry_date';

    -- Step 1: Create or resolve product
    IF p_selected_product_id = 'create_new' OR p_selected_product_id IS NULL OR p_selected_product_id = '' THEN
        -- Check if a product with same signature already exists to prevent unique constraint violation
        SELECT id INTO v_product_id 
        FROM public.products
        WHERE generic_name = v_generic_name
          AND strength = v_strength
          AND dosage_form = v_dosage_form
          AND COALESCE(pack_size, '') = COALESCE(v_pack_size, '')
          AND COALESCE(brand_name, '') = COALESCE(v_brand_name, '')
        LIMIT 1;

        IF v_product_id IS NULL THEN
            INSERT INTO public.products (
                generic_name,
                brand_name,
                strength,
                dosage_form,
                category,
                pack_size,
                is_verified
            ) VALUES (
                v_generic_name,
                v_brand_name,
                v_strength,
                v_dosage_form,
                v_category,
                v_pack_size,
                FALSE
            ) RETURNING id INTO v_product_id;
        END IF;
    ELSE
        v_product_id := p_selected_product_id::UUID;
    END IF;

    -- Step 2: Ensure pharmacy_inventory record exists
    SELECT id INTO v_inventory_id
    FROM public.pharmacy_inventory
    WHERE pharmacy_id = p_pharmacy_id AND product_id = v_product_id;

    IF v_inventory_id IS NOT NULL THEN
        IF v_price IS NOT NULL AND v_price > 0 THEN
            UPDATE public.pharmacy_inventory
            SET price = v_price, updated_at = NOW()
            WHERE id = v_inventory_id;
        END IF;
    ELSE
        INSERT INTO public.pharmacy_inventory (
            pharmacy_id,
            product_id,
            price,
            low_stock_threshold,
            quantity_in_stock,
            is_listed
        ) VALUES (
            p_pharmacy_id,
            v_product_id,
            COALESCE(v_price, 0),
            10,
            0,
            TRUE
        ) RETURNING id INTO v_inventory_id;
    END IF;

    -- Step 3: Insert batch record
    IF v_batch_number IS NULL OR v_batch_number = '' THEN
        v_batch_number := 'BATCH-' || extract(epoch from now())::bigint::text;
    END IF;
    
    IF v_expiry_date IS NULL OR v_expiry_date = '' THEN
        v_expiry_date := (CURRENT_DATE + INTERVAL '365 days')::TEXT;
    END IF;

    INSERT INTO public.batches (
        inventory_id,
        batch_number,
        expiry_date,
        quantity_received,
        cost_price
    ) VALUES (
        v_inventory_id,
        v_batch_number,
        v_expiry_date::DATE,
        v_quantity,
        NULL
    ) RETURNING id INTO v_batch_id;

    -- Step 4: Insert stock movement
    INSERT INTO public.stock_movements (
        inventory_id,
        batch_id,
        type,
        quantity,
        reason,
        created_by
    ) VALUES (
        v_inventory_id,
        v_batch_id,
        'opening',
        v_quantity,
        'Opening stock (Imported)',
        p_user_id
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'product_id', v_product_id,
        'inventory_id', v_inventory_id,
        'batch_id', v_batch_id
    );

    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', FALSE,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Enable pg_trgm extension and create GIN trigram indexes on products
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS products_generic_name_trgm_idx ON public.products USING gin (generic_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_brand_name_trgm_idx ON public.products USING gin (brand_name gin_trgm_ops);

-- Create payment_method_type enum if it does not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method_type') THEN
        CREATE TYPE payment_method_type AS ENUM ('cash', 'bank_transfer', 'pharmacy_pos_terminal', 'other');
    END IF;
END$$;

-- Create sales table
CREATE TABLE IF NOT EXISTS public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    cashier_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12, 2) NOT NULL,
    payment_method payment_method_type NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'cancelled'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create sale_items table
CREATE TABLE IF NOT EXISTS public.sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES public.pharmacy_inventory(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL,
    line_total NUMERIC(12, 2) NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS sales_pharmacy_id_idx ON public.sales(pharmacy_id);
CREATE INDEX IF NOT EXISTS sales_created_at_idx ON public.sales(created_at);
CREATE INDEX IF NOT EXISTS sale_items_sale_id_idx ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS sale_items_inventory_id_idx ON public.sale_items(inventory_id);

-- Enable RLS
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Pharmacies can view their own sales" ON public.sales;
DROP POLICY IF EXISTS "Pharmacies can manage their own sales" ON public.sales;
DROP POLICY IF EXISTS "Pharmacies can view their own sale items" ON public.sale_items;
DROP POLICY IF EXISTS "Pharmacies can manage their own sale items" ON public.sale_items;

-- Create RLS policies for sales
CREATE POLICY "Pharmacies can view their own sales" ON public.sales
    FOR SELECT
    USING (
        pharmacy_id IN (
            SELECT id FROM public.pharmacies WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Pharmacies can manage their own sales" ON public.sales
    FOR ALL
    USING (
        pharmacy_id IN (
            SELECT id FROM public.pharmacies WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        pharmacy_id IN (
            SELECT id FROM public.pharmacies WHERE user_id = auth.uid()
        )
    );

-- Create RLS policies for sale_items (joined via sales)
CREATE POLICY "Pharmacies can view their own sale items" ON public.sale_items
    FOR SELECT
    USING (
        sale_id IN (
            SELECT id FROM public.sales WHERE pharmacy_id IN (
                SELECT id FROM public.pharmacies WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Pharmacies can manage their own sale items" ON public.sale_items
    FOR ALL
    USING (
        sale_id IN (
            SELECT id FROM public.sales WHERE pharmacy_id IN (
                SELECT id FROM public.pharmacies WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        sale_id IN (
            SELECT id FROM public.sales WHERE pharmacy_id IN (
                SELECT id FROM public.pharmacies WHERE user_id = auth.uid()
            )
        )
    );

-- Stock movements automation trigger on sale completion
CREATE OR REPLACE FUNCTION public.handle_sale_completion()
RETURNS TRIGGER AS $$
DECLARE
    item RECORD;
BEGIN
    -- Loop through all items in the sale
    FOR item IN 
        SELECT * FROM public.sale_items WHERE sale_id = NEW.id
    LOOP
        -- Insert negative stock movement for each item
        INSERT INTO public.stock_movements (
            inventory_id,
            batch_id,
            type,
            quantity,
            reason,
            created_by
        ) VALUES (
            item.inventory_id,
            item.batch_id,
            'sale',
            -item.quantity, -- negative to deduct stock
            'Sale #' || NEW.id,
            NEW.cashier_id
        );
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger fires on status transitions to 'completed'
DROP TRIGGER IF EXISTS sales_after_status_completed ON public.sales;
CREATE TRIGGER sales_after_status_completed
    AFTER UPDATE OF status ON public.sales
    FOR EACH ROW
    WHEN (NEW.status = 'completed' AND OLD.status <> 'completed')
    EXECUTE FUNCTION public.handle_sale_completion();

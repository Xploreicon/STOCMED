-- Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create controlled lookup tables
CREATE TABLE IF NOT EXISTS public.dosage_forms (
    name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS public.product_categories (
    name TEXT PRIMARY KEY
);

-- Controlled lookup data
INSERT INTO public.dosage_forms (name) VALUES ('tablet') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.dosage_forms (name) VALUES ('capsule') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.dosage_forms (name) VALUES ('syrup') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.dosage_forms (name) VALUES ('injection') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.dosage_forms (name) VALUES ('cream') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.dosage_forms (name) VALUES ('drops') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.dosage_forms (name) VALUES ('inhaler') ON CONFLICT (name) DO NOTHING;

INSERT INTO public.product_categories (name) VALUES ('Analgesics') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.product_categories (name) VALUES ('Antibiotics') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.product_categories (name) VALUES ('Antimalarials') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.product_categories (name) VALUES ('Antihypertensives') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.product_categories (name) VALUES ('Diabetes') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.product_categories (name) VALUES ('Vitamins') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.product_categories (name) VALUES ('Gastrointestinal') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.product_categories (name) VALUES ('Respiratory') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.product_categories (name) VALUES ('Others') ON CONFLICT (name) DO NOTHING;

-- Create products table
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    generic_name TEXT NOT NULL,
    brand_name TEXT,
    manufacturer TEXT,
    strength TEXT NOT NULL,
    dosage_form TEXT REFERENCES public.dosage_forms(name),
    category TEXT REFERENCES public.product_categories(name),
    pack_size TEXT,
    nafdac_number TEXT,
    barcode TEXT,
    atc_code TEXT,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(generic_name, '') || ' ' || coalesce(brand_name, ''))
    ) STORED,
    requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    image_url TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigrams + FTS indexes
CREATE INDEX IF NOT EXISTS products_generic_name_trgm_idx ON public.products USING gin (generic_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_brand_name_trgm_idx ON public.products USING gin (brand_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_nafdac_idx ON public.products(nafdac_number);
CREATE INDEX IF NOT EXISTS products_barcode_idx ON public.products(barcode);
CREATE INDEX IF NOT EXISTS products_search_vector_idx ON public.products USING gin (search_vector);

-- Unique index using coalesce to handle nullable brand_name
CREATE UNIQUE INDEX IF NOT EXISTS products_unique_idx ON public.products (
    generic_name, 
    strength, 
    dosage_form, 
    coalesce(pack_size, ''), 
    coalesce(brand_name, '')
);

-- Seed products
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Emzor', 'GlaxoSmithKline', '500mg', 'tablet', 'Analgesics', '30s', true, 'A4-10001', '61500000001') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Panadol', 'May & Baker', '500mg', 'tablet', 'Analgesics', '100s', true, 'A4-10002', '61500000002') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'M&B', 'Micro Labs', '500mg', 'tablet', 'Analgesics', '10x10', true, 'A4-10003', '61500000003') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Boska', 'Emzor Pharmaceuticals', '500mg', 'tablet', 'Analgesics', 'Bottles of 60ml', true, 'A4-10004', '61500000004') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Pacimol', 'GlaxoSmithKline', '500mg', 'tablet', 'Analgesics', 'Bottles of 100ml', true, 'A4-10005', '61500000005') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Emzor', 'May & Baker', '125mg/5ml', 'tablet', 'Analgesics', 'Tubes of 20g', true, 'A4-10006', '61500000006') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Panadol', 'Micro Labs', '125mg/5ml', 'tablet', 'Analgesics', 'Pack of 1', true, 'A4-10007', '61500000007') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'M&B', 'Emzor Pharmaceuticals', '125mg/5ml', 'tablet', 'Analgesics', '10s', true, 'A4-10008', '61500000008') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Boska', 'GlaxoSmithKline', '125mg/5ml', 'tablet', 'Analgesics', '30s', true, 'A4-10009', '61500000009') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Pacimol', 'May & Baker', '125mg/5ml', 'tablet', 'Analgesics', '100s', true, 'A4-10010', '61500000010') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Emzor', 'Micro Labs', '250mg/5ml', 'tablet', 'Analgesics', '10x10', true, 'A4-10011', '61500000011') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Panadol', 'Emzor Pharmaceuticals', '250mg/5ml', 'tablet', 'Analgesics', 'Bottles of 60ml', true, 'A4-10012', '61500000012') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'M&B', 'GlaxoSmithKline', '250mg/5ml', 'tablet', 'Analgesics', 'Bottles of 100ml', true, 'A4-10013', '61500000013') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Boska', 'May & Baker', '250mg/5ml', 'tablet', 'Analgesics', 'Tubes of 20g', true, 'A4-10014', '61500000014') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Pacimol', 'Micro Labs', '250mg/5ml', 'tablet', 'Analgesics', 'Pack of 1', true, 'A4-10015', '61500000015') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Emzor', 'Emzor Pharmaceuticals', '500mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10016', '61500000016') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Panadol', 'GlaxoSmithKline', '500mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10017', '61500000017') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'M&B', 'May & Baker', '500mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10018', '61500000018') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Boska', 'Micro Labs', '500mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10019', '61500000019') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Pacimol', 'Emzor Pharmaceuticals', '500mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10020', '61500000020') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Emzor', 'GlaxoSmithKline', '125mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10021', '61500000021') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Panadol', 'May & Baker', '125mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10022', '61500000022') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'M&B', 'Micro Labs', '125mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10023', '61500000023') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Boska', 'Emzor Pharmaceuticals', '125mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10024', '61500000024') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Pacimol', 'GlaxoSmithKline', '125mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10025', '61500000025') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Emzor', 'May & Baker', '250mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10026', '61500000026') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Panadol', 'Micro Labs', '250mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10027', '61500000027') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'M&B', 'Emzor Pharmaceuticals', '250mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10028', '61500000028') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Boska', 'GlaxoSmithKline', '250mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10029', '61500000029') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Paracetamol', 'Pacimol', 'May & Baker', '250mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10030', '61500000030') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Coartem', 'Shalina Healthcare', '20/120mg', 'tablet', 'Antimalarials', 'Pack of 1', true, 'A4-10031', '61500000031') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lonart', 'Novartis', '20/120mg', 'tablet', 'Antimalarials', '10s', true, 'A4-10032', '61500000032') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Amatem', 'Bliss GVS', '20/120mg', 'tablet', 'Antimalarials', '30s', true, 'A4-10033', '61500000033') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lartem', 'Fidson Healthcare', '20/120mg', 'tablet', 'Antimalarials', '100s', true, 'A4-10034', '61500000034') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lokmal', 'Shalina Healthcare', '20/120mg', 'tablet', 'Antimalarials', '10x10', true, 'A4-10035', '61500000035') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Coartem', 'Novartis', '80/480mg', 'tablet', 'Antimalarials', 'Bottles of 60ml', true, 'A4-10036', '61500000036') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lonart', 'Bliss GVS', '80/480mg', 'tablet', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10037', '61500000037') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Amatem', 'Fidson Healthcare', '80/480mg', 'tablet', 'Antimalarials', 'Tubes of 20g', true, 'A4-10038', '61500000038') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lartem', 'Shalina Healthcare', '80/480mg', 'tablet', 'Antimalarials', 'Pack of 1', true, 'A4-10039', '61500000039') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lokmal', 'Novartis', '80/480mg', 'tablet', 'Antimalarials', '10s', true, 'A4-10040', '61500000040') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Coartem', 'Bliss GVS', '180/1080mg', 'tablet', 'Antimalarials', '30s', true, 'A4-10041', '61500000041') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lonart', 'Fidson Healthcare', '180/1080mg', 'tablet', 'Antimalarials', '100s', true, 'A4-10042', '61500000042') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Amatem', 'Shalina Healthcare', '180/1080mg', 'tablet', 'Antimalarials', '10x10', true, 'A4-10043', '61500000043') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lartem', 'Novartis', '180/1080mg', 'tablet', 'Antimalarials', 'Bottles of 60ml', true, 'A4-10044', '61500000044') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lokmal', 'Bliss GVS', '180/1080mg', 'tablet', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10045', '61500000045') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Coartem', 'Fidson Healthcare', '20/120mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10046', '61500000046') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lonart', 'Shalina Healthcare', '20/120mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10047', '61500000047') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Amatem', 'Novartis', '20/120mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10048', '61500000048') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lartem', 'Bliss GVS', '20/120mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10049', '61500000049') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lokmal', 'Fidson Healthcare', '20/120mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10050', '61500000050') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Coartem', 'Shalina Healthcare', '80/480mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10051', '61500000051') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lonart', 'Novartis', '80/480mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10052', '61500000052') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Amatem', 'Bliss GVS', '80/480mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10053', '61500000053') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lartem', 'Fidson Healthcare', '80/480mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10054', '61500000054') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lokmal', 'Shalina Healthcare', '80/480mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10055', '61500000055') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Coartem', 'Novartis', '180/1080mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10056', '61500000056') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lonart', 'Bliss GVS', '180/1080mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10057', '61500000057') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Amatem', 'Fidson Healthcare', '180/1080mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10058', '61500000058') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lartem', 'Shalina Healthcare', '180/1080mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10059', '61500000059') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Artemether + Lumefantrine', 'Lokmal', 'Novartis', '180/1080mg', 'syrup', 'Antimalarials', 'Bottles of 100ml', true, 'A4-10060', '61500000060') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Amoxil', 'Emzor Pharmaceuticals', '250mg', 'capsule', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10061', '61500000061') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Emzamil', 'Fidson Healthcare', '250mg', 'capsule', 'Antibiotics', 'Tubes of 20g', true, 'A4-10062', '61500000062') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Fidson Amox', 'Beecham', '250mg', 'capsule', 'Antibiotics', 'Pack of 1', true, 'A4-10063', '61500000063') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Beecham', 'GlaxoSmithKline', '250mg', 'capsule', 'Antibiotics', '10s', true, 'A4-10064', '61500000064') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Amoxil', 'Emzor Pharmaceuticals', '500mg', 'capsule', 'Antibiotics', '30s', true, 'A4-10065', '61500000065') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Emzamil', 'Fidson Healthcare', '500mg', 'capsule', 'Antibiotics', '100s', true, 'A4-10066', '61500000066') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Fidson Amox', 'Beecham', '500mg', 'capsule', 'Antibiotics', '10x10', true, 'A4-10067', '61500000067') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Beecham', 'GlaxoSmithKline', '500mg', 'capsule', 'Antibiotics', 'Bottles of 60ml', true, 'A4-10068', '61500000068') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Amoxil', 'Emzor Pharmaceuticals', '125mg/5ml', 'capsule', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10069', '61500000069') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Emzamil', 'Fidson Healthcare', '125mg/5ml', 'capsule', 'Antibiotics', 'Tubes of 20g', true, 'A4-10070', '61500000070') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Fidson Amox', 'Beecham', '125mg/5ml', 'capsule', 'Antibiotics', 'Pack of 1', true, 'A4-10071', '61500000071') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Beecham', 'GlaxoSmithKline', '125mg/5ml', 'capsule', 'Antibiotics', '10s', true, 'A4-10072', '61500000072') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Amoxil', 'Emzor Pharmaceuticals', '250mg/5ml', 'capsule', 'Antibiotics', '30s', true, 'A4-10073', '61500000073') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Emzamil', 'Fidson Healthcare', '250mg/5ml', 'capsule', 'Antibiotics', '100s', true, 'A4-10074', '61500000074') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Fidson Amox', 'Beecham', '250mg/5ml', 'capsule', 'Antibiotics', '10x10', true, 'A4-10075', '61500000075') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Beecham', 'GlaxoSmithKline', '250mg/5ml', 'capsule', 'Antibiotics', 'Bottles of 60ml', true, 'A4-10076', '61500000076') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Amoxil', 'Emzor Pharmaceuticals', '250mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10077', '61500000077') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Emzamil', 'Fidson Healthcare', '250mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10078', '61500000078') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Fidson Amox', 'Beecham', '250mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10079', '61500000079') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Beecham', 'GlaxoSmithKline', '250mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10080', '61500000080') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Amoxil', 'Emzor Pharmaceuticals', '500mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10081', '61500000081') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Emzamil', 'Fidson Healthcare', '500mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10082', '61500000082') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Fidson Amox', 'Beecham', '500mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10083', '61500000083') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Beecham', 'GlaxoSmithKline', '500mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10084', '61500000084') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Amoxil', 'Emzor Pharmaceuticals', '125mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10085', '61500000085') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Emzamil', 'Fidson Healthcare', '125mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10086', '61500000086') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Fidson Amox', 'Beecham', '125mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10087', '61500000087') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Beecham', 'GlaxoSmithKline', '125mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10088', '61500000088') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Amoxil', 'Emzor Pharmaceuticals', '250mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10089', '61500000089') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Emzamil', 'Fidson Healthcare', '250mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10090', '61500000090') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Fidson Amox', 'Beecham', '250mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10091', '61500000091') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin', 'Beecham', 'GlaxoSmithKline', '250mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10092', '61500000092') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Augmentin', 'Medreich', '375mg', 'tablet', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10093', '61500000093') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Fleming', 'Lek', '375mg', 'tablet', 'Antibiotics', 'Tubes of 20g', true, 'A4-10094', '61500000094') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Amoksiklav', 'Fidson Healthcare', '375mg', 'tablet', 'Antibiotics', 'Pack of 1', true, 'A4-10095', '61500000095') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Co-Amoxiclav', 'GlaxoSmithKline', '375mg', 'tablet', 'Antibiotics', '10s', true, 'A4-10096', '61500000096') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Augmentin', 'Medreich', '625mg', 'tablet', 'Antibiotics', '30s', true, 'A4-10097', '61500000097') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Fleming', 'Lek', '625mg', 'tablet', 'Antibiotics', '100s', true, 'A4-10098', '61500000098') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Amoksiklav', 'Fidson Healthcare', '625mg', 'tablet', 'Antibiotics', '10x10', true, 'A4-10099', '61500000099') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Co-Amoxiclav', 'GlaxoSmithKline', '625mg', 'tablet', 'Antibiotics', 'Bottles of 60ml', true, 'A4-10100', '61500000100') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Augmentin', 'Medreich', '1g', 'tablet', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10101', '61500000101') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Fleming', 'Lek', '1g', 'tablet', 'Antibiotics', 'Tubes of 20g', true, 'A4-10102', '61500000102') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Amoksiklav', 'Fidson Healthcare', '1g', 'tablet', 'Antibiotics', 'Pack of 1', true, 'A4-10103', '61500000103') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Co-Amoxiclav', 'GlaxoSmithKline', '1g', 'tablet', 'Antibiotics', '10s', true, 'A4-10104', '61500000104') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Augmentin', 'Medreich', '228mg/5ml', 'tablet', 'Antibiotics', '30s', true, 'A4-10105', '61500000105') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Fleming', 'Lek', '228mg/5ml', 'tablet', 'Antibiotics', '100s', true, 'A4-10106', '61500000106') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Amoksiklav', 'Fidson Healthcare', '228mg/5ml', 'tablet', 'Antibiotics', '10x10', true, 'A4-10107', '61500000107') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Co-Amoxiclav', 'GlaxoSmithKline', '228mg/5ml', 'tablet', 'Antibiotics', 'Bottles of 60ml', true, 'A4-10108', '61500000108') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Augmentin', 'Medreich', '457mg/5ml', 'tablet', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10109', '61500000109') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Fleming', 'Lek', '457mg/5ml', 'tablet', 'Antibiotics', 'Tubes of 20g', true, 'A4-10110', '61500000110') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Amoksiklav', 'Fidson Healthcare', '457mg/5ml', 'tablet', 'Antibiotics', 'Pack of 1', true, 'A4-10111', '61500000111') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Co-Amoxiclav', 'GlaxoSmithKline', '457mg/5ml', 'tablet', 'Antibiotics', '10s', true, 'A4-10112', '61500000112') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Augmentin', 'Medreich', '375mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10113', '61500000113') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Fleming', 'Lek', '375mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10114', '61500000114') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Amoksiklav', 'Fidson Healthcare', '375mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10115', '61500000115') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Co-Amoxiclav', 'GlaxoSmithKline', '375mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10116', '61500000116') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Augmentin', 'Medreich', '625mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10117', '61500000117') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Fleming', 'Lek', '625mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10118', '61500000118') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Amoksiklav', 'Fidson Healthcare', '625mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10119', '61500000119') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Co-Amoxiclav', 'GlaxoSmithKline', '625mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10120', '61500000120') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Augmentin', 'Medreich', '1g', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10121', '61500000121') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Fleming', 'Lek', '1g', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10122', '61500000122') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Amoksiklav', 'Fidson Healthcare', '1g', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10123', '61500000123') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Co-Amoxiclav', 'GlaxoSmithKline', '1g', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10124', '61500000124') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Augmentin', 'Medreich', '228mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10125', '61500000125') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Fleming', 'Lek', '228mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10126', '61500000126') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Amoksiklav', 'Fidson Healthcare', '228mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10127', '61500000127') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Co-Amoxiclav', 'GlaxoSmithKline', '228mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10128', '61500000128') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Augmentin', 'Medreich', '457mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10129', '61500000129') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Fleming', 'Lek', '457mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10130', '61500000130') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Amoksiklav', 'Fidson Healthcare', '457mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10131', '61500000131') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amoxicillin + Clavulanic Acid', 'Co-Amoxiclav', 'GlaxoSmithKline', '457mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10132', '61500000132') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprotab', 'Shalina Healthcare', '250mg', 'tablet', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10133', '61500000133') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprogyl', 'Bayer', '250mg', 'tablet', 'Antibiotics', 'Tubes of 20g', true, 'A4-10134', '61500000134') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciproxin', 'Juhel', '250mg', 'tablet', 'Antibiotics', 'Pack of 1', true, 'A4-10135', '61500000135') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Fidson Cipro', 'Fidson Healthcare', '250mg', 'tablet', 'Antibiotics', '10s', true, 'A4-10136', '61500000136') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprotab', 'Shalina Healthcare', '500mg', 'tablet', 'Antibiotics', '30s', true, 'A4-10137', '61500000137') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprogyl', 'Bayer', '500mg', 'tablet', 'Antibiotics', '100s', true, 'A4-10138', '61500000138') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciproxin', 'Juhel', '500mg', 'tablet', 'Antibiotics', '10x10', true, 'A4-10139', '61500000139') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Fidson Cipro', 'Fidson Healthcare', '500mg', 'tablet', 'Antibiotics', 'Bottles of 60ml', true, 'A4-10140', '61500000140') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprotab', 'Shalina Healthcare', '750mg', 'tablet', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10141', '61500000141') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprogyl', 'Bayer', '750mg', 'tablet', 'Antibiotics', 'Tubes of 20g', true, 'A4-10142', '61500000142') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciproxin', 'Juhel', '750mg', 'tablet', 'Antibiotics', 'Pack of 1', true, 'A4-10143', '61500000143') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Fidson Cipro', 'Fidson Healthcare', '750mg', 'tablet', 'Antibiotics', '10s', true, 'A4-10144', '61500000144') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprotab', 'Shalina Healthcare', '0.3%', 'tablet', 'Antibiotics', '30s', true, 'A4-10145', '61500000145') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprogyl', 'Bayer', '0.3%', 'tablet', 'Antibiotics', '100s', true, 'A4-10146', '61500000146') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciproxin', 'Juhel', '0.3%', 'tablet', 'Antibiotics', '10x10', true, 'A4-10147', '61500000147') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Fidson Cipro', 'Fidson Healthcare', '0.3%', 'tablet', 'Antibiotics', 'Bottles of 60ml', true, 'A4-10148', '61500000148') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprotab', 'Shalina Healthcare', '250mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10149', '61500000149') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprogyl', 'Bayer', '250mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10150', '61500000150') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciproxin', 'Juhel', '250mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10151', '61500000151') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Fidson Cipro', 'Fidson Healthcare', '250mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10152', '61500000152') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprotab', 'Shalina Healthcare', '500mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10153', '61500000153') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprogyl', 'Bayer', '500mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10154', '61500000154') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciproxin', 'Juhel', '500mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10155', '61500000155') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Fidson Cipro', 'Fidson Healthcare', '500mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10156', '61500000156') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprotab', 'Shalina Healthcare', '750mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10157', '61500000157') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprogyl', 'Bayer', '750mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10158', '61500000158') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciproxin', 'Juhel', '750mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10159', '61500000159') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Fidson Cipro', 'Fidson Healthcare', '750mg', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10160', '61500000160') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprotab', 'Shalina Healthcare', '0.3%', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10161', '61500000161') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciprogyl', 'Bayer', '0.3%', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10162', '61500000162') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Ciproxin', 'Juhel', '0.3%', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10163', '61500000163') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ciprofloxacin', 'Fidson Cipro', 'Fidson Healthcare', '0.3%', 'drops', 'Antibiotics', 'Pack of 1', true, 'A4-10164', '61500000164') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Flagyl', 'Sanofi', '200mg', 'tablet', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10165', '61500000165') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Metrogyl', 'Unique Pharma', '200mg', 'tablet', 'Antibiotics', 'Tubes of 20g', true, 'A4-10166', '61500000166') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Emzazole', 'Emzor Pharmaceuticals', '200mg', 'tablet', 'Antibiotics', 'Pack of 1', true, 'A4-10167', '61500000167') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Flagyl', 'Sanofi', '400mg', 'tablet', 'Antibiotics', '10s', true, 'A4-10168', '61500000168') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Metrogyl', 'Unique Pharma', '400mg', 'tablet', 'Antibiotics', '30s', true, 'A4-10169', '61500000169') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Emzazole', 'Emzor Pharmaceuticals', '400mg', 'tablet', 'Antibiotics', '100s', true, 'A4-10170', '61500000170') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Flagyl', 'Sanofi', '200mg/5ml', 'tablet', 'Antibiotics', '10x10', true, 'A4-10171', '61500000171') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Metrogyl', 'Unique Pharma', '200mg/5ml', 'tablet', 'Antibiotics', 'Bottles of 60ml', true, 'A4-10172', '61500000172') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Emzazole', 'Emzor Pharmaceuticals', '200mg/5ml', 'tablet', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10173', '61500000173') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Flagyl', 'Sanofi', '200mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10174', '61500000174') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Metrogyl', 'Unique Pharma', '200mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10175', '61500000175') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Emzazole', 'Emzor Pharmaceuticals', '200mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10176', '61500000176') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Flagyl', 'Sanofi', '400mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10177', '61500000177') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Metrogyl', 'Unique Pharma', '400mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10178', '61500000178') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Emzazole', 'Emzor Pharmaceuticals', '400mg', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10179', '61500000179') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Flagyl', 'Sanofi', '200mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10180', '61500000180') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Metrogyl', 'Unique Pharma', '200mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10181', '61500000181') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metronidazole', 'Emzazole', 'Emzor Pharmaceuticals', '200mg/5ml', 'syrup', 'Antibiotics', 'Bottles of 100ml', true, 'A4-10182', '61500000182') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Emzor Ibuprofen', 'Emzor Pharmaceuticals', '200mg', 'tablet', 'Analgesics', 'Pack of 1', true, 'A4-10183', '61500000183') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Ibufen', 'Fidson Healthcare', '200mg', 'tablet', 'Analgesics', '10s', true, 'A4-10184', '61500000184') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Advill', 'Pfizer', '200mg', 'tablet', 'Analgesics', '30s', true, 'A4-10185', '61500000185') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Emzor Ibuprofen', 'Emzor Pharmaceuticals', '400mg', 'tablet', 'Analgesics', '100s', true, 'A4-10186', '61500000186') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Ibufen', 'Fidson Healthcare', '400mg', 'tablet', 'Analgesics', '10x10', true, 'A4-10187', '61500000187') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Advill', 'Pfizer', '400mg', 'tablet', 'Analgesics', 'Bottles of 60ml', true, 'A4-10188', '61500000188') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Emzor Ibuprofen', 'Emzor Pharmaceuticals', '100mg/5ml', 'tablet', 'Analgesics', 'Bottles of 100ml', true, 'A4-10189', '61500000189') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Ibufen', 'Fidson Healthcare', '100mg/5ml', 'tablet', 'Analgesics', 'Tubes of 20g', true, 'A4-10190', '61500000190') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Advill', 'Pfizer', '100mg/5ml', 'tablet', 'Analgesics', 'Pack of 1', true, 'A4-10191', '61500000191') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Emzor Ibuprofen', 'Emzor Pharmaceuticals', '200mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10192', '61500000192') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Ibufen', 'Fidson Healthcare', '200mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10193', '61500000193') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Advill', 'Pfizer', '200mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10194', '61500000194') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Emzor Ibuprofen', 'Emzor Pharmaceuticals', '400mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10195', '61500000195') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Ibufen', 'Fidson Healthcare', '400mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10196', '61500000196') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Advill', 'Pfizer', '400mg', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10197', '61500000197') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Emzor Ibuprofen', 'Emzor Pharmaceuticals', '100mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10198', '61500000198') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Ibufen', 'Fidson Healthcare', '100mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10199', '61500000199') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Ibuprofen', 'Advill', 'Pfizer', '100mg/5ml', 'syrup', 'Analgesics', 'Bottles of 100ml', true, 'A4-10200', '61500000200') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '50mg', 'tablet', 'Analgesics', '30s', true, 'A4-10201', '61500000201') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '50mg', 'tablet', 'Analgesics', '100s', true, 'A4-10202', '61500000202') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '50mg', 'tablet', 'Analgesics', '10x10', true, 'A4-10203', '61500000203') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '100mg', 'tablet', 'Analgesics', 'Bottles of 60ml', true, 'A4-10204', '61500000204') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '100mg', 'tablet', 'Analgesics', 'Bottles of 100ml', true, 'A4-10205', '61500000205') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '100mg', 'tablet', 'Analgesics', 'Tubes of 20g', true, 'A4-10206', '61500000206') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '1%', 'tablet', 'Analgesics', 'Pack of 1', true, 'A4-10207', '61500000207') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '1%', 'tablet', 'Analgesics', '10s', true, 'A4-10208', '61500000208') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '1%', 'tablet', 'Analgesics', '30s', true, 'A4-10209', '61500000209') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '75mg/3ml', 'tablet', 'Analgesics', '100s', true, 'A4-10210', '61500000210') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '75mg/3ml', 'tablet', 'Analgesics', '10x10', true, 'A4-10211', '61500000211') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '75mg/3ml', 'tablet', 'Analgesics', 'Bottles of 60ml', true, 'A4-10212', '61500000212') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '50mg', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10213', '61500000213') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '50mg', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10214', '61500000214') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '50mg', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10215', '61500000215') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '100mg', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10216', '61500000216') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '100mg', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10217', '61500000217') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '100mg', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10218', '61500000218') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '1%', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10219', '61500000219') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '1%', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10220', '61500000220') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '1%', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10221', '61500000221') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '75mg/3ml', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10222', '61500000222') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '75mg/3ml', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10223', '61500000223') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '75mg/3ml', 'cream', 'Analgesics', 'Tubes of 20g', true, 'A4-10224', '61500000224') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '50mg', 'injection', 'Analgesics', '30s', true, 'A4-10225', '61500000225') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '50mg', 'injection', 'Analgesics', '100s', true, 'A4-10226', '61500000226') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '50mg', 'injection', 'Analgesics', '10x10', true, 'A4-10227', '61500000227') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '100mg', 'injection', 'Analgesics', 'Bottles of 60ml', true, 'A4-10228', '61500000228') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '100mg', 'injection', 'Analgesics', 'Bottles of 100ml', true, 'A4-10229', '61500000229') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '100mg', 'injection', 'Analgesics', 'Tubes of 20g', true, 'A4-10230', '61500000230') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '1%', 'injection', 'Analgesics', 'Pack of 1', true, 'A4-10231', '61500000231') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '1%', 'injection', 'Analgesics', '10s', true, 'A4-10232', '61500000232') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '1%', 'injection', 'Analgesics', '30s', true, 'A4-10233', '61500000233') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Cataflam', 'Novartis', '75mg/3ml', 'injection', 'Analgesics', '100s', true, 'A4-10234', '61500000234') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Voltaren', 'GlaxoSmithKline', '75mg/3ml', 'injection', 'Analgesics', '10x10', true, 'A4-10235', '61500000235') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Diclofenac Sodium', 'Fenac', 'Shalina Healthcare', '75mg/3ml', 'injection', 'Analgesics', 'Bottles of 60ml', true, 'A4-10236', '61500000236') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Lisinopril', 'Zestril', 'AstraZeneca', '5mg', 'tablet', 'Antihypertensives', 'Bottles of 100ml', true, 'A4-10237', '61500000237') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Lisinopril', 'Lisodur', 'Cadila', '5mg', 'tablet', 'Antihypertensives', 'Tubes of 20g', true, 'A4-10238', '61500000238') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Lisinopril', 'Lisinopril Emzor', 'Emzor Pharmaceuticals', '5mg', 'tablet', 'Antihypertensives', 'Pack of 1', true, 'A4-10239', '61500000239') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Lisinopril', 'Zestril', 'AstraZeneca', '10mg', 'tablet', 'Antihypertensives', '10s', true, 'A4-10240', '61500000240') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Lisinopril', 'Lisodur', 'Cadila', '10mg', 'tablet', 'Antihypertensives', '30s', true, 'A4-10241', '61500000241') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Lisinopril', 'Lisinopril Emzor', 'Emzor Pharmaceuticals', '10mg', 'tablet', 'Antihypertensives', '100s', true, 'A4-10242', '61500000242') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Lisinopril', 'Zestril', 'AstraZeneca', '20mg', 'tablet', 'Antihypertensives', '10x10', true, 'A4-10243', '61500000243') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Lisinopril', 'Lisodur', 'Cadila', '20mg', 'tablet', 'Antihypertensives', 'Bottles of 60ml', true, 'A4-10244', '61500000244') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Lisinopril', 'Lisinopril Emzor', 'Emzor Pharmaceuticals', '20mg', 'tablet', 'Antihypertensives', 'Bottles of 100ml', true, 'A4-10245', '61500000245') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amlodipine', 'Amlovar', 'Neimeth', '5mg', 'tablet', 'Antihypertensives', 'Tubes of 20g', true, 'A4-10246', '61500000246') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amlodipine', 'Norvasc', 'Pfizer', '5mg', 'tablet', 'Antihypertensives', 'Pack of 1', true, 'A4-10247', '61500000247') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amlodipine', 'Amlodipine Fidson', 'Fidson Healthcare', '5mg', 'tablet', 'Antihypertensives', '10s', true, 'A4-10248', '61500000248') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amlodipine', 'Amlovar', 'Neimeth', '10mg', 'tablet', 'Antihypertensives', '30s', true, 'A4-10249', '61500000249') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amlodipine', 'Norvasc', 'Pfizer', '10mg', 'tablet', 'Antihypertensives', '100s', true, 'A4-10250', '61500000250') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Amlodipine', 'Amlodipine Fidson', 'Fidson Healthcare', '10mg', 'tablet', 'Antihypertensives', '10x10', true, 'A4-10251', '61500000251') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metformin', 'Glucophage', 'Merck', '500mg', 'tablet', 'Diabetes', 'Bottles of 60ml', true, 'A4-10252', '61500000252') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metformin', 'Melbin', 'Juhel', '500mg', 'tablet', 'Diabetes', 'Bottles of 100ml', true, 'A4-10253', '61500000253') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metformin', 'Metformin Juhel', 'Swiss Pharma', '500mg', 'tablet', 'Diabetes', 'Tubes of 20g', true, 'A4-10254', '61500000254') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metformin', 'Glucophage', 'Merck', '850mg', 'tablet', 'Diabetes', 'Pack of 1', true, 'A4-10255', '61500000255') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metformin', 'Melbin', 'Juhel', '850mg', 'tablet', 'Diabetes', '10s', true, 'A4-10256', '61500000256') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metformin', 'Metformin Juhel', 'Swiss Pharma', '850mg', 'tablet', 'Diabetes', '30s', true, 'A4-10257', '61500000257') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metformin', 'Glucophage', 'Merck', '1000mg', 'tablet', 'Diabetes', '100s', true, 'A4-10258', '61500000258') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metformin', 'Melbin', 'Juhel', '1000mg', 'tablet', 'Diabetes', '10x10', true, 'A4-10259', '61500000259') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Metformin', 'Metformin Juhel', 'Swiss Pharma', '1000mg', 'tablet', 'Diabetes', 'Bottles of 60ml', true, 'A4-10260', '61500000260') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Glibenclamide', 'Daonil', 'Emzor Pharmaceuticals', '2.5mg', 'tablet', 'Diabetes', 'Bottles of 100ml', true, 'A4-10261', '61500000261') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Glibenclamide', 'Glibenclamide Emzor', 'Sanofi', '2.5mg', 'tablet', 'Diabetes', 'Tubes of 20g', true, 'A4-10262', '61500000262') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Glibenclamide', 'Daonil', 'Emzor Pharmaceuticals', '5mg', 'tablet', 'Diabetes', 'Pack of 1', true, 'A4-10263', '61500000263') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Glibenclamide', 'Glibenclamide Emzor', 'Sanofi', '5mg', 'tablet', 'Diabetes', '10s', true, 'A4-10264', '61500000264') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Astymin', 'Chemiron International', 'Standard', 'tablet', 'Vitamins', '30s', true, 'A4-10265', '61500000265') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Chemiron', 'Fidson Healthcare', 'Standard', 'tablet', 'Vitamins', '100s', true, 'A4-10266', '61500000266') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Astyfer', 'Vitabiotics', 'Standard', 'tablet', 'Vitamins', '10x10', true, 'A4-10267', '61500000267') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'B-Complex', 'Tillomed', 'Standard', 'tablet', 'Vitamins', 'Bottles of 60ml', true, 'A4-10268', '61500000268') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Vitabiotics', 'Chemiron International', 'Standard', 'tablet', 'Vitamins', 'Bottles of 100ml', true, 'A4-10269', '61500000269') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Astymin', 'Fidson Healthcare', 'High Potency', 'tablet', 'Vitamins', 'Tubes of 20g', true, 'A4-10270', '61500000270') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Chemiron', 'Vitabiotics', 'High Potency', 'tablet', 'Vitamins', 'Pack of 1', true, 'A4-10271', '61500000271') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Astyfer', 'Tillomed', 'High Potency', 'tablet', 'Vitamins', '10s', true, 'A4-10272', '61500000272') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'B-Complex', 'Chemiron International', 'High Potency', 'tablet', 'Vitamins', '30s', true, 'A4-10273', '61500000273') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Vitabiotics', 'Fidson Healthcare', 'High Potency', 'tablet', 'Vitamins', '100s', true, 'A4-10274', '61500000274') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Astymin', 'Vitabiotics', 'Standard', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10275', '61500000275') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Chemiron', 'Tillomed', 'Standard', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10276', '61500000276') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Astyfer', 'Chemiron International', 'Standard', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10277', '61500000277') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'B-Complex', 'Fidson Healthcare', 'Standard', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10278', '61500000278') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Vitabiotics', 'Vitabiotics', 'Standard', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10279', '61500000279') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Astymin', 'Tillomed', 'High Potency', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10280', '61500000280') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Chemiron', 'Chemiron International', 'High Potency', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10281', '61500000281') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Astyfer', 'Fidson Healthcare', 'High Potency', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10282', '61500000282') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'B-Complex', 'Vitabiotics', 'High Potency', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10283', '61500000283') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Multivitamins', 'Vitabiotics', 'Tillomed', 'High Potency', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10284', '61500000284') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Emzor Vit C', 'Emzor Pharmaceuticals', '100mg', 'tablet', 'Vitamins', 'Bottles of 100ml', true, 'A4-10285', '61500000285') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Redoxon', 'Bayer', '100mg', 'tablet', 'Vitamins', 'Tubes of 20g', true, 'A4-10286', '61500000286') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Juhel Vit C', 'Juhel', '100mg', 'tablet', 'Vitamins', 'Pack of 1', true, 'A4-10287', '61500000287') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Emzor Vit C', 'Emzor Pharmaceuticals', '500mg', 'tablet', 'Vitamins', '10s', true, 'A4-10288', '61500000288') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Redoxon', 'Bayer', '500mg', 'tablet', 'Vitamins', '30s', true, 'A4-10289', '61500000289') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Juhel Vit C', 'Juhel', '500mg', 'tablet', 'Vitamins', '100s', true, 'A4-10290', '61500000290') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Emzor Vit C', 'Emzor Pharmaceuticals', '1000mg', 'tablet', 'Vitamins', '10x10', true, 'A4-10291', '61500000291') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Redoxon', 'Bayer', '1000mg', 'tablet', 'Vitamins', 'Bottles of 60ml', true, 'A4-10292', '61500000292') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Juhel Vit C', 'Juhel', '1000mg', 'tablet', 'Vitamins', 'Bottles of 100ml', true, 'A4-10293', '61500000293') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Emzor Vit C', 'Emzor Pharmaceuticals', '100mg', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10294', '61500000294') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Redoxon', 'Bayer', '100mg', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10295', '61500000295') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Juhel Vit C', 'Juhel', '100mg', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10296', '61500000296') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Emzor Vit C', 'Emzor Pharmaceuticals', '500mg', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10297', '61500000297') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Redoxon', 'Bayer', '500mg', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10298', '61500000298') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Juhel Vit C', 'Juhel', '500mg', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10299', '61500000299') ON CONFLICT DO NOTHING;
INSERT INTO public.products (generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, nafdac_number, barcode) VALUES ('Vitamin C', 'Emzor Vit C', 'Emzor Pharmaceuticals', '1000mg', 'syrup', 'Vitamins', 'Bottles of 100ml', true, 'A4-10300', '61500000300') ON CONFLICT DO NOTHING;

-- Create pharmacy_inventory table
CREATE TABLE IF NOT EXISTS public.pharmacy_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    price NUMERIC NOT NULL,
    quantity_in_stock INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 10,
    is_listed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pharmacy_inventory_unique UNIQUE (pharmacy_id, product_id)
);

-- Create batches table
CREATE TABLE IF NOT EXISTS public.batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID NOT NULL REFERENCES public.pharmacy_inventory(id) ON DELETE CASCADE,
    batch_number TEXT NOT NULL,
    expiry_date DATE NOT NULL,
    quantity_received INTEGER NOT NULL,
    cost_price NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create type enum for stock movements
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_movement_type') THEN
        CREATE TYPE stock_movement_type AS ENUM ('opening','sale','restock','adjustment','return','expiry_writeoff','transfer');
    END IF;
END$$;

-- Create stock_movements table
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID NOT NULL REFERENCES public.pharmacy_inventory(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
    type stock_movement_type NOT NULL,
    quantity INTEGER NOT NULL,
    reason TEXT,
    reference TEXT,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create trigger function to sync quantity_in_stock
CREATE OR REPLACE FUNCTION public.sync_inventory_stock()
RETURNS TRIGGER AS $$
DECLARE
    target_inventory_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_inventory_id := OLD.inventory_id;
    ELSE
        target_inventory_id := NEW.inventory_id;
    END IF;

    UPDATE public.pharmacy_inventory
    SET quantity_in_stock = COALESCE((
        SELECT SUM(quantity)
        FROM public.stock_movements
        WHERE inventory_id = target_inventory_id
    ), 0),
    updated_at = NOW()
    WHERE id = target_inventory_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_inventory_stock
AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.sync_inventory_stock();

-- Migration of existing drugs table data
DO $$
DECLARE
    drug_rec RECORD;
    matching_product_id UUID;
    new_inventory_id UUID;
    new_batch_id UUID;
BEGIN
    -- Only run migration if the old drugs table exists and is a table (not a view yet)
    IF EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name = 'drugs' 
          AND table_type = 'BASE TABLE'
    ) THEN
        FOR drug_rec IN SELECT * FROM public.drugs LOOP
            -- Try to find best-effort match in products
            SELECT id INTO matching_product_id
            FROM public.products
            WHERE lower(generic_name) = lower(coalesce(drug_rec.generic_name, drug_rec.name))
              AND lower(strength) = lower(coalesce(drug_rec.strength, ''))
              AND lower(dosage_form) = lower(coalesce(drug_rec.dosage_form, ''))
            LIMIT 1;

            -- If no match, insert a new unverified product
            IF matching_product_id IS NULL THEN
                INSERT INTO public.products (
                    generic_name,
                    brand_name,
                    manufacturer,
                    strength,
                    dosage_form,
                    category,
                    pack_size,
                    requires_prescription,
                    description,
                    image_url,
                    is_verified
                ) VALUES (
                    coalesce(drug_rec.generic_name, drug_rec.name),
                    drug_rec.brand_name,
                    drug_rec.manufacturer,
                    coalesce(drug_rec.strength, 'N/A'),
                    coalesce(drug_rec.dosage_form, 'tablet'),
                    coalesce(drug_rec.category, 'Others'),
                    'Pack of 1',
                    coalesce(drug_rec.requires_prescription, false),
                    drug_rec.description,
                    drug_rec.image_url,
                    false
                ) RETURNING id INTO matching_product_id;
            END IF;

            -- Create pharmacy_inventory row (handling ON CONFLICT if pharmacy/product combo already exists)
            INSERT INTO public.pharmacy_inventory (
                pharmacy_id,
                product_id,
                price,
                low_stock_threshold,
                is_listed,
                created_at,
                updated_at
            ) VALUES (
                drug_rec.pharmacy_id,
                matching_product_id,
                drug_rec.price,
                coalesce(drug_rec.low_stock_threshold, 10),
                true,
                drug_rec.created_at,
                drug_rec.updated_at
            )
            ON CONFLICT (pharmacy_id, product_id) DO UPDATE 
            SET price = EXCLUDED.price
            RETURNING id INTO new_inventory_id;

            -- Insert opening stock movement
            INSERT INTO public.stock_movements (
                inventory_id,
                type,
                quantity,
                reason,
                reference,
                created_at
            ) VALUES (
                new_inventory_id,
                'opening',
                coalesce(drug_rec.quantity_in_stock, 0),
                'Initial migration opening stock',
                'MIGRATION',
                drug_rec.created_at
            );

            -- Create a batch if expiry_date is provided
            IF drug_rec.expiry_date IS NOT NULL THEN
                INSERT INTO public.batches (
                    inventory_id,
                    batch_number,
                    expiry_date,
                    quantity_received,
                    created_at
                ) VALUES (
                    new_inventory_id,
                    'MIGRATED_BATCH',
                    drug_rec.expiry_date::date,
                    coalesce(drug_rec.quantity_in_stock, 0),
                    drug_rec.created_at
                ) RETURNING id INTO new_batch_id;

                -- Update the opening stock movement to reference this batch
                UPDATE public.stock_movements
                SET batch_id = new_batch_id
                WHERE inventory_id = new_inventory_id AND type = 'opening';
            END IF;
        END LOOP;
        
        -- Rename drugs to drugs_old
        ALTER TABLE public.drugs RENAME TO drugs_old;
    END IF;
END$$;

-- Create public.drugs view for backward compatibility
CREATE OR REPLACE VIEW public.drugs AS
SELECT 
    pi.id AS id,
    pi.pharmacy_id AS pharmacy_id,
    coalesce(p.brand_name, p.generic_name) AS name,
    p.generic_name AS generic_name,
    p.brand_name AS brand_name,
    p.category AS category,
    p.dosage_form AS dosage_form,
    p.strength AS strength,
    p.description AS description,
    pi.price AS price,
    pi.quantity_in_stock AS quantity_in_stock,
    pi.low_stock_threshold AS low_stock_threshold,
    p.requires_prescription AS requires_prescription,
    p.manufacturer AS manufacturer,
    (
        SELECT expiry_date 
        FROM public.batches b 
        WHERE b.inventory_id = pi.id 
        ORDER BY expiry_date ASC 
        LIMIT 1
    ) AS expiry_date,
    pi.created_at AS created_at,
    pi.updated_at AS updated_at,
    p.image_url AS image_url
FROM public.pharmacy_inventory pi
JOIN public.products p ON pi.product_id = p.id;

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- Products RLS
CREATE POLICY "Allow anyone to view products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Allow authenticated users to insert products" ON public.products FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Allow authenticated users to update products" ON public.products FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Pharmacy Inventory RLS
CREATE POLICY "Allow anyone to view listed pharmacy inventory" ON public.pharmacy_inventory FOR SELECT 
USING (
    is_listed = TRUE OR 
    pharmacy_id IN (SELECT id FROM public.pharmacies WHERE user_id = auth.uid())
);
CREATE POLICY "Allow pharmacies to insert own inventory" ON public.pharmacy_inventory FOR INSERT 
WITH CHECK (pharmacy_id IN (SELECT id FROM public.pharmacies WHERE user_id = auth.uid()));
CREATE POLICY "Allow pharmacies to update own inventory" ON public.pharmacy_inventory FOR UPDATE 
USING (pharmacy_id IN (SELECT id FROM public.pharmacies WHERE user_id = auth.uid()));
CREATE POLICY "Allow pharmacies to delete own inventory" ON public.pharmacy_inventory FOR DELETE 
USING (pharmacy_id IN (SELECT id FROM public.pharmacies WHERE user_id = auth.uid()));

-- Batches RLS
CREATE POLICY "Allow active pharmacies' batches to be viewed" ON public.batches FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.pharmacy_inventory pi 
        JOIN public.pharmacies p ON pi.pharmacy_id = p.id 
        WHERE pi.id = inventory_id AND (p.is_active = TRUE OR p.user_id = auth.uid())
    )
);
CREATE POLICY "Allow pharmacies to manage own batches" ON public.batches FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.pharmacy_inventory pi 
        JOIN public.pharmacies p ON pi.pharmacy_id = p.id 
        WHERE pi.id = inventory_id AND p.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.pharmacy_inventory pi 
        JOIN public.pharmacies p ON pi.pharmacy_id = p.id 
        WHERE pi.id = inventory_id AND p.user_id = auth.uid()
    )
);

-- Stock Movements RLS
CREATE POLICY "Allow pharmacies to view own stock movements" ON public.stock_movements FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.pharmacy_inventory pi 
        JOIN public.pharmacies p ON pi.pharmacy_id = p.id 
        WHERE pi.id = inventory_id AND p.user_id = auth.uid()
    )
);
CREATE POLICY "Allow pharmacies to insert own stock movements" ON public.stock_movements FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.pharmacy_inventory pi 
        JOIN public.pharmacies p ON pi.pharmacy_id = p.id 
        WHERE pi.id = inventory_id AND p.user_id = auth.uid()
    )
);

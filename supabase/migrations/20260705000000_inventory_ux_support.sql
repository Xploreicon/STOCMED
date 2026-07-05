-- Support for the inventory Adjust Stock and Edit Drug UI:
-- a distinct "write off" movement type (separate from expiry write-offs)
-- and a free-text notes field on pharmacy_inventory rows.

ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'write_off';

ALTER TABLE public.pharmacy_inventory
  ADD COLUMN IF NOT EXISTS notes TEXT;

import Dexie, { Table } from 'dexie';

export interface LocalBatch {
  id: string;
  batch_number: string;
  expiry_date: string;
  quantity_received: number;
  remaining_qty: number;
  is_expired: boolean;
  is_expiring_soon: boolean;
}

export interface LocalInventoryItem {
  id: string; // inventory_id
  product_id: string | null;
  item_type: 'medicine' | 'store';
  tracks_expiry: boolean;
  generic_name: string;
  brand_name: string | null;
  strength: string;
  dosage_form: string | null;
  pack_size: string | null;
  price: number;
  quantity_in_stock: number;
  barcode: string | null;
  batches: LocalBatch[];
  selling_units: Array<{
    id: string;
    unit_name: string;
    units_per: number;
    price: number;
    barcode: string | null;
    is_default: boolean;
    sort_order: number;
  }>;
  base_unit_name: string;
  whole_pack_only: boolean;
}

export interface LocalSaleItem {
  inventory_id: string;
  batch_id: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  // Metadata for display/receipt printing
  generic_name: string;
  brand_name: string | null;
  strength: string;
  batch_number: string | null;
  expiry_date: string | null;
  selling_unit_id?: string | null;
  selling_unit_name?: string;
  selling_units_per?: number;
}

export interface LocalSale {
  id: string; // client-generated UUID
  pharmacy_id: string;
  cashier_id: string;
  shift_id: string;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: 'cash' | 'bank_transfer' | 'pharmacy_pos_terminal' | 'other';
  amount_tendered: number | null;
  change_due: number | null;
  status: 'pending' | 'completed' | 'cancelled';
  created_at: string;
  reservation_id?: string;
  sp_authorization_token?: string;
  items: LocalSaleItem[];
  // Sync metadata
  sync_status: 'pending' | 'synced' | 'error';
  sync_error?: string;
  retry_count: number;
  next_retry_at?: string;
}

export interface LocalShift {
  id: string;
  pharmacy_id: string;
  cashier_id: string;
  opened_at: string;
  opening_float: number;
  closed_at?: string;
  counted_cash?: number;
  expected_cash?: number;
  variance?: number;
  notes?: string;
  status: 'open' | 'closed';
  sync_status: 'pending' | 'synced';
  sync_error?: string;
  retry_count: number;
  next_retry_at?: string;
}

export interface HeldSale {
  id: string; // client-generated UUID
  label: string; // e.g. "Customer 1" or auto-generated
  cart: Array<LocalSaleItem & { id: string }>;
  discount: number;
  held_at: string;
}

class PosLocalDatabase extends Dexie {
  local_sales!: Table<LocalSale>;
  local_inventory_cache!: Table<LocalInventoryItem>;
  held_sales!: Table<HeldSale>;
  local_shifts!: Table<LocalShift>;

  constructor() {
    super('PosLocalDatabase');
    this.version(2).stores({
      local_sales: 'id, pharmacy_id, sync_status, created_at, next_retry_at',
      local_inventory_cache: 'id, product_id, generic_name, brand_name, barcode',
      held_sales: 'id, held_at'
    });
    this.version(3).stores({
      local_sales: 'id, pharmacy_id, shift_id, sync_status, created_at, next_retry_at',
      local_inventory_cache: 'id, product_id, generic_name, brand_name, barcode',
      held_sales: 'id, held_at',
      local_shifts: 'id, pharmacy_id, cashier_id, status, sync_status, opened_at, next_retry_at'
    });
  }
}

export const posLocalDb = typeof window !== 'undefined' ? new PosLocalDatabase() : null;

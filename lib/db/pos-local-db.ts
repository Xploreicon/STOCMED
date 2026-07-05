import Dexie, { Table } from 'dexie';

export interface LocalInventoryItem {
  id: string; // inventory_id
  product_id: string;
  generic_name: string;
  brand_name: string | null;
  strength: string;
  dosage_form: string | null;
  pack_size: string | null;
  price: number;
  quantity_in_stock: number;
  barcode: string | null;
  batches: Array<{
    id: string;
    batch_number: string;
    expiry_date: string;
    quantity_received: number;
  }>;
}

export interface LocalSaleItem {
  inventory_id: string;
  batch_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  // Metadata for display/receipt printing
  generic_name: string;
  brand_name: string | null;
  strength: string;
  batch_number: string;
}

export interface LocalSale {
  id: string; // client-generated UUID
  pharmacy_id: string;
  cashier_id: string;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: 'cash' | 'bank_transfer' | 'pharmacy_pos_terminal' | 'other';
  status: 'pending' | 'completed' | 'cancelled';
  created_at: string;
  items: LocalSaleItem[];
  // Sync metadata
  sync_status: 'pending' | 'synced' | 'error';
  sync_error?: string;
}

class PosLocalDatabase extends Dexie {
  local_sales!: Table<LocalSale>;
  local_inventory_cache!: Table<LocalInventoryItem>;

  constructor() {
    super('PosLocalDatabase');
    this.version(1).stores({
      local_sales: 'id, pharmacy_id, sync_status, created_at',
      local_inventory_cache: 'id, product_id, generic_name, brand_name, barcode'
    });
  }
}

export const posLocalDb = typeof window !== 'undefined' ? new PosLocalDatabase() : null;

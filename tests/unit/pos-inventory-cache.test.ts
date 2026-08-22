import { describe, expect, it } from 'vitest'
import { applyPendingSaleDeductions } from '@/lib/pos/inventory-cache'
import type { LocalInventoryItem, LocalSale } from '@/lib/db/pos-local-db'

const inventory: LocalInventoryItem = {
  id: 'inventory-1', product_id: 'product-1', item_type: 'medicine',
  tracks_expiry: true, generic_name: 'Test medicine', brand_name: null,
  strength: '10 mg', dosage_form: 'tablet', pack_size: '10', price: 100,
  quantity_in_stock: 40, barcode: null, selling_units: [],
  base_unit_name: 'unit', whole_pack_only: false,
  batches: [{
    id: 'batch-1', batch_number: 'B1', expiry_date: '2030-01-01',
    quantity_received: 40, remaining_qty: 40, is_expired: false,
    is_expiring_soon: false,
  }],
}

function sale(id: string, options: { status?: LocalSale['sync_status']; deducts?: boolean } = {}): LocalSale {
  return {
    id, pharmacy_id: 'pharmacy-1', cashier_id: 'cashier-1', shift_id: 'shift-1',
    subtotal: 100, discount: 0, total: 100, payment_method: 'cash',
    amount_tendered: 100, change_due: 0, status: 'completed',
    created_at: '2026-08-22T00:00:00.000Z', sync_status: options.status ?? 'pending',
    retry_count: 0,
    items: [{
      inventory_id: inventory.id, batch_id: 'batch-1', quantity: 1,
      unit_price: 100, line_total: 100, generic_name: 'Test medicine',
      brand_name: null, strength: '10 mg', batch_number: 'B1',
      expiry_date: '2030-01-01', deducts_local_stock: options.deducts,
    }],
  }
}

describe('offline POS inventory cache reconciliation', () => {
  it('preserves every pending and retrying local stock deduction', () => {
    const result = applyPendingSaleDeductions(
      [inventory],
      [sale('1'), sale('2'), sale('3', { status: 'error' }), sale('4', { status: 'synced' })],
    )
    expect(result[0].quantity_in_stock).toBe(37)
    expect(result[0].batches[0].remaining_qty).toBe(37)
  })

  it('does not double-deduct a reservation collection', () => {
    const result = applyPendingSaleDeductions([inventory], [sale('reserved', { deducts: false })])
    expect(result[0].quantity_in_stock).toBe(40)
    expect(result[0].batches[0].remaining_qty).toBe(40)
  })
})

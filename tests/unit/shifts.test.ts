import { describe, expect, it } from 'vitest'
import { calculateShiftSales, reconcileCash } from '@/lib/pos/shifts'
import type { LocalSale } from '@/lib/db/pos-local-db'

const sale = (id: string, method: LocalSale['payment_method'], total: number): LocalSale => ({
  id, pharmacy_id: crypto.randomUUID(), cashier_id: crypto.randomUUID(), shift_id: '00000000-0000-4000-8000-000000000001',
  subtotal: total, discount: 0, total, payment_method: method, amount_tendered: null, change_due: null,
  status: 'completed', created_at: new Date().toISOString(), sync_status: 'pending', retry_count: 0,
  items: [{ inventory_id: crypto.randomUUID(), batch_id: crypto.randomUUID(), quantity: 1, unit_price: total,
    line_total: total, generic_name: 'Test', brand_name: null, strength: '1 mg', batch_number: 'T1', expiry_date: '2030-01-01' }],
})

describe('shift reconciliation', () => {
  it('counts cash in the drawer and excludes transfer and terminal sales', () => {
    const totals = calculateShiftSales([sale('1', 'cash', 1000), sale('2', 'bank_transfer', 2000), sale('3', 'pharmacy_pos_terminal', 3000)], '00000000-0000-4000-8000-000000000001')
    expect(totals.cashSales).toBe(1000)
    expect(totals.totalSales).toBe(6000)
    expect(reconcileCash(500, totals.cashSales, 1400)).toEqual({ expectedCash: 1500, variance: -100 })
  })

  it('counts equal-value sales independently', () => {
    expect(calculateShiftSales([sale('1', 'cash', 1000), sale('2', 'cash', 1000)], '00000000-0000-4000-8000-000000000001').cashSales).toBe(2000)
  })
})

import { describe, expect, it } from 'vitest'
import { allocateFEFO, allocateInventory } from '@/lib/pos/fefo'

describe('FEFO allocation', () => {
  it('splits stock from earliest expiry first', () => {
    const result = allocateFEFO([
      { id: 'later', batch_number: 'B2', expiry_date: '2031-01-01', quantity_received: 10, remaining_qty: 10, is_expired: false, is_expiring_soon: false },
      { id: 'first', batch_number: 'B1', expiry_date: '2030-01-01', quantity_received: 2, remaining_qty: 2, is_expired: false, is_expiring_soon: false },
    ], 4)
    expect(result).toEqual({ success: true, allocations: [
      { batch_id: 'first', batch_number: 'B1', expiry_date: '2030-01-01', quantity: 2 },
      { batch_id: 'later', batch_number: 'B2', expiry_date: '2031-01-01', quantity: 2 },
    ] })
  })

  it('uses only the earliest batch when it can satisfy the exact quantity', () => {
    const result = allocateFEFO([
      { id: 'later', batch_number: 'B2', expiry_date: '2031-01-01', quantity_received: 10, remaining_qty: 10, is_expired: false, is_expiring_soon: false },
      { id: 'first', batch_number: 'B1', expiry_date: '2030-01-01', quantity_received: 5, remaining_qty: 5, is_expired: false, is_expiring_soon: false },
    ], 5)
    expect(result).toEqual({ success: true, allocations: [
      { batch_id: 'first', batch_number: 'B1', expiry_date: '2030-01-01', quantity: 5 },
    ] })
  })

  it('blocks expired stock', () => {
    const result = allocateFEFO([{ id: 'expired', batch_number: 'OLD', expiry_date: '2020-01-01', quantity_received: 2, remaining_qty: 2, is_expired: true, is_expiring_soon: false }], 1)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.errorType).toBe('EXPIRED')
  })

  it('sells a non-expiry store item without a batch', () => {
    const result = allocateInventory({
      tracks_expiry: false,
      quantity_in_stock: 12,
      batches: [],
    }, 3)
    expect(result).toEqual({
      success: true,
      allocations: [{
        batch_id: null,
        batch_number: null,
        expiry_date: null,
        quantity: 3,
      }],
    })
  })

  it('uses FEFO for an expiry-tracked store item', () => {
    const result = allocateInventory({
      tracks_expiry: true,
      quantity_in_stock: 6,
      batches: [
        { id: 'formula-later', batch_number: 'F2', expiry_date: '2031-01-01', quantity_received: 4, remaining_qty: 4, is_expired: false, is_expiring_soon: false },
        { id: 'formula-first', batch_number: 'F1', expiry_date: '2030-01-01', quantity_received: 2, remaining_qty: 2, is_expired: false, is_expiring_soon: false },
      ],
    }, 3)
    expect(result.success).toBe(true)
    if (result.success) expect(result.allocations.map((entry) => entry.batch_id)).toEqual(['formula-first', 'formula-later'])
  })
})

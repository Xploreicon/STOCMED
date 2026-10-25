import { describe, expect, it } from 'vitest'
import { canRestoreInventory, inventoryRecoveryDeadline } from '@/lib/inventory-recovery'
import { inventoryBulkSchema } from '@/lib/validation/inventory-bulk'

describe('inventory recovery window', () => {
  const item = { deleted_at: '2026-10-25T12:00:00Z', recovery_expires_at: '2026-12-24T12:00:00Z' }
  it('ends exactly at the recovery deadline', () => {
    expect(canRestoreInventory(item, Date.parse('2026-12-24T11:59:59.999Z'))).toBe(true)
    expect(canRestoreInventory(item, Date.parse(item.recovery_expires_at))).toBe(false)
    expect(canRestoreInventory({ deleted_at: null }, Date.now())).toBe(false)
  })
  it('honours an explicit legacy recovery window and handles invalid dates', () => {
    expect(inventoryRecoveryDeadline({ ...item, deleted_at: '2026-01-01T00:00:00Z' })).toBe(item.recovery_expires_at)
    expect(inventoryRecoveryDeadline({ deleted_at: 'invalid' })).toBe(null)
  })
  it('rejects duplicate IDs, missing removal reason and oversized selections', () => {
    const id = '10000000-0000-4000-8000-000000000001'
    expect(inventoryBulkSchema.safeParse({ ids: [id,id], action: 'remove', reason: 'Duplicate' }).success).toBe(false)
    expect(inventoryBulkSchema.safeParse({ ids: [id], action: 'remove' }).success).toBe(false)
    expect(inventoryBulkSchema.safeParse({ ids: Array(501).fill(id), action: 'restore' }).success).toBe(false)
    expect(inventoryBulkSchema.safeParse({ ids: [id], action: 'restore' }).success).toBe(true)
  })
})

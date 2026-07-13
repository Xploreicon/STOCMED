import { describe, expect, it, vi } from 'vitest'
import { retryPatch } from '@/lib/pos/sync-engine'
import type { LocalShift } from '@/lib/db/pos-local-db'

describe('offline sync retry', () => {
  it('always returns a pending retry with a future retry time', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const shift: LocalShift = {
      id: crypto.randomUUID(), pharmacy_id: crypto.randomUUID(), cashier_id: crypto.randomUUID(),
      opened_at: new Date().toISOString(), opening_float: 0, status: 'open', sync_status: 'pending', retry_count: 2,
    }
    const result = retryPatch(shift, 'offline')
    expect(result.sync_status).toBe('pending')
    expect(result.retry_count).toBe(3)
    expect(new Date(result.next_retry_at).getTime()).toBeGreaterThan(Date.now())
  })
})

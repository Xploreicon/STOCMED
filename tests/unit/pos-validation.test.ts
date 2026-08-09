import { describe, expect, it } from 'vitest'

import { posSyncSchema } from '@/lib/validation/pos'

describe('POS sync validation', () => {
  it('accepts PostgreSQL offset timestamps on server-hydrated shifts', () => {
    const result = posSyncSchema.safeParse({
      shifts: [{
        id: '4d8dec17-993b-4914-8de3-9581d288a620',
        pharmacy_id: '30000000-0000-4000-8000-000000000001',
        cashier_id: '10000000-0000-4000-8000-000000000001',
        opened_at: '2026-07-14T14:47:11.113+00:00',
        opening_float: 1200,
        closed_at: '2026-08-09T18:55:19.814Z',
        counted_cash: 5000,
        expected_cash: 1200,
        variance: 3800,
        status: 'closed',
      }],
      sales: [],
    })

    expect(result.success).toBe(true)
  })

  it('still rejects malformed shift timestamps', () => {
    const result = posSyncSchema.safeParse({
      shifts: [{
        id: '4d8dec17-993b-4914-8de3-9581d288a620',
        pharmacy_id: '30000000-0000-4000-8000-000000000001',
        cashier_id: '10000000-0000-4000-8000-000000000001',
        opened_at: '2026-07-14 14:47:11',
        opening_float: 0,
        status: 'open',
      }],
      sales: [],
    })

    expect(result.success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { receiptRequest, receivingBaseQuantity } from '@/lib/procurement'

describe('delivery submission recovery', () => {
  it('reuses the delivery key after a failed request or page reload', () => {
    const payload = { supplier_id: 'supplier', lines: [{ quantity_received: 2, units_per_pack: 10, batch_number: 'A' }] }
    const first = receiptRequest(payload, null)
    const restored = JSON.parse(JSON.stringify(first))
    expect(receiptRequest(payload, restored).key).toBe(first.key)
    expect(receivingBaseQuantity(payload.lines[0])).toBe(20)
  })
  it('starts a new delivery after success and distinguishes changed batch details', () => {
    const payload = { lines: [{ batch_number: 'A', quantity_received: 2 }] }
    const first = receiptRequest(payload, null)
    expect(receiptRequest(payload, null).key).not.toBe(first.key)
    expect(receiptRequest({ lines: [{ batch_number: 'B', quantity_received: 2 }] }, first).key).not.toBe(first.key)
  })
})

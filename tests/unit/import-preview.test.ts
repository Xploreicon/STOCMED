import { describe, expect, it } from 'vitest'
import { validateRows } from '@/lib/validation/import-rows'

describe('bulk import preview validation', () => {
  it('returns every invalid row before commit', () => {
    const errors = validateRows([
      { mapped: { generic_name: '', price: -1 }, selected_product_id: '' },
      { mapped: { generic_name: 'Test', strength: '1mg', dosage_form: 'tablet', category: 'Other', price: 100, quantity: -2, batch_number: '', expiry_date: 'bad' }, selected_product_id: 'bad-id' },
    ])
    expect(errors.map((entry) => entry.row)).toEqual([1, 2])
    expect(errors[0].errors.length).toBeGreaterThan(1)
    expect(errors[1].errors.length).toBeGreaterThan(1)
  })
})

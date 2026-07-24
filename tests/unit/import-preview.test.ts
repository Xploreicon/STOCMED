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

  it('accepts a batchless store row without a catalogue selection', () => {
    expect(validateRows([{
      mapped: {
        item_type: 'store',
        tracks_expiry: false,
        generic_name: 'Bath soap',
        price: 500,
        quantity: 24,
      },
      selected_product_id: '',
    }])).toEqual([])
  })

  it('requires catalogue, batch, and expiry for medicine rows', () => {
    const errors = validateRows([{
      mapped: {
        item_type: 'medicine',
        generic_name: 'Paracetamol',
        price: 500,
        quantity: 24,
      },
      selected_product_id: '',
    }])
    expect(errors[0].errors).toEqual(expect.arrayContaining([
      'Catalogue selection is required for medicine',
      'Batch number is required',
      'Expiry date is invalid',
    ]))
  })

  it('requires batch and expiry for an expiry-tracked store row', () => {
    const errors = validateRows([{
      mapped: {
        item_type: 'store',
        tracks_expiry: true,
        generic_name: 'Baby formula',
        price: 6500,
        quantity: 12,
      },
      selected_product_id: '',
    }])
    expect(errors[0].errors).toEqual(expect.arrayContaining([
      'Batch number is required',
      'Expiry date is invalid',
    ]))
  })
})

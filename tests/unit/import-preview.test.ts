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

  it('requires catalogue identity fields but allows batch capture after import', () => {
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
    ]))
    expect(errors[0].errors).not.toEqual(expect.arrayContaining([
      expect.stringContaining('Batch number'),
      expect.stringContaining('Expiry date'),
    ]))
  })

  it('allows an expiry-tracked row to defer both batch fields', () => {
    expect(validateRows([{
      mapped: {
        item_type: 'store',
        tracks_expiry: true,
        generic_name: 'Baby formula',
        price: 6500,
        quantity: 12,
      },
      selected_product_id: '',
    }])).toEqual([])
  })

  it('rejects pharmacy-side catalogue creation', () => {
    const futureDate = new Date()
    futureDate.setFullYear(futureDate.getFullYear() + 1)
    const expiryDate = futureDate.toISOString().slice(0, 10)

    const errors = validateRows([{
      mapped: {
        item_type: 'medicine',
        generic_name: 'Chloroquine Phosphate',
        strength: '250mg',
        dosage_form: 'tablet',
        price: 500,
        quantity: 24,
        batch_number: 'B001',
        expiry_date: expiryDate,
      },
      selected_product_id: 'create_new',
    }])
    expect(errors[0].errors).toContain('New catalogue products require admin approval')
  })

  it('still requires strength and dosage_form for create_new medicine rows', () => {
    const futureDate = new Date()
    futureDate.setFullYear(futureDate.getFullYear() + 1)
    const expiryDate = futureDate.toISOString().slice(0, 10)

    const errors = validateRows([{
      mapped: {
        item_type: 'medicine',
        generic_name: 'Mystery Drug',
        price: 1000,
        quantity: 10,
        batch_number: 'B002',
        expiry_date: expiryDate,
      },
      selected_product_id: 'create_new',
    }])
    expect(errors[0].errors).toEqual(expect.arrayContaining([
      'Strength is required for medicine matching',
      'Dosage form is required for medicine matching',
    ]))
  })

  it('reports controlled dosage-form and admin-candidate failures on their row', () => {
    const futureDate = new Date()
    futureDate.setFullYear(futureDate.getFullYear() + 1)
    const errors = validateRows([{
      mapped: {
        item_type: 'medicine',
        generic_name: 'Flemming 457',
        strength: '457mg',
        dosage_form: 'Sachet',
        category: 'Unknown category',
        price: 1000,
        quantity: 10,
        batch_number: 'DEXTA-1',
        expiry_date: futureDate.toISOString().slice(0, 10),
      },
      selected_product_id: 'create_new',
    }], {
      dosageForms: ['tablet', 'capsule', 'powder for oral suspension'],
      categories: ['Antibiotics', 'Others'],
    })

    expect(errors).toEqual([{
      row: 1,
      errors: expect.arrayContaining([
        'Dosage form "Sachet" is not in the controlled list',
        'New catalogue products require admin approval',
      ]),
    }])
  })

  it('blocks only the malformed row so valid neighbours remain committable', () => {
    const rows = [
      {
        mapped: { item_type: 'store', generic_name: 'Custard', price: 2500, quantity: 4 },
        selected_product_id: '',
      },
      {
        source_row_number: 1054,
        mapped: { item_type: 'store', generic_name: 'Bad price row', price: 0, quantity: 2 },
        selected_product_id: '',
      },
      {
        mapped: { item_type: 'store', generic_name: 'Milk', price: 1800, quantity: 6 },
        selected_product_id: '',
      },
    ]

    expect(validateRows(rows)).toEqual([{ row: 2, errors: ['Price must be greater than zero'] }])
  })
})

describe('40-row fixture — 15 medicines / 25 store items', () => {
  // This fixture models the actual pharmacy CSV structure:
  // 15 rows with type=medicine (all have strength and dosage_form)
  // 25 rows with type=store (no strength, no dosage_form)

  const futureDate = new Date()
  futureDate.setFullYear(futureDate.getFullYear() + 1)
  const expiry = futureDate.toISOString().slice(0, 10)
  const validUuid = '11111111-1111-4111-8111-111111111111'

  const MEDICINES = [
    'Paracetamol', 'Amoxicillin', 'Ibuprofen', 'Ciprofloxacin', 'Metronidazole',
    'Chloroquine', 'Artemether-Lumefantrine', 'Diclofenac', 'Ceftriaxone', 'Omeprazole',
    'Metformin', 'Amlodipine', 'Lisinopril', 'Tramadol', 'Loperamide',
  ]

  const STORE_ITEMS = [
    'Baby Formula', 'Bath Soap', 'Body Cream', 'Toothpaste', 'Cotton Wool',
    'Plaster', 'Face Mask', 'Hand Sanitizer', 'Tissue Paper', 'Baby Diapers',
    'Shampoo', 'Vaseline', 'Detergent', 'Air Freshener', 'Bleach',
    'Mosquito Coil', 'Insect Spray', 'Candles', 'Batteries', 'Phone Charger',
    'Notebook', 'Pen', 'Biscuits', 'Soft Drinks', 'Bottled Water',
  ]

  function buildMedicineRow(name: string, selectedProductId: string) {
    return {
      mapped: {
        item_type: 'medicine',
        generic_name: name,
        strength: '500mg',
        dosage_form: 'tablet',
        price: 1000,
        quantity: 50,
        batch_number: 'B001',
        expiry_date: expiry,
      },
      selected_product_id: selectedProductId,
    }
  }

  function buildStoreRow(name: string) {
    return {
      mapped: {
        item_type: 'store',
        tracks_expiry: false,
        generic_name: name,
        price: 500,
        quantity: 24,
      },
      selected_product_id: '',
    }
  }

  it('keeps 34 rows committable while 6 unmatched medicines await admin catalogue approval', () => {
    const rows = [
      // 9 medicines with catalogue match
      ...MEDICINES.slice(0, 9).map((name) => buildMedicineRow(name, validUuid)),
      // 6 medicines with create_new (no catalogue match)
      ...MEDICINES.slice(9).map((name) => buildMedicineRow(name, 'create_new')),
      // 25 store items
      ...STORE_ITEMS.map(buildStoreRow),
    ]

    const errors = validateRows(rows)
    expect(errors).toHaveLength(6)
    expect(errors.map((entry) => entry.row)).toEqual([10, 11, 12, 13, 14, 15])
    errors.forEach((entry) => {
      expect(entry.errors).toContain('New catalogue products require admin approval')
    })
  })

  it('counts exactly 15 medicines and 25 store items', () => {
    const rows = [
      ...MEDICINES.slice(0, 9).map((name) => buildMedicineRow(name, validUuid)),
      ...MEDICINES.slice(9).map((name) => buildMedicineRow(name, 'create_new')),
      ...STORE_ITEMS.map(buildStoreRow),
    ]

    const medicines = rows.filter((r) => r.mapped.item_type === 'medicine')
    const stores = rows.filter((r) => r.mapped.item_type === 'store')

    expect(medicines.length).toBe(15)
    expect(stores.length).toBe(25)
    expect(rows.length).toBe(40)
  })
})

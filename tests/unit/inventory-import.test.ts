import { describe, expect, it } from 'vitest'
import {
  autoMapImportHeaders,
  determineImportRouting,
  hasMedicineSignals,
  INVENTORY_IMPORT_FIELDS,
  isSafeAutoMatch,
  normalizeImportBarcode,
  normalizeImportDosageForm,
  normalizeImportProductName,
  normalizeImportStrength,
  parseImportBoolean,
  parseImportDate,
  parseImportMoneyToKobo,
} from '@/lib/inventory-import'

describe('inventory import normalization', () => {
  it('maps type, tracks_expiry, batch, and expiry to distinct exact headers', () => {
    const headers = [
      'generic_name', 'type', 'tracks_expiry', 'dosage_form',
      'batch_number', 'expiry_date',
    ]
    const mapping = autoMapImportHeaders(headers, [
      { key: 'name', synonyms: ['name', 'generic name'] },
      { key: 'item_type', synonyms: ['type', 'department', 'item type'] },
      { key: 'tracks_expiry', synonyms: ['tracks expiry', 'expiry tracked'] },
      { key: 'dosage_form', synonyms: ['form', 'dosage form'] },
      { key: 'batch_number', synonyms: ['batch', 'batch number'] },
      { key: 'expiry_date', synonyms: ['expiry', 'expiry date'] },
    ])
    expect(mapping).toEqual({
      name: 'generic_name',
      item_type: 'type',
      tracks_expiry: 'tracks_expiry',
      dosage_form: 'dosage_form',
      batch_number: 'batch_number',
      expiry_date: 'expiry_date',
    })
  })

  it.each([true, 'TRUE', 'true', 'Yes', '1', 1])('reads %j as an enabled expiry flag', (value) => {
    expect(parseImportBoolean(value)).toBe(true)
  })

  it('parses ISO, day-first, and Excel serial dates consistently', () => {
    expect(parseImportDate('2028-12-31')).toBe('2028-12-31')
    expect(parseImportDate('31/12/2028')).toBe('2028-12-31')
    expect(parseImportDate(47118)).toBe('2028-12-31')
  })

  it('normalizes equivalent strength spacing and dosage-form plurals', () => {
    expect(normalizeImportStrength('500 mg')).toBe(normalizeImportStrength('500mg'))
    expect(normalizeImportDosageForm('Tablets')).toBe('tablet')
    expect(normalizeImportDosageForm('Capsule')).toBe('capsule')
    expect(normalizeImportDosageForm('Elixir')).not.toBe(normalizeImportDosageForm('Tablet'))
  })

  it('maps every Ceres heading, including Kobo prices and minimum quantity', () => {
    const headers = [
      'Product Name',
      'Size',
      'Barcode',
      'Cost Price (Kobo)',
      'Selling price (Kobo)',
      'Quantity',
      'Minimum Quantity',
      'Expiry date',
    ]

    expect(autoMapImportHeaders(headers, INVENTORY_IMPORT_FIELDS)).toMatchObject({
      name: 'Product Name',
      pack_size: 'Size',
      sku: 'Barcode',
      unit_cost: 'Cost Price (Kobo)',
      price: 'Selling price (Kobo)',
      quantity: 'Quantity',
      min_quantity: 'Minimum Quantity',
      expiry_date: 'Expiry date',
    })
  })

  it.each([
    ['ARENAX PLUS FORTE X6', 'arenax plus forte'],
    ['Babyrex syrup 60ml', 'babyrex syrup'],
    ['Camosunate junior 300mg/100mg Pack of 4', 'camosunate junior'],
    ['Daktarcort x 8 tablets', 'daktarcort'],
    ['DANA DANACID compound magnesium trisilicate tablets B. P', 'dana danacid compound magnesium trisilicate tablets bp'],
  ])('normalizes %j to %j for matching while dropping dose and pack tokens', (input, expected) => {
    expect(normalizeImportProductName(input)).toBe(expected)
  })

  it('keeps only 8, 12, 13, and 14 digit barcode shapes', () => {
    expect(normalizeImportBarcode(' 8906035499340 ')).toBe('8906035499340')
    expect(normalizeImportBarcode('12345678')).toBe('12345678')
    expect(normalizeImportBarcode('ABC-123')).toBeNull()
    expect(normalizeImportBarcode('123456789')).toBeNull()
  })

  it('converts money to integer Kobo without floating-point rounding', () => {
    expect(parseImportMoneyToKobo('1,375', true)).toBe(1375)
    expect(parseImportMoneyToKobo('₦1,375.25')).toBe(137525)
    expect(parseImportMoneyToKobo('0.09')).toBe(9)
    expect(parseImportMoneyToKobo('12.345')).toBeNull()
  })

  it('never auto-accepts a strength or form conflict', () => {
    expect(isSafeAutoMatch({
      confidence: 0.99,
      strength_match: false,
      form_match: true,
      mismatch_reasons: ['strength differs'],
    })).toBe(false)
    expect(isSafeAutoMatch({
      confidence: 0.99,
      strength_match: true,
      form_match: false,
      mismatch_reasons: ['form differs'],
    })).toBe(false)
    expect(isSafeAutoMatch({
      confidence: 0.92,
      strength_match: true,
      form_match: true,
      mismatch_reasons: [],
    })).toBe(true)
    expect(isSafeAutoMatch({
      match_status: 'review',
      confidence: 0.89,
      strength_match: true,
      form_match: true,
      mismatch_reasons: [],
    })).toBe(false)
  })
})

describe('hasMedicineSignals', () => {
  it('detects explicit type=medicine', () => {
    expect(hasMedicineSignals({ item_type: 'medicine' })).toBe(true)
    expect(hasMedicineSignals({ item_type: 'drug' })).toBe(true)
    expect(hasMedicineSignals({ item_type: 'rx' })).toBe(true)
  })

  it('detects strength as a medicine signal', () => {
    expect(hasMedicineSignals({ strength: '500mg' })).toBe(true)
    expect(hasMedicineSignals({ strength: '10mg/5ml' })).toBe(true)
  })

  it('detects dosage form as a medicine signal', () => {
    expect(hasMedicineSignals({ dosage_form: 'tablet' })).toBe(true)
    expect(hasMedicineSignals({ dosage_form: 'capsule' })).toBe(true)
  })

  it('returns false for rows with no medicine signals', () => {
    expect(hasMedicineSignals({})).toBe(false)
    expect(hasMedicineSignals({ item_type: 'store' })).toBe(false)
    expect(hasMedicineSignals({ item_type: 'grocery' })).toBe(false)
    expect(hasMedicineSignals({ item_type: '', strength: '', dosage_form: '' })).toBe(false)
  })
})

describe('determineImportRouting', () => {
  const safeMatch = {
    id: '11111111-1111-4111-8111-111111111111',
    confidence: 0.92,
    strength_match: true,
    form_match: true,
    mismatch_reasons: [],
  }
  const unsafeMatch = {
    id: '22222222-2222-4222-8222-222222222222',
    confidence: 0.40,
    strength_match: false,
    form_match: true,
    mismatch_reasons: ['strength differs'],
  }

  it('routes confident catalogue match to medicine with product ID', () => {
    const result = determineImportRouting({ strength: '500mg', dosage_form: 'tablet' }, safeMatch)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe(safeMatch.id)
  })

  it('holds an unmatched medicine-signalled row without creating catalogue identity', () => {
    const result = determineImportRouting({ strength: '250mg', dosage_form: 'capsule' }, null)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('')
  })

  it('routes unmatched row with only strength to medicine with create_new', () => {
    const result = determineImportRouting({ strength: '500mg' }, null)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('')
  })

  it('routes unmatched row with only dosage_form to medicine with create_new', () => {
    const result = determineImportRouting({ dosage_form: 'syrup' }, null)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('')
  })

  it('routes row with no match and no signals to store', () => {
    const result = determineImportRouting({}, null)
    expect(result.itemType).toBe('store')
    expect(result.selectedProductId).toBe('')
  })

  it('NEVER routes explicit type=medicine to store, even without a match', () => {
    const result = determineImportRouting({ item_type: 'medicine' }, null)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('')
  })

  it('routes explicit type=medicine with safe match to medicine with product ID', () => {
    const result = determineImportRouting({ item_type: 'medicine' }, safeMatch)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe(safeMatch.id)
  })

  it('holds explicit type=medicine with an unsafe match for review', () => {
    const result = determineImportRouting({ item_type: 'medicine' }, unsafeMatch)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('')
  })

  it('routes explicit type=store to store regardless of match quality', () => {
    const result = determineImportRouting({ item_type: 'store' }, safeMatch)
    expect(result.itemType).toBe('store')
    expect(result.selectedProductId).toBe('')
  })

  it('routes explicit type=grocery to store', () => {
    const result = determineImportRouting({ item_type: 'grocery' }, null)
    expect(result.itemType).toBe('store')
    expect(result.selectedProductId).toBe('')
  })

  it('holds medicine signals with an unsafe match for review', () => {
    const result = determineImportRouting(
      { strength: '500mg', dosage_form: 'tablet' },
      unsafeMatch,
    )
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import {
  autoMapImportHeaders,
  determineImportRouting,
  hasMedicineSignals,
  isSafeAutoMatch,
  normalizeImportDosageForm,
  normalizeImportStrength,
  parseImportBoolean,
  parseImportDate,
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

  it('routes unmatched row with strength/form to medicine with create_new', () => {
    const result = determineImportRouting({ strength: '250mg', dosage_form: 'capsule' }, null)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('create_new')
  })

  it('routes unmatched row with only strength to medicine with create_new', () => {
    const result = determineImportRouting({ strength: '500mg' }, null)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('create_new')
  })

  it('routes unmatched row with only dosage_form to medicine with create_new', () => {
    const result = determineImportRouting({ dosage_form: 'syrup' }, null)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('create_new')
  })

  it('routes row with no match and no signals to store', () => {
    const result = determineImportRouting({}, null)
    expect(result.itemType).toBe('store')
    expect(result.selectedProductId).toBe('')
  })

  it('NEVER routes explicit type=medicine to store, even without a match', () => {
    const result = determineImportRouting({ item_type: 'medicine' }, null)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('create_new')
  })

  it('routes explicit type=medicine with safe match to medicine with product ID', () => {
    const result = determineImportRouting({ item_type: 'medicine' }, safeMatch)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe(safeMatch.id)
  })

  it('routes explicit type=medicine with unsafe match to create_new', () => {
    const result = determineImportRouting({ item_type: 'medicine' }, unsafeMatch)
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('create_new')
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

  it('routes medicine signals with unsafe match to create_new', () => {
    const result = determineImportRouting(
      { strength: '500mg', dosage_form: 'tablet' },
      unsafeMatch,
    )
    expect(result.itemType).toBe('medicine')
    expect(result.selectedProductId).toBe('create_new')
  })
})

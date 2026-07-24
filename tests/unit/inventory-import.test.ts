import { describe, expect, it } from 'vitest'
import {
  autoMapImportHeaders,
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

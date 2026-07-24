import { describe, expect, it } from 'vitest'
import {
  buildMigration,
  categoryForAtc,
  cleanBrandName,
  normalizeProduct,
} from '../../scripts/import-nafdac-greenbook.mjs'

describe('NAFDAC Greenbook importer', () => {
  it.each([
    ['N02BE01', 'Analgesics'],
    ['J01DD04', 'Antibiotics'],
    ['P01BF01', 'Antimalarials'],
    ['C09AA01', 'Antihypertensives'],
    ['A10BA02', 'Diabetes'],
    ['R06AX13', 'Respiratory'],
    ['A02BC01', 'Gastrointestinal'],
    ['A11GA01', 'Vitamins'],
    ['L01AA01', null],
  ])('maps ATC %s to %s', (atc, expected) => {
    expect(categoryForAtc(atc)).toBe(expected)
  })

  it('cleans Greenbook display annotations from brand names', () => {
    expect(cleanBrandName('Zef One Injection## (check pack size)')).toBe('Zef One Injection')
  })

  it('maps a complete active Greenbook drug to the products schema', () => {
    const result = normalizeProduct({
      status: 'Active',
      product_category: { name: 'Drugs' },
      atc: 'J01DD04',
      ingredient: { ingredient_name: 'Ceftriaxone (Ceftriaxone Sodium)' },
      product_name: 'Zef One Injection##',
      manufacturer_id: 17,
      strength: '1 g',
      form: { name: 'Injection' },
      pack_size: '1 x 10 mL vial + 10 mL water for injection',
      NAFDAC: 'A4-8206',
      marketing_category_id: 1,
    }, new Map([[17, 'Makcur Laboratories Limited']]))

    expect(result.reason).toBeNull()
    expect(result.product).toEqual({
      generic_name: 'Ceftriaxone (Ceftriaxone Sodium)',
      brand_name: 'Zef One Injection',
      manufacturer: 'Makcur Laboratories Limited',
      strength: '1 g',
      dosage_form: 'injection',
      category: 'Antibiotics',
      pack_size: '1 x 10 mL vial + 10 mL water for injection',
      nafdac_number: 'A4-8206',
      atc_code: 'J01DD04',
      requires_prescription: true,
    })
  })

  it('emits verified inserts with normalized five-field deduplication', () => {
    const migration = buildMigration([{
      generic_name: 'Paracetamol',
      brand_name: 'Example',
      manufacturer: 'Example Pharma',
      strength: '500 mg',
      dosage_form: 'tablet',
      category: 'Analgesics',
      pack_size: "2 x 10's",
      nafdac_number: 'A4-1234',
      atc_code: 'N02BE01',
      requires_prescription: false,
    }])

    expect(migration).toContain('is_verified')
    expect(migration).toContain('TRUE')
    expect(migration).toContain("REGEXP_REPLACE(TRIM(COALESCE(existing.generic_name, ''))")
    expect(migration).toContain("REGEXP_REPLACE(TRIM(COALESCE(existing.pack_size, ''))")
    expect(migration).not.toContain('UPPER(TRIM(existing.nafdac_number))')
  })
})

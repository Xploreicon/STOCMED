import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  autoMapImportHeaders, extractImportStrength, importMedicineIdentity,
  INVENTORY_IMPORT_FIELDS, normalizeImportDosageForm, parseImportDate,
} from '@/lib/inventory-import'
import { normalizeInventoryRows, parseInventoryWorkbook } from '@/lib/inventory-import-parser'
import { mapDosageForm, mapImportCategory } from '@/lib/controlled-lookups'
import { validateRows } from '@/lib/validation/import-rows'

const headers = ['S/N', 'Product Name (with Strength)', 'Dosage Form', 'Quantity', 'Selling Price (₦)', 'Batch Number', 'Expiry Date', 'API / Composition', 'Category', 'Manufacturer']
const sourceRow = [1, 'Sample Tablets 500mg', 'Tablet', '7', 2800, '005130203', '10/28', 'Example ingredient', 'Analgesic', 'Example manufacturer']

describe('field stocktake import', () => {
  it.each(['csv', 'xlsx'] as const)('detects title/spacer rows in %s and preserves physical row numbers', (format) => {
    const rows = [[], ['', 'PHARMACY STOCKTAKE'], [], headers, sourceRow]
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Stock')
    const buffer = format === 'csv'
      ? Buffer.from('\uFEFF\n' + XLSX.utils.sheet_to_csv(sheet))
      : XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
    const parsed = parseInventoryWorkbook(buffer)
    expect(parsed.headers).toEqual(headers)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].__row_number).toBe(5)
    expect(parsed.rows[0]['Batch Number']).toBe('005130203')
    const mapping = autoMapImportHeaders(parsed.headers, INVENTORY_IMPORT_FIELDS)
    expect(mapping).toMatchObject({ name: headers[1], composition: headers[7], manufacturer: headers[9], price: headers[4] })
    expect(mapping.strength).toBeUndefined()
    expect(mapping.sku).toBeUndefined()
    expect(normalizeInventoryRows(parsed.rows, mapping)[0]).toMatchObject({ price_kobo: 280000, qty: 7, expiry: '2028-10-31', source_row_number: 5 })
  })

  it('does not map blank headers or let fuzzy matching steal exact matches', () => {
    expect(autoMapImportHeaders(['', 'Brand Name', 'Quantity', 'Minimum Quantity'], INVENTORY_IMPORT_FIELDS)).toEqual({ brand_name: 'Brand Name', quantity: 'Quantity', min_quantity: 'Minimum Quantity' })
  })

  it.each([
    ['10/28', '2028-10-31'], ['02/28', '2028-02-29'], ['02/29', '2029-02-28'],
    ['11/2026', '2026-11-30'], ['09/09', '2009-09-30'], ['13/28', ''], ['00/28', ''],
  ])('parses month-only expiry %s as %s', (value, expected) => {
    expect(parseImportDate(value)).toBe(expected)
  })

  it.each([
    ['Sample 500mg', '500mg'], ['Sample 25mg/1ml', '25mg/1ml'],
    ['Sample 4000 IU / 0.4ml', '4000 IU / 0.4ml'], ['Sample 0.5%', '0.5%'],
    ['Sample 60ml', ''], ['Sample 150', ''], ['Sample 20/120mg', ''],
    ['Sample 500mg + 200mg', ''],
  ])('extracts only unambiguous explicit strengths from %s', (value, expected) => {
    expect(extractImportStrength(value)).toBe(expected)
  })

  it('retains product name separately from composition and manufacturer', () => {
    expect(importMedicineIdentity({ name: 'Sample Tablets 500mg', composition: 'Example ingredient', manufacturer: 'Example manufacturer' })).toEqual({
      generic_name: 'Example ingredient', brand_name: 'Sample Tablets 500mg', strength: '500mg', manufacturer: 'Example manufacturer',
    })
    expect(importMedicineIdentity({ name: 'Sample', strength: '20mg' }).strength).toBe('20mg')
  })

  it('keeps every mixed or missing quantity for correction, not zero', () => {
    for (const quantity of ['', '9 sachets', '47 packs + 4 sachets', '15+1']) {
      const parsed = parseInventoryWorkbook(Buffer.from(`Name,Quantity,Price\nSample,${quantity},500`))
      const mapping = autoMapImportHeaders(parsed.headers, INVENTORY_IMPORT_FIELDS)
      const row = normalizeInventoryRows(parsed.rows, mapping)[0]
      expect(row.qty).toBeNull()
      expect(validateRows([{ mapped: { generic_name: 'Sample', item_type: 'store', quantity: row.qty, price: 500 } }])[0].errors).toContain('Quantity must be a non-negative integer')
    }
  })

  it('does not match route-specific forms to one another or to unspecified drops', () => {
    const forms = ['Eye Drops', 'Ear Drops', 'Oral Drops', 'Drops', 'Eye/Ear Drops']
    expect(new Set(forms.map(normalizeImportDosageForm)).size).toBe(forms.length)
    expect(normalizeImportDosageForm('Eye Ointment')).not.toBe(normalizeImportDosageForm('Ointment'))
    expect(normalizeImportDosageForm('Eye Gel')).not.toBe(normalizeImportDosageForm('Gel'))
    expect(normalizeImportDosageForm('Softgel')).not.toBe(normalizeImportDosageForm('Gel'))
    expect(mapDosageForm('Ear Drops', ['eye drops'])).toMatchObject({ recognized: false, value: 'Ear Drops' })
    expect(mapDosageForm('Tablet/Capsule', ['tablet', 'capsule'])).toMatchObject({ recognized: false })
    expect(mapDosageForm('Eye Drops', ['eye drops'])).toMatchObject({ recognized: true, value: 'eye drops' })
  })

  it('maps explicit category aliases but leaves combination classes for review', () => {
    expect(mapImportCategory('NSAID', ['NSAIDs'])).toMatchObject({ value: 'NSAIDs', recognized: true })
    expect(mapImportCategory('Antacid', ['Antacids & Anti-ulcer'])).toMatchObject({ value: 'Antacids & Anti-ulcer', recognized: true })
    expect(mapImportCategory('NSAID + PPI', ['NSAIDs', 'Others'])).toMatchObject({ value: 'NSAID + PPI', recognized: false })
  })

  it('changes only manufacturer forwarding in the private atomic import engine', () => {
    const original = readFileSync(join(process.cwd(), 'supabase/migrations/20260724040000_verified_import_result.sql'), 'utf8')
    const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260926010000_field_stocktake_manufacturer.sql'), 'utf8')
    const definition = (sql: string) => sql.match(/CREATE OR REPLACE FUNCTION public\.import_inventory_file\([\s\S]*?\n\$\$;/)?.[0]
    expect(definition(migration)).toBe(definition(original)!.replace(
      "v_row->'mapped'->>'brand_name',\n          NULL,",
      "v_row->'mapped'->>'brand_name',\n          v_row->'mapped'->>'manufacturer',",
    ))
    expect(migration).not.toContain('GRANT EXECUTE')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
  })
})

// Opt-in acceptance check against the user's untouched local files; no pharmacy
// source data is copied into the repository or required by normal CI.
describe.skipIf(!process.env.FIELD_STOCKTAKE_DIR)('DeLaw source-file acceptance', () => {
  it('preserves all 160 records in both versions and reports unresolved quantities', () => {
    const parsed = ['DeLawPharmacy_Inventory_Master.csv', 'DeLaw Pharmacy_Inventory_Master.xlsx'].map((file) =>
      parseInventoryWorkbook(readFileSync(join(process.env.FIELD_STOCKTAKE_DIR!, file))))
    const normalized = parsed.map((file) => normalizeInventoryRows(file.rows, autoMapImportHeaders(file.headers, INVENTORY_IMPORT_FIELDS)))
    for (const rows of normalized) {
      expect(rows).toHaveLength(160)
      expect(rows.filter((row) => row.qty === null)).toHaveLength(30)
      expect(rows.filter((row) => row.parse_error?.includes('column_shift'))).toHaveLength(0)
    }
    expect(normalized[0].map(({ source_row_number, ...row }) => row)).toEqual(normalized[1].map(({ source_row_number, ...row }) => row))
  })
})

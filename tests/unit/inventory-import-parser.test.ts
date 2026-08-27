import { describe, expect, it } from 'vitest'

import { autoMapImportHeaders, INVENTORY_IMPORT_FIELDS } from '@/lib/inventory-import'
import { normalizeInventoryRows, parseInventoryWorkbook } from '@/lib/inventory-import-parser'

describe('inventory workbook parsing', () => {
  it('preserves all rows, parses quoted thousands, and flags shifted columns', () => {
    const csv = [
      'Product Name,Size,Barcode,Cost Price (Kobo),Selling price (Kobo),Quantity,Minimum Quantity,Expiry date',
      '"ARENAX PLUS FORTE X6",80/480MG,8906035499340,"1,375","2,300",6,0,2027-12-31',
      '"Malformed Product",60ml,6154000034368,1,200,2,300,12,0,2028-04-30',
    ].join('\n')

    const parsed = parseInventoryWorkbook(Buffer.from(csv))
    const mapping = autoMapImportHeaders(parsed.headers, INVENTORY_IMPORT_FIELDS)
    const stagingRows = normalizeInventoryRows(parsed.rows, mapping)

    expect(parsed.rows).toHaveLength(2)
    expect(stagingRows).toHaveLength(2)
    expect(stagingRows[0]).toEqual({
      source_row_number: 2,
      raw_name: 'ARENAX PLUS FORTE X6',
      norm_name: 'arenax plus forte',
      barcode: '8906035499340',
      cost_kobo: 1375,
      price_kobo: 2300,
      qty: 6,
      min_qty: 0,
      expiry: '2027-12-31',
    })
    expect(stagingRows[1].parse_error).toContain('column_shift')
  })

  it('keeps an invalid field as an error row instead of throwing', () => {
    const csv = [
      'Product Name,Selling price (Kobo),Quantity',
      'Good Product,"1,200",4',
      'Bad Product,not-a-price,not-a-quantity',
    ].join('\n')

    const parsed = parseInventoryWorkbook(Buffer.from(csv))
    const mapping = autoMapImportHeaders(parsed.headers, INVENTORY_IMPORT_FIELDS)
    const stagingRows = normalizeInventoryRows(parsed.rows, mapping)

    expect(stagingRows).toHaveLength(2)
    expect(stagingRows[0].parse_error).toBeUndefined()
    expect(stagingRows[1].parse_error).toContain('invalid_price')
    expect(stagingRows[1].parse_error).toContain('invalid_quantity')
  })
})

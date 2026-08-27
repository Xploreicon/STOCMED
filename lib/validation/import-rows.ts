import { parseImportBoolean, parseImportDate } from '@/lib/inventory-import'

export type ImportRow = {
  mapped?: Record<string, unknown>
  selected_product_id?: string | null
  parse_error?: string | null
  match_status?: string | null
  review_required?: boolean
  review_resolved?: boolean
  source_row_number?: number
}

export type RowError = { row: number; errors: string[] }

export function validateRows(
  rows: ImportRow[],
  lookups?: { dosageForms?: string[]; categories?: string[] },
): RowError[] {
  return rows.flatMap((row, index) => {
    const mapped = row?.mapped ?? {}
    const errors: string[] = []
    const price = Number(mapped.price)
    const quantity = Number(mapped.quantity)
    const expiryText = parseImportDate(mapped.expiry_date)
    const expiry = expiryText ? new Date(`${expiryText}T23:59:59.999Z`) : null
    const itemType = mapped.item_type === 'store' ? 'store' : 'medicine'
    const tracksExpiry = itemType === 'medicine' || parseImportBoolean(mapped.tracks_expiry)
    const batchNumber = typeof mapped.batch_number === 'string' && mapped.batch_number.trim()
      ? mapped.batch_number.trim()
      : ''

    if (row.parse_error) errors.push(`Spreadsheet row is malformed (${row.parse_error})`)
    if ((row.review_required || row.match_status === 'review') && row.review_resolved !== true) {
      errors.push('Review this row before import')
    }

    if (!row || typeof row !== 'object') errors.push('Row must be an object')
    if (!mapped.generic_name || typeof mapped.generic_name !== 'string') errors.push('Item name is required')
    if (!Number.isFinite(price) || price <= 0) errors.push('Price must be greater than zero')
    if (!Number.isInteger(quantity) || quantity < 0) errors.push('Quantity must be a non-negative integer')
    if (tracksExpiry) {
      if (Boolean(batchNumber) !== Boolean(expiryText)) {
        errors.push('Batch number and expiry date must be supplied together')
      } else if (expiry && expiry <= new Date()) {
        errors.push('Expiry date must be in the future')
      }
    }
    if (itemType === 'medicine') {
      if (!mapped.strength || typeof mapped.strength !== 'string') errors.push('Strength is required for medicine matching')
      if (!mapped.dosage_form || typeof mapped.dosage_form !== 'string') errors.push('Dosage form is required for medicine matching')
      else if (lookups?.dosageForms && !lookups.dosageForms.includes(mapped.dosage_form)) {
        errors.push(`Dosage form "${mapped.dosage_form}" is not in the controlled list`)
      }
      if (!row.selected_product_id || typeof row.selected_product_id !== 'string') {
        errors.push('Catalogue selection is required for medicine')
      } else if (row.selected_product_id === 'create_new') {
        errors.push('New catalogue products require admin approval')
      } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.selected_product_id)) {
        errors.push('Catalogue product ID is invalid')
      }
    } else if (row.selected_product_id) {
      errors.push('Store items cannot reference the medicine catalogue')
    }

    return errors.length ? [{ row: index + 1, errors }] : []
  })
}

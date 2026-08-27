import * as XLSX from 'xlsx'

import {
  isKoboImportHeader,
  normalizeImportBarcode,
  normalizeImportProductName,
  parseImportDate,
  parseImportInteger,
  parseImportMoneyToKobo,
} from '@/lib/inventory-import'

export const IMPORT_ROW_NUMBER_KEY = '__row_number'
export const IMPORT_PARSE_ERROR_KEY = '__parse_error'

export type RawImportRow = Record<string, unknown> & {
  [IMPORT_ROW_NUMBER_KEY]: number
  [IMPORT_PARSE_ERROR_KEY]?: string
}

export type NormalizedImportStagingRow = {
  source_row_number: number
  raw_name: string
  norm_name: string
  barcode: string | null
  cost_kobo: number | null
  price_kobo: number | null
  qty: number | null
  min_qty: number | null
  expiry: string | null
  parse_error?: string
}

export type ParsedInventoryWorkbook = {
  headers: string[]
  rows: RawImportRow[]
}

function isNonEmptyRow(row: unknown[]): boolean {
  return row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 160)
  return 'unknown row error'
}

/**
 * Parse CSV or Excel with SheetJS while preserving every non-empty source row.
 * Row-level structural failures are returned as metadata instead of aborting
 * the complete file.
 */
export function parseInventoryWorkbook(buffer: Buffer): ParsedInventoryWorkbook {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { headers: [], rows: [] }

  const worksheet = workbook.Sheets[sheetName]
  const rawData = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    blankrows: true,
  })

  if (rawData.length === 0) return { headers: [], rows: [] }

  const rawHeaders = Array.isArray(rawData[0]) ? rawData[0] : []
  const headers = rawHeaders.map((header, index) =>
    header === null || header === undefined || String(header).trim() === ''
      ? `Column_${index + 1}`
      : String(header).trim(),
  )

  const rows: RawImportRow[] = []
  rawData.slice(1).forEach((sourceRow, index) => {
    const rowNumber = index + 2
    const rawRow = Array.isArray(sourceRow) ? sourceRow : []

    try {
      if (!isNonEmptyRow(rawRow)) return
      const row = Object.create(null) as RawImportRow
      row[IMPORT_ROW_NUMBER_KEY] = rowNumber

      if (rawRow.length > headers.length) {
        row[IMPORT_PARSE_ERROR_KEY] = 'column_shift'
      }

      headers.forEach((header, columnIndex) => {
        row[header] = rawRow[columnIndex] !== undefined ? rawRow[columnIndex] : ''
      })
      rows.push(row)
    } catch (error) {
      rows.push({
        [IMPORT_ROW_NUMBER_KEY]: rowNumber,
        [IMPORT_PARSE_ERROR_KEY]: `row_parse_error: ${errorMessage(error)}`,
      })
    }
  })

  return { headers, rows }
}

function mappedValue(row: RawImportRow, mapping: Record<string, string>, key: string): unknown {
  const header = mapping[key]
  return header ? row[header] : undefined
}

function addError(errors: string[], condition: boolean, code: string): void {
  if (condition && !errors.includes(code)) errors.push(code)
}

/** Convert parsed records into the database-neutral staging contract. */
export function normalizeInventoryRows(
  rows: RawImportRow[],
  mapping: Record<string, string>,
): NormalizedImportStagingRow[] {
  return rows.map((row) => {
    try {
      const errors = row[IMPORT_PARSE_ERROR_KEY] ? [String(row[IMPORT_PARSE_ERROR_KEY])] : []
      const rawNameValue = mappedValue(row, mapping, 'name')
      const rawName = rawNameValue === null || rawNameValue === undefined ? '' : String(rawNameValue)
      const rawBarcode = mappedValue(row, mapping, 'sku')
      const rawCost = mappedValue(row, mapping, 'unit_cost')
      const rawPrice = mappedValue(row, mapping, 'price')
      const rawQty = mappedValue(row, mapping, 'quantity')
      const rawMinQty = mappedValue(row, mapping, 'min_quantity')
      const rawExpiry = mappedValue(row, mapping, 'expiry_date')

      const costKobo = parseImportMoneyToKobo(rawCost, isKoboImportHeader(mapping.unit_cost))
      const priceKobo = parseImportMoneyToKobo(rawPrice, isKoboImportHeader(mapping.price))
      const qty = parseImportInteger(rawQty)
      const minQty = parseImportInteger(rawMinQty)
      const expiry = parseImportDate(rawExpiry) || null

      addError(errors, rawCost !== undefined && String(rawCost).trim() !== '' && costKobo === null, 'invalid_cost')
      addError(errors, rawPrice !== undefined && String(rawPrice).trim() !== '' && priceKobo === null, 'invalid_price')
      addError(errors, rawQty !== undefined && String(rawQty).trim() !== '' && qty === null, 'invalid_quantity')
      addError(errors, rawMinQty !== undefined && String(rawMinQty).trim() !== '' && minQty === null, 'invalid_min_quantity')
      addError(errors, rawExpiry !== undefined && String(rawExpiry).trim() !== '' && expiry === null, 'invalid_expiry')

      const normalized: NormalizedImportStagingRow = {
        source_row_number: row[IMPORT_ROW_NUMBER_KEY],
        raw_name: rawName,
        norm_name: normalizeImportProductName(rawName),
        barcode: normalizeImportBarcode(rawBarcode),
        cost_kobo: costKobo,
        price_kobo: priceKobo,
        qty,
        min_qty: minQty,
        expiry,
      }
      if (errors.length) normalized.parse_error = errors.join(',')
      return normalized
    } catch (error) {
      return {
        source_row_number: row[IMPORT_ROW_NUMBER_KEY],
        raw_name: '',
        norm_name: '',
        barcode: null,
        cost_kobo: null,
        price_kobo: null,
        qty: null,
        min_qty: null,
        expiry: null,
        parse_error: `row_parse_error: ${errorMessage(error)}`,
      }
    }
  })
}

import { validateRows, type ImportRow } from '@/lib/validation/import-rows'

export type OnboardingRow = ImportRow & {
  source_row_number: number
  parse_error?: string
  [key: string]: unknown
}

export function reviewOnboardingRows(rows: OnboardingRow[], lookups: { dosageForms: string[]; categories: string[] }, existingItemNames: string[] = []) {
  const firstWord = (name: string) => name.toLowerCase().match(/[a-z0-9]+/)?.[0] || ''
  const existingPrefixes = new Set(existingItemNames.map(firstWord).filter((word) => word.length >= 4))
  return rows.map((row) => {
    // Numeric/date corrections are revalidated below. Never clear structural
    // column-shift errors or guess an invalid/missing purchase cost.
    const parseError = row.parse_error?.split(',').filter((code) =>
      !['invalid_quantity', 'invalid_price', 'invalid_expiry', 'invalid_min_quantity'].includes(code)).join(',')
    const errors = validateRows([row], lookups)[0]?.errors || []
    const sourceName = String(row.mapped?.source_name || row.mapped?.brand_name || row.mapped?.generic_name || '')
    if (existingPrefixes.has(firstWord(sourceName))) {
      errors.push('Possible existing stock under a shorter or different name: reconcile before adding opening stock')
    }
    if (parseError) errors.push(`Source data needs correction: ${parseError}`)
    return { ...row, parse_error: parseError || undefined, review_errors: errors }
  })
}

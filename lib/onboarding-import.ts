import { validateRows, type ImportRow } from '@/lib/validation/import-rows'

export type OnboardingRow = ImportRow & {
  source_row_number: number
  parse_error?: string
  [key: string]: unknown
}

export function reviewOnboardingRows(rows: OnboardingRow[], lookups: { dosageForms: string[]; categories: string[] }) {
  return rows.map((row) => {
    // Numeric/date corrections are revalidated below. Never clear structural
    // column-shift errors or guess an invalid/missing purchase cost.
    const parseError = row.parse_error?.split(',').filter((code) =>
      !['invalid_quantity', 'invalid_price', 'invalid_expiry', 'invalid_min_quantity'].includes(code)).join(',')
    const errors = validateRows([row], lookups)[0]?.errors || []
    if (parseError) errors.push(`Source data needs correction: ${parseError}`)
    return { ...row, parse_error: parseError || undefined, review_errors: errors }
  })
}

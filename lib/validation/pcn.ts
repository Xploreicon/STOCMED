// PCN does not publish a machine-readable checksum. Pilot premises numbers
// are six-to-nine digits; passing this check grants provisional visibility
// only and must never be treated as regulatory verification.
const PCN_NUMBER_PATTERN = /^\d{6,9}$/

export function normalizePcnNumber(value: string) {
  return value.trim().toUpperCase()
}

export function isPcnNumberFormatValid(value: string) {
  const normalized = normalizePcnNumber(value)
  return PCN_NUMBER_PATTERN.test(normalized)
}

export const PCN_NUMBER_FORMAT_HELP =
  'Enter the 6–9 digit premises number exactly as printed on the PCN record.'

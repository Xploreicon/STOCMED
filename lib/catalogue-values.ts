const CATALOGUE_SEARCH_NOISE = new Set([
  'bp',
  'usp',
  'tablet',
  'tablets',
  'tab',
  'tabs',
  'capsule',
  'capsules',
  'cap',
  'caps',
  'syrup',
  'suspension',
  'solution',
  'cream',
  'ointment',
  'drops',
  'injection',
  'oral',
  'bottle',
  'pack',
  'sachet',
])

export function normalizeDosageForm(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Imported Store labels commonly append strength, standard, and pack details.
 * Catalogue search is substring-based, so seed it with the first meaningful
 * identity token instead of the entire POS description.
 */
export function catalogueSearchSeed(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9'-]+/g, ' ')
    .trim()

  const tokens = normalized.split(/\s+/).filter(Boolean)
  const meaningful = tokens.find((token) => {
    const lower = token.toLowerCase()
    return token.length >= 3
      && !CATALOGUE_SEARCH_NOISE.has(lower)
      && !/^\d/.test(token)
      && !/^\d+(?:\.\d+)?(?:mg|mcg|g|ml|iu)$/i.test(token)
  })

  return meaningful || normalized
}

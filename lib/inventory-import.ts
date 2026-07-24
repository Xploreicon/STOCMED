export function normalizeImportHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function autoMapImportHeaders(
  headers: string[],
  fields: Array<{ key: string; synonyms: string[] }>
): Record<string, string> {
  const mapping: Record<string, string> = {}
  const used = new Set<string>()

  for (const field of fields) {
    const aliases = [field.key, ...field.synonyms].map(normalizeImportHeader)
    const exact = headers.find((header) =>
      !used.has(header) && aliases.includes(normalizeImportHeader(header))
    )
    if (exact) {
      mapping[field.key] = exact
      used.add(exact)
      continue
    }

    const fuzzy = headers.find((header) => {
      if (used.has(header)) return false
      const normalized = normalizeImportHeader(header)
      return aliases.some((alias) =>
        alias.length >= 4 && (normalized.includes(alias) || alias.includes(normalized))
      )
    })
    if (fuzzy) {
      mapping[field.key] = fuzzy
      used.add(fuzzy)
    }
  }

  return mapping
}

export function parseImportBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value !== 'string') return false
  return ['true', 'yes', 'y', '1', 'on', 'checked'].includes(value.trim().toLowerCase())
}

export function normalizeImportStrength(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9.]/g, '')
}

export function normalizeImportDosageForm(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return ''
  if (/(caplet|tablet|(^|[^a-z])tab([^a-z]|$))/.test(normalized)) return 'tablet'
  if (/(capsule|(^|[^a-z])cap([^a-z]|$))/.test(normalized)) return 'capsule'
  if (normalized.includes('suspension')) return 'suspension'
  if (normalized.includes('syrup')) return 'syrup'
  if (normalized.includes('elixir')) return 'elixir'
  if (normalized.includes('solution')) return 'solution'
  if (normalized.includes('injection') || normalized.includes('injectable')) return 'injection'
  if (normalized.includes('cream')) return 'cream'
  if (normalized.includes('ointment')) return 'ointment'
  if (normalized.includes('gel')) return 'gel'
  if (normalized.includes('drop')) return 'drops'
  if (normalized.includes('suppositor')) return 'suppository'
  if (normalized.includes('inhal')) return 'inhalation'
  return normalized.replace(/[^a-z0-9]/g, '')
}

export function parseImportDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const utcDays = Math.floor(value - 25569)
    const date = new Date(utcDays * 86_400_000)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
  }
  const text = String(value ?? '').trim()
  if (!text) return ''

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) return validIsoDate(isoMatch[1], isoMatch[2], isoMatch[3])

  const dayFirstMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dayFirstMatch) return validIsoDate(dayFirstMatch[3], dayFirstMatch[2], dayFirstMatch[1])

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function validIsoDate(year: string, month: string, day: string): string {
  const iso = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const date = new Date(`${iso}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? '' : iso
}

export function isSafeAutoMatch(match: Record<string, unknown> | null | undefined): boolean {
  if (!match) return false
  return Number(match.confidence) >= 0.7
    && match.strength_match === true
    && match.form_match === true
    && (!Array.isArray(match.mismatch_reasons) || match.mismatch_reasons.length === 0)
}

export function matchConflictLabels(match: Record<string, unknown> | null | undefined): string[] {
  if (!match) return []
  const reasons = Array.isArray(match.mismatch_reasons)
    ? match.mismatch_reasons.filter((reason): reason is string => typeof reason === 'string')
    : []
  if (reasons.length) return reasons
  return [
    match.strength_match === false ? 'strength differs' : null,
    match.form_match === false ? 'form differs' : null,
  ].filter((reason): reason is string => Boolean(reason))
}

/**
 * Returns true when a row carries signals that it represents a medicine —
 * either the CSV "type" column explicitly says medicine/drug/rx, or the row
 * has a non-empty strength or dosage-form value.
 */
export function hasMedicineSignals(mapped: Record<string, unknown>): boolean {
  const suppliedType = String(mapped.item_type ?? '').trim().toLowerCase()
  if (['medicine', 'drug', 'rx'].includes(suppliedType)) return true
  if (mapped.strength && String(mapped.strength).trim()) return true
  if (mapped.dosage_form && String(mapped.dosage_form).trim()) return true
  return false
}

export type ImportRouting = {
  itemType: 'medicine' | 'store'
  selectedProductId: string
}

/**
 * Three-outcome routing for import rows:
 *
 *   A. Confident catalogue match → Medicine (linked to existing product)
 *   B. No confident match BUT the row looks like a medicine (has strength
 *      and/or dosage form, or CSV "type" column says medicine/drug/rx) →
 *      Medicine with `selected_product_id = 'create_new'` (self-enrichment)
 *   C. No match AND no medicine signals → Store
 *
 * When the CSV explicitly says type=medicine, the row is NEVER routed to
 * Store regardless of match confidence.  Explicit user intent beats the
 * heuristic.
 */
export function determineImportRouting(
  mapped: Record<string, unknown>,
  bestMatch: Record<string, unknown> | null | undefined,
): ImportRouting {
  const suppliedType = String(mapped.item_type ?? '').trim().toLowerCase()

  // Explicit Store designation
  if (['store', 'grocery', 'frontstore'].includes(suppliedType)) {
    return { itemType: 'store', selectedProductId: '' }
  }

  const safeMatch = isSafeAutoMatch(bestMatch)

  // Explicit medicine/drug/rx designation — NEVER Store
  if (['medicine', 'drug', 'rx'].includes(suppliedType)) {
    return {
      itemType: 'medicine',
      selectedProductId: safeMatch ? String(bestMatch!.id) : 'create_new',
    }
  }

  // Confident catalogue match → medicine
  if (safeMatch) {
    return { itemType: 'medicine', selectedProductId: String(bestMatch!.id) }
  }

  // Heuristic: row has strength or dosage-form → medicine (self-enrichment)
  if (hasMedicineSignals(mapped)) {
    return { itemType: 'medicine', selectedProductId: 'create_new' }
  }

  // Fall-through: no match, no signals → Store
  return { itemType: 'store', selectedProductId: '' }
}

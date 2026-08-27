export function normalizeImportHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export const INVENTORY_IMPORT_FIELDS = [
  {
    key: 'name',
    label: 'Item / Generic Name',
    required: true,
    synonyms: ['name', 'item', 'item name', 'generic name', 'drug name', 'medication', 'product', 'product name', 'description'],
  },
  {
    key: 'item_type',
    label: 'Type',
    required: false,
    synonyms: ['type', 'department', 'item type', 'product type'],
  },
  {
    key: 'tracks_expiry',
    label: 'Tracks Expiry',
    required: false,
    synonyms: ['tracks expiry', 'expiry tracked', 'perishable'],
  },
  {
    key: 'brand_name',
    label: 'Brand Name',
    required: false,
    synonyms: ['brand', 'brand name', 'trade name'],
  },
  {
    key: 'strength',
    label: 'Strength',
    required: false,
    synonyms: ['strength', 'dosage strength', 'dose', 'mg', 'g', 'ml'],
  },
  {
    key: 'dosage_form',
    label: 'Dosage Form',
    required: false,
    synonyms: ['form', 'dosage form', 'product form'],
  },
  {
    key: 'category',
    label: 'Category',
    required: false,
    synonyms: ['category', 'class', 'group', 'product category'],
  },
  {
    key: 'pack_size',
    label: 'Pack Size',
    required: false,
    synonyms: ['pack', 'pack size', 'packaging', 'size', 'unit size'],
  },
  {
    key: 'sku',
    label: 'SKU / Barcode',
    required: false,
    synonyms: ['sku', 'barcode', 'bar code', 'gtin', 'ean', 'upc', 'product sku', 'product code'],
  },
  {
    key: 'unit_cost',
    label: 'Unit Cost',
    required: false,
    synonyms: ['cost', 'unit cost', 'purchase cost', 'cost price', 'cost price kobo', 'cost price (kobo)', 'buying price'],
  },
  {
    key: 'price',
    label: 'Selling Price',
    required: true,
    synonyms: ['price', 'selling price', 'selling price kobo', 'selling price (kobo)', 'sales price', 'retail price', 'rate', 'unit price'],
  },
  {
    key: 'quantity',
    label: 'Opening Qty',
    required: true,
    synonyms: ['quantity', 'qty', 'stock', 'opening qty', 'quantity on hand', 'stock on hand', 'count'],
  },
  {
    key: 'min_quantity',
    label: 'Minimum Qty',
    required: false,
    synonyms: ['minimum quantity', 'minimum qty', 'min quantity', 'min qty', 'reorder level', 'low stock threshold'],
  },
  {
    key: 'batch_number',
    label: 'Batch Number',
    required: false,
    synonyms: ['batch', 'batch no', 'batch number', 'lot', 'lot number'],
  },
  {
    key: 'expiry_date',
    label: 'Expiry Date',
    required: false,
    synonyms: ['expiry', 'exp', 'expiry date', 'expiration date', 'exp date', 'best before'],
  },
] as const

export function autoMapImportHeaders(
  headers: string[],
  fields: ReadonlyArray<{ key: string; synonyms: readonly string[] }>
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

/**
 * Produces the shared comparison key used by the staging matcher. The source
 * name must be retained separately because this function intentionally drops
 * strength, volume, and pack-size tokens.
 */
export function normalizeImportProductName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\bb\s*\.\s*p\.?\b/g, 'bp')
    .replace(/\bpack\s+of\s+\d+\b/g, ' ')
    .replace(/\bx\s*\d+\s*(?:tablets?|tabs?|capsules?|caps?|sachets?|ampoules?|vials?|bottles?)?\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|kg|g|ml|cl|l|iu|units?|%)?(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|kg|g|ml|cl|l|iu|units?|%)?)+\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|kg|g|ml|cl|l|iu|units?|%)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Keeps only GTIN-shaped identifiers. Checksum validation is deliberately not
 * applied here because pharmacy exports frequently contain private-label GTINs
 * whose useful matching property is their stable 8/12/13/14-digit shape.
 */
export function normalizeImportBarcode(value: unknown): string | null {
  const barcode = String(value ?? '').trim()
  return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(barcode) ? barcode : null
}

export function isKoboImportHeader(header: string | undefined): boolean {
  return header ? normalizeImportHeader(header).includes('kobo') : false
}

/** Parse a grouped whole-number cell without passing through floating point. */
export function parseImportInteger(value: unknown): number | null {
  const normalized = String(value ?? '').trim().replace(/,/g, '')
  if (!normalized || !/^[+-]?\d+(?:\.0+)?$/.test(normalized)) return null
  const result = Number(normalized.replace(/\.0+$/, ''))
  return Number.isSafeInteger(result) ? result : null
}

/**
 * Convert a monetary cell to integer Kobo. Kobo-labelled columns are already
 * in minor units; other columns are interpreted as Naira and converted using
 * string arithmetic so decimal precision is not lost.
 */
export function parseImportMoneyToKobo(value: unknown, alreadyKobo = false): number | null {
  const normalized = String(value ?? '')
    .trim()
    .replace(/,/g, '')
    .replace(/^(?:ngn|₦)\s*/i, '')
    .trim()

  if (!normalized) return null
  if (alreadyKobo) return parseImportInteger(normalized)

  const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) return null
  const sign = match[1] === '-' ? -1 : 1
  const naira = Number(match[2])
  const fraction = Number((match[3] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(naira) || naira > Math.floor(Number.MAX_SAFE_INTEGER / 100)) return null
  const result = sign * (naira * 100 + fraction)
  return Number.isSafeInteger(result) ? result : null
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
  if (match.match_status && match.match_status !== 'matched') return false
  const mismatchReasons = Array.isArray(match.mismatch_reasons)
    ? match.mismatch_reasons.filter((reason): reason is string => typeof reason === 'string')
    : []
  return Number(match.confidence) >= 0.9
    && match.strength_match !== false
    && match.form_match !== false
    && !mismatchReasons.some((reason) => reason.includes('differs'))
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
 *      Medicine with no catalogue selection, held for review/admin candidate
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
      selectedProductId: safeMatch ? String(bestMatch!.id) : '',
    }
  }

  // Confident catalogue match → medicine
  if (safeMatch) {
    return { itemType: 'medicine', selectedProductId: String(bestMatch!.id) }
  }

  // Heuristic: row has strength or dosage-form → medicine review. Pharmacies
  // never create shared catalogue identity from this route.
  if (hasMedicineSignals(mapped)) {
    return { itemType: 'medicine', selectedProductId: '' }
  }

  // Fall-through: no match, no signals → Store
  return { itemType: 'store', selectedProductId: '' }
}

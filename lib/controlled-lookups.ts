const DOSAGE_FORM_ALIASES: Record<string, string[]> = {
  tab: ['tablet'],
  tabs: ['tablet'],
  cap: ['capsule'],
  caps: ['capsule'],
  susp: ['suspension'],
  inj: ['injection'],
  injection: ['injection'],
  softgel: ['softgel', 'capsule'],
  'soft gel': ['softgel', 'capsule'],
  softgels: ['softgel', 'capsule'],
  'soft gels': ['softgel', 'capsule'],
}

function normalized(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j]
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return previous[right.length]
}

export function mapControlledValue(
  input: unknown,
  allowedValues: string[],
  aliases: Record<string, string[]> = {},
) {
  const value = normalized(input)
  if (!value) return { value: '', recognized: false, suggested: null as string | null }

  const byNormalized = new Map(allowedValues.map((allowed) => [normalized(allowed), allowed]))
  const exact = byNormalized.get(value)
  if (exact) return { value: exact, recognized: true, suggested: exact }

  for (const candidate of aliases[value] || []) {
    const match = byNormalized.get(normalized(candidate))
    if (match) return { value: match, recognized: true, suggested: match }
  }

  const closest = allowedValues
    .map((allowed) => ({ allowed, distance: editDistance(value, normalized(allowed)) }))
    .sort((a, b) => a.distance - b.distance || a.allowed.localeCompare(b.allowed))[0]
  const fuzzyMatch = closest && closest.distance <= Math.max(1, Math.floor(value.length * 0.25))
  return {
    value: fuzzyMatch ? closest.allowed : String(input ?? '').trim(),
    recognized: Boolean(fuzzyMatch),
    suggested: closest?.allowed ?? null,
  }
}

export function mapDosageForm(input: unknown, allowedValues: string[]) {
  return mapControlledValue(input, allowedValues, DOSAGE_FORM_ALIASES)
}


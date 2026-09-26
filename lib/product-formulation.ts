/** Quantities are per labelled dosage unit/serving, not stock pack size. */
export type FormulationKind = 'fixed_combination' | 'multivitamin'
export type Ingredient = { name: string; amount: string; unit: string }
export type ProductFormulation = {
  kind: FormulationKind
  basis_quantity: number
  basis_unit: string
  ingredients: Ingredient[]
  label_confirmed: boolean
}

export const FORMULATION_UNITS = ['mg', 'mcg', 'g', 'IU', 'mL', 'units', 'mcg RAE', 'mcg DFE', 'mg NE'] as const
export const FORMULATION_BASES = ['tablet', 'capsule', 'softgel', 'gummy', 'sachet', 'mL', 'vial', 'ampoule'] as const

export function formulationDisplay(value: unknown): { display: string; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { display: '', error: 'Confirm the complete formulation from the pack label' }
  const form = value as Partial<ProductFormulation>
  if (form.kind !== 'fixed_combination' && form.kind !== 'multivitamin') return { display: '', error: 'Choose fixed-dose combination or multivitamin' }
  if (form.label_confirmed !== true) return { display: '', error: 'Confirm that every labelled active ingredient or nutrient was entered' }
  if (!Number.isInteger(form.basis_quantity) || form.basis_quantity! < 1 || form.basis_quantity! > 1000 ||
    !FORMULATION_BASES.includes(form.basis_unit as typeof FORMULATION_BASES[number])) {
    return { display: '', error: 'Confirm the labelled amount per tablet, capsule or serving volume' }
  }
  if (!Array.isArray(form.ingredients) || form.ingredients.length < 2 || form.ingredients.length > 40) {
    return { display: '', error: 'Enter all ingredients and their amounts (at least two, at most 40)' }
  }
  const seen = new Set<string>()
  const ingredients: Ingredient[] = []
  for (const entry of form.ingredients) {
    if (!entry || typeof entry !== 'object') return { display: '', error: 'Complete every ingredient' }
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const amount = typeof entry.amount === 'string' ? entry.amount.trim() : ''
    const unit = entry.unit
    if (!name || name.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9 ().+\/-]*$/.test(name) ||
      !/^(?:\d{1,7})(?:\.\d{1,4})?$/.test(amount) || Number(amount) <= 0 ||
      !FORMULATION_UNITS.includes(unit as typeof FORMULATION_UNITS[number])) {
      return { display: '', error: 'Each ingredient needs its exact labelled name, positive amount and unit' }
    }
    const key = name.toLowerCase()
    if (seen.has(key)) return { display: '', error: 'List each ingredient once per serving' }
    seen.add(key)
    ingredients.push({ name, amount, unit })
  }
  ingredients.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1)
  return {
    display: `${ingredients.map(({ name, amount, unit }) => `${name} ${amount}${unit}`).join(' + ')} per ${form.basis_quantity} ${form.basis_unit}`,
    error: '',
  }
}

export function sameFormulation(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const a = formulationDisplay(left)
  const b = formulationDisplay(right)
  return !a.error && !b.error && (left as ProductFormulation).kind === (right as ProductFormulation).kind &&
    a.display.toLowerCase() === b.display.toLowerCase()
}

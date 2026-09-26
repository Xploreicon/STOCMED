'use client'

import {
  FORMULATION_BASES, FORMULATION_UNITS, formulationDisplay,
  type ProductFormulation, type FormulationKind,
} from '@/lib/product-formulation'

const emptyForm = (kind: FormulationKind): ProductFormulation => ({
  kind, basis_quantity: 1, basis_unit: 'tablet', label_confirmed: false,
  ingredients: [{ name: '', amount: '', unit: 'mg' }, { name: '', amount: '', unit: 'mg' }],
})

export function FormulationEditor({ sourceRow, value, disabled, onChange }: {
  sourceRow: number
  value: ProductFormulation | null
  disabled?: boolean
  onChange: (value: ProductFormulation | null) => void
}) {
  const apply = (patch: Partial<ProductFormulation>) => value && onChange({ ...value, ...patch, label_confirmed: false })
  const status = value ? formulationDisplay(value) : null
  return (
    <div className="mt-2 max-w-sm rounded-md border border-border bg-surface p-2 text-xs space-y-2">
      <label className="block font-semibold">
        Strength type
        <select aria-label={`Strength type for source row ${sourceRow}`} disabled={disabled}
          value={value?.kind || 'single'}
          onChange={e => onChange(e.target.value === 'single' ? null : emptyForm(e.target.value as FormulationKind))}
          className="mt-1 block w-full rounded border border-border bg-white p-1">
          <option value="single">Single ingredient</option>
          <option value="fixed_combination">Fixed-dose combination</option>
          <option value="multivitamin">Multivitamin / nutrients</option>
        </select>
      </label>
      {value && <>
        <p>Copy every {value.kind === 'multivitamin' ? 'nutrient' : 'active ingredient'} and amount from the pack label. Do not use a pack count as strength.</p>
        <div className="flex flex-wrap items-end gap-1">
          <label>Amount per
            <input aria-label={`Serving quantity for source row ${sourceRow}`} disabled={disabled} type="number" min="1" max="1000" step="1"
              value={value.basis_quantity} onChange={e => apply({ basis_quantity: Number(e.target.value) })}
              className="block w-16 rounded border border-border bg-white p-1" />
          </label>
          <select aria-label={`Serving unit for source row ${sourceRow}`} disabled={disabled}
            value={value.basis_unit} onChange={e => apply({ basis_unit: e.target.value })}
            className="rounded border border-border bg-white p-1">
            {FORMULATION_BASES.map(unit => <option key={unit}>{unit}</option>)}
          </select>
        </div>
        {value.ingredients.map((ingredient, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1">
            <input aria-label={`Ingredient ${i + 1} name for source row ${sourceRow}`} disabled={disabled}
              placeholder="Ingredient name" value={ingredient.name}
              onChange={e => apply({ ingredients: value.ingredients.map((item, j) => j === i ? { ...item, name: e.target.value } : item) })}
              className="min-w-28 flex-1 rounded border border-border bg-white p-1" />
            <input aria-label={`Ingredient ${i + 1} amount for source row ${sourceRow}`} disabled={disabled}
              placeholder="Amount" inputMode="decimal" value={ingredient.amount}
              onChange={e => apply({ ingredients: value.ingredients.map((item, j) => j === i ? { ...item, amount: e.target.value } : item) })}
              className="w-16 rounded border border-border bg-white p-1" />
            <select aria-label={`Ingredient ${i + 1} unit for source row ${sourceRow}`} disabled={disabled}
              value={ingredient.unit}
              onChange={e => apply({ ingredients: value.ingredients.map((item, j) => j === i ? { ...item, unit: e.target.value } : item) })}
              className="rounded border border-border bg-white p-1">
              {FORMULATION_UNITS.map(unit => <option key={unit}>{unit}</option>)}
            </select>
            <button type="button" aria-label={`Remove ingredient ${i + 1} for source row ${sourceRow}`} disabled={disabled || value.ingredients.length <= 2}
              onClick={() => apply({ ingredients: value.ingredients.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <button type="button" disabled={disabled || value.ingredients.length >= 40}
          onClick={() => apply({ ingredients: [...value.ingredients, { name: '', amount: '', unit: 'mg' }] })}
          className="text-primary underline">Add ingredient</button>
        <label className="flex items-start gap-2">
          <input type="checkbox" disabled={disabled} checked={value.label_confirmed}
            onChange={e => onChange({ ...value, label_confirmed: e.target.checked })} />
          I checked the pack label and entered the complete formulation per serving.
        </label>
        {status?.display ? <p className="break-words font-medium">{status.display}</p> :
          <p className="text-danger">{status?.error}</p>}
      </>}
    </div>
  )
}

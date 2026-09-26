import { describe, expect, it } from 'vitest'
import { formulationDisplay, sameFormulation } from '@/lib/product-formulation'
import { validateRows } from '@/lib/validation/import-rows'

const combination = {
  kind: 'fixed_combination' as const, basis_quantity: 1, basis_unit: 'tablet', label_confirmed: true,
  ingredients: [
    { name: 'Ingredient B', amount: '125', unit: 'mg' },
    { name: 'Ingredient A', amount: '500', unit: 'mg' },
  ],
}
describe('label-confirmed multi-ingredient formulations', () => {
  it('displays all ingredients and dosage basis deterministically', () => {
    expect(formulationDisplay(combination).display).toBe('Ingredient A 500mg + Ingredient B 125mg per 1 tablet')
    expect(sameFormulation(combination, { ...combination, ingredients: [...combination.ingredients].reverse() })).toBe(true)
  })
  it('does not accept a partial, duplicate or unconfirmed label', () => {
    expect(formulationDisplay({ ...combination, label_confirmed: false }).error).toMatch(/every labelled/)
    expect(formulationDisplay({ ...combination, ingredients: [combination.ingredients[0]] }).error).toMatch(/at least two/)
    expect(formulationDisplay({ ...combination, ingredients: [combination.ingredients[0], { ...combination.ingredients[0] }] }).error).toMatch(/once/)
    expect(formulationDisplay({ ...combination, ingredients: [{ ...combination.ingredients[0], amount: '0' }, combination.ingredients[1]] }).error).toMatch(/positive/)
  })
  it('does not equate different amounts, basis or formulation kinds', () => {
    expect(sameFormulation(combination, { ...combination, basis_quantity: 2 })).toBe(false)
    expect(sameFormulation(combination, { ...combination, kind: 'multivitamin' })).toBe(false)
    expect(sameFormulation(combination, { ...combination, ingredients: [{ ...combination.ingredients[0], amount: '250' }, combination.ingredients[1]] })).toBe(false)
  })
  it('supports nutrient units and serving sizes without reducing a multivitamin to one strength', () => {
    const multivitamin = { kind: 'multivitamin', basis_quantity: 2, basis_unit: 'gummy', label_confirmed: true,
      ingredients: [{ name: 'Vitamin A', amount: '600', unit: 'mcg RAE' }, { name: 'Folate', amount: '400', unit: 'mcg DFE' }] }
    expect(formulationDisplay(multivitamin).display).toBe('Folate 400mcg DFE + Vitamin A 600mcg RAE per 2 gummy')
  })
  it('validates structure and displayed strength before medicine import', () => {
    const row = { selected_product_id: 'create_new', mapped: {
      generic_name: 'Confirmed combination', item_type: 'medicine', formulation: combination,
      strength: formulationDisplay(combination).display, dosage_form: 'tablet', category: 'Analgesics',
      quantity: 4, price: 150, batch_number: 'B1', expiry_date: '2099-12-31',
    } }
    expect(validateRows([row], { dosageForms: ['tablet'], categories: ['Analgesics'] })).toEqual([])
    expect(validateRows([{ ...row, mapped: { ...row.mapped, strength: '500mg' } }])[0].errors).toContain('Formulation and displayed strength do not match')
    expect(validateRows([{ ...row, mapped: { ...row.mapped, formulation: { ...combination, label_confirmed: false } } }])[0].errors).toContain('Confirm that every labelled active ingredient or nutrient was entered')
  })
})

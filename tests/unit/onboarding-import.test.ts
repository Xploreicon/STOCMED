import { describe, expect, it } from 'vitest'
import { reviewOnboardingRows } from '@/lib/onboarding-import'

const lookups = { dosageForms: ['tablet'], categories: ['Analgesics'] }
const row = { source_row_number: 4, selected_product_id: 'create_new', mapped: {
  generic_name: 'Sample', strength: '500mg', dosage_form: 'tablet', category: 'Analgesics',
  item_type: 'medicine', quantity: 3, price: 100, batch_number: 'B1', expiry_date: '2099-12-31',
} }
describe('saved onboarding review', () => {
  it('holds shorter-name stock overlaps without claiming they are the same product', () => {
    const result = reviewOnboardingRows([{ ...row, mapped: { ...row.mapped, source_name: 'Cataflam Tablets 50mg' } }], lookups, ['Cataflam'])
    expect(result[0].review_errors).toContain('Possible existing stock under a shorter or different name: reconcile before adding opening stock')
  })
  it('does not confuse a partial brand word with the same first word', () => {
    const result = reviewOnboardingRows([{ ...row, mapped: { ...row.mapped, source_name: 'Emzor Dispersible Paracetamol 125mg' } }], lookups, ['Emzoron Tonique 200ml', 'Chlorpheniramine Syrup Emzor'])
    expect(result[0].review_errors).toEqual([])
  })
  it('keeps every row and identifies complete records', () => {
    const result = reviewOnboardingRows([row, { ...row, source_row_number: 5, mapped: { ...row.mapped, quantity: null } }], lookups)
    expect(result).toHaveLength(2)
    expect(result[0].review_errors).toEqual([])
    expect(result[1].review_errors).toContain('Quantity must be a non-negative integer')
  })
  it('allows confirmed numeric corrections without keeping stale parser errors', () => {
    expect(reviewOnboardingRows([{ ...row, parse_error: 'invalid_quantity' }], lookups)[0].review_errors).toEqual([])
  })
  it('does not clear structural errors or invalid purchase costs', () => {
    expect(reviewOnboardingRows([{ ...row, parse_error: 'column_shift,invalid_cost' }], lookups)[0].review_errors).toContain('Source data needs correction: column_shift,invalid_cost')
  })
  it('does not permit expired or incomplete medicines into stock', () => {
    const result = reviewOnboardingRows([{ ...row, mapped: { ...row.mapped, strength: '', expiry_date: '2009-09-30' } }], lookups)
    expect(result[0].review_errors).toContain('Strength is required for medicine matching')
    expect(result[0].review_errors).toContain('Expiry date must be in the future')
  })
})

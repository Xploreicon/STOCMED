import { describe, expect, it } from 'vitest'
import { catalogueSearchSeed, normalizeDosageForm } from '@/lib/catalogue-values'

describe('catalogue value normalization', () => {
  it('normalizes friendly dosage form labels to controlled database values', () => {
    expect(normalizeDosageForm(' Drops ')).toBe('drops')
    expect(normalizeDosageForm('Oral   Solution')).toBe('oral solution')
    expect(normalizeDosageForm(null)).toBe('')
  })

  it('seeds Store catalogue search with the likely identity token', () => {
    expect(catalogueSearchSeed('INDOMETACIN B.P. 25mg')).toBe('INDOMETACIN')
    expect(catalogueSearchSeed('Xyzal 5mg tablets')).toBe('Xyzal')
    expect(catalogueSearchSeed('Daktacort cream 15g')).toBe('Daktacort')
  })
})

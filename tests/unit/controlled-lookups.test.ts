import { describe, expect, it } from 'vitest'
import { mapControlledValue, mapDosageForm } from '@/lib/controlled-lookups'

const forms = ['capsule', 'injection', 'suspension', 'tablet']

describe('controlled import lookup mapping', () => {
  it.each([
    ['tabs', 'tablet'],
    ['caps', 'capsule'],
    ['susp', 'suspension'],
    ['inj', 'injection'],
    ['soft gel', 'capsule'],
    ['softgel', 'capsule'],
  ])('maps %s to %s', (input, expected) => {
    expect(mapDosageForm(input, forms)).toMatchObject({ value: expected, recognized: true })
  })

  it('prefers Softgel when the controlled lookup contains it', () => {
    expect(mapDosageForm('soft gel', [...forms, 'Softgel'])).toMatchObject({
      value: 'Softgel',
      recognized: true,
    })
  })

  it('does not silently accept a genuinely unknown form', () => {
    expect(mapDosageForm('sachet', forms)).toMatchObject({
      value: 'sachet',
      recognized: false,
    })
  })

  it('normalizes a close controlled category variant', () => {
    expect(mapControlledValue('Other', ['Others'])).toMatchObject({
      value: 'Others',
      recognized: true,
    })
  })
})

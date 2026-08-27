import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  IMPORT_STRUCTURER_AUTO_ACCEPT_THRESHOLD,
  IMPORT_STRUCTURER_BATCH_SIZE,
  parseImportStructureResponse,
} from '@/lib/import-ai-structurer'

const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'

describe('import AI structurer response boundary', () => {
  it('preserves combination ingredients and aligned strengths without making a match', () => {
    const rows = parseImportStructureResponse(JSON.stringify({
      rows: [{
        id: firstId,
        is_drug: true,
        ingredients: ['artemether', 'lumefantrine'],
        strength: '80 mg; 480 mg',
        dosage_form: 'tablet',
        brand: 'Arenax Plus Forte',
        pack: '6',
        confidence: 0.98,
      }],
    }), [firstId])

    expect(rows[0]).toEqual(expect.objectContaining({
      ingredients: ['artemether', 'lumefantrine'],
      strength: '80 mg; 480 mg',
      dosage_form: 'tablet',
    }))
    expect(rows[0]).not.toHaveProperty('product_id')
    expect(rows[0]).not.toHaveProperty('match')
  })

  it('rejects omitted, duplicate, or unexpected claimed IDs', () => {
    const row = {
      id: firstId,
      is_drug: false,
      ingredients: [],
      strength: null,
      dosage_form: null,
      brand: null,
      pack: null,
      confidence: 0.8,
    }

    expect(() => parseImportStructureResponse(JSON.stringify({ rows: [row] }), [firstId, secondId]))
      .toThrow('omitted')
    expect(() => parseImportStructureResponse(JSON.stringify({ rows: [row, row] }), [firstId, secondId]))
      .toThrow('duplicate')
    expect(() => parseImportStructureResponse(JSON.stringify({ rows: [{ ...row, id: secondId }] }), [firstId]))
      .toThrow('unexpected')
  })

  it('uses the gated batch size and auto-accept threshold', () => {
    expect(IMPORT_STRUCTURER_BATCH_SIZE).toBe(25)
    expect(IMPORT_STRUCTURER_AUTO_ACCEPT_THRESHOLD).toBe(0.9)
  })
})

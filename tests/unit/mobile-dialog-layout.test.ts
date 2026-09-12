import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('mobile inventory dialog layout', () => {
  it('keeps dialogs above the fixed mobile navigation', () => {
    const dialog = source('components/ui/dialog.tsx')

    expect(dialog).toContain('fixed inset-0 z-[80]')
    expect(dialog).toContain('relative z-[81]')
    expect(dialog).toContain('max-h-[calc(100dvh-1rem)]')
  })

  it('keeps inventory actions visible, tappable, and safe-area aware', () => {
    const editModal = source('components/pharmacy/EditDrugModal.tsx')

    expect(editModal).toContain('grid shrink-0 grid-cols-2')
    expect(editModal).toContain('pb-[max(1rem,env(safe-area-inset-bottom))]')
    expect(editModal).toContain('className="min-h-11 w-full sm:w-auto"')
    expect(editModal).toContain('onClose={onClose}')
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('Store-to-Medicine promotion boundary', () => {
  it('requires a human-selected, verified catalogue identity', () => {
    const component = source('components/pharmacy/StoreMedicinePromotion.tsx')
    const catalogueRoute = source('app/api/pharmacy/catalogue/route.ts')

    expect(component).toContain('Confirm promotion to Medicine')
    expect(component).toContain('promote_to_product_id: selected.id')
    expect(component).not.toMatch(/auto.?promot/i)
    expect(catalogueRoute).toContain(".eq('is_verified', true)")
  })

  it('performs the identity transition in one owner-scoped definer RPC', () => {
    const migration = source('supabase/migrations/20260901110000_store_medicine_link_promotion.sql')

    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain("p_patch->>'item_type' <> 'medicine'")
    expect(migration).toContain("v_inventory.item_type <> 'store'")
    expect(migration).toContain('This catalogue medicine is already in inventory')
    expect(migration).toContain('batch_capture_required')
    expect(migration.trimEnd()).toMatch(/NOTIFY pgrst, 'reload schema';$/)
  })
})

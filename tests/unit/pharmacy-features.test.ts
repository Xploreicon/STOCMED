import { describe, expect, it, vi } from 'vitest'
import {
  PHARMACY_FEATURE_KEYS,
  PHARMACY_FEATURE_PRESETS,
  PHARMACY_FEATURE_STATUS,
  getPharmacyFeatureStatus,
  isPharmacyFeatureEnabled,
  planPharmacyFeaturePreset,
  requirePharmacyFeature,
} from '@/lib/pharmacy-features'

describe('pharmacy feature foundation', () => {
  it('keeps every optional capability off unless explicitly enabled', () => {
    expect(PHARMACY_FEATURE_KEYS).toHaveLength(15)
    expect(new Set(PHARMACY_FEATURE_KEYS).size).toBe(PHARMACY_FEATURE_KEYS.length)
    expect(Object.keys(PHARMACY_FEATURE_STATUS).sort()).toEqual([...PHARMACY_FEATURE_KEYS].sort())
    expect(PHARMACY_FEATURE_PRESETS.just_the_basics).toEqual([])
  })

  it('classifies only verified capabilities as available', () => {
    expect(PHARMACY_FEATURE_KEYS.filter(key => getPharmacyFeatureStatus(key) === 'available')).toEqual([
      'packs_and_units', 'staff_accounts', 'customers', 'credit_sales',
      'purchase_orders_and_receiving', 'notifications', 'reservations', 'price_benchmark',
      'whatsapp_receipts', 'loyalty', 'unmet_demand_widget', 'smart_reorder', 'quickbooks_export',
    ])
    expect(PHARMACY_FEATURE_KEYS.filter(key => getPharmacyFeatureStatus(key) === 'coming_soon')).toEqual([])
    expect(PHARMACY_FEATURE_KEYS.filter(key => getPharmacyFeatureStatus(key) === 'hidden')).toEqual([
      'multi_branch', 'stock_exchange',
    ])
  })

  it('defines the migration presets exactly', () => {
    expect(PHARMACY_FEATURE_PRESETS.full_retail_shop).toEqual([
      'staff_accounts', 'customers', 'credit_sales', 'notifications',
    ])
    expect(PHARMACY_FEATURE_PRESETS.multi_branch_owner).toEqual([
      'multi_branch', 'staff_accounts', 'notifications',
    ])
    expect(PHARMACY_FEATURE_PRESETS.buying_and_stock).toEqual([
      'purchase_orders_and_receiving', 'smart_reorder', 'quickbooks_export',
    ])
  })

  it('plans presets without enabling unavailable features', () => {
    expect(planPharmacyFeaturePreset('full_retail_shop')).toEqual({
      changes: [
        { feature_key: 'staff_accounts', is_enabled: true },
        { feature_key: 'customers', is_enabled: true },
        { feature_key: 'credit_sales', is_enabled: true },
        { feature_key: 'notifications', is_enabled: true },
      ],
      skipped: [],
    })
    expect(planPharmacyFeaturePreset('multi_branch_owner')).toEqual({
      changes: [
        { feature_key: 'staff_accounts', is_enabled: true },
        { feature_key: 'notifications', is_enabled: true },
      ],
      skipped: ['multi_branch'],
    })
    expect(planPharmacyFeaturePreset('buying_and_stock')).toEqual({
      changes: [
        { feature_key: 'purchase_orders_and_receiving', is_enabled: true },
        { feature_key: 'smart_reorder', is_enabled: true },
        { feature_key: 'quickbooks_export', is_enabled: true },
      ],
      skipped: [],
    })
  })

  it('uses Just the basics to clear every optional feature, including stale rows', () => {
    const plan = planPharmacyFeaturePreset('just_the_basics')
    expect(plan.skipped).toEqual([])
    expect(plan.changes).toHaveLength(PHARMACY_FEATURE_KEYS.length)
    expect(plan.changes.map(change => change.feature_key)).toEqual(PHARMACY_FEATURE_KEYS)
    expect(plan.changes.every(change => change.is_enabled === false)).toBe(true)
  })

  it('rejects a disabled feature at the server boundary', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { is_enabled: false }, error: null })
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle })),
          })),
        })),
      })),
    }

    expect(await isPharmacyFeatureEnabled(supabase as any, 'pharmacy-id', 'packs_and_units')).toBe(false)
    expect(await requirePharmacyFeature(supabase as any, 'pharmacy-id', 'packs_and_units')).toEqual({
      error: 'This feature is turned off.',
      code: 'FEATURE_DISABLED',
      feature_key: 'packs_and_units',
    })
  })

  it('allows a feature only when its tenant row is explicitly enabled', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { is_enabled: true }, error: null })
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle })),
          })),
        })),
      })),
    }

    expect(await isPharmacyFeatureEnabled(supabase as any, 'pharmacy-id', 'reservations')).toBe(true)
    expect(await requirePharmacyFeature(supabase as any, 'pharmacy-id', 'reservations')).toBeNull()
  })

  it('treats a missing feature row as disabled', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle })),
          })),
        })),
      })),
    }

    expect(await isPharmacyFeatureEnabled(supabase as any, 'pharmacy-id', 'reservations')).toBe(false)
  })

  it('fails closed when the feature lookup returns a database error', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { is_enabled: true },
      error: { message: 'lookup failed' },
    })
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle })),
          })),
        })),
      })),
    }

    expect(await isPharmacyFeatureEnabled(supabase as any, 'pharmacy-id', 'packs_and_units')).toBe(false)
  })

  it('ignores stale enabled rows for hidden features without querying the database', async () => {
    const supabase = { from: vi.fn() }

    expect(await isPharmacyFeatureEnabled(supabase as any, 'pharmacy-id', 'multi_branch')).toBe(false)
    expect(await isPharmacyFeatureEnabled(supabase as any, 'pharmacy-id', 'stock_exchange')).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

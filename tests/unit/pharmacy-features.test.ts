import { describe, expect, it, vi } from 'vitest'
import {
  PHARMACY_FEATURE_KEYS,
  PHARMACY_FEATURE_PRESETS,
  isPharmacyFeatureEnabled,
  requirePharmacyFeature,
} from '@/lib/pharmacy-features'

describe('pharmacy feature foundation', () => {
  it('keeps every optional capability off unless explicitly enabled', () => {
    expect(PHARMACY_FEATURE_KEYS).toHaveLength(15)
    expect(new Set(PHARMACY_FEATURE_KEYS).size).toBe(PHARMACY_FEATURE_KEYS.length)
    expect(PHARMACY_FEATURE_PRESETS.just_the_basics).toEqual([])
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

    expect(await isPharmacyFeatureEnabled(supabase as any, 'pharmacy-id', 'smart_reorder')).toBe(false)
    expect(await requirePharmacyFeature(supabase as any, 'pharmacy-id', 'smart_reorder')).toEqual({
      error: 'This feature is turned off.',
      code: 'FEATURE_DISABLED',
      feature_key: 'smart_reorder',
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

    expect(await isPharmacyFeatureEnabled(supabase as any, 'pharmacy-id', 'notifications')).toBe(false)
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

    expect(await isPharmacyFeatureEnabled(supabase as any, 'pharmacy-id', 'smart_reorder')).toBe(false)
  })
})

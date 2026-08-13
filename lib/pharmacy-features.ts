import type { SupabaseClient } from '@supabase/supabase-js'

export const PHARMACY_FEATURE_KEYS = [
  'packs_and_units',
  'staff_accounts',
  'customers',
  'credit_sales',
  'purchase_orders_and_receiving',
  'multi_branch',
  'notifications',
  'reservations',
  'stock_exchange',
  'price_benchmark',
  'whatsapp_receipts',
  'loyalty',
  'unmet_demand_widget',
  'smart_reorder',
  'quickbooks_export',
] as const

export type PharmacyFeatureKey = (typeof PHARMACY_FEATURE_KEYS)[number]

export type PharmacyFeatureStatus = 'available' | 'coming_soon' | 'hidden'

export const PHARMACY_FEATURE_STATUS = {
  packs_and_units: 'available',
  staff_accounts: 'coming_soon',
  customers: 'coming_soon',
  credit_sales: 'coming_soon',
  purchase_orders_and_receiving: 'available',
  multi_branch: 'hidden',
  notifications: 'coming_soon',
  reservations: 'available',
  stock_exchange: 'hidden',
  price_benchmark: 'coming_soon',
  whatsapp_receipts: 'coming_soon',
  loyalty: 'coming_soon',
  unmet_demand_widget: 'coming_soon',
  smart_reorder: 'coming_soon',
  quickbooks_export: 'available',
} as const satisfies Record<PharmacyFeatureKey, PharmacyFeatureStatus>

export function getPharmacyFeatureStatus(featureKey: PharmacyFeatureKey): PharmacyFeatureStatus {
  return PHARMACY_FEATURE_STATUS[featureKey]
}

export function isPharmacyFeatureAvailable(featureKey: PharmacyFeatureKey) {
  return getPharmacyFeatureStatus(featureKey) === 'available'
}

export const PHARMACY_FEATURE_PRESETS = {
  full_retail_shop: ['staff_accounts', 'customers', 'credit_sales', 'notifications'],
  multi_branch_owner: ['multi_branch', 'staff_accounts', 'notifications'],
  buying_and_stock: ['purchase_orders_and_receiving', 'smart_reorder', 'quickbooks_export'],
  just_the_basics: [],
} as const satisfies Record<string, readonly PharmacyFeatureKey[]>

export type PharmacyFeaturePreset = keyof typeof PHARMACY_FEATURE_PRESETS

export type PharmacyFeatureChange = {
  feature_key: PharmacyFeatureKey
  is_enabled: boolean
}

export function planPharmacyFeaturePreset(preset: PharmacyFeaturePreset): {
  changes: PharmacyFeatureChange[]
  skipped: PharmacyFeatureKey[]
} {
  if (preset === 'just_the_basics') {
    return {
      changes: PHARMACY_FEATURE_KEYS.map(feature_key => ({ feature_key, is_enabled: false })),
      skipped: [],
    }
  }

  const requested = PHARMACY_FEATURE_PRESETS[preset]
  return {
    changes: requested
      .filter(isPharmacyFeatureAvailable)
      .map(feature_key => ({ feature_key, is_enabled: true })),
    skipped: requested.filter(featureKey => !isPharmacyFeatureAvailable(featureKey)),
  }
}

export async function isPharmacyFeatureEnabled(
  supabase: SupabaseClient<any>,
  pharmacyId: string,
  featureKey: PharmacyFeatureKey,
) {
  if (!isPharmacyFeatureAvailable(featureKey)) return false

  const { data, error } = await supabase
    .from('pharmacy_features')
    .select('is_enabled')
    .eq('pharmacy_id', pharmacyId)
    .eq('feature_key', featureKey)
    .maybeSingle()

  return !error && data?.is_enabled === true
}

export async function requirePharmacyFeature(
  supabase: SupabaseClient<any>,
  pharmacyId: string,
  featureKey: PharmacyFeatureKey,
) {
  const enabled = await isPharmacyFeatureEnabled(supabase, pharmacyId, featureKey)
  return enabled
    ? null
    : {
        error: 'This feature is turned off.',
        code: 'FEATURE_DISABLED' as const,
        feature_key: featureKey,
      }
}

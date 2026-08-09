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

export const PHARMACY_FEATURE_PRESETS = {
  full_retail_shop: ['staff_accounts', 'customers', 'credit_sales', 'notifications'],
  multi_branch_owner: ['multi_branch', 'staff_accounts', 'notifications'],
  buying_and_stock: ['purchase_orders_and_receiving', 'smart_reorder', 'quickbooks_export'],
  just_the_basics: [],
} as const satisfies Record<string, readonly PharmacyFeatureKey[]>

export type PharmacyFeaturePreset = keyof typeof PHARMACY_FEATURE_PRESETS

export async function isPharmacyFeatureEnabled(
  supabase: SupabaseClient<any>,
  pharmacyId: string,
  featureKey: PharmacyFeatureKey,
) {
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

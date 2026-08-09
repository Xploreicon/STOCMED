import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

export const SP_ACTIONS = [
  'data_export',
  'large_discount',
  'price_change',
  'stock_adjustment',
  'void_or_refund',
  'delist_inventory',
  'restore_inventory',
  'pharmacy_settings',
  'staff_accounts',
  'financial_reports',
] as const

export type SpAction = (typeof SP_ACTIONS)[number]

export type StructuredRpcFailure = {
  success: false
  code: string | null
  error: string
}

export function getStructuredRpcFailure(
  value: unknown,
  fallback = 'The operation was rejected',
): StructuredRpcFailure | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const result = value as Record<string, unknown>
  if (result.success !== false) return null

  return {
    success: false,
    code: typeof result.code === 'string' && result.code ? result.code : null,
    error: typeof result.error === 'string' && result.error ? result.error : fallback,
  }
}

export async function getSpActionGate(
  supabase: SupabaseClient<any>,
  pharmacyId: string,
  action: SpAction,
): Promise<{ isGated: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from('pharmacy_sp_action_gates')
    .select('is_gated')
    .eq('pharmacy_id', pharmacyId)
    .eq('action_key', action)
    .maybeSingle()

  return {
    isGated: data?.is_gated === true,
    error: error?.message ?? null,
  }
}

export async function hasSpAuthorization(
  supabase: SupabaseClient<any>,
  pharmacyId: string,
  token: string | null,
  action: SpAction,
) {
  if (!token) return false
  const { data, error } = await supabase.rpc('validate_sp_authorization', {
    p_pharmacy_id: pharmacyId,
    p_token: token,
    p_action: action,
  })
  return !error && data === true
}

export async function auditSpAuthorization(
  supabase: SupabaseClient<any>,
  pharmacyId: string,
  token: string | null,
  action: SpAction,
  target: string,
) {
  const { data, error } = await supabase.rpc('verify_and_audit_sp_action', {
    p_pharmacy_id: pharmacyId,
    p_token: token,
    p_action: action,
    p_target_description: target,
  })
  return !error && data === true
}

export async function requireSpAuthorization(
  supabase: SupabaseClient<any>,
  pharmacyId: string,
  request: NextRequest,
  action: SpAction,
  target: string,
) {
  return auditSpAuthorization(
    supabase,
    pharmacyId,
    request.headers.get('x-sp-authorization'),
    action,
    target,
  )
}

export const SP_AUTH_REQUIRED_RESPONSE = {
  error: 'Superintendent authorization is required or has expired.',
  code: 'SP_AUTH_REQUIRED',
} as const

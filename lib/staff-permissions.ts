import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { isPharmacyFeatureEnabled } from '@/lib/pharmacy-features'
export type StaffPermission = 'can_sell' | 'can_adjust_stock' | 'can_view_reports' | 'can_change_prices' | 'can_refund'

export async function checkStaffPermission(
  supabase: SupabaseClient<any>,
  pharmacyId: string,
  request: NextRequest,
  permission: StaffPermission,
) {
  const enabled = await isPharmacyFeatureEnabled(supabase, pharmacyId, 'staff_accounts')
  if (!enabled) return { allowed: true, feature_enabled: false } as const

  const { data, error } = await supabase.rpc('authorize_staff_permission', {
    p_session_token: request.headers.get('x-staff-session') ?? '',
    p_permission: permission,
  })
  if (error) {
    return { allowed: false, code: 'STAFF_AUTH_FAILED', error: 'Staff access could not be checked.' } as const
  }
  return data as {
    allowed: boolean
    feature_enabled?: boolean
    staff_id?: string
    staff_name?: string
    code?: string
    error?: string
  }
}

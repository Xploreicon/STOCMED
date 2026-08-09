import 'server-only'
import { getAdminClient } from '@/lib/supabase/admin'

export type PharmacySpConfig = {
  configured: boolean
  failedAttempts: number
  lockedUntil: string | null
  discountThreshold: number
  graceMinutes: number
  requireFinancialReports: boolean
}

export async function getPharmacySpConfig(
  pharmacyId: string,
): Promise<{ data: PharmacySpConfig | null; error: string | null }> {
  const admin = getAdminClient()
  if (!admin) {
    return { data: null, error: 'SP configuration service is unavailable' }
  }

  const { data, error } = await (admin.rpc as any)(
    'get_internal_pharmacy_sp_config',
    { p_pharmacy_id: pharmacyId },
  )
  if (error) return { data: null, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { data: null, error: 'Pharmacy SP configuration was not found' }

  return {
    data: {
      configured: row.configured === true,
      failedAttempts: Number(row.failed_attempts ?? 0),
      lockedUntil: row.locked_until ?? null,
      discountThreshold: Number(row.discount_threshold ?? 10),
      graceMinutes: Number(row.grace_minutes ?? 5),
      requireFinancialReports: row.require_financial_reports !== false,
    },
    error: null,
  }
}

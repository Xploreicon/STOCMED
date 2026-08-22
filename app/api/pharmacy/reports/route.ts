import { NextRequest, NextResponse } from 'next/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'
import { reportQuerySchema } from '@/lib/validation/reporting'
import { getStructuredRpcFailure } from '@/lib/sp-authorization'
import { checkStaffPermission } from '@/lib/staff-permissions'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const parsed = reportQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const supabase = (await createClient()) as any
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })
  const isDashboardSummary = request.nextUrl.searchParams.get('summary') === 'true'

  if (!isDashboardSummary) {
    const staffAccess = await checkStaffPermission(supabase, pharmacy.id, request, 'can_view_reports')
    if (!staffAccess.allowed) return NextResponse.json({ error: staffAccess.error, code: staffAccess.code }, { status: 403 })
  }

  const to = parsed.data.to ?? new Date().toISOString().slice(0, 10)
  const from = parsed.data.from ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = isDashboardSummary
    ? await supabase.rpc('get_pharmacy_dashboard_summary', {
        p_pharmacy_id: pharmacy.id,
        p_from: from,
        p_to: to,
      })
    : await supabase.rpc('get_pharmacy_reports', {
        p_pharmacy_id: pharmacy.id,
        p_from: from,
        p_to: to,
        p_sp_token: request.headers.get('x-sp-authorization'),
      })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rpcFailure = getStructuredRpcFailure(data, 'Reports are unavailable')
  if (rpcFailure) {
    return NextResponse.json(
      { error: rpcFailure.error, ...(rpcFailure.code ? { code: rpcFailure.code } : {}) },
      { status: rpcFailure.code === 'SP_AUTH_REQUIRED' ? 403 : 409 },
    )
  }

  return NextResponse.json({ reports: data })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'
import { checkStaffPermission } from '@/lib/staff-permissions'

export async function GET(request: NextRequest) {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  const featureError = await requirePharmacyFeature(supabase, pharmacy.id, 'staff_accounts')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const staffAccess = await checkStaffPermission(supabase, pharmacy.id, request, 'can_view_reports')
  if (!staffAccess.allowed) return NextResponse.json({ error: staffAccess.error, code: staffAccess.code }, { status: 403 })
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10)
  const from = request.nextUrl.searchParams.get('from') || new Date(Date.now()-29*86_400_000).toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  const { data, error } = await supabase.rpc('get_staff_performance', { p_from: from, p_to: to })
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ report: data })
}

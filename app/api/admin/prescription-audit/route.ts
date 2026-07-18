import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: viewer } = await (supabase as any)
    .from('users')
    .select(`
      is_admin,admin_authorized_at,admin_authorization_basis,
      is_licensed_pharmacist,pharmacist_license_verified_at,pharmacist_license_verification_basis,
      is_stocmed_sp,stocmed_sp_authorized_at,stocmed_sp_authorization_basis
    `)
    .eq('user_id', user.id)
    .maybeSingle()
  const canReview = Boolean(
    viewer?.is_stocmed_sp
    && viewer?.stocmed_sp_authorized_at
    && viewer?.stocmed_sp_authorization_basis?.trim()
    && viewer?.is_licensed_pharmacist
    && viewer?.pharmacist_license_verified_at
    && viewer?.pharmacist_license_verification_basis?.trim()
  )
  const canAdminister = Boolean(
    viewer?.is_admin
    && viewer?.admin_authorized_at
    && viewer?.admin_authorization_basis?.trim()
  )
  if (!canAdminister && !canReview) {
    return NextResponse.json({ error: 'Oversight access denied' }, { status: 403 })
  }

  const { data: records, error } = await (supabase as any)
    .from('rx_audit_records')
    .select('id,submission_id,destination_pharmacy_id,product_name,requested_quantity,status,submitted_at,reviewed_at,review_notes,purge_after')
    .order('submitted_at', { ascending: false })
    .limit(250)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const pharmacyIds = Array.from(new Set((records ?? []).map((row: any) => row.destination_pharmacy_id)))
  const submissionIds = (records ?? []).map((row: any) => row.submission_id)
  const [{ data: pharmacies }, { data: accessLogs }] = await Promise.all([
    pharmacyIds.length
      ? (supabase as any).from('pharmacies').select('id,pharmacy_name').in('id', pharmacyIds)
      : Promise.resolve({ data: [] }),
    submissionIds.length
      ? (supabase as any).from('rx_document_access_logs').select('submission_id').in('submission_id', submissionIds)
      : Promise.resolve({ data: [] }),
  ])

  const pharmacyNames = new Map((pharmacies ?? []).map((row: any) => [row.id, row.pharmacy_name]))
  const accessCounts = new Map<string, number>()
  for (const log of accessLogs ?? []) {
    accessCounts.set(log.submission_id, (accessCounts.get(log.submission_id) ?? 0) + 1)
  }

  return NextResponse.json({
    records: (records ?? []).map((row: any) => ({
      ...row,
      pharmacy_name: pharmacyNames.get(row.destination_pharmacy_id) ?? 'Unknown pharmacy',
      access_count: accessCounts.get(row.submission_id) ?? 0,
    })),
    can_review: canReview,
  }, { headers: { 'Cache-Control': 'no-store, private' } })
}

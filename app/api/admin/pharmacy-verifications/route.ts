import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: viewer } = await (supabase as any)
    .from('users')
    .select('is_admin,admin_authorized_at,admin_authorization_basis')
    .eq('user_id', user.id)
    .maybeSingle()
  const isAuthorizedAdmin = Boolean(
    viewer?.is_admin
    && viewer?.admin_authorized_at
    && viewer?.admin_authorization_basis?.trim()
  )
  if (!isAuthorizedAdmin) {
    return NextResponse.json({ error: 'Pharmacy verification access denied' }, { status: 403 })
  }

  const { data, error } = await (supabase.rpc as any)('get_pharmacy_verification_queue')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const records = (data ?? []).map((row: any) => ({
    submission_id: row.id,
    pharmacy_id: row.pharmacy_id,
    pharmacy_name: row.pharmacy_name,
    license_number: row.license_number,
    verification_status: row.pharmacy_verification_status,
    provisional_expires_at: row.provisional_expires_at,
    standards_version: row.standards_version,
    standards_accepted_at: row.standards_accepted_at,
    submitted_at: row.submitted_at,
    decision: ['approved', 'rejected'].includes(row.status) ? row.status : null,
    reviewed_at: row.reviewed_at,
    review_basis: row.review_basis,
  }))

  return NextResponse.json({ records }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}

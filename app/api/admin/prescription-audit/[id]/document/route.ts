import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: viewer } = await (supabase as any)
    .from('users')
    .select(`
      is_admin,admin_authorized_at,admin_authorization_basis,
      is_stocmed_sp,stocmed_sp_authorized_at,stocmed_sp_authorization_basis,
      is_licensed_pharmacist,pharmacist_license_verified_at,pharmacist_license_verification_basis
    `)
    .eq('user_id', user.id)
    .maybeSingle()
  const canPerformClinicalReview = Boolean(
    viewer?.is_stocmed_sp
    && viewer?.stocmed_sp_authorized_at
    && viewer?.stocmed_sp_authorization_basis?.trim()
    && viewer?.is_licensed_pharmacist
    && viewer?.pharmacist_license_verified_at
    && viewer?.pharmacist_license_verification_basis?.trim()
  )
  const canPerformOversight = Boolean(
    viewer?.is_admin
    && viewer?.admin_authorized_at
    && viewer?.admin_authorization_basis?.trim()
  )
  if (!canPerformClinicalReview && !canPerformOversight) {
    return NextResponse.json({ error: 'Prescription access denied' }, { status: 403 })
  }

  const requestId = randomUUID()
  const accessContext = canPerformClinicalReview
    ? 'stocmed_clinical_review'
    : 'stocmed_oversight'
  const { data, error } = await (supabase.rpc as any)('authorize_and_log_rx_document_access', {
    p_submission_id: params.id,
    p_context: accessContext,
    p_request_id: requestId,
  })
  const access = Array.isArray(data) ? data[0] : data
  if (error || !access?.file_path) {
    return NextResponse.json({ error: error?.message ?? 'Oversight access denied' }, { status: 403 })
  }

  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Prescription service unavailable' }, { status: 503 })
  const { data: signed, error: signError } = await admin.storage
    .from('prescriptions')
    .createSignedUrl(access.file_path, 300)
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not open prescription document' }, { status: 500 })
  }

  return NextResponse.json({
    url: signed.signedUrl,
    expires_in: 300,
    request_id: requestId,
    access_context: accessContext,
  }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const decisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approve'),
    pharmacy_id: z.string().uuid(),
    documents_evidence_basis: z.string().trim().min(3).max(2000),
    standards_evidence_basis: z.string().trim().min(3).max(2000),
  }),
  z.object({
    decision: z.literal('reject'),
    pharmacy_id: z.string().uuid(),
    basis: z.string().trim().min(3).max(2000),
  }),
])

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const parsed = decisionSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'A complete, nonblank decision basis is required' }, { status: 400 })
  }

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
    return NextResponse.json({ error: 'Only a provenance-authorized administrator may decide pharmacy verification' }, { status: 403 })
  }

  const [{ data: submission }, { data: accessLogs }] = await Promise.all([
    (supabase as any)
      .from('pharmacy_verification_submissions')
      .select('id,pharmacy_id,submitted_at')
      .eq('id', params.id)
      .maybeSingle(),
    (supabase as any)
      .from('pharmacy_verification_document_access_logs')
      .select('document_kind')
      .eq('submission_id', params.id)
      .eq('viewer_user_id', user.id),
  ])
  if (!submission || submission.pharmacy_id !== parsed.data.pharmacy_id) {
    return NextResponse.json({ error: 'Verification submission does not match this pharmacy' }, { status: 409 })
  }
  const { data: latestSubmission } = await (supabase as any)
    .from('pharmacy_verification_submissions')
    .select('id')
    .eq('pharmacy_id', submission.pharmacy_id)
    .order('submitted_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!latestSubmission || latestSubmission.id !== submission.id) {
    return NextResponse.json({ error: 'Only the latest verification submission can be decided' }, { status: 409 })
  }
  const openedKinds = new Set((accessLogs ?? []).map((row: any) => row.document_kind))
  if (!openedKinds.has('premises_certificate') || !openedKinds.has('superintendent_annual_licence')) {
    return NextResponse.json({ error: 'Open both verification documents through the logged review action before deciding' }, { status: 409 })
  }

  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Verification service unavailable' }, { status: 503 })

  if (parsed.data.decision === 'approve') {
    const { data, error } = await (admin.rpc as any)('provision_full_pharmacy_verification', {
      p_pharmacy_id: parsed.data.pharmacy_id,
      p_documents_evidence_basis: parsed.data.documents_evidence_basis,
      p_standards_evidence_basis: parsed.data.standards_evidence_basis,
      p_authorizing_admin_id: user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 409 })
    return NextResponse.json({ pharmacy: data }, { headers: { 'Cache-Control': 'no-store, private' } })
  }

  const { data, error } = await (admin.rpc as any)('reject_pharmacy_verification_submission', {
    p_submission_id: params.id,
    p_basis: parsed.data.basis,
    p_authorizing_admin_id: user.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json({ pharmacy: data }, { headers: { 'Cache-Control': 'no-store, private' } })
}

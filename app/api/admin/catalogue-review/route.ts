import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'

export const dynamic = 'force-dynamic'

const queueTypes = new Set([
  'existing_identity_enrichment',
  'candidate_new_identity',
  'ambiguous_conflicting_match',
  'non_human_non_medicine_scope',
])
const decisionStatuses = new Set(['pending', 'approved', 'rejected', 'held'])

export async function GET(request: NextRequest) {
  const access = await getAuthorizedAdmin()
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const params = request.nextUrl.searchParams
  const queueType = params.get('bucket') || 'existing_identity_enrichment'
  const status = params.get('status') || 'pending'
  const search = params.get('search')?.trim() || null
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(params.get('limit') || '25', 10) || 25))

  if (queueType !== 'all' && !queueTypes.has(queueType)) {
    return NextResponse.json({ error: 'Invalid reconciliation bucket' }, { status: 400 })
  }
  if (status !== 'all' && !decisionStatuses.has(status)) {
    return NextResponse.json({ error: 'Invalid decision status' }, { status: 400 })
  }

  const { data, error } = await (access.supabase.rpc as any)(
    'get_catalogue_reconciliation_review',
    {
      p_queue_type: queueType === 'all' ? null : queueType,
      p_decision_status: status === 'all' ? null : status,
      p_search: search,
      p_limit: limit,
      p_offset: (page - 1) * limit,
    },
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}

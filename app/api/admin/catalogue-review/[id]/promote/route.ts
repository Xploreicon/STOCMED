import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const access = await getAuthorizedAdmin()
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const queueId = z.string().uuid().safeParse(params.id)
  if (!queueId.success) {
    return NextResponse.json({ error: 'Invalid catalogue review id' }, { status: 400 })
  }

  const { data, error } = await (access.supabase.rpc as any)(
    'promote_catalogue_reconciliation_candidate',
    { p_queue_id: queueId.data },
  )
  if (error) {
    const status = error.message?.includes('approved') || error.message?.includes('blocked')
      ? 409
      : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, private' } })
}

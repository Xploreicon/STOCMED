import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import { getAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getAuthorizedAdmin()
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status })
  if (!z.string().uuid().safeParse(params.id).success) {
    return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
  }
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Broadcast service unavailable' }, { status: 503 })
  const [{ data: broadcast, error }, { data: recipients, error: recipientError }] = await Promise.all([
    (admin as any).from('broadcasts').select('*').eq('id', params.id).maybeSingle(),
    (admin as any).from('broadcast_recipients')
      .select('id,recipient_email,display_name,pharmacy_id,delivery_status,provider_status,last_error,unsubscribed_at,sent_at,delivered_at,created_at')
      .eq('broadcast_id', params.id)
      .order('created_at')
      .limit(2000),
  ])
  if (error || recipientError) return NextResponse.json({ error: 'Could not load the broadcast' }, { status: 500 })
  if (!broadcast) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
  return NextResponse.json({ broadcast, recipients: recipients || [] }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}

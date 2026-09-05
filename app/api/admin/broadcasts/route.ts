import { NextRequest, NextResponse } from 'next/server'
import { broadcastComposeSchema } from '@/lib/admin/broadcast-schema'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import { queueBroadcast } from '@/lib/admin/broadcast-queue'
import { resolveBroadcastAudience } from '@/lib/admin/broadcast-server'
import {
  classifyAdminBroadcastError,
  getEmailDeliveryConfiguration,
} from '@/lib/notifications/email-configuration'
import { getAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const viewer = await getAuthorizedAdmin()
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status })
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Broadcast service unavailable' }, { status: 503 })
  const { data, error } = await (admin as any)
    .from('broadcasts')
    .select('id,subject,template,status,scheduled_at,recipient_count,sent_count,delivered_count,failed_count,created_at,completed_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: 'Could not load broadcast history' }, { status: 500 })
  return NextResponse.json({ broadcasts: data || [] }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}

export async function POST(request: NextRequest) {
  const viewer = await getAuthorizedAdmin()
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status })
  const parsed = broadcastComposeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Check the broadcast' }, { status: 400 })
  }
  const configuration = getEmailDeliveryConfiguration()
  if (!configuration.ready) {
    console.error('Admin broadcast configuration is incomplete:', configuration.issues)
    return NextResponse.json({
      error: 'Email delivery is not configured for production',
      code: 'EMAIL_DELIVERY_NOT_CONFIGURED',
    }, { status: 503 })
  }
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Broadcast service unavailable' }, { status: 503 })
  try {
    const recipients = await resolveBroadcastAudience(viewer.user.id, parsed.data.audience)
    if (!recipients.length) {
      return NextResponse.json({ error: 'No subscribed recipients match this audience' }, { status: 400 })
    }
    const result = await queueBroadcast({
      actorId: viewer.user.id,
      compose: parsed.data,
      recipients,
    })
    return NextResponse.json({
      broadcast_id: result.broadcastId,
      recipient_count: result.recipientCount,
      suppressed_count: result.suppressedCount,
      status: result.status,
    }, { status: 201 })
  } catch (error) {
    console.error('Could not queue broadcast:', error)
    if (error instanceof Error && error.message === 'Choose a valid send time') {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    const failure = classifyAdminBroadcastError(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}

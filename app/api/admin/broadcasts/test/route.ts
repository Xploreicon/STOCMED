import { NextRequest, NextResponse } from 'next/server'
import { broadcastTestSchema } from '@/lib/admin/broadcast-schema'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import { queueBroadcast } from '@/lib/admin/broadcast-queue'
import { deliverQueuedEmail } from '@/lib/notifications/email'
import {
  classifyAdminBroadcastError,
  getEmailDeliveryConfiguration,
} from '@/lib/notifications/email-configuration'
import { finishDelivery, underGlobalChannelCap } from '@/lib/notifications/core'
import { getAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const viewer = await getAuthorizedAdmin()
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status })
  const parsed = broadcastTestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Check the test email' }, { status: 400 })
  }
  const email = viewer.user.email?.trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'Your admin account has no email address' }, { status: 400 })
  const configuration = getEmailDeliveryConfiguration()
  if (!configuration.ready) {
    console.error('Admin test email configuration is incomplete:', configuration.issues)
    return NextResponse.json({
      error: 'Email delivery is not configured for production',
      code: 'EMAIL_DELIVERY_NOT_CONFIGURED',
    }, { status: 503 })
  }
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Broadcast service unavailable' }, { status: 503 })

  try {
    const compose = {
      ...parsed.data,
      subject: `[TEST] ${parsed.data.subject}`.slice(0, 200),
      audience: { kind: 'individual_user' as const, user_id: viewer.user.id },
      scheduled_at: null,
    }
    const queued = await queueBroadcast({
      actorId: viewer.user.id,
      compose,
      recipients: [{
        user_id: viewer.user.id,
        pharmacy_id: null,
        email,
        display_name: viewer.user.user_metadata?.full_name || 'StocMed admin',
      }],
    })
    if (queued.recipientCount !== 1) {
      return NextResponse.json({ error: 'Your account is unsubscribed from broadcasts' }, { status: 409 })
    }

    const { data: recipient, error: recipientError } = await (admin as any)
      .from('broadcast_recipients')
      .select('notification_delivery_id')
      .eq('broadcast_id', queued.broadcastId)
      .eq('user_id', viewer.user.id)
      .single()
    if (recipientError || !recipient?.notification_delivery_id) throw recipientError || new Error('Test delivery not found')
    const { data: delivery, error: deliveryError } = await (admin as any)
      .from('notification_deliveries')
      .select('*')
      .eq('id', recipient.notification_delivery_id)
      .single()
    if (deliveryError || !delivery) throw deliveryError || new Error('Test delivery not found')

    if (!await underGlobalChannelCap('email')) {
      await finishDelivery(delivery.id, { status: 'skipped', error: 'Daily email safety cap reached' })
      return NextResponse.json({ error: 'Daily email safety cap reached' }, { status: 429 })
    }

    const result = await deliverQueuedEmail(delivery)
    return NextResponse.json({
      broadcast_id: queued.broadcastId,
      recipient_count: 1,
      delivery_status: result.status,
    }, { status: result.status === 'sent' ? 200 : 502 })
  } catch (error) {
    console.error('Could not send admin test email:', error)
    const failure = classifyAdminBroadcastError(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}

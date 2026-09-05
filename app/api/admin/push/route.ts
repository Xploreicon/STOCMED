import { NextRequest, NextResponse } from 'next/server'
import { pushComposeSchema } from '@/lib/admin/broadcast-schema'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import { resolvePushAudience } from '@/lib/admin/broadcast-server'
import { createOutboxDelivery, finishDelivery, underGlobalChannelCap } from '@/lib/notifications/core'
import { getAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const viewer = await getAuthorizedAdmin()
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status })
  const parsed = pushComposeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Check the push notification' }, { status: 400 })
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Push service unavailable' }, { status: 503 })
  if (
    !process.env.NOTIFICATION_HASH_PEPPER
    || !process.env.VAPID_PRIVATE_KEY
    || !(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY)
  ) {
    return NextResponse.json({ error: 'Push provider configuration is incomplete' }, { status: 503 })
  }

  try {
    const recipients = await resolvePushAudience(viewer.user.id, parsed.data.audience)
    if (!recipients.length) return NextResponse.json({ error: 'No subscribed users match this audience' }, { status: 400 })
    const userIds = recipients.map(recipient => recipient.user_id)
    const subscriptions: any[] = []
    for (let index = 0; index < userIds.length; index += 200) {
      const { data, error } = await (admin as any).from('push_subscriptions')
        .select('id,user_id,endpoint,p256dh,auth_key')
        .in('user_id', userIds.slice(index, index + 200))
      if (error) throw error
      subscriptions.push(...(data || []))
    }

    const recipientsById = new Map(recipients.map(recipient => [recipient.user_id, recipient]))
    let queued = 0
    let duplicate = 0
    let skipped = 0
    let failed = 0
    for (const subscription of subscriptions) {
      try {
        const recipient = recipientsById.get(subscription.user_id)
        const result = await createOutboxDelivery({
          channel: 'push',
          provider: 'web_push',
          type: 'admin_push',
          recipient: subscription.endpoint,
          idempotencyKey: `admin-push:${parsed.data.request_id}:${subscription.id}`,
          userId: subscription.user_id,
          pharmacyId: recipient?.pharmacy_id || undefined,
          payload: {
            subscriptionId: subscription.id,
            p256dh: subscription.p256dh,
            auth: subscription.auth_key,
            title: parsed.data.title,
            body: parsed.data.body,
            href: parsed.data.href,
            tag: `admin-push:${parsed.data.request_id}`,
            consent: 'active_push_subscription',
          },
        })
        if (result.duplicate) duplicate += 1
        else if (!await underGlobalChannelCap('push')) {
          await finishDelivery(result.delivery.id, { status: 'skipped', error: 'Daily push safety cap reached' })
          skipped += 1
        } else queued += 1
      } catch (error) {
        console.error('Could not queue push subscription:', error)
        failed += 1
      }
    }

    return NextResponse.json({
      recipient_count: recipients.length,
      subscription_count: subscriptions.length,
      queued,
      duplicate,
      skipped,
      failed,
    }, { status: 201 })
  } catch (error) {
    console.error('Could not queue admin push:', error)
    return NextResponse.json({ error: 'The push notification could not be queued' }, { status: 500 })
  }
}

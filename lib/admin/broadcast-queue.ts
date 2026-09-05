import 'server-only'
import type { BroadcastCompose } from '@/lib/admin/broadcast-schema'
import type { BroadcastRecipient } from '@/lib/admin/broadcast-server'
import { renderBroadcastEmail } from '@/lib/email/broadcast'
import { hashRecipient } from '@/lib/notifications/core'
import { createScopedUnsubscribeToken } from '@/lib/notifications/unsubscribe'
import { getAdminClient } from '@/lib/supabase/admin'

export async function queueBroadcast(input: {
  actorId: string
  compose: BroadcastCompose
  recipients: BroadcastRecipient[]
}) {
  const admin = getAdminClient()
  if (!admin) throw new Error('Broadcast service unavailable')
  if (!input.recipients.length) throw new Error('No subscribed recipients match this audience')

  const now = new Date()
  const scheduledAt = input.compose.scheduled_at ? new Date(input.compose.scheduled_at) : now
  if (Number.isNaN(scheduledAt.getTime())) throw new Error('Choose a valid send time')
  let broadcastId: string | null = null

  try {
    const { data: broadcast, error: createError } = await (admin as any)
      .from('broadcasts')
      .insert({
        subject: input.compose.subject,
        body_markdown: input.compose.body_markdown,
        body_format: input.compose.body_format,
        template: input.compose.template,
        audience: input.compose.audience,
        status: scheduledAt > now ? 'scheduled' : 'draft',
        scheduled_at: scheduledAt.toISOString(),
        created_by: input.actorId,
      })
      .select('id')
      .single()
    if (createError || !broadcast) throw createError || new Error('Broadcast was not created')
    broadcastId = broadcast.id

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://askstocmed.com').replace(/\/$/, '')
    const queueRows = input.recipients.map(recipient => {
      const token = createScopedUnsubscribeToken(recipient.user_id, 'broadcast')
      const unsubscribeUrl = `${siteUrl}/u/${encodeURIComponent(token)}`
      const rendered = renderBroadcastEmail({
        subject: input.compose.subject,
        bodyMarkdown: input.compose.body_markdown,
        bodyFormat: input.compose.body_format,
        template: input.compose.template,
        unsubscribeUrl,
      })
      return {
        user_id: recipient.user_id,
        pharmacy_id: recipient.pharmacy_id,
        email: recipient.email.toLowerCase(),
        display_name: recipient.display_name,
        recipient_hash: hashRecipient(recipient.email),
        idempotency_key: `broadcast:${broadcast.id}:${recipient.user_id}`,
        send_after: scheduledAt.toISOString(),
        payload: {
          ...rendered,
          unsubscribeUrl,
          oneClickUnsubscribe: true,
          broadcastId: broadcast.id,
        },
      }
    })

    let queued = 0
    let suppressed = 0
    for (let index = 0; index < queueRows.length; index += 100) {
      const { data, error } = await (admin as any).rpc('queue_admin_broadcast_recipients', {
        p_actor_id: input.actorId,
        p_broadcast_id: broadcast.id,
        p_rows: queueRows.slice(index, index + 100),
      })
      if (error) throw error
      queued += Number(data?.queued || 0)
      suppressed += Number(data?.suppressed || 0)
    }

    return {
      broadcastId: broadcast.id as string,
      recipientCount: queued,
      suppressedCount: suppressed,
      status: scheduledAt > now ? 'scheduled' as const : 'queued' as const,
    }
  } catch (error) {
    if (broadcastId) {
      await (admin as any).from('broadcasts').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', broadcastId)
    }
    throw error
  }
}

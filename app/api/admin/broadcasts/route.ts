import { NextRequest, NextResponse } from 'next/server'
import { broadcastComposeSchema } from '@/lib/admin/broadcast-schema'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import { resolveBroadcastAudience } from '@/lib/admin/broadcast-server'
import { renderBroadcastEmail } from '@/lib/email/broadcast'
import { hashRecipient } from '@/lib/notifications/core'
import { createScopedUnsubscribeToken } from '@/lib/notifications/unsubscribe'
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
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Broadcast service unavailable' }, { status: 503 })
  let broadcastId: string | null = null

  try {
    const recipients = await resolveBroadcastAudience(viewer.user.id, parsed.data.audience)
    if (!recipients.length) {
      return NextResponse.json({ error: 'No subscribed recipients match this audience' }, { status: 400 })
    }
    const now = new Date()
    const scheduledAt = parsed.data.scheduled_at ? new Date(parsed.data.scheduled_at) : now
    if (Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: 'Choose a valid send time' }, { status: 400 })
    }
    const { data: broadcast, error: createError } = await (admin as any)
      .from('broadcasts')
      .insert({
        subject: parsed.data.subject,
        body_markdown: parsed.data.body_markdown,
        template: parsed.data.template,
        audience: parsed.data.audience,
        status: scheduledAt > now ? 'scheduled' : 'draft',
        scheduled_at: scheduledAt.toISOString(),
        created_by: viewer.user.id,
      })
      .select('id')
      .single()
    if (createError || !broadcast) throw createError || new Error('Broadcast was not created')
    broadcastId = broadcast.id

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://askstocmed.com').replace(/\/$/, '')
    const queueRows = recipients.map(recipient => {
      const token = createScopedUnsubscribeToken(recipient.user_id, 'broadcast')
      const unsubscribeUrl = `${siteUrl}/u/${encodeURIComponent(token)}`
      const rendered = renderBroadcastEmail({
        subject: parsed.data.subject,
        bodyMarkdown: parsed.data.body_markdown,
        template: parsed.data.template,
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
        payload: { ...rendered, unsubscribeUrl, broadcastId: broadcast.id },
      }
    })

    let queued = 0
    let suppressed = 0
    for (let index = 0; index < queueRows.length; index += 100) {
      const { data, error } = await (admin as any).rpc('queue_admin_broadcast_recipients', {
        p_actor_id: viewer.user.id,
        p_broadcast_id: broadcast.id,
        p_rows: queueRows.slice(index, index + 100),
      })
      if (error) throw error
      queued += Number(data?.queued || 0)
      suppressed += Number(data?.suppressed || 0)
    }
    return NextResponse.json({
      broadcast_id: broadcast.id,
      recipient_count: queued,
      suppressed_count: suppressed,
      status: scheduledAt > now ? 'scheduled' : 'queued',
    }, { status: 201 })
  } catch (error) {
    console.error('Could not queue broadcast:', error)
    if (broadcastId) {
      await (admin as any).from('broadcasts').update({
        status: 'failed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', broadcastId)
    }
    return NextResponse.json({ error: 'The broadcast could not be queued' }, { status: 500 })
  }
}

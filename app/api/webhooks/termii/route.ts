import { NextRequest, NextResponse } from 'next/server'
import {
  sha256Hex,
  termiiWebhookEventId,
  verifyTermiiWebhook,
} from '@/lib/notifications/webhook-security'
import { getAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const payload = await request.text()
  if (!verifyTermiiWebhook({
    payload,
    secret: process.env.TERMII_WEBHOOK_SECRET,
    signature: request.headers.get('x-termii-signature'),
  })) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  let event: {
    message_id?: string
    id?: string
    status?: string
    cost?: string | number
  }
  try {
    event = JSON.parse(payload)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const messageId = event.message_id || event.id
  if (!messageId) return NextResponse.json({ received: true })

  const normalizedStatus = String(event.status || '').toLowerCase()
  const status = normalizedStatus.includes('delivered')
    ? 'delivered'
    : normalizedStatus.includes('failed') || normalizedStatus.includes('rejected') || normalizedStatus.includes('expired')
      ? 'failed'
      : 'sent'
  const admin = getAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Webhook service unavailable' }, { status: 503 })
  }
  const numericCost = event.cost == null ? null : Number(event.cost)
  const { data, error } = await (admin as any).rpc('record_notification_provider_event_once', {
    p_provider: 'termii',
    p_event_id: termiiWebhookEventId(payload, request.headers.get('x-termii-event-id')),
    p_payload_sha256: sha256Hex(payload),
    p_provider_message_id: String(messageId),
    p_status: status,
    p_provider_status: event.status || null,
    p_cost: numericCost != null && Number.isFinite(numericCost) ? numericCost : null,
  })
  if (error) {
    console.error('Could not record Termii webhook:', error)
    return NextResponse.json({ error: 'Could not record provider event' }, { status: 500 })
  }
  if (data === 'replay') {
    return NextResponse.json({ error: 'Replay rejected' }, { status: 409 })
  }
  return NextResponse.json({ received: true })
}

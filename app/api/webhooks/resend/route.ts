import { NextRequest, NextResponse } from 'next/server'
import { sha256Hex, verifyResendWebhook } from '@/lib/notifications/webhook-security'
import { getAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const payload = await request.text()
  const eventId = request.headers.get('svix-id')
  if (!verifyResendWebhook({
    payload,
    secret: process.env.RESEND_WEBHOOK_SECRET,
    id: eventId,
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  })) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  let event: { type?: string; data?: { email_id?: string } }
  try {
    event = JSON.parse(payload)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const emailId = event.data?.email_id
  if (!emailId) return NextResponse.json({ received: true })

  const status = event.type === 'email.delivered'
    ? 'delivered'
    : ['email.failed', 'email.bounced', 'email.complained', 'email.suppressed'].includes(event.type || '')
      ? 'failed'
      : 'sent'
  const admin = getAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Webhook service unavailable' }, { status: 503 })
  }
  const { data, error } = await (admin as any).rpc('record_notification_provider_event_once', {
    p_provider: 'resend',
    p_event_id: eventId,
    p_payload_sha256: sha256Hex(payload),
    p_provider_message_id: emailId,
    p_status: status,
    p_provider_status: event.type || null,
    p_cost: null,
  })
  if (error) {
    console.error('Could not record Resend webhook:', error)
    return NextResponse.json({ error: 'Could not record provider event' }, { status: 500 })
  }
  if (data === 'replay') {
    return NextResponse.json({ error: 'Replay rejected' }, { status: 409 })
  }
  return NextResponse.json({ received: true })
}

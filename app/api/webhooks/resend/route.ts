import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'

function verifySvix(payload: string, request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  const id = request.headers.get('svix-id')
  const timestamp = request.headers.get('svix-timestamp')
  const supplied = request.headers.get('svix-signature')
  if (!secret || !id || !timestamp || !supplied) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest()
  return supplied.split(' ').some(item => {
    const encoded = item.startsWith('v1,') ? item.slice(3) : ''
    if (!encoded) return false
    const actual = Buffer.from(encoded, 'base64')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  })
}

export async function POST(request: NextRequest) {
  const payload = await request.text()
  if (!verifySvix(payload, request)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  const event = JSON.parse(payload) as { type?: string; data?: { email_id?: string } }
  const emailId = event.data?.email_id
  if (!emailId) return NextResponse.json({ received: true })

  const status = event.type === 'email.delivered'
    ? 'delivered'
    : ['email.failed', 'email.bounced', 'email.complained', 'email.suppressed'].includes(event.type || '')
      ? 'failed'
      : 'sent'
  const admin = getAdminClient()
  if (admin) {
    await (admin as any).rpc('record_notification_provider_event', {
      p_provider: 'resend',
      p_provider_message_id: emailId,
      p_status: status,
      p_provider_status: event.type || null,
      p_cost: null,
    })
  }
  return NextResponse.json({ received: true })
}

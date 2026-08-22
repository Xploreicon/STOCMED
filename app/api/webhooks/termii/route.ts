import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'

function validSignature(payload: string, supplied: string | null) {
  const secret = process.env.TERMII_WEBHOOK_SECRET
  if (!secret || !supplied) return false
  const digest = createHmac('sha512', secret).update(payload).digest()
  const candidates = [
    Buffer.from(supplied, 'hex'),
    Buffer.from(supplied, 'base64'),
  ]
  return candidates.some(candidate =>
    candidate.length === digest.length && timingSafeEqual(candidate, digest),
  )
}

export async function POST(request: NextRequest) {
  const payload = await request.text()
  if (!validSignature(payload, request.headers.get('x-termii-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  const event = JSON.parse(payload) as {
    message_id?: string
    id?: string
    status?: string
    cost?: string | number
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
  if (admin) {
    await (admin as any).rpc('record_notification_provider_event', {
      p_provider: 'termii',
      p_provider_message_id: String(messageId),
      p_status: status,
      p_provider_status: event.status || null,
      p_cost: event.cost == null ? null : Number(event.cost),
    })
  }
  return NextResponse.json({ received: true })
}

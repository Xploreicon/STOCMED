import 'server-only'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  claimDelivery,
  createOutboxDelivery,
  finishDelivery,
  underGlobalChannelCap,
} from '@/lib/notifications/core'
import { normalizeNigerianPhone, toTermiiPhone } from '@/lib/notifications/phone'

export type SmsType =
  | 'reservation_patient'
  | 'reservation_pharmacy'
  | 'reservation_reminder'
  | 'stock_digest'

type SendSmsInput = {
  to: string
  message: string
  type: SmsType
  idempotencyKey: string
  consent: 'reservation_transaction' | 'explicit'
  pharmacyId?: string
  userId?: string
}

async function underPharmacyCap(pharmacyId?: string) {
  if (!pharmacyId) return true
  const admin = getAdminClient()
  if (!admin) return false
  const { data: preferences } = await (admin.from('pharmacy_notification_preferences') as any)
    .select('daily_sms_cap')
    .eq('pharmacy_id', pharmacyId)
    .maybeSingle()
  const cap = preferences?.daily_sms_cap ?? 10
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { count } = await (admin.from('notification_deliveries') as any)
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'sms')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', since.toISOString())
    .in('status', ['queued', 'sending', 'retry', 'sent', 'delivered'])
  // The just-created outbox row is included in this count.
  return (count ?? cap + 1) <= cap
}

export async function deliverQueuedSms(delivery: any) {
  const claimed = await claimDelivery(delivery.id)
  if (!claimed) return { status: delivery.status, duplicate: true }

  const apiKey = process.env.TERMII_API_KEY
  const sender = process.env.TERMII_SENDER_ID
  const baseUrl = (process.env.TERMII_BASE_URL || 'https://api.ng.termii.com').replace(/\/$/, '')
  if (!apiKey || !sender) {
    await finishDelivery(claimed.id, {
      status: 'skipped',
      error: 'Termii is not configured',
    })
    return { status: 'skipped' as const }
  }

  try {
    const response = await fetch(`${baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        to: toTermiiPhone(claimed.recipient),
        from: sender,
        sms: claimed.payload.message,
        type: 'plain',
        channel: 'dnd',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.code !== 'ok') {
      const retryable = response.status === 429
      await finishDelivery(claimed.id, {
        status: retryable ? 'retry' : 'failed',
        error: body.message || `Termii returned ${response.status}`,
        retryAt: retryable
          ? new Date(Date.now() + 15 * 60_000).toISOString()
          : undefined,
      })
      return { status: retryable ? 'retry' as const : 'failed' as const }
    }
    await finishDelivery(claimed.id, {
      status: 'sent',
      providerMessageId: String(body.message_id_str || body.message_id),
      providerStatus: body.message || 'Message Sent',
      cost: process.env.TERMII_ESTIMATED_COST_PER_SMS
        ? Number(process.env.TERMII_ESTIMATED_COST_PER_SMS)
        : null,
    })
    return { status: 'sent' as const, messageId: body.message_id_str || body.message_id }
  } catch (error) {
    // Termii does not expose an idempotency key. A timeout after the request
    // leaves acceptance ambiguous, so automatic retry could double-send.
    await finishDelivery(claimed.id, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Termii request failed',
    })
    return { status: 'failed' as const }
  }
}

export async function sendSMS(input: SendSmsInput) {
  const recipient = normalizeNigerianPhone(input.to)
  if (input.message.length === 0 || input.message.length > 480) {
    throw new Error('SMS message must be between 1 and 480 characters')
  }

  const { delivery, duplicate } = await createOutboxDelivery({
    channel: 'sms',
    provider: 'termii',
    type: input.type,
    recipient,
    idempotencyKey: input.idempotencyKey,
    pharmacyId: input.pharmacyId,
    userId: input.userId,
    payload: { message: input.message, consent: input.consent },
  })
  if (duplicate || ['sent', 'delivered'].includes(delivery.status)) {
    return { status: delivery.status, duplicate: true }
  }

  if (!await underGlobalChannelCap('sms') || !await underPharmacyCap(input.pharmacyId)) {
    await finishDelivery(delivery.id, { status: 'skipped', error: 'Daily SMS safety cap reached' })
    return { status: 'skipped' as const }
  }
  return deliverQueuedSms(delivery)
}

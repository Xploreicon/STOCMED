import 'server-only'
import { createHash } from 'crypto'
import { getAdminClient } from '@/lib/supabase/admin'

export type NotificationChannel = 'email' | 'sms'
export type NotificationProvider = 'resend' | 'termii'

export function hashRecipient(recipient: string) {
  const pepper = process.env.NOTIFICATION_HASH_PEPPER
  if (!pepper) throw new Error('NOTIFICATION_HASH_PEPPER is not configured')
  return createHash('sha256')
    .update(`${pepper}:${recipient.trim().toLowerCase()}`)
    .digest('hex')
}

export async function createOutboxDelivery(input: {
  channel: NotificationChannel
  provider: NotificationProvider
  type: string
  recipient: string
  idempotencyKey: string
  pharmacyId?: string
  userId?: string
  payload: Record<string, unknown>
}) {
  const admin = getAdminClient()
  if (!admin) throw new Error('Notification database is not configured')

  const { data, error } = await (admin as any).rpc('enqueue_notification_delivery', {
    p_notification_id: null,
    p_channel: input.channel,
    p_provider: input.provider,
    p_idempotency_key: input.idempotencyKey,
    p_legacy: {
      notification_type: input.type,
      recipient: input.recipient,
      recipient_hash: hashRecipient(input.recipient),
      pharmacy_id: input.pharmacyId ?? null,
      user_id: input.userId ?? null,
      payload: input.payload,
      // The unaudited provider dispatcher still claims queued/retry rows.
      status: 'queued',
    },
  })
  if (error) throw error
  return data as {
    delivery: { id: string; status: string; [key: string]: unknown }
    duplicate: boolean
  }
}

export async function claimDelivery(id: string) {
  const admin = getAdminClient()
  if (!admin) return null
  const { data } = await (admin as any).rpc('claim_notification_delivery', {
    p_delivery_id: id,
  })
  return data ?? null
}

export async function finishDelivery(
  id: string,
  update: {
    status: 'sent' | 'delivered' | 'retry' | 'failed' | 'skipped'
    providerMessageId?: string
    providerStatus?: string
    cost?: number | null
    error?: string
    retryAt?: string
  },
) {
  const admin = getAdminClient()
  if (!admin) return
  await (admin as any).rpc('finish_notification_delivery', {
    p_delivery_id: id,
    p_result: {
      status: update.status,
      provider_message_id: update.providerMessageId ?? null,
      provider_status: update.providerStatus ?? null,
      cost: update.cost ?? null,
      error: update.error?.slice(0, 500) ?? null,
      retry_at: update.retryAt ?? new Date().toISOString(),
    },
  })
}

export async function underGlobalChannelCap(channel: NotificationChannel) {
  const admin = getAdminClient()
  if (!admin) return false
  const cap = channel === 'sms'
    ? Number(process.env.GLOBAL_DAILY_SMS_CAP || 500)
    : Number(process.env.GLOBAL_DAILY_EMAIL_CAP || 2000)
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { count } = await (admin.from('notification_deliveries') as any)
    .select('id', { count: 'exact', head: true })
    .eq('channel', channel)
    .gte('created_at', since.toISOString())
    .in('status', ['queued', 'sending', 'retry', 'sent', 'delivered'])
  // The just-created outbox row is included in this count.
  return (count ?? cap + 1) <= cap
}

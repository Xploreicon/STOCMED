import 'server-only'

import { getAdminClient } from '@/lib/supabase/admin'
import { hashRecipient } from '@/lib/notifications/core'
import { normalizeNigerianPhone } from '@/lib/notifications/phone'
import { escapeEmailHtml, renderBrandedEmail } from '@/lib/email/template'

type DeliveryChoices = {
  email?: boolean
  sms?: boolean
}

type QueueNotificationInput = {
  eventKey: string
  recipientType: 'patient' | 'pharmacist'
  recipientId: string
  type: string
  title: string
  body: string
  pharmacyId?: string
  data?: Record<string, unknown>
  choices?: DeliveryChoices
  email?: string | null
  phone?: string | null
  smsBody?: string
  dailyEmailCap?: number
  dailySmsCap?: number
}

function startOfTodayUtc() {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  return date.toISOString()
}

async function pharmacyChannelHasRoom(
  pharmacyId: string | undefined,
  channel: 'email' | 'sms',
  cap: number | undefined,
) {
  if (!pharmacyId || !cap) return true
  const admin = getAdminClient()
  if (!admin) return false
  const { count } = await (admin.from('notification_deliveries') as any)
    .select('id', { count: 'exact', head: true })
    .eq('pharmacy_id', pharmacyId)
    .eq('channel', channel)
    .gte('created_at', startOfTodayUtc())
    .in('status', ['pending', 'queued', 'sending', 'retry', 'sent', 'delivered'])
  return (count ?? cap) < cap
}

export async function queueNotification(input: QueueNotificationInput) {
  const admin = getAdminClient()
  if (!admin) return { queued: false, reason: 'database_not_configured' as const }

  const deliveries: Array<Record<string, unknown>> = []
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://askstocmed.com'
  const settingsUrl = input.recipientType === 'pharmacist'
    ? `${siteUrl}/pharmacy/settings/notifications`
    : `${siteUrl}/settings`

  if (
    input.choices?.email && input.email && process.env.RESEND_API_KEY &&
    process.env.RESEND_FROM_EMAIL && process.env.NOTIFICATION_HASH_PEPPER &&
    await pharmacyChannelHasRoom(input.pharmacyId, 'email', input.dailyEmailCap)
  ) {
    const recipient = input.email.trim().toLowerCase()
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      const rendered = renderBrandedEmail({
        subject: input.title,
        preheader: input.body,
        eyebrow: 'StocMed notification',
        heading: input.title,
        bodyHtml: `<p style="margin:0">${escapeEmailHtml(input.body).replaceAll('\n', '<br>')}</p>`,
        bodyText: input.body,
        cta: { label: 'Manage notification choices', href: settingsUrl },
        reason: 'You received this notification because it is enabled in your StocMed notification settings.',
      })
      deliveries.push({
        channel: 'email',
        provider: 'resend',
        idempotency_key: `${input.eventKey}:email`,
        recipient,
        recipient_hash: hashRecipient(recipient),
        payload: {
          ...rendered,
          settingsUrl,
          consent: 'explicit',
        },
      })
    }
  }

  if (
    input.choices?.sms && input.phone && process.env.TERMII_API_KEY &&
    process.env.TERMII_SENDER_ID && process.env.NOTIFICATION_HASH_PEPPER &&
    await pharmacyChannelHasRoom(input.pharmacyId, 'sms', input.dailySmsCap)
  ) {
    try {
      const recipient = normalizeNigerianPhone(input.phone)
      deliveries.push({
        channel: 'sms',
        provider: 'termii',
        idempotency_key: `${input.eventKey}:sms`,
        recipient,
        recipient_hash: hashRecipient(recipient),
        payload: {
          message: (input.smsBody || input.body).slice(0, 480),
          consent: 'explicit',
        },
      })
    } catch {
      // An invalid optional phone never blocks the in-app event.
    }
  }

  const { data, error } = await (admin as any).rpc('create_notification_once', {
    p_event_key: input.eventKey,
    p_recipient_type: input.recipientType,
    p_recipient_id: input.recipientId,
    p_type: input.type,
    p_title: input.title,
    p_body: input.body,
    p_pharmacy_id: input.pharmacyId ?? null,
    p_data: input.data ?? {},
    p_deliveries: deliveries,
  })
  if (error) throw error
  return { queued: true, ...(data as Record<string, unknown>) }
}

export function lagosDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

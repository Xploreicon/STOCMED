import 'server-only'
import {
  claimDelivery,
  createOutboxDelivery,
  finishDelivery,
  underGlobalChannelCap,
} from '@/lib/notifications/core'
import { renderEmailTemplate, type EmailTemplate } from '@/lib/notifications/email-templates'
import { createUnsubscribeToken } from '@/lib/notifications/unsubscribe'

type SendEmailInput = {
  to: string
  template: EmailTemplate
  data: Record<string, string | number | undefined>
  userId: string
  consent: boolean
  idempotencyKey: string
  pharmacyId?: string
  subject?: string
}

function usesVerifiedStocMedDomain(from: string) {
  const bracketed = from.match(/<([^>]+)>/)?.[1]
  const email = (bracketed || from).trim().toLowerCase()
  return email.endsWith('@askstocmed.com')
}

export async function deliverQueuedEmail(delivery: any) {
  const claimed = await claimDelivery(delivery.id)
  if (!claimed) return { status: delivery.status, duplicate: true }
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) {
    await finishDelivery(claimed.id, {
      status: 'skipped',
      error: 'Resend is not configured',
    })
    return { status: 'skipped' as const }
  }
  if (!usesVerifiedStocMedDomain(from)) {
    await finishDelivery(claimed.id, {
      status: 'skipped',
      error: 'RESEND_FROM_EMAIL must use the verified askstocmed.com domain',
    })
    return { status: 'skipped' as const }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': claimed.idempotency_key,
      },
      body: JSON.stringify({
        from,
        to: [claimed.recipient],
        subject: claimed.payload.subject,
        html: claimed.payload.html,
        text: claimed.payload.text,
        headers: {
          'List-Unsubscribe': `<${claimed.payload.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.id) throw new Error(body.message || `Resend returned ${response.status}`)
    await finishDelivery(claimed.id, {
      status: 'sent',
      providerMessageId: body.id,
      providerStatus: 'sent',
      cost: process.env.RESEND_ESTIMATED_COST_PER_EMAIL
        ? Number(process.env.RESEND_ESTIMATED_COST_PER_EMAIL)
        : null,
    })
    return { status: 'sent' as const, messageId: body.id }
  } catch (error) {
    const attempts = Number(claimed.attempts || 1)
    await finishDelivery(claimed.id, {
      status: attempts >= 4 ? 'failed' : 'retry',
      error: error instanceof Error ? error.message : 'Resend request failed',
      retryAt: new Date(Date.now() + Math.min(2 ** attempts * 60_000, 60 * 60_000)).toISOString(),
    })
    return { status: attempts >= 4 ? 'failed' as const : 'retry' as const }
  }
}

export async function sendEmail(input: SendEmailInput) {
  if (!input.consent) return { status: 'skipped' as const, reason: 'consent_required' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) throw new Error('Invalid email recipient')

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://askstocmed.com'
  const unsubscribeUrl = `${siteUrl}/api/notifications/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(input.userId))}`
  const rendered = renderEmailTemplate(input.template, input.data, unsubscribeUrl)
  const { delivery, duplicate } = await createOutboxDelivery({
    channel: 'email',
    provider: 'resend',
    type: input.template,
    recipient: input.to.toLowerCase(),
    idempotencyKey: input.idempotencyKey,
    pharmacyId: input.pharmacyId,
    userId: input.userId,
    payload: {
      ...rendered,
      subject: input.subject || rendered.subject,
      unsubscribeUrl,
      consent: 'explicit',
    },
  })
  if (duplicate || ['sent', 'delivered'].includes(delivery.status)) {
    return { status: delivery.status, duplicate: true }
  }
  if (!await underGlobalChannelCap('email')) {
    await finishDelivery(delivery.id, { status: 'skipped', error: 'Daily email safety cap reached' })
    return { status: 'skipped' as const }
  }
  return deliverQueuedEmail(delivery)
}

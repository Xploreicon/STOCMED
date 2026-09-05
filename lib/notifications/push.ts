import 'server-only'
import webpush from 'web-push'
import { getAdminClient } from '@/lib/supabase/admin'
import { claimDelivery, finishDelivery } from '@/lib/notifications/core'

let configuredFor: string | null = null

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@askstocmed.com'
  if (!publicKey || !privateKey) return false
  const fingerprint = `${subject}:${publicKey}:${privateKey.length}`
  if (configuredFor !== fingerprint) {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    configuredFor = fingerprint
  }
  return true
}

function statusCode(error: unknown) {
  if (typeof error === 'object' && error && 'statusCode' in error) {
    return Number((error as { statusCode?: unknown }).statusCode)
  }
  return 0
}

export async function deliverQueuedPush(delivery: any) {
  const claimed = await claimDelivery(delivery.id)
  if (!claimed) return { status: delivery.status, duplicate: true }
  if (!configureWebPush()) {
    await finishDelivery(claimed.id, { status: 'skipped', error: 'VAPID keys are not configured' })
    return { status: 'skipped' as const }
  }

  const subscriptionId = String(claimed.payload?.subscriptionId || '')
  const endpoint = String(claimed.recipient || '')
  const p256dh = String(claimed.payload?.p256dh || '')
  const auth = String(claimed.payload?.auth || '')
  if (!subscriptionId || !endpoint || !p256dh || !auth) {
    await finishDelivery(claimed.id, { status: 'failed', error: 'Push subscription is incomplete' })
    return { status: 'failed' as const }
  }

  try {
    const response = await webpush.sendNotification({
      endpoint,
      keys: { p256dh, auth },
    }, JSON.stringify({
      title: claimed.payload.title,
      body: claimed.payload.body,
      href: claimed.payload.href || '/dashboard',
      tag: claimed.payload.tag || claimed.notification_type,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    }), {
      TTL: 60 * 60 * 6,
      urgency: 'normal',
    })
    await finishDelivery(claimed.id, {
      status: 'sent',
      providerMessageId: response.headers?.location || `${subscriptionId}:${Date.now()}`,
      providerStatus: String(response.statusCode || 201),
    })
    return { status: 'sent' as const }
  } catch (error) {
    const code = statusCode(error)
    if (code === 404 || code === 410) {
      const admin = getAdminClient()
      if (admin) await (admin as any).from('push_subscriptions').delete().eq('id', subscriptionId)
      await finishDelivery(claimed.id, {
        status: 'skipped',
        error: 'Push subscription expired and was removed',
      })
      return { status: 'skipped' as const }
    }
    const attempts = Number(claimed.attempts || 1)
    const retryable = code === 0 || code === 408 || code === 429 || code >= 500
    const shouldRetry = retryable && attempts < 4
    await finishDelivery(claimed.id, {
      status: shouldRetry ? 'retry' : 'failed',
      error: error instanceof Error ? error.message : 'Web Push request failed',
      retryAt: shouldRetry
        ? new Date(Date.now() + Math.min(2 ** attempts * 60_000, 60 * 60_000)).toISOString()
        : undefined,
    })
    return { status: shouldRetry ? 'retry' as const : 'failed' as const }
  }
}

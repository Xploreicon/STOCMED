import type { Json } from '@/types/supabase'

export type NotificationRecipientType = 'patient' | 'pharmacist'
export type InAppNotificationType =
  | 'low_stock'
  | 'expiry'
  | 'daily_summary'
  | `reservation_${string}`
  | 'broadcast'
  | 'order'

export type InAppNotification = {
  id: string
  recipient_type: NotificationRecipientType
  recipient_id: string
  pharmacy_id: string | null
  type: InAppNotificationType
  title: string
  body: string
  data: Json
  read_at: string | null
  created_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Returns a safe, same-origin app route from a notification payload. */
export function getNotificationHref(data: unknown): string | null {
  if (!isRecord(data)) return null

  const candidate = [data.href, data.route, data.path]
    .find(value => typeof value === 'string')
  if (typeof candidate !== 'string') return null

  const route = candidate.trim()
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) {
    return null
  }

  try {
    const resolved = new URL(route, 'https://askstocmed.com')
    if (resolved.origin !== 'https://askstocmed.com') return null
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return null
  }
}

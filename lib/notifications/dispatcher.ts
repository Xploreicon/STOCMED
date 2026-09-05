import 'server-only'
import { deliverQueuedEmail } from '@/lib/notifications/email'
import { deliverQueuedSms } from '@/lib/notifications/sms'
import { deliverQueuedPush } from '@/lib/notifications/push'

export function deliveryHandler(channel: string) {
  if (channel === 'email') return deliverQueuedEmail
  if (channel === 'sms') return deliverQueuedSms
  if (channel === 'push') return deliverQueuedPush
  return null
}

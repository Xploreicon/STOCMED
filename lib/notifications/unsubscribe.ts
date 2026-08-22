import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'

function secret() {
  const value = process.env.NOTIFICATION_SIGNING_SECRET
  if (!value) throw new Error('NOTIFICATION_SIGNING_SECRET is not configured')
  return value
}

export function createUnsubscribeToken(userId: string) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  })).toString('base64url')
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyUnsubscribeToken(token: string) {
  const [payload, supplied] = token.split('.')
  if (!payload || !supplied) return null
  const expected = createHmac('sha256', secret()).update(payload).digest()
  const actual = Buffer.from(supplied, 'base64url')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
    userId?: string
    expiresAt?: number
  }
  return decoded.userId && decoded.expiresAt && decoded.expiresAt > Date.now()
    ? decoded.userId
    : null
}

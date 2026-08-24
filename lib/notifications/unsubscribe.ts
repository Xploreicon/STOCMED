import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'

function secret() {
  const value = process.env.NOTIFICATION_SIGNING_SECRET
  if (!value) throw new Error('NOTIFICATION_SIGNING_SECRET is not configured')
  return value
}

export type EmailUnsubscribeCategory = 'broadcast' | 'search_digest'

function signPayload(value: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url')
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifyPayload(token: string) {
  try {
    const [payload, supplied] = token.split('.')
    if (!payload || !supplied) return null
    const expected = createHmac('sha256', secret()).update(payload).digest()
    const actual = Buffer.from(supplied, 'base64url')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
  } catch {
    return null
  }
}

export function createUnsubscribeToken(userId: string) {
  return signPayload({
    userId,
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  })
}

export function verifyUnsubscribeToken(token: string) {
  const decoded = verifyPayload(token)
  if (!decoded) return null
  return typeof decoded.userId === 'string'
    && typeof decoded.expiresAt === 'number'
    && decoded.expiresAt > Date.now()
      ? decoded.userId
      : null
}

export function createScopedUnsubscribeToken(
  userId: string,
  category: EmailUnsubscribeCategory,
) {
  return signPayload({
    version: 1,
    userId,
    category,
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  })
}

export function verifyScopedUnsubscribeToken(token: string): {
  userId: string
  category: EmailUnsubscribeCategory
} | null {
  const decoded = verifyPayload(token)
  if (!decoded) return null
  const category = decoded.category
  if (category !== 'broadcast' && category !== 'search_digest') return null
  if (
    typeof decoded.userId !== 'string'
    || typeof decoded.expiresAt !== 'number'
    || decoded.expiresAt <= Date.now()
  ) return null
  return { userId: decoded.userId, category }
}

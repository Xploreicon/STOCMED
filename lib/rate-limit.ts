import 'server-only'
import { NextRequest, NextResponse } from 'next/server'

interface RateLimitRecord {
  count: number
  resetAt: number
}

const stores = new Map<string, Map<string, RateLimitRecord>>()

/**
 * In-memory sliding window rate limiter for Next.js API routes.
 *
 * @param req NextRequest
 * @param routeKey Key identifying the route (e.g. 'search', 'assistant')
 * @param maxRequests Maximum allowed requests in window
 * @param windowMs Window duration in milliseconds (default 60000 = 1 min)
 */
export function checkRateLimit(
  req: NextRequest,
  routeKey: string,
  maxRequests = 30,
  windowMs = 60_000
): { success: boolean; response?: NextResponse } {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    '127.0.0.1'

  let store = stores.get(routeKey)
  if (!store) {
    store = new Map<string, RateLimitRecord>()
    stores.set(routeKey, store)
  }

  const now = Date.now()
  const record = store.get(ip)

  if (!record || now > record.resetAt) {
    store.set(ip, { count: 1, resetAt: now + windowMs })
    return { success: true }
  }

  if (record.count >= maxRequests) {
    const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000)
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Too many requests. Please slow down and try again.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSeconds),
          },
        }
      ),
    }
  }

  record.count += 1
  return { success: true }
}

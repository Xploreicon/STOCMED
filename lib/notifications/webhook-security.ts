import { createHash, createHmac, timingSafeEqual } from 'crypto'

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60

function safelyMatches(actual: Buffer, expected: Buffer) {
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function sha256Hex(payload: string) {
  return createHash('sha256').update(payload).digest('hex')
}

export function verifyResendWebhook(input: {
  payload: string
  secret?: string
  id?: string | null
  timestamp?: string | null
  signature?: string | null
  now?: number
}) {
  const { payload, secret, id, timestamp, signature } = input
  if (!secret || !id || !timestamp || !signature) return false

  const timestampNumber = Number(timestamp)
  if (!Number.isFinite(timestampNumber)) return false
  const nowSeconds = (input.now ?? Date.now()) / 1000
  if (Math.abs(nowSeconds - timestampNumber) > MAX_WEBHOOK_AGE_SECONDS) return false

  let key: Buffer
  try {
    key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
  } catch {
    return false
  }
  if (!key.length) return false

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest()

  return signature.split(' ').some(item => {
    if (!item.startsWith('v1,')) return false
    const encoded = item.slice(3)
    if (!encoded) return false
    try {
      return safelyMatches(Buffer.from(encoded, 'base64'), expected)
    } catch {
      return false
    }
  })
}

export function verifyTermiiWebhook(input: {
  payload: string
  secret?: string
  signature?: string | null
}) {
  const { payload, secret, signature } = input
  if (!secret || !signature) return false
  const expected = createHmac('sha512', secret).update(payload).digest()

  const candidates: Buffer[] = []
  try { candidates.push(Buffer.from(signature, 'hex')) } catch { /* invalid candidate */ }
  try { candidates.push(Buffer.from(signature, 'base64')) } catch { /* invalid candidate */ }
  return candidates.some(candidate => safelyMatches(candidate, expected))
}

export function termiiWebhookEventId(payload: string, suppliedId?: string | null) {
  return suppliedId?.trim() || sha256Hex(payload)
}

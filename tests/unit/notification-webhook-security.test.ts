import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  sha256Hex,
  termiiWebhookEventId,
  verifyResendWebhook,
  verifyTermiiWebhook,
} from '@/lib/notifications/webhook-security'

describe('notification webhook signature boundaries', () => {
  it('accepts a current Resend signature and rejects tampering or an invalid timestamp', () => {
    const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'email-1' } })
    const secretBytes = Buffer.from('controlled-webhook-secret')
    const secret = `whsec_${secretBytes.toString('base64')}`
    const id = 'msg_test_1'
    const now = Date.UTC(2026, 8, 6, 12, 0, 0)
    const timestamp = String(now / 1000)
    const signature = `v1,${createHmac('sha256', secretBytes)
      .update(`${id}.${timestamp}.${payload}`)
      .digest('base64')}`

    expect(verifyResendWebhook({ payload, secret, id, timestamp, signature, now })).toBe(true)
    expect(verifyResendWebhook({ payload: `${payload} `, secret, id, timestamp, signature, now })).toBe(false)
    expect(verifyResendWebhook({ payload, secret, id, timestamp: 'not-a-number', signature, now })).toBe(false)
  })

  it('accepts Termii HMAC-SHA512 and rejects a modified payload', () => {
    const payload = JSON.stringify({ message_id: 'sms-1', status: 'DELIVERED' })
    const secret = 'controlled-termii-secret'
    const signature = createHmac('sha512', secret).update(payload).digest('hex')
    expect(verifyTermiiWebhook({ payload, secret, signature })).toBe(true)
    expect(verifyTermiiWebhook({ payload: `${payload} `, secret, signature })).toBe(false)
  })

  it('uses a supplied Termii event ID or a stable payload hash for replay identity', () => {
    const payload = '{"message_id":"sms-1"}'
    expect(termiiWebhookEventId(payload, ' termii-event-1 ')).toBe('termii-event-1')
    expect(termiiWebhookEventId(payload)).toBe(sha256Hex(payload))
  })
})

import { describe, expect, it } from 'vitest'
import {
  classifyAdminBroadcastError,
  getEmailDeliveryConfiguration,
} from '@/lib/notifications/email-configuration'

describe('admin broadcast production configuration', () => {
  it('requires every secret used before and during a Resend delivery', () => {
    expect(getEmailDeliveryConfiguration({})).toEqual({
      ready: false,
      issues: [
        'RESEND_API_KEY',
        'RESEND_FROM_EMAIL',
        'NOTIFICATION_HASH_PEPPER',
        'NOTIFICATION_SIGNING_SECRET',
      ],
    })
  })

  it('accepts a branded sender on the verified domain', () => {
    expect(getEmailDeliveryConfiguration({
      RESEND_API_KEY: 'test-key',
      RESEND_FROM_EMAIL: 'StocMed <updates@askstocmed.com>',
      NOTIFICATION_HASH_PEPPER: 'test-pepper',
      NOTIFICATION_SIGNING_SECRET: 'test-signing-secret',
    })).toEqual({ ready: true, issues: [] })
  })

  it('maps authorization failures to a clean 403', () => {
    expect(classifyAdminBroadcastError({
      code: '42501',
      message: 'Authorized administrator required',
    })).toEqual({
      status: 403,
      error: 'Only a provenance-authorized StocMed administrator may send broadcasts',
    })
  })

  it('maps missing secrets to a service-unavailable response instead of 500', () => {
    expect(classifyAdminBroadcastError(
      new Error('NOTIFICATION_SIGNING_SECRET is not configured'),
    )).toEqual({
      status: 503,
      error: 'Email delivery is not configured for production',
    })
  })
})

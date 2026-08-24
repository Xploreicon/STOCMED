import { describe, expect, it } from 'vitest'
import {
  buildRecoveryRedirectUrl,
  isValidRecoveryCode,
  normalizeRecoveryCode,
} from '@/lib/auth/password-recovery'

describe('password recovery helpers', () => {
  it('uses the dedicated recovery callback on the current origin', () => {
    expect(buildRecoveryRedirectUrl('https://askstocmed.com')).toBe(
      'https://askstocmed.com/auth-callback/recovery',
    )
    expect(buildRecoveryRedirectUrl('http://127.0.0.1:3000')).toBe(
      'http://127.0.0.1:3000/auth-callback/recovery',
    )
  })

  it('normalizes pasted codes without accepting letters', () => {
    expect(normalizeRecoveryCode('12 34-56')).toBe('123456')
    expect(normalizeRecoveryCode('12ab34')).toBe('1234')
  })

  it('accepts current Supabase OTP lengths and rejects malformed codes', () => {
    expect(isValidRecoveryCode('123456')).toBe(true)
    expect(isValidRecoveryCode('12345678')).toBe(true)
    expect(isValidRecoveryCode('12345')).toBe(false)
    expect(isValidRecoveryCode('123456789')).toBe(false)
  })
})

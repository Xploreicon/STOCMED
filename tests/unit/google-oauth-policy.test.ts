import { describe, expect, it } from 'vitest'
import {
  decideGoogleOAuthDestination,
  shouldCompleteOAuthProfile,
} from '@/lib/auth/google-oauth-policy'

describe('Google OAuth role policy', () => {
  it('honors an existing patient profile', () => {
    expect(decideGoogleOAuthDestination('patient', 'pharmacy')).toEqual({
      kind: 'existing_profile',
      role: 'patient',
    })
  })

  it('honors an existing pharmacy profile', () => {
    expect(decideGoogleOAuthDestination('pharmacy', undefined)).toEqual({
      kind: 'existing_profile',
      role: 'pharmacy',
    })
  })

  it('defaults a new Google identity to patient onboarding', () => {
    expect(decideGoogleOAuthDestination(undefined, undefined)).toEqual({
      kind: 'onboard_patient',
    })
  })

  it('rejects a crafted new-pharmacy hint', () => {
    expect(decideGoogleOAuthDestination(undefined, 'pharmacy')).toEqual({
      kind: 'reject_pharmacy_signup',
    })
  })

  it('keeps role-less OAuth identities inside the completion boundary', () => {
    expect(shouldCompleteOAuthProfile(undefined, '/dashboard')).toBe(true)
    expect(shouldCompleteOAuthProfile(undefined, '/login')).toBe(true)
    expect(shouldCompleteOAuthProfile(undefined, '/complete-profile')).toBe(false)
    expect(shouldCompleteOAuthProfile(undefined, '/auth-callback')).toBe(false)
    expect(shouldCompleteOAuthProfile(undefined, '/auth/native/complete')).toBe(false)
    expect(shouldCompleteOAuthProfile(undefined, '/auth/native/start')).toBe(false)
    expect(shouldCompleteOAuthProfile(undefined, '/update-password')).toBe(false)
  })

  it('does not disturb persisted patient or pharmacy navigation', () => {
    expect(shouldCompleteOAuthProfile('patient', '/dashboard')).toBe(false)
    expect(shouldCompleteOAuthProfile('pharmacy', '/pharmacy/dashboard')).toBe(false)
  })
})

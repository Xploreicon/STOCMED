import { describe, expect, it } from 'vitest'
import { decideGoogleOAuthDestination } from '@/lib/auth/google-oauth-policy'

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
})

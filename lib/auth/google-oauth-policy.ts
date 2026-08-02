export type StocMedRole = 'patient' | 'pharmacy'

export type GoogleOAuthDecision =
  | { kind: 'existing_profile'; role: StocMedRole }
  | { kind: 'onboard_patient' }
  | { kind: 'reject_pharmacy_signup' }

export function decideGoogleOAuthDestination(
  persistedRole: unknown,
  requestedOnboardingRole: unknown,
): GoogleOAuthDecision {
  if (persistedRole === 'patient' || persistedRole === 'pharmacy') {
    return { kind: 'existing_profile', role: persistedRole }
  }
  if (requestedOnboardingRole === 'pharmacy') {
    return { kind: 'reject_pharmacy_signup' }
  }
  return { kind: 'onboard_patient' }
}

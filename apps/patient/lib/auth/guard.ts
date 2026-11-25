import type { PatientProfile } from './profile'

type GuardInput = { loading: boolean; error: string | null; authenticated: boolean; profile: PatientProfile | null }
export type PatientAccess = 'loading' | 'error' | 'login' | 'onboarding' | 'denied' | 'allowed'

export function patientAccess(state: GuardInput): PatientAccess {
  if (state.loading) return 'loading'
  if (state.error) return 'error'
  if (!state.authenticated) return 'login'
  if (!state.profile) return 'onboarding'
  return state.profile.role === 'patient' ? 'allowed' : 'denied'
}

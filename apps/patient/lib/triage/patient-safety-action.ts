import type { RiskTier, TriageIntent } from './types';

export type PatientSafetyAction =
  | 'crisis_redirect'
  | 'emergency_redirect'
  | 'restricted_redirect'
  | 'symptom_intake'
  | 'symptom_intake_unavailable'
  | 'continue';

export function resolvePatientSafetyAction(
  result: { risk_tier: RiskTier; intent: TriageIntent },
  staffedSafetyFlowsEnabled: boolean
): PatientSafetyAction {
  if (result.risk_tier === 'CRISIS') return 'crisis_redirect';

  if (result.risk_tier === 'REDIRECT' && result.intent === 'RED_FLAG') {
    return 'emergency_redirect';
  }

  if (result.risk_tier === 'BLOCK_SOURCING') return 'restricted_redirect';

  if (result.risk_tier === 'CARE_REDIRECT' && result.intent === 'SYMPTOM_GENERIC') {
    return staffedSafetyFlowsEnabled ? 'symptom_intake' : 'symptom_intake_unavailable';
  }

  if (result.risk_tier === 'GATE') {
    // Named POM searches remain visible. Prescription handling now begins only
    // after the patient selects an opted-in destination pharmacy (Model A).
    return 'continue';
  }

  return 'continue';
}

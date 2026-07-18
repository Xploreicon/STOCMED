import { describe, expect, it } from 'vitest';
import { resolvePatientSafetyAction } from '@/lib/triage/patient-safety-action';

describe('pilot patient safety flow gating', () => {
  it('keeps deterministic safety redirects active when staffed flows are off', () => {
    expect(resolvePatientSafetyAction({ risk_tier: 'CRISIS', intent: 'CRISIS' }, false))
      .toBe('crisis_redirect');
    expect(resolvePatientSafetyAction({ risk_tier: 'REDIRECT', intent: 'RED_FLAG' }, false))
      .toBe('emergency_redirect');
    expect(resolvePatientSafetyAction({ risk_tier: 'BLOCK_SOURCING', intent: 'RESTRICTED' }, false))
      .toBe('restricted_redirect');
  });

  it('keeps symptom intake gated while allowing POM sourcing to continue', () => {
    expect(resolvePatientSafetyAction({ risk_tier: 'CARE_REDIRECT', intent: 'SYMPTOM_GENERIC' }, false))
      .toBe('symptom_intake_unavailable');
    expect(resolvePatientSafetyAction({ risk_tier: 'GATE', intent: 'NAMED_POM' }, false))
      .toBe('continue');
  });

  it('offers staffed symptom intake only when enabled without restoring the central Rx queue', () => {
    expect(resolvePatientSafetyAction({ risk_tier: 'CARE_REDIRECT', intent: 'SYMPTOM_GENERIC' }, true))
      .toBe('symptom_intake');
    expect(resolvePatientSafetyAction({ risk_tier: 'GATE', intent: 'NAMED_POM' }, true))
      .toBe('continue');
  });
});

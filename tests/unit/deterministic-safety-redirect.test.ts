import { describe, expect, it } from 'vitest';
import { getDeterministicSafetyRedirect } from '@/lib/triage/deterministic-safety-redirect';
import {
  getSafeResponse,
  SYMPTOM_INTAKE_UNAVAILABLE_MESSAGE,
} from '@/lib/triage/safe-responses';

describe('deterministic search safety boundary', () => {
  it('maps crisis, emergency, and restricted queries to non-searchable redirects', () => {
    expect(getDeterministicSafetyRedirect('I want to kill myself')).toMatchObject({
      action: 'crisis',
      risk_tier: 'CRISIS',
    });
    expect(getDeterministicSafetyRedirect('I cannot breathe')).toMatchObject({
      action: 'emergency',
      risk_tier: 'REDIRECT',
    });
    expect(
      getDeterministicSafetyRedirect('where can I buy tramadol without prescription')
    ).toMatchObject({
      action: 'restricted',
      risk_tier: 'BLOCK_SOURCING',
    });
  });

  it('does not block ordinary OTC, POM, or generic symptom classification as a search safety redirect', () => {
    expect(getDeterministicSafetyRedirect('paracetamol near me')).toBeNull();
    expect(getDeterministicSafetyRedirect('metformin 500mg')).toBeNull();
    expect(getDeterministicSafetyRedirect('something for headache')).toBeNull();
  });
});

describe('symptom intake safe response', () => {
  it('fails closed when the staffed symptom flow is disabled or unspecified', () => {
    expect(getSafeResponse('SYMPTOM_GENERIC', 'CARE_REDIRECT')).toEqual({
      message: SYMPTOM_INTAKE_UNAVAILABLE_MESSAGE,
    });
    expect(
      getSafeResponse('SYMPTOM_GENERIC', 'CARE_REDIRECT', { symptomIntakeEnabled: false })
    ).toEqual({ message: SYMPTOM_INTAKE_UNAVAILABLE_MESSAGE });
  });

  it('advertises symptom intake only after it is explicitly enabled', () => {
    expect(
      getSafeResponse('SYMPTOM_GENERIC', 'CARE_REDIRECT', { symptomIntakeEnabled: true })
    ).toMatchObject({ actionRequired: 'symptom_intake' });
  });
});

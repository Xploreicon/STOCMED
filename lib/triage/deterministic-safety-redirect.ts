import { classifyDeterministically } from './deterministic-classifier';
import { getSafeResponse } from './safe-responses';
import type { RiskTier, TriageIntent } from './types';

export type DeterministicSafetyRedirectAction = 'crisis' | 'emergency' | 'restricted';

export interface DeterministicSafetyRedirect {
  action: DeterministicSafetyRedirectAction;
  intent: TriageIntent;
  risk_tier: Extract<RiskTier, 'CRISIS' | 'REDIRECT' | 'BLOCK_SOURCING'>;
  message: string;
}

/**
 * Returns only deterministic, non-searchable safety outcomes. This helper is
 * intentionally synchronous so every medication-search entry point can run it
 * before querying or returning inventory.
 */
export function getDeterministicSafetyRedirect(
  rawQuery: string
): DeterministicSafetyRedirect | null {
  const result = classifyDeterministically(rawQuery);
  if (!result) return null;

  if (result.risk_tier === 'CRISIS') {
    return {
      action: 'crisis',
      intent: result.intent,
      risk_tier: result.risk_tier,
      message: getSafeResponse(result.intent, result.risk_tier).message,
    };
  }

  if (result.risk_tier === 'REDIRECT' && result.intent === 'RED_FLAG') {
    return {
      action: 'emergency',
      intent: result.intent,
      risk_tier: result.risk_tier,
      message: getSafeResponse(result.intent, result.risk_tier).message,
    };
  }

  if (result.risk_tier === 'BLOCK_SOURCING') {
    return {
      action: 'restricted',
      intent: result.intent,
      risk_tier: result.risk_tier,
      message: getSafeResponse(result.intent, result.risk_tier).message,
    };
  }

  return null;
}

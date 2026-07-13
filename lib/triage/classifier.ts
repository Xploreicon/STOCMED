import { TriageResult, RiskTier } from './types';
import { classifyDeterministically } from './deterministic-classifier';
import { classifyWithModel } from './model-classifier';

const RISK_HIERARCHY: Record<RiskTier, number> = {
  CRISIS: 5,
  BLOCK_SOURCING: 4,
  REDIRECT: 3,
  CARE_REDIRECT: 2,
  GATE: 2,
  ALLOW: 1,
};

/**
 * Orchestrates classification across Layer 1 (deterministic) and Layer 2 (model).
 * Takes the highest risk signal across both layers to ensure safety-first operations.
 */
export async function triageQuery(rawQuery: string): Promise<TriageResult> {
  // 1. Run deterministic classifier (fast path)
  const deterministicResult = classifyDeterministically(rawQuery);

  // If deterministic classifier matched a high-risk tier immediately, return it.
  // CRISIS, BLOCK_SOURCING, and REDIRECT (RED_FLAG) bypass the model call entirely for speed/safety.
  if (
    deterministicResult &&
    (deterministicResult.risk_tier === 'CRISIS' ||
      deterministicResult.risk_tier === 'BLOCK_SOURCING' ||
      deterministicResult.risk_tier === 'REDIRECT')
  ) {
    return {
      ...deterministicResult,
      layers_triggered: [...deterministicResult.layers_triggered, 'fast_path'],
    };
  }

  // 2. Run model classifier (Layer 2)
  const modelResult = await classifyWithModel(rawQuery);

  // 3. Resolve results: take the highest risk tier
  if (!deterministicResult && !modelResult) {
    // Default safe fallback if both fail
    return {
      intent: 'OUT_OF_SCOPE',
      risk_tier: 'ALLOW',
      confidence: 1.0,
      raw_query: rawQuery,
      layers_triggered: ['fallback_default'],
    };
  }

  if (!deterministicResult) return modelResult!;
  if (!modelResult) return deterministicResult;

  const detRisk = RISK_HIERARCHY[deterministicResult.risk_tier] || 1;
  const modelRisk = RISK_HIERARCHY[modelResult.risk_tier] || 1;

  if (detRisk >= modelRisk) {
    return {
      ...deterministicResult,
      layers_triggered: [
        ...deterministicResult.layers_triggered,
        ...modelResult.layers_triggered,
        'resolved_deterministic_win',
      ],
    };
  } else {
    return {
      ...modelResult,
      layers_triggered: [
        ...deterministicResult.layers_triggered,
        ...modelResult.layers_triggered,
        'resolved_model_win',
      ],
    };
  }
}

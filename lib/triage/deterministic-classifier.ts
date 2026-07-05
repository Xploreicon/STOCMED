import { TriageResult, TriageIntent, RiskTier } from './types';
import {
  CRISIS_LIST,
  RED_FLAG_LIST,
  RESTRICTED_LIST,
  POM_MOLECULES_LIST,
  OTC_MOLECULES_LIST,
  KeywordConfig,
} from './keyword-lists';

/**
 * Normalizes user input for robust text matching.
 */
export function normalizeQuery(query: string): string {
  if (!query) return '';
  return query
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, ' ') // Replace punctuation with space
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
}

/**
 * Checks a normalized query against a KeywordConfig.
 */
function matchesConfig(normalized: string, config: KeywordConfig): boolean {
  // Check terms (substring / exact boundary matching where appropriate)
  const hasTerm = config.terms.some((term) => {
    const normalizedTerm = term.toLowerCase().trim();
    if (!normalizedTerm) return false;
    
    // Check if term matches as a whole word / boundaries
    const escapedTerm = normalizedTerm.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedTerm}\\b`, 'i');
    return regex.test(normalized);
  });

  if (hasTerm) return true;

  // Check patterns
  const hasPattern = config.patterns.some((pattern) => pattern.test(normalized));
  return hasPattern;
}

/**
 * Layer 1 Classifier - Deterministic keyword/regex matching.
 * Returns a TriageResult if a rule triggers, otherwise returns null.
 */
export function classifyDeterministically(rawQuery: string): TriageResult | null {
  const normalized = normalizeQuery(rawQuery);
  if (!normalized) {
    return {
      intent: 'OUT_OF_SCOPE',
      risk_tier: 'REDIRECT',
      confidence: 1.0,
      raw_query: rawQuery,
      layers_triggered: ['deterministic_empty'],
    };
  }

  // 1. CRISIS Check (highest priority)
  if (matchesConfig(normalized, CRISIS_LIST)) {
    return {
      intent: 'CRISIS',
      risk_tier: 'CRISIS',
      confidence: 1.0,
      raw_query: rawQuery,
      layers_triggered: ['deterministic_crisis'],
    };
  }

  // 2. RED_FLAG Check (emergencies)
  if (matchesConfig(normalized, RED_FLAG_LIST)) {
    return {
      intent: 'RED_FLAG',
      risk_tier: 'REDIRECT',
      confidence: 1.0,
      raw_query: rawQuery,
      layers_triggered: ['deterministic_red_flag'],
    };
  }

  // 3. RESTRICTED Check (abuse, abortifacients)
  if (matchesConfig(normalized, RESTRICTED_LIST)) {
    return {
      intent: 'RESTRICTED',
      risk_tier: 'BLOCK_SOURCING',
      confidence: 1.0,
      raw_query: rawQuery,
      layers_triggered: ['deterministic_restricted'],
    };
  }

  // 4. POM MOLECULES Check (Prescription only medicines)
  if (matchesConfig(normalized, POM_MOLECULES_LIST)) {
    return {
      intent: 'NAMED_POM',
      risk_tier: 'GATE',
      confidence: 1.0,
      raw_query: rawQuery,
      layers_triggered: ['deterministic_pom_molecules'],
    };
  }

  // 5. OTC MOLECULES Check (Over-the-counter medicines)
  if (matchesConfig(normalized, OTC_MOLECULES_LIST)) {
    return {
      intent: 'NAMED_OTC',
      risk_tier: 'ALLOW',
      confidence: 1.0,
      raw_query: rawQuery,
      layers_triggered: ['deterministic_otc_molecules'],
    };
  }

  return null;
}

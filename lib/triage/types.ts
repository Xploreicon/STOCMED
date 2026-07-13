export type TriageIntent =
  | 'NAMED_OTC'
  | 'NAMED_POM'
  | 'SYMPTOM_GENERIC'
  | 'RED_FLAG'
  | 'RESTRICTED'
  | 'CRISIS'
  | 'OUT_OF_SCOPE';

export type RiskTier =
  | 'ALLOW'
  | 'GATE'
  | 'CARE_REDIRECT'
  | 'REDIRECT'
  | 'BLOCK_SOURCING'
  | 'CRISIS';

export interface TriageResult {
  intent: TriageIntent;
  risk_tier: RiskTier;
  confidence: number;
  matched_product_id?: string | null;
  raw_query: string;
  layers_triggered: string[];
}

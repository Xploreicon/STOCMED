import {
  DEFAULT_CLAUDE_MODEL,
  getAnthropicClient,
  reportClaudeFailure,
  runClaudeRequest,
  toClaudeEmptyResponseError,
} from '@/lib/anthropic';
import { TriageResult, TriageIntent, RiskTier } from './types';

const SYSTEM_PROMPT = `You are a strict safety and compliance classifier for a Nigerian telepharmacy application called StocMed.
Analyze the user's message and determine the correct intent and risk_tier.

INTENTS and corresponding RISK_TIERS:
1. "NAMED_OTC": User is looking for a specific, over-the-counter medication (e.g. Paracetamol, Ibuprofen, Panadol, Chemiron, Vitamin C).
   Risk Tier: ALLOW

2. "NAMED_POM": User is looking for a specific, prescription-only medication (e.g. Amoxicillin, Lisinopril, Amlodipine, Metformin, Ventolin, Insulin, Viagra).
   Risk Tier: GATE

3. "SYMPTOM_GENERIC": User describes general symptoms (e.g. "I have a headache", "my stomach hurts", "what should I take for a cold?") without naming a specific drug.
   Risk Tier: CARE_REDIRECT (pharmacist intake / pharmacy call option)

4. "RED_FLAG": Urgent emergency symptoms (e.g. "chest pain", "difficulty breathing", "stroke signs", "bleeding heavily", "seizure", "unconscious", "choking").
   Risk Tier: REDIRECT (emergency override)

5. "RESTRICTED": Abortifacients (e.g. Misoprostol, Cytotec, Mifepristone) or drugs of abuse/highly controlled substances (e.g. Tramadol, Codeine, Rohypnol, Pentazocine) or requests indicating abuse/illicit sourcing.
   Risk Tier: BLOCK_SOURCING

6. "CRISIS": Intent of self-harm, suicide, or severe psychiatric crisis.
   Risk Tier: CRISIS

7. "OUT_OF_SCOPE": Queries unrelated to health, drugs, or pharmacies (e.g. "tell me a joke", "who won the match").
   Risk Tier: CARE_REDIRECT

Rules:
- You must output valid JSON ONLY, in this exact format:
  {
    "intent": "INTENT_NAME",
    "risk_tier": "RISK_TIER_NAME",
    "confidence": 0.0 to 1.0,
    "reasoning": "Brief explanation"
  }
- Do not output any preamble or conversational text. Only output the JSON object.
- RED_FLAG/REDIRECT is positive-signal-only: select it only when the user's own message contains a clear emergency symptom or event. Ambiguity, uncertainty, missing context, classifier doubt, and generic symptoms must never become an emergency; use SYMPTOM_GENERIC/CARE_REDIRECT or OUT_OF_SCOPE/CARE_REDIRECT instead.
- If there is abortifacient/abuse risk, classify it as RESTRICTED/BLOCK_SOURCING.`;

const VALID_INTENTS = new Set<TriageIntent>([
  'NAMED_OTC',
  'NAMED_POM',
  'SYMPTOM_GENERIC',
  'RED_FLAG',
  'RESTRICTED',
  'CRISIS',
  'OUT_OF_SCOPE',
]);

const VALID_RISK_TIERS = new Set<RiskTier>([
  'ALLOW',
  'GATE',
  'CARE_REDIRECT',
  'REDIRECT',
  'BLOCK_SOURCING',
  'CRISIS',
]);

/**
 * Layer 2 model classifier. Deterministic triage remains available when
 * Anthropic is unavailable, rate-limited, or out of credit.
 */
export async function classifyWithModel(
  rawQuery: string,
  timeoutMs = 8000
): Promise<TriageResult | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  try {
    const model = process.env.ANTHROPIC_TRIAGE_MODEL || DEFAULT_CLAUDE_MODEL;
    const response = await runClaudeRequest(
      () => anthropic.messages.create({
        model,
        max_tokens: 150,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: rawQuery }],
      }),
      timeoutMs,
      { model, operation: 'triage' }
    );

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      const emptyResponseError = toClaudeEmptyResponseError(
        { model, operation: 'triage' },
        {
          id: response.id,
          model: response.model,
          stopReason: response.stop_reason,
          contentTypes: response.content.map((block) => block.type),
        }
      );
      reportClaudeFailure(emptyResponseError);
      throw emptyResponseError;
    }

    const text = textBlock.text;
    
    // Parse the JSON output
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to find JSON in model output');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    const intent = VALID_INTENTS.has(parsed.intent) ? parsed.intent : 'OUT_OF_SCOPE';
    let risk_tier: RiskTier = VALID_RISK_TIERS.has(parsed.risk_tier)
      ? parsed.risk_tier
      : 'CARE_REDIRECT';

    // Emergency is valid only when both fields positively identify a red flag.
    if (intent !== 'RED_FLAG' && risk_tier === 'REDIRECT') {
      risk_tier = 'CARE_REDIRECT';
    } else if (intent === 'RED_FLAG' && risk_tier !== 'REDIRECT') {
      risk_tier = 'CARE_REDIRECT';
    }
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;

    return {
      intent,
      risk_tier,
      confidence,
      raw_query: rawQuery,
      layers_triggered: ['model_haiku'],
    };
  } catch (error) {
    return null;
  }
}

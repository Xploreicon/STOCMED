import Anthropic from '@anthropic-ai/sdk';
import { TriageResult, TriageIntent, RiskTier } from './types';

const SYSTEM_PROMPT = `You are a strict safety and compliance classifier for a Nigerian telepharmacy application called StocMed.
Analyze the user's message and determine the correct intent and risk_tier.

INTENTS and corresponding RISK_TIERS:
1. "NAMED_OTC": User is looking for a specific, over-the-counter medication (e.g. Paracetamol, Ibuprofen, Panadol, Chemiron, Vitamin C).
   Risk Tier: ALLOW

2. "NAMED_POM": User is looking for a specific, prescription-only medication (e.g. Amoxicillin, Lisinopril, Amlodipine, Metformin, Ventolin, Insulin, Viagra).
   Risk Tier: GATE

3. "SYMPTOM_GENERIC": User describes general symptoms (e.g. "I have a headache", "my stomach hurts", "what should I take for a cold?") without naming a specific drug.
   Risk Tier: REDIRECT (pharmacist intake / pharmacy call option)

4. "RED_FLAG": Urgent emergency symptoms (e.g. "chest pain", "difficulty breathing", "stroke signs", "bleeding heavily", "seizure", "unconscious", "choking").
   Risk Tier: REDIRECT (emergency override)

5. "RESTRICTED": Abortifacients (e.g. Misoprostol, Cytotec, Mifepristone) or drugs of abuse/highly controlled substances (e.g. Tramadol, Codeine, Rohypnol, Pentazocine) or requests indicating abuse/illicit sourcing.
   Risk Tier: BLOCK_SOURCING

6. "CRISIS": Intent of self-harm, suicide, or severe psychiatric crisis.
   Risk Tier: CRISIS

7. "OUT_OF_SCOPE": Queries unrelated to health, drugs, or pharmacies (e.g. "tell me a joke", "who won the match").
   Risk Tier: REDIRECT

Rules:
- You must output valid JSON ONLY, in this exact format:
  {
    "intent": "INTENT_NAME",
    "risk_tier": "RISK_TIER_NAME",
    "confidence": 0.0 to 1.0,
    "reasoning": "Brief explanation"
  }
- Do not output any preamble or conversational text. Only output the JSON object.
- Be conservative: if there is any doubt or potential emergency risk, escalate to RED_FLAG/REDIRECT. If there is abortifacient/abuse risk, escalate to RESTRICTED/BLOCK_SOURCING.`;

/**
 * Layer 2 Model-based Triage Classifier using Claude 3.5 Haiku.
 * Runs with a timeout to prevent blocking the user experience.
 */
export async function classifyWithModel(
  rawQuery: string,
  timeoutMs = 8000
): Promise<TriageResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('Anthropic API key not found. Skipping model classifier.');
    return null;
  }

  const anthropic = new Anthropic({ apiKey });

  const apiCall = anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: rawQuery }],
  });

  // Wrap in a promise that rejects after timeoutMs
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Model classification timeout')), timeoutMs)
  );

  try {
    const response = await Promise.race([apiCall, timeoutPromise]);
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    
    // Parse the JSON output
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to find JSON in model output');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    const intent = (parsed.intent ?? 'OUT_OF_SCOPE') as TriageIntent;
    const risk_tier = (parsed.risk_tier ?? 'REDIRECT') as RiskTier;
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;

    return {
      intent,
      risk_tier,
      confidence,
      raw_query: rawQuery,
      layers_triggered: ['model_haiku'],
    };
  } catch (error) {
    console.error('Error in model classification:', error);
    // Fallback to ALLOW to ensure system resilience for basic queries
    return {
      intent: 'OUT_OF_SCOPE',
      risk_tier: 'ALLOW',
      confidence: 0.0,
      raw_query: rawQuery,
      layers_triggered: ['model_fallback_error'],
    };
  }
}

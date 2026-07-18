import { RiskTier, TriageIntent } from './types';

export interface SafeResponse {
  message: string;
  actionRequired?: 'emergency' | 'restricted' | 'crisis' | 'prescription_upload' | 'symptom_intake';
  details?: Record<string, any>;
}

export interface SafeResponseOptions {
  symptomIntakeEnabled?: boolean;
}

export const SYMPTOM_INTAKE_UNAVAILABLE_MESSAGE =
  'Pharmacist symptom review is not available during the pilot. Please contact a licensed pharmacist or clinician for assessment. If your symptoms become severe or urgent, call 112 or go to the nearest emergency department.';

export const SAFE_RESPONSES: Record<RiskTier, SafeResponse> = {
  CRISIS: {
    message: `I hear you, and I want you to know that support is available. Please reach out to someone who can help.

You can contact the Mentally Aware Nigeria Initiative (MANI) crisis hotlines:
• Call: 0809 111 6264
• Call: 0700 6264 6264

If you are in immediate physical danger, please call national emergency services on 112 or go to the nearest hospital emergency room. You do not have to go through this alone.`,
    actionRequired: 'crisis',
  },
  BLOCK_SOURCING: {
    message: `This medication is a highly controlled substance or restricted medication. Under Nigerian healthcare regulations, we are unable to display pharmacy pricing, stock levels, or facilitate sourcing for this medication.

For your safety and legal compliance, please consult a licensed medical practitioner at a registered clinic or hospital to obtain a valid prescription and receive controlled administration.`,
    actionRequired: 'restricted',
  },
  REDIRECT: {
    message: `If you are experiencing chest pain, severe shortness of breath, sudden weakness, heavy bleeding, or any other life-threatening symptoms, please seek immediate emergency medical care.

• Call National Emergency Services: 112
• Call Lagos Emergency Service: 767 (if in Lagos)
• Go to the nearest hospital emergency department immediately.`,
    actionRequired: 'emergency',
  },
  CARE_REDIRECT: {
    message: SYMPTOM_INTAKE_UNAVAILABLE_MESSAGE,
  },
  GATE: {
    message: `This medication is classified as Prescription-Only (POM). To comply with PCN regulations, we cannot fulfill or show detailed sourcing for this drug until a valid prescription is verified by our pharmacist.

Please upload a clear photo of your doctor's prescription using the button below to proceed.`,
    actionRequired: 'prescription_upload',
  },
  ALLOW: {
    message: '',
  },
};

/**
 * Gets a safe response template based on intent and risk tier.
 */
export function getSafeResponse(
  intent: TriageIntent,
  tier: RiskTier,
  options: SafeResponseOptions = {}
): SafeResponse {
  if (intent === 'RED_FLAG') {
    return SAFE_RESPONSES.REDIRECT;
  }
  if (intent === 'CRISIS') {
    return SAFE_RESPONSES.CRISIS;
  }
  if (intent === 'RESTRICTED') {
    return SAFE_RESPONSES.BLOCK_SOURCING;
  }
  if (intent === 'SYMPTOM_GENERIC') {
    if (!options.symptomIntakeEnabled) {
      return SAFE_RESPONSES.CARE_REDIRECT;
    }
    return {
      message: `For generic symptom inquiries, you can fill out our brief pharmacist symptom intake form so a licensed pharmacist can review your situation and advise you, or browse common OTC categories.`,
      actionRequired: 'symptom_intake',
    };
  }
  if (intent === 'OUT_OF_SCOPE') {
    return {
      message: `I'm here to help you search for medication availability, check prices, and locate pharmacies near you in Nigeria. Please let me know what medication you are looking for!`,
    };
  }
  return SAFE_RESPONSES[tier] || { message: 'An unexpected safety gate was triggered.' };
}

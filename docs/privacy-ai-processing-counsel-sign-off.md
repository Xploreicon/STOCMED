# StocMed AI processing counsel sign-off

**Status: PENDING INDEPENDENT COUNSEL SIGNATURE**

This record documents StocMed's owner-approved product decisions and the legal conclusions that counsel must confirm. It is not a legal opinion and must not be described as counsel approval until the signature section is completed by qualified Nigerian counsel.

## Controller and release context

- Controller: StocMed Health Ltd, RC 9540156.
- Registered address: 18 Anuoluwapo Street, Shomolu, Lagos State, Nigeria.
- Privacy contact: `support@askstocmed.com`, `+234 810 358 7435`.
- Minimum user age: 18.
- AI provider: Anthropic, used for the patient assistant and residual-only pharmacy inventory structurer.
- Anthropic retention decision: StocMed has no Zero-Data-Retention agreement. The public policy therefore discloses Anthropic's standard commercial API retention of up to 30 days and no model training by default. Do not substitute ZDR wording unless a future written agreement is executed and its coverage of both API paths is verified.

## Decision 1 - sensitive patient-assistant messages

**Proposed basis for counsel confirmation:** obtain explicit, informed, specific consent before a patient's first health-related message is sent to Anthropic.

The consent flow should:

1. Name Anthropic and explain that the message is processed in the United States to generate the assistant response.
2. Disclose the standard retention period of up to 30 days and that the data is not used for model training by default.
3. Offer equally clear Accept and Decline choices; declining must leave non-AI medication search available.
4. Record the notice version, choice, user, and timestamp, and provide a way to withdraw consent for future AI processing.
5. Avoid sending a message to Anthropic until an affirmative consent record exists.

The existing demand-insights consent is not approval for patient-assistant processing and must not be reused as though it were.

## Decision 2 - cross-border transfer mechanism

**Proposed mechanism for counsel confirmation:** explicit informed consent for the patient-assistant transfer under the Nigeria Data Protection Act, combined with executed processor terms and contractual safeguards with Anthropic. The notice must explain the relevant transfer risks. Counsel must confirm whether an adequacy decision or an NDPC-approved Cross-Border Data Transfer Instrument is required or preferable for the live Anthropic arrangement.

StocMed must retain evidence of the Anthropic commercial terms, the applicable data-processing agreement, the configured organisation/API path, and any approved transfer instrument. Inventory structuring is intended to send pharmacy product-list data only, not patient or staff personal data; the ingestion path should continue to exclude unrelated fields.

## Decision 3 - release order

1. Publish and verify the privacy policy in production.
2. Set `AI_PROCESSING_PRIVACY_DISCLOSURE_LIVE=true` in the production application environment.
3. Deploy Prompt 5 and verify that the structurer endpoint no longer returns the disclosure-gate 503.
4. Keep Prompt 6 separately gated.

## Counsel confirmation

Counsel confirms that they have reviewed the public Privacy Policy, the patient-assistant consent design, the Anthropic commercial terms/data-processing agreement, and the proposed cross-border transfer mechanism against the Nigeria Data Protection Act 2023, the NDP Act General Application and Implementation Directive 2025, and applicable pharmacy regulation.

- Counsel name: ____________________________________
- Firm / organisation: ______________________________
- Signature: _______________________________________
- Date: ____________________________________________
- Required changes or qualifications: _______________

## Primary regulatory references

- [Nigeria Data Protection Act 2023](https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf), especially sections 25-26, 30-31, and 41-43.
- [NDP Act General Application and Implementation Directive 2025](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf).
- [Nigeria Data Protection Commission cross-border transfer FAQ](https://ndpc.gov.ng/faqs/).

# Privacy policy publication gate — 27 August 2026

The public privacy-policy draft has been updated to match the implemented system and Anthropic's standard commercial API terms. Do not deploy Prompt 5 or Prompt 6 until the policy has been approved and is live.

## Required owner and counsel confirmations

1. Confirm StocMed Health Ltd's CAC registration number, full service address, and a dialable privacy contact number. The public draft currently uses the verified public contact details: `support@askstocmed.com`, Lagos, Nigeria, and `+234 (0) 800 STOCMED`.
2. Confirm whether the StocMed Anthropic commercial organisation has a written Zero-Data-Retention agreement. The repository and API configuration do not prove this. Until written confirmation exists, the public draft correctly discloses Anthropic's standard API retention of up to 30 days, subject to Anthropic's stated legal and safety exceptions.
3. If ZDR is confirmed, verify that the same commercial organisation API key covers both the patient assistant and inventory structurer, and that neither path uses a feature excluded from the agreement. Then replace the standard-retention wording with counsel-approved ZDR wording.
4. Confirm the lawful basis for sending health-related assistant messages to Anthropic and whether a separate explicit-consent step is required before the first AI request.
5. Confirm the lawful cross-border transfer mechanism and the relevant data-processing agreements for every listed subprocessor.
6. Confirm that the product's minimum age is 18 and align the Terms of Service before publication.
7. Obtain final review from counsel familiar with the Nigeria Data Protection Act 2023, NDPR obligations, and PCN pharmacy regulation.

## Implementation facts verified in the repository

- The in-app patient assistant calls the Anthropic Messages API.
- The Prompt 5 inventory structurer calls the same first-party Anthropic Messages API using the commercial API key configured for the application.
- Personal search history expires after 365 days and has a scheduled purge function.
- Readable chat text expires after 30 days; the account-linked integrity hash expires after 365 days.
- Supabase, Vercel, Resend, Termii, Sentry, and Anthropic are all active or configured application providers.
- Sentry disables default personal-information collection and scrubs events and breadcrumbs before transmission.

## Separate public-page issue

The Terms of Service page still exposes its own draft banner and placeholders. It requires a separate legal-content pass before StocMed treats the legal pages as publication-complete.

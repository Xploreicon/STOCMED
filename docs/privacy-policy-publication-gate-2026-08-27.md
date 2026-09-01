# Privacy policy publication gate — 27 August 2026

The public privacy-policy draft has been updated to match the implemented system and Anthropic's standard commercial API terms. Do not deploy Prompt 5 or Prompt 6 until the policy has been approved and is live.

## Required owner and counsel confirmations

1. Confirm StocMed Health Ltd's CAC registration number, full service address, and a dialable privacy contact number. The public draft currently uses the verified public contact details: `support@askstocmed.com`, Lagos, Nigeria, and `+234 (0) 800 STOCMED`.
2. StocMed has confirmed that it does not currently have a written Anthropic Zero-Data-Retention agreement. Keep the public draft's standard API retention wording unless a future written agreement covering both the patient assistant and inventory structurer is executed and verified.
3. Confirm the lawful basis for sending health-related assistant messages to Anthropic and whether a separate explicit-consent step is required before the first AI request.
4. Confirm the lawful cross-border transfer mechanism and the relevant data-processing agreements for every listed subprocessor.
5. Confirm that 18 is the intended minimum age for both patients and pharmacy users.
6. Obtain final review from counsel familiar with the Nigeria Data Protection Act 2023, NDPR obligations, and PCN pharmacy regulation.

## Implementation facts verified in the repository

- The in-app patient assistant calls the Anthropic Messages API.
- The Prompt 5 inventory structurer calls the same first-party Anthropic Messages API using the commercial API key configured for the application.
- Personal search history expires after 365 days and has a scheduled purge function.
- Readable chat text expires after 30 days; the account-linked integrity hash expires after 365 days.
- Supabase, Vercel, Resend, Termii, Sentry, and Anthropic are all active or configured application providers.
- Sentry disables default personal-information collection and scrubs events and breadcrumbs before transmission.

## Terms of Service cleanup

The Terms of Service draft banner and placeholders have been removed on this branch. The page now uses the same provisional minimum age and verified public contact details as the privacy draft. Counsel must still review the commercial, liability, governing-law, and pharmacy-regulation terms before publication.

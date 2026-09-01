# Privacy policy publication gate — 27 August 2026

The public privacy-policy draft has been updated to match the implemented system and Anthropic's standard commercial API terms. The owner has approved publishing the policy and enabling Prompt 5 only after the production privacy page is verified live. Prompt 6 remains separately gated.

## Required owner and counsel confirmations

1. StocMed Health Ltd's incorporation details are confirmed by its CAC certificate and status report: RC 9540156, incorporated 12 May 2026, registered address 18 Anuoluwapo Street, Shomolu, Lagos State, Nigeria. The owner confirmed the dialable privacy number as `08103587435`, published in international format as `+234 810 358 7435`.
2. StocMed has confirmed that it does not currently have a written Anthropic Zero-Data-Retention agreement. Keep the public draft's standard API retention wording unless a future written agreement covering both the patient assistant and inventory structurer is executed and verified.
3. Confirm the lawful basis for sending health-related assistant messages to Anthropic and whether a separate explicit-consent step is required before the first AI request.
4. Confirm the lawful cross-border transfer mechanism and the relevant data-processing agreements for every listed subprocessor.
5. The owner confirmed 18 as the minimum age for both patients and pharmacy users.
6. Obtain an actual signature from counsel familiar with the Nigeria Data Protection Act 2023, NDPR obligations, and PCN pharmacy regulation. The repository contains a counsel-ready decision record, but it must not be represented as signed until counsel signs it.

## Implementation facts verified in the repository

- The CAC certificate and status report identify StocMed Health Ltd as an active Nigerian private company limited by shares, RC 9540156, with the registered address stated in the public draft.
- The in-app patient assistant calls the Anthropic Messages API.
- The Prompt 5 inventory structurer calls the same first-party Anthropic Messages API using the commercial API key configured for the application.
- Personal search history expires after 365 days and has a scheduled purge function.
- Readable chat text expires after 30 days; the account-linked integrity hash expires after 365 days.
- Supabase, Vercel, Resend, Termii, Sentry, and Anthropic are all active or configured application providers.
- Sentry disables default personal-information collection and scrubs events and breadcrumbs before transmission.

## Terms of Service cleanup

The Terms of Service draft banner and placeholders have been removed on this branch. The page now uses the same provisional minimum age and verified public contact details as the privacy draft. Counsel must still review the commercial, liability, governing-law, and pharmacy-regulation terms before publication.

# StocMed native build context

## Build identity

- `appId` / package: `com.askstocmed.patient`
- App name: `StocMed`
- Publisher entity: **StocMed Health Technologies**. The grantee owns the Play account; Spur.ng is Admin/Developer only.
- Store category: **Medical**.

## Scope: patient surface only

- The app presents patient-facing medication search, pharmacy finder, reservations, profile, and authentication flows only.
- Pharmacy dashboard, POS, and settings must never surface in the native app.
- The native presentation must remove patient-visible pharmacy CTAs, including pharmacy role selection and registration links.
- Requests carrying `StocMedApp/1.0` receive the patient presentation: native `/signup` and `/complete-profile` resolve to patient-only variants, while `/pharmacy/*`, `/admin/*`, and `/insights` are redirected to the patient landing page.
- The user-agent distinction is presentation-only. It must not weaken persisted-role checks, authentication enforcement, or RLS.

## Architecture: Option C

- Android uses Capacitor as a server-backed WebView shell.
- `server.url` points to the live patient surface at `https://askstocmed.com`.
- The deployed Next.js server stays in place. Data, authentication, AI, prescription, and notification behavior remains server-enforced.
- Native traffic is identified with the custom user-agent marker `StocMedApp/1.0`.
- The isolated patient static-export refactor (Option B) is deferred until the pre-iOS workstream.

## Authentication invariant

- Patients may sign up through Google.
- Pharmacists may use Google only when a database account already exists.
- The OAuth callback must enforce this server-side from persisted `public.users.role`, never client metadata.
- Native OAuth changes only the transport: system browser to server callback to native deep link.
- Google OAuth must not run inside the WebView. Use the system browser and return through `com.askstocmed.patient://auth-callback`.
- Native Google OAuth starts at `/auth/native/start`, completes PKCE and persisted-role enforcement at `/auth-callback`, then returns a flow-correlated session through the custom-scheme fragment. The WebView accepts only the flow it initiated.

## Play Store path

- Ship to Internal testing while Google organization verification is pending.
- After organization verification and the D-U-N-S exemption are confirmed, the organization account can promote to production without the personal-account closed-testing path.
- Complete Android Developer Verification separately if Google prompts for it.

## Keystore discipline

- Use Play App Signing.
- The upload keystore must be backed up outside the repository before release signing.
- Record its path, alias, and passwords in the secrets vault. Never commit the keystore or its credentials.

## Deployment discipline

- Native work does not authorize schema changes.
- The normal-browser request path is an invariant: for the same route and standard browser user-agent, native changes must produce a byte-identical response body and identical stable response headers. Transport-volatile headers such as `Date` are excluded from the header comparison.
- Before any production database change: take a `pg_dump`, run a Migra diff, and use explicit file staging.
- Stop and obtain confirmation if native work implies a database, core-identity, or privileged-boundary change.

## Tracked implementation items

- **Deferred middleware hunk — resolved in Prompt 3:** the global role-less OAuth redirect is now coupled to explicit callback, native-start, profile-completion, and password-recovery exceptions, with regression coverage in `google-oauth-policy.test.ts`.
- **Pending device check — open:** run the Android build on a physical device (or a Play-equivalent emulator), verify the `StocMedApp/1.0` patient presentation, confirm `/pharmacy/*` returns to `/` without a redirect loop, and exercise the system-browser OAuth return through `com.askstocmed.patient://auth-callback` before release promotion. The current host has no Java runtime, so `assembleDebug` could not run here.

## Deferred pre-iOS work

- Isolate patient routes into `apps/patient` and statically export that tree.
- Keep OAuth callback, triage/assistant, digital prescriptions, and notifications behind trusted server endpoints.
- Split `MainLayout`, replace middleware with a persisted-role client guard, remove patient/auth `force-dynamic` declarations, add Suspense boundaries for `useSearchParams`, configure unoptimized images, and pin exact package versions.
- Do not add iOS until Apple enrollment `S6828Y85QT` completes and this refactor is finished.

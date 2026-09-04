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
- `server.url` points directly to the canonical live patient surface at `https://www.askstocmed.com`; do not use the redirecting apex host because Capacitor scopes document-start bridge injection to the exact configured origin.
- The deployed Next.js server stays in place. Data, authentication, AI, prescription, and notification behavior remains server-enforced.
- Native traffic is identified with the custom user-agent marker `StocMedApp/1.0`.
- The isolated patient static-export refactor (Option B) is deferred until the pre-iOS workstream.

## Authentication invariant

- Patients may sign up through Google.
- Pharmacists may use Google only when a database account already exists.
- The OAuth callback must enforce this server-side from persisted `public.users.role`, never client metadata.
- Native OAuth changes only the transport: system browser to server callback to native deep link.
- Google OAuth must not run inside the WebView. Use the system browser and return through `com.askstocmed.patient://auth-callback`.
- Native Google OAuth starts PKCE in the WebView with `skipBrowserRedirect`, opens the returned provider URL in the system browser, exchanges the custom-scheme callback code back inside the WebView, and then completes an authoritative persisted-role check at `/auth/native/complete`. Web OAuth continues through `/auth-callback` unchanged.
- Android must keep `CapacitorCookies.enabled` so Supabase SSR cookie writes are flushed through the native cookie manager and the authenticated session survives process death and app restart.
- Option C deploy invariant: the native shell loads the remote `https://www.askstocmed.com` bundle, so every native-facing web change must be deployed to production before emulator/device verification and before signing or distributing an APK/AAB. The required order is web commit/push → confirmed production deploy → production-backed device test → native signing/release.

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
- **Play rejection remediation — Internal test code 4 pending hardware verification:** Google rejected version code 2 after its review device timed out loading the apex URL. The apex origin was committed on `main`; this was not merely a stale local build. Version code 3 corrected the origin but was built from a stale local branch without `CapacitorCookies.enabled`, so it was superseded before hardware sign-off. Version code 4 / version 1.0.3 (`SHA-256 5d16c4ecf3e06090b169038deeedd4216620259c18b282c5d00c70f6f389f2bd`) is the first candidate built from current `main` with both the direct `https://www.askstocmed.com` origin and native cookie flushing. Before production promotion, install the exact Play-delivered code 4 build on a physical Android device, verify a force-quit cold launch reaches the patient dashboard without a WebView error and without an apex redirect, exercise the system-browser OAuth return through `com.askstocmed.patient://auth-callback`, verify the authenticated session survives another force-quit and cold restart, and confirm `/pharmacy/*` returns to `/` without a redirect loop.

## Deferred pre-iOS work

- Isolate patient routes into `apps/patient` and statically export that tree.
- Keep OAuth callback, triage/assistant, digital prescriptions, and notifications behind trusted server endpoints.
- Split `MainLayout`, replace middleware with a persisted-role client guard, remove patient/auth `force-dynamic` declarations, add Suspense boundaries for `useSearchParams`, configure unoptimized images, and pin exact package versions.
- Do not add iOS until Apple enrollment `S6828Y85QT` completes and this refactor is finished.

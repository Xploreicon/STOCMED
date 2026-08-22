# StocMed auth, email, and SMS provider setup

The repository work is complete, but the provider-console and DNS steps below
must be completed by an owner. Do not put any provider secret in a
`NEXT_PUBLIC_` variable.

## 1. Google and the branded Supabase Auth domain

1. In Google Cloud / Google Auth Platform, configure the OAuth consent screen:
   - App name: `StocMed`
   - Homepage: `https://askstocmed.com`
   - Authorized domain: `askstocmed.com`
   - Square StocMed logo, support email, and developer contact email
   - Scopes only: `openid`, `email`, `profile`
   - Publish to production and submit verification
2. In Supabase General Settings → Custom Domains, provision
   `auth.askstocmed.com`.
3. Add the CNAME and certificate-validation TXT record Supabase displays.
   Wait for DNS and TLS validation before activation.
4. Before activating, add both callbacks to the Google OAuth client:
   - Existing project callback (temporary rollback path)
   - `https://auth.askstocmed.com/auth/v1/callback`
5. In Supabase Auth → URL Configuration:
   - Site URL: `https://askstocmed.com`
   - Redirect URL: `https://askstocmed.com/auth-callback`
6. Enable Google in Supabase Auth with the verified Google client ID/secret.
   Supabase automatic identity linking must remain enabled. It links a verified
   Google identity to an existing same-email password account.
7. Set the production application variables:
   - `NEXT_PUBLIC_SUPABASE_URL=https://auth.askstocmed.com`
   - `NEXT_PUBLIC_SITE_URL=https://askstocmed.com`

Activation changes the Auth callback advertised by Supabase immediately. Test
login, signup, password reset, and session refresh before removing the old
Google callback.

## 2. Resend

1. Verify a dedicated sending subdomain in Resend and publish the exact
   DKIM/SPF records Resend supplies. Publish a DMARC record for the parent
   domain and monitor it before moving to a stricter policy.
2. Configure Supabase Auth custom SMTP (or use Resend's Supabase integration):
   - Host: `smtp.resend.com`
   - Port: `465` (implicit TLS) or `587` (STARTTLS)
   - Username: `resend`
   - Password: a restricted Resend API key
   - Sender name: `StocMed`
   - Sender email: an address on the verified domain, such as
     `no-reply@auth.askstocmed.com`
3. Keep Auth templates short and transactional. Their links should use the
   custom Auth domain.
4. For product email, create a separate API key and sender such as
   `StocMed <updates@askstocmed.com>`, then set all `RESEND_*` server variables
   listed in `.env.example`.
5. Register
   `https://askstocmed.com/api/webhooks/resend` for sent, delivered, delayed,
   bounced, complained, suppressed, and failed events. Store its signing secret
   as `RESEND_WEBHOOK_SECRET`.

## 3. Termii

1. Submit the `StocMed` Sender ID in Termii with these use cases:
   transactional reservation confirmations, pharmacy hold alerts, optional
   reservation reminders, and one opt-in daily stock digest.
2. Ask Termii to activate the Nigerian transactional/DND route. The code does
   not use the promotional route for these messages.
3. Copy the account-specific regional base URL from the Termii dashboard.
4. Set the `TERMII_*` variables from `.env.example`. Until the Sender ID and DND
   route are active, leave pharmacy/patient preferences off.
5. Register
   `https://askstocmed.com/api/webhooks/termii` and configure the webhook signing
   secret. Delivery status and cost are written to the notification audit.

## 4. Release sequence

1. Apply `20260731000000_oauth_profile_onboarding.sql`.
2. Apply `20260731010000_notification_outbox.sql`.
3. Apply `20260802000000_restrict_google_pharmacy_signup.sql`.
4. Apply `20260802010000_remove_legacy_profile_sync.sql`.
5. Deploy server variables and cron configuration.
6. Enable the pharmacy `notifications` feature.
7. Opt in to owner reservation SMS and/or daily stock digest at
   `/pharmacy/settings/notifications`. Nothing sends by default.
8. Patients can opt into product email and reservation reminder SMS from
   `/settings`. The initial reservation confirmation uses consent specific to
   that reservation.

## 5. Acceptance checks

- Google shows StocMed and the OAuth URL/callback stays on
  `askstocmed.com` / `auth.askstocmed.com`.
- A new Google account is sent to `/complete-profile`; repeated or linked
  sign-in does not create a second `public.users` row.
- A new Google account can complete patient onboarding only. A direct attempt
  to request a pharmacy role is rejected before either a public profile or
  pharmacy row is written, then the user is directed to email/password signup.
- An existing pharmacy account with a linked Google identity retains its
  persisted pharmacy role and signs in normally.
- Supabase Auth email arrives from the configured Auth subdomain and passes SPF,
  DKIM, and DMARC alignment checks.
- A product-email duplicate with the same idempotency key sends once and every
  product template has a signed unsubscribe path.
- Test Nigerian numbers in `0803…`, `234803…`, and `+234803…` forms; invalid or
  non-mobile values are rejected.
- A reservation remains successful if Termii is unavailable. The outbox shows a
  retry, and the dispatcher later sends it once.
- Owner SMS requires both the `notifications` feature and explicit preference.
  Stock alerts produce one digest per pharmacy/day.
- Confirm provider keys are absent from browser bundles and source control.

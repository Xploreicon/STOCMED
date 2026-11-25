# StocMed patient package

This independent Next.js package exports the existing patient interface for a bundled Capacitor client. The website, trusted Next.js APIs, and remote Android shell remain in the repository root.

Use Node 22 or newer. Install this package with `npm ci` from this directory, supply only the public Supabase URL and anon key in `.env.local`, and run:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run check:boundary
PATIENT_PROVENANCE_REF=origin/main npm run check:drift
```

After building with the test public URL `https://patient-test.supabase.co` and a placeholder anon key, run `npm run test:e2e` for intercepted browser smoke tests. Use `PATIENT_BROWSER_CHANNEL=chrome npm run test:e2e` to use installed Chrome instead of downloading Playwright's Chromium. The static test server listens only on loopback.

`out/` contains the static application. The child Capacitor config points there and has no remote `server.url`. Run any future iOS Capacitor commands from this directory. An iOS platform, signing configuration, and Apple capability changes have not been generated in I2.

The Supabase client uses PKCE and a dedicated WebView localStorage key. This is not a Keychain implementation. Persisted `public.users.role` drives the patient guard; existing RLS, RPCs, and trusted server checks still enforce authorization. Trusted requests use the fixed canonical HTTPS API origin with a fresh session bearer token and `credentials: 'omit'`. No provider or service keys belong in this package.

Reviewed sources are listed in `provenance.json`. The reference for this reconciliation is main at `c3c6b75`. Set `PATIENT_PROVENANCE_REF` to compare upstream sources with a Git revision while this worktree uses an older checkout. Without it, the check uses the checkout. Package-owned helpers and assets are always checked against the package files. The root TypeScript config excludes this package; root Tailwind, tests, lint defaults, and Capacitor config keep their own scopes.

Password recovery accepts the one-time code from the hosted reset email and requires an SDK-confirmed recovery session before the password form opens.

Browser smoke tests intercept Supabase and StocMed requests using test fixtures. They do not prove hosted redirect configuration, real OAuth/email delivery, iOS cold start, device storage, native file upload, WebView CORS, or signing. Those require the later hosted and device gates.

Existing product limits remain: search history is not a continuable chat thread; inventory results link to Maps searches; data erasure does not close the Auth account; legal placeholders need review. Clinical symptom intake is unavailable in this package. Full account deletion and store readiness remain separate work.

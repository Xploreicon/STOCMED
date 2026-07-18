# Pilot security-closure rollout

`pilot_security_closure.psql` is the fail-closed production provisioning companion for migrations `20260716000001` through `20260716000003`. It contains no credentials, missing SP identity, licence number, evidence path, or approval basis. The already-approved sole-admin email appears only as a required equality guard.

Do not run it until all required values and evidence have been independently approved. It aborts the whole serializable transaction if an identity is missing or ambiguous, a pharmacy ID/name/PCN does not match, private evidence objects are absent, another admin or central SP is enabled, the bucket controls differ, or the expected migration/RPC contract is missing.

## Coordinated-window order

1. Rotate the production database password and reconnect using only the fresh direct-database credential. Do not use the pooler for this transaction.
2. Take the agreed pre-deploy backup/export and verify the target project manually with `\conninfo`.
3. Apply migrations `20260716000001`, `20260716000002`, and `20260716000003` in the same controlled window.
4. Upload each approved premises certificate and superintendent annual licence to the private `pharmacy-verification-documents` bucket. The object names must be `<exact-pharmacy-uuid>/<filename>`.
5. Record each pharmacy's genuine acceptance of the exact version/hash during its migration-time bridge and use that non-future timestamp in `standards_accepted_at`; do not manufacture or backdate acceptance.
6. Run the provisioning script immediately. The legacy-bootstrap RPC gives eligible legacy rows a migration-time provisional bridge; the provisioning transaction either commits every identity, pharmacy, standards setting, reservation opt-in, and retention setting or commits none.
7. Deploy the application with staffed symptom intake still off and only the separately approved Rx-reservation flag state. Then run the live search/OTC/Rx smoke checks.

The SQL does not rotate credentials, upload documents, apply migrations, deploy the app, or perform patient-facing smoke tests.

## Required operator variables

Create a protected, uncommitted psql input file. Do not place it in this repository. It must define:

- `rollout_confirmation`: exactly `APPLY_STOCMED_PILOT_SECURITY_CLOSURE`.
- `sole_admin_email` and `admin_authorization_basis`. The email remains an explicit operator variable, but this rollout accepts only the approved `iconfavour005@gmail.com` identity.
- `central_sp_email`, `central_sp_licence_number`, `central_sp_licence_basis`, and `central_sp_authorization_basis`. The script writes the normalized licence number to the dedicated immutable pharmacist-licence identity column and records the evidence basis separately.
- `standards_version`, `standards_document_hash` (a 64-character SHA-256 hex digest), and `standards_change_basis`.
- `rx_retention_basis`; the duration is deliberately fixed by this rollout to 365 days but remains stored in the editable database policy table.
- `pilot_pharmacies_json`: a nonempty array with exactly these keys per pharmacy:
  - `pharmacy_id`
  - `pharmacy_name_confirmation`
  - `pcn_premises_number`
  - `premises_certificate_path`
  - `superintendent_annual_licence_path`
  - `standards_accepted_at`
  - `documents_evidence_basis`
  - `standards_evidence_basis`
  - `bootstrap_basis`
  - `reservations_enabled`

Use the exact live pharmacy UUID to resolve duplicate legacy display names. The script never selects a pharmacy by name and never rewrites a PCN: the supplied name and six-to-nine-digit premises number must already match that exact row. A migration-stamped revoked legacy duplicate may remain in history, but only the exact supplied row can be canonicalized to FULL. Any other current row using the PCN aborts the rollout, and a second bootstrap attempt for that PCN fails after the first exact row becomes current.

The input file should end with an include of the committed artifact:

```psql
\ir /absolute/path/to/stocmed-mvp/supabase/rollout/pilot_security_closure.psql
```

Run the protected input file with `psql -X` over the fresh direct connection. Keep `ON_ERROR_STOP` enabled and retain the complete operator log as deployment evidence. Never pass the database password as a committed psql variable.

## Bootstrap RPC contract

The rollout expects this migration-owned function exactly:

```text
bootstrap_legacy_full_pharmacy_verification(
  uuid, text, text, text, text, timestamptz,
  text, text, text, uuid
) returns public.pharmacies
```

The ordered arguments are pharmacy ID, premises path, superintendent-licence path, standards version, standards hash, standards acceptance time, document-review basis, standards-agreement basis, legacy-bootstrap basis, and accountable admin ID. If the migration changes that contract, update both the `to_regprocedure` preflight and invocation before the rollout; the current artifact intentionally aborts on any mismatch.

# Prompt 5 production rollout and rollback - 1 September 2026

## Approved scope

- Privacy Policy and Terms updates, including the verified controller details and Anthropic standard-retention disclosure.
- Prompt 5 residual-only AI inventory structurer.
- Database migrations, in order:
  1. `20260827020000_prompt5_ai_structuring.sql`
  2. `20260827021000_prompt5_batch_capture_flag.sql`
- Production environment gate: `AI_PROCESSING_PRIVACY_DISCLOSURE_LIVE=true`, only after the live privacy page is verified.
- Prompt 6 is excluded.

## Known-good application rollback target

- Privacy-only deployment: `https://stocmed-nsun5vg4d-xploreicons-projects.vercel.app`
- Privacy-only Vercel deployment ID: `dpl_AZ3fbc5t29qjonXoy6SyZ9MRjknV`
- Pre-Prompt-5 application commit: `e5e9691059d7e4f28751b88af41c3634f6b61c17`

## Production backup

- Planned file: `reports/backups/production-pre-prompt5-20260901-110547.dump`
- Size: 2.8 MB custom-format PostgreSQL archive
- SHA-256: `0a47a371c71127eb331a557583583f06dcbb6a092f14b9b859ccddade07b565d`
- Archive verification: `pg_restore --list` completed successfully with 1,281 archive-list lines

## Rollback order

1. Disable or remove `AI_PROCESSING_PRIVACY_DISCLOSURE_LIVE` and redeploy so no new AI jobs are claimed.
2. Roll the Vercel application back to the privacy-only deployment above.
3. Reverse the database migrations in reverse order: `20260827021000`, then `20260827020000`.
4. Because both migrations replace database functions and may have processed durable queue/candidate data, the authoritative rollback is restore-from-dump rather than hand-editing production objects.

Example restore command, run only during an approved rollback window:

```sh
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$STOCMED_DATABASE_URL" \
  reports/backups/production-pre-prompt5-20260901-110547.dump
```

After restoration, verify the catalogue count remains 3,419, Prompt 5 columns/tables are absent, the privacy page remains live, and the inventory importer still completes the existing set-based match path.

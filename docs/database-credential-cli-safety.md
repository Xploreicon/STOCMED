# Database credential safety for operator commands

## Confirmed leak chain

The recurring disclosures did not come from a StocMed application logger or a
database error response. They came from combining two unsafe operator actions:

1. a password-bearing PostgreSQL URL was read from a local runtime secret;
2. that full URL was supplied to `pg_dump` as a command-line argument;
3. a later process diagnostic requested each process's full command line; and
4. the diagnostic faithfully printed the URL, including its embedded password.

The repository audit found no application code that logs `DATABASE_URL`. It did
find rollback instructions that used `pg_restore --dbname "$...DATABASE_URL"`.
That expansion has the same vulnerability: command arguments can be captured by
process listings, agent tool transcripts, shell tracing, crash reports, and
some CI command logs.

The URL contains a password because PostgreSQL connection URLs encode the user,
password, host, port, and database in one value. Keeping that value in a secret
store or protected local file is normal; expanding it into argv is not.

## Required command path

Use `scripts/db/safe-postgres-archive.mjs` for backups, archive verification,
and full-restore fallback. It:

- accepts a path to a mode-0600 connection file, never a URL argument;
- parses the secret only inside the operator process;
- invokes PostgreSQL tools with host, port, username, and database arguments;
- supplies the password through a temporary mode-0600 `PGPASSFILE`;
- gives the child a minimal environment rather than forwarding every secret;
- removes the password file when the command exits;
- writes backups under a `.partial-<pid>` name and publishes them atomically
  only after `pg_dump` exits successfully, the TOC parses, and an offline
  `pg_restore` streams and decompresses every archive entry;
- writes a SHA-256 sidecar and refuses destructive restore without both a valid
  checksum and the explicit `RESTORE_VERIFIED_ARCHIVE` confirmation.

Example:

```sh
npm run db:archive -- backup \
  --connection-file "$STOCMED_PRODUCTION_DATABASE_URL_FILE" \
  --archive /absolute/gitignored/path/production-pre-release.dump
```

The connection file must live outside the repository and be created through a
password manager, secret manager, or protected interactive input. Do not put the
URL itself in shell history. After the exposed password is rotated, remove stale
copies from exported shell variables and local configuration that no longer
needs direct database access.

## Safe diagnostics

Treat diagnostic output as public. While database tooling is running:

- do not run process views that include command arguments or environments;
- do not run `printenv`, environment dumps, or shell xtrace;
- use `lsof` with the exact archive path to check whether a dump still has the
  file open; or
- request only PID, state, elapsed time, and executable name from a process
  viewer.

The safe wrapper removes the argv leak, but it cannot make a previously exposed
password valid again. Rotate the currently exposed production database password
before another production query, backup, migration, or restore.

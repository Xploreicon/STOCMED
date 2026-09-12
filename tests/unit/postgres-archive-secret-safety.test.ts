import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = resolve('scripts/db/safe-postgres-archive.mjs')
const temporaryDirectories: string[] = []

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'stocmed-pg-secret-test-'))
  temporaryDirectories.push(directory)
  const connectionFile = join(directory, 'connection-url')
  const archive = join(directory, 'archive.dump')
  const password = 'not-a-real-password:with-specials'
  const databaseUrl = `postgresql://operator:${encodeURIComponent(password)}@db.example.invalid:5432/postgres?sslmode=require`
  writeFileSync(connectionFile, `${databaseUrl}\n`, { mode: 0o600 })
  return { archive, connectionFile, databaseUrl, password }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('secret-safe PostgreSQL archive runner', () => {
  it('keeps the password and full URL out of the child process plan', () => {
    const { archive, connectionFile, databaseUrl, password } = fixture()
    const result = spawnSync(process.execPath, [
      script, 'backup', '--connection-file', connectionFile,
      '--archive', archive, '--dry-run',
    ], { encoding: 'utf8' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).not.toContain(password)
    expect(result.stdout).not.toContain(databaseUrl)
    const plan = JSON.parse(result.stdout)
    expect(plan.command).toBe('pg_dump')
    expect(plan.args).toContain('--dbname')
    expect(plan.args).toContain('postgres')
    expect(plan.args.join(' ')).not.toMatch(/postgres(?:ql)?:\/\//)
    expect(plan.env.PGPASSFILE).toContain('ephemeral')
  })

  it('can route a protected Supabase pooler credential through the direct endpoint', () => {
    const directory = mkdtempSync(join(tmpdir(), 'stocmed-pg-direct-test-'))
    temporaryDirectories.push(directory)
    const projectRef = 'abcdefghijklmnopqrst'
    const connectionFile = join(directory, 'connection-url')
    const archive = join(directory, 'archive.dump')
    const password = 'direct-not-real-password'
    const databaseUrl = `postgresql://postgres.${projectRef}:${password}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`
    writeFileSync(connectionFile, `${databaseUrl}\n`, { mode: 0o600 })

    const result = spawnSync(process.execPath, [
      script, 'backup', '--connection-file', connectionFile,
      '--direct-project-ref', projectRef, '--archive', archive, '--dry-run',
    ], { encoding: 'utf8' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).not.toContain(password)
    expect(result.stdout).not.toContain(databaseUrl)
    const plan = JSON.parse(result.stdout)
    expect(plan.args).toContain(`db.${projectRef}.supabase.co`)
    expect(plan.args).toContain('postgres')
    expect(plan.args.join(' ')).not.toMatch(/postgres(?:ql)?:\/\//)
  })

  it('supports batched INSERT output when a pooler terminates COPY streaming', () => {
    const { archive, connectionFile, databaseUrl, password } = fixture()
    const result = spawnSync(process.execPath, [
      script, 'backup', '--connection-file', connectionFile,
      '--archive', archive, '--row-inserts', '--dry-run',
    ], { encoding: 'utf8' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).not.toContain(password)
    expect(result.stdout).not.toContain(databaseUrl)
    const plan = JSON.parse(result.stdout)
    expect(plan.args).toContain('--rows-per-insert=100')
  })

  it('rejects direct routing to a different Supabase project', () => {
    const directory = mkdtempSync(join(tmpdir(), 'stocmed-pg-direct-mismatch-test-'))
    temporaryDirectories.push(directory)
    const connectionFile = join(directory, 'connection-url')
    const archive = join(directory, 'archive.dump')
    writeFileSync(
      connectionFile,
      'postgresql://postgres.abcdefghijklmnopqrst:not-real@pooler.example.invalid:5432/postgres\n',
      { mode: 0o600 },
    )

    const result = spawnSync(process.execPath, [
      script, 'backup', '--connection-file', connectionFile,
      '--direct-project-ref', 'zyxwvutsrqponmlkjihg', '--archive', archive, '--dry-run',
    ], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('does not belong to the requested Supabase project')
  })

  it('rejects a database URL supplied as an argv value without echoing it', () => {
    const { archive, databaseUrl, password } = fixture()
    const result = spawnSync(process.execPath, [
      script, 'backup', '--connection-file', databaseUrl,
      '--archive', archive, '--dry-run',
    ], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must never be passed on the command line')
    expect(result.stderr).not.toContain(password)
    expect(result.stderr).not.toContain(databaseUrl)
  })

  it('refuses a group- or world-readable connection secret', () => {
    const { archive, connectionFile, password } = fixture()
    chmodSync(connectionFile, 0o644)
    const result = spawnSync(process.execPath, [
      script, 'backup', '--connection-file', connectionFile,
      '--archive', archive, '--dry-run',
    ], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must have mode 0600')
    expect(result.stderr).not.toContain(password)
  })

  it('keeps SQL execution credentials out of the psql process arguments', () => {
    const { connectionFile, databaseUrl, password } = fixture()
    const sqlFile = join(temporaryDirectories[0], 'operation.sql')
    writeFileSync(sqlFile, 'SELECT 1;\n')
    const result = spawnSync(process.execPath, [
      script, 'execute', '--connection-file', connectionFile,
      '--sql-file', sqlFile, '--confirm', 'EXECUTE_REVIEWED_SQL_FILE', '--dry-run',
    ], { encoding: 'utf8' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).not.toContain(password)
    expect(result.stdout).not.toContain(databaseUrl)
    const plan = JSON.parse(result.stdout)
    expect(plan.command).toBe('psql')
    expect(plan.args).toContain('--file')
    expect(plan.args.join(' ')).not.toMatch(/postgres(?:ql)?:\/\//)
  })

  it('plans a schema-only preview bootstrap and never restores production table data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'stocmed-pg-preview-test-'))
    temporaryDirectories.push(directory)
    const projectRef = 'abcdefghijklmnopqrst'
    const connectionFile = join(directory, 'connection-url')
    const archive = join(directory, 'archive.dump')
    const password = 'preview-not-real-password'
    const databaseUrl = `postgresql://postgres.${projectRef}:${password}@pooler.example.invalid:5432/postgres`
    writeFileSync(connectionFile, `${databaseUrl}\n`, { mode: 0o600 })
    const result = spawnSync(process.execPath, [
      script, 'bootstrap-preview', '--connection-file', connectionFile,
      '--archive', archive, '--expected-preview-ref', projectRef,
      '--confirm', 'BOOTSTRAP_DATA_FREE_PREVIEW', '--dry-run',
    ], { encoding: 'utf8' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).not.toContain(password)
    expect(result.stdout).not.toContain(databaseUrl)
    const plan = JSON.parse(result.stdout)
    expect(plan.commands[0].args.join(' ')).toContain('CREATE EXTENSION pg_trgm WITH SCHEMA public')
    expect(plan.commands[1].args).toContain('--schema-only')
    expect(plan.commands[1].args).toContain('public')
    expect(plan.commands).toHaveLength(2)
    expect(plan.commands.flatMap((command: { args: string[] }) => command.args))
      .not.toContain('--data-only')
  })

  it('keeps rollback docs off raw database-URL command arguments', () => {
    const files = [
      'docs/catalogue-admin-review-rollback-2026-09-06.md',
      'docs/inventory-read-rollback-2026-09-05.md',
      'docs/ship-gate-a-rollback-2026-08-27.md',
    ]
    for (const file of files) {
      const content = readFileSync(resolve(file), 'utf8')
      expect(content, file).not.toMatch(/--dbname\s+["']?\$\{?\w*(?:DATABASE_URL|PRODUCTION_URL)/)
      expect(content, file).not.toMatch(/(?:pg_dump|pg_restore|psql)[^\n]*postgres(?:ql)?:\/\//i)
    }
  })

  it('rejects a checksum-valid archive whose payload cannot be fully read', () => {
    const directory = mkdtempSync(join(tmpdir(), 'stocmed-pg-truncated-test-'))
    temporaryDirectories.push(directory)
    const archive = join(directory, 'truncated.dump')
    const checksum = `${archive}.sha256`
    const fakeBin = join(directory, 'bin')
    const fakePgRestore = join(fakeBin, 'pg_restore')
    mkdirSync(fakeBin)
    writeFileSync(archive, 'checksum-valid-but-truncated')
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex')
    writeFileSync(checksum, `${digest}  ${archive}\n`)
    writeFileSync(fakePgRestore, `#!/bin/sh
if [ "$1" = "--list" ]; then
  echo '; TOC Entries: 42'
  exit 0
fi
echo 'unexpected end of file' >&2
exit 1
`)
    chmodSync(fakePgRestore, 0o700)

    const result = spawnSync(process.execPath, [
      script, 'verify', '--archive', archive, '--checksum-file', checksum,
    ], {
      encoding: 'utf8',
      env: { PATH: `${fakeBin}:/usr/bin:/bin`, LANG: 'C', NODE_ENV: 'test' },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unexpected end of file')
  })

  it('requires the catalogue loader to use a protected connection-file reference', () => {
    const content = readFileSync(resolve('scripts/catalogue/import-source-package.mjs'), 'utf8')
    expect(content).toContain('CATALOGUE_DATABASE_URL_FILE')
    expect(content).toContain('Raw catalogue database URLs are forbidden')
    expect(content).toContain('CATALOGUE_PRODUCTION_EXPECTED_PROJECT_REF')
    expect(content).toContain('LOAD_REVIEW_EVIDENCE_ONLY')
    expect(content).not.toContain(
      'const databaseUrl = process.env.CATALOGUE_STAGING_DATABASE_URL\n',
    )
  })
})

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
})

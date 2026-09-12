#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  access,
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const RESTORE_CONFIRMATION = 'RESTORE_VERIFIED_ARCHIVE'
const SQL_CONFIRMATION = 'EXECUTE_REVIEWED_SQL_FILE'
const PREVIEW_BOOTSTRAP_CONFIRMATION = 'BOOTSTRAP_DATA_FREE_PREVIEW'

function usage() {
  return `Usage:
  node scripts/db/safe-postgres-archive.mjs backup \\
    --connection-file /protected/path/database-url \\
    [--direct-project-ref abcdefghijklmnopqrst] \\
    [--row-inserts] \\
    --archive /gitignored/path/backup.dump

  node scripts/db/safe-postgres-archive.mjs verify \\
    --archive /gitignored/path/backup.dump \\
    [--checksum-file /gitignored/path/backup.dump.sha256]

  node scripts/db/safe-postgres-archive.mjs restore \\
    --connection-file /protected/path/database-url \\
    --archive /gitignored/path/backup.dump \\
    [--checksum-file /gitignored/path/backup.dump.sha256] \\
    --confirm ${RESTORE_CONFIRMATION}

  node scripts/db/safe-postgres-archive.mjs execute \\
    --connection-file /protected/path/database-url \\
    --sql-file /reviewed/path/operation.sql \\
    --confirm ${SQL_CONFIRMATION}

  node scripts/db/safe-postgres-archive.mjs bootstrap-preview \\
    --connection-file /protected/path/preview-database-url \\
    --archive /gitignored/path/verified-production-backup.dump \\
    --expected-preview-ref abcdefghijklmnopqrst \\
    --confirm ${PREVIEW_BOOTSTRAP_CONFIRMATION}

Add --dry-run to print the credential-free child-process plan. Raw database
URLs are never accepted as command-line arguments.`
}

export function parseArgs(argv) {
  const [command, ...rest] = argv
  if (!['backup', 'verify', 'restore', 'execute', 'bootstrap-preview'].includes(command)) {
    throw new Error(usage())
  }

  const parsed = { command, dryRun: false }
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === '--dry-run') {
      parsed.dryRun = true
      continue
    }
    if (argument === '--row-inserts') {
      parsed.row_inserts = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      parsed.help = true
      continue
    }
    if (![
      '--connection-file', '--archive', '--checksum-file', '--sql-file', '--confirm',
      '--expected-preview-ref', '--direct-project-ref',
    ].includes(argument)) {
      throw new Error(`Unsupported argument: ${argument}`)
    }
    const value = rest[++index]
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
    if (/^postgres(?:ql)?:\/\//i.test(value)) {
      throw new Error('A raw database URL must never be passed on the command line')
    }
    parsed[argument.slice(2).replaceAll('-', '_')] = value
  }

  if (parsed.help) return parsed
  if (command !== 'execute' && !parsed.archive) throw new Error('--archive is required')
  if (command !== 'verify' && !parsed.connection_file) {
    throw new Error('--connection-file is required')
  }
  if (command === 'restore' && parsed.confirm !== RESTORE_CONFIRMATION) {
    throw new Error(`Restore requires --confirm ${RESTORE_CONFIRMATION}`)
  }
  if (command === 'execute') {
    if (!parsed.sql_file) throw new Error('--sql-file is required')
    if (parsed.confirm !== SQL_CONFIRMATION) {
      throw new Error(`SQL execution requires --confirm ${SQL_CONFIRMATION}`)
    }
  }
  if (command === 'bootstrap-preview') {
    if (!/^[a-z]{20}$/.test(parsed.expected_preview_ref || '')) {
      throw new Error('--expected-preview-ref must be the 20-character hosted preview project ref')
    }
    if (parsed.confirm !== PREVIEW_BOOTSTRAP_CONFIRMATION) {
      throw new Error(`Preview bootstrap requires --confirm ${PREVIEW_BOOTSTRAP_CONFIRMATION}`)
    }
  }
  if (parsed.direct_project_ref && !/^[a-z]{20}$/.test(parsed.direct_project_ref)) {
    throw new Error('--direct-project-ref must be the 20-character Supabase project ref')
  }
  if (parsed.row_inserts && command !== 'backup') {
    throw new Error('--row-inserts is supported only for backups')
  }
  return parsed
}

function decodeUrlComponent(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('The protected database URL contains invalid encoding')
  }
}

export function parseConnectionUrl(secret) {
  let url
  try {
    url = new URL(secret)
  } catch {
    throw new Error('The protected connection file does not contain a valid database URL')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('The protected connection file must contain a PostgreSQL URL')
  }

  const connection = {
    host: url.hostname,
    port: url.port || '5432',
    username: decodeUrlComponent(url.username),
    password: decodeUrlComponent(url.password),
    database: decodeUrlComponent(url.pathname.replace(/^\/+/, '')),
    sslMode: url.searchParams.get('sslmode') || (
      ['localhost', '127.0.0.1', '::1'].includes(url.hostname) ? 'prefer' : 'require'
    ),
  }
  if (!connection.host || !connection.username || !connection.password || !connection.database) {
    throw new Error('The protected database URL is missing a host, user, password, or database')
  }
  return connection
}

export function connectionArgs(connection) {
  return [
    '--host', connection.host,
    '--port', connection.port,
    '--username', connection.username,
    '--dbname', connection.database,
  ]
}

function assertExpectedPreview(connection, projectRef) {
  if (!connection.host.includes(projectRef) && !connection.username.includes(projectRef)) {
    throw new Error('Connection does not belong to the explicitly named hosted preview project')
  }
}

function useSupabaseDirectConnection(connection, projectRef) {
  if (!connection.host.includes(projectRef) && !connection.username.includes(projectRef)) {
    throw new Error('Protected connection does not belong to the requested Supabase project')
  }
  return {
    ...connection,
    host: `db.${projectRef}.supabase.co`,
    port: '5432',
    username: 'postgres',
  }
}

function pgPassEscape(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll(':', '\\:')
}

async function readProtectedConnection(path) {
  const absolutePath = resolve(path)
  const metadata = await lstat(absolutePath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('The database connection secret must be a regular, non-symlink file')
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error('The database connection secret must have mode 0600 (no group/world access)')
  }
  const secret = (await readFile(absolutePath, 'utf8')).trim()
  return parseConnectionUrl(secret)
}

function childEnvironment(connection, pgPassFile) {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    LANG: process.env.LANG || 'C',
    LC_ALL: process.env.LC_ALL || 'C',
    PGCONNECT_TIMEOUT: '20',
    PGPASSFILE: pgPassFile,
    PGSSLMODE: connection.sslMode,
  }
}

function pgDumpOptions(args, outputPath) {
  return [
    '--format=custom', '--no-owner', '--no-acl',
    ...(args.row_inserts ? ['--rows-per-insert=100'] : []),
    '--file', outputPath,
  ]
}

async function withPgPass(connection, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'stocmed-pgpass-'))
  await chmod(directory, 0o700)
  const passFile = join(directory, 'pgpass')
  const line = [connection.host, connection.port, connection.database,
    connection.username, connection.password].map(pgPassEscape).join(':')
  await writeFile(passFile, `${line}\n`, { mode: 0o600 })
  try {
    return await callback(passFile)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function run(command, args, env = undefined, options = {}) {
  const { discardStdout = false } = options
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', discardStdout ? 'ignore' : 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout?.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', () => reject(new Error(`${command} could not be started`)))
    child.on('close', (code, signal) => {
      const output = Buffer.concat(stdout).toString('utf8')
      const errorOutput = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) {
        reject(new Error(`${command} failed${signal ? ` (${signal})` : ''}${
          errorOutput ? `: ${errorOutput}` : ''}`))
        return
      }
      resolvePromise(output)
    })
  })
}

async function sha256(path) {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

async function validateArchivePayload(archive) {
  // A TOC listing alone can succeed for a truncated custom-format archive.
  // Rendering every entry forces pg_restore to read and decompress the full
  // payload without connecting to (or mutating) a database. Discard the SQL
  // stream so verification does not need a second dump-sized file.
  await run('pg_restore', ['--file=-', archive], undefined, { discardStdout: true })
}

async function verifyArchive(archive, checksumFile) {
  const absoluteArchive = resolve(archive)
  await access(absoluteArchive, fsConstants.R_OK)
  const digest = await sha256(absoluteArchive)
  const absoluteChecksum = resolve(checksumFile || `${archive}.sha256`)
  const recorded = (await readFile(absoluteChecksum, 'utf8')).trim().split(/\s+/)[0]
  if (!/^[0-9a-f]{64}$/.test(recorded) || recorded !== digest) {
    throw new Error('Archive SHA-256 does not match its checksum file')
  }
  const listing = await run('pg_restore', ['--list', absoluteArchive])
  const tocEntries = Number(listing.match(/TOC Entries:\s*(\d+)/)?.[1] || 0)
  if (!tocEntries) throw new Error('pg_restore could not confirm archive TOC entries')
  await validateArchivePayload(absoluteArchive)
  return {
    archive: absoluteArchive,
    checksumFile: absoluteChecksum,
    sha256: digest,
    tocEntries,
    fullPayloadValidated: true,
  }
}

function dryRunPlan(args, connection) {
  if (args.command === 'verify') {
    return {
      commands: [
        { command: 'pg_restore', args: ['--list', resolve(args.archive)] },
        { command: 'pg_restore', args: ['--file=-', resolve(args.archive)], stdout: '[discarded after full payload read]' },
      ],
    }
  }
  const credentialFreeConnection = connectionArgs(connection)
  if (args.command === 'backup') {
    return {
      command: 'pg_dump',
      args: [...pgDumpOptions(args, `${resolve(args.archive)}.partial-[pid]`),
        ...credentialFreeConnection],
      env: { PGPASSFILE: '[ephemeral mode-0600 file]', PGSSLMODE: connection.sslMode },
    }
  }
  if (args.command === 'execute') {
    return {
      command: 'psql',
      args: ['-X', '--set', 'ON_ERROR_STOP=1', ...connectionArgs(connection),
        '--file', resolve(args.sql_file)],
      env: { PGPASSFILE: '[ephemeral mode-0600 file]', PGSSLMODE: connection.sslMode },
    }
  }
  if (args.command === 'bootstrap-preview') {
    assertExpectedPreview(connection, args.expected_preview_ref)
    const archive = resolve(args.archive)
    const connectionOptions = connectionArgs(connection)
    return {
      commands: [
        {
          command: 'psql',
          args: ['-X', '--set', 'ON_ERROR_STOP=1', ...connectionOptions,
            '--command', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION pg_database_owner; CREATE EXTENSION pg_trgm WITH SCHEMA public'],
        },
        {
          command: 'pg_restore',
          args: ['--schema-only', '--schema', 'public', '--no-owner', '--no-acl',
            ...connectionOptions, archive],
        },
      ],
      env: { PGPASSFILE: '[ephemeral mode-0600 file]', PGSSLMODE: connection.sslMode },
    }
  }
  return {
    command: 'pg_restore',
    args: ['--exit-on-error', '--clean', '--if-exists', '--no-owner', '--no-acl',
      ...credentialFreeConnection, resolve(args.archive)],
    env: { PGPASSFILE: '[ephemeral mode-0600 file]', PGSSLMODE: connection.sslMode },
  }
}

async function backup(args, connection) {
  const archive = resolve(args.archive)
  const partial = `${archive}.partial-${process.pid}`
  await access(dirname(archive), fsConstants.W_OK)
  try {
    await access(archive, fsConstants.F_OK)
    throw new Error('Refusing to overwrite an existing archive')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  try {
    await withPgPass(connection, async (passFile) => {
      await run('pg_dump', [
        ...pgDumpOptions(args, partial),
        ...connectionArgs(connection),
      ], childEnvironment(connection, passFile))
    })
    const listing = await run('pg_restore', ['--list', partial])
    const tocEntries = Number(listing.match(/TOC Entries:\s*(\d+)/)?.[1] || 0)
    if (!tocEntries) throw new Error('The completed dump has no readable TOC entries')
    await validateArchivePayload(partial)
    const digest = await sha256(partial)
    await rename(partial, archive)
    const checksumFile = `${archive}.sha256`
    await writeFile(checksumFile, `${digest}  ${archive}\n`, { mode: 0o644 })
    return { archive, checksumFile, sha256: digest, tocEntries, fullPayloadValidated: true }
  } catch (error) {
    await unlink(partial).catch(() => {})
    throw error
  }
}

async function restore(args, connection) {
  const verified = await verifyArchive(args.archive, args.checksum_file)
  await withPgPass(connection, async (passFile) => {
    await run('pg_restore', [
      '--exit-on-error', '--clean', '--if-exists', '--no-owner', '--no-acl',
      ...connectionArgs(connection), verified.archive,
    ], childEnvironment(connection, passFile))
  })
  return { restored: true, ...verified }
}

async function executeSql(args, connection) {
  const sqlFile = resolve(args.sql_file)
  const metadata = await lstat(sqlFile)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('The reviewed SQL input must be a regular, non-symlink file')
  }
  const output = await withPgPass(connection, async (passFile) => {
    return await run('psql', [
      '-X', '--set', 'ON_ERROR_STOP=1', ...connectionArgs(connection),
      '--file', sqlFile,
    ], childEnvironment(connection, passFile))
  })
  return { executed: true, sqlFile, output }
}

async function bootstrapPreview(args, connection) {
  assertExpectedPreview(connection, args.expected_preview_ref)
  const verified = await verifyArchive(args.archive, args.checksum_file)
  const connectionOptions = connectionArgs(connection)
  await withPgPass(connection, async (passFile) => {
    const env = childEnvironment(connection, passFile)
    await run('psql', [
      '-X', '--set', 'ON_ERROR_STOP=1', ...connectionOptions,
      '--command', [
        'DROP SCHEMA IF EXISTS public CASCADE',
        'CREATE SCHEMA public AUTHORIZATION pg_database_owner',
        'GRANT USAGE ON SCHEMA public TO anon, authenticated',
        'GRANT ALL ON SCHEMA public TO postgres, service_role',
        'CREATE EXTENSION pg_trgm WITH SCHEMA public',
      ].join('; '),
    ], env)
    await run('pg_restore', [
      '--exit-on-error', '--schema-only', '--schema', 'public', '--no-owner',
      '--no-acl', ...connectionOptions, verified.archive,
    ], env)
  })
  return {
    bootstrapped: true,
    dataRestored: false,
    migrationHistoryRestored: false,
    ...verified,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }
  let connection = args.command === 'verify'
    ? null
    : await readProtectedConnection(args.connection_file)
  if (connection && args.direct_project_ref) {
    connection = useSupabaseDirectConnection(connection, args.direct_project_ref)
  }

  if (args.dryRun) {
    console.log(JSON.stringify(dryRunPlan(args, connection), null, 2))
    return
  }

  const result = args.command === 'backup'
    ? await backup(args, connection)
    : args.command === 'restore'
      ? await restore(args, connection)
      : args.command === 'execute'
        ? await executeSql(args, connection)
        : args.command === 'bootstrap-preview'
          ? await bootstrapPreview(args, connection)
      : await verifyArchive(args.archive, args.checksum_file)
  console.log(JSON.stringify(result, null, 2))
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'PostgreSQL archive command failed')
    process.exitCode = 1
  })
}

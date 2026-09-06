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

function usage() {
  return `Usage:
  node scripts/db/safe-postgres-archive.mjs backup \\
    --connection-file /protected/path/database-url \\
    --archive /gitignored/path/backup.dump

  node scripts/db/safe-postgres-archive.mjs verify \\
    --archive /gitignored/path/backup.dump \\
    [--checksum-file /gitignored/path/backup.dump.sha256]

  node scripts/db/safe-postgres-archive.mjs restore \\
    --connection-file /protected/path/database-url \\
    --archive /gitignored/path/backup.dump \\
    [--checksum-file /gitignored/path/backup.dump.sha256] \\
    --confirm ${RESTORE_CONFIRMATION}

Add --dry-run to print the credential-free child-process plan. Raw database
URLs are never accepted as command-line arguments.`
}

export function parseArgs(argv) {
  const [command, ...rest] = argv
  if (!['backup', 'verify', 'restore'].includes(command)) {
    throw new Error(usage())
  }

  const parsed = { command, dryRun: false }
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === '--dry-run') {
      parsed.dryRun = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      parsed.help = true
      continue
    }
    if (!['--connection-file', '--archive', '--checksum-file', '--confirm'].includes(argument)) {
      throw new Error(`Unsupported argument: ${argument}`)
    }
    const value = rest[++index]
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
    if (/^postgres(?:ql)?:\/\//i.test(value)) {
      throw new Error('A raw database URL must never be passed on the command line')
    }
    parsed[argument.slice(2).replace('-', '_')] = value
  }

  if (parsed.help) return parsed
  if (!parsed.archive) throw new Error('--archive is required')
  if (command !== 'verify' && !parsed.connection_file) {
    throw new Error('--connection-file is required')
  }
  if (command === 'restore' && parsed.confirm !== RESTORE_CONFIRMATION) {
    throw new Error(`Restore requires --confirm ${RESTORE_CONFIRMATION}`)
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

async function run(command, args, env = undefined) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
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
  return { archive: absoluteArchive, checksumFile: absoluteChecksum, sha256: digest, tocEntries }
}

function dryRunPlan(args, connection) {
  if (args.command === 'verify') {
    return { command: 'pg_restore', args: ['--list', resolve(args.archive)] }
  }
  const credentialFreeConnection = connectionArgs(connection)
  if (args.command === 'backup') {
    return {
      command: 'pg_dump',
      args: ['--format=custom', '--no-owner', '--no-acl',
        '--file', `${resolve(args.archive)}.partial-[pid]`, ...credentialFreeConnection],
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
        '--format=custom', '--no-owner', '--no-acl', '--file', partial,
        ...connectionArgs(connection),
      ], childEnvironment(connection, passFile))
    })
    const listing = await run('pg_restore', ['--list', partial])
    const tocEntries = Number(listing.match(/TOC Entries:\s*(\d+)/)?.[1] || 0)
    if (!tocEntries) throw new Error('The completed dump has no readable TOC entries')
    const digest = await sha256(partial)
    await rename(partial, archive)
    const checksumFile = `${archive}.sha256`
    await writeFile(checksumFile, `${digest}  ${archive}\n`, { mode: 0o644 })
    return { archive, checksumFile, sha256: digest, tocEntries }
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }
  const connection = args.command === 'verify'
    ? null
    : await readProtectedConnection(args.connection_file)

  if (args.dryRun) {
    console.log(JSON.stringify(dryRunPlan(args, connection), null, 2))
    return
  }

  const result = args.command === 'backup'
    ? await backup(args, connection)
    : args.command === 'restore'
      ? await restore(args, connection)
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

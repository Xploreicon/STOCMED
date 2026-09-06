#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import process from 'node:process'
const SOURCE_KEY = 'stocmed-nigeria-catalogue'

function usage() {
  return `Usage:
  node scripts/catalogue/import-source-package.mjs \\
    --package-dir /path/to/package \\
    --package-zip /path/to/package.zip \\
    [--package-sha256 <expected-zip-sha256>] \\
    [--dry-run]

Database imports require both:
  CATALOGUE_STAGING_DATABASE_URL_FILE=/protected/path/non-production-database-url
  CATALOGUE_STAGING_CONFIRM_NON_PRODUCTION=YES

The importer validates every manifest digest and JSONL row count before opening
the database. It writes source evidence and review queues only; never products.`
}

function parseArgs(argv) {
  const parsed = { dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--dry-run') {
      parsed.dryRun = true
    } else if (value === '--package-dir') {
      parsed.packageDir = argv[++index]
    } else if (value === '--package-sha256') {
      parsed.expectedPackageSha256 = argv[++index]
    } else if (value === '--package-zip') {
      parsed.packageZip = argv[++index]
    } else if (value === '--help' || value === '-h') {
      console.log(usage())
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${value}`)
    }
  }

  if (!parsed.packageDir) throw new Error('--package-dir is required')
  if (!parsed.packageZip) throw new Error('--package-zip is required')
  if (parsed.expectedPackageSha256
    && !/^[0-9a-f]{64}$/.test(parsed.expectedPackageSha256)) {
    throw new Error('--package-sha256 must be a lowercase 64-character SHA-256 digest when supplied')
  }
  return parsed
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function stableSuffix(...values) {
  return sha256(values.map((value) => String(value ?? '')).join('\u0000')).slice(0, 24)
}

function requiredKey(row, key, dataset) {
  const value = row[key]
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(`${dataset}: required identity key ${key} is missing`)
  }
  return String(value)
}

function recordIdFor(dataset, row, lineDigest) {
  switch (dataset) {
    case 'nafdac_human_medicines':
    case 'nafdac_other_regulated_products':
    case 'nigeria_market_candidates':
    case 'unregistered_and_flagged_products':
      return requiredKey(row, 'record_id', dataset)
    case 'atc_category_framework':
      return `atc:${requiredKey(row, 'atc_level1', dataset)}`
    case 'barcode_candidates':
      return `barcode:${requiredKey(row, 'gtin_candidate', dataset)}:${stableSuffix(row.product_name)}`
    case 'generic_ingredient_dictionary':
      return `ingredient:${stableSuffix(requiredKey(row, 'generic_ingredient_raw', dataset))}`
    case 'nafdac_alert_source_index':
      return `alert-source:${requiredKey(row, 'source_post_id', dataset)}`
    case 'nafdac_manufacturers':
      return `nafdac-manufacturer:${requiredKey(row, 'manufacturer_id', dataset)}`
    case 'neml_adult_formulary_candidates':
    case 'neml_children_ocr_candidates':
      return requiredKey(row, 'source_record_id', dataset)
    case 'priority_alias_review':
      return `alias:${stableSuffix(row.input_term, row.candidate_term)}`
    case 'source_duplicate_review':
      return `duplicate:${requiredKey(row, 'check_type', dataset)}:${requiredKey(row, 'group_value', dataset)}`
    case 'source_register':
      return requiredKey(row, 'source_id', dataset)
    default:
      return `${dataset}:${lineDigest.slice(0, 24)}`
  }
}

function sourceStatusFor(row) {
  return row.nafdac_status_raw
    ?? row.regulatory_status
    ?? row.status_at_alert
    ?? row.access_result
    ?? null
}

async function validateAndReadPackage(packageDir) {
  const manifestPath = join(packageDir, 'file_manifest.json')
  const manifestBuffer = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBuffer.toString('utf8'))
  if (!manifest.snapshot_date || !Array.isArray(manifest.files)) {
    throw new Error('file_manifest.json has an invalid shape')
  }

  const directoryFiles = new Set(await readdir(packageDir))
  const jsonlRows = []
  const datasetCounts = {}

  for (const entry of manifest.files) {
    if (!directoryFiles.has(entry.file)) {
      throw new Error(`Manifest file is missing: ${entry.file}`)
    }
    const buffer = await readFile(join(packageDir, entry.file))
    if (buffer.byteLength !== entry.bytes) {
      throw new Error(`${entry.file}: expected ${entry.bytes} bytes, found ${buffer.byteLength}`)
    }
    const digest = sha256(buffer)
    if (digest !== entry.sha256) {
      throw new Error(`${entry.file}: digest mismatch (${digest})`)
    }

    if (extname(entry.file) !== '.jsonl') continue

    const dataset = basename(entry.file, '.jsonl')
    const lines = buffer.toString('utf8').split(/\r?\n/).filter((line) => line.trim() !== '')
    if (lines.length !== entry.rows) {
      throw new Error(`${entry.file}: expected ${entry.rows} rows, found ${lines.length}`)
    }

    const seenIds = new Set()
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const raw = lines[lineIndex]
      let payload
      try {
        payload = JSON.parse(raw)
      } catch (error) {
        throw new Error(`${entry.file}:${lineIndex + 1}: invalid JSON (${error.message})`)
      }
      if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
        throw new Error(`${entry.file}:${lineIndex + 1}: expected a JSON object`)
      }

      const recordSha256 = sha256(raw)
      const recordId = recordIdFor(dataset, payload, recordSha256)
      if (seenIds.has(recordId)) {
        throw new Error(`${entry.file}: duplicate derived record_id ${recordId}`)
      }
      seenIds.add(recordId)
      jsonlRows.push({
        dataset,
        recordId,
        recordSha256,
        sourceIdentityFingerprint: payload.source_identity_fingerprint ?? null,
        sourceStatus: sourceStatusFor(payload),
        reviewStatus: payload.review_status ?? null,
        sourceUrl: payload.source_url ?? payload.example_source_url ?? null,
        payload,
      })
    }
    datasetCounts[dataset] = lines.length
  }

  return { manifest, jsonlRows, datasetCounts }
}

function databaseConfig(databaseUrl) {
  const url = new URL(databaseUrl)
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  return {
    connectionString: databaseUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  }
}

async function readProtectedDatabaseUrl(path) {
  const absolutePath = resolve(path)
  const metadata = await lstat(absolutePath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('The staging database secret must be a regular, non-symlink file')
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error('The staging database secret must have mode 0600 (no group/world access)')
  }
  const databaseUrl = (await readFile(absolutePath, 'utf8')).trim()
  const url = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname || !url.username || !url.password || !url.pathname.slice(1)) {
    throw new Error('The protected staging secret does not contain a complete PostgreSQL URL')
  }
  return databaseUrl
}

function assertNonProduction(databaseUrl) {
  if (process.env.CATALOGUE_STAGING_CONFIRM_NON_PRODUCTION !== 'YES') {
    throw new Error('Set CATALOGUE_STAGING_CONFIRM_NON_PRODUCTION=YES for a database import')
  }
  if (process.env.DATABASE_URL && databaseUrl === process.env.DATABASE_URL) {
    throw new Error('Refusing import: staging URL is identical to DATABASE_URL')
  }
  if (process.env.PRODUCTION_DATABASE_URL && databaseUrl === process.env.PRODUCTION_DATABASE_URL) {
    throw new Error('Refusing import: staging URL is identical to PRODUCTION_DATABASE_URL')
  }
}

async function insertRows(client, snapshotId, rows) {
  const chunkSize = 200
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize)
    const values = []
    const placeholders = chunk.map((row, index) => {
      const offset = index * 9
      values.push(
        snapshotId,
        row.dataset,
        row.recordId,
        row.recordSha256,
        row.sourceIdentityFingerprint,
        row.sourceStatus,
        row.reviewStatus,
        row.sourceUrl,
        JSON.stringify(row.payload),
      )
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9}::jsonb)`
    }).join(',')

    const mismatch = await client.query(`
      WITH incoming(snapshot_id, dataset, record_id, record_sha256, source_identity_fingerprint,
        source_status, review_status, source_url, payload) AS (VALUES ${placeholders})
      SELECT incoming.dataset, incoming.record_id
      FROM incoming
      JOIN public.catalogue_source_records existing
        ON existing.snapshot_id = incoming.snapshot_id::uuid
       AND existing.dataset = incoming.dataset
       AND existing.record_id = incoming.record_id
      WHERE existing.record_sha256 <> incoming.record_sha256
         OR existing.payload <> incoming.payload::jsonb
      LIMIT 1
    `, values)
    if (mismatch.rowCount > 0) {
      throw new Error(`Immutable source row changed: ${mismatch.rows[0].dataset}/${mismatch.rows[0].record_id}`)
    }

    await client.query(`
      INSERT INTO public.catalogue_source_records (
        snapshot_id, dataset, record_id, record_sha256, source_identity_fingerprint,
        source_status, review_status, source_url, payload
      ) VALUES ${placeholders}
      ON CONFLICT (snapshot_id, dataset, record_id) DO NOTHING
    `, values)
  }
}

async function importPackage({ manifest, jsonlRows, datasetCounts }, args) {
  const { default: pg } = await import('pg')
  const { Client } = pg
  if (process.env.CATALOGUE_STAGING_DATABASE_URL) {
    throw new Error('CATALOGUE_STAGING_DATABASE_URL is forbidden; use the protected file reference')
  }
  const databaseUrlFile = process.env.CATALOGUE_STAGING_DATABASE_URL_FILE
  if (!databaseUrlFile) {
    throw new Error('CATALOGUE_STAGING_DATABASE_URL_FILE is required without --dry-run')
  }
  const databaseUrl = await readProtectedDatabaseUrl(databaseUrlFile)
  assertNonProduction(databaseUrl)

  const client = new Client(databaseConfig(databaseUrl))
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('stocmed-catalogue-source-import'))")
    const productsBefore = await client.query('SELECT COUNT(*)::INTEGER AS count FROM public.products')

    const existing = await client.query(`
      SELECT id, package_sha256
      FROM public.catalogue_source_snapshots
      WHERE source_key = $1 AND snapshot_date = $2::date
      FOR UPDATE
    `, [SOURCE_KEY, manifest.snapshot_date])

    let snapshotId
    if (existing.rowCount === 1) {
      if (existing.rows[0].package_sha256 !== args.packageSha256) {
        throw new Error('Snapshot date already exists with a different package SHA-256')
      }
      snapshotId = existing.rows[0].id
    } else {
      const inserted = await client.query(`
        INSERT INTO public.catalogue_source_snapshots (
          source_key, snapshot_date, package_sha256, manifest
        ) VALUES ($1, $2::date, $3, $4::jsonb)
        RETURNING id
      `, [SOURCE_KEY, manifest.snapshot_date, args.packageSha256, JSON.stringify(manifest)])
      snapshotId = inserted.rows[0].id
    }

    await insertRows(client, snapshotId, jsonlRows)

    const storedCount = await client.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM public.catalogue_source_records
      WHERE snapshot_id = $1
    `, [snapshotId])
    if (storedCount.rows[0].count !== jsonlRows.length) {
      throw new Error(`Stored row count ${storedCount.rows[0].count} does not equal package count ${jsonlRows.length}`)
    }

    const reconciliation = await client.query(
      'SELECT * FROM public.reconcile_catalogue_source_snapshot($1)',
      [snapshotId],
    )
    const productsAfter = await client.query('SELECT COUNT(*)::INTEGER AS count FROM public.products')
    if (productsAfter.rows[0].count !== productsBefore.rows[0].count) {
      throw new Error('Safety boundary failed: reconciliation changed the products row count')
    }
    await client.query('COMMIT')

    return {
      mode: 'staging-import',
      snapshotId,
      snapshotDate: manifest.snapshot_date,
      packageSha256: args.packageSha256,
      sourceRows: jsonlRows.length,
      datasetCounts,
      reconciliationQueues: Object.fromEntries(
        reconciliation.rows.map((row) => [row.queue_type, Number(row.row_count)]),
      ),
      productsCountBefore: productsBefore.rows[0].count,
      productsCountAfter: productsAfter.rows[0].count,
      productsMutatedByImporter: productsAfter.rows[0].count !== productsBefore.rows[0].count,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const packageBuffer = await readFile(args.packageZip)
  args.packageSha256 = sha256(packageBuffer)
  if (args.expectedPackageSha256 && args.packageSha256 !== args.expectedPackageSha256) {
    throw new Error(
      `Package ZIP digest mismatch: expected ${args.expectedPackageSha256}, found ${args.packageSha256}`,
    )
  }
  const validated = await validateAndReadPackage(args.packageDir)
  if (args.dryRun) {
    console.log(JSON.stringify({
      mode: 'validated-dry-run',
      snapshotDate: validated.manifest.snapshot_date,
      packageSha256: args.packageSha256,
      manifestFilesChecked: validated.manifest.files.length,
      sourceRows: validated.jsonlRows.length,
      datasetCounts: validated.datasetCounts,
    }, null, 2))
    return
  }

  console.log(JSON.stringify(await importPackage(validated, args), null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

import { NextRequest, NextResponse } from 'next/server'

import { mapControlledValue, mapDosageForm } from '@/lib/controlled-lookups'
import {
  determineImportRouting,
  INVENTORY_IMPORT_FIELDS,
  normalizeImportDosageForm,
  normalizeImportStrength,
  parseImportBoolean,
  parseImportDate,
} from '@/lib/inventory-import'
import {
  IMPORT_ROW_NUMBER_KEY,
  normalizeInventoryRows,
  type NormalizedImportStagingRow,
  type RawImportRow,
} from '@/lib/inventory-import-parser'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'

const MAX_IMPORT_ROWS = 10_000
const PAGE_SIZE = 1_000
// UUID filters are encoded in the PostgREST URL. Keep each request well below
// common proxy URL limits even when a job resolves hundreds of catalogue IDs.
const PRODUCT_LOOKUP_CHUNK_SIZE = 100
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_MAPPING_KEYS = new Set<string>(INVENTORY_IMPORT_FIELDS.map((field) => field.key))

type StagingMatchRow = NormalizedImportStagingRow & {
  id: string
  match_status: 'pending' | 'matched' | 'unmatched' | 'review' | 'error'
  matched_catalogue_id: string | null
  confidence: number | string | null
  tier: string | null
}

type CatalogueProduct = {
  id: string
  generic_name: string
  brand_name: string | null
  manufacturer: string | null
  strength: string
  dosage_form: string | null
  category: string | null
  pack_size: string | null
}

type ImportJobProgress = {
  id: string
  status: string
  total_rows: number
  parsed_rows: number
  matched_rows: number
  unmatched_rows: number
  review_rows: number
  error_rows: number
  started_at: string | null
  completed_at: string | null
}

function mappedValue(row: RawImportRow, mapping: Record<string, string>, key: string): unknown {
  const header = mapping[key]
  return header ? row[header] : undefined
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function sanitizeMapping(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const mapping: Record<string, string> = {}
  for (const [key, header] of Object.entries(value)) {
    if (!ALLOWED_MAPPING_KEYS.has(key) || typeof header !== 'string') return null
    const cleanHeader = header.trim()
    if (!cleanHeader || cleanHeader.startsWith('__')) return null
    mapping[key] = cleanHeader
  }
  return mapping
}

function validateRawRows(value: unknown): RawImportRow[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_IMPORT_ROWS) return null
  const rows = value as RawImportRow[]
  const sourceRows = new Set<number>()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null
    const sourceRow = Number(row[IMPORT_ROW_NUMBER_KEY])
    if (!Number.isInteger(sourceRow) || sourceRow < 2 || sourceRows.has(sourceRow)) return null
    sourceRows.add(sourceRow)
  }
  return rows
}

async function fetchAllStagingRows(supabase: any, jobId: string, totalRows: number) {
  const pageCount = Math.ceil(totalRows / PAGE_SIZE)
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, page) => {
      const from = page * PAGE_SIZE
      return supabase
        .from('import_staging')
        .select('id,source_row_number,raw_name,norm_name,barcode,cost_kobo,price_kobo,qty,min_qty,expiry,parse_error,match_status,matched_catalogue_id,confidence,tier')
        .eq('job_id', jobId)
        .order('source_row_number', { ascending: true })
        .range(from, Math.min(from + PAGE_SIZE - 1, totalRows - 1))
    }),
  )

  const failedPage = pages.find((page) => page.error)
  if (failedPage?.error) throw new Error(`Could not load matched staging rows: ${failedPage.error.message}`)
  const rows = pages.flatMap((page) => page.data || []) as StagingMatchRow[]
  if (rows.length !== totalRows) {
    throw new Error(`Matched staging row count mismatch: expected ${totalRows}, received ${rows.length}`)
  }
  return rows
}

async function fetchProductsById(supabase: any, ids: string[]) {
  const uniqueIds = Array.from(new Set(ids))
  if (!uniqueIds.length) return new Map<string, CatalogueProduct>()
  const chunks = Array.from(
    { length: Math.ceil(uniqueIds.length / PRODUCT_LOOKUP_CHUNK_SIZE) },
    (_, index) => uniqueIds.slice(
      index * PRODUCT_LOOKUP_CHUNK_SIZE,
      index * PRODUCT_LOOKUP_CHUNK_SIZE + PRODUCT_LOOKUP_CHUNK_SIZE,
    ),
  )
  const results = await Promise.all(chunks.map((chunk) => supabase
    .from('products')
    .select('id,generic_name,brand_name,manufacturer,strength,dosage_form,category,pack_size')
    .in('id', chunk)))
  const failure = results.find((result) => result.error)
  if (failure?.error) throw new Error(`Could not load catalogue matches: ${failure.error.message}`)
  return new Map<string, CatalogueProduct>(
    results.flatMap((result) => result.data || []).map((product: CatalogueProduct) => [product.id, product]),
  )
}

function buildMatch(product: CatalogueProduct, staging: StagingMatchRow, strength: string, dosageForm: string) {
  const requestedStrength = normalizeImportStrength(strength)
  const requestedForm = normalizeImportDosageForm(dosageForm)
  const strengthMatch = requestedStrength
    ? normalizeImportStrength(product.strength) === requestedStrength
    : null
  const formMatch = requestedForm
    ? normalizeImportDosageForm(product.dosage_form) === requestedForm
    : null
  const mismatchReasons = [
    strengthMatch === false ? 'strength differs' : null,
    formMatch === false ? 'form differs' : null,
    strengthMatch === null ? 'strength not supplied' : null,
    formMatch === null ? 'form not supplied' : null,
  ].filter((reason): reason is string => Boolean(reason))

  return {
    ...product,
    confidence: Number(staging.confidence ?? 0),
    tier: staging.tier,
    match_status: staging.match_status,
    strength_match: strengthMatch,
    form_match: formMatch,
    mismatch_reasons: mismatchReasons,
  }
}

function buildReviewRows(
  rawRows: RawImportRow[],
  mapping: Record<string, string>,
  stagingRows: StagingMatchRow[],
  productsById: Map<string, CatalogueProduct>,
  dosageForms: string[],
  categories: string[],
) {
  const rawBySourceRow = new Map(
    rawRows.map((row) => [Number(row[IMPORT_ROW_NUMBER_KEY]), row]),
  )

  return stagingRows.map((staging) => {
    const rawRow = rawBySourceRow.get(staging.source_row_number)
    if (!rawRow) throw new Error(`Source row ${staging.source_row_number} is missing from the request`)

    const genericName = textValue(mappedValue(rawRow, mapping, 'name'))
    const brandName = textValue(mappedValue(rawRow, mapping, 'brand_name'))
    const strength = textValue(mappedValue(rawRow, mapping, 'strength'))
    const suppliedDosageForm = textValue(mappedValue(rawRow, mapping, 'dosage_form'))
    const dosageForm = mapDosageForm(suppliedDosageForm, dosageForms).value
    const suppliedCategory = textValue(mappedValue(rawRow, mapping, 'category'))
    const category = mapControlledValue(suppliedCategory || 'Others', categories).value
    const packSize = textValue(mappedValue(rawRow, mapping, 'pack_size'))
    const sku = textValue(mappedValue(rawRow, mapping, 'sku'))
    const suppliedType = textValue(mappedValue(rawRow, mapping, 'item_type')).toLowerCase()
    const suppliedTracksExpiry = mappedValue(rawRow, mapping, 'tracks_expiry') !== undefined
      ? parseImportBoolean(mappedValue(rawRow, mapping, 'tracks_expiry'))
      : false
    const normalizedType = ['medicine', 'drug', 'rx'].includes(suppliedType)
      ? 'medicine'
      : ['store', 'grocery', 'frontstore'].includes(suppliedType) ? 'store' : ''
    const batchNumber = textValue(mappedValue(rawRow, mapping, 'batch_number'))
    const expiryDate = parseImportDate(mappedValue(rawRow, mapping, 'expiry_date'))
    const product = staging.matched_catalogue_id
      ? productsById.get(staging.matched_catalogue_id)
      : undefined
    const bestMatch = product ? buildMatch(product, staging, strength, dosageForm) : null
    const matches = bestMatch ? [bestMatch] : []
    const routing = determineImportRouting({
      item_type: normalizedType,
      strength,
      dosage_form: dosageForm,
    }, bestMatch)

    return {
      parse_error: staging.parse_error || undefined,
      source_row_number: staging.source_row_number,
      match_status: staging.match_status,
      tier: staging.tier,
      confidence: staging.confidence === null ? null : Number(staging.confidence),
      mapped: {
        generic_name: genericName,
        brand_name: brandName,
        strength,
        dosage_form: dosageForm,
        category,
        pack_size: packSize,
        sku,
        item_type: routing.itemType,
        tracks_expiry: routing.itemType === 'medicine' ? true : suppliedTracksExpiry,
        price: staging.price_kobo === null ? null : staging.price_kobo / 100,
        quantity: staging.qty,
        unit_cost: staging.cost_kobo === null ? 0 : staging.cost_kobo / 100,
        min_quantity: staging.min_qty,
        batch_number: batchNumber,
        expiry_date: expiryDate,
      },
      selected_product_id: routing.selectedProductId,
      matches,
    }
  })
}

async function authenticatedContext() {
  const supabase = (await createClient()) as any
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) {
    return { response: NextResponse.json({ error: 'Pharmacy profile not found. Complete your setup to continue.' }, { status: 404 }) }
  }
  return { supabase, pharmacy }
}

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedContext()
    if (context.response) return context.response
    const jobId = request.nextUrl.searchParams.get('job_id') || ''
    if (!UUID_PATTERN.test(jobId)) return NextResponse.json({ error: 'A valid job_id is required' }, { status: 400 })
    const { data: job, error } = await context.supabase
      .from('import_jobs')
      .select('id,status,total_rows,parsed_rows,matched_rows,unmatched_rows,review_rows,error_rows,started_at,completed_at')
      .eq('id', jobId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: `Could not load import progress: ${error.message}` }, { status: 500 })
    if (!job) return NextResponse.json({ error: 'Import job not found' }, { status: 404 })
    return NextResponse.json({ job })
  } catch (error) {
    console.error('Import progress failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load import progress' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const requestStartedAt = performance.now()
  let jobId: string | null = null

  try {
    const context = await authenticatedContext()
    if (context.response) return context.response
    const { supabase, pharmacy } = context
    const body = await request.json()
    const rawRows = validateRawRows(body?.rows)
    const mapping = sanitizeMapping(body?.mapping)
    if (!rawRows || !mapping) {
      return NextResponse.json({ error: `Import requires between 1 and ${MAX_IMPORT_ROWS} parsed rows and a valid mapping` }, { status: 400 })
    }
    const missingRequired = ['name', 'price', 'quantity'].filter((key) => !mapping[key])
    if (missingRequired.length) {
      return NextResponse.json({ error: `Required mappings are missing: ${missingRequired.join(', ')}` }, { status: 400 })
    }

    const normalizedRows = normalizeInventoryRows(rawRows, mapping)
    const { data: stagedJob, error: stageError } = await supabase.rpc('stage_import_job', {
      p_pharmacy_id: pharmacy.id,
      p_rows: normalizedRows,
    })
    if (stageError || !stagedJob?.job_id) {
      throw new Error(`Could not stage import: ${stageError?.message || 'job ID was not returned'}`)
    }
    jobId = String(stagedJob.job_id)

    const { data: matchResult, error: matchError } = await supabase.rpc('match_import_job', {
      p_job_id: jobId,
    })
    if (matchError) {
      await supabase.from('import_jobs').update({
        status: 'failed',
        error_message: matchError.message,
        completed_at: new Date().toISOString(),
      }).eq('id', jobId)
      throw new Error(`Catalogue matching failed: ${matchError.message}`)
    }

    const [jobResult, dosageFormResult, categoryResult] = await Promise.all([
      supabase
        .from('import_jobs')
        .select('id,status,total_rows,parsed_rows,matched_rows,unmatched_rows,review_rows,error_rows,started_at,completed_at')
        .eq('id', jobId)
        .single(),
      supabase.from('dosage_forms').select('name').order('name'),
      supabase.from('product_categories').select('name').order('name'),
    ])
    if (jobResult.error || !jobResult.data) throw new Error(`Could not load import progress: ${jobResult.error?.message || 'job not found'}`)
    if (dosageFormResult.error || categoryResult.error) {
      throw new Error(`Could not load controlled product values: ${dosageFormResult.error?.message || categoryResult.error?.message}`)
    }

    const job = jobResult.data as ImportJobProgress
    const stagingRows = await fetchAllStagingRows(supabase, jobId, job.total_rows)
    const productsById = await fetchProductsById(
      supabase,
      stagingRows.flatMap((row) => row.matched_catalogue_id ? [row.matched_catalogue_id] : []),
    )
    const dosageForms = (dosageFormResult.data || []).map((entry: { name: string }) => entry.name)
    const categories = (categoryResult.data || []).map((entry: { name: string }) => entry.name)
    const matchedRows = buildReviewRows(rawRows, mapping, stagingRows, productsById, dosageForms, categories)
    const durationMs = Math.round((performance.now() - requestStartedAt) * 1000) / 1000

    return NextResponse.json(
      { job, matchResult, matchedRows, dosageForms, categories, durationMs },
      { headers: { 'Server-Timing': `import-match;dur=${durationMs}` } },
    )
  } catch (error) {
    console.error('Bulk catalogue matching failed:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error while matching products',
      ...(jobId ? { job_id: jobId } : {}),
    }, { status: 500 })
  }
}
